/**
 * 机器人自己电脑上前台命令的超时（DESIGN.md §102）。
 *
 * 以前 computer_run_command 的工具参数只有 `command`：前台命令一律 120 秒被停，模型传 `timeoutSec`
 * 还会被严格校验拒掉（2026-10-18 真实 UI 长任务 L：机器人两次都退到云端工作区节点 device_run_shell 才跑完，
 * 还在用户的云端工作区里留下文件）。底层 agent-computer `/exec` 其实一直支持 `timeoutMs`，最多 600 秒。
 *
 * 现在两套工具（网页聊天、无人值守）都接受 `timeoutSec`（推荐）或 `timeoutMs`，在这里统一折算成毫秒：
 * - 默认 120 秒不变（大多数命令几秒就完，默认太长会让卡住的命令白等）。
 * - 上限 600 秒；超过的按 600 秒跑并在结果里说明（不拒绝：拒绝只会让模型换个工具绕路）。
 * - `timeoutMs` 小于 1000 时按「秒」理解：模型常把 300 写进 timeoutMs 意思是 300 秒，按毫秒就是 0.3 秒、
 *   命令还没开始就被停。
 */

export const COMMAND_DEFAULT_TIMEOUT_SEC = 120;
export const COMMAND_MAX_TIMEOUT_SEC = 600;
export const COMMAND_MIN_TIMEOUT_SEC = 1;

export type CommandTimeoutInput = {
  timeoutSec?: unknown;
  timeoutMs?: unknown;
};

export type CommandTimeout = {
  /** 交给 `/exec` 的毫秒数；没给超时就是 undefined（用默认 120 秒）。 */
  timeoutMs: number | undefined;
  /** 实际生效的秒数（含默认）。 */
  effectiveSec: number;
  /** 请求的值超出 1–600 秒、被收到边界上。 */
  clamped: boolean;
};

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** 把 `timeoutSec` / `timeoutMs` 折算成 `/exec` 接受的整数毫秒（1000–600000）。两个都给时 `timeoutSec` 优先。 */
export function normalizeCommandTimeout(input: CommandTimeoutInput): CommandTimeout {
  const sec = asNumber(input.timeoutSec);
  const ms = asNumber(input.timeoutMs);
  let requestedSec: number | undefined;
  if (sec !== undefined) requestedSec = sec;
  else if (ms !== undefined) requestedSec = ms < 1000 ? ms : ms / 1000;
  if (requestedSec === undefined || requestedSec <= 0)
    return { timeoutMs: undefined, effectiveSec: COMMAND_DEFAULT_TIMEOUT_SEC, clamped: false };
  const bounded = Math.min(Math.max(requestedSec, COMMAND_MIN_TIMEOUT_SEC), COMMAND_MAX_TIMEOUT_SEC);
  const timeoutMs = Math.round(bounded * 1000);
  return {
    timeoutMs,
    effectiveSec: timeoutMs / 1000,
    clamped: bounded !== requestedSec,
  };
}

/**
 * 命令被超时停掉时交回给机器人的说明。目的：不要原样重跑同一条命令（那只会在同一个点再被停一次），
 * 也不要悄悄换到用户的云端工作区设备去跑。
 */
export function commandTimeoutNote(effectiveSec: number): string {
  const sec = Math.round(effectiveSec);
  if (sec >= COMMAND_MAX_TIMEOUT_SEC)
    return (
      `The command was stopped after ${sec} seconds, the most a foreground command may run on your computer. ` +
      "Do not run the same command again in the foreground; it would be stopped at the same point. " +
      "For work that needs longer, start it in the background with output to a file " +
      "(e.g. `nohup python3 job.py > job.log 2>&1 &`), then check `job.log` with short commands until it finishes, " +
      "or tell the person it takes longer than one command may run."
    );
  return (
    `The command was stopped after ${sec} seconds because it hit its timeout (default ${COMMAND_DEFAULT_TIMEOUT_SEC} s). ` +
    `Do not repeat it unchanged. If it simply needs more time, run it once more with a larger timeoutSec (at most ${COMMAND_MAX_TIMEOUT_SEC}); ` +
    "if it may need longer than that, run it in the background with output to a file and check on it, or tell the person."
  );
}

/** 工具说明里关于超时的那一段（两套工具共用，说法一致）。 */
export const COMMAND_TIMEOUT_GUIDE =
  `A command is stopped after timeoutSec seconds: ${COMMAND_DEFAULT_TIMEOUT_SEC} by default, at most ${COMMAND_MAX_TIMEOUT_SEC}. ` +
  "For anything that may take longer than about a minute (a long script, a build, a big download or install), " +
  "pass a larger timeoutSec up front, e.g. 300 for a job of about 4 minutes, so it can finish in the foreground on your own computer. " +
  `Beyond ${COMMAND_MAX_TIMEOUT_SEC} seconds, start it in the background (nohup … > log 2>&1 &) and check the log. ` +
  "If a result says timedOut, do not rerun the same command unchanged.";
