/**
 * Every routine change on the audit trail (moved out of the removed upstream enterprise controls in
 * slimming P6-1; behaviour unchanged).
 */
import { type AuditStore, recordAuditEvent } from "../audit";

type RoutineLike = {
  create(input: {
    ownerUserId: string;
    agentId?: string;
    channelId?: string;
    cron?: string;
    timezone?: string;
  }): Promise<{ id: string }>;
  update(ownerUserId: string, id: string, patch: object): Promise<unknown>;
  remove(ownerUserId: string, id: string): Promise<void>;
  setEnabled(ownerUserId: string, id: string, enabled: boolean): Promise<void>;
};

/**
 * Put every routine change on the trail, whoever made it: the screen, or a Bot through its tools.
 * In place, so the tool registry that already holds this store is covered too.
 */
export function auditRoutineStore<T extends RoutineLike>(
  store: T,
  auditStore: AuditStore,
): T {
  const create = store.create.bind(store);
  const update = store.update.bind(store) as (
    ...args: unknown[]
  ) => Promise<unknown>;
  const remove = store.remove.bind(store);
  const setEnabled = store.setEnabled.bind(store);
  const write = (input: Parameters<typeof recordAuditEvent>[1]) =>
    recordAuditEvent(auditStore, input).catch(() => undefined);

  store.create = (async (input: Parameters<T["create"]>[0]) => {
    const routine = await create(input);
    await write({
      eventType: "routine.created",
      targetType: "routine",
      targetId: routine.id,
      actorUserId: input.ownerUserId,
      payload: {
        agentId: input.agentId ?? null,
        channelId: input.channelId ?? null,
        cron: input.cron ?? null,
        timezone: input.timezone ?? null,
      },
    });
    return routine;
  }) as T["create"];
  store.update = (async (...args: unknown[]) => {
    const result = await update(...args);
    const [ownerUserId, id, changes] = args as [unknown, unknown, unknown];
    await write({
      eventType: "routine.updated",
      targetType: "routine",
      ...(typeof id === "string" ? { targetId: id } : {}),
      ...(typeof ownerUserId === "string" ? { actorUserId: ownerUserId } : {}),
      payload: {
        changed:
          changes && typeof changes === "object"
            ? Object.keys(changes as object)
            : [],
      },
    });
    return result;
  }) as T["update"];
  store.remove = (async (ownerUserId: string, id: string) => {
    await remove(ownerUserId, id);
    await write({
      eventType: "routine.deleted",
      targetType: "routine",
      targetId: id,
      actorUserId: ownerUserId,
      payload: {},
    });
  }) as T["remove"];
  store.setEnabled = (async (
    ownerUserId: string,
    id: string,
    enabled: boolean,
  ) => {
    await setEnabled(ownerUserId, id, enabled);
    await write({
      eventType: "routine.enabled_changed",
      targetType: "routine",
      targetId: id,
      actorUserId: ownerUserId,
      payload: { enabled },
    });
  }) as T["setEnabled"];
  return store;
}
