import { IconCamera, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { createPortal } from "react-dom";

/**
 * 用户明确要「截个图」时，对话里放一张缩略图（2026-10-13，Hark 第二轮）。
 *
 * 以前没有截图工具，机器人只能说「我没有截图工具」——可画面明明就在右栏。现在 computer_screenshot
 * 截当前画面：缩成 JPEG 存在本机（localStorage，按工具调用 id，最多留 24 张），对话里显示缩略图，
 * 点开看大图。图片不进模型上下文、也不进会话记录（太大）；换设备打开同一会话只看到一行「截图」。
 */
const KEY = "chisabot-shots";
const KEEP = 24;

type Stored = Record<string, { src: string; url?: string; at: number }>;
function load(): Stored {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Stored;
  } catch {
    return {};
  }
}
export function keepShot(id: string, src: string, url?: string) {
  try {
    const all = load();
    all[id] = { src, ...(url ? { url } : {}), at: Date.now() };
    const ids = Object.keys(all).sort((a, b) => (all[b]?.at ?? 0) - (all[a]?.at ?? 0));
    for (const old of ids.slice(KEEP)) delete all[old];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 本机存不下就算了：这张图只是锦上添花，画面本来就在右栏。
  }
}
export function shotFor(id: string | undefined) {
  return id ? load()[id] : undefined;
}

/** 把 PNG 缩成宽 ≤960 的 JPEG（约 60–120KB），够看清又不撑爆本机存储。 */
export async function shrinkPng(base64: string): Promise<string> {
  const img = new Image();
  img.src = `data:image/png;base64,${base64}`;
  await img.decode();
  const scale = Math.min(1, 960 / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export function ScreenshotCard({ id, running, failed, url }: { id?: string; running: boolean; failed?: string; url?: string }) {
  const [open, setOpen] = useState(false);
  const shot = shotFor(id);
  let host = url ?? shot?.url ?? "";
  try {
    if (host) host = new URL(host).hostname.replace(/^www\./, "");
  } catch {}
  if (running)
    return (
      <span className="shot-card shot-card-line">
        <IconLoader2 className="size-4 animate-spin" /> 正在截图…
      </span>
    );
  if (failed || !shot)
    return (
      <span className="shot-card shot-card-line" title={failed}>
        <IconCamera className="size-4" /> {failed ? "没截到图" : `截图${host ? ` · ${host}` : ""}`}
      </span>
    );
  return (
    <>
      <button className="shot-card" onClick={() => setOpen(true)} title="点开看大图" type="button">
        <img alt={`${host || "页面"}的截图`} src={shot.src} />
        {host ? <span className="shot-card-host">{host}</span> : null}
      </button>
      {open
        ? createPortal(
            <div aria-label="截图" aria-modal="true" className="shot-zoom" onClick={() => setOpen(false)} role="dialog">
              <img alt="截图大图" src={shot.src} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
