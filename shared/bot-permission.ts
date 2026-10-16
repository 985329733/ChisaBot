/**
 * 机器人权限：输入框里的「请求批准 / 完全访问」（DESIGN.md §97）。服务器（server/src/confirmations）和网页共用。
 *
 * 每个机器人一个开关（按「谁的设备 / 谁的审批」分人存，表 chisabot_bot_permissions）：
 * - ask  请求批准：在电脑上运行命令、改写文件、安装软件这类敏感操作，始终先问你（设备能力是「询问」的那些）；
 * - full 完全访问：上面这些不再问，机器人直接做；允许的文件夹以外的路径也直接加进去再做（写审计）。
 * - 没设过（null）：沿用 设置 → 权限与审批 里「操作你的电脑」那一类的偏好（旧行为，不动现有数据）。
 *
 * 完全访问从不放宽硬性限制：设备能力「关闭」、紧急停止 / 撤销、管理员身份运行（只在设备自己的完全访问下）、
 * 付款购买（一律先问）、权限规则里禁止的事、PC 本机的「强制本机审批」，以及用户写的带关键词的「先问我」规则，都照旧。
 */
export const BOT_PERMISSION_MODES = ["ask", "full"] as const;
export type BotPermissionMode = (typeof BOT_PERMISSION_MODES)[number];

export const BOT_PERMISSION_INFO: Record<BotPermissionMode, { label: string; short: string; description: string }> = {
  ask: {
    label: "请求批准",
    short: "请求批准",
    description: "运行命令、改写电脑上的文件、安装软件等敏感操作，始终先问你",
  },
  full: {
    label: "完全访问",
    short: "完全访问",
    description: "机器人可直接执行命令和读写电脑上的文件，不再询问",
  },
};

export type BotPermissionView = {
  agentId: string;
  /** 现在实际生效的档位。 */
  mode: BotPermissionMode;
  /** 用户给这个机器人存过的档位；null = 没设过，沿用审批偏好里「操作你的电脑」。 */
  stored: BotPermissionMode | null;
  updatedAt: string | null;
};

/** 打开完全访问时，PUT 必须带上 `acknowledged: true`（网页上的一次性确认框点过「开启」）。 */
export type BotPermissionInput = { mode: BotPermissionMode; acknowledged?: boolean };
