// The frontend half of the MCP dispatch channel (L0, GAP-1): what runs
// when Rust hands this window a job.
//
// A tool handler in Rust cannot run a store call or an analysis itself —
// the store, the runners and the writers live in this webview. So Rust
// enqueues a job (job id, target window, action, args) and wakes the
// window with an `mcp-run-job` event; this dispatcher claims the job once
// (`mcp_take_jobs` — the single claim path, CC-m6 once-only, same
// discipline as `r_ready`'s `sent` set), executes it, and reports
// completion via `mcp_complete_job` (sibling of `mcp_publish_result`).
// Jobs run one at a time per window, matching the webR serial queue —
// which is also what makes a cancel exact: only this job's R work is live,
// so a cancel maps to the `cancel_r` path (`cancelR()` below).
//
// `executeJob` is the extension point: future lanes add branches for
// their actions (store calls, save, graph builds, …) here. It takes its
// dependencies injected so the node test harness can drive it without a
// webview (see the L0 verification script in the lane dir).
import * as React from "react";
import { ANALYSES, runAnalysis } from "../stats";
import type { AnalysisParams, AnalysisResult, AnalysisType } from "../stats/types";
import { infoSheetsOf, resolveAnalysisParams } from "../lib/info-sheets";
import { validateAnalysisParams } from "../lib/project-file";
import { analysisOptionsForTable, countDataGroups, hasRowGroups } from "../views/analyses";
import {
  defaultDocumentIo,
  executeCloseProject,
  executeImportPrism,
  executeSaveProject,
  type DocumentDeps,
  type DocumentIo,
  type DocumentState,
} from "./mcp-document";
import {
  executeBuildGraph,
  executeCloneGraph,
  executeCreateFigure,
  executeCreateInfoSheet,
  executeUpdateFigure,
  executeUpdateGraph,
  executeUpdateInfoSheet,
  type GraphJobDeps,
} from "./mcp-graphs";
import {
  cancelR,
  isNative,
  mcpCompleteJob,
  mcpTakeJobs,
  onMcpCancelJob,
  onMcpRunJob,
  type McpJob,
} from "../native";
import { publishAnalysisResult } from "./mcp-publish";
import { useProjectActions, useProjectStore } from "./use-project-store";
import type { ProjectNode, TableData, TableType } from "./types";
import type { TableMove } from "./references";
import { isGrouped, isNested, leadOf } from "../lib/dataset";
import { seriesKeyOf } from "../lib/columns";
import { SUMMARY_FORMATS, summarySubcolumns, type SummaryFormat } from "../lib/summary-format";
import {
  convertCommaDecimals,
  deleteColumns,
  deleteRows,
  growRowGroups,
  hasCommaDecimals,
  insertColumns,
  insertRows,
  renameColumn,
  renameGroup,
  rowsDeleted,
  rowsInserted,
  shiftRowGroupsForDelete,
} from "../views/tables/table-data";
import { TABLES } from "../views/tables/index";

/** What one job's execution reports: the outcome, and what it created. */
export interface JobCompletion {
  result: unknown;
  created?: Record<string, unknown>;
}

/** What `executeJob` needs from the app, injected so tests can drive it
 *  without a webview. */
export interface JobDeps {
  /** The project as it is now, for the job to look at. The undo stacks
   *  ride along for the L3 undo/redo branches (DocumentState has none);
   *  the live state (store.get) already carries them. */
  getState: () => DocumentState & { past?: { label: string }[]; future?: { label: string }[] };
  /** Keep a successful live run on its analysis node, as the analysis view does. */
  cacheAnalysisResult: (id: string, result: AnalysisResult) => void;
  /** Publish an analysis outcome for `titer_read_results` (default: the real one). */
  publishResult?: (analysisId: string, outcome: unknown) => void;
  /** Run an analysis (default: the real `runAnalysis`). */
  run?: typeof runAnalysis;
  /** Create an analysis node on a table (default: the real store action). */
  createAnalysis?: (parentId: string, analysisType: AnalysisType, analysisParams?: AnalysisParams) => string;
  /** Rename any node (default: the real store action). */
  renameNode?: (id: string, name: string) => void;
  /** Freeze or unfreeze an analysis node (default: the real store action). */
  setAnalysisFrozen?: (id: string, frozen: boolean) => void;
  /** Load a project into the store (the import job replaces it). */
  loadProject?: DocumentDeps["loadProject"];
  /** Mark the project saved (the save job). */
  markSaved?: DocumentDeps["markSaved"];
  /** Headless document IO; defaults to the real native calls. */
  io?: DocumentIo;
  /** The project actions the table branches dispatch through (L3). The
   *  hook passes the real ones; a harness that drives only `noop` /
   *  `run-analysis` may omit them, and a table job then errors plainly.
   *  The graph / figure / info-sheet branches (L6) ride the same object:
   *  `renameNode` is shared, the rest are L6's. */
  actions?: {
    createTable: (tableType: TableType) => void;
    createTableWithData: (tableType: TableType, data: TableData, name: string) => void;
    updateTable: (id: string, data: TableData, label: string, move?: TableMove) => void;
    duplicateFamily: (id: string) => void;
    renameNode: (id: string, name: string) => void;
    removeNode: (id: string) => void;
    reorderTables: (order: string[]) => void;
    reorderChildren: (parentId: string, order: string[]) => void;
    undo: () => void;
    redo: () => void;
    createGraph: NonNullable<GraphJobDeps["createGraph"]>;
    updateGraph: NonNullable<GraphJobDeps["updateGraph"]>;
    cloneGraph: NonNullable<GraphJobDeps["cloneGraph"]>;
    createFigure: NonNullable<GraphJobDeps["createFigure"]>;
    updateFigure: NonNullable<GraphJobDeps["updateFigure"]>;
    createInfoSheet: NonNullable<GraphJobDeps["createInfoSheet"]>;
    updateInfoSheet: NonNullable<GraphJobDeps["updateInfoSheet"]>;
  };
  /** Wait for the store to settle after a dispatch, so a `getState()` read
   *  sees the dispatched change. In the app this is two macrotasks (React
   *  flushes the render + layout effects before them); a harness driving
   *  the reducer synchronously leaves it out (a no-op). */
  flush?: () => Promise<void>;
}

/** The document jobs' deps, from the job deps. */
function toDocumentDeps(deps: JobDeps): DocumentDeps {
  return {
    getState: deps.getState,
    loadProject:
      deps.loadProject ??
      (() => {
        throw new Error("This window can't load a project (no loadProject).");
      }),
    markSaved:
      deps.markSaved ??
      (() => {
        throw new Error("This window can't mark a project saved (no markSaved).");
      }),
    io: deps.io ?? defaultDocumentIo,
  };
}

/** The graph jobs' deps, from the job deps — the graph actions ride
 *  L3's shared `actions` object (a harness that omits it gets the
 *  plain "no store action" error from the graph module's `need`). */
function toGraphDeps(deps: JobDeps): GraphJobDeps {
  const a = deps.actions;
  return {
    getState: deps.getState,
    createGraph: a?.createGraph,
    updateGraph: a?.updateGraph,
    cloneGraph: a?.cloneGraph,
    createFigure: a?.createFigure,
    updateFigure: a?.updateFigure,
    createInfoSheet: a?.createInfoSheet,
    updateInfoSheet: a?.updateInfoSheet,
    renameNode: a?.renameNode,
  };
}

/** A job arg that must be a string when present (null reads as omitted —
 *  Rust sends `null` for an absent `Option`, and the dispatcher must not
 *  mistake that for a value). */
function optString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Job argument “${name}” must be a string.`);
  return value;
}

/** A job arg that must be a non-empty string. */
function reqString(value: unknown, name: string): string {
  const found = optString(value, name);
  if (found === undefined || found === "") throw new Error(`Job argument “${name}” is required.`);
  return found;
}

// ── Data-table actions (L3) ────────────────────────────────────────────
// The nine table tools run through the same dispatch as `run-analysis`,
// but they execute store calls, not R. The Rust side validates the args
// loosely from the snapshot before enqueueing; the branches below are the
// authority — they validate against live state and throw plain-language
// errors the awaiting tool returns as tool errors.

/** The seven table types, as the tools spell them. */
const TABLE_TYPES: TableType[] = ["column", "xy", "grouped", "nested", "multiple", "contingency", "survival"];

/** `job (action)` prefix for the table branches' plain-language errors. */
const jobErr = (job: McpJob, message: string) => new Error(`Job ${job.job_id} (${job.action}) ${message}`);

/** The table branches' store actions — a job without them cannot run. */
function tableActions(job: McpJob, deps: JobDeps): NonNullable<JobDeps["actions"]> {
  if (!deps.actions) throw jobErr(job, "needs the project actions — this dispatcher was built without them.");
  return deps.actions;
}

/** One arg, as a string — missing or the wrong type is a plain error. */
function argString(job: McpJob, args: unknown, key: string): string {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (typeof value !== "string" || !value) throw jobErr(job, `needs a ${key} string.`);
  return value;
}

/** One optional arg, as a string — present but the wrong type is an error. */
function argOptString(job: McpJob, args: unknown, key: string): string | undefined {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw jobErr(job, `needs ${key} to be a string.`);
  return value;
}

/** One arg, as a non-negative integer — missing, fractional or negative is an error. */
function argInt(job: McpJob, args: unknown, key: string, fallback?: number): number {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    throw jobErr(job, `needs a ${key} integer.`);
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw jobErr(job, `needs ${key} to be a non-negative integer, not ${JSON.stringify(value)}.`);
  }
  return value;
}

/** One arg, as a boolean — missing or the wrong type is an error. */
function argBool(job: McpJob, args: unknown, key: string): boolean {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (typeof value !== "boolean") throw jobErr(job, `needs ${key} to be true or false.`);
  return value;
}

/** One arg, as an array of strings — missing or mistyped is an error. */
function argStringArray(job: McpJob, args: unknown, key: string): string[] {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw jobErr(job, `needs ${key} to be an array of strings.`);
  }
  return value as string[];
}

/** The table type of a create-table job — one of the seven, spelled in full. */
function argTableType(job: McpJob, args: unknown): TableType {
  const value = argString(job, args, "table_type");
  if (!(TABLE_TYPES as string[]).includes(value)) {
    throw jobErr(job, `has no table type “${value}” — the types are ${TABLE_TYPES.join(", ")}.`);
  }
  return value as TableType;
}

/** A table node, by id — a missing node, or a node of another kind, is a plain error. */
function tableNode(job: McpJob, state: ReturnType<JobDeps["getState"]>, tableId: string): ProjectNode {
  const node = state.nodes[tableId];
  if (!node) throw jobErr(job, `has no table with id “${tableId}” in this project. Ask titer_list_tables for the ids.`);
  if (node.type !== "table") {
    throw jobErr(job, `“${tableId}” is not a table (it is a ${node.type}).`);
  }
  return node;
}

/** A node of any kind, by id. */
function anyNode(job: McpJob, state: ReturnType<JobDeps["getState"]>, nodeId: string): ProjectNode {
  const node = state.nodes[nodeId];
  if (!node) throw jobErr(job, `has no node with id “${nodeId}” in this project. Ask titer_list_projects for the ids.`);
  return node;
}

const plural = (n: number, word: string) => (n > 1 ? `${n} ${word}s` : word);

/** `count` empty rows, `width` columns wide. */
const emptyRows = (count: number, width: number): (string | null)[][] =>
  Array.from({ length: count }, () => Array<string | null>(width).fill(null));

/** One cell of a tool-supplied table: null, a string, or a finite number
 *  (written as its decimal text — the grid stores strings). An empty string
 *  reads as blank, as the grid writes it. Anything else is a plain error. */
function toolCell(job: McpJob, cell: unknown, where: string): string | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === "string") return cell === "" ? null : cell;
  if (typeof cell === "number" && Number.isFinite(cell)) return String(cell);
  throw jobErr(job, `has a cell at ${where} that is not a string, a number or null (${JSON.stringify(cell)}).`);
}

/**
 * The shape of a grouped table's columns: its groups, in order, each with
 *  its sub-column suffixes — or the plain-language reason the columns do
 *  not form one. A grouped table's columns are always "Group:Sub" shaped
 *  with every group holding the same sub-columns; anything else would
 *  break the grid's group headers, so it is an error, not a silent rebuild.
 */
function groupedShape(
  columns: string[],
  lead: number,
): { groups: string[]; replicates: number; suffixes: string[] } | { error: string } {
  const dataCols = columns.slice(lead);
  if (dataCols.length === 0) return { error: "needs at least one data column after the row-title column." };
  if (dataCols.some((n) => !n.includes(":"))) {
    return { error: "a grouped table's columns must be “Group:Sub-column” shaped (e.g. “A:Y1”), not plain names." };
  }
  const groups: string[] = [];
  const suffixesOf = new Map<string, string[]>();
  for (const name of dataCols) {
    const key = seriesKeyOf(name);
    const suffix = name.slice(name.indexOf(":") + 1);
    if (!suffix) return { error: `column “${name}” has an empty sub-column name.` };
    if (!suffixesOf.has(key)) {
      groups.push(key);
      suffixesOf.set(key, []);
    }
    suffixesOf.get(key)!.push(suffix);
  }
  const first = suffixesOf.get(groups[0])!;
  for (const group of groups.slice(1)) {
    const suffixes = suffixesOf.get(group)!;
    if (suffixes.length !== first.length || suffixes.some((s, i) => s !== first[i])) {
      return { error: `every group must hold the same sub-columns — group “${group}” holds ${suffixes.join(", ")}, but group “${groups[0]}” holds ${first.join(", ")}.` };
    }
  }
  return { groups, replicates: first.length, suffixes: first };
}

/**
 * The shape of a nested table's columns — "Group:Subgroup:R1" throughout,
 * every group holding the same subgroups and every subgroup the same
 * replicates — or the plain-language reason they do not form one.
 */
function nestedShape(
  columns: string[],
): { groups: string[]; subgroups: number; replicates: number } | { error: string } {
  const dataCols = columns.slice(1);
  if (dataCols.length === 0) return { error: "needs at least one data column after the row-title column." };
  const parts = dataCols.map((n) => n.split(":"));
  if (parts.some((p) => p.length !== 3 || p.some((s) => !s))) {
    return { error: "a nested table's columns must be “Group:Subgroup:R1” shaped (e.g. “A:S1:R1”)." };
  }
  const groups: string[] = [];
  const subsOf = new Map<string, string[]>();
  const repsOf = new Map<string, number>();
  for (const [g, s] of parts) {
    if (!subsOf.has(g)) {
      groups.push(g);
      subsOf.set(g, []);
    }
    if (!subsOf.get(g)!.includes(s)) subsOf.get(g)!.push(s);
    repsOf.set(`${g}:${s}`, (repsOf.get(`${g}:${s}`) ?? 0) + 1);
  }
  const subCounts = groups.map((g) => subsOf.get(g)!.length);
  if (subCounts.some((n) => n !== subCounts[0])) {
    return { error: "every group must hold the same subgroups." };
  }
  const repCounts = [...repsOf.values()];
  if (repCounts.some((n) => n !== repCounts[0])) {
    return { error: "every subgroup must hold the same number of replicates." };
  }
  return { groups, subgroups: subCounts[0], replicates: repCounts[0] };
}

/**
 * A grouped table's sub-column format, from its suffixes: a known summary
 *  format when every group's suffixes are that format's sub-columns
 *  ("Mean", "SD", "N"), replicates otherwise. Mirrors the load-time rule
 *  (project-file.ts): a summary format survives only when it fits its columns.
 */
function detectSummaryFormat(suffixes: string[]): SummaryFormat | undefined {
  for (const format of SUMMARY_FORMATS) {
    if (format.value === "replicates") continue;
    if (summarySubcolumns(format.value).join("\n") === suffixes.join("\n")) return format.value;
  }
  return undefined;
}

/**
 * A whole table from tool-supplied columns + rows, validated against the
 *  table type — the shape check `titer_write_table` (and
 *  `titer_create_table` with data) promises instead of writing a broken
 *  table. `base` is the table being replaced (write): its excluded-cell
 *  marks, row-group bands, column widths, error format, freeze flag and
 *  notes carry over; `excluded` replaces the marks when the call says so.
 *  A fresh table (create) starts with none of those.
 */
function buildTableData(
  job: McpJob,
  type: TableType,
  columnsIn: unknown,
  rowsIn: unknown,
  base?: TableData,
  excludedIn?: unknown,
): TableData {
  if (!Array.isArray(columnsIn) || columnsIn.length === 0) {
    throw jobErr(job, "needs columns to be a non-empty array of strings (column 0 is the row-title column).");
  }
  const columns: string[] = columnsIn.map((c, i) => {
    if (typeof c !== "string" || !c) {
      throw jobErr(job, `has a column at index ${i} that is not a non-empty string (${JSON.stringify(c)}).`);
    }
    return c;
  });
  if (new Set(columns).size !== columns.length) {
    const dup = columns.find((c, i) => columns.indexOf(c) !== i);
    throw jobErr(job, `has two columns named “${dup}” — column names must be unique.`);
  }
  if (!Array.isArray(rowsIn)) throw jobErr(job, "needs rows to be an array of arrays.");
  const rows: (string | null)[][] = rowsIn.map((row, r) => {
    if (!Array.isArray(row)) throw jobErr(job, `has a row at index ${r} that is not an array.`);
    if (row.length > columns.length) {
      throw jobErr(job, `has a row at index ${r} with ${row.length} cells but only ${columns.length} columns.`);
    }
    const cells = row.map((cell, c) => toolCell(job, cell, `row ${r}, column ${c}`));
    return [...cells, ...Array<string | null>(columns.length - cells.length).fill(null)];
  });

  // The structural fields, re-derived from the new columns (never trusted
  // from the call — a grouped table's groups are its column names).
  let groups: number | undefined;
  let replicates: number | undefined;
  let subgroups: number | undefined;
  let summaryFormat: SummaryFormat | undefined;
  if (type === "grouped") {
    const shape = groupedShape(columns, 1);
    if ("error" in shape) throw jobErr(job, shape.error);
    groups = shape.groups.length;
    replicates = shape.replicates;
    summaryFormat = detectSummaryFormat(shape.suffixes);
  } else if (type === "nested") {
    const shape = nestedShape(columns);
    if ("error" in shape) throw jobErr(job, shape.error);
    groups = shape.groups.length;
    subgroups = shape.subgroups;
    replicates = shape.replicates;
  } else if (type === "xy") {
    // An XY table's X stays first; the data sets after it may be grouped
    // ("A:Y1"…) or plain ("Y1", "Y2") — the columns decide, either way.
    const lead = columns[1]?.includes(":") ? 1 : 2;
    if (columns.length > lead) {
      const shape = groupedShape(columns, lead);
      if (!("error" in shape)) {
        groups = shape.groups.length;
        replicates = shape.replicates;
        summaryFormat = detectSummaryFormat(shape.suffixes);
      }
    }
  }

  const data: TableData = { columns, rows };
  if (groups !== undefined) data.groups = groups;
  if (replicates !== undefined) data.replicates = replicates;
  if (subgroups !== undefined) data.subgroups = subgroups;
  if (summaryFormat !== undefined) data.summaryFormat = summaryFormat;
  if (!base) return data;

  // A replace keeps what the call did not replace: the marks, the bands,
  // the widths, the error format, the freeze flag and the notes.
  const onCell = (k: unknown): k is string => {
    const [r, c] =
      typeof k === "string" && /^\d+,\d+$/.test(k) ? k.split(",").map(Number) : [Infinity, Infinity];
    return r < rows.length && c < columns.length && c >= 1;
  };
  if (excludedIn !== undefined) {
    if (!Array.isArray(excludedIn) || excludedIn.some((k) => typeof k !== "string")) {
      throw jobErr(job, "needs excluded to be an array of “row,col” strings.");
    }
    for (const key of excludedIn as string[]) {
      const [r, c] = /^\d+,\d+$/.test(key) ? key.split(",").map(Number) : [Infinity, Infinity];
      if (r >= rows.length || c >= columns.length || c < 1) {
        throw jobErr(job, `has an excluded cell “${key}” outside the new table (${rows.length} rows, ${columns.length} columns; column 0 is never excluded).`);
      }
      if (rows[r][c] === null) {
        throw jobErr(job, `has an excluded cell “${key}” holding no value — only cells with a value can be excluded.`);
      }
    }
    if ((excludedIn as string[]).length) data.excluded = [...(excludedIn as string[])];
  } else if (base.excluded) {
    const kept = base.excluded.filter(onCell);
    if (kept.length) data.excluded = kept;
  }
  if (base.rowGroups) {
    const oldCount = base.rows.length;
    if (rows.length === oldCount) {
      data.rowGroups = base.rowGroups;
    } else if (rows.length === 0) {
      // No rows left: the bands have nothing to tile.
    } else if (rows.length < oldCount) {
      data.rowGroups = shiftRowGroupsForDelete(base.rowGroups, rows.length, oldCount - rows.length);
    } else {
      data.rowGroups = growRowGroups(base.rowGroups, rows.length - oldCount);
    }
  }
  if (base.widths) {
    const widths = Object.fromEntries(Object.entries(base.widths).filter(([name]) => columns.includes(name)));
    if (Object.keys(widths).length) data.widths = widths;
  }
  if (base.errorFormat) data.errorFormat = base.errorFormat;
  if (base.freezeTitle) data.freezeTitle = true;
  if (base.notes) data.notes = base.notes;
  return data;
}

/** Whether two orders list the same ids (a reorder that moved nothing). */
const ordersEqual = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** `order` must list exactly `current` — same ids, any order — or a plain error naming the gap. */
function checkExactOrder(job: McpJob, order: string[], current: string[], what: string): void {
  const missing = current.filter((id) => !order.includes(id));
  const extra = order.filter((id) => !current.includes(id));
  if (missing.length || extra.length) {
    const parts: string[] = [];
    if (missing.length) parts.push(`missing ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}`);
    if (extra.length) parts.push(`unknown ${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ` (+${extra.length - 3} more)` : ""}`);
    throw jobErr(job, `has an order that does not list exactly ${what} (${current.length} items): ${parts.join("; ")}.`);
  }
  if (new Set(order).size !== order.length) {
    throw jobErr(job, `has an order listing an id twice — each child appears once.`);
  }
}

/** Execute one job. Throws with a plain-language message when the job
 *  cannot run — the dispatcher reports that as the job's error. */
export async function executeJob(job: McpJob, deps: JobDeps): Promise<JobCompletion> {
  switch (job.action) {
    case "noop":
      // The L0 stub: proves the Rust→frontend→Rust round-trip end to end.
      return { result: { ok: true } };
    case "create-analysis": {
      // L4: create the analysis node (the `titer_run_analysis` tool awaits
      // this job — creation is synchronous store work, so param errors
      // surface as tool errors — then enqueues `run-analysis` separately,
      // because a run is unbounded in time (GAP-6) and returns a job_id to
      // poll instead).
      const args = (job.args ?? {}) as {
        table_id?: unknown;
        analysis_type?: unknown;
        params?: unknown;
        name?: unknown;
      };
      const tableId = reqString(args.table_id, "table_id");
      const analysisType = reqString(args.analysis_type, "analysis_type");
      if (analysisType === "compare-many-groups") {
        throw new Error(
          "“compare-many-groups” is the picker's wizard value, not an analysis — pass a concrete type: \"anova\", \"kruskal-wallis\", \"rm-anova\" or \"friedman\".",
        );
      }
      if (analysisType === "interpolate") {
        throw new Error(
          "“interpolate” is the picker's wizard value, not an analysis — pass analysis_type \"nonlinear-regression\" with params.interpolate set.",
        );
      }
      if (!Object.hasOwn(ANALYSES, analysisType)) {
        throw new Error(
          `Unknown analysis type “${analysisType}”. Valid analysis types: ${Object.keys(ANALYSES).join(", ")}.`,
        );
      }
      const type = analysisType as AnalysisType;
      const state = deps.getState();
      const table = state.nodes[tableId];
      if (!table || table.type !== "table") {
        throw new Error(`No table with id “${tableId}” in this project.`);
      }
      // The picker offers each test only for the table types it makes sense
      // on — the same gate, so an agent gets the valid list instead of a
      // runner error on data it cannot use.
      const data = table.data;
      const tableType = table.tableType;
      if (tableType === undefined) {
        throw new Error(`Table “${tableId}” has no table type recorded.`);
      }
      const offered = analysisOptionsForTable(tableType, data).map((o) => o.value);
      if (!offered.includes(type)) {
        if (type === "three-way-anova" && !hasRowGroups(data)) {
          throw new Error("“three-way-anova” needs a Grouped table with at least 2 row bands — this table has none.");
        }
        if (type === "nested-t-test" && countDataGroups(data) !== 2) {
          throw new Error(
            `“nested-t-test” needs a Nested table with exactly 2 data groups — this table has ${countDataGroups(data)}.`,
          );
        }
        if (type === "nested-anova" && countDataGroups(data) < 3) {
          throw new Error(
            `“nested-anova” needs a Nested table with at least 3 data groups — this table has ${countDataGroups(data)}.`,
          );
        }
        const offeredLabel = (v: string) =>
          v === "compare-many-groups"
            ? "compare-many-groups (→ anova, kruskal-wallis, rm-anova, friedman)"
            : v === "interpolate"
              ? "interpolate (→ nonlinear-regression with params.interpolate)"
              : v;
        throw new Error(
          `“${type}” is not offered for ${tableType} tables. ${tableType} tables offer: ${offered.map(offeredLabel).join(", ")}.`,
        );
      }
      const { errors, params } = validateAnalysisParams(type, args.params);
      if (errors.length) throw new Error(errors.join(" "));
      const create =
        deps.createAnalysis ??
        (() => {
          throw new Error("This window can't create analyses (no createAnalysis).");
        });
      const id = create(tableId, type, params);
      const name = optString(args.name, "name");
      if (name !== undefined) {
        if (name === "") throw new Error(`Job argument “name” must not be empty.`);
        const rename =
          deps.renameNode ??
          (() => {
            throw new Error("This window can't rename nodes (no renameNode).");
          });
        rename(id, name);
      }
      return {
        result: { analysis_id: id, analysis_type: type, table_id: tableId },
        created: { analysis_id: id, analysis_type: type },
      };
    }
    case "run-analysis": {
      const analysisId = (job.args as { analysis_id?: unknown } | null | undefined)?.analysis_id;
      if (typeof analysisId !== "string" || !analysisId) {
        throw new Error(`Job ${job.job_id} (run-analysis) has no analysis_id.`);
      }
      const state = deps.getState();
      const node = state.nodes[analysisId];
      if (!node || node.type !== "analysis") {
        throw new Error(`No analysis with id “${analysisId}” in this project.`);
      }
      if (node.frozen) {
        throw new Error(`Analysis “${node.name}” is frozen — unfreeze it before running it again.`);
      }
      const type = node.analysisType;
      const parent = node.parentId ? state.nodes[node.parentId] : undefined;
      const data = parent?.type === "table" ? parent.data : undefined;
      if (!type || !data) {
        throw new Error(`Analysis “${node.name}” has no table to run on.`);
      }
      // Info-constant hooks resolve live, exactly as the analysis view
      // does — a hook that can't resolve is an error, never a guessed number.
      const sheets = infoSheetsOf(state.nodes, state.rootOrder);
      const resolved = resolveAnalysisParams(node.analysisParams, type, sheets);
      if ("error" in resolved) throw new Error(resolved.error);
      const outcome = await (deps.run ?? runAnalysis)(type, data, resolved.params);
      (deps.publishResult ?? publishAnalysisResult)(analysisId, outcome);
      if (!("error" in outcome)) deps.cacheAnalysisResult(analysisId, outcome);
      return { result: outcome, created: { analysis_id: analysisId } };
    }
    case "freeze-analysis": {
      // L4: `setAnalysisFrozen` — a frozen result survives later data edits;
      // unfreezing re-runs on next read (the analysis view's behaviour, not
      // this job's: nothing re-runs here).
      const args = (job.args ?? {}) as { analysis_id?: unknown; frozen?: unknown };
      const analysisId = reqString(args.analysis_id, "analysis_id");
      if (typeof args.frozen !== "boolean") {
        throw new Error(`Job argument “frozen” must be true or false.`);
      }
      const state = deps.getState();
      const node = state.nodes[analysisId];
      if (!node || node.type !== "analysis") {
        throw new Error(
          node
            ? `“${analysisId}” is not an analysis (it is a ${node.type}).`
            : `No analysis with id “${analysisId}” in this project.`,
        );
      }
      if (node.orphaned) {
        throw new Error(
          `Analysis “${node.name}” is orphaned (its table was deleted) — orphaned analyses can't be frozen.`,
        );
      }
      const freeze =
        deps.setAnalysisFrozen ??
        (() => {
          throw new Error("This window can't freeze analyses (no setAnalysisFrozen).");
        });
      freeze(analysisId, args.frozen);
      return {
        result: { project_id: job.project_id, analysis_id: analysisId, frozen: args.frozen },
        created: { analysis_id: analysisId },
      };
    }
    case "save-project": {
      // L2: write the project (GAP-4 — the TS writers build the bytes, Rust
      // only ever wrote them) and mark it saved. The job's result is the
      // tool's output.
      const args = (job.args ?? {}) as { path?: unknown; format?: unknown };
      return executeSaveProject(
        toDocumentDeps(deps),
        { path: optString(args.path, "path"), format: optString(args.format, "format") },
        job.project_id,
      );
    }
    case "import-prism": {
      // L2: read a Prism file and load it as this window's project — the
      // same as File ▸ Import Prism File, minus the dialog.
      const args = (job.args ?? {}) as { path?: unknown };
      return executeImportPrism(toDocumentDeps(deps), { path: reqString(args.path, "path") }, job.project_id);
    }
    case "close-project": {
      // L2: settle the save question, then arm the close bypass — Rust
      // closes the window once this job reports done. A dirty project with
      // no `save` answers `needs_confirm` instead of closing.
      const args = (job.args ?? {}) as { save?: unknown };
      return executeCloseProject(toDocumentDeps(deps), { save: optString(args.save, "save") }, job.project_id);
    }
    case "create-table": {
      const actions = tableActions(job, deps);
      const type = argTableType(job, job.args);
      const name = argOptString(job, job.args, "name");
      if (name !== undefined && !name.trim()) throw jobErr(job, "needs a non-empty name.");
      const hasColumns = (job.args as Record<string, unknown> | null | undefined)?.columns !== undefined;
      const hasRows = (job.args as Record<string, unknown> | null | undefined)?.rows !== undefined;
      const before = new Set(deps.getState().rootOrder);
      if (!hasColumns && !hasRows) {
        // The empty table of that type — Table ▸ New Table, with its defaults.
        if (name !== undefined) actions.createTableWithData(type, TABLES[type].defaultData(), name);
        else actions.createTable(type);
      } else {
        if (!hasColumns || !hasRows) {
          throw jobErr(job, "needs columns and rows together — pass both, or neither for an empty table.");
        }
        const data = buildTableData(job, type, (job.args as Record<string, unknown>).columns, (job.args as Record<string, unknown>).rows);
        actions.createTableWithData(type, data, name ?? "Table");
      }
      await deps.flush?.();
      const after = deps.getState();
      const createdId =
        after.activeNodeId && !before.has(after.activeNodeId) && after.nodes[after.activeNodeId]?.type === "table"
          ? after.activeNodeId
          : after.rootOrder.find((id) => !before.has(id) && after.nodes[id]?.type === "table");
      if (!createdId) {
        throw jobErr(job, "created the table but its id could not be read back — ask titer_list_tables for the new table.");
      }
      const created = after.nodes[createdId]!;
      const rows = created.data?.rows.length ?? 0;
      const dataColumns = (created.data?.columns.length ?? 1) - 1;
      return {
        result: {
          project_id: job.project_id,
          table_id: createdId,
          name: created.name,
          table_type: TABLES[type].label,
          rows,
          data_columns: dataColumns,
        },
        created: { table_id: createdId },
      };
    }
    case "write-table": {
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const node = tableNode(job, deps.getState(), tableId);
      const type = node.tableType ?? "column";
      const columns = (job.args as Record<string, unknown> | null | undefined)?.columns;
      const rows = (job.args as Record<string, unknown> | null | undefined)?.rows;
      if (columns === undefined || rows === undefined) {
        throw jobErr(job, "needs columns and rows (the whole table).");
      }
      const label = argOptString(job, job.args, "label") ?? "Edit Table";
      const excluded = (job.args as Record<string, unknown> | null | undefined)?.excluded;
      const data = buildTableData(job, type, columns, rows, node.data, excluded);
      if (JSON.stringify(data) === JSON.stringify(node.data)) {
        // The same table back: no undo step, no dirty flag.
        return {
          result: {
            project_id: job.project_id,
            table_id: tableId,
            rows: data.rows.length,
            data_columns: data.columns.length - 1,
          },
        };
      }
      actions.updateTable(tableId, data, label);
      await deps.flush?.();
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          rows: data.rows.length,
          data_columns: data.columns.length - 1,
        },
      };
    }
    case "edit-table": {
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const op = argString(job, job.args, "op");
      const state = deps.getState();
      const node = tableNode(job, state, tableId);
      const type = node.tableType ?? "column";
      const data = node.data ?? { columns: ["Title"], rows: [] };
      // One grid-menu op: a new TableData via the table-data.ts helpers,
      // the Undo label the grid uses, and the `move` that lets the table's
      // analyses and graphs follow renames and row moves. `next === data`
      // is a helper refusing the op — a plain error, never a silent no-op
      // dispatch (which would still cost an undo step).
      let next: TableData | null = null;
      let label = "";
      let move: TableMove | undefined;
      switch (op) {
        case "insert-rows": {
          const at = argInt(job, job.args, "at");
          const count = argInt(job, job.args, "count", 1);
          if (count < 1) throw jobErr(job, "needs count to be at least 1.");
          if (at > data.rows.length) {
            throw jobErr(job, `has no row ${at} to insert above — the table holds ${data.rows.length} stored rows.`);
          }
          label = `Insert ${plural(count, "Row")}`;
          move = { rows: rowsInserted(at, count) };
          next =
            at < data.rows.length
              ? insertRows(data, at, count)
              : {
                  ...data,
                  rows: [...data.rows, ...emptyRows(count, data.columns.length)],
                  rowGroups: data.rowGroups ? growRowGroups(data.rowGroups, count) : undefined,
                };
          break;
        }
        case "delete-rows": {
          const at = argInt(job, job.args, "at");
          const count = argInt(job, job.args, "count", 1);
          if (count < 1) throw jobErr(job, "needs count to be at least 1.");
          if (at >= data.rows.length) {
            throw jobErr(job, `has no row ${at} to delete — the table holds ${data.rows.length} stored rows.`);
          }
          const n = Math.min(count, data.rows.length - at);
          label = `Delete ${plural(n, "Row")}`;
          move = { rows: rowsDeleted(at, n) };
          next = deleteRows(data, at, n);
          break;
        }
        case "insert-columns": {
          if (isGrouped(data) || isNested(data)) {
            throw jobErr(job, "cannot insert a column into a grouped or nested table — its columns come from its groups, not from inserts.");
          }
          const at = argInt(job, job.args, "at");
          const count = argInt(job, job.args, "count", 1);
          if (count < 1) throw jobErr(job, "needs count to be at least 1.");
          if (at < 1 || at > data.columns.length) {
            throw jobErr(job, `has no column ${at} to insert before — columns run 1 to ${data.columns.length} (column 0 is the row titles).`);
          }
          label = `Insert ${plural(count, "Column")}`;
          next = insertColumns(data, at, count, type);
          break;
        }
        case "delete-columns": {
          if (isGrouped(data) || isNested(data)) {
            throw jobErr(job, "cannot delete a column from a grouped or nested table — its columns come from its groups, not from deletes.");
          }
          const at = argInt(job, job.args, "at");
          const count = argInt(job, job.args, "count", 1);
          if (count < 1) throw jobErr(job, "needs count to be at least 1.");
          if (at < 1 || at >= data.columns.length) {
            throw jobErr(job, `has no column ${at} to delete — data columns run 1 to ${data.columns.length - 1} (column 0 is the row titles).`);
          }
          next = deleteColumns(data, at, count);
          if (next === data) throw jobErr(job, "cannot delete the table's last data column — a table keeps at least one.");
          label = `Delete ${plural(data.columns.length - next.columns.length, "Column")}`;
          break;
        }
        case "rename-column": {
          const column = argInt(job, job.args, "column");
          const name = argString(job, job.args, "name");
          if (column >= data.columns.length) {
            throw jobErr(job, `has no column ${column} — the table has ${data.columns.length} columns (0 is the row titles).`);
          }
          const old = data.columns[column];
          if (name === old) break; // already that name: no-op success, no undo step
          if (!name.trim()) throw jobErr(job, "needs a non-empty column name.");
          if (data.columns.includes(name)) throw jobErr(job, `has a column named “${name}” already.`);
          label = "Rename Column";
          move = { renamed: { [old]: name } };
          next = renameColumn(data, column, name);
          if (next === data) throw jobErr(job, `cannot rename column ${column} to “${name}”.`);
          break;
        }
        case "rename-group": {
          if (!isGrouped(data) && !isNested(data)) {
            throw jobErr(job, "cannot rename a group — only grouped and nested tables have groups.");
          }
          const column = argInt(job, job.args, "column");
          const name = argString(job, job.args, "name");
          if (column < leadOf(data) || column >= data.columns.length) {
            throw jobErr(job, `has no group at column ${column} — the groups start at column ${leadOf(data)}.`);
          }
          const oldKey = seriesKeyOf(data.columns[column]);
          if (name === oldKey) break; // already that name: no-op success
          if (!name.trim() || name.includes(":")) {
            throw jobErr(job, "needs a non-empty group name without a “:” in it.");
          }
          if (data.columns.some((n) => seriesKeyOf(n) === name)) {
            throw jobErr(job, `has a group named “${name}” already.`);
          }
          label = "Rename Group";
          move = { renamed: { [oldKey]: name } };
          next = renameGroup(data, oldKey, name);
          if (next === data) throw jobErr(job, `cannot rename group “${oldKey}” to “${name}”.`);
          break;
        }
        case "exclude-cells":
        case "include-cells": {
          const include = op === "include-cells";
          const cells = argStringArray(job, job.args, "cells");
          if (cells.length === 0) throw jobErr(job, "needs at least one cell in cells.");
          const keys: string[] = [];
          for (const key of cells) {
            const [r, c] = /^\d+,\d+$/.test(key) ? key.split(",").map(Number) : [Infinity, Infinity];
            if (r >= data.rows.length || c >= data.columns.length || c < 1) {
              throw jobErr(job, `has a cell “${key}” outside the table (${data.rows.length} rows, ${data.columns.length} columns; column 0 is never excluded).`);
            }
            if (!include && data.rows[r][c] === null) {
              throw jobErr(job, `cannot exclude cell “${key}” — it holds no value, and an excluded empty cell would stay marked when a value is typed there later.`);
            }
            keys.push(`${r},${c}`);
          }
          label = include ? "Include in Analysis" : "Exclude from Analysis";
          const kept = new Set(data.excluded ?? []);
          for (const key of keys) {
            if (include) kept.delete(key);
            else kept.add(key);
          }
          const sorted = [...kept].sort((a, b) => {
            const [ar, ac] = a.split(",").map(Number);
            const [br, bc] = b.split(",").map(Number);
            return ar - br || ac - bc;
          });
          next = { ...data, excluded: sorted.length ? sorted : undefined };
          break;
        }
        case "freeze-title": {
          const frozen = argBool(job, job.args, "frozen");
          if ((data.freezeTitle ?? false) === frozen) break; // already that way: no-op success
          label = "Keep Visible";
          next = { ...data, freezeTitle: frozen ? true : undefined };
          break;
        }
        case "convert-comma-decimals": {
          if (!hasCommaDecimals(data)) break; // nothing to convert: no-op success
          label = "Convert Decimal Commas to Points";
          next = convertCommaDecimals(data);
          break;
        }
        default:
          throw jobErr(
            job,
            `has no edit op “${op}” — the ops are insert-rows, delete-rows, insert-columns, delete-columns, rename-column, rename-group, exclude-cells, include-cells, freeze-title, convert-comma-decimals.`,
          );
      }
      if (next === null) {
        // A vacuous op (already that name, already frozen, nothing to
        // convert): success, no dispatch, no undo step.
        return {
          result: {
            project_id: job.project_id,
            table_id: tableId,
            rows: data.rows.length,
            data_columns: data.columns.length - 1,
          },
        };
      }
      actions.updateTable(tableId, next, label, move);
      await deps.flush?.();
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          rows: next.rows.length,
          data_columns: next.columns.length - 1,
        },
      };
    }
    case "duplicate-family": {
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const state = deps.getState();
      tableNode(job, state, tableId);
      const before = new Set(state.rootOrder);
      actions.duplicateFamily(tableId);
      await deps.flush?.();
      const after = deps.getState();
      const createdId =
        after.activeNodeId && !before.has(after.activeNodeId) && after.nodes[after.activeNodeId]?.type === "table"
          ? after.activeNodeId
          : after.rootOrder.find((id) => !before.has(id) && after.nodes[id]?.type === "table");
      if (!createdId) {
        throw jobErr(job, "duplicated the table but its id could not be read back — ask titer_list_tables for the new table.");
      }
      const children = (after.childOrder?.[createdId] ?? [])
        .map((id) => after.nodes[id])
        .filter((n): n is ProjectNode => n !== undefined);
      return {
        result: {
          project_id: job.project_id,
          table_id: createdId,
          children: {
            analyses: children.filter((n) => n.type === "analysis").map((n) => n.id),
            graphs: children.filter((n) => n.type === "graph").map((n) => n.id),
          },
        },
        created: { table_id: createdId },
      };
    }
    case "rename-node": {
      const actions = tableActions(job, deps);
      const nodeId = argString(job, job.args, "node_id");
      const name = argString(job, job.args, "name");
      const node = anyNode(job, deps.getState(), nodeId);
      if (!name.trim()) throw jobErr(job, "needs a non-empty name.");
      if (node.name !== name) {
        actions.renameNode(nodeId, name);
        await deps.flush?.();
      }
      return { result: { project_id: job.project_id, node_id: nodeId, name } };
    }
    case "delete-node": {
      const actions = tableActions(job, deps);
      const nodeId = argString(job, job.args, "node_id");
      const state = deps.getState();
      const node = anyNode(job, state, nodeId);
      if (node.type === "table") {
        const tables = state.rootOrder.filter((id) => state.nodes[id]?.type === "table");
        if (tables.length <= 1) {
          throw jobErr(
            job,
            `cannot delete table “${node.name}” — it is the last table in the project, and a project always has at least one table.`,
          );
        }
      }
      actions.removeNode(nodeId);
      await deps.flush?.();
      return { result: { project_id: job.project_id, node_id: nodeId, deleted: true } };
    }
    case "reorder-nodes": {
      const actions = tableActions(job, deps);
      const order = argStringArray(job, job.args, "order");
      const parentId = argOptString(job, job.args, "parent_id");
      const state = deps.getState();
      if (parentId === undefined) {
        checkExactOrder(job, order, state.rootOrder, "the project's root items");
        if (!ordersEqual(order, state.rootOrder)) {
          actions.reorderTables(order);
          await deps.flush?.();
        }
      } else {
        const parent = anyNode(job, state, parentId);
        if (parent.type !== "table") {
          throw jobErr(job, `cannot reorder the children of “${parentId}” — only a table has children to reorder (it is a ${parent.type}).`);
        }
        const current = state.childOrder?.[parentId] ?? [];
        checkExactOrder(job, order, current, `the children of table “${parent.name}”`);
        if (!ordersEqual(order, current)) {
          actions.reorderChildren(parentId, order);
          await deps.flush?.();
        }
      }
      return { result: { project_id: job.project_id, order } };
    }
    case "undo": {
      const actions = tableActions(job, deps);
      const state = deps.getState();
      const undone = state.past?.at(-1)?.label ?? null;
      if (undone === null) {
        return { result: { project_id: job.project_id, undone: null, can_redo: (state.future?.length ?? 0) > 0 } };
      }
      actions.undo();
      await deps.flush?.();
      const after = deps.getState();
      return { result: { project_id: job.project_id, undone, can_redo: (after.future?.length ?? 0) > 0 } };
    }
    case "redo": {
      const actions = tableActions(job, deps);
      const state = deps.getState();
      const redone = state.future?.at(-1)?.label ?? null;
      if (redone === null) {
        return { result: { project_id: job.project_id, redone: null, can_undo: (state.past?.length ?? 0) > 0 } };
      }
      actions.redo();
      await deps.flush?.();
      const after = deps.getState();
      return { result: { project_id: job.project_id, redone, can_undo: (after.past?.length ?? 0) > 0 } };
    }
    // L6 — graph / figure / info-sheet tools (src/store/mcp-graphs.ts):
    // the branches validate against live state and throw plain-language
    // errors the awaiting tool returns as tool errors. Action names are
    // kebab-case, one per tool; see the lane log for the table.
    case "build-graph":
      return executeBuildGraph(job, toGraphDeps(deps));
    case "update-graph":
      return executeUpdateGraph(job, toGraphDeps(deps));
    case "clone-graph":
      return executeCloneGraph(job, toGraphDeps(deps));
    case "create-figure":
      return executeCreateFigure(job, toGraphDeps(deps));
    case "update-figure":
      return executeUpdateFigure(job, toGraphDeps(deps));
    case "create-info-sheet":
      return executeCreateInfoSheet(job, toGraphDeps(deps));
    case "update-info-sheet":
      return executeUpdateInfoSheet(job, toGraphDeps(deps));
    default:
      throw new Error(`Unknown job action “${job.action}”.`);
  }
}

/** The dispatcher: claims this window's jobs and runs them, one at a time.
 *  Mounted once, in AppShell, next to `useMcpSnapshotPublisher` (same
 *  pattern, same place). A no-op where there is no native shell (web
 *  preview, tests). */
export function useMcpJobDispatcher() {
  const store = useProjectStore();
  const actions = useProjectActions();
  // Captured once: both read the latest state through refs (`get` reads
  // `latest.current`; the actions are memoised once in the provider), so
  // the effect below mounts once and never goes stale.
  const getState = store.get;
  const cacheAnalysisResult = actions.cacheAnalysisResult;
  const createAnalysis = actions.createAnalysis;
  const renameNode = actions.renameNode;
  const setAnalysisFrozen = actions.setAnalysisFrozen;
  const loadProject = actions.loadProject;
  const markSaved = actions.markProjectSaved;
  // The table branches dispatch through these actions; after a dispatch
  // they need the store to have settled before reading the new state
  // back (a created table's id, an undo label) — two macrotasks, by which
  // time React has flushed the render and the layout effects that keep
  // `latest` current.
  const flush = () => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));  // Jobs already handed to an execution: the frontend side of the
  // once-only discipline (Rust's `take_jobs` is the other half — a job
  // claimed there is never handed out again, and a job seen here is never
  // executed again).
  const seenRef = React.useRef(new Set<string>());
  // The job executing now, if any — the cancel event's target.
  const runningRef = React.useRef<{ jobId: string; action: string } | null>(null);

  React.useEffect(() => {
    if (!isNative) return;
    let stopped = false;
    let busy = false;
    let pending = false;

    /** Claim every queued job and run it, in order, one at a time. */
    const drain = async () => {
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        while (!stopped) {
          pending = false;
          let jobs: McpJob[];
          try {
            jobs = await mcpTakeJobs();
          } catch {
            return;
          }
          for (const job of jobs) {
            if (stopped) return;
            if (seenRef.current.has(job.job_id)) continue;
            seenRef.current.add(job.job_id);
            runningRef.current = { jobId: job.job_id, action: job.action };
            try {
              const { result, created } = await executeJob(job, {
                getState,
                cacheAnalysisResult,
                createAnalysis,
                renameNode,
                setAnalysisFrozen,
                loadProject,
                markSaved,
                actions,
                flush,
              });
              // A completion report is always sent; Rust ignores it for a
              // job that is already terminal (a cancel that landed first).
              await mcpCompleteJob(job.job_id, "done", result, undefined, created).catch(() => {});
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              await mcpCompleteJob(job.job_id, "error", undefined, message, undefined).catch(() => {});
            } finally {
              if (runningRef.current?.jobId === job.job_id) runningRef.current = null;
            }
          }
          if (!pending) return;
        }
      } finally {
        busy = false;
      }
    };

    void drain(); // Jobs queued before this window mounted.
    let offRun: (() => void) | undefined;
    let offCancel: (() => void) | undefined;
    void onMcpRunJob(() => void drain()).then((off) => {
      offRun = off;
    });
    // A running job's cancel maps to the `cancel_r` path: only this job's
    // R work is live (serial dispatch), so dropping this window's waiting
    // requests drops that job's work and nothing else. The run's rejection
    // is reported as an error, which Rust discards — the job is already
    // `cancelled` there.
    void onMcpCancelJob((jobId) => {
      const running = runningRef.current;
      if (running?.jobId === jobId && running.action === "run-analysis") {
        void cancelR();
      }
    }).then((off) => {
      offCancel = off;
    });
    return () => {
      stopped = true;
      offRun?.();
      offCancel?.();
    };
    // `getState` / `cacheAnalysisResult` are captured above and read the
    // latest state through refs, so this effect mounts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
