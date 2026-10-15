import { redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { deploymentCapabilitiesQueryOptions } from "./queries";

/**
 * 功能精简（2026-10-16，DESIGN.md §74）：默认隐藏的「额外」功能。
 *
 * 私人助手用不到、生产上没有数据、或者全是上游英文 / 演示内容的功能，入口默认不显示，直接打开旧地址回到 设置。
 * 代码、接口和数据都保留：部署设 `CHISABOT_EXTRAS=workflows,plugins,boundaries,components`（或 `all`）就恢复。
 */
export type ChisabotExtra = "workflows" | "plugins" | "boundaries" | "components";

/** 路由 `beforeLoad`：这项没打开就回到设置。读不到能力时也当没打开（关着是安全的那一边）。 */
export function requireExtra(extra: ChisabotExtra) {
  return async ({ context }: { context: { queryClient: QueryClient } }) => {
    const capabilities = await context.queryClient
      .ensureQueryData(deploymentCapabilitiesQueryOptions())
      .catch(() => null);
    if (!capabilities?.extras.includes(extra)) throw redirect({ to: "/settings", replace: true });
  };
}
