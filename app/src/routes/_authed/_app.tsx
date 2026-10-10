import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppSidebar } from "@/components/app-sidebar/app-sidebar";
import { GlassTopBar } from "@/components/layout/glass-topbar";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { PanelRail } from "@/components/panels/panel-rail";

export const Route = createFileRoute("/_authed/_app")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    // One viewport, never scrolls: panes scroll inside it. The top bar is fixed; the left roster is
    // the shadcn sidebar offset below it; the right column holds the current Bot's custom panels.
    <SidebarShell className="glass-shell h-svh overflow-hidden" width="276px">
      <GlassTopBar />
      <AppSidebar className="glass-sidebar-container" />
      <div className="glass-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="glass-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SelfHostBanner />
          <Outlet />
        </main>
        <PanelRail />
      </div>
    </SidebarShell>
  );
}
