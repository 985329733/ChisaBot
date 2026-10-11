"use strict";
/**
 * ChisaBot PC 客户端（Electron 主进程）。docs/pc-node.md §8。
 *
 *  - 首次运行：设置向导（服务器地址 + 账号密码）→ 登录网关 → 登记设备拿到令牌（DPAPI 加密保存）
 *  - 主窗口：直接载入该服务器的 ChisaBot 网页（登录 Cookie 已注入）——聊天、偏好设置、管理后台和网页完全同一套
 *    界面；本机设置就是网页的 偏好设置 → 设备 → 这台电脑（「本机」标签），通过 web-preload.js 的本机桥读写
 *    只能在本机做的事（紧急停止、本机确认、开机自启、文件夹选择器、退出登录）。关闭时缩到托盘。
 *  - 本机窗口（设置向导、审批弹窗、本机确认、离线页）用网页同一套 Skyglass 令牌（ui/skyglass-tokens.css）
 *  - 托盘：在线 / 离线 / 紧急停止三种图标；菜单含紧急停止
 *  - 节点：agent/core.js 出站 WebSocket；审批弹窗；本机审计日志
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
const pkg = require("../package.json");

const PARTITION = "persist:chisabot";
const ASSETS = path.join(__dirname, "..", "assets");
const UI = path.join(__dirname, "ui");
const HIDDEN = process.argv.includes("--hidden");

if (process.platform === "win32") app.setAppUserModelId("cn.ayase.chisabot.pc");
if (!app.requestSingleInstanceLock()) app.quit();

let config;
let agent = null;
let tray = null;
const windows = { setup: null, chat: null };
const UI_URL = pathToFileURL(UI).href; // 只用于 will-navigate 放行本机离线页
let quitting = false;
const approvalQueue = [];
let approvalWindow = null;
let currentApproval = null;

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

function localWindow(name, file, options = {}) {
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
  win.loadFile(path.join(UI, file));
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

function openSetup() {
  return localWindow("setup", "setup.html", { width: 480, height: 760, minWidth: 400, minHeight: 600, maximizable: false });
}

/** 本机设置 = 网页 偏好设置 → 设备 → 这台电脑。tab：permissions | local | audit | settings。 */
function openDeviceSettings(tab) {
  const { deviceId } = config.get();
  const query = tab ? `?tab=${encodeURIComponent(tab)}` : "";
  return openChat(deviceId ? `/settings/devices/${encodeURIComponent(deviceId)}${query}` : "/settings/devices");
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
  if (!serverUrl) return openSetup();
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
  win.webContents.on("will-navigate", (event, url) => {
    if (isServerUrl(url) || url.startsWith(UI_URL)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("did-navigate", (_event, url) => {
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
  if (!local.serverUrl || !config.getToken()) return "未登录";
  if (local.localPaused) return "紧急停止中";
  switch (agent?.state) {
    case "online":
      return "在线";
    case "connecting":
      return "正在连接…";
    case "revoked":
      return "已被撤销，请重新登录";
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
      { label: "打开 ChisaBot", click: () => openChat() },
      { label: "这台电脑的权限…", click: () => openDeviceSettings() },
      { label: "本机设置…", click: () => openDeviceSettings("local") },
      { type: "separator" },
      {
        label: paused ? "解除紧急停止…" : "紧急停止（拒绝一切远程操作）",
        click: () => void requestPaused(!paused),
      },
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
  agent.events.on("state", () => refreshTray());
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

// ---------- 渲染进程接口 ----------

function publicState() {
  const local = config.get();
  return {
    version: pkg.version,
    platform: process.platform,
    hostname: os.hostname(),
    serverUrl: local.serverUrl,
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
    tokenProtected: config.tokenProtected(),
    localPaused: local.localPaused,
    forceLocalApproval: local.forceLocalApproval,
    autoStart: local.autoStart,
    startHidden: local.startHidden,
  };
}

function broadcast(kind = "state") {
  for (const win of [windows.setup, windows.chat, approvalWindow, confirmWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send("state:changed", kind);
  }
}

async function injectCookies(origin, cookies) {
  const ses = session.fromPartition(PARTITION);
  for (const cookie of cookies) {
    const lifetime = cookie.maxAge ? cookie.maxAge : 30 * 24 * 3600;
    await ses.cookies.set({
      url: `${origin}/`,
      name: cookie.name,
      value: cookie.value,
      path: "/",
      secure: origin.startsWith("https:"),
      httpOnly: cookie.httpOnly !== false,
      sameSite: "lax",
      expirationDate: Math.floor(Date.now() / 1000) + lifetime,
    });
  }
}

/** 本机页面（file://…/src/ui/）发来的调用。 */
function isTopFrame(event) {
  return !!event.senderFrame && !event.senderFrame.parent;
}

function fromLocalUi(event) {
  if (!isTopFrame(event)) return false;
  try {
    // 比较解码后的路径，安装目录里有空格或中文（如 C:\Users\程天宇\…）时 URL 编码方式不影响判断。
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

async function logout() {
  const local = config.get();
  const token = config.getToken();
  agent?.stop();
  agent = null;
  if (token && local.serverUrl) await auth.unenroll({ serverUrl: local.serverUrl, token }).catch(() => false);
  config.setToken(null);
  config.set({ deviceId: "", deviceName: "", localPaused: false });
  config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "logout", outcome: "succeeded", summary: "退出登录（令牌已作废）" });
  await session.fromPartition(PARTITION).clearStorageData({ storages: ["cookies"] });
  windows.chat?.destroy();
  refreshTray();
  openSetup();
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
  refreshTray();
  return webLocalState();
}

function registerIpc() {
  // 本机页面（设置向导 / 审批 / 本机确认 / 离线页）
  handleLocal("state:get", () => publicState());
  handleLocal("setup:login", async (input) => {
    const serverUrl = auth.normalizeServerUrl(input.serverUrl);
    const sessionInfo = await auth.login({ serverUrl, username: input.username, password: input.password });
    await injectCookies(serverUrl, sessionInfo.cookies);
    const result = await auth.enroll({
      serverUrl,
      cookieHeader: sessionInfo.cookieHeader,
      info: { ...clientInfo(), name: (input.deviceName || "").trim() || os.hostname() },
    });
    config.set({ serverUrl, username: input.username, deviceId: result.device.id, deviceName: result.device.name, localPaused: false });
    config.setToken(result.token);
    startAgent();
    return { device: result.device };
  });
  handleLocal("setup:done", () => {
    windows.setup?.close();
    openDeviceSettings();
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
  ipcMain.handle("window:is-maximized", (event) => Boolean(chatWin(event)?.isMaximized()));
  handleWeb("pc:set", (patch) => setLocal(patch && typeof patch === "object" ? patch : {}));
  handleWeb("pc:pick-folders", async () => {
    const result = await dialog.showOpenDialog(windows.chat, {
      title: "选择允许机器人访问的文件夹",
      properties: ["openDirectory", "multiSelections", "createDirectory", "dontAddToRecent"],
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleWeb("pc:logout", async () => {
    const ok = await confirmLocal({
      title: "退出登录？",
      description: "会作废这台电脑的设备令牌并清除登录状态，机器人不能再操作它。之后可以重新登录或换一台服务器。",
      confirmLabel: "退出登录",
    });
    if (ok) setTimeout(() => void logout(), 50);
    return ok;
  });
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

app.on("second-instance", () => (config.get().serverUrl && config.getToken() ? openChat() : openSetup()));
app.on("window-all-closed", () => {
  /* 常驻托盘 */
});
app.on("before-quit", () => {
  quitting = true;
  agent?.stop();
});

app.whenReady().then(() => {
  config = createConfig({ dir: app.getPath("userData"), safeStorage });
  const appearance = config.get().appearance || {};
  nativeTheme.themeSource = typeof appearance.dark === "boolean" ? (appearance.dark ? "dark" : "light") : "system";
  registerIpc();
  tray = new Tray(trayIcon("offline"));
  tray.on("click", () => openChat());
  tray.on("double-click", () => openChat());
  refreshTray();
  if (config.get().serverUrl && config.getToken()) {
    startAgent();
    if (!HIDDEN && !config.get().startHidden) openChat();
  } else {
    openSetup();
  }
});
