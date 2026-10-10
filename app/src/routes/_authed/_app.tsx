import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar/app-sidebar";
import { GlassTopBar } from "@/components/layout/glass-topbar";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { TopBarOwnsSidebarToggle } from "@/components/layout/sidebar-toggle";
import { PanelRail } from "@/components/panels/panel-rail";
import { ShellBoundary } from "@/components/startup-status";

/** Route chunks the avatar menu leads to, fetched once the app is idle so those clicks never wait. */
const IDLE_PRELOAD = ["/_authed/settings", "/_authed/settings/passwords", "/_authed/admin"] as const;

function useIdleRoutePreload() {
  const router = useRouter();
  useEffect(() => {
    const run = () => {
      for (const id of IDLE_PRELOAD) {
        const route = (router.routesById as unknown as Record<string, unknown>)[id];
        if (route) void router.loadRouteChunk(route as Parameters<typeof router.loadRouteChunk>[0])?.catch(() => {});
      }
    };
    const idle = window.requestIdleCallback?.(run, { timeout: 4000 });
    const timer = idle === undefined ? window.setTimeout(run, 2500) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [router]);
}

export const Route = createFileRoute("/_authed/_app")({
  component: RouteComponent,
});

function RouteComponent() {
  useIdleRoutePreload();
  return (
    // One viewport, never scrolls: panes scroll inside it. The top bar is fixed; the left roster is
    // the shadcn sidebar offset below it; the right column holds the current Bot's custom panels.
    <TopBarOwnsSidebarToggle.Provider value={true}>
    <SidebarShell className="glass-shell h-svh overflow-hidden" iconWidth="80px" width="276px">
      <GlassTopBar />
      <AppSidebar className="glass-sidebar-container" />
      <div className="glass-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <main className="glass-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SelfHostBanner />
          <ShellBoundary>
            <Outlet />
          </ShellBoundary>
        </main>
        <PanelRail />
      </div>
    </SidebarShell>
    </TopBarOwnsSidebarToggle.Provider>
  );
}
