// Headless export jobs for the MCP dispatcher (v1.6.0 L8, GAP-2):
// the six tools `titer_export_graph`, `titer_export_figure`,
// `titer_export_office`, `titer_export_table_data`,
// `titer_export_all_graphs` (seq 179: every graph and figure at once)
// and `titer_copy_graph_image` (seq 296: a graph/figure image to the
// system clipboard instead of a file).
//
// GAP-2 was that every export path rendered through `Plotly.toImage` on
// a live, mounted DOM element, so a graph that was not open on screen
// could not be exported. The offscreen path below reuses the one the
// figure export already proved (`panelImage` in
// `src/views/figures/figure-export.ts`): build the Plotly figure from
// the node with `buildGraphFigure`, `Plotly.react` it into a detached
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
// Overlays (seq 173): the figure comes from the shared `buildGraphFigure`
// (`src/views/graphs/graph-figure.ts`), so a headless export draws the
// same significance brackets, fitted curves and forest / scree / PCA /
// K-means overlays the graph view draws — from the same sibling analyses,
// run live (or their frozen / orphaned stored results). The job reports
// which overlays drew (`overlays_applied`) and which didn't
// (`overlays_missing`, with why), so a caller can tell an overlay-less
// export from an overlay graph whose analysis simply hasn't run yet.
import { buildGraphFigure, type AnalysisRunner, type GraphOverlayStatus } from "../views/graphs/graph-figure";
import { renderFigureRaster, renderFigureSvg } from "../views/figures/figure-export";
import { loadPlotly } from "../views/graphs/plotly";
import { withoutSelection } from "../views/graphs/selection";
import { vectorTraces } from "../views/graphs/plot-helpers";
import {
  EXPORT_FORMATS,
  EXPORT_PRESETS,
  RESOLUTIONS,
  drawSizeAtWidth,
  exportPreset,
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
import { isMacOs } from "../lib/channel";
import JSZip from "jszip";
import { writePzfx } from "../lib/pzfx-write";
import { version as appVersion } from "../../package.json";
import { planExportAll, type ExportAllItem, type ExportAllKind } from "../lib/export-all";
import {
  DEFAULT_GRAPH_OPTIONS,
  GRAPH_LIMITS,
  type ProjectNode,
  type Resolution,
  type TableData,
} from "./types";
import {
  copyPngToClipboard,
  ensureSaveExtension,
  handoffPngToKeynote,
  writeFile as nativeWriteFile,
  type McpJob,
} from "../native";
import { loadDecimalSeparator, type DecimalSeparator } from "../lib/decimal-format";
import { parseCell } from "../lib/numeric";

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

/** The system clipboard as a PNG writer: the native pasteboard write
 *  (`copyPngToClipboard` in src/native.ts — temp PNG + osascript as
 *  PNGf, macOS only). NOT the webview's `navigator.clipboard.write`:
 *  that refuses without a user gesture (NotAllowedError), and the MCP
 *  path has no gesture — the first implementation used it and the copy
 *  failed headless. Injectable so the node harness can drive the copy
 *  job without a webview. Clipboard images must be raster: always PNG. */
export interface ClipboardIo {
  writePng: (bytes: Uint8Array) => Promise<void>;
}

export const defaultClipboardIo: ClipboardIo = {
  writePng: (bytes) => copyPngToClipboard(bytes),
};

/** What an export job needs from the app. */
export interface ExportJobDeps {
  getState: () => ExportJobState;
  io?: ExportIo;
  /** Run an analysis for an overlay (default: the real `runAnalysis`, via
   *  `buildGraphFigure`). A harness injects a stub; the table-data jobs
   *  never call it. */
  run?: AnalysisRunner;
  /** How one batch item renders (seq 179). Omitted: the real offscreen
   *  renderers below. Injectable so the node test harness can drive the
   *  batch without a webview, exactly like `io` for the table jobs. */
  render?: ExportAllRenderer;
  /** Write a PNG to the system clipboard (seq 296; default: the real
   *  `navigator.clipboard` write). A harness driving the copy job in
   *  node injects a stub here. */
  clipboard?: ClipboardIo;
  /** How the copy job renders (seq 296). Omitted: the real offscreen
   *  renderers below. Injectable so the node test harness can drive the
   *  copy job without a webview, exactly like `render` for the batch. */
  copyRender?: CopyGraphImageRenderer;
}

/** An overlay report as the tool returns it: which overlays drew, and
 *  which didn't (with why). */
export function overlayReport(overlays: GraphOverlayStatus[]): {
  overlays_applied: string[];
  overlays_missing: { overlay: string; status: string; detail?: string }[];
} {
  return {
    overlays_applied: overlays.filter((o) => o.status === "applied").map((o) => o.overlay),
    overlays_missing: overlays
      .filter((o) => o.status !== "applied")
      .map((o) => ({ overlay: o.overlay, status: o.status, ...(o.detail ? { detail: o.detail } : {}) })),
  };
}

/** One batch item drawn: the image bytes, its pixel size, and the
 *  figure export's `missing` count when the item is a figure. */
export interface ExportAllRenderOut {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  capped?: boolean;
  reason?: string;
  missing?: number;
}

/** Draw one batch item (a graph, or a whole figure) as image bytes. `run`
 *  is the analysis runner the overlays reuse (the dispatcher's, so a batch
 *  reuses the runs the view already made); `rootOrder` is the project root
 *  order, for the info sheets the build resolves. */
export type ExportAllRenderer = (
  item: ExportAllItem,
  format: ExportFormat,
  dpi: Resolution,
  nodes: Record<string, ProjectNode>,
  run?: AnalysisRunner,
  rootOrder?: string[],
) => Promise<ExportAllRenderOut>;

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

function optBool(job: McpJob, args: Record<string, unknown>, name: string): boolean | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw jobErr(job, `needs ${name} to be a boolean.`);
  return value;
}

function optStrArray(job: McpJob, args: Record<string, unknown>, name: string): string[] | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw jobErr(job, `needs ${name} to be a list of strings.`);
  }
  return value as string[];
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

/** A draw size inside the graph limits, or a plain error naming them. */
function checkedSize(width: number, height: number): { width: number; height: number } {
  const { width: wLim, height: hLim } = GRAPH_LIMITS;
  if (width < wLim.min || width > wLim.max || height < hLim.min || height > hLim.max) {
    throw new Error(
      `The graph would be ${width} × ${height} px — graphs export between ${wLim.min}–${wLim.max} px wide and ${hLim.min}–${hLim.max} px tall.`,
    );
  }
  return { width, height };
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
  // A width alone resolves through the dialog's math (`drawSizeAtWidth`):
  // the same width draws the same size from the dialog and from MCP.
  if (widthIn !== undefined && heightIn === undefined) {
    const { width, height } = drawSizeAtWidth({ width: saved.width, height: saved.height }, widthIn);
    return checkedSize(width, height);
  }
  let width = widthIn !== undefined ? Math.round(widthIn * PX_PER_INCH) : saved.width;
  let height = heightIn !== undefined ? Math.round(heightIn * PX_PER_INCH) : saved.height;
  if (heightIn !== undefined && widthIn === undefined) width = Math.round((height * saved.width) / saved.height);
  return checkedSize(width, height);
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
 *  before Plotly draws); CMYK is applied at emit time. The figure
 *  is the shared `buildGraphFigure`, so the graph's overlays draw too. */
export async function renderGraphImage(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: Resolution,
  size96: { width: number; height: number },
  run?: AnalysisRunner,
  colorMode: ColorMode = "color",
  // The project root order, for the info sheets the build resolves (the
  // node ids otherwise, as the panel builder always did) — forwarded by
  // the export jobs, which have the state. Without it a figure's info
  // constants resolve in node order, not the project's.
  rootOrder?: string[],
): Promise<{
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  capped: boolean;
  reason?: string;
  overlays: GraphOverlayStatus[];
  vector: boolean;
}> {
  const { figure: fig, overlays } = await buildGraphFigure(graph, nodes, { run, rootOrder });
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
    // EPS/PDF are drawn as SVG (Plotly has no EPS/PDF output); TIFF/BMP
    // are built from the PNG Plotly draws (it has no TIFF/BMP output).
    const drawnFormat = format === "eps" || format === "pdf" ? "svg" : format === "tiff" || format === "bmp" ? "png" : format;
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
      return { bytes: new TextEncoder().encode(await image.text()), ...dims, overlays, vector: true };
    }
    // The blob's body reads once: take the bytes, derive the SVG text
    // (vector formats) and the PNG (raster formats) from them.
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (format === "eps") {
      return { bytes: svgToEps(new TextDecoder().decode(bytes), { colorMode }), ...dims, overlays, vector: true };
    }
    if (format === "pdf") {
      try {
        return { bytes: svgToPdf(new TextDecoder().decode(bytes), { colorMode }), ...dims, overlays, vector: true };
      } catch (err) {
        if (!(err instanceof VectorExportError)) throw err;
        // The drawing has raster/gradient content: draw it again as PNG
        // and encode the raster PDF, not a vector file that silently
        // dropped it.
        const pngUrl = await Plotly.toImage(figure, { format: "png", ...draw96, scale: Number(dpi) / PX_PER_INCH });
        const pngBytes = new Uint8Array(await (await (await fetch(pngUrl)).blob()).arrayBuffer());
        return { bytes: pdfEncode(decodePng(pngBytes), Number(dpi), colorMode), ...dims, overlays, vector: false };
      }
    }
    if (format === "bmp") return { bytes: bmpEncode(decodePng(bytes), Number(dpi)), ...dims, overlays, vector: false };
    if (format === "tiff") return { bytes: tiffEncode(decodePng(bytes), Number(dpi), colorMode), ...dims, overlays, vector: false };
    const stamped = await withDpi(bytes, format as "png" | "jpeg", Number(dpi)).arrayBuffer();
    return { bytes: new Uint8Array(stamped), ...dims, overlays, vector: false };
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
  const out = await renderGraphImage(graph, state.nodes, format, dpi, size96, deps.run, colorMode, state.rootOrder);
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
    ...overlayReport(out.overlays),
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
 *  formats have no CMYK form. `preset` picks a format + resolution
 *  together ("publication" = TIFF at 300 DPI); an explicit `format` /
 *  `dpi` wins over the preset. */
export function exportFormatDpi(
  job: McpJob,
  args: Record<string, unknown>,
): { format: ExportFormat; dpi: Resolution; colorMode: ColorMode } {
  const presetRaw = optStr(job, args, "preset");
  const preset = presetRaw === undefined ? null : exportPreset(presetRaw);
  if (presetRaw !== undefined && !preset) {
    throw jobErr(job, `has no export preset “${presetRaw}” — the presets are ${EXPORT_PRESETS.map((p) => p.value).join(", ")}.`);
  }
  const formatRaw = optStr(job, args, "format") ?? preset?.format ?? reqStr(job, args, "format");
  if (!EXPORT_FORMATS.some((f) => f.value === formatRaw)) {
    throw jobErr(job, `has no export format “${formatRaw}” — the formats are ${EXPORT_FORMATS.map((f) => f.value).join(", ")}.`);
  }
  const dpiRaw = optStr(job, args, "dpi") ?? preset?.dpi ?? "300";
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
  let overlays: GraphOverlayStatus[] = [];
  let vector = false;
  if (format === "svg") {
    const out = await renderFigureSvg(sized, state.nodes, dpi, colorMode, {
      run: deps.run,
      rootOrder: state.rootOrder,
    });
    bytes = new TextEncoder().encode(out.svg);
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    overlays = out.overlays;
    vector = true;
  } else if (format === "eps") {
    const out = await renderFigureSvg(sized, state.nodes, dpi, colorMode, {
      run: deps.run,
      rootOrder: state.rootOrder,
    });
    bytes = svgToEps(out.svg, { colorMode });
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    overlays = out.overlays;
    vector = true;
  } else if (format === "pdf") {
    const svgOut = await renderFigureSvg(sized, state.nodes, dpi, colorMode, {
      run: deps.run,
      rootOrder: state.rootOrder,
    });
    missing = svgOut.missing;
    widthPx = svgOut.width;
    heightPx = svgOut.height;
    overlays = svgOut.overlays;
    try {
      bytes = svgToPdf(svgOut.svg, { colorMode });
      vector = true;
    } catch (err) {
      if (!(err instanceof VectorExportError)) throw err;
      const out = await renderFigureRaster(sized, state.nodes, "pdf", dpi, colorMode, {
        run: deps.run,
        rootOrder: state.rootOrder,
      });
      bytes = new Uint8Array(await out.blob.arrayBuffer());
      widthPx = out.width;
      heightPx = out.height;
      missing = out.missing;
      capped = out.capped;
      reason = out.reason;
      overlays = out.overlays;
    }
  } else {
    const out = await renderFigureRaster(sized, state.nodes, format, dpi, colorMode, {
      run: deps.run,
      rootOrder: state.rootOrder,
    });
    bytes = new Uint8Array(await out.blob.arrayBuffer());
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    capped = out.capped;
    reason = out.reason;
    overlays = out.overlays;
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
    ...overlayReport(overlays),
  };
  if (reason) result.reason = reason;
  return { result };
}

/** What one export-all batch reports, per item: written, skipped, or
 *  failed — a failed render never stops the rest of the batch. */
export interface ExportAllBatchOutcome {
  folder: string;
  format: ExportFormat;
  dpi: Resolution;
  exported: {
    id: string;
    kind: ExportAllKind;
    name: string;
    path: string;
    width_px: number;
    height_px: number;
    capped?: boolean;
    reason?: string;
    missing?: number;
  }[];
  skipped: { id: string; kind: ExportAllKind; name: string; reason: string }[];
  failed: { id: string; kind: ExportAllKind; name: string; error: string }[];
  exported_count: number;
  skipped_count: number;
  failed_count: number;
}

export interface RunExportAllOptions {
  folder: string;
  format: ExportFormat;
  dpi: Resolution;
  includeGraphs?: boolean;
  includeFigures?: boolean;
  graphIds?: string[];
  figureIds?: string[];
}

/** The real batch renderer: a graph through the headless graph render,
 *  a figure through its own raster/SVG render — the same paths the
 *  single-item tools use, so a batch file matches its one-at-a-time file.
 *  `run` and `rootOrder` forward into both, so a batch overlay reuses the
 *  view's runs and the info sheets resolve in project order (Round 2
 *  Issue 50: the batch used to render with neither). */
async function defaultExportAllRender(
  item: ExportAllItem,
  format: ExportFormat,
  dpi: Resolution,
  nodes: Record<string, ProjectNode>,
  run?: AnalysisRunner,
  rootOrder?: string[],
): Promise<ExportAllRenderOut> {
  if (item.kind === "graph") {
    const graph = nodes[item.id]!;
    const size96 = graphDrawSize(graph);
    const out = await renderGraphImage(graph, nodes, format, dpi, size96, run, undefined, rootOrder);
    return { bytes: out.bytes, widthPx: out.widthPx, heightPx: out.heightPx, capped: out.capped, reason: out.reason };
  }
  const figure = nodes[item.id]!;
  const figureOpts = { run, rootOrder };
  if (format === "svg") {
    const out = await renderFigureSvg(figure, nodes, dpi, "color", figureOpts);
    return {
      bytes: new TextEncoder().encode(out.svg),
      widthPx: out.width,
      heightPx: out.height,
      missing: out.missing,
    };
  }
  if (format === "eps") {
    // EPS is SVG converted, as the single-item export does — the raster
    // renderer takes no eps.
    const out = await renderFigureSvg(figure, nodes, dpi, "color", figureOpts);
    return {
      bytes: svgToEps(out.svg),
      widthPx: out.width,
      heightPx: out.height,
      missing: out.missing,
    };
  }
  if (format === "pdf") {
    // PDF is true vector (the composed SVG, converted), with a raster
    // fallback when a panel has content the converter cannot draw.
    const svgOut = await renderFigureSvg(figure, nodes, dpi, "color", figureOpts);
    try {
      return {
        bytes: svgToPdf(svgOut.svg),
        widthPx: svgOut.width,
        heightPx: svgOut.height,
        missing: svgOut.missing,
      };
    } catch (err) {
      if (!(err instanceof VectorExportError)) throw err;
      const out = await renderFigureRaster(figure, nodes, "pdf", dpi, "color", figureOpts);
      return {
        bytes: new Uint8Array(await out.blob.arrayBuffer()),
        widthPx: out.width,
        heightPx: out.height,
        capped: out.capped,
        reason: out.reason,
        missing: out.missing,
      };
    }
  }
  const out = await renderFigureRaster(figure, nodes, format, dpi, "color", figureOpts);
  return {
    bytes: new Uint8Array(await out.blob.arrayBuffer()),
    widthPx: out.width,
    heightPx: out.height,
    capped: out.capped,
    reason: out.reason,
    missing: out.missing,
  };
}

/** Run an export-all batch: plan the files, render and write each one
 *  into `folder`, and report per item. One bad render is recorded in
 *  `failed` and the batch goes on — the point of the batch is that the
 *  user gets the rest. Shared by the MCP tool and the File-menu dialog. */
export async function runExportAllBatch(
  state: ExportJobState,
  options: RunExportAllOptions,
  deps: Pick<ExportJobDeps, "io" | "render" | "run">,
): Promise<ExportAllBatchOutcome> {
  // An empty folder would land files in "/" after the trailing-slash
  // trim below — refuse it here, so no caller (MCP, GUI, future) can
  // write a batch to the filesystem root by mistake. The MCP path
  // rejects it earlier (`reqStr`); the GUI validates before calling.
  const folder = options.folder.trim().replace(/\/+$/, "");
  if (!folder) throw new Error("Export-all needs a folder to write into.");
  const plan = planExportAll(state, options);
  const render = deps.render ?? defaultExportAllRender;
  const io = deps.io ?? defaultExportIo;
  const outcome: ExportAllBatchOutcome = {
    folder,
    format: plan.format,
    dpi: plan.dpi,
    exported: [],
    skipped: plan.skipped,
    failed: [],
    exported_count: 0,
    skipped_count: plan.skipped.length,
    failed_count: 0,
  };
  for (const item of plan.items) {
    try {
      const out = await render(item, plan.format, plan.dpi, state.nodes, deps.run, state.rootOrder);
      const path = `${folder}/${item.fileName}`;
      await io.writeFile(path, out.bytes);
      const entry: ExportAllBatchOutcome["exported"][number] = {
        id: item.id,
        kind: item.kind,
        name: item.name,
        path,
        width_px: out.widthPx,
        height_px: out.heightPx,
      };
      if (out.capped) entry.capped = true;
      if (out.reason) entry.reason = out.reason;
      if (out.missing) entry.missing = out.missing;
      outcome.exported.push(entry);
    } catch (err) {
      outcome.failed.push({
        id: item.id,
        kind: item.kind,
        name: item.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  outcome.exported_count = outcome.exported.length;
  outcome.failed_count = outcome.failed.length;
  return outcome;
}

/** `export-all-graphs`: every graph and figure in the project, one file
 *  each, into `folder` (resolved by Rust when omitted). The plan throws
 *  when there is nothing to export; a render failure is reported per
 *  item in `failed`, never thrown, so the batch finishes. */
export async function executeExportAllGraphs(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const folder = reqStr(job, args, "folder");
  const { format, dpi } = exportFormatDpi(job, args);
  const state = deps.getState();
  const out = await runExportAllBatch(
    state,
    {
      folder,
      format,
      dpi,
      includeGraphs: optBool(job, args, "include_graphs"),
      includeFigures: optBool(job, args, "include_figures"),
      graphIds: optStrArray(job, args, "graph_ids"),
      figureIds: optStrArray(job, args, "figure_ids"),
    },
    deps,
  );
  return { result: { project_id: job.project_id, ...out } };
}

/** `export-office`: the GUI's one-click Send to Word / PowerPoint /
 *  Keynote (`sendGraphToOffice` / `sendFigureToOffice`), driven
 *  headlessly — the same PNG render at `dpi`, embedded at its physical
 *  size in a real .docx / .pptx by the pure `buildOfficeDocument`, or
 *  handed to Keynote on macOS for a real .key (seq 217: no file-side
 *  .key exists — Keynote itself makes the presentation, so the target
 *  refuses on any machine that cannot drive Keynote). Exactly one
 *  of `graph_id` / `figure_id`. */
export async function executeExportOffice(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const graphId = optStr(job, args, "graph_id");
  const figureId = optStr(job, args, "figure_id");
  if ((graphId === undefined) === (figureId === undefined)) {
    throw jobErr(job, "needs exactly one of graph_id and figure_id — one image per document, as the UI's one-click export.");
  }
  const targetRaw = reqStr(job, args, "target");
  if (targetRaw !== "word" && targetRaw !== "powerpoint" && targetRaw !== "keynote") {
    throw jobErr(job, `has no office target “${targetRaw}” — the targets are word, powerpoint and keynote.`);
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
  let overlays: GraphOverlayStatus[] = [];
  if (graphId !== undefined) {
    const graph = graphNode(job, state, graphId);
    const size96 = graphDrawSize(graph);
    const out = await renderGraphImage(graph, state.nodes, "png", dpi, size96, deps.run, undefined, state.rootOrder);
    png = out.bytes;
    title = graph.name;
    widthPx = out.widthPx;
    heightPx = out.heightPx;
    capped = out.capped;
    reason = out.reason;
    overlays = out.overlays;
  } else {
    const figure = figureNode(job, state, figureId!);
    if (!figure.panels?.length) {
      throw jobErr(job, `cannot export figure “${figure.name}” — add a panel first.`);
    }
    const out = await renderFigureRaster(figure, state.nodes, "png", dpi, "color", {
      run: deps.run,
      rootOrder: state.rootOrder,
    });
    png = new Uint8Array(await out.blob.arrayBuffer());
    title = figure.name;
    widthPx = out.width;
    heightPx = out.height;
    missing = out.missing;
    capped = out.capped;
    reason = out.reason;
    overlays = out.overlays;
  }
  const dims = pngSize(png);
  if (!dims) throw jobErr(job, "could not draw the image as a PNG image.");
  // Keynote is not a file build: the PNG is handed to Keynote, which
  // saves the .key itself (seq 217). The path reported is the .key
  // Keynote saved, not the raw request — the shell ensures the extension
  // before dispatching, so in practice they are the same.
  let savedPath = path;
  if (target === "keynote") {
    if (!isMacOs())
      throw jobErr(job, "needs macOS with Keynote installed — this machine cannot drive Keynote.");
    const outPath = ensureSaveExtension(path, "key");
    savedPath = await handoffPngToKeynote(png, title, outPath, dims.widthPx, dims.heightPx, Number(dpi));
  } else {
    const doc = await buildOfficeDocument(target, {
      png,
      title,
      widthPx: dims.widthPx,
      heightPx: dims.heightPx,
      dpi: Number(dpi),
    });
    const io = deps.io ?? defaultExportIo;
    await io.writeFile(ensureSaveExtension(path, officeExtension(target)), doc);
  }
  const ext = officeExtension(target);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    target,
    path: savedPath,
    extension: ext,
    width_px: widthPx,
    height_px: heightPx,
    capped,
    ...overlayReport(overlays),
  };
  if (graphId !== undefined) result.graph_id = graphId;
  else result.figure_id = figureId;
  if (missing) result.missing = missing;
  if (reason) result.reason = reason;
  return { result };
}

// ── Copy graph/figure image to clipboard (seq 296) ────────────────────
// The UI copy (`copyGraphImage` / `copyFigureImage`) has no MCP path: a
// headless/agent caller could not put a graph image on the system
// clipboard. This job is that path — the same offscreen PNG render at
// `dpi` (the export tools' renderers, same overlays, same grayscale
// walk), written to the clipboard natively (seq 296 fix: the webview's
// `navigator.clipboard.write` refuses without a user gesture, and the
// MCP path has none — so `defaultClipboardIo` goes through the
// `copy_png_to_clipboard` Tauri command: temp PNG + osascript PNGf).
// The render and the write are both injectable (see `ExportJobDeps`), so the node
// harness can drive the job without a webview.
//
// Ordering is the guarantee: every validation and the whole render run
// BEFORE the clipboard write, so an error (unknown id, nothing plotted,
// a bad dpi, a failed render) returns an MCP error and leaves the
// clipboard untouched. Vector-PDF clipboard is NOT here: Prism offers
// copy-as-vector, but OS clipboards vary — PNG is the guaranteed format
// for v1; PDF on the clipboard is best-effort on Mac only, documented
// in the tool description, not a gate item.

/** One graph/figure drawn as PNG bytes for the clipboard. */
export interface CopyRenderOut {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  capped: boolean;
  reason?: string;
  /** Panels that could not be drawn (figures only). */
  missing?: number;
  overlays: GraphOverlayStatus[];
}

/** Draw one copy target (a graph, or a whole figure) as PNG bytes. `run`
 *  is the analysis runner the overlays reuse; `rootOrder` is the project
 *  root order, for the info sheets the build resolves. */
export type CopyGraphImageRenderer = (
  target: { kind: "graph"; node: ProjectNode } | { kind: "figure"; node: ProjectNode },
  dpi: Resolution,
  colorMode: ColorMode,
  nodes: Record<string, ProjectNode>,
  run?: AnalysisRunner,
  rootOrder?: string[],
) => Promise<CopyRenderOut>;

/** The real copy renderer: a graph through the headless graph render, a
 *  figure through its own raster render — the same paths the single-item
 *  export tools use, so a pasted image matches its exported file. */
async function defaultCopyRender(
  target: { kind: "graph"; node: ProjectNode } | { kind: "figure"; node: ProjectNode },
  dpi: Resolution,
  colorMode: ColorMode,
  nodes: Record<string, ProjectNode>,
  run?: AnalysisRunner,
  rootOrder?: string[],
): Promise<CopyRenderOut> {
  if (target.kind === "graph") {
    const size96 = graphDrawSize(target.node);
    const out = await renderGraphImage(target.node, nodes, "png", dpi, size96, run, colorMode, rootOrder);
    return {
      bytes: out.bytes,
      widthPx: out.widthPx,
      heightPx: out.heightPx,
      capped: out.capped,
      reason: out.reason,
      overlays: out.overlays,
    };
  }
  const out = await renderFigureRaster(target.node, nodes, "png", dpi, colorMode, { run, rootOrder });
  return {
    bytes: new Uint8Array(await out.blob.arrayBuffer()),
    widthPx: out.width,
    heightPx: out.height,
    capped: out.capped,
    reason: out.reason,
    missing: out.missing,
    overlays: out.overlays,
  };
}

/** `copy-graph-image`: render one graph (or a whole figure) offscreen as
 *  PNG at `dpi` and write it to the system clipboard. Exactly one of
 *  `graph_id` / `figure_id`; with neither, the active graph/figure is
 *  copied. `dpi` 100/150/300/600/900/1200 (default 300);
 *  `color_mode` color/grayscale (default color; cmyk falls back to
 *  colour, as the UI copy does — the clipboard has no CMYK). */
export async function executeCopyGraphImage(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const graphId = optStr(job, args, "graph_id");
  const figureId = optStr(job, args, "figure_id");
  if (graphId !== undefined && figureId !== undefined) {
    throw jobErr(job, "needs exactly one of graph_id and figure_id — one image per clipboard write, as the UI's one-click copy.");
  }
  const dpiRaw = optStr(job, args, "dpi") ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpiRaw)) {
    throw jobErr(job, `has no resolution “${dpiRaw}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const dpi = dpiRaw as Resolution;
  const colorModeRaw = optStr(job, args, "color_mode") ?? "color";
  if (colorModeRaw !== "color" && colorModeRaw !== "grayscale" && colorModeRaw !== "cmyk") {
    throw jobErr(job, `has no colour mode “${colorModeRaw}” — the colour modes are color, grayscale, cmyk.`);
  }
  // CMYK falls back to colour, as the UI copy does (the clipboard has no CMYK).
  const colorMode = (colorModeRaw === "cmyk" ? "color" : colorModeRaw) as ColorMode;
  const state = deps.getState();
  let target: { kind: "graph"; node: ProjectNode } | { kind: "figure"; node: ProjectNode };
  if (figureId !== undefined) {
    const figure = figureNode(job, state, figureId);
    if (!figure.panels?.length) {
      throw jobErr(job, `cannot copy figure “${figure.name}” — add a panel first.`);
    }
    target = { kind: "figure", node: figure };
  } else if (graphId !== undefined) {
    target = { kind: "graph", node: graphNode(job, state, graphId) };
  } else {
    const active = state.activeNodeId ? state.nodes[state.activeNodeId] : undefined;
    if (!active) {
      throw jobErr(job, "needs graph_id or figure_id — no graph or figure is active in this project.");
    }
    if (active.type === "graph") {
      target = { kind: "graph", node: active };
    } else if (active.type === "figure") {
      if (!active.panels?.length) {
        throw jobErr(job, `cannot copy figure “${active.name}” — add a panel first.`);
      }
      target = { kind: "figure", node: active };
    } else {
      throw jobErr(job, `needs graph_id or figure_id — the active node “${active.name}” is a ${active.type}, not a graph or figure.`);
    }
  }
  // The render runs first and throws before any clipboard write, so a
  // graph with nothing plotted (or a figure that cannot draw) leaves the
  // clipboard exactly as it was.
  const render = deps.copyRender ?? defaultCopyRender;
  const out = await render(target, dpi, colorMode, state.nodes, deps.run, state.rootOrder);
  const clipboard = deps.clipboard ?? defaultClipboardIo;
  await clipboard.writePng(out.bytes);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    format: "png",
    dpi,
    color_mode: colorMode,
    width_px: out.widthPx,
    height_px: out.heightPx,
    capped: out.capped,
    ...overlayReport(out.overlays),
  };
  if (target.kind === "graph") result.graph_id = target.node.id;
  else {
    result.figure_id = target.node.id;
    if (out.missing) result.missing = out.missing;
  }
  if (out.reason) result.reason = out.reason;
  return { result };
}

// ── Table data (CSV / XLSX / TXT / Prism XML) ─────────────────────────
// No UI CSV writer exists to reuse: the serializers below are new, but
// they follow the snapshot's rule — excluded cells are written empty,
// matching what analyses see. Cell values are the grid's stored
// strings; nothing is coerced to a number (an XLSX cell stays text, so
// an ID like "0123" never becomes 123).

/** The table's grid as text rows: every column (column 0 is the row
 *  titles), every stored row (short rows padded), excluded cells empty.
 *  Values keep full precision — a decimal-places setting never rounds
 *  them — and numeric cells take the decimal separator. */
export function tableTextRows(data: TableData, separator: DecimalSeparator = "."): string[][] {
  const columns = data.columns.length ? data.columns : ["Title"];
  const excluded = new Set(data.excluded ?? []);
  return data.rows.map((row, r) =>
    columns.map((_, c) => {
      if (c >= 1 && excluded.has(`${r},${c}`)) return "";
      const cell = row[c];
      if (cell === null || cell === undefined) return "";
      return separator === "," && parseCell(cell) !== null ? cell.replace(".", ",") : cell;
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

/** The table as CSV text (one row per line, CRLF-free). Numeric cells take
 *  the decimal separator; values keep full precision. */
export function tableToCsv(data: TableData, separator: DecimalSeparator = "."): string {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data, separator)];
  return rows.map((row) => row.map(csvField).join(",")).join("\n");
}

/** The table as TXT text (tab-separated, same grid as CSV). */
export function tableToTxt(data: TableData, separator: DecimalSeparator = "."): string {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data, separator)];
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
export async function tableToXlsx(data: TableData, name: string, separator: DecimalSeparator = "."): Promise<Uint8Array> {
  const rows = [data.columns.length ? data.columns : ["Title"], ...tableTextRows(data, separator)];
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

/** The table as a Prism XML document (.xml) — the same Prism-XML dialect
 *  the `.pzfx` writer writes (`GraphPadPrismFile`, Prism's ExportTable XML
 *  format: it keeps subcolumns, excluded values and row titles, which the
 *  plain-text formats drop or flatten). One table only, so the document
 *  holds that table and an empty `<Template>` (the `.pzfx` writer's BUG-21
 *  rule: Prism shows its XML-compliance dialog for a file not created by
 *  GraphPad Prism unless a `<Template>` element is present). Verified by
 *  round-trip: the repo's own `parsePzfx` reads it back as the same table.
 *
 *  What it cannot express it refuses, plainly, instead of silently
 *  rewriting: a Nested or Multiple-variables table (Prism has no matching
 *  type) and a grouped table mixing Y formats. The type refusal is made
 *  here, not in `writePzfx`: the whole-project writer deliberately
 *  rewrites a nested/MV table as OneWay with a warning, so one such table
 *  cannot sink a whole project save — but a single-table Prism XML export
 *  must not silently change the table's kind. An empty table is refused
 *  here: the writer skips rowless tables (a re-import would drop them), so
 *  there would be nothing to write. */
export function tableToXml(data: TableData, name: string, tableType: ProjectNode["tableType"] = "column"): Uint8Array {
  if (tableType === "nested" || tableType === "multiple") {
    throw new Error(
      `“${name}” is a ${tableType === "nested" ? "Nested" : "Multiple variables"} table — Prism XML has no matching table type for it, so it can't be written as Prism XML.`,
    );
  }
  if (!data || data.columns.length < 2) {
    throw new Error(`“${name}” holds no data columns to write as Prism XML — add a data column first.`);
  }
  if (data.rows.length === 0) {
    throw new Error(`“${name}” holds no rows to write as Prism XML — add a row first.`);
  }
  if ((tableType === "xy" || tableType === "survival") && data.columns.length < 3) {
    throw new Error(`“${name}” holds an X column but no Y values to write as Prism XML — add a Y column first.`);
  }
  const table: ProjectNode = { id: "table", type: "table", name, parentId: null, tableType, data };
  const payload = {
    nodes: { table },
    rootOrder: ["table"],
    childOrder: { table: [] as string[] },
    activeNodeId: "table",
  };
  return writePzfx(payload, appVersion).bytes;
}

/** The table-data export formats. */
export const TABLE_DATA_FORMATS = ["csv", "xlsx", "txt", "xml"] as const;
export type TableDataFormat = (typeof TABLE_DATA_FORMATS)[number];

/** `export-table-data`: serialize one table (CSV / XLSX / TXT / Prism XML) and
 *  write the file. No render is involved, so this runs in node too
 *  (the verify script drives it via `executeJob` with stub IO). */
export async function executeExportTableData(job: McpJob, deps: ExportJobDeps): Promise<ExportJobOutcome> {
  const args = argsOf(job);
  const tableId = reqStr(job, args, "table_id");
  const formatRaw = optStr(job, args, "format") ?? "csv";
  if (!(TABLE_DATA_FORMATS as readonly string[]).includes(formatRaw)) {
    throw jobErr(job, `has no table format “${formatRaw}” — the formats are csv, xlsx, txt, xml.`);
  }
  const format = formatRaw as TableDataFormat;
  const path = reqStr(job, args, "path");
  const state = deps.getState();
  const table = tableNode(job, state, tableId);
  const data = table.data ?? { columns: ["Title"], rows: [] };
  // Text exports render the decimal separator; Prism XML keeps the period
  // (a machine format for Prism — see tableToXml).
  const separator = loadDecimalSeparator();
  let bytes: string | Uint8Array;
  if (format === "csv") bytes = tableToCsv(data, separator);
  else if (format === "txt") bytes = tableToTxt(data, separator);
  else if (format === "xlsx") bytes = await tableToXlsx(data, table.name, separator);
  else bytes = tableToXml(data, table.name, table.tableType ?? "column");
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
