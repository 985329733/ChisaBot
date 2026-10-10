import { useEffect, useSyncExternalStore } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/preference-storage";
import {
  applySky,
  computeSky,
  currentMinuteOfDay,
  SKY_STORAGE_KEY,
} from "@/lib/sky";

/*
 * 「背景随时间变化」 state. `enabled` is a browser preference (like the theme, read by the boot script
 * in index.html before paint); `preview` is the settings slider's temporary hour and is never saved.
 */
type SkyState = { enabled: boolean; preview: number | null };

let state: SkyState = {
  enabled: readStoredPreference(SKY_STORAGE_KEY) !== "off",
  preview: null,
};
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setSkyEnabled(enabled: boolean) {
  writeStoredPreference(SKY_STORAGE_KEY, enabled ? "on" : "off");
  state = { ...state, enabled };
  emit();
}

/** A minute of day to show instead of the clock, or null to follow the clock again. */
export function setSkyPreview(preview: number | null) {
  state = { ...state, preview };
  emit();
}

export function useSkyState(): SkyState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Keeps the sky custom properties in step with the clock, the theme and the preference. */
export function SkyBackground() {
  const { dark } = useTheme();
  const { enabled, preview } = useSkyState();

  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      applySky(null);
      root.removeAttribute("data-sky");
      return;
    }
    root.setAttribute("data-sky", "time");
    const paint = () =>
      applySky(computeSky(preview ?? currentMinuteOfDay(), dark));
    paint();
    if (preview !== null) return;

    // Once a minute, aligned to the minute boundary; catch up at once when the tab comes back.
    let timer: number | undefined;
    const schedule = () => {
      const now = new Date();
      timer = window.setTimeout(
        () => {
          paint();
          schedule();
        },
        60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50,
      );
    };
    schedule();
    const onVisible = () => {
      if (document.visibilityState === "visible") paint();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, preview, dark]);

  return null;
}
