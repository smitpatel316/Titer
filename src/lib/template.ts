// Templates (.pzt), example files and method files (.pzm) — plan 38.
// A template/example/method file IS a regular Titer project file, with a
// different extension and one added envelope block (Prism: "a regular Prism
// file, with three differences"). Pure: no React, no native calls, so
// checks.ts pins it without a window.

import { analysisOptionsForTable, META_ANALYSES } from "../views/analyses";
import { parsePluginAnalysisId } from "../plugins";
import { GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";
import { TABLES } from "../views/tables";
import type { AnalysisParams, AnalysisType } from "../stats/types";
import type { GraphOptions, GraphType, ProjectNode, TableData, TableType } from "../store/types";
import type { ProjectFilePayload } from "./project-file";

/** The three special files Prism's File ▸ Save Special writes. */
export type TemplateKind = "template" | "example" | "method";

/** The envelope block a `.pzt`/`.pzm` file carries, on top of a project. */
export interface TemplateInfo {
  kind: TemplateKind;
  /** Shown when the template is opened; metadata, not the file name. */
  name?: string;
  description?: string;
  /** Shown when the template is opened. */
  instructions?: string;
}

export const TEMPLATE_FILE_EXTENSION = "pzt";
export const METHOD_FILE_EXTENSION = "pzm";
export const TEMPLATE_NAME_MAX = 120;
export const TEMPLATE_TEXT_MAX = 2000;

const KINDS: TemplateKind[] = ["template", "example", "method"];

/** A path's extension, whatever its case — `.pzt`, `.PZT`, or none. */
const extensionOf = (path: string) => {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
};

/** True for a template/example file (`.pzt`). */
export const isTemplatePath = (path: string) => extensionOf(path) === TEMPLATE_FILE_EXTENSION;
/** True for a method file (`.pzm`). */
export const isMethodPath = (path: string) => extensionOf(path) === METHOD_FILE_EXTENSION;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** One text field, trimmed and capped; blank is no text. */
const textField = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const text = v.trim().slice(0, max);
  return text === "" ? undefined : text;
};

/** The `template` envelope block, forgivingly: a missing or broken block is
 *  not an error — the file still opens as a project (a `.pzt` without
 *  metadata is an informal template, as in Prism: "you can rename any Prism
 *  file … to have a .pzt extension"). Unknown keys are dropped. */
export function parseTemplateInfo(v: unknown): TemplateInfo | undefined {
  if (!isObj(v)) return undefined;
  const kindRaw = typeof v.kind === "string" ? v.kind.toLowerCase() : undefined;
  const kind = kindRaw ? KINDS.find((k) => k === kindRaw) : undefined;
  if (!kind) return undefined;
  const info: TemplateInfo = { kind };
  const name = textField(v.name, TEMPLATE_NAME_MAX);
  const description = textField(v.description, TEMPLATE_TEXT_MAX);
  const instructions = textField(v.instructions, TEMPLATE_TEXT_MAX);
  if (name) info.name = name;
  if (description) info.description = description;
  if (instructions) info.instructions = instructions;
  return info;
}

// ── Method application ───────────────────────────────────────────────────

/** One analysis a method file carries, to clone onto a table. `id` is the
 *  source node's id, so a cloned graph can remap its links to the new ids. */
export interface MethodAnalysis {
  id: string;
  analysisType: AnalysisType;
  analysisParams?: AnalysisParams;
  name: string;
}

/** One graph a method file carries, to clone onto a table. */
export interface MethodGraph {
  id: string;
  graphType: GraphType;
  graphOptions?: GraphOptions;
  name: string;
}

/** A method file's first table and its children, in sidebar order. */
export interface ExtractedMethod {
  sourceTableId: string;
  sourceTableName: string;
  sourceTableType: TableType;
  analyses: MethodAnalysis[];
  graphs: MethodGraph[];
}

/** The method file's first table in root order, and its analyses and graphs
 *  in sidebar (`childOrder`) order. Figures are NOT carried — they span
 *  tables, and a method applies to one data table. Null when the project has
 *  no table at all; empty lists when the table has no children (the apply
 *  step errors then, it doesn't crash). */
export function extractMethod(project: ProjectFilePayload): ExtractedMethod | null {
  const tableId = project.rootOrder.find((id) => project.nodes[id]?.type === "table");
  if (!tableId) return null;
  const table = project.nodes[tableId];
  const children = (project.childOrder[tableId] ?? [])
    .map((id) => project.nodes[id])
    .filter((n): n is ProjectNode => n !== undefined && n.parentId === tableId);
  const analyses: MethodAnalysis[] = [];
  const graphs: MethodGraph[] = [];
  for (const child of children) {
    if (child.type === "analysis" && child.analysisType) {
      analyses.push({ id: child.id, analysisType: child.analysisType, analysisParams: child.analysisParams, name: child.name });
    } else if (child.type === "graph" && child.graphType) {
      graphs.push({ id: child.id, graphType: child.graphType, graphOptions: child.graphOptions, name: child.name });
    }
  }
  return {
    sourceTableId: tableId,
    sourceTableName: table.name,
    sourceTableType: table.tableType as TableType,
    analyses,
    graphs,
  };
}

/** What applying a method kept, and what it skipped with its reason. */
export interface MethodApplication {
  analyses: MethodAnalysis[];
  graphs: MethodGraph[];
  skipped: { name: string; kind: "analysis" | "graph"; reason: string }[];
}

// The picker offers two meta entries, not tests: "compare-many-groups"
// resolves (in the wizard) to one-way ANOVA, Kruskal-Wallis,
// repeated-measures ANOVA or Friedman, and "interpolate" to nonlinear
// regression — so a saved analysis of any of those counts as offered.
// The mapping lives in views/analyses (META_ANALYSES, next to the picker
// it describes); the MCP gate in store/mcp-dispatch.ts uses the same
// mapping via analysisTypesOfferedForTable (BUG-14).

/** The analysis types the Analysis menu offers for a table (its picker
 *  values, with the meta entries expanded to the tests they resolve to).
 *  Plugin ids are not first-party types and a method file cannot carry
 *  one yet, so they stay out of this set. */
const offeredAnalyses = (tableType: TableType, data?: TableData): Set<string> =>
  new Set(
    analysisOptionsForTable(tableType, data).flatMap((o) =>
      parsePluginAnalysisId(o.value) ? [] : (META_ANALYSES[o.value] ?? [o.value]),
    ),
  );

/** Params whose values name the table's columns: a name, names, a name or
 *  names, or a name-and-levels object. An analysis whose saved param names a
 *  column the target table lacks is skipped, not applied broken. Choice
 *  params (`method`, `model`, …) are not column names and are never checked
 *  here — the runner re-validates them, as it does for a file's own analyses. */
type ColumnParamKind = "name" | "names" | "name-or-names" | "name-and-names";
const COLUMN_PARAMS: Record<string, ColumnParamKind> = {
  y: "name-or-names",
  y2: "name",
  ys: "names",
  dependent: "name",
  reference: "name",
  control: "name",
  compareWith: "name",
  datasets: "names",
  predictors: "names",
  sets: "names",
  column: "name",
  truth: "name",
  score: "name",
  time: "name",
  status: "name",
  covariates: "names",
  stratifyBy: "name",
  x: "name",
  globalY: "names",
  sharedParams: "names",
  controls: "names",
  subjectFactor: "name-and-names",
};

/** The columns a param names that the target table doesn't have. */
function missingColumns(params: AnalysisParams | undefined, columns: Set<string> | null): string[] {
  if (!params || !columns) return [];
  const missing: string[] = [];
  for (const [key, kind] of Object.entries(COLUMN_PARAMS)) {
    const value = (params as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    const names: string[] =
      kind === "names" || kind === "name-or-names"
        ? Array.isArray(value)
          ? value.filter((v): v is string => typeof v === "string")
          : typeof value === "string" && kind === "name-or-names"
            ? [value]
            : []
        : kind === "name-and-names"
          ? isObj(value) && typeof value.name === "string"
            ? [value.name]
            : []
          : typeof value === "string"
            ? [value]
            : [];
    for (const name of names) if (!columns.has(name) && !missing.includes(name)) missing.push(name);
  }
  return missing;
}

/** Keeps only what the target table offers — analyses via the same list the
 *  Analysis menu shows, graphs via `GRAPH_OPTIONS_BY_TABLE`. The rest go in
 *  `skipped` with a one-line reason each. */
export function methodForTable(
  method: ExtractedMethod,
  tableType: TableType,
  tableData?: TableData,
): MethodApplication {
  const label = TABLES[tableType].label;
  const offered = offeredAnalyses(tableType, tableData);
  const columns = tableData ? new Set(tableData.columns) : null;
  const kept: MethodApplication = { analyses: [], graphs: [], skipped: [] };
  for (const analysis of method.analyses) {
    if (!offered.has(analysis.analysisType)) {
      kept.skipped.push({
        name: analysis.name,
        kind: "analysis",
        reason: `not offered for a ${label} table`,
      });
      continue;
    }
    const missing = missingColumns(analysis.analysisParams, columns);
    if (missing.length) {
      kept.skipped.push({
        name: analysis.name,
        kind: "analysis",
        reason: `needs column${missing.length === 1 ? "" : "s"} ${missing.map((c) => `“${c}”`).join(", ")}, which this table doesn't have`,
      });
      continue;
    }
    kept.analyses.push(analysis);
  }
  const offeredGraphs = new Set(GRAPH_OPTIONS_BY_TABLE[tableType].map((o) => o.value));
  for (const graph of method.graphs) {
    if (!offeredGraphs.has(graph.graphType)) {
      kept.skipped.push({ name: graph.name, kind: "graph", reason: `not offered for a ${label} table` });
      continue;
    }
    kept.graphs.push(graph);
  }
  return kept;
}

// ── Cloned graph links ───────────────────────────────────────────────────

/** Graph options that name an analysis by id. A cloned graph keeps its
 *  link only when the referenced analysis was also cloned in the same apply
 *  (remapped old id → new id); otherwise the link is dropped and the graph
 *  is still applied. */
export const GRAPH_ANALYSIS_ID_KEYS = [
  "sigAnalysisId",
  "regAnalysisId",
  "demingAnalysisId",
  "coxAnalysisId",
  "ttestAnalysisId",
  "poissonAnalysisId",
  "smoothAnalysisId",
  "pcaAnalysisId",
  "kmeansAnalysisId",
  "hclustAnalysisId",
  "monteCarloAnalysisId",
] as const;

/** `options` with its analysis links remapped through `idMap` (old id → new
 *  id); links with no new id are dropped and named. The input is never mutated. */
export function remapGraphOptions(
  options: GraphOptions | undefined,
  idMap: Record<string, string>,
): { options: GraphOptions | undefined; dropped: string[] } {
  if (!options) return { options, dropped: [] };
  const next = { ...options };
  const dropped: string[] = [];
  for (const key of GRAPH_ANALYSIS_ID_KEYS) {
    const id = (next as unknown as Record<string, unknown>)[key];
    if (typeof id !== "string") continue;
    if (idMap[id]) (next as unknown as Record<string, unknown>)[key] = idMap[id];
    else {
      delete (next as unknown as Record<string, unknown>)[key];
      dropped.push(key);
    }
  }
  // The multi-source list: each entry remaps through the same map, and one
  // with no new id drops out; an emptied list goes with it, as a link does.
  if (Array.isArray(next.sigAnalysisIds)) {
    const remapped = next.sigAnalysisIds.flatMap((id) => (typeof id === "string" && idMap[id] ? [idMap[id]] : []));
    if (remapped.length) next.sigAnalysisIds = remapped;
    else {
      delete next.sigAnalysisIds;
      dropped.push("sigAnalysisIds");
    }
  }
  return { options: next, dropped };
}

// ── The apply report ─────────────────────────────────────────────────────

/** The report the apply step shows (native alert, same shape as the
 *  Prism-import report): what was applied, then what was skipped and why. */
export function formatMethodReport(args: {
  methodName: string;
  tableName: string;
  appliedAnalyses: { name: string }[];
  appliedGraphs: { name: string }[];
  skipped: { name: string; reason: string }[];
}): string {
  const { methodName, tableName, appliedAnalyses, appliedGraphs, skipped } = args;
  const lines = [
    `Applied ${appliedAnalyses.length} ${appliedAnalyses.length === 1 ? "analysis" : "analyses"} and ${appliedGraphs.length} ${appliedGraphs.length === 1 ? "graph" : "graphs"} from “${methodName}” to “${tableName}”:`,
    ...appliedAnalyses.map((a) => `• ${a.name}`),
    ...appliedGraphs.map((g) => `• ${g.name}`),
  ];
  if (skipped.length) {
    lines.push("", "Skipped:", ...skipped.map((s) => `• ${s.name} — ${s.reason}`));
  }
  return lines.join("\n");
}
