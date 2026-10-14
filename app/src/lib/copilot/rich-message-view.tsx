import {
  CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
  CopilotChatToolCallsView,
  type CopilotChatToolCallsViewProps,
  CopilotChatUserMessage,
  type CopilotChatUserMessageProps,
} from "@copilotkit/react-core/v2";
import { type ComponentType, createElement, useMemo, useState } from "react";
import { MessageEditor, RegenerateAction } from "@/components/chat/message-actions";
import { isEditableUserText, useMessageActions } from "./regenerate";
import {
  HiddenMarkdownImage,
  type MessageMedia,
  MessageRichPreviews,
  useDisplayText,
} from "@/components/rich-previews/rich-previews";
import { WorkerResultRow } from "@/components/chat/worker-card";
import { ScheduleFiredRow } from "@/components/chat/schedule-row";
import { SCHEDULE_MARKER } from "../../../../shared/schedules";
import { ConfirmResumeRow, isConfirmResume, MessageConfirmCards } from "@/components/chat/confirm-card";
import { useReadMark } from "./thread-inbox";
import { WORKER_RESULT_MARKER } from "./workers";
import { LocalAgentResultRow } from "@/components/chat/local-agent-card";
import { LOCAL_AGENT_RESULT_MARKER } from "../../../../shared/local-agents";
import { renderUnvirtualizedMessageList } from "./message-list";
import { ZH_MESSAGE_VIEW } from "./reasoning-zh";

/**
 * 机器人聊天（CopilotChat）里的富预览（2026-10-13；DESIGN.md §31）。
 *
 * - 机器人消息：借 `toolCallsView` 这个插槽把预览画在消息根节点里面、正文下面（不是另起一个兄弟节点），
 *   所以 turn-compaction 的「一句话 → 结果」规则照常：过程话被收起时预览跟着收起（styles.css）。
 *   正文里的 Markdown 图片不内联画（`markdownRenderer.components.img`），统一进下面的图片卡 / 一摞。
 * - 用户消息：用 children 渲染函数自己排版——附件（图片一摞 / 文件卡）在气泡上方，链接卡在气泡下方，
 *   类名与自带的一致（`copilotKitUserMessage`），样式和 turn-compaction 都认得。
 */

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("\n");
}

type Part = {
  type?: unknown;
  source?: { type?: unknown; value?: unknown; mimeType?: unknown };
  metadata?: { filename?: unknown };
};

/** 用户消息里的图片 / 文件附件（AG-UI image / document 部分，url 或 data 来源）。 */
export function mediaOf(content: unknown): MessageMedia {
  if (!Array.isArray(content)) return {};
  const images: NonNullable<MessageMedia["images"]>[number][] = [];
  const files: NonNullable<MessageMedia["files"]>[number][] = [];
  for (const raw of content as Part[]) {
    if (!raw || typeof raw !== "object") continue;
    const source = raw.source;
    const value = typeof source?.value === "string" ? source.value : "";
    const mime =
      typeof source?.mimeType === "string" ? source.mimeType : undefined;
    const src =
      source?.type === "data" && value && mime
        ? `data:${mime};base64,${value}`
        : source?.type === "url"
          ? value
          : "";
    // 只画本站或 data: 的附件；第三方地址不让浏览器直接去拉。
    if (!src || !(src.startsWith("/") || src.startsWith("data:"))) continue;
    const name =
      typeof raw.metadata?.filename === "string"
        ? raw.metadata.filename
        : undefined;
    if (raw.type === "image") images.push({ src, ...(name ? { name } : {}) });
    else if (raw.type === "document")
      files.push({
        url: src,
        ...(name ? { name } : {}),
        ...(mime ? { mimeType: mime } : {}),
      });
  }
  return {
    ...(images.length ? { images } : {}),
    ...(files.length ? { files } : {}),
  };
}

function RichToolCallsView(props: CopilotChatToolCallsViewProps) {
  const content = (props.message as { content?: unknown }).content;
  return (
    <>
      <CopilotChatToolCallsView {...props} />
      {/* 确认卡片（DESIGN.md §58）：画在这条消息的工具调用下面。 */}
      <MessageConfirmCards message={props.message} messages={props.messages} />
      <MessageRichPreviews align="start" text={textOf(content)} />
    </>
  );
}

function RichUserMessage(props: CopilotChatUserMessageProps) {
  const content = (props.message as { content?: unknown }).content;
  const media = useMemo(() => mediaOf(content), [content]);
  const text = textOf(content);
  const justRead = useReadMark(props.message.id);
  const actions = useMessageActions();
  const [editing, setEditing] = useState(false);
  // 后台任务交回来的结果（DESIGN.md §38.2）：一行结果卡，不是用户气泡。
  // 定时任务到点放进来的消息（DESIGN.md §55）：一行「定时任务」，不是用户气泡。
  if (text.startsWith(SCHEDULE_MARKER)) {
    return (
      <div className="copilotKitMessage worker-result-msg cpk:pt-6" data-copilotkit="" data-testid="schedule-fired-message">
        <ScheduleFiredRow messageId={props.message.id} text={text} />
      </div>
    );
  }
  // 本地 agent 任务交回来的结果（docs/local-agents.md）：同样是一行结果卡。
  if (text.startsWith(LOCAL_AGENT_RESULT_MARKER)) {
    return (
      <div className="copilotKitMessage worker-result-msg cpk:pt-6" data-copilotkit="" data-testid="local-agent-result-message">
        <LocalAgentResultRow messageId={props.message.id} text={text} />
      </div>
    );
  }
  if (text.startsWith(WORKER_RESULT_MARKER)) {
    return (
      <div className="copilotKitMessage worker-result-msg cpk:pt-6" data-copilotkit="" data-testid="worker-result-message">
        <WorkerResultRow messageId={props.message.id} text={text} />
      </div>
    );
  }
  // 后来才确认、服务器叫机器人接着做的那条：一行小字。
  if (isConfirmResume(text)) {
    return (
      <div className="copilotKitMessage confirm-resume-msg cpk:pt-4" data-copilotkit="" data-message-id={props.message.id}>
        <ConfirmResumeRow text={text} />
      </div>
    );
  }
  if (editing) {
    return (
      <div className="copilotKitMessage copilotKitUserMessage cpk:flex cpk:flex-col cpk:items-end cpk:pt-10" data-copilotkit="" data-message-id={props.message.id}>
        <MessageEditor initial={text} messageId={props.message.id} onClose={() => setEditing(false)} />
      </div>
    );
  }
  return (
    <CopilotChatUserMessage
      {...props}
      // 「编辑」（DESIGN.md §67）：没在回答时才有；点了气泡原地变编辑框。
      {...(actions?.canAct && text.trim() && isEditableUserText(text) ? { onEditMessage: () => setEditing(true) } : {})}
    >
      {({ messageRenderer, toolbar, message }) => (
        <div
          className="copilotKitMessage copilotKitUserMessage cpk:flex cpk:flex-col cpk:items-end cpk:group cpk:pt-10"
          data-copilotkit=""
          data-message-id={message.id}
          data-testid="copilot-user-message"
        >
          {media.images?.length || media.files?.length ? (
            <MessageRichPreviews align="end" media={media} text="" />
          ) : null}
          {text.trim() ? messageRenderer : null}
          <MessageRichPreviews align="end" text={text} />
          {/* 回答期间发的这条刚被机器人读到（DESIGN.md §38.1），几秒后淡出。 */}
          {justRead ? <span className="queued-read-mark" data-testid="queued-read">{"已读取"}</span> : null}
          {toolbar}
        </div>
      )}
    </CopilotChatUserMessage>
  );
}

/**
 * 正文里的 Markdown 图片不内联画：给 markdown 渲染器加 `components={{ img: HiddenMarkdownImage }}`。
 * 和 `ZH_MESSAGE_VIEW` 叠加而不是覆盖——那边如果把 `assistantMessage.markdownRenderer` 换成了自己的组件
 * （例如流式匀速放字的 SmoothMarkdownRenderer），就包一层把 `components` 传进去；否则用 CopilotKit
 * 自带渲染器的 props 写法。
 */
type MarkdownProps = { components?: Record<string, unknown> } & Record<
  string,
  unknown
>;
const BASE_ASSISTANT = (
  ZH_MESSAGE_VIEW as { assistantMessage?: Record<string, unknown> }
).assistantMessage;
const BASE_MARKDOWN = BASE_ASSISTANT?.markdownRenderer;

function withHiddenImages(components?: Record<string, unknown>) {
  return { ...components, img: HiddenMarkdownImage };
}

const RICH_MARKDOWN =
  typeof BASE_MARKDOWN === "function"
    ? function RichMarkdownRenderer(props: MarkdownProps) {
        // 单独一行的链接由下面的链接卡代替，正文里那一行拿掉（DESIGN.md §48）。
        const content = useDisplayText(
          typeof props.content === "string" ? props.content : "",
        );
        return createElement(BASE_MARKDOWN as ComponentType<MarkdownProps>, {
          ...props,
          ...(typeof props.content === "string" ? { content } : {}),
          components: withHiddenImages(props.components),
        });
      }
    : {
        ...((BASE_MARKDOWN as MarkdownProps | undefined) ?? {}),
        components: withHiddenImages(
          (BASE_MARKDOWN as MarkdownProps | undefined)?.components,
        ),
      };

/** 最后一条用户消息之后最后一条有文字的回答（「重新生成」挂在它下面）。 */
export function lastAnswerMessageId(messages: readonly { id: string; role: string; content?: unknown }[] | undefined): string | null {
  if (!messages) return null;
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    const message = messages[at]!;
    if (message.role === "user") return null;
    if (message.role === "assistant" && typeof message.content === "string" && message.content.trim()) return message.id;
  }
  return null;
}

/**
 * 机器人消息：自带组件 + 我们的插槽；最后一轮的回答工具栏里加「重新生成」（DESIGN.md §67）。
 * 工具栏本来就只在有文字、且这条不在流式时出现；没在回答（canAct）时才加。
 */
function RichAssistantMessage(props: CopilotChatAssistantMessageProps) {
  const actions = useMessageActions();
  const lastId = actions?.lastAnswerId !== undefined ? actions.lastAnswerId : lastAnswerMessageId(props.messages as never);
  const isLastAnswer = actions?.canAct === true && lastId === props.message.id;
  return (
    <CopilotChatAssistantMessage
      {...(BASE_ASSISTANT as object)}
      {...props}
      toolCallsView={RichToolCallsView as never}
      markdownRenderer={RICH_MARKDOWN as never}
      additionalToolbarItems={isLastAnswer ? <RegenerateAction /> : props.additionalToolbarItems}
    />
  );
}

export const RICH_MESSAGE_VIEW = {
  ...ZH_MESSAGE_VIEW,
  assistantMessage: RichAssistantMessage,
  userMessage: RichUserMessage,
  // 不虚拟化：长会话里流式回复时视口不再跳回更早的记录（message-list.tsx，DESIGN.md §35）。
  children: renderUnvirtualizedMessageList,
} as const;
