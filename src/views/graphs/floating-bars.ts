// "Floating bars": a bar spanning minimum to maximum (Prism's floating bar
// graph). Two readings, by whether the columns form groups:
//  - no groups (a column or contingency table): one bar per column, spanning
//    the min to the max of its values across the rows.
//  - groups (a grouped or nested table): one bar per row × group, spanning
//    the min to the max of that cell's replicates. On a summary table the bar
//    is the stored Mean ± the stored error, converted to the graph's error
//    kind (`perRowSummaryStats` — asymmetric formats keep their two sides).
// A contingency table reads as the first case: one value per cell gives no
// min/max pair, so its bars span each outcome's counts across the rows.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import {
  baseLayout,
  groupedBarLayout,
  maxOf,
  minOf,
  perRowSummaryStats,
  rowCountOf,
  rowLabels,
  type Paint,
} from "./plot-helpers";

function build(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles?: (string | null)[],
  summary: SummaryFormat = "replicates",
): GraphFigure {
  const grouped = columns.some((c) => c.set !== undefined);
  if (!grouped) {
    // One bar per column: its min to its max, drawn with Plotly's `base`.
    const data = columns.map((c, i) => {
      const lo = minOf(c.values);
      const hi = maxOf(c.values);
      return {
        type: "bar",
        name: c.name,
        x: [i],
        y: [hi - lo],
        base: [lo],
        marker: paint.bars(c.name, i),
        hoverinfo: "y",
      };
    });
    return {
      data,
      layout: baseLayout(options, columns.map((c) => c.name), { zeroBase: false }),
    };
  }

  // One bar per row × group: the cell's min to its max (or, on a summary
  // table, the stored Mean ± its stored error).
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const data = groups.map((g, i) => {
    // A summary table's stats, once per group: the center and error per row.
    const stats =
      summary === "replicates" ? null : perRowSummaryStats(g.columns, rows, summary, options.error);
    const base: (number | null)[] = [];
    const height: (number | null)[] = [];
    for (let r = 0; r < rows; r++) {
      if (stats === null) {
        const values = g.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
        if (values.length === 0) {
          base.push(null);
          height.push(null);
        } else {
          const lo = minOf(values);
          base.push(lo);
          height.push(maxOf(values) - lo);
        }
      } else {
        const m = stats.center[r];
        const up = stats.error?.[r] ?? null;
        const down = stats.errorMinus?.[r] ?? up;
        if (m == null || up == null || down == null) {
          base.push(null);
          height.push(null);
        } else {
          base.push(m - down);
          height.push(up + down);
        }
      }
    }
    return {
      type: "bar",
      name: g.name,
      x: labels,
      y: height,
      base,
      marker: paint.bars(g.name, i),
      hoverinfo: "x+y",
    };
  });

  return {
    data,
    layout: {
      ...groupedBarLayout(options, groups.length, { seriesNames: groups.map((g) => g.name) }),
      barmode: "group",
      bargroupgap: options.barGap,
    },
  };
}

export const floatingBars: GraphModule = {
  label: "Floating bars",
  family: "grouped",
  patterns: () => true,
  build,
};
