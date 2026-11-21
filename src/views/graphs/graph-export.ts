// Saving a graph as an image file, or copying it to the clipboard.
import { alert, handoffPngToKeynote, pickSavePath, writeFile } from "../../native";
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

/** Starts the clipboard write inside the click, with a promised image, as WebKit
 *  requires. Clipboard images must be raster: always PNG. Grayscale applies;
 *  CMYK falls back to colour (the clipboard has no CMYK). */
export function copyGraphImage(el: HTMLElement, size: Size, dpi: Resolution, colorMode: ColorMode = "color") {
  const why = tooLarge(size, dpi);
  if (why) return void alert("Couldn't Copy the Graph", why, "error");
  const mode = colorMode === "cmyk" ? "color" : colorMode;
  navigator.clipboard
    .write([new ClipboardItem({ "image/png": toImage(el, size, "png", dpi, mode).then((out) => out.blob) })])
    .catch((err) => alert("Couldn't Copy the Graph", reason(err), "error"));
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
