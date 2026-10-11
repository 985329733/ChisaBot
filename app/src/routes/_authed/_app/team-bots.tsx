import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChannelAvatar } from "@/components/channels/avatar";
import { PageShell, PageSection } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import {
  assignTeamBotMutationOptions,
  clearTeamBotConsentsMutationOptions,
  publishTeamBotMutationOptions,
  type TeamBot,
  teamBotLink,
  teamBotsQueryOptions,
  unpublishTeamBotMutationOptions,
} from "@/lib/team-bots";

/**
 * Team Bots: find the Bots teammates published, publish your own to the team or to named people and
 * groups, and (administrators) put one in a group's sidebars. A chat with a Team Bot is always the
 * teammate's own; its owner cannot read it.
 */
export const Route = createFileRoute("/_authed/_app/team-bots")({
  component: TeamBotsPage,
});

const list = (value: string) =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

function TeamBotsPage() {
  const data = useQuery(teamBotsQueryOptions());
  const me = useQuery(currentUserQueryOptions()).data;
  const clear = useMutation(clearTeamBotConsentsMutationOptions());
  const bots = data.data?.teamBots ?? [];
  const shared = bots.filter((bot) => !bot.mine);
  const mine = bots.filter((bot) => bot.mine);

  return (
    <PageShell
      description={
        "同事发布给你的机器人，以及你发布出去的机器人。你和团队机器人的聊天，它的所有者看不到。"
      }
      title={"团队 Bot"}
    >
      {data.isError ? (
        <p className="text-sm text-destructive" role="alert">
          {data.error.message}
        </p>
      ) : null}
      <PageSection title={"共享给我的"}>
        {shared.length === 0 ? (
          <p className="page-empty-line">{"还没有人把机器人发布给你。"}</p>
        ) : (
          shared.map((bot) => <TeamBotRow bot={bot} key={bot.id} />)
        )}
      </PageSection>
      <PageSection title={"我发布的"}>
        {mine.map((bot) => (
          <div className="flex flex-col gap-2" key={bot.id}>
            <TeamBotRow bot={bot} />
            <PublishForm botId={bot.id} current={bot} />
          </div>
        ))}
        {(data.data?.publishable ?? []).length ? (
          <PublishNew publishable={data.data?.publishable ?? []} />
        ) : mine.length === 0 ? (
          <p className="page-empty-line">{"你没有可以发布的机器人。"}</p>
        ) : null}
      </PageSection>
      {me?.role === "admin" ? (
        <PageSection
          description={"分配的机器人会出现在每个成员的左栏里，成员不能隐藏。用 * 表示整个团队。"}
          title={"分配到组"}
        >
          {bots.map((bot) => (
            <Assignments bot={bot} key={bot.id} />
          ))}
        </PageSection>
      ) : null}
      <PageSection
        description={"团队机器人默认用所有者的已连接应用；只有你在卡片上允许后，才会用你的账号。"}
        title={"我的账号"}
      >
        <div className="flex items-center gap-2">
          <Button
            disabled={clear.isPending}
            onClick={() => clear.mutate()}
            size="sm"
            variant="outline"
          >
            {"清除连接器偏好"}
          </Button>
          {clear.isSuccess ? (
            <span className="text-sm text-muted-foreground" role="status">
              {"已清除。团队机器人将再次询问。"}
            </span>
          ) : null}
        </div>
      </PageSection>
    </PageShell>
  );
}

function TeamBotRow({ bot }: { bot: TeamBot }) {
  const queryClient = useQueryClient();
  const unpublish = useMutation(unpublishTeamBotMutationOptions(queryClient));
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
      data-team-bot={bot.id}
    >
      <ChannelAvatar participantIds={[bot.id]} size={28} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{bot.name}</span>
        <span className="truncate text-sm text-muted-foreground">
          {bot.title}
          {bot.assigned ? "· 分配给你" : ""}
          {bot.mine && !bot.visibleToTeam
            ? "· 直到有真实名称和描述才对同事隐藏"
            : ""}
          {bot.mine
            ? bot.audience === "team"
              ? "· 发布到整个团队"
              : `· 发布到 ${[...(bot.people ?? []), ...(bot.groups ?? []).map((group) => `group ${group}`)].join(", ")}`
            : ""}
        </span>
      </div>
      <Button
        render={(props) => (
          <Link {...props} search={{ agent: bot.id }} to="/channel/new" />
        )}
        size="sm"
      >
        {"开始私聊"}
      </Button>
      <CopyButton size="sm" value={() => teamBotLink(bot.id)} variant="outline">
        {"复制链接"}
      </CopyButton>
      {bot.mine ? (
        <Button
          disabled={unpublish.isPending}
          onClick={() => unpublish.mutate(bot.id)}
          size="sm"
          variant="ghost"
        >
          {"取消发布"}
        </Button>
      ) : null}
    </div>
  );
}

function PublishNew({
  publishable,
}: {
  publishable: { id: string; name: string }[];
}) {
  const [botId, setBotId] = useState(publishable[0]?.id ?? "");
  return (
    <div className="glass-card flex flex-col gap-3 rounded-[20px] p-5">
      <label className="grid gap-1.5 text-sm font-medium">
        {"发布一个机器人"}
        <select
          className="h-10 max-w-sm rounded-[14px] border border-[var(--line-strong)] bg-[var(--glass-2)] px-3 font-normal text-sm"
          onChange={(event) => setBotId(event.target.value)}
          value={botId}
        >
          {publishable.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </label>
      {botId ? <PublishForm botId={botId} key={botId} /> : null}
    </div>
  );
}

/** Who a Bot is published to: the whole team, or named people and groups. */
function PublishForm({ botId, current }: { botId: string; current?: TeamBot }) {
  const queryClient = useQueryClient();
  const publish = useMutation(publishTeamBotMutationOptions(queryClient));
  const [audience, setAudience] = useState<"team" | "people">(
    current?.audience ?? "team",
  );
  const [emails, setEmails] = useState((current?.people ?? []).join(", "));
  const [groups, setGroups] = useState((current?.groups ?? []).join(", "));
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        publish.mutate({
          botId,
          audience,
          emails: audience === "people" ? list(emails) : [],
          groups: audience === "people" ? list(groups) : [],
        });
      }}
    >
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            checked={audience === "team"}
            name={`audience-${botId}`}
            onChange={() => setAudience("team")}
            type="radio"
          />
          {"整个团队"}
        </label>
        <label className="flex items-center gap-1.5">
          <input
            checked={audience === "people"}
            name={`audience-${botId}`}
            onChange={() => setAudience("people")}
            type="radio"
          />
          {"特定的人或群组"}
        </label>
      </div>
      {audience === "people" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            aria-label={"人员，按电子邮件"}
            onChange={(event) => setEmails(event.target.value)}
            placeholder={"人员，按电子邮件，逗号分隔"}
            value={emails}
          />
          <Input
            aria-label={"组"}
            onChange={(event) => setGroups(event.target.value)}
            placeholder={"组，用逗号分隔"}
            value={groups}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button mutation={publish} feedback={current ? { pending: "更新中…", success: "已更新", error: "更新失败" } : { pending: "发布中…", success: "已发布", error: "发布失败" }} size="sm" type="submit">
          {current ? "更新" : "发布到团队"}
        </Button>
        {publish.error ? (
          <span className="text-sm text-destructive" role="alert">
            {publish.error.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Assignments({ bot }: { bot: TeamBot }) {
  const queryClient = useQueryClient();
  const assign = useMutation(assignTeamBotMutationOptions(queryClient));
  const [group, setGroup] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">{bot.name}</span>
      {(bot.assignments ?? []).map((name) => (
        <Button
          aria-label={`移除 ${name}`}
          key={name}
          onClick={() =>
            assign.mutate({ botId: bot.id, group: name, remove: true })
          }
          size="sm"
          variant="outline"
        >
          {name === "*" ? "整个团队" : name} ×
        </Button>
      ))}
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          assign.mutate(
            { botId: bot.id, group },
            { onSuccess: () => setGroup("") },
          );
        }}
      >
        <Input
          aria-label={`将 ${bot.name} 分配给一个组`}
          className="w-40"
          onChange={(event) => setGroup(event.target.value)}
          placeholder={"组，或 *"}
          value={group}
        />
        <Button mutation={assign}
          feedback={{ pending: "分配中…", success: "已分配", error: "分配失败" }}
          disabled={!group.trim()}
          size="sm"
          type="submit"
        >
          {"分配"}
        </Button>
      </form>
      {assign.error ? (
        <span className="text-destructive" role="alert">
          {assign.error.message}
        </span>
      ) : null}
    </div>
  );
}
