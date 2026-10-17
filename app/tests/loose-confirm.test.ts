import { describe, expect, test } from "bun:test";
import { confirmResumeId, looseConfirmations } from "@/components/chat/confirm-card";
import type { ConfirmRequestView } from "../../shared/confirmations";

/** 没绑到工具调用的确认卡片画在聊天里（DESIGN.md §101.9）。 */
const req = (id: string, over: Partial<ConfirmRequestView> = {}) =>
  ({ id, toolCallId: null, status: "pending", createdAt: `2026-10-18T00:00:0${id.length}Z`, category: "message", title: id, ...over }) as ConfirmRequestView;

describe("looseConfirmations", () => {
  test("没有工具调用 id、还在等的卡片画出来；绑了工具调用的不在这里画", () => {
    const out = looseConfirmations([req("a"), req("b", { toolCallId: "call_1" })], new Set(), new Set());
    expect(out.map((r) => r.id)).toEqual(["a"]);
  });
  test("打开前就决定了的不画；这一页上看着它在等、后来决定的留着（不跳）", () => {
    const list = [req("a", { status: "approved" }), req("bb", { status: "denied" })];
    expect(looseConfirmations(list, new Set(), new Set())).toEqual([]);
    expect(looseConfirmations(list, new Set(["a"]), new Set()).map((r) => r.id)).toEqual(["a"]);
  });
  test("「用户确认了」那条进来后卡片让位", () => {
    expect(looseConfirmations([req("a", { status: "approved" })], new Set(["a"]), new Set(["a"]))).toEqual([]);
  });
  test("按放卡片的先后排", () => {
    expect(looseConfirmations([req("ccc"), req("a")], new Set(), new Set()).map((r) => r.id)).toEqual(["a", "ccc"]);
  });
  test("从「用户确认了」消息里取卡片 id", () => {
    expect(confirmResumeId("⟦chisabot:confirm:cf_123⟧\n用户确认了「发送」")).toBe("cf_123");
    expect(confirmResumeId("你好")).toBeNull();
  });
});
