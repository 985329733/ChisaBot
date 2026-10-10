import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { validatePanelCss } from "./css";
import { assertBoundedJson } from "./state-schema";
import { PanelError } from "./types";
export type SafeViewNode = {
  id: string;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  children: SafeViewNode[];
};
export type ViewPatch = {
  node: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: SafeViewNode[];
};
const tags = new Set(
  "main section article header footer nav aside div span p h1 h2 h3 h4 h5 h6 strong em b i small code pre br hr ul ol li dl dt dd table thead tbody tfoot tr th td caption colgroup col button form label input textarea select option optgroup fieldset legend progress meter details summary img svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop title desc"
    .split(" ")
    .map((t) => t.toLowerCase()),
);
const attrs = new Set(
  "id class title role aria-label aria-labelledby aria-describedby aria-hidden aria-live data-node data-action type name value placeholder min max step maxlength minlength rows cols checked selected disabled readonly multiple for colspan rowspan scope width height alt src viewbox d fill stroke stroke-width stroke-linecap stroke-linejoin cx cy r rx ry x y x1 x2 y1 y2 points preserveaspectratio offset stop-color stop-opacity opacity xmlns tabindex".split(
    " ",
  ),
);
const identity = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
export const VIEW_TAGS = [...tags];
export const VIEW_ATTRS = [...attrs, "style"];
export function validateViewAttrs(value: unknown): Record<string, string> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 40
  )
    throw new PanelError("invalid_view_attrs", 400);
  const result: Record<string, string> = {};
  for (const [rawKey, v] of Object.entries(value)) {
    const key = rawKey.toLowerCase();
    if (
      typeof v !== "string" ||
      v.length > 4096 ||
      (!attrs.has(key) && key !== "style")
    )
      throw new PanelError("unsafe_view_attr", 400);
    if (["id", "data-node", "data-action"].includes(key) && !identity.test(v))
      throw new PanelError("invalid_node_id", 400);
    if (
      key === "src" &&
      !/^data:image\/(?:png|jpeg|gif|webp);base64,[a-zA-Z0-9+/=]+$/.test(v)
    )
      throw new PanelError("external_image_refused", 400);
    if (
      key === "type" &&
      ![
        "button",
        "submit",
        "text",
        "number",
        "range",
        "checkbox",
        "radio",
        "date",
        "time",
        "color",
        "email",
        "search",
      ].includes(v)
    )
      throw new PanelError("unsafe_input_type", 400);
    if (key === "tabindex" && v !== "0" && v !== "-1")
      throw new PanelError("unsafe_tabindex", 400);
    if (/url\s*\(/i.test(v) && !["fill", "stroke"].includes(key))
      throw new PanelError("unsafe_view_attr", 400);
    if (
      ["fill", "stroke"].includes(key) &&
      /url\s*\(/i.test(v) &&
      !/^url\(#[A-Za-z][A-Za-z0-9_-]{0,79}\)$/.test(v)
    )
      throw new PanelError("external_svg_refused", 400);
    result[
      key === "viewbox"
        ? "viewBox"
        : key === "preserveaspectratio"
          ? "preserveAspectRatio"
          : key
    ] = key === "style" ? validatePanelCss(v, true) : v;
  }
  return result;
}
export function validateSafeTree(
  value: unknown,
): asserts value is SafeViewNode[] {
  assertBoundedJson(value);
  const seen = new Set<string>();
  let count = 0;
  const inline: string[] = [];
  function visit(nodes: unknown, depth: number) {
    if (!Array.isArray(nodes) || depth > 32)
      throw new PanelError("view_depth_limit", 400);
    for (const n of nodes) {
      if (
        !n ||
        typeof n !== "object" ||
        ++count > 2000 ||
        typeof n.id !== "string" ||
        typeof n.tag !== "string" ||
        !identity.test(n.id) ||
        seen.has(n.id) ||
        Object.keys(n).some(
          (key) => !["id", "tag", "attrs", "text", "children"].includes(key),
        )
      )
        throw new PanelError("invalid_view_tree", 400);
      seen.add(n.id);
      if (
        (n.tag !== "#text" && !tags.has(n.tag.toLowerCase())) ||
        (n.text !== undefined && typeof n.text !== "string")
      )
        throw new PanelError("unsafe_view_tag", 400);
      validateViewAttrs(n.attrs);
      if (n.attrs.style) inline.push(n.attrs.style);
      if (
        n.tag === "#text" &&
        (Object.keys(n.attrs).length || n.children?.length)
      )
        throw new PanelError("invalid_text_node", 400);
      visit(n.children, depth + 1);
    }
  }
  visit(value, 0);
  validatePanelCss(inline.map((style, i) => `.inline-${i}{${style}}`).join(""));
}
export function buildSafeView(html: string): SafeViewNode[] {
  let count = 0;
  function convert(
    node: DefaultTreeAdapterMap["childNode"],
    depth: number,
  ): SafeViewNode | null {
    if (depth > 32 || ++count > 2000) throw new PanelError("view_limit", 400);
    if (node.nodeName === "#comment") return null;
    if (node.nodeName === "#text")
      return {
        id: `text-${count}`,
        tag: "#text",
        attrs: {},
        text: (node as DefaultTreeAdapterMap["textNode"]).value,
        children: [],
      };
    const e = node as DefaultTreeAdapterMap["element"];
    if (!e.tagName || !tags.has(e.tagName.toLowerCase()))
      throw new PanelError("unsafe_view_tag", 400);
    const attrs = validateViewAttrs(
      Object.fromEntries(e.attrs.map((a) => [a.name, a.value])),
    );
    return {
      id: attrs["data-node"] ?? attrs.id ?? `node-${count}`,
      tag: e.tagName,
      attrs,
      children: e.childNodes
        .map((child) => convert(child, depth + 1))
        .filter((n): n is SafeViewNode => n !== null),
    };
  }
  const result = parseFragment(html)
    .childNodes.map((n) => convert(n, 0))
    .filter((n): n is SafeViewNode => n !== null);
  validateSafeTree(result);
  return result;
}
export function validateViewPatch(
  value: unknown,
): asserts value is ViewPatch[] {
  assertBoundedJson(value);
  if (!Array.isArray(value) || value.length > 2000)
    throw new PanelError("invalid_view_patch", 400);
  for (const p of value) {
    if (
      !p ||
      typeof p !== "object" ||
      Array.isArray(p) ||
      typeof p.node !== "string" ||
      !identity.test(p.node) ||
      Object.keys(p).some(
        (k) => !["node", "text", "attrs", "children"].includes(k),
      ) ||
      (p.text !== undefined && typeof p.text !== "string")
    )
      throw new PanelError("invalid_view_patch", 400);
    if (p.text !== undefined && p.children !== undefined)
      throw new PanelError("ambiguous_view_patch", 400);
    if (p.attrs !== undefined) validateViewAttrs(p.attrs);
    if (p.children !== undefined) validateSafeTree(p.children);
  }
}
export function applyViewPatch(
  tree: SafeViewNode[],
  patches: unknown,
): SafeViewNode[] {
  validateViewPatch(patches);
  const next = structuredClone(tree),
    nodes = new Map<string, SafeViewNode>();
  const collect = (items: SafeViewNode[]) => {
    for (const node of items) {
      nodes.set(node.id, node);
      collect(node.children);
    }
  };
  collect(next);
  for (const patch of patches) {
    const node = nodes.get(patch.node);
    if (!node) throw new PanelError("view_node_missing", 400);
    if (patch.text !== undefined) {
      node.text = patch.text;
      node.children = [];
    }
    if (patch.children !== undefined) {
      node.children = structuredClone(patch.children);
      delete node.text;
    }
    if (patch.attrs !== undefined)
      node.attrs = validateViewAttrs({ ...node.attrs, ...patch.attrs });
    nodes.clear();
    collect(next);
  }
  validateSafeTree(next);
  return next;
}
