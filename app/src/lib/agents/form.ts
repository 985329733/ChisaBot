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

/** 没写职责、也没写「它做什么」的机器人，左栏副标题写这个。 */
export const DEFAULT_BOT_TITLE = "私人助手";

/** 「它做什么」留空时存这句（它就是提示词；名字、说话方式、简体中文由服务器每轮另外加，见 shared/bot-prompt.ts）。 */
export const DEFAULT_PURPOSE = "我的私人助手：回答问题、查资料、帮我把事情办好。";

/**
 * 从「它做什么」取一个短职责（左栏副标题）：第一句、去掉开头的「你是 / 你负责 / 负责 / 帮我」，最多 18 个字。
 * 例：「你是我的英语老师，帮我纠正语法」→「我的英语老师」；「帮我记账」→「记账」。
 */
export function titleFromPurpose(purpose: string): string {
  const first = purpose.trim().split(/[。！？!?\n；;，,.：:]/)[0]?.trim() ?? "";
  const bare = first.replace(/^(你是|你负责|你要|负责|帮我|请)\s*/, "").trim();
  if (!bare) return DEFAULT_BOT_TITLE;
  return bare.length > 18 ? `${bare.slice(0, 17)}…` : bare;
}

/**
 * 机器人资料表单（新建和编辑是同一张，DESIGN.md §81）：头像 · 名称（必填）· 职责 · 它做什么。
 * - 职责留空 = 从「它做什么」的第一句取（表单里直接显示这个建议，可以改）；两样都没写是「私人助手」。
 * - 「它做什么」就是提示词，原样保存，新建和编辑看到的是同一段字；留空存 DEFAULT_PURPOSE。
 *   以前（§74.2）新建时会在前后补「你是「名称」。」和一句基本要求，编辑时就多出用户没写过的字——不再补：
 *   名字和说话方式服务器每轮都会加（botIdentityGuidance / WORK_STYLE_GUIDANCE）。
 */
export function withProfileDefaults(values: AgentFormValues): AgentFormValues {
  const purpose = values.roleDescription.trim();
  const title = values.title.trim() || (purpose ? titleFromPurpose(purpose) : DEFAULT_BOT_TITLE);
  return { ...values, name: values.name.trim(), title, roleDescription: purpose || DEFAULT_PURPOSE };
}

/** 资料表单只校验这三格；职责、它做什么可以空（保存时补，见 withProfileDefaults）。 */
export const profileFormSchema = agentFormSchema
  .pick({ name: true, title: true, roleDescription: true })
  .extend({
    title: z.string().trim().max(120, "职责最多 120 个字。"),
    roleDescription: z.string().trim().max(1000, "「它做什么」最多 1000 个字。"),
  });

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
