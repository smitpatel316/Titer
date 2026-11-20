// The choosing-k plots of a Hierarchical clustering: the Elbow plot
// (within-cluster sum of squares against k), the Silhouette plot (average
// silhouette width against k) and the Gap plot (Gap statistic ± SE against
// k) — the three guides for choosing k. Family `multiple`: the values come
// from a sibling hierarchical-clustering analysis's cached runAnalysis
// result (see graph-view.tsx) — each graph draws only its axes until one is
// chosen, exactly like the forest plot (see forest-plot.ts). The Elbow and
// Silhouette plots mark the analysis's chosen k; the Gap plot marks the
// Gap 1-SE rule's suggested k.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, ChoosingKRow } from "../../stats/types";
import type { Column } from "../../lib/dataset";
import { GUIDE, INK, xyLayout, type Paint } from "./plot-helpers";
import type { GraphFigure, GraphModule } from ".";

/** The one series each graph draws, as the Series section names it. */
export const ELBOW_SERIES = "Within-cluster SS";
export const SILHOUETTE_SERIES = "Average silhouette width";
export const GAP_SERIES = "Gap statistic";

/** A stat of the linked result, by its tabled label. */
const statOf = (outcome: AnalysisResult, label: string): number | null =>
  outcome.stats.find((s) => s.label === label)?.value ?? null;

/** A dashed vertical line at one k, labelled at the top of the plot. */
function markK(fig: GraphFigure, k: number | null, text: string): void {
  if (k == null) return;
  const layout = fig.layout as Record<string, unknown>;
  layout.shapes = [
    ...((layout.shapes as unknown[] | undefined) ?? []),
    {
      type: "line",
      x0: k,
      x1: k,
      y0: 0,
      y1: 1,
      yref: "paper",
      line: { color: GUIDE, width: 1, dash: "dash" },
    },
  ];
  layout.annotations = [
    ...((layout.annotations as unknown[] | undefined) ?? []),
    { x: k, y: 1, yref: "paper", text, showarrow: false, xanchor: "left", yanchor: "bottom" },
  ];
}

/** The shared axes setup for a choosing-k plot: the k values are whole
 *  numbers, so the X ticks step by 1. Returns the diagnostics rows and the
 *  analysis's chosen k, or null when the result has no diagnostics (not a
 *  hierarchical-clustering result, or the fit failed). */
function choosingKSetup(
  fig: GraphFigure,
  outcome: AnalysisResult,
): { rows: ChoosingKRow[]; chosenK: number | null } | null {
  const rows = outcome.choosingK ?? [];
  if (!rows.length) return null;
  const layout = fig.layout as Record<string, unknown>;
  layout.showlegend = true;
  layout.xaxis = { ...(layout.xaxis as Record<string, unknown>), dtick: 1 };
  return { rows, chosenK: statOf(outcome, "Number of clusters (k)") };
}

/** One line+markers trace over k, in its series' colour. */
function kTrace(
  series: string,
  ks: number[],
  ys: (number | null)[],
  paint: Paint,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "scatter",
    mode: "lines+markers",
    name: series,
    x: ks,
    y: ys,
    line: paint.line(series, 0),
    marker: { color: paint.color(series, 0), size: 6 },
    hovertemplate: "k = %{x}: %{y:.4g}<extra></extra>",
    showlegend: true,
    ...extra,
  };
}

/** Draw the Elbow plot of a hierarchical-clustering result onto an
 *  elbow-plot figure (its build's axes). */
export function addElbowPlot(fig: GraphFigure, outcome: AnalysisResult, paint: Paint): void {
  const setup = choosingKSetup(fig, outcome);
  if (!setup) return;
  fig.data = [kTrace(ELBOW_SERIES, setup.rows.map((r) => r.k), setup.rows.map((r) => r.withinSs), paint)];
  if (setup.chosenK != null) markK(fig, setup.chosenK, `k = ${setup.chosenK}`);
}

/** Draw the Silhouette plot of a hierarchical-clustering result onto a
 *  silhouette-plot figure (its build's axes). */
export function addSilhouettePlot(
  fig: GraphFigure,
  outcome: AnalysisResult,
  paint: Paint,
  options: GraphOptions,
): void {
  const setup = choosingKSetup(fig, outcome);
  if (!setup) return;
  const layout = fig.layout as Record<string, unknown>;
  // A silhouette width lives on [−1, 1] by definition — unless the user
  // typed bounds, which replace the fixed range (the scree plot's G-F8
  // precedent: a typed bound is honoured, never silently ignored).
  const userY = options.yMin != null || options.yMax != null;
  if (!userY) {
    layout.yaxis = { ...(layout.yaxis as Record<string, unknown>), range: [-1, 1], autorange: false };
  }
  fig.data = [
    kTrace(SILHOUETTE_SERIES, setup.rows.map((r) => r.k), setup.rows.map((r) => r.avgSilhouette), paint),
  ];
  if (setup.chosenK != null) markK(fig, setup.chosenK, `k = ${setup.chosenK}`);
}

/** Draw the Gap plot of a hierarchical-clustering result onto a gap-plot
 *  figure (its build's axes). */
export function addGapPlot(fig: GraphFigure, outcome: AnalysisResult, paint: Paint): void {
  const setup = choosingKSetup(fig, outcome);
  if (!setup) return;
  fig.data = [
    kTrace(GAP_SERIES, setup.rows.map((r) => r.k), setup.rows.map((r) => r.gap), paint, {
      error_y: {
        type: "data",
        array: setup.rows.map((r) => r.gapSe ?? 0),
        visible: true,
        color: INK,
      },
    }),
  ];
  const suggestedK = statOf(outcome, "Suggested k (Gap 1-SE rule)");
  if (suggestedK != null) markK(fig, suggestedK, `Suggested k = ${suggestedK}`);
}

function elbowBuild(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  return {
    data: [],
    layout: xyLayout(options, "k (number of clusters)", 1, { yName: "Within-cluster SS" }),
  };
}

function silhouetteBuild(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  return {
    data: [],
    layout: xyLayout(options, "k (number of clusters)", 1, { yName: "Average silhouette width" }),
  };
}

function gapBuild(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  return {
    data: [],
    layout: xyLayout(options, "k (number of clusters)", 1, { yName: "Gap statistic" }),
  };
}

export const elbowPlot: GraphModule = {
  label: "Elbow plot",
  family: "multiple",
  points: () => false,
  build: elbowBuild,
};

export const silhouettePlot: GraphModule = {
  label: "Silhouette plot",
  family: "multiple",
  points: () => false,
  build: silhouetteBuild,
};

export const gapPlot: GraphModule = {
  label: "Gap plot",
  family: "multiple",
  points: () => false,
  build: gapBuild,
};
