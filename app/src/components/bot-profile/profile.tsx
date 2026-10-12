import {
  IconBell,
  IconMessage,
  IconPlayerPause,
  IconRefresh,
  IconRoute,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { AbstractAvatar } from "@/components/agents/abstract-avatar";
import { BotModelSelector } from "@/components/agents/bot-model-selector";
import { DeleteBotDialog } from "@/components/agents/delete-bot-dialog";
import { PageRows, PageSection, PageSkeleton } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { runWithPageLoader } from "@/components/ui/page-loader";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import type { AgentProfile } from "@/lib/agents/queries";
import {
  resetBotMutationOptions,
  setBotNotifyMutationOptions,
  setBotPausedMutationOptions,
  setUpdateRoutingMutationOptions,
} from "@/lib/bot-lifecycle/mutations";
import {
  type BotNotify,
  botLifecycleQueryOptions,
  botResetPlanQueryOptions,
  type ResetPlan,
  type UpdateKind,
  type UpdateTransport,
  updateRoutingQueryOptions,
} from "@/lib/bot-lifecycle/queries";
import { queryClient } from "@/query-client";
import { BotActivitySections } from "./activity";
import { BotPausedBanner } from "./pause-banner";

const NOTIFY_LABEL: Record<BotNotify, string> = {
  all: "全部",
  needs_input: "仅在需要我时",
  none: "Nothing (badges only)",
};

const KIND_LABEL: Record<UpdateKind, { title: string; description: string }> = {
  progress: {
    title: "进度",
    description: "您未关注的工作的回复和结果。",
  },
  decision: {
    title: "决策",
    description: "机器人执行前需要的审批。",
  },
  question: {
    title: "问题",
    description: "机器人向您询问并等待的内容。",
  },
};

const TRANSPORTS: { id: UpdateTransport; label: string }[] = [
  { id: "push", label: "推送" },
  { id: "slack", label: "Slack" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "sms", label: "短信" },
];

const selectClass = "h-8 rounded-md border bg-background px-2 text-sm";

/** Each count the notice lists, in the words the person reads, skipping the kinds with nothing. */
function resetLines(plan: ResetPlan): string[] {
  const lines: [number, string, string][] = [
    [plan.conversations, "conversation", "conversations"],
    [plan.memorySources, "memory source", "memory sources"],
    [plan.memories, "imported memory", "imported memories"],
    [plan.routines, "routine", "routines"],
    [plan.responsibilities, "responsibility", "responsibilities"],
    [plan.followUps, "scheduled follow-up", "scheduled follow-ups"],
    [plan.formedMemories, "memory it formed", "memories it formed"],
    [plan.backgroundResearch, "background research", "background research"],
    [plan.standingApprovals, "standing permission", "standing permissions"],
  ];
  return lines
    .filter(([count]) => count > 0)
    .map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
}

function ResetDialog({
  agent,
  onOpenChange,
  open,
}: {
  agent: AgentProfile;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const plan = useQuery({
    ...botResetPlanQueryOptions(agent.id),
    enabled: open,
  });
  const reset = useMutation(resetBotMutationOptions(queryClient));
  const lines = plan.data ? resetLines(plan.data) : [];
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {"重置"}
            {agent.name}?
          </DialogTitle>
          <DialogDescription>
            {"此操作将删除什么"}
            {agent.name}{" "}
            {"与您有，仅与您。没有人触及其他人的对话或数据。这不可撤销。"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="mt-4 overflow-y-auto">
          {plan.isPending ? <PageSkeleton /> : plan.error ? (
            <p className="text-destructive text-sm" role="alert">
              {"无法计算重置会删除的内容。"}
            </p>
          ) : reset.isSuccess ? (
            <p className="text-sm">
              {"完成。"}
              {agent.name} {"与你重新开始。"}
            </p>
          ) : (
            <div className="grid gap-2 text-sm">
              {lines.length === 0 ? (
                <p>{"没有您的可删除内容。"}</p>
              ) : (
                <>
                  <p>{"这将删除："}</p>
                  <ul className="list-disc pl-5">
                    {lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </>
              )}
              {plan.data.sharedConversationsKept > 0 ? (
                <p className="text-muted-foreground">
                  {plan.data.sharedConversationsKept} {"对话"}
                  {plan.data.sharedConversationsKept === 1 ? "是" : "运行中"}{" "}
                  {"与其他人或机器人共享并将被保留。"}
                </p>
              ) : null}
              <p className="text-muted-foreground">
                {"您自己的记忆，即您直接告诉机器人的那些记忆，被保留。"}
              </p>
            </div>
          )}
          {reset.error ? (
            <p className="mt-2 text-destructive text-sm" role="alert">
              {reset.error.message}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter className="mt-4">
          <Button
            onClick={() => onOpenChange(false)}
            size="sm"
            variant="outline"
          >
            {reset.isSuccess ? "关闭" : "取消"}
          </Button>
          {reset.isSuccess ? null : (
            <Button
              disabled={!plan.data || lines.length === 0 || reset.isPending}
              onClick={() => {
                // A reset wipes the Bot's data in several steps — DESIGN.md §1 ③, the full-page loader.
                onOpenChange(false);
                void runWithPageLoader(
                  {
                    title: "正在重置机器人…",
                    description: "正在删除它的数据并恢复到初始状态，请稍候。",
                    successText: "已重置",
                    errorTitle: "重置失败",
                  },
                  () => reset.mutateAsync(agent.id),
                ).catch(() => undefined);
              }}
              size="sm"
              variant="destructive"
            >
              {"删除并重置"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UpdateRoutingSection() {
  const routing = useQuery(updateRoutingQueryOptions());
  const save = useMutation(setUpdateRoutingMutationOptions(queryClient));
  return (
    <PageSection
      description={
        "当您不在时，每种更新去哪里。网页总是显示一切。适用于所有您的机器人。"
      }
      title={"更新去哪里"}
    >
      {routing.isPending ? <PageSkeleton /> : routing.error ? (
        <p className="mt-4 text-destructive text-sm" role="alert">
          {"无法加载更新去向。"}
        </p>
      ) : (
        <PageRows>
          {(Object.keys(KIND_LABEL) as UpdateKind[]).map((kind, index) => {
            const current = routing.data[kind];
            const allowed = (transport: UpdateTransport) =>
              current === "all" || current.includes(transport);
            return (
              <Fragment key={kind}>
                {index > 0 ? <Separator /> : null}
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconRoute />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{KIND_LABEL[kind].title}</ItemTitle>
                    <ItemDescription>
                      {KIND_LABEL[kind].description}
                    </ItemDescription>
                  </ItemContent>
                  <ItemFooter className="gap-4 pl-8">
                    {TRANSPORTS.map((transport) => (
                      <div
                        className="flex items-center gap-2 text-sm"
                        key={transport.id}
                      >
                        <Switch
                          aria-label={`${KIND_LABEL[kind].title} 由 ${transport.label}`}
                          checked={allowed(transport.id)}
                          disabled={save.isPending}
                          onCheckedChange={(checked) => {
                            const next = TRANSPORTS.map((t) => t.id).filter(
                              (id) =>
                                id === transport.id ? checked : allowed(id),
                            );
                            save.mutate({
                              kind,
                              transports:
                                next.length === TRANSPORTS.length
                                  ? "all"
                                  : next,
                            });
                          }}
                          size="sm"
                        />
                        {transport.label}
                      </div>
                    ))}
                  </ItemFooter>
                </Item>
              </Fragment>
            );
          })}
        </PageRows>
      )}
    </PageSection>
  );
}

/** A Bot's own page: its state for you, what it is doing, and the lifecycle controls. */
export function BotProfile({ agent }: { agent: AgentProfile }) {
  const lifecycle = useQuery(botLifecycleQueryOptions(agent.id));
  const pause = useMutation(setBotPausedMutationOptions(queryClient));
  const notify = useMutation(setBotNotifyMutationOptions(queryClient));
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [permission, setPermission] = useState<string>(() => {
    try {
      return typeof Notification === "undefined"
        ? "unsupported"
        : Notification.permission;
    } catch {
      return "unsupported";
    }
  });

  return (
    <>
      <div className="mt-6 flex items-center gap-3">
        <AbstractAvatar name={agent.name} seed={agent.avatarSeed} size={40} />
        <div className="min-w-0">
          <p className="truncate font-medium">{agent.title}</p>
          <p className="line-clamp-2 text-muted-foreground text-sm">
            {agent.roleDescription}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <BotPausedBanner agentId={agent.id} />
      </div>

      <PageSection title="模型设置" description="此 BOT 的模型与聊天输入框保持同步。">
        <PageRows><Item size="sm"><ItemContent><BotModelSelector agentId={agent.id} /></ItemContent></Item></PageRows>
      </PageSection>

      <PageSection title={"为您"}>
        {lifecycle.isPending ? <PageSkeleton /> : lifecycle.error ? (
          <p className="mt-4 text-destructive text-sm" role="alert">
            {"无法加载此机器人的状态。"}
          </p>
        ) : (
          <PageRows>
            <Item size="sm">
              <ItemMedia variant="icon">
                <IconPlayerPause />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{"已暂停"}</ItemTitle>
                <ItemDescription>
                  {lifecycle.data.paused
                    ? "您没有定时任务、长期任务、移交或后续任务开始运行，已运行的已停止。"
                    : "为您运行定时任务、长期任务、交接和后续工作。"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Switch
                  aria-label={"已暂停"}
                  checked={lifecycle.data.paused}
                  disabled={pause.isPending}
                  onCheckedChange={(paused) =>
                    pause.mutate({ agentId: agent.id, paused })
                  }
                />
              </ItemActions>
            </Item>
            <Separator />
            <Item size="sm">
              <ItemMedia variant="icon">
                <IconBell />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{"通知"}</ItemTitle>
                <ItemDescription>
                  {NOTIFY_LABEL[lifecycle.data.notify]}
                  {". 侧边栏徽章始终显示。"}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <select
                  aria-label={"通知"}
                  className={selectClass}
                  disabled={notify.isPending}
                  onChange={(event) =>
                    notify.mutate({
                      agentId: agent.id,
                      notify: event.target.value as BotNotify,
                    })
                  }
                  value={lifecycle.data.notify}
                >
                  {(Object.keys(NOTIFY_LABEL) as BotNotify[]).map((value) => (
                    <option key={value} value={value}>
                      {NOTIFY_LABEL[value]}
                    </option>
                  ))}
                </select>
              </ItemActions>
            </Item>
            {permission === "default" ? (
              <>
                <Separator />
                <Item size="sm">
                  <ItemMedia variant="icon">
                    <IconBell />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{"浏览器通知"}</ItemTitle>
                    <ItemDescription>
                      {"此浏览器中关闭。打开它们以在机器人需要您时听到。"}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      onClick={async () => {
                        try {
                          setPermission(await Notification.requestPermission());
                        } catch {
                          setPermission("unsupported");
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {"开启"}
                    </Button>
                  </ItemActions>
                </Item>
              </>
            ) : null}
            <Separator />
            <Item
              render={<Link to="/channel/new" search={{ agent: agent.id }} />}
              size="sm"
            >
              <ItemMedia variant="icon">
                <IconMessage />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {"消息"}
                  {agent.name}
                </ItemTitle>
                <ItemDescription>{"开始对话。"}</ItemDescription>
              </ItemContent>
            </Item>
            <Separator />
            <Item
              render={
                <button onClick={() => setResetOpen(true)} type="button" />
              }
              size="sm"
            >
              <ItemMedia variant="icon">
                <IconRefresh />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{"重置"}</ItemTitle>
                <ItemDescription>
                  {
                    "删除与它的对话、它记住的内容以及它的定时任务。你可以看到先删除什么。"
                  }
                </ItemDescription>
              </ItemContent>
            </Item>
            {(agent.canDelete ?? agent.canManage) ? (
              <>
                <Separator />
                <Item
                  render={
                    <button onClick={() => setDeleteOpen(true)} type="button" />
                  }
                  size="sm"
                >
                  <ItemMedia className="text-destructive" variant="icon">
                    <IconTrash />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="text-destructive">{"删除机器人"}</ItemTitle>
                    <ItemDescription>
                      {
                        "彻底删除这个机器人，以及你与它的私人会话、记忆、定时任务和面板。此操作无法撤消。"
                      }
                    </ItemDescription>
                  </ItemContent>
                </Item>
              </>
            ) : null}
          </PageRows>
        )}
      </PageSection>

      <BotActivitySections agentId={agent.id} />
      <UpdateRoutingSection />
      <ResetDialog agent={agent} onOpenChange={setResetOpen} open={resetOpen} />
      <DeleteBotDialog
        bot={{ id: agent.id, name: agent.name }}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
      />
    </>
  );
}
