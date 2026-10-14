import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../src/db/client";
import { score, RELEVANT } from "../src/memory-notes/search";
import { createMemoryNotes, dayIn } from "../src/memory-notes/service";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

/** 长期记忆（DESIGN.md §50）：打分、合并、日志、忘记、按机器人关闭、上下文。 */
describe("memory search score", () => {
  test("subject and substring hits rank first", () => {
    expect(score("妈妈", { subject: "妈妈", content: "生日 3 月 2 日", context: null })).toBe(1);
    expect(score("咖啡", { subject: null, content: "早上喝燕麦拿铁咖啡", context: null })).toBeGreaterThan(0.8);
  });
  test("bigram overlap finds reworded Chinese", () => {
    expect(score("燕麦奶拿铁", { subject: null, content: "喜欢燕麦拿铁", context: "在公司" })).toBeGreaterThanOrEqual(RELEVANT);
    expect(score("飞机座位", { subject: null, content: "喜欢吃辣", context: null })).toBeLessThan(RELEVANT);
  });
  test("latin words", () => {
    expect(score("frankfurt server", { subject: "Frankfurt", content: "VPS", context: null })).toBeGreaterThan(0.3);
  });
});

const url = process.env.TEST_DATABASE_URL ? testDatabaseUrl() : null;
describe.skipIf(!url)("memory notes store", () => {
  const database = url ? createDatabase(url, TEST_POOL) : (null as never);
  const notes = url ? createMemoryNotes(database) : (null as never);
  const owner = `memtest-${randomUUID().slice(0, 8)}`;
  const other = `memtest-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    await notes.ensure();
  });
  afterAll(async () => {
    await database.$client.unsafe("DELETE FROM chisabot_memory_notes WHERE owner_user_id IN ($1, $2)", [owner, other]);
    await database.$client.unsafe("DELETE FROM chisabot_memory_bots WHERE owner_user_id IN ($1, $2)", [owner, other]);
  });

  test("person notes merge by subject; duplicates are not stored twice", async () => {
    const a = await notes.create(owner, { kind: "person", subject: "小林", content: "大学室友" }, "bot-a");
    const b = await notes.create(owner, { kind: "person", subject: "小林", content: "住在杭州" }, "bot-b");
    expect(b.merged).toBe(true);
    expect(b.note.id).toBe(a.note.id);
    expect(b.note.content).toBe("大学室友\n住在杭州");
    const c = await notes.create(owner, { kind: "preference", content: "不吃香菜" }, null);
    const d = await notes.create(owner, { kind: "preference", content: "不吃香菜" }, "bot-a");
    expect(d.unchanged).toBe(true);
    expect(d.note.id).toBe(c.note.id);
    expect(notes.create(owner, { kind: "person", content: "没有名字" }, null)).rejects.toThrow();
  });

  test("other users never see these notes", async () => {
    expect(await notes.search(other, "小林")).toHaveLength(0);
    expect(await notes.remove(other, (await notes.search(owner, "小林")).map((row) => row.id))).toHaveLength(0);
  });

  test("tools: log appends to today's daily note, forget deletes every copy", async () => {
    const tools = notes.tools(owner, "bot-a");
    const run = (name: string, args: unknown) => tools.find((tool) => tool.name === name)!.execute(args);
    await run("memory_log", { entry: "帮用户订了周五的餐厅" });
    await run("memory_log", { entry: "还差确认人数" });
    const [daily] = await notes.search(owner, "", "daily");
    expect(daily!.subject).toBe(dayIn("Asia/Shanghai"));
    expect(daily!.content.split("\n")).toHaveLength(2);
    await run("memory_save", { kind: "preference", content: "香菜一点都不要", context: "点外卖时" });
    const found = await run("memory_search", { query: "香菜" });
    expect(found).toContain("不吃香菜");
    expect(found).toContain("香菜一点都不要");
    const ids = [...found.matchAll(/\[(mem_[a-f0-9]+)\]/g)].map((m) => m[1]!);
    expect(ids.length).toBe(2);
    expect(await run("memory_forget", { ids })).toContain("已删除 2 条");
    expect(await run("memory_search", { query: "香菜" })).toBe("没有找到相关笔记。");
  });

  test("a bot with memory off gets no context and its tools refuse", async () => {
    expect(await notes.context(owner, "bot-b")).toContain("小林");
    await notes.setBot(owner, "bot-b", false);
    expect(await notes.context(owner, "bot-b")).toBe("");
    expect(await notes.tools(owner, "bot-b")[0]!.execute({ query: "小林" })).toContain("关掉了");
    expect(await notes.context(owner, "bot-a")).toContain("小林");
  });
});
