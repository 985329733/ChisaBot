import { describe, expect, test } from "bun:test";
import { defaultCapabilities } from "../../shared/devices";
import type { DeviceHub } from "../src/devices/hub";
import type { DeviceRecord, DeviceStore } from "../src/devices/store";
import { deviceTools, resolveDevice } from "../src/devices/tools";

function record(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    id: "dev_1",
    ownerUserId: "u1",
    name: "书房电脑",
    platform: "win32",
    osVersion: null,
    hostname: "STUDY",
    arch: "x64",
    clientVersion: "0.1.0",
    capabilities: { ...defaultCapabilities(), clipboard: "allow" },
    allowedRoots: [],
    paused: false,
    revoked: false,
    lastSeenAt: null,
    lastIp: null,
    createdAt: new Date().toISOString(),
    // 旧的按机器人授权：空列表也不影响使用。
    botIds: [],
    lastUsedBy: null,
    tokenHash: "x",
    ...overrides,
  };
}

function harness(devices: DeviceRecord[], online: string[]) {
  const calls: Array<{ deviceId: string; botId: string; operation: string }> = [];
  const store = {
    get: async (id: string) => devices.find((device) => device.id === id) ?? null,
    forOwner: async (owner: string) => devices.filter((device) => device.ownerUserId === owner && !device.revoked),
  } as unknown as DeviceStore;
  const hub = {
    isOnline: (id: string) => online.includes(id),
    invoke: async (input: { device: DeviceRecord; operation: string; bot: { id: string } }) => {
      calls.push({ deviceId: input.device.id, botId: input.bot.id, operation: input.operation });
      return { ok: true, device: input.device.id };
    },
  } as unknown as DeviceHub;
  const toolsFor = (botId: string, actorId = "u1") =>
    deviceTools({ store, hub, botId, actorId, devices: devices.filter((d) => online.includes(d.id)) });
  return { calls, store, hub, toolsFor };
}

describe("device tools are shared by every bot of the owner", () => {
  test("two different bots get the same device and can both use it", async () => {
    const { calls, toolsFor } = harness([record()], ["dev_1"]);
    for (const botId of ["bot-a", "bot-b"]) {
      const tools = toolsFor(botId);
      expect(tools.map((tool) => tool.name)).toContain("device_clipboard");
      const list = JSON.parse(String(await tools[0]!.execute({})));
      expect(list.devices.map((d: { deviceId: string }) => d.deviceId)).toEqual(["dev_1"]);
      // 只有一台在线：deviceId 可以省略。
      await tools.find((tool) => tool.name === "device_clipboard")!.execute({ action: "read" });
    }
    expect(calls).toEqual([
      { deviceId: "dev_1", botId: "bot-a", operation: "clipboard_read" },
      { deviceId: "dev_1", botId: "bot-b", operation: "clipboard_read" },
    ]);
  });

  test("capabilities stay off by default: no shell tool when shell is off", () => {
    const { toolsFor } = harness([record()], ["dev_1"]);
    expect(toolsFor("bot-a").map((tool) => tool.name)).not.toContain("device_run_shell");
  });

  test("a selector is required when several devices are online, and may be a name", async () => {
    const devices = [record(), record({ id: "dev_2", name: "笔记本", hostname: "LAPTOP" })];
    const { store } = harness(devices, ["dev_1", "dev_2"]);
    const online = (id: string) => id === "dev_1" || id === "dev_2";
    expect(await resolveDevice(store, "u1", undefined, online)).toContain("2 台设备在线");
    expect(((await resolveDevice(store, "u1", "笔记本", online)) as DeviceRecord).id).toBe("dev_2");
    expect(((await resolveDevice(store, "u1", "study", online)) as DeviceRecord).id).toBe("dev_1");
    expect(((await resolveDevice(store, "u1", "dev_1", online)) as DeviceRecord).id).toBe("dev_1");
  });

  test("another person's device is never reachable", async () => {
    const { store } = harness([record({ ownerUserId: "u2" })], ["dev_1"]);
    expect(typeof (await resolveDevice(store, "u1", "dev_1", () => true))).toBe("string");
  });
});
