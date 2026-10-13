/*
 * ChisaBot service worker（DESIGN.md §40，docs/pwa.md）。
 *
 * 只做两件事，而且都不会挡住新版本：
 *   1. 页面导航（index.html）：永远先走网络（navigation preload），拿到什么就给什么——包括登录网关的跳转。
 *      只有网络真的断了才给一张「网络不可用」的离线卡片。旧的 index.html 从不缓存，所以部署后刷新一次一定是新入口。
 *   2. /assets/*（文件名带内容哈希，内容永不改变）：命中缓存直接给，没命中走网络，200 才存。
 *      缺失的分包服务器回 404，这里原样转交、不缓存——前端的「分包过期自动刷新一次」（app/src/lib/stale-chunk.ts，PR #64）照常工作。
 * 其它请求（/api、/auth、WebSocket、非 GET、跨域、Range 请求、/magpie-admin、/downloads…）一律不拦，浏览器照常处理。
 *
 * 出问题时的退路：把这个文件换成只调用 self.registration.unregister() 的版本即可；或者在浏览器里
 * localStorage.setItem("chisabot-sw", "off") 后刷新，页面会注销它（app/src/lib/pwa.ts）。
 */
const ASSET_CACHE = "chisabot-assets-v1";
const MAX_ASSETS = 400;
const SKIP_NAV = /^\/(api|auth|magpie-admin|downloads|workspace|sign-in)(\/|$)/;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("chisabot-") && key !== ASSET_CACHE).map((key) => caches.delete(key)));
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch {}
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (SKIP_NAV.test(url.pathname)) return;
    event.respondWith(navigate(event));
    return;
  }

  if (url.pathname.startsWith("/assets/") && !request.headers.has("range")) {
    event.respondWith(asset(request));
  }
});

async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    return offline();
  }
}

async function asset(request) {
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
  } catch {
    // Cache storage unavailable (private mode, quota): fall through to the network.
  }
  const response = await fetch(request);
  if (cache && response.status === 200 && response.type === "basic" && !response.redirected) {
    const copy = response.clone();
    cache
      .put(request, copy)
      .then(() => trim(cache))
      .catch(() => {});
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const extra = keys.length - MAX_ASSETS;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

function offline() {
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#9dbddc"><title>ChisaBot · 网络不可用</title><style>
html,body{margin:0;height:100%}body{display:grid;place-items:center;padding:24px;box-sizing:border-box;font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#16181d;background:linear-gradient(180deg,#6f9bc7 0%,#9dbddc 38%,#c9dbeb 68%,#e4ecf3 100%)}
.card{max-width:340px;width:100%;padding:28px 24px 24px;border-radius:24px;background:rgba(255,255,255,.62);border:1px solid rgba(255,255,255,.75);box-shadow:0 12px 34px rgba(40,70,110,.14);backdrop-filter:saturate(160%) blur(22px);text-align:center}
h1{margin:0 0 8px;font-size:20px;line-height:28px;font-weight:600}p{margin:0 0 20px;font-size:14px;line-height:22px;color:#3b3f48}
button{height:44px;padding:0 24px;border:0;border-radius:999px;background:#16181d;color:#fff;font:inherit;font-size:15px;cursor:pointer}
@media (prefers-color-scheme:dark){body{color:#e8ecf3;background:linear-gradient(180deg,#0c1626,#12203a 38%,#172a46 68%,#1b304d)}.card{background:rgba(30,42,60,.72);border-color:rgba(255,255,255,.08)}p{color:#c7cedb}button{background:#e8ecf3;color:#10161f}}
</style></head><body><div class="card" role="alert"><h1>网络不可用</h1><p>ChisaBot 需要联网才能使用。请检查网络连接后重试。</p><button type="button" onclick="location.reload()">重新加载</button></div></body></html>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
