import {
  IconBell,
  IconBox,
  IconCube,
  IconHome,
  IconKey,
  IconLink,
  IconLogout,
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
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
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
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { approvalInboxOptions } from "@/lib/approvals";
import { signOutMutationOptions } from "@/lib/auth/mutations";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { MAGPIE_ADMIN_URL } from "@/lib/magpie";
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
export function GlassTopBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sidebar = useOptionalSidebar();
  return (
    <header className="glass-topbar">
      <div className="flex items-center gap-2">
        <Link aria-label={"首页"} className="glass-home" to="/">
          <IconHome className="size-5" />
        </Link>
        {sidebar?.isMobile ? (
          <button
            aria-label={"会话列表"}
            className="glass-pill grid size-11 place-items-center rounded-full"
            onClick={() => sidebar.setOpenMobile(true)}
            type="button"
          >
            <span className="text-lg leading-none">{"☰"}</span>
          </button>
        ) : null}
      </div>
      <nav aria-label={"主导航"} className="glass-seg">
        {TABS.map((tab) => (
          <Link
            className={cn("glass-seg-item", tab.match(pathname) && "is-on")}
            key={tab.to}
            to={tab.to}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <TopSearch />
        <AccountMenu />
      </div>
    </header>
  );
}

function TopSearch() {
  const search = useSidebarSearch();
  const input = useRef<HTMLInputElement>(null);
  const sidebar = useOptionalSidebar();
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
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
  return (
    <label className="glass-search hidden md:flex">
      <IconSearch className="size-4.5 shrink-0" />
      <input
        aria-label={"搜索会话"}
        className="h-full min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-[var(--glass-ink-3)]"
        onChange={(event) => setSidebarSearch(event.target.value)}
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
  if (to)
    return (
      <DropdownMenuItem className={className} render={<Link to={to} />}>
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

  const handleSignOut = async () => {
    await signOut.mutateAsync();
    await navigate({ to: "/sign" });
  };

  const icon = "size-[18px] shrink-0 opacity-80";
  return (
    <DropdownMenu>
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
              {MAGPIE_ADMIN_URL ? (
                <MenuRow
                  href={MAGPIE_ADMIN_URL}
                  icon={<IconNetwork className={icon} />}
                  label={"Magpie 模型管理"}
                />
              ) : null}
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
  );
}
