import { createFileRoute, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { GlassShell } from "@/components/layout/glass-shell";
import { LeftRail } from "@/components/layout/left-rail";
import { SelfHostBanner } from "@/components/layout/self-host-banner";
import { PanelRail } from "@/components/panels/panel-rail";
import { type LeftMode, modeOfPath, rememberBotsLocation } from "@/lib/left-mode";

/** Route chunks the avatar menu leads to, fetched once the app is idle so those clicks never wait. */
const IDLE_PRELOAD = ["/_authed/settings", "/_authed/settings/connected-accounts/", "/_authed/admin"] as const;

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

/**
 * 机器人和 Claude Code（`/cc`）共用这一个外壳（DESIGN.md §84）：切换时外壳、顶栏、左栏容器都留在原地，
 * 只换左栏内容（`LeftRail` 交叉淡入）和主区（淡入一次）；右边的面板卡只属于机器人。
 */
function RouteComponent() {
  useIdleRoutePreload();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search });
  const mode = modeOfPath(pathname);
  useEffect(() => {
    rememberBotsLocation(pathname, search as Record<string, unknown>);
  }, [pathname, search]);
  const switched = useModeSwitched(mode);
  return (
    // The left roster is Bots only (主机器人 pinned); conversation search lives in the top bar.
    <GlassShell
      banner={<SelfHostBanner />}
      mode={switched ? mode : undefined}
      right={mode === "bots" ? <PanelRail /> : undefined}
      scope="app"
      sidebar={<LeftRail className="glass-sidebar-container" mode={mode} />}
    >
      <Outlet />
    </GlassShell>
  );
}

/** 第一次切换之后才给主区加淡入（打开应用时不闪一下）。 */
function useModeSwitched(mode: LeftMode) {
  const first = useRef(mode);
  const [switched, setSwitched] = useState(false);
  if (!switched && mode !== first.current) setSwitched(true);
  return switched;
}
