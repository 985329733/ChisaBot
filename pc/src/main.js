"use strict";
/**
 * ChisaBot PC 客户端（Electron 主进程）。docs/pc-node.md §8。
 *
 *  - 登录（ui/login.html）：本机的「登录 ChisaBot」页 —— 服务器地址（记住、带历史）+ 账号 + 密码
 *    + 记住登录。先探测地址，再直接请求服务器登录网关（和网页登录表单同一个 POST /auth/login），会话 Cookie
 *    写进主窗口的会话，再登记设备拿到令牌（DPAPI 加密保存）。密码从不保存。启动时会话仍有效就直接进入；
 *    主窗口被服务器跳到 /login（会话过期）时换回本机登录页，不再显示服务器的网页登录页。
 *  - 主窗口：直接载入该服务器的 ChisaBot 网页（登录 Cookie 已注入）——聊天、偏好设置、管理后台和网页完全同一套
 *    界面；本机设置就是网页的 偏好设置 → 设备 → 这台电脑（「本机」标签），通过 web-preload.js 的本机桥读写
 *    只能在本机做的事（紧急停止、本机确认、开机自启、文件夹选择器、退出登录）。关闭时缩到托盘。
 *  - 本机窗口（设置向导、审批弹窗、本机确认、离线页）用网页同一套 Skyglass 令牌（ui/skyglass-tokens.css）
 *  - 托盘：在线 / 离线 / 紧急停止三种图标；菜单含紧急停止
 *  - 节点：agent/core.js 出站 WebSocket；审批弹窗；本机审计日志
 *  - 在线更新（updater.js）：后台下载，下载好后本机窗口「新版本已下载，重启以安装」
 */
const path = require("node:path");
const os = require("node:os");
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  dialog,
  shell,
  clipboard,
  desktopCapturer,
  screen,
  nativeImage,
  safeStorage,
  session,
  Notification,
  nativeTheme,
  net,
} = require("electron");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { createConfig } = require("./config");
const { createNodeAgent } = require("./agent/core");
const { createOps } = require("./agent/ops");
const auth = require("./agent/auth");
const { ensureEnrolled } = require("./agent/enrollment");
const { createUpdater } = require("./updater");
const shellRefresh = require("./shell-refresh");
const { createCompactController } = require("./compact-window");
const { computeUpdateBounds } = require("./update-placement");
const buildConfig = require("./build-config");
const BUILD = buildConfig.load();
const pkg = require("../package.json");

const PARTITION = "persist:chisabot";
const ASSETS = path.join(__dirname, "..", "assets");
const UI = path.join(__dirname, "ui");
const HIDDEN = process.argv.includes("--hidden");
/** 外壳指纹（scripts/shell-fingerprint.js 打包前写入）：和更新源比，决定普通更新还是重新安装。 */
const SHELL_HASH = shellRefresh.loadFingerprint();
const APP_USER_MODEL_ID = "cn.ayase.chisabot.pc";

if (process.platform === "win32") app.setAppUserModelId(APP_USER_MODEL_ID);
if (!app.requestSingleInstanceLock()) app.quit();

let config;
let agent = null;
/** 节点最近一次状态说明（例如「设备令牌无效」「设备已被撤销」），托盘和网页设备页用。 */
let agentDetail = "";
/** 为什么这台电脑还没成为在线设备（登记失败 / 会话过期 / 连不上）；登记成功后清空。 */
let enrollIssue = "";
let enrollRetryTimer = null;
let enrolling = null;
let tray = null;
const windows = { login: null, chat: null };
const UI_URL = pathToFileURL(UI).href; // 只用于 will-navigate 放行本机离线页
let quitting = false;
const approvalQueue = [];
let approvalWindow = null;
let currentApproval = null;
let updater = null;
let updateWindow = null;

function clientInfo() {
  return {
    clientVersion: pkg.version,
    platform: process.platform,
    osVersion: `${os.type()} ${os.release()}${typeof os.version === "function" ? ` (${os.version()})` : ""}`,
    hostname: os.hostname(),
    arch: os.arch(),
  };
}

// ---------- 窗口 ----------

function localWindow(name, file, { query, ...options } = {}) {
  if (windows[name] && !windows[name].isDestroyed()) {
    windows[name].show();
    windows[name].focus();
    return windows[name];
  }
  const win = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: "ChisaBot PC",
    icon: path.join(ASSETS, "icon.png"),
    autoHideMenuBar: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
    ...options,
  });
  win.setMenu(null);
  win.loadFile(path.join(UI, file), query ? { query } : undefined);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    windows[name] = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  windows[name] = win;
  return win;
}

function windowBackground() {
  return nativeTheme.shouldUseDarkColors ? "#12203a" : "#9dbddc";
}

/** 本机登录页。notice：expired（会话过期）| logout（已退出）| switch（切换服务器）。 */
function openLogin(notice = "") {
  const existing = windows.login && !windows.login.isDestroyed();
  const win = localWindow("login", "login.html", {
    width: 460,
    height: 760,
    minWidth: 400,
    minHeight: 620,
    maximizable: false,
    title: "登录 ChisaBot",
    query: notice ? { notice } : undefined,
  });
  if (existing && notice) win.webContents.send("state:changed", `notice:${notice}`);
  return win;
}

function loginUrl(url) {
  try {
    return isServerUrl(url) && /^\/(?:login|sign)\/?$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** 主窗口被服务器带到网页登录页（会话过期 / 被退出）：关掉主窗口，换本机登录页。 */
function sessionExpired() {
  if (windows.chat && !windows.chat.isDestroyed()) windows.chat.destroy();
  windows.chat = null;
  openLogin("expired");
}

async function cookieHeaderFor(origin) {
  const cookies = await session.fromPartition(PARTITION).cookies.get({ url: `${origin}/` });
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/** 启动 / 托盘打开时：会话还有效就直接进入，过期了去本机登录页；连不上时照常打开主窗口（会显示离线页）。 */
async function sessionStatus() {
  const origin = serverOrigin();
  if (!origin) return "login";
  try {
    const result = await auth.probe({ serverUrl: origin, cookieHeader: await cookieHeaderFor(origin), timeoutMs: 6000 });
    if (result.gateway) return result.authenticated ? "ok" : "login";
    return "ok";
  } catch {
    return "offline";
  }
}

let entering = null;
function openApp(pathname) {
  if (windows.chat && !windows.chat.isDestroyed()) return openChat(pathname);
  if (!config.get().serverUrl) return openLogin();
  if (!entering)
    entering = sessionStatus()
      .then((status) => (status === "login" ? openLogin("expired") : openChat(pathname)))
      .finally(() => {
        entering = null;
      });
  return entering;
}

/** 本机设置 = 网页 偏好设置 → 设备 → 这台电脑。tab：permissions | local | audit | settings。 */
function openDeviceSettings(tab) {
  const { deviceId } = config.get();
  const query = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  return openApp(deviceId ? `/settings/devices/${encodeURIComponent(deviceId)}${query}` : "/settings/devices");
}

let chatOffline = false;
let chatRetryTimer = null;
let lastWebPath = "/";

function serverOrigin() {
  try {
    return new URL(config.get().serverUrl).origin;
  } catch {
    return "";
  }
}

function isServerUrl(url) {
  try {
    return new URL(url).origin === serverOrigin();
  } catch {
    return false;
  }
}

function openChat(pathname) {
  const { serverUrl } = config.get();
  if (!serverUrl) return openLogin();
  const target = pathname ? `${serverOrigin()}${pathname}` : null;
  if (windows.chat && !windows.chat.isDestroyed()) {
    if (target && !chatOffline) windows.chat.loadURL(target);
    else if (pathname) lastWebPath = pathname;
    windows.chat.show();
    windows.chat.focus();
    return windows.chat;
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "ChisaBot",
    icon: path.join(ASSETS, "icon.png"),
    autoHideMenuBar: true,
    // 无边框：网页顶栏就是标题栏（拖动区 + 网页里的最小化 / 最大化 / 关闭，DESIGN-v3 §3）。
    // 不透明窗口 + thickFrame：Windows 11 由系统画圆角（约 8px）和窗口阴影，拖边调整大小、
    // Win+方向键贴靠、最大化都是系统行为；Windows 10 上是方角。网页不再自己画圆角。
    frame: false,
    thickFrame: true,
    backgroundColor: windowBackground(),
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, "web-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  chatOffline = false;
  win.loadURL(target || serverUrl);
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 同一服务器的弹窗（例如连接账号的授权窗口）照常打开；本机桥只认主窗口，弹窗里拿不到。
    if (isServerUrl(url)) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(ASSETS, "icon.png") } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  // 服务器的网页登录页不在客户端里出现：会话过期时服务器会 302 到 /login，这里换成本机登录页。
  win.webContents.on("will-redirect", (event, url) => {
    if (!loginUrl(url)) return;
    event.preventDefault();
    setImmediate(sessionExpired);
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (loginUrl(url)) {
      event.preventDefault();
      setImmediate(sessionExpired);
      return;
    }
    if (isServerUrl(url) || url.startsWith(UI_URL)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-navigate", (_event, url) => {
    if (loginUrl(url)) return setImmediate(sessionExpired);
    if (isServerUrl(url)) {
      chatOffline = false;
      clearInterval(chatRetryTimer);
    }
  });
  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && isServerUrl(url)) lastWebPath = new URL(url).pathname + new URL(url).search;
  });
  // 载不出网页（断网、服务器维护）时换成本机的离线页：同样的天空和玻璃，紧急停止照样能按，恢复后自动回到原页面。
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isServerUrl(url)) return;
    try {
      lastWebPath = new URL(url).pathname + new URL(url).search;
    } catch {}
    showOffline(win, description || String(code));
  });
  win.webContents.on("render-process-gone", () => showOffline(win, "页面进程意外退出"));
  const sendMaximized = () => {
    if (!win.isDestroyed()) win.webContents.send("window:maximized", win.isMaximized() || win.isFullScreen());
  };
  for (const name of ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(name, sendMaximized);
  // 小窗模式（DESIGN.md §36）：Ctrl+Shift+M 在主窗口里随时可用（网页、离线页都一样，旧网页没有按钮也能切）。
  compactWindows().watch(win);
  // 「新版本已下载」提示窗挂在主窗口里，主窗口动了它跟着动（DESIGN.md §36.5）。
  for (const name of ["move", "resize", "show", "hide", "minimize", "restore", "maximize", "unmaximize"]) win.on(name, () => placeUpdateWindow());
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || !(input.control || input.meta) || !input.shift || input.alt) return;
    if (String(input.key).toLowerCase() !== "m") return;
    event.preventDefault();
    compactWindows().toggle(win);
  });
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    windows.chat = null;
    clearInterval(chatRetryTimer);
  });
  windows.chat = win;
  return win;
}

function showOffline(win, reason) {
  if (win.isDestroyed()) return;
  chatOffline = true;
  win.loadFile(path.join(UI, "offline.html"), { query: { error: String(reason).slice(0, 80) } });
  clearInterval(chatRetryTimer);
  chatRetryTimer = setInterval(() => {
    void retryChat().catch(() => {});
  }, 15000);
}

async function probeServer() {
  const response = await net.fetch(`${serverOrigin()}/`, { method: "HEAD", cache: "no-store" });
  return response.status < 500;
}

async function retryChat() {
  const win = windows.chat;
  if (!win || win.isDestroyed() || !chatOffline) return true;
  if (!(await probeServer().catch(() => false))) throw new Error("仍然连不上服务器。");
  chatOffline = false;
  clearInterval(chatRetryTimer);
  win.loadURL(`${serverOrigin()}${lastWebPath || "/"}`);
  return true;
}

// ---------- 托盘 ----------

function trayIcon(kind) {
  const image = nativeImage.createFromPath(path.join(ASSETS, `tray-${kind}.png`));
  return process.platform === "darwin" ? image.resize({ width: 18, height: 18 }) : image;
}

function statusKind() {
  if (config.get().localPaused) return "paused";
  return agent && agent.state === "online" ? "online" : "offline";
}

function statusText() {
  const local = config.get();
  if (!local.serverUrl) return "未登录";
  if (!config.getToken()) return enrollIssue || "已登录，但这台电脑还没登记为设备";
  if (local.localPaused) return "紧急停止中";
  switch (agent?.state) {
    case "online":
      return "在线";
    case "connecting":
      return "正在连接…";
    case "revoked":
      return agentDetail === "设备令牌无效" ? "设备令牌无效，请重新登记这台电脑" : "已被撤销，请重新登记这台电脑";
    default:
      return "离线（自动重连中）";
  }
}

function refreshTray() {
  if (!tray) return;
  const kind = statusKind();
  tray.setImage(trayIcon(kind));
  tray.setToolTip(`ChisaBot PC · ${statusText()}`);
  const paused = config.get().localPaused;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `状态：${statusText()}`, enabled: false },
      { type: "separator" },
      { label: "打开 ChisaBot", click: () => void openApp() },
      ...(needsEnroll()
        ? [{ label: "重新登记这台电脑", click: () => void repairDevice({ force: true, manual: true }) }]
        : []),
      ...(config.get().serverUrl
        ? [
            // 打开主窗口并直接弹出网页「绑定手机」二维码（DESIGN.md §33）。
            { label: "绑定手机…", click: () => void openApp("/settings/devices?pair=1") },
            { label: "这台电脑的权限…", click: () => void openDeviceSettings() },
            { label: "本机设置…", click: () => void openDeviceSettings("local") },
          ]
        : []),
      ...(updater?.state.status === "downloaded"
        ? [{ label: `重启以安装 ${updater.state.version || "新版本"}…`, click: () => openUpdateWindow() }]
        : []),
      { type: "separator" },
      {
        label: paused ? "解除紧急停止…" : "紧急停止（拒绝一切远程操作）",
        click: () => void requestPaused(!paused),
      },
      { type: "separator" },
      { label: "切换服务器…", click: () => openLogin("switch") },
      ...(config.get().serverUrl ? [{ label: "退出登录…", click: () => void confirmLogout() }] : []),
      { type: "separator" },
      {
        label: "退出 ChisaBot PC",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  broadcast();
}

// ---------- 节点 ----------

function screenshotHook({ maxWidth }) {
  const display = screen.getPrimaryDisplay();
  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  return desktopCapturer.getSources({ types: ["screen"], thumbnailSize: physical }).then((sources) => {
    const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!source) throw new Error("没有可截取的屏幕。");
    let image = source.thumbnail;
    const size = image.getSize();
    if (size.width > maxWidth) image = image.resize({ width: maxWidth, quality: "good" });
    const out = image.getSize();
    return {
      format: "png",
      width: out.width,
      height: out.height,
      screenWidth: physical.width,
      screenHeight: physical.height,
      scaleFactor: display.scaleFactor,
      note: "鼠标坐标使用 screenWidth × screenHeight（物理像素）",
      base64: image.toPNG().toString("base64"),
    };
  });
}

/** 已登录服务器，但这台电脑没有可用的设备令牌（没登记 / 令牌无效 / 被撤销）。 */
function needsEnroll() {
  if (!config.get().serverUrl) return false;
  return !config.getToken() || agent?.state === "revoked";
}

/**
 * 补登记这台电脑（agent/enrollment.js）。自动路径（启动时）只在本机完全没有令牌时登记；
 * 用户亲自点「重新登记」（托盘 / 网页设备页）时 force，作废无效或被撤销的旧令牌再登记。
 * 连不上服务器时每分钟自动重试；会话过期时提示重新登录，不弹登录窗打断用户。
 */
function repairDevice({ force = false, manual = false } = {}) {
  if (enrolling) return enrolling;
  clearTimeout(enrollRetryTimer);
  enrolling = ensureEnrolled({
    config,
    force,
    sessionStatus,
    cookieHeader: () => cookieHeaderFor(serverOrigin()),
    enroll: (input) => auth.enroll(input),
    checkToken: (input) => auth.checkToken(input),
    info: { ...clientInfo(), name: config.get().deviceName || os.hostname() },
  })
    .then((result) => {
      enrollIssue = result.status === "enrolled" || result.status === "already" || result.status === "no-server" ? "" : result.message;
      if (result.status === "enrolled" || result.status === "already") {
        if (result.status === "enrolled") {
          agentDetail = "";
          config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "enroll", outcome: "succeeded", summary: `${manual ? "重新登记" : "自动补登记"}：${result.message}` });
        }
        startAgent();
      } else if (result.status === "failed") {
        config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "enroll", outcome: "failed", summary: result.message.slice(0, 300) });
      } else if (result.status === "offline") {
        enrollRetryTimer = setTimeout(() => void repairDevice({ force }), 60_000);
      }
      if (manual && result.status === "login") void openApp();
      if (manual && Notification.isSupported() && result.status !== "already")
        new Notification({ title: "ChisaBot PC", body: result.message }).show();
      refreshTray();
      return result;
    })
    .finally(() => {
      enrolling = null;
    });
  return enrolling;
}

function startAgent() {
  if (agent) agent.stop();
  const local = config.get();
  if (!local.serverUrl || !config.getToken()) return refreshTray();
  const ops = createOps({
    clientVersion: pkg.version,
    hooks: {
      screenshot: screenshotHook,
      screenInfo: async () =>
        screen.getAllDisplays().map((d) => ({
          id: d.id,
          primary: d.id === screen.getPrimaryDisplay().id,
          width: Math.round(d.size.width * d.scaleFactor),
          height: Math.round(d.size.height * d.scaleFactor),
          scaleFactor: d.scaleFactor,
        })),
      clipboardRead: async () => clipboard.readText(),
      clipboardWrite: async (text) => clipboard.writeText(text),
      openExternal: (url) => shell.openExternal(url),
    },
  });
  agent = createNodeAgent({
    serverUrl: local.serverUrl,
    getToken: () => config.getToken(),
    ops,
    clientInfo: clientInfo(),
    approve: (request) => askApproval(request),
    local: () => ({ paused: config.get().localPaused, forceLocalApproval: config.get().forceLocalApproval }),
  });
  agent.events.on("state", (event) => {
    agentDetail = event && event.detail ? String(event.detail) : event && event.state === "online" ? "" : agentDetail;
    refreshTray();
  });
  // 连接失败（断网、DNS、证书）由 core 自己重连；没有监听时 EventEmitter 的 "error" 会让主进程崩溃。
  agent.events.on("error", () => {});
  agent.events.on("config", (device) => {
    if (device && typeof device.paused === "boolean" && device.paused !== config.get().localPaused)
      config.set({ localPaused: device.paused });
    if (device?.name) config.set({ deviceName: device.name, deviceId: device.id });
    refreshTray();
  });
  agent.events.on("audit", (entry) => {
    config.appendAudit(entry);
    broadcast("audit");
  });
  agent.events.on("call", ({ operation, botName }) => {
    if (operation === "input" || operation === "shell") tray?.setToolTip(`ChisaBot PC · ${botName || "机器人"} 正在操作…`);
  });
  agent.events.on("approval_closed", ({ id }) => closeApproval(id));
  agent.events.on("revoked", () => {
    refreshTray();
    if (Notification.isSupported())
      new Notification({ title: "ChisaBot PC", body: "这台电脑已被撤销，请重新登录。" }).show();
  });
  agent.start();
  refreshTray();
}

function setPaused(paused) {
  config.set({ localPaused: paused });
  config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: paused ? "kill_switch_on" : "kill_switch_off", outcome: "succeeded", summary: paused ? "紧急停止" : "解除紧急停止" });
  if (paused) {
    for (const item of approvalQueue.splice(0)) item.resolve("deny");
    if (currentApproval) {
      currentApproval.resolve("deny");
      currentApproval = null;
      approvalWindow?.close();
    }
  }
  agent?.setConfig({ paused });
  refreshTray();
}

/** 开启紧急停止立即生效；解除要本机确认（网页 / 托盘发起都一样）。返回最终是否处于紧急停止。 */
async function requestPaused(paused) {
  if (paused) {
    setPaused(true);
    return true;
  }
  if (!config.get().localPaused) return false;
  const ok = await confirmLocal({
    title: "解除紧急停止？",
    description: "解除后，机器人可以再次按这台电脑的权限设置操作它（「询问」的操作仍会先问你）。",
    confirmLabel: "解除紧急停止",
  });
  if (ok) setPaused(false);
  return config.get().localPaused;
}

// ---------- 本机确认窗 ----------
// 放松安全的改动在这里由本人确认。它是本机文件页面、独立窗口，网页里的脚本既看不到也点不到。

const confirmQueue = [];
let confirmCurrent = null;
let confirmWindow = null;

function confirmLocal({ title, description, confirmLabel }) {
  return new Promise((resolve) => {
    confirmQueue.push({ request: { id: `c${Date.now()}${Math.random().toString(36).slice(2, 6)}`, title, description, confirmLabel }, resolve });
    pumpConfirm();
  });
}

function pumpConfirm() {
  if (confirmCurrent || !confirmQueue.length) return;
  confirmCurrent = confirmQueue.shift();
  const parent = windows.chat && !windows.chat.isDestroyed() && windows.chat.isVisible() ? windows.chat : undefined;
  confirmWindow = new BrowserWindow({
    width: 440,
    height: 260,
    parent,
    modal: !!parent,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: !parent,
    show: false,
    title: "ChisaBot PC · 本机确认",
    backgroundColor: windowBackground(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  confirmWindow.loadFile(path.join(UI, "confirm.html"));
  confirmWindow.once("ready-to-show", () => {
    confirmWindow.show();
    confirmWindow.focus();
  });
  confirmWindow.on("closed", () => {
    confirmWindow = null;
    if (confirmCurrent) {
      confirmCurrent.resolve(false);
      confirmCurrent = null;
    }
    setTimeout(pumpConfirm, 100);
  });
}

// ---------- 审批弹窗 ----------

function askApproval(request) {
  return new Promise((resolve) => {
    if (config.get().localPaused) return resolve("deny");
    approvalQueue.push({ request, resolve });
    if (Notification.isSupported())
      new Notification({ title: "ChisaBot 请求操作这台电脑", body: `${request.botName || "机器人"}：${request.summary}` }).show();
    pumpApprovals();
  });
}

function pumpApprovals() {
  if (currentApproval || !approvalQueue.length) return;
  currentApproval = approvalQueue.shift();
  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  const height = 320;
  approvalWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - 16,
    y: workArea.y + workArea.height - height - 16,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    transparent: false,
    show: false,
    title: "ChisaBot 请求操作这台电脑",
    backgroundColor: windowBackground(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  approvalWindow.setAlwaysOnTop(true, "screen-saver");
  approvalWindow.loadFile(path.join(UI, "approval.html"));
  approvalWindow.once("ready-to-show", () => {
    approvalWindow.showInactive();
    approvalWindow.flashFrame(true);
  });
  approvalWindow.on("closed", () => {
    approvalWindow = null;
    if (currentApproval) {
      currentApproval.resolve("deny");
      currentApproval = null;
    }
    setTimeout(pumpApprovals, 150);
  });
}

function closeApproval(id) {
  const queued = approvalQueue.findIndex((item) => item.request.id === id);
  if (queued >= 0) approvalQueue.splice(queued, 1)[0].resolve("dismissed");
  if (currentApproval && currentApproval.request.id === id) {
    currentApproval.resolve("dismissed");
    currentApproval = null;
    approvalWindow?.close();
  }
}

// ---------- 在线更新 ----------
// 下载好后弹这个本机窗口（和本机确认同一套对话框）：立即重启 / 稍后。网页只能请它出来，不能替用户点。

function updateLogger() {
  const write = (level) => (...args) =>
    config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "update_log", outcome: level, summary: args.map(String).join(" ").slice(0, 300) });
  // 只记 warn / error；info 太多。
  return { info: () => {}, debug: () => {}, warn: write("warn"), error: write("error") };
}

function startUpdater() {
  let autoUpdater = null;
  if (app.isPackaged) {
    try {
      ({ autoUpdater } = require("electron-updater"));
    } catch {
      autoUpdater = null;
    }
  }
  updater = createUpdater({
    autoUpdater,
    feedUrl: buildConfig.resolveFeed(BUILD, config.get()),
    isPackaged: app.isPackaged,
    platform: process.platform,
    execPath: process.execPath,
    productName: pkg.productName || "ChisaBot PC",
    shellHash: SHELL_HASH,
    getAutoUpdate: () => config.get().autoUpdate !== false,
    logger: updateLogger(),
    onState: () => {
      refreshTray();
    },
    onDownloaded: (version) => {
      config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "update_downloaded", outcome: "succeeded", summary: `新版本 ${version || ""} 已下载` });
      if (Notification.isSupported())
        new Notification({ title: "ChisaBot PC", body: `新版本 ${version || ""} 已下载，重启以安装。` }).show();
      openUpdateWindow();
    },
  });
  updater.schedule();
}

function openUpdateWindow() {
  if (!updater || updater.state.status !== "downloaded") return false;
  if (updateWindow && !updateWindow.isDestroyed()) {
    placeUpdateWindow();
    updateWindow.show();
    updateWindow.focus();
    return true;
  }
  updateContentHeight = updater.state.fullInstall ? 280 : 260;
  updateWindow = new BrowserWindow({
    width: 440,
    height: updateContentHeight,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    title: "ChisaBot PC · 新版本",
    backgroundColor: windowBackground(),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true },
  });
  placeUpdateWindow();
  updateWindow.loadFile(path.join(UI, "update.html"));
  updateWindow.once("ready-to-show", () => updateWindow?.showInactive());
  updateWindow.on("closed", () => {
    updateWindow = null;
  });
  return true;
}

/** 提示窗内容的实际高度（update.js 量好后报上来，update:fit）。 */
let updateContentHeight = 260;

/**
 * 提示窗位置（DESIGN.md §36.5，update-placement.js）：主窗口看得见就挂在主窗口里（子窗口、顶栏下居中、跟着走）；
 * 主窗口在托盘里 / 最小化就放到它所在显示器的右下角并置顶。主窗口移动、改大小、显示 / 隐藏、进出小窗时都会重新调用。
 */
function placeUpdateWindow() {
  if (!updateWindow || updateWindow.isDestroyed()) return;
  const chat = windows.chat && !windows.chat.isDestroyed() ? windows.chat : null;
  const chatVisible = Boolean(chat && chat.isVisible() && !chat.isMinimized());
  const workArea = (chat ? screen.getDisplayMatching(chat.getBounds()) : screen.getPrimaryDisplay()).workArea;
  const b = computeUpdateBounds({ chat: chat ? chat.getBounds() : null, chatVisible, workArea, contentHeight: updateContentHeight });
  if (b.attached) {
    if (updateWindow.getParentWindow() !== chat) updateWindow.setParentWindow(chat);
    updateWindow.setAlwaysOnTop(false);
  } else {
    if (updateWindow.getParentWindow()) updateWindow.setParentWindow(null);
    updateWindow.setAlwaysOnTop(true);
  }
  updateWindow.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function installUpdateNow() {
  if (!updater || updater.state.status !== "downloaded") return false;
  const how = updater.state.fullInstall ? "重新安装" : "重启并安装";
  config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "update_install", outcome: "succeeded", summary: `${how} ${updater.state.version || ""}` });
  quitting = true;
  agent?.stop();
  setTimeout(() => updater.install(), 50);
  return true;
}

// ---------- 渲染进程接口 ----------

function publicState() {
  const local = config.get();
  return {
    version: pkg.version,
    platform: process.platform,
    hostname: os.hostname(),
    serverUrl: local.serverUrl,
    defaultServerUrl: BUILD.serverUrl,
    recentServers: Array.isArray(local.recentServers) ? local.recentServers.slice(0, 6) : [],
    remember: local.remember !== false,
    username: local.username,
    loggedIn: !!(local.serverUrl && config.getToken()),
    tokenProtected: config.tokenProtected(),
    status: statusKind(),
    statusText: statusText(),
    agentState: agent?.state ?? "offline",
    device: agent?.device ?? null,
    appearance: local.appearance,
    local: { autoStart: local.autoStart, forceLocalApproval: local.forceLocalApproval, localPaused: local.localPaused, startHidden: local.startHidden },
  };
}

/** 给网页本机桥的状态（只有网页「本机」标签需要的字段，没有令牌、没有账号）。 */
function webLocalState() {
  const local = config.get();
  return {
    version: pkg.version,
    platform: process.platform,
    hostname: os.hostname(),
    serverUrl: local.serverUrl,
    deviceId: local.deviceId,
    agentState: agent?.state ?? "offline",
    statusText: statusText(),
    /** 本机有没有设备令牌；false = 已登录但没登记（网页设备页显示「登记这台电脑」）。 */
    enrolled: !!config.getToken(),
    /** 需要用户点「重新登记这台电脑」（没登记 / 令牌无效 / 被撤销）。 */
    needsEnroll: needsEnroll(),
    tokenProtected: config.tokenProtected(),
    localPaused: local.localPaused,
    forceLocalApproval: local.forceLocalApproval,
    autoStart: local.autoStart,
    startHidden: local.startHidden,
    autoUpdate: local.autoUpdate !== false,
    update: updater ? updater.state : { supported: false, status: "idle" },
  };
}

function broadcast(kind = "state") {
  for (const win of [windows.login, windows.chat, approvalWindow, confirmWindow, updateWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send("state:changed", kind);
  }
}

async function injectCookies(origin, cookies) {
  const ses = session.fromPartition(PARTITION);
  for (const cookie of cookies) {
    // 跟服务器给的寿命走：有 Max-Age / Expires 就是持久 Cookie（记住登录 = 30 天），没有就是会话 Cookie
    // （没勾记住登录：退出客户端后失效，下次启动回到本机登录页）。
    let expirationDate;
    if (cookie.maxAge > 0) expirationDate = Math.floor(Date.now() / 1000) + cookie.maxAge;
    else if (cookie.expires > Date.now()) expirationDate = Math.floor(cookie.expires / 1000);
    await ses.cookies.set({
      url: `${origin}/`,
      name: cookie.name,
      value: cookie.value,
      path: "/",
      secure: origin.startsWith("https:"),
      httpOnly: cookie.httpOnly !== false,
      sameSite: "lax",
      ...(expirationDate ? { expirationDate } : {}),
    });
  }
  await ses.cookies.flushStore();
}

/** 本机页面（file://…/src/ui/）发来的调用。 */
function isTopFrame(event) {
  return !!event.senderFrame && !event.senderFrame.parent;
}

function fromLocalUi(event) {
  if (!isTopFrame(event)) return false;
  try {
    // 比较解码后的路径，安装目录里有空格或中文（如 C:\Users\张三\…）时 URL 编码方式不影响判断。
    const file = path.resolve(fileURLToPath(event.senderFrame.url));
    const root = path.resolve(UI) + path.sep;
    return process.platform === "win32" ? file.toLowerCase().startsWith(root.toLowerCase()) : file.startsWith(root);
  } catch {
    return false;
  }
}

/** 主窗口里的本机离线页（file://）：同样要能最小化 / 关闭无边框窗口。 */
function fromChatLocalPage(event) {
  const chat = windows.chat;
  return Boolean(chat && !chat.isDestroyed() && event.sender === chat.webContents && String(event.senderFrame?.url || "").startsWith("file:"));
}

/** 网页本机桥：只认主窗口、顶层框架、而且是已登录的那台服务器。 */
function fromServerPage(event) {
  const chat = windows.chat;
  if (!chat || chat.isDestroyed() || event.sender !== chat.webContents) return false;
  if (!isTopFrame(event)) return false;
  return isServerUrl(event.senderFrame.url) && !!serverOrigin();
}

function handleLocal(channel, fn) {
  ipcMain.handle(channel, (event, payload) => {
    if (!fromLocalUi(event)) throw new Error("拒绝：调用来源不是 ChisaBot PC 本机页面。");
    return fn(payload, event);
  });
}

function handleWeb(channel, fn) {
  ipcMain.handle(channel, (event, payload) => {
    if (!fromServerPage(event)) throw new Error("拒绝：只有已登录服务器的页面可以使用本机桥。");
    return fn(payload, event);
  });
}

/** 小窗模式控制器（主进程里只有一个，app ready 之后才能用 screen）。 */
let compactController = null;
function compactWindows() {
  if (!compactController) {
    compactController = createCompactController({
      screen,
      onChange: (win, compact) => {
        if (!win.isDestroyed()) win.webContents.send("window:compact", compact);
      },
    });
  }
  return compactController;
}

/** 无边框主窗口的窗口控制：已登录服务器的顶层页面，或主窗口里的本机离线页。 */
function handleChatWindow(channel, fn) {
  ipcMain.handle(channel, (event, payload) => {
    if (!fromServerPage(event) && !fromChatLocalPage(event)) throw new Error("拒绝：只有主窗口可以控制窗口。");
    return fn(payload, event);
  });
}

/** 作废这台电脑在 serverUrl 上的设备令牌并清掉本机记录（退出登录、换服务器时用）。 */
async function dropDevice(serverUrl) {
  clearTimeout(enrollRetryTimer);
  enrollIssue = "";
  agentDetail = "";
  const token = config.getToken();
  agent?.stop();
  agent = null;
  if (token && serverUrl) await auth.unenroll({ serverUrl, token }).catch(() => false);
  config.setToken(null);
  config.set({ deviceId: "", deviceName: "", localPaused: false });
}

/** 退出登录：网页会话作废 + 设备令牌作废 + 清 Cookie。保留服务器地址和账号，登录页直接预填。 */
async function logout() {
  const local = config.get();
  if (local.serverUrl) {
    const origin = serverOrigin();
    await auth.logoutSession({ serverUrl: origin, cookieHeader: await cookieHeaderFor(origin).catch(() => "") }).catch(() => false);
  }
  await dropDevice(local.serverUrl);
  config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "logout", outcome: "succeeded", summary: "退出登录（会话和设备令牌已作废）" });
  await session.fromPartition(PARTITION).clearStorageData({ storages: ["cookies"] });
  if (windows.chat && !windows.chat.isDestroyed()) windows.chat.destroy();
  windows.chat = null;
  refreshTray();
  openLogin("logout");
}

async function confirmLogout() {
  const ok = await confirmLocal({
    title: "退出登录？",
    description: "会作废这台电脑的设备令牌并清除登录状态，机器人不能再操作它。之后可以重新登录或换一台服务器。",
    confirmLabel: "退出登录",
  });
  if (ok) setTimeout(() => void logout(), 50);
  return ok;
}

/**
 * 本机登录页的「登录」：先 probe（login:probe）再调这里。
 * 换了服务器时先作废旧服务器上的设备令牌；同一台服务器且令牌仍有效时不重复登记。
 * 设备登记失败（例如服务器还不支持 PC 设备）不挡登录，只在结果里带上 warning。
 */
async function submitLogin(input) {
  const serverUrl = auth.normalizeServerUrl(input.serverUrl);
  const username = String(input.username || "").trim();
  const remember = input.remember === true;
  const sessionInfo = await auth.login({ serverUrl, username, password: String(input.password || ""), remember });
  const prev = config.get();
  const ses = session.fromPartition(PARTITION);
  if (prev.serverUrl && prev.serverUrl !== serverUrl) {
    await dropDevice(prev.serverUrl);
    if (windows.chat && !windows.chat.isDestroyed()) windows.chat.destroy();
    windows.chat = null;
    await ses.clearStorageData({ storages: ["cookies"] });
  }
  await injectCookies(serverUrl, sessionInfo.cookies);
  const recent = [serverUrl, ...(Array.isArray(prev.recentServers) ? prev.recentServers : []).filter((s) => s !== serverUrl)].slice(0, 6);
  config.set({ serverUrl, username, remember, recentServers: recent });

  let device = null;
  let warning = "";
  const token = config.getToken();
  if (token) {
    const check = await auth.checkToken({ serverUrl, token }).catch(() => ({ ok: false }));
    if (check.ok) device = check.device;
    else if (check.revoked || check.invalid) config.setToken(null);
  }
  if (!config.getToken()) {
    try {
      const result = await auth.enroll({
        serverUrl,
        cookieHeader: sessionInfo.cookieHeader,
        info: { ...clientInfo(), name: config.get().deviceName || os.hostname() },
      });
      config.set({ deviceId: result.device.id, deviceName: result.device.name, localPaused: false });
      config.setToken(result.token);
      device = result.device;
    } catch (error) {
      warning = `已登录，但这台电脑没能登记为设备：${error.message}`;
      config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "enroll", outcome: "failed", summary: warning.slice(0, 300) });
    }
  }
  config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "login", outcome: "succeeded", summary: `登录 ${serverUrl}（${remember ? "记住登录" : "本次会话"}）` });
  clearTimeout(enrollRetryTimer);
  enrollIssue = warning;
  agentDetail = "";
  startAgent();
  return { device, warning };
}

async function setLocal(patch) {
  const current = config.get();
  if (typeof patch.localPaused === "boolean" && patch.localPaused !== current.localPaused) await requestPaused(patch.localPaused);
  if (typeof patch.forceLocalApproval === "boolean" && patch.forceLocalApproval !== current.forceLocalApproval) {
    const ok =
      patch.forceLocalApproval ||
      (await confirmLocal({
        title: "关闭高风险操作的本机确认？",
        description: "关闭后，权限里设为「允许」的命令行、写入文件、鼠标键盘会直接执行，不再在这台电脑上弹窗。建议保持开启。",
        confirmLabel: "仍然关闭",
      }));
    if (ok) {
      config.set({ forceLocalApproval: patch.forceLocalApproval });
      config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "config_changed", outcome: "succeeded", summary: `本机确认 → ${patch.forceLocalApproval ? "开启" : "关闭"}` });
    }
  }
  if (typeof patch.autoStart === "boolean") {
    config.set({ autoStart: patch.autoStart });
    if (app.isPackaged || process.platform === "win32") app.setLoginItemSettings({ openAtLogin: patch.autoStart, args: ["--hidden"] });
  }
  if (typeof patch.startHidden === "boolean") config.set({ startHidden: patch.startHidden });
  if (typeof patch.autoUpdate === "boolean" && patch.autoUpdate !== (current.autoUpdate !== false)) {
    config.set({ autoUpdate: patch.autoUpdate });
    config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "config_changed", outcome: "succeeded", summary: `自动更新 → ${patch.autoUpdate ? "开启" : "关闭"}` });
    updater?.schedule();
  }
  refreshTray();
  return webLocalState();
}

function registerIpc() {
  // 本机页面（设置向导 / 审批 / 本机确认 / 离线页）
  handleLocal("state:get", () => publicState());
  // 本机登录页（ui/login.html）。错误带 kind，登录页据此把提示放到对应输入框旁；
  // ipc 只能传 message，所以把 kind 编进 message 前缀「[kind] 」，页面再拆开。
  const tagged = (fn) => async (payload) => {
    try {
      return await fn(payload || {});
    } catch (error) {
      throw new Error(`[${error.kind || "invalid"}] ${error.message}`);
    }
  };
  handleLocal("login:probe", tagged(async ({ serverUrl }) => {
    const result = await auth.probe({ serverUrl });
    return { origin: result.origin, gateway: result.gateway };
  }));
  handleLocal("login:submit", tagged((input) => submitLogin(input)));
  handleLocal("login:forget", (serverUrl) => {
    const recent = (config.get().recentServers || []).filter((s) => s !== serverUrl);
    config.set({ recentServers: recent });
    return recent;
  });
  handleLocal("login:open", () => {
    if (windows.login && !windows.login.isDestroyed()) windows.login.close();
    openChat();
  });
  handleLocal("paused:set", async (paused) => {
    await requestPaused(!!paused);
    return publicState();
  });
  handleLocal("chat:retry", () => retryChat());
  handleLocal("approval:current", () => currentApproval?.request ?? null);
  handleLocal("approval:decide", ({ id, decision }) => {
    if (currentApproval && currentApproval.request.id === id) {
      currentApproval.resolve(decision === "approve" ? "approve" : "deny");
      currentApproval = null;
      approvalWindow?.close();
    }
  });
  handleLocal("update:current", () =>
    updater && updater.state.status === "downloaded"
      ? { version: updater.state.version || "", currentVersion: pkg.version, fullInstall: !!updater.state.fullInstall }
      : null,
  );
  handleLocal("update:fit", ({ height } = {}) => {
    if (typeof height === "number" && Number.isFinite(height)) updateContentHeight = Math.ceil(height);
    placeUpdateWindow();
    return true;
  });
  handleLocal("update:answer", ({ restart } = {}) => {
    if (restart === true) return installUpdateNow();
    updateWindow?.close();
    return false;
  });
  handleLocal("confirm:current", () => confirmCurrent?.request ?? null);
  handleLocal("confirm:answer", ({ id, ok }) => {
    if (confirmCurrent && confirmCurrent.request.id === id) {
      confirmCurrent.resolve(ok === true);
      confirmCurrent = null;
      confirmWindow?.close();
    }
  });

  // 网页本机桥（web-preload.js → window.chisabotPC）
  ipcMain.on("pc:origin", (event) => {
    event.returnValue = event.sender === windows.chat?.webContents ? serverOrigin() : "";
  });
  handleWeb("pc:state", () => webLocalState());
  // 无边框主窗口的窗口控制（网页顶栏右上角）。关闭 = 和原来点 ✕ 一样隐藏到托盘。
  const chatWin = (event) => (fromServerPage(event) || fromChatLocalPage(event) ? windows.chat : null);
  ipcMain.on("window:minimize", (event) => chatWin(event)?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    const win = chatWin(event);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", (event) => chatWin(event)?.close());
  handleChatWindow("window:is-maximized", () => Boolean(windows.chat && !windows.chat.isDestroyed() && windows.chat.isMaximized()));
  // 小窗模式：网页右上角的「小窗模式 / 恢复窗口」按钮。
  ipcMain.on("window:toggle-compact", (event) => {
    const win = chatWin(event);
    if (win) compactWindows().toggle(win);
  });
  handleChatWindow("window:is-compact", () => compactWindows().isCompact(windows.chat));
  handleWeb("pc:set", (patch) => setLocal(patch && typeof patch === "object" ? patch : {}));
  handleWeb("pc:pick-folders", async () => {
    const result = await dialog.showOpenDialog(windows.chat, {
      title: "选择允许机器人访问的文件夹",
      properties: ["openDirectory", "multiSelections", "createDirectory", "dontAddToRecent"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleWeb("pc:logout", () => confirmLogout());
  // 网页设备页的「登记这台电脑」：和托盘「重新登记这台电脑」同一条路径（本机亲自操作，所以 force）。
  handleWeb("pc:enroll", async () => {
    // 这台电脑是被人撤销的：网页脚本不能替用户把它重新接回去，先在本机确认（和解除紧急停止同一道闸）。
    if (agent?.state === "revoked" && agentDetail !== "设备令牌无效") {
      const ok = await confirmLocal({
        title: "重新登记这台电脑？",
        description: "这台电脑之前被撤销了关联。重新登记后它会作为新设备出现在设备列表里，所有能力仍默认关闭。",
        confirmLabel: "重新登记",
      });
      if (!ok) return { status: "cancelled", message: "已取消。", state: webLocalState() };
    }
    const result = await repairDevice({ force: true, manual: true });
    return { status: result.status, message: result.message, state: webLocalState() };
  });
  handleWeb("pc:check-update", async () => (updater ? updater.check() : { supported: false, status: "idle" }));
  // 网页只能把「新版本已下载」的本机窗口叫出来；立即重启要在那个窗口里由本人点。
  handleWeb("pc:install-update", () => openUpdateWindow());
  handleWeb("pc:appearance", (value) => {
    const next = { dark: typeof value?.dark === "boolean" ? value.dark : null, sky: value?.sky !== false };
    const prev = config.get().appearance || {};
    if (prev.dark !== next.dark || prev.sky !== next.sky) {
      config.set({ appearance: next });
      nativeTheme.themeSource = next.dark === null ? "system" : next.dark ? "dark" : "light";
      broadcast("appearance");
    }
    return true;
  });
}

// ---------- 生命周期 ----------

app.on("second-instance", () => void openApp());
app.on("window-all-closed", () => {
  /* 常驻托盘 */
});
app.on("before-quit", () => {
  quitting = true;
  agent?.stop();
  // 下载好的更新需要重新安装（换了图标 / 组件）而用户选了「稍后」：退出这一刻静默重新安装。
  if (updater?.installOnQuit())
    config?.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "update_install", outcome: "succeeded", summary: `退出时重新安装 ${updater.state.version || ""}` });
});

// ---------- 外壳刷新（src/shell-refresh.js） ----------
// 新版本第一次启动且外壳指纹变了：把指向本程序的桌面 / 开始菜单 / 任务栏快捷方式按新 exe 重写，刷新图标缓存。

function refreshShellIfChanged() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const last = config.get().shellHash || "";
  if (!shellRefresh.needsShellRefresh({ current: SHELL_HASH, last })) return;
  let result = { updated: [], cacheRefreshed: false };
  try {
    result = shellRefresh.refreshShell({
      shell,
      execPath: process.execPath,
      appUserModelId: APP_USER_MODEL_ID,
      candidates: shellRefresh.shortcutCandidates({
        desktopDir: app.getPath("desktop"),
        appData: process.env.APPDATA,
        shortcutName: pkg.build?.nsis?.shortcutName || pkg.productName || "ChisaBot PC",
      }),
      systemRoot: process.env.SystemRoot || process.env.windir,
      osRelease: os.release(),
      run: (cmd, args) => {
        const child = require("node:child_process").spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
        child.on("error", () => {});
        child.unref();
      },
      log: (line) => config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "shell_refresh", outcome: "warn", summary: line.slice(0, 300) }),
    });
  } finally {
    config.set({ shellHash: SHELL_HASH });
  }
  config.appendAudit({
    at: new Date().toISOString(),
    actor: "本机",
    operation: "shell_refresh",
    outcome: "succeeded",
    summary: `外壳已更新（${SHELL_HASH}）：快捷方式 ${result.updated.length} 个${result.cacheRefreshed ? "，已刷新图标缓存" : ""}`,
  });
}

app.whenReady().then(() => {
  config = createConfig({ dir: app.getPath("userData"), safeStorage });
  const appearance = config.get().appearance || {};
  nativeTheme.themeSource = typeof appearance.dark === "boolean" ? (appearance.dark ? "dark" : "light") : "system";
  registerIpc();
  startUpdater();
  setTimeout(() => {
    try {
      refreshShellIfChanged();
    } catch {}
  }, 3000);
  tray = new Tray(trayIcon("offline"));
  tray.on("click", () => void openApp());
  tray.on("double-click", () => void openApp());
  refreshTray();
  if (config.get().serverUrl) {
    if (config.getToken()) startAgent();
    // 已登录但没有设备令牌（重装、令牌解不开、旧版配置）：用还有效的会话补登记，不再永远「看不到这台电脑」。
    else void repairDevice();
    if (!HIDDEN && !config.get().startHidden) void openApp();
  } else {
    openLogin();
  }
});
