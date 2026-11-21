// "Mean or median and error": the center (mean or median) per column shown as bars,
// points, or a connected line, with optional SD/SEM error bars. Each column's
// marker/bar/error whisker is its own trace so it can carry its own series color;
// the "line" shape's connector between columns is a single gray trace underneath,
// in the graph's line thickness and dashes (Plotly can't vary a single line's color
// per segment).
// On a summary table (nested: "A:S1:Mean", "A:S1:SD", "A:S1:N"…) the SD/N
// columns are not data to average — only the Mean column of each subgroup is
// plotted, one point/bar per subgroup, its center and error read across the
// stored Means (the nested pooling the grouped builders use), labelled by
// subgroup. Averaging Mean/SD/N together would be silently wrong.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { baseLayout, centers, COLUMN_BAR, errors, GUIDE, seriesMarker, type Paint } from "./plot-helpers";

function build(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  _titles?: (string | null)[],
  summary?: SummaryFormat,
): GraphFigure {
  const shown =
    summary !== undefined && summary !== "replicates"
      ? columns.filter((c) => c.name.slice(c.name.lastIndexOf(":") + 1) === "Mean")
      : columns;
  const labels =
    summary !== undefined && summary !== "replicates"
      ? shown.map((c) => c.name.slice(0, c.name.lastIndexOf(":")))
      : shown.map((c) => c.name);
  const idx = shown.map((_, i) => i);
  const y = centers(shown, options.center);
  const errs = errors(shown, options.error);
  const data: unknown[] = [];

  if (options.shape === "line") {
    data.push({
      type: "scatter",
      mode: "lines",
      x: idx,
      y,
      line: { color: GUIDE, width: options.lineWidth, dash: options.lineDash },
      hoverinfo: "skip",
    });
  }

  shown.forEach((c, i) => {
    const error_y = errs ? paint.errorBars(c.name, i, [errs[i]]) : { visible: false };

    data.push(
      options.shape === "bar"
        ? { ...COLUMN_BAR, x: [i], y: [y[i]], marker: paint.bars(c.name, i), error_y, hoverinfo: "y" }
        : {
            type: "scatter",
            mode: "markers",
            x: [i],
            y: [y[i]],
            marker: seriesMarker(paint, c.name, i),
            error_y,
            hoverinfo: "y",
          },
    );
  });

  return {
    data,
    layout: baseLayout(
      options,
      labels,
      { zeroBase: options.shape === "bar" },
    ),
  };
}

export const meanError: GraphModule = {
  label: "Mean or median and error",
  family: "column",
  defaults: { pointSize: 9 },
  points: (options) => options.shape !== "bar",
  lines: (options) => options.shape === "line",
  patterns: (options) => options.shape === "bar",
  build,
};
