/**
 * 插件目录的中文说明（CB-056，DESIGN.md §71.6）。服务端目录 `server/src/plugins/catalogue.ts`
 * 的 summary / title 保留上游英文（存储标识和测试都认它），界面按 key 换成中文；没收录的 key 原样显示。
 */
const SUMMARIES: Record<string, string> = {
  parallel: "搜索公开网页、提取来源内容。少量使用免费，不用账号。",
  "parallel-authenticated": "用本部署的 Parallel API key 搜索公开网页、提取内容。",
  "google-drive": "提问的人自己 Google Drive 里的文件。",
  notion: "提问的人自己 Notion 里的页面和数据库。",
  routines: "在你交代的职责发生时叫醒机器人的事件触发。",
};

const TITLES: Record<string, string> = {
  "parallel-authenticated": "Parallel Search（API key）",
  routines: "事件触发",
};

export function pluginSummary(key: string | undefined, fallback?: string | null): string | undefined {
  return (key && SUMMARIES[key]) || fallback || undefined;
}

export function pluginTitle(key: string | undefined, fallback: string): string {
  return (key && TITLES[key]) || fallback;
}
