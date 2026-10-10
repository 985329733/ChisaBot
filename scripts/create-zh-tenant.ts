import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import YAML from "yaml";

const root = resolve(import.meta.dir, "..");
const target = resolve(root, "examples/zh-CN");
await mkdir(target, { recursive: true });
const language =
  "\n默认使用简体中文与用户交流；用户明确要求其他语言时按其要求回复。保留代码、命令、API 标识符和专有名称。";
const agents: Record<string, [string, string, string]> = {
  "general-assistant": [
    "通用助手",
    "日常工作",
    "协助处理日常工作，回答清晰、简洁且准确。",
  ],
  knowledge: [
    "知识助手",
    "知识检索",
    "从获准访问的资料中查找答案，引用来源，并明确说明证据不足或连接失败。",
  ],
  "risk-analyst": [
    "风险分析师",
    "风险与合规",
    "分析政策、交易监控和合规证据。",
  ],
};
const skills: Record<string, [string, string]> = {
  "research-public-web": [
    "公开信息研究",
    "使用 Parallel 检索公开资料，整理带来源引用的简报。",
  ],
  "find-a-document": ["查找文档", "在已连接的文档来源中查找文件并读取内容。"],
  "find-a-notion-page": ["查找 Notion 页面", "检索 Notion 页面并读取其内容。"],
  "whats-changed": ["查看近期变更", "列出最近修改的文档、修改人和修改时间。"],
  "who-owns-this": ["查找负责人", "确认文档所有者和最近修改时间。"],
  "check-a-claim": ["核实说法", "对照原始资料，判断某项说法是否有依据。"],
  "skill-creator": [
    "创建技能",
    "了解你的需求，编写技能，并保存为新的斜杠命令。",
  ],
  "bot-creator": [
    "创建 AI 同事",
    "明确新同事的职责、限制和技能，再由你确认创建。",
  ],
};
for (const filename of [
  "brand.yaml",
  "model.yaml",
  "agents.yaml",
  "skills.yaml",
  "channels.yaml",
  "knowledge.yaml",
]) {
  const value = YAML.parse(
    await readFile(resolve(root, "examples/fintech", filename), "utf8"),
  );
  if (value.tenant) value.tenant.product_name = "ChisaBot";
  if (value.model) value.model.default_model = "grok-4.7";
  if (value.agents) {
    for (const agent of value.agents) {
      const labels = agents[agent.id];
      if (labels) [agent.name, agent.title, agent.role_description] = labels;
      if (agent.system_prompt) agent.system_prompt += language;
    }
  }
  if (value.skills) {
    for (const skill of value.skills) {
      const labels = skills[skill.slug];
      if (labels) [skill.title, skill.summary] = labels;
      skill.instructions += language;
    }
  }
  if (value.channels) {
    const labels: Record<string, [string, string]> = {
      "general-assistant": ["通用助手", "协助处理日常工作。"],
      "risk-and-compliance": ["风险与合规", "分析政策、交易监控和合规证据。"],
      "company-knowledge": ["知识检索", "从已授权的文档中查找有依据的答案。"],
    };
    for (const channel of value.channels) {
      if (labels[channel.id])
        [channel.name, channel.description] = labels[channel.id];
    }
  }
  await writeFile(resolve(target, filename), YAML.stringify(value));
}
console.log("Chinese tenant package generated.");
