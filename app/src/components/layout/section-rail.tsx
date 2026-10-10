import { IconArrowLeft, IconExternalLink } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, type LinkOptions } from "@tanstack/react-router";
import type * as React from "react";
import { GlassAvatar } from "@/components/layout/glass-topbar";
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail, useOptionalSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { currentUserQueryOptions } from "@/lib/auth/queries";
import { cn } from "@/lib/utils";

/**
 * The left column for settings and admin (DESIGN.md §11 左栏行 / §13).
 *
 * Same family as the chat roster: a pill on top ("返回应用" here, "新聊天" there), one L1 glass card
 * holding grouped `nav-row`s, a footer, and — collapsed with Ctrl+B — the same 80px rail of icon
 * tiles the roster turns into. Only the rows differ: sections instead of Bots.
 */
export type RailItem = {
  title: string;
  /** Second line under the title (settings sections); admin rows are single-line. */
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Lights only on its own route — for an entry whose path prefixes the others'. */
  exact?: boolean;
} & ({ linkOptions: LinkOptions; href?: never } | { href: string; linkOptions?: never });

export type RailGroup = { label?: string; items: RailItem[] };

export function SectionRail({
  ariaLabel,
  groups,
  footerLink,
  ...props
}: {
  ariaLabel: string;
  groups: RailGroup[];
  /** The icon button in the footer: the way across to the other area (settings ↔ admin). */
  footerLink?: { label: string; to: string; icon: React.ComponentType<{ className?: string }> };
} & React.ComponentProps<typeof Sidebar>) {
  const sidebar = useOptionalSidebar();
  const collapsed = Boolean(sidebar && !sidebar.isMobile && sidebar.state === "collapsed");

  if (collapsed) {
    return (
      <Sidebar collapsible="icon" variant="floating" {...props}>
        <nav aria-label={ariaLabel} className="glass-mini" id="chisabot-bot-list">
          <RailTip label={"返回应用"}>
            <Link aria-label={"返回应用"} className="glass-mini-new" to="/">
              <IconArrowLeft className="size-5" />
            </Link>
          </RailTip>
          <div className="glass-card glass-mini-card">
            <div className="glass-mini-scroll scroll-fade-b">
              {groups.map((group, gi) => (
                <div className="rail-mini-group" key={group.label ?? gi}>
                  {gi > 0 ? <span aria-hidden className="rail-mini-sep" /> : null}
                  {group.items.map((item) => (
                    <RailTip key={item.title} label={item.title}>
                      {item.href ? (
                        <a aria-label={item.title} className="glass-mini-bot rail-mini-item" href={item.href} rel="noopener noreferrer" target="_blank">
                          <item.icon className="size-[18px]" />
                        </a>
                      ) : (
                        <Link
                          {...item.linkOptions}
                          activeOptions={{ exact: item.exact ?? false }}
                          activeProps={{ className: "is-on" }}
                          aria-label={item.title}
                          className="glass-mini-bot rail-mini-item"
                        >
                          <item.icon className="size-[18px]" />
                        </Link>
                      )}
                    </RailTip>
                  ))}
                </div>
              ))}
            </div>
            {footerLink ? (
              <div className="glass-mini-links">
                <RailTip label={footerLink.label}>
                  <Link aria-label={footerLink.label} className="glass-mini-link" to={footerLink.to}>
                    <footerLink.icon className="size-[18px]" />
                  </Link>
                </RailTip>
              </div>
            ) : null}
          </div>
        </nav>
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon" variant="floating" {...props}>
      <SidebarHeader className="glass-side-header glass-side-full gap-3 p-0 pb-3">
        <Link className="glass-newchat rail-back" to="/">
          <IconArrowLeft className="size-[18px]" />
          {"返回应用"}
        </Link>
      </SidebarHeader>
      <SidebarContent className="glass-side-full gap-3 overflow-hidden" id="chisabot-bot-list">
        <nav aria-label={ariaLabel} className="glass-card glass-side-card min-h-0 flex-1">
          <div className="glass-side-scroll rail-scroll scroll-fade-b">
            {groups.map((group, gi) => (
              <div className={cn("rail-group", gi > 0 && "mt-2")} key={group.label ?? gi}>
                {group.label ? (
                  <div className="glass-sec">
                    <span>{group.label}</span>
                  </div>
                ) : null}
                <div className="rail-list">
                  {group.items.map((item) => (
                    <NavRow item={item} key={item.title} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <RailFooter link={footerLink} />
        </nav>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function NavRow({ item }: { item: RailItem }) {
  const sidebar = useOptionalSidebar();
  const closeDrawer = () => sidebar?.isMobile && sidebar.setOpenMobile(false);
  const body = (
    <>
      <span className="nav-row-ico">
        <item.icon className="size-[17px]" />
      </span>
      <span className="nav-row-text">
        <span className="nav-row-t">{item.title}</span>
        {item.sub ? <span className="nav-row-s">{item.sub}</span> : null}
      </span>
      {item.href ? <IconExternalLink className="nav-row-ext size-3.5" /> : null}
    </>
  );
  if (item.href) {
    return (
      <a className="nav-row" href={item.href} onClick={closeDrawer} rel="noopener noreferrer" target="_blank">
        {body}
      </a>
    );
  }
  return (
    <Link
      {...item.linkOptions}
      activeOptions={{ exact: item.exact ?? false }}
      activeProps={{ className: "is-on" }}
      className="nav-row"
      onClick={closeDrawer}
    >
      {body}
    </Link>
  );
}

function RailFooter({ link }: { link?: { label: string; to: string; icon: React.ComponentType<{ className?: string }> } }) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <div className="rail-foot">
      <GlassAvatar ring={false} size={32} />
      <span className="min-w-0 flex-1">
        <span className="rail-foot-name">{user?.name || user?.email || "\u00a0"}</span>
        <span className="rail-foot-role">{user?.role === "admin" ? "管理员" : "成员"}</span>
      </span>
      {link ? (
        <RailTip label={link.label}>
          <Link aria-label={link.label} className="rail-foot-btn" to={link.to}>
            <link.icon className="size-[18px]" />
          </Link>
        </RailTip>
      ) : null}
    </div>
  );
}

function RailTip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
