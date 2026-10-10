import { z } from "zod";
import type { GalleryComponent } from "@/lib/copilot/gallery-registry";
import { GalleryFrame } from "./frame";
import { seriesColour } from "./palette";

const point = z.object({
  label: z
    .string()
    .describe("What this point is called, e.g. a month or a team"),
  value: z.number().describe("Its value"),
});

const common = {
  title: z.string().describe("A short title for the chart"),
  caption: z
    .string()
    .optional()
    .describe(
      "One line under the title saying what the reader should take from it",
    ),
};

/** Charts share a height so several in one answer do not stagger down the page. */
const HEIGHT = 180;

function formatNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
  }
  return String(Math.round(value * 100) / 100);
}

/** Nothing to draw is a sentence. An empty axis reads as a component that failed. */
function Empty() {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">
      {"没有数据可绘制图表。"}
    </p>
  );
}

function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <li className="flex items-center gap-1.5 text-xs" key={item.label}>
          <span
            className="size-2 shrink-0 rounded-[3px]"
            style={{ background: item.colour }}
          />
          <span className="text-muted-foreground">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export const BarChartProps = z.object({
  ...common,
  points: z
    .array(point)
    .describe("One bar per point, in the order they should appear"),
});

export function BarChartCard({
  title,
  caption,
  points: given,
}: Partial<z.infer<typeof BarChartProps>>) {
  const points = given ?? [];
  const max = Math.max(...points.map((entry) => entry.value ?? 0), 0);
  return (
    <GalleryFrame caption={caption} title={title}>
      {points.length === 0 ? (
        <Empty />
      ) : (
        // Columns stretch to full row height so percentage bar heights use the chart area.
        <div className="flex items-stretch gap-2" style={{ height: HEIGHT }}>
          {points.map((entry, index) => (
            <div
              className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
              key={entry.label}
            >
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatNumber(entry.value)}
              </span>
              {/* The bar lives in its own flexible box so the number above and the label below keep
                  their natural height and only the bar itself scales. */}
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-md transition-[height]"
                  style={{
                    // Normalize to the largest bar so similar values still show their differences.
                    height:
                      max > 0
                        ? `${Math.max((entry.value / max) * 100, 2)}%`
                        : "2%",
                    background: seriesColour(index),
                  }}
                />
              </div>
              <span className="w-full truncate text-center text-xs text-muted-foreground">
                {entry.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </GalleryFrame>
  );
}

export const PieChartProps = z.object({
  ...common,
  points: z
    .array(point)
    .describe("One slice per point. Values are summed to make the whole"),
});

export function PieChartCard({
  title,
  caption,
  points: given,
}: Partial<z.infer<typeof PieChartProps>>) {
  const points = given ?? [];
  const size = 160;
  const stroke = 28;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = points.reduce((sum, entry) => sum + (entry.value || 0), 0);

  let travelled = 0;
  const slices = points.map((entry, index) => {
    const arc = total > 0 ? (entry.value / total) * circumference : 0;
    const slice = {
      ...entry,
      arc,
      offset: -travelled,
      colour: seriesColour(index),
    };
    travelled += arc;
    return slice;
  });

  return (
    <GalleryFrame caption={caption} title={title}>
      {points.length === 0 || total <= 0 ? (
        <Empty />
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          {/* One circle per slice: dasharray controls length and dashoffset controls start. */}
          <svg
            aria-hidden="true"
            className="shrink-0 -rotate-90"
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            width={size}
          >
            {slices.map((slice) => (
              <circle
                cx={size / 2}
                cy={size / 2}
                fill="none"
                key={slice.label}
                r={radius}
                stroke={slice.colour}
                strokeDasharray={`${slice.arc} ${circumference - slice.arc}`}
                strokeDashoffset={slice.offset}
                strokeWidth={stroke}
              />
            ))}
          </svg>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {slices.map((slice) => (
              <li className="flex items-center gap-2 text-sm" key={slice.label}>
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ background: slice.colour }}
                />
                <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {Math.round((slice.value / total) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </GalleryFrame>
  );
}

/* -------------------------------------------------------------------------- Line and area */

const seriesSchema = z.object({
  name: z.string().describe("What this line is called"),
  values: z
    .array(z.number())
    .describe("One value per label, in the same order"),
});

export const LineChartProps = z.object({
  ...common,
  labels: z.array(z.string()).describe("The x axis, e.g. months"),
  series: z.array(seriesSchema).describe("One line per series"),
});

type LineArgs = z.infer<typeof LineChartProps>;

/**
 * Line and area are the same geometry, so they are the same function.
 *
 * Sharing the scaler keeps line and area charts aligned.
 */
function Plot({
  labels,
  series,
  filled,
}: { labels: string[]; series: { name: string; values: number[] }[] } & {
  filled: boolean;
}) {
  const width = 520;
  const height = HEIGHT;
  const pad = { top: 8, right: 8, bottom: 18, left: 8 };

  const all = series.flatMap((line) => line.values);
  const max = Math.max(...all, 0);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const steps = Math.max(labels.length - 1, 1);

  const xAt = (index: number) =>
    pad.left + (index / steps) * (width - pad.left - pad.right);
  const yAt = (value: number) =>
    pad.top + (1 - (value - min) / span) * (height - pad.top - pad.bottom);

  return (
    <>
      <svg
        aria-hidden="true"
        className="w-full"
        height={height}
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        {/* Two guide lines give slope context without turning the chart into a grid. */}
        {[0.5, 1].map((fraction) => (
          <line
            className="stroke-border"
            key={fraction}
            strokeDasharray="3 3"
            x1={pad.left}
            x2={width - pad.right}
            y1={pad.top + fraction * (height - pad.top - pad.bottom)}
            y2={pad.top + fraction * (height - pad.top - pad.bottom)}
          />
        ))}
        {series.map((line, index) => {
          const points = line.values.map(
            (value, i) => `${xAt(i)},${yAt(value)}`,
          );
          const colour = seriesColour(index);
          return (
            <g key={line.name}>
              {filled ? (
                <polygon
                  fill={colour}
                  fillOpacity={0.14}
                  points={`${xAt(0)},${height - pad.bottom} ${points.join(" ")} ${xAt(line.values.length - 1)},${height - pad.bottom}`}
                />
              ) : null}
              <polyline
                fill="none"
                points={points.join(" ")}
                stroke={colour}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between">
        {labels.map((label) => (
          <span className="truncate text-xs text-muted-foreground" key={label}>
            {label}
          </span>
        ))}
      </div>
      {series.length > 1 ? (
        <Legend
          items={series.map((line, index) => ({
            label: line.name,
            colour: seriesColour(index),
          }))}
        />
      ) : null}
    </>
  );
}

export function LineChartCard(args: Partial<LineArgs>) {
  const labels = args.labels ?? [];
  const series = (args.series ?? []).map((line) => ({
    name: line.name ?? "",
    values: line.values ?? [],
  }));
  return (
    <GalleryFrame caption={args.caption} title={args.title}>
      {series.length === 0 || labels.length === 0 ? (
        <Empty />
      ) : (
        <Plot filled={false} labels={labels} series={series} />
      )}
    </GalleryFrame>
  );
}

export const AreaChartProps = LineChartProps;

export function AreaChartCard(args: Partial<LineArgs>) {
  const labels = args.labels ?? [];
  const series = (args.series ?? []).map((line) => ({
    name: line.name ?? "",
    values: line.values ?? [],
  }));
  return (
    <GalleryFrame caption={args.caption} title={args.title}>
      {series.length === 0 || labels.length === 0 ? (
        <Empty />
      ) : (
        <Plot filled labels={labels} series={series} />
      )}
    </GalleryFrame>
  );
}

/* -------------------------------------------------------------------------- Progress */

export const ProgressChartProps = z.object({
  ...common,
  points: z
    .array(
      point.extend({
        target: z.number().describe("What the value is measured against"),
      }),
    )
    .describe("One row per thing being tracked"),
});

/**
 * Progress against a target, distinct from comparing independent bars.
 */
export function ProgressChartCard({
  title,
  caption,
  points: given,
}: Partial<z.infer<typeof ProgressChartProps>>) {
  const points = given ?? [];
  return (
    <GalleryFrame caption={caption} title={title}>
      {points.length === 0 ? (
        <Empty />
      ) : (
        <ul className="space-y-3">
          {points.map((entry, index) => {
            const share =
              entry.target > 0
                ? Math.min((entry.value / entry.target) * 100, 100)
                : 0;
            return (
              <li key={entry.label}>
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 truncate">{entry.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatNumber(entry.value)} / {formatNumber(entry.target)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-foreground/5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${share}%`,
                      background: seriesColour(index),
                    }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </GalleryFrame>
  );
}

/** Gallery component registration kept beside the chart implementations. */
export const GALLERY: GalleryComponent[] = [
  {
    name: "showBarChart",
    title: "柱状图",
    kind: "chart",
    description:
      "以柱状图显示值。用于比较少量命名事物、团队、月份、类别。不用于时间趋势，这是showLineChart。",
    parameters: BarChartProps,
    Component: BarChartCard as GalleryComponent["Component"],
    preview: {
      title: "按团队收入",
      caption: "销售线索，工程正在缩小差距。",
      points: [
        { label: "销售", value: 120 },
        { label: "工程", value: 80 },
        { label: "支持", value: 45 },
      ],
    },
    confirmation: "The bar chart is now on screen for the person.",
  },
  {
    name: "showPieChart",
    title: "甜甜圈图",
    kind: "chart",
    description:
      "以甜甜圈图和图例显示整体分割。只在部分总和有意义时使用，六片以上优先柱状图。",
    parameters: PieChartProps,
    Component: PieChartCard as GalleryComponent["Component"],
    preview: {
      title: "月份去了哪里",
      points: [
        { label: "构建", value: 48 },
        { label: "支持", value: 26 },
        { label: "会议", value: 26 },
      ],
    },
    confirmation: "The donut chart is now on screen for the person.",
  },
  {
    name: "showLineChart",
    title: "折线图",
    kind: "chart",
    description:
      "在有序轴上（通常是时间）显示一个或多个系列。每个系列必须在每个标签有一个值。",
    parameters: LineChartProps,
    Component: LineChartCard as GalleryComponent["Component"],
    preview: {
      title: "注册",
      caption: "六周一次发布。",
      labels: ["W1", "W2", "W3", "W4", "W5", "W6"],
      series: [{ name: "Signups", values: [120, 180, 160, 240, 300, 420] }],
    },
    confirmation: "The line chart is now on screen for the person.",
  },
  {
    name: "showAreaChart",
    title: "面积图",
    kind: "chart",
    description:
      "与 showLineChart 相同，填充每条线下的区域。用于体积或累积，而不是用于比率。",
    parameters: AreaChartProps,
    Component: AreaChartCard as GalleryComponent["Component"],
    preview: {
      title: "存储使用",
      caption: "自迁移以来稳步增长。",
      labels: ["Jan", "Feb", "Mar", "Apr", "May"],
      series: [{ name: "TB", values: [12, 19, 26, 31, 44] }],
    },
    confirmation: "The area chart is now on screen for the person.",
  },
  {
    name: "showProgress",
    title: "进度与目标",
    kind: "chart",
    description:
      "以进度条显示值与目标。用于'是否已到达'问题、预算支出与预算、已完成与计划。",
    parameters: ProgressChartProps,
    Component: ProgressChartCard as GalleryComponent["Component"],
    preview: {
      title: "迁移到新运行时",
      caption: "还剩两个服务。",
      points: [
        { label: "服务已移动", value: 18, target: 20 },
        { label: "测试已移植", value: 240, target: 240 },
      ],
    },
    confirmation: "The progress chart is now on screen for the person.",
  },
];
