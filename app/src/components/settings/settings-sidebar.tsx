import {
  IconAdjustmentsHorizontal,
  IconBuildingSkyscraper,
  IconKey,
  IconLayoutGrid,
  IconPlug,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { type RailGroup, SectionRail } from "@/components/layout/section-rail";
import type { Sidebar } from "@/components/ui/sidebar";
import { currentUserQueryOptions } from "@/lib/auth/queries";

/**
 * 偏好设置分区 — the settings left card (DESIGN.md §13). Same component family as the chat roster
 * and the admin nav: `SectionRail` draws the card, the rows and the 80px collapsed rail.
 */
const GROUPS: RailGroup[] = [
  {
    label: "偏好设置",
    items: [
      {
        title: "通用",
        sub: "外观、消息列表、常驻指令",
        icon: IconAdjustmentsHorizontal,
        /* `/settings` prefixes every other route here, and would otherwise light up on all of them. */
        exact: true,
        linkOptions: { to: "/settings" },
      },
      {
        /* What this deployment may reach as you (Admin's Plugins is the deployment-wide side). */
        title: "已连接账号",
        sub: "机器人代表你使用的应用",
        icon: IconPlug,
        linkOptions: { to: "/settings/connected-accounts" },
      },
      {
        title: "密码",
        sub: "已保存的登录",
        icon: IconKey,
        linkOptions: { to: "/settings/passwords" },
      },
      {
        title: "组件库",
        sub: "机器人可绘制的片段",
        icon: IconLayoutGrid,
        linkOptions: { to: "/settings/components-gallery" },
      },
    ],
  },
];

export function SettingsSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <SectionRail
      ariaLabel={"偏好设置分区"}
      footerLink={
        user?.role === "admin"
          ? { label: "管理后台", to: "/admin", icon: IconBuildingSkyscraper }
          : undefined
      }
      groups={GROUPS}
      {...props}
    />
  );
}
