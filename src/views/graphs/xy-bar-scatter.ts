// "XY bar + scatter": bars and points on one graph (Prism combines bar graphs
// and XY on one graph with XY data). The bars are each X's center with its
// error bars (`xyDrawn` with replicates as their mean, as the bar graph does);
// the scatter part reuses `xyStyle` for its points/lines and `xyReplicates`
// for which values it shows, so replicates can sit as individual points over
// the mean bars. On a summary table both parts draw the stored Means (the
// bars with the converted error; the points carry no second set of whiskers).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { rightYDataset, seriesMarker, seriesPoints, xyDrawn, xyLayout, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint, _titles?: (string | null)[], summary?: SummaryFormat): GraphFigure {
  const { x: xCol, ys } = splitXY(columns);
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const mode = options.xyStyle === "line" ? "lines" : options.xyStyle === "points+line" ? "lines+markers" : "markers";
  const right = rightYDataset(options, ys.map((y) => y.name));
  const data = ys.flatMap((set, i) => {
    // A bar stands for one value per X: replicates as their center, whatever `xyReplicates`.
    const bars = xyDrawn(xCol, set, { ...options, xyReplicates: "mean" }, summary);
    // The scatter part follows the options as they stand.
    const points = xyDrawn(xCol, set, options, summary);
    const order =
      mode !== "markers" ? points.x.map((_, k) => k).sort((a, b) => points.x[a] - points.x[b]) : points.x.map((_, k) => k);
    const pick = <T>(v: T[] | undefined) => (v ? order.map((k) => v[k]) : undefined);
    return [
      {
        type: "bar",
        name: set.name,
        x: bars.x,
        y: bars.y,
        ...(set.name === right ? { yaxis: "y2" } : {}),
        marker: paint.bars(set.name, i),
        ...(bars.errors ? { error_y: paint.errorBars(set.name, i, bars.errors, bars.errorMinus) } : {}),
        hoverinfo: "x+y",
      },
      {
        type: "scatter",
        mode,
        name: set.name,
        x: pick(points.x),
        y: pick(points.y),
        ...(set.name === right ? { yaxis: "y2" } : {}),
        ...(mode !== "lines"
          ? pick(points.keys)
            ? seriesPoints(paint, set.name, i, pick(points.keys)!)
            : { marker: seriesMarker(paint, set.name, i) }
          : {}),
        ...(mode !== "markers" ? { line: paint.line(set.name, i) } : {}),
        hoverinfo: "x+y",
        showlegend: false,
      },
    ];
  });

  return {
    data,
    layout: {
      ...xyLayout(options, xCol.name, ys.length, { zeroBase: true, seriesNames: ys.map((y) => y.name), rightY: right }),
      barmode: "group",
      bargroupgap: options.barGap,
    },
  };
}

export const xyBarScatter: GraphModule = {
  label: "Bar + scatter",
  family: "xy",
  points: (options) => options.xyStyle !== "line",
  lines: (options) => options.xyStyle !== "points",
  patterns: () => true,
  build,
};
