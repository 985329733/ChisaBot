import {
  IconCopy,
  IconDots,
  IconDownload,
  IconFileImport,
  IconPencil,
  IconPlayerPlayFilled,
  IconPlus,
  IconShieldCheck,
  IconTrash,
  IconUsers,
  IconArrowsSplit2,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { WorkflowRunView, WorkflowSummary } from "../../../../../shared/workflows";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { RunStatusBadge } from "@/components/workflows/run-status";
import { RunWorkflowDialog } from "@/components/workflows/run-dialog";
import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, EmptyState, ErrorCard } from "@/components/ui/skyglass";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { relativeTime } from "@/lib/relative-time";
import {
  downloadWorkflow,
  durationText,
  tokensText,
  workflowKeys,
  workflowLibraryQueryOptions,
  workflowsApi,
} from "@/lib/workflows";

export const Route = createFileRoute("/_authed/_app/workflows/")({
  validateSearch: (search: Record<string, unknown>): { run?: string } =>
    typeof search.run === "string" ? { run: search.run } : {},
  component: WorkflowsPage,
});

/**
 * 工作流库（DESIGN.md §26）：最近运行 · 我的工作流 · 预设。卡片上「运行」打开参数表单，
 * 跑起来以后进运行页看每一步。
 */
function WorkflowsPage() {
  const { data, isPending, isError, refetch } = useQuery(workflowLibraryQueryOptions());
  const { run: runId } = Route.useSearch();
  const navigate = useNavigate({ from: "/workflows/" });
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const all = [...(data?.mine ?? []), ...(data?.presets ?? [])];
  const running = all.find((w) => w.id === runId) ?? null;

  const importFile = useAsyncAction(async (file: File) => {
    if (file.size > 256 * 1024) throw new Error("文件太大（最多 256 KB）");
    const { workflow } = await workflowsApi.import(await file.text());
    await queryClient.invalidateQueries({ queryKey: workflowKeys.all });
    toast.success(`已导入「${workflow.definition.name}」`);
  });

  return (
    <PageShell
      action={
        <div className="flex items-center gap-2">
          <input
            accept=".md,.markdown,.yaml,.yml,.json,text/markdown"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file)
                void importFile.run(file).catch((error: Error) => toast.error(error.message || "导入失败"));
            }}
            ref={fileRef}
            type="file"
          />
          <Button
            feedback={{ pending: "导入中…", success: "已导入", error: "导入失败" }}
            onClick={() => fileRef.current?.click()}
            size="sm"
            state={importFile.state}
            variant="outline"
          >
            <IconFileImport />
            {"导入"}
          </Button>
          <Button nativeButton={false} render={<Link params={{ workflowId: "new" }} to="/workflows/$workflowId" />} size="sm">
            <IconPlus />
            {"新建工作流"}
          </Button>
        </div>
      }
      description="把几个机器人、技能和约束编排成固定的步骤，像技能一样拿来就能跑。也可以在聊天里说「运行调研报告工作流」。"
      title="工作流"
    >
      {isError && !data ? (
        <ErrorCard
          action={
            <Button className="mt-2" onClick={() => void refetch()} size="sm" variant="outline">
              {"重试"}
            </Button>
          }
          title="工作流无法加载"
        />
      ) : null}

      {isPending ? (
        <div className="wf-grid mt-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton className="h-[148px] rounded-[20px]" key={i} />
          ))}
        </div>
      ) : null}

      {data && data.runs.length > 0 ? (
        <PageSection title="最近运行">
          <Card className="wf-runs">
            {data.runs.slice(0, 6).map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </Card>
        </PageSection>
      ) : null}

      {data ? (
        <PageSection description="你自己写的、导入的，或从预设复制来改的。" title="我的工作流">
          {data.mine.length === 0 ? (
            <EmptyState
              action={
                <Button nativeButton={false} render={<Link params={{ workflowId: "new" }} to="/workflows/$workflowId" />} size="sm" variant="outline">
                  <IconPlus />
                  {"新建工作流"}
                </Button>
              }
              description="从下面的预设「复制为我的工作流」改一改最快，也可以导入别人分享的 WORKFLOW.md。"
              icon={<IconArrowsSplit2 className="size-6" />}
              title="还没有自己的工作流"
            />
          ) : (
            <div className="wf-grid mt-3">
              {data.mine.map((workflow) => (
                <WorkflowCard key={workflow.id} onRun={() => void navigate({ search: { run: workflow.id } })} workflow={workflow} />
              ))}
            </div>
          )}
        </PageSection>
      ) : null}

      {data ? (
        <PageSection description="ChisaBot 自带。可以直接运行，也可以复制一份再改。" title="预设工作流">
          <div className="wf-grid mt-3">
            {data.presets.map((workflow) => (
              <WorkflowCard key={workflow.id} onRun={() => void navigate({ search: { run: workflow.id } })} workflow={workflow} />
            ))}
          </div>
        </PageSection>
      ) : null}

      <RunWorkflowDialog
        onOpenChange={(open) => {
          if (!open) void navigate({ search: {} });
        }}
        workflowId={running?.id ?? null}
      />
    </PageShell>
  );
}

function RunRow({ run }: { run: WorkflowRunView }) {
  const done = run.steps.filter((s) => s.status === "succeeded").length;
  return (
    <Link className="wf-run-row" params={{ runId: run.id }} to="/workflows/runs/$runId">
      <span aria-hidden className="wf-run-icon">
        {run.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="wf-run-title">{run.workflowName}</span>
        <span className="wf-run-sub">
          {relativeTime(run.createdAt)}
          {" · "}
          {`${done}/${run.steps.length} 步`}
          {" · "}
          {`约 ${tokensText(run.usage.tokens)} token`}
          {run.usage.elapsedMs ? ` · ${durationText(run.usage.elapsedMs)}` : ""}
        </span>
      </span>
      <RunStatusBadge status={run.status} />
    </Link>
  );
}

function WorkflowCard({ workflow, onRun }: { workflow: WorkflowSummary; onRun: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const mine = workflow.kind === "mine";

  const duplicate = async () => {
    setBusy(true);
    try {
      const { workflow: copy } = await workflowsApi.duplicate(workflow.id);
      await queryClient.invalidateQueries({ queryKey: workflowKeys.library });
      toast.success(`已复制为「${copy.definition.name}」`);
      void navigate({ to: "/workflows/$workflowId", params: { workflowId: copy.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: `删除「${workflow.name}」？`,
      description: "工作流定义会被删除，已经跑过的运行记录保留。这一步不能撤销。",
      confirmLabel: "删除",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await workflowsApi.remove(workflow.id);
      await queryClient.invalidateQueries({ queryKey: workflowKeys.library });
      toast.success("已删除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={busy ? "wf-card is-busy" : "wf-card"}>
      <div className="wf-card-top">
        <span aria-hidden className="wf-card-icon">
          {workflow.icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="wf-card-title">{workflow.name}</h3>
          <p className="wf-card-desc">{workflow.description || "（没有说明）"}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button aria-label={`${workflow.name} 的更多操作`} size="icon-sm" variant="ghost">
                <IconDots />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {mine ? (
              <DropdownMenuItem onClick={() => void navigate({ to: "/workflows/$workflowId", params: { workflowId: workflow.id } })}>
                <IconPencil />
                {"编辑"}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => void navigate({ to: "/workflows/$workflowId", params: { workflowId: workflow.id } })}>
                <IconPencil />
                {"查看定义"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => void duplicate()}>
              <IconCopy />
              {mine ? "复制" : "复制为我的工作流"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void downloadWorkflow(workflow.id, workflow.slug).catch(() => toast.error("导出失败"))}
            >
              <IconDownload />
              {"导出 WORKFLOW.md"}
            </DropdownMenuItem>
            {mine ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void remove()} variant="destructive">
                  <IconTrash />
                  {"删除"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="wf-card-foot">
        <span className="wf-chips">
          <span className="wf-chip">
            <IconUsers className="size-3.5" />
            {`${workflow.botCount} 个角色`}
          </span>
          <span className="wf-chip">{`${workflow.stepCount} 步`}</span>
          {workflow.hasParallel ? <span className="wf-chip">{"含并行"}</span> : null}
          {workflow.hasApproval ? (
            <span className="wf-chip is-warn">
              <IconShieldCheck className="size-3.5" />
              {"需审批"}
            </span>
          ) : null}
        </span>
        <Button onClick={onRun} size="sm">
          <IconPlayerPlayFilled />
          {"运行"}
        </Button>
      </div>
    </Card>
  );
}
