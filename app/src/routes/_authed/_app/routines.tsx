import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游 Routines 列表（生产里 0 条）由 设置 → 定时任务（DESIGN.md §55）取代，重定向过去（§57 导航收敛）。 */
export const Route = createFileRoute("/_authed/_app/routines")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/schedules", replace: true });
  },
});
