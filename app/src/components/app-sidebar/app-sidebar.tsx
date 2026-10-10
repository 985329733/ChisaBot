import {
  IconBolt,
  IconBrain,
  IconPlus,
  IconRobot,
  IconSearch,
  IconUsers,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useParams, useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import { useRef } from "react";
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
import {
  type MessageListEmphasis,
  useMessageListEmphasis,
} from "@/lib/settings/message-list";
import { BotAttentionList } from "../bot-profile/attention";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Channel } from "./channel";
import { ChannelPagination } from "./channel-pagination";

/** Destinations that used to be sidebar rows; settings, approvals and admin moved to the avatar menu. */
const sideLinks = [
  { to: "/bots", label: "机器人", icon: IconRobot },
  { to: "/agents", label: "代理", icon: IconBolt },
  { to: "/team-bots", label: "团队 Bot", icon: IconUsers },
  { to: "/memory", label: "记忆", icon: IconBrain },
] as const;

/**
 * Cap layout animation because `layout` measures every animated row on each reorder.
 */
const MAX_ANIMATED_ROWS = 60;

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

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const emphasis = useMessageListEmphasis();
  const channels = useInfiniteQuery(channelListQueryOptions());
  // One socket for the app, opened where the roster is kept live.
  useChannelEvents();
  const search = useSidebarSearch();
  const sidebar = useOptionalSidebar();
  const scrollRoot = useRef<HTMLDivElement>(null);
  const roster = (useQuery(agentListQueryOptions()).data ?? []).filter(
    (bot) => !bot.hidden,
  );
  const activeBotId = useRouterState({
    select: (state) =>
      state.location.pathname === "/channel/new"
        ? ((state.location.search as { agent?: string }).agent ?? undefined)
        : undefined,
  });
  const searching = search.trim().length > 0;
  const visibleChannels = pinnedFirst(matchingChannels(channels.data, search));
  /*
   * FILTERING DOES NOT ANIMATE. Rows exit and relayout on every keystroke otherwise, which is a
   * list thrashing under somebody who is still typing — and the moving target is the very thing
   * they are trying to read. Order animation is for a channel that was just spoken in, which is
   * occasional; this is not.
   */
  const animateOrder =
    !searching && (channels.data?.length ?? 0) <= MAX_ANIMATED_ROWS;

  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader className="glass-side-header gap-3 p-0 pb-3">
        <Link className="glass-newchat" to="/channel/new">
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
      <SidebarContent className="gap-3 overflow-hidden">
        <section className="glass-card glass-side-card shrink-0" aria-label={"AI 同事"}>
          <div className="glass-sec">
            <span>{"AI 同事"}</span>
            <Link aria-label={"管理 AI 同事"} className="glass-sec-btn" to="/bots">
              <IconPlus className="size-[15px]" />
            </Link>
          </div>
          <div className="glass-bot-list">
            {roster.map((bot) => (
              <Link
                activeOptions={{ includeSearch: true }}
                className={cn("glass-item", activeBotId === bot.id && "is-on")}
                key={bot.id}
                search={{ agent: bot.id }}
                to="/channel/new"
              >
                <ChannelAvatar participantIds={[bot.id]} size={26} />
                <span className="glass-item-t">{bot.name}</span>
                {bot.title ? (
                  <span className="glass-item-s">{bot.title}</span>
                ) : null}
              </Link>
            ))}
            {roster.length === 0 ? (
              <p className="px-2.5 py-1.5 text-muted-foreground text-xs">
                {"还没有 AI 同事。"}
              </p>
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
        </section>
        <section
          aria-label={"会话"}
          className="glass-card glass-side-card min-h-0 flex-1"
        >
          <div className="glass-sec">
            <span>{searching ? `搜索“${search.trim()}”` : "会话"}</span>
            <Link aria-label={"新群组会话"} className="glass-sec-btn" to="/group/new">
              <IconUsersGroup className="size-[15px]" />
            </Link>
          </div>
          <div ref={scrollRoot} className="glass-side-scroll scroll-fade-b">
        <SidebarMenu>
          <SidebarGroup className="gap-px p-0">
            {/* Bots that need you, or that you paused. See bot-profile/attention.tsx. */}
            <BotAttentionList />
            {/*
             * TWO DIFFERENT NOTHINGS, AND SAYING THE WRONG ONE IS ALARMING. A roster nobody has
             * used yet needs telling how to start. A roster that simply does not match what is in
             * the box has to say so and quote it back.
             */}
            {searching && visibleChannels.length === 0 ? (
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
            {!searching && channels.data?.length === 0 ? (
              <div className="py-4">
                <Empty className="border border-dashed min-h-[30dvh]">
                  <EmptyHeader>
                    <EmptyTitle>{"您还没有会话"}</EmptyTitle>
                    <EmptyDescription className="text-pretty">
                      {"开始与 AI 同事对话，你的会话将在这里出现。"}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </div>
            ) : null}
            <AnimatePresence initial={false}>
              {visibleChannels.map((channel) => (
                <ChannelRow
                  emphasis={emphasis}
                  key={channel.id}
                  animateOrder={animateOrder}
                  channel={channel}
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
        </section>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
