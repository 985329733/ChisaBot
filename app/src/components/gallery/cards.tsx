import { z } from "zod";
import type { GalleryComponent } from "@/lib/copilot/gallery-registry";
import { Badge, GalleryFrame, type Tone } from "./frame";

const tone = z
  .enum(["neutral", "positive", "caution", "negative"])
  .describe(
    "How this reads at a glance. Use negative and caution sparingly, for a refusal, a breach or a failure, not for anything merely notable",
  );

export const RecordCardProps = z.object({
  title: z.string().describe("What this record is, e.g. a person or an order"),
  subtitle: z
    .string()
    .optional()
    .describe("One line of context under the title"),
  status: z.string().optional().describe("A short status word, e.g. Approved"),
  statusTone: tone.optional(),
  fields: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().describe("Already formatted for a person to read"),
      }),
    )
    .describe("The fields, in the order they should be read"),
});

export function RecordCard({
  title,
  subtitle,
  status,
  statusTone,
  fields: given,
}: Partial<z.infer<typeof RecordCardProps>>) {
  const fields = given ?? [];
  return (
    <GalleryFrame
      action={
        status ? <Badge tone={statusTone as Tone}>{status}</Badge> : undefined
      }
      caption={subtitle}
      title={title}
    >
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
        {fields.map((field) => (
          <div className="contents" key={field.label}>
            <dt className="truncate text-muted-foreground">{field.label}</dt>
            {/* Field values wrap because truncation can hide the reported data. */}
            <dd className="min-w-0 break-words">{field.value}</dd>
          </div>
        ))}
      </dl>
    </GalleryFrame>
  );
}

export const MetricsCardProps = z.object({
  title: z.string().describe("What these figures are about"),
  caption: z.string().optional(),
  metrics: z
    .array(
      z.object({
        label: z.string(),
        value: z
          .string()
          .describe("Already formatted, including any unit or currency"),
        change: z
          .string()
          .optional()
          .describe("The movement, e.g. '+12% on last month'"),
        changeTone: tone.optional(),
      }),
    )
    .max(6)
    .describe("Up to six figures. More than that wanted a table"),
});

export function MetricsCard({
  title,
  caption,
  metrics: given,
}: Partial<z.infer<typeof MetricsCardProps>>) {
  const metrics = given ?? [];
  return (
    <GalleryFrame caption={caption} title={title}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <p className="truncate text-xs text-muted-foreground">
              {metric.label}
            </p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">
              {metric.value}
            </p>
            {metric.change ? (
              <p className="mt-0.5">
                <Badge tone={metric.changeTone as Tone}>{metric.change}</Badge>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </GalleryFrame>
  );
}

export const ChecklistCardProps = z.object({
  title: z.string().describe("What this list is"),
  caption: z.string().optional(),
  items: z
    .array(
      z.object({
        text: z.string(),
        done: z.boolean().describe("Whether this one is already finished"),
        note: z
          .string()
          .optional()
          .describe("A short aside, e.g. who it is waiting on"),
      }),
    )
    .describe("The items, in the order they should be done"),
});

/**
 * A read-only checklist. Interactive decisions use the approval components where answers go back
 * to the Bot.
 */
export function ChecklistCard({
  title,
  caption,
  items: given,
}: Partial<z.infer<typeof ChecklistCardProps>>) {
  const items = given ?? [];
  const done = items.filter((item) => item.done).length;
  return (
    <GalleryFrame
      action={
        <Badge
          tone={
            done === items.length && items.length > 0 ? "positive" : "neutral"
          }
        >
          {done} {"的"}
          {items.length}
        </Badge>
      }
      caption={caption}
      title={title}
    >
      <ul className="space-y-2">
        {items.map((item) => (
          <li className="flex items-start gap-2.5 text-sm" key={item.text}>
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[5px] border text-[10px] ${
                item.done
                  ? "border-transparent bg-emerald-500 text-white"
                  : "border-border"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            <span className="min-w-0">
              <span
                className={
                  item.done ? "text-muted-foreground line-through" : ""
                }
              >
                {item.text}
              </span>
              {item.note ? (
                <span className="block text-xs text-muted-foreground">
                  {item.note}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </GalleryFrame>
  );
}

export const NoticeCardProps = z.object({
  title: z.string().describe("The headline, in a few words"),
  body: z.string().describe("The explanation, in one or two sentences"),
  tone: tone.optional(),
  points: z
    .array(z.string())
    .optional()
    .describe("Supporting points, if there are any"),
});

export function NoticeCard({
  title,
  body,
  tone: noticeTone,
  points,
}: Partial<z.infer<typeof NoticeCardProps>>) {
  return (
    <GalleryFrame
      action={
        noticeTone && noticeTone !== "neutral" ? (
          <Badge tone={noticeTone}>{noticeTone}</Badge>
        ) : undefined
      }
      title={title}
    >
      <p className="text-sm">{body}</p>
      {points?.length ? (
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {points.map((entry) => (
            <li className="flex gap-2" key={entry}>
              <span aria-hidden="true">·</span>
              <span className="min-w-0">{entry}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </GalleryFrame>
  );
}

export const GALLERY: GalleryComponent[] = [
  {
    name: "showRecord",
    title: "记录",
    kind: "card",
    description: "显示一个事物及其字段、订单、人员、票据。代替用散文描述记录。",
    parameters: RecordCardProps,
    Component: RecordCard as GalleryComponent["Component"],
    preview: {
      title: "发票 2043",
      subtitle: "Northwind Traders",
      status: "Approved",
      fields: [
        { label: "数量", value: "$4,280.00" },
        { label: "已提出", value: "12 March" },
        { label: "所有者", value: "Priya Raman" },
      ],
    },
    confirmation: "The record is now on screen for the person.",
  },
  {
    name: "showMetrics",
    title: "关键指标",
    kind: "card",
    description: "显示最多六个头条数字，每个可有可选变动。用于快速浏览的摘要。",
    parameters: MetricsCardProps,
    Component: MetricsCard as GalleryComponent["Component"],
    preview: {
      title: "本月",
      metrics: [
        {
          label: "收入",
          value: "$412k",
          change: "+12% on last month",
          changeTone: "positive",
        },
        { label: "打开交易", value: "38" },
        {
          label: "流失",
          value: "1.4%",
          change: "+0.3pt",
          changeTone: "caution",
        },
      ],
    },
    confirmation: "The figures are now on screen for the person.",
  },
  {
    name: "showChecklist",
    title: "检查清单",
    kind: "card",
    description: "显示已完成的事物列表。只报告，不能勾选，不要用于询问。",
    parameters: ChecklistCardProps,
    Component: ChecklistCard as GalleryComponent["Component"],
    preview: {
      title: "发布前",
      items: [
        { text: "已应用迁移", done: true },
        { text: "更改日志已写入", done: true },
        { text: "加载测试", done: false, note: "Waiting on staging" },
      ],
    },
    confirmation: "The checklist is now on screen for the person.",
  },
  {
    name: "showNotice",
    title: "注意",
    kind: "card",
    description: "显示标题、简短解释和可选支持点。代替写几段散文。",
    parameters: NoticeCardProps,
    Component: NoticeCard as GalleryComponent["Component"],
    preview: {
      title: "证书将在30天后过期",
      body: "The checkout certificate has an owner now, and this is the first of the new alerts.",
      tone: "caution",
      points: ["Owner: Platform", "Renews automatically once approved"],
    },
    confirmation: "The notice is now on screen for the person.",
  },
];
