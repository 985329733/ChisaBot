/**
 * 机器人回复里指向它工作区文件的链接（DESIGN.md §101）。
 *
 * 模型常写「代码已保存为 [primes.py](primes.py)」或 `file:///workspace/x`、`sandbox:/workspace/x`、
 * `https://workspace.local/x`。Markdown 的链接安全规则只放行 http(s)，这些全被画成「primes.py [blocked]」
 * （2026-10-18 生产截图），用户既打不开也看着像出错。这里在交给 Markdown 之前，把它们换成这个机器人
 * 计算机的下载地址 `/api/computers/<bot>/files/download?path=…`（同源、要登录，服务器照常审计）。
 * 其它链接（http、mailto、页内 #）不动；代码块里不动。
 */
const LINK = /\]\(\s*<?([^)\s>]+)>?(\s+"[^"]*")?\s*\)/g;

export function workspacePathOf(target: string): string | null {
  let t = target.trim();
  if (!t || t.startsWith("#") || t.startsWith("//")) return null;
  const lower = t.toLowerCase();
  // 站内地址（「/api/chat-files/…」下载卡片的链接、「/p/…」网页）不是工作区文件：以「/」开头的只认 /workspace/…
  // （以前被改写成 files/download?path=api/chat-files/… → 404，§101.11）。
  if (t.startsWith("/") && !/^\/workspace\//i.test(t)) return null;
  if (lower.startsWith("https://workspace.local/") || lower.startsWith("http://workspace.local/")) {
    t = t.replace(/^https?:\/\/workspace\.local\//i, "");
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(t)) {
    // 带协议的：只认 file:/// 和 sandbox: 指向工作区的；别的（https、mailto、data…）不是工作区文件
    const m = /^(?:file:\/\/|sandbox:)(\/[^?#]*)/i.exec(t);
    if (!m) return null;
    t = m[1]!;
  }
  try {
    t = decodeURIComponent(t);
  } catch {
    // 保持原样
  }
  t = t.replace(/^\/?workspace\//, "").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!t || t.includes("..") || /[\r\n\t<>]/.test(t)) return null;
  // 像文件：带扩展名或目录分隔（「看这里」这类纯文字锚点不算）
  if (!/\.[A-Za-z0-9]{1,8}$/.test(t) && !t.includes("/")) return null;
  return t;
}

export function workspaceLinks(markdown: string, botId: string | undefined, origin: string): string {
  if (!botId || !markdown.includes("](")) return markdown;
  const parts = markdown.split(/(```[\s\S]*?(?:```|$))/);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part.replace(LINK, (whole, target: string, title: string | undefined) => {
        const path = workspacePathOf(target);
        if (!path) return whole;
        const url = `${origin}/api/computers/${encodeURIComponent(botId)}/files/download?path=${encodeURIComponent(path)}`;
        return `](${url}${title ?? ""})`;
      });
    })
    .join("");
}
