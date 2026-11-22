// Autosave (Plane seq 281, 1.7.3): the on/off setting and the fixed debounce.
// The setting is the toggle only — the 10 s debounce is fixed, not
// user-adjustable. Lane B's Settings UI reads/writes this module; the
// engine in src/store/use-document.ts calls it. The localStorage access
// mirrors src/lib/prism-nudge.ts: never throws.

export const AUTOSAVE_DEBOUNCE_MS = 10000;

const AUTOSAVE_KEY = "titer.autosave";

/** Whether autosave is on. Default true when the key is absent; any stored
 *  "false" disables it. Never throws (no localStorage in tests, private
 *  mode, or a quota error all read as "on"). */
export function isAutosaveEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(AUTOSAVE_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the toggle. Never throws — a setting that can't be stored
 *  doesn't stick, and autosave simply keeps its default next launch. */
export function setAutosaveEnabled(enabled: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(AUTOSAVE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore: see above.
  }
}
