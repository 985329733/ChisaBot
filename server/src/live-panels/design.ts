/**
 * 面板设计规范 + 制作流程 + 服务器检查（2026-10-13，用户：「得给 bot 一个规范，让它制作面板好看一些……
 * 把这套提示词工作流都给 bot」）。
 *
 * 右栏面板是机器人自己做的，什么主题都有可能（天气、行情、待办、倒计时、服务器状态……）。渲染端已经兜底
 * （一层外壳、数字不折行、窄表格换简表，DESIGN.md §29），但兜底只能让坏规范「不难看」，好看要靠机器人
 * 一开始就按同一套规矩做：
 *  - {@link PANEL_DESIGN_GUIDE}：给机器人的规范和流程（系统提示词里，有面板工具时才加）；
 *  - {@link lintPanelSpec}：panel_update 保存前逐条检查，不合格就退回，并写清楚每一处怎么改。
 *
 * 规范和检查是一套东西：规范里写的每条硬限制都在检查里，改一处要两处一起改（数字都来自 {@link PANEL_LIMITS}）。
 */
import { parseRenderUiSpec, sanitizeRenderUiSpec } from "../../../shared/json-render/catalog";
import { sameTitle } from "../../../shared/json-render/panel-title";

export const PANEL_LIMITS = {
  /** 面板里的大块（表格、列表、图片、进度条组）最多几块。 */
  bigParts: 2,
  /** 数字磁贴最多几个。 */
  metrics: 4,
  /** 列表 / 表格默认最多几行。 */
  rows: 5,
  /** 用户明确要更多行时的硬上限（检查按这个数退回）。 */
  rowsMax: 7,
  /** 表格单元格（第一列除外）宽度上限。 */
  cell: 8,
  /** 表格最多几列。 */
  columns: 4,
  /** 标签宽度上限（汉字算 1，拉丁字母和数字算 0.5：6 个汉字或 12 个字母）。 */
  label: 6,
  /** 大数字（含单位）宽度上限。 */
  value: 9,
  /** 一段 Text 的宽度上限（超过就是段落了）。 */
  text: 32,
  /** 从根算起最多几层（根 Stack → Grid → Metric 是 3 层）。 */
  depth: 4,
  /** 元素总数上限。 */
  elements: 24,
} as const;

/** 宽度：汉字 / 全角算 1，其余（字母、数字、半角符号）算 0.5。 */
export function textWidth(value: unknown): number {
  let width = 0;
  for (const ch of String(value ?? "")) width += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/u.test(ch) ? 1 : 0.5;
  return width;
}

const example = (spec: unknown) => JSON.stringify(spec);

const PATTERNS = [
  [
    "A 指标 + 趋势（价格、汇率、气温、流量）",
    "一个主数字带涨跌，下面 2–4 个小数字；需要的话再加一张 ≤5 行的小表（比如未来几天）。",
    example({
      root: "r",
      elements: {
        r: { type: "Stack", props: { gap: "md" }, children: ["t", "m", "g"] },
        t: { type: "Text", props: { text: "10/13 09:00 · 美元", tone: "muted", size: "sm" }, children: [] },
        m: { type: "Metric", props: { label: "现价", value: "$81,272", delta: "24h -3.1%", trend: "down" }, children: [] },
        g: { type: "Grid", props: { columns: 2 }, children: ["a", "b"] },
        a: { type: "Metric", props: { label: "24h 最高", value: "$83,950" }, children: [] },
        b: { type: "Metric", props: { label: "24h 最低", value: "$80,880" }, children: [] },
      },
    }),
  ],
  [
    "B 列表（新闻、待办、日程、排行）",
    "一句淡色说明 + 一个 List，最多 5 行；title 一行说完，meta 放时间 / 数量 / 状态这类短信息。",
    example({
      root: "r",
      elements: {
        r: { type: "Stack", props: { gap: "sm" }, children: ["t", "l"] },
        t: { type: "Text", props: { text: "今天 3 项，已完成 1 项", tone: "muted", size: "sm" }, children: [] },
        l: {
          type: "List",
          props: { items: [{ title: "交季度报表", meta: "15:00" }, { title: "回复房东", meta: "今天" }, { title: "买咖啡豆", meta: "已完成" }] },
          children: [],
        },
      },
    }),
  ],
  [
    "C 对比（几个城市 / 币种 / 方案放一起看）",
    "一张 ≤4 列、≤5 行的 Table，第一列是对象名，其余列是同一单位的数字；需要时上面放 2 个 Metric 给结论。",
    example({
      root: "r",
      elements: {
        r: { type: "Stack", props: { gap: "md" }, children: ["h", "tb"] },
        h: { type: "Heading", props: { text: "今日最高温", level: 3 }, children: [] },
        tb: {
          type: "Table",
          props: {
            columns: [{ key: "c", label: "城市" }, { key: "t", label: "最高/最低", align: "right" }, { key: "p", label: "降水", align: "right" }],
            rows: [{ c: "香港", t: "31°/24°", p: "16%" }, { c: "台北", t: "29°/23°", p: "40%" }],
          },
          children: [],
        },
      },
    }),
  ],
  [
    "D 倒计时（考试、发布、假期）",
    "一个大数字写剩余时间，一条进度条，一行淡色日期。",
    example({
      root: "r",
      elements: {
        r: { type: "Stack", props: { gap: "md" }, children: ["m", "p", "t"] },
        m: { type: "Metric", props: { label: "距离考试", value: "12 天" }, children: [] },
        p: { type: "Progress", props: { value: 60, label: "备考进度" }, children: [] },
        t: { type: "Text", props: { text: "10/25 周日 09:00", tone: "muted", size: "sm" }, children: [] },
      },
    }),
  ],
  [
    "E 状态（网站 / 服务器 / 订单 / 快递）",
    "一个 Badge 给总状态（正常用 success，出问题才用 warn / danger），下面 List 列出各项检查，meta 写结果。",
    example({
      root: "r",
      elements: {
        r: { type: "Stack", props: { gap: "sm" }, children: ["b", "l"] },
        b: { type: "Badge", props: { text: "全部正常", tone: "success" }, children: [] },
        l: {
          type: "List",
          props: { items: [{ title: "官网", meta: "200 · 120ms" }, { title: "接口", meta: "200 · 85ms" }] },
          children: [],
        },
      },
    }),
  ],
] as const;

const L = PANEL_LIMITS;

/** 给机器人的面板设计规范 + 制作流程（系统提示词）。 */
export const PANEL_DESIGN_GUIDE = [
  "【面板设计规范】右栏面板是一张窄卡片（先按 320px 宽设计，手机和宽屏会自动适配）。用户扫一眼就要看懂。",
  "制作流程（每次 panel_update 之前都走一遍）：",
  "1. 一句话问题：先想清楚这张面板回答用户的哪一个问题（例如「比特币现在多少钱、今天涨还是跌」「香港这几天会不会下雨」），和这个问题无关的数据一律不放。",
  "2. 选版式：从下面 A–E 里选一个（最多拼两个），照着示例的结构写。",
  "3. 填真实数据：只用这一轮刚取到的数据；取不到的项整项删掉，不要写「暂无」「--」占位，更不能编。",
  "4. 控量：照下面的硬限制删减，宁少勿多。",
  "5. 自查：交之前对照硬限制逐条检查一遍。服务器也会检查，不合格会退回并写明哪一处怎么改——照着改完重新 panel_update，不要换个面板重做。",
  "硬限制：",
  `- 只有一层外壳：卡片本身就是外壳，规范里不用 Card。最外层用 Stack（gap md），小节标题用 Heading level 3。从根算起最多 ${L.depth} 层。`,
  "- 不重复标题：卡片头已经显示面板标题，规范里不要再写一遍；需要时间 / 地点说明就用一行 Text（tone muted，size sm），例如「10/13 09:00 · 香港」；时间一律写用户当地时间（不知道就用北京时间），不写 UTC。",
  `- 大块最多 ${L.bigParts} 个（Table、List、Image、Progress 各算一块），Metric 最多 ${L.metrics} 个（2 个一排放进 Grid columns 2；主数字可以单独放在 Grid 外面）。全部元素不超过 ${L.elements} 个。`,
  `- 标签要短：Metric 的 label、表头、Badge、Heading 不超过 ${L.label} 个汉字（或 ${L.label * 2} 个字母）。`,
  `- 数字带单位：Metric 的 value 写成「数字 + 单位」的短串（26.9℃、73%、2.9 km/h、$81,272、12 天），不超过 ${L.value} 个汉字宽，不要写句子；单位会自动缩小变淡。delta + trend 只写「和过去比」的变化（较昨日 +1.2%、24h -3.1%）；体感、范围这类补充信息不要用 trend，写成另一个 Metric 或一行 Text。`,
  `- 列表、表格默认最多 ${L.rows} 行（用户明确要更多时最多 ${L.rowsMax} 行，放在同一张表里，不要拆成几张）；表格最多 ${L.columns} 列，每格不超过 ${L.cell} 个汉字宽，日期写短（10/13 今天、10/14 周三），相关的数合并成一列（最高/最低写「31°/24°」），放不下的次要数据就不放。`,
  `- 不写段落：Text 只用来写一行说明（不超过 ${L.text} 个汉字宽），解释、建议说在对话里，不放进面板。`,
  "- 进度条只放算得准的比例（已完成 1/3 = 33%），算不准就不放。",
  "- 颜色有含义才用：tone 只给涨跌、预警、超阈值；普通数字不加颜色，一张面板最多 2 处有颜色。",
  "- 只读：面板里不放 Input / Select / Checkbox；要操作就在对话里说。",
  "- 中文为先：所有文字用简体中文，专有名词（BTC、USD、API）照原样。",
  "版式示例（{root, elements} 完整 JSON，panel_update 的 spec 直接交这种格式）：",
  ...PATTERNS.map(([name, how, spec]) => `${name}：${how}\n${spec}`),
].join("\n");

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[]; repeat?: unknown };

/**
 * panel_update 保存前的检查。返回给机器人看的修改意见（每条都说清楚哪一处、怎么改）；空数组 = 通过。
 * 只查规范里写明的硬限制，宁可放过也不误伤：拿不准的（动态值、$state 绑定）不算。
 */
export function lintPanelSpec(source: string, panelTitle: string): string[] {
  const spec = sanitizeRenderUiSpec(parseRenderUiSpec(source, false))?.spec as
    | { root?: string; elements?: Record<string, El> }
    | undefined;
  if (!spec?.root || !spec.elements?.[spec.root]) return [];
  const elements = spec.elements;
  const issues: string[] = [];
  const name = (key: string, el: El) => {
    const p = el.props ?? {};
    const label = p.label ?? p.title ?? p.text;
    return typeof label === "string" && label ? `${el.type}「${label.slice(0, 16)}」` : `${el.type}（${key}）`;
  };

  // 层数 + 只数从根能走到的元素
  const reachable: [string, El, number][] = [];
  const seen = new Set<string>();
  const walk = (key: string, depth: number) => {
    const el = elements[key];
    if (!el || seen.has(key)) return;
    seen.add(key);
    reachable.push([key, el, depth]);
    for (const child of Array.isArray(el.children) ? el.children : []) if (typeof child === "string") walk(child, depth + 1);
  };
  walk(spec.root, 1);

  const maxDepth = Math.max(...reachable.map(([, , d]) => d));
  if (maxDepth > L.depth) issues.push(`层数太深（${maxDepth} 层，最多 ${L.depth} 层）：去掉中间多余的 Stack / Card，同级内容直接放在最外层 Stack 里。`);

  const cards = reachable.filter(([, el]) => el.type === "Card");
  if (cards.length) {
    issues.push(
      `不要用 Card（发现 ${cards.length} 个）：面板卡片本身就是外壳。最外层的 Card 换成 Stack（gap md）；里面的 Card 去掉，它的 title 改成一个 Heading level 3，内容直接跟在后面。`,
    );
  }

  for (const [key, el] of reachable) {
    const p = el.props ?? {};
    const dup =
      (el.type === "Heading" && sameTitle(p.text, panelTitle)) ||
      (el.type === "Card" && sameTitle(p.title, panelTitle)) ||
      (el.type === "Text" && sameTitle(p.text, panelTitle));
    if (dup) issues.push(`${name(key, el)} 重复了面板标题「${panelTitle}」：卡片头已经显示标题，删掉它；要写时间或地点就用一行 Text（tone muted）。`);
  }

  const big = reachable.filter(([, el]) => ["Table", "List", "Image", "Progress"].includes(el.type ?? ""));
  if (big.length > L.bigParts) {
    issues.push(`大块太多（${big.map(([k, el]) => name(k, el)).join("、")}，最多 ${L.bigParts} 个）：只留回答核心问题的那 ${L.bigParts} 个，其余删掉或在对话里说。`);
  }
  const metrics = reachable.filter(([, el]) => el.type === "Metric");
  if (metrics.length > L.metrics) {
    issues.push(`Metric 太多（${metrics.length} 个，最多 ${L.metrics} 个）：只留最重要的 ${L.metrics} 个，次要的删掉。`);
  }
  if (reachable.length > L.elements) issues.push(`元素太多（${reachable.length} 个，最多 ${L.elements} 个）：删掉次要内容。`);

  const colored = metrics.filter(([, el]) => el.props?.tone && el.props.tone !== "default").length;
  if (colored > 2) issues.push(`有颜色的数字太多（${colored} 个）：tone 只留给涨跌、预警这类有含义的 1–2 个，其余去掉 tone。`);

  for (const [key, el] of reachable) {
    const p = el.props ?? {};
    const tooLong = (value: unknown, limit: number) => typeof value === "string" && textWidth(value) > limit;
    switch (el.type) {
      case "Metric": {
        if (tooLong(p.label, L.label)) issues.push(`Metric 的 label「${p.label}」太长：不超过 ${L.label} 个汉字，例如「体感」「24h 最高」。`);
        if (tooLong(p.value, L.value)) issues.push(`Metric「${p.label}」的 value「${String(p.value).slice(0, 20)}」太长：只写数字 + 单位（如 26.9℃、$81,272、12 天），说明文字放 delta 或删掉。`);
        break;
      }
      case "Heading":
      case "Badge":
        if (tooLong(p.text, L.label + 2)) issues.push(`${el.type}「${p.text}」太长：不超过 ${L.label} 个汉字左右。`);
        break;
      case "Text":
        if (tooLong(p.text, L.text)) issues.push(`Text「${String(p.text).slice(0, 14)}…」是一段话：面板里只放一行短说明（不超过 ${L.text} 个汉字宽），解释和建议在对话里说。`);
        break;
      case "Alert":
        if (tooLong(p.message, L.text)) issues.push(`Alert「${String(p.message).slice(0, 14)}…」太长：只写一句话的结论。`);
        break;
      case "Table": {
        const columns = Array.isArray(p.columns) ? (p.columns as { label?: unknown }[]) : [];
        const rows = Array.isArray(p.rows) ? p.rows : [];
        if (columns.length > L.columns) issues.push(`表格列太多（${columns.length} 列，最多 ${L.columns} 列）：相关的合成一列（如「最高/最低」写 31°/24°），次要的列删掉。`);
        if (rows.length > L.rowsMax) issues.push(`表格行太多（${rows.length} 行，最多 ${L.rowsMax} 行）：只留最近 / 最重要的 ${L.rows} 行。`);
        const restKeys = columns.slice(1).map((c) => (c as { key?: unknown }).key).filter((k): k is string => typeof k === "string");
        const longCells = rows
          .flatMap((row) => restKeys.map((k) => (row as Record<string, unknown>)?.[k]))
          .filter((v) => tooLong(v, L.cell))
          .slice(0, 3)
          .map((v) => `「${String(v).slice(0, 16)}」`);
        if (longCells.length) issues.push(`表格单元格 ${longCells.join("、")} 太长：每格不超过 ${L.cell} 个汉字宽，一格只放一个数；次要的数据删掉。`);
        const longHeads = columns.filter((c) => tooLong(c.label, L.label)).map((c) => `「${c.label}」`);
        if (longHeads.length) issues.push(`表头 ${longHeads.join("、")} 太长：不超过 ${L.label} 个汉字。`);
        break;
      }
      case "List": {
        const items = Array.isArray(p.items) ? (p.items as { title?: unknown; meta?: unknown }[]) : [];
        if (items.length > L.rowsMax) issues.push(`列表行太多（${items.length} 行，最多 ${L.rowsMax} 行）：只留最重要的 ${L.rows} 行。`);
        if (items.some((item) => tooLong(item.meta, L.value + 3))) issues.push("列表右侧的 meta 太长：只写时间、数量、状态这类短信息，长内容放 description。");
        break;
      }
      case "Grid":
        if (Number(p.columns) > 3) issues.push(`Grid 的 columns ${p.columns} 太多：窄卡里用 2（最多 3）。`);
        break;
      case "Input":
      case "Select":
      case "Checkbox":
        issues.push(`${name(key, el)}：面板是只读的，不放输入控件；需要用户操作就在对话里说。`);
        break;
    }
  }
  return [...new Set(issues)];
}
