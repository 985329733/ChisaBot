import type { Spec } from "@json-render/core";

/**
 * 面板里不再重复标题（2026-10-13，用户：「整个面板嵌套了 N 个外壳」）。
 *
 * 实时面板的卡片头已经写着标题（「香港天气 ⋯」），模型的规范却常常再套一个同名的 Card 或 Heading：
 * 卡片里第二次出现「香港天气」，还多一层边框。这里在渲染前把「和面板标题相同」的标题去掉：
 *  - 沿着根元素往下的第一条孩子链（最多 4 层）找 Card 的 title、或 Heading；
 *  - 与面板标题相同（忽略空白和标点，或一方包含另一方）就去掉：Card 只去 title（description 保留，
 *    作为一行淡色副标题），Heading 整个去掉；
 *  - 只去一次。其他标题不动。
 *
 * 纯函数，不改传入的规范。
 */

type Element = { type?: string; props?: Record<string, unknown>; children?: unknown[] };

const normalize = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");

export function sameTitle(a: unknown, b: unknown): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)));
}

export function dropDuplicateTitle<T extends Spec | null>(spec: T, title: string | null | undefined): T {
  if (!spec || !title || !spec.root) return spec;
  const elements = spec.elements as Record<string, Element>;
  let key: string | undefined = spec.root;
  for (let depth = 0; key && depth < 4; depth++) {
    const element: Element | undefined = elements[key];
    if (!element) break;
    if (element.type === "Card" && sameTitle(element.props?.title, title)) {
      return {
        ...spec,
        elements: { ...elements, [key]: { ...element, props: { ...element.props, title: null } } },
      } as T;
    }
    const kids: string[] = Array.isArray(element.children) ? element.children.filter((c): c is string => typeof c === "string") : [];
    const first = kids[0];
    if (first && elements[first]?.type === "Heading" && sameTitle(elements[first]?.props?.text, title)) {
      return {
        ...spec,
        elements: { ...elements, [key]: { ...element, children: kids.slice(1) } },
      } as T;
    }
    if (element.type === "Card" && element.props?.title) break; // 一张有别的标题的卡片：到此为止
    key = first;
  }
  return spec;
}
