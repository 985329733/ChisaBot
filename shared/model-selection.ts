/** Safe public projections. Model keys and connection credentials stay on the server. */
export type ModelCatalogEntry = {
  id: string;
  label: string;
  provider: string;
  /** The provider's display name when the gateway gives one (Magpie: "… · OpenCode Zen"). */
  providerName?: string;
  contextWindow?: number;
  /** 这个模型一次最多能输出多少 token（Magpie: max_output_tokens）。服务器用它给不认识的模型定输出上限。 */
  maxOutputTokens?: number;
  /** 能不能看图（目录里的 input modalities / vision 标记）；目录没说就不写（当作能）。识图模型用（DESIGN.md §59）。 */
  supportsImages?: boolean;
};

/** Gateway-side readiness of one provider, from Magpie's admin API. Never carries keys. */
export type ModelProviderHealth = {
  id: string;
  name: string;
  ready: boolean;
  enabled: boolean;
};

export type ModelCatalog = {
  models: ModelCatalogEntry[];
  fetchedAt: number;
  /** "magpie" when the list came from a Magpie gateway. */
  source?: "magpie" | "gateway";
  /** True when the gateway could not be reached and this is the last good list. */
  stale?: boolean;
  providers?: ModelProviderHealth[];
};

/** 管理后台 → 模型平台 Magpie. A safe projection: no keys, no upstream prose. */
export type MagpieOverview = {
  configured: boolean;
  managementAvailable: boolean;
  managementPath: string;
  reachable: boolean;
  version?: string;
  gatewayOn?: boolean;
  checkedAt: number;
  error?: string;
  providers: (ModelProviderHealth & { models: number })[];
  connection: {
    viaMagpie: boolean;
    protocol: "openai" | "anthropic";
    baseUrl: string;
    defaultModel: string;
    source: "environment" | "saved";
  } | null;
  catalog: {
    fetchedAt?: number;
    count?: number;
    source?: "magpie" | "gateway";
    lastAttemptAt?: number;
    lastError?: string;
    autoRefreshMinutes: number;
  };
};

/** The effective model and its optional persistent override belong to one BOT. */
export type AgentModelState = {
  agentId: string;
  model: string;
  overrideModel: string | null;
  defaultModel: string;
  /** This deployment runs the BOT locally and can select its model; not catalog membership. */
  available: boolean;
  canManage: boolean;
};
