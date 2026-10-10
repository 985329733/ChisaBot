import { queryOptions } from "@tanstack/react-query";
import { client } from "@/lib/client";
import type { ModelSettingsCurrent } from "./form";

export const modelSettingsKeys = {
  current: ["model-settings", "current"] as const,
};

export function modelSettingsQueryOptions() {
  return queryOptions({
    queryKey: modelSettingsKeys.current,
    queryFn: () =>
      client<ModelSettingsCurrent>("/api/admin/model-settings", "config", {
        fallback: "无法加载模型设置。",
      }),
  });
}
