import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 右栏「面板 | 计算机」（DESIGN.md §23 / §79）：只要页面是某个机器人的聊天，右栏就有「计算机」。
 *
 * 「计算机」标签只在页面用 `RegisterBotChat` 登记了 `onComputerChange` 时出现（`canComputer`）。
 * 2026-10-16 用户刚建好机器人、还没发第一条消息时右栏只剩「面板」：空聊天 `/channel/new` 没登记它。
 * 这里锁住两条聊天路由都登记了计算机开关，以后改路由时不会再悄悄丢掉。
 */
const ROUTES = join(import.meta.dir, "../src/routes/_authed/_app/channel");
const read = (file: string) => readFileSync(join(ROUTES, file), "utf8");
const registration = (source: string) => {
  const start = source.indexOf("<RegisterBotChat");
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf("/>", start));
};

describe("右栏计算机入口", () => {
  test("已有对话登记了计算机开关", () => {
    const tag = registration(read("$channelId.tsx"));
    expect(tag).toContain("onComputerChange=");
    expect(tag).toContain("computerOpen=");
  });

  test("空聊天 / 新话题也登记了计算机开关", () => {
    const tag = registration(read("new.tsx"));
    expect(tag).toContain("onComputerChange=");
    expect(tag).toContain("computerOpen=");
  });

  test("空聊天发第一条消息时把打开的计算机带进新对话", () => {
    expect(read("new.tsx")).toMatch(/startChosen\([^)]*\{\s*watch\s*\}\)/);
    const start = readFileSync(join(import.meta.dir, "../src/lib/channels/start.ts"), "utf8");
    expect(start).toContain("search: { watch: true }");
  });
});
