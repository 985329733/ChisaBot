import { useSyncExternalStore } from "react";

/**
 * 机器人回答期间又发来的消息（DESIGN.md §38.1；服务器那边是 server/src/thread-inbox.ts）。
 *
 * 发送时如果机器人正在回答，消息不进 CopilotKit 的消息列表，而是 POST 到这个对话的收件箱，界面在消息
 * 列表末尾画一个淡一点的「已排队」气泡。正在跑的那一轮在下一步把它读进去，服务器推一张消息快照，
 * 这条消息出现在对话记录里它被读到的位置——排队气泡消失，那条消息下面淡出一个「已读取」。
 * 运行结束时还在排队的（入队和结束撞上了），由客户端按普通消息发出去，不会丢。
 */
export type QueuedStatus = "sending" | "queued" | "failed";
export type QueuedMessage = {
  id: string;
  text: string;
  status: QueuedStatus;
  at: number;
  /**
   * 别的设备排的（全端同步，DESIGN.md §42）：这里只显示，回答结束时不由这台设备补发——补发只归排它的那台，
   * 否则两台设备会把同一条各发一遍。
   */
  remote?: boolean;
};

/** 这台设备（这个浏览器）自己排过的消息 id，用来区分「我排的」和「别的设备排的」。 */
const OWN_KEY = "chisabot-inbox-own";
function ownIds(): string[] {
  try {
    const raw = window.localStorage.getItem(OWN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
function rememberOwn(id: string) {
  try {
    window.localStorage.setItem(OWN_KEY, JSON.stringify([...ownIds().filter((other) => other !== id), id].slice(-200)));
  } catch {
    // 存不了：最坏是刷新后这条被当作别的设备排的，不补发（服务器那一轮仍会读到它）。
  }
}

const queues = new Map<string, QueuedMessage[]>();
/** 刚被读进去的消息 id → 读到的时间（「已读取」标记几秒后淡出）。 */
const readAt = new Map<string, number>();
const listeners = new Set<() => void>();
const EMPTY: QueuedMessage[] = [];
let version = 0;

function emit() {
  version++;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function set(threadId: string, next: QueuedMessage[]) {
  if (next.length) queues.set(threadId, next);
  else queues.delete(threadId);
  emit();
}

export function queuedFor(threadId: string | null | undefined): QueuedMessage[] {
  return (threadId && queues.get(threadId)) || EMPTY;
}

export function useQueuedMessages(threadId: string | null | undefined): QueuedMessage[] {
  return useSyncExternalStore(subscribe, () => queuedFor(threadId), () => EMPTY);
}

/** 「已读取」标记要不要画（读到后 6 秒内）。 */
export function useReadMark(messageId: string): boolean {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const at = readAt.get(messageId);
  return at !== undefined && Date.now() - at < 6_000;
}

const api = (threadId: string) => `/api/copilotkit/threads/${encodeURIComponent(threadId)}/inbox`;

/**
 * 机器人正在回答时发一条：进收件箱。返回 "queued" = 已排队；"send" = 那一轮刚好已经结束，调用方照常发送。
 * 失败（网络、排队满）时气泡标成失败，可以重试或撤回。
 */
export async function queueMessage(threadId: string, text: string, id: string = crypto.randomUUID()): Promise<"queued" | "send" | "failed"> {
  const item: QueuedMessage = { id, text, status: "sending", at: Date.now() };
  rememberOwn(id);
  set(threadId, [...queuedFor(threadId).filter((other) => other.id !== id), item]);
  const update = (status: QueuedStatus) =>
    set(threadId, queuedFor(threadId).map((other) => (other.id === id ? { ...other, status } : other)));
  try {
    const response = await fetch(api(threadId), {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, text }),
    });
    if (!response.ok) throw new Error(String(response.status));
    const body = (await response.json()) as { queued?: boolean; status?: string };
    if (!body.queued) {
      set(threadId, queuedFor(threadId).filter((other) => other.id !== id));
      return "send";
    }
    if (body.status === "read") markRead(threadId, id);
    else update("queued");
    return "queued";
  } catch {
    update("failed");
    return "failed";
  }
}

/** 撤回一条还没被读到的。服务器那边已经读了就撤不回（返回 false，气泡等快照来了自己消失）。 */
export async function withdrawMessage(threadId: string, id: string): Promise<boolean> {
  const item = queuedFor(threadId).find((other) => other.id === id);
  if (!item) return false;
  if (item.status === "failed") {
    set(threadId, queuedFor(threadId).filter((other) => other.id !== id));
    return true;
  }
  const response = await fetch(`${api(threadId)}?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" }).catch(() => null);
  const withdrawn = Boolean(response?.ok && ((await response.json()) as { withdrawn?: boolean }).withdrawn);
  if (withdrawn) set(threadId, queuedFor(threadId).filter((other) => other.id !== id));
  return withdrawn;
}

/** 这条已经出现在对话记录里了：从排队里拿掉，挂几秒「已读取」。 */
export function markRead(threadId: string, id: string) {
  readAt.set(id, Date.now());
  set(threadId, queuedFor(threadId).filter((other) => other.id !== id));
  setTimeout(emit, 6_100);
}

/** 运行结束、还在排队的：交给调用方当普通消息发出去，并从排队里拿掉。 */
export function takeQueued(threadId: string): QueuedMessage[] {
  const taken = queuedFor(threadId).filter((item) => item.status === "queued" && !item.remote);
  if (taken.length) set(threadId, queuedFor(threadId).filter((item) => item.status !== "queued" || item.remote));
  return taken;
}

export type InboxState = {
  running: boolean;
  items: { id: string; status: string; kind: string; message: { content?: unknown } }[];
};

/** 打开对话时、以及同步发现收件箱变了时：另一台设备 / 刷新前排的队还在服务器上，接回来（别的设备排的标 remote）。 */
export async function restoreQueue(threadId: string): Promise<InboxState | null> {
  const response = await fetch(api(threadId), { credentials: "include" }).catch(() => null);
  if (!response?.ok) return null;
  const state = (await response.json()) as InboxState;
  const known = new Set(queuedFor(threadId).map((item) => item.id));
  const own = new Set(ownIds());
  const serverQueued = new Set(state.items.filter((item) => item.status === "queued").map((item) => item.id));
  const restored = state.items
    .filter((item) => item.status === "queued" && item.kind === "message" && !known.has(item.id))
    .map((item) => ({
      id: item.id,
      text: typeof item.message.content === "string" ? item.message.content : "",
      status: "queued" as const,
      at: Date.now(),
      ...(own.has(item.id) ? {} : { remote: true }),
    }))
    .filter((item) => item.text);
  // 别的设备排的、服务器上已经不在排队了（被读进去 / 撤回）：这里也拿掉（读进去的会随对话记录出现）。
  const current = queuedFor(threadId);
  const kept = current.filter((item) => !item.remote || serverQueued.has(item.id));
  if (restored.length || kept.length !== current.length) set(threadId, [...kept, ...restored]);
  return state;
}

export async function inboxState(threadId: string): Promise<InboxState | null> {
  const response = await fetch(api(threadId), { credentials: "include" }).catch(() => null);
  return response?.ok ? ((await response.json()) as InboxState) : null;
}
