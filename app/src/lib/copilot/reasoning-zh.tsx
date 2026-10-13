import { IconChevronRight } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SmoothMarkdownRenderer } from "@/components/chat/smooth-markdown";

/**
 * 机器人「思考」那一行的中文版（CopilotKit 自带的是写死的 "Thinking…" / "Thought for 2 seconds"）。
 *
 * 也改了一个行为：思考过程不再在流式时自动展开。免费模型常常用英文思考，一大段英文推理在用户眼前
 * 滚动正是 Hark 不会做的事；这里只显示「正在思考…」，结束后折叠成「思考了 3 秒」，想看再点开。
 */
function zhLabel(label: string | undefined, isStreaming: boolean): string {
  if (isStreaming) return "正在思考…";
  const m = /Thought for (.+)$/.exec(label ?? "");
  if (!m) return "思考过程";
  const d = m[1] ?? "";
  if (/few seconds/.test(d)) return "思考了几秒";
  const s = /^(\d+) seconds?$/.exec(d);
  if (s) return `思考了 ${s[1]} 秒`;
  const min = /^(\d+) minutes?$/.exec(d);
  if (min) return `思考了 ${min[1]} 分钟`;
  const ms = /^(\d+)m (\d+)s$/.exec(d);
  if (ms) return `思考了 ${ms[1]} 分 ${ms[2]} 秒`;
  return "思考过程";
}

export function ReasoningHeaderZh({
  isOpen,
  label,
  hasContent,
  isStreaming,
  onClick,
}: {
  isOpen?: boolean;
  label?: string;
  hasContent?: boolean;
  isStreaming?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const expandable = Boolean(hasContent) && !isStreaming;
  return (
    <button
      aria-expanded={expandable ? isOpen : undefined}
      className={`reasoning-head inline-flex select-none items-center gap-1 py-1 text-muted-foreground text-sm transition-colors ${expandable ? "cursor-pointer hover:text-foreground" : "cursor-default"}`}
      data-streaming={isStreaming || undefined}
      onClick={expandable ? onClick : undefined}
      type="button"
    >
      <span className={isStreaming ? "reasoning-shimmer" : undefined}>{zhLabel(label, Boolean(isStreaming))}</span>
      {expandable ? (
        <IconChevronRight className={`size-3.5 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
      ) : null}
    </button>
  );
}

/** 流式时不展开思考内容（见上）；结束后用户点开才显示。 */
export function ReasoningContentZh({ isStreaming, hasContent, children }: { isStreaming?: boolean; hasContent?: boolean; children?: ReactNode }) {
  if (isStreaming || !hasContent) return null;
  return <div className="pt-1 pb-2 text-muted-foreground text-sm whitespace-pre-wrap">{typeof children === "string" ? children : null}</div>;
}

/**
 * 折叠区：收起时思考内容根本不在页面里（DESIGN.md §44）。
 *
 * CopilotKit 自带的 Toggle 收起时只是把一个 grid 行压成 0fr + overflow:hidden，英文推理其实一直在
 * DOM 里：看不见，但 Ctrl+F 搜得到、全选复制会把它夹在回答中间、读屏会念出来、任何读文字的脚本
 * （包括我们自己的 e2e）都会把它当成回答——这就是「推理混进聊天正文」。这里收起后（等收起动画
 * 200ms 走完）把内容卸掉，并在收起期间 `inert` + `aria-hidden`；点开时再挂上。
 */
export const REASONING_CLOSE_MS = 220;
export function ReasoningToggleZh({ isOpen, children }: { isOpen?: boolean; children?: ReactNode }) {
  const open = Boolean(isOpen);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), REASONING_CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);
  return (
    <div
      aria-hidden={open ? undefined : true}
      className="reasoning-toggle grid transition-[grid-template-rows] duration-200 ease-in-out"
      data-open={open || undefined}
      inert={open ? undefined : true}
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
    >
      <div className="overflow-hidden">{mounted ? children : null}</div>
    </div>
  );
}

function durationLabel(seconds: number): string {
  if (seconds < 5) return "Thought for a few seconds";
  if (seconds < 60) return `Thought for ${Math.round(seconds)} seconds`;
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds % 60);
  return r ? `Thought for ${m}m ${r}s` : `Thought for ${m} minute${m === 1 ? "" : "s"}`;
}

type ReasoningMsg = { id: string; content?: string | null };

/**
 * 整条「思考」消息自己来渲染，不用 CopilotKit 的 CopilotChatReasoningMessage（DESIGN.md §44.1）。
 *
 * CopilotKit 的那个在流式时自动 `setIsOpen(true)`，结束后靠一个 effect 再关上；2026-10-13 生产实测
 * （muse-spark，建面板时一轮里多次「思考 → 工具」）关不上的情况真实存在：「思考了 5 秒」下面直接摊开
 * 一段英文推理，就在正文里。这里的规则只有一条：只有用户点了才展开，永远不会自己打开。
 */
export function ReasoningMessageZh({
  message,
  messages,
  isRunning,
  isLatest: isLatestProp,
}: {
  message: ReasoningMsg;
  messages?: ReasoningMsg[];
  isRunning?: boolean;
  isLatest?: boolean;
}) {
  const isLatest = isLatestProp ?? messages?.[messages.length - 1]?.id === message.id;
  const isStreaming = Boolean(isRunning && isLatest);
  const hasContent = Boolean(message.content && message.content.length > 0);
  const [open, setOpen] = useState(false);
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (isStreaming && startRef.current === null) startRef.current = Date.now();
    if (!isStreaming && startRef.current !== null) setElapsed((Date.now() - startRef.current) / 1000);
  }, [isStreaming]);
  const expanded = open && hasContent && !isStreaming;
  return (
    <div className="cpk:my-1" data-message-id={message.id}>
      <ReasoningHeaderZh
        hasContent={hasContent}
        isOpen={expanded}
        isStreaming={isStreaming}
        label={durationLabel(elapsed)}
        onClick={() => setOpen((value) => !value)}
      />
      <ReasoningToggleZh isOpen={expanded}>
        <ReasoningContentZh hasContent={hasContent} isStreaming={isStreaming}>
          {message.content ?? ""}
        </ReasoningContentZh>
      </ReasoningToggleZh>
    </div>
  );
}

export const ZH_MESSAGE_VIEW = {
  reasoningMessage: ReasoningMessageZh,
  // 流式回复按帧匀速放字，不再一批一批地蹦（components/chat/smooth-markdown.tsx，DESIGN.md §28）。
  assistantMessage: { markdownRenderer: SmoothMarkdownRenderer },
} as const;
