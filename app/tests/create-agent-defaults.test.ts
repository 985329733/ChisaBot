import { describe, expect, test } from "bun:test";
import { emptyAgentForm, titleFromPurpose, withCreateDefaults } from "../src/lib/agents/form";

describe("新建机器人：名称 + 可不填的「它做什么」（DESIGN.md §74.2）", () => {
  test("什么都没写：职责「私人助手」，提示词补一句基本说明", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: " 小助 " });
    expect(out.title).toBe("私人助手");
    expect(out.roleDescription).toContain("你是「小助」");
    expect(out.roleDescription.length).toBeLessThanOrEqual(1000);
  });
  test("只写一句要做的事：前面补「你是名称」，职责取第一句", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: "记账", roleDescription: "帮我记账，月底给我汇总" });
    expect(out.title).toBe("记账");
    expect(out.roleDescription.startsWith("你是「记账」。帮我记账，月底给我汇总。")).toBe(true);
    expect(out.roleDescription).toContain("简体中文");
  });
  test("用户自己写的「你是…」整段原样用", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: "a", roleDescription: "你是我的英语老师，帮我纠正语法。" });
    expect(out.roleDescription).toBe("你是我的英语老师，帮我纠正语法。");
    expect(out.title).toBe("我的英语老师");
  });
  test("太长的第一句截到 18 个字", () => {
    expect(titleFromPurpose("一二三四五六七八九十一二三四五六七八九十")).toBe("一二三四五六七八九十一二三四五六七…");
    expect(titleFromPurpose("   ")).toBe("私人助手");
  });
  test("补完超过 1000 字时原样用，不让服务器拒绝", () => {
    const long = "记".repeat(990);
    const out = withCreateDefaults({ ...emptyAgentForm, name: "长", roleDescription: long });
    expect(out.roleDescription).toBe(long);
  });
});
