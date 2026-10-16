import { IconCode } from "@tabler/icons-react";
import type * as React from "react";
import { AccountCard } from "@/components/layout/account-menu";
import { RailSidebar, RailSidebarEdge } from "@/components/layout/rail-sidebar";
import { type Sidebar, SidebarContent, useOptionalSidebar } from "@/components/ui/sidebar";
import { CcNodeCard, CcTree } from "./cc-tree";
import { LeftModeSwitch } from "./left-mode-switch";

/** 左栏的 Claude Code 视图：切换 → 工作区和会话 → 节点状态卡 → 账号（DESIGN.md §73.2）。 */
export function CcSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const sidebar = useOptionalSidebar();
  const close = () => {
    if (sidebar?.isMobile) sidebar.setOpenMobile(false);
  };
  const collapsed = Boolean(sidebar && !sidebar.isMobile && sidebar.state === "collapsed");
  if (collapsed)
    return (
      <RailSidebar collapsible="icon" variant="floating" {...props}>
        <nav aria-label="Claude Code" className="glass-mini">
          <button aria-label="展开 Claude Code 列表" className="glass-mini-new" onClick={() => sidebar?.setOpen(true)} type="button">
            <IconCode className="size-5" />
          </button>
        </nav>
      </RailSidebar>
    );
  return (
    <RailSidebar collapsible="icon" variant="floating" {...props}>
      <SidebarContent className="glass-side-full gap-3 overflow-hidden">
        <LeftModeSwitch mode="cc" />
        <section aria-label="工作区和会话" className="glass-card glass-side-card min-h-0 flex-1">
          <div className="glass-list-head">
            <span className="glass-list-title">{"工作区"}</span>
          </div>
          <div className="glass-side-scroll scroll-fade-b">
            <CcTree onNavigate={close} />
          </div>
          <CcNodeCard onNavigate={close} />
        </section>
        <AccountCard />
      </SidebarContent>
      <RailSidebarEdge />
    </RailSidebar>
  );
}
