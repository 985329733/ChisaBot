import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BotProfilePage } from "@/components/bot-profile/profile";
import { PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/skyglass";
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
        // 找不到 / 读不到都给一张错误卡和出路（DESIGN.md §71.3），不是一行红字。
        <ErrorCard
          action={
            <Button className="mt-2" nativeButton={false} render={<Link to="/bots" />} size="sm" variant="outline">
              {"看我的机器人"}
            </Button>
          }
          className="mt-6"
          description={"可能已经删掉了，或者不是你账号里的机器人。"}
          detail={agent.error?.message}
          title={"找不到这个机器人"}
        />
      )}
    </PageShell>
  );
}
