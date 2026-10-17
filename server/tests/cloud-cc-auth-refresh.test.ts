import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createCloudCcService } from "../src/cloud-cc/service";
import { createDatabase } from "../src/db/client";
import type { DeviceRecord } from "../src/devices/store";
import { TEST_POOL, testDatabaseUrl } from "./support/database";

/**
 * 云端 Claude 登录状态的缓存刷新（DESIGN.md §73.1）：
 *  - POST /claude/check（check）同一节点同时只发一次 rpc status，结果写回 claude_auth；
 *  - 节点在线时服务器按 authRefreshMs 定期复查；离线不查。
 */
const url = process.env.TEST_DATABASE_URL ? testDatabaseUrl() : null;
describe.skipIf(!url)("cloud Claude auth refresh", () => {
  const database = url ? createDatabase(url, TEST_POOL) : (null as never);
  const sql = url ? database.$client : (null as never);
  const tag = randomUUID().replace(/-/g, "").slice(0, 8);
  const owner = `u_auth_${tag}`;
  const nodeId = `dev_authnode_${tag}`;
  const record = { id: nodeId, ownerUserId: owner, platform: "linux", revoked: false, paused: false, name: "云端工作区" } as unknown as DeviceRecord;
  let online = true;
  let loggedIn = true;
  const statusCalls: string[] = [];
  let service: ReturnType<typeof createCloudCcService>;
  const hub = {
    isOnline: (id: string) => online && id === nodeId,
    sendRaw: (deviceId: string, message: Record<string, unknown>) => {
      if (!online) return false;
      if (message.type === "cc_rpc") {
        const op = String(message.op);
        if (op === "status") statusCalls.push(deviceId);
        // 节点稍后回答（让并发的检查有机会撞在一起）
        setTimeout(() => {
          void service.extension.onMessage?.(record, {
            type: "cc_rpc_result",
            id: message.id,
            ok: true,
            result: op === "status" ? { loggedIn, email: loggedIn ? "a@example.com" : null, plan: loggedIn ? "pro" : null, method: "claude.ai" } : {},
          } as never);
        }, 30);
      }
      return true;
    },
  };

  afterAll(async () => {
    clearInterval(service?._internal.authTimer);
    await sql.unsafe("DELETE FROM chisabot_cloud_workspaces WHERE device_id = $1", [nodeId]);
    await sql.unsafe("DELETE FROM chisabot_cc_events WHERE owner_user_id = $1", [owner]).catch(() => {});
    await sql.end?.();
  });

  const cached = async () => (await sql.unsafe<{ claude_auth: { loggedIn: boolean; checkedAt: string } | null }[]>("SELECT claude_auth FROM chisabot_cloud_workspaces WHERE device_id = $1", [nodeId]))[0]?.claude_auth ?? null;

  test("check dedupes concurrent calls and writes the cache", async () => {
    service = createCloudCcService({ database, hub: hub as never, deviceStore: { get: async (id: string) => (id === nodeId ? ({ id, revoked: false } as never) : null) }, authRefreshMs: 150 });
    await service.ensure();
    // 节点登记（会顺手查一次登录状态）
    await service.extension.onMessage?.(record, { type: "cc_info", claudeVersion: "2.1.165", root: "/workspace" } as never);
    await Bun.sleep(80);
    expect((await cached())?.loggedIn).toBe(true);

    loggedIn = false;
    statusCalls.length = 0;
    const [a, b, c] = await Promise.all([service._internal.check(owner), service._internal.check(owner), service._internal.check(owner)]);
    expect(statusCalls.length).toBe(1);
    expect(a.claude.loggedIn).toBe(false);
    expect(b.claude).toEqual(a.claude);
    expect(c.claude).toEqual(a.claude);
    expect((await cached())?.loggedIn).toBe(false);
  });

  test("server refreshes periodically while the node is online, not while offline", async () => {
    loggedIn = true;
    statusCalls.length = 0;
    await Bun.sleep(400);
    expect(statusCalls.length).toBeGreaterThanOrEqual(1);
    expect((await cached())?.loggedIn).toBe(true);

    online = false;
    await Bun.sleep(50);
    statusCalls.length = 0;
    await Bun.sleep(400);
    expect(statusCalls.length).toBe(0);
  });
});
