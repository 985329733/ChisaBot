import { describe, expect, test } from "bun:test";
import type { PluginStore } from "../src/plugins/store";
import { createChisaSkills } from "../src/skills-chisa/tools";

/** 技能（DESIGN.md §51）：目录、加载、新建 / 改写只动自己的、局部修改、搜索。用假的插件存储。 */
type Row = { slug: string; title: string; summary: string; instructions: string; ownerUserId: string | null };
function fakeStore(rows: Row[]) {
  return {
    async listSkills(actor?: { id: string; isAdmin: boolean }) {
      return rows.filter((row) => !actor || actor.isAdmin || row.ownerUserId === null || row.ownerUserId === actor.id).map((row) => ({ ...row, id: row.slug }));
    },
    async skillOwner(slug: string) {
      const row = rows.find((r) => r.slug === slug);
      return row ? row.ownerUserId : undefined;
    },
    async installSkill(input: Row & { by: string }) {
      const existing = rows.find((r) => r.slug === input.slug);
      if (existing) Object.assign(existing, { title: input.title, summary: input.summary, instructions: input.instructions });
      else rows.push({ slug: input.slug, title: input.title, summary: input.summary, instructions: input.instructions, ownerUserId: input.ownerUserId });
    },
    async uninstallSkill(slug: string) {
      rows.splice(rows.findIndex((r) => r.slug === slug), 1);
    },
  } as unknown as PluginStore;
}

describe("chisa skills", () => {
  const rows: Row[] = [
    { slug: "shared-triage", title: "分诊", summary: "处理工单时", instructions: "按优先级分。", ownerUserId: null },
    { slug: "alice-report", title: "写周报", summary: "写周报时", instructions: "1. 列本周完成\n2. 列下周计划", ownerUserId: "alice" },
    { slug: "bob-secret", title: "Bob 的", summary: "", instructions: "x", ownerUserId: "bob" },
  ];
  // alice 是管理员：设置里能看到 bob 的，但机器人不该用别人的技能。
  const skills = createChisaSkills({ store: fakeStore(rows), actorFor: async (id) => ({ id, isAdmin: id === "alice" }) });
  const run = (name: string, args: unknown) => skills.tools("alice", "bot-1").find((tool) => tool.name === name)!.execute(args);

  test("catalog lists own + shared, never someone else's", async () => {
    const catalog = await skills.catalog("alice");
    expect(catalog).toContain("alice-report");
    expect(catalog).toContain("shared-triage");
    expect(catalog).not.toContain("bob-secret");
  });
  test("load returns the instructions", async () => {
    expect(await run("skill_load", { slug: "alice-report" })).toContain("列本周完成");
    expect(await run("skill_load", { slug: "bob-secret" })).toContain("没有叫");
  });
  test("save creates own skills and refuses names taken by others", async () => {
    expect(await run("skill_save", { slug: "trip-plan", title: "做行程", summary: "规划旅行时", instructions: "先问预算" })).toContain("已新建");
    expect(rows.find((r) => r.slug === "trip-plan")?.ownerUserId).toBe("alice");
    expect(await run("skill_save", { slug: "shared-triage", title: "x", summary: "", instructions: "y" })).toContain("占用");
    expect(await run("skill_save", { slug: "Bad Name", title: "x", summary: "", instructions: "y" })).toContain("小写");
  });
  test("edit replaces one exact passage of own skills only", async () => {
    expect(await run("skill_edit", { slug: "alice-report", find: "列下周计划", replace: "列下周计划和风险" })).toContain("已修改");
    expect(rows.find((r) => r.slug === "alice-report")?.instructions).toContain("风险");
    expect(await run("skill_edit", { slug: "shared-triage", find: "按优先级", replace: "z" })).toContain("只读");
    expect(await run("skill_edit", { slug: "alice-report", find: "不存在的话", replace: "z" })).toContain("没找到");
  });
  test("list searches Chinese titles", async () => {
    const out = await run("skill_list", { query: "周报" });
    expect(out.split("\n")[0]).toContain("alice-report");
  });
});
