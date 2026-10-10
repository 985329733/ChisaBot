import { CopilotChatInput, type CopilotChatInputProps, useCopilotChatConfiguration } from "@copilotkit/react-core/v2";
import { useQueryClient } from "@tanstack/react-query";
import { IconArrowUp } from "@tabler/icons-react";
import { type ButtonHTMLAttributes, createContext, useContext } from "react";
import { BotModelSelector } from "@/components/agents/bot-model-selector";
import { useModelSelectionSaving } from "@/lib/model-selection/hooks";
import { modelSelectionKeys } from "@/lib/model-selection/queries";

const InputModelContext = createContext({ agentId: "", running: false });

function ModelSendButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const { agentId, running } = useContext(InputModelContext);
  const queryClient = useQueryClient();
  const saving = useModelSelectionSaving(agentId);
  return <CopilotChatInput.SendButton
    {...props}
    aria-label={running ? "停止机器人" : "发送消息"}
    disabled={props.disabled || (saving && !running)}
    onClick={(event) => {
      if (!running && queryClient.isMutating({ mutationKey: modelSelectionKeys.save(agentId) }) > 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      props.onClick?.(event);
    }}
  >{props.children ?? <IconArrowUp className="size-4" />}</CopilotChatInput.SendButton>;
}

/** A stable SDK input slot preserves its draft while its BOT's shared model selection changes. */
function BotModelInputComponent(props: CopilotChatInputProps) {
  const agentId = useCopilotChatConfiguration()?.agentId ?? "";
  const queryClient = useQueryClient();
  return <InputModelContext.Provider value={{ agentId, running: props.isRunning ?? false }}>
    <div className="min-w-0">
      <CopilotChatInput
        {...props}
        sendButton={ModelSendButton}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && queryClient.isMutating({ mutationKey: modelSelectionKeys.save(agentId) }) > 0) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          props.onKeyDownCapture?.(event);
        }}
      />
      {agentId ? <div className="px-3 pb-2"><BotModelSelector agentId={agentId} compact /></div> : null}
    </div>
  </InputModelContext.Provider>;
}

// The SDK slot type includes these static members on its component function.
export const BotModelInput = Object.assign(BotModelInputComponent, CopilotChatInput);
