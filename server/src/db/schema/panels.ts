import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  CommitResult,
  Json,
  PanelDefinition,
  PanelGrant,
} from "../../../../shared/panels/types";
import { jsonb } from "./json";
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const panelLibraryEntries = pgTable("panel_library_entries", {
  id: text("id").primaryKey(),
  creatorActorId: text("creator_actor_id").notNull(),
  currentVersion: integer("current_version").notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
});
export const panelLibraryVersions = pgTable(
  "panel_library_versions",
  {
    libraryId: text("library_id")
      .notNull()
      .references(() => panelLibraryEntries.id),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<PanelDefinition>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.libraryId, t.version] })],
);
export const botPanelInstances = pgTable(
  "bot_panel_instances",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id").notNull(),
    currentVersion: integer("current_version").notNull(),
    sourceLibraryId: text("source_library_id").references(
      () => panelLibraryEntries.id,
    ),
    sourceVersion: integer("source_version"),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    collapsed: boolean("collapsed").notNull().default(false),
    size: jsonb("size").$type<PanelDefinition["size"]>().notNull(),
    removed: boolean("removed").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("bot_panel_instances_bot_position_idx").on(t.botId, t.position),
  ],
);
export const botPanelInstanceVersions = pgTable(
  "bot_panel_instance_versions",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => botPanelInstances.id),
    version: integer("version").notNull(),
    definition: jsonb("definition").$type<PanelDefinition>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.version] })],
);
export const panelAuthoringSessions = pgTable(
  "panel_authoring_sessions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    botId: text("bot_id").notNull(),
    targetInstanceId: text("target_instance_id").references(
      () => botPanelInstances.id,
    ),
    baseInstanceVersion: integer("base_instance_version"),
    baseLibraryVersion: integer("base_library_version"),
    cancelled: boolean("cancelled").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("panel_authoring_actor_bot_idx").on(t.actorId, t.botId)],
);
export const panelDrafts = pgTable(
  "panel_drafts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => panelAuthoringSessions.id),
    actorId: text("actor_id").notNull(),
    botId: text("bot_id").notNull(),
    targetInstanceId: text("target_instance_id").references(
      () => botPanelInstances.id,
    ),
    draftRevision: integer("draft_revision").notNull(),
    baseInstanceVersion: integer("base_instance_version"),
    baseLibraryVersion: integer("base_library_version"),
    definition: jsonb("definition").$type<PanelDefinition>().notNull(),
    status: text("status").$type<"ready" | "saved" | "cancelled">().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("panel_drafts_session_idx").on(t.sessionId)],
);
export const panelStates = pgTable(
  "panel_states",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => botPanelInstances.id),
    actorId: text("actor_id").notNull(),
    stateRevision: integer("state_revision").notNull(),
    payload: jsonb("payload").$type<{ value: Json }>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.actorId] })],
);
export const panelOperations = pgTable(
  "panel_operations",
  {
    actorId: text("actor_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    botId: text("bot_id").notNull(),
    requestHash: text("request_hash").notNull(),
    result: jsonb("result").$type<CommitResult>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.idempotencyKey] })],
);
export const panelCapabilityGrants = pgTable(
  "panel_capability_grants",
  {
    instanceId: text("instance_id")
      .notNull()
      .references(() => botPanelInstances.id),
    actorId: text("actor_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    grant: jsonb("grant").$type<PanelGrant>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.instanceId, t.actorId, t.capabilityId] })],
);
export const panelTaskRequests = pgTable(
  "panel_task_requests",
  {
    id: text("id").primaryKey(),
    instanceId: text("instance_id")
      .notNull()
      .references(() => botPanelInstances.id),
    actorId: text("actor_id").notNull(),
    botId: text("bot_id").notNull(),
    instanceVersion: integer("instance_version").notNull(),
    capabilityId: text("capability_id").notNull(),
    capabilityHash: text("capability_hash").notNull(),
    args: jsonb("args").$type<{ value: Json }>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status")
      .$type<
        | "pending"
        | "confirmed"
        | "running"
        | "waiting"
        | "unknown"
        | "succeeded"
        | "failed"
        | "cancelled"
      >()
      .notNull(),
    runId: text("run_id"),
    channelId: text("channel_id"),
    threadId: text("thread_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("panel_tasks_actor_key_idx").on(t.actorId, t.idempotencyKey),
    index("panel_tasks_actor_created_idx").on(t.actorId, t.createdAt),
  ],
);
