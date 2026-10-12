import { CopilotChatInput, type CopilotChatInputProps, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { IconArrowUp, IconPlayerStopFilled, IconPlus } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ButtonHTMLAttributes,
  createContext,
  forwardRef,
  type TextareaHTMLAttributes,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BotModelSelector } from "@/components/agents/bot-model-selector";
import { ContextMeter } from "@/components/agents/context-meter";
import { useModelSelectionSaving } from "@/lib/model-selection/hooks";
import { modelSelectionKeys } from "@/lib/model-selection/queries";
import { cn } from "@/lib/utils";

/** 页面给输入框的东西：机器人名字（占位文字）和「新话题」（上下文快满时的出口）。 */
export const BotComposerContext = createContext<{ name?: string; onNewTopic?: () => void }>({});

const InputModelContext = createContext({ agentId: "", running: false });

/** 最多长到 8 行再滚动（14.5px × 1.6 行高）。 */
const MAX_LINES = 8;

/**
 * 发送 ↔ 停止是同一个墨色圆键：SDK 的 SendButton 已经按「正在回复」绑好了 onClick（停止）和 disabled，
 * 这里只换外观、补上模型保存期间不许发送。
 */
function ComposerSendButton({ children: _children, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { agentId, running } = useContext(InputModelContext);
  const queryClient = useQueryClient();
  const saving = useModelSelectionSaving(agentId);
  return (
    <button
      {...props}
      aria-label={running ? "停止机器人" : "发送消息"}
      className={cn("glass-composer-send bot-composer-send", running && "is-stop")}
      data-testid={running ? "composer-stop" : "copilot-send-button"}
      disabled={props.disabled || (saving && !running)}
      onClick={(event) => {
        if (!running && queryClient.isMutating({ mutationKey: modelSelectionKeys.save(agentId) }) > 0) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        props.onClick?.(event);
      }}
      title={running ? "停止（Enter）" : "发送（Enter）"}
      type="button"
    >
      <span className="bot-composer-send-icon" data-shown={running ? "stop" : "send"}>
        <IconArrowUp className="is-send size-[18px]" stroke={2.25} />
        <IconPlayerStopFilled className="is-stop size-3" />
      </span>
    </button>
  );
}

/**
 * 自动长高的输入区：用一个看不见的镜像量高度，真正的 textarea 只设一次目标高度，
 * 所以高度变化可以平滑过渡（先设 auto 再量会让过渡从 0 开始）。
 */
const AutoGrowTextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoGrowTextArea({ className: _className, style, value, placeholder, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement>(null);
    const mirror = useRef<HTMLTextAreaElement>(null);
    const [height, setHeight] = useState<number | undefined>(undefined);
    const [scroll, setScroll] = useState(false);
    const { name } = useContext(BotComposerContext);
    useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);
    useLayoutEffect(() => {
      const shadow = mirror.current;
      const real = inner.current;
      if (!shadow || !real) return;
      const measure = () => {
        shadow.style.width = `${real.clientWidth}px`;
        shadow.value = typeof value === "string" && value ? value : " ";
        const lineHeight = Number.parseFloat(getComputedStyle(shadow).lineHeight) || 23;
        const max = lineHeight * MAX_LINES;
        const next = Math.min(shadow.scrollHeight, max);
        setHeight(next);
        setScroll(shadow.scrollHeight > max + 1);
      };
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(real);
      return () => observer.disconnect();
    }, [value]);
    return (
      <div className="bot-composer-field">
        <textarea
          {...props}
          className="bot-composer-textarea"
          data-testid="copilot-chat-textarea"
          enterKeyHint="send"
          placeholder={placeholder ?? (name ? `给「${name}」发消息…` : "输入消息…")}
          ref={inner}
          rows={1}
          style={{ ...style, height, overflowY: scroll ? "auto" : "hidden" }}
          value={value}
        />
        <textarea aria-hidden className="bot-composer-textarea bot-composer-mirror" readOnly ref={mirror} rows={1} tabIndex={-1} />
      </div>
    );
  },
);

/**
 * 机器人聊天的输入框（DESIGN.md §25）：一张玻璃卡，上面是输入区，下面一行工具栏——
 * 左：＋ 附件、模型选择；右：Shift+Enter 提示、上下文、发送 / 停止。
 *
 * 仍然是 SDK 的 CopilotChatInput：用它的 children 渲染函数只换布局，回车发送、停止、草稿、
 * 转写这些行为都还是 SDK 绑好的那一套。
 */
function BotModelInputComponent(props: CopilotChatInputProps) {
  const chat = useCopilotChatConfiguration();
  const agentId = chat?.agentId ?? "";
  const threadId = chat?.threadId;
  const { onNewTopic } = useContext(BotComposerContext);
  const queryClient = useQueryClient();
  const running = props.isRunning ?? false;
  const [focused, setFocused] = useState(false);
  const typed = typeof props.value === "string" && props.value.length > 0;
  return (
    <InputModelContext.Provider value={{ agentId, running }}>
      <CopilotChatInput
        {...props}
        addMenuButton="glass-composer-icon bot-composer-add"
        showDisclaimer={false}
        sendButton={ComposerSendButton}
        textArea={AutoGrowTextArea}
      >
        {({ textArea, sendButton, addMenuButton, audioRecorder, cancelTranscribeButton, finishTranscribeButton, mode, onAddFile, toolsMenu, containerRef }) => (
          <div className="bot-composer-wrap" data-copilotkit ref={containerRef}>
            {/* 点卡片空白处把焦点交给输入区（按钮、菜单除外）。 */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: 只是把焦点交给里面的 textarea，键盘用户本来就在 textarea 里。 */}
            <div
              className={cn("glass-composer bot-composer", running && "is-running", focused && "is-focused")}
              data-testid="copilot-chat-input"
              onBlur={() => setFocused(false)}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest("button, a, [role=menu], [role=listbox], [data-popup-open]")) return;
                (event.currentTarget.querySelector("textarea:not([aria-hidden])") as HTMLTextAreaElement | null)?.focus();
              }}
              onFocus={() => setFocused(true)}
              onKeyDownCapture={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && queryClient.isMutating({ mutationKey: modelSelectionKeys.save(agentId) }) > 0) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              {mode === "transcribe" ? <div className="bot-composer-field">{audioRecorder}</div> : textArea}
              <div className="glass-composer-toolbar bot-composer-toolbar">
                <div className="bot-composer-left">
                  {onAddFile || (toolsMenu && toolsMenu.length > 0) ? (
                    addMenuButton
                  ) : (
                    <span className="bot-composer-add-off" title="这个机器人暂不支持附件">
                      <IconPlus className="size-[18px]" />
                    </span>
                  )}
                  {agentId ? <BotModelSelector agentId={agentId} compact /> : null}
                </div>
                <div className="bot-composer-right">
                  <span className={cn("bot-composer-hint", (focused || typed) && !running && "is-shown")}>Shift + Enter 换行</span>
                  {agentId ? <ContextMeter agentId={agentId} onNewTopic={onNewTopic} running={running} threadId={threadId} /> : null}
                  {mode === "transcribe" ? (
                    <>
                      {cancelTranscribeButton}
                      {finishTranscribeButton}
                    </>
                  ) : (
                    sendButton
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </CopilotChatInput>
    </InputModelContext.Provider>
  );
}

// The SDK slot type includes these static members on its component function.
export const BotModelInput = Object.assign(BotModelInputComponent, CopilotChatInput);
