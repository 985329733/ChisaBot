import { randomUUID } from "node:crypto";
import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { livePanels } from "../db/schema";

export type LivePanelSource = { name: string; url: string };
export type LivePanelRow = typeof livePanels.$inferSelect;

export const MIN_REFRESH_MINUTES = 60;
export const MAX_PANELS_PER_BOT = 24;
/** 「撤销删除」保留多久。 */
export const UNDO_WINDOW_MS = 10 * 60_000;
const LEASE_MS = 8 * 60_000;

export class LivePanelError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export function clampRefresh(minutes: number | null | undefined): number | null {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(Math.max(Math.round(minutes), MIN_REFRESH_MINUTES), 7 * 24 * 60);
}

function cleanSources(sources: readonly LivePanelSource[] | undefined): LivePanelSource[] {
  const out: LivePanelSource[] = [];
  for (const s of sources ?? []) {
    try {
      const url = new URL(s.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      out.push({ name: (s.name || url.hostname).slice(0, 60), url: url.toString().slice(0, 500) });
    } catch {}
  }
  return out.slice(0, 6);
}

export function createLivePanelStore(db: Database) {
  const own = (owner: string, id: string) => and(eq(livePanels.id, id), eq(livePanels.ownerUserId, owner));
  async function get(owner: string, id: string): Promise<LivePanelRow> {
    const [row] = await db.select().from(livePanels).where(own(owner, id)).limit(1);
    if (!row) throw new LivePanelError("没有这个面板", 404);
    return row;
  }
  return {
    get,
    async list(owner: string, botId: string): Promise<LivePanelRow[]> {
      return db
        .select()
        .from(livePanels)
        .where(and(eq(livePanels.ownerUserId, owner), eq(livePanels.botId, botId), eq(livePanels.removed, false)))
        .orderBy(asc(livePanels.position), asc(livePanels.createdAt));
    },
    async create(owner: string, botId: string, input: { title: string; instruction: string; refreshMinutes?: number | null }) {
      const [{ count = 0 } = { count: 0 }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(livePanels)
        .where(and(eq(livePanels.ownerUserId, owner), eq(livePanels.botId, botId), eq(livePanels.removed, false)));
      if (count >= MAX_PANELS_PER_BOT) throw new LivePanelError(`面板太多了（最多 ${MAX_PANELS_PER_BOT} 个），先删掉一些`, 409);
      const [{ max = -1 } = { max: -1 }] = await db
        .select({ max: sql<number>`coalesce(min(${livePanels.position}), 0) - 1` })
        .from(livePanels)
        .where(and(eq(livePanels.ownerUserId, owner), eq(livePanels.botId, botId)));
      const row = {
        id: `lp_${randomUUID()}`,
        ownerUserId: owner,
        botId,
        title: input.title.trim().slice(0, 60) || "面板",
        status: "building",
        spec: null,
        sources: [],
        instruction: input.instruction.trim().slice(0, 2000),
        refreshMinutes: clampRefresh(input.refreshMinutes ?? null),
        position: max,
      };
      await db.insert(livePanels).values(row);
      return get(owner, row.id);
    },
    /** 机器人交来新数据（首次填充、刷新或修改）。 */
    async update(
      owner: string,
      id: string,
      input: { spec: string; sources?: LivePanelSource[]; title?: string; instruction?: string; refreshMinutes?: number | null; edit?: boolean },
    ) {
      const current = await get(owner, id);
      if (current.removed) throw new LivePanelError("这个面板已经删除了", 404);
      const now = new Date();
      const refreshMinutes = input.refreshMinutes === undefined ? current.refreshMinutes : clampRefresh(input.refreshMinutes);
      const changedShape =
        (input.title !== undefined && input.title.trim() !== current.title) ||
        (input.instruction !== undefined && input.instruction.trim() !== current.instruction);
      await db
        .update(livePanels)
        .set({
          spec: input.spec,
          sources: cleanSources(input.sources?.length ? input.sources : current.sources),
          ...(input.title?.trim() ? { title: input.title.trim().slice(0, 60) } : {}),
          ...(input.instruction?.trim() ? { instruction: input.instruction.trim().slice(0, 2000) } : {}),
          refreshMinutes,
          status: "ready",
          error: null,
          failures: 0,
          refreshedAt: now,
          nextRefreshAt: refreshMinutes ? new Date(now.getTime() + refreshMinutes * 60_000) : null,
          leaseUntil: null,
          updatedAt: now,
          ...((input.edit || changedShape) && current.spec
            ? {
                previous: {
                  title: current.title,
                  spec: current.spec,
                  sources: current.sources,
                  instruction: current.instruction,
                  refreshMinutes: current.refreshMinutes,
                },
              }
            : {}),
        })
        .where(own(owner, id));
      return get(owner, id);
    },
    async fail(owner: string, id: string, reason: string) {
      const current = await get(owner, id);
      const failures = current.failures + 1;
      const now = Date.now();
      // 失败后退避：1、2、4… 个刷新间隔，最多一天。
      const base = (current.refreshMinutes ?? 0) * 60_000;
      await db
        .update(livePanels)
        .set({
          status: current.spec ? "ready" : "failed",
          error: reason.slice(0, 300),
          failures,
          leaseUntil: null,
          nextRefreshAt: base ? new Date(now + Math.min(base * 2 ** Math.min(failures - 1, 4), 86_400_000)) : null,
          updatedAt: new Date(),
        })
        .where(own(owner, id));
      return get(owner, id);
    },
    /**
     * 这次没刷成，但不是面板的错（有人接管着计算机、服务器重启）：卡片写明原因，保留旧数据，
     * 不计失败次数、不退避，几分钟后再试。
     */
    async defer(owner: string, id: string, reason: string, retryMs: number) {
      const current = await get(owner, id);
      await db
        .update(livePanels)
        .set({
          status: current.spec ? "ready" : "failed",
          error: reason.slice(0, 300),
          leaseUntil: null,
          nextRefreshAt: new Date(Date.now() + retryMs),
          updatedAt: new Date(),
        })
        .where(own(owner, id));
      return get(owner, id);
    },
    async undoEdit(owner: string, id: string) {
      const current = await get(owner, id);
      const prev = current.previous as { title?: string; spec?: string; sources?: LivePanelSource[]; instruction?: string; refreshMinutes?: number | null } | null;
      if (!prev?.spec) throw new LivePanelError("没有可以撤销的修改", 409);
      await db
        .update(livePanels)
        .set({
          title: prev.title ?? current.title,
          spec: prev.spec,
          sources: prev.sources ?? current.sources,
          instruction: prev.instruction ?? current.instruction,
          refreshMinutes: prev.refreshMinutes ?? current.refreshMinutes,
          previous: null,
          status: "ready",
          error: null,
          updatedAt: new Date(),
        })
        .where(own(owner, id));
      return get(owner, id);
    },
    async setRefresh(owner: string, id: string, minutes: number | null) {
      const current = await get(owner, id);
      const refreshMinutes = clampRefresh(minutes);
      const from = current.refreshedAt?.getTime() ?? Date.now();
      await db
        .update(livePanels)
        .set({ refreshMinutes, nextRefreshAt: refreshMinutes ? new Date(Math.max(from + refreshMinutes * 60_000, Date.now() + 60_000)) : null, updatedAt: new Date() })
        .where(own(owner, id));
      return get(owner, id);
    },
    async remove(owner: string, id: string) {
      await get(owner, id);
      await db.update(livePanels).set({ removed: true, removedAt: new Date(), updatedAt: new Date() }).where(own(owner, id));
    },
    async restore(owner: string, id: string) {
      const row = await get(owner, id);
      if (!row.removed) return row;
      if (!row.removedAt || Date.now() - row.removedAt.getTime() > UNDO_WINDOW_MS) throw new LivePanelError("已经超过可以撤销的时间", 409);
      await db.update(livePanels).set({ removed: false, removedAt: null, updatedAt: new Date() }).where(own(owner, id));
      return get(owner, id);
    },
    async move(owner: string, botId: string, orderedIds: string[]) {
      for (const [index, id] of orderedIds.entries()) {
        await db.update(livePanels).set({ position: index }).where(and(own(owner, id), eq(livePanels.botId, botId)));
      }
    },
    /** 认领一个面板的刷新（租约）；拿不到返回 false。 */
    async claim(owner: string, id: string): Promise<boolean> {
      const now = new Date();
      const rows = await db
        .update(livePanels)
        .set({ leaseUntil: new Date(now.getTime() + LEASE_MS) })
        .where(and(own(owner, id), eq(livePanels.removed, false), or(isNull(livePanels.leaseUntil), lte(livePanels.leaseUntil, now))))
        .returning({ id: livePanels.id });
      return rows.length > 0;
    },
    async release(owner: string, id: string) {
      await db.update(livePanels).set({ leaseUntil: null }).where(own(owner, id));
    },
    /** 到点该刷新的面板（没有被删、有刷新间隔、没在刷新）。 */
    async due(limit = 4): Promise<LivePanelRow[]> {
      const now = new Date();
      return db
        .select()
        .from(livePanels)
        .where(
          and(
            eq(livePanels.removed, false),
            isNotNull(livePanels.refreshMinutes),
            isNotNull(livePanels.nextRefreshAt),
            lte(livePanels.nextRefreshAt, now),
            or(isNull(livePanels.leaseUntil), lte(livePanels.leaseUntil, now)),
          ),
        )
        .orderBy(asc(livePanels.nextRefreshAt))
        .limit(limit);
    },
    /** 建好卡片却一直没填数据（机器人中途放弃）的面板，超时后标为失败。 */
    async staleBuilding(olderThanMs: number): Promise<LivePanelRow[]> {
      return db
        .select()
        .from(livePanels)
        .where(
          and(
            eq(livePanels.removed, false),
            eq(livePanels.status, "building"),
            lte(livePanels.createdAt, new Date(Date.now() - olderThanMs)),
            or(isNull(livePanels.leaseUntil), lte(livePanels.leaseUntil, new Date())),
          ),
        )
        .limit(10);
    },
    async isLeased(row: LivePanelRow) {
      return Boolean(row.leaseUntil && row.leaseUntil.getTime() > Date.now());
    },
  };
}
export type LivePanelStore = ReturnType<typeof createLivePanelStore>;
