import {
  IconBolt,
  IconBrain,
  IconDots,
  IconPlayerPause,
  IconPlus,
  IconRobot,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconStarOff,
  IconUsers,
  IconTrash,
} from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  useOptionalSidebar,
} from "@/components/ui/sidebar";
import { setSidebarSearch, useSidebarSearch } from "@/lib/sidebar-search";
import { cn } from "@/lib/utils";
import {
  type ChannelSummary,
  channelListQueryOptions,
} from "@/lib/channels/queries";
import { useChannelEvents } from "@/lib/channels/use-channel-events";
import { EASE_OUT, ENTRANCE_SECONDS } from "@/lib/motion";
import { relativeTime } from "@/lib/relative-time";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { ChannelAvatar } from "@/components/channels/avatar";
import { DeleteBotDialog } from "@/components/agents/delete-bot-dialog";
import {
  type MessageListEmphasis,
  useMainBot,
  useMessageListEmphasis,
} from "@/lib/settings/message-list";
import { usePanelBot } from "@/lib/panels/active-bot";
import { setBotPausedMutationOptions } from "@/lib/bot-lifecycle/mutations";
import {
  type BotAttention,
  botAttentionQueryOptions,
} from "@/lib/bot-lifecycle/queries";
import { queryClient } from "@/query-client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  attentionSummary,
  needsInput,
  useAttentionNotifications,
} from "../bot-profile/attention";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Channel } from "./channel";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChannelPagination } from "./channel-pagination";

/** Destinations that used to be sidebar rows; settings, approvals and admin moved to the avatar menu. */
const sideLinks = [
  { to: "/bots", label: "机器人", icon: IconRobot },
  { to: "/agents", label: "代理", icon: IconBolt },
  { to: "/team-bots", label: "团队 Bot", icon: IconUsers },
  { to: "/memory", label: "记忆", icon: IconBrain },
] as const;

/**
 * The roster, narrowed to what the person typed.
 *
 * Matches the channel's name, its summary, and the last message, because those are the things the
 * row can actually show — searching against something invisible returns results a person cannot
 * account for. The last message is included because it is still what the second line draws until the
 * conversation has been named. Message history beyond that line is not here to search: it lives in
 * the thread store, and reaching for it is a server endpoint rather than a filter.
 *
 * An empty query returns the input array unchanged rather than a copy, so typing and clearing does
 * not hand `AnimatePresence` a new array identity and restage the whole list.
 */
export function matchingChannels(
  channels: ChannelSummary[] | undefined,
  query: string,
): ChannelSummary[] {
  if (!channels) {
    return [];
  }
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return channels;
  }
  return channels.filter((channel) =>
    [channel.name, channel.summary, channel.lastMessage].some((field) =>
      field?.toLowerCase().includes(needle),
    ),
  );
}

/**
 * Pinned channels first, everything else after, newest activity first within each group.
 *
 * The mirror of a server rule, not the rule itself: the roster query orders pinned-first and its
 * cursor carries the pin, so a pinned channel arrives on page one however long ago it was last
 * spoken in. Sorting here as well is for what happens between refetches — the socket patches a pin
 * onto a loaded row without moving it, and re-sorts a page by recency alone — which is the same
 * reason `byRecency` in use-channel-events.ts mirrors the recency rule. A stable partition, so the
 * recency order inside each group is whatever arrived.
 */
export function pinnedFirst(channels: ChannelSummary[]): ChannelSummary[] {
  return [...channels].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/**
 * Whether a Bot has said something this member has not had on screen yet.
 *
 * A Bot's message, and only a Bot's: your own message carries a null agent id and reading your own
 * words needs no marker. ISO-8601 strings compare correctly as strings, which is the same bet the
 * server's recency sort already makes.
 */
export function hasUnseenActivity(channel: ChannelSummary): boolean {
  if (channel.lastMessageAgentId === null || channel.lastMessageAt === null) {
    return false;
  }
  return (
    channel.lastReadAt === null || channel.lastMessageAt > channel.lastReadAt
  );
}

/** Unseen activity somewhere you are not looking. The open channel never shows the dot. */
export function isUnread(
  channel: ChannelSummary,
  openChannelId: string | undefined,
): boolean {
  return channel.id !== openChannelId && hasUnseenActivity(channel);
}

/**
 * A roster row that can animate.
 *
 * Two movements only: a channel that did not exist fades in, and a channel that was just spoken in
 * moves to the top. Nothing else animates, a roster that reacts to being read is a roster that
 * moves under the cursor.
 */
function ChannelRow({
  channel,
  animateOrder,
  emphasis,
}: {
  channel: ChannelSummary;
  animateOrder: boolean;
  emphasis: MessageListEmphasis;
}) {
  const shouldReduceMotion = useReducedMotion();
  // Whether this row is unread, as a boolean, for the same reason `Channel` computes `isOpen`
  // that way: navigating re-renders the rows whose answer changed, not the whole roster.
  const unread = useParams({
    strict: false,
    select: (params) =>
      isUnread(channel, (params as { channelId?: string }).channelId),
  });
  return (
    <motion.div
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      initial={{
        opacity: 0,
        transform: shouldReduceMotion ? "none" : "translateY(-8px)",
      }}
      exit={{ opacity: 0 }}
      layout={animateOrder && !shouldReduceMotion ? "position" : false}
      transition={{ duration: ENTRANCE_SECONDS, ease: EASE_OUT }}
    >
      <Channel
        emphasis={emphasis}
        channelId={channel.id}
        participantIds={channel.agentIds}
        name={channel.name}
        summary={channel.summary ?? undefined}
        lastMessage={channel.lastMessage ?? undefined}
        lastMessageAt={
          channel.lastMessageAt
            ? relativeTime(channel.lastMessageAt)
            : undefined
        }
        pinned={channel.pinned}
        unread={unread}
        busy={channel.busy ?? false}
      />
    </motion.div>
  );
}

/**
 * The conversation a Bot's row opens: its most recent one-to-one channel, or a fresh chat with it
 * when none is loaded. Group channels are not any one Bot's chat, so they never count.
 */
export function latestChannelFor(
  botId: string,
  channels: ChannelSummary[] | undefined,
): ChannelSummary | undefined {
  let best: ChannelSummary | undefined;
  for (const channel of channels ?? []) {
    if (channel.agentIds.length !== 1 || channel.agentIds[0] !== botId) continue;
    if (!best || (channel.lastMessageAt ?? "") > (best.lastMessageAt ?? "")) best = channel;
  }
  return best;
}

type RosterBot = {
  id: string;
  name: string;
  title?: string | null;
  canManage?: boolean;
};

/** Opening the app at its home page lands in the main Bot's chat, once per page load. */
let landedOnce = false;

function useLandOnMainBot(
  mainBotId: string | null,
  preferencesSettled: boolean,
  roster: RosterBot[],
  rosterLoaded: boolean,
  channels: ChannelSummary[] | undefined,
  channelsSettled: boolean,
) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (landedOnce) return;
    if (pathname !== "/") {
      landedOnce = true;
      return;
    }
    if (!preferencesSettled) return;
    if (!mainBotId) {
      landedOnce = true;
      return;
    }
    if (!rosterLoaded || !channelsSettled) return;
    landedOnce = true;
    if (!roster.some((bot) => bot.id === mainBotId)) return;
    const latest = latestChannelFor(mainBotId, channels);
    if (latest) {
      void navigate({ to: "/channel/$channelId", params: { channelId: latest.id }, replace: true });
    } else {
      void navigate({ to: "/channel/new", search: { agent: mainBotId }, replace: true });
    }
  }, [pathname, mainBotId, preferencesSettled, roster, rosterLoaded, channels, channelsSettled, navigate]);
}

function BotRow({
  bot,
  selected,
  main,
  latest,
  attention,
  onToggleMain,
}: {
  bot: RosterBot;
  selected: boolean;
  main: boolean;
  latest: ChannelSummary | undefined;
  attention: BotAttention | undefined;
  onToggleMain: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const resume = useMutation(setBotPausedMutationOptions(queryClient));
  const waiting = attention ? needsInput(attention) : 0;
  const unread = !selected && attention ? attention.unread > 0 : false;
  const paused = attention?.paused ?? false;
  const content = (
    <>
      <span className="glass-bot-ava">
        <ChannelAvatar participantIds={[bot.id]} size={28} />
        {main ? (
          <span aria-hidden className="glass-bot-star">
            <IconStarFilled className="size-2.5" />
          </span>
        ) : null}
      </span>
      <span className="glass-bot-text">
        <span className="glass-item-t">{bot.name}</span>
        {paused ? (
          <span className="glass-item-s">{"已暂停"}</span>
        ) : bot.title ? (
          <span className="glass-item-s">{bot.title}</span>
        ) : null}
      </span>
      {waiting > 0 ? (
        <span className="glass-bot-badge" title={attention ? attentionSummary(attention) : undefined}>
          {waiting}
        </span>
      ) : unread ? (
        <span className="glass-bot-dot" title={attention ? attentionSummary(attention) : undefined} />
      ) : null}
    </>
  );
  return (
    <div
      className={cn("glass-bot-row", selected && "is-on", menuOpen && "menu-open")}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      {latest ? (
        <Link
          aria-current={selected ? "page" : undefined}
          className="glass-bot-link"
          params={{ channelId: latest.id }}
          title={bot.name}
          to="/channel/$channelId"
        >
          {content}
        </Link>
      ) : (
        <Link
          aria-current={selected ? "page" : undefined}
          className="glass-bot-link"
          search={{ agent: bot.id }}
          title={bot.name}
          to="/channel/new"
        >
          {content}
        </Link>
      )}
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              aria-label={`${bot.name} 更多操作`}
              className="glass-bot-more"
              type="button"
            />
          }
        >
          <IconDots className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="glass-pop min-w-44 p-1.5">
          <DropdownMenuItem className="gap-2" onClick={onToggleMain}>
            {main ? <IconStarOff className="size-4" /> : <IconStar className="size-4" />}
            {main ? "取消主机器人" : "设为主机器人"}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            render={<Link search={{ agent: bot.id }} to="/channel/new" />}
          >
            <IconPlus className="size-4" />
            {"新聊天"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            render={<Link params={{ agentId: bot.id }} to="/bots/$agentId" />}
          >
            <IconRobot className="size-4" />
            {"机器人设置"}
          </DropdownMenuItem>
          {paused ? (
            <DropdownMenuItem
              className="gap-2"
              onClick={() => resume.mutate({ agentId: bot.id, paused: false })}
            >
              <IconPlayerPause className="size-4" />
              {"恢复运行"}
            </DropdownMenuItem>
          ) : null}
          {bot.canManage ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <IconTrash className="size-4" />
                {"删除机器人…"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {bot.canManage ? (
        <DeleteBotDialog
          bot={{ id: bot.id, name: bot.name }}
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          selectedBotId={selected ? bot.id : undefined}
        />
      ) : null}
    </div>
  );
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const emphasis = useMessageListEmphasis();
  const channels = useInfiniteQuery(channelListQueryOptions());
  // One socket for the app, opened where the roster is kept live.
  useChannelEvents();
  const search = useSidebarSearch();
  const sidebar = useOptionalSidebar();
  const scrollRoot = useRef<HTMLDivElement>(null);
  const agents = useQuery(agentListQueryOptions());
  const roster = (agents.data ?? []).filter((bot) => !bot.hidden);
  const attention = useQuery(botAttentionQueryOptions());
  useAttentionNotifications(attention.data);
  const attentionById = new Map((attention.data ?? []).map((a) => [a.agentId, a]));
  const { botId: selectedBotId } = usePanelBot();
  const { mainBotId, settled: preferencesSettled, setMainBot } = useMainBot();
  const mainBot = mainBotId ? roster.find((bot) => bot.id === mainBotId) : undefined;
  const others = mainBot ? roster.filter((bot) => bot.id !== mainBot.id) : roster;
  useLandOnMainBot(
    mainBotId,
    preferencesSettled,
    roster,
    agents.isSuccess,
    channels.data,
    !channels.isPending,
  );

  const searching = search.trim().length > 0;
  const visibleChannels = searching
    ? pinnedFirst(matchingChannels(channels.data, search))
    : [];

  const row = (bot: RosterBot, isMain: boolean) => (
    <BotRow
      attention={attentionById.get(bot.id)}
      bot={bot}
      key={bot.id}
      latest={latestChannelFor(bot.id, channels.data)}
      main={isMain}
      onToggleMain={() => setMainBot(isMain ? null : bot.id)}
      selected={selectedBotId === bot.id}
    />
  );

  const collapsed = Boolean(sidebar && !sidebar.isMobile && sidebar.state === "collapsed");
  if (collapsed) {
    const railBots = mainBot ? [mainBot, ...others] : roster;
    return (
      <Sidebar collapsible="icon" variant="floating" {...props}>
        <BotMiniRail
          attentionById={attentionById}
          bots={railBots}
          channels={channels.data}
          mainBotId={mainBot?.id}
          selectedBotId={selectedBotId}
        />
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon" variant="floating" {...props}>
      <SidebarHeader className="glass-side-header glass-side-full gap-3 p-0 pb-3">
        <Link
          className="glass-newchat"
          search={selectedBotId ? { agent: selectedBotId } : {}}
          to="/channel/new"
        >
          <IconPlus className="size-[18px]" />
          {"新聊天"}
        </Link>
        {sidebar?.isMobile ? (
          <InputGroup className="bg-background text-sm rounded-full h-10">
            <InputGroupInput
              aria-label={"搜索会话"}
              onChange={(event) => setSidebarSearch(event.target.value)}
              placeholder={"搜索会话"}
              value={search}
            />
            <InputGroupAddon>
              <IconSearch />
            </InputGroupAddon>
          </InputGroup>
        ) : null}
      </SidebarHeader>
      <SidebarContent className="glass-side-full gap-3 overflow-hidden" id="chisabot-bot-list">
        <section
          aria-label={searching ? "搜索结果" : "机器人"}
          className="glass-card glass-side-card min-h-0 flex-1"
        >
          {searching ? (
            <>
              <div className="glass-sec">
                <span>{`搜索“${search.trim()}”`}</span>
              </div>
              <div ref={scrollRoot} className="glass-side-scroll scroll-fade-b">
                <SidebarMenu>
                  <SidebarGroup className="gap-px p-0">
                    {visibleChannels.length === 0 ? (
                      <div className="py-4">
                        <Empty className="border border-dashed min-h-[30dvh]">
                          <EmptyHeader>
                            <EmptyTitle>
                              {channels.hasNextPage
                                ? "没有加载的会话匹配您的搜索"
                                : "没有会话匹配您的搜索"}
                            </EmptyTitle>
                            <EmptyDescription className="text-pretty">
                              {channels.hasNextPage
                                ? "加载更早的会话以搜索更多历史。"
                                : `“${search.trim()}”在这里没有被命名，也没有任何人最近说过它。`}
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      </div>
                    ) : null}
                    <AnimatePresence initial={false}>
                      {visibleChannels.map((channel) => (
                        <ChannelRow
                          animateOrder={false}
                          channel={channel}
                          emphasis={emphasis}
                          key={channel.id}
                        />
                      ))}
                    </AnimatePresence>
                    <ChannelPagination
                      query={channels}
                      scrollRoot={scrollRoot}
                      searching={searching}
                    />
                  </SidebarGroup>
                </SidebarMenu>
              </div>
            </>
          ) : (
            <>
              <div className="glass-side-scroll glass-bot-scroll scroll-fade-b">
                {mainBot ? (
                  <>
                    <div className="glass-sec">
                      <span className="glass-sec-main">
                        <IconStarFilled className="size-3" />
                        {"主机器人"}
                      </span>
                    </div>
                    <div className="glass-bot-list">{row(mainBot, true)}</div>
                  </>
                ) : null}
                <div className={cn("glass-sec", mainBot && "mt-2")}>
                  <span>{"AI 同事"}</span>
                  <Link aria-label={"管理 AI 同事"} className="glass-sec-btn" to="/bots">
                    <IconPlus className="size-[15px]" />
                  </Link>
                </div>
                <div className="glass-bot-list">
                  {others.map((bot) => row(bot, false))}
                  {roster.length === 0 && agents.isSuccess ? (
                    <p className="px-2.5 py-1.5 text-muted-foreground text-xs">
                      {"还没有 AI 同事。"}
                    </p>
                  ) : null}
                </div>
                {!mainBot && roster.length > 0 ? (
                  <p className="glass-bot-hint">{"右键机器人可设为主机器人，置顶显示"}</p>
                ) : null}
              </div>
              <div className="glass-side-links">
                {sideLinks.map((item) => (
                  <Link
                    activeProps={{ className: "is-on" }}
                    className="glass-side-link"
                    key={item.to}
                    title={item.label}
                    to={item.to}
                  >
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function RailTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The roster collapsed (Ctrl+B / the top-bar toggle): a 64px glass rail of Bot avatars, so Bots stay
 * one click away. The selected Bot carries the same blue ring/edge as its full row, the main Bot its
 * star, and unread / waiting states a dot.
 */
function BotMiniRail({
  bots,
  mainBotId,
  selectedBotId,
  channels,
  attentionById,
}: {
  bots: RosterBot[];
  mainBotId: string | undefined;
  selectedBotId: string | null | undefined;
  channels: ChannelSummary[] | undefined;
  attentionById: Map<string, BotAttention>;
}) {
  return (
    <nav aria-label={"机器人"} className="glass-mini" id="chisabot-bot-list">
      <RailTip label={"新聊天"}>
        <Link
          aria-label={"新聊天"}
          className="glass-mini-new"
          search={selectedBotId ? { agent: selectedBotId } : {}}
          to="/channel/new"
        >
          <IconPlus className="size-5" />
        </Link>
      </RailTip>
      <div className="glass-card glass-mini-card">
        <div className="glass-mini-scroll scroll-fade-b">
          {bots.map((bot) => {
            const selected = selectedBotId === bot.id;
            const main = bot.id === mainBotId;
            const attention = attentionById.get(bot.id);
            const waiting = attention ? needsInput(attention) : 0;
            const unread = !selected && attention ? attention.unread > 0 : false;
            const latest = latestChannelFor(bot.id, channels);
            const label = main ? `${bot.name}（主机器人）` : bot.name;
            const inner = (
              <>
                <ChannelAvatar participantIds={[bot.id]} size={36} />
                {main ? (
                  <span aria-hidden className="glass-bot-star">
                    <IconStarFilled className="size-2.5" />
                  </span>
                ) : null}
                {waiting > 0 ? (
                  <span className="glass-mini-badge">{waiting}</span>
                ) : unread ? (
                  <span aria-hidden className="glass-mini-dot" />
                ) : null}
              </>
            );
            return (
              <RailTip key={bot.id} label={label}>
                {latest ? (
                  <Link
                    aria-current={selected ? "page" : undefined}
                    aria-label={label}
                    className={cn("glass-mini-bot", selected && "is-on")}
                    params={{ channelId: latest.id }}
                    to="/channel/$channelId"
                  >
                    {inner}
                  </Link>
                ) : (
                  <Link
                    aria-current={selected ? "page" : undefined}
                    aria-label={label}
                    className={cn("glass-mini-bot", selected && "is-on")}
                    search={{ agent: bot.id }}
                    to="/channel/new"
                  >
                    {inner}
                  </Link>
                )}
              </RailTip>
            );
          })}
        </div>
        <div className="glass-mini-links">
          {sideLinks.map((item) => (
            <RailTip key={item.to} label={item.label}>
              <Link
                activeProps={{ className: "is-on" }}
                aria-label={item.label}
                className="glass-mini-link"
                to={item.to}
              >
                <item.icon className="size-[18px]" />
              </Link>
            </RailTip>
          ))}
        </div>
      </div>
    </nav>
  );
}
