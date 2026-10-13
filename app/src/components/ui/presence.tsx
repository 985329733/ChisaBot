import { AnimatePresence, motion } from "motion/react";
import { forwardRef, type ReactNode } from "react";

/**
 * 列表项进出场（DESIGN.md §34.5）：新项 220ms 淡入 + 6px 上浮；删除的项 160ms 淡出 + 缩到 0.97，
 * 同时它下面的项用 transform（FLIP）平滑补位，不做高度动画、不触发逐帧重排。
 *
 * - `mode="popLayout"`：离场的项立即脱离文档流，其余项马上开始补位，不用等离场动画放完。
 *   外层容器必须是定位元素（`position: relative`），离场项才会留在原位淡出。
 * - `initial={false}`：首屏 / 切换机器人时整列直接出现，只有之后的插入 / 删除才有动画。
 * - 减少动态效果：根上的 `<MotionConfig reducedMotion="user">` 会去掉位移和缩放，只留淡入淡出。
 */
export function PresenceList({ children }: { children: ReactNode }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {children}
    </AnimatePresence>
  );
}

const ENTER = [0.22, 0.8, 0.24, 1] as const;
const EXIT = [0.4, 0, 1, 1] as const;

export const PresenceItem = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(
  function PresenceItem({ children, className }, ref) {
    return (
      <motion.div
        animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: ENTER } }}
        className={className}
        exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: EXIT } }}
        initial={{ opacity: 0, y: 6, scale: 1 }}
        layout="position"
        ref={ref}
        transition={{ layout: { duration: 0.22, ease: ENTER } }}
      >
        {children}
      </motion.div>
    );
  },
);
