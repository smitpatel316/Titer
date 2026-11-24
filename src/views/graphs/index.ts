// The graph types. Adding a chart = a file exporting a `GraphModule`, an entry here,
// and one in GRAPH_OPTIONS_BY_TABLE for the tables that offer it. Each module turns
// the table's columns (lib/dataset.ts) and options into a Plotly figure.

import {
  DEFAULT_GRAPH_OPTIONS,
  hasXColumn,
  type GraphType,
  type GraphOptions,
  type TableData,
  type TableErrorFormat,
  type TableType,
} from "../../store/types";
import type { SelectorOption } from "../../components/universal-modal";
import { readTable, seriesOfDataset, splitXY, type Column, type Dataset } from "../../lib/dataset";
import type { SummaryFormat } from "../../lib/summary-format";
import { paletteNamed, savedPalette } from "../../lib/palettes";
import { titleCase } from "../../lib/format";
import { centerColumn, summaryMeanColumn, type Paint } from "./plot-helpers";
import { individual } from "./individual";
import { beforeAfter, groupedBeforeAfter } from "./before-after";
import { boxViolin } from "./box-violin";
import { meanError } from "./mean-error";
import { xyScatter } from "./xy-scatter";
import { bubblePlot } from "./bubble-plot";
import { xyBar } from "./xy-bar";
import { xyArea } from "./xy-area";
import { xySpikes } from "./xy-spikes";
import { xyBarScatter } from "./xy-bar-scatter";
import { groupedBars } from "./grouped-bars";
import { groupedBarsScatter } from "./grouped-bars-scatter";
import { groupedScatter } from "./grouped-scatter";
import { groupedBox } from "./grouped-box";
import { floatingBars } from "./floating-bars";
import { groupedLines } from "./grouped-lines";
import { groupedStacked } from "./grouped-stacked";
import { groupedHbars } from "./grouped-hbars";
import { pie, donut } from "./pie";
import { powStacked } from "./pow-stacked";
import { schildPlot } from "./schild-plot";
import { smoothCurve } from "./smooth-curve";
import { logisticCurveGraph } from "./logistic-curve";
import { heatmap } from "./heatmap";
import { survival } from "./survival";
import { forestPlot } from "./forest-plot";
import { estimationPlot } from "./estimation-plot";
import { volcano, VOLCANO_SERIES } from "./volcano";
import { blandAltmanGraph } from "./bland-altman";
import { rocCurveGraph } from "./roc-curve";
import { observedFitted, OBSERVED_FITTED_SERIES } from "./observed-fitted";
import { screePlot, SCREE_SERIES } from "./scree-plot";
import { pcaBiplot, PCA_BIPLOT_SERIES } from "./pca-biplot";
import { kmeansScatter } from "./kmeans-scatter";
import { dendrogram, DENDROGRAM_SERIES } from "./dendrogram";
import { elbowPlot, gapPlot, silhouettePlot, ELBOW_SERIES, GAP_SERIES, SILHOUETTE_SERIES } from "./choosing-k";
import { histogram } from "./histogram";
import { flowContourPlot, flowDensityPlot, flowDotPlot, flowHistogramPlot, flowPseudocolorPlot } from "./flow-plots";
import {
  mvBarChart,
  mvBarStrip,
  mvBeforeAfterBarStripPlot,
  mvBeforeAfterStrip,
  mvBoxWhisker,
  mvStripPlot,
  mvSummarySymbol,
  mvViolin,
} from "./mv-graphs";
import { monteCarloHistogram, MONTE_CARLO_HISTOGRAM_SERIES } from "./monte-carlo-histogram";
import { qqPlot } from "./qq-plot";
import { residuals } from "./residuals";

/** A Plotly figure (untyped traces/layout — built as plain objects per module). */
export interface GraphFigure {
  data: unknown[];
  layout: Record<string, unknown>;
}

/** What a graph's columns and axes mean — decides its data and its Format sections.
 *  "multiple" plots a Multiple Variables table's numeric columns (its graphs
 *  read a sibling analysis, not the columns directly — shared with plan 05's
 *  ROC work, not a one-off). */
type GraphFamily = "column" | "xy" | "grouped" | "pie" | "heatmap" | "volcano" | "histogram" | "multiple";

/** Whether a graph has a value axis to draw reference lines across (a volcano has its own
 *  cutoffs; a pie and a heatmap have none). */
export const hasValueAxis = (family: GraphFamily) => family !== "pie" && family !== "heatmap" && family !== "volcano";

export interface GraphModule {
  label: string;
  family: GraphFamily;
  /** The palette a new graph of this type takes (Okabe-Ito when unset). */
  palette?: string;
  /** What a new graph of this type starts with, over the defaults: a half-opaque
   *  `fill` where points usually sit on its shapes or they overlap, its points' size… */
  defaults?: Partial<GraphOptions>;
  /** Whether it draws points with these options (their style is then offered). */
  points?: (options: GraphOptions) => boolean;
  /** Whether it draws series lines with these options (their thickness is then offered). */
  lines?: (options: GraphOptions) => boolean;
  /** Whether it fills bars, areas or slices a series' pattern can cover. */
  patterns?: (options: GraphOptions) => boolean;
  /** Whether it draws a center with error bars these options summarize — the
   *  Series section then offers a per-series center/error override (seq 375).
   *  Absent where nothing is summarized (a pie, a stacked bar's segments). */
  summarizes?: (options: GraphOptions) => boolean;
  build: (
    columns: Column[],
    options: GraphOptions,
    paint: Paint,
    /** Row titles, which label the rows on a grouped graph or a heatmap. */
    titles?: (string | null)[],
    /** A grouped table's sub-column format ("replicates", or the summaries its
     *  sub-columns hold) — only the grouped builders read it. */
    summary?: SummaryFormat,
    /** The table's type — only the builders whose reading depends on it
     *  (a Parts-of-Whole pie's slices are its rows, not its columns) read it. */
    tableType?: TableType,
  ) => GraphFigure;
}

export const GRAPHS: Record<GraphType, GraphModule> = {
  individual,
  "before-after": beforeAfter,
  "box-violin": boxViolin,
  "mean-error": meanError,
  "xy-scatter": xyScatter,
  "bubble-plot": bubblePlot,
  "xy-bar": xyBar,
  "xy-area": xyArea,
  "xy-spikes": xySpikes,
  "xy-bar-scatter": xyBarScatter,
  "grouped-bars": groupedBars,
  "grouped-bars-scatter": groupedBarsScatter,
  "grouped-scatter": groupedScatter,
  "grouped-before-after": groupedBeforeAfter,
  "grouped-lines": groupedLines,
  "grouped-stacked": groupedStacked,
  "grouped-hbars": groupedHbars,
  "grouped-box": groupedBox,
  "floating-bars": floatingBars,
  pie,
  donut,
  "pow-stacked": powStacked,
  "schild-plot": schildPlot,
  "smooth-curve": smoothCurve,
  "logistic-curve": logisticCurveGraph,
  heatmap,
  survival,
  "forest-plot": forestPlot,
  "estimation-plot": estimationPlot,
  volcano,
  "bland-altman": blandAltmanGraph,
  "roc-curve": rocCurveGraph,
  "observed-fitted": observedFitted,
  "scree-plot": screePlot,
  "pca-biplot": pcaBiplot,
  "kmeans-scatter": kmeansScatter,
  dendrogram,
  "elbow-plot": elbowPlot,
  "silhouette-plot": silhouettePlot,
  "gap-plot": gapPlot,
  histogram,
  "monte-carlo-histogram": monteCarloHistogram,
  "qq-plot": qqPlot,
  residuals,
  // FlowJo (seq 442): registered, so the export pipeline + registry reuse
  // is real — but offered in NO GRAPH_OPTIONS_BY_TABLE list, so no picker
  // shows them while the flow toggle is off (opt-in, off by default).
  "flow-dot-plot": flowDotPlot,
  "flow-density-plot": flowDensityPlot,
  "flow-contour-plot": flowContourPlot,
  "flow-pseudocolor-plot": flowPseudocolorPlot,
  "flow-histogram": flowHistogramPlot,
  "mv-strip-plot": mvStripPlot,
  "mv-summary-symbol": mvSummarySymbol,
  "mv-bar-strip": mvBarStrip,
  "mv-before-after-bar-strip": mvBeforeAfterBarStripPlot,
  "mv-before-after-strip": mvBeforeAfterStrip,
  "mv-box-whisker": mvBoxWhisker,
  "mv-violin": mvViolin,
  "mv-bar-chart": mvBarChart,
};

/** The two variables a scatter of a Multiple Variables table plots, X then Y: the ones
 *  chosen, else (none, or gone) the first two holding numbers. */
export function variablePair<T extends { name: string }>(numeric: T[], options: GraphOptions): [T?, T?] {
  const byName = (name?: string) => numeric.find((c) => c.name === name);
  const x = byName(options.xVariable) ?? numeric[0];
  return [x, byName(options.yVariable) ?? numeric.find((c) => c !== x)];
}

/** The columns a graph plots: every column for the volcano (it maps text labels
 *  too), one per data set holding numbers for the heatmap (a grouped table's
 *  replicates as their `center` on each row), X then the Y series for the XY family
 *  (none while X is empty; a Multiple Variables table's two variables), else the
 *  columns holding numbers. A Bland-Altman plot on an XY table is the exception
 *  to the XY family's X-first shape: its two methods are Y columns only (see
 *  the special case below), so X is never handed to its builder as a method. */
export function plotColumns(
  table: Dataset,
  type: GraphType,
  options: GraphOptions,
  tableType: TableType,
): Column[] {
  const { family } = GRAPHS[type];
  const { columns: allColumns, numeric, sets: allSets, summary } = table;
  // The ROC curve plots a text-or-numeric truth column against its score:
  // the first two data columns, whatever they hold (the graph errors empty
  // when the truth has other than two classes or the score has no numbers).
  if (type === "roc-curve") return allColumns.slice(0, 2);
  // A Bland-Altman plot compares two measurement methods, so on an XY table
  // its columns are the Y columns only: the X column is the independent
  // variable (time, dose…) — not a method — and handing it to the builder
  // as the first method plotted X against a method, the exact invalid
  // comparison the wizard guard (F8) already blocks. A column table has no
  // X, so the generic XY-family branch below hands it every column.
  if (type === "bland-altman" && tableType === "xy") return splitXY(allColumns).ys.flatMap((s) => s.columns);
  if (family === "volcano") return allColumns;
  // The data sets it shows, when it chose some: their columns alone (an XY table's X too).
  const shown = choosableSets(type, table, tableType).length ? options.sets : undefined;
  const keep = (c: Column) => !shown || shown.includes(c.set ?? c.name);
  const columns = allColumns.filter((c, i) => keep(c) || (hasXColumn(tableType) && i === 0));
  const sets = allSets.filter((s) => !shown || shown.includes(s.name));
  if (family === "heatmap")
    return sets
      .filter((s) => s.columns.some((c) => c.values.length))
      .map((s) =>
        // A summary table's heatmap plots the Mean column — averaging
        // Mean/SD/N (what centerColumn would do) is meaningless.
        summary !== "replicates" ? (summaryMeanColumn(s) ?? centerColumn(s, options.center)) : centerColumn(s, options.center),
      );
  // A bubble plot of a Multiple Variables table: X then Y, the size variable, the
  // color variable — each chosen, else the next holding numbers (the size's default
  // is the third numeric; no color variable colors it the series' color). The color
  // variable may be text (one color per value), so it is looked up among all the
  // columns, not just the numeric ones.
  if (type === "bubble-plot" && tableType === "multiple") {
    const [x, y] = variablePair(numeric, options);
    const byName = (name?: string) => numeric.find((c) => c.name === name);
    const color = columns.find((c) => c.name === options.bubbleColorVariable);
    const size = byName(options.bubbleSizeVariable) ?? numeric.find((c) => c !== x && c !== y && c !== color);
    return [x, y, size, color].filter((c): c is (typeof numeric)[number] => c !== undefined);
  }
  // A Multiple Variables table's histogram: its one variable, as a scatter's X.
  if (family === "histogram" && tableType === "multiple") {
    const x = variablePair(numeric, options)[0];
    return x ? [x] : [];
  }
  // A grouped graph on an XY table plots the Y data sets across the rows
  // (Prism's grouped reading of XY data): the X column is the independent
  // variable, not a group, and the rows are spaced by row number — handing
  // X to the grouped builders would plot it as a series of its own.
  if (family === "grouped" && tableType === "xy") {
    const { x } = splitXY(allColumns);
    return numeric.filter((c) => c !== x && keep(c));
  }
  if (family !== "xy") return numeric.filter(keep);
  if (tableType === "multiple") {
    const [x, y] = variablePair(numeric, options);
    return x && y ? [x, y] : [];
  }
  const { x, ys } = splitXY(columns);
  return x ? [x, ...ys.flatMap((s) => s.columns)] : [];
}

/** The data sets a graph can show or leave out, in table order: those holding numbers, an
 *  XY or Survival table's X aside; none where the graph picks its own columns (a volcano,
 *  a Multiple Variables table's scatter or histogram, a ROC curve, a Bland-Altman plot,
 *  a bubble plot). */
export function choosableSets(type: GraphType, table: Dataset, tableType: TableType): string[] {
  const { family } = GRAPHS[type];
  if (
    family === "volcano" ||
    type === "roc-curve" ||
    type === "bland-altman" ||
    type === "bubble-plot" ||
    (tableType === "multiple" && (family === "xy" || family === "histogram"))
  )
    return [];
  return table.sets
    .filter((s, i) => !(hasXColumn(tableType) && i === 0) && s.columns.some((c) => c.values.length > 0))
    .map((s) => s.name);
}

/** The series a graph colors, in order: a volcano's "down" and "up", none for a
 *  heatmap (its cells follow the palette), one "Observed vs fitted" series for
 *  that graph (its points are one series, not the table's columns), a Multiple
 *  Variables scatter's Y variable, else the table's series. */
export function graphSeries(type: GraphType, data: TableData, tableType: TableType, options: GraphOptions): string[] {
  return graphSeriesDataset(type, readTable(data), tableType, options);
}

/** `graphSeries`, over an already-read dataset — the merged dataset of a
 *  multi-table graph (#48) has no single `TableData` to read from. */
export function graphSeriesDataset(
  type: GraphType,
  dataset: Dataset,
  tableType: TableType,
  options: GraphOptions,
): string[] {
  const { family } = GRAPHS[type];
  if (type === "observed-fitted") return [OBSERVED_FITTED_SERIES];
  if (type === "monte-carlo-histogram") return [MONTE_CARLO_HISTOGRAM_SERIES];
  // The PCA graphs draw one series each (the scree bars, the score points),
  // not the table's variables — the Series section styles that series.
  if (type === "scree-plot") return [SCREE_SERIES];
  if (type === "pca-biplot") return [PCA_BIPLOT_SERIES];
  if (type === "dendrogram") return [DENDROGRAM_SERIES];
  if (type === "elbow-plot") return [ELBOW_SERIES];
  if (type === "silhouette-plot") return [SILHOUETTE_SERIES];
  if (type === "gap-plot") return [GAP_SERIES];
  // The cluster scatter's series are its clusters, whose count lives in the
  // linked analysis's result — not in the table or the options — so there is
  // no fixed list to offer; the traces take the palette's colours in order
  // (see graph-view.tsx, which sizes the paint by the result's clusters).
  if (type === "kmeans-scatter") return [];
  if (family === "volcano") return Object.keys(VOLCANO_SERIES);
  if (family === "heatmap") return [];
  // A Parts-of-Whole graph's series are its categories (rows), not its data
  // sets: a pie's slices and a stacked bar's segments are the rows, so the
  // Series section styles — and the paint keys — the categories.
  if (tableType === "parts-of-whole" && (type === "pie" || type === "donut" || type === "pow-stacked")) {
    return dataset.titles.filter((t): t is string => t !== null && t.trim() !== "");
  }
  if (family === "xy" && tableType === "multiple") {
    const y = variablePair(dataset.numeric, options)[1];
    return y ? [y.name] : [];
  }
  if (family === "histogram" && tableType === "multiple") {
    const x = variablePair(dataset.numeric, options)[0];
    return x ? [x.name] : [];
  }
  // An XY graph with X error bars on draws its "<X> error" column as the
  // bars, not as a series — the Series section styles only what is drawn.
  if (family === "xy" && options.xError) {
    const first = dataset.columns[0]?.name;
    const series = seriesOfDataset(dataset, tableType);
    return first ? series.filter((s) => s !== `${first} error`) : series;
  }
  return seriesOfDataset(dataset, tableType);
}

/** A new graph's options: the defaults, with its type's palette and own defaults.
 *  `error`: a table's error format, when the graph is made from that table — an
 *  SD-formatted table's graphs default to SD error bars. Omitted: SEM, as before. */
export function newGraphOptions(type: GraphType, error?: TableErrorFormat): GraphOptions {
  const { palette, defaults } = GRAPHS[type];
  return {
    ...DEFAULT_GRAPH_OPTIONS,
    palette: savedPalette(paletteNamed(palette ?? "okabe-ito")!),
    ...defaults,
    ...(error ? { error } : {}),
  };
}

const optionsFor = (types: GraphType[]): SelectorOption<GraphType>[] =>
  types.map((value) => ({ value, label: titleCase(GRAPHS[value].label) }));

/** Graph types scoped per table type — a Column table's columns are independent
 *  groups (bars/box/points), an XY table's are X + Y data series (scatter/line/
 *  bar/area against a shared X) — so the graphs that make sense differ too.
 *  Grouped tables (groups × replicates, rows = X categories) plot one series per
 *  group across the rows: interleaved scatter / box and violin / bars / stacked /
 *  horizontal.
 *  Grouped (one cell per group and row), Multiple Variables (rows = subjects, columns =
 *  variables) and Contingency (counts) plot as a heatmap too.
 *  Mirrors `ANALYSIS_OPTIONS_BY_TABLE`. */
export const GRAPH_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<GraphType>[]> = {
  column: optionsFor([
    "individual",
    "before-after",
    "box-violin",
    "mean-error",
    "estimation-plot",
    "histogram",
    "qq-plot",
    "pie",
    "donut",
    "bland-altman",
    "roc-curve",
    "monte-carlo-histogram",
    // Seq 212: one bar per column, spanning its min to its max.
    "floating-bars",
  ]),
  xy: optionsFor([
    "xy-scatter",
    "xy-bar",
    "xy-area",
    "xy-spikes",
    "xy-bar-scatter",
    "residuals",
    "schild-plot",
    "smooth-curve",
    "logistic-curve",
    "survival",
    "volcano",
    "bland-altman",
    "roc-curve",
    "monte-carlo-histogram",
    // Seq 210: an XY table also plots as grouped — its Y data sets are the
    // groups, the rows its categories (Prism's grouped reading of XY data):
    // the X column is the independent variable, not a group, and the rows
    // are spaced by row number (`plotColumns` drops X for this family).
    "grouped-bars",
    "grouped-scatter",
    "grouped-lines",
    "grouped-stacked",
    "grouped-hbars",
  ]),
  grouped: optionsFor([
    "grouped-scatter",
    "grouped-before-after",
    "grouped-box",
    "grouped-bars",
    "grouped-bars-scatter",
    "grouped-lines",
    "grouped-stacked",
    "grouped-hbars",
    "heatmap",
    "volcano",
    // Seq 212: one bar per row × group, spanning the cell's min to max.
    "floating-bars",
  ]),
  // A nested table's groups plot one series per group across the rows, as a
  // grouped table's do — the grouped builders read the groups through
  // `groupsOf`, which takes a nested column's group prefix ("A" for
  // "A:S1:R1"), so bars, scatter and lines all draw from nested columns.
  // Seq 210: mean-and-error too (its per-subgroup pooling reads the Mean
  // columns of a nested summary table; see mean-error.ts).
  // Seq 212: floating bars — one bar per row × group × subgroup cell.
  nested: optionsFor(["grouped-bars", "grouped-bars-scatter", "grouped-scatter", "grouped-lines", "mean-error", "floating-bars"]),
  multiple: optionsFor(["xy-scatter", "bubble-plot", "histogram", "qq-plot", "heatmap", "mv-strip-plot", "mv-summary-symbol", "mv-bar-strip", "mv-before-after-bar-strip", "mv-before-after-strip", "mv-box-whisker", "mv-violin", "mv-bar-chart", "volcano", "forest-plot", "observed-fitted", "scree-plot", "pca-biplot", "kmeans-scatter", "dendrogram", "elbow-plot", "silhouette-plot", "gap-plot", "survival"]),
  // Outcomes as series across the row categories, as Prism graphs contingency tables.
  // Seq 210: scatter and box-and-violin too (one value per cell: a box from a
  // single value is degenerate, a line — but that is what Prism offers).
  // Seq 212: floating bars — one bar per outcome, spanning its counts across the rows.
  contingency: optionsFor(["grouped-bars", "grouped-stacked", "grouped-hbars", "heatmap", "grouped-scatter", "grouped-box", "floating-bars"]),
  survival: optionsFor(["survival"]),
  // Rows are the mutually exclusive categories, columns the data sets: a pie
  // of one data set (slices are its rows) and a stacked bar (one bar per data
  // set, segments are the rows) — Prism's two Parts-of-Whole graphs. The
  // donut is Titer's pie variant, as on Column tables.
  "parts-of-whole": optionsFor(["pie", "donut", "pow-stacked"]),
};
