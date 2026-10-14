import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  ACTIVE_LOCAL_TASK,
  type DeviceAgentSettings,
  LOCAL_AGENT_RESULT_MARKER,
  type LocalAgentLine,
  type LocalAgentTaskView,
} from "../../../shared/local-agents";

/**
 * 本地 agent（docs/local-agents.md；服务器 server/src/local-agents/service.ts）在界面上的数据：
 * 对话里的任务卡片（有任务在跑时每 1.2 秒取一次）、设备的档位 / 本地 agent 设置。
 */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

export const localAgentKeys = {
  thread: (threadId: string) => ["local-agent-tasks", threadId] as const,
  device: (deviceId: string) => ["local-agent-device", deviceId] as const,
  task: (taskId: string) => ["local-agent-task", taskId] as const,
};

export function useThreadLocalTasks(threadId: string | null | undefined) {
  return useQuery({
    queryKey: localAgentKeys.thread(threadId ?? ""),
    enabled: Boolean(threadId),
    queryFn: async (): Promise<LocalAgentTaskView[]> => {
      try {
        return (await call<{ tasks: LocalAgentTaskView[] }>(`/api/local-agents/threads/${encodeURIComponent(threadId!)}/tasks`)).tasks ?? [];
      } catch {
        return [];
      }
    },
    refetchInterval: (query) => ((query.state.data ?? []).some((task) => ACTIVE_LOCAL_TASK.includes(task.status)) ? 1200 : false),
    refetchOnWindowFocus: true,
    staleTime: 800,
  });
}

export type FullLocalTask = LocalAgentTaskView & { task: string; transcript: LocalAgentLine[] };

export function localTaskQueryOptions(taskId: string) {
  return queryOptions({
    queryKey: localAgentKeys.task(taskId),
    queryFn: async () => (await call<{ task: FullLocalTask }>(`/api/local-agents/tasks/${encodeURIComponent(taskId)}`)).task,
    staleTime: 1000,
  });
}

/** 停止 / 应用改动 / 放弃改动。完成后刷新卡片。 */
export function useLocalTaskAction(threadId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useCallback(
    async (taskId: string, action: "stop" | "apply" | "discard") => {
      const result = await call<{ task: LocalAgentTaskView }>(`/api/local-agents/tasks/${encodeURIComponent(taskId)}/${action}`, { method: "POST", body: "{}" });
      if (threadId) await queryClient.invalidateQueries({ queryKey: localAgentKeys.thread(threadId) });
      await queryClient.invalidateQueries({ queryKey: localAgentKeys.task(taskId) });
      return result.task;
    },
    [threadId, queryClient],
  );
}

export type DeviceAgentState = {
  settings: DeviceAgentSettings;
  effectiveRoots: string[];
  online: boolean;
  tasks: LocalAgentTaskView[];
};

export function deviceAgentQueryOptions(deviceId: string) {
  return queryOptions({
    queryKey: localAgentKeys.device(deviceId),
    queryFn: () => call<DeviceAgentState>(`/api/local-agents/devices/${encodeURIComponent(deviceId)}`),
    staleTime: 3000,
  });
}

export async function saveDeviceAgent(deviceId: string, patch: Partial<Omit<DeviceAgentSettings, "deviceId" | "detected" | "saved" | "updatedAt">>) {
  return (await call<{ settings: DeviceAgentSettings }>(`/api/local-agents/devices/${encodeURIComponent(deviceId)}`, { method: "PUT", body: JSON.stringify(patch) })).settings;
}

export async function redetectDeviceAgents(deviceId: string) {
  return call<{ sent: boolean }>(`/api/local-agents/devices/${encodeURIComponent(deviceId)}/detect`, { method: "POST", body: "{}" });
}

/** 设备的审批（同 设置 → 设备 的「等待你审批」）：任务卡片上直接允许 / 拒绝。 */
export async function decideDeviceApproval(approvalId: string, decision: "approve" | "deny") {
  return call<unknown>(`/api/devices/approvals/${encodeURIComponent(approvalId)}`, { method: "POST", body: JSON.stringify({ decision }) });
}

/** 「⟦chisabot:local-agent-result:<id>:<status>⟧\n标题行\n\n正文」拆开。 */
export function parseLocalAgentResult(text: string): { taskId: string; status: string; headline: string; body: string } | null {
  if (!text.startsWith(LOCAL_AGENT_RESULT_MARKER)) return null;
  const end = text.indexOf("⟧");
  if (end < 0) return null;
  const [taskId = "", status = ""] = text.slice(LOCAL_AGENT_RESULT_MARKER.length, end).split(":");
  const rest = text.slice(end + 1).replace(/^\n/, "");
  const [headline = "", ...lines] = rest.split("\n");
  return { taskId, status, headline: headline.trim(), body: lines.join("\n").trim() };
}

export { LOCAL_AGENT_RESULT_MARKER };
