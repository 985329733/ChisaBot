import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「组件游乐场」页已删除：生成式界面只剩 render_ui（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/playground")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
