/**
 * Browser-activity epoch used by surfaces that auto-open the live screen once per run.
 */

const QUIET_GAP_MS = 10_000;

type Activity = { botId: string; epoch: number };

let epoch = 0;
let lastAt = 0;
let lastBot: string | null = null;
const listeners = new Set<(activity: Activity) => void>();

/** Called wherever a Bot's computer is reached, so auto-open surfaces share one activity source. */
export function reportComputerActivity(botId: string): void {
  const now = Date.now();
  // A different Bot is always a new run, however recently the last one acted.
  if (botId !== lastBot || now - lastAt > QUIET_GAP_MS) epoch += 1;
  lastAt = now;
  lastBot = botId;
  const activity = { botId, epoch };
  for (const listener of listeners) listener(activity);
}

export function onComputerActivity(
  listener: (activity: Activity) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 计算机卡片顶部的状态行（「正在打开 example.com…」「正在填写表单…」），像 Hark 的浏览器卡片一样告诉
 * 用户机器人此刻在做什么。由 callComputer 在每个动作开始 / 结束时写入；`useComputerStatus` 读。
 */
export type ComputerStatus = { botId: string; label: string; pending: boolean; at: number };
let status: ComputerStatus | null = null;
const statusListeners = new Set<(s: ComputerStatus | null) => void>();

function hostOf(url: unknown): string {
  if (typeof url !== "string") return "网页";
  try {
    const u = new URL(url);
    if (u.hostname === "workspace.local") return `工作区的 ${decodeURIComponent(u.pathname.replace(/^\//, "")) || "页面"}`;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

/** 把一次计算机调用翻成一句人话。返回 null 的调用（控制权查询等）不改状态行。 */
export function describeComputerCall(path: string, body: unknown): string | null {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (path.startsWith("/navigate")) return `正在打开 ${hostOf(b.url)}`;
  if (path.startsWith("/snapshot")) return "正在查看页面上的按钮和输入框";
  if (path.startsWith("/read")) return "正在阅读页面";
  if (path.startsWith("/type")) return "正在填写";
  if (path.startsWith("/click")) return "正在点击";
  if (path.startsWith("/key")) return "正在按键";
  if (path.startsWith("/scroll")) return "正在滚动页面";
  if (path.startsWith("/files/write")) return `正在写文件${typeof b.path === "string" ? ` ${b.path}` : ""}`;
  if (path.startsWith("/files/read")) return "正在读文件";
  if (path.startsWith("/files/list")) return "正在查看工作区";
  if (path.startsWith("/exec")) return "正在运行命令";
  if (path.startsWith("/control/request")) return "正在请你帮忙";
  return null;
}

export function reportComputerStatus(botId: string, label: string, pending: boolean): void {
  status = { botId, label, pending, at: Date.now() };
  for (const listener of statusListeners) listener(status);
}

export function currentComputerStatus(): ComputerStatus | null {
  return status;
}

export function onComputerStatus(listener: (s: ComputerStatus | null) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
