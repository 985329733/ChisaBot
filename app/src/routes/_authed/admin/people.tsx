import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「人员与角色」页已删除：自用部署只有管理员 / 普通用户两种，由 INITIAL_ADMIN_EMAILS 决定（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/people")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
