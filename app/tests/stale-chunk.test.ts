import { describe, expect, test } from "bun:test";
import { isStaleChunkError } from "../src/lib/stale-chunk";

describe("isStaleChunkError", () => {
  test("recognises the browsers' chunk-load failures", () => {
    expect(isStaleChunkError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/route-admin-DIVeN2DY.js"))).toBe(true);
    expect(isStaleChunkError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new Error("Unable to preload CSS for /assets/route-settings-x.css"))).toBe(true);
    expect(isStaleChunkError("Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\"")).toBe(true);
  });
  test("leaves ordinary errors alone", () => {
    expect(isStaleChunkError(new Error("无法加载模型设置。"))).toBe(false);
    expect(isStaleChunkError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
