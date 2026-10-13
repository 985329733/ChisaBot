import { useEffect } from "react";
import { useOptionalSidebar } from "@/components/ui/sidebar";
import { isPhone } from "@/lib/device";
import { setPanelSheetOpen, usePanelSheetOpen } from "@/lib/panels/rail-open";

/**
 * 手机上的抽屉手势（DESIGN.md §40.4）：
 * - 从屏幕左边缘往右划 → 打开左栏（机器人列表 / 设置分区）；
 * - 在打开的左栏上往左划 → 关上；在打开的面板抽屉上往右划 → 关上。
 * 只认「横着划」（水平位移明显大于竖直）；手指落在能横向滚动的东西上（表格、代码、轮播）不算，
 * 那是在滚内容。抽屉自己的进出动画照旧（transform / opacity，减少动态效果时只淡入淡出）。
 */
const EDGE = 28;
const TRIGGER = 56;

function inHorizontalScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const overflow = getComputedStyle(el).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable) return true;
    el = el.parentElement;
  }
  return false;
}

export function PhoneGestures() {
  const sidebar = useOptionalSidebar();
  const panelOpen = usePanelSheetOpen();
  const drawerOpen = Boolean(sidebar?.openMobile);
  const setDrawer = sidebar?.setOpenMobile;
  const mobile = Boolean(sidebar?.isMobile);

  useEffect(() => {
    if (!isPhone() || !mobile || !setDrawer) return;
    let start: { x: number; y: number; mode: "open" | "close-drawer" | "close-panel" } | null = null;

    const onStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      const target = event.target;
      if (inHorizontalScroller(target)) return;
      const inDrawer = target instanceof Element && target.closest('[data-slot="sidebar"][data-mobile="true"]');
      const inPanel = target instanceof Element && target.closest("#chisabot-panel-sheet");
      if (drawerOpen) start = { x: touch.clientX, y: touch.clientY, mode: "close-drawer" };
      else if (panelOpen && inPanel) start = { x: touch.clientX, y: touch.clientY, mode: "close-panel" };
      else if (!panelOpen && !inDrawer && touch.clientX <= EDGE)
        start = { x: touch.clientX, y: touch.clientY, mode: "open" };
    };
    const onMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dy) > Math.abs(dx) * 0.8 && Math.abs(dy) > 12) {
        start = null; // vertical scroll wins
        return;
      }
      if (start.mode === "open" && dx > TRIGGER) {
        setDrawer(true);
        start = null;
      } else if (start.mode === "close-drawer" && dx < -TRIGGER) {
        setDrawer(false);
        start = null;
      } else if (start.mode === "close-panel" && dx > TRIGGER) {
        setPanelSheetOpen(false);
        start = null;
      }
    };
    const onEnd = () => {
      start = null;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [drawerOpen, panelOpen, mobile, setDrawer]);

  return null;
}
