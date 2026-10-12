import { RouteSkeleton } from "@/components/startup-status";
import { CopilotChat } from "@copilotkit/react-core/v2";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { RegisterBotChat } from "@/components/agents/bot-chat-actions";
import { BotComposerContext, BotModelInput } from "@/components/agents/bot-model-input";
import { defaultAgentId } from "@/lib/agents/default-agent";
import {
  type AgentProfile,
  agentKeys,
  agentListQueryOptions,
} from "@/lib/agents/queries";
import { tryClient } from "@/lib/client";
import { useActiveBot } from "@/lib/copilot/active-bot";
import { useBotThread } from "@/lib/copilot/bot-thread";
import { useStoppedTurn } from "@/lib/copilot/stopped-turn";
import { useComputerAutoWatch } from "@/lib/computers/auto-watch";

/** 机器人聊天里 CopilotChat 自带的英文文案，换成与频道聊天一致的中文。 */
const BOT_CHAT_LABELS = {
  // 输入框自己写占位文字（「给『机器人』发消息…」）和 Shift+Enter 提示（DESIGN.md §25）。
  chatInputPlaceholder: "输入消息…",
  chatInputToolbarAddButtonLabel: "添加附件",
  assistantMessageToolbarCopyMessageLabel: "复制",
  assistantMessageToolbarCopyCodeLabel: "复制",
  assistantMessageToolbarCopyCodeCopiedLabel: "已复制",
  assistantMessageToolbarRegenerateLabel: "重新生成",
  userMessageToolbarCopyMessageLabel: "复制",
  userMessageToolbarEditMessageLabel: "编辑",
};

export const Route = createFileRoute("/_authed/_app/bot")({
  component: RouteComponent,
  validateSearch: (
    search: Record<string, unknown>,
  ): { agent?: string; watch?: boolean } => ({
    ...(typeof search.agent === "string" ? { agent: search.agent } : {}),
    ...(search.watch === true ? { watch: true } : {}),
  }),
});

/**
 * Which Bot this screen is for.
 *
 * WHATEVER THIS DEPLOYMENT ACTUALLY HAS. The default used to be a hardcoded `risk-analyst`, a name
 * from a tenant package this one is not: on a clone that ships anything else, opening this screen
 * without naming a Bot took the whole page down to an unstyled error boundary, because the chat
 * throws when asked for an agent the runtime never synced. OpenBot exists to be forked, so a Bot
 * name written into a route is a defect on every fork but the one it came from.
 *
 * A named Bot that this deployment does not have is answered in a sentence rather than thrown,
 * for the same reason: a mistyped link is not a crash.
 */
type BotDetailLookup =
  | { bot: AgentProfile; status: "found" }
  | { status: "missing" };

function isAgentEnvelope(body: unknown): body is { agent: AgentProfile } {
  if (body === null || typeof body !== "object") return false;
  const agent = (body as { agent?: unknown }).agent;
  return (
    agent !== null &&
    typeof agent === "object" &&
    typeof (agent as { id?: unknown }).id === "string" &&
    typeof (agent as { name?: unknown }).name === "string"
  );
}

async function loadExplicitBot(agentId: string): Promise<BotDetailLookup> {
  const response = await tryClient(
    `/api/agents/${encodeURIComponent(agentId)}`,
  );
  if (response.status === 404) return { status: "missing" };
  if (!response.ok) throw new Error("机器人无法加载。");

  const body: unknown = await response.json().catch(() => null);
  if (!isAgentEnvelope(body)) throw new Error("机器人无法加载。");
  return { bot: body.agent, status: "found" };
}

function RouteComponent() {
  const search = Route.useSearch();
  const agent = search.agent === "" ? undefined : search.agent;
  const {
    data: agents,
    isError,
    isPending,
  } = useQuery(agentListQueryOptions());
  const agentId = agent ?? defaultAgentId(agents);
  const listedBot = agents?.find((candidate) => candidate.id === agentId);
  const detailAgentId = agent ?? "";
  const shouldLoadExplicitBot =
    Boolean(agent) && agents !== undefined && listedBot === undefined;
  const {
    data: detail,
    isError: isDetailError,
    isPending: isDetailPending,
  } = useQuery({
    enabled: shouldLoadExplicitBot,
    queryKey: agentKeys.botRouteDetail(detailAgentId),
    queryFn: () => loadExplicitBot(detailAgentId),
    retry: false,
  });
  const bot =
    listedBot ?? (detail?.status === "found" ? detail.bot : undefined);
  const known = bot !== undefined;

  if (isPending || (shouldLoadExplicitBot && isDetailPending)) return <RouteSkeleton />;
  if (isError && agents === undefined) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <p className="text-destructive text-sm" role="alert">
          {"机器人无法加载。"}
        </p>
      </div>
    );
  }
  if (shouldLoadExplicitBot && isDetailError) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <p className="text-destructive text-sm" role="alert">
          {"机器人无法加载。"}
        </p>
      </div>
    );
  }
  if (!agentId || !known) {
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          {agent
            ? `此部署中没有名为 "${agent}" 的机器人。`
            : "此部署还没有机器人。"}
        </p>
      </div>
    );
  }

  /*
   * Keyed on the Bot, so the hooks below never see it change under them. They cannot be called
   * conditionally, and the guards above return before any of them run.
   */
  return <BotChat agentId={agentId} key={agentId} name={bot.name} />;
}

function BotChat({ agentId, name }: { agentId: string; name: string }) {
  // Tool calls here act on this Bot's own computer.
  useActiveBot(agentId);
  /*
   * Minted by this deployment rather than by the chat. `history` reports whether Intelligence
   * still recognised the thread this browser remembered from a previous visit; when it did not,
   * `useBotThread` has already swapped in a fresh id on its own; this flag exists only so the
   * page can say so instead of letting the Bot answer as if nothing were missing. `startNew`
   * mints another fresh thread on demand for the New chat control below.
   */
  const { threadId, history, startNew } = useBotThread(agentId);
  /*
   * A turn that ends without an answer has to be said out loud here, because the packaged chat says
   * nothing. It reports a failed run to an `onError` prop and otherwise carries on as though the
   * turn simply finished: the composer unlocks, the spinner goes, and the transcript keeps the
   * person's own message with nothing under it. The banner that would have explained it belongs to
   * a provider this app does not mount.
   */
  const stopped = useStoppedTurn(agentId);
  const { watch } = Route.useSearch();
  const navigate = Route.useNavigate();
  const showComputer = useCallback(
    (open: boolean) =>
      void navigate({
        search: (previous) => ({ ...previous, watch: open ? true : undefined }),
      }),
    [navigate],
  );
  // 计算机在右栏「面板 | 计算机」里（DESIGN.md §23）：机器人开始用计算机时自动切过去，停手后切回。
  useComputerAutoWatch(agentId, watch === true, showComputer);
  const composer = useMemo(() => ({ name, onNewTopic: startNew }), [name, startNew]);

  return (
      <div className="flex h-full min-h-0 flex-col">
        {/* DESIGN v4.1：聊天列没有头部；机器人「⋯」与计算机提示在左栏它那一行（新话题 Shift+T）。 */}
        <RegisterBotChat
          agentId={agentId}
          computerOpen={watch === true}
          onComputerChange={showComputer}
          fallbackName={name}
          onNewTopic={startNew}
        />
        {/*
         * Both banners render as plain siblings in this fixed order, never one nested inside the
         * other, so either can appear alone or both together without the layout jumping around
         * depending on which conditions are true.
         */}
        {history === "unavailable" ? (
          <p
            className="border-b bg-destructive/10 px-6 py-2 text-destructive text-sm"
            data-testid="bot-chat-history-unavailable"
            role="alert"
          >
            {"此会话中的较早消息无法加载，机器人正在没有它们的情况下回答。"}
          </p>
        ) : null}
        {/*
         * Under the header rather than at the end of the transcript, which is where the missing answer
         * was going to be and where the channel draws its own version of this. The packaged chat owns
         * that list and virtualises it, so reaching into it means replacing the whole message view and
         * taking on its scrolling. The cost of putting the sentence here instead is that it is not
         * beside the gap it explains; what it buys is that it is always on screen, whatever the
         * transcript has been scrolled to, and that it survives the next release of the chat.
         */}
        {stopped ? (
          <p
            className="border-b bg-destructive/10 px-6 py-2 text-destructive text-sm"
            data-testid="bot-chat-stopped"
            role="alert"
          >
            {stopped}
          </p>
        ) : null}
        <div className="bot-chat-sky min-h-0 flex-1">
          {/*
           * Keyed on the thread as well as the agent. Switching agents was already handled by
           * `agentId`, but `startNew` changes only the thread while the agent stays put, and the
           * packaged chat's own `startNewThread`/`setActiveThreadId` are proven no-ops once
           * `threadId` is a controlled prop (node_modules/@copilotkit/react-core/dist/copilotkit-
           * C4RqjAba.mjs:226-254): asking it to start over does nothing while it still holds the
           * old id. A key that omits the thread would leave the previous conversation on screen
           * under a composer that silently posts to the new one.
           */}
          {threadId ? (
            <BotComposerContext.Provider value={composer}>
            <CopilotChat
              input={BotModelInput}
              agentId={agentId}
              labels={BOT_CHAT_LABELS}
              key={`${agentId}:${threadId}`}
              threadId={threadId}
            />
            </BotComposerContext.Provider>
          ) : null}
        </div>
      </div>
  );
}
