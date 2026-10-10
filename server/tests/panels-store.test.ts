import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/db/client";
import { createPanelStore } from "../src/panels/store";
import { testDatabaseUrl } from "./support/database";

// Deliberately refuse to run against an implicit application database.
const database = createDatabase(testDatabaseUrl(), { max: 2 });
const store = createPanelStore(database);
const testRun = crypto.randomUUID();
const a = {
  actorId: `panels-test-alice-${testRun}`,
  botId: `panels-test-bot-a-${testRun}`,
};
const b = { actorId: a.actorId, botId: `panels-test-bot-b-${testRun}` };
const other = { ...a, actorId: `panels-test-bob-${testRun}` };
const definition = {
  name: "计数器",
  html: "<main><h2>计数器</h2></main>",
  css: "",
  script: "",
  manifest: { data: [], tasks: [] },
  schemaVersion: 1,
  stateSchema: {
    type: "object",
    properties: { count: { type: "number" } },
    required: ["count"],
    additionalProperties: false,
  },
  initialState: { count: 0 },
  size: { height: "auto", width: 340 },
} as const;

async function draft(ctx = a, targetInstanceId?: string, next = definition) {
  const session = await store.beginSession(ctx, targetInstanceId);
  return store.saveDraft(ctx, {
    sessionId: session.sessionId,
    expectedDraftRevision: 0,
    definition: structuredClone(next),
  });
}
const saveInput = (d: Awaited<ReturnType<typeof draft>>, key: string) => ({
  draftId: d.id,
  expectedDraftRevision: d.draftRevision,
  mode: "first" as const,
  idempotencyKey: key,
  resetState: false,
});

beforeAll(async () => {
  await database.execute(sql`select 1`);
});
afterAll(async () => {
  await database.$client.close();
});

describe("persistent independent panels", () => {
  test("archived_library_preserves_installed_copy", async () => {
    const first = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    const installed = await store.install(b, {
      libraryId: first.libraryId!,
      libraryVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    await store.archiveLibrary(a, first.libraryId!, 1);
    await expect(
      store.install(b, {
        libraryId: first.libraryId!,
        libraryVersion: 1,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow("library_missing");
    expect((await store.getInstance(b, installed.id)).definition).toEqual(
      definition,
    );
  });
  test("layout_and_reorder_use_object_versions", async () => {
    const one = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    const two = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    const changed = await store.updateLayout(a, {
      instanceId: one.instanceId!,
      expectedVersion: 1,
      title: "我的统计",
      collapsed: true,
      size: { width: 280, height: 200 },
    });
    expect(changed.instanceVersion).toBe(2);
    expect(changed.title).toBe("我的统计");
    await expect(
      store.updateLayout(a, {
        instanceId: one.instanceId!,
        expectedVersion: 1,
        title: "覆盖",
      }),
    ).rejects.toThrow("version_conflict");
    await expect(
      store.reorder(a, [
        { id: two.instanceId!, expectedVersion: 9 },
        { id: one.instanceId!, expectedVersion: 2 },
      ]),
    ).rejects.toThrow("version_conflict");
    await store.reorder(a, [
      { id: two.instanceId!, expectedVersion: 1 },
      { id: one.instanceId!, expectedVersion: 2 },
    ]);
    const list = (await store.list(a)).filter(
      (p) => p.id === one.instanceId || p.id === two.instanceId,
    );
    expect(list.map((p) => p.id)).toEqual([two.instanceId!, one.instanceId!]);
  });
  test("rollback_creates_new_revision_and_keeps_other_actor_state", async () => {
    const first = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    await store.writeState(other, {
      instanceId: first.instanceId!,
      instanceVersion: 1,
      stateRevision: 0,
      value: { count: 42 },
    });
    const edit = await draft(a, first.instanceId, {
      ...definition,
      name: "修订",
      html: "<main>修订</main>",
    });
    await store.commit(a, {
      ...saveInput(edit, crypto.randomUUID()),
      mode: "instance",
      baseInstanceVersion: 1,
    });
    const rolled = await store.rollback(a, {
      instanceId: first.instanceId!,
      expectedVersion: 2,
      version: 1,
      idempotencyKey: crypto.randomUUID(),
      resetState: false,
    });
    expect(rolled.instanceVersion).toBe(3);
    expect((await store.getInstance(a, first.instanceId!)).definition).toEqual(
      definition,
    );
    expect((await store.readState(other, first.instanceId!)).value).toEqual({
      count: 42,
    });
    expect(
      (await store.history(a, first.instanceId!)).map((v) => v.version),
    ).toEqual([3, 2, 1]);
    await store.remove(a, first.instanceId!, 3);
    await expect(store.readState(a, first.instanceId!)).rejects.toThrow(
      "binding",
    );
  });
  test("first_save_atomic_and_idempotent", async () => {
    const d = await draft();
    const input = saveInput(d, crypto.randomUUID());
    const [first, simultaneous] = await Promise.all([
      store.commit(a, input),
      store.commit(a, input),
    ]);
    expect(simultaneous).toEqual(first);
    expect(first.libraryVersion).toBe(1);
    expect(first.instanceVersion).toBe(1);
    expect(first.libraryId).toBeString();
    expect(first.instanceId).toBeString();
    const second = await store.commit(a, input);
    expect(second).toEqual(first);
    expect(await store.operationResult(a, input.idempotencyKey)).toEqual(first);
    expect(
      (await store.list(a)).filter((p) => p.id === first.instanceId),
    ).toHaveLength(1);
    await expect(
      store.commit(a, { ...input, resetState: true }),
    ).rejects.toThrow("idempotency");
  });

  test("copies_and_actor_state_independent", async () => {
    const originalDraft = await draft();
    const first = await store.commit(
      a,
      saveInput(originalDraft, crypto.randomUUID()),
    );
    const copy = await store.install(b, {
      libraryId: first.libraryId!,
      libraryVersion: 1,
      idempotencyKey: crypto.randomUUID(),
    });
    await store.writeState(a, {
      instanceId: first.instanceId!,
      instanceVersion: 1,
      stateRevision: 0,
      value: { count: 7 },
    });
    expect((await store.readState(other, first.instanceId!)).value).toEqual({
      count: 0,
    });
    expect((await store.readState(b, copy.id)).value).toEqual({ count: 0 });
    const changed = { ...definition, name: "新版", html: "<main>新版</main>" };
    const edit = await draft(a, first.instanceId, changed);
    await store.commit(a, {
      ...saveInput(edit, crypto.randomUUID()),
      mode: "instance",
      baseInstanceVersion: 1,
    });
    expect(
      (await store.list(b)).find((p) => p.id === copy.id)!.definition,
    ).toEqual(definition);
    expect((await store.readState(a, first.instanceId!)).value).toEqual({
      count: 7,
    });
    await expect(store.readState(b, first.instanceId!)).rejects.toThrow(
      "binding",
    );
  });

  test("schema_conflict_preserves_input", async () => {
    const first = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    await store.writeState(a, {
      instanceId: first.instanceId!,
      instanceVersion: 1,
      stateRevision: 0,
      value: { count: 11 },
    });
    const changed = {
      ...definition,
      stateSchema: {
        type: "object",
        properties: { count: { type: "string" } },
        required: ["count"],
        additionalProperties: false,
      },
      initialState: { count: "zero" },
    };
    const edit = await draft(a, first.instanceId, changed as never);
    const input = {
      ...saveInput(edit, crypto.randomUUID()),
      mode: "instance" as const,
      baseInstanceVersion: 1,
    };
    await expect(store.commit(a, input)).rejects.toThrow(
      "state_reset_required",
    );
    expect((await store.readState(a, first.instanceId!)).value).toEqual({
      count: 11,
    });
    expect(
      (await store.list(a)).find((p) => p.id === first.instanceId)!
        .instanceVersion,
    ).toBe(1);
    const saved = await store.commit(a, {
      ...input,
      idempotencyKey: crypto.randomUUID(),
      resetState: true,
    });
    expect(saved.instanceVersion).toBe(2);
    expect((await store.readState(a, first.instanceId!)).value).toEqual({
      count: "zero",
    });
    await expect(
      store.writeState(a, {
        instanceId: first.instanceId!,
        instanceVersion: 1,
        stateRevision: 1,
        value: { count: 99 },
      }),
    ).rejects.toThrow("version_conflict");
  });

  test("stale_edit_keeps_draft_and_persisted_state", async () => {
    const first = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    await store.writeState(a, {
      instanceId: first.instanceId!,
      instanceVersion: 1,
      stateRevision: 0,
      value: { count: 13 },
    });
    const d1 = await draft(a, first.instanceId);
    const d2 = await draft(a, first.instanceId);
    await store.commit(a, {
      ...saveInput(d1, crypto.randomUUID()),
      mode: "instance",
      baseInstanceVersion: 1,
    });
    await expect(
      store.commit(a, {
        ...saveInput(d2, crypto.randomUUID()),
        mode: "instance",
        baseInstanceVersion: 1,
      }),
    ).rejects.toThrow("version_conflict");
    expect((await store.getDraft(a, d2.id)).definition).toEqual(definition);
    const reopenedDb = createDatabase(testDatabaseUrl(), { max: 1 });
    try {
      const reopened = createPanelStore(reopenedDb);
      expect(
        (await reopened.list(a)).find((p) => p.id === first.instanceId)!
          .instanceVersion,
      ).toBe(2);
      expect((await reopened.readState(a, first.instanceId!)).value).toEqual({
        count: 13,
      });
    } finally {
      await reopenedDb.$client.close();
    }
  });

  test("library_update_requires_bound_revision", async () => {
    const first = await store.commit(
      a,
      saveInput(await draft(), crypto.randomUUID()),
    );
    const edit1 = await draft(a, first.instanceId, {
      ...definition,
      name: "库修订一",
    });
    const edit2 = await draft(a, first.instanceId, {
      ...definition,
      name: "过期库修订",
    });
    await store.commit(a, {
      ...saveInput(edit1, crypto.randomUUID()),
      mode: "update-library",
      libraryId: first.libraryId!,
      baseInstanceVersion: 1,
      baseLibraryVersion: 1,
    });
    await expect(
      store.commit(a, {
        ...saveInput(edit2, crypto.randomUUID()),
        mode: "update-library",
        libraryId: first.libraryId!,
        baseInstanceVersion: 1,
        baseLibraryVersion: 2,
      }),
    ).rejects.toThrow("library_version_conflict");
    const next = await draft(a, first.instanceId);
    expect(next.baseLibraryVersion).toBe(2);
  });

  test("storage_fault_leaves_no_partial_first_save", async () => {
    const failingDraft = await draft(a, undefined, {
      ...definition,
      name: "transaction-fault",
    });
    const count = async () =>
      (
        await database.execute(
          sql`select count(*)::int as n from panel_library_entries`,
        )
      )[0]!.n;
    const before = await count();
    await database.execute(
      sql.raw(
        `CREATE OR REPLACE FUNCTION panel_test_fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.definition->>'name' = 'transaction-fault' THEN RAISE EXCEPTION 'injected test storage fault'; END IF; RETURN NEW; END $$`,
      ),
    );
    await database.execute(
      sql.raw(
        `CREATE TRIGGER panel_test_fail BEFORE INSERT ON bot_panel_instance_versions FOR EACH ROW EXECUTE FUNCTION panel_test_fail_insert()`,
      ),
    );
    try {
      await expect(
        store.commit(a, saveInput(failingDraft, crypto.randomUUID())),
      ).rejects.toThrow();
      expect(await count()).toBe(before);
      expect((await store.getDraft(a, failingDraft.id)).status).toBe("ready");
      expect(
        (await store.list(a)).some(
          (p) => p.definition.name === "transaction-fault",
        ),
      ).toBe(false);
    } finally {
      await database.execute(
        sql.raw(`DROP TRIGGER panel_test_fail ON bot_panel_instance_versions`),
      );
      await database.execute(sql.raw(`DROP FUNCTION panel_test_fail_insert()`));
    }
  });
});
