import { createFileRoute, Outlet } from "@tanstack/react-router";
import { GlassShell } from "@/components/layout/glass-shell";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";

export const Route = createFileRoute("/_authed/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <GlassShell scope="settings" sidebar={<SettingsSidebar className="glass-sidebar-container" />}>
      <Outlet />
    </GlassShell>
  );
}
