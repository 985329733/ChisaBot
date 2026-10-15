import { randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  type CcApprovalState,
  type CcBrowserOp,
  type CcProxyTest,
  maskProxyUrl,
  parseProxyUrl,
  type CcChangedFile,
  type CcMessage,
  type CcPart,
  type CcSessionStatus,
  type CcSessionView,
  type CcStreamOp,
  type CcSyncState,
  type CcWorkspaceView,
  type ClaudeAuth,
  type CloudWorkspaceView,
  CC_EFFORTS,
} from "../../../shared/cloud-cc";
import type { AppVariables } from "../auth/guards";
import type { Database } from "../db/client";
import type { DeviceHub, DeviceHubExtension } from "../devices/hub";
import type { DeviceRecord, DeviceStore } from "../devices/store";
import type { Vault } from "../vault/service";

/**
 * 云端 Claude Code（docs/cloud-claude-code.md，ADR-0014，DESIGN.md §73）。
 *
 * - 云端节点是一台普通设备（chisabot-node，容器里设 CHISABOT_CLOUD_WORKSPACE=1）；连上时服务器发 cc_probe，它回 cc_info，
 *   这里就把它登记成「云端工作区」（chisabot_cloud_workspaces）。
 * - Claude 登录：设置 → 云端工作区。节点跑 `claude auth login`，授权码只经过节点那个进程的标准输入；这里只存登录状态。
 * - 会话：一个会话 = 一个 Claude 会话（--session-id / --resume）+ 一个持久目录。每一轮 cc_turn 发给节点，cc_event 拼成
 *   会话记录（chisabot_cc_messages），并通过 /sessions/:id/stream 推给网页（刷新 / 换设备先给快照再接着推）。
 * - 审批：节点的 PreToolUse 钩子问不准的，回 cc_approval_request；这里在会话里画审批卡，你点了再回 cc_approval_result。
 * - 在云端完成登录：节点容器里的无头 Chromium 打开授权页，画面（CDP screencast）经设备 WSS → 这里 → 设置页（SSE）；
 *   点击 / 键盘反过来走。授权页跳到回调地址时节点自己拿到授权码交给 `claude auth login`，授权码不经过这里。
 * - Claude 上游代理：地址存在保险箱保留名 `claude-proxy`（加密），节点连上 / 改设置时下发给节点（只在节点内存里）。
 * - 只有管理员能用（朋友账号看不到）。
 */

const MAX_CONCURRENT = 2;
const APPROVAL_MS = 120_000;
const RPC_MS = 40_000;
const LOGIN_CODE_MS = 80_000;
const PERSIST_EVERY_MS = 2_000;
const SCRATCH_ID_PREFIX = "scratch";

type Json = Record<string, unknown>;

class CcError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

type NodeRow = { device_id: string; owner_user_id: string; claude_auth: ClaudeAuth | null; info: Json | null; updated_at: Date | string };
type WorkspaceRow = {
  id: string;
  owner_user_id: string;
  node_device_id: string;
  name: string;
  source: string;
  repo_full_name: string | null;
  default_branch: string | null;
  is_git: boolean;
  path: string | null;
  sync_state: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
};
type SessionRow = {
  id: string;
  owner_user_id: string;
  workspace_id: string;
  title: string;
  claude_session_id: string | null;
  resumable: boolean;
  branch: string | null;
  model: string | null;
  effort: string | null;
  turns: number;
  status: string;
  last_error: string | null;
  last_turn_at: Date | string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
};
type MessageRow = {
  id: string;
  session_id: string;
  owner_user_id: string;
  turn_id: string | null;
  role: string;
  parts: CcPart[];
  status: string;
  meta: Json | null;
  created_at: Date | string;
};

type Subscriber = (op: CcStreamOp) => void;
type LiveTurn = {
  sessionId: string;
  turnId: string;
  ownerUserId: string;
  deviceId: string;
  workspaceId: string;
  message: CcMessage;
  /** 由增量拼出来、还没被完整文字确认的文字段。 */
  pendingText: number[];
  statusText: string | null;
  status: CcSessionStatus;
  seq: number;
  startedAt: number;
  lastEventAt: number;
  stopRequested: boolean;
  stopTimer?: ReturnType<typeof setTimeout>;
  approvalTimers: Map<string, ReturnType<typeof setTimeout>>;
  dirty: boolean;
};

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function shortId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function unref(timer: ReturnType<typeof setTimeout>) {
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
}

const EMPTY_AUTH: ClaudeAuth = { loggedIn: false, email: null, plan: null, method: null, checkedAt: null };

export type CloudCcServiceOptions = {
  database: Database;
  hub: DeviceHub;
  deviceStore: Pick<DeviceStore, "get">;
  /** 下一个扩展（本地 agent）：cc_* 以外的消息、hello、gate 都交给它。 */
  next?: DeviceHubExtension | null;
  /** 保险箱：「Claude 上游代理」的地址（保留名 claude-proxy）。 */
  vault?: Pick<Vault, "internal"> | null;
};

export const PROXY_SECRET = "claude-proxy";
const PROXY_DOMAINS = ["claude.ai", "anthropic.com", "claude.com"];

export type CloudCcService = ReturnType<typeof createCloudCcService>;

export function createCloudCcService(options: CloudCcServiceOptions) {
  const { database, hub, deviceStore } = options;
  const sql = database.$client;
  const nodes = new Set<string>(); // 已登记的云端节点 device id
  const rpcs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; deviceId: string }>();
  const live = new Map<string, LiveTurn>(); // sessionId -> 当前一轮
  const subscribers = new Map<string, Set<Subscriber>>(); // sessionId -> 网页
  const logins = new Map<string, { deviceId: string; ownerUserId: string; expiresAt: number }>();
  const browserSubs = new Map<string, Set<(op: CcBrowserOp) => void>>(); // loginId -> 设置页
  const lastFrame = new Map<string, CcBrowserOp>(); // 新打开的画面先给最后一帧
  const vault = options.vault ?? null;

  async function ensure() {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS chisabot_cloud_workspaces (
        device_id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        claude_auth jsonb,
        auth_preference text NOT NULL DEFAULT 'subscription',
        api_key_secret text,
        info jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chisabot_cc_workspaces (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        node_device_id text NOT NULL,
        name text NOT NULL,
        source text NOT NULL,
        repo_full_name text,
        default_branch text,
        is_git boolean NOT NULL DEFAULT false,
        path text,
        sync_state text NOT NULL DEFAULT 'cloud_only',
        size_bytes bigint,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_used_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS chisabot_cc_workspaces_owner ON chisabot_cc_workspaces (owner_user_id);
      CREATE TABLE IF NOT EXISTS chisabot_cc_sessions (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        workspace_id text NOT NULL,
        thread_id text,
        title text NOT NULL,
        claude_session_id text,
        resumable boolean NOT NULL DEFAULT false,
        branch text,
        tree_path text,
        model text,
        effort text,
        turns integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'idle',
        last_error text,
        last_turn_at timestamptz,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chisabot_cc_sessions_ws ON chisabot_cc_sessions (workspace_id);
      CREATE TABLE IF NOT EXISTS chisabot_cc_messages (
        id text PRIMARY KEY,
        session_id text NOT NULL,
        owner_user_id text NOT NULL,
        turn_id text,
        role text NOT NULL,
        parts jsonb NOT NULL DEFAULT '[]'::jsonb,
        status text NOT NULL DEFAULT 'done',
        meta jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chisabot_cc_messages_session ON chisabot_cc_messages (session_id, created_at);
      CREATE TABLE IF NOT EXISTS chisabot_cc_permission_rules (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        scope text NOT NULL,
        scope_id text NOT NULL,
        kind text NOT NULL,
        value text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS chisabot_cc_events (
        id bigserial PRIMARY KEY,
        owner_user_id text NOT NULL,
        session_id text,
        kind text NOT NULL,
        detail jsonb,
        at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const row of await sql.unsafe<{ device_id: string }[]>("SELECT device_id FROM chisabot_cloud_workspaces")) nodes.add(row.device_id);
  }

  /** 重启时还在「进行中」的轮次如实标成中断。 */
  async function recover() {
    const rows = await sql.unsafe<{ id: string; parts: CcPart[] }[]>("SELECT id, parts FROM chisabot_cc_messages WHERE status = 'running'");
    for (const row of rows) {
      const parts = [...(row.parts ?? []).map((p) => (p.type === "approval" && p.state === "pending" ? { ...p, state: "expired" as const } : p)), { type: "error", text: "服务器重启，这一轮中断了。可以再发一次。" } as CcPart];
      await sql.unsafe("UPDATE chisabot_cc_messages SET status = 'error', parts = $2::text::jsonb, updated_at = now() WHERE id = $1", [row.id, JSON.stringify(parts)]);
    }
    await sql.unsafe("UPDATE chisabot_cc_messages SET status = 'done' WHERE status = 'queued'");
    await sql.unsafe("UPDATE chisabot_cc_sessions SET status = 'idle', updated_at = now() WHERE status IN ('running','waiting')");
    return rows.length;
  }

  async function audit(ownerUserId: string, sessionId: string | null, kind: string, detail: Json | null = null) {
    await sql
      .unsafe("INSERT INTO chisabot_cc_events (owner_user_id, session_id, kind, detail) VALUES ($1, $2, $3, $4::text::jsonb)", [ownerUserId, sessionId, kind, detail ? JSON.stringify(detail) : null])
      .catch(() => {});
  }

  // ── 节点 ──────────────────────────────────────────────────────────────

  async function nodeFor(ownerUserId: string): Promise<NodeRow | null> {
    const rows = await sql.unsafe<NodeRow[]>("SELECT * FROM chisabot_cloud_workspaces WHERE owner_user_id = $1 ORDER BY updated_at DESC", [ownerUserId]);
    for (const row of rows) {
      const device = await deviceStore.get(row.device_id).catch(() => null);
      if (device && !device.revoked) return row;
    }
    return null;
  }

  async function onlineNode(ownerUserId: string) {
    const row = await nodeFor(ownerUserId);
    if (!row) throw new CcError("还没有云端工作区节点。", 409);
    if (!hub.isOnline(row.device_id)) throw new CcError("云端工作区不在线。", 409);
    return row;
  }

  function rpc<T = Json>(deviceId: string, op: string, args: Json = {}, timeoutMs = RPC_MS): Promise<T> {
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        rpcs.delete(id);
        reject(new CcError("云端工作区没有及时回应。", 503));
      }, timeoutMs);
      unref(timer);
      rpcs.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, deviceId });
      if (!hub.sendRaw(deviceId, { type: "cc_rpc", id, op, args })) {
        clearTimeout(timer);
        rpcs.delete(id);
        reject(new CcError("云端工作区不在线。", 409));
      }
    });
  }

  async function saveAuth(deviceId: string, auth: Partial<ClaudeAuth> & { loggedIn?: boolean }) {
    const value: ClaudeAuth = {
      loggedIn: !!auth.loggedIn,
      email: typeof auth.email === "string" ? auth.email.slice(0, 200) : null,
      plan: typeof auth.plan === "string" ? auth.plan.slice(0, 40) : null,
      method: typeof auth.method === "string" ? auth.method.slice(0, 40) : null,
      checkedAt: new Date().toISOString(),
      error: typeof auth.error === "string" ? auth.error.slice(0, 300) : null,
    };
    await sql.unsafe("UPDATE chisabot_cloud_workspaces SET claude_auth = $2::text::jsonb, updated_at = now() WHERE device_id = $1", [deviceId, JSON.stringify(value)]);
    return value;
  }

  async function register(record: DeviceRecord, info: Json) {
    const clean = {
      claudeVersion: typeof info.claudeVersion === "string" ? info.claudeVersion.slice(0, 120) : null,
      root: typeof info.root === "string" ? info.root.slice(0, 200) : null,
      browser: info.browser === true,
    };
    await sql.unsafe(
      `INSERT INTO chisabot_cloud_workspaces (device_id, owner_user_id, info) VALUES ($1, $2, $3::text::jsonb)
       ON CONFLICT (device_id) DO UPDATE SET info = EXCLUDED.info, owner_user_id = EXCLUDED.owner_user_id, updated_at = now()`,
      [record.id, record.ownerUserId, JSON.stringify(clean)],
    );
    const fresh = !nodes.has(record.id);
    nodes.add(record.id);
    if (fresh) await audit(record.ownerUserId, null, "node_registered", { deviceId: record.id, name: record.name });
    // 上游代理先下发（节点重启后内存里没有），再顺手查一次登录状态（不阻塞）
    void (async () => {
      const proxy = await proxyValue(record.ownerUserId).catch(() => null);
      if (proxy || info.proxy === true) await rpc(record.id, "proxy_set", { url: proxy }, 15_000).catch(() => {});
      const auth = await rpc<ClaudeAuth>(record.id, "status", {}, 25_000);
      await saveAuth(record.id, auth);
    })().catch(() => {});
    // 节点重启后：服务器以为还在跑、节点那边已经没有的轮次，如实结束。
    const running = Array.isArray(info.running) ? new Set(info.running as string[]) : new Set<string>();
    for (const turn of live.values()) if (turn.deviceId === record.id && !running.has(turn.sessionId) && Date.now() - turn.startedAt > 10_000) void finish(turn, { ok: false, error: "云端节点重启了，这一轮中断。可以再发一次。" });
  }

  // ── 设备 hub 扩展（排在本地 agent 前面） ─────────────────────────────

  const extension: DeviceHubExtension = {
    onHello(record) {
      if (!/^(android|ios)$/i.test(record.platform)) hub.sendRaw(record.id, { type: "cc_probe" });
      return options.next?.onHello?.(record);
    },
    gate(record, operation, args) {
      return options.next?.gate ? options.next.gate(record, operation, args) : null;
    },
    async onMessage(record, message) {
      const type = message.type;
      if (!type.startsWith("cc_")) return options.next?.onMessage?.(record, message);
      if (type === "cc_info") return register(record, message);
      if (!nodes.has(record.id)) return;
      if (type === "cc_browser_frame" || type === "cc_browser_state" || type === "cc_browser_done") return onBrowser(record, message);
      if (type === "cc_rpc_result") {
        const pending = rpcs.get(String(message.id));
        if (!pending || pending.deviceId !== record.id) return;
        clearTimeout(pending.timer);
        rpcs.delete(String(message.id));
        if (message.ok) pending.resolve(message.result ?? {});
        else pending.reject(new CcError(String(message.error ?? "云端工作区出错").slice(0, 300), 409));
        return;
      }
      const turn = live.get(String(message.sessionId ?? ""));
      if (!turn || turn.deviceId !== record.id || turn.turnId !== message.turnId) return;
      turn.lastEventAt = Date.now();
      if (type === "cc_event") onEvent(turn, (message.event ?? {}) as Json);
      else if (type === "cc_approval_request") onApprovalRequest(turn, message);
      else if (type === "cc_done") await finish(turn, message);
    },
  };

  // ── 会话流 ────────────────────────────────────────────────────────────

  function broadcast(sessionId: string, op: CcStreamOp) {
    for (const fn of subscribers.get(sessionId) ?? []) {
      try {
        fn(op);
      } catch {}
    }
  }

  function setPart(turn: LiveTurn, index: number, part: CcPart) {
    turn.message.parts[index] = part;
    turn.dirty = true;
    broadcast(turn.sessionId, { op: "part", seq: ++turn.seq, messageId: turn.message.id, index, part });
  }
  function pushPart(turn: LiveTurn, part: CcPart) {
    setPart(turn, turn.message.parts.length, part);
    return turn.message.parts.length - 1;
  }
  function setStatus(turn: LiveTurn, status: CcSessionStatus, text: string | null) {
    turn.status = status;
    turn.statusText = text;
    broadcast(turn.sessionId, { op: "status", seq: ++turn.seq, text, status });
  }

  function onEvent(turn: LiveTurn, event: Json) {
    const parts = turn.message.parts;
    switch (event.kind) {
      case "status":
        setStatus(turn, turn.status, typeof event.text === "string" ? event.text : null);
        break;
      case "init":
        if (turn.statusText) setStatus(turn, turn.status, "Claude 正在想");
        break;
      case "text_start":
        turn.pendingText.push(pushPart(turn, { type: "text", text: "" }));
        break;
      case "text_delta": {
        const text = String(event.text ?? "");
        if (!text) break;
        let index = turn.pendingText[turn.pendingText.length - 1];
        if (index === undefined || parts[index]?.type !== "text") {
          index = pushPart(turn, { type: "text", text: "" });
          turn.pendingText.push(index);
        }
        const part = parts[index] as Extract<CcPart, { type: "text" }>;
        part.text += text;
        turn.dirty = true;
        if (turn.statusText) setStatus(turn, turn.status, null);
        broadcast(turn.sessionId, { op: "text", seq: ++turn.seq, messageId: turn.message.id, index, append: text });
        break;
      }
      case "text": {
        const text = String(event.text ?? "");
        const index = turn.pendingText.shift();
        if (index !== undefined && parts[index]?.type === "text") setPart(turn, index, { type: "text", text });
        else if (text) pushPart(turn, { type: "text", text });
        break;
      }
      case "tool_use": {
        turn.pendingText = [];
        pushPart(turn, { type: "tool", id: typeof event.id === "string" ? event.id : null, name: String(event.name ?? "工具"), input: (event.input as Json) ?? {}, status: "running" });
        if (turn.statusText) setStatus(turn, turn.status, null);
        break;
      }
      case "tool_result": {
        const index = parts.findIndex((p) => p.type === "tool" && p.id === event.id);
        if (index < 0) break;
        const part = parts[index] as Extract<CcPart, { type: "tool" }>;
        setPart(turn, index, { ...part, status: part.status === "denied" ? "denied" : event.isError ? "error" : "done", result: String(event.content ?? "").slice(0, 1500) });
        break;
      }
      case "denied": {
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i]!;
          if (p.type === "tool" && p.status === "running" && p.name === event.tool) {
            setPart(turn, i, { ...p, status: "denied", reason: String(event.reason ?? "已拒绝") });
            break;
          }
        }
        void audit(turn.ownerUserId, turn.sessionId, "tool_denied", { tool: event.tool, reason: event.reason });
        break;
      }
      case "result": {
        if (typeof event.costUsd === "number") turn.message.meta = { ...(turn.message.meta ?? {}), costUsd: event.costUsd };
        if (typeof event.turns === "number") turn.message.meta = { ...(turn.message.meta ?? {}), turns: event.turns };
        if (event.ok && typeof event.text === "string" && event.text && !parts.some((p) => p.type === "text" && p.text)) pushPart(turn, { type: "text", text: event.text });
        break;
      }
    }
  }

  function onApprovalRequest(turn: LiveTurn, message: Json) {
    const id = String(message.approvalId ?? "");
    if (!id) return;
    const rule = (message.rule ?? null) as { kind?: string; value?: string } | null;
    const part: CcPart = {
      type: "approval",
      id,
      tool: String(message.tool ?? ""),
      summary: String(message.summary ?? "").slice(0, 600),
      input: (message.input as Json) ?? {},
      canAlways: !!(rule && rule.kind && rule.value),
      state: "pending",
      expiresAt: new Date(Date.now() + APPROVAL_MS).toISOString(),
    };
    (part as CcPart & { rule?: unknown }).rule = rule;
    pushPart(turn, part);
    setStatus(turn, "waiting", "等你批准");
    void sql.unsafe("UPDATE chisabot_cc_sessions SET status = 'waiting', updated_at = now() WHERE id = $1", [turn.sessionId]).catch(() => {});
    const timer = setTimeout(() => void decideApproval(turn.ownerUserId, id, "expired", false).catch(() => {}), APPROVAL_MS);
    unref(timer);
    turn.approvalTimers.set(id, timer);
    void audit(turn.ownerUserId, turn.sessionId, "approval_requested", { tool: part.tool, summary: part.summary });
  }

  async function decideApproval(ownerUserId: string, approvalId: string, decision: "approve" | "deny" | "expired", always: boolean) {
    for (const turn of live.values()) {
      if (turn.ownerUserId !== ownerUserId) continue;
      const index = turn.message.parts.findIndex((p) => p.type === "approval" && p.id === approvalId);
      if (index < 0) continue;
      const part = turn.message.parts[index] as Extract<CcPart, { type: "approval" }> & { rule?: { kind: string; value: string } | null };
      if (part.state !== "pending") throw new CcError("这一步已经处理过了。", 409);
      const state: CcApprovalState = decision === "approve" ? "approved" : decision === "deny" ? "denied" : "expired";
      const keep = always && decision === "approve" && part.canAlways && part.rule;
      setPart(turn, index, { ...part, state, ...(keep ? { always: true } : {}) });
      const timer = turn.approvalTimers.get(approvalId);
      if (timer) clearTimeout(timer);
      turn.approvalTimers.delete(approvalId);
      if (keep && part.rule) {
        await sql.unsafe("INSERT INTO chisabot_cc_permission_rules (id, owner_user_id, scope, scope_id, kind, value) VALUES ($1, $2, 'session', $3, $4, $5)", [
          shortId("rule"),
          ownerUserId,
          turn.sessionId,
          part.rule.kind.slice(0, 20),
          part.rule.value.slice(0, 2000),
        ]);
      }
      hub.sendRaw(turn.deviceId, { type: "cc_approval_result", approvalId, decision: decision === "approve" ? "approve" : "deny", always: !!keep });
      if (!turn.message.parts.some((p) => p.type === "approval" && p.state === "pending")) {
        setStatus(turn, "running", null);
        void sql.unsafe("UPDATE chisabot_cc_sessions SET status = 'running', updated_at = now() WHERE id = $1", [turn.sessionId]).catch(() => {});
      }
      await audit(ownerUserId, turn.sessionId, `approval_${state}`, { tool: part.tool, summary: part.summary, always: !!keep });
      return { state };
    }
    throw new CcError("找不到这一步（这一轮可能已经结束）。", 404);
  }

  async function persist(turn: LiveTurn) {
    if (!turn.dirty) return;
    turn.dirty = false;
    await sql
      .unsafe("UPDATE chisabot_cc_messages SET parts = $2::text::jsonb, meta = $3::text::jsonb, updated_at = now() WHERE id = $1", [turn.message.id, JSON.stringify(turn.message.parts), JSON.stringify(turn.message.meta ?? null)])
      .catch(() => {
        turn.dirty = true;
      });
  }

  const persistTimer = setInterval(() => {
    for (const turn of live.values()) {
      void persist(turn);
      // 节点断开或长时间没有任何事件：如实结束，别让会话一直「运行中」。
      const idle = Date.now() - turn.lastEventAt;
      if (!hub.isOnline(turn.deviceId) && idle > 60_000) void finish(turn, { ok: false, error: "云端节点断开了，这一轮中断。" });
      else if (idle > 50 * 60_000) void finish(turn, { ok: false, error: "这一轮太久没有动静，已结束。" });
    }
  }, PERSIST_EVERY_MS);
  unref(persistTimer);

  async function finish(turn: LiveTurn, done: Json) {
    if (live.get(turn.sessionId) !== turn) return;
    live.delete(turn.sessionId);
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    for (const timer of turn.approvalTimers.values()) clearTimeout(timer);
    const parts = turn.message.parts.map((p) => (p.type === "approval" && p.state === "pending" ? { ...p, state: "expired" as const } : p.type === "tool" && p.status === "running" ? { ...p, status: (done.ok ? "done" : "error") as "done" | "error" } : p));
    const stopped = !!done.stopped || (turn.stopRequested && !done.ok);
    const changes = (Array.isArray(done.changes) ? done.changes : []) as CcChangedFile[];
    if (changes.length) parts.push({ type: "changes", turnId: turn.turnId, files: changes.slice(0, 300) });
    if (!done.ok && !stopped) parts.push({ type: "error", text: String(done.error ?? "这一轮出错了。").slice(0, 1200) });
    if (stopped) parts.push({ type: "notice", text: "已停止。" });
    const status: CcMessage["status"] = done.ok ? "done" : stopped ? "stopped" : "error";
    const meta = { ...(turn.message.meta ?? {}), ...(typeof done.costUsd === "number" ? { costUsd: done.costUsd } : {}), ...(typeof done.turns === "number" ? { turns: done.turns } : {}), durationMs: Date.now() - turn.startedAt };
    const message: CcMessage = { ...turn.message, parts, status, meta };
    await sql.unsafe("UPDATE chisabot_cc_messages SET parts = $2::text::jsonb, status = $3, meta = $4::text::jsonb, updated_at = now() WHERE id = $1", [message.id, JSON.stringify(parts), status, JSON.stringify(meta)]);
    const claudeSessionId = typeof done.claudeSessionId === "string" && /^[0-9a-f-]{36}$/i.test(done.claudeSessionId) ? done.claudeSessionId : null;
    await sql.unsafe(
      `UPDATE chisabot_cc_sessions SET status = $2, last_error = $3, turns = turns + 1, last_turn_at = now(), updated_at = now(),
         claude_session_id = CASE WHEN $4::boolean THEN COALESCE($5, claude_session_id) ELSE claude_session_id END,
         resumable = resumable OR $4::boolean
       WHERE id = $1`,
      [turn.sessionId, done.ok || stopped ? "idle" : "error", done.ok || stopped ? null : String(done.error ?? "").slice(0, 300), !!done.resumable, claudeSessionId],
    );
    await audit(turn.ownerUserId, turn.sessionId, "turn_done", { ok: !!done.ok, stopped, costUsd: done.costUsd ?? null, turns: done.turns ?? null, files: changes.length });
    broadcast(turn.sessionId, { op: "done", seq: ++turn.seq, message });
    // 回答期间又发的消息：按顺序接着跑
    const queued = (await sql.unsafe<MessageRow[]>("SELECT * FROM chisabot_cc_messages WHERE session_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1", [turn.sessionId]))[0];
    if (queued) {
      await sql.unsafe("UPDATE chisabot_cc_messages SET status = 'done' WHERE id = $1", [queued.id]);
      broadcast(turn.sessionId, { op: "message", seq: 0, message: { ...toMessage(queued), status: "done" } });
      const text = queued.parts.find((p) => p.type === "text") as { text: string } | undefined;
      await startTurn(turn.ownerUserId, turn.sessionId, text?.text ?? "").catch((error) => console.warn("cloud-cc queued turn failed", error));
    }
  }

  // ── 工作区 / 会话 ─────────────────────────────────────────────────────

  function toMessage(row: MessageRow): CcMessage {
    return { id: row.id, turnId: row.turn_id, role: row.role as CcMessage["role"], parts: (row.parts ?? []).map(stripRule), status: row.status as CcMessage["status"], meta: (row.meta as CcMessage["meta"]) ?? null, createdAt: iso(row.created_at)! };
  }
  function stripRule(part: CcPart): CcPart {
    if (part.type !== "approval") return part;
    const { rule: _rule, ...rest } = part as CcPart & { rule?: unknown };
    return rest as CcPart;
  }

  function sessionView(row: SessionRow): CcSessionView {
    const turn = live.get(row.id);
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      title: row.title,
      status: turn ? turn.status : (row.status as CcSessionStatus),
      branch: row.branch,
      model: row.model,
      effort: row.effort,
      turns: row.turns,
      resumable: row.resumable,
      lastTurnAt: iso(row.last_turn_at),
      createdAt: iso(row.created_at)!,
      lastError: row.last_error,
    };
  }

  async function ensureScratch(ownerUserId: string, node: NodeRow) {
    const id = `${SCRATCH_ID_PREFIX}_${node.device_id.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}`;
    await sql.unsafe(
      `INSERT INTO chisabot_cc_workspaces (id, owner_user_id, node_device_id, name, source, is_git, sync_state) VALUES ($1, $2, $3, '草稿', 'scratch', false, 'cloud_only') ON CONFLICT (id) DO NOTHING`,
      [id, ownerUserId, node.device_id],
    );
    return id;
  }

  async function workspaces(ownerUserId: string): Promise<CcWorkspaceView[]> {
    const node = await nodeFor(ownerUserId);
    if (!node) return [];
    await ensureScratch(ownerUserId, node);
    const ws = await sql.unsafe<WorkspaceRow[]>("SELECT * FROM chisabot_cc_workspaces WHERE owner_user_id = $1 AND node_device_id = $2 ORDER BY (source = 'scratch') DESC, created_at", [ownerUserId, node.device_id]);
    const sessions = await sql.unsafe<SessionRow[]>(
      "SELECT * FROM chisabot_cc_sessions WHERE owner_user_id = $1 AND archived_at IS NULL ORDER BY COALESCE(last_turn_at, created_at) DESC",
      [ownerUserId],
    );
    return ws.map((w) => ({
      id: w.id,
      name: w.name,
      source: w.source as CcWorkspaceView["source"],
      sourceLabel: w.source === "scratch" ? "内置 · 只在云端" : w.source === "github" ? `GitHub · ${w.repo_full_name ?? ""}` : `电脑文件夹 · ${w.path ?? ""}`,
      repoFullName: w.repo_full_name,
      isGit: w.is_git,
      syncState: w.sync_state as CcSyncState,
      sessions: sessions.filter((s) => s.workspace_id === w.id).map(sessionView),
    }));
  }

  async function workspaceRow(ownerUserId: string, id: string) {
    const row = (await sql.unsafe<WorkspaceRow[]>("SELECT * FROM chisabot_cc_workspaces WHERE id = $1 AND owner_user_id = $2", [id, ownerUserId]))[0];
    if (!row) throw new CcError("没有这个工作区。", 404);
    return row;
  }
  async function sessionRow(ownerUserId: string, id: string) {
    const row = (await sql.unsafe<SessionRow[]>("SELECT * FROM chisabot_cc_sessions WHERE id = $1 AND owner_user_id = $2", [id, ownerUserId]))[0];
    if (!row) throw new CcError("没有这个会话。", 404);
    return row;
  }

  function defaultTitle() {
    const d = new Date(Date.now() + 8 * 3600_000);
    return `新会话 ${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }

  async function createSession(ownerUserId: string, workspaceId: string, input: { title?: string; model?: string | null; effort?: string | null }) {
    const ws = await workspaceRow(ownerUserId, workspaceId);
    const id = shortId("ccs");
    const title = (input.title ?? "").trim().slice(0, 80) || defaultTitle();
    await sql.unsafe("INSERT INTO chisabot_cc_sessions (id, owner_user_id, workspace_id, title, model, effort, tree_path) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      id,
      ownerUserId,
      ws.id,
      title,
      input.model || null,
      input.effort || null,
      `projects/${ws.id}/trees/${id}`,
    ]);
    await sql.unsafe("UPDATE chisabot_cc_workspaces SET last_used_at = now() WHERE id = $1", [ws.id]);
    await audit(ownerUserId, id, "session_created", { workspaceId: ws.id, title });
    return sessionView(await sessionRow(ownerUserId, id));
  }

  async function sessionDetail(ownerUserId: string, id: string) {
    const row = await sessionRow(ownerUserId, id);
    const messages = await sql.unsafe<MessageRow[]>("SELECT * FROM (SELECT * FROM chisabot_cc_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 400) t ORDER BY created_at", [id]);
    const turn = live.get(id);
    return {
      session: sessionView(row),
      messages: messages.map((m) => (turn && m.id === turn.message.id ? { ...turn.message, parts: turn.message.parts.map(stripRule) } : toMessage(m))),
      live: turn ? { seq: turn.seq, statusText: turn.statusText } : null,
    };
  }

  async function rulesFor(ownerUserId: string, sessionId: string, workspaceId: string) {
    const rows = await sql.unsafe<{ kind: string; value: string }[]>(
      "SELECT kind, value FROM chisabot_cc_permission_rules WHERE owner_user_id = $1 AND ((scope = 'session' AND scope_id = $2) OR (scope = 'workspace' AND scope_id = $3)) ORDER BY created_at LIMIT 200",
      [ownerUserId, sessionId, workspaceId],
    );
    return rows.map((r) => ({ kind: r.kind, value: r.value }));
  }

  async function startTurn(ownerUserId: string, sessionId: string, prompt: string) {
    const session = await sessionRow(ownerUserId, sessionId);
    const ws = await workspaceRow(ownerUserId, session.workspace_id);
    if (!hub.isOnline(ws.node_device_id)) throw new CcError("云端工作区不在线。", 409);
    const running = [...live.values()].filter((t) => t.ownerUserId === ownerUserId).length;
    if (running >= MAX_CONCURRENT) throw new CcError(`同时最多 ${MAX_CONCURRENT} 个会话在跑，等一个结束再发。`, 409);
    const turnId = shortId("cct");
    let claudeSessionId = session.claude_session_id;
    if (!claudeSessionId || !session.resumable) {
      claudeSessionId = randomUUID();
      await sql.unsafe("UPDATE chisabot_cc_sessions SET claude_session_id = $2 WHERE id = $1", [sessionId, claudeSessionId]);
    }
    const message: CcMessage = { id: shortId("ccm"), turnId, role: "assistant", parts: [], status: "running", meta: null, createdAt: new Date().toISOString() };
    await sql.unsafe("INSERT INTO chisabot_cc_messages (id, session_id, owner_user_id, turn_id, role, parts, status) VALUES ($1, $2, $3, $4, 'assistant', '[]'::jsonb, 'running')", [message.id, sessionId, ownerUserId, turnId]);
    const turn: LiveTurn = {
      sessionId,
      turnId,
      ownerUserId,
      deviceId: ws.node_device_id,
      workspaceId: ws.id,
      message,
      pendingText: [],
      statusText: "正在连接云端工作区",
      status: "running",
      seq: 0,
      startedAt: Date.now(),
      lastEventAt: Date.now(),
      stopRequested: false,
      approvalTimers: new Map(),
      dirty: false,
    };
    live.set(sessionId, turn);
    await sql.unsafe("UPDATE chisabot_cc_sessions SET status = 'running', updated_at = now() WHERE id = $1", [sessionId]);
    broadcast(sessionId, { op: "message", seq: turn.seq, message });
    const sent = hub.sendRaw(ws.node_device_id, {
      type: "cc_turn",
      sessionId,
      turnId,
      workspaceId: ws.id,
      prompt,
      claudeSessionId,
      resume: session.resumable,
      model: session.model,
      effort: session.effort,
      rules: await rulesFor(ownerUserId, sessionId, ws.id),
    });
    if (!sent) await finish(turn, { ok: false, error: "云端工作区不在线。" });
    await audit(ownerUserId, sessionId, "turn_started", { turnId, chars: prompt.length });
    return { turnId, messageId: message.id };
  }

  async function send(ownerUserId: string, sessionId: string, text: string) {
    const session = await sessionRow(ownerUserId, sessionId);
    if (session.archived_at) throw new CcError("这个会话已归档。", 409);
    const busy = live.has(sessionId);
    const user: CcMessage = { id: shortId("ccm"), turnId: null, role: "user", parts: [{ type: "text", text }], status: busy ? "queued" : "done", meta: null, createdAt: new Date().toISOString() };
    await sql.unsafe("INSERT INTO chisabot_cc_messages (id, session_id, owner_user_id, role, parts, status) VALUES ($1, $2, $3, 'user', $4::text::jsonb, $5)", [user.id, sessionId, ownerUserId, JSON.stringify(user.parts), user.status]);
    // 第一句话当标题（默认标题时）
    if (session.turns === 0 && /^新会话 \d/.test(session.title)) {
      await sql.unsafe("UPDATE chisabot_cc_sessions SET title = $2 WHERE id = $1", [sessionId, text.replace(/\s+/g, " ").trim().slice(0, 28) || session.title]);
    }
    broadcast(sessionId, { op: "message", seq: 0, message: user });
    if (busy) return { message: user, queued: true };
    try {
      const started = await startTurn(ownerUserId, sessionId, text);
      return { message: user, queued: false, ...started };
    } catch (error) {
      await sql.unsafe("DELETE FROM chisabot_cc_messages WHERE id = $1", [user.id]);
      throw error;
    }
  }

  async function stop(ownerUserId: string, sessionId: string) {
    await sessionRow(ownerUserId, sessionId);
    const turn = live.get(sessionId);
    if (!turn) return { stopped: false };
    turn.stopRequested = true;
    setStatus(turn, "running", "正在停止");
    const sent = hub.sendRaw(turn.deviceId, { type: "cc_stop", sessionId });
    // 节点 3 秒内没回（或不在线）：这边先结束，别让按钮一直转。
    turn.stopTimer = setTimeout(() => void finish(turn, { ok: false, stopped: true }), sent ? 3_000 : 0);
    unref(turn.stopTimer);
    // 排队的消息一起取消
    await sql.unsafe("UPDATE chisabot_cc_messages SET status = 'done' WHERE session_id = $1 AND status = 'queued'", [sessionId]);
    await audit(ownerUserId, sessionId, "turn_stop_requested");
    return { stopped: true };
  }

  async function addNotice(ownerUserId: string, sessionId: string, text: string) {
    const message: CcMessage = { id: shortId("ccm"), turnId: null, role: "system", parts: [{ type: "notice", text }], status: "done", meta: null, createdAt: new Date().toISOString() };
    await sql.unsafe("INSERT INTO chisabot_cc_messages (id, session_id, owner_user_id, role, parts, status) VALUES ($1, $2, $3, 'system', $4::text::jsonb, 'done')", [message.id, sessionId, ownerUserId, JSON.stringify(message.parts)]);
    broadcast(sessionId, { op: "message", seq: 0, message });
    return message;
  }

  async function newClaudeSession(ownerUserId: string, sessionId: string) {
    await sessionRow(ownerUserId, sessionId);
    if (live.has(sessionId)) throw new CcError("这一轮还在进行，先停止。", 409);
    await sql.unsafe("UPDATE chisabot_cc_sessions SET claude_session_id = NULL, resumable = false, updated_at = now() WHERE id = $1", [sessionId]);
    await audit(ownerUserId, sessionId, "claude_session_reset");
    return addNotice(ownerUserId, sessionId, "新的 Claude 会话：之前的对话不再带给 Claude（文件还在）。");
  }

  async function undoTurn(ownerUserId: string, sessionId: string) {
    const session = await sessionRow(ownerUserId, sessionId);
    const ws = await workspaceRow(ownerUserId, session.workspace_id);
    if (live.has(sessionId)) throw new CcError("这一轮还在进行，先停止。", 409);
    const last = (await sql.unsafe<MessageRow[]>("SELECT * FROM chisabot_cc_messages WHERE session_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 1", [sessionId]))[0];
    if (!last?.turn_id) throw new CcError("还没有可以撤销的一轮。", 409);
    if ((last.meta as { undone?: boolean } | null)?.undone) throw new CcError("最后一轮已经撤销过了。", 409);
    await rpc(ws.node_device_id, "undo", { workspaceId: ws.id, sessionId, turnId: last.turn_id });
    await sql.unsafe("UPDATE chisabot_cc_messages SET meta = COALESCE(meta, '{}'::jsonb) || '{\"undone\": true}'::jsonb WHERE id = $1", [last.id]);
    await audit(ownerUserId, sessionId, "turn_undone", { turnId: last.turn_id });
    return addNotice(ownerUserId, sessionId, "已撤销最后一轮对文件的改动（对话记录保留，Claude 记得它做过什么，可以告诉它已撤销）。");
  }

  async function patchSession(ownerUserId: string, sessionId: string, patch: { title?: string; model?: string | null; effort?: string | null; archived?: boolean }) {
    await sessionRow(ownerUserId, sessionId);
    if (patch.archived && live.has(sessionId)) throw new CcError("这一轮还在进行，先停止。", 409);
    if (patch.title !== undefined) await sql.unsafe("UPDATE chisabot_cc_sessions SET title = $2, updated_at = now() WHERE id = $1", [sessionId, patch.title.trim().slice(0, 80) || "未命名会话"]);
    if (patch.model !== undefined) await sql.unsafe("UPDATE chisabot_cc_sessions SET model = $2, updated_at = now() WHERE id = $1", [sessionId, patch.model || null]);
    if (patch.effort !== undefined) await sql.unsafe("UPDATE chisabot_cc_sessions SET effort = $2, updated_at = now() WHERE id = $1", [sessionId, patch.effort || null]);
    if (patch.archived !== undefined) await sql.unsafe("UPDATE chisabot_cc_sessions SET archived_at = $2, updated_at = now() WHERE id = $1", [sessionId, patch.archived ? new Date().toISOString() : null]);
    return sessionView(await sessionRow(ownerUserId, sessionId));
  }

  async function sessionNode(ownerUserId: string, sessionId: string) {
    const session = await sessionRow(ownerUserId, sessionId);
    const ws = await workspaceRow(ownerUserId, session.workspace_id);
    if (!hub.isOnline(ws.node_device_id)) throw new CcError("云端工作区不在线。", 409);
    return { session, ws };
  }

  // ── 在云端完成登录（远程浏览器） ───────────────────────────────────────

  function browserBroadcast(loginId: string, op: CcBrowserOp) {
    if (op.op === "frame") lastFrame.set(loginId, op);
    for (const fn of browserSubs.get(loginId) ?? []) {
      try {
        fn(op);
      } catch {}
    }
  }

  async function onBrowser(record: DeviceRecord, message: Json) {
    const loginId = String(message.loginId ?? "");
    const login = logins.get(loginId);
    if (!login || login.deviceId !== record.id) return;
    if (message.type === "cc_browser_frame") {
      if (typeof message.data !== "string" || message.data.length > 2_500_000) return;
      browserBroadcast(loginId, { op: "frame", data: message.data, w: Number(message.w) || 0, h: Number(message.h) || 0 });
      return;
    }
    if (message.type === "cc_browser_state") {
      const egress = message.egress as { browser?: unknown; node?: unknown; match?: unknown; viaProxy?: unknown } | undefined;
      browserBroadcast(loginId, {
        op: "state",
        ...(typeof message.url === "string" ? { url: message.url.slice(0, 300) } : {}),
        ...(message.captured ? { captured: true } : {}),
        ...(typeof message.popup === "boolean" ? { popup: message.popup } : {}),
        ...(message.closed ? { closed: true, reason: String(message.reason ?? "").slice(0, 100) } : {}),
        ...(egress
          ? { egress: { browser: typeof egress.browser === "string" ? egress.browser.slice(0, 64) : null, node: typeof egress.node === "string" ? egress.node.slice(0, 64) : null, match: egress.match === true, viaProxy: egress.viaProxy === true } }
          : {}),
      });
      if (egress) await audit(login.ownerUserId, null, "claude_login_browser_egress", { browser: egress.browser ?? null, node: egress.node ?? null, match: egress.match === true, viaProxy: egress.viaProxy === true });
      return;
    }
    // cc_browser_done：节点已经把授权码交给 claude 了，这里只记结果
    logins.delete(loginId);
    const auth = await saveAuth(record.id, message);
    const ok = !!message.ok && auth.loggedIn;
    await audit(login.ownerUserId, null, ok ? "claude_login_succeeded" : "claude_login_failed", { via: "cloud_browser", reason: ok ? null : String(message.error ?? "").slice(0, 200) });
    browserBroadcast(loginId, { op: "done", ok, error: ok ? null : String(message.error ?? "登录没有成功").slice(0, 300), claude: auth });
    setTimeout(() => lastFrame.delete(loginId), 5000);
  }

  async function browserLoginStart(ownerUserId: string, view: { width?: number; height?: number; mobile?: boolean }) {
    const node = await onlineNode(ownerUserId);
    if (!(node.info as { browser?: boolean } | null)?.browser) throw new CcError("云端节点的镜像里还没有浏览器：更新云端节点后才能在云端完成登录。可以先用「粘贴授权码」。", 409);
    const start = await loginStart(ownerUserId);
    try {
      const r = await rpc<{ width: number; height: number }>(node.device_id, "browser_start", { id: start.id, width: view.width, height: view.height, mobile: !!view.mobile }, 45_000);
      await audit(ownerUserId, null, "claude_login_browser_started");
      return { id: start.id, expiresAt: start.expiresAt, width: r.width, height: r.height };
    } catch (error) {
      await loginCancel(ownerUserId, start.id).catch(() => {});
      throw error;
    }
  }

  // ── Claude 上游代理 ─────────────────────────────────────────────────

  async function proxyValue(ownerUserId: string): Promise<string | null> {
    if (!vault) return null;
    const secret = await vault.internal.reveal(ownerUserId, PROXY_SECRET).catch(() => null);
    return secret?.value ?? null;
  }

  async function proxyView(ownerUserId: string) {
    const value = await proxyValue(ownerUserId);
    return { configured: !!value, masked: value ? maskProxyUrl(value) : null };
  }

  async function setProxy(ownerUserId: string, url: string | null) {
    if (!vault) throw new CcError("保险箱不可用。", 503);
    if (url) {
      if (!parseProxyUrl(url)) throw new CcError("代理地址不对：写成 http://、https:// 或 socks5://主机:端口，可以带 用户名:密码@。");
      await vault.internal.save(ownerUserId, { name: PROXY_SECRET, label: "Claude 上游代理", domains: PROXY_DOMAINS, value: url.trim() });
    } else await vault.internal.remove(ownerUserId, PROXY_SECRET);
    const node = await nodeFor(ownerUserId);
    let applied = false;
    let running = 0;
    if (node && hub.isOnline(node.device_id)) {
      const r = await rpc<{ running?: number }>(node.device_id, "proxy_set", { url: url ? url.trim() : null }, 15_000).catch(() => null);
      applied = !!r;
      running = Number(r?.running ?? 0);
    }
    await audit(ownerUserId, null, url ? "claude_proxy_set" : "claude_proxy_cleared", url ? { proxy: maskProxyUrl(url) } : null);
    return { ...(await proxyView(ownerUserId)), applied, running };
  }

  async function testProxy(ownerUserId: string, url: string | null | undefined): Promise<CcProxyTest> {
    const node = await onlineNode(ownerUserId);
    if (url && !parseProxyUrl(url)) throw new CcError("代理地址不对：写成 http://、https:// 或 socks5://主机:端口，可以带 用户名:密码@。");
    // url 没给：测已保存的（没保存就是机房默认出口）
    const target = url ? url.trim() : await proxyValue(ownerUserId);
    const r = await rpc<CcProxyTest>(node.device_id, "proxy_test", { url: target ?? null }, 45_000);
    return { ok: !!r.ok, ip: r.ip ?? null, claudeAi: r.claudeAi ?? null, anthropicApi: r.anthropicApi ?? null, ms: r.ms ?? null, error: r.error ?? null };
  }

  // ── 云端工作区 / Claude 登录 ──────────────────────────────────────────

  async function status(ownerUserId: string): Promise<CloudWorkspaceView> {
    const row = await nodeFor(ownerUserId);
    if (!row) return { node: null, claude: EMPTY_AUTH, running: 0, maxConcurrent: MAX_CONCURRENT, browserLogin: false, proxy: { configured: false, masked: null } };
    const device = await deviceStore.get(row.device_id).catch(() => null);
    const info = (row.info ?? {}) as { claudeVersion?: string | null; browser?: boolean };
    return {
      node: device
        ? { deviceId: device.id, name: device.name, online: hub.isOnline(device.id), claudeVersion: info.claudeVersion ?? null, lastSeenAt: device.lastSeenAt }
        : null,
      claude: row.claude_auth ?? EMPTY_AUTH,
      running: [...live.values()].filter((t) => t.ownerUserId === ownerUserId).length,
      maxConcurrent: MAX_CONCURRENT,
      browserLogin: info.browser === true,
      proxy: await proxyView(ownerUserId),
    };
  }

  async function loginStart(ownerUserId: string) {
    const node = await onlineNode(ownerUserId);
    const id = randomUUID();
    const result = await rpc<{ url?: string; expiresInMs?: number }>(node.device_id, "login_start", { id }, RPC_MS);
    const scheme = process.env.CHISABOT_CC_ALLOW_HTTP_AUTH === "1" ? /^https?:\/\// : /^https:\/\//; // http 只给 e2e 的模拟授权页
    if (!result.url || !scheme.test(result.url)) throw new CcError("没有拿到 Claude 授权地址。", 503);
    const expiresAt = Date.now() + (result.expiresInMs ?? 600_000);
    for (const [key, value] of logins) if (value.ownerUserId === ownerUserId) logins.delete(key);
    logins.set(id, { deviceId: node.device_id, ownerUserId, expiresAt });
    await audit(ownerUserId, null, "claude_login_started");
    return { id, url: result.url, expiresAt: new Date(expiresAt).toISOString() };
  }

  async function loginCode(ownerUserId: string, id: string, code: string) {
    const login = logins.get(id);
    if (!login || login.ownerUserId !== ownerUserId) throw new CcError("登录流程已经过期，请重新开始。", 409);
    if (Date.now() > login.expiresAt) {
      logins.delete(id);
      throw new CcError("登录流程已经过期（10 分钟），请重新开始。", 409);
    }
    const result = await rpc<ClaudeAuth & { ok?: boolean; error?: string }>(login.deviceId, "login_code", { id, code }, LOGIN_CODE_MS);
    logins.delete(id);
    const auth = await saveAuth(login.deviceId, result);
    await audit(ownerUserId, null, result.ok ? "claude_login_succeeded" : "claude_login_failed", { reason: result.ok ? null : String(result.error ?? "").slice(0, 200) });
    return { ok: !!result.ok, error: result.ok ? null : (result.error ?? "登录没有成功"), claude: auth };
  }

  async function loginCancel(ownerUserId: string, id: string) {
    const login = logins.get(id);
    logins.delete(id);
    if (login && login.ownerUserId === ownerUserId && hub.isOnline(login.deviceId)) {
      await rpc(login.deviceId, "browser_stop", { id }, 15_000).catch(() => {});
      await rpc(login.deviceId, "login_cancel", {}, 15_000).catch(() => {});
    }
    browserBroadcast(id, { op: "state", closed: true, reason: "取消" });
    lastFrame.delete(id);
    return { cancelled: true };
  }

  async function logout(ownerUserId: string) {
    const node = await onlineNode(ownerUserId);
    const result = await rpc<ClaudeAuth>(node.device_id, "logout", {}, RPC_MS);
    await audit(ownerUserId, null, "claude_logout");
    return { claude: await saveAuth(node.device_id, result) };
  }

  async function check(ownerUserId: string) {
    const node = await onlineNode(ownerUserId);
    const result = await rpc<ClaudeAuth>(node.device_id, "status", {}, RPC_MS);
    return { claude: await saveAuth(node.device_id, result) };
  }

  async function emergencyStop(ownerUserId: string) {
    for (const turn of [...live.values()]) if (turn.ownerUserId === ownerUserId) await stop(ownerUserId, turn.sessionId);
  }

  // ── 接口 ──────────────────────────────────────────────────────────────

  const sendBody = z.object({ text: z.string().trim().min(1, "说点什么。").max(20_000, "太长了（最多 2 万字）。") });
  const sessionBody = z.object({ title: z.string().max(200).optional(), model: z.string().max(60).nullable().optional(), effort: z.enum(CC_EFFORTS).nullable().optional() });
  const patchBody = z.object({
    title: z.string().max(200).optional(),
    model: z.string().max(60).nullable().optional(),
    effort: z.enum(CC_EFFORTS).nullable().optional(),
    archived: z.boolean().optional(),
  });
  const approvalBody = z.object({ decision: z.enum(["approve", "deny"]), always: z.boolean().optional() });
  const codeBody = z.object({ code: z.string().trim().min(1, "粘贴授权码。").max(4000) });
  const browserBody = z.object({ width: z.number().int().min(320).max(1280).optional(), height: z.number().int().min(400).max(1000).optional(), mobile: z.boolean().optional() });
  const inputBody = z.object({ events: z.array(z.record(z.string(), z.unknown())).max(200) });
  const proxyBody = z.object({ url: z.string().trim().min(1, "填代理地址。").max(500) });
  const proxyTestBody = z.object({ url: z.string().trim().max(500).nullable().optional() });

  function guard(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireUser, bodyLimit({ maxSize: 96_000 }), async (c, next) => {
      if (c.var.actor.role !== "admin") return c.json({ error: "只有管理员能用云端 Claude Code。" }, 403);
      await next();
    });
    app.onError((error, c) => {
      if (error instanceof CcError) return c.json({ error: error.message }, error.status);
      if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "参数不对。" }, 400);
      console.error(JSON.stringify({ type: "cloud-cc-error", error: error.name, message: String(error.message).slice(0, 200), route: c.req.path }));
      return c.json({ error: "云端 Claude Code 暂时不可用，请重试。" }, 503);
    });
    return app;
  }

  /** /api/cloud-workspace */
  function workspaceRoutes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = guard(requireUser);
    app.get("/", async (c) => c.json(await status(c.var.actor.id)));
    app.post("/claude/login", async (c) => c.json(await loginStart(c.var.actor.id)));
    app.post("/claude/login/:id/code", async (c) => {
      const { code } = codeBody.parse(await c.req.json().catch(() => ({})));
      return c.json(await loginCode(c.var.actor.id, c.req.param("id"), code));
    });
    app.delete("/claude/login/:id", async (c) => c.json(await loginCancel(c.var.actor.id, c.req.param("id"))));
    app.post("/claude/login/browser", async (c) => c.json(await browserLoginStart(c.var.actor.id, browserBody.parse(await c.req.json().catch(() => ({}))))));
    app.post("/claude/login/browser/:id/input", async (c) => {
      const id = c.req.param("id");
      const login = logins.get(id);
      if (!login || login.ownerUserId !== c.var.actor.id) return c.json({ error: "登录流程已经结束。" }, 409);
      const { events } = inputBody.parse(await c.req.json().catch(() => ({})));
      hub.sendRaw(login.deviceId, { type: "cc_browser_input", loginId: id, events });
      return c.json({ ok: true });
    });
    app.get("/claude/login/browser/:id/stream", async (c) => {
      const id = c.req.param("id");
      const login = logins.get(id);
      if (!login || login.ownerUserId !== c.var.actor.id) return c.json({ error: "登录流程已经结束。" }, 409);
      const encoder = new TextEncoder();
      let cleanup = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (op: CcBrowserOp | { op: "ping" }) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(op)}\n\n`));
            } catch {
              cleanup();
            }
          };
          const first = lastFrame.get(id);
          if (first) write(first);
          let set = browserSubs.get(id);
          if (!set) {
            set = new Set();
            browserSubs.set(id, set);
          }
          set.add(write);
          const ping = setInterval(() => write({ op: "ping" }), 20_000);
          unref(ping);
          cleanup = () => {
            clearInterval(ping);
            set!.delete(write);
            if (!set!.size) browserSubs.delete(id);
          };
          c.req.raw.signal.addEventListener("abort", () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" } });
    });
    app.get("/claude/proxy", async (c) => c.json(await proxyView(c.var.actor.id)));
    app.put("/claude/proxy", async (c) => c.json(await setProxy(c.var.actor.id, proxyBody.parse(await c.req.json().catch(() => ({}))).url)));
    app.delete("/claude/proxy", async (c) => c.json(await setProxy(c.var.actor.id, null)));
    app.post("/claude/proxy/test", async (c) => c.json(await testProxy(c.var.actor.id, proxyTestBody.parse(await c.req.json().catch(() => ({}))).url)));
    app.post("/claude/logout", async (c) => c.json(await logout(c.var.actor.id)));
    app.post("/claude/check", async (c) => c.json(await check(c.var.actor.id)));
    app.get("/permission-rules", async (c) => {
      const rows = await sql.unsafe<{ id: string; scope: string; scope_id: string; kind: string; value: string; created_at: Date; title: string | null }[]>(
        "SELECT r.*, s.title FROM chisabot_cc_permission_rules r LEFT JOIN chisabot_cc_sessions s ON s.id = r.scope_id WHERE r.owner_user_id = $1 ORDER BY r.created_at DESC LIMIT 200",
        [c.var.actor.id],
      );
      return c.json({ rules: rows.map((r) => ({ id: r.id, scope: r.scope, scopeId: r.scope_id, scopeTitle: r.title, kind: r.kind, value: r.value, createdAt: iso(r.created_at) })) });
    });
    app.delete("/permission-rules/:id", async (c) => {
      await sql.unsafe("DELETE FROM chisabot_cc_permission_rules WHERE id = $1 AND owner_user_id = $2", [c.req.param("id"), c.var.actor.id]);
      return c.json({ deleted: true });
    });
    app.get("/activity", async (c) => {
      const rows = await sql.unsafe<{ id: string; session_id: string | null; kind: string; detail: Json | null; at: Date }[]>(
        "SELECT id, session_id, kind, detail, at FROM chisabot_cc_events WHERE owner_user_id = $1 ORDER BY at DESC LIMIT 100",
        [c.var.actor.id],
      );
      return c.json({ events: rows.map((r) => ({ id: String(r.id), sessionId: r.session_id, kind: r.kind, detail: r.detail, at: iso(r.at) })) });
    });
    return app;
  }

  /** /api/claude-code */
  function codeRoutes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = guard(requireUser);
    app.get("/workspaces", async (c) => c.json({ workspaces: await workspaces(c.var.actor.id) }));
    app.post("/workspaces/:id/sessions", async (c) => c.json({ session: await createSession(c.var.actor.id, c.req.param("id"), sessionBody.parse(await c.req.json().catch(() => ({})))) }));
    app.get("/sessions/:id", async (c) => c.json(await sessionDetail(c.var.actor.id, c.req.param("id"))));
    app.patch("/sessions/:id", async (c) => c.json({ session: await patchSession(c.var.actor.id, c.req.param("id"), patchBody.parse(await c.req.json().catch(() => ({})))) }));
    app.post("/sessions/:id/messages", async (c) => {
      const { text } = sendBody.parse(await c.req.json().catch(() => ({})));
      return c.json(await send(c.var.actor.id, c.req.param("id"), text));
    });
    app.post("/sessions/:id/stop", async (c) => c.json(await stop(c.var.actor.id, c.req.param("id"))));
    app.post("/sessions/:id/new-claude-session", async (c) => c.json({ message: await newClaudeSession(c.var.actor.id, c.req.param("id")) }));
    app.post("/sessions/:id/undo-turn", async (c) => c.json({ message: await undoTurn(c.var.actor.id, c.req.param("id")) }));
    app.post("/approvals/:id", async (c) => {
      const body = approvalBody.parse(await c.req.json().catch(() => ({})));
      return c.json(await decideApproval(c.var.actor.id, c.req.param("id"), body.decision, !!body.always));
    });
    app.get("/sessions/:id/files", async (c) => {
      const { session, ws } = await sessionNode(c.var.actor.id, c.req.param("id"));
      return c.json(await rpc(ws.node_device_id, "tree", { workspaceId: ws.id, sessionId: session.id, path: c.req.query("path") ?? "" }));
    });
    app.get("/sessions/:id/file", async (c) => {
      const { session, ws } = await sessionNode(c.var.actor.id, c.req.param("id"));
      return c.json(await rpc(ws.node_device_id, "read", { workspaceId: ws.id, sessionId: session.id, path: c.req.query("path") ?? "" }));
    });
    app.get("/sessions/:id/diff", async (c) => {
      const { session, ws } = await sessionNode(c.var.actor.id, c.req.param("id"));
      return c.json(await rpc(ws.node_device_id, "diff", { workspaceId: ws.id, sessionId: session.id, turnId: c.req.query("turn") || null }));
    });
    app.get("/sessions/:id/stream", async (c) => {
      const actorId = c.var.actor.id;
      const sessionId = c.req.param("id");
      const row = await sessionRow(actorId, sessionId);
      const encoder = new TextEncoder();
      let cleanup = () => {};
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const write = (op: CcStreamOp | { op: "ping" }) => {
            try {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(op)}\n\n`));
            } catch {
              cleanup();
            }
          };
          const turn = live.get(sessionId);
          write({ op: "snapshot", seq: turn?.seq ?? 0, message: turn ? { ...turn.message, parts: turn.message.parts.map(stripRule) } : null, status: turn ? turn.status : (row.status as CcSessionStatus), statusText: turn?.statusText ?? null });
          const fn: Subscriber = (op) => {
            if (op.op === "part") write({ ...op, part: stripRule(op.part) });
            else if (op.op === "done" || op.op === "message") write({ ...op, message: { ...op.message, parts: op.message.parts.map(stripRule) } });
            else write(op);
          };
          let set = subscribers.get(sessionId);
          if (!set) {
            set = new Set();
            subscribers.set(sessionId, set);
          }
          set.add(fn);
          const ping = setInterval(() => write({ op: "ping" }), 20_000);
          unref(ping);
          cleanup = () => {
            clearInterval(ping);
            set!.delete(fn);
            if (!set!.size) subscribers.delete(sessionId);
          };
          c.req.raw.signal.addEventListener("abort", () => {
            cleanup();
            try {
              controller.close();
            } catch {}
          });
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          "x-accel-buffering": "no",
          connection: "keep-alive",
        },
      });
    });
    return app;
  }

  /** 设备路由用：云端工作区永远不能开完全访问。 */
  function refuseFullAccess(deviceId: string): string | null {
    return nodes.has(deviceId) ? "云端工作区不能开完全访问（只读白名单 + 审批卡，见 设置 → 云端工作区）。" : null;
  }

  return {
    ensure,
    recover,
    extension,
    workspaceRoutes,
    codeRoutes,
    refuseFullAccess,
    emergencyStop,
    isCloudNode: (deviceId: string) => nodes.has(deviceId),
    // 测试用
    _internal: { live, nodes, startTurn, send, decideApproval, workspaces, createSession, status },
  };
}
