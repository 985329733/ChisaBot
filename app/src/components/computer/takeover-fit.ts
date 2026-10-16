import { useLayoutEffect, useRef } from "react";

/**
 * 放大的浏览器卡片永远不滚动（DESIGN §96）。
 *
 * 屏幕区能用的高度 = 卡片最大高度 − 卡片里除屏幕以外的东西（工具条、底栏、内边距）。量出来写进卡片的
 * `--ctk-avail`（px）；CSS 用它和 `--ctk-ar` 算屏幕宽度 `min(100%, avail × 宽高比)`，卡片宽度跟着收，
 * 所以宽屏矮窗口时屏幕变小、整块居中，而不是把底栏挤出卡片外。
 * 工具条和底栏的高度不随屏幕大小变，所以这个量法一次就稳定，不会来回抖。
 */
export function availableScreenHeight(maxCardHeight: number, contentHeight: number, screenHeight: number): number {
  return Math.max(120, Math.floor(maxCardHeight - (contentHeight - screenHeight)));
}

export function useTakeoverFit(open: boolean) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const card = ref.current;
    if (!card || typeof window === "undefined") return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const screen = card.querySelector<HTMLElement>("[data-ctk-screen], .computer-screen");
      if (!screen) return;
      const style = getComputedStyle(card);
      const max = Number.parseFloat(style.maxHeight);
      const limit = Number.isFinite(max) && max > 0 ? max : window.innerHeight;
      // 内容本来有多高（不受 max-height 裁切、不受底栏 margin-top:auto 撑开）：子元素高度 + 行间距 + 内边距 + 边框。
      const kids = Array.from(card.children) as HTMLElement[];
      const gap = Number.parseFloat(style.rowGap) || 0;
      const box =
        (Number.parseFloat(style.paddingTop) || 0) +
        (Number.parseFloat(style.paddingBottom) || 0) +
        (Number.parseFloat(style.borderTopWidth) || 0) +
        (Number.parseFloat(style.borderBottomWidth) || 0);
      const content = kids.reduce((sum, kid) => sum + kid.offsetHeight, 0) + gap * Math.max(0, kids.length - 1) + box;
      const avail = availableScreenHeight(limit, content, screen.offsetHeight);
      const next = `${avail}px`;
      if (card.style.getPropertyValue("--ctk-avail") !== next) card.style.setProperty("--ctk-avail", next);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(card);
    // 屏幕节点会在「连接中 → 直播」时换掉；子树变化时重新挂上观察。
    const mutations = typeof MutationObserver === "undefined" ? null : new MutationObserver(schedule);
    mutations?.observe(card, { childList: true, subtree: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [open]);
  return ref;
}
