// Grouped "Bars with individual points" (Prism 8+'s built-in grouped choice):
// interleaved bars with every replicate drawn as a point on its own bar.
import type { GraphModule } from ".";
import { buildGroupedBarsScatter } from "./grouped-common";
import { CATEGORY_AXES } from "./plot-helpers";

export const groupedBarsScatter: GraphModule = {
  label: "Bars with individual points",
  family: "grouped",
  axes: CATEGORY_AXES,
  points: () => true,
  patterns: () => true,
  summarizes: () => true,
  build: (columns, options, paint, titles, summary) =>
    buildGroupedBarsScatter(columns, options, paint, titles, summary),
};
