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

/** 不算「干活」的工具：画卡片、维护清单（结束后的一行里不数它们）。 */
const NOT_WORK = new Set(["render_ui", "worker_plan"]);

export type DoneWork = { label: string; steps: string[] };

/**
 * 一轮结束后收成的一行（DESIGN.md §70.2）：「搜索 2 次 · 看了 3 个网页」/「做了 5 步」，点开是每一步。
 * 只数真的干活的工具；一步都没有返回 null（不出这一行）。
 */
export function summarizeDoneWork(calls: readonly WorkCall[]): DoneWork | null {
  const work = calls.filter((call) => !NOT_WORK.has(call.name));
  if (work.length === 0) return null;
  let searches = 0;
  let pages = 0;
  const steps: string[] = [];
  for (const call of work) {
    if (call.name === "web_search") searches += 1;
    else if (call.name === "web_fetch" || call.name === "computer_navigate") pages += 1;
    const line = describeWorkerStep(call.name, parseArgs(call.arguments));
    if (!line) continue;
    const past = line.replace(/^正在/, "");
    if (steps[steps.length - 1] !== past) steps.push(past);
  }
  const webOnly = searches + pages === work.length;
  const label = webOnly
    ? [searches ? `搜索 ${searches} 次` : "", pages ? `看了 ${pages} 个网页` : ""].filter(Boolean).join(" · ")
    : `做了 ${work.length} 步`;
  return { label, steps };
}
