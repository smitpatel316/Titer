// Gallery view (seq 229): Prism's Gallery shows every graph in the project
// on one sheet, so the user can see them all and jump to one. The list is
// pure — the view only renders it — in sidebar order (each table's graphs,
// in the order they sit under it), with the chart type's label and the
// table the graph belongs to.
//
// The batch half (this file's remainder): Prism's Gallery is also where a
// user works on several graphs at once — select a few and print, export,
// send, duplicate, rename, resize, highlight or recolor them together.
// Every function here is pure, so the suite pins it without a DOM: the
// selection is a plain id list, the plans say what the view then does
// (render + print, write files, hand PNGs to the Office builders), and
// the node edits come back as a new nodes record the store dispatches as
// one undoable step.
import { GRAPHS } from "../views/graphs";
import {
  clamp,
  DEFAULT_GRAPH_OPTIONS,
  GRAPH_LIMITS,
  SHEET_HIGHLIGHTS,
  type NodeType,
  type ProjectNode,
  type SheetHighlight,
} from "../store/types";
import { PALETTES } from "./palettes";
import { cloneGraphPlan, DEFAULT_CLONE_OPTIONS, type CloneOptions, type ClonePlan } from "./clone-graph";
import { EXPORT_ALL_EXTENSION, sanitizeExportAllStem } from "./export-all";
import { EXPORT_FORMATS, RESOLUTIONS, type ExportFormat, type Resolution } from "../views/graphs/graph-export";
import { officeDialogTitle, officeExtension, type OfficeTarget } from "./office-export";
import type { PrintSettings } from "./print-settings";

export interface GalleryItem {
  id: string;
  name: string;
  /** The chart type's label ("Column", "XY scatter", …). */
  graphLabel: string;
  /** The table the graph belongs to. */
  tableName: string;
}

/** Every graph in the project, in sidebar order. Figures are layouts, not
 *  graphs, so they don't appear here — they have their own sheets. */
export function galleryItems(
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
): GalleryItem[] {
  const items: GalleryItem[] = [];
  for (const tableId of rootOrder) {
    const table = nodes[tableId];
    if (!table || table.type !== "table") continue;
    for (const childId of childOrder[tableId] ?? []) {
      const child = nodes[childId];
      if (!child || child.type !== "graph" || !child.graphType) continue;
      items.push({
        id: child.id,
        name: child.name,
        graphLabel: GRAPHS[child.graphType]?.label ?? child.graphType,
        tableName: table.name,
      });
    }
  }
  return items;
}

// ── Selection ────────────────────────────────────────────────────────────

/** One batch member the plan leaves out, with the reason the user sees. */
export interface GalleryBatchSkipped {
  id: string;
  reason: string;
}

/** The selection is a plain id list — the view keeps it in state, and
 *  these helpers are the only way it changes, so a card can never be
 *  selected twice and toggling the same card twice leaves it unselected.
 *  An id the gallery doesn't hold can sit in the list (the user selected
 *  it, then the graph was deleted); the resolvers below drop it. */
export function toggleGallerySelection(selection: string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
}

/** Every card in the gallery, in gallery order. */
export function selectAllGallery(items: GalleryItem[]): string[] {
  return items.map((item) => item.id);
}

/** The selected cards, in gallery order — not selection order, so a
 *  batch always runs top-to-bottom as the user sees it. Unknown ids are
 *  dropped silently here; the plan functions report them as skipped. */
export function selectedGalleryItems(items: GalleryItem[], selection: string[]): GalleryItem[] {
  const wanted = new Set(selection);
  return items.filter((item) => wanted.has(item.id));
}

/** The selected cards plus the selected ids no card answers to, in
 *  selection order — the shared head of the rename/print/export/send
 *  plans, so they all agree on what was skipped and why. */
function resolveSelection(items: GalleryItem[], selection: string[]) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const selected = selectedGalleryItems(items, selection);
  const skipped: GalleryBatchSkipped[] = [];
  for (const id of selection) if (!byId.has(id)) skipped.push({ id, reason: `“${id}” is not in the gallery.` });
  return { selected, skipped };
}

// ── Thumbnails ───────────────────────────────────────────────────────────

/** A card's thumbnail size, in px — the graph's own drawing, scaled to
 *  fit the card. The view renders the PNG (Plotly, as the graph view
 *  does); this is the sizing math, pinned without a renderer. */
export interface GalleryThumbnail {
  widthPx: number;
  heightPx: number;
}

/** A card's longest side, in px. */
export const GALLERY_THUMBNAIL_MAX_PX = 220;

/** The thumbnail for a `widthPx`×`heightPx` drawing: the longest side
 *  brought to `maxPx`, the other scaled to match, never upscaled — a
 *  small graph stays small rather than blurring up to card size. */
export function galleryThumbnail(widthPx: number, heightPx: number, maxPx: number = GALLERY_THUMBNAIL_MAX_PX): GalleryThumbnail {
  if (!(widthPx > 0 && heightPx > 0)) throw new Error("A gallery thumbnail needs a positive image size.");
  if (!(maxPx > 0)) throw new Error("A gallery thumbnail needs a positive maximum side.");
  const scale = Math.min(1, maxPx / widthPx, maxPx / heightPx);
  return { widthPx: Math.round(widthPx * scale), heightPx: Math.round(heightPx * scale) };
}

// ── Batch rename ─────────────────────────────────────────────────────────

/** One graph the batch renames, as the store's rename step applies it. */
export interface GalleryRenamed {
  id: string;
  name: string;
}

/** The rename plan: the renames to apply, and the members left out. */
export interface GalleryRenamePlan {
  renamed: GalleryRenamed[];
  skipped: GalleryBatchSkipped[];
}

/** Rename the selected graphs to the names in `names` (one per id — the
 *  view collects them, one field per card). A member with no name, or a
 *  blank one, is skipped, not renamed to nothing; an unknown id is
 *  skipped too. Names need not be unique — Titer lets two sheets share a
 *  name, as the Navigator does. */
export function galleryBatchRename(
  items: GalleryItem[],
  selection: string[],
  names: Record<string, string>,
): GalleryRenamePlan {
  const { selected, skipped } = resolveSelection(items, selection);
  const renamed: GalleryRenamed[] = [];
  for (const item of selected) {
    const name = names[item.id]?.trim();
    if (!name) {
      skipped.push({ id: item.id, reason: `“${item.name}” needs a non-empty new name.` });
      continue;
    }
    renamed.push({ id: item.id, name });
  }
  return { renamed, skipped };
}

// ── Batch duplicate ──────────────────────────────────────────────────────

/** One graph the batch duplicated: the original, its clone, and the
 *  clone's table (a clone always brings its own table — see clone-graph). */
export interface GalleryDuplicated {
  id: string;
  newGraphId: string;
  newTableId: string;
}

export type GalleryBatchDuplicateResult =
  | { plan: ClonePlan; duplicated: GalleryDuplicated[]; skipped: GalleryBatchSkipped[] }
  | { error: string; skipped: GalleryBatchSkipped[] };

/** Duplicate each selected graph — the clone-graph plan, chained, so a
 *  second clone sees the first one's nodes and the ids stay unique.
 *  Graphs whose clone fails (a missing table, a non-graph id) are
 *  skipped and the rest still duplicate. Nothing duplicated at all is
 *  an error, not an empty plan: the caller must not dispatch a step
 *  that changes nothing. */
export function galleryBatchDuplicate(
  content: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
  },
  selection: string[],
  options: CloneOptions = DEFAULT_CLONE_OPTIONS,
  nextId: (type: NodeType | "note") => string = (type) =>
    `${type}_${Math.random().toString(36).slice(2, 10)}`,
): GalleryBatchDuplicateResult {
  if (selection.length === 0) return { error: "Select at least one graph to duplicate.", skipped: [] };
  let current = { nodes: { ...content.nodes }, rootOrder: [...content.rootOrder], childOrder: { ...content.childOrder } };
  const duplicated: GalleryDuplicated[] = [];
  const skipped: GalleryBatchSkipped[] = [];
  for (const id of selection) {
    const result = cloneGraphPlan(current, id, options, nextId);
    if ("error" in result) {
      skipped.push({ id, reason: result.error });
      continue;
    }
    const newGraph = result.plan.nodes[result.plan.activeNodeId];
    duplicated.push({
      id,
      newGraphId: result.plan.activeNodeId,
      newTableId: typeof newGraph?.parentId === "string" ? newGraph.parentId : "",
    });
    current = {
      nodes: { ...current.nodes, ...result.plan.nodes },
      rootOrder: result.plan.rootOrder,
      childOrder: result.plan.childOrder,
    };
  }
  if (duplicated.length === 0) return { error: "No selected graph could be duplicated.", skipped };
  return {
    plan: { nodes: current.nodes, rootOrder: current.rootOrder, childOrder: current.childOrder, activeNodeId: duplicated[0].newGraphId },
    duplicated,
    skipped,
  };
}

// ── Node edits (resize / palette / highlight) ────────────────────────────

/** A selected id that names no graph node, with the reason the user sees. */
function graphOrSkip(
  nodes: Record<string, ProjectNode>,
  id: string,
): { node: ProjectNode } | { skipped: GalleryBatchSkipped } {
  const node = nodes[id];
  if (!node) return { skipped: { id, reason: `“${id}” is not in the project.` } };
  if (node.type !== "graph") return { skipped: { id, reason: `“${node.name}” is a ${node.type}, not a graph.` } };
  return { node };
}

/** The nodes record with the edited graphs replaced — the untouched
 *  nodes keep their identity, so the store's change detection still
 *  sees exactly what moved. */
function withGraphOptions(
  nodes: Record<string, ProjectNode>,
  id: string,
  graphOptions: ProjectNode["graphOptions"],
): Record<string, ProjectNode> {
  return { ...nodes, [id]: { ...nodes[id], graphOptions } };
}

export interface GalleryResizeResult {
  nodes: Record<string, ProjectNode>;
  resized: string[];
  skipped: GalleryBatchSkipped[];
}

/** Resize the selected graphs' drawing areas to `width`×`height` px —
 *  Prism's Gallery resize, which sets every selected graph to the same
 *  size. Both sides clamp to the graph size limits (150–2400 × 120–1800),
 *  so a typed 3000 lands on 2400 instead of breaking the layout. */
export function applyGalleryResize(
  nodes: Record<string, ProjectNode>,
  selection: string[],
  width: number,
  height: number,
): GalleryResizeResult {
  if (!(width > 0 && height > 0) || !Number.isFinite(width) || !Number.isFinite(height))
    throw new Error("Gallery resize needs a positive width and height.");
  const w = clamp(width, GRAPH_LIMITS.width);
  const h = clamp(height, GRAPH_LIMITS.height);
  let next = nodes;
  const resized: string[] = [];
  const skipped: GalleryBatchSkipped[] = [];
  for (const id of selection) {
    const found = graphOrSkip(next, id);
    if ("skipped" in found) {
      skipped.push(found.skipped);
      continue;
    }
    next = withGraphOptions(next, id, { ...(found.node.graphOptions ?? DEFAULT_GRAPH_OPTIONS), width: w, height: h });
    resized.push(id);
  }
  return { nodes: next, resized, skipped };
}

export interface GalleryPaletteResult {
  nodes: Record<string, ProjectNode>;
  applied: string[];
  skipped: GalleryBatchSkipped[];
}

/** Recolor the selected graphs with a catalog palette — Prism's Gallery
 *  "change color scheme", which sets every selected graph to the same
 *  palette. The palette's colors are copied onto the graph, so a later
 *  catalog correction never rewrites a saved graph (see palettes.ts).
 *  An unknown palette name is a caller bug: the view only offers catalog
 *  names. A graph's own series styles stay — the palette is the default
 *  its unstyled series take. */
export function applyGalleryPalette(
  nodes: Record<string, ProjectNode>,
  selection: string[],
  paletteName: string,
  options?: { reversed?: boolean },
): GalleryPaletteResult {
  const palette = PALETTES.find((p) => p.name === paletteName);
  if (!palette) throw new Error(`No palette “${paletteName}”.`);
  let next = nodes;
  const applied: string[] = [];
  const skipped: GalleryBatchSkipped[] = [];
  for (const id of selection) {
    const found = graphOrSkip(next, id);
    if ("skipped" in found) {
      skipped.push(found.skipped);
      continue;
    }
    next = withGraphOptions(next, id, {
      ...(found.node.graphOptions ?? DEFAULT_GRAPH_OPTIONS),
      palette: {
        name: palette.name,
        kind: palette.kind,
        colors: [...palette.colors],
        ...(options?.reversed ? { reversed: true } : {}),
      },
    });
    applied.push(id);
  }
  return { nodes: next, applied, skipped };
}

export interface GalleryHighlightResult {
  nodes: Record<string, ProjectNode>;
  highlighted: string[];
  skipped: GalleryBatchSkipped[];
}

/** Highlight the selected graphs in the Navigator color (`null` clears
 *  it) — the same sheet highlight as project search, screen-only, never
 *  printed or exported. An unknown color is a caller bug: the view only
 *  offers the six highlight colors. */
export function galleryBatchHighlight(
  nodes: Record<string, ProjectNode>,
  selection: string[],
  highlight: SheetHighlight | null,
): GalleryHighlightResult {
  if (highlight !== null && !(SHEET_HIGHLIGHTS as readonly string[]).includes(highlight))
    throw new Error(`No highlight color “${highlight}”.`);
  let next = nodes;
  const highlighted: string[] = [];
  const skipped: GalleryBatchSkipped[] = [];
  for (const id of selection) {
    const found = graphOrSkip(next, id);
    if ("skipped" in found) {
      skipped.push(found.skipped);
      continue;
    }
    const node = { ...found.node };
    if (highlight === null) delete node.highlight;
    else node.highlight = highlight;
    next = { ...next, [id]: node };
    highlighted.push(id);
  }
  return { nodes: next, highlighted, skipped };
}

// ── Batch print / export / send ──────────────────────────────────────────

/** The print plan: the selected graphs, in gallery order, and the page
 *  settings they print under. The view applies `printPageCss(settings)`
 *  and prints — this plan is only which graphs and how. */
export interface GalleryPrintPlan {
  items: GalleryItem[];
  settings: PrintSettings;
  skipped: GalleryBatchSkipped[];
}

export function galleryBatchPrint(items: GalleryItem[], selection: string[], settings: PrintSettings): GalleryPrintPlan {
  const { selected, skipped } = resolveSelection(items, selection);
  return { items: selected, settings, skipped };
}

/** One file the export batch will write. */
export interface GalleryExportItem {
  id: string;
  name: string;
  fileName: string;
}

/** The export plan: one file per selected graph, in gallery order, at
 *  one format and DPI — the gallery half of Export All (seq 179), where
 *  the user picks the graphs instead of taking the whole project.
 *  Same-named graphs get " (2)", " (3)", … so the batch never
 *  overwrites its own earlier file. */
export interface GalleryExportPlan {
  items: GalleryExportItem[];
  skipped: GalleryBatchSkipped[];
  format: ExportFormat;
  dpi: Resolution;
}

export function galleryExportPlan(
  items: GalleryItem[],
  selection: string[],
  options: { format: ExportFormat; dpi?: Resolution },
): GalleryExportPlan {
  if (!EXPORT_FORMATS.some((f) => f.value === options.format)) {
    throw new Error(
      `Unknown export format “${options.format}” — the formats are ${EXPORT_FORMATS.map((f) => f.value).join(", ")}.`,
    );
  }
  const dpi = options.dpi ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpi)) {
    throw new Error(`Unknown resolution “${dpi}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const { selected, skipped } = resolveSelection(items, selection);
  const ext = EXPORT_ALL_EXTENSION[options.format];
  const used = new Set<string>();
  const planned: GalleryExportItem[] = [];
  for (const item of selected) {
    const stem = sanitizeExportAllStem(item.name, item.id);
    let fileName = `${stem}.${ext}`;
    for (let i = 2; used.has(fileName); i++) fileName = `${stem} (${i}).${ext}`;
    used.add(fileName);
    planned.push({ id: item.id, name: item.name, fileName });
  }
  return { items: planned, skipped, format: options.format, dpi };
}

/** One graph the send batch will place. */
export interface GallerySendItem {
  id: string;
  title: string;
}

/** The send plan: the selected graphs, in gallery order, as one Office
 *  document — `buildOfficeDocumentMulti` builds it once the view has
 *  rendered the PNGs. Keynote has no file builder (see office-export):
 *  the plan still names it, and the caller hands the PNGs to Keynote
 *  itself instead. */
export interface GallerySendPlan {
  target: OfficeTarget;
  extension: string;
  dialogTitle: string;
  items: GallerySendItem[];
  skipped: GalleryBatchSkipped[];
}

export function galleryBatchSend(items: GalleryItem[], selection: string[], target: OfficeTarget): GallerySendPlan {
  const { selected, skipped } = resolveSelection(items, selection);
  return {
    target,
    extension: officeExtension(target),
    dialogTitle: officeDialogTitle(target),
    items: selected.map((item) => ({ id: item.id, title: item.name })),
    skipped,
  };
}
