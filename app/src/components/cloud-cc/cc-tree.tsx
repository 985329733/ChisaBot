import { IconChevronRight, IconFolder, IconPlus, IconSettings } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { type CcSessionStatus, type CcWorkspaceView, SYNC_STATE_ZH } from "../../../../shared/cloud-cc";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { ccApi, ccKeys, ccWorkspacesQueryOptions, cloudWorkspaceQueryOptions } from "@/lib/cloud-cc";
import { cn } from "@/lib/utils";

const STATUS_ZH: Record<CcSessionStatus, string> = { idle: "", running: "运行中", waiting: "等你批准", error: "出错" };

/** 同步状态小药丸（DESIGN.md §73.5；P4 之前都是「仅云端」）。 */
export function SyncPill({ state }: { state: CcWorkspaceView["syncState"] }) {
  const tone = state === "pc_active" ? "is-ok" : state === "syncing" ? "is-info" : state === "paused" ? "is-warn" : state === "conflict" ? "is-danger" : "";
  return (
    <span className={cn("cc-pill cc-sync-pill", tone)} data-state={state}>
      <i aria-hidden className="cc-dot" />
      {SYNC_STATE_ZH[state]}
    </span>
  );
}

/**
 * 工作区 → 会话的树（左栏 Claude Code 视图，手机上整页）。DESIGN.md §73.2：工作区一行（三角 · 名称 · 同步药丸 · 来源），
 * 展开是会话（状态点：蓝 = 运行中，黄 = 等你批准，灰 = 空闲 · 标题 · 分支 · 状态字），最后「＋新会话」。
 */
export function CcTree({ onNavigate, variant = "rail" }: { onNavigate?: () => void; variant?: "rail" | "page" }) {
  const status = useQuery(cloudWorkspaceQueryOptions());
  const workspaces = useQuery(ccWorkspacesQueryOptions(!!status.data?.node));
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const params = useParams({ strict: false }) as { sessionId?: string };
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useAsyncAction(
    async (workspaceId: string) => {
      const session = await ccApi.createSession(workspaceId);
      await queryClient.invalidateQueries({ queryKey: ccKeys.workspaces });
      onNavigate?.();
      await navigate({ to: "/cc/$sessionId", params: { sessionId: session.id } });
    },
    { errorToast: (e) => `新建会话失败：${e.message}` },
  );
  if (!status.data?.node) return null;
  if (workspaces.isPending) return <div className="cc-tree-skel" aria-busy />;
  if (workspaces.isError) return <div className="cc-tree-err">{workspaces.error.message}</div>;
  return (
    <div className={cn("cc-tree", variant === "page" && "is-page")} data-testid="cc-tree">
      {workspaces.data.map((ws) => {
        const open = !closed.has(ws.id);
        return (
          <section className="cc-ws" data-open={open ? "" : undefined} key={ws.id}>
            <button
              aria-expanded={open}
              className="cc-ws-head"
              onClick={() => setClosed((c) => (c.has(ws.id) ? new Set([...c].filter((x) => x !== ws.id)) : new Set([...c, ws.id])))}
              type="button"
            >
              <IconChevronRight className="cc-ws-caret size-3.5" />
              <span className="cc-ws-name">{ws.name}</span>
              <SyncPill state={ws.syncState} />
            </button>
            <div className="cc-ws-src">{ws.sourceLabel}</div>
            <div className="cc-ws-fold" inert={!open}>
              <div className="cc-ws-fold-in">
                {ws.sessions.map((s) => (
                  <Link
                    className={cn("cc-sess", params.sessionId === s.id && "is-active")}
                    data-status={s.status}
                    data-testid="cc-session-row"
                    key={s.id}
                    onClick={() => onNavigate?.()}
                    params={{ sessionId: s.id }}
                    to="/cc/$sessionId"
                  >
                    <i aria-hidden className="cc-sess-dot" />
                    <span className="cc-sess-main">
                      <span className="cc-sess-title">{s.title}</span>
                      <span className="cc-sess-sub">{s.branch ?? (ws.source === "scratch" ? "自己的目录" : "")}</span>
                    </span>
                    {STATUS_ZH[s.status] ? <span className="cc-sess-state">{STATUS_ZH[s.status]}</span> : null}
                  </Link>
                ))}
                <Button
                  className="cc-new-sess"
                  data-testid="cc-new-session"
                  feedback={{ pending: "新建中…", success: "已新建", error: "没有建成" }}
                  onClick={() => void create.run(ws.id)}
                  size="sm"
                  state={create.state}
                  variant="ghost"
                >
                  <IconPlus className="size-3.5" />
                  {"新会话"}
                </Button>
              </div>
            </div>
          </section>
        );
      })}
      <p className="cc-tree-hint">
        <IconFolder className="size-3.5" />
        {"从 GitHub 新建工作区、电脑文件夹同步在后面几版加上。"}
      </p>
    </div>
  );
}

/** 左栏底部的节点状态卡：「云端工作区 · 在线 · Claude Pro · 正在运行 1 / 2」。 */
export function CcNodeCard({ onNavigate }: { onNavigate?: () => void }) {
  const status = useQuery(cloudWorkspaceQueryOptions());
  const d = status.data;
  if (!d) return null;
  const online = !!d.node?.online;
  const plan = d.claude.plan ? `Claude ${d.claude.plan.charAt(0).toUpperCase()}${d.claude.plan.slice(1)}` : d.claude.loggedIn ? "Claude 已登录" : "Claude 未登录";
  return (
    <Link className="cc-node-card" data-testid="cc-node-card" onClick={() => onNavigate?.()} to="/settings/cloud-workspace">
      <i aria-hidden className={cn("cc-node-dot", online ? "is-on" : "is-off")} />
      <span className="min-w-0 flex-1">
        <span className="cc-node-t">{d.node ? `云端工作区 · ${online ? "在线" : "离线"}` : "还没有云端工作区"}</span>
        <span className="cc-node-s">{d.node ? `${plan} · 正在运行 ${d.running} / ${d.maxConcurrent}` : "去设置里看怎么连接"}</span>
      </span>
      <IconSettings aria-label="设置" className="size-4 flex-none opacity-60" />
    </Link>
  );
}
