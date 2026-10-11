"use strict";
/**
 * 主窗口的 preload（docs/pc-node.md §8.2）。主窗口载入的是服务器上的 ChisaBot 网页本身。
 *
 *  - 网页（且只在已登录的那台服务器的顶层页面）里注入 window.chisabotPC：本机桥，只开放网页做不到的本机事情；
 *    主进程对每次调用再核对来源（主窗口 + 顶层框架 + 服务器 origin），放松安全的改动弹本机确认窗。
 *  - 网页的外观（深色 / 时间天空）转告主进程，本机窗口跟着网页走。
 *  - 主窗口断网时显示的本机离线页（file://）拿到和其它本机页面一样的 window.chisa（少量通道）。
 */
const { contextBridge, ipcRenderer } = require("electron");

const isLocalPage = location.protocol === "file:";

/** 无边框主窗口的窗口控制：网页顶栏 / 离线页右上角的 最小化 · 最大化 · 关闭。 */
function exposeWindowControls() {
  contextBridge.exposeInMainWorld("chisabotWindow", {
    platform: process.platform,
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    onMaximizedChange(callback) {
      const listener = (_event, value) => callback(Boolean(value));
      ipcRenderer.on("window:maximized", listener);
      return () => ipcRenderer.removeListener("window:maximized", listener);
    },
  });
}

if (isLocalPage) {
  exposeWindowControls();
  const CHANNELS = new Set(["state:get", "paused:set", "chat:retry"]);
  contextBridge.exposeInMainWorld("chisa", {
    invoke(channel, payload) {
      if (!CHANNELS.has(channel)) return Promise.reject(new Error(`未知操作 ${channel}`));
      return ipcRenderer.invoke(channel, payload);
    },
    onState(callback) {
      const listener = (_event, kind) => callback(kind);
      ipcRenderer.on("state:changed", listener);
      return () => ipcRenderer.removeListener("state:changed", listener);
    },
  });
} else {
  let origin = "";
  try {
    origin = ipcRenderer.sendSync("pc:origin");
  } catch {}
  if (origin && location.origin === origin && window.top === window) {
    exposeWindowControls();
    const bool = (v) => (typeof v === "boolean" ? v : undefined);
    contextBridge.exposeInMainWorld("chisabotPC", {
      state: () => ipcRenderer.invoke("pc:state"),
      setLocal: (patch) =>
        ipcRenderer.invoke("pc:set", {
          localPaused: bool(patch && patch.localPaused),
          forceLocalApproval: bool(patch && patch.forceLocalApproval),
          autoStart: bool(patch && patch.autoStart),
          startHidden: bool(patch && patch.startHidden),
          autoUpdate: bool(patch && patch.autoUpdate),
        }),
      checkUpdate: () => ipcRenderer.invoke("pc:check-update"),
      installUpdate: () => ipcRenderer.invoke("pc:install-update"),
      pickFolders: () => ipcRenderer.invoke("pc:pick-folders"),
      logout: () => ipcRenderer.invoke("pc:logout"),
      onChange(callback) {
        const listener = () => callback();
        ipcRenderer.on("state:changed", listener);
        return () => ipcRenderer.removeListener("state:changed", listener);
      },
    });

    // 外观：网页在 <html> 上切 .dark，时间天空的开关在 localStorage["chisabot-sky"]。
    const report = () => {
      let sky = true;
      try {
        sky = window.localStorage.getItem("chisabot-sky") !== "off";
      } catch {}
      ipcRenderer.invoke("pc:appearance", { dark: document.documentElement.classList.contains("dark"), sky }).catch(() => {});
    };
    let timer = null;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(report, 200);
    };
    window.addEventListener("DOMContentLoaded", () => {
      report();
      new MutationObserver(schedule).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-sky"] });
    });
    window.addEventListener("storage", schedule);
  }
}
