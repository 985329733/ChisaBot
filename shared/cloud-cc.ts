/**
 * 云端 Claude Code（docs/cloud-claude-code.md，ADR-0014）：服务器和网页共用的类型。
 */

export type ClaudeAuth = {
  loggedIn: boolean;
  email: string | null;
  plan: string | null;
  method: string | null;
  checkedAt: string | null;
  error?: string | null;
};

export type CloudWorkspaceView = {
  /** 没有配对云端节点时为 null。 */
  node: {
    deviceId: string;
    name: string;
    online: boolean;
    claudeVersion: string | null;
    lastSeenAt: string | null;
  } | null;
  claude: ClaudeAuth;
  running: number;
  maxConcurrent: number;
};

export type CcLoginStart = { id: string; url: string; expiresAt: string };

export type CcSyncState = "cloud_only" | "syncing" | "pc_active" | "paused" | "conflict";
export const SYNC_STATE_ZH: Record<CcSyncState, string> = {
  cloud_only: "仅云端",
  syncing: "同步中",
  pc_active: "PC 正在使用",
  paused: "已暂停",
  conflict: "冲突",
};

export type CcSessionStatus = "idle" | "running" | "waiting" | "error";

export type CcSessionView = {
  id: string;
  workspaceId: string;
  title: string;
  status: CcSessionStatus;
  branch: string | null;
  model: string | null;
  effort: string | null;
  turns: number;
  resumable: boolean;
  lastTurnAt: string | null;
  createdAt: string;
  lastError: string | null;
};

export type CcWorkspaceView = {
  id: string;
  name: string;
  source: "scratch" | "github" | "local";
  sourceLabel: string;
  repoFullName: string | null;
  isGit: boolean;
  syncState: CcSyncState;
  sessions: CcSessionView[];
};

export type CcToolStatus = "running" | "done" | "error" | "denied";
export type CcApprovalState = "pending" | "approved" | "denied" | "expired";

export type CcPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string | null; name: string; input: Record<string, unknown>; status: CcToolStatus; result?: string; reason?: string }
  | {
      type: "approval";
      id: string;
      tool: string;
      summary: string;
      input: Record<string, unknown>;
      canAlways: boolean;
      state: CcApprovalState;
      always?: boolean;
      expiresAt: string;
    }
  | { type: "changes"; turnId: string; files: CcChangedFile[] }
  | { type: "error"; text: string }
  | { type: "notice"; text: string };

export type CcChangedFile = { path: string; add: number | null; del: number | null; status: string };

export type CcMessage = {
  id: string;
  turnId: string | null;
  role: "user" | "assistant" | "system";
  parts: CcPart[];
  status: "done" | "running" | "stopped" | "error" | "queued";
  meta: { costUsd?: number | null; turns?: number | null; undone?: boolean; durationMs?: number | null } | null;
  createdAt: string;
};

/** 会话流（GET /api/claude-code/sessions/:id/stream）里的一条。 */
export type CcStreamOp =
  | { op: "snapshot"; seq: number; message: CcMessage | null; status: CcSessionStatus; statusText: string | null }
  | { op: "text"; seq: number; messageId: string; index: number; append: string }
  | { op: "part"; seq: number; messageId: string; index: number; part: CcPart }
  | { op: "status"; seq: number; text: string | null; status: CcSessionStatus }
  | { op: "done"; seq: number; message: CcMessage }
  | { op: "message"; seq: number; message: CcMessage };

export type CcTreeEntry = { name: string; dir: boolean; size: number | null };

export const CC_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const CC_EFFORT_ZH: Record<string, string> = { low: "低", medium: "中", high: "高", xhigh: "很高", max: "最高" };
export const CC_MODELS = [
  { id: "", label: "默认模型" },
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
] as const;

/** 工具名 → 干活行的中文说法。 */
export function ccToolLine(name: string, input: Record<string, unknown>): string {
  const file = String(input.file_path ?? input.path ?? input.notebook_path ?? "");
  const short = file ? file.split("/").slice(-2).join("/") : "";
  switch (name) {
    case "Read":
      return `读取 ${short || "文件"}`;
    case "Write":
      return `写入 ${short || "文件"}`;
    case "Edit":
    case "MultiEdit":
      return `修改 ${short || "文件"}`;
    case "Grep":
      return `搜索「${String(input.pattern ?? "").slice(0, 40)}」`;
    case "Glob":
      return `查找文件 ${String(input.pattern ?? "").slice(0, 40)}`;
    case "LS":
      return `列出 ${short || "目录"}`;
    case "Bash":
      return `运行 ${String(input.command ?? "").slice(0, 80)}`;
    case "WebFetch":
      return `打开网页 ${String(input.url ?? "").slice(0, 60)}`;
    case "WebSearch":
      return `搜索网页「${String(input.query ?? "").slice(0, 40)}」`;
    case "TodoWrite":
      return "更新待办清单";
    case "Task":
    case "Agent":
      return `交给子 agent：${String(input.description ?? "").slice(0, 40)}`;
    default:
      return `使用 ${name}`;
  }
}
