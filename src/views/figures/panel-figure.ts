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

import { DEFAULT_GRAPH_OPTIONS, type ProjectNode } from "../../store/types";
import { infoSheetsOf, resolveGraphOptions } from "../../lib/info-sheets";
import { mergedGraphData } from "../../lib/multi-table";
import { GRAPHS, graphSeriesDataset, plotColumns, type GraphFigure } from "../graphs";
import { paintOf } from "../graphs/plot-helpers";

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
  if (graph.type !== "graph" || !graph.graphType || !Object.hasOwn(GRAPHS, graph.graphType)) return null;
  const parent = graph.parentId ? nodes[graph.parentId] : undefined;
  if (!parent?.data || !parent.tableType) return null;
  // A multi-table graph (#48) draws its merged dataset — the same one its
  // own view draws — so a figure panel and an export show every table.
  // A merge problem draws nothing here; the graph's own view says why.
  const merged = mergedGraphData(graph, nodes);
  if (!merged || merged.problem) return null;
  const dataset = merged.dataset;
  // The graph's own view resolves the same hooks (see graph-view.tsx), so a
  // panel's titles and axis limits match the graph exactly.
  const sheets = infoSheetsOf(nodes, Object.keys(nodes));
  const options = resolveGraphOptions({ ...DEFAULT_GRAPH_OPTIONS, ...graph.graphOptions }, sheets);
  const columns = plotColumns(dataset, graph.graphType, options, parent.tableType);
  if (!columns.some((c) => c.values.length > 0)) return null;
  const paint = paintOf(options, graphSeriesDataset(graph.graphType, dataset, parent.tableType, options).length);
  const fig = GRAPHS[graph.graphType].build(columns, options, paint, dataset.titles);
  return opts.hideLegend ? { ...fig, layout: { ...fig.layout, showlegend: false } } : fig;
}
