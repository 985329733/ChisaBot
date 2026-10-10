import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Streamdown } from "streamdown";
import { IconPlus } from "@tabler/icons-react";
import { PageSection, PageShell, PageSkeleton } from "@/components/layout/page-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, ErrorCard } from "@/components/ui/skyglass";
import { Button } from "@/components/ui/button";
import { CopyButton as SharedCopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { conversationLabel } from "@/lib/channels/label";
import { channelListQueryOptions } from "@/lib/channels/queries";
import { markdownComponents } from "@/lib/markdown";
import {
  createGithubBinding,
  createResponsibility,
  createTrigger,
  githubBindingsQueryOptions,
  type ResponsibilityRecord,
  removeGithubBinding,
  removeTrigger,
  responsibilitiesQueryOptions,
  responsibilityAction,
  responsibilityKeys,
  responsibilityRunsQueryOptions,
  revealTriggerSecret,
  setTriggerEnabled,
  setTriggerSecret,
  type TriggerConfig,
  type TriggerKind,
  type TriggerRecord,
  triggersQueryOptions,
  updateResponsibility,
} from "@/lib/responsibilities";
import { queryClient } from "@/query-client";

export const Route = createFileRoute("/_authed/_app/responsibilities")({
  component: ResponsibilitiesPage,
});
const fieldClass = "grid min-w-0 gap-1 text-sm";
const selectClass =
  "h-9 w-full min-w-0 max-w-full rounded-md border bg-background px-3 text-sm";
async function refresh() {
  await queryClient.invalidateQueries({ queryKey: responsibilityKeys.all });
}

function ResponsibilitiesPage() {
  const goals = useQuery(responsibilitiesQueryOptions());
  const [creating, setCreating] = useState(false);
  return (
    <PageShell
      action={
        <Button onClick={() => setCreating(true)}>
          <IconPlus />
          {"新长期任务"}
        </Button>
      }
      title={"长期任务"}
      description={"为机器人设定持久目标，跟踪其进展，并决定何时应执行。"}
    >
      {/* Template B: create in a dialog, the list in cards, event sources as a secondary section. */}
      <Dialog onOpenChange={setCreating} open={creating}>
        <DialogContent className="max-h-[88svh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{"新长期任务"}</DialogTitle>
            <DialogDescription>{"选一个对话和其中的机器人，写下它要持续负责的事。"}</DialogDescription>
          </DialogHeader>
          <NewResponsibility onCreated={() => window.setTimeout(() => setCreating(false), 900)} />
        </DialogContent>
      </Dialog>
      <PageSection title={"进行中的任务"}>
        <div className="mt-3 grid gap-4">
          {goals.isPending ? (
            <PageSkeleton rows={2} />
          ) : goals.error ? (
            <ErrorCard description={goals.error.message} title={"长期任务加载失败"} />
          ) : goals.data?.length ? (
            goals.data.map((goal) => <GoalCard key={goal.id} goal={goal} />)
          ) : (
            <EmptyState
              action={
                <Button onClick={() => setCreating(true)}>
                  <IconPlus />
                  {"新长期任务"}
                </Button>
              }
              description={"给机器人一个持久目标，它会按计划或事件持续推进。"}
              title={"您还没有长期任务"}
            />
          )}
        </div>
      </PageSection>
      <PageSection>
        <GithubSources />
      </PageSection>
    </PageShell>
  );
}

function NewResponsibility({ onCreated }: { onCreated?: () => void }) {
  const formId = useId();
  const bots = useQuery(agentListQueryOptions());
  const channels = useInfiniteQuery(channelListQueryOptions());
  const [channelId, setChannelId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [source, setSource] = useState<
    "none" | ResponsibilityRecord["subscriptions"][number]["source"]
  >("none");
  const [eventType, setEventType] = useState("");
  const selectedChannel = channels.data?.find(
    (channel) => channel.id === channelId,
  );
  const availableBots =
    bots.data?.filter((bot) => selectedChannel?.agentIds.includes(bot.id)) ??
    [];
  const create = useMutation({
    mutationFn: createResponsibility,
    onSuccess: async () => {
      setTitle("");
      setInstruction("");
      setSuccessCriteria("");
      await refresh();
      onCreated?.();
    },
  });
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate({
          channelId,
          agentId,
          title,
          instruction,
          successCriteria,
          subscriptions: source === "none" ? [] : [{ source, eventType }],
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldClass}>
          {"对话"}
          <select
            className={selectClass}
            required
            value={channelId}
            onChange={(event) => {
              setChannelId(event.target.value);
              setAgentId("");
            }}
          >
            <option value="">{"选择一个对话"}</option>
            {channels.data
              ?.filter((channel) => channel.active)
              .map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {conversationLabel(channel)}
                </option>
              ))}
          </select>
        </label>
        <label className={fieldClass}>
          {"机器人"}
          <select
            className={selectClass}
            required
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            <option value="">{"选择一个机器人"}</option>
            {availableBots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {channels.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          onClick={() => channels.fetchNextPage()}
        >
          {"加载更多会话"}
        </Button>
      )}
      {(channels.error || bots.error) && (
        <p role="alert" className="text-destructive">
          {channels.error?.message ?? bots.error?.message}
        </p>
      )}
      <label className={fieldClass} htmlFor={`${formId}-title`}>
        {"标题"}
        <Input
          id={`${formId}-title`}
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={"保持客户报告最新"}
        />
      </label>
      <label className={fieldClass} htmlFor={`${formId}-instruction`}>
        {"指令"}
        <Textarea
          id={`${formId}-instruction`}
          required
          maxLength={6000}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />
      </label>
      <label className={fieldClass} htmlFor={`${formId}-criteria`}>
        {"成功标准"}
        <Textarea
          id={`${formId}-criteria`}
          required
          maxLength={3000}
          value={successCriteria}
          onChange={(event) => setSuccessCriteria(event.target.value)}
          placeholder={"报告包含本季度的图表和来源链接。"}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={fieldClass}>
          {"事件源"}
          <select
            className={selectClass}
            value={source}
            onChange={(event) => {
              const value = event.target.value;
              if (
                value === "none" ||
                value === "github" ||
                value === "slack" ||
                value === "connector" ||
                value === "schedule" ||
                value === "manual"
              )
                setSource(value);
            }}
          >
            <option value="none">{"被要求时运行"}</option>
            <option value="github">{"GitHub"}</option>
            <option value="slack">{"Slack"}</option>
            <option value="connector">{"已连接应用"}</option>
            <option value="schedule">{"计划"}</option>
          </select>
        </label>
        {source !== "none" && (
          <label className={fieldClass} htmlFor={`${formId}-event`}>
            {"事件类型"}
            <Input
              id={`${formId}-event`}
              required
              maxLength={128}
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
              placeholder={source === "github" ? "issues.opened" : "事件类型"}
            />
          </label>
        )}
      </div>
      {create.error && (
        <p role="alert" className="text-destructive">
          {create.error.message}
        </p>
      )}
      <Button mutation={create} feedback="create" type="submit">
        {"创建长期任务"}
      </Button>
    </form>
  );
}

function GoalCard({ goal }: { goal: ResponsibilityRecord }) {
  const [editing, setEditing] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [title, setTitle] = useState(goal.title);
  const [instruction, setInstruction] = useState(goal.instruction);
  const [successCriteria, setSuccessCriteria] = useState(goal.successCriteria);
  const action = useMutation({
    mutationFn: (value: "pause" | "resume" | "complete" | "run") =>
      responsibilityAction(goal.id, value),
    onSuccess: refresh,
  });
  const edit = useMutation({
    mutationFn: () =>
      updateResponsibility(goal.id, { title, instruction, successCriteria }),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const runs = useQuery({
    ...responsibilityRunsQueryOptions(goal.id),
    enabled: showRuns,
  });
  return (
    <article className="grid gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{goal.title}</h2>
        <span className="rounded bg-muted px-2 py-1 text-xs capitalize">
          {goal.status}
        </span>
      </div>
      {editing ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            edit.mutate();
          }}
        >
          <label className={fieldClass} htmlFor={`${goal.id}-title`}>
            {"标题"}
            <Input
              id={`${goal.id}-title`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={160}
            />
          </label>
          <label className={fieldClass} htmlFor={`${goal.id}-instruction`}>
            {"指令"}
            <Textarea
              id={`${goal.id}-instruction`}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              required
              maxLength={6000}
            />
          </label>
          <label className={fieldClass} htmlFor={`${goal.id}-criteria`}>
            {"成功标准"}
            <Textarea
              id={`${goal.id}-criteria`}
              value={successCriteria}
              onChange={(event) => setSuccessCriteria(event.target.value)}
              required
              maxLength={3000}
            />
          </label>
          <div className="flex gap-2">
            <Button mutation={edit} feedback="save" type="submit">
              {"保存"}
            </Button>
            <Button
              variant="outline"
              type="button"
              onClick={() => setEditing(false)}
            >
              {"取消"}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm">{goal.instruction}</p>
          <p className="text-sm text-muted-foreground">
            {"成功："}
            {goal.successCriteria}
          </p>
        </>
      )}
      {goal.progress && (
        <div className="text-sm">
          <span className="font-medium">{"进度："}</span>
          <RunMarkdown>{goal.progress}</RunMarkdown>
        </div>
      )}
      {goal.lastResult && (
        <div className="rounded bg-muted p-3 text-sm">
          <RunMarkdown>{goal.lastResult}</RunMarkdown>
        </div>
      )}
      {goal.subscriptions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {"事件："}{" "}
          {goal.subscriptions
            .map(
              (subscription) =>
                `${subscription.source} · ${subscription.eventType}`,
            )
            .join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEditing(!editing)}
        >
          {"编辑"}
        </Button>
        {goal.status === "active" && (
          <>
            <Button
              size="sm"
              disabled={action.isPending}
              onClick={() => {
                setShowRuns(true);
                action.mutate("run");
              }}
              title={"现在真实运行：机器人完成工作并可以发布和行动。"}
            >
              {"立即运行（真实运行）"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={action.isPending}
              onClick={() => action.mutate("pause")}
            >
              {"暂停"}
            </Button>
          </>
        )}
        {goal.status === "paused" && (
          <Button
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate("resume")}
          >
            {"恢复"}
          </Button>
        )}
        {goal.status !== "completed" && (
          <Button
            variant="outline"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate("complete")}
          >
            {"完成"}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowRuns(!showRuns)}
        >
          {showRuns ? "隐藏运行" : "查看运行"}
        </Button>
        <Link
          to="/channel/$channelId"
          params={{ channelId: goal.channelId }}
          className="self-center text-sm underline"
        >
          {"打开对话"}
        </Link>
      </div>
      {(action.error || edit.error) && (
        <p role="alert" className="text-destructive">
          {action.error?.message ?? edit.error?.message}
        </p>
      )}
      <Triggers goal={goal} />
      {showRuns && (
        <div className="grid gap-2 border-t pt-3">
          {runs.isPending ? (
            <p>{"正在加载运行…"}</p>
          ) : runs.error ? (
            <p role="alert">{runs.error.message}</p>
          ) : runs.data?.length ? (
            runs.data.map((run) => (
              <div key={run.id} className="text-sm">
                <p>
                  <span className={runStatusClass(run.status)}>
                    {RUN_LABEL[run.status]}
                  </span>{" "}
                  · {new Date(run.createdAt).toLocaleString("zh-CN")} ·{" "}
                  <Link
                    to="/channel/$channelId"
                    params={{ channelId: goal.channelId }}
                    className="underline"
                  >
                    {"打开线程"}
                  </Link>
                </p>
                {run.waiting && (
                  <p>
                    {"等待"}
                    {run.waiting.kind}
                    {". 通过你的审批收件箱或对话回复。"}
                  </p>
                )}
                {run.error && (
                  <p className="text-muted-foreground">{run.error}</p>
                )}
                {run.replyText && <RunMarkdown>{run.replyText}</RunMarkdown>}
              </div>
            ))
          ) : (
            <p>{"暂无运行。"}</p>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * A Bot's own words, drawn the way the conversation draws them.
 *
 * Progress, the last result and each run's reply are the Bot's markdown, and shown as plain text
 * they read as literal asterisks and backticks. Same renderer and components as the transcript, kept
 * to the row's size: no heading scale, tight paragraph and list spacing.
 */
function RunMarkdown({ children }: { children: string }) {
  return (
    <Streamdown
      className="min-w-0 text-sm [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm [&_li]:my-0 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
      components={markdownComponents}
      mode="static"
    >
      {children}
    </Streamdown>
  );
}

function GithubSources() {
  const formId = useId();
  const bindings = useQuery(githubBindingsQueryOptions());
  const [repository, setRepository] = useState("");
  const [secret, setSecret] = useState("");
  const create = useMutation({
    mutationFn: () => createGithubBinding(repository, secret),
    onSuccess: async () => {
      setSecret("");
      setRepository("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: removeGithubBinding,
    onSuccess: refresh,
  });
  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-semibold">{"GitHub 事件源"}</h2>
      <p className="text-sm text-muted-foreground">
        {
          "注册一个仓库，然后使用下面的端点和相同的密钥在 GitHub 中添加其 webhook。订阅一个长期任务到如 issues.opened 的事件。"
        }
      </p>
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className={fieldClass} htmlFor={`${formId}-repository`}>
          {"仓库"}
          <Input
            id={`${formId}-repository`}
            value={repository}
            onChange={(event) => setRepository(event.target.value)}
            placeholder={"owner/repository"}
            required
          />
        </label>
        <label className={fieldClass} htmlFor={`${formId}-secret`}>
          {"Webhook 密钥"}
          <Input
            id={`${formId}-secret`}
            type="password"
            autoComplete="new-password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            required
          />
        </label>
        <Button mutation={create} feedback={{ pending: "连接中…", success: "已连接", error: "连接失败" }} type="submit" className="self-end">
          {"连接事件"}
        </Button>
      </form>
      {(bindings.error || create.error || remove.error) && (
        <p role="alert" className="text-destructive">
          {bindings.error?.message ??
            create.error?.message ??
            remove.error?.message}
        </p>
      )}
      {bindings.data?.map((binding) => (
        <div
          key={binding.id}
          className="flex flex-wrap items-center justify-between gap-2 border-t pt-3"
        >
          <div>
            <p className="text-sm">{binding.repository}</p>
            <code className="break-all text-xs">
              {window.location.origin}/api/events/github/{binding.id}
            </code>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => remove.mutate(binding.id)}
          >
            {"断开连接"}
          </Button>
        </div>
      ))}
    </section>
  );
}

const RUN_LABEL: Record<string, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "等待你处理",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
};
function runStatusClass(status: string) {
  return status === "failed"
    ? "text-destructive"
    : status === "succeeded"
      ? "text-emerald-600 dark:text-emerald-500"
      : "text-muted-foreground";
}

const KIND_LABEL: Record<TriggerKind, string> = {
  webhook: "Webhook",
  github: "GitHub",
  linear: "Linear",
  sentry: "Sentry",
  pagerduty: "PagerDuty",
  email: "Email",
  slack: "Slack",
};
const KIND_HELP: Record<TriggerKind, string> = {
  webhook:
    "POST JSON to the URL with the authorization header (or Standard Webhooks signature headers). 200 means accepted and queued, not finished.",
  github:
    "In the repository's Settings → Webhooks, set the payload URL to this URL, content type application/json, and the secret to the key.",
  linear:
    "In Linear, Settings → API → Webhooks: set the URL, then paste the signing secret Linear shows here.",
  sentry:
    "In a Sentry internal integration, set the webhook URL, then paste the integration's client secret here.",
  pagerduty:
    "In PagerDuty, Integrations → Generic Webhooks (v3): set the URL, then paste the secret shown on creation here.",
  email: "Send or forward mail to this address to start a run.",
  slack:
    "Fires from Slack events delivered through this Bot's Slack pairing. Messages from before the trigger existed are ignored.",
};
const VENDOR_SECRET: ReadonlySet<TriggerKind> = new Set([
  "linear",
  "sentry",
  "pagerduty",
]);
const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <SharedCopyButton size="sm" value={value} variant="outline">
      {label}
    </SharedCopyButton>
  );
}

function describeFilter(config: TriggerConfig) {
  if (config.kind === "slack") {
    const where = config.channels.length
      ? `in ${config.channels.join(", ")}`
      : "in every channel the Bot is in";
    const what =
      config.mode === "mention"
        ? "when the Bot is mentioned"
        : config.mode === "message"
          ? "on any message"
          : config.mode === "phrase"
            ? `on messages containing ${config.phrases.map((phrase) => `"${phrase}"`).join(" or ")}`
            : `on reactions${config.reactions.length ? ` :${config.reactions.join(": :")}:` : ""}`;
    return `${what} ${where}（工作区 ${config.teamId}）`;
  }
  const parts = [
    config.filter.eventTypes.length
      ? `events ${config.filter.eventTypes.join(", ")}`
      : "every event",
  ];
  if (config.filter.field)
    parts.push(
      `where ${config.filter.field.path} = ${config.filter.field.equals}`,
    );
  if (config.kind === "github" && config.repository)
    parts.push(`from ${config.repository}`);
  if (config.kind === "email" && config.allowedSenders.length)
    parts.push(`from ${config.allowedSenders.join(", ")} (authenticated)`);
  return parts.join(" ");
}

function Triggers({ goal }: { goal: ResponsibilityRecord }) {
  const triggers = useQuery(triggersQueryOptions(goal.id));
  const [adding, setAdding] = useState(false);
  const [freshSecret, setFreshSecret] = useState<{
    id: string;
    secret: string;
  } | null>(null);
  const reload = () =>
    queryClient.invalidateQueries({
      queryKey: responsibilityKeys.triggers(goal.id),
    });
  return (
    <section className="grid gap-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium text-sm">{"触发器"}</h3>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={() => setAdding(!adding)}
        >
          {adding ? "取消" : "添加触发器"}
        </Button>
      </div>
      {goal.status !== "active" && (
        <p className="text-muted-foreground text-xs">
          {"这个长期任务是"}
          {goal.status}
          {", 因此其触发器被确认但从未运行它。"}
        </p>
      )}
      {adding && (
        <NewTrigger
          goalId={goal.id}
          onCreated={async (created) => {
            setAdding(false);
            if (created.secret)
              setFreshSecret({
                id: created.trigger.id,
                secret: created.secret,
              });
            await reload();
          }}
        />
      )}
      {triggers.error && (
        <p role="alert" className="text-destructive text-sm">
          {triggers.error.message}
        </p>
      )}
      {triggers.data?.length === 0 && !adding && (
        <p className="text-muted-foreground text-xs">
          {"无触发器。它在您按下立即运行时运行，或在上面的事件订阅上。"}
        </p>
      )}
      {triggers.data?.map((trigger) => (
        <TriggerRow
          key={trigger.id}
          trigger={trigger}
          freshSecret={
            freshSecret?.id === trigger.id ? freshSecret.secret : null
          }
          onChanged={async (secret) => {
            if (secret) setFreshSecret({ id: trigger.id, secret });
            await reload();
          }}
        />
      ))}
    </section>
  );
}

function TriggerRow({
  trigger,
  freshSecret,
  onChanged,
}: {
  trigger: TriggerRecord;
  freshSecret: string | null;
  onChanged: (secret: string | null) => Promise<void>;
}) {
  const [secret, setSecret] = useState<string | null>(freshSecret);
  const [pasted, setPasted] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const shown = freshSecret ?? secret;
  const reveal = useMutation({
    mutationFn: () => revealTriggerSecret(trigger.id),
    onSuccess: setSecret,
  });
  const rotate = useMutation({
    mutationFn: () =>
      setTriggerSecret(
        trigger.id,
        VENDOR_SECRET.has(trigger.kind) ? pasted : undefined,
      ),
    onSuccess: async (result) => {
      setPasted("");
      setSecret(result.secret);
      await onChanged(result.secret);
    },
  });
  const remove = useMutation({
    mutationFn: () => removeTrigger(trigger.id),
    onSuccess: () => onChanged(null),
  });
  const toggle = useMutation({
    mutationFn: () => setTriggerEnabled(trigger.id, !trigger.enabled),
    onSuccess: () => onChanged(null),
  });
  const url = trigger.path ? `${window.location.origin}${trigger.path}` : null;
  const generated = trigger.kind === "webhook" || trigger.kind === "github";
  return (
    <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-medium">{KIND_LABEL[trigger.kind]}</span>{" "}
          <span className="text-muted-foreground">
            {describeFilter(trigger.config)}
          </span>
          {!trigger.enabled && (
            <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-xs">
              {"已暂停"}
            </span>
          )}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {trigger.enabled ? "暂停" : "恢复"}
        </Button>
        {confirmRemove ? (
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {"彻底移除"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmRemove(false)}
            >
              {"保持"}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmRemove(true)}
          >
            {"移除"}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{KIND_HELP[trigger.kind]}</p>
      {url && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">{"POST 到"}</span>
          <code className="break-all rounded bg-background px-2 py-1 text-xs">
            {url}
          </code>
          <CopyButton value={url} label={"复制 URL"} />
        </div>
      )}
      {trigger.kind === "email" &&
        (trigger.address ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-background px-2 py-1 text-xs">
              {trigger.address}
            </code>
            <CopyButton value={trigger.address} label={"复制地址"} />
          </div>
        ) : (
          <p className="text-amber-600 text-xs dark:text-amber-500">
            {
              "此部署未配置入站邮件 (OPENBOT_INBOUND_EMAIL_DOMAIN 和 OPENBOT_INBOUND_EMAIL_SNS_TOPIC_ARNS)，因此此地址尚无法接收邮件"
            }
          </p>
        ))}
      {generated && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs">{"密钥"}</span>
          {shown ? (
            <>
              <code className="break-all rounded bg-background px-2 py-1 text-xs">
                {shown}
              </code>
              <CopyButton value={shown} label={"复制密钥"} />
              {trigger.kind === "webhook" && (
                <CopyButton
                  value={`Authorization: Bearer ${shown}`}
                  label={"复制头部"}
                />
              )}
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={reveal.isPending}
              onClick={() => reveal.mutate()}
            >
              {"显示关键"}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={rotate.isPending}
            onClick={() => rotate.mutate()}
          >
            {"旋转密钥"}
          </Button>
        </div>
      )}
      {trigger.kind === "webhook" && shown && (
        <code className="break-all rounded bg-background px-2 py-1 text-xs">
          Authorization: Bearer {shown}
        </code>
      )}
      {VENDOR_SECRET.has(trigger.kind) && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            rotate.mutate();
          }}
        >
          <span
            className={
              trigger.hasSecret
                ? "text-xs"
                : "text-amber-600 text-xs dark:text-amber-500"
            }
          >
            {trigger.hasSecret ? "签名密钥已存储" : "正在等待签名密钥"}
          </span>
          <Input
            className="h-8 max-w-64"
            type="password"
            autoComplete="new-password"
            placeholder={
              trigger.hasSecret ? "粘贴新的密钥以轮换" : "粘贴签名密钥"
            }
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            required
          />
          <Button mutation={rotate} feedback="save" size="sm" type="submit">
            {"保存密钥"}
          </Button>
        </form>
      )}
      {(reveal.error || rotate.error || remove.error || toggle.error) && (
        <p role="alert" className="text-destructive text-xs">
          {reveal.error?.message ??
            rotate.error?.message ??
            remove.error?.message ??
            toggle.error?.message}
        </p>
      )}
    </div>
  );
}

function NewTrigger({
  goalId,
  onCreated,
}: {
  goalId: string;
  onCreated: (created: {
    trigger: TriggerRecord;
    secret: string | null;
  }) => Promise<void>;
}) {
  const id = useId();
  const [kind, setKind] = useState<TriggerKind>("webhook");
  const [eventTypes, setEventTypes] = useState("");
  const [fieldPath, setFieldPath] = useState("");
  const [fieldEquals, setFieldEquals] = useState("");
  const [repository, setRepository] = useState("");
  const [senders, setSenders] = useState("");
  const [secret, setSecret] = useState("");
  const [teamId, setTeamId] = useState("");
  const [mode, setMode] = useState<
    "mention" | "phrase" | "reaction" | "message"
  >("mention");
  const [phrases, setPhrases] = useState("");
  const [reactions, setReactions] = useState("");
  const [channels, setChannels] = useState("");
  const config = (): TriggerConfig => {
    if (kind === "slack")
      return {
        kind,
        teamId: teamId.trim(),
        mode,
        phrases: list(phrases),
        reactions: list(reactions).map((reaction) =>
          reaction.replace(/:/g, ""),
        ),
        channels: list(channels),
      };
    const filter = {
      eventTypes: list(eventTypes),
      ...(fieldPath.trim() && fieldEquals.trim()
        ? { field: { path: fieldPath.trim(), equals: fieldEquals.trim() } }
        : {}),
    };
    if (kind === "github")
      return {
        kind,
        filter,
        ...(repository.trim() ? { repository: repository.trim() } : {}),
      };
    if (kind === "email")
      return { kind, filter, allowedSenders: list(senders) };
    return { kind, filter };
  };
  const create = useMutation({
    mutationFn: () =>
      createTrigger(goalId, {
        config: config(),
        ...(VENDOR_SECRET.has(kind) && secret ? { secret } : {}),
      }),
    onSuccess: onCreated,
  });
  const placeholder: Record<TriggerKind, string> = {
    webhook: "deploy.finished (blank: any)",
    github: "issues.opened, pull_request",
    linear: "Issue.create, Comment",
    sentry: "issue.created, event_alert.triggered",
    pagerduty: "incident.triggered",
    email: "received",
    slack: "",
  };
  return (
    <form
      className="grid gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <label className={fieldClass}>
        {"触发器"}
        <select
          className={selectClass}
          value={kind}
          onChange={(event) => setKind(event.target.value as TriggerKind)}
        >
          {(Object.keys(KIND_LABEL) as TriggerKind[]).map((value) => (
            <option key={value} value={value}>
              {KIND_LABEL[value]}
            </option>
          ))}
        </select>
      </label>
      <p className="text-muted-foreground text-xs">{KIND_HELP[kind]}</p>
      {kind === "slack" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={fieldClass} htmlFor={`${id}-team`}>
            {"Slack 团队 ID"}
            <Input
              id={`${id}-team`}
              required
              placeholder={"T0123ABCD"}
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
            />
          </label>
          <label className={fieldClass}>
            {"触发"}
            <select
              className={selectClass}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="mention">{"已提及机器人"}</option>
              <option value="phrase">{"消息包含短语"}</option>
              <option value="reaction">{"添加了反应"}</option>
              <option value="message">{"任何消息"}</option>
            </select>
          </label>
          {mode === "phrase" && (
            <label className={fieldClass} htmlFor={`${id}-phrases`}>
              {"短语（逗号分隔）"}
              <Input
                id={`${id}-phrases`}
                required
                value={phrases}
                onChange={(event) => setPhrases(event.target.value)}
              />
            </label>
          )}
          {mode === "reaction" && (
            <label className={fieldClass} htmlFor={`${id}-reactions`}>
              {"反应（空白：任何）"}
              <Input
                id={`${id}-reactions`}
                placeholder={"眼睛, 旋转灯"}
                value={reactions}
                onChange={(event) => setReactions(event.target.value)}
              />
            </label>
          )}
          <label className={fieldClass} htmlFor={`${id}-channels`}>
            {"会话 ID（留空：机器人所在的全部）"}
            <Input
              id={`${id}-channels`}
              placeholder={"C0123ABCD"}
              value={channels}
              onChange={(event) => setChannels(event.target.value)}
            />
          </label>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={fieldClass} htmlFor={`${id}-types`}>
            {"事件类型"}
            <Input
              id={`${id}-types`}
              placeholder={placeholder[kind]}
              value={eventTypes}
              onChange={(event) => setEventTypes(event.target.value)}
            />
          </label>
          <label className={fieldClass} htmlFor={`${id}-path`}>
            {"仅当字段"}
            <Input
              id={`${id}-path`}
              placeholder={"data.team.key"}
              value={fieldPath}
              onChange={(event) => setFieldPath(event.target.value)}
            />
          </label>
          <label className={fieldClass} htmlFor={`${id}-equals`}>
            {"等于"}
            <Input
              id={`${id}-equals`}
              placeholder={"工程"}
              value={fieldEquals}
              onChange={(event) => setFieldEquals(event.target.value)}
            />
          </label>
          {kind === "github" && (
            <label className={fieldClass} htmlFor={`${id}-repo`}>
              {"仓库（可选）"}
              <Input
                id={`${id}-repo`}
                placeholder={"owner/name"}
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
              />
            </label>
          )}
          {kind === "email" && (
            <label className={fieldClass} htmlFor={`${id}-senders`}>
              {"允许的发件人（留空：任何人）"}
              <Input
                id={`${id}-senders`}
                placeholder={"ops@example.com, example.com"}
                value={senders}
                onChange={(event) => setSenders(event.target.value)}
              />
            </label>
          )}
          {VENDOR_SECRET.has(kind) && (
            <label className={fieldClass} htmlFor={`${id}-secret`}>
              {"签名密钥（稍后可添加）"}
              <Input
                id={`${id}-secret`}
                type="password"
                autoComplete="new-password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          )}
        </div>
      )}
      {create.error && (
        <p role="alert" className="text-destructive text-sm">
          {create.error.message}
        </p>
      )}
      <Button mutation={create} feedback="add" type="submit">
        {`添加 ${KIND_LABEL[kind]} 触发器`}
      </Button>
    </form>
  );
}
