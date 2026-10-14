import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「通知 / 可达性」页（Slack、Teams、短信、手机推送）已去掉，机器人接到聊天软件用 设置 → IM 接入（§57 导航收敛）。 */
export const Route = createFileRoute("/_authed/_app/reachability")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/im", replace: true });
  },
});
