import { validatePanelCss } from "./css";
import {
  assertBoundedJson,
  stateMatches,
  validateStateSchema,
} from "./state-schema";
import { PanelError, type PanelDefinition } from "./types";
import { buildSafeView } from "./view-tree";
export function validatePanelDefinition(value: unknown): PanelDefinition {
  assertBoundedJson(value, 512 * 1024);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PanelError("invalid_definition", 400);
  const def = value as unknown as PanelDefinition;
  const keys = (v: object, allowed: string[]) =>
    Object.keys(v).some((k) => !allowed.includes(k));
  if (
    keys(def, [
      "name",
      "html",
      "css",
      "script",
      "manifest",
      "stateSchema",
      "schemaVersion",
      "initialState",
      "size",
    ])
  )
    throw new PanelError("invalid_definition", 400);
  if (
    typeof def.name !== "string" ||
    !def.name.trim() ||
    def.name.length > 80 ||
    typeof def.html !== "string" ||
    typeof def.css !== "string" ||
    typeof def.script !== "string" ||
    !Number.isInteger(def.schemaVersion) ||
    def.schemaVersion < 1
  )
    throw new PanelError("invalid_definition", 400);
  if (
    !def.size ||
    !Number.isFinite(def.size.width) ||
    def.size.width < 280 ||
    def.size.width > 600 ||
    (def.size.height !== "auto" &&
      (!Number.isFinite(def.size.height) ||
        def.size.height < 160 ||
        def.size.height > 960))
  )
    throw new PanelError("invalid_size", 400);
  if (
    !def.manifest ||
    !Array.isArray(def.manifest.data) ||
    !Array.isArray(def.manifest.tasks) ||
    def.manifest.data.length + def.manifest.tasks.length > 32
  )
    throw new PanelError("invalid_manifest", 400);
  const seen = new Set<string>();
  if (
    keys(def.size, ["width", "height"]) ||
    keys(def.manifest, ["data", "tasks"])
  )
    throw new PanelError("invalid_definition", 400);
  for (const cap of [...def.manifest.data, ...def.manifest.tasks]) {
    if (
      !cap ||
      typeof cap !== "object" ||
      keys(cap, [
        "id",
        "adapter",
        "action",
        "inputSchema",
        "outputSchema",
        "scope",
        "effect",
      ]) ||
      !cap.scope ||
      typeof cap.scope !== "object" ||
      Array.isArray(cap.scope)
    )
      throw new PanelError("invalid_capability", 400);
    if (
      !cap ||
      !/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(cap.id) ||
      seen.has(cap.id) ||
      typeof cap.adapter !== "string" ||
      typeof cap.action !== "string" ||
      cap.adapter.length > 80 ||
      cap.action.length > 80 ||
      !["read", "write"].includes(cap.effect)
    )
      throw new PanelError("invalid_capability", 400);
    seen.add(cap.id);
    validateStateSchema(cap.inputSchema);
    validateStateSchema(cap.outputSchema);
  }
  if (def.manifest.data.some((cap) => cap.effect !== "read"))
    throw new PanelError("invalid_data_effect", 400);
  validateStateSchema(def.stateSchema);
  assertBoundedJson(def.initialState);
  if (!stateMatches(def.stateSchema, def.initialState))
    throw new PanelError("invalid_initial_state", 400);
  const tree = buildSafeView(def.html);
  const css = validatePanelCss(def.css);
  const inline: string[] = [];
  const visit = (nodes: typeof tree) => {
    for (const node of nodes) {
      if (node.attrs.style) inline.push(node.attrs.style);
      visit(node.children);
    }
  };
  visit(tree);
  validatePanelCss(
    css + inline.map((style, i) => `.inline-${i}{${style}}`).join(""),
  );
  return structuredClone(def);
}
