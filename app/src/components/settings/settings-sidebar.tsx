import {
  IconAdjustmentsHorizontal,
  IconBrain,
  IconCloudDownload,
  IconDeviceDesktop,
  IconFileText,
  IconKey,
  IconLayoutGrid,
  IconListDetails,
  IconMessageChatbot,
  IconPlug,
  IconPuzzle,
  IconShieldCheck,
  IconWorld,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { type RailGroup, SectionRail } from "@/components/layout/section-rail";
import type { Sidebar } from "@/components/ui/sidebar";
import { currentUserQueryOptions } from "@/lib/auth/queries";

/**
 * 「设置」— 偏好设置与管理后台合并后的唯一左栏（2026-10-12 大幅精简）。
 *
 * ChisaBot 多为单人自部署，两套左栏、两个入口只会让人找不到东西。路由不变（/settings/*、/admin/*），
 * 只是共用这一张卡；管理员额外看到「模型 / 机器人能力 / 系统」三组。
 *
 * 已从导航移除（路由仍在，直接访问可用）：组件库、密码（并入已连接账号）、模型平台 Magpie（模型页内入口）、
 * 管理端的电脑操作（与个人端同一批设备）、自动学习、部署概览（只是本左栏的重复链接）、游乐场、谁可以进入。
 */
const PERSONAL: RailGroup[] = [
  {
    items: [
      {
        title: "通用",
        sub: "外观、常驻指令",
        icon: IconAdjustmentsHorizontal,
        /* `/settings` prefixes every other route here, and would otherwise light up on all of them. */
        exact: true,
        linkOptions: { to: "/settings" },
      },
      {
        title: "账号与密码",
        sub: "已连接的应用、保存的登录",
        icon: IconPlug,
        linkOptions: { to: "/settings/connected-accounts" },
      },
      {
        title: "设备",
        sub: "已关联的设备、能力与审批",
        icon: IconDeviceDesktop,
        linkOptions: { to: "/settings/devices" },
      },
      {
        title: "IM 接入",
        sub: "QQ、微信、飞书等接到机器人",
        icon: IconMessageChatbot,
        linkOptions: { to: "/settings/im" },
      },
    ],
  },
];

const ADMIN: RailGroup[] = [
  {
    label: "模型",
    items: [
      { title: "模型", sub: "接口、默认模型、Magpie 网关", icon: IconBrain, linkOptions: { to: "/admin/models" } },
      { title: "凭据", sub: "部署持有的密钥和令牌", icon: IconKey, linkOptions: { to: "/admin/credentials" } },
    ],
  },
  {
    label: "机器人能力",
    items: [
      { title: "插件", sub: "可接入的服务", icon: IconPuzzle, linkOptions: { to: "/admin/plugins" } },
      { title: "技能", sub: "斜杠调用的命名指令", icon: IconFileText, linkOptions: { to: "/admin/skills" } },
      { title: "云端浏览器", sub: "机器人的浏览器与登录状态", icon: IconWorld, linkOptions: { to: "/admin/computers" } },
      { title: "UI 组件", sub: "对话里可绘制的片段", icon: IconLayoutGrid, linkOptions: { to: "/admin/components" } },
      { title: "权限规则", sub: "机器人永远不能做的事", icon: IconShieldCheck, linkOptions: { to: "/admin/boundaries" } },
    ],
  },
  {
    label: "系统",
    items: [
      { title: "系统更新", sub: "版本与升级", icon: IconCloudDownload, linkOptions: { to: "/admin/system-update" } },
      { title: "审计", sub: "所有操作记录", icon: IconListDetails, linkOptions: { to: "/admin/audit" } },
    ],
  },
];

export function SettingsSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <SectionRail
      ariaLabel={"设置分区"}
      title={"设置"}
      groups={user?.role === "admin" ? [...PERSONAL, ...ADMIN] : PERSONAL}
      {...props}
    />
  );
}
