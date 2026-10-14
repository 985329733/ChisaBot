import { createFileRoute, redirect } from "@tanstack/react-router";

/** 旧「团队 Bot」页已去掉：机器人一律私有（DESIGN.md §46、§57 导航收敛），重定向到机器人列表。 */
export const Route = createFileRoute("/_authed/_app/team-bots")({
  beforeLoad: () => {
    throw redirect({ to: "/bots", replace: true });
  },
});
