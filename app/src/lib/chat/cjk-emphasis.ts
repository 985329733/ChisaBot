/**
 * 中文里的 **加粗** 显示成星号的修正（DESIGN.md §101）。
 *
 * CommonMark 的规则：收尾的 `**` 前面是标点（「：」「。」「”」…）时，后面必须是空白或标点才算收尾。
 * 中文不打空格，所以模型最常写的「**标题：**OpenAI…」「**结论。**下一步…」整段显示成带星号的原文
 * （2026-10-18 生产截图）。开头同理：「写的是**“…”**」。
 *
 * 这里在交给 Markdown 之前，把挨着星号、会让它失效的那串标点挪到星号外面（「**标题**：OpenAI」），
 * 意思不变、加粗生效。代码块和行内代码不动。
 */
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /\s/u;

function fixEmphasisInText(text: string): string {
  return text.replace(/\*\*(?![\s*])([^*\n]*?[^\s*])\*\*/gu, (whole, inner: string, offset: number, all: string) => {
    const before = offset > 0 ? all[offset - 1] : "";
    const after = all[offset + whole.length] ?? "";
    let lead = "";
    let body = inner;
    let tail = "";
    // 结尾标点：后面紧跟文字（不是空白、不是标点）时挪到外面
    if (after && !SPACE.test(after) && !PUNCT.test(after) && after !== "*") {
      const m = /[\p{P}\p{S}]+$/u.exec(body);
      if (m && m[0].length < body.length) {
        tail = m[0];
        body = body.slice(0, -tail.length);
      }
    }
    // 开头标点：前面紧跟文字时挪到外面
    if (before && !SPACE.test(before) && !PUNCT.test(before) && before !== "*") {
      const m = /^[\p{P}\p{S}]+/u.exec(body);
      if (m && m[0].length < body.length) {
        lead = m[0];
        body = body.slice(lead.length);
      }
    }
    if (!lead && !tail) return whole;
    return `${lead}**${body}**${tail}`;
  });
}

/** 只改正文：``` 代码块、行内 `代码` 原样保留。 */
export function cjkFriendlyEmphasis(markdown: string): string {
  if (!markdown.includes("**")) return markdown;
  const parts = markdown.split(/(```[\s\S]*?(?:```|$))/);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .split(/(`[^`\n]*`)/)
        .map((piece, i) => (i % 2 === 1 ? piece : fixEmphasisInText(piece)))
        .join("");
    })
    .join("");
}
