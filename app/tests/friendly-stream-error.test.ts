import { describe, expect, test } from "bun:test";
import { friendlyError } from "../src/lib/chat/friendly-error";
import { friendlyStopReason } from "../src/lib/copilot/stopped-turn";

describe("模型回答到一半断开（成熟度扫查 F7）", () => {
  test("频道聊天的出错卡片说中文", () => {
    const f = friendlyError("AI SDK stream error");
    expect(f.title).toBe("模型的连接中途断开了");
    expect(f.retryable).toBe(true);
    expect(friendlyError('ClinePass: connection lost mid-reply (http2: server sent GOAWAY and closed the connection; debug="server_shutting_down")').title).toBe("模型的连接中途断开了");
  });
  test("机器人聊天的停止提示说中文", () => {
    expect(friendlyStopReason("AI SDK stream error")).toContain("连接中途断开");
  });
  test("原来的规则不受影响", () => {
    expect(friendlyError("Error 429: Too Many Requests").title).toContain("限流");
    expect(friendlyError("fetch failed").title).toBe("网络连接中断");
  });
});
