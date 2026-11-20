// Export All Graphs & Layouts (seq 179, Prism parity): every graph and
// figure (Titer's name for a Prism layout) in the project, one file each,
// in one folder, at one format and DPI — Prism's File > Export All Graphs.
// The plan below is pure (no DOM, no IO) so the node test harness can pin
// it; the render + write live in `src/store/mcp-export.ts`
// (`executeExportAllGraphs`, used by both the MCP tool and the File-menu
// dialog), and the folder default lives in Rust (`default_export_dir`).
//
// A figure with no panels is skipped, not failed: there is nothing to draw
// yet, and one empty layout must not stop the rest of the batch. A graph
// is never pre-skipped here — whether it draws is the renderer's call,
// and a render failure is reported per item while the batch goes on.
import { EXPORT_FORMATS, RESOLUTIONS, type ExportFormat, type Resolution } from "../views/graphs/graph-export";
import type { ProjectNode } from "../store/types";
import { fileTitle } from "./paths";

/** A graph or figure node, as the batch sees it. */
export type ExportAllKind = "graph" | "figure";

/** One file the batch will write. */
export interface ExportAllItem {
  id: string;
  kind: ExportAllKind;
  name: string;
  fileName: string;
}

/** One node the batch leaves out, with the reason shown to the user. */
export interface ExportAllSkipped {
  id: string;
  kind: ExportAllKind;
  name: string;
  reason: string;
}

/** The batch plan: the files to write, in sidebar order, and the skips. */
export interface ExportAllPlan {
  items: ExportAllItem[];
  skipped: ExportAllSkipped[];
  format: ExportFormat;
  dpi: Resolution;
}

/** The project as the plan sees it: the store state, nothing more. */
export interface ExportAllState {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
}

export interface PlanExportAllOptions {
  format: ExportFormat;
  dpi?: Resolution;
  /** Graphs in the batch (default true). */
  includeGraphs?: boolean;
  /** Figures / layouts in the batch (default true). */
  includeFigures?: boolean;
  /** Export exactly these graphs (default: all of them). When either list
   *  is given, the other kind is left out unless its list is given too. */
  graphIds?: string[];
  /** Export exactly these figures (default: all of them). */
  figureIds?: string[];
}

/** The file extension for an export format ("jpeg" writes ".jpg", as the
 *  single-graph export does). */
export const EXPORT_ALL_EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  svg: "svg",
  pdf: "pdf",
  tiff: "tiff",
};

/** A node name as a file stem: path separators, Windows-illegal
 *  characters and control characters become `-`, leading/trailing dots
 *  and spaces go, over-long stems are cut. Falls back to `fallback`
 *  when nothing survives. (Mirrors `sanitizeFileStem` in
 *  `src/store/mcp-export.ts` and `sanitize_export_stem` in Rust — keep
 *  the three in step.) */
export function sanitizeExportAllStem(name: string, fallback: string): string {
  const stem = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return stem ? stem.slice(0, 200) : fallback;
}

/** The folder a batch writes into when the user picks none (seq 179):
 *  a `<project-stem> Exports` folder beside the project file, or null
 *  when the project has no file yet (the caller then offers
 *  `<Documents>/Titer Exports`, or asks for a folder). Mirrors
 *  `default_export_dir` in Rust — keep the two in step. */
export function defaultExportAllFolder(filePath: string | null): string | null {
  if (!filePath) return null;
  const cut = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const dir = cut >= 0 ? filePath.slice(0, cut) : "";
  const stem = sanitizeExportAllStem(fileTitle(filePath), "Titer");
  return dir ? `${dir}/${stem} Exports` : `${stem} Exports`;
}

/** Graph and figure nodes in sidebar order: each root item, then its
 *  children in order. A node the orders never mention (an orphaned
 *  analysis's sibling, a hand-edited file) is appended at the end rather
 *  than silently dropped. */
export function exportableNodesInOrder(state: ExportAllState): ProjectNode[] {
  const seen = new Set<string>();
  const ordered: ProjectNode[] = [];
  const take = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = state.nodes[id];
    if (node && (node.type === "graph" || node.type === "figure")) ordered.push(node);
  };
  for (const id of state.rootOrder) {
    take(id);
    for (const childId of state.childOrder[id] ?? []) take(childId);
  }
  for (const node of Object.values(state.nodes)) take(node.id);
  return ordered;
}

/** The batch plan for a project: which graphs and figures export, to
 *  which file names, and which are skipped. Same-named nodes get
 *  " (2)", " (3)", … — a batch never overwrites its own earlier file. */
export function planExportAll(state: ExportAllState, options: PlanExportAllOptions): ExportAllPlan {
  if (!EXPORT_FORMATS.some((f) => f.value === options.format)) {
    throw new Error(
      `Unknown export format “${options.format}” — the formats are ${EXPORT_FORMATS.map((f) => f.value).join(", ")}.`,
    );
  }
  const dpi = options.dpi ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpi)) {
    throw new Error(`Unknown resolution “${dpi}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const includeGraphs = options.includeGraphs ?? true;
  const includeFigures = options.includeFigures ?? true;
  const wantedGraphs = options.graphIds ? new Set(options.graphIds) : null;
  const wantedFigures = options.figureIds ? new Set(options.figureIds) : null;
  // An explicit list names exactly what exports: an id of the wrong kind,
  // or of a missing node, is a plain error naming it.
  const checkIds = (ids: Set<string> | null, kind: ExportAllKind) => {
    if (!ids) return;
    for (const id of ids) {
      const node = state.nodes[id];
      if (!node) throw new Error(`Export-all has no ${kind} with id “${id}” in this project.`);
      if (node.type !== kind) throw new Error(`“${id}” is not a ${kind} (it is a ${node.type}).`);
    }
  };
  checkIds(wantedGraphs, "graph");
  checkIds(wantedFigures, "figure");

  const ext = EXPORT_ALL_EXTENSION[options.format];
  const used = new Set<string>();
  const items: ExportAllItem[] = [];
  const skipped: ExportAllSkipped[] = [];
  for (const node of exportableNodesInOrder(state)) {
    const kind = node.type as ExportAllKind;
    if (kind === "graph" && !includeGraphs) continue;
    if (kind === "figure" && !includeFigures) continue;
    // Either list given selects exactly what was named; neither given
    // means all of both included kinds.
    if (wantedGraphs || wantedFigures) {
      if (kind === "graph" && !wantedGraphs?.has(node.id)) continue;
      if (kind === "figure" && !wantedFigures?.has(node.id)) continue;
    }
    if (kind === "figure" && !(node.panels?.length ?? 0)) {
      skipped.push({ id: node.id, kind, name: node.name, reason: `Figure “${node.name}” has no panels yet.` });
      continue;
    }
    const stem = sanitizeExportAllStem(node.name, kind === "graph" ? "graph" : "figure");
    let fileName = `${stem}.${ext}`;
    let n = 2;
    while (used.has(fileName)) {
      fileName = `${stem} (${n}).${ext}`;
      n++;
    }
    used.add(fileName);
    items.push({ id: node.id, kind, name: node.name, fileName });
  }
  if (!items.length) {
    throw new Error(
      "Nothing to export — this project has no graphs or figures yet. Make a graph first (Graph > New Graph…).",
    );
  }
  return { items, skipped, format: options.format, dpi: dpi as Resolution };
}
