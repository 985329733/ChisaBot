import { expect, test } from "bun:test";
import { isNewerBuild, projectSystemUpdateState, safeText } from "./system-update";

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
