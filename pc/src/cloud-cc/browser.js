"use strict";
/**
 * 「在云端完成登录」的远程浏览器（docs/cloud-claude-code.md「云端登录与上游代理」，DESIGN.md §73.8）。
 *
 * - Chromium 跑在云端节点容器里（和 Claude Code 同一个网络命名空间：同一个出口、同一套防火墙），无头，
 *   用 --remote-debugging-pipe 控制（不开任何端口），配置目录在 /tmp 里，每次新建，结束就删。
 * - 画面：CDP Page.startScreencast 的 JPEG 帧，经设备 WSS 发给服务器，再推给设置页；你的点击 / 键盘经同一条路回来
 *   （Input.dispatchMouseEvent / insertText / dispatchKeyEvent）。输入内容（包括密码）不写日志、不落盘。
 * - 授权页跳到 …/oauth/code/callback?code=…&state=… 时，自动拿到「code#state」交给等着的 `claude auth login`，然后关浏览器。
 * - 设了「Claude 上游代理」时，浏览器走节点里的本机转发器（--proxy-server），登录和 Claude Code 用同一个出口。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const CANDIDATES = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];

function findChromium() {
  const env = process.env.CHISABOT_CHROMIUM;
  if (env && fs.existsSync(env)) return env;
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

/** 授权回调地址 → 要喂给 `claude auth login` 的「code#state」；不是回调就返回 null。 */
function codeFromCallback(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!/\/oauth\/code\/callback\/?$/.test(u.pathname)) return null;
  const code = u.searchParams.get("code");
  if (!code || code.length > 2000) return null;
  const state = u.searchParams.get("state");
  return state ? `${code}#${state}` : code;
}

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
}

/**
 * @param {{ onFrame: (f: {data: string, w: number, h: number}) => void, onState: (s: object) => void,
 *           onCode: (code: string) => void, onExit: (reason: string) => void, proxyPort?: number|null,
 *           width?: number, height?: number, mobile?: boolean, log?: (s: string) => void }} o
 */
function createRemoteBrowser(o) {
  const log = o.log || (() => {});
  const exe = findChromium();
  if (!exe) throw new Error("云端节点上没有浏览器（需要新版云端节点镜像）");
  const width = Math.max(320, Math.min(1280, Math.round(o.width || 1000)));
  const height = Math.max(400, Math.min(1000, Math.round(o.height || 720)));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "chisabot-login-browser-"));
  fs.chmodSync(profile, 0o700);
  const args = [
    "--headless=new",
    "--no-sandbox", // 容器本身就是沙箱（非 root、cap_drop ALL、只读根文件系统）；容器里起不了 Chromium 自己的沙箱
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-component-update",
    "--metrics-recording-only",
    "--password-store=basic",
    "--lang=zh-CN",
    "--remote-debugging-pipe",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    ...(o.proxyPort ? [`--proxy-server=http://127.0.0.1:${o.proxyPort}`, "--proxy-bypass-list=<-loopback>"] : []),
    "about:blank",
  ];
  const child = spawn(exe, args, { detached: true, stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  const toBrowser = child.stdio[3];
  const fromBrowser = child.stdio[4];
  let nextId = 1;
  const pending = new Map();
  const handlers = new Map(); // method -> fn(params, sessionId)
  let closed = false;
  let pageSession = null;
  let pageTarget = null;
  const stack = []; // [{targetId, sessionId}]，弹窗压栈
  let lastFrameAt = 0;
  let frameTimer = null;
  let latestFrame = null;
  let captured = false;
  let currentUrl = "";

  let buf = "";
  fromBrowser.setEncoding("utf8");
  fromBrowser.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\0")) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        continue;
      }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "CDP 出错"));
        else p.resolve(msg.result || {});
      } else if (msg.method) {
        const fn = handlers.get(msg.method);
        if (fn) {
          try {
            fn(msg.params || {}, msg.sessionId || null);
          } catch (e) {
            log(`CDP 事件处理出错：${e.message}`);
          }
        }
      }
    }
  });
  toBrowser.on("error", () => {});
  child.on("exit", () => finish("浏览器退出了"));

  function cdp(method, params = {}, sessionId = null, timeoutMs = 20_000) {
    if (closed) return Promise.reject(new Error("浏览器已关闭"));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} 超时`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      toBrowser.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }

  function flushFrame() {
    frameTimer = null;
    if (!latestFrame || closed) return;
    lastFrameAt = Date.now();
    const f = latestFrame;
    latestFrame = null;
    o.onFrame(f);
  }
  handlers.set("Page.screencastFrame", (p, sessionId) => {
    void cdp("Page.screencastFrameAck", { sessionId: p.sessionId }, sessionId).catch(() => {});
    if (sessionId !== pageSession) return;
    latestFrame = { data: p.data, w: Math.round(p.metadata?.deviceWidth || width), h: Math.round(p.metadata?.deviceHeight || height) };
    // 最多 ~8 帧 / 秒，网络慢时只发最新一帧
    const wait = Math.max(0, 120 - (Date.now() - lastFrameAt));
    if (!frameTimer) frameTimer = setTimeout(flushFrame, wait);
  });
  handlers.set("Page.frameNavigated", (p, sessionId) => {
    if (p.frame?.parentId) return;
    const url = String(p.frame?.url || "");
    checkUrl(url);
    if (sessionId === pageSession) {
      currentUrl = url;
      o.onState({ url: safeUrl(url), title: "" });
    }
  });
  handlers.set("Page.navigatedWithinDocument", (p, sessionId) => {
    checkUrl(String(p.url || ""));
    if (sessionId === pageSession) o.onState({ url: safeUrl(String(p.url || "")) });
  });
  handlers.set("Target.targetCreated", (p) => {
    const t = p.targetInfo || {};
    if (t.type === "page" && t.openerId && !closed) void adopt(t.targetId, true).catch(() => {});
  });
  handlers.set("Target.targetInfoChanged", (p) => {
    const t = p.targetInfo || {};
    if (t.type === "page") checkUrl(String(t.url || ""));
  });
  handlers.set("Target.targetDestroyed", (p) => {
    const i = stack.findIndex((x) => x.targetId === p.targetId);
    if (i < 0) return;
    const wasActive = stack[i].sessionId === pageSession;
    stack.splice(i, 1);
    if (wasActive && stack.length) void focus(stack[stack.length - 1]).catch(() => {});
  });

  /** 地址栏里给你看的地址：查询参数（可能有授权码）去掉。 */
  function safeUrl(url) {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`;
    } catch {
      return "";
    }
  }

  function checkUrl(url) {
    if (captured) return;
    const code = codeFromCallback(url);
    if (!code) return;
    captured = true;
    o.onState({ url: safeUrl(url), captured: true });
    o.onCode(code);
  }

  async function adopt(targetId, switchTo) {
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    await cdp("Page.enable", {}, sessionId);
    await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: !!o.mobile }, sessionId).catch(() => {});
    const entry = { targetId, sessionId };
    stack.push(entry);
    if (switchTo) await focus(entry);
    return entry;
  }

  async function focus(entry) {
    if (pageSession && pageSession !== entry.sessionId) await cdp("Page.stopScreencast", {}, pageSession).catch(() => {});
    pageSession = entry.sessionId;
    pageTarget = entry.targetId;
    await cdp("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: width, maxHeight: height, everyNthFrame: 1 }, pageSession);
    o.onState({ popup: stack.length > 1 });
  }

  /** 在一个临时标签页里打开 url，等加载完读出正文，然后关掉（看出口 IP 用）。 */
  async function readPage(url, timeoutMs = 15_000) {
    const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp("Target.attachToTarget", { targetId, flatten: true });
    try {
      await cdp("Page.enable", {}, sessionId);
      const loaded = new Promise((resolve) => {
        const prev = handlers.get("Page.loadEventFired");
        handlers.set("Page.loadEventFired", (p, sid) => {
          if (sid === sessionId) resolve(true);
          else if (prev) prev(p, sid);
        });
        setTimeout(() => resolve(false), timeoutMs);
      });
      await cdp("Page.navigate", { url }, sessionId);
      await loaded;
      const r = await cdp("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true }, sessionId);
      return String(r.result?.value || "");
    } finally {
      handlers.delete("Page.loadEventFired");
      await cdp("Target.closeTarget", { targetId }).catch(() => {});
    }
  }

  async function start(url) {
    await cdp("Target.setDiscoverTargets", { discover: true });
    const { targetInfos } = await cdp("Target.getTargets");
    const first = (targetInfos || []).find((t) => t.type === "page");
    const entry = first ? await adopt(first.targetId, false) : await adopt((await cdp("Target.createTarget", { url: "about:blank" })).targetId, false);
    await focus(entry);
    await cdp("Page.navigate", { url }, entry.sessionId);
  }

  const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
  function mods(e) {
    return (e.alt ? MOD.alt : 0) | (e.ctrl ? MOD.ctrl : 0) | (e.meta ? MOD.meta : 0) | (e.shift ? MOD.shift : 0);
  }
  const KEYS = {
    Enter: { code: "Enter", keyCode: 13, text: "\r" },
    Backspace: { code: "Backspace", keyCode: 8 },
    Tab: { code: "Tab", keyCode: 9 },
    Escape: { code: "Escape", keyCode: 27 },
    Delete: { code: "Delete", keyCode: 46 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    Home: { code: "Home", keyCode: 36 },
    End: { code: "End", keyCode: 35 },
  };

  /** 网页发来的输入。不记录内容。 */
  async function input(events) {
    if (!pageSession || closed) return;
    for (const e of (Array.isArray(events) ? events : []).slice(0, 200)) {
      const x = Math.max(0, Math.min(width, Number(e.x) || 0));
      const y = Math.max(0, Math.min(height, Number(e.y) || 0));
      try {
        if (e.t === "mouse" && ["mousePressed", "mouseReleased", "mouseMoved"].includes(e.type)) {
          await cdp("Input.dispatchMouseEvent", { type: e.type, x, y, button: e.type === "mouseMoved" ? (e.buttons ? "left" : "none") : "left", buttons: e.buttons ? 1 : 0, clickCount: e.type === "mouseMoved" ? 0 : Math.max(1, Math.min(3, Number(e.clickCount) || 1)), modifiers: mods(e) }, pageSession);
        } else if (e.t === "wheel") {
          await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: Number(e.dx) || 0, deltaY: Number(e.dy) || 0 }, pageSession);
        } else if (e.t === "text" && typeof e.text === "string" && e.text) {
          await cdp("Input.insertText", { text: e.text.slice(0, 2000) }, pageSession);
        } else if (e.t === "key" && KEYS[e.key]) {
          const k = KEYS[e.key];
          const base = { key: e.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, modifiers: mods(e) };
          await cdp("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text, unmodifiedText: k.text } : {}) }, pageSession);
          await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base }, pageSession);
        } else if (e.t === "key" && typeof e.key === "string" && e.key.length === 1 && (e.ctrl || e.meta)) {
          // Ctrl/⌘ + 字母（全选、粘贴…）
          const upper = e.key.toUpperCase();
          const base = { key: e.key, code: `Key${upper}`, windowsVirtualKeyCode: upper.charCodeAt(0), modifiers: mods(e), commands: e.key.toLowerCase() === "a" ? ["selectAll"] : [] };
          await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base }, pageSession);
          await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...base }, pageSession);
        } else if (e.t === "nav" && e.action === "back") {
          const h = await cdp("Page.getNavigationHistory", {}, pageSession);
          const prev = h.entries?.[h.currentIndex - 1];
          if (prev) await cdp("Page.navigateToHistoryEntry", { entryId: prev.id }, pageSession);
        } else if (e.t === "nav" && e.action === "reload") {
          await cdp("Page.reload", {}, pageSession);
        }
      } catch {
        // 单个输入失败不影响后面的
      }
    }
  }

  function finish(reason) {
    if (closed) return;
    closed = true;
    if (frameTimer) clearTimeout(frameTimer);
    for (const p of pending.values()) p.reject(new Error("浏览器已关闭"));
    pending.clear();
    killTree(child);
    // 配置目录（cookie、表单记录…）整个删掉
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 300);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
    o.onExit(reason);
  }

  async function stop(reason = "关闭") {
    if (closed) return;
    try {
      await cdp("Browser.close", {}, null, 2000);
    } catch {}
    finish(reason);
  }

  return {
    start,
    input,
    stop,
    readPage,
    get closed() {
      return closed;
    },
    get url() {
      return currentUrl;
    },
    profile,
    size: { width, height },
    _target: () => pageTarget,
  };
}

module.exports = { createRemoteBrowser, findChromium, codeFromCallback };
