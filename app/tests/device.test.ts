import { describe, expect, test } from "bun:test";
import { phoneMediaVerdict } from "../src/lib/device";

// DESIGN.md §40：手机上把样式表当成「767px 宽的窗口」——窄窗口规则一律生效，≥768 的宽窗口规则一律不生效。
describe("phoneMediaVerdict", () => {
  test("narrow-window rules turn on", () => {
    expect(phoneMediaVerdict("(max-width: 767px)")).toBe("on");
    expect(phoneMediaVerdict("(max-width:767px)")).toBe("on");
    expect(phoneMediaVerdict("(width < 48rem)")).toBe("on");
    expect(phoneMediaVerdict("(width <= 767px)")).toBe("on");
    expect(phoneMediaVerdict("(max-width: 760px)")).toBe("on");
    expect(phoneMediaVerdict("(max-width: 1100px)")).toBe("on");
    expect(phoneMediaVerdict("screen and (max-width: 767px)")).toBe("on");
  });
  test("wide-window rules turn off", () => {
    expect(phoneMediaVerdict("(min-width: 768px)")).toBe("off");
    expect(phoneMediaVerdict("(width >= 48rem)")).toBe("off");
    expect(phoneMediaVerdict("(min-width: 1280px)")).toBe("off");
    expect(phoneMediaVerdict("(width >= 80rem)")).toBe("off");
    expect(phoneMediaVerdict("(min-width: 768px) and (max-width: 1279px)")).toBe("off");
  });
  test("small-screen and unrelated rules are left to the browser", () => {
    expect(phoneMediaVerdict("(max-width: 640px)")).toBeNull();
    expect(phoneMediaVerdict("(max-width: 360px)")).toBeNull();
    expect(phoneMediaVerdict("(min-width: 640px)")).toBeNull();
    expect(phoneMediaVerdict("(width >= 40rem)")).toBeNull();
    expect(phoneMediaVerdict("(prefers-reduced-motion: reduce)")).toBeNull();
    expect(phoneMediaVerdict("(hover: none)")).toBeNull();
    expect(phoneMediaVerdict("(max-width: 767px) and (hover: none)")).toBeNull();
    expect(phoneMediaVerdict("print")).toBeNull();
  });
  test("lists: any matching part turns the rule on", () => {
    expect(phoneMediaVerdict("(max-width: 767px), print")).toBe("on");
    expect(phoneMediaVerdict("(min-width: 768px), (min-width: 1024px)")).toBe("off");
  });
});
