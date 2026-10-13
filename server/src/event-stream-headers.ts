/**
 * 流式回复（SSE）对任何反向代理都声明「别缓冲、别压缩」（docs/streaming.md）：
 * nginx 认 `X-Accel-Buffering: no`；`no-transform` 让 CDN / 代理不去 gzip 它（gzip 会攒够一块才发，
 * 回复就一段一段地蹦）。自带网关本来就关了缓冲，这两个头是给自己部署、前面再套一层代理的人用的。
 */
export const markEventStreamUnbuffered = async (
  context: { res: Response },
  next: () => Promise<void>,
) => {
  await next();
  const type = context.res.headers.get("content-type") ?? "";
  if (!type.includes("text/event-stream")) return;
  try {
    context.res.headers.set("X-Accel-Buffering", "no");
    context.res.headers.set("Cache-Control", "no-cache, no-transform");
  } catch {
    // 不可变的响应头：换一个可改的响应，流本身原样传下去。
    const headers = new Headers(context.res.headers);
    headers.set("X-Accel-Buffering", "no");
    headers.set("Cache-Control", "no-cache, no-transform");
    context.res = new Response(context.res.body, {
      status: context.res.status,
      statusText: context.res.statusText,
      headers,
    });
  }
};
