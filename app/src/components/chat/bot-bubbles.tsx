import { IconArrowBackUp, IconPencil } from "@tabler/icons-react";
import { motion, useReducedMotion } from "motion/react";
import { memo, useMemo, useRef } from "react";
import { SmoothStreamdown } from "@/components/chat/smooth-markdown";
import { useDisplayText } from "@/components/rich-previews/rich-previews";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { CopyButton } from "@/components/ui/copy-button";
import { type BubbleSegment, splitBubbles } from "@/lib/chat/bubbles";
import { EASE_OUT, ENTRANCE_SECONDS } from "@/lib/motion";

/**
 * 机器人的一条回复画成几个短气泡（DESIGN.md §69，向 Hark 的短信式对话看齐）。
 *
 * - 切法只有一份：`splitBubbles`（空行分段，代码块 / 表格 / 清单不切开）。
 * - 单独一行的链接先按整条消息拿掉（和下面的链接卡同一个结果，§48），再切气泡；只剩链接的段不画气泡。
 * - 短段落的气泡贴着文字宽度（最宽 min(85%, 560px)），表格 / 代码 / 长清单 / 草稿整列宽。
 * - 第一次出现时一个接一个淡入（每个隔 BEAT 秒）；流式写出来的新气泡不加延迟，跟着字走。
 *   `prefers-reduced-motion`：只淡入、不位移、不排队。
 * - ```draft = 草稿卡（可一键复制）；段首 `> 原话` = 回复引用。
 */
export const BEAT_SECONDS = 0.16;

export const BotBubbles = memo(function BotBubbles({
  text,
  components,
  delay = 0,
  tone,
}: {
  text: string;
  components: Record<string, unknown>;
  delay?: number;
  tone?: "lead" | "final" | undefined;
}) {
  const display = useDisplayText(text);
  const segments = useMemo(() => splitBubbles(display), [display]);
  // 第一次渲染时已经在的气泡排队淡入；之后流式新增的不排队。
  const initial = useRef<number | null>(null);
  if (initial.current === null) initial.current = segments.length;
  const reduce = useReducedMotion();
  return (
    <div className="chat-bubbles" data-cb-turn={tone}>
      {segments.map((seg, i) => (
        <motion.div
          animate={{ opacity: 1, transform: "translateY(0px)" }}
          className="chat-bubble-arrive"
          data-slot="bubble-arriving"
          initial={i === 0 ? false : { opacity: 0, transform: reduce ? "none" : "translateY(6px)" }}
          // 段落的序号就是它的身份：流式时只会在末尾追加，前面的段不会换位置。
          // biome-ignore lint/suspicious/noArrayIndexKey: 见上
          key={i}
          transition={{
            delay: reduce || i >= (initial.current ?? 0) ? 0 : delay + i * BEAT_SECONDS,
            duration: ENTRANCE_SECONDS,
            ease: EASE_OUT,
          }}
        >
          <Segment components={components} seg={seg} />
        </motion.div>
      ))}
    </div>
  );
});

function Segment({ seg, components }: { seg: BubbleSegment; components: Record<string, unknown> }) {
  if (seg.kind === "draft") return <DraftCard text={seg.text} title={seg.title} />;
  return (
    <Bubble
      align="start"
      className={seg.kind === "code" ? "chat-bubble-bare w-full" : seg.wide ? "w-full" : "chat-bubble-fit"}
      data-cb-bubble={seg.kind}
      variant="ghost"
    >
      <BubbleContent className={seg.wide ? "w-full" : undefined}>
        {seg.quote ? <ReplyQuote text={seg.quote} /> : null}
        <SmoothStreamdown components={components as never}>{seg.text}</SmoothStreamdown>
      </BubbleContent>
    </Bubble>
  );
}

/** 回复引用：机器人回应的不是紧挨着的上一条时，在气泡顶上带一行对方原话（Hark 的 reply quote）。 */
export function ReplyQuote({ text }: { text: string }) {
  return (
    <div className="chat-reply-quote" data-testid="chat-reply-quote">
      <IconArrowBackUp aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </div>
  );
}

/** 草稿卡：要用户发出去的文字（微信、邮件、短信），一键复制；标题可选。 */
export function DraftCard({ text, title }: { text: string; title?: string | undefined }) {
  return (
    <section aria-label={title ? `草稿：${title}` : "草稿"} className="chat-draft-card" data-testid="chat-draft-card">
      <header className="chat-draft-head">
        <IconPencil aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="chat-draft-title">{title || "草稿"}</span>
        <CopyButton className="chat-draft-copy" size="sm" value={text} variant="ghost">
          {"复制"}
        </CopyButton>
      </header>
      <div className="chat-draft-body">{text}</div>
    </section>
  );
}
