import { beforeEach, describe, expect, test } from "bun:test";
import {
  cooldownMs,
  coolingDown,
  fallbackCandidates,
  fallbackLanguageModel,
  isQuotaError,
  resetModelCooldowns,
} from "../src/agents/model-fallback";

function apiError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { name: "AI_APICallError", statusCode, responseBody: message });
}
const DAILY = apiError(429, "ClinePass: Error 429: Daily free limit reached on model xiaomi/mimo-v2.6-flash. Try again in 19h 51m");

function fakeModel(id: string, behaviour: () => Promise<unknown>) {
  const calls: unknown[] = [];
  return {
    calls,
    model: {
      modelId: id,
      provider: "test",
      async doStream(options: unknown) {
        calls.push(options);
        return behaviour();
      },
      async doGenerate(options: unknown) {
        calls.push(options);
        return behaviour();
      },
    },
  };
}

describe("model fallback on quota errors", () => {
  beforeEach(() => resetModelCooldowns());

  test("recognises quota errors, not others", () => {
    expect(isQuotaError(DAILY)).toBe(true);
    expect(isQuotaError(apiError(402, "payment required"))).toBe(true);
    expect(isQuotaError({ name: "AI_RetryError", message: "Failed after 3 attempts", lastError: DAILY })).toBe(true);
    expect(isQuotaError(apiError(400, "invalid tool schema"))).toBe(false);
    expect(isQuotaError(apiError(500, "upstream exploded"))).toBe(false);
    expect(isQuotaError(new Error("network down"))).toBe(false);
  });

  test("reads the retry hint", () => {
    expect(cooldownMs(DAILY)).toBe((19 * 3600 + 51 * 60) * 1000);
    expect(cooldownMs(apiError(429, "rate limited, retry after 30s"))).toBe(30_000);
    expect(cooldownMs(apiError(429, "slow down"))).toBe(10 * 60_000);
  });

  test("switches to the next candidate, then skips the cooled model on later turns", async () => {
    const primary = fakeModel("p", async () => {
      throw DAILY;
    });
    const backup = fakeModel("b", async () => ({ stream: "ok-from-b" }));
    const logs: Record<string, unknown>[] = [];
    let t = 1_000;
    const wrapped = fallbackLanguageModel(primary.model, "clinepass/p", {
      candidates: async () => ["clinepass/b"],
      build: (id) => (id === "clinepass/b" ? backup.model : null),
      now: () => t,
      log: (line) => logs.push(line),
    });
    expect(await wrapped.doStream({ prompt: 1 })).toEqual({ stream: "ok-from-b" });
    expect(primary.calls.length).toBe(1);
    expect(coolingDown("clinepass/p", t)).toBe(true);
    // next turn: primary not called at all
    expect(await wrapped.doGenerate({ prompt: 2 })).toEqual({ stream: "ok-from-b" });
    expect(primary.calls.length).toBe(1);
    expect(backup.calls).toEqual([{ prompt: 1 }, { prompt: 2 }]);
    expect(logs.map((l) => l.event)).toEqual(["primary-quota", "used", "used"]);
    // after the cooldown the primary is tried again
    t += 20 * 3600_000;
    expect(coolingDown("clinepass/p", t)).toBe(false);
    await wrapped.doStream({ prompt: 3 });
    expect(primary.calls.length).toBe(2);
  });

  test("non-quota errors are thrown unchanged and do not fall back", async () => {
    const boom = apiError(400, "bad request");
    const primary = fakeModel("p", async () => {
      throw boom;
    });
    let built = 0;
    const wrapped = fallbackLanguageModel(primary.model, "x/p", {
      candidates: async () => ["x/b"],
      build: () => {
        built++;
        return null;
      },
      log: () => {},
    });
    await expect(wrapped.doStream({})).rejects.toBe(boom);
    expect(built).toBe(0);
  });

  test("all candidates exhausted rethrows the first quota error", async () => {
    const primary = fakeModel("p", async () => {
      throw DAILY;
    });
    const other = fakeModel("b", async () => {
      throw apiError(429, "Daily free limit reached");
    });
    const wrapped = fallbackLanguageModel(primary.model, "c/p", {
      candidates: async () => ["c/b"],
      build: () => other.model,
      log: () => {},
    });
    await expect(wrapped.doStream({})).rejects.toBe(DAILY);
  });

  test("keeps other properties of the wrapped model", () => {
    const primary = fakeModel("p", async () => ({}));
    const wrapped = fallbackLanguageModel(primary.model, "c/p", { candidates: async () => [], build: () => null });
    expect(wrapped.modelId).toBe("p");
    expect(wrapped.provider).toBe("test");
  });

  test("candidates: env list, off, or same platform prefix from the catalog", async () => {
    const catalog = async () => ["clinepass/a", "clinepass/p", "opencode-zen/x-free", "clinepass/b", "clinepass/c", "clinepass/d"];
    expect(await fallbackCandidates(catalog, {})("clinepass/p")).toEqual(["clinepass/a", "clinepass/b", "clinepass/c"]);
    expect(await fallbackCandidates(catalog, { CHISABOT_MODEL_FALLBACKS: "codex/g, clinepass/p ,clinepass/b" })("clinepass/p")).toEqual(["codex/g", "clinepass/b"]);
    expect(await fallbackCandidates(catalog, { CHISABOT_MODEL_FALLBACKS: "off" })("clinepass/p")).toEqual([]);
    expect(await fallbackCandidates(catalog, {})("gpt-4o")).toEqual([]);
  });
});
