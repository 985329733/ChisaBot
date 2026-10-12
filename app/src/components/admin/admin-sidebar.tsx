import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconBrain,
  IconCloudDownload,
  IconDeviceDesktop,
  IconDeviceLaptop,
  IconFileText,
  IconKey,
  IconLayoutGrid,
  IconListDetails,
  IconNetwork,
  IconPuzzle,
  IconSchool,
  IconShieldCheck,
} from "@tabler/icons-react";
import type * as React from "react";
import { type RailGroup, SectionRail } from "@/components/layout/section-rail";
import type { Sidebar } from "@/components/ui/sidebar";

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
      {
        title: "系统更新",
        icon: IconCloudDownload,
        linkOptions: { to: "/admin/system-update" },
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
      {
        title: "模型平台 Magpie",
        icon: IconNetwork,
        linkOptions: { to: "/admin/magpie" },
      },
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
      {
        title: "电脑操作（PC）",
        icon: IconDeviceLaptop,
        linkOptions: { to: "/admin/devices" },
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
      // 「游乐场」先隐藏（布局偏移、用途不明；路由 /admin/playground 仍在）。
    ],
  },
  // 「谁可以进入」（人员、企业控制、身份提供者）先隐藏：描述难懂，单人自部署用不到。路由仍在。
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
      title={"管理后台"}
      footerLink={{ label: "偏好设置", to: "/settings", icon: IconAdjustmentsHorizontal }}
      groups={GROUPS}
      {...props}
    />
  );
}
