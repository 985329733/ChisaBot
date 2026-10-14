import { describe, expect, test } from "bun:test";
import { moveModel } from "../src/components/settings/fallback-models";

describe("备用模型 ordering (DESIGN.md §61)", () => {
  test("moves up and down, ignores out-of-range moves", () => {
    expect(moveModel(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveModel(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveModel(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveModel(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});
