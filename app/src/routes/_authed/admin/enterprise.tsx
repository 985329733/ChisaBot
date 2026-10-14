import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「企业控制」页已删除（SSO 强制、成员能力开关、网络策略都不适用于私人助手）（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/enterprise")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
