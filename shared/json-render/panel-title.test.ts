import { describe, expect, test } from "bun:test";
import { dropDuplicateTitle, sameTitle } from "./panel-title";

const spec = (elements: Record<string, unknown>, root = "root") => ({ root, elements }) as never;

describe("dropDuplicateTitle", () => {
  test("drops a root Card title equal to the panel title, keeps its description", () => {
    const out = dropDuplicateTitle(
      spec({ root: { type: "Card", props: { title: "香港天气", description: "10/13 08:15" }, children: ["m"] }, m: { type: "Metric", props: { label: "气温", value: "26.9℃" }, children: [] } }),
      "香港天气",
    ) as { elements: Record<string, { props: Record<string, unknown> }> };
    expect(out.elements.root.props.title).toBeNull();
    expect(out.elements.root.props.description).toBe("10/13 08:15");
  });
  test("drops a leading Heading equal to the panel title inside an untitled wrapper", () => {
    const out = dropDuplicateTitle(
      spec({ root: { type: "Stack", props: {}, children: ["c"] }, c: { type: "Card", props: {}, children: ["h", "t"] }, h: { type: "Heading", props: { text: "香港 天气" }, children: [] }, t: { type: "Text", props: { text: "晴" }, children: [] } }),
      "香港天气",
    ) as { elements: Record<string, { children: string[] }> };
    expect(out.elements.c.children).toEqual(["t"]);
  });
  test("leaves other titles alone", () => {
    const input = spec({ root: { type: "Card", props: { title: "未来 4 天" }, children: [] } });
    expect(dropDuplicateTitle(input, "香港天气")).toBe(input);
    expect(sameTitle("比特币价格", "比特币价格（BTC）")).toBe(true);
    expect(sameTitle("BTC", "ETH")).toBe(false);
  });
});
