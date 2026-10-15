import { describeWorkerStep } from "../../../../shared/work-step";

/**
 * 主对话这一轮干了哪些活（DESIGN.md §70 干活卡）：从这一轮的工具调用里数步骤、取「当前步骤」那一行。
 * 只认结构 `{ name, arguments }`，不依赖聊天记录的具体类型，方便单测。
 */
export type WorkCall = { name: string; arguments: string; done: boolean };

export type WorkSummary = { count: number; done: number; current: string };

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    // 流式时参数还没写完：先当没有参数，下一次渲染再读。
    return {};
  }
}

export function summarizeWork(calls: readonly WorkCall[]): WorkSummary | null {
  if (calls.length === 0) return null;
  let current = "";
  for (let i = calls.length - 1; i >= 0 && !current; i--) {
    const call = calls[i]!;
    current = describeWorkerStep(call.name, parseArgs(call.arguments)) ?? "";
  }
  return {
    count: calls.length,
    done: calls.filter((call) => call.done).length,
    current: current || "正在处理",
  };
}
