// What every graph shares: how its series are painted (`Paint`), the statistics it
// draws (centers, errors), and the Plotly layout of each family.
import {
  SAME_AS_FILL,
  type AxisNumberFormat,
  type FillPattern,
  type GraphOptions,
  type GraphType,
  type LineDash,
  type Place,
  type PointShape,
  type PointStyle,
  type RefLabelPlace,
  type SeriesStyle,
} from "../../store/types";
import { xyPoints, xyRows, type Column, type DataSet } from "../../lib/dataset";
import { pointKeyOf } from "../../lib/columns";
import type { GraphFigure } from ".";
import { dateAxisTicksForValues, elapsedAxisTicksForValues } from "../../lib/axis-dates";
import type { XConversion } from "../../lib/date-time";
import { paletteColor, paletteOf, withOpacity } from "../../lib/palettes";
import { boxOf, geometricCi, geometricMean, geometricSdFactor, mean, median, quantile, sd, sem } from "../../lib/summary";
import { summaryFormatDef, type SummaryFormat } from "../../lib/summary-format";
import { tCrit95 } from "../../lib/student-t";
import { parseCell } from "../../lib/numeric";

/** The axes of most graphs: categories along X, values up Y; of XY graphs, values on both. */
export const CATEGORY_AXES = () => ({ x: "labels", y: "scale" }) as const;
export const XY_AXES = () => ({ x: "scale", y: "scale" }) as const;

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
/** A column's individual points, spread sideways per `style` (classic = the
 *  legacy jitter exactly). */
export function columnPoints(
  paint: Paint,
  c: Column,
  i: number,
  style: GraphOptions["scatterStyle"] = "classic",
) {
  const offs = scatterOffsets(c.values, style, i);
  return {
    type: "scatter",
    mode: "markers",
    x: c.values.map((_, vi) => i + offs[vi]),
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

/** Smallest value (a loop, safe for any number of points). */
export const minOf = (v: number[]): number => v.reduce((a, b) => Math.min(a, b), Infinity);

/** Largest value (a loop, safe for any number of points). */
export const maxOf = (v: number[]): number => v.reduce((a, b) => Math.max(a, b), -Infinity);

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
export const FONT = "system-ui, -apple-system, sans-serif";
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
    case "covariance-heatmap":
      return "Run a Multiple regression on this table to draw the covariance heatmap.";
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
  // A forest plot's Y is its covariate names, not values: no log scale there.
  if (graphType === "forest-plot") return { x: true, y: false };
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

/** One group's center value: mean, median, or geometric mean. An undefined
 *  geometric mean (a zero or negative value) is NaN, like `mean([])` — the
 *  graph draws no point there, never a wrong one. */
export const centerOf = (v: number[], center: GraphOptions["center"]) =>
  center === "median" ? median(v) : center === "geomean" ? (geometricMean(v) ?? NaN) : mean(v);

/** A series' center choice: its own, else the graph's (seq 375). */
export const seriesCenter = (
  styles: Record<string, SeriesStyle> | undefined,
  key: string,
  fallback: GraphOptions["center"],
): GraphOptions["center"] => styles?.[key]?.center ?? fallback;

/** A series' error choice: its own, else the graph's (seq 375). */
export const seriesError = (
  styles: Record<string, SeriesStyle> | undefined,
  key: string,
  fallback: GraphOptions["error"],
): GraphOptions["error"] => styles?.[key]?.error ?? fallback;

/** Center value per column (mean, median or geometric mean) — each column taking
 *  its series' override when it has one, else the graph's choice. */
export const centers = (
  cols: Column[],
  center: GraphOptions["center"],
  styles?: Record<string, SeriesStyle>,
) => cols.map((c) => centerOf(c.values, seriesCenter(styles, c.name, center)));

/** The error of `v` around its `center` value, as the two sides Plotly draws:
 *  `error` above the center, `errorMinus` below it (null for the symmetric
 *  kinds). SD, SEM and the 95% CI half-width are symmetric; range is
 *  max−center above and center−min below; IQR is Q3−center above and
 *  center−Q1 below (Titer's type-6 quartiles, as the boxes draw them);
 *  the geometric SD factor multiplies/divides the geometric mean, and the
 *  geometric 95% CI back-transforms the log-scale interval. The geometric
 *  kinds are undefined on a zero or negative value — both sides null, so
 *  the bar blanks instead of plotting a wrong value. "none" is null on both
 *  sides; callers that already guard "none" never see it. */
export const errorOf = (
  v: number[],
  kind: GraphOptions["error"],
  center: number,
): { error: number | null; errorMinus: number | null } => {
  if (kind === "none") return { error: null, errorMinus: null };
  if (kind === "sem") return { error: sem(v), errorMinus: null };
  if (kind === "ci") return { error: v.length < 2 ? 0 : tCrit95(v.length - 1) * sem(v), errorMinus: null };
  if (kind === "sd") return { error: sd(v), errorMinus: null };
  if (kind === "range") return { error: maxOf(v) - center, errorMinus: center - minOf(v) };
  if (kind === "iqr") return { error: quantile(v, 0.75) - center, errorMinus: center - quantile(v, 0.25) };
  const factor = geometricSdFactor(v);
  if (kind === "geosd")
    return factor == null
      ? { error: null, errorMinus: null }
      : { error: center * factor - center, errorMinus: center - center / factor };
  const ci = geometricCi(v, v.length < 2 ? 0 : tCrit95(v.length - 1));
  return ci == null ? { error: null, errorMinus: null } : { error: ci.high - center, errorMinus: center - ci.low };
};

/** An XY table's X-error column, if one was imported: Prism's X-error
 *  subcolumn arrives as a column named "<X> error" (see pzfx.ts) — a Y
 *  series by the table's shape, but metadata about X, not a data set. */
export function xErrorColumn(columns: Column[], x: Column): Column | undefined {
  return columns.find((c) => c.name === `${x.name} error`);
}

/** A Y data set of an XY graph, as drawn: each value where X has one, keyed so it can be
 *  picked and styled; or, for replicates shown as their center (`xyReplicates`), each X's
 *  center (mean or median) and its error (none when error bars are off). `xErrorCol` is
 *  the table's X-error column (see `xErrorColumn`): while `options.xError` is on, each
 *  point also carries its row's X error, aligned by row — the same value for every
 *  replicate of that row, 0 where the column holds none. */
export function xyDrawn(
  x: Column,
  set: DataSet,
  options: GraphOptions,
  summary: SummaryFormat = "replicates",
  xErrorCol?: Column,
): {
  x: number[];
  y: number[];
  keys?: string[];
  errors?: number[];
  errorMinus?: number[];
  xErrors?: number[];
} {
  const xErrors = (rows: number[]): number[] | undefined =>
    options.xError && xErrorCol ? rows.map((r) => xErrorCol.byRow[r] ?? 0) : undefined;
  // A summary table's Y set holds its stored Mean (and error) columns, not
  // replicates: the drawn points are the Means, with the stored error
  // converted to the graph's error kind — averaging Mean/SD/N as replicates
  // would be silently wrong. This holds whatever `xyReplicates` says.
  if (summary !== "replicates") {
    const meanCol = set.columns.find((c) => summarySuffix(c.name) === "Mean");
    if (!meanCol) return { x: [], y: [] };
    const rows = x.rows.filter((r) => meanCol.byRow[r] != null);
    const xErrs = xErrors(rows);
    return {
      x: rows.map((r) => x.byRow[r]!),
      y: rows.map((r) => meanCol.byRow[r]!),
      ...(options.error === "none"
        ? {}
        : {
            errors: rows.map((r) => summaryErrorAt(set.columns, r, summary, options.error).error ?? 0),
          }),
      // Only present when there really are X errors: the return's shape is
      // pinned (seq 208), and an `xErrors: undefined` key would change it.
      ...(xErrs ? { xErrors: xErrs } : {}),
    };
  }
  if (set.columns.length === 1 || options.xyReplicates === "each") {
    const points = xyPoints(x, set);
    return {
      x: points.x,
      y: points.y,
      keys: points.rows.map((r, i) => pointKeyOf(points.columns[i], r)),
      xErrors: xErrors(points.rows),
    };
  }
  const rows = xyRows(x, set);
  // One dataset, one series: its center/error override (seq 375) governs every X.
  const sCenter = seriesCenter(options.series, set.name, options.center);
  const sError = seriesError(options.series, set.name, options.error);
  const y = rows.values.map((v) => centerOf(v, sCenter));
  const errs =
    sError === "none"
      ? null
      : rows.values.map((v, i) => (v.length < 2 ? { error: 0, errorMinus: null } : errorOf(v, sError, y[i])));
  return {
    x: rows.x,
    y,
    ...(errs
      ? {
          errors: errs.map((e) => e.error ?? NaN),
          ...(errs.some((e) => e.errorMinus != null)
            ? { errorMinus: errs.map((e) => e.errorMinus ?? NaN) }
            : {}),
        }
      : {}),
    xErrors: xErrors(rows.rows),
  };
}

/** Error magnitude per column, with the lower side for the asymmetric kinds
 *  (range, IQR, geometric SD/CI) — or null when error is off. `center` is
 *  the columns' plotted centers, one per column: the asymmetric kinds are
 *  measured from them. A null side becomes NaN ("no error bar", the grouped
 *  builders' convention); `errorMinus` is null outright when the kind is
 *  symmetric, so callers pass it only where it exists. Each column takes its
 *  series' error override when it has one, else the graph's kind — and off
 *  stays off unless a series overrides to a real kind. */
export const errors = (
  cols: Column[],
  kind: GraphOptions["error"],
  center: number[],
  styles?: Record<string, SeriesStyle>,
): { error: number[]; errorMinus: number[] | null } | null => {
  if (kind === "none" && !cols.some((c) => seriesError(styles, c.name, kind) !== "none")) return null;
  const pairs = cols.map((c, i) => errorOf(c.values, seriesError(styles, c.name, kind), center[i]));
  const minus = pairs.map((p) => p.errorMinus);
  return {
    error: pairs.map((p) => p.error ?? NaN),
    errorMinus: minus.every((m) => m == null) ? null : minus.map((m) => m ?? NaN),
  };
};

/** Deterministic jitter in [-0.15, 0.15] so points don't jump on option changes. */
export const jitter = (col: number, i: number) => {
  const s = Math.sin(col * 131.7 + i * 977.3) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 0.3;
};

/** How far sideways each scatter point sits from its column/row, one offset
 *  per value (nulls get 0 — the caller never draws them). "classic" is the
 *  legacy `jitter` exactly (same seed and index, so existing graphs render
 *  unchanged); "aligned" is 0 everywhere — dots stacked in a column, Prism's
 *  aligned dot plot; "standard" spreads points in proportion to how many
 *  share their Y (a lone point sits centered, the densest Y gets the full
 *  width); "expanded" is a low-discrepancy (golden-ratio) spread, which
 *  breaks the visual banding a single hash can leave. `indexBase` lets the
 *  grouped builders keep their legacy per-point index (row × 10 + replicate)
 *  so classic stays bit-identical there too. */
export function scatterOffsets(
  values: (number | null)[],
  style: GraphOptions["scatterStyle"],
  seed: number,
  indexBase = 0,
): number[] {
  if (style === "aligned") return values.map(() => 0);
  if (style === "classic") return values.map((_, i) => jitter(seed, indexBase + i));
  if (style === "expanded") {
    return values.map((_, i) => {
      const f = (indexBase + i) * 0.6180339887498949 + seed * 0.3183098861837907;
      return (f - Math.floor(f) - 0.5) * 0.3;
    });
  }
  const counts = new Map<number, number>();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  const maxCount = Math.max(1, ...counts.values());
  const seen = new Map<number, number>();
  return values.map((v) => {
    if (v == null) return 0;
    const k = counts.get(v)!;
    const j = seen.get(v) ?? 0;
    seen.set(v, j + 1);
    if (k === 1) return 0;
    const w = 0.15 * (k / maxCount);
    return -w + (2 * w * j) / (k - 1);
  });
}

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
    // Numbers written out (100,000; 0.00001), never Plotly's SI suffixes: "0.1M" reads as
    // molar, "10µ" as micro.
    exponentformat: "none",
    fixedrange: true,
    automargin: true,
  };
}

/** An axis of categories (columns, rows) at `positions`, a label each; those that would
 *  overlap are thinned once the graph is drawn (`fitLabels`). Labels turn straight to
 *  vertical as the graph narrows: at Plotly's 30° step the last one would slip off the
 *  right edge and be dropped. */
const categoryTicks = (labels: string[], positions: number[]) => ({
  tickmode: "array",
  tickvals: positions,
  ticktext: labels,
  autotickangles: [0, 90],
});

/** The places in `positions` (in order) kept at least `gap` apart, from the first. */
function spaced(positions: number[], gap: number): number[] {
  const kept: number[] = [];
  positions.forEach((p, i) => {
    if (!kept.length || Math.abs(p - positions[kept.at(-1)!]) >= gap - 1e-9) kept.push(i);
  });
  return kept;
}

/** An axis as Plotly drew it: its length in px, its range (log10 of the values on a log
 *  axis, places on an axis of categories), and its ticks, each at such a place. */
type DrawnAxis = { _length?: number; range?: number[]; type?: string; _vals?: { x: number; text: string }[] };

/** What spaces the labels of any axis that overlap once drawn (`layout` as given, `drawn`
 *  as Plotly resolved it), never closer than Plotly's own spacing for categories (1.2 × the
 *  font size): an axis whose ticks are listed (categories, a log axis's powers) keeps only
 *  some, an axis of numbers whose step was typed too small for its length (Plotly draws a
 *  thousand ticks at most, then none) takes the smallest round multiple of it that fits
 *  (1 on 0 to 1000000: every 100000). Null when every label fits. */
export function fitLabels(
  layout: Record<string, unknown>,
  drawn: Record<string, DrawnAxis | undefined>,
  fontSize: number,
): Record<string, unknown> | null {
  const update: Record<string, unknown> = {};
  for (const name of ["xaxis", "yaxis"] as const) {
    const { _length, range, type, _vals } = drawn[name] ?? {};
    if (!_length || !range || !_vals || _vals.length < 2) continue;
    const gap = (Math.round(1.2 * fontSize) * Math.abs(range[1] - range[0])) / _length;
    const at = _vals.map((v) => v.x);
    const kept = spaced(at, gap);
    if (kept.length === at.length) continue;
    if ((layout[name] as { tickvals?: unknown } | undefined)?.tickvals) {
      update[`${name}.tickvals`] = kept.map((i) => (type === "log" ? 10 ** at[i] : at[i]));
      update[`${name}.ticktext`] = kept.map((i) => _vals[i].text);
    } else {
      const step = Math.abs(at[1] - at[0]);
      const round = [1, 2, 5].map((m) => m * 10 ** Math.floor(Math.log10(gap / step)));
      update[`${name}.dtick`] = step * ([...round, round[0] * 10].find((k) => step * k >= gap) ?? 1);
    }
  }
  return Object.keys(update).length ? update : null;
}

/** A numeric X axis: its scale, range and step (`xScale`, `xMin`…), titled `xName` until
 *  titled by hand. */
const valueXAxis = (options: GraphOptions, xName = "") => ({
  type: "linear",
  ...axisChrome(options),
  ...xAxisRange(options), // type "log" when X is on a log scale
  ...axisTitle(options.xLabel || xName, options.xTitleGap),
});

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

/** An axis number format as a Plotly `tickformat` string: fixed decimals
 *  (".2f") or scientific (".2e"); automatic (or absent) draws Plotly's own
 *  ticks. `decimals` clamps to 0–15 — beyond that Plotly would print noise. */
export function numberTickformat(fmt: AxisNumberFormat | undefined): string | undefined {
  if (!fmt || fmt.format === "auto") return undefined;
  const decimals = Math.max(0, Math.min(15, Math.floor(fmt.decimals ?? 2)));
  return `.${decimals}${fmt.format === "decimal" ? "f" : "e"}`;
}

/** Applies each axis's number format to a built figure's numeric linear
 *  axes (see `numberTickformat`). Category axes, log axes (whose ticks are
 *  the powers) and axes with custom tick placement keep their own labels,
 *  so a format never fights a builder's ticks. Mutates the figure in
 *  place — builders return a fresh figure per draw, and the graph view
 *  already mutates it for overlays. */
export function applyNumberFormats(fig: GraphFigure, options: GraphOptions): void {
  const axes: [string, AxisNumberFormat | undefined][] = [
    ["xaxis", options.xNumberFormat],
    ["yaxis", options.yNumberFormat],
    ["yaxis2", options.y2NumberFormat],
  ];
  for (const [key, fmt] of axes) {
    const tickformat = numberTickformat(fmt);
    if (!tickformat) continue;
    const axis = fig.layout[key] as Record<string, unknown> | undefined;
    if (!axis || typeof axis !== "object") continue;
    if (axis.type === "category" || axis.type === "log") continue;
    if (axis.tickmode === "array") continue;
    axis.tickformat = tickformat;
  }
}

/** The graph types whose X axis is the table's X column (seq 332 part D):
 *  the core XY plots, a residual plot against X (not its QQ form, whose X
 *  is a z-score), and the curves plotted against X. Every other xy-family
 *  type plots something else on X — a survival curve's time, a volcano's
 *  effect size, a ROC curve's 1 − specificity — so no date axis applies. */
export const TABLE_X_GRAPH_TYPES = [
  "xy-scatter",
  "xy-bar",
  "xy-area",
  "xy-spikes",
  "xy-bar-scatter",
  "residuals",
  "smooth-curve",
  "logistic-curve",
] as const;

/** Whether this graph's X axis is the table's X column, so a date/elapsed
 *  X deserves date/elapsed tick labels on it. */
export function hasTableXAxis(type: GraphType, options: GraphOptions): boolean {
  if (type === "residuals") return options.residualsAs === "x";
  return (TABLE_X_GRAPH_TYPES as readonly string[]).includes(type);
}

/** What a date/elapsed X axis needs: the table's format + conversion, and
 *  the conversion's zero (xZeroMs) for dates. */
export interface DateAxisInfo {
  format: "date" | "elapsed";
  conversion: XConversion;
  zeroMs: number | null;
}

/**
 * Draws a date/elapsed X axis on a built figure (seq 332 part D): the
 * axis's numeric range becomes date labels (smart spacing) or elapsed
 * labels, at the display format the Format Axes dialog chose. Runs after
 * applyNumberFormats — a date axis replaces the number format, so any
 * tickformat on X is dropped. Skips log axes (dates have no log scale),
 * category axes, and figures with no X data to span; the manual min/max
 * still bound the range, and a date step (xStep) is ignored — the smart
 * spacing picks the step. Mutates the figure in place.
 */
export function applyDateAxis(fig: GraphFigure, options: GraphOptions, info: DateAxisInfo | null): void {
  if (!info || options.xScale !== "linear") return;
  const axis = fig.layout.xaxis as Record<string, unknown> | undefined;
  if (!axis || typeof axis !== "object") return;
  if (axis.type === "category" || axis.type === "log") return;
  // The visible range: the manual min/max when set, else the plotted X.
  let lo: number | undefined;
  let hi: number | undefined;
  const range = axis.range as unknown;
  if (
    Array.isArray(range) &&
    range.length === 2 &&
    typeof range[0] === "number" &&
    typeof range[1] === "number"
  ) {
    [lo, hi] = range;
  } else {
    const xs: number[] = [];
    for (const trace of fig.data as { x?: unknown }[]) {
      if (!Array.isArray(trace.x)) continue;
      for (const v of trace.x) if (typeof v === "number" && Number.isFinite(v)) xs.push(v);
    }
    if (xs.length === 0) return;
    lo = Math.min(...xs);
    hi = Math.max(...xs);
  }
  if (lo === undefined || hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi)) return;
  const ticks =
    info.format === "date"
      ? info.zeroMs === null
        ? null
        : dateAxisTicksForValues(lo, hi, info.conversion, info.zeroMs, options.xDateFormat)
      : elapsedAxisTicksForValues(lo, hi, info.conversion, options.xElapsedFormat);
  if (!ticks || ticks.tickvals.length === 0) return;
  axis.tickmode = "array";
  axis.tickvals = ticks.tickvals;
  axis.ticktext = ticks.ticktext;
  delete axis.tickformat;
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

/** Where a box's whiskers end, and which values lie past them (Prism's whisker
 *  choices, FAQ 1481): min to max (no outliers), Tukey's 1.5×IQR fences — the
 *  whiskers end at an observed data point, values beyond are outliers — or a
 *  percentile pair, with values outside the pair as outliers. "min-max-all"
 *  is min to max with all points drawn (its outliers list is empty; the
 *  builders draw the points instead). Percentiles use Titer's `quantile`
 *  (R type 6), the same method as the box's quartiles. */
export function whiskerBounds(
  values: number[],
  whisker: GraphOptions["whisker"],
): { low: number; high: number; outliers: number[] } {
  const lo = minOf(values);
  const hi = maxOf(values);
  if (whisker === "min-max" || whisker === "min-max-all") return { low: lo, high: hi, outliers: [] };
  if (whisker === "tukey") {
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const iqr = q3 - q1;
    const lowFence = q1 - 1.5 * iqr;
    const highFence = q3 + 1.5 * iqr;
    const inside = values.filter((v) => v >= lowFence && v <= highFence);
    return {
      low: minOf(inside),
      high: maxOf(inside),
      outliers: values.filter((v) => v < lowFence || v > highFence),
    };
  }
  const [p, q] =
    whisker === "p10-90"
      ? [0.1, 0.9]
      : whisker === "p5-95"
        ? [0.05, 0.95]
        : whisker === "p2.5-97.5"
          ? [0.025, 0.975]
          : [0.01, 0.99];
  const low = quantile(values, p);
  const high = quantile(values, q);
  return { low, high, outliers: values.filter((v) => v < low || v > high) };
}

/** Boxes at `x`, one per list of values, as Helix computes them (`boxOf`: the quartiles of
 *  Descriptive statistics, whiskers to the minimum and maximum): Plotly only draws them.
 *  `whisker` moves the fences (Tukey, percentiles); the quartiles never move. */
export function boxTrace(x: number[], values: number[][], whisker: GraphOptions["whisker"] = "min-max") {
  const boxes = values.map((v) => boxOf(v));
  const fences = values.map((v) => whiskerBounds(v, whisker));
  const field = (k: keyof (typeof boxes)[number]) => boxes.map((b) => b[k]);
  return {
    x,
    q1: field("q1"),
    median: field("median"),
    q3: field("q3"),
    lowerfence: fences.map((f) => f.low),
    upperfence: fences.map((f) => f.high),
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
      ...categoryTicks(
        names,
        names.map((_, i) => i),
      ),
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

/** Where each row stands on a numeric X axis: its title's number, when every row holding
 *  a value is titled by one (times, doses); a row without values, nowhere (null). */
export function rowValues(columns: Column[], titles: (string | null)[] = []): (number | null)[] | undefined {
  const held = new Set(columns.flatMap((c) => c.rows));
  const at = Array.from({ length: rowCountOf(columns) }, (_, r) => parseCell(titles[r] ?? null));
  return held.size && at.every((v, r) => v != null || !held.has(r)) ? at : undefined;
}

/** Group `g`'s replicate values at row `r` (numeric cells only). */
function groupRow(cols: Column[], r: number): number[] {
  return cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
}

/** Per-row center (mean/median/geometric mean) and optional error for one
 *  group. `center[r]` is null where the group has no data in that row (or
 *  its geometric mean is undefined — a zero or negative value, which leaves
 *  a gap); `error[r]` where it has a single value (no error bar, as in
 *  Prism). `errorMinus[r]` is the lower side for the asymmetric kinds
 *  (range, IQR, geometric SD/CI), null outright when the kind is symmetric. */
export function perRowStats(
  cols: Column[],
  rows: number,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
): { center: (number | null)[]; error: (number | null)[] | null; errorMinus: (number | null)[] | null } {
  const c: (number | null)[] = [];
  const e: (number | null)[] | null = error === "none" ? null : [];
  const em: (number | null)[] | null = error === "none" ? null : [];
  for (let r = 0; r < rows; r++) {
    const v = groupRow(cols, r);
    if (v.length === 0) {
      c.push(null);
      if (e) e.push(null);
      if (em) em.push(null);
      continue;
    }
    const cv = centerOf(v, center);
    c.push(Number.isNaN(cv) ? null : cv);
    if (e && em) {
      if (v.length < 2) {
        e.push(null);
        em.push(null);
      } else {
        const p = errorOf(v, error, cv);
        e.push(p.error);
        em.push(p.errorMinus);
      }
    }
  }
  return { center: c, error: e, errorMinus: em?.every((m) => m == null) ? null : em };
}

/** A column name's sub-column suffix — the part after the last ":"
 *  ("Mean" for "A:Mean" and for a nested "A:S1:Mean"; the whole name
 *  when there is no ":"). */
const summarySuffix = (name: string) => name.slice(name.lastIndexOf(":") + 1);

/** One summary group's stored error at one row, converted to the graph's
 *  error kind exactly via N when N is present (SD ↔ SEM), or the 95% CI
 *  half-width (t × SEM) when N ≥ 2. A conversion that needs an N the
 *  format doesn't store has no error bar — a null there, never a guessed
 *  number. `errorMinus` carries the lower side for the asymmetric formats
 *  (Mean, +error, −error and Mean, upper, lower limits), whose upper and
 *  lower errors differ; null for the symmetric ones (and when the Mean
 *  itself is missing at that row). */
export function summaryErrorAt(
  cols: Column[],
  r: number,
  format: SummaryFormat,
  error: GraphOptions["error"],
): { error: number | null; errorMinus: number | null } {
  const def = summaryFormatDef(format);
  const col = (suffix: string) => cols.find((c) => summarySuffix(c.name) === suffix);
  const m = col("Mean")?.byRow[r] ?? null;
  if (m == null || error === "none") return { error: null, errorMinus: null };
  // Range, IQR and the geometric kinds need the raw replicates: a stored
  // Mean/SD/N cannot produce them, so there is no error bar — never a
  // guessed number (the same contract as a conversion that needs a missing N).
  if (error === "range" || error === "iqr" || error === "geosd" || error === "geoci")
    return { error: null, errorMinus: null };
  const n = col("N")?.byRow[r] ?? null;
  if (def.errorKind === "plus-minus") {
    return { error: col("+error")?.byRow[r] ?? null, errorMinus: col("−error")?.byRow[r] ?? null };
  }
  if (def.errorKind === "upper-lower") {
    const upper = col("Upper limit")?.byRow[r] ?? null;
    const lower = col("Lower limit")?.byRow[r] ?? null;
    return {
      error: upper == null ? null : upper - m,
      errorMinus: lower == null ? null : m - lower,
    };
  }
  // The stored error, as an SD: SD itself, SEM × √N, or CV% of the mean.
  const stored =
    def.errorKind === "sd"
      ? col("SD")?.byRow[r] ?? null
      : def.errorKind === "sem"
        ? col("SEM")?.byRow[r] ?? null
        : col("CV")?.byRow[r] ?? null;
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
  const asSem = asSd == null ? null : def.errorKind === "sem" ? stored : n == null ? null : asSd / Math.sqrt(n);
  return {
    error:
      error === "sd" ? asSd : error === "sem" ? asSem : n == null || n < 2 || asSem == null ? null : tCrit95(n - 1) * asSem,
    errorMinus: null,
  };
}

/** Per-row center and error for one group of a summary table: the center is
 *  the stored Mean; the error is the stored error, converted to the graph's
 *  error kind exactly via N when N is present (SD ↔ SEM), or the 95% CI
 *  half-width (t × SEM) when N ≥ 2. A conversion that needs an N the format
 *  doesn't store (Mean, SD with SEM or CI asked) has no error bar — a null
 *  there, never a guessed number. `errorMinus` carries the lower side for the
 *  asymmetric formats (Mean, +error, −error and Mean, upper, lower limits),
 *  whose upper and lower errors differ; it is null for the symmetric ones.
 *  `center[r]` is null where the group has no Mean in that row.
 *  A group holding several Mean columns (a nested table's subgroups) is
 *  read as the subgroup Means themselves: the center is their mean or
 *  median, the error their SD/SEM/CI — or the new kinds, pooled the same
 *  way — the nested pooling the replicate graphs already do, applied to the
 *  stored Means. */
export function perRowSummaryStats(
  cols: Column[],
  rows: number,
  format: SummaryFormat,
  error: GraphOptions["error"],
): { center: (number | null)[]; error: (number | null)[] | null; errorMinus: (number | null)[] | null } {
  const meanCols = cols.filter((c) => summarySuffix(c.name) === "Mean");
  if (meanCols.length > 1) {
    return perRowStats(meanCols, rows, "mean", error);
  }
  const err: (number | null)[] | null = error === "none" ? null : [];
  const errMinus: (number | null)[] | null = error === "none" ? null : [];
  const center: (number | null)[] = [];
  for (let r = 0; r < rows; r++) {
    const m = meanCols[0]?.byRow[r] ?? null;
    center.push(m);
    if (!err || !errMinus) continue;
    const { error: e, errorMinus: em } = summaryErrorAt(cols, r, format, error);
    err.push(e);
    errMinus.push(em);
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
 *  heatmap plots, instead of `centerColumn` (which would average Mean/SD/N).
 *  Several Mean columns (a nested table's subgroups) read as one column of
 *  their per-row mean, the nested pooling the replicate graphs already do. */
export function summaryMeanColumn({ name, columns }: DataSet): Column | undefined {
  const meanCols = columns.filter((c) => summarySuffix(c.name) === "Mean");
  if (meanCols.length === 0) return undefined;
  if (meanCols.length === 1) return meanCols[0];
  const byRow = meanCols[0].byRow.map((_, r) => {
    const vs = meanCols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
    return vs.length ? mean(vs) : null;
  });
  const rows = byRow.flatMap((v, r) => (v == null ? [] : [r]));
  return {
    name,
    cells: byRow.map((v) => (v == null ? null : String(v))),
    byRow,
    values: rows.map((r) => byRow[r]!),
    rows,
  };
}

/** Where a group sits within a row's slot, so interleaved scatter
 *  points fan out per group across [-0.28, 0.28] (bars use Plotly's own barmode). */
export const groupOffset = (g: number, total: number) => (total <= 1 ? 0 : -0.28 + (0.56 * g) / (total - 1));

interface CategoryPositions {
  posOf: (group: number, row: number) => number;
  tickvals: number[];
  ticktext: string[];
  range: [number, number];
}

/** Category positions for the "Interleaved" arrangement: each group at its
 *  offset within every row's slot (`groupOffset`), so a bar, a box and a
 *  point of the same group and row share one place — a point overlaid on a
 *  bar sits on its own bar. Ticks are the row labels, one per row. */
export function interleavedPositions(groups: number, labels: string[]): CategoryPositions {
  return {
    posOf: (g, r) => r + groupOffset(g, groups),
    tickvals: labels.map((_, i) => i),
    ticktext: labels,
    range: [-0.5, labels.length - 0.5],
  };
}

/** A grouped bar's width and center within its row's slot, matching what
 *  Plotly itself draws on a "category" axis (the cluster takes 0.8 of the
 *  slot — bargap 0.2 — split across the groups, `barGap` between neighbours):
 *  width = (0.8 / groups) * (1 - barGap), center(g) = -0.4 + (0.8/groups)*(g+0.5).
 *  The numeric-positions path (bars with points overlaid) must use these
 *  instead of `groupOffset`: Plotly sizes bars from the smallest gap between
 *  bar positions, so `groupOffset`'s ±0.28 spread makes the bars thin with a
 *  bigger gap between paired bars than between conditions (seq 547) — and
 *  the gap only shrinks as groups are added. With an explicit `width` on the
 *  trace Plotly centers the bar on its x, so these centers + width reproduce
 *  the category-axis geometry exactly, showPoints on or off. The significance
 *  brackets already assume these centers (see groupedSpots). */
export function groupedBarGeometry(groups: number, barGap: number): { width: number; center: (g: number) => number } {
  const slot = 0.8 / Math.max(1, groups);
  return { width: slot * (1 - barGap), center: (g: number) => -0.4 + slot * (g + 0.5) };
}

/** Category positions for interleaved grouped bars with points overlaid:
 *  each group's bar at its `groupedBarGeometry` center, so a point overlaid
 *  on a bar sits on its own bar. Ticks are the row labels, one per row. */
export function groupedBarPositions(groups: number, labels: string[], barGap: number): CategoryPositions {
  const { center } = groupedBarGeometry(groups, barGap);
  return {
    posOf: (g, r) => r + center(g),
    tickvals: labels.map((_, i) => i),
    ticktext: labels,
    range: [-0.5, labels.length - 0.5],
  };
}

/** Category positions for the "Superimposed" arrangement with points
 *  overlaid: every group's bar stands at the row's center (`r`) — the bars
 *  overlay, they don't stand side by side — so a bar, its points and its
 *  significance bracket share one place. Ticks are the row labels, one per
 *  row. Used only when points are overlaid: without points the bars stay on
 *  Plotly's "category" axis and need no numeric positions, and without
 *  numeric positions a numeric scatter x would land as new categories to
 *  the right of the bars (BUG-REPORT #92). */
export function superimposedPositions(labels: string[]): CategoryPositions {
  return {
    posOf: (_g, r) => r,
    tickvals: labels.map((_, i) => i),
    ticktext: labels,
    range: [-0.5, labels.length - 0.5],
  };
}

/** Category positions for the "Separated" arrangement: each group gets its own
 *  block of `rows` slots (with a 1-slot gap between blocks) instead of sharing
 *  a slot per row, so groups sit side by side rather than interleaved. Ticks
 *  repeat the row labels once per block. */
export function separatedPositions(groups: number, labels: string[]): CategoryPositions {
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
  opts: { horizontal?: boolean; positions?: CategoryPositions; seriesNames?: string[] } = {},
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
  // Numeric category positions (separated blocks, or interleaved positions
  // when points are overlaid on the bars) need explicit tick placement
  // instead of Plotly's evenly-spaced "category" axis.
  const category = {
    ...(opts.positions
      ? {
          tickmode: "array",
          tickvals: opts.positions.tickvals,
          ticktext: opts.positions.ticktext,
          range: opts.positions.range,
          autotickangles: [0, 90],
        }
      : { type: "category", autotickangles: [0, 90] }),
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
 *  (so groups can be offset within each row), or, with `atValues`, the rows' values on a
 *  numeric axis (`rowValues`); a legend once there's >1 group. */
export function groupedScatterLayout(
  options: GraphOptions,
  labels: string[],
  seriesCount: number,
  positions?: CategoryPositions,
  seriesNames: string[] = [],
  atValues?: boolean,
): Record<string, unknown> {
  return {
    ...chromeLayout(options, seriesCount > 1 ? legendRightMargin(options, seriesNames) : undefined),
    showlegend: seriesCount > 1,
    legend: legendOf(options),
    xaxis: atValues
      ? valueXAxis(options)
      : {
          tickmode: "array",
          tickvals: positions ? positions.tickvals : labels.map((_, i) => i),
          ticktext: positions ? positions.ticktext : labels,
          range: positions ? positions.range : [-0.5, labels.length - 0.5],
          autotickangles: [0, 90],
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
