import { IconRefresh } from "@tabler/icons-react";
import type { ComponentProps } from "react";

import { type Feedback, useAsyncAction } from "@/components/ui/async-action";
import { Button } from "@/components/ui/button";

/**
 * A refresh/reload control on the shared state machine: 刷新 → 刷新中… → ✓ 已刷新. `onRefresh`
 * should reject when the reload failed (a TanStack `refetch()` resolves either way, so pass
 * `throwOnError` or check `isError`), which lands the button on ✕ with a toast.
 */
export function RefreshButton({
  onRefresh,
  children = "刷新",
  feedback = "refresh",
  icon = true,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "state" | "feedback"> & {
  onRefresh: () => Promise<unknown>;
  feedback?: Feedback;
  icon?: boolean;
}) {
  const action = useAsyncAction(onRefresh, { errorToast: (error) => `刷新失败：${error.message}` });
  return (
    <Button
      feedback={feedback}
      onClick={() => void action.run()}
      state={action.state}
      type="button"
      {...props}
    >
      {icon ? <IconRefresh /> : null}
      {children}
    </Button>
  );
}
