/**
 * 内置预设：server/src/workflows/presets/*.md，就是普通的 WORKFLOW.md。启动时读一次并校验，
 * 坏文件直接让启动失败（测试会先抓到），不会带着半个预设上线。
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorkflowDefinition } from "../../../shared/workflows";
import { parseWorkflowMarkdown } from "./format";

export type Preset = { id: string; definition: WorkflowDefinition; markdown: string };

export const PRESET_PREFIX = "preset:";
/** 列表里的顺序。 */
const ORDER = ["research-report", "code-review", "daily-brief", "web-to-panel"];

let cache: Preset[] | null = null;

export function loadPresets(dir = fileURLToPath(new URL("./presets/", import.meta.url))): Preset[] {
  if (cache) return cache;
  const files = readdirSync(dir).filter((name) => name.endsWith(".md"));
  const presets = files.map((file) => {
    const markdown = readFileSync(`${dir}/${file}`, "utf8");
    const definition = parseWorkflowMarkdown(markdown);
    return { id: `${PRESET_PREFIX}${definition.slug}`, definition, markdown };
  });
  presets.sort((a, b) => {
    const ia = ORDER.indexOf(a.definition.slug);
    const ib = ORDER.indexOf(b.definition.slug);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.definition.slug.localeCompare(b.definition.slug);
  });
  cache = presets;
  return presets;
}

export function presetById(id: string): Preset | undefined {
  return loadPresets().find((preset) => preset.id === id);
}
