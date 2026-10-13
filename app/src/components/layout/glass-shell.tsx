import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { GlassTopBar, type ShellScope } from "@/components/layout/glass-topbar";
import { PhoneGestures } from "@/components/layout/phone-gestures";
import { SidebarShell } from "@/components/layout/sidebar-shell";
import { TopBarOwnsSidebarToggle } from "@/components/layout/sidebar-toggle";
import { ShellBoundary } from "@/components/startup-status";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { requestSidebarSearchFocus } from "@/lib/sidebar-search";

/**
 * The one App Shell (DESIGN.md §9.1, DESIGN-v4): top bar (应用 + 导航 + 窗口按钮) + left column
 * (搜索 → 机器人 / 分区 → 账号) + centre + optional right column (面板卡), for chat, settings and admin
 * alike. One viewport that never scrolls; panes scroll inside it. The left column is 276px,
 * collapsing to the 80px rail, and shares its open state (Ctrl+B) across all three. Page actions
 * live in each page's own header; nothing is portalled into the top bar any more.
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
        <SearchHotkey scope={scope} />
        <PhoneGestures />
        {sidebar}
        <div className="glass-body relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-scope={scope}>
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

/**
 * Ctrl K / ⌘K：搜索会话在聊天左栏顶部。左栏收起就先展开，在设置 / 管理里就先回到聊天，
 * 然后把焦点交给搜索框（它挂载或收到请求时自己聚焦）。
 */
function SearchHotkey({ scope }: { scope: ShellScope }) {
  const sidebar = useOptionalSidebar();
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      if (scope !== "app") {
        requestSidebarSearchFocus();
        void navigate({ to: "/" });
        return;
      }
      if (sidebar?.isMobile) sidebar.setOpenMobile(true);
      else if (sidebar && !sidebar.open) sidebar.setOpen(true);
      requestSidebarSearchFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scope, sidebar, navigate]);
  return null;
}
