// "Box and violin": a box (quartiles and whiskers per `options.whisker`, Helix's:
// `boxTrace`) or violin per column, with optional individual points drawn over
// it. Each column is its own trace so it can carry its own series color; its
// points are a trace of their own, as on Individual values, so each can carry
// its own style (Plotly's box points take one color for all). Values past the
// whiskers (Tukey outliers, or outside a percentile pair) are drawn as points
// of their own while the points are hidden — with points shown they are already
// on the plot — and "min-max-all" always shows all points, as its name says.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { baseLayout, boxTrace, columnPoints, seriesMarker, whiskerBounds, type Paint } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const data: unknown[] = [];
  const showPoints = options.showPoints || options.whisker === "min-max-all";
  columns.forEach((c, i) => {
    const shape = {
      x: c.values.map(() => i),
      y: c.values,
      fillcolor: paint.fill(c.name, i),
      line: paint.edge(c.name, i),
      hoverinfo: "y",
    };
    data.push(
      options.kind === "violin"
        ? {
            type: "violin",
            ...shape,
            points: false,
            meanline: { visible: true },
            spanmode: options.violinVariant === "full" ? "soft" : "hard",
            ...(options.violinVariant === "half" ? { side: "positive" } : {}),
          }
        : { type: "box", ...shape, ...boxTrace([i], [c.values], options.whisker), y: undefined, boxpoints: false, whiskerwidth: 0.5 },
    );
if (showPoints) data.push(columnPoints(paint, c, i));
    if (options.kind === "box" && !showPoints) {
      const { outliers } = whiskerBounds(c.values, options.whisker);
      if (outliers.length) {
        const rows = c.rows.filter((r) => outliers.includes(c.byRow[r]!));
        data.push({
          type: "scatter",
          mode: "markers",
          x: rows.map(() => i),
          y: rows.map((r) => c.byRow[r]!),
          marker: seriesMarker(paint, c.name, i),
          hoverinfo: "y",
          showlegend: false,
        });
      }
    }
  });

  return {
    data,
    layout: baseLayout(
      options,
      columns.map((c) => c.name),
    ),
  };
}

export const boxViolin: GraphModule = {
  label: "Box and violin",
  family: "column",
  defaults: { fill: 0.5, pointSize: 5, outline: 2 },
  points: (options) => options.showPoints || options.whisker === "min-max-all",
  build,
};
