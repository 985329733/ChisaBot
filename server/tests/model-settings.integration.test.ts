import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { createCredentialStore } from "../src/credentials";
import { createDatabase } from "../src/db/client";
import { credentials, enterpriseSettings } from "../src/db/schema";
import {
  createModelSettingsService,
  createModelSettingsStore,
  ModelSettingsStorageError,
} from "../src/model-settings";
import { testDatabaseUrl } from "./support/database";

// Run only against an explicit dedicated test database; never touch the deployed settings row.
const enabled = Boolean(process.env.TEST_DATABASE_URL);
const database = enabled ? createDatabase(testDatabaseUrl(), { max: 2 }) : null;
const encryptionKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const fallback = {
  provider: "openai" as const,
  model: "env-model",
  baseUrl: "https://env.test/v1",
};
let mayClean = false;

function service() {
  if (!database) throw new Error("explicit test database required");
  return createModelSettingsService({
    store: createModelSettingsStore(database),
    encryptionKey,
    fallback,
    fallbackApiKey: async () => "fallback-secret",
  });
}

beforeAll(async () => {
  if (!database) return;
  const existing = await database
    .select()
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.key, "model_connection"));
  const existingKeys = await database
    .select()
    .from(credentials)
    .where(eq(credentials.keyId, "model-connection-api-key"));
  if (existing.length || existingKeys.length)
    throw new Error(
      "Model settings integration test requires an unused dedicated test database.",
    );
  mayClean = true;
});

afterAll(async () => {
  if (!database || !mayClean) return;
  await database
    .delete(enterpriseSettings)
    .where(eq(enterpriseSettings.key, "model_connection"));
  await database
    .delete(credentials)
    .where(eq(credentials.keyId, "model-connection-api-key"));
});

describe.skipIf(!enabled)("model settings against PostgreSQL", () => {
  test("persists encrypted credentials and connection fields together across service recreation", async () => {
    const saved = await service().save(
      { ...fallback, model: "stored-model", apiKey: "stored-secret" },
      "test-admin",
    );
    expect(saved).toEqual({
      ...fallback,
      model: "stored-model",
      useApiKey: true,
      hasApiKey: true,
      source: "saved",
    });
    expect(await service().resolve()).toEqual({
      ...fallback,
      model: "stored-model",
      useApiKey: true,
      apiKey: "stored-secret",
      source: "saved",
    });
    const [row] = await database!
      .select()
      .from(enterpriseSettings)
      .where(eq(enterpriseSettings.key, "model_connection"));
    expect(typeof row!.value).toBe("object");
    expect(JSON.stringify(row)).not.toContain("stored-secret");
    const [credential] = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          isNull(credentials.revokedAt),
        ),
      );
    expect(credential!.encryptedValue).not.toContain("stored-secret");
    expect(row!.updatedBy).toBe("test-admin");
  });

  test("a settings insert failure rolls the key rotation back too", async () => {
    const before = await service().resolve();
    const [liveBefore] = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          isNull(credentials.revokedAt),
        ),
      );
    await expect(
      service().save(
        {
          ...fallback,
          model: "must-not-commit",
          apiKey: "must-not-commit-secret",
        },
        `invalid${String.fromCharCode(0)}actor`,
      ),
    ).rejects.toBeInstanceOf(ModelSettingsStorageError);
    expect(await service().resolve()).toEqual(before);
    const liveAfter = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          isNull(credentials.revokedAt),
        ),
      );
    expect(liveAfter).toHaveLength(1);
    expect(liveAfter[0]!.id).toBe(liveBefore!.id);
    expect(
      (await createCredentialStore(database!).readSecret(liveBefore!.id))!
        .revokedAt,
    ).toBeNull();
  });

  test("concurrent saves always resolve the model and key from one committed connection", async () => {
    await Promise.all([
      service().save({
        ...fallback,
        model: "connection-a",
        apiKey: "key-for-a",
      }),
      service().save({
        ...fallback,
        model: "connection-b",
        apiKey: "key-for-b",
      }),
    ]);
    const active = await service().resolve();
    expect(["connection-a", "connection-b"]).toContain(active.model);
    expect(active.apiKey).toBe(
      active.model === "connection-a" ? "key-for-a" : "key-for-b",
    );
    const live = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          isNull(credentials.revokedAt),
        ),
      );
    expect(live).toHaveLength(1);
  });

  test("switching protocol retires its old key and explicitly disabling authentication persists", async () => {
    await service().save({
      provider: "anthropic",
      model: "claude-test",
      baseUrl: "https://anthropic.test/v1",
      apiKey: "anthropic-only",
    });
    expect((await service().resolve()).apiKey).toBe("anthropic-only");
    const openaiKeys = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          eq(credentials.provider, "openai"),
          isNull(credentials.revokedAt),
        ),
      );
    expect(openaiKeys).toHaveLength(0);
    await service().save({
      provider: "openai",
      model: "local-test",
      baseUrl: "http://127.0.0.1:11434/v1",
      useApiKey: false,
    });
    expect(await service().resolve()).toEqual({
      provider: "openai",
      model: "local-test",
      baseUrl: "http://127.0.0.1:11434/v1",
      useApiKey: false,
      apiKey: null,
      source: "saved",
    });
    const remainingKeys = await database!
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.keyId, "model-connection-api-key"),
          isNull(credentials.revokedAt),
        ),
      );
    expect(remainingKeys).toHaveLength(0);
  });
});
