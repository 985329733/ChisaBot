import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { agentListQueryOptions } from "@/lib/agents/queries";
import { conversationLabel } from "@/lib/channels/label";
import { channelListQueryOptions } from "@/lib/channels/queries";
import {
  confirmSms,
  deliveryKey,
  deliveryQueryOptions,
  removeDeliveryBinding,
  removePushDevice,
  startChatLink,
  startSms,
} from "@/lib/delivery";
import { queryClient } from "@/query-client";

/**
 * The phone verification waiting for its code, kept for the tab.
 *
 * Only the challenge id lives in the page, and the text with the code arrives on the person's
 * phone a moment after they may have looked away: leaving and coming back used to drop the box to
 * type it into, with no way to confirm the code they had just been sent.
 */
const PENDING_SMS = "openbot.reachability.pendingSms";
function readPending(): string {
  try {
    return sessionStorage.getItem(PENDING_SMS) ?? "";
  } catch {
    return "";
  }
}
function writePending(id: string) {
  try {
    if (id) sessionStorage.setItem(PENDING_SMS, id);
    else sessionStorage.removeItem(PENDING_SMS);
  } catch {
    /* A browser that keeps nothing still confirms within the visit. */
  }
}

export const Route = createFileRoute("/_authed/_app/reachability")({
  component: ReachabilityPage,
});
function ReachabilityPage() {
  const reach = useQuery(deliveryQueryOptions());
  const channels = useInfiniteQuery(channelListQueryOptions());
  const bots = useQuery(agentListQueryOptions());
  // People read Bots by name; the id is what the list used to show.
  const botName = (id: string) =>
    bots.data?.find((bot) => bot.id === id)?.name ?? id;
  const [channelId, setChannelId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [phone, setPhone] = useState("");
  const [copied, setCopied] = useState(false);
  const [challengeId, setChallengeId] = useState(readPending);
  useEffect(() => writePending(challengeId), [challengeId]);
  const [code, setCode] = useState("");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: deliveryKey });
  const link = useMutation({
    mutationFn: (platform: "slack" | "teams") =>
      startChatLink({ channelId, agentId, platform }),
    onSuccess: () => setCopied(false),
  });
  const sms = useMutation({
    mutationFn: () => startSms({ channelId, agentId, phone }),
    onSuccess: setChallengeId,
  });
  const confirm = useMutation({
    mutationFn: () => confirmSms(challengeId, code),
    onSuccess: async () => {
      setChallengeId("");
      setCode("");
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: removeDeliveryBinding,
    onSuccess: refresh,
  });
  const deviceRemove = useMutation({
    mutationFn: removePushDevice,
    onSuccess: refresh,
  });
  const selected = channels.data?.find((channel) => channel.id === channelId);
  const error =
    reach.error ??
    channels.error ??
    link.error ??
    sms.error ??
    confirm.error ??
    remove.error ??
    deviceRemove.error;
  return (
    <PageShell
      title={"可达性"}
      description={
        "在 Slack、Microsoft Teams、通过短信或手机继续对话。问题和审批请求会发送到拥有对话的同一人。"
      }
    >
      <div className="grid gap-5">
        {error && (
          <p role="alert" className="text-destructive">
            {error.message}
          </p>
        )}
        <div className="grid gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{"连接一个会话"}</h2>
          <label className="grid gap-1 text-sm">
            {"对话"}
            <select
              className="h-9 rounded border bg-background px-3"
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
          <label className="grid gap-1 text-sm">
            {"机器人"}
            <select
              className="h-9 rounded border bg-background px-3"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              <option value="">{"选择一个机器人"}</option>
              {selected?.agentIds.map((id) => (
                <option key={id} value={id}>
                  {botName(id)}
                </option>
              ))}
            </select>
          </label>
          {channels.hasNextPage && (
            <Button variant="outline" onClick={() => channels.fetchNextPage()}>
              {"加载更多会话"}
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                !agentId || !reach.data?.available.slack || link.isPending
              }
              onClick={() => link.mutate("slack")}
            >
              {"链接 Slack"}
            </Button>
            <Button
              variant="outline"
              disabled={
                !agentId || !reach.data?.available.teams || link.isPending
              }
              onClick={() => link.mutate("teams")}
            >
              {"链接 Microsoft Teams"}
            </Button>
          </div>
          {link.data && (
            <div className="grid gap-2 rounded border bg-muted/40 p-3 text-sm">
              <p>
                {"将此消息发送到 ChisaBot 应用中的"}{" "}
                {link.data.platform === "teams" ? "Microsoft Teams" : "Slack"}{" "}
                {"在...内"}
                {link.data.expiresInMinutes}{" "}
                {"分钟。它将该账号链接到此会话和机器人。"}
              </p>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1">
                  {link.data.command}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      link.data?.command ?? "",
                    );
                    setCopied(true);
                  }}
                >
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            {"在其他人可阅读的会话中，机器人会以私信方式回复你"}
          </p>
          {reach.data && !reach.data.available.slack && (
            <p className="text-sm text-muted-foreground">
              {
                "管理员需要先将 ChisaBot 与 OpenTag 配对，才能将 Slack 或 Teams 链接起来。"
              }
            </p>
          )}
          <form
            className="grid gap-3 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              sms.mutate();
            }}
          >
            <label htmlFor="delivery-phone" className="grid gap-1 text-sm">
              {"电话号码"}
              <Input
                id="delivery-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+15551234567"
                required
                pattern="\+[1-9][0-9]{7,14}"
              />
            </label>
            <Button
              type="submit"
              disabled={!agentId || !reach.data?.available.sms || sms.isPending}
            >
              {"发送验证码"}
            </Button>
          </form>
          {challengeId && (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                confirm.mutate();
              }}
            >
              <Input
                aria-label={"验证码"}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              <Button type="submit" disabled={confirm.isPending}>
                {"确认电话"}
              </Button>
            </form>
          )}
        </div>
        <section className="grid gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{"已连接目的地"}</h2>
          {reach.isPending ? (
            <p>{"正在加载连接器…"}</p>
          ) : (
            reach.data?.bindings
              .filter((binding) => binding.enabled)
              .map((binding) => (
                <div
                  key={binding.id}
                  className="flex items-center justify-between gap-2"
                >
                  <p className="text-sm">
                    {binding.transport === "slack"
                      ? "Slack"
                      : binding.transport === "teams"
                        ? "Microsoft Teams"
                        : binding.optedOutAt
                          ? `${binding.address} (回复 STOP；发送 START 恢复)`
                          : binding.address}{" "}
                    · {botName(binding.agentId)}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(binding.id)}
                  >
                    {"断开连接"}
                  </Button>
                </div>
              ))
          )}
          {reach.data?.bindings.every((binding) => !binding.enabled) && (
            <p className="text-sm text-muted-foreground">{"未连接目的地。"}</p>
          )}
        </section>
        <section className="grid gap-3 rounded-lg border p-4">
          <h2 className="font-semibold">{"原生设备"}</h2>
          <p className="text-sm text-muted-foreground">
            {"登录 ChisaBot 原生应用并启用通知以注册设备。"}
          </p>
          {reach.data?.devices.map((device) => (
            <div key={device.id} className="flex items-center justify-between">
              <p>{device.platform}</p>
              <Button
                variant="outline"
                size="sm"
                disabled={deviceRemove.isPending}
                onClick={() => deviceRemove.mutate(device.id)}
              >
                {"移除设备"}
              </Button>
            </div>
          ))}
        </section>
        <section className="grid gap-2 rounded-lg border p-4">
          <h2 className="font-semibold">{"最近交付"}</h2>
          {reach.data?.deliveries.map((delivery) => (
            <div key={delivery.id} className="border-t pt-2 text-sm">
              <p>
                {delivery.transport} · {delivery.kind} · {delivery.state} ·{" "}
                {new Date(delivery.createdAt).toLocaleString("zh-CN")}
              </p>
              {delivery.error && (
                <p className="text-destructive">{delivery.error}</p>
              )}
            </div>
          ))}
          {reach.data?.deliveries.length === 0 && (
            <p className="text-sm text-muted-foreground">{"暂无交付。"}</p>
          )}
        </section>
      </div>
    </PageShell>
  );
}
