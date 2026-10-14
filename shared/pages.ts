/**
 * 页面（DESIGN.md §54，docs/pages.md）：机器人做的单页网页（行程、邀请函、报告、作品集），
 * 发布在不公开列出的链接 /p/<随机串>/ 上，任何人拿到链接不用登录就能看。
 *
 * 页面在沙箱里打开（CSP sandbox，没有 allow-same-origin）：脚本能跑，但读不到 ChisaBot 的 Cookie、
 * 也连不了任何接口（connect-src 'none'），表单也提交不出去。
 */
export const PAGE_SLUG = /^[a-z0-9]{16}$/;
export const PAGE_ASSET_NAME = /^[a-z0-9][a-z0-9._-]{0,78}[a-z0-9]$/;

export const PAGE_ASSET_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  pdf: "application/pdf",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  woff2: "font/woff2",
};

export const PAGE_LIMITS = {
  htmlBytes: 1_000_000,
  cssBytes: 200_000,
  assetBytes: 8 * 1024 * 1024,
  pageAssetBytes: 40 * 1024 * 1024,
  assetsPerPage: 40,
  versionsKept: 50,
  pagesPerUser: 200,
} as const;

export type PageView = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  published: boolean;
  version: number;
  versions: number;
  assets: number;
  agentId: string | null;
  /** /p/<slug>/ —— 浏览器自己拼上 location.origin。 */
  path: string;
  createdAt: string;
  updatedAt: string;
};

export type PageVersionView = {
  version: number;
  title: string;
  note: string | null;
  bytes: number;
  createdAt: string;
  current: boolean;
};

export type PageAssetView = {
  name: string;
  type: string;
  bytes: number;
  createdAt: string;
};

export const pagePath = (slug: string) => `/p/${slug}/`;
