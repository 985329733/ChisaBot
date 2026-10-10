import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconBrain,
  IconBuildingBank,
  IconBuildingSkyscraper,
  IconCode,
  IconDeviceDesktop,
  IconFileText,
  IconKey,
  IconLayoutGrid,
  IconListDetails,
  IconNetwork,
  IconPuzzle,
  IconSchool,
  IconShieldCheck,
  IconUsers,
} from "@tabler/icons-react";
import type * as React from "react";
import { type RailGroup, SectionRail } from "@/components/layout/section-rail";
import type { Sidebar } from "@/components/ui/sidebar";
import { MAGPIE_ADMIN_URL } from "@/lib/magpie";

/**
 * 管理导航 — grouped by the question an administrator is asking, in the same order as the admin
 * index. Drawn by `SectionRail`, the same left-card family as the chat roster (DESIGN.md §13).
 */
const GROUPS: RailGroup[] = [
  {
    items: [
      {
        title: "部署概览",
        icon: IconActivity,
        /* /admin is a prefix of every other route here. */
        exact: true,
        linkOptions: { to: "/admin" },
      },
    ],
  },
  {
    label: "机器人可以访问什么",
    items: [
      {
        title: "模型设置",
        icon: IconBrain,
        linkOptions: { to: "/admin/models" },
      },
      ...(MAGPIE_ADMIN_URL
        ? [{
            title: "Magpie 模型管理",
            icon: IconNetwork,
            href: MAGPIE_ADMIN_URL,
          }]
        : []),
      {
        title: "凭据",
        icon: IconKey,
        linkOptions: { to: "/admin/credentials" },
      },
      {
        title: "权限规则",
        icon: IconShieldCheck,
        linkOptions: { to: "/admin/boundaries" },
      },
      {
        title: "计算机",
        icon: IconDeviceDesktop,
        linkOptions: { to: "/admin/computers" },
      },
    ],
  },
  {
    label: "机器人可以做什么",
    items: [
      {
        title: "插件",
        icon: IconPuzzle,
        linkOptions: { to: "/admin/plugins" },
      },
      {
        title: "技能",
        icon: IconFileText,
        linkOptions: { to: "/admin/skills" },
      },
      {
        title: "自动学习",
        icon: IconSchool,
        linkOptions: { to: "/admin/learning" },
      },
      {
        title: "UI 组件",
        icon: IconLayoutGrid,
        linkOptions: { to: "/admin/components" },
      },
      {
        title: "游乐场",
        icon: IconCode,
        linkOptions: { to: "/admin/playground" },
      },
    ],
  },
  {
    label: "谁可以进入",
    items: [
      {
        title: "人员",
        icon: IconUsers,
        linkOptions: { to: "/admin/people" },
      },
      {
        title: "企业控制",
        icon: IconBuildingSkyscraper,
        linkOptions: { to: "/admin/enterprise" },
      },
      {
        title: "身份提供者",
        icon: IconBuildingBank,
        linkOptions: { to: "/admin/identity-providers" },
      },

    ],
  },
  {
    label: "发生了什么",
    items: [
      {
        title: "审计",
        icon: IconListDetails,
        linkOptions: { to: "/admin/audit" },
      },
    ],
  },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <SectionRail
      ariaLabel={"管理导航"}
      footerLink={{ label: "偏好设置", to: "/settings", icon: IconAdjustmentsHorizontal }}
      groups={GROUPS}
      {...props}
    />
  );
}
