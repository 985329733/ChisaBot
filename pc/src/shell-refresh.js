"use strict";
/**
 * 外壳刷新（docs/online-update.md §2.1）：更新换了图标 / 安装配置之后，第一次启动新版本时把 Windows 上
 * 指向本程序的快捷方式按新 exe 重写，并让资源管理器重建图标缓存。
 *
 * 为什么需要：在线更新用 --updated 模式静默运行安装包，快捷方式原样保留，图标缓存也不刷新——exe 里的图标
 * 明明换了，桌面 / 开始菜单 / 任务栏上还是旧的。安装脚本（build/installer.nsh）会处理桌面和开始菜单；
 * 这里再兜一次底，并且顺带处理任务栏固定的快捷方式（安装程序不碰它）。
 *
 * 何时运行：src/shell-fingerprint.json 的哈希和本机 config.json 记下的 shellHash 不同（包括第一次装上带
 * 这个功能的版本，那时 shellHash 为空），只跑一次，跑完记下新哈希。只改指向本程序 exe 的快捷方式。
 */
const fs = require("node:fs");
const path = require("node:path");

function loadFingerprint(file = path.join(__dirname, "shell-fingerprint.json")) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof data.hash === "string" && data.hash ? data.hash : "";
  } catch {
    return "";
  }
}

/** 可能指向本程序的快捷方式：桌面、开始菜单（用户级）、任务栏固定。 */
function shortcutCandidates({ desktopDir, appData, shortcutName }) {
  const list = [];
  if (desktopDir) list.push(path.win32.join(desktopDir, `${shortcutName}.lnk`));
  if (appData) {
    list.push(path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${shortcutName}.lnk`));
    list.push(path.win32.join(appData, "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar", `${shortcutName}.lnk`));
  }
  return list;
}

function samePath(a, b) {
  if (!a || !b) return false;
  return path.win32.normalize(String(a)).toLowerCase() === path.win32.normalize(String(b)).toLowerCase();
}

/** 外壳哈希变了才需要刷新。本机没记过（旧版本升上来）= 需要。 */
function needsShellRefresh({ current, last }) {
  if (!current) return false;
  return current !== (last || "");
}

/**
 * 重写快捷方式 + 刷新图标缓存。所有依赖可注入，方便测试。返回 { updated: [路径], cacheRefreshed }。
 *  - shell：Electron shell（readShortcutLink / writeShortcutLink，只在 Windows 上有）
 *  - run(cmd, args)：启动外部程序，不等待
 */
function refreshShell({ shell, exists = fs.existsSync, execPath, appUserModelId, candidates, systemRoot, osRelease = "", run, log = () => {} }) {
  const updated = [];
  for (const link of candidates) {
    try {
      if (!exists(link)) continue;
      const info = shell.readShortcutLink(link);
      if (!samePath(info?.target, execPath)) continue;
      const ok = shell.writeShortcutLink(link, "update", {
        target: execPath,
        icon: execPath,
        iconIndex: 0,
        ...(appUserModelId ? { appUserModelId } : {}),
      });
      if (ok) updated.push(link);
    } catch (error) {
      log(`快捷方式 ${link} 更新失败：${error?.message || error}`);
    }
  }
  let cacheRefreshed = false;
  if (systemRoot && run) {
    const tool = path.win32.join(systemRoot, "System32", "ie4uinit.exe");
    if (exists(tool)) {
      // Windows 10+（内核 10.x）用 -show；更早的用 -ClearIconCache。
      const major = Number(String(osRelease).split(".")[0]) || 10;
      try {
        run(tool, [major >= 10 ? "-show" : "-ClearIconCache"]);
        cacheRefreshed = true;
      } catch (error) {
        log(`刷新图标缓存失败：${error?.message || error}`);
      }
    }
  }
  return { updated, cacheRefreshed };
}

module.exports = { loadFingerprint, shortcutCandidates, needsShellRefresh, refreshShell, samePath };
