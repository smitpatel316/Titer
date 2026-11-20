// What every graph shares: how its series are painted (`Paint`), the statistics it
// draws (centers, errors), and the Plotly layout of each family.
import {
  SAME_AS_FILL,
  type FillPattern,
  type GraphOptions,
  type GraphType,
  type LineDash,
  type Place,
  type PointShape,
  type PointStyle,
  type RefLabelPlace,
} from "../../store/types";
import { xyPoints, xyRows, type Column, type DataSet } from "../../lib/dataset";
import { pointKeyOf } from "../../lib/columns";
import type { GraphFigure } from ".";
import { paletteColor, paletteOf, withOpacity } from "../../lib/palettes";
import { boxOf, mean, median, sd, sem } from "../../lib/summary";
import { summaryFormatDef, type SummaryFormat } from "../../lib/summary-format";
import { tCrit95 } from "../../lib/student-t";

export const INK = "#111827"; // axes + titles only
export const GUIDE = "#9CA3AF"; // what guides the eye: threshold lines, a name's leader line

/** How a graph paints its series (a column, or a Grouped-family group, by name). */
export interface Paint {
  /** The series' color: its lines, and what its fills and outlines start from. */
  color: (key: string, index: number) => string;
  /** The outline of its bars, boxes, violins, areas and slices (Plotly's `line`). */
  edge: (key: string, index: number) => { color: string; width: number };
  /** Its line (Plotly's `line`): its dashes, else the graph's. */
  line: (key: string, index: number) => { color: string; width: number; dash: LineDash };
  /** The bars of a series: their fill, outline and pattern (Plotly's bar `marker`). */
  bars: (key: string, index: number) => Record<string, unknown>;
  /** The pattern over its fill, if it has one (Plotly's `pattern` / `fillpattern`). */
  pattern: (key: string, index: number) => { shape: string; fgcolor: string; bgcolor: string } | undefined;
  /** Its error bars of `array` (Plotly's `error_y` or `error_x`), with an
   *  optional `arrayminus` for asymmetric errors (a summary table's +error /
   *  −error, or upper / lower limits, which differ above and below the mean). */
  errorBars: (key: string, index: number, array: number[], arrayminus?: number[]) => Record<string, unknown>;
  /** Its mean or median line, drawn like its error bars (Plotly's `line`). */
  centerLine: (key: string, index: number) => { color: string; width: number };
  /** The fill of its bars, boxes, violins and areas. */
  fill: (key: string, index: number) => string;
  /** The fill of its points. */
  dot: (key: string, index: number) => string;
  /** Its points' shape: the series' own, else the graph's. */
  shape: (key: string) => PointShape;
  /** One point's style (`pointKey`, see `pointKeyOf`): its own, else its series'. */
  point: (pointKey: string, key: string, index: number) => Required<Omit<PointStyle, "label" | "labelOffset">>;
  /** Every point's size and outline thickness (px). */
  size: number;
  outline: number;
  /** The outline color of a point colored `color`: `own` (its own choice), else the graph's. */
  outlineColor: (color: string, own?: string) => string;
}

/** How fine a pattern is drawn (`replace`: its own background shows between its lines). */
export const PATTERN_LOOK = { fillmode: "replace", size: 8, solidity: 0.3 };
/** How strong a patterned fill's tint is, of the fill's opacity. */
export const TINT = 0.4;

/** Each fill pattern as Plotly draws it. */
const PATTERN_SHAPES: Record<FillPattern, string> = {
  diagonal: "/",
  "back-diagonal": "\\",
  crosshatch: "x",
  horizontal: "-",
  vertical: "|",
  grid: "+",
  dots: ".",
};

/** The thickness an outline of none (0) takes when given a color, so the color shows. */
export const visibleOutline = (width: number, color: string) =>
  width === 0 && color !== SAME_AS_FILL ? 1.5 : undefined;

/** An outline's color: `chosen`, or with none (or `SAME_AS_FILL`) that of what it outlines. */
const outlineOf = (chosen: string | undefined, color: string) => (!chosen || chosen === SAME_AS_FILL ? color : chosen);

/** A series takes its color picked by hand, else the palette's for its place
 *  (`index` among `count`). */
export function paintOf(options: GraphOptions, count: number, order?: string[]): Paint {
  const palette = paletteOf(options);
  // A series takes its place in `order` (the table's series), so it keeps its color in a
  // graph showing only some of them; else its place in the graph.
  const place = (key: string, index: number) => {
    const at = order?.indexOf(key) ?? -1;
    return at >= 0 ? at : index;
  };
  const color = (key: string, index: number) =>
    options.series?.[key]?.color ?? paletteColor(palette, place(key, index), count);
  const shape = (key: string) => options.series?.[key]?.shape ?? options.pointShape;
  const outlineColor = (c: string, own?: string) => outlineOf(own ?? options.pointOutlineColor, c);
  const errorColor = (key: string, index: number) => options.errorColor ?? color(key, index);
  const fill = (key: string, index: number) => withOpacity(color(key, index), options.fill);
  const edge = (key: string, index: number) => ({
    color: outlineOf(options.outlineColor, color(key, index)),
    width: options.outline,
  });
  // Lines in the series' color over a light tint of it (its fill's strength), so they show.
  const pattern = (key: string, index: number) => {
    const name = options.series?.[key]?.pattern;
    const c = color(key, index);
    return (
      name && { shape: PATTERN_SHAPES[name], fgcolor: c, bgcolor: withOpacity(c, options.fill * TINT), ...PATTERN_LOOK }
    );
  };
  return {
    color,
    edge,
    line: (key, index) => ({
      color: color(key, index),
      width: options.lineWidth,
      dash: options.series?.[key]?.dash ?? options.lineDash,
    }),
    bars: (key, index) => {
      const over = pattern(key, index);
      return { color: fill(key, index), line: edge(key, index), ...(over && { pattern: over }) };
    },
    pattern,
    errorBars: (key, index, array, arrayminus?) => {
      // Only above (or right of) the value: none below, and no cap at its foot (`withCaps`).
      // An asymmetric error keeps its own lower side instead — unless the bars
      // go one way only, which has no lower side at all.
      const above = options.errorDirection === "above";
      return {
        type: "data",
        array,
        ...(above
          ? { symmetric: false, arrayminus: array.map(() => 0) }
          : arrayminus
            ? { symmetric: false, arrayminus }
            : {}),
        color: errorColor(key, index),
        thickness: options.errorWidth,
        width: above ? 0 : options.errorCaps,
      };
    },
    centerLine: (key, index) => ({ color: errorColor(key, index), width: options.errorWidth }),
    fill,
    dot: (key, index) => withOpacity(color(key, index), options.pointFill),
    shape,
    point: (pointKey, key, index) => {
      const own = options.points?.[pointKey];
      const c = own?.color ?? color(key, index);
      return {
        color: c,
        size: own?.size ?? options.pointSize,
        shape: own?.shape ?? shape(key),
        fill: own?.fill ?? options.pointFill,
        outline: own?.outline ?? options.pointOutline,
        outlineColor: outlineColor(c, own?.outlineColor),
      };
    },
    size: options.pointSize,
    outline: options.pointOutline,
    outlineColor,
  };
}

/** A series' point marker: its fill, shape, size and outline. */
export const seriesMarker = (paint: Paint, key: string, index: number) => ({
  color: paint.dot(key, index),
  size: paint.size,
  symbol: paint.shape(key),
  line: { color: paint.outlineColor(paint.color(key, index)), width: paint.outline },
});

/** A series' individual points, each (`pointKeys[i]`) with its own style — Plotly's
 *  marker color, size, symbol and outline accept a same-length array — and its key, so
 *  a click tells which point it was (`customdata`). */
export function seriesPoints(paint: Paint, key: string, index: number, pointKeys: string[]) {
  const styles = pointKeys.map((k) => paint.point(k, key, index));
  return {
    customdata: pointKeys,
    marker: {
      color: styles.map((s) => withOpacity(s.color, s.fill)),
      size: styles.map((s) => s.size),
      symbol: styles.map((s) => s.shape),
      line: { color: styles.map((s) => s.outlineColor), width: styles.map((s) => s.outline) },
    },
  };
}

/** A column's individual points at its place `i` on the axis, jittered, each styled. */
export function columnPoints(paint: Paint, c: Column, i: number) {
  return {
    type: "scatter",
    mode: "markers",
    x: c.values.map((_, vi) => i + jitter(i, vi)),
    y: c.values,
    ...seriesPoints(
      paint,
      c.name,
      i,
      c.rows.map((r) => pointKeyOf(c.name, r)),
    ),
    hoverinfo: "y",
  };
}

/** A trace as `withCaps` reads it. */
interface ErrorTrace {
  type: string;
  x: (number | string | null)[];
  y: (number | string | null)[];
  yaxis?: string;
  orientation?: string;
  width?: number;
  offsetgroup?: string;
  error_x?: { array: number[]; color: string; thickness: number };
  error_y?: { array: number[]; color: string; thickness: number };
}

/** The traces as an exported image draws them: WebGL ones (the volcano's genes, fast on
 *  screen) as plain shapes, sharp at any resolution and true vectors in an SVG. */
export function vectorTraces(data: unknown[]): unknown[] {
  return data.map((trace) =>
    (trace as { type?: string }).type === "scattergl" ? { ...(trace as object), type: "scatter" } : trace,
  );
}

/** A column's bar (its own trace, at its own x): every one in the same `offsetgroup`, so
 *  Plotly draws each at its x instead of setting them side by side (with their caps'
 *  twins, which share it). */
export const COLUMN_BAR = { type: "bar", width: 0.6, offsetgroup: "column" } as const;

/** The caps of error bars that go one way only: Plotly caps both ends, so those bars
 *  have none, and each such trace gets an invisible twin whose zero-long error bars, at
 *  their tips, are the caps. A bar's twin shares its place (`offsetgroup`). */
export function withCaps(data: unknown[], options: GraphOptions): unknown[] {
  if (options.errorDirection !== "above" || !options.errorCaps) return data;
  return (data as ErrorTrace[]).flatMap((trace, i) => {
    const key = trace.error_y ? "error_y" : trace.error_x ? "error_x" : null;
    if (!key) return [trace];
    const { array, color, thickness } = trace[key]!;
    const along = key === "error_y" ? "y" : "x";
    const tips = trace[along].map((v, j) => (typeof v === "number" ? v + array[j] : null));
    const bar = trace.type === "bar";
    const group = trace.offsetgroup ?? String(i);
    const twin = {
      type: trace.type,
      orientation: trace.orientation,
      x: trace.x,
      y: trace.y,
      ...(trace.yaxis ? { yaxis: trace.yaxis } : {}),
      [along]: tips,
      width: trace.width,
      ...(bar ? { offsetgroup: group } : { mode: "markers" }),
      marker: { color: "rgba(0,0,0,0)" },
      [key]: { type: "data", array: tips.map(() => 0), color, thickness, width: options.errorCaps },
      hoverinfo: "skip",
      showlegend: false,
    };
    return [bar ? { ...trace, offsetgroup: group } : trace, twin];
  });
}

/** The plot area's size in px, as the volcano's label placement estimates
 *  it: the figure minus the usual room for tick labels and axis titles.
 *  Label-placement fixes (Bland-Altman, biplot) convert data gaps to px
 *  with this instead of guessing the plot size. */
export const plotAreaPx = (options: GraphOptions) => ({
  width: options.width - 76,
  height: options.height - (options.title ? 44 : 16) - 52,
});

/** Smallest and largest value (a loop, safe for any number of points). */
export const extent = (v: number[]): [number, number] => [
  v.reduce((a, b) => Math.min(a, b), Infinity),
  v.reduce((a, b) => Math.max(a, b), -Infinity),
];

/** Pairs in ascending X order, so a connecting line (or the area beneath it)
 *  follows the data's trend instead of the table's row order: unsorted X
 *  draws a zigzag / self-overlapping fill, and disagrees in shape with the
 *  fitted overlays, which are plotted on a sorted grid. `rows`, when given,
 *  is permuted with the pairs, so point keys stay on their own points.
 *  The sort is stable, so equal X values keep their table order. */
export function sortPairsByX(
  x: number[],
  y: number[],
  rows: number[] = x.map((_, i) => i),
): { x: number[]; y: number[]; rows: number[] } {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  return { x: order.map((i) => x[i]), y: order.map((i) => y[i]), rows: order.map((i) => rows[i]) };
}

/** The graphs' font. */
const FONT = "system-ui, -apple-system, sans-serif";
// Texts are measured in it before drawing; where there is no page (the tests), estimated.
const measure = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");

/** The width a text of `fontSize` takes in the graphs' font, with a little room. */
export function textWidth(text: string, fontSize: number): number {
  if (!measure) return text.length * fontSize * 0.6 + 4;
  measure.font = `${fontSize}px ${FONT}`;
  return measure.measureText(text).width + 4;
}

// The texts that can be moved by hand: those with an arrow (the note's is invisible),
// so significance labels, which have none, stay on their brackets. Plotly reports where
// each was dropped; graph-view keeps it by the annotation's `name`.
export const MOVABLE = { annotationTail: true, legendPosition: true, colorbarPosition: true };

/** Which text Plotly says was moved (`moved`: its new place, by attribute, as
 *  "legend.x" or "annotations[2].ax"; `names`: each annotation's), and to where. */
export function movedText(moved: Record<string, number | undefined>, names: (string | undefined)[]) {
  const x = moved["legend.x"] ?? moved["colorbar.x"];
  const y = moved["legend.y"] ?? moved["colorbar.y"];
  if (x !== undefined && y !== undefined) return { name: "legend", at: { x, y } };
  const [, index] = Object.keys(moved)[0]?.match(/^annotations\[(\d+)\]\.a[xy]$/) ?? [];
  const name = index && names[Number(index)];
  const ax = moved[`annotations[${index}].ax`];
  const ay = moved[`annotations[${index}].ay`];
  return name && ax !== undefined && ay !== undefined ? { name, at: { x: ax, y: ay } } : null;
}

/** Adds a text note in the plot's emptiest corner (a fit's equation), or where it was moved.
 *  The corner is picked from the plotted points: the quadrant with the fewest
 *  of them, so a note up to ~7 lines long doesn't sit over the data. With
 *  nothing plotted (a "run the analysis first" prompt) every corner is empty
 *  and it stays top-left, as before. A fitted curve's dense grid counts the
 *  same as the points, so it can't by itself push the note into a corner the
 *  data fills. */
export function addNote(fig: GraphFigure, text: string, options: GraphOptions) {
  const corners = [
    { x: 0.02, y: 0.98, xanchor: "left", yanchor: "top" },
    { x: 0.98, y: 0.98, xanchor: "right", yanchor: "top" },
    { x: 0.02, y: 0.02, xanchor: "left", yanchor: "bottom" },
    { x: 0.98, y: 0.02, xanchor: "right", yanchor: "bottom" },
  ];
  let corner = corners[0];
  const pts: [number, number][] = [];
  for (const t of fig.data as { x?: unknown; y?: unknown }[]) {
    if (!Array.isArray(t.x) || !Array.isArray(t.y)) continue;
    for (let i = 0; i < Math.min(t.x.length, t.y.length); i++) {
      const x = t.x[i];
      const y = t.y[i];
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) pts.push([x, y]);
    }
  }
  if (pts.length) {
    const [x0, x1] = extent(pts.map((p) => p[0]));
    const [y0, y1] = extent(pts.map((p) => p[1]));
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const counts = [0, 0, 0, 0];
    for (const [x, y] of pts) counts[y >= my ? (x < mx ? 0 : 1) : (x < mx ? 2 : 3)]++;
    let best = 0;
    for (let i = 1; i < 4; i++) if (counts[i] < counts[best]) best = i;
    corner = corners[best];
  }
  fig.layout.annotations = [
    ...((fig.layout.annotations as unknown[]) ?? []),
    {
      name: "note",
      xref: "paper",
      yref: "paper",
      x: corner.x,
      y: corner.y,
      xanchor: corner.xanchor,
      yanchor: corner.yanchor,
      align: "left",
      showarrow: true,
      arrowcolor: "rgba(0,0,0,0)",
      ax: options.note?.x ?? 0,
      ay: options.note?.y ?? 0,
      text,
      font: { color: INK, size: Math.max(options.fontSize - 1, 8) },
    },
  ];
}

/** The on-canvas prompt for a graph whose sibling analysis isn't linked: what
 *  to run to draw it, instead of bare axes (G-F7). Null for a graph that
 *  draws from its table alone — it never needs a sibling analysis. */
export function unlinkedAnalysisNote(graphType: GraphType): string | null {
  switch (graphType) {
    case "schild-plot":
      return "Run a Gaddum/Schild analysis on this table to draw the Schild plot.";
    case "smooth-curve":
      return "Run a Spline and Lowess analysis on this table to draw the smooth curve.";
    case "forest-plot":
      return "Run a Cox proportional hazards analysis on this table to draw the forest plot.";
    case "estimation-plot":
      return "Run a Compare two groups analysis on this table to draw the difference between means with its 95% CI.";
    case "observed-fitted":
      return "Run a Poisson regression on this table to draw the observed-vs-fitted plot.";
    case "scree-plot":
      return "Run a Principal component analysis on this table to draw the scree plot.";
    case "monte-carlo-histogram":
      return "Run a Monte Carlo simulation on this table to draw the histogram.";
    case "pca-biplot":
      return "Run a Principal component analysis on this table to draw the scores biplot.";
    case "kmeans-scatter":
      return "Run a K-means clustering on this table to draw the cluster scatter.";
    case "dendrogram":
      return "Run a Hierarchical clustering on this table to draw the dendrogram.";
    case "elbow-plot":
      return "Run a Hierarchical clustering on this table to draw the Elbow plot.";
    case "silhouette-plot":
      return "Run a Hierarchical clustering on this table to draw the Silhouette plot.";
    case "gap-plot":
      return "Run a Hierarchical clustering on this table to draw the Gap plot.";
    default:
      return null;
  }
}

/** Which Axes-section range rows the Format panel offers for a graph: a
 *  categorical axis takes no min/max (G-F8) — the scree plot's X is its
 *  components, the forest plot's Y its covariates — so the row is not
 *  offered at all instead of silently ignoring what the user types. Every
 *  other graph offers both rows; whether a typed bound takes effect is the
 *  builder's business (fixed-range graphs honour it, see roc-curve.ts). */
export function axesRangeInputs(graphType: GraphType): { x: boolean; y: boolean } {
  if (graphType === "scree-plot") return { x: false, y: true };
  if (graphType === "dendrogram") return { x: false, y: true };
  if (graphType === "forest-plot") return { x: true, y: false };
  return { x: true, y: true };
}

/** Whether the Format panel offers a Linear/Log10/Log2 Scale row for each
 *  axis of this graph. An ROC curve lives on [0, 1] on both axes, where a
 *  log scale is meaningless (#151): on a log axis the forced [0, 1] range
 *  reads as [1, 10] in data values, so the whole curve falls outside the
 *  window — and the (0,0)/(1,1) anchors have no log at all. Every other
 *  graph offers both rows (the Y row is further gated by family in the
 *  panel: heatmap and volcano have no Y scale). */
export function logScaleOffered(graphType: GraphType): { x: boolean; y: boolean } {
  if (graphType === "roc-curve") return { x: false, y: false };
  return { x: true, y: true };
}

/** A point's name (`key`, see `pointKeyOf`) at `offset` px from it, joined to it by a
 *  thin line once it's moved away from a point `size` px wide. */
export const pointName = (
  key: string,
  x: number,
  y: number,
  text: string,
  offset: Place,
  size: number,
  fontSize: number,
) => ({
  name: key,
  x,
  y,
  xref: "x",
  yref: "y",
  text,
  showarrow: true,
  arrowhead: 0,
  arrowwidth: 0.5,
  arrowcolor: GUIDE,
  standoff: size / 2,
  ax: offset.x,
  ay: offset.y,
  font: { color: INK, size: fontSize },
});

/** Center value per column (mean or median). */
export const centers = (cols: Column[], center: GraphOptions["center"]) =>
  cols.map((c) => (center === "median" ? median(c.values) : mean(c.values)));

/** The error of `v`: its SD, its SEM, or the half-width of its mean's 95% CI (t × SEM). */
export const errorOf = (v: number[], kind: GraphOptions["error"]) =>
  kind === "sem" ? sem(v) : kind === "ci" ? (v.length < 2 ? 0 : tCrit95(v.length - 1) * sem(v)) : sd(v);

/** A Y data set of an XY graph, as drawn: each value where X has one, keyed so it can be
 *  picked and styled; or, for replicates shown as their center (`xyReplicates`), each X's
 *  center (mean or median) and its error (none when error bars are off). */
export function xyDrawn(
  x: Column,
  set: DataSet,
  options: GraphOptions,
): { x: number[]; y: number[]; keys?: string[]; errors?: number[] } {
  if (set.columns.length === 1 || options.xyReplicates === "each") {
    const points = xyPoints(x, set);
    return { x: points.x, y: points.y, keys: points.rows.map((r, i) => pointKeyOf(points.columns[i], r)) };
  }
  const rows = xyRows(x, set);
  return {
    x: rows.x,
    y: rows.values.map((v) => (options.center === "median" ? median(v) : mean(v))),
    ...(options.error === "none"
      ? {}
      : { errors: rows.values.map((v) => (v.length < 2 ? 0 : errorOf(v, options.error))) }),
  };
}

/** Error magnitude per column (SD, SEM or 95% CI), or null when error is off. */
export const errors = (cols: Column[], kind: GraphOptions["error"]) =>
  kind === "none" ? null : cols.map((c) => errorOf(c.values, kind));

/** Deterministic jitter in [-0.15, 0.15] so points don't jump on option changes. */
export const jitter = (col: number, i: number) => {
  const s = Math.sin(col * 131.7 + i * 977.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.3;
};

/** The least space around the plot area. Every axis has `automargin`, so Plotly
 *  widens it just enough for tick labels and axis titles — but automargin does
 *  NOT cover a legend or colorbar placed outside the plot area, so those
 *  reserve their own room (see `legendRightMargin`) instead of relying on it. */
export const marginsFor = (options: GraphOptions) => ({ l: 16, r: 16, t: options.title ? 44 : 16, b: 16 });

/** Width in px a legend needs past the plot's right edge: its marker + gap
 *  plus the longest series name at the graph's font size. Capped so one very
 *  long name doesn't eat the plot — the user can still drag the legend inside. */
const LEGEND_MARKER_PX = 24;
const LEGEND_MAX_PX = 260;
export const legendWidthPx = (names: string[], fontSize: number): number =>
  names.length === 0
    ? 0
    : Math.min(
        LEGEND_MARKER_PX + Math.ceil(Math.max(...names.map((n) => n.length)) * fontSize * 0.6) + 8,
        LEGEND_MAX_PX,
      );

/** The right margin a layout needs when its legend is shown outside the plot
 *  at its default spot: the 1.02 offset (~2% of the plot, ~12 px at usual
 *  widths) plus the legend's own width. A legend the user dragged inside
 *  (x < 1) needs no room. With no names to measure, reserve a typical
 *  legend's width rather than clipping. */
const LEGEND_OFFSET_PX = 12;
export const legendRightMargin = (options: GraphOptions, names: string[]): number => {
  const x = options.legend?.x ?? 1.02;
  if (x < 1) return 16;
  return Math.max(16, LEGEND_OFFSET_PX + (names.length ? legendWidthPx(names, options.fontSize) : 120));
};

/** Page skeleton shared by every graph family (background, static-chart dragmode,
 *  font, margins, title) — only the axis shape differs per family. `rightMargin`
 *  overrides the right margin where a legend or colorbar needs the room (M13). */
function chromeLayout(options: GraphOptions, rightMargin?: number): Record<string, unknown> {
  const background = options.background === "transparent" ? "rgba(0,0,0,0)" : "#ffffff";
  return {
    paper_bgcolor: background,
    plot_bgcolor: background,
    // Static chart (Prism-style): no box-zoom, no pan. Resizing the graph box
    // rescales the whole plot, so the axes/bars resize instead of adding space.
    dragmode: false,
    font: { color: INK, family: FONT, size: options.fontSize },
    margin: rightMargin == null ? marginsFor(options) : { ...marginsFor(options), r: rightMargin },
    // xref: "paper" centers over the plot area (inside the margins), matching where the
    // X-axis title centers — the default "container" ref centers over the whole figure
    // width instead, which drifts off-center since the Y labels widen the left margin.
    ...(options.title
      ? {
          title: {
            text: options.title,
            font: { size: options.fontSize + 3 },
            xref: "paper",
            x: 0.5,
            xanchor: "center",
          },
        }
      : {}),
  };
}

/** The legend, right of the plot, or where it was moved. */
const legendOf = (options: GraphOptions) => ({ x: 1.02, y: 1, xanchor: "left", ...options.legend });

/** An axis's title, `gap` px from its tick labels; none without text. */
const axisTitle = (text: string, gap: number) => (text ? { title: { text, standoff: gap } } : {});

/** Axis min/max/step config shared by every graph family/axis. Full explicit range when
 *  both bounds are set; otherwise let Plotly keep auto-scaling the unset side while
 *  `autorangeoptions` clamps the set one — so typing just a Max (or just a Min) takes
 *  effect immediately, independently. */
function axisRange(min?: number, max?: number, step?: number, zeroBase?: boolean): Record<string, unknown> {
  const hasMin = min != null;
  const hasMax = max != null;
  const range =
    hasMin && hasMax
      ? { range: [min, max], autorange: false }
      : {
          ...(zeroBase ? { rangemode: "tozero" } : {}),
          ...(hasMin || hasMax
            ? {
                autorangeoptions: {
                  ...(hasMin ? { minallowed: min } : {}),
                  ...(hasMax ? { maxallowed: max } : {}),
                },
              }
            : {}),
        };
  return { ...range, ...(step != null ? { dtick: step, tick0: min ?? 0 } : {}) };
}

/** Shared axis chrome spread into every family's axes: a minimalist spine +
 *  outward ticks (gridlines off unless the axis asks for them), non-interactive,
 *  at the user's Appearance thickness — so changing thickness affects every
 *  axis line and every tick uniformly. `grid` is that axis's gridlines choice. */
export const GRID_MAJOR_COLOR = "#E5E7EB";
export const GRID_MINOR_COLOR = "#F3F4F6";
function axisChrome(options: GraphOptions, grid: GraphOptions["gridX"] = "none"): Record<string, unknown> {
  const ticks = options.tickDirection === "none" ? "" : options.tickDirection;
  return {
    showgrid: grid !== "none",
    ...(grid !== "none" ? { gridcolor: GRID_MAJOR_COLOR, gridwidth: 1 } : {}),
    ...(grid === "major-minor"
      ? {
          minor: {
            showgrid: true,
            gridcolor: GRID_MINOR_COLOR,
            gridwidth: 1,
            ticks,
            ticklen: Math.max(options.tickLength - 2, 0),
          },
        }
      : {}),
    zeroline: false,
    linecolor: INK,
    linewidth: options.axisWidth,
    ticks,
    ticklen: options.tickLength,
    tickwidth: options.axisWidth,
    fixedrange: true,
    automargin: true,
  };
}

/** A power's tick label: written out from 0.000001 to 1000000 while short (8 characters
 *  at most), so an axis is all figures or, beyond, all powers, never a mix in practice. */
function powerLabel(v: number, base: number): string {
  const k = Math.round(Math.log(v) / Math.log(base));
  const plain = String(Number(v.toPrecision(6)));
  return v >= 1e-6 && v <= 1e6 && plain.length <= 8 ? plain : `${base}<sup>${k}</sup>`;
}

const POWERS = Array.from({ length: 81 }, (_, i) => i - 40);

/** `steps + 1` X values from `lo` to `hi` for drawing a curve: evenly spaced, or evenly
 *  spaced in log on a log X axis (from the smallest X above 0), so it stays smooth there. */
export function curveXs(xs: number[], scale: GraphOptions["xScale"], steps: number): number[] {
  const positive = xs.filter((x) => x > 0);
  const log = scale !== "linear" && positive.length > 0;
  const [lo, hi] = log ? extent(positive).map(Math.log10) : extent(xs);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = lo + ((hi - lo) * i) / steps;
    return log ? 10 ** t : t;
  });
}

/** A logarithmic axis: ticks at the powers of `base` (only those in range show), small
 *  ticks between the powers of 10, and its range typed in real values (above 0). Values
 *  at or under 0 have no place on it: Plotly leaves them out (the Format panel says how
 *  many). No step: the ticks are the powers. With `major-minor` gridlines, the minor
 *  gridlines follow the small ticks (base 10 only — base 2 has no minor ticks). */
function logAxis(
  scale: "log10" | "log2",
  min?: number,
  max?: number,
  grid: GraphOptions["gridX"] = "none",
  tickDirection: GraphOptions["tickDirection"] = "outside",
): Record<string, unknown> {
  const base = scale === "log2" ? 2 : 10;
  const ticks = POWERS.map((k) => base ** k);
  const at = (v?: number) => (v != null && v > 0 ? Math.log10(v) : undefined);
  const [lo, hi] = [at(min), at(max)];
  return {
    type: "log",
    tickmode: "array",
    tickvals: ticks,
    ticktext: ticks.map((v) => powerLabel(v, base)),
    ...(base === 10
      ? {
          minor: {
            tickvals: POWERS.flatMap((k) => [2, 3, 4, 5, 6, 7, 8, 9].map((d) => d * 10 ** k)),
            ticklen: 3,
            // The minor object replaces axisChrome's (spread later), so it must
            // carry the tick direction itself — otherwise "none" still draws them.
            ticks: tickDirection === "none" ? "" : tickDirection,
            ...(grid === "major-minor" ? { showgrid: true, gridcolor: GRID_MINOR_COLOR, gridwidth: 1 } : {}),
          },
        }
      : {}),
    ...(lo != null && hi != null
      ? { range: [lo, hi], autorange: false }
      : lo != null || hi != null
        ? { autorangeoptions: { ...(lo != null ? { minallowed: lo } : {}), ...(hi != null ? { maxallowed: hi } : {}) } }
        : {}),
  };
}

/** The value axis's scale and range: linear (from 0 when `zeroBase`, for bars), or log. */
const yAxisRange = (options: GraphOptions, zeroBase?: boolean, grid: GraphOptions["gridX"] = "none") =>
  options.yScale === "linear"
    ? axisRange(options.yMin, options.yMax, options.yStep, zeroBase)
    : logAxis(options.yScale, options.yMin, options.yMax, grid, options.tickDirection);
/** The right axis's scale and range, independent of the left's. */
const y2AxisRange = (options: GraphOptions, zeroBase?: boolean) =>
  options.y2Scale === "linear"
    ? axisRange(options.y2Min, options.y2Max, options.y2Step, zeroBase)
    : logAxis(options.y2Scale, options.y2Min, options.y2Max);
const xAxisRange = (options: GraphOptions, zeroBase?: boolean, grid: GraphOptions["gridX"] = "none") =>
  options.xScale === "linear"
    ? axisRange(options.xMin, options.xMax, options.xStep, zeroBase)
    : logAxis(options.xScale, options.xMin, options.xMax, grid, options.tickDirection);

/** Where a label goes on an axis of this scale: Plotly places shapes and traces at
 *  their values, but texts (annotations) at the log10 of them on a log axis. */
export const onAxis = (v: number, scale: GraphOptions["xScale"]) => (scale === "linear" ? v : Math.log10(v));

/** Boxes at `x`, one per list of values, as Helix computes them (`boxOf`: the quartiles of
 *  Descriptive statistics, whiskers to the minimum and maximum): Plotly only draws them. */
export function boxTrace(x: number[], values: number[][]) {
  const boxes = values.map(boxOf);
  const field = (k: keyof (typeof boxes)[number]) => boxes.map((b) => b[k]);
  return {
    x,
    q1: field("q1"),
    median: field("median"),
    q3: field("q3"),
    lowerfence: field("lowerfence"),
    upperfence: field("upperfence"),
  };
}

/** Where a reference line's text sits: at the line's end (`place`'s right or left: the
 *  plot's right or left edge; on a vertical line, its top or bottom), on the side the
 *  place says (top: above a horizontal line, right of a vertical one), at `at` on the axis. */
function labelAt(place: RefLabelPlace, at: number, vertical: boolean) {
  const [top, right] = [place.startsWith("top"), place.endsWith("right")];
  return vertical
    ? {
        x: at,
        y: top ? 1 : 0,
        xanchor: right ? "left" : "right",
        yanchor: top ? "top" : "bottom",
        xshift: right ? 3 : -3,
      }
    : {
        x: right ? 1 : 0,
        y: at,
        xanchor: right ? "right" : "left",
        yanchor: top ? "bottom" : "top",
        yshift: top ? 1 : -1,
      };
}

/** Reference lines across the plot at values of its value axis (Y; X when `horizontal`):
 *  Plotly shapes at their values, their texts at their end, at the log10 of the value on a
 *  log axis (`onAxis`); a value a log axis can't show (0 and under) isn't drawn. */
export function refLineParts(
  options: GraphOptions,
  horizontal: boolean,
): { shapes: unknown[]; annotations: unknown[] } {
  const lines = (options.refLines ?? []).filter((l) => options.yScale === "linear" || l.value > 0);
  const [value, across] = horizontal ? (["x", "y"] as const) : (["y", "x"] as const);
  return {
    shapes: lines.map((l) => ({
      type: "line",
      [`${across}ref`]: "paper",
      [`${across}0`]: 0,
      [`${across}1`]: 1,
      [`${value}ref`]: value,
      [`${value}0`]: l.value,
      [`${value}1`]: l.value,
      line: { color: l.color ?? INK, width: l.width, dash: l.dash },
      layer: "above",
    })),
    annotations: lines
      .filter((l) => l.label)
      .map((l) => ({
        text: l.label,
        showarrow: false,
        font: { family: FONT, size: options.fontSize, color: l.color ?? INK },
        [`${across}ref`]: "paper",
        [`${value}ref`]: value,
        ...labelAt(l.labelPlace ?? "top-right", onAxis(l.value, options.yScale), horizontal),
      })),
  };
}

/** Common white publication-style layout; numeric x with column-name ticks (Column family). */
export function baseLayout(
  options: GraphOptions,
  names: string[],
  opts: { zeroBase?: boolean } = {},
): Record<string, unknown> {
  return {
    ...chromeLayout(options),
    showlegend: false,
    xaxis: {
      tickmode: "array",
      tickvals: names.map((_, i) => i),
      ticktext: names,
      // Labels turn straight to vertical as the graph narrows: at Plotly's 30° step the
      // last one would slip off the right edge and be dropped.
      autotickangles: [0, 90],
      // Symmetric half-unit padding so categories never hug the Y axis (uniform across graph types).
      range: [-0.5, names.length - 0.5],
      ...axisChrome(options, options.gridX),
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      // Gridlines only when the axis asks for them (off by default).
      ...axisChrome(options, options.gridY),
      ...yAxisRange(options, opts.zeroBase, options.gridY),
      ...axisTitle(options.yLabel, options.yTitleGap),
    },
  };
}

/** Pie/donut layout: the shared chrome (background, font, title, margins) with no
 *  cartesian axes. Slice labels are drawn on the pie itself, so the legend stays off. */
export function pieLayout(options: GraphOptions): Record<string, unknown> {
  return { ...chromeLayout(options), showlegend: false };
}

/** Heatmap layout: two categorical axes (columns = variables, rows = table row
 *  order), reversed on Y so row 1 sits at the top like the table itself. The
 *  colorscale legend needs its own room past the right edge (M13): Plotly's
 *  default bar (30 px) plus its numeric tick labels plus the 1.02 offset. */
const COLORBAR_PX = 30 + 36 + 12;
export function heatmapLayout(options: GraphOptions, colNames: string[], rowNames: string[]): Record<string, unknown> {
  const colorbarOutside = options.heatmapShowScale && (options.legend?.x ?? 1.02) >= 1;
  return {
    ...chromeLayout(options, colorbarOutside ? Math.max(16, COLORBAR_PX) : undefined),
    showlegend: false,
    xaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: colNames,
      autotickangles: [0, 90],
      ...axisChrome(options, options.gridX),
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      type: "category",
      categoryorder: "array",
      categoryarray: rowNames,
      autorange: "reversed",
      ...axisChrome(options, options.gridY),
      ...axisTitle(options.yLabel, options.yTitleGap),
    },
  };
}

/** The data set plotted on the right Y axis: the named one, only when it is
 *  among `names` and there are at least two — anything else (a stale or
 *  renamed name, a single data set) falls back to the left axis. */
export function rightYDataset(options: GraphOptions, names: string[]): string | undefined {
  return names.length >= 2 && options.rightYDataset && names.includes(options.rightYDataset)
    ? options.rightYDataset
    : undefined;
}

/** The right-hand Y axis's layout: overlaid on the left axis, on the right
 *  side, titled with its data set's name unless titled by hand, scaled and
 *  ranged independently of the left axis. Follows the scree plot's hardcoded
 *  `yaxis2` precedent (scree-plot.ts) — this is the general one. */
export function rightYAxis(options: GraphOptions, dataset: string, zeroBase?: boolean): Record<string, unknown> {
  return {
    overlaying: "y",
    side: "right",
    ...axisChrome(options),
    ...y2AxisRange(options, zeroBase),
    ...axisTitle(options.y2Label || dataset, options.yTitleGap),
  };
}

/** XY family layout: a genuine numeric X axis (not category ticks), with a legend
 *  once there's more than one Y series. `xName` (the X column's name) and `yName`
 *  title the axes the user hasn't titled. The legend's series names reserve the
 *  right margin (M13) so the legend isn't clipped at the figure edge. */
export function xyLayout(
  options: GraphOptions,
  xName: string,
  seriesCount: number,
  opts: { zeroBase?: boolean; yName?: string; seriesNames?: string[]; rightY?: string } = {},
): Record<string, unknown> {
  return {
    ...chromeLayout(options, seriesCount > 1 ? legendRightMargin(options, opts.seriesNames ?? []) : undefined),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
    xaxis: {
      type: "linear",
      ...axisChrome(options, options.gridX),
      ...xAxisRange(options, undefined, options.gridX), // type "log" when X is on a log scale
      ...axisTitle(options.xLabel || xName, options.xTitleGap),
    },
    yaxis: {
      ...axisChrome(options, options.gridY),
      ...yAxisRange(options, opts.zeroBase, options.gridY),
      ...axisTitle(options.yLabel || (opts.yName ?? ""), options.yTitleGap),
    },
    ...(opts.rightY ? { yaxis2: rightYAxis(options, opts.rightY, opts.zeroBase) } : {}),
  };
}

// ── Grouped family ────────────────────────────────────────────────────────
// A grouped table stores `groups × replicates` sub-columns ("A:Y1", "A:Y2",
// "B:Y1", …); rows are the X categories and each group is a legend series
// (see `groupsOf`). These helpers summarise each group's replicates per row.

/** Number of data rows (X categories) — the last row (1-based) holding a number
 *  in any column, so the axis stops at the real data. */
export const rowCountOf = (columns: Column[]) => Math.max(0, ...columns.map((c) => (c.rows.at(-1) ?? -1) + 1));

/** The rows' labels on the category axis: each row's title, as in Prism, or its
 *  number when it has none. A repeated title stays a separate category. */
export function rowLabels(rows: number, titles: (string | null)[] = []): string[] {
  const seen = new Map<string, number>();
  return Array.from({ length: rows }, (_, i) => {
    const label = titles[i]?.trim() || String(i + 1);
    const repeat = seen.get(label) ?? 0;
    seen.set(label, repeat + 1);
    return label + "​".repeat(repeat); // an invisible mark keeps repeats apart
  });
}

/** Group `g`'s replicate values at row `r` (numeric cells only). */
function groupRow(cols: Column[], r: number): number[] {
  return cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
}

/** Per-row center (mean/median) and optional error (SD/SEM) for one group.
 *  `center[r]` is null where the group has no data in that row (leaves a gap);
 *  `error[r]` where it has a single value (no error bar, as in Prism). */
export function perRowStats(
  cols: Column[],
  rows: number,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
): { center: (number | null)[]; error: (number | null)[] | null } {
  const c: (number | null)[] = [];
  const e: (number | null)[] | null = error === "none" ? null : [];
  for (let r = 0; r < rows; r++) {
    const v = groupRow(cols, r);
    if (v.length === 0) {
      c.push(null);
      if (e) e.push(null);
      continue;
    }
    c.push(center === "median" ? median(v) : mean(v));
    if (e) e.push(v.length < 2 ? null : errorOf(v, error));
  }
  return { center: c, error: e };
}

/** Per-row center and error for one group of a summary table: the center is
 *  the stored Mean; the error is the stored error, converted to the graph's
 *  error kind exactly via N when N is present (SD ↔ SEM), or the 95% CI
 *  half-width (t × SEM) when N ≥ 2. A conversion that needs an N the format
 *  doesn't store (Mean, SD with SEM or CI asked) has no error bar — a null
 *  there, never a guessed number. `errorMinus` carries the lower side for the
 *  asymmetric formats (Mean, +error, −error and Mean, upper, lower limits),
 *  whose upper and lower errors differ; it is null for the symmetric ones.
 *  `center[r]` is null where the group has no Mean in that row. */
export function perRowSummaryStats(
  cols: Column[],
  rows: number,
  format: SummaryFormat,
  error: GraphOptions["error"],
): { center: (number | null)[]; error: (number | null)[] | null; errorMinus: (number | null)[] | null } {
  const def = summaryFormatDef(format);
  const suffixOf = (name: string) => name.slice(name.indexOf(":") + 1);
  const col = (suffix: string) => cols.find((c) => suffixOf(c.name) === suffix);
  const meanCol = col("Mean");
  const nCol = col("N");
  const center: (number | null)[] = [];
  const err: (number | null)[] | null = error === "none" ? null : [];
  const errMinus: (number | null)[] | null = error === "none" ? null : [];
  for (let r = 0; r < rows; r++) {
    const m = meanCol?.byRow[r] ?? null;
    center.push(m);
    if (!err || !errMinus) continue;
    if (m == null) {
      err.push(null);
      errMinus.push(null);
      continue;
    }
    const n = nCol?.byRow[r] ?? null;
    if (def.errorKind === "plus-minus") {
      err.push(col("+error")?.byRow[r] ?? null);
      errMinus.push(col("−error")?.byRow[r] ?? null);
      continue;
    }
    if (def.errorKind === "upper-lower") {
      const upper = col("Upper limit")?.byRow[r] ?? null;
      const lower = col("Lower limit")?.byRow[r] ?? null;
      err.push(upper == null ? null : upper - m);
      errMinus.push(lower == null ? null : m - lower);
      continue;
    }
    // The stored error, as an SD: SD itself, SEM × √N, or CV% of the mean.
    const stored = def.errorKind === "sd" ? col("SD")?.byRow[r] ?? null : def.errorKind === "sem" ? col("SEM")?.byRow[r] ?? null : col("CV")?.byRow[r] ?? null;
    const asSd =
      stored == null
        ? null
        : def.errorKind === "sem"
          ? n == null
            ? null
            : stored * Math.sqrt(n)
          : def.errorKind === "cv"
            ? (stored / 100) * m
            : stored;
    const asSem =
      asSd == null ? null : def.errorKind === "sem" ? stored : n == null ? null : asSd / Math.sqrt(n);
    err.push(
      error === "sd" ? asSd : error === "sem" ? asSem : n == null || n < 2 || asSem == null ? null : tCrit95(n - 1) * asSem,
    );
    errMinus.push(null);
  }
  return { center, error: err, errorMinus: errMinus?.every((v) => v == null) ? null : errMinus };
}

/** A data set as one column: on each row, the center (mean or median) of its values.
 *  A set of one column is that column. */
export function centerColumn({ name, columns }: DataSet, center: GraphOptions["center"]): Column {
  if (columns.length === 1 && columns[0].name === name) return columns[0];
  const byRow = perRowStats(columns, rowCountOf(columns), center, "none").center;
  const rows = byRow.flatMap((v, r) => (v == null ? [] : [r]));
  return {
    name,
    cells: byRow.map((v) => (v == null ? null : String(v))),
    byRow,
    values: rows.map((r) => byRow[r]!),
    rows,
  };
}

/** A data set's Mean column (a summary table's group), if it has one — what a
 *  heatmap plots, instead of `centerColumn` (which would average Mean/SD/N). */
export function summaryMeanColumn({ columns }: DataSet): Column | undefined {
  return columns.find((c) => c.name.slice(c.name.indexOf(":") + 1) === "Mean");
}

/** Horizontal offset of group `g` within a row's slot, so interleaved scatter
 *  points fan out per group across [-0.28, 0.28] (bars use Plotly's own barmode). */
export const groupOffset = (g: number, total: number) => (total <= 1 ? 0 : -0.28 + (0.56 * g) / (total - 1));

interface SeparatedAxis {
  posOf: (group: number, row: number) => number;
  tickvals: number[];
  ticktext: string[];
  range: [number, number];
}

/** Category positions for the "Separated" arrangement: each group gets its own
 *  block of `rows` slots (with a 1-slot gap between blocks) instead of sharing
 *  a slot per row, so groups sit side by side rather than interleaved. Ticks
 *  repeat the row labels once per block. */
export function separatedPositions(groups: number, labels: string[]): SeparatedAxis {
  const gap = 1;
  const rows = labels.length;
  const blockWidth = rows + gap;
  const tickvals: number[] = [];
  const ticktext: string[] = [];
  for (let g = 0; g < groups; g++) {
    for (let r = 0; r < rows; r++) {
      tickvals.push(g * blockWidth + r);
      ticktext.push(labels[r]);
    }
  }
  return {
    posOf: (g, r) => g * blockWidth + r,
    tickvals,
    ticktext,
    range: [-0.5, groups * blockWidth - gap - 0.5],
  };
}

/** Bar layout for the grouped family: a category axis for the rows and a numeric
 *  value axis, swapped when `horizontal`. The value axis reuses the Y-scale
 *  options; the category axis reuses the X-axis label. The legend's group names
 *  reserve the right margin (M13) so the legend isn't clipped at the figure edge. */
export function groupedBarLayout(
  options: GraphOptions,
  seriesCount: number,
  opts: { horizontal?: boolean; separated?: SeparatedAxis; seriesNames?: string[] } = {},
): Record<string, unknown> {
  // The grid choice follows the PHYSICAL axis: when horizontal, the value axis
  // sits on X and the category axis on Y, so the choices swap with them.
  const valueGrid = opts.horizontal ? options.gridX : options.gridY;
  const categoryGrid = opts.horizontal ? options.gridY : options.gridX;
  const value = {
    ...axisChrome(options, valueGrid),
    ...yAxisRange(options, true, valueGrid),
    ...axisTitle(options.yLabel, options.yTitleGap),
  };
  // Separated blocks need numeric positions with gaps between them, so they use
  // explicit tick placement instead of Plotly's evenly-spaced "category" axis.
  const category = {
    ...(opts.separated
      ? {
          tickmode: "array",
          tickvals: opts.separated.tickvals,
          ticktext: opts.separated.ticktext,
          range: opts.separated.range,
        }
      : { type: "category" }),
    ...axisChrome(options, categoryGrid),
    ...axisTitle(options.xLabel, options.xTitleGap),
  };
  return {
    ...chromeLayout(options, seriesCount > 1 ? legendRightMargin(options, opts.seriesNames ?? []) : undefined),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
    xaxis: opts.horizontal ? value : category,
    yaxis: opts.horizontal ? category : value,
  };
}

/** Scatter layout for the grouped family: a numeric X axis with row-number ticks
 *  (so groups can be offset within each row) and a legend once there's >1 group. */
export function groupedScatterLayout(
  options: GraphOptions,
  labels: string[],
  seriesCount: number,
  separated?: SeparatedAxis,
  seriesNames: string[] = [],
): Record<string, unknown> {
  return {
    ...chromeLayout(options, seriesCount > 1 ? legendRightMargin(options, seriesNames) : undefined),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
    xaxis: {
      tickmode: "array",
      tickvals: separated ? separated.tickvals : labels.map((_, i) => i),
      ticktext: separated ? separated.ticktext : labels,
      range: separated ? separated.range : [-0.5, labels.length - 0.5],
      ...axisChrome(options, options.gridX),
      ...axisTitle(options.xLabel, options.xTitleGap),
    },
    yaxis: {
      ...axisChrome(options, options.gridY),
      ...yAxisRange(options, undefined, options.gridY),
      ...axisTitle(options.yLabel, options.yTitleGap),
    },
  };
}
