import { queryOptions } from "@tanstack/react-query";
import type { MagpieOverview } from "../../../shared/model-selection";
import { client } from "@/lib/client";

/**
 * Magpie, the model gateway every BOT's model is routed through (docs/magpie.md).
 *
 * The console is served same-origin by ChisaBot's server under `MAGPIE_CONSOLE_PATH`, behind the
 * ChisaBot sign-in and administrators only; the Magpie web key never reaches the browser.
 * 管理后台 → 模型平台 Magpie embeds it. `MAGPIE_ADMIN_URL` is only an optional extra public link
 * (the old separate entry), kept for deployments that still build with it.
 */
export const MAGPIE_CONSOLE_PATH = "/magpie-admin/";

export const MAGPIE_ADMIN_URL: string | undefined = (() => {
  const configured = import.meta.env.VITE_MAGPIE_MANAGEMENT_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
})();

export const magpieKeys = { overview: ["magpie", "overview"] as const };

export async function loadMagpieOverview(refresh = false, signal?: AbortSignal): Promise<MagpieOverview> {
  const response = await client(`/api/admin/magpie${refresh ? "?refresh=1" : ""}`, {
    fallback: "无法读取 Magpie 状态，请重试。",
    signal,
  });
  return response.json();
}

export function magpieOverviewQueryOptions() {
  return queryOptions({
    queryKey: magpieKeys.overview,
    queryFn: ({ signal }) => loadMagpieOverview(false, signal),
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: "always",
  });
}

/** "刚刚 / 3 分钟前 / 2 小时前", for sync times. */
export function agoText(at?: number) {
  if (!at) return "尚未同步";
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 45) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}
