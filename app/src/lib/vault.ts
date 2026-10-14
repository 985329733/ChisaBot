import { queryOptions } from "@tanstack/react-query";
import type { VaultRequestView, VaultSecretView } from "../../../shared/vault";
import { client } from "@/lib/client";

/** 密钥保险箱（DESIGN.md §52，docs/vault.md）。值只往服务器送，从不读回来。 */
export const vaultKeys = { all: ["vault"] as const, request: (name: string) => ["vault", "request", name] as const };

export function vaultQueryOptions() {
  return queryOptions({
    queryKey: vaultKeys.all,
    queryFn: ({ signal }): Promise<VaultSecretView[]> => client("/api/vault", "secrets", { fallback: "无法加载保险箱", signal }),
    refetchOnWindowFocus: "always",
  });
}

export function vaultRequestQueryOptions(name: string, poll: boolean) {
  return queryOptions({
    queryKey: vaultKeys.request(name),
    queryFn: ({ signal }): Promise<VaultRequestView | null> =>
      client(`/api/vault/requests?name=${encodeURIComponent(name)}`, "request", { fallback: "无法读取请求", signal }),
    refetchInterval: poll ? 1500 : false,
    enabled: Boolean(name),
  });
}

export function saveVaultSecret(input: { name: string; label: string; domains: string[]; value?: string | null }): Promise<VaultSecretView> {
  return client("/api/vault", "secret", { method: "POST", body: input, fallback: "保存失败，请重试" });
}

export async function deleteVaultSecret(id: string) {
  await client(`/api/vault/${encodeURIComponent(id)}`, { method: "DELETE", fallback: "删除失败，请重试" });
}

export function fillVaultRequest(id: string, input: { value: string; domains?: string[] }): Promise<VaultSecretView> {
  return client(`/api/vault/requests/${encodeURIComponent(id)}/fill`, "secret", { method: "POST", body: input, fallback: "保存失败，请重试" });
}

export async function cancelVaultRequest(id: string) {
  await client(`/api/vault/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", fallback: "取消失败" });
}
