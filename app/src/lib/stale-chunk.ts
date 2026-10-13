/**
 * 部署新版本后，开着的旧页面再点进一个还没加载过的页面（例如 设置 → 模型）会去要旧版本的路由分包；
 * 新镜像里已经没有那个文件。以前服务器把缺失的 /assets/* 也当成前端路由回了 index.html，浏览器拿 HTML
 * 当 JS 模块加载失败，整页落到「无法加载此页面」——用户看到的就是「模型设置崩了」（2026-10-13）。
 *
 * 现在：服务器对缺失的 /assets/* 回 404；这里识别「分包加载失败」，自动整页刷新一次拿到新入口。
 * 30 秒内只自动刷新一次（sessionStorage 记时间），网络真断时不会无限刷新，而是停在出错页让用户手动重试。
 */
const KEY = "chisabot-stale-chunk-reload-at";
const WINDOW_MS = 30_000;

const CHUNK_ERROR =
  /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to load module script|Unable to preload CSS|MIME type|ChunkLoadError|Loading (CSS )?chunk \S+ failed/i;

export function isStaleChunkError(error: unknown): boolean {
  if (!error) return false;
  const text =
    typeof error === "string"
      ? error
      : `${(error as { name?: string }).name ?? ""} ${(error as { message?: string }).message ?? ""}`;
  return CHUNK_ERROR.test(text);
}

/** 刷新一次（30 秒内第二次返回 false，不刷新）。 */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    window.sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // sessionStorage 不可用时也只刷新这一次（页面重载后状态自然清零，不会形成循环以外的问题）。
  }
  window.location.reload();
  return true;
}

/** Vite 在预加载分包失败时派发 `vite:preloadError`；拦下来改成刷新，而不是让路由报错。 */
export function installStaleChunkReload() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForStaleChunk()) event.preventDefault();
  });
}
