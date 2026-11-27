// Parts-of-Whole "Stacked bar": one bar per data set, stacked by category.
// A Parts-of-Whole table's rows are its mutually exclusive categories and
// its columns its data sets — the transpose of a grouped table, whose rows
// are the X categories and whose groups are the series — so the grouped
// stacked builder cannot serve it: here each row is one trace across the
// data sets, and the bar for a data set stacks its categories to that
// data set's total (or to 100 % with "Percent of total", Prism's usual
// Parts-of-Whole view). Values are drawn as entered: a negative part is
// meaningless, but Plotly stacks it downward visibly rather than silently
// recomputing the rest (the pie's failure mode), so it is left in place.
import type { GraphModule } from ".";
import type { GraphOptions } from "../../store/types";
import type { Column } from "../../lib/dataset";
import { groupedBarLayout, rowCountOf, rowLabels, type Paint } from "./plot-helpers";
import type { GraphFigure } from ".";

export const powStacked: GraphModule = {
  label: "Stacked bar",
  family: "grouped",
  // Y is a scale axis, not range-only: the Format panel offers it and the
  // layout honors it (yAxisRange). Contrast grouped-stacked, whose value
  // axis stays linear by design (a slice's height must say its value).
  axes: () => ({ x: "labels", y: "scale" }),
  defaults: { stackAs: "percent" },
  patterns: () => true,
  build: (columns: Column[], options: GraphOptions, paint: Paint, titles?: (string | null)[]): GraphFigure => {
    const rows = rowCountOf(columns);
    const labels = rowLabels(rows, titles);
    const names = columns.map((c) => c.name);
    const percent = options.stackAs === "percent";
    // Each bar is one data set: in percent mode its segments are shares of
    // that data set's own total (a total of 0, or a missing value, leaves a
    // gap, never a divide-by-zero).
    const totals = columns.map((c) => c.values.reduce((sum, v) => sum + v, 0));
    // One trace per category (row): its value in each data set (column).
    const data = labels.map((label, r) => {
      const values = columns.map((c) => c.byRow[r] ?? null);
      const shown = percent
        ? values.map((v, ci) => (v == null || totals[ci] === 0 ? null : (100 * v) / totals[ci]))
        : values;
      return {
        type: "bar",
        name: label,
        x: names,
        y: shown,
        marker: paint.bars(label, r),
        hoverinfo: "x+y",
      };
    });
    return {
      data,
      layout: {
        ...groupedBarLayout(
          // Percent bars say so on their axis, until it is titled by hand.
          percent && !options.yLabel ? { ...options, yLabel: "Percent of total" } : options,
          labels.length,
          { seriesNames: labels },
        ),
        barmode: "stack",
      },
    };
  },
};
