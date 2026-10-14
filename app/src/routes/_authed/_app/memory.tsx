import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游旧记忆页（个人记忆 + 后台研究）已由 设置 → 记忆（DESIGN.md §50）取代，重定向过去（§57 导航收敛）。 */
export const Route = createFileRoute("/_authed/_app/memory")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/memory", replace: true });
  },
});
