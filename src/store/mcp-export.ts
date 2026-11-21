// Headless export jobs for the MCP dispatcher (v1.6.0 L8, GAP-2):
// the four tools `titer_export_graph`, `titer_export_figure`,
// `titer_export_office` and `titer_export_table_data`.
//
// GAP-2 was that every export path rendered through `Plotly.toImage` on
// a live, mounted DOM element, so a graph that was not open on screen
// could not be exported. The offscreen path below reuses the one the
// figure export already proved (`panelImage` in
// `src/views/figures/figure-export.ts`): build the Plotly figure from
// the node with `buildPanelFigure`, `Plotly.react` it into a detached
// div, then `Plotly.toImage` — the same builder and the same `toImage`
// call the GUI's graph export makes on its mounted element, at the same
// size/scale. It runs in the project window's webview (the dispatcher
// already runs there, so a DOM exists) — no hidden render window.
//
// The frontend renders AND writes the file (the existing `write_file`
// Tauri command, same as L2's save job), so image bytes never cross the
// MCP boundary as base64: Rust resolves the path, enqueues the job,
// awaits the outcome, and returns only the metadata.
//
// One documented delta: `buildPanelFigure` draws the graph's base chart
// only — the overlays that need React hooks (significance brackets,
// regression / dose-response curves, forest / scree / PCA / K-means
// overlays) are not built, exactly as figure panels behave today (see
// `panel-figure.ts`). A graph with no linked-analysis overlays renders
// identically to its on-screen view; the end-pass byte-equality proof
// records which overlay graphs differ.
import { buildPanelFigure } from "../views/figures/panel-figure";
import { renderFigureRaster, renderFigureSvg } from "../views/figures/figure-export";
import { loadPlotly } from "../views/graphs/plotly";
import { withoutSelection } from "../views/graphs/selection";
import { vectorTraces } from "../views/graphs/plot-helpers";
import {
  EXPORT_FORMATS,
  RESOLUTIONS,
  type ExportFormat,
} from "../views/graphs/graph-export";
import { largestAt, PX_PER_INCH, withDpi } from "../lib/image-dpi";
import { bmpEncode, decodePng, pdfEncode, tiffEncode } from "../lib/raster-export";
import {
  grayscaleFigure,
  svgToEps,
  svgToPdf,
  validateExportColorMode,
  VectorExportError,
  type ColorMode,
} from "../lib/vector-export";
import { DEFAULT_FIGURE_SIZE, validateFigureSize } from "../lib/figure";
import {
  buildOfficeDocument,
  officeExtension,
  pngSize,
  type OfficeTarget,
} from "../lib/office-export";
import JSZip from "jszip";
import {
  DEFAULT_GRAPH_OPTIONS,
  GRAPH_LIMITS,
  type ProjectNode,
  type Resolution,
  type TableData,
} from "./types";
import {
  ensureSaveExtension,
  writeFile as nativeWriteFile,
  type McpJob,
} from "../native";

/** The project as an export job sees it: the store state, nothing more. */
export interface ExportJobState {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
}

/** The native IO an export job needs, injectable so the node test harness
 *  can drive the table-data jobs without a webview (defaults: the real
 *  `write_file` call). The graph/figure renders need a DOM, so only the
 *  table jobs run in node. */
export interface ExportIo {
  writeFile: (path: string, data: string | Uint8Array) => Promise<unknown>;
}

export const defaultExportIo: ExportIo = { writeFile: nativeWriteFile };

/** What an export job needs from the app. */
export interface ExportJobDeps {
  getState: () => ExportJobState;
  io?: ExportIo;
}

/** What one export job reports: the tool's output. */
export interface ExportJobOutcome {
  result: Record<string, unknown>;
}

/** `Job <id> (<action>) …` — the plain-language error prefix, as the
 *  other dispatch branches use it. */
const jobErr = (job: McpJob, message: string) => new Error(`Job ${job.job_id} (${job.action}) ${message}`);

function argsOf(job: McpJob): Record<string, unknown> {
  const args = job.args as Record<string, unknown> | null | undefined;
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw jobErr(job, "has no arguments object.");
  return args;
}

function reqStr(job: McpJob, args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value) throw jobErr(job, `needs ${name} to be a non-empty string.`);
  return value;
}

function optStr(job: McpJob, args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw jobErr(job, `needs ${name} to be a string.`);
  return value;
}

function optNum(job: McpJob, args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw jobErr(job, `needs ${name} to be a number.`);
  }
  return value;
}

/** The file extension for a graph/figure export format. */
export const EXPORT_EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpeg: "jpg",
  svg: "svg",
  pdf: "pdf",
  tiff: "tiff",
  eps: "eps",
  bmp: "bmp",
};

/** A node name as a file stem: path separators, Windows-illegal
 *  characters and control characters become `-`, leading/trailing dots
 *  and spaces go, over-long stems are cut. Falls back to `fallback`
 *  when nothing survives. (Rust's default-path builder mirrors this —
 *  keep the two in step.) */
export function sanitizeFileStem(name: string, fallback: string): string {
  const stem = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return stem ? stem.slice(0, 200) : fallback;
}

/** A graph node, by id — a missing node, or a node of another kind, is a
 *  plain error. */
function graphNode(job: McpJob, state: ExportJobState, graphId: string): ProjectNode {
  const node = state.nodes[graphId];
  if (!node) throw jobErr(job, `has no graph with id “${graphId}” in this project. Ask titer_list_projects for the ids.`);
  if (node.type !== "graph") {
    throw jobErr(job, `“${graphId}” is not a graph (it is a ${node.type}).`);
  }
  return node;
}

/** The graph's drawn size in 96-DPI px — its saved `GraphOptions`
 *  width/height, exactly as the graph view draws it
 *  (`graph-view.tsx`: `{...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions}`),
 *  overridden by `width_in` / `height_in` (inches → ×96 px; giving only
 *  one derives the other from the saved aspect ratio). Out-of-limits
 *  sizes are a plain error naming the limits. */
export function graphDrawSize(
  graph: ProjectNode,
  widthIn?: number,
  heightIn?: number,
): { width: number; height: number } {
  const saved = { ...DEFAULT_GRAPH_OPTIONS, ...graph.graphOptions };
  if (widthIn !== undefined && !(widthIn > 0)) throw new Error("width_in must be greater than 0.");
  if (heightIn !== undefined && !(heightIn > 0)) throw new Error("height_in must be greater than 0.");
  let width = widthIn !== undefined ? Math.round(widthIn * PX_PER_INCH) : saved.width;
  let height = heightIn !== undefined ? Math.round(heightIn * PX_PER_INCH) : saved.height;
  if (widthIn !== undefined && heightIn === undefined) height = Math.round((width * saved.height) / saved.width);
  if (heightIn !== undefined && widthIn === undefined) width = Math.round((height * saved.width) / saved.height);
  const { width: wLim, height: hLim } = GRAPH_LIMITS;
  if (width < wLim.min || width > wLim.max || height < hLim.min || height > hLim.max) {
    throw new Error(
      `The graph would be ${width} × ${height} px — graphs export between ${wLim.min}–${wLim.max} px wide and ${hLim.min}–${hLim.max} px tall.`,
    );
  }
  return { width, height };
}

/** The export's pixel size at `dpi`, capped to the largest image Titer
 *  draws (`largestAt`) — the figure export's rule, not the GUI graph
 *  export's refusal (the tool reports the shrink instead). SVG has no
 *  DPI: its size is the 96-DPI layout size, never capped. `draw96` is
 *  the layout size Plotly lays out in (the capped one, when capped). */
export function exportPixelSize(
  size96: { width: number; height: number },
  format: ExportFormat,
  dpi: number,
): { widthPx: number; heightPx: number; capped: boolean; reason?: string; draw96: { width: number; height: number } } {
  // SVG/EPS/vector PDF have no DPI: their size is the 96-DPI layout size,
  // never capped.
  if (format === "svg" || format === "eps" || format === "pdf")
    return { widthPx: size96.width, heightPx: size96.height, capped: false, draw96: size96 };
  const most = largestAt(size96, dpi);
  const capped = most.width < size96.width || most.height < size96.height;
  const widthPx = Math.round((most.width * dpi) / PX_PER_INCH);
  const heightPx = Math.round((most.height * dpi) / PX_PER_INCH);
  return capped
    ? {
        widthPx,
        heightPx,
        capped: true,
        reason: `At ${dpi} DPI, the largest graph Titer exports is ${widthPx} × ${heightPx} px. Choose a lower resolution, or make the graph smaller.`,
        draw96: most,
      }
    : { widthPx, heightPx, capped: false, draw96: size96 };
}

const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };

/** One graph as image bytes, drawn offscreen — the GUI's `toImage` path
 *  (`graph-export.ts`) with the mounted element replaced by a detached
 *  div, exactly as the figure export's `panelImage` does. PDF is true
 *  vector (the SVG Plotly draws, converted); when the drawing has
 *  content the converter cannot draw it falls back to the raster PDF
 *  and reports `vector: false`. EPS is true vector, no fallback. BMP is
 *  the PNG re-encoded. Grayscale is drawn gray (the figure is walked
 *  before Plotly draws); CMYK is applied at emit time. */
export async function renderGraphImage(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: Resolution,
  size96: { width: number; height: number },
  colorMode: ColorMode = "color",
): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number; capped: boolean; reason?: string; vector: boolean }> {
  const fig = buildPanelFigure(graph, nodes);
  if (!fig) {
    throw new Error(
      `Graph “${graph.name}” has nothing to draw — its table has no numeric columns, or its graph type is unknown.`,
    );
  }
  const px = exportPixelSize(size96, format, Number(dpi));
  const { draw96, ...dims } = px;
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;";
  document.body.appendChild(el);
  try {
    const Plotly = await loadPlotly();
    await Plotly.react(el, fig.data, { ...fig.layout, ...draw96 }, { displayModeBar: false, scrollZoom: false, doubleClick: false });
    const drawn = el as unknown as { data: unknown[]; layout: object };
    // EPS is drawn as SVG (Plotly has no EPS output); PDF/TIFF/BMP are
    // built from the PNG Plotly draws (it has no PDF/TIFF/BMP output).
    const drawnFormat = format === "eps" ? "svg" : format === "pdf" || format === "tiff" || format === "bmp" ? "png" : format;
    const layout =
      drawnFormat === "jpeg" || format === "pdf" || format === "tiff" || format === "eps" || format === "bmp"
        ? { ...drawn.layout, ...WHITE }
        : drawn.layout;
    const figure =
      colorMode === "grayscale"
        ? grayscaleFigure({ data: vectorTraces(withoutSelection(drawn.data)), layout })
        : { data: vectorTraces(withoutSelection(drawn.data)), layout };
    const vector = format === "svg" || format === "eps" || format === "pdf";
    const scale = vector ? 1 : Number(dpi) / PX_PER_INCH;
    const url = await Plotly.toImage(figure, { format: drawnFormat, ...draw96, scale });
    const image = await (await fetch(url)).blob();
    if (format === "svg") {
      return { bytes: new TextEncoder().encode(await image.text()), ...dims, vector: true };
    }
    // The blob's body reads once: take the bytes, derive the SVG text
    // (vector formats) and the PNG (raster formats / the PDF fallback).
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (format === "eps") {
      return { bytes: svgToEps(new TextDecoder().decode(bytes), { colorMode }), ...dims, vector: true };
    }
    if (format === "pdf") {
      try {
        return { bytes: svgToPdf(new TextDecoder().decode(bytes), { colorMode }), ...dims, vector: true };
      } catch (err) {
        if (!(err instanceof VectorExportError)) throw err;
        return { bytes: pdfEncode(decodePng(bytes), Number(dpi), colorMode), ...dims, vector: false };
      }
    }
    if (format === "bmp") return { bytes: bmpEncode(decodePng(bytes), Number(dpi)), ...dims, vector: false };
    if (format === "tiff") return { bytes: tiffEncode(decodePng(bytes), Number(dpi), colorMode), ...dims, vector: false };
    const stamped = await withDpi(bytes, format as "png" | "jpeg", Number(dpi)).arrayBuffer();
    return { bytes: new Uint8Array(stamped), ...dims, vector: false };
  } finally {
    void loadPlotly().then((Plotly) => Plotly.purge(el));
    el.remove();
  }
}

/** `export-graph`: render one graph offscreen and write the file. The
 *  path is resolved by Rust (the tool's default-path rule) and arrives
 *  here; the extension is ensured defensively. */
export async function executeExportGraph(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const graphId = reqStr(job, args, "graph_id");
  const { format, dpi, colorMode } = exportFormatDpi(job, args);
  const path = reqStr(job, args, "path");
  const widthIn = optNum(job, args, "width_in");
  const heightIn = optNum(job, args, "height_in");
  const state = deps.getState();
  const graph = graphNode(job, state, graphId);
  const size96 = graphDrawSize(graph, widthIn, heightIn);
  const out = await renderGraphImage(graph, state.nodes, format, dpi, size96, colorMode);
  const ext = EXPORT_EXTENSION[format];
  const io = deps.io ?? defaultExportIo;
  await io.writeFile(ensureSaveExtension(path, ext), out.bytes);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    graph_id: graphId,
    format,
    dpi,
    color_mode: colorMode,
    vector: out.vector,
    path,
    width_px: out.widthPx,
    height_px: out.heightPx,
    capped: out.capped,
  };
  if (out.reason) result.reason = out.reason;
  return { result };
}

/** A figure node, by id — a missing node, or a node of another kind, is
 *  a plain error. */
function figureNode(job: McpJob, state: ExportJobState, figureId: string): ProjectNode {
  const node = state.nodes[figureId];
  if (!node) throw jobErr(job, `has no figure with id “${figureId}” in this project. Ask titer_list_projects for the ids.`);
  if (node.type !== "figure") {
    throw jobErr(job, `“${figureId}” is not a figure (it is a ${node.type}).`);
  }
  return node;
}

/** A table node, by id — a missing node, or a node of another kind, is a
 *  plain error. */
function tableNode(job: McpJob, state: ExportJobState, tableId: string): ProjectNode {
  const node = state.nodes[tableId];
  if (!node) throw jobErr(job, `has no table with id “${tableId}” in this project. Ask titer_list_tables for the ids.`);
  if (node.type !== "table") {
    throw jobErr(job, `“${tableId}” is not a table (it is a ${node.type}).`);
  }
  return node;
}

/** `format` / `dpi` / `color_mode` args, validated the same way for graph
 *  and figure exports (Rust validates them too; the dispatcher is the
 *  authority). CMYK exists only for EPS, PDF and TIFF — the other
 *  formats have no CMYK form. */
function exportFormatDpi(
  job: McpJob,
  args: Record<string, unknown>,
): { format: ExportFormat; dpi: Resolution; colorMode: ColorMode } {
  const formatRaw = reqStr(job, args, "format");
  if (!EXPORT_FORMATS.some((f) => f.value === formatRaw)) {
    throw jobErr(job, `has no export format “${formatRaw}” — the formats are ${EXPORT_FORMATS.map((f) => f.value).join(", ")}.`);
  }
  const dpiRaw = optStr(job, args, "dpi") ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpiRaw)) {
    throw jobErr(job, `has no resolution “${dpiRaw}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const colorModeRaw = optStr(job, args, "color_mode") ?? "color";
  if (colorModeRaw !== "color" && colorModeRaw !== "grayscale" && colorModeRaw !== "cmyk") {
    throw jobErr(job, `has no colour mode “${colorModeRaw}” — the colour modes are color, grayscale, cmyk.`);
  }
  try {
    validateExportColorMode(formatRaw, colorModeRaw as ColorMode);
  } catch (err) {
    throw jobErr(job, (err as Error).message);
  }
  return { format: formatRaw as ExportFormat, dpi: dpiRaw as Resolution, colorMode: colorModeRaw as ColorMode };
}

/** `export-figure`: render one figure offscreen and write the file —
 *  the figure export's own `renderFigureRaster` / `renderFigureSvg`,
 *  which already render each panel offscreen, so no new render path is
 *  needed here. `missing` counts panels whose graph could not be drawn
 *  (reported, not hidden); a figure with no panels is a plain error.
 *  `width_in` / `height_in` override the figure's size (one derives the
 *  other from the saved aspect ratio). PDF is true vector (the composed
 *  SVG, converted); when a panel has content the converter cannot draw
 *  it falls back to the raster PDF and reports `vector: false`. */
export async function executeExportFigure(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const figureId = reqStr(job, args, "figure_id");
  const { format, dpi, colorMode } = exportFormatDpi(job, args);
  const path = reqStr(job, args, "path");
  const widthIn = optNum(job, args, "width_in");
  const heightIn = optNum(job, args, "height_in");
  const state = deps.getState();
  const figure = figureNode(job, state, figureId);
  if (!figure.panels?.length) {
    throw jobErr(job, `cannot export figure “${figure.name}” — add a panel first.`);
  }
  const savedSize = figure.figureSize ?? DEFAULT_FIGURE_SIZE;
  const override = { widthIn: widthIn ?? savedSize.widthIn, heightIn: heightIn ?? savedSize.heightIn };
  if (widthIn !== undefined && heightIn === undefined)
    override.heightIn = (widthIn * savedSize.heightIn) / savedSize.widthIn;
  if (heightIn !== undefined && widthIn === undefined)
    override.widthIn = (heightIn * savedSize.widthIn) / savedSize.heightIn;
  const checked = validateFigureSize(override);
  if (!checked.size) throw jobErr(job, checked.reason ?? "has a figure size outside the limits.");
  const sized = { ...figure, figureSize: checked.size };
  const ext = EXPORT_EXTENSION[format];
  let bytes: Uint8Array;
  let widthPx: number;
  let heightPx: number;
  let missing: number;
  let capped = false;
  let reason: string | undefined;
  let vector = false;
  if (format === "svg") {
    const out = await renderFigureSvg(sized, state.nodes, dpi, colorMode);
    bytes = new TextEncoder().encode(out.svg);
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    vector = true;
  } else if (format === "eps") {
    const out = await renderFigureSvg(sized, state.nodes, dpi, colorMode);
    bytes = svgToEps(out.svg, { colorMode });
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    vector = true;
  } else if (format === "pdf") {
    const svgOut = await renderFigureSvg(sized, state.nodes, dpi, colorMode);
    missing = svgOut.missing;
    widthPx = svgOut.width;
    heightPx = svgOut.height;
    try {
      bytes = svgToPdf(svgOut.svg, { colorMode });
      vector = true;
    } catch (err) {
      if (!(err instanceof VectorExportError)) throw err;
      const out = await renderFigureRaster(sized, state.nodes, "pdf", dpi, colorMode);
      bytes = new Uint8Array(await out.blob.arrayBuffer());
      widthPx = out.width;
      heightPx = out.height;
      missing = out.missing;
      capped = out.capped;
      reason = out.reason;
    }
  } else {
    const out = await renderFigureRaster(sized, state.nodes, format, dpi, colorMode);
    bytes = new Uint8Array(await out.blob.arrayBuffer());
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    capped = out.capped;
    reason = out.reason;
  }
  const io = deps.io ?? defaultExportIo;
  await io.writeFile(ensureSaveExtension(path, ext), bytes);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    figure_id: figureId,
    format,
    dpi,
    color_mode: colorMode,
    vector,
    path,
    width_px: widthPx,
    height_px: heightPx,
    missing,
    capped,
  };
  if (reason) result.reason = reason;
  return { result };
}

/** `export-office`: the GUI's one-click Send to Word / PowerPoint
 *  (`sendGraphToOffice` / `sendFigureToOffice`), driven headlessly —
 *  the same PNG render at `dpi`, embedded at its physical size in a
 *  real .docx / .pptx by the pure `buildOfficeDocument`. Exactly one
 *  of `graph_id` / `figure_id`. */
export async function executeExportOffice(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const graphId = optStr(job, args, "graph_id");
  const figureId = optStr(job, args, "figure_id");
  if ((graphId === undefined) === (figureId === undefined)) {
    throw jobErr(job, "needs exactly one of graph_id and figure_id — one image per document, as the UI's one-click export.");
  }
  const targetRaw = reqStr(job, args, "target");
  if (targetRaw !== "word" && targetRaw !== "powerpoint") {
    throw jobErr(job, `has no office target “${targetRaw}” — the targets are word and powerpoint.`);
  }
  const target = targetRaw as OfficeTarget;
  const dpiRaw = optStr(job, args, "dpi") ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpiRaw)) {
    throw jobErr(job, `has no resolution “${dpiRaw}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const dpi = dpiRaw as Resolution;
  const path = reqStr(job, args, "path");
  const state = deps.getState();
  let png: Uint8Array;
  let title: string;
  let widthPx: number;
  let heightPx: number;
  let missing = 0;
  let capped = false;
  let reason: string | undefined;
  if (graphId !== undefined) {
    const graph = graphNode(job, state, graphId);
    const size96 = graphDrawSize(graph);
    const out = await renderGraphImage(graph, state.nodes, "png", dpi, size96);
    png = out.bytes;
    title = graph.name;
    widthPx = out.widthPx;
    heightPx = out.heightPx;
    capped = out.capped;
    reason = out.reason;
  } else {
    const figure = figureNode(job, state, figureId!);
    if (!figure.panels?.length) {
      throw jobErr(job, `cannot export figure “${figure.name}” — add a panel first.`);
    }
    const out = await renderFigureRaster(figure, state.nodes, "png", dpi);
    png = new Uint8Array(await out.blob.arrayBuffer());
    title = figure.name;
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    capped = out.capped;
    reason = out.reason;
  }
  const dims = pngSize(png);
  if (!dims) throw jobErr(job, "could not draw the image as a PNG image.");
  const doc = await buildOfficeDocument(target, {
    png,
    title,
    widthPx: dims.widthPx,
    heightPx: dims.heightPx,
    dpi: Number(dpi),
  });
  const ext = officeExtension(target);
  const io = deps.io ?? defaultExportIo;
  await io.writeFile(ensureSaveExtension(path, ext), doc);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    target,
    path,
    extension: ext,
    width_px: widthPx,
    height_px: heightPx,
    capped,
  };
  if (graphId !== undefined) result.graph_id = graphId;
  else result.figure_id = figureId;
  if (missing) result.missing = missing;
  if (reason) result.reason = reason;
  return { result };
}

// ── Table data (CSV / XLSX / TXT) ──────────────────────────────────────
// No UI CSV writer exists to reuse: the serializers below are new, but
// they follow the snapshot's rule — excluded cells are written empty,
// matching what analyses see. Cell values are the grid's stored
// strings; nothing is coerced to a number (an XLSX cell stays text, so
// an ID like "0123" never becomes 123).

/** The table's grid as text rows: every column (column 0 is the row
 *  titles), every stored row (short rows padded), excluded cells empty. */
export function tableTextRows(data: TableData): string[][] {
  const columns = data.columns.length ? data.columns : ["Title"];
  const excluded = new Set(data.excluded ?? []);
  return data.rows.map((row, r) =>
    columns.map((_, c) => {
      if (c >= 1 && excluded.has(`${r},${c}`)) return "";
      const cell = row[c];
      return cell === null || cell === undefined ? "" : cell;
    }),
  );
}

/** One CSV field: quoted (with doubled quotes) when it holds a comma,
 *  a quote, or a line break. */
export function csvField(cell: string): string {
  return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** One TXT field (tab-separated): quoted when it holds a tab, a quote,
 *  or a line break. */
export function txtField(cell: string): string {
  return /[\t"\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** The table as CSV text (one row per line, CRLF-free). */
export function tableToCsv(data: TableData): string {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data)];
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}

/** The table as TXT text (tab-separated, same grid as CSV). */
export function tableToTxt(data: TableData): string {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data)];
  return rows.map((row) => row.map(txtField).join("\t")).join("\n");
}

const escapeXml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A spreadsheet column letter: 0 → A, 25 → Z, 26 → AA. */
export function colLetter(n: number): string {
  let out = "";
  let i = n;
  do {
    out = String.fromCharCode(65 + (i % 26)) + out;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return out;
}

/** A sheet name Excel accepts: the table name without `[]:*?/\`,
 *  at most 31 characters. */
export function sheetName(name: string): string {
  const clean = name.replace(/[\[\]:*?/\\]/g, "").trim();
  return clean ? clean.slice(0, 31) : "Table";
}

/** The table as a minimal .xlsx workbook (JSZip + inline strings, the
 *  same hand-built pattern as `office-export.ts`): one sheet, every
 *  cell an inline string, empty cells omitted (sparse). Opens in
 *  Excel, LibreOffice and Sheets. */
export async function tableToXlsx(data: TableData, name: string): Promise<Uint8Array> {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data)];
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          if (cell === "") return "";
          const ref = `${colLetter(c)}${r + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const sheet = sheetName(name);
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  );
  zip.file(
    "xl/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts><font><sz val="11"/><name val="Calibri"/></font></fonts><fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs><cellStyles><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** The table-data export formats. */
export const TABLE_DATA_FORMATS = ["csv", "xlsx", "txt"] as const;
export type TableDataFormat = (typeof TABLE_DATA_FORMATS)[number];

/** `export-table-data`: serialize one table (CSV / XLSX / TXT) and
 *  write the file. No render is involved, so this runs in node too
 *  (the verify script drives it via `executeJob` with stub IO). */
export async function executeExportTableData(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const tableId = reqStr(job, args, "table_id");
  const formatRaw = optStr(job, args, "format") ?? "csv";
  if (!(TABLE_DATA_FORMATS as readonly string[]).includes(formatRaw)) {
    throw jobErr(job, `has no table format “${formatRaw}” — the formats are csv, xlsx, txt.`);
  }
  const format = formatRaw as TableDataFormat;
  const path = reqStr(job, args, "path");
  const state = deps.getState();
  const table = tableNode(job, state, tableId);
  const data = table.data ?? { columns: ["Title"], rows: [] };
  let bytes: string | Uint8Array;
  if (format === "csv") bytes = tableToCsv(data);
  else if (format === "txt") bytes = tableToTxt(data);
  else bytes = await tableToXlsx(data, table.name);
  const io = deps.io ?? defaultExportIo;
  await io.writeFile(ensureSaveExtension(path, format), bytes);
  return {
    result: {
      project_id: job.project_id,
      table_id: tableId,
      format,
      path,
      rows: data.rows.length,
    },
  };
}
