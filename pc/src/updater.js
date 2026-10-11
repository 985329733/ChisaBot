"use strict";
/**
 * 在线更新（docs/online-update.md §PC，0.2.2 起）。
 *
 *  - 更新源：electron-updater 的 generic provider，指向服务器上公开的更新目录
 *    （package.json build.publish.url = https://ayase.cn/downloads/chisabot-pc/），里面是
 *    latest.yml + 安装包 + .blockmap。latest.yml 里有安装包的 sha512，下载完 electron-updater 会校验，
 *    不一致就丢弃，不会安装。
 *  - 安装包没有代码签名：build.win.verifyUpdateCodeSignature = false（app-update.yml 里就没有
 *    publisherName，NsisUpdater 不做 Authenticode 校验）；这里再把校验函数设成「通过」，两边一致。
 *    完整性靠 HTTPS + latest.yml 的 sha512。
 *  - 什么时候检查：开着「自动更新」时，启动 30 秒后一次、之后每 4 小时一次；下载在后台进行，下载好了
 *    调 onDownloaded（主进程弹本机窗口「新版本已下载，重启以安装」：立即重启 / 稍后）。选「稍后」时，
 *    下次退出 ChisaBot PC 时自动安装（autoInstallOnAppQuit）。
 *  - 关掉「自动更新」只停掉定时检查；网页「本机」标签里的「检查更新」照样可以手动检查和下载。
 *  - 只有 NSIS 安装版能更新（安装目录里有卸载程序）。开发运行、免安装 zip 一律 supported = false。
 */
const fs = require("node:fs");
const path = require("node:path");

const FIRST_CHECK_MS = 30 * 1000;
const INTERVAL_MS = 4 * 60 * 60 * 1000;

function cleanMessage(error) {
  const text = error && error.message ? String(error.message) : String(error || "未知错误");
  const first = text.split("\n")[0].replace(/\s+/g, " ").trim();
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(first)) return "连不上更新服务器，请检查网络。";
  if (/sha512 checksum mismatch/i.test(first)) return "下载的安装包校验失败，已丢弃，稍后会重新下载。";
  if (/404|Cannot find latest\.yml|HttpError: 404/i.test(first)) return "更新服务器上还没有发布版本信息。";
  return first.slice(0, 160);
}

/** NSIS 安装版：安装目录里有卸载程序。免安装 zip 解压出来的没有。 */
function isInstalledBuild({ execPath, productName, exists = fs.existsSync }) {
  const dir = path.dirname(execPath);
  return exists(path.join(dir, `Uninstall ${productName}.exe`));
}

function createUpdater({ autoUpdater, isPackaged, platform, execPath, productName, getAutoUpdate, onState, onDownloaded, logger, timers = { setTimeout, setInterval, clearTimeout, clearInterval }, now = () => new Date() }) {
  const supported = Boolean(isPackaged && platform === "win32" && autoUpdater && isInstalledBuild({ execPath, productName }));
  const state = { supported, status: "idle" };
  let firstTimer = null;
  let interval = null;
  let checking = null;

  function set(patch) {
    Object.assign(state, patch);
    if (state.status !== "downloading") delete state.percent;
    if (state.status !== "error") delete state.error;
    onState?.({ ...state });
  }

  if (supported) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    if (logger) autoUpdater.logger = logger;
    // 安装包不签名：见文件头。只影响 Authenticode；sha512 校验照常。
    try {
      autoUpdater.verifyUpdateCodeSignature = async () => null;
    } catch {}
    autoUpdater.on("checking-for-update", () => set({ status: "checking" }));
    autoUpdater.on("update-available", (info) => set({ status: "downloading", version: info?.version, percent: 0 }));
    autoUpdater.on("update-not-available", () => set({ status: "none", version: undefined, checkedAt: now().toISOString() }));
    autoUpdater.on("download-progress", (progress) => {
      if (state.status === "downloaded") return;
      set({ status: "downloading", percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)) });
    });
    autoUpdater.on("update-downloaded", (info) => {
      set({ status: "downloaded", version: info?.version || state.version, checkedAt: now().toISOString() });
      onDownloaded?.(state.version);
    });
    autoUpdater.on("error", (error) => {
      if (state.status === "downloaded") return;
      set({ status: "error", error: cleanMessage(error), checkedAt: now().toISOString() });
    });
  }

  async function check() {
    if (!supported) return { ...state };
    if (state.status === "downloaded" || state.status === "downloading") return { ...state };
    if (checking) return checking;
    checking = (async () => {
      set({ status: "checking" });
      try {
        await autoUpdater.checkForUpdates();
        if (state.status === "checking") set({ status: "none", checkedAt: now().toISOString() });
      } catch (error) {
        set({ status: "error", error: cleanMessage(error), checkedAt: now().toISOString() });
      } finally {
        checking = null;
      }
      return { ...state };
    })();
    return checking;
  }

  function schedule() {
    stop();
    if (!supported || !getAutoUpdate()) return;
    firstTimer = timers.setTimeout(() => void check(), FIRST_CHECK_MS);
    interval = timers.setInterval(() => {
      if (getAutoUpdate()) void check();
    }, INTERVAL_MS);
  }

  function stop() {
    if (firstTimer) timers.clearTimeout(firstTimer);
    if (interval) timers.clearInterval(interval);
    firstTimer = null;
    interval = null;
  }

  /** 退出并静默安装，装好后自动重新打开。只在已经下载好时有效。 */
  function install() {
    if (!supported || state.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(true, true);
    return true;
  }

  return { get state() { return { ...state }; }, supported, check, schedule, stop, install };
}

module.exports = { createUpdater, cleanMessage, isInstalledBuild, FIRST_CHECK_MS, INTERVAL_MS };
