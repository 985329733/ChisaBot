import { createHash } from "node:crypto";
import type {
  ModelCatalog,
  ModelCatalogEntry,
} from "../../shared/model-selection";
import { normalizeModelBaseUrl } from "../../shared/model-base-url";
import type { ModelConnectionRuntime } from "./model-settings";

export type ModelCatalogService = {
  list(options?: { refresh?: boolean }): Promise<ModelCatalog>;
};
export class ModelCatalogError extends Error {
  constructor(message = "模型列表暂时无法获取，请检查模型接口配置后重试。") {
    super(message);
    this.name = "ModelCatalogError";
  }
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_MODELS = 10000;
const CACHE_MS = 30000;
const NON_CHAT = new Set([
  "image",
  "video",
  "embedding",
  "embeddings",
  "audio",
  "tts",
  "transcription",
  "rerank",
  "reranking",
]);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function safeText(value: unknown, max = 240): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\x00-\x1f\x7f]/u.test(value)
  );
}
function project(body: unknown): ModelCatalogEntry[] {
  if (
    !object(body) ||
    !Array.isArray(body.data) ||
    body.data.length > MAX_MODELS ||
    body.has_more === true
  )
    throw new ModelCatalogError();
  const seen = new Set<string>();
  const models: ModelCatalogEntry[] = [];
  for (const row of body.data) {
    if (
      !object(row) ||
      !safeText(row.id, 200) ||
      /\s/u.test(row.id) ||
      seen.has(row.id)
    )
      continue;
    if (typeof row.kind === "string" && NON_CHAT.has(row.kind.toLowerCase()))
      continue;
    const output = object(row.modalities) ? row.modalities.output : undefined;
    if (Array.isArray(output) && output.length && !output.includes("text"))
      continue;
    seen.add(row.id);
    const label = safeText(row.display_name)
      ? row.display_name
      : safeText(row.magpie_label)
        ? row.magpie_label
        : row.id;
    const prefix = row.id.includes("/") ? row.id.split("/")[0]! : undefined;
    const provider =
      prefix ?? (safeText(row.owned_by, 200) ? row.owned_by : "");
    const context =
      row.context_window ?? row.context_length ?? row.max_input_tokens;
    models.push({
      id: row.id,
      label,
      provider,
      ...(typeof context === "number" &&
      Number.isInteger(context) &&
      context > 0 &&
      context <= 1e9
        ? { contextWindow: context }
        : {}),
    });
  }
  return models;
}

async function readJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (!response.body) throw new ModelCatalogError();
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BYTES) {
    await response.body.cancel().catch(() => {});
    throw new ModelCatalogError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // Bound body reads as well as opening the connection.
      const chunk = await new Promise<Awaited<ReturnType<typeof reader.read>>>(
        (resolve, reject) => {
          const abort = () =>
            reject(new ModelCatalogError("模型列表请求超时，请稍后重试。"));
          if (signal.aborted) return abort();
          signal.addEventListener("abort", abort, { once: true });
          reader
            .read()
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        },
      );
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new ModelCatalogError();
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/** Query only the saved private gateway; callers never supply a URL or credentials. */
export function createModelCatalogService(options: {
  resolveConnection: () => Promise<ModelConnectionRuntime>;
  fetch?: typeof fetch;
}): ModelCatalogService {
  const request = options.fetch ?? fetch;
  type Cache = {
    key: string;
    value?: ModelCatalog;
    pending?: Promise<ModelCatalog>;
  };
  let current: Cache | undefined;
  return {
    async list(input = {}) {
      try {
        const connection = await options.resolveConnection();
        if (connection.useApiKey && !connection.apiKey)
          throw new ModelCatalogError(
            "模型密钥尚未配置，请先在管理中保存模型接口。",
          );
        const address = new URL(connection.baseUrl);
        if (
          !["http:", "https:"].includes(address.protocol) ||
          address.username ||
          address.password ||
          address.search ||
          address.hash
        )
          throw new ModelCatalogError();
        const baseUrl = normalizeModelBaseUrl(
          connection.provider,
          connection.baseUrl,
        );
        // Do not store credentials in cache keys or public projections. Changing either isolates requests.
        const key = createHash("sha256")
          .update(
            JSON.stringify([
              connection.provider,
              baseUrl,
              connection.useApiKey,
              connection.apiKey,
            ]),
          )
          .digest("hex");
        if (current?.key !== key) current = { key };
        const cache = current;
        if (
          !input.refresh &&
          cache.value &&
          Date.now() - cache.value.fetchedAt < CACHE_MS
        )
          return structuredClone(cache.value);
        if (!cache.pending) {
          cache.pending = (async () => {
            const headers: Record<string, string> = {
              Accept: "application/json",
            };
            if (connection.useApiKey && connection.apiKey) {
              if (connection.provider === "anthropic") {
                headers["x-api-key"] = connection.apiKey;
                headers["anthropic-version"] = "2023-06-01";
              } else headers.Authorization = `Bearer ${connection.apiKey}`;
            }
            const signal = AbortSignal.timeout(15000);
            const response = await request(`${baseUrl}/models`, {
              method: "GET",
              headers,
              redirect: "error",
              signal,
            });
            if (!response.ok) {
              await response.body?.cancel().catch(() => {});
              throw new ModelCatalogError(
                response.status === 401 || response.status === 403
                  ? "模型列表访问被拒绝，请检查网关密钥及模型权限。"
                  : undefined,
              );
            }
            const value = {
              models: project(await readJson(response, signal)),
              fetchedAt: Date.now(),
            };
            cache.value = value;
            return value;
          })().finally(() => {
            cache.pending = undefined;
          });
        }
        return structuredClone(await cache.pending);
      } catch (error) {
        if (error instanceof ModelCatalogError) throw error;
        // Fetch, parsing and storage exceptions can contain keys or arbitrary upstream prose.
        throw new ModelCatalogError();
      }
    },
  };
}
