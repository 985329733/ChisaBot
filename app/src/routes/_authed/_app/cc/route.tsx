import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CcSyncWatcher } from "@/components/cloud-cc/cc-sync";

/**
 * Claude Code 视图（ADR-0014，DESIGN.md §73 / §84）：挂在 `_app` 下面，和机器人共用同一个外壳。
 * 左栏由 `_app` 的 `LeftRail` 按地址切换内容（外壳、顶栏、左栏容器都不重新挂载）；右栏（文件 / 改动）在会话页里。
 */
export const Route = createFileRoute("/_authed/_app/cc")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <>
      <Outlet />
      <CcSyncWatcher />
    </>
  );
}
