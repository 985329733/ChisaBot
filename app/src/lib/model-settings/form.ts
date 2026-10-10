import { normalizeModelBaseUrl } from "../../../../shared/model-base-url";

export type ModelSettingsDraft = {
  provider: "openai" | "anthropic";
  model: string;
  baseUrl: string;
  useApiKey: boolean;
  apiKey: string;
};

export type ModelSettingsCurrent = Omit<ModelSettingsDraft, "apiKey"> & {
  hasApiKey: boolean;
  source: "environment" | "saved";
};

export type ModelSettingsErrors = Partial<
  Record<"provider" | "model" | "baseUrl" | "apiKey", string>
>;

export type ModelSettingsInput = Omit<ModelSettingsDraft, "apiKey"> & {
  apiKey?: string;
};

export function modelSettingsInput(
  draft: ModelSettingsDraft,
): ModelSettingsInput {
  const apiKey = draft.apiKey.trim();
  return {
    provider: draft.provider,
    model: draft.model.trim(),
    baseUrl:
      normalizedEndpoint(draft.baseUrl, draft.provider) ?? draft.baseUrl.trim(),
    useApiKey: draft.useApiKey,
    ...(draft.useApiKey && apiKey ? { apiKey } : {}),
  };
}

export function modelSettingsValidation(
  draft: ModelSettingsDraft,
  current: ModelSettingsCurrent,
): ModelSettingsErrors {
  const errors: ModelSettingsErrors = {};
  if (!draft.model.trim()) errors.model = "请输入模型名称。";
  const endpoint = normalizedEndpoint(draft.baseUrl, draft.provider);
  if (!endpoint) {
    errors.baseUrl =
      "请输入完整的 HTTP 或 HTTPS 地址，地址中不要包含密钥、查询参数或片段。";
  }
  if (
    draft.useApiKey &&
    !draft.apiKey.trim() &&
    (!current.useApiKey ||
      !current.hasApiKey ||
      draft.provider !== current.provider ||
      endpoint !== normalizedEndpoint(current.baseUrl, current.provider))
  ) {
    errors.apiKey = "请为此接口填写 API Key，或关闭“此接口需要 API Key”。";
  }
  return errors;
}

function normalizedEndpoint(
  value: string,
  provider: ModelSettingsDraft["provider"],
): string | null {
  try {
    const url = new URL(value.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return normalizeModelBaseUrl(provider, url.toString());
  } catch {
    return null;
  }
}
