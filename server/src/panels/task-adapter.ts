import { PanelError, type PanelCapability } from "../../../shared/panels/types";
import type { FrozenPanelTask, PanelAdapter } from "./broker";
/** The production entry point supplies the existing governed run service here.
 * No model, connector, shell, credential or active UI Bot is resolved here. */
export function createGovernedPanelTaskAdapter(
  definition: PanelCapability,
  service: {
    start(request: FrozenPanelTask): Promise<{ runId: string }>;
    query(request: FrozenPanelTask): Promise<{
      status: "running" | "waiting" | "unknown" | "succeeded" | "failed";
      replyText?: string;
    }>;
    cancel(request: FrozenPanelTask): Promise<void>;
  },
): PanelAdapter {
  if (definition.effect !== "write")
    throw new PanelError("invalid_task_adapter", 500);
  return {
    definition,
    execute: (request) => service.start(request),
    query: (request) => service.query(request),
    cancel: (request) => service.cancel(request),
  };
}
