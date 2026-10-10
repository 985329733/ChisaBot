export type RecoveredPanelTaskStatus =
  | "running"
  | "waiting"
  | "unknown"
  | "succeeded"
  | "failed";

/** Read-only recovery: a transcript or lost callback never proves completion. */
export function recoverPanelTaskStatus(input: {
  savedStatus: string;
  ageMs: number;
  bound: boolean;
  waiting: boolean;
  transportStatus?: string;
  isRunning: boolean;
}): RecoveredPanelTaskStatus {
  if (input.savedStatus === "succeeded" || input.savedStatus === "failed")
    return input.savedStatus;
  if (input.savedStatus === "waiting" || input.waiting) return "waiting";
  if (input.bound && input.transportStatus === "finished") return "succeeded";
  if (input.bound && ["error", "stopped"].includes(input.transportStatus ?? ""))
    return "failed";
  if (input.isRunning || input.ageMs <= 30_000) return "running";
  return "unknown";
}
