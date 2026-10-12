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
        description: `${name === "proposePanelDraft" ? "创建" : "修改"}面板并保存到右侧面板栏（不授权能力、不执行任务）。用户此刻正在右栏「新建 / 编辑面板」：用户要的面板必须用这个工具保存（不要用 render_ui 在对话里画，那不会出现在面板栏）；工具会直接把面板放进右侧面板栏，之后在对话里只用一句话确认。面板脚本里需要日期、时间时用 new Date() 实时计算，不要写死。一次写对（校验失败不产生修订，重试仍用同一个 expectedDraftRevision；不要在对话里逐条报告重试）：stateSchema 每一层都必须有 type（object 要有 properties），不需要状态时用 {type:'object',properties:{}} 和 initialState {}；CSS 只用类选择器，伪类只允许 hover/focus/focus-visible/focus-within/disabled/checked/first-child/last-child/root，禁止 @规则、url()、animation、filter；不需要能力时 manifest 为 {data:[],tasks:[]}。${context} definition 必须包含 name/html/css/script/manifest/stateSchema/schemaVersion/initialState/size。HTML 禁止 script、iframe、事件属性和联网；安全标签使用 data-node，按钮使用 data-action。脚本仅使用 panel.on(action,async event=>{}), panel.ui.patch([{node,text,attrs,children}]), panel.state.read/write, panel.data.read(id,args), panel.tasks.request(id,args)；无 DOM、网络、浏览器存储或模块。预览仅运行示例数据与临时状态。首次 expectedDraftRevision=0，后续使用上次返回的 draftRevision。中文简洁右栏，宽340，自动高。固定能力 bot/overview read: inputSchema={type:'object',additionalProperties:false}, outputSchema={type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false}; bot/task write: inputSchema={type:'object',properties:{instruction:{type:'string',minLength:1,maxLength:5000}},required:['instruction'],additionalProperties:false}, outputSchema={type:'object',additionalProperties:false}; scope={actor:'current',bot:'current'}。manifest 仅申请，保存后用户单独批准。状态 schema 仅支持 type/properties/required/additionalProperties/items/enum/const/minimum/maximum/minLength/maxLength/minItems/maxItems/title/description。`,
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
          // 创作会话只能由用户开启（右栏「新建 / 编辑」或在对话里明确要一个面板），所以这是用户
          // 明确要的面板：直接保存进面板栏（用户可在卡片上撤销 / 删除），不再停在「预览并保存」。
          // 保存不了（例如需要重置状态）时退回草稿，请用户在右栏预览后保存。
          try {
            const saved = await options.store.commit(ctx, {
              draftId: draft.id,
              expectedDraftRevision: draft.draftRevision,
              mode: draft.targetInstanceId ? "instance" : "first",
              idempotencyKey: crypto.randomUUID(),
              resetState: false,
              ...(draft.baseInstanceVersion !== null
                ? { baseInstanceVersion: draft.baseInstanceVersion }
                : {}),
              ...(draft.baseLibraryVersion !== null
                ? { baseLibraryVersion: draft.baseLibraryVersion }
                : {}),
            });
            await record(ctx, "commit", draft.id);
            return JSON.stringify({
              status: "saved",
              instanceId: saved.instanceId,
              note: "面板已保存到右侧面板栏。对话里只用一句话告诉用户已经放好，不要再贴面板内容。",
            });
          } catch (error) {
            return JSON.stringify({
              draftId: draft.id,
              draftRevision: draft.draftRevision,
              status: draft.status,
              note: `草稿已保存，但没能自动放进面板栏（${error instanceof Error ? error.message : "未知原因"}）。请用户在右栏点「预览与保存」。`,
            });
          }
        },
      }));
    },
  };
}
export type PanelAuthoring = ReturnType<typeof createPanelAuthoring>;
