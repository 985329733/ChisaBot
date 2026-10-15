import { describe, expect, test } from "bun:test";
import { summarizeDoneWork, summarizeWork } from "../src/lib/chat/work-steps";

describe("summarizeWork（DESIGN.md §70）", () => {
  test("没有工具调用就没有卡", () => {
    expect(summarizeWork([])).toBeNull();
  });
  test("当前步骤 = 最后一个能描述的调用；数步骤和完成数", () => {
    const s = summarizeWork([
      { name: "web_search", arguments: JSON.stringify({ query: "iPhone 17 Pro 国行价格" }), done: true },
      { name: "web_fetch", arguments: JSON.stringify({ url: "https://www.apple.com.cn/newsroom/" }), done: false },
    ]);
    expect(s).toEqual({ count: 2, done: 1, current: "正在读取 apple.com.cn" });
  });
  test("参数还没写完（半截 JSON）不报错", () => {
    expect(summarizeWork([{ name: "web_search", arguments: '{"query":"iph', done: false }])?.current).toBe("正在搜索");
  });
  test("维护清单这类返回 null 的调用不改那一行", () => {
    const s = summarizeWork([
      { name: "web_search", arguments: JSON.stringify({ query: "天气" }), done: true },
      { name: "worker_plan", arguments: "{}", done: true },
    ]);
    expect(s?.current).toBe("正在搜索「天气」");
  });
  test("没有中文说法的工具（skill_load）不当当前步骤，不露工具名", () => {
    expect(summarizeWork([{ name: "skill_load", arguments: "{}", done: false }])?.current).toBe("正在处理");
    const s = summarizeWork([
      { name: "web_search", arguments: JSON.stringify({ query: "降噪耳机" }), done: true },
      { name: "skill_load", arguments: "{}", done: false },
    ]);
    expect(s?.current).toBe("正在搜索「降噪耳机」");
  });
});

describe("summarizeDoneWork（DESIGN.md §70.2）", () => {
  const call = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: JSON.stringify(args), done: true });
  test("只有搜索 / 读网页：说搜了几次、看了几个网页", () => {
    const done = summarizeDoneWork([
      call("web_search", { query: "iPhone 17 Pro 价格" }),
      call("web_fetch", { url: "https://www.apple.com.cn/iphone" }),
      call("web_fetch", { url: "https://news.sina.com.cn/x" }),
      call("render_ui"),
    ]);
    expect(done?.label).toBe("搜索 1 次 · 看了 2 个网页");
    expect(done?.steps).toEqual(["搜索「iPhone 17 Pro 价格」", "读取 apple.com.cn", "读取 news.sina.com.cn"]);
  });
  test("有别的工具：做了几步；相同的步骤连着只记一次", () => {
    const done = summarizeDoneWork([call("computer_click"), call("computer_click"), call("web_search", { query: "x" })]);
    expect(done?.label).toBe("做了 3 步");
    expect(done?.steps).toEqual(["点击", "搜索「x」"]);
  });
  test("读技能不算一步；没有中文说法的工具算一步但不列名字", () => {
    const done = summarizeDoneWork([call("skill_load", { name: "x" }), call("web_search", { query: "q" }), call("some_tool")]);
    expect(done?.label).toBe("做了 2 步");
    expect(done?.steps).toEqual(["搜索「q」"]);
  });
  test("只画了卡片：不出这一行", () => {
    expect(summarizeDoneWork([call("render_ui")])).toBeNull();
    expect(summarizeDoneWork([])).toBeNull();
  });
});
