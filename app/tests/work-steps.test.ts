import { describe, expect, test } from "bun:test";
import { summarizeWork } from "../src/lib/chat/work-steps";

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
});
