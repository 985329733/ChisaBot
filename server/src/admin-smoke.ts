/**
 * 管理员自检：一次真实的模型往返，不碰任何对话（docs/admin-smoke.md）。
 *
 * 以前的发布自检是在某个机器人的对话里真的发一句「ok」，消息就永远留在用户的对话里了。这里换成
 * `POST /api/admin/smoke`：
 *
 * - 走和聊天完全相同的模型解析（`resolveConnection` / 给了 `agentId` 时 `resolveConnectionForAgent`，
 *   即机器人自己的模型覆盖）和相同的 AI SDK 客户端（`connectionLanguageModel`），所以它通过就说明
 *   「这台服务器此刻能用聊天用的那套配置跟模型说上话」；
 * - 让模型原样回一个随机口令，回对了才算通过（排除缓存、假响应、只通不答）；
 * - **不写数据库**：不建频道、不写消息、不写记忆、不触发投递，响应 `persisted: false`。只在服务器
 *   日志打一行结果，口令和回复不进日志。
 *
 * 仅管理员。公网网关照常先认证会话；本机 127.0.0.1:3001 的开发用户也是管理员，发布脚本用它。
 */
import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AppVariables } from "./auth/guards";
import { requireAdmin } from "./auth/guards";
import {
  connectionLanguageModel,
  type RuntimeModelConnection,
} from "./copilot";
import { withModelConnectionScope } from "./model-connection-context";

export const SMOKE_TIMEOUT_MS = 45_000;
const AGENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export type SmokeResult = {
  ok: boolean;
  /** 永远是 false：自检不落库。写在响应里，调用方（发布脚本）可以断言它。 */
  persisted: false;
  provider: "openai" | "anthropic";
  model: string;
  agentId: string | null;
  latencyMs: number;
  /** 模型有没有把口令原样回来。 */
  echoed: boolean;
  /** 模型回复的前 200 个字（排查用）。 */
  reply: string;
  message: string;
};

type Generate = (
  connection: RuntimeModelConnection,
  prompt: string,
  signal: AbortSignal,
) => Promise<string>;

/** 默认的生成：和聊天同一个 AI SDK 客户端，非流式、短回复。 */
export const generateWithConnection: Generate = async (
  connection,
  prompt,
  signal,
) => {
  const model = connectionLanguageModel(connection.model, connection.apiKey);
  const result = await model.doGenerate({
    prompt: [{ role: "user", content: [{ type: "text", text: prompt }] }],
    maxOutputTokens: 256,
    abortSignal: signal,
  });
  return result.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
};

export function smokePrompt(nonce: string): string {
  return `这是一次服务器自检。请只回复下面这个口令，不要加任何别的文字：${nonce}`;
}

export function createAdminSmokeRoutes(options: {
  requireUser: MiddlewareHandler<{ Variables: AppVariables }>;
  resolveConnection: () => Promise<RuntimeModelConnection>;
  resolveConnectionForAgent?: (
    agentId: string,
  ) => Promise<RuntimeModelConnection>;
  generate?: Generate;
  timeoutMs?: number;
  log?: (line: string) => void;
}) {
  const generate = options.generate ?? generateWithConnection;
  const log = options.log ?? ((line: string) => console.info(line));
  const routes = new Hono<{ Variables: AppVariables }>();

  routes.use("*", options.requireUser);
  routes.use("*", async (context, next) => {
    const denied = requireAdmin(context);
    if (denied) return denied;
    context.header("Cache-Control", "no-store");
    await next();
  });

  routes.post("/", async (context) => {
    const body = (await context.req.json().catch(() => null)) as {
      agentId?: unknown;
    } | null;
    const rawAgent =
      typeof body?.agentId === "string" ? body.agentId.trim() : "";
    if (rawAgent && !AGENT_ID.test(rawAgent)) {
      return context.json({ error: "机器人 id 格式不对。" }, 400);
    }
    const agentId = rawAgent || null;
    if (agentId && !options.resolveConnectionForAgent) {
      return context.json({ error: "这台服务器不支持按机器人自检。" }, 400);
    }

    return withModelConnectionScope(async () => {
      let connection: RuntimeModelConnection;
      try {
        connection =
          agentId && options.resolveConnectionForAgent
            ? await options.resolveConnectionForAgent(agentId)
            : await options.resolveConnection();
      } catch {
        return context.json({ error: "模型配置暂时无法读取。" }, 503);
      }
      const nonce = `CHISA-${randomBytes(4).toString("hex").toUpperCase()}`;
      const start = performance.now();
      let reply = "";
      let failure: string | null = null;
      try {
        reply = await generate(
          connection,
          smokePrompt(nonce),
          AbortSignal.timeout(options.timeoutMs ?? SMOKE_TIMEOUT_MS),
        );
      } catch (error) {
        const name = error instanceof Error ? error.name : "";
        failure =
          name === "TimeoutError" || name === "AbortError"
            ? "模型在限定时间内没有回复。"
            : "模型请求失败（连接、密钥或模型名有问题）。";
      }
      const latencyMs = Math.round(performance.now() - start);
      const echoed = !failure && reply.includes(nonce);
      const result: SmokeResult = {
        ok: echoed,
        persisted: false,
        provider: connection.model.provider,
        model: connection.model.defaultModel,
        agentId,
        latencyMs,
        echoed,
        reply: reply.slice(0, 200),
        message:
          failure ??
          (echoed
            ? "自检通过：模型按要求回复了口令。"
            : reply
              ? "模型有回复，但没有原样回口令。"
              : "模型返回了空回复。"),
      };
      // 秘密不进日志：只有结果、模型名和耗时。
      log(
        `[admin-smoke] ok=${result.ok} model=${result.model} agent=${agentId ?? "-"} ${latencyMs}ms`,
      );
      return context.json(result, result.ok ? 200 : 502);
    });
  });

  return routes;
}
