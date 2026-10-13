import { describe, expect, test } from "bun:test";
import { lintPanelSpec, PANEL_DESIGN_GUIDE, textWidth } from "../src/live-panels/design";
import { inspectRenderUiSpec } from "../../shared/json-render/catalog";

/** The example specs inside the guide: every one must be a valid spec and pass the linter itself. */
const examples = PANEL_DESIGN_GUIDE.split("\n").filter((line) => line.startsWith('{"root"'));

describe("panel design guide", () => {
  test("has five pattern examples, each valid and lint-clean", () => {
    expect(examples.length).toBe(5);
    for (const spec of examples) {
      expect(inspectRenderUiSpec(spec).ok).toBe(true);
      expect(lintPanelSpec(spec, "随便一个标题")).toEqual([]);
    }
  });

  test("the user's 2026-10-13 weather panel is refused with fix-it notes", () => {
    const E: Record<string, unknown> = {};
    const el = (k: string, type: string, props: Record<string, unknown>, children: string[] = []) => { E[k] = { type, props, children }; };
    el("root", "Card", { title: "香港天气", description: "10月13日 08:15" }, ["inner"]);
    el("inner", "Card", { title: "香港天气" }, ["grid", "tb"]);
    el("grid", "Grid", { columns: 3 }, ["m1", "m2", "m3", "m4", "m5", "m6"]);
    for (const [i, label] of ["气温", "体感", "湿度", "天气", "风速", "今日降水概率统计"].entries()) el(`m${i + 1}`, "Metric", { label, value: "26.9℃" });
    el("tb", "Table", {
      columns: ["日期", "天气", "最高", "最低", "降水概率"].map((label, i) => ({ key: `c${i}`, label })),
      rows: Array.from({ length: 8 }, () => ({ c0: "10月13日 今天", c1: "毛毛雨", c2: "31.3℃", c3: "23.5℃", c4: "16%" })),
    });
    const issues = lintPanelSpec(JSON.stringify({ root: "root", elements: E }), "香港天气").join("\n");
    expect(issues).toContain("不要用 Card");
    expect(issues).toContain("重复了面板标题");
    expect(issues).toContain("Metric 太多");
    expect(issues).toContain("表格列太多");
    expect(issues).toContain("表格行太多");
    expect(issues).toContain("今日降水概率统计");
  });

  test("paragraph text and long values are caught", () => {
    const spec = JSON.stringify({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["t", "m"] },
        t: { type: "Text", props: { text: "未来四天均有毛毛雨，十月十四日降水概率最高，各日最大阵风四十七到五十五公里每小时，海面风大。" }, children: [] },
        m: { type: "Metric", props: { label: "现价", value: "目前大约八万一千美元左右" }, children: [] },
      },
    });
    const issues = lintPanelSpec(spec, "比特币").join("\n");
    expect(issues).toContain("是一段话");
    expect(issues).toContain("value");
  });

  test("text width counts CJK as 1 and latin as 0.5", () => {
    expect(textWidth("体感")).toBe(2);
    expect(textWidth("24h 最高")).toBe(4);
  });
});
