// "Scree plot" of a Principal component analysis: one bar per component
// (its % of the total variance) with the cumulative % as a line on a
// secondary axis. Family `multiple`: the bars come from a sibling PCA's
// cached runAnalysis result (see graph-view.tsx) — the graph draws only its
// axes until one is chosen, exactly like the forest plot (see forest-plot.ts).
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult } from "../../stats/types";
import type { Column } from "../../lib/dataset";
import { INK, type Paint, xyLayout } from "./plot-helpers";
import type { GraphFigure, GraphModule } from ".";

/** The one series this graph draws, as the Series section names it. */
export const SCREE_SERIES = "Scree plot";

/** Draw the scree bars + cumulative-% line of a PCA result onto a scree-plot
 *  figure (its build's axes). No-op when the result has no variance table
 *  (not a PCA result, or the fit failed). */
export function addScreePlot(fig: GraphFigure, outcome: AnalysisResult, paint: Paint, options: GraphOptions): void {
  const variance = outcome.pcaVariance ?? [];
  if (!variance.length) return;
  const xs = variance.map((v) => v.component);
  const pct = variance.map((v) => (v.proportion ?? 0) * 100);
  const cum = variance.map((v) => (v.cumulative ?? 0) * 100);
  const layout = fig.layout as Record<string, unknown>;
  layout.showlegend = true;
  layout.xaxis = {
    ...(layout.xaxis as Record<string, unknown>),
    type: "category",
    categoryorder: "array",
    categoryarray: xs,
  };
  // Both Y axes are percentages, 0–100 by definition — unless the user typed
  // bounds, which replace the fixed range on both (G-F8: the inputs were
  // silently ignored). They must match: both axes are %. A bound typed on
  // one side only leaves that side to xyLayout's clamp, and the second axis
  // follows with the same bound.
  const userY = options.yMin != null || options.yMax != null;
  layout.yaxis = {
    ...(layout.yaxis as Record<string, unknown>),
    ...(userY ? {} : { range: [0, 100], autorange: false }),
  };
  layout.yaxis2 = {
    title: { text: "Cumulative %", standoff: 2 },
    overlaying: "y",
    side: "right",
    range: [options.yMin ?? 0, options.yMax ?? 100],
    autorange: false,
    tickfont: { color: INK },
  };
  fig.data = [
    {
      type: "bar",
      name: "Variance explained",
      x: xs,
      y: pct,
      marker: paint.bars(SCREE_SERIES, 0),
      hovertemplate: "%{x}: %{y:.2f}%<extra></extra>",
      showlegend: true,
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Cumulative %",
      x: xs,
      y: cum,
      yaxis: "y2",
      line: { color: INK, width: 2 },
      marker: { color: INK, size: 6 },
      hovertemplate: "%{x}: %{y:.2f}%<extra></extra>",
      showlegend: true,
    },
  ];
}

function build(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  // X is the components (labels), never a log scale: a stale saved log X
  // must not turn the category axis logarithmic (seq 572, #100).
  return {
    data: [],
    layout: xyLayout({ ...options, xScale: "linear" }, "Component", 1, { yName: "Variance explained (%)" }),
  };
}

export const screePlot: GraphModule = {
  label: "Scree plot",
  family: "multiple",
  axes: () => ({ x: "labels", y: "scale" }),
  points: () => false,
  build,
};
