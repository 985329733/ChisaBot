"use strict";
/**
 * 「打开」能力只做安全的打开（CB-030，docs/pc-node.md §5）：http/https 网址用默认浏览器打开；
 * 允许的文件夹里已经存在的文件 / 文件夹用系统默认程序打开。不启动程序、不带参数、不打开可执行文件和脚本。
 * 服务器 shared/devices.ts 的 checkOpenTarget 是同一套规则（服务器先拦一次，本机再拦一次）。
 */

/** 打开就等于运行的文件类型（Windows / macOS / Linux）。 */
const EXECUTABLE_EXT = new Set(
  (
    "exe com bat cmd ps1 psm1 psd1 ps1xml vbs vbe js jse wsf wsh wsc msi msp mst scr pif lnk cpl hta jar reg inf " +
    "application appref-ms gadget msc url scf iqy settingcontent-ms library-ms search-ms appx appxbundle msix msixbundle " +
    "sh bash zsh fish csh ksh command tool app desktop run bin appimage py pyw pyc pl rb php deb rpm dmg pkg mpkg action workflow"
  ).split(" "),
);

/** 只看文本：返回 { kind: "url", url } / { kind: "path", path } 或 { error }（中文原因）。 */
function classifyOpenTarget(raw) {
  const target = typeof raw === "string" ? raw.trim() : "";
  if (!target) return { error: "没有要打开的目标。" };
  if (/[\u0000-\u001f\u007f]/.test(target)) return { error: "目标里有控制字符，不能打开。" };
  if (/^https?:\/\//i.test(target)) {
    let url;
    try {
      url = new URL(target);
    } catch {
      return { error: "网址格式不对。" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "只能打开 http / https 网址。" };
    return { kind: "url", url: url.href };
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return { error: "不允许打开这种地址：只能打开 http / https 网址或文件 / 文件夹。" };
  if (/^(\\\\|\/\/)/.test(target)) return { error: "不打开网络路径（\\\\服务器\\共享）。" };
  if (target.startsWith("-")) return { error: "目标不能以 - 开头。" };
  const base = target.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  const looksLikePath = /^([a-z]:[\\/]|[\\/]|~)/i.test(target) || /[\\/]/.test(target) || /\.[^.\\/]+$/.test(base) || target === "." || target === "~";
  if (!looksLikePath) return { error: "「打开」不再启动程序：只能打开网址，或允许的文件夹里的文件 / 文件夹（给出路径）。要运行程序请用命令行能力。" };
  const ext = /\.([^.\\/]+)$/.exec(base.replace(/[. ]+$/, ""))?.[1]?.toLowerCase();
  if (ext && EXECUTABLE_EXT.has(ext)) return { error: `不打开 .${ext} 文件：打开它等于运行程序。要运行请用命令行能力。` };
  // 没有扩展名的只当文件夹，并且要以 / 或 \ 结尾（Windows 会给没扩展名的路径按 PATHEXT 补成 .exe 去运行）。
  if (!ext && !/[\\/]$/.test(target) && target !== "." && target !== "~") return { error: "没有扩展名的路径只当文件夹打开，请以 / 或 \\ 结尾（例如 D:\\报告\\）；文件请写全文件名和扩展名。" };
  return { kind: "path", path: target };
}

module.exports = { classifyOpenTarget, EXECUTABLE_EXT };
