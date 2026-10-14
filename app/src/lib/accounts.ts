import { queryOptions } from "@tanstack/react-query";

/**
 * 设置 → 管理 → 账号（CB-040，DESIGN.md §65）：朋友账号与邀请链接。
 * 账号在登录网关里（deploy/public/auth/server.ts 的 /auth/admin/*），不在应用库里；
 * 没有网关（本机开发、预览）或网关没开多账号时，接口返回 404 / 不是 JSON，页面显示说明。
 */
export type GatewayAccount = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
  disabled: boolean;
  builtin: boolean;
  createdAt: number | null;
  lastLoginAt: number | null;
};
export type GatewayInvite = {
  id: string;
  kind: "invite" | "reset";
  accountId: string | null;
  note: string | null;
  createdAt: number;
  expiresAt: number;
};
export type AccountsState =
  | { available: true; me: string; accounts: GatewayAccount[]; invites: GatewayInvite[] }
  | { available: false; reason: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const data = (await response.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
  if (!response.ok || !data || data.ok === false) throw new Error(data?.error || `请求失败（${response.status}）`);
  return data;
}

export const accountKeys = { all: ["gateway-accounts"] as const };

export function accountsQueryOptions() {
  return queryOptions({
    queryKey: accountKeys.all,
    queryFn: async (): Promise<AccountsState> => {
      const response = await fetch("/auth/admin/accounts", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const type = response.headers.get("Content-Type") || "";
      if (!type.includes("application/json")) return { available: false, reason: "这个部署前面没有 ChisaBot 登录网关，账号由部署方式决定。" };
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; multiAccount?: boolean; me?: string; accounts?: GatewayAccount[]; invites?: GatewayInvite[] }
        | null;
      if (response.status === 404 && data?.multiAccount === false)
        return { available: false, reason: "登录网关还没开启多账号（服务器上的 identitySecret 没有配置），见 docs/accounts.md。" };
      if (!response.ok || !data?.accounts) throw new Error(data?.error || `读取失败（${response.status}）`);
      return { available: true, me: data.me ?? "", accounts: data.accounts, invites: data.invites ?? [] };
    },
    staleTime: 10_000,
  });
}

export async function createInvite(input: { note?: string; hours?: number }) {
  return (await call<{ invite: { id: string; url: string; expiresAt: number } }>("/auth/admin/invites", { method: "POST", body: JSON.stringify(input) })).invite;
}
export async function revokeInvite(id: string) {
  await call(`/auth/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export async function setAccountDisabled(id: string, disabled: boolean) {
  await call(`/auth/admin/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ disabled }) });
}
export async function resetAccount(id: string) {
  return (await call<{ invite: { id: string; url: string; expiresAt: number } }>(`/auth/admin/accounts/${encodeURIComponent(id)}/reset`, { method: "POST", body: "{}" })).invite;
}
export async function deleteAccount(id: string) {
  await call(`/auth/admin/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** 「3 天后过期」这类说明。 */
export function expiresText(at: number, now = Date.now()): string {
  const hours = Math.max(0, (at - now) / 3_600_000);
  if (hours < 1) return "不到 1 小时后过期";
  if (hours < 48) return `${Math.round(hours)} 小时后过期`;
  return `${Math.round(hours / 24)} 天后过期`;
}

export function lastSeenText(at: number | null, now = Date.now()): string {
  if (!at) return "还没登录过";
  const seconds = Math.max(0, (now - at) / 1000);
  if (seconds < 60) return "刚刚登录";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前登录`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前登录`;
  return `${Math.floor(seconds / 86400)} 天前登录`;
}
