/**
 * 模型额度用完 / 暂时不可用时自动换一个能用的模型（DESIGN.md §60 成熟度 1，§61 备用模型）。
 *
 * 2026-10-15 生产实测：默认模型 clinepass/cline-free/mimo-v2.6-flash 的每日免费额度一用完，
 * 每个机器人的每次回答都要等 AI SDK 重试三次（十几秒到两分多钟），然后弹一条英文报错
 * 「Failed after 3 attempts… Daily free limit reached… Try again in 19h 51m」，整整一天没法用。
 *
 * 这里包在模型外面：调用（doStream / doGenerate）在还没吐出任何内容之前就被拒（429、402，或
 * 403/400 且错误里写着额度 / quota / limit），就记下这个模型「冷却到什么时候」（错误里写了
 * 「Try again in 19h 51m」就按它，否则 10 分钟），然后立刻用候选模型重发同一个请求；冷却期内的
 * 后续回合直接跳过它，不再白等。候选模型：环境变量 CHISABOT_MODEL_FALLBACKS（逗号分隔，
 * 设为 off 关闭）；没设就从模型目录里取与当前模型同一个平台前缀（clinepass/…）的其它模型，按目录顺序。
 * 全部候选都失败时抛出原来的错误（界面照旧显示，见 app 的错误翻译）。
 */

import { AsyncLocalStorage } from "node:async_hooks";

type Model = Record<string, unknown> & { modelId?: string };

/** 为什么换了模型：额度 / 限流（quota），或者模型服务 5xx / 过载（unavailable）。 */
export type FallbackReason = "quota" | "unavailable";
export type FallbackUse = { from: string; to: string; reason: FallbackReason };
type FallbackListener = (use: FallbackUse) => void;

/*
 * 谁想知道「这一轮换了模型」：聊天运行（context-usage.ts meterRun → RUN_FINISHED 的
 * metadata.modelFallback → 对话里的淡色小字）和管理员自检（admin-smoke.ts）。AsyncLocalStorage，
 * 运行之间互不串。
 */
const listeners = new AsyncLocalStorage<FallbackListener>();
export function withFallbackListener<T>(listener: FallbackListener, run: () => T): T {
  return listeners.run(listener, run);
}
function announce(use: FallbackUse) {
  try {
    listeners.getStore()?.(use);
  } catch {
    // 记录失败不影响回答。
  }
}
type Call = (options: unknown) => Promise<unknown>;

export type FallbackDeps = {
  /** 候选模型 id（不含当前模型），按优先级。 */
  candidates: (primary: string) => Promise<string[]>;
  /** 用同一个连接建一个别的模型。 */
  build: (modelId: string) => unknown;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
};

const cooldown = new Map<string, number>();
/** 冷却的原因（后续回合直接跳过它时，提示仍然说得对）。 */
const cooledReason = new Map<string, FallbackReason>();
export function resetModelCooldowns() {
  cooldown.clear();
  cooledReason.clear();
}
export function coolingDown(modelId: string, now = Date.now()): boolean {
  const until = cooldown.get(modelId);
  if (!until) return false;
  if (until <= now) {
    cooldown.delete(modelId);
    return false;
  }
  return true;
}

function errorParts(error: unknown): { status?: number; text: string } {
  const seen = new Set<unknown>();
  let status: number | undefined;
  const texts: string[] = [];
  let current: unknown = error;
  // RetryError → lastError / errors；APICallError → statusCode / responseBody
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth++) {
    seen.add(current);
    const e = current as Record<string, unknown>;
    if (typeof e.statusCode === "number" && status === undefined) status = e.statusCode;
    for (const key of ["message", "responseBody"]) if (typeof e[key] === "string") texts.push(e[key] as string);
    current = e.lastError ?? e.cause;
  }
  return { status, text: texts.join(" ") };
}

const QUOTA_TEXT = /quota|rate.?limit|daily.*limit|free (tier|limit)|limit reached|insufficient.*(credit|balance)|exceeded|额度|限额|余额/i;

/** 这个错误是不是「这个模型暂时用不了（额度 / 限流）」，换一个模型有意义。 */
export function isQuotaError(error: unknown): boolean {
  const { status, text } = errorParts(error);
  if (status === 429 || status === 402) return true;
  if ((status === 403 || status === 400 || status === undefined) && QUOTA_TEXT.test(text) && /429|limit|quota|额度|限额/i.test(text)) return true;
  return false;
}

const UNAVAILABLE_TEXT = /overloaded|service unavailable|bad gateway|upstream (error|request failed)|temporarily unavailable/i;

/**
 * 这个错误值不值得换模型：额度 / 限流 → quota；模型服务 5xx / 529 过载 → unavailable；
 * 其它（400 参数错、401 密钥错、网络断）→ null，照常报错（换模型也救不了，或者会掩盖配置问题）。
 */
export function fallbackReason(error: unknown): FallbackReason | null {
  if (isQuotaError(error)) return "quota";
  const { status, text } = errorParts(error);
  if (status !== undefined && (status === 529 || (status >= 500 && status <= 504))) return "unavailable";
  if (status === undefined && /\b(50[0234]|529)\b/.test(text) && UNAVAILABLE_TEXT.test(text)) return "unavailable";
  return null;
}

/** 「Try again in 19h 51m」/「retry after 30s」→ 毫秒；读不出来就 10 分钟，最多 24 小时。 */
export function cooldownMs(error: unknown): number {
  const { text } = errorParts(error);
  const m = /(?:try again|retry)[^0-9]{0,20}(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s)?/i.exec(text);
  if (m && (m[1] || m[2] || m[3])) {
    const ms = (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000;
    if (ms > 0) return Math.min(ms, 24 * 3600_000);
  }
  return 10 * 60_000;
}

/** 冷却多久：额度按错误里写的恢复时间；服务不可用 2 分钟（多半是一时的）。 */
function cooldownFor(error: unknown, reason: FallbackReason): number {
  return reason === "quota" ? cooldownMs(error) : 2 * 60_000;
}

export function fallbackLanguageModel<T>(model: T, primaryId: string, deps: FallbackDeps): T {
  if (!model || typeof model !== "object") return model;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line) => console.log(JSON.stringify(line)));
  const target = model as unknown as Model;
  const wrap = (property: "doStream" | "doGenerate") => async (options: unknown) => {
    const primaryCall = (target[property] as Call).bind(model);
    let firstError: unknown = null;
    let reason: FallbackReason = "quota";
    if (!coolingDown(primaryId, now())) {
      try {
        return await primaryCall(options);
      } catch (error) {
        const why = fallbackReason(error);
        if (!why) throw error;
        const ms = cooldownFor(error, why);
        cooldown.set(primaryId, now() + ms);
        firstError = error;
        reason = why;
        log({ type: "model-fallback", event: why === "quota" ? "primary-quota" : "primary-unavailable", model: primaryId, cooldownMinutes: Math.round(ms / 60000) });
      }
    } else {
      reason = cooledReason.get(primaryId) ?? "quota";
    }
    if (firstError) cooledReason.set(primaryId, reason);
    const list = await deps.candidates(primaryId).catch(() => [] as string[]);
    for (const id of list) {
      if (id === primaryId || coolingDown(id, now())) continue;
      const other = deps.build(id) as Model | null;
      const call = other && typeof other[property] === "function" ? (other[property] as Call).bind(other) : null;
      if (!call) continue;
      try {
        const result = await call(options);
        log({ type: "model-fallback", event: "used", model: primaryId, fallback: id });
        announce({ from: primaryId, to: id, reason });
        return result;
      } catch (error) {
        const why = fallbackReason(error);
        if (!why) throw error;
        cooldown.set(id, now() + cooldownFor(error, why));
        cooledReason.set(id, why);
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
    // 主模型在冷却、又没有候选：照常调一次（可能已经恢复）。
    return primaryCall(options);
  };
  return new Proxy(model as unknown as object, {
    get(object, property) {
      if ((property === "doStream" || property === "doGenerate") && typeof target[property] === "function") return wrap(property);
      const value = Reflect.get(object, property);
      return typeof value === "function" ? value.bind(object) : value;
    },
  }) as unknown as T;
}

/**
 * 候选模型，按优先级：
 * 1. 管理员在 设置 → 模型 →「备用模型」里排好的列表（configured，DESIGN.md §61）；
 * 2. 环境变量 CHISABOT_MODEL_FALLBACKS（逗号分隔；off / 0 关闭自动挑选）；
 * 3. 目录里与当前模型同平台前缀的其它模型（最多 3 个）。
 * 只返回目录里存在的模型的规则只用于第 3 条；管理员列表照填写的顺序，目录暂时读不到也照用。
 */
export function fallbackCandidates(
  catalog: () => Promise<string[]>,
  env: Record<string, string | undefined> = process.env,
  configured: () => Promise<string[]> = async () => [],
): (primary: string) => Promise<string[]> {
  return async (primary) => {
    const admin = (await configured().catch(() => [] as string[])).filter((id) => id && id !== primary);
    if (admin.length) return admin;
    const fromEnv = env.CHISABOT_MODEL_FALLBACKS?.trim();
    if (fromEnv === "off" || fromEnv === "0") return [];
    if (fromEnv) return fromEnv.split(",").map((s) => s.trim()).filter((s) => s && s !== primary);
    const slash = primary.indexOf("/");
    if (slash <= 0) return [];
    const prefix = primary.slice(0, slash + 1);
    return (await catalog()).filter((id) => id !== primary && id.startsWith(prefix)).slice(0, 3);
  };
}

/** 对话里那行淡色小字（DESIGN.md §61）：模型 id 只留最后一段（clinepass/cline-free/step-5 → step-5）。 */
export function fallbackNotice(use: Pick<FallbackUse, "to" | "reason">): string {
  const short = use.to.split("/").filter(Boolean).pop() || use.to;
  return use.reason === "unavailable" ? `主模型暂时不可用，已改用 ${short}` : `主模型额度用完，已改用 ${short}`;
}
