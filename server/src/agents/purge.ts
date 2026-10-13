/**
 * Deleting a Bot completely.
 *
 * WHY THIS EXISTS. Deleting a Bot used to stamp `agent_profiles.deleted_at` and stop there. The Bot
 * left the roster, but everything it had — the person's private conversations with it, the memories
 * it formed, its routines and responsibilities, queued follow-ups, background research, panels, the
 * "main Bot" preference pointing at it, its browser profile — stayed behind. Its conversations kept
 * it registered as a tombstone, and the row itself lingered forever. People read that as "the Bot
 * cannot be deleted" (机器人无法彻底删除).
 *
 * WHAT IT DOES, IN ORDER.
 *   1. The same per-person reset the profile screen offers: private conversations (soft-deleted
 *      through the channel store so every open tab is told), memory sources and imported memories,
 *      routines, responsibilities, follow-ups, formed memories, background research, standing grants.
 *   2. Any person whose main Bot it was gets that preference cleared.
 *   3. If no live conversation still has the Bot in it — the usual case, since a conversation shared
 *      with somebody else is the only kind the reset keeps — the Bot is removed for good: its panels,
 *      local threads, group/learning bindings and approval rules, then the `agents` row itself, whose
 *      foreign keys cascade the rest (profile, preferences, lifecycle, grants, delivery, team-bot rows).
 *      Otherwise it stays a tombstone so the shared conversation remains readable, and is finished
 *      off by a later purge once that conversation is gone.
 *   4. Its browser profile directory, best effort.
 *   Background tasks (chisabot_workers, DESIGN.md §38) are stopped first and their rows, hidden
 *   worker-* threads and thread inbox rows go with the local threads in step 3.
 *
 * The audit trail (`audit_events`, `action_records`, `model_usage`) is deliberately kept: it is a
 * record of what happened, not data belonging to the Bot.
 */
import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  agentProfiles,
  agents,
  approvalRules,
  botPanelInstances,
  botPanelInstanceVersions,
  channelAgents,
  channels,
  groupBotThreads,
  learningThreadBindings,
  panelAuthoringSessions,
  panelCapabilityGrants,
  panelDrafts,
  panelOperations,
  panelStates,
  panelTaskRequests,
  users,
} from "../db/schema";
import type { BotReset, ResetPlan } from "./lifecycle-reset";
import type { AgentActor } from "./profile-types";

export type PurgeReport = {
  agentId: string;
  /** What the per-person reset removed. */
  reset: ResetPlan | null;
  /** Whether the Bot's row is gone for good (false: kept as a tombstone for a shared conversation). */
  removed: boolean;
  /** Live conversations shared with others that keep the Bot as a tombstone. */
  sharedConversationsKept: number;
  panelsRemoved: number;
  mainBotCleared: number;
};

export type AgentPurge = {
  /** Run after the profile is soft-deleted. Never throws for a missing Bot. */
  purge(actor: AgentActor, agentId: string): Promise<PurgeReport>;
  /** Finish off Bots already soft-deleted that this person may manage (admins: all). */
  purgeDeleted(actor: AgentActor): Promise<PurgeReport[]>;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,200}$/;

export function createAgentPurge(options: {
  database: Database;
  reset: BotReset;
  /** Where the computer keeps one browser profile per Bot. */
  profilesDir?: string;
  /** 停掉这个机器人还在跑 / 排队的后台任务（DESIGN.md §38），在删它的数据之前。 */
  stopWorkers?: (agentId: string) => Promise<unknown>;
}): AgentPurge {
  const { database, reset } = options;
  const profilesDir = options.profilesDir ?? process.env.PROFILES_DIR ?? "/profiles";

  async function liveConversations(agentId: string): Promise<number> {
    const [row] = await database
      .select({ total: sql<number>`count(*)::int` })
      .from(channelAgents)
      .innerJoin(
        channels,
        and(eq(channels.id, channelAgents.channelId), isNull(channels.deletedAt)),
      )
      .where(eq(channelAgents.agentId, agentId));
    return row?.total ?? 0;
  }

  async function clearMainBot(agentId: string): Promise<number> {
    const cleared = await database
      .update(users)
      .set({
        preferences: sql`${users.preferences} || '{"mainBotId": null}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(sql`${users.preferences}->>'mainBotId' = ${agentId}`)
      .returning({ id: users.id });
    return cleared.length;
  }

  async function removeForGood(agentId: string): Promise<number> {
    return database.transaction(async (tx) => {
      const instances = await tx
        .select({ id: botPanelInstances.id })
        .from(botPanelInstances)
        .where(eq(botPanelInstances.botId, agentId));
      const instanceIds = instances.map((row) => row.id);
      const sessions = await tx
        .select({ id: panelAuthoringSessions.id })
        .from(panelAuthoringSessions)
        .where(
          instanceIds.length
            ? or(
                eq(panelAuthoringSessions.botId, agentId),
                inArray(panelAuthoringSessions.targetInstanceId, instanceIds),
              )
            : eq(panelAuthoringSessions.botId, agentId),
        );
      const sessionIds = sessions.map((row) => row.id);

      // Children before parents: none of the panel tables cascade.
      await tx
        .delete(panelDrafts)
        .where(
          or(
            eq(panelDrafts.botId, agentId),
            sessionIds.length ? inArray(panelDrafts.sessionId, sessionIds) : undefined,
            instanceIds.length
              ? inArray(panelDrafts.targetInstanceId, instanceIds)
              : undefined,
          ),
        );
      if (sessionIds.length)
        await tx
          .delete(panelAuthoringSessions)
          .where(inArray(panelAuthoringSessions.id, sessionIds));
      await tx
        .delete(panelTaskRequests)
        .where(
          or(
            eq(panelTaskRequests.botId, agentId),
            instanceIds.length
              ? inArray(panelTaskRequests.instanceId, instanceIds)
              : undefined,
          ),
        );
      if (instanceIds.length) {
        await tx
          .delete(panelCapabilityGrants)
          .where(inArray(panelCapabilityGrants.instanceId, instanceIds));
        await tx.delete(panelStates).where(inArray(panelStates.instanceId, instanceIds));
        await tx
          .delete(botPanelInstanceVersions)
          .where(inArray(botPanelInstanceVersions.instanceId, instanceIds));
        await tx.delete(botPanelInstances).where(inArray(botPanelInstances.id, instanceIds));
      }
      await tx.delete(panelOperations).where(eq(panelOperations.botId, agentId));

      await tx.delete(groupBotThreads).where(eq(groupBotThreads.agentId, agentId));
      await tx
        .delete(learningThreadBindings)
        .where(eq(learningThreadBindings.agentId, agentId));
      // Rules for a Bot that no longer exists protect nothing.
      await tx.delete(approvalRules).where(eq(approvalRules.botId, agentId));

      // The local conversation store is created at boot outside the migrations; skip it if absent.
      const [local] = await tx.execute<{ present: boolean }>(
        sql`select to_regclass('public.openbot_local_threads') is not null as present`,
      );
      if ((local as { present?: boolean } | undefined)?.present) {
        // 对话的收件箱（排队消息 / 后台结果）跟着对话走；后台任务的记录和它们隐藏的 worker-* 对话也是
        // 这个机器人的（以前删机器人会留下 chisabot_workers 行和收件箱行，2026-10-13 实测）。
        const [inbox] = await tx.execute<{ present: boolean }>(
          sql`select to_regclass('public.chisabot_thread_inbox') is not null as present`,
        );
        if ((inbox as { present?: boolean } | undefined)?.present)
          await tx.execute(
            sql`delete from chisabot_thread_inbox where thread_id in (select id from openbot_local_threads where agent_id = ${agentId})`,
          );
        await tx.execute(
          sql`delete from openbot_local_threads where agent_id = ${agentId}`,
        );
      }
      const [workers] = await tx.execute<{ present: boolean }>(
        sql`select to_regclass('public.chisabot_workers') is not null as present`,
      );
      if ((workers as { present?: boolean } | undefined)?.present)
        await tx.execute(sql`delete from chisabot_workers where agent_id = ${agentId}`);
      // 全端同步的「当前对话」指针（bot-threads.ts，DESIGN.md §42）。
      const [pointers] = await tx.execute<{ present: boolean }>(
        sql`select to_regclass('public.chisabot_bot_threads') is not null as present`,
      );
      if ((pointers as { present?: boolean } | undefined)?.present)
        await tx.execute(sql`delete from chisabot_bot_threads where agent_id = ${agentId}`);

      // Everything else hangs off `agents` with ON DELETE CASCADE.
      // 部署包机器人的 agents 行要留着：它带着「已被删除」的标记（override.removedAt），删掉它的话
      // 下次同步部署包会把机器人原样建回来。
      await tx
        .delete(agents)
        .where(and(eq(agents.id, agentId), isNull(agents.packageId)));
      return instanceIds.length;
    });
  }

  async function removeProfileDir(agentId: string) {
    if (!SAFE_ID.test(agentId)) return;
    const root = path.resolve(profilesDir);
    const target = path.resolve(root, agentId);
    if (path.dirname(target) !== root) return;
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[agents] could not remove browser profile for ${agentId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async function purge(actor: AgentActor, agentId: string): Promise<PurgeReport> {
    const report: PurgeReport = {
      agentId,
      reset: null,
      removed: false,
      sharedConversationsKept: 0,
      panelsRemoved: 0,
      mainBotCleared: 0,
    };
    // Only a Bot that has actually been soft-deleted is purged, whatever the caller passed.
    const [profile] = await database
      .select({ deletedAt: agentProfiles.deletedAt })
      .from(agentProfiles)
      .where(eq(agentProfiles.agentId, agentId))
      .limit(1);
    if (!profile?.deletedAt) return report;

    report.reset = await reset.execute(actor, agentId);
    report.mainBotCleared = await clearMainBot(agentId);
    report.sharedConversationsKept = await liveConversations(agentId);
    if (report.sharedConversationsKept === 0) {
      await options.stopWorkers?.(agentId).catch((error: unknown) =>
        console.warn(`[agents] stopping background tasks of ${agentId} failed:`, error instanceof Error ? error.message : error),
      );
      report.panelsRemoved = await removeForGood(agentId);
      report.removed = true;
      await removeProfileDir(agentId);
    }
    return report;
  }

  return {
    purge,
    async purgeDeleted(actor) {
      const rows = await database
        .select({ id: agentProfiles.agentId })
        .from(agentProfiles)
        .where(
          and(
            isNotNull(agentProfiles.deletedAt),
            actor.role === "admin"
              ? undefined
              : eq(agentProfiles.ownerUserId, actor.id),
          ),
        );
      const reports: PurgeReport[] = [];
      for (const row of rows) reports.push(await purge(actor, row.id));
      return reports;
    },
  };
}
