import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * 旧「代理」页（上游 Agents：您的代理 / 探索代理）已并入机器人（DESIGN.md §57 导航收敛）：
 * /agents?agent=<id> → 该机器人的资料页，其余 → 机器人列表。
 */
const agentsSearchSchema = z.object({
  new: z.boolean().optional(),
  agent: z.string().optional(),
});

export const Route = createFileRoute("/_authed/_app/agents/")({
  validateSearch: agentsSearchSchema,
  beforeLoad: ({ search }) => {
    if (search.agent) throw redirect({ to: "/bots/$agentId", params: { agentId: search.agent }, replace: true });
    throw redirect({ to: "/bots", replace: true });
  },
});
