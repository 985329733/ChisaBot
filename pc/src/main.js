"use strict";
/**
 * ChisaBot PC 客户端（Electron 主进程）。docs/pc-node.md §8。
 *
 *  - 首次运行：设置向导（服务器地址 + 账号密码）→ 登录网关 → 登记设备拿到令牌（DPAPI 加密保存）
 *  - 聊天窗口：直接载入该服务器的 ChisaBot 网页（登录 Cookie 已注入），关闭时缩到托盘
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
} = require("electron");
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
const windows = { setup: null, chat: null, settings: null };
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
    backgroundColor: "#cfe4fb",
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

function openSetup() {
  return localWindow("setup", "setup.html", { width: 460, height: 680, resizable: false, maximizable: false });
}

function openSettings() {
  return localWindow("settings", "settings.html", { width: 940, height: 760 });
}

function openChat() {
  const { serverUrl } = config.get();
  if (!serverUrl) return openSetup();
  if (windows.chat && !windows.chat.isDestroyed()) {
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
    backgroundColor: "#cfe4fb",
    webPreferences: { partition: PARTITION, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadURL(serverUrl);
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(serverUrl)) return { action: "allow" };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(serverUrl)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    windows.chat = null;
  });
  windows.chat = win;
  return win;
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
      { label: "打开聊天", click: () => openChat() },
      { label: "设置与权限…", click: () => openSettings() },
      { type: "separator" },
      {
        label: paused ? "解除紧急停止" : "紧急停止（拒绝一切远程操作）",
        click: () => setPaused(!paused),
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
  const width = 440;
  const height = 300;
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
    backgroundColor: "#eaf3fd",
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
    local: { autoStart: local.autoStart, forceLocalApproval: local.forceLocalApproval, localPaused: local.localPaused },
  };
}

function broadcast(kind = "state") {
  for (const win of [windows.settings, windows.setup]) {
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

function registerIpc() {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("setup:login", async (_event, input) => {
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
  ipcMain.handle("setup:done", () => {
    windows.setup?.close();
    openChat();
    openSettings();
  });
  ipcMain.handle("cap:set", (_event, { capability, policy }) => {
    if (!agent?.setConfig({ capabilities: { [capability]: policy } })) throw new Error("当前离线，连接后再修改。");
    config.appendAudit({ at: new Date().toISOString(), actor: "本机", operation: "config_changed", outcome: "succeeded", summary: `${capability} → ${policy}` });
    return publicState();
  });
  ipcMain.handle("roots:add", async () => {
    const result = await dialog.showOpenDialog(windows.settings ?? undefined, {
      title: "选择允许机器人访问的文件夹",
      properties: ["openDirectory", "multiSelections", "createDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return publicState();
    const current = agent?.device?.allowedRoots ?? [];
    const next = [...current];
    for (const p of result.filePaths) if (!next.some((r) => r.toLowerCase() === p.toLowerCase())) next.push(p);
    if (!agent?.setConfig({ allowedRoots: next })) throw new Error("当前离线，连接后再修改。");
    return publicState();
  });
  ipcMain.handle("roots:remove", (_event, root) => {
    const next = (agent?.device?.allowedRoots ?? []).filter((r) => r !== root);
    if (!agent?.setConfig({ allowedRoots: next })) throw new Error("当前离线，连接后再修改。");
    return publicState();
  });
  ipcMain.handle("device:rename", (_event, name) => {
    if (!agent?.setConfig({ name: String(name || "").slice(0, 64) })) throw new Error("当前离线，连接后再修改。");
    return publicState();
  });
  ipcMain.handle("paused:set", (_event, paused) => {
    setPaused(!!paused);
    return publicState();
  });
  ipcMain.handle("local:set", (_event, patch) => {
    const next = {};
    if (typeof patch.autoStart === "boolean") {
      next.autoStart = patch.autoStart;
      app.setLoginItemSettings({ openAtLogin: patch.autoStart, args: ["--hidden"] });
    }
    if (typeof patch.forceLocalApproval === "boolean") next.forceLocalApproval = patch.forceLocalApproval;
    config.set(next);
    return publicState();
  });
  ipcMain.handle("audit:get", () => config.readAudit(300));
  ipcMain.handle("chat:open", () => openChat());
  ipcMain.handle("web:devices", () => {
    const win = openChat();
    win.loadURL(`${config.get().serverUrl}/settings/devices`);
  });
  ipcMain.handle("account:logout", async (_event, { keepServer } = {}) => {
    const local = config.get();
    const token = config.getToken();
    agent?.stop();
    agent = null;
    if (token && local.serverUrl) await auth.unenroll({ serverUrl: local.serverUrl, token }).catch(() => false);
    config.setToken(null);
    config.set({ deviceId: "", deviceName: "", localPaused: false, ...(keepServer ? {} : {}) });
    await session.fromPartition(PARTITION).clearStorageData({ storages: ["cookies"] });
    windows.chat?.destroy();
    refreshTray();
    windows.settings?.close();
    openSetup();
    return publicState();
  });
  ipcMain.handle("approval:current", () => currentApproval?.request ?? null);
  ipcMain.handle("approval:decide", (_event, { id, decision }) => {
    if (currentApproval && currentApproval.request.id === id) {
      currentApproval.resolve(decision === "approve" ? "approve" : "deny");
      currentApproval = null;
      approvalWindow?.close();
    }
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
