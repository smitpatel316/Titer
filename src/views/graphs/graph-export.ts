// Saving a graph as an image file, or copying it to the clipboard.
import { alert, copyPdfToClipboard, handoffPngToKeynote, isNative, pickSavePath, writeFile } from "../../native";
import { isMacOs } from "../../lib/channel";
import { buildOfficeDocument, officeDialogTitle, officeExtension, pngSize, type OfficeTarget } from "../../lib/office-export";
import { loadPlotly } from "./plotly";
import { withoutSelection } from "./selection";
import { vectorTraces } from "./plot-helpers";
import { largestAt, PX_PER_INCH, withDpi } from "../../lib/image-dpi";
import { bmpEncode, decodePng, pdfEncode, tiffEncode } from "../../lib/raster-export";
import {
  grayscaleFigure,
  svgToEps,
  svgToPdf,
  validateExportColorMode,
  VectorExportError,
  type ColorMode,
} from "../../lib/vector-export";

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf" | "tiff" | "eps" | "bmp";
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPG" },
  { value: "svg", label: "SVG" },
  { value: "pdf", label: "PDF" },
  { value: "tiff", label: "TIFF" },
  { value: "eps", label: "EPS" },
  { value: "bmp", label: "BMP" },
];
const EXTENSION: Record<ExportFormat, string> = { png: "png", jpeg: "jpg", svg: "svg", pdf: "pdf", tiff: "tiff", eps: "eps", bmp: "bmp" };
/** A raster image's resolution, in dots per inch (SVG/EPS/vector PDF have none). */
export const RESOLUTIONS = ["100", "150", "300", "600", "900", "1200"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

/** One-click export presets: a preset picks a format and a resolution
 *  together, so a publication-ready file is one tap instead of two
 *  separate choices. "Publication" is the journal figure: a TIFF at
 *  300 DPI — the resolution journals ask for colour figures, and the
 *  TIFF Titer already writes at true resolution with correct DPI tags
 *  (seq 290). */
export const EXPORT_PRESETS = [
  { value: "publication", label: "Publication (TIFF, 300 DPI)", format: "tiff", dpi: "300" },
] as const;
export type ExportPreset = (typeof EXPORT_PRESETS)[number]["value"];

/** The format + resolution a preset picks, or null for an unknown preset. */
export function exportPreset(preset: string): { format: ExportFormat; dpi: Resolution } | null {
  const found = EXPORT_PRESETS.find((p) => p.value === preset);
  return found ? { format: found.format, dpi: found.dpi } : null;
}

/** The export's final width (seq 294): Prism's export-size choice — the
 *  size given is the final size (width) of the exported graph, aspect
 *  ratio preserved — as a preset, the graph's own size, or a custom value
 *  in inches or cm. */
export const EXPORT_SIZE_PRESETS = [
  { value: "graph", label: "Graph's own size" },
  { value: "3.25", label: "Single column (3.25 in)" },
  { value: "5", label: "5 in" },
  { value: "7", label: "Full page (7 in)" },
  { value: "custom", label: "Custom…" },
] as const;
export type ExportSizePreset = (typeof EXPORT_SIZE_PRESETS)[number]["value"];
export type ExportSizeUnit = "in" | "cm";

/** The final width in inches a size choice resolves to, or undefined for
 *  the graph's own size. A custom value in cm converts at 2.54 cm/in. A
 *  blank, zero or negative custom value resolves to undefined — the
 *  export falls back to the graph's own size rather than failing (a blank
 *  field is Auto, as the axis limits are). */
export function exportFinalWidthIn(
  size: string,
  customWidth: number | undefined,
  customUnit: ExportSizeUnit,
): number | undefined {
  if (size === "graph") return undefined;
  if (size === "custom") {
    if (customWidth === undefined || !(customWidth > 0)) return undefined;
    return customUnit === "cm" ? customWidth / 2.54 : customWidth;
  }
  const preset = Number(size);
  return Number.isFinite(preset) && preset > 0 ? preset : undefined;
}

/** The draw size, in 96-DPI px, of a graph exported at `widthIn` final
 *  width: the width in px, the height derived from the graph's own aspect
 *  ratio. The MCP graph export's `width_in` resolves through the same
 *  math (`graphDrawSize` in `src/store/mcp-export.ts`), so a dialog
 *  export and an MCP export at the same width are the same size — and a
 *  vector export drawn at this size declares the width in points (its px
 *  size × 72/96), so 3.25 in draws at 312 px and declares 234 pt. */
export function drawSizeAtWidth(own: Size, widthIn: number): Size {
  const width = Math.round(widthIn * PX_PER_INCH);
  return { width, height: Math.round((width * own.height) / own.width) };
}

// The folder of the last export, offered again for the next one this session.
let lastFolder: string | null = null;

type Size = { width: number; height: number };

// JPEG, PDF and TIFF have no transparency: a transparent graph is drawn on
// white for them (PDF/TIFF composite the PNG onto white in raster-export).
const WHITE = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" };

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Why a raster image of the graph at `dpi` isn't made, if it isn't: told before drawing,
 *  as too large an image would hold up the whole Mac, or fail. */
function tooLarge(size: Size, dpi: Resolution) {
  const most = largestAt(size, Number(dpi));
  if (most.width < size.width) {
    return `At ${dpi} DPI, the largest graph Titer exports is ${most.width} × ${most.height} px. Choose a lower resolution, or make the graph smaller.`;
  }
}

/** The drawn graph as an image, without the selection ring, its points as sharp shapes;
 *  a raster one at `dpi`. PDF is true vector (the SVG Plotly draws, converted);
 *  when the drawing has content the converter cannot draw (raster image,
 *  gradient fill) it falls back to the raster PDF and says so in the
 *  returned `vector` flag. EPS is true vector, no fallback. BMP is the PNG
 *  re-encoded. Grayscale is drawn gray (the figure is walked before Plotly
 *  draws); CMYK is applied at emit time by the vector/raster encoders. */
async function toImage(el: HTMLElement, size: Size, format: ExportFormat, dpi: Resolution, colorMode: ColorMode = "color") {
  validateExportColorMode(format, colorMode);
  const drawn = el as HTMLElement & { data: unknown[]; layout: object };
  // EPS/PDF are drawn as SVG (Plotly has no EPS/PDF output); TIFF/BMP are
  // built from the PNG Plotly draws (it has no TIFF/BMP output).
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
  const Plotly = await loadPlotly();
  const url = await Plotly.toImage(figure, { format: drawnFormat, ...size, scale });
  const image = await (await fetch(url)).blob();
  if (format === "svg") return { blob: image, vector: true };
  // The blob's body reads once: take the bytes, derive the SVG text (vector
  // formats) and the PNG (raster formats) from them.
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (format === "eps")
    return {
      blob: new Blob([svgToEps(new TextDecoder().decode(bytes), { colorMode }) as BlobPart], {
        type: "application/postscript",
      }),
      vector: true,
    };
  if (format === "pdf") {
    try {
      return {
        blob: new Blob([svgToPdf(new TextDecoder().decode(bytes), { colorMode }) as BlobPart], { type: "application/pdf" }),
        vector: true,
      };
    } catch (err) {
      if (!(err instanceof VectorExportError)) throw err;
      // The drawing has raster/gradient content: draw it again as PNG and
      // encode the raster PDF, not a vector file that silently dropped it.
      const pngUrl = await Plotly.toImage(figure, { format: "png", ...size, scale: Number(dpi) / PX_PER_INCH });
      const pngBytes = new Uint8Array(await (await (await fetch(pngUrl)).blob()).arrayBuffer());
      return {
        blob: new Blob([pdfEncode(decodePng(pngBytes), Number(dpi), colorMode) as BlobPart], { type: "application/pdf" }),
        vector: false,
      };
    }
  }
  if (format === "tiff")
    return { blob: new Blob([tiffEncode(decodePng(bytes), Number(dpi), colorMode) as BlobPart], { type: "image/tiff" }), vector: false };
  if (format === "bmp")
    return { blob: new Blob([bmpEncode(decodePng(bytes), Number(dpi)) as BlobPart], { type: "image/bmp" }), vector: false };
  return { blob: await withDpi(bytes, format as "png" | "jpeg", Number(dpi)), vector: false };
}

export async function saveGraphImage(
  el: HTMLElement,
  size: Size,
  format: ExportFormat,
  dpi: Resolution,
  name: string,
  colorMode: ColorMode = "color",
) {
  // Vector formats are DPI-less (drawn at 96 DPI): no size cap.
  const vector = format === "svg" || format === "eps" || format === "pdf";
  const why = !vector && tooLarge(size, dpi);
  if (why) return alert("Couldn't Export the Graph", why, "error");
  try {
    const { blob: image, vector: isVector } = await toImage(el, size, format, dpi, colorMode);
    const ext = EXTENSION[format];
    const fileName = `${name}.${ext}`;
    const path = await pickSavePath(
      "Export Graph",
      lastFolder ? `${lastFolder}/${fileName}` : fileName,
      ext.toUpperCase(),
      ext,
    );
    if (!path) return;
    lastFolder = path.slice(0, path.lastIndexOf("/"));
    await writeFile(path, new Uint8Array(await image.arrayBuffer()));
    if (format === "pdf" && !isVector)
      await alert(
        "Exported as a Raster PDF",
        "The graph has content that can't be drawn as vectors (an image or gradient fill), so it was exported as a raster PDF instead of a vector one.",
        "warning",
      );
  } catch (err) {
    alert("Couldn't Export the Graph", reason(err), "error");
  }
}

/** Whether this webview's clipboard takes a PDF item (seq 431 — Prism
 *  copies a graph as vector PDF on Mac). Safari / WKWebView report it
 *  through `ClipboardItem.supports` where present; a webview without
 *  that API is treated as PDF-less, so the copy falls back to PNG-only —
 *  the old behaviour, never a failed write. Safe to call in node (no
 *  ClipboardItem there): returns false. */
export function clipboardSupportsPdf(): boolean {
  if (typeof ClipboardItem === "undefined") return false;
  const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
  return typeof supports === "function" ? supports("application/pdf") : false;
}

/** The clipboard payload for a graph/figure copy (seq 431): the vector
 *  PDF first, with the PNG bitmap as the fallback for apps that take no
 *  PDF. When `pdf` is undefined the item is PNG-only — the copy a
 *  platform without PDF support gets, exactly the old behaviour. */
export function vectorClipboardItem(
  pdf: Promise<Blob> | undefined,
  png: Promise<Blob>,
): Record<string, Promise<Blob>> {
  return pdf ? { "application/pdf": pdf, "image/png": png } : { "image/png": png };
}

/** Starts the clipboard write inside the click, with promised images, as
 *  WebKit requires. Vector PDF first (seq 431 — Prism copies a graph as
 *  vector PDF on Mac), PNG as the fallback for apps that take no PDF.
 *  Native first on macOS (seq 446): the shell writes the PDF + PNG to
 *  the pasteboard directly, because this webview reports no PDF support
 *  (`ClipboardItem.supports("application/pdf")` is false on Mac WebKit)
 *  and the web path would silently fall back to PNG-only. The PDF render
 *  always runs now — the old `clipboardSupportsPdf()` gate on it is gone.
 *  When the native write is unavailable or fails, the webview write runs
 *  instead (PDF item where supports() says so, else PNG-only, the old
 *  behaviour); a rejected vector write falls back to a PNG-only write,
 *  so a platform that takes the PDF type but refuses the write still
 *  leaves the PNG on the clipboard. Grayscale applies; CMYK falls back
 *  to colour (the clipboard has no CMYK). */
export async function copyGraphImage(el: HTMLElement, size: Size, dpi: Resolution, colorMode: ColorMode = "color") {
  const why = tooLarge(size, dpi);
  if (why) return void alert("Couldn't Copy the Graph", why, "error");
  const mode = colorMode === "cmyk" ? "color" : colorMode;
  // The PDF render always runs (seq 446): the native write takes it on
  // macOS, the webview write where supports() says so — the raster
  // fallback's size cap above still applies, the PNG is always drawn.
  const pdf = toImage(el, size, "pdf", dpi, mode).then((out) => out.blob);
  const png = toImage(el, size, "png", dpi, mode).then((out) => out.blob);
  if (await writeVectorToClipboard(pdf, png)) return;
  navigator.clipboard
    .write([new ClipboardItem(clipboardSupportsPdf() ? vectorClipboardItem(pdf, png) : { "image/png": png })])
    .catch(() =>
      navigator.clipboard
        .write([new ClipboardItem({ "image/png": png })])
        .catch((err) => alert("Couldn't Copy the Graph", reason(err), "error")),
    );
}

/** The native-first vector copy (seq 446), shared by the graph and
 *  figure copy paths: on the macOS app the shell writes the PDF + PNG
 *  to the pasteboard directly (`copyPdfToClipboard` in native.ts), which
 *  is the only path that puts a PDF on the clipboard there — the webview
 *  reports no PDF support. Returns true when the native write took it.
 *  False anywhere else (plain browser, tests, non-macOS) and when the
 *  native write fails, so the caller falls through to the webview write;
 *  the promised blobs are reusable after the await either way. */
export async function writeVectorToClipboard(pdf: Promise<Blob>, png: Promise<Blob>): Promise<boolean> {
  if (!isNative || !isMacOs()) return false;
  try {
    const [pdfBlob, pngBlob] = await Promise.all([pdf, png]);
    await copyPdfToClipboard(new Uint8Array(await pdfBlob.arrayBuffer()), new Uint8Array(await pngBlob.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/** One-click Send to Word / PowerPoint / Keynote (v2 item 19, seq 217):
 *  the graph as a PNG at `dpi`, embedded at its physical size in a real
 *  .docx / .pptx file. There is no COM automation on Mac/Linux, so the
 *  file — not a live app handoff — is the cross-platform form of Prism's
 *  one-click export; the user opens it in Word/PowerPoint. Keynote is
 *  the exception: no file-side .key exists (see office-export.ts), so
 *  Keynote takes Prism's own route — the PNG is handed to Keynote on
 *  macOS, which makes the presentation and saves the real .key. */
export async function sendGraphToOffice(el: HTMLElement, size: Size, target: OfficeTarget, dpi: Resolution, name: string) {
  const title = officeDialogTitle(target);
  const why = tooLarge(size, dpi);
  if (why) return alert(title, why, "error");
  try {
    const { blob: image } = await toImage(el, size, "png", dpi);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const dims = pngSize(bytes);
    if (!dims) throw new Error("Couldn't draw the graph as a PNG image.");
    if (target === "keynote") {
      const path = await pickSavePath(
        title,
        lastFolder ? `${lastFolder}/${name}.key` : `${name}.key`,
        "Keynote Presentation",
        "key",
      );
      if (!path) return;
      lastFolder = path.slice(0, path.lastIndexOf("/"));
      await handoffPngToKeynote(bytes, name, path, dims.widthPx, dims.heightPx, Number(dpi));
      return;
    }
    const doc = await buildOfficeDocument(target, {
      png: bytes,
      title: name,
      widthPx: dims.widthPx,
      heightPx: dims.heightPx,
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
  } catch (err) {
    alert(title, reason(err), "error");
  }
}
