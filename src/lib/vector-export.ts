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
//   font embedding: text is WinAnsi-encoded (single-byte, /WinAnsiEncoding
//   declared — never UTF-16BE or raw UTF-8 in a Type1 string). The SVG's
//   point size is its px size × 72/96, applied by one CTM
//   (`0.75 0 0 -0.75 0 H cm`); text re-flips inside `BT…ET`
//   (`1 0 0 -1 x y Tm`) so glyphs stand upright. EPS uses the same flip
//   (`0 H translate 0.75 -0.75 scale`) and `stringwidth` for anchoring.
//   Text encoding (seq 546): a base-14 Type1 font has no Unicode — its
//   glyphs are single-byte codes in the font's own encoding — so text is
//   split into runs: WinAnsi characters (ASCII + Latin-1 + WinAnsi
//   punctuation such as – — • ± ° × µ) draw in the label's own font with
//   `/Encoding /WinAnsiEncoding`, and Greek (Α–Ω, α–ω, ς) draws in the
//   base-14 /Symbol font, whose built-in encoding maps the Latin letters
//   to the Greek alphabet (γ is Symbol's byte for 'g'), with a /ToUnicode
//   CMap so copy-paste still reads γ/α. Anything no base-14 font owns
//   throws VectorExportError, and the callers fall back to the raster
//   PDF — a vector file that silently dropped glyphs would be worse.
//   Width/height in `pt` (as composeFigureSvg emits) convert at 96 px/in
//   first, so a 720 pt figure lands on a 720 pt page, not a 540 pt one.
// - Colour: RGB is the native mode. Grayscale maps every colour to its
//   luminance (0.299/0.587/0.114). CMYK is the naive print conversion
//   (K = 1 − max, no ICC profile — documented in the tool text); it is
//   only offered for EPS/PDF/TIFF, never PNG/JPEG/SVG/BMP (those formats
//   have no CMYK form — `validateExportColorMode` refuses them).

import { deflate } from "pako";

export type ColorMode = "color" | "grayscale" | "cmyk";

export const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: "color", label: "Color" },
  { value: "grayscale", label: "Grayscale" },
  { value: "cmyk", label: "CMYK" },
];

export class VectorExportError extends Error {}

export type Rgb = { r: number; g: number; b: number; a: number };

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  white: [255, 255, 255],
  maroon: [128, 0, 0],
  red: [255, 0, 0],
  purple: [128, 0, 128],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  olive: [128, 128, 0],
  yellow: [255, 255, 0],
  navy: [0, 0, 128],
  blue: [0, 0, 255],
  teal: [0, 128, 128],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  orange: [255, 165, 0],
};

export function parseColor(value: string): Rgb | null {
  const v = value.trim().toLowerCase();
  if (!v || v === "none") return null;
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    const h = hex[1]!;
    const n = (s: string) => parseInt(s, 16);
    if (h.length === 3) return { r: n(h[0]! + h[0]!), g: n(h[1]! + h[1]!), b: n(h[2]! + h[2]!), a: 1 };
    if (h.length === 4)
      return { r: n(h[0]! + h[0]!), g: n(h[1]! + h[1]!), b: n(h[2]! + h[2]!), a: n(h[3]! + h[3]!) / 255 };
    if (h.length === 6) return { r: n(h.slice(0, 2)), g: n(h.slice(2, 4)), b: n(h.slice(4, 6)), a: 1 };
    return { r: n(h.slice(0, 2)), g: n(h.slice(2, 4)), b: n(h.slice(4, 6)), a: n(h.slice(6, 8)) / 255 };
  }
  const fn = /^rgba?\(([^)]*)\)$/.exec(v);
  if (fn) {
    const parts = fn[1]!.split(",").map((s) => s.trim());
    if (parts.length < 3 || parts.length > 4) return null;
    const num = (s: string | undefined): number | null => {
      if (s === undefined) return null;
      if (s.endsWith("%")) {
        const n = Number(s.slice(0, -1));
        return Number.isFinite(n) ? (n * 255) / 100 : null;
      }
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    if (r === null || g === null || b === null) return null;
    let a = 1;
    if (parts.length === 4) {
      const av = Number(parts[3]);
      if (!Number.isFinite(av)) return null;
      a = av;
    }
    return { r: Math.round(r), g: Math.round(g), b: Math.round(b), a };
  }
  const named = NAMED_COLORS[v];
  if (named) return { r: named[0], g: named[1], b: named[2], a: 1 };
  return null;
}

export function grayOf(c: Rgb): number {
  return Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
}

export function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  const d = 1 - k;
  return [(1 - r - k) / d, (1 - g - k) / d, (1 - b - k) / d, k];
}

/** A colour's gray hex (`#4c4c4c`); an alpha colour keeps its alpha as rgba. */
export function grayString(c: Rgb): string {
  const g = grayOf(c);
  if (c.a < 1) return `rgba(${g}, ${g}, ${g}, ${c.a})`;
  const h = g.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
}

export function validateExportColorMode(format: string, colorMode: ColorMode): void {
  if (colorMode !== "color" && colorMode !== "grayscale" && colorMode !== "cmyk")
    throw new Error(`Unknown colour mode “${colorMode}” — the colour modes are color, grayscale, cmyk.`);
  if (colorMode === "cmyk" && format !== "eps" && format !== "pdf" && format !== "tiff")
    throw new Error(`CMYK is supported for EPS, PDF and TIFF only — ${format} has no CMYK form. Choose color or grayscale.`);
}

export function grayscaleFigure<T extends { data: unknown[]; layout: object }>(figure: T): T {
  // Only colour-valued strings are grayscaled: a string under a key that
  // names a colour ("color", "fillcolor", "paper_bgcolor", "colorscale"…)
  // or an element of such an array. Series/category names and titles are
  // text, even when they happen to spell a CSS colour name ("Red") —
  // rewriting those corrupts the legend and the title.
  const isColorKey = (key: string): boolean => {
    const k = key.toLowerCase();
    return k.includes("color") || k === "fill" || k === "stroke";
  };
  const map = (v: unknown, colorContext: boolean): unknown => {
    if (typeof v === "string") {
      if (!colorContext) return v;
      const t = v.trim().toLowerCase();
      if (t === "none" || t === "transparent") return v;
      const c = parseColor(v);
      return c ? grayString(c) : v;
    }
    if (Array.isArray(v)) return v.map((el) => map(el, colorContext));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = map(val, isColorKey(k));
      return out;
    }
    return v;
  };
  return { ...figure, data: figure.data.map((d) => map(d, false)), layout: map(figure.layout, false) as object };
}

// ── Minimal SVG parsing ──────────────────────────────────────────────────

export interface SvgNode {
  tag: string;
  attrs: Record<string, string>;
  children: SvgNode[];
  text: string;
  /** This node's direct text segments and element children, in document
   *  order (seq 548): `text` concatenates the segments, so a label like
   *  `H<sub>2</sub>O` would read as `HO` + `2` — the parts keep the
   *  script mid-label. Consecutive text segments are merged into one
   *  entry. Absent only on nodes built without the parser. */
  parts?: (string | SvgNode)[];
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");

/** A small XML parser for the SVG Plotly writes: elements, quoted
 *  attributes, text, comments, prolog, CDATA. Anything malformed errors
 *  naming the SVG — it is never silently misread. */
export function parseSvg(svg: string): SvgNode {
  let at = 0;
  const n = svg.length;
  const skipWs = () => {
    while (at < n && /\s/.test(svg[at]!)) at++;
  };
  const parseNode = (): SvgNode | null => {
    skipWs();
    if (at >= n) return null;
    if (svg.startsWith("<!--", at)) {
      const end = svg.indexOf("-->", at + 4);
      if (end < 0) throw new VectorExportError("Unterminated comment in SVG.");
      at = end + 3;
      return parseNode();
    }
    if (svg.startsWith("<?", at) || svg.startsWith("<!", at)) {
      const end = svg.indexOf(">", at + 2);
      if (end < 0) throw new VectorExportError("Unterminated prolog in SVG.");
      at = end + 1;
      return parseNode();
    }
    if (svg[at] !== "<") {
      // Text between elements (whitespace only, at this level).
      const end = svg.indexOf("<", at);
      const text = svg.slice(at, end < 0 ? n : end);
      at = end < 0 ? n : end;
      if (text.trim()) throw new VectorExportError("Unexpected text in SVG.");
      return parseNode();
    }
    if (svg.startsWith("</", at)) return null;
    at++; // <
    const tagMatch = /^[A-Za-z][A-Za-z0-9_.:-]*/.exec(svg.slice(at));
    if (!tagMatch) throw new VectorExportError("Malformed element in SVG.");
    const tag = tagMatch[0];
    at += tag.length;
    const attrs: Record<string, string> = {};
    for (;;) {
      skipWs();
      if (at >= n) throw new VectorExportError("Unterminated element in SVG.");
      if (svg.startsWith("/>", at)) {
        at += 2;
        return { tag, attrs, children: [], text: "", parts: [] };
      }
      if (svg[at] === ">") {
        at++;
        break;
      }
      const nameMatch = /^[A-Za-z_:][A-Za-z0-9_.:-]*/.exec(svg.slice(at));
      if (!nameMatch) throw new VectorExportError(`Malformed attribute in <${tag}>.`);
      const name = nameMatch[0];
      at += name.length;
      skipWs();
      let value = "";
      if (svg[at] === "=") {
        at++;
        skipWs();
        const q = svg[at];
        if (q !== '"' && q !== "'") throw new VectorExportError(`Unquoted attribute ${name} in <${tag}>.`);
        const end = svg.indexOf(q, at + 1);
        if (end < 0) throw new VectorExportError(`Unterminated attribute ${name} in <${tag}>.`);
        value = decodeEntities(svg.slice(at + 1, end));
        at = end + 1;
      }
      attrs[name] = value;
    }
    const children: SvgNode[] = [];
    let text = "";
    const parts: (string | SvgNode)[] = [];
    /** A direct text segment: appended to `text`, merged into the last
     *  part when it is also text, so the parts stay in document order. */
    const addText = (segment: string) => {
      if (!segment) return;
      text += segment;
      const last = parts[parts.length - 1];
      if (typeof last === "string") parts[parts.length - 1] = last + segment;
      else parts.push(segment);
    };
    for (;;) {
      if (at >= n) throw new VectorExportError(`Unterminated <${tag}> in SVG.`);
      if (svg.startsWith("</", at)) {
        const end = svg.indexOf(">", at + 2);
        if (end < 0) throw new VectorExportError(`Unterminated </${tag}>.`);
        const close = svg.slice(at + 2, end).trim();
        if (close !== tag) throw new VectorExportError(`Mismatched close tag </${close}> for <${tag}>.`);
        at = end + 1;
        return { tag, attrs, children, text, parts };
      }
      if (svg.startsWith("<![CDATA[", at)) {
        const end = svg.indexOf("]]>", at + 9);
        if (end < 0) throw new VectorExportError("Unterminated CDATA in SVG.");
        addText(svg.slice(at + 9, end));
        at = end + 3;
        continue;
      }
      if (svg.startsWith("<!--", at)) {
        const end = svg.indexOf("-->", at + 4);
        if (end < 0) throw new VectorExportError("Unterminated comment in SVG.");
        at = end + 3;
        continue;
      }
      if (svg[at] === "<") {
        const child = parseNode();
        if (child) {
          children.push(child);
          parts.push(child);
        }
        continue;
      }
      const end = svg.indexOf("<", at);
      addText(decodeEntities(svg.slice(at, end < 0 ? n : end)));
      at = end < 0 ? n : end;
    }
  };
  const root = parseNode();
  if (!root || root.tag !== "svg") throw new VectorExportError("Not an SVG document.");
  return root;
}

/** A node's presentation: its own attributes over the inherited ones,
 *  with `style="…"` winning over presentation attributes (CSS order). */
type Presentation = {
  fill: string | undefined;
  fillOpacity: number;
  stroke: string | undefined;
  strokeWidth: number;
  strokeOpacity: number;
  opacity: number;
  fillRule: "nonzero" | "evenodd";
  strokeDasharray: number[] | undefined;
  strokeLinecap: string;
  strokeLinejoin: string;
  clipPath: string | undefined;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textAnchor: "start" | "middle" | "end";
  display: string | undefined;
  visibility: string | undefined;
};

const DEFAULT_PRESENTATION: Presentation = {
  fill: "#000000",
  fillOpacity: 1,
  stroke: undefined,
  strokeWidth: 1,
  strokeOpacity: 1,
  opacity: 1,
  fillRule: "nonzero",
  strokeDasharray: undefined,
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  clipPath: undefined,
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 16,
  fontWeight: "normal",
  textAnchor: "start",
  display: undefined,
  visibility: undefined,
};

function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of style.split(";")) {
    const colon = decl.indexOf(":");
    if (colon < 0) continue;
    out[decl.slice(0, colon).trim().toLowerCase()] = decl.slice(colon + 1).trim();
  }
  return out;
}

/** A font size with units: `12` / `12px` is absolute, `70%` / `0.7em` is
 *  of the inherited size — Plotly writes `font-size:70%` on its
 *  super/subscript tspans (seq 548). Anything unparseable keeps the
 *  inherited size, as `num` does for the other lengths. */
function fontSizeOf(value: string | undefined, parent: number): number {
  if (value === undefined) return parent;
  const v = value.trim().toLowerCase();
  if (v.endsWith("%")) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) && n > 0 ? (parent * n) / 100 : parent;
  }
  if (v.endsWith("em")) {
    const n = Number(v.slice(0, -2));
    return Number.isFinite(n) && n > 0 ? parent * n : parent;
  }
  const n = Number(v.replace(/px$/, ""));
  return Number.isFinite(n) && n > 0 ? n : parent;
}

/** A CSS length in SVG user units (96 CSS px per inch): unitless and `px`
 *  are user units as-is; `pt`/`in`/`cm`/`mm`/`pc` convert. `%`, `em` and
 *  anything unparseable is not a length here — null, so the caller falls
 *  back instead of misreading "12px" as NaN (the old `Number(v)` did
 *  exactly that, and every Plotly `px` value silently fell back). */
function parseLength(v: string): number | null {
  const m = /^(-?\d*\.?\d+(?:[eE][-+]?\d+)?)(px|pt|in|cm|mm|pc|%)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  switch (m[2]) {
    case "pt":
      return (n * 96) / 72;
    case "in":
      return n * 96;
    case "cm":
      return (n * 96) / 2.54;
    case "mm":
      return (n * 96) / 25.4;
    case "pc":
      return n * 16;
    case "%":
      return null;
    default:
      return n;
  }
}

function presentationOf(node: SvgNode, parent: Presentation): Presentation {
  const merged = { ...node.attrs };
  if (merged.style) Object.assign(merged, parseStyle(merged.style));
  const num = (v: string | undefined, fallback: number) => {
    if (v === undefined) return fallback;
    const n = parseLength(v);
    return n !== null && Number.isFinite(n) ? n : fallback;
  };
  const dash = merged["stroke-dasharray"];
  return {
    fill: merged.fill !== undefined ? (merged.fill === "none" ? undefined : merged.fill) : parent.fill,
    fillOpacity: num(merged["fill-opacity"], parent.fillOpacity),
    stroke: merged.stroke !== undefined ? (merged.stroke === "none" ? undefined : merged.stroke) : parent.stroke,
    strokeWidth: num(merged["stroke-width"], parent.strokeWidth),
    strokeOpacity: num(merged["stroke-opacity"], parent.strokeOpacity),
    // Group opacity composes: a child's opacity multiplies the parent's,
    // it does not replace it — a <g style="opacity: 0.4"> with a child at
    // opacity 1 renders at 0.4, not 1.
    opacity: merged.opacity !== undefined ? parent.opacity * num(merged.opacity, 1) : parent.opacity,
    fillRule: merged["fill-rule"] === "evenodd" ? "evenodd" : parent.fillRule,
    strokeDasharray:
      dash === undefined
        ? parent.strokeDasharray
        : dash === "none"
          ? undefined
          : dash
              .split(/[\s,]+/)
              .map((s) => parseLength(s))
              .filter((x): x is number => x !== null && Number.isFinite(x) && x >= 0),
    strokeLinecap: merged["stroke-linecap"] ?? parent.strokeLinecap,
    strokeLinejoin: merged["stroke-linejoin"] ?? parent.strokeLinejoin,
    // clip-path is NOT inherited (SVG 1.1): a <g>'s clip applies once, to
    // the whole group, in the group's own case — descendants must not
    // re-apply it (redundant clips, and in the wrong space when a child
    // has its own transform).
    clipPath: merged["clip-path"],
    fontFamily: merged["font-family"] ?? parent.fontFamily,
    fontSize: fontSizeOf(merged["font-size"], parent.fontSize),
    fontWeight: merged["font-weight"] ?? parent.fontWeight,
    textAnchor:
      merged["text-anchor"] === "middle" || merged["text-anchor"] === "end" ? merged["text-anchor"] : merged["text-anchor"] === "start" ? "start" : parent.textAnchor,
    display: merged.display ?? parent.display,
    visibility: merged.visibility ?? parent.visibility,
  };
}

// ── 2-D matrices [a b c d e f]: x' = a·x + c·y + e, y' = b·x + d·y + f ──

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const applyToPoint = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const nums = match[2]!.split(/[\s,]+/).filter(Boolean).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) continue;
    let t: Matrix = IDENTITY;
    if (match[1] === "translate") t = [1, 0, 0, 1, nums[0] ?? 0, nums[1] ?? 0];
    else if (match[1] === "scale") t = [nums[0] ?? 1, 0, 0, nums[1] ?? nums[0] ?? 1, 0, 0];
    else if (match[1] === "rotate") {
      const a = ((nums[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
    } else if (match[1] === "matrix" && nums.length >= 6)
      t = [nums[0]!, nums[1]!, nums[2]!, nums[3]!, nums[4]!, nums[5]!];
    else if (match[1] === "skewX") t = [1, 0, Math.tan(((nums[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (match[1] === "skewY") t = [1, Math.tan(((nums[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = multiply(m, t);
  }
  return m;
}

// ── Path data ────────────────────────────────────────────────────────────

export type PathSeg =
  | { kind: "M"; x: number; y: number }
  | { kind: "L"; x: number; y: number }
  | { kind: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { kind: "Z" };

/** Path data to absolute segments (M/L/cubic C/Z). Arcs become cubics,
 *  quadratics become cubics, shorthand commands reflect their control
 *  point — the PDF/EPS backends only ever see M/L/C/Z. */
export function parsePathData(d: string): PathSeg[] {
  // Note: arc flags are tokenised as numbers, so flags written without a
  // separator ("01162…") would misread — Plotly/d3 always separate them
  // ("0 0,1 …"), and anything else errors rather than misdrawing.
  const tokens: (string | number)[] = [];
  const re = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d)) !== null) {
    const t = m[0];
    tokens.push(/[MmLlHhVvCcSsQqTtAaZz]/.test(t) ? t : Number(t));
  }
  const segs: PathSeg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let cmd = "";
  let prevCubic: [number, number] | null = null;
  let prevQuad: [number, number] | null = null;
  const nextNum = (): number => {
    const t = tokens[i++];
    if (typeof t !== "number") throw new VectorExportError(`Bad path data near “${d.slice(0, 40)}”.`);
    return t;
  };
  const hasNum = () => typeof tokens[i] === "number";
  while (i < tokens.length) {
    const t = tokens[i];
    if (typeof t === "string") {
      cmd = t;
      i++;
      if (cmd === "Z" || cmd === "z") {
        segs.push({ kind: "Z" });
        cx = sx;
        cy = sy;
        prevCubic = null;
        prevQuad = null;
        continue;
      }
    } else if (!cmd) throw new VectorExportError("Path data starts with a number, not a command.");
    const rel = cmd === cmd.toLowerCase();
    const at = (x: number, y: number): [number, number] => (rel ? [cx + x, cy + y] : [x, y]);
    switch (cmd.toUpperCase()) {
      case "M": {
        const [x, y] = at(nextNum(), nextNum());
        segs.push({ kind: "M", x, y });
        cx = x;
        cy = y;
        sx = x;
        sy = y;
        prevCubic = null;
        prevQuad = null;
        cmd = rel ? "l" : "L"; // further pairs are implicit linetos
        break;
      }
      case "L": {
        const [x, y] = at(nextNum(), nextNum());
        segs.push({ kind: "L", x, y });
        cx = x;
        cy = y;
        prevCubic = null;
        prevQuad = null;
        break;
      }
      case "H": {
        const x = rel ? cx + nextNum() : nextNum();
        segs.push({ kind: "L", x, y: cy });
        cx = x;
        prevCubic = null;
        prevQuad = null;
        break;
      }
      case "V": {
        const y = rel ? cy + nextNum() : nextNum();
        segs.push({ kind: "L", x: cx, y });
        cy = y;
        prevCubic = null;
        prevQuad = null;
        break;
      }
      case "C": {
        const [x1, y1] = at(nextNum(), nextNum());
        const [x2, y2] = at(nextNum(), nextNum());
        const [x, y] = at(nextNum(), nextNum());
        segs.push({ kind: "C", x1, y1, x2, y2, x, y });
        prevCubic = [x2, y2];
        prevQuad = null;
        cx = x;
        cy = y;
        break;
      }
      case "S": {
        const [x2, y2] = at(nextNum(), nextNum());
        const [x, y] = at(nextNum(), nextNum());
        const [x1, y1] = prevCubic ? [2 * cx - prevCubic[0], 2 * cy - prevCubic[1]] : [cx, cy];
        segs.push({ kind: "C", x1, y1, x2, y2, x, y });
        prevCubic = [x2, y2];
        prevQuad = null;
        cx = x;
        cy = y;
        break;
      }
      case "Q": {
        const [qx, qy] = at(nextNum(), nextNum());
        const [x, y] = at(nextNum(), nextNum());
        segs.push({
          kind: "C",
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: x + (2 / 3) * (qx - x),
          y2: y + (2 / 3) * (qy - y),
          x,
          y,
        });
        prevQuad = [qx, qy];
        prevCubic = null;
        cx = x;
        cy = y;
        break;
      }
      case "T": {
        const [x, y] = at(nextNum(), nextNum());
        const qx: number = prevQuad ? 2 * cx - prevQuad[0] : cx;
        const qy: number = prevQuad ? 2 * cy - prevQuad[1] : cy;
        segs.push({
          kind: "C",
          x1: cx + (2 / 3) * (qx - cx),
          y1: cy + (2 / 3) * (qy - cy),
          x2: x + (2 / 3) * (qx - x),
          y2: y + (2 / 3) * (qy - y),
          x,
          y,
        });
        prevQuad = [qx, qy];
        prevCubic = null;
        cx = x;
        cy = y;
        break;
      }
      case "A": {
        const rx = Math.abs(nextNum());
        const ry = Math.abs(nextNum());
        const rot = (nextNum() * Math.PI) / 180;
        const large = nextNum() !== 0;
        const sweep = nextNum() !== 0;
        const [x, y] = at(nextNum(), nextNum());
        for (const s of arcToCubics(cx, cy, rx, ry, rot, large, sweep, x, y)) segs.push(s);
        prevCubic = null;
        prevQuad = null;
        cx = x;
        cy = y;
        break;
      }
      default:
        throw new VectorExportError(`Unsupported path command “${cmd}”.`);
    }
    if (!hasNum() && i < tokens.length && typeof tokens[i] === "string") continue;
  }
  return segs;
}

/** An SVG elliptical arc as cubic segments (endpoint → centre
 *  parameterisation, split at ≤90°). */
function arcToCubics(
  x1: number, y1: number, rx: number, ry: number, phi: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): PathSeg[] {
  if (rx === 0 || ry === 0) return [{ kind: "L", x: x2, y: y2 }];
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let k = num <= 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cxp = (k * rx * y1p) / ry;
  const cyp = (-k * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  if (num <= 0) {
    // Radii too small for the endpoints: scale both by one factor (the
    // spec's correction — scaling them one after the other, reusing the
    // already-scaled value, skews the ellipse).
    const lambda = Math.sqrt(Math.max(0, den / (rx2 * ry2)));
    rx2 = (rx * lambda) ** 2;
    ry2 = (ry * lambda) ** 2;
  }
  const rxS = Math.sqrt(rx2);
  const ryS = Math.sqrt(ry2);
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const v1x = (x1p - cxp) / rxS;
  const v1y = (y1p - cyp) / ryS;
  const v2x = (-x1p - cxp) / rxS;
  const v2y = (-y1p - cyp) / ryS;
  let start = angle(1, 0, v1x, v1y);
  let delta = angle(v1x, v1y, v2x, v2y);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
  const out: PathSeg[] = [];
  for (let p = 0; p < parts; p++) {
    const a0 = start + (delta * p) / parts;
    const a1 = start + (delta * (p + 1)) / parts;
    const t = (4 / 3) * Math.tan((a1 - a0) / 4);
    const p0 = pointOnEllipse(a0);
    const p3 = pointOnEllipse(a1);
    const p1: [number, number] = [p0[0] + t * tangent(a0)[0], p0[1] + t * tangent(a0)[1]];
    const p2: [number, number] = [p3[0] - t * tangent(a1)[0], p3[1] - t * tangent(a1)[1]];
    out.push({ kind: "C", x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], x: p3[0], y: p3[1] });
  }
  return out;
  function pointOnEllipse(a: number): [number, number] {
    return [
      cx + rxS * Math.cos(a) * cos - ryS * Math.sin(a) * sin,
      cy + rxS * Math.cos(a) * sin + ryS * Math.sin(a) * cos,
    ];
  }
  function tangent(a: number): [number, number] {
    return [
      -rxS * Math.sin(a) * cos - ryS * Math.cos(a) * sin,
      -rxS * Math.sin(a) * sin + ryS * Math.cos(a) * cos,
    ];
  }
}

// ── Paints ───────────────────────────────────────────────────────────────

type Paint =
  | { kind: "none" }
  | { kind: "rgb"; r: number; g: number; b: number }
  | { kind: "gray"; v: number }
  | { kind: "cmyk"; c: number; m: number; y: number; k: number };

/** A fill/stroke value as a paint in `colorMode` — `none` stays none, a
 *  `url(#…)` reference is not a colour (the caller throws). */
function paintOf(value: string | undefined, colorMode: ColorMode): Paint {
  if (value === undefined) return { kind: "none" };
  const v = value.trim();
  if (v === "none") return { kind: "none" };
  if (v.startsWith("url(")) throw new VectorExportError(`Cannot draw a ${v} fill/stroke as vector output — gradients and patterns are not supported.`);
  const c = parseColor(v);
  if (!c) throw new VectorExportError(`Cannot parse colour “${v}”.`);
  if (c.a === 0) return { kind: "none" };
  if (colorMode === "grayscale") return { kind: "gray", v: grayOf(c) / 255 };
  if (colorMode === "cmyk") {
    const [cc, mm, yy, kk] = rgbToCmyk(c.r / 255, c.g / 255, c.b / 255);
    return { kind: "cmyk", c: cc, m: mm, y: yy, k: kk };
  }
  return { kind: "rgb", r: c.r / 255, g: c.g / 255, b: c.b / 255 };
}

const fmt = (n: number) => {
  if (!Number.isFinite(n)) return "0";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
};

// ── Text runs (seq 548) ────────────────────────────────────────────────
// Plotly renders <sup>/<sub> as nested <tspan>s — the script tspan at 70%
// size with a dy shift (-0.6em super, +0.3em sub), then an empty tspan
// with the restoring dy (+0.42em / -0.21em) — plus U+200B markers around
// them. The walker used to flatten a <text> to one string at one size, so
// "GFP^hi" came out "GFPhi" in vector PDF/EPS. These runs keep each
// tspan's size, family, weight and baseline shift, so the PDF/EPS draw
// them raised and shrunk like the screen does. (The log-axis powers
// `powerLabel` writes in plot-helpers.ts ride the same mechanism.)
//
// The cursor follows the SVG text model: a tspan's x/y reset it
// absolutely, its dy shifts it relatively (em of that tspan's own font
// size), otherwise text continues where the previous run ended. Runs are
// grouped by line (a direct child tspan of the <text>), and each line
// anchors on its own start x — Plotly's positionText sets every line
// tspan's x/y to the text's anchor point, so a middle-anchored title
// still centres per line.

/** One drawn run of a <text>: its text at its own size and baseline
 *  shift (`dy` from the text's y), starting at `x`, on `line`. A line
 *  whose start x is an anchor point (`anchored`) is shifted by the
 *  line's total width for middle/end anchoring; a continuation line is
 *  drawn where the cursor left it. */
export interface TextRun {
  text: string;
  size: number;
  family: string;
  bold: boolean;
  dy: number;
  x: number;
  line: number;
  anchored: boolean;
}

/** A length with units, in px: `12` / `12px` is absolute, `70%` / `0.7em`
 *  is of `base` (the tspan's own font size for dy, per SVG). */
function svgLength(value: string | undefined, base: number): number | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (!v) return undefined;
  if (v.endsWith("%")) {
    const n = Number(v.slice(0, -1));
    return Number.isFinite(n) ? (base * n) / 100 : undefined;
  }
  if (v.endsWith("em")) {
    const n = Number(v.slice(0, -2));
    return Number.isFinite(n) ? base * n : undefined;
  }
  const n = Number(v.replace(/px$/, ""));
  return Number.isFinite(n) ? n : undefined;
}

const isBold = (pres: Presentation): boolean => pres.fontWeight === "bold" || Number(pres.fontWeight) >= 600;

/** A <text>'s runs: its own text plus every nested tspan / <a>, each at
 *  its inherited presentation, with Plotly's U+200B markers stripped (they
 *  are not content, and would force the whole PDF string to UTF-16BE). */
export function textRuns(node: SvgNode, parent: Presentation): TextRun[] {
  const runs: TextRun[] = [];
  const baseX = Number(node.attrs.x ?? 0);
  const baseY = Number(node.attrs.y ?? 0);
  let cx = baseX;
  let cy = baseY;
  let line = 0;
  let anchored = true; // the <text>'s own text anchors on its x
  const pushText = (text: string, pres: Presentation) => {
    const clean = text.replace(/\u200B/g, "");
    if (!clean) return;
    runs.push({ text: clean, size: pres.fontSize, family: pres.fontFamily, bold: isBold(pres), dy: cy - baseY, x: cx, line, anchored });
    cx += measureTextWidth(clean, pres.fontSize, pres.fontFamily, isBold(pres));
  };
  /** A tspan's x/y/dy move the cursor: x/y reset it absolutely, dy shifts
   *  it relatively. Returns whether the tspan carried its own x. */
  const shiftCursor = (el: SvgNode, pres: Presentation): boolean => {
    if (el.tag !== "tspan") return false;
    const x = svgLength(el.attrs.x, pres.fontSize);
    const y = svgLength(el.attrs.y, pres.fontSize);
    if (x !== undefined) cx = x;
    if (y !== undefined) cy = y;
    const dy = svgLength(el.attrs.dy, pres.fontSize);
    if (dy !== undefined) cy += dy;
    return x !== undefined;
  };
  /** One element's parts in document order: direct text is a run at the
   *  cursor, a child tspan shifts the cursor and recurses. Falls back to
   *  the concatenated text + children on nodes built without the parser. */
  const walkParts = (el: SvgNode, pres: Presentation): void => {
    const parts = el.parts ?? [el.text, ...el.children];
    for (const part of parts) {
      if (typeof part === "string") {
        pushText(part, pres);
        continue;
      }
      if (part.tag !== "tspan" && part.tag !== "a") continue;
      const childPres = presentationOf(part, pres);
      shiftCursor(part, childPres);
      walkParts(part, childPres);
    }
  };
  // The <text>'s own parts in order — except a direct child tspan starts
  // a new line (Plotly's line tspans, one per wrapped line). A first line
  // without its own x still anchors on the text's x when nothing was
  // drawn before it.
  const topParts = node.parts ?? [node.text, ...node.children];
  for (const part of topParts) {
    if (typeof part === "string") {
      pushText(part, parent);
      continue;
    }
    if (part.tag !== "tspan" && part.tag !== "a") continue;
    line++;
    const childPres = presentationOf(part, parent);
    anchored = shiftCursor(part, childPres) || (line === 1 && runs.length === 0);
    walkParts(part, childPres);
  }
  return runs;
}

// Text measurement: the browser measures with the real font (canvas); in
// Node the approximation (0.6 em/char) only centres anchored text roughly.
let canvasCtx: { font: string; measureText: (s: string) => { width: number } } | null | undefined;
function measureTextWidth(text: string, size: number, family: string, bold: boolean): number {
  if (canvasCtx === undefined) {
    canvasCtx = null;
    try {
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvasCtx = canvas.getContext("2d");
      }
    } catch {
      canvasCtx = null;
    }
  }
  if (canvasCtx) {
    canvasCtx.font = `${bold ? "bold " : ""}${size}px ${family}`;
    return canvasCtx.measureText(text).width;
  }
  return text.length * size * 0.6;
}

// ── The shared walker ────────────────────────────────────────────────────

interface Backend {
  save(): void;
  restore(): void;
  concat(m: Matrix): void;
  clipPath(segs: PathSeg[]): void;
  drawPath(segs: PathSeg[], fill: Paint, fillOpacity: number, fillRule: "nonzero" | "evenodd", stroke: Paint, strokeWidth: number, strokeOpacity: number, dash: number[] | undefined, cap: string, join: string): void;
  drawText(x: number, y: number, text: string, size: number, family: string, bold: boolean, anchor: "start" | "middle" | "end", fill: Paint, opacity: number): void;
}

interface WalkState {
  root: SvgNode;
  defsById: Map<string, SvgNode>;
}

function indexDefs(node: SvgNode, into: Map<string, SvgNode>): void {
  const id = node.attrs.id;
  if (id) into.set(id, node);
  for (const c of node.children) indexDefs(c, into);
}

function ellipseSegs(cx: number, cy: number, rx: number, ry: number): PathSeg[] {
  const k = 0.5522847498;
  return [
    { kind: "M", x: cx + rx, y: cy },
    { kind: "C", x1: cx + rx, y1: cy + k * ry, x2: cx + k * rx, y2: cy + ry, x: cx, y: cy + ry },
    { kind: "C", x1: cx - k * rx, y1: cy + ry, x2: cx - rx, y2: cy + k * ry, x: cx - rx, y: cy },
    { kind: "C", x1: cx - rx, y1: cy - k * ry, x2: cx - k * rx, y2: cy - ry, x: cx, y: cy - ry },
    { kind: "C", x1: cx + k * rx, y1: cy - ry, x2: cx + rx, y2: cy - k * ry, x: cx + rx, y: cy },
    { kind: "Z" },
  ];
}

function roundedRectSegs(x: number, y: number, w: number, h: number, rx: number, ry: number): PathSeg[] {
  const r = Math.min(rx, w / 2);
  const q = Math.min(ry, h / 2);
  const k = 0.5522847498;
  return [
    { kind: "M", x: x + r, y },
    { kind: "L", x: x + w - r, y },
    { kind: "C", x1: x + w - r + k * r, y1: y, x2: x + w, y2: y + q - k * q, x: x + w, y: y + q },
    { kind: "L", x: x + w, y: y + h - q },
    { kind: "C", x1: x + w, y1: y + h - q + k * q, x2: x + w - r + k * r, y2: y + h, x: x + w - r, y: y + h },
    { kind: "L", x: x + r, y: y + h },
    { kind: "C", x1: x + r - k * r, y1: y + h, x2: x, y2: y + h - q + k * q, x: x, y: y + h - q },
    { kind: "L", x, y: y + q },
    { kind: "C", x1: x, y1: y + q - k * q, x2: x + r - k * r, y2: y, x: x + r, y },
    { kind: "Z" },
  ];
}

function shapeSegs(node: SvgNode): PathSeg[] | null {
  const a = node.attrs;
  const num = (v: string | undefined, d = 0) => {
    const n = Number(v);
    return v === undefined || !Number.isFinite(n) ? d : n;
  };
  switch (node.tag) {
    case "path": {
      const d = a.d ?? "";
      return d.trim() ? parsePathData(d) : null;
    }
    case "rect": {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      if (w <= 0 || h <= 0) return null;
      const rx = num(a.rx, num(a.ry));
      const ry = num(a.ry, num(a.rx));
      if (rx > 0 || ry > 0) return roundedRectSegs(x, y, w, h, rx, ry);
      return [
        { kind: "M", x, y },
        { kind: "L", x: x + w, y },
        { kind: "L", x: x + w, y: y + h },
        { kind: "L", x, y: y + h },
        { kind: "Z" },
      ];
    }
    case "circle": {
      const r = num(a.r);
      if (r <= 0) return null;
      return ellipseSegs(num(a.cx), num(a.cy), r, r);
    }
    case "ellipse": {
      const rx = num(a.rx);
      const ry = num(a.ry);
      if (rx <= 0 || ry <= 0) return null;
      return ellipseSegs(num(a.cx), num(a.cy), rx, ry);
    }
    case "line": {
      return [
        { kind: "M", x: num(a.x1), y: num(a.y1) },
        { kind: "L", x: num(a.x2), y: num(a.y2) },
      ];
    }
    case "polyline":
    case "polygon": {
      const pts = (a.points ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (pts.length < 4 || pts.some((n) => !Number.isFinite(n))) return null;
      const segs: PathSeg[] = [{ kind: "M", x: pts[0]!, y: pts[1]! }];
      for (let i = 2; i + 1 < pts.length; i += 2) segs.push({ kind: "L", x: pts[i]!, y: pts[i + 1]! });
      if (node.tag === "polygon") segs.push({ kind: "Z" });
      return segs;
    }
    default:
      return null;
  }
}

/** A clipPath's content as segments (rect/path/circle/ellipse only). */
function clipSegs(clip: SvgNode): PathSeg[] {
  const out: PathSeg[] = [];
  for (const child of clip.children) {
    if (child.tag === "clipPath") {
      out.push(...clipSegs(child));
      continue;
    }
    const segs = shapeSegs(child);
    if (!segs) throw new VectorExportError(`Unsupported element <${child.tag}> inside a clipPath.`);
    const m = parseTransform(child.attrs.transform);
    out.push(
      ...segs.map((s): PathSeg => {
        if (s.kind === "M" || s.kind === "L") {
          const [x, y] = applyToPoint(m, s.x, s.y);
          return { ...s, x, y };
        }
        if (s.kind === "C") {
          const [x1, y1] = applyToPoint(m, s.x1, s.y1);
          const [x2, y2] = applyToPoint(m, s.x2, s.y2);
          const [x, y] = applyToPoint(m, s.x, s.y);
          return { ...s, x1, y1, x2, y2, x, y };
        }
        return s;
      }),
    );
  }
  return out;
}

function walk(node: SvgNode, pres: Presentation, matrix: Matrix, state: WalkState, backend: Backend, colorMode: ColorMode): void {
  const p = presentationOf(node, pres);
  if (p.display === "none" || p.visibility === "hidden" || p.visibility === "collapse") return;
  const m = multiply(matrix, parseTransform(node.attrs.transform));
  const effOpacity = p.opacity;
  const applyClip = (): boolean => {
    const clip = p.clipPath;
    if (!clip) return false;
    const idMatch = /^url\(#([^)]+)\)$/.exec(clip.trim());
    if (!idMatch) throw new VectorExportError(`Unsupported clip-path “${clip}”.`);
    const clipNode = state.defsById.get(idMatch[1]!);
    if (!clipNode || clipNode.tag !== "clipPath") throw new VectorExportError(`Unknown clipPath #${idMatch[1]}.`);
    // The clip's segments are already in the referencing element's user
    // space, and the backend's CTM already holds that element's transform
    // (withMatrix / the <g> concat) — emit them untransformed, or the
    // transform would apply twice.
    backend.clipPath(clipSegs(clipNode));
    return true;
  };
  const withMatrix = (fn: () => void) => {
    backend.save();
    backend.concat(m);
    const clipped = applyClip();
    if (clipped) backend.save();
    fn();
    if (clipped) backend.restore();
    backend.restore();
  };
  switch (node.tag) {
    case "defs":
    case "clipPath":
    case "title":
    case "desc":
    case "metadata":
      return;
    case "image":
      throw new VectorExportError("An <image> element cannot be drawn as vector output — it is raster content.");
    case "g":
    case "svg": {
      // A nested <svg> also offsets/scales into its viewBox.
      let extra = IDENTITY;
      if (node.tag === "svg") {
        const vb = (node.attrs.viewBox ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
        const w = parseLength(node.attrs.width ?? "") ?? NaN;
        const h = parseLength(node.attrs.height ?? "") ?? NaN;
        if (vb.length === 4 && vb.every(Number.isFinite) && Number.isFinite(w) && Number.isFinite(h) && vb[2]! > 0 && vb[3]! > 0) {
          extra = multiply(
            [w / vb[2]!, 0, 0, h / vb[3]!, Number(node.attrs.x ?? 0), Number(node.attrs.y ?? 0)],
            [1, 0, 0, 1, -vb[0]!, -vb[1]!],
          );
        } else {
          extra = [1, 0, 0, 1, Number(node.attrs.x ?? 0), Number(node.attrs.y ?? 0)];
        }
      }
      const childMatrix = multiply(m, extra);
      backend.save();
      backend.concat(childMatrix);
      const clipped = applyClip();
      if (clipped) backend.save();
      for (const child of node.children) walk(child, p, IDENTITY, state, backend, colorMode);
      if (clipped) backend.restore();
      backend.restore();
      return;
    }
    case "text": {
      const text = textContent(node);
      if (!text) return;
      // Super/subscripts (seq 548) are runs at their own size and
      // baseline shift — one `drawText` per run, advancing x by the
      // measured widths, each line anchored on its own start x. A plain
      // <text> (no tspans) is one run, drawn exactly as before.
      const runs = textRuns(node, p);
      if (!runs.length) return;
      withMatrix(() => {
        const fill = paintOf(p.fill, colorMode);
        if (fill.kind === "none") return;
        const lines = new Map<number, TextRun[]>();
        for (const run of runs) {
          const lineRuns = lines.get(run.line) ?? [];
          lineRuns.push(run);
          lines.set(run.line, lineRuns);
        }
        for (const lineRuns of lines.values()) {
          const widths = lineRuns.map((r) => measureTextWidth(r.text, r.size, r.family, r.bold));
          const total = widths.reduce((a, b) => a + b, 0);
          const first = lineRuns[0]!;
          const shift =
            !first.anchored || p.textAnchor === "start"
              ? 0
              : p.textAnchor === "middle"
                ? -total / 2
                : -total;
          for (const run of lineRuns) {
            backend.drawText(
              run.x + shift,
              Number(node.attrs.y ?? 0) + run.dy,
              run.text,
              run.size,
              run.family,
              run.bold,
              "start",
              fill,
              effOpacity * p.fillOpacity,
            );
          }
        }
      });
      return;
    }
    default: {
      const segs = shapeSegs(node);
      if (!segs) {
        // An unknown element that draws nothing (e.g. <a>) — walk its children.
        for (const child of node.children) walk(child, p, m, state, backend, colorMode);
        return;
      }
      withMatrix(() => {
        const fill = node.tag === "line" ? { kind: "none" as const } : paintOf(p.fill, colorMode);
        const stroke = paintOf(p.stroke, colorMode);
        if (fill.kind === "none" && stroke.kind === "none") return;
        backend.drawPath(
          segs,
          fill,
          effOpacity * p.fillOpacity,
          p.fillRule,
          stroke,
          p.strokeWidth,
          effOpacity * p.strokeOpacity,
          p.strokeDasharray,
          p.strokeLinecap,
          p.strokeLinejoin,
        );
      });
      return;
    }
  }
}

function textContent(node: SvgNode): string {
  let out = node.text;
  for (const child of node.children) {
    if (child.tag === "tspan") out += textContent(child);
    else if (child.tag === "a") out += textContent(child);
  }
  return out.trim();
}

// ── PDF backend ──────────────────────────────────────────────────────────

type PdfFontKey = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7";

/** A string as a single-byte literal `(…)` with WinAnsi bytes: `\`, `(`, `)`
 *  backslash-escaped, every byte outside printable ASCII as an octal
 *  escape, so the stream stays pure ASCII. Shared by the PDF and EPS
 *  backends (both use base-14 Type1 fonts). A character no base-14 font
 *  owns throws VectorExportError — Greek reaches the PDF through
 *  pdfTextRuns/Symbol instead, and the callers fall back to raster or
 *  error naming the cause, never a silent "?". U+2212 draws as an ASCII
 *  hyphen, as in pdfTextRuns (seq 546). */
function winAnsiLiteral(text: string): string {
  let out = "(";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const b = code === 0x2212 ? 0x2d : winAnsiByte(code);
    if (b === null) {
      throw new VectorExportError(
        `The label contains “${ch}” (U+${code.toString(16).toUpperCase().padStart(4, "0")}), which the vector export's fonts cannot draw — export it as a raster PDF instead.`,
      );
    }
    if (b === 0x5c) out += "\\\\";
    else if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b < 0x20 || b >= 0x7f) out += `\\${b.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(b);
  }
  return `${out})`;
}
const PDF_FONTS: Record<PdfFontKey, string> = {
  F1: "Helvetica",
  F2: "Helvetica-Bold",
  F3: "Times-Roman",
  F4: "Times-Bold",
  F5: "Courier",
  F6: "Courier-Bold",
  // F7 is the Symbol font (see the PDF text encoding note below): the
  // base-14 font that owns the Greek alphabet. It has no bold face.
  F7: "Symbol",
};

function pdfFontKey(family: string, bold: boolean): PdfFontKey {
  const f = family.toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return bold ? "F6" : "F5";
  if (f.includes("times") || f.includes("serif")) return bold ? "F4" : "F3";
  return bold ? "F2" : "F1";
}

// ── PDF text encoding (seq 546) ──────────────────────────────────────────
// A base-14 Type1 font has no Unicode: a string's bytes are single-byte
// codes in the font's own encoding. The old `pdfEscape` wrote every
// non-ASCII string as a UTF-16BE hex string (`<feff…>`) for such a font,
// so the bytes came back as unrelated codes and Greek (γ, α, …) — and
// every other non-ASCII glyph — silently dropped from the vector PDF,
// while the UI and PNG renders (system font) were fine. Text is
// therefore split into runs, each drawn in a font that owns its glyphs.
//
// - WinAnsi (Latin) runs: ASCII + Latin-1 + the WinAnsi punctuation in
//   the U+0080–U+009F slots (€ ‚ ƒ „ … † ‡ ˆ ‰ Š ‹ Œ Ž ‘’ “” • – — ˜ ™
//   š › œ ž Ÿ), drawn in the label's own Helvetica/Times/Courier with
//   `/Encoding /WinAnsiEncoding`, one byte per character.
// - Greek runs: Α–Ω, α–ω, ς, plus the variant forms ϑ (U+03D1) and
//   ϕ (U+03D5), drawn in /Symbol, whose built-in encoding maps the
//   Latin letters to the Greek alphabet (γ is Symbol's byte for 'g',
//   α for 'a'). A /ToUnicode CMap (built from the same table, so it
//   cannot drift) maps those bytes back to the Greek code points, so
//   copy-paste and text extraction still read γ/α. Symbol has no bold
//   face, so a bold label's Greek runs draw at regular weight.
// - Anything else (Cyrillic, CJK, maths beyond the WinAnsi set, …)
//   throws VectorExportError: the callers fall back to the raster PDF,
//   which keeps the glyphs, rather than a vector file that dropped
//   them. The one exception is U+2212 MINUS SIGN, which draws as an
//   ASCII hyphen — the minus labels use.

/** WinAnsi (CP1252) punctuation: the byte each of these code points takes. */
// U+0081, U+008D, U+008F, U+0090 and U+009D have no WinAnsi byte.
const WINANSI_PUNCT: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function winAnsiByte(code: number): number | null {
  if (code >= 0x20 && code <= 0x7e) return code;
  if (code >= 0xa0 && code <= 0xff) return code;
  return WINANSI_PUNCT[code] ?? null;
}

/** Symbol bytes for U+0391–U+03A9 (skipping unassigned U+03A2). */
const GREEK_ALPHABET_UPPER = "ABGDEZHQIKLMNXOPRSTUFCYW";
/** Symbol bytes for U+03B1–U+03C1 and U+03C3–U+03C9. */
const GREEK_ALPHABET_LOWER = "abgdezhqiklmnxoprstufcyw";
/** Variant Greek forms Symbol also owns: ς, ϑ, ϕ. */
const GREEK_EXTRA: Record<number, number> = { 0x03c2: 0x76, 0x03d1: 0x4a, 0x03d5: 0x6a };

function symbolByte(code: number): number | null {
  if (code >= 0x391 && code <= 0x3a9 && code !== 0x3a2) {
    const idx = code - 0x391 - (code > 0x3a2 ? 1 : 0);
    return GREEK_ALPHABET_UPPER.charCodeAt(idx);
  }
  if (code >= 0x3b1 && code <= 0x3c9 && code !== 0x3c2) {
    const idx = code - 0x3b1 - (code > 0x3c2 ? 1 : 0);
    return GREEK_ALPHABET_LOWER.charCodeAt(idx);
  }
  return GREEK_EXTRA[code] ?? null;
}

type PdfTextRun = { symbol: boolean; text: string; bytes: number[] };

function pdfTextRuns(text: string): PdfTextRun[] {
  const runs: PdfTextRun[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number | null;
    let symbol: boolean;
    const s = symbolByte(code);
    if (s !== null) {
      byte = s;
      symbol = true;
    } else if (code === 0x2212) {
      byte = 0x2d;
      symbol = false;
    } else {
      const w = winAnsiByte(code);
      if (w === null) {
        throw new VectorExportError(
          `The label contains “${ch}” (U+${code.toString(16).toUpperCase().padStart(4, "0")}), which the vector PDF's fonts cannot draw — export it as a raster PDF instead.`,
        );
      }
      byte = w;
      symbol = false;
    }
    const last = runs[runs.length - 1];
    if (last && last.symbol === symbol) {
      last.text += ch;
      last.bytes.push(byte);
    } else {
      runs.push({ symbol, text: ch, bytes: [byte] });
    }
  }
  return runs;
}

/** A run's bytes as a PDF literal string: parens/backslash escaped, bytes
 *  ≥ 0x80 as octal escapes (unambiguous in a literal string). */
function pdfLiteral(bytes: number[]): string {
  let out = "(";
  for (const b of bytes) {
    if (b === 0x28) out += "\\(";
    else if (b === 0x29) out += "\\)";
    else if (b === 0x5c) out += "\\\\";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `${out})`;
}

/** The Symbol font's /ToUnicode CMap: every Symbol byte it draws back to
 *  its Greek code point, generated from the same table as `symbolByte`. */
function symbolToUnicodeCmap(): string {
  const entries: [number, number][] = [];
  for (let code = 0x391; code <= 0x3a9; code++) {
    if (code === 0x3a2) continue;
    entries.push([symbolByte(code)!, code]);
  }
  for (let code = 0x3b1; code <= 0x3c9; code++) {
    if (code === 0x3c2) continue;
    entries.push([symbolByte(code)!, code]);
  }
  for (const [code, byte] of Object.entries(GREEK_EXTRA)) entries.push([byte, Number(code)]);
  entries.sort((a, b) => a[0] - b[0]);
  const lines = entries.map(
    ([byte, code]) =>
      `<${byte.toString(16).padStart(2, "0").toUpperCase()}> <${code.toString(16).padStart(4, "0").toUpperCase()}>`,
  );
  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<00> <FF>",
    "endcodespacerange",
    `${lines.length} beginbfchar`,
    ...lines,
    "endbfchar",
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
    "",
  ].join("\n");
}

class PdfBackend implements Backend {
  ops: string[] = [];
  fonts = new Set<PdfFontKey>();
  /** True once a Greek run drew in /Symbol: the PDF then carries the
   *  Symbol /ToUnicode CMap as its last object (seq 546). */
  usesSymbol = false;
  gsStates: { fill: number; stroke: number }[] = [];
  private gsIndex(fill: number, stroke: number): number {
    const found = this.gsStates.findIndex((g) => g.fill === fill && g.stroke === stroke);
    if (found >= 0) return found;
    this.gsStates.push({ fill, stroke });
    return this.gsStates.length - 1;
  }
  save(): void {
    this.ops.push("q");
  }
  restore(): void {
    this.ops.push("Q");
  }
  concat(m: Matrix): void {
    this.ops.push(`${fmt(m[0])} ${fmt(m[1])} ${fmt(m[2])} ${fmt(m[3])} ${fmt(m[4])} ${fmt(m[5])} cm`);
  }
  clipPath(segs: PathSeg[]): void {
    this.emitPath(segs);
    this.ops.push("W n");
  }
  private emitPath(segs: PathSeg[]): void {
    for (const s of segs) {
      if (s.kind === "M") this.ops.push(`${fmt(s.x)} ${fmt(s.y)} m`);
      else if (s.kind === "L") this.ops.push(`${fmt(s.x)} ${fmt(s.y)} l`);
      else if (s.kind === "C")
        this.ops.push(`${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)} c`);
      else this.ops.push("h");
    }
  }
  private colorOp(p: Paint, stroke: boolean): string {
    if (p.kind === "rgb") return `${fmt(p.r)} ${fmt(p.g)} ${fmt(p.b)} ${stroke ? "RG" : "rg"}`;
    if (p.kind === "gray") return `${fmt(p.v)} ${stroke ? "G" : "g"}`;
    if (p.kind === "cmyk") return `${fmt(p.c)} ${fmt(p.m)} ${fmt(p.y)} ${fmt(p.k)} ${stroke ? "K" : "k"}`;
    return "";
  }
  private opacityOp(fillOpacity: number, strokeOpacity: number): void {
    if (fillOpacity < 1 || strokeOpacity < 1) {
      const idx = this.gsIndex(fillOpacity, strokeOpacity);
      this.ops.push(`/GS${idx} gs`);
    }
  }
  drawPath(
    segs: PathSeg[], fill: Paint, fillOpacity: number, fillRule: "nonzero" | "evenodd",
    stroke: Paint, strokeWidth: number, strokeOpacity: number,
    dash: number[] | undefined, cap: string, join: string,
  ): void {
    this.ops.push("q");
    this.opacityOp(fillOpacity, strokeOpacity);
    this.emitPath(segs);
    const paintOps: string[] = [];
    if (fill.kind !== "none") paintOps.push(this.colorOp(fill, false));
    if (stroke.kind !== "none") {
      paintOps.push(this.colorOp(stroke, true));
      paintOps.push(`${fmt(strokeWidth)} w`);
      paintOps.push(`${cap === "round" ? 1 : cap === "square" ? 2 : 0} J`);
      paintOps.push(`${join === "round" ? 1 : join === "bevel" ? 2 : 0} j`);
      if (dash && dash.length) paintOps.push(`[${dash.map(fmt).join(" ")}] 0 d`);
    }
    this.ops.push(...paintOps);
    if (fill.kind !== "none" && stroke.kind !== "none") this.ops.push(fillRule === "evenodd" ? "B*" : "B");
    else if (fill.kind !== "none") this.ops.push(fillRule === "evenodd" ? "f*" : "f");
    else this.ops.push("S");
    this.ops.push("Q");
  }
  drawText(
    x: number, y: number, text: string, size: number, family: string, bold: boolean,
    anchor: "start" | "middle" | "end", fill: Paint, opacity: number,
  ): void {
    // Runs split the text by the font that owns each glyph (seq 546);
    // each run draws in its own font at the x the previous runs ended.
    // A Greek run measures in Symbol (no bold face exists for it).
    const runs = pdfTextRuns(text);
    const widths = runs.map((r) =>
      measureTextWidth(r.text, size, r.symbol ? "Symbol" : family, r.symbol ? false : bold),
    );
    const total = widths.reduce((a, b) => a + b, 0);
    const tx = anchor === "middle" ? x - total / 2 : anchor === "end" ? x - total : x;
    this.ops.push("q");
    this.opacityOp(opacity, opacity);
    this.ops.push(this.colorOp(fill, false));
    let rx = tx;
    runs.forEach((run, i) => {
      const key = run.symbol ? "F7" : pdfFontKey(family, bold);
      this.fonts.add(key);
      if (run.symbol) this.usesSymbol = true;
      this.ops.push(`BT /${key} ${fmt(size)} Tf 1 0 0 -1 ${fmt(rx)} ${fmt(y)} Tm ${pdfLiteral(run.bytes)} Tj ET`);
      rx += widths[i]!;
    });
    this.ops.push("Q");
  }
  content(): string {
    return this.ops.join("\n");
  }
  resources(toUnicodeObj: number): string {
    const fonts = [...this.fonts]
      .map((k) => {
        if (k === "F7") {
          return `/F7 << /Type /Font /Subtype /Type1 /BaseFont /Symbol${toUnicodeObj ? ` /ToUnicode ${toUnicodeObj} 0 R` : ""} >>`;
        }
        return `/${k} << /Type /Font /Subtype /Type1 /BaseFont /${PDF_FONTS[k]} /Encoding /WinAnsiEncoding >>`;
      })
      .join(" ");
    const gs = this.gsStates
      .map((g, i) => `/GS${i} << /Type /ExtGState /ca ${fmt(g.fill)} /CA ${fmt(g.stroke)} >>`)
      .join(" ");
    return `<< /Font << ${fonts} >>${gs ? ` /ExtGState << ${gs} >>` : ""} /ProcSet [/PDF /Text] >>`;
  }
}

function svgSize(root: SvgNode): { width: number; height: number } {
  // Width/height are CSS lengths, not bare numbers: a figure SVG sized in
  // points ("720pt", as composeFigureSvg emits) is 960 user units, and the
  // 72/96 px→pt factor in the emitters then lands it on a 720 pt page —
  // reading the number raw and applying the factor shrank it to 540 pt.
  const w = parseLength(root.attrs.width ?? "");
  const h = parseLength(root.attrs.height ?? "");
  if (w !== null && h !== null && w > 0 && h > 0) return { width: w, height: h };
  const vb = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0)
    return { width: vb[2]!, height: vb[3]! };
  throw new VectorExportError("The SVG has no width/height or viewBox.");
}

function prepare(svg: string): { root: SvgNode; state: WalkState; width: number; height: number } {
  const root = parseSvg(svg);
  const defsById = new Map<string, SvgNode>();
  indexDefs(root, defsById);
  const { width, height } = svgSize(root);
  return { root, state: { root, defsById }, width, height };
}

/** The root viewBox as a matrix into the root's own width/height. */
function rootViewBoxMatrix(root: SvgNode, width: number, height: number): Matrix {
  const vb = (root.attrs.viewBox ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0)
    return multiply([width / vb[2]!, 0, 0, height / vb[3]!, 0, 0], [1, 0, 0, 1, -vb[0]!, -vb[1]!]);
  return IDENTITY;
}

export function svgToPdf(svg: string, opts?: { colorMode?: ColorMode }): Uint8Array {
  const colorMode = opts?.colorMode ?? "color";
  validateExportColorMode("pdf", colorMode);
  const { root, state, width, height } = prepare(svg);
  const backend = new PdfBackend();
  const wPt = (width * 72) / 96;
  const hPt = (height * 72) / 96;
  backend.ops.push(`q ${fmt(72 / 96)} 0 0 ${fmt(-72 / 96)} 0 ${fmt(hPt)} cm`);
  for (const child of root.children) walk(child, DEFAULT_PRESENTATION, rootViewBoxMatrix(root, width, height), state, backend, colorMode);
  backend.ops.push("Q");
  const content = new TextEncoder().encode(backend.content());
  const compressed = deflate(content);
  // The Symbol /ToUnicode CMap rides as the last object, only when a
  // Greek run used /Symbol (seq 546); its number is therefore 5.
  const cmap = backend.usesSymbol ? new TextEncoder().encode(symbolToUnicodeCmap()) : null;
  const objects: { head: string; stream?: Uint8Array }[] = [
    { head: "<< /Type /Catalog /Pages 2 0 R >>" },
    { head: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
    {
      head: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(wPt)} ${fmt(hPt)}] /Resources ${backend.resources(cmap ? 5 : 0)} /Contents 4 0 R >>`,
    },
    { head: `<< /Length ${compressed.length} /Filter /FlateDecode >>`, stream: compressed },
  ];
  if (cmap) objects.push({ head: `<< /Length ${cmap.length} >>`, stream: cmap });
  const parts: Uint8Array[] = [new TextEncoder().encode("%PDF-1.4\n")];
  const offsets = [0];
  objects.forEach((obj, i) => {
    offsets.push(parts.reduce((n, p) => n + p.length, 0));
    parts.push(new TextEncoder().encode(`${i + 1} 0 obj\n${obj.head}\n`));
    if (obj.stream) {
      parts.push(new TextEncoder().encode("stream\n"), obj.stream, new TextEncoder().encode("\nendstream\n"));
    }
    parts.push(new TextEncoder().encode("endobj\n"));
  });
  const xrefAt = parts.reduce((n, p) => n + p.length, 0);
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  parts.push(new TextEncoder().encode(xref));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ── EPS backend ──────────────────────────────────────────────────────────

function psEscape(text: string): string {
  return winAnsiLiteral(text);
}

/** Opacity has no PostScript form: blend the paint toward white by it
 *  (the graph draws on white), and skip a fully transparent paint. */
function blendTowardWhite(p: Paint, opacity: number): Paint {
  if (opacity >= 1) return p;
  if (p.kind === "rgb") {
    const f = (v: number) => v * opacity + (1 - opacity);
    return { kind: "rgb", r: f(p.r), g: f(p.g), b: f(p.b) };
  }
  if (p.kind === "gray") return { kind: "gray", v: p.v * opacity + (1 - opacity) };
  if (p.kind === "cmyk") {
    const f = (v: number) => v * opacity;
    return { kind: "cmyk", c: f(p.c), m: f(p.m), y: f(p.y), k: f(p.k) };
  }
  return p;
}

class EpsBackend implements Backend {
  ops: string[] = [];
  save(): void {
    this.ops.push("gsave");
  }
  restore(): void {
    this.ops.push("grestore");
  }
  concat(m: Matrix): void {
    this.ops.push(`[${fmt(m[0])} ${fmt(m[1])} ${fmt(m[2])} ${fmt(m[3])} ${fmt(m[4])} ${fmt(m[5])}] concat`);
  }
  clipPath(segs: PathSeg[]): void {
    this.emitPath(segs);
    // "clip" consumes the path but leaves it current: clear it, or every
    // shape drawn after the clip appends onto the clip rectangle.
    this.ops.push("clip");
    this.ops.push("newpath");
  }
  private emitPath(segs: PathSeg[]): void {
    // Every path starts clean: without newpath, a shape inside a clipped
    // <g> would append its segments onto the clip path left behind.
    this.ops.push("newpath");
    for (const s of segs) {
      if (s.kind === "M") this.ops.push(`${fmt(s.x)} ${fmt(s.y)} moveto`);
      else if (s.kind === "L") this.ops.push(`${fmt(s.x)} ${fmt(s.y)} lineto`);
      else if (s.kind === "C")
        this.ops.push(`${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)} curveto`);
      else this.ops.push("closepath");
    }
  }
  private colorOp(p: Paint): string {
    if (p.kind === "rgb") return `${fmt(p.r)} ${fmt(p.g)} ${fmt(p.b)} setrgbcolor`;
    if (p.kind === "gray") return `${fmt(p.v)} setgray`;
    if (p.kind === "cmyk") return `${fmt(p.c)} ${fmt(p.m)} ${fmt(p.y)} ${fmt(p.k)} setcmykcolor`;
    return "";
  }
  drawPath(
    segs: PathSeg[], fill: Paint, fillOpacity: number, fillRule: "nonzero" | "evenodd",
    stroke: Paint, strokeWidth: number, strokeOpacity: number,
    dash: number[] | undefined, cap: string, join: string,
  ): void {
    const f = fill.kind === "none" ? fill : blendTowardWhite(fill, fillOpacity);
    const s = stroke.kind === "none" ? stroke : blendTowardWhite(stroke, strokeOpacity);
    if (f.kind === "none" && s.kind === "none") return;
    this.ops.push("gsave");
    this.emitPath(segs);
    if (f.kind !== "none") {
      this.ops.push(this.colorOp(f));
      this.ops.push(fillRule === "evenodd" ? "eofill" : "fill");
    }
    if (s.kind !== "none") {
      this.emitPath(segs);
      this.ops.push(this.colorOp(s));
      this.ops.push(`${fmt(strokeWidth)} setlinewidth`);
      this.ops.push(`${cap === "round" ? 1 : cap === "square" ? 2 : 0} setlinecap`);
      this.ops.push(`${join === "round" ? 1 : join === "bevel" ? 2 : 0} setlinejoin`);
      if (dash && dash.length) this.ops.push(`[${dash.map(fmt).join(" ")}] 0 setdash`);
      this.ops.push("stroke");
    }
    this.ops.push("grestore");
  }
  drawText(
    x: number, y: number, text: string, size: number, family: string, bold: boolean,
    anchor: "start" | "middle" | "end", fill: Paint, opacity: number,
  ): void {
    const f = fill.kind === "none" ? fill : blendTowardWhite(fill, opacity);
    if (f.kind === "none") return;
    const font = psFontName(family, bold);
    this.ops.push("gsave");
    this.ops.push(this.colorOp(f));
    this.ops.push(`/${font} findfont ${fmt(size)} scalefont setfont`);
    this.ops.push(`${fmt(x)} ${fmt(y)} translate 1 -1 scale`);
    // `show`/`rmoveto` need a current point: translate alone leaves none,
    // and PostScript aborts with /nocurrentpoint.
    this.ops.push("0 0 moveto");
    if (anchor === "middle") this.ops.push(`${psEscape(text)} dup stringwidth pop 2 div neg 0 rmoveto show`);
    else if (anchor === "end") this.ops.push(`${psEscape(text)} dup stringwidth pop neg 0 rmoveto show`);
    else this.ops.push(`${psEscape(text)} show`);
    this.ops.push("grestore");
  }
}

function psFontName(family: string, bold: boolean): string {
  const f = family.toLowerCase();
  if (f.includes("courier") || f.includes("mono")) return bold ? "Courier-Bold" : "Courier";
  if (f.includes("times") || f.includes("serif")) return bold ? "Times-Bold" : "Times-Roman";
  return bold ? "Helvetica-Bold" : "Helvetica";
}

export function svgToEps(svg: string, opts?: { colorMode?: ColorMode }): Uint8Array {
  const colorMode = opts?.colorMode ?? "color";
  validateExportColorMode("eps", colorMode);
  const { root, state, width, height } = prepare(svg);
  const backend = new EpsBackend();
  const wPt = (width * 72) / 96;
  const hPt = (height * 72) / 96;
  backend.ops.push(`0 ${fmt(hPt)} translate 0.75 -0.75 scale`);
  for (const child of root.children) walk(child, DEFAULT_PRESENTATION, rootViewBoxMatrix(root, width, height), state, backend, colorMode);
  const body = [
    "%!PS-Adobe-3.0 EPSF-3.0",
    "%%Creator: Titer",
    "%%Title: Titer graph export",
    `%%BoundingBox: 0 0 ${fmt(wPt)} ${fmt(hPt)}`,
    "%%EndComments",
    ...backend.ops,
    "%%EOF",
    "",
  ].join("\n");
  return new TextEncoder().encode(body);
}
