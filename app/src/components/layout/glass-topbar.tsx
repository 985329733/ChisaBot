import {
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMenu2,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { type DesktopWindowBridge, useDesktopWindow } from "@/lib/desktop-window";
import { appConfig } from "@/lib/generated/application-config";
import { PROTO_PREVIEW } from "@/lib/proto-preview";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "聊天", to: "/", match: (p: string) => p === "/" || p.startsWith("/channel") || p.startsWith("/group") || p === "/bot" || p.startsWith("/bot/") },
  { label: "长期任务", to: "/responsibilities", match: (p: string) => p.startsWith("/responsibilities") || p.startsWith("/routines") },
  { label: "技能", to: "/skills", match: (p: string) => p.startsWith("/skills") },
] as const;

export function initialsOf(name: string | null | undefined, email: string | undefined) {
  const trimmed = name?.trim();
  if (trimmed) {
    // A CJK name reads best as its first character; a Latin one as its initials.
    if (/^[\u3400-\u9fff]/.test(trimmed)) return trimmed.slice(0, 1);
    return trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }
  return email?.slice(0, 2).toUpperCase() ?? "?";
}

export function GlassAvatar({ size = 44, ring = true }: { size?: number; ring?: boolean }) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <span
      className={cn("glass-avatar", ring && "glass-avatar-ring")}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initialsOf(user?.name, user?.email)}
    </span>
  );
}

export type ShellScope = "app" | "settings" | "admin";

/**
 * 顶栏（DESIGN-v4）：只放「应用」和「窗口」的东西。
 *
 * 左 = 字标 + 左栏开关（宽度与左栏对齐）；中 = 主导航；右上角 = 只有窗口按钮（— □ ✕）。
 * 搜索在左栏卡片顶部，账号在左栏最底下，机器人菜单在聊天列头部，面板操作在面板卡片里，
 * 页面操作在各页页头——顶栏右侧不再有任何页面或账号控件。
 */
export function GlassTopBar({ scope = "app" }: { scope?: ShellScope }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sidebar = useOptionalSidebar();
  const mobile = Boolean(sidebar?.isMobile);
  const desktop = useDesktopWindow();
  const drawerLabel = scope === "app" ? "机器人列表" : scope === "settings" ? "设置分区" : "管理导航";
  return (
    <header
      className="glass-topbar"
      data-scope={scope}
      // PC 无边框窗口：空白处双击 = 最大化 / 还原（拖动由 -webkit-app-region 交给系统）。
      onDoubleClick={
        desktop
          ? (event) => {
              if ((event.target as HTMLElement).closest("a,button,input,label,[role=menu]")) return;
              desktop.bridge.toggleMaximize();
            }
          : undefined
      }
    >
      <div className="glass-topbar-start">
        {mobile ? (
          <button
            aria-label={`打开${drawerLabel}`}
            className="glass-icon-btn glass-menu-btn"
            onClick={() => sidebar?.setOpenMobile(true)}
            type="button"
          >
            <IconMenu2 className="glass-icon-btn-ico" />
          </button>
        ) : (
          <span className="glass-brand">
            {appConfig.brand.productName}
            {PROTO_PREVIEW ? (
              <span className="proto-badge" title={"这是独立的原型沙箱，使用线上数据的副本；改动不会影响线上。"}>
                {"原型预览"}
              </span>
            ) : null}
          </span>
        )}
        {sidebar && !mobile ? <RosterToggle scope={scope} /> : null}
      </div>
      <nav aria-label={"主导航"} className="glass-seg">
        {TABS.map((tab) => (
          <Link
            className={cn("glass-seg-item", scope === "app" && tab.match(pathname) && "is-on")}
            key={tab.to}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {/* 右区故意留空：右上角只属于窗口。 */}
      <div aria-hidden className="glass-topbar-end" />
      {desktop ? <WindowControls bridge={desktop.bridge} maximized={desktop.maximized} /> : null}
    </header>
  );
}

/** PC 无边框窗口右上角：Windows 11 传统标题按钮（46×40，贴在窗口右上角，无胶囊底）；关闭悬停 #c42b1c 红底白字。 */
export function WindowControls({ bridge, maximized }: { bridge: DesktopWindowBridge; maximized: boolean }) {
  return (
    <div aria-label={"窗口"} className="win-ctrls" role="group">
      <button aria-label={"最小化"} className="win-ctrl" onClick={() => bridge.minimize()} title={"最小化"} type="button">
        <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
          <path d="M1 5.5h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      </button>
      <button
        aria-label={maximized ? "还原" : "最大化"}
        className="win-ctrl"
        onClick={() => bridge.toggleMaximize()}
        title={maximized ? "还原" : "最大化"}
        type="button"
      >
        {maximized ? (
          <svg aria-hidden fill="none" height="10" viewBox="0 0 10 10" width="10">
            <rect height="6" rx="1.2" stroke="currentColor" strokeWidth="1.1" width="6" x="1" y="3" />
            <path d="M3.2 1.2h4.4c.7 0 1.2.5 1.2 1.2v4.4" stroke="currentColor" strokeWidth="1.1" />
          </svg>
        ) : (
          <svg aria-hidden fill="none" height="10" viewBox="0 0 10 10" width="10">
            <rect height="8" rx="1.6" stroke="currentColor" strokeWidth="1.1" width="8" x="1" y="1" />
          </svg>
        )}
      </button>
      <button aria-label={"关闭"} className="win-ctrl is-close" onClick={() => bridge.close()} title={"关闭"} type="button">
        <svg aria-hidden height="10" viewBox="0 0 10 10" width="10">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

const MOD_LABEL = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘B" : "Ctrl+B";
/** The roster element the toggle points its `aria-controls` at. */
export const ROSTER_ID = "chisabot-bot-list";
export const PANEL_RAIL_ID = "chisabot-panel-rail";

export function ToggleTip({
  label,
  keys,
  children,
  side = "bottom",
}: {
  label: string;
  keys?: string;
  children: ReactElement;
  side?: "bottom" | "left" | "right" | "top";
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} sideOffset={8}>
        {label}
        {keys ? <span className="text-background/60">{keys}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Left roster: collapses to the slim avatar rail (Ctrl+B is the primitive's own shortcut). */
function RosterToggle({ scope }: { scope: ShellScope }) {
  const sidebar = useOptionalSidebar();
  if (!sidebar) return null;
  const open = sidebar.open;
  const what = scope === "app" ? "机器人列表" : scope === "settings" ? "设置分区" : "管理导航";
  const label = open ? `收起${what}` : `展开${what}`;
  const Icon = open ? IconLayoutSidebarLeftCollapse : IconLayoutSidebarLeftExpand;
  return (
    <ToggleTip keys={MOD_LABEL} label={label}>
      <button
        aria-controls={ROSTER_ID}
        aria-expanded={open}
        aria-label={label}
        className="glass-ghost-btn glass-roster-toggle"
        onClick={sidebar.toggleSidebar}
        type="button"
      >
        <Icon className="glass-ghost-btn-ico" key={open ? "open" : "closed"} />
      </button>
    </ToggleTip>
  );
}
