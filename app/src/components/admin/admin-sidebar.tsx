import type * as React from "react";
import { SettingsSidebar } from "@/components/settings/settings-sidebar";
import type { Sidebar } from "@/components/ui/sidebar";

/** 管理后台与偏好设置共用同一张「设置」左栏（见 settings-sidebar.tsx）。 */
export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return <SettingsSidebar {...props} />;
}
