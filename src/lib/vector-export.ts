// Publication export (seq 216): true-vector EPS and PDF from the SVG Plotly
// already draws, BMP, CMYK/grayscale colour modes, and the grayscale figure
// walk. Pure module: no DOM, no Tauri, so the Node test suite drives it
// directly (the browser paths call it with the SVG `Plotly.toImage`
// returns, and with `document` present for text measurement).
//
// Design notes:
// - SVG is Plotly's own output: `<path>`/`<rect>`/`<circle>`/`<ellipse>`/
//   `<line>`/`<polyline>`/`<polygon>`/`<text>`/`<g>`/nested `<svg>`, with
//   `transform`, `clip-path="url(#…)"` (rect clips), presentation
//   attributes or `style="…"`. Anything else that affects the picture
//   (`<image>`, gradient/pattern fills, unresolvable clips) throws
//   `VectorExportError` — the PDF caller falls back to the raster
//   `pdfEncode`, the EPS caller errors naming the cause. No "present but
//   wrong": a vector file that silently dropped content would be worse
//   than no vector file.
// - PDF is 1.4 with base-14 fonts (Helvetica/Times/Courier + Bold), so no
//   font embedding: the SVG's point size is its px size × 72/96, applied
//   by one CTM (`0.75 0 0 -0.75 0 H cm`); text re-flips inside `BT…ET`
//   (`1 0 0 -1 x y Tm`) so glyphs stand upright. EPS uses the same flip
//   (`0 H translate 0.75 -0.75 scale`) and `stringwidth` for anchoring.
// - Colour: RGB is the native mode. Grayscale maps every colour to its
//   luminance (0.299/0.587/0.114). CMYK is the naive print conversion
//   (K = 1 − max, no ICC profile — documented in the tool text); it is
//   only offered for EPS/PDF/TIFF, never PNG/JPEG/SVG/BMP (those formats
//   have no CMYK form — `validateExportColorMode` refuses them).

export type ColorMode = "color" | "grayscale" | "cmyk";

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "color", label: "Color" },
  { value: "grayscale", label: "Grayscale" },
  { value: "cmyk", label: "CMYK" },
];

/** An SVG colour that cannot become vector output (raster image, gradient
 *  fill, …): the caller falls back (PDF) or errors (EPS). */
export class VectorExportError extends Error {}

export type Rgb = { r: number; g: number; b: number; a: number };

export function parseColor(value: string): Rgb | null {
  throw new Error("not implemented");
}

/** A colour's luminance, 0–255 (Rec. 601 luma, the print grayscale). */
export function grayOf(c: Rgb): number {
  throw new Error("not implemented");
}

/** Naive RGB → CMYK, each 0–1 (K = 1 − max, no ICC profile). */
export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  throw new Error("not implemented");
}

/** Whether `format` can be exported in `colorMode`: CMYK exists only for
 *  EPS, PDF and TIFF (PNG/JPEG/SVG/BMP have no CMYK form). Grayscale works
 *  everywhere. A refusal names the formats CMYK does work for. */
export function validateExportColorMode(format: string, colorMode: ColorMode): void {
  throw new Error("not implemented");
}

/** A Plotly figure with every colour string mapped to its gray — the one
 *  grayscale mechanism for raster formats (PNG/JPEG have no re-encoder, so
 *  the graph is drawn gray instead of converted after). Non-colour strings
 *  (names, titles) pass through untouched; "none"/"transparent" stay. */
export function grayscaleFigure<T extends { data: unknown[]; layout: object }>(figure: T): T {
  throw new Error("not implemented");
}

/** The SVG Plotly drew, as a true-vector PDF 1.4 (one page at the SVG's
 *  printed size, points = px × 72/96). Throws `VectorExportError` for
 *  content the converter cannot draw (`<image>`, gradient/pattern fills). */
export function svgToPdf(svg: string, opts?: { colorMode?: ColorMode }): Uint8Array {
  throw new Error("not implemented");
}

/** The SVG Plotly drew, as an EPS (PostScript level 2, `%%BoundingBox` at
 *  the SVG's printed size). Throws `VectorExportError` for content the
 *  converter cannot draw. */
export function svgToEps(svg: string, opts?: { colorMode?: ColorMode }): Uint8Array {
  throw new Error("not implemented");
}
