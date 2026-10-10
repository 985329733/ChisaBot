import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AbstractAvatar } from "@/components/agents/abstract-avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { handoffRoster } from "@/lib/agents/handoff-roster";
import { setHandoffGrantMutationOptions } from "@/lib/agents/mutations";
import {
  agentHandoffQueryOptions,
  agentListQueryOptions,
} from "@/lib/agents/queries";

/**
 * Which Bots this one may hand work to.
 *
 * On the Bot's own screen rather than in the connector catalogue: a catalogue entry has a fixed list
 * of tools somebody else maintains, and the Bots a deployment has are whatever was made here. It is
 * also the question a person asks while looking at a Bot, not while looking at a vendor.
 *
 * DIRECTIONAL, and said so on the screen, because the pair is the one thing about this that is easy
 * to get backwards: this is who this Bot may ask, not who may ask it.
 *
 * One Item per candidate, with a Switch: the grant is one boolean that takes effect when switched,
 * which is exactly the row kind a Switch means everywhere else in this app.
 */
export function HandoffPanel({ agentId }: { agentId: string }) {
  const queryClient = useQueryClient();
  const handoff = useQuery(agentHandoffQueryOptions(agentId));
  const agents = useQuery(agentListQueryOptions());
  /*
   * The roster this person has hidden, read so a grant pointing into it can still be taken away.
   *
   * Hiding is a per-person display preference and the grants are not filtered by it at all, so
   * joining the grants against the visible roster alone dropped live grants off the only screen that
   * manages them. See `handoffRoster`, which is where that join now happens.
   */
  const hiddenAgents = useQuery(agentListQueryOptions(true));
  const setGrant = useMutation(setHandoffGrantMutationOptions(queryClient));

  if (handoff.isPending || !handoff.data) return null;
  const { enabled, canGrant, reachable, grantable } = handoff.data;

  // A Bot may not be granted itself, and the server refuses it, so it is not offered here either.
  const { candidates, granted, total } = handoffRoster({
    agentId,
    roster: agents.data ?? [],
    hidden: hiddenAgents.data ?? [],
    reachable,
    grantable,
  });

  // Nothing to say to somebody who cannot change it and has nothing to read.
  if (!canGrant && reachable.length === 0) return null;

  return (
    <section className="grid gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {"机器人可能询问"}
        </h2>
        {/* The current answer at a glance, so the list below is detail rather than homework. */}
        {grantable && total > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {granted} {"的"}
            {total}
          </span>
        ) : null}
      </header>

      <p className="text-muted-foreground text-sm">
        {
          "这个机器人可以问谁，而不是谁可以问它。被问的机器人说的话会回到问它的对话中，被中继并归因。"
        }
      </p>

      {enabled ? null : (
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{"此部署已关闭"}</ItemTitle>
            {/*
             * Unclamped: `ItemDescription` clips to two lines, which is right for a roster row
             * whose description is a subtitle and wrong for an item that exists to explain. The
             * sentence that gets cut is the one saying what to do about it.
             */}
            <ItemDescription className="line-clamp-none">
              {"这些授权被保留，但直到机器人间工作切换回开启才生效。"}
            </ItemDescription>
          </ItemContent>
        </Item>
      )}

      {grantable ? null : (
        <Item variant="muted">
          <ItemContent>
            <ItemTitle>{"此 AI 同事无法处理工作"}</ItemTitle>
            {/* Unclamped for the same reason as above: three lines, and the third is the useful one. */}
            <ItemDescription className="line-clamp-none">
              {
                "此部署没有地方记录它可以处理哪些机器人，因此没有可以授予它的东西。它仍然可以被可以的机器人请求。"
              }
            </ItemDescription>
          </ItemContent>
        </Item>
      )}

      {setGrant.error ? (
        <p className="text-destructive text-sm" role="alert">
          {setGrant.error.message}
        </p>
      ) : null}

      {grantable && total === 0 ? (
        <Empty className="h-[180px] border border-dashed">
          <EmptyHeader>
            <EmptyTitle className="text-muted-foreground">
              {"暂无其他机器人"}
            </EmptyTitle>
            <EmptyDescription>
              {"当此部署有更多机器人时，这是此机器人被允许询问他们的地方。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
      {candidates.length > 0 ? (
        <div className="flex flex-col gap-2">
          {candidates.map((candidate) => (
            <Item key={candidate.id} size="sm" variant="muted">
              <ItemMedia>
                <AbstractAvatar
                  name={candidate.name}
                  seed={candidate.avatarSeed}
                  size={28}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{candidate.name}</ItemTitle>
                {/*
                 * Said on the row, because otherwise it is a coworker that is not on your roster
                 * appearing in a list with no explanation. It is here only because this Bot may
                 * already ask it, and that is the sentence a person needs to decide what to do.
                 */}
                <ItemDescription>
                  {candidate.hidden
                    ? `${candidate.title} · 从你的名册中隐藏`
                    : candidate.title}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  aria-label={`让这个机器人询问 ${candidate.name}`}
                  checked={reachable.includes(candidate.id)}
                  disabled={!canGrant || setGrant.isPending}
                  onCheckedChange={(next: boolean) =>
                    setGrant.mutate({
                      agentId,
                      ref: candidate.id,
                      granted: next,
                    })
                  }
                />
              </ItemActions>
            </Item>
          ))}
        </div>
      ) : null}

      {canGrant ? null : (
        <p className="text-muted-foreground text-xs">
          {"管理员决定哪些机器人可以被询问。"}
        </p>
      )}
    </section>
  );
}
