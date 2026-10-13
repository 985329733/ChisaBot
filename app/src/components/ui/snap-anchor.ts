/**
 * 弹出层的「吸附锚点」（DESIGN.md §34.2）。
 *
 * 菜单默认对齐触发它的小按钮（例如 26px 的 ⋯），结果是菜单压在卡片边上、顶边对不上行。
 * 这里给 Base UI 的 Positioner 一个虚拟锚点：横向取触发器所在容器（例如左栏卡片）的左右边，
 * 纵向取另一个容器（例如机器人行）的上下边。于是 side="right" + sideOffset={8} 的菜单
 * 正好离卡片 8px、顶边与行齐平；side="top" 的菜单与卡片同宽、左右边齐平。
 */
export type SnapAxes = { x?: string; y?: string };

export function snapAnchor(findTrigger: () => Element | null, axes: SnapAxes) {
  return {
    getBoundingClientRect(): DOMRect {
      const trigger = findTrigger();
      if (!trigger) return new DOMRect();
      const r = trigger.getBoundingClientRect();
      const cx = axes.x ? trigger.closest(axes.x)?.getBoundingClientRect() : undefined;
      const cy = axes.y ? trigger.closest(axes.y)?.getBoundingClientRect() : undefined;
      return new DOMRect(cx?.left ?? r.left, cy?.top ?? r.top, cx?.width ?? r.width, cy?.height ?? r.height);
    },
    get contextElement() {
      return findTrigger() ?? undefined;
    },
  };
}

/** 找到当前打开着的、带这个 aria-label 的触发器（Base UI 在打开时给触发器加 data-popup-open）。 */
export function openTriggerByLabel(label: string) {
  const sel = `[aria-label="${label.replace(/["\\]/g, "\\$&")}"]`;
  return () => document.querySelector(`${sel}[data-popup-open]`) ?? document.querySelector(sel);
}
