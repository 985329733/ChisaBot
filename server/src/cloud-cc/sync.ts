import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppVariables } from "../auth/guards";
import type { Database } from "../db/client";
import type { DeviceHub } from "../devices/hub";
import type { DeviceRecord, DeviceStore } from "../devices/store";

/**
 * 电脑文件夹同步（P4a，docs/cloud-claude-code.md §4–§5.4，DESIGN.md §73.9）：服务器这一侧。
 *
 *  - 绑定：一个工作区最多一台电脑「开着同步」（chisabot_cc_sync_bindings.enabled）。电脑登记 ed25519 公钥，节点把
 *    每个有效绑定写进同步边车的 authorized_keys（restrict + command=chisabot-sync-gate）。
 *  - 租约：谁能写工作目录 work/ 以 chisabot_cc_leases 为准（cloud / pc / syncing / handoff / conflict），节点上再记一份。
 *    合入工作目录、删工作区在 service.ts 里按 chisabot_cc_workspaces.sync_state 拦（cloud_only / paused 才行）。
 *  - 隧道：电脑用设备令牌换一次性隧道票（60 秒、用一次、绑定设备 + 工作区 + 绑定代号）→ 开 WSS
 *    /api/devices/agent/sync-tunnel?ticket=… → 服务器让节点开一条回来的 WSS（?tunnel=…）→ 两边二进制帧直接对接。
 *    主机上没有新端口；撤销设备、强制收回、交还都会断开这台电脑的隧道。每条隧道写审计（字节数，不含内容）。
 *
 * 电脑这边（PC 客户端，P4b）走设备令牌的 HTTP 接口 /api/devices/agent/sync/*；网页、手机只读 + 电脑离线时强制收回。
 */

export type SyncState = "cloud_only" | "syncing" | "pc_active" | "paused" | "conflict";
type Json = Record<string, unknown>;

class SyncError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
  }
}

type WorkspaceRow = { id: string; owner_user_id: string; node_device_id: string; name: string; source: string; sync_state: string; path: string | null };
type BindingRow = {
  id: string;
  owner_user_id: string;
  workspace_id: string;
  pc_device_id: string;
  local_path_label: string | null;
  pub_key: string;
  ssh_key_fpr: string;
  binding_epoch: number;
  enabled: boolean;
  last_synced_at: Date | null;
  last_state: string | null;
  last_detail: string | null;
  updated_at: Date;
};
type LeaseRow = { workspace_id: string; holder: string; holder_device_id: string | null; handoff_id: string | null; binding_epoch: number; since: Date };

/** 和 WebSocket 适配器之间的最小接口（测试里用假的）。 */
export type TunnelSocket = { send: (data: Uint8Array) => void; close: (code?: number, reason?: string) => void };

type Ticket = { deviceId: string; ownerUserId: string; workspaceId: string; bindingId: string; nodeDeviceId: string; expiresAt: number };
type Tunnel = {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  bindingId: string;
  pcDeviceId: string;
  nodeDeviceId: string;
  pc: TunnelSocket;
  node: TunnelSocket | null;
  backlog: Uint8Array[];
  backlogBytes: number;
  up: number;
  down: number;
  openedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const TICKET_MS = 60_000;
const NODE_CONNECT_MS = 15_000;
const BACKLOG_CAP = 4 * 1024 * 1024;
const KEY_RE = /^ssh-ed25519 [A-Za-z0-9+/=]{60,120}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MOBILE = /^(android|ios)$/i;

function unref(timer: ReturnType<typeof setTimeout>) {
  if (typeof timer === "object" && timer && "unref" in timer) (timer as { unref: () => void }).unref();
}

export function keyFingerprint(pubKey: string) {
  const b64 = pubKey.trim().split(/\s+/)[1] ?? "";
  return `SHA256:${createHash("sha256").update(Buffer.from(b64, "base64")).digest("base64").replace(/=+$/, "")}`;
}

export function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return null;
}

export type CloudSyncOptions = {
  database: Database;
  hub: Pick<DeviceHub, "isOnline" | "sendRaw">;
  deviceStore: Pick<DeviceStore, "get">;
  /** service.ts 的 cc_rpc（节点上的 sync_* / ws_init_local / ws_manifest）。 */
  nodeRpc: <T = Json>(deviceId: string, op: string, args?: Json, timeoutMs?: number) => Promise<T>;
  /** 这个人的云端工作区节点（没有就 null）。 */
  nodeFor: (ownerUserId: string) => Promise<{ device_id: string } | null>;
  now?: () => number;
};

export type CloudSyncService = ReturnType<typeof createCloudSyncService>;

export function createCloudSyncService(options: CloudSyncOptions) {
  const { database, hub, deviceStore, nodeRpc } = options;
  const sql = database.$client;
  const now = options.now ?? (() => Date.now());
  const tickets = new Map<string, Ticket>();
  const tunnels = new Map<string, Tunnel>();

  async function ensure() {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS chisabot_cc_sync_bindings (
        id text PRIMARY KEY,
        owner_user_id text NOT NULL,
        workspace_id text NOT NULL,
        pc_device_id text NOT NULL,
        local_path_label text,
        pub_key text NOT NULL,
        ssh_key_fpr text NOT NULL,
        binding_epoch integer NOT NULL DEFAULT 1,
        enabled boolean NOT NULL DEFAULT false,
        ignore_rules jsonb,
        last_synced_at timestamptz,
        last_state text,
        last_detail text,
        paused_manifest_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS chisabot_cc_sync_bindings_ws_dev ON chisabot_cc_sync_bindings (workspace_id, pc_device_id);
      CREATE TABLE IF NOT EXISTS chisabot_cc_leases (
        workspace_id text PRIMARY KEY,
        holder text NOT NULL DEFAULT 'cloud',
        holder_device_id text,
        handoff_id text,
        binding_epoch integer NOT NULL DEFAULT 0,
        since timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS chisabot_cc_sync_events (
        id bigserial PRIMARY KEY,
        owner_user_id text NOT NULL,
        workspace_id text NOT NULL,
        kind text NOT NULL,
        handoff_id text,
        detail jsonb,
        at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS chisabot_cc_sync_events_ws ON chisabot_cc_sync_events (workspace_id, at);
      CREATE TABLE IF NOT EXISTS chisabot_cc_sync_conflicts (
        id text PRIMARY KEY,
        binding_id text NOT NULL,
        workspace_id text NOT NULL,
        path text NOT NULL,
        cloud_meta jsonb,
        pc_meta jsonb,
        resolution text,
        created_at timestamptz NOT NULL DEFAULT now(),
        resolved_at timestamptz
      );
    `);
  }

  /** 重启：内存里的隧道都没了；「同步中」不会自己结束，按交接规则记成冲突（等电脑上线重新对一遍）。 */
  async function recover() {
    const rows = await sql.unsafe<{ id: string; owner_user_id: string }[]>("SELECT id, owner_user_id FROM chisabot_cc_workspaces WHERE sync_state = 'syncing'");
    for (const r of rows) await event(r.owner_user_id, r.id, "recover", null, { note: "服务器重启时还在同步中，等电脑上线后重新对比" });
    return rows.length;
  }

  async function event(ownerUserId: string, workspaceId: string, kind: string, handoffId: string | null = null, detail: Json | null = null) {
    await sql
      .unsafe("INSERT INTO chisabot_cc_sync_events (owner_user_id, workspace_id, kind, handoff_id, detail) VALUES ($1, $2, $3, $4, $5::text::jsonb)", [
        ownerUserId,
        workspaceId,
        kind,
        handoffId,
        detail ? JSON.stringify(detail) : null,
      ])
      .catch(() => {});
  }

  async function workspaceFor(ownerUserId: string, workspaceId: string) {
    if (!ID_RE.test(workspaceId)) throw new SyncError("工作区 id 不对。");
    const row = (await sql.unsafe<WorkspaceRow[]>("SELECT * FROM chisabot_cc_workspaces WHERE id = $1 AND owner_user_id = $2", [workspaceId, ownerUserId]))[0];
    if (!row) throw new SyncError("没有这个工作区。", 404);
    if (row.source === "scratch") throw new SyncError("内置的「草稿」工作区只在云端，不能同步到电脑。");
    return row;
  }

  async function bindingOf(workspaceId: string, deviceId: string) {
    return (await sql.unsafe<BindingRow[]>("SELECT * FROM chisabot_cc_sync_bindings WHERE workspace_id = $1 AND pc_device_id = $2", [workspaceId, deviceId]))[0] ?? null;
  }
  async function activeBinding(workspaceId: string) {
    return (await sql.unsafe<BindingRow[]>("SELECT * FROM chisabot_cc_sync_bindings WHERE workspace_id = $1 AND enabled ORDER BY updated_at DESC LIMIT 1", [workspaceId]))[0] ?? null;
  }
  async function lease(workspaceId: string): Promise<LeaseRow> {
    return (
      (await sql.unsafe<LeaseRow[]>("SELECT * FROM chisabot_cc_leases WHERE workspace_id = $1", [workspaceId]))[0] ?? {
        workspace_id: workspaceId,
        holder: "cloud",
        holder_device_id: null,
        handoff_id: null,
        binding_epoch: 0,
        since: new Date(0),
      }
    );
  }

  async function setState(ws: WorkspaceRow, state: SyncState, holder: string, holderDeviceId: string | null, epoch: number, handoffId: string | null = null) {
    await sql.unsafe("UPDATE chisabot_cc_workspaces SET sync_state = $2 WHERE id = $1", [ws.id, state]);
    await sql.unsafe(
      `INSERT INTO chisabot_cc_leases (workspace_id, holder, holder_device_id, handoff_id, binding_epoch, since) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (workspace_id) DO UPDATE SET holder = EXCLUDED.holder, holder_device_id = EXCLUDED.holder_device_id, handoff_id = EXCLUDED.handoff_id, binding_epoch = EXCLUDED.binding_epoch, since = now()`,
      [ws.id, holder, holderDeviceId, handoffId, epoch],
    );
    // 节点上的第二道闸：离线时只记服务器这边（节点上线前也不会有写 work/ 的操作，合入要求节点在线）
    if (hub.isOnline(ws.node_device_id)) await nodeRpc(ws.node_device_id, "sync_lease", { workspaceId: ws.id, holder, handoffId, epoch }).catch(() => null);
  }

  /** 节点上的 authorized_keys 整份重写：这个节点上所有开着的绑定。 */
  async function pushKeys(nodeDeviceId: string) {
    const rows = await sql.unsafe<{ workspace_id: string; id: string; pub_key: string }[]>(
      `SELECT b.workspace_id, b.id, b.pub_key FROM chisabot_cc_sync_bindings b JOIN chisabot_cc_workspaces w ON w.id = b.workspace_id
       WHERE b.enabled AND w.node_device_id = $1`,
      [nodeDeviceId],
    );
    if (!hub.isOnline(nodeDeviceId)) return false;
    await nodeRpc(nodeDeviceId, "sync_keys_set", { keys: rows.map((r) => ({ workspaceId: r.workspace_id, bindingId: r.id, pubKey: r.pub_key })) });
    return true;
  }

  function closeTunnels(filter: (t: Tunnel) => boolean, why: string) {
    let n = 0;
    for (const t of [...tunnels.values()]) {
      if (!filter(t)) continue;
      n++;
      endTunnel(t, why);
    }
    return n;
  }

  function assertPc(device: DeviceRecord) {
    if (device.revoked) throw new SyncError("这台设备已被撤销。", 403);
    if (device.paused) throw new SyncError("这台电脑在紧急停止中，先在网页上解除。", 409);
    if (MOBILE.test(device.platform)) throw new SyncError("手机不能同步文件夹。", 403);
  }

  // ── 电脑（设备令牌） ─────────────────────────────────────────────────

  /** 「电脑上的文件夹」新建（图 2 右）：云端建一个空的 work/，工作区来源 local。 */
  async function createLocalWorkspace(device: DeviceRecord, input: { name: string; label?: string | null }) {
    assertPc(device);
    const node = await options.nodeFor(device.ownerUserId);
    if (!node) throw new SyncError("还没有云端工作区节点。", 409);
    if (!hub.isOnline(node.device_id)) throw new SyncError("云端工作区不在线。", 409);
    const id = `ws_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    // 先在节点上建好 work/，成功了再记数据库（节点出错时不留半个工作区）
    await nodeRpc(node.device_id, "ws_init_local", { workspaceId: id });
    await nodeRpc(node.device_id, "sync_lease", { workspaceId: id, holder: "cloud", epoch: 0 });
    await sql.unsafe(
      "INSERT INTO chisabot_cc_workspaces (id, owner_user_id, node_device_id, name, source, is_git, path, sync_state) VALUES ($1, $2, $3, $4, 'local', false, $5, 'paused')",
      [id, device.ownerUserId, node.device_id, input.name, input.label ?? null],
    );
    await event(device.ownerUserId, id, "created", null, { device: device.id, source: "local" });
    return { id, name: input.name, source: "local", syncState: "paused" as SyncState };
  }

  /** 开启同步：登记公钥，节点写 authorized_keys，返回边车主机公钥（电脑端固定主机身份）和工作目录路径。 */
  async function bind(device: DeviceRecord, input: { workspaceId: string; pubKey: string; label?: string | null }) {
    assertPc(device);
    const ws = await workspaceFor(device.ownerUserId, input.workspaceId);
    const pubKey = input.pubKey.trim().split(/\s+/).slice(0, 2).join(" ");
    if (!KEY_RE.test(pubKey)) throw new SyncError("公钥要是 ssh-ed25519。");
    if (!hub.isOnline(ws.node_device_id)) throw new SyncError("云端工作区不在线。", 409);
    const other = await activeBinding(ws.id);
    if (other && other.pc_device_id !== device.id) {
      const otherDevice = await deviceStore.get(other.pc_device_id).catch(() => null);
      throw new SyncError(`「${otherDevice?.name ?? "另一台电脑"}」正在同步这个工作区。先在那台电脑上「交还云端」，它离线的话在网页上「强制收回」。`, 409);
    }
    if (ws.sync_state === "conflict") throw new SyncError("这个工作区有没处理完的冲突，先在电脑上处理。", 409);
    const existing = await bindingOf(ws.id, device.id);
    const fpr = keyFingerprint(pubKey);
    let row: BindingRow;
    if (existing) {
      row = (
        await sql.unsafe<BindingRow[]>(
          "UPDATE chisabot_cc_sync_bindings SET pub_key = $2, ssh_key_fpr = $3, local_path_label = COALESCE($4, local_path_label), binding_epoch = binding_epoch + 1, enabled = true, last_state = 'syncing', updated_at = now() WHERE id = $1 RETURNING *",
          [existing.id, pubKey, fpr, input.label ?? null],
        )
      )[0]!;
    } else {
      row = (
        await sql.unsafe<BindingRow[]>(
          "INSERT INTO chisabot_cc_sync_bindings (id, owner_user_id, workspace_id, pc_device_id, local_path_label, pub_key, ssh_key_fpr, binding_epoch, enabled, last_state) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, true, 'syncing') RETURNING *",
          [`sb_${randomUUID().replace(/-/g, "").slice(0, 20)}`, device.ownerUserId, ws.id, device.id, input.label ?? null, pubKey, fpr],
        )
      )[0]!;
    }
    await pushKeys(ws.node_device_id);
    const host = await nodeRpc<{ hostKey: string; workPath: string }>(ws.node_device_id, "sync_host_key", { workspaceId: ws.id });
    // 同步中：这一步自己持有租约，谁都不能写 work/（§4.2）
    await setState(ws, "syncing", "syncing", device.id, row.binding_epoch);
    await event(device.ownerUserId, ws.id, "bind", null, { device: device.id, epoch: row.binding_epoch, fpr });
    return { bindingId: row.id, epoch: row.binding_epoch, hostKey: host.hostKey, workPath: host.workPath, sshUser: "agent", isGit: !!(await isGit(ws.id)) };
  }

  async function isGit(workspaceId: string) {
    return (await sql.unsafe<{ is_git: boolean }[]>("SELECT is_git FROM chisabot_cc_workspaces WHERE id = $1", [workspaceId]))[0]?.is_git ?? false;
  }

  async function needBinding(device: DeviceRecord, workspaceId: string) {
    assertPc(device);
    const ws = await workspaceFor(device.ownerUserId, workspaceId);
    const b = await bindingOf(ws.id, device.id);
    if (!b || !b.enabled) throw new SyncError("这台电脑没有开着这个工作区的同步。", 409);
    return { ws, b };
  }

  /** 电脑报告同步状态（Mutagen 的状态映射成五种状态之一）。 */
  async function report(device: DeviceRecord, input: { workspaceId: string; state: "syncing" | "pc_active" | "conflict"; detail?: string | null }) {
    const { ws, b } = await needBinding(device, input.workspaceId);
    const detail = input.detail ? input.detail.slice(0, 300) : null;
    if (input.state === "pc_active") await setState(ws, "pc_active", "pc", device.id, b.binding_epoch);
    else if (input.state === "conflict") await setState(ws, "conflict", "conflict", device.id, b.binding_epoch);
    else await setState(ws, "syncing", "syncing", device.id, b.binding_epoch);
    await sql.unsafe(
      "UPDATE chisabot_cc_sync_bindings SET last_state = $2, last_detail = $3, last_synced_at = CASE WHEN $2 = 'pc_active' THEN now() ELSE last_synced_at END, updated_at = now() WHERE id = $1",
      [b.id, input.state, detail],
    );
    if (ws.sync_state !== input.state) await event(device.ownerUserId, ws.id, input.state, null, { device: device.id, detail });
    return { state: input.state };
  }

  /** 交还云端（关闭同步）：租约 = 云端，「已暂停」，公钥从边车删掉，这台电脑的隧道断开。两份都保留。 */
  async function release(device: DeviceRecord, input: { workspaceId: string; manifestAt?: string | null }) {
    const { ws, b } = await needBinding(device, input.workspaceId);
    await sql.unsafe("UPDATE chisabot_cc_sync_bindings SET enabled = false, last_state = 'paused', paused_manifest_at = now(), updated_at = now() WHERE id = $1", [b.id]);
    await setState(ws, "paused", "cloud", null, b.binding_epoch);
    await pushKeys(ws.node_device_id).catch(() => false);
    const closed = closeTunnels((t) => t.bindingId === b.id, "交还云端");
    await event(device.ownerUserId, ws.id, "released", null, { device: device.id, tunnels: closed });
    return { state: "paused" as SyncState };
  }

  /** 一次性隧道票（60 秒、用一次）。 */
  async function ticket(device: DeviceRecord, workspaceId: string) {
    const { ws, b } = await needBinding(device, workspaceId);
    if (!hub.isOnline(ws.node_device_id)) throw new SyncError("云端工作区不在线。", 409);
    for (const [k, t] of tickets) if (t.expiresAt < now()) tickets.delete(k);
    const value = `cbt_${randomBytes(24).toString("base64url")}`;
    tickets.set(value, { deviceId: device.id, ownerUserId: device.ownerUserId, workspaceId: ws.id, bindingId: b.id, nodeDeviceId: ws.node_device_id, expiresAt: now() + TICKET_MS });
    return { ticket: value, expiresInMs: TICKET_MS };
  }

  // ── 隧道 ─────────────────────────────────────────────────────────────

  /** 电脑那头连上来：验票（同一台设备、没过期、用一次），让节点开回来的那条。返回给适配器的回调。 */
  function attachPc(device: DeviceRecord, ticketValue: string, socket: TunnelSocket) {
    const t = tickets.get(ticketValue);
    tickets.delete(ticketValue);
    if (!t || t.expiresAt < now() || t.deviceId !== device.id || device.revoked || device.paused) {
      socket.close(4403, "ticket");
      return null;
    }
    const tunnel: Tunnel = {
      id: `tn_${randomUUID().replace(/-/g, "")}`,
      ownerUserId: t.ownerUserId,
      workspaceId: t.workspaceId,
      bindingId: t.bindingId,
      pcDeviceId: device.id,
      nodeDeviceId: t.nodeDeviceId,
      pc: socket,
      node: null,
      backlog: [],
      backlogBytes: 0,
      up: 0,
      down: 0,
      openedAt: now(),
      timer: null,
    };
    tunnels.set(tunnel.id, tunnel);
    tunnel.timer = setTimeout(() => endTunnel(tunnel, "云端节点没有接上隧道"), NODE_CONNECT_MS);
    unref(tunnel.timer);
    if (!hub.sendRaw(t.nodeDeviceId, { type: "sync_tunnel_open", tunnelId: tunnel.id })) {
      endTunnel(tunnel, "云端工作区不在线");
      return null;
    }
    return {
      onMessage(data: unknown) {
        const bytes = toBytes(data);
        if (!bytes || !tunnels.has(tunnel.id)) return;
        tunnel.up += bytes.byteLength;
        if (tunnel.node) tunnel.node.send(bytes);
        else {
          tunnel.backlogBytes += bytes.byteLength;
          if (tunnel.backlogBytes > BACKLOG_CAP) return endTunnel(tunnel, "积压太多");
          tunnel.backlog.push(bytes);
        }
      },
      onClose() {
        endTunnel(tunnel, "电脑断开");
      },
    };
  }

  /** 节点那头连上来：只认这条隧道指定的那个节点。 */
  function attachNode(device: DeviceRecord, tunnelId: string, socket: TunnelSocket) {
    const tunnel = tunnels.get(tunnelId);
    if (!tunnel || tunnel.node || tunnel.nodeDeviceId !== device.id || device.revoked) {
      socket.close(4403, "tunnel");
      return null;
    }
    tunnel.node = socket;
    if (tunnel.timer) clearTimeout(tunnel.timer);
    tunnel.timer = null;
    for (const chunk of tunnel.backlog.splice(0)) socket.send(chunk);
    tunnel.backlogBytes = 0;
    void event(tunnel.ownerUserId, tunnel.workspaceId, "tunnel_open", null, { tunnel: tunnel.id.slice(0, 11), device: tunnel.pcDeviceId });
    return {
      onMessage(data: unknown) {
        const bytes = toBytes(data);
        if (!bytes || !tunnels.has(tunnel.id)) return;
        tunnel.down += bytes.byteLength;
        tunnel.pc.send(bytes);
      },
      onClose() {
        endTunnel(tunnel, "节点断开");
      },
    };
  }

  function endTunnel(tunnel: Tunnel, why: string) {
    if (!tunnels.delete(tunnel.id)) return;
    if (tunnel.timer) clearTimeout(tunnel.timer);
    try {
      tunnel.pc.close(1000, "end");
    } catch {}
    try {
      tunnel.node?.close(1000, "end");
    } catch {}
    if (!tunnel.node) hub.sendRaw(tunnel.nodeDeviceId, { type: "sync_tunnel_close", tunnelId: tunnel.id });
    void event(tunnel.ownerUserId, tunnel.workspaceId, "tunnel_close", null, {
      tunnel: tunnel.id.slice(0, 11),
      device: tunnel.pcDeviceId,
      why,
      up: tunnel.up,
      down: tunnel.down,
      ms: now() - tunnel.openedAt,
    });
  }

  // ── 网页 / 手机（只读 + 强制收回） ──────────────────────────────────

  async function view(ownerUserId: string, workspaceId: string) {
    const ws = await workspaceFor(ownerUserId, workspaceId);
    const b = (await sql.unsafe<BindingRow[]>("SELECT * FROM chisabot_cc_sync_bindings WHERE workspace_id = $1 ORDER BY enabled DESC, updated_at DESC LIMIT 1", [ws.id]))[0] ?? null;
    const device = b ? await deviceStore.get(b.pc_device_id).catch(() => null) : null;
    const online = !!device && hub.isOnline(device.id);
    const l = await lease(ws.id);
    const offlineMs = device && !online && device.lastSeenAt ? Math.max(0, now() - Date.parse(device.lastSeenAt)) : null;
    return {
      workspaceId: ws.id,
      state: ws.sync_state as SyncState,
      binding: b
        ? {
            id: b.id,
            enabled: b.enabled,
            deviceId: b.pc_device_id,
            deviceName: device?.name ?? "已删除的电脑",
            online,
            offlineMs,
            label: b.local_path_label,
            lastSyncedAt: b.last_synced_at ? new Date(b.last_synced_at).toISOString() : null,
            detail: b.last_detail,
            epoch: b.binding_epoch,
          }
        : null,
      lease: { holder: l.holder, since: new Date(l.since).toISOString() },
      tunnels: [...tunnels.values()].filter((t) => t.workspaceId === ws.id).length,
      // 电脑离线时才能强制收回（§4.4）
      canForceReclaim: !!b && b.enabled && !online,
    };
  }

  async function forceReclaim(ownerUserId: string, workspaceId: string) {
    const ws = await workspaceFor(ownerUserId, workspaceId);
    const b = await activeBinding(ws.id);
    if (!b) throw new SyncError("这个工作区没有开着电脑同步。", 409);
    if (hub.isOnline(b.pc_device_id)) throw new SyncError("电脑在线，请在电脑上「交还云端」。电脑离线时才能强制收回。", 409);
    await sql.unsafe("UPDATE chisabot_cc_sync_bindings SET enabled = false, last_state = 'paused', last_detail = '强制收回', updated_at = now() WHERE id = $1", [b.id]);
    await setState(ws, "paused", "cloud", null, b.binding_epoch);
    await pushKeys(ws.node_device_id).catch(() => false);
    const closed = closeTunnels((t) => t.bindingId === b.id, "强制收回");
    await event(ownerUserId, ws.id, "forced", null, { device: b.pc_device_id, tunnels: closed });
    return view(ownerUserId, ws.id);
  }

  /** 撤销设备：它的绑定全部关掉，公钥删掉，隧道断开（§8）。工作区状态回「已暂停」。 */
  async function onDeviceRevoked(deviceId: string) {
    const rows = await sql.unsafe<(BindingRow & { node_device_id: string })[]>(
      "SELECT b.*, w.node_device_id FROM chisabot_cc_sync_bindings b JOIN chisabot_cc_workspaces w ON w.id = b.workspace_id WHERE b.pc_device_id = $1 AND b.enabled",
      [deviceId],
    );
    closeTunnels((t) => t.pcDeviceId === deviceId, "设备已撤销");
    const nodes = new Set<string>();
    for (const b of rows) {
      await sql.unsafe("UPDATE chisabot_cc_sync_bindings SET enabled = false, last_state = 'paused', last_detail = '设备已撤销', updated_at = now() WHERE id = $1", [b.id]);
      const ws = (await sql.unsafe<WorkspaceRow[]>("SELECT * FROM chisabot_cc_workspaces WHERE id = $1", [b.workspace_id]))[0];
      if (ws) await setState(ws, "paused", "cloud", null, b.binding_epoch);
      nodes.add(b.node_device_id);
      await event(b.owner_user_id, b.workspace_id, "revoked", null, { device: deviceId });
    }
    for (const n of nodes) await pushKeys(n).catch(() => false);
    return rows.length;
  }

  /** 设备紧急停止：这台电脑（或节点）上的隧道全部断开。 */
  function closeDeviceTunnels(deviceId: string) {
    return closeTunnels((t) => t.pcDeviceId === deviceId || t.nodeDeviceId === deviceId, "紧急停止");
  }

  /** 紧急停止：断开这个人所有同步隧道。 */
  function emergencyStop(ownerUserId: string) {
    return closeTunnels((t) => t.ownerUserId === ownerUserId, "紧急停止");
  }

  // ── 路由 ─────────────────────────────────────────────────────────────

  const createBody = z.object({ name: z.string().trim().min(1, "起个名字。").max(80), label: z.string().max(300).nullable().optional() });
  const bindBody = z.object({ workspaceId: z.string().max(80), pubKey: z.string().max(400), label: z.string().max(300).nullable().optional() });
  const stateBody = z.object({ workspaceId: z.string().max(80), state: z.enum(["syncing", "pc_active", "conflict"]), detail: z.string().max(1000).nullable().optional() });
  const wsBody = z.object({ workspaceId: z.string().max(80) });

  function onError(error: Error, c: { json: (b: unknown, s: number) => Response }) {
    if (error instanceof SyncError) return c.json({ error: error.message }, error.status);
    if (error instanceof z.ZodError) return c.json({ error: error.issues[0]?.message ?? "参数不对。" }, 400);
    const status = (error as { status?: number }).status;
    if (status === 409 || status === 503) return c.json({ error: error.message }, status);
    console.error(JSON.stringify({ type: "cloud-sync-error", error: error.name, message: String(error.message).slice(0, 200) }));
    return c.json({ error: "电脑同步暂时不可用，请重试。" }, 503);
  }

  /** 挂在 /api/devices 下（设备令牌）：/agent/sync/*。requireDevice 由设备路由提供。 */
  function mountAgent(routes: { route: (path: string, sub: never) => unknown }, requireDevice: MiddlewareHandler) {
    const sub = new Hono<{ Variables: { device: DeviceRecord } }>();
    sub.use("*", requireDevice as unknown as MiddlewareHandler<{ Variables: { device: DeviceRecord } }>);
    sub.onError(onError as never);
    sub.post("/workspaces", async (c) => c.json({ workspace: await createLocalWorkspace(c.get("device"), createBody.parse(await c.req.json().catch(() => ({})))) }));
    sub.post("/bind", async (c) => c.json(await bind(c.get("device"), bindBody.parse(await c.req.json().catch(() => ({}))))));
    sub.post("/state", async (c) => c.json(await report(c.get("device"), stateBody.parse(await c.req.json().catch(() => ({}))))));
    sub.post("/release", async (c) => c.json(await release(c.get("device"), wsBody.parse(await c.req.json().catch(() => ({}))))));
    sub.post("/ticket", async (c) => c.json(await ticket(c.get("device"), wsBody.parse(await c.req.json().catch(() => ({}))).workspaceId)));
    sub.get("/:workspaceId", async (c) => c.json(await view(c.get("device").ownerUserId, c.req.param("workspaceId"))));
    routes.route("/agent/sync", sub as never);
  }

  /** 挂在 /api/claude-code 下（登录、管理员）：GET /workspaces/:id/sync、POST /workspaces/:id/sync/force-reclaim。 */
  function webRoutes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("/workspaces/:id/sync", requireUser);
    app.use("/workspaces/:id/sync/*", requireUser);
    const admin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
      if (c.var.actor.role !== "admin") return c.json({ error: "只有管理员能用云端 Claude Code。" }, 403);
      await next();
    };
    app.onError(onError as never);
    app.get("/workspaces/:id/sync", admin, async (c) => c.json(await view(c.var.actor.id, c.req.param("id"))));
    app.post("/workspaces/:id/sync/force-reclaim", admin, async (c) => c.json(await forceReclaim(c.var.actor.id, c.req.param("id"))));
    return app;
  }

  return {
    ensure,
    recover,
    mountAgent,
    webRoutes,
    attachPc,
    attachNode,
    onDeviceRevoked,
    closeDeviceTunnels,
    emergencyStop,
    // 测试用
    _internal: { tickets, tunnels, bind, report, release, ticket, view, forceReclaim, createLocalWorkspace, lease },
  };
}
