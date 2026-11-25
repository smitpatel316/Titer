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
// comma ("1,23", including scientific notation: "1,5e-3"). Anything else is text.
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const COMMA_DECIMAL = /^[+-]?\d+,\d+([eE][+-]?\d+)?$/;
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
 *  so "Male" and "male" are one level; blank cells are no level. Listed in
 *  the column's level order — the stored order when one exists, else Entry
 *  order (first appearance in the table), per seq 340. */
export interface VariableLevel {
  name: string;
  count: number;
  excluded: number;
}
/** A level's key: its trimmed text, lowercased — the form the stored order
 *  keeps, so "Male" and "male" share one position. */
export const levelKey = (value: string): string => value.trim().toLowerCase();

/** A column's level keys in Entry order — first appearance scanning the
 *  rows top to bottom, blanks skipped. Type-agnostic: the raw entry record,
 *  which the stored order is built from. */
export function entryLevelKeys(data: TableData, name: string): string[] {
  const c = data.columns.indexOf(name);
  if (c < 1) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const row of data.rows) {
    const cell = row[c];
    if (cell === null) continue;
    const k = levelKey(cell);
    if (k && !seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  return keys;
}

/** A categorical column's levels in their resolved order: the stored order
 *  first (levels whose rows are gone drop out), then any level not yet in
 *  it, in Entry order — so a new level always appends at the end. A column
 *  that isn't categorical, or has no levels, has no order. */
export function orderedLevelKeys(data: TableData, name: string): string[] {
  if (variableTypesOf(data)[name]?.type !== "categorical") return [];
  const entry = entryLevelKeys(data, name);
  const stored = data.levelOrder?.[name];
  if (!stored) return entry;
  const resolved = stored.filter((k) => entry.includes(k));
  for (const k of entry) if (!resolved.includes(k)) resolved.push(k);
  return resolved;
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
  return orderedLevelKeys(data, name)
    .map((k) => byKey.get(k))
    .filter((l): l is VariableLevel => l !== undefined);
}

/** Sets column `name`'s level order by hand (seq 340, Prism 11.2 Level
 *  Order): `order` holds level names in the wanted order — unknown names
 *  drop, duplicates collapse, and any level left out appends in Entry
 *  order, so a set can never lose a level. Returns `data` unchanged when
 *  the column doesn't exist, has no levels, or the order already holds. */
export function setLevelOrder(data: TableData, name: string, order: string[]): TableData {
  const c = data.columns.indexOf(name);
  if (c < 1) return data;
  const entry = entryLevelKeys(data, name);
  const stored = data.levelOrder?.[name];
  if (entry.length === 0) {
    if (!stored) return data;
    const { [name]: _dropped, ...rest } = data.levelOrder!;
    return { ...data, levelOrder: Object.keys(rest).length ? rest : undefined };
  }
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const key of order) {
    const k = levelKey(key);
    if (k && entry.includes(k) && !seen.has(k)) {
      seen.add(k);
      resolved.push(k);
    }
  }
  for (const k of entry) if (!seen.has(k)) resolved.push(k);
  const current = stored ?? entry;
  if (resolved.length === current.length && resolved.every((k, i) => k === current[i])) return data;
  return { ...data, levelOrder: { ...data.levelOrder, [name]: resolved } };
}

/** Moves the level at index `from` to index `to` in column `name`'s order —
 *  the drag-and-drop and step-button primitive (top/up/down/bottom are
 *  moves to 0 / from−1 / from+1 / last). Returns `data` unchanged when
 *  either index is out of range or the move goes nowhere. */
export function moveLevel(data: TableData, name: string, from: number, to: number): TableData {
  const order = orderedLevelKeys(data, name);
  if (from < 0 || from >= order.length || to < 0 || to >= order.length || from === to) return data;
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return setLevelOrder(data, name, next);
}

/** One of Prism's sort presets for a column's levels (mv_format_data_table.htm
 *  §12): Entry, Name, Row or Frequency, each ascending or descending. Each
 *  is a one-time command that sets a new static order, never a rule that
 *  re-applies when data changes. Prism's docs don't define Entry vs Row
 *  operationally; Titer reads them as: Entry is the order levels entered
 *  the table — the stored order, once one exists (a new level appends);
 *  Row re-derives first-appearance order from the current rows, so it can
 *  differ from Entry after rows were deleted or inserted. Name sorts by
 *  display name; Frequency by row count (ties keep Entry order). */
export type LevelOrderPreset = "entry" | "name" | "row" | "frequency";
export function sortLevelOrder(
  data: TableData,
  name: string,
  preset: LevelOrderPreset,
  direction: "asc" | "desc",
): TableData {
  const entry = entryLevelKeys(data, name);
  if (entry.length === 0) return data;
  if (variableTypesOf(data)[name]?.type !== "categorical") return data;
  const dir = direction === "desc" ? -1 : 1;
  let order: string[];
  switch (preset) {
    case "entry":
      // The stored order, once one exists: Entry is the order levels
      // entered the table, and the stored order is that record.
      order = orderedLevelKeys(data, name);
      if (direction === "desc") order.reverse();
      break;
    case "row":
      order = [...entry];
      if (direction === "desc") order.reverse();
      break;
    case "name": {
      const display = new Map(categoricalLevels(data, name).map((l) => [levelKey(l.name), l.name]));
      order = [...entry].sort((a, b) => dir * (display.get(a) ?? a).localeCompare(display.get(b) ?? b));
      break;
    }
    case "frequency": {
      const counts = new Map(
        categoricalLevels(data, name).map((l) => [levelKey(l.name), l.count + l.excluded]),
      );
      // A direction-aware comparator, not a reverse: ties keep Entry order
      // in both directions.
      order = [...entry].sort((a, b) => dir * ((counts.get(a) ?? 0) - (counts.get(b) ?? 0)));
      break;
    }
  }
  return setLevelOrder(data, name, order);
}

/** Maintains the stored level orders after an edit (the store funnel calls
 *  it beside refreshVariableTypes): a level whose rows are gone drops out,
 *  a new level appends at the end, a deleted column takes its order with
 *  it. Returns `data` unchanged when nothing moves, so the funnel can call
 *  it on every edit without minting undo steps. */
export function refreshLevelOrder(data: TableData): TableData {
  if (!data.levelOrder) return data;
  let changed = false;
  const next: Record<string, string[]> = {};
  for (const [name, stored] of Object.entries(data.levelOrder)) {
    if (!data.columns.slice(1).includes(name)) {
      changed = true;
      continue;
    }
    const entry = entryLevelKeys(data, name);
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of stored) {
      const k = levelKey(raw);
      if (k && entry.includes(k) && !seen.has(k)) {
        seen.add(k);
        kept.push(k);
      }
    }
    const resolved = [...kept];
    for (const k of entry) if (!seen.has(k)) resolved.push(k);
    if (resolved.length === 0) {
      changed = true;
      continue;
    }
    next[name] = resolved;
    if (resolved.length !== stored.length || resolved.some((k, i) => k !== stored[i])) changed = true;
  }
  return changed ? { ...data, levelOrder: Object.keys(next).length ? next : undefined } : data;
}

/** A stored `levelOrder` record, put straight: only entries naming a data
 *  column with an array of level names survive — a hand-edited file
 *  holding a non-array, non-string entries, or an entry for a column that
 *  is gone loses that entry on its own, never the table. Keys are
 *  normalized and de-duplicated; an entry that normalizes to nothing drops. */
export function readLevelOrder(raw: unknown, columns: string[]): Record<string, string[]> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!columns.slice(1).includes(name)) continue;
    if (!Array.isArray(v)) continue;
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const item of v) {
      if (typeof item !== "string") continue;
      const k = levelKey(item);
      if (k && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
    if (keys.length) out[name] = keys;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Renames one level of column `name`: every row holding it (any case) takes
 *  the new name. Renaming onto another level merges the two — that is how a
 *  typo ("Mael") is folded into its level ("Male"). Exclusions stay: they
 *  are positions, and no row moves. The stored level order follows the
 *  rename: the renamed level keeps its position, and on a merge the
 *  surviving level keeps its position while the folded key drops.
 *  Returns `data` unchanged when the column or the level doesn't exist, or
 *  the new name is blank or the same level in another case. */
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
  if (!changed) return data;
  const order = data.levelOrder?.[name];
  let levelOrder = data.levelOrder;
  if (order) {
    const oldKey = levelKey(oldLevel);
    const newKey = levelKey(clean);
    const idx = order.indexOf(oldKey);
    if (idx >= 0) {
      if (order.includes(newKey)) {
        levelOrder = { ...data.levelOrder, [name]: order.filter((k) => k !== oldKey) };
      } else {
        const next = [...order];
        next[idx] = newKey;
        levelOrder = { ...data.levelOrder, [name]: next };
      }
    }
  }
  return { ...data, rows, levelOrder };
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
