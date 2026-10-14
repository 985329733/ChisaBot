import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「身份提供者 / SSO」页已删除：登录由网关负责（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/identity-providers")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", replace: true });
  },
});
