import { expect, test } from "bun:test";
import { estimateText, isNewerBuild, projectSystemUpdateState, safeText } from "./system-update";

const running = { version: "0.1.2", buildId: "glass-20261012a", commit: "a".repeat(40) };
const NOW = Date.parse("2026-10-12T02:00:00Z");

test("isNewerBuild only when both sides have a real, different build id", () => {
  expect(isNewerBuild("glass-a", { version: "1", buildId: "glass-b" })).toBe(true);
  expect(isNewerBuild("glass-a", { version: "1", buildId: "glass-a" })).toBe(false);
  expect(isNewerBuild("dev", { version: "1", buildId: "glass-b" })).toBe(false);
  expect(isNewerBuild("glass-a", { version: "1", buildId: "dev" })).toBe(false);
  expect(isNewerBuild(undefined, { version: "1", buildId: "x" })).toBe(false);
  expect(isNewerBuild("glass-a", null)).toBe(false);
});

test("projection keeps only whitelisted, well-formed fields", () => {
  const state = projectSystemUpdateState(
    {
      updatedAt: "2026-10-12T01:59:30Z",
      current: { image: "local/chisabot:glass-20261012a", commit: "a".repeat(40), secret: "x" },
      previous: { image: "local/chisabot:glass-20261011d" },
      source: { kind: "mirror", repo: "ChisaAlter/ChisaBot", branch: "main", token: "ghp_secret" },
      latest: { sha: "b".repeat(40), subject: "feat: 在线更新", author: "Hark", date: "2026-10-12T01:00:00Z" },
      behind: 2,
      commits: [
        { sha: "b".repeat(40), subject: "feat: 在线更新" },
        { sha: "not-a-sha", subject: "bad" },
        { sha: "c".repeat(40), subject: "x\u001b[31m red\u0007" },
      ],
      depsChanged: false,
      job: { id: "update-abc123", action: "update", status: "running", step: "frontend", log: ["a", 5, "b"], env: { TOKEN: "x" } },
      history: [{ id: "update-old111", action: "rollback", status: "rejected", at: "2026-10-11T00:00:00Z", error: "没有上一版" }, { bogus: 1 }],
    },
    running,
    ["check"],
    NOW,
  );
  expect(state.updaterOnline).toBe(true);
  expect(state.current).toEqual({ image: "local/chisabot:glass-20261012a", commit: "a".repeat(40) });
  expect(state.previous).toEqual({ image: "local/chisabot:glass-20261011d" });
  expect(JSON.stringify(state)).not.toContain("ghp_secret");
  expect(JSON.stringify(state)).not.toContain("TOKEN");
  expect(state.commits.map((c) => c.sha[0])).toEqual(["b", "c"]);
  expect(state.commits[1]?.subject).toBe("x[31m red");
  expect(state.job?.log).toEqual(["a", "b"]);
  expect(state.job?.step).toBe("frontend");
  expect(state.history).toHaveLength(1);
  expect(state.pending).toEqual(["check"]);
  expect(state.behind).toBe(2);
});

test("a stale state file means the updater is offline; garbage means nothing", () => {
  expect(projectSystemUpdateState({ updatedAt: "2026-10-12T01:50:00Z" }, running, [], NOW).updaterOnline).toBe(false);
  const empty = projectSystemUpdateState("nope", running, [], NOW);
  expect(empty.updaterOnline).toBe(false);
  expect(empty.behind).toBeNull();
  expect(empty.job).toBeNull();
  expect(projectSystemUpdateState({ behind: -1 }, running, [], NOW).behind).toBeNull();
  expect(projectSystemUpdateState({ current: { image: "rm -rf /;" } }, running, [], NOW).current).toBeUndefined();
});

test("safeText strips control characters and bounds length", () => {
  expect(safeText("a\u0000b\u001fc")).toBe("abc");
  expect(safeText("x".repeat(30), 10)).toBe("x".repeat(10));
  expect(safeText("x".repeat(500), 10)).toBeUndefined();
  expect(safeText(42)).toBeUndefined();
  expect(safeText("   ")).toBeUndefined();
});

test("full-build fields: mode, duration, estimates, reason, external run", () => {
  const state = projectSystemUpdateState(
    {
      updatedAt: "2026-10-12T01:59:00Z",
      depsChanged: true,
      fullReason: "这些提交改动了依赖",
      estimates: { code: 120, full: 540, bogus: 3, other: "x" },
      externalBusy: true,
      job: { id: "update-full01", action: "update", status: "running", mode: "full", durationSec: 30, step: "build", log: [] },
      history: [
        { id: "update-full00", action: "update", status: "succeeded", at: "2026-10-12T01:00:00Z", mode: "full", durationSec: 540 },
        { id: "update-code00", action: "update", status: "succeeded", at: "2026-10-12T00:00:00Z", mode: "weird", durationSec: -1 },
      ],
    },
    running,
    [],
    Date.parse("2026-10-12T02:00:00Z"),
  );
  expect(state.fullReason).toBe("这些提交改动了依赖");
  expect(state.estimates).toEqual({ code: 120, full: 540 });
  expect(state.externalBusy).toBe(true);
  expect(state.job).toMatchObject({ mode: "full", durationSec: 30, step: "build" });
  expect(state.history[0]).toMatchObject({ mode: "full", durationSec: 540 });
  expect(state.history[1]?.mode).toBeUndefined();
  expect(state.history[1]?.durationSec).toBeUndefined();
  expect(projectSystemUpdateState({ depsChanged: false, fullReason: "x" }, running, []).fullReason).toBeUndefined();
  expect(estimateText(540)).toBe("约 9 分钟");
  expect(estimateText(20)).toBe("约 1 分钟");
  expect(estimateText(undefined)).toBe("");
});
