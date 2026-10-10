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
