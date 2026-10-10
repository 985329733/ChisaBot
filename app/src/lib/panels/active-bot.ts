import { useQuery } from "@tanstack/react-query";
import { useParams, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { channelQueryOptions } from "@/lib/channels/queries";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/preference-storage";

const PANEL_BOT_KEY = "chisabot-panel-bot";

/**
 * Which Bot's panels the right column shows.
 *
 * The open conversation decides when there is one (its single coworker, or `?agent=` on a new
 * chat). Elsewhere it is the Bot last picked in the column's chip, then the first Bot on the roster.
 */
export function usePanelBot(): {
  botId: string | undefined;
  routeBotId: string | undefined;
  choose: (botId: string) => void;
} {
  const channelId = useParams({
    strict: false,
    select: (params) => (params as { channelId?: string }).channelId,
  });
  const searchAgent = useRouterState({
    select: (state) =>
      (state.location.search as { agent?: unknown }).agent as
        | string
        | undefined,
  });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChannel = pathname.startsWith("/channel/") && pathname !== "/channel/new";
  const channel = useQuery({
    ...channelQueryOptions(channelId ?? ""),
    enabled: Boolean(channelId) && isChannel,
  });
  const agents = useQuery(agentListQueryOptions());
  const [stored, setStored] = useState<string | undefined>(
    () => readStoredPreference(PANEL_BOT_KEY) ?? undefined,
  );

  const routeBotId =
    (isChannel && channel.data?.agentIds.length === 1
      ? channel.data.agentIds[0]
      : undefined) ??
    (typeof searchAgent === "string" && searchAgent ? searchAgent : undefined);

  const known = agents.data?.map((a) => a.id) ?? [];
  const fallback =
    stored && (known.length === 0 || known.includes(stored))
      ? stored
      : agents.data?.[0]?.id;

  useEffect(() => {
    if (routeBotId && routeBotId !== stored) {
      writeStoredPreference(PANEL_BOT_KEY, routeBotId);
      setStored(routeBotId);
    }
  }, [routeBotId, stored]);

  return {
    botId: routeBotId ?? fallback,
    routeBotId,
    choose: (botId: string) => {
      writeStoredPreference(PANEL_BOT_KEY, botId);
      setStored(botId);
    },
  };
}
