import { describe, expect, test } from "bun:test";
import { isBlankPageUrl, isPlainWhitePixels } from "@/components/computer/live-screen";

describe("takeover blank page", () => {
  test("about:blank and empty urls are blank; missing url is a real page", () => {
    expect(isBlankPageUrl("about:blank")).toBe(true);
    expect(isBlankPageUrl(" ")).toBe(true);
    expect(isBlankPageUrl(undefined)).toBe(false);
    expect(isBlankPageUrl("https://example.com/")).toBe(false);
  });
  test("only a (nearly) white frame counts as blank", () => {
    expect(isPlainWhitePixels([255, 255, 255, 255, 250, 252, 249, 255])).toBe(true);
    expect(isPlainWhitePixels([255, 255, 255, 255, 30, 40, 50, 255])).toBe(false);
    expect(isPlainWhitePixels([])).toBe(false);
  });
});
