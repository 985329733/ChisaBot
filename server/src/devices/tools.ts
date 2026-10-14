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
 * 设备属于账号，不属于某个机器人：这次运行的人名下的每台在线设备，这个人的任何机器人都能用。
 * 调用方 index.ts 传入这个人名下全部未撤销的设备：一台都没有 → 不给工具；有但都离线 → 只给 device_list
 * （只读，用来如实回答「电脑离线」）；至少一台在线 → 全套。不论哪种，都带一段提示词（{@link deviceGuidance}），
 * 告诉机器人用户的电脑已关联、现在是否在线、开了哪些能力。不再有「按机器人勾选」这一层；安全边界仍是每台设备
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

/** 「3 分钟前」「约 15 小时前」「2 天前」；没有记录时「从未连接过」。服务器不知道用户时区，所以只说相对时间。 */
export function agoText(iso: string | null, now = Date.now()) {
  if (!iso) return "从未连接过";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "刚刚";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `约 ${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function platformName(platform: string) {
  return platform === "win32" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform;
}

/**
 * 给机器人的「用户的电脑」提示词。没有这一段时，计算机那段很长的提示词（「你有自己的浏览器」）说了算，
 * 机器人手里拿着 device_* 工具也会回答「我看不到你的电脑，只有隔离的浏览器」（2026-10-13 用户报告）。
 * 设备列表为空时返回空字符串（什么都不说，和以前一样）。
 */
export function deviceGuidance(
  devices: readonly Pick<DeviceRecord, "id" | "name" | "platform" | "osVersion" | "paused" | "capabilities" | "lastSeenAt">[],
  isOnline: (id: string) => boolean,
  now = Date.now(),
): string {
  if (!devices.length) return "";
  const describe = (device: (typeof devices)[number]) => {
    const enabled = Object.entries(device.capabilities)
      .filter(([, policy]) => policy !== "off")
      .map(([cap, policy]) => `${CAPABILITY_INFO[cap as keyof typeof CAPABILITY_INFO]?.label ?? cap}${policy === "ask" ? "（每次需用户批准）" : ""}`);
    const state = isOnline(device.id)
      ? device.paused
        ? "online but on emergency stop (紧急停止): every remote action is refused until the person lifts it"
        : "ONLINE now"
      : `offline (last connected ${agoText(device.lastSeenAt, now)})`;
    return `- 「${device.name}」 (${device.osVersion || platformName(device.platform)}, deviceId ${device.id}): ${state}; enabled capabilities: ${enabled.length ? enabled.join("、") : "none yet (只能读系统信息)"}.`;
  };
  const online = devices.filter((device) => isOnline(device.id));
  const lines = [
    "The person's own computers. Besides your own cloud browser (the computer_* tools), the person has linked these computers of theirs to their account through the ChisaBot PC client. They are shared by all of the person's Bots, including you:",
    ...devices.map(describe),
  ];
  if (online.length) {
    lines.push(
      "When the person asks whether you can see, reach or use their computer, the answer is yes for the online one(s): say so plainly and use the device_* tools (device_* acts on THEIR computer; computer_* acts on your cloud browser). Never claim you only have an isolated browser.",
      "Capabilities marked 每次需用户批准 (the default for a newly linked computer) work right away: just call the device_* tool; ChisaBot shows the person an approval prompt on that computer and on the web/phone, and the call returns once they approve (or is refused if they deny or nobody answers within 2 minutes). Say in one short line that they will see a prompt to approve; do not ask for permission in chat first. File tools only reach the computer's 允许的文件夹 (listed by device_list as allowedRoots); outside them use device_run_shell if it is available.",
      "A capability that is off was switched off by the person (命令行、读取文件、写入文件、截图、鼠标键盘、打开应用 / 网址、剪贴板). If a request needs one that is off, say which one and tell them they can set it to 询问 in 设置 → 设备 → the computer → 权限, then try again; do not pretend to have done it.",
    );
  } else {
    lines.push(
      "None of them is online right now, so you cannot operate them at this moment. If the person asks about their computer, say it is linked but not connected, give the name and when it was last online, and ask them to open ChisaBot PC on it (the tray icon turns blue when it is connected). If ChisaBot PC is open but it still shows offline, they can use the tray menu 「重新登记这台电脑」 or sign out and sign in again in ChisaBot PC.",
    );
  }
  return lines.join("\n");
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
  const onlineDevices = options.devices.filter((device) => hub.isOnline(device.id));
  const guidance = deviceGuidance(options.devices, (id) => hub.isOnline(id));

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
    return !capability || onlineDevices.some((device) => device.capabilities[capability] !== "off");
  };

  const tools: GrantedTool[] = [
    {
      name: "device_list",
      ref: "devices/list",
      description: `列出用户账号下关联的全部设备（ChisaBot PC / 手机客户端）及其在线状态和已开启的能力。这些设备由用户的所有机器人共用。被问到「能不能看到 / 用我的电脑」时先调用它。当前：${roster}`,
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
            lastSeenAt: device.lastSeenAt,
            lastSeen: hub.isOnline(device.id) ? "在线" : agoText(device.lastSeenAt),
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

  // 有关联设备但都不在线：只留 device_list（只读），让机器人能如实说「电脑已关联，但现在离线」，
  // 而不是因为什么工具都没有就说「我看不到你的电脑」。操作类工具等设备上线后才出现。
  if (!onlineDevices.length)
    return tools
      .filter((tool) => tool.name === "device_list")
      .map((tool) => ({ ...tool, guidance, initiator: options.initiator }));

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

  // 提示词只挂在 device_list 上：工具被筛掉时提示也跟着消失，不会告诉机器人它没拿到的东西。
  return tools.map((tool) => ({
    ...tool,
    ...(tool.name === "device_list" ? { guidance } : {}),
    initiator: options.initiator,
  }));
}
