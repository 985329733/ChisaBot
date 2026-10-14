import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「组件库」页已删除（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/settings/components-gallery")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
