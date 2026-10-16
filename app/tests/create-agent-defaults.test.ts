import { describe, expect, test } from "bun:test";
import { DEFAULT_PURPOSE, emptyAgentForm, titleFromPurpose, withProfileDefaults } from "../src/lib/agents/form";

describe("机器人资料表单的默认值（DESIGN.md §81，取代 §74.2 的「补提示词」）", () => {
  test("什么都没写：职责「私人助手」，它做什么是默认那句", () => {
    const out = withProfileDefaults({ ...emptyAgentForm, name: " 小助 " });
    expect(out.name).toBe("小助");
    expect(out.title).toBe("私人助手");
    expect(out.roleDescription).toBe(DEFAULT_PURPOSE);
  });
  test("写了它做什么：原样保存（编辑时看到的就是自己写的），职责取第一句", () => {
    const out = withProfileDefaults({ ...emptyAgentForm, name: "记账", roleDescription: " 帮我记账，月底给我汇总 " });
    expect(out.roleDescription).toBe("帮我记账，月底给我汇总");
    expect(out.title).toBe("记账");
  });
  test("自己写了职责就用自己的", () => {
    const out = withProfileDefaults({ ...emptyAgentForm, name: "a", title: "英语", roleDescription: "你是我的英语老师，帮我纠正语法。" });
    expect(out.title).toBe("英语");
    expect(out.roleDescription).toBe("你是我的英语老师，帮我纠正语法。");
  });
  test("职责：去掉「你是 / 帮我」、遇到冒号逗号句号就停、最多 18 个字", () => {
    expect(titleFromPurpose("你是我的英语老师，帮我纠正语法")).toBe("我的英语老师");
    expect(titleFromPurpose(DEFAULT_PURPOSE)).toBe("我的私人助手");
    expect(titleFromPurpose("一二三四五六七八九十一二三四五六七八九十")).toBe("一二三四五六七八九十一二三四五六七…");
    expect(titleFromPurpose("   ")).toBe("私人助手");
  });
});
