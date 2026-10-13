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
import { memo, useEffect, useMemo, useState } from "react";
import { parseRenderUiSpec, sanitizeRenderUiSpec } from "../../../../shared/json-render/catalog";
import { pruneEmptySections } from "../../../../shared/json-render/empty-sections";
import { client } from "@/lib/client";
import { jsonRenderRegistry } from "@/lib/copilot/json-render/registry";

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

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
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

const LiveBody = memo(function LiveBody({ spec: source }: { spec: string }) {
  // 空列表 / 空重复区块不画，免得只剩一个孤零零的小标题（shared/json-render/empty-sections.ts）。
  const spec = useMemo(() => pruneEmptySections(sanitizeRenderUiSpec(parseRenderUiSpec(source, false))?.spec ?? null), [source]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: one store per spec version.
  const store = useMemo(() => createStateStore({ ...((spec as Spec | null)?.state ?? {}) }), [source]);
  const handlers = useMemo(
    () => ({
      open_link: (params: Record<string, unknown>) => {
        const url = typeof params.url === "string" ? params.url : "";
        if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      },
      send_message: () => {},
    }),
    [],
  );
  if (!spec?.root || !spec.elements?.[spec.root]) return <p className="live-panel-note">{"内容无法显示，下次刷新会重画。"}</p>;
  return (
    <div className="jr-surface live-panel-body">
      <JSONUIProvider handlers={handlers} registry={jsonRenderRegistry} store={store}>
        <Renderer registry={jsonRenderRegistry} spec={spec as Spec} />
      </JSONUIProvider>
    </div>
  );
});

function LivePanelCard({ panel, onRemoved }: { panel: LivePanel; onRemoved: (p: LivePanel) => void }) {
  const queryClient = useQueryClient();
  const [menu, setMenu] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: livePanelKeys.list(panel.botId) });
  const refresh = useMutation({
    mutationFn: () => client(`/api/live-panels/${panel.id}/refresh`, { method: "POST", fallback: "刷新失败" }),
    onSuccess: invalidate,
    onError: (e) => setProblem(e instanceof Error ? e.message : "刷新失败"),
  });
  const undoEdit = useMutation({
    mutationFn: () => client(`/api/live-panels/${panel.id}/undo-edit`, { method: "POST", fallback: "撤销失败" }),
    onSuccess: invalidate,
    onError: (e) => setProblem(e instanceof Error ? e.message : "撤销失败"),
  });
  const setCadence = useMutation({
    mutationFn: (minutes: number | null) => client(`/api/live-panels/${panel.id}`, { method: "PATCH", body: { refreshMinutes: minutes }, fallback: "修改失败" }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => client(`/api/live-panels/${panel.id}`, { method: "DELETE", fallback: "删除失败" }),
    onSuccess: () => {
      onRemoved(panel);
      void invalidate();
    },
    onError: (e) => setProblem(e instanceof Error ? e.message : "删除失败"),
  });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);

  const busy = panel.refreshing || refresh.isPending;
  const building = panel.status === "building" || (!panel.spec && busy);

  return (
    <article aria-busy={building || busy || undefined} className="glass-card live-panel" data-live-panel={panel.id} data-status={panel.status}>
      <header className="live-panel-head">
        <h3 className="live-panel-title">{panel.title}</h3>
        {busy && !building ? <IconRefresh aria-label={"正在刷新"} className="live-panel-spin size-3.5" /> : null}
        <div className="relative ml-auto">
          <button
            aria-expanded={menu}
            aria-label={`「${panel.title}」的更多操作`}
            className="rail-head-icon size-7"
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
            type="button"
          >
            <IconDots className="size-4" />
          </button>
          {menu ? (
            <div className="live-panel-menu glass-card" role="menu">
              <button disabled={busy} onClick={() => refresh.mutate()} role="menuitem" type="button">
                <IconRefresh className="size-4" />
                {busy ? "正在刷新…" : "立即刷新"}
              </button>
              <div className="live-panel-menu-sep" />
              <span className="live-panel-menu-label">{"自动刷新"}</span>
              {[
                [60, "每小时"],
                [360, "每 6 小时"],
                [1440, "每天"],
                [null, "不自动刷新"],
              ].map(([m, label]) => (
                <button
                  aria-checked={panel.refreshMinutes === m}
                  key={String(m)}
                  onClick={() => setCadence.mutate(m as number | null)}
                  role="menuitemradio"
                  type="button"
                >
                  <span className="live-panel-check">{panel.refreshMinutes === m ? "✓" : ""}</span>
                  {label}
                </button>
              ))}
              <div className="live-panel-menu-sep" />
              {panel.canUndoEdit ? (
                <button onClick={() => undoEdit.mutate()} role="menuitem" type="button">
                  <IconArrowBackUp className="size-4" />
                  {"撤销上次修改"}
                </button>
              ) : null}
              <button className="is-danger" onClick={() => remove.mutate()} role="menuitem" type="button">
                <IconTrash className="size-4" />
                {"删除面板"}
              </button>
            </div>
          ) : null}
        </div>
      </header>

      {building ? (
        <div className="live-panel-skeleton" role="status">
          <span className="jr-skel-title" />
          <span className="jr-skel-line" />
          <span className="jr-skel-line is-short" />
          <span className="live-panel-note">{"正在搭建，机器人在取数据…"}</span>
        </div>
      ) : panel.spec ? (
        <LiveBody spec={panel.spec} />
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
              {panel.sources.map((s, i) => (
                <a href={s.url} key={s.url} rel="noopener noreferrer" target="_blank" title={s.url}>
                  {i > 0 ? "、" : ""}
                  {s.name}
                  <IconExternalLink className="ml-0.5 inline size-3 align-[-1px] opacity-60" />
                </a>
              ))}
            </span>
          ) : null}
          <span className="live-panel-time" title={panel.refreshedAt ? new Date(panel.refreshedAt).toLocaleString("zh-CN") : undefined}>
            {[ago(panel.refreshedAt), cadence(panel.refreshMinutes)].filter(Boolean).join(" · ")}
          </span>
        </footer>
      ) : null}
    </article>
  );
}

/** 右栏面板标签里的实时面板列表 + 删除后的「撤销」。 */
export function LivePanelList({ botId }: { botId: string }) {
  const list = useLivePanels(botId);
  const queryClient = useQueryClient();
  const [removed, setRemoved] = useState<LivePanel | null>(null);
  useEffect(() => {
    if (!removed) return;
    const t = window.setTimeout(() => setRemoved(null), 10_000);
    return () => window.clearTimeout(t);
  }, [removed]);
  const restore = useMutation({
    mutationFn: (p: LivePanel) => client(`/api/live-panels/${p.id}/restore`, { method: "POST", fallback: "撤销失败" }),
    onSuccess: () => {
      setRemoved(null);
      void queryClient.invalidateQueries({ queryKey: livePanelKeys.list(botId) });
    },
  });
  return (
    <>
      {removed ? (
        <div className="glass-card panel-saved-note flex shrink-0 items-center gap-2 px-4 py-3 text-sm" role="status">
          <span className="min-w-0 flex-1 truncate">{`已删除「${removed.title}」`}</span>
          <button
            className="glass-pill rounded-full px-3 py-1 text-xs"
            disabled={restore.isPending}
            onClick={() => restore.mutate(removed)}
            type="button"
          >
            {restore.isPending ? "撤销中…" : "撤销"}
          </button>
        </div>
      ) : null}
      {(list.data ?? []).map((panel) => (
        <LivePanelCard key={panel.id} onRemoved={setRemoved} panel={panel} />
      ))}
    </>
  );
}
