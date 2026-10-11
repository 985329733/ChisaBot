import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createAdminSmokeRoutes, smokePrompt } from "../src/admin-smoke";
import type { AppVariables } from "../src/auth/guards";
import type { RuntimeModelConnection } from "../src/copilot";

const connection: RuntimeModelConnection = {
  model: { provider: "openai", defaultModel: "gpt-test", baseUrl: "http://model.invalid/v1" },
  apiKey: "sk-secret",
};

function app(
  role: "admin" | "user",
  generate: (c: RuntimeModelConnection, prompt: string) => Promise<string>,
  extra: { forAgent?: (id: string) => Promise<RuntimeModelConnection>; logs?: string[] } = {},
) {
  const requireUser = (async (context: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    context.set("actor", { id: `${role}-1`, email: `${role}@x`, name: role, role });
    await next();
  }) as never;
  const root = new Hono<{ Variables: AppVariables }>();
  root.route(
    "/api/admin/smoke",
    createAdminSmokeRoutes({
      requireUser,
      resolveConnection: async () => connection,
      resolveConnectionForAgent: extra.forAgent,
      generate: (c, prompt) => generate(c, prompt),
      log: (line) => extra.logs?.push(line),
    }),
  );
  return root;
}

const post = (root: Hono<{ Variables: AppVariables }>, body: unknown = {}) =>
  root.request("/api/admin/smoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

test("admins only", async () => {
  let called = false;
  const response = await post(
    app("user", async () => {
      called = true;
      return "";
    }),
  );
  expect(response.status).toBe(403);
  expect(called).toBe(false);
});

test("passes only when the model echoes the nonce; never persists; no secrets in logs", async () => {
  const logs: string[] = [];
  let seenPrompt = "";
  const response = await post(
    app(
      "admin",
      async (_c, prompt) => {
        seenPrompt = prompt;
        return `好的 ${prompt.split("：").pop()}`;
      },
      { logs },
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ ok: true, echoed: true, persisted: false, model: "gpt-test", agentId: null });
  expect(seenPrompt).toContain("CHISA-");
  expect(logs).toHaveLength(1);
  expect(logs[0]).not.toContain("sk-secret");
  expect(logs[0]).not.toContain("CHISA-");
});

test("a reply without the nonce, or a failed call, is a 502 with a reason", async () => {
  const wrong = await post(app("admin", async () => "ok"));
  expect(wrong.status).toBe(502);
  expect(await wrong.json()).toMatchObject({ ok: false, echoed: false, persisted: false });
  const failed = await post(
    app("admin", async () => {
      throw new Error("boom sk-secret");
    }),
  );
  expect(failed.status).toBe(502);
  const body = await failed.json();
  expect(body.ok).toBe(false);
  expect(JSON.stringify(body)).not.toContain("sk-secret");
});

test("agentId uses the Bot's own model resolution and is validated", async () => {
  const asked: string[] = [];
  const root = app("admin", async (c, prompt) => `${c.model.defaultModel} ${prompt.split("：").pop()}`, {
    forAgent: async (id) => {
      asked.push(id);
      return { ...connection, model: { ...connection.model, defaultModel: "bot-model" } };
    },
  });
  const response = await post(root, { agentId: "agent-1" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, model: "bot-model", agentId: "agent-1" });
  expect(asked).toEqual(["agent-1"]);
  expect((await post(root, { agentId: "../x y" })).status).toBe(400);
});

test("prompt carries the nonce", () => {
  expect(smokePrompt("CHISA-ABCD")).toContain("CHISA-ABCD");
});
