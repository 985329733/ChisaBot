import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { summarizeWork, type WorkCall } from "@/lib/chat/work-steps";

/**
 * 干活卡（DESIGN.md §70，Hark 的「实时工作卡片」）：一轮里机器人开始调工具后，「思考中」那颗胶囊换成
 * 「● 正在搜索「…」 · 第 3 步 · 12 秒」。同一个位置、同样高（一行），所以不改滚动高度（§35 / §68.4）；
 * 当前步骤换字时原地淡入（不改宽度以外的布局）；一轮结束就和「思考中」一样消失，结果气泡接上。
 *
 * 用时从这一轮第一次看到工具调用算起（按 `turnKey` 记在模块里，中间夹一句过程话、卡片重挂也不归零）。
 */
const startedAt = new Map<string, number>();

export function WorkCard({ calls, turnKey }: { calls: readonly WorkCall[]; turnKey: string }) {
  const summary = summarizeWork(calls);
  if (!startedAt.has(turnKey)) {
    startedAt.set(turnKey, Date.now());
    if (startedAt.size > 50) startedAt.delete(startedAt.keys().next().value as string);
  }
  const since = startedAt.get(turnKey) ?? Date.now();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const reduce = useReducedMotion();
  if (!summary) return null;
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return (
    <div className="chat-thinking chat-work-card" data-testid="chat-work-card" role="status">
      <span aria-hidden="true" className="chat-thinking-dots">
        <i />
        <i />
        <i />
      </span>
      <span className="chat-work-step">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            animate={{ opacity: 1 }}
            className="tool-line-running chat-work-step-text"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={summary.current}
            transition={{ duration: reduce ? 0 : 0.18 }}
          >
            {summary.current}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="chat-work-meta">
        {`第 ${summary.count} 步`}
        {seconds >= 2 ? ` · ${seconds} 秒` : ""}
      </span>
    </div>
  );
}
