"use strict";
/**
 * PC 节点核心（docs/pc-node.md §5、§8）：出站 WebSocket 连接服务器，执行调用，处理审批与紧急停止。
 *
 * 本机是最后一道闸：即使服务器说可以，本机的紧急停止、本机那份能力开关（从服务器同步，
 * 但在本机先检查）都会拒绝。断线自动重连（1s → 30s 指数退避 + 抖动），被撤销则停止。
 */
const { EventEmitter } = require("node:events");

const OPERATION_CAPABILITY = {
  system_info: null,
  shell: "shell",
  list_files: "files_read",
  read_file: "files_read",
  write_file: "files_write",
  screenshot: "screenshot",
  input: "input",
  open: "open",
  clipboard_read: "clipboard",
  clipboard_write: "clipboard",
};

const DANGEROUS = new Set(["shell", "files_write", "input"]);

function wsUrlFor(serverUrl) {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = "/api/devices/agent/ws";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function summarize(operation, args) {
  switch (operation) {
    case "shell":
      return `运行命令：${String(args.command || "").slice(0, 200)}`;
    case "write_file":
      return `写入：${args.path}`;
    case "read_file":
      return `读取：${args.path}`;
    case "list_files":
      return `列出：${args.path || "允许的文件夹"}`;
    case "input":
      return `鼠标键盘：${args.action}`;
    case "open":
      return `打开：${String(args.target || "").slice(0, 200)}`;
    default:
      return operation;
  }
}

/**
 * @param {object} options
 * @param {string} options.serverUrl
 * @param {() => string|null} options.getToken
 * @param {{run: Function, platform: string}} options.ops
 * @param {Function} [options.WebSocket]  ws 包的 WebSocket（可注入以便测试）
 * @param {(req) => Promise<"approve"|"deny">} [options.approve]  弹出本机审批
 * @param {() => {paused: boolean, forceLocalApproval: boolean}} [options.local]
 * @param {object} [options.clientInfo]
 */
function createNodeAgent(options) {
  const events = new EventEmitter();
  const WebSocketImpl = options.WebSocket || require("ws");
  const local = options.local || (() => ({ paused: false, forceLocalApproval: false }));
  let socket = null;
  let state = "offline"; // offline | connecting | online | revoked | stopped
  let device = null;
  let attempt = 0;
  let reconnectTimer = null;
  let stopped = false;
  const running = new Map(); // call id -> AbortController
  const approvalPrompts = new Map(); // approval id -> { cancel }

  function setState(next, detail) {
    if (state === next && !detail) return;
    state = next;
    events.emit("state", { state, detail, device });
  }

  function send(message) {
    if (socket && socket.readyState === 1) {
      socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  function audit(entry) {
    events.emit("audit", { at: new Date().toISOString(), ...entry });
  }

  function scheduleReconnect() {
    if (stopped || state === "revoked") return;
    clearTimeout(reconnectTimer);
    const base = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
    const delay = Math.round(base * (0.7 + Math.random() * 0.6));
    attempt++;
    events.emit("reconnect", { delay, attempt });
    reconnectTimer = setTimeout(connect, delay);
    if (typeof reconnectTimer.unref === "function" && options.unrefTimers) reconnectTimer.unref();
  }

  async function handleCall(message) {
    const { id, operation } = message;
    const args = message.args || {};
    const capability = OPERATION_CAPABILITY[operation];
    const policy = capability ? device?.capabilities?.[capability] ?? "off" : "allow";
    const started = Date.now();
    const reply = (ok, payload) => {
      running.delete(id);
      send(ok ? { type: "result", id, ok: true, result: payload } : { type: "result", id, ok: false, error: payload });
      audit({
        actor: message.botName || "机器人",
        operation,
        summary: summarize(operation, args),
        outcome: ok ? "succeeded" : "failed",
        detail: ok ? undefined : payload,
        durationMs: Date.now() - started,
      });
    };
    if (capability === undefined) return reply(false, `PC 客户端不支持操作 ${operation}。`);
    if (local().paused) return reply(false, "这台电脑已在本机紧急停止，拒绝所有远程操作。");
    if (device?.paused) return reply(false, "这台设备已紧急停止。");
    if (policy === "off") return reply(false, "本机设置中这项能力是关闭的。");
    // 本机强制审批：危险能力即使服务器设为「直接执行」也在本机再问一次。
    if (local().forceLocalApproval && capability && DANGEROUS.has(capability) && policy === "allow" && options.approve) {
      const decision = await options
        .approve({
          id: `local-${id}`,
          operation,
          summary: summarize(operation, args),
          botName: message.botName,
          local: true,
          // 本机确认最多等到这次调用的超时（服务器那边到点就按失败处理），上限 2 分钟。
          remainingMs: Math.min(120_000, Math.max(10_000, (message.timeoutMs || 120_000) - 5_000)),
        })
        .catch(() => "deny");
      if (decision !== "approve") return reply(false, "用户在本机拒绝了这次操作。");
    }
    const controller = new AbortController();
    running.set(id, controller);
    events.emit("call", { id, operation, botName: message.botName });
    try {
      const result = await options.ops.run(operation, args, {
        allowedRoots: device?.allowedRoots || [],
        signal: controller.signal,
      });
      if (controller.signal.aborted) return reply(false, "已取消。");
      reply(true, result);
    } catch (error) {
      reply(false, error && error.message ? error.message : String(error));
    }
  }

  async function handleApproval(message) {
    if (!options.approve) return; // 无界面：等网页上审批
    let cancelled = false;
    approvalPrompts.set(message.id, { cancel: () => (cancelled = true) });
    const decision = await options.approve(message).catch(() => "deny");
    approvalPrompts.delete(message.id);
    if (cancelled || decision === "dismissed") return;
    send({ type: "approval", id: message.id, decision: decision === "approve" ? "approve" : "deny" });
    audit({
      actor: message.botName || "机器人",
      operation: message.operation,
      summary: message.summary,
      outcome: decision === "approve" ? "approved_local" : "denied_local",
    });
  }

  function onMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    switch (message.type) {
      case "welcome":
      case "config":
        device = message.device;
        attempt = 0;
        setState("online");
        events.emit("config", device);
        return;
      case "call":
        void handleCall(message);
        return;
      case "cancel": {
        running.get(message.id)?.abort();
        return;
      }
      case "approval_request":
        void handleApproval(message);
        return;
      case "approval_closed": {
        const prompt = approvalPrompts.get(message.id);
        if (prompt) {
          prompt.cancel();
          events.emit("approval_closed", message);
        }
        return;
      }
      case "revoked":
        stopped = true;
        setState("revoked");
        events.emit("revoked");
        return;
      case "ping":
        send({ type: "pong" });
        return;
      default:
    }
  }

  function connect() {
    if (stopped) return;
    const token = options.getToken();
    if (!token) {
      setState("offline", "未登录");
      return;
    }
    setState("connecting");
    const origin = new URL(options.serverUrl).origin;
    let ws;
    try {
      ws = new WebSocketImpl(wsUrlFor(options.serverUrl), {
        headers: { "X-Device-Token": token, Origin: origin, "User-Agent": `ChisaBotPC/${options.clientInfo?.clientVersion || "0"}` },
        handshakeTimeout: 15_000,
      });
    } catch (error) {
      setState("offline", error.message);
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.on("open", () => {
      send({ type: "hello", ...(options.clientInfo || {}) });
    });
    ws.on("message", (data) => onMessage(data));
    ws.on("unexpected-response", (_req, res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode === 401) {
          let revoked = false;
          try {
            revoked = !!JSON.parse(body).revoked;
          } catch {}
          stopped = true;
          setState("revoked", revoked ? "设备已被撤销" : "设备令牌无效");
          events.emit("revoked");
        } else {
          setState("offline", `服务器返回 ${res.statusCode}`);
          scheduleReconnect();
        }
      });
    });
    ws.on("close", (code) => {
      if (socket === ws) socket = null;
      for (const controller of running.values()) controller.abort();
      running.clear();
      for (const prompt of approvalPrompts.values()) prompt.cancel();
      approvalPrompts.clear();
      if (code === 4401) {
        stopped = true;
        setState("revoked", "设备已被撤销");
        events.emit("revoked");
        return;
      }
      if (state !== "revoked" && !stopped) {
        setState("offline", code === 4000 ? "在别处重新连接" : undefined);
        scheduleReconnect();
      }
    });
    ws.on("error", (error) => {
      events.emit("error", error);
    });
  }

  return {
    events,
    start() {
      stopped = false;
      attempt = 0;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(reconnectTimer);
      if (socket) socket.close(1000, "bye");
      socket = null;
      setState("stopped");
    },
    /** 改本机设置并同步到服务器（能力、文件夹、名称、紧急停止）。 */
    setConfig(patch) {
      if (device) {
        if (patch.capabilities) device = { ...device, capabilities: { ...device.capabilities, ...patch.capabilities } };
        if (patch.allowedRoots) device = { ...device, allowedRoots: patch.allowedRoots };
        if (patch.paused !== undefined) device = { ...device, paused: patch.paused };
        if (patch.name) device = { ...device, name: patch.name };
        events.emit("config", device);
      }
      if (patch.paused === true) for (const controller of running.values()) controller.abort();
      return send({ type: "set_config", ...patch });
    },
    reportLocal(action, outcome, summary) {
      send({ type: "local_audit", action, outcome, summary });
    },
    get state() {
      return state;
    },
    get device() {
      return device;
    },
  };
}

module.exports = { createNodeAgent, wsUrlFor, OPERATION_CAPABILITY, summarize };
