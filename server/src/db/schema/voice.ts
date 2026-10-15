import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { channels, users } from "./core";
import { jsonb } from "./json";

/**
 * 语音通话记录表。语音功能 2026-10-15 删掉（CB-046 第 2 步，DESIGN.md §68.7），表留着不动：不做破坏性迁移，旧数据还在。
 * 没有代码再读写它。
 */
export const voiceSessions = pgTable(
  "voice_sessions",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    anchorMessageId: text("anchor_message_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    transcript: jsonb("transcript")
      .$type<{ entries: unknown[] }>()
      .notNull(),
    summary: text("summary"),
    summaryStatus: text("summary_status")
      .$type<"ready" | "failed">()
      .notNull()
      .default("failed"),
  },
  (table) => [
    index("voice_sessions_channel_started_idx").on(
      table.channelId,
      table.startedAt,
      table.id,
    ),
    check("voice_sessions_duration_check", sql`${table.durationSeconds} >= 0`),
    check(
      "voice_sessions_summary_check",
      sql`(${table.summaryStatus} = 'ready' AND ${table.summary} IS NOT NULL) OR (${table.summaryStatus} = 'failed' AND ${table.summary} IS NULL)`,
    ),
  ],
);
