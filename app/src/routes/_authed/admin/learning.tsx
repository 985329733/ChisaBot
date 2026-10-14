import { createFileRoute, redirect } from "@tanstack/react-router";

/** 上游「自动学习」页已删除：机器人学到的做法存成技能（瘦身 P4a，DESIGN.md §57）。 */
export const Route = createFileRoute("/_authed/admin/learning")({
  beforeLoad: () => {
    throw redirect({ to: "/settings/skills", replace: true });
  },
});
