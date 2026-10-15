import { IconPlus, IconRobot } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { LAST_CC_SESSION_KEY, lastLeftMode } from "@/lib/cloud-cc";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorCard } from "@/components/ui/skyglass";
import { openCreateBot } from "@/lib/agents/create-bot";
import { useLanding } from "@/lib/agents/landing";
import { queryClient } from "@/query-client";
import { agentKeys } from "@/lib/agents/queries";

/**
 * `/` and a bare `/channel/new`: there is no home page and no "new chat" any more, so these only
 * forward to a Bot's conversation (last used → 主机器人 → first). Nothing is drawn while the roster
 * loads — the chat appears in place, no flash of a page that is about to leave.
 *
 * Proposed (not implemented yet): the server seeds a default Bot (「助手」) for anyone with none,
 * which makes the empty branch a last resort (e.g. every Bot hidden). Either way it is one button
 * away from a Bot.
 */
/** 打开应用时上次停在 Claude Code（ADR-0014）：只在这次页面加载的第一次落地时跳过去，之后应用里回到 `/` 照常进聊天。 */
let firstLanding = true;

export function LandingRedirect() {
  const landing = useLanding();
  const navigate = useNavigate();
  const user = useQuery(currentUserQueryOptions());
  const toCc = firstLanding && user.data?.role === "admin" && lastLeftMode() === "cc";
  useEffect(() => {
    if (!user.data) return;
    if (toCc) {
      firstLanding = false;
      let last: string | null = null;
      try {
        last = localStorage.getItem(LAST_CC_SESSION_KEY);
      } catch {}
      void navigate(last ? { to: "/cc/$sessionId", params: { sessionId: last }, replace: true } : { to: "/cc", replace: true });
    } else firstLanding = false;
  }, [toCc, user.data, navigate]);
  const target = landing.state === "ready" && !toCc && user.data ? landing.target : null;
  const key = target ? JSON.stringify(target) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable identity of `target`
  useEffect(() => {
    if (target) void navigate({ ...target, replace: true });
  }, [key, navigate]);

  if (landing.state === "empty")
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyState
          action={
            <Button className="mt-2" onClick={openCreateBot}>
              <IconPlus />
              {"新建机器人"}
            </Button>
          }
          className="w-full max-w-sm"
          description={"新建一个机器人，就可以开始聊天。"}
          icon={<IconRobot className="size-6" />}
          title={"还没有可用的机器人"}
        />
      </div>
    );
  if (landing.state === "error")
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorCard
          action={
            <Button
              className="mt-2"
              onClick={() => void queryClient.invalidateQueries({ queryKey: agentKeys.all })}
              variant="outline"
            >
              {"重试"}
            </Button>
          }
          className="w-full max-w-sm"
          description={"请检查网络后重试。"}
          title={"机器人列表加载失败"}
        />
      </div>
    );
  return null;
}
