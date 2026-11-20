// "Estimation plot" of a t test (Prism's "Graph confidence interval of
// differences between means"): a scatterplot (or violin) of the raw data,
// plus a third dataset plotting the difference between means — or the mean
// of the paired differences — with its 95% CI. Family `column`: the raw
// groups sit at x = 0, 1, …, the difference one slot past the last group.
// The third dataset comes from a sibling "Compare two groups" analysis's
// cached runAnalysis result (see graph-view.tsx) — the graph draws only the
// raw data until one is chosen, exactly like the forest plot.
//
// The three modes of the linked result's `difference` (see DifferenceResult
// in stats/types):
// - `difference` (unpaired / paired t test): the difference is in the data's
//   units, on the same axis as the raw data, with a dashed zero line — no
//   difference sits at 0.
// - `log-difference` (unpaired lognormal t test): the test ran on the
//   logarithms, so the raw values are drawn as their natural logs and the
//   difference of the log means sits on that same ln scale (its exponential
//   is the ratio of geometric means). A log Y scale would log them twice,
//   so the axis is forced linear here. Values at or under 0 have no log and
//   are left out, named on the figure.
// - `ratio` (paired ratio t test): a ratio (~1) has no honest place on a
//   raw-value axis, so the ratio point and its CI are drawn on a second,
//   log-scaled Y axis on the right, with a dashed reference line at 1 —
//   the raw groups stay visible on their own scale.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult } from "../../stats/types";
import type { Column } from "../../lib/dataset";
import { addNote, baseLayout, GUIDE, INK, scatterOffsets, seriesPoints, type Paint } from "./plot-helpers";
import { num } from "../../lib/format";
import { pointKeyOf } from "../../lib/columns";
import type { GraphFigure, GraphModule } from ".";

/** One difference's label: "Difference between means 2.40 (95% CI 1.10–3.70)". */
export function estimationDiffLabel(estimate: number, low: number, high: number, label: string): string {
  return `${label} ${num(estimate)} (95% CI ${num(low)}–${num(high)})`;
}

function build(columns: Column[], options: GraphOptions, paint: Paint): GraphFigure {
  const data: unknown[] = [];
  columns.forEach((c, i) => {
    // Violins behind the points, as on Box and violin — the points are a
    // trace of their own, so each keeps its own style.
    if (options.estimationViolin) {
      data.push({
        type: "violin",
        x: c.values.map(() => i),
        y: c.values,
        fillcolor: paint.fill(c.name, i),
        line: paint.edge(c.name, i),
        points: false,
        meanline: { visible: true },
        spanmode: "hard",
        hoverinfo: "y",
      });
    }
    const offs = scatterOffsets(c.values, options.scatterStyle, i);
    data.push({
      type: "scatter",
      mode: "markers",
      x: c.values.map((_, vi) => i + offs[vi]),
      y: c.values,
      ...seriesPoints(
        paint,
        c.name,
        i,
        c.rows.map((r) => pointKeyOf(c.name, r)),
      ),
      hoverinfo: "y",
    });
  });

  return {
    data,
    layout: baseLayout(
      options,
      columns.map((c) => c.name),
    ),
  };
}

/** The difference dataset's slot, one past the raw groups, added to the X
 *  axis the build laid out (its ticks and range end at the last group). */
function addDifferenceSlot(fig: GraphFigure, slot: number, label: string): void {
  const layout = fig.layout as Record<string, unknown>;
  const xaxis = layout.xaxis as { tickvals?: number[]; ticktext?: string[]; range?: [number, number] };
  xaxis.tickvals = [...(xaxis.tickvals ?? []), slot];
  xaxis.ticktext = [...(xaxis.ticktext ?? []), label];
  xaxis.range = [-0.5, slot + 0.5];
}

function addShape(fig: GraphFigure, shape: Record<string, unknown>): void {
  const layout = fig.layout as Record<string, unknown>;
  layout.shapes = [...((layout.shapes as unknown[]) ?? []), shape];
}

/** Draw the linked t test's difference with its 95% CI onto an
 *  estimation-plot figure (its build's raw data). A result with no
 *  difference — a non-parametric test computes no CI, a one-tailed test's
 *  is one-sided — leaves the raw data alone and says why. */
export function addEstimationPlot(
  fig: GraphFigure,
  columns: Column[],
  outcome: AnalysisResult,
  _paint: Paint,
  options: GraphOptions,
): void {
  const diff = outcome.difference;
  if (!diff) {
    addNote(
      fig,
      `The ${outcome.subtitle ?? "t test"} reports no difference with a 95% CI, so there is no third dataset to draw — run a two-tailed parametric t test.`,
      options,
    );
    return;
  }
  const slot = columns.length;
  const layout = fig.layout as Record<string, unknown>;
  addDifferenceSlot(fig, slot, diff.label);

  if (diff.mode === "log-difference") {
    // The test ran on the logs: draw the raw values as their natural logs.
    // A value at or under 0 has no log — it becomes a null Plotly skips,
    // keeping every trace's arrays aligned, and is named on the figure.
    const dropped = columns
      .filter((c) => c.values.some((v) => v <= 0))
      .map((c) => `“${c.name}” (${c.values.filter((v) => v <= 0).length})`);
    for (const trace of fig.data as { y?: (number | null)[] }[]) {
      if (trace.y) trace.y = trace.y.map((v) => (v != null && v > 0 ? Math.log(v) : null));
    }
    if (dropped.length) {
      addNote(
        fig,
        `${dropped.join(", ")} left out: values at or under 0 have no logarithm, so they cannot be drawn on the log scale.`,
        options,
      );
    }
    // The ln scale is itself logarithmic: a log Y scale would log the values
    // twice (and ln values at or under 0 have no place on one), so the axis
    // goes linear, with the log scale's ticks cleared. A linear axis the user
    // ranged stays as it is — only a log axis's props are cleared.
    const yaxis = layout.yaxis as Record<string, unknown>;
    if (yaxis.type === "log") {
      yaxis.type = "linear";
      delete yaxis.tickmode;
      delete yaxis.tickvals;
      delete yaxis.ticktext;
      delete yaxis.minor;
      delete yaxis.range;
      delete yaxis.autorange;
    }
    if (!options.yLabel) yaxis.title = { text: "Log value", standoff: options.yTitleGap };
  }

  if (diff.mode === "ratio") {
    // A ratio lives on its own log axis, on the right: the raw groups keep
    // their scale, and 1 — no difference — is the reference line.
    const lo = Math.min(1, diff.low) * 0.7;
    const hi = Math.max(1, diff.high) * 1.4;
    layout.yaxis2 = {
      type: "log",
      range: [Math.log10(lo), Math.log10(hi)],
      autorange: false,
      overlaying: "y",
      side: "right",
      showgrid: false,
      zeroline: false,
      linecolor: INK,
      linewidth: options.axisWidth,
      ticks: "outside",
      tickwidth: options.axisWidth,
      fixedrange: true,
      automargin: true,
      title: { text: diff.label, standoff: options.yTitleGap },
    };
    fig.data.push({
      type: "scatter",
      mode: "markers",
      name: diff.label,
      x: [slot],
      y: [diff.estimate],
      yaxis: "y2",
      marker: { color: INK, size: 9, symbol: "diamond" },
      error_y: {
        type: "data",
        symmetric: false,
        array: [diff.high - diff.estimate],
        arrayminus: [diff.estimate - diff.low],
        color: INK,
        thickness: 1.5,
        width: 6,
      },
      text: [estimationDiffLabel(diff.estimate, diff.low, diff.high, diff.label)],
      hoverinfo: "text+y",
      showlegend: false,
    });
    addShape(fig, {
      type: "line",
      x0: 0,
      x1: 1,
      xref: "paper",
      y0: 1,
      y1: 1,
      yref: "y2",
      line: { color: GUIDE, width: 1.5, dash: "dash" },
    });
    return;
  }

  // `difference` / `log-difference`: the difference is on the raw (or ln)
  // axis, with a dashed zero line — no difference sits at 0.
  fig.data.push({
    type: "scatter",
    mode: "markers",
    name: diff.label,
    x: [slot],
    y: [diff.estimate],
    marker: { color: INK, size: 9, symbol: "diamond" },
    error_y: {
      type: "data",
      symmetric: false,
      array: [diff.high - diff.estimate],
      arrayminus: [diff.estimate - diff.low],
      color: INK,
      thickness: 1.5,
      width: 6,
    },
    text: [estimationDiffLabel(diff.estimate, diff.low, diff.high, diff.label)],
    hoverinfo: "text+y",
    showlegend: false,
  });
  addShape(fig, {
    type: "line",
    x0: 0,
    x1: 1,
    xref: "paper",
    y0: 0,
    y1: 0,
    line: { color: GUIDE, width: 1.5, dash: "dash" },
  });
}

export const estimationPlot: GraphModule = {
  label: "Estimation plot",
  family: "column",
  points: () => true,
  build,
};
