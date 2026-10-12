import { IconAlertTriangle, IconLoader2, IconWorld } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";

/**
 * 聊天里一次「打开网页」的样子（2026-10-13）：一行小条——图标、页面标题、网址。
 *
 * 以前这里是一整张浏览器截图，和右栏「计算机」里的实时画面重复，一轮开三个网页就是三张大图把回答
 * 挤到屏幕外。Hark 的做法是画面只在浏览器卡片里，对话里只留一行；点这一行就切到右栏「计算机」。
 */
export function BrowseChip({
  url,
  title,
  state,
}: {
  url?: string;
  title?: string;
  state: "running" | "done" | "failed";
}) {
  const navigate = useNavigate();
  let host = url ?? "";
  try {
    if (url) {
      const u = new URL(url);
      host = u.hostname === "workspace.local" ? `工作区 · ${decodeURIComponent(u.pathname.slice(1))}` : u.hostname.replace(/^www\./, "");
    }
  } catch {}
  const label =
    state === "running" ? `正在打开 ${host || "网页"}…` : state === "failed" ? `没能打开 ${host || "网页"}` : title || host || "已打开网页";
  return (
    <button
      className="browse-chip"
      data-state={state}
      onClick={() =>
        void navigate({ search: ((previous: Record<string, unknown>) => ({ ...previous, watch: true })) as never })
      }
      title={url ? `${url}\n点击在右栏查看浏览器` : "点击在右栏查看浏览器"}
      type="button"
    >
      <span aria-hidden className="browse-chip-icon">
        {state === "running" ? (
          <IconLoader2 className="size-4 animate-spin" />
        ) : state === "failed" ? (
          <IconAlertTriangle className="size-4 text-amber-600" />
        ) : (
          <IconWorld className="size-4" />
        )}
      </span>
      <span className="browse-chip-text">
        <span className="browse-chip-title">{label}</span>
        {state === "done" && host && title ? <span className="browse-chip-host">{host}</span> : null}
      </span>
    </button>
  );
}
