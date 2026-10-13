/**
 * 实时面板（2026-10-13，向 Hark 的面板体验看齐）。
 *
 * 用户用一句话要面板（「做一个比特币价格面板，每小时更新」）：
 *  1. 机器人先 `panel_create`：右栏立刻出现一张「正在搭建…」的卡片；
 *  2. 同一回合里用 web_search / web_fetch 取真实数据，`panel_update` 交上 json-render 规范（与
 *     render_ui 同一份组件目录）和数据来源，卡片原地填好，带标题、来源、更新时间；
 *  3. 之后按 refreshMinutes（最少 60 分钟）由服务器自己的刷新循环在后台跑一个无头回合，同一个机器人
 *     重新取数、再 `panel_update`。刷新失败会把原因写在卡片上，并按间隔退避；
 *  4. 改面板就在对话里说（「改成显示以太坊」）：机器人 `panel_update` 带新的 title / instruction，
 *     上一版留作「撤销修改」；删除可在 10 分钟内撤销。
 *
 * 用户看不到 JSON / 规范：卡片只画结果。
 */
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { inspectRenderUiSpec, parseRenderUiSpec, sanitizeRenderUiSpec } from "../../../shared/json-render/catalog";
import { emptySections } from "../../../shared/json-render/empty-sections";
import type { AppVariables } from "../auth/guards";
import { REFUSAL_MARKER, type GrantedTool } from "../plugins/tools";
import { LivePanelError, type LivePanelRow, type LivePanelStore, MIN_REFRESH_MINUTES } from "./store";

export type LivePanelDto = {
  id: string;
  botId: string;
  title: string;
  status: "building" | "ready" | "failed";
  spec: string | null;
  sources: { name: string; url: string }[];
  instruction: string;
  refreshMinutes: number | null;
  error: string | null;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  refreshing: boolean;
  canUndoEdit: boolean;
  createdAt: string;
};

export function toDto(row: LivePanelRow): LivePanelDto {
  return {
    id: row.id,
    botId: row.botId,
    title: row.title,
    status: (row.status as LivePanelDto["status"]) ?? "ready",
    spec: row.spec,
    sources: row.sources ?? [],
    instruction: row.instruction,
    refreshMinutes: row.refreshMinutes,
    error: row.error,
    refreshedAt: row.refreshedAt?.toISOString() ?? null,
    nextRefreshAt: row.nextRefreshAt?.toISOString() ?? null,
    refreshing: Boolean(row.leaseUntil && row.leaseUntil.getTime() > Date.now()),
    canUndoEdit: Boolean((row.previous as { spec?: string } | null)?.spec),
    createdAt: row.createdAt.toISOString(),
  };
}

const sourceSchema = z.object({ name: z.string().max(60).describe("来源名，如 CoinGecko"), url: z.string().max(500).describe("来源网址") });
const createParameters = z.object({
  title: z.string().min(1).max(60).describe("面板标题，简短中文，如「比特币价格」"),
  instruction: z
    .string()
    .min(1)
    .max(2000)
    .describe("以后每次刷新要做什么：显示哪些数据、从哪里取（写清楚接口或网址）、怎么排版。刷新时你只看得到这句话和上一版面板。"),
  refreshMinutes: z
    .number()
    .int()
    .min(0)
    .max(10080)
    .optional()
    .describe("自动刷新间隔（分钟）。行情、天气这类会变的数据填 60（最短 60）；用户说每天就填 1440；不会变的内容填 0 = 不刷新。默认 60。"),
  duplicate: z.boolean().optional().describe("右栏已有同名面板、而用户确实要再做一个时才填 true"),
});
const updateParameters = z.object({
  id: z.string().min(1).describe("panel_create 返回的面板 id"),
  spec: z
    .string()
    .min(2)
    .max(100_000)
    .describe("面板内容：json-render 规范，格式和组件与 render_ui 完全相同（JSONL 或完整 {root,elements} JSON）。只放结果（数字、列表、表格），不要放「数据来源」「更新时间」，卡片会自己显示。宽度按 340px 的窄卡设计。"),
  sources: z.array(sourceSchema).min(1).max(6).describe("这次数据实际来自哪里（必须是你刚刚读过的网址）"),
  title: z.string().min(1).max(60).optional().describe("改标题时才填"),
  instruction: z.string().min(1).max(2000).optional().describe("用户要求修改面板时，填新的刷新说明（例如改成显示以太坊）"),
  refreshMinutes: z.number().int().min(0).max(10080).optional().describe("改刷新间隔时才填"),
});
const idParameters = z.object({ id: z.string().min(1) });
const failParameters = z.object({ id: z.string().min(1), reason: z.string().min(1).max(300).describe("用一句大白话说明为什么取不到数据") });

export const LIVE_PANEL_GUIDANCE = [
  "面板：用户要「面板 / 看板 / 卡片 / 小组件」或想长期盯着某个会变的东西（价格、天气、汇率、排行、倒计时）时，做成右栏面板，不要只在对话里画：",
  "1) 先 panel_create（标题 + 刷新说明 + 刷新间隔），卡片会立刻出现在右栏；对话里只说一句「好的，正在做…面板」。",
  "2) 再用 web_search / web_fetch 取真实数据（优先公开 JSON 接口，例如 api.coingecko.com、api.open-meteo.com），绝不编造数字。",
  "3) 用 panel_update 交上 json-render 规范 + 来源（数字、列表、表格都直接写成字面值：List 的 items / Table 的 rows 直接列出每一行，不要用 repeat 或 $state 绑定）；最后对话里一句话说做好了、多久刷新一次，并提一个有用的下一步。",
  "要改已有面板（换内容、换城市、换币种、改刷新频率）时先 panel_list 找到它，取新数据后 panel_update（带新的 instruction / title），不要新建。",
  "实在取不到数据就 panel_fail 说明原因，并在对话里如实告诉用户。不要在对话里贴规范、JSON 或代码。",
].join("\n");


/**
 * 面板里的大数字不能是空的（2026-10-13 第二轮实测：比特币面板「现价（美元）」下面一片空白——
 * 模型把数值绑到了 state 里不存在的路径）。json-render 的校验只管结构，这里补一道：Metric 的 value
 * 为空、或 $state 指向 spec.state 里没有的值，就退回去让机器人直接写数字。
 */
export function emptyMetrics(source: string): string[] {
  const spec = sanitizeRenderUiSpec(parseRenderUiSpec(source, false))?.spec as
    | { elements?: Record<string, { type?: string; props?: Record<string, unknown> }>; state?: Record<string, unknown> }
    | undefined;
  if (!spec?.elements) return [];
  const lookup = (path: string) =>
    path
      .split("/")
      .filter(Boolean)
      .reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), spec.state ?? {});
  const missing: string[] = [];
  for (const element of Object.values(spec.elements)) {
    if (element?.type !== "Metric") continue;
    const value = element.props?.value;
    const label = String(element.props?.label ?? "数值");
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) missing.push(label);
    else if (typeof value === "object" && typeof (value as { $state?: unknown }).$state === "string") {
      const resolved = lookup((value as { $state: string }).$state);
      if (resolved === undefined || resolved === null || resolved === "") missing.push(label);
    }
  }
  return missing;
}

export function createLivePanelService(deps: {
  store: LivePanelStore;
  /** 在一个用完即删的对话里，以面板主人的身份跑这个机器人的一个无头回合（工作流同一条路）。 */
  runHeadless(input: { ownerUserId: string; botId: string; instruction: string; panelId: string; signal: AbortSignal }): Promise<void>;
  log?: (event: Record<string, unknown>) => void;
}) {
  const { store } = deps;
  const log = deps.log ?? ((event) => console.info(JSON.stringify(event)));
  const running = new Map<string, AbortController>();

  function refreshPrompt(row: LivePanelRow, firstFill: boolean) {
    return [
      `【后台刷新面板，不是用户在聊天】面板「${row.title}」（id: ${row.id}）${firstFill ? "还没有内容，需要第一次填好" : "需要刷新数据"}。`,
      `刷新说明：${row.instruction}`,
      row.spec ? `上一版面板规范（保持同样的布局，只换成最新数据）：\n${row.spec.slice(0, 12_000)}` : "",
      "现在：用 web_search / web_fetch 取最新的真实数据，然后调用 panel_update（id 同上，带 spec 和 sources）。取不到就调用 panel_fail 说明原因。不要做别的事，也不需要回复任何文字。",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  async function refreshNow(ownerUserId: string, id: string): Promise<{ started: boolean; reason?: string }> {
    const row = await store.get(ownerUserId, id);
    if (row.removed) throw new LivePanelError("这个面板已经删除了", 404);
    if (!(await store.claim(ownerUserId, id))) return { started: false, reason: "正在刷新" };
    const startedAt = Date.now();
    const controller = new AbortController();
    running.set(id, controller);
    const timer = setTimeout(() => controller.abort(new Error("刷新超时")), 6 * 60_000);
    void (async () => {
      try {
        await deps.runHeadless({ ownerUserId, botId: row.botId, instruction: refreshPrompt(row, !row.spec), panelId: id, signal: controller.signal });
        const after = await store.get(ownerUserId, id);
        const updated = after.refreshedAt && after.refreshedAt.getTime() >= startedAt;
        const failedNow = after.error && after.updatedAt.getTime() >= startedAt && !updated;
        if (!updated && !failedNow) await store.fail(ownerUserId, id, "这次刷新没有拿到新数据（机器人没有更新面板），稍后会再试。");
        log({ type: "live-panel-refresh", id, ok: Boolean(updated), ms: Date.now() - startedAt });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await store.fail(ownerUserId, id, `刷新失败：${reason.slice(0, 200)}`).catch(() => {});
        log({ type: "live-panel-refresh", id, ok: false, reason: reason.slice(0, 200) });
      } finally {
        clearTimeout(timer);
        running.delete(id);
        await store.release(ownerUserId, id).catch(() => {});
      }
    })();
    return { started: true };
  }

  /** 每分钟一次：到点的面板刷新；建了卡片却一直没填的，补跑一次，再不行就标失败。 */
  async function sweep() {
    try {
      for (const row of await store.due(3)) {
        if (running.size >= 3) break;
        await refreshNow(row.ownerUserId, row.id).catch((error) => log({ type: "live-panel-sweep-error", id: row.id, reason: String(error) }));
      }
      // 建了卡片却一直没填（聊天里的回合中途放弃）：标成「正在重试」，补跑一次后台填充；
      // 再失败就停在失败状态，卡片上写明原因（staleBuilding 只挑 building，不会无限重试）。
      for (const row of await store.staleBuilding(3 * 60_000)) {
        if (running.size >= 3) break;
        await store.fail(row.ownerUserId, row.id, "第一次没填好，正在重试…").catch(() => {});
        await refreshNow(row.ownerUserId, row.id).catch(() => {});
      }
    } catch (error) {
      log({ type: "live-panel-sweep-failed", reason: error instanceof Error ? error.message : String(error) });
    }
  }
  let timer: ReturnType<typeof setInterval> | undefined;

  function tools(actorId: string, botId: string, options: { refreshOf?: string } = {}): GrantedTool[] {
    const guard = async (id: string) => {
      const row = await store.get(actorId, id);
      if (row.botId !== botId) throw new LivePanelError("这个面板不属于当前机器人", 404);
      return row;
    };
    const say = (error: unknown) => `${REFUSAL_MARKER} ${error instanceof Error ? error.message : "操作失败"}`;
    const list: GrantedTool[] = [
      {
        name: "panel_update",
        ref: "live-panels/panel_update",
        description:
          "把取到的真实数据画进右栏面板（首次填充、刷新、或按用户要求修改）。spec 用 render_ui 同一套组件（Card/Stat/Table/List/Badge… 规则同 render_ui），窄卡 340px：一个大数字 + 涨跌徽章 + 几行补充最好看。来源 sources 必填。",
        parameters: updateParameters,
        execute: async (args) => {
          const parsed = updateParameters.safeParse(args);
          if (!parsed.success) return `${REFUSAL_MARKER} 参数不对：${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("；")}`;
          try {
            await guard(parsed.data.id);
            const verdict = inspectRenderUiSpec(parsed.data.spec);
            if (!verdict.ok) return [`${REFUSAL_MARKER} 面板规范无效，没有保存。修正后再调用 panel_update：`, ...verdict.issues.map((i) => `- ${i}`)].join("\n");
            const empty = emptyMetrics(parsed.data.spec);
            if (empty.length) return `${REFUSAL_MARKER} 面板没有保存：${empty.map((l) => `「${l}」`).join("、")}没有数值。把取到的数字直接写进 Metric 的 value（字符串，例如 "$82,407"），不要用 $state 绑定，然后再调用 panel_update。`;
            // 空列表 / 空重复区块（2026-10-13 第三轮实测：香港天气「未来 5 天」只剩标题）：退回去让机器人把数据写进去。
            const hollow = emptySections(sanitizeRenderUiSpec(parseRenderUiSpec(parsed.data.spec, false))?.spec ?? null);
            if (hollow.length)
              return `${REFUSAL_MARKER} 面板没有保存：${hollow.map((l) => `「${l}」`).join("、")}下面是空的（List 的 items / Table 的 rows 是空的，或 repeat.statePath 指向的 state 数组不存在或为空）。把取到的每一行直接写进 List 的 items（或 Table 的 rows），不要用 repeat 和 $state，然后再调用 panel_update；确实没有数据就把这一节连同标题一起删掉。`;
            const row = await store.update(actorId, parsed.data.id, { ...parsed.data, edit: Boolean(parsed.data.instruction || parsed.data.title) && !options.refreshOf });
            return `面板「${row.title}」已更新${row.refreshMinutes ? `，之后每 ${row.refreshMinutes >= 1440 ? `${Math.round(row.refreshMinutes / 1440)} 天` : row.refreshMinutes >= 60 ? `${Math.round(row.refreshMinutes / 60)} 小时` : `${row.refreshMinutes} 分钟`}自动刷新` : ""}。${options.refreshOf ? "这是后台刷新，不需要回复。" : "对话里只用一句话告诉用户，不要贴面板内容或规范。"}`;
          } catch (error) {
            return say(error);
          }
        },
      },
      {
        name: "panel_fail",
        ref: "live-panels/panel_fail",
        description: "取不到面板需要的数据时调用，用一句大白话写明原因（会显示在面板卡片上）。",
        parameters: failParameters,
        execute: async (args) => {
          const parsed = failParameters.safeParse(args);
          if (!parsed.success) return `${REFUSAL_MARKER} 需要 id 和 reason`;
          try {
            await guard(parsed.data.id);
            await store.fail(actorId, parsed.data.id, parsed.data.reason);
            return "已记下原因并显示在面板上。";
          } catch (error) {
            return say(error);
          }
        },
      },
    ];
    if (options.refreshOf) return list;
    return [
      {
        name: "panel_create",
        ref: "live-panels/panel_create",
        description:
          "在右栏新建一个会自动刷新的面板（用户要面板 / 看板 / 小组件，或想持续关注某个会变的数据时）。立刻返回 id，卡片先显示「正在搭建」；接着取真实数据并调用 panel_update 填好。改已有面板不要新建，用 panel_list + panel_update。",
        parameters: createParameters,
        execute: async (args) => {
          const parsed = createParameters.safeParse(args);
          if (!parsed.success) return `${REFUSAL_MARKER} 需要 title 和 instruction`;
          try {
            // 一个主题一张卡（Hark 的做法）：同名面板已在右栏就先别新建，让机器人去更新那张。
            if (!parsed.data.duplicate) {
              const same = (await store.list(actorId, botId)).find((r) => r.title.trim() === parsed.data.title.trim());
              if (same)
                return JSON.stringify({
                  created: false,
                  existing: { id: same.id, title: same.title, status: same.status },
                  next: "右栏已经有这张面板，没有新建。用户要的若是同一个东西，就取最新数据后 panel_update 这张（id 见 existing）；用户明确要再做一张时，才带 duplicate: true 重新 panel_create。",
                });
            }
            const { duplicate: _duplicate, ...input } = parsed.data;
            const row = await store.create(actorId, botId, { ...input, refreshMinutes: input.refreshMinutes ?? MIN_REFRESH_MINUTES });
            return JSON.stringify({ id: row.id, status: "building", next: "卡片已出现在右栏（正在搭建）。现在用 web_search / web_fetch 取真实数据，然后调用 panel_update 填好。" });
          } catch (error) {
            return say(error);
          }
        },
      },
      {
        name: "panel_list",
        ref: "live-panels/panel_list",
        description: "列出当前机器人右栏里的实时面板（id、标题、状态、刷新说明、刷新间隔、上次更新）。修改或删除面板前先用它找到 id。",
        parameters: z.object({}),
        execute: async () => {
          const rows = await store.list(actorId, botId);
          if (rows.length === 0) return "右栏还没有实时面板。";
          return rows
            .map((r) => `- ${r.id}｜${r.title}｜${r.status}${r.error ? `（${r.error}）` : ""}｜每 ${r.refreshMinutes ?? 0} 分钟｜上次更新 ${r.refreshedAt?.toISOString() ?? "无"}｜说明：${r.instruction}`)
            .join("\n");
        },
      },
      {
        name: "panel_remove",
        ref: "live-panels/panel_remove",
        description: "用户明确要求删除某个面板时调用（用户 10 分钟内可在右栏撤销）。",
        parameters: idParameters,
        execute: async (args) => {
          const parsed = idParameters.safeParse(args);
          if (!parsed.success) return `${REFUSAL_MARKER} 需要 id`;
          try {
            await guard(parsed.data.id);
            await store.remove(actorId, parsed.data.id);
            return "已删除（用户可在右栏撤销）。";
          } catch (error) {
            return say(error);
          }
        },
      },
      ...list,
    ];
  }

  function routes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>) {
    const app = new Hono<{ Variables: AppVariables }>();
    app.use("*", requireUser);
    const fail = (c: { json: (b: unknown, s: number) => Response }, error: unknown) =>
      error instanceof LivePanelError ? c.json({ error: error.message }, error.status) : c.json({ error: "面板服务暂时不可用" }, 500);
    app.get("/", async (c) => {
      const botId = c.req.query("botId");
      if (!botId) return c.json({ error: "缺少 botId" }, 400);
      const rows = await store.list(c.var.actor.id, botId);
      return c.json({ items: rows.map(toDto) });
    });
    app.post("/:id/refresh", async (c) => {
      try {
        const result = await refreshNow(c.var.actor.id, c.req.param("id"));
        return c.json({ ...result, panel: toDto(await store.get(c.var.actor.id, c.req.param("id"))) });
      } catch (error) {
        return fail(c, error);
      }
    });
    app.post("/:id/undo-edit", async (c) => {
      try {
        return c.json({ panel: toDto(await store.undoEdit(c.var.actor.id, c.req.param("id"))) });
      } catch (error) {
        return fail(c, error);
      }
    });
    app.patch("/:id", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { refreshMinutes?: number | null };
      try {
        if (body.refreshMinutes === undefined) return c.json({ error: "没有要改的内容" }, 400);
        return c.json({ panel: toDto(await store.setRefresh(c.var.actor.id, c.req.param("id"), body.refreshMinutes)) });
      } catch (error) {
        return fail(c, error);
      }
    });
    app.delete("/:id", async (c) => {
      try {
        running.get(c.req.param("id"))?.abort(new Error("面板已删除"));
        await store.remove(c.var.actor.id, c.req.param("id"));
        return c.json({ ok: true });
      } catch (error) {
        return fail(c, error);
      }
    });
    app.post("/:id/restore", async (c) => {
      try {
        return c.json({ panel: toDto(await store.restore(c.var.actor.id, c.req.param("id"))) });
      } catch (error) {
        return fail(c, error);
      }
    });
    app.post("/order", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { botId?: string; ids?: string[] };
      if (!body.botId || !Array.isArray(body.ids)) return c.json({ error: "缺少 botId / ids" }, 400);
      await store.move(c.var.actor.id, body.botId, body.ids.slice(0, 50));
      return c.json({ ok: true });
    });
    return app;
  }

  return {
    tools,
    routes,
    refreshNow,
    sweep,
    start() {
      timer ??= setInterval(() => void sweep(), 60_000);
      setTimeout(() => void sweep(), 15_000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      for (const controller of running.values()) controller.abort(new Error("服务器重启"));
    },
  };
}
export type LivePanelService = ReturnType<typeof createLivePanelService>;
