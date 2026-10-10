import { eq, sql } from "drizzle-orm";
import { normalizeModelBaseUrl } from "../../shared/model-base-url";
import {
  createCredentialStore,
  decryptSecret,
  encryptSecret,
  type CredentialExecutor,
} from "./credentials";
import type { Database } from "./db/client";
import { credentials, enterpriseSettings } from "./db/schema";

export type ModelConnectionConfig = {
  provider: "openai" | "anthropic";
  model: string;
  baseUrl: string;
  useApiKey: boolean;
};
export type ModelConnectionInput = ModelConnectionConfig & { apiKey?: string };
export type ModelConnectionRuntime = ModelConnectionConfig & {
  apiKey: string | null;
  source?: "environment" | "saved";
};
export type ModelConnectionProjection = ModelConnectionConfig & {
  hasApiKey: boolean;
  source: "environment" | "saved";
};
export type ModelConnectionTestResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
};
export type ModelSettingsSnapshot = {
  connection: ModelConnectionConfig;
  encryptedApiKey: string | null;
};
export type ModelSettingsStore = {
  read: () => Promise<ModelSettingsSnapshot | null>;
  update: (
    change: (
      current: ModelSettingsSnapshot | null,
    ) => Promise<ModelSettingsSnapshot>,
    actorUserId?: string,
  ) => Promise<ModelSettingsSnapshot>;
};
export type ModelSettingsService = {
  get: () => Promise<ModelConnectionProjection>;
  save: (
    input: unknown,
    actorUserId?: string,
  ) => Promise<ModelConnectionProjection>;
  test: (input: unknown) => Promise<ModelConnectionTestResult>;
  resolve: () => Promise<ModelConnectionRuntime>;
};
export class ModelSettingsValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "ModelSettingsValidationError";
  }
}
export class ModelSettingsStorageError extends Error {
  constructor() {
    super("模型配置暂时无法读取或保存，请稍后重试。");
    this.name = "ModelSettingsStorageError";
  }
}

const SETTINGS_KEY = "model_connection";
const CREDENTIAL_KEY_ID = "model-connection-api-key";
const PROBE_TIMEOUT_MS = 20_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Base URLs deliberately permit private hosts for self-hosted Ollama and compatible gateways. */
export function parseModelConnectionInput(
  input: unknown,
): ModelConnectionInput {
  if (!isObject(input))
    throw new ModelSettingsValidationError("请填写模型连接配置。");
  if (input.provider !== "openai" && input.provider !== "anthropic") {
    throw new ModelSettingsValidationError(
      "请选择 OpenAI 兼容或 Anthropic 接口协议。",
    );
  }
  if (
    typeof input.model !== "string" ||
    !input.model.trim() ||
    input.model.length > 200 ||
    /\s/u.test(input.model.trim()) ||
    hasControlCharacters(input.model.trim())
  ) {
    throw new ModelSettingsValidationError(
      "请填写有效的模型名称，长度不超过 200 个字符且不能包含空白。",
    );
  }
  if (typeof input.baseUrl !== "string" || input.baseUrl.length > 2048) {
    throw new ModelSettingsValidationError(
      "请填写有效的 HTTP 或 HTTPS 接口地址。",
    );
  }
  let address: URL;
  try {
    address = new URL(input.baseUrl.trim());
  } catch {
    throw new ModelSettingsValidationError(
      "请填写有效的 HTTP 或 HTTPS 接口地址。",
    );
  }
  if (
    !/^https?:$/u.test(address.protocol) ||
    !address.hostname ||
    address.username ||
    address.password ||
    address.search ||
    address.hash
  ) {
    throw new ModelSettingsValidationError(
      "接口地址必须使用 HTTP 或 HTTPS，且不能包含登录信息、查询参数或锚点。",
    );
  }
  if (input.useApiKey !== undefined && typeof input.useApiKey !== "boolean") {
    throw new ModelSettingsValidationError("请选择是否使用 API Key。");
  }
  if (
    input.apiKey !== undefined &&
    (typeof input.apiKey !== "string" ||
      input.apiKey.length > 16_384 ||
      hasControlCharacters(input.apiKey))
  ) {
    throw new ModelSettingsValidationError("API Key 格式无效，请重新填写。");
  }
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  const useApiKey = input.useApiKey !== false;
  if (!useApiKey && apiKey)
    throw new ModelSettingsValidationError(
      "已选择不使用 API Key，请清空密钥输入框。",
    );
  const baseUrl = normalizeModelBaseUrl(input.provider, address.toString());
  return {
    provider: input.provider,
    model: input.model.trim(),
    baseUrl,
    useApiKey,
    ...(apiKey ? { apiKey } : {}),
  };
}

type SettingsTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
type StoredConnection = ModelConnectionConfig & {
  version: 1;
  credentialId: string | null;
};

async function readSnapshot(
  transaction: SettingsTransaction,
  lock: "share" | "update",
) {
  const [row] = await transaction
    .select({ value: enterpriseSettings.value })
    .from(enterpriseSettings)
    .where(eq(enterpriseSettings.key, SETTINGS_KEY))
    .for(lock);
  if (!row) return null;
  if (
    !isObject(row.value) ||
    row.value.version !== 1 ||
    (row.value.credentialId !== null &&
      typeof row.value.credentialId !== "string")
  ) {
    throw new ModelSettingsStorageError();
  }
  const parsed = parseModelConnectionInput(row.value);
  const connection: ModelConnectionConfig = {
    provider: parsed.provider,
    model: parsed.model,
    baseUrl: parsed.baseUrl,
    useApiKey: parsed.useApiKey,
  };
  const credentialId = row.value.credentialId as string | null;
  let encryptedApiKey: string | null = null;
  if (connection.useApiKey && credentialId) {
    const [credential] = await transaction
      .select({
        kind: credentials.kind,
        provider: credentials.provider,
        encryptedValue: credentials.encryptedValue,
        revokedAt: credentials.revokedAt,
      })
      .from(credentials)
      .where(eq(credentials.id, credentialId));
    if (
      credential &&
      !credential.revokedAt &&
      credential.kind === "model" &&
      credential.provider === connection.provider
    ) {
      encryptedApiKey = credential.encryptedValue;
    }
  }
  return {
    credentialId,
    snapshot: { connection, encryptedApiKey } satisfies ModelSettingsSnapshot,
  };
}

/**
 * The settings row and the referenced encrypted credential commit together. A transaction lock
 * serializes first saves too, when no row exists yet. Readers hold a shared row lock until they have
 * read its credential, so they cannot combine a previous model with a newly rotated key.
 */
export function createModelSettingsStore(
  database: Database,
): ModelSettingsStore {
  const vault = createCredentialStore(database);
  return {
    async read() {
      try {
        return await database.transaction(
          async (transaction) =>
            (await readSnapshot(transaction, "share"))?.snapshot ?? null,
        );
      } catch {
        throw new ModelSettingsStorageError();
      }
    },
    async update(change, actorUserId) {
      try {
        return await database.transaction(async (transaction) => {
          await transaction.execute(
            sql`select pg_advisory_xact_lock(hashtext(${SETTINGS_KEY}))`,
          );
          const current = await readSnapshot(transaction, "update");
          const next = await change(current?.snapshot ?? null);
          let credentialId: string | null = null;
          if (next.connection.useApiKey && next.encryptedApiKey) {
            if (
              current?.credentialId &&
              current.snapshot.connection.provider ===
                next.connection.provider &&
              current.snapshot.encryptedApiKey === next.encryptedApiKey
            ) {
              credentialId = current.credentialId;
            } else {
              const credential = {
                kind: "model" as const,
                provider: next.connection.provider,
                keyId: CREDENTIAL_KEY_ID,
                metadata: {},
                encryptedValue: next.encryptedApiKey,
              };
              const previous = await vault.findLiveByKey(
                credential,
                transaction as CredentialExecutor,
              );
              const stored = previous
                ? await vault.rotate(
                    { ...credential, previousCredentialId: previous.id },
                    transaction as CredentialExecutor,
                  )
                : await vault.create(
                    credential,
                    transaction as CredentialExecutor,
                  );
              credentialId = stored.id;
            }
          }
          if (
            current?.credentialId &&
            current.credentialId !== credentialId &&
            current.snapshot.encryptedApiKey &&
            current.snapshot.connection.provider !== next.connection.provider
          ) {
            await vault.revoke(
              current.credentialId,
              transaction as CredentialExecutor,
            );
          } else if (
            !next.connection.useApiKey &&
            current?.credentialId &&
            current.snapshot.encryptedApiKey
          ) {
            await vault.revoke(
              current.credentialId,
              transaction as CredentialExecutor,
            );
          }
          const value: StoredConnection = {
            version: 1,
            ...next.connection,
            credentialId,
          };
          const updatedAt = new Date();
          await transaction
            .insert(enterpriseSettings)
            .values({
              key: SETTINGS_KEY,
              value,
              updatedBy: actorUserId ?? null,
              updatedAt,
            })
            .onConflictDoUpdate({
              target: enterpriseSettings.key,
              set: {
                value,
                updatedBy: actorUserId ?? null,
                updatedAt,
              },
            });
          return next;
        });
      } catch (error) {
        if (error instanceof ModelSettingsValidationError) throw error;
        // Drizzle errors can contain bound credential envelopes. Never expose their messages.
        throw new ModelSettingsStorageError();
      }
    },
  };
}

function configuration(input: ModelConnectionConfig): ModelConnectionConfig {
  return {
    provider: input.provider,
    model: input.model,
    baseUrl: normalizeModelBaseUrl(input.provider, input.baseUrl),
    useApiKey: input.useApiKey,
  };
}

function checkKeyReuse(
  input: ModelConnectionConfig,
  active: ModelConnectionConfig,
) {
  if (
    input.provider !== active.provider ||
    normalizeModelBaseUrl(input.provider, input.baseUrl) !==
      normalizeModelBaseUrl(active.provider, active.baseUrl)
  ) {
    throw new ModelSettingsValidationError(
      "更换接口协议或地址时，请填写对应的新 API Key，或选择不使用 API Key。",
    );
  }
}

function projection(
  runtime: ModelConnectionConfig,
  hasApiKey: boolean,
  source: "saved" | "environment",
): ModelConnectionProjection {
  return {
    ...configuration(runtime),
    hasApiKey: runtime.useApiKey && hasApiKey,
    source,
  };
}

function probeFailure(status: number, body?: unknown) {
  // Classify only documented error codes; upstream prose may contain request secrets.
  if (
    isObject(body) &&
    (body.code === "real_name_required" ||
      body.type === "real_name_required" ||
      (isObject(body.error) &&
        (body.error.code === "real_name_required" ||
          body.error.type === "real_name_required")))
  ) {
    return "模型服务要求账号完成实名认证，请在服务商平台完成认证后重试。（real_name_required）";
  }
  if (status === 401 || status === 403)
    return "认证失败，请检查 API Key 及接口访问权限。";
  if (status === 404) return "找不到模型接口或模型，请检查接口地址和模型名称。";
  if (status === 429)
    return "接口请求受限或额度不足，请检查账户额度并稍后重试。";
  if (status >= 500) return "模型服务暂时不可用，请稍后重试。";
  return "模型服务拒绝了请求，请检查协议、模型名称和接口地址。";
}

async function readProbeJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new Error("response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createModelSettingsService(options: {
  store: ModelSettingsStore;
  encryptionKey: string;
  fallback: Omit<ModelConnectionConfig, "useApiKey"> & { useApiKey?: boolean };
  fallbackApiKey: () => Promise<string | null>;
  fetch?: typeof fetch;
}): ModelSettingsService {
  const fallback = configuration(parseModelConnectionInput(options.fallback));
  const request = options.fetch ?? fetch;
  async function fallbackRuntime(): Promise<ModelConnectionRuntime> {
    return {
      ...fallback,
      apiKey: fallback.useApiKey ? await options.fallbackApiKey() : null,
      source: "environment",
    };
  }
  async function runtimeFrom(
    snapshot: ModelSettingsSnapshot,
  ): Promise<ModelConnectionRuntime> {
    try {
      return {
        ...configuration(snapshot.connection),
        source: "saved",
        apiKey:
          snapshot.connection.useApiKey && snapshot.encryptedApiKey
            ? await decryptSecret(
                options.encryptionKey,
                snapshot.encryptedApiKey,
              )
            : null,
      };
    } catch {
      throw new ModelSettingsStorageError();
    }
  }
  async function resolve(): Promise<ModelConnectionRuntime> {
    const saved = await options.store.read();
    return saved ? runtimeFrom(saved) : fallbackRuntime();
  }
  return {
    resolve,
    async get() {
      const saved = await options.store.read();
      if (saved)
        return projection(
          saved.connection,
          Boolean(saved.encryptedApiKey),
          "saved",
        );
      const current = await fallbackRuntime();
      return projection(current, Boolean(current.apiKey), "environment");
    },
    async save(value, actorUserId) {
      const input = parseModelConnectionInput(value);
      // A fallback credential is read before the write opens a transaction. This remains safe with
      // a one-connection pool, unlike reading the vault on another connection while holding a lock.
      const previouslySaved =
        input.useApiKey && !input.apiKey ? await options.store.read() : null;
      const previousFallback =
        input.useApiKey && !input.apiKey && !previouslySaved
          ? await fallbackRuntime()
          : { ...fallback, apiKey: null };
      const encryptedNewKey = input.apiKey
        ? await encryptSecret(options.encryptionKey, input.apiKey)
        : null;
      const encryptedFallbackKey = previousFallback.apiKey
        ? await encryptSecret(options.encryptionKey, previousFallback.apiKey)
        : null;
      const saved = await options.store.update(async (current) => {
        let encryptedApiKey = encryptedNewKey;
        if (input.useApiKey && !input.apiKey) {
          checkKeyReuse(input, current?.connection ?? previousFallback);
          encryptedApiKey = current
            ? current.encryptedApiKey
            : encryptedFallbackKey;
          if (!encryptedApiKey)
            throw new ModelSettingsValidationError(
              "请填写 API Key，或选择不使用 API Key。",
            );
        }
        return {
          connection: configuration(input),
          encryptedApiKey: input.useApiKey ? encryptedApiKey : null,
        };
      }, actorUserId);
      return projection(
        saved.connection,
        Boolean(saved.encryptedApiKey),
        "saved",
      );
    },
    async test(value) {
      const input = parseModelConnectionInput(value);
      let apiKey = input.apiKey ?? null;
      if (input.useApiKey && !apiKey) {
        const active = await resolve();
        checkKeyReuse(input, active);
        apiKey = active.apiKey;
        if (!apiKey)
          throw new ModelSettingsValidationError(
            "请填写 API Key，或选择不使用 API Key。",
          );
      }
      const start = performance.now();
      const finish = (
        ok: boolean,
        message: string,
      ): ModelConnectionTestResult => ({
        ok,
        message,
        latencyMs: Math.round(performance.now() - start),
      });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (input.provider === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
        if (apiKey) headers["x-api-key"] = apiKey;
      } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const payload = {
        model: input.model,
        messages: [{ role: "user", content: "Reply with OK." }],
        ...(input.provider === "openai" &&
        /^(?:gpt-5|o[134])(?:[-.]|$)/u.test(input.model)
          ? { max_completion_tokens: 128 }
          : { max_tokens: 32 }),
        stream: false,
      };
      try {
        const response = await request(
          `${input.baseUrl}/${input.provider === "anthropic" ? "messages" : "chat/completions"}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            redirect: "error",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          },
        );
        if (!response.ok) {
          let errorBody: unknown;
          try {
            errorBody = await readProbeJson(response);
          } catch {
            // Invalid, oversized or unreadable error bodies keep their safe HTTP classification.
          }
          return finish(false, probeFailure(response.status, errorBody));
        }
        let body: unknown;
        try {
          body = await readProbeJson(response);
        } catch {
          return finish(
            false,
            "接口返回格式不符合所选协议，请检查接口地址和协议。",
          );
        }
        const valid =
          isObject(body) &&
          (input.provider === "anthropic"
            ? body.type === "message" &&
              Array.isArray(body.content) &&
              body.content.length > 0 &&
              body.content.every(
                (block) =>
                  isObject(block) &&
                  ((block.type === "text" && typeof block.text === "string") ||
                    (block.type === "thinking" &&
                      typeof block.thinking === "string")),
              )
            : Array.isArray(body.choices) &&
              body.choices.length > 0 &&
              isObject(body.choices[0]) &&
              isObject(body.choices[0].message) &&
              (typeof body.choices[0].message.content === "string" ||
                typeof body.choices[0].message.reasoning_content === "string"));
        return valid
          ? finish(true, "连接成功，模型接口可以正常响应。")
          : finish(false, "接口返回格式不符合所选协议，请检查接口地址和协议。");
      } catch {
        return finish(
          false,
          "无法连接模型服务或请求超时，请检查地址、网络和服务状态。",
        );
      }
    },
  };
}
