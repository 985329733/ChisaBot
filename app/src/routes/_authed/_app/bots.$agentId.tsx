import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { BotProfile } from "@/components/bot-profile/profile";
import { PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { agentQueryOptions } from "@/lib/agents/queries";

export const Route = createFileRoute("/_authed/_app/bots/$agentId")({
  component: BotProfilePage,
});

function BotProfilePage() {
  const { agentId } = Route.useParams();
  const agent = useQuery(agentQueryOptions(agentId));
  return (
    <PageShell
      backButton={{ label: "机器人", linkProps: { to: "/bots" } }}
      description={"这个机器人为您做什么，以及它如何运行。"}
      title={agent.data?.name ?? "机器人"}
    >
      {agent.isPending ? <PageSkeleton /> : agent.error ? (
        <p className="mt-6 text-destructive text-sm" role="alert">
          {"此机器人不可达。"}
        </p>
      ) : (
        <BotProfile agent={agent.data} />
      )}
    </PageShell>
  );
}
