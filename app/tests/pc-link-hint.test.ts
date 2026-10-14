import { describe, expect, test } from "bun:test";
import { isPreResetClient, pcLinkProblem } from "../src/components/pc-link-hint";
import type { PcLocalState } from "../src/lib/pc-bridge";

const local = (patch: Partial<PcLocalState> = {}): PcLocalState => ({
  version: "0.1.7",
  platform: "win32",
  hostname: "PC",
  serverUrl: "https://x",
  deviceId: "dev_1",
  agentState: "online",
  statusText: "在线",
  tokenProtected: true,
  localPaused: false,
  forceLocalApproval: true,
  autoStart: true,
  startHidden: false,
  ...patch,
});

describe("PC link hint", () => {
  test("pre-reset 0.2.x builds are outdated, 0.1.x are not", () => {
    expect(isPreResetClient("0.2.4")).toBe(true);
    expect(isPreResetClient("0.3.0")).toBe(true);
    expect(isPreResetClient("0.1.7")).toBe(false);
    expect(isPreResetClient("1.0.0")).toBe(false);
    expect(isPreResetClient(undefined)).toBe(false);
  });
  test("problem kinds", () => {
    expect(pcLinkProblem(null, true)).toBe(null);
    expect(pcLinkProblem(local(), true)).toBe(null);
    expect(pcLinkProblem(local({ version: "0.2.4", agentState: "online" }), false)).toBe("outdated");
    expect(pcLinkProblem(local({ agentState: "offline" }), false)).toBe(null);
    expect(pcLinkProblem(local({ agentState: "offline" }), true)).toBe("offline");
    expect(pcLinkProblem(local({ agentState: "connecting", needsEnroll: true }), false)).toBe("enroll");
    expect(pcLinkProblem(local({ agentState: "offline", localPaused: true }), true)).toBe(null);
    expect(pcLinkProblem(local({ agentState: "revoked" }), true)).toBe(null);
  });
});
