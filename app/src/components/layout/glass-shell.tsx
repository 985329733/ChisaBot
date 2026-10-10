import type { ReactNode } from "react";
import { GlassTopBar, type ShellScope } from "@/components/layout/glass-topbar";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { TopBarOwnsSidebarToggle } from "@/components/layout/sidebar-toggle";
import { ShellBoundary } from "@/components/startup-status";

/**
 * The one App Shell (DESIGN.md §9.1): top bar + left column + centre + optional right column, for
 * chat, settings and admin alike. One viewport that never scrolls; panes scroll inside it. The left
 * column is 276px, collapsing to the 80px rail, and shares its open state (Ctrl+B) across all three.
 */
export function GlassShell({
  scope,
  sidebar,
  right,
  banner,
  children,
}: {
  scope: ShellScope;
  sidebar: ReactNode;
  right?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TopBarOwnsSidebarToggle.Provider value={true}>
      <SidebarShell className="glass-shell h-svh overflow-hidden" iconWidth="80px" width="276px">
        <GlassTopBar scope={scope} />
        {sidebar}
        <div className="glass-body flex min-h-0 min-w-0 flex-1 overflow-hidden" data-scope={scope}>
          <main className="glass-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {banner}
            <ShellBoundary>{children}</ShellBoundary>
          </main>
          {right}
        </div>
      </SidebarShell>
    </TopBarOwnsSidebarToggle.Provider>
  );
}
