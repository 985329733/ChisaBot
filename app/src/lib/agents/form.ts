import { z } from "zod";

/**
 * Browser-side coworker form contract. Limits match the server parser so validation errors can be
 * shown next to fields before submit.
 */
export const agentFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写名称。")
    .max(80, "名称最多 80 个字。"),
  title: z
    .string()
    .trim()
    .min(1, "请填写职责。")
    .max(120, "职责最多 120 个字。"),
  roleDescription: z
    .string()
    .trim()
    .min(1, "请填写提示词。")
    .max(1000, "提示词最多 1000 个字。"),
  visibility: z.enum(["public", "private"]),
  /**
   * The AG-UI endpoint this coworker runs on. Empty means the Bot in the box.
   *
   * Only URL shape is checked here; deployment allow/deny rules are server-side.
   */
  endpoint: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^https?:\/\/\S+$/.test(value),
      "请输入以 http:// 或 https:// 开头的网址。",
    ),
  /**
   * A key the agent sits behind. WRITE-ONLY: it is never sent back from the server, so this field is
   * always empty when editing, and leaving it empty keeps whatever key is already set.
   */
  authValue: z.string(),
});

export type AgentFormValues = z.infer<typeof agentFormSchema>;

export const emptyAgentForm: AgentFormValues = {
  name: "",
  title: "",
  roleDescription: "",
  visibility: "private",
  endpoint: "",
  authValue: "",
};

/** 新建时没写「它做什么」的机器人，左栏副标题写这个。 */
export const DEFAULT_BOT_TITLE = "私人助手";

const BASELINE = "默认用简体中文，回答清晰、简洁、准确；不确定的事先说明，需要时用工具查证。";

/**
 * 从「它做什么」取一个短职责（左栏副标题）：第一句、去掉开头的「你是 / 你负责 / 负责 / 帮我」，最多 18 个字。
 * 例：「你是我的英语老师，帮我纠正语法」→「我的英语老师」；「帮我记账」→「记账」。
 */
export function titleFromPurpose(purpose: string): string {
  const first = purpose.trim().split(/[。！？!?\n；;，,.]/)[0]?.trim() ?? "";
  const bare = first.replace(/^(你是|你负责|你要|负责|帮我|请)\s*/, "").trim();
  if (!bare) return DEFAULT_BOT_TITLE;
  return bare.length > 18 ? `${bare.slice(0, 17)}…` : bare;
}

/**
 * 新建机器人（DESIGN.md §74.2，2026-10-16 功能精简）：表单只有「名称」和可不填的「它做什么」。
 * - 职责（副标题）从「它做什么」的第一句取，没写就是「私人助手」；
 * - 提示词：写了「你是…」开头的整段话，原样用；只写了一句要做的事，前面补「你是「名称」。」、后面补一句基本要求；
 *   什么都没写，就是「你是「名称」。」+ 基本要求。之后都能在机器人资料里改。
 * 输入框保持空白、不放模板（§46）。
 */
export function withCreateDefaults(values: AgentFormValues): AgentFormValues {
  const name = values.name.trim();
  const purpose = values.roleDescription.trim();
  const title = values.title.trim() || (purpose ? titleFromPurpose(purpose) : DEFAULT_BOT_TITLE);
  let roleDescription: string;
  if (!purpose) roleDescription = `你是「${name}」。${BASELINE}`;
  else if (/^你是/.test(purpose)) roleDescription = purpose;
  else {
    const wrapped = `你是「${name}」。${purpose}${/[。！？.!?]$/.test(purpose) ? "" : "。"}\n${BASELINE}`;
    roleDescription = wrapped.length <= 1000 ? wrapped : purpose;
  }
  return { ...values, title, roleDescription };
}

/** Convert form values to API input; omit an empty key so editing preserves the current credential. */
export function agentInputFrom(values: AgentFormValues) {
  return {
    name: values.name,
    title: values.title,
    roleDescription: values.roleDescription,
    visibility: values.visibility,
    endpoint: values.endpoint,
    ...(values.authValue.trim()
      ? { auth: { header: "Authorization", value: values.authValue.trim() } }
      : {}),
  };
}
