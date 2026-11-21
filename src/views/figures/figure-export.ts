// Exporting a figure as one image: each panel is rendered through the
// existing graph machinery (`loadPlotly`, `toImage` via Plotly, `withDpi`),
// then composited onto one canvas (PNG/JPEG) or embedded in one parent SVG
// (SVG, staying vector). The figure is never rebuilt as a single Plotly
// subplot figure — the per-graph renderers are not subplot-compatible.
import { alert, handoffPngToKeynote, pickSavePath, writeFile } from "../../native";
import { loadPlotly } from "../graphs/plotly";
import { withoutSelection } from "../graphs/selection";
import { vectorTraces } from "../graphs/plot-helpers";
import { PX_PER_INCH, withDpi } from "../../lib/image-dpi";
import { decodePng, pdfEncode, tiffEncode } from "../../lib/raster-export";
import {
  composeFigureSvg,
  figureExportSize,
  hasEmptyCell,
  missingPanels,
  panelPlotSize,
  panelRects,
  PT_PER_INCH,
  sharedLegendCheck,
} from "../../lib/figure";
import { buildGraphFigure, type GraphOverlayStatus } from "../graphs/graph-figure";
import type { ExportFormat, Resolution } from "../graphs/graph-export";
import { buildOfficeDocument, officeDialogTitle, officeExtension, type OfficeTarget } from "../../lib/office-export";
import type { FigurePanel, ProjectNode } from "../../store/types";

const EXTENSION: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", svg: "svg", pdf: "pdf", tiff: "tiff" };
let lastFolder: string | null = null;
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Size = { width: number; height: number };

/** One overlay list per panel, merged: an overlay counts as applied when
 *  any panel applied it, else the first panel's report for it stands. */
export function mergePanelOverlays(panels: GraphOverlayStatus[][]): GraphOverlayStatus[] {
  const byName = new Map<string, GraphOverlayStatus>();
  for (const list of panels) {
    for (const status of list) {
      const seen = byName.get(status.overlay);
      if (!seen) byName.set(status.overlay, status);
      else if (seen.status !== "applied" && status.status === "applied") byName.set(status.overlay, status);
    }
  }
  return [...byName.values()];
}

/** A panel drawn at `size`, as an image blob (raster at `dpi`, or SVG),
 *  with the overlay report for its graph. With `hideLegend`, the panel
 *  draws no legend of its own — the figure's one shared legend (drawn
 *  below the grid by the caller) replaces it. The figure is the shared
 *  `buildGraphFigure`, so the panel draws the graph's overlays too. */
async function panelImage(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  size: Size,
  format: ExportFormat,
  dpi: Resolution,
  hideLegend: boolean,
): Promise<{ image: Blob | null; overlays: GraphOverlayStatus[] }> {
  const { figure: fig, overlays } = await buildGraphFigure(graph, nodes, { hideLegend });
  if (!fig) return { image: null, overlays };
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-10000px;top:0;visibility:hidden;";
  document.body.appendChild(el);
  try {
    const Plotly = await loadPlotly();
    // `size` is the panel's rectangle in DPI pixels; Plotly lays out in its
    // own 96-DPI units and `toImage` scales by dpi/96 on top, so the panel
    // is drawn at the 96-DPI size and the image lands exactly on the
    // rectangle (F-#7: handing Plotly the rectangle scaled twice, and at
    // 600 DPI the 18750×28125 canvas is past what WebKit draws).
    const plotSize = panelPlotSize(size, Number(dpi));
    await Plotly.react(
      el,
      fig.data,
      { ...fig.layout, ...plotSize },
      { displayModeBar: false, scrollZoom: false, doubleClick: false },
    );
    const drawn = el as unknown as { data: unknown[]; layout: object };
    // PDF/TIFF panels are drawn as PNG (Plotly has no PDF/TIFF output); the
    // figure's raster path encodes the composited canvas, not the panel.
    const drawnFormat = format === "pdf" || format === "tiff" ? "png" : format;
    const layout =
      drawnFormat === "jpeg" || format === "pdf" || format === "tiff"
        ? { ...drawn.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" }
        : drawn.layout;
    const figure = { data: vectorTraces(withoutSelection(drawn.data)), layout };
    const scale = format === "svg" ? 1 : Number(dpi) / PX_PER_INCH;
    const url = await Plotly.toImage(figure, { format: drawnFormat, ...plotSize, scale });
    const image = await (await fetch(url)).blob();
    // In the non-SVG branch `drawnFormat` is png|jpeg (pdf/tiff panels were
    // drawn as PNG); name that so `withDpi`'s "png"|"jpeg" parameter accepts it.
    const rasterFormat: "png" | "jpeg" = drawnFormat === "jpeg" ? "jpeg" : "png";
    return {
      image: format === "svg" ? image : withDpi(new Uint8Array(await image.arrayBuffer()), rasterFormat, Number(dpi)),
      overlays,
    };
  } finally {
    void loadPlotly().then((Plotly) => Plotly.purge(el));
    el.remove();
  }
}

/** The figure's export geometry at `dpi`: its pixel size (capped like a
 *  single graph, never silently), each panel's rectangle, and the strips a
 *  figure title / shared legend take above / below the grid. */
function geometry(figure: ProjectNode, dpi: Resolution) {
  const size = figure.figureSize ?? { widthIn: 10, heightIn: 7.5 };
  const grid = figure.grid ?? { rows: 1, cols: 1 };
  const panels = figure.panels ?? [];
  const exported = figureExportSize(size, Number(dpi));
  // Rects are computed from the size that actually exports (the capped one).
  const rects = panelRects(panels, grid, { widthIn: exported.width / Number(dpi), heightIn: exported.height / Number(dpi) }, Number(dpi));
  const style = figure.labelStyle ?? { position: "top-left" as const, fontSizePt: 12, bold: true };
  const titleStrip = figure.figureTitle ? Math.round(((style.fontSizePt + 16) * Number(dpi)) / PT_PER_INCH) : 0;
  return { size, grid, panels, exported, rects, style, titleStrip };
}

function figureOf(figure: ProjectNode) {
  return {
    panels: figure.panels ?? [],
    grid: figure.grid ?? { rows: 1, cols: 1 },
    figureSize: figure.figureSize ?? { widthIn: 10, heightIn: 7.5 },
    labelStyle: figure.labelStyle ?? { position: "top-left" as const, fontSizePt: 12, bold: true },
    figureTitle: figure.figureTitle ?? "",
    sharedLegend: figure.sharedLegend ?? ("none" as const),
  };
}

/** The whole figure as a PNG/JPEG blob, composited on canvas: panel images
 *  in grid order, labels and titles as text, the figure title above the grid,
 *  and the shared legend (when valid) centred below it. */
export async function renderFigureRaster(
  figure: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: "png" | "jpeg" | "pdf" | "tiff",
  dpi: Resolution,
): Promise<{
  blob: Blob;
  missing: number;
  capped: boolean;
  reason?: string;
  width: number;
  height: number;
  overlays: GraphOverlayStatus[];
}> {
  const g = geometry(figure, dpi);
  const legend =
    figure.sharedLegend === "shared" ? sharedLegendCheck(g.panels, nodes) : { ok: false as const };
  const legendEntries = legend.ok ? legend.entries! : undefined;
  const legendStripPx = legendEntries ? Math.round((28 * Number(dpi)) / PT_PER_INCH) : 0;
  const width = g.exported.width;
  const height = g.exported.height + g.titleStrip + legendStripPx;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  const missing = missingPanels(g.panels, nodes);
  const panelOverlays: GraphOverlayStatus[][] = [];
  const scale = Number(dpi) / PT_PER_INCH; // points → pixels at this DPI
  const fontPx = (pt: number) => pt * scale;
  // The figure title, centred in its strip above the grid.
  if (figure.figureTitle) {
    ctx.fillStyle = "#111827";
    ctx.font = `bold ${fontPx(g.style.fontSizePt + 4)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(figure.figureTitle, width / 2, fontPx(g.style.fontSizePt + 6));
  }
  for (const rect of g.rects) {
    const graph = nodes[rect.panel.graphId];
    const y = rect.y + g.titleStrip;
    if (graph) {
      const { image, overlays } = await panelImage(graph, nodes, { width: rect.width, height: rect.height }, format, dpi, legend.ok);
      panelOverlays.push(overlays);
      if (image) {
        const bitmap = await createImageBitmap(image);
        ctx.drawImage(bitmap, rect.x, y, rect.width, rect.height);
        bitmap.close();
      }
    }
    // The label, in the cell's margin (top-left by default), over the panel.
    ctx.fillStyle = "#111827";
    ctx.font = `${g.style.bold ? "bold " : ""}${fontPx(g.style.fontSizePt)}px Arial, Helvetica, sans-serif`;
    ctx.textBaseline = "alphabetic";
    const labelY = y + fontPx(g.style.fontSizePt + 2);
    if (g.style.position === "top-right") {
      ctx.textAlign = "right";
      ctx.fillText(rect.panel.label, rect.x + rect.width - fontPx(6), labelY);
    } else if (g.style.position === "above-panel") {
      ctx.textAlign = "center";
      ctx.fillText(rect.panel.label, rect.x + rect.width / 2, labelY);
    } else {
      ctx.textAlign = "left";
      ctx.fillText(rect.panel.label, rect.x + fontPx(6), labelY);
    }
    if (rect.panel.title) {
      ctx.textAlign = "center";
      ctx.fillText(rect.panel.title, rect.x + rect.width / 2, y + fontPx(g.style.fontSizePt * 2 + 8));
    }
  }
  // One shared legend, centred below the grid.
  if (legendEntries) {
    const swatch = Math.round(10 * scale);
    const gap = Math.round(6 * scale);
    ctx.font = `${fontPx(g.style.fontSizePt)}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = "left";
    const widths = legendEntries.map((e) => swatch + gap + ctx.measureText(e.name).width);
    const total = widths.reduce((a, b) => a + b, 0) + gap * (legendEntries.length - 1);
    let x = (width - total) / 2;
    const y = g.titleStrip + g.exported.height + Math.round(18 * scale);
    legendEntries.forEach((e, i) => {
      ctx.fillStyle = e.color;
      ctx.fillRect(x, y - fontPx(g.style.fontSizePt) + 2, swatch, swatch);
      ctx.fillStyle = "#111827";
      ctx.fillText(e.name, x + swatch + gap, y);
      x += widths[i] + gap;
    });
  }
  // PDF/TIFF are encoded from the composited canvas PNG (canvas has no
  // PDF/TIFF output); PNG/JPEG keep their existing paths unchanged.
  const rasterFormat = format === "pdf" || format === "tiff" ? "png" : format;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't draw the figure."))), `image/${rasterFormat}`),
  );
  const png = new Uint8Array(await blob.arrayBuffer());
  const stamped =
    format === "pdf"
      ? new Blob([pdfEncode(decodePng(png), Number(dpi)) as BlobPart], { type: "application/pdf" })
      : format === "tiff"
        ? new Blob([tiffEncode(decodePng(png), Number(dpi)) as BlobPart], { type: "image/tiff" })
        : withDpi(png, rasterFormat, Number(dpi));
  return {
    blob: stamped,
    missing: missing.length,
    capped: g.exported.capped,
    reason: g.exported.reason,
    width,
    height,
    overlays: mergePanelOverlays(panelOverlays),
  };
}

/** The whole figure as one SVG (vector, editable): each panel's SVG embedded
 *  at its grid offset, labels/titles/legend as SVG text. `width`/`height`
 *  are the composed SVG's size in 96-DPI px (its points × 96/72) — the
 *  size an app places it at. */
export async function renderFigureSvg(
  figure: ProjectNode,
  nodes: Record<string, ProjectNode>,
  dpi: Resolution,
): Promise<{ svg: string; missing: number; width: number; height: number; overlays: GraphOverlayStatus[] }> {
  const g = geometry(figure, dpi);
  const legend =
    figure.sharedLegend === "shared" ? sharedLegendCheck(g.panels, nodes) : { ok: false as const };
  const composed: { panel: FigurePanel; svg: string }[] = [];
  const panelOverlays: GraphOverlayStatus[][] = [];
  for (const rect of g.rects) {
    const graph = nodes[rect.panel.graphId];
    if (!graph) continue;
    const { image, overlays } = await panelImage(graph, nodes, { width: rect.width, height: rect.height }, "svg", dpi, legend.ok);
    panelOverlays.push(overlays);
    if (image) composed.push({ panel: rect.panel, svg: await image.text() });
  }
  const { svg, missing } = composeFigureSvg(composed, figureOf(figure), legend.ok ? legend.entries : undefined);
  // The composed SVG's own size, in points (see composeFigureSvg): the
  // figure size, plus the title strip above and the shared-legend strip
  // below when they are drawn.
  const titleStripPt = figure.figureTitle ? g.style.fontSizePt + 16 : 0;
  const legendStripPt = legend.ok ? 28 : 0;
  const width = Math.round(g.size.widthIn * PX_PER_INCH);
  const height = Math.round(((g.size.heightIn * PT_PER_INCH + titleStripPt + legendStripPt) * PX_PER_INCH) / PT_PER_INCH);
  return { svg, missing, width, height, overlays: mergePanelOverlays(panelOverlays) };
}

export async function saveFigureImage(
  figure: ProjectNode,
  nodes: Record<string, ProjectNode>,
  format: ExportFormat,
  dpi: Resolution,
  name: string,
) {
  if (!figure.panels?.length) return alert("Couldn't Export the Figure", "Add a panel first.", "error");
  const g = geometry(figure, dpi);
  if (hasEmptyCell(g.panels, g.grid))
    await alert("Empty Cell", "The figure has an empty cell — it exports blank.", "warning");
  try {
    let bytes: Uint8Array;
    let missing = 0;
    let capped = false;
    let capReason: string | undefined;
    if (format === "svg") {
      const out = await renderFigureSvg(figure, nodes, dpi);
      bytes = new TextEncoder().encode(out.svg);
      missing = out.missing;
    } else {
      const out = await renderFigureRaster(figure, nodes, format, dpi);
      bytes = new Uint8Array(await out.blob.arrayBuffer());
      missing = out.missing;
      capped = out.capped;
      capReason = out.reason;
    }
    if (capped && capReason) await alert("Figure Too Large", `${capReason} Exporting at the largest fitting size.`, "warning");
    const ext = EXTENSION[format];
    const fileName = `${name}.${ext}`;
    const path = await pickSavePath(
      "Export Figure",
      lastFolder ? `${lastFolder}/${fileName}` : fileName,
      ext.toUpperCase(),
      ext,
    );
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await writeFile(path, bytes);
    if (missing)
      await alert(
        "Figure Exported",
        `${missing} panel${missing === 1 ? "" : "s"} couldn't be drawn — ${missing === 1 ? "its" : "their"} graph is missing. The ${missing === 1 ? "cell was left" : "cells were left"} blank.`,
        "warning",
      );
  } catch (err) {
    alert("Couldn't Export the Figure", reason(err), "error");
  }
}

/** Starts the clipboard write inside the click, with a promised image, as
 *  WebKit requires. Clipboard images must be raster: always PNG. */
export function copyFigureImage(figure: ProjectNode, nodes: Record<string, ProjectNode>, dpi: Resolution) {
  if (!figure.panels?.length) return void alert("Couldn't Copy the Figure", "Add a panel first.", "error");
  navigator.clipboard
    .write([
      new ClipboardItem({
        "image/png": renderFigureRaster(figure, nodes, "png", dpi).then((out) => out.blob),
      }),
    ])
    .catch((err) => alert("Couldn't Copy the Figure", reason(err), "error"));
}

/** One-click Send to Word / PowerPoint / Keynote for a whole layout
 *  (v2 item 19, seq 217): the figure's composited PNG at `dpi`, embedded
 *  at its physical size in a real .docx / .pptx file — the cross-platform
 *  form of Prism's one-click export (no COM automation on Mac/Linux; the
 *  user opens the file in Word/PowerPoint). Keynote takes Prism's own
 *  route instead: the PNG is handed to Keynote on macOS, which makes the
 *  presentation and saves the real .key (see office-export.ts — no
 *  file-side .key exists). */
export async function sendFigureToOffice(
  figure: ProjectNode,
  nodes: Record<string, ProjectNode>,
  target: OfficeTarget,
  dpi: Resolution,
  name: string,
) {
  const title = officeDialogTitle(target);
  if (!figure.panels?.length) return alert(title, "Add a panel first.", "error");
  const g = geometry(figure, dpi);
  if (hasEmptyCell(g.panels, g.grid))
    await alert("Empty Cell", "The figure has an empty cell — it exports blank.", "warning");
  try {
    const out = await renderFigureRaster(figure, nodes, "png", dpi);
    if (out.capped && out.reason) await alert("Figure Too Large", `${out.reason} Exporting at the largest fitting size.`, "warning");
    const png = new Uint8Array(await out.blob.arrayBuffer());
    if (target === "keynote") {
      const path = await pickSavePath(
        title,
        lastFolder ? `${lastFolder}/${name}.key` : `${name}.key`,
        "Keynote Presentation",
        "key",
      );
      if (!path) return;
      lastFolder = path.slice(0, path.lastIndexOf("/"));
      await handoffPngToKeynote(png, name, path, out.width, out.height, Number(dpi));
    } else {
      const doc = await buildOfficeDocument(target, {
        png,
        title: name,
        widthPx: out.width,
        heightPx: out.height,
        dpi: Number(dpi),
      });
      const ext = officeExtension(target);
      const fileName = `${name}.${ext}`;
      const path = await pickSavePath(
        title,
        lastFolder ? `${lastFolder}/${fileName}` : fileName,
        target === "word" ? "Word Document" : "PowerPoint Presentation",
        ext,
      );
      if (!path) return;
      lastFolder = path.slice(0, path.lastIndexOf("/"));
      await writeFile(path, doc);
    }
    if (out.missing)
      await alert(
        "Figure Exported",
        `${out.missing} panel${out.missing === 1 ? "" : "s"} couldn't be drawn — ${out.missing === 1 ? "its" : "their"} graph is missing. The ${out.missing === 1 ? "cell was left" : "cells were left"} blank.`,
        "warning",
      );
  } catch (err) {
    alert(title, reason(err), "error");
  }
}
