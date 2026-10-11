import { useEffect, useState } from "react";

/**
 * ChisaBot PC 无边框窗口的窗口控制（DESIGN.md §18）。
 *
 * PC 客户端的主窗口没有系统标题栏：网页自己的顶栏就是标题栏（拖动区 + 最小化 / 最大化 / 关闭）。
 * 桥由 Electron 的 web-preload 只在已登录服务器的顶层页面里注入；普通浏览器里 `window.chisabotWindow`
 * 不存在，顶栏、圆角、内边距都和以前一样。
 */
export type DesktopWindowBridge = {
  platform: string;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  onMaximizedChange(callback: (maximized: boolean) => void): () => void;
};

declare global {
  interface Window {
    chisabotWindow?: DesktopWindowBridge;
  }
}

export function desktopWindow(): DesktopWindowBridge | null {
  return typeof window !== "undefined" && window.chisabotWindow ? window.chisabotWindow : null;
}

/**
 * 在 PC 客户端里返回 { maximized }，并把 `data-desktop` / `data-maximized` 写到 <html> 上，
 * 让样式表给整页加圆角（最大化时去掉）；在浏览器里返回 null，什么都不改。
 */
export function useDesktopWindow(): { bridge: DesktopWindowBridge; maximized: boolean } | null {
  const bridge = desktopWindow();
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!bridge) return;
    const root = document.documentElement;
    root.dataset.desktop = bridge.platform || "win32";
    let alive = true;
    void bridge
      .isMaximized()
      .then((value) => alive && setMaximized(value))
      .catch(() => {});
    const off = bridge.onMaximizedChange((value) => setMaximized(value));
    return () => {
      alive = false;
      off();
    };
  }, [bridge]);
  useEffect(() => {
    if (!bridge) return;
    document.documentElement.dataset.maximized = maximized ? "true" : "false";
  }, [bridge, maximized]);
  return bridge ? { bridge, maximized } : null;
}
