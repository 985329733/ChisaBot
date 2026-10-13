import { IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
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

export const ZH_MESSAGE_VIEW = {
  reasoningMessage: { header: ReasoningHeaderZh, contentView: ReasoningContentZh },
  // 流式回复按帧匀速放字，不再一批一批地蹦（components/chat/smooth-markdown.tsx，DESIGN.md §28）。
  assistantMessage: { markdownRenderer: SmoothMarkdownRenderer },
} as const;
