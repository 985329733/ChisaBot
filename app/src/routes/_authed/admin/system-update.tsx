import {
  IconArrowBackUp,
  IconBrandGithub,
  IconCheck,
  IconCloudDownload,
  IconGitCommit,
  IconHistory,
  IconPackage,
  IconServer,
  IconStethoscope,
  IconX,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ROLLBACK_STEPS,
  type SystemUpdateHistoryEntry,
  type SystemUpdateJob,
  type SystemUpdateOverview,
  UPDATE_STEPS,
} from "../../../../../shared/system-update";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Card, EmptyState, ErrorCard, SettingRow, StatTile } from "@/components/ui/skyglass";
import {
  loadSystemUpdate,
  requestSystemUpdate,
  shortSha,
  systemUpdateKeys,
  systemUpdateQueryOptions,
  timeText,
} from "@/lib/system-update";
import { type AdminSmokeResult, runAdminSmoke } from "@/lib/admin-smoke";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authed/admin/system-update")({
  component: SystemUpdatePage,
});

const STATUS_TEXT: Record<SystemUpdateHistoryEntry["status"], { text: string; tone: "ok" | "warn" | "danger" | "muted" | "accent" }> = {
  queued: { text: "排队中", tone: "muted" },
  running: { text: "进行中", tone: "accent" },
  succeeded: { text: "成功", tone: "ok" },
  failed: { text: "失败", tone: "danger" },
  rolled_back: { text: "已自动回滚", tone: "warn" },
  rejected: { text: "未执行", tone: "muted" },
};

const ACTION_TEXT = { check: "检查更新", update: "更新", rollback: "回滚" } as const;

function isActive(data?: SystemUpdateOverview) {
  return !!data && (data.pending.some((a) => a !== "check") || data.job?.status === "running" || data.job?.status === "queued");
}

/**
 * 管理后台 → 系统更新（模板 E，docs/online-update.md）。当前版本、GitHub main 上的新提交、一键更新
 * （宿主机更新程序：备份 → 构建 → 切换 → 健康检查，失败自动回滚）、进度与日志、回滚到上一版、历史。
 */
function SystemUpdatePage() {
  const queryClient = useQueryClient();
  const overview = useQuery(systemUpdateQueryOptions());
  const data = overview.data;

  const check = useAsyncAction(
    async () => {
    const before = data?.source?.fetchedAt ?? data?.updatedAt;
    await requestSystemUpdate("check");
    // 等宿主机取走请求并写回新的状态（通常 2–10 秒）。
    const started = Date.now();
    while (Date.now() - started < 45_000) {
      await new Promise((r) => setTimeout(r, 1500));
      const next = await loadSystemUpdate();
      queryClient.setQueryData(systemUpdateKeys.overview, next);
      if (!next.pending.includes("check") && (next.source?.fetchedAt ?? next.updatedAt) !== before) {
        if (next.source?.error) throw new Error(next.source.error);
        return;
      }
    }
    throw new Error("宿主机更新程序没有回应。");
    },
    { errorToast: (error) => error.message },
  );

  return (
    <PageShell
      action={
        <Button
          disabled={!data?.configured}
          feedback={{ pending: "检查中…", success: "已检查", error: "检查失败" }}
          onClick={() => void check.run()}
          size="sm"
          state={check.state}
          variant="outline"
        >
          <IconCloudDownload />
          {"检查更新"}
        </Button>
      }
      description="查看正在运行的版本和 GitHub main 上的新提交，一键更新或回滚。更新由宿主机上的更新程序执行：先备份数据库，再构建、切换、做健康检查，失败会自动回滚。"
      title="系统更新"
    >
      {overview.isPending ? (
        <PageSkeleton rows={4} tall />
      ) : !data ? (
        <ErrorCard
          action={
            <Button className="mt-2" onClick={() => void overview.refetch()} size="sm" type="button" variant="outline">
              {"重试"}
            </Button>
          }
          description={overview.error?.message ?? "无法读取系统更新状态。"}
          title="系统更新状态暂时无法读取"
        />
      ) : (
        <Overview data={data} />
      )}
    </PageShell>
  );
}

function Overview({ data }: { data: SystemUpdateOverview }) {
  const queryClient = useQueryClient();
  const active = isActive(data);
  const canUpdate = data.configured && data.updaterOnline && !active && !data.depsChanged && (data.behind ?? 0) > 0;

  const update = useAsyncAction(
    async () => {
      const result = await requestSystemUpdate("update", data.latest?.sha);
      queryClient.setQueryData(systemUpdateKeys.overview, result.overview);
    },
    { errorToast: (error) => error.message },
  );
  const rollback = useAsyncAction(
    async () => {
      const result = await requestSystemUpdate("rollback");
      queryClient.setQueryData(systemUpdateKeys.overview, result.overview);
    },
    { errorToast: (error) => error.message },
  );
  async function startUpdate() {
    const ok = await confirmDialog({
      title: `更新到 ${shortSha(data.latest?.sha)}？`,
      description: `会先备份数据库，然后构建新版本并切换，整个过程约 5–10 分钟；切换时有十几秒连不上。健康检查不通过会自动回到 ${data.current?.image ?? "当前版本"}。`,
      confirmLabel: "开始更新",
    });
    if (ok) await update.run();
  }
  async function startRollback() {
    const ok = await confirmDialog({
      title: "回滚到上一版？",
      description: `会切换回 ${data.previous?.image ?? "上一版"}（${shortSha(data.previous?.commit)}），切换时有十几秒连不上。数据库不回退；新版本加的数据会保留。`,
      confirmLabel: "回滚",
      destructive: true,
    });
    if (ok) await rollback.run();
  }

  if (!data.configured) {
    return (
      <EmptyState
        description="这个部署没有挂载宿主机更新程序的目录（CHISABOT_UPDATER_DIR）。安装方法见 docs/online-update.md。"
        icon={<IconServer className="size-6" />}
        title="宿主机更新程序未安装"
      />
    );
  }

  return (
    <>
      {!data.updaterOnline ? (
        <ErrorCard
          className="mt-2"
          description={`宿主机上的 chisabot-updater 服务${data.updatedAt ? `从 ${timeText(data.updatedAt)} 起` : ""}没有回应，暂时不能更新或回滚。请在服务器上运行 systemctl status chisabot-updater 查看。`}
          title="更新程序离线"
        />
      ) : null}
      <div className="magpie-stats">
        <StatTile
          delta={data.running.builtAt ? `构建于 ${timeText(data.running.builtAt)}` : undefined}
          icon={<IconPackage className="size-4" />}
          label="当前版本"
          value={<span className="sysupd-mono">{shortSha(data.running.commit ?? data.current?.commit)}</span>}
        />
        <StatTile
          delta={data.current?.deployedAt ? `上线于 ${timeText(data.current.deployedAt)}` : undefined}
          icon={<IconServer className="size-4" />}
          label="运行镜像"
          value={<span className="sysupd-image">{(data.current?.image ?? data.running.buildId).replace(/^.*:/u, "")}</span>}
        />
        <StatTile
          delta={data.source ? (data.source.kind === "github" ? `GitHub · ${data.source.branch}` : "本机镜像（发布时同步）") : undefined}
          icon={<IconBrandGithub className="size-4" />}
          label="上次检查"
          tone={data.source?.error ? "warn" : undefined}
          value={timeText(data.source?.fetchedAt)}
        />
        <StatTile
          delta={data.behind === null ? "当前镜像没有记录提交" : data.behind ? `最新 ${shortSha(data.latest?.sha)}` : "已是最新"}
          icon={<IconGitCommit className="size-4" />}
          label="待更新提交"
          tone={data.behind ? "warn" : data.behind === 0 ? "ok" : undefined}
          value={data.behind ?? "—"}
        />
      </div>

      {data.source?.error ? (
        <ErrorCard className="mt-4" description={data.source.error} title="检查更新失败" />
      ) : null}

      <PageSection
        action={
          <Button
            disabled={!canUpdate}
            feedback={{ pending: "提交中…", success: "已开始", error: "未开始" }}
            onClick={() => void startUpdate()}
            size="sm"
            state={update.state}
          >
            <IconCloudDownload />
            {"更新"}
          </Button>
        }
        description={data.source?.kind === "mirror" ? "GitHub 仓库是私有的，宿主机没有配置只读令牌时，读取发布时同步到服务器的本机镜像。" : `来自 ${data.source?.repo ?? "GitHub"} 的 ${data.source?.branch ?? "main"}。`}
        title="可用更新"
      >
        {data.depsChanged ? (
          <ErrorCard
            className="mb-3"
            description="这些提交改动了依赖（bun.lock / package.json）或镜像底座，一键更新只替换代码，做不了这类改动，需要按 docs/online-update.md 完整构建一次。"
            title="需要完整构建"
          />
        ) : null}
        {data.commits.length ? (
          <Card>
            <ul className="sysupd-commits">
              {data.commits.map((item) => (
                <li className="sysupd-commit list-enter" key={item.sha}>
                  <span className="sysupd-sha">{shortSha(item.sha)}</span>
                  <span className="sysupd-subject" title={item.subject}>
                    {item.subject}
                  </span>
                  <span className="sysupd-meta">{[item.author, timeText(item.date)].filter(Boolean).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <div className="sysupd-uptodate">
              <span className="sysupd-ok-ic">
                <IconCheck className="size-4" />
              </span>
              {data.behind === null ? "当前镜像没有记录来源提交，更新一次后这里会显示新提交。" : "已经是最新版本。"}
            </div>
          </Card>
        )}
      </PageSection>

      {data.job || data.pending.some((a) => a !== "check") ? <JobCard job={data.job} pending={data.pending} /> : null}

      <PageSection title="回滚">
        <Card>
          <SettingRow
            description={
              data.previous
                ? `切换回上一版 ${data.previous.image}${data.previous.commit ? `（${shortSha(data.previous.commit)}）` : ""}。只换镜像，数据库不回退。`
                : "还没有上一版可以回滚（第一次一键更新之后才有）。"
            }
            title="回滚到上一版"
          >
            <Button
              disabled={!data.previous || !data.updaterOnline || active}
              feedback={{ pending: "提交中…", success: "已开始", error: "未开始" }}
              onClick={() => void startRollback()}
              size="sm"
              state={rollback.state}
              variant="destructive"
            >
              <IconArrowBackUp />
              {"回滚"}
            </Button>
          </SettingRow>
        </Card>
      </PageSection>

      <SmokeSection />

      <PageSection title="历史">
        {data.history.length ? (
          <Card>
            <ul className="sysupd-history">
              {data.history.map((entry) => {
                const status = STATUS_TEXT[entry.status];
                return (
                  <li className="sysupd-hrow" key={entry.id}>
                    <time className="sysupd-htime" dateTime={entry.at}>
                      {timeText(entry.at)}
                    </time>
                    <div className="min-w-0 flex-1">
                      <div className="sysupd-ht">
                        <b>{ACTION_TEXT[entry.action]}</b>
                        {entry.fromImage || entry.toImage ? (
                          <span className="sysupd-mono">
                            {[entry.fromImage, entry.toImage].filter(Boolean).map((i) => i?.replace(/^.*:/u, "")).join(" → ")}
                          </span>
                        ) : null}
                      </div>
                      <div className="sysupd-hs">{[entry.actor, entry.error].filter(Boolean).join(" · ")}</div>
                    </div>
                    <span className={cn("device-badge is-sm", `is-${status.tone}`)}>{status.text}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <EmptyState description="一键更新和回滚都会记在这里，也写进 管理后台 → 审计。" icon={<IconHistory className="size-6" />} title="还没有更新记录" />
        )}
      </PageSection>
    </>
  );
}

/**
 * 更新后自检（docs/admin-smoke.md）：用聊天同一套模型配置做一次真实往返，不建对话、不写消息。
 * 结果只留在这一页的内存里。
 */
function SmokeSection() {
  const [result, setResult] = useState<AdminSmokeResult | null>(null);
  const smoke = useAsyncAction(
    async () => {
      const next = await runAdminSmoke();
      setResult(next);
      if (!next.ok) throw new Error(next.message);
    },
    { errorToast: (error) => error.message },
  );
  return (
    <PageSection title="自检">
      <Card>
        <SettingRow
          description={
            result ? (
              <span className={cn("sysupd-smoke", result.ok ? "is-ok" : "is-bad")} data-smoke-result="">
                {`${result.message} · ${result.model} · ${result.latencyMs} ms · 未保存任何对话`}
              </span>
            ) : (
              "用聊天同一套模型配置跟模型说一句话，确认这台服务器能正常回复。不会建对话，也不写任何消息。"
            )
          }
          title="模型往返自检"
        >
          <Button
            feedback={{ pending: "自检中…", success: "通过", error: "未通过" }}
            onClick={() => void smoke.run()}
            size="sm"
            state={smoke.state}
            variant="outline"
          >
            <IconStethoscope />
            {"自检"}
          </Button>
        </SettingRow>
      </Card>
    </PageSection>
  );
}

function JobCard({ job, pending }: { job: SystemUpdateJob | null; pending: SystemUpdateOverview["pending"] }) {
  const queued = !job || (job.status !== "running" && pending.some((a) => a !== "check"));
  const action = queued ? (pending.find((a) => a !== "check") ?? "update") : job.action;
  const steps = action === "rollback" ? ROLLBACK_STEPS : UPDATE_STEPS;
  const status = queued ? "queued" : job.status;
  const currentIndex = queued ? -1 : steps.findIndex((s) => s.key === job.step);
  const badge = STATUS_TEXT[status];
  return (
    <PageSection
      action={<span className={cn("device-badge", `is-${badge.tone}`)}>{badge.text}</span>}
      description={
        queued
          ? "已提交，等待宿主机更新程序开始（几秒内）。"
          : [job.actor ? `由 ${job.actor} 发起` : "", job.startedAt ? `开始于 ${timeText(job.startedAt)}` : "", job.finishedAt ? `结束于 ${timeText(job.finishedAt)}` : ""].filter(Boolean).join(" · ")
      }
      title={action === "rollback" ? "回滚进度" : "更新进度"}
    >
      <Card className="sysupd-job">
        <ol className="sysupd-steps">
          {steps.map((step, index) => {
            const failed = !queued && (status === "failed" || status === "rolled_back") && index === currentIndex;
            const state = queued
              ? "todo"
              : failed
                ? "failed"
                : status === "succeeded" || index < currentIndex
                  ? "done"
                  : index === currentIndex && status === "running"
                    ? "active"
                    : "todo";
            return (
              <li data-step={state} key={step.key}>
                <span className="sysupd-step-ic" aria-hidden>
                  {state === "done" ? <IconCheck className="size-3.5" /> : state === "failed" ? <IconX className="size-3.5" /> : state === "active" ? <i className="sysupd-spin" /> : null}
                </span>
                {step.label}
              </li>
            );
          })}
        </ol>
        {!queued && job.error ? <p className="sysupd-error">{job.error}</p> : null}
        {!queued && job.log.length ? (
          <pre aria-label={"更新日志"} className="sysupd-log">
            {job.log.join("\n")}
          </pre>
        ) : null}
      </Card>
    </PageSection>
  );
}
