import { IconKey, IconCloudComputing, IconExternalLink, IconRefresh, IconShieldCheck, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CcLoginStart } from "../../../../../shared/cloud-cc";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, EmptyState, ErrorCard, ListRow } from "@/components/ui/skyglass";
import { ccApi, ccKeys, cloudWorkspaceQueryOptions } from "@/lib/cloud-cc";
import { client } from "@/lib/client";
import { agoText } from "@/lib/im";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/settings/cloud-workspace")({
  component: CloudWorkspacePage,
});

const PLAN_ZH: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

/** 设置 → 云端工作区（DESIGN.md §73.1，docs/cloud-claude-code.md §3.1）：Claude 账号登录、总是允许的规则、操作记录。 */
function CloudWorkspacePage() {
  const status = useQuery(cloudWorkspaceQueryOptions());
  const node = status.data?.node ?? null;
  const pills = node ? (
    <span className="cc-pills">
      <span className={cn("cc-pill", node.online ? "is-ok" : "is-off")}>{node.online ? "在线" : "离线"}</span>
      <span className="cc-pill is-info">{`正在运行 ${status.data?.running ?? 0} / ${status.data?.maxConcurrent ?? 2}`}</span>
    </span>
  ) : null;
  return (
    <PageShell
      action={pills}
      description="云端工作区是服务器上一个独立的容器，里面有 Claude Code。电脑关着也能在网页、手机上让它写代码。它碰不到数据库、密钥和别的容器，也不能开完全访问。"
      title="云端工作区"
    >
      {status.isPending ? (
        <PageSkeleton rows={3} tall />
      ) : status.isError ? (
        <ErrorCard action={<Button onClick={() => void status.refetch()} variant="outline">{"重试"}</Button>} description={status.error.message} title="读不到云端工作区" />
      ) : !node ? (
        <EmptyState
          description="还没有云端工作区节点。部署方法见 deploy/cloud-node/README.md：在服务器上起一个容器，用 设置 → 设备 → 添加设备 → 服务器 的安装码配对。"
          icon={<IconCloudComputing className="size-6" />}
          title="先连接云端工作区"
        />
      ) : (
        <>
          <ClaudeAccount />
          <RulesSection />
          <ActivitySection />
          <p className="cc-foot-note">
            {"节点「"}
            {node.name}
            {"」也出现在 "}
            <Link to="/settings/devices">{"设置 → 设备"}</Link>
            {node.claudeVersion ? ` · Claude Code ${node.claudeVersion.replace(/\s*\(.*\)$/, "")}` : ""}
            {node.online || !node.lastSeenAt ? "" : ` · 最后在线 ${agoText(node.lastSeenAt)}`}
          </p>
        </>
      )}
    </PageShell>
  );
}

function ClaudeAccount() {
  const queryClient = useQueryClient();
  const status = useQuery(cloudWorkspaceQueryOptions());
  const claude = status.data?.claude;
  const online = !!status.data?.node?.online;
  const [login, setLogin] = useState<CcLoginStart | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!login) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [login]);
  const remaining = login ? Math.max(0, Date.parse(login.expiresAt) - now) : 0;
  useEffect(() => {
    if (login && remaining === 0) {
      setLogin(null);
      setError("登录流程过期了（10 分钟），请重新开始。");
    }
  }, [login, remaining]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ccKeys.status });

  const start = useAsyncAction(
    async () => {
      setError(null);
      setCode("");
      setLogin(await ccApi.loginStart());
    },
    { errorToast: (e) => `没能开始登录：${e.message}` },
  );
  const finish = useAsyncAction(
    async () => {
      if (!login) return;
      const result = await ccApi.loginCode(login.id, code.trim());
      if (!result.ok) {
        setError(result.error ?? "登录没有成功");
        setLogin(null);
        throw new Error(result.error ?? "登录没有成功");
      }
      setLogin(null);
      setCode("");
      await refresh();
    },
    { errorToast: false },
  );
  const cancel = async () => {
    if (login) await ccApi.loginCancel(login.id).catch(() => {});
    setLogin(null);
    setCode("");
  };
  const check = useAsyncAction(async () => {
    await ccApi.check();
    await refresh();
  });
  const logout = useAsyncAction(async () => {
    await ccApi.logout();
    await refresh();
  });
  const askLogout = async () => {
    const ok = await confirmDialog({ title: "退出 Claude 账号？", description: "云端工作区里的 Claude Code 会退出登录，正在跑的会话会失败。以后可以重新登录。", confirmLabel: "退出", destructive: true });
    if (ok) void logout.run();
  };

  const plan = claude?.plan ? (PLAN_ZH[claude.plan.toLowerCase()] ?? claude.plan) : null;
  return (
    <PageSection description="用你的 Claude 订阅登录云端工作区里的 Claude Code。凭据只存在云端工作区的容器里，ChisaBot 的数据库和日志里都没有。" title="Claude 账号">
      <Card className="cc-account" data-testid="cc-account">
        {claude?.loggedIn && !login ? (
          <CardBody className="cc-account-row">
            <span className="cc-account-ic is-ok">
              <IconShieldCheck className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="cc-account-t" data-testid="cc-logged-in">{`已登录 · ${claude.email ?? "Claude 账号"}${plan ? ` · ${plan}` : ""}`}</div>
              <div className="cc-account-s">{claude.checkedAt ? `${agoText(claude.checkedAt)}检查过` : "已登录"}</div>
            </div>
            <span className="cc-account-actions">
            <Button disabled={!online} feedback="refresh" onClick={() => void check.run()} size="sm" state={check.state} variant="outline">
              <IconRefresh className="size-4" />
              {"重新检查"}
            </Button>
            <Button disabled={!online} feedback={{ pending: "退出中…", success: "已退出", error: "没有退出" }} onClick={() => void askLogout()} size="sm" state={logout.state} variant="ghost">
              {"退出"}
            </Button>
            </span>
          </CardBody>
        ) : login ? (
          <CardBody className="cc-steps" data-testid="cc-login-steps">
            <Step n={1} title="打开 Claude 授权页">
              <div className="cc-step-actions">
                <Button render={<a href={login.url} rel="noreferrer noopener" target="_blank" />} size="sm">
                  {"打开 Claude 授权页"}
                  <IconExternalLink className="size-4" />
                </Button>
                <CopyButton size="sm" value={login.url} variant="outline">
                  {"复制链接"}
                </CopyButton>
              </div>
            </Step>
            <Step n={2} sub="在授权页用你的 Claude 账号登录，页面会显示一串授权码。" title="登录后复制页面上的授权码" />
            <Step n={3} title="粘贴授权码">
              <form
                className="cc-code-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (code.trim()) void finish.run();
                }}
              >
                <Input autoComplete="off" data-testid="cc-code" onChange={(e) => setCode(e.target.value)} placeholder="粘贴授权码" spellCheck={false} value={code} />
                <Button disabled={!code.trim()} feedback={{ pending: "登录中…", success: "已登录", error: "没有成功" }} state={finish.state} type="submit">
                  {"完成登录"}
                </Button>
                <span className="cc-code-meta">
                  {`剩余 ${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}`}
                  {" · "}
                  <button className="cc-link" onClick={() => void cancel()} type="button">
                    {"取消"}
                  </button>
                </span>
              </form>
            </Step>
          </CardBody>
        ) : (
          <CardBody className="cc-account-row">
            <span className="cc-account-ic">
              <IconKey className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="cc-account-t">{online ? "还没有登录 Claude" : "云端工作区不在线"}</div>
              <div className="cc-account-s">{online ? "Claude Pro / Max 订阅都可以。三步：打开授权页 → 复制授权码 → 粘回来。" : "节点上线后才能登录。"}</div>
            </div>
            <span className="cc-account-actions">
            <Button data-testid="cc-login-start" disabled={!online} feedback={{ pending: "打开中…", success: "已打开", error: "没有打开" }} onClick={() => void start.run()} state={start.state}>
              {"用 Claude 订阅登录"}
            </Button>
            </span>
          </CardBody>
        )}
        {error ? (
          <div className="cc-account-err" data-testid="cc-login-error" role="alert">
            {error}
          </div>
        ) : null}
      </Card>
    </PageSection>
  );
}

function Step({ n, title, sub, children }: { n: number; title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="cc-step">
      <span className="cc-step-n">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="cc-step-t">{title}</div>
        {sub ? <div className="cc-step-s">{sub}</div> : null}
        {children}
      </div>
    </div>
  );
}

type Rule = { id: string; scope: string; scopeTitle: string | null; kind: string; value: string; createdAt: string };
const KIND_ZH: Record<string, string> = { bash: "命令", domain: "网站", tool: "工具", read: "读取" };

function RulesSection() {
  const rules = useQuery({
    queryKey: ccKeys.rules,
    queryFn: ({ signal }) => client("/api/cloud-workspace/permission-rules", "rules", { fallback: "读不到规则", signal }) as Promise<Rule[]>,
  });
  const queryClient = useQueryClient();
  const remove = useAsyncAction(async (id: string) => {
    await client(`/api/cloud-workspace/permission-rules/${encodeURIComponent(id)}`, { method: "DELETE", fallback: "删除失败" });
    await queryClient.invalidateQueries({ queryKey: ccKeys.rules });
  });
  const list = rules.data ?? [];
  return (
    <PageSection description="只读操作、会话目录里的改动直接做；其他命令先在会话里弹审批卡。你在卡片上选「本会话总是允许」的会记在这里。推送、gh、ssh、sudo 一律不允许。" title="总是允许">
      <Card>
        {rules.isPending ? (
          <div className="cc-empty-line">{"读取中…"}</div>
        ) : list.length === 0 ? (
          <div className="cc-empty-line">{"还没有。"}</div>
        ) : (
          list.map((rule) => (
            <ListRow
              actions={
                <Button aria-label="删除这条规则" feedback="delete" onClick={() => void remove.run(rule.id)} size="icon-sm" variant="ghost">
                  <IconTrash className="size-4" />
                </Button>
              }
              key={rule.id}
              sub={`${KIND_ZH[rule.kind] ?? rule.kind} · ${rule.scopeTitle ? `会话「${rule.scopeTitle}」` : "会话"}`}
              title={<code className="cc-code-inline">{rule.value}</code>}
            />
          ))
        )}
      </Card>
    </PageSection>
  );
}

type Event = { id: string; kind: string; detail: Record<string, unknown> | null; at: string };
const EVENT_ZH: Record<string, string> = {
  node_registered: "云端工作区已连接",
  claude_login_started: "开始登录 Claude",
  claude_login_succeeded: "Claude 登录成功",
  claude_login_failed: "Claude 登录没有成功",
  claude_logout: "退出 Claude",
  session_created: "新会话",
  turn_started: "开始一轮",
  turn_done: "一轮结束",
  turn_stop_requested: "停止",
  turn_undone: "撤销一轮",
  claude_session_reset: "新的 Claude 会话",
  approval_requested: "请求批准",
  approval_approved: "已允许",
  approval_denied: "已拒绝",
  approval_expired: "审批超时，按拒绝",
  tool_denied: "自动拒绝",
};

function ActivitySection() {
  const events = useQuery({
    queryKey: [...ccKeys.status, "activity"],
    queryFn: ({ signal }) => client("/api/cloud-workspace/activity", "events", { fallback: "读不到操作记录", signal }) as Promise<Event[]>,
  });
  const list = (events.data ?? []).filter((e) => e.kind !== "turn_started").slice(0, 30);
  return (
    <PageSection description="登录、审批、每一轮的结果。不记录授权码、令牌和对话内容。" title="操作记录">
      <Card>
        {list.length === 0 ? (
          <div className="cc-empty-line">{events.isPending ? "读取中…" : "还没有记录。"}</div>
        ) : (
          list.map((e) => (
            <div className="cc-event" key={e.id}>
              <span className="cc-event-t">{EVENT_ZH[e.kind] ?? e.kind}</span>
              <span className="cc-event-d">{describe(e)}</span>
              <span className="cc-event-at">{agoText(e.at) ?? ""}</span>
            </div>
          ))
        )}
      </Card>
    </PageSection>
  );
}

function describe(e: Event) {
  const d = e.detail ?? {};
  if (e.kind === "turn_done") return `${d.ok ? "完成" : d.stopped ? "已停止" : "出错"}${typeof d.files === "number" && d.files ? ` · 改了 ${d.files} 个文件` : ""}${typeof d.costUsd === "number" ? ` · $${d.costUsd.toFixed(3)}` : ""}`;
  if (typeof d.summary === "string") return d.summary.slice(0, 80);
  if (typeof d.reason === "string") return d.reason.slice(0, 80);
  if (typeof d.title === "string") return d.title;
  return "";
}

