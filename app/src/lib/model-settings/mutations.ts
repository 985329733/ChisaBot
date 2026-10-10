import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { client } from "@/lib/client";
import { credentialKeys } from "@/lib/credentials/queries";
import type { ModelSettingsCurrent, ModelSettingsInput } from "./form";
import { modelSettingsKeys } from "./queries";

export type ModelConnectionResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
};

export function saveModelSettingsMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    gcTime: 0,
    mutationFn: (input: ModelSettingsInput) =>
      client<ModelSettingsCurrent>("/api/admin/model-settings", "config", {
        method: "PUT",
        body: input,
        fallback: "无法保存模型设置。",
      }),
    onSuccess: (config) => {
      queryClient.setQueryData(modelSettingsKeys.current, config);
      return queryClient.invalidateQueries({ queryKey: credentialKeys.all });
    },
  });
}

export function testModelConnectionMutationOptions() {
  return mutationOptions({
    gcTime: 0,
    mutationFn: async (
      input: ModelSettingsInput,
    ): Promise<ModelConnectionResult> => {
      const response = await client("/api/admin/model-settings/test", {
        method: "POST",
        body: input,
        fallback: "无法测试模型连接。",
      });
      return response.json();
    },
  });
}
