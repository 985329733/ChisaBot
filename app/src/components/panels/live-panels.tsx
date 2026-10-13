import { createStateStore, JSONUIProvider, Renderer, type Spec } from "@json-render/react";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconDots,
  IconExternalLink,
  IconRefresh,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PresenceItem, PresenceList } from "@/components/ui/presence";
import { toast } from "@/components/ui/toast";
import { parseRenderUiSpec, sanitizeRenderUiSpec } from "../../../../shared/json-render/catalog";
import { pruneEmptySections } from "../../../../shared/json-render/empty-sections";
import { dropDuplicateTitle } from "../../../../shared/json-render/panel-title";
import { client } from "@/lib/client";
import { jsonRenderRegistry } from "@/lib/copilot/json-render/registry";
import { copyText, openInNewTab, RichUiProvider, useNow } from "@/lib/copilot/json-render/rich-context";

/** 面板里的「问一句」发到当前机器人的对话（bot.tsx 监听）。 */
function askBot(text: string) {
  const said = text.trim();
  if (said) window.dispatchEvent(new CustomEvent("chisabot-ask", { detail: said }));
}

/**
 * 实时面板（server/src/live-panels，2026-10-13）：机器人用一句话的请求做出来、自己按计划刷新的卡片。
 *
 * 卡片只画结果：标题、内容（json-render，与对话里的 render_ui 同一套组件）、数据来源、更新时间。
 * 搭建中是骨架 +「正在搭建…」，刷新中标题旁一个小圈；失败把原因用大白话写在卡片上。
 * ⋯ 菜单：立即刷新、刷新频率、撤销修改、删除（10 秒内可撤销）。没有 JSON、没有规范。
 */
export type LivePanel = {
  id: string;
  botId: string;
  title: string;
  status: "building" | "ready" | "failed";
  spec: string | null;
  sources: { name: string; url: string }[];
  instruction: string;
  refreshMinutes: number | null;
  error: string | null;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  refreshing: boolean;
  canUndoEdit: boolean;
  createdAt: string;
};

export const livePanelKeys = { list: (botId: string) => ["live-panels", botId] as const };

/**
 * 聊天正在跑一轮（turn-compaction.ts 广播 chisabot-chat-running）。跑的时候 2.5 秒看一次面板：
 * 机器人 panel_create 之后卡片要马上出现在右栏，而不是等下一个 30 秒。
 */
function useChatRunning() {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const on = (event: Event) => setRunning(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("chisabot-chat-running", on);
    return () => window.removeEventListener("chisabot-chat-running", on);
  }, []);
  return running;
}

export function useLivePanels(botId: string | undefined) {
  const running = useChatRunning();
  const queryClient = useQueryClient();
  // 一轮刚结束：再看一次（面板可能在最后一步才填好）。
  useEffect(() => {
    if (!running && botId) void queryClient.invalidateQueries({ queryKey: livePanelKeys.list(botId) });
  }, [running, botId, queryClient]);
  return useQuery({
    enabled: Boolean(botId),
    queryKey: livePanelKeys.list(botId ?? ""),
    queryFn: () => client<LivePanel[]>(`/api/live-panels?botId=${encodeURIComponent(botId ?? "")}`, "items", { fallback: "面板无法加载" }),
    // 有卡片在搭建 / 刷新时 3 秒看一次，平时 30 秒（机器人在对话里建的卡片要马上出现）。
    refetchInterval: (query) => {
      const items = query.state.data;
      if (running) return 2500;
      return items?.some((p) => p.status === "building" || p.refreshing) ? 3000 : 30_000;
    },
    refetchOnWindowFocus: true,
  });
}

function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "刚刚更新";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前更新`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前更新`;
  return `${new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} 更新`;
}
function cadence(minutes: number | null): string {
  if (!minutes) return "不自动刷新";
  if (minutes % 1440 === 0) return minutes === 1440 ? "每天刷新" : `每 ${minutes / 1440} 天刷新`;
  if (minutes % 60 === 0) return minutes === 60 ? "每小时刷新" : `每 ${minutes / 60} 小时刷新`;
  return `每 ${minutes} 分钟刷新`;
}

const LiveBody = memo(function LiveBody({ spec: source, title, onRefresh }: { spec: string; title: string; onRefresh?: () => void }) {
  // 空列表 / 空重复区块不画，免得只剩一个孤零零的小标题（shared/json-render/empty-sections.ts）；
  // 和卡片头同名的标题也不再画第二遍（shared/json-render/panel-title.ts）。
  const spec = useMemo(
    () => dropDuplicateTitle(pruneEmptySections(sanitizeRenderUiSpec(parseRenderUiSpec(source, false))?.spec ?? null), title),
    [source, title],
  );
  /*
   * 刷新只换数据（DESIGN.md §32）：新规范到了也不重新挂载——元素 key 没变，React 复用同一批组件，
   * 数字从旧值滚到新值并闪一下（rich-context useLiveValue）。state 仓库按规范版本换新，表格 / 列表直接用字面值。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: one store per spec version.
  const store = useMemo(() => createStateStore({ ...((spec as Spec | null)?.state ?? {}) }), [source]);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const handlers = useMemo(
    () => ({
      open_link: (params: Record<string, unknown>) => {
        const url = typeof params.url === "string" ? params.url : "";
        if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      },
      send_message: (params: Record<string, unknown>) => {
        if (typeof params.text === "string") askBot(params.text);
      },
      copy_text: (params: Record<string, unknown>) => {
        if (typeof params.text === "string" && params.text) void copyText(params.text);
      },
      refresh_panel: () => refreshRef.current?.(),
    }),
    [],
  );
  const rich = useMemo(
    () => ({ surface: "panel" as const, ask: askBot, openLink: openInNewTab, copy: copyText, refresh: () => refreshRef.current?.() }),
    [],
  );
  if (!spec?.root || !spec.elements?.[spec.root]) return <p className="live-panel-note">{"内容无法显示，下次刷新会重画。"}</p>;
  return (
    <div className="jr-surface live-panel-body">
      <RichUiProvider value={rich}>
        <JSONUIProvider handlers={handlers} registry={jsonRenderRegistry} store={store}>
          <Renderer registry={jsonRenderRegistry} spec={spec as Spec} />
        </JSONUIProvider>
      </RichUiProvider>
    </div>
  );
});

/** 「3 分钟前更新」会自己走（一分钟内每 15 秒，之后每分钟）。 */
function UpdatedAgo({ at }: { at: string | null }) {
  const now = useNow(at && Date.now() - new Date(at).getTime() < 90_000 ? 15 : 60);
  return <>{ago(at, now)}</>;
}

function LivePanelCard({ panel, onRemove }: { panel: LivePanel; onRemove: (p: LivePanel) => void }) {
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const key = livePanelKeys.list(panel.botId);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  // 乐观更新（DESIGN.md §34.6）：先改界面，请求失败再退回并说明原因。
  const patchLocal = (patch: Partial<LivePanel>) =>
    queryClient.setQueryData<LivePanel[]>(key, (old) => old?.map((p) => (p.id === panel.id ? { ...p, ...patch } : p)));
  const refresh = useMutation({
    mutationFn: () => client(`/api/live-panels/${panel.id}/refresh`, { method: "POST", fallback: "刷新失败" }),
    onMutate: () => {
      setProblem(null);
      patchLocal({ refreshing: true });
    },
    onSettled: invalidate,
    onError: (e) => setProblem(e instanceof Error ? e.message : "刷新失败"),
  });
  const undoEdit = useMutation({
    mutationFn: () => client(`/api/live-panels/${panel.id}/undo-edit`, { method: "POST", fallback: "撤销失败" }),
    onSuccess: invalidate,
    onError: (e) => setProblem(e instanceof Error ? e.message : "撤销失败"),
  });
  const setCadence = useMutation({
    mutationFn: (minutes: number | null) => client(`/api/live-panels/${panel.id}`, { method: "PATCH", body: { refreshMinutes: minutes }, fallback: "修改失败" }),
    onMutate: (minutes) => {
      const before = panel.refreshMinutes;
      patchLocal({ refreshMinutes: minutes });
      return { before };
    },
    onError: (e, _m, ctx) => {
      if (ctx) patchLocal({ refreshMinutes: ctx.before });
      setProblem(e instanceof Error ? e.message : "修改失败");
    },
    onSettled: invalidate,
  });
  const icon = "size-[18px] shrink-0";

  const busy = panel.refreshing || refresh.isPending;
  const building = panel.status === "building" || (!panel.spec && busy);
  // 有内容但最近一次刷新失败：内容照常显示，标成「可能已过期」（DESIGN.md §32）。
  const stale = Boolean(panel.error && panel.spec && !building);

  return (
    <article
      aria-busy={building || busy || undefined}
      className="glass-card live-panel"
      data-live-panel={panel.id}
      data-refreshing={(busy && !building) || undefined}
      data-stale={stale || undefined}
      data-status={panel.status}
    >
      <header className="live-panel-head">
        <h3 className="live-panel-title">{panel.title}</h3>
        {busy && !building ? <IconRefresh aria-label={"正在刷新"} className="live-panel-spin size-3.5" /> : null}
        {stale && !busy ? (
          <span className="live-panel-stale" title={panel.error ?? undefined}>
            <IconAlertTriangle aria-hidden className="size-3" />
            {"可能已过期"}
          </span>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<button aria-label={`「${panel.title}」的更多操作`} className="rail-head-icon live-panel-more ml-auto" type="button" />}
          >
            <IconDots className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-pop sg-menu w-[208px]" side="bottom" sideOffset={6}>
            <DropdownMenuItem className="glass-mi" disabled={busy} onClick={() => refresh.mutate()}>
              <IconRefresh className={icon} />
              <span className="min-w-0 flex-1">{busy ? "正在刷新…" : "立即刷新"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="glass-sep" />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="glass-mi-label">{"自动刷新"}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                onValueChange={(v) => setCadence.mutate(v === "off" ? null : Number(v))}
                value={panel.refreshMinutes == null ? "off" : String(panel.refreshMinutes)}
              >
                {(
                  [
                    ["60", "每小时"],
                    ["360", "每 6 小时"],
                    ["1440", "每天"],
                    ["off", "不自动刷新"],
                  ] as const
                ).map(([value, label]) => (
                  <DropdownMenuRadioItem className="glass-mi" closeOnClick key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator className="glass-sep" />
            {panel.canUndoEdit ? (
              <DropdownMenuItem className="glass-mi" onClick={() => undoEdit.mutate()}>
                <IconArrowBackUp className={icon} />
                <span className="min-w-0 flex-1">{"撤销上次修改"}</span>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="glass-mi is-danger" onClick={() => onRemove(panel)} variant="destructive">
              <IconTrash className={icon} />
              <span className="min-w-0 flex-1">{"删除面板"}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {building ? (
        <div className="live-panel-skeleton" role="status">
          <span className="jr-skel-title" />
          <span className="jr-skel-line" />
          <span className="jr-skel-line is-short" />
          <span className="live-panel-note">{"正在搭建，机器人在取数据…"}</span>
        </div>
      ) : panel.spec ? (
        <LiveBody onRefresh={() => refresh.mutate()} spec={panel.spec} title={panel.title} />
      ) : null}

      {panel.error && !building ? (
        <p className="live-panel-error" role="alert">
          <IconAlertTriangle className="size-3.5 shrink-0" />
          <span>{panel.error}</span>
        </p>
      ) : null}
      {problem ? <p className="live-panel-error" role="alert">{problem}</p> : null}

      {!building ? (
        <footer className="live-panel-foot">
          {panel.sources.length ? (
            <span className="live-panel-sources">
              {"来源 "}
              {panel.sources.filter((s, i, all) => all.findIndex((o) => o.name === s.name) === i).map((s, i) => (
                <a href={s.url} key={s.url} rel="noopener noreferrer" target="_blank" title={s.url}>
                  {i > 0 ? "、" : ""}
                  {s.name}
                  <IconExternalLink className="ml-0.5 inline size-3 align-[-1px] opacity-60" />
                </a>
              ))}
            </span>
          ) : null}
          <span className="live-panel-time" title={panel.refreshedAt ? new Date(panel.refreshedAt).toLocaleString("zh-CN") : undefined}>
            {busy ? (
              "正在刷新…"
            ) : (
              <>
                <UpdatedAgo at={panel.refreshedAt} />
                {`${panel.refreshedAt ? " · " : ""}${cadence(panel.refreshMinutes)}`}
              </>
            )}
          </span>
        </footer>
      ) : null}
    </article>
  );
}

/**
 * 右栏面板标签里的实时面板列表。删除是乐观的（DESIGN.md §34.6）：点「删除面板」卡片立刻淡出、
 * 下面的卡片补位，同时底部弹出带「撤销」的提示；请求失败就把卡片放回去并提示原因。
 */
export function LivePanelList({ botId }: { botId: string }) {
  const list = useLivePanels(botId);
  const queryClient = useQueryClient();
  const key = livePanelKeys.list(botId);
  // 撤销可能在删除请求回来之前就点了：先等删除落地，再恢复，服务端顺序不会反。
  const deleting = useRef(new Map<string, Promise<unknown>>());
  const restore = useMutation({
    mutationFn: async ({ panel }: { panel: LivePanel; index: number }) => {
      await deleting.current.get(panel.id);
      return client(`/api/live-panels/${panel.id}/restore`, { method: "POST", fallback: "撤销失败" });
    },
    onMutate: async ({ panel, index }) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<LivePanel[]>(key, (old = []) =>
        old.some((o) => o.id === panel.id) ? old : [...old.slice(0, index), panel, ...old.slice(index)],
      );
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "撤销失败"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (p: LivePanel) => {
      const request = client(`/api/live-panels/${p.id}`, { method: "DELETE", fallback: "删除失败" });
      deleting.current.set(p.id, request.catch(() => undefined));
      return request;
    },
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<LivePanel[]>(key);
      const index = Math.max(0, before?.findIndex((o) => o.id === p.id) ?? 0);
      queryClient.setQueryData<LivePanel[]>(key, (old) => old?.filter((o) => o.id !== p.id));
      toast.undo(`已删除「${p.title}」`, () => restore.mutate({ panel: p, index }));
      return { before };
    },
    onError: (e, p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(key, ctx.before);
      toast.error(e instanceof Error ? e.message : `「${p.title}」删除失败`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <PresenceList>
      {(list.data ?? []).map((panel) => (
        <PresenceItem key={panel.id}>
          <LivePanelCard onRemove={(p) => remove.mutate(p)} panel={panel} />
        </PresenceItem>
      ))}
    </PresenceList>
  );
}
