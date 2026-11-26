// "XY column / bar": each Y data set drawn as bars against the shared X, grouped
// side-by-side at each X value when there's more than one data set (replicates as each
// X's center with its error bars, `xyDrawn`).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { rightYDataset, xErrorColumn, XY_AXES, xyDrawn, xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint, _titles?: (string | null)[], summary?: SummaryFormat): GraphFigure {
  const { x: xCol, ys: allYs } = splitXY(columns);
  // The X-error column, while X error bars are on, is the bars — not a series.
  const xErr = xCol && options.xError ? xErrorColumn(columns, xCol) : undefined;
  const ys = xErr ? allYs.filter((s) => s.name !== xErr.name) : allYs;
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const right = rightYDataset(options, ys.map((y) => y.name));
  const data = ys.map((set, i) => {
    // A bar stands for one value per X: replicates as their center, whatever `xyReplicates`.
    const drawn = xyDrawn(xCol, set, { ...options, xyReplicates: "mean" }, summary, xErr);
    return {
      type: "bar",
      name: set.name,
      x: drawn.x,
      y: drawn.y,
      ...(set.name === right ? { yaxis: "y2" } : {}),
      marker: paint.bars(set.name, i),
      ...(drawn.errors ? { error_y: paint.errorBars(set.name, i, drawn.errors, drawn.errorMinus) } : {}),
      ...(drawn.xErrors ? { error_x: paint.errorBars(set.name, i, drawn.xErrors) } : {}),
      hoverinfo: "x+y",
    };
  });

  // An X's bars apart by `barGap`, so their outlines never overlap.
  return {
    data,
    layout: {
      ...xyLayout(options, xCol.name, ys.length, { zeroBase: true, seriesNames: ys.map((y) => y.name), rightY: right }),
      barmode: "group",
      bargroupgap: options.barGap,
    },
  };
}

export const xyBar: GraphModule = {
  label: "Column or bar",
  family: "xy",
  axes: XY_AXES,
  patterns: () => true,
  // A bar stands for one value per X: replicates as their center, whatever `xyReplicates`.
  summarizes: () => true,
  build,
};
