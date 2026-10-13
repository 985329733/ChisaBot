/**
 * 设备形态与手机竖屏布局（DESIGN.md §40）。
 *
 * index.html 里的内联脚本在第一帧之前写好 <html> 上的标记：
 *   data-phone        手机：主要指针是触屏且屏幕短边 < 600px，或浏览器明确说是手机（UA-CH `mobile`）。
 *                     横过来的手机也是手机；平板（短边 ≥ 600）照旧按窗口宽度走。
 *                     调试 / 用户覆盖：localStorage `chisabot-layout` = "phone" | "wide"。
 *   data-ios          iPhone / iPad（含报告成 Mac 的 iPadOS）。
 *   data-standalone   以安装后的应用打开（PWA 独立窗口 / iOS 主屏幕）。
 *   data-android-app  ChisaBot 安卓客户端（WebView 外壳）。
 *
 * 窄窗口布局本来写在 `@media (max-width: 767px)` 里。手机横屏宽 844 也该用它，所以在手机上
 * 把样式表里「窄窗口」的媒体查询改成永远成立、把「≥768 宽窗口」的改成永远不成立——等于告诉样式表
 * 「这是一扇 767px 宽的窗口」。不靠 UA 字符串猜，也不用重写几十处媒体查询。
 */

const root = () => document.documentElement;

export function isPhone(): boolean {
  return typeof document !== "undefined" && root().hasAttribute("data-phone");
}

export function isStandalone(): boolean {
  return typeof document !== "undefined" && root().hasAttribute("data-standalone");
}

export function isIOS(): boolean {
  return typeof document !== "undefined" && root().hasAttribute("data-ios");
}

export function isAndroidApp(): boolean {
  return typeof document !== "undefined" && root().hasAttribute("data-android-app");
}

/** 窄窗口查询（与 styles.css 的 767px 断点一致）。 */
export const NARROW_QUERY = "(max-width: 767px)";

/** 现在该用窄（竖屏）布局吗：手机永远是，其它设备看窗口宽度。 */
export function isNarrowLayout(): boolean {
  if (typeof window === "undefined") return false;
  return isPhone() || window.matchMedia(NARROW_QUERY).matches;
}

// ---------- 样式表媒体查询改写 ----------

/** ≥ 这个 max-width 的「窄窗口」规则在手机上一律生效（767 断点，以及骨架屏的 760）。 */
const NARROW_ON_FROM = 760;
/** ≥ 这个 min-width 的「宽窗口」规则在手机上一律不生效（Tailwind md = 48rem = 768）。 */
const WIDE_OFF_FROM = 768;

type Verdict = "on" | "off" | null;

function toPx(value: string, unit: string): number {
  const n = Number.parseFloat(value);
  return unit === "rem" || unit === "em" ? n * 16 : n;
}

/** 一个 `( … )` 宽度条件：返回它在「767px 宽窗口」里的结论；不是宽度条件返回 undefined。 */
function widthFeature(feature: string): Verdict | undefined {
  const f = feature.trim().replace(/\s+/g, " ");
  let m = /^\(max-width: ?([\d.]+)(px|rem|em)\)$/i.exec(f);
  if (m) return toPx(m[1], m[2]) >= NARROW_ON_FROM ? "on" : null;
  m = /^\(width ?(<=?) ?([\d.]+)(px|rem|em)\)$/i.exec(f);
  if (m) return toPx(m[2], m[3]) - (m[1] === "<" ? 0.02 : 0) >= NARROW_ON_FROM ? "on" : null;
  m = /^\(min-width: ?([\d.]+)(px|rem|em)\)$/i.exec(f);
  if (m) return toPx(m[1], m[2]) >= WIDE_OFF_FROM ? "off" : null;
  m = /^\(width ?(>=?) ?([\d.]+)(px|rem|em)\)$/i.exec(f);
  if (m) return toPx(m[2], m[3]) >= WIDE_OFF_FROM ? "off" : null;
  return undefined;
}

/** 整条媒体查询（可能带逗号、`and`、`screen and`）在手机上的结论；与宽度无关或拿不准就返回 null（不动）。 */
export function phoneMediaVerdict(mediaText: string): Verdict {
  const parts = mediaText.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const results: Verdict[] = [];
  for (const part of parts) {
    const conditions = part.replace(/^(only )?(screen|all) and /i, "").split(/ and /i);
    let verdict: Verdict = null;
    let sawOn = false;
    let sawOff = false;
    let other = false;
    for (const condition of conditions) {
      const v = widthFeature(condition);
      if (v === undefined) other = true;
      else if (v === "on") sawOn = true;
      else if (v === "off") sawOff = true;
      else other = true; // a width condition this rewrite leaves to the browser
    }
    if (sawOff) verdict = "off";
    else if (sawOn && !other) verdict = "on";
    results.push(verdict);
  }
  if (results.some((v) => v === "on")) return "on";
  if (results.every((v) => v === "off")) return "off";
  return null;
}

const patchedSheets = new WeakSet<CSSStyleSheet>();

function patchRules(rules: CSSRuleList) {
  for (const rule of Array.from(rules)) {
    if (typeof CSSMediaRule !== "undefined" && rule instanceof CSSMediaRule) {
      const verdict = phoneMediaVerdict(rule.media.mediaText);
      if (verdict === "on") rule.media.mediaText = "all";
      else if (verdict === "off") rule.media.mediaText = "not all";
    }
    const nested = (rule as CSSGroupingRule).cssRules;
    if (nested?.length) patchRules(nested);
  }
}

function patchSheet(sheet: CSSStyleSheet | null) {
  if (!sheet || patchedSheets.has(sheet)) return;
  let rules: CSSRuleList;
  try {
    rules = sheet.cssRules;
  } catch {
    return; // cross-origin or not loaded yet
  }
  patchedSheets.add(sheet);
  patchRules(rules);
}

function patchAllSheets() {
  for (const sheet of Array.from(document.styleSheets)) patchSheet(sheet);
}

function watchNewSheets() {
  const onNode = (node: Node) => {
    if (node instanceof HTMLLinkElement && /stylesheet/i.test(node.rel)) {
      if (node.sheet) patchSheet(node.sheet);
      node.addEventListener("load", () => patchSheet(node.sheet), { once: true });
    } else if (node instanceof HTMLStyleElement) {
      patchSheet(node.sheet);
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "childList") {
        record.addedNodes.forEach(onNode);
        // Vite dev rewrites <style> text in place on HMR: that sheet is new.
        if (record.target instanceof HTMLStyleElement) patchSheet(record.target.sheet);
      }
    }
  }).observe(document.head, { childList: true, subtree: true });
}

// ---------- 可视高度（虚拟键盘） ----------

/**
 * 手机上应用外壳的高度跟着「看得见的那块」走：
 * - 安卓 Chrome：viewport 的 interactive-widget=resizes-content 让布局视口随键盘缩小，100dvh 已经对了；
 * - iOS Safari 不认它：键盘盖住页面下半截、视觉视口变矮，这里把 --app-h 设成 visualViewport.height，
 *   输入框就贴在键盘上沿，顶栏也不会被推出屏幕。
 * 同时在 <html> 上写 data-keyboard（键盘开着），样式表据此收起底部安全区留白。
 */
function installViewportHeight() {
  const vv = window.visualViewport;
  const el = root();
  let tallest = 0;
  let orientation = window.innerWidth > window.innerHeight ? "l" : "p";
  let frame = 0;
  let lastHeight = 0;
  const update = () => {
    frame = 0;
    const now = window.innerWidth > window.innerHeight ? "l" : "p";
    if (now !== orientation) {
      orientation = now;
      tallest = 0;
    }
    const height = vv && Math.abs(vv.scale - 1) < 0.01 ? vv.height : window.innerHeight;
    tallest = Math.max(tallest, window.innerHeight, height);
    el.style.setProperty("--app-h", `${Math.round(height)}px`);
    const shrunk = lastHeight > 0 ? lastHeight - height : 0;
    lastHeight = height;
    // 键盘弹出（可视高度变矮）时，原来贴着底的滚动区继续贴底：最新消息留在输入框上面，而不是被键盘盖住。
    if (shrunk > 60) requestAnimationFrame(() => keepScrollersAtBottom(shrunk));
    const keyboard = tallest - height > 120;
    if (keyboard) el.setAttribute("data-keyboard", "");
    else el.removeAttribute("data-keyboard");
    // iOS 聚焦输入框时会把整页往上推；外壳已经缩到可视高度，推回去。
    if (keyboard && (window.scrollY || 0) !== 0 && isIOS()) window.scrollTo(0, 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  update();
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
}

function keepScrollersAtBottom(shrunk: number) {
  const main = document.querySelector(".glass-main") ?? document.body;
  for (const el of Array.from(main.querySelectorAll<HTMLElement>("*"))) {
    if (el.scrollHeight <= el.clientHeight + 20) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    const fromBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    // 变矮之前就在底部（距离 ≈ 变矮的量）才跟过去；正在往上翻看的人不动。
    if (fromBottom <= shrunk + 64) el.scrollTop = el.scrollHeight;
  }
}

let installed = false;

/** 入口调用一次：手机上改写样式表媒体查询、跟踪可视高度。别的设备什么都不做。 */
export function installPhoneLayout() {
  if (installed || typeof document === "undefined" || !isPhone()) return;
  installed = true;
  patchAllSheets();
  watchNewSheets();
  // Stylesheets still loading at entry time land via their load event; one more sweep after load.
  window.addEventListener("load", patchAllSheets, { once: true });
  installViewportHeight();
}
