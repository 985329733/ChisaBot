import { markComputerEngaged } from "@/lib/computers/auto-watch";
import { ActivityLog } from "./activity-log";
import { ComputerView } from "./computer-view";

/**
 * The current live computer, separate from screenshots kept in historical tool results.
 *
 * `variant="rail"`：放在右栏「计算机」标签里（DESIGN.md §23），没有自己的外边距，标题交给标签。
 * 在这里点过、按过键，就算用户接手了：机器人停手后不再自动切回「面板」。
 */
export function ComputerViewPanel({
  agentId,
  name,
  variant = "pane",
}: {
  agentId: string;
  name?: string;
  variant?: "pane" | "rail";
}) {
  const engaged = () => markComputerEngaged(agentId);
  return (
    <section
      aria-label={"计算机"}
      className={variant === "rail" ? "computer-rail flex flex-col gap-3 pb-1" : "p-4"}
      onKeyDownCapture={engaged}
      onPointerDownCapture={engaged}
    >
      <ComputerView active computerId={agentId} name={name} minWidth={0} minHeight={0} />
      <div className={variant === "rail" ? "computer-rail-activity" : "mt-8"}>
        <h3 className="mb-2 font-medium text-sm">{"活动"}</h3>
        <ActivityLog computerId={agentId} />
      </div>
    </section>
  );
}
