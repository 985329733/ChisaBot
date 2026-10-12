import { z } from "zod";
import { HeadlessToolSuspension } from "../computer/headless-tools";
import {
  type AuditInitiator,
  type AuditStore,
  recordAuditEvent,
} from "../audit";
import { REFUSAL_MARKER, type GrantedTool } from "../plugins/tools";
import { HostAccessRefusedError, type HostAccessBroker } from "./broker";

const empty = z.object({});

const grantPath = z.object({
  grantId: z.string().min(1),
  path: z.string().optional(),
});

const readFile = z.object({
  grantId: z.string().min(1),
  path: z.string().min(1),
});

const writeFile = z.object({
  grantId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
});

const runCommand = z.object({
  grantId: z.string().min(1),
  path: z.string().optional(),
  command: z.string().min(1),
  writable: z.boolean().optional(),
});

function resultText(result: unknown): string {
  if (typeof result === "string") return result;
  return JSON.stringify(result ?? {});
}

async function auditHostAccess(
  options: {
    auditStore?: AuditStore;
    initiator?: AuditInitiator;
    actorId: string;
    botId: string;
  },
  input: {
    operation: string;
    outcome: "requested" | "succeeded" | "refused" | "failed" | "stopped";
    grantId?: string;
    reason?: string;
  },
) {
  if (!options.auditStore) return;
  await recordAuditEvent(options.auditStore, {
    eventType: "configuration.changed",
    targetType: "host_access",
    ...(input.grantId ? { targetId: input.grantId } : {}),
    actorUserId: options.actorId,
    ...(options.initiator ? { initiator: options.initiator } : {}),
    payload: {
      change: "host_access_tool_call",
      operation: input.operation,
      bot: options.botId,
      actor: options.actorId,
      ...(input.grantId ? { grant: input.grantId } : {}),
      outcome: input.outcome,
      ...(input.reason ? { reason: input.reason.slice(0, 240) } : {}),
    },
  });
}

async function answer(
  audit: {
    auditStore?: AuditStore;
    initiator?: AuditInitiator;
    actorId: string;
    botId: string;
    operation: string;
    grantId?: string;
  },
  run: () => Promise<unknown>,
): Promise<string> {
  await auditHostAccess(audit, {
    operation: audit.operation,
    grantId: audit.grantId,
    outcome: "requested",
  });
  try {
    const result = await run();
    await auditHostAccess(audit, {
      operation: audit.operation,
      grantId: audit.grantId,
      outcome: "succeeded",
    });
    return resultText(result);
  } catch (error) {
    if (error instanceof HeadlessToolSuspension) throw error;
    const reason =
      error instanceof Error ? error.message : "That host operation failed.";
    await auditHostAccess(audit, {
      operation: audit.operation,
      grantId: audit.grantId,
      outcome:
        error instanceof HostAccessRefusedError
          ? reason.toLowerCase().includes("stop")
            ? "stopped"
            : "refused"
          : "failed",
      reason,
    });
    if (error instanceof HostAccessRefusedError) {
      return `${REFUSAL_MARKER} ${error.message}`;
    }
    return `That host operation could not be completed: ${reason}`;
  }
}

/** 给模型也给人看的拒绝说明：指向「电脑操作」，而不是一句英文的 not available。 */
export const HOST_UNAVAILABLE_HINT =
  "这台电脑还没有连接到这个机器人，或者没有授权任何文件夹。需要操作电脑上的文件或命令时，请让用户在机器人「⋯」菜单 → 电脑操作 里连接电脑并授权。";

export function hostAccessTools(options: {
  broker: HostAccessBroker;
  botId: string;
  actorId: string;
  auditStore?: AuditStore;
  initiator?: AuditInitiator;
}): GrantedTool[] {
  const { broker, botId, actorId } = options;
  const status = broker.statusFor(actorId);
  // 授权属于这个人：任何机器人都能用这个人授权过的文件夹（审批、审计、紧急停止不变）。
  const grants = status.grants.filter((grant) => !grant.revoked);
  const audit = (operation: string, grantId?: string) => ({
    auditStore: options.auditStore,
    initiator: options.initiator,
    actorId,
    botId,
    operation,
    ...(grantId ? { grantId } : {}),
  });

  /*
   * 只有这台桌面宿主（上游 Tauri 客户端）此刻连着、并且这个人授权过文件夹时才提供 host_* 工具。
   * 以前 host_list_folders 无条件提供给每个机器人，而 ChisaBot 不发布这个桌面宿主，于是模型一调用就
   * 被拒绝，聊天里出现「已阻止：host_list_folders」。没有能用的宿主时一个都不给，模型也就不会去试。
   * 电脑上的文件 / 命令走「电脑操作」（device_* 工具，server/src/devices）。
   */
  if (!status.connected || grants.length === 0) return [];

  const tools: GrantedTool[] = [
    {
      name: "host_list_folders",
      ref: "host-access/list_folders",
      description:
        "List the host folders this person has explicitly granted to this Bot, including the grantId to use with host file and command tools.",
      parameters: empty,
      execute: async () => {
        if (grants.length === 0) {
          await auditHostAccess(audit("list_folders"), {
            operation: "list_folders",
            outcome: "refused",
            reason: "No host folders are granted to this Bot.",
          });
          return `${REFUSAL_MARKER} ${HOST_UNAVAILABLE_HINT}`;
        }
        await auditHostAccess(audit("list_folders"), {
          operation: "list_folders",
          outcome: "succeeded",
        });
        return JSON.stringify({
          connected: status.connected,
          folders: grants.map((grant) => ({
            grantId: grant.id,
            displayName: grant.displayName,
          })),
        });
      },
    },
  ];

  tools.push(
    {
      name: "host_list_files",
      ref: "host-access/list_files",
      description:
        "List files in a host folder this person granted to this Bot. First call host_list_folders for grantId values.",
      parameters: grantPath,
      execute: async (args) => {
        const parsed = grantPath.parse(args ?? {});
        return answer(audit("list_files", parsed.grantId), () =>
          broker.callHost({
            kind: "list_files",
            botId,
            actorId,
            grantId: parsed.grantId,
            relativePath: parsed.path ?? ".",
          }),
        );
      },
    },
    {
      name: "host_read_file",
      ref: "host-access/read_file",
      description:
        "Read one file from a granted host folder. Use only paths relative to that folder.",
      parameters: readFile,
      execute: async (args) => {
        const parsed = readFile.parse(args ?? {});
        return answer(audit("read_file", parsed.grantId), () =>
          broker.callHost({
            kind: "read_file",
            botId,
            actorId,
            grantId: parsed.grantId,
            relativePath: parsed.path,
          }),
        );
      },
    },
    {
      name: "host_write_file",
      ref: "host-access/write_file",
      description:
        "Request an exact native-owner-confirmed file write in a granted host folder. The native app backs up the original and refuses unless the owner approves this operation.",
      parameters: writeFile,
      execute: async (args) => {
        const parsed = writeFile.parse(args ?? {});
        return answer(audit("write_file", parsed.grantId), () =>
          broker.callHost({
            kind: "write_file",
            botId,
            actorId,
            grantId: parsed.grantId,
            relativePath: parsed.path,
            content: parsed.content,
          }),
        );
      },
    },
    {
      name: "host_run_command",
      ref: "host-access/run_command",
      description:
        "Request an exact native-owner-confirmed shell command in the offline sandbox for a granted host folder. Set writable true only if the command needs write access; native still prompts before running.",
      parameters: runCommand,
      execute: async (args) => {
        const parsed = runCommand.parse(args ?? {});
        return answer(audit("run_command", parsed.grantId), () =>
          broker.callHost({
            kind: "run_command",
            botId,
            actorId,
            grantId: parsed.grantId,
            relativePath: parsed.path,
            command: parsed.command,
            writable: parsed.writable === true,
          }),
        );
      },
    },
  );

  return tools.map((tool) => ({ ...tool, initiator: options.initiator }));
}
