import { describe, expect, test } from "bun:test";
import { emptyAgentForm, withCreateDefaults } from "../src/lib/agents/form";

describe("新建机器人：只有名称必填（成熟度扫查 F1）", () => {
  test("职责、提示词都空时补一句基本说明", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: " 小助 " });
    expect(out.title).toBe("私人助手");
    expect(out.roleDescription).toContain("你是「小助」");
    expect(out.roleDescription).not.toContain("负责");
    expect(out.roleDescription.length).toBeLessThanOrEqual(1000);
  });
  test("填了职责就写进提示词", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: "记账", title: "帮我记账" });
    expect(out.title).toBe("帮我记账");
    expect(out.roleDescription).toContain("负责：帮我记账");
  });
  test("用户自己写的不动", () => {
    const out = withCreateDefaults({ ...emptyAgentForm, name: "a", title: "b", roleDescription: "自己写的" });
    expect(out.roleDescription).toBe("自己写的");
    expect(out.title).toBe("b");
  });
});
