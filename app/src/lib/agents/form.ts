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

/**
 * 新建机器人时职责、提示词可以不填（成熟度扫查 F1：新用户卡在「请填写角色说明」）。
 * 输入框保持空白、不放模板（§46）；只在提交时补一句最基本的说明，之后可在资料页改。
 */
export function withCreateDefaults(values: AgentFormValues): AgentFormValues {
  const name = values.name.trim();
  const title = values.title.trim();
  return {
    ...values,
    title: title || "私人助手",
    roleDescription:
      values.roleDescription.trim() ||
      `你是「${name}」${title ? `，负责：${title}` : ""}。默认用简体中文，回答清晰、简洁、准确；不确定的事先说明，需要时用工具查证。`,
  };
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
