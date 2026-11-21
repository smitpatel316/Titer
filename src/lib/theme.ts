// The appearance setting (seq 225): one home for the theme key, so the
// Preferences dialog and the View ▸ Appearance menu read and write the
// same value. Never throws (no localStorage in tests, private mode, or a
// quota error all read as "system").
import { setTheme, type Theme } from "../native";

export type { Theme } from "../native";

export const THEME_KEY = "titer.theme";

/** The event the Preferences dialog dispatches after changing the theme, so
 *  the menu (which owns the checked state) re-reads it at once. */
export const THEME_CHANGED_EVENT = "titer:theme-changed";

export function loadTheme(): Theme {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "light" || theme === "dark" ? theme : "system";
  } catch {
    return "system";
  }
}

/** Persist the theme, apply it to this window, and tell the menu to re-read. */
export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not kept: the next launch follows the system.
  }
  setTheme(theme);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(THEME_CHANGED_EVENT));
}
