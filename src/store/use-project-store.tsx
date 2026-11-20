import * as React from "react";

import {
  NODE_NAMES,
  type FloatingNote,
  type InfoSheetData,
  type NodeType,
  type ProjectNode,
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
import { MAX_INFO_SHEETS, newInfoSheetData } from "../lib/info-sheets";
import type { AnalysisParams, AnalysisPickerValue, AnalysisResult, AnalysisType } from "../stats/types";
import { TABLES } from "../views/tables";
import { GRAPHS, newGraphOptions } from "../views/graphs";
import type { TemplateKind } from "../lib/template";
import { ANALYSES } from "../stats";
import { followTable, type TableMove } from "./references";
import { applyWand as planWand, type WandReport } from "../lib/wand";
import { cloneGraphPlan, type CloneOptions, type ClonePlan } from "../lib/clone-graph";
import { DEFAULT_FIGURE_DPI, DEFAULT_FIGURE_SIZE, DEFAULT_LABEL_STYLE, newFigurePanels } from "../lib/figure";
import type { FigureGrid, FigureLabelStyle, FigurePanel, FigureSize, Resolution, SharedLegend } from "./types";

export type { ProjectNode } from "./types";

/** What the universal selector is currently choosing. */
/** The Preferences dialog's sections (seq 225). */
export type PreferenceSection = "general" | "appearance" | "ai" | "feedback" | "print";

type Selector =
  | { kind: "new-table" }
  | { kind: "new-analysis"; tableId: string; forGraph?: ForGraph }
  | { kind: "analysis-params"; tableId: string; testType: AnalysisPickerValue; forGraph?: ForGraph }
  | { kind: "new-graph"; tableId: string }
  | { kind: "wand"; tableId: string }
  | { kind: "clone-graph"; graphId: string }
  | { kind: "simulate-data"; tableId: string }
  | { kind: "script" }
  | { kind: "converter" }
  | { kind: "save-prompt" }
  | { kind: "save-template"; templateKind: TemplateKind }
  | { kind: "conflict" }
  | { kind: "remote-picker" }
  | { kind: "cloud-settings" }
  | { kind: "ai-connections" }
  | { kind: "preferences"; section?: PreferenceSection };

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
}

interface ProjectState extends Content {
  activeNodeId: string | null;
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
  | { type: "setActive"; id: string | null }
  | { type: "rename"; id: string; name: string }
  | { type: "remove"; id: string }
  /** The view's last successful live run, kept on the node so a frozen or
   *  orphaned sheet can show it. Not an Undo step (a snapshot, not an edit),
   *  but it does dirty the file — the result is saved with the node. */
  | { type: "cacheAnalysisResult"; id: string; result: AnalysisResult }
  /** Freeze (or unfreeze) a results sheet: frozen, it shows its cached
   *  result and stops auto-updating when the data change. */
  | { type: "setAnalysisFrozen"; id: string; frozen: boolean }
  /** Replace an analysis node's params (a rerun with overrides, via MCP):
   *  the next run — and the UI — see the new params. Orphaned sheets
   *  keep their params (their source table is gone). */
  | { type: "setAnalysisParams"; id: string; params: AnalysisParams }
  /** Duplicates a data table together with its analyses and graphs (its family):
   *  the copy takes new data and its analyses follow the copy (Prism 10,
   *  "Repeating an analysis"). Figures are not part of a family and stay put. */
  | { type: "duplicateFamily"; id: string }
  /** `label` names the edit in the Edit menu; `move`: what it renamed or moved. */
  | { type: "updateTable"; id: string; data: TableData; label: string; move?: TableMove }
  | { type: "updateGraph"; id: string; options: GraphOptions; at: number }
  | { type: "setNotes"; id: string; notes: string; at: number }
  | { type: "setTags"; id: string; tags: TagColor[] }
  /** Batch Magic: several graphs at once, in one undo step. */
  | { type: "updateGraphs"; updates: { id: string; options: GraphOptions }[]; at: number }
  | { type: "updateInfoSheet"; id: string; info: InfoSheetData; at: number }
  | { type: "updateFloatingNotes"; id: string; notes: FloatingNote[]; at: number }
  /** `highlight`: the sheet's Navigator color, or null to clear it. */
  | { type: "setHighlight"; id: string; highlight: SheetHighlight | null }
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
      fileUnknowns?: Record<string, unknown>;
      projectUnknowns?: Record<string, unknown>;
      filePath: string | null;
      /** Changed as it was read (repaired, or from an older Titer): to be saved. */
      edited?: boolean;
    }
  | { type: "markSaved"; filePath: string | null; savedRevision: number };

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
      // A new table goes before the first figure at the project root:
      // parseProjectFile reorders rootOrder tables-then-figures, so
      // appending a table after a figure would mark every save/load
      // round-trip as updated (#22). Figures still append at the end.
      // An info sheet goes there too (tables, then info sheets, then figures).
      // A table computed from another goes right after its source instead.
      const firstFigure =
        node.type === "table" || node.type === "info"
          ? state.rootOrder.findIndex((id) => state.nodes[id]?.type === "figure")
          : -1;
      const afterSource = from ? state.rootOrder.indexOf(from) : -1;
      const rootOrder =
        pid === null
          ? afterSource >= 0
            ? [...state.rootOrder.slice(0, afterSource + 1), node.id, ...state.rootOrder.slice(afterSource + 1)]
            : firstFigure === -1
              ? [...state.rootOrder, node.id]
              : [...state.rootOrder.slice(0, firstFigure), node.id, ...state.rootOrder.slice(firstFigure)]
          : state.rootOrder;
      const childOrder =
        pid === null
          ? { ...state.childOrder, [node.id]: [] } // a new table starts empty
          : { ...state.childOrder, [pid]: [...(state.childOrder[pid] ?? []), node.id] };
      return { ...state, nodes, rootOrder, childOrder, activeNodeId: node.id, isDirty: true };
    }
    case "applyWand": {
      // The planner (src/lib/wand.ts) already built the new content: one swap,
      // one undo step, and the first created node becomes the active one.
      return { ...state, nodes: action.nodes, childOrder: action.childOrder, activeNodeId: action.activeNodeId, isDirty: true };
    }
    case "setActive":
      return { ...state, activeNodeId: action.id };
    case "cloneGraph":
      return {
        ...state,
        nodes: { ...state.nodes, ...action.plan.nodes },
        rootOrder: action.plan.rootOrder,
        childOrder: action.plan.childOrder,
        activeNodeId: action.plan.activeNodeId,
        isDirty: true,
      };
    case "rename": {
      const node = state.nodes[action.id];
      if (!node || node.name === action.name) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, name: action.name } },
        isDirty: true,
      };
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
        nodes[id] = orphan
          ? { ...orphan, parentId: null, orphaned: true, sourceTableName: target?.name }
          : detached;
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
    case "setAnalysisParams": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "analysis" || node.orphaned) return state;
      return {
        ...state,
        nodes: { ...state.nodes, [action.id]: { ...node, analysisParams: action.params } },
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
      // Every child (analysis or graph, in sidebar order) is cloned with a
      // fresh id and re-parented to the copy; its params/options are deep
      // copies, so editing the copy's family never touches the source's.
      const childIds = state.childOrder[action.id] ?? [];
      const clonedChildren: ProjectNode[] = childIds.flatMap((childId) => {
        const child = state.nodes[childId];
        if (!child) return [];
        return [
          {
            ...child,
            id: genId(child.type),
            parentId: newTableId,
            analysisParams: child.analysisParams
              ? JSON.parse(JSON.stringify(child.analysisParams))
              : undefined,
            graphOptions: child.graphOptions
              ? JSON.parse(JSON.stringify(child.graphOptions))
              : undefined,
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
    case "updateTable": {
      const node = state.nodes[action.id];
      if (!node || node.type !== "table") return state;
      const nodes = { ...state.nodes };
      // The table, then the tables computed from it (and from those) take their new values.
      const update = (id: string, data: TableData) => {
        const before = nodes[id];
        // A calculated variable follows every edit to its table — typing a
        // source value, pasting, inserting rows, an MCP write — because the
        // recompute runs here, the one funnel every edit passes through. A
        // table computed from another (a Transform) never recomputes: its
        // values come from its source table, not from formulas.
        if (!before.transform) data = recomputeCalculated(data);
        nodes[id] = { ...before, data };
        // The table's analyses and graphs follow its renamed columns and groups, its moved
        // rows and its deleted columns.
        const columnsChanged = data.columns.join("\n") !== before.data?.columns.join("\n");
        if (action.move || columnsChanged) {
          for (const child of Object.values(nodes)) {
            if (child.parentId === id) nodes[child.id] = followTable(child, action.move ?? {}, data.columns);
          }
        }
        // Its values changed, not only a column's width: the tables computed from it follow.
        const old = before.data;
        const same = (k: "rows" | "columns" | "excluded" | "groups" | "replicates") => old?.[k] === data[k];
        if (same("rows") && same("columns") && same("excluded") && same("groups") && same("replicates")) return;
        for (const t of Object.values(nodes)) {
          if (t.transform?.from === id) update(t.id, transformTable(data, t.tableType!, t.transform, t.data));
        }
      };
      update(action.id, action.data);
      return { ...state, nodes, isDirty: true };
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
      // that drops it must not leave a stale copy behind).
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
        ...(action.projectName ? { projectName: action.projectName } : {}),
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
  }
}

// The changes Undo can take back. With undo, redo and load, they bump
// `revision`; a no-op (the same state back, e.g. a reorder that moved nothing) does not.
const UNDOABLE = new Set<Action["type"]>([
  "create",
  "applyWand",
  "cloneGraph",
  "rename",
  "remove",
  "duplicateFamily",
  "updateTable",
  "updateGraph",
  "updateGraphs",
  "updateInfoSheet",
  "updateFloatingNotes",
  "setNotes",
  "setTags",
  "setHighlight",
  "updateFigure",
  "applyScript",
  "reorderRoot",
  "reorderChildren",
  "setAnalysisFrozen",
  "setAnalysisParams",
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
    case "rename":
      return "Rename";
    case "remove":
      return "Delete";
    case "setAnalysisFrozen":
      return action.frozen ? "Freeze Results" : "Unfreeze Results";
    case "setAnalysisParams":
      return "Change Analysis Parameters";
    case "duplicateFamily":
      return "Duplicate Family";
    case "updateTable":
      return action.label;
    case "updateGraph":
      return "Format Change";
    case "setNotes":
      return "Notes";
    case "setTags":
      return "Tags";
    case "updateGraphs":
      return "Match Graphs";
    case "updateInfoSheet":
      return "Info Sheet Change";
    case "updateFloatingNotes":
      return "Note Change";
    case "setHighlight":
      return "Highlight Sheet";
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
    action.type === "updateGraph"
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
   *  "Extracted data 2"… — root tables are numbered from 1). */
  createTableWithData: (tableType: TableType, data: TableData, name: string) => void;
  /** A table computed from `from`'s values (Transform or Normalize). */
  createTransformed: (from: string, transform: Omit<Transform, "from">) => void;
  createAnalysis: (parentId: string, analysisType: AnalysisType, analysisParams?: AnalysisParams) => string;
  /** `graphOptions` (plan 38, Apply Method): the cloned options of a method
   *  file's graph, with its analysis links remapped; omitted, the graph gets
   *  its defaults as today. Returns the new node's id, so the caller can
   *  remap what links to it. */
  createGraph: (parentId: string, graphType: GraphType, graphOptions?: GraphOptions) => string;
  /** Wand (plan 37): copies the example table's analyses + graphs onto the
   *  target tables as one undo step; returns the per-table report (created /
   *  skipped) for the dialog's summary. Throws when the example has nothing to copy. */
  applyWand: (exampleId: string, targetIds: string[], prefix: string) => WandReport;
  /** Clones a graph with its data table and the analyses shown on it
   *  (src/lib/clone-graph.ts): one undoable step, opening on the clone.
   *  Returns the cloned graph's id; throws the plan's error when the
   *  graph (or its table) isn't there to clone. */
  cloneGraph: (graphId: string, options: CloneOptions) => string;
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
  cacheAnalysisResult: (id: string, result: AnalysisResult) => void;
  /** Freeze (or unfreeze) a results sheet. Orphaned sheets can't freeze. */
  setAnalysisFrozen: (id: string, frozen: boolean) => void;
  /** Replace an analysis node's params (a rerun with overrides). */
  setAnalysisParams: (id: string, params: AnalysisParams) => void;
  /** Duplicates a data table together with its analyses and graphs (its family). */
  duplicateFamily: (id: string) => void;
  /** `label` names the edit for Undo ("Paste"); `move`: the columns or groups it renamed
   *  and the rows it moved, which the table's analyses and graphs then follow. */
  updateTable: (id: string, data: TableData, label: string, move?: TableMove) => void;
  updateGraph: (id: string, options: GraphOptions) => void;
  /** An item's note (empty: none). */
  setNotes: (id: string, notes: string) => void;
  /** An item's tags (none: no tag). */
  setTags: (id: string, tags: TagColor[]) => void;
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
    fileUnknowns?: Record<string, unknown>;
    projectUnknowns?: Record<string, unknown>;
    /** null: a project not saved anywhere yet (the sample project). */
    filePath: string | null;
    /** Changed as it was read: it opens edited, so saving keeps it as it is now. */
    edited?: boolean;
  }) => void;
  markProjectSaved: (filePath: string | null, savedRevision: number) => void;
}

interface ProjectContextValue extends ProjectActions {
  nodes: Record<string, ProjectNode>;
  /** The tables, in sidebar order. */
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
  activeNode: ProjectNode | null;
  activeTableId: string | null;
  /** The script-set project name (v2 item 6). */
  projectName?: string;
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
export type OutlineNode = Pick<ProjectNode, "id" | "type" | "name" | "parentId" | "highlight" | "tags">;
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

const outlineNode = ({ id, type, name, parentId, highlight, tags }: ProjectNode): OutlineNode => ({
  id,
  type,
  name,
  parentId,
  highlight,
  tags,
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
    const createTableWithData = (tableType: TableType, data: TableData, name: string) =>
      dispatch({
        type: "create",
        node: {
          id: genId("table"),
          type: "table",
          name,
          parentId: null,
          tableType,
          data,
        },
      });
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
        const { label, name } = ANALYSES[analysisType];
        const id = genId("analysis");
        dispatch({
          type: "create",
          node: {
            id,
            type: "analysis",
            name: name?.(analysisParams) ?? label,
            parentId,
            analysisType,
            analysisParams,
          },
        });
        return id;
      },
      createGraph: (parentId, graphType, graphOptions) => {
        // A new graph inherits its table's error format: an SD-formatted
        // table's graphs default to SD error bars (a table with no format
        // recorded reads as SEM, the default, as before).
        const parent = latest.current.nodes[parentId];
        const id = genId("graph");
        dispatch({
          type: "create",
          node: {
            id,
            type: "graph",
            name: GRAPHS[graphType].label,
            parentId,
            graphType,
            graphOptions: graphOptions ?? newGraphOptions(graphType, parent?.data?.errorFormat),
          },
        });
        return id;
      },
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
      setAnalysisParams: (id, params) => dispatch({ type: "setAnalysisParams", id, params }),
      duplicateFamily: (id) => dispatch({ type: "duplicateFamily", id }),
      updateTable: (id, data, label, move) => dispatch({ type: "updateTable", id, data, label, move }),
      updateGraph: (id, options) => dispatch({ type: "updateGraph", id, options, at: Date.now() }),
      setNotes: (id, notes) => dispatch({ type: "setNotes", id, notes, at: Date.now() }),
      setTags: (id, tags) => dispatch({ type: "setTags", id, tags }),
      updateGraphs: (updates) => dispatch({ type: "updateGraphs", updates, at: Date.now() }),
      updateFloatingNotes: (id, notes) => dispatch({ type: "updateFloatingNotes", id, notes, at: Date.now() }),
      setSheetHighlight: (id, highlight) => dispatch({ type: "setHighlight", id, highlight }),
      openSelector: (selector) => dispatch({ type: "openSelector", selector }),
      closeSelector: () => dispatch({ type: "closeSelector" }),
      setOpenError: (error) => dispatch({ type: "setOpenError", error }),
      reorderTables: (order) => dispatch({ type: "reorderRoot", order }),
      reorderChildren: (parentId, order) => dispatch({ type: "reorderChildren", parentId, order }),
      undo: () => dispatch({ type: "undo" }),
      redo: () => dispatch({ type: "redo" }),
      loadProject: (payload) => dispatch({ type: "load", ...payload }),
      markProjectSaved: (filePath, savedRevision) => dispatch({ type: "markSaved", filePath, savedRevision }),
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
      activeNode,
      activeTableId,
      projectName: state.projectName,
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
