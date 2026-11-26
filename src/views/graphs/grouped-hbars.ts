// Grouped "Horizontal bars": interleaved bars with categories on the Y axis.
// With showPoints, the individual values are overlaid on the bars.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedHbars: GraphModule = {
  label: "Horizontal bars",
  family: "grouped",
  axes: () => ({ x: "scale", y: "labels" }),
  horizontal: true,
  patterns: () => true,
  points: (options) => options.showPoints,
  summarizes: () => true,
  build: (columns, options, paint, titles, summary) =>
    buildGroupedBars(columns, options, "group", true, paint, titles, summary),
};
