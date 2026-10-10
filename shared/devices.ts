/**
 * ChisaBot 设备（PC 节点）的共享类型与能力表。服务器、网页和 PC 客户端读同一份定义。
 * 设计见 docs/pc-node.md。
 */

/** 可单独开关的能力。system_info（只读基本信息）不算能力，始终可用并照常审计。 */
export const DEVICE_CAPABILITIES = [
  "shell",
  "files_read",
  "files_write",
  "screenshot",
  "input",
  "open",
  "clipboard",
] as const;

export type DeviceCapability = (typeof DEVICE_CAPABILITIES)[number];

/** off：关闭；ask：每次在 PC 或网页上审批；allow：直接执行（仍审计）。 */
export type CapabilityPolicy = "off" | "ask" | "allow";

export type DeviceCapabilities = Record<DeviceCapability, CapabilityPolicy>;

export const CAPABILITY_INFO: Record<
  DeviceCapability,
  { label: string; description: string; dangerous: boolean }
> = {
  shell: {
    label: "命令行",
    description: "在这台电脑上运行 PowerShell 命令（有超时和输出上限）。",
    dangerous: true,
  },
  files_read: {
    label: "读取文件",
    description: "列出和读取「允许的文件夹」里的文件。",
    dangerous: false,
  },
  files_write: {
    label: "写入文件",
    description: "在「允许的文件夹」里新建或修改文件，覆盖前自动备份。",
    dangerous: true,
  },
  screenshot: {
    label: "截图",
    description: "截取屏幕画面发给机器人。",
    dangerous: false,
  },
  input: {
    label: "鼠标键盘",
    description: "移动鼠标、点击、输入文字和按键。",
    dangerous: true,
  },
  open: {
    label: "打开应用 / 网址",
    description: "用默认浏览器打开网址，或启动应用程序。",
    dangerous: false,
  },
  clipboard: {
    label: "剪贴板",
    description: "读取或写入剪贴板文字。",
    dangerous: false,
  },
};

export function defaultCapabilities(): DeviceCapabilities {
  return Object.fromEntries(
    DEVICE_CAPABILITIES.map((capability) => [capability, "off"]),
  ) as DeviceCapabilities;
}

export function normalizeCapabilities(value: unknown): DeviceCapabilities {
  const result = defaultCapabilities();
  if (!value || typeof value !== "object") return result;
  for (const capability of DEVICE_CAPABILITIES) {
    const policy = (value as Record<string, unknown>)[capability];
    if (policy === "off" || policy === "ask" || policy === "allow")
      result[capability] = policy;
  }
  return result;
}

/** 每个设备操作需要的能力；system_info 为 null（始终可用）。 */
export const OPERATION_CAPABILITY: Record<DeviceOperation, DeviceCapability | null> = {
  system_info: null,
  shell: "shell",
  list_files: "files_read",
  read_file: "files_read",
  write_file: "files_write",
  screenshot: "screenshot",
  input: "input",
  open: "open",
  clipboard_read: "clipboard",
  clipboard_write: "clipboard",
};

export type DeviceOperation =
  | "system_info"
  | "shell"
  | "list_files"
  | "read_file"
  | "write_file"
  | "screenshot"
  | "input"
  | "open"
  | "clipboard_read"
  | "clipboard_write";

export const OPERATION_LABEL: Record<DeviceOperation, string> = {
  system_info: "读取系统信息",
  shell: "运行命令",
  list_files: "列出文件",
  read_file: "读取文件",
  write_file: "写入文件",
  screenshot: "截图",
  input: "鼠标键盘",
  open: "打开应用 / 网址",
  clipboard_read: "读取剪贴板",
  clipboard_write: "写入剪贴板",
};

/** 网页 / PC 看到的设备。不含令牌。 */
export type DeviceView = {
  id: string;
  ownerUserId: string;
  name: string;
  platform: string;
  osVersion: string | null;
  hostname: string | null;
  arch: string | null;
  clientVersion: string | null;
  capabilities: DeviceCapabilities;
  allowedRoots: string[];
  /** 紧急停止：为 true 时拒绝一切远程操作。 */
  paused: boolean;
  revoked: boolean;
  online: boolean;
  lastSeenAt: string | null;
  lastIp: string | null;
  createdAt: string;
  /** 允许使用这台设备的机器人 id。 */
  botIds: string[];
};

export type DeviceAuditEntry = {
  id: string;
  deviceId: string;
  at: string;
  actorType: "bot" | "user" | "device" | "system";
  actorId: string | null;
  actorName: string | null;
  action: string;
  summary: string | null;
  outcome: string;
  detail: string | null;
  durationMs: number | null;
};

export type DeviceApprovalView = {
  id: string;
  deviceId: string;
  deviceName: string;
  botId: string;
  botName: string | null;
  operation: DeviceOperation;
  summary: string;
  createdAt: string;
  expiresAt: string;
};

/** WebSocket 协议（PC → 服务器）。 */
export type DeviceToServer =
  | {
      type: "hello";
      clientVersion?: string;
      platform?: string;
      osVersion?: string;
      hostname?: string;
      arch?: string;
    }
  | { type: "result"; id: string; ok: boolean; result?: unknown; error?: string }
  | { type: "approval"; id: string; decision: "approve" | "deny" }
  | {
      type: "set_config";
      name?: string;
      capabilities?: Partial<DeviceCapabilities>;
      allowedRoots?: string[];
      paused?: boolean;
    }
  | { type: "local_audit"; action: string; outcome: string; summary?: string }
  | { type: "pong" };

/** WebSocket 协议（服务器 → PC）。 */
export type ServerToDevice =
  | { type: "welcome"; device: DeviceView; serverTime: string }
  | { type: "config"; device: DeviceView }
  | {
      type: "approval_request";
      id: string;
      operation: DeviceOperation;
      summary: string;
      botName: string | null;
      expiresAt: string;
      /** 按服务器时钟算的剩余毫秒数（PC 时钟可能不准，倒数用它）。 */
      remainingMs?: number;
    }
  | { type: "approval_closed"; id: string; decision: "approve" | "deny" | "expired" }
  | {
      type: "call";
      id: string;
      operation: DeviceOperation;
      args: Record<string, unknown>;
      botName: string | null;
      timeoutMs: number;
    }
  | { type: "cancel"; id: string }
  | { type: "revoked" }
  | { type: "ping" };
