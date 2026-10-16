import { groupLabel, type SettingsItem, type SettingsPage, type SettingsViewer, visiblePages } from "./registry";

/**
 * 设置搜索（DESIGN.md §97）：在登记表里搜页和页里的项。标题、说明、同义词（中文 / 拼音首字母 / 英文）、组名都算。
 * 纯函数，单测直接驱动。
 */
export type SettingsHit = {
  /** 页 id，或 `页id.项id`。 */
  id: string;
  page: SettingsPage;
  item?: SettingsItem;
  title: string;
  description: string;
  /** 「机器人 › 权限与审批」。 */
  path: string;
  score: number;
};

const norm = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

function fieldScore(token: string, title: string, keywords: readonly string[], description: string, group: string): number {
  const t = norm(title);
  if (t === token) return 100;
  if (t.startsWith(token)) return 80;
  if (t.includes(token)) return 60;
  const keys = keywords.map(norm);
  if (keys.some((k) => k === token)) return 50;
  if (keys.some((k) => k.startsWith(token))) return 40;
  if (keys.some((k) => k.includes(token))) return 30;
  if (norm(description).includes(token)) return 20;
  if (group && norm(group).includes(token)) return 10;
  return 0;
}

export function searchSettings(query: string, viewer: SettingsViewer, limit = 12): SettingsHit[] {
  const q = norm(query);
  if (!q) return [];
  // 中文常常不打空格：整句先当一个词试；不中再按空格拆开，每个词都要中。
  const tokens = q.includes(" ") ? q.split(" ").filter(Boolean) : [q];
  const hits: SettingsHit[] = [];
  for (const page of visiblePages(viewer)) {
    const group = groupLabel(page.group) ?? "";
    const pagePath = group && group !== page.title ? `${group} › ${page.title}` : page.title;
    const score = (title: string, keywords: readonly string[], description: string, bonus: number) => {
      let total = 0;
      for (const token of tokens) {
        const s = fieldScore(token, title, keywords, description, group);
        if (!s) return 0;
        total += s;
      }
      return total + bonus;
    };
    const pageScore = score(page.title, page.keywords, page.sub, 5);
    if (pageScore) hits.push({ id: page.id, page, title: page.title, description: page.sub, path: group || "设置", score: pageScore });
    for (const item of page.items) {
      // 项也认页的标题（「模型 备用」）：页名命中的词不再要求项自己命中。
      const itemScore = (() => {
        let total = 0;
        let ownHits = 0;
        for (const token of tokens) {
          const own = fieldScore(token, item.title, item.keywords ?? [], item.description, "");
          const viaPage = own ? 0 : fieldScore(token, page.title, page.keywords, "", group) > 0 ? 5 : 0;
          if (!own && !viaPage) return 0;
          if (own) ownHits++;
          total += own || viaPage;
        }
        return ownHits ? total + (item.weight ?? 0) : 0;
      })();
      if (itemScore) hits.push({ id: `${page.id}.${item.id}`, page, item, title: item.title, description: item.description, path: pagePath, score: itemScore });
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}

/** 搜索跳转用的地址：项带 `#find=<id>`，页面加载后按项的 `find` 文字找到那一块。 */
export function hitHash(hit: Pick<SettingsHit, "id" | "item">): string | undefined {
  return hit.item ? `find=${hit.id}` : undefined;
}
