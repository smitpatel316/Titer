// "XY area": each Y data set drawn as a line with the area beneath it filled,
// against the shared X (replicates as each X's center, `xyDrawn`).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { rightYDataset, xErrorColumn, xyDrawn, xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint, _titles?: (string | null)[], summary?: SummaryFormat): GraphFigure {
  const { x: xCol, ys: allYs } = splitXY(columns);
  // The X-error column, while X error bars are on, is the bars — not a series.
  const xErr = xCol && options.xError ? xErrorColumn(columns, xCol) : undefined;
  const ys = xErr ? allYs.filter((s) => s.name !== xErr.name) : allYs;
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const right = rightYDataset(options, ys.map((y) => y.name));
  const data = ys.map((set, i) => {
    // An area joins one value per X: replicates as their center, whatever `xyReplicates`.
    const raw = xyDrawn(xCol, set, { ...options, xyReplicates: "mean" }, summary, xErr);
    // Filled in X order, not table row order: the fill must follow the trend.
    const order = raw.x.map((_, k) => k).sort((a, b) => raw.x[a] - raw.x[b]);
    const drawn = {
      x: order.map((k) => raw.x[k]),
      y: order.map((k) => raw.y[k]),
      ...(raw.errors ? { errors: order.map((k) => raw.errors![k]) } : {}),
      ...(raw.errorMinus ? { errorMinus: order.map((k) => raw.errorMinus![k]) } : {}),
      ...(raw.xErrors ? { xErrors: order.map((k) => raw.xErrors![k]) } : {}),
    };
    const over = paint.pattern(set.name, i);
    return {
      type: "scatter",
      mode: "lines",
      name: set.name,
      x: drawn.x,
      y: drawn.y,
      ...(set.name === right ? { yaxis: "y2" } : {}),
      line: paint.edge(set.name, i),
      fill: "tozeroy",
      fillcolor: paint.fill(set.name, i),
      ...(over && { fillpattern: over }),
      ...(drawn.errors ? { error_y: paint.errorBars(set.name, i, drawn.errors, drawn.errorMinus) } : {}),
      ...(drawn.xErrors ? { error_x: paint.errorBars(set.name, i, drawn.xErrors) } : {}),
      hoverinfo: "x+y",
    };
  });

  return { data, layout: xyLayout(options, xCol.name, ys.length, { zeroBase: true, seriesNames: ys.map((y) => y.name), rightY: right }) };
}

export const xyArea: GraphModule = {
  label: "Area",
  family: "xy",
  defaults: { fill: 0.5, outline: 2 },
  patterns: () => true,
  build,
};
