import { createFileRoute, redirect } from "@tanstack/react-router";

/** 旧的管理员设备页已删除：设备在 设置 → 设备（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/devices")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/devices", replace: true });
  },
});
