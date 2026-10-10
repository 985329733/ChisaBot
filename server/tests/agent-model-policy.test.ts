import { expect, test } from "bun:test";
import { resolveBuiltInModel } from "../src/admin/controls";
import type { EnterpriseDeps } from "../src/admin/controls";
import { createRequire } from "node:module";
import { runtimeRun } from "../src/admin/gate";

test("model policy resolves the selected BOT while overview keeps the deployment default", async () => {
  const lookedUp: string[] = [];
  const deps = {
    builtInModel: async () => "anthropic/gateway/default",
    builtInModelForAgent: async (id: string) => {
      lookedUp.push(id);
      return `anthropic/vendor/${id}`;
    },
  } as unknown as EnterpriseDeps;
  expect(await resolveBuiltInModel(deps, "first")).toBe(
    "anthropic/vendor/first",
  );
  expect(await resolveBuiltInModel(deps, "second")).toBe(
    "anthropic/vendor/second",
  );
  expect(await resolveBuiltInModel(deps)).toBe("anthropic/gateway/default");
  expect(lookedUp).toEqual(["first", "second"]);
});

test("the browser SDK's channel proxy sends the real BOT ID to the policy boundary", async () => {
  // Resolve the exact SDK used by useAgent, including its transitive core dependency.
  const appRequire = createRequire(
    new URL("../../app/package.json", import.meta.url),
  );
  const reactRequire = createRequire(
    appRequire.resolve("@copilotkit/react-core"),
  );
  const { ProxiedCopilotRuntimeAgent } = await import(
    reactRequire.resolve("@copilotkit/core")
  );
  const proxy = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "https://openbot.example.test/api/copilotkit",
    agentId: "channel:private-local-instance",
    runtimeAgentId: "actual-bot/id",
    threadId: "thread",
    transport: "sse",
    runtimeMode: "sse",
  });
  expect(proxy.agentId).toBe("channel:private-local-instance");
  expect(runtimeRun(new URL(proxy.url).pathname)).toEqual({
    agentId: "actual-bot/id",
    action: "run",
  });
});
