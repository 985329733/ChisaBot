import { describe, expect, test } from "bun:test";
import { browserRuntimeFromEnv } from "../src/browser-runtime";

describe("the configured browser runtime", () => {
  test.each(["linux", "darwin", "win32"])(
    "managed %s without Xvfb uses full headless Chromium",
    (platform) => {
      expect(browserRuntimeFromEnv({}, platform, false)).toEqual({
        backend: "managed",
        channel: "chromium",
        mode: "headless",
        useVirtualDisplay: false,
        allowExec: true,
      });
    },
  );

  test("managed linux with Xvfb defaults to headed on the virtual display", () => {
    expect(browserRuntimeFromEnv({}, "linux", true)).toEqual({
      backend: "managed",
      channel: "chromium",
      mode: "headed",
      useVirtualDisplay: true,
      allowExec: true,
    });
  });

  test("an explicit headless setting wins over the Xvfb default", () => {
    expect(
      browserRuntimeFromEnv({ COMPUTER_BROWSER_MODE: "headless" }, "linux", true)
        .mode,
    ).toBe("headless");
  });

  test.each(["linux", "darwin", "win32"])(
    "headed %s needs Xvfb only on Linux",
    (platform) => {
      expect(
        browserRuntimeFromEnv({ COMPUTER_BROWSER_MODE: "headed" }, platform)
          .useVirtualDisplay,
      ).toBe(platform === "linux");
    },
  );

  test.each(["linux", "darwin", "win32"])(
    "local Chrome on %s is headed and confined",
    (platform) => {
      expect(
        browserRuntimeFromEnv(
          { COMPUTER_BROWSER_BACKEND: "local-chrome" },
          platform,
        ),
      ).toEqual({
        backend: "local-chrome",
        channel: "chrome",
        mode: "headed",
        useVirtualDisplay: platform === "linux",
        hostname: "127.0.0.1",
        allowExec: false,
      });
    },
  );

  test("rejects unknown backends and incompatible local modes", () => {
    expect(() =>
      browserRuntimeFromEnv({ COMPUTER_BROWSER_BACKEND: "cdp" }),
    ).toThrow("COMPUTER_BROWSER_BACKEND");
    expect(() =>
      browserRuntimeFromEnv({ COMPUTER_BROWSER_MODE: "visible" }),
    ).toThrow("COMPUTER_BROWSER_MODE");
    expect(() =>
      browserRuntimeFromEnv({
        COMPUTER_BROWSER_BACKEND: "local-chrome",
        COMPUTER_BROWSER_MODE: "headless",
      }),
    ).toThrow("headed");
  });
});
