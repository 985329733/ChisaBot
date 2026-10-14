import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「长期任务」页（Responsibilities，生产里 0 条）已从导航去掉，重定向到 设置 → 定时任务（DESIGN.md §57 导航收敛）。 */
export const Route = createFileRoute("/_authed/_app/responsibilities")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/schedules", replace: true });
  },
});
