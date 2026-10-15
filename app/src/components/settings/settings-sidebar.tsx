import {
  IconAdjustmentsHorizontal,
  IconAlarm,
  IconBookmark,
  IconBrain,
  IconCloudDownload,
  IconDeviceDesktop,
  IconListDetails,
  IconLock,
  IconMessageChatbot,
  IconPhoto,
  IconMessageCircle,
  IconPlug,
  IconPuzzle,
  IconRoute,
  IconShieldCheck,
  IconSparkles,
  IconUsers,
  IconWorld,
  IconWorldWww,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type * as React from "react";
import { type RailGroup, SectionRail } from "@/components/layout/section-rail";
import type { Sidebar } from "@/components/ui/sidebar";
import { currentUserQueryOptions } from "@/lib/auth/queries";

/**
 * 「设置」— 偏好设置与管理后台合并后的唯一左栏。
 *
 * 导航收敛（2026-10-14，DESIGN.md §57）后分三组：
 * - 个人：通用 · 记忆 · 技能 · 定时任务 · 页面 · 账号连接 · 生图与识图 · 密钥 · 审批偏好 · 设备 · IM 接入（后续功能页也放这里）；
 * - 管理（仅管理员）：账号（CB-040 朋友账号）· 模型（凭据并入模型页；生图 / 识图默认也在模型页，§59）· 云端浏览器 · 权限规则（审批与权限合并前暂放）· 系统更新 · 活动记录；
 * - 高级（默认折叠）：工作流 · 插件与 MCP。
 * 技能管理并入 设置 → 技能（管理员在页内进入），UI 组件不再出现在导航里。路由都还在，旧地址会重定向。
 * 左栏底部「返回聊天」是从设置回到对话的路（顶栏不再有分段导航）。
 */
const PERSONAL: RailGroup[] = [
  {
    label: "个人",
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
        title: "记忆",
        sub: "机器人记住的关于你的事",
        icon: IconBookmark,
        linkOptions: { to: "/settings/memory" },
      },
      {
        title: "技能",
        sub: "机器人照着做的方法",
        icon: IconSparkles,
        linkOptions: { to: "/settings/skills" },
      },
      {
        title: "定时任务",
        sub: "提醒和按时间自动做的事",
        icon: IconAlarm,
        linkOptions: { to: "/settings/schedules" },
      },
      {
        title: "页面",
        sub: "机器人做的网页，链接可分享",
        icon: IconWorldWww,
        linkOptions: { to: "/settings/pages" },
      },
      {
        title: "账号连接",
        sub: "GitHub、已连接的应用、保存的登录",
        icon: IconPlug,
        linkOptions: { to: "/settings/connected-accounts" },
      },
      {
        title: "生图与识图",
        sub: "自己的画图、看图模型（可选）",
        icon: IconPhoto,
        linkOptions: { to: "/settings/media" },
      },
      {
        title: "密钥",
        sub: "API 密钥和令牌，机器人用但看不到",
        icon: IconLock,
        linkOptions: { to: "/settings/vault" },
      },
      {
        title: "审批偏好",
        sub: "哪些事先问你、哪些直接做",
        icon: IconShieldCheck,
        linkOptions: { to: "/settings/approvals" },
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
    label: "管理",
    items: [
      { title: "账号", sub: "邀请朋友、停用、重置密码", icon: IconUsers, linkOptions: { to: "/admin/accounts" } },
      { title: "模型", sub: "接口、默认模型、模型密钥", icon: IconBrain, linkOptions: { to: "/admin/models" } },
      { title: "云端浏览器", sub: "机器人的浏览器与登录状态", icon: IconWorld, linkOptions: { to: "/admin/computers" } },
      { title: "权限规则", sub: "机器人永远不能做的事", icon: IconShieldCheck, linkOptions: { to: "/admin/boundaries" } },
      { title: "系统更新", sub: "版本、升级与自检", icon: IconCloudDownload, linkOptions: { to: "/admin/system-update" } },
      { title: "活动记录", sub: "所有操作记录", icon: IconListDetails, linkOptions: { to: "/admin/audit" } },
    ],
  },
  {
    label: "高级",
    collapsible: { storageKey: "chisabot-settings-advanced" },
    items: [
      { title: "工作流", sub: "多步骤的固定流程", icon: IconRoute, linkOptions: { to: "/workflows" } },
      { title: "插件与 MCP", sub: "接入外部服务和 MCP 服务器", icon: IconPuzzle, linkOptions: { to: "/admin/plugins" } },
    ],
  },
];

export function SettingsSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { data: user } = useQuery(currentUserQueryOptions());
  return (
    <SectionRail
      ariaLabel={"设置分区"}
      title={"设置"}
      footerLink={{ label: "返回聊天", to: "/", icon: IconMessageCircle }}
      groups={user?.role === "admin" ? [...PERSONAL, ...ADMIN] : PERSONAL}
      {...props}
    />
  );
}
