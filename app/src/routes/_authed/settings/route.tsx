import { createFileRoute, Outlet } from "@tanstack/react-router";

/** 外壳（设置左栏）由 `_authed` 的 `AuthedShell` 画（DESIGN.md §98）：切回聊天时外壳和聊天都不重新挂载。 */
export const Route = createFileRoute("/_authed/settings")({
  component: Outlet,
});
