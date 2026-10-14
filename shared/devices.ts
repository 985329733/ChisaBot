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
    description: "在这台电脑上运行命令（Windows 用 PowerShell，macOS / Linux 用 sh），有超时和输出上限。",
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

/**
 * 新登记电脑的初始权限（2026-10-14 起）：全部「询问」——机器人一开口就能用，每次操作在 PC 弹窗或网页上批准，
 * 高风险操作还要 PC 本机确认。以前默认全部「关闭」，用户不进 设置 → 设备 → 权限 就什么都做不了，
 * 机器人也只会说「请去打开能力」（用户报告「桌面端还是不能操作本地」）。「关闭」仍可随时设置。
 * normalizeCapabilities 缺字段时仍按「关闭」补，安全兜底不变。
 */
export function initialCapabilities(): DeviceCapabilities {
  return Object.fromEntries(
    DEVICE_CAPABILITIES.map((capability) => [capability, "ask"]),
  ) as DeviceCapabilities;
}

/** 能力是不是还停在旧版出厂值（全部关闭）。 */
export function isFactoryOff(capabilities: DeviceCapabilities): boolean {
  return DEVICE_CAPABILITIES.every((capability) => capabilities[capability] === "off");
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

/**
 * 手机扫码绑定（DESIGN.md §33）：二维码内容 `chisabot://pair?server=<https 源>&code=<一次性绑定码>`。
 * Android 端 Pairing.kt 解析同一格式。
 */
export function pairingUri(server: string, code: string): string {
  return `chisabot://pair?server=${encodeURIComponent(server)}&code=${encodeURIComponent(code)}`;
}

/** 手机设备只用来登录聊天，不是机器人可操作的节点（不进设备工具、不接 /agent/ws）。 */
export const MOBILE_PLATFORMS: readonly string[] = ["android", "ios"];
export function isMobilePlatform(platform: string | null | undefined): boolean {
  return !!platform && MOBILE_PLATFORMS.includes(platform);
}
/** 手机最近一次会话校验在这个时间内 = 显示「在线」（网关约每 30 秒校验一次）。 */
export const MOBILE_ONLINE_WINDOW_MS = 3 * 60_000;

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
  /**
   * 旧版「按机器人授权」留下的列表，已不再起作用：从 2026-10 起设备属于账号，用户的每个机器人都能使用
   * 在线设备（仍受能力开关、允许的文件夹、审批、紧急停止限制）。保留字段只为兼容旧客户端。
   */
  botIds: string[];
  /** 最近一次由机器人发起的操作（来自设备审计记录）；从未被机器人用过为 null。 */
  lastUsedBy: { botId: string | null; botName: string | null; at: string } | null;
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
      /**
       * PC 0.1.7 起：建议的默认「允许的文件夹」（桌面、文档、下载）。服务器只在这台电脑的文件夹列表为空、
       * 而且从没被人改过配置时采用，之后以用户设置为准。
       */
      suggestedRoots?: string[];
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
