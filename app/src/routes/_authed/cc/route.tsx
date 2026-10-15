import { createFileRoute, Outlet } from "@tanstack/react-router";
import { CcSidebar } from "@/components/cloud-cc/cc-sidebar";
import { GlassShell } from "@/components/layout/glass-shell";

/** Claude Code 视图（ADR-0014，DESIGN.md §73）：同一个外壳，左栏换成工作区和会话，右栏（文件 / 改动）在会话页里。 */
export const Route = createFileRoute("/_authed/cc")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <GlassShell scope="app" sidebar={<CcSidebar className="glass-sidebar-container" />}>
      <Outlet />
    </GlassShell>
  );
}
