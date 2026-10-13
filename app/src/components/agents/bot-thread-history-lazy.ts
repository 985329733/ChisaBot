import { lazyDialog } from "@/components/ui/lazy-dialog";

/** 「历史对话」弹窗：用到才加载、打开过才挂载（DESIGN.md §41.3）；机器人 ⋯ 菜单打开时 preload()。 */
export const LazyBotThreadHistoryDialog = lazyDialog(() =>
  import("@/components/agents/bot-thread-history").then((m) => m.BotThreadHistoryDialog),
);
