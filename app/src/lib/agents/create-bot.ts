import { useSyncExternalStore } from "react";

/**
 * Whether the create-bot dialog is open, app-wide.
 *
 * One dialog, mounted once (AppHotkeys, in `_authed`), opened from every entry point: the ＋ in the
 * bot list header, the ＋ on the collapsed rail, Shift+N, and the landing page's last-resort empty
 * state. A tiny external store rather than context so a button anywhere can open it without the
 * host being its ancestor.
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openCreateBot(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeCreateBot(): void {
  if (!open) return;
  open = false;
  emit();
}

export function useCreateBotOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
    () => false,
  );
}
