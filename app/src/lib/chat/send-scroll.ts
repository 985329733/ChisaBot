/**
 * 连续聊天时发消息不翻页（DESIGN.md §94）。
 *
 * 用户反馈（2026-10-16）：「我现在输入，整个列表会上跳。如果 5 分钟之内我有输入，就不进行这个跳跃翻页，
 * 超过 5 分钟就按现在这种处理」。
 *
 * 「现在这种处理」= §35 / §88.1：刚发出的那条用户消息带 `data-scroll-anchor`，滚动容器把它对齐到顶上，
 * 下面留出一屏空白给回答——隔了一段时间再开口，新的一轮从头看起，这是对的。可一来一回聊着的时候，每发一句
 * 整段对话就往上翻一页，眼睛刚读到的回答被推走，看着就是「上跳」。
 *
 * 规则：这一条之前的那条用户消息发出不到 CONTINUOUS_SEND_MS（5 分钟）→ 连续聊天：不带对齐标记、不新留空白，
 * 底部跟着内容平滑长高；否则（这段对话第一句、隔了 5 分钟以上、刷新后上一条早就发了）照旧对齐到顶上。
 *
 * 时间以服务器为准（`GET /threads/:id/sent-at`：上一条用户消息第一次进入运行的时刻），换算到本机时钟
 * （服务器同时回它的「现在」，两边时钟差不进来）；服务器没回来 / 读不到时，用本机记下的发送时刻。
 */

/** 连续聊天的界限（毫秒）。改这一个数就行。 */
export const CONTINUOUS_SEND_MS = 5 * 60 * 1000;

/**
 * 这一条算不算「接着上一条聊」：上一条用户消息的发送时刻（本机时钟，毫秒）距现在不到 CONTINUOUS_SEND_MS。
 * 不知道上一条什么时候发的（没有上一条 / 读不到）→ 不算，照旧翻页。时钟往回拨了（负数）也按不知道处理。
 */
export function isContinuousSend(previousSentAt: number | null | undefined, now: number, limit = CONTINUOUS_SEND_MS): boolean {
  if (previousSentAt === null || previousSentAt === undefined || !Number.isFinite(previousSentAt)) return false;
  const gap = now - previousSentAt;
  return gap >= 0 && gap < limit;
}

/** 服务器读到的「最新一条用户消息什么时候发的」，已换算到本机时钟。 */
export type SentAtReading = { userMessageId: string; at: number };

/**
 * 服务器回的 `{ userMessageId, at, now }` → 本机时钟下的发送时刻。`at` / `now` 是服务器的 ISO 时间，
 * `receivedAt` 是本机收到回复的时刻：本机时刻 = receivedAt − (now − at)。格式不对返回 null。
 */
export function readSentAt(body: unknown, receivedAt: number): SentAtReading | null {
  if (!body || typeof body !== "object") return null;
  const { userMessageId, at, now } = body as { userMessageId?: unknown; at?: unknown; now?: unknown };
  if (typeof userMessageId !== "string" || !userMessageId || typeof at !== "string") return null;
  const sent = Date.parse(at);
  if (!Number.isFinite(sent)) return null;
  const serverNow = typeof now === "string" ? Date.parse(now) : Number.NaN;
  const age = Number.isFinite(serverNow) ? Math.max(0, serverNow - sent) : null;
  return { userMessageId, at: age === null ? sent : receivedAt - age };
}

/*
 * 本机记下的发送时刻（消息 id → 本机毫秒）：恢复完成后新出现一条用户消息时记。只在内存里，够用就行
 * （刷新后靠服务器）。最多留 200 条。
 */
const localSent = new Map<string, number>();

/** 同一条消息的附件行 id 是 `<消息 id>:attachments`：按消息算。 */
export function sentMessageId(id: string): string {
  return id.endsWith(":attachments") ? id.slice(0, -":attachments".length) : id;
}

export function rememberSent(rowId: string, at: number): void {
  const id = sentMessageId(rowId);
  if (localSent.has(id)) return;
  localSent.set(id, at);
  if (localSent.size > 200) {
    const oldest = localSent.keys().next().value;
    if (oldest !== undefined) localSent.delete(oldest);
  }
}

export function localSentAt(rowId: string): number | null {
  return localSent.get(sentMessageId(rowId)) ?? null;
}

/**
 * 上一条用户消息的发送时刻：服务器读数对得上这条 id 就用它，否则用本机记的；都没有为 null。
 */
export function previousSentAt(previousId: string | null, server: SentAtReading | null | undefined): number | null {
  if (!previousId) return null;
  if (server && server.userMessageId === sentMessageId(previousId)) return server.at;
  return localSentAt(previousId);
}
