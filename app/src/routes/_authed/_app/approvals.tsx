import { createFileRoute } from "@tanstack/react-router";
import { ApprovalInbox } from "@/components/approvals/inbox";
import { PageShell } from "@/components/layout/page-shell";
export const Route = createFileRoute("/_authed/_app/approvals")({
  component: ApprovalsPage,
});
function ApprovalsPage() {
  return (
    <PageShell
      title={"审批"}
      description={"选择你的机器人可以做什么，并查看等待你的操作。"}
    >
      <ApprovalInbox />
    </PageShell>
  );
}
