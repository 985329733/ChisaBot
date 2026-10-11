import { useEffect } from "react";

/**
 * 「现在不适合刷新页面」的登记处（docs/online-update.md）。
 *
 * 刷新提示从不自动刷新；用户点了「刷新」时，如果机器人还在回复或输入框里有没发出去的字，先确认一次。
 * 正在回复由聊天自己登记（channel-chat.tsx 的 `useReportBusy`）；未发送的文字直接看页面上的输入框。
 */
const busy = new Set<string>();

export function setBusy(key: string, value: boolean) {
  if (value) busy.add(key);
  else busy.delete(key);
}

/** 组件挂着且 `value` 为真时登记为忙；卸载时自动撤销。 */
export function useReportBusy(key: string, value: boolean) {
  useEffect(() => {
    setBusy(key, value);
    return () => setBusy(key, false);
  }, [key, value]);
}

function hasUnsentText(root: ParentNode = document) {
  for (const element of root.querySelectorAll<HTMLElement>(
    'textarea, [contenteditable="true"], input[type="text"]:not([role="combobox"]):not([type="search"])',
  )) {
    if (element.closest("[data-update-banner]")) continue;
    const text =
      element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
        ? element.value
        : element.textContent ?? "";
    if (text.trim()) return true;
  }
  return false;
}

/** 刷新会打断什么：null = 可以直接刷新。 */
export function refreshWouldInterrupt(): "running" | "typing" | null {
  if (busy.size) return "running";
  if (typeof document !== "undefined" && hasUnsentText()) return "typing";
  return null;
}
