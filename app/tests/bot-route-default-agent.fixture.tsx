import { mock } from "bun:test";
import { useState } from "react";

mock.module("@copilotkit/react-core/v2", () => ({
  CopilotChat: ({
    agentId,
    threadId,
  }: {
    agentId: string;
    threadId?: string;
  }) => (
    <div
      data-agent-id={agentId}
      data-thread-id={threadId}
      data-testid="copilot-chat"
    >
      <textarea aria-label="Chat draft" />
    </div>
  ),
}));

// 富预览的消息视图依赖 CopilotChat 的消息组件，这里的 CopilotChat 是假的，用不到它。
mock.module("@/lib/copilot/rich-message-view", () => ({
  RICH_MESSAGE_VIEW: {},
}));

mock.module("@/lib/copilot/active-bot", () => ({
  useActiveBot: () => undefined,
}));

mock.module("@/lib/copilot/bot-thread", () => ({
  useBotThread: (agentId: string) => {
    const [revision, setRevision] = useState(0);
    return {
      history: "ready",
      onActivity: () => () => {},
      startNew: () => setRevision((value) => value + 1),
      threadId: `thread-${agentId}-${revision}`,
    };
  },
}));

mock.module("@/lib/copilot/stopped-turn", () => ({
  useStoppedTurn: () => null,
}));
