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

/**
 * Ctrl K（DESIGN-v4）：搜索框在左栏卡片顶部。快捷键先让左栏展开、必要时先回到聊天，再把焦点交给输入框。
 * 输入框挂载时会读一次「待聚焦」标记，所以从设置 / 管理跳回聊天后也能接着打字。
 */
let focusPending = false;
const focusListeners = new Set<() => void>();

export function requestSidebarSearchFocus() {
  focusPending = true;
  for (const listener of focusListeners) listener();
}

export function takeSidebarSearchFocus(): boolean {
  const pending = focusPending;
  focusPending = false;
  return pending;
}

export function onSidebarSearchFocusRequest(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}
