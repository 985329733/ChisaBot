import { FEEDBACK_PRESETS, useMutationFeedback } from "@/components/ui/async-action";
import { AsyncContent } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import {
  IconAdjustments,
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconLayoutGrid,
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
import { usePanelRailOpen } from "@/lib/panels/rail-open";
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

  return (
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
      <div className="glass-rail-inner flex h-full min-h-0 flex-col gap-3" style={{ width: width - 24 }}>
        <PanelRailBody />
      </div>
    </aside>
  );
}

function PanelRailBody() {
  const { botId, routeBotId } = usePanelBot();
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

  return (
    <>
      <header className="flex h-10 shrink-0 items-center gap-2 px-1">
        <h2 className="font-semibold text-[15px] tracking-tight">{"自定义面板"}</h2>
        <span className="flex-1" />
        <button
          className="glass-pill flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px]"
          disabled={!botId}
          onClick={() => setLibraryOpen(true)}
          type="button"
        >
          <IconLayoutGrid className="size-4" />
          {"面板库"}
        </button>
      </header>

      {error ? (
        <p className="px-2 text-destructive text-xs" role="alert">
          {error}
        </p>
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
              {"在对话中告诉 BOT 您要什么；首次发送才开始创作。"}
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

      <div className="glass-rail-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
        ) : items.length === 0 ? (
          <div className="glass-card border border-white/50 border-dashed p-6 text-center text-muted-foreground text-sm">
            {"让 BOT 为您创建仪表盘、列表或小工具，或从面板库安装一个。"}
          </div>
        ) : (
          items.map((instance) => (
            <PanelCard
              canManage={canManage}
              instance={instance}
              key={`${instance.id}:${instance.instanceVersion}`}
              onEdit={() => begin.mutate(instance.id)}
              onError={setError}
            />
          ))
        )}
      </div>

      <button
        aria-busy={beginState === "pending" || undefined}
        className="glass-pill async-raw flex h-12 shrink-0 items-center justify-center gap-2 rounded-full font-medium text-sm disabled:opacity-60"
        data-btn-state={beginState}
        disabled={!botId || !canManage || begin.isPending || Boolean(session.data)}
        onClick={() => begin.mutate(undefined)}
        type="button"
      >
        <AsyncContent
          labels={{ pending: "正在打开创作…", success: "已开始创作", error: "打开失败" }}
          state={beginState}
        >
          <IconPlus className="size-5" stroke={2} />
          {"创建一个新面板"}
        </AsyncContent>
      </button>
      {botId && list.data && !canManage ? (
        <p className="-mt-1 text-center text-muted-foreground text-xs">
          {"您可交互；管理面板需要 BOT 所有者或管理员权限。"}
        </p>
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
  const remove = useMutation({
    mutationFn: () =>
      panelsApi.remove(instance.botId, instance.id, instance.instanceVersion),
    onSuccess: invalidate,
    onError: (e) => onError(panelErrorText(e)),
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
      <div className="mt-2.5 flex justify-between px-0.5 text-[11px] text-muted-foreground/80">
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
                        "rounded-full px-3.5 py-1.5 text-[12.5px]",
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
                        className="text-[11px] text-muted-foreground hover:text-destructive"
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
