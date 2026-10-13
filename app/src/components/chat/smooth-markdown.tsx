import type { ComponentProps } from "react";
import { Streamdown } from "streamdown";
import { useSmoothText } from "@/lib/chat/use-smooth-text";

/**
 * Bot 的 Markdown 回复，流式时按帧匀速放字（use-smooth-text.ts），不再一批一批地蹦。
 *
 * Streamdown 本身就是给流式写的（未闭合的 ** / ``` 先补上），这里只是把喂给它的文字变匀。
 * 历史消息挂载时整段显示；只有挂载之后继续变长的内容才放字。
 */
export function SmoothStreamdown({ children, ...props }: Omit<ComponentProps<typeof Streamdown>, "children"> & { children: string }) {
  const shown = useSmoothText(children ?? "");
  return <Streamdown {...props}>{shown}</Streamdown>;
}

/**
 * 机器人聊天（CopilotChat）的 `assistantMessage.markdownRenderer` 槽位：与 CopilotKit 自带的
 * `CopilotChatAssistantMessage.MarkdownRenderer` 同样的 Streamdown，只多了平滑放字。
 * 复制按钮读的是消息原文（message.content），不受影响。
 */
export function SmoothMarkdownRenderer({ content, className, ...props }: { content: string; className?: string } & Record<string, unknown>) {
  return (
    <SmoothStreamdown className={className} {...(props as object)}>
      {content ?? ""}
    </SmoothStreamdown>
  );
}
