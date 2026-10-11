import {
  IconBell,
  IconBuildingSkyscraper,
  IconLogout,
  IconMoon,
  IconSelector,
  IconSettings,
  IconShieldCheck,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { GlassAvatar } from "@/components/layout/glass-topbar";
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
import { toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { approvalInboxOptions } from "@/lib/approvals";
import { signOutMutationOptions } from "@/lib/auth/mutations";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { PROTO_PREVIEW } from "@/lib/proto-preview";
import { cn } from "@/lib/utils";

/**
 * 账号（DESIGN-v4）：左栏最底下一张小玻璃卡 —— 头像 + 名字 + 身份，点开账号菜单（向上弹出）。
 * 聊天、偏好设置、管理后台三个区域都在同一个位置。左栏收起后只剩头像，菜单向右弹出。
 *
 * 菜单只放「我」的事：偏好设置 · 审批 · 通知 ‖ 管理后台（管理员）‖ 暗色外观 ‖ 退出登录。
 * 其余设置项（已连接账号、密码、模型、凭据…）在偏好设置 / 管理后台的左栏里，不在这里重复。
 */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { data: user } = useQuery(currentUserQueryOptions());
  const approvals = useQuery(approvalInboxOptions());
  const { dark, setDark } = useTheme();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const router = useRouter();
  const sidebar = useOptionalSidebar();
  const signOut = useMutation(signOutMutationOptions(queryClient));
  const isAdmin = user?.role === "admin";
  const pending =
    (approvals.data?.requests.filter((r) => r.status === "pending").length ?? 0) +
    (approvals.data?.questions.length ?? 0);
  const [open, setOpen] = useState(false);

  // 菜单先关、目标路由的代码块加载好再切页，当前屏幕不会闪成占位。
  const go = (to: string) => {
    setOpen(false);
    if (sidebar?.isMobile) sidebar.setOpenMobile(false);
    void router
      .preloadRoute({ to })
      .catch(() => undefined)
      .finally(() => void navigate({ to }));
  };

  const handleSignOut = async () => {
    if (PROTO_PREVIEW) {
      // 沙箱和线上共用一个登录会话：真的退出会把线上也退掉。
      setOpen(false);
      toast.info("原型预览：退出登录已停用（会话与线上共用）");
      return;
    }
    await signOut.mutateAsync();
    await navigate({ to: "/sign" });
  };

  const name = user?.name || user?.email || "";
  const sub = isAdmin ? "管理员" : user?.email;
  const icon = "size-[18px] shrink-0 opacity-80";

  const trigger = compact ? (
    <button aria-label={"账号与设置"} className="acct-mini" type="button" />
  ) : (
    <button aria-label={"账号与设置"} className="acct-row" type="button" />
  );
  const triggerBody = compact ? (
    <>
      <GlassAvatar ring={false} size={36} />
      {pending > 0 ? <span aria-hidden className="glass-avatar-dot" /> : null}
    </>
  ) : (
    <>
      <span className="acct-ava">
        <GlassAvatar ring={false} size={32} />
        {pending > 0 ? <span aria-hidden className="glass-avatar-dot" /> : null}
      </span>
      <span className="acct-text">
        <span className="acct-name">{name}</span>
        {sub ? <span className="acct-sub">{sub}</span> : null}
      </span>
      <IconSelector aria-hidden className="acct-chev" />
    </>
  );

  return (
    <DropdownMenu onOpenChange={setOpen} open={open}>
      {compact ? (
        <Tooltip>
          <TooltipTrigger render={<DropdownMenuTrigger render={trigger} />}>{triggerBody}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {name || "账号"}
          </TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger render={trigger}>{triggerBody}</DropdownMenuTrigger>
      )}
      <DropdownMenuContent
        align={compact ? "end" : "start"}
        className="glass-pop acct-pop w-[264px] p-1.5"
        side={compact ? "right" : "top"}
        sideOffset={compact ? 12 : 8}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-3 px-2.5 pt-2 pb-2.5 font-normal">
            <GlassAvatar ring={false} size={36} />
            <span className="min-w-0">
              <b className="block truncate font-medium text-foreground text-sm">{name}</b>
              <span className="block truncate text-muted-foreground text-xs">
                {user?.email}
                {isAdmin ? " · 管理员" : ""}
              </span>
            </span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="glass-sep" />
        <DropdownMenuGroup className="py-1">
          <Row icon={<IconSettings className={icon} />} label={"偏好设置"} onClick={() => go("/settings")} />
          <Row
            hint={pending > 0 ? `${pending} 项待审批` : undefined}
            icon={<IconShieldCheck className={icon} />}
            label={"审批"}
            onClick={() => go("/approvals")}
          />
          <Row icon={<IconBell className={icon} />} label={"通知"} onClick={() => go("/reachability")} />
          {isAdmin ? (
            <Row icon={<IconBuildingSkyscraper className={icon} />} label={"管理后台"} onClick={() => go("/admin")} />
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="glass-sep" />
        <DropdownMenuGroup className="py-1">
          <DropdownMenuItem className="glass-mi" closeOnClick={false} onClick={() => setDark(!dark)}>
            <IconMoon className={icon} />
            <span className="min-w-0 flex-1">{"暗色外观"}</span>
            <Switch
              aria-label={"暗色外观"}
              checked={dark}
              onCheckedChange={setDark}
              onClick={(event) => event.stopPropagation()}
            />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="glass-sep" />
        <DropdownMenuGroup className="py-1">
          <Row
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

function Row({
  icon,
  label,
  hint,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenuItem
      className={cn("glass-mi", danger && "is-danger")}
      onClick={onClick}
      variant={danger ? "destructive" : "default"}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="glass-mi-hint">{hint}</span> : null}
    </DropdownMenuItem>
  );
}

/** 左栏底部的账号卡（展开时）。 */
export function AccountCard() {
  return (
    <div className="glass-card acct-card">
      <AccountMenu />
    </div>
  );
}
