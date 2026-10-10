import { z } from "zod";
import {
  PanelError,
  type ActorContext,
  type CommitInput,
  type DraftWrite,
} from "../../../shared/panels/types";
import { validatePanelDefinition } from "../../../shared/panels/validate";
import type { GrantedTool } from "../plugins/tools";
import type { PanelStore } from "./store";
const schema = z.record(z.string(), z.unknown());
const capability = z
  .object({
    id: z.string(),
    adapter: z.string(),
    action: z.string(),
    inputSchema: schema,
    outputSchema: schema,
    scope: schema,
    effect: z.enum(["read", "write"]),
  })
  .strict();
const definitionSchema = z
  .object({
    name: z.string().max(80),
    html: z.string(),
    css: z.string(),
    script: z.string(),
    manifest: z
      .object({ data: z.array(capability), tasks: z.array(capability) })
      .strict(),
    stateSchema: schema,
    schemaVersion: z.number().int().positive(),
    initialState: z.unknown(),
    size: z
      .object({
        width: z.number().min(280).max(600),
        height: z.union([z.literal("auto"), z.number().min(160).max(960)]),
      })
      .strict(),
  })
  .strict();
const parameters = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative(),
    definition: definitionSchema,
  })
  .strict();
export function createPanelAuthoring(options: {
  store: PanelStore;
  authorize(ctx: ActorContext, manage: boolean): Promise<void>;
  audit?: (event: Record<string, unknown>) => Promise<void>;
}) {
  const ctxCopy = (ctx: ActorContext) => Object.freeze({ ...ctx });
  async function authorize(ctx: ActorContext, manage = true) {
    if (!ctx.actorId || !ctx.botId)
      throw new PanelError("unauthenticated", 401);
    try {
      await options.authorize(ctx, manage);
    } catch (error) {
      if (error instanceof PanelError) throw error;
      throw new PanelError("panel_permission_refused", 403);
    }
  }
  async function record(ctx: ActorContext, operation: string, id?: string) {
    await options.audit?.({
      actorId: ctx.actorId,
      botId: ctx.botId,
      operation,
      ...(id ? { resourceId: id } : {}),
    });
  }
  async function save(ctx: ActorContext, input: DraftWrite) {
    await authorize(ctx);
    const definition = validatePanelDefinition(input.definition);
    await options.store.getSession(ctx, input.sessionId);
    await record(ctx, "draft", input.sessionId);
    return options.store.saveDraft(ctx, { ...input, definition });
  }
  return {
    authorize,
    async beginPanelAuthoring(ctx: ActorContext, targetInstanceId?: string) {
      await authorize(ctx);
      await record(ctx, "begin", targetInstanceId);
      return options.store.beginSession(ctx, targetInstanceId);
    },
    proposePanelDraft: save,
    revisePanelDraft: save,
    async commit(ctx: ActorContext, input: CommitInput) {
      await authorize(ctx);
      await record(ctx, "commit", input.draftId);
      return options.store.commit(ctx, input);
    },
    async tools(
      ctx: ActorContext,
      sessionId: string,
    ): Promise<readonly GrantedTool[]> {
      ctx = ctxCopy(ctx);
      await authorize(ctx);
      const session = await options.store.getSession(ctx, sessionId);
      if (session.draft?.status === "saved") return [];
      const source =
        session.draft?.definition ??
        (session.targetInstanceId
          ? (await options.store.getInstance(ctx, session.targetInstanceId))
              .definition
          : null);
      const context = source
        ? `当前完整定义（仅样例初始状态，不含用户私有状态），草稿修订 ${session.draft?.draftRevision ?? 0}: ${JSON.stringify(source)}`
        : "新面板会话，首次提交 expectedDraftRevision 为 0。";
      return ["proposePanelDraft", "revisePanelDraft"].map((name) => ({
        name,
        ref: `panel:${name}`,
        parameters,
        description: `${name === "proposePanelDraft" ? "提出" : "修改"}完整面板草稿；只保存草稿，不安装、不授权、不执行。${context} definition 必须包含 name/html/css/script/manifest/stateSchema/schemaVersion/initialState/size。HTML 禁止 script、iframe、事件属性和联网；安全标签使用 data-node，按钮使用 data-action。脚本仅使用 panel.on(action,async event=>{}), panel.ui.patch([{node,text,attrs,children}]), panel.state.read/write, panel.data.read(id,args), panel.tasks.request(id,args)；无 DOM、网络、浏览器存储或模块。预览仅运行示例数据与临时状态。首次 expectedDraftRevision=0，后续使用上次返回的 draftRevision。中文简洁右栏，宽340，自动高。固定能力 bot/overview read: inputSchema={type:'object',additionalProperties:false}, outputSchema={type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}; bot/task write: inputSchema={type:'object',properties:{instruction:{type:'string',minLength:1,maxLength:5000}},required:['instruction'],additionalProperties:false}, outputSchema={type:'object',additionalProperties:false}; scope={actor:'current',bot:'current'}。manifest 仅申请，保存后用户单独批准。状态 schema 仅支持 type/properties/required/additionalProperties/items/enum/const/minimum/maximum/minLength/maxLength/minItems/maxItems/title/description。`,
        execute: async (args: unknown) => {
          const input = parameters.parse(args);
          if (
            (name === "proposePanelDraft" &&
              input.expectedDraftRevision !== 0) ||
            (name === "revisePanelDraft" && input.expectedDraftRevision < 1)
          )
            throw new PanelError("draft_revision_conflict");
          const draft = await save(ctx, {
            sessionId,
            expectedDraftRevision: input.expectedDraftRevision,
            definition: validatePanelDefinition(input.definition),
          });
          return JSON.stringify({
            draftId: draft.id,
            draftRevision: draft.draftRevision,
            status: draft.status,
          });
        },
      }));
    },
  };
}
export type PanelAuthoring = ReturnType<typeof createPanelAuthoring>;
