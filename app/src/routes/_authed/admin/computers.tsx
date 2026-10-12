import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  PageEmpty,
  PageRows,
  PageSection,
  PageShell,
} from "@/components/layout/page-shell";
import { StaggerItem } from "@/components/layout/stagger";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
  ItemTitle,
} from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { useBotNames } from "@/lib/agents/bot-names";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { setComputerStateMutationOptions } from "@/lib/computers/mutations";
import {
  hostAccessQueryOptions,
  requestHostFolderGrantMutationOptions,
  revokeHostFolderGrantMutationOptions,
  stopHostAccessMutationOptions,
  type HostFolderGrant,
  type HostAccessPendingOperation,
} from "@/lib/computers/host-access";
import { computerFleetQueryOptions } from "@/lib/computers/queries";

export const Route = createFileRoute("/_authed/admin/computers")({
  component: ComputersPage,
});

function ComputersPage() {
  /** Bot id currently running a stop/reset request. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Reset deletes the browser profile, so it requires confirmation. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** Updating restarts a running computer mid-task, so it is confirmed too. */
  const [confirmingUpdate, setConfirmingUpdate] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const nameFor = useBotNames();

  const fleet = useQuery(computerFleetQueryOptions());
  const hostAccess = useQuery(hostAccessQueryOptions());
  const agents = useQuery(agentListQueryOptions());
  const setState = useMutation(setComputerStateMutationOptions(queryClient));
  const requestGrant = useMutation(
    requestHostFolderGrantMutationOptions(queryClient),
  );
  const revokeGrant = useMutation(
    revokeHostFolderGrantMutationOptions(queryClient),
  );
  const stopHostAccess = useMutation(
    stopHostAccessMutationOptions(queryClient),
  );

  const computers = fleet.data?.computers ?? null;
  const isolation = fleet.data?.isolation ?? null;
  /*
   * A list that could not be read. A refused stop, reset or update is said beside the buttons
   * instead, because the top of this page is a long scroll away from them.
   */
  const problem = fleet.error ? "无法列出计算机。" : null;
  const hostProblem = hostAccess.error
    ? hostAccess.error.message
    : requestGrant.error
      ? requestGrant.error.message
      : revokeGrant.error
        ? revokeGrant.error.message
        : stopHostAccess.error
          ? stopHostAccess.error.message
          : null;

  const run = (botId: string, action: "stop" | "reset" | "update") => {
    setBusy(botId);
    setConfirming(null);
    setConfirmingUpdate(null);
    setState.mutate({ action, botId }, { onSettled: () => setBusy(null) });
  };

  return (
    <PageShell
      description={
        "每个机器人的浏览器和它保存的配置文件。配置文件让机器人明天还能保持登录，重置配置文件会让它退出所有内容。"
      }
      title={"云端浏览器"}
    >
      {problem ? (
        <p
          className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          {problem}
        </p>
      ) : null}

      {isolation === "shared" ? (
        <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <span className="font-medium">{"每个机器人共享一个计算机。"}</span>{" "}
          {
            "他们共享其登录、文件和会话，因此机器人可以访问另一个登录的用户设置。"
          }
          <code>COMPUTER_SUPERVISOR_URL</code> {"给每个机器人自己的。"}
        </p>
      ) : isolation === "per-bot" ? (
        <p className="mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground text-sm">
          {
            "每个机器人都有自己的计算机：自己的容器、自己的文件和自己的浏览器配置文件。"
          }
        </p>
      ) : null}

      <HostFoldersSection
        connected={hostAccess.data?.connected ?? false}
        grants={hostAccess.data?.grants ?? []}
        botIds={(agents.data ?? []).map((agent) => agent.id)}
        loading={hostAccess.isPending || agents.isPending}
        nameFor={nameFor}
        onGrant={(botId) => requestGrant.mutate({ botId })}
        onRevoke={(grantId) => revokeGrant.mutate({ grantId })}
        onStop={() => stopHostAccess.mutate()}
        pending={hostAccess.data?.pending ?? []}
        problem={hostProblem}
        requestingBotId={
          requestGrant.isPending
            ? (requestGrant.variables?.botId ?? null)
            : null
        }
        revokingGrantId={
          revokeGrant.isPending
            ? (revokeGrant.variables?.grantId ?? null)
            : null
        }
        stopping={stopHostAccess.isPending}
      />

      <PageSection title={"此部署中的计算机"}>
        {setState.error ? (
          <p
            className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
            role="alert"
          >
            {setState.error.message}
          </p>
        ) : null}
        {computers === null && problem ? (
          <PageEmpty>{"列表无法加载。"}</PageEmpty>
        ) : computers === null ? null : computers.length === 0 ? (
          <PageEmpty>
            {"尚未有计算机。下次机器人打开页面时会出现一个。"}
          </PageEmpty>
        ) : (
          <PageRows>
            {computers.map((computer, index) => (
              <StaggerItem index={index} key={computer.botId}>
                <Item size="sm">
                  <ItemContent>
                    <ItemTitle title={computer.botId}>
                      {nameFor(computer.botId)}
                    </ItemTitle>
                    <ItemDescription>
                      {computer.running
                        ? `浏览器运行于 ${new Date(computer.startedAt ?? "").toLocaleTimeString("zh-CN")}`
                        : "没有正在运行的浏览器。下次机器人需要时它会启动。"}
                      {" · "}
                      {computer.egress === undefined
                        ? "出口未报告"
                        : computer.egress === null
                          ? "直接离开"
                          : `通过 ${computer.egress} 离开`}
                      {computer.updateAvailable ? "· 有更新可用" : ""}
                    </ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    {computer.updateAvailable ? (
                      <Button
                        disabled={busy === computer.botId}
                        onClick={() => setConfirmingUpdate(computer.botId)}
                        size="sm"
                        variant="outline"
                      >
                        {"更新计算机"}
                      </Button>
                    ) : null}
                    <Button
                      disabled={busy === computer.botId || !computer.running}
                      onClick={() => void run(computer.botId, "stop")}
                      size="sm"
                      variant="outline"
                    >
                      {busy === computer.botId ? "正在处理中…" : "停止浏览器"}
                    </Button>
                    <Button
                      disabled={busy === computer.botId}
                      onClick={() => setConfirming(computer.botId)}
                      size="sm"
                      variant="outline"
                    >
                      {"重置"}
                    </Button>
                  </ItemActions>
                </Item>
                {index !== computers.length - 1 && <Separator />}
              </StaggerItem>
            ))}
          </PageRows>
        )}
      </PageSection>

      {/*
       * A DIALOG RATHER THAN AN INLINE CONFIRM. Resetting signs a Bot out of everything it has ever
       * logged into and cannot be undone, and the row it was confirmed on was one of several
       * identical-looking rows. The dialog names the Bot, so the sentence somebody agrees to says
       * which computer it destroys.
       */}
      <Dialog
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
        open={confirming !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {"重置"}
              {confirming ? nameFor(confirming) : ""}
              {"'s 计算机？"}
            </DialogTitle>
            <DialogDescription>
              {
                "它的配置文件被删除，因此机器人已从它登录的每个服务中注销并开始干净。这不能被撤销。"
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setConfirming(null)}
              size="sm"
              variant="ghost"
            >
              {"取消"}
            </Button>
            <Button
              disabled={busy === confirming}
              onClick={() => {
                if (confirming) void run(confirming, "reset");
              }}
              size="sm"
              variant="destructive"
            >
              {busy === confirming ? "正在重置…" : "重置它"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setConfirmingUpdate(null);
        }}
        open={confirmingUpdate !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {"更新"}
              {confirmingUpdate ? nameFor(confirmingUpdate) : ""}
              {"'s 计算机？"}
            </DialogTitle>
            <DialogDescription>
              {
                "它移动到此部署现在运行的计算机镜像上。它的文件和登录被保留。如果它正在运行，它会重新启动，这会中断它当前正在做的任何事情。"
              }
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setConfirmingUpdate(null)}
              size="sm"
              variant="ghost"
            >
              {"取消"}
            </Button>
            <Button
              disabled={busy === confirmingUpdate}
              onClick={() => {
                if (confirmingUpdate) void run(confirmingUpdate, "update");
              }}
              size="sm"
            >
              {busy === confirmingUpdate ? "更新中…" : "更新它"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="mt-4 text-muted-foreground text-sm">
        <strong>{"停止"}</strong>{" "}
        {
          "关闭浏览器并保留其登录信息：机器人接下来要做的第一件事是在它离开的地方重新启动它。"
        }{" "}
        <strong>{"重置"}</strong>{" "}
        {"删除配置文件，这样机器人退出所有内容并干净开始。"}
        <strong>{"更新计算机"}</strong>{" "}
        {
          "当计算机运行比此部署更旧的镜像时出现，并将其移动到新版本，保留其文件和登录记录。三者都记录在"
        }{" "}
        <Link className="underline" to="/admin/audit">
          {"审计"}
        </Link>
        .
      </p>
    </PageShell>
  );
}

type HostFoldersSectionProps = {
  botIds: string[];
  connected: boolean;
  grants: HostFolderGrant[];
  loading: boolean;
  nameFor: (botId: string) => string;
  onGrant: (botId: string) => void;
  onRevoke: (grantId: string) => void;
  onStop: () => void;
  pending: HostAccessPendingOperation[];
  problem: string | null;
  requestingBotId: string | null;
  revokingGrantId: string | null;
  stopping: boolean;
};

function HostFoldersSection({
  botIds: knownBotIds,
  connected,
  grants,
  loading,
  nameFor,
  onGrant,
  onRevoke,
  onStop,
  pending,
  problem,
  requestingBotId,
  revokingGrantId,
  stopping,
}: HostFoldersSectionProps) {
  const botIds = Array.from(
    new Set([
      ...knownBotIds,
      ...grants.map((grant) => grant.botId),
      ...pending.map((one) => one.botId),
    ]),
  ).sort((left, right) => nameFor(left).localeCompare(nameFor(right)));

  return (
    <PageSection
      description={
        "选择机器人可以在此计算机上读取的文件夹。桌面应用在每次编辑或命令前都会询问。访问在你停止 ChisaBot 时结束。"
      }
      title={"此计算机上的文件夹"}
    >
      {problem ? (
        <p
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          role="alert"
        >
          {problem}
        </p>
      ) : null}

      {!connected && !loading ? (
        <p className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {
            "桌面应用离线。文件夹只能从桌面应用批准，命令访问在离线时保持不可用。"
          }
        </p>
      ) : null}

      {loading ? null : botIds.length === 0 ? (
        <PageEmpty>{"尚无机器人。在选择文件夹之前创建机器人。"}</PageEmpty>
      ) : (
        <PageRows>
          {botIds.map((botId, index) => (
            <StaggerItem index={index} key={botId}>
              <Item size="sm">
                <ItemContent>
                  <ItemTitle title={botId}>{nameFor(botId)}</ItemTitle>
                  <ItemDescription>
                    {summaryFor(botId, grants, pending)}
                  </ItemDescription>
                  <FolderGrantList
                    botId={botId}
                    grants={grants}
                    onRevoke={onRevoke}
                    pending={pending}
                    revokingGrantId={revokingGrantId}
                  />
                </ItemContent>
                <ItemActions>
                  <Button
                    disabled={!connected || requestingBotId === botId}
                    onClick={() => onGrant(botId)}
                    size="sm"
                    variant="outline"
                  >
                    {requestingBotId === botId ? "等待中…" : "选择文件夹"}
                  </Button>
                </ItemActions>
              </Item>
              {index !== botIds.length - 1 && <Separator />}
            </StaggerItem>
          ))}
        </PageRows>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-sm">
        <p>{"授权默认只读。当机器人需要时，从原生桌面提示请求写入。"}</p>
        <div className="flex items-center gap-3">
          <Button
            disabled={!connected || stopping}
            onClick={onStop}
            size="sm"
            variant="outline"
          >
            {stopping ? "正在停止…" : "停止文件夹访问"}
          </Button>
          <Link className="underline" to="/admin/audit">
            {"查看审计"}
          </Link>
        </div>
      </div>
    </PageSection>
  );
}

function FolderGrantList({
  botId,
  grants,
  onRevoke,
  pending,
  revokingGrantId,
}: {
  botId: string;
  grants: HostFolderGrant[];
  onRevoke: (grantId: string) => void;
  pending: HostAccessPendingOperation[];
  revokingGrantId: string | null;
}) {
  const botGrants = grants.filter(
    (grant) => grant.botId === botId && !grant.revoked,
  );
  const botPending = pending.filter((request) => request.botId === botId);

  if (botGrants.length === 0 && botPending.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-2">
      {botGrants.map((grant) => (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2"
          key={grant.id}
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-sm">{grant.displayName}</p>
            <p className="text-muted-foreground text-xs">
              {ownerLabel(grant)} {"· 只读"}
            </p>
          </div>
          <Button
            disabled={revokingGrantId === grant.id}
            onClick={() => onRevoke(grant.id)}
            size="sm"
            variant="ghost"
          >
            {revokingGrantId === grant.id ? "撤销中…" : "撤销"}
          </Button>
        </div>
      ))}
      {botPending.map((request) => (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          key={request.operationId}
        >
          {pendingLabel(request)} {"从"}
          {ownerLabel(request)}
          {request.displayName ? `用于 ${request.displayName}` : ""}.
        </div>
      ))}
    </div>
  );
}

function summaryFor(
  botId: string,
  grants: HostFolderGrant[],
  pending: HostAccessPendingOperation[],
) {
  const active = grants.filter(
    (grant) => grant.botId === botId && !grant.revoked,
  ).length;
  const waiting = pending.filter((request) => request.botId === botId).length;
  const parts = [];
  if (active > 0) parts.push(`${active} 个只读文件夹`);
  if (waiting > 0) parts.push(`${waiting} 项待处理请求`);
  return parts.length > 0 ? parts.join(" · ") : "尚未批准任何文件夹访问。";
}

function ownerLabel(grant: { ownerName?: string; ownerEmail?: string }) {
  return grant.ownerName ?? grant.ownerEmail ?? "桌面所有者";
}

function pendingLabel(request: HostAccessPendingOperation) {
  switch (request.kind) {
    case "write_file":
      return "文件修改正在等待审批或完成";
    case "run_command":
      return "命令正在等待审批或完成";
    case "list_files":
      return "正在列出文件";
    case "read_file":
      return "正在读取文件";
    case "cancel":
    case "stop":
      return "正在停止文件夹操作";
    default:
      return "文件夹访问正在等待审批";
  }
}
