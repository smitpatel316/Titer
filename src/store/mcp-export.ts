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
import { loadPlotly } from "../views/graphs/plotly";
import { withoutSelection } from "../views/graphs/selection";
import { vectorTraces } from "../views/graphs/plot-helpers";
import {
  EXPORT_FORMATS,
  RESOLUTIONS,
  type ExportFormat,
} from "../views/graphs/graph-export";
import { largestAt, PX_PER_INCH, withDpi } from "../lib/image-dpi";
import { decodePng, pdfEncode, tiffEncode } from "../lib/raster-export";
import {
  DEFAULT_GRAPH_OPTIONS,
  GRAPH_LIMITS,
  type ProjectNode,
  type Resolution,
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
  if (format === "svg") return { widthPx: size96.width, heightPx: size96.height, capped: false, draw96: size96 };
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
 *  div, exactly as the figure export's `panelImage` does. PDF/TIFF are
 *  built from the PNG Plotly draws (it has no PDF/TIFF output). */
export async function renderGraphImage(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: Resolution,
  size96: { width: number; height: number },
): Promise<{ bytes: Uint8Array; widthPx: number; heightPx: number; capped: boolean; reason?: string }> {
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
    // PDF/TIFF panels are drawn as PNG (Plotly has no PDF/TIFF output).
    const drawnFormat = format === "pdf" || format === "tiff" ? "png" : format;
    const layout =
      drawnFormat === "jpeg" || format === "pdf" || format === "tiff" ? { ...drawn.layout, ...WHITE } : drawn.layout;
    const figure = { data: vectorTraces(withoutSelection(drawn.data)), layout };
    const scale = format === "svg" ? 1 : Number(dpi) / PX_PER_INCH;
    const url = await Plotly.toImage(figure, { format: drawnFormat, ...draw96, scale });
    const image = await (await fetch(url)).blob();
    if (format === "svg") {
      return { bytes: new TextEncoder().encode(await image.text()), ...dims };
    }
    const png = new Uint8Array(await image.arrayBuffer());
    if (format === "pdf") return { bytes: pdfEncode(decodePng(png), Number(dpi)), ...dims };
    if (format === "tiff") return { bytes: tiffEncode(decodePng(png), Number(dpi)), ...dims };
    const stamped = await withDpi(png, format as "png" | "jpeg", Number(dpi)).arrayBuffer();
    return { bytes: new Uint8Array(stamped), ...dims };
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
  const formatRaw = reqStr(job, args, "format");
  if (!EXPORT_FORMATS.some((f) => f.value === formatRaw)) {
    throw jobErr(job, `has no export format “${formatRaw}” — the formats are ${EXPORT_FORMATS.map((f) => f.value).join(", ")}.`);
  }
  const format = formatRaw as ExportFormat;
  const dpiRaw = optStr(job, args, "dpi") ?? "300";
  if (!(RESOLUTIONS as readonly string[]).includes(dpiRaw)) {
    throw jobErr(job, `has no resolution “${dpiRaw}” — the resolutions are ${RESOLUTIONS.join(", ")} DPI.`);
  }
  const dpi = dpiRaw as Resolution;
  const path = reqStr(job, args, "path");
  const widthIn = optNum(job, args, "width_in");
  const heightIn = optNum(job, args, "height_in");
  const state = deps.getState();
  const graph = graphNode(job, state, graphId);
  const size96 = graphDrawSize(graph, widthIn, heightIn);
  const out = await renderGraphImage(graph, state.nodes, format, dpi, size96);
  const ext = EXPORT_EXTENSION[format];
  const io = deps.io ?? defaultExportIo;
  await io.writeFile(ensureSaveExtension(path, ext), out.bytes);
  const result: Record<string, unknown> = {
    project_id: job.project_id,
    graph_id: graphId,
    format,
    dpi,
    path,
    width_px: out.widthPx,
    height_px: out.heightPx,
    capped: out.capped,
  };
  if (out.reason) result.reason = out.reason;
  return { result };
}
