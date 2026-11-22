// "Residual plot": how far each point lies from its data set's straight line (least squares,
// `fitLinear`, R's lm), against X, around a line at 0: a pattern (a curve, a funnel) says the
// line or its constant scatter doesn't fit. Or (`residualsAs` "qq") the residuals' QQ plot:
// whether they are normal, as the regression assumes.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, xyPoints, type Column } from "../../lib/dataset";
import { fitLinear, linearFitProblem } from "./regression-overlay";
import { addNote, INK, seriesMarker, xyLayout, type Paint } from "./plot-helpers";
import { qqTraces } from "./qq-plot";

/** Each Y data set's points (its replicates each) and their residuals on its line. */
export function residualsOf(columns: Column[]): { name: string; x: number[]; residuals: number[] }[] {
  const { x, ys } = splitXY(columns);
  if (!x) return [];
  return ys.flatMap((set) => {
    const pairs = xyPoints(x, set);
    const fit = fitLinear(pairs.x, pairs.y, false);
    return fit
      ? [{ name: set.name, x: pairs.x, residuals: pairs.y.map((y, i) => y - (fit.intercept + fit.slope * pairs.x[i])) }]
      : [];
  });
}

/** Why each Y data set's line cannot be fitted — named on the figure (G-F8)
 *  instead of silently drawing nothing, with the same reasons the
 *  regression overlay reports for the same fit. */
function residualProblems(columns: Column[]): string[] {
  const { x, ys } = splitXY(columns);
  if (!x) return [];
  return ys.flatMap((set) => {
    const pairs = xyPoints(x, set);
    const reason = linearFitProblem(pairs.x, pairs.y, false);
    return reason ? [`Residual plot for “${set.name}” not drawn: ${reason}.`] : [];
  });
}

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const sets = residualsOf(columns);
  let data: unknown[];
  let layout: Record<string, unknown>;
  if (options.residualsAs === "qq") {
    data = qqTraces(
      sets.map((s) => ({ name: s.name, values: s.residuals })),
      paint,
    );
    layout = xyLayout({ ...options, xScale: "linear" }, "Normal quantile (z)", sets.length, { yName: "Residual" });
  } else {
    const xName = splitXY(columns).x?.name ?? "X";
    data = sets.map((s, i) => ({
      type: "scatter",
      mode: "markers",
      name: s.name,
      x: s.x,
      y: s.residuals,
      marker: seriesMarker(paint, s.name, i),
      hoverinfo: "x+y",
    }));
    layout = xyLayout(options, xName, sets.length, { yName: "Residual" });
    // The line at 0, across the plot.
    layout.shapes = [
      { type: "line", xref: "paper", x0: 0, x1: 1, yref: "y", y0: 0, y1: 0, line: { color: INK, width: 1, dash: "dot" } },
    ];
  }
  const fig: GraphFigure = { data, layout };
  const failed = residualProblems(columns);
  if (failed.length) addNote(fig, failed.join("<br>"), options);
  return fig;
}

export const residuals: GraphModule = { label: "Residual plot", family: "xy", points: () => true, build };
