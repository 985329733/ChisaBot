import { ActivityLog } from "./activity-log";
import { ComputerView } from "./computer-view";

/** The current live computer, separate from screenshots kept in historical tool results. */
export function ComputerViewPanel({
  agentId,
  name,
}: {
  agentId: string;
  name?: string;
}) {
  return (
    <section aria-label={"计算机侧边栏"} className="p-4">
      <ComputerView active computerId={agentId} name={name} minWidth={0} />
      <div className="mt-8">
        <h3 className="mb-2 font-medium text-sm">{"活动"}</h3>
        <ActivityLog computerId={agentId} />
      </div>
    </section>
  );
}
