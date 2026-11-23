// Multiple Variables column types (Prism 11, seq 331): every MV column has
// a type — Categorical (text or coded levels), Continuous (numbers) or Label
// (IDs/names/notes, never used in analyses). Auto-detect runs on entry and
// on import (gray in Prism); a manual override sticks (orange) and
// auto-detect never overwrites it. Levels group case-insensitively, so
// "Male" and "male" are one level; renaming a level rewrites every row
// holding it, and renaming onto another level merges the two.
import type { TableData, VariableType, VariableTypeInfo } from "../store/types";
import { VARIABLE_TYPES } from "../store/types";

export type { VariableType, VariableTypeInfo };

/** Whether `value` is one of the three variable types. */
export const isVariableType = (value: unknown): value is VariableType =>
  typeof value === "string" && (VARIABLE_TYPES as readonly string[]).includes(value);

// A number as typed: integers, decimals, exponents, and Prism's decimal
// comma ("1,23"). Anything else is text.
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA_DECIMAL = /^[+-]?\d+,\d+$/;
const isNumericCell = (value: string) => {
  const v = value.trim();
  return NUMERIC.test(v) || COMMA_DECIMAL.test(v);
};

/** The values of column `c` (full-grid index, 0 = row titles). */
const columnValues = (data: TableData, c: number): (string | null)[] => data.rows.map((row) => row[c] ?? null);

/** Prism's auto-detect (mv_variable_types.htm): all numbers → Continuous;
 *  text with more than 10 distinct values → Label (an ID column); other
 *  text → Categorical. An empty column reads Continuous — numbers are what
 *  a fresh MV column is for. */
export function detectVariableType(values: (string | null)[]): VariableType {
  const present = values.filter((v): v is string => v !== null && v.trim() !== "");
  if (present.length === 0) return "continuous";
  if (present.every(isNumericCell)) return "continuous";
  const unique = new Set(present.map((v) => v.trim().toLowerCase()));
  return unique.size > 10 ? "label" : "categorical";
}

/** The resolved type of every data column: its stored entry when it has one,
 *  else what its values detect as (auto). Never mutates `data`. */
export function variableTypesOf(data: TableData): Record<string, VariableTypeInfo> {
  const out: Record<string, VariableTypeInfo> = {};
  data.columns.slice(1).forEach((name, i) => {
    out[name] = data.variableTypes?.[name] ?? {
      type: detectVariableType(columnValues(data, i + 1)),
      manual: false,
    };
  });
  return out;
}

/** Re-detects every auto (or missing) entry from the column's current
 *  values, drops entries for columns that are gone, and keeps manual
 *  entries untouched. Returns `data` unchanged when nothing moves, so the
 *  store funnel can call it on every edit without minting undo steps. */
export function refreshVariableTypes(data: TableData): TableData {
  const columns = data.columns.slice(1);
  if (columns.length === 0) return data;
  const next: Record<string, VariableTypeInfo> = {};
  let changed = false;
  for (const [i, name] of columns.entries()) {
    const stored = data.variableTypes?.[name];
    if (stored?.manual) {
      next[name] = stored;
      continue;
    }
    const type = detectVariableType(columnValues(data, i + 1));
    next[name] = { type, manual: false };
    if (!stored || stored.type !== type) changed = true;
  }
  const oldKeys = Object.keys(data.variableTypes ?? {});
  if (oldKeys.length !== columns.length || oldKeys.some((k) => !columns.includes(k))) changed = true;
  return changed ? { ...data, variableTypes: next } : data;
}

/** Sets column `name`'s type by hand (manual): auto-detect leaves it alone
 *  afterwards. Returns `data` unchanged when the column doesn't exist or
 *  the manual type already holds. */
export function setVariableType(data: TableData, name: string, type: VariableType): TableData {
  if (!data.columns.slice(1).includes(name)) return data;
  const current = data.variableTypes?.[name];
  if (current?.type === type && current.manual) return data;
  return { ...data, variableTypes: { ...data.variableTypes, [name]: { type, manual: true } } };
}

/** Turns auto-detect on or off for column `name`. On: the type is
 *  re-detected from its values at once (and re-detected on every later
 *  edit). Off: the current type becomes the manual one. Returns `data`
 *  unchanged when the column doesn't exist or the state already holds. */
export function setVariableTypeAuto(data: TableData, name: string, auto: boolean): TableData {
  const c = data.columns.indexOf(name);
  if (c < 1) return data;
  if (auto) {
    const type = detectVariableType(columnValues(data, c));
    const current = data.variableTypes?.[name];
    if (current && !current.manual && current.type === type) return data;
    return { ...data, variableTypes: { ...data.variableTypes, [name]: { type, manual: false } } };
  }
  const current = variableTypesOf(data)[name];
  if (current.manual) return data;
  return { ...data, variableTypes: { ...data.variableTypes, [name]: { type: current.type, manual: true } } };
}

/** One level of a categorical column: its display name (first-seen spelling),
 *  its included rows and its excluded rows. Levels group case-insensitively,
 *  so "Male" and "male" are one level; blank cells are no level. Sorted by
 *  size, then name. */
export interface VariableLevel {
  name: string;
  count: number;
  excluded: number;
}
export function categoricalLevels(data: TableData, name: string): VariableLevel[] {
  const c = data.columns.indexOf(name);
  if (c < 1) return [];
  const excluded = new Set(data.excluded ?? []);
  const byKey = new Map<string, VariableLevel>();
  data.rows.forEach((row, r) => {
    const cell = row[c];
    if (cell === null || cell.trim() === "") return;
    const key = cell.trim().toLowerCase();
    const level = byKey.get(key) ?? { name: cell.trim(), count: 0, excluded: 0 };
    if (excluded.has(`${r},${c}`)) level.excluded += 1;
    else level.count += 1;
    byKey.set(key, level);
  });
  return [...byKey.values()].sort(
    (a, b) => b.count + b.excluded - (a.count + a.excluded) || a.name.localeCompare(b.name),
  );
}

/** Renames one level of column `name`: every row holding it (any case) takes
 *  the new name. Renaming onto another level merges the two — that is how a
 *  typo ("Mael") is folded into its level ("Male"). Exclusions stay: they
 *  are positions, and no row moves. Returns `data` unchanged when the
 *  column or the level doesn't exist, or the new name is blank or the same
 *  level in another case. */
export function renameLevel(data: TableData, name: string, oldLevel: string, newLevel: string): TableData {
  const c = data.columns.indexOf(name);
  const clean = newLevel.trim();
  if (c < 1 || !clean || clean.toLowerCase() === oldLevel.trim().toLowerCase()) return data;
  let changed = false;
  const rows = data.rows.map((row) => {
    const cell = row[c];
    if (cell !== null && cell.trim().toLowerCase() === oldLevel.trim().toLowerCase()) {
      changed = true;
      const next = [...row];
      next[c] = clean;
      return next;
    }
    return row;
  });
  return changed ? { ...data, rows } : data;
}

/** The table's chosen row-label source: the stored `labelVariable` when it
 *  names a data column whose resolved type is Label — a column set to
 *  another type afterwards stops being the source until it is a label
 *  again, so a stale choice never labels points with analysis values. A
 *  table nobody typed yet has no source at all. */
export function labelVariableOf(data: TableData): string | undefined {
  if (data.variableTypes === undefined) return undefined;
  const name = data.labelVariable;
  if (name === undefined) return undefined;
  return variableTypesOf(data)[name]?.type === "label" ? name : undefined;
}

/** The values a graph shows beside its points: the chosen label variable's
 *  cells, row by row, or the row titles when none is chosen. A blank label
 *  cell reads as a blank title, so pointLabels falls back to "Row N". */
export function rowLabelsOf(data: TableData): (string | null)[] {
  const name = labelVariableOf(data);
  if (name === undefined) return data.rows.map((row) => row[0] ?? null);
  const c = data.columns.indexOf(name);
  return data.rows.map((row) => row[c] ?? null);
}

/** Chooses (or clears, with `undefined`) the table's row-label source.
 *  Setting one only sticks when it names a label-typed column; anything
 *  else — a categorical or continuous column, an unknown name — is a no-op,
 *  so a label variable is the only thing that can label a graph's points. */
export function setLabelVariable(data: TableData, name: string | undefined): TableData {
  if (name === undefined) {
    return data.labelVariable === undefined ? data : { ...data, labelVariable: undefined };
  }
  if (data.variableTypes === undefined) return data;
  if (variableTypesOf(data)[name]?.type !== "label") return data;
  return data.labelVariable === name ? data : { ...data, labelVariable: name };
}

/** The levels of categorical column `name` starting with `prefix`
 *  (case-insensitive), in level order — the autocomplete suggestions while
 *  typing a category. A level that is exactly what was typed is not
 *  suggested back, and a non-categorical or unknown column suggests nothing. */
export function levelSuggestions(data: TableData, name: string, prefix: string): string[] {
  if (data.variableTypes === undefined) return [];
  if (variableTypesOf(data)[name]?.type !== "categorical") return [];
  const clean = prefix.trim().toLowerCase();
  return categoricalLevels(data, name)
    .map((l) => l.name)
    .filter((level) => level.toLowerCase().startsWith(clean) && level.toLowerCase() !== clean);
}

/** A stored `variableTypes` record, put straight: only entries naming a
 *  data column with a known type survive — a hand-edited file holding a
 *  bogus type, a Title-column entry, or an entry for a column that is
 *  gone loses that entry on its own, never the table. */
export function readVariableTypes(raw: unknown, columns: string[]): Record<string, VariableTypeInfo> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, VariableTypeInfo> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!columns.slice(1).includes(name)) continue;
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const type = (v as Record<string, unknown>).type;
    if (!isVariableType(type)) continue;
    out[name] = { type, manual: (v as Record<string, unknown>).manual === true };
  }
  return Object.keys(out).length ? out : undefined;
}
