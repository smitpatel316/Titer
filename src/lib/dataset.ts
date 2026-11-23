// The one reading of a table that the stats, the graphs and the analysis wizards
// share, so they always agree on the data: excluded cells read as blank, each cell
// is parsed once (numeric.ts decides what a number is), and the reading is cached
// per table version. An edit makes a new TableData, so the cache is never stale.
import { hasXColumn, type TableData, type TableType, type VariableType, type VariableTypeInfo } from "../store/types";
import { summaryFormatOf, type SummaryFormat } from "./summary-format";
import { convertXCell, xZeroMs, type XConversion } from "./date-time";
import { excludedKey, seriesKeyOf } from "./columns";
import { parseCell } from "./numeric";
import { orderedLevelKeys, rowLabelsOf, variableTypesOf } from "./variable-types";

/** One data column, as every engine sees it. */
export interface Column {
  name: string;
  /** Raw text, one per table row (excluded cells read as blank). */
  cells: (string | null)[];
  /** The same rows as numbers (null: blank or text). */
  byRow: (number | null)[];
  /** Just the numbers, in row order… */
  values: number[];
  /** …and the row each one came from. */
  rows: number[];
  /** The data set it belongs to: a grouped table's group or an XY table's data set of
   *  replicates ("A" for "A:Y1"), else (absent) the column itself. */
  set?: string;
  /** The column's resolved MV variable type (seq 331): categorical,
   *  continuous or label, as the Variable Types panel shows it. Absent on
   *  tables nobody typed yet (non-MV tables, or an MV table before its
   *  first edit) — consumers fall back to the cells, as before. */
  variableType?: VariableType;
  /** The column's categorical levels in their stored order (seq 340), as
   *  normalized keys — present only when the table stores an order for
   *  this column. Absent = Entry order (first appearance in the table),
   *  which is what `levelsOf` reads anyway. */
  levelOrder?: string[];
}

export interface Dataset {
  /** The row titles (column 0), one per row. */
  titles: (string | null)[];
  /** Every data column, in table order. */
  columns: Column[];
  /** The data columns holding at least one number. */
  numeric: Column[];
  /** What an analysis runs on, in table order: each column, or a grouped table's groups
   *  (holding numbers or not). A nested table's sets are its groups, each holding
   *  every column of every subgroup — so `params.sets` scopes a nested test to
   *  the groups named, as it does for grouped tables. */
  sets: DataSet[];
  /** A nested table's groups with their subgroups (empty for other tables) —
   *  the structure the nested tests read, alongside `sets`. */
  nested: NestedGroup[];
  /** The resolved MV variable types, keyed by column name — the pickers'
   *  reading, so a label variable is never offered to an analysis. Empty
   *  on tables nobody typed yet. */
  variableTypes?: Record<string, VariableTypeInfo>;
  /** The values the graphs show beside their points: the chosen label
   *  variable's cells, or the row titles when none is chosen. */
  rowLabels?: (string | null)[];
  /** A grouped table's sub-column format: "replicates", or the summaries its
   *  sub-columns hold (see src/lib/summary-format.ts) — the graphs' and the
   *  stats' shared reading, so a summary table is never mistaken for replicates. */
  summary: SummaryFormat;
}

/** A column, or a grouped table's group with its sub-columns. */
export interface DataSet {
  name: string;
  columns: Column[];
}

/** A nested table's group, with its subgroups (animals/subjects) in table order. */
export interface NestedGroup {
  name: string;
  subgroups: NestedSubgroup[];
}

/** One subgroup of a nested table's group, with its replicate columns. */
export interface NestedSubgroup {
  name: string;
  columns: Column[];
}

/** Whether a table is a grouped one (groups × sub-columns) — not a nested one,
 *  which carries `subgroups` too and reads through `nestedGroupsOf`. */
export const isGrouped = (data: TableData) => Boolean(data.groups && data.replicates && !data.subgroups);

/** Whether a table is a nested one (groups × subgroups × replicates). A table
 *  is nested iff all three counts are set — a grouped table never sets `subgroups`. */
export const isNested = (data: TableData) => Boolean(data.groups && data.subgroups && data.replicates);

/** How many columns come before a grouped table's groups (Title included): 1, or 2 when
 *  an X column comes first (an XY table with replicates). */
export const leadOf = (data: TableData) =>
  isNested(data) ? 1 : isGrouped(data) ? data.columns.length - data.groups! * data.replicates! : data.columns.length;

const cache = new WeakMap<TableData, Dataset>();

export function readTable(data: TableData): Dataset {
  let dataset = cache.get(data);
  if (!dataset) {
    const excluded = new Set(data.excluded);
    // The resolved variable types, when the table has any — an MV table
    // refreshed by the store funnel, never a non-MV table (whose columns
    // stay typeless and read exactly as before).
    const types = data.variableTypes ? variableTypesOf(data) : {};
    // The columns from `lead` on are a grouped table's: each in its group.
    const lead = leadOf(data);
    // A date/elapsed X column (seq 332): the first data column converts to
    // numbers with the table's units + start date, so every analysis and
    // graph sees numbers while the cells keep their typed text. The zero is
    // computed once for the whole column, not per cell.
    let xByRow: (number | null)[] | null = null;
    if (data.xFormat === "date" || data.xFormat === "elapsed") {
      const format = data.xFormat;
      const xCells = data.rows.map((row, r) => (excluded.has(excludedKey(r, 1)) ? null : (row[1] ?? null)));
      const conversion: XConversion = data.xConversion ?? { units: "days" };
      const zero = format === "date" ? xZeroMs(xCells, conversion) : null;
      xByRow = xCells.map((cell) => convertXCell(cell, format, conversion, zero));
    }
    const columns = data.columns.slice(1).map((name, i): Column => {
      const cells = data.rows.map((row, r) => (excluded.has(excludedKey(r, i + 1)) ? null : (row[i + 1] ?? null)));
      const byRow = i === 0 && xByRow !== null ? xByRow : cells.map(parseCell);
      const rows = byRow.flatMap((v, r) => (v == null ? [] : [r]));
      const set = i + 1 >= lead ? seriesKeyOf(name) : undefined;
      const variableType = types[name]?.type;
      // The stored level order, when the table holds one for this column —
      // the level functions below read their levels in this order. Absent
      // = Entry order, which is what the discovery order already is.
      const levelOrder = data.levelOrder?.[name] ? orderedLevelKeys(data, name) : undefined;
      return {
        name,
        cells,
        byRow,
        values: rows.map((r) => byRow[r]!),
        rows,
        ...(set === undefined ? {} : { set }),
        ...(variableType === undefined ? {} : { variableType }),
        ...(levelOrder === undefined ? {} : { levelOrder }),
      };
    });
    dataset = {
      titles: data.rows.map((row) => row[0] ?? null),
      columns,
      numeric: columns.filter((c) => c.values.length > 0),
      sets: isNested(data)
        ? nestedGroupsOf(columns).map((g) => ({ name: g.name, columns: g.subgroups.flatMap((s) => s.columns) }))
        : isGrouped(data)
          ? byGroup(columns)
          : columns.map((c) => ({ name: c.name, columns: [c] })),
      nested: isNested(data) ? nestedGroupsOf(columns) : [],
      variableTypes: types,
      rowLabels: rowLabelsOf(data),
      summary: summaryFormatOf(data),
    };
    cache.set(data, dataset);
  }
  return dataset;
}

/** An XY table's X (its first data column, whatever its name; undefined while it
 *  holds no number) and its Y data sets holding numbers: a column, or its replicates. */
export function splitXY(columns: Column[]): { x?: Column; ys: DataSet[] } {
  const [x, ...ys] = columns;
  return {
    x: x?.values.length ? x : undefined,
    ys: byGroup(ys).filter((s) => s.columns.some((c) => c.values.length > 0)),
  };
}

/** A data set's points against X: every replicate's value where X has one, row by row
 *  (each replicate a point, as regressions take them), with the column it is in. */
export function xyPoints(x: Column, set: DataSet): { x: number[]; y: number[]; rows: number[]; columns: string[] } {
  const points = set.columns
    .flatMap((c) => pairUp(x, c).rows.map((r) => ({ r, y: c.byRow[r]!, column: c.name })))
    .sort((a, b) => a.r - b.r);
  return {
    x: points.map((p) => x.byRow[p.r]!),
    y: points.map((p) => p.y),
    rows: points.map((p) => p.r),
    columns: points.map((p) => p.column),
  };
}

/** A data set's values at each X (the rows where X and a replicate hold a number). */
export function xyRows(x: Column, set: DataSet): { x: number[]; values: number[][]; rows: number[] } {
  const rows = x.rows.filter((r) => set.columns.some((c) => c.byRow[r] != null));
  return {
    x: rows.map((r) => x.byRow[r]!),
    values: rows.map((r) => set.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]))),
    rows,
  };
}

/** Reorders discovered level names by a stored level order (seq 340): a
 *  level whose normalized key sits in the order takes that position; a
 *  level the order doesn't name stays after them, in discovery order. Two
 *  spellings of one level ("Female" / "female") share a key and keep their
 *  discovery order — the sort is stable. Without an order, the list is
 *  returned as discovered. */
export function orderLevels(levels: string[], levelOrder?: readonly string[]): string[] {
  if (!levelOrder || levelOrder.length === 0) return levels;
  const pos = new Map(levelOrder.map((k, i) => [k, i]));
  return [...levels].sort((a, b) => {
    const pa = pos.get(a.trim().toLowerCase());
    const pb = pos.get(b.trim().toLowerCase());
    if (pa === undefined && pb === undefined) return 0;
    if (pa === undefined) return 1;
    if (pb === undefined) return -1;
    return pa - pb;
  });
}

/** Distinct non-blank cell texts of a column, in first-appearance order — a
 *  grouping variable's levels (integer codes or text, e.g. "Female"/"Male").
 *  The Multiple Variables analyses split their rows by these (a t test's two
 *  groups, a survival analysis's groups), as Extract and rearrange does.
 *  When the column carries a stored level order (seq 340), the levels come
 *  back in that order instead. */
export function levelsOf(column: Column): string[] {
  const seen = new Set<string>();
  const levels: string[] = [];
  for (const cell of column.cells) {
    const t = cell?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      levels.push(t);
    }
  }
  return orderLevels(levels, column.levelOrder);
}

/** The columns of one Y data set: the column itself, its replicate columns —
 *  "Control" → "Control_1", "Control_2", … (Prism's import) or "Control:Y1",
 *  "Control:Y2", … (a Titer table's sub-columns, grouped under the set) —
 *  so a Titer fit that names the data set fits every replicate point, as
 *  Prism does. A plain column name is unchanged. */
export function datasetColumns(columns: Column[], name: string): Column[] {
  const exact = columns.find((c) => c.name === name);
  if (exact) return [exact];
  const pooled = columns.filter((c) => c.set === name);
  if (pooled.length) return pooled;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replicate = new RegExp(`^${escaped}_\\d+$`);
  return columns.filter((c) => replicate.test(c.name));
}

/** Why an XY table can't be analyzed or drawn yet, if it can't: X (its first data column)
 *  needs numbers, and so does a Y column — `y`, when one is chosen. */
export function xyProblem(columns: Column[], y?: string): string | undefined {
  const [x, ...ys] = columns;
  if (!x?.values.length) {
    const name = x?.name ?? "X";
    const text = x?.cells.find((c) => c?.trim());
    return text
      ? `“${name}”, the X column, holds text (“${text}”). X values must be numbers.`
      : `“${name}”, the X column, is empty. Type the X values (times, doses…) in it.`;
  }
  const chosen = y === undefined ? ys : ys.filter((c) => (c.set ?? c.name) === y);
  if (!chosen.some((c) => c.values.length))
    return y === undefined ? "No Y column holds numbers yet." : `“${y}” holds no numbers yet.`;
}

/** The rows where both columns hold a number: how X and Y pair up. */
export function pairUp(a: Column, b: Column): { x: number[]; y: number[]; rows: number[] } {
  const rows = a.rows.filter((r) => b.byRow[r] != null);
  return { x: rows.map((r) => a.byRow[r]!), y: rows.map((r) => b.byRow[r]!), rows };
}

/** A grouped table's groups ("A" for "A:Y1", "A:Y2"…), in table order, each with
 *  its replicate columns. Groups without a single number are left out: `groups`
 *  on the table says how many exist, not how many hold data. */
export function groupsOf(columns: Column[]): DataSet[] {
  const named = columns.map((c) => ({ ...c, set: c.set ?? seriesKeyOf(c.name) }));
  return byGroup(named).filter((g) => g.columns.some((c) => c.values.length > 0));
}

/** Columns gathered by data set (a column alone, or a group: "A" for "A:Y1", "A:Y2"…),
 *  in table order. */
function byGroup(columns: Column[]): DataSet[] {
  const sets: DataSet[] = [];
  const groups = new Map<string, DataSet>();
  for (const c of columns) {
    const group = c.set === undefined ? undefined : groups.get(c.set);
    if (group) group.columns.push(c);
    else {
      const set = { name: c.set ?? c.name, columns: [c] };
      if (c.set !== undefined) groups.set(c.set, set);
      sets.push(set);
    }
  }
  return sets;
}

/** A nested table's groups ("A" for "A:S1:R1"…), each with its subgroups
 *  ("S1" for "A:S1:R1"…), in table order. A column whose name doesn't split
 *  into exactly three parts belongs to no subgroup and is left out — a nested
 *  table's columns are all "group:subgroup:replicate" by construction, so this
 *  only bites on a hand-edited name. Subgroups without a single number are
 *  kept here (the nested runners must see them to name the ones they drop);
 *  callers that only want data pass the numeric columns. */
export function nestedGroupsOf(columns: Column[]): NestedGroup[] {
  const groups = new Map<string, Map<string, Column[]>>();
  for (const c of columns) {
    const parts = c.name.split(":");
    if (parts.length !== 3) continue;
    const [group, subgroup] = parts;
    let subs = groups.get(group);
    if (!subs) groups.set(group, (subs = new Map()));
    subs.set(subgroup, [...(subs.get(subgroup) ?? []), c]);
  }
  return [...groups].map(([name, subs]) => ({
    name,
    subgroups: [...subs].map(([sub, cols]) => ({ name: sub, columns: cols })),
  }));
}

/** The columns of the data sets named, in their order. */
export function setColumns(table: Dataset, names: string[]): Column[] {
  return names.flatMap((name) => table.sets.find((s) => s.name === name)?.columns ?? []);
}

/** The series a table's graphs draw, in order: the Y series of a table with an X, a grouped
 *  table's groups, else its columns holding numbers. A series' default color is
 *  the palette color at its position here, in the table and in every graph. */
export function seriesOf(data: TableData, type: TableType): string[] {
  return seriesOfDataset(readTable(data), type);
}

/** `seriesOf`, over an already-read dataset — the merged dataset of a
 *  multi-table graph (#48) has no single `TableData` to read from. */
export function seriesOfDataset(dataset: Dataset, type: TableType): string[] {
  const { columns, numeric } = dataset;
  if (hasXColumn(type)) return splitXY(columns).ys.map((c) => c.name);
  if (type === "grouped") return groupsOf(numeric).map((g) => g.name);
  if (type === "nested") return nestedGroupsOf(numeric).map((g) => g.name);
  return numeric.map((c) => c.name);
}
