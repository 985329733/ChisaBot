import { useSyncExternalStore } from "react";
import { formatHotkey, type HotkeyCombo } from "@/lib/hotkeys/hotkeys";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/preference-storage";

/**
 * Whether the right-hand 自定义面板 column is open, per device.
 *
 * The toggle lives in the top bar and the column lives beside the chat, so the state is a tiny
 * module store both read, persisted in the same `expanded` / `collapsed` vocabulary as the left
 * roster (`lib/sidebar.ts`). Only an exact `collapsed` starts it closed.
 */
export const PANEL_RAIL_STORAGE_KEY = "chisabot-panel-rail";

/** Ctrl+Alt+B (⌘⌥B on a Mac) — Ctrl+B is the left roster's, so the pair reads as one family. */
export const PANEL_RAIL_HOTKEY: HotkeyCombo = { key: "b", mod: true, alt: true };
export const PANEL_RAIL_HOTKEY_LABEL = formatHotkey(PANEL_RAIL_HOTKEY).join("+");

let open = readStoredPreference(PANEL_RAIL_STORAGE_KEY) !== "collapsed";
const listeners = new Set<() => void>();

export function setPanelRailOpen(next: boolean) {
  if (next === open) return;
  open = next;
  writeStoredPreference(PANEL_RAIL_STORAGE_KEY, next ? "expanded" : "collapsed");
  for (const listener of listeners) listener();
}

export function togglePanelRail() {
  setPanelRailOpen(!open);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePanelRailOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => true,
  );
}

/**
 * 窄窗口（< 1280px）里面板栏放不下，改成从右边滑出的抽屉。它的开合只在本次会话里记，不持久化：
 * 窄窗口每次打开都先看聊天，要看面板时点右边缘的「面板」把手或机器人「⋯ → 自定义面板」。
 */
export const PANEL_RAIL_WIDE_QUERY = "(min-width: 1280px)";
let sheetOpen = false;
const sheetListeners = new Set<() => void>();

export function setPanelSheetOpen(next: boolean) {
  if (next === sheetOpen) return;
  sheetOpen = next;
  for (const listener of sheetListeners) listener();
}

export function usePanelSheetOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      sheetListeners.add(listener);
      return () => sheetListeners.delete(listener);
    },
    () => sheetOpen,
    () => false,
  );
}

/** 宽窗口展开右侧面板栏，窄窗口打开面板抽屉。机器人「⋯ → 自定义面板」用它。 */
export function showPanels() {
  if (typeof window !== "undefined" && window.matchMedia(PANEL_RAIL_WIDE_QUERY).matches) {
    setPanelRailOpen(true);
  } else {
    setPanelSheetOpen(true);
  }
}

/** 当前窗口是否放得下右侧面板栏（≥1280px）。 */
export function useWideForRail(): boolean {
  return useSyncExternalStore(
    (listener) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(PANEL_RAIL_WIDE_QUERY);
      mql.addEventListener("change", listener);
      return () => mql.removeEventListener("change", listener);
    },
    () => (typeof window === "undefined" ? true : window.matchMedia(PANEL_RAIL_WIDE_QUERY).matches),
    () => true,
  );
}
