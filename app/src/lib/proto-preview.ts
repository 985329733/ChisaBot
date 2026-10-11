import { toast } from "@/components/ui/toast";

/**
 * 原型预览构建（VITE_PROTO_PREVIEW=1）：独立沙箱实例用。正式构建里这个常量是 false，下面的代码被摇树去掉。
 *
 * - 顶栏字标旁显示「原型预览」小标签。
 * - 普通浏览器里没有 PC 客户端的窗口桥，就注入一个假的，让右上角显示 PC 版的窗口按钮：
 *   最小化 / 关闭只提示，最大化 = 浏览器全屏。
 * - 退出登录不真的退出（沙箱和线上共用登录会话，退出会把线上也退掉）。
 */
export const PROTO_PREVIEW = import.meta.env.VITE_PROTO_PREVIEW === "1";

export function installPreviewWindowBridge() {
  if (!PROTO_PREVIEW || typeof window === "undefined" || window.chisabotWindow) return;
  if (new URLSearchParams(window.location.search).get("browser") === "1") return;
  const listeners = new Set<(maximized: boolean) => void>();
  const isFull = () => Boolean(document.fullscreenElement);
  document.addEventListener("fullscreenchange", () => {
    for (const listener of listeners) listener(isFull());
  });
  window.chisabotWindow = {
    platform: "win32",
    minimize() {
      toast.info("原型预览：最小化在 PC 客户端里生效");
    },
    toggleMaximize() {
      if (isFull()) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen().catch(() => {});
    },
    close() {
      toast.info("原型预览：关闭在 PC 客户端里生效");
    },
    isMaximized: () => Promise.resolve(isFull()),
    onMaximizedChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
