import { createFileRoute, redirect } from "@tanstack/react-router";

/** 重复的「密码」页：保存的登录在 设置 → 账号连接 里（§57 导航收敛），重定向过去。 */
export const Route = createFileRoute("/_authed/settings/passwords")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/connected-accounts", replace: true });
  },
});
