import { createFileRoute } from "@tanstack/react-router";
import { PendingInbox } from "@/components/approvals/inbox";
import { PageShell } from "@/components/layout/page-shell";
export const Route = createFileRoute("/_authed/_app/approvals")({
  component: ApprovalsPage,
});
/** 账号菜单 →「待处理」（DESIGN.md §71.1）。 */
function ApprovalsPage() {
  return (
    <PageShell title={"待处理"} description={"等你点头的事：机器人在聊天里问过、你还没回的确认，和它在等你回答的问题。"}>
      <PendingInbox />
    </PageShell>
  );
}
