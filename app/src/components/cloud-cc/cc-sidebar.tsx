import { IconCode, IconFolderPlus } from "@tabler/icons-react";
import type * as React from "react";
import { useState } from "react";
import { AccountCard } from "@/components/layout/account-menu";
import { RailSidebar, RailSidebarEdge } from "@/components/layout/rail-sidebar";
import {
  type Sidebar,
  SidebarContent,
  useOptionalSidebar,
} from "@/components/ui/sidebar";
import { pcSyncBridge } from "@/lib/pc-bridge";
import { CcNewWorkspaceDialog } from "./cc-github-dialogs";
import { CcNodeCard, CcTree } from "./cc-tree";
import { LeftModeSwitch } from "./left-mode-switch";

/** 左栏的 Claude Code 视图：切换 → 新建工作区 → 工作区和会话 → 节点状态卡 → 账号（DESIGN.md §73.2）。 */
export function CcSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const sidebar = useOptionalSidebar();
  const [newOpen, setNewOpen] = useState(false);
  const close = () => {
    if (sidebar?.isMobile) sidebar.setOpenMobile(false);
  };
  const collapsed = Boolean(
    sidebar && !sidebar.isMobile && sidebar.state === "collapsed",
  );
  if (collapsed)
    return (
      <RailSidebar collapsible="icon" variant="floating" {...props}>
        <nav aria-label="Claude Code" className="glass-mini">
          <button
            aria-label="展开 Claude Code 列表"
            className="glass-mini-new"
            onClick={() => sidebar?.setOpen(true)}
            type="button"
          >
            <IconCode className="size-5" />
          </button>
        </nav>
      </RailSidebar>
    );
  return (
    <RailSidebar collapsible="icon" variant="floating" {...props}>
      <SidebarContent className="glass-side-full gap-3 overflow-hidden">
        <LeftModeSwitch mode="cc" />
        <button
          className="cc-new-ws-top"
          data-testid="cc-new-ws"
          onClick={() => setNewOpen(true)}
          type="button"
        >
          <IconFolderPlus className="size-4" />
          <span className="cc-new-ws-top-main">
            <span className="cc-new-ws-top-t">{"新建工作区"}</span>
            <span className="cc-new-ws-top-s">
              {pcSyncBridge() ? "GitHub · 电脑文件夹" : "从 GitHub"}
            </span>
          </span>
        </button>
        <div
          aria-label="工作区和会话"
          className="glass-side-scroll scroll-fade-b min-h-0 flex-1"
          role="region"
        >
          <CcTree onNavigate={close} />
        </div>
        <CcNodeCard onNavigate={close} />
        <AccountCard />
      </SidebarContent>
      <RailSidebarEdge />
      {newOpen ? (
        <CcNewWorkspaceDialog onOpenChange={setNewOpen} open={newOpen} />
      ) : null}
    </RailSidebar>
  );
}
