import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游群聊已删除：一个机器人一段对话（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/_app/group/$channelId")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
