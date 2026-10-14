import { type RefObject, useEffect, useRef, useState } from "react";
import { reportChatRunning } from "@/lib/copilot/computer-activity";
import { markUserStop } from "@/lib/copilot/stopped-turn";

/**
 * 一轮对话收成「一句话 → 结果」（2026-10-13，Hark 第二轮；第四轮改为按消息数据判断）。
 *
 * 实测免费模型一轮里会说好几段过程话（「拿到了当前价格，再取一下近 7 日走势。」「我编码打错了一个字…」），
 * 每段都是一个带复制按钮的大气泡，再加每步一个「思考了几秒」、每开一个网页一条小条——一轮能堆出六七
 * 个气泡，结果被挤到最下面。提示词约束不住这个模型，所以在界面上收：
 *
 *  - 每轮（两条用户消息之间）第一段文字 = 开场一句（气泡，不带工具栏）；
 *  - 结果 = 最后一段文字，而且它后面没有再调工具（第四轮：以前「最后一段」可能是一句过程话——
 *    这一轮以工具调用结束、或被用户停掉时，过程话被当成结果画成大气泡）；
 *  - 中间的过程话：这一轮还在跑（或被停掉、没有结果）时是一行淡色小字；有了结果就整行收起；
 *  - 用户按了停止的那一轮：末尾挂一个「已停止」标记（data-cb-stopped），不会有结果气泡；
 *  - 打开网页的小条、「思考了…」都只留这一轮的最后一个。
 *
 * 不碰消息本身（CopilotChat 自己管列表），只给 DOM 节点打 data 属性，样式在 styles.css。
 */

type MessageLike = { id: string; role: string; toolCalls?: unknown[] };

/** 这条会话里被用户停掉的轮次（用开启那一轮的用户消息 id 记）：本机刚按的 + 服务器记下的。 */
const localStops = new Map<string, Set<string>>();

export function useStoppedTurnIds(threadId: string | null | undefined): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = () =>
      fetch(`/api/copilotkit/threads/${encodeURIComponent(threadId)}/stopped`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { userMessageIds: [] }))
        .then((body: { userMessageIds?: string[] }) => {
          if (alive) setIds(new Set(body.userMessageIds ?? []));
        })
        .catch(() => {});
    void load();
    const onRunning = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail === false) setTimeout(load, 1500);
    };
    window.addEventListener("chisabot-chat-running", onRunning);
    return () => {
      alive = false;
      window.removeEventListener("chisabot-chat-running", onRunning);
    };
  }, [threadId]);
  return ids;
}

/**
 * 换过备用模型的轮次（DESIGN.md §61）：用户消息 id → 「主模型额度用完，已改用 X」。
 * 服务器从这一轮的 RUN_FINISHED 读出来；每轮结束后 1.5 秒重读一次（同「已停止」）。
 */
export function useFallbackTurns(threadId: string | null | undefined): Map<string, string> {
  const [turns, setTurns] = useState<Map<string, string>>(() => new Map());
  useEffect(() => {
    setTurns(new Map());
    if (!threadId) return;
    let alive = true;
    const load = () =>
      fetch(`/api/copilotkit/threads/${encodeURIComponent(threadId)}/fallbacks`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { turns: [] }))
        .then((body: { turns?: { userMessageId?: string; notice?: string }[] }) => {
          if (!alive) return;
          const next = new Map<string, string>();
          for (const turn of body.turns ?? []) if (turn.userMessageId && turn.notice) next.set(turn.userMessageId, turn.notice);
          setTurns((previous) => (sameMap(previous, next) ? previous : next));
        })
        .catch(() => {});
    void load();
    const onRunning = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail === false) setTimeout(load, 1500);
    };
    window.addEventListener("chisabot-chat-running", onRunning);
    return () => {
      alive = false;
      window.removeEventListener("chisabot-chat-running", onRunning);
    };
  }, [threadId]);
  return turns;
}

function sameMap(a: Map<string, string>, b: Map<string, string>) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

const idOf = (el: Element) => el.getAttribute("data-message-id") ?? el.querySelector("[data-message-id]")?.getAttribute("data-message-id") ?? null;

export function useTurnCompaction(
  root: RefObject<HTMLElement | null>,
  key: string,
  options: { messages?: () => readonly MessageLike[]; stopped?: Set<string>; fallbacks?: Map<string, string> } = {},
) {
  const opts = useRef(options);
  opts.current = options;
  const stoppedKey = [...(options.stopped ?? [])].sort().join(",");
  const fallbackKey = [...(options.fallbacks ?? new Map<string, string>())].map(([id, text]) => `${id}=${text}`).sort().join(",");
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let frame = 0;
    let wasRunning = false;
    const local = localStops.get(key) ?? new Set<string>();
    localStops.set(key, local);
    let lastUserId: string | null = null;

    const apply = () => {
      frame = 0;
      const running = Boolean(host.querySelector('[data-testid="composer-stop"], [data-testid="composer-queue"]'));
      if (running !== wasRunning) {
        wasRunning = running;
        // 右栏面板据此加快轮询（live-panels.tsx），计算机状态行据此不退回空闲提示（use-status.ts）。
        reportChatRunning(running);
      }
      const list = host.querySelector(".copilotKitMessages");
      if (!list) return;
      const byId = new Map<string, MessageLike>();
      for (const message of opts.current.messages?.() ?? []) byId.set(message.id, message);
      const stopped = new Set([...(opts.current.stopped ?? []), ...local]);

      const turns: { user: Element | null; els: Element[] }[] = [{ user: null, els: [] }];
      for (const el of Array.from(list.children)) {
        // 后台任务交回来的结果（DESIGN.md §38.2）也开启新的一轮：主机器人的总结是那一轮的结果。
        if (el.matches(".copilotKitUserMessage, .worker-result-msg") || el.querySelector(":scope > .copilotKitUserMessage, :scope > .worker-result-msg")) turns.push({ user: el, els: [] });
        else turns[turns.length - 1]?.els.push(el);
      }
      lastUserId = turns.length > 1 ? idOf(turns[turns.length - 1]!.user!) : null;

      turns.forEach((turn, index) => {
        const live = running && index === turns.length - 1;
        const userId = turn.user ? idOf(turn.user) : null;
        const isStopped = Boolean(userId && stopped.has(userId)) && !live;
        const hasText = (el: Element) =>
          el.matches(".copilotKitAssistantMessage") && (el.querySelector(":scope > .cpk\\:prose")?.textContent ?? "").trim().length > 0;
        /** 这个元素（或这一轮里它后面的元素）调了工具 = 它是过程话，不是结果。 */
        const callsTool = (el: Element) => {
          const id = idOf(el);
          const message = id ? byId.get(id) : undefined;
          if (message?.toolCalls?.length) return true;
          if (el.querySelector(".browse-chip, .shot-card, [data-live-panel-ref]")) return true;
          // 没有文字的助手消息就是一次工具调用（工具行默认不显示）。
          return el.matches(".copilotKitAssistantMessage") && !hasText(el) && !el.querySelector(".reasoning-head");
        };
        const texts = turn.els.filter(hasText);
        let hasFinal = false;
        const positions = texts.map((el, i) => {
          const at = turn.els.indexOf(el);
          const toolAfter = callsTool(el) || turn.els.slice(at + 1).some(callsTool);
          const last = i === texts.length - 1;
          if (last && !live && !isStopped && !toolAfter) {
            hasFinal = true;
            return "final";
          }
          return i === 0 ? "lead" : "step";
        });
        texts.forEach((el, i) => {
          const pos = positions[i]!;
          if (el.getAttribute("data-cb-turn") !== pos) el.setAttribute("data-cb-turn", pos);
          // 有了结果，中间的过程话整行收起（刷新后服务器给的历史里也只看结果）；没有结果就留着淡色小字。
          const fold = pos === "step" && hasFinal;
          if (fold !== el.hasAttribute("data-cb-folded")) fold ? el.setAttribute("data-cb-folded", "") : el.removeAttribute("data-cb-folded");
        });
        const hideAllButLast = (nodes: Element[]) =>
          nodes.forEach((el, i) => {
            const hide = i < nodes.length - 1;
            if (hide !== el.hasAttribute("data-cb-hidden")) hide ? el.setAttribute("data-cb-hidden", "") : el.removeAttribute("data-cb-hidden");
          });
        hideAllButLast(turn.els.flatMap((el) => Array.from(el.querySelectorAll(".browse-chip"))));
        hideAllButLast(turn.els.filter((el) => el.querySelector(".reasoning-head")));
        // 「已停止」挂在这一轮最后一个看得见的元素上（什么都没有就挂在用户消息上）。
        const visible = turn.els.filter((el) => !el.hasAttribute("data-cb-hidden") && !el.hasAttribute("data-cb-folded"));
        const anchor = isStopped ? (visible[visible.length - 1] ?? turn.user) : null;
        // 「主模型额度用完，已改用 X」（§61）：淡色小字挂在这一轮最后一个看得见的元素后面；还在跑时不挂。
        const notice = !live && userId ? opts.current.fallbacks?.get(userId) : undefined;
        const noticeAnchor = notice ? (visible[visible.length - 1] ?? turn.user) : null;
        for (const el of [turn.user, ...turn.els]) {
          if (!el) continue;
          const want = el === anchor;
          if (want !== el.hasAttribute("data-cb-stopped")) want ? el.setAttribute("data-cb-stopped", "") : el.removeAttribute("data-cb-stopped");
          const text = el === noticeAnchor ? notice! : null;
          if (text !== el.getAttribute("data-cb-fallback")) text ? el.setAttribute("data-cb-fallback", text) : el.removeAttribute("data-cb-fallback");
        }
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    // 用户按停止：记住是哪一轮，立刻挂「已停止」（服务器那份几秒后才读得到）。
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid="composer-stop"]')) return;
      markUserStop();
      if (lastUserId) local.add(lastUserId);
      setTimeout(schedule, 50);
    };
    host.addEventListener("click", onClick, true);
    const observer = new MutationObserver(schedule);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      if (wasRunning) reportChatRunning(false);
      host.removeEventListener("click", onClick, true);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: stoppedKey / fallbackKey re-apply when the server's lists arrive.
  }, [root, key, stoppedKey, fallbackKey]);
}
