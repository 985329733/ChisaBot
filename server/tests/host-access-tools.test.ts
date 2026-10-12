import { describe, expect, test } from "bun:test";
import type { AuditEventInput } from "../src/audit";
import { createHostAccessBroker } from "../src/host-access/broker";
import { hostAccessTools } from "../src/host-access/tools";

function auditRecorder() {
  const events: AuditEventInput[] = [];
  return {
    events,
    auditStore: {
      insert: async (event: AuditEventInput) => {
        events.push(event);
      },
    },
  };
}

describe("host access tools", () => {
  test("offer folder discovery so the model does not need copied grant ids", async () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });
    broker.nextDesktopOperation();

    const tools = hostAccessTools({
      broker,
      botId: "bot-a",
      actorId: "user-a",
    });
    expect(tools[0]!.name).toBe("host_list_folders");
    expect(await tools[0]!.execute({})).toContain("Project");
    expect(await tools[0]!.execute({})).toContain("grant-1");
  });

  test("offers no host tools at all while desktop is offline", () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });

    expect(
      hostAccessTools({ broker, botId: "bot-a", actorId: "user-a" }).map(
        (tool) => tool.name,
      ),
    ).toEqual([]);
  });

  test("server-side tools are bound to one selected Bot and actor once desktop is connected", async () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });
    broker.nextDesktopOperation();

    const tools = hostAccessTools({
      broker,
      botId: "bot-a",
      actorId: "user-a",
    });
    expect(tools.map((tool) => tool.name)).toEqual([
      "host_list_folders",
      "host_list_files",
      "host_read_file",
      "host_write_file",
      "host_run_command",
    ]);

    const answer = tools[1]!.execute({ grantId: "grant-1", path: "." });
    await Promise.resolve();
    const lease = broker.nextDesktopOperation();
    expect(lease?.operations[0]).toMatchObject({
      kind: "list_files",
      botId: "bot-a",
      actorId: "user-a",
      grantId: "grant-1",
      relativePath: ".",
    });
    broker.resolveDesktopOperation({
      operationId: lease!.operations[0]!.operationId,
      ok: true,
      result: { entries: [{ name: "notes.txt", kind: "file" }] },
    });
    expect(await answer).toContain("notes.txt");

    // 授权属于这个人：同一个人的另一个机器人也能用；发给桌面的仍是授权时的机器人。
    const otherBotTools = hostAccessTools({
      broker,
      botId: "bot-b",
      actorId: "user-a",
    });
    expect(otherBotTools.map((tool) => tool.name)).toContain("host_read_file");
    expect(await otherBotTools[0]!.execute({})).toContain("grant-1");
    const shared = otherBotTools[1]!.execute({ grantId: "grant-1", path: "." });
    await Promise.resolve();
    const sharedLease = broker.nextDesktopOperation();
    expect(sharedLease?.operations[0]).toMatchObject({
      kind: "list_files",
      botId: "bot-a",
      actorId: "user-a",
    });
    broker.resolveDesktopOperation({
      operationId: sharedLease!.operations[0]!.operationId,
      ok: true,
      result: { entries: [] },
    });
    await shared;

    // 别人看不到。
    expect(
      hostAccessTools({ broker, botId: "bot-a", actorId: "user-b" }),
    ).toEqual([]);
  });

  test("run commands carry working folder and writable intent to native and still require native approval", async () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });
    broker.nextDesktopOperation();
    const commandTool = hostAccessTools({
      broker,
      botId: "bot-a",
      actorId: "user-a",
    }).find((tool) => tool.name === "host_run_command")!;

    const answer = commandTool.execute({
      grantId: "grant-1",
      path: "scripts",
      command: "npm test",
      writable: true,
    });
    await Promise.resolve();
    const lease = broker.nextDesktopOperation();
    expect(lease?.operations[0]).toMatchObject({
      kind: "run_command",
      relativePath: "scripts",
      command: "npm test",
      writable: true,
    });
    broker.resolveDesktopOperation({
      operationId: lease!.operations[0]!.operationId,
      ok: true,
      result: { stdout: "ok" },
    });
    expect(await answer).toContain("ok");
  });

  test("host operations audit request and outcome without content command or raw path", async () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });
    broker.nextDesktopOperation();
    const { auditStore, events } = auditRecorder();
    const writeTool = hostAccessTools({
      broker,
      botId: "bot-a",
      actorId: "user-a",
      auditStore,
      initiator: { kind: "handoff", id: "run-1" },
    }).find((tool) => tool.name === "host_write_file")!;

    const answer = writeTool.execute({
      grantId: "grant-1",
      path: "secret.txt",
      content: "do not log",
    });
    let lease = broker.nextDesktopOperation();
    for (let index = 0; index < 5 && !lease; index++) {
      await Promise.resolve();
      lease = broker.nextDesktopOperation();
    }
    broker.resolveDesktopOperation({
      operationId: lease!.operations[0]!.operationId,
      ok: true,
      result: { written: true },
    });
    await answer;

    expect(events.map((event) => event.payload.outcome)).toEqual([
      "requested",
      "succeeded",
    ]);
    expect(JSON.stringify(events)).not.toContain("do not log");
    expect(JSON.stringify(events)).not.toContain("secret.txt");
    expect(events[0]).toMatchObject({
      eventType: "configuration.changed",
      targetType: "host_access",
      targetId: "grant-1",
      actorUserId: "user-a",
      initiator: { kind: "handoff", id: "run-1" },
      payload: {
        change: "host_access_tool_call",
        operation: "write_file",
        bot: "bot-a",
        grant: "grant-1",
        outcome: "requested",
      },
    });
  });

  test("another person cannot use someone else's folder grant", async () => {
    const broker = createHostAccessBroker();
    broker.rememberGrant({
      id: "grant-1",
      botId: "bot-a",
      actorId: "user-a",
      displayName: "Project",
      revoked: false,
    });
    broker.nextDesktopOperation();
    const { auditStore } = auditRecorder();
    expect(
      hostAccessTools({ broker, botId: "bot-b", actorId: "user-b", auditStore }),
    ).toEqual([]);
    await expect(
      broker.callHost({
        kind: "read_file",
        botId: "bot-b",
        actorId: "user-b",
        grantId: "grant-1",
        relativePath: "a.txt",
      }),
    ).rejects.toThrow("not granted to this person");
  });
});
