import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/*
 * DESIGN.md §41：Tailwind 的 group-has-* / peer-has-* 会生成「:has(…) *」，Chromium 会因此在任何 data-* 变化时
 * 重算整个应用的样式（每次点击 130–230ms，4× CPU）。改写成 [[祖先]:has(…)_&]:工具类。
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

test("no group-has-* / peer-has-* utilities (whole-app style invalidation)", () => {
  const root = path.join(import.meta.dir, "../src");
  const offenders = files(root).filter((file) => /(^|[\s"'`])(group|peer)-has-/m.test(readFileSync(file, "utf8")));
  expect(offenders.map((file) => path.relative(root, file))).toEqual([]);
});

test("styles.css has no leftover merge-conflict markers (a stray line silently drops the next rule)", () => {
  const css = readFileSync(path.join(import.meta.dir, "../src/styles.css"), "utf8");
  expect(css.split("\n").filter((line) => /^(<{7}|={7}|>{7})( |$)/.test(line))).toEqual([]);
});
