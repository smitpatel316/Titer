// Rendering a graph or figure for a Prism script's export commands — the
// same offscreen Plotly render the figure exporter uses (`buildPanelFigure`
// + `Plotly.react` + `toImage`), then the file's bytes: PNG/JPEG/SVG
// directly, TIF/BMP encoded from the RGBA pixels a canvas reads back
// (see lib/tiff.ts). The engine already checked the resolution and the
// export cap, so a too-large image is a script error there, never a silent
// shrink here — the cap is re-checked anyway, as a safety net.
import { DEFAULT_GRAPH_OPTIONS, type ProjectNode, type Resolution } from "../../store/types";
import { largestAt, PX_PER_INCH, withDpi } from "../../lib/image-dpi";
import { encodeBmp, encodeTiff } from "../../lib/tiff";
import { buildPanelFigure } from "../figures/panel-figure";
import { renderFigureRaster, renderFigureSvg } from "../figures/figure-export";
import { loadPlotly } from "./plotly";
import { withoutSelection } from "./selection";
import { vectorTraces } from "./plot-helpers";
import type { ExportFormat } from "../../lib/prism-script";

const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };
const CLEAR_BG = { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)" };

/** The largest a raster image of `size` at `dpi` may be, or why it isn't made. */
function tooLarge(size: { width: number; height: number }, dpi: number): string | null {
  const most = largestAt(size, dpi);
  if (most.width < size.width)
    return `At ${dpi} DPI, the largest graph Titer exports is ${most.width} × ${most.height} px. Choose a lower resolution, or make the graph smaller.`;
  return null;
}

/** PNG bytes as RGBA pixels (for the TIFF/BMP encoders). The bitmap's size
 *  is read BEFORE close(): a closed ImageBitmap reports 0×0, so reading it
 *  after close() silently encoded an empty image (Mac proof #2: a valid
 *  0×0 TIFF / header-only BMP, run log reporting success). An empty decode
 *  throws instead of writing a silent 0×0 file. */
async function pngToRgba(bytes: Uint8Array): Promise<{ rgba: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
  const width = bitmap.width;
  const height = bitmap.height;
  if (width <= 0 || height <= 0)
    throw new Error("The graph image decoded to an empty picture — nothing was exported.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, width, height).data;
  bitmap.close();
  const rgba = new Uint8Array(data);
  if (rgba.length !== width * height * 4)
    throw new Error("The graph image read back the wrong number of pixels — nothing was exported.");
  return { rgba, width, height };
}

/** One graph, drawn offscreen, as an image of `format` at `dpi`. */
async function renderGraph(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: number,
  clear: boolean,
  mode: "rgbhi" | "gray" | "mono" | undefined,
): Promise<Uint8Array> {
  const size = {
    width: graph.graphOptions?.width ?? DEFAULT_GRAPH_OPTIONS.width,
    height: graph.graphOptions?.height ?? DEFAULT_GRAPH_OPTIONS.height,
  };
  const why = format !== "svg" ? tooLarge(size, dpi) : null;
  if (why) throw new Error(why);
  const fig = buildPanelFigure(graph, nodes);
  if (!fig) throw new Error(`Graph “${graph.name}” has nothing to draw.`);
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;";
  document.body.appendChild(el);
  try {
    const Plotly = await loadPlotly();
    await Plotly.react(
      el,
      fig.data,
      { ...fig.layout, ...size },
      { displayModeBar: false, scrollZoom: false, doubleClick: false },
    );
    const drawn = el as unknown as { data: unknown[]; layout: object };
    const layout =
      format === "jpeg" ? { ...drawn.layout, ...WHITE } : clear ? { ...drawn.layout, ...CLEAR_BG } : drawn.layout;
    const figure = { data: vectorTraces(withoutSelection(drawn.data)), layout };
    const scale = format === "svg" ? 1 : dpi / PX_PER_INCH;
    if (format === "svg") {
      const url = await Plotly.toImage(figure, { format, ...size, scale });
      return new Uint8Array(await (await fetch(url)).arrayBuffer());
    }
    const url = await Plotly.toImage(figure, {
      format: format === "tif" || format === "bmp" ? "png" : format,
      ...size,
      scale,
    });
    const png = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (format === "png" || format === "jpeg") return new Uint8Array(await withDpi(png, format, dpi).arrayBuffer());
    const { rgba, width, height } = await pngToRgba(png);
    return format === "tif"
      ? encodeTiff(rgba, width, height, { mode: mode ?? "rgbhi", dpi, clear })
      : encodeBmp(rgba, width, height, { dpi, clear });
  } finally {
    void loadPlotly().then((Plotly) => Plotly.purge(el));
    el.remove();
  }
}

/** One figure, as an image of `format` at `dpi`. A figure's own export
 *  resolutions are 150/300/600; a script may also ask for 100 or 1200 —
 *  the raster math takes any DPI, so the cast is safe. */
async function renderFigure(
  figure: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: number,
  clear: boolean,
  mode: "rgbhi" | "gray" | "mono" | undefined,
): Promise<Uint8Array> {
  const resolution = String(dpi) as Resolution;
  if (format === "svg") {
    const out = await renderFigureSvg(figure, nodes, resolution);
    return new TextEncoder().encode(out.svg);
  }
  const out = await renderFigureRaster(
    figure,
    nodes,
    format === "tif" || format === "bmp" ? "png" : format,
    resolution,
  );
  if (out.capped) throw new Error(out.reason ?? "This figure is too large to export at this resolution.");
  const png = new Uint8Array(await out.blob.arrayBuffer());
  if (format === "png" || format === "jpeg") return png;
  const { rgba, width, height } = await pngToRgba(png);
  return format === "tif"
    ? encodeTiff(rgba, width, height, { mode: mode ?? "rgbhi", dpi, clear })
    : encodeBmp(rgba, width, height, { dpi, clear });
}

/** A graph or figure node as the file bytes of `format` at `dpi`. */
export async function renderScriptGraph(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: number,
  clear: boolean,
  mode: "rgbhi" | "gray" | "mono" | undefined,
): Promise<Uint8Array> {
  if (node.type === "figure") return renderFigure(node, nodes, format, dpi, clear, mode);
  return renderGraph(node, nodes, format, dpi, clear, mode);
}
