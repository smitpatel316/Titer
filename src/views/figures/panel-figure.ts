// A figure panel's Plotly figure, built the way the graph's own view builds
// it — from the same `GRAPHS` module, the same columns and the same paint —
// but without the overlays that need a live analysis run (significance
// brackets, regression and dose-response curves, the forest/scree/PCA/K-means
// overlays in graph-view.tsx). Those overlays need an analysis result, so
// they live in the shared async builder `buildGraphFigure`
// (`src/views/graphs/graph-figure.ts`), which the headless exports use; this
// synchronous builder draws the graph's base chart (its data, colours,
// styles and titles) exactly as the graph view does, and a graph whose chart
// *is* its overlay (a forest plot with no Cox analysis, a scree plot with no
// PCA) draws only its axes here, exactly as it does in its own view without
// the analysis. The live figure preview (`panel-plot.tsx`) starts from this
// builder and upgrades to the full figure when the overlays resolve.

import type { ProjectNode } from "../../store/types";
import { buildBaseFigure } from "../graphs/graph-figure";
import type { GraphFigure } from "../graphs";

/** The panel's figure, or null when its graph has nothing to draw (no table,
 *  no numeric columns, or an unknown graph type). With `hideLegend`, the
 *  panel draws no legend of its own — a figure with a shared legend promises
 *  "per-panel legends are hidden", so a panel that draws a legend (an XY
 *  scatter with >1 Y series, a grouped scatter…) must not draw it here.
 *  The graph's own view is untouched: only figure panels hide it. */
export function buildPanelFigure(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  opts: { hideLegend?: boolean } = {},
): GraphFigure | null {
  return buildBaseFigure(graph, nodes, opts);
}
