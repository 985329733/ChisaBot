import { useAgent } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";

/**
 * Why the last turn ended without an answer, for a surface that has to say so itself.
 *
 * A run can end three ways. It finishes, which needs no explanation. It fails in the browser, which
 * arrives as an error. Or the Bot's own stream stops producing anything and this deployment ends the
 * turn for it, which arrives as a RUN_ERROR carrying the sentence the server wrote (see
 * server/src/channels/stall-guard.ts). The last two both leave the same hole on screen: the composer
 * unlocks, the spinner disappears, and nothing says what happened.
 *
 * The reason is kept as a sentence rather than a flag because the reasons are not interchangeable. A
 * Bot that refused, a Bot whose endpoint is down and a Bot that simply stopped talking are three
 * different things to be told, and only the thing that ended the turn knows which one it was.
 */

/**
 * The sentence to show, in the words of whatever ended the turn.
 *
 * Falls back only when there is genuinely nothing to pass on. Saying "the Bot stopped without saying
 * why" is honest about that; inventing a cause would not be, and this is the one moment a person has
 * no other way to find out what went wrong.
 */
export function stoppedReason(reported: unknown): string {
  const said =
    reported instanceof Error
      ? reported.message
      : typeof reported === "string"
        ? reported
        : "";
  return said.trim() || "机器人没有给出原因就停止了。";
}

/**
 * Watch one Bot's runs and hold on to the reason the last one ended, if it ended badly.
 *
 * Bound by agent id rather than handed an agent, so a caller that only renders the packaged chat
 * does not have to reach for one: `useAgent` returns the same shared instance the chat itself binds
 * to, so this watches exactly the runs that chat starts.
 *
 * Cleared when the next run begins rather than on a timer. A sentence about a turn that is over
 * should stay until there is something newer to look at, and the person deciding when that is is the
 * one who sends the next message.
 */
let userStoppedAt = 0;
/**
 * 用户自己按了停止（2026-10-13 第四轮）。停止会以「运行失败（中止）」的形式回来，以前顶上就冒一条红色
 * 「…停止了」——可那不是出错，是人让它停的；对话里那一轮末尾已经挂了「已停止」。之后 15 秒内的失败不报。
 */
export function markUserStop(): void {
  userStoppedAt = Date.now();
}
const stoppedByUser = () => Date.now() - userStoppedAt < 15_000;

/** 订阅者本身（纯函数，便于测试）：每一轮开始清掉，出错 / 失败记下原因（用户自己按停止的除外）。 */
export function stoppedTurnSubscriber(setStopped: (reason: string | null) => void) {
  return {
    onRunInitialized: () => setStopped(null),
    /*
     * 打开会话时，CopilotKit 把这条线程的历史事件（每一轮的 RUN_STARTED … RUN_ERROR / RUN_FINISHED）
     * 重放一遍，订阅者都会收到。以前只在本页自己发起的一轮开始时清掉提示，于是一小时前出过一次错、
     * 之后已经好好回答了几轮的会话，一打开顶上还挂着那条旧错误（2026-10-13 实测）。历史里后面又开始
     * 了一轮，那条错误就不是「上一轮」的了：任何一轮开始都清掉。
     */
    onRunStartedEvent: () => setStopped(null),
    onRunErrorEvent: ({ event }: { event?: { message?: unknown } }) => {
      if (!stoppedByUser()) setStopped(stoppedReason(event?.message));
    },
    onRunFailed: ({ error }: { error?: unknown }) => {
      if (!stoppedByUser()) setStopped(stoppedReason(error));
    },
  };
}

export function useStoppedTurn(agentId: string): string | null {
  const { agent } = useAgent({ agentId });
  const [stopped, setStopped] = useState<string | null>(null);

  useEffect(() => {
    const subscription = agent.subscribe?.(stoppedTurnSubscriber(setStopped));
    return () => subscription?.unsubscribe();
  }, [agent]);

  return stopped;
}
