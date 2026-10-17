import { expect, test } from "bun:test";
import { withDeadline } from "../src/env";

// A launch that never settles used to pin every caller of that Bot's page (profiles.ts `starting`).
test("withDeadline rejects a promise that never settles", async () => {
  let abandoned = false;
  const never = new Promise<number>(() => {});
  await expect(
    withDeadline(never, 10, () => {
      abandoned = true;
      return new Error("abandoned");
    }),
  ).rejects.toThrow("abandoned");
  expect(abandoned).toBe(true);
});

test("withDeadline passes through results and errors that arrive in time", async () => {
  await expect(withDeadline(Promise.resolve(7), 50, () => new Error("x"))).resolves.toBe(7);
  await expect(
    withDeadline(Promise.reject(new Error("own")), 50, () => new Error("x")),
  ).rejects.toThrow("own");
});

test("a late rejection after the deadline is swallowed", async () => {
  let fail!: (e: Error) => void;
  const late = new Promise<number>((_, reject) => {
    fail = reject;
  });
  await expect(withDeadline(late, 5, () => new Error("deadline"))).rejects.toThrow("deadline");
  fail(new Error("late"));
  await new Promise((r) => setTimeout(r, 5));
});
