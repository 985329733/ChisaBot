import { describe, expect, test } from "bun:test";
import { assertPublicUrl, htmlToText, parseDuckDuckGo } from "../src/web/tools";
import { clampRefresh } from "../src/live-panels/store";

describe("web tools", () => {
  test("parses DuckDuckGo html results and unwraps redirect links", () => {
    const html = `<div class="result results_links results_links_deep web-result "><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1">Example &amp; A</a><a class="result__snippet" href="#">Snippet <b>bold</b></a></div>`;
    expect(parseDuckDuckGo(html)).toEqual([{ title: "Example & A", url: "https://example.com/a", snippet: "Snippet bold" }]);
  });
  test("html to text keeps headings and drops scripts", () => {
    const { title, text } = htmlToText("<html><title>T &amp; U</title><body><script>x()</script><h1>Hi</h1><p>One</p><ul><li>a</li></ul></body></html>");
    expect(title).toBe("T & U");
    expect(text).toContain("# Hi");
    expect(text).toContain("- a");
    expect(text).not.toContain("x()");
  });
  test("refuses private addresses", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow();
    await expect(assertPublicUrl("http://10.1.2.3/")).rejects.toThrow();
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow();
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertPublicUrl("http://localhost:3000/")).rejects.toThrow();
  });
  test("live panel refresh floor is one hour", () => {
    expect(clampRefresh(5)).toBe(60);
    expect(clampRefresh(0)).toBeNull();
    expect(clampRefresh(1440)).toBe(1440);
  });
});

import { emptyMetrics } from "../src/live-panels/service";
test("面板 Metric 没有数值会被拦下", () => {
  const ok = JSON.stringify({ root: "c", elements: { c: { type: "Card", props: { title: "BTC" }, children: ["m"] }, m: { type: "Metric", props: { label: "现价", value: "$82,407" }, children: [] } } });
  const bad = JSON.stringify({ root: "c", elements: { c: { type: "Card", props: { title: "BTC" }, children: ["m"] }, m: { type: "Metric", props: { label: "现价", value: { $state: "/btc/price" } }, children: [] } } });
  expect(emptyMetrics(ok)).toEqual([]);
  expect(emptyMetrics(bad)).toEqual(["现价"]);
});

import { emptySections, pruneEmptySections } from "../../shared/json-render/empty-sections";
test("空的列表 / 重复区块：服务器报出来，浏览器剪掉（连同小标题）", () => {
  const spec = {
    root: "c",
    state: { days: [] as unknown[] },
    elements: {
      c: { type: "Card", props: { title: "香港天气" }, children: ["now", "h", "rep", "h2", "list"] },
      now: { type: "Metric", props: { label: "气温", value: "24.8°C" }, children: [] },
      h: { type: "Heading", props: { text: "未来 5 天" }, children: [] },
      rep: { type: "Stack", props: {}, repeat: { statePath: "/days" }, children: ["d"] },
      d: { type: "Text", props: { text: { $item: "label" } }, children: [] },
      h2: { type: "Heading", props: { text: "提醒" }, children: [] },
      list: { type: "List", props: { items: [{ title: "带伞" }] }, children: [] },
    },
  };
  expect(emptySections(spec as never)).toEqual(["未来 5 天"]);
  const pruned = pruneEmptySections(spec as never) as typeof spec;
  expect(pruned.elements.c.children).toEqual(["now", "h2", "list"]);
  const full = { ...spec, state: { days: [{ label: "周二" }] } };
  expect(emptySections(full as never)).toEqual([]);
  const emptyList = { root: "c", elements: { c: { type: "Stack", props: {}, children: ["h", "l"] }, h: { type: "Heading", props: { text: "新闻" }, children: [] }, l: { type: "List", props: { items: { $state: "/news" } }, children: [] } } };
  expect(emptySections(emptyList as never)).toContain("新闻");
});
