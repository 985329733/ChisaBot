import { IconAlarm, IconChevronDown } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { parseScheduleMessage } from "../../../../shared/schedules";
import { cn } from "@/lib/utils";

/**
 * 定时任务到点时放进对话的那条消息（DESIGN.md §55）：不是用户气泡，是一行「⏰ 定时任务「x」到点了」，
 * 点开看到点时要做的事；机器人的回复照常在下面。
 */
export function ScheduleFiredRow({ messageId, text }: { messageId: string; text: string }) {
  const parsed = parseScheduleMessage(text);
  const [open, setOpen] = useState(false);
  if (!parsed) return null;
  return (
    <div className="worker-result schedule-fired" data-message-id={messageId} data-testid="schedule-fired">
      <button aria-expanded={open} className="worker-result-line" onClick={() => setOpen((value) => !value)} type="button">
        <span className="worker-icon schedule-fired-icon">
          <IconAlarm className="size-3.5" stroke={2.2} />
        </span>
        <span className="worker-result-head">{parsed.headline.replace(/。$/, "")}</span>
        <span className="worker-result-hint">{open ? "收起" : "详情"}</span>
        <IconChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      <div className="worker-plan-collapse" data-open={open || undefined}>
        <div className="worker-result-body">
          {parsed.instruction}
          <Link className="schedule-fired-link" to="/settings/schedules">
            {"管理定时任务"}
          </Link>
        </div>
      </div>
    </div>
  );
}
