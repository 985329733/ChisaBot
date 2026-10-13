import { FEEDBACK_PRESETS, useMutationFeedback } from "@/components/ui/async-action";
import { PresenceItem, PresenceList } from "@/components/ui/presence";
import { toast } from "@/components/ui/toast";
import { AsyncContent } from "@/components/ui/button";
import { LivePanelList, useLivePanels } from "./live-panels";
import { confirmDialog } from "@/components/ui/confirm";
import {
  IconAdjustments,
  IconBooks,
  IconCheck,
  IconDeviceDesktop,
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconLayoutGrid,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { useCurrentBotChat } from "@/lib/agents/bot-chat-context";
import { ComputerViewPanel } from "@/components/computer/computer-panel";
import { usePanelBot } from "@/lib/panels/active-bot";
import {
  type Json,
  type PanelDraft,
  type PanelInstance,
  type PanelLibraryEntry,
  panelErrorText,
  panelKeys,
  panelLibraryQueryOptions,
  panelListQueryOptions,
  panelSessionQueryOptions,
  panelsApi,
} from "@/lib/panels/api";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/preference-storage";
import {
  PANEL_RAIL_HOTKEY,
  PANEL_RAIL_HOTKEY_LABEL,
  setPanelRailOpen,
  setPanelSheetOpen,
  togglePanelRail,
  usePanelRailOpen,
  usePanelSheetOpen,
  useWideForRail,
} from "@/lib/panels/rail-open";
import { matchesHotkey } from "@/lib/hotkeys/hotkeys";
import { ToggleTip } from "@/components/layout/glass-topbar";
import { cn } from "@/lib/utils";
import { PanelFrame, type PanelFrameBridge, previewBridge } from "./panel-frame";

const WIDTH_KEY = "chisabot-panel-rail-width";
const MIN_WIDTH = 300;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 380;

function storedWidth() {
  const raw = Number(readStoredPreference(WIDTH_KEY));
  return Number.isFinite(raw) && raw >= MIN_WIDTH && raw <= MAX_WIDTH
    ? raw
    : DEFAULT_WIDTH;
}

/**
 * The right-hand column: the current Bot's custom panels, the shared panel library, and the entry
 * point for asking the Bot to build a new one. Resizable from its left edge; the width is kept in
 * localStorage.
 */
export function PanelRail({ className }: { className?: string }) {
  const [width, setWidth] = useState(storedWidth);
  const [dragging, setDragging] = useState(false);
  const open = usePanelRailOpen();
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    start.current = { x: event.clientX, width };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const next = Math.round(
      Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, start.current.width + start.current.x - event.clientX),
      ),
    );
    setWidth(next);
  };
  const onPointerUp = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    setWidth((w) => {
      writeStoredPreference(WIDTH_KEY, String(w));
      return w;
    });
  };

  // Ctrl+Alt+B（⌘⌥B）收起 / 展开面板卡。只在面板栏存在的宽度（≥1280px）生效。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, PANEL_RAIL_HOTKEY)) return;
      if (!window.matchMedia("(min-width: 1280px)").matches) return;
      event.preventDefault();
      togglePanelRail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const wide = useWideForRail();
  const sheetOpen = usePanelSheetOpen();
  // 关掉抽屉后窗口又变宽：抽屉的状态不带过去。
  useEffect(() => {
    if (wide) setPanelSheetOpen(false);
  }, [wide]);

  /*
   * 右栏 = 「面板 | 计算机」两个标签（DESIGN.md §23）。计算机是否打开仍由聊天页的 `watch` 参数决定，
   * 这里只负责：它一打开就把右栏亮出来（宽窗口展开面板卡，窄窗口拉出抽屉）；收起右栏时顺手关掉计算机，
   * 免得地址栏说开着、屏幕上却看不见。
   */
  const chat = useCurrentBotChat();
  const computerOn = Boolean(chat?.canComputer && chat.computerOpen);
  useEffect(() => {
    if (!computerOn) return;
    if (wide) setPanelRailOpen(true);
    else setPanelSheetOpen(true);
  }, [computerOn, wide]);
  const latestChat = useRef(chat);
  latestChat.current = chat;
  /*
   * 机器人刚建了一张面板（新 id、正在搭建）：右栏切到「面板」并亮出来，像 Hark 一样让人看着它搭起来。
   * 第一次加载时已有的卡片不算。
   */
  const { botId: railBotId } = usePanelBot();
  const live = useLivePanels(railBotId);
  const seenPanels = useRef<{ bot?: string; ids: Set<string> } | null>(null);
  useEffect(() => {
    const items = live.data;
    if (!items || !railBotId) return;
    const seen = seenPanels.current;
    if (!seen || seen.bot !== railBotId) {
      seenPanels.current = { bot: railBotId, ids: new Set(items.map((p) => p.id)) };
      return;
    }
    const fresh = items.filter((p) => !seen.ids.has(p.id));
    for (const p of items) seen.ids.add(p.id);
    if (!fresh.some((p) => p.status === "building")) return;
    const current = latestChat.current;
    if (current?.canComputer && current.computerOpen) current.toggleComputer();
    if (wide) setPanelRailOpen(true);
    else setPanelSheetOpen(true);
  }, [live.data, railBotId, wide]);
  const closeComputer = useCallback(() => {
    const current = latestChat.current;
    if (current?.canComputer && current.computerOpen) current.toggleComputer();
  }, []);
  const collapseWide = useCallback(() => {
    closeComputer();
    setPanelRailOpen(false);
  }, [closeComputer]);
  const closeSheet = useCallback(() => {
    closeComputer();
    setPanelSheetOpen(false);
  }, [closeComputer]);

  if (!wide) {
    // 窄窗口（< 1280px）：没有右侧栏的位置，面板改成右边缘把手 + 滑出的抽屉，入口一直在。
    return (
      <>
        {sheetOpen ? null : (
          <ToggleTip label={"打开面板"} side="left">
            <button
              aria-controls={"chisabot-panel-sheet"}
              aria-expanded={false}
              aria-label={"打开面板"}
              className="rail-tab is-narrow"
              onClick={() => setPanelSheetOpen(true)}
              type="button"
            >
              <IconLayoutSidebarRightExpand className="size-4" />
              <span className="rail-tab-t">{"面板"}</span>
            </button>
          </ToggleTip>
        )}
        <Sheet
          onOpenChange={(next) => (next ? setPanelSheetOpen(true) : closeSheet())}
          open={sheetOpen}
        >
          <SheetContent
            className="glass-drawer rail-sheet gap-0 p-3 data-[side=right]:sm:max-w-[420px] data-[side=right]:w-[min(420px,100vw)]"
            id="chisabot-panel-sheet"
            showCloseButton={false}
            side="right"
          >
            <SheetTitle className="sr-only">{computerOn ? "计算机" : "自定义面板"}</SheetTitle>
            <SheetDescription className="sr-only">{"当前机器人的自定义面板和计算机"}</SheetDescription>
            <section className="rail-card flex h-full min-h-0 flex-col">
              <PanelRailBody onCollapse={closeSheet} />
            </section>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
    <PanelRailHandle open={open} />
    <aside
      aria-hidden={open ? undefined : true}
      aria-label={"自定义面板栏"}
      className={cn(
        "glass-rail relative hidden h-full min-h-0 shrink-0 flex-col pr-4 pb-4 pl-2 xl:flex",
        dragging && "select-none is-dragging",
        !open && "is-collapsed",
        className,
      )}
      data-state={open ? "expanded" : "collapsed"}
      id="chisabot-panel-rail"
      inert={!open}
      // Collapsed = zero width and no side padding; the inner column keeps its width, so it slides
      // off the right edge (clipped by .glass-body) instead of reflowing while it narrows.
      style={open ? { width } : { width: 0, paddingLeft: 0, paddingRight: 0 }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: a draggable splitter has no native element. */}
      <div
        aria-label={"拖动调整面板栏宽度"}
        aria-orientation="vertical"
        aria-valuemax={MAX_WIDTH}
        aria-valuemin={MIN_WIDTH}
        aria-valuenow={width}
        className={cn("glass-rail-handle", dragging && "is-dragging")}
        onDoubleClick={() => {
          setWidth(DEFAULT_WIDTH);
          writeStoredPreference(WIDTH_KEY, String(DEFAULT_WIDTH));
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const next = Math.min(
            MAX_WIDTH,
            Math.max(MIN_WIDTH, width + (event.key === "ArrowLeft" ? 20 : -20)),
          );
          setWidth(next);
          writeStoredPreference(WIDTH_KEY, String(next));
        }}
        onPointerCancel={onPointerUp}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
        tabIndex={0}
      />
      {dragging ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
      {/* DESIGN-v4：面板栏是一张独立的玻璃卡；标题、面板库、新建、收起都在卡片自己的头部里。 */}
      <section className="glass-card glass-rail-inner rail-card flex h-full min-h-0 flex-col" style={{ width: width - 24 }}>
        <PanelRailBody onCollapse={collapseWide} />
      </section>
    </aside>
    </>
  );
}

/**
 * 面板卡收起后留在右边缘的小把手（竖排「面板」）：收起的东西在它原来的位置留下痕迹，点它展开。
 * 面板卡展开时不渲染。
 */
function PanelRailHandle({ open }: { open: boolean }) {
  if (open) return null;
  return (
    <ToggleTip keys={PANEL_RAIL_HOTKEY_LABEL} label={"展开面板"} side="left">
      <button
        aria-controls={"chisabot-panel-rail"}
        aria-expanded={false}
        aria-label={"展开面板"}
        className="rail-tab hidden xl:flex"
        onClick={() => setPanelRailOpen(true)}
        type="button"
      >
        <IconLayoutSidebarRightExpand className="size-4" />
        <span className="rail-tab-t">{"面板"}</span>
      </button>
    </ToggleTip>
  );
}

function PanelRailBody({ onCollapse }: { onCollapse?: () => void } = {}) {
  const { botId, routeBotId } = usePanelBot();
  const chat = useCurrentBotChat();
  const canComputer = Boolean(chat?.canComputer);
  const tab: RailTab = canComputer && chat?.computerOpen ? "computer" : "panels";
  const agents = useQuery(agentListQueryOptions());
  const bot = agents.data?.find((a) => a.id === botId);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const list = useQuery({
    ...panelListQueryOptions(botId ?? ""),
    enabled: Boolean(botId),
  });
  const canManage = list.data?.canManage ?? false;
  const session = useQuery(panelSessionQueryOptions(botId ?? "", Boolean(botId) && canManage));

  const begin = useMutation({
    mutationFn: (target?: string) => panelsApi.begin(botId as string, target),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: panelKeys.session(botId as string) });
      // Only jump to a fresh chat when not already talking to this Bot.
      if (routeBotId !== botId)
        await navigate({ to: "/channel/new", search: { agent: botId } });
    },
    onError: (e) => setError(panelErrorText(e)),
  });
  const cancel = useMutation({
    mutationFn: (sessionId: string) =>
      panelsApi.cancel(botId as string, sessionId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: panelKeys.session(botId as string) }),
    onError: (e) => setError(panelErrorText(e)),
  });

  const beginState = useMutationFeedback(begin);
  useEffect(() => setError(null), [botId]);

  const items = list.data?.items ?? [];
  const liveList = useLivePanels(botId);

  // 用户明确要的面板由 BOT 直接保存进面板栏，创作会话随之结束。会话结束时刷新列表，并给刚放进来的
  // 新面板一个「撤销」（删除它）。编辑已有面板不提供撤销，卡片菜单里仍可删除。
  const sessionOpen = Boolean(session.data);
  const idsAtSessionStart = useRef<Set<string> | null>(null);
  const [justSaved, setJustSaved] = useState<PanelInstance | null>(null);
  const savedAwaitingList = useRef(false);
  useEffect(() => {
    if (sessionOpen) {
      if (!idsAtSessionStart.current)
        idsAtSessionStart.current = new Set(items.map((i) => i.id));
      return;
    }
    if (idsAtSessionStart.current) {
      savedAwaitingList.current = true;
      void queryClient.invalidateQueries({ queryKey: panelKeys.list(botId as string) });
    }
    // items deliberately excluded: only the open/closed transition matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionOpen]);
  useEffect(() => {
    if (!savedAwaitingList.current || list.isFetching || !idsAtSessionStart.current) return;
    const before = idsAtSessionStart.current;
    savedAwaitingList.current = false;
    idsAtSessionStart.current = null;
    setJustSaved(items.find((i) => !before.has(i.id)) ?? null);
  }, [items, list.isFetching]);
  useEffect(() => {
    setJustSaved(null);
    idsAtSessionStart.current = null;
  }, [botId]);
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(null), 12000);
    return () => window.clearTimeout(t);
  }, [justSaved]);
  const undo = useMutation({
    mutationFn: (instance: PanelInstance) =>
      panelsApi.remove(instance.botId, instance.id, instance.instanceVersion),
    onSuccess: async () => {
      setJustSaved(null);
      await queryClient.invalidateQueries({ queryKey: panelKeys.list(botId as string) });
    },
    onError: (e) => setError(panelErrorText(e)),
  });
  const undoState = useMutationFeedback(undo);

  return (
    <>
      <header className="rail-head">
        {canComputer && chat ? (
          <RailSwitch
            needsYou={chat.needsYou && tab !== "computer"}
            onChange={(next) => {
              if (next !== tab) chat.toggleComputer();
            }}
            tab={tab}
          />
        ) : (
          <h2 className="rail-head-t">{"面板"}</h2>
        )}
        <span className="flex-1" />
        {tab === "panels" ? (
        <>
        <button
          aria-label={"面板库"}
          className={cn("rail-head-btn", canComputer && "is-compact")}
          disabled={!botId}
          onClick={() => setLibraryOpen(true)}
          title={"面板库"}
          type="button"
        >
          <IconBooks className="size-4" />
          <span className="rail-head-btn-t">{"面板库"}</span>
        </button>
        <button
          aria-busy={beginState === "pending" || undefined}
          className={cn("rail-head-btn async-raw", canComputer && "is-compact")}
          data-btn-state={beginState}
          disabled={!botId || !canManage || begin.isPending || Boolean(session.data)}
          onClick={() => begin.mutate(undefined)}
          title={botId && list.data && !canManage ? "管理面板需要 BOT 所有者或管理员权限" : "让 BOT 创建一个新面板"}
          type="button"
        >
          <AsyncContent
            labels={{ pending: "打开中…", success: "已开始", error: "打开失败" }}
            state={beginState}
          >
            <IconPlus className="size-4" />
            {"新建"}
          </AsyncContent>
        </button>
        </>
        ) : null}
        <span aria-hidden className="rail-head-div" />
        <ToggleTip keys={PANEL_RAIL_HOTKEY_LABEL} label={"收起右栏"} side="bottom">
          <button
            aria-controls={"chisabot-panel-rail"}
            aria-expanded={true}
            aria-label={"收起右栏"}
            className="rail-head-icon"
            onClick={() => (onCollapse ? onCollapse() : setPanelRailOpen(false))}
            type="button"
          >
            <IconLayoutSidebarRightCollapse className="size-[18px]" />
          </button>
        </ToggleTip>
      </header>

      <div
        aria-hidden={tab !== "panels" || undefined}
        className="rail-pane flex min-h-0 flex-1 flex-col gap-[10px]"
        data-active={tab === "panels"}
        hidden={tab !== "panels"}
      >
      {error ? (
        <p className="px-2 text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {justSaved && !session.data ? (
        <div className="glass-card panel-saved-note shrink-0 flex items-center gap-2 px-4 py-3 text-sm" role="status">
          <IconCheck className="size-4 shrink-0 text-emerald-600" />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span>{"已放进面板栏"}</span>
            <span className="truncate text-muted-foreground text-xs">{justSaved.definition.name}</span>
          </span>
          <button
            aria-busy={undoState === "pending" || undefined}
            className="glass-pill async-raw rounded-full px-3 py-1 text-xs"
            data-btn-state={undoState}
            disabled={undo.isPending}
            onClick={() => undo.mutate(justSaved)}
            type="button"
          >
            <AsyncContent labels={{ pending: "撤销中…", success: "已撤销", error: "撤销失败" }} state={undoState}>
              {"撤销"}
            </AsyncContent>
          </button>
          <button
            aria-label={"关闭提示"}
            className="rail-head-icon size-6"
            onClick={() => setJustSaved(null)}
            type="button"
          >
            <IconX className="size-3.5" />
          </button>
        </div>
      ) : null}

      {session.data ? (
        <div className="glass-card shrink-0 space-y-2 p-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="size-2 animate-pulse rounded-full bg-sky-500" />
            <strong>
              {session.data.targetInstanceId ? "正在编辑面板" : "正在创建面板"}
            </strong>
          </div>
          {session.data.draft ? (
            <p className="text-muted-foreground text-xs">
              {session.data.draft.definition.name}
              {" · 草稿 v"}
              {session.data.draft.draftRevision}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              {"在对话中告诉 BOT 您要什么，做好后会直接放进面板栏。"}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {session.data.draft ? (
              <button
                className="glass-dark rounded-full px-3 py-1.5 text-xs"
                onClick={() => setDraftId(session.data?.draft?.id ?? null)}
                type="button"
              >
                {"预览与保存"}
              </button>
            ) : null}
            <button
              className="glass-pill rounded-full px-3 py-1.5 text-xs"
              disabled={cancel.isPending}
              onClick={() => session.data && cancel.mutate(session.data.sessionId)}
              type="button"
            >
              {"取消创作"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="glass-rail-scroll relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        {!botId ? (
          <RailNote>{"还没有可用的 BOT。"}</RailNote>
        ) : list.isPending ? (
          <RailNote>{"加载面板…"}</RailNote>
        ) : list.isError ? (
          <div className="glass-card space-y-2 p-4 text-sm" role="alert">
            <p>{"面板无法加载，聊天仍可使用。"}</p>
            <p className="text-muted-foreground text-xs">
              {panelErrorText(list.error)}
            </p>
            <button
              className="glass-pill rounded-full px-3 py-1.5 text-xs"
              onClick={() => list.refetch()}
              type="button"
            >
              {"重试"}
            </button>
          </div>
        ) : (
          <>
          {/* 实时面板（机器人在对话里做的、会自己刷新的卡片）排在最前。 */}
          <LivePanelList botId={botId} />
          {items.length === 0 ? (
          (liveList.data?.length ?? 0) === 0 ? (
          <p className="rail-empty">
            {"还没有面板。在对话里说一句，比如「帮我做一个比特币价格面板」，机器人会做好放在这里并按时刷新；也可以点「新建」或从面板库安装。"}
          </p>
          ) : null
        ) : (
          <PresenceList>
            {items.map((instance) => (
              <PresenceItem key={instance.id}>
                <PanelCard
                  canManage={canManage}
                  instance={instance}
                  key={`${instance.id}:${instance.instanceVersion}`}
                  onEdit={() => begin.mutate(instance.id)}
                  onError={setError}
                />
              </PresenceItem>
            ))}
          </PresenceList>
        )}
          </>
        )}
      </div>
      </div>

      {canComputer && chat ? (
        <RailComputerPane active={tab === "computer"} agentId={chat.agentId} fallbackName={chat.fallbackName} />
      ) : null}

      {botId ? (
        <PanelLibrary
          botId={botId}
          botName={bot?.name}
          canManage={canManage}
          installed={items}
          onOpenChange={setLibraryOpen}
          open={libraryOpen}
        />
      ) : null}
      {botId && draftId ? (
        <DraftPreview
          botId={botId}
          draftId={draftId}
          onClose={() => setDraftId(null)}
        />
      ) : null}
    </>
  );
}

type RailTab = "panels" | "computer";

/** 右栏顶部的「面板 | 计算机」分段切换（sg-segmented，与设置页同一套）。 */
function RailSwitch({
  tab,
  onChange,
  needsYou,
}: {
  tab: RailTab;
  onChange: (tab: RailTab) => void;
  needsYou: boolean;
}) {
  const item = (value: RailTab, label: string, icon: React.ReactNode) => (
    <button
      aria-checked={tab === value}
      className="sg-segmented-item rail-tabs-item"
      onClick={() => onChange(value)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onChange(value === "panels" ? "computer" : "panels");
        }
      }}
      role="radio"
      tabIndex={tab === value ? 0 : -1}
      type="button"
    >
      {icon}
      {label}
      {value === "computer" && needsYou ? (
        <span aria-label={"需要你"} className="rail-tabs-dot" role="img" />
      ) : null}
    </button>
  );
  return (
    <div aria-label={"右栏内容"} className="sg-segmented rail-tabs" data-tab={tab} role="radiogroup">
      <span aria-hidden className="rail-tabs-thumb" />
      {item("panels", "面板", <IconLayoutGrid className="size-[15px]" />)}
      {item("computer", "计算机", <IconDeviceDesktop className="size-[15px]" />)}
    </div>
  );
}

/**
 * 「计算机」标签的内容。第一次切过来才挂载，之后切回「面板」只是隐藏、不卸载：接管状态、
 * 展开的大屏、活动列表都还在；隐藏时画面不可见，截图轮询会自己停（useElementVisible）。
 * 换了机器人就换一份。
 */
function RailComputerPane({
  active,
  agentId,
  fallbackName,
}: {
  active: boolean;
  agentId: string;
  fallbackName?: string;
}) {
  const agents = useQuery(agentListQueryOptions());
  const name = agents.data?.find((a) => a.id === agentId)?.name ?? fallbackName;
  const [mountedFor, setMountedFor] = useState<string | null>(active ? agentId : null);
  useEffect(() => {
    if (active) setMountedFor(agentId);
  }, [active, agentId]);
  if (mountedFor !== agentId) return null;
  return (
    <div
      aria-hidden={!active || undefined}
      className="rail-pane glass-rail-scroll flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-active={active}
      hidden={!active}
    >
      <ComputerViewPanel agentId={agentId} name={name} variant="rail" />
    </div>
  );
}

function RailNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="glass-card p-4 text-muted-foreground text-sm">{children}</p>
  );
}

function usePanelBridge(instance: PanelInstance): PanelFrameBridge {
  return useMemo(() => {
    let revision: number | null = null;
    return {
      stateRead: async (signal) => {
        const s = await panelsApi.state(instance.botId, instance.id, signal);
        revision = s.stateRevision;
        if (s.requiresReset) throw new Error("state_reset_required");
        return s.value;
      },
      stateWrite: async (value: Json, signal) => {
        if (revision === null)
          revision = (await panelsApi.state(instance.botId, instance.id, signal))
            .stateRevision;
        await panelsApi.writeState(
          instance.botId,
          instance.id,
          { instanceVersion: instance.instanceVersion, stateRevision: revision, value },
          signal,
        );
        revision += 1;
      },
      dataRead: (capabilityId, args, signal) =>
        panelsApi.data(instance, capabilityId, args, signal),
      taskRequest: async (capabilityId, args, signal) => {
        const task = await panelsApi.requestTask(instance, capabilityId, args, signal);
        return { requestId: task.id };
      },
    };
  }, [instance]);
}

function PanelCard({
  instance,
  canManage,
  onEdit,
  onError,
}: {
  instance: PanelInstance;
  canManage: boolean;
  onEdit: () => void;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const bridge = usePanelBridge(instance);
  const [reload, setReload] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [showCaps, setShowCaps] = useState(false);
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: panelKeys.list(instance.botId) });

  const layout = useMutation({
    mutationFn: (collapsed: boolean) =>
      panelsApi.layout(instance.botId, instance.id, {
        expectedVersion: instance.instanceVersion,
        collapsed,
      }),
    onSuccess: invalidate,
    onError: (e) => onError(panelErrorText(e)),
  });
  // 乐观移除（DESIGN.md §34.6）：确认后卡片立刻淡出、下面的补位；失败放回并提示。
  const remove = useMutation({
    mutationFn: () =>
      panelsApi.remove(instance.botId, instance.id, instance.instanceVersion),
    onMutate: async () => {
      const key = panelKeys.list(instance.botId);
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (old: { items?: PanelInstance[] } | undefined) =>
        old?.items ? { ...old, items: old.items.filter((i) => i.id !== instance.id) } : old,
      );
      return { before };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.before) queryClient.setQueryData(panelKeys.list(instance.botId), ctx.before);
      onError(panelErrorText(e));
    },
    onSuccess: () => toast.success(`已移除「${instance.title}」`),
    onSettled: invalidate,
  });
  const tasks = useQuery({
    queryKey: panelKeys.tasks(instance.botId, instance.id),
    queryFn: () => panelsApi.tasks(instance.botId, instance.id),
    enabled: instance.definition.manifest.tasks.length > 0 && !instance.collapsed,
    refetchInterval: 8000,
  });
  const pendingTasks = (tasks.data ?? []).filter((t) =>
    ["pending", "waiting", "unknown"].includes(t.status),
  );
  const taskAction = useMutation({
    mutationFn: (input: { id: string; action: "confirm" | "cancel" }) =>
      panelsApi.taskAction(instance.botId, input.id, input.action),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: panelKeys.tasks(instance.botId, instance.id),
      }),
    onError: (e) => onError(panelErrorText(e)),
  });

  const capabilities = [
    ...instance.definition.manifest.data,
    ...instance.definition.manifest.tasks,
  ];

  return (
    <section
      aria-label={`${instance.title} 面板`}
      className="glass-card group/panel shrink-0 p-4"
    >
      <div className="mb-2 flex items-center gap-2.5">
        <div className="grid size-7 shrink-0 place-items-center rounded-[9px] bg-white/90 font-bold text-[11px] text-sky-600 shadow-sm dark:bg-white/10">
          {instance.title.slice(0, 1)}
        </div>
        <b className="min-w-0 flex-1 truncate font-semibold text-sm">
          {instance.title}
        </b>
        <div className="flex items-center gap-0.5 text-muted-foreground opacity-70 transition-opacity group-hover/panel:opacity-100">
          <button
            aria-label={instance.collapsed ? "展开面板" : "折叠面板"}
            className="grid size-7 place-items-center rounded-lg hover:bg-white/60 dark:hover:bg-white/10"
            disabled={!canManage || layout.isPending}
            onClick={() => layout.mutate(!instance.collapsed)}
            type="button"
          >
            {instance.collapsed ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronUp className="size-4" />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  aria-label={`${instance.title} 面板操作`}
                  className="grid size-7 place-items-center rounded-lg hover:bg-white/60 dark:hover:bg-white/10"
                  type="button"
                />
              }
            >
              <IconDots className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40 p-1.5">
              <DropdownMenuItem
                className="gap-2"
                onClick={() => {
                  setRuntimeError(null);
                  setReload((n) => n + 1);
                }}
              >
                <IconRefresh className="size-4" />
                {"重新加载"}
              </DropdownMenuItem>
              {capabilities.length > 0 ? (
                <DropdownMenuItem className="gap-2" onClick={() => setShowCaps((v) => !v)}>
                  <IconAdjustments className="size-4" />
                  {"能力与授权"}
                </DropdownMenuItem>
              ) : null}
              {canManage ? (
                <>
                  <DropdownMenuItem className="gap-2" onClick={onEdit}>
                    <IconPencil className="size-4" />
                    {"让 BOT 修改"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => {
                      void confirmDialog({
                        title: "移除此面板？",
                        description: "只会从这个 BOT 上移除，面板库中的副本继续保留。",
                        confirmLabel: "移除",
                        destructive: true,
                      }).then((ok) => {
                        if (ok) remove.mutate();
                      });
                    }}
                    variant="destructive"
                  >
                    <IconTrash className="size-4" />
                    {"移除面板"}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {runtimeError ? (
        <p className="mb-2 rounded-xl bg-amber-500/10 px-3 py-2 text-amber-700 text-xs dark:text-amber-400" role="alert">
          {panelErrorText(new Error(runtimeError))}
        </p>
      ) : null}
      {instance.collapsed ? null : (
        <PanelFrame
          bridge={bridge}
          definition={instance.definition}
          key={reload}
          onError={setRuntimeError}
        />
      )}
      {showCaps ? (
        <CapabilityList instance={instance} onError={onError} />
      ) : null}
      {pendingTasks.length > 0 ? (
        <div className="mt-2 space-y-2">
          {pendingTasks.map((task) => (
            <div className="glass-tile flex items-center gap-2 px-3 py-2 text-xs" key={task.id}>
              <span className="min-w-0 flex-1 truncate">
                {task.status === "pending" ? "待确认任务：" : "任务状态未知："}
                {task.capabilityId}
              </span>
              {task.status === "pending" ? (
                <button
                  className="glass-dark rounded-full px-2.5 py-1"
                  disabled={taskAction.isPending}
                  onClick={() => taskAction.mutate({ id: task.id, action: "confirm" })}
                  type="button"
                >
                  {"确认"}
                </button>
              ) : null}
              <button
                className="rounded-full px-2.5 py-1 hover:bg-white/60"
                disabled={taskAction.isPending}
                onClick={() => taskAction.mutate({ id: task.id, action: "cancel" })}
                type="button"
              >
                {"取消"}
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-2.5 flex justify-between px-0.5 text-xs text-muted-foreground">
        <span>
          {"面板 v"}
          {instance.instanceVersion}
          {instance.sourceVersion ? ` · 库 v${instance.sourceVersion}` : ""}
        </span>
        <span>{instance.definition.name}</span>
      </div>
    </section>
  );
}

function CapabilityList({
  instance,
  onError,
}: {
  instance: PanelInstance;
  onError: (message: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const grants = useQuery({
    queryKey: panelKeys.grants(instance.botId, instance.id),
    queryFn: () => panelsApi.grants(instance.botId, instance.id),
  });
  const granted = new Set((grants.data ?? []).map((g) => g.capabilityId));
  const toggle = useMutation({
    mutationFn: async (input: { id: string; on: boolean }) =>
      input.on
        ? panelsApi.grant(instance.botId, instance.id, input.id, instance.instanceVersion)
        : panelsApi.revoke(instance.botId, instance.id, input.id),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: panelKeys.grants(instance.botId, instance.id),
      }),
    onError: (e) => onError(panelErrorText(e)),
  });
  const caps = [
    ...instance.definition.manifest.data,
    ...instance.definition.manifest.tasks,
  ];
  return (
    <div className="mt-2 space-y-1.5">
      {caps.map((cap) => {
        const on = granted.has(cap.id);
        return (
          <div className="glass-tile flex items-center gap-2 px-3 py-2 text-xs" key={cap.id}>
            <span className="min-w-0 flex-1 truncate">
              {cap.adapter}/{cap.action}
              <span className="ml-1 text-muted-foreground">
                {cap.effect === "write" ? "（写入）" : "（读取）"}
              </span>
            </span>
            <button
              className={cn(
                "rounded-full px-2.5 py-1",
                on ? "hover:bg-white/60" : "glass-dark",
              )}
              disabled={toggle.isPending || grants.isPending}
              onClick={() => {
                if (on) {
                  toggle.mutate({ id: cap.id, on: !on });
                  return;
                }
                void confirmDialog({
                  title: "批准此权限？",
                  description: `面板「${instance.title}」将可以使用 ${cap.adapter}/${cap.action}，范围为当前用户和此 BOT。`,
                  confirmLabel: "批准",
                }).then((ok) => {
                  if (ok) toggle.mutate({ id: cap.id, on: true });
                });
              }}
              type="button"
            >
              {on ? "撤销" : "批准"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function PanelLibrary({
  botId,
  botName,
  canManage,
  installed,
  open,
  onOpenChange,
}: {
  botId: string;
  botName?: string;
  canManage: boolean;
  installed: PanelInstance[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const library = useQuery({ ...panelLibraryQueryOptions(botId), enabled: open });
  const [tab, setTab] = useState<"all" | "mine">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const installedSources = new Set(
    installed.map((i) => `${i.sourceLibraryId}:${i.sourceVersion}`),
  );
  const install = useMutation({
    mutationFn: (entry: PanelLibraryEntry) => {
      const k = `${entry.id}:${entry.version}`;
      if (!keys.current.has(k)) keys.current.set(k, crypto.randomUUID());
      return panelsApi.install(botId, {
        libraryId: entry.id,
        libraryVersion: entry.version,
        idempotencyKey: keys.current.get(k) as string,
      });
    },
    onSuccess: async (_r, entry) => {
      keys.current.delete(`${entry.id}:${entry.version}`);
      await queryClient.invalidateQueries({ queryKey: panelKeys.list(botId) });
    },
    onError: (e) => setError(panelErrorText(e)),
  });
  const archive = useMutation({
    mutationFn: (entry: PanelLibraryEntry) =>
      panelsApi.archive(botId, entry.id, entry.version),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: panelKeys.library(botId) }),
    onError: (e) => setError(panelErrorText(e)),
  });
  const needle = search.trim().toLowerCase();
  const items = (library.data?.items ?? [])
    .filter((e) => (tab === "mine" ? e.canManage : true))
    .filter((e) => !needle || e.definition.name.toLowerCase().includes(needle));

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent
        className="glass-drawer gap-3.5 p-5 data-[side=right]:sm:max-w-[440px] data-[side=right]:w-[min(440px,100vw)]"
        side="right"
      >
        <div className="flex items-baseline gap-2 pr-10">
          <SheetTitle className="font-semibold text-lg">{"面板库"}</SheetTitle>
          <SheetDescription className="text-xs">
            {"安装到 "}
            {botName ?? "当前 BOT"}
          </SheetDescription>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-full bg-foreground/5 px-4 text-muted-foreground">
          <IconSearch className="size-4" />
          <input
            aria-label={"搜索面板"}
            className="h-full min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={"搜索面板…"}
            value={search}
          />
        </label>
        <div className="flex gap-1.5">
          {(
            [
              ["all", "共用面板库"],
              ["mine", "我的面板"],
            ] as const
          ).map(([value, label]) => (
            <button
              className={cn(
                "rounded-full px-3.5 py-1.5 text-[13px]",
                tab === value ? "glass-dark" : "bg-foreground/5",
              )}
              key={value}
              onClick={() => setTab(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 pb-2">
          {library.isPending ? (
            <p className="text-muted-foreground text-sm">{"加载面板库…"}</p>
          ) : library.isError ? (
            <p className="text-destructive text-sm">{panelErrorText(library.error)}</p>
          ) : items.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-muted-foreground text-sm">
              {needle ? "没有匹配的面板。" : "面板库为空，先让 BOT 创建一个面板。"}
            </p>
          ) : (
            items.map((entry) => {
              const done = installedSources.has(`${entry.id}:${entry.version}`);
              return (
                <div className="glass-li flex items-center gap-3 p-3.5" key={entry.id}>
                  <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-sky-100 to-slate-50 font-semibold text-sky-700 dark:from-sky-900/40 dark:to-slate-800/40 dark:text-sky-300">
                    {entry.definition.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <b className="block truncate font-semibold text-sm">
                      {entry.definition.name}
                    </b>
                    <p className="text-muted-foreground text-xs">
                      {"v"}
                      {entry.version}
                      {" · 能力 "}
                      {entry.definition.manifest.data.length +
                        entry.definition.manifest.tasks.length}
                      {" 项"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      className={cn(
                        "rounded-full px-3.5 py-1.5 text-[13px]",
                        done ? "bg-foreground/5 text-muted-foreground" : "glass-dark",
                      )}
                      disabled={!canManage || install.isPending}
                      onClick={() => install.mutate(entry)}
                      type="button"
                    >
                      {done ? "再装一份" : "安装"}
                    </button>
                    {entry.canManage && canManage ? (
                      <button
                        className="text-xs text-muted-foreground hover:text-destructive"
                        disabled={archive.isPending}
                        onClick={() => {
                          void confirmDialog({
                            title: "归档此库项？",
                            description: "已安装到各 BOT 的副本会继续保留。",
                            confirmLabel: "归档",
                            destructive: true,
                          }).then((ok) => {
                            if (ok) archive.mutate(entry);
                          });
                        }}
                        type="button"
                      >
                        {"归档"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <p className="text-center text-muted-foreground text-xs">
          {"每次安装复制固定版本；库更新不会改变已安装面板。"}
        </p>
      </SheetContent>
    </Sheet>
  );
}

function DraftPreview({
  botId,
  draftId,
  onClose,
}: {
  botId: string;
  draftId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const draft = useQuery({
    queryKey: panelKeys.draft(botId, draftId),
    queryFn: () => panelsApi.draft(botId, draftId),
  });
  const [error, setError] = useState<string | null>(null);
  const idempotency = useRef<{ mode: string; key: string } | null>(null);
  const commit = useMutation({
    mutationFn: async (input: {
      draft: PanelDraft;
      mode: "first" | "instance" | "new-library";
      resetState: boolean;
    }) => {
      if (idempotency.current?.mode !== input.mode)
        idempotency.current = { mode: input.mode, key: crypto.randomUUID() };
      const d = input.draft;
      return panelsApi.commit(botId, {
        draftId: d.id,
        expectedDraftRevision: d.draftRevision,
        mode: input.mode,
        idempotencyKey: idempotency.current.key,
        resetState: input.resetState,
        ...(d.baseInstanceVersion !== null
          ? { baseInstanceVersion: d.baseInstanceVersion }
          : {}),
        ...(d.baseLibraryVersion !== null
          ? { baseLibraryVersion: d.baseLibraryVersion }
          : {}),
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: panelKeys.list(botId) }),
        queryClient.invalidateQueries({ queryKey: panelKeys.library(botId) }),
        queryClient.invalidateQueries({ queryKey: panelKeys.session(botId) }),
      ]);
      onClose();
    },
    onError: (e, input) => {
      if (
        e instanceof Error &&
        e.message === "state_reset_required" &&
        !input.resetState
      ) {
        void confirmDialog({
          title: "需要重置状态",
          description: "此版本与你的面板状态不兼容。确认只重置你自己的状态并保存面板？",
          confirmLabel: "重置并保存",
          destructive: true,
        }).then((ok) => {
          if (ok) commit.mutate({ ...input, resetState: true });
          else setError(panelErrorText(e));
        });
        return;
      }
      setError(panelErrorText(e));
    },
  });
  const d = draft.data;
  const bridge = useMemo(
    () => previewBridge((d?.definition.initialState ?? null) as Json),
    [d],
  );
  const commitState = useMutationFeedback(commit, commit.variables?.mode !== "new-library");
  const forkState = useMutationFeedback(commit, commit.variables?.mode === "new-library");
  const save = useCallback(
    (mode: "first" | "instance" | "new-library") =>
      d && commit.mutate({ draft: d, mode, resetState: false }),
    [d, commit],
  );

  return (
    <Sheet onOpenChange={(o) => (o ? null : onClose())} open>
      <SheetContent
        className="glass-drawer gap-3 overflow-y-auto p-5 data-[side=right]:sm:max-w-[480px] data-[side=right]:w-[min(480px,100vw)]"
        side="right"
      >
        <SheetTitle className="pr-10 font-semibold text-lg">{"面板草稿预览"}</SheetTitle>
        <SheetDescription className="text-xs">
          {"示例数据和临时状态；保存后能力仍需单独批准。"}
        </SheetDescription>
        {draft.isPending ? (
          <p className="text-muted-foreground text-sm">{"加载草稿…"}</p>
        ) : draft.isError || !d ? (
          <p className="text-destructive text-sm">{panelErrorText(draft.error)}</p>
        ) : (
          <>
            <div className="glass-card p-4">
              <div className="mb-2 flex items-center justify-between">
                <b className="text-sm">{d.definition.name}</b>
                <span className="text-muted-foreground text-xs">
                  {"草稿 v"}
                  {d.draftRevision}
                </span>
              </div>
              {d.status === "ready" ? (
                <PanelFrame bridge={bridge} definition={d.definition} onError={setError} />
              ) : (
                <p className="text-sm">
                  {d.status === "cancelled" ? "创作已取消。" : "面板已保存。"}
                </p>
              )}
            </div>
            {error ? (
              <p className="text-destructive text-xs" role="alert">
                {error}
              </p>
            ) : null}
            {d.status === "ready" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  aria-busy={commitState === "pending" || undefined}
                  className="glass-dark async-raw inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"
                  data-btn-state={commitState}
                  disabled={commit.isPending}
                  onClick={() => save(d.targetInstanceId ? "instance" : "first")}
                  type="button"
                >
                  <AsyncContent labels={FEEDBACK_PRESETS.save} state={commitState}>
                    {d.targetInstanceId ? "保存此 BOT 面板" : "保存到库并安装"}
                  </AsyncContent>
                </button>
                {d.targetInstanceId ? (
                  <button
                    aria-busy={forkState === "pending" || undefined}
                    className="glass-pill async-raw inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm"
                    data-btn-state={forkState}
                    disabled={commit.isPending}
                    onClick={() => save("new-library")}
                    type="button"
                  >
                    <AsyncContent labels={FEEDBACK_PRESETS.save} state={forkState}>
                      {"另存为新库项"}
                    </AsyncContent>
                  </button>
                ) : null}
                <button
                  className="rounded-full px-4 py-2 text-sm hover:bg-foreground/5"
                  onClick={onClose}
                  type="button"
                >
                  <IconX className="mr-1 inline size-4" />
                  {"关闭"}
                </button>
              </div>
            ) : null}
            {d.definition.manifest.data.length + d.definition.manifest.tasks.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {"申请能力："}
                {[...d.definition.manifest.data, ...d.definition.manifest.tasks]
                  .map((c) => `${c.adapter}/${c.action}`)
                  .join("、")}
                {"。保存后仍需单独批准，任务需逐次确认。"}
              </p>
            ) : null}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
