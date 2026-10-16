/**
 * DESIGN.md §82.7：控件标签里的全角标点。按钮 / 胶囊用 `font-feature-settings: "halt"` 把「（）」「「」」排成半角宽
 * （§82.2），但文泉驿正黑这类字体没有 halt：「检查（不生成图片）」末尾「）」右半边的空白还在，整串字看起来偏左 4px。
 *
 * 这里在启动时量一次：同一个「）」开 halt 和不开一样宽 = 当前字体不支持，给 <html> 加 `data-no-halt`；
 * styles.css 里 `.t-close` / `.t-open`（`labelText()` 把标签首尾的全角括号、引号包成它们）收掉那半个字宽。
 * 支持 halt 的字体（Noto Sans CJK、苹方…）什么都不变。字体晚加载完再量一次。
 */
export function installHaltProbe(doc: Document = document): void {
  const measure = () => {
    const body = doc.body;
    if (!body) return;
    const probe = doc.createElement("span");
    probe.textContent = "）";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:40px;font-weight:500";
    body.appendChild(probe);
    const full = probe.getBoundingClientRect().width;
    probe.style.fontFeatureSettings = '"halt"';
    const half = probe.getBoundingClientRect().width;
    probe.remove();
    if (full <= 0) return;
    doc.documentElement.toggleAttribute("data-no-halt", half > full * 0.8);
  };
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", measure, { once: true });
  else measure();
  void doc.fonts?.ready.then(measure).catch(() => undefined);
}
