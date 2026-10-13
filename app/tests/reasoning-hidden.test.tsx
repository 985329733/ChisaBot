import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { REASONING_CLOSE_MS, ReasoningMessageZh } from "@/lib/copilot/reasoning-zh";
import { RICH_MESSAGE_VIEW } from "@/lib/copilot/rich-message-view";

if (typeof document === "undefined") GlobalRegistrator.register();

afterEach(() => cleanup());

/**
 * 回归：muse-spark 等模型的英文推理「混进聊天正文」（2026-10-13，DESIGN.md §44）。
 * 推理本来走的是独立的 reasoning 消息、折叠在「思考了 N 秒」下面，但 CopilotKit 的折叠只是
 * grid 0fr + overflow:hidden——英文一直在 DOM 里，Ctrl+F / 全选复制 / 读屏 / 读 innerText 的脚本都会把它
 * 当成回答。收起时内容必须不在页面里。
 */
const ENGLISH = "Composing two sentences that include the price range and cite the search sources as required.";
const reasoning = { id: "r1", role: "reasoning", content: ENGLISH } as const;
const answer = { id: "a1", role: "assistant", content: "今天比特币大约 83,400 美元。" } as const;
type Msg = { id: string; role: string; content: string };
function renderReasoning(props: { isRunning: boolean; messages: Msg[] }) {
  return render(<ReasoningMessageZh message={reasoning} {...props} />);
}

describe("推理内容收起时不在页面里", () => {
  test("机器人聊天的 messageView 用的是自己的思考消息（不是 CopilotKit 会自动展开的那个）", () => {
    const rich = RICH_MESSAGE_VIEW as unknown as { reasoningMessage?: unknown };
    expect(rich.reasoningMessage).toBe(ReasoningMessageZh);
  });

  test("流式 → 后面来了工具调用 / 正文 → 跑完：全程不自动展开（2026-10-13 生产上「思考了 5 秒」下摊开英文）", () => {
    const tool = { id: "t1", role: "assistant", content: "" };
    const view = renderReasoning({ isRunning: true, messages: [answer, reasoning] });
    for (const step of [
      { isRunning: true, messages: [answer, reasoning] },
      { isRunning: true, messages: [answer, reasoning, tool] },
      { isRunning: false, messages: [answer, reasoning] },
      { isRunning: true, messages: [answer, reasoning] },
      { isRunning: false, messages: [answer, reasoning, tool, answer] },
    ]) {
      view.rerender(<ReasoningMessageZh message={reasoning} {...step} />);
      expect(view.container.textContent).not.toContain("Composing");
    }
    expect(view.container.textContent).toContain("思考");
  });

  test("回答之后（历史 / 刚结束）：只有「思考了…」，英文不在 DOM 里", () => {
    const view = renderReasoning({ isRunning: false, messages: [reasoning, answer] });
    expect(view.container.textContent).toContain("思考");
    expect(view.container.textContent).not.toContain("Composing");
    const toggle = view.container.querySelector(".reasoning-toggle");
    expect(toggle?.getAttribute("aria-hidden")).toBe("true");
    expect(toggle?.hasAttribute("inert")).toBe(true);
  });

  test("正在思考（流式）时也不显示英文", () => {
    const view = renderReasoning({ isRunning: true, messages: [answer, reasoning] });
    expect(view.container.textContent).toContain("正在思考");
    expect(view.container.textContent).not.toContain("Composing");
  });

  test("点开才显示，再收起后（动画结束）又从 DOM 里拿掉", async () => {
    const view = renderReasoning({ isRunning: false, messages: [reasoning, answer] });
    const head = view.container.querySelector(".reasoning-head") as HTMLElement;
    act(() => fireEvent.click(head));
    expect(view.container.textContent).toContain(ENGLISH);
    expect(view.container.querySelector(".reasoning-toggle")?.getAttribute("aria-hidden")).toBeNull();
    act(() => fireEvent.click(head));
    await act(async () => {
      await new Promise((r) => setTimeout(r, REASONING_CLOSE_MS + 60));
    });
    expect(view.container.textContent).not.toContain("Composing");
  });
});
