import { randomUUID } from "node:crypto";
import { EventType, type BaseEvent, type Message } from "@ag-ui/client";
import { z } from "zod";
import type { Database } from "../db/client";
import { LocalConversationError, type LocalRunControl, type ThreadWorkerRoutes } from "../local-conversations";
import type { GrantedTool } from "../plugins/tools";
import { HeadlessToolSuspension, type HeadlessTool } from "../computer/headless-tools";
import type { TurnRunner } from "../routines/runner";
import { type ThreadInbox, WORKER_RESULT_MARKER } from "../thread-inbox";

/**
 * 后台任务（DESIGN.md §38）：机器人把一件耗时、独立的事交给一个并行的「工人」去做，主对话继续能聊。
 *
 * - 工人就是同一个机器人在一个**单独的隐藏对话**（`worker-<id>`）里跑的一轮无头回合：同样的工具
 *   （少了委派，多了 `worker_plan` 维护清单），同样的权限、审批和审计；对话记录存下来，出了事能查。
 * - 并发有上限：每人同时最多 {@link PER_USER_RUNNING} 个在跑，全站 {@link GLOBAL_RUNNING} 个，其余排队；
 *   每人最多 {@link PER_USER_BACKLOG} 个没结束的。每个工人的回合有超时（{@link WORKER_TIMEOUT_MS}），
 *   结果截断到 {@link RESULT_LIMIT} 字，内存里只留卡片要显示的几行状态。
 * - 补充说明 = 往工人的对话收件箱里放一条消息，下一步读进去（thread-inbox.ts，和主对话插话同一套）。
 * - 结束后结果作为一条消息回到发起的对话：那边正在回答就进收件箱（下一步读到），没在回答就起一轮
 *   无头回合，让主机器人用一两句话告诉用户结果。
 * - 服务重启：没跑完的标成失败并写明原因，不会一直显示「运行中」。
 */
export type WorkerStatus = "queued" | "running" | "waiting" | "done" | "failed" | "cancelled";
export type WorkerPlanStep = { text: string; status: "done" | "current" | "pending" | "blocked" };
export type WorkerView = {
  id: string; title: string; status: WorkerStatus; step: string | null; plan: WorkerPlanStep[];
  summary: string | null; error: string | null; resultMessageId: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
};

type WorkerRow = {
  id: string; owner_user_id: string; parent_thread_id: string; agent_id: string; thread_id: string;
  title: string; task: string; status: WorkerStatus; plan: WorkerPlanStep[]; step: string | null;
  result: string | null; error: string | null; result_message_id: string | null;
  created_at: Date | string; started_at: Date | string | null; finished_at: Date | string | null;
};

export const PER_USER_RUNNING = Number(process.env.CHISABOT_WORKERS_PER_USER) || 3;
export const GLOBAL_RUNNING = Number(process.env.CHISABOT_WORKERS_GLOBAL) || 6;
export const PER_USER_BACKLOG = 6;
export const WORKER_TIMEOUT_MS = 15 * 60_000;
export const RESULT_LIMIT = 6_000;
const ACTIVE: WorkerStatus[] = ["queued", "running", "waiting"];

const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : null);
const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

function hostOf(url: unknown): string {
  if (typeof url !== "string") return "网页";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "workspace.local") return "工作区里的页面";
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return clip(url, 40);
  }
}

/** 把工人的一次工具调用翻成卡片上那一行「当前步骤」。返回 null 的不改那一行。 */
export function describeWorkerStep(name: string, args: Record<string, unknown>): string | null {
  const text = (value: unknown, limit = 24) => (typeof value === "string" && value.trim() ? clip(value.trim(), limit) : "");
  switch (name) {
    case "worker_plan": return null;
    case "web_search": return text(args.query) ? `正在搜索「${text(args.query)}」` : "正在搜索";
    case "web_fetch": return `正在读取 ${hostOf(args.url)}`;
    case "computer_navigate": return `正在打开 ${hostOf(args.url)}`;
    case "computer_snapshot": return "正在查看页面上的按钮和输入框";
    case "computer_read": return "正在阅读页面";
    case "computer_screenshot": return "正在看页面";
    case "computer_click": return "正在点击";
    case "computer_type": return "正在填写";
    case "computer_key": return "正在按键";
    case "computer_scroll": return "正在滚动页面";
    case "computer_write_file": return text(args.path) ? `正在写文件 ${text(args.path)}` : "正在写文件";
    case "computer_read_file": return "正在读文件";
    case "computer_list_files": return "正在查看工作区";
    case "computer_run_command": return "正在运行命令";
    case "computer_request_help":
    case "computer_handoff": return "正在请你帮忙";
    case "render_ui": return "正在整理成卡片";
    default:
      if (name.startsWith("panel_")) return "正在更新面板";
      if (name.startsWith("device_")) return "正在操作你的设备";
      if (name.startsWith("memory")) return "正在查记忆";
      return `正在使用 ${name}`;
  }
}

/** 交给模型的任务说明：它是在后台、没人看着，结束时的最后一段话就是交回去的结果。 */
export function frameWorkerTask(title: string, task: string) {
  return [
    `你现在是后台任务「${title}」的执行者。主对话里的你把这件事交给了你，用户此刻不在看这个对话。`,
    "做法：",
    "1. 先调一次 worker_plan，列出 3–6 个简短步骤（中文，每步十个字左右）；每完成一步或换到下一步时再调它更新状态。",
    "2. 独立把事情做完，不要问用户问题；真的缺了做不下去的信息，就把能做的做完，在结果里写清楚缺什么。",
    "3. 过程中可能收到「补充说明」消息，那是用户通过主对话发来的，照着调整。",
    "4. 最后用一段话交回结果：先给结论 / 数据 / 链接，再列关键依据和来源；不要寒暄，不要说「希望有帮助」。",
    "",
    "任务：",
    task,
  ].join("\n");
}

function view(row: WorkerRow, live?: { step?: string | null; plan?: WorkerPlanStep[] }): WorkerView {
  return {
    id: row.id, title: row.title, status: row.status,
    step: live?.step !== undefined ? live.step : row.step,
    plan: live?.plan ?? row.plan ?? [],
    summary: row.result ? clip(row.result.replace(/\s+/g, " ").trim(), 160) : null,
    error: row.error, resultMessageId: row.result_message_id,
    createdAt: iso(row.created_at)!, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at),
  };
}

export type WorkerServiceOptions = {
  database: Database;
  inbox: ThreadInbox;
  control: LocalRunControl;
  /** 跑一轮无头回合（工人自己的、交付结果给主对话的都用它）。 */
  runTurn: TurnRunner;
  /** 交付结果那一轮用的回合（主对话的机器人，普通工具）。不给就用 runTurn。 */
  deliverTurn?: TurnRunner;
  /** 主对话属于哪个机器人（交付结果时起回合要用）。 */
  agentOfThread: (threadId: string) => Promise<string | null>;
};

export type WorkerService = ThreadWorkerRoutes & {
  ensure(): Promise<void>;
  recover(): Promise<number>;
  /** 主对话里的机器人可以用的工具（委派、发补充说明、停止、看状态）。 */
  delegationTools(input: { ownerUserId: string; agentId: string; threadId: string }): GrantedTool[];
  /** 工人回合里额外给的工具（维护清单）。 */
  workerTools(workerId: string): HeadlessTool[];
  start(input: { ownerUserId: string; agentId: string; parentThreadId: string; title: string; task: string; plan?: string[] }): Promise<WorkerView>;
  get(workerId: string): Promise<WorkerView | null>;
  updatePlan(workerId: string, steps: WorkerPlanStep[]): Promise<void>;
};

export function createWorkerService(options: WorkerServiceOptions): WorkerService {
  const { database, inbox, control, runTurn } = options;
  const deliverTurn = options.deliverTurn ?? runTurn;
  const sql = database.$client;
  const live = new Map<string, { step?: string | null; plan?: WorkerPlanStep[]; controller: AbortController; unobserve?: () => void; flush?: ReturnType<typeof setTimeout> }>();
  let pumping = false;

  const row = async (id: string) => (await sql.unsafe<WorkerRow[]>("SELECT * FROM chisabot_workers WHERE id = $1", [id]))[0] ?? null;
  const owned = async (id: string, actorId: string, threadId?: string) => {
    const found = await row(id);
    if (!found || found.owner_user_id !== actorId || (threadId && found.parent_thread_id !== threadId)) throw new LocalConversationError("后台任务不存在", 404);
    return found;
  };

  const lastAssistantText = async (threadId: string): Promise<string | null> => {
    const rows = await sql.unsafe<{ messages: Message[] }[]>("SELECT messages FROM openbot_local_threads WHERE id = $1", [threadId]);
    const messages = rows[0]?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]!;
      if (message.role === "user") break;
      if (message.role === "assistant" && textOfContent(message).trim()) return textOfContent(message);
    }
    return null;
  };

  const persistLive = (id: string) => {
    const state = live.get(id);
    if (!state || state.flush) return;
    state.flush = setTimeout(() => {
      state.flush = undefined;
      void sql.unsafe(
        "UPDATE chisabot_workers SET step = $2, plan = $3::text::jsonb, updated_at = now() WHERE id = $1",
        [id, state.step ?? null, JSON.stringify(state.plan ?? [])],
      ).catch(() => {});
    }, 800);
  };

  const finish = async (id: string, status: WorkerStatus, fields: { result?: string | null; error?: string | null }) => {
    const state = live.get(id);
    state?.unobserve?.();
    if (state?.flush) clearTimeout(state.flush);
    live.delete(id);
    const rows = await sql.unsafe<WorkerRow[]>(
      `UPDATE chisabot_workers SET status = $2, result = $3, error = $4, finished_at = now(), updated_at = now(),
       step = $5, plan = coalesce($6::text::jsonb, plan)
       WHERE id = $1 AND status IN ('queued', 'running', 'waiting') RETURNING *`,
      [id, status, fields.result ?? null, fields.error ?? null, null, state?.plan ? JSON.stringify(state.plan) : null],
    );
    return rows[0] ?? null;
  };

  const statusZh = (status: WorkerStatus) => (status === "done" ? "已完成" : status === "failed" ? "没有完成" : status === "waiting" ? "在等你确认" : "已停止");

  /** 结果回到主对话。 */
  const deliver = async (worker: WorkerRow) => {
    const messageId = `worker-result-${worker.id}`;
    const body = worker.status === "done" ? worker.result || "（没有文字结果）" : worker.error || "（没有说明原因）";
    const message = {
      id: messageId, role: "user",
      content: `${WORKER_RESULT_MARKER}${worker.id}:${worker.status}⟧\n后台任务「${worker.title}」${statusZh(worker.status)}。\n\n${clip(body, RESULT_LIMIT)}`,
    } as Message;
    await sql.unsafe("UPDATE chisabot_workers SET result_message_id = $2 WHERE id = $1", [worker.id, messageId]);
    const enqueue = () => inbox.enqueue({ threadId: worker.parent_thread_id, ownerUserId: worker.owner_user_id, message, kind: "worker_result" });
    if (control.isActive(worker.parent_thread_id)) {
      await enqueue();
      // 入队和那一轮结束之间的空当：那一轮刚好结束了就自己起一轮。
      if (control.isActive(worker.parent_thread_id)) return;
    }
    const agentId = (await options.agentOfThread(worker.parent_thread_id)) ?? worker.agent_id;
    try {
      await inbox.withdraw(worker.parent_thread_id, messageId);
      await deliverTurn({
        ownerUserId: worker.owner_user_id, routineId: `worker:${worker.id}`, agentId,
        threadId: worker.parent_thread_id, instruction: textOfContent(message),
        initiator: { kind: "routine", id: `worker:${worker.id}` },
        userMessage: message, forwardedProps: { chisabotWorkerDelivery: { id: worker.id } },
      });
    } catch (error) {
      // 对话刚好被用户占着（锁）或者回合失败：放进收件箱，下一轮一定读到，不丢。
      console.warn(JSON.stringify({ type: "worker-delivery-queued", worker: worker.id, reason: error instanceof Error ? error.message : String(error) }));
      await sql.unsafe("UPDATE chisabot_thread_inbox SET status = 'queued', updated_at = now() WHERE thread_id = $1 AND id = $2", [worker.parent_thread_id, messageId]);
      await enqueue().catch(() => {});
    }
  };

  const launch = async (worker: WorkerRow) => {
    const controller = new AbortController();
    const state: { step?: string | null; plan?: WorkerPlanStep[]; controller: AbortController; unobserve?: () => void } = {
      controller, step: "正在准备", plan: worker.plan ?? [],
    };
    live.set(worker.id, state);
    await sql.unsafe("UPDATE chisabot_workers SET status = 'running', started_at = now(), step = $2, updated_at = now() WHERE id = $1", [worker.id, state.step]);
    const calls = new Map<string, { name: string; args: string }>();
    state.unobserve = control.observe(worker.thread_id, (event: BaseEvent) => {
      const e = event as BaseEvent & { toolCallId?: string; toolCallName?: string; delta?: string; role?: string };
      if (e.type === EventType.TOOL_CALL_START && e.toolCallId) calls.set(e.toolCallId, { name: e.toolCallName ?? "", args: "" });
      else if (e.type === EventType.TOOL_CALL_ARGS && e.toolCallId) { const call = calls.get(e.toolCallId); if (call) call.args += e.delta ?? ""; }
      else if (e.type === EventType.TOOL_CALL_END && e.toolCallId) {
        const call = calls.get(e.toolCallId);
        if (!call) return;
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.args || "{}"); } catch { /* 参数不是 JSON：只按名字描述。 */ }
        const line = describeWorkerStep(call.name, args);
        if (line) { state.step = line; persistLive(worker.id); }
      } else if (e.type === EventType.TEXT_MESSAGE_START && (e.role ?? "assistant") === "assistant" && state.step === "正在准备") {
        // 只在还没做任何事时把「正在准备」换掉；之后的过程话不覆盖上一步（一步一行，不闪）。
        state.step = "正在思考"; persistLive(worker.id);
      }
    });
    const timer = setTimeout(() => controller.abort(new Error("timeout")), WORKER_TIMEOUT_MS);
    timer.unref?.();
    let finished: WorkerRow | null = null;
    try {
      const outcome = await runTurn({
        ownerUserId: worker.owner_user_id, routineId: `worker:${worker.id}`, agentId: worker.agent_id,
        threadId: worker.thread_id, instruction: worker.task,
        initiator: { kind: "routine", id: `worker:${worker.id}` },
        signal: controller.signal,
        userMessage: { id: `worker-task-${worker.id}`, role: "user", content: frameWorkerTask(worker.title, worker.task) } as Message,
        forwardedProps: { chisabotWorker: { id: worker.id } },
      });
      // 交回的结果 = 工人最后一条有字的回复（过程话不算）；读不到再退回整轮的文字。
      const text = ((await lastAssistantText(worker.thread_id)) ?? outcome.replyText).trim();
      if (state.plan?.length) state.plan = state.plan.map((step) => (step.status === "current" || step.status === "pending" ? { ...step, status: "done" } : step));
      finished = await finish(worker.id, "done", { result: clip(text || "（任务做完了，但没有写结果。）", RESULT_LIMIT) });
    } catch (error) {
      const current = await row(worker.id);
      if (current?.status === "cancelled") finished = null;
      else if (error instanceof HeadlessToolSuspension) {
        finished = await finish(worker.id, "failed", { error: `需要你确认一个操作才能继续（${error.message}）。请在「审批」里处理后，让我重新做这件事。` });
      } else if (controller.signal.aborted && String(controller.signal.reason).includes("timeout")) {
        finished = await finish(worker.id, "failed", { error: `超过 ${WORKER_TIMEOUT_MS / 60_000} 分钟还没做完，已停止。` });
      } else {
        finished = await finish(worker.id, "failed", { error: error instanceof Error ? clip(error.message, 400) : "后台任务出错了。" });
      }
    } finally {
      clearTimeout(timer);
      const left = live.get(worker.id);
      left?.unobserve?.();
      live.delete(worker.id);
    }
    if (finished) await deliver(finished).catch((error) => console.warn("worker delivery failed", error));
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      for (;;) {
        const queued = await sql.unsafe<WorkerRow[]>("SELECT * FROM chisabot_workers WHERE status = 'queued' ORDER BY created_at LIMIT 50");
        if (!queued.length) return;
        const running = await sql.unsafe<{ owner_user_id: string; n: number }[]>(
          "SELECT owner_user_id, count(*)::int AS n FROM chisabot_workers WHERE status IN ('running', 'waiting') GROUP BY owner_user_id",
        );
        const per = new Map(running.map((item) => [item.owner_user_id, item.n]));
        let total = running.reduce((sum, item) => sum + item.n, 0);
        let launched = false;
        for (const worker of queued) {
          if (total >= GLOBAL_RUNNING) return;
          if ((per.get(worker.owner_user_id) ?? 0) >= PER_USER_RUNNING) continue;
          const claimed = await sql.unsafe("UPDATE chisabot_workers SET status = 'running', updated_at = now() WHERE id = $1 AND status = 'queued' RETURNING id", [worker.id]);
          if (!claimed.length) continue;
          per.set(worker.owner_user_id, (per.get(worker.owner_user_id) ?? 0) + 1);
          total++;
          launched = true;
          void launch(worker).finally(() => void pump());
        }
        if (!launched) return;
      }
    } finally {
      pumping = false;
    }
  };

  const service: WorkerService = {
    async ensure() {
      await sql.unsafe(`CREATE TABLE IF NOT EXISTS chisabot_workers (
        id text PRIMARY KEY, owner_user_id text NOT NULL, parent_thread_id text NOT NULL, agent_id text NOT NULL,
        thread_id text NOT NULL, title text NOT NULL, task text NOT NULL, status text NOT NULL,
        plan jsonb NOT NULL DEFAULT '[]'::jsonb, step text, result text, error text, result_message_id text,
        created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
      await sql.unsafe("CREATE INDEX IF NOT EXISTS chisabot_workers_parent ON chisabot_workers(parent_thread_id, created_at)");
      await sql.unsafe("CREATE INDEX IF NOT EXISTS chisabot_workers_status ON chisabot_workers(status, created_at)");
    },

    async recover() {
      const rows = await sql.unsafe(
        `UPDATE chisabot_workers SET status = 'failed', finished_at = now(), updated_at = now(), step = NULL,
         error = CASE WHEN status = 'queued' THEN '服务重启了，这个任务还没开始就被取消了。可以让我重新做。'
                      ELSE '服务重启了，任务做到一半被中断（没有完成）。可以让我重新做。' END
         WHERE status IN ('queued', 'running', 'waiting') RETURNING id`,
      );
      return rows.length;
    },

    async start(input) {
      const title = clip(input.title.trim() || "后台任务", 40);
      const task = input.task.trim();
      if (!task) throw new Error("任务说明是空的。");
      const backlog = await sql.unsafe<{ n: number }[]>(
        "SELECT count(*)::int AS n FROM chisabot_workers WHERE owner_user_id = $1 AND status IN ('queued', 'running', 'waiting')", [input.ownerUserId],
      );
      if ((backlog[0]?.n ?? 0) >= PER_USER_BACKLOG) throw new Error(`后台已经有 ${PER_USER_BACKLOG} 个任务没做完，等其中一个结束再委派。`);
      const id = randomUUID();
      const plan = (input.plan ?? []).filter((text) => typeof text === "string" && text.trim()).slice(0, 8)
        .map((text, index) => ({ text: clip(text.trim(), 40), status: index === 0 ? "current" : "pending" }) as WorkerPlanStep);
      const rows = await sql.unsafe<WorkerRow[]>(
        `INSERT INTO chisabot_workers (id, owner_user_id, parent_thread_id, agent_id, thread_id, title, task, status, plan)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8::text::jsonb) RETURNING *`,
        [id, input.ownerUserId, input.parentThreadId, input.agentId, `worker-${id}`, title, clip(task, 8_000), JSON.stringify(plan)],
      );
      void pump();
      return view(rows[0]!);
    },

    async get(id) {
      const found = await row(id);
      return found ? view(found, live.get(id)) : null;
    },

    async updatePlan(id, steps) {
      const clean = steps.slice(0, 10).map((step) => ({
        text: clip(String(step.text ?? "").trim(), 40),
        status: (["done", "current", "pending", "blocked"] as const).includes(step.status) ? step.status : "pending",
      })).filter((step) => step.text);
      const state = live.get(id);
      if (state) { state.plan = clean; persistLive(id); }
      else await sql.unsafe("UPDATE chisabot_workers SET plan = $2::text::jsonb, updated_at = now() WHERE id = $1", [id, JSON.stringify(clean)]);
    },

    async list(threadId, actorId) {
      const rows = await sql.unsafe<WorkerRow[]>(
        "SELECT * FROM chisabot_workers WHERE parent_thread_id = $1 AND owner_user_id = $2 ORDER BY created_at DESC LIMIT 20", [threadId, actorId],
      );
      return rows.reverse().map((found) => view(found, live.get(found.id)));
    },

    async steer(threadId, workerId, actorId, text) {
      const found = await owned(workerId, actorId, threadId);
      if (found.status === "queued") {
        await sql.unsafe("UPDATE chisabot_workers SET task = task || $2, updated_at = now() WHERE id = $1", [workerId, `\n\n补充说明：${text}`]);
        return;
      }
      if (found.status !== "running") throw new LocalConversationError("这个任务已经结束了", 409);
      await inbox.enqueue({ threadId: found.thread_id, ownerUserId: actorId, message: { id: randomUUID(), role: "user", content: `补充说明（用户通过主对话发来）：${text}` } as Message });
    },

    async cancel(threadId, workerId, actorId) {
      const found = await owned(workerId, actorId, threadId);
      if (!ACTIVE.includes(found.status)) return;
      await sql.unsafe(
        "UPDATE chisabot_workers SET status = 'cancelled', finished_at = now(), updated_at = now(), step = NULL WHERE id = $1 AND status IN ('queued', 'running', 'waiting')",
        [workerId],
      );
      const state = live.get(workerId);
      state?.controller.abort(new Error("cancelled"));
      await control.stop({ threadId: found.thread_id }).catch(() => false);
      void pump();
    },

    workerTools(workerId) {
      return [{
        definition: {
          name: "worker_plan",
          description: "更新这个后台任务的步骤清单（用户在主对话的任务卡片上看到）。每次传完整清单；status: done 已完成 / current 正在做 / pending 未开始 / blocked 卡住了。",
          parameters: {
            type: "object",
            properties: {
              steps: {
                type: "array", maxItems: 10,
                items: {
                  type: "object",
                  properties: { text: { type: "string", description: "十个字左右的中文步骤" }, status: { type: "string", enum: ["done", "current", "pending", "blocked"] } },
                  required: ["text", "status"],
                },
              },
            },
            required: ["steps"],
          },
        },
        execute: async (args: unknown) => {
          const steps = (args as { steps?: unknown })?.steps;
          if (!Array.isArray(steps)) return "steps 需要是数组。";
          await service.updatePlan(workerId, steps as WorkerPlanStep[]);
          return "清单已更新。";
        },
      }];
    },

    delegationTools({ ownerUserId, agentId, threadId }) {
      const tool = (name: string, description: string, parameters: z.ZodType, execute: (args: never) => Promise<string>): GrantedTool => ({
        name, description, parameters, ref: `chisabot/${name}`,
        execute: (args: unknown) => execute(args as never),
      });
      return [
        {
          ...tool(
            "delegate_task",
            "把一件耗时、独立、不需要边做边问用户的事（例如：调研对比、整理大量资料、在网上办一件多步骤的事）交给后台任务并行去做，主对话可以继续聊。会立刻返回；结果做完后自动回到这个对话。简单问题、几秒能答的、需要用户边看边决定的不要委派。",
            z.object({
              title: z.string().describe("几个字的任务名，显示在任务卡片上，例如「对比三款降噪耳机」"),
              task: z.string().describe("完整的任务说明：要做什么、标准、限制、交回什么。后台任务看不到这段对话，所以把需要的背景都写进去。"),
              plan: z.array(z.string()).max(8).optional().describe("可选：初步步骤（每步十个字左右）"),
            }),
            async (args: { title: string; task: string; plan?: string[] }) => {
              const started = await service.start({ ownerUserId, agentId, parentThreadId: threadId, title: args.title, task: args.task, plan: args.plan });
              return JSON.stringify({
                workerId: started.id, title: started.title, status: started.status,
                note: "已交给后台。用一句话告诉用户你已经开始在后台做、做完会把结果发到这里；不要等待它，也不要编造结果。",
              });
            },
          ),
          guidance: [
            "后台任务：耗时较长、可以独立完成的事（多来源调研、大量整理、多步骤网上操作）用 delegate_task 交给后台并行做，主对话保持能聊；每个任务给一个几个字的标题和完整说明（后台看不到这段对话）。",
            `同时最多 ${PER_USER_RUNNING} 个在跑；后台任务和你共用同一个浏览器，所以同一时间最多委派一个需要用浏览器的任务，而且它在用浏览器时你自己不要用。`,
            "用户想给某个后台任务补充要求就用 worker_message；想取消就用 worker_cancel；问进度用 worker_status。结果回来时会是一条以「⟦chisabot:worker-result:」开头的消息。",
          ].join("\n"),
        },
        tool(
          "worker_message",
          "给正在运行的后台任务发一条补充说明（它在下一步读到并调整）。",
          z.object({ workerId: z.string(), text: z.string() }),
          async (args: { workerId: string; text: string }) => {
            try { await service.steer(threadId, args.workerId, ownerUserId, args.text); return "已发给后台任务。"; }
            catch (error) { return error instanceof Error ? error.message : "发送失败。"; }
          },
        ),
        tool(
          "worker_cancel",
          "停止一个后台任务。",
          z.object({ workerId: z.string() }),
          async (args: { workerId: string }) => {
            try { await service.cancel(threadId, args.workerId, ownerUserId); return "已停止。"; }
            catch (error) { return error instanceof Error ? error.message : "停止失败。"; }
          },
        ),
        tool(
          "worker_status",
          "查看这个对话里后台任务的状态（标题、状态、当前步骤、清单）。",
          z.object({}),
          async () => JSON.stringify((await service.list(threadId, ownerUserId)).map((worker) => {
            const item = worker as WorkerView;
            return { workerId: item.id, title: item.title, status: item.status, step: item.step, plan: item.plan, error: item.error };
          })),
        ),
      ];
    },
  };
  return service;
}

function textOfContent(message: Message): string {
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}
