import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";

/** 设置 → 技能（DESIGN.md §51，docs/skills.md）。 */
export type ChisaSkill = { slug: string; title: string; summary: string; instructions: string; mine: boolean };

export const chisaSkillKeys = { all: ["chisa-skills"] as const };

export function chisaSkillsQueryOptions() {
  return queryOptions({
    queryKey: chisaSkillKeys.all,
    queryFn: ({ signal }): Promise<ChisaSkill[]> => client("/api/chisa-skills", "skills", { fallback: "无法加载技能", signal }),
    refetchOnWindowFocus: "always",
  });
}

export function saveChisaSkill(slug: string, input: { title: string; summary: string; instructions: string; create?: boolean }): Promise<ChisaSkill> {
  return client(`/api/chisa-skills/${encodeURIComponent(slug)}`, "skill", { method: "PUT", body: input, fallback: "保存失败，请重试" });
}

export async function deleteChisaSkill(slug: string) {
  await client(`/api/chisa-skills/${encodeURIComponent(slug)}`, { method: "DELETE", fallback: "删除失败，请重试" });
}
