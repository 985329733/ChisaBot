import { describe, expect, test } from "bun:test";
import { MAX_BUBBLES, splitBubbles } from "../src/lib/chat/bubbles";

describe("splitBubbles（DESIGN.md §69）", () => {
  test("空行分段，一段一个气泡", () => {
    const s = splitBubbles("东京现在 13:15。\n\n要我做个世界时钟面板吗？");
    expect(s.map((x) => x.text)).toEqual(["东京现在 13:15。", "要我做个世界时钟面板吗？"]);
    expect(s.every((x) => x.kind === "text" && !x.wide)).toBe(true);
  });

  test("空文本没有气泡", () => {
    expect(splitBubbles("  \n\n ")).toEqual([]);
  });

  test("代码块不会从中间的空行切开，代码块宽", () => {
    const md = "回文判断：\n\n```python\ndef f(s):\n\n    return s == s[::-1]\n```\n\n要忽略大小写吗？";
    const s = splitBubbles(md);
    expect(s.length).toBe(3);
    expect(s[1]?.kind).toBe("code");
    expect(s[1]?.text).toContain("return s == s[::-1]");
    expect(s[1]?.wide).toBe(true);
  });

  test("流式时没闭合的代码块是一整段", () => {
    const s = splitBubbles("看这个：\n\n```ts\nconst a = 1;\n\nconst b");
    expect(s.length).toBe(2);
    expect(s[1]?.kind).toBe("code");
  });

  test("```draft = 草稿卡，标题行拿出来", () => {
    const s = splitBubbles("写好了，可以直接发：\n\n```draft\n标题：给房东\n房东您好，厨房水管漏水了。\n\n周六上午方便来修吗？\n```\n\n要更客气一点吗？");
    expect(s.map((x) => x.kind)).toEqual(["text", "draft", "text"]);
    expect(s[1]?.title).toBe("给房东");
    expect(s[1]?.text).toBe("房东您好，厨房水管漏水了。\n\n周六上午方便来修吗？");
  });

  test("段首引用 = 回复引用；只有引用的段落照普通段落", () => {
    const s = splitBubbles("iPhone 17 Pro 起售价 8999 元。\n\n> 只要 256G 的价格\n256GB 就是 8999 元。");
    expect(s[1]?.quote).toBe("只要 256G 的价格");
    expect(s[1]?.text).toBe("256GB 就是 8999 元。");
    const only = splitBubbles("> 一句名言");
    expect(only[0]?.quote).toBeUndefined();
    expect(only[0]?.text).toBe("> 一句名言");
  });

  test("引用行后面空一行也算同一段", () => {
    const s = splitBubbles("> 只要国行\n\n国行 256GB 8999 元。");
    expect(s.length).toBe(1);
    expect(s[0]?.quote).toBe("只要国行");
  });

  test("引导句 + 列表合成一段；松散列表合成一段；三项以上的列表宽", () => {
    const s = splitBubbles("主要配置：\n\n- A19 Pro\n\n- 6.3 英寸\n\n- 三摄\n\n要对比 Pro Max 吗？");
    expect(s.length).toBe(2);
    expect(s[0]?.text).toContain("主要配置：");
    expect(s[0]?.text).toContain("- 三摄");
    expect(s[0]?.wide).toBe(true);
  });

  test("引导句 + 表格合成一段，表格宽", () => {
    const s = splitBubbles("对比：\n\n| a | b |\n|---|---|\n| 1 | 2 |");
    expect(s.length).toBe(1);
    expect(s[0]?.wide).toBe(true);
  });

  test("标题跟着下一段", () => {
    const s = splitBubbles("## 价格\n\n8999 元起。");
    expect(s.length).toBe(1);
  });

  test(`最多 ${MAX_BUBBLES} 个气泡，多的并进最后一个，不丢内容`, () => {
    const parts = Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 段。`);
    const s = splitBubbles(parts.join("\n\n"));
    expect(s.length).toBe(MAX_BUBBLES);
    expect(s[MAX_BUBBLES - 1]?.text).toContain("第 9 段。");
    expect(s[MAX_BUBBLES - 1]?.text).toContain(`第 ${MAX_BUBBLES} 段。`);
  });
});
