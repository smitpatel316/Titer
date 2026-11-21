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
import {
  SIMULATION_DISTRIBUTIONS,
  type SimulationDistribution,
  type SimulationSpec,
} from "../stats/types";
import { simulateTableData, validateSimulationSpec } from "../stats/simulation/simulate";
import { repointCandidates } from "../lib/repoint-analysis";
import { parseProjectText, validateAnalysisParams } from "../lib/project-file";
import { fileName, fileTitle } from "../lib/paths";
import { importTabularFile } from "../lib/tabular-import";
import { extractMethod, methodForTable, remapGraphOptions } from "../lib/template";
import { TEMPLATES, planTemplateApply, templateById } from "../lib/templates";
import { runScript } from "../lib/prism-script";
import type { WandReport } from "../lib/wand";
import { analysisOptionsForTable, analysisTypesOfferedForTable, countDataGroups, hasRowGroups } from "../views/analyses";
import {
  defaultDocumentIo,
  executeCloseProject,
  executeImportPrism,
  executeMergeProject,
  executeSaveProject,
  readFileWithTimeout,
  type DocumentDeps,
  type DocumentIo,
  type DocumentState,
  type MergeDeps,
} from "./mcp-document";
import {
  executeAddDrawingObject,
  executeArrangeDrawingObjects,
  executeBuildGraph,
  executeCloneGraph,
  executeCreateFigure,
  executeCreateInfoSheet,
  executeDeleteDrawingObject,
  executeFreezeFigure,
  executeFreezeGraph,
  executeUpdateDrawingObject,
  executeUpdateFigure,
  executeUpdateGraph,
  executeUpdateInfoSheet,
  type GraphJobDeps,
} from "./mcp-graphs";
import {
  defaultExportIo,
  executeExportAllGraphs,
  executeExportFigure,
  executeExportGraph,
  executeExportOffice,
  executeExportTableData,
  type ExportIo,
  type ExportJobDeps,
} from "./mcp-export";
import {
  cancelR,
  isNative,
  mcpCompleteJob,
  mcpTakeJobs,
  onMcpCancelJob,
  onMcpRunJob,
  readDataBytes,
  readDataText,
  type McpJob,
} from "../native";
import { publishAnalysisResult, publishMcpSnapshotNow } from "./mcp-publish";
import { useProjectActions, useProjectStore } from "./use-project-store";
import type { ProjectNode, RowGroup, TableData, TableType } from "./types";
import type { TableMove } from "./references";
import { groupsOf, isGrouped, isNested, leadOf, readTable, setColumns } from "../lib/dataset";
import {
  addCalculatedVariable,
  isCalculatedColumn,
  removeCalculatedVariable,
  setCalculatedFormula,
} from "../lib/calcvars";
import { seriesKeyOf } from "../lib/columns";
import {
  applyLinkedBlock,
  isLinkedSourcePath,
  linkedPasteKindOf,
  parseLinkedSource,
  refreshLinked,
  type LinkedPaste,
} from "../lib/linked-paste";
import { fillSeries, generateSeries, validateSeriesSpec, type SeriesMode } from "../lib/series";
import { SUMMARY_FORMATS, summaryFormatOf, summarySubcolumns, type SummaryFormat } from "../lib/summary-format";
import {
  applySummaryFormat,
  applySummaryFormatNested,
  applySummaryFormatXY,
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
  transposeBlock,
  writeBlock,
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
  /** Freeze or unfreeze a table node (default: the real store action). */
  setTableFrozen?: (id: string, frozen: boolean) => void;
  /** Replace an analysis node's params (default: the real store action). */
  setAnalysisParams?: (id: string, params: AnalysisParams) => void;
  /** Copy an example table's analyses + graphs onto target tables, as one
   *  undo step (default: the real store action). Returns the per-table
   *  report. */
  applyWand?: (exampleId: string, targetIds: string[], prefix: string) => WandReport;
  /** Replace the whole project with a script run's result, as one undo
   *  step (default: the real store action). */
  applyScript?: (doc: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
    projectName?: string;
  }) => void;
  /** Load a project into the store (the import job replaces it). */
  loadProject?: DocumentDeps["loadProject"];
  /** Append another project's sheets to this one, as one undo step (the
   *  merge job — File ▸ Merge, seq 180). */
  mergeProject?: MergeDeps["mergeProject"];
  /** Mark the project saved (the save job). */
  markSaved?: DocumentDeps["markSaved"];
  /** Headless document IO; defaults to the real native calls. */
  io?: DocumentIo;
  /** Headless export IO; defaults to the real `write_file` call. A
   *  harness driving the table-data jobs in node injects a stub here. */
  exportIo?: ExportIo;
  /** Read a linked-paste source file (default: the real native reads — text
   *  for delimited files, bytes for `.xlsx`). A harness driving the linked
   *  jobs in node injects a stub here. */
  readLinkedSource?: (sourcePath: string, kind: "csv" | "xlsx") => Promise<string | Uint8Array>;
  /** The project actions the table branches dispatch through (L3). The
   *  hook passes the real ones; a harness that drives only `noop` /
   *  `run-analysis` may omit them, and a table job then errors plainly.
   *  The graph / figure / info-sheet branches (L6) ride the same object:
   *  `renameNode` is shared, the rest are L6's. */
  actions?: {
    createTable: (tableType: TableType) => void;
    createTableWithData: (tableType: TableType, data: TableData, name: string) => void;
    /** A table of simulated values ("Simulated data", numbered). */
    createSimulatedTable: (tableType: TableType, data: TableData) => void;
    updateTable: (id: string, data: TableData, label: string, move?: TableMove) => void;
    duplicateFamily: (id: string) => void;
    /** Duplicate one sheet, nothing else (seq 236). */
    duplicateNode: (id: string) => void;
    renameNode: (id: string, name: string) => void;
    removeNode: (id: string) => void;
    reorderTables: (order: string[]) => void;
    reorderChildren: (parentId: string, order: string[]) => void;
    undo: () => void;
    redo: () => void;
    createGraph: NonNullable<GraphJobDeps["createGraph"]>;
    updateGraph: NonNullable<GraphJobDeps["updateGraph"]>;
    setGraphSources: NonNullable<GraphJobDeps["setGraphSources"]>;
    /** Move an orphaned analysis under a table that offers its test (seq 242). */
    repointAnalysis: (id: string, tableId: string) => void;
    /** Change a graph's type, keeping its title and size (seq 244). */
    changeGraphType: NonNullable<GraphJobDeps["changeGraphType"]>;
    cloneGraph: NonNullable<GraphJobDeps["cloneGraph"]>;
    createFigure: NonNullable<GraphJobDeps["createFigure"]>;
    updateFigure: NonNullable<GraphJobDeps["updateFigure"]>;
    createInfoSheet: NonNullable<GraphJobDeps["createInfoSheet"]>;
    updateInfoSheet: NonNullable<GraphJobDeps["updateInfoSheet"]>;
    /** Append another project's sheets, as one undo step (the merge job). */
    mergeProject: MergeDeps["mergeProject"];
    /** Freeze (or unfreeze) a graph or a figure (seq 237). */
    setGraphFrozen: NonNullable<GraphJobDeps["setGraphFrozen"]>;
    /** Drawing objects on a graph or figure sheet (seq 238). */
    addDrawingObject: NonNullable<GraphJobDeps["addDrawingObject"]>;
    updateDrawingObject: NonNullable<GraphJobDeps["updateDrawingObject"]>;
    deleteDrawingObject: NonNullable<GraphJobDeps["deleteDrawingObject"]>;
    arrangeDrawingObjects: NonNullable<GraphJobDeps["arrangeDrawingObjects"]>;
  };
  /** Wait for the store to settle after a dispatch, so a `getState()` read
   *  sees the dispatched change. In the app this is two macrotasks (React
   *  flushes the render + layout effects before them); a harness driving
   *  the reducer synchronously leaves it out (a no-op). */
  flush?: () => Promise<void>;
  /** Wait for the store's monotonic `revision` to move past a pre-dispatch
   *  value (the v1.6 race fix): the read-back branches (create-table,
   *  duplicate-family, simulate-data, apply-wand, undo, redo) use this
   *  instead of `flush`, so a `getState()` read after a dispatch sees the
   *  dispatched change even when React defers the commit past two
   *  zero-timers. A harness driving the reducer synchronously omits it
   *  (the state is already current). */
  flushUntilRevision?: (before: number) => Promise<void>;
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
    setGraphSources: a?.setGraphSources,
    changeGraphType: a?.changeGraphType,
    cloneGraph: a?.cloneGraph,
    createFigure: a?.createFigure,
    updateFigure: a?.updateFigure,
    createInfoSheet: a?.createInfoSheet,
    updateInfoSheet: a?.updateInfoSheet,
    renameNode: a?.renameNode,
    setGraphFrozen: a?.setGraphFrozen,
    addDrawingObject: a?.addDrawingObject,
    updateDrawingObject: a?.updateDrawingObject,
    deleteDrawingObject: a?.deleteDrawingObject,
    arrangeDrawingObjects: a?.arrangeDrawingObjects,
  };
}

/** The merge job's deps, from the job deps — the merge action rides
 *  L3's shared `actions` object (a harness that omits it gets the plain
 *  "no store action" error from `needMergeProject` below). */
function toMergeDeps(deps: JobDeps): MergeDeps {
  return {
    getState: deps.getState,
    mergeProject:
      deps.mergeProject ??
      deps.actions?.mergeProject ??
      (() => {
        throw new Error("This window can't merge projects (no mergeProject).");
      }),
    io: deps.io ?? defaultDocumentIo,
  };
}

/** The export jobs' deps, from the job deps — exports read state and
 *  write a file, so they need no store actions, only the file IO. */
function toExportDeps(deps: JobDeps): ExportJobDeps {
  return {
    getState: deps.getState,
    io: deps.exportIo ?? defaultExportIo,
    // The overlay runs: the dispatcher's `run` (the real `runAnalysis`
    // in the app, a stub in a harness), so headless exports draw the
    // graph's overlays from the same cache the views read.
    run: deps.run ?? runAnalysis,
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

/** The eight table types, as the tools spell them. */
const TABLE_TYPES: TableType[] = ["column", "xy", "grouped", "nested", "multiple", "contingency", "survival", "parts-of-whole"];

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

/** One optional arg, as a boolean — missing takes `fallback`. */
function argOptBool(job: McpJob, args: unknown, key: string, fallback: boolean): boolean {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw jobErr(job, `needs ${key} to be true or false.`);
  return value;
}

/** One optional arg, as a finite number — present but not a number is an error. */
function argOptNumber(job: McpJob, args: unknown, key: string): number | undefined {
  const value = (args as Record<string, unknown> | null | undefined)?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw jobErr(job, `needs ${key} to be a number, not ${JSON.stringify(value)}.`);
  }
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

/** A linked-paste source file's contents (Prism 11, seq 168): the injected
 *  reader, or the real native reads — text for delimited files, bytes for
 *  `.xlsx`. A source that can't be read is a plain error naming the file. */
async function readLinkedSource(
  job: McpJob,
  deps: JobDeps,
  sourcePath: string,
  kind: "csv" | "xlsx",
): Promise<string | Uint8Array> {
  const read =
    deps.readLinkedSource ??
    ((path: string, k: "csv" | "xlsx") => (k === "xlsx" ? readDataBytes(path) : readDataText(path)));
  try {
    return await read(sourcePath, kind);
  } catch {
    throw jobErr(job, `“${fileName(sourcePath)}” couldn't be read — the file may have moved or been deleted.`);
  }
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
 * `suffixes` are the first subgroup's sub-column names ("R1", "R2"… or
 * "Mean", "SD", "N" for a summary table), so a summary format can be
 * detected from them the way grouped tables detect theirs.
 */
function nestedShape(
  columns: string[],
): { groups: string[]; subgroups: number; replicates: number; suffixes: string[] } | { error: string } {
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
  return {
    groups,
    subgroups: subCounts[0],
    replicates: repCounts[0],
    suffixes: parts.filter(([g, s]) => g === groups[0] && s === subsOf.get(groups[0])![0]).map((p) => p[2]),
  };
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
 *  notes carry over; `excluded` replaces the marks when the call says so,
 *  `rowGroupsIn` replaces the bands when the call says so (an empty list
 *  clears them). A fresh table (create) starts with none of those.
 */
function buildTableData(
  job: McpJob,
  type: TableType,
  columnsIn: unknown,
  rowsIn: unknown,
  base?: TableData,
  excludedIn?: unknown,
  rowGroupsIn?: unknown,
): TableData {
  if (!Array.isArray(columnsIn) || columnsIn.length === 0) {
    throw jobErr(job, "needs columns to be a non-empty array of strings (column 0 is the row-title column).");
  }
  const columns: string[] = columnsIn.map((c, i) => {
    // Column 0 is the row-title column and may be empty (Prism leaves it
    // unnamed; the app's own fixtures and file loader carry "" there) —
    // every other column must be named (v1.6 F2, mirroring Rust's
    // `validate_table_shape`).
    if (typeof c !== "string" || (i > 0 && !c)) {
      throw jobErr(job, `has a column at index ${i} that is not a non-empty string — only column 0 (the row-title column) may be empty (${JSON.stringify(c)}).`);
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
    summaryFormat = detectSummaryFormat(shape.suffixes);
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

  // Row bands (factor-C levels), when the call passes them: grouped tables
  // only, names non-empty + distinct, counts whole and ≥ 1, and the bands
  // must tile the new rows exactly. An explicit list replaces the base
  // bands (an empty list clears them); omitted, the base bands carry over
  // (see below). Rust serializes an absent Option as JSON null, so null
  // means omitted too (the same convention as `excluded`).
  let rowGroupsGiven = false;
  if (rowGroupsIn !== undefined && rowGroupsIn !== null) {
    rowGroupsGiven = true;
    if (!Array.isArray(rowGroupsIn)) {
      throw jobErr(job, "needs row_groups to be an array of {“name”, “count”} pairs.");
    }
    if (type !== "grouped") {
      throw jobErr(job, `has row_groups but is a ${type} table — row bands only apply to grouped tables.`);
    }
    const bands: RowGroup[] = rowGroupsIn.map((band, i) => {
      if (typeof band !== "object" || band === null || Array.isArray(band)) {
        throw jobErr(job, `has a row group at index ${i} that is not a {“name”, “count”} pair (${JSON.stringify(band)}).`);
      }
      const { name, count } = band as Record<string, unknown>;
      if (typeof name !== "string" || !name) {
        throw jobErr(job, `has a row group at index ${i} with no name — every band needs a non-empty name.`);
      }
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw jobErr(job, `has a row group “${name}” with count ${JSON.stringify(count)} — every band needs a whole number of rows, at least 1.`);
      }
      return { name, count };
    });
    const names = bands.map((b) => b.name);
    if (new Set(names).size !== names.length) {
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      throw jobErr(job, `has two row groups named “${dup}” — band names must be distinct.`);
    }
    const total = bands.reduce((sum, b) => sum + b.count, 0);
    if (bands.length && total !== rows.length) {
      throw jobErr(job, `has row_groups covering ${total} rows but the table has ${rows.length} rows — the bands must tile the rows exactly.`);
    }
    if (bands.length) data.rowGroups = bands;
  }
  if (!base) return data;

  // A replace keeps what the call did not replace: the marks, the bands,
  // the widths, the error format, the freeze flag and the notes. It does
  // NOT keep a linked paste (seq 168): the values no longer come from the
  // source, so a later refresh must not overwrite the replacement — the
  // fresh data above carries no link, and none is restored here.
  const onCell = (k: unknown): k is string => {
    const [r, c] =
      typeof k === "string" && /^\d+,\d+$/.test(k) ? k.split(",").map(Number) : [Infinity, Infinity];
    return r < rows.length && c < columns.length && c >= 1;
  };
  // Rust serializes an absent Option as JSON null, so an omitted `excluded`
  // arrives as null, not undefined — null means omitted too (the same
  // convention as `optString`), and the base marks are preserved (v1.6 F5).
  if (excludedIn !== undefined && excludedIn !== null) {
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
  if (!rowGroupsGiven && base.rowGroups) {
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
  // A replace keeps the formulas whose column survives: the store's
  // recompute materializes their values over whatever the call passed for
  // those columns, so a formula always rules its column.
  if (base.calculated) {
    const kept = base.calculated.filter((v) => columns.includes(v.name));
    if (kept.length) data.calculated = kept;
  }
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

/** Wait for the store's monotonic `revision` to move past `before` (the
 *  v1.6 race fix, frontend half): a dispatch's commit — and the layout
 *  effects that keep `getState()` current — can land after two blind
 *  zero-timers under load, so the read-back branches wait on the revision
 *  instead of the clock. One macrotask per check is the yield that lets
 *  React run the commit; bounded, so a dispatch that never lands (a
 *  no-op, a harness that already applied it) falls through to the
 *  read-back, which errors plainly if the id still isn't there. Returns
 *  true when the revision moved, false on timeout. */
export async function waitForRevision(
  getRevision: () => number,
  before: number,
  timeoutMs = 2000,
): Promise<boolean> {
  if (getRevision() > before) return true;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (getRevision() > before) return true;
    if (Date.now() >= deadline) return false;
  }
}

/** After a dispatch, wait until the store has settled before a read-back:
 *  the revision wait when the hook provides it, else the two-macrotask
 *  flush (a harness driving the reducer synchronously provides neither —
 *  its state is already current). */
async function settleAfterDispatch(deps: JobDeps, beforeRevision: number): Promise<void> {
  if (deps.flushUntilRevision) await deps.flushUntilRevision(beforeRevision);
  else await deps.flush?.();
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
      // runner error on data it cannot use. The gate checks the CONCRETE
      // types the picker offers (analysisTypesOfferedForTable expands the
      // "compare-many-groups" meta entry to anova / kruskal-wallis /
      // rm-anova / friedman): the picker lists only the meta entry, the
      // Rust side rejects it, so checking the raw picker values left
      // those four tests offered on NO table type (BUG-14). The error
      // below still lists the picker values, meta entry included.
      const data = table.data;
      const tableType = table.tableType;
      if (tableType === undefined) {
        throw new Error(`Table “${tableId}” has no table type recorded.`);
      }
      const offered = analysisTypesOfferedForTable(tableType, data);
      const pickerOffered = analysisOptionsForTable(tableType, data).map((o) => o.value);
      // A nested t test compares exactly two groups: the `sets` the caller
      // chose, or the whole table when none were chosen (seq 246 — the gate
      // used to count the whole table even when `sets` named two groups on
      // a 3+ group table). This runs before the offered check: the picker
      // offers the test on ≥2-group tables now that the wizard asks which
      // two, so the offered check alone would let a wrong-sized selection
      // through to fail only at run time. A malformed `sets` falls back to
      // the whole-table count, so `validateAnalysisParams` below still
      // reports it properly.
      if (type === "nested-t-test" && tableType === "nested") {
        const rawSets = (args.params as { sets?: unknown } | null | undefined)?.sets;
        const selected =
          Array.isArray(rawSets) && rawSets.every((s) => typeof s === "string")
            ? (rawSets as string[])
            : undefined;
        const count =
          selected?.length && data
            ? groupsOf(setColumns(readTable(data), selected)).length
            : countDataGroups(data);
        if (count !== 2) {
          throw new Error(
            selected?.length
              ? `“nested-t-test” needs exactly 2 data groups — sets [${selected.map((s) => `“${s}”`).join(", ")}] select ${count} data group${count === 1 ? "" : "s"} on this table.`
              : `“nested-t-test” needs a Nested table with exactly 2 data groups — this table has ${countDataGroups(data)}.`,
          );
        }
      }
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
          `“${type}” is not offered for ${tableType} tables. ${tableType} tables offer: ${pickerOffered.map(offeredLabel).join(", ")}.`,
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
      const args = (job.args as { analysis_id?: unknown; params?: unknown } | null | undefined) ?? {};
      const analysisId = args.analysis_id;
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
      // `titer_rerun_analysis` overrides: validated strictly (unknown or
      // out-of-range keys are rejected naming the valid choices, never
      // silently defaulted) and merged over the node's stored params —
      // then saved on the node, so the next run and the UI see them. An
      // orphaned analysis keeps its params (its source table is gone),
      // so overrides on one are refused here. The stored params
      // themselves are not re-validated: a file-loaded node may carry a
      // key this version doesn't know (FF-F12), which the runners ignore.
      let storedParams = node.analysisParams;
      const type = node.analysisType;
      if (args.params !== undefined) {
        if (node.orphaned) {
          throw new Error(
            `Analysis “${node.name}” is orphaned (its table was deleted) — its parameters can't be changed.`,
          );
        }
        if (!type) {
          throw new Error(`Analysis “${node.name}” has no analysis type recorded.`);
        }
        const { errors, params: checked } = validateAnalysisParams(type, args.params);
        if (errors.length) throw new Error(errors.join(" "));
        const merged = { ...(storedParams ?? {}), ...(checked ?? {}) } as AnalysisParams;
        const setParams =
          deps.setAnalysisParams ??
          (() => {
            throw new Error("This window can't change analysis params (no setAnalysisParams).");
          });
        setParams(analysisId, merged);
        storedParams = merged;
      }
      const parent = node.parentId ? state.nodes[node.parentId] : undefined;
      const data = parent?.type === "table" ? parent.data : undefined;
      if (!type || !data) {
        throw new Error(`Analysis “${node.name}” has no table to run on.`);
      }
      // Info-constant hooks resolve live, exactly as the analysis view
      // does — a hook that can't resolve is an error, never a guessed number.
      const sheets = infoSheetsOf(state.nodes, state.rootOrder);
      const resolved = resolveAnalysisParams(storedParams, type, sheets);
      if ("error" in resolved) throw new Error(resolved.error);
      const outcome = await (deps.run ?? runAnalysis)(type, data, resolved.params);
      // Await the publish: the result must be in the server's map before
      // this job reports done, or a follow-up `titer_read_results` can see
      // "not_computed" (v1.6 F7).
      await (deps.publishResult ?? publishAnalysisResult)(analysisId, outcome);
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
    case "freeze-table": {
      // `setTableFrozen` — a frozen table can't be edited until unfrozen
      // (seq 165); freezing is idempotent, unfreezing restores edits.
      const args = (job.args ?? {}) as { table_id?: unknown; frozen?: unknown };
      const tableId = reqString(args.table_id, "table_id");
      if (typeof args.frozen !== "boolean") {
        throw new Error(`Job argument “frozen” must be true or false.`);
      }
      const state = deps.getState();
      const node = state.nodes[tableId];
      if (!node || node.type !== "table") {
        throw new Error(
          node
            ? `“${tableId}” is not a table (it is a ${node.type}).`
            : `No table with id “${tableId}” in this project.`,
        );
      }
      const freeze =
        deps.setTableFrozen ??
        (() => {
          throw new Error("This window can't freeze tables (no setTableFrozen).");
        });
      freeze(tableId, args.frozen);
      // The commit has to land before this job returns (v1.6 race fix):
      // the next job reads the table through getState(), and without the
      // wait it would still see the table unfrozen and let an edit through.
      await settleAfterDispatch(deps, state.revision);
      return {
        result: { project_id: job.project_id, table_id: tableId, frozen: args.frozen },
        created: { table_id: tableId },
      };
    }
    case "clone-analysis":
    case "clone-figure": {
      // seq 236: one sheet, nothing else — the generic `duplicateNode`
      // store action. Tables and graphs already have their own clone
      // tools (duplicate_table_family / clone_graph).
      const kind = job.action === "clone-analysis" ? "analysis" : "figure";
      const argName = kind === "analysis" ? "analysis_id" : "figure_id";
      const actions = tableActions(job, deps);
      const nodeId = argString(job, job.args, argName);
      const state = deps.getState();
      const node = state.nodes[nodeId];
      if (!node) throw jobErr(job, `no ${kind} with id “${nodeId}” in this project.`);
      if (node.type !== kind) throw jobErr(job, `“${node.name}” is a ${node.type}, not a ${kind}.`);
      const before = new Set(Object.keys(state.nodes));
      const beforeRevision = state.revision;
      actions.duplicateNode(nodeId);
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      const createdId = Object.keys(after.nodes).find((id) => !before.has(id));
      if (!createdId) {
        throw jobErr(
          job,
          `duplicated the ${kind} but its id could not be read back — ask titer_list_projects for the new ${kind}.`,
        );
      }
      return {
        result: { project_id: job.project_id, [`${kind}_id`]: createdId },
        created: { [`${kind}_id`]: createdId },
      };
    }
    case "repoint-analysis": {
      // seq 242: move an orphaned analysis under a table that offers its
      // test — the saved results stay until the re-run lands. The table
      // must offer the test, or the error names the tables that do.
      const actions = tableActions(job, deps);
      const analysisId = argString(job, job.args, "analysis_id");
      const tableId = argString(job, job.args, "table_id");
      const state = deps.getState();
      const node = state.nodes[analysisId];
      if (!node || node.type !== "analysis") {
        throw jobErr(
          job,
          node
            ? `“${analysisId}” is not an analysis (it is a ${node.type}).`
            : `No analysis with id “${analysisId}” in this project.`,
        );
      }
      if (!node.orphaned) {
        throw jobErr(job, `“${node.name}” is not orphaned — only an orphaned analysis can be re-pointed.`);
      }
      const table = state.nodes[tableId];
      if (!table || table.type !== "table") {
        throw jobErr(
          job,
          table
            ? `“${tableId}” is not a table (it is a ${table.type}).`
            : `No table with id “${tableId}” in this project.`,
        );
      }
      const candidates = repointCandidates(node, state.nodes);
      if (!candidates.some((t) => t.id === tableId)) {
        throw jobErr(
          job,
          candidates.length === 0
            ? `table “${table.name}” doesn't offer the ${node.analysisType} test — and no table in this project does.`
            : `table “${table.name}” doesn't offer the ${node.analysisType} test — the tables that do are: ${candidates
                .map((t) => `“${t.name}”`)
                .join(", ")}.`,
        );
      }
      const beforeRevision = state.revision;
      actions.repointAnalysis(analysisId, tableId);
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      if (after.nodes[analysisId]?.parentId !== tableId) {
        throw jobErr(job, `re-pointed “${node.name}” but its table could not be read back — ask titer_list_projects for the analysis.`);
      }
      return {
        result: { project_id: job.project_id, analysis_id: analysisId, table_id: tableId, table_name: table.name },
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
    case "import-data-file": {
      // seq 155 MCP coverage: import a data file (.csv / .tsv / .txt /
      // .xlsx) as a NEW table in this project — the same parsers as
      // File ▸ Import Data File…, minus the dialog. Unlike the UI, it
      // never appends to the active table: MCP never prompts, so the
      // append choice can't be asked — the import always makes a table.
      const actions = tableActions(job, deps);
      const path = argString(job, job.args, "path");
      const name = argOptString(job, job.args, "name");
      if (name !== undefined && !name.trim()) throw jobErr(job, "needs a non-empty name.");
      const ext = path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase() ?? "";
      if (ext !== "csv" && ext !== "tsv" && ext !== "txt" && ext !== "xlsx") {
        throw jobErr(
          job,
          `“${fileName(path)}” is not a data file — import a .csv, .tsv, .txt or .xlsx file.`,
        );
      }
      const io = deps.io ?? defaultDocumentIo;
      let table;
      try {
        const content =
          ext === "xlsx"
            ? await readFileWithTimeout(() => io.readDataBytes(path), path)
            : await readFileWithTimeout(() => io.readDataText(path), path);
        table = await importTabularFile(path, content);
      } catch (err) {
        if (err instanceof Error && err.message.includes("couldn't be read in time")) throw err;
        throw new Error(err instanceof Error ? err.message : String(err));
      }
      const tableName = name?.trim() ? name.trim() : fileTitle(path);
      const preState = deps.getState();
      const before = new Set(preState.rootOrder);
      const beforeRevision = preState.revision;
      actions.createTableWithData(table.tableType, table.data, tableName);
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      const createdId =
        after.activeNodeId && !before.has(after.activeNodeId) && after.nodes[after.activeNodeId]?.type === "table"
          ? after.activeNodeId
          : after.rootOrder.find((id) => !before.has(id) && after.nodes[id]?.type === "table");
      if (!createdId) {
        throw jobErr(job, "imported the file but its table id could not be read back — ask titer_list_tables for the new table.");
      }
      const created = after.nodes[createdId]!;
      return {
        result: {
          project_id: job.project_id,
          table_id: createdId,
          name: created.name,
          table_type: TABLES[table.tableType].label,
          rows: created.data?.rows.length ?? 0,
          data_columns: (created.data?.columns.length ?? 1) - 1,
          notes: table.notes,
        },
        created: { table_id: createdId },
      };
    }
    case "merge-project": {
      // Seq 180: read another project file and append its sheets to this
      // one — the same as File ▸ Merge, minus the dialog. Unlike an
      // import, this never discards the project.
      const args = (job.args ?? {}) as { path?: unknown };
      return executeMergeProject(toMergeDeps(deps), { path: reqString(args.path, "path") }, job.project_id);
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
      const preState = deps.getState();
      const before = new Set(preState.rootOrder);
      const beforeRevision = preState.revision;
      if (!hasColumns && !hasRows) {
        // The empty table of that type — Table ▸ New Table, with its defaults.
        if (name !== undefined) actions.createTableWithData(type, TABLES[type].defaultData(), name);
        else actions.createTable(type);
      } else {
        if (!hasColumns || !hasRows) {
          throw jobErr(job, "needs columns and rows together — pass both, or neither for an empty table.");
        }
        const data = buildTableData(job, type, (job.args as Record<string, unknown>).columns, (job.args as Record<string, unknown>).rows, undefined, undefined, (job.args as Record<string, unknown>).row_groups);
        actions.createTableWithData(type, data, name ?? "Table");
      }
      await settleAfterDispatch(deps, beforeRevision);
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
      if (node.frozen) {
        throw jobErr(job, `Table “${node.name}” is frozen — unfreeze it before writing to it.`);
      }
      const type = node.tableType ?? "column";
      const columns = (job.args as Record<string, unknown> | null | undefined)?.columns;
      const rows = (job.args as Record<string, unknown> | null | undefined)?.rows;
      if (columns === undefined || rows === undefined) {
        throw jobErr(job, "needs columns and rows (the whole table).");
      }
      // BUG-17: a whole-data replace with zero rows would silently erase
      // the table's data and report success. Empty tables are made with
      // titer_create_table (omit columns and rows) and emptied with
      // titer_edit_table delete-rows — never here.
      if (Array.isArray(rows) && rows.length === 0) {
        throw jobErr(
          job,
          "needs rows to be a non-empty array — writing zero rows would erase the table's data. To empty a table, delete its rows with titer_edit_table (delete-rows); to start a new empty table, use titer_create_table with no columns or rows.",
        );
      }
      const label = argOptString(job, job.args, "label") ?? "Edit Table";
      const excluded = (job.args as Record<string, unknown> | null | undefined)?.excluded;
      const rowGroups = (job.args as Record<string, unknown> | null | undefined)?.row_groups;
      const data = buildTableData(job, type, columns, rows, node.data, excluded, rowGroups);
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
      const beforeRevision = state.revision;
      const node = tableNode(job, state, tableId);
      if (node.frozen) {
        throw jobErr(job, `Table “${node.name}” is frozen — unfreeze it before editing it.`);
      }
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
        case "paste-link": {
          // Linked paste (Prism 11, seq 168): paste a data file as a link at
          // (row, column) — the values land and the link is stored, so a
          // later refresh re-reads the file into the same region.
          const sourcePath = argString(job, job.args, "source_path");
          if (!isLinkedSourcePath(sourcePath)) {
            throw jobErr(job, `needs source_path to name a data file (.csv, .tsv, .txt or .xlsx), not “${sourcePath}”.`);
          }
          const row = argInt(job, job.args, "row", 0);
          const col = argInt(job, job.args, "column", 0);
          const autoUpdate = argOptBool(job, job.args, "auto_update", true);
          const kind = linkedPasteKindOf(sourcePath);
          const sourceName = fileName(sourcePath);
          const content = await readLinkedSource(job, deps, sourcePath, kind);
          let block: (string | null)[][];
          try {
            block = await parseLinkedSource(sourceName, content);
          } catch (err) {
            throw jobErr(job, err instanceof Error ? err.message : "couldn't be read as data.");
          }
          const width = block.reduce((w, r) => Math.max(w, r.length), 0);
          const link: LinkedPaste = {
            sourcePath,
            sourceName,
            kind,
            row,
            col,
            rows: block.length,
            cols: width,
            autoUpdate,
          };
          const res = applyLinkedBlock(data, link, block, type);
          if (res.changed) {
            label = "Paste Link";
            next = res.data;
            break;
          }
          // The values already match: still a link when there wasn't this one.
          if (JSON.stringify(data.linkedPaste) !== JSON.stringify(link)) {
            label = "Paste Link";
            next = { ...data, linkedPaste: link };
          }
          break;
        }
        case "remove-link": {
          // Linked paste (Prism 11, seq 168): the values stay, the link goes.
          if (!data.linkedPaste) {
            throw jobErr(job, "has no linked paste to remove — paste a file as a link first (paste-link).");
          }
          label = "Break Link";
          next = { ...data, linkedPaste: undefined };
          break;
        }
        case "set-summary-format": {
          // Seq 208: the sub-column format (raw replicates, or
          // pre-calculated summaries) is a table setting on grouped, XY
          // and nested tables — the MCP twin of the Groups / Replicates
          // panel's format picker. Values stay in their group's slot;
          // narrowing to a shorter format drops only the slots past its
          // width, exactly as the UI does (the helpers decide that).
          if (type !== "grouped" && type !== "xy" && type !== "nested") {
            throw jobErr(
              job,
              `cannot set a sub-column format — only grouped, xy and nested tables have sub-columns, and this is a ${type} table.`,
            );
          }
          const format = argString(job, job.args, "format") as SummaryFormat;
          if (!SUMMARY_FORMATS.some((f) => f.value === format)) {
            throw jobErr(
              job,
              `has no sub-column format “${format}” — the formats are ${SUMMARY_FORMATS.map((f) => f.value).join(", ")}.`,
            );
          }
          if (summaryFormatOf(data) === format) break; // already that format: no-op success
          label = "Change Sub-column Format";
          next =
            type === "xy"
              ? applySummaryFormatXY(data, format)
              : type === "nested"
                ? applySummaryFormatNested(data, format)
                : applySummaryFormat(data, format);
          break;
        }
        case "add-calculated-variable":
        case "set-calculated-variable":
        case "remove-calculated-variable": {
          // Calculated Variables (Prism 11, seq 156): Multiple Variables
          // tables only — the formula core lives in lib/calcvars.ts.
          if (type !== "multiple") {
            throw jobErr(job, `cannot use ${op} — calculated variables only exist in Multiple Variables tables, and this is a ${type} table.`);
          }
          const name = argString(job, job.args, "name");
          if (op === "remove-calculated-variable") {
            if (!isCalculatedColumn(data, name)) {
              throw jobErr(job, `has no calculated variable named “${name}” — ask titer_list_tables for the table's variables first.`);
            }
            label = "Remove Calculated Variable";
            next = removeCalculatedVariable(data, name);
            break;
          }
          const formula = argString(job, job.args, "formula");
          const bare = formula.startsWith("=") ? formula.slice(1) : formula;
          const res =
            op === "add-calculated-variable"
              ? addCalculatedVariable(data, name, bare)
              : setCalculatedFormula(data, name, bare);
          if ("error" in res) throw jobErr(job, res.error);
          label = op === "add-calculated-variable" ? "Add Calculated Variable" : "Edit Calculated Variable";
          next = res.data;
          break;
        }
        case "paste-transposed": {
          // Seq 230, the MCP half of Edit ▸ Paste Transposed: `rows` is the
          // clipboard block; it lands transposed (rows become columns) at
          // (at_row, at_col), growing the table as a GUI paste does.
          const raw = (job.args as Record<string, unknown> | null | undefined)?.rows;
          if (
            !Array.isArray(raw) ||
            raw.length === 0 ||
            raw.some(
              (row) =>
                !Array.isArray(row) ||
                row.some((v) => v !== null && typeof v !== "string" && typeof v !== "number"),
            )
          ) {
            throw jobErr(job, "needs rows to be a non-empty array of rows, each an array of strings, numbers or null.");
          }
          const block = (raw as (string | number | null)[][]).map((row) =>
            row.map((v) => (v === null ? null : String(v))),
          );
          const atRow = argInt(job, job.args, "at_row", 0);
          const atCol = argInt(job, job.args, "at_col", 0);
          if (atRow > data.rows.length || atCol >= data.columns.length) {
            throw jobErr(
              job,
              `has no cell (${atRow}, ${atCol}) to paste at — the table holds ${data.rows.length} rows and ${data.columns.length} columns.`,
            );
          }
          label = "Paste Transposed";
          next = writeBlock(data, atRow, atCol, transposeBlock(block), type);
          break;
        }
        case "generate-series": {
          // Create Series (Prism: Insert → Create Series…; seq 169): fill
          // a column with an arithmetic or geometric series. Defaults
          // follow the dialog: the X column on XY/Survival tables, from
          // row 0, for the table's stored rows, starting at 0 in steps of 1.
          const column =
            argOptNumber(job, job.args, "column") ??
            (type === "xy" || type === "survival"
              ? 1
              : (() => {
                  throw jobErr(job, "needs column — only XY and Survival tables default to the X column (1).");
                })());
          if (column < 1) {
            throw jobErr(job, "needs a data column (1 or later) — column 0 holds the row titles, and takes no series.");
          }
          if (column >= data.columns.length) {
            throw jobErr(job, `has no column ${column} — the table has ${data.columns.length} columns (0 is the row titles).`);
          }
          const at = argInt(job, job.args, "at", 0);
          if (at > data.rows.length) {
            throw jobErr(job, `has no row ${at} to start at — the table holds ${data.rows.length} stored rows.`);
          }
          const count = argOptNumber(job, job.args, "count") ?? Math.max(1, data.rows.length - at);
          const spec = {
            count,
            first: argOptNumber(job, job.args, "first") ?? 0,
            mode: ((argOptString(job, job.args, "mode") ?? "arithmetic") as SeriesMode),
            step: argOptNumber(job, job.args, "step") ?? 1,
          };
          const problem = validateSeriesSpec(spec);
          if (problem) throw jobErr(job, problem);
          label = "Create Series";
          next = fillSeries(data, column, at, generateSeries(spec));
          break;
        }
        default:
          throw jobErr(
            job,
            `has no edit op “${op}” — the ops are insert-rows, delete-rows, insert-columns, delete-columns, rename-column, rename-group, exclude-cells, include-cells, freeze-title, convert-comma-decimals, add-calculated-variable, set-calculated-variable, remove-calculated-variable, set-summary-format, paste-link, remove-link, generate-series, paste-transposed.`,
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
            ...(op === "set-summary-format" ? { summary_format: summaryFormatOf(data) } : {}),
          },
        };
      }
      actions.updateTable(tableId, next, label, move);
      // Same read-back shape as create-table (v1.6 race fix): the commit
      // must land before the next job reads the table, or a following
      // edit-table op sees pre-edit state and can silently no-op (a
      // set-summary-format back to Replicates reads "replicates" and
      // reports success while the Mean/SD/N columns stay).
      await settleAfterDispatch(deps, beforeRevision);
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          rows: next.rows.length,
          data_columns: next.columns.length - 1,
          ...(op === "set-summary-format" ? { summary_format: next.summaryFormat ?? "replicates" } : {}),
        },
      };
    }
    case "refresh-linked-data": {
      // Linked paste (Prism 11, seq 168): re-read a table's linked source
      // file into its region. An unchanged source is a no-op success — no
      // dispatch, no undo step, no dirty flag — so a refresh that finds
      // nothing new costs nothing.
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const state = deps.getState();
      const node = tableNode(job, state, tableId);
      const type = node.tableType ?? "column";
      const data = node.data ?? { columns: ["Title"], rows: [] };
      const link = data.linkedPaste;
      if (!link) {
        throw jobErr(job, "has no linked data — paste a file as a link first (paste-link).");
      }
      const content = await readLinkedSource(job, deps, link.sourcePath, link.kind);
      let res: { data: TableData; changed: boolean; droppedColumns: number };
      try {
        res = await refreshLinked(data, link, content, type);
      } catch (err) {
        throw jobErr(job, err instanceof Error ? err.message : "couldn't be read as data.");
      }
      if (!res.changed) {
        return {
          result: {
            project_id: job.project_id,
            table_id: tableId,
            rows: data.rows.length,
            data_columns: data.columns.length - 1,
            updated: false,
            dropped_columns: 0,
          },
        };
      }
      actions.updateTable(tableId, res.data, "Update Linked Data");
      await deps.flush?.();
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          rows: res.data.rows.length,
          data_columns: res.data.columns.length - 1,
          updated: true,
          dropped_columns: res.droppedColumns,
        },
      };
    }
    case "duplicate-family": {
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const state = deps.getState();
      tableNode(job, state, tableId);
      const before = new Set(state.rootOrder);
      const beforeRevision = state.revision;
      actions.duplicateFamily(tableId);
      await settleAfterDispatch(deps, beforeRevision);
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
      const beforeRevision = state.revision;
      actions.undo();
      // The response reads post-undo state (`future`): wait on the
      // revision, or a deferred commit reads can_redo false (v1.6 F6).
      await settleAfterDispatch(deps, beforeRevision);
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
      const beforeRevision = state.revision;
      actions.redo();
      // Same read-back shape as undo (v1.6 F6).
      await settleAfterDispatch(deps, beforeRevision);
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
    case "freeze-graph":
      return executeFreezeGraph(job, toGraphDeps(deps));
    case "freeze-figure":
      return executeFreezeFigure(job, toGraphDeps(deps));
    case "add-drawing-object":
      return executeAddDrawingObject(job, toGraphDeps(deps));
    case "update-drawing-object":
      return executeUpdateDrawingObject(job, toGraphDeps(deps));
    case "delete-drawing-object":
      return executeDeleteDrawingObject(job, toGraphDeps(deps));
    case "arrange-drawing-objects":
      return executeArrangeDrawingObjects(job, toGraphDeps(deps));
    case "create-figure":
      return executeCreateFigure(job, toGraphDeps(deps));
    case "update-figure":
      return executeUpdateFigure(job, toGraphDeps(deps));
    case "create-info-sheet":
      return executeCreateInfoSheet(job, toGraphDeps(deps));
    case "update-info-sheet":
      return executeUpdateInfoSheet(job, toGraphDeps(deps));
    case "simulate-data": {
      // L5: draw a new table of simulated values (Analysis ▸ Simulate
      // data…) — one webR round-trip, so the tool awaits this job like the
      // table tools. The spec is validated by the same function the dialog
      // uses, so the rules cannot drift from the app.
      const actions = tableActions(job, deps);
      const type = argString(job, job.args, "table_type");
      if (type !== "column" && type !== "grouped" && type !== "xy") {
        throw jobErr(job, `has no simulated table type “${type}” — simulate builds column, grouped or xy tables.`);
      }
      const simType = type as "column" | "grouped" | "xy";
      const distribution = argString(job, job.args, "distribution");
      if (!(SIMULATION_DISTRIBUTIONS as string[]).includes(distribution)) {
        throw jobErr(
          job,
          `has no distribution “${distribution}” — the distributions are ${SIMULATION_DISTRIBUTIONS.join(", ")}.`,
        );
      }
      const spec: SimulationSpec = {
        distribution: distribution as SimulationDistribution,
        mean: argOptNumber(job, job.args, "mean"),
        sd: argOptNumber(job, job.args, "sd"),
        meanlog: argOptNumber(job, job.args, "meanlog"),
        sdlog: argOptNumber(job, job.args, "sdlog"),
        min: argOptNumber(job, job.args, "min"),
        max: argOptNumber(job, job.args, "max"),
        size: argOptNumber(job, job.args, "size"),
        prob: argOptNumber(job, job.args, "prob"),
        lambda: argOptNumber(job, job.args, "lambda"),
        rate: argOptNumber(job, job.args, "rate"),
        n: argInt(job, job.args, "n"),
        datasets: argInt(job, job.args, "datasets"),
        seed: argInt(job, job.args, "seed"),
        tableType: simType,
      };
      const problem = validateSimulationSpec(spec);
      if (problem) throw jobErr(job, problem);
      const preState = deps.getState();
      const before = new Set(preState.rootOrder);
      const beforeRevision = preState.revision;
      const data = await simulateTableData(spec);
      actions.createSimulatedTable(simType, data);
      // Same read-back shape as create-table (v1.6 F3).
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      const createdId = after.rootOrder.find((id) => !before.has(id) && after.nodes[id]?.type === "table");
      if (!createdId) {
        throw jobErr(job, "simulated the data but its table's id could not be read back — ask titer_list_tables for the new table.");
      }
      const created = after.nodes[createdId]!;
      return {
        result: {
          project_id: job.project_id,
          table_id: createdId,
          name: created.name,
          table_type: TABLES[simType].label,
          rows: created.data?.rows.length ?? 0,
          data_columns: (created.data?.columns.length ?? 1) - 1,
        },
        created: { table_id: createdId },
      };
    }
    case "apply-method": {
      // L5: apply a `.pzm` method file's analyses + graphs to a table —
      // the same path as Analysis ▸ Apply Method… (use-document.ts),
      // minus the native alerts. The created analyses are nodes with
      // params, not runs (as in the UI — they compute when viewed).
      const actions = tableActions(job, deps);
      const tableId = argString(job, job.args, "table_id");
      const text = argString(job, job.args, "text");
      const state = deps.getState();
      const table = tableNode(job, state, tableId);
      const tableType = table.tableType;
      if (tableType === undefined) {
        throw jobErr(job, `cannot apply a method to table “${table.name}” — it has no table type recorded.`);
      }
      let parsed: ReturnType<typeof parseProjectText>;
      try {
        parsed = parseProjectText(text);
      } catch {
        throw jobErr(job, "could not be read as a method file — it is not a Titer project file.");
      }
      if ("error" in parsed) throw jobErr(job, `could not be read as a method file — ${parsed.error}`);
      const method = extractMethod(parsed.project);
      if (!method || (method.analyses.length === 0 && method.graphs.length === 0)) {
        throw jobErr(job, "has no analyses or graphs to apply.");
      }
      const kept = methodForTable(method, tableType, table.data);
      if (kept.analyses.length === 0 && kept.graphs.length === 0) {
        // Nothing fits this table: a successful no-op, with the reasons.
        return {
          result: {
            project_id: job.project_id,
            table_id: tableId,
            created: { analyses: [], graphs: [] },
            skipped: kept.skipped,
          },
        };
      }
      const create =
        deps.createAnalysis ??
        (() => {
          throw new Error("This window can't create analyses (no createAnalysis).");
        });
      const idMap: Record<string, string> = {};
      const appliedAnalyses: string[] = [];
      for (const a of kept.analyses) {
        idMap[a.id] = create(tableId, a.analysisType, a.analysisParams);
        appliedAnalyses.push(idMap[a.id]);
      }
      const appliedGraphs: string[] = [];
      const droppedLinks: string[] = [];
      for (const g of kept.graphs) {
        const { options, dropped } = remapGraphOptions(g.graphOptions, idMap);
        appliedGraphs.push(actions.createGraph(tableId, g.graphType, options));
        for (const key of dropped) {
          droppedLinks.push(`${g.name} — dropped its link to an analysis that wasn't applied (${key}).`);
        }
      }
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          created: { analyses: appliedAnalyses, graphs: appliedGraphs },
          skipped: kept.skipped,
          dropped_links: droppedLinks,
        },
        created: { table_id: tableId },
      };
    }
    case "apply-template": {
      // L2: start from a built-in template (seq 167) — the same plan the
      // Welcome dialog applies in the UI (`planTemplateApply`): a fresh
      // window's untouched table is replaced, anywhere else the template
      // adds a table. The graphs are nodes with defaults, not runs (as in
      // the UI — they draw when viewed).
      const actions = tableActions(job, deps);
      const templateId = argString(job, job.args, "template_id");
      const template = templateById(templateId);
      if (!template) {
        throw jobErr(
          job,
          `has no template “${templateId}” — the templates are ${TEMPLATES.map((t) => t.id).join(", ")}.`,
        );
      }
      const preState = deps.getState();
      const before = new Set(preState.rootOrder);
      const beforeRevision = preState.revision;
      const plan = planTemplateApply(template, {
        nodes: preState.nodes,
        rootOrder: preState.rootOrder,
        childOrder: preState.childOrder,
      });
      if (plan.replaceTableId) actions.removeNode(plan.replaceTableId);
      actions.createTableWithData(plan.table.tableType, plan.table.data, plan.table.name);
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      const createdId =
        after.activeNodeId && !before.has(after.activeNodeId) && after.nodes[after.activeNodeId]?.type === "table"
          ? after.activeNodeId
          : after.rootOrder.find((id) => !before.has(id) && after.nodes[id]?.type === "table");
      if (!createdId) {
        throw jobErr(job, "applied the template but its table's id could not be read back — ask titer_list_tables for the new table.");
      }
      const created = after.nodes[createdId]!;
      const graphIds: string[] = [];
      for (const g of plan.graphs) graphIds.push(actions.createGraph(createdId, g.graphType, g.options));
      return {
        result: {
          project_id: job.project_id,
          template_id: template.id,
          template_name: template.name,
          table_id: createdId,
          name: created.name,
          table_type: TABLES[plan.table.tableType].label,
          rows: created.data?.rows.length ?? 0,
          data_columns: (created.data?.columns.length ?? 1) - 1,
          graphs: graphIds,
          replaced_pristine_table: plan.replaceTableId !== null,
        },
        created: { table_id: createdId },
      };
    }
    case "apply-wand": {
      // L5: analyze + graph this table like another table (Analysis ▸ Use
      // Wand…) — the store's `applyWand`, one target, one undo step. The
      // report is the existing `WandReport`; the created ids are diffed
      // from the table's children before/after.
      const tableId = argString(job, job.args, "table_id");
      const exampleId = argString(job, job.args, "example_table_id");
      const prefix = argOptString(job, job.args, "prefix") ?? "";
      const state = deps.getState();
      tableNode(job, state, tableId);
      tableNode(job, state, exampleId);
      const before = new Set(state.childOrder?.[tableId] ?? []);
      const beforeRevision = state.revision;
      const apply =
        deps.applyWand ??
        (() => {
          throw new Error("This window can't use the Wand (no applyWand).");
        });
      const report = apply(exampleId, [tableId], prefix);
      // The created ids are diffed from post-dispatch state (same
      // read-back shape as create-table).
      await settleAfterDispatch(deps, beforeRevision);
      const after = deps.getState();
      const created = (after.childOrder?.[tableId] ?? [])
        .filter((id) => !before.has(id))
        .map((id) => after.nodes[id])
        .filter((n): n is ProjectNode => n !== undefined);
      return {
        result: {
          project_id: job.project_id,
          table_id: tableId,
          created: {
            analyses: created.filter((n) => n.type === "analysis").map((n) => n.id),
            graphs: created.filter((n) => n.type === "graph").map((n) => n.id),
          },
          report,
        },
        created: { table_id: tableId },
      };
    }
    case "run-script": {
      // L5: run a Prism script against the whole project (File ▸ Run
      // Script…) — the pure engine (`lib/prism-script.ts`), one undo step
      // ("Run Script"). A run that hits an error changes nothing, so the
      // job errors with the log. The script's effects (file writes, graph
      // exports, save, print) are REPORTED, not executed: graph exports
      // need the headless render path (GAP-2, L8), and executing file
      // writes from an agent script is the coordinator's call, not this
      // lane's. `Import` names files the engine cannot read here, so it
      // errors plainly instead of silently skipping.
      const script = argString(job, job.args, "script");
      const state = deps.getState();
      const doc = {
        nodes: state.nodes,
        rootOrder: state.rootOrder,
        childOrder: state.childOrder,
        activeNodeId: state.activeNodeId,
        projectName: state.projectName,
      };
      const result = runScript(doc, script, {});
      if (result.stopped) {
        throw jobErr(job, `stopped without changing anything — ${result.log.join(" ")}`);
      }
      const changed = JSON.stringify(result.doc) !== JSON.stringify(doc);
      if (changed) {
        const apply =
          deps.applyScript ??
          (() => {
            throw new Error("This window can't run scripts (no applyScript).");
          });
        apply(result.doc);
        await deps.flush?.();
      }
      return {
        result: {
          project_id: job.project_id,
          replaced: changed,
          log: result.log,
          effects: result.effects,
          effects_executed: false,
          effects_note:
            "The script's file writes, graph exports, save and print effects were reported, not executed — graph exports need the headless render path (L8), and file writes from an agent script are not wired in this lane.",
        },
      };
    }
    // L8 — export tools (src/store/mcp-export.ts): the branches render
    // offscreen and write the file; the path is resolved by Rust.
    case "export-graph":
      return executeExportGraph(job, toExportDeps(deps));
    case "export-figure":
      return executeExportFigure(job, toExportDeps(deps));
    case "export-all-graphs":
      return executeExportAllGraphs(job, toExportDeps(deps));
    case "export-office":
      return executeExportOffice(job, toExportDeps(deps));
    case "export-table-data":
      return executeExportTableData(job, toExportDeps(deps));
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
  const setTableFrozen = actions.setTableFrozen;
  const setAnalysisParams = actions.setAnalysisParams;
  const applyWand = actions.applyWand;
  const applyScript = actions.applyScript;
  const loadProject = actions.loadProject;
  const markSaved = actions.markProjectSaved;
  // The table branches dispatch through these actions; after a dispatch
  // they need the store to have settled before reading the new state
  // back (a created table's id, an undo label) — two macrotasks, by which
  // time React has flushed the render and the layout effects that keep
  // `latest` current.
  const flush = () => new Promise<void>((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));
  // The two read-back branches wait on the store's monotonic `revision`
  // instead of two blind macrotasks (v1.6 race fix): under load React can
  // defer the commit past two zero-timers, so the id read-back saw
  // pre-dispatch state. The flush first gives the common case its usual
  // settle; the revision wait then covers the deferred commit, bounded
  // (2 s) — a timeout falls through to the read-back, which errors
  // plainly if the id still isn't there. The drain's post-job publish
  // below uses the same wait (1 s bound): a publish read from a
  // pre-commit `getState()` hands Rust a stale snapshot, and the very
  // next tool call — an immediate read, or a default-path export that
  // needs the save's filePath — sees pre-job state (L10 run 2: the
  // update_info_sheet constants read back stale, and the default-path
  // export fell through to `document_dir()` and died on tauri
  // `UnknownPath`). A job that never moves the revision (a read-only
  // export, a no-op) pays at most the bound, then publishes as-is.
  const flushUntilRevision = async (before: number, timeoutMs = 2000) => {
    await flush();
    await waitForRevision(() => getState().revision, before, timeoutMs);
  };
  // Jobs already handed to an execution: the frontend side of the
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
            // The revision before the job runs: the post-job publish waits
            // for it to move, so the snapshot Rust gets is post-job even
            // when React defers the commit past the flush (see above).
            const revBefore = getState().revision;
            try {
              const { result, created } = await executeJob(job, {
                getState,
                cacheAnalysisResult,
                createAnalysis,
                renameNode,
                setAnalysisFrozen,
                setTableFrozen,
                setAnalysisParams,
                applyWand,
                applyScript,
                loadProject,
                markSaved,
                actions,
                flush,
                flushUntilRevision,
              });
              // Publish the post-job project immediately — before
              // `mcpCompleteJob` wakes Rust — so the next tool call reads
              // post-job state instead of the snapshot still waiting out
              // the 500 ms debounce (v1.6 race fix). The revision wait
              // first lets a deferred commit land; without it the publish
              // can carry pre-job state (L10 run 2).
              await flushUntilRevision(revBefore, 1000);
              await publishMcpSnapshotNow(getState());
              // A completion report is always sent; Rust ignores it for a
              // job that is already terminal (a cancel that landed first).
              await mcpCompleteJob(job.job_id, "done", result, undefined, created).catch(() => {});
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              await flushUntilRevision(revBefore, 1000);
              await publishMcpSnapshotNow(getState());
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
