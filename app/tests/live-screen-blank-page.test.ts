import { describe, expect, test } from "bun:test";
import { addressToUrl, isBlankPageUrl, isPlainWhitePixels } from "@/components/computer/live-screen";

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

describe("takeover address bar", () => {
  test("file:// addresses go to the computer as typed, not to a search", () => {
    expect(addressToUrl("file:///workspace/date.html")).toBe("file:///workspace/date.html");
    expect(addressToUrl("workspace.local/date.html")).toBe("https://workspace.local/date.html");
    expect(addressToUrl("天气")).toContain("bing.com/search");
  });
});
