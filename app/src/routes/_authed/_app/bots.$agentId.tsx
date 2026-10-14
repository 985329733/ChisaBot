import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BotProfilePage } from "@/components/bot-profile/profile";
import { PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { agentQueryOptions } from "@/lib/agents/queries";

export const Route = createFileRoute("/_authed/_app/bots/$agentId")({
  component: BotProfileRoute,
});

/** 机器人资料页（DESIGN.md §46）：页头、资料、运行、任务都在 BotProfilePage 里。 */
function BotProfileRoute() {
  const { agentId } = Route.useParams();
  const agent = useQuery(agentQueryOptions(agentId));
  if (agent.data) return <BotProfilePage agent={agent.data} />;
  return (
    <PageShell backButton={{ label: "机器人", linkProps: { to: "/bots" } }} title={"机器人"}>
      {agent.isPending ? (
        <PageSkeleton />
      ) : (
        <p className="mt-6 text-destructive text-sm" role="alert">
          {"找不到这个机器人，或者你没有权限查看。"}
        </p>
      )}
    </PageShell>
  );
}
