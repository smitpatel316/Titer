// "ROC curve": sensitivity against 1 − specificity across all thresholds, the
// diagonal chance line, and a marker at the optimal (Youden) cutpoint. Family
// `xy`: it is an X/Y scatter of derived points, not table columns. The points
// come from `computeRocCurve` in the runner module — the same arithmetic the
// analysis runs — so the graph works standalone (no analysis node needed) and
// its numbers agree exactly with the analysis result by construction, rather
// than by a second computation. The truth column may be text
// ("Diseased"/"Healthy"): `plotColumns` hands this graph the first two data
// columns whatever they hold (see graphs/index.ts).
import type { GraphOptions } from "../../store/types";
import type { Column } from "../../lib/dataset";
import { computeRocCurve, defaultPositive, rocPairs } from "../../stats/column/roc-curve";
import { num } from "../../lib/format";
import { GUIDE, INK, xyLayout, type Paint } from "./plot-helpers";
import type { GraphFigure, GraphModule } from ".";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const layout = xyLayout(options, "1 − Specificity", 1, { yName: "Sensitivity" });
  const axes = {
    // Both axes are fixed 0–1 (an ROC curve has no values outside them) —
    // unless the user typed bounds, which replace the fixed range (G-F8: the
    // inputs were silently ignored). xyLayout already applied a typed bound,
    // in log units on a log axis, so leaving its axis alone honours it.
    // Equal aspect is not forced: on a wider-than-tall sheet Plotly's
    // scaleanchor would stretch the X range past [0, 1] to keep it square.
    xaxis: {
      ...(layout.xaxis as Record<string, unknown>),
      ...(options.xMin == null && options.xMax == null ? { range: [0, 1] } : {}),
    },
    yaxis: {
      ...(layout.yaxis as Record<string, unknown>),
      ...(options.yMin == null && options.yMax == null ? { range: [0, 1] } : {}),
    },
  };
  const [truthCol, scoreCol] = columns;
  if (!truthCol || !scoreCol) return { data: [], layout: { ...layout, ...axes } };
  const { pairs } = rocPairs(truthCol, scoreCol);
  const distinct = [...new Set(pairs.map((p) => p.label))];
  if (distinct.length !== 2) return { data: [], layout: { ...layout, ...axes } };
  const r = computeRocCurve(pairs, defaultPositive(distinct));
  const color = paint.color(scoreCol.name, 0);
  // The empirical ROC curve: the runner's points already include the (0,0)
  // and (1,1) endpoints (plan 05), so they are drawn as-is — no endpoint
  // is added here (adding them again would duplicate the corners).
  const x = r.points.map((p) => 1 - p.specificity);
  const y = r.points.map((p) => p.sensitivity);
  const optX = 1 - r.optimum.specificity;
  const optY = r.optimum.sensitivity;
  const data: unknown[] = [
    {
      type: "scatter",
      mode: "lines+markers",
      name: "ROC curve",
      x,
      y,
      line: { color, width: 2 },
      marker: { color, size: 5 },
      hoverinfo: "x+y",
      showlegend: false,
    },
    {
      type: "scatter",
      mode: "lines",
      name: "Chance",
      x: [0, 1],
      y: [0, 1],
      line: { color: GUIDE, width: 1.5, dash: "dash" },
      hoverinfo: "skip",
      showlegend: false,
    },
    {
      type: "scatter",
      mode: "markers",
      name: `Optimal cutpoint ${num(r.optimum.threshold)}`,
      x: [optX],
      y: [optY],
      marker: { color, size: 12, symbol: "circle-open", line: { width: 2.5 } },
      text: [`Optimal cutpoint ${num(r.optimum.threshold)}`],
      hoverinfo: "text+x+y",
      showlegend: false,
    },
  ];
  // The annotation flips by quadrant, so it never clips at the plot edge:
  // the axes are fixed [0, 1], so an optimum at the top or right sits on the
  // edge and a fixed (30, −30) offset put the label outside the plot (a
  // near-perfect classifier's optimum (0, 1) had its label above the plot).
  // The text is anchored so it extends away from the nearest edge.
  const annotations: unknown[] = [
    {
      x: optX,
      y: optY,
      xref: "x",
      yref: "y",
      text: `Optimal cutpoint ${num(r.optimum.threshold)}`,
      showarrow: true,
      arrowhead: 2,
      arrowsize: 1,
      arrowwidth: 1,
      arrowcolor: INK,
      ax: optX > 0.5 ? -30 : 30,
      ay: optY > 0.5 ? 30 : -30,
      xanchor: optX > 0.5 ? "right" : "left",
      yanchor: optY > 0.5 ? "top" : "bottom",
      font: { color: INK, size: Math.max(options.fontSize - 1, 8) },
    },
  ];
  return { data, layout: { ...layout, ...axes, annotations } };
}

export const rocCurveGraph: GraphModule = {
  label: "ROC curve",
  family: "xy",
  points: () => true,
  lines: () => true,
  build,
};
