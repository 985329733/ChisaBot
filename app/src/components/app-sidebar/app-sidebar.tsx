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
  IconUserCircle,
} from "@tabler/icons-react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type * as React from "react";
import { useRef, useState } from "react";
import { AccountCard, AccountMenu } from "@/components/layout/account-menu";
import { SidebarSearchField } from "@/components/layout/sidebar-search-field";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarMenu,
  SidebarRail,
  useOptionalSidebar,
} from "@/components/ui/sidebar";
import { requestSidebarSearchFocus, useSidebarSearch } from "@/lib/sidebar-search";
import { cn } from "@/lib/utils";
import {
  type ChannelSummary,
  channelListQueryOptions,
} from "@/lib/channels/queries";
import { useChannelEvents } from "@/lib/channels/use-channel-events";
import { latestChannelFor } from "@/lib/channels/latest";
import { openCreateBot } from "@/lib/agents/create-bot";
import { EASE_OUT, ENTRANCE_SECONDS } from "@/lib/motion";
import { relativeTime } from "@/lib/relative-time";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { ChannelAvatar } from "@/components/channels/avatar";
import { DeleteBotDialog } from "@/components/agents/delete-bot-dialog";
import { BotChatMenuItems, BotRowComputerChip } from "@/components/agents/bot-chat-actions";
import { useBotChat, useCurrentBotChat } from "@/lib/agents/bot-chat-context";
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

/** Kept exported from here for existing callers; lives in lib/channels/latest.ts. */
export { latestChannelFor };

type RosterBot = {
  id: string;
  name: string;
  title?: string | null;
  canManage?: boolean;
};

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
  // DESIGN v4.1：当前对话的机器人控件（设置窗格 / 计算机 / 新话题）由聊天页登记，在这一行里操作。
  const chat = useBotChat(bot.id);
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
      className={cn("glass-bot-row", (selected || chat) && "is-on", menuOpen && "menu-open")}
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
      <BotRowComputerChip chat={chat} />
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              aria-label={`${bot.name} 机器人菜单`}
              className="glass-bot-more"
              title={"机器人菜单"}
              type="button"
            />
          }
        >
          <IconDots className="size-4" />
        </DropdownMenuTrigger>
        <BotMenuContent
          bot={bot}
          chat={chat}
          latest={latest}
          main={main}
          onDelete={() => setDeleteOpen(true)}
          onResume={() => resume.mutate({ agentId: bot.id, paused: false })}
          onToggleMain={onToggleMain}
          paused={paused}
        />
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

/**
 * 机器人「⋯」菜单（DESIGN v4.1 §W5，原来在聊天列头部，现在在左栏机器人行）：
 * 机器人设置 · 查看计算机 · 新话题 ‖ 设为主机器人 · 机器人资料页 · 恢复运行 ‖ 删除机器人…
 */
function BotMenuContent({
  bot,
  chat,
  latest,
  main,
  paused,
  onToggleMain,
  onResume,
  onDelete,
}: {
  bot: RosterBot;
  chat: ReturnType<typeof useBotChat>;
  latest: ChannelSummary | undefined;
  main: boolean | null;
  paused: boolean;
  onToggleMain: (() => void) | null;
  onResume: () => void;
  onDelete: () => void;
}) {
  const icon = "size-[18px] shrink-0 opacity-80";
  return (
    <DropdownMenuContent align="start" className="glass-pop w-[288px] p-1.5" side="right" sideOffset={10}>
      <BotChatMenuItems agentId={bot.id} chat={chat} latest={latest} />
      <DropdownMenuSeparator className="glass-sep" />
      {onToggleMain ? (
        <DropdownMenuItem className="glass-mi" onClick={onToggleMain}>
          {main ? <IconStarOff className={icon} /> : <IconStar className={icon} />}
          <span className="min-w-0 flex-1">{main ? "取消主机器人" : "设为主机器人"}</span>
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        className="glass-mi"
        render={<Link params={{ agentId: bot.id }} to="/bots/$agentId" />}
      >
        <IconUserCircle className={icon} />
        <span className="min-w-0 flex-1">{"机器人资料页"}</span>
      </DropdownMenuItem>
      {paused ? (
        <DropdownMenuItem className="glass-mi" onClick={onResume}>
          <IconPlayerPause className={icon} />
          <span className="min-w-0 flex-1">{"恢复运行"}</span>
        </DropdownMenuItem>
      ) : null}
      {bot.canManage ? (
        <>
          <DropdownMenuSeparator className="glass-sep" />
          <DropdownMenuItem className="glass-mi text-destructive focus:text-destructive" onClick={onDelete}>
            <IconTrash className={icon} />
            <span className="min-w-0 flex-1">{"删除机器人…"}</span>
          </DropdownMenuItem>
        </>
      ) : null}
    </DropdownMenuContent>
  );
}

/**
 * 当前对话的机器人不在列表里（隐藏的机器人，例如浏览器机器人）时，在列表顶部临时给它一行，
 * 这样它的「⋯」和计算机提示仍然够得着。
 */
function HiddenChatBotRow({ known }: { known: Set<string> }) {
  const current = useCurrentBotChat();
  const agents = useQuery(agentListQueryOptions());
  if (!current || known.has(current.agentId)) return null;
  const profile = agents.data?.find((a) => a.id === current.agentId);
  const bot: RosterBot = {
    id: current.agentId,
    name: profile?.name ?? current.fallbackName ?? "",
    title: profile?.title ?? null,
  };
  return (
    <>
      <div className="glass-sec">
        <span>{"当前对话"}</span>
      </div>
      <div className="glass-bot-list mb-2">
        <HiddenBotRow bot={bot} chat={current} />
      </div>
    </>
  );
}

function HiddenBotRow({ bot, chat }: { bot: RosterBot; chat: NonNullable<ReturnType<typeof useBotChat>> }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className={cn("glass-bot-row is-on", menuOpen && "menu-open")}>
      <span className="glass-bot-link">
        <span className="glass-bot-ava">
          <ChannelAvatar participantIds={[bot.id]} size={28} />
        </span>
        <span className="glass-bot-text">
          <span className="glass-item-t">{bot.name}</span>
          {bot.title ? <span className="glass-item-s">{bot.title}</span> : null}
        </span>
      </span>
      <BotRowComputerChip chat={chat} />
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger
          render={
            <button aria-label={`${bot.name} 机器人菜单`} className="glass-bot-more" title={"机器人菜单"} type="button" />
          }
        >
          <IconDots className="size-4" />
        </DropdownMenuTrigger>
        <BotMenuContent
          bot={bot}
          chat={chat}
          latest={undefined}
          main={null}
          onDelete={() => {}}
          onResume={() => {}}
          onToggleMain={null}
          paused={false}
        />
      </DropdownMenu>
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
  const { mainBotId, setMainBot } = useMainBot();
  const mainBot = mainBotId ? roster.find((bot) => bot.id === mainBotId) : undefined;
  const others = mainBot ? roster.filter((bot) => bot.id !== mainBot.id) : roster;

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
          setMainBot={setMainBot}
        />
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon" variant="floating" {...props}>
      <SidebarContent className="glass-side-full gap-3 overflow-hidden" id="chisabot-bot-list">
        <section
          aria-label={searching ? "搜索结果" : "机器人"}
          className="glass-card glass-side-card min-h-0 flex-1"
        >
          {/* DESIGN-v4：搜索在它要搜的列表上面，同一张卡片里（Ctrl K 聚焦这里）。 */}
          <SidebarSearchField />
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
              {/* The list's own header: title, ＋ 新建机器人 at the top-left, 管理 on the right. */}
              <div className="glass-list-head">
                <span className="glass-list-title">{"机器人"}</span>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        aria-label={"新建机器人"}
                        className="glass-list-add"
                        onClick={openCreateBot}
                        type="button"
                      />
                    }
                  >
                    <IconPlus className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={6}>
                    {"新建机器人"}
                  </TooltipContent>
                </Tooltip>
                <Link
                  className="glass-sec-link ml-auto"
                  title={"管理机器人（右键机器人可设为主机器人）"}
                  to="/bots"
                >
                  {"管理"}
                </Link>
              </div>
              <div className="glass-side-scroll glass-bot-scroll scroll-fade-b">
                <HiddenChatBotRow known={new Set(roster.map((bot) => bot.id))} />
                {mainBot ? (
                  <>
                    <div className="glass-sec">
                      <span className="glass-sec-main">
                        <IconStarFilled className="size-3" />
                        {"主机器人"}
                      </span>
                    </div>
                    <div className="glass-bot-list">{row(mainBot, true)}</div>
                    {others.length > 0 ? (
                      <div className="glass-sec mt-2">
                        <span>{"其他"}</span>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className="glass-bot-list">
                  {others.map((bot) => row(bot, false))}
                  {roster.length === 0 && agents.isSuccess ? (
                    <button className="glass-list-empty" onClick={openCreateBot} type="button">
                      <IconPlus className="size-4" />
                      {"新建一个机器人"}
                    </button>
                  ) : null}
                </div>
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
        {/* 账号永远在左栏最底下，单独一张小卡：「我是谁」和「我在用什么」分开。 */}
        <AccountCard />
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
  setMainBot,
}: {
  bots: RosterBot[];
  mainBotId: string | undefined;
  selectedBotId: string | null | undefined;
  channels: ChannelSummary[] | undefined;
  attentionById: Map<string, BotAttention>;
  setMainBot: (id: string | null) => void;
}) {
  return (
    <nav aria-label={"机器人"} className="glass-mini" id="chisabot-bot-list">
      <MiniSearchButton />
      <RailTip label={"新建机器人"}>
        <button aria-label={"新建机器人"} className="glass-mini-new" onClick={openCreateBot} type="button">
          <IconPlus className="size-5" />
        </button>
      </RailTip>
      <div className="glass-card glass-mini-card">
        <div className="glass-mini-scroll scroll-fade-b">
          {bots.map((bot) => (
            <MiniBot
              attention={attentionById.get(bot.id)}
              bot={bot}
              key={bot.id}
              latest={latestChannelFor(bot.id, channels)}
              main={bot.id === mainBotId}
              onToggleMain={() => setMainBot(bot.id === mainBotId ? null : bot.id)}
              selected={selectedBotId === bot.id}
            />
          ))}
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
      <div className="glass-card acct-mini-card">
        <AccountMenu compact />
      </div>
    </nav>
  );
}

/**
 * 收起的左栏里的一个机器人头像（DESIGN v4.2）：右键或悬停 / 聚焦时出现的小「⋯」打开和展开行同一个
 * 菜单（BotMenuContent）；选中的机器人「⋯」常显（头像左下角的小徽标）。计算机打开 / 需要你时，
 * 选中的头像左上角有一个圆点（蓝 = 已打开，琥珀 = 需要你）。
 */
function MiniBot({
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
  const chat = useBotChat(bot.id);
  const waiting = attention ? needsInput(attention) : 0;
  const unread = !selected && attention ? attention.unread > 0 : false;
  const paused = attention?.paused ?? false;
  const label = main ? `${bot.name}（主机器人）` : bot.name;
  const computer = chat?.canComputer && (chat.needsYou || chat.computerOpen) ? (chat.needsYou ? "needs" : "open") : null;
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
  const linkClass = cn("glass-mini-bot", (selected || chat) && "is-on");
  return (
    <div
      className={cn("glass-mini-slot", (selected || chat) && "is-on", menuOpen && "menu-open")}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <RailTip label={label}>
        {latest ? (
          <Link
            aria-current={selected ? "page" : undefined}
            aria-label={label}
            className={linkClass}
            params={{ channelId: latest.id }}
            to="/channel/$channelId"
          >
            {inner}
          </Link>
        ) : (
          <Link
            aria-current={selected ? "page" : undefined}
            aria-label={label}
            className={linkClass}
            search={{ agent: bot.id }}
            to="/channel/new"
          >
            {inner}
          </Link>
        )}
      </RailTip>
      {computer ? (
        <span
          className={cn("glass-mini-comp", computer === "needs" && "is-needs")}
          role="img"
          aria-label={computer === "needs" ? "计算机需要你" : "计算机已打开"}
          title={computer === "needs" ? "计算机需要你" : "计算机已打开"}
        />
      ) : null}
      <DropdownMenu onOpenChange={setMenuOpen} open={menuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              aria-label={`${bot.name} 机器人菜单`}
              className="glass-mini-more"
              title={"机器人菜单"}
              type="button"
            />
          }
        >
          <IconDots className="size-3" />
        </DropdownMenuTrigger>
        <BotMenuContent
          bot={bot}
          chat={chat}
          latest={latest}
          main={main}
          onDelete={() => setDeleteOpen(true)}
          onResume={() => resume.mutate({ agentId: bot.id, paused: false })}
          onToggleMain={onToggleMain}
          paused={paused}
        />
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

/** 收起的左栏：搜索变成一个图标，点它（或 Ctrl K）先展开左栏再聚焦搜索框，位置和展开时一致（最上面）。 */
function MiniSearchButton() {
  const sidebar = useOptionalSidebar();
  return (
    <RailTip label={"搜索会话（Ctrl K）"}>
      <button
        aria-label={"搜索会话"}
        className="glass-mini-search"
        onClick={() => {
          sidebar?.setOpen(true);
          requestSidebarSearchFocus();
        }}
        type="button"
      >
        <IconSearch className="size-[18px]" />
      </button>
    </RailTip>
  );
}
