// "Covariance heatmap" of a Multiple linear regression: the sibling
// analysis's coefficients' covariance matrix (seq 198) drawn as a heatmap —
// one cell per pair of coefficients, coloured on a diverging scale centred
// at 0 (a positive covariance is red, a negative one blue, the diagonal's
// variances the deepest red). Family `multiple`: the cells come from the
// sibling regression's cached runAnalysis result (see graph-view.tsx) —
// the graph draws only its axes until one is chosen, exactly like the
// scree plot (see scree-plot.ts). The covariance is signed, so the scale
// is diverging and symmetric about 0 (zmin/zmax = ∓ the largest
// |covariance|); a sequential palette would hide the sign.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, CovarianceMatrix } from "../../stats/types";
import { num } from "../../lib/format";
import type { Column } from "../../lib/dataset";
import { heatmapLayout, type Paint } from "./plot-helpers";
import type { GraphFigure, GraphModule } from ".";

/** A diverging blue–white–red scale (ColorBrewer RdBu's endpoints): the
 *  midpoint is 0, so white is no covariance and the hue is its sign. */
const DIVERGING: [number, string][] = [
  [0, "#2166ac"],
  [0.5, "#f7f7f7"],
  [1, "#b2182b"],
];

/** The heatmap's geometry from a covariance matrix: the variables on both
 *  axes, the matrix as the cells, and symmetric limits about 0 — the
 *  largest |covariance| either way (a degenerate all-null matrix draws
 *  on ±1, so the scale never collapses to a point). Pure, so the seq 198
 *  check pins it straight off a runAnalysis result. */
export function covarianceHeatmapFigure(covariance: CovarianceMatrix): {
  x: string[];
  y: string[];
  z: (number | null)[][];
  zmin: number;
  zmax: number;
} {
  const flat = covariance.values.flat().filter((v): v is number => v != null && Number.isFinite(v));
  const maxAbs = flat.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  const span = maxAbs > 0 ? maxAbs : 1;
  return { x: covariance.variables, y: covariance.variables, z: covariance.values, zmin: -span, zmax: span };
}

/** Draw a multiple-regression result's covariance matrix onto a
 *  covariance-heatmap figure (its build's axes). No-op when the result has
 *  no covariance matrix (not a multiple-regression result, or the fit
 *  failed). */
export function addCovarianceHeatmap(fig: GraphFigure, outcome: AnalysisResult, options: GraphOptions): void {
  const covariance = outcome.covariance;
  if (!covariance || !covariance.variables.length) return;
  const { x, y, z, zmin, zmax } = covarianceHeatmapFigure(covariance);
  fig.data = [
    {
      type: "heatmap",
      x,
      y,
      z,
      zmin,
      zmax,
      colorscale: DIVERGING,
      showscale: options.heatmapShowScale,
      // Its color legend: right of the cells, or where it was moved; its numbers written
      // out, as the axes' (never "10µ").
      colorbar: { exponentformat: "none", ...options.legend },
      hoverongaps: false,
      // The values, formatted with the shared num() (4 sig figs) — the raw
      // %{z} printed every digit, so a long value overflowed its narrow
      // cell and overlapped its neighbours (G-F13, as in heatmap.ts).
      // A gap cell stays blank; hover still shows the raw value.
      text: z.map((row) => row.map((v) => (v == null ? "" : num(v)))),
      texttemplate: "%{text}",
      textfont: { size: Math.max(options.fontSize - 3, 8) },
    },
  ];
  fig.layout = heatmapLayout(options, x, y);
}

function build(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  return { data: [], layout: heatmapLayout(options, [], []) };
}

export const covarianceHeatmap: GraphModule = {
  label: "Covariance heatmap",
  family: "multiple",
  axes: () => ({ x: "labels", y: "labels" }),
  points: () => false,
  build,
};
