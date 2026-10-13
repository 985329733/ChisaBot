import {
  type ReactFrontendTool,
  useCopilotKit,
  useFrontendTool as useSDKFrontendTool,
} from "@copilotkit/react-core/v2";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InlineApproval } from "@/components/approvals/inline-approval";
import { tryClient } from "@/lib/client";
import { useActiveBotHolder } from "./active-bot";
import { frontendApprovalSnapshot } from "./approval-context";

type RenderProps = { toolCallId: string; [key: string]: unknown };

const writes = new Set([
  "computer_click",
  "computer_type",
  "computer_key",
  "computer_run_command",
  "computer_write_file",
]);

/**
 * Route computer changes through the server's durable approval gate, and draw a pending decision
 * inline where the action would have been.
 *
 * EVERY CHANGE GOES THROUGH THE GATE, not only when "Ask before making changes" is on. The server
 * decides, and it can ask for reasons the browser cannot see: a team rule, a safety requirement, the
 * auto-review model. It used to read the person's switch here, and the SDK registers a tool's
 * handler once and never again (its registration effect does not depend on the handler), so the
 * handler kept the switch as it was on first render, usually still loading. Every change then went
 * straight to the computer outside any run, and the gate could only answer "this action needs an
 * authenticated run". Nothing in this handler may depend on render-time state for that reason.
 */
export function useFrontendTool<T extends Record<string, unknown>>(
  tool: ReactFrontendTool<T>,
) {
  const { copilotkit } = useCopilotKit();
  // Stable for the provider's life, so the SDK's once-registered handler may keep it.
  const queryClient = useQueryClient();
  const bot = useActiveBotHolder();
  const render = tool.render;
  useSDKFrontendTool({
    ...tool,
    ...(writes.has(tool.name)
      ? {
          // A component, so the approval card can use hooks; the SDK keeps this function forever.
          render: (props: RenderProps) => {
            const Original = render as
              | ((props: RenderProps) => ReactNode)
              | undefined;
            return (
              <InlineApproval
                toolCallId={props.toolCallId}
                fallback={Original ? <Original {...props} /> : null}
              />
            );
          },
        }
      : {}),
    handler: tool.handler
      ? async (args, context) => {
          if (!writes.has(tool.name)) return tool.handler?.(args, context);
          let snapshot: ReturnType<typeof frontendApprovalSnapshot>;
          try {
            snapshot = frontendApprovalSnapshot(context);
          } catch {
            // A surface with no observed conversation. The server still gates the action; it can
            // run it when nothing asks, and says why when something does.
            return tool.handler?.(args, context);
          }
          const response = await tryClient(
            `/api/approvals/computer/${encodeURIComponent(bot.current)}`,
            { method: "POST", body: snapshot, signal: context.signal },
          );
          const payload: unknown = await response.json();
          if (response.status === 202) {
            const kind =
              payload && typeof payload === "object" && "kind" in payload && typeof payload.kind === "string"
                ? payload.kind
                : "approval";
            // 只有审批会在决定之后接上这一轮。别的等待（例如等人交还计算机）没有东西会接上：
            // 以前这里一样 stopAgent，用户只看到机器人说了一句就再没下文（2026-10-13）。
            // 现在把原因作为工具结果交回去，让机器人把话说完。
            if (!kind.startsWith("approval")) {
              const reason =
                payload && typeof payload === "object" && "reason" in payload && typeof payload.reason === "string"
                  ? payload.reason
                  : "";
              return {
                ok: false,
                reason: `没有执行，需要用户先处理右栏「计算机」里的请求（${reason || kind}）。如实告诉用户，不要说已经完成。`,
              };
            }
            if (!context.agent) throw new Error("中断的对话不可用。");
            // Stop signals the SDK to discard this handler's unfinished result. The server owns
            // resume: the decision executes the action once and continues this conversation.
            copilotkit.stopAgent({ agent: context.agent });
            // Draw the card now rather than on the inbox's next poll.
            void queryClient.invalidateQueries({ queryKey: ["approvals"] });
            return { waiting: true };
          }
          if (!response.ok)
            throw new Error(
              payload &&
                typeof payload === "object" &&
                "error" in payload &&
                typeof payload.error === "string"
                ? payload.error
                : "无法批准计算机操作。",
            );
          if (!payload || typeof payload !== "object" || !("result" in payload))
            throw new Error("计算机操作未返回结果。");
          return payload.result;
        }
      : undefined,
  });
}
