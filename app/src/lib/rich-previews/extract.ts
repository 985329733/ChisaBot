/**
 * 从一条消息的文字里找出要做成卡片的东西（2026-10-13 富预览；2026-10-14 链接卡改成「单独一行才出卡」，DESIGN.md §48）：
 * - 链接卡：只有**单独占一行**的链接才出卡——裸网址一行、`<网址>` 一行、或 `[标签](网址)` 一行（标签显示在卡上，
 *   例如「下载 0.1.7」）。句子中间的链接（「详见 [文档](…)」「来源：https://…」）只是正文里可点的链接，不出卡。
 *   一条消息最多 {@link MAX_LINK_CARDS} 张，代码块里的不算。出了卡的那一行从正文里拿掉（{@link splitLinkLines}），
 *   不会「一行网址 + 一张卡」重复。
 * - 图片：Markdown 图片 ![说明](网址)，在哪儿都算。
 *
 * 裸网址末尾的标点（中英文句号、逗号、右括号、引号……）不算网址的一部分，但网址里成对的括号（维基百科那种）保留。
 */

export const MAX_LINK_CARDS = 3;
export const MAX_IMAGES = 12;

export type ExtractedImage = { src: string; alt: string };
export type Extracted = { links: LinkRef[]; images: ExtractedImage[] };

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
export type LinkRef = { url: string; label?: string };

const LINE_TRAILING = /[.,;:!?'"*_~，。、；：！？…]+$/u;
const LINE_MD_LINK = new RegExp(String.raw`^\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]${MD_TARGET}$`);
const LINE_AUTOLINK = /^<(https?:\/\/[^>\s]+)>$/i;
const LINE_BARE = /^https?:\/\/\S+$/i;
const MAX_LABEL = 40;

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** 卡片上的短标签：去掉 Markdown 记号；本身就是网址 / 域名的不要。 */
function cleanLabel(raw: string, url: string): string | undefined {
  const label = raw
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!label) return undefined;
  if (/^https?:\/\//i.test(label) || /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(label))
    return undefined;
  const host = hostOfUrl(url);
  if (host && label.toLowerCase().replace(/^www\./, "") === host) return undefined;
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
}

/**
 * 这一行是不是「单独一行的链接」：整行（去掉首尾空白、外面包的 ** / __、行尾标点）只有一个链接。
 * 列表项（`- https://…`）、引用、带说明文字的都不算——那多半是来源列表或句子。
 */
export function parseLinkLine(line: string): LinkRef | null {
  let t = line.trim();
  if (!t || t.length > 2100) return null;
  for (let i = 0; i < 2; i += 1) {
    const wrapped = /^(\*\*|__)(.+)\1$/.exec(t);
    if (wrapped) t = wrapped[2]!.trim();
  }
  const auto = LINE_AUTOLINK.exec(t.replace(LINE_TRAILING, ""));
  if (auto) {
    const url = normalizeLink(auto[1]!);
    return url ? { url } : null;
  }
  const md = LINE_MD_LINK.exec(t.replace(LINE_TRAILING, ""));
  if (md) {
    const url = normalizeLink(md[2]!.replace(/^<|>$/g, ""));
    if (!url) return null;
    const label = cleanLabel(md[1]!, url);
    return label ? { url, label } : { url };
  }
  if (LINE_BARE.test(t)) {
    const trimmed = trimUrl(t);
    // 网址后面只允许跟标点（「https://a.cn/x。」），跟着别的字就是句子。
    if (!/^[\s.,;:!?'"*_~\]}>，。、；：！？…）】》」』”’)]*$/u.test(t.slice(trimmed.length)))
      return null;
    const url = normalizeLink(trimmed);
    return url ? { url } : null;
  }
  return null;
}

/** 流式时最后一行还没写完：它可能是一行链接的开头（先藏起来，写完再出卡，不闪一行网址）。 */
export function looksLikePartialLinkLine(line: string): boolean {
  const t = line.trim().replace(/^(\*\*|__)/, "");
  if (!t) return false;
  if (/^(h|ht|htt|http|https?|https?:|https?:\/|https?:\/\/\S*)$/i.test(t)) return true;
  if (/^<(h|ht|htt|http|https?|https?:|https?:\/|https?:\/\/[^>\s]*)>?$/i.test(t)) return true;
  // [标签](网址 —— 标签写完、网址还在写；只写了「[标签」时还看不出是不是链接，先不藏。
  if (/^\[[^\[\]\n]{0,80}\]\((<?https?:?\/{0,2}\S*)?$/i.test(t)) return true;
  return parseLinkLine(t) !== null;
}

export type LinkLines = {
  /** 出卡的链接（按出现顺序、去重、最多 3 个）。 */
  links: LinkRef[];
  /** 拿掉了出卡那几行之后、给 Markdown 渲染的正文。 */
  display: string;
  /** 流式中最后一行看起来是一行链接、还没写完：卡片位置先放一个骨架。 */
  pending: boolean;
};

/**
 * 把消息正文分成「正文」和「链接卡」。`final = false`（还在流式）时最后一行（后面没有换行）不出卡，
 * 只在它看起来是链接行时先藏起来并标 `pending`；`final = true` 时最后一行和别的行一样。
 * 代码块（``` / ~~~）里的行原样保留。
 */
export function splitLinkLines(
  text: string,
  { final }: { final: boolean },
): LinkLines {
  if (!text) return { links: [], display: text ?? "", pending: false };
  const lines = text.split("\n");
  const kept: string[] = [];
  const links: LinkRef[] = [];
  const keys = new Set<string>();
  let fence: string | null = null;
  let pending = false;
  let removed = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const isLast = i === lines.length - 1;
    const marker = /^\s{0,3}(```|~~~)/.exec(line);
    if (fence) {
      if (marker && marker[1] === fence) fence = null;
      kept.push(line);
      continue;
    }
    if (marker) {
      fence = marker[1]!;
      kept.push(line);
      continue;
    }
    if (isLast && !final) {
      if (links.length < MAX_LINK_CARDS && looksLikePartialLinkLine(line)) {
        pending = true;
        removed = true;
        continue;
      }
      kept.push(line);
      continue;
    }
    const ref = parseLinkLine(line);
    if (ref) {
      const key = ref.url.replace(/#.*$/, "");
      if (keys.has(key)) {
        removed = true;
        continue; // 同一个链接已经有卡了
      }
      if (links.length < MAX_LINK_CARDS) {
        keys.add(key);
        links.push(ref);
        removed = true;
        continue;
      }
    }
    kept.push(line);
  }
  const display = removed
    ? kept
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/\s+$/, "")
    : text;
  return { links, display, pending };
}

/** 一条（已经写完的）消息里的链接卡和图片。 */
export function extractRichContent(text: string): Extracted {
  if (!text) return { links: [], images: [] };
  const images: ExtractedImage[] = [];
  stripCode(text).replace(MD_IMAGE, (match, alt: string, target: string) => {
    const src = normalizeImageSrc(target.replace(/^<|>$/g, ""));
    if (src && !images.some((i) => i.src === src))
      images.push({ src, alt: alt.trim() });
    return match;
  });
  const imageSet = new Set(images.map((i) => i.src));
  const links = splitLinkLines(text, { final: true }).links.filter(
    (l) => !imageSet.has(l.url),
  );
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
