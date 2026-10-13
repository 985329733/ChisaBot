import { defineRegistry, useBoundProp } from "@json-render/react";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconInfoCircle,
  IconTrendingDown,
  IconTrendingUp,
  IconMinus,
  IconX,
} from "@tabler/icons-react";
import { Component, type CSSProperties, type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { jsonRenderCatalog } from "../../../../../shared/json-render/catalog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * json-render 组件实现（Skyglass，DESIGN.md §9–§11）。目录（属性、说明）在 shared/json-render/catalog.ts，
 * 这里只负责长相：所有样式都是 styles.css 里的 `.jr-*` 类，亮色 / 暗色都由令牌决定。
 *
 * 只渲染纯文本：没有 dangerouslySetInnerHTML，图片只接受 https，链接由 open_link 动作在新标签页打开。
 */

const text = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

const BUTTON_VARIANT = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "destructive",
} as const;

const ALERT_ICON = {
  info: IconInfoCircle,
  success: IconCircleCheck,
  warn: IconAlertTriangle,
  danger: IconX,
} as const;

const TREND_ICON = {
  up: IconTrendingUp,
  down: IconTrendingDown,
  flat: IconMinus,
} as const;

/**
 * 大数字拆成「数字 + 单位」：单位小一号、淡一点（26.9℃ → 26.9 + ℃，2.9 km/h → 2.9 + km/h）。
 * 只在数字打头、后面跟着不含数字的短单位时拆；「10月13日」「$82,407」之类原样。
 */
export function splitMetricValue(value: string): { num: string; unit: string } {
  const m = value.trim().match(/^([+\-−]?[$¥€£₿]?\s?\d[\d,]*(?:\.\d+)?)\s*([^\d\s][^\d]{0,9})?$/u);
  if (!m || !m[2]) return { num: value.trim(), unit: "" };
  return { num: m[1], unit: m[2].trim() };
}

/**
 * 数字永远一行：放不下就把字号往小调（最小 13px），绝不把「26.9℃」折成两行（DESIGN.md §29）。
 * 每次尺寸变化先回到样式表里的字号再量，所以卡片变宽时字会长回去。
 */
function FitLine({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = "";
      let size = Number.parseFloat(getComputedStyle(el).fontSize) || 24;
      while (el.scrollWidth > el.clientWidth + 0.5 && size > 13) {
        size -= 1;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}

/** 窄表格的简表：日期写短（10月13日 / 2026-10-13 → 10/13）；数值列里 ℃ 写成 °，省出宽度。 */
export function shortDate(value: string): string {
  return value
    .replace(/^\d{4}[-/年.](\d{1,2})[-/月.](\d{1,2})日?/u, (_, m, d) => `${Number(m)}/${Number(d)}`)
    .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/gu, (_, m, d) => `${Number(m)}/${Number(d)}`)
    .replace(/\s+/g, " ")
    .trim();
}

/** 简表数值：℃ / °C 写成 °，「29.0 / 22.9」去掉斜杠两边的空格。 */
export function compactValue(value: string): string {
  return shortDate(value)
    .replace(/\s*(?:℃|°\s*C\b)/gu, "°")
    .replace(/(\d)\s*\/\s*(?=[\d+\-−])/gu, "$1/");
}

const looksNumeric = (value: string) => /^[\s+\-−$¥€£₿]*\d/u.test(value) && !/[月日年]/u.test(value);

/**
 * 表格在窄容器（< 440px，容器查询）里换成简表：第一列（第二列是文字时连同第二列）叠成左边一格，
 * 其余列靠右、各占一列、不折行。宽容器照常是表格。两份 DOM 都在，样式表按容器宽度只显示一份。
 */
function CompactRows({
  columns,
  rows,
}: {
  columns: { key: string; label: string; align?: string | null }[];
  rows: Record<string, unknown>[];
}) {
  if (!columns.length) return null;
  const [first, second, ...others] = columns;
  const secondIsText =
    Boolean(second) &&
    columns.length >= 3 &&
    rows.some((row) => text(row?.[second.key]).trim() !== "") &&
    rows.every((row) => !looksNumeric(text(row?.[second.key])));
  const after = secondIsText ? others : [second, ...others].filter(Boolean);
  // 靠右最多 3 列；再多的列折进左边第二行（「最大风速 17.7 km/h」），不让整张表横向滚动。
  const rest = after.slice(0, 3);
  const extra = after.slice(3);
  return (
    <div className="jr-rows" role="table" style={{ "--jr-rest": String(rest.length) } as CSSProperties}>
      <div className="jr-rows-h" role="row">
        <span role="columnheader">{secondIsText ? `${first.label} · ${second.label}` : first.label}</span>
        {rest.map((column) => (
          <span key={column.key} role="columnheader">
            {column.label}
          </span>
        ))}
      </div>
      {rows.map((row, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no identity of their own.
        <div className="jr-rows-r" key={index} role="row">
          <span className="jr-rows-p" role="cell">
            <span className="jr-rows-t">{shortDate(text(row?.[first.key]))}</span>
            {(() => {
              const sub = [
                secondIsText ? text(row?.[second.key]) : "",
                ...extra.map((column) => (text(row?.[column.key]) ? `${column.label} ${compactValue(text(row?.[column.key]))}` : "")),
              ].filter(Boolean);
              return sub.length ? <span className="jr-rows-s">{sub.join(" · ")}</span> : null;
            })()}
          </span>
          {rest.map((column) => (
            <span className="jr-rows-v" key={column.key} role="cell" title={`${column.label} ${text(row?.[column.key])}`}>
              <span className="jr-rows-x">{compactValue(text(row?.[column.key]))}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 每个节点各自一个错误边界：一个组件画不出来时只跳过它自己（开发者控制台留记录），整张界面照常显示。
 * 以前任何一个节点抛错都会冒到 ToolRenderBoundary，整张卡变成红色的「render_ui 无法绘制」。
 */
class NodeBoundary extends Component<{ type: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[json-render] 跳过画不出来的节点", this.props.type, error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const { registry: jsonRenderRegistry } = defineRegistry(jsonRenderCatalog, {
  components: {
    Card: ({ props, children }) => (
      <section className={cn("jr-card jr-el", props.tone && props.tone !== "default" && `is-${props.tone}`)}>
        {props.title || props.description ? (
          <header className="jr-card-h">
            {props.title ? <h3>{props.title}</h3> : null}
            {props.description ? <p>{props.description}</p> : null}
          </header>
        ) : null}
        <div className="jr-card-b">{children}</div>
      </section>
    ),
    Stack: ({ props, children }) => (
      <div
        className={cn(
          "jr-stack jr-el",
          props.direction === "horizontal" ? "is-row" : "is-col",
          `gap-${props.gap ?? "md"}`,
          props.align && `align-${props.align}`,
          props.justify && `justify-${props.justify}`,
          (props.wrap ?? props.direction === "horizontal") && "is-wrap",
        )}
      >
        {children}
      </div>
    ),
    Grid: ({ props, children }) => (
      <div
        className={cn("jr-grid jr-el", `gap-${props.gap ?? "md"}`)}
        style={{ "--jr-cols": String(props.columns ?? 2) } as CSSProperties}
      >
        {children}
      </div>
    ),
    Heading: ({ props }) => {
      const level = props.level ?? 2;
      const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
      return <Tag className={cn("jr-heading jr-el", `is-l${level}`)}>{props.text}</Tag>;
    },
    Text: ({ props }) => (
      <p
        className={cn(
          "jr-text jr-el",
          props.tone && props.tone !== "default" && `is-${props.tone}`,
          props.size === "sm" && "is-sm",
          props.weight && props.weight !== "normal" && `is-${props.weight}`,
        )}
      >
        {props.text}
      </p>
    ),
    Metric: ({ props }) => {
      const Trend = props.trend ? TREND_ICON[props.trend] : null;
      const { num, unit } = splitMetricValue(text(props.value));
      return (
        <div className="jr-metric jr-el">
          <div className="jr-metric-k" title={props.label}>
            {props.label}
          </div>
          <FitLine className={cn("jr-metric-v", props.tone && props.tone !== "default" && `is-${props.tone}`)}>
            {num}
            {unit ? <span className="jr-metric-u">{unit}</span> : null}
          </FitLine>
          {props.delta ? (
            <div className={cn("jr-metric-d", props.trend && `is-${props.trend}`)}>
              {Trend ? <Trend className="size-3.5 shrink-0" aria-hidden /> : null}
              <span className="truncate">{props.delta}</span>
            </div>
          ) : null}
        </div>
      );
    },
    Table: ({ props }) => {
      const columns = Array.isArray(props.columns) ? props.columns : [];
      const rows = (Array.isArray(props.rows) ? props.rows : []) as Record<string, unknown>[];
      return (
        <div className="jr-tbl jr-el">
          {props.caption ? <div className="jr-tbl-cap">{props.caption}</div> : null}
          <div className="jr-table-wrap">
            <table className="jr-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className={column.align ? `is-${column.align}` : undefined} scope="col">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no identity of their own.
                  <tr key={index}>
                    {columns.map((column) => (
                      <td key={column.key} className={column.align ? `is-${column.align}` : undefined}>
                        {text(row?.[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <CompactRows columns={columns} rows={rows} />
        </div>
      );
    },
    List: ({ props }) => {
      const Tag = props.ordered ? "ol" : "ul";
      return (
        <Tag className={cn("jr-list jr-el", props.ordered && "is-ordered")}>
          {(Array.isArray(props.items) ? props.items : []).map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items carry no identity of their own.
            <li key={index} className="jr-list-row">
              {props.ordered ? <span className="jr-list-n">{index + 1}</span> : null}
              <div className="min-w-0 flex-1">
                <div className="jr-list-t">{item.title}</div>
                {item.description ? <div className="jr-list-s">{item.description}</div> : null}
              </div>
              {item.meta ? <div className="jr-list-m">{item.meta}</div> : null}
            </li>
          ))}
        </Tag>
      );
    },
    Badge: ({ props }) => (
      <span className={cn("jr-badge jr-el", props.tone && props.tone !== "default" && `is-${props.tone}`)}>
        {props.text}
      </span>
    ),
    Button: ({ props, emit }) => (
      <Button
        className="jr-button jr-el"
        disabled={props.disabled ?? false}
        onClick={() => emit("press")}
        size="sm"
        type="button"
        variant={BUTTON_VARIANT[props.variant ?? "primary"]}
      >
        {props.label}
      </Button>
    ),
    Input: ({ props, bindings }) => {
      const id = useId();
      const [value, setValue] = useBoundProp<string | number | null | undefined>(
        props.value,
        bindings?.value,
      );
      const shown = value === null || value === undefined ? "" : String(value);
      return (
        <div className="jr-field jr-el">
          <label className="jr-label" htmlFor={id}>
            {props.label}
          </label>
          {props.multiline ? (
            <Textarea
              className="jr-control"
              id={id}
              onChange={(event) => setValue(event.target.value)}
              placeholder={props.placeholder ?? undefined}
              value={shown}
            />
          ) : (
            <Input
              className="jr-control"
              id={id}
              onChange={(event) =>
                setValue(
                  props.type === "number" && event.target.value !== ""
                    ? Number(event.target.value)
                    : event.target.value,
                )
              }
              placeholder={props.placeholder ?? undefined}
              type={props.type ?? "text"}
              value={shown}
            />
          )}
          {props.helper ? <div className="jr-helper">{props.helper}</div> : null}
        </div>
      );
    },
    Select: ({ props, bindings }) => {
      const id = useId();
      const [value, setValue] = useBoundProp<string | null | undefined>(props.value, bindings?.value);
      const options = (Array.isArray(props.options) ? props.options : []).filter(Boolean).map((option) =>
        typeof option === "string" ? { label: option, value: option } : option,
      );
      return (
        <div className="jr-field jr-el">
          <label className="jr-label" htmlFor={id}>
            {props.label}
          </label>
          <select
            className="jr-select"
            id={id}
            onChange={(event) => setValue(event.target.value)}
            value={value ?? ""}
          >
            <option disabled value="">
              {props.placeholder ?? "请选择"}
            </option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      );
    },
    Checkbox: ({ props, bindings }) => {
      const id = useId();
      const [checked, setChecked] = useBoundProp<boolean | null | undefined>(
        props.checked,
        bindings?.checked,
      );
      return (
        <div className="jr-check jr-el">
          <Checkbox checked={checked === true} id={id} onCheckedChange={(next) => setChecked(next === true)} />
          <label htmlFor={id}>
            <span className="jr-check-t">{props.label}</span>
            {props.description ? <span className="jr-check-s">{props.description}</span> : null}
          </label>
        </div>
      );
    },
    Alert: ({ props }) => {
      const tone = props.tone ?? "info";
      const Icon = ALERT_ICON[tone];
      return (
        <div className={cn("jr-alert jr-el", `is-${tone}`)} role={tone === "danger" ? "alert" : "status"}>
          <Icon aria-hidden className="jr-alert-ic size-[18px]" />
          <div className="min-w-0 flex-1">
            {props.title ? <div className="jr-alert-t">{props.title}</div> : null}
            <div className="jr-alert-m">{props.message}</div>
          </div>
        </div>
      );
    },
    Progress: ({ props }) => {
      const value = Math.max(0, Math.min(100, Number(props.value) || 0));
      return (
        <div className="jr-progress jr-el">
          {props.label ? (
            <div className="jr-progress-k">
              <span>{props.label}</span>
              <span>{`${Math.round(value)}%`}</span>
            </div>
          ) : null}
          <div
            aria-label={props.label ?? "进度"}
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={value}
            className={cn("jr-progress-track", props.tone && props.tone !== "default" && `is-${props.tone}`)}
            role="progressbar"
          >
            <div className="jr-progress-bar" style={{ width: `${value}%` }} />
          </div>
        </div>
      );
    },
    Image: ({ props }) => {
      const safe = typeof props.src === "string" && /^https:\/\//i.test(props.src);
      return (
        <figure className={cn("jr-image jr-el", props.aspect && props.aspect !== "auto" && "has-aspect")}
          style={
            props.aspect && props.aspect !== "auto"
              ? ({ "--jr-aspect": props.aspect.replace(":", " / ") } as CSSProperties)
              : undefined
          }
        >
          {safe ? (
            <img alt={props.alt} decoding="async" loading="lazy" referrerPolicy="no-referrer" src={props.src} />
          ) : (
            <div className="jr-image-blocked">{"图片地址不安全，已隐藏"}</div>
          )}
          {props.caption ? <figcaption>{props.caption}</figcaption> : null}
        </figure>
      );
    },
    Separator: () => <hr className="jr-sep jr-el" />,
  },
  /*
   * 动作的真正实现在 render-ui-tool.tsx 里通过 JSONUIProvider 的 handlers 传入，因为它们要用到当前对话
   * （ConversationProvider）和这一张界面自己的状态。这里的占位只满足目录的类型要求，不会被调用。
   */
  actions: {
    send_message: async () => undefined,
    open_link: async () => undefined,
  },
});

/*
 * 原地给每个渲染器套上 NodeBoundary。原地改（而不是返回新对象），因为 json-render 用这个对象本身
 * 作为 WeakMap 的键记录目录元数据。
 */
for (const [type, Render] of Object.entries(jsonRenderRegistry)) {
  jsonRenderRegistry[type] = (props) => (
    <NodeBoundary type={type}>
      <Render {...props} />
    </NodeBoundary>
  );
}
