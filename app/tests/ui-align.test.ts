import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

/*
 * DESIGN.md §82 UI 文字对齐 / 间距的静态护栏。真浏览器里的测量在 tests/ui-align/（每个页面量文字中心、墨迹、
 * 干活卡上下间距）；这里只锁住那几个根因，防止以后改样式时又回来。
 */
const css = readFileSync(path.join(import.meta.dir, "../src/styles.css"), "utf8");

test("container rules that style every descendant <span> never reach inside a Button (§82.1)", () => {
  // `.x span { display:block }` 曾经把「生成安装命令」按钮里的 btn-stack / btn-face 也变成块，字被挤出按钮。
  const offenders: string[] = [];
  for (const m of css.matchAll(/(^|\})\s*([^{}@]+?)\{([^{}]*)\}/g)) {
    const selectors = m[2].split(",").map((s) => s.trim());
    const body = m[3];
    if (!/\b(display|font-size|flex|color|margin)\s*:/.test(body)) continue;
    for (const sel of selectors) {
      if (/^(\.(pair-card-row|device-steps|cc-ws-err))\s+span\b/.test(sel) && !sel.includes('[data-slot="button"]')) offenders.push(sel);
    }
  }
  expect(offenders).toEqual([]);
});

test("work card / done row keeps a gap from a card drawn above it in the same row (§82.3)", () => {
  const rule = css.match(/\.chat-work:not\(:first-child\)\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  const px = Number(/margin-top:\s*(\d+)px/.exec(rule?.[1] ?? "")?.[1] ?? 0);
  expect(px).toBeGreaterThanOrEqual(8);
});

test("empty state action never sits flush under its description (§82.3)", () => {
  expect(css).toMatch(/\.sg-empty > p \+ \* \{ margin-top: 16px; \}/);
});

test("settings rail group toggles have symmetric vertical padding (§82.2)", () => {
  const rule = css.match(/\.rail-sec-toggle \{([^}]*)\}/)?.[1] ?? "";
  const top = /padding-top:\s*(\d+)px/.exec(rule)?.[1];
  const bottom = /padding-bottom:\s*(\d+)px/.exec(rule)?.[1];
  expect(top).toBeDefined();
  expect(top).toBe(bottom);
});

test("control labels use half-width CJK punctuation so a trailing 「）」 doesn't push the label off-centre (§82.2)", () => {
  expect(css).toMatch(/\[data-slot="button"\][^{]*\{ font-feature-settings: "halt"; \}/);
});
