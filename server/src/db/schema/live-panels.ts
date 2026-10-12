import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { jsonb } from "./json";

/**
 * 实时面板（2026-10-13）：机器人用 json-render 规范画、按计划自己刷新数据的右栏卡片。
 * 与 HTML 自定义面板（bot_panel_instances）并存；见 server/src/live-panels/。
 */
export const livePanels = pgTable(
  "live_panels",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id").notNull(),
    botId: text("bot_id").notNull(),
    title: text("title").notNull(),
    /** building | ready | failed */
    status: text("status").notNull(),
    /** json-render SpecStream（JSONL），与 render_ui 同一格式。 */
    spec: text("spec"),
    sources: jsonb("sources").$type<{ name: string; url: string }[]>().notNull(),
    /** 刷新时机器人要做什么（用户原话 + 机器人补充的数据来源）。 */
    instruction: text("instruction").notNull(),
    /** 刷新间隔（分钟，最少 60）；null = 不自动刷新。 */
    refreshMinutes: integer("refresh_minutes"),
    error: text("error"),
    /** 上一版（spec / title / sources / instruction），给「撤销修改」。 */
    previous: jsonb("previous").$type<Record<string, unknown> | null>(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    nextRefreshAt: timestamp("next_refresh_at", { withTimezone: true }),
    /** 刷新租约：正在刷新的到期时间，防止两次刷新叠在一起。 */
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    failures: integer("failures").notNull().default(0),
    position: integer("position").notNull().default(0),
    removed: boolean("removed").notNull().default(false),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_panels_owner_bot_idx").on(t.ownerUserId, t.botId),
    index("live_panels_next_refresh_idx").on(t.nextRefreshAt),
  ],
);
