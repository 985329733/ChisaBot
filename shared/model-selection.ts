/** Safe public projections. Model keys and connection credentials stay on the server. */
export type ModelCatalogEntry = {
  id: string;
  label: string;
  provider: string;
  contextWindow?: number;
};

export type ModelCatalog = {
  models: ModelCatalogEntry[];
  fetchedAt: number;
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
