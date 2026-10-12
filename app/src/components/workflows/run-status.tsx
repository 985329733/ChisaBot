import { IconCheck, IconClock, IconLoader2, IconPlayerStopFilled, IconShieldCheck, IconX } from "@tabler/icons-react";
import {
  RUN_STATUS_LABEL,
  STEP_STATUS_LABEL,
  type WorkflowRunStatus,
  type WorkflowStepStatus,
} from "../../../../shared/workflows";
import { cn } from "@/lib/utils";

const TONE: Record<WorkflowRunStatus | WorkflowStepStatus, string> = {
  queued: "",
  pending: "",
  running: "is-accent",
  waiting_approval: "is-warn",
  succeeded: "is-ok",
  failed: "is-danger",
  cancelled: "is-muted",
  skipped: "is-muted",
};

function Glyph({ status }: { status: WorkflowRunStatus | WorkflowStepStatus }) {
  if (status === "running") return <IconLoader2 className="size-3 animate-spin motion-reduce:animate-none" />;
  if (status === "succeeded") return <IconCheck className="size-3" />;
  if (status === "failed") return <IconX className="size-3" />;
  if (status === "waiting_approval") return <IconShieldCheck className="size-3" />;
  if (status === "cancelled") return <IconPlayerStopFilled className="size-3" />;
  return <IconClock className="size-3" />;
}

export function RunStatusBadge({ status, className }: { status: WorkflowRunStatus; className?: string }) {
  return (
    <span className={cn("wf-badge", TONE[status], className)}>
      <Glyph status={status} />
      {RUN_STATUS_LABEL[status]}
    </span>
  );
}

export function StepStatusBadge({ status }: { status: WorkflowStepStatus }) {
  return (
    <span className={cn("wf-badge is-sm", TONE[status])}>
      <Glyph status={status} />
      {STEP_STATUS_LABEL[status]}
    </span>
  );
}
