// "Bland-Altman plot": each complete pair as one point — the difference between
// the two methods (Y) against their mean (X) — with three horizontal lines: the
// bias (solid) and both limits of agreement (dashed), labelled with their values.
// Family `xy`: it is an X/Y scatter, of derived pairs rather than table columns.
// The lines come from `computeBlandAltman` in the runner module — the same five
// lines of arithmetic the analysis runs — so the graph works standalone (no
// analysis node needed) and its numbers agree exactly with the analysis result
// by construction, rather than by a second computation.
import type { GraphOptions } from "../../store/types";
import { pairUp, type Column } from "../../lib/dataset";
import { computeBlandAltman } from "../../stats/column/bland-altman";
import { num } from "../../lib/format";
import { extent, GUIDE, INK, type Paint, plotAreaPx, seriesPoints, XY_AXES, xyLayout } from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";
import type { GraphFigure, GraphModule } from ".";

function lineTrace(x: [number, number], y: number, name: string, dashed: boolean, color: string) {
  return {
    type: "scatter",
    mode: "lines",
    name,
    x: [x[0], x[1]],
    y: [y, y],
    line: { color, width: 2, dash: dashed ? "dash" : "solid" },
    hoverinfo: "y+name",
    showlegend: false,
  };
}

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  // The first two columns are the two methods being compared. On an XY table
  // `plotColumns` hands this the Y columns only — the X column is the
  // independent variable, never a method — so what plots here can never be
  // X against a method (the graph-path half of the F8 wizard guard).
  const [first, second] = columns;
  const layout = (xName: string) =>
    xyLayout(
      {
        ...options,
        xLabel: first && second ? `Mean of ${first.name} and ${second.name}` : options.xLabel,
        yLabel: first && second ? `${first.name} − ${second.name}` : options.yLabel,
      },
      xName,
      1,
    );
  if (!first || !second) return { data: [], layout: layout(first?.name ?? "X") };
  const { x: a, y: b, rows } = pairUp(first, second);
  if (!a.length) return { data: [], layout: layout(first.name) };
  const means = a.map((v, i) => (v + b[i]) / 2);
  const diffs = a.map((v, i) => v - b[i]);
  const [xMin, xMax] = extent(means);
  const span = xMax - xMin || 1;
  const lineX: [number, number] = [xMin - 0.05 * span, xMax + 0.05 * span];
  const points = {
    type: "scatter",
    mode: "markers",
    name: `${first.name} − ${second.name}`,
    x: means,
    y: diffs,
    ...seriesPoints(
      paint,
      first.name,
      0,
      rows.map((r) => pointKeyOf(first.name, r)),
    ),
    hoverinfo: "x+y",
    showlegend: false,
  };
  const data: unknown[] = [points];
  // The lines are labelled where they sit (at their right end, inside the
  // plot), not in a legend — the in-plot labels stay by design, even though
  // a legend now reserves its own right margin (M13).
  const annotations: unknown[] = [];
  if (diffs.length >= 2) {
    const s = computeBlandAltman(diffs);
    const label = (name: string, value: number, text: string, above: boolean, extraShift = 0) => ({
      name,
      x: lineX[1],
      y: value,
      xref: "x",
      yref: "y",
      text,
      showarrow: false,
      xanchor: "right",
      yanchor: above ? "bottom" : "top",
      yshift: above ? 4 + extraShift : -4,
      font: { color: INK, size: Math.max(options.fontSize - 1, 8) },
    });
    // The bias and upper labels both sit above their lines, so when the
    // plotted y-range is wide relative to the SD (wide manual limits, or an
    // outlier stretching the span) the lines are a few px apart and the
    // labels print on top of each other. The upper label is pushed up until
    // a full label height separates the two boxes; the gap is measured in px
    // from the range the layout will use (the explicit limits, else the
    // diffs' extent padded the way Plotly's autorange pads it).
    const labelH = Math.max(options.fontSize - 1, 8) + 4;
    const plotH = plotAreaPx(options).height;
    const [lo, hi] = extent([...diffs, s.bias, s.lower, s.upper]);
    const pad = (hi - lo) * 0.05 || 1;
    const yLo = options.yMin ?? lo - pad;
    const yHi = options.yMax ?? hi + pad;
    const gapPx = ((s.upper - s.bias) / (yHi - yLo)) * plotH;
    const extra = Math.max(0, Math.ceil(labelH + 2 - gapPx));
    data.push(
      lineTrace(lineX, s.bias, `Bias ${num(s.bias)}`, false, INK),
      lineTrace(lineX, s.lower, `Lower limit ${num(s.lower)}`, true, GUIDE),
      lineTrace(lineX, s.upper, `Upper limit ${num(s.upper)}`, true, GUIDE),
    );
    annotations.push(
      label("bland-bias", s.bias, `Bias ${num(s.bias)}`, true),
      label("bland-lower", s.lower, `Lower limit ${num(s.lower)}`, false),
      label("bland-upper", s.upper, `Upper limit ${num(s.upper)}`, true, extra),
    );
  }
  return {
    data,
    layout: { ...layout(first.name), annotations },
  };
}

export const blandAltmanGraph: GraphModule = {
  label: "Bland-Altman plot",
  family: "xy",
  axes: XY_AXES,
  points: () => true,
  lines: () => true,
  build,
};
