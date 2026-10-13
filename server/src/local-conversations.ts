import { compactEvents, EventType, type AbstractAgent, type BaseEvent, type Message } from "@ag-ui/client";
import { AgentRunner, createRunEventFinalizer, type AgentRunnerConnectRequest, type AgentRunnerRunRequest, type AgentRunnerStopRequest } from "@copilotkit/runtime/v2";
import { Observable, ReplaySubject, Subject } from "rxjs";
import { estimateTokens, readingFromRunFinished, type ThreadContextReading } from "./context-usage";
import type { Database } from "./db/client";

/** Errors also satisfy the existing history reader's platform-error contract. */
export class LocalConversationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PlatformRequestError";
  }
}

export type LocalHistoryMessage = {
  id: string; role: string; content?: unknown; activityType?: string;
  toolCalls?: { id: string; name: string; args: string }[]; toolCallId?: string;
};

/** Headless turns use flat tools; HTTP keeps the canonical AG-UI message format. */
export function toLocalHistoryMessage(message: Message): LocalHistoryMessage {
  if (message.role !== "assistant") return { ...message };
  const { toolCalls, ...rest } = message;
  return { ...rest, ...(toolCalls ? { toolCalls: toolCalls.map((call) => ({
    id: call.id, name: call.function.name, args: call.function.arguments,
  })) } : {}) };
}

/** Saved history is authoritative: clients can append IDs but cannot rewrite old messages. */
export function mergeConversationMessages(stored: readonly Message[], incoming: readonly Message[]): Message[] {
  const messages = [...stored];
  const known = new Set(stored.map((message) => message.id));
  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    messages.push(message);
  }
  return messages;
}

/** A handoff's full task goes to the model, while only its optional summary joins the transcript. */
export function prepareConversationMessages(
  stored: readonly Message[], input: readonly Message[], persistedInput?: readonly Message[],
) {
  const execution = mergeConversationMessages(stored, input);
  const visible = mergeConversationMessages(stored, persistedInput ?? input);
  const visibleById = new Map(visible.map((message) => [message.id, message]));
  const inputIds = new Set(execution.map((message) => message.id));
  const privateIds = new Set(execution.filter((message) =>
    JSON.stringify(message) !== JSON.stringify(visibleById.get(message.id)),
  ).map((message) => message.id));
  const privateTools = new Set(execution.flatMap((message) =>
    privateIds.has(message.id) && message.role === "assistant"
      ? (message.toolCalls ?? []).map((call) => call.id) : [],
  ));
  const project = (messages: readonly Message[]) => mergeConversationMessages(
    visible, messages.filter((message) => !inputIds.has(message.id)),
  );
  // Snapshots also appear inside custom event/state payloads. Replace only known input message
  // objects; fresh outputs, tool results, and arbitrary domain state retain their original values.
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize).filter((item) => item !== undefined);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (typeof object.id === "string" && typeof object.role === "string" && privateIds.has(object.id)) {
      return visibleById.get(object.id);
    }
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, sanitize(item)]));
  };
  const event = (source: BaseEvent): BaseEvent | undefined => {
    const fields = source as BaseEvent & { messageId?: string; toolCallId?: string; messages?: Message[] };
    if ((fields.messageId && privateIds.has(fields.messageId)) ||
      (fields.toolCallId && privateTools.has(fields.toolCallId))) return undefined;
    if (source.type === EventType.MESSAGES_SNAPSHOT) {
      return { ...source, messages: project(fields.messages ?? []) } as BaseEvent;
    }
    return sanitize(source) as BaseEvent;
  };
  return { execution, visible, project, sanitize, event };
}

type ThreadRow = {
  id: string; owner_user_id: string; agent_id: string; name: string | null;
  archived: boolean; messages: Message[]; state: Record<string, unknown>;
  run_id: string | null; lock_expires_at: Date | null;
  created_at: Date; updated_at: Date;
};
type EventRow = { sequence: string | number | bigint; event: BaseEvent };
type ThreadIdentity = { threadId: string; userId: string };
type ThreadCreation = ThreadIdentity & { agentId: string; learningContainerId?: string };
type ThreadLock = ThreadCreation & { runId: string; ttlSeconds?: number };
type LeaseIdentity = { threadId: string; runId: string };

function record(row: ThreadRow) {
  return {
    id: row.id, name: row.name, agentId: row.agent_id, createdById: row.owner_user_id,
    organizationId: "", archived: row.archived,
    createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function ttl(seconds = 120) {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new LocalConversationError("A positive lock TTL is required", 400);
  return Math.min(300, Math.max(1, seconds));
}

class ConversationStore {
  constructor(readonly database: Database) {}

  async thread(threadId: string): Promise<ThreadRow> {
    const rows = await this.database.$client.unsafe<ThreadRow[]>(
      "SELECT * FROM openbot_local_threads WHERE id = $1", [threadId],
    );
    if (!rows[0]) throw new LocalConversationError("Thread not found", 404);
    return rows[0];
  }

  async owned({ threadId, userId }: ThreadIdentity): Promise<ThreadRow> {
    const row = await this.thread(threadId);
    if (row.owner_user_id !== userId) throw new LocalConversationError("Thread not found", 404);
    return row;
  }

  async events(threadId: string): Promise<EventRow[]> {
    return await this.database.$client.unsafe<EventRow[]>(
      "SELECT sequence, event FROM openbot_local_events WHERE thread_id = $1 ORDER BY sequence", [threadId],
    );
  }

  async snapshot(threadId: string, runId: string, messages: readonly Message[], state: unknown) {
    const rows = await this.database.$client.unsafe(
      `UPDATE openbot_local_threads SET messages = $3::text::jsonb, state = $4::text::jsonb, updated_at = now()
       WHERE id = $1 AND run_id = $2 AND lock_expires_at > now() RETURNING id`,
      [threadId, runId, JSON.stringify(messages), JSON.stringify(state ?? {})],
    );
    if (rows.length === 0) throw new LocalConversationError("Thread run no longer owns its lock", 409);
  }

  async append(threadId: string, runId: string, event: BaseEvent): Promise<bigint> {
    const rows = await this.database.$client.unsafe<{ sequence: string | number | bigint }[]>(
      `INSERT INTO openbot_local_events (thread_id, run_id, event)
       SELECT id, $2, $3::text::jsonb FROM openbot_local_threads
       WHERE id = $1 AND run_id = $2 AND lock_expires_at > now() RETURNING sequence`,
      [threadId, runId, JSON.stringify(event)],
    );
    if (!rows[0]) throw new LocalConversationError("Thread run no longer owns its lock", 409);
    return BigInt(rows[0].sequence);
  }
}

export class LocalConversationClient {
  constructor(private readonly store: ConversationStore) {}

  async getThread(identity: ThreadIdentity) { return record(await this.store.owned(identity)); }

  async getOrCreateThread(identity: ThreadCreation) {
    if (!identity.threadId || !identity.userId || !identity.agentId) throw new LocalConversationError("Thread, user, and agent are required", 400);
    await this.store.database.$client.unsafe(
      `INSERT INTO openbot_local_threads (id, owner_user_id, agent_id) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO NOTHING`, [identity.threadId, identity.userId, identity.agentId],
    );
    const row = await this.store.owned(identity);
    if (row.agent_id !== identity.agentId) throw new LocalConversationError("Thread belongs to a different agent", 409);
    return record(row);
  }

  async getThreadMessages(identity: ThreadIdentity): Promise<{ messages: LocalHistoryMessage[] }> {
    return { messages: (await this.store.owned(identity)).messages.map(toLocalHistoryMessage) };
  }

  async ɵacquireThreadLock(identity: ThreadLock) {
    await this.getOrCreateThread(identity);
    const rows = await this.store.database.$client.unsafe(
      `UPDATE openbot_local_threads SET run_id = $2,
       lock_expires_at = now() + $5 * interval '1 second', updated_at = now()
       WHERE id = $1 AND owner_user_id = $3 AND agent_id = $4
       AND (run_id IS NULL OR lock_expires_at <= now() OR run_id = $2) RETURNING id`,
      [identity.threadId, identity.runId, identity.userId, identity.agentId, ttl(identity.ttlSeconds)],
    );
    if (rows.length === 0) throw new LocalConversationError("Thread already running", 409);
    return { threadId: identity.threadId, runId: identity.runId };
  }

  async ɵrenewThreadLock(identity: LeaseIdentity & { ttlSeconds: number }) {
    const rows = await this.store.database.$client.unsafe(
      `UPDATE openbot_local_threads SET lock_expires_at = now() + $3 * interval '1 second'
       WHERE id = $1 AND run_id = $2 AND lock_expires_at > now() RETURNING id`,
      [identity.threadId, identity.runId, ttl(identity.ttlSeconds)],
    );
    if (rows.length === 0) throw new LocalConversationError("Thread lock expired or changed", 409);
    return { threadId: identity.threadId, runId: identity.runId };
  }

  /**
   * 进程启动时调用：本进程还没跑任何一轮，库里残留的线程锁都来自已经退出的进程（容器重启、更新换镜像、崩溃）。
   * 不清掉的话，被打断的那个对话要等锁的 120 秒到期才能再发消息，期间每次发送都是 409「Thread already running」，
   * 用户看到的就是「发消息没反应」。一个数据库只跑一个 ChisaBot 进程（compose 先停旧容器再起新的）；
   * 多副本部署设 CHISABOT_RELEASE_LOCKS_ON_START=0 关掉。
   */
  async ɵreleaseOrphanedLocks(): Promise<{ threads: number; runs: number }> {
    const runs = await this.store.database.$client.unsafe(
      `UPDATE openbot_local_runs SET status = 'interrupted', finished_at = now()
       WHERE status = 'running' RETURNING run_id`,
    );
    const threads = await this.store.database.$client.unsafe(
      `UPDATE openbot_local_threads SET run_id = NULL, lock_expires_at = NULL
       WHERE run_id IS NOT NULL RETURNING id`,
    );
    return { threads: threads.length, runs: runs.length };
  }

  /** 这个进程里没有对应的运行（上一个进程留下的锁）：按停止时直接释放，用户不用干等锁到期。 */
  async ɵreleaseOrphanedLock(threadId: string, runId?: string): Promise<boolean> {
    const rows = await this.store.database.$client.unsafe(
      `UPDATE openbot_local_threads SET run_id = NULL, lock_expires_at = NULL
       WHERE id = $1 AND run_id IS NOT NULL AND ($2::text IS NULL OR run_id = $2) RETURNING run_id`,
      [threadId, runId ?? null],
    );
    if (rows.length === 0) return false;
    await this.store.database.$client.unsafe(
      `UPDATE openbot_local_runs SET status = 'interrupted', finished_at = now()
       WHERE thread_id = $1 AND status = 'running'`, [threadId],
    );
    return true;
  }

  async ɵcleanupThreadLock(identity: LeaseIdentity): Promise<void> {
    await this.store.database.$client.unsafe(
      `UPDATE openbot_local_threads SET run_id = NULL, lock_expires_at = NULL
       WHERE id = $1 AND run_id = $2`, [identity.threadId, identity.runId],
    );
  }
}

type LiveEvent = { sequence: bigint; event: BaseEvent };
type ActiveRun = {
  runId: string; agent: AbstractAgent; stream: ReplaySubject<BaseEvent>;
  live: Subject<LiveEvent>; stopped: boolean; done: Promise<void>;
};

/** Public OSS runner with our own PostgreSQL transcript and per-thread lease. */
class PostgresAgentRunner extends AgentRunner {
  private readonly active = new Map<string, ActiveRun>();
  constructor(private readonly store: ConversationStore, private readonly client: LocalConversationClient) { super(); }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    if (this.active.has(request.threadId)) throw new LocalConversationError("Thread already running", 409);
    if (request.input.threadId !== request.threadId || !request.input.runId) throw new LocalConversationError("Run thread and runId are required", 400);
    const entry: ActiveRun = {
      runId: request.input.runId, agent: request.agent,
      stream: new ReplaySubject<BaseEvent>(), live: new Subject<LiveEvent>(),
      stopped: false, done: Promise.resolve(),
    };
    this.active.set(request.threadId, entry);
    entry.done = this.execute(request, entry);
    return entry.stream.asObservable();
  }

  private async execute(request: AgentRunnerRunRequest, entry: ActiveRun): Promise<void> {
    const { threadId, agent, input } = request;
    let started = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let persistenceError: unknown;
    let terminal = false;
    let runStarted = false;
    let failed = false;
    let durableWrites = Promise.resolve();
    const finalizer = createRunEventFinalizer();
    const newMessages: Message[] = [];
    let prepared = prepareConversationMessages([], [], []);
    const emit = async (source: BaseEvent) => {
      let event = source;
      if (event.type === EventType.RUN_STARTED) event = { ...event, threadId, runId: entry.runId, input: { ...input, messages: newMessages } } as BaseEvent;
      else if (event.type === EventType.RUN_FINISHED) event = { ...event, threadId, runId: entry.runId } as BaseEvent;
      const published = prepared.event(event);
      if (!published) return;
      const sequence = await this.store.append(threadId, entry.runId, published);
      finalizer.observe(published);
      runStarted ||= published.type === EventType.RUN_STARTED;
      terminal ||= published.type === EventType.RUN_FINISHED || published.type === EventType.RUN_ERROR;
      failed ||= published.type === EventType.RUN_ERROR;
      entry.stream.next(published);
      entry.live.next({ sequence, event: published });
    };
    // AG-UI catches subscriber exceptions. Remember failed writes and stop the producer ourselves.
    const guarded = (action: () => Promise<unknown>): Promise<void> => {
      durableWrites = durableWrites.then(async () => {
        if (persistenceError) return;
        try { await action(); } catch (error) {
          persistenceError = error;
          try { agent.abortRun(); } catch { /* Finalization reports the original write failure. */ }
          void agent.detachActiveRun();
        }
      });
      return durableWrites;
    };
    // AG-UI invokes these callbacks without awaiting them. Freeze each snapshot and queue it
    // with event writes so an earlier partial snapshot cannot overwrite the completed transcript.
    const capture = (messages: readonly Readonly<Message>[], state: unknown) => {
      const savedMessages = prepared.project(structuredClone(messages) as Message[]);
      const savedState = prepared.sanitize(structuredClone(state));
      return guarded(() => this.store.snapshot(threadId, entry.runId, savedMessages, savedState));
    };
    const finalize = async (interruptionMessage?: string) => {
      if (!runStarted && !terminal) await emit({ type: EventType.RUN_STARTED, threadId, runId: entry.runId } as BaseEvent);
      for (const event of finalizer.finalize({ stopRequested: entry.stopped,
        protocolVersion: input.protocolVersion, ...(interruptionMessage ? { interruptionMessage } : {}) })) {
        // Synthetic results answer interrupted tools in both the transcript and replay stream.
        if (event.type === EventType.TOOL_CALL_RESULT) {
          const result = event as BaseEvent & { messageId: string; toolCallId: string; content: string };
          agent.setMessages(mergeConversationMessages(agent.messages, [{
            id: result.messageId, role: "tool", content: result.content, toolCallId: result.toolCallId,
          }]));
        }
        await emit(event);
      }
      await durableWrites;
      await this.store.snapshot(threadId, entry.runId, prepared.project(agent.messages), prepared.sanitize(agent.state));
    };
    try {
      const identity = await this.store.thread(threadId);
      if (agent.agentId && agent.agentId !== identity.agent_id) throw new LocalConversationError("Thread belongs to a different agent", 409);
      // Claim and run-record creation are atomic. A duplicate ID never releases the existing lease.
      await this.store.database.$client.begin(async (transaction) => {
        const claimed = await transaction.unsafe(
          `UPDATE openbot_local_threads SET run_id = $2,
           lock_expires_at = now() + interval '120 seconds', updated_at = now()
           WHERE id = $1 AND (run_id IS NULL OR lock_expires_at <= now() OR run_id = $2) RETURNING id`, [threadId, entry.runId],
        );
        if (claimed.length === 0) throw new LocalConversationError("Thread already running", 409);
        const inserted = await transaction.unsafe(
          `INSERT INTO openbot_local_runs (thread_id, run_id, status) VALUES ($1, $2, 'running')
           ON CONFLICT (thread_id, run_id) DO NOTHING RETURNING run_id`, [threadId, entry.runId],
        );
        if (inserted.length === 0) throw new LocalConversationError("Run ID was already used", 409);
      });
      started = true;
      // Read after claiming so a prior run finishing during acquisition cannot leave stale history.
      const row = await this.store.thread(threadId);
      prepared = prepareConversationMessages(row.messages, input.messages, request.persistedInputMessages);
      const oldIds = new Set(row.messages.map((message) => message.id));
      newMessages.push(...prepared.visible.filter((message) => !oldIds.has(message.id)));
      agent.threadId = threadId;
      agent.setMessages(prepared.execution);
      agent.setState(Object.keys(row.state ?? {}).length > 0 ? row.state : input.state ?? {});
      await this.store.snapshot(threadId, entry.runId, prepared.visible, prepared.sanitize(agent.state));
      let renewing = false;
      heartbeat = setInterval(() => {
        if (renewing) return;
        renewing = true;
        void guarded(() => this.client.ɵrenewThreadLock({ threadId, runId: entry.runId, ttlSeconds: 120 }))
          .finally(() => { renewing = false; });
      }, 30_000);
      if (!entry.stopped) {
        let finalized!: () => void;
        const finalization = new Promise<void>((resolve) => { finalized = resolve; });
        await agent.runAgent(input, {
          onEvent: ({ event }) => guarded(() => emit(structuredClone(event))),
          onMessagesChanged: ({ messages, state }) => capture(messages, state),
          onStateChanged: ({ messages, state }) => capture(messages, state),
          onRunFinalized: () => { finalized(); },
        });
        await finalization;
      }
      if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
      await durableWrites;
      if (persistenceError) throw persistenceError;
      await finalize();
    } catch (error) {
      failed = true;
      if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
      await durableWrites;
      if (started && !persistenceError) {
        try {
          await finalize(error instanceof Error ? error.message : "Local agent run failed");
        } catch (writeError) { persistenceError = writeError; }
      }
      if (!started || persistenceError) {
        entry.stream.error(persistenceError ?? error);
        entry.live.error(persistenceError ?? error);
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (started) {
        try {
          await this.store.database.$client.unsafe(
            "UPDATE openbot_local_runs SET status = $3, finished_at = now() WHERE thread_id = $1 AND run_id = $2",
            [threadId, entry.runId, entry.stopped ? "stopped" : failed ? "error" : "finished"],
          );
          await this.client.ɵcleanupThreadLock({ threadId, runId: entry.runId });
        } catch (error) { entry.stream.error(error); entry.live.error(error); }
      }
      if (this.active.get(threadId) === entry) this.active.delete(threadId);
      entry.stream.complete();
      entry.live.complete();
    }
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const entry = this.active.get(request.threadId);
      const pending: LiveEvent[] = [];
      let ready = false;
      let completed = !entry;
      let liveError: unknown;
      let lastSequence = 0n;
      // Subscribe before reading; sequence IDs remove overlap without losing a live event.
      const live = entry?.live.subscribe({
        next: (item) => {
          if (!ready) pending.push(item);
          else if (item.sequence > lastSequence) { lastSequence = item.sequence; subscriber.next(item.event); }
        },
        error: (error) => { liveError = error; if (ready) subscriber.error(error); },
        complete: () => { completed = true; if (ready) subscriber.complete(); },
      });
      void (async () => {
        const row = await this.store.thread(request.threadId);
        if (request.agentId && row.agent_id !== request.agentId) throw new LocalConversationError("Thread not found", 404);
        const saved = await this.store.events(request.threadId);
        lastSequence = saved.length ? BigInt(saved[saved.length - 1]!.sequence) : 0n;
        for (const event of compactEvents(saved.map((item) => item.event))) subscriber.next(event);
        ready = true;
        for (const item of pending) if (item.sequence > lastSequence) {
          lastSequence = item.sequence;
          subscriber.next(item.event);
        }
        if (liveError) subscriber.error(liveError);
        else if (completed) subscriber.complete();
      })().catch((error) => subscriber.error(error));
      return () => live?.unsubscribe();
    });
  }

  async isRunning({ threadId }: { threadId: string }): Promise<boolean> {
    if (this.active.has(threadId)) return true;
    const rows = await this.store.database.$client.unsafe(
      "SELECT id FROM openbot_local_threads WHERE id = $1 AND run_id IS NOT NULL AND lock_expires_at > now()", [threadId],
    );
    return rows.length > 0;
  }

  async stop({ threadId, runId }: AgentRunnerStopRequest): Promise<boolean> {
    const entry = this.active.get(threadId);
    // 不在本进程里跑、库里却锁着：是重启前留下的孤儿锁，停止 = 释放它。
    if (!entry) return await this.client.ɵreleaseOrphanedLock(threadId, runId);
    if (entry.stopped || (runId !== undefined && entry.runId !== runId)) return false;
    entry.stopped = true;
    entry.agent.abortRun();
    await entry.agent.detachActiveRun();
    return true;
  }
}

export type LocalConversationBackend = {
  client: LocalConversationClient;
  runner: AgentRunner;
  handle(request: Request, actorId: string): Promise<Response | undefined>;
};

export async function createLocalConversations(database: Database): Promise<LocalConversationBackend> {
  // Independent tables avoid any dependency on a hosted migration service.
  await database.$client.unsafe(`CREATE TABLE IF NOT EXISTS openbot_local_threads (
    id text PRIMARY KEY, owner_user_id text NOT NULL, agent_id text NOT NULL,
    name text, archived boolean NOT NULL DEFAULT false,
    messages jsonb NOT NULL DEFAULT '[]'::jsonb, state jsonb NOT NULL DEFAULT '{}'::jsonb,
    run_id text, lock_expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await database.$client.unsafe(`CREATE TABLE IF NOT EXISTS openbot_local_runs (
    thread_id text NOT NULL REFERENCES openbot_local_threads(id) ON DELETE CASCADE,
    run_id text NOT NULL, status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
    PRIMARY KEY (thread_id, run_id)
  )`);
  await database.$client.unsafe(`CREATE TABLE IF NOT EXISTS openbot_local_events (
    sequence bigserial PRIMARY KEY,
    thread_id text NOT NULL REFERENCES openbot_local_threads(id) ON DELETE CASCADE,
    run_id text NOT NULL, event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await database.$client.unsafe("CREATE INDEX IF NOT EXISTS openbot_local_events_thread_sequence ON openbot_local_events(thread_id, sequence)");
  await database.$client.unsafe("CREATE INDEX IF NOT EXISTS openbot_local_threads_owner_updated ON openbot_local_threads(owner_user_id, updated_at DESC)");
  const store = new ConversationStore(database);
  const client = new LocalConversationClient(store);
  if (process.env.CHISABOT_RELEASE_LOCKS_ON_START !== "0") {
    try {
      const released = await client.ɵreleaseOrphanedLocks();
      if (released.threads || released.runs)
        console.log(JSON.stringify({ type: "conversation-locks-released", ...released }));
    } catch (error) {
      console.warn("releasing orphaned conversation locks failed", error);
    }
  }
  /*
   * 输入框「上下文」读数（DESIGN.md §25）：最近一次带用量的 RUN_FINISHED；一条都没有就按消息文字粗估。
   * 只读一行（按 thread_id + sequence 索引倒序），不扫整张事件表。
   */
  const contextReading = async (threadId: string, messages: readonly unknown[]): Promise<ThreadContextReading | null> => {
    const rows = await database.$client.unsafe<{ event: Record<string, unknown>; created_at: Date }[]>(
      `SELECT event, created_at FROM openbot_local_events
       WHERE thread_id = $1 AND event->>'type' = 'RUN_FINISHED'
       AND (event ? 'usage' OR event->'metadata' ? 'contextUsage')
       ORDER BY sequence DESC LIMIT 1`, [threadId],
    );
    const measured = rows[0] ? readingFromRunFinished(rows[0]) : undefined;
    if (measured) return measured;
    if (!messages.length) return null;
    return { tokens: estimateTokens(messages), source: "estimate" };
  };
  /**
   * 「已停止」标记（2026-10-13 第四轮）：用户按停止的那些轮次，用开启那一轮的用户消息 id 表示。
   * 一轮里用到浏览器时会拆成好几次运行（前端工具要回到浏览器执行），被停的那次运行输入里可能只有工具
   * 结果，所以往回找它前面最近的一条用户消息。只读，不改历史；标记本身不进对话（不会发给模型）。
   */
  const stoppedTurns = async (threadId: string, messages: readonly Message[]): Promise<string[]> => {
    // 一条 SQL 连表（Bun SQL 的 unsafe 不会把 JS 数组变成 text[] 参数）。
    const started = await database.$client.unsafe<{ event: { input?: { messages?: { id?: string }[] } } }[]>(
      `SELECT e.event FROM openbot_local_events e
       JOIN openbot_local_runs r ON r.thread_id = e.thread_id AND r.run_id = e.run_id
       WHERE e.thread_id = $1 AND r.status = 'stopped' AND e.event->>'type' = 'RUN_STARTED'
       ORDER BY e.sequence DESC LIMIT 50`, [threadId],
    );
    if (!started.length) return [];
    const position = new Map(messages.map((message, index) => [message.id, index]));
    const ids = new Set<string>();
    for (const { event } of started) {
      const indexes = (event.input?.messages ?? []).map((message) => position.get(String(message.id))).filter((index): index is number => index !== undefined);
      if (!indexes.length) continue;
      for (let at = Math.min(...indexes); at >= 0; at--) {
        if (messages[at]?.role === "user") { ids.add(messages[at]!.id); break; }
      }
    }
    return [...ids];
  };
  const runner = new PostgresAgentRunner(store, client);

  const handle = async (request: Request, actorId: string): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const matched = /^\/api\/copilotkit\/threads(?:\/(.*))?\/?$/.exec(url.pathname);
    if (!matched) return undefined;
    try {
      if (!actorId) throw new LocalConversationError("A verified user is required", 401);
      const suffix = matched[1] ?? "";
      if (!suffix && request.method === "GET") {
        const rows = await database.$client.unsafe<ThreadRow[]>(
          `SELECT * FROM openbot_local_threads WHERE owner_user_id = $1
           AND ($2::text IS NULL OR agent_id = $2) AND ($3::boolean OR NOT archived)
           ORDER BY updated_at DESC LIMIT 100`,
          [actorId, url.searchParams.get("agentId"), url.searchParams.get("includeArchived") === "true"],
        );
        return Response.json({ threads: rows.map(record), nextCursor: null });
      }
      if (suffix === "clear" && request.method === "POST") {
        await database.$client.begin(async (transaction) => {
          const rows = await transaction.unsafe<ThreadRow[]>(
            "SELECT * FROM openbot_local_threads WHERE owner_user_id = $1 FOR UPDATE", [actorId],
          );
          if (rows.some((row) => row.run_id && row.lock_expires_at && new Date(row.lock_expires_at).getTime() > Date.now())) throw new LocalConversationError("Stop running threads before clearing history", 409);
          await transaction.unsafe("DELETE FROM openbot_local_threads WHERE owner_user_id = $1", [actorId]);
        });
        return Response.json({ success: true });
      }
      const [encodedId, operation] = suffix.split("/");
      if (!encodedId) throw new LocalConversationError("Thread is required", 400);
      const threadId = decodeURIComponent(encodedId);
      const row = await store.owned({ threadId, userId: actorId });
      const requestedAgent = url.searchParams.get("agentId");
      if (requestedAgent && requestedAgent !== row.agent_id) throw new LocalConversationError("Thread not found", 404);
      if (request.method === "GET") {
        if (operation === "messages") return Response.json({ messages: row.messages });
        if (operation === "state") return Response.json({ state: row.state });
        if (operation === "context") return Response.json({ context: await contextReading(threadId, row.messages) });
        if (operation === "stopped") return Response.json({ userMessageIds: await stoppedTurns(threadId, row.messages) });
        if (operation === "events") return Response.json({ events: compactEvents((await store.events(threadId)).map((event) => event.event)) });
        if (!operation) return Response.json({ thread: record(row) });
      }
      if (!operation && request.method === "DELETE") {
        const removed = await database.$client.unsafe(
          `DELETE FROM openbot_local_threads WHERE id = $1 AND owner_user_id = $2
           AND (run_id IS NULL OR lock_expires_at <= now()) RETURNING id`, [threadId, actorId],
        );
        if (!removed.length) throw new LocalConversationError("Stop the running thread before deleting it", 409);
        return new Response(null, { status: 204 });
      }
      if ((!operation && request.method === "PATCH") || (operation === "archive" && request.method === "POST")) {
        const body = await request.json() as { name?: unknown; archived?: unknown; agentId?: unknown };
        if (body.agentId !== undefined && body.agentId !== row.agent_id) throw new LocalConversationError("Thread not found", 404);
        if (body.name !== undefined && typeof body.name !== "string" && body.name !== null) throw new LocalConversationError("Thread name must be text", 400);
        if (body.archived !== undefined && typeof body.archived !== "boolean") throw new LocalConversationError("Archived must be boolean", 400);
        const changed = await database.$client.unsafe<ThreadRow[]>(
          `UPDATE openbot_local_threads SET name = $3, archived = $4, updated_at = now()
           WHERE id = $1 AND owner_user_id = $2 RETURNING *`,
          [threadId, actorId, body.name === undefined ? row.name : body.name,
            operation === "archive" ? true : body.archived === undefined ? row.archived : body.archived],
        );
        if (!changed[0]) throw new LocalConversationError("Thread not found", 404);
        return Response.json({ thread: record(changed[0]) });
      }
      throw new LocalConversationError("Local thread operation is unsupported", 405);
    } catch (error) {
      if (error instanceof LocalConversationError) return Response.json({ error: error.message }, { status: error.status });
      if (error instanceof SyntaxError || error instanceof URIError) return Response.json({ error: "Invalid thread request" }, { status: 400 });
      throw error;
    }
  };
  return { client, runner, handle };
}
