// "XY spikes": a vertical line from the baseline (0) to each point, at its X
// (Prism's spike graph — the narrowest bar width in Format Graph XY makes
// spikes suitable for mass spectra). One stem trace per data set (null-separated
// segments, so Plotly doesn't join one stem to the next) plus a markers trace
// at the tips, which carries the legend. Replicates as each X's center with its
// error bars, or each value, per `xyReplicates` (`xyDrawn`); on a summary
// table the spikes are the stored Means with the converted error.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { splitXY, type Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { type Paint, rightYDataset, seriesMarker, seriesPoints, XY_AXES, xyDrawn, xyLayout } from "./plot-helpers";

function build(columns: Column[], options: GraphOptions, paint: Paint, _titles?: (string | null)[], summary?: SummaryFormat): GraphFigure {
  const { x: xCol, ys } = splitXY(columns);
  if (!xCol || ys.length === 0) return { data: [], layout: xyLayout(options, columns[0]?.name ?? "X", 0) };

  const right = rightYDataset(options, ys.map((y) => y.name));
  const data = ys.flatMap((set, i) => {
    const drawn = xyDrawn(xCol, set, options, summary);
    // The stems: baseline to each point, null-separated so one stem never
    // joins the next. The tips are their own markers trace, which also
    // carries the series' legend entry (the stems trace hides its own).
    const sx: (number | null)[] = [];
    const sy: (number | null)[] = [];
    drawn.x.forEach((xv, k) => {
      sx.push(xv, xv, null);
      sy.push(0, drawn.y[k], null);
    });
    return [
      {
        type: "scatter",
        mode: "lines",
        name: set.name,
        x: sx,
        y: sy,
        ...(set.name === right ? { yaxis: "y2" } : {}),
        line: paint.line(set.name, i),
        hoverinfo: "x+y",
        showlegend: false,
      },
      {
        type: "scatter",
        mode: "markers",
        name: set.name,
        x: drawn.x,
        y: drawn.y,
        ...(set.name === right ? { yaxis: "y2" } : {}),
        ...(drawn.keys
          ? seriesPoints(paint, set.name, i, drawn.keys)
          : { marker: seriesMarker(paint, set.name, i) }),
        ...(drawn.errors ? { error_y: paint.errorBars(set.name, i, drawn.errors, drawn.errorMinus) } : {}),
        hoverinfo: "x+y",
      },
    ];
  });

  return {
    data,
    layout: xyLayout(options, xCol.name, ys.length, { zeroBase: true, seriesNames: ys.map((y) => y.name), rightY: right }),
  };
}

export const xySpikes: GraphModule = {
  label: "Spikes",
  family: "xy",
  axes: XY_AXES,
  points: () => true,
  lines: () => true,
  // Replicates are summarized only when shown as their center.
  summarizes: (options) => options.xyReplicates === "mean",
  build,
};
