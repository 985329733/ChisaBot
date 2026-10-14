import { randomUUID } from "node:crypto";
import {
  type DeviceApprovalView,
  type DeviceCapabilities,
  type DeviceOperation,
  type DeviceToServer,
  type DeviceView,
  OPERATION_CAPABILITY,
  OPERATION_LABEL,
  type ServerToDevice,
} from "../../../shared/devices";
import { isMobilePlatform, MOBILE_ONLINE_WINDOW_MS } from "./pairing";
import type { DevicePatch, DeviceRecord, DeviceStore } from "./store";

/**
 * 在线设备的中转站（docs/pc-node.md §5）。
 *
 * PC 主动连进来（WebSocket，出站），服务器只是把机器人的调用转给它并等结果。三道闸都在这里：
 * 撤销 / 紧急停止 / 能力开关（off 拒绝，ask 先审批），然后先写审计再发调用。
 * PC 端还会按自己那份配置再检查一遍，两边任何一边说不就不执行。
 */

export class DeviceRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceRefusedError";
  }
}

export type DeviceSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Connection = {
  deviceId: string;
  ownerUserId: string;
  socket: DeviceSocket;
  pending: Map<string, Pending>;
  lastTouch: number;
  ip: string | null;
};

type Approval = {
  view: DeviceApprovalView;
  ownerUserId: string;
  resolve: (decision: { approved: boolean; by: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

type Screenshot = { deviceId: string; png: Buffer; at: number };

export type InvokeInput = {
  device: DeviceRecord;
  operation: DeviceOperation;
  args: Record<string, unknown>;
  /** 发起者：机器人（默认），或在网页上点「测试连接」的人。 */
  bot: { id: string; name: string | null };
  actorType?: "bot" | "user";
  summary: string;
  timeoutMs?: number;
};

type HubStore = Pick<DeviceStore, "get" | "touch" | "update" | "audit" | "finishAudit"> &
  Partial<Pick<DeviceStore, "seedRoots">>;

function unref(timer: ReturnType<typeof setTimeout>) {
  if (typeof timer === "object" && timer && "unref" in timer)
    (timer as { unref: () => void }).unref();
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 审批偏好 + 聊天里的确认卡片（server/src/confirmations，DESIGN.md §XX）。「询问」能力：偏好是「直接做」就不问；
 * 否则照旧在电脑上弹窗，网页聊天里同时出一张卡片，两边谁先决定都算。
 */
export type DeviceConfirmLink = {
  linkable(): boolean;
  before(input: { ownerUserId: string; botId: string; operation: string; operationLabel: string; summary: string; args: unknown }): Promise<"auto" | "ask">;
  opened(input: {
    approvalId: string;
    ownerUserId: string;
    botId: string;
    deviceName: string;
    operationLabel: string;
    summary: string;
    args: unknown;
    expiresAt: string;
  }): Promise<void>;
  closed(approvalId: string, decision: "approve" | "deny" | "expired", by: string): Promise<void>;
};
/** 聊天里有卡片时等得久一点（和别的确认卡片一样 10 分钟）。 */
const CHAT_APPROVAL_TTL_MS = 10 * 60_000;

export function createDeviceHub(options: {
  store: HubStore;
  confirm?: DeviceConfirmLink;
  approvalTtlMs?: number;
  defaultTimeoutMs?: number;
  now?: () => number;
}) {
  const { store } = options;
  const now = options.now ?? Date.now;
  const approvalTtlMs = options.approvalTtlMs ?? 120_000;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 60_000;
  const connections = new Map<string, Connection>();
  const approvals = new Map<string, Approval>();
  const screenshots = new Map<string, Screenshot>();
  let confirm = options.confirm;

  function send(connection: Connection | undefined, message: ServerToDevice) {
    if (!connection) return false;
    try {
      connection.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  function view(record: DeviceRecord): DeviceView {
    const { tokenHash: _omit, ...rest } = record;
    // 手机不连 /agent/ws：最近一次会话校验（网关约每 30 秒一次）在窗口内就算在线。
    const online = isMobilePlatform(record.platform)
      ? !record.revoked && !!record.lastSeenAt && Date.now() - Date.parse(record.lastSeenAt) < MOBILE_ONLINE_WINDOW_MS
      : connections.has(record.id);
    return { ...rest, online };
  }

  async function pushConfig(deviceId: string) {
    const connection = connections.get(deviceId);
    if (!connection) return;
    const record = await store.get(deviceId);
    if (record) send(connection, { type: "config", device: view(record) });
  }

  function dropConnection(connection: Connection, reason: string) {
    if (connections.get(connection.deviceId) === connection)
      connections.delete(connection.deviceId);
    for (const [id, pending] of connection.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      connection.pending.delete(id);
    }
  }

  function keepScreenshot(deviceId: string, base64: string): string {
    const id = randomUUID();
    screenshots.set(id, { deviceId, png: Buffer.from(base64, "base64"), at: now() });
    // 只留最近 30 张、30 分钟内的。
    const cutoff = now() - 30 * 60_000;
    for (const [key, shot] of screenshots)
      if (shot.at < cutoff || screenshots.size > 30) screenshots.delete(key);
    return id;
  }

  async function applyLocalConfig(
    connection: Connection,
    message: Extract<DeviceToServer, { type: "set_config" }>,
  ) {
    const patch: DevicePatch = {};
    if (message.name !== undefined) patch.name = message.name;
    if (message.capabilities) patch.capabilities = message.capabilities;
    if (message.allowedRoots) patch.allowedRoots = message.allowedRoots;
    if (message.paused !== undefined) patch.paused = message.paused;
    const before = await store.get(connection.deviceId);
    const after = await store.update(connection.deviceId, patch);
    if (!before || !after) return;
    await store.audit({
      deviceId: connection.deviceId,
      ownerUserId: connection.ownerUserId,
      actorType: "device",
      actorId: connection.deviceId,
      actorName: "PC 客户端",
      action: patch.paused !== undefined && patch.paused !== before.paused
        ? patch.paused
          ? "kill_switch_on"
          : "kill_switch_off"
        : "config_changed",
      summary: describeChange(before, after),
      outcome: "succeeded",
      detail: null,
      durationMs: null,
    });
    if (patch.paused === true) cancelAllFor(connection.deviceId, "已在 PC 上紧急停止。");
    await pushConfig(connection.deviceId);
  }

  function cancelAllFor(deviceId: string, reason: string) {
    const connection = connections.get(deviceId);
    if (connection) {
      for (const [id, pending] of connection.pending) {
        send(connection, { type: "cancel", id });
        clearTimeout(pending.timer);
        pending.reject(new DeviceRefusedError(reason));
        connection.pending.delete(id);
      }
    }
    for (const [id, approval] of approvals) {
      if (approval.view.deviceId !== deviceId) continue;
      decideInternal(id, false, "system");
    }
  }

  function decideInternal(id: string, approved: boolean, by: string) {
    const approval = approvals.get(id);
    if (!approval) return false;
    approvals.delete(id);
    clearTimeout(approval.timer);
    send(connections.get(approval.view.deviceId), {
      type: "approval_closed",
      id,
      decision: by === "expired" ? "expired" : approved ? "approve" : "deny",
    });
    approval.resolve({ approved, by });
    void confirm?.closed(id, by === "expired" ? "expired" : approved ? "approve" : "deny", by).catch(() => {});
    return true;
  }

  function requestApproval(
    record: DeviceRecord,
    input: InvokeInput,
  ): Promise<{ approved: boolean; by: string }> {
    const id = randomUUID();
    const createdAt = now();
    const chat = input.actorType !== "user" && (confirm?.linkable() ?? false);
    const ttlMs = chat ? Math.max(approvalTtlMs, CHAT_APPROVAL_TTL_MS) : approvalTtlMs;
    const view: DeviceApprovalView = {
      id,
      deviceId: record.id,
      deviceName: record.name,
      botId: input.bot.id,
      botName: input.bot.name,
      operation: input.operation,
      summary: input.summary,
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + ttlMs).toISOString(),
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => decideInternal(id, false, "expired"), ttlMs);
      unref(timer);
      approvals.set(id, { view, ownerUserId: record.ownerUserId, resolve, timer });
      send(connections.get(record.id), {
        type: "approval_request",
        id,
        operation: input.operation,
        summary: input.summary,
        botName: input.bot.name,
        expiresAt: view.expiresAt,
        // PC 的时钟可能和服务器不一致，所以同时给出按服务器时钟算的剩余毫秒数，PC 用它倒数。
        remainingMs: ttlMs,
      });
      if (chat && confirm)
        void confirm
          .opened({
            approvalId: id,
            ownerUserId: record.ownerUserId,
            botId: input.bot.id,
            deviceName: record.name,
            operationLabel: OPERATION_LABEL[input.operation] ?? input.operation,
            summary: input.summary,
            args: input.args,
            expiresAt: view.expiresAt,
          })
          .catch((error) => console.warn(JSON.stringify({ type: "device-confirm-card-failed", reason: errorText(error) })));
    });
  }

  return {
    view,
    isOnline: (deviceId: string) => connections.has(deviceId),
    pushConfig,
    onlineCount: () => connections.size,

    /** PC 连上（令牌已验证）。返回给 WebSocket 适配器的回调。 */
    attach(record: DeviceRecord, socket: DeviceSocket, ip: string | null) {
      const previous = connections.get(record.id);
      if (previous) {
        dropConnection(previous, "设备在别处重新连接。");
        try {
          previous.socket.close(4000, "replaced");
        } catch {}
      }
      const connection: Connection = {
        deviceId: record.id,
        ownerUserId: record.ownerUserId,
        socket,
        pending: new Map(),
        lastTouch: now(),
        ip,
      };
      connections.set(record.id, connection);
      void store.touch(record.id, { ip });
      send(connection, {
        type: "welcome",
        device: view(record),
        serverTime: new Date(now()).toISOString(),
      });
      // 重连时把还在等的审批补发过去。
      for (const approval of approvals.values()) {
        if (approval.view.deviceId !== record.id) continue;
        send(connection, {
          type: "approval_request",
          id: approval.view.id,
          operation: approval.view.operation,
          summary: approval.view.summary,
          botName: approval.view.botName,
          expiresAt: approval.view.expiresAt,
          remainingMs: Math.max(0, Date.parse(approval.view.expiresAt) - now()),
        });
      }
      const ping = setInterval(() => send(connection, { type: "ping" }), 25_000);
      unref(ping as unknown as ReturnType<typeof setTimeout>);

      return {
        onMessage: async (raw: string) => {
          let message: DeviceToServer;
          try {
            message = JSON.parse(raw);
          } catch {
            return;
          }
          if (!message || typeof message !== "object") return;
          if (now() - connection.lastTouch > 60_000) {
            connection.lastTouch = now();
            void store.touch(record.id, { ip: connection.ip });
          }
          switch (message.type) {
            case "hello": {
              const { suggestedRoots, ...facts } = message;
              await store.touch(record.id, { ip: connection.ip, ...facts });
              // PC 0.1.7 起带上默认文件夹（桌面 / 文档 / 下载）；只在列表为空、从没被人改过时采用。
              if (Array.isArray(suggestedRoots) && store.seedRoots)
                await store.seedRoots(record.id, suggestedRoots).catch(() => false);
              await pushConfig(record.id);
              return;
            }
            case "result": {
              const pending = connection.pending.get(String(message.id));
              if (!pending) return;
              connection.pending.delete(String(message.id));
              clearTimeout(pending.timer);
              if (message.ok) pending.resolve(message.result);
              else
                pending.reject(
                  new DeviceRefusedError(
                    typeof message.error === "string" && message.error
                      ? message.error.slice(0, 600)
                      : "PC 端执行失败。",
                  ),
                );
              return;
            }
            case "approval": {
              const approval = approvals.get(String(message.id));
              if (approval && approval.view.deviceId === record.id)
                decideInternal(String(message.id), message.decision === "approve", "device");
              return;
            }
            case "set_config":
              await applyLocalConfig(connection, message);
              return;
            case "local_audit":
              await store.audit({
                deviceId: record.id,
                ownerUserId: record.ownerUserId,
                actorType: "device",
                actorId: record.id,
                actorName: "PC 客户端",
                action: String(message.action ?? "local").slice(0, 64),
                summary: message.summary ? String(message.summary) : null,
                outcome: String(message.outcome ?? "succeeded").slice(0, 32),
                detail: null,
                durationMs: null,
              });
              return;
            default:
              return;
          }
        },
        onClose: () => {
          clearInterval(ping);
          dropConnection(connection, "设备已断开连接。");
          void store.touch(record.id, { ip: connection.ip }).catch(() => {});
        },
      };
    },

    /** 撤销：通知 PC 并断开。 */
    kick(deviceId: string) {
      const connection = connections.get(deviceId);
      if (!connection) return;
      cancelAllFor(deviceId, "设备已被撤销。");
      send(connection, { type: "revoked" });
      dropConnection(connection, "设备已被撤销。");
      try {
        connection.socket.close(4401, "revoked");
      } catch {}
    },

    cancelAllFor,

    listApprovals(ownerUserId: string | null): DeviceApprovalView[] {
      return [...approvals.values()]
        .filter((a) => ownerUserId === null || a.ownerUserId === ownerUserId)
        .map((a) => a.view);
    },

    approvalOwner(id: string) {
      return approvals.get(id)?.ownerUserId ?? null;
    },

    decide(id: string, approved: boolean, by: string) {
      return decideInternal(id, approved, by);
    },

    setConfirm(link: DeviceConfirmLink) {
      confirm = link;
    },

    screenshot(deviceId: string, id: string): Buffer | null {
      const shot = screenshots.get(id);
      return shot && shot.deviceId === deviceId ? shot.png : null;
    },

    /**
     * 机器人调用设备。所有检查都在发出调用之前；审计行先写（requested），结束时改成结果。
     */
    async invoke(input: InvokeInput): Promise<unknown> {
      const record = input.device;
      const capability = OPERATION_CAPABILITY[input.operation];
      const policy = capability
        ? (record.capabilities as DeviceCapabilities)[capability]
        : "allow";
      const started = now();
      const auditId = await store.audit({
        deviceId: record.id,
        ownerUserId: record.ownerUserId,
        actorType: input.actorType ?? "bot",
        actorId: input.bot.id,
        actorName: input.bot.name,
        action: input.operation,
        summary: input.summary,
        outcome: "requested",
        detail: null,
        durationMs: null,
      });
      const finish = (outcome: string, detail?: string | null) =>
        store.finishAudit(auditId, { outcome, detail: detail ?? null, durationMs: now() - started });
      const refuse = async (outcome: string, message: string): Promise<never> => {
        await finish(outcome, message);
        throw new DeviceRefusedError(message);
      };

      if (record.revoked) return refuse("refused", "这台设备已被撤销。");
      if (record.paused) return refuse("refused", "这台设备已紧急停止，所有远程操作都被拒绝。");
      if (policy === "off")
        return refuse(
          "refused",
          `「${OPERATION_LABEL[input.operation]}」能力在这台设备上是关闭的。请到 设置 → 设备 打开。`,
        );
      if (!connections.has(record.id)) return refuse("offline", "这台设备当前离线。");

      let approvalNote: string | null = null;
      const preference =
        policy === "ask" && confirm && input.actorType !== "user"
          ? await confirm
              .before({
                ownerUserId: record.ownerUserId,
                botId: input.bot.id,
                operation: input.operation,
                operationLabel: OPERATION_LABEL[input.operation] ?? input.operation,
                summary: input.summary,
                args: input.args,
              })
              .catch(() => "ask" as const)
          : "ask";
      if (policy === "ask" && preference === "auto") {
        approvalNote = "按审批偏好直接执行";
      } else if (policy === "ask") {
        const decision = await requestApproval(record, input);
        const who = decision.by === "device" ? "PC 上" : decision.by === "expired" ? "" : "网页上";
        if (!decision.approved)
          return refuse(
            decision.by === "expired" ? "expired" : "denied",
            decision.by === "expired"
              ? "审批超时（2 分钟内无人处理），操作未执行。"
              : `用户在${who}拒绝了这次操作。`,
          );
        approvalNote = `已在${who}批准`;
        // 审批期间配置可能变了（例如按了紧急停止）。
        const fresh = await store.get(record.id);
        if (!fresh || fresh.revoked || fresh.paused)
          return refuse("refused", "审批期间设备已停止或被撤销。");
      }

      const connection = connections.get(record.id);
      if (!connection) return refuse("offline", "这台设备当前离线。");
      const id = randomUUID();
      const timeoutMs = Math.min(Math.max(input.timeoutMs ?? defaultTimeoutMs, 1_000), 15 * 60_000);
      try {
        let result = await new Promise<unknown>((resolve, reject) => {
          const timer = setTimeout(() => {
            connection.pending.delete(id);
            send(connection, { type: "cancel", id });
            reject(new DeviceRefusedError(`PC 端 ${Math.round(timeoutMs / 1000)} 秒内没有返回结果。`));
          }, timeoutMs);
          unref(timer);
          connection.pending.set(id, { resolve, reject, timer });
          const sent = send(connection, {
            type: "call",
            id,
            operation: input.operation,
            args: input.args,
            botName: input.bot.name,
            timeoutMs,
          });
          if (!sent) {
            clearTimeout(timer);
            connection.pending.delete(id);
            reject(new DeviceRefusedError("无法把调用发送到设备。"));
          }
        });
        if (
          input.operation === "screenshot" &&
          result &&
          typeof result === "object" &&
          typeof (result as { base64?: unknown }).base64 === "string"
        ) {
          const { base64, ...rest } = result as { base64: string } & Record<string, unknown>;
          const shot = keepScreenshot(record.id, base64);
          result = {
            ...rest,
            screenshotId: shot,
            url: `/api/devices/${record.id}/screenshots/${shot}`,
            bytes: Math.round((base64.length * 3) / 4),
          };
        }
        await finish("succeeded", approvalNote);
        return result;
      } catch (error) {
        const message = errorText(error);
        await finish(/超时|没有返回/.test(message) ? "timeout" : "failed", [approvalNote, message].filter(Boolean).join("；"));
        throw error instanceof DeviceRefusedError ? error : new DeviceRefusedError(message);
      }
    },
  };
}

export type DeviceHub = ReturnType<typeof createDeviceHub>;

export function describeChange(before: DeviceRecord, after: DeviceRecord): string {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`名称：${before.name} → ${after.name}`);
  if (before.paused !== after.paused) parts.push(after.paused ? "紧急停止：开" : "紧急停止：关");
  for (const key of Object.keys(after.capabilities) as (keyof DeviceCapabilities)[]) {
    if (before.capabilities[key] !== after.capabilities[key])
      parts.push(`${key}：${before.capabilities[key]} → ${after.capabilities[key]}`);
  }
  if (before.allowedRoots.join("|") !== after.allowedRoots.join("|"))
    parts.push(`允许的文件夹：${after.allowedRoots.length} 个`);
  if (before.botIds.slice().sort().join("|") !== after.botIds.slice().sort().join("|"))
    parts.push(`可用机器人：${after.botIds.length} 个`);
  return parts.join("；") || "无变化";
}
