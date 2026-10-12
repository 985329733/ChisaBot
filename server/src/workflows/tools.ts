/**
 * 在聊天里用工作流（docs/workflows.md §从聊天运行）：每个机器人都有 list_workflows 和 run_workflow。
 * 用户说「运行调研报告工作流，主题是…」或输入「/工作流 代码审查 …」，机器人就调 run_workflow，
 * 拿到运行页面的链接回给用户。长期任务 / 定时任务的回合也有这两个工具，所以「每天 8 点运行每日简报」
 * 就是一个普通的定时任务。工作流自己的步骤拿不到它们（不允许套娃）。
 */
import { z } from "zod";
import type { AuditInitiator } from "../audit";
import type { GrantedTool } from "../plugins/tools";
import type { WorkflowDefinition } from "../../../shared/workflows";
import { type WorkflowEngine, WorkflowRunError } from "./engine";
import { loadPresets } from "./presets";
import type { RunSource, WorkflowStore } from "./store";

type Candidate = { id: string; kind: "preset" | "mine"; definition: WorkflowDefinition };

async function candidates(store: WorkflowStore, ownerUserId: string): Promise<Candidate[]> {
  const mine = await store.list(ownerUserId);
  return [
    ...mine.map((w) => ({ id: w.id, kind: "mine" as const, definition: w.definition })),
    ...loadPresets().map((p) => ({ id: p.id, kind: "preset" as const, definition: p.definition })),
  ];
}

export function findWorkflow(list: Candidate[], query: string): Candidate | null {
  const q = query.trim().replace(/^\/+/, "").replace(/(工作流|workflow)$/i, "").trim().toLowerCase();
  if (!q) return null;
  return (
    list.find((c) => c.id.toLowerCase() === q) ??
    list.find((c) => c.definition.slug === q) ??
    list.find((c) => c.definition.name.toLowerCase() === q) ??
    list.find((c) => c.definition.name.toLowerCase().includes(q) || q.includes(c.definition.name.toLowerCase())) ??
    null
  );
}

function describe(c: Candidate) {
  return {
    id: c.id,
    name: c.definition.name,
    slug: c.definition.slug,
    kind: c.kind === "preset" ? "预设" : "我的",
    description: c.definition.description,
    inputs: c.definition.inputs.map((i) => ({
      key: i.key,
      label: i.label,
      type: i.type,
      required: !!i.required,
      ...(i.options ? { options: i.options } : {}),
      ...(i.default !== undefined ? { default: i.default } : {}),
    })),
    roles: c.definition.bots.map((b) => b.name),
    approvalSteps: c.definition.steps.filter((s) => s.approval).map((s) => s.name),
  };
}

export function workflowChatTools(options: {
  store: WorkflowStore;
  /** 取执行器（懒取：装工具时执行器可能还没建好，真正调用时才需要）。 */
  engine: () => WorkflowEngine;
  ownerUserId: string;
  botId: string;
  initiator?: AuditInitiator;
}): GrantedTool[] {
  if (options.initiator?.kind === "workflow") return [];
  const source: RunSource =
    options.initiator?.kind === "routine" || options.initiator?.kind === "responsibility" ? "routine" : "chat";
  const listParams = z.object({});
  const runParams = z.object({
    workflow: z.string().min(1).max(120).describe("工作流的名称、标识（slug）或 id，例如「调研报告」或 research-report"),
    inputs: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe("输入参数，键是 list_workflows 返回的 inputs[].key"),
  });
  return [
    {
      name: "list_workflows",
      ref: "workflows/list_workflows",
      description:
        "列出用户可以运行的工作流（预设 + 用户自己的），以及每个工作流需要的输入参数。用户提到「工作流」、输入以 /工作流 开头、或想一次让几个机器人按步骤协作完成任务时先调用它。",
      parameters: listParams,
      async execute() {
        const list = await candidates(options.store, options.ownerUserId);
        return JSON.stringify({ workflows: list.map(describe) });
      },
    },
    {
      name: "run_workflow",
      ref: "workflows/run_workflow",
      description:
        "运行一个工作流。必填输入缺了会返回缺哪些，向用户问清再调用；不要编造输入。开始后返回运行页面链接（相对路径，如 /workflows/runs/xxx），把链接用 Markdown 发给用户，说明可以在那里看每一步的进度、审批和结果。没有在工作流里指定机器人的角色由你来担任。",
      parameters: runParams,
      async execute(args) {
        const parsed = runParams.safeParse(args);
        if (!parsed.success) return "Refused. 参数格式不对：需要 workflow（名称）和可选的 inputs。";
        const list = await candidates(options.store, options.ownerUserId);
        const found = findWorkflow(list, parsed.data.workflow);
        if (!found)
          return JSON.stringify({
            ok: false,
            error: `没有叫「${parsed.data.workflow}」的工作流。`,
            available: list.map((c) => c.definition.name),
          });
        const missing = found.definition.inputs
          .filter((i) => i.required && i.default === undefined)
          .filter((i) => {
            const v = parsed.data.inputs?.[i.key];
            return v === undefined || (typeof v === "string" && !v.trim());
          })
          .map((i) => ({ key: i.key, label: i.label, ...(i.options ? { options: i.options } : {}) }));
        if (missing.length > 0)
          return JSON.stringify({ ok: false, needInputs: missing, message: "这些输入是必填的，请先问用户。" });
        try {
          const run = await options.engine().start({
            ownerUserId: options.ownerUserId,
            workflowId: found.id,
            definition: found.definition,
            inputs: parsed.data.inputs ?? {},
            fallbackBotId: options.botId,
            source,
          });
          return JSON.stringify({
            ok: true,
            runId: run.id,
            url: `/workflows/runs/${run.id}`,
            workflow: found.definition.name,
            steps: found.definition.steps.map((s) => s.name),
            approvalSteps: found.definition.steps.filter((s) => s.approval).map((s) => s.name),
            message: "已开始运行。",
          });
        } catch (error) {
          if (error instanceof WorkflowRunError) return JSON.stringify({ ok: false, error: error.message });
          throw error;
        }
      },
    },
  ];
}
