import { generate, parse, walk } from "css-tree";
import { PanelError } from "./types";

export function validatePanelCss(css: string, inline = false): string {
  if (
    typeof css !== "string" ||
    new TextEncoder().encode(css).length > (inline ? 2048 : 64 * 1024)
  )
    throw new PanelError("css_limit", 400);
  try {
    const ast = parse(css, {
      context: inline ? "declarationList" : "stylesheet",
      parseCustomProperty: true,
    });
    let rules = 0,
      declarations = 0;
    walk(ast, (node) => {
      if (node.type === "Atrule" || node.type === "Url" || node.type === "Raw")
        throw new PanelError("unsafe_css", 400);
      if (node.type === "Rule" && ++rules > 500)
        throw new PanelError("css_rule_limit", 400);
      if (
        node.type === "Selector" &&
        (generate(node).length > 256 || node.children.size > 32)
      )
        throw new PanelError("css_selector_limit", 400);
      if (
        node.type === "PseudoClassSelector" &&
        ![
          "hover",
          "focus",
          "focus-visible",
          "focus-within",
          "disabled",
          "checked",
          "first-child",
          "last-child",
          "root",
        ].includes(node.name.toLowerCase())
      )
        throw new PanelError("unsafe_css_selector", 400);
      if (node.type === "Declaration") {
        const property = node.property.toLowerCase();
        if (
          ++declarations > (inline ? 30 : 5000) ||
          /animation|behavior|binding|filter/.test(property) ||
          generate(node.value).length > 512
        )
          throw new PanelError("unsafe_css", 400);
      }
      if (
        node.type === "Function" &&
        /^(?:url|image-set|-webkit-image-set|cross-fade|element|paint|expression)$/i.test(
          node.name,
        )
      )
        throw new PanelError("unsafe_css", 400);
    });
    return generate(ast);
  } catch (e) {
    if (e instanceof PanelError) throw e;
    throw new PanelError("invalid_css", 400);
  }
}
