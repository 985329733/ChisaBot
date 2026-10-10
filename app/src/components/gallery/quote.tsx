import { z } from "zod";
import type { GalleryComponent } from "@/lib/copilot/gallery-registry";
import { GalleryFrame } from "./frame";

export const QuoteCardProps = z.object({
  quote: z
    .string()
    .describe("The quotation itself, without surrounding quote marks"),
  attribution: z
    .string()
    .describe(
      "Who said or wrote it, e.g. 'Grace Hopper' or 'the 2026 annual report'",
    ),
  context: z
    .string()
    .optional()
    .describe(
      "One short line of context: where it is from, or why it matters here",
    ),
});

type QuoteArgs = z.infer<typeof QuoteCardProps>;

export function QuoteCard({ quote, attribution, context }: Partial<QuoteArgs>) {
  if (!quote) {
    return (
      <GalleryFrame title={"引用"}>
        <p className="text-sm text-muted-foreground">{"没有可引用的内容。"}</p>
      </GalleryFrame>
    );
  }

  return (
    <GalleryFrame caption={context} title={"引用"}>
      <blockquote className="border-l-2 border-border pl-4">
        <p className="text-sm leading-relaxed">{quote}</p>
        {attribution ? (
          <footer className="mt-2 text-xs text-muted-foreground">
            , {attribution}
          </footer>
        ) : null}
      </blockquote>
    </GalleryFrame>
  );
}

export const GALLERY: GalleryComponent[] = [
  {
    name: "showQuote",
    title: "引用",
    kind: "card",
    description:
      "显示带归属的引用。当需要精确措辞时使用，如某人所说或文档中的句子。",
    parameters: QuoteCardProps,
    Component: QuoteCard as GalleryComponent["Component"],
    preview: {
      quote:
        "Meals under $75 need no receipt. Anything above needs one, and anything above $500 needs your manager before you spend it.",
      attribution: "the expense policy",
      context: "Last changed in March.",
    },
    confirmation: "The quotation is now on screen for the person.",
  },
];
