/** A browser preference must not make a page unusable when storage is unavailable. */
export function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredPreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The current preference still applies in memory in private or full storage.
  }
}
