import { createFileRoute, Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar/app-sidebar";
import { GlassShell } from "@/components/layout/glass-shell";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { PanelRail } from "@/components/panels/panel-rail";

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
    // The left roster is Bots only (主机器人 pinned); conversation search lives in the top bar.
    <GlassShell
      banner={<SelfHostBanner />}
      right={<PanelRail />}
      scope="app"
      sidebar={<AppSidebar className="glass-sidebar-container" />}
    >
      <Outlet />
    </GlassShell>
  );
}
