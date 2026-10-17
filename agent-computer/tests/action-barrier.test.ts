import { expect, test } from "bun:test";
import { createActionBarrier } from "../src/action-barrier";

test("closing admission refuses new actions and drains admitted work exactly once", async () => {
  const barrier = createActionBarrier();
  const release = barrier.enter();
  barrier.close();
  expect(() => barrier.enter()).toThrow(/closed/);
  let drained = false;
  const waiting = barrier.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  release();
  release();
  await waiting;
  expect(barrier.pending()).toBe(0);
  barrier.open();
  barrier.enter()();
});

test("a drain timeout never grants admission", async () => {
  const barrier = createActionBarrier();
  const release = barrier.enter();
  barrier.close();
  await expect(barrier.drain(1)).rejects.toThrow(/still finishing/);
  expect(() => barrier.enter()).toThrow();
  release();
  await barrier.drain();
});

// 2026-10-17 生产事故：一个从没结束的操作一直占着屏障，每次「接管」都在 drain 上超时，
// 这个机器人的浏览器直到容器重启都不能用。租约到期后屏障必须自己放行，并报告是谁卡住的。
test("an action that never finishes gives its lease back at the deadline", async () => {
  const expired: { label: string; heldMs: number }[] = [];
  const barrier = createActionBarrier({
    leaseMs: 20,
    onExpired: (lease) => expired.push(lease),
  });
  barrier.enter("/navigate"); // never released, like a call on a half-dead browser
  expect(barrier.pending()).toBe(1);
  expect(barrier.holders().map((h) => h.label)).toEqual(["/navigate"]);
  barrier.close();
  await barrier.drain(1_000); // resolves once the lease expires, instead of rejecting for ever
  expect(barrier.pending()).toBe(0);
  expect(expired).toHaveLength(1);
  expect(expired[0].label).toBe("/navigate");
  expect(expired[0].heldMs).toBeGreaterThanOrEqual(0);
});

test("a late release after the lease expired is a no-op and never goes negative", async () => {
  const barrier = createActionBarrier({ leaseMs: 5 });
  const late = barrier.enter("/click");
  const other = barrier.enter("/type", 0); // this one never expires
  await new Promise((r) => setTimeout(r, 30));
  expect(barrier.pending()).toBe(1);
  late();
  late();
  expect(barrier.pending()).toBe(1);
  other();
  expect(barrier.pending()).toBe(0);
});

test("released in time, the lease timer never fires", async () => {
  let fired = 0;
  const barrier = createActionBarrier({ leaseMs: 10, onExpired: () => fired++ });
  barrier.enter("/snapshot")();
  await new Promise((r) => setTimeout(r, 30));
  expect(fired).toBe(0);
});

test("a throwing reporter cannot keep the lease held", async () => {
  const barrier = createActionBarrier({
    leaseMs: 5,
    onExpired: () => {
      throw new Error("boom");
    },
  });
  barrier.enter("/navigate");
  barrier.close();
  await barrier.drain(500);
  expect(barrier.pending()).toBe(0);
});

// 调用方断开（服务器 45 秒超时）后，没结束的操作不用等满整份租约。
test("shorten brings the deadline forward, never back", async () => {
  const expired: string[] = [];
  const barrier = createActionBarrier({
    leaseMs: 10_000,
    onExpired: (lease) => expired.push(lease.label),
  });
  const release = barrier.enter("/navigate");
  release.shorten(20_000); // later than the lease: ignored
  release.shorten(10);
  barrier.close();
  await barrier.drain(1_000);
  expect(expired).toEqual(["/navigate"]);
  expect(barrier.pending()).toBe(0);
  release(); // late release after expiry: no-op
  release.shorten(1);
  expect(barrier.pending()).toBe(0);
});

test("shorten on an action that finished in time does nothing", async () => {
  let fired = 0;
  const barrier = createActionBarrier({ leaseMs: 10_000, onExpired: () => fired++ });
  const release = barrier.enter("/click");
  release();
  release.shorten(1);
  await new Promise((r) => setTimeout(r, 20));
  expect(fired).toBe(0);
});
