// The shared graph-figure builder (seq 173): one place that turns a graph
// node into the Plotly figure its on-screen view draws — base chart AND the
// overlays from its sibling analyses — so the GUI graph view, the figure
// panels, the MCP headless export and the script export all draw the same
// figure.
//
// Before this, the headless paths built only the base chart through
// `buildPanelFigure` (see `src/views/figures/panel-figure.ts`): the overlays
// lived only in `graph-view.tsx`, behind React hooks (`useAnalysis`), so a
// headless export of a graph with linked analyses silently dropped its
// significance brackets, fitted curves, forest / scree / PCA / K-means
// overlays and the rest. `buildGraphFigure` below is the same overlay
// pipeline as the graph view's draw effect, in the same order, calling the
// same `add*` helpers — with the hooks replaced by awaited `runAnalysis`
// calls (the same cache `useAnalysis` reads, so a run the view already did
// is not repeated).
//
// How an overlay's result is found, in order:
//   1. A frozen or orphaned analysis shows its `cachedResult` and never
//      re-runs (a frozen sheet stops auto-updating; an orphaned one has no
//      source table left to run on) — the same result its analysis view shows.
//   2. Otherwise the analysis runs live (info-constant hooks resolved first,
//      exactly as `useAnalysis` does), through the injected `run` (default:
//      the real `runAnalysis`).
//   3. A run that errors draws nothing — the GUI draws nothing while an
//      overlay's run errors either, so a stale result is never drawn in its
//      place. The failure is reported in the returned overlay status, not
//      hidden.
//
// The returned `overlays` list says, per overlay, whether it drew
// ("applied"), had nothing to draw ("missing", with why), was never linked
// ("not-linked") or its run failed ("error"). The export tools report that
// list so a caller can tell an overlay-less export from an overlay graph
// whose analysis simply hasn't run yet.
//
// Anything that changes the graph view's overlay pipeline must change this
// file in the same breath, and vice versa — the two are the same pipeline,
// and a check in `tests/checks.ts` (seq 173) pins the headless side of it.

import {
  DEFAULT_GRAPH_OPTIONS,
  type GraphOptions,
  type GraphType,
  type ProjectNode,
  type TableData,
} from "../../store/types";
import { groupsOf, readTable, splitXY, type Column } from "../../lib/dataset";
import { computeGroupedDEG } from "../../lib/deg";
import {
  infoSheetsOf,
  resolveAnalysisParams,
  resolveGraphOptions,
} from "../../lib/info-sheets";
import { runAnalysis } from "../../stats";
import { isPluginAnalysisResult } from "../analyses";
import type {
  AnalysisOutcome,
  AnalysisParams,
  AnalysisResult,
  AnalysisType,
  BindingKineticsParams,
  BindingSaturationParams,
  CoxPHParams,
  DemingRegressionParams,
  DoseResponseSpecialParams,
  EnzymeInhibitionParams,
  LinearRegressionParams,
  NonlinearRegressionParams,
  PoissonRegressionParams,
  SimpleLogisticRegressionParams,
} from "../../stats/types";
import {
  choosableSets,
  GRAPHS,
  graphSeries,
  hasValueAxis,
  plotColumns,
  type GraphFigure,
} from ".";
import { addFittedCurve, addLogisticCurve as addAnalysisLogisticCurve } from "./fitted-curve";
import {
  addBindingCurve,
  addDoseResponseSpecialCurve,
  addEnzymeInhibitionCurve,
} from "./binding-curve";
import { addGeneratedCurves } from "./generated-curves";
import { addSchildPlot } from "./schild-plot";
import { addSmoothCurve } from "./smooth-curve";
import { addLogisticCurve, logisticCurveNote } from "./logistic-curve";
import { addForestPlot } from "./forest-plot";
import { addEstimationPlot } from "./estimation-plot";
import { addObservedFitted } from "./observed-fitted";
import { addCovarianceHeatmap } from "./covariance-heatmap";
import { addScreePlot } from "./scree-plot";
import { addMonteCarloHistogram } from "./monte-carlo-histogram";
import { addPcaBiplot } from "./pca-biplot";
import { addKmeansScatter } from "./kmeans-scatter";
import { addDendrogram } from "./dendrogram";
import { addElbowPlot, addGapPlot, addSilhouettePlot } from "./choosing-k";
import { addRegression } from "./regression-overlay";
import { addDeming } from "./deming-overlay";
import {
  addSignificance,
  deriveComparisons,
  GROUPED_STARS,
  starsFit,
} from "./significance-overlay";
import { coxSurvivalColumns } from "./survival";
import { volcanoPair } from "./volcano";
import { labelPlotGeometry, pointLabels } from "./selection";
import { formatFigureLabels } from "../../lib/label-format";
import {
  addNote,
  onAxis,
  paintOf,
  refLineParts,
  unlinkedAnalysisNote,
  withCaps,
  type Paint,
} from "./plot-helpers";

/** Run an analysis: `runAnalysis` by default; a test harness injects a
 *  stub returning fixture outcomes, so the builder needs no R engine. */
export type AnalysisRunner = (
  type: AnalysisType,
  data: TableData,
  params?: AnalysisParams,
) => Promise<AnalysisOutcome>;

/** One overlay's fate in a built figure. */
export interface GraphOverlayStatus {
  overlay: string;
  status: "applied" | "missing" | "not-linked" | "error";
  /** Why it didn't draw (missing / error), in plain words. */
  detail?: string;
}

/** What `buildGraphFigure` returns: the figure (null when the graph has
 *  nothing to draw), and every overlay's fate. */
export interface BuiltGraphFigure {
  figure: GraphFigure | null;
  overlays: GraphOverlayStatus[];
}

/** Options for the shared builders. `rootOrder` orders the info sheets
 *  (the project root order when the caller has it; the node ids otherwise,
 *  as the panel builder always did). */
export interface BuildGraphFigureOptions {
  hideLegend?: boolean;
  rootOrder?: string[];
  run?: AnalysisRunner;
}

export interface BuildBaseFigureOptions {
  hideLegend?: boolean;
  /** The columns to build from, instead of the table's plotted columns: the
   *  Cox survival columns for a survival curve on a Multiple Variables
   *  table (see `buildGraphFigure`). */
  columns?: Column[];
  /** The paint, instead of one sized by the graph's series: the K-means
   *  paint is sized by the linked result's cluster count. */
  paint?: Paint;
}

/** The inputs a figure is built from, resolved once and shared by the base
 *  and the full builder so the two can never disagree about the columns,
 *  the options or the series. Null when the graph has no table to draw. */
interface FigureInputs {
  parent: ProjectNode;
  dataset: ReturnType<typeof readTable>;
  columns: Column[];
  /** The columns the graph's build actually receives: the Cox survival
   *  columns, else a grouped volcano's DEG columns, else `columns`. */
  buildColumns: Column[];
  options: GraphOptions;
  buildOptions: GraphOptions;
  choosable: string[];
  shownSets: string[] | undefined;
  allSeries: string[];
  seriesNames: string[];
  plotFunctionAnalysis: ProjectNode | undefined;
}

function figureInputs(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  columnsOverride?: Column[],
): FigureInputs | null {
  if (graph.type !== "graph" || !graph.graphType || !Object.hasOwn(GRAPHS, graph.graphType)) return null;
  const parent = graph.parentId ? nodes[graph.parentId] : undefined;
  if (!parent?.data || !parent.tableType) return null;
  // A frozen graph (seq 237) draws its snapshot, not the live table —
  // the same snapshot its own view draws.
  const data = graph.frozen && graph.frozenData ? graph.frozenData : parent.data;
  const type = graph.graphType as GraphType;
  const family = GRAPHS[type].family;
  const sheets = infoSheetsOf(nodes, rootOrder);
  const options = { ...DEFAULT_GRAPH_OPTIONS, ...graph.graphOptions };
  const dataset = readTable(data);
  const columns = plotColumns(dataset, type, options, parent.tableType);
  const choosable = choosableSets(type, dataset, parent.tableType);
  const shownSets = choosable.length ? options.sets : undefined;
  const allSeries = graphSeries(type, data, parent.tableType, options);
  const seriesNames = shownSets ? allSeries.filter((n) => shownSets.includes(n)) : allSeries;
  // A grouped volcano plots the DEGs Titer computes (per-row Welch t test +
  // BH FDR), not the table's own columns — the same columns the graph view
  // builds from. An XY table's volcano plots its X column.
  const volcanoGroups =
    family === "volcano" && parent.tableType === "grouped" && dataset.summary === "replicates"
      ? groupsOf(dataset.numeric).map((g) => g.name)
      : undefined;
  let volcanoColumns = columns;
  let buildOptions = options;
  if (volcanoGroups) {
    const [a, b] = volcanoPair(volcanoGroups, options);
    const deg = a && b && a !== b ? computeGroupedDEG(data, a, b, options.volcanoEffect) : [];
    const rows: (string | null)[][] = data.rows.map(() => []);
    for (const d of deg) rows[d.row] = [null, d.label, String(d.log2FC), String(d.p), String(d.padj)];
    volcanoColumns = readTable({ columns: ["Title", "Gene", "Log2 FC", "P", "FDR"], rows }).columns;
    buildOptions = {
      ...options,
      volcanoLabel: "Gene",
      volcanoX: "Log2 FC",
      volcanoY: options.volcanoSignificance === "fdr" ? "FDR" : "P",
      volcanoYIsPValue: true,
    };
  } else if (family === "volcano" && parent.tableType === "xy") {
    buildOptions = { ...options, volcanoX: dataset.columns[0]?.name };
  }
  buildOptions = resolveGraphOptions(buildOptions, sheets);
  const plotFunctionAnalysis =
    type === "xy-scatter"
      ? Object.values(nodes).find(
          (n) => n.type === "analysis" && n.parentId === graph.parentId && n.analysisType === "plot-function",
        )
      : undefined;
  return {
    parent,
    dataset,
    columns,
    buildColumns: columnsOverride ?? volcanoColumns,
    options,
    buildOptions,
    choosable,
    shownSets,
    allSeries,
    seriesNames,
    plotFunctionAnalysis,
  };
}

/** The graph's base chart — its data, colours, styles and titles, exactly
 *  as its view builds them — with the error-bar caps the view adds, and
 *  (for a grouped volcano) the computed DEG columns. No analysis overlays:
 *  those need a run, so they live in `buildGraphFigure`. Null when the
 *  graph has nothing to draw: no numeric columns, or an unknown graph type
 *  — except an XY scatter with a sibling "Plot a function" analysis, which
 *  draws its generated curves on empty axes, as the view does. */
export function buildBaseFigure(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  opts: BuildBaseFigureOptions & { rootOrder?: string[] } = {},
): GraphFigure | null {
  const inputs = figureInputs(graph, nodes, opts.rootOrder ?? Object.keys(nodes), opts.columns);
  if (!inputs) return null;
  const { dataset, columns, buildColumns, buildOptions, allSeries, plotFunctionAnalysis } = inputs;
  if (!columns.some((c) => c.values.length > 0) && !plotFunctionAnalysis) return null;
  const paint = opts.paint ?? paintOf(buildOptions, allSeries.length);
  const fig = GRAPHS[graph.graphType as GraphType].build(
    buildColumns,
    buildOptions,
    paint,
    dataset.titles,
    dataset.summary,
  );
  fig.data = withCaps(fig.data, buildOptions);
  // Labels render with super/subscripts (seq 548): the base chart is
  // formatted here, and the full figure again after its overlays (the
  // overlay annotations are built from raw titles) — formatting is
  // idempotent, so the second pass is a no-op for the base chart.
  const formatted = formatFigureLabels(fig);
  return opts.hideLegend ? { ...formatted, layout: { ...formatted.layout, showlegend: false } } : formatted;
}

/** One analysis's outcome as the builder sees it: the live run, the frozen
 *  / orphaned node's stored result, or nothing (no node, or the wrong test).
 *  `error` carries a failed run's message, so the caller can report it
 *  instead of silently drawing nothing. */
interface ResolvedOutcome {
  outcome: AnalysisOutcome | null;
  source: "live" | "cached" | "none";
  error?: string;
}

const noOutcome: ResolvedOutcome = { outcome: null, source: "none" };

/** The result of a resolved outcome, or null when it errored / never ran. */
const resultOf = (resolved: ResolvedOutcome): AnalysisResult | null =>
  resolved.outcome && !("error" in resolved.outcome) ? resolved.outcome : null;

/**
 * Resolve one linked analysis to its outcome. A frozen or orphaned analysis
 * shows its stored result and never re-runs; otherwise the analysis runs
 * live (info-constant hooks resolved first, as `useAnalysis` does), through
 * `run`. A run that errors resolves to that error — the caller draws
 * nothing from it, and reports the error in the overlay status.
 */
async function resolveOutcome(
  node: ProjectNode | undefined,
  expectedType: AnalysisType | undefined,
  data: TableData,
  sheets: ProjectNode[],
  run: AnalysisRunner,
): Promise<ResolvedOutcome> {
  if (!node || node.type !== "analysis") return noOutcome;
  if (expectedType !== undefined && node.analysisType !== expectedType)
    return {
      outcome: null,
      source: "none",
      error: `“${node.name}” is a ${node.analysisType}, not a ${expectedType}.`,
    };
  if (!node.analysisType) return noOutcome;
  // A frozen or orphaned plugin analysis keeps its stored result on the
  // node, but the overlays only draw first-party outcomes — a plugin
  // result is not one, so it resolves to no outcome here (the sheet
  // itself still shows it).
  if ((node.frozen || node.orphaned) && node.cachedResult && !isPluginAnalysisResult(node.cachedResult))
    return { outcome: node.cachedResult, source: "cached" };
  const resolved = resolveAnalysisParams(node.analysisParams, node.analysisType, sheets);
  if ("error" in resolved) return { outcome: { error: resolved.error }, source: "live", error: resolved.error };
  const outcome = await run(node.analysisType, data, resolved.params);
  if ("error" in outcome) return { outcome, source: "live", error: outcome.error };
  return { outcome, source: "live" };
}

/** Run a test with no node behind it (the logistic curve's own fit), with
 *  the same shape as `resolveOutcome`. */
async function runOutcome(
  type: AnalysisType,
  data: TableData,
  params: AnalysisParams,
  run: AnalysisRunner,
): Promise<ResolvedOutcome> {
  const outcome = await run(type, data, params);
  if ("error" in outcome) return { outcome, source: "live", error: outcome.error };
  return { outcome, source: "live" };
}

/**
 * The graph's full figure: the base chart plus every overlay the graph
 * view draws, from the same sibling analyses and in the same order. The
 * figure is null when the graph has nothing to draw (same rule as
 * `buildBaseFigure`); the overlay list then stays empty.
 */
export async function buildGraphFigure(
  graph: ProjectNode,
  nodes: Record<string, ProjectNode>,
  opts: BuildGraphFigureOptions = {},
): Promise<BuiltGraphFigure> {
  const rootOrder = opts.rootOrder ?? Object.keys(nodes);
  const run = opts.run ?? runAnalysis;
  const sheets = infoSheetsOf(nodes, rootOrder);
  const inputs = figureInputs(graph, nodes, rootOrder);
  if (!inputs) return { figure: null, overlays: [] };
  const { parent, dataset, columns, buildOptions, options, choosable, shownSets, allSeries, seriesNames } = inputs;
  // A frozen graph's overlays run on its snapshot, like its base chart.
  const data = graph.frozen && graph.frozenData ? graph.frozenData : parent.data!;
  const type = graph.graphType as GraphType;
  const family = GRAPHS[type].family;
  const analyses = Object.values(nodes).filter((n) => n.type === "analysis" && n.parentId === graph.parentId);
  const sibling = (analysisType: AnalysisType) => analyses.find((n) => n.analysisType === analysisType);
  const linked = (field: keyof GraphOptions) => {
    const id = options[field] as string | undefined;
    return id ? nodes[id] : undefined;
  };

  // ── Resolve the overlays' runs first (in parallel — `runAnalysis`
  // shares one result per table version, so runs the view already did are
  // not repeated), gated exactly as the graph view gates its hooks. ──
  const sigAnalysis = options.sigAnalysisId ? nodes[options.sigAnalysisId] : undefined;
  const stars = family === "column" || GROUPED_STARS.has(type);
  const regNode = options.regAnalysisId ? nodes[options.regAnalysisId] : undefined;
  const regParams = regNode?.analysisParams as LinearRegressionParams | undefined;
  const curveParams =
    regNode?.analysisType === "nonlinear-regression"
      ? (regNode.analysisParams as NonlinearRegressionParams)
      : undefined;
  const logistic = regNode?.analysisType === "simple-logistic-regression";
  const demingParams = (options.demingAnalysisId ? nodes[options.demingAnalysisId]?.analysisParams : undefined) as
    | DemingRegressionParams
    | undefined;
  const coxAnalysis = options.coxAnalysisId ? nodes[options.coxAnalysisId] : undefined;
  const coxParams = (coxAnalysis?.analysisParams ?? undefined) as CoxPHParams | undefined;
  const poissonAnalysis = options.poissonAnalysisId ? nodes[options.poissonAnalysisId] : undefined;
  const poissonParams = (poissonAnalysis?.analysisParams ?? undefined) as PoissonRegressionParams | undefined;
  const mlrAnalysis = options.mlrAnalysisId ? nodes[options.mlrAnalysisId] : undefined;
  const logisticY = columns[1]?.name;

  const needSig = stars && sigAnalysis !== undefined;
  const needCurve = type === "xy-scatter" && (curveParams !== undefined || logistic);
  const needCox = type === "forest-plot" || (type === "survival" && parent.tableType === "multiple");
  const needPca = type === "scree-plot" || type === "pca-biplot";
  const needKmeans = type === "kmeans-scatter";
  const needHclust =
    type === "dendrogram" || type === "elbow-plot" || type === "silhouette-plot" || type === "gap-plot";
  const needLogisticOwn = type === "logistic-curve" && logisticY !== undefined;

  const [
    sigResolved,
    curveResolved,
    bindingResolved,
    inhibitionResolved,
    specialResolved,
    plotFunctionResolved,
    coxResolved,
    ttestResolved,
    poissonResolved,
    mlrResolved,
    pcaResolved,
    kmeansResolved,
    hclustResolved,
    smoothResolved,
    mcResolved,
    logisticOwnResolved,
  ] = await Promise.all([
    needSig ? resolveOutcome(sigAnalysis, undefined, data, sheets, run) : Promise.resolve(noOutcome),
    needCurve ? resolveOutcome(regNode, regNode!.analysisType, data, sheets, run) : Promise.resolve(noOutcome),
    type === "xy-scatter"
      ? resolveOutcome(sibling("binding-saturation") ?? sibling("binding-kinetics"), undefined, data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "xy-scatter"
      ? resolveOutcome(sibling("enzyme-inhibition"), undefined, data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "xy-scatter" || type === "schild-plot"
      ? resolveOutcome(sibling("dose-response-special"), undefined, data, sheets, run)
      : Promise.resolve(noOutcome),
    inputs.plotFunctionAnalysis
      ? resolveOutcome(inputs.plotFunctionAnalysis, "plot-function", data, sheets, run)
      : Promise.resolve(noOutcome),
    needCox ? resolveOutcome(coxAnalysis, "cox-proportional-hazards", data, sheets, run) : Promise.resolve(noOutcome),
    type === "estimation-plot"
      ? resolveOutcome(linked("ttestAnalysisId"), "compare-two-groups", data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "observed-fitted"
      ? resolveOutcome(poissonAnalysis, "poisson-regression", data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "covariance-heatmap"
      ? resolveOutcome(mlrAnalysis, "multiple-regression", data, sheets, run)
      : Promise.resolve(noOutcome),
    needPca
      ? resolveOutcome(linked("pcaAnalysisId"), "principal-component-analysis", data, sheets, run)
      : Promise.resolve(noOutcome),
    needKmeans ? resolveOutcome(linked("kmeansAnalysisId"), "k-means", data, sheets, run) : Promise.resolve(noOutcome),
    needHclust
      ? resolveOutcome(linked("hclustAnalysisId"), "hierarchical-clustering", data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "smooth-curve"
      ? resolveOutcome(linked("smoothAnalysisId"), "spline-lowess", data, sheets, run)
      : Promise.resolve(noOutcome),
    type === "monte-carlo-histogram"
      ? resolveOutcome(linked("monteCarloAnalysisId"), "monte-carlo", data, sheets, run)
      : Promise.resolve(noOutcome),
    needLogisticOwn
      ? runOutcome("simple-logistic-regression", data, { y: logisticY } as AnalysisParams, run)
      : Promise.resolve(noOutcome),
  ]);

  const sigOutcome = sigResolved.outcome;
  const sigFits = needSig && sigAnalysis !== undefined && starsFit(sigAnalysis, choosable, shownSets ?? choosable);
  const comparisons = sigFits ? deriveComparisons(sigOutcome) : [];
  const curveFit = resultOf(curveResolved);
  const bindingFit = resultOf(bindingResolved);
  const bindingParams = (sibling("binding-saturation") ?? sibling("binding-kinetics"))?.analysisParams as
    | BindingSaturationParams
    | BindingKineticsParams
    | undefined;
  const inhibitionFit = resultOf(inhibitionResolved);
  const inhibitionParams = sibling("enzyme-inhibition")?.analysisParams as EnzymeInhibitionParams | undefined;
  const specialFit = resultOf(specialResolved);
  const specialParams = sibling("dose-response-special")?.analysisParams as DoseResponseSpecialParams | undefined;
  const plotFunctionResult = resultOf(plotFunctionResolved);
  const coxResult = resultOf(coxResolved);
  const ttestResult = resultOf(ttestResolved);
  const poissonResult = resultOf(poissonResolved);
  const mlrResult = resultOf(mlrResolved);
  const pcaResult = resultOf(pcaResolved);
  const kmeansResult = resultOf(kmeansResolved);
  const hclustResult = resultOf(hclustResolved);
  const smoothResult = resultOf(smoothResolved);
  const mcResult = resultOf(mcResolved);
  const logisticFit = resultOf(logisticOwnResolved);

  // A survival curve on a Multiple Variables table plots the Cox analysis's
  // time/status columns, stratified by its binary covariate — the columns
  // the build receives, as in the graph view.
  const coxSurvivalCols =
    type === "survival" && parent.tableType === "multiple"
      ? coxResult && coxParams
        ? (coxSurvivalColumns(data, coxParams) ?? undefined)
        : undefined
      : undefined;

  // The cluster scatter's series are its clusters, so the paint is sized by
  // the linked result's cluster count — otherwise a gradient palette would
  // colour every cluster the same (as in the graph view).
  const paint = paintOf(
    buildOptions,
    type === "kmeans-scatter" && kmeansResult?.kmeansClusters
      ? kmeansResult.kmeansClusters.length
      : allSeries.length,
    allSeries,
  );
  const fig = buildBaseFigure(graph, nodes, {
    rootOrder,
    columns: coxSurvivalCols,
    paint,
    hideLegend: opts.hideLegend,
  });
  if (!fig) return { figure: null, overlays: [] };

  // ── Overlays, in the graph view's order ──────────────────────────
  const overlays: GraphOverlayStatus[] = [];
  const snap = () => ({
    data: fig.data.length,
    annotations: (fig.layout.annotations as unknown[] | undefined)?.length ?? 0,
    shapes: (fig.layout.shapes as unknown[] | undefined)?.length ?? 0,
  });
  const drew = (before: ReturnType<typeof snap>) =>
    fig.data.length !== before.data ||
    ((fig.layout.annotations as unknown[] | undefined)?.length ?? 0) !== before.annotations ||
    ((fig.layout.shapes as unknown[] | undefined)?.length ?? 0) !== before.shapes;
  const record = (overlay: string, status: GraphOverlayStatus["status"], detail?: string) =>
    overlays.push(detail === undefined ? { overlay, status } : { overlay, status, detail });
  /** Apply one overlay and record whether it drew anything. */
  const apply = (overlay: string, fn: () => void, nothingDetail: string) => {
    const before = snap();
    fn();
    record(overlay, drew(before) ? "applied" : "missing", drew(before) ? undefined : nothingDetail);
  };
  /** A graph whose chart IS its overlay, with no usable result: the
   *  on-canvas prompt, and a "missing" status naming the analysis to run. */
  const unlinked = (overlay: string) => {
    const note = unlinkedAnalysisNote(type);
    if (note) addNote(fig, note, buildOptions);
    record(overlay, "missing", note ?? "Run the linked analysis first.");
  };

  if (stars && options.sigAnalysisId) {
    if (!sigFits) {
      record(
        "significance",
        "missing",
        "The linked analysis ran on different data sets than this graph shows, so its brackets don't apply here.",
      );
    } else if (sigResolved.error) {
      record("significance", "error", sigResolved.error);
    } else {
      apply(
        "significance",
        () => addSignificance(fig, columns, type, buildOptions, comparisons, dataset.titles),
        "The linked analysis has no pairwise comparisons to draw.",
      );
    }
  }
  if (type === "xy-scatter" && curveParams) {
    if (curveResolved.error) record("fitted-curve", "error", curveResolved.error);
    else {
      const { x, ys } = splitXY(columns);
      const fitted = curveParams.ys ?? [curveParams.y ?? ys[0]?.name ?? ""];
      const y0 = ys.find((s) => s.name === (curveParams.y ?? fitted[0])) ?? ys[0];
      apply(
        "fitted-curve",
        () => {
          if (curveFit && x && y0 && options.regShowLine)
            addFittedCurve(fig, x, y0, ys, curveParams.model, curveFit, options.regShowEquation, buildOptions, paint);
        },
        "The fitted curve has no coefficients to draw, or its line is turned off.",
      );
    }
  } else if (type === "xy-scatter" && logistic) {
    if (curveResolved.error) record("logistic-curve", "error", curveResolved.error);
    else {
      const { x, ys } = splitXY(columns);
      const y =
        ys.find((s) => s.name === (regNode!.analysisParams as SimpleLogisticRegressionParams)?.y) ?? ys[0];
      apply(
        "logistic-curve",
        () => {
          if (curveFit && x && y && options.regShowLine)
            addAnalysisLogisticCurve(fig, x, y, ys, curveFit, options.regShowEquation, buildOptions, paint);
        },
        "The logistic curve has no coefficients to draw, or its line is turned off.",
      );
    }
  } else if (type === "xy-scatter" && regNode) {
    apply("regression", () => addRegression(fig, columns, buildOptions, regParams, paint), "The regression has no points to fit.");
  }
  if (type === "xy-scatter" && options.demingAnalysisId) {
    apply("deming", () => addDeming(fig, columns, buildOptions, demingParams, paint), "The Deming fit has no points to fit.");
  }
  if (bindingFit && bindingParams) {
    apply("binding", () => addBindingCurve(fig, columns, buildOptions, bindingFit, bindingParams, paint), "The binding fit has no coefficients to draw.");
  } else if (type === "xy-scatter" && (sibling("binding-saturation") ?? sibling("binding-kinetics"))) {
    if (bindingResolved.error) record("binding", "error", bindingResolved.error);
    else record("binding", "not-linked", "The binding analysis has no result yet.");
  }
  if (inhibitionFit && inhibitionParams) {
    apply(
      "enzyme-inhibition",
      () => addEnzymeInhibitionCurve(fig, columns, buildOptions, inhibitionFit, inhibitionParams, paint),
      "The enzyme-inhibition fit has no coefficients to draw.",
    );
  } else if (type === "xy-scatter" && sibling("enzyme-inhibition")) {
    if (inhibitionResolved.error) record("enzyme-inhibition", "error", inhibitionResolved.error);
    else record("enzyme-inhibition", "not-linked", "The enzyme-inhibition analysis has no result yet.");
  }
  if (specialFit && specialParams && type === "xy-scatter") {
    apply(
      "dose-response-special",
      () => addDoseResponseSpecialCurve(fig, columns, buildOptions, specialFit, specialParams, paint),
      "The dose-response fit has no coefficients to draw.",
    );
  } else if (type === "xy-scatter" && sibling("dose-response-special")) {
    if (specialResolved.error) record("dose-response-special", "error", specialResolved.error);
    else record("dose-response-special", "not-linked", "The dose-response analysis has no result yet.");
  }
  if (type === "xy-scatter" && plotFunctionResult?.generatedCurves) {
    apply(
      "generated-curves",
      () => addGeneratedCurves(fig, plotFunctionResult, paint, seriesNames.length),
      "The plot-a-function analysis generated no curves.",
    );
  } else if (type === "xy-scatter" && inputs.plotFunctionAnalysis) {
    if (plotFunctionResolved.error) {
      addNote(fig, plotFunctionResolved.error, buildOptions);
      record("generated-curves", "error", plotFunctionResolved.error);
    } else {
      record("generated-curves", "not-linked", "The plot-a-function analysis has no result yet.");
    }
  }
  if (type === "schild-plot") {
    if (specialFit && specialParams && (specialParams.model === "schild" || specialParams.model === "schild-slope-1")) {
      apply("schild", () => addSchildPlot(fig, specialFit, specialParams, paint, buildOptions), "The Schild fit has no points to draw.");
    } else if (specialResolved.error) {
      record("schild", "error", specialResolved.error);
    } else {
      unlinked("schild");
    }
  }
  if (type === "smooth-curve") {
    if (smoothResult) {
      apply("smooth-curve", () => addSmoothCurve(fig, columns, buildOptions, smoothResult, paint), "The smoother has no curve to draw, or its curve is turned off.");
    } else if (smoothResolved.error) {
      record("smooth-curve", "error", smoothResolved.error);
    } else {
      unlinked("smooth-curve");
    }
  }
  if (type === "logistic-curve") {
    if (logisticFit) {
      apply("logistic-curve", () => addLogisticCurve(fig, columns, logisticFit, paint), "The logistic fit has no coefficients to draw.");
    } else {
      const note = logisticCurveNote(logisticOwnResolved.outcome);
      if (note) addNote(fig, note, buildOptions);
      record(
        "logistic-curve",
        logisticOwnResolved.error ? "error" : "missing",
        note ?? "The logistic fit has no result yet.",
      );
    }
  }
  if (type === "forest-plot") {
    if (coxResult) {
      apply("forest", () => addForestPlot(fig, coxResult, paint, buildOptions), "The Cox result has no hazard ratios to draw.");
    } else if (coxResolved.error) {
      record("forest", "error", coxResolved.error);
    } else {
      unlinked("forest");
    }
  }
  if (type === "estimation-plot") {
    if (ttestResult) {
      apply("estimation", () => addEstimationPlot(fig, columns, ttestResult, paint, buildOptions), "The t test has no difference to draw.");
    } else if (ttestResolved.error) {
      record("estimation", "error", ttestResolved.error);
    } else {
      unlinked("estimation");
    }
  }
  if (type === "observed-fitted") {
    if (poissonResult) {
      apply(
        "observed-fitted",
        () => addObservedFitted(fig, columns, poissonResult, poissonParams, paint, buildOptions),
        "The Poisson fit has no fitted counts to draw.",
      );
    } else if (poissonResolved.error) {
      record("observed-fitted", "error", poissonResolved.error);
    } else {
      unlinked("observed-fitted");
    }
  }
  if (type === "covariance-heatmap") {
    if (mlrResult) {
      apply(
        "covariance-heatmap",
        () => addCovarianceHeatmap(fig, mlrResult, buildOptions),
        "The Multiple regression has no covariance matrix to draw.",
      );
    } else if (mlrResolved.error) {
      record("covariance-heatmap", "error", mlrResolved.error);
    } else {
      unlinked("covariance-heatmap");
    }
  }
  if (type === "scree-plot") {
    if (pcaResult) {
      apply("scree", () => addScreePlot(fig, pcaResult, paint, buildOptions), "The PCA result has no variance to draw.");
    } else if (pcaResolved.error) {
      record("scree", "error", pcaResolved.error);
    } else {
      unlinked("scree");
    }
  }
  if (type === "monte-carlo-histogram") {
    if (mcResult) {
      apply("monte-carlo", () => addMonteCarloHistogram(fig, mcResult, paint), "The Monte Carlo result has no distribution to draw.");
    } else if (mcResolved.error) {
      record("monte-carlo", "error", mcResolved.error);
    } else {
      unlinked("monte-carlo");
    }
  }
  if (type === "pca-biplot") {
    if (pcaResult) {
      apply("pca-biplot", () => addPcaBiplot(fig, pcaResult, buildOptions, paint), "The PCA result has no scores to draw.");
    } else if (pcaResolved.error) {
      record("pca-biplot", "error", pcaResolved.error);
    } else {
      unlinked("pca-biplot");
    }
  }
  if (type === "kmeans-scatter") {
    if (kmeansResult) {
      apply(
        "kmeans",
        () => addKmeansScatter(fig, columns, kmeansResult, buildOptions, paint, dataset.titles),
        "The K-means result has no assignments to draw.",
      );
    } else if (kmeansResolved.error) {
      record("kmeans", "error", kmeansResolved.error);
    } else {
      unlinked("kmeans");
    }
  }
  if (type === "dendrogram") {
    if (hclustResult) {
      apply("dendrogram", () => addDendrogram(fig, hclustResult, paint, buildOptions), "The clustering result has no tree to draw.");
    } else if (hclustResolved.error) {
      record("dendrogram", "error", hclustResolved.error);
    } else {
      unlinked("dendrogram");
    }
  }
  if (type === "elbow-plot") {
    if (hclustResult) {
      apply("elbow", () => addElbowPlot(fig, hclustResult, paint), "The clustering result has no choosing-k diagnostics to draw.");
    } else if (hclustResolved.error) {
      record("elbow", "error", hclustResolved.error);
    } else {
      unlinked("elbow");
    }
  }
  if (type === "silhouette-plot") {
    if (hclustResult) {
      apply("silhouette", () => addSilhouettePlot(fig, hclustResult, paint, buildOptions), "The clustering result has no choosing-k diagnostics to draw.");
    } else if (hclustResolved.error) {
      record("silhouette", "error", hclustResolved.error);
    } else {
      unlinked("silhouette");
    }
  }
  if (type === "gap-plot") {
    if (hclustResult) {
      apply("gap", () => addGapPlot(fig, hclustResult, paint), "The clustering result has no choosing-k diagnostics to draw.");
    } else if (hclustResolved.error) {
      record("gap", "error", hclustResolved.error);
    } else {
      unlinked("gap");
    }
  }

  // The points' names are part of the figure (the volcano places its own,
  // among the genes it names); the selection ring only of the view. Labels
  // clamp to the plot edge (G-F4): the geometry comes from the figure's own
  // ranges and size — as in the graph view.
  const labels =
    family === "volcano"
      ? []
      : pointLabels(
          fig.data,
          options.points,
          dataset.rowLabels ?? dataset.titles,
          options.fontSize,
          labelPlotGeometry(fig.data, fig.layout, options),
        ).map((label) => ({
          ...label,
          x: family === "xy" ? onAxis(label.x, options.xScale) : label.x,
          y: onAxis(label.y, options.yScale),
        }));
  if (labels.length) fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...labels];
  if (hasValueAxis(family) && options.refLines?.length) {
    const { shapes, annotations } = refLineParts(buildOptions, type === "grouped-hbars");
    fig.layout.shapes = [...((fig.layout.shapes as unknown[]) ?? []), ...shapes];
    fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...annotations];
  }
  return { figure: formatFigureLabels(fig), overlays };
}
