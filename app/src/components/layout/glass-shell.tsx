import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
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
  rightHidden = false,
  banner,
  mode,
  children,
}: {
  scope: ShellScope;
  /** 机器人 / Claude Code 原地切换后主区淡入一次（DESIGN.md §84）；不传就不动。 */
  mode?: string;
  sidebar: ReactNode;
  right?: ReactNode;
  /** 右栏留着但不显示（设置 / 管理里），回到聊天时不重新挂载（DESIGN.md §98）。 */
  rightHidden?: boolean;
  banner?: ReactNode;
  children: ReactNode;
}) {
  return (
    <TopBarOwnsSidebarToggle.Provider value={true}>
      <SidebarShell className="glass-shell h-svh overflow-hidden" iconWidth="80px" width="276px">
        <GlassTopBar scope={scope} />
        <SearchHotkey scope={scope} />
        <DrawerCloser />
        <CloseDrawerOnScope scope={scope} />
        <PhoneGestures />
        {sidebar}
        <div className="glass-body relative flex min-h-0 min-w-0 flex-1 overflow-hidden" data-scope={scope}>
          <main className="glass-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-mode={mode}>
            {banner}
            <ShellBoundary>{children}</ShellBoundary>
          </main>
          {right ? <div className={rightHidden ? "hidden" : "contents"} data-right-hidden={rightHidden ? "true" : undefined}>{right}</div> : null}
        </div>
      </SidebarShell>
    </TopBarOwnsSidebarToggle.Provider>
  );
}

/** 手机上新建机器人后抽屉自己收起，直接看到它的空聊天（成熟度扫查 F6；新建框挂在 _authed，够不着抽屉）。 */
const CLOSE_DRAWER_EVENT = "chisabot-close-drawer";
function DrawerCloser() {
  const sidebar = useOptionalSidebar();
  useEffect(() => {
    const close = () => {
      if (sidebar?.isMobile) sidebar.setOpenMobile(false);
    };
    window.addEventListener(CLOSE_DRAWER_EVENT, close);
    return () => window.removeEventListener(CLOSE_DRAWER_EVENT, close);
  }, [sidebar]);
  return null;
}

/**
 * 外壳只有一个（DESIGN.md §98）：手机上从设置抽屉里点「返回聊天」，换的是抽屉里的内容，抽屉本身不会跟着
 * 卸载——换区域时把它收起来，落地看到的是聊天，不是还开着的抽屉。
 */
function CloseDrawerOnScope({ scope }: { scope: ShellScope }) {
  const sidebar = useOptionalSidebar();
  const previous = useRef(scope);
  useEffect(() => {
    if (previous.current === scope) return;
    previous.current = scope;
    if (sidebar?.isMobile && sidebar.openMobile) sidebar.setOpenMobile(false);
  }, [scope, sidebar]);
  return null;
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
