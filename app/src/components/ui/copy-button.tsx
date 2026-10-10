import type { ComponentProps } from "react";

import { useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";

export async function writeClipboard(text: string) {
  if (!navigator.clipboard) throw new Error("浏览器不允许访问剪贴板");
  await navigator.clipboard.writeText(text);
}

/**
 * Copy with the shared button state machine: 复制 → ✓ 已复制 (green, ~1.5s) → 复制, or ✕ 复制失败
 * plus a toast. `value` may be a function so the text is read at click time.
 */
export function CopyButton({
  value,
  children = "复制",
  onCopied,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "state" | "feedback" | "value"> & {
  value: string | (() => string);
  onCopied?: () => void;
}) {
  const copy = useAsyncAction(
    async () => {
      await writeClipboard(typeof value === "function" ? value() : value);
      onCopied?.();
    },
    { errorToast: "复制失败，请手动选择文本复制。" },
  );
  return (
    <Button
      feedback="copy"
      onClick={() => void copy.run()}
      state={copy.state}
      type="button"
      {...props}
    >
      {children}
    </Button>
  );
}
