// One graph from multiple tables (#48, Prism parity).
//
// Prism ("One table ≠ one graph", Prism User Guide): "You can plot data
// from multiple data tables on one graph" — via New Graph of Existing
// Data. Its flagship case is XY tables whose Y sets have *different* X
// values: each set lives on its own table, and one graph plots them all
// (Prism 8 XY guide: "enter each data set on a different table … and
// include data from all the data tables on a single graph").
//
// A graph node keeps its primary table as `parentId` (sidebar placement,
// family, delete cascade, clone) and lists the extra tables in
// `sourceTableIds`. The merge below builds one `Dataset` from them, which
// the existing builders, `plotColumns`, `choosableSets` and `graphSeries`
// then read unchanged:
//
// - Column / Multiple Variables tables (no X): columns are independent,
//   so the tables' columns are simply concatenated. A series from an extra
//   table is qualified with its table's name ("Assay 2 — Control"), so two
//   tables with a "Control" each stay distinct series.
// - XY / Survival tables (one X column): the X values are UNIONED — the
//   merged X is the sorted union of every table's X (duplicates kept by
//   occurrence, so a repeated X still pairs with each of its rows), and
//   each Y column is re-indexed onto it (blank where that table has no
//   point at that X). This is Prism's staggered entry, generalised: each
//   set is plotted against its own X, and the builders pair by row as
//   they always have.
// - Grouped / Contingency / Nested tables: rows are categories, so the
//   tables must share their row titles in order (a mismatch is a problem,
//   not a silent misalignment), and their summary formats must agree.
//   Group names are qualified the same way ("Assay 2 — Treated").
//
// Limits, stated plainly where they bite: analyses drawn on the graph
// (significance brackets, fitted curves) still come from the primary
// table only — Prism likewise shows no pairwise comparisons on a graph
// with data from more than one table. A column renamed inside an extra
// table leaves that table's qualified set names stale (the Data section
// shows them as gone; re-tick them) — only a *table* rename is followed
// (see `remapQualifiedOptions`). Point styles on an extra table survive
// a primary-table edit (see `restoreForeignPoints`).
import { DEFAULT_GRAPH_OPTIONS, hasXColumn, type GraphOptions, type ProjectNode, type TableData, type TableType } from "../store/types";
import { nestedGroupsOf, readTable, type Column, type DataSet, type Dataset } from "./dataset";
import { summaryFormatOf } from "./summary-format";
import { parsePointKey, pointKeyOf } from "./columns";

/** The separator between a table's name and a series/column name from it. */
export const MULTI_TABLE_SEPARATOR = " — ";

/** A series/column/set name as drawn from `tableName`'s table. */
export const qualifyName = (tableName: string, name: string) => `${tableName}${MULTI_TABLE_SEPARATOR}${name}`;

/** Whether `name` is a qualified name from `tableName`'s table. */
export const isQualifiedBy = (name: string, tableName: string) =>
  name.startsWith(`${tableName}${MULTI_TABLE_SEPARATOR}`);

/** One table feeding a merged graph: its id, name, type and data. */
export interface MergeInput {
  id: string;
  name: string;
  tableType: TableType;
  data: TableData;
}

/** A merged graph's data: one dataset for the builders, or a problem
 *  (the graph shows the problem instead of drawing). */
export interface MergedGraphData {
  dataset: Dataset;
  tableType: TableType;
  /** Why the tables can't share one graph, when they can't. */
  problem?: string;
  /** The tables that contributed, primary first. */
  tables: { id: string; name: string }[];
}

/** The merged dataset of a graph node: its primary table plus
 *  `sourceTableIds`, in order. Null when the graph has no table to draw. */
export function mergedGraphData(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
): MergedGraphData | null {
  const parent = graph.parentId ? nodes[graph.parentId] : undefined;
  if (!parent?.data || !parent.tableType) return null;
  const primary: MergeInput = { id: parent.id, name: parent.name, tableType: parent.tableType, data: parent.data };
  const extras: MergeInput[] = [];
  for (const id of graph.sourceTableIds ?? []) {
    const table = nodes[id];
    if (!table) {
      // A dangling source (the delete cascade and the file repair both
      // strip these, so this is a hand-edited file): say so, don't
      // silently drop a table's data from the graph.
      return {
        dataset: readTable(parent.data),
        tableType: parent.tableType,
        problem: `The graph also plots a table that is no longer in this project — remove it in the graph's Data section, or restore the table.`,
        tables: [{ id: parent.id, name: parent.name }],
      };
    }
    if (table.type !== "table" || !table.data || !table.tableType) continue;
    extras.push({ id: table.id, name: table.name, tableType: table.tableType, data: table.data });
  }
  return mergeGraphTables(primary, extras);
}

/** Whether `sourceIds` can be a graph's extra tables on `primary`:
 *  the errors, in order (empty = fine). The row-title / summary checks
 *  run through the merge itself, so this and the merge never disagree. */
export function validateGraphSources(
  primary: ProjectNode,
  sourceIds: unknown,
  nodes: Record<string, ProjectNode>,
): string[] {
  if (!Array.isArray(sourceIds)) return [`“source_table_ids” must be a list of table ids.`];
  const errors: string[] = [];
  const seen = new Set<string>([primary.id]);
  const extras: MergeInput[] = [];
  for (const id of sourceIds) {
    if (typeof id !== "string" || !id) {
      errors.push(`a source table id must be a non-empty string — got ${JSON.stringify(id)}.`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(id === primary.id ? `“${primary.name}” is already the graph's table.` : `table “${id}” is listed twice.`);
      continue;
    }
    seen.add(id);
    const table = nodes[id];
    if (!table) {
      errors.push(`no table with id “${id}” — run titer_list_tables to see the tables.`);
      continue;
    }
    if (table.type !== "table") {
      errors.push(`“${table.name}” is a ${table.type}, not a table.`);
      continue;
    }
    if (!table.data || !table.tableType) {
      errors.push(`table “${table.name}” has no data recorded.`);
      continue;
    }
    if (table.tableType !== primary.tableType) {
      errors.push(
        `“${table.name}” is a ${tableLabel(table.tableType)} table, but the graph's table “${primary.name}” is ${tableLabel(primary.tableType!)} — a graph's tables must all be the same type.`,
      );
      continue;
    }
    extras.push({ id: table.id, name: table.name, tableType: table.tableType, data: table.data });
  }
  if (errors.length) return errors;
  if (!primary.data || !primary.tableType) return [`the graph's table has no data recorded.`];
  const merged = mergeGraphTables(
    { id: primary.id, name: primary.name, tableType: primary.tableType, data: primary.data },
    extras,
  );
  return merged.problem ? [merged.problem] : [];
}

const tableLabel = (type: TableType) =>
  ({ column: "Column", xy: "XY", grouped: "Grouped", nested: "Nested", multiple: "Multiple Variables", contingency: "Contingency", survival: "Survival", "parts-of-whole": "Parts of Whole" })[type];

/** The merge itself, over plain inputs (so the tests drive it without
 *  nodes). `extras` must already be validated (same type as `primary`). */
export function mergeGraphTables(primary: MergeInput, extras: MergeInput[]): MergedGraphData {
  const tables = [primary, ...extras].map(({ id, name }) => ({ id, name }));
  const primaryDs = readTable(primary.data);
  const extraDs = extras.map((e) => readTable(e.data));

  // Grouped-family tables share their rows as categories: the row titles
  // must line up, and a summary table can't share a graph with a
  // replicates one (their sub-columns mean different things).
  if (!hasXColumn(primary.tableType)) {
    for (let i = 0; i < extras.length; i++) {
      const other = extraDs[i];
      if (primary.tableType === "grouped" || primary.tableType === "contingency" || primary.tableType === "nested") {
        const mismatch = firstTitleMismatch(primaryDs.titles, other.titles);
        if (mismatch !== undefined) {
          const { row, a, b } = mismatch;
          return {
            dataset: primaryDs,
            tableType: primary.tableType,
            problem:
              `Tables “${primary.name}” and “${extras[i].name}” don't share row ${row + 1} (“${a}” vs “${b}”), so their rows can't line up on one graph — give both tables the same row titles, in the same order.`,
            tables,
          };
        }
        if (summaryFormatOf(primary.data) !== summaryFormatOf(extras[i].data)) {
          return {
            dataset: primaryDs,
            tableType: primary.tableType,
            problem:
              `Tables “${primary.name}” and “${extras[i].name}” use different sub-column formats (${summaryFormatOf(primary.data)} vs ${summaryFormatOf(extras[i].data)}) — a graph can't mix summary and replicate sub-columns.`,
            tables,
          };
        }
      }
    }
  }

  const columns: Column[] = [];
  const titles: (string | null)[] = [];
  if (hasXColumn(primary.tableType)) {
    // Union the X values (sorted, duplicates kept by occurrence), then
    // re-index every Y column onto them.
    const union = unionX([primaryDs, ...extraDs]);
    titles.push(...union.titles);
    columns.push(unionXColumn(primaryDs.columns[0]?.name ?? "X", union));
    for (let s = 0; s < [primaryDs, ...extraDs].length; s++) {
      const ds = [primaryDs, ...extraDs][s];
      const input = [primary, ...extras][s];
      const isPrimary = s === 0;
      for (const col of ds.columns.slice(1)) {
        columns.push(reindexedColumnAt(col, union, s, input.name, isPrimary));
      }
    }
  } else {
    const rowCount = Math.max(primaryDs.titles.length, ...extraDs.map((d) => d.titles.length));
    for (let r = 0; r < rowCount; r++) {
      titles.push(primaryDs.titles[r] ?? extraDs.find((d) => d.titles[r])?.titles[r] ?? null);
    }
    const all = [primaryDs, ...extraDs];
    for (let s = 0; s < all.length; s++) {
      const input = [primary, ...extras][s];
      for (const col of all[s].columns) {
        columns.push(paddedColumn(col, rowCount, input.name, s === 0));
      }
    }
  }

  const dataset: Dataset = {
    titles,
    columns,
    numeric: columns.filter((c) => c.values.length > 0),
    sets: setsOf(columns),
    nested: nestedGroupsOf(columns),
    summary: summaryFormatOf(primary.data),
  };
  return { dataset, tableType: primary.tableType, tables };
}

/** The first row where two title lists disagree (blank counts as blank),
 *  or undefined when they agree wherever both have a row. */
function firstTitleMismatch(
  a: (string | null)[],
  b: (string | null)[],
): { row: number; a: string; b: string } | undefined {
  const n = Math.min(a.length, b.length);
  for (let r = 0; r < n; r++) {
    const ta = (a[r] ?? "").trim();
    const tb = (b[r] ?? "").trim();
    if (ta !== tb) return { row: r, a: ta || `row ${r + 1}`, b: tb || `row ${r + 1}` };
  }
  return undefined;
}

// ── XY / Survival: the union X ─────────────────────────────────────────

/** One X value's occurrences across the sources: its value, the cell text
 *  it was typed as, and the row title where it first appears. */
interface UnionX {
  /** The union's values, sorted ascending, duplicates kept by occurrence. */
  keys: string[];
  values: number[];
  /** The cell text of each union value (the first source's spelling). */
  cells: (string | null)[];
  titles: (string | null)[];
  /** For each source, the merged row each of its X rows lands on. */
  rowsOf: Map<number, number>[];
}

function unionX(datasets: Dataset[]): UnionX {
  // Per source: each X row's key is its value + its occurrence count, so a
  // repeated X keeps every one of its rows distinct.
  const perSource: { key: string; value: number; row: number }[][] = datasets.map((ds) => {
    const x = ds.columns[0];
    const seen = new Map<number, number>();
    return (x?.byRow ?? []).flatMap((v, row) => {
      if (v == null) return [];
      const occ = seen.get(v) ?? 0;
      seen.set(v, occ + 1);
      return [{ key: `${v}#${occ}`, value: v, row }];
    });
  });
  const keys = [...new Set(perSource.flatMap((rows) => rows.map((r) => r.key)))];
  keys.sort((a, b) => {
    const [va, oa] = a.split("#").map(Number);
    const [vb, ob] = b.split("#").map(Number);
    return va - vb || oa - ob;
  });
  const values = keys.map((k) => Number(k.split("#")[0]));
  const cells = keys.map((k) => {
    for (let s = 0; s < datasets.length; s++) {
      const hit = perSource[s].find((r) => r.key === k);
      if (hit) return datasets[s].columns[0]?.cells[hit.row] ?? null;
    }
    return null;
  });
  const titles = keys.map((k) => {
    for (let s = 0; s < datasets.length; s++) {
      const hit = perSource[s].find((r) => r.key === k);
      if (hit) return datasets[s].titles[hit.row] ?? null;
    }
    return null;
  });
  const rowsOf = perSource.map((rows) => {
    const map = new Map<number, number>();
    for (const r of rows) map.set(r.row, keys.indexOf(r.key));
    return map;
  });
  return { keys, values, cells, titles, rowsOf };
}

function unionXColumn(name: string, union: UnionX): Column {
  // Every union value comes from some source, so every cell is spelled;
  // the numbers are the union's values themselves.
  return columnOf(name, union.cells, [...union.values], undefined);
}

function reindexedColumnAt(
  col: Column,
  union: UnionX,
  sourceIndex: number,
  tableName: string,
  isPrimary: boolean,
): Column {
  const cells: (string | null)[] = new Array(union.keys.length).fill(null);
  const byRow: (number | null)[] = new Array(union.keys.length).fill(null);
  const rowsOf = union.rowsOf[sourceIndex];
  for (const r of col.rows) {
    const merged = rowsOf.get(r);
    if (merged === undefined) continue;
    cells[merged] = col.cells[r];
    byRow[merged] = col.byRow[r];
  }
  return columnOf(
    isPrimary ? col.name : qualifyName(tableName, col.name),
    cells,
    byRow,
    isPrimary ? col.set : col.set === undefined ? undefined : qualifyName(tableName, col.set),
  );
}

// ── Column building ────────────────────────────────────────────────────

/** A column from its cells: numbers parsed once, values/rows derived. */
function columnOf(name: string, cells: (string | null)[], byRow: (number | null)[], set?: string): Column {
  const rows = byRow.flatMap((v, r) => (v == null ? [] : [r]));
  return {
    name,
    cells,
    byRow,
    values: rows.map((r) => byRow[r]!),
    rows,
    ...(set === undefined ? {} : { set }),
  };
}

/** A non-X column, padded to the merged row count, qualified when it
 *  comes from an extra table (its set qualified with it, so grouped
 *  tables keep their groups distinct per table). */
function paddedColumn(col: Column, rowCount: number, tableName: string, isPrimary: boolean): Column {
  const cells = [...col.cells];
  const byRow = [...col.byRow];
  while (cells.length < rowCount) {
    cells.push(null);
    byRow.push(null);
  }
  return columnOf(
    isPrimary ? col.name : qualifyName(tableName, col.name),
    cells,
    byRow,
    isPrimary ? col.set : col.set === undefined ? undefined : qualifyName(tableName, col.set),
  );
}

/** The merged sets: columns grouped by their set (a grouped table's
 *  group, an XY table's replicate set), else one set per column — the
 *  same shape `readTable` builds, so `plotColumns` reads the merge
 *  exactly like a single table. */
function setsOf(columns: Column[]): DataSet[] {
  const sets: DataSet[] = [];
  const groups = new Map<string, DataSet>();
  for (const c of columns) {
    const key = c.set ?? c.name;
    const group = groups.get(key);
    if (group) group.columns.push(c);
    else {
      const set = { name: key, columns: [c] };
      if (c.set !== undefined) groups.set(key, set);
      sets.push(set);
    }
  }
  return sets;
}

// ── Table renames + foreign point styles ───────────────────────────────

/** `options` with every name qualified from `oldName`'s table re-qualified
 *  to `newName`'s — sets, series and point styles, the right-Y dataset,
 *  and the variable/column picks. Undefined when nothing was qualified
 *  from that table (a rename then changes nothing for this graph). */
export function remapQualifiedOptions(
  options: GraphOptions,
  oldName: string,
  newName: string,
): GraphOptions | undefined {
  const prefix = `${oldName}${MULTI_TABLE_SEPARATOR}`;
  const nextPrefix = `${newName}${MULTI_TABLE_SEPARATOR}`;
  const map = (name: string) => (name.startsWith(prefix) ? nextPrefix + name.slice(prefix.length) : name);
  const mapKey = (key: string) => {
    const { column, row } = parsePointKey(key);
    const mapped = map(column);
    return mapped === column ? key : pointKeyOf(mapped, row);
  };
  let changed = false;
  const out: GraphOptions = { ...options };
  const remapList = (list: string[] | undefined) => {
    if (!list) return list;
    const next = list.map(map);
    if (next.some((n, i) => n !== list[i])) changed = true;
    return next;
  };
  const remapRecord = <T>(record: Record<string, T> | undefined) => {
    if (!record) return record;
    const next = Object.fromEntries(Object.entries(record).map(([k, v]) => [map(k), v]));
    if (Object.keys(next).some((k, i) => k !== Object.keys(record)[i])) changed = true;
    return next;
  };
  const remapPoints = (record: Record<string, never> | undefined) => {
    if (!record) return record;
    const next = Object.fromEntries(Object.entries(record).map(([k, v]) => [mapKey(k), v]));
    if (Object.keys(next).some((k, i) => k !== Object.keys(record)[i])) changed = true;
    return next;
  };
  out.sets = remapList(options.sets);
  out.series = remapRecord(options.series);
  out.points = remapPoints(options.points as Record<string, never> | undefined) as GraphOptions["points"];
  for (const key of ["rightYDataset", "xVariable", "yVariable", "bubbleSizeVariable", "bubbleColorVariable", "volcanoX", "volcanoY", "volcanoLabel", "volcanoGroupA", "volcanoGroupB"] as const) {
    const value = options[key];
    if (typeof value === "string") {
      const next = map(value);
      if (next !== value) {
        changed = true;
        out[key] = next;
      }
    }
  }
  return changed ? out : undefined;
}

/** A graph's point styles that belong to its *extra* tables (their
 *  columns are qualified names): `followTable` on the primary table
 *  drops these (their columns aren't in the primary table), so a
 *  primary-table edit restores them afterwards. */
export function restoreForeignPoints(before: ProjectNode, after: ProjectNode, nodes: Record<string, ProjectNode>): ProjectNode {
  const points = before.graphOptions?.points;
  if (!points || !before.sourceTableIds?.length) return after;
  const sources = before.sourceTableIds
    .map((id) => nodes[id]?.name)
    .filter((n): n is string => typeof n === "string");
  if (!sources.length) return after;
  const foreign = Object.fromEntries(
    Object.entries(points).filter(([key]) => {
      const { column } = parsePointKey(key);
      return sources.some((name) => isQualifiedBy(column, name));
    }),
  );
  if (!Object.keys(foreign).length) return after;
  const kept = { ...(after.graphOptions?.points ?? {}), ...foreign };
  return { ...after, graphOptions: { ...DEFAULT_GRAPH_OPTIONS, ...after.graphOptions, points: kept } };
}
