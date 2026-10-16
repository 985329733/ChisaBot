import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { client, tryClient } from "@/lib/client";

/**
 * 浏览器收藏夹（DESIGN.md §95）。每个用户一份，所有机器人的浏览器共用；起始页上的常用网站就是前 12 个。
 * 第一次读的时候服务器种下起始页原来的五个网站。
 */
export type Bookmark = { id: string; title: string; url: string; position: number };

export const bookmarkKeys = { all: ["browser-bookmarks"] as const };

export function bookmarksQueryOptions() {
  return queryOptions({
    queryKey: bookmarkKeys.all,
    queryFn: () => client<Bookmark[]>("/api/browser-bookmarks", "bookmarks", { fallback: "无法加载收藏夹" }),
    staleTime: 60_000,
    retry: false,
  });
}

/** 网址比较时忽略 #片段 和末尾的 /。 */
export function sameBookmarkUrl(a: string, b: string): boolean {
  const tidy = (value: string) => {
    try {
      const parsed = new URL(value);
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return value.replace(/\/$/, "");
    }
  };
  return tidy(a) === tidy(b);
}

export function findBookmark(bookmarks: readonly Bookmark[] | undefined, url: string): Bookmark | undefined {
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return bookmarks?.find((bookmark) => sameBookmarkUrl(bookmark.url, url));
}

/** 推给机器人浏览器的起始页。失败不提示：下次打开画面会再推。 */
export function syncStartLinks(botId: string): void {
  void tryClient(`/api/browser-bookmarks/sync/${encodeURIComponent(botId)}`, { method: "POST", body: {} }).catch(
    () => undefined,
  );
}

async function after(queryClient: QueryClient, botId: string | undefined) {
  await queryClient.invalidateQueries({ queryKey: bookmarkKeys.all });
  if (botId) syncStartLinks(botId);
}

export async function addBookmark(queryClient: QueryClient, input: { title?: string; url: string }, botId?: string) {
  const bookmark = await client<Bookmark>("/api/browser-bookmarks", "bookmark", {
    method: "POST",
    body: input,
    fallback: "没能收藏",
  });
  await after(queryClient, botId);
  return bookmark;
}

export async function updateBookmark(
  queryClient: QueryClient,
  id: string,
  input: { title?: string; url?: string },
  botId?: string,
) {
  const bookmark = await client<Bookmark>(`/api/browser-bookmarks/${encodeURIComponent(id)}`, "bookmark", {
    method: "PATCH",
    body: input,
    fallback: "没能保存",
  });
  await after(queryClient, botId);
  return bookmark;
}

export async function removeBookmark(queryClient: QueryClient, id: string, botId?: string) {
  await client(`/api/browser-bookmarks/${encodeURIComponent(id)}`, { method: "DELETE", fallback: "没能删除" });
  await after(queryClient, botId);
}

export async function reorderBookmarks(queryClient: QueryClient, ids: string[], botId?: string) {
  queryClient.setQueryData<Bookmark[]>(bookmarkKeys.all, (current) => {
    if (!current) return current;
    const byId = new Map(current.map((bookmark) => [bookmark.id, bookmark]));
    return ids.flatMap((id, position) => {
      const found = byId.get(id);
      return found ? [{ ...found, position }] : [];
    });
  });
  await client("/api/browser-bookmarks/order", { method: "PUT", body: { ids }, fallback: "没能调整顺序" });
  await after(queryClient, botId);
}

/** 网站首字母 + 颜色，没有图标时画在收藏 / 标签前面。 */
export function siteMonogram(title: string, url: string): { letter: string; color: string } {
  let host = "";
  try {
    host = new URL(url).host;
  } catch {}
  const known: Record<string, [string, string]> = {
    "www.bing.com": ["B", "#0f7bd8"],
    "www.baidu.com": ["百", "#2b5bd7"],
    "github.com": ["G", "#24292f"],
    "zh.wikipedia.org": ["W", "#6b7280"],
    "www.bilibili.com": ["B", "#fb7299"],
  };
  const hit = known[host];
  if (hit) return { letter: hit[0], color: hit[1] };
  const colours = ["#0f7bd8", "#2b5bd7", "#24292f", "#6b7280", "#fb7299", "#0d9488", "#7c3aed", "#ea580c"];
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const letter = (Array.from((title || host || "?").trim())[0] ?? "?").toUpperCase();
  return { letter, color: colours[hash % colours.length] as string };
}
