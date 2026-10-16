import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  BOT_TTL_MS,
  botUi,
  DRAFT_TTL_MS,
  flushUiMemory,
  rememberedDraft,
  resetUiMemory,
  SCROLL_TTL_MS,
  setBotUi,
  setThreadUi,
  setWorkUi,
  stashDraftFiles,
  takeDraftFiles,
  threadUi,
  UI_MEMORY_KEY,
  workUi,
} from "@/lib/chat/ui-memory";
import { isPromptSegment } from "@/components/channels/composer/composer";

/**
 * 每个机器人 / 每段对话「我的操作状态」（DESIGN.md §88）：内存一份 + localStorage（刷新还在）、有效期、条数上限、
 * 草稿只放回结构对的、附件只在内存里取一次。
 */
const registered = !(globalThis as { document?: unknown }).document;
beforeAll(() => {
  if (registered) GlobalRegistrator.register({ url: "http://localhost/" });
});
afterAll(async () => {
  if (registered) await GlobalRegistrator.unregister();
});
beforeEach(() => {
  resetUiMemory();
  window.localStorage.clear();
});

/** 模拟刷新：把内存那份落盘、丢掉，下次从 localStorage 读。 */
function reload() {
  flushUiMemory();
  resetUiMemory();
}

describe("按机器人记", () => {
  test("右栏标签 / 展开 / 宽度，刷新后还在", () => {
    setBotUi("bot_a", { computer: true, railOpen: false, railWidth: 460 });
    setBotUi("bot_b", { computer: false });
    reload();
    expect(botUi("bot_a")).toMatchObject({ computer: true, railOpen: false, railWidth: 460 });
    expect(botUi("bot_b")?.computer).toBe(false);
    expect(botUi("bot_c")).toBeUndefined();
    expect(botUi(undefined)).toBeUndefined();
  });

  test("合并写：只改给的那几项", () => {
    setBotUi("bot_a", { computer: true, railWidth: 420 });
    setBotUi("bot_a", { railOpen: true });
    expect(botUi("bot_a")).toMatchObject({ computer: true, railWidth: 420, railOpen: true });
  });

  test("过期的丢掉", () => {
    const old = Date.now() - BOT_TTL_MS - 1000;
    window.localStorage.setItem(
      UI_MEMORY_KEY,
      JSON.stringify({ bots: { gone: { computer: true, at: old }, kept: { computer: true, at: Date.now() } }, threads: {}, work: {} }),
    );
    resetUiMemory();
    expect(botUi("gone")).toBeUndefined();
    expect(botUi("kept")?.computer).toBe(true);
  });

  test("localStorage 里是坏的 JSON：从空开始，不抛", () => {
    window.localStorage.setItem(UI_MEMORY_KEY, "{not json");
    resetUiMemory();
    expect(botUi("x")).toBeUndefined();
    setBotUi("x", { computer: true });
    reload();
    expect(botUi("x")?.computer).toBe(true);
  });
});

describe("按对话记", () => {
  const draft = [
    { type: "text", text: "帮我看看 " },
    { type: "chip", trigger: "/", value: "skill_1", displayText: "总结" },
    { type: "text", text: " 这份文件" },
  ];

  test("草稿（含命令小块）刷新后原样放回；清空就删掉", () => {
    setThreadUi("ch_1", { draft });
    reload();
    expect(rememberedDraft("ch_1", isPromptSegment)).toEqual(draft as never);
    setThreadUi("ch_1", { draft: undefined });
    reload();
    expect(rememberedDraft("ch_1", isPromptSegment)).toBeNull();
    expect(threadUi("ch_1")?.draftAt).toBeUndefined();
  });

  test("结构不对的草稿不放回", () => {
    setThreadUi("ch_2", { draft: [{ type: "text", text: 1 }] });
    expect(rememberedDraft("ch_2", isPromptSegment)).toBeNull();
    setThreadUi("ch_3", { draft: [{ type: "chip", trigger: "@" }] });
    expect(rememberedDraft("ch_3", isPromptSegment)).toBeNull();
  });

  test("草稿 7 天、滚动位置 1 天过期，别的留着", () => {
    const now = Date.now();
    window.localStorage.setItem(
      UI_MEMORY_KEY,
      JSON.stringify({
        bots: {},
        threads: {
          ch: {
            agent: "bot_a",
            draft,
            draftAt: now - DRAFT_TTL_MS - 1000,
            scroll: { atBottom: false, spacer: 0, anchor: "m1", offset: -20, at: now - SCROLL_TTL_MS - 1000 },
            at: now,
          },
          fresh: {
            draft,
            draftAt: now,
            scroll: { atBottom: false, spacer: 0, anchor: "m2", offset: 12, at: now },
            at: now,
          },
        },
        work: {},
      }),
    );
    resetUiMemory();
    expect(threadUi("ch")?.agent).toBe("bot_a");
    expect(threadUi("ch")?.draft).toBeUndefined();
    expect(threadUi("ch")?.scroll).toBeUndefined();
    expect(rememberedDraft("fresh", isPromptSegment)).toHaveLength(3);
    expect(threadUi("fresh")?.scroll).toMatchObject({ anchor: "m2", offset: 12 });
  });

  test("滚动位置：在底部记留白，不在底部记那一条和离顶边多远", () => {
    setThreadUi("ch", { scroll: { atBottom: true, spacer: 180, anchor: null, offset: 0, at: Date.now() } });
    reload();
    expect(threadUi("ch")?.scroll).toMatchObject({ atBottom: true, spacer: 180 });
    setThreadUi("ch", { scroll: { atBottom: false, spacer: 0, anchor: "msg_9", offset: -37, at: Date.now() } });
    reload();
    expect(threadUi("ch")?.scroll).toMatchObject({ atBottom: false, anchor: "msg_9", offset: -37 });
  });

  test("条数有上限：最旧的先丢", () => {
    for (let i = 0; i < 100; i++) setThreadUi(`ch_${i}`, { agent: "b" });
    reload();
    const raw = JSON.parse(window.localStorage.getItem(UI_MEMORY_KEY) ?? "{}");
    expect(Object.keys(raw.threads).length).toBeLessThanOrEqual(80);
  });
});

describe("干活卡", () => {
  test("点开 / 秒数按这一轮记", () => {
    setWorkUi("turn_1", { open: true });
    setWorkUi("turn_1", { seconds: 10 });
    reload();
    expect(workUi("turn_1")).toMatchObject({ open: true, seconds: 10 });
    expect(workUi("turn_2")).toBeUndefined();
  });
});

describe("附件只在内存里", () => {
  test("取一次就没了，也不进 localStorage", () => {
    const file = new File(["hi"], "a.txt", { type: "text/plain" });
    stashDraftFiles("ch", [file]);
    flushUiMemory();
    expect(window.localStorage.getItem(UI_MEMORY_KEY) ?? "").not.toContain("a.txt");
    const back = takeDraftFiles("ch");
    expect(back).toHaveLength(1);
    expect(back[0]?.name).toBe("a.txt");
    expect(takeDraftFiles("ch")).toHaveLength(0);
  });
});
