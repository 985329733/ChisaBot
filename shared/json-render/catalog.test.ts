import { describe, expect, test } from "bun:test";
import {
  inspectRenderUiSpec,
  jsonRenderCatalog,
  parseRenderUiSpec,
  RENDER_UI_TOOL,
  renderUiPrompt,
  validateRenderUiSpec,
} from "./catalog";

const line = (value: unknown) => JSON.stringify(value);

const GOOD = [
  line({ op: "add", path: "/root", value: "card" }),
  line({
    op: "add",
    path: "/elements/card",
    value: { type: "Card", props: { title: "本周概览" }, children: ["grid", "name", "send"] },
  }),
  line({ op: "add", path: "/elements/grid", value: { type: "Grid", props: { columns: 2 }, children: ["m1"] } }),
  line({
    op: "add",
    path: "/elements/m1",
    value: { type: "Metric", props: { label: "收入", value: "¥12,000", trend: "up" }, children: [] },
  }),
  line({
    op: "add",
    path: "/elements/name",
    value: { type: "Input", props: { label: "名字", value: { $bindState: "/form/name" } }, children: [] },
  }),
  line({ op: "add", path: "/state/form", value: { name: "" } }),
  line({
    op: "add",
    path: "/elements/send",
    value: {
      type: "Button",
      props: { label: "提交" },
      on: { press: { action: "send_message", params: { text: "提交表单", includeState: "/form" } } },
      children: [],
    },
  }),
].join("\n");

describe("json-render catalog (render_ui)", () => {
  test("a well-formed SpecStream compiles and validates", () => {
    const spec = parseRenderUiSpec(GOOD);
    const result = validateRenderUiSpec(spec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.elementCount).toBe(5);
      // `on` and `state` survive: the catalog validator strips them, the spec we keep must not.
      expect(result.spec.state).toEqual({ form: { name: "" } });
      expect((result.spec.elements.send as { on?: unknown }).on).toBeDefined();
    }
  });

  test("a whole JSON spec object is accepted as well as JSONL", () => {
    const spec = parseRenderUiSpec(
      JSON.stringify({ root: "t", elements: { t: { type: "Text", props: { text: "你好" }, children: [] } } }),
    );
    expect(validateRenderUiSpec(spec).ok).toBe(true);
  });

  test("code fences around the JSONL are tolerated", () => {
    expect(validateRenderUiSpec(parseRenderUiSpec(`\`\`\`jsonl\n${GOOD}\n\`\`\``)).ok).toBe(true);
  });

  test("streaming parse ignores the unfinished last line", () => {
    const cut = GOOD.slice(0, GOOD.indexOf("/elements/grid") + 20);
    const spec = parseRenderUiSpec(cut, true);
    expect(spec?.root).toBe("card");
    expect(Object.keys(spec?.elements ?? {})).toEqual(["card"]);
  });

  test("unknown components, missing children and bad props are reported", () => {
    const result = validateRenderUiSpec(
      parseRenderUiSpec(
        JSON.stringify({
          root: "a",
          elements: {
            a: { type: "Metric", props: { label: 3, value: "1" }, children: ["ghost"] },
            b: { type: "Marquee", props: {}, children: [] },
            c: { type: "Image", props: { src: "http://x.test/a.png", alt: "x" }, children: [] },
          },
        }),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const all = result.issues.join("\n");
      expect(all).toContain("Marquee");
      expect(all).toContain("ghost");
      expect(all).toContain("props.label");
      expect(all).toContain("https://");
    }
  });

  test("action bindings are checked: unknown actions and missing params", () => {
    const button = (on: unknown) => ({
      root: "b",
      elements: { b: { type: "Button", props: { label: "确定" }, on, children: [] } },
    });
    const wrongParam = validateRenderUiSpec(
      button({ press: { action: "send_message", params: { message: "好的" } } }),
    );
    expect(wrongParam.ok).toBe(false);
    if (!wrongParam.ok) expect(wrongParam.issues.join("\n")).toContain("params.text");
    const unknown = validateRenderUiSpec(button({ press: { action: "delete_everything" } }));
    expect(unknown.ok).toBe(false);
    expect(validateRenderUiSpec(button({ press: { action: "setState", params: { statePath: "/x", value: 1 } } })).ok).toBe(true);
    expect(validateRenderUiSpec(button({ press: { action: "send_message", params: { text: "好的" } } })).ok).toBe(true);
  });

  test("dynamic expressions are not checked as static values", () => {
    const result = validateRenderUiSpec({
      root: "t",
      elements: { t: { type: "Text", props: { text: { $state: "/greeting" } }, children: [] } },
      state: { greeting: "你好" },
    });
    expect(result.ok).toBe(true);
  });

  test("a broken JSONL line is named instead of surfacing as a missing child", () => {
    const broken = GOOD.replace('"children":["m1"]}}', '"children":["m1"]}]}');
    const result = inspectRenderUiSpec(broken);
    // 写坏的那一行只跳过它定义的元素，其余照常显示；坏行作为警告报给模型。
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings?.[0]).toContain("第 3 行");
    expect(inspectRenderUiSpec(GOOD).ok).toBe(true);
  });

  test("empty or unparsable input is refused with a reason", () => {
    expect(validateRenderUiSpec(parseRenderUiSpec("")).ok).toBe(false);
    expect(validateRenderUiSpec(parseRenderUiSpec("not json")).ok).toBe(false);
  });

  test("the prompt names the tool, every component, and drops the invent-sample-data rules", () => {
    const prompt = renderUiPrompt();
    expect(prompt).toContain(RENDER_UI_TOOL);
    for (const name of jsonRenderCatalog.componentNames) expect(prompt).toContain(`- ${name}:`);
    expect(prompt).toContain("send_message");
    expect(prompt).not.toMatch(/sample data/i);
  });

  test("tolerant: message/content alias, unknown component and dangling child are skipped, not refused", () => {
    const spec = [
      JSON.stringify({ op: "add", path: "/root", value: "card" }),
      JSON.stringify({ op: "add", path: "/elements/card", value: { type: "Card", props: { title: "状态" }, children: ["m", "rec", "tbl", "btn"] } }),
      JSON.stringify({ op: "add", path: "/elements/m", value: { type: "Metric", props: { label: "CPU", value: "23%" }, children: [] } }),
      JSON.stringify({ op: "add", path: "/elements/rec", value: { type: "Record", props: {}, children: [] } }),
      JSON.stringify({ op: "add", path: "/elements/btn", value: { type: "Button", props: { label: "刷新" }, on: { press: { action: "send_message", params: { message: "刷新" } } }, children: [] } }),
    ].join("\n");
    const result = inspectRenderUiSpec(spec);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.spec.elements).sort()).toEqual(["btn", "card", "m"]);
      expect(result.spec.elements.card?.children).toEqual(["m", "btn"]);
      const on = (result.spec.elements.btn as { on?: { press?: { params?: { text?: string } } } }).on;
      expect(on?.press?.params?.text).toBe("刷新");
      expect(result.warnings?.join("\n")).toContain("Record");
    }
  });

  test("a spec whose root itself is unusable is still refused", () => {
    expect(inspectRenderUiSpec(JSON.stringify({ root: "x", elements: { x: { type: "Record", props: {}, children: [] } } })).ok).toBe(false);
  });
});
