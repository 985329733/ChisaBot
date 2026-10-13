import { describe, expect, test } from "bun:test";
import { lintPanelSpec, PANEL_DESIGN_GUIDE, textWidth } from "../src/live-panels/design";
import { mergePanelData } from "../src/live-panels/service";
import { inspectRenderUiSpec } from "../../shared/json-render/catalog";

/** The example specs inside the guide: every one must be a valid spec and pass the linter itself. */
const examples = PANEL_DESIGN_GUIDE.split("\n").filter((line) => line.startsWith('{"root"'));

describe("panel design guide", () => {
  test("has eight pattern examples, each valid and lint-clean (apart from the example.com placeholders)", () => {
    expect(examples.length).toBe(8);
    for (const spec of examples) {
      const verdict = inspectRenderUiSpec(spec);
      expect(verdict.ok).toBe(true);
      if (verdict.ok) expect(verdict.warnings ?? []).toEqual([]);
      expect(lintPanelSpec(spec, "随便一个标题").filter((issue) => !issue.includes("占位地址"))).toEqual([]);
    }
  });

  test("the guide's examples use the rich components it recommends", () => {
    for (const type of ["Chart", "Hero", "Status", "HeatStrip", "Countdown", "Ring", "KeyValue", "Avatar"]) {
      expect(PANEL_DESIGN_GUIDE).toContain(`"type":"${type}"`);
    }
    expect(PANEL_DESIGN_GUIDE).toContain('"variant":"tinted"');
    expect(PANEL_DESIGN_GUIDE).toContain('"href"');
  });

  test("rich parts are counted and limited: big parts, heroes, chart points, tabs, placeholder links", () => {
    const series = Array.from({ length: 80 }, (_, i) => i);
    const spec = JSON.stringify({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["h1", "h2", "c", "t", "tabs"] },
        h1: { type: "Hero", props: { title: "一" }, children: [] },
        h2: { type: "Hero", props: { title: "二", image: "https://example.com/x.jpg" }, children: [] },
        c: { type: "Chart", props: { data: series }, children: [] },
        t: { type: "Timeline", props: { items: [{ title: "a", href: "javascript:alert(1)" }] }, children: [] },
        tabs: { type: "Tabs", props: { tabs: ["今天", "本周", "本月", "今年"] }, children: ["p1"] },
        p1: { type: "Text", props: { text: "x" }, children: [] },
      },
    });
    const issues = lintPanelSpec(spec, "测试").join("\n");
    expect(issues).toContain("大块太多");
    expect(issues).toContain("Hero 只能有 1 个");
    expect(issues).toContain("图表点太多");
    expect(issues).toContain("标签页太多");
    expect(issues).toContain("一一对应");
    expect(issues).toContain("占位地址");
    expect(issues).toContain("不是 http(s) 链接");
  });

  test("Tabs count only their biggest page; Carousel cards do not count against the outer limits", () => {
    const list = { type: "List", props: { items: [{ title: "a" }] }, children: [] };
    const spec = JSON.stringify({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["tabs", "car"] },
        tabs: { type: "Tabs", props: { tabs: ["今天", "本周"] }, children: ["p1", "p2"] },
        p1: { type: "Stack", props: {}, children: ["l1", "l2"] },
        p2: { type: "Stack", props: {}, children: ["l3", "l4"] },
        l1: list, l2: list, l3: list, l4: list,
        car: { type: "Carousel", props: {}, children: ["m1", "m2", "m3", "m4", "m5"] },
        ...Object.fromEntries([1, 2, 3, 4, 5].map((i) => [`m${i}`, { type: "Metric", props: { label: `m${i}`, value: "1" }, children: [] }])),
      },
    });
    expect(lintPanelSpec(spec, "测试")).toEqual([]);
  });

  test("countdown targets and clock time zones are checked", () => {
    const spec = JSON.stringify({
      root: "r",
      elements: {
        r: { type: "Stack", props: {}, children: ["c", "k"] },
        c: { type: "Countdown", props: { target: "下周五" }, children: [] },
        k: { type: "Clock", props: { timezone: "纽约" }, children: [] },
      },
    });
    const issues = lintPanelSpec(spec, "测试").join("\n");
    expect(issues).toContain("不是合法时间");
    expect(issues).toContain("不是 IANA 时区");
  });

  test("data-only refresh merges into the previous state, and refuses specs without bindings", () => {
    const bound = JSON.stringify({
      root: "m",
      elements: { m: { type: "Metric", props: { label: "现价", value: { $state: "/btc/price" } }, children: [] } },
      state: { btc: { price: "$80,000", change: "-1%" } },
    });
    const merged = JSON.parse(mergePanelData(bound, { btc: { price: "$81,272" } }) ?? "{}");
    expect(merged.state).toEqual({ btc: { price: "$81,272", change: "-1%" } });
    expect(merged.elements.m.props.value).toEqual({ $state: "/btc/price" });
    const literal = JSON.stringify({ root: "m", elements: { m: { type: "Metric", props: { label: "现价", value: "$1" }, children: [] } } });
    expect(mergePanelData(literal, { x: 1 })).toBeNull();
    expect(mergePanelData(null, { x: 1 })).toBeNull();
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
