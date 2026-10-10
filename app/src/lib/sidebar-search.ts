import { useSyncExternalStore } from "react";

/**
 * The conversation filter typed in the top bar, read by the roster in the left column. One value
 * for the whole app, so the box and the list cannot disagree about what is being searched.
 */
let value = "";
const listeners = new Set<() => void>();

export function setSidebarSearch(next: string) {
  if (next === value) return;
  value = next;
  for (const listener of listeners) listener();
}

export function useSidebarSearch(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => value,
    () => value,
  );
}
