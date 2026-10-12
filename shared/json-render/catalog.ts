import {
  compileSpecStream,
  defineCatalog,
  formatSpecIssues,
  type Spec,
  validateSpec,
} from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/**
 * 生成式界面（json-render）的组件目录，服务器与浏览器共用一份。
 *
 * 服务器用它生成提示词（`catalog.prompt()`）并在 `render_ui` 工具里校验机器人给出的规范；浏览器用同一份
 * 目录注册组件实现（app/src/lib/copilot/json-render）。两边读同一个文件，所以「模型被告知能用什么」和
 * 「界面实际能画什么」不会漂移。
 *
 * 取代原来的 A2UI（@copilotkit/a2ui-renderer basicCatalog）。开关仍是 DeploymentConfig.generativeUi
 * （OPENBOT_GENERATIVE_UI），关掉时既不给工具，也不注册渲染器。
 */

export const RENDER_UI_TOOL = "render_ui";

const tone = z
  .enum(["default", "accent", "success", "warn", "danger"])
  .nullish()
  .describe("语义色，默认 default");
const gap = z.enum(["sm", "md", "lg"]).nullish().describe("间距，默认 md");

/** 单元格只接受纯文本 / 数字，不接受 HTML。 */
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const jsonRenderCatalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string().nullish(),
        description: z.string().nullish(),
        tone,
      }),
      slots: ["default"],
      description:
        "磨砂玻璃卡片，界面的最外层通常用它。title 为卡片标题，description 为一句说明。",
    },
    Stack: {
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).nullish(),
        gap,
        align: z.enum(["start", "center", "end", "stretch"]).nullish(),
        justify: z.enum(["start", "center", "end", "between"]).nullish(),
        wrap: z.boolean().nullish(),
      }),
      slots: ["default"],
      description: "纵向（默认）或横向排列子元素。按钮组用 horizontal。",
    },
    Grid: {
      props: z.object({
        columns: z.number().int().min(1).max(4).nullish().describe("列数 1–4，默认 2；窄屏自动变成一列"),
        gap,
      }),
      slots: ["default"],
      description: "等宽多列网格，适合放多个 Metric 或小卡片。",
    },
    Heading: {
      props: z.object({
        text: z.string(),
        level: z.number().int().min(1).max(3).nullish().describe("1 最大，默认 2"),
      }),
      slots: [],
      description: "标题文字。",
    },
    Text: {
      props: z.object({
        text: z.string(),
        tone: z.enum(["default", "muted", "success", "warn", "danger"]).nullish(),
        size: z.enum(["sm", "md"]).nullish(),
        weight: z.enum(["normal", "medium", "bold"]).nullish(),
      }),
      slots: [],
      description: "一段纯文本（不支持 Markdown / HTML），换行用 \\n。",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]),
        delta: z.string().nullish().describe("对比说明，例如 “较昨日 +12%”"),
        trend: z.enum(["up", "down", "flat"]).nullish(),
        tone,
      }),
      slots: [],
      description: "统计磁贴：小标签 + 大数字 + 可选对比。",
    },
    Table: {
      props: z.object({
        columns: z
          .array(
            z.object({
              key: z.string(),
              label: z.string(),
              align: z.enum(["left", "right", "center"]).nullish(),
            }),
          )
          .min(1),
        rows: z.array(z.record(z.string(), cell)),
        caption: z.string().nullish(),
      }),
      slots: [],
      description: "数据表格。rows 每一项是 { 列 key: 文本或数字 }。行数多于 20 时只放最重要的。",
    },
    List: {
      props: z.object({
        items: z.array(
          z.object({
            title: z.string(),
            description: z.string().nullish(),
            meta: z.string().nullish().describe("右侧的短信息，例如时间、数量"),
          }),
        ),
        ordered: z.boolean().nullish(),
      }),
      slots: [],
      description: "列表行：标题 + 可选说明 + 右侧元信息。",
    },
    Badge: {
      props: z.object({ text: z.string(), tone }),
      slots: [],
      description: "胶囊徽标，用于状态、标签。",
    },
    Button: {
      props: z.object({
        label: z.string(),
        variant: z.enum(["primary", "secondary", "ghost", "danger"]).nullish(),
        disabled: z.boolean().nullish(),
      }),
      slots: [],
      description:
        "胶囊按钮，点击触发 press 事件。用 on.press 绑定动作：send_message（以用户身份发一条消息给你）、open_link 或内置的 setState。",
    },
    Input: {
      props: z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]).nullish().describe("用 { \"$bindState\": \"/form/xxx\" } 双向绑定"),
        placeholder: z.string().nullish(),
        type: z.enum(["text", "number", "email", "date", "time", "url"]).nullish(),
        multiline: z.boolean().nullish().describe("true 时为多行文本框"),
        helper: z.string().nullish(),
      }),
      slots: [],
      description: "表单输入框。value 必须用 $bindState 绑定到 state 里的路径。",
    },
    Select: {
      props: z.object({
        label: z.string(),
        value: z.string().nullish().describe("用 $bindState 绑定"),
        options: z.array(
          z.union([z.string(), z.object({ label: z.string(), value: z.string() })]),
        ),
        placeholder: z.string().nullish(),
      }),
      slots: [],
      description: "下拉选择。value 用 $bindState 绑定。",
    },
    Checkbox: {
      props: z.object({
        label: z.string(),
        checked: z.boolean().nullish().describe("用 $bindState 绑定"),
        description: z.string().nullish(),
      }),
      slots: [],
      description: "勾选框。checked 用 $bindState 绑定。",
    },
    Alert: {
      props: z.object({
        title: z.string().nullish(),
        message: z.string(),
        tone: z.enum(["info", "success", "warn", "danger"]).nullish(),
      }),
      slots: [],
      description: "提示条：信息 / 成功 / 警告 / 错误。",
    },
    Progress: {
      props: z.object({
        value: z.number().min(0).max(100),
        label: z.string().nullish(),
        tone,
      }),
      slots: [],
      description: "进度条，value 为 0–100。",
    },
    Image: {
      props: z.object({
        src: z.string().describe("必须是 https:// 开头的图片地址"),
        alt: z.string(),
        caption: z.string().nullish(),
        aspect: z.enum(["16:9", "4:3", "1:1", "auto"]).nullish(),
      }),
      slots: [],
      description: "图片。只用你确实拿到的真实 https 图片地址，不要编造链接。",
    },
    Separator: {
      props: z.object({}),
      slots: [],
      description: "1px 分隔线。",
    },
  },
  actions: {
    send_message: {
      params: z.object({
        text: z.string().describe("要以用户身份发送的消息"),
        includeState: z
          .string()
          .nullish()
          .describe("可选，一个 state 路径（如 /form）；该路径下的值会以 JSON 附在消息后面，用于提交表单"),
      }),
      description:
        "以用户身份在当前对话里发送一条消息给你（用户能看到这条消息），用于“确认 / 选这个 / 提交表单”等按钮。之后的任何实际操作仍要走你的工具和正常的审批。",
    },
    open_link: {
      params: z.object({ url: z.string().describe("http(s) 链接") }),
      description: "在新标签页打开一个 http(s) 链接。",
    },
  },
});

export type JsonRenderComponentName = keyof typeof jsonRenderCatalog.data.components;

/** 提示词里不适合机器人代用户回答的条目：json-render 默认要求「编造示例数据」，这里必须用真实数据。 */
const DROPPED_PROMPT_LINE = /sample data|realistic|Never leave data empty|Never leave arrays empty/i;

const CUSTOM_RULES = [
  "界面里的所有文字一律使用简体中文。",
  "type 只能是上面 AVAILABLE COMPONENTS 列出的组件名；不要使用其他工具里的组件名（例如 Record、Chart、Kanban）。",
  "只展示你真实拥有的信息（来自对话、工具结果或你确定的知识），绝不编造数据、链接或图片；没有数据就不要画这一块。",
  "最外层通常是一个 Card；多个 Metric 放进 Grid；按钮组放进 horizontal Stack。保持简洁，一般不超过 30 个元素。",
  "按钮只用 send_message、open_link 或内置的 setState / pushState / removeState / validateForm；不要使用 confirm 字段。",
  "用户要的是「面板」（放在右侧面板栏、长期保留的小工具）时不要用 render_ui：有 proposePanelDraft 工具就用它保存；没有就请用户点右栏面板的「新建」后再说一遍。",
  "send_message 只是替用户发一条消息给你，真正的操作（发送邮件、付款、删除等）仍由你在下一轮用工具完成，并照常经过审批。",
  "表单：输入组件用 $bindState 绑定到 /form/... 并在 /state 里给出初始值；提交按钮用 send_message 并设置 includeState 为 \"/form\"。",
] as const;

/**
 * 机器人看到的 `render_ui` 说明：json-render 的目录提示词（SpecStream / JSONL 格式），外加本部署的规则。
 * 格式不改：JSONL 正是 json-render 的流式协议，所以浏览器能边生成边画。
 */
export function renderUiPrompt(): string {
  const generated = jsonRenderCatalog
    .prompt({
      system:
        `你可以调用 ${RENDER_UI_TOOL} 工具，在对话里画出一个可交互的界面（卡片、统计、表格、列表、表单、按钮等）。` +
        "当结构化展示比纯文字更清楚时使用它（对比、汇总、数据、选项、表单）；简单回答直接用文字。" +
        "把下面格式的 JSONL 写进 spec 参数（一个字符串，每行一个 JSON Patch），不要在聊天正文里输出 JSONL 或代码块。" +
        "调用之后用一两句话补充说明即可，不要用文字重复界面里的内容。",
      customRules: [...CUSTOM_RULES],
    })
    .split("\n")
    .filter((line) => !DROPPED_PROMPT_LINE.test(line))
    .join("\n");
  return generated;
}

const DYNAMIC_KEYS = new Set([
  "$state",
  "$bindState",
  "$bindItem",
  "$item",
  "$index",
  "$cond",
  "$template",
  "$computed",
]);

/** `{ "$state": "/x" }` 之类的动态表达式在渲染时才解析，不能按静态类型校验。 */
function isDynamic(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => DYNAMIC_KEYS.has(key))
  );
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\s*\n([\s\S]*?)\n?```$/i.exec(trimmed);
  return fenced ? (fenced[1] ?? "") : trimmed;
}

/**
 * 把工具参数变成 Spec。接受两种写法：JSONL（json-render SpecStream，推荐，可流式）或一个完整的
 * `{ root, elements, state? }` JSON 对象（有些模型会这样给）。
 *
 * `partial` 为 true 时用于流式渲染：只编译已经完整的行，最后一行可能还没写完。
 */
export function parseRenderUiSpec(input: unknown, partial = false): Spec | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Spec;
  }
  if (typeof input !== "string") return null;
  const text = stripFence(input);
  if (!text) return null;
  if (text.startsWith("{") && !partial) {
    try {
      const whole = JSON.parse(text) as Record<string, unknown>;
      if (whole && typeof whole === "object" && "root" in whole && "elements" in whole) {
        return whole as unknown as Spec;
      }
    } catch {
      // 不是单个 JSON 对象，按 JSONL 处理。
    }
  }
  const lines = text.split("\n");
  // 流式时最后一行可能没写完；结束后的最后一行也可能没有换行符，但它是完整的。
  const complete = partial && !text.endsWith("\n") ? lines.slice(0, -1) : lines;
  const usable = complete.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return false;
    if (!partial) return true;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  });
  if (usable.length === 0) return null;
  try {
    const spec = compileSpecStream<Record<string, unknown>>(usable.join("\n"));
    return spec && typeof spec === "object" ? (spec as unknown as Spec) : null;
  } catch {
    return null;
  }
}

const BUILT_IN_ACTIONS = new Set(["setState", "pushState", "removeState", "validateForm"]);

/** `on` 里的动作：名字必须存在；本部署的动作（send_message / open_link）按目录校验参数。 */
function actionIssues(key: string, on: unknown): string[] {
  if (on === undefined || on === null) return [];
  if (typeof on !== "object" || Array.isArray(on)) return [`elements.${key}.on 必须是 { 事件名: 动作 } 对象。`];
  const actions = jsonRenderCatalog.data.actions as Record<string, { params: z.ZodObject<z.ZodRawShape> }>;
  const found: string[] = [];
  for (const [event, value] of Object.entries(on as Record<string, unknown>)) {
    for (const binding of Array.isArray(value) ? value : [value]) {
      const { action, params } = (binding ?? {}) as { action?: unknown; params?: unknown };
      if (typeof action !== "string") {
        found.push(`elements.${key}.on.${event} 缺少 action。`);
        continue;
      }
      if (BUILT_IN_ACTIONS.has(action)) continue;
      const definition = actions[action];
      if (!definition) {
        found.push(
          `elements.${key}.on.${event}: 未知动作 "${action}"，只能用 ${[...Object.keys(actions), ...BUILT_IN_ACTIONS].join(" / ")}。`,
        );
        continue;
      }
      const given = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
      for (const [name, field] of Object.entries(definition.params.shape)) {
        if (isDynamic(given[name])) continue;
        if (!(field as z.ZodType).safeParse(given[name]).success) {
          found.push(`elements.${key}.on.${event}: 动作 ${action} 的参数 params.${name} 缺失或无效。`);
        }
      }
    }
  }
  return found;
}

export type RenderUiValidation =
  | { ok: true; spec: Spec; elementCount: number; warnings?: string[] }
  | { ok: false; issues: string[] };

const MAX_ELEMENTS = 200;

/** 结构（root / children / visible / repeat）+ 目录（组件名）+ 各组件的静态属性。 */
export function validateRenderUiSpec(spec: Spec | null): RenderUiValidation {
  if (!spec || typeof spec !== "object") {
    return { ok: false, issues: ["spec 为空或无法解析。请按 JSONL（每行一个 JSON Patch）格式给出。"] };
  }
  const issues: string[] = [];
  if (typeof spec.root !== "string" || !spec.root) issues.push("缺少 /root。");
  const elements = (spec.elements ?? {}) as Record<string, unknown>;
  const count = Object.keys(elements).length;
  if (count === 0) issues.push("没有任何元素（/elements 为空）。");
  if (count > MAX_ELEMENTS) issues.push(`元素太多（${count} 个，最多 ${MAX_ELEMENTS} 个）。`);
  if (spec.root && !(spec.root in elements)) issues.push(`root 指向的元素 "${spec.root}" 不存在。`);

  const catalogResult = jsonRenderCatalog.validate(spec);
  if (!catalogResult.success) {
    for (const issue of catalogResult.error?.issues ?? []) {
      // 组件名错误在下面逐个元素报告，带上可用组件列表，这里不重复。
      if (issue.path.at(-1) === "type") continue;
      issues.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  const structural = validateSpec(spec);
  if (!structural.valid) {
    for (const line of formatSpecIssues(structural.issues.filter((i) => i.severity === "error"))
      .split("\n")
      .slice(1)) {
      if (line.trim()) issues.push(line.replace(/^-\s*/, ""));
    }
  }

  const components = jsonRenderCatalog.data.components as Record<
    string,
    { props: z.ZodObject<z.ZodRawShape> }
  >;
  for (const [key, raw] of Object.entries(elements)) {
    const element = raw as { type?: unknown; props?: unknown };
    const definition = typeof element?.type === "string" ? components[element.type] : undefined;
    if (!definition) {
      issues.push(
        `elements.${key}: 未知组件 "${String(element?.type)}"，只能用 ${jsonRenderCatalog.componentNames.join(" / ")}。`,
      );
      continue;
    }
    const props = (element.props ?? {}) as Record<string, unknown>;
    if (typeof props !== "object" || Array.isArray(props)) {
      issues.push(`elements.${key}.props 必须是对象。`);
      continue;
    }
    const shape = definition.props.shape;
    for (const [name, field] of Object.entries(shape)) {
      const value = props[name];
      if (isDynamic(value)) continue;
      const result = (field as z.ZodType).safeParse(value);
      if (!result.success) {
        const first = result.error.issues[0];
        issues.push(
          `elements.${key}（${String(element.type)}）.props.${name}${first?.path.length ? `.${first.path.join(".")}` : ""}: ${first?.message ?? "无效"}`,
        );
      }
    }
    issues.push(...actionIssues(key, (element as { on?: unknown }).on));
    if (element.type === "Image" && typeof props.src === "string" && !/^https:\/\//i.test(props.src)) {
      issues.push(`elements.${key}.props.src 必须是 https:// 开头的地址。`);
    }
  }

  if (issues.length > 0) return { ok: false, issues: [...new Set(issues)].slice(0, 20) };
  return { ok: true, spec, elementCount: count };
}

/**
 * 宽容处理：把「一个坏节点」限制在那个节点里，而不是整张界面都被拒绝。
 *
 * 线上数据里 render_ui 失败的调用几乎都是这几种（2026-10-11/12，FRA 库里 9 次调用 4 次被拒）：
 *   - send_message 的参数写成 `message` / `content`（目录里叫 `text`）——每个模型都这么写；
 *   - 用了目录里没有的组件（例如 Record）；
 *   - children 引用了不存在的元素（多半是那一行 JSONL 写坏了，被跳过）。
 * 以前任意一条都会让整个界面「无效，没有显示」，模型要再调一次，用户看到的是一行失败或者红色错误卡。
 *
 * 现在：参数别名改成 `text`；未知组件、属性不合法的元素、悬空的 children 引用直接跳过并记成警告；
 * 只有根元素本身不可用时才算失败。服务器和浏览器都先过这一步，所以两边画的是同一份。
 */
export type RenderUiSanitized = { spec: Spec; skipped: string[] };

const ACTION_TEXT_ALIASES = ["message", "content", "prompt", "query"] as const;

function normaliseBinding(binding: unknown): unknown {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return binding;
  const value = binding as { action?: unknown; params?: unknown };
  if (value.action !== "send_message") return binding;
  const params = (value.params && typeof value.params === "object" ? { ...(value.params as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (typeof params.text !== "string" || !params.text.trim()) {
    const alias = ACTION_TEXT_ALIASES.map((key) => params[key]).find(
      (candidate): candidate is string => typeof candidate === "string" && candidate.trim() !== "",
    );
    if (alias) params.text = alias;
  }
  return { ...value, params };
}

function normaliseOn(on: unknown): unknown {
  if (!on || typeof on !== "object" || Array.isArray(on)) return on;
  return Object.fromEntries(
    Object.entries(on as Record<string, unknown>).map(([event, value]) => [
      event,
      Array.isArray(value) ? value.map(normaliseBinding) : normaliseBinding(value),
    ]),
  );
}

export function sanitizeRenderUiSpec(spec: Spec | null): RenderUiSanitized | null {
  if (!spec || typeof spec !== "object") return null;
  const components = jsonRenderCatalog.data.components as Record<string, { props: z.ZodObject<z.ZodRawShape> }>;
  const input = (spec.elements ?? {}) as Record<string, unknown>;
  const skipped: string[] = [];
  const kept: Record<string, Record<string, unknown>> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      skipped.push(`${key}（不是对象）`);
      continue;
    }
    const element = { ...(raw as Record<string, unknown>) };
    const type = element.type;
    const definition = typeof type === "string" ? components[type] : undefined;
    if (!definition) {
      skipped.push(`${key}（未知组件 ${String(type)}）`);
      continue;
    }
    const props = element.props && typeof element.props === "object" && !Array.isArray(element.props)
      ? (element.props as Record<string, unknown>)
      : {};
    const bad = Object.entries(definition.props.shape).find(([name, field]) => {
      const value = props[name];
      return !isDynamic(value) && !(field as z.ZodType).safeParse(value).success;
    });
    if (bad) {
      skipped.push(`${key}（${String(type)} 的 ${bad[0]} 无效）`);
      continue;
    }
    if (type === "Image" && typeof props.src === "string" && !/^https:\/\//i.test(props.src)) {
      skipped.push(`${key}（图片地址不是 https）`);
      continue;
    }
    element.props = props;
    if (element.on !== undefined) element.on = normaliseOn(element.on);
    kept[key] = element;
  }
  for (const [key, element] of Object.entries(kept)) {
    const children = Array.isArray(element.children) ? element.children : [];
    const present = children.filter((child): child is string => typeof child === "string" && child in kept);
    if (present.length !== children.length) {
      for (const child of children) {
        if (typeof child !== "string" || !(child in kept)) {
          if (!(typeof child === "string" && child in input)) skipped.push(`${key} → ${String(child)}（不存在）`);
        }
      }
    }
    element.children = present;
  }
  return { spec: { ...spec, elements: kept } as unknown as Spec, skipped: [...new Set(skipped)] };
}

/**
 * 一次完整的检查：先找出写坏的 JSONL 行（compileSpecStream 会静默跳过它们，结果就是「引用了不存在的
 * 子元素」这种让模型摸不着头脑的报错），再做结构 / 目录 / 属性校验。服务器的 `render_ui` 与浏览器
 * 都用它，所以两边对同一个调用的结论一致。
 */
export function inspectRenderUiSpec(input: unknown): RenderUiValidation {
  const lineIssues: string[] = [];
  if (typeof input === "string") {
    const text = stripFence(input);
    const looksWhole = text.startsWith("{") && (() => {
      try {
        const whole = JSON.parse(text) as Record<string, unknown>;
        return Boolean(whole && "root" in whole && "elements" in whole);
      } catch {
        return false;
      }
    })();
    if (!looksWhole) {
      text.split("\n").forEach((raw, index) => {
        const line = raw.trim();
        if (!line) return;
        try {
          const patch = JSON.parse(line) as { op?: unknown; path?: unknown };
          if (typeof patch?.op !== "string" || typeof patch?.path !== "string")
            lineIssues.push(`第 ${index + 1} 行不是 JSON Patch（缺少 op 或 path）。`);
        } catch {
          lineIssues.push(`第 ${index + 1} 行不是合法 JSON（括号或引号不匹配）：${line.slice(0, 80)}`);
        }
      });
    }
  }
  const sanitized = sanitizeRenderUiSpec(parseRenderUiSpec(input));
  const result = validateRenderUiSpec(sanitized?.spec ?? null);
  /*
   * 写坏的行只是被跳过的那几个元素；只要剩下的界面能画，就画，坏行记成警告。
   * 根元素都没了（或者整段没有一行能用）才算失败。
   */
  if (result.ok) {
    const warnings = [...lineIssues, ...(sanitized?.skipped.map((item) => `已跳过 ${item}`) ?? [])].slice(0, 20);
    return warnings.length ? { ...result, warnings } : result;
  }
  return {
    ok: false,
    issues: [...lineIssues, ...result.issues].slice(0, 20),
  };
}

/** 工具结果的固定开头，浏览器据此区分「已显示」与「被拒绝」。 */
export const RENDER_UI_SHOWN = "UI shown.";
