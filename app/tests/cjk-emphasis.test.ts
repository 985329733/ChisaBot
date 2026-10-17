import { describe, expect, test } from "bun:test";
import { cjkFriendlyEmphasis } from "../src/lib/chat/cjk-emphasis";

describe("cjkFriendlyEmphasis (§101)", () => {
  test("moves punctuation that would break a closing ** outside", () => {
    expect(cjkFriendlyEmphasis("**标题：**OpenAI 突袭 Chrome")).toBe("**标题**：OpenAI 突袭 Chrome");
    expect(cjkFriendlyEmphasis("**摘要：**OpenAI 将")).toBe("**摘要**：OpenAI 将");
    expect(cjkFriendlyEmphasis("写的是**“ChisaBot”**这个")).toBe("写的是“**ChisaBot**”这个");
  });
  test("leaves text that already works alone", () => {
    for (const s of ["**标题**：OpenAI", "About：**“ChisaBot”**。", "**粗体** 正常", "a **b** c", "**只有标点：**", "没有星号"])
      expect(cjkFriendlyEmphasis(s)).toBe(s);
  });
  test("does not touch code", () => {
    const s = "看 `**标题：**x` 和\n```\n**标题：**x\n```\n然后**结论：**好";
    expect(cjkFriendlyEmphasis(s)).toBe("看 `**标题：**x` 和\n```\n**标题：**x\n```\n然后**结论**：好");
  });
});
