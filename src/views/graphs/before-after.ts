// "Before-and-after": one line per subject through its paired values — the
// standard paired-data figure, which Prism's own paired-t-test how-to
// recommends over bars. A Column table's rows are the subjects and its
// columns the conditions/timepoints (Before, After, …); a Grouped table's
// rows are the X categories and its columns groups × replicates, so the
// paired reading is the matched-replicates one — replicate j of each group
// in the same row is the same subject under each group — and each (row,
// replicate) gets one line across the groups, at the grouped-scatter
// positions. Points take their column's / group's series colour (individual
// point overrides honoured); the lines are one dark colour — the subjects
// are not series, so no series colour applies to a line. Optional
// arrowheads point from the earlier to the later condition.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import { withOpacity } from "../../lib/palettes";
import { pointKeyOf } from "../../lib/columns";
import {
  INK,
  baseLayout,
  centers,
  COLUMN_BAR,
  errors,
  groupedScatterLayout,
  groupOffset,
  legendRightMargin,
  marginsFor,
  onAxis,
  rowCountOf,
  rowLabels,
  separatedPositions,
  seriesMarker,
  type Paint,
} from "./plot-helpers";

/** One subject's line: its points in column/group order, each with its own style. */
function subjectTrace(
  name: string,
  xs: number[],
  ys: number[],
  styles: { color: string; size: number; shape: string; fill: number; outline: number; outlineColor: string }[],
  pointKeys: string[],
  options: GraphOptions,
): Record<string, unknown> {
  return {
    type: "scatter",
    mode: "lines+markers",
    name,
    x: xs,
    y: ys,
    line: { color: INK, width: options.lineWidth, dash: options.lineDash },
    marker: {
      color: styles.map((s) => withOpacity(s.color, s.fill)),
      size: styles.map((s) => s.size),
      symbol: styles.map((s) => s.shape),
      line: { color: styles.map((s) => s.outlineColor), width: styles.map((s) => s.outline) },
    },
    customdata: pointKeys,
    hoverinfo: "x+y",
    showlegend: false,
  };
}

/** A legend entry per series: an empty markers trace, so the column/group
 *  colours are named even though the subject traces carry no legend. */
function legendTrace(paint: Paint, name: string, index: number): Record<string, unknown> {
  return {
    type: "scatter",
    mode: "markers",
    name,
    x: [],
    y: [],
    marker: seriesMarker(paint, name, index),
    hoverinfo: "skip",
  };
}

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One annotation per segment, arrowhead on the later point, tail 14 px back
 *  along the segment's screen direction. The direction is computed from the
 *  figure's own axis ranges and plot size (margins from `marginsFor`, legend
 *  room from `legendRightMargin`); the Y range is the data extent with
 *  Plotly's default 5% autorange padding, or the user's explicit bounds when
 *  both are set. On a log axis a bound at or below 0 is treated as unset,
 *  exactly as the axis itself does — log10(0) = −Infinity would collapse
 *  the span and flatten every arrow. Annotation positions are log-transformed on a log Y axis,
 *  as Plotly requires (`onAxis`). */
function arrowAnnotations(
  segments: Segment[],
  options: GraphOptions,
  xRange: [number, number],
  yValues: number[],
  legendNames: string[],
): unknown[] {
  const margin = {
    ...marginsFor(options),
    r: legendNames.length > 1 ? legendRightMargin(options, legendNames) : 16,
  };
  const plotW = Math.max(1, options.width - margin.l - margin.r);
  const plotH = Math.max(1, options.height - margin.t - margin.b);
  const ys = yValues.map((v) => onAxis(v, options.yScale)).filter((v) => Number.isFinite(v));
  let [yLo, yHi] = ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 1];
  // Mirror `logAxis`: a bound at or below 0 has no place on a log axis and
  // counts as unset (log10(0) = −Infinity would make ySpan infinite and
  // flatten every arrow); on a linear axis every bound counts.
  const at = (v?: number) =>
    v != null && (options.yScale === "linear" || v > 0) ? onAxis(v, options.yScale) : undefined;
  const [lo, hi] = [at(options.yMin), at(options.yMax)];
  if (lo != null && hi != null) {
    [yLo, yHi] = [lo, hi];
  } else {
    const pad = (yHi - yLo) * 0.05 || 1;
    yLo -= pad;
    yHi += pad;
  }
  const xSpan = xRange[1] - xRange[0] || 1;
  const ySpan = yHi - yLo || 1;
  const ARROW_PX = 14;
  return segments.flatMap((s) => {
    const y1 = onAxis(s.y1, options.yScale);
    const y2 = onAxis(s.y2, options.yScale);
    if (![s.x1, s.x2, y1, y2].every((v) => Number.isFinite(v))) return [];
    const dx = ((s.x2 - s.x1) / xSpan) * plotW;
    const dy = ((y2 - y1) / ySpan) * plotH; // data-up
    const len = Math.hypot(dx, dy);
    if (len === 0) return [];
    const ux = dx / len;
    const uy = -dy / len; // screen Y runs down
    return [
      {
        x: s.x2,
        y: y2,
        xref: "x",
        yref: "y",
        text: "",
        showarrow: true,
        arrowhead: 2,
        arrowsize: 1,
        arrowwidth: 1,
        arrowcolor: INK,
        ax: -ARROW_PX * ux,
        ay: -ARROW_PX * uy,
        standoff: options.pointSize / 2,
      },
    ];
  });
}

/** One subject's line per row through its present values, in column order:
 *  the traces, the segments between consecutive points (for arrowheads),
 *  and every plotted value (for the arrows' axis range). Shared by the
 *  plain before-after and the MV before-after bar-and-strip plot. */
function subjectTraces(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
): { data: unknown[]; segments: Segment[]; yAll: number[] } {
  const rows = rowCountOf(columns);
  const data: unknown[] = [];
  const segments: Segment[] = [];
  const yAll: number[] = [];

  for (let r = 0; r < rows; r++) {
    const pts = columns.flatMap((c, i) => {
      const v = c.byRow[r];
      return v == null ? [] : [{ i, v }];
    });
    // One value only is nothing to connect; a missing middle value just
    // spans the gap (only the present values are plotted, in column order).
    if (pts.length < 2) continue;
    const styles = pts.map((p) => paint.point(pointKeyOf(columns[p.i].name, r), columns[p.i].name, p.i));
    data.push(
      subjectTrace(
        titles?.[r]?.trim() || `Subject ${r + 1}`,
        pts.map((p) => p.i),
        pts.map((p) => p.v),
        styles,
        pts.map((p) => pointKeyOf(columns[p.i].name, r)),
        options,
      ),
    );
    for (let k = 1; k < pts.length; k++) {
      segments.push({ x1: pts[k - 1].i, y1: pts[k - 1].v, x2: pts[k].i, y2: pts[k].v });
    }
    yAll.push(...pts.map((p) => p.v));
  }
  return { data, segments, yAll };
}

function buildBeforeAfter(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
): GraphFigure {
  const names = columns.map((c) => c.name);
  const { data, segments, yAll } = subjectTraces(columns, options, paint, titles);

  names.forEach((name, i) => data.push(legendTrace(paint, name, i)));

  return {
    data,
    layout: {
      ...baseLayout(options, names),
      showlegend: names.length > 1,
      legend: { x: 1.02, y: 1, xanchor: "left", ...options.legend },
      margin: {
        ...marginsFor(options),
        r: names.length > 1 ? legendRightMargin(options, names) : 16,
      },
      ...(options.beforeAfterArrows && segments.length
        ? { annotations: arrowAnnotations(segments, options, [-0.5, names.length - 0.5], yAll, names) }
        : {}),
    },
  };
}

function buildGroupedBeforeAfter(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const total = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(total, labels) : undefined;
  const basePos = (g: number, r: number) => (separated ? separated.posOf(g, r) : r + groupOffset(g, total));
  const data: unknown[] = [];
  const segments: Segment[] = [];
  const yAll: number[] = [];

  // Replicate j of each group in the same row is the same subject under each
  // group; a replicate missing from a group just drops out of that subject's line.
  const reps = Math.max(0, ...groups.map((g) => g.columns.length));
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < reps; j++) {
      const pts = groups.flatMap((g, gi) => {
        const c = g.columns[j];
        const v = c?.byRow[r];
        return v == null || c == null ? [] : [{ gi, c, v }];
      });
      if (pts.length < 2) continue;
      const styles = pts.map((p) => paint.point(pointKeyOf(p.c.name, r), groups[p.gi].name, p.gi));
      data.push(
        subjectTrace(
          `${labels[r]} — rep ${j + 1}`,
          pts.map((p) => basePos(p.gi, r)),
          pts.map((p) => p.v),
          styles,
          pts.map((p) => pointKeyOf(p.c.name, r)),
          options,
        ),
      );
      for (let k = 1; k < pts.length; k++) {
        segments.push({
          x1: basePos(pts[k - 1].gi, r),
          y1: pts[k - 1].v,
          x2: basePos(pts[k].gi, r),
          y2: pts[k].v,
        });
      }
      yAll.push(...pts.map((p) => p.v));
    }
  }

  groups.forEach((g, i) => data.push(legendTrace(paint, g.name, i)));

  return {
    data,
    layout: {
      ...groupedScatterLayout(options, labels, total, separated, groups.map((g) => g.name)),
      ...(options.beforeAfterArrows && segments.length
        ? {
            annotations: arrowAnnotations(
              segments,
              options,
              separated ? separated.range : [-0.5, labels.length - 0.5],
              yAll,
              groups.map((g) => g.name),
            ),
          }
        : {}),
    },
  };
}

export const beforeAfter: GraphModule = {
  label: "Before-and-after",
  family: "column",
  points: () => true,
  lines: () => true,
  build: buildBeforeAfter,
};

/** "Before-after bar and strip plot" (Prism 11.1 MV gallery, seq 209): the
 *  paired-subject lines of a before-after plot over a bar at each variable's
 *  center with error whiskers — the same bars the Individual-values builder
 *  draws (COLUMN_BAR at the center, error whiskers on an invisible marker).
 *  Rows are the subjects, variables the conditions, in column order. */
function buildMvBeforeAfterBarStrip(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
): GraphFigure {
  const names = columns.map((c) => c.name);
  const center = centers(columns, options.center, options.series);
  const errs = errors(columns, options.error, center, options.series);
  const data: unknown[] = [];

  columns.forEach((c, i) => {
    data.push({
      ...COLUMN_BAR,
      x: [i],
      y: [center[i]],
      marker: paint.bars(c.name, i),
      hoverinfo: "skip",
    });
    if (errs) {
      data.push({
        type: "scatter",
        mode: "markers",
        x: [i],
        y: [center[i]],
        marker: { opacity: 0 },
        error_y: paint.errorBars(c.name, i, [errs.error[i]], errs.errorMinus ? [errs.errorMinus[i]] : undefined),
        hoverinfo: "skip",
      });
    }
  });

  const { data: subjects, segments, yAll } = subjectTraces(columns, options, paint, titles);
  data.push(...subjects);
  names.forEach((name, i) => data.push(legendTrace(paint, name, i)));

  return {
    data,
    layout: {
      ...baseLayout(options, names, { zeroBase: true }),
      showlegend: names.length > 1,
      legend: { x: 1.02, y: 1, xanchor: "left", ...options.legend },
      margin: {
        ...marginsFor(options),
        r: names.length > 1 ? legendRightMargin(options, names) : 16,
      },
      ...(options.beforeAfterArrows && segments.length
        ? { annotations: arrowAnnotations(segments, options, [-0.5, names.length - 0.5], yAll, names) }
        : {}),
    },
  };
}

export const mvBeforeAfterBarStrip: GraphModule = {
  label: "Before-after bar and strip plot",
  family: "column",
  points: () => true,
  lines: () => true,
  patterns: () => true,
  defaults: { fill: 0.5, error: "sd" },
  build: buildMvBeforeAfterBarStrip,
};

export const groupedBeforeAfter: GraphModule = {
  label: "Before-and-after",
  family: "grouped",
  points: () => true,
  lines: () => true,
  build: buildGroupedBeforeAfter,
};
