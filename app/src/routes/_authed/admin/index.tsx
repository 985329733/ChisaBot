import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * 「部署概览」原来只是左栏链接的重复网格。2026-10-12 偏好设置与管理后台合并为一个「设置」后，
 * /admin 直接进入设置首页。
 */
export const Route = createFileRoute("/_authed/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
