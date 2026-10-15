import { describe, expect, test } from "bun:test";
import { compactTurns, isPersonSentMessage, serverRowKind } from "../src/components/channels/chat-transcript";
import { SCHEDULE_MARKER } from "../../shared/schedules";
import { LOCAL_AGENT_RESULT_MARKER } from "../../shared/local-agents";
import { CONFIRM_RESUME_MARKER } from "../../shared/confirmations";
import { WORKER_RESULT_MARKER } from "../src/lib/copilot/workers";
import { pendingWorkerTitle } from "../src/lib/chat/worker-title";

/** CB-046（DESIGN.md §68）：`/bot` 的几样东西搬进频道聊天后的纯函数。 */
type Item = Parameters<typeof compactTurns>[0][number];
const user = (id: string, text: string): Item => ({ kind: "text", id, role: "user", text }) as Item;
const bot = (id: string, text: string): Item => ({ kind: "text", id, role: "assistant", text }) as Item;
const tool = (id: string): Item =>
  ({ kind: "tool", id, toolCall: { id, type: "function", function: { name: "x", arguments: "{}" } }, result: "ok" }) as Item;

describe("server rows", () => {
  test("markers are server rows, not a person's message", () => {
    expect(serverRowKind(`${SCHEDULE_MARKER}abc⟧ 到点了`)).toBe("schedule");
    expect(serverRowKind(`${WORKER_RESULT_MARKER}w1⟧ 结果`)).toBe("worker");
    expect(serverRowKind(`${LOCAL_AGENT_RESULT_MARKER}l1⟧ 结果`)).toBe("local-agent");
    expect(serverRowKind(`${CONFIRM_RESUME_MARKER}c1⟧ 用户确认了「发邮件」`)).toBe("confirm");
    expect(serverRowKind("你好")).toBeNull();
    expect(isPersonSentMessage("user", `${WORKER_RESULT_MARKER}w1⟧ 结果`)).toBe(false);
    expect(isPersonSentMessage("user", "你好")).toBe(true);
  });

  test("a server row starts its own turn, so the previous answer stays the result", () => {
    const items = [user("u1", "查一下"), bot("a1", "好的"), tool("t1"), bot("a2", "结果是 42"), user("w", `${WORKER_RESULT_MARKER}w1⟧ 做完了`), bot("a3", "后台任务也完成了")];
    const compact = compactTurns(items, false, new Set());
    expect(compact.tone.get("a2")).toBe("final");
    expect(compact.hidden.has("a2")).toBe(false);
    expect(compact.tone.get("a3")).toBe("final");
    expect(compact.hidden.has("a1")).toBe(false);
  });
});

describe("turn marks", () => {
  test("fallback note after the turn's last visible row; every stopped turn is marked", () => {
    const items = [user("u1", "一"), bot("a1", "答一"), user("u2", "二"), bot("a2", "过程"), user("u3", "三"), bot("a3", "答三")];
    const compact = compactTurns(items, false, new Set(["u2"]), new Map([["u1", "主模型额度用完，已改用 B"]]));
    expect(compact.fallbackAfter.get("a1")).toBe("主模型额度用完，已改用 B");
    expect(compact.stoppedAfter.has("a2")).toBe(true);
    expect(compact.stoppedAfter.has("a3")).toBe(false);
  });

  test("no fallback note on the turn still running", () => {
    const items = [user("u1", "一"), bot("a1", "写到一半")];
    const compact = compactTurns(items, true, new Set(), new Map([["u1", "x"]]));
    expect(compact.fallbackAfter.size).toBe(0);
  });
});

/** CB-021（DESIGN.md §54）：同一轮、同一个页面只留一张页面卡。 */
describe("page cards", () => {
  const pageTool = (id: string, name: string, args: object, result?: string): Item =>
    ({ kind: "tool", id, toolCall: { id, type: "function", function: { name, arguments: JSON.stringify(args) } }, result }) as Item;
  const made = (pg: string, v: number) => `已更新页面（第 ${v} 版）⟦page:${pg}⟧`;

  test("create + two updates of one page → only the last card", () => {
    const items = [
      user("u1", "做个页面再改两次"),
      pageTool("p1", "page_create", { title: "测试页", html: "<h1>x</h1>" }, made("pg_aaa111", 1)),
      pageTool("p2", "page_update", { page: "pg_aaa111", edits: [] }, made("pg_aaa111", 2)),
      pageTool("p3", "page_update", { page: "pg_aaa111", edits: [] }, made("pg_aaa111", 3)),
      bot("a1", "改好了"),
    ];
    const compact = compactTurns(items, false, new Set());
    expect(compact.hidden.has("p1")).toBe(true);
    expect(compact.hidden.has("p2")).toBe(true);
    expect(compact.hidden.has("p3")).toBe(false);
  });

  test("while the next update still streams, the previous card stays (never zero, never two)", () => {
    const items = [
      user("u1", "改一下"),
      pageTool("p1", "page_create", { title: "测试页" }, made("pg_aaa111", 1)),
      pageTool("p2", "page_update", { page: "pg_aaa111" }),
    ];
    const compact = compactTurns(items, true, new Set());
    expect(compact.hidden.has("p1")).toBe(false);
    expect(compact.hidden.has("p2")).toBe(true);
  });

  test("an update whose page id hasn't streamed yet doesn't flash a second skeleton under the card", () => {
    const items = [
      user("u1", "改一下"),
      ({ kind: "tool", id: "p1", toolCall: { id: "p1", type: "function", function: { name: "page_create", arguments: "{}" } }, result: made("pg_aaa111", 1) }) as Item,
      ({ kind: "tool", id: "p2", toolCall: { id: "p2", type: "function", function: { name: "page_update", arguments: '{"page":"pg_aa' } } }) as Item,
    ];
    const compact = compactTurns(items, true, new Set());
    expect(compact.hidden.has("p1")).toBe(false);
    expect(compact.hidden.has("p2")).toBe(true);
    // 一轮里第一次就是改别的轮的页面：照常出骨架
    const fresh = compactTurns([user("u1", "改一下"), ({ kind: "tool", id: "p9", toolCall: { id: "p9", type: "function", function: { name: "page_update", arguments: '{"pa' } } }) as Item], true, new Set());
    expect(fresh.hidden.has("p9")).toBe(false);
  });

  test("two different pages keep a card each; another turn's card for the same page stays", () => {
    const items = [
      user("u1", "做两个页面"),
      pageTool("p1", "page_create", { title: "一" }, made("pg_aaa111", 1)),
      pageTool("p2", "page_create", { title: "二" }, made("pg_bbb222", 1)),
      bot("a1", "做好了"),
      user("u2", "再改第一个"),
      pageTool("p3", "page_update", { page: "pg_aaa111" }, made("pg_aaa111", 2)),
      bot("a2", "改好了"),
    ];
    const compact = compactTurns(items, false, new Set());
    for (const id of ["p1", "p2", "p3"]) expect(compact.hidden.has(id)).toBe(false);
  });
});

/** CB-023（DESIGN.md §38.3）：delegate_task 参数还在流时卡片的标题。 */
describe("pending worker title", () => {
  test("title wins; else the task's first sentence (≤18 chars); else nothing", () => {
    expect(pendingWorkerTitle({ title: " 对比三款耳机 ", task: "随便" })).toBe("对比三款耳机");
    expect(pendingWorkerTitle({ task: "对比三款耳机的价格。然后列表" })).toBe("对比三款耳机的价格");
    expect(pendingWorkerTitle({ task: "对比索尼、Bose、AirPods Max 三款降噪耳机的降噪续航和价格" })).toBe("对比索尼、Bose、AirPods…");
    expect(pendingWorkerTitle({ title: "", task: "" })).toBeUndefined();
    expect(pendingWorkerTitle(undefined)).toBeUndefined();
  });
});
