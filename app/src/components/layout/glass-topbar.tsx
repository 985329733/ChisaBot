import {
  IconBell,
  IconBox,
  IconCube,
  IconHome,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconKey,
  IconLink,
  IconLogout,
  IconMenu2,
  IconMoon,
  IconNetwork,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconUser,
  IconDeviceDesktopCog,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { createContext, type MouseEvent, type ReactElement, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  PANEL_RAIL_HOTKEY,
  PANEL_RAIL_HOTKEY_LABEL,
  togglePanelRail,
  usePanelRailOpen,
} from "@/lib/panels/rail-open";
import { matchesHotkey } from "@/lib/hotkeys/hotkeys";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { approvalInboxOptions } from "@/lib/approvals";
import { signOutMutationOptions } from "@/lib/auth/mutations";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { setSidebarSearch, useSidebarSearch } from "@/lib/sidebar-search";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "聊天", to: "/", match: (p: string) => p === "/" || p.startsWith("/channel") || p.startsWith("/group") || p.startsWith("/bot") },
  { label: "长期任务", to: "/responsibilities", match: (p: string) => p.startsWith("/responsibilities") || p.startsWith("/routines") },
  { label: "技能", to: "/skills", match: (p: string) => p.startsWith("/skills") },
] as const;

function initialsOf(name: string | null | undefined, email: string | undefined) {
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

/**
 * The one top bar for the app shell: home, the three destinations, the conversation search, and
 * the account menu that now holds every setting and admin entry the old sidebar used to list.
 */
export type ShellScope = "app" | "settings" | "admin";

export function GlassTopBar({ scope = "app" }: { scope?: ShellScope }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sidebar = useOptionalSidebar();
  const mobile = Boolean(sidebar?.isMobile);
  const drawerLabel = scope === "app" ? "机器人列表" : scope === "settings" ? "设置分区" : "管理导航";
  return (
    <header className="glass-topbar" data-scope={scope}>
      <div className="flex items-center gap-2">
        {/* On a phone the drawer button takes the home button's place (聊天 is home there), so the
            centred tabs never cover it (DESIGN.md §13 移动端). */}
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
          <Link aria-label={"首页"} className="glass-home" to="/">
            <IconHome className="size-5" />
          </Link>
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
      <div className="flex items-center gap-3">
        {scope === "app" ? <PanelRailToggle /> : null}
        <TopSearch scope={scope} />
        <AccountMenu />
      </div>
    </header>
  );
}

const MOD_LABEL = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘B" : "Ctrl+B";
/** The roster element both toggles point their `aria-controls` at. */
export const ROSTER_ID = "chisabot-bot-list";
export const PANEL_RAIL_ID = "chisabot-panel-rail";

function ToggleTip({ label, keys, children }: { label: string; keys: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="bottom" sideOffset={8}>
        {label}
        <span className="text-background/60">{keys}</span>
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
        className="glass-icon-btn"
        onClick={sidebar.toggleSidebar}
        type="button"
      >
        <Icon className="glass-icon-btn-ico" key={open ? "open" : "closed"} />
      </button>
    </ToggleTip>
  );
}

/** Right 自定义面板 column. Only drawn where that column exists (≥1280px, the `xl` breakpoint). */
function PanelRailToggle() {
  const open = usePanelRailOpen();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, PANEL_RAIL_HOTKEY)) return;
      if (!window.matchMedia("(min-width: 1280px)").matches) return;
      event.preventDefault();
      togglePanelRail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const label = open ? "收起面板" : "展开面板";
  const Icon = open ? IconLayoutSidebarRightCollapse : IconLayoutSidebarRightExpand;
  return (
    <ToggleTip keys={PANEL_RAIL_HOTKEY_LABEL} label={label}>
      <button
        aria-controls={PANEL_RAIL_ID}
        aria-expanded={open}
        aria-label={label}
        className="glass-icon-btn hidden xl:grid"
        onClick={togglePanelRail}
        type="button"
      >
        <Icon className="glass-icon-btn-ico" key={open ? "open" : "closed"} />
      </button>
    </ToggleTip>
  );
}

function TopSearch({ scope }: { scope: ShellScope }) {
  const search = useSidebarSearch();
  const input = useRef<HTMLInputElement>(null);
  const sidebar = useOptionalSidebar();
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (sidebar?.isMobile) sidebar.setOpenMobile(true);
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebar]);
  // Arriving from a settings/admin search: keep typing where you left off.
  useEffect(() => {
    if (scope === "app" && search && document.activeElement === document.body) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <label className="glass-search hidden md:flex">
      <IconSearch className="size-4.5 shrink-0" />
      <input
        aria-label={"搜索会话"}
        className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-[var(--glass-ink-3)]"
        onChange={(event) => {
          setSidebarSearch(event.target.value);
          // Results live in the chat roster; from settings/admin a search takes you there.
          if (scope !== "app" && event.target.value.trim()) void navigate({ to: "/" });
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setSidebarSearch("");
            event.currentTarget.blur();
          }
        }}
        placeholder={"搜索会话"}
        ref={input}
        value={search}
      />
      {search ? (
        <button
          aria-label={"清除搜索"}
          className="grid size-5 place-items-center rounded-full hover:bg-white/60"
          onClick={() => setSidebarSearch("")}
          type="button"
        >
          <IconX className="size-3.5" />
        </button>
      ) : (
        <kbd className="glass-kbd">{mac ? "⌘K" : "Ctrl K"}</kbd>
      )}
    </label>
  );
}

/**
 * Closes the account menu and navigates only once the destination's route chunk is loaded, so the
 * current screen stays put while it loads instead of being swapped for a placeholder with the menu
 * still floating over it.
 */
const MenuNavigateContext = createContext<((to: string) => void) | null>(null);

function MenuRow({
  icon,
  label,
  hint,
  to,
  href,
  onClick,
  danger,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint?: ReactNode;
  to?: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  children?: ReactNode;
}) {
  const className = cn("glass-mi", danger && "is-danger");
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="glass-mi-hint">{hint}</span> : null}
      {children}
    </>
  );
  const go = useContext(MenuNavigateContext);
  if (to)
    return (
      <DropdownMenuItem
        className={className}
        onClick={(event: MouseEvent) => {
          if (!go || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          go(to);
        }}
        render={<Link to={to} />}
      >
        {body}
      </DropdownMenuItem>
    );
  if (href)
    return (
      <DropdownMenuItem
        className={className}
        render={<a href={href} rel="noreferrer" target="_blank" />}
      >
        {body}
      </DropdownMenuItem>
    );
  return (
    <DropdownMenuItem className={className} onClick={onClick} variant={danger ? "destructive" : "default"}>
      {body}
    </DropdownMenuItem>
  );
}

function AccountMenu() {
  const { data: user } = useQuery(currentUserQueryOptions());
  const approvals = useQuery(approvalInboxOptions());
  const { dark, setDark } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation(signOutMutationOptions(queryClient));
  const isAdmin = user?.role === "admin";
  const pending =
    (approvals.data?.requests.filter((r) => r.status === "pending").length ?? 0) +
    (approvals.data?.questions.length ?? 0);

  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (to: string) => {
    setOpen(false);
    void router
      .preloadRoute({ to })
      .catch(() => undefined)
      .finally(() => void navigate({ to }));
  };

  const handleSignOut = async () => {
    await signOut.mutateAsync();
    await navigate({ to: "/sign" });
  };

  const icon = "size-[18px] shrink-0 opacity-80";
  return (
    <MenuNavigateContext.Provider value={go}>
    <DropdownMenu onOpenChange={setOpen} open={open}>
      <DropdownMenuTrigger
        render={
          <button
            aria-label={"账号与设置"}
            className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
            type="button"
          />
        }
      >
        <GlassAvatar />
        {pending > 0 ? <span aria-hidden className="glass-avatar-dot" /> : null}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="glass-pop w-[300px] p-2.5"
        side="bottom"
        sideOffset={10}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2.5 pt-2 pb-3 font-normal">
            <GlassAvatar ring={false} size={40} />
            <span className="min-w-0">
              <b className="block truncate font-medium text-foreground text-sm">
                {user?.name || user?.email}
              </b>
              <span className="block truncate text-muted-foreground text-xs">
                {user?.email}
                {isAdmin ? " · 管理员" : ""}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="glass-sep" />
        <DropdownMenuGroup className="py-1">
          <MenuRow hint={"登录与密码"} icon={<IconUser className={icon} />} label={"您的账号"} to="/settings/passwords" />
          <MenuRow icon={<IconSettings className={icon} />} label={"偏好设置"} to="/settings" />
          <MenuRow
            hint={isAdmin ? "全局模型" : "按 BOT 设置"}
            icon={<IconCube className={icon} />}
            label={"模型选择"}
            to={isAdmin ? "/admin/models" : "/bots"}
          />
          <MenuRow icon={<IconLink className={icon} />} label={"已连接应用"} to="/settings/connected-accounts" />
          <MenuRow
            hint={pending > 0 ? `${pending} 项待审批` : undefined}
            icon={<IconShieldCheck className={icon} />}
            label={"审批"}
            to="/approvals"
          />
          <MenuRow hint={"可达性"} icon={<IconBell className={icon} />} label={"通知"} to="/reachability" />
          <DropdownMenuItem
            className="glass-mi"
            closeOnClick={false}
            onClick={() => setDark(!dark)}
          >
            <IconMoon className={icon} />
            <span className="min-w-0 flex-1">{"暗色外观"}</span>
            <Switch
              aria-label={"暗色外观"}
              checked={dark}
              onCheckedChange={setDark}
              onClick={(event) => event.stopPropagation()}
            />
          </DropdownMenuItem>
          {!isAdmin ? (
            <MenuRow icon={<IconKey className={icon} />} label={"密钥与凭据"} to="/settings/passwords" />
          ) : null}
        </DropdownMenuGroup>
        {isAdmin ? (
          <>
            <DropdownMenuSeparator className="glass-sep" />
            <DropdownMenuGroup className="py-1">
              <DropdownMenuLabel className="px-3 py-1 font-normal text-[11px] text-muted-foreground">
                {"管理员"}
              </DropdownMenuLabel>
              <MenuRow
                hint={"团队设置 · 审计"}
                icon={<IconDeviceDesktopCog className={icon} />}
                label={"管理控制台"}
                to="/admin"
              />
              <MenuRow
                hint={"网关 · 提供方 · 模型"}
                icon={<IconNetwork className={icon} />}
                label={"模型平台 Magpie"}
                to="/admin/magpie"
              />
              <MenuRow icon={<IconKey className={icon} />} label={"密钥与凭据"} to="/admin/credentials" />
              <MenuRow icon={<IconBox className={icon} />} label={"组件库"} to="/settings/components-gallery" />
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator className="glass-sep" />
        <DropdownMenuGroup className="py-1">
          <MenuRow
            danger
            icon={<IconLogout className={icon} />}
            label={signOut.isPending ? "正在退出…" : "退出登录"}
            onClick={handleSignOut}
          />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    </MenuNavigateContext.Provider>
  );
}
