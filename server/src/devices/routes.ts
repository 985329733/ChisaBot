import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import {
  DEVICE_CAPABILITIES,
  type DeviceCapabilities,
} from "../../../shared/devices";
import { type AuditStore, recordAuditEvent } from "../audit";
import type { AppVariables } from "../auth/guards";
import { upgradeWebSocket } from "../channels/socket";
import { DeviceRefusedError, type DeviceHub, describeChange } from "./hub";
import type { DevicePatch, DeviceRecord, DeviceStore } from "./store";

/**
 * /api/devices（docs/pc-node.md §6）。
 *
 * 两类调用方：
 *  - 已登录的人（网页 / 手机 / PC 客户端里的聊天窗口）：requireUser，管理自己的设备；管理员可看全部。
 *  - PC 节点本身：/agent/*，用登记时拿到的设备令牌（请求头 X-Device-Token）。公网网关对 /api/devices/agent/
 *    不做会话校验，所以这里的令牌校验就是这条路唯一的门，失败要限速。
 */

type Variables = AppVariables & { device: DeviceRecord };

const failures = new Map<string, { count: number; until: number }>();
const FAIL_LIMIT = 20;
const FAIL_WINDOW_MS = 10 * 60_000;

function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first ? first.slice(0, 64) : null;
}

function limited(ip: string | null) {
  const entry = failures.get(ip ?? "?");
  return !!entry && entry.until > Date.now() && entry.count >= FAIL_LIMIT;
}

function fail(ip: string | null) {
  const key = ip ?? "?";
  const entry = failures.get(key);
  if (!entry || entry.until < Date.now())
    failures.set(key, { count: 1, until: Date.now() + FAIL_WINDOW_MS });
  else entry.count++;
  if (failures.size > 5000) failures.clear();
}

function parsePatch(body: unknown): DevicePatch | string {
  if (!body || typeof body !== "object") return "请求格式无效。";
  const input = body as Record<string, unknown>;
  const patch: DevicePatch = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim()) return "名称不能为空。";
    patch.name = input.name;
  }
  if (input.capabilities !== undefined) {
    if (!input.capabilities || typeof input.capabilities !== "object") return "能力设置无效。";
    const caps: Partial<DeviceCapabilities> = {};
    for (const [key, value] of Object.entries(input.capabilities as Record<string, unknown>)) {
      if (!(DEVICE_CAPABILITIES as readonly string[]).includes(key)) return `未知能力：${key}`;
      if (value !== "off" && value !== "ask" && value !== "allow") return `能力 ${key} 的取值无效。`;
      caps[key as keyof DeviceCapabilities] = value;
    }
    patch.capabilities = caps;
  }
  if (input.allowedRoots !== undefined) {
    if (!Array.isArray(input.allowedRoots)) return "允许的文件夹必须是列表。";
    patch.allowedRoots = input.allowedRoots.map(String);
  }
  if (input.paused !== undefined) {
    if (typeof input.paused !== "boolean") return "紧急停止的取值无效。";
    patch.paused = input.paused;
  }
  if (input.botIds !== undefined) {
    if (!Array.isArray(input.botIds)) return "机器人列表无效。";
    patch.botIds = input.botIds.map(String);
  }
  return patch;
}

export function createDeviceRoutes(options: {
  store: DeviceStore;
  hub: DeviceHub;
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  auditStore?: AuditStore;
}) {
  const { store, hub, requireUser, auditStore } = options;
  const routes = new Hono<{ Variables: Variables }>();
  const userGuard = requireUser as unknown as MiddlewareHandler<{ Variables: Variables }>;

  async function mainAudit(actorUserId: string, deviceId: string, change: string, detail?: string) {
    if (!auditStore) return;
    try {
      await recordAuditEvent(auditStore, {
        eventType: "configuration.changed",
        targetType: "device",
        targetId: deviceId,
        actorUserId,
        payload: { change, ...(detail ? { detail: detail.slice(0, 400) } : {}) },
      });
    } catch {
      /* 设备自己的审计表才是这条记录的主存处。 */
    }
  }

  const requireDevice: MiddlewareHandler<{ Variables: Variables }> = async (context, next) => {
    const ip = clientIp(context.req.raw);
    if (limited(ip)) return context.json({ error: "失败次数过多，请稍后再试。" }, 429);
    const token = context.req.header("x-device-token")?.trim() ?? "";
    const device = token ? await store.authenticate(token) : null;
    if (device === "revoked") return context.json({ error: "这台设备已被撤销，请重新登录。", revoked: true }, 401);
    if (!device) {
      fail(ip);
      return context.json({ error: "设备令牌无效，请重新登录。" }, 401);
    }
    context.set("device", device);
    await next();
  };

  // ---- PC 节点 ----

  routes.get(
    "/agent/ws",
    requireDevice,
    upgradeWebSocket((context) => {
      const device = context.get("device") as DeviceRecord;
      const ip = clientIp(context.req.raw);
      let handlers: ReturnType<DeviceHub["attach"]> | null = null;
      return {
        onOpen: (_event, ws) => {
          handlers = hub.attach(
            device,
            { send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason) },
            ip,
          );
        },
        onMessage: (event) => {
          if (typeof event.data === "string" && event.data.length < 24 * 1024 * 1024)
            void handlers?.onMessage(event.data).catch(() => {});
        },
        onClose: () => handlers?.onClose(),
        onError: () => handlers?.onClose(),
      };
    }),
  );

  routes.get("/agent/self", requireDevice, (context) =>
    context.json({ device: hub.view(context.get("device")) }),
  );

  /** PC 端「退出登录」：设备自己作废自己的令牌。 */
  routes.post("/agent/unenroll", requireDevice, async (context) => {
    const device = context.get("device");
    await store.revoke(device.id);
    await store.audit({
      deviceId: device.id,
      ownerUserId: device.ownerUserId,
      actorType: "device",
      actorId: device.id,
      actorName: "PC 客户端",
      action: "unenrolled",
      summary: "在 PC 上退出登录，令牌已作废",
      outcome: "succeeded",
      detail: null,
      durationMs: null,
    });
    hub.kick(device.id);
    return context.json({ ok: true });
  });

  // ---- 已登录的人 ----

  async function owned(context: { var: Variables }, id: string): Promise<DeviceRecord | null> {
    const device = await store.get(id);
    if (!device) return null;
    const actor = context.var.actor;
    if (device.ownerUserId !== actor.id && actor.role !== "admin") return null;
    return device;
  }

  routes.get("/", userGuard, async (context) => {
    const actor = context.var.actor;
    const all = context.req.query("all") === "1" && actor.role === "admin";
    const list = await store.list(all ? null : actor.id);
    return context.json({
      devices: list.map((device) => hub.view(device)),
      approvals: hub.listApprovals(all ? null : actor.id),
    });
  });

  /** PC 客户端登录后调用：用当前会话登记这台电脑，返回一次性明文令牌。 */
  routes.post("/enroll", userGuard, async (context) => {
    const body = (await context.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return context.json({ error: "请求格式无效。" }, 400);
    const actor = context.var.actor;
    const { device, token } = await store.enroll({
      ownerUserId: actor.id,
      name: body.name,
      platform: body.platform,
      osVersion: body.osVersion,
      hostname: body.hostname,
      arch: body.arch,
      clientVersion: body.clientVersion,
      ip: clientIp(context.req.raw),
    });
    await store.audit({
      deviceId: device.id,
      ownerUserId: actor.id,
      actorType: "user",
      actorId: actor.id,
      actorName: actor.name ?? actor.email ?? null,
      action: "enrolled",
      summary: `登记设备「${device.name}」（${device.platform}${device.hostname ? ` · ${device.hostname}` : ""}）`,
      outcome: "succeeded",
      detail: null,
      durationMs: null,
    });
    await mainAudit(actor.id, device.id, "device_enrolled", device.name);
    return context.json({ device: hub.view(device), token }, 201);
  });

  routes.get("/approvals", userGuard, (context) => {
    const actor = context.var.actor;
    return context.json({ approvals: hub.listApprovals(actor.role === "admin" ? null : actor.id) });
  });

  routes.post("/approvals/:approvalId", userGuard, async (context) => {
    const id = context.req.param("approvalId");
    const actor = context.var.actor;
    const owner = hub.approvalOwner(id);
    if (!owner || (owner !== actor.id && actor.role !== "admin"))
      return context.json({ error: "这个审批已经处理过或已过期。" }, 404);
    const body = (await context.req.json().catch(() => null)) as { decision?: unknown } | null;
    const decision = body?.decision;
    if (decision !== "approve" && decision !== "deny")
      return context.json({ error: "decision 必须是 approve 或 deny。" }, 400);
    const done = hub.decide(id, decision === "approve", "web");
    if (!done) return context.json({ error: "这个审批已经处理过或已过期。" }, 404);
    return context.json({ ok: true });
  });

  routes.get("/:id", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    return context.json({ device: hub.view(device) });
  });

  routes.patch("/:id", userGuard, async (context) => {
    const before = await owned(context, context.req.param("id"));
    if (!before) return context.json({ error: "没有这台设备。" }, 404);
    if (before.revoked) return context.json({ error: "这台设备已被撤销，不能再修改。" }, 409);
    const patch = parsePatch(await context.req.json().catch(() => null));
    if (typeof patch === "string") return context.json({ error: patch }, 400);
    const after = await store.update(before.id, patch);
    if (!after) return context.json({ error: "没有这台设备。" }, 404);
    const actor = context.var.actor;
    const change = describeChange(before, after);
    const pausedChanged = before.paused !== after.paused;
    await store.audit({
      deviceId: after.id,
      ownerUserId: after.ownerUserId,
      actorType: "user",
      actorId: actor.id,
      actorName: actor.name ?? actor.email ?? null,
      action: pausedChanged ? (after.paused ? "kill_switch_on" : "kill_switch_off") : "config_changed",
      summary: change,
      outcome: "succeeded",
      detail: "网页",
      durationMs: null,
    });
    await mainAudit(actor.id, after.id, "device_updated", change);
    if (after.paused) hub.cancelAllFor(after.id, "已在网页上紧急停止。");
    await hub.pushConfig(after.id);
    return context.json({ device: hub.view(after) });
  });

  routes.post("/:id/revoke", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    const actor = context.var.actor;
    await store.revoke(device.id);
    await store.audit({
      deviceId: device.id,
      ownerUserId: device.ownerUserId,
      actorType: "user",
      actorId: actor.id,
      actorName: actor.name ?? actor.email ?? null,
      action: "revoked",
      summary: "撤销设备令牌",
      outcome: "succeeded",
      detail: "网页",
      durationMs: null,
    });
    await mainAudit(actor.id, device.id, "device_revoked", device.name);
    hub.kick(device.id);
    const after = await store.get(device.id);
    return context.json({ device: after ? hub.view(after) : null });
  });

  routes.delete("/:id", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    hub.kick(device.id);
    await store.remove(device.id);
    await mainAudit(context.var.actor.id, device.id, "device_deleted", device.name);
    return context.json({ ok: true });
  });

  routes.get("/:id/audit", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    const limit = Number(context.req.query("limit") ?? 50);
    const entries = await store.auditLog(device.id, {
      limit: Number.isFinite(limit) ? limit : 50,
      before: context.req.query("before") ?? undefined,
    });
    return context.json({ entries });
  });

  /** 从网页对设备做一次无害的连通性测试（读取系统信息），同样走审计。 */
  routes.post("/:id/test", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    const actor = context.var.actor;
    try {
      const result = await hub.invoke({
        device,
        operation: "system_info",
        args: {},
        bot: { id: actor.id, name: "网页连通性测试" },
        actorType: "user",
        summary: "网页上点击「测试连接」",
        timeoutMs: 15_000,
      });
      return context.json({ ok: true, result });
    } catch (error) {
      return context.json(
        { ok: false, error: error instanceof DeviceRefusedError ? error.message : "测试失败。" },
        error instanceof DeviceRefusedError ? 409 : 500,
      );
    }
  });

  routes.get("/:id/screenshots/:shotId", userGuard, async (context) => {
    const device = await owned(context, context.req.param("id"));
    if (!device) return context.json({ error: "没有这台设备。" }, 404);
    const png = hub.screenshot(device.id, context.req.param("shotId"));
    if (!png) return context.json({ error: "截图已过期（只保留 30 分钟）。" }, 404);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=1800" },
    });
  });

  return routes;
}
