import { z } from "zod";
import {
  CAPABILITY_INFO,
  type DeviceOperation,
  OPERATION_CAPABILITY,
} from "../../../shared/devices";
import type { AuditInitiator } from "../audit";
import { REFUSAL_MARKER, type GrantedTool } from "../plugins/tools";
import { DeviceRefusedError, type DeviceHub } from "./hub";
import type { DeviceRecord, DeviceStore } from "./store";

/**
 * 把设备节点的能力变成机器人工具（docs/pc-node.md §7）。
 *
 * 设备属于账号，不属于某个机器人：这次运行的人名下的每台在线设备，这个人的任何机器人都能用
 * （调用方 index.ts 只在至少一台在线时才给工具）。不再有「按机器人勾选」这一层；安全边界仍是每台设备
 * 自己的能力开关（默认全关）、允许的文件夹、审批、紧急停止和审计，全部在 hub 里。
 * 每次执行都重新读设备（开关可能刚被改过）。多台在线时用 deviceId 选（id 或名称）；只有一台在线时可省略。
 */

const deviceId = z
  .string()
  .min(1)
  .optional()
  .describe("目标设备：设备 id 或设备名称（见 device_list）。只有一台在线设备时可以省略；多台在线时必须指定。");

const schemas = {
  list: z.object({}),
  info: z.object({ deviceId }),
  shell: z.object({
    deviceId,
    command: z.string().min(1).max(20_000).describe("要运行的 PowerShell 命令（Windows）；Linux/macOS 上是 sh 命令"),
    cwd: z.string().optional().describe("工作目录（绝对路径，可选）"),
    timeoutSec: z.number().int().min(1).max(600).optional().describe("超时秒数，默认 60，最多 600"),
  }),
  listFiles: z.object({
    deviceId,
    path: z.string().optional().describe("绝对路径，或相对于第一个允许文件夹的路径；省略时列出允许的文件夹"),
  }),
  readFile: z.object({
    deviceId,
    path: z.string().min(1),
    maxBytes: z.number().int().min(1).max(1_048_576).optional().describe("最多读取的字节数，默认 262144"),
  }),
  writeFile: z.object({
    deviceId,
    path: z.string().min(1),
    content: z.string().max(2_000_000),
    append: z.boolean().optional().describe("true 时追加到末尾，否则覆盖（覆盖前 PC 会备份原文件）"),
  }),
  screenshot: z.object({
    deviceId,
    maxWidth: z.number().int().min(320).max(3840).optional().describe("缩放后的最大宽度，默认 1600"),
  }),
  input: z.object({
    deviceId,
    action: z
      .enum(["move", "click", "double_click", "right_click", "scroll", "type", "key"])
      .describe("move/click/double_click/right_click 需要 x,y；scroll 用 amount（正数向上）；type 输入 text；key 发送按键，如 {ENTER}、^c、%{F4}（SendKeys 语法）"),
    x: z.number().int().optional(),
    y: z.number().int().optional(),
    amount: z.number().int().optional(),
    text: z.string().max(5000).optional(),
    keys: z.string().max(200).optional(),
  }),
  open: z.object({
    deviceId,
    target: z.string().min(1).max(2000).describe("网址（http/https）、文件路径或程序名，例如 notepad、https://example.com"),
    args: z.array(z.string().max(500)).max(20).optional().describe("启动程序时的参数"),
  }),
  clipboard: z.object({
    deviceId,
    action: z.enum(["read", "write"]),
    text: z.string().max(100_000).optional(),
  }),
};

/**
 * 把模型给的设备选择（id / 名称 / 主机名，或省略）解析成这个人名下的一台未撤销设备。
 * 返回字符串 = 拒绝原因（给模型看）。
 */
export async function resolveDevice(
  store: Pick<DeviceStore, "forOwner">,
  ownerUserId: string,
  selector: string | undefined,
  isOnline: (id: string) => boolean,
): Promise<DeviceRecord | string> {
  const owned = await store.forOwner(ownerUserId);
  const wanted = selector?.trim();
  if (wanted) {
    const byId = owned.find((device) => device.id === wanted);
    if (byId) return byId;
    const key = wanted.toLowerCase();
    const byName = owned.filter((device) => device.name.toLowerCase() === key);
    const matches = byName.length ? byName : owned.filter((device) => device.hostname?.toLowerCase() === key);
    if (matches.length === 1) return matches[0] as DeviceRecord;
    if (matches.length > 1) {
      const online = matches.filter((device) => isOnline(device.id));
      if (online.length === 1) return online[0] as DeviceRecord;
      return `有 ${matches.length} 台设备都叫「${wanted}」，请改用设备 id。`;
    }
    return `用户名下没有「${wanted}」这台设备（或它已被撤销）。`;
  }
  const online = owned.filter((device) => isOnline(device.id));
  if (online.length === 1) return online[0] as DeviceRecord;
  if (online.length === 0) return "用户名下现在没有在线的设备。";
  return `现在有 ${online.length} 台设备在线，请用 deviceId 指定是哪一台。`;
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function deviceTools(options: {
  store: DeviceStore;
  hub: DeviceHub;
  botId: string;
  actorId: string;
  devices: DeviceRecord[];
  botName?: string | null;
  initiator?: AuditInitiator;
}): GrantedTool[] {
  const { store, hub, botId, actorId } = options;
  if (!options.devices.length) return [];
  const botName = options.botName ?? null;

  const roster = options.devices
    .map((device) => {
      const caps = Object.entries(device.capabilities)
        .filter(([, policy]) => policy !== "off")
        .map(([cap, policy]) => `${cap}${policy === "ask" ? "(需审批)" : ""}`)
        .join(",");
      return `${device.id}「${device.name}」${hub.isOnline(device.id) ? "在线" : "离线"}·${device.platform}${device.paused ? "·已紧急停止" : ""}·能力:${caps || "无"}`;
    })
    .join("；");

  async function run(
    operation: DeviceOperation,
    selector: string | undefined,
    args: Record<string, unknown>,
    summary: string,
    timeoutMs?: number,
  ): Promise<string> {
    const picked = await resolveDevice(store, actorId, selector, (id) => hub.isOnline(id));
    if (typeof picked === "string") return `${REFUSAL_MARKER} ${picked} 可用设备：${roster}`;
    const device = picked;
    try {
      const result = await hub.invoke({
        device,
        operation,
        args,
        bot: { id: botId, name: botName },
        summary,
        timeoutMs,
      });
      if (operation === "screenshot" && result && typeof result === "object" && "url" in result) {
        const shot = result as { url: string; width?: number; height?: number };
        return JSON.stringify({
          ...shot,
          note: `截图已保存（30 分钟内有效）。在回复中可用 Markdown 展示：![截图](${shot.url})`,
        });
      }
      return typeof result === "string" ? result : JSON.stringify(result ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "设备操作失败。";
      return error instanceof DeviceRefusedError
        ? `${REFUSAL_MARKER} ${message}`
        : `设备操作失败：${message}`;
    }
  }

  const enabledAnywhere = (operation: DeviceOperation) => {
    const capability = OPERATION_CAPABILITY[operation];
    return !capability || options.devices.some((device) => device.capabilities[capability] !== "off");
  };

  const tools: GrantedTool[] = [
    {
      name: "device_list",
      ref: "devices/list",
      description: `列出用户账号下关联的全部设备（ChisaBot PC / 手机客户端）及其在线状态和已开启的能力。这些设备由用户的所有机器人共用。当前在线：${roster}`,
      parameters: schemas.list,
      execute: async () => {
        const fresh = await store.forOwner(actorId);
        return JSON.stringify({
          devices: fresh.map((device) => ({
            deviceId: device.id,
            name: device.name,
            platform: device.platform,
            clientVersion: device.clientVersion,
            hostname: device.hostname,
            online: hub.isOnline(device.id),
            paused: device.paused,
            allowedRoots: device.allowedRoots,
            capabilities: device.capabilities,
          })),
          legend: Object.fromEntries(
            Object.entries(CAPABILITY_INFO).map(([key, info]) => [key, info.label]),
          ),
        });
      },
    },
    {
      name: "device_system_info",
      ref: "devices/system_info",
      description: "读取设备的系统信息（系统版本、主机名、用户、CPU、内存、屏幕分辨率）。",
      parameters: schemas.info,
      execute: async (raw) => {
        const args = schemas.info.parse(raw ?? {});
        return run("system_info", args.deviceId, {}, "读取系统信息");
      },
    },
  ];

  if (enabledAnywhere("shell"))
    tools.push({
      name: "device_run_shell",
      ref: "devices/run_shell",
      description:
        "在用户电脑上运行一条 PowerShell 命令并返回退出码、stdout、stderr（各最多 64KB）。可能需要用户审批。不要运行破坏性命令。",
      parameters: schemas.shell,
      execute: async (raw) => {
        const args = schemas.shell.parse(raw ?? {});
        const timeoutSec = args.timeoutSec ?? 60;
        return run(
          "shell",
          args.deviceId,
          { command: args.command, cwd: args.cwd, timeoutSec },
          `运行命令：${clip(args.command, 300)}${args.cwd ? `（目录 ${args.cwd}）` : ""}`,
          (timeoutSec + 20) * 1000,
        );
      },
    });

  if (enabledAnywhere("list_files"))
    tools.push(
      {
        name: "device_list_files",
        ref: "devices/list_files",
        description: "列出用户电脑上「允许的文件夹」里的文件和子文件夹。",
        parameters: schemas.listFiles,
        execute: async (raw) => {
          const args = schemas.listFiles.parse(raw ?? {});
          return run("list_files", args.deviceId, { path: args.path }, `列出：${args.path ?? "允许的文件夹"}`);
        },
      },
      {
        name: "device_read_file",
        ref: "devices/read_file",
        description: "读取用户电脑上「允许的文件夹」里的一个文本文件（默认最多 256KB）。",
        parameters: schemas.readFile,
        execute: async (raw) => {
          const args = schemas.readFile.parse(raw ?? {});
          return run("read_file", args.deviceId, { path: args.path, maxBytes: args.maxBytes }, `读取：${args.path}`);
        },
      },
    );

  if (enabledAnywhere("write_file"))
    tools.push({
      name: "device_write_file",
      ref: "devices/write_file",
      description: "在用户电脑上「允许的文件夹」里写入文本文件（覆盖前自动备份为 .chisabot-bak）。可能需要用户审批。",
      parameters: schemas.writeFile,
      execute: async (raw) => {
        const args = schemas.writeFile.parse(raw ?? {});
        return run(
          "write_file",
          args.deviceId,
          { path: args.path, content: args.content, append: args.append === true },
          `${args.append ? "追加" : "写入"}：${args.path}（${Buffer.byteLength(args.content)} 字节）`,
          60_000,
        );
      },
    });

  if (enabledAnywhere("screenshot"))
    tools.push({
      name: "device_screenshot",
      ref: "devices/screenshot",
      description: "截取用户电脑的主屏幕，返回截图地址和尺寸。",
      parameters: schemas.screenshot,
      execute: async (raw) => {
        const args = schemas.screenshot.parse(raw ?? {});
        return run("screenshot", args.deviceId, { maxWidth: args.maxWidth ?? 1600 }, "截取屏幕", 60_000);
      },
    });

  if (enabledAnywhere("input"))
    tools.push({
      name: "device_input",
      ref: "devices/input",
      description:
        "在用户电脑上操作鼠标和键盘（坐标为屏幕像素，基于真实分辨率，不是缩放后的截图）。可能需要用户审批。",
      parameters: schemas.input,
      execute: async (raw) => {
        const args = schemas.input.parse(raw ?? {});
        const { deviceId: id, ...rest } = args;
        const what =
          args.action === "type"
            ? `输入文字：${clip(args.text ?? "", 80)}`
            : args.action === "key"
              ? `按键：${args.keys ?? ""}`
              : `${args.action}${args.x !== undefined ? ` (${args.x}, ${args.y})` : ""}${args.amount ? ` ${args.amount}` : ""}`;
        return run("input", id, rest, `鼠标键盘：${what}`, 60_000);
      },
    });

  if (enabledAnywhere("open"))
    tools.push({
      name: "device_open",
      ref: "devices/open",
      description: "在用户电脑上用默认浏览器打开网址，或打开文件 / 启动程序。",
      parameters: schemas.open,
      execute: async (raw) => {
        const args = schemas.open.parse(raw ?? {});
        return run("open", args.deviceId, { target: args.target, args: args.args ?? [] }, `打开：${clip(args.target, 200)}`, 60_000);
      },
    });

  if (enabledAnywhere("clipboard_read"))
    tools.push({
      name: "device_clipboard",
      ref: "devices/clipboard",
      description: "读取或写入用户电脑的剪贴板文字。",
      parameters: schemas.clipboard,
      execute: async (raw) => {
        const args = schemas.clipboard.parse(raw ?? {});
        return args.action === "read"
          ? run("clipboard_read", args.deviceId, {}, "读取剪贴板", 60_000)
          : run(
              "clipboard_write",
              args.deviceId,
              { text: args.text ?? "" },
              `写入剪贴板：${clip(args.text ?? "", 80)}`,
              60_000,
            );
      },
    });

  return tools.map((tool) => ({ ...tool, initiator: options.initiator }));
}
