import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/** 上游旧技能页已由 设置 → 技能（DESIGN.md §51）取代，重定向过去（§57 导航收敛）。 */
const skillsSearchSchema = z.object({
  new: z.boolean().optional(),
  edit: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/skills")({
  validateSearch: skillsSearchSchema,
  beforeLoad: () => {
    throw redirect({ to: "/settings/skills", replace: true });
  },
});
