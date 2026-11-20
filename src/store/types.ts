// Shared project-tree types — kept light so both the store and the table-type
// modules can depend on it without creating a cycle.

import type { AnalysisParams, AnalysisResult, AnalysisType } from "../stats/types";
import type { SummaryFormat } from "../lib/summary-format";

export type NodeType = "table" | "analysis" | "graph" | "figure" | "info";
/** What an item is, as menus name it ("Delete Graph…"). */
export const NODE_NAMES: Record<NodeType, string> = {
  table: "Table",
  analysis: "Analysis",
  graph: "Graph",
  figure: "Figure",
  info: "Info Sheet",
};
export type TableType = "column" | "xy" | "grouped" | "nested" | "multiple" | "contingency" | "survival";
/** Tables whose first data column is X (a Survival table's is the time). */
export const hasXColumn = (type: TableType) => type === "xy" || type === "survival";
// Every graph type; views/graphs/index.ts says what each draws and for which tables.
export type GraphType =
  | "individual"
  | "before-after"
  | "box-violin"
  | "mean-error"
  | "xy-scatter"
  | "xy-bar"
  | "xy-area"
  | "grouped-bars"
  | "grouped-scatter"
  | "grouped-before-after"
  | "grouped-box"
  | "grouped-lines"
  | "grouped-stacked"
  | "grouped-hbars"
  | "pie"
  | "donut"
  | "schild-plot"
  | "logistic-curve"
  | "heatmap"
  | "survival"
  | "forest-plot"
  | "volcano"
  | "bland-altman"
  | "roc-curve"
  | "observed-fitted"
  | "smooth-curve"
  | "estimation-plot"
  | "scree-plot"
  | "pca-biplot"
  | "kmeans-scatter"
  | "dendrogram"
  | "elbow-plot"
  | "silhouette-plot"
  | "gap-plot"
  | "monte-carlo-histogram"
  | "bubble-plot"
  | "histogram"
  | "qq-plot"
  | "residuals";

/** The choices of a graph's options, one list each: the types come from them, and a
 *  file's value outside them is read as the option's default. */
export const GRAPH_CHOICES = {
  center: ["mean", "median"],
  error: ["none", "sd", "sem", "ci"],
  xScale: ["linear", "log10", "log2"],
  yScale: ["linear", "log10", "log2"],
  y2Scale: ["linear", "log10", "log2"],
  stackAs: ["values", "percent"],
  shape: ["bar", "point", "line"],
  kind: ["box", "violin"],
  xyStyle: ["points", "line", "points+line"],
  xyReplicates: ["mean", "each"],
  pieValue: ["sum", "mean"],
  groupLayout: ["interleaved", "separated"],
  sigDisplay: ["stars", "pvalue", "letters"],
  regBand: ["confidence", "prediction"],
  residualsAs: ["x", "qq"],
  survivalMode: ["codes", "counts"],
  volcanoEffect: ["log2ratio", "difference"],
  volcanoSignificance: ["pvalue", "fdr"],
  pointShape: ["circle", "square", "diamond", "triangle-up", "triangle-down"],
  lineDash: ["solid", "dash", "dot", "dashdot"],
  errorDirection: ["both", "above"],
  background: ["white", "transparent"],
  gridX: ["none", "major", "major-minor"],
  gridY: ["none", "major", "major-minor"],
  tickDirection: ["outside", "inside", "none"],
} as const;
type Choice<K extends keyof typeof GRAPH_CHOICES> = (typeof GRAPH_CHOICES)[K][number];

/** A number's range. */
export type Limits = { min: number; max: number };

/** `n` brought within `limits`. */
export const clamp = (n: number, { min, max }: Limits) => Math.min(max, Math.max(min, n));

/** The range of a graph's numbers, for the Format panel's steppers and a file's values
 *  alike (a point styled on its own too). Its size (px) too: dragging an axis, typing it. */
export const GRAPH_LIMITS = {
  width: { min: 150, max: 2400 },
  height: { min: 120, max: 1800 },
  fill: { min: 0, max: 1 },
  pointFill: { min: 0, max: 1 },
  barGap: { min: 0, max: 0.5 },
  pointSize: { min: 2, max: 20 },
  outline: { min: 0, max: 6 },
  pointOutline: { min: 0, max: 6 },
  lineWidth: { min: 0.5, max: 6 },
  errorWidth: { min: 0.5, max: 6 },
  axisWidth: { min: 0.5, max: 6 },
  errorCaps: { min: 0, max: 20 },
  tickLength: { min: 0, max: 20 },
  xTitleGap: { min: 0, max: 40 },
  yTitleGap: { min: 0, max: 40 },
  fontSize: { min: 8, max: 28 },
  volcanoLabelCount: { min: 0, max: 50 },
  volcanoFcThreshold: { min: 0, max: Infinity },
  volcanoPThreshold: { min: 0, max: Infinity },
  /** A bubble plot's largest symbol, in px of diameter (its smallest is 3 px). */
  bubbleMaxSize: { min: 4, max: 200 },
  /** The biplot's plotted components, 1-based (PC1 vs PC2 by default);
   *  clamped to the components the linked PCA actually reported. */
  pcaX: { min: 1, max: 20 },
  pcaY: { min: 1, max: 20 },
} as const;

/**
 * Display options for a graph node. A superset across the families — each graph
 * module reads only the fields it needs (keeps the store flat + easy to extend).
 */
export interface GraphOptions {
  // Individual values
  bars: boolean; // draw a faint bar at the mean behind the points
  // Shared (individual + mean-error)
  center: Choice<"center">;
  error: Choice<"error">;
  // Mean/median & error
  shape: Choice<"shape">;
  // Box & violin
  kind: Choice<"kind">;
  showPoints: boolean; // overlay individual points on box/violin
  // Estimation plot: draw violins behind the raw points (else a scatterplot).
  estimationViolin: boolean;
  // XY scatter: markers only, connecting line only, or both
  xyStyle: Choice<"xyStyle">;
  // An XY table's replicates: each X's center and error (`center`, `error`), or each value.
  xyReplicates: Choice<"xyReplicates">;
  // Pie/donut (axis-less proportion charts): each column is one slice, sized by the
  // column's total (sum) or mean; percentages vs. raw values on the slice labels.
  pieValue: Choice<"pieValue">;
  pieShowPercent: boolean;
  // Grouped bars/scatter (interleaved bars, horizontal bars, interleaved scatter):
  // interleave groups within each row, or give each group its own block of
  // categories (Prism's "Separated" arrangement). Not offered for connected
  // lines (groups must share the same X axis to show interaction) or stacked
  // bars (stacking already combines groups per category).
  groupLayout: Choice<"groupLayout">;
  // Stacked bars: each group's value, or its share of the row's total (100 % bars).
  stackAs: Choice<"stackAs">;
  // Titles
  title: string;
  xLabel: string;
  yLabel: string;
  // Each axis's scale: linear, or logarithmic with ticks at powers of 10 or of 2. The
  // value axis is Y (X on horizontal bars); X only where it is numeric (XY).
  xScale: Choice<"xScale">;
  yScale: Choice<"yScale">;
  // Y-axis scale (Prism-style). All optional — blank = auto. Manual min+max set
  // the range; yStep sets the tick interval (every 1, 10, …).
  yMin?: number;
  yMax?: number;
  yStep?: number;
  // X-axis scale (XY family only — Column family's X is categorical). Same semantics as Y.
  xMin?: number;
  xMax?: number;
  xStep?: number;
  // Right (second) Y axis (XY family only): one Y data set plotted against a
  // right-hand axis, with its own title, scale and range; the rest stay on the
  // left. `rightYDataset` names the set (max one by construction); blank = off.
  rightYDataset?: string;
  y2Label?: string;
  y2Scale: Choice<"y2Scale">;
  y2Min?: number;
  y2Max?: number;
  y2Step?: number;
  // An axis limit hooked to an info constant (the constant's name, not its
  // value): resolved live in GraphView, so editing the constant moves the
  // axis. A hooked limit wins over its number above when it resolves.
  yMinConstant?: string;
  yMaxConstant?: string;
  xMinConstant?: string;
  xMaxConstant?: string;
  // A histogram's bin width, in the values' units; omitted (or 0 and under), R's own bins.
  binWidth?: number;
  // Significance annotations (Column and grouped graphs): read a sibling analysis's
  // pairwise comparisons and draw brackets. `sigAnalysisId` is the source analysis
  // node; `sigPairs` are the comparison keys (see significance-overlay) to draw;
  // `sigDisplay`: star marks, raw P values, or letters over every group (no brackets).
  sigAnalysisId?: string;
  sigPairs?: string[];
  sigDisplay: Choice<"sigDisplay">;
  // A regression of the table drawn on an XY scatter: a linear one's line and 95% band,
  // computed from the plotted pairs (regression-overlay.ts, checked against R's), or a
  // nonlinear one's curve from its result (fitted-curve.ts); and its note.
  regAnalysisId?: string;
  regShowLine: boolean;
  regShowBand: boolean;
  // The band's kind: where the line lies (confidence), or where a new point would (prediction).
  regBand: Choice<"regBand">;
  // A residual plot: residuals against X, or their QQ plot.
  residualsAs: Choice<"residualsAs">;
  regShowEquation: boolean;
  // Deming-regression overlay (XY scatter only): draw a sibling "Deming regression"
  // analysis's fit line (solid) plus the OLS line (dashed) for comparison, both
  // computed directly from the plotted x/y pairs (see deming-overlay.ts) — no
  // WebR round-trip, since the closed form has one unique solution and always
  // matches the sibling analysis's R-computed fit exactly.
  demingAnalysisId?: string;
  demingShowLine: boolean;
  demingShowOls: boolean;
  demingShowEquation: boolean;
  // Cox proportional-hazards regression (Multiple Variables only): the sibling
  // "Cox proportional-hazards regression" analysis a forest plot draws its
  // hazard ratios from, or a survival curve stratifies by (see forest-plot.ts
  // and survival.ts) — the graph runs the same cached runAnalysis result.
  coxAnalysisId?: string;
  // Compare two groups (Column only): the sibling "Compare two groups"
  // (t test) analysis an estimation plot draws its difference between means
  // with its 95% CI from (see estimation-plot.ts) — the graph runs the same
  // cached runAnalysis result.
  ttestAnalysisId?: string;
  // Poisson regression (Multiple Variables only): the sibling
  // "Poisson regression" analysis an observed-vs-fitted graph draws its
  // fitted counts from (see observed-fitted.ts) — the graph runs the same
  // cached runAnalysis result.
  poissonAnalysisId?: string;
  // Principal component analysis (Multiple Variables only): the sibling
  // "Principal component analysis" a scree plot or scores biplot draws from
  // (see scree-plot.ts and pca-biplot.ts) — the graph runs the same cached
  // runAnalysis result. `pcaX`/`pcaY` are the biplot's plotted components,
  // 1-based (PC1 vs PC2 by default).
  pcaAnalysisId?: string;
  pcaX: number;
  pcaY: number;
  // K-means clustering (Multiple Variables only): the sibling
  // "K-means clustering" analysis a cluster scatter draws its assignments
  // and centres from (see kmeans-scatter.ts) — the graph runs the same
  // cached runAnalysis result. It plots the first two variables.
  kmeansAnalysisId?: string;
  // Hierarchical clustering (Multiple Variables only): the sibling
  // "Hierarchical clustering" analysis a dendrogram or a choosing-k plot
  // draws its tree and diagnostics from (see dendrogram.ts and
  // choosing-k.ts) — the graph runs the same cached runAnalysis result.
  hclustAnalysisId?: string;
  // A Multiple Variables table's scatter: its X and Y variables (column names); omitted,
  // the first two holding numbers.
  xVariable?: string;
  yVariable?: string;
  // A Multiple Variables table's bubble plot (Prism 9): X and Y set the location; a
  // third variable sets each symbol's size (area ∝ value) and a fourth, optionally,
  // its color — a gradient for numbers, one palette color per value for text.
  // Omitted, the third variable holding numbers sizes the bubbles, and the series'
  // color colors them. `bubbleMaxSize` is the largest symbol's diameter, in px.
  bubbleSizeVariable?: string;
  bubbleColorVariable?: string;
  bubbleMaxSize: number;
  // Smooth curve (XY family only): the fitted curve of a sibling "Spline and
  // Lowess" analysis, drawn over the scatter (see smooth-curve.ts) — the graph
  // runs the same cached runAnalysis result, no extra R call. Without a linked
  // analysis it draws the points only.
  smoothAnalysisId?: string;
  smoothShowCurve: boolean;
  // Monte Carlo histogram (Column and XY family): the simulated-statistic
  // distribution of a sibling "Monte Carlo simulation" analysis (see
  // monte-carlo-histogram.ts) — the graph runs the same cached runAnalysis
  // result, no extra R call. Without a linked analysis it draws only its axes.
  monteCarloAnalysisId?: string;
  // Heatmap: each cell's value colored along the graph's gradient palette (a Grouped
  // table's cells, each group's center on its row).
  heatmapShowValues: boolean;
  heatmapShowScale: boolean;
  // Survival curve (Survival and XY tables) — see survival.ts. Two data entry modes:
  // "codes" = one row per subject, cell is an event code (1 = event, 0 = censored)
  // at the paired X (time); computed via Kaplan-Meier. "counts" = cell is the
  // number of survivors remaining in that group at the paired X; plotted directly
  // as percent-of-initial, no censoring concept. Censoring ticks (codes mode only)
  // mark subjects removed from a group without an event.
  survivalMode: Choice<"survivalMode">;
  survivalShowCensors: boolean;
  survivalShowBand: boolean; // each Kaplan-Meier curve's 95% confidence band (event codes)
  survivalShowAtRisk: boolean; // the Number at Risk table under the curve, at each X-axis major tick
  // Volcano plot of a Multiple Variables or XY table: it plots columns the user already
  // has. `volcanoX`/`volcanoY`/`volcanoLabel` are column names:
  // X = effect size (e.g. log2 fold change; an XY table's X column), Y = a significance
  // value (raw p, adjusted p, FDR, …), label = optional gene-name column (else the row
  // titles name the genes). `volcanoYIsPValue`:
  // Y holds P values (or FDR…), plotted as their -log10; off, values that are -log10
  // already, plotted as they are. Higher is more significant either way. Thresholds color points up/down/NS + draw dashed guides;
  // `volcanoLabelCount` annotates that many of the most significant genes.
  volcanoX?: string;
  volcanoY?: string;
  volcanoLabel?: string;
  volcanoYIsPValue: boolean;
  volcanoFcThreshold: number; // |X| cutoff (log2FC scale)
  volcanoPThreshold: number; // cutoff on the plotted (−log10) scale: about 1.3 is P = 0.05
  volcanoShowThresholds: boolean;
  volcanoLabelCount: number;
  // Grouped-table volcano (Titer computes the DEGs): compare two groups (by column
  // prefix, e.g. "A"/"B") row by row. `volcanoEffect` picks the X value — log2 of the
  // ratio of group means (raw data) or the plain difference of means (data already
  // on a log scale). `volcanoSignificance` picks the Y source — the per-row Welch
  // t-test p value or its Benjamini-Hochberg FDR adjustment (−log10 via volcanoYIsPValue).
  volcanoGroupA?: string;
  volcanoGroupB?: string;
  volcanoEffect: Choice<"volcanoEffect">;
  volcanoSignificance: Choice<"volcanoSignificance">;
  // Before-and-after plots (Column and Grouped families): draw an arrowhead
  // on each subject's line, pointing from the earlier to the later condition.
  beforeAfterArrows: boolean;
  // Colors. `palette`: its name and colors, saved with the graph so a figure keeps
  // them whatever becomes of Titer's catalog (lib/palettes.ts). `series`: the series
  // colored by hand, by name (a column, a group, a volcano's "up" and "down"); the
  // others take the palette's color for their place.
  palette?: GraphPalette;
  series?: Record<string, SeriesStyle>;
  // Points styled one by one, by `"<column>#<row>"` (see `pointKeyOf`): over their series'.
  points?: Record<string, PointStyle>;
  // How opaque fills are (0–1): `fill` of bars, boxes, violins and areas, `pointFill` of points.
  fill: number;
  pointFill: number;
  // Every point's size (px), shape and outline thickness (px); a series' shape wins.
  pointSize: number;
  pointShape: PointShape;
  pointOutline: number;
  // Outlines: of bars, boxes, violins, areas and slices, their thickness (px) and color;
  // the points' color. No color: the color of what they outline.
  outline: number;
  outlineColor?: string;
  pointOutlineColor?: string;
  // The gap between the bars of a row on interleaved grouped bars, as a fraction of the row.
  barGap: number;
  // Every series line's thickness (px) and dashes; a series' dashes win.
  lineWidth: number;
  lineDash: LineDash;
  // The data sets it shows (columns, a grouped table's groups, an XY table's Y data sets),
  // by name; none: all of them. One table, many graphs of some of its data sets.
  sets?: string[];
  // Lines across the plot at values of the value axis (Y; X on horizontal bars): a sham
  // group's level, a threshold… (`refLineParts` draws them).
  refLines?: RefLine[];
  // Texts moved by hand: the legend (or a heatmap's color legend), as a fraction of
  // the plot area; the note (a fit's equation), in px from its corner. None: in place.
  legend?: Place;
  note?: Place;
  // The space (px) between each axis title and its tick labels.
  xTitleGap: number;
  yTitleGap: number;
  // Error bars, and the mean or median line drawn with them: thickness and cap width (px),
  // color (none: the series'), and whether they go both ways or only above (right).
  errorWidth: number;
  errorCaps: number;
  errorColor?: string;
  errorDirection: Choice<"errorDirection">;
  // Appearance: thickness of every axis spine + its tick marks (px), and the base
  // font size (px) for tick labels, axis titles, and the chart title.
  axisWidth: number;
  fontSize: number;
  // Gridlines (Prism-style, per axis): none, at the major ticks only, or at the
  // major and minor ticks — light, so values can be read off a journal figure
  // without the lines competing with the data. Off by default: the minimalist
  // look stays until the user asks for them.
  gridX: Choice<"gridX">;
  gridY: Choice<"gridY">;
  // Tick marks: which side of the spine they sit on, and how long they are (px).
  tickDirection: Choice<"tickDirection">;
  tickLength: number;
  // The sheet behind the graph: white, or none (a PNG or SVG with a transparent background;
  // JPEG has no transparency and stays on white).
  background: Choice<"background">;
  // Prism-style resizable drawing area (px).
  width: number;
  height: number;
}

export const DEFAULT_GRAPH_OPTIONS: GraphOptions = {
  bars: false,
  center: "mean",
  error: "sem",
  shape: "bar",
  kind: "box",
  showPoints: false,
  estimationViolin: false,
  xyStyle: "points",
  xyReplicates: "mean",
  pieValue: "sum",
  pieShowPercent: true,
  groupLayout: "interleaved",
  sigDisplay: "stars",
  regShowLine: true,
  regShowBand: true,
  regBand: "confidence",
  residualsAs: "x",
  regShowEquation: true,
  demingShowLine: true,
  demingShowOls: true,
  demingShowEquation: true,
  smoothShowCurve: true,
  heatmapShowValues: false,
  heatmapShowScale: true,
  beforeAfterArrows: false,
  survivalMode: "codes",
  survivalShowCensors: true,
  survivalShowBand: false,
  survivalShowAtRisk: true,
  volcanoYIsPValue: true,
  volcanoFcThreshold: 1,
  volcanoPThreshold: -Math.log10(0.05),
  volcanoShowThresholds: true,
  volcanoLabelCount: 10,
  volcanoEffect: "log2ratio",
  volcanoSignificance: "pvalue",
  bubbleMaxSize: 40,
  pcaX: 1,
  pcaY: 2,
  stackAs: "values",
  title: "",
  xLabel: "",
  yLabel: "",
  xScale: "linear",
  yScale: "linear",
  y2Scale: "linear",
  axisWidth: 1,
  gridX: "none",
  gridY: "none",
  tickDirection: "outside",
  tickLength: 5,
  fontSize: 13,
  fill: 1,
  pointFill: 1,
  pointSize: 7,
  pointShape: "circle",
  pointOutline: 1.5,
  outline: 1.5,
  barGap: 0.1,
  lineWidth: 2,
  lineDash: "solid",
  xTitleGap: 12,
  yTitleGap: 2,
  errorWidth: 1.5,
  errorCaps: 6,
  errorDirection: "both",
  background: "white",
  width: 640,
  height: 460,
};

export const PALETTE_KINDS = ["categorical", "sequential", "diverging"] as const;
export type PaletteKind = (typeof PALETTE_KINDS)[number];

/** A graph's palette as saved: which one, and its colors. */
export interface GraphPalette {
  name: string;
  kind: PaletteKind;
  colors: string[];
  /** Its colors taken from the last. */
  reversed?: boolean;
}

/** A point's shape (Plotly's symbol of the same name). */
export type PointShape = Choice<"pointShape">;

/** A line's dashes (Plotly's dash of the same name). */
export type LineDash = Choice<"lineDash">;

/** What covers a fill: lines one way or the other, both, horizontal, vertical, a grid, dots. */
export const FILL_PATTERNS = [
  "diagonal",
  "back-diagonal",
  "crosshatch",
  "horizontal",
  "vertical",
  "grid",
  "dots",
] as const;
export type FillPattern = (typeof FILL_PATTERNS)[number];

/** How one series is drawn: its color (#RRGGBB), its points' shape, its line's dashes,
 *  and the pattern over its bars, areas or slices. */
export interface SeriesStyle {
  color?: string;
  shape?: PointShape;
  dash?: LineDash;
  pattern?: FillPattern;
}

/** How one point is drawn, over its series' and the graph's style; `label`: it shows
 *  its name (its row's title) beside it. */
export interface PointStyle {
  color?: string;
  size?: number;
  shape?: PointShape;
  /** How opaque its fill is (0–1). */
  fill?: number;
  outline?: number;
  /** "#RRGGBB", or `SAME_AS_FILL` (whatever the graph's points take). */
  outlineColor?: string;
  label?: boolean;
  /** Where its name was moved, in px from the point. */
  labelOffset?: Place;
}

/** A position: of a text on the graph, or of a name from its point. */
/** A reference line: where (in the value axis's units), its dashes, thickness (px) and
 *  color (none: the axes'), and the text at its end. */
export interface RefLine {
  value: number;
  dash: LineDash;
  width: number;
  color?: string;
  label?: string;
  /** Where its text sits (none: top right): above or below a horizontal line, at its right
   *  or left end; at the top or bottom of a vertical one, right or left of it. */
  labelPlace?: RefLabelPlace;
}

export const REF_LABEL_PLACES = ["top-right", "top-left", "bottom-right", "bottom-left"] as const;
export type RefLabelPlace = (typeof REF_LABEL_PLACES)[number];

/** How many reference lines a graph holds at most. */
export const MAX_REF_LINES = 10;

export interface Place {
  x: number;
  y: number;
}

/** A floating note's color: Prism's sticky-note colors (Yellow, Gray) plus
 *  three more, so notes can be color-coded for review. */
export type FloatingNoteColor = "yellow" | "gray" | "green" | "pink" | "blue";
export const FLOATING_NOTE_COLORS: FloatingNoteColor[] = ["yellow", "gray", "green", "pink", "blue"];

/** A color-coded note pinned to a sheet (data, results or graph) for review
 *  or collaboration — shown on screen only, never printed or exported.
 *  `x`/`y` are px from the sheet's top-left corner, like `Place`. */
export interface FloatingNote {
  id: string;
  text: string;
  color: FloatingNoteColor;
  x: number;
  y: number;
}

/** A sheet's highlight color in the Navigator: Prism lets a sheet be highlighted
 *  in a color of the user's choice, to mark it for review or draw a colleague's
 *  attention ("Highlight the pages that you want to review, or want a colleague
 *  to look at. Choose a different color highlight for different purposes.").
 *  Screen-only, like floating notes — never printed or exported. */
export const SHEET_HIGHLIGHTS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export type SheetHighlight = (typeof SHEET_HIGHLIGHTS)[number];
/** Each highlight's name, its solid swatch (the dot in the Navigator) and the
 *  soft tint behind a highlighted row. */
export const SHEET_HIGHLIGHT_STYLE: Record<SheetHighlight, { label: string; swatch: string; tint: string }> = {
  red: { label: "Red", swatch: "#D92D20", tint: "rgba(217, 45, 32, 0.12)" },
  orange: { label: "Orange", swatch: "#DC6803", tint: "rgba(220, 104, 3, 0.12)" },
  yellow: { label: "Yellow", swatch: "#B54708", tint: "rgba(220, 160, 0, 0.18)" },
  green: { label: "Green", swatch: "#067647", tint: "rgba(6, 118, 71, 0.12)" },
  blue: { label: "Blue", swatch: "#175CD3", tint: "rgba(23, 92, 211, 0.12)" },
  purple: { label: "Purple", swatch: "#6941C6", tint: "rgba(105, 65, 198, 0.12)" },
};

/** An outline color that is the color of what it outlines. */
export const SAME_AS_FILL = "fill";

/** Titer 1.0's named colors (see `NAMED_COLORS`), as its files may hold them. */
export type PaletteColor = "blue" | "red" | "green" | "purple" | "orange" | "black";

/** How many groups, subgroups and sub-columns a grouped or nested table has:
 *  its Groups panel and a file alike. A 200×50×20 nested table is 200,000 cells
 *  and the grid must not be asked to render it all — it only renders the
 *  visible columns, and the default new nested table is 2×3×3. */
export const GROUPED_LIMITS = {
  groups: { min: 1, max: 200 },
  replicates: { min: 1, max: 20 },
  nested: {
    groups: { min: 1, max: 200 },
    subgroups: { min: 1, max: 50 },
    replicates: { min: 1, max: 20 },
  },
};

/** One band of a grouped table's rows, carrying one level of a third factor
 *  (see `TableData.rowGroups`). */
export interface RowGroup {
  name: string;
  count: number;
}

/** A table's error format: SD or SEM — what its entered error values are. */
export type TableErrorFormat = "sd" | "sem";

/** A table's error format, defaulting to SEM (the graphs' default). */
export const tableErrorFormat = (data: TableData): TableErrorFormat => (data.errorFormat === "sd" ? "sd" : "sem");

/** One calculated variable (Prism 11, seq 156): a Multiple Variables
 *  table's column whose values come from a formula over the table's other
 *  variables, not from typing. `formula` is stored WITHOUT the leading `=`
 *  (`"A + B"`); the grid and the panel display it with it. `error` is
 *  recomputed, never trusted from a file: a formula that cannot run records
 *  why here, and its values stay blank. The engine lives in lib/calcvars.ts. */
export interface CalculatedVariable {
  name: string;
  formula: string;
  error?: string;
}

export interface TableData {
  columns: string[];
  rows: (string | null)[][];
  /** Calculated variables (Multiple Variables tables only): their formulas,
   *  in column order. Their values are materialized into `rows` by
   *  `recomputeCalculated`, so every analysis and graph reads them exactly
   *  like typed variables. Omitted when the table has none. */
  calculated?: CalculatedVariable[];
  /** A table's error format: what its entered error values are — SD or SEM
   *  (Prism's "Changing a data table format": a table formatted for SEM whose
   *  values are really SD can be switched). It labels the table's summary
   *  error columns (`_SD` vs `_SEM`) and is the default error bars of graphs
   *  made from the table; a graph's own error setting still wins for that
   *  graph. Omitted = SEM, the graphs' default. */
  errorFormat?: TableErrorFormat;
  /** Grouped tables only: number of top-level group headers (Group A, B, …). */
  groups?: number;
  /** Grouped tables only: replicate sub-columns per group. */
  replicates?: number;
  /** Grouped tables only: how the sub-columns are formatted — raw replicates,
   *  or pre-calculated summaries (mean / SD or SEM / N, …) entered instead of
   *  replicates (see src/lib/summary-format.ts). Omitted = replicates. */
  summaryFormat?: SummaryFormat;
  /** Nested tables only: subgroups per group (each subgroup is one animal /
   *  subject, whose replicate measurements sit in its sub-columns). */
  subgroups?: number;
  /** Grouped tables only: factor-C bands — consecutive rows sharing one level of a
   *  third factor, e.g. [{ name: "WT", count: 2 }, { name: "KO", count: 2 }].
   *  Omitted (or empty) = no third factor; existing files read as before. Bands
   *  must tile the table's rows exactly (see the three-way ANOVA runner). */
  rowGroups?: RowGroup[];
  /**
   * Prism-style excluded cells: `"row,col"` keys in full-grid coords (col 0 holds
   * the row titles and is never excluded). Excluded values stay in the table + the
   * `.hlx` file and are shown blue-italic with a trailing `*`, but are dropped from
   * every analysis and graph via `readTable()`. Omitted when nothing is excluded.
   */
  excluded?: string[];
  /** Column widths (px) the user set, keyed by column name; others fit their content. */
  widths?: Record<string, number>;
  /** Keep column 0 (the row titles) visible while scrolling right. */
  freezeTitle?: boolean;
  /** Provenance note (e.g. a simulated table's distribution + seed) — kept
   *  with the table in the .hlx file so the data's origin stays auditable. */
  notes?: string;
}

/** How a table computed from another transforms its values (lib/transform.ts). */
export const TRANSFORMS = ["log10", "log2", "ln", "normalize", "percent-of-control", "z-score"] as const;
/** What a z-score is taken within: each data set, or each row. */
export const Z_WITHIN = ["set", "row"] as const;

/** A table computed from another (`from`, a table's id): its values transformed, kept in
 *  step with that table's. `control`: the data set a percent is of; `within`: a z-score's. */
export interface Transform {
  from: string;
  kind: (typeof TRANSFORMS)[number];
  control?: string;
  within?: (typeof Z_WITHIN)[number];
}

/** The Finder's tag colors, in its order, as an item's `tags` name them. */
export const TAG_COLORS = {
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#FFCC00",
  green: "#34C759",
  blue: "#007AFF",
  purple: "#AF52DE",
  gray: "#8E8E93",
} as const;
export type TagColor = keyof typeof TAG_COLORS;

/** One row of an info sheet's structured table: a name and a string value,
 *  as Prism stores it ("2018-07-23", "0.5", ""). Numeric when a hook needs it.
 *  `notes` is a script-only appendage (a script's SetInfo position 2) — the
 *  sheet UI doesn't edit it, but the file keeps it. */
export interface InfoConstant {
  id: string;
  name: string;
  value: string;
  notes?: string;
}

/** An info sheet's data: its constants (left) and its free notes (right).
 *  `linkedTableId` ties it to one table (Prism's per-table info sheet);
 *  omitted, it is project info, global to the project. */
export interface InfoSheetData {
  constants: InfoConstant[];
  notes: string;
  linkedTableId?: string | null;
}

export interface ProjectNode {
  id: string;
  type: NodeType;
  name: string;
  parentId: string | null;
  /** Floating notes pinned to this sheet (any type): shown on screen, never
   *  printed or exported. Omitted when the sheet has none. */
  floatingNotes?: FloatingNote[];
  /** The sheet's highlight color in the Navigator (any type): a color marking
   *  it for review or a colleague's attention. Omitted when not highlighted. */
  highlight?: SheetHighlight;
  tableType?: TableType;
  data?: TableData;
  /** Tables computed from another only: how (their `data` is computed, never typed). */
  transform?: Transform;
  /** The user's note on the item (none: empty), in the right panel's Notes. */
  notes?: string;
  /** Its tags, as the Finder's: colors in `TAG_COLORS`' order, shown in the sidebar. */
  tags?: TagColor[];
  /** Analysis nodes only: which statistical test this node runs. */
  analysisType?: AnalysisType;
  /** Analysis nodes only: wizard-chosen params for the test, when it has any. */
  analysisParams?: AnalysisParams;
  /** Analysis nodes only: the last successfully computed result, kept so a
   *  frozen or orphaned sheet can show it without re-running (a frozen sheet
   *  never re-runs; an orphaned one has no source table left to run on).
   *  Written to the `.hlx` file with the node, so the results survive a
   *  save and reload. */
  cachedResult?: AnalysisResult;
  /** Analysis nodes only: frozen — the sheet shows `cachedResult` and stops
   *  auto-updating when the data change (Prism's freeze button). */
  frozen?: boolean;
  /** Analysis nodes only: orphaned — the source table was deleted, so the
   *  results stay as they were and the analysis parameters cannot be changed
   *  (Prism's orphaned results). The node lives at the project root. */
  orphaned?: boolean;
  /** Analysis nodes only: the source table's name when orphaned, for the
   *  banner ("the source table “Doses” was deleted"). */
  sourceTableName?: string;
  /** Graph nodes only: which chart this node draws + its display options. */
  graphType?: GraphType;
  graphOptions?: GraphOptions;
  /** Graph nodes only (#48): the extra tables this graph also plots, by
   *  id, beyond its primary table (`parentId`). Same table type as the
   *  primary; their series are qualified with the table's name
   *  (see src/lib/multi-table.ts). Omitted = a single-table graph. */
  sourceTableIds?: string[];
  /** Figure nodes only: the panels it composes (see src/lib/figure.ts). */
  panels?: FigurePanel[];
  grid?: FigureGrid;
  figureSize?: FigureSize;
  labelStyle?: FigureLabelStyle;
  figureTitle?: string;
  sharedLegend?: SharedLegend;
  dpi?: Resolution;
  /** Info sheet nodes only: its constants, notes, and linked table. */
  info?: InfoSheetData;
}

/** One panel of a multi-panel figure: a reference to an existing graph node,
 *  never a copy of it — editing the graph updates the panel automatically. */
export interface FigurePanel {
  graphId: string;
  /** The graph's name when the panel was saved: a hint for the placeholder
   *  shown when the graph is gone ("Graph 'Dose-response' is missing").
   *  Never trusted for lookup — ids are the reference. */
  graphName?: string;
  label: string;
  /** True when the label was typed by hand: it sticks to the panel when
   *  panels move, instead of being reassigned in reading order. */
  labelManual?: boolean;
  title: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface FigureGrid {
  rows: number;
  cols: number;
}

/** A figure's page size, in inches (papers are in inches). */
export interface FigureSize {
  widthIn: number;
  heightIn: number;
}

/** Where a panel's label sits, and how it looks at export scale. */
export type LabelPosition = "top-left" | "top-right" | "above-panel";
export interface FigureLabelStyle {
  position: LabelPosition;
  fontSizePt: number;
  bold: boolean;
}

/** Whether the figure draws one legend for all its panels, below the grid. */
export type SharedLegend = "none" | "shared";

/** An export resolution, in dots per inch (same choices as a single graph). */
export type Resolution = "150" | "300" | "600" | "900" | "1200";
