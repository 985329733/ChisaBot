/**
 * 从一条消息的文字里找出要做成卡片的东西（2026-10-13，聊天富预览）：
 * - 链接：裸网址（https://…）、Markdown 链接 [文字](网址)、尖括号自动链接 <https://…>；
 * - 图片：Markdown 图片 ![说明](网址)。
 *
 * 代码块和行内代码里的网址不算（那是代码，不是给人点的链接）。去重、保持出现顺序；链接最多
 * {@link MAX_LINK_CARDS} 个。裸网址末尾的标点（中英文句号、逗号、右括号、引号……）不算网址的一部分，
 * 但网址里成对的括号（维基百科那种）保留。
 */

export const MAX_LINK_CARDS = 3;
export const MAX_IMAGES = 12;

export type ExtractedImage = { src: string; alt: string };
export type Extracted = { links: string[]; images: ExtractedImage[] };

const TRAILING = /[.,;:!?'"*_~\]}>，。、；：！？…）】》」』”’]+$/u;

/** 去掉网址末尾不属于它的标点；多出来的右括号也去掉。 */
export function trimUrl(raw: string): string {
  let url = raw;
  for (let i = 0; i < 8; i += 1) {
    const before = url;
    url = url.replace(TRAILING, "");
    if (url.endsWith(")")) {
      const open = (url.match(/\(/g) ?? []).length;
      const close = (url.match(/\)/g) ?? []).length;
      if (close > open) url = url.slice(0, -1);
    }
    if (url === before) break;
  }
  return url;
}

/** 只认 http / https；不合法的、带账号密码的、本机的都不要。 */
export function normalizeLink(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes(".") && !url.hostname.startsWith("["))
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** 图片地址：http(s)、本站相对地址（/api/…）、data:image/…（常见格式）。 */
export function normalizeImageSrc(raw: string): string | null {
  const value = raw.trim().replace(/^<|>$/g, "");
  if (
    /^data:image\/(png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/=\s]+$/i.test(
      value,
    )
  )
    return value.replace(/\s+/g, "");
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  return normalizeLink(value);
}

function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/~~~[\s\S]*?(~~~|$)/g, " ")
    .replace(/`[^`\n]*`/g, " ");
}

/** Markdown 链接目标：(<网址> "标题") 或 (网址 "标题")，网址里允许成对括号。 */
const MD_TARGET = String.raw`\(\s*(<[^>\s]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)`;
const MD_IMAGE = new RegExp(String.raw`!\[([^\]]*)\]${MD_TARGET}`, "g");
const MD_LINK = new RegExp(
  String.raw`(?<!!)\[((?:[^\[\]]|\[[^\]]*\])*)\]${MD_TARGET}`,
  "g",
);
const AUTOLINK = /<(https?:\/\/[^>\s]+)>/gi;
const BARE =
  /https?:\/\/[^\s<>"'`\u3000，。、；：！？（）【】《》「」『』“”‘’]+/gi;

export function extractRichContent(text: string): Extracted {
  if (!text) return { links: [], images: [] };
  let rest = stripCode(text);
  const images: ExtractedImage[] = [];
  const found: { at: number; url: string }[] = [];

  rest = rest.replace(MD_IMAGE, (match, alt: string, target: string) => {
    const src = normalizeImageSrc(target.replace(/^<|>$/g, ""));
    if (src && !images.some((i) => i.src === src))
      images.push({ src, alt: alt.trim() });
    return " ".repeat(match.length);
  });
  rest = rest.replace(
    MD_LINK,
    (match, _label: string, target: string, offset: number) => {
      const url = normalizeLink(target.replace(/^<|>$/g, ""));
      if (url) found.push({ at: offset, url });
      return " ".repeat(match.length);
    },
  );
  rest = rest.replace(AUTOLINK, (match, target: string, offset: number) => {
    const url = normalizeLink(target);
    if (url) found.push({ at: offset, url });
    return " ".repeat(match.length);
  });
  for (const match of rest.matchAll(BARE)) {
    const url = normalizeLink(trimUrl(match[0]));
    if (url) found.push({ at: match.index ?? 0, url });
  }

  found.sort((a, b) => a.at - b.at);
  const imageSet = new Set(images.map((i) => i.src));
  const links: string[] = [];
  for (const { url } of found) {
    const key = url.replace(/#.*$/, "");
    if (imageSet.has(url) || links.some((l) => l.replace(/#.*$/, "") === key))
      continue;
    links.push(url);
    if (links.length >= MAX_LINK_CARDS) break;
  }
  return { links, images: images.slice(0, MAX_IMAGES) };
}

/** 人看的文件大小：1.2 MB、340 KB。 */
export function formatBytes(bytes: number | null | undefined): string {
  if (
    bytes === null ||
    bytes === undefined ||
    !Number.isFinite(bytes) ||
    bytes < 0
  )
    return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 文件名的扩展名（小写，不带点），没有就空串。 */
export function extensionOf(name: string | undefined): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name ?? "");
  return match ? match[1]!.toLowerCase() : "";
}
