import { describe, expect, test } from "bun:test";
import { DEVICE_CAPABILITIES, defaultCapabilities, initialCapabilities, isFactoryOff, normalizeCapabilities } from "./devices";

describe("device capability defaults (2026-10-14)", () => {
  test("new computers start with every capability on 询问", () => {
    const caps = initialCapabilities();
    for (const capability of DEVICE_CAPABILITIES) expect(caps[capability]).toBe("ask");
  });
  test("normalize still fills missing keys with off (safe fallback)", () => {
    expect(normalizeCapabilities({ shell: "ask" }).files_write).toBe("off");
    expect(normalizeCapabilities(null)).toEqual(defaultCapabilities());
  });
  test("isFactoryOff only for the old all-off value", () => {
    expect(isFactoryOff(defaultCapabilities())).toBe(true);
    expect(isFactoryOff({ ...defaultCapabilities(), screenshot: "ask" })).toBe(false);
    expect(isFactoryOff(initialCapabilities())).toBe(false);
  });
});
