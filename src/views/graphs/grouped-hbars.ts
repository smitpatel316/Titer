// Grouped "Horizontal bars": interleaved bars with categories on the Y axis.
import type { GraphModule } from ".";
import { buildGroupedBars } from "./grouped-common";

export const groupedHbars: GraphModule = {
  label: "Horizontal bars",
  family: "grouped",
  patterns: () => true,
  build: (columns, options, paint, titles, summary) =>
    buildGroupedBars(columns, options, "group", true, paint, titles, summary),
};
