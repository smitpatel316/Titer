// The Titer project file (.hlx): plain JSON, described in FILE-FORMAT.md, so a
// project is never locked into Titer.
//
// A file must keep opening across versions, in both directions:
//   1. Fields are only ever added, never renamed or removed.
//   2. Reading forgives: names match whatever their case, a value of the wrong
//      type falls back to its default, a broken item is skipped on its own, and
//      fields this version doesn't know are kept, so saving doesn't lose them.
// `schemaVersion` is informative; nothing branches on it.

import {
  DEFAULT_GRAPH_OPTIONS,
  FILL_PATTERNS,
  GRAPH_CHOICES,
  GRAPH_LIMITS,
  MAX_REF_LINES,
  REF_LABEL_PLACES,
  clamp,
  type FigurePanel,
  FLOATING_NOTE_COLORS,
  type FloatingNote,
  type FloatingNoteColor,
  type Limits,
  type GraphOptions,
  type GraphPalette,
  type InfoSheetData,
  type NodeType,
  PALETTE_KINDS,
  type PaletteColor,
  type PaletteKind,
  type Place,
  type PointStyle,
  type ProjectNode,
  type RefLine,
  type RowGroup,
  SAME_AS_FILL,
  type SeriesStyle,
  SHEET_HIGHLIGHTS,
  type SheetHighlight,
  type TableData,
  TAG_COLORS,
  type TagColor,
  type Transform,
  TRANSFORMS,
  Z_WITHIN,
} from "../store/types";
import {
  type AnalysisParams,
  type AnalysisResult,
  ANOVA_POSTHOCS,
  BINDING_KINETICS_MODELS,
  BINDING_SATURATION_MODELS,
  BIN_MODES,
  CONCENTRATION_UNITS,
  CONTINGENCY_TESTS,
  CORRECTIONS,
  CURVE_COMPARISONS,
  CORRELATION_METHODS,
  CORRELATION_MODES,
  CURVE_TESTS,
  DOSE_MODELS,
  DOSE_RESPONSE_SPECIAL_MODELS,
  EC_ANYTHING,
  ENZYME_INHIBITION_MODELS,
  EXTRACT_REARRANGE_TARGETS,
  FDR_METHODS,
  FDR_Q,
  FRACTION_OF_TOTAL_FORMATS,
  FRACTION_OF_TOTAL_TOTALS,
  MONTE_CARLO_STATISTICS,
  MONTE_CARLO_TARGETS,
  NONLINEAR_MODELS,
  NORMALIZE_HUNDRED_DEFS,
  NORMALIZE_METHODS,
  NORMALIZE_ZERO_DEFS,
  POSTHOC_TARGETS,
  PRUNE_ROWS_CONDITIONS,
  RANK_POSTHOCS,
  REMOVE_BASELINE_METHODS,
  ROUT_Q,
  ROW_MEANS_SCOPES,
  SMOOTH_DIFF_INT_OPERATIONS,
  TAILS,
  THREE_WAY_POSTHOC_SCOPES,
  THREE_WAY_TERMS,
  TRANSFORM_FUNCTIONS,
  TWO_WAY_DESIGNS,
} from "../stats/types";
import { NAMED_COLORS, paletteNamed, savedPalette } from "./palettes";
import { parseTemplateInfo, type TemplateInfo } from "./template";
import { readInfoConstants } from "./info-sheets";
import { TABLES } from "../views/tables";
import { GRAPHS, GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";
import { ANALYSES } from "../stats";
import { isGrouped, isNested } from "./dataset";
import { isSummaryFormatValue, summarySubcolumns } from "./summary-format";
import { groupRuns } from "./columns";
import { regroupDropped, regroupTable, renestDropped, renestTable } from "../views/tables/table-data";
import { readCalculated, recomputeCalculated } from "./calcvars";
import { transformTable } from "./transform";
import {
  assignLabels,
  clampPanel,
  DEFAULT_FIGURE_SIZE,
  DEFAULT_LABEL_STYLE,
  figureDpi,
  FIGURE_SIZE_LIMITS,
} from "./figure";

export const PROJECT_FILE_EXTENSION = "hlx";

export interface ProjectFilePayload {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  /** Each table's analyses and graphs, in sidebar order. */
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
  /** The `template` envelope block of a `.pzt`/`.pzm` file (plan 38): the
   *  template's kind and its name/description/instructions. A plain `.hlx`
   *  never carries one — the saver only writes it for `.pzt`/`.pzm`. */
  template?: TemplateInfo;
  /** The name a script's SetProjectName gave the project. Omitted when unset. */
  projectName?: string;
  /** Unknown keys from a newer or hand-edited file (FF-F12): the file envelope's
   *  and the project's, kept verbatim and written back on save, so opening a
   *  newer file in this Titer doesn't silently lose its forward-compat data.
   *  Absent on files this version wrote (nothing unknown to carry). */
  fileUnknowns?: Record<string, unknown>;
  projectUnknowns?: Record<string, unknown>;
}

// ── Writing ──────────────────────────────────────────────────────────────

export function serializeProjectFile({ nodes, rootOrder, childOrder, activeNodeId, template, projectName, fileUnknowns, projectUnknowns }: ProjectFilePayload): string {
  // Unknown keys go back where they came from, under the known keys — a
  // hand-edited file can't smuggle a second `nodes` or `app` past the reader.
  const project: ProjectFilePayload = {
    ...projectUnknowns,
    nodes,
    rootOrder,
    childOrder,
    activeNodeId,
    ...(projectName ? { projectName } : {}),
  };
  // The `template` block lives at the file level, beside `project` (plan 38):
  // a plain `.hlx` never carries one — only the template saver passes it.
  return format({ ...fileUnknowns, app: "titer", schemaVersion: 1, savedAt: new Date().toISOString(), template, project }, "") + "\n";
}

/** Indented JSON, with each list of plain values (a table row, the column names)
 *  on one line, so a table reads row by row. */
function format(value: unknown, indent: string): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) return JSON.stringify(value);
  const inner = indent + "  ";
  const items = Array.isArray(value)
    ? value.map((v) => inner + format(v, inner))
    : Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`);
  const [open, close] = Array.isArray(value) ? "[]" : "{}";
  return items.length ? `${open}\n${items.join(",\n")}\n${indent}${close}` : open + close;
}

// ── Reading ──────────────────────────────────────────────────────────────

interface ProjectIssue {
  severity: "error" | "warning";
  message: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
/** `obj` without its empty (undefined) fields. */
const defined = <T extends object>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

/** `obj` with its known keys spelled as Titer writes them, whatever their case. */
function canonical(obj: Obj, keys: readonly string[]): Obj {
  const spelling = new Map(keys.map((k) => [k.toLowerCase(), k]));
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [spelling.get(k.toLowerCase()) ?? k, v]));
}

/** The keys of `obj` this version doesn't know (FF-F12), whatever their case —
 *  carried through a save, not dropped. */
const unknownsOf = (obj: Obj, known: readonly string[]): Obj => {
  const spelling = new Set(known.map((k) => k.toLowerCase()));
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !spelling.has(k.toLowerCase())));
};

// Every field Titer knows, per level. The `satisfies` checks make TypeScript
// flag any field added to a type but not listed here.
const FILE_KEYS = ["app", "schemaVersion", "savedAt", "template", "project"];
const PROJECT_KEYS = ["nodes", "rootOrder", "childOrder", "activeNodeId", "projectName"] satisfies (keyof ProjectFilePayload)[];
// prettier-ignore
const NODE_KEYS = Object.keys({
  id: 1, type: 1, name: 1, parentId: 1, floatingNotes: 1, highlight: 1, tableType: 1, data: 1, transform: 1, notes: 1, tags: 1,
  analysisType: 1, analysisParams: 1, cachedResult: 1, frozen: 1, orphaned: 1, sourceTableName: 1, graphType: 1, graphOptions: 1,
  panels: 1, grid: 1, figureSize: 1, labelStyle: 1, figureTitle: 1, sharedLegend: 1, dpi: 1,
  info: 1,
} satisfies Record<keyof ProjectNode, 1>);
// prettier-ignore
const DATA_KEYS = Object.keys({
  columns: 1, rows: 1, groups: 1, replicates: 1, subgroups: 1, rowGroups: 1, excluded: 1,
  widths: 1, freezeTitle: 1, notes: 1, summaryFormat: 1, errorFormat: 1, calculated: 1,
} satisfies Record<keyof TableData, 1>);

// Graph options without a default, by the kind of value they hold.
type OptionalOption = {
  [K in keyof GraphOptions]-?: undefined extends GraphOptions[K] ? K : never;
}[keyof GraphOptions];
// prettier-ignore
const OPTIONAL_OPTIONS = {
  yMin: "number", yMax: "number", yStep: "number", xMin: "number", xMax: "number", xStep: "number", y2Min: "number", y2Max: "number", y2Step: "number", binWidth: "number",
  yMinConstant: "text", yMaxConstant: "text", xMinConstant: "text", xMaxConstant: "text",
  sigAnalysisId: "text", sigPairs: "texts", regAnalysisId: "text", demingAnalysisId: "text", coxAnalysisId: "text", ttestAnalysisId: "text", poissonAnalysisId: "text", smoothAnalysisId: "text", pcaAnalysisId: "text", kmeansAnalysisId: "text", hclustAnalysisId: "text", monteCarloAnalysisId: "text", xVariable: "text", yVariable: "text", bubbleSizeVariable: "text", bubbleColorVariable: "text",
  volcanoX: "text", volcanoY: "text", volcanoLabel: "text", volcanoGroupA: "text", volcanoGroupB: "text", rightYDataset: "text", y2Label: "text",
  palette: "palette", series: "styles", points: "pointStyles", outlineColor: "color", pointOutlineColor: "color", errorColor: "color",
  legend: "place", note: "place", refLines: "refLines", sets: "texts",
} as const satisfies Record<OptionalOption, keyof typeof READ_OPTION>;
// A graph's links to its analyses (FF-F13): the graph options that name a
// sibling analysis node — the source of an overlay (significance brackets,
// a regression line, a Deming/Cox/t-test/Poisson/PCA/smooth/k-means/
// hierarchical-clustering/Monte-Carlo overlay). Every `*AnalysisId` option, including the two the
// old warning missed (kmeans, monte-carlo).
const GRAPH_ANALYSIS_LINKS = [
  "sigAnalysisId",
  "regAnalysisId",
  "demingAnalysisId",
  "coxAnalysisId",
  "ttestAnalysisId",
  "poissonAnalysisId",
  "pcaAnalysisId",
  "smoothAnalysisId",
  "kmeansAnalysisId",
  "hclustAnalysisId",
  "monteCarloAnalysisId",
] as const;
// The retired dose-response graph's own options (before Titer 1.0.7): no
// longer a GraphOptions field, but still read — fitsFromDoseGraphs below
// needs them to turn an old graph into a scatter + analysis — and stripped
// from every graph on the way out (see parseProjectFile).
const LEGACY_DOSE_OPTIONS = ["doseY", "doseModel", "doseShowCurve", "doseShowEquation", "doseLigandConcentration"];
// Options whose text is the user's (titles, column names), not a choice from a list.
const FREE_TEXT_OPTIONS = new Set(["title", "xLabel", "yLabel", "y2Label"]);

// Every graph option offering choices has its list, and every number its limits.
type ChoiceOption = {
  [K in keyof GraphOptions]-?: string extends GraphOptions[K] ? never : GraphOptions[K] extends string ? K : never;
}[keyof GraphOptions];
type NumberOption = { [K in keyof GraphOptions]-?: GraphOptions[K] extends number ? K : never }[keyof GraphOptions];
GRAPH_CHOICES satisfies Record<ChoiceOption, readonly string[]>;
GRAPH_LIMITS satisfies Record<NumberOption, Limits>;

// What each analysis param holds: a choice from its list, yes/no, a number (within its
// limits), or the user's names (of columns). The R code is written with them: anything
// else is left out (the test takes its default), so a file can't slip R code into it.
type ParamKey = AnalysisParams extends infer P ? (P extends unknown ? keyof P : never) : never;
type ParamKind =
  | "yes/no"
  | "number"
  | "name"
  | "names"
  | "name-or-names"
  | "name-or-number"
  | "name-and-names"
  | "numbers-by-name"
  | "number-pairs-by-name"
  | "plot-curves"
  | "texts-by-name"
  | "text-pairs-by-name"
  | readonly string[]
  | Limits;
// prettier-ignore
const PARAMS = {
  paired: "yes/no", gaussian: "yes/no", equalVariance: "yes/no", ratio: "yes/no", forceOrigin: "yes/no", pooledSd: "yes/no", quasi: "yes/no", fixHillSlope: "yes/no", trendOrdered: "yes/no", continuityCorrection: "yes/no",
  equalSd: "yes/no", sphericity: "yes/no", interpolate: "yes/no", tails: TAILS, posthoc: [...ANOVA_POSTHOCS, ...RANK_POSTHOCS, "fdr"], mixed: "yes/no",
  // `model` is shared by nonlinear-regression and the binding runners:
  // the reader only sanitizes, each runner validates its own.
  model: [...NONLINEAR_MODELS, ...BINDING_SATURATION_MODELS, ...BINDING_KINETICS_MODELS, ...ENZYME_INHIBITION_MODELS, ...DOSE_RESPONSE_SPECIAL_MODELS],
  // `method` is shared by correlation ("pearson"/"spearman") and Spline/Lowess
  // ("spline"/"lowess") — and now outliers ("rout"/"grubbs"): the reader only
  // sanitizes, each runner validates its own.
  method: [...CORRELATION_METHODS, "spline", "lowess", "rout", "grubbs"],
  mode: CORRELATION_MODES, design: TWO_WAY_DESIGNS, posthocTarget: POSTHOC_TARGETS, correction: CORRECTIONS, curveTest: CURVE_TESTS, compare: CURVE_COMPARISONS,
  // Nonlinear regression framework (plan 26): weighting, model comparison,
  // global fitting, fixed parameters and bounds.
  weights: ["none", "1/y", "1/y2", "1/x", "1/x2", "1/sd2"],
  compareModel: [...NONLINEAR_MODELS],
  globalY: "names",
  sharedParams: "names",
  fixed: "numbers-by-name",
  bounds: "number-pairs-by-name",
  // Info-constant hooks (v2): the constant's name per fixed parameter, and
  // per bound side a plain number or a constant name — resolved live before
  // the run, never passed to R as text.
  fixedConstants: "texts-by-name",
  boundsConstants: "text-pairs-by-name",
  ligandConcentrationConstant: "name",
  ligandKdConstant: "name",
  constantHook: "name",
  zeroConstantHook: "name",
  hundredConstantHook: "name",
  // v2 item 23: the user-defined equation (a free string, read as a name) and its
  // parameters' starting values (numbers by name).
  customEquation: "name",
  customParameters: "numbers-by-name",
  hypotheticalValue: "number", baseline: "number", q: ROUT_Q, lambda: "number", ecx: EC_ANYTHING,
  // Remove baseline (v2): how the baseline is defined, and the values it needs.
  baselineMethod: REMOVE_BASELINE_METHODS, firstN: "number", controls: "names", constant: "number",
  // Normalize (v2): how each value is rescaled, and the values it needs.
  normalizeMethod: NORMALIZE_METHODS, asPercent: "yes/no", zeroDef: NORMALIZE_ZERO_DEFS, hundredDef: NORMALIZE_HUNDRED_DEFS,
  zeroConstant: "number", hundredConstant: "number",
  // Prune rows (v2): the condition, and the threshold/range it needs.
  condition: PRUNE_ROWS_CONDITIONS, threshold: "number", low: "number", high: "number",
  // Fraction of total (v2): which total each value is divided by, and
  // whether the result is a fraction or a percent.
  totalBy: FRACTION_OF_TOTAL_TOTALS, format: FRACTION_OF_TOTAL_FORMATS,
  // Row means and totals (1.8, seq 194): whether each row is summarised
  // across all the chosen data sets together, or within each one.
  rowScope: ROW_MEANS_SCOPES,
  alpha: { min: 0.001, max: 0.5 }, iterate: "yes/no",
  f: "number", spar: "number", df: "number",
  // Smooth, differentiate or integrate a curve (v2): the operation is a
  // choice; window/order are numbers the runner validates (5/9/13, 2/3);
  // `baseline` already has an entry above.
  operation: SMOOTH_DIFF_INT_OPERATIONS, window: "number", order: "number", smoothResults: "yes/no", startValue: "number",
  y: "name-or-names", y2: "name", ys: "names", dependent: "name", reference: "name", control: "name", compareWith: "name", datasets: "names", predictors: "names", sets: "names", compared: "names",
  // Transform concentrations (v2): the column to convert, and the units
  // it is in now vs. the units it is converted to.
  column: "name", fromUnit: CONCENTRATION_UNITS, toUnit: CONCENTRATION_UNITS,
  ligandConcentration: "number", ligandKd: "number", fitKi: "yes/no", koff: "number", hotNM: "number", time0: "number",
  enzymeConcentration: "number", substrateConcentration: "number", kmForMorrison: "number",
  inhibitorConcentrations: "numbers-by-name",
  antagonistConcentrations: "numbers-by-name",
  bUnits: ["M", "nM", "µM"],
  binMode: BIN_MODES, binWidth: "number", binCount: { min: 2, max: 100 }, startAt: "number",
  posthocTerm: THREE_WAY_TERMS,
  // The FDR approach after an ANOVA (seq 192): which method, and at which Q
  // (%) a comparison counts as a discovery — same 0.01–50 range as ROUT's Q.
  // `posthocScope` splits a three-way interaction term into simple effects.
  fdrMethod: FDR_METHODS, fdrQ: FDR_Q, posthocScope: THREE_WAY_POSTHOC_SCOPES,
  truth: "name", score: "name", positive: "name-or-number",
  time: "name", status: "name", covariates: "names", stratifyBy: "name", ties: ["efron", "breslow"],
  // A Multiple Variables t test's response split, and a survival analysis's groups.
  groupBy: "name",
  // Normality tests (plan 23): which of the four tests, and whether to
  // also test the log-transformed values. `test` is shared with chi-square's
  // test choice (fisher/yates/chi-square/trend): the reader only sanitizes,
  // each runner validates its own.
  test: ["shapiro-wilk", "dagostino-pearson", "anderson-darling", "kolmogorov-smirnov", ...CONTINGENCY_TESTS],
  lognormal: "yes/no",
  // Principal component analysis (plan 21): the matrix, and how many
  // components to report (0 = all).
  scale: ["correlation", "covariance"], components: "number",
  // K-means clustering (plan 30): how many clusters, and whether to
  // standardise the variables first.
  clusters: "number", standardise: "yes/no",
  // Hierarchical clustering (seq 160): how clusters merge, and how rows
  // are measured apart.
  linkage: ["complete", "average", "single", "ward.D2"],
  distance: ["euclidean", "manhattan"],
  // Mixed-effects model (plan 20): the random structure and the subject
  // identity are choices; `subjectFactor` is one name + its per-row levels.
  // (FF-F18) `slopeVariable` was dropped in v1.5.0: a dead param, accepted
  // and stored but never read — the runner errors on randomStructure
  // "slope" before any slope could be fit, and the wizard never sets it.
  // Wiring it to the compare-slopes feature (#46) is a design decision,
  // not a bug fix. An old file carrying it keeps the value verbatim as an
  // unknown param (FF-F12 carry-through).
  randomStructure: ["intercept", "slope"], subjectId: ["row", "replicate"], interaction: "yes/no",
  fixedFactors: "names", subjectFactor: "name-and-names",
  // Monte Carlo simulation (plan 22): the target analysis + statistic are
  // choices; repeats/seed are numbers; the per-column simulated means/SDs
  // are numbers-by-name (the target's own options — equalVariance,
  // hypotheticalValue, y, method — already have entries above).
  targetAnalysis: MONTE_CARLO_TARGETS,
  summaryStatistic: MONTE_CARLO_STATISTICS,
  repeats: "number",
  seed: "number",
  groupMeans: "numbers-by-name",
  groupSds: "numbers-by-name",
  rout: "yes/no", x: "name",
  // Transform data (v2): which function to apply.
  function: TRANSFORM_FUNCTIONS,
  // Plot a function (v2): the equation, the X range, how many line segments
  // draw each curve, the extra series, and the curves themselves (each a
  // label + its parameter values, read by the "plot-curves" kind below).
  equation: [...NONLINEAR_MODELS, "gaussian"],
  xMin: "number",
  xMax: "number",
  segments: { min: 10, max: 1000 },
  extra: ["none", "first-derivative", "second-derivative", "integral"],
  curves: "plot-curves",
  // Extract and rearrange (v2, item 10): the target table type, the
  // variables that fill it, and the two format options.
  target: EXTRACT_REARRANGE_TARGETS,
  response: "name", grouping: "name", subject: "name", rowTitles: "name",
  rowFactor: "name", columnFactor: "name", rowVariable: "name", outcome: "name", count: "name",
  prefixNames: "yes/no", completeRows: "yes/no",
} satisfies Record<ParamKey, ParamKind>;

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const cellText = (v: unknown) =>
  typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : null;

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Whether `key` is one of `list`'s own entries (not a name every object has, as "constructor"). */
const isIn = (list: object, key: unknown) => typeof key === "string" && Object.hasOwn(list, key);

const isNamed = (v: unknown): v is PaletteColor => typeof v === "string" && Object.hasOwn(NAMED_COLORS, v);

/** Named colors (Titer 1.0's), by key. */
function colors(v: unknown): Record<string, PaletteColor> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .map(([k, c]) => [k, lower(c)] as const)
    .filter((e): e is [string, PaletteColor] => isNamed(e[1]));
  return out.length ? Object.fromEntries(out) : undefined;
}

/** `v` when it is one of `choices`, whatever their case (the choices themselves
 *  are mostly lowercase, but a three-way ANOVA's post-hoc term is "A:B" — so
 *  both sides are compared lowercased). */
const oneOf = <T extends string>(choices: readonly T[], v: unknown) =>
  choices.find((c) => c.toLowerCase() === lower(v));

/** A number brought within `limits`; anything else, none. */
const within = (v: unknown, limits: Limits) => (isFiniteNumber(v) ? clamp(v, limits) : undefined);

/** A palette as a file holds it (a project's graph, My Palettes), or nothing if broken. */
export function readPalette(v: unknown): GraphPalette | undefined {
  if (!isObj(v)) return undefined;
  const p = canonical(v, ["name", "kind", "colors", "reversed"]);
  const colors = Array.isArray(p.colors) ? p.colors.filter(isHex) : [];
  if (typeof p.name !== "string" || !colors.length) return undefined;
  const kind = oneOf(PALETTE_KINDS, p.kind) ?? "categorical";
  // A gradient runs between two colors at least: one alone is taken at both ends.
  if (kind !== "categorical" && colors.length === 1) colors.push(colors[0]);
  return defined({ ...p, name: p.name, kind, colors, reversed: p.reversed === true || undefined });
}

/** Each series' style, keeping what this version doesn't know of it. */
function readStyles(v: unknown): Record<string, SeriesStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .filter((e): e is [string, Obj] => isObj(e[1]))
    .map(([key, raw]) => {
      const style = canonical(raw, ["color", "shape", "dash", "pattern"]);
      const shape = oneOf(GRAPH_CHOICES.pointShape, style.shape);
      const dash = oneOf(GRAPH_CHOICES.lineDash, style.dash);
      const pattern = oneOf(FILL_PATTERNS, style.pattern);
      return [
        key,
        defined({ ...style, color: isHex(style.color) ? style.color : undefined, shape, dash, pattern }),
      ] as const;
    })
    .filter(([, style]) => Object.keys(style).length);
  return out.length ? Object.fromEntries(out) : undefined;
}

/** A position, both coordinates numbers. */
const readPlace = (v: unknown): Place | undefined =>
  isObj(v) && isFiniteNumber(v.x) && isFiniteNumber(v.y) ? { x: v.x, y: v.y } : undefined;

/** Reference lines: each at a finite value, its dashes one of the list (else dashed), its
 *  thickness within the lines' limits, a color or none, a text or none; ten at most. */
function readRefLines(v: unknown): RefLine[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v
    .filter((l): l is Obj => isObj(l) && isFiniteNumber(l.value))
    .slice(0, MAX_REF_LINES)
    .map((raw) => {
      const l = canonical(raw, ["value", "dash", "width", "color", "label", "labelPlace"]);
      return defined({
        ...l,
        value: l.value as number,
        dash: oneOf(GRAPH_CHOICES.lineDash, l.dash) ?? "dash",
        width: within(l.width, GRAPH_LIMITS.lineWidth) ?? 1,
        color: isHex(l.color) ? l.color : undefined,
        label: typeof l.label === "string" && l.label ? l.label : undefined,
        labelPlace: oneOf(REF_LABEL_PLACES, l.labelPlace),
      }) as RefLine;
    });
  return out.length ? out : undefined;
}

/** Each point's style, keeping what this version doesn't know of it. */
function readPointStyles(v: unknown): Record<string, PointStyle> | undefined {
  if (!isObj(v)) return undefined;
  const out = Object.entries(v)
    .filter((e): e is [string, Obj] => isObj(e[1]) && /#\d+$/.test(e[0]))
    .map(([key, raw]) => {
      const p = canonical(raw, ["color", "size", "shape", "fill", "outline", "outlineColor", "label", "labelOffset"]);
      const shape = oneOf(GRAPH_CHOICES.pointShape, p.shape);
      const color = isHex(p.color) ? p.color : undefined;
      const outlineColor = isHex(p.outlineColor)
        ? p.outlineColor
        : lower(p.outlineColor) === SAME_AS_FILL
          ? SAME_AS_FILL
          : undefined;
      const label = p.label === true || undefined;
      const labelOffset = readPlace(p.labelOffset);
      const size = within(p.size, GRAPH_LIMITS.pointSize);
      const fill = within(p.fill, GRAPH_LIMITS.pointFill);
      const outline = within(p.outline, GRAPH_LIMITS.pointOutline);
      return [key, defined({ ...p, color, size, shape, fill, outline, outlineColor, label, labelOffset })] as const;
    })
    .filter(([, style]) => Object.keys(style).length);
  return out.length ? Object.fromEntries(out) : undefined;
}

const READ_OPTION = {
  number: (v: unknown) => (isFiniteNumber(v) ? v : undefined),
  text: (v: unknown) => (typeof v === "string" ? v : undefined),
  texts: (v: unknown) => {
    // A graph's significance pairs, keeping the usable ones (M6): one bad
    // entry used to drop the whole list.
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter((s) => typeof s === "string");
    return kept.length ? kept : undefined;
  },
  palette: readPalette,
  styles: readStyles,
  pointStyles: readPointStyles,
  place: readPlace,
  refLines: readRefLines,
  color: (v: unknown) => (isHex(v) ? v : undefined),
};

/** Colors a table kept for its graphs before Titer 1.0.3: its series' and its cells'. */
type TableColors = { series?: Record<string, PaletteColor>; cells?: Record<string, PaletteColor> };

/** A table's row groups as a file holds them: every band a non-empty, distinct
 *  name with a positive whole-row count. A broken band is left out on its own —
 *  the valid bands stay, and each dropped band is named so the user is told
 *  (a file whose every band is broken reads as no third factor). */
function readRowGroups(v: unknown): { groups: RowGroup[] | undefined; dropped: string[] } {
  if (!Array.isArray(v)) return { groups: undefined, dropped: [] };
  const groups: RowGroup[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const b of v) {
    if (!isObj(b) || typeof b.name !== "string" || b.name.trim() === "" || !isCount(b.count)) {
      dropped.push(describeDroppedBand(b));
      continue;
    }
    if (seen.has(b.name)) {
      dropped.push(`“${b.name}” (a second band with this name)`);
      continue;
    }
    seen.add(b.name);
    groups.push({ name: b.name, count: b.count });
  }
  return { groups: groups.length ? groups : undefined, dropped };
}

/** How a dropped row-group band is named in the warning: its name and count
 *  when it has them, so the user can tell which band went. */
function describeDroppedBand(b: unknown): string {
  if (!isObj(b)) return "an unreadable band";
  const name = typeof b.name === "string" && b.name.trim() !== "" ? `“${b.name}”` : "a band with no name";
  if (isCount(b.count)) return name;
  return typeof b.count === "number" ? `${name} (count ${b.count})` : `${name} (no count)`;
}

/** A table's data, and the colors it kept for its graphs. */
/** A table's data, put straight: no value beyond its last column (`beyond` counts those left
 *  out), exclusions and widths only on cells and columns it has, and a grouped table's
 *  groups and sub-columns those of its columns ("A:Y1"…). Rebuilding a grouped or
 *  nested table from its columns drops any column whose name has no slot in the
 *  rebuilt set — a gapped sub-column ("A:Y3" with no "A:Y2") — so `regroupDropped`
 *  names the valued columns that went, for a warning: without it the values
 *  would vanish on load and the loss would be saved over the file. */
function readData(
  raw: Obj,
  type: unknown,
): {
  data: TableData;
  colors: TableColors;
  beyond: number;
  regroupDropped: string[];
  rowGroupsDropped: string[];
} | null {
  const { seriesColors, pointColors, ...d } = canonical(raw, [...DATA_KEYS, "seriesColors", "pointColors"]);
  if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
  const columns = d.columns.map((c) => cellText(c) ?? "");
  if (!columns.length) columns.push("Title");
  let beyond = 0;
  const rows = d.rows.map((row) => {
    const cells = Array.isArray(row) ? row.map((c) => cellText(c) || null) : [];
    beyond += cells.slice(columns.length).filter((c) => c !== null).length;
    return cells.slice(0, columns.length);
  });
  const onCell = (k: unknown): k is string => {
    const [r, c] = typeof k === "string" && /^\d+,\d+$/.test(k) ? k.split(",").map(Number) : [Infinity];
    return r < rows.length && c < columns.length;
  };
  const excluded = Array.isArray(d.excluded) ? d.excluded.filter(onCell) : [];
  const widths = isObj(d.widths)
    ? Object.fromEntries(
        Object.entries(d.widths).filter(([name, w]) => columns.includes(name) && isFiniteNumber(w) && w > 0),
      )
    : {};
  const rowGroups = readRowGroups(d.rowGroups);
  // Calculated variables survive only as entries naming a column with a
  // non-empty formula; a stored error is dropped — the values are recomputed
  // below (and on every edit), and the error is re-derived then.
  const calculated = readCalculated(d.calculated, columns);
  // Groups of sub-columns: a Grouped table's, a Nested table's, or an XY table's data sets of replicates (after X).
  const grouping =
    (type === "grouped" || type === "xy" || type === "nested") && isCount(d.groups) && isCount(d.replicates);
  let data = defined({
    ...d,
    columns,
    rows,
    groups: grouping ? d.groups : undefined,
    replicates: grouping ? d.replicates : undefined,
    subgroups: grouping && isCount(d.subgroups) ? d.subgroups : undefined,
    rowGroups: rowGroups.groups,
    excluded: excluded.length ? excluded : undefined,
    widths: Object.keys(widths).length ? (widths as Record<string, number>) : undefined,
    freezeTitle: d.freezeTitle === true || undefined,
    // Only "sd" or "sem" survives: a hand-edited file holding anything else
    // reads as SEM, the default, instead of carrying a bogus format.
    errorFormat: d.errorFormat === "sd" || d.errorFormat === "sem" ? d.errorFormat : undefined,
    calculated,
  } as TableData);
  const regroupDroppedNames: string[] = [];
  // Where the groups start: an XY table's X column comes first — unless the
  // second column is itself a sub-column ("A:Y1"), i.e. grouped-shaped data
  // (a hand-built or pre-1.0.9 file), whose groups start right after Title.
  const lead = type === "xy" && !columns[1]?.includes(":") ? 2 : 1;
  const kind = lead === 2 ? "xy" : "grouped";
  // A summary format survives only when it fits its columns: a known format,
  // whose width is the table's sub-column count, with every group's suffixes
  // in its order ("A:Mean", "A:SD", "A:N"). Anything else is a stale or
  // hand-edited value — dropped, so the columns read as plain replicates and
  // the load-time rebuild below can put the names straight.
  if (isGrouped(data) && data.summaryFormat !== undefined) {
    const format = data.summaryFormat;
    const subs = isSummaryFormatValue(format) ? summarySubcolumns(format) : [];
    const fits =
      subs.length === data.replicates &&
      columns
        .slice(lead)
        .every((name, i) => name.slice(name.indexOf(":") + 1) === subs[i % subs.length]);
    if (!fits) data = defined({ ...data, summaryFormat: undefined });
  }
  if (isGrouped(data) && columns.length > lead) {
    // Groups are runs, not names: two same-named groups ("Group:Y1"… twice)
    // are two groups, and counting unique names would rebuild the table as
    // one merged group and move the second group's values into the first's
    // columns. Rebuild only when the run-based counts disagree with the
    // stored ones (a ragged or hand-edited file).
    const runs = groupRuns(columns.slice(lead));
    const groups = runs.length;
    const replicates = Math.max(...runs.map((r) => r.columns.length));
    if (groups !== data.groups || replicates !== data.replicates) {
      regroupDroppedNames.push(...regroupDropped(data, groups, replicates, kind));
      data = defined(regroupTable(data, groups, replicates, kind));
    }
  }
  if (isNested(data) && columns.length > 1) {
    // A nested table's groups, subgroups and replicates are those of its
    // columns ("A:S1:R1"…), as a grouped table's are of its "A:Y1" columns.
    const parts = columns
      .slice(1)
      .map((c) => c.split(":"))
      .filter((p) => p.length === 3);
    const groups = [...new Set(parts.map((p) => p[0]))];
    const subgroups = Math.max(0, ...groups.map((g) => new Set(parts.filter((p) => p[0] === g).map((p) => p[1])).size));
    const replicates = Math.max(
      0,
      ...groups.flatMap((g) =>
        [...new Set(parts.filter((p) => p[0] === g).map((p) => p[1]))].map(
          (s) => parts.filter((p) => p[0] === g && p[1] === s).length,
        ),
      ),
    );
    if (groups.length !== data.groups || subgroups !== data.subgroups || replicates !== data.replicates) {
      regroupDroppedNames.push(...renestDropped(data, groups.length, subgroups, replicates));
      data = defined(renestTable(data, groups.length, subgroups, replicates));
    }
  }
  return {
    data,
    colors: { series: colors(seriesColors), cells: colors(pointColors) },
    beyond,
    regroupDropped: regroupDroppedNames,
    rowGroupsDropped: rowGroups.dropped,
  };
}

/** Every option, of the right type, one of its choices and within its limits: a missing
 *  or wrong one takes its default, a number beyond its limits the nearest it can be. */
function readOptions(raw: unknown, label: string, issues: ProjectIssue[]): GraphOptions {
  const o = isObj(raw)
    ? canonical(raw, [...Object.keys(DEFAULT_GRAPH_OPTIONS), ...Object.keys(OPTIONAL_OPTIONS), ...LEGACY_DOSE_OPTIONS])
    : {};
  const out: Obj = { ...o, ...DEFAULT_GRAPH_OPTIONS };
  for (const [key, fallback] of Object.entries(DEFAULT_GRAPH_OPTIONS)) {
    const v = typeof o[key] === "string" && !FREE_TEXT_OPTIONS.has(key) ? lower(o[key]) : o[key];
    const choices: readonly unknown[] | undefined = isIn(GRAPH_CHOICES, key)
      ? GRAPH_CHOICES[key as ChoiceOption]
      : undefined;
    if (typeof v !== typeof fallback || (typeof v === "number" && !Number.isFinite(v))) continue;
    if (!choices || choices.includes(v)) out[key] = v;
  }
  for (const [key, limits] of Object.entries(GRAPH_LIMITS)) out[key] = within(out[key], limits);
  for (const [key, kind] of Object.entries(OPTIONAL_OPTIONS)) {
    const raw = o[key];
    out[key] = READ_OPTION[kind](raw);
    if (kind === "texts" && Array.isArray(raw) && raw.length) {
      const kept = Array.isArray(out[key]) ? (out[key] as unknown[]).length : 0;
      if (kept < raw.length) {
        issues.push({
          severity: "warning",
          message: `Graph “${label}”: ${raw.length - kept} invalid ${raw.length - kept === 1 ? "entry" : "entries"} in “${key}” ${raw.length - kept === 1 ? "was" : "were"} left out; the rest were kept.`,
        });
      }
    }
  }
  return defined(out) as unknown as GraphOptions;
}

/** The runner default for a param, by analysis: when a file's value for one
 *  of these is unusable it falls back to this instead of being left out — the
 *  file header's promise. Only keys whose runner reads them whole-object
 *  (`(params ?? DEFAULTS).key`) are listed; the rest already fall back per
 *  key (`??` in the runner) or spread-merge their defaults (one-sample-t,
 *  one-way ANOVA, frequency-distribution). Mirrors each runner's DEFAULTS —
 *  compare-two-groups, kruskal-wallis, friedman, nested-anova,
 *  deming-regression, survival — and the multiple-t-tests wizard default (Holm). */
const PARAM_DEFAULTS: Record<string, Record<string, unknown>> = {
  "compare-two-groups": { paired: false, gaussian: true, equalVariance: true, ratio: false, tails: "two-sided" },
  "kruskal-wallis": { posthoc: "none" },
  friedman: { posthoc: "none" },
  "nested-anova": { posthoc: "none" },
  "deming-regression": { lambda: 1 },
  "multiple-t-tests": { paired: false, gaussian: true, pooledSd: false, correction: "holm" },
  survival: { curveTest: "logrank", correction: "holm" },
  // M7 fallbacks: a cross-family choice left out below lands on these.
  anova: { posthoc: "none" },
  correlation: { method: "pearson" },
  "correlation-matrix": { method: "pearson" },
  outliers: { method: "rout" },
};

/** Choice values only one family of analyses may use (M7). The merged PARAMS
 *  lists admit them all, so each runner reinterprets the other family's
 *  values: `posthoc: "dunn"` on a one-way ANOVA runs Dunnett's T3 math under
 *  a Dunn's label, `"tukey"`/`"bonferroni"` on Kruskal-Wallis or Friedman
 *  runs Dunn regardless, `method: "spline"|"lowess"` on a correlation is
 *  silently treated as Pearson. Restricted here, at load, to the list its
 *  own analysis offers; anything else is left out and falls back to the
 *  default above, with a warning. Analyses whose runner already refuses
 *  cross-family values with a clean error — nested-anova and three-way-anova
 *  posthoc, two-way-anova posthoc, spline-lowess method, repeated-measures
 *  ANOVA posthoc — are left alone: the error is the honest answer there.
 *  The merged `model` list is likewise safe (each runner validates and
 *  errors cleanly). */
const PARAM_CHOICES: Record<string, Record<string, readonly string[]>> = {
  anova: { posthoc: ANOVA_POSTHOCS },
  "kruskal-wallis": { posthoc: RANK_POSTHOCS },
  friedman: { posthoc: RANK_POSTHOCS },
  correlation: { method: CORRELATION_METHODS },
  "correlation-matrix": { method: CORRELATION_METHODS },
  outliers: { method: ["rout", "grubbs"] },
};

/** A collection param, keeping its usable entries: one bad entry used to
 *  drop the whole value (M6) — the analysis then silently ran on all columns
 *  instead of the chosen subset, or lost every wizard-entered concentration
 *  at once. `report` hears how many entries were left out, so the reader
 *  can warn about them. */
function readParam(kind: ParamKind, v: unknown, report?: (dropped: number) => void): unknown {
  if (kind === "yes/no") return typeof v === "boolean" ? v : undefined;
  if (kind === "number") return isFiniteNumber(v) ? v : undefined;
  if (kind === "name") return typeof v === "string" ? v : undefined;
  if (kind === "name-or-number") return typeof v === "string" || isFiniteNumber(v) ? v : undefined;
  if (kind === "name-or-names") {
    if (typeof v === "string") return v;
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter((s): s is string => typeof s === "string");
    if (kept.length !== v.length) report?.(v.length - kept.length);
    return kept.length ? kept : undefined;
  }
  if (kind === "numbers-by-name") {
    if (!isObj(v)) return undefined;
    const kept = Object.fromEntries(Object.entries(v).filter(([, n]) => isFiniteNumber(n)));
    const dropped = Object.keys(v).length - Object.keys(kept).length;
    if (dropped) report?.(dropped);
    return Object.keys(kept).length ? kept : undefined;
  }
  if (kind === "number-pairs-by-name") {
    if (!isObj(v)) return undefined;
    const kept = Object.fromEntries(
      Object.entries(v).filter(([, p]) => Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber)),
    );
    const dropped = Object.keys(v).length - Object.keys(kept).length;
    if (dropped) report?.(dropped);
    return Object.keys(kept).length ? kept : undefined;
  }
  if (kind === "texts-by-name") {
    if (!isObj(v)) return undefined;
    const kept = Object.fromEntries(Object.entries(v).filter(([, s]) => typeof s === "string"));
    const dropped = Object.keys(v).length - Object.keys(kept).length;
    if (dropped) report?.(dropped);
    return Object.keys(kept).length ? kept : undefined;
  }
  if (kind === "text-pairs-by-name") {
    if (!isObj(v)) return undefined;
    const kept = Object.fromEntries(
      Object.entries(v).filter(
        ([, p]) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === "string"),
      ),
    );
    const dropped = Object.keys(v).length - Object.keys(kept).length;
    if (dropped) report?.(dropped);
    return Object.keys(kept).length ? kept : undefined;
  }
  if (kind === "name-and-names") {
    if (!isObj(v) || typeof v.name !== "string" || !Array.isArray(v.levels)) return undefined;
    const levels = v.levels.filter((s): s is string => typeof s === "string");
    if (levels.length !== v.levels.length) report?.(v.levels.length - levels.length);
    return levels.length ? { ...v, levels } : undefined;
  }
  if (kind === "plot-curves") {
    // One curve per entry: a label + its parameter values (each a finite
    // number). A curve with a non-numeric value is left out whole — a half
    // curve would run on the wrong parameters — and reported, like the other
    // collection kinds (M6).
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter(
      (c): c is { label: string; params: Record<string, number> } =>
        isObj(c) &&
        typeof c.label === "string" &&
        isObj(c.params) &&
        Object.values(c.params).every(isFiniteNumber),
    );
    if (kept.length !== v.length) report?.(v.length - kept.length);
    return kept.length ? kept : undefined;
  }
  if (kind === "names") {
    if (!Array.isArray(v)) return undefined;
    const kept = v.filter((s): s is string => typeof s === "string");
    if (kept.length !== v.length) report?.(v.length - kept.length);
    return kept.length ? kept : undefined;
  }
  return Array.isArray(kind) ? oneOf(kind, v) : within(v, kind as Limits);
}

/** The parameters one analysis takes, by type — derived from the `*Params`
 *  interfaces in `src/stats/types.ts` (plus `sets`, which every analysis
 *  takes through the `DataSetsParam` base). Used only for error messages:
 *  an unknown key is rejected naming these, so a caller learns what the
 *  analysis actually takes. Keep in step with the interfaces; each key is
 *  compiler-checked as a `ParamKey`, the per-type grouping is not — a key
 *  listed under the wrong type is caught by the runner, not here.
 *  `correlation` takes `XYCorrelationParams`, `correlation-matrix` takes
 *  `CorrelationParams` (method only) — see `src/stats/index.ts`.
 *  Exported: tests/checks.ts pins the generated MCP params schema
 *  (src-tauri/src/analysis-params-schema.json) against this list. */
export const PARAM_KEYS_BY_ANALYSIS: Record<string, readonly ParamKey[]> = {
  "descriptive-statistics": ["sets"],
  "frequency-distribution": ["binMode", "binWidth", "binCount", "startAt", "sets"],
  "fraction-of-total": ["ys", "x", "totalBy", "format", "sets"],
  "transform-data": ["function", "sets"],
  "transform-concentrations": ["column", "fromUnit", "toUnit", "sets"],
  "remove-baseline": ["ys", "x", "baselineMethod", "firstN", "controls", "constant", "constantHook", "sets"],
  normalize: [
    "ys", "x", "normalizeMethod", "asPercent", "controls", "constant", "constantHook", "zeroDef", "zeroConstant",
    "zeroConstantHook", "hundredDef", "hundredConstant", "hundredConstantHook", "sets",
  ],
  transpose: ["sets"],
  "prune-rows": ["ys", "x", "condition", "threshold", "low", "high", "sets"],
  "compare-two-groups": ["paired", "gaussian", "equalVariance", "ratio", "lognormal", "tails", "response", "groupBy", "sets"],
  "one-sample-t": ["hypotheticalValue", "tails", "gaussian", "lognormal", "sets"],
  anova: ["posthoc", "equalSd", "control", "compared", "lognormal", "sets"],
  "kruskal-wallis": ["posthoc", "sets"],
  "rm-anova": ["posthoc", "sphericity", "compared", "mixed", "sets"],
  friedman: ["posthoc", "sets"],
  "mixed-effects": ["fixedFactors", "randomStructure", "subjectId", "subjectFactor", "interaction", "sets"],
  "shapiro-wilk": ["test", "lognormal", "sets"],
  "kolmogorov-smirnov": ["sets"],
  outliers: ["q", "method", "alpha", "iterate", "sets"],
  "monte-carlo": [
    "targetAnalysis", "summaryStatistic", "repeats", "seed", "groupMeans", "groupSds", "equalVariance",
    "hypotheticalValue", "y", "method", "sets",
  ],
  "bland-altman": ["sets"],
  "roc-curve": ["truth", "score", "positive", "sets"],
  "plot-function": ["equation", "xMin", "xMax", "segments", "curves", "extra", "ligandConcentration", "sets"],
  correlation: ["method", "mode", "datasets", "sets"],
  "linear-regression": ["x", "y", "ys", "forceOrigin", "weights", "sets"],
  "deming-regression": ["y", "lambda", "sets"],
  "simple-logistic-regression": ["y", "sets"],
  "area-under-curve": ["baseline", "sets"],
  "row-means-totals": ["ys", "x", "rowScope", "sets"],
  "nonlinear-regression": [
    "x", "y", "ys", "model", "compareWith", "compare", "interpolate", "weights", "fixed", "bounds", "fixedConstants",
    "boundsConstants", "compareModel", "globalY", "sharedParams", "ligandConcentration", "ligandKd",
    "ligandConcentrationConstant", "ligandKdConstant", "fitKi", "rout", "q", "ecx", "customEquation", "customParameters",
    "sets",
  ],
  "dose-response-special": ["ys", "model", "antagonistConcentrations", "bUnits", "fixHillSlope", "sets"],
  "binding-saturation": ["y", "model", "y2", "sets"],
  "binding-kinetics": ["y", "model", "ligandConcentration", "koff", "hotNM", "time0", "sets"],
  "enzyme-inhibition": [
    "y", "model", "inhibitorConcentrations", "enzymeConcentration", "substrateConcentration", "kmForMorrison", "sets",
  ],
  "spline-lowess": ["y", "method", "f", "spar", "df", "sets"],
  "smooth-differentiate-integrate": ["ys", "x", "operation", "window", "order", "smoothResults", "baseline", "startValue", "sets"],
  "two-way-anova": ["design", "posthoc", "posthocTarget", "sphericity", "control", "fdrMethod", "fdrQ", "sets"],
  "three-way-anova": ["posthoc", "posthocTerm", "posthocScope", "control", "fdrMethod", "fdrQ", "sets"],
  "multiple-t-tests": ["paired", "gaussian", "pooledSd", "correction", "sets"],
  "nested-t-test": ["sets"],
  "nested-anova": ["posthoc", "sets"],
  "correlation-matrix": ["method", "sets"],
  "multiple-regression": ["dependent", "predictors", "sets"],
  "multiple-logistic-regression": ["dependent", "predictors", "sets"],
  "poisson-regression": ["dependent", "predictors", "quasi", "sets"],
  "principal-component-analysis": ["scale", "components", "sets"],
  "k-means": ["clusters", "standardise", "sets"],
  "hierarchical-clustering": ["clusters", "linkage", "distance", "standardise", "sets"],
  "cox-proportional-hazards": ["time", "status", "covariates", "ties", "stratifyBy", "sets"],
  "extract-rearrange": [
    "target", "x", "response", "grouping", "subject", "rowTitles", "rowFactor", "columnFactor", "rowVariable",
    "outcome", "count", "prefixNames", "completeRows", "sets",
  ],
  survival: ["curveTest", "correction", "time", "status", "groupBy", "sets"],
  cox: ["reference", "sets"],
  "chi-square": ["test", "trendOrdered", "sets"],
  mcnemar: ["continuityCorrection", "sets"],
};

/** A value as an error message shows it — short, never a whole table. */
const shortValue = (v: unknown) => {
  const s = typeof v === "string" ? `“${v}”` : (JSON.stringify(v) ?? String(v));
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
};

/** One param value, checked strictly against its kind (the mirror of
 *  `readParam`, which forgives: this one rejects). A choice value matches
 *  case-insensitively and comes back canonical, as the file reader does —
 *  `tails: "Two-Sided"` becomes `"two-sided"`, never a silent default. */
function checkParamValue(kind: ParamKind, key: string, v: unknown): { value: unknown } | { error: string } {
  const bad = (want: string): { error: string } => ({ error: `“${key}” must be ${want} — got ${shortValue(v)}.` });
  if (kind === "yes/no") return typeof v === "boolean" ? { value: v } : bad("true or false");
  if (kind === "number") {
    // `spar`/`df: null` is an explicit "choose automatically" (spline-lowess),
    // not a missing value — same as the file reader.
    if ((key === "spar" || key === "df") && v === null) return { value: null };
    return isFiniteNumber(v) ? { value: v } : bad("a number");
  }
  if (isObj(kind) && isFiniteNumber(kind.min) && isFiniteNumber(kind.max)) {
    if (!isFiniteNumber(v)) return bad("a number");
    if (v < kind.min || v > kind.max)
      return { error: `“${key}” must be between ${kind.min} and ${kind.max} — got ${v}.` };
    return { value: v };
  }
  if (kind === "name") return typeof v === "string" ? { value: v } : bad("a column name (a string)");
  if (kind === "name-or-number")
    return typeof v === "string" || isFiniteNumber(v) ? { value: v } : bad("a column name or a number");
  if (kind === "name-or-names") {
    if (typeof v === "string") return { value: v };
    if (Array.isArray(v) && v.length && v.every((s) => typeof s === "string")) return { value: v };
    return bad("a column name, or a list of column names");
  }
  if (kind === "names") {
    if (Array.isArray(v) && v.length && v.every((s) => typeof s === "string")) return { value: v };
    return bad("a list of column names");
  }
  if (kind === "name-and-names") {
    if (
      isObj(v) &&
      typeof v.name === "string" &&
      Array.isArray(v.levels) &&
      v.levels.length &&
      v.levels.every((s) => typeof s === "string")
    )
      return { value: v };
    return bad("an object with a name and a list of levels, e.g. { name: \"Subject\", levels: [\"S1\", \"S2\"] }");
  }
  if (kind === "numbers-by-name") {
    if (isObj(v) && Object.keys(v).length && Object.values(v).every(isFiniteNumber)) return { value: v };
    return bad("an object of numbers by name, e.g. { \"A\": 10 }");
  }
  if (kind === "number-pairs-by-name") {
    if (
      isObj(v) &&
      Object.keys(v).length &&
      Object.values(v).every((p) => Array.isArray(p) && p.length === 2 && p.every(isFiniteNumber))
    )
      return { value: v };
    return bad("an object of [low, high] number pairs by name");
  }
  if (kind === "texts-by-name") {
    if (isObj(v) && Object.keys(v).length && Object.values(v).every((s) => typeof s === "string")) return { value: v };
    return bad("an object of text by name");
  }
  if (kind === "text-pairs-by-name") {
    if (
      isObj(v) &&
      Object.keys(v).length &&
      Object.values(v).every((p) => Array.isArray(p) && p.length === 2 && p.every((s) => typeof s === "string"))
    )
      return { value: v };
    return bad("an object of [first, second] text pairs by name");
  }
  if (kind === "plot-curves") {
    if (
      Array.isArray(v) &&
      v.length &&
      v.every(
        (c) =>
          isObj(c) &&
          typeof c.label === "string" &&
          isObj(c.params) &&
          Object.values(c.params).every(isFiniteNumber),
      )
    )
      return { value: v };
    return bad("a list of curves, each { label, params } with numeric parameter values");
  }
  if (Array.isArray(kind)) {
    const found = oneOf(kind, v);
    return found !== undefined
      ? { value: found }
      : { error: `“${key}” must be one of: ${kind.join(", ")} — got ${shortValue(v)}.` };
  }
  return bad("a usable value");
}

/** Validate MCP-supplied analysis params strictly: unknown or out-of-range
 *  params are rejected with the valid choices, never silently defaulted.
 *  Returns the errors (empty when valid) and the canonicalised params
 *  (choice values in their canonical case; absent when nothing was passed).
 *  What is NOT checked here, the runners validate themselves and the run
 *  job reports their error: required params (e.g. a binding `model`),
 *  named columns (`y` / `sets` / … — `runAnalysis` rejects a missing one),
 *  and data-dependent gates (three-way ANOVA row bands, nested group
 *  counts). A param this version doesn't know is an error here — unlike the
 *  file reader, which keeps it (FF-F12): an agent's typo must not sail
 *  through as a silently ignored param. */
export function validateAnalysisParams(
  analysisType: string,
  params: unknown,
): { errors: string[]; params?: AnalysisParams } {
  const validKeys = PARAM_KEYS_BY_ANALYSIS[analysisType];
  if (!validKeys) return { errors: [`Unknown analysis type “${analysisType}”.`] };
  if (params === undefined || params === null) return { errors: [] };
  if (!isObj(params))
    return { errors: [`“params” must be an object of named parameters, not ${shortValue(params)}.`] };
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!isIn(PARAMS, key) || !validKeys.includes(key as ParamKey)) {
      errors.push(
        `Unknown parameter “${key}” for “${analysisType}”. “${analysisType}” takes: ${validKeys.join(", ")}.`,
      );
      continue;
    }
    const checked = checkParamValue(PARAMS[key as ParamKey], key, value);
    if ("error" in checked) {
      errors.push(checked.error);
      continue;
    }
    out[key] = checked.value;
  }
  // Per-type choice restrictions (M7): the merged PARAMS lists admit every
  // family's values; each analysis only offers its own.
  const choices = PARAM_CHOICES[analysisType] ?? {};
  for (const [key, allowed] of Object.entries(choices)) {
    const value = out[key];
    if (value !== undefined && typeof value === "string" && !allowed.includes(value)) {
      errors.push(`“${key}” for “${analysisType}” must be one of: ${allowed.join(", ")} — got “${value}”.`);
      delete out[key];
    }
  }
  if (errors.length) return { errors };
  return { errors: [], params: (Object.keys(out).length ? out : undefined) as unknown as AnalysisParams | undefined };
}

/** A saved result is only trusted when it looks like one — an object whose
 *  `testType` is this analysis, with the stats, groups and notes a result
 *  always carries. Anything else is a hand edit or a newer file's shape,
 *  dropped with a warning rather than shown as if it had been computed. */
function readCachedResult(
  raw: unknown,
  analysisType: string,
  label: string,
  issues: ProjectIssue[],
): AnalysisResult | null {
  if (!isObj(raw)) return null;
  const plausible =
    raw.testType === analysisType && Array.isArray(raw.stats) && Array.isArray(raw.groups) && typeof raw.notes === "string";
  if (!plausible) {
    issues.push({
      severity: "warning",
      message: `Analysis “${label}” had a saved result this version couldn't read; it was left out.`,
    });
    return null;
  }
  return raw as unknown as AnalysisResult;
}

function readParams(
  raw: unknown,
  analysisType: string | undefined,
  label: string,
  issues: ProjectIssue[],
): AnalysisParams | undefined {
  if (!isObj(raw)) return undefined;
  const p = canonical(raw, Object.keys(PARAMS));
  // A two-way ANOVA's posthoc used to be one combined string ("tukey groups"):
  // split it into the posthoc and its target, so an old file keeps its
  // comparisons instead of silently falling back to none.
  if (analysisType === "two-way-anova" && typeof p.posthoc === "string") {
    const [posthoc, target] = p.posthoc.split(" ");
    if (
      target !== undefined &&
      oneOf([...ANOVA_POSTHOCS, ...RANK_POSTHOCS], posthoc) !== undefined &&
      oneOf(POSTHOC_TARGETS, target) !== undefined
    ) {
      p.posthoc = posthoc;
      if (p.posthocTarget === undefined) p.posthocTarget = target;
    }
  }
  // A param this version doesn't know is kept verbatim — any JSON value, in its
  // own case (FF-F12): it belongs to a newer Titer (or a hand edit), and this
  // version's runners only ever read the params they know by name, so keeping
  // it can't change what a test computes or reach R.
  const read = (k: string, v: unknown) => {
    if (!isIn(PARAMS, k)) return v;
    const kind = PARAMS[k as ParamKey];
    // FF-F16: a saved number outside its limits is brought within them on
    // load — warn, so the analysis doesn't silently re-run on different
    // parameters than the file specifies. The clamp itself stays: the
    // runner's range is the honest one, the file's value isn't.
    const limits =
      isObj(kind) && isFiniteNumber(kind.min) && isFiniteNumber(kind.max)
        ? { min: kind.min, max: kind.max }
        : undefined;
    if (limits && isFiniteNumber(v)) {
      const clamped = clamp(v, limits);
      if (clamped !== v) {
        issues.push({
          severity: "warning",
          message: `Analysis “${label}”: “${k}” was ${v}, outside ${limits.min}–${limits.max}, so it was brought to ${clamped}.`,
        });
      }
    }
    // `spar`/`df: null` is an explicit "choose automatically" (spline-lowess),
    // not a missing value: keep it, so a save keeps the file as it was.
    if ((k === "spar" || k === "df") && v === null) return null;
    let dropped = 0;
    const value = readParam(PARAMS[k as ParamKey], v, (n) => {
      dropped = n;
    });
    if (dropped > 0) {
      issues.push({
        severity: "warning",
        message: `Analysis “${label}”: ${dropped} invalid ${dropped === 1 ? "entry" : "entries"} in “${k}” ${dropped === 1 ? "was" : "were"} left out; the rest were kept.`,
      });
    }
    return value;
  };
  const sanitized = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, read(k, v)]));
  // A choice from another test's family is left out (M7) — it would be
  // silently reinterpreted by this test's runner — and falls back to the
  // default below, with a warning of its own (not the M5 one).
  const choices = (analysisType ? PARAM_CHOICES[analysisType] : undefined) ?? {};
  const restricted = new Set<string>();
  for (const [key, allowed] of Object.entries(choices)) {
    const value = sanitized[key];
    if (value !== undefined && !allowed.includes(value as string)) {
      issues.push({
        severity: "warning",
        message: `Analysis “${label}”: “${key}” was “${value}”, which this test doesn't offer, so the usual default applies.`,
      });
      delete sanitized[key];
      restricted.add(key);
    }
  }
  // A value the reader left out falls back to its runner default (M5) — a
  // dropped `gaussian` must not silently turn a t test into a Wilcoxon, a
  // dropped `tails` must not reach R as "undefined", a dropped `posthoc`
  // must not silently run Dunn. Only keys the file actually wrote get a
  // substituted default: a key the file never had stays absent — the
  // runner's own fallbacks cover it, and an older file (an outliers
  // analysis with `{q}` only) still opens clean instead of "updated".
  const defaults = (analysisType ? PARAM_DEFAULTS[analysisType] : undefined) ?? {};
  const present = new Set(Object.keys(p));
  const fill = Object.fromEntries(Object.entries(defaults).filter(([k]) => present.has(k)));
  for (const key of Object.keys(p)) {
    if (sanitized[key] === undefined && isIn(PARAMS, key) && key in defaults && !restricted.has(key)) {
      issues.push({
        severity: "warning",
        message: `Analysis “${label}”: “${key}” was not a usable value, so the usual default applies.`,
      });
    }
  }
  // 1.0.9's outliers params carried `grubbs: true` instead of `method: "grubbs"`:
  // translate it on load, so a 1.0.9 file's Grubbs analysis still runs Grubbs
  // (without this it would fall back to ROUT — the runner dispatches on `method`).
  if (analysisType === "outliers" && "grubbs" in sanitized) {
    if ((sanitized as Record<string, unknown>).grubbs === true && sanitized.method === undefined)
      (sanitized as Record<string, unknown>).method = "grubbs";
    delete (sanitized as Record<string, unknown>).grubbs;
  }
  // Strip the left-out values first, so a dropped key falls back to its
  // default instead of shadowing it with `undefined`.
  return defined({ ...fill, ...defined(sanitized) }) as unknown as AnalysisParams;
}

const TRANSFORM_KEYS = ["from", "kind", "control", "within"] satisfies (keyof Transform)[];

/** How a table is computed from another: a known kind, of a table (checked once every
 *  item is read), with the control a percent needs. */
function readTransform(raw: unknown): Transform | undefined {
  if (!isObj(raw)) return undefined;
  const t = canonical(raw, TRANSFORM_KEYS);
  const kind = oneOf(TRANSFORMS, t.kind);
  const control = cellText(t.control);
  if (typeof t.from !== "string" || !kind || (kind === "percent-of-control" && control == null)) return undefined;
  if (kind === "percent-of-control") return { from: t.from, kind, control: control! };
  if (kind === "z-score") return { from: t.from, kind, within: oneOf(Z_WITHIN, t.within) ?? "set" };
  return { from: t.from, kind };
}

/** A sheet's floating notes as a file holds them, forgivingly: a note with no
 *  readable text is left out (a note is its text); an unknown color falls back
 *  to yellow and a missing id is given one, so the note itself survives; a
 *  position that isn't a number lands at the sheet's top-left. Anything
 *  dropped or repaired is warned about once, naming the sheet. An empty list
 *  reads as no notes, like a sheet that never had any. */
function readFloatingNotes(raw: unknown, label: string, issues: ProjectIssue[]): FloatingNote[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    issues.push({
      severity: "warning",
      message: `Sheet “${label}” had floating notes that couldn't be read; they were left out.`,
    });
    return undefined;
  }
  const seen = new Set<string>();
  let dropped = 0;
  let repaired = 0;
  const notes: FloatingNote[] = [];
  for (const entry of raw) {
    if (!isObj(entry) || typeof entry.text !== "string") {
      dropped++;
      continue;
    }
    const id =
      typeof entry.id === "string" && entry.id !== "" ? entry.id : `note_${Math.random().toString(36).slice(2, 10)}`;
    if (seen.has(id)) {
      dropped++;
      continue;
    }
    seen.add(id);
    const color = oneOf(FLOATING_NOTE_COLORS, entry.color);
    // A note off the sheet's top or left edge can't be reached to drag back.
    const x = isFiniteNumber(entry.x) ? Math.max(0, entry.x) : 0;
    const y = isFiniteNumber(entry.y) ? Math.max(0, entry.y) : 0;
    if (color === undefined || !isFiniteNumber(entry.x) || !isFiniteNumber(entry.y)) repaired++;
    notes.push({ id, text: entry.text, color: (color ?? "yellow") as FloatingNoteColor, x, y });
  }
  if (dropped || repaired) {
    issues.push({
      severity: "warning",
      message: `Sheet “${label}” had ${dropped + repaired === 1 ? "a floating note" : `${dropped + repaired} floating notes`} that couldn't be read as saved${
        dropped ? `; ${dropped} ${dropped === 1 ? "was" : "were"} left out` : ""
      }${repaired ? `; ${repaired} ${repaired === 1 ? "was" : "were"} repaired` : ""}.`,
    });
  }
  return notes.length ? notes : undefined;
}

const NODE_TYPES: NodeType[] = ["table", "analysis", "graph", "figure", "info"];

/** An info sheet as a file holds it, forgivingly: constants read as names +
 *  string values, notes as text, and the linked table as an id (checked
 *  against the project's tables in parseProjectFile). Always carries
 *  `linkedTableId` (null when global), so a save/load round-trips clean. */
function readInfoSheet(raw: unknown): InfoSheetData {
  const obj = isObj(raw) ? raw : {};
  return {
    constants: readInfoConstants(obj.constants),
    notes: typeof obj.notes === "string" ? obj.notes : "",
    linkedTableId: typeof obj.linkedTableId === "string" ? obj.linkedTableId : null,
  };
}

/** A figure's fields as a file holds them, forgivingly: a missing or empty
 *  `panels` opens as an empty figure (not an error); a panel out of range is
 *  clamped into the grid; a `dpi` Titer doesn't offer falls back to 600; a
 *  size outside 1–20 in is brought within, and an aspect beyond 4:1 is
 *  reined in by shrinking the longer side. Unknown figure fields are kept
 *  by the node's spread in `readNode` and written back on save. */
function readFigure(
  raw: Obj,
): Pick<ProjectNode, "panels" | "grid" | "figureSize" | "labelStyle" | "figureTitle" | "sharedLegend" | "dpi"> {
  const panels = (Array.isArray(raw.panels) ? raw.panels : [])
    .filter((p): p is Obj => isObj(p) && typeof p.graphId === "string" && p.graphId !== "")
    .map((p) => {
      const n = (k: string) => (isFiniteNumber(p[k]) ? Math.floor(p[k] as number) : undefined);
      return defined({
        graphId: p.graphId as string,
        graphName: typeof p.graphName === "string" ? (p.graphName as string) : undefined,
        label: typeof p.label === "string" ? (p.label as string) : "",
        labelManual: p.labelManual === true || undefined,
        title: typeof p.title === "string" ? (p.title as string) : "",
        row: n("row") ?? 0,
        col: n("col") ?? 0,
        rowSpan: Math.max(1, n("rowSpan") ?? 1),
        colSpan: Math.max(1, n("colSpan") ?? 1),
      }) as FigurePanel;
    });
  const gridRaw = isObj(raw.grid) ? raw.grid : {};
  const cols = isCount(gridRaw.cols) ? (gridRaw.cols as number) : Math.max(1, Math.min(panels.length || 1, 4));
  const rows = isCount(gridRaw.rows) ? (gridRaw.rows as number) : Math.max(1, Math.ceil(panels.length / cols));
  const grid = { rows, cols };
  const clamped = assignLabels(panels.map((p) => clampPanel(p, grid)));
  const sizeRaw = isObj(raw.figureSize) ? raw.figureSize : {};
  const { min, max } = FIGURE_SIZE_LIMITS;
  let widthIn = within(sizeRaw.widthIn, { min, max }) ?? DEFAULT_FIGURE_SIZE.widthIn;
  let heightIn = within(sizeRaw.heightIn, { min, max }) ?? DEFAULT_FIGURE_SIZE.heightIn;
  if (widthIn / heightIn > 4) widthIn = heightIn * 4;
  if (heightIn / widthIn > 4) heightIn = widthIn * 4;
  const styleRaw = isObj(raw.labelStyle) ? raw.labelStyle : {};
  const position = oneOf(["top-left", "top-right", "above-panel"] as const, styleRaw.position) ?? "top-left";
  const fontSizePt = within(styleRaw.fontSizePt, { min: 8, max: 28 }) ?? DEFAULT_LABEL_STYLE.fontSizePt;
  return {
    panels: clamped,
    grid,
    figureSize: { widthIn, heightIn },
    labelStyle: { position, fontSizePt, bold: styleRaw.bold !== false },
    figureTitle: typeof raw.figureTitle === "string" ? raw.figureTitle : "",
    sharedLegend: oneOf(["none", "shared"] as const, raw.sharedLegend) ?? "none",
    dpi: figureDpi(raw.dpi),
  };
}

/** `tableColors`: where a table leaves the colors it kept for its graphs. */
function readNode(
  id: string,
  raw: unknown,
  issues: ProjectIssue[],
  tableColors: Record<string, TableColors>,
): ProjectNode | null {
  if (!isObj(raw)) return null;
  const n = canonical(raw, NODE_KEYS);
  const type = lower(n.type) as NodeType;
  if (!NODE_TYPES.includes(type)) return null;
  const node = {
    ...n,
    id,
    type,
    name: cellText(n.name) ?? "Untitled",
    parentId: typeof n.parentId === "string" ? n.parentId : null,
  } as ProjectNode;
  // Floating notes are the sheet's own (any type): read forgivingly, and leave
  // the field off when the sheet has none, so an older file still opens clean.
  const floatingNotes = readFloatingNotes(n.floatingNotes, node.name, issues);
  if (floatingNotes) node.floatingNotes = floatingNotes;
  else delete node.floatingNotes;
  // A sheet's highlight is its own (any type): an unknown color is dropped
  // and said, so a hand-edited file can't smuggle a value in — and a sheet
  // that was never highlighted reads as before.
  const highlight = oneOf(SHEET_HIGHLIGHTS, n.highlight) as SheetHighlight | undefined;
  if (highlight) node.highlight = highlight;
  else {
    delete node.highlight;
    if (n.highlight !== undefined)
      issues.push({
        severity: "warning",
        message: `Sheet “${node.name}” had a highlight color that couldn't be read; it was left out.`,
      });
  }
  // A note is text, never empty.
  if (typeof n.notes === "string" && n.notes) node.notes = n.notes;
  else delete node.notes;
  // Tags: the known colors it names, once each, in their order.
  const named = Array.isArray(n.tags) ? n.tags.map(lower) : [];
  const tags = (Object.keys(TAG_COLORS) as TagColor[]).filter((c) => named.includes(c));
  if (tags.length) node.tags = tags;
  else delete node.tags;

  if (type === "table") {
    const read = isObj(n.data) ? readData(n.data, lower(n.tableType)) : null;
    if (!read) return null;
    node.data = read.data;
    tableColors[id] = read.colors;
    if (read.beyond) {
      const values = read.beyond === 1 ? "1 value" : `${read.beyond} values`;
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” had ${values} beyond its last column; they were left out.`,
      });
    }
    if (read.regroupDropped.length) {
      const dropped = read.regroupDropped;
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” left out ${dropped.length === 1 ? "a column with values" : `${dropped.length} columns with values`} its groups couldn't hold: ${dropped.join(", ")}.`,
      });
    }
    if (read.rowGroupsDropped.length) {
      const dropped = read.rowGroupsDropped;
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” left out ${dropped.length === 1 ? "a row group" : `${dropped.length} row groups`} it couldn't read: ${dropped.join(", ")}.`,
      });
    }
    node.parentId = null;
    node.transform = readTransform(n.transform);
    if (!node.transform) delete node.transform;
    // A file's stored values are never trusted for a calculated variable:
    // recompute them from the formula on load, so a hand-edited file or an
    // older save still opens with live values (and a broken formula reads
    // as its error, not as stale numbers). A table computed from another
    // never carries formulas — transformTable drops them.
    if (!node.transform && lower(n.tableType) === "multiple") node.data = recomputeCalculated(node.data);
    node.tableType = lower(n.tableType) as ProjectNode["tableType"];
    if (!isIn(TABLES, node.tableType)) {
      issues.push({
        severity: "warning",
        message: `Table “${node.name}” has a type this version doesn't know; it opens as a Column table.`,
      });
      node.tableType = "column";
    }
  } else if (type === "analysis") {
    node.analysisType = lower(n.analysisType) as ProjectNode["analysisType"];
    node.analysisParams = readParams(n.analysisParams, node.analysisType as string, node.name, issues);
    if (!isIn(ANALYSES, node.analysisType)) {
      issues.push({ severity: "error", message: `Analysis “${node.name}” uses a test this version doesn't know.` });
    }
    // Frozen / orphaned results (v2 item 5): the flags only ever mean anything
    // as `true`, the source name only as a string, and a saved result only when
    // it looks like a result of this analysis — anything else is a hand edit or
    // a newer file's field, dropped rather than trusted.
    if (node.frozen !== true) delete node.frozen;
    if (node.orphaned !== true) delete node.orphaned;
    if (typeof node.sourceTableName !== "string") delete node.sourceTableName;
    const cached = readCachedResult(node.cachedResult, node.analysisType as string, node.name, issues);
    if (cached) node.cachedResult = cached;
    else delete node.cachedResult;
  } else if (type === "info") {
    // An info sheet lives at the project root, never under a table.
    node.parentId = null;
    node.info = readInfoSheet(n.info);
  } else if (type === "figure") {
    // A figure may span tables, so it lives at the project root, never under one table.
    node.parentId = null;
    Object.assign(node, readFigure(n));
  } else {
    node.graphType = lower(n.graphType) as ProjectNode["graphType"];
    node.graphOptions = readOptions(n.graphOptions, node.name, issues);
    if (!isIn(GRAPHS, node.graphType) && (node.graphType as string) !== DOSE_GRAPH) {
      issues.push({ severity: "error", message: `Graph “${node.name}” uses a chart this version doesn't know.` });
    }
  }
  if (type !== "table") delete node.transform; // a table's alone
  if (type !== "analysis") {
    // Frozen / orphaned results belong to analyses only: a hand-edited file
    // can't freeze a table or orphan a graph.
    delete node.frozen;
    delete node.orphaned;
    delete node.sourceTableName;
    delete node.cachedResult;
  }
  return node;
}

/** `v` as JSON with its objects' keys in order, to compare contents whatever their order. */
const contents = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) =>
    isObj(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );

// ── Duplicate node ids (FF-F19) ────────────────────────────────────────────
// JSON itself is last-wins on duplicate keys: `JSON.parse` keeps only the
// last `"t1"` in `project.nodes`, so a whole node used to vanish with no
// warning. The duplicates are invisible once parsed, so they are caught here,
// on the file's text, before parsing: each later copy keeps its data under a
// renamed id (`t1__2`, `t1__3`, …) and the open warns about it. The renamed
// copy keeps its own parentId, so it still hangs under its table; a renamed
// table joins the sidebar in creation order, like any table the saved order
// missed. Saving keeps the rescued copy under its new id (`updated` is
// forced), so the file on disk stops losing it. Anything unexpected in the
// text (malformed JSON, missing objects) bails out softly — the file then
// parses exactly as before, and the usual errors speak for it.

/** A key of the `project.nodes` object in the file's text: its id and the span of its quoted spelling. */
type NodeKeySpan = { id: string; start: number; end: number };

/** The keys of the file's `project.nodes` object (its last one, as `JSON.parse` would read it), or `null` when the text isn't shaped like a project file. */
function nodeKeySpans(text: string): NodeKeySpan[] | null {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && /\s/.test(text[i])) i++;
  };
  const readString = (): string | null => {
    if (text[i] !== '"') return null;
    const escapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
    };
    let out = "";
    i++;
    while (i < n) {
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        const esc = text[i + 1];
        if (esc === undefined) return null;
        if (esc === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          out += escapes[esc] ?? esc;
          i += 2;
        }
        continue;
      }
      out += c;
      i++;
    }
    return null;
  };
  /** Skips one JSON value starting at `i`; false when the text isn't valid JSON here. */
  const skipValue = (): boolean => {
    ws();
    const c = text[i];
    if (c === '"') return readString() !== null;
    if (c === "{") return scanObject(() => skipValue());
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return true;
      }
      for (;;) {
        if (!skipValue()) return false;
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return true;
        }
        return false;
      }
    }
    const lit =
      /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(i))?.[0] ??
      /^(?:true|false|null)/.exec(text.slice(i))?.[0];
    if (!lit) return false;
    i += lit.length;
    return true;
  };
  /** Scans one JSON object, calling `onKey` after each key's colon; false when the text isn't valid JSON here. */
  const scanObject = (onKey: (key: string, start: number, end: number) => boolean): boolean => {
    ws();
    if (text[i] !== "{") return false;
    i++;
    ws();
    if (text[i] === "}") {
      i++;
      return true;
    }
    for (;;) {
      ws();
      const start = i;
      const key = readString();
      if (key === null) return false;
      const end = i;
      ws();
      if (text[i] !== ":") return false;
      i++;
      if (!onKey(key, start, end)) return false;
      ws();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return true;
      }
      return false;
    }
  };
  let found: NodeKeySpan[] | null = null;
  ws();
  const ok = scanObject((key) => {
    if (key !== "project") return skipValue();
    let nodes: NodeKeySpan[] | null = null;
    const pok = scanObject((pkey) => {
      if (pkey !== "nodes") return skipValue();
      const spans: NodeKeySpan[] = [];
      const nok = scanObject((id, start, end) => {
        spans.push({ id, start, end });
        return skipValue();
      });
      if (!nok) return false;
      nodes = spans;
      return true;
    });
    if (!pok) return false;
    if (nodes) found = nodes;
    return true;
  });
  return ok ? found : null;
}

/** Renames later copies of a duplicated node id in the file's text so both survive `JSON.parse`, returning the (possibly unchanged) text and what was renamed. */
function rescueDuplicateNodeIds(text: string): { text: string; renamed: { from: string; to: string }[] } {
  const spans = nodeKeySpans(text);
  if (!spans) return { text, renamed: [] };
  const seen = new Set<string>();
  const taken = new Set(spans.map((s) => s.id));
  const edits: { start: number; end: number; to: string }[] = [];
  const renamed: { from: string; to: string }[] = [];
  for (const s of spans) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      continue;
    }
    let k = 2;
    let to = `${s.id}__${k}`;
    while (taken.has(to)) {
      k++;
      to = `${s.id}__${k}`;
    }
    taken.add(to);
    edits.push({ start: s.start, end: s.end, to: JSON.stringify(to) });
    renamed.push({ from: s.id, to });
  }
  if (!edits.length) return { text, renamed: [] };
  let out = text;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.to + out.slice(e.end);
  return { text: out, renamed };
}

/** Reads a `.hlx` file from its text, as `load` does — the same result as `parseProjectFile(JSON.parse(text))`, except a duplicated node id no longer drops a node silently (FF-F19): the later copy is kept under a renamed id and the open warns about it. */
export function parseProjectText(
  text: string,
): { project: ProjectFilePayload; issues: ProjectIssue[]; updated: boolean } | { error: string } {
  const { text: rescued, renamed } = rescueDuplicateNodeIds(text);
  const parsed = parseProjectFile(JSON.parse(rescued));
  if ("error" in parsed || renamed.length === 0) return parsed;
  const byFrom = new Map<string, string[]>();
  for (const { from, to } of renamed) byFrom.set(from, [...(byFrom.get(from) ?? []), to]);
  const warnings: ProjectIssue[] = [...byFrom].map(([from, tos]) => ({
    severity: "warning",
    message:
      tos.length === 1
        ? `Item id “${from}” appears twice in this file; the second copy was kept as “${tos[0]}”.`
        : `Item id “${from}” appears ${tos.length + 1} times in this file; the extra copies were kept as ${tos.map((t) => `“${t}”`).join(", ")}.`,
  }));
  return { ...parsed, issues: [...warnings, ...parsed.issues], updated: true };
}

/** Reads a `.hlx` file forgivingly. `{ error }` only when nothing usable remains;
 *  otherwise the project, what the user should know about it, and whether Titer changed
 *  anything as it read it (`updated`: repaired, or brought up to date from an older Titer),
 *  so saving it keeps the project as it is now. */
export function parseProjectFile(
  raw: unknown,
): { project: ProjectFilePayload; issues: ProjectIssue[]; updated: boolean } | { error: string } {
  if (!isObj(raw)) return { error: "Not a valid Titer project file." };
  const file = canonical(raw, FILE_KEYS);
  // Files from before the rename carry app "helix"; both are accepted.
  if (lower(file.app) !== "helix" && lower(file.app) !== "titer")
    return { error: "This file was not created by Titer." };
  const project = isObj(file.project) ? canonical(file.project, PROJECT_KEYS) : null;
  if (!project || !isObj(project.nodes)) return { error: "This file's project data is missing or corrupted." };

  const issues: ProjectIssue[] = [];
  const nodes: Record<string, ProjectNode> = {};
  const tableColors: Record<string, TableColors> = {};
  let skipped = 0;
  // `__proto__` can't be an item's id: set on an object, it would change what the object is.
  for (const [id, raw] of Object.entries(project.nodes)) {
    const node = id === "__proto__" ? null : readNode(id, raw, issues, tableColors);
    if (node) nodes[id] = node;
    else skipped++;
  }
  /** The item with this id: one of the file's own, never a name every object has ("constructor"). */
  const nodeOf = (id: unknown) => (isIn(nodes, id) ? nodes[id as string] : undefined);
  // Analyses and graphs belong to a table: drop those whose table didn't survive.
  // Figures and info sheets live at the project root (a figure may span tables),
  // so they stay.
  // Orphaned analyses stay too (v2 item 5): their table is gone, and the saved
  // result is what they show. A flag that contradicts a surviving table is
  // cleared instead — the analysis still has its table, so it isn't orphaned.
  for (const node of Object.values(nodes)) {
    if (node.type === "figure" || node.type === "info") continue;
    if (node.type === "analysis" && node.orphaned) {
      if (nodeOf(node.parentId)?.type === "table") {
        delete node.orphaned;
        delete node.sourceTableName;
      } else {
        node.parentId = null;
      }
      continue;
    }
    if (node.type !== "table" && nodeOf(node.parentId)?.type !== "table") {
      delete nodes[node.id];
      skipped++;
    }
  }
  // An info sheet linked to a table that didn't survive becomes project info.
  for (const node of Object.values(nodes)) {
    if (node.type === "info" && node.info?.linkedTableId && nodeOf(node.info.linkedTableId)?.type !== "table") {
      node.info = { ...node.info, linkedTableId: null };
    }
  }
  if (skipped) {
    issues.push({
      severity: "warning",
      message: `${skipped} unreadable item${skipped === 1 ? " was" : "s were"} left out.`,
    });
  }

  // A table computed from another of the file is computed again from it, never from itself
  // (even through others); without its table, it keeps its values, which can then be typed.
  const computed = new Set<string>();
  const compute = (node: ProjectNode, seen: string[]) => {
    if (!node.transform || computed.has(node.id)) return;
    const source = nodeOf(node.transform.from);
    if (source?.type !== "table" || seen.includes(source.id)) return void delete node.transform;
    compute(source, [...seen, source.id]);
    node.tableType = source.tableType;
    node.data = transformTable(source.data!, source.tableType!, node.transform, node.data);
    computed.add(node.id);
  };
  for (const node of Object.values(nodes)) compute(node, [node.id]);

  const fits = fitsFromDoseGraphs(nodes);
  // The retired graph's options, on any graph that still carries them, go:
  // the migration above already took them off the graphs it converted.
  for (const node of Object.values(nodes)) {
    if (node.type !== "graph" || !node.graphOptions) continue;
    for (const key of LEGACY_DOSE_OPTIONS) delete (node.graphOptions as unknown as Obj)[key];
  }
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  const tables = Object.values(nodes).filter((n) => n.type === "table");
  const orphans = Object.values(nodes).filter((n) => n.type === "analysis" && n.orphaned);
  // A file with no tables at all still opens when its orphaned results survive
  // (a project whose tables were all deleted keeps its results, as in Prism);
  // with neither, there is nothing to show.
  if (tables.length === 0 && orphans.length === 0)
    return { error: "This project file has no readable data tables." };
  // Saved order first, then anything the order missed: tables, then info
  // sheets, then figures (figures live at the project root, after the
  // tables, in creation order), then orphaned analyses (they live at the
  // project root too).
  const figures = Object.values(nodes).filter((n) => n.type === "figure");
  const infos = Object.values(nodes).filter((n) => n.type === "info");
  const rootOrder = [
    ...new Set([
      ...ids(project.rootOrder).filter((id) => nodeOf(id)?.type === "table"),
      ...tables.map((t) => t.id),
      ...ids(project.rootOrder).filter((id) => nodeOf(id)?.type === "info"),
      ...infos.map((f) => f.id),
      ...ids(project.rootOrder).filter((id) => nodeOf(id)?.type === "figure"),
      ...figures.map((f) => f.id),
      ...ids(project.rootOrder).filter((id) => nodeOf(id)?.type === "analysis" && nodeOf(id)?.orphaned),
      ...orphans.map((o) => o.id),
    ]),
  ];
  const savedChildren = isObj(project.childOrder) ? project.childOrder : {};
  const childOrder = Object.fromEntries(
    rootOrder
      // Orphaned analyses live at the root but hold no children, so they get no
      // order list (a file that never had one still opens unedited).
      .filter((id) => nodeOf(id)?.type === "table" || nodeOf(id)?.type === "figure")
      .map((tableId) => {
      const children = Object.values(nodes)
        .filter((n) => n.parentId === tableId)
        .map((n) => n.id);
      // A dose-response graph's fit, now an analysis, comes just before it.
      const saved = ids(savedChildren[tableId])
        .flatMap((id) => (fits[id] ? [fits[id], id] : [id]))
        .filter((id) => children.includes(id));
      return [tableId, [...new Set([...saved, ...children])]];
    }),
  );
  const activeNodeId = nodeOf(project.activeNodeId) ? (project.activeNodeId as string) : rootOrder[0];
  const projectName = typeof project.projectName === "string" && project.projectName !== "" ? project.projectName : undefined;

  for (const node of Object.values(nodes)) {
    if (node.type === "figure") {
      // A panel whose graph is gone stays as a placeholder naming the graph;
      // the figure still opens, and export leaves that cell blank.
      const missing = (node.panels ?? []).filter((p) => !nodeOf(p.graphId) || nodeOf(p.graphId)?.type !== "graph");
      if (missing.length)
        issues.push({
          severity: "warning",
          message: `Figure “${node.name}” refers to ${missing.length === 1 ? "a graph" : `${missing.length} graphs`} that no longer exist.`,
        });
      continue;
    }
    if (node.type === "graph") {
      if (!node.graphOptions!.palette) {
        // The file's own options, as saved — the rebuild only fills in what they lack.
        const rawNodes = isObj(project.nodes) ? project.nodes : undefined;
        const rawNodeObj = rawNodes?.[node.id];
        const rawNode = isObj(rawNodeObj) ? canonical(rawNodeObj, NODE_KEYS) : undefined;
        colorsFromTiter1(node, tableColors[node.parentId!]?.series, rawNode?.graphOptions);
      }
      pointsFromCells(node, tableColors[node.parentId!]?.cells);
    }
    const tableType = nodeOf(node.parentId)?.tableType;
    if (node.type !== "graph" || !node.graphType || !tableType) continue;
    if (isIn(GRAPHS, node.graphType) && !GRAPH_OPTIONS_BY_TABLE[tableType].some((o) => o.value === node.graphType)) {
      issues.push({
        severity: "warning",
        message: `Graph “${node.name}” isn't a chart Titer offers for a ${TABLES[tableType].label} table.`,
      });
    }
    const o = node.graphOptions!;
    // (FF-F13) A graph's link to an analysis that no longer exists is
    // cleared on load, not just warned about: the link is unusable (the
    // overlay can never render), keeping it warned on every open and
    // re-saved the dead id forever. Clearing is the repair — the file opens
    // edited, so saving keeps it — and the warning fires once. DECISION:
    // clear, not keep. The figure case above deliberately keeps its dangling
    // refs (a visible placeholder cell, not an invisible link).
    const dangling = GRAPH_ANALYSIS_LINKS.filter((key) => o[key] && !nodeOf(o[key]));
    if (dangling.length) {
      for (const key of dangling) delete (o as unknown as Obj)[key];
      issues.push({
        severity: "warning",
        message: `Graph “${node.name}” referred to an analysis that no longer exists; the link was removed.`,
      });
    }
  }

  // The `template` block (plan 38) is metadata, not project data: a missing
  // or broken block is dropped, never an error, and carrying it is not a
  // repair — a template file still opens unedited.
  const template = parseTemplateInfo(file.template);
  // Unknown keys from the envelopes (FF-F12): the file's own, and the project's —
  // kept on the project so saving writes them back where they came from.
  const fileUnknowns = unknownsOf(file, FILE_KEYS);
  const projectUnknowns = unknownsOf(project, PROJECT_KEYS);
  const read: ProjectFilePayload = {
    nodes,
    rootOrder,
    childOrder,
    activeNodeId,
    ...(template ? { template } : {}),
    ...(projectName ? { projectName } : {}),
    ...(Object.keys(fileUnknowns).length ? { fileUnknowns } : {}),
    ...(Object.keys(projectUnknowns).length ? { projectUnknowns } : {}),
  };
  // `updated` compares what Titer knows only: carrying unknowns through is not
  // a repair, so a newer file that needed no repair still opens unedited.
  const known = { nodes, rootOrder, childOrder, activeNodeId, projectName };
  const filed = Object.fromEntries(PROJECT_KEYS.map((k) => [k, project[k]]));
  return { project: read, issues, updated: contents(known) !== contents(filed) };
}

// ── Dose-response graphs (before Titer 1.0.7) ───────────────────────────
// A "Dose-response curve" graph fitted its own curve. A curve now always comes from an
// analysis, as in Prism: each becomes an XY scatter drawing the curve of a new
// "Nonlinear regression" of the same data set and model, so it looks as it did.

const DOSE_GRAPH = "dose-response";

/** Turns each dose-response graph into a scatter and its fit into an analysis of its
 *  table; returns the new analyses' ids, by graph. */
function fitsFromDoseGraphs(nodes: Record<string, ProjectNode>): Record<string, string> {
  const fits: Record<string, string> = {};
  for (const graph of Object.values(nodes)) {
    if (graph.type !== "graph" || (graph.graphType as string) !== DOSE_GRAPH) continue;
    const { doseY, doseModel, doseShowCurve, doseShowEquation, doseLigandConcentration, ...options } =
      graph.graphOptions as unknown as Obj;
    let id = `analysis_fit_${graph.id}`;
    while (isIn(nodes, id)) id += "_";
    const siblings = Object.values(nodes)
      .filter((n) => n.parentId === graph.parentId)
      .map((n) => n.name);
    let name = "Nonlinear regression";
    for (let i = 2; siblings.includes(name); i++) name = `Nonlinear regression ${i}`;
    nodes[id] = {
      id,
      type: "analysis",
      name,
      parentId: graph.parentId,
      analysisType: "nonlinear-regression",
      // Titer's default then: a 4PL with X as the concentration.
      analysisParams: defined({
        y: typeof doseY === "string" ? doseY : undefined,
        model: oneOf(DOSE_MODELS, doseModel) ?? "sigmoidal-4pl-x",
        // The homologous model needs [L] (plan 28) — the graph carries it in
        // doseLigandConcentration; without it the created analysis errors
        // and the migrated scatter draws points only.
        ...(typeof doseLigandConcentration === "number" && Number.isFinite(doseLigandConcentration)
          ? { ligandConcentration: doseLigandConcentration }
          : {}),
      }),
    };
    graph.graphType = "xy-scatter";
    graph.graphOptions = {
      ...(options as unknown as GraphOptions),
      xyStyle: "points",
      regAnalysisId: id,
      regShowLine: doseShowCurve !== false,
      regShowEquation: doseShowEquation !== false,
    };
    fits[graph.id] = id;
  }
  return fits;
}

// ── Files from Titer 1.0 ─────────────────────────────────────────────────
// A graph's colors came from its table (`seriesColors`, named colors), a heatmap
// had one of three color scales, and a volcano two named colors. A graph saved
// without a palette gets them back as its own, so it looks as it did: the Titer
// palette with its table's colors, or its heatmap scale as Plotly drew it.

/** The heatmap scales of Titer 1.0 that the catalog doesn't have, as Plotly defines them. */
const HEATMAP_SCALES: Record<string, { name: string; kind: PaletteKind; stops: [number, string][] }> = {
  "red-blue": {
    name: "Red/Blue (Titer 1.0)",
    kind: "diverging",
    stops: [
      [0, "#050AAC"],
      [0.35, "#6A89F7"],
      [0.5, "#BEBEBE"],
      [0.6, "#DCAA84"],
      [0.7, "#E6915A"],
      [1, "#B20A1C"],
    ],
  },
  "yellow-red": {
    name: "Heat (Titer 1.0)",
    kind: "sequential",
    stops: [
      [0, "#800026"],
      [0.125, "#BD0026"],
      [0.25, "#E31A1C"],
      [0.375, "#FC4E2A"],
      [0.5, "#FD8D3C"],
      [0.625, "#FEB24C"],
      [0.75, "#FED976"],
      [0.875, "#FFEDA0"],
      [1, "#FFFFCC"],
    ],
  },
};

/** A scale's stops as 256 evenly spaced colors, blended as Plotly blends them. */
function resample(stops: [number, string][]): string[] {
  const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Array.from({ length: 256 }, (_, i) => {
    const t = i / 255;
    const j = Math.max(
      1,
      stops.findIndex(([at]) => at >= t),
    );
    const [[a, from], [b, to]] = [stops[j - 1], stops[j]];
    const f = (t - a) / (b - a);
    const [c0, c1] = [channels(from), channels(to)];
    return (
      "#" +
      c0
        .map((c, k) =>
          Math.round(c + (c1[k] - c) * f)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
        .toUpperCase()
    );
  });
}

const LEGACY_OPTIONS = ["heatmapColorScale", "volcanoColorUp", "volcanoColorDown", "volcanoPointSize"];

/** A graph without a palette gets Titer 1.0's colors back as its own — but only
 *  for what the file never saved (`saved`: its options as the file held them).
 *  A graph that saved its fill, point size, outline, bar gap or series keeps
 *  them; the rebuild fills in the rest, so a missing palette alone never
 *  rewrites a graph's own options. */
function colorsFromTiter1(node: ProjectNode, tableColors: Record<string, PaletteColor> | undefined, saved: unknown) {
  const all = node.graphOptions as unknown as Obj;
  const old = canonical(all, LEGACY_OPTIONS);
  const named = (v: unknown, fallback: PaletteColor) => (isNamed(lower(v)) ? (lower(v) as PaletteColor) : fallback);
  let palette = savedPalette(paletteNamed("titer")!);
  let colors = tableColors;
  if (node.graphType === "heatmap") {
    const name = lower(old.heatmapColorScale);
    const scale = isIn(HEATMAP_SCALES, name) ? HEATMAP_SCALES[name as string] : undefined;
    palette = scale
      ? { name: scale.name, kind: scale.kind, colors: resample(scale.stops) }
      : savedPalette(paletteNamed("viridis")!);
  } else if (node.graphType === "volcano") {
    colors = { down: named(old.volcanoColorDown, "blue"), up: named(old.volcanoColorUp, "red") };
  }
  const series =
    colors && Object.fromEntries(Object.entries(colors).map(([key, c]) => [key, { color: NAMED_COLORS[c] }]));
  const legacy = (k: string) => LEGACY_OPTIONS.some((o) => o.toLowerCase() === k.toLowerCase());
  const options = Object.fromEntries(Object.entries(all).filter(([k]) => !legacy(k)));
  // Titer 1.0 filled shapes and points half-opaque (a pie's and a volcano's, their type's
  // fill), and set a row's bars side by side; its points had their type's size and
  // outline (a volcano, the size set on it, within what Titer offers).
  const { defaults } = isIn(GRAPHS, node.graphType) ? GRAPHS[node.graphType!] : {};
  const pointSize = within(old.volcanoPointSize, GRAPH_LIMITS.pointSize);
  const fills = { fill: defaults?.fill ?? 0.5, pointFill: defaults?.pointFill ?? 0.5 };
  // What the file saved, spelled as Titer writes it: the options above already
  // hold the global defaults for what it didn't, so only this tells the two apart.
  const savedKeys = new Set(
    isObj(saved)
      ? Object.keys(canonical(saved, [...Object.keys(DEFAULT_GRAPH_OPTIONS), ...Object.keys(OPTIONAL_OPTIONS)]))
      : [],
  );
  const titer1: Obj = { ...options };
  for (const [key, value] of Object.entries({ ...defaults, ...fills })) {
    if (!savedKeys.has(key)) titer1[key] = value;
  }
  if (pointSize !== undefined && !savedKeys.has("pointSize")) titer1.pointSize = pointSize;
  if (!savedKeys.has("barGap")) titer1.barGap = 0;
  if (series && !savedKeys.has("series")) titer1.series = series;
  titer1.palette = palette;
  node.graphOptions = defined(titer1) as unknown as GraphOptions;
}

/** Points colored in their table's cells (before Titer 1.0.3) keep their color on
 *  each of its graphs, under any style the graph gives them itself. */
function pointsFromCells(node: ProjectNode, cells: Record<string, PaletteColor> | undefined) {
  if (!cells) return;
  const options = node.graphOptions!;
  const colored = Object.fromEntries(Object.entries(cells).map(([key, c]) => [key, { color: NAMED_COLORS[c] }]));
  node.graphOptions = { ...options, points: { ...colored, ...options.points } };
}
