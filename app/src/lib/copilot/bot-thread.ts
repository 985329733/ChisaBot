import { useCallback, useEffect, useRef, useState } from "react";
import { tryClient } from "@/lib/client";
import { newId } from "../new-id";

/**
 * The thread the direct Bot chat talks in.
 *
 * Two things it has to be. Minted by this deployment, so the conversation says where it came from
 * in a project that may hold more than one. And the same one tomorrow, because a chat that takes a
 * new thread on every load has no history to come back to.
 *
 * Kept per Bot: the chat is bound to one Bot at a time, and two Bots sharing a thread would read
 * each other's conversation.
 *
 * "Tomorrow" is a promise this module cannot keep on its own, though. The id survives in
 * `localStorage` forever, but Intelligence is free to forget the thread behind it — expiry,
 * environment reset, a wiped dev database. Remembering an id nobody upstream recognises does not
 * fail loudly: every send just opens a new, empty thread under the old id, and the chat answers as
 * if nothing had ever been said, with no error on screen to explain why. So before this hook hands
 * out a remembered id, it asks Intelligence whether that id still means something, and only keeps
 * pretending the history is there when the answer says it is.
 */

const KEY = "openbot.bot-thread";

/** The one place the storage key is built, so the getter and the setter can never drift apart. */
export function botThreadKey(agentId: string): string {
  return `${KEY}.${agentId}`;
}

function remembered(agentId: string): string | null {
  try {
    return window.localStorage.getItem(botThreadKey(agentId));
  } catch {
    // Storage can be unavailable or full. A thread for this visit is better than no chat at all.
    return null;
  }
}

function remember(agentId: string, threadId: string): void {
  try {
    window.localStorage.setItem(botThreadKey(agentId), threadId);
  } catch {
    // As above: the conversation still works, it just will not be here next time.
  }
}

async function mint(): Promise<string | null> {
  try {
    const response = await tryClient("/api/threads/mint", { method: "POST" });
    if (!response.ok) return null;
    const body = (await response.json()) as { threadId?: unknown };
    return typeof body.threadId === "string" ? body.threadId : null;
  } catch {
    return null;
  }
}

/**
 * Whether Intelligence still has a remembered thread, and whether the question could even be put
 * to it. Those are separate facts: a 404 on this route means no reader is configured on this
 * deployment at all, which says nothing about the thread and must not be read as bad news, while a
 * 400 or a 502 (or the request simply throwing) means the question was asked and failed to get a
 * clean answer.
 */
async function checkKnown(
  threadId: string,
): Promise<{ known: boolean | undefined; unavailable: boolean }> {
  try {
    const response = await tryClient(
      `/api/threads/${encodeURIComponent(threadId)}`,
    );
    if (response.status === 404) {
      // The route itself is absent, which is what an unconfigured reader looks like server-side.
      // Behave exactly as this hook did before the check existed: nothing was learned, nothing
      // changes.
      return { known: undefined, unavailable: false };
    }
    if (!response.ok) {
      // A 400 means the remembered id was not even a plausible thread id; a 502 means the check
      // itself failed to reach Intelligence. Either way there is no clean answer, and the safer
      // read is "unknown" rather than "gone" — see threadToUse for why.
      return { known: undefined, unavailable: true };
    }
    const body = (await response.json()) as { known?: unknown };
    if (typeof body.known !== "boolean") {
      // A 200 that does not carry the shape this hook asked for is not an answer either.
      return { known: undefined, unavailable: true };
    }
    return { known: body.known, unavailable: false };
  } catch {
    return { known: undefined, unavailable: true };
  }
}

/**
 * Whether to keep the remembered thread id or start over, given what the check above learned.
 *
 * The two ways of not keeping it are not the same mistake. `known: false` is Intelligence saying,
 * plainly, that it has never heard of this id — replacing it loses nothing, because there was
 * never anything there to lose, and keeping it would only mean sending every message into a thread
 * that quietly reopens empty. `known: undefined` is the opposite kind of ignorance: the check
 * failed to get an answer at all, and discarding somebody's conversation on the strength of a
 * network blip is the worse mistake of the two. So only a provable "no" moves this to `"fresh"`;
 * an inconclusive check keeps what was remembered. No remembered id to keep is its own case: with
 * nothing to protect, there is nothing the check could have told us that would change the outcome.
 */
export function threadToUse(input: {
  remembered: string | null;
  known: boolean | undefined;
}): "remembered" | "fresh" {
  if (input.remembered === null) return "fresh";
  return input.known === false ? "fresh" : "remembered";
}

/**
 * 全端同步（DESIGN.md §42）：当前对话存在服务器上（server/src/bot-threads.ts），每个人每个机器人一条。
 * 下面这些是和它说话的几个小函数；服务器没有这个接口（旧版本 / 不是本地会话模式）时一律返回 "unsupported"，
 * 这个钩子退回只用 localStorage 的老办法。
 */
export type ServerThread = { threadId: string | null; updatedAt: string | null };
export type ThreadActivity = {
  threadId: string;
  seq: string;
  running: boolean;
  workers: string | null;
  inbox: string | null;
};
type SyncReply = { current: ServerThread | null; thread: ThreadActivity | null };

const botThreadsApi = (agentId: string) => `/api/bot-threads/${encodeURIComponent(agentId)}`;

async function readJson<T>(response: Response): Promise<T | "unsupported"> {
  // 旧服务器没有这个路由：404，或者被前端兜底页接住（200 text/html）。都当作「不支持」。
  if (response.status === 404 || response.status === 405) return "unsupported";
  if (!(response.headers.get("content-type") ?? "").includes("json")) return "unsupported";
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export async function readServerThread(agentId: string): Promise<ServerThread | "unsupported" | "error"> {
  try {
    const body = await readJson<ServerThread>(await tryClient(botThreadsApi(agentId)));
    if (body === "unsupported") return body;
    return { threadId: typeof body.threadId === "string" ? body.threadId : null, updatedAt: body.updatedAt ?? null };
  } catch {
    return "error";
  }
}

/** 设成服务器上的当前对话。返回服务器最后认的那条（onlyIfNone 时可能是别的设备先写的）；失败返回 null。 */
export async function writeServerThread(agentId: string, threadId: string, onlyIfNone = false): Promise<string | null> {
  try {
    const body = await readJson<ServerThread>(
      await tryClient(botThreadsApi(agentId), { method: "PUT", body: { threadId, onlyIfNone } }),
    );
    if (body === "unsupported") return null;
    return typeof body.threadId === "string" ? body.threadId : threadId;
  } catch {
    return null;
  }
}

/** 问一次对话的变化戳；「服务器没有这个接口」单独返回 "unsupported"（频道聊天用，见 thread-activity.ts）。 */
export async function readSync(agentId: string, threadId: string): Promise<SyncReply | "unsupported" | null> {
  try {
    return await readJson<SyncReply>(
      await tryClient(`${botThreadsApi(agentId)}/sync?threadId=${encodeURIComponent(threadId)}`),
    );
  } catch {
    return null;
  }
}

async function readSyncForBot(agentId: string, threadId: string): Promise<SyncReply | null> {
  try {
    const body = await readJson<SyncReply>(
      await tryClient(`${botThreadsApi(agentId)}/sync?threadId=${encodeURIComponent(threadId)}`),
    );
    return body === "unsupported" ? null : body;
  } catch {
    return null;
  }
}

/** 页面在前台时多久问一次服务器（隐藏时不问；回到前台、窗口获得焦点、网络恢复时马上问）。 */
export const SYNC_INTERVAL_MS = 2_000;

export type BotThread = {
  /** `undefined` until it is known, which is not the same as absent: rendering the chat before
   * then would let it mint an id of its own, and that is the one this deployment would then be
   * stuck with. */
  threadId: string | undefined;
  /**
   * `"unavailable"` means the check that guards a remembered thread failed to get a clean answer,
   * so this render is going ahead on a thread id that history may or may not still exist for and
   * nobody can currently say which. `"ready"` covers every case where that question was either
   * answered or never needed asking.
   */
  history: "ready" | "unavailable";
  /** Mints a fresh thread and starts using it from now on — on every device (DESIGN.md §42). */
  startNew: () => void;
  /** 切到这个机器人的另一条对话（「历史对话」），所有设备都换。 */
  switchTo: (threadId: string) => void;
  /**
   * 订阅当前对话在服务器上的变化（每次同步都会回调，调用方自己比较）。返回取消函数。
   * 用它把别的设备发的消息、正在流式的回答、排队消息、后台任务卡片拉到这台设备（use-conversation-sync.ts）。
   */
  onActivity: (listener: (activity: ThreadActivity) => void) => () => void;
};

/**
 * The thread the direct Bot chat talks in.
 *
 * 2026-10-13 起以服务器为准（DESIGN.md §42）：打开时问服务器这个机器人的当前对话；服务器还没有记录时，把这台
 * 浏览器原来记着的对话交上去（只在服务器仍为空时写入，两台设备同时迁移不会互相覆盖），没有就铸一条新的。
 * 之后每 2 秒（前台时）同步一次：别的设备点了「新对话」，这里跟着换；这条对话有新动静，通知订阅者。
 * localStorage 仍然记一份，只是缓存（服务器不可用时退回老办法）。
 */
export function useBotThread(agentId: string): BotThread {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<"ready" | "unavailable">("ready");
  // Mirrors the effect's own `current` flag so `startNew` — which runs from an event handler, not
  // from the effect — can tell whether it is still safe to touch state: the agent may have changed
  // or the component may have unmounted while its mint was in flight.
  const mountedRef = useRef(true);
  // Shared between the effect's own resolution mint and `startNew`'s mint so the two can never
  // race each other into two POST /mint calls fighting over the same localStorage slot.
  const mintingRef = useRef(false);
  // Set once `startNew` has taken over, so the mount-time check that is still in flight does not
  // then overwrite the fresh thread with the remembered one.
  const startedNewRef = useRef(false);
  /** 服务器有没有当前对话接口（"unknown" 直到第一次问到）。 */
  const serverRef = useRef<"unknown" | "yes" | "no">("unknown");
  /** 显示中的对话（同步回调里读，不随渲染闭包变旧）。 */
  const threadRef = useRef<string | undefined>(undefined);
  /** 每次本机换对话就加一：之前发出的同步请求的「当前对话」结论作废（防止刚点完新对话又被旧回复拉回去）。 */
  const epochRef = useRef(0);
  /** 本机换了对话但还没写进服务器（写入失败）：下次同步先补写。 */
  const pendingWriteRef = useRef<{ id: string; onlyIfNone: boolean } | null>(null);
  const listenersRef = useRef(new Set<(activity: ThreadActivity) => void>());

  const use = useCallback(
    (next: string, historyState: "ready" | "unavailable" = "ready") => {
      threadRef.current = next;
      epochRef.current++;
      remember(agentId, next);
      setThreadId(next);
      setHistory(historyState);
    },
    [agentId],
  );

  useEffect(() => {
    let current = true;
    mountedRef.current = true;
    // A new agent resolves from scratch, so any earlier `startNew` no longer speaks for this one.
    startedNewRef.current = false;
    serverRef.current = "unknown";
    threadRef.current = undefined;
    pendingWriteRef.current = null;
    setThreadId(undefined);
    setHistory("ready");

    /** 老办法：只看这台浏览器记着的那条（服务器不支持 / 暂时连不上）。 */
    const resolveLocally = async (): Promise<{ id: string; history: "ready" | "unavailable" } | null> => {
      const existing = remembered(agentId);
      if (existing) {
        const outcome = await checkKnown(existing);
        if (threadToUse({ remembered: existing, known: outcome.known }) === "remembered")
          return { id: existing, history: outcome.unavailable ? "unavailable" : "ready" };
      }
      mintingRef.current = true;
      const minted = await mint();
      mintingRef.current = false;
      return { id: minted ?? newId(), history: "ready" };
    };

    void (async () => {
      const server = await readServerThread(agentId);
      if (!current || startedNewRef.current) return;
      if (server === "unsupported" || server === "error") {
        serverRef.current = server === "unsupported" ? "no" : "yes";
        const local = await resolveLocally();
        if (!current || startedNewRef.current || !local) return;
        use(local.id, local.history);
        // 暂时连不上：先用本机这条，下次同步时补写（只在服务器为空时）。
        if (server === "error") pendingWriteRef.current = { id: local.id, onlyIfNone: true };
        return;
      }
      serverRef.current = "yes";
      if (server.threadId) {
        // 服务器说了算：它记的就是这条对话，哪怕还没发过消息（一段空对话），不再问「还在不在」。
        use(server.threadId);
        return;
      }
      // 第一次：把这台浏览器原来的对话接过来（迁移），没有就新铸一条；只在服务器仍为空时写入。
      const local = await resolveLocally();
      if (!current || startedNewRef.current || !local) return;
      const adopted = await writeServerThread(agentId, local.id, true);
      if (!current || startedNewRef.current) return;
      if (adopted) use(adopted, adopted === local.id ? local.history : "ready");
      else {
        use(local.id, local.history);
        pendingWriteRef.current = { id: local.id, onlyIfNone: true };
      }
    })();

    return () => {
      current = false;
      mountedRef.current = false;
    };
  }, [agentId, use]);

  // 同步：前台每 2 秒一次；隐藏时停；回到前台 / 获得焦点 / 网络恢复时马上一次。
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = alive && visible() ? setTimeout(() => void tick(), SYNC_INTERVAL_MS) : undefined;
    };
    const tick = async () => {
      if (!alive || busy || serverRef.current === "no") return schedule();
      const shown = threadRef.current;
      if (!shown) return schedule();
      busy = true;
      try {
        const pending = pendingWriteRef.current;
        if (pending) {
          const written = await writeServerThread(agentId, pending.id, pending.onlyIfNone);
          if (written && pendingWriteRef.current === pending) pendingWriteRef.current = null;
        }
        const epoch = epochRef.current;
        const reply = await readSyncForBot(agentId, shown);
        if (!alive || !reply) return;
        const fresh = epoch === epochRef.current && !pendingWriteRef.current && !mintingRef.current;
        const serverThread = reply.current?.threadId ?? null;
        if (fresh && serverThread && serverThread !== threadRef.current) {
          // 别的设备换了对话（新对话）：跟着换。
          use(serverThread);
          return;
        }
        if (fresh && !serverThread) {
          // 服务器上的记录没了（比如清空了历史）：把这台正在用的交上去（仍只在为空时）。
          void writeServerThread(agentId, shown, true);
        }
        if (reply.thread && reply.thread.threadId === threadRef.current)
          for (const listener of listenersRef.current) listener(reply.thread);
      } finally {
        busy = false;
        schedule();
      }
    };
    const now = () => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (visible()) void tick();
    };
    const onVisibility = () => (visible() ? now() : timer && clearTimeout(timer));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", now);
    window.addEventListener("online", now);
    window.addEventListener("pageshow", now);
    schedule();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", now);
      window.removeEventListener("online", now);
      window.removeEventListener("pageshow", now);
    };
  }, [agentId, threadId, use]);

  const startNew = useCallback(() => {
    if (mintingRef.current) return;
    mintingRef.current = true;
    void mint().then(async (minted) => {
      if (!minted) {
        mintingRef.current = false;
        return;
      }
      // Leaving the current thread alone on a failed mint matters: a person pressing "New chat"
      // should never end up worse off — mid-conversation and suddenly unable to send — than before.
      if (!mountedRef.current) {
        mintingRef.current = false;
        return;
      }
      /*
       * Latched here rather than at the press: set on the press, a mint that then fails would leave
       * the mount-time resolution disarmed with nothing having replaced the thread (blank pane).
       */
      startedNewRef.current = true;
      use(minted);
      // 换成新对话：所有设备都换（写进服务器）。写不进去就下次同步补写，期间不让同步把它拉回旧的。
      if (serverRef.current !== "no") {
        const pending = { id: minted, onlyIfNone: false };
        pendingWriteRef.current = pending;
        const written = await writeServerThread(agentId, minted, false);
        if (written && pendingWriteRef.current === pending) pendingWriteRef.current = null;
      }
      mintingRef.current = false;
    });
  }, [agentId, use]);

  const onActivity = useCallback((listener: (activity: ThreadActivity) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  /** 「历史对话」里点一条：切到它，所有设备都换（DESIGN.md §42.6）。 */
  const switchTo = useCallback(
    (next: string) => {
      if (!next || next === threadRef.current || mintingRef.current) return;
      startedNewRef.current = true;
      use(next);
      if (serverRef.current === "no") return;
      const pending = { id: next, onlyIfNone: false };
      pendingWriteRef.current = pending;
      void writeServerThread(agentId, next, false).then((written) => {
        if (written && pendingWriteRef.current === pending) pendingWriteRef.current = null;
      });
    },
    [agentId, use],
  );

  return { threadId, history, startNew, switchTo, onActivity };
}

export type BotThreadSummary = { threadId: string; title: string; messages: number; updatedAt: string | null };

/** 这个机器人的对话列表（「历史对话」）。旧服务器没有这个接口 → "unsupported"。 */
export async function readThreadHistory(agentId: string): Promise<BotThreadSummary[] | "unsupported"> {
  const body = await readJson<{ threads?: BotThreadSummary[] }>(await tryClient(`${botThreadsApi(agentId)}/history`));
  if (body === "unsupported") return body;
  return Array.isArray(body.threads) ? body.threads : [];
}
