// Grouped "Interleaved bars": one bar per group, side-by-side at each row.
// With showPoints, the individual values are overlaid on the bars.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedBars: GraphModule = {
  label: "Interleaved bars",
  family: "grouped",
  patterns: () => true,
  points: (options) => options.showPoints,
  summarizes: () => true,
  build: (columns, options, paint, titles, summary) =>
    buildGroupedBars(columns, options, "group", false, paint, titles, summary),
};
