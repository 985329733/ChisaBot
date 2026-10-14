/**
 * 设置 → 模型 →「备用模型」（DESIGN.md §61）：主模型额度用完 / 暂时不可用时，按这个顺序换。
 *
 * 存在 enterprise_settings 的一行（key = model_fallbacks，`{ version: 1, models: [...] }`），不新建表，
 * 回滚到旧镜像时这一行被忽略（旧版只读环境变量 / 同平台自动挑选）。空列表 = 不指定，退回
 * CHISABOT_MODEL_FALLBACKS / 同平台自动挑选（agents/model-fallback.ts fallbackCandidates）。
 *
 * 读的时候缓存 30 秒（每一轮聊天都要问一次候选），保存时立刻清缓存。
 */
import { eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "../auth/guards";
import { requireAdmin } from "../auth/guards";
import type { Database } from "../db/client";
import { enterpriseSettings } from "../db/schema";

export const MODEL_FALLBACKS_KEY = "model_fallbacks";
export const MAX_FALLBACK_MODELS = 8;

export type ModelFallbackSettings = { models: string[] };

export class ModelFallbackValidationError extends Error {
  readonly status = 400;
}

function validModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const id = value.trim();
  if (!id || id.length > 200 || /\s/u.test(id)) return false;
  for (const character of id) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** 校验并整理：去空白、去重、保持顺序，最多 8 个。 */
export function parseFallbackModels(input: unknown): string[] {
  const raw = (input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>).models : input) as unknown;
  if (!Array.isArray(raw)) throw new ModelFallbackValidationError("请提供备用模型列表。");
  const models: string[] = [];
  for (const item of raw) {
    if (!validModelId(item)) throw new ModelFallbackValidationError("模型 id 不能为空、不能有空格，最长 200 个字符。");
    const id = item.trim();
    if (!models.includes(id)) models.push(id);
  }
  if (models.length > MAX_FALLBACK_MODELS) throw new ModelFallbackValidationError(`备用模型最多 ${MAX_FALLBACK_MODELS} 个。`);
  return models;
}

export type ModelFallbackStore = {
  read(): Promise<string[]>;
  write(models: string[], actorUserId?: string): Promise<string[]>;
};

export function createModelFallbackStore(database: Database): ModelFallbackStore {
  return {
    async read() {
      const [row] = await database
        .select({ value: enterpriseSettings.value })
        .from(enterpriseSettings)
        .where(eq(enterpriseSettings.key, MODEL_FALLBACKS_KEY));
      try {
        return row ? parseFallbackModels(row.value) : [];
      } catch {
        return [];
      }
    },
    async write(models, actorUserId) {
      const value = { version: 1, models };
      await database
        .insert(enterpriseSettings)
        .values({ key: MODEL_FALLBACKS_KEY, value, updatedBy: actorUserId ?? null })
        .onConflictDoUpdate({
          target: enterpriseSettings.key,
          set: { value, updatedBy: actorUserId ?? null, updatedAt: new Date() },
        });
      return models;
    },
  };
}

export type ModelFallbackService = {
  /** 聊天每一轮问候选时用（缓存 30 秒）。 */
  models(): Promise<string[]>;
  get(): Promise<ModelFallbackSettings>;
  save(input: unknown, actorUserId?: string): Promise<ModelFallbackSettings>;
  routes(requireUser: MiddlewareHandler<{ Variables: AppVariables }>): Hono<{ Variables: AppVariables }>;
};

export function createModelFallbackService(options: {
  store: ModelFallbackStore;
  now?: () => number;
  cacheMs?: number;
}): ModelFallbackService {
  const now = options.now ?? Date.now;
  const cacheMs = options.cacheMs ?? 30_000;
  let cached: { at: number; models: string[] } | null = null;

  const service: ModelFallbackService = {
    async models() {
      if (cached && now() - cached.at < cacheMs) return cached.models;
      const models = await options.store.read();
      cached = { at: now(), models };
      return models;
    },
    async get() {
      cached = null;
      return { models: await service.models() };
    },
    async save(input, actorUserId) {
      const models = parseFallbackModels(input);
      await options.store.write(models, actorUserId);
      cached = { at: now(), models };
      return { models };
    },
    routes(requireUser) {
      const routes = new Hono<{ Variables: AppVariables }>();
      routes.use("*", requireUser);
      routes.use("*", async (context, next) => {
        const denied = requireAdmin(context);
        if (denied) return denied;
        context.header("Cache-Control", "no-store");
        await next();
      });
      routes.get("/", async (context) => context.json(await service.get()));
      routes.put("/", async (context) => {
        const body = await context.req.json().catch(() => null);
        try {
          return context.json(await service.save(body, context.get("actor")?.id));
        } catch (error) {
          if (error instanceof ModelFallbackValidationError) return context.json({ error: error.message }, 400);
          return context.json({ error: "备用模型暂时无法保存，请稍后重试。" }, 503);
        }
      });
      return routes;
    },
  };
  return service;
}
