// Per-column decimal places (seq 333, Prism 11 "Change decimal format").
//
// Display-only: a column's setting says how many decimals the grid shows
// for its numbers; the stored values keep full precision, and the focused
// cell expands to them. Analyses, graphs, export and copy always use the
// full stored precision — only the rendered text is rounded, and only the
// decimal separator (period/comma, a per-Mac preference) changes what
// leaves the app as text.
//
// The setting lives on the column, keyed by column name like `widths`, so
// it follows a rename and goes with a deleted column, and survives a .hlx
// save/load round-trip (see project-file.ts DATA_KEYS).
import { parseCell } from "./numeric";
import type { TableData, TableType } from "../store/types";

/** The decimal separator: the character between the whole and fractional
 *  parts when a number is entered, pasted, displayed, copied or exported
 *  as text. Stored values always keep "." (canonical). */
export type DecimalSeparator = "." | ",";

/** Most decimals Prism lets a column show (the axis number format from
 *  seq 220 clamps to the same bound). */
export const MAX_DECIMAL_PLACES = 15;

/** `n` as a usable decimal-places count: an integer, 0–15. */
export function clampDecimalPlaces(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_DECIMAL_PLACES, Math.floor(n))) : 0;
}

/** The decimals a column shows, if it has a setting. */
export function decimalPlacesOf(data: TableData, columnName: string): number | undefined {
  return data.decimals?.[columnName];
}

/** Sets column `columnName`'s decimal places, or (undefined) clears it back
 *  to full precision. The record is dropped when it empties. */
export function setDecimalPlaces(data: TableData, columnName: string, places: number | undefined): TableData {
  const { [columnName]: _, ...decimals } = data.decimals ?? {};
  if (places !== undefined) decimals[columnName] = clampDecimalPlaces(places);
  return { ...data, decimals: Object.keys(decimals).length ? decimals : undefined };
}

/** Whether the table type offers a decimal-places control: Prism doesn't
 *  offer it on contingency tables or on a survival table's Y columns. */
export function decimalsSupported(type: TableType): boolean {
  return type !== "contingency" && type !== "survival";
}

/** A stored cell as the grid shows it: numeric cells round to `places`
 *  (when set) and take the separator; text, blanks and non-numbers pass
 *  through untouched, so a row title like "2024" is never reformatted by
 *  accident — the grid only calls this for columns with a setting, and
 *  never for column 0. */
export function formatDecimalCell(
  value: string | null,
  places: number | undefined,
  separator: DecimalSeparator,
): string {
  if (value == null) return "";
  const n = parseCell(value);
  if (n === null) return value;
  const shown = places === undefined ? value : n.toFixed(clampDecimalPlaces(places));
  return separator === "," ? shown.replace(".", ",") : shown;
}

/** What the grid shows for one cell: the full stored digits when the cell
 *  is focused, the rounded display otherwise. */
export function displayCellValue(
  value: string | null,
  places: number | undefined,
  separator: DecimalSeparator,
  focused: boolean,
): string {
  return focused ? (value ?? "") : formatDecimalCell(value, places, separator);
}

// A number written with a decimal comma ("1,5", "-2,75", "1,5e3"): the
// entry form of a number when the separator is a comma.
const COMMA_NUMBER = /^[+-]?(\d+,\d*|,\d+)([eE][+-]?\d+)?$/;

/** A typed or pasted cell as it is stored: with a comma separator, a
 *  decimal comma becomes the canonical point, so the value parses
 *  everywhere; anything else (text, a period separator) stores as typed. */
export function normalizeDecimalInput(value: string, separator: DecimalSeparator): string {
  return separator === "," && COMMA_NUMBER.test(value.trim()) ? value.trim().replace(",", ".") : value;
}

// ── The separator preference (per Mac, like the theme and print settings) ──

export const DECIMAL_SEPARATOR_KEY = "titer.decimal-separator";

/** The event the Preferences dialog dispatches after changing the
 *  separator, so the grid re-reads it at once. */
export const DECIMAL_SEPARATOR_CHANGED_EVENT = "titer:decimal-separator-changed";

/** The stored separator, or "." when nothing (or nothing usable) is
 *  stored. Never throws (no localStorage in tests, private mode, or a
 *  quota error all read as "."). */
export function loadDecimalSeparator(): DecimalSeparator {
  try {
    return localStorage.getItem(DECIMAL_SEPARATOR_KEY) === "," ? "," : ".";
  } catch {
    return ".";
  }
}

/** Persist the separator and tell the grid to re-read it. */
export function saveDecimalSeparator(separator: DecimalSeparator): void {
  try {
    localStorage.setItem(DECIMAL_SEPARATOR_KEY, separator);
  } catch {
    // Not kept: the next launch uses the period.
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DECIMAL_SEPARATOR_CHANGED_EVENT));
}
