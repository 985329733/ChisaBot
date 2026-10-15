import { describe, expect, test } from "bun:test";
import { compactTurns, isPersonSentMessage, serverRowKind } from "../src/components/channels/chat-transcript";
import { SCHEDULE_MARKER } from "../../shared/schedules";
import { LOCAL_AGENT_RESULT_MARKER } from "../../shared/local-agents";
import { CONFIRM_RESUME_MARKER } from "../../shared/confirmations";
import { WORKER_RESULT_MARKER } from "../src/lib/copilot/workers";

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
