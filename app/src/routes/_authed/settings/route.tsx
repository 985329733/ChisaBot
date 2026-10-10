import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import { ShellBoundary } from "@/components/startup-status";

export const Route = createFileRoute("/_authed/settings")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <SidebarShell width="300px">
      <SettingsSidebar />
      <main className="flex-1">
        <ShellBoundary>
          <Outlet />
        </ShellBoundary>
      </main>
    </SidebarShell>
  );
}
