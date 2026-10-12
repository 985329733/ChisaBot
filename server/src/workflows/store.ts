/**
 * 工作流和运行的读写。所有读取都按 owner 过滤：别人的工作流和运行对你来说不存在（管理员也一样，
 * 运行里有别人的输入和产出）。
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { workflowRunEvents, workflowRuns, workflows } from "../db/schema";
import type {
  WorkflowDefinition,
  WorkflowRunStatus,
  WorkflowStepState,
} from "../../../shared/workflows";

export type StoredWorkflow = {
  id: string;
  ownerUserId: string;
  definition: WorkflowDefinition;
  origin: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RunSource = "page" | "chat" | "routine" | "api";

export type RunState = {
  steps: WorkflowStepState[];
  tokens: number;
  stepsRun: number;
  /** 实际运行用掉的毫秒数（不含等待审批）。 */
  elapsedMs: number;
};

export type StoredRun = {
  id: string;
  ownerUserId: string;
  workflowId: string;
  workflowName: string;
  definition: WorkflowDefinition;
  inputs: Record<string, string | number | boolean>;
  bindings: Record<string, string>;
  status: WorkflowRunStatus;
  source: RunSource;
  state: RunState;
  output: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  updatedAt: Date;
};

export type RunEvent = {
  id: string;
  runId: string;
  at: Date;
  kind: string;
  stepId: string | null;
  message: string;
  data: Record<string, unknown> | null;
};

function asRun(row: typeof workflowRuns.$inferSelect): StoredRun {
  return {
    ...row,
    definition: row.definition as unknown as WorkflowDefinition,
    inputs: row.inputs as StoredRun["inputs"],
    bindings: row.bindings as StoredRun["bindings"],
    status: row.status as WorkflowRunStatus,
    source: row.source as RunSource,
    state: row.state as unknown as RunState,
  };
}

function asWorkflow(row: typeof workflows.$inferSelect): StoredWorkflow {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    definition: row.definition as unknown as WorkflowDefinition,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

let eventCounter = 0;
/** 按时间可排序的 id：同一毫秒里的事件也保持写入顺序。 */
function eventId() {
  eventCounter = (eventCounter + 1) % 1_000_000;
  return `wfe_${Date.now().toString(36).padStart(9, "0")}${eventCounter.toString(36).padStart(4, "0")}${randomUUID().slice(0, 6)}`;
}

export function createWorkflowStore(database: Database) {
  const json = (value: unknown) => value as Record<string, unknown>;
  return {
    async list(ownerUserId: string): Promise<StoredWorkflow[]> {
      const rows = await database
        .select()
        .from(workflows)
        .where(eq(workflows.ownerUserId, ownerUserId))
        .orderBy(desc(workflows.updatedAt));
      return rows.map(asWorkflow);
    },
    async get(ownerUserId: string, id: string): Promise<StoredWorkflow | null> {
      const [row] = await database
        .select()
        .from(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.ownerUserId, ownerUserId)));
      return row ? asWorkflow(row) : null;
    },
    async create(ownerUserId: string, definition: WorkflowDefinition, origin: string | null): Promise<StoredWorkflow> {
      const id = `wf_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const [row] = await database
        .insert(workflows)
        .values({ id, ownerUserId, slug: definition.slug, name: definition.name, definition: json(definition), origin })
        .returning();
      return asWorkflow(row!);
    },
    async update(ownerUserId: string, id: string, definition: WorkflowDefinition): Promise<StoredWorkflow | null> {
      const [row] = await database
        .update(workflows)
        .set({ slug: definition.slug, name: definition.name, definition: json(definition), updatedAt: new Date() })
        .where(and(eq(workflows.id, id), eq(workflows.ownerUserId, ownerUserId)))
        .returning();
      return row ? asWorkflow(row) : null;
    },
    async remove(ownerUserId: string, id: string): Promise<boolean> {
      const rows = await database
        .delete(workflows)
        .where(and(eq(workflows.id, id), eq(workflows.ownerUserId, ownerUserId)))
        .returning({ id: workflows.id });
      return rows.length > 0;
    },

    async createRun(input: {
      ownerUserId: string;
      workflowId: string;
      definition: WorkflowDefinition;
      inputs: StoredRun["inputs"];
      bindings: StoredRun["bindings"];
      source: RunSource;
      state: RunState;
    }): Promise<StoredRun> {
      const id = `wfr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const [row] = await database
        .insert(workflowRuns)
        .values({
          id,
          ownerUserId: input.ownerUserId,
          workflowId: input.workflowId,
          workflowName: input.definition.name,
          definition: json(input.definition),
          inputs: json(input.inputs),
          bindings: json(input.bindings),
          status: "queued",
          source: input.source,
          state: json(input.state),
        })
        .returning();
      return asRun(row!);
    },
    async getRun(id: string): Promise<StoredRun | null> {
      const [row] = await database.select().from(workflowRuns).where(eq(workflowRuns.id, id));
      return row ? asRun(row) : null;
    },
    async getOwnRun(ownerUserId: string, id: string): Promise<StoredRun | null> {
      const [row] = await database
        .select()
        .from(workflowRuns)
        .where(and(eq(workflowRuns.id, id), eq(workflowRuns.ownerUserId, ownerUserId)));
      return row ? asRun(row) : null;
    },
    async listRuns(ownerUserId: string, limit = 20): Promise<StoredRun[]> {
      const rows = await database
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.ownerUserId, ownerUserId))
        .orderBy(desc(workflowRuns.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map(asRun);
    },
    async countActive(ownerUserId: string): Promise<number> {
      const [row] = await database
        .select({ n: sql<number>`count(*)::int` })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.ownerUserId, ownerUserId), inArray(workflowRuns.status, ["queued", "running"])));
      return Number(row?.n ?? 0);
    },
    async saveRun(
      id: string,
      patch: Partial<Pick<StoredRun, "status" | "state" | "output" | "error" | "startedAt" | "finishedAt">>,
    ): Promise<void> {
      await database
        .update(workflowRuns)
        .set({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.state ? { state: json(patch.state) } : {}),
          ...(patch.output !== undefined ? { output: patch.output } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(workflowRuns.id, id));
    },
    async deleteRun(ownerUserId: string, id: string): Promise<boolean> {
      const rows = await database
        .delete(workflowRuns)
        .where(and(eq(workflowRuns.id, id), eq(workflowRuns.ownerUserId, ownerUserId)))
        .returning({ id: workflowRuns.id });
      return rows.length > 0;
    },
    /** 启动时：上次进程里还在跑的运行没有人会把它跑完了。 */
    async interruptedRuns(): Promise<StoredRun[]> {
      const rows = await database
        .select()
        .from(workflowRuns)
        .where(inArray(workflowRuns.status, ["queued", "running"]));
      return rows.map(asRun);
    },

    async addEvent(runId: string, kind: string, message: string, stepId?: string | null, data?: Record<string, unknown>) {
      await database.insert(workflowRunEvents).values({
        id: eventId(),
        runId,
        kind,
        stepId: stepId ?? null,
        message,
        data: data ? json(data) : null,
      });
    },
    async events(runId: string): Promise<RunEvent[]> {
      const rows = await database
        .select()
        .from(workflowRunEvents)
        .where(eq(workflowRunEvents.runId, runId))
        .orderBy(workflowRunEvents.id)
        .limit(500);
      return rows.map((row) => ({ ...row, data: (row.data as Record<string, unknown> | null) ?? null }));
    },
  };
}

export type WorkflowStore = ReturnType<typeof createWorkflowStore>;
