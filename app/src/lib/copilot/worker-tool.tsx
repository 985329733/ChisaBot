import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import { WorkerCard } from "@/components/chat/worker-card";
import { pendingWorkerTitle } from "@/lib/chat/worker-title";

/**
 * `delegate_task`（服务器工具，server/src/workers/service.ts）在聊天里画成后台任务卡片（DESIGN.md §38.2）。
 * 参数流式到达时先用标题（没有标题时用任务说明的头一句）画一张「正在交给后台…」，工具返回 workerId 后换成活的卡片。
 */
const parameters = z.object({
  title: z.string().optional(),
  task: z.string().optional(),
  plan: z.array(z.string()).optional(),
});

function workerIdOf(result: unknown): string | undefined {
  if (typeof result !== "string") return undefined;
  // 服务器工具的结果有时被再包一层 JSON 字符串（"\"{…}\""），最多拆两层。
  let value: unknown = result;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  const id = value && typeof value === "object" ? (value as { workerId?: unknown }).workerId : undefined;
  if (typeof id === "string") return id;
  const match = /"workerId"\s*:\s*\\?"([0-9a-f-]{36})/.exec(result);
  return match?.[1];
}

export function WorkerTool() {
  useRenderTool({
    name: "delegate_task",
    parameters,
    render: ({ parameters: given, result }) => <WorkerCard pendingTitle={pendingWorkerTitle(given)} workerId={workerIdOf(result)} />,
  });
  return null;
}
