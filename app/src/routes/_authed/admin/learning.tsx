import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { PageSection, PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { deploymentCapabilitiesQueryOptions } from "@/lib/deployment/queries";
import {
  learningDeliveryQueryOptions,
  learningKeys,
  learningOverviewQueryOptions,
  learningSettingsQueryOptions,
  saveLearningSettings,
} from "@/lib/learning/queries";
import type {
  LearningSettings,
  LearningTarget,
} from "../../../../../shared/learning";

export const Route = createFileRoute("/_authed/admin/learning")({
  component: LearningPage,
});
const selectClass = "w-full rounded-md border bg-background px-3 py-2 text-sm";

function TargetFields({
  target,
  onChange,
  label,
}: {
  target: LearningTarget | null;
  onChange: (target: LearningTarget | null) => void;
  label: string;
}) {
  const fieldId = useId();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-2 text-sm" htmlFor={`${fieldId}-container`}>
        {label} {"容器 ID"}
        <Input
          id={`${fieldId}-container`}
          aria-label={`${label} 容器 ID`}
          value={target?.containerId ?? ""}
          maxLength={64}
          placeholder="support-learning"
          onChange={(event) =>
            onChange(
              event.target.value
                ? { ...target, containerId: event.target.value }
                : null,
            )
          }
        />
      </label>
      <label className="grid gap-2 text-sm" htmlFor={`${fieldId}-revision`}>
        {"精确修订（可选）"}
        <Input
          id={`${fieldId}-revision`}
          aria-label={`${label} 修订`}
          value={target?.revision ?? ""}
          disabled={!target}
          placeholder={"最新发布"}
          maxLength={256}
          onChange={(event) => {
            if (target)
              onChange({
                containerId: target.containerId,
                ...(event.target.value ? { revision: event.target.value } : {}),
              });
          }}
        />
      </label>
    </div>
  );
}

export function LearningPage() {
  const capabilities = useQuery(deploymentCapabilitiesQueryOptions());

  if (capabilities.data?.mode === "local") {
    return (
      <PageShell title="自动学习" description="当前部署使用本地模式。">
        <PageSection
          title="自动学习未启用"
          description="本地模式未启用厂商的自动学习服务（AutomaticLearning），因此此页不提供对话分析、技能候选审核或自动发布功能。"
        />
        <PageSection
          title="ChisaBot 技能仍可使用"
          description="现有的 ChisaBot 技能继续可用，您也可以手动创建、修改和维护技能，并将技能分配给机器人。"
        >
          <Link to="/admin/skills" className="mt-4 inline-block text-sm underline">
            管理 ChisaBot 技能
          </Link>
        </PageSection>
      </PageShell>
    );
  }

  if (!capabilities.data) {
    return (
      <PageShell title="自动学习">
        <PageSection>
          {capabilities.error ? (
            <div className="grid gap-4">
              <p role="alert" className="text-destructive text-sm">
                部署能力无法加载，请重试以确认当前模式。
              </p>
              <Button
                variant="outline"
                disabled={capabilities.isFetching}
                onClick={() => void capabilities.refetch()}
              >
                重试
              </Button>
            </div>
          ) : (
            <p role="status" className="text-sm">正在检查部署能力…</p>
          )}
        </PageSection>
      </PageShell>
    );
  }

  return <IntelligenceLearningPage />;
}

function IntelligenceLearningPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery(learningSettingsQueryOptions());
  const agents = useQuery(agentListQueryOptions());
  const hiddenAgents = useQuery(agentListQueryOptions(true));
  const roster = [...(agents.data ?? []), ...(hiddenAgents.data ?? [])];
  const [draft, setDraft] = useState<LearningSettings | null>(null);
  const [selected, setSelected] = useState("");
  const [saved, setSaved] = useState(false);
  const overview = useQuery(
    learningOverviewQueryOptions(selected || undefined),
  );
  const delivery = useQuery(learningDeliveryQueryOptions(selected));
  const settings = draft ?? settingsQuery.data;
  const save = useMutation({
    mutationFn: saveLearningSettings,
    onSuccess: async (next) => {
      queryClient.setQueryData(learningKeys.settings, next);
      setDraft(null);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: learningKeys.all });
    },
  });
  function change(next: LearningSettings) {
    setDraft(next);
    setSaved(false);
    save.reset();
  }
  const botIds = [
    ...new Set([
      ...roster.map((agent) => agent.id),
      ...Object.keys(settings?.agents ?? {}),
    ]),
  ];
  const nameFor = (id: string) =>
    roster.find((agent) => agent.id === id)?.name ?? id;
  const snapshot = overview.data;

  return (
    <PageShell
      title={"自动学习"}
      description={
        "收集已完成的对话作为证据，审查 Intelligence 提出的技能，并将已发布的指导交付给机器人。"
      }
    >
      <PageSection
        title={"参与"}
        description={
          "容器分配的更改适用于新线程。现有线程保持其第一个分配。容器必须已经在同一 Intelligence 项目中存在。"
        }
      >
        {settingsQuery.isPending && <p role="status">{"正在加载学习设置…"}</p>}
        {settingsQuery.error && (
          <p role="alert" className="text-destructive">
            {settingsQuery.error.message}
          </p>
        )}
        {settings && (
          <form
            className="grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate(settings);
            }}
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={settings.enabled}
                onChange={(event) =>
                  change({ ...settings, enabled: event.target.checked })
                }
              />
              {"启用自动学习和技能传递"}
            </label>
            <TargetFields
              label={"默认"}
              target={settings.defaultTarget}
              onChange={(defaultTarget) =>
                change({ ...settings, defaultTarget })
              }
            />
            <p className="text-muted-foreground text-sm">
              {
                "空的默认值会排除未映射的机器人。ID 使用 1–64 个小写字母、数字和单个连字符。留空修订以遵循最新发布的技能。"
              }
            </p>
            <fieldset className="grid gap-4">
              <legend className="mb-3 font-medium">{"每个机器人的参与"}</legend>
              {(agents.error || hiddenAgents.error) && (
                <p role="alert" className="text-destructive">
                  {"机器人列表无法加载。现有映射如下所示。"}
                </p>
              )}
              {botIds.map((id) => {
                const override = settings.agents[id];
                const mode = !Object.hasOwn(settings.agents, id)
                  ? "inherit"
                  : override === null
                    ? "exclude"
                    : "container";
                return (
                  <div key={id} className="grid gap-3 rounded-lg border p-4">
                    <label className="grid gap-2 text-sm font-medium">
                      {nameFor(id)}
                      <select
                        className={selectClass}
                        aria-label={`${nameFor(id)} 参与`}
                        value={mode}
                        onChange={(event) => {
                          const mappings = { ...settings.agents };
                          if (event.target.value === "inherit")
                            delete mappings[id];
                          else
                            mappings[id] =
                              event.target.value === "exclude"
                                ? null
                                : {
                                    containerId:
                                      settings.defaultTarget?.containerId ?? "",
                                  };
                          change({ ...settings, agents: mappings });
                        }}
                      >
                        <option value="inherit">{"使用部署默认值"}</option>
                        <option value="exclude">{"从学习中排除"}</option>
                        <option value="container">{"使用特定容器"}</option>
                      </select>
                    </label>
                    {mode === "container" && (
                      <TargetFields
                        label={nameFor(id)}
                        target={override ?? null}
                        onChange={(target) =>
                          change({
                            ...settings,
                            agents: {
                              ...settings.agents,
                              [id]: target ?? { containerId: "" },
                            },
                          })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </fieldset>
            <div className="flex items-center gap-3">
              <Button loading={save.isPending} type="submit" disabled={save.isPending}>
                {save.isPending ? "正在保存…" : "保存学习设置"}
              </Button>
              {saved && (
                <p role="status" className="text-sm">
                  {"设置已保存。"}
                </p>
              )}
            </div>
            {save.error && (
              <p role="alert" className="text-destructive">
                {save.error.message}
              </p>
            )}
          </form>
        )}
      </PageSection>
      <PageSection
        title={"查看并发布"}
        description={
          "Intelligence 分析已完成的运行并提出技能。审查其支持证据，并在机器人使用它们之前在 Intelligence 中发布批准的修订。"
        }
      >
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm">
            {"检查容器"}
            <select
              className={selectClass}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{"部署默认"}</option>
              {botIds.map((id) => (
                <option key={id} value={id}>
                  {nameFor(id)}
                </option>
              ))}
            </select>
          </label>
          {overview.isPending && <p role="status">{"正在检查智能…"}</p>}
          {overview.error && (
            <p role="alert" className="text-destructive">
              {overview.error.message}
            </p>
          )}
          {snapshot && (
            <>
              <p className="text-sm">
                {snapshot.configuration === "configured"
                  ? `${snapshot.container?.name} (${snapshot.container?.id})`
                  : snapshot.configuration === "invalid"
                    ? "选定的容器或仪器不可用。"
                    : snapshot.configuration === "selection_required"
                      ? "选择一个机器人或配置默认容器。"
                      : "未分配学习容器。"}
              </p>
              <dl className="grid grid-cols-2 gap-4 rounded-lg border p-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">{"线程准备就绪"}</dt>
                  <dd className="font-semibold text-xl">
                    {snapshot.pendingThreadCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{"待审核候选人"}</dt>
                  <dd className="font-semibold text-xl">
                    {snapshot.pendingCandidateCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{"已发布的技能"}</dt>
                  <dd className="font-semibold text-xl">
                    {snapshot.publishedSkillCount}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{"见解"}</dt>
                  <dd className="font-semibold text-xl">
                    {snapshot.insightCount}
                  </dd>
                </div>
              </dl>
              <p className="text-sm">
                {snapshot.hasActiveRun
                  ? "分析正在运行。"
                  : snapshot.latestRunStatus
                    ? `最新分析：${snapshot.latestRunStatus}。`
                    : "尚未运行分析。"}
              </p>
              <div className="flex flex-wrap gap-4 text-sm underline">
                <a
                  href={snapshot.links.learning}
                  target="_blank"
                  rel="noreferrer"
                >
                  {"在Intelligence中管理学习"}
                </a>
                {snapshot.links.candidates && (
                  <a
                    href={snapshot.links.candidates}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {"查看技能候选"}
                  </a>
                )}
                {snapshot.links.runs && (
                  <a
                    href={snapshot.links.runs}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {"查看分析运行"}
                  </a>
                )}
              </div>
            </>
          )}
          {selected && (
            <div className="grid gap-2 rounded-lg border p-4 text-sm">
              <h3 className="font-medium">{"技能交付"}</h3>
              {delivery.isPending ? (
                <p>{"正在检查交付…"}</p>
              ) : delivery.error ? (
                <p role="alert">{delivery.error.message}</p>
              ) : (
                delivery.data && (
                  <>
                    <p>
                      {!delivery.data.configured
                        ? "此机器人的交付已关闭。"
                        : !delivery.data.initialized
                          ? "正在等待首个验证的技能快照。"
                          : delivery.data.stale
                            ? "正在使用上次验证的快照；刷新正在进行。"
                            : "已验证快照可用。"}
                    </p>
                    {delivery.data.revision && (
                      <p>
                        {"已加载修订："}
                        {delivery.data.revision}
                      </p>
                    )}
                    {delivery.data.lastCheckedAt && (
                      <p>
                        {"最后检查："}{" "}
                        {new Date(delivery.data.lastCheckedAt).toLocaleString(
                          "zh-CN",
                        )}
                      </p>
                    )}
                    {delivery.data.error && (
                      <p role="alert">{delivery.data.error.message}</p>
                    )}
                  </>
                )
              )}
            </div>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={overview.isFetching || delivery.isFetching}
            onClick={() => {
              void overview.refetch();
              if (selected) void delivery.refetch();
            }}
          >
            {"刷新状态"}
          </Button>
          <p className="text-muted-foreground text-sm">
            {
              "管理需要您的Intelligence账号和项目权限。ChisaBot 将项目凭据保存在服务器上。暂停此处会保留设置和线程分配；计划和发布仍由Intelligence管理。"
            }
          </p>
        </div>
      </PageSection>
    </PageShell>
  );
}
