// Points picked on a graph (by their key, see `pointKeyOf`): the ring drawn round
// them, never exported; the style set on them; and the names of the points that
// show theirs. The selection itself is the graph view's, never saved.
import { clamp, GRAPH_LIMITS, type PointShape, type PointStyle } from "../../store/types";
import { parsePointKey } from "../../lib/columns";
import { colorscaleColor, hexOf, opacityOf } from "../../lib/palettes";
import { INK, pointName, textWidth } from "./plot-helpers";

/** A trace of individual points, as `seriesPoints` (or the volcano) makes it: a style
 *  field is one value for all, or one per point. */
type PerPoint<T> = T | T[];
interface PointsTrace {
  x: number[];
  y: number[];
  customdata?: unknown;
  marker?: {
    // A numeric color variable (the bubble plot's) colors per point by value,
    // on `colorscale` between `cmin`/`cmax` — never a string per point.
    color?: PerPoint<string> | number[];
    colorscale?: [number, string][];
    cmin?: number;
    cmax?: number;
    size?: PerPoint<number>;
    symbol?: PerPoint<PointShape>;
    line?: { width?: PerPoint<number> };
  };
}

const RING = "selection"; // the ring trace's `meta`, which export leaves out
const at = <T>(v: PerPoint<T> | undefined, i: number, fallback: T) => (Array.isArray(v) ? v[i] : (v ?? fallback));

/** Every keyed point the figure draws: where, and how (its color, and apart its fill's opacity). */
function drawnPoints(data: unknown[]) {
  return (data as PointsTrace[]).flatMap((t) => {
    // A numeric `marker.color` is a value per point, not a color: map it
    // through the trace's own colorscale, the way Plotly draws it — a
    // `hexOf` on a number would throw and abort the whole draw.
    const values = Array.isArray(t.marker?.color) && t.marker.color.every((c) => typeof c === "number")
      ? (t.marker.color as number[])
      : null;
    const scale = values && t.marker?.colorscale?.length ? t.marker.colorscale : null;
    const lo = t.marker?.cmin ?? (values?.length ? Math.min(...values) : 0);
    const hi = t.marker?.cmax ?? (values?.length ? Math.max(...values) : 0);
    const colorAt = (i: number) =>
      scale
        ? colorscaleColor(scale, values![i], lo, hi)
        : values
          ? INK // numeric colors, no scale to map them on: the series' ink
          : hexOf(at(t.marker?.color as PerPoint<string> | undefined, i, INK));
    const fillAt = (i: number) =>
      values ? 1 : opacityOf(at(t.marker?.color as PerPoint<string> | undefined, i, INK));
    return Array.isArray(t.customdata)
      ? (t.customdata as string[]).map((key, i) => ({
          key,
          x: t.x[i],
          y: t.y[i],
          style: {
            color: colorAt(i),
            size: at(t.marker?.size, i, 7),
            shape: at(t.marker?.symbol, i, "circle" as PointShape),
            fill: fillAt(i),
            outline: at(t.marker?.line?.width, i, 0),
          },
        }))
      : [];
  });
}

/** How the figure draws the point `key`, if it does. */
export const drawnStyle = (data: unknown[], key: string) => drawnPoints(data).find((p) => p.key === key)?.style;

/** The keys of every point the figure draws. */
export const drawnKeys = (data: unknown[]) => new Set(drawnPoints(data).map((p) => p.key));

/** The keys of the points Plotly reports (a click, a dragged rectangle): only drawn
 *  points carry one. */
export const keysOf = (points: { customdata?: unknown }[]) =>
  points.map((p) => p.customdata).filter((k): k is string => typeof k === "string");

/** The selection after picking `keys`: them alone, or (`add`) added to it. */
export const picked = (selected: ReadonlySet<string>, keys: string[], add: boolean): ReadonlySet<string> =>
  new Set(add ? [...selected, ...keys] : keys);

/** A ring in `color` round each selected point, over the rest; none when nothing is. */
export function selectionRing(data: unknown[], selected: ReadonlySet<string>, color: string) {
  const ringed = drawnPoints(data).filter((p) => selected.has(p.key));
  if (!ringed.length) return null;
  return {
    type: "scatter",
    mode: "markers",
    x: ringed.map((p) => p.x),
    y: ringed.map((p) => p.y),
    marker: { symbol: "circle-open", size: ringed.map((p) => p.style.size + 8), color, line: { width: 2, color } },
    hoverinfo: "skip",
    showlegend: false,
    meta: RING,
  };
}

/** A figure's traces without the selection ring: what gets exported. */
export const withoutSelection = (data: unknown[]) => data.filter((t) => (t as { meta?: unknown }).meta !== RING);

/** `points` with `style` merged into each of `keys` (an undefined field unset), or
 *  (null) their styles removed; a point left with no style leaves the list. */
export function stylePoints(
  points: Record<string, PointStyle> | undefined,
  keys: Iterable<string>,
  style: PointStyle | null,
): Record<string, PointStyle> | undefined {
  const next = { ...points };
  for (const key of keys) {
    const merged = Object.fromEntries(Object.entries({ ...next[key], ...style }).filter(([, v]) => v !== undefined));
    if (style && Object.keys(merged).length) next[key] = merged;
    else delete next[key];
  }
  return Object.keys(next).length ? next : undefined;
}

/** `points` with each of `keys` made `by` pixels bigger (or smaller) than the figure
 *  draws it, within `GRAPH_LIMITS.pointSize`: points of different sizes keep their difference. */
export function resizePoints(
  points: Record<string, PointStyle> | undefined,
  data: unknown[],
  keys: Iterable<string>,
  by: number,
) {
  const sizes = new Map(drawnPoints(data).map((p) => [p.key, p.style.size]));
  const next = { ...points };
  for (const key of keys) {
    const size = sizes.get(key);
    if (size !== undefined) next[key] = { ...next[key], size: clamp(size + by, GRAPH_LIMITS.pointSize) };
  }
  return Object.keys(next).length ? next : undefined;
}

/** The names of the points that show theirs (`label`): each its row's title, else
 *  "Row N", just right of it or where it was moved. */
export function pointLabels(
  data: unknown[],
  points: Record<string, PointStyle> | undefined,
  titles: (string | null)[] = [],
  fontSize: number,
) {
  const textSize = Math.max(fontSize - 2, 8);
  return drawnPoints(data)
    .filter((p) => points?.[p.key]?.label)
    .map((p) => {
      const { row } = parsePointKey(p.key);
      const text = titles[row]?.trim() || `Row ${row + 1}`;
      const offset = points?.[p.key]?.labelOffset ?? { x: p.style.size / 2 + 3 + textWidth(text, textSize) / 2, y: 0 };
      return pointName(p.key, p.x, p.y, text, offset, p.style.size, textSize);
    });
}
