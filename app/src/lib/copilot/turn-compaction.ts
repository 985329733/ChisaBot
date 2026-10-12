import { type RefObject, useEffect } from "react";

/**
 * 一轮对话收成「一句话 → 结果」（2026-10-13，Hark 第二轮）。
 *
 * 实测免费模型一轮里会说好几段过程话（「拿到了当前价格，再取一下近 7 日走势。」「我编码打错了一个字…」），
 * 每段都是一个带复制按钮的大气泡，再加每步一个「思考了几秒」、每开一个网页一条小条——一轮能堆出六七
 * 个气泡，结果被挤到最下面。提示词约束不住这个模型，所以在界面上收：
 *
 *  - 每轮（两条用户消息之间）第一段文字 = 开场一句（气泡，不带工具栏）；
 *  - 最后一段文字 = 结果（正常气泡 + 工具栏）；运行中还没有结果；
 *  - 中间的文字 = 过程（一行淡色小字，没有气泡、没有工具栏）；
 *  - 打开网页的小条、「思考了…」都只留这一轮的最后一个。
 *
 * 不碰消息本身（CopilotChat 自己管列表），只给 DOM 节点打 data 属性，样式在 styles.css。
 */
export function useTurnCompaction(root: RefObject<HTMLElement | null>, key: string) {
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let frame = 0;
    let wasRunning = false;
    const apply = () => {
      frame = 0;
      const running = Boolean(host.querySelector('[data-testid="composer-stop"]'));
      if (running !== wasRunning) {
        wasRunning = running;
        // 右栏面板据此加快轮询（live-panels.tsx useLivePanels）。
        window.dispatchEvent(new CustomEvent("chisabot-chat-running", { detail: running }));
      }
      const list = host.querySelector(".copilotKitMessages");
      if (!list) return;
      const turns: Element[][] = [[]];
      for (const el of Array.from(list.children)) {
        if (el.matches(".copilotKitUserMessage") || el.querySelector(":scope > .copilotKitUserMessage")) turns.push([]);
        else turns[turns.length - 1]?.push(el);
      }
      turns.forEach((turn, index) => {
        const live = running && index === turns.length - 1;
        const texts = turn.filter(
          (el) => el.matches(".copilotKitAssistantMessage") && (el.querySelector(":scope > .cpk\\:prose")?.textContent ?? "").trim().length > 0,
        );
        texts.forEach((el, i) => {
          const last = i === texts.length - 1;
          const pos = last && !live && (i > 0 || texts.length === 1) ? "final" : i === 0 ? "lead" : "step";
          if (el.getAttribute("data-cb-turn") !== pos) el.setAttribute("data-cb-turn", pos);
        });
        const hideAllButLast = (nodes: Element[]) =>
          nodes.forEach((el, i) => {
            const hide = i < nodes.length - 1;
            if (hide !== el.hasAttribute("data-cb-hidden")) hide ? el.setAttribute("data-cb-hidden", "") : el.removeAttribute("data-cb-hidden");
          });
        hideAllButLast(turn.flatMap((el) => Array.from(el.querySelectorAll(".browse-chip"))));
        hideAllButLast(turn.filter((el) => el.querySelector(".reasoning-head")));
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(host, { childList: true, subtree: true, characterData: true });
    schedule();
    return () => {
      if (wasRunning) window.dispatchEvent(new CustomEvent("chisabot-chat-running", { detail: false }));
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, key]);
}
