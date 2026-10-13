import { describe, expect, test } from "bun:test";
import { stoppedReason, stoppedTurnSubscriber } from "../src/lib/copilot/stopped-turn";

/**
 * What a person is told when a turn ends and no answer came.
 *
 * The cases are the three things that actually arrive: the sentence the deployment's stall watchdog
 * wrote into the run, an error thrown in the browser, and nothing at all.
 */

describe("the reason a turn ended", () => {
  test("passes on what ended the turn, in its own words", () => {
    expect(
      stoppedReason(
        "Risk Analyst stopped responding. Nothing arrived from it for 2 minutes, so this turn was ended. Ask again, or check that the Bot is running.",
      ),
    ).toContain("Risk Analyst stopped responding");
  });

  test("reads an Error the same way, because a failed run carries one", () => {
    expect(
      stoppedReason(new Error("The endpoint refused the connection")),
    ).toBe("The endpoint refused the connection");
  });

  test("says so plainly when nothing was reported, rather than inventing a cause", () => {
    // This is the one moment a person has no other way to find out what went wrong, so a guess here
    // would be worse than an admission.
    expect(stoppedReason(undefined)).toBe(
      "机器人没有给出原因就停止了。",
    );
    expect(stoppedReason("")).toBe("机器人没有给出原因就停止了。");
    expect(stoppedReason("   ")).toBe("机器人没有给出原因就停止了。");
    expect(stoppedReason(new Error(""))).toBe(
      "机器人没有给出原因就停止了。",
    );
    expect(stoppedReason({ message: "not a string or an Error" })).toBe(
      "机器人没有给出原因就停止了。",
    );
  });
});

/**
 * 打开会话时历史事件会重放给订阅者（DESIGN.md §35.4）。一轮出错之后又正常回答过的会话，打开时顶上
 * 不能还挂着那条旧错误——它出现 / 消失会让聊天跳一截，而且说的也不是「上一轮」了。
 */
describe("the stopped notice across a replayed history", () => {
  const replay = (events: Array<"start" | "error" | "finish">) => {
    let shown: string | null = null;
    const sub = stoppedTurnSubscriber((reason) => {
      shown = reason;
    });
    for (const e of events) {
      if (e === "start") sub.onRunStartedEvent();
      if (e === "error") sub.onRunErrorEvent({ event: { message: "上游出错了" } });
    }
    return shown as string | null;
  };

  test("an error followed by a later turn is not shown", () => {
    expect(replay(["start", "error", "start", "finish", "start", "finish"])).toBeNull();
  });

  test("an error in the last turn is still shown", () => {
    expect(replay(["start", "finish", "start", "error"])).toBe("上游出错了");
  });

  test("the next turn starting clears it", () => {
    expect(replay(["start", "error", "start"])).toBeNull();
  });
});
