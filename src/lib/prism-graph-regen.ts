// One-click graph regeneration on .prism/.pzfx import (Plane seq 291,
// 1.8.1 fast follow-up; design ~/workspace/.helix-future/regen-design.md).
//
// What the spike proved, and this module never re-derives: Prism's graphs
// live in an undocumented binary blob (`data.bin` / the .pzfx `<Template>`
// blob) with no source-table linkage and no kind code — parsing it is a
// NO-GO. The carve-out is the JSON sidecar: an AUTO-created graph's
// `graphs/<id>/sheet.json` (title, isAutoCreated, inputDataSets) + the
// dataset JSON (`data/sets/<uid>.json`, "format") + the parent table's
// format say exactly which graph to build, on which table, with which
// error bars. Hand-made graphs cannot be reconstructed; axis min/max /
// ticks are defaults, not Prism's; layouts stay out of scope.
//
// This module never reads `data.bin`, never hunts UUIDs, never parses the
// blob in any encoding. It reads JSON sidecar files only, plus the
// converted project `convertPrism` already built.
//
// Two routes in:
//   .prism — `planGraphRegeneration(zip, converted)`: the sidecar mapping
//     (§3 of the design), sharing `convertPrism`'s JSZip instance — the
//     source is never unzipped twice.
//   .pzfx — `planPzfxGraphs(imported)`: no sidecar exists, so one proposal
//     per imported table from the heuristic rules H1–H6 (§4), every row
//     badged "Guessed from the table".
//
// Plans live only while the imported project is open: the registry below
// (`setRegenPlans` / `getRegenPlans`) is the import-time document state
// the UI dialog and the MCP tools both read. It is cleared on any project
// load (`use-project-store`'s `loadProject`) and on window close (the
// module dies with the webview); it is never persisted in `.hlx`.
// Within one webview there is exactly one live project, so the registry
// holds one set of plans; the `projectId` recorded at import time (the
// MCP job's resolved id — the UI path doesn't know its window label, so
// it stores null) guards the MCP reads against a stale id.
import type JSZip from "jszip";
import { GRAPH_OPTIONS_BY_TABLE, newGraphOptions } from "../views/graphs";
import { remapGraphOptions } from "./template";
import { inputDatasetUid, plainTitle, replicateCount, replicateRangeProblems, resolveDataFormat } from "./prism";
import type { ConvertResult, PrismInputDataSet, PrismTableIndexEntry } from "./prism";
import type { PzfxImport } from "./pzfx";
import type { GraphOptions, GraphType, ProjectNode, TableErrorFormat } from "../store/types";

/** A plan's provenance: read from Prism's sidecar, or guessed from the table. */
export type GraphPlanOrigin = "sidecar" | "heuristic";

/** The error bars a proposed graph draws (`GRAPH_CHOICES.error`). */
export type RegenError = "none" | "sd" | "sem" | "ci";

/** One proposed graph, in file order — what the preview dialog shows and
 *  what `titer_list_regenerable_graphs` returns. `graphType` / `error`
 *  are null exactly when `reconstructible` is false: the row is shown
 *  with its reason and can never be confirmed. */
export interface GraphPlan {
  /** Stable id: `prism:<graph uid>` for a sidecar graph, `pzfx:<table node id>` for a heuristic one. */
  proposalId: string;
  /** Prism's graph title (sidecar), or the source table's name (heuristic — the title isn't in a .pzfx file). */
  prismTitle: string;
  /** The converted Titer table node the graph plots (null when the source wasn't imported). */
  sourceTableId: string | null;
  sourceTableName: string | null;
  graphType: GraphType | null;
  error: RegenError | null;
  /** The imported analysis the graph draws on (nonlinear fit on an XY graph), when one was imported. */
  linkedAnalysisId?: string;
  linkedAnalysisName?: string;
  origin: GraphPlanOrigin;
  /** Which heuristic rule produced this row (H1–H6, heuristic origin only). */
  heuristicRule?: "H1" | "H2" | "H3" | "H4" | "H5" | "H6";
  reconstructible: boolean;
  /** Why not, when it isn't — shown on the row, never guessed around. */
  reason?: string;
  /** y_cv_n row: the SD is derived (mean × CV% / 100), not read from Prism — disclosed, not invented. */
  derivedError?: string;
  /** y_plus_minus / y_high_low row: Prism's asymmetric errors don't transfer. */
  limitNote?: string;
  /** Types the preview offers as Adjust alternatives (design §3 notes). */
  adjustAlternatives?: GraphType[];
}

// ── The sidecar mapping table (design §3) ───────────────────────────────

/** What the mapping needs for one graph. `subcolumnCount` is null when
 *  the dataset's replicate ranges are malformed (unknown, never 0). */
export interface SidecarMappingInput {
  /** Prism `table.format` ("column" | "xy" | "grouped" | "survival" | "contingency" | "nested" | …). */
  tableFormat: string;
  /** Prism `table.dataFormat` ("y_sd_n", "y_replicates", …). */
  tableDataFormat: string;
  /** The input dataset's own `format` (from `data/sets/<uid>.json`). */
  datasetFormat: string;
  subcolumnCount: number | null;
  isAutoCreated: boolean;
  hasInputDatasets: boolean;
  sourceResolvable: boolean;
  /** The imported nonlinear-regression analysis for this dataset, if any (XY graphs only). */
  linkedAnalysisId?: string;
  /** Whether that analysis is a sigmoidal (4PL) fit — the preview then offers logistic-curve as an Adjust alternative. */
  linkedAnalysisIsSigmoidal?: boolean;
  /** The converted table records SD as its error format (else SEM, the default). */
  tableErrorIsSd?: boolean;
}

export type SidecarMapping =
  | {
      reconstructible: true;
      graphType: GraphType;
      error: RegenError;
      /** The imported nonlinear-regression analysis for this dataset (XY graphs only). */
      linkedAnalysisId?: string;
      derivedError?: string;
      limitNote?: string;
      adjustAlternatives?: GraphType[];
    }
  | { reconstructible: false; reason: string };

const notReconstructible = (reason: string): SidecarMapping => ({ reconstructible: false, reason });

/**
 * The mapping table, as a pure function (pinned by tests/prism-regen.ts).
 * Type is derived from (table.format, dataset format) — NEVER from the
 * graph title: titles describe the source table, not the graph type.
 * Error-stat precedence follows BUG-9 (`resolveDataFormat`): the table's
 * dataFormat wins when it fits the subcolumn count, else the dataset's
 * own format. Unknown format / non-auto / missing source → NO proposal,
 * listed with its reason, never guessed.
 *
 * Y CV (design §3): the y_cv_n row draws SD bars derived as mean ×
 * CV% / 100 — CONFIRMED against real Prism 11 (Nov 21, 2026:
 * cv-test.prism, Group A SD=10 = 100x10/100, Group B SD=10 =
 * 200x5/100; SEM would have been 5 / 3.33). The derivation is
 * disclosed on the row (`derivedError`).
 */
export function mapSidecarGraph(input: SidecarMappingInput): SidecarMapping {
  if (!input.isAutoCreated) {
    return notReconstructible("Custom graph — it was made by hand in Prism, so it can't be reconstructed from the file.");
  }
  if (!input.hasInputDatasets) {
    return notReconstructible("No source table recorded — the graph doesn't say which table it plots.");
  }
  if (!input.sourceResolvable) {
    return notReconstructible("Source table not imported — the graph's table didn't come across.");
  }
  const resolved =
    input.subcolumnCount === null
      ? input.tableDataFormat
      : resolveDataFormat(input.tableDataFormat, input.datasetFormat, input.subcolumnCount);
  // The table default error: SEM, unless the table records SD.
  const tableDefault: RegenError = input.tableErrorIsSd ? "sd" : "sem";
  const derivedSd = "SD derived as mean × CV% / 100 from the imported MEAN/CV/N columns.";
  const asymmetricLimit =
    "Prism's asymmetric +/− errors don't transfer — Titer error bars are symmetric. The values stay in the table.";
  const link = input.linkedAnalysisId ? { linkedAnalysisId: input.linkedAnalysisId } : {};
  const sigmoidalAlt = input.linkedAnalysisIsSigmoidal ? { adjustAlternatives: ["logistic-curve" as GraphType] } : {};

  const errorFor = (
    format: string,
  ): { error: RegenError; derivedError?: string; limitNote?: string } | null => {
    switch (format) {
      case "y_replicates":
        return { error: tableDefault };
      case "y_sd":
      case "y_sd_n":
        return { error: "sd" };
      case "y_se":
      case "y_se_n":
        return { error: "sem" };
      case "y_cv":
      case "y_cv_n":
        return { error: "sd", derivedError: derivedSd };
      case "y_single":
        return { error: "none" };
      case "y_plus_minus":
      case "y_high_low":
        return { error: "none", limitNote: asymmetricLimit };
      default:
        return null;
    }
  };

  switch (input.tableFormat) {
    case "column":
    case "nested": {
      // A Prism nested table imports as Column (the existing import rule).
      const e = errorFor(resolved);
      if (!e) {
        return notReconstructible(
          `No confident mapping — the dataset format “${resolved}” isn't one Titer maps to a graph.`,
        );
      }
      return {
        reconstructible: true,
        graphType: "mean-error",
        ...e,
        ...(resolved === "y_replicates" ? { adjustAlternatives: ["individual", "box-violin"] as GraphType[] } : {}),
      };
    }
    case "xy": {
      const e = errorFor(resolved);
      if (!e) {
        return notReconstructible(
          `No confident mapping — the dataset format “${resolved}” isn't one Titer maps to a graph.`,
        );
      }
      return { reconstructible: true, graphType: "xy-scatter", ...e, ...link, ...sigmoidalAlt };
    }
    case "grouped": {
      // The summary format decides the error bars, exactly as for column
      // and XY tables: y_sd_n draws SD, y_cv_n derived SD, y_single /
      // y_plus_minus none (with the asymmetric note) — the table default
      // ("sem") is only the y_replicates answer.
      const e = errorFor(resolved);
      if (!e) {
        return notReconstructible(
          `No confident mapping — the dataset format “${resolved}” isn't one Titer maps to a graph.`,
        );
      }
      return {
        reconstructible: true,
        graphType: "grouped-bars",
        ...e,
        adjustAlternatives: ["grouped-scatter", "grouped-box", "grouped-lines"],
      };
    }
    case "survival":
      return { reconstructible: true, graphType: "survival", error: "none" };
    case "contingency":
      return { reconstructible: true, graphType: "grouped-bars", error: "none" };
    default:
      return notReconstructible(`Table format “${input.tableFormat}” isn't one Titer maps to a graph.`);
  }
}

// ── The .prism sidecar planner ───────────────────────────────────────────

interface PrismGraphSheet {
  title?: string | { string?: string };
  isAutoCreated?: boolean;
  /** Real Prism 11 writes these as BARE UID STRINGS (seq 313); the
   *  {uid} object form is accepted too (older/synthetic fixtures). */
  inputDataSets?: PrismInputDataSet[];
}

interface PrismDataSetJson {
  format?: string;
  title?: string | { string?: string };
  replicates?: { cellAttributes?: { rows?: string; attributes?: string[] }[] }[];
  "replicate ranges"?: { range?: string; replicate?: { cellAttributes?: { rows?: string; attributes?: string[] }[] } }[];
}

/** Read one JSON file from the ZIP, or null when it is missing or isn't valid JSON. */
async function readZipJson<T>(zip: JSZip, path: string): Promise<T | null> {
  const file = zip.file(path);
  if (!file) return null;
  try {
    return JSON.parse(await file.async("string")) as T;
  } catch {
    return null;
  }
}

/**
 * Plan the graphs of a `.prism` file from its JSON sidecar, in file
 * order — one plan per graph in `document.json`'s `sheets.graphs`.
 * Shares `convertPrism`'s JSZip instance (pass the same one); never
 * unzips twice, never reads `data.bin`. Without `converted.prismIndex`
 * there is nothing to resolve against, so no plans — never guess from
 * names. A graph whose sheet is missing is still listed (title unknown),
 * with its reason.
 */
export async function planGraphRegeneration(zip: JSZip, converted: ConvertResult): Promise<GraphPlan[]> {
  const plans: GraphPlan[] = [];
  const index = converted.prismIndex;
  if (!index) return plans;
  const datasetToTable = new Map<string, PrismTableIndexEntry>();
  for (const table of index.tables) {
    for (const uid of table.datasetUids) datasetToTable.set(uid, table);
  }
  const doc = await readZipJson<{
    sheets?: { graphs?: string[] };
    sheetAttributesMap?: Record<string, { title?: string | { string?: string } }>;
  }>(zip, "document.json");
  const graphUids = doc?.sheets?.graphs ?? [];
  const titles = doc?.sheetAttributesMap ?? {};

  for (const graphUid of graphUids) {
    const proposalId = `prism:${graphUid}`;
    const sheet = await readZipJson<PrismGraphSheet>(zip, `graphs/${graphUid}/sheet.json`);
    const title =
      plainTitle(sheet?.title) || plainTitle(titles[graphUid]?.title) || "Untitled graph";
    if (!sheet) {
      plans.push({
        proposalId,
        prismTitle: title,
        sourceTableId: null,
        sourceTableName: null,
        graphType: null,
        error: null,
        origin: "sidecar",
        reconstructible: false,
        reason: "The graph's description is missing or unreadable in the file.",
      });
      continue;
    }
    const inputs = sheet.inputDataSets ?? [];
    const pushUnreconstructible = (reason: string, sourceTableId: string | null, sourceTableName: string | null) =>
      plans.push({
        proposalId,
        prismTitle: title,
        sourceTableId,
        sourceTableName,
        graphType: null,
        error: null,
        origin: "sidecar",
        reconstructible: false,
        reason,
      });
    // The no-guess rows first: a hand-made graph can't be rebuilt whatever
    // its source is, and a graph that records no source has nothing to
    // resolve — both outrank the source-resolution reasons below.
    if (sheet.isAutoCreated === false) {
      pushUnreconstructible(
        "Custom graph — it was made by hand in Prism, so it can't be reconstructed from the file.",
        null,
        null,
      );
      continue;
    }
    if (inputs.length === 0) {
      pushUnreconstructible("No source table recorded — the graph doesn't say which table it plots.", null, null);
      continue;
    }
    // Resolve every input dataset before mapping anything: a graph that
    // plots a dataset whose table didn't come across is not proposed.
    let unresolvable = false;
    let mixedTables = false;
    const resolved: { uid: string; table: PrismTableIndexEntry; set: PrismDataSetJson }[] = [];
    for (const input of inputs) {
      const uid = inputDatasetUid(input);
      const table = uid ? datasetToTable.get(uid) : undefined;
      const set = uid ? await readZipJson<PrismDataSetJson>(zip, `data/sets/${uid}.json`) : null;
      if (!uid || !table || !set) {
        unresolvable = true;
        break;
      }
      if (resolved.length > 0 && resolved[0].table.tableUid !== table.tableUid) mixedTables = true;
      resolved.push({ uid, table, set });
    }
    const first = resolved[0];
    if (unresolvable || mixedTables) {
      pushUnreconstructible(
        mixedTables
          ? "Plots datasets from more than one table — no single source table to build from."
          : "Source table not imported — the graph's table didn't come across.",
        first?.table.nodeId ?? null,
        first?.table.name ?? null,
      );
      continue;
    }
    const mapping = mapSidecarGraph({
      tableFormat: first.table.format,
      tableDataFormat: first.table.dataFormat,
      datasetFormat: first.set.format ?? "",
      subcolumnCount:
        replicateRangeProblems(first.set).length > 0
          ? null
          : replicateCount(first.set, { replicatesCount: first.table.replicatesCount }),
      isAutoCreated: true,
      hasInputDatasets: true,
      sourceResolvable: true,
      linkedAnalysisId:
        first.table.format === "xy" ? index.analysisNodeByDatasetUid[first.uid] : undefined,
      linkedAnalysisIsSigmoidal:
        first.table.format === "xy"
          ? (converted.project.nodes[index.analysisNodeByDatasetUid[first.uid]]?.analysisParams as { model?: string } | undefined)?.model?.startsWith("sigmoidal") ?? false
          : false,
      tableErrorIsSd: converted.project.nodes[first.table.nodeId]?.data?.errorFormat === "sd",
    });
    if (!mapping.reconstructible) {
      pushUnreconstructible(mapping.reason, first.table.nodeId, first.table.name);
      continue;
    }
    const linkedId = mapping.linkedAnalysisId;
    const linkedNode = linkedId ? converted.project.nodes[linkedId] : undefined;
    plans.push({
      proposalId,
      prismTitle: title,
      sourceTableId: first!.table.nodeId,
      sourceTableName: first!.table.name,
      graphType: mapping.graphType,
      error: mapping.error,
      ...(linkedId ? { linkedAnalysisId: linkedId, linkedAnalysisName: linkedNode?.name } : {}),
      origin: "sidecar",
      reconstructible: true,
      ...(mapping.derivedError ? { derivedError: mapping.derivedError } : {}),
      ...(mapping.limitNote ? { limitNote: mapping.limitNote } : {}),
      ...(mapping.adjustAlternatives ? { adjustAlternatives: mapping.adjustAlternatives } : {}),
    });
  }
  return plans;
}

// ── The .pzfx heuristic planner (design §4, rules H1–H6) ────────────────

/** The error a table's column names imply: `_SD` → sd, `_SEM`/`_SE` →
 *  sem, `_CV` → sd derived from mean × CV% / 100, `_PLUSERROR` /
 *  `_MINUSERROR` → none (asymmetric, doesn't transfer). Null when the
 *  names carry no error signal. */
function summaryErrorFromNames(names: string[]): {
  error: RegenError;
  derivedError?: string;
  limitNote?: string;
} | null {
  if (names.some((n) => /_SD$/i.test(n))) return { error: "sd" };
  if (names.some((n) => /_SEM$/i.test(n) || /_SE$/i.test(n))) return { error: "sem" };
  if (names.some((n) => /_CV$/i.test(n))) {
    return { error: "sd", derivedError: "SD derived as mean × CV% / 100 from the imported MEAN/CV/N columns." };
  }
  if (names.some((n) => /_PLUSERROR$/i.test(n) || /_MINUSERROR$/i.test(n))) {
    return {
      error: "none",
      limitNote:
        "Prism's asymmetric +/− errors don't transfer — Titer error bars are symmetric. The values stay in the table.",
    };
  }
  return null;
}

/** Whether the column names are summary subcolumns (MEAN/SD/SEM/CV/N/
 *  +error), rather than raw replicates (`_1`, `_2`, …) or single values. */
const isSummaryNames = (names: string[]): boolean =>
  names.some((n) => /_(MEAN|SD|SEM|SE|CV|N|PLUSERROR|MINUSERROR)$/i.test(n));

/** Whether the values of a column hold at least one finite number. */
function hasNumericValues(node: ProjectNode, columnIndex: number): boolean {
  return (node.data?.rows ?? []).some((row) => {
    const v = row[columnIndex];
    return v !== null && v !== "" && Number.isFinite(Number(v));
  });
}

/**
 * One proposal per imported table, from the heuristic rules H1–H6, in
 * file order. Every row is badged "Guessed from the table" with its rule
 * — Prism's graph type is not in a .pzfx file, so nothing here claims
 * to be what Prism drew. A linked nonlinear fit is never assumed for
 * .pzfx (`parsePzfx` imports no analyses).
 */
export function planPzfxGraphs(imported: PzfxImport): GraphPlan[] {
  const plans: GraphPlan[] = [];
  for (const tableId of imported.project.rootOrder) {
    const node = imported.project.nodes[tableId];
    if (!node || node.type !== "table" || !node.data) continue;
    const proposalId = `pzfx:${tableId}`;
    const tableType = node.tableType ?? "column";
    const tableDefault: RegenError = node.data.errorFormat === "sd" ? "sd" : "sem";
    const base = {
      proposalId,
      prismTitle: node.name,
      sourceTableId: tableId,
      sourceTableName: node.name,
      origin: "heuristic" as GraphPlanOrigin,
      reconstructible: true,
    };
    const guessed = (rule: "H1" | "H2" | "H3" | "H4" | "H5" | "H6") => ({ heuristicRule: rule });
    if (tableType === "survival") {
      plans.push({ ...base, graphType: "survival", error: "none", ...guessed("H1") });
    } else if (tableType === "grouped") {
      plans.push({
        ...base,
        graphType: "grouped-bars",
        error: tableDefault,
        adjustAlternatives: ["grouped-scatter", "grouped-box", "grouped-lines"],
        ...guessed("H2"),
      });
    } else if (tableType === "xy") {
      if (!hasNumericValues(node, 1)) {
        plans.push({
          ...base,
          graphType: null,
          error: null,
          reconstructible: false,
          reason: "The X column isn't numeric, so no XY graph can be drawn from it.",
        });
        continue;
      }
      // Y columns follow X (and its error column, when Prism wrote one).
      let yNames = node.data.columns.slice(2);
      if (yNames[0] === `${node.data.columns[1]} error`) yNames = yNames.slice(1);
      const summary = summaryErrorFromNames(yNames);
      const replicates = yNames.some((n) => /_\d+$/.test(n));
      const error = summary?.error ?? (replicates ? tableDefault : "none");
      plans.push({
        ...base,
        graphType: "xy-scatter",
        error,
        ...(summary?.derivedError ? { derivedError: summary.derivedError } : {}),
        ...(summary?.limitNote ? { limitNote: summary.limitNote } : {}),
        ...guessed("H3"),
      });
    } else if (tableType === "column") {
      const names = node.data.columns.slice(1);
      if (isSummaryNames(names)) {
        const summary = summaryErrorFromNames(names);
        plans.push({
          ...base,
          graphType: "mean-error",
          error: summary?.error ?? "none",
          ...(summary?.derivedError ? { derivedError: summary.derivedError } : {}),
          ...(summary?.limitNote ? { limitNote: summary.limitNote } : {}),
          ...guessed("H5"),
        });
      } else {
        plans.push({
          ...base,
          graphType: "mean-error",
          error: tableDefault,
          adjustAlternatives: ["individual", "box-violin"],
          ...guessed("H4"),
        });
      }
    } else if (tableType === "contingency") {
      plans.push({ ...base, graphType: "grouped-bars", error: "none", ...guessed("H6") });
    } else {
      plans.push({
        ...base,
        graphType: null,
        error: null,
        reconstructible: false,
        reason: `No heuristic rule covers a ${tableType} table.`,
      });
    }
  }
  return plans;
}

/** How many of the plans can be built, for `titer_import_prism`'s counts. */
export function regenPlanCounts(plans: GraphPlan[]): { regenerable: number; notRegenerable: number } {
  return {
    regenerable: plans.filter((p) => p.reconstructible).length,
    notRegenerable: plans.filter((p) => !p.reconstructible).length,
  };
}

// ── The import-time plan registry ────────────────────────────────────────

/**
 * The current window's import-time plans (see the module docs). One set
 * per webview — one live project at a time. The UI import paths store
 * `null` as the project id (the frontend doesn't know its window label);
 * the MCP import job stores the resolved id, so its reads can check it.
 */
let storedPlans: { projectId: string | null; plans: GraphPlan[] } | null = null;

export function setRegenPlans(projectId: string | null, plans: GraphPlan[]): void {
  storedPlans = { projectId, plans };
}

export function getRegenPlans(projectId?: string | null): GraphPlan[] | null {
  if (!storedPlans) return null;
  if (projectId != null && storedPlans.projectId != null && storedPlans.projectId !== projectId) return null;
  return storedPlans.plans;
}

export function clearRegenPlans(): void {
  storedPlans = null;
}

// ── Applying decisions (the UI dialog and the MCP tool share this) ───────

export interface RegenDecision {
  proposalId: string;
  action: "confirm" | "skip";
  overrides?: {
    graphType?: string;
    error?: string;
    name?: string;
    /** null clears the proposed link. */
    linkedAnalysisId?: string | null;
  };
}

export interface RegenDeps {
  getState: () => { nodes: Record<string, ProjectNode> };
  createGraph: (parentId: string, graphType: GraphType, graphOptions?: GraphOptions) => string;
  renameNode: (id: string, name: string) => void;
}

export interface RegenReport {
  created: { graphId: string; graphType: GraphType; name: string; origin: GraphPlanOrigin }[];
  skipped: { proposalId: string; prismTitle: string }[];
  notReconstructible: { proposalId: string; prismTitle: string; reason: string }[];
  warnings: string[];
}

const ERROR_CHOICES: readonly string[] = ["none", "sd", "sem", "ci"];

/**
 * Create the confirmed graphs, exactly as the preview / MCP decisions
 * say. One decision per proposal is REQUIRED — no "create all", no
 * undecided proposal, unknown ids rejected. A confirmed row is validated
 * like `titer_build_graph`: the type must be offered for the table
 * (`GRAPH_OPTIONS_BY_TABLE`), the error must be a choice, the name
 * non-empty, a linked analysis must exist and belong to the same table.
 * Creation reuses the one graph path (`createGraph` +
 * `newGraphOptions`); the link goes through `remapGraphOptions` with an
 * identity map, so a link whose analysis is gone is dropped with a
 * warning instead of pointing at nothing. Throws on the first invalid
 * decision — nothing is created when the decisions don't validate: the
 * run is two passes, a validate pass over every decision first and a
 * create pass second, so a bad decision at index N never leaves index
 * 0..N-1's graphs behind for a retry to duplicate.
 * (The caller clears the plans once the run is done: the offer is
 * import-time, and a second run would rebuild the same graphs.)
 */
export function applyRegenDecisions(plans: GraphPlan[], decisions: RegenDecision[], deps: RegenDeps): RegenReport {
  if (plans.length === 0) {
    throw new Error(
      "This project has no import-time graph plans — import a .prism or .pzfx file first, then regenerate its graphs.",
    );
  }
  const byId = new Map(plans.map((p) => [p.proposalId, p]));
  const seen = new Set<string>();
  for (const d of decisions) {
    if (seen.has(d.proposalId)) throw new Error(`Two decisions for “${d.proposalId}” — one decision per proposed graph.`);
    seen.add(d.proposalId);
    if (!byId.has(d.proposalId)) throw new Error(`Unknown proposal “${d.proposalId}” — list the regenerable graphs first.`);
    if (d.action !== "confirm" && d.action !== "skip") {
      throw new Error(`Decision for “${d.proposalId}” must be "confirm" or "skip", not “${String(d.action)}”.`);
    }
  }
  const missing = plans.filter((p) => !seen.has(p.proposalId));
  if (missing.length > 0) {
    throw new Error(
      `One decision per proposed graph is required — no decision for: ${missing.map((p) => `“${p.prismTitle}”`).join(", ")}.`,
    );
  }
  const state = deps.getState();
  const report: RegenReport = { created: [], skipped: [], notReconstructible: [], warnings: [] };
  // Pass 1 — validate EVERY decision's content before creating anything.
  // A bad decision at index N must not leave index 0..N-1's graphs
  // behind: the caller clears the plans after the run, so a retry would
  // rebuild them and duplicate the graphs. This pass only reads state
  // and fills the report's skip rows; the remap runs here too because it
  // is pure, and a dropped link is a warning, not a mutation.
  const resolvedById = new Map<
    string,
    { plan: GraphPlan; graphType: GraphType; options: GraphOptions; name: string }
  >();
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i];
    const decision = decisions.find((d) => d.proposalId === plan.proposalId)!;
    if (!plan.reconstructible) {
      if (decision.action === "confirm") {
        throw new Error(`“${plan.prismTitle}” can't be rebuilt (${plan.reason ?? "no confident mapping"}) — skip it instead.`);
      }
      report.notReconstructible.push({ proposalId: plan.proposalId, prismTitle: plan.prismTitle, reason: plan.reason ?? "" });
      continue;
    }
    if (decision.action === "skip") {
      report.skipped.push({ proposalId: plan.proposalId, prismTitle: plan.prismTitle });
      continue;
    }
    const tableId = plan.sourceTableId!;
    const table = state.nodes[tableId];
    if (!table || table.type !== "table") {
      throw new Error(`The source table for “${plan.prismTitle}” is gone — the project changed since the import.`);
    }
    const tableType = table.tableType ?? "column";
    const graphType = (decision.overrides?.graphType ?? plan.graphType) as GraphType;
    const offered = GRAPH_OPTIONS_BY_TABLE[tableType].map((o) => o.value);
    if (!(offered as readonly string[]).includes(graphType)) {
      throw new Error(
        `Graph type “${graphType}” is not offered for a ${tableType} table — the types for this table are: ${offered.join(", ")}.`,
      );
    }
    const error = (decision.overrides?.error ?? plan.error ?? "none") as RegenError;
    if (!ERROR_CHOICES.includes(error)) {
      throw new Error(`Error bars for “${plan.prismTitle}” must be one of: ${ERROR_CHOICES.join(", ")}.`);
    }
    const name = decision.overrides?.name !== undefined ? decision.overrides.name : plan.prismTitle;
    if (typeof name !== "string" || name.trim() === "") {
      throw new Error(`The graph name for “${plan.prismTitle}” must not be empty.`);
    }
    // The linked analysis: the proposal's, unless the decision clears or
    // replaces it. It must exist and belong to this table, and only an XY
    // scatter (or logistic curve) draws a regression on it.
    const linkedId =
      decision.overrides && "linkedAnalysisId" in decision.overrides
        ? decision.overrides.linkedAnalysisId
        : plan.linkedAnalysisId;
    let regAnalysisId: string | undefined;
    if (linkedId !== undefined && linkedId !== null) {
      if (graphType !== "xy-scatter" && graphType !== "logistic-curve") {
        throw new Error(
          `A linked analysis only applies to an XY scatter graph (regAnalysisId) — not to “${graphType}”.`,
        );
      }
      const analysis = state.nodes[linkedId];
      if (!analysis || analysis.type !== "analysis") {
        throw new Error(`No analysis with id “${linkedId}” — list the project's analyses first.`);
      }
      if (analysis.parentId !== tableId) {
        throw new Error(`Analysis “${analysis.name}” belongs to another table, not “${table.name}”.`);
      }
      regAnalysisId = linkedId;
    }
    const tableError: TableErrorFormat | undefined = error === "sd" || error === "sem" ? error : undefined;
    const options: GraphOptions = {
      ...newGraphOptions(graphType, tableError),
      error,
      title: name,
      ...(regAnalysisId ? { regAnalysisId } : {}),
    };
    // The link rides the same remap the method-file apply path uses: an
    // identity map, so a link whose analysis vanished since the import is
    // dropped (and warned about) instead of pointing at nothing.
    const idMap: Record<string, string> = regAnalysisId ? { [regAnalysisId]: regAnalysisId } : {};
    const { options: remapped, dropped } = remapGraphOptions(options, idMap);
    if (dropped.includes("regAnalysisId")) {
      report.warnings.push(`“${name}”: the linked analysis is gone, so the graph was built without it.`);
    }
    resolvedById.set(plan.proposalId, { plan, graphType, options: remapped ?? options, name });
  }
  // Pass 2 — create exactly what pass 1 validated, in plan order. By
  // here nothing can throw for a bad decision, so a run either creates
  // every confirmed graph or none at all.
  for (const plan of plans) {
    const item = resolvedById.get(plan.proposalId);
    if (!item) continue;
    const graphId = deps.createGraph(plan.sourceTableId!, item.graphType, item.options);
    deps.renameNode(graphId, item.name);
    report.created.push({ graphId, graphType: item.graphType, name: item.name, origin: plan.origin });
  }
  return report;
}
