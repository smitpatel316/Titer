import * as React from "react";

import {
  NODE_NAMES,
  type ArrangeOp,
  type DrawingObject,
  type FloatingNote,
  type InfoSheetData,
  type NodeType,
  type ProjectNode,
  type ProjectScript,
  type SheetHighlight,
  type TableData,
  type TableType,
  type GraphType,
  type GraphOptions,
  type TagColor,
  type Transform,
} from "./types";
import { TRANSFORM_NAMES, transformTable } from "../lib/transform";
import { recomputeCalculated } from "../lib/calcvars";
import { refreshLevelOrder, refreshVariableTypes } from "../lib/variable-types";
import { remapQualifiedOptions, restoreForeignPoints } from "../lib/multi-table";
import { MAX_INFO_SHEETS, newInfoSheetData } from "../lib/info-sheets";
import { loadAutoCreateInfo, loadAutocompleteTitles } from "../lib/preferences";
import type { AnalysisParams, AnalysisPickerValue, AnalysisResult, AnalysisType } from "../stats/types";
import { resolveAnalysis, type PluginAnalysisResult, type PluginParamValues } from "../plugins";
import { TABLES } from "../views/tables";
import { convertColumnToNested, type ConvertToNestedSpec } from "../views/tables/table-data";
import { GRAPHS, GRAPH_OPTIONS_BY_TABLE, newGraphOptions } from "../views/graphs";
import { GRAPH_ANALYSIS_ID_KEYS, type TemplateKind } from "../lib/template";
import { analysisTitle } from "../stats";
import { followTable, type TableMove } from "./references";
import { pushHistory } from "../lib/sheet-navigation";
import { repointCandidates } from "../lib/repoint-analysis";
import { dependentAnalyses } from "../lib/dataset-manager";
import { applyWand as planWand, type WandReport } from "../lib/wand";
import type { CellBackgroundColor } from "../lib/cell-colors";
import { cloneGraphPlan, type CloneOptions, type ClonePlan } from "../lib/clone-graph";
import { createSampleNode, type FlowCompensationRef, type FlowSampleRef } from "../flow/sample";
import { DEFAULT_FIGURE_DPI, DEFAULT_FIGURE_SIZE, DEFAULT_LABEL_STYLE, newFigurePanels } from "../lib/figure";
import { clearRegenPlans } from "../lib/prism-graph-regen";
import type { FigureGrid, FigureLabelStyle, FigurePanel, FigureSize, Resolution, SharedLegend } from "./types";

export type { ProjectNode } from "./types";

/** What the universal selector is currently choosing. */
/** The Preferences dialog's sections (seq 225). */
export type PreferenceSection = "general" | "data-entry" | "appearance" | "graphs" | "files" | "ai" | "feedback" | "print";

type Selector =
  | { kind: "new-table" }
  | { kind: "new-analysis"; tableId: string; forGraph?: ForGraph }
  | { kind: "analysis-params"; tableId: string; testType: AnalysisPickerValue; forGraph?: ForGraph }
  | { kind: "edit-analysis-params"; nodeId: string }
  | { kind: "new-graph"; tableId: string }
  | { kind: "wand"; tableId: string }
  | { kind: "clone-graph"; graphId: string }
  | { kind: "simulate-data"; tableId: string }
  | { kind: "convert-to-nested"; tableId: string }
  // Sample size & power (seq 207): a guided calculator with no table and
  // no project — the selector carries no table id by design.
  | { kind: "sample-size-power" }
  | { kind: "go-to-sheet" }
  | { kind: "script" }
  | { kind: "converter" }
  | { kind: "save-prompt" }
  | { kind: "rename-project" }
  | { kind: "save-template"; templateKind: TemplateKind }
  | { kind: "conflict" }
  | { kind: "remote-picker" }
  | { kind: "cloud-settings" }
  | { kind: "ai-connections" }
  // Marketplace (M2, seq 434): the in-app plugin store.
  | { kind: "marketplace" }
  | { kind: "preferences"; section?: PreferenceSection }
  | { kind: "export-all-graphs" };

/** An analysis made for a graph's stars: of the data sets it shows (its wizard's data set
 *  questions answered with them), then chosen for it, the graph staying in front. */
export interface ForGraph {
  id: string;
  sets: string[];
}

/** The project's content: what a file holds, and what Undo brings back. */
interface Content {
  nodes: Record<string, ProjectNode>;
  /** The tables, in sidebar order. */
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
  /** The script-set project name (v2 item 6). */
  projectName?: string;
  /** The project's saved Prism scripts (seq 228). */
  scripts?: ProjectScript[];
}

interface ProjectState extends Content {
  activeNodeId: string | null;
  /** The sheets visited, oldest first (seq 240): Previous Sheet walks
   *  back through it. Navigation state, not content — undo never
   *  restores it, and it is never saved. */
  recentNodeIds: string[];
  /** Unknown keys from a newer/hand-edited file's envelopes (FF-F12), carried through save. */
  fileUnknowns?: Record<string, unknown>;
  projectUnknowns?: Record<string, unknown>;
  selector: Selector | null;
  /** Path of the `.hlx` file this project was opened from / last saved to. */
  filePath: string | null;
  /** True if there are changes since the last save. Drives the close-button dot. */
  isDirty: boolean;
  /** Monotonic content-revision counter, bumped on every mutating action. A save
   *  snapshots it before writing and only clears `isDirty` if it hasn't changed
   *  by the time the (async) write resolves — so an edit made mid-save is never
   *  silently marked "saved". */
  revision: number;
  /** The last opening's failure, if this window's file failed to load —
   *  the same message the GUI shows. Cleared by the next successful load,
   *  so the MCP server can tell a failed open from a slow one. Not content:
   *  never undoable, never dirtying, never saved. */
  openError: string | null;
  /** Undo and Redo: the content before each change (newest last), and after each undo,
   *  each with the change's name for the Edit menu ("Undo Paste"). */
  past: Step[];
  future: Step[];
  /** The last change, so quick edits to the same graph (typing a title) undo together. */
  lastChange: { key: string; at: number } | null;
}

type Step = { label: string; content: Content };

const MAX_UNDO = 100;
// Changes to one graph closer together than this undo as one.
const MERGE_MS = 1000;

type Action =
  | { type: "create"; node: ProjectNode }
  | {
      type: "applyWand";
      nodes: Record<string, ProjectNode>;
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
    }
  /** `plan` comes from `cloneGraphPlan` (src/lib/clone-graph.ts): the new
   *  nodes and the orders with them in place. One undo step takes the whole
   *  clone back. */
  | { type: "cloneGraph"; plan: ClonePlan }
  /** File ▸ Merge (seq 180): `mergeProjects` (src/lib/project-merge.ts)
   *  already built the merged content — one swap, one undo step, and the
   *  active sheet stays where it was. */
  | {
      type: "mergeProject";
      nodes: Record<string, ProjectNode>;
      rootOrder: string[];
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
    }
  | { type: "setActive"; id: string | null }
  | { type: "rename"; id: string; name: string }
  | { type: "remove"; id: string }
  /** The view's last successful live run, kept on the node so a frozen or
   *  orphaned sheet can show it. Not an Undo step (a snapshot, not an edit),
   *  but it does dirty the file — the result is saved with the node. */
  | { type: "cacheAnalysisResult"; id: string; result: AnalysisResult | PluginAnalysisResult }
  /** Freeze (or unfreeze) a results sheet: frozen, it shows its cached
   *  result and stops auto-updating when the data change. */
  | { type: "setAnalysisFrozen"; id: string; frozen: boolean }
  /** Freeze (or unfreeze) a data table: frozen, it can't be edited until
   *  unfrozen (Prism's Freeze Sheet). */
  | { type: "setTableFrozen"; id: string; frozen: boolean }
  /** Replace an analysis node's params (a rerun with overrides, via MCP):
   *  the next run — and the UI — see the new params. Orphaned sheets
   *  keep their params (their source table is gone). `name` renames the node
   *  in the same undo step (Change Parameters Apply, seq 373 follow-up):
   *  the title tracks the params. Absent, the title is left alone (the MCP
   *  rerun path, which passes no name). */
  | { type: "setAnalysisParams"; id: string; params: AnalysisParams; name?: string }
  /** Move an orphaned analysis under another table that offers its test
   *  (seq 242): the saved results stay until the re-run lands, and the
   *  orphan flag + source name go away. Refuses anything else. */
  | { type: "repointAnalysis"; id: string; tableId: string }
  /** Change a graph's type (seq 244): the new type's defaults, keeping
   *  the title and the size, and the graph renamed for its new type.
   *  `options` overrides the defaults wholesale (the MCP path, which
   *  merged the caller's options over them already). Refuses a type the
   *  table doesn't offer. */
  | { type: "changeGraphType"; id: string; graphType: GraphType; options?: GraphOptions }
  /** Duplicates a data table together with its analyses and graphs (its family):
   *  the copy takes new data and its analyses follow the copy (Prism 10,
   *  "Repeating an analysis"). Figures are not part of a family and stay put. */
  | { type: "duplicateFamily"; id: string }
  /** A new data table with its first graph, as one change (seq 232): the
   *  graph is the first type the table offers, with its defaults. */
  | { type: "createTableWithGraph"; tableType: TableType }
  /** Duplicates one sheet and nothing else (seq 236): the clone takes a
   *  fresh id and a uniquified name and lands right after its source. A
   *  table's children stay behind — Duplicate Family is the one that
   *  copies them. */
  | { type: "duplicateNode"; id: string }
  /** Freeze (or unfreeze) a graph or a figure (seq 237): freezing
   *  snapshots the parent tables' data onto the node, so the sheet draws
   *  the snapshot while the live data keep changing; unfreezing drops the
   *  snapshot and the sheet draws live again. `kind` names the sheet for
   *  the Edit menu ("Undo Freeze Graph"). */
  | { type: "setGraphFrozen"; id: string; kind: "graph" | "figure"; frozen: boolean }
  /** Text/drawing/picture objects on a graph or figure sheet (seq 238):
   *  add one, change one (its id and kind never change), delete one, or
   *  rearrange a selection (stacking order, copy, group/ungroup, delete). */
  | { type: "addDrawingObject"; nodeId: string; object: DrawingObject }
  | {
      type: "updateDrawingObject";
      nodeId: string;
      objectId: string;
      patch: Partial<Omit<DrawingObject, "id" | "kind">>;
    }
  | { type: "deleteDrawingObject"; nodeId: string; objectId: string }
  | { type: "arrangeDrawingObjects"; nodeId: string; op: ArrangeOp; objectIds: string[] }
  /** `label` names the edit in the Edit menu; `move`: what it renamed or moved. */
  | { type: "updateTable"; id: string; data: TableData; label: string; move?: TableMove }
  /** Remove one data set from a table (seq 309): the table takes its new
   *  data (one undo step with the orphaning), and the analyses that ran on
   *  `setName` become orphaned — frozen results, re-pointable via seq 242 —
   *  as when their table is deleted. */
  | { type: "removeDataSet"; id: string; data: TableData; setName: string; label: string }
  /** Rebuild a Column table as Nested (seq 450): `data` is the table after
   *  the conversion (one undo step with the orphaning), and the analyses
   *  that ran on the Column table become orphaned — frozen results,
   *  re-pointable via seq 242 — as when their table is deleted: a column
   *  test does not run on a nested table. */
  | { type: "convertTableToNested"; id: string; data: TableData; label: string }
  | { type: "updateGraph"; id: string; options: GraphOptions; at: number }
  /** A graph's extra source tables (#48): the ids, in order; empty clears
   *  them (the graph goes back to its primary table alone). */
  | { type: "setGraphSources"; id: string; sourceTableIds: string[]; at: number }
  | { type: "setNotes"; id: string; notes: string; at: number }
  | { type: "setTags"; id: string; tags: TagColor[] }
  /** Replace the project's saved scripts (seq 228) — the Run Script
   *  dialog's Save/Delete and the hooks' checkboxes, one undo step. */
  | { type: "setScripts"; scripts: ProjectScript[] }
  /** Batch Magic: several graphs at once, in one undo step. */
  | { type: "updateGraphs"; updates: { id: string; options: GraphOptions }[]; at: number }
  | { type: "updateInfoSheet"; id: string; info: InfoSheetData; at: number }
  | { type: "updateFloatingNotes"; id: string; notes: FloatingNote[]; at: number }
  /** `highlight`: the sheet's Navigator color, or null to clear it. */
  | { type: "setHighlight"; id: string; highlight: SheetHighlight | null }
  /** Paint (or clear) one results-table cell (seq 325): `key` is a
   *  `"section|row|col"` address, `color` one of Prism's 8 names or null
   *  to clear it. Presentation only — the values never change. */
  | { type: "setResultCellBackground"; id: string; key: string; color: CellBackgroundColor | null }
  /** Compensation applied to a flow sample (seq 447): the matrix +
   *  applied flag recorded on the sample node. */
  | { type: "updateFlowSampleCompensation"; id: string; compensation: FlowCompensationRef; at: number }
  | {
      type: "updateFigure";
      id: string;
      patch: Partial<{
        panels: FigurePanel[];
        grid: FigureGrid;
        figureSize: FigureSize;
        labelStyle: FigureLabelStyle;
        figureTitle: string;
        sharedLegend: SharedLegend;
        dpi: Resolution;
      }>;
      at: number;
    }
  | { type: "undo" }
  | { type: "redo" }
  /** A Prism script's run, as one change ("Run Script"): the engine's whole
   *  resulting project, so one run is one undo step. */
  | {
      type: "applyScript";
      nodes: Record<string, ProjectNode>;
      rootOrder: string[];
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
      projectName?: string;
    }
  | { type: "openSelector"; selector: Selector }
  | { type: "closeSelector" }
  /** The window's file failed to open (or the record clears): the MCP
   *  server reads it from the snapshot. Not an edit — no revision bump,
   *  no dirty flag, no undo step. */
  | { type: "setOpenError"; error: string | null }
  | { type: "reorderRoot"; order: string[] }
  | { type: "reorderChildren"; parentId: string; order: string[] }
  | {
      type: "load";
      nodes: Record<string, ProjectNode>;
      rootOrder: string[];
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
      projectName?: string;
      scripts?: ProjectScript[];
      fileUnknowns?: Record<string, unknown>;
      projectUnknowns?: Record<string, unknown>;
      filePath: string | null;
      /** Changed as it was read (repaired, or from an older Titer): to be saved. */
      edited?: boolean;
    }
  | { type: "markSaved"; filePath: string | null; savedRevision: number }
  /** The file moved on disk (File ▸ Rename… / Move To…, seq 297): the path
   *  changes, nothing else — not in MUTATING, so the revision doesn't move
   *  and the dirty flag stays exactly as it was. */
  | { type: "relocate"; filePath: string };

function nextName(prefix: string, taken: string[]): string {
  const used = new Set<number>();
  const re = new RegExp(`^${prefix} (\\d+)$`);
  for (const n of taken) {
    const m = n.match(re);
    if (m) used.add(parseInt(m[1], 10));
  }
  let i = 1;
  while (used.has(i)) i++;
  return `${prefix} ${i}`;
}

/** `base`, or `base 2`, `base 3`… when a sibling already has it. */
function uniqueName(base: string, taken: string[]): string {
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  return name;
}

function genId(type: NodeType): string {
  return `${type}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A drawing object's id, like the store's `genId` (seq 238). */
function drawingId(): string {
  return `drawing_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeInitialState(): ProjectState {
  const first: ProjectNode = {
    id: genId("table"),
    type: "table",
    name: "Table 1",
    parentId: null,
    tableType: "column",
    data: TABLES.column.defaultData(),
  };
  return {
    nodes: { [first.id]: first },
    rootOrder: [first.id],
    childOrder: { [first.id]: [] },
    activeNodeId: first.id,
    recentNodeIds: [first.id],
    selector: null,
    filePath: null,
    isDirty: false,
    revision: 0,
    openError: null,
    past: [],
    future: [],
    lastChange: null,
  };
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function applyAction(state: ProjectState, action: Action): ProjectState {
  switch (action.type) {
    case "create": {
      const pid = action.node.parentId;
      if (pid !== null && state.nodes[pid]?.type !== "table") return state;
      // Prism caps a project at 500 info sheets.
      if (
        action.node.type === "info" &&
        Object.values(state.nodes).filter((n) => n.type === "info").length >= MAX_INFO_SHEETS
      )
        return state;
      // Named among the names taken now: a table "Table N" (the smallest free N), an
      // analysis or a graph what it is, with " 2" when a sibling has the name.
      const taken = (pid === null ? state.rootOrder : (state.childOrder[pid] ?? [])).map(
        (id) => state.nodes[id]?.name ?? "",
      );
      // A table computed from another keeps its "<source>, <Transform>" name:
      // numbering it ("…, Log10 1") would hide what it is.
      const from = action.node.transform?.from;
      const name = pid === null && !from ? nextName(action.node.name, taken) : uniqueName(action.node.name, taken);
      const node = { ...action.node, name };
      const nodes = { ...state.nodes, [node.id]: node };
      // A new table goes before the first info sheet or figure at the
      // project root: parseProjectFile reorders rootOrder
      // tables-then-infos-then-figures, so a table after an info sheet or
      // figure would mark every save/load round-trip as updated (#22).
      // An info sheet goes before the first figure (after the tables).
      // Figures still append at the end.
      // A table computed from another goes right after its source instead.
      const firstInfo =
        node.type === "table" ? state.rootOrder.findIndex((id) => state.nodes[id]?.type === "info") : -1;
      const firstFigure =
        node.type === "table" || node.type === "info"
          ? state.rootOrder.findIndex((id) => state.nodes[id]?.type === "figure")
          : -1;
      const insertAt =
        node.type === "table"
          ? firstInfo === -1
            ? firstFigure
            : firstFigure === -1 || firstInfo < firstFigure
              ? firstInfo
              : firstFigure
          : firstFigure;
      const afterSource = from ? state.rootOrder.indexOf(from) : -1;
      const rootOrder =
        pid === null
          ? afterSource >= 0
            ? [...state.rootOrder.slice(0, afterSource + 1), node.id, ...state.rootOrder.slice(afterSource + 1)]
            : insertAt === -1
              ? [...state.rootOrder, node.id]
              : [...state.rootOrder.slice(0, insertAt), node.id, ...state.rootOrder.slice(insertAt)]
          : state.rootOrder;
      const childOrder =
        pid === null
          ? { ...state.childOrder, [node.id]: [] } // a new table starts empty
          : { ...state.childOrder, [pid]: [...(state.childOrder[pid] ?? []), node.id] };
      return {
        ...state,
        nodes,
        rootOrder,
        childOrder,
        activeNodeId: node.id,
        recentNodeIds: pushHistory(state.recentNodeIds, node.id),
        isDirty: true,
      };
    }
    case "applyWand": {
      // The planner (src/lib/wand.ts) already built the new content: one swap,
      // one undo step, and the first created node becomes the active one.
      return { ...state, nodes: action.nodes, childOrder: action.childOrder, activeNodeId: action.activeNodeId, isDirty: true };
    }
    case "setActive":
      return {
        ...state,
        activeNodeId: action.id,
        recentNodeIds: action.id ? pushHistory(state.recentNodeIds, action.id) : state.recentNodeIds,
      };
    case "cloneGraph":
      return {
        ...state,
        nodes: { ...state.nodes, ...action.plan.nodes },
        rootOrder: action.plan.rootOrder,
        childOrder: action.plan.childOrder,
        activeNodeId: action.plan.activeNodeId,
        isDirty: true,
      };
    case "mergeProject":
      return {
        ...state,
        nodes: action.nodes,
        rootOrder: action.rootOrder,
        childOrder: action.childOrder,
        activeNodeId: action.activeNodeId,
        isDirty: true,
      };
    case "rename": {
      const node = state.nodes[action.id];
      if (!node || node.name === action.name) return state;
      const nodes = { ...state.nodes, [action.id]: { ...node, name: action.name } };
      if (node.type === "table") {
        // A source table's name is baked into the qualified series names
        // of the graphs that plot it ("Assay 2 — Control"), so renaming
        // the table re-qualifies those graphs' options with it.
        for (const g of Object.values(nodes)) {
          if (g.type !== "graph" || !g.sourceTableIds?.includes(action.id) || !g.graphOptions) continue;
          const remapped = remapQualifiedOptions(g.graphOptions, node.name, action.name);
          if (remapped) nodes[g.id] = { ...g, graphOptions: remapped };
        }
      }
      return { ...state, nodes, isDirty: true };
    }
    case "remove": {
      const target = state.nodes[action.id];
      const remove = new Set<string>([action.id]);
      // Deleting a data table orphans its analyses (Prism: the results stay,
      // viewable but unchangeable) and deletes its graphs (their data is gone).
      const orphaned: ProjectNode[] = [];
      for (const n of Object.values(state.nodes)) {
        if (n.parentId !== action.id) continue;
        if (target?.type === "table" && n.type === "analysis") orphaned.push(n);
        else remove.add(n.id);
      }
      const nodes: Record<string, ProjectNode> = {};
      for (const [id, n] of Object.entries(state.nodes)) {
        if (remove.has(id)) continue;
        const orphan = orphaned.find((o) => o.id === id);
        // Deleting a table unlinks the info sheets tied to it (they stay,
        // as project info); deleting anything else leaves links alone.
        const unlinked =
          n.type === "info" && n.info?.linkedTableId && remove.has(n.info.linkedTableId)
            ? { ...n, info: { ...n.info, linkedTableId: null } }
            : n;
        // A table computed from the one removed keeps its values, which can be typed from then on.
        const detached =
          unlinked.transform && remove.has(unlinked.transform.from)
            ? (({ transform: _, ...rest }) => rest)(unlinked)
            : unlinked;
        // A graph that plotted the removed table as an extra source (#48)
        // drops that source and keeps plotting the rest; a graph whose
        // primary table was removed is itself removed above.
        const unsourced =
          detached.type === "graph" && detached.sourceTableIds?.some((id) => remove.has(id))
            ? (() => {
                const kept = detached.sourceTableIds.filter((id) => !remove.has(id));
                const next = { ...detached };
                if (kept.length) next.sourceTableIds = kept;
                else delete next.sourceTableIds;
                return next;
              })()
            : detached;
        nodes[id] = orphan
          ? { ...orphan, parentId: null, orphaned: true, sourceTableName: target?.name }
          : unsourced;
      }
      const rootOrder = [...state.rootOrder.filter((id) => !remove.has(id)), ...orphaned.map((o) => o.id)];
      // Drop removed tables' order lists, and removed children from surviving lists.
      const childOrder: Record<string, string[]> = {};
      for (const [pid, ids] of Object.entries(state.childOrder)) {
        if (remove.has(pid)) continue;
        childOrder[pid] = ids.filter((id) => !remove.has(id));
      }
      // If the active node was removed, fall back to a surviving table rather
      // than dropping to the empty state while other tables still exist.
      const activeNodeId =
        state.activeNodeId && remove.has(state.activeNodeId) ? (rootOrder[0] ?? null) : state.activeNodeId;
      return { ...state, nodes, rootOrder, childOrder, activeNodeId, isDirty: true };
    }
    case "cacheAnalysisResult": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis" || node.frozen || node.orphaned) return state;
      if (node.cachedResult === action.result) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, cachedResult: action.result } },
        isDirty: true,
      };
    }
    case "setAnalysisFrozen": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis" || node.orphaned) return state;
      if (node.frozen === true ? action.frozen : !action.frozen) return state;
      const next = { ...node };
      if (action.frozen) next.frozen = true;
      else delete next.frozen;
      return { ...state, nodes: { ...state.nodes, [action.id]: next }, isDirty: true };
    }
    case "setTableFrozen": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table") return state;
      if (node.frozen === true ? action.frozen : !action.frozen) return state;
      const next = { ...node };
      if (action.frozen) next.frozen = true;
      else delete next.frozen;
      return { ...state, nodes: { ...state.nodes, [action.id]: next }, isDirty: true };
    }
    case "setAnalysisParams": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis" || node.orphaned) return state;
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [action.id]: {
            ...node,
            analysisParams: action.params,
            ...(action.name !== undefined ? { name: action.name } : {}),
          },
        },
        isDirty: true,
      };
    }
    case "repointAnalysis": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis" || !node.orphaned) return state;
      const table = state.nodes[action.tableId];
      if (!table || table.type !== "table") return state;
      if (!repointCandidates(node, state.nodes).some((t) => t.id === action.tableId)) return state;
      // The saved results stay (the re-run lands on next view); the orphan
      // flag is cleared explicitly and the source name and the removed set
      // go away with it — the reader drops orphanedDataSet whenever the
      // analysis isn't orphaned, so keeping it would reopen as updated.
      const { sourceTableName: _, orphanedDataSet: _removed, ...kept } = node;
      const nodes = {
        ...state.nodes,
        [action.id]: { ...kept, parentId: action.tableId, orphaned: false },
      };
      return {
        ...state,
        nodes,
        rootOrder: state.rootOrder.filter((id) => id !== action.id),
        childOrder: {
          ...state.childOrder,
          [action.tableId]: [...(state.childOrder[action.tableId] ?? []), action.id],
        },
        activeNodeId: action.id,
        isDirty: true,
      };
    }
    case "changeGraphType": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "graph" || node.graphType === action.graphType) return state;
      const table = node.parentId ? state.nodes[node.parentId] : undefined;
      if (!table || table.type !== "table") return state;
      const tableType = table.tableType;
      if (!tableType) return state;
      if (!GRAPH_OPTIONS_BY_TABLE[tableType].some((o) => o.value === action.graphType)) return state;
      const oldOptions = node.graphOptions;
      const options = action.options ?? {
        ...newGraphOptions(action.graphType, table.data?.errorFormat),
        ...(oldOptions ? { title: oldOptions.title, width: oldOptions.width, height: oldOptions.height } : {}),
      };
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [action.id]: { ...node, graphType: action.graphType, name: GRAPHS[action.graphType].label, graphOptions: options },
        },
        isDirty: true,
      };
    }
    case "duplicateFamily": {
      const source = state.nodes[action.id];
      if (!source || source.type !== "table") return state;
      // The copy's name: "<source> copy", uniquified among the root tables
      // ("<source> copy 2", …) when a copy already exists.
      const taken = state.rootOrder.map((id) => state.nodes[id]?.name ?? "");
      const newTableId = genId("table");
      const copy: ProjectNode = {
        ...source,
        id: newTableId,
        name: uniqueName(`${source.name} copy`, taken),
        data: source.data ? JSON.parse(JSON.stringify(source.data)) : undefined,
        floatingNotes: source.floatingNotes
          ? JSON.parse(JSON.stringify(source.floatingNotes))
          : undefined,
      };
      // A frozen table's copy starts editable: freezing is the source's
      // state, not the copy's (seq 165).
      delete copy.frozen;
      // Every child (analysis or graph, in sidebar order) is cloned with a
      // fresh id and re-parented to the copy; its params/options are deep
      // copies, so editing the copy's family never touches the source's.
      const childIds = state.childOrder[action.id] ?? [];
      // Pass 1 — fresh ids for every child, before any link is remapped: a
      // graph's link may point at an analysis cloned later in the order.
      const idMap: Record<string, string> = {};
      for (const childId of childIds) {
        const child = state.nodes[childId];
        if (child) idMap[childId] = genId(child.type);
      }
      const clonedChildren: ProjectNode[] = childIds.flatMap((childId) => {
        const child = state.nodes[childId];
        if (!child) return [];
        // A cloned graph's analysis links re-point at the cloned analyses
        // (Issue 18): without this the copy plots the new table's points
        // under the ORIGINAL table's regression line, significance stars,
        // PCA biplot or clusters — and deleting the original then leaves
        // dangling links. A link to an analysis outside this family was
        // not cloned, so it keeps pointing at the original: the analysis
        // still exists, exactly as Clone Graph does.
        let graphOptions = child.graphOptions
          ? JSON.parse(JSON.stringify(child.graphOptions))
          : undefined;
        if (graphOptions) {
          const options = graphOptions as Record<string, unknown>;
          for (const key of GRAPH_ANALYSIS_ID_KEYS) {
            const id = options[key];
            if (typeof id === "string" && idMap[id]) options[key] = idMap[id];
          }
          if (Array.isArray(options.sigAnalysisIds)) {
            options.sigAnalysisIds = (options.sigAnalysisIds as unknown[]).map((id) =>
              typeof id === "string" && idMap[id] ? idMap[id] : id,
            );
          }
        }
        return [
          {
            ...child,
            id: idMap[childId],
            parentId: newTableId,
            analysisParams: child.analysisParams
              ? JSON.parse(JSON.stringify(child.analysisParams))
              : undefined,
            graphOptions,
            floatingNotes: child.floatingNotes
              ? JSON.parse(JSON.stringify(child.floatingNotes))
              : undefined,
          },
        ];
      });
      const nodes = { ...state.nodes, [newTableId]: copy };
      for (const child of clonedChildren) nodes[child.id] = child;
      const sourceIndex = state.rootOrder.indexOf(action.id);
      const rootOrder = [
        ...state.rootOrder.slice(0, sourceIndex + 1),
        newTableId,
        ...state.rootOrder.slice(sourceIndex + 1),
      ];
      const childOrder = {
        ...state.childOrder,
        [newTableId]: clonedChildren.map((c) => c.id),
      };
      return { ...state, nodes, rootOrder, childOrder, activeNodeId: newTableId, isDirty: true };
    }
    case "createTableWithGraph": {
      // The graph is the first type the table offers (Prism's New Data Table
      // and Graph makes the table's default graph); both land in one undo step.
      const offered = GRAPH_OPTIONS_BY_TABLE[action.tableType];
      if (!offered.length) return state;
      const graphType = offered[0].value as GraphType;
      const tableId = genId("table");
      const graphId = genId("graph");
      const taken = state.rootOrder.map((id) => state.nodes[id]?.name ?? "");
      const table: ProjectNode = {
        id: tableId,
        type: "table",
        name: nextName("Table", taken),
        parentId: null,
        tableType: action.tableType,
        data: TABLES[action.tableType].defaultData(),
      };
      const graph: ProjectNode = {
        id: graphId,
        type: "graph",
        name: GRAPHS[graphType].label,
        parentId: tableId,
        graphType,
        graphOptions: newGraphOptions(graphType, table.data?.errorFormat),
      };
      const nodes = { ...state.nodes, [tableId]: table, [graphId]: graph };
      // Info auto-create (seq 225 remainder L13): when the preference is
      // on, the new table gets a linked Info sheet with it, as Prism does.
      // Off by default — a fresh table starts bare, as before. The sheet is
      // a root node, like one made from the sidebar, sitting after its table.
      let infoId: string | null = null;
      if (loadAutoCreateInfo()) {
        infoId = genId("info");
        nodes[infoId] = {
          id: infoId,
          type: "info",
          name: "Info Sheet",
          parentId: null,
          info: { ...newInfoSheetData(), linkedTableId: tableId },
        };
      }
      // The new table goes before the first info sheet or figure, like
      // `create`: parseProjectFile orders tables-then-infos-then-figures,
      // so a table after an info sheet would reopen as updated (#22).
      const firstInfoOrFigure = state.rootOrder.findIndex(
        (id) => state.nodes[id]?.type === "info" || state.nodes[id]?.type === "figure",
      );
      const rootOrder =
        firstInfoOrFigure === -1
          ? [...state.rootOrder, tableId, ...(infoId ? [infoId] : [])]
          : [...state.rootOrder.slice(0, firstInfoOrFigure), tableId, ...(infoId ? [infoId] : []), ...state.rootOrder.slice(firstInfoOrFigure)];
      const childOrder = { ...state.childOrder, [tableId]: [graphId] };
      return { ...state, nodes, rootOrder, childOrder, activeNodeId: graphId, isDirty: true };
    }
    case "duplicateNode": {
      const source = state.nodes[action.id];
      if (!source) return state;
      // A true copy: fresh id, deep-copied fields (editing the clone never
      // touches the source), a uniquified name among its siblings — and no
      // children, even for a table (its family stays behind).
      const clone: ProjectNode = JSON.parse(JSON.stringify(source));
      clone.id = genId(source.type);
      const siblings =
        source.parentId === null ? state.rootOrder : (state.childOrder[source.parentId] ?? []);
      clone.name = uniqueName(
        source.name,
        siblings.map((id) => state.nodes[id]?.name ?? ""),
      );
      const nodes = { ...state.nodes, [clone.id]: clone };
      if (source.parentId === null) {
        const idx = state.rootOrder.indexOf(action.id);
        const rootOrder = [
          ...state.rootOrder.slice(0, idx + 1),
          clone.id,
          ...state.rootOrder.slice(idx + 1),
        ];
        return {
          ...state,
          nodes,
          rootOrder,
          childOrder: { ...state.childOrder, [clone.id]: [] },
          activeNodeId: clone.id,
          isDirty: true,
        };
      }
      const list = state.childOrder[source.parentId] ?? [];
      const idx = list.indexOf(action.id);
      return {
        ...state,
        nodes,
        childOrder: {
          ...state.childOrder,
          [source.parentId]: [...list.slice(0, idx + 1), clone.id, ...list.slice(idx + 1)],
        },
        activeNodeId: clone.id,
        isDirty: true,
      };
    }
    case "setGraphFrozen": {
      const node = state.nodes[action.id];
      if (!node || node.type !== action.kind) return state;
      if (action.frozen ? node.frozen : !node.frozen) return state;
      const next: ProjectNode = { ...node };
      if (action.frozen) {
        if (node.type === "graph") {
          const parent = node.parentId ? state.nodes[node.parentId] : undefined;
          if (!parent?.data) return state; // nothing to freeze from
          next.frozen = true;
          next.frozenData = JSON.parse(JSON.stringify(parent.data));
          // A multi-table graph (#48) snapshots its extra tables too —
          // otherwise the frozen graph's secondary series still follow
          // live edits (Issue #17 remainder).
          const extraByTable: Record<string, TableData> = {};
          for (const id of node.sourceTableIds ?? []) {
            const table = state.nodes[id];
            if (table?.data) extraByTable[id] = JSON.parse(JSON.stringify(table.data));
          }
          if (Object.keys(extraByTable).length) next.frozenDataByTable = extraByTable;
          else delete next.frozenDataByTable;
          delete next.frozenDataByGraph;
        } else {
          const byGraph: Record<string, TableData> = {};
          for (const panel of node.panels ?? []) {
            const graph = state.nodes[panel.graphId];
            const parent = graph?.parentId ? state.nodes[graph.parentId] : undefined;
            if (parent?.data) byGraph[panel.graphId] = JSON.parse(JSON.stringify(parent.data));
          }
          if (!Object.keys(byGraph).length) return state; // nothing to freeze from
          next.frozen = true;
          next.frozenDataByGraph = byGraph;
          delete next.frozenData;
        }
      } else {
        delete next.frozen;
        delete next.frozenData;
        delete next.frozenDataByGraph;
        delete next.frozenDataByTable;
      }
      return { ...state, nodes: { ...state.nodes, [action.id]: next }, isDirty: true };
    }
    case "addDrawingObject": {
      const node = state.nodes[action.nodeId];
      if (!node || (node.type !== "graph" && node.type !== "figure")) return state;
      const objects = [...(node.drawingObjects ?? []), action.object];
      return {
        ...state,
        nodes: { ...state.nodes, [action.nodeId]: { ...node, drawingObjects: objects } },
        isDirty: true,
      };
    }
    case "updateDrawingObject": {
      const node = state.nodes[action.nodeId];
      if (!node || (node.type !== "graph" && node.type !== "figure")) return state;
      const objects = node.drawingObjects ?? [];
      const idx = objects.findIndex((o) => o.id === action.objectId);
      if (idx === -1) return state;
      const next = [...objects];
      next[idx] = { ...objects[idx], ...action.patch };
      return {
        ...state,
        nodes: { ...state.nodes, [action.nodeId]: { ...node, drawingObjects: next } },
        isDirty: true,
      };
    }
    case "deleteDrawingObject": {
      const node = state.nodes[action.nodeId];
      if (!node || (node.type !== "graph" && node.type !== "figure")) return state;
      const objects = (node.drawingObjects ?? []).filter((o) => o.id !== action.objectId);
      if (objects.length === (node.drawingObjects ?? []).length) return state;
      const next: ProjectNode = { ...node };
      if (objects.length) next.drawingObjects = objects;
      else delete next.drawingObjects;
      return { ...state, nodes: { ...state.nodes, [action.nodeId]: next }, isDirty: true };
    }
    case "arrangeDrawingObjects": {
      const node = state.nodes[action.nodeId];
      if (!node || (node.type !== "graph" && node.type !== "figure")) return state;
      const objects = [...(node.drawingObjects ?? [])];
      const selected = action.objectIds.filter((id) => objects.some((o) => o.id === id));
      if (!selected.length) return state;
      const selectedSet = new Set(selected);
      let next: DrawingObject[];
      switch (action.op) {
        case "bring-to-front":
          next = [...objects.filter((o) => !selectedSet.has(o.id)), ...objects.filter((o) => selectedSet.has(o.id))];
          break;
        case "send-to-back":
          next = [...objects.filter((o) => selectedSet.has(o.id)), ...objects.filter((o) => !selectedSet.has(o.id))];
          break;
        case "bring-forward": {
          // Last-to-first, so one swap never disturbs the next.
          next = [...objects];
          for (let i = next.length - 1; i >= 0; i--) {
            if (selectedSet.has(next[i].id) && i + 1 < next.length && !selectedSet.has(next[i + 1].id)) {
              [next[i], next[i + 1]] = [next[i + 1], next[i]];
            }
          }
          break;
        }
        case "send-backward": {
          next = [...objects];
          for (let i = 0; i < next.length; i++) {
            if (selectedSet.has(next[i].id) && i > 0 && !selectedSet.has(next[i - 1].id)) {
              [next[i], next[i - 1]] = [next[i - 1], next[i]];
            }
          }
          break;
        }
        case "duplicate": {
          // Each copy lands right after its original, with a fresh id.
          next = [];
          for (const o of objects) {
            next.push(o);
            if (selectedSet.has(o.id)) next.push({ ...JSON.parse(JSON.stringify(o)), id: drawingId() });
          }
          break;
        }
        case "group": {
          const groupId = `group_${Math.random().toString(36).slice(2, 10)}`;
          next = objects.map((o) => (selectedSet.has(o.id) ? { ...o, groupId } : o));
          break;
        }
        case "ungroup":
          next = objects.map((o) => {
            if (!selectedSet.has(o.id) || !o.groupId) return o;
            const { groupId: _, ...rest } = o;
            return rest;
          });
          break;
        case "delete":
          next = objects.filter((o) => !selectedSet.has(o.id));
          break;
      }
      if (next.length === objects.length && next.every((o, i) => o === objects[i])) return state;
      const out: ProjectNode = { ...node };
      if (next.length) out.drawingObjects = next;
      else delete out.drawingObjects;
      return { ...state, nodes: { ...state.nodes, [action.nodeId]: out }, isDirty: true };
    }
    case "updateTable": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table" || node.frozen) return state;
      const nodes = { ...state.nodes };
      // The table, then the tables computed from it (and from those) take their new values.
      const update = (id: string, data: TableData) => {
        const before = nodes[id];
        // A calculated variable follows every edit to its table — typing a
        // source value, pasting, inserting rows, an MCP write — because the
        // recompute runs here, the one funnel every edit passes through. A
        // table computed from another (a Transform) never recomputes: its
        // values come from its source table, not from formulas. A Multiple
        // Variables table's types are re-detected here too (gray in Prism):
        // an auto type follows the values the user just typed, a manual
        // type (orange) sticks; a Transform keeps its computed types as-is.
        if (!before.transform) data = recomputeCalculated(data);
        if (!before.transform && before.tableType === "multiple") data = refreshVariableTypes(data);
        // The stored level orders are maintained by the same funnel (seq 340):
        // a new level appends at the end, a level whose rows are gone drops out.
        if (!before.transform && before.tableType === "multiple") data = refreshLevelOrder(data);
        nodes[id] = { ...before, data };
        // The table's analyses and graphs follow its renamed columns and groups, its moved
        // rows and its deleted columns.
        const columnsChanged = data.columns.join("\n") !== before.data?.columns.join("\n");
        if (action.move || columnsChanged) {
          for (const child of Object.values(nodes)) {
            if (child.parentId === id) {
              const followed = followTable(child, action.move ?? {}, data.columns);
              // A multi-table graph's point styles on its *extra* tables
              // aren't in this table's columns, so `followTable` drops
              // them — put them back (their rows may have moved; the
              // styles stay, on their original rows).
              nodes[child.id] = restoreForeignPoints(child, followed, nodes);
            }
          }
        }
        // Its values changed, not only a column's width: the tables computed from it follow.
        const old = before.data;
        const same = (k: "rows" | "columns" | "excluded" | "cellBackgrounds" | "groups" | "replicates") => old?.[k] === data[k];
        if (same("rows") && same("columns") && same("excluded") && same("cellBackgrounds") && same("groups") && same("replicates")) return;
        // Issue 33: the values a non-frozen child analysis ran on are
        // gone — drop its saved result with them, so the sheet (and
        // `titer_read_results`) re-run instead of serving pre-edit
        // numbers. Frozen analyses keep theirs by design, as do
        // orphaned ones (no parent table left to change).
        for (const child of Object.values(nodes)) {
          if (child.type === "analysis" && child.parentId === id && !child.frozen && child.cachedResult) {
            const next = { ...child };
            delete next.cachedResult;
            nodes[child.id] = next;
          }
        }
        for (const t of Object.values(nodes)) {
          if (t.transform?.from === id) {
            // A frozen table keeps its values, whatever its source does.
            if (t.frozen) continue;
            // A renamed control series keeps its name: without the remap the
            // transform looks the control up by its old name, finds nothing,
            // and blanks every % of control cell.
            const transform =
              t.transform.control !== undefined && action.move?.renamed?.[t.transform.control] !== undefined
                ? { ...t.transform, control: action.move.renamed[t.transform.control] }
                : t.transform;
            if (transform !== t.transform) nodes[t.id] = { ...t, transform };
            update(t.id, transformTable(data, t.tableType!, transform, t.data));
          }
        }
      };
      update(action.id, action.data);
      return { ...state, nodes, isDirty: true };
    }
    case "removeDataSet": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table" || node.frozen || action.data === node.data) return state;
      // A table computed from this one as a percent of the removed set
      // keeps its values, which can be typed from then on — as when its
      // source table is deleted outright. Detach before the table update,
      // so the recompute doesn't blank the kept values first.
      let detached = state;
      const controlsGone = Object.values(state.nodes).some(
        (n) => n.transform?.from === action.id && n.transform.control === action.setName,
      );
      if (controlsGone) {
        const nodes = { ...state.nodes };
        for (const n of Object.values(nodes)) {
          if (n.transform?.from === action.id && n.transform.control === action.setName) {
            const { transform: _, ...rest } = n;
            nodes[n.id] = rest;
          }
        }
        detached = { ...state, nodes };
      }
      // One dispatch, one undo step: the table update (which follows the
      // table's other children) plus the orphaning below.
      // The updateTable below drops cachedResult from non-frozen child
      // analyses (Issue 33) — but an analysis orphaned by a dataset
      // removal keeps its frozen result (seq 309). Snapshot the
      // dependents' results first, restore them when orphaning.
      const frozenResults = new Map(
        dependentAnalyses(detached.nodes, action.id, action.setName)
          .filter((d) => d.cachedResult != null)
          .map((d) => [d.id, d.cachedResult] as const),
      );
      const after = applyAction(detached, {
        type: "updateTable",
        id: action.id,
        data: action.data,
        label: action.label,
      });
      const dependents = dependentAnalyses(after.nodes, action.id, action.setName);
      const orphanIds = new Set(dependents.map((d) => d.id));
      const nodes: Record<string, ProjectNode> = { ...after.nodes };
      for (const n of Object.values(nodes)) {
        if (orphanIds.has(n.id)) {
          // The analysis that ran on the removed set is orphaned — frozen
          // results, re-pointable (seq 242) — and moves to the project root,
          // like a deleted table's. Its frozen result survives the
          // updateTable invalidation above (seq 309).
          const frozen = frozenResults.get(n.id);
          nodes[n.id] = {
            ...n,
            parentId: null,
            orphaned: true,
            sourceTableName: node.name,
            orphanedDataSet: action.setName,
            ...(frozen != null ? { cachedResult: frozen } : {}),
          };
        } else if (
          n.type === "graph" &&
          n.parentId === action.id &&
          n.graphOptions?.sets?.includes(action.setName)
        ) {
          // A graph that plotted the set explicitly stops naming it; the
          // graph itself keeps drawing the sets that remain.
          const sets = n.graphOptions.sets.filter((s) => s !== action.setName);
          const graphOptions = { ...n.graphOptions };
          if (sets.length) graphOptions.sets = sets;
          else delete graphOptions.sets;
          nodes[n.id] = { ...n, graphOptions };
        }
      }
      const childOrder: Record<string, string[]> = { ...after.childOrder };
      if (orphanIds.size) {
        childOrder[action.id] = (childOrder[action.id] ?? []).filter((id) => !orphanIds.has(id));
      }
      const rootOrder = orphanIds.size
        ? [...after.rootOrder.filter((id) => !orphanIds.has(id)), ...dependents.map((d) => d.id)]
        : after.rootOrder;
      return { ...after, nodes, rootOrder, childOrder, isDirty: true };
    }
    case "convertTableToNested": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table" || node.frozen || node.tableType !== "column" || action.data === node.data)
        return state;
      // A table computed from this one keeps its values, which can be typed
      // from then on — as when its source table is deleted outright. Detach
      // before the table update, so the recompute doesn't blank the kept
      // values first.
      let detached = state;
      if (Object.values(state.nodes).some((n) => n.transform?.from === action.id)) {
        const nodes = { ...state.nodes };
        for (const n of Object.values(nodes)) {
          if (n.transform?.from === action.id) {
            const { transform: _, ...rest } = n;
            nodes[n.id] = rest;
          }
        }
        detached = { ...state, nodes };
      }
      // One dispatch, one undo step: the table update (which follows the
      // table's other children) plus the orphaning below — then the type
      // flip, so the update funnel still sees the Column table it edits.
      const after = applyAction(detached, {
        type: "updateTable",
        id: action.id,
        data: action.data,
        label: action.label,
      });
      const nodes: Record<string, ProjectNode> = { ...after.nodes };
      const converted = nodes[action.id];
      if (converted) nodes[action.id] = { ...converted, tableType: "nested" };
      const newColumns = action.data.columns;
      // The column analyses ran a column test, which does not run on a
      // nested table — orphan them, frozen results, re-pointable (seq 242),
      // and move them to the project root, like a deleted table's.
      const orphanIds = new Set(
        (after.childOrder[action.id] ?? []).filter((id) => after.nodes[id]?.type === "analysis"),
      );
      for (const id of orphanIds) {
        const n = nodes[id];
        if (n) nodes[id] = { ...n, parentId: null, orphaned: true, sourceTableName: node.name };
      }
      // A graph keeps drawing the converted table, but its sets named the
      // old datasets, which are gone — drop those names, as removeDataSet
      // drops the removed set; the graph redraws from the nested columns.
      for (const n of Object.values(nodes)) {
        if (n.type === "graph" && n.parentId === action.id && n.graphOptions) {
          const graphOptions = { ...n.graphOptions };
          if (graphOptions.sets) {
            const sets = graphOptions.sets.filter((s) => newColumns.includes(s));
            if (sets.length) graphOptions.sets = sets;
            else delete graphOptions.sets;
          }
          if (graphOptions.series) {
            const series = Object.fromEntries(
              Object.entries(graphOptions.series).filter(([k]) => newColumns.includes(k)),
            );
            if (Object.keys(series).length) graphOptions.series = series;
            else delete graphOptions.series;
          }
          nodes[n.id] = { ...n, graphOptions };
        }
      }
      const childOrder: Record<string, string[]> = { ...after.childOrder };
      if (orphanIds.size) {
        childOrder[action.id] = (childOrder[action.id] ?? []).filter((id) => !orphanIds.has(id));
      }
      const rootOrder = orphanIds.size
        ? [...after.rootOrder.filter((id) => !orphanIds.has(id)), ...orphanIds]
        : after.rootOrder;
      return { ...after, nodes, rootOrder, childOrder, isDirty: true };
    }
    case "updateGraph": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "graph") return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, graphOptions: action.options } },
        isDirty: true,
      };
    }
    case "setGraphSources": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "graph") return state;
      const before = node.sourceTableIds ?? [];
      if (before.length === action.sourceTableIds.length && before.every((id, i) => id === action.sourceTableIds[i]))
        return state;
      const next = { ...node };
      if (action.sourceTableIds.length) next.sourceTableIds = [...action.sourceTableIds];
      else delete next.sourceTableIds;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: next },
        isDirty: true,
      };
    }
    case "setNotes": {
      const node = state.nodes[action.id];
      if (!node || (node.notes ?? "") === action.notes) return state;
      const { notes: _, ...rest } = node;
      const next = action.notes ? { ...rest, notes: action.notes } : rest;
      return { ...state, nodes: { ...state.nodes, [action.id]: next }, isDirty: true };
    }
    case "setTags": {
      const node = state.nodes[action.id];
      if (!node) return state;
      const { tags: _, ...rest } = node;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: action.tags.length ? { ...rest, tags: action.tags } : rest },
        isDirty: true,
      };
    }
    case "updateGraphs": {
      // A graph deleted since the dialog opened is skipped, not fatal.
      const nodes = { ...state.nodes };
      let changed = false;
      for (const { id, options } of action.updates) {
        const node = nodes[id];
        if (!node || node.type !== "graph") continue;
        nodes[id] = { ...node, graphOptions: options };
        changed = true;
      }
      if (!changed) return state; // nothing applied: no dirty flag, no undo step
      return { ...state, nodes, isDirty: true };
    }
    case "updateInfoSheet": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "info") return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, info: action.info } },
        isDirty: true,
      };
    }
    case "updateFloatingNotes": {
      const node = state.nodes[action.id];
      if (!node) return state;
      // No notes left reads as no field, so an emptied sheet saves clean
      // and an older file still opens identical.
      const next = { ...node };
      if (action.notes.length) next.floatingNotes = action.notes;
      else delete next.floatingNotes;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: next },
        isDirty: true,
      };
    }
    case "setHighlight": {
      const node = state.nodes[action.id];
      if (!node || node.highlight === (action.highlight ?? undefined)) return state;
      // No highlight reads as no field, so a cleared sheet saves clean
      // and an older file still opens identical.
      const next = { ...node };
      if (action.highlight) next.highlight = action.highlight;
      else delete next.highlight;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: next },
        isDirty: true,
      };
    }
    case "setResultCellBackground": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis") return state;
      const key = action.key;
      const current = node.resultCellBackgrounds?.[key];
      if (current === (action.color ?? undefined)) return state;
      const next = { ...node };
      const colors = { ...(node.resultCellBackgrounds ?? {}) };
      if (action.color) colors[key] = action.color;
      else delete colors[key];
      if (Object.keys(colors).length) next.resultCellBackgrounds = colors;
      else delete next.resultCellBackgrounds;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: next },
        isDirty: true,
      };
    }
    case "updateFlowSampleCompensation": {
      // Seq 447: record the applied matrix on the sample node. A no-op
      // when the record already says the same thing (re-applying an
      // identical matrix must not mint an undo step).
      const node = state.nodes[action.id];
      if (!node || node.type !== "sample" || !node.flowSample) return state;
      const current = node.flowSample.compensation;
      if (
        current &&
        current.applied === action.compensation.applied &&
        current.source === action.compensation.source &&
        JSON.stringify(current.fluorochromes) === JSON.stringify(action.compensation.fluorochromes) &&
        JSON.stringify(current.spillover) === JSON.stringify(action.compensation.spillover)
      ) {
        return state;
      }
      return {
        ...state,
        nodes: {
          ...state.nodes,
          [action.id]: {
            ...node,
            flowSample: { ...node.flowSample, compensation: action.compensation },
          },
        },
        isDirty: true,
      };
    }
    case "updateFigure": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "figure") return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, ...action.patch } },
        isDirty: true,
      };
    }
    case "applyScript": {
      // One run, one change: the engine's whole resulting project replaces
      // the content (an absent projectName clears the old one — a run
      // that drops it must not leave a stale copy behind). The saved
      // scripts are not script output: a run leaves them as they were.
      const next: ProjectState = {
        ...state,
        nodes: action.nodes,
        rootOrder: action.rootOrder,
        childOrder: action.childOrder,
        activeNodeId: action.activeNodeId,
        isDirty: true,
      };
      if (action.projectName) next.projectName = action.projectName;
      else delete next.projectName;
      return next;
    }
    case "setScripts": {
      if (JSON.stringify(state.scripts ?? []) === JSON.stringify(action.scripts)) return state;
      const next = { ...state, isDirty: true };
      if (action.scripts.length) next.scripts = action.scripts;
      else delete next.scripts;
      return next;
    }
    case "openSelector":
      return { ...state, selector: action.selector };
    case "closeSelector":
      return { ...state, selector: null };
    case "setOpenError":
      // No-op drop, like a reorder that moved nothing: a repeated failure
      // (or a clear of an already-clear error) doesn't redraw or republish.
      if (state.openError === action.error) return state;
      return { ...state, openError: action.error };
    case "reorderRoot":
      if (arraysEqual(state.rootOrder, action.order)) return state; // no-op drop — don't dirty
      return { ...state, rootOrder: action.order, isDirty: true };
    case "reorderChildren":
      if (arraysEqual(state.childOrder[action.parentId] ?? [], action.order)) return state;
      return {
        ...state,
        childOrder: { ...state.childOrder, [action.parentId]: action.order },
        isDirty: true,
      };
    case "undo":
    case "redo": {
      const undo = action.type === "undo";
      const stack = undo ? state.past : state.future;
      const restored = stack.at(-1);
      if (!restored) return state;
      const current = {
        label: restored.label,
        content: {
          nodes: state.nodes,
          rootOrder: state.rootOrder,
          childOrder: state.childOrder,
          projectName: state.projectName,
          // Present even when unset: spreading a restored content without
          // the key would leave the scripts a change had added in place.
          scripts: state.scripts,
        },
      };
      const rest = stack.slice(0, -1);
      const history = undo
        ? { past: rest, future: [...state.future, current] }
        : { past: [...state.past, current], future: rest };
      // Stay on the item shown, unless the change being undone created it.
      const activeNodeId =
        state.activeNodeId && restored.content.nodes[state.activeNodeId]
          ? state.activeNodeId
          : (restored.content.rootOrder[0] ?? null);
      return { ...state, ...restored.content, ...history, activeNodeId, lastChange: null, isDirty: true };
    }
    case "load":
      return {
        nodes: action.nodes,
        rootOrder: action.rootOrder,
        childOrder: action.childOrder,
        activeNodeId: action.activeNodeId,
        recentNodeIds: action.activeNodeId ? [action.activeNodeId] : [],
        ...(action.projectName ? { projectName: action.projectName } : {}),
        ...(action.scripts?.length ? { scripts: action.scripts } : {}),
        ...(action.fileUnknowns ? { fileUnknowns: action.fileUnknowns } : {}),
        ...(action.projectUnknowns ? { projectUnknowns: action.projectUnknowns } : {}),
        selector: null,
        filePath: action.filePath,
        isDirty: action.edited ?? false,
        revision: state.revision, // bumped by the reducer wrapper (load is a MUTATING action)
        past: [],
        future: [],
        lastChange: null,
        // A file that loads clears the last opening's failure, if any.
        openError: null,
      };
    case "markSaved":
      // Clear the dirty flag only if nothing changed while the write was in
      // flight; otherwise the mid-save edit stays unsaved (and prompts on close).
      return {
        ...state,
        filePath: action.filePath,
        isDirty: state.revision !== action.savedRevision,
      };
    case "relocate":
      // The file moved on disk (seq 297): only the path changes. The
      // content, the dirty flag and the revision are untouched — a rename
      // is not an edit, and never clears unsaved changes.
      return { ...state, filePath: action.filePath };
  }
}

// The changes Undo can take back. With undo, redo and load, they bump
// `revision`; a no-op (the same state back, e.g. a reorder that moved nothing) does not.
const UNDOABLE = new Set<Action["type"]>([
  "create",
  "applyWand",
  "cloneGraph",
  "mergeProject",
  "rename",
  "remove",
  "duplicateFamily",
  "createTableWithGraph",
  "duplicateNode",
  "setGraphFrozen",
  "addDrawingObject",
  "updateDrawingObject",
  "deleteDrawingObject",
  "arrangeDrawingObjects",
  "updateTable",
  "removeDataSet",
  "convertTableToNested",
  "updateGraph",
  "setGraphSources",
  "updateGraphs",
  "updateInfoSheet",
  "updateFloatingNotes",
  "setNotes",
  "setTags",
  "setScripts",
  "setHighlight",
  "setResultCellBackground",
  "updateFlowSampleCompensation",
  "updateFigure",
  "applyScript",
  "reorderRoot",
  "reorderChildren",
  "setAnalysisFrozen",
  "setTableFrozen",
  "setAnalysisParams",
  "repointAnalysis",
  "changeGraphType",
]);
const MUTATING = new Set<Action["type"]>([...UNDOABLE, "cacheAnalysisResult", "undo", "redo", "load"]);

/** What a change is called in the Edit menu ("Undo Rename"). */
function changeName(action: Action): string {
  switch (action.type) {
    case "create":
      return `New ${NODE_NAMES[action.node.type]}`;
    case "applyWand":
      return "Use Wand";
    case "cloneGraph":
      return "Clone Graph";
    case "mergeProject":
      return "Merge Project";
    case "rename":
      return "Rename";
    case "remove":
      return "Delete";
    case "setAnalysisFrozen":
      return action.frozen ? "Freeze Results" : "Unfreeze Results";
    case "setTableFrozen":
      return action.frozen ? "Freeze Table" : "Unfreeze Table";
    case "setAnalysisParams":
      return "Change Analysis Parameters";
    case "repointAnalysis":
      return "Re-point Analysis";
    case "changeGraphType":
      return "Change Graph Type";
    case "duplicateFamily":
      return "Duplicate Family";
    case "createTableWithGraph":
      return "New Data Table and Graph";
    case "duplicateNode":
      return "Duplicate Sheet";
    case "setGraphFrozen":
      return action.frozen
        ? action.kind === "figure"
          ? "Freeze Figure"
          : "Freeze Graph"
        : action.kind === "figure"
          ? "Unfreeze Figure"
          : "Unfreeze Graph";
    case "addDrawingObject":
      return "Add Drawing Object";
    case "updateDrawingObject":
      return "Drawing Change";
    case "deleteDrawingObject":
      return "Delete Drawing Object";
    case "arrangeDrawingObjects":
      return action.op === "group"
        ? "Group Objects"
        : action.op === "ungroup"
          ? "Ungroup Objects"
          : action.op === "duplicate"
            ? "Duplicate Objects"
            : action.op === "delete"
              ? "Delete Objects"
              : "Arrange Objects";
    case "updateTable":
      return action.label;
    case "removeDataSet":
      return "Remove Data Set";
    case "convertTableToNested":
      return "Convert to Nested";
    case "updateGraph":
      return "Format Change";
    case "setGraphSources":
      return "Source Tables";
    case "setNotes":
      return "Notes";
    case "setTags":
      return "Tags";
    case "setScripts":
      return "Edit Scripts";
    case "updateGraphs":
      return "Match Graphs";
    case "updateInfoSheet":
      return "Info Sheet Change";
    case "updateFloatingNotes":
      return "Note Change";
    case "setHighlight":
      return "Highlight Sheet";
    case "setResultCellBackground":
      return "Cell Background Color";
    case "updateFlowSampleCompensation":
      return "Apply Compensation";
    case "updateFigure":
      return "Figure Change";
    case "applyScript":
      return "Run Script";
    default:
      return "Move";
  }
}

/** The project's state machine: pure, so the tests (tests/checks.ts) drive it directly. */
export function reducer(state: ProjectState, action: Action): ProjectState {
  const next = applyAction(state, action);
  if (next === state || !MUTATING.has(action.type)) return next;
  const revision = state.revision + 1;
  if (!UNDOABLE.has(action.type)) return { ...next, revision };

  const change =
    action.type === "updateGraph" || action.type === "setGraphSources"
      ? { key: `graph ${action.id}`, at: action.at }
      : action.type === "updateGraphs"
        ? { key: "graphs batch", at: action.at }
        : action.type === "updateInfoSheet"
          ? { key: `info ${action.id}`, at: action.at }
          : action.type === "updateFloatingNotes"
            ? { key: `notes ${action.id}`, at: action.at }
            : // The item's note, undoing a burst of typing together. Its key differs
              // from floating notes' (`notes <id>`), which are another feature.
              action.type === "setNotes"
              ? { key: `item-notes ${action.id}`, at: action.at }
              : action.type === "updateFigure"
                ? { key: `figure ${action.id}`, at: action.at }
                : null;
  const merged = change && state.lastChange?.key === change.key && change.at - state.lastChange.at < MERGE_MS;
  const before = {
    label: changeName(action),
    content: {
      nodes: state.nodes,
      rootOrder: state.rootOrder,
      childOrder: state.childOrder,
      projectName: state.projectName,
      // Present even when unset, as in the undo snapshot above: a step
      // whose content lacks the key can't undo a change that added scripts.
      scripts: state.scripts,
    },
  };
  return {
    ...next,
    revision,
    past: merged ? state.past : [...state.past, before].slice(-MAX_UNDO),
    future: [],
    lastChange: change,
  };
}

/** What changes the project. These functions never change, so what only acts on the
 *  project (`useProjectActions`) doesn't redraw with it. */
interface ProjectActions {
  /** The project as it is now, for an action to look at (never to draw from). */
  get: () => ProjectState;
  createTable: (tableType: TableType) => void;
  /** A table of simulated values (plan 22): created with its data already
   *  filled, not from a type's defaults — the reducer's "create" names it
   *  among the tables ("Simulated data 1", "Simulated data 2"…). */
  createSimulatedTable: (tableType: TableType, data: TableData) => void;
  /** A table created with its data already filled (extract-and-rearrange's
   *  new table): `name` is the base the reducer numbers ("Extracted data 1",
   *  "Extracted data 2"… — root tables are numbered from 1). Returns the new
   *  table's id, so a caller can open graphs under it (a template apply). */
  createTableWithData: (tableType: TableType, data: TableData, name: string) => string;
  /** A table computed from `from`'s values (Transform or Normalize). */
  createTransformed: (from: string, transform: Omit<Transform, "from">) => void;
  createAnalysis: (parentId: string, analysisType: AnalysisType, analysisParams?: AnalysisParams) => string;
  /** Create a flow sample node from an imported FCS file (seq 443):
   *  the node id and the sample id are the same by convention, so the
   *  reference's `sampleId` is the node's id. Returns the node id. */
  createFlowSample: (ref: FlowSampleRef) => string;
  /** Record a compensation matrix on a flow sample node (seq 447): the
   *  matrix applied to its stored events + whether it is applied. The
   *  events themselves live in the store, never on this node. */
  updateFlowSampleCompensation: (sampleId: string, compensation: FlowCompensationRef) => void;
  /** A plugin analysis node on a table: named for the plugin analysis, and
   *  carrying its namespaced id + params instead of an `AnalysisType`. */
  createPluginAnalysis: (parentId: string, pluginId: string, pluginParams?: PluginParamValues) => string;
  /** `graphOptions` (plan 38, Apply Method): the cloned options of a method
   *  file's graph, with its analysis links remapped; omitted, the graph gets
   *  its defaults as today. `sourceTableIds` (#48): the extra tables the
   *  graph also plots. Returns the new node's id, so the caller can
   *  remap what links to it. */
  createGraph: (
    parentId: string,
    graphType: GraphType,
    graphOptions?: GraphOptions,
    sourceTableIds?: string[],
  ) => string;
  /** A graph's extra source tables (#48), in order; empty clears them. */
  setGraphSources: (id: string, sourceTableIds: string[]) => void;
  /** Wand (plan 37): copies the example table's analyses + graphs onto the
   *  target tables as one undo step; returns the per-table report (created /
   *  skipped) for the dialog's summary. Throws when the example has nothing to copy. */
  applyWand: (exampleId: string, targetIds: string[], prefix: string) => WandReport;
  /** Clones a graph with its data table and the analyses shown on it
   *  (src/lib/clone-graph.ts): one undoable step, opening on the clone.
   *  Returns the cloned graph's id; throws the plan's error when the
   *  graph (or its table) isn't there to clone. */
  cloneGraph: (graphId: string, options: CloneOptions) => string;
  /** Merges another project's sheets into this one (File ▸ Merge, seq
   *  180): `mergeProjects` (src/lib/project-merge.ts) built the merged
   *  content; this applies it as one undo step. */
  mergeProject: (doc: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
  }) => void;
  /** A figure at the project root; `graphIds` (in order) start as its panels.
   *  Returns the new figure's id. */
  createFigure: (graphIds?: string[]) => string;
  /** An info sheet at the project root, optionally linked to one table.
   *  Returns the new sheet's id. */
  createInfoSheet: (linkedTableId?: string | null) => string;
  /** Replaces an info sheet's constants, notes and table link. */
  updateInfoSheet: (id: string, info: InfoSheetData) => void;
  updateFigure: (
    id: string,
    patch: Partial<{
      panels: FigurePanel[];
      grid: FigureGrid;
      figureSize: FigureSize;
      labelStyle: FigureLabelStyle;
      figureTitle: string;
      sharedLegend: SharedLegend;
      figureBackground: string;
      dpi: Resolution;
    }>,
  ) => void;
  /** Applies a Prism script run's whole resulting project, as one undo step. */
  applyScript: (doc: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
    projectName?: string;
  }) => void;
  setActiveNode: (id: string | null) => void;
  renameNode: (id: string, name: string) => void;
  removeNode: (id: string) => void;
  /** Keeps a successful live run on its analysis node, so a frozen or
   *  orphaned sheet can show it. */
  cacheAnalysisResult: (id: string, result: AnalysisResult | PluginAnalysisResult) => void;
  /** Freeze (or unfreeze) a results sheet. Orphaned sheets can't freeze. */
  setAnalysisFrozen: (id: string, frozen: boolean) => void;
  /** Freeze (or unfreeze) a data table: frozen, it can't be edited. */
  setTableFrozen: (id: string, frozen: boolean) => void;
  /** Replace an analysis node's params (a rerun with overrides). `name`
   *  renames the node in the same undo step (Change Parameters Apply). */
  setAnalysisParams: (id: string, params: AnalysisParams, name?: string) => void;
  /** Move an orphaned analysis under a table that offers its test (seq 242). */
  repointAnalysis: (id: string, tableId: string) => void;
  /** Change a graph's type, keeping its title and size (seq 244). */
  changeGraphType: (id: string, graphType: GraphType, options?: GraphOptions) => void;
  /** Duplicates a data table together with its analyses and graphs (its family). */
  duplicateFamily: (id: string) => void;
  /** A new data table with its first graph, as one undo step (seq 232). */
  createTableWithGraph: (tableType: TableType) => void;
  /** Duplicates one sheet and nothing else (seq 236): the clone lands
   *  right after its source; a table's children stay behind. */
  duplicateNode: (id: string) => void;
  /** Freeze (or unfreeze) a graph or a figure (seq 237): freezing
   *  snapshots the parent tables' data, so the sheet draws the snapshot
   *  while the live data keep changing. */
  setGraphFrozen: (id: string, kind: "graph" | "figure", frozen: boolean) => void;
  /** Paint (or clear) one results-table cell (seq 325): `key` is a
   *  `"section|row|col"` address, `color` one of Prism's 8 names or null. */
  setResultCellBackground: (id: string, key: string, color: CellBackgroundColor | null) => void;
  /** Add a text/drawing/picture object to a graph or figure sheet (seq 238). */
  addDrawingObject: (nodeId: string, object: DrawingObject) => void;
  /** Change one drawing object (its id and kind never change). */
  updateDrawingObject: (
    nodeId: string,
    objectId: string,
    patch: Partial<Omit<DrawingObject, "id" | "kind">>,
  ) => void;
  /** Delete one drawing object. */
  deleteDrawingObject: (nodeId: string, objectId: string) => void;
  /** Rearrange drawing objects: stacking order, copy, group/ungroup, delete. */
  arrangeDrawingObjects: (nodeId: string, op: ArrangeOp, objectIds: string[]) => void;
  /** `label` names the edit for Undo ("Paste"); `move`: the columns or groups it renamed
   *  and the rows it moved, which the table's analyses and graphs then follow. */
  updateTable: (id: string, data: TableData, label: string, move?: TableMove) => void;
  /** Remove one data set from a table (seq 309): `data` is the table after
   *  the removal, `setName` the removed set — the analyses that ran on it
   *  become orphaned, in the same undo step. */
  removeDataSet: (id: string, data: TableData, setName: string, label: string) => void;
  /** Rebuild a Column table as Nested (seq 450): each dataset becomes a
   *  group, its rows splitting into `spec`'s subgroups in order. The
   *  table's column analyses orphan, in the same undo step. Throws a
   *  plain-language error when the table is not a Column table, is frozen,
   *  or the rows don't tile into the subgroups. */
  convertTableToNested: (id: string, spec: ConvertToNestedSpec) => void;
  updateGraph: (id: string, options: GraphOptions) => void;
  /** An item's note (empty: none). */
  setNotes: (id: string, notes: string) => void;
  /** An item's tags (none: no tag). */
  setTags: (id: string, tags: TagColor[]) => void;
  /** Replace the project's saved scripts (seq 228). Undoable. */
  setScripts: (scripts: ProjectScript[]) => void;
  /** Batch Magic: several graphs' options at once, in one undo step. */
  updateGraphs: (updates: { id: string; options: GraphOptions }[]) => void;
  /** Replaces a sheet's floating notes (an empty list clears them). */
  updateFloatingNotes: (id: string, notes: FloatingNote[]) => void;
  /** Highlights a sheet in the Navigator (null clears it). Undoable. */
  setSheetHighlight: (id: string, highlight: SheetHighlight | null) => void;
  openSelector: (selector: Selector) => void;
  closeSelector: () => void;
  /** Records that this window's file failed to open (or clears the record):
   *  the MCP server reads it from the snapshot. Not an edit — no revision
   *  bump, no dirty flag, no undo step. */
  setOpenError: (error: string | null) => void;
  reorderTables: (order: string[]) => void;
  reorderChildren: (parentId: string, order: string[]) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (payload: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
    projectName?: string;
    scripts?: ProjectScript[];
    fileUnknowns?: Record<string, unknown>;
    projectUnknowns?: Record<string, unknown>;
    /** null: a project not saved anywhere yet (the sample project). */
    filePath: string | null;
    /** Changed as it was read: it opens edited, so saving keeps it as it is now. */
    edited?: boolean;
  }) => void;
  markProjectSaved: (filePath: string | null, savedRevision: number) => void;
  /** The file moved on disk (seq 297): point the project at its new path,
   *  keeping the dirty flag and the revision as they are. */
  relocateProject: (filePath: string) => void;
}

interface ProjectContextValue extends ProjectActions {
  nodes: Record<string, ProjectNode>;
  /** The tables, in sidebar order. */
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
  /** The sheets visited, oldest first (seq 240) — Previous Sheet walks back through it. */
  recentNodeIds: string[];
  activeNode: ProjectNode | null;
  activeTableId: string | null;
  /** The script-set project name (v2 item 6). */
  projectName?: string;
  /** The project's saved Prism scripts (seq 228). */
  scripts?: ProjectScript[];
  selector: ProjectState["selector"];
  filePath: string | null;
  isDirty: boolean;
  /** Monotonic content-revision counter, bumped on every mutating action.
   *  The autosave engine (src/store/use-document.ts) subscribes to it to
   *  restart its debounce timer on every edit. */
  revision: number;
  /** What Undo and Redo would take back or replay ("Paste"), if anything. */
  undoName?: string;
  redoName?: string;
}

/** An item as the sidebar shows it. */
export type OutlineNode = Pick<ProjectNode, "id" | "type" | "name" | "parentId" | "highlight" | "tags" | "frozen">;
/** What the sidebar shows: the tables in order, each with its analyses and graphs,
 *  then the info sheets, then the figures (project-root items, since a figure may span tables), then the
 *  orphaned analyses (their tables deleted — they live at the project root too). */
interface Outline {
  tables: (OutlineNode & { children: OutlineNode[] })[];
  infos: OutlineNode[];
  figures: OutlineNode[];
  orphaned: OutlineNode[];
  activeNodeId: string | null;
}

const outlineNode = ({ id, type, name, parentId, highlight, tags, frozen }: ProjectNode): OutlineNode => ({
  id,
  type,
  name,
  parentId,
  highlight,
  tags,
  frozen,
});

/** A table's analyses and graphs, in sidebar order. */
const childrenOf = ({ nodes, childOrder }: ProjectState, tableId: string) =>
  (childOrder[tableId] ?? []).flatMap((id) => (nodes[id] ? [nodes[id]] : []));

const ProjectContext = React.createContext<ProjectContextValue | null>(null);
const ActionsContext = React.createContext<ProjectActions | null>(null);
const OutlineContext = React.createContext<Outline | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, makeInitialState);
  const latest = React.useRef(state);
  React.useLayoutEffect(() => {
    latest.current = state;
  });

  const actions = React.useMemo<ProjectActions>(() => {
    const createTableWithData = (tableType: TableType, data: TableData, name: string) => {
      const id = genId("table");
      dispatch({
        type: "create",
        node: {
          id,
          type: "table",
          name,
          parentId: null,
          tableType,
          data,
        },
      });
      return id;
    };
    return {
      get: () => latest.current,
      createTable: (tableType) =>
        dispatch({
          type: "create",
          node: {
            id: genId("table"),
            type: "table",
            name: "Table",
            parentId: null,
            tableType,
            data: TABLES[tableType].defaultData(),
          },
        }),
      createTableWithData,
      createSimulatedTable: (tableType, data) => createTableWithData(tableType, data, "Simulated data"),
      createTransformed: (from, how) => {
        const source = latest.current.nodes[from];
        if (!source?.data || !source.tableType) return;
        const transform = { from, ...how };
        dispatch({
          type: "create",
          node: {
            id: genId("table"),
            type: "table",
            name: `${source.name}, ${TRANSFORM_NAMES[how.kind]}`,
            parentId: null,
            tableType: source.tableType,
            data: transformTable(source.data, source.tableType, transform),
            transform,
          },
        });
      },
      // Named for the test it runs, as in Prism.
      createAnalysis: (parentId, analysisType, analysisParams) => {
        const id = genId("analysis");
        dispatch({
          type: "create",
          node: {
            id,
            type: "analysis",
            name: analysisTitle(analysisType, analysisParams),
            parentId,
            analysisType,
            analysisParams,
          },
        });
        return id;
      },
      // A flow sample node from an imported FCS file (seq 443): the node
      // id and the sample id are the same by convention (seq 441), so the
      // reference's sampleId is the node's id. The events live in the
      // Rust store, never on this node.
      createFlowSample: (ref) => {
        const id = ref.sampleId;
        dispatch({
          type: "create",
          node: createSampleNode(id, ref.name, ref),
        });
        return id;
      },
      // Compensation applied to a sample (seq 447): record the matrix +
      // applied flag on the sample node.
      updateFlowSampleCompensation: (sampleId, compensation) => {
        dispatch({ type: "updateFlowSampleCompensation", id: sampleId, compensation, at: Date.now() });
      },
      // Named for the plugin analysis it runs (an unregistered plugin
      // keeps its id as the name until it is re-enabled).
      createPluginAnalysis: (parentId, pluginId, pluginParams) => {
        const id = genId("analysis");
        dispatch({
          type: "create",
          node: {
            id,
            type: "analysis",
            name: resolveAnalysis(pluginId)?.label ?? pluginId,
            parentId,
            pluginAnalysisId: pluginId,
            pluginAnalysisParams: pluginParams,
          },
        });
        return id;
      },
      createGraph: (parentId, graphType, graphOptions, sourceTableIds) => {
        // A new graph inherits its table's error format: an SD-formatted
        // table's graphs default to SD error bars (a table with no format
        // recorded reads as SEM, the default, as before).
        const parent = latest.current.nodes[parentId];
        // Autocomplete titles (seq 225 remainder L5): a new graph's title
        // is suggested from its source table, unless the caller set one.
        const options =
          graphOptions ??
          (loadAutocompleteTitles() && parent
            ? { ...newGraphOptions(graphType, parent?.data?.errorFormat), title: parent.name }
            : newGraphOptions(graphType, parent?.data?.errorFormat));
        const id = genId("graph");
        dispatch({
          type: "create",
          node: {
            id,
            type: "graph",
            name: GRAPHS[graphType].label,
            parentId,
            graphType,
            graphOptions: options,
            ...(sourceTableIds?.length ? { sourceTableIds: [...sourceTableIds] } : {}),
          },
        });
        return id;
      },
      setGraphSources: (id, sourceTableIds) =>
        dispatch({ type: "setGraphSources", id, sourceTableIds, at: Date.now() }),
      applyWand: (exampleId, targetIds, prefix) => {
        const s = latest.current;
        const result = planWand({ nodes: s.nodes, childOrder: s.childOrder }, exampleId, targetIds, prefix);
        dispatch({
          type: "applyWand",
          nodes: result.nodes,
          childOrder: result.childOrder,
          activeNodeId: result.firstCreatedId ?? s.activeNodeId,
        });
        return result.report;
      },
      cloneGraph: (graphId, options) => {
        const planned = cloneGraphPlan(latest.current, graphId, options);
        if (!("plan" in planned)) throw new Error(planned.error);
        dispatch({ type: "cloneGraph", plan: planned.plan });
        return planned.plan.activeNodeId;
      },
      mergeProject: (doc) => dispatch({ type: "mergeProject", ...doc }),
      createFigure: (graphIds = []) => {
        const names: Record<string, string> = {};
        for (const id of graphIds) {
          const graph = latest.current.nodes[id];
          if (graph) names[id] = graph.name;
        }
        const { panels, grid } = newFigurePanels(graphIds, names);
        const id = genId("figure");
        dispatch({
          type: "create",
          node: {
            id,
            type: "figure",
            name: "Figure",
            parentId: null,
            panels,
            grid,
            figureSize: { ...DEFAULT_FIGURE_SIZE },
            labelStyle: { ...DEFAULT_LABEL_STYLE },
            figureTitle: "",
            sharedLegend: "none",
            dpi: DEFAULT_FIGURE_DPI,
          },
        });
        return id;
      },
      createInfoSheet: (linkedTableId = null) => {
        const id = genId("info");
        dispatch({
          type: "create",
          node: {
            id,
            type: "info",
            name: "Info Sheet",
            parentId: null,
            info: { ...newInfoSheetData(), linkedTableId },
          },
        });
        return id;
      },
      updateInfoSheet: (id, info) => dispatch({ type: "updateInfoSheet", id, info, at: Date.now() }),
      updateFigure: (id, patch) => dispatch({ type: "updateFigure", id, patch, at: Date.now() }),
      applyScript: (doc) => dispatch({ type: "applyScript", ...doc }),
      setActiveNode: (id) => dispatch({ type: "setActive", id }),
      renameNode: (id, name) => dispatch({ type: "rename", id, name }),
      removeNode: (id) => dispatch({ type: "remove", id }),
      cacheAnalysisResult: (id, result) => dispatch({ type: "cacheAnalysisResult", id, result }),
      setAnalysisFrozen: (id, frozen) => dispatch({ type: "setAnalysisFrozen", id, frozen }),
      setTableFrozen: (id, frozen) => dispatch({ type: "setTableFrozen", id, frozen }),
      setAnalysisParams: (id, params, name?) =>
        dispatch({ type: "setAnalysisParams", id, params, ...(name !== undefined ? { name } : {}) }),
      repointAnalysis: (id, tableId) => dispatch({ type: "repointAnalysis", id, tableId }),
      changeGraphType: (id, graphType, options) =>
        dispatch({ type: "changeGraphType", id, graphType, ...(options ? { options } : {}) }),
      duplicateFamily: (id) => dispatch({ type: "duplicateFamily", id }),
      createTableWithGraph: (tableType) => dispatch({ type: "createTableWithGraph", tableType }),
      duplicateNode: (id) => dispatch({ type: "duplicateNode", id }),
      setGraphFrozen: (id, kind, frozen) => dispatch({ type: "setGraphFrozen", id, kind, frozen }),
      addDrawingObject: (nodeId, object) => dispatch({ type: "addDrawingObject", nodeId, object }),
      updateDrawingObject: (nodeId, objectId, patch) =>
        dispatch({ type: "updateDrawingObject", nodeId, objectId, patch }),
      deleteDrawingObject: (nodeId, objectId) => dispatch({ type: "deleteDrawingObject", nodeId, objectId }),
      arrangeDrawingObjects: (nodeId, op, objectIds) =>
        dispatch({ type: "arrangeDrawingObjects", nodeId, op, objectIds }),
      updateTable: (id, data, label, move) => dispatch({ type: "updateTable", id, data, label, move }),
      removeDataSet: (id, data, setName, label) => dispatch({ type: "removeDataSet", id, data, setName, label }),
      convertTableToNested: (id, spec) => {
        const node = latest.current.nodes[id];
        if (!node || node.type !== "table") throw new Error(`no table with id “${id}” in this project.`);
        if (node.tableType !== "column")
          throw new Error(
            `only a Column table converts to Nested — “${node.name}” is a ${TABLES[node.tableType!].label} table.`,
          );
        if (node.frozen) throw new Error(`table “${node.name}” is frozen — unfreeze it before converting it.`);
        dispatch({
          type: "convertTableToNested",
          id,
          data: convertColumnToNested(node.data!, spec),
          label: "Convert to Nested",
        });
      },
      updateGraph: (id, options) => dispatch({ type: "updateGraph", id, options, at: Date.now() }),
      setNotes: (id, notes) => dispatch({ type: "setNotes", id, notes, at: Date.now() }),
      setTags: (id, tags) => dispatch({ type: "setTags", id, tags }),
      setScripts: (scripts) => dispatch({ type: "setScripts", scripts }),
      updateGraphs: (updates) => dispatch({ type: "updateGraphs", updates, at: Date.now() }),
      updateFloatingNotes: (id, notes) => dispatch({ type: "updateFloatingNotes", id, notes, at: Date.now() }),
      setSheetHighlight: (id, highlight) => dispatch({ type: "setHighlight", id, highlight }),
      setResultCellBackground: (id, key, color) => dispatch({ type: "setResultCellBackground", id, key, color }),
      openSelector: (selector) => dispatch({ type: "openSelector", selector }),
      closeSelector: () => dispatch({ type: "closeSelector" }),
      setOpenError: (error) => dispatch({ type: "setOpenError", error }),
      reorderTables: (order) => dispatch({ type: "reorderRoot", order }),
      reorderChildren: (parentId, order) => dispatch({ type: "reorderChildren", parentId, order }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      loadProject: (payload) => {
        // A new project replaces the old one, so the previous import's
        // graph-regen offer dies with it — the plans are import-time only,
        // never persisted (seq 291). The import paths set fresh plans
        // after loading.
        clearRegenPlans();
        dispatch({ type: "load", ...payload });
      },
      markProjectSaved: (filePath, savedRevision) => dispatch({ type: "markSaved", filePath, savedRevision }),
      relocateProject: (filePath) => dispatch({ type: "relocate", filePath }),
    };
  }, []);

  const value = React.useMemo<ProjectContextValue>(() => {
    const activeNode = state.activeNodeId ? (state.nodes[state.activeNodeId] ?? null) : null;
    const activeTableId = !activeNode ? null : activeNode.type === "table" ? activeNode.id : activeNode.parentId;

    return {
      ...actions,
      nodes: state.nodes,
      rootOrder: state.rootOrder,
      childOrder: state.childOrder,
      activeNodeId: state.activeNodeId,
      recentNodeIds: state.recentNodeIds,
      activeNode,
      activeTableId,
      projectName: state.projectName,
      scripts: state.scripts,
      selector: state.selector,
      filePath: state.filePath,
      isDirty: state.isDirty,
      revision: state.revision,
      undoName: state.past.at(-1)?.label,
      redoName: state.future.at(-1)?.label,
    };
  }, [state, actions]);

  // The outline as text: editing what a table or a graph holds leaves it the same, so
  // the outline stays the same object and the sidebar doesn't redraw.
  const outlineText = JSON.stringify({
    tables: state.rootOrder
      .filter((id) => state.nodes[id]?.type === "table")
      .map((id) => ({ ...outlineNode(state.nodes[id]), children: childrenOf(state, id).map(outlineNode) })),
    infos: state.rootOrder
      .filter((id) => state.nodes[id]?.type === "info")
      .map((id) => outlineNode(state.nodes[id])),
    figures: state.rootOrder
      .filter((id) => state.nodes[id]?.type === "figure")
      .map((id) => outlineNode(state.nodes[id])),
    orphaned: state.rootOrder
      .filter((id) => state.nodes[id]?.type === "analysis" && state.nodes[id]?.orphaned)
      .map((id) => outlineNode(state.nodes[id])),
  });
  const outline = React.useMemo<Outline>(
    () => ({ ...JSON.parse(outlineText), activeNodeId: state.activeNodeId }),
    [outlineText, state.activeNodeId],
  );

  return (
    <ActionsContext.Provider value={actions}>
      <OutlineContext.Provider value={outline}>
        <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
      </OutlineContext.Provider>
    </ActionsContext.Provider>
  );
}

function useProjectContext<T>(context: React.Context<T | null>): T {
  const value = React.useContext(context);
  if (!value) throw new Error("The project's hooks must be used inside <ProjectProvider>");
  return value;
}

/** The whole project: redraws with any change to it. */
export const useProjectStore = () => useProjectContext(ProjectContext);
/** What changes the project, and a look at it: never redraws. */
export const useProjectActions = () => useProjectContext(ActionsContext);
/** The sidebar's outline: redraws when a name, the order or the selection changes. */
export const useOutline = () => useProjectContext(OutlineContext);
