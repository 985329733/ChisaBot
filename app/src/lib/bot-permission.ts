import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import type { BotPermissionMode, BotPermissionView } from "../../../shared/bot-permission";
import { client } from "@/lib/client";
import { confirmDialog } from "@/components/ui/confirm";

/** 机器人权限（输入框「请求批准 / 完全访问」，DESIGN.md §XX）。 */
export const botPermissionKeys = {
  all: ["bot-permission"] as const,
  one: (agentId: string) => ["bot-permission", agentId] as const,
};

export function botPermissionQueryOptions(agentId: string) {
  return queryOptions({
    queryKey: botPermissionKeys.one(agentId),
    enabled: Boolean(agentId),
    queryFn: ({ signal }): Promise<BotPermissionView> =>
      client(`/api/confirmations/bots/${encodeURIComponent(agentId)}/permission`, "permission", {
        fallback: "无法读取机器人权限",
        signal,
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function saveBotPermission(agentId: string, mode: BotPermissionMode, acknowledged = false): Promise<BotPermissionView> {
  return client(`/api/confirmations/bots/${encodeURIComponent(agentId)}/permission`, "permission", {
    method: "PUT",
    body: { mode, ...(mode === "full" ? { acknowledged } : {}) },
    fallback: "权限没保存上，请重试",
  });
}

/**
 * 切档位：切到「完全访问」先弹一次确认框（服务器也要求带 acknowledged），切回「请求批准」直接切。
 * 返回 false = 用户在确认框里取消了。
 */
export function useSetBotPermission(agentId: string, botName?: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: ["bot-permission", "save", agentId],
    mutationFn: ({ mode, acknowledged }: { mode: BotPermissionMode; acknowledged: boolean }) => saveBotPermission(agentId, mode, acknowledged),
    onSuccess: (view) => {
      queryClient.setQueryData(botPermissionKeys.one(agentId), view);
      void queryClient.invalidateQueries({ queryKey: ["confirmations", "bot-permissions"] });
    },
  });
  async function choose(mode: BotPermissionMode): Promise<boolean> {
    let acknowledged = false;
    if (mode === "full") {
      acknowledged = await confirmDialog({
        title: `给${botName ? `「${botName}」` : "这个机器人"}开完全访问？`,
        description:
          "开了以后，它在你的电脑上运行命令、读写文件、安装软件都不再问你，允许的文件夹以外的路径也会直接加进去。付款购买、设备上关闭的能力、紧急停止这些照旧拦着。随时可以在输入框左下角改回「请求批准」。",
        confirmLabel: "开启完全访问",
        destructive: true,
      });
      if (!acknowledged) return false;
    }
    await mutation.mutateAsync({ mode, acknowledged });
    return true;
  }
  return { choose, mutation };
}
