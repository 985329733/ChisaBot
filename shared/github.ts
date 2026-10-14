/**
 * GitHub 账号连接（DESIGN.md §53，docs/github.md）。
 *
 * 用户在 设置 → 账号连接 里贴一个 GitHub 令牌（推荐 fine-grained，只勾需要的仓库和权限）；令牌存进
 * 密钥保险箱（保留名字 `github`，只允许发往 api.github.com），从不进模型。机器人拿到 github_* 工具：
 * 读（仓库、Issue、PR、文件）直接执行；写（建 Issue、评论、建 PR）先在聊天里出确认卡片，用户点「允许」才发。
 */
export type GithubTokenKind = "fine-grained" | "classic" | "oauth" | "other";

export type GithubConnectionView = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  htmlUrl: string;
  tokenKind: GithubTokenKind;
  /** classic 令牌的 scopes（X-OAuth-Scopes）；fine-grained 没有。 */
  scopes: string[];
  /** 令牌末四位。 */
  hint: string;
  status: "ok" | "invalid";
  connectedAt: string;
  checkedAt: string;
};

export type GithubActionKind = "create_issue" | "comment" | "create_pr";

export type GithubActionView = {
  id: string;
  kind: GithubActionKind;
  repo: string;
  agentId: string;
  /** 给用户看的内容：title / body / number / head / base / draft / labels。 */
  payload: {
    title?: string;
    body?: string;
    number?: number;
    head?: string;
    base?: string;
    draft?: boolean;
    labels?: string[];
  };
  status: "pending" | "running" | "done" | "failed" | "rejected" | "expired";
  result: { url?: string; number?: number; error?: string } | null;
  createdAt: string;
  decidedAt: string | null;
};

export const GITHUB_REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

export function githubTokenKind(token: string): GithubTokenKind {
  if (token.startsWith("github_pat_")) return "fine-grained";
  if (token.startsWith("ghp_")) return "classic";
  if (token.startsWith("gho_") || token.startsWith("ghu_")) return "oauth";
  return "other";
}

/**
 * 创建 fine-grained 令牌的页面：预填名称、说明、90 天有效期和权限（contents / issues / pull_requests 读写，
 * metadata 只读自动带上）。仓库范围不能预填，用户自己选。GitHub 2025-08 起支持这些查询参数。
 */
export const GITHUB_NEW_TOKEN_URL =
  "https://github.com/settings/personal-access-tokens/new?name=ChisaBot&description=ChisaBot%20%E6%9C%BA%E5%99%A8%E4%BA%BA%E4%BD%BF%E7%94%A8&expires_in=90&contents=write&issues=write&pull_requests=write";
