import { queryOptions } from "@tanstack/react-query";
import type { SystemUpdateAction, SystemUpdateOverview } from "../../../shared/system-update";
import { client } from "@/lib/client";

/** 管理后台 → 系统更新（docs/online-update.md）。 */
export const systemUpdateKeys = { overview: ["system-update", "overview"] as const };

export async function loadSystemUpdate(signal?: AbortSignal): Promise<SystemUpdateOverview> {
  const response = await client("/api/admin/system-update", {
    fallback: "无法读取系统更新状态，请重试。",
    signal,
  });
  return response.json();
}

export function systemUpdateQueryOptions() {
  return queryOptions({
    queryKey: systemUpdateKeys.overview,
    queryFn: ({ signal }) => loadSystemUpdate(signal),
    staleTime: 2_000,
    // 有任务在跑时每 2 秒看一次进度，平时每 30 秒。
    refetchInterval: (query) => {
      const data = query.state.data;
      const active =
        !!data &&
        (data.pending.length > 0 || data.job?.status === "running" || data.job?.status === "queued");
      return active ? 2_000 : 30_000;
    },
    refetchOnWindowFocus: "always",
  });
}

export async function requestSystemUpdate(
  action: SystemUpdateAction,
  expectCommit?: string,
): Promise<{ id: string; overview: SystemUpdateOverview }> {
  const response = await client(`/api/admin/system-update/${action}`, {
    method: "POST",
    body: action === "update" && expectCommit ? { expectCommit } : {},
    fallback: action === "update" ? "无法开始更新。" : action === "rollback" ? "无法开始回滚。" : "无法检查更新。",
  });
  return response.json();
}

export function shortSha(sha?: string) {
  return sha ? sha.slice(0, 7) : "—";
}

export function timeText(at?: string) {
  if (!at) return "—";
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
