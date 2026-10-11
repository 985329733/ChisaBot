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
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]).toContain("第 3 行");
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
});
