// Category autocomplete (Prism 11, seq 331 half B): while typing a value
// into a categorical column, Titer suggests the column's existing levels
// that start with what was typed, so "Ma" offers "Male" instead of making
// a second level by typo. The suggestion list is a per-Mac preference in
// the Preferences dialog's Data Entry section, on by default.

/** The localStorage key holding the preference ("0" = off, anything else on). */
export const CATEGORY_AUTOCOMPLETE_KEY = "titer.category-autocomplete";

/** The event the Preferences dialog dispatches after changing the
 *  preference, so the grid re-reads it at once. */
export const CATEGORY_AUTOCOMPLETE_CHANGED_EVENT = "titer:category-autocomplete-changed";

/** Whether category autocomplete is on — true when nothing (or nothing
 *  usable) is stored. Never throws (no localStorage in tests, private
 *  mode, or a quota error all read as on). */
export function loadCategoryAutocomplete(): boolean {
  try {
    return localStorage.getItem(CATEGORY_AUTOCOMPLETE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Persist the preference and tell the grid to re-read it. */
export function saveCategoryAutocomplete(on: boolean): void {
  try {
    localStorage.setItem(CATEGORY_AUTOCOMPLETE_KEY, on ? "1" : "0");
  } catch {
    // Not kept: the next launch uses autocomplete on.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CATEGORY_AUTOCOMPLETE_CHANGED_EVENT));
}
