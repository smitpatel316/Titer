// The Data sets dialog (seq 309): a table's data sets — its columns, or a
// grouped table's groups, an XY table's Y data sets, a nested table's groups —
// listed, reordered, added and removed. Pure, so the dialog, the MCP
// edit-table ops and the checks share them, and the store's removeDataSet
// orphans the analyses that ran on the removed set.
import { hasXColumn, type ProjectNode, type TableData, type TableType } from "../store/types";
import type { AnalysisParams } from "../stats/types";
import { groupRuns } from "./columns";
import { isGrouped, isNested } from "./dataset";
import {
  dropColumns,
  insertColumns,
  permuteColumns,
  regroupTable,
  renestTable,
} from "../views/tables/table-data";

/** One data set of a table, with its columns' indices (1-based, into
 *  `data.columns`) in table order. */
export interface TableDataSet {
  name: string;
  columns: number[];
}

/** The table's data sets, in table order. An XY or survival table's X (or
 *  Time) column is not a set — it stays first and is never reordered or
 *  removed here. Duplicate-named groups stay separate runs, as the grid
 *  reads them. */
export function dataSetsOf(data: TableData, type: TableType): TableDataSet[] {
  const names = data.columns;
  if (hasXColumn(type)) {
    // The sets are the Y columns after X. With replicates they run in
    // groups ("A:Y1"…); without, one column per set. The lead mirrors
    // `applySummaryFormatXY`: a grouped-shaped X (pre-1.0.9 files) puts
    // the first set right after Title.
    const lead = data.groups && data.replicates ? (names[1]?.includes(":") ? 1 : 2) : 2;
    if (data.groups && data.replicates) {
      return groupRuns(names.slice(lead)).map((r) => ({ name: r.name, columns: r.columns.map((c) => c + lead) }));
    }
    return names.slice(lead).map((name, i) => ({ name, columns: [lead + i] }));
  }
  if (isGrouped(data) || isNested(data)) {
    return groupRuns(names.slice(1)).map((r) => ({ name: r.name, columns: r.columns.map((c) => c + 1) }));
  }
  return names.slice(1).map((name, i) => ({ name, columns: [i + 1] }));
}

/** Moves the data set at `from` to `to` (0-based, in the dialog's list):
 *  its columns move as a block, values and exclusions with them. The X
 *  column of an XY table stays first. Out of range, or no move, the table
 *  comes back unchanged. */
export function reorderDataSet(data: TableData, type: TableType, from: number, to: number): TableData {
  const sets = dataSetsOf(data, type);
  if (from < 0 || from >= sets.length || to < 0 || to >= sets.length || from === to) return data;
  const order = [...sets];
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const first = Math.min(...sets.flatMap((s) => s.columns));
  const lead = Array.from({ length: first }, (_, c) => c);
  return permuteColumns(data, [...lead, ...order.flatMap((s) => s.columns)]);
}

/** Appends a new empty data set at the end: a column for a plain table, a
 *  group for a grouped / nested / XY-with-replicates table. The new set
 *  takes the next free name for its place ("C" for the third group). */
export function addDataSet(data: TableData, type: TableType): TableData {
  if (isNested(data)) return renestTable(data, data.groups! + 1, data.subgroups!, data.replicates!);
  if (isGrouped(data)) return regroupTable(data, data.groups! + 1, data.replicates!, type === "xy" ? "xy" : "grouped");
  return insertColumns(data, data.columns.length, 1, type);
}

/** Removes the data set at `index`: its columns go, with their values.
 *  Refuses the last set — a table keeps at least one. */
export function removeDataSet(
  data: TableData,
  type: TableType,
  index: number,
): { data: TableData } | { error: string } {
  const sets = dataSetsOf(data, type);
  if (index < 0 || index >= sets.length) {
    return { error: `There is no data set ${index + 1} — this table has ${sets.length}.` };
  }
  if (sets.length <= 1) {
    return {
      error: `“${sets[0].name}” is the table's last data set — a table keeps at least one, so it can't be removed. Add another data set first, or delete the table itself.`,
    };
  }
  const set = sets[index];
  let next = dropColumns(data, set.columns);
  if (isNested(data) || isGrouped(data)) next = { ...next, groups: data.groups! - 1 };
  return { data: next };
}

/** How many values the set holds (its columns' non-blank cells) — the
 *  remove warning's count. */
export function setValueCount(data: TableData, set: TableDataSet): number {
  return set.columns.reduce(
    (n, c) => n + data.rows.reduce((m, row) => m + (row[c] != null ? 1 : 0), 0),
    0,
  );
}

// ── Dependent analyses ──────────────────────────────────────────────────

/** The param fields naming data sets or columns an analysis runs on
 *  (mirrors `PARAM_NAMES` in store/references.ts, plus the grouping
 *  variables): any of these naming a set means the analysis runs on it. */
const SET_FIELDS = [
  "x",
  "y",
  "y2",
  "ys",
  "globalY",
  "truth",
  "score",
  "dependent",
  "reference",
  "control",
  "compareWith",
  "predictors",
  "datasets",
  "sets",
  "time",
  "status",
  "covariates",
  "stratifyBy",
  "response",
  "groupBy",
  "grouping",
  "outcome",
  "subject",
] as const;

/** Whether `params` name `setName` — the analysis runs on that data set. */
export function analysisDependsOnSet(params: AnalysisParams | undefined, setName: string): boolean {
  if (!params) return false;
  const p = params as Record<string, unknown>;
  for (const key of SET_FIELDS) {
    const v = p[key];
    if (typeof v === "string" && v === setName) return true;
    if (Array.isArray(v) && v.includes(setName)) return true;
  }
  // Compared pairs ("A" vs "B") hold the set names too.
  const compared = p.compared;
  if (Array.isArray(compared)) {
    for (const entry of compared) {
      if (typeof entry === "string" && entry.split("\u0000").includes(setName)) return true;
    }
  }
  return false;
}

/** The table's analyses that run on `setName` — the ones removing it
 *  orphans. */
export function dependentAnalyses(
  nodes: Record<string, ProjectNode>,
  tableId: string,
  setName: string,
): ProjectNode[] {
  return Object.values(nodes).filter(
    (n) => n.type === "analysis" && n.parentId === tableId && analysisDependsOnSet(n.analysisParams, setName),
  );
}
