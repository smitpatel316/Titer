// Shared builders for the Grouped family (GraphPad "Grouped" graph type). A
// grouped table's columns are `groups × replicates` sub-columns and its rows are
// the X categories, so every grouped graph plots one series per group across the
// row categories. The bar variants (interleaved / stacked / horizontal) share one
// builder; individual values get their own interleaved-scatter builder.
import type { GraphOptions } from "../../store/types";
import type { GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import {
  rowCountOf,
  rowLabels,
  perRowStats,
  perRowSummaryStats,
  groupOffset,
  groupedBarGeometry,
  groupedBarLayout,
  groupedBarPositions,
  groupedScatterLayout,
  jitter,
  separatedPositions,
  seriesCenter,
  seriesError,
  seriesMarker,
  seriesPoints,
  scatterOffsets,
  type Paint,
} from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";
import type { SummaryFormat } from "../../lib/summary-format";

/** Interleaved / stacked / horizontal bars: one bar trace per group, bar height =
 *  the group's center (mean/median) per row. Stacked bars omit error whiskers
 *  (they'd overlap the stack); interleaved/horizontal show them when enabled.
 *  "Separated" (group mode only — stacking already combines groups per category)
 *  gives each group its own block of categories instead of interleaving within
 *  each row's slot. On a summary table (`summary` ≠ "replicates") the bars are
 *  the stored Means and the whiskers the stored errors (converted to the
 *  graph's error kind); there are no replicates to average. With `showPoints`
 *  on an interleaved replicates table, each group's individual values are
 *  overlaid as a points trace centered on its own bar (jitter scaled to the
 *  bar width, so points stay inside the bar for any group count); the bars
 *  then take numeric category positions instead of Plotly's "category" axis,
 *  as the separated layout already does — at the `groupedBarGeometry`
 *  centers, with an explicit `width`, so the bars keep the category axis's
 *  Prism proportions instead of going thin with an inverted gap (seq 547).
 *  Stacked bars and summary tables never draw points (a stack's total is not
 *  its replicates' values, and a summary table has no individual values).
 *  Superimposed bars keep their row-centered X coordinates (`r`) even with
 *  `showPoints` on — splitting them into side-by-side numeric positions
 *  would break the superimposition and desync the bars from the
 *  significance brackets, which sit at `r` (Issue #92); their points sit
 *  at the row center too. */
export function buildGroupedBars(
  columns: Column[],
  options: GraphOptions,
  mode: "group" | "stack",
  horizontal: boolean,
  paint: Paint,
  titles?: (string | null)[],
  summary: SummaryFormat = "replicates",
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const showError = mode !== "stack";
  const separated =
    mode === "group" && options.groupLayout === "separated" ? separatedPositions(groups.length, labels) : undefined;
  const pointsOn = mode === "group" && options.showPoints && summary === "replicates";
  // Superimposed (Prism's "Data Sets on Graph" relation): every group's bar
  // runs from the axis to its value at the same x — Plotly's barmode
  // "overlay" — instead of standing side by side. Later groups draw over
  // earlier ones, so a taller bar hides a shorter one behind it unless the
  // fill is semi-transparent (the Format panel says so); the gap between
  // bars has nothing to separate here. Stacked bars never superimpose.
  // Superimposed bars stay row-centered even with points overlaid (Issue
  // #92): numeric interleaved positions would split them apart and desync
  // them from the significance brackets at `r`.
  const superimposed = mode === "group" && options.groupLayout === "superimposed";
  // Numeric category positions whenever the bars leave the "category" axis:
  // separated blocks, or interleaved bars with points overlaid (the points
  // need numeric places to sit on their own bar). Interleaved bars with
  // points use the grouped-bar geometry — Plotly sizes bars from the
  // smallest gap between bar positions, so the old `groupOffset` centers
  // made them thin with a bigger gap between paired bars than between
  // conditions (seq 547); the explicit width below restores the
  // category-axis proportions. Separated bars already get their width
  // from a 1-slot spacing, so they need neither. Superimposed bars need
  // neither either: they stay on the category axis at the row centers.
  const barGeom = pointsOn && !separated && !superimposed ? groupedBarGeometry(groups.length, options.barGap) : undefined;
  const positions = separated ?? (pointsOn && !superimposed ? groupedBarPositions(groups.length, labels, options.barGap) : undefined);

  // A summary table's stats and a replicates table's both carry a lower
  // side for the asymmetric kinds (range, IQR, geometric SD/CI) — the two
  // shapes are normalised to the same { center, error, errorMinus }.
  const stats = groups.map((g) => {
    // One group, one series: its center/error override governs every row.
    const center = seriesCenter(options.series, g.name, options.center);
    const error = showError ? seriesError(options.series, g.name, options.error) : "none";
    return summary === "replicates"
      ? perRowStats(g.columns, rows, center, error)
      : perRowSummaryStats(g.columns, rows, summary, error);
  });
  // 100 % stacked bars: each group's share of its row's total.
  const percent = mode === "stack" && options.stackAs === "percent";
  if (percent) {
    for (let r = 0; r < rows; r++) {
      const total = stats.reduce((sum, s) => sum + (s.center[r] ?? 0), 0);
      for (const s of stats) s.center[r] = s.center[r] == null || total === 0 ? null : (100 * s.center[r]!) / total;
    }
  }

  const data: unknown[] = groups.map((g, i) => {
    const { center, error, errorMinus } = stats[i];
    const errArr = error ? error.map((e) => e ?? NaN) : null; // NaN: no error bar
    const errMinusArr = errorMinus ? errorMinus.map((e) => e ?? NaN) : undefined;
    const x = positions ? Array.from({ length: rows }, (_, r) => positions.posOf(i, r)) : labels;
    return {
      type: "bar",
      name: g.name,
      orientation: horizontal ? "h" : "v",
      [horizontal ? "y" : "x"]: x,
      [horizontal ? "x" : "y"]: center,
      // Explicit width: Plotly centers an explicit-width bar on its x, so
      // the bars keep their category-axis width when the axis goes numeric.
      ...(barGeom ? { width: barGeom.width } : {}),
      marker: paint.bars(g.name, i),
      ...(errArr
        ? {
            [horizontal ? "error_x" : "error_y"]: paint.errorBars(g.name, i, errArr, errMinusArr),
          }
        : {}),
      hoverinfo: horizontal ? "y+x" : "x+y",
    };
  });

  // The individual points for each group, centered on their own bar — on
  // top of the bars (later traces draw above). The jitter (±0.15) is scaled
  // to the bar width (× 2×width caps the offset at 0.3×width), so points
  // stay inside their bar for any group count; separated bars are wide
  // enough that the legacy ±0.06 spread already fits.
  if (pointsOn) {
    const jitterAmp = barGeom ? 2 * barGeom.width : 0.4;
    groups.forEach((g, gi) => {
      // No numeric positions (superimposed): the points sit at the row
      // center, on their bar — the same `r` the significance brackets use.
      const basePos = (r: number) => (positions ? positions.posOf(gi, r) : r);
      const px: number[] = [];
      const py: number[] = [];
      const pointKeys: string[] = [];
      for (let r = 0; r < rows; r++) {
        g.columns.forEach((c, ci) => {
          const v = c.byRow[r] ?? null;
          if (v != null) {
            px.push(basePos(r) + jitter(gi, r * 10 + ci) * jitterAmp);
            py.push(v);
            pointKeys.push(pointKeyOf(c.name, r));
          }
        });
      }
      data.push({
        type: "scatter",
        mode: "markers",
        name: g.name,
        [horizontal ? "y" : "x"]: px,
        [horizontal ? "x" : "y"]: py,
        ...seriesPoints(paint, g.name, gi, pointKeys),
        hoverinfo: horizontal ? "x" : "y",
        showlegend: false,
      });
    });
  }

  // A row's bars apart by `barGap`, so their outlines never overlap —
  // except superimposed bars, which share one x by design.
  const gap = mode === "group" && !separated && !superimposed ? { bargroupgap: options.barGap } : {};
  return {
    data,
    layout: {
      ...groupedBarLayout(
        // Percent bars say so on their axis, until it is titled by hand.
        percent && !options.yLabel ? { ...options, yLabel: "Percent of total" } : options,
        groups.length,
        { horizontal, positions, seriesNames: groups.map((g) => g.name) },
      ),
      barmode: superimposed ? "overlay" : mode,
      ...gap,
    },
  };
}

/** Bars with individual points (Prism 8+'s built-in grouped choice): the
 *  interleaved bars of `buildGroupedBars` with every replicate drawn as a
 *  jittered point on its own bar. The bars already carry the center and the
 *  error whiskers, so no center line is drawn twice. On a summary table
 *  there are no individual values to plot — the bars alone. Superimposed
 *  bars put every group's points at the row's center, on their bar; the
 *  interleaved and separated arrangements fan them out with their group.
 *  Delegating with `showPoints: true` draws the points inside
 *  `buildGroupedBars`, on the bars' own numeric positions with the figure's
 *  numeric axis — drawing them here instead appended float scatter X onto
 *  the bars' categorical axis (Issue #31), and drawing them in both places
 *  drew every point twice, with a second legend entry. */
export function buildGroupedBarsScatter(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
  summary: SummaryFormat = "replicates",
): GraphFigure {
  return buildGroupedBars(columns, { ...options, showPoints: true }, "group", false, paint, titles, summary);
}

/** Connected/interaction lines: one line per group through its per-row centers
 *  (mean/median), a marker at each row, and optional error whiskers. Lines connect
 *  each group across the row categories, so parallel lines mean no interaction and
 *  crossing/diverging lines highlight one (Prism's interaction graph). On a
 *  summary table the centers are the stored Means and the whiskers the stored
 *  errors, as for bars. */
export function buildGroupedLines(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
  summary: SummaryFormat = "replicates",
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const x = labels.map((_, i) => i);

  const data = groups.map((g, i) => {
    // One group, one series: its center/error override governs every row.
    const { center, error, errorMinus } =
      summary === "replicates"
        ? perRowStats(g.columns, rows, seriesCenter(options.series, g.name, options.center), seriesError(options.series, g.name, options.error))
        : perRowSummaryStats(g.columns, rows, summary, seriesError(options.series, g.name, options.error));
    return {
      type: "scatter",
      mode: "lines+markers",
      name: g.name,
      x,
      y: center,
      // Break the line at rows where this group has no data instead of interpolating across.
      connectgaps: false,
      line: paint.line(g.name, i),
      marker: seriesMarker(paint, g.name, i),
      ...(error
        ? {
            error_y: paint.errorBars(
              g.name,
              i,
              error.map((e) => e ?? NaN),
              errorMinus ? errorMinus.map((e) => e ?? NaN) : undefined,
            ),
          }
        : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: groupedScatterLayout(options, labels, groups.length, undefined, groups.map((g) => g.name)) };
}

/** Interleaved scatter (individual values): every replicate as a jittered point,
 *  groups fanned out within each row (or, in "Separated" layout, given their own
 *  block of categories), plus a short center line and optional error whiskers
 *  per group. On a summary table there are no individual values to plot — the
 *  points trace is skipped and only the center line and whiskers are drawn
 *  (from the stored Means and errors). */
export function buildGroupedScatter(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
  summary: SummaryFormat = "replicates",
): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const total = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(total, labels) : undefined;
  const data: unknown[] = [];

  groups.forEach((g, gi) => {
    const basePos = (r: number) => (separated ? separated.posOf(gi, r) : r + groupOffset(gi, total));

    // The individual points for this group — none on a summary table.
    if (summary === "replicates") {
      const px: number[] = [];
      const py: number[] = [];
      const pointKeys: string[] = [];
      for (let r = 0; r < rows; r++) {
        const offs = scatterOffsets(
          g.columns.map((c) => c.byRow[r] ?? null),
          options.scatterStyle,
          gi,
          r * 10,
        );
        g.columns.forEach((c, ci) => {
          const v = c.byRow[r] ?? null;
          if (v != null) {
            px.push(basePos(r) + offs[ci] * 0.4);
            py.push(v);
            pointKeys.push(pointKeyOf(c.name, r));
          }
        });
      }
      data.push({
        type: "scatter",
        mode: "markers",
        name: g.name,
        x: px,
        y: py,
        ...seriesPoints(paint, g.name, gi, pointKeys),
        hoverinfo: "y",
      });
    }

    // Center line + optional error whiskers at each row for this group.
    // One group, one series: its center/error override governs every row.
    const { center, error, errorMinus } =
      summary === "replicates"
        ? perRowStats(g.columns, rows, seriesCenter(options.series, g.name, options.center), seriesError(options.series, g.name, options.error))
        : perRowSummaryStats(g.columns, rows, summary, seriesError(options.series, g.name, options.error));
    const lineX: (number | null)[] = [];
    const lineY: (number | null)[] = [];
    center.forEach((c, r) => {
      if (c != null) {
        const p = basePos(r);
        lineX.push(p - 0.1, p + 0.1, null);
        lineY.push(c, c, null);
      }
    });
    data.push({
      type: "scatter",
      mode: "lines",
      x: lineX,
      y: lineY,
      line: paint.centerLine(g.name, gi),
      hoverinfo: "skip",
      showlegend: false,
    });

    if (error) {
      const ex: number[] = [];
      const ey: number[] = [];
      const ea: number[] = [];
      const em: number[] = [];
      center.forEach((c, r) => {
        if (c != null) {
          ex.push(basePos(r));
          ey.push(c);
          ea.push(error[r] ?? NaN);
          em.push(errorMinus?.[r] ?? NaN);
        }
      });
      data.push({
        type: "scatter",
        mode: "markers",
        x: ex,
        y: ey,
        marker: { opacity: 0 },
        error_y: paint.errorBars(g.name, gi, ea, errorMinus ? em : undefined),
        hoverinfo: "skip",
        showlegend: false,
      });
    }
  });

  return { data, layout: groupedScatterLayout(options, labels, total, separated, groups.map((g) => g.name)) };
}
