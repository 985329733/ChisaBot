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
import { type CSSProperties, useId } from "react";
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
      return (
        <div className="jr-metric jr-el">
          <div className="jr-metric-k">{props.label}</div>
          <div className={cn("jr-metric-v", props.tone && props.tone !== "default" && `is-${props.tone}`)}>
            {text(props.value)}
          </div>
          {props.delta ? (
            <div className={cn("jr-metric-d", props.trend && `is-${props.trend}`)}>
              {Trend ? <Trend className="size-3.5" aria-hidden /> : null}
              {props.delta}
            </div>
          ) : null}
        </div>
      );
    },
    Table: ({ props }) => (
      <div className="jr-table-wrap jr-el">
        <table className="jr-table">
          {props.caption ? <caption>{props.caption}</caption> : null}
          <thead>
            <tr>
              {props.columns.map((column) => (
                <th key={column.key} className={column.align ? `is-${column.align}` : undefined} scope="col">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(props.rows) ? props.rows : []).map((row, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows carry no identity of their own.
              <tr key={index}>
                {props.columns.map((column) => (
                  <td key={column.key} className={column.align ? `is-${column.align}` : undefined}>
                    {text(row?.[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
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
      const options = (Array.isArray(props.options) ? props.options : []).map((option) =>
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
