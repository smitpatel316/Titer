// The questions each analysis asks before it runs, as Prism does: one question per
// step, each answer choosing the next question. A wizard only declares its questions
// and how the answers make the test's params; analysis-wizard.tsx asks them.
// A test without an entry here runs as soon as it is picked.
import { DOSE_MODELS, CONCENTRATION_UNITS, GOF_EXPECTED_MODES, MONTE_CARLO_REPEATS, MONTE_CARLO_TARGET_STATISTICS, MULTIFACTOR_MAX_FACTORS, NONLINEAR_MODELS, PAIR_CORRECTIONS, ROUT_Q, fdrQError, isFdrPValueMethod, pValueAlphaError, routQError, type ConcentrationUnit, type LinearRegressionParams, type MonteCarloParams, type MonteCarloSimulationDistribution, type MonteCarloStatistic, type MonteCarloTarget, type NonlinearModel, type PValueStackParams } from "../../stats/types";
import type { PlotFunctionExtra, PlotFunctionModel } from "../../stats/types";
import {
  PLOT_FUNCTION_DEFAULTS,
  PLOT_FUNCTION_LABEL,
  PLOT_FUNCTION_MAX_CURVES,
  PLOT_FUNCTION_MODELS,
  PLOT_FUNCTION_SEGMENTS,
  plotFunctionParams,
  plotFunctionXRange,
} from "../../stats/xy/plot-function";
import { hasXColumn, type RowGroup, type TableType, type Transform } from "../../store/types";
import { MODEL_LABEL, termLabel } from "../../stats/xy/nonlinear-regression";
import { modelSpec } from "../../stats/xy/nonlinear-fit";
import { parseCustomParameters, parseUserEquation } from "../../stats/xy/user-defined";
import { isArithmeticTransform } from "../../stats/column/transform-data";
import { pairedDifferences } from "../../stats/simulation/monte-carlo";
import { dataGroups, incompleteRows, pairedGroups, pairIndices } from "../../stats/column/base";
import { flattenThreeWay, groupRows, rowGroupBands, rowName, threeWayTermCells } from "../../stats/grouped/base";
import { distinctTruthValues } from "../../stats/column/roc-curve";

const isDoseModel = (m: string) => (DOSE_MODELS as readonly string[]).includes(m);
import {
  floorToWidth,
  niceWidthUp,
  sturgesCount,
} from "../../stats/column/frequency-distribution";
import type {
  AnalysisParams,
  AnalysisPickerValue,
  AnalysisType,
  BindingKineticsParams,
  BindingSaturationParams,
  ChiSquareGofParams,
  ChiSquareParams,
  CompareTwoGroupsParams,
  CorrelationParams,
  CoxPHParams,
  DoseResponseSpecialParams,
  EnzymeInhibitionParams,
  ExtractRearrangeParams,
  FrequencyDistributionParams,
  MultipleTTestsParams,
  MultifactorAnovaParams,
  NestedAnovaParams,
  NonlinearRegressionParams,
  NormalizeParams,
  OneSampleTParams,
  OneSampleKsParams,
  RemoveBaselineParams,
  PruneRowsParams,
  FractionOfTotalParams,
  PlotFunctionParams,
  RowMeansTotalsParams,
  SurvivalParams,
  CoxParams,
  HclustParams,
  PrincipalComponentAnalysisParams,
  ShapiroWilkParams,
  SplineLowessParams,
  SmoothDifferentiateIntegrateParams,
  ThreeWayAnovaParams,
  TransformFunction,
  TransformConcentrationsParams,
  TwoWayAnovaParams,
  XYCorrelationParams,
} from "../../stats/types";
import { parseInhibitorConcentration } from "../../stats/xy/enzyme-inhibition";
import { multifactorTerms } from "../../stats/multiple/multifactor-anova";
import { columnFactorName } from "../../stats/mixed/mixed-effects";
import { levelsOf, splitXY, type Dataset } from "../../lib/dataset";
import { pairKey } from "../../lib/columns";
import { constantRefName, isConstantRef } from "../../lib/info-sheets";

export type Answer = string | number | string[];
export type Answers = Record<string, Answer | undefined>;

export type Question = { id: string; ask: string } & (
  | {
      kind: "choice";
      options: { value: string; label: string }[];
      /** Adds "Not sure — check for normality first", answered "yes" or "no" by Shapiro-Wilk. */
      normality?: boolean;
      /** What the wizard says when this choice has no options (M18): the step
       *  is blocked with this message instead of throwing. */
      emptyMessage?: string;
    }
  | {
      kind: "number";
      label: string;
      initial: number;
      min?: number;
      max?: number;
      step?: number;
      validate?: (value: number) => string | undefined;
    }
  /** Several of `options`, all ticked at first: at least `min` (1 by default). */
  | { kind: "names"; options: string[]; min?: number }
  /** Free text, a single line — the answer is the raw string. `parse` checks
   *  it before Next is allowed (blank counts as valid when `parse` says so);
   *  without it, the text must parse as comma-separated numbers. */
  | { kind: "text"; label: string; initial: string; placeholder?: string; parse?: (text: string) => { error?: string } }
);

/** Parse a comma-separated list of numbers (the default check for a `text`
 *  question without its own `parse` — see analysis-wizard.tsx).
 *  Empty entries are ignored; a non-numeric entry, or an empty list, is an
 *  error naming the problem. */
export function parseUnknowns(text: string): { values: number[]; error?: string } {
  const entries = text
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (!entries.length) return { values: [], error: "Enter at least one unknown Y value." };
  const bad = entries.find((e) => !Number.isFinite(Number(e)));
  if (bad !== undefined)
    return { values: [], error: `“${bad}” is not a number — enter unknown Y values separated by commas.` };
  return { values: entries.map(Number) };
}

export interface Wizard {
  /** Every question, given the answers so far (false: not asked with these answers).
   *  `rowGroups` is a grouped table's third-factor bands (the three-way ANOVA's
   *  factor C): only the three-way wizard needs it, for its Dunnett-control options. */
  questions: (a: Answers, table: Dataset, type?: TableType, rowGroups?: RowGroup[]) => (Question | false)[];
  /** The test to create, once every question is answered. */
  finish: (a: Answers, table: Dataset, type?: TableType) => { type: AnalysisType; params?: AnalysisParams };
}

/** Parse a comma-separated list of expected values (chi-square goodness of
 *  fit): every entry a finite number above 0 — a category the theory says
 *  never occurs can't be tested this way (the runner says so too, and also
 *  checks the counts add up to the observed total, the percentages to 100). */
export function parseExpectedValues(text: string): { values: number[]; error?: string } {
  const entries = text
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (!entries.length)
    return { values: [], error: "Enter the expected values, one per category, separated by commas." };
  const bad = entries.find((e) => !Number.isFinite(Number(e)));
  if (bad !== undefined)
    return { values: [], error: `“${bad}” is not a number — enter the expected values separated by commas.` };
  const values = entries.map(Number);
  if (values.some((v) => v <= 0)) return { values: [], error: "Every expected value must be above 0." };
  return { values };
}

/** Parse the spline's spar field: blank = automatic (GCV), otherwise a number
 *  in 0–1.5. `value` is null when blank; `error` is set (and `value` null) when
 *  the text is neither — the runner re-checks, so a bad value passed straight
 *  to `runAnalysis` still fails clearly. */
export function parseSpar(text: string): { value: number | null; error?: string } {
  const t = text.trim();
  if (t === "") return { value: null };
  const v = Number(t);
  if (!Number.isFinite(v))
    return {
      value: null,
      error: `“${t}” is not a number — enter a smoothing parameter between 0 and 1.5, or leave it blank.`,
    };
  if (v < 0 || v > 1.5) return { value: null, error: "The smoothing parameter (spar) must be between 0 and 1.5." };
  return { value: v };
}

/** Parse an optional positive number (the binding kinetics constants):
 *  blank = not supplied, otherwise a number > 0. `value` is undefined when
 *  blank; `error` is set (and `value` undefined) when the text is neither —
 *  the runner re-checks, so a bad value passed straight to `runAnalysis`
 *  still fails clearly. */
export function parseOptionalPositive(text: string, label: string): { value?: number; error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: `“${t}” is not a number — enter a ${label}, or leave it blank.` };
  if (v <= 0) return { error: `The ${label} must be greater than 0.` };
  return { value: v };
}

/** Parse an optional number (a fixed parameter, plan 26): blank = fit it,
 *  otherwise a finite number. `value` is undefined when blank; `error` is
 *  set (and `value` undefined) when the text is neither — the runner
 *  re-checks, so a bad value passed straight to `runAnalysis` still fails
 *  clearly. */
export function parseOptionalNumber(text: string, label: string): { value?: number; error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: `“${t}” is not a number — enter a ${label}, or leave it blank to fit it.` };
  return { value: v };
}

/** Parse optional bounds "lower, upper" (plan 26): blank = unbounded,
 *  otherwise two numbers with lower < upper. */
export function parseOptionalBounds(text: string, label: string): { value?: [number, number]; error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const parts = t.split(",").map((p) => p.trim());
  if (parts.length !== 2)
    return { error: `Enter ${label} bounds as “lower, upper” (e.g. “0, 2”), or leave it blank for unbounded.` };
  const [lo, hi] = parts.map(Number);
  if (!Number.isFinite(lo) || !Number.isFinite(hi))
    return { error: `“${t}” is not two numbers — enter bounds as “lower, upper”, or leave it blank.` };
  if (lo >= hi) return { error: `The lower bound (${lo}) must be below the upper bound (${hi}).` };
  return { value: [lo, hi] };
}

/** A `{{Name}}` reference is valid wherever a number is asked — an
 *  info-constant hook. The wizard stores the raw text and `finish` separates
 *  hooks from numbers, so a hooked value resolves live at run time. Blank
 *  stays valid for optional fields. */
export function parseHookableNumber(text: string, label: string): { error?: string } {
  const t = text.trim();
  if (t === "" || isConstantRef(t)) return {};
  return parseOptionalNumber(t, label);
}

/** A number that must be supplied, or a `{{Name}}` hook. */
export function parseHookableRequiredNumber(text: string, label: string): { error?: string } {
  const t = text.trim();
  if (isConstantRef(t)) return {};
  if (t === "") return { error: `Enter a ${label} — or {{Constant name}} from an info sheet.` };
  return parseOptionalNumber(t, label);
}

/** Bounds "lower, upper" where either side may be a `{{Name}}` hook. */
export function parseHookableBounds(text: string, label: string): { error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const parts = t.split(",").map((p) => p.trim());
  if (parts.length !== 2)
    return { error: `Enter ${label} bounds as “lower, upper” (e.g. “0, 2”), or leave it blank for unbounded.` };
  for (const side of parts) {
    if (side === "" || isConstantRef(side) || Number.isFinite(Number(side))) continue;
    return { error: `“${side}” is not a number or a {{Constant name}} — enter bounds as “lower, upper”.` };
  }
  return {};
}

/** A required positive number, or a `{{Name}}` hook. */
export function parseHookableRequiredPositive(text: string, label: string): { error?: string } {
  const t = text.trim();
  if (isConstantRef(t)) return {};
  return parseRequiredPositive(t, label);
}

/** A wizard's constant answer (a number, or a `{{Name}}` hook) as params:
 *  the hook field when it names a constant, else the number. */
function constantParam(raw: unknown): { constant?: number; constantHook?: string } {
  const hook = constantRefName(String(raw ?? ""));
  if (hook) return { constantHook: hook };
  const n = Number(raw);
  return Number.isFinite(n) ? { constant: n } : {};
}
function zeroConstantParam(raw: unknown): { zeroConstant?: number; zeroConstantHook?: string } {
  const hook = constantRefName(String(raw ?? ""));
  if (hook) return { zeroConstantHook: hook };
  const n = Number(raw);
  return Number.isFinite(n) ? { zeroConstant: n } : {};
}
function hundredConstantParam(raw: unknown): { hundredConstant?: number; hundredConstantHook?: string } {
  const hook = constantRefName(String(raw ?? ""));
  if (hook) return { hundredConstantHook: hook };
  const n = Number(raw);
  return Number.isFinite(n) ? { hundredConstant: n } : {};
}

/** Parse a required positive number (association-then-dissociation's
 *  HotNM / Time0): blank is an error — the wizard must not proceed without it. */
export function parseRequiredPositive(text: string, label: string): { value?: number; error?: string } {
  const t = text.trim();
  if (t === "") return { error: `Enter a ${label} — it is required for this model.` };
  const parsed = parseOptionalPositive(t, label);
  return parsed.error ? parsed : { value: parsed.value };
}

/** Parse a required non-negative number (an inhibitor concentration — 0 is
 *  the uninhibited series): blank is an error — the wizard must not
 *  proceed without it. */
export function parseRequiredNonNegative(text: string, label: string): { value?: number; error?: string } {
  const t = text.trim();
  if (t === "") return { error: `Enter a ${label} — it is required.` };
  const v = Number(t);
  if (!Number.isFinite(v)) return { error: `“${t}” is not a number — enter a ${label}.` };
  if (v < 0) return { error: `The ${label} cannot be negative.` };
  return { value: v };
}

/** Split a comma-separated per-row group-level list (the mixed-effects
 *  subject factor): one level per table row, in row order. */
export function splitGroupLevels(text: string): string[] {
  return text.split(",").map((e) => e.trim());
}

/** Validate a per-row group-level list against the table's row count: blank
 *  is an error (the wizard must not proceed without it), as is a count that
 *  does not match the rows, a blank level, or a single distinct level. */
export function parseGroupLevels(text: string, rowCount: number): { values: string[]; error?: string } {
  const levels = splitGroupLevels(text);
  if (levels.length === 1 && levels[0] === "") {
    return { values: [], error: `Enter one group level per row (${rowCount} rows), separated by commas.` };
  }
  if (levels.length !== rowCount) {
    return {
      values: [],
      error: `Enter one group level per row — found ${levels.length} for ${rowCount} rows.`,
    };
  }
  const blank = levels.findIndex((l) => l === "");
  if (blank !== -1) {
    return { values: [], error: `Every row needs a group level — row ${blank + 1} is blank.` };
  }
  if (new Set(levels).size < 2) {
    return { values: [], error: `The group factor needs at least two levels — all rows are “${levels[0]}”.` };
  }
  return { values: levels };
}

export interface Wizard {
  /** Every question, given the answers so far (false: not asked with these answers).
   *  `tableType` scopes the questions to the table's kind (the Monte Carlo
   *  wizard offers different targets for Column and XY tables); wizards that
   *  don't need it ignore it, and callers without a table pass none.
   *  `rowGroups` is a grouped table's third-factor bands (the three-way ANOVA's
   *  factor C): only the three-way wizard needs it, for its Dunnett-control options. */
  questions: (a: Answers, table: Dataset, tableType?: TableType, rowGroups?: RowGroup[]) => (Question | false)[];
  /** The test to create, once every question is answered. */
  finish: (a: Answers, table: Dataset, tableType?: TableType) => { type: AnalysisType; params?: AnalysisParams };
  /** The assumptions checklist for the test this wizard is building, given
   *  the answers so far — so the checklist follows the branch taken (a
   *  parametric answer gets the t-test checklist, a non-parametric one the
   *  rank-test checklist). Absent: the wizard has no checklist yet, and the
   *  setup shows none. */
  checklist?: (a: Answers, table: Dataset, tableType?: TableType) => AnalysisChecklist | undefined;
}

/** One line of an analysis checklist: an assumption to check before running
 *  the test, and what it means (or what to do instead) when it does not hold.
 *  Content is written from the statistical definitions, in our own words. */
export interface ChecklistItem {
  /** The assumption or condition, in plain words. */
  assumption: string;
  /** What it means / what to do instead when it does not hold. */
  ifNot?: string;
}

/** A checklist for one analysis: when the test is the right one, and the
 *  assumptions to check before running it. Shown in the setup wizard,
 *  alongside the questions — not buried in the results. */
export interface AnalysisChecklist {
  /** Short heading, e.g. "One-sample t test — checklist". */
  title: string;
  /** When this test is the right one. */
  whenToUse: string;
  items: ChecklistItem[];
}

const choice = (
  id: string,
  ask: string,
  options: [string, string][],
  normality = false,
  emptyMessage?: string,
): Question => ({
  id,
  ask,
  kind: "choice",
  options: options.map(([value, label]) => ({ value, label })),
  normality,
  ...(emptyMessage ? { emptyMessage } : {}),
});

const names = (list: string[]) => list.map((n): [string, string] => [n, n]);

/** The Y data sets to fit, all ticked at first (asked when there is a choice); one answered
 *  is the regression's `y`, several its `ys`. A lone `y` answer (the pre-1.0.9 shape, and
 *  what a caller passing one data set writes) counts as that one set. */
const ysQuestion = (table: Dataset, ask: string): Question | false =>
  yNames(table).length > 1 && { id: "ys", ask, kind: "names", options: yNames(table), min: 1 };
const fittedYs = (a: Answers) => {
  const ys = (a.ys as string[] | undefined) ?? (a.y !== undefined ? [a.y as string] : undefined);
  return ys === undefined ? {} : ys.length === 1 ? { y: ys[0] } : { ys };
};
const yNames = (table: Dataset) => splitXY(table.columns).ys.map((c) => c.name);
const dataNames = (table: Dataset) => table.numeric.map((c) => c.name);

/** The levels of the named column (distinct non-blank cell texts, first-appearance
 *  order) — a grouping variable's levels, or [] when the column is not there. */
const levelsOfName = (table: Dataset, name: string | undefined): string[] => {
  const column = name === undefined ? undefined : table.columns.find((c) => c.name === name);
  return column ? levelsOf(column) : [];
};

/** The variables with exactly two levels — a t test's grouping-variable candidates. */
const twoLevelNames = (table: Dataset, exclude?: string) =>
  table.columns.filter((c) => c.name !== exclude && levelsOf(c).length === 2).map((c) => c.name);

/** The variables with at least two levels — a survival analysis's grouping candidates. */
const groupingNames = (table: Dataset, exclude?: (string | undefined)[]) =>
  table.columns
    .filter((c) => !(exclude ?? []).includes(c.name) && levelsOf(c).length >= 2)
    .map((c) => c.name);

/** The numeric variables holding only 0/1 — a survival analysis's event-code candidates
 *  (or every numeric variable, when none is binary: the runner then says so). */
const binaryNames = (table: Dataset, exclude?: string) => {
  const binary = table.numeric
    .filter((c) => c.name !== exclude && c.values.length > 0 && c.values.every((v) => v === 0 || v === 1))
    .map((c) => c.name);
  return binary.length > 0 ? binary : dataNames(table).filter((n) => n !== exclude);
};

// Which data sets a test runs on (`sets`), asked first as in Prism, and only when there
// is a choice: columns, or a grouped table's groups, holding numbers.
const setNames = (table: Dataset) =>
  table.sets.filter((s) => s.columns.some((c) => c.values.length > 0)).map((s) => s.name);

/** The two data sets to compare, in order. */
const twoSets = (a: Answers, table: Dataset): Question[] => {
  const sets = setNames(table);
  if (sets.length <= 2) return [];
  return [
    choice("set1", "Which is the first data set?", names(sets)),
    choice("set2", "Which is the second data set?", names(sets.filter((n) => n !== a.set1))),
  ];
};

/** The data sets to analyze, at least `min`, all ticked at first. */
const someSets = (table: Dataset, min: number): Question[] => {
  const sets = setNames(table);
  if (sets.length <= min) return [];
  const ask = min > 1 ? `Choose the data sets to analyze (at least ${min}).` : "Choose the data sets to analyze.";
  return [{ id: "sets", ask, kind: "names", options: sets, min }];
};

/** The one data set a test reads, asked as a single choice only when there
 *  is a choice: the observed-vs-expected tests (chi-square goodness of fit,
 *  the binomial test) read exactly one data set — `someSets` would let the
 *  user tick two and the runner would have to refuse them. */
const oneSet = (table: Dataset): Question | false => {
  const sets = setNames(table);
  return sets.length > 1 && choice("set", "Which data set holds the observed counts?", names(sets));
};

/** `params` with the one data set answered (`oneSet` above). */
const withOneSet = <P extends object>(a: Answers, params?: P) => {
  const set = a.set as string | undefined;
  return set !== undefined ? { ...params, sets: [set] } : params;
};

/** The answers of the data set questions `wizard` asks first, given the data sets to analyze
 *  (a graph's): them all to tick, or the first two as the two compared. */
export function answersFor(wizard: Wizard, table: Dataset, tableType: TableType | undefined, sets?: string[]): Answers {
  if (!sets) return {};
  const asked = new Set(wizard.questions({}, table, tableType).flatMap((q) => (q ? [q.id] : [])));
  if (asked.has("sets")) return { sets };
  if (asked.has("set1") && sets.length >= 2) return { set1: sets[0], set2: sets[1] };
  return {};
}

/** How a table computed from this one transforms its values (lib/transform.ts): a percent
 *  asks of which data set, a z-score within what. An XY table's X is never one. */
export const TRANSFORM_WIZARD = {
  questions: (a: Answers, table: Dataset, type?: TableType): (Question | false)[] => [
    choice("kind", "How should the values be transformed?", [
      ["log10", "Logarithm, base 10"],
      ["log2", "Logarithm, base 2"],
      ["ln", "Natural logarithm (ln)"],
      ["normalize", "Normalize each data set: its smallest value 0 %, its largest 100 %"],
      ["percent-of-control", "Percent of a control data set's mean"],
      ["z-score", "Z-scores: how many SDs each value lies from the mean"],
    ]),
    a.kind === "percent-of-control" &&
      choice(
        "control",
        type === "grouped" || type === "xy"
          ? "Which data set is the control? Each value is a percent of its mean in the same row."
          : "Which data set is the control?",
        names(setNames(table).filter((n) => !(type && hasXColumn(type) && n === table.sets[0]?.name))),
      ),
    a.kind === "z-score" &&
      choice("within", "Z-scores within what?", [
        ["set", "Each data set: its own mean and SD"],
        ["row", "Each row: its own mean and SD (genes on a heatmap, say)"],
      ]),
  ],
  finish: (a: Answers): Omit<Transform, "from"> => {
    const kind = a.kind as Transform["kind"];
    if (kind === "percent-of-control") return { kind, control: a.control as string };
    if (kind === "z-score") return { kind, within: a.within === "row" ? "row" : "set" };
    return { kind };
  },
};

/** The names ticked once `name` is ticked (`on`) or not: always in `options`' order,
 *  the table's, whatever order they were clicked in. */
export const toggled = (options: string[], ticked: string[], name: string, on: boolean) =>
  options.filter((n) => (n === name ? on : ticked.includes(n)));

/** Every pair of `sets`, as a wizard lists it ("A vs. B") and as params keep it (`pairKey`). */
const pairLabels = (sets: string[]) =>
  pairIndices(sets.length).map(([i, j]) => ({ label: `${sets[i]} vs. ${sets[j]}`, key: pairKey(sets[i], sets[j]) }));

/** Whether a post-hoc compares chosen pairs (Bonferroni, Šídák, Holm–Šídák, Fisher's LSD). */
const isPairCorrection = (posthoc: unknown) => (PAIR_CORRECTIONS as readonly unknown[]).includes(posthoc);

/** Whether some subjects (rows) hold values in some of the data sets but not all. */
const gaps = (table: Dataset, sets?: string[]) =>
  incompleteRows(table.numeric.filter((c) => !sets || sets.includes(c.set ?? c.name))) > 0;

/** A contingency table's shape: columns, and the fewest complete rows among them. */
const contingencyShape = (table: Dataset) => {
  const columns = table.numeric.filter((c) => c.values.some((v) => v !== null));
  return [columns.length, Math.min(...columns.map((c) => c.byRow.filter((v) => v !== null).length))];
};

/** A column's observed mean and (sample, n − 1) SD — a Monte Carlo wizard's
 *  starting values for the simulated mean/SD. */
const meanSd = (values: number[]) => {
  const mean = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const sd =
    values.length > 1
      ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1))
      : 0;
  return { mean, sd };
};

/** 6 significant digits — a readable starting value for a simulated mean/SD. */
const round6 = (v: number) => Number(v.toPrecision(6));

/** A grouped table's rows holding data, by the names results give them. */
const dataRows = (table: Dataset) =>
  table.titles.flatMap((_, r) => (table.numeric.some((c) => c.byRow[r] != null) ? [rowName(table.titles, r)] : []));

/** A grouped table's cells holding data, by the names results give them ("Group (Row)"). */
const cellNames = (table: Dataset, groups: string[]) => {
  const rows = groupRows(table.columns);
  return groups.flatMap((group) =>
    table.titles.flatMap((_, r) => (rows.get(group)?.[r]?.length ? [`${group} (${rowName(table.titles, r)})`] : [])),
  );
};

/** A three-way term's Dunnett-control options, from the same cells the runner
 *  compares: the whole term's cell labels, or — for simple effects — the first
 *  factor's levels within each level of the term's last factor. Undefined when
 *  the table has no row bands (the wizard cannot know factor C's levels). */
const threeWayControlOptions = (a: Answers, table: Dataset, rowGroups?: RowGroup[]): string[] | undefined => {
  const bands = rowGroupBands(rowGroups);
  if (!bands) return undefined;
  const term = (a.posthocTerm as string | undefined) ?? "A";
  const cells = threeWayTermCells(term, flattenThreeWay(table.columns, bands), table.titles);
  const simple = a.posthocScope === "simple" && term.includes(":");
  return simple ? [...new Set(cells.map((c) => c.within))] : cells.map((c) => c.label);
};

/** Whether a grouped table holds replicates: a group with 2 values or more at a row. */
const replicated = (table: Dataset) =>
  table.sets.some((s) => s.columns[0]?.byRow.some((_, r) => s.columns.filter((c) => c.byRow[r] != null).length > 1));

/** The data sets answered, if they were asked. */
export const chosenSets = (a: Answers): string[] | undefined =>
  a.set1 && a.set2 ? [a.set1 as string, a.set2 as string] : (a.sets as string[] | undefined);

/** `params` with the data sets answered. */
const withSets = <P extends object>(a: Answers, params?: P) => {
  const sets = chosenSets(a);
  return sets ? { ...params, sets } : params;
};

/** The FDR approach's follow-ups, asked when a post-hoc is the FDR approach:
 *  which method, and at which Q (%) a comparison counts as a discovery. */
const fdrQuestions = (a: Answers): (Question | false)[] => [
  a.posthoc === "fdr" &&
    choice("fdrMethod", "Which false-discovery-rate method?", [
      ["bh", "Benjamini-Hochberg (recommended)"],
      ["bky", "Benjamini-Krieger-Yekutieli (two-stage — more power)"],
      ["by", "Benjamini-Yekutieli (valid under any dependence)"],
    ]),
  a.posthoc === "fdr" && {
    id: "fdrQ",
    ask: "At which false-discovery rate (Q) does a comparison count as a discovery?",
    kind: "number",
    label: "Q (%)",
    initial: 5,
    min: 0.01,
    max: 50,
    validate: fdrQError,
  },
];

/** The FDR approach's params, from its answers (the runner's defaults when unanswered). */
const fdrParams = (a: Answers) =>
  a.posthoc === "fdr"
    ? {
        fdrMethod: (a.fdrMethod as "bh" | "bky" | "by" | undefined) ?? "bh",
        fdrQ: (a.fdrQ as number | undefined) ?? 5,
      }
    : {};

/** The questions a two-group test asks after its groups are chosen: Gaussian or not,
 *  how the groups are compared, and the tails — shared by the Column-table wizard and
 *  the Multiple Variables wizard, whose group questions differ. */
const twoGroupsTail = (a: Answers, first = "Group 1", second = "Group 2"): (Question | false)[] => {
  const gaussian = a.gaussian === "yes";
  return [
    choice(
      "gaussian",
      GAUSSIAN,
      [
        ["yes", "Yes — use a parametric test"],
        ["no", "No — use a non-parametric test"],
      ],
      true,
    ),
    gaussian &&
      (a.paired === "paired"
        ? choice("ratio", "How should the paired values be compared?", [
            ["diff", "Compute differences (paired t test)"],
            ["ratio", "Compute ratios (ratio t test) — for log-normal data"],
          ])
        : choice("lognormal", "How should the two groups be compared?", [
            ["no", "Compare means (t test)"],
            ["yes", "Compare geometric means (lognormal t test) — for log-normal data"],
          ])),
    gaussian &&
      a.paired !== "paired" &&
      choice("variance", "Assume the two groups have equal variances?", [
        ["equal", a.lognormal === "yes" ? "Yes — lognormal t test" : "Yes — Student's t test"],
        ["unequal", a.lognormal === "yes" ? "No — lognormal Welch's t test" : "No — Welch's t test"],
      ]),
    choice("tails", "One-tailed or two-tailed P value?", [
      ["two-sided", "Two-tailed (recommended)"],
      ["less", `One-tailed: expect ${first} < ${second}`],
      ["greater", `One-tailed: expect ${first} > ${second}`],
    ]),
  ];
};

/** Whether the table is a Grouped one (column groups with replicate columns),
 *  for the wizards that serve both layouts (mixed-effects): multi-column
 *  sets, or a ":" in a column name (a grouped table with one replicate per
 *  group has one-column sets). */
const isGroupedTable = (table: Dataset) =>
  table.sets.some((s) => s.columns.length > 1) || table.columns.some((c) => c.name.includes(":"));

const GAUSSIAN = "Assume the data are sampled from Gaussian (normal) distributions?";
const PAIRED = "How were the data collected?";

/** The key of a checklist in CHECKLISTS. */
export type ChecklistKey =
  | "one-sample-t"
  | "one-sample-ks"
  | "wilcoxon-signed-rank"
  | "two-sample-t"
  | "paired-t"
  | "mann-whitney"
  | "wilcoxon-paired"
  | "anova"
  | "kruskal-wallis"
  | "rm-anova"
  | "friedman"
  | "two-way-anova"
  | "two-way-anova-rm"
  | "two-way-anova-srh"
  | "three-way-anova"
  | "multifactor-anova"
  | "linear-regression"
  | "nonlinear-regression"
  | "survival"
  | "cox-ph"
  | "correlation-pearson"
  | "correlation-spearman";

/** The assumption checklists: one per analysis (or per branch of one — a
 *  t test and its rank-based alternative check different things). Content is
 *  factual assumption lists written in our own words from the statistical
 *  definitions; each item says what to do when the assumption does not hold,
 *  so the checklist is advice, not just a warning. */
export const CHECKLISTS: Record<ChecklistKey, AnalysisChecklist> = {
  "one-sample-t": {
    title: "One-sample t test — checklist",
    whenToUse:
      "Use this when you have one group of numbers and want to test whether its mean differs from a value you chose before seeing the data.",
    items: [
      {
        assumption: "The values are numbers on a continuous scale — measurements, not counts or categories.",
        ifNot: "For counts or categories a t test does not apply; use a test built for that kind of data.",
      },
      {
        assumption:
          "Each value is independent — no value is a repeat measurement of another, and no two values come from the same subject.",
        ifNot: "Repeated or matched values need a paired test instead.",
      },
      {
        assumption:
          "The values are roughly symmetric around their mean (no strong skew), or the sample is large enough that the mean still behaves well.",
        ifNot:
          "With skewed data or a small sample, use the Wilcoxon signed-rank test (answer “No” to the Gaussian question) or transform the data first.",
      },
      {
        assumption: "No single value dominates the result — check for extreme outliers before trusting the mean.",
        ifNot: "Investigate outliers first; one extreme value can move the mean and the P value a lot.",
      },
      {
        assumption:
          "The hypothetical value was picked before looking at the data, not chosen to match the observed mean.",
        ifNot: "Testing against a value picked from the same data makes the P value meaningless.",
      },
    ],
  },
  "one-sample-ks": {
    title: "One-sample Kolmogorov–Smirnov test — checklist",
    whenToUse:
      "Use this when you have one group of numbers and want to test whether they could have come from a particular theoretical distribution (Normal, Lognormal, Exponential or Uniform).",
    items: [
      {
        assumption: "The values are numbers on a continuous scale — measurements, not counts or categories.",
        ifNot: "For counts or categories this test does not apply; a chi-square goodness-of-fit test is built for that kind of data.",
      },
      {
        assumption: "Each value is independent — no value is a repeat measurement of another, and no two values come from the same subject.",
        ifNot: "Repeated or matched values need a test that accounts for the matching.",
      },
      {
        assumption:
          "The reference distribution and its parameters were picked before looking at the data — or, if the parameters were estimated from the same sample, the P value is only approximate (anti-conservative).",
        ifNot:
          "A distribution fitted to the same data and then tested against it will look like a better fit than it is; enter the parameters in advance when you can.",
      },
      {
        assumption:
          "The values are not heavily rounded or tied — the test compares cumulative distributions, and many tied values blunt it.",
        ifNot: "With many ties the P value is asymptotic, not exact, and the test loses power.",
      },
      {
        assumption:
          "The sample is big enough to notice a mismatch — the test is most sensitive near the centre of the distribution and weak in the tails.",
        ifNot: "A non-significant result on a small sample is weak evidence that the data follow the distribution.",
      },
    ],
  },
  "wilcoxon-signed-rank": {
    title: "Wilcoxon signed-rank test — checklist",
    whenToUse:
      "Use this when you have one group of numbers and want to test whether its median differs from a chosen value, without assuming the values follow a normal distribution.",
    items: [
      {
        assumption:
          "The values are numbers on a continuous scale, or at least ordered — the test ranks the distances from the hypothetical value.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption: "Each value is independent — no value is a repeat measurement of another.",
        ifNot: "Repeated or matched values need a paired test instead.",
      },
      {
        assumption: "The values are roughly symmetric around their median, so the median is a fair centre to test.",
        ifNot:
          "With a strongly lopsided distribution, consider the sign test, which only asks whether values fall above or below the hypothetical value.",
      },
      {
        assumption:
          "The hypothetical value was picked before looking at the data, not chosen to match the observed median.",
        ifNot: "Testing against a value picked from the same data makes the P value meaningless.",
      },
    ],
  },
  "two-sample-t": {
    title: "Unpaired t test — checklist",
    whenToUse: "Use this when you have two independent groups of numbers and want to test whether their means differ.",
    items: [
      {
        assumption:
          "The two groups are independent — no subject appears in both groups, and no value in one group is matched to a value in the other.",
        ifNot: "Matched or repeated measurements need a paired t test instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale in both groups.",
        ifNot: "For counts or categories a t test does not apply; use a test built for that kind of data.",
      },
      {
        assumption:
          "Each group is roughly symmetric around its mean (no strong skew), or each group is large enough that its mean still behaves well.",
        ifNot:
          "With skewed data or small groups, use the Mann-Whitney test (answer “No” to the Gaussian question) or transform the data first.",
      },
      {
        assumption: "The two groups have similar spread — the t test pools their variances.",
        ifNot:
          "When the spreads clearly differ, use Welch's t test (answer “No” to the equal-variances question); it does not pool the variances.",
      },
      {
        assumption: "No single value dominates either group — check for extreme outliers before trusting the means.",
        ifNot: "Investigate outliers first; one extreme value can move a mean and the P value a lot.",
      },
    ],
  },
  "paired-t": {
    title: "Paired t test — checklist",
    whenToUse:
      "Use this when each value in one group is matched to one value in the other — the same subject measured twice, or matched pairs — and you want to test whether the mean difference is zero.",
    items: [
      {
        assumption:
          "The pairing is real: each pair belongs together (same subject, or a deliberate match), and the difference within a pair is what matters.",
        ifNot:
          "If the groups are actually independent, use an unpaired t test — pairing unrelated values throws away information.",
      },
      {
        assumption:
          "The differences between pairs are roughly symmetric around their mean (no strong skew), or there are enough pairs that the mean difference still behaves well.",
        ifNot:
          "With skewed differences or few pairs, use the Wilcoxon signed-rank test (answer “No” to the Gaussian question) or transform the data first.",
      },
      {
        assumption:
          "The pairs are independent of each other — no subject appears in two pairs, and no pair shares a subject with another.",
        ifNot: "Overlapping pairs need a model that accounts for the sharing, such as a mixed-effects analysis.",
      },
      {
        assumption:
          "No single pair dominates the result — check the largest differences before trusting the mean difference.",
        ifNot:
          "Investigate extreme pairs first; one wild difference can move the mean difference and the P value a lot.",
      },
    ],
  },
  "mann-whitney": {
    title: "Mann-Whitney test — checklist",
    whenToUse:
      "Use this when you have two independent groups and want to test whether one tends to give larger values than the other, without assuming either group follows a normal distribution.",
    items: [
      {
        assumption:
          "The two groups are independent — no subject appears in both groups, and no value in one group is matched to a value in the other.",
        ifNot: "Matched or repeated measurements need a paired rank test instead.",
      },
      {
        assumption:
          "The outcome is at least ordered — numbers, or ranks such as scores — so that values from the two groups can be ranked together.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption: "Each group's values are independent of each other within the group.",
        ifNot: "Repeated measurements within a group need a model that accounts for the repeats.",
      },
      {
        assumption:
          "If you want to read the result as a difference in medians, the two distributions have similar shapes and differ mainly in where they sit.",
        ifNot:
          "When the shapes differ a lot, the test still works, but report it as one group tending to larger values — not as a median difference.",
      },
    ],
  },
  "wilcoxon-paired": {
    title: "Wilcoxon signed-rank test (paired) — checklist",
    whenToUse:
      "Use this when each value in one group is matched to one value in the other and you want to test whether the median difference is zero, without assuming the differences follow a normal distribution.",
    items: [
      {
        assumption:
          "The pairing is real: each pair belongs together (same subject, or a deliberate match), and the difference within a pair is what matters.",
        ifNot:
          "If the groups are actually independent, use the Mann-Whitney test — pairing unrelated values throws away information.",
      },
      {
        assumption:
          "The differences are roughly symmetric around their median, so the median is a fair centre to test.",
        ifNot:
          "With a strongly lopsided set of differences, consider the sign test, which only asks whether differences fall above or below zero.",
      },
      {
        assumption: "The pairs are independent of each other — no subject appears in two pairs.",
        ifNot: "Overlapping pairs need a model that accounts for the sharing.",
      },
    ],
  },
  anova: {
    title: "One-way ANOVA — checklist",
    whenToUse:
      "Use this when you have three or more independent groups of numbers and want to test whether any group's mean differs from the others.",
    items: [
      {
        assumption: "The groups are independent — no subject appears in more than one group.",
        ifNot: "Matched or repeated measurements need a repeated-measures ANOVA instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale in every group.",
        ifNot: "For counts or categories an ANOVA does not apply; use a test built for that kind of data.",
      },
      {
        assumption:
          "Each group is roughly symmetric around its mean (no strong skew), or each group is large enough that its mean still behaves well.",
        ifNot:
          "With skewed data or small groups, use the Kruskal-Wallis test (answer “No” to the Gaussian question) or transform the data first.",
      },
      {
        assumption: "The groups have similar spread — the ANOVA pools their variances.",
        ifNot:
          "When the spreads clearly differ, answer “No” to the equal-SDs question: Welch's and Brown-Forsythe ANOVAs are reported instead, and they do not pool the variances.",
      },
      {
        assumption: "No single value dominates any group — check for extreme outliers before trusting the means.",
        ifNot: "Investigate outliers first; one extreme value can move a group mean and the P value a lot.",
      },
      {
        assumption:
          "The comparisons you will run afterwards were planned before seeing the results — the ANOVA only says that some difference exists, not where it is.",
        ifNot:
          "Comparisons picked because the data looked interesting need a stricter correction for multiple testing.",
      },
    ],
  },
  "kruskal-wallis": {
    title: "Kruskal-Wallis test — checklist",
    whenToUse:
      "Use this when you have three or more independent groups and want to test whether one tends to give larger values than the others, without assuming any group follows a normal distribution.",
    items: [
      {
        assumption: "The groups are independent — no subject appears in more than one group.",
        ifNot: "Matched or repeated measurements need the Friedman test instead.",
      },
      {
        assumption:
          "The outcome is at least ordered — numbers, or ranks such as scores — so that values from all groups can be ranked together.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption: "Each group's values are independent of each other within the group.",
        ifNot: "Repeated measurements within a group need a model that accounts for the repeats.",
      },
      {
        assumption:
          "If you want to read the result as a difference in medians, the distributions have similar shapes and differ mainly in where they sit.",
        ifNot:
          "When the shapes differ a lot, the test still works, but report it as one group tending to larger values — not as a median difference.",
      },
    ],
  },
  "rm-anova": {
    title: "Repeated-measures ANOVA — checklist",
    whenToUse:
      "Use this when the same subjects are measured under three or more conditions and you want to test whether any condition's mean differs from the others.",
    items: [
      {
        assumption: "Every subject was measured in every condition — the matching is what gives this test its power.",
        ifNot:
          "A subject missing a condition drops out of the analysis entirely; with patchy data, consider a mixed-effects model instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale in every condition.",
        ifNot: "For counts or categories this test does not apply.",
      },
      {
        assumption:
          "Each condition is roughly symmetric around its mean (no strong skew), or there are enough subjects that the means still behave well.",
        ifNot:
          "With skewed data or few subjects, use the Friedman test (answer “No” to the Gaussian question) or transform the data first.",
      },
      {
        assumption: "Sphericity holds: the differences between every pair of conditions vary by similar amounts.",
        ifNot:
          "When sphericity is doubtful, apply the Geisser-Greenhouse correction (answer “No” to the sphericity question); it widens the P value to allow for the uneven differences.",
      },
      {
        assumption: "The subjects are independent of each other — no subject's values influence another's.",
        ifNot:
          "Subjects measured in clusters (for example, animals from the same litter) need a model that accounts for the clustering.",
      },
    ],
  },
  friedman: {
    title: "Friedman test — checklist",
    whenToUse:
      "Use this when the same subjects are measured under three or more conditions and you want to test whether one condition tends to give larger values than the others, without assuming any condition follows a normal distribution.",
    items: [
      {
        assumption: "Every subject was measured in every condition — the matching is what gives this test its power.",
        ifNot: "A subject missing a condition drops out; with patchy data, consider a mixed-effects model instead.",
      },
      {
        assumption:
          "The outcome is at least ordered — numbers, or ranks such as scores — so that each subject's values can be ranked across conditions.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption: "The blocks (subjects) are independent of each other.",
        ifNot: "Subjects measured in clusters need a model that accounts for the clustering.",
      },
    ],
  },
  "two-way-anova": {
    title: "Two-way ANOVA — checklist",
    whenToUse:
      "Use this when two factors (for example, treatment and time) may each affect a numeric outcome, and you want to test both factors and whether they interact.",
    items: [
      {
        assumption:
          "The observations are independent — no subject appears in more than one cell, unless the design is repeated-measures.",
        ifNot: "Repeated measurements need the repeated-measures design (choose it in the wizard).",
      },
      {
        assumption: "The outcome is a number on a continuous scale.",
        ifNot: "For counts or categories an ANOVA does not apply.",
      },
      {
        assumption:
          "The residuals — what is left after the factors explain what they can — are roughly symmetric, with similar spread in every cell.",
        ifNot:
          "With skewed residuals or very uneven spread between cells, use the Scheirer-Ray-Hare test (answer “non-parametric” to the design question) or transform the data first.",
      },
      {
        assumption:
          "You read the interaction first: if the factors interact, the effect of one factor depends on the other, so a single main-effect summary misleads.",
        ifNot:
          "With a significant interaction, compare the groups within each level of the other factor instead of reporting the main effects alone.",
      },
      {
        assumption:
          "Each cell holds enough replicates to estimate its mean and spread — one value per cell can test the factors but cannot test the interaction.",
        ifNot:
          "Without replicates, the interaction cannot be separated from noise; replicate within cells if the interaction matters.",
      },
    ],
  },
  "two-way-anova-rm": {
    title: "Repeated-measures two-way ANOVA — checklist",
    whenToUse:
      "Use this when two factors may affect a numeric outcome and one of them is repeated within each subject (for example, every subject measured at several times, under several treatments).",
    items: [
      {
        assumption:
          "Every subject was measured at every level of the repeated factor — the matching is what gives this test its power.",
        ifNot:
          "A subject missing a level drops out of that comparison; with patchy data, consider a mixed-effects model instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale.",
        ifNot: "For counts or categories this test does not apply.",
      },
      {
        assumption: "The residuals are roughly symmetric, with similar spread in every cell.",
        ifNot:
          "With skewed residuals or very uneven spread, use the Scheirer-Ray-Hare test or transform the data first.",
      },
      {
        assumption:
          "Sphericity holds for the repeated factor: the differences between every pair of its levels vary by similar amounts.",
        ifNot:
          "When sphericity is doubtful, apply the Geisser-Greenhouse correction (answer “No” to the sphericity question).",
      },
      {
        assumption:
          "You read the interaction first: if the factors interact, the effect of one factor depends on the other, so a single main-effect summary misleads.",
        ifNot:
          "With a significant interaction, compare the groups within each level of the other factor instead of reporting the main effects alone.",
      },
    ],
  },
  "two-way-anova-srh": {
    title: "Scheirer-Ray-Hare test — checklist",
    whenToUse:
      "Use this when two factors may affect an outcome and you want to test both factors and their interaction, without assuming the outcome follows a normal distribution.",
    items: [
      {
        assumption: "The observations are independent — no subject appears in more than one cell.",
        ifNot: "Repeated measurements need a repeated-measures or mixed-effects design instead.",
      },
      {
        assumption: "The outcome is at least ordered, so that all values can be ranked together.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption:
          "The cells have similar distribution shapes if you want to read the result as a difference in medians.",
        ifNot:
          "When the shapes differ a lot, report the result as one cell tending to larger values — not as a median difference.",
      },
      {
        assumption:
          "The interaction result is treated as approximate: ranking the data first makes the interaction test less exact than the main-effect tests.",
        ifNot:
          "If the interaction is the question that matters most, consider transforming the data and running a parametric two-way ANOVA instead.",
      },
    ],
  },
  "three-way-anova": {
    title: "Three-way ANOVA — checklist",
    whenToUse:
      "Use this when three factors may each affect a numeric outcome, and you want to test all three factors and how they interact.",
    items: [
      {
        assumption: "The observations are independent — no subject appears in more than one cell.",
        ifNot: "Repeated measurements need a repeated-measures or mixed-effects design instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale.",
        ifNot: "For counts or categories an ANOVA does not apply.",
      },
      {
        assumption: "The residuals are roughly symmetric, with similar spread in every cell.",
        ifNot: "With skewed residuals or very uneven spread, transform the data first or use a rank-based test.",
      },
      {
        assumption:
          "Each cell holds enough replicates to estimate the three-way interaction — the number of cells grows fast with three factors.",
        ifNot: "Without replicates in every cell, the higher-order interactions cannot be separated from noise.",
      },
      {
        assumption:
          "You decided before running which comparisons matter: with three factors, the list of possible interactions is long and most of them will be hard to interpret.",
        ifNot:
          "Comparisons picked because the data looked interesting need a stricter correction for multiple testing.",
      },
      {
        assumption:
          "You read the interactions before the main effects: a significant interaction means the effect of one factor depends on the others.",
        ifNot:
          "With a significant interaction, compare the groups within each level of the other factors instead of reporting the main effects alone.",
      },
    ],
  },
  "multifactor-anova": {
    title: "Multifactor ANOVA — checklist",
    whenToUse:
      "Use this when one or more factors may each affect a numeric outcome, and you want to test all of them — and how they interact — in one analysis, without reorganising the table for each factor count. It tests the main effects and every two- and three-way interaction; with four or more factors, no four-way interaction is tested.",
    items: [
      {
        assumption: "The observations are independent — no subject appears in more than one cell.",
        ifNot: "Repeated measurements need a repeated-measures or mixed-effects design instead.",
      },
      {
        assumption: "The outcome is a number on a continuous scale.",
        ifNot: "For counts or categories an ANOVA does not apply.",
      },
      {
        assumption: "The residuals are roughly symmetric, with similar spread in every cell.",
        ifNot: "With skewed residuals or very uneven spread, transform the data first or use a rank-based test.",
      },
      {
        assumption:
          "Each combination holds enough replicates to estimate the interactions — the number of cells grows fast with each factor (four 3-level factors already make 81 combinations).",
        ifNot: "Without replicates in every combination, the higher-order interactions cannot be separated from noise.",
      },
      {
        assumption:
          "You decided before running which comparisons matter: with several factors, the list of possible interactions is long and most of them will be hard to interpret.",
        ifNot:
          "Comparisons picked because the data looked interesting need a stricter correction for multiple testing.",
      },
      {
        assumption:
          "You read the interactions before the main effects: a significant interaction means the effect of one factor depends on the others.",
        ifNot:
          "With a significant interaction, compare the groups within each level of the other factors instead of reporting the main effects alone.",
      },
    ],
  },
  "linear-regression": {
    title: "Linear regression — checklist",
    whenToUse:
      "Use this when you want to describe how a numeric Y changes with X, or predict Y from X, and the relationship looks like a straight line.",
    items: [
      {
        assumption: "The relationship is straight — check a scatter plot of Y against X before fitting, not after.",
        ifNot:
          "A curved relationship needs a curve fit (nonlinear regression) or a transformation, not a straight line through a curve.",
      },
      {
        assumption:
          "Each point is independent — no point is a repeat measurement of another, and no two points share a subject.",
        ifNot: "Repeated measurements need a model that accounts for the repeats, such as a mixed-effects analysis.",
      },
      {
        assumption: "The scatter around the line is similar all along X — no funnel shape that widens or narrows.",
        ifNot:
          "When the scatter grows with Y, weight the points (the wizard offers 1/Y or 1/Y² weighting) or transform Y first.",
      },
      {
        assumption:
          "The residuals — the distances from the line — are roughly symmetric, which matters most for small samples and for confidence intervals.",
        ifNot: "With skewed residuals, transform Y first or use a robust fit.",
      },
      {
        assumption:
          "No single point drags the line: check points with extreme X (high leverage) and points far from the line.",
        ifNot: "Investigate influential points first; one point can move the slope and the P value a lot.",
      },
      {
        assumption: "X is measured precisely, or nearly so — the fit assumes the scatter is all in Y.",
        ifNot: "When both X and Y carry similar measurement error, use Deming regression instead.",
      },
      {
        assumption:
          "Forcing the line through the origin is only justified when Y really is zero at X = 0 — the wizard asks, and “No” is the safe default.",
        ifNot: "Forcing through the origin when it does not hold bends the whole line and biases the slope.",
      },
    ],
  },
  "nonlinear-regression": {
    title: "Nonlinear regression — checklist",
    whenToUse:
      "Use this when Y follows a curve with X — a dose-response, a growth or decay, a binding curve — and you want the curve's parameters (such as EC50 or a rate constant) rather than just a line.",
    items: [
      {
        assumption:
          "The curve's shape comes from the mechanism or prior knowledge — a dose-response, a decay, a binding model — not from trying shapes until one happens to fit.",
        ifNot:
          "A shape picked because it fits this data set will flatter the data and its parameters will not generalise.",
      },
      {
        assumption:
          "Every parameter means something and the data can pin it down: enough points spread across the curve, including near its bends and plateaus.",
        ifNot:
          "Parameters the data cannot see (for example, a top plateau with no points near it) come back with absurd values and wide intervals — fix them or collect the missing points.",
      },
      {
        assumption: "The residuals are independent, with similar spread all along X.",
        ifNot: "When the scatter grows with Y, weight the points or transform Y first.",
      },
      {
        assumption: "The starting values are sensible — the fit searches from them and can stall on a bad start.",
        ifNot:
          "If the fit fails or looks wrong, start from values read off the data (for example, the half-maximal X) rather than the defaults.",
      },
      {
        assumption:
          "Replicates at each X help judge lack of fit: without them, a curve can look good while missing the true shape.",
        ifNot:
          "With no replicates, check the residuals for a pattern (runs of points above, then below, the curve) — a pattern means the shape is wrong.",
      },
      {
        assumption:
          "The fitted parameters, not the R² alone, are what you report — a flexible curve can hug the points while its parameters stay meaningless.",
        ifNot:
          "Compare candidate shapes by whether their parameters are stable and interpretable, not only by which fits tightest.",
      },
    ],
  },
  survival: {
    title: "Survival analysis (log-rank) — checklist",
    whenToUse:
      "Use this when you compare how long subjects survive (or stay event-free) in two or more groups, with some subjects still event-free when follow-up ends.",
    items: [
      {
        assumption: "The groups were defined before follow-up started — not picked after seeing who lived longest.",
        ifNot: "Groups defined from the outcome make the comparison circular.",
      },
      {
        assumption:
          "Censoring is unrelated to the chance of the event: a subject who leaves follow-up early is no sicker or healthier than one who stays.",
        ifNot:
          "When sicker subjects drop out first, the curves are biased — the comparison no longer measures the groups, it measures who stayed.",
      },
      {
        assumption:
          "Follow-up ran long enough to see events in each group — a comparison with almost no events has almost no power.",
        ifNot:
          "With too few events, report the curves and the follow-up time, and treat the P value as the weak evidence it is.",
      },
      {
        assumption:
          "The log-rank test compares the whole curves, giving each event time similar weight — it does not assume the curves keep a fixed ratio.",
        ifNot:
          "When the curves cross, a single summary such as a hazard ratio misleads; describe where the curves differ instead.",
      },
      {
        assumption:
          "The test is about events, not subjects: what matters is how many events happened, not only how many subjects were enrolled.",
        ifNot: "A large study with few events is still a small study for this test.",
      },
      {
        assumption:
          "When three or more groups are compared pair by pair, the P values are corrected for multiple testing.",
        ifNot:
          "Uncorrected pairwise P values overstate the evidence; the wizard offers Holm or false-discovery-rate correction.",
      },
    ],
  },
  "cox-ph": {
    title: "Cox proportional-hazards regression — checklist",
    whenToUse:
      "Use this when you want to estimate how variables change the hazard (the event rate) over follow-up time, while allowing for subjects who are still event-free when follow-up ends.",
    items: [
      {
        assumption:
          "The hazards stay proportional: the ratio between two subjects' hazards does not drift over follow-up time.",
        ifNot:
          "When the ratio changes with time, a single hazard ratio misleads — stratify, or let the effect vary with time.",
      },
      {
        assumption:
          "Censoring is unrelated to the chance of the event: a subject who leaves follow-up early is no sicker or healthier than one who stays.",
        ifNot: "When sicker subjects drop out first, the hazard ratios are biased.",
      },
      {
        assumption:
          "There are enough events for the variables fitted — roughly ten events per variable is a common rule of thumb.",
        ifNot:
          "With too few events per variable, the estimates swing wildly; fit fewer variables or collect more follow-up.",
      },
      {
        assumption:
          "The covariates are measured before follow-up (or handled as time-varying with care) — a variable measured after the event cannot explain it.",
        ifNot:
          "Variables recorded after the event, or changed by the treatment, do not belong in the model as ordinary covariates.",
      },
      {
        assumption:
          "No two covariates are near-duplicates of each other — strongly correlated variables split one effect between them and inflate the uncertainty.",
        ifNot: "Drop or combine near-duplicate variables before fitting.",
      },
      {
        assumption:
          "Tied event times are handled by the method the wizard asks about — Efron is the usual default; with many ties the choice matters.",
        ifNot: "With heavy ties, check that the hazard ratios do not hinge on the tie method.",
      },
    ],
  },
  "correlation-pearson": {
    title: "Pearson correlation — checklist",
    whenToUse:
      "Use this when you want one number for how closely two numeric variables move together in a straight line.",
    items: [
      {
        assumption: "Both variables are numbers on a continuous scale.",
        ifNot: "For ordered ranks or categories, use Spearman correlation instead.",
      },
      {
        assumption:
          "The relationship is a straight line — check a scatter plot first; a strong curve can still give a weak r.",
        ifNot:
          "A curved but consistent relationship needs Spearman correlation (monotonic, not necessarily straight) or a curve fit.",
      },
      {
        assumption: "No single point dominates the result — one extreme pair can create a correlation, or hide one.",
        ifNot: "Investigate outlying pairs first; report r with and without them if they matter.",
      },
      {
        assumption:
          "The pairs are independent — no subject contributes two pairs, and no pair shares a subject with another.",
        ifNot: "Repeated measurements need a method that accounts for the repeats.",
      },
      {
        assumption:
          "A strong correlation does not mean one variable causes the other — a third variable, or the study design, may explain both.",
        ifNot: "Treat r as a measure of association, and look for the cause elsewhere.",
      },
    ],
  },
  "correlation-spearman": {
    title: "Spearman correlation — checklist",
    whenToUse:
      "Use this when you want one number for how consistently two variables rise (or fall) together, without assuming the relationship is a straight line or the values follow a normal distribution.",
    items: [
      {
        assumption:
          "Both variables are at least ordered — numbers, or ranks such as scores — so that their values can be ranked.",
        ifNot: "For unordered categories this test does not apply.",
      },
      {
        assumption:
          "The relationship is monotonic: as one rises, the other consistently rises (or consistently falls), even if not in a straight line.",
        ifNot:
          "A U-shaped or other non-monotonic relationship gives a Spearman r near zero even when the variables are strongly related — plot the data first.",
      },
      {
        assumption: "The pairs are independent — no subject contributes two pairs.",
        ifNot: "Repeated measurements need a method that accounts for the repeats.",
      },
      {
        assumption:
          "A strong correlation does not mean one variable causes the other — a third variable, or the study design, may explain both.",
        ifNot: "Treat r as a measure of association, and look for the cause elsewhere.",
      },
    ],
  },
};

/** The checklist for `key`, or undefined for an unknown key. */
export function checklistFor(key: string): AnalysisChecklist | undefined {
  return (CHECKLISTS as Record<string, AnalysisChecklist | undefined>)[key];
}

/** The checklist keys, in the order they are defined — so a caller can check
 *  that every key a wizard can resolve is a real checklist. */
export const CHECKLIST_KEYS = Object.keys(CHECKLISTS) as ChecklistKey[];

export const WIZARDS: Partial<Record<AnalysisPickerValue, Wizard>> = {
  "descriptive-statistics": {
    questions: (_, table) => someSets(table, 1),
    finish: (a) => ({ type: "descriptive-statistics", params: withSets(a) }),
  },

  "compare-two-groups": {
    questions: (a, table, type) => {
      const [first = "Group 1", second = "Group 2"] = chosenSets(a) ?? setNames(table);
      // A Multiple Variables table assigns its variables: paired, two variables row by
      // row; unpaired, one response variable split by a grouping variable's two levels.
      // The paired question comes first here — it decides which variables are asked.
      if (type === "multiple") {
        const paired = a.paired === "paired";
        const [g1 = "Group 1", g2 = "Group 2"] = levelsOfName(table, a.groupBy as string | undefined);
        return [
          choice("paired", PAIRED, [
            ["unpaired", "Unpaired (independent groups)"],
            ["paired", "Paired (matched samples)"],
          ]),
          ...(paired
            ? [
                choice("set1", "Which is the first variable?", names(dataNames(table))),
                choice("set2", "Which is the second variable?", names(dataNames(table).filter((n) => n !== a.set1))),
              ]
            : [
                choice("response", "Which variable holds the values to compare?", names(dataNames(table))),
                choice(
                  "groupBy",
                  "Which variable defines the two groups?",
                  names(twoLevelNames(table, a.response as string | undefined)),
                  false,
                  "No variable has exactly two levels yet — add a grouping variable with two values (for example “Control” and “Treated”).",
                ),
              ]),
          ...twoGroupsTail(a, paired ? first : g1, paired ? second : g2),
        ];
      }
      return [
        ...twoSets(a, table),
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched samples)"],
        ]),
        ...twoGroupsTail(a, first, second),
      ];
    },
    // An answer left from a question no longer asked (after Back) doesn't count.
    finish: (a) => {
      const [paired, gaussian] = [a.paired === "paired", a.gaussian === "yes"];
      return {
        type: "compare-two-groups",
        params: withSets(a, {
          paired,
          gaussian,
          equalVariance: a.variance !== "unequal",
          ratio: paired && gaussian && a.ratio === "ratio",
          ...(!paired && gaussian && a.lognormal === "yes" ? { lognormal: true } : {}),
          tails: a.tails as CompareTwoGroupsParams["tails"],
          ...(a.response !== undefined ? { response: a.response as string } : {}),
          ...(a.groupBy !== undefined ? { groupBy: a.groupBy as string } : {}),
        }),
      };
    },
    // The checklist follows the branch: parametric or rank-based, paired or not.
    // Unanswered, the first options (unpaired, Gaussian) give the unpaired t test.
    checklist: (a) => {
      const [paired, gaussian] = [a.paired === "paired", a.gaussian !== "no"];
      return CHECKLISTS[
        gaussian ? (paired ? "paired-t" : "two-sample-t") : paired ? "wilcoxon-paired" : "mann-whitney"
      ];
    },
  },

  "compare-many-groups": {
    questions: (a, table) => {
      const paired = a.paired === "paired";
      const nonParametric = paired ? "Friedman test" : "Kruskal-Wallis test";
      // Independent groups sampled from Gaussian distributions: equal SDs or not.
      const anova = !paired && a.gaussian === "yes";
      const posthocs: [string, string][] =
        a.gaussian !== "yes"
          ? [
              ["none", `No — only the overall ${nonParametric}`],
              ["dunn", "Yes — Dunn's multiple comparisons test (Bonferroni-corrected)"],
              ["dunn-sidak", "Yes — Dunn's multiple comparisons test (Šídák-corrected)"],
              ["dunn-holm-sidak", "Yes — Dunn's multiple comparisons test (Holm–Šídák-corrected)"],
            ]
          : anova && a.equalSd === "no"
            ? [
                ["none", "No — only the overall Welch's and Brown-Forsythe ANOVAs"],
                ["games-howell", "Yes, every pair — Games-Howell test"],
                ["t3", "Yes, every pair — Dunnett's T3 test (fewer than 50 values per group)"],
                ["fdr", "Yes — False Discovery Rate (Benjamini-Hochberg)"],
              ]
            : [
                ["none", "No — only the overall ANOVA"],
                ["tukey", "Yes, every pair — Tukey's multiple comparisons test"],
                ...(anova
                  ? [["dunnett", "Yes, each group against a control — Dunnett's test"] as [string, string]]
                  : []),
                ["bonferroni", "Yes, pairs I choose — Bonferroni correction"],
                ["sidak", "Yes, pairs I choose — Šídák correction"],
                ["holm-sidak", "Yes, pairs I choose — Holm–Šídák correction (more powerful)"],
                // False Discovery Rate is a one-way ANOVA post-hoc (seq 191):
                // repeated-measures ANOVA has no FDR path (its CIs come from
                // `pa`, which has no step-up critical value), so it is not
                // offered there.
                ...(anova
                  ? [["fdr", "Yes, pairs I choose — False Discovery Rate (Benjamini-Hochberg) correction"] as [string, string]]
                  : []),
                ["lsd", "Yes, pairs I choose — Fisher's LSD (no correction)"],
              ];
      const pairs = pairLabels(chosenSets(a) ?? setNames(table));
      return [
        ...someSets(table, 3),
        choice("paired", PAIRED, [
          ["unpaired", "Unpaired (independent groups)"],
          ["paired", "Paired (matched / repeated-measures)"],
        ]),
        choice(
          "gaussian",
          GAUSSIAN,
          [
            ["yes", `Yes — ${paired ? "repeated-measures" : "one-way"} ANOVA (parametric)`],
            ["no", `No — ${nonParametric} (non-parametric)`],
          ],
          true,
        ),
        anova &&
          choice("lognormal", "How should the groups be compared?", [
            ["no", "Compare means (one-way ANOVA)"],
            ["yes", "Compare geometric means (lognormal ANOVA) — for log-normal data"],
          ]),
        anova &&
          choice(
            "equalSd",
            a.lognormal === "yes"
              ? "Assume the groups' logarithms have equal SDs?"
              : "Assume the groups have equal SDs?",
            [
              ["yes", a.lognormal === "yes" ? "Yes — lognormal one-way ANOVA" : "Yes — ordinary one-way ANOVA"],
              [
                "no",
                a.lognormal === "yes"
                  ? "No — lognormal Welch's and Brown-Forsythe ANOVAs"
                  : "No — Welch's and Brown-Forsythe ANOVAs",
              ],
            ],
          ),
        paired &&
          a.gaussian === "yes" &&
          gaps(table, chosenSets(a)) &&
          choice("mixed", "Some subjects lack a value in some groups. How should they be handled?", [
            ["yes", "Fit a mixed-effects model, keeping every value (recommended)"],
            ["no", "Leave out those subjects: repeated-measures ANOVA of the complete ones"],
          ]),
        paired &&
          a.gaussian === "yes" &&
          !(gaps(table, chosenSets(a)) && a.mixed !== "no") &&
          choice("sphericity", "Assume sphericity (equal variability of the differences between groups)?", [
            ["no", "No — Geisser-Greenhouse correction (recommended)"],
            ["yes", "Yes — no correction"],
          ]),
        choice("posthoc", paired ? "Compare the matched groups?" : "Compare the groups?", posthocs),
        a.posthoc === "dunnett" &&
          choice("control", "Which group is the control?", names(chosenSets(a) ?? setNames(table))),
        isPairCorrection(a.posthoc) &&
          pairs.length > 1 && {
            id: "compared",
            ask: "Which pairs should be compared? The fewer, the less each P value is corrected.",
            kind: "names",
            options: pairs.map((p) => p.label),
            min: 1,
          },
        // The test for linear trend is Prism's alternative to multiple comparisons (one
        // comparison, not a family): offered only with the ordinary ANOVA and no post-hoc.
        anova &&
          a.equalSd !== "no" &&
          a.posthoc === "none" &&
          choice("trend", "Test for linear trend between the column means and their left-to-right order?", [
            ["no", "No — only the overall ANOVA"],
            ["yes", "Yes — test for linear trend (columns in a natural order, equally spaced)"],
          ]),
      ];
    },
    finish: (a, table) => {
      const paired = a.paired === "paired";
      const type = a.gaussian === "yes" ? (paired ? "rm-anova" : "anova") : paired ? "friedman" : "kruskal-wallis";
      const anova = type === "anova" && {
        equalSd: a.equalSd !== "no",
        ...(a.lognormal === "yes" ? { lognormal: true } : {}),
        ...(a.posthoc === "dunnett" ? { control: a.control as string } : {}),
        ...(a.trend === "yes" && a.posthoc === "none" ? { trend: true } : {}),
      };
      // A mixed-effects model assumes sphericity: it is asked of complete subjects alone.
      const mixed = type === "rm-anova" && gaps(table, chosenSets(a)) && a.mixed !== "no";
      const rm = type === "rm-anova" && (mixed ? { mixed: true } : { sphericity: a.sphericity === "yes" });
      // The pairs ticked, by their keys, when not every pair.
      const pairs = pairLabels(chosenSets(a) ?? setNames(table));
      const ticked = Array.isArray(a.compared)
        ? pairs.filter((p) => (a.compared as string[]).includes(p.label))
        : pairs;
      const compared = isPairCorrection(a.posthoc) &&
        ticked.length < pairs.length && { compared: ticked.map((p) => p.key) };
      return { type, params: withSets(a, { posthoc: a.posthoc, ...anova, ...rm, ...compared }) as AnalysisParams };
    },
    // The checklist follows the branch: which of the four tests the answers build.
    // Unanswered, the first options (unpaired, Gaussian) give the one-way ANOVA.
    checklist: (a) => {
      const paired = a.paired === "paired";
      const key: ChecklistKey =
        a.gaussian !== "no" ? (paired ? "rm-anova" : "anova") : paired ? "friedman" : "kruskal-wallis";
      const list = CHECKLISTS[key];
      // The trend test adds one assumption of its own: the columns are ordered
      // and equally spaced, so the means read left to right.
      return key === "anova" && a.trend === "yes"
        ? {
            ...list,
            items: [
              ...list.items,
              {
                assumption:
                  "The columns are in a natural order (dose, time, age) and equally spaced — the trend test reads the means left to right, one column at a time.",
                ifNot:
                  "With unordered or unevenly spaced columns the trend test has no meaning; use the pairwise comparisons instead.",
              },
            ],
          }
        : list;
    },
  },

  "mixed-effects": {
    // One wizard serves both layouts (Column and Grouped tables) — the
    // Dataset alone must tell them apart: multi-column sets, or a ":" in a
    // column name (a grouped table with one replicate per group has
    // one-column sets). v1 is random-intercept only: the random structure
    // is stated, never chosen, and the choice arrives in v2. On a Column
    // table the wizard also asks for an optional between-subject factor
    // (one level per row): without it the fit is y ~ T only, with it the
    // two-factor fit the reference test pins (y ~ Treatment + T) — the
    // table layout alone cannot express the factor, so the wizard must ask.
    questions: (a, table) => {
      const grouped = isGroupedTable(table);
      if (grouped) {
        // Matchedness first (F10): the interaction is only meaningful for
        // matched subjects, and asking it first meant a not-matched answer
        // silently discarded a choice the user had just made (the fallback
        // is ordinary two-way ANOVA). Not matched, the interaction is never
        // asked at all — the wizard ends after this question.
        return [
          choice(
            "matched",
            "Subjects are the replicate columns within each group: replicate 1 in group A is the same subject as replicate 1 in group B, measured at every row. The model fits a random intercept per subject, so it uses every observed value even when some are missing.",
            [
              ["matched", "Replicates are the same subjects across groups — continue"],
              ["not-matched", "Replicates are NOT the same subjects — stop and use ordinary two-way ANOVA instead"],
            ],
          ),
          a.matched !== "not-matched" &&
            choice(
              "interaction",
              "Fixed factor A is the column groups, fixed factor B is the rows (time/condition). The interaction A×B is included by default.",
              [
                ["yes", "Include the A×B interaction"],
                ["no", "Main effects only — no interaction"],
              ],
            ),
        ];
      }
      const rowCount = table.numeric[0]?.byRow.length ?? 0;
      return [
        {
          id: "sets",
          ask: "Which columns are the repeated measurements? Each column is one time point or condition, measured on every subject (row).",
          kind: "names",
          options: dataNames(table),
          min: 3,
        },
        choice(
          "matched",
          "Subjects are the rows: each row is one subject, measured in every column. The model fits a random intercept per subject (one intercept per row), so it uses every observed value even when some are missing.",
          [
            ["matched", "Rows are matched subjects — continue"],
            ["not-matched", "Rows are NOT matched subjects — stop and use one-way ANOVA instead"],
          ],
        ),
        choice(
          "groups",
          "Do the subjects (rows) fall into groups — for example a treatment arm? A between-subject factor adds one fixed effect per group; without one, the model fits the repeated-measure factor only.",
          [
            ["no", "No — all subjects are one group"],
            ["yes", "Yes — subjects fall into groups"],
          ],
        ),
        a.groups === "yes" && {
          id: "groupName",
          ask: "What is the group factor called?",
          kind: "text" as const,
          label: "Group factor name",
          initial: "Treatment",
          placeholder: "Treatment",
          // A text question without `parse` falls back to comma-separated
          // numbers (the standard-curve unknowns) — a factor name needs its
          // own parse, else "Treatment" errors as "not a number".
          parse: (text: string) => (text.trim() === "" ? { error: "Enter a group factor name." } : {}),
        },
        a.groups === "yes" && {
          id: "groupLevels",
          ask: `Enter one group level per row, in row order, separated by commas — e.g. Control, Control, Control, Treated, Treated, Treated (${rowCount} rows).`,
          kind: "text" as const,
          label: "Group level for each row",
          initial: "",
          placeholder: "Control, Control, Control, Treated, Treated, Treated",
          parse: (text: string) => parseGroupLevels(text, rowCount),
        },
      ];
    },
    finish: (a, table) => {
      if (isGroupedTable(table)) {
        if (a.matched === "not-matched") {
          return {
            type: "two-way-anova",
            params: { design: "ordinary", posthoc: "none", posthocTarget: "groups" } as AnalysisParams,
          };
        }
        return {
          type: "mixed-effects",
          params: {
            subjectId: "replicate",
            randomStructure: "intercept",
            fixedFactors: ["Group", "Row"],
            interaction: a.interaction !== "no",
          },
        };
      }
      if (a.matched === "not-matched") {
        return { type: "anova", params: withSets(a, { posthoc: "none" }) as AnalysisParams };
      }
      const chosen = chosenSets(a) ?? dataNames(table);
      const cols = table.numeric.filter((c) => chosen.includes(c.name));
      const timeName = columnFactorName(cols.length ? cols : table.numeric);
      if (a.groups === "yes") {
        const name = String(a.groupName ?? "").trim() || "Treatment";
        const levels = splitGroupLevels(String(a.groupLevels ?? ""));
        return {
          type: "mixed-effects",
          params: withSets(a, {
            subjectId: "row",
            randomStructure: "intercept",
            fixedFactors: [name, timeName],
            subjectFactor: { name, levels },
          }) as AnalysisParams,
        };
      }
      return {
        type: "mixed-effects",
        params: withSets(a, {
          subjectId: "row",
          randomStructure: "intercept",
          fixedFactors: [timeName],
        }) as AnalysisParams,
      };
    },
  },

  "one-sample-t": {
    questions: (a, table) => {
      const center = a.gaussian === "yes" ? (a.lognormal === "yes" ? "geometric mean" : "mean") : "median";
      return [
        ...someSets(table, 1),
        {
          id: "value",
          ask: "Which hypothetical value should each data set be tested against?",
          kind: "number",
          label: "Hypothetical value",
          initial: 0,
        },
        choice(
          "gaussian",
          "Assume the data are sampled from a Gaussian (normal) distribution?",
          [
            ["yes", "Yes — one-sample t test (parametric)"],
            ["no", "No — Wilcoxon signed-rank test (non-parametric)"],
          ],
          true,
        ),
        a.gaussian === "yes" &&
          choice("lognormal", "How should the sample be compared with the hypothetical value?", [
            ["no", "Compare means"],
            ["yes", "Compare geometric means — for log-normal data"],
          ]),
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", `One-tailed: expect ${center} < hypothetical value`],
          ["greater", `One-tailed: expect ${center} > hypothetical value`],
        ]),
      ];
    },
    finish: (a) => ({
      type: "one-sample-t",
      params: withSets(a, {
        hypotheticalValue: a.value as number,
        gaussian: a.gaussian === "yes",
        ...(a.gaussian === "yes" && a.lognormal === "yes" ? { lognormal: true } : {}),
        tails: a.tails as OneSampleTParams["tails"],
      }),
    }),
    checklist: (a) => CHECKLISTS[a.gaussian === "no" ? "wilcoxon-signed-rank" : "one-sample-t"],
  },

  outliers: {
    questions: (a, table) => [
      ...someSets(table, 1),
      choice("method", "Which method should identify the outliers?", [
        ["rout", "ROUT method (recommended — Q = maximum false discovery rate)"],
        ["grubbs", "Grubbs' test (tests the single most extreme value; assumes Gaussian data)"],
      ]),
      // Before the method is answered the ROUT question shows (ROUT is the
      // default — the first option); picking Grubbs swaps it for alpha +
      // iterate on the next step.
      (a.method === "rout" || a.method === undefined) && {
        id: "q",
        ask: "How strict should the search be? ROUT fits each data set to a robust mean and flags a point as an outlier when its false discovery rate is below Q: a smaller Q flags fewer.",
        kind: "number",
        label: "Q (%) =",
        initial: 1,
        ...ROUT_Q,
        // min/max alone are only HTML attributes — the wizard's Next gate
        // reads `validate`, so without this an out-of-range Q sailed through.
        validate: routQError,
        step: 0.5,
      },
      a.method === "grubbs" && {
        id: "alpha",
        ask: "How strict should the test be? A value is an outlier when its Grubbs P value is below alpha.",
        kind: "number",
        label: "Significance level (alpha) =",
        initial: 0.05,
        min: 0.001,
        max: 0.5,
        step: 0.01,
      },
      a.method === "grubbs" &&
        choice("iterate", "Keep testing after removing each outlier?", [
          ["yes", "Keep testing after removing each outlier (recommended)"],
          ["no", "Test only the single most extreme value"],
        ]),
    ],
    finish: (a) => {
      const method = (a.method as "rout" | "grubbs" | undefined) ?? "rout";
      return {
        type: "outliers",
        params: withSets(
          a,
          // ROUT params carry no alpha/iterate and Grubbs params carry no q,
          // so each method's cached results keep their existing keys.
          method === "grubbs"
            ? { method, alpha: (a.alpha as number | undefined) ?? 0.05, iterate: a.iterate !== "no" }
            : { q: (a.q as number | undefined) ?? 1 },
        ),
      };
    },
  },

  // "Analyze a stack of P values" (seq 190): P values computed elsewhere,
  // entered in a column, adjusted for multiplicity. The method picks the
  // family: the FWER methods ask for alpha, the FDR methods for Q — the
  // other level is never asked, so a cached result keeps only its own key
  // (the outliers ROUT/Grubbs split does the same).
  "p-value-stack": {
    questions: (a, table) => [
      ...someSets(table, 1),
      choice("method", "How should the P values be adjusted for multiple comparisons?", [
        ["holm-sidak", "Holm–Šídák (recommended — step-down, controls the family-wise error rate)"],
        ["holm", "Holm (step-down Bonferroni)"],
        ["bonferroni", "Bonferroni-Dunn (single-step)"],
        ["sidak", "Bonferroni-Šídák (single-step)"],
        ["bh", "Benjamini–Hochberg (false discovery rate)"],
        ["bky", "Benjamini, Krieger and Yekutieli (adaptive two-stage false discovery rate)"],
        ["by", "Benjamini–Yekutieli (false discovery rate, any dependence)"],
      ]),
      // Before the method is answered the alpha question shows (Holm–Šídák
      // is the default — the first option); picking an FDR method swaps it
      // for Q on the next step.
      !isFdrPValueMethod((a.method as string | undefined) ?? "") && {
        id: "alpha",
        ask: "How strict should the family-wise test be? A P value is significant when its adjusted P value is below alpha.",
        kind: "number",
        label: "Significance level (alpha) =",
        initial: 0.05,
        min: 0.001,
        max: 0.5,
        step: 0.01,
        validate: pValueAlphaError,
      },
      isFdrPValueMethod((a.method as string | undefined) ?? "") && {
        id: "q",
        ask: "How strict should the search be? A P value is a discovery when its q value is below Q: a smaller Q finds fewer.",
        kind: "number",
        label: "Q (%) =",
        initial: 5,
        ...ROUT_Q,
        validate: routQError,
        step: 0.5,
      },
    ],
    finish: (a) => {
      const method = (a.method as PValueStackParams["method"] | undefined) ?? "holm-sidak";
      return {
        type: "p-value-stack",
        params: withSets(
          a,
          isFdrPValueMethod(method)
            ? { method, q: (a.q as number | undefined) ?? 5 }
            : { method, alpha: (a.alpha as number | undefined) ?? 0.05 },
        ),
      };
    },
  },

  // Normality tests (plan 23): which of the four tests, and whether to also
  // test the log-transformed values. Shapiro–Wilk is the default; the
  // D'Agostino–Pearson option names its n ≥ 20 floor (the runner still
  // reports per-column when a column is too short, since columns can
  // differ in n).
  "shapiro-wilk": {
    questions: (_, table) => [
      ...someSets(table, 1),
      choice("test", "Which normality test?", [
        ["shapiro-wilk", "Shapiro–Wilk (recommended)"],
        ["dagostino-pearson", "D'Agostino–Pearson omnibus K2 (needs n ≥ 20)"],
        ["anderson-darling", "Anderson–Darling"],
        ["kolmogorov-smirnov", "Kolmogorov–Smirnov"],
      ]),
      choice("lognormal", "Should the test also run on the log-transformed values?", [
        ["no", "Test normality only"],
        ["yes", "Also test lognormality (test log-transformed data)"],
      ]),
    ],
    finish: (a) => ({
      type: "shapiro-wilk",
      params: withSets(a, {
        test: a.test as ShapiroWilkParams["test"],
        lognormal: a.lognormal === "yes",
      }),
    }),
  },

  // One-sample Kolmogorov–Smirnov test (seq 170): which theoretical
  // distribution, and whether its parameters are entered or estimated from
  // the sample. Only the chosen distribution's parameters are asked, and
  // only when they are entered — estimated parameters need no questions.
  // The Uniform limits default to the first data column's range.
  "one-sample-ks": {
    questions: (a, table) => {
      const dist = (a.distribution as string | undefined) ?? "normal";
      const from = (a.paramsFrom as string | undefined) ?? "estimated";
      const values = table.numeric[0]?.values ?? [];
      const lo = values.length ? Math.min(...values) : 0;
      const hi = values.length ? Math.max(...values) : 1;
      return [
        ...someSets(table, 1),
        choice("distribution", "Which theoretical distribution should each data set be compared against?", [
          ["normal", "Normal (Gaussian)"],
          ["lognormal", "Lognormal"],
          ["exponential", "Exponential"],
          ["uniform", "Uniform"],
        ]),
        choice("paramsFrom", "Where do the distribution's parameters come from?", [
          ["estimated", "Estimate them from the data (the P value is then approximate)"],
          ["specified", "Enter them — the reference distribution is fully specified"],
        ]),
        from === "specified" &&
          dist === "normal" && {
            id: "mean",
            ask: "Mean of the Normal distribution?",
            kind: "number",
            label: "Mean",
            initial: 0,
          },
        from === "specified" &&
          dist === "normal" && {
            id: "sd",
            ask: "Standard deviation of the Normal distribution?",
            kind: "number",
            label: "SD",
            initial: 1,
            validate: (v) => (v > 0 ? undefined : "The SD must be greater than 0."),
          },
        from === "specified" &&
          dist === "lognormal" && {
            id: "meanlog",
            ask: "Mean of the logarithms (the Lognormal distribution's meanlog)?",
            kind: "number",
            label: "Mean of the logarithms",
            initial: 0,
          },
        from === "specified" &&
          dist === "lognormal" && {
            id: "sdlog",
            ask: "Standard deviation of the logarithms (the Lognormal distribution's sdlog)?",
            kind: "number",
            label: "SD of the logarithms",
            initial: 1,
            validate: (v) => (v > 0 ? undefined : "The SD of the logarithms must be greater than 0."),
          },
        from === "specified" &&
          dist === "exponential" && {
            id: "rate",
            ask: "Rate of the Exponential distribution (its mean is 1 / rate)?",
            kind: "number",
            label: "Rate",
            initial: 1,
            validate: (v) => (v > 0 ? undefined : "The rate must be greater than 0."),
          },
        from === "specified" &&
          dist === "uniform" && {
            id: "min",
            ask: "Lower limit of the Uniform distribution?",
            kind: "number",
            label: "Minimum",
            initial: lo,
          },
        from === "specified" &&
          dist === "uniform" && {
            id: "max",
            ask: "Upper limit of the Uniform distribution?",
            kind: "number",
            label: "Maximum",
            initial: hi,
          },
        choice("tails", "One-tailed or two-tailed P value?", [
          ["two-sided", "Two-tailed (recommended)"],
          ["less", "One-tailed: expect the sample to fall below the distribution"],
          ["greater", "One-tailed: expect the sample to fall above the distribution"],
        ]),
      ];
    },
    finish: (a) => {
      const distribution = (a.distribution as OneSampleKsParams["distribution"] | undefined) ?? "normal";
      const specified = a.paramsFrom === "specified";
      const num = (id: string, fallback: number) => (a[id] as number | undefined) ?? fallback;
      return {
        type: "one-sample-ks",
        params: withSets(a, {
          distribution,
          paramsFrom: specified ? "specified" : "estimated",
          tails: (a.tails as OneSampleKsParams["tails"] | undefined) ?? "two-sided",
          ...(specified && distribution === "normal"
            ? { mean: num("mean", 0), sd: num("sd", 1) }
            : {}),
          ...(specified && distribution === "lognormal"
            ? { meanlog: num("meanlog", 0), sdlog: num("sdlog", 1) }
            : {}),
          ...(specified && distribution === "exponential" ? { rate: num("rate", 1) } : {}),
          ...(specified && distribution === "uniform" ? { min: num("min", 0), max: num("max", 1) } : {}),
        }),
      };
    },
    checklist: () => CHECKLISTS["one-sample-ks"],
  },

  "frequency-distribution": {
    questions: (a, table) => {
      // Defaults from the first data column (the runner bins every column with
      // the same settings, so one column's scale is the honest starting point).
      const values = table.numeric[0]?.values ?? [];
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const k = sturgesCount(Math.max(values.length, 2));
      const width = niceWidthUp((max - min) / k);
      const mode = a.binMode as string | undefined;
      return [
        ...someSets(table, 1),
        choice("binMode", "How should the values be grouped into bins?", [
          ["auto", "Automatic (Sturges' rule)"],
          ["width", "Bin width"],
          ["count", "Number of bins"],
        ]),
        mode === "width" && {
          id: "binWidth",
          ask: "Each bin covers this range of values.",
          kind: "number",
          label: "Bin width",
          initial: width,
          // F6 (v1.5.0): no validation at all — 0/negative sailed through
          // to a runner error after Run. The error blocks Next/Run before
          // either, in the runner's own wording.
          validate: (v) => (v > 0 ? undefined : "The bin width must be greater than 0."),
        },
        mode === "count" && {
          id: "binCount",
          ask: "Split the range into this many bins of equal width.",
          kind: "number",
          label: "Number of bins",
          initial: k,
          min: 2,
          max: 100,
          // F5 (v1.5.0): min/max are input hints only — without `validate`,
          // 1 sailed through to a runner error after Run and 101–10000 were
          // silently accepted. The error blocks Next/Run before either.
          validate: (v) =>
            Number.isInteger(v) && v >= 2 && v <= 100
              ? undefined
              : "The number of bins must be a whole number between 2 and 100.",
        },
        (mode === "width" || mode === "count") && {
          id: "startAt",
          ask: "The lower edge of the first bin.",
          kind: "number",
          label: "First bin starts at",
          initial: mode === "width" ? floorToWidth(min, (a.binWidth as number | undefined) ?? width) : min,
        },
      ];
    },
    finish: (a) => ({
      type: "frequency-distribution",
      params: withSets(a, {
        binMode: (a.binMode as FrequencyDistributionParams["binMode"] | undefined) ?? "auto",
        ...(a.binMode === "width"
          ? { binWidth: a.binWidth as number, startAt: a.startAt as number }
          : a.binMode === "count"
            ? { binCount: a.binCount as number, startAt: a.startAt as number }
            : {}),
      }),
    }),
  },

  // Transform data (v2, item 1): one function applied to every value of the
  // chosen columns. Prism's standard set (log10, ln, log2, sqrt, reciprocal,
  // exp, square); a value the function is undefined for is left blank in
  // the results sheet, never NaN — the runner states the reason in its notes.
  "transform-data": {
    questions: (a, table) => [
      ...someSets(table, 1),
      choice("function", "Which function should be applied to the values?", [
        ["log10", "log10(Y) — logarithm, base 10"],
        ["ln", "ln(Y) — natural logarithm"],
        ["log2", "log2(Y) — logarithm, base 2"],
        ["sqrt", "sqrt(Y) — square root"],
        ["reciprocal", "1/Y — reciprocal"],
        ["exp", "exp(Y) — e to the power of Y"],
        ["square", "Y² — square"],
        ["y-plus-k", "Y+K — add a constant to every value"],
        ["y-minus-k", "Y−K — subtract a constant from every value"],
        ["y-times-k", "Y×K — multiply every value by a constant"],
        ["y-divided-by-k", "Y/K — divide every value by a constant"],
        ["k-minus-y", "K−Y — subtract every value from a constant"],
        ["k-divided-by-y", "K/Y — divide a constant by every value"],
      ]),
      isArithmeticTransform((a.function as TransformFunction | undefined) ?? "log10") && {
        id: "constant",
        ask: "What is the constant K to apply?",
        kind: "number",
        label: "Constant K",
        initial: 1,
        validate: (v) =>
          a.function === "y-divided-by-k" && v === 0
            ? "K must not be 0 for Y/K — dividing by 0 is undefined."
            : undefined,
      },
    ],
    finish: (a) => ({
      type: "transform-data",
      params: withSets(a, {
        function: (a.function as TransformFunction | undefined) ?? "log10",
        ...(isArithmeticTransform((a.function as TransformFunction | undefined) ?? "log10")
          ? { constant: a.constant as number }
          : {}),
      }),
    }),
  },
  // Transform concentrations (v2): one numeric column (an XY table's X
  // dose column, or any Y / Column-table column) between molar units.
  // The target list leaves the source unit out — converting a unit to
  // itself is a no-op, not a conversion. Mass units are not offered:
  // they need a molecular weight this operation does not collect.
  "transform-concentrations": {
    questions: (a, table) => {
      const units: [string, string][] = CONCENTRATION_UNITS.map((u) => [u, u]);
      return [
        choice(
          "column",
          "Which column holds the concentrations to convert?",
          names(dataNames(table)),
          false,
          "This table has no numeric column to convert. Enter concentrations in a column first.",
        ),
        choice("fromUnit", "Which unit are the values in now?", units),
        choice(
          "toUnit",
          "Which unit should they be converted to?",
          units.filter(([u]) => u !== a.fromUnit),
        ),
      ];
    },
    finish: (a) => ({
      type: "transform-concentrations",
      params: {
        column: a.column as string,
        fromUnit: a.fromUnit as ConcentrationUnit,
        toUnit: a.toUnit as ConcentrationUnit,
      } as TransformConcentrationsParams,
    }),
  },

  "bland-altman": {
    questions: (a, table, tableType) => {
      // On an XY table the X column is the independent variable (time,
      // dose…) — not a measurement method. Offering it as a "method" let
      // the wizard present an X − Y difference's bias/limits as a method
      // comparison, which is scientifically meaningless, so only the Y
      // columns are methods there. A column table has no X, so every
      // numeric column stays a method.
      const isXY = tableType === "xy";
      const methods = isXY ? yNames(table) : dataNames(table);
      return [
        choice("first", "Which column is the first method?", names(methods)),
        choice(
          "second",
          "Which column is the second method? The difference is computed as first − second.",
          names(methods.filter((n) => n !== a.first)),
          false,
          isXY
            ? "This table has only one Y data set, so there is no second method to choose. Add another Y column first."
            : "This table has only one numeric column, so there is no second method to choose. Add another numeric column first.",
        ),
      ];
    },
    finish: (a) => ({ type: "bland-altman", params: { sets: [a.first as string, a.second as string] } }),
  },

  "roc-curve": {
    questions: (a, table) => {
      // The truth column may be text ("Diseased"/"Healthy"), so it is picked
      // among all columns; the score must hold numbers.
      const truthCol = table.columns.find((c) => c.name === a.truth) ?? table.columns[0];
      const distinct = truthCol ? distinctTruthValues(truthCol) : [];
      // The default positive class is the largest value, so it comes first
      // (the wizard pre-selects the first option); the question says so, so
      // a text-outcome user picks deliberately.
      const ordered = [...distinct].sort((x, y) => {
        const nx = Number(x);
        const ny = Number(y);
        if (Number.isFinite(nx) && Number.isFinite(ny)) return ny - nx;
        return y.localeCompare(x);
      });
      return [
        choice(
          "truth",
          "Which column holds the known outcome (e.g. diseased / healthy)?",
          names(table.columns.map((c) => c.name)),
        ),
        choice(
          "score",
          "Which column holds the test score?",
          names(dataNames(table).filter((n) => n !== a.truth)),
          false,
          "The truth column is the table's only numeric column, so no column is left to hold the test score. Go back and choose a text column as the truth, or add another numeric column.",
        ),
        distinct.length > 0 &&
          choice(
            "positive",
            "Which outcome value counts as positive (diseased)? The largest value is the default.",
            names(ordered),
          ),
      ];
    },
    finish: (a, table) => {
      const truthCol = table.columns.find((c) => c.name === a.truth);
      const distinct = truthCol ? distinctTruthValues(truthCol) : [];
      const numeric = distinct.length > 0 && distinct.every((v) => Number.isFinite(Number(v)));
      return {
        type: "roc-curve",
        params: {
          truth: a.truth as string,
          score: a.score as string,
          positive: a.positive === undefined ? undefined : numeric ? Number(a.positive) : (a.positive as string),
        },
      };
    },
  },

  // Monte Carlo (plan 22, sub-task b): repeat a chosen analysis on simulated
  // data. v1 repeats only the five targets below — each one's per-repeat
  // statistic has a one-call in-R `replicate()` form, so 10,000 repeats take
  // seconds, not minutes (a per-repeat round-trip would take ~5 min). The
  // simulation is Gaussian per data set, with each set's mean/SD defaulting
  // to its observed mean/SD (a parametric bootstrap) — set the means to the
  // effect you want to test (e.g. two groups 0 and 0.5 apart, SD 1) and the
  // "% P < 0.05" row reads the power. Tails are two-sided in v1; Grouped
  // tables have no v1 target (two-way ANOVA is a follow-on), so the picker
  // does not offer Monte Carlo there.
  "monte-carlo": {
    questions: (a, table, tableType) => {
      const isXY = tableType === "xy";
      const targets: [string, string][] = isXY
        ? [
            ["linear-regression", "Linear regression (repeat its slope)"],
            ["correlation", "Correlation (repeat its r)"],
          ]
        : [
            ["compare-two-groups", "Compare two groups (repeat its t test)"],
            ["one-sample-t", "Compare one group to a value (repeat its t test)"],
            ["descriptive-statistics", "Descriptive statistics (repeat its mean)"],
            ["paired-t", "Paired t test (repeat its t test on the paired differences)"],
            ["one-way-anova", "One-way ANOVA (repeat its F test)"],
          ];
      const target = (a.target as MonteCarloTarget | undefined) ?? (targets[0][0] as MonteCarloTarget);
      const statistics = MONTE_CARLO_TARGET_STATISTICS[target];
      const statistic = (a.statistic as MonteCarloStatistic | undefined) ?? statistics[0];
      const isTTarget =
        target === "compare-two-groups" || target === "one-sample-t" || target === "paired-t";
      // The data sets the repeats simulate: compare-two-groups / paired-t
      // take the two chosen (or first two) columns; one-way ANOVA takes
      // every chosen column; one-sample-t / descriptive-statistics the one
      // chosen column; the XY targets the chosen Y series.
      const dataCols = dataNames(table);
      const yCols = yNames(table);
      const groupNames: string[] =
        target === "compare-two-groups" || target === "paired-t"
          ? (chosenSets(a) ?? dataCols.slice(0, 2))
          : target === "one-way-anova"
            ? (chosenSets(a) ?? dataCols)
            : target === "one-sample-t" || target === "descriptive-statistics"
              ? [(a.group as string | undefined) ?? dataCols[0]].filter((n): n is string => n !== undefined)
              : [(a.y as string | undefined) ?? yCols[0]].filter((n): n is string => n !== undefined);
      // Paired-t simulates the differences, not the two columns — so it
      // asks for the difference mean/SD (observed values as the start),
      // where the other targets ask per-column.
      const pairedDiff =
        target === "paired-t"
          ? pairedDifferences(
              table.numeric.find((c) => c.name === groupNames[0]) ?? { byRow: [] },
              table.numeric.find((c) => c.name === groupNames[1]) ?? { byRow: [] },
            )
          : [];
      const { mean: diffMean, sd: diffSd } = meanSd(pairedDiff);
      const simQuestions: (Question | false)[] =
        target === "paired-t"
          ? [
              {
                id: "differenceMean",
                ask: `Mean difference to simulate (observed ${round6(diffMean)})? Set it to the effect you want to test.`,
                kind: "number",
                label: "Mean difference",
                initial: round6(diffMean),
              },
              {
                id: "differenceSd",
                ask: `SD of the differences to simulate (observed ${round6(diffSd)})?`,
                kind: "number",
                label: "SD of the differences",
                initial: round6(diffSd),
                validate: (v) => (v > 0 ? undefined : "The SD must be greater than 0."),
              },
            ]
          : groupNames.flatMap((name): (Question | false)[] => {
              const column = table.numeric.find((c) => c.name === name);
              const { mean, sd } = meanSd(column?.values ?? []);
              const observed = column ? ` (observed ${round6(mean)} ± ${round6(sd)})` : "";
              return [
                {
                  id: `mean:${name}`,
                  ask: `Mean to simulate for “${name}”${observed}? Set it to the effect you want to test.`,
                  kind: "number",
                  label: `Mean for “${name}”`,
                  initial: round6(mean),
                },
                {
                  id: `sd:${name}`,
                  ask: `SD to simulate for “${name}”${observed}?`,
                  kind: "number",
                  label: `SD for “${name}”`,
                  initial: round6(sd),
                  validate: (v) => (v > 0 ? undefined : "The SD must be greater than 0."),
                },
              ];
            });
      return [
        choice(
          "target",
          "Which analysis should be repeated? Each repeat draws new simulated data for the data sets below and runs the analysis on it.",
          targets,
        ),
        choice("simulationDistribution", "What distribution should the simulated values come from?", [
          ["gaussian", "Gaussian — the usual bell curve"],
          ["t", "Student's t — wider scatter, more outliers"],
        ]),
        a.simulationDistribution === "t" && {
          id: "simulationDf",
          ask: "Degrees of freedom for the t simulation? Lower df means wider scatter (5 is a good middle ground).",
          kind: "number",
          label: "Degrees of freedom",
          initial: 5,
          validate: (v) =>
            v > 2
              ? undefined
              : "Degrees of freedom must be greater than 2 — at df ≤ 2 the t distribution has no finite SD to simulate from.",
        },
        statistics.length > 1 &&
          choice(
            "statistic",
            "Which result should be summarised across the repeats?",
            statistics.map((s): [string, string] => [s, s]),
          ),
        isTTarget &&
          statistic === "P value" &&
          choice("tails", "One- or two-sided P value?", [
            ["two-sided", "Two-sided"],
            ["less", "One-sided — the first group (or mean) is less"],
            ["greater", "One-sided — the first group (or mean) is greater"],
          ]),
        ...(target === "compare-two-groups"
          ? [
              ...twoSets(a, table),
              choice("equalVariance", "Assume the two groups have equal variances?", [
                ["yes", "Yes — Student's t test"],
                ["no", "No — Welch's t test"],
              ]),
            ]
          : []),
        ...(target === "paired-t" ? [...twoSets(a, table)] : []),
        ...(target === "one-way-anova" ? someSets(table, 2) : []),
        (target === "one-sample-t" || target === "descriptive-statistics") &&
          dataCols.length > 1 &&
          choice("group", "Which data set should be repeated?", names(dataCols)),
        target === "one-sample-t" && {
          id: "hypotheticalValue",
          ask: "Which hypothetical value should each repeat be tested against?",
          kind: "number",
          label: "Hypothetical value",
          initial: 0,
        },
        (target === "linear-regression" || target === "correlation") &&
          choice("y", "Which Y data set should be simulated?", names(yCols)),
        target === "correlation" &&
          choice("method", "Which correlation coefficient should be repeated?", [
            ["pearson", "Pearson (parametric)"],
            ["spearman", "Spearman (non-parametric)"],
          ]),
        ...simQuestions,
        {
          id: "repeats",
          ask: "How many times should the analysis be repeated? More repeats give a steadier power estimate; 1,000 is usually enough, 10,000 takes ~15–25 seconds.",
          kind: "number",
          label: "Repeats",
          initial: 1000,
          min: MONTE_CARLO_REPEATS.min,
          max: MONTE_CARLO_REPEATS.max,
          validate: (v) =>
            !Number.isInteger(v)
              ? "Repeats must be a whole number."
              : v < MONTE_CARLO_REPEATS.min || v > MONTE_CARLO_REPEATS.max
                ? `Repeats must be from ${MONTE_CARLO_REPEATS.min} to ${MONTE_CARLO_REPEATS.max}.`
                : undefined,
        },
        {
          id: "seed",
          ask: "Seed for the simulation — the same seed + same settings reproduce the same repeats.",
          kind: "number",
          label: "Seed",
          initial: 42,
          validate: (v) => (Number.isInteger(v) ? undefined : "The seed must be a whole number."),
        },
      ];
    },
    finish: (a, table, tableType) => {
      const isXY = tableType === "xy";
      const target = (a.target as MonteCarloTarget | undefined) ??
        (isXY ? "linear-regression" : "compare-two-groups");
      const statistics = MONTE_CARLO_TARGET_STATISTICS[target];
      const statistic = (a.statistic as MonteCarloStatistic | undefined) ?? statistics[0];
      const isTTarget =
        target === "compare-two-groups" || target === "one-sample-t" || target === "paired-t";
      const dataCols = dataNames(table);
      const yCols = yNames(table);
      const groupNames: string[] =
        target === "compare-two-groups" || target === "paired-t"
          ? (chosenSets(a) ?? dataCols.slice(0, 2))
          : target === "one-way-anova"
            ? (chosenSets(a) ?? dataCols)
            : target === "one-sample-t" || target === "descriptive-statistics"
              ? [(a.group as string | undefined) ?? dataCols[0]]
              : [(a.y as string | undefined) ?? yCols[0]];
      const groupMeans: Record<string, number> = {};
      const groupSds: Record<string, number> = {};
      // Paired-t simulates the differences, so its overrides are the
      // difference mean/SD — not per-column groupMeans/groupSds.
      if (target !== "paired-t") {
        for (const name of groupNames) {
          if (typeof a[`mean:${name}`] === "number") groupMeans[name] = a[`mean:${name}`] as number;
          if (typeof a[`sd:${name}`] === "number") groupSds[name] = a[`sd:${name}`] as number;
        }
      }
      const simulationDistribution =
        (a.simulationDistribution as MonteCarloSimulationDistribution | undefined) ?? "gaussian";
      return {
        type: "monte-carlo",
        params: withSets(a, {
          targetAnalysis: target,
          summaryStatistic: statistic,
          repeats: a.repeats as number,
          seed: a.seed as number,
          groupMeans,
          groupSds,
          simulationDistribution,
          ...(simulationDistribution === "t" ? { simulationDf: a.simulationDf as number } : {}),
          ...(isTTarget && statistic === "P value"
            ? { tails: (a.tails as MonteCarloParams["tails"] | undefined) ?? "two-sided" }
            : {}),
          ...(target === "compare-two-groups" ? { equalVariance: a.equalVariance !== "no" } : {}),
          ...(target === "one-sample-t" ? { hypotheticalValue: a.hypotheticalValue as number } : {}),
          ...(target === "paired-t"
            ? {
                differenceMean: a.differenceMean as number,
                differenceSd: a.differenceSd as number,
              }
            : {}),
          ...(target === "one-sample-t" || target === "descriptive-statistics"
            ? { sets: groupNames }
            : {}),
          ...(target === "linear-regression" || target === "correlation" ? { y: groupNames[0] } : {}),
          ...(target === "correlation" ? { method: (a.method as "pearson" | "spearman" | undefined) ?? "pearson" } : {}),
        }),
      };
    },
  },

  correlation: {
    questions: (a, table) => {
      const ys = yNames(table);
      // "Two chosen data sets" needs two Y series to choose from (M18):
      // with one Y it would ask for a second data set that does not exist.
      const modes: [string, string][] = [["x-vs-every-y", "X against every Y data set"]];
      if (ys.length >= 2) modes.push(["two-datasets", "Two chosen data sets"]);
      modes.push(["matrix", "Correlation matrix among the Y data sets"]);
      return [
        choice("method", "Which correlation coefficient should be computed?", [
          ["pearson", "Pearson (parametric)"],
          ["spearman", "Spearman (non-parametric)"],
        ]),
        choice("mode", "What do you want to correlate?", modes),
        a.mode === "two-datasets" && choice("first", "Which is the first data set?", names(ys)),
        a.mode === "two-datasets" &&
          choice(
            "second",
            "Which is the second data set?",
            names(ys.filter((n) => n !== a.first)),
            false,
            "This table has only one Y data set, so there is no second data set to choose. Go back and choose “X against every Y data set” instead.",
          ),
      ];
    },
    finish: (a) => ({
      type: "correlation",
      params: {
        method: a.method as XYCorrelationParams["method"],
        mode: a.mode as XYCorrelationParams["mode"],
        ...(a.mode === "two-datasets" ? { datasets: [a.first as string, a.second as string] as [string, string] } : {}),
      },
    }),
    checklist: (a) => CHECKLISTS[a.method === "spearman" ? "correlation-spearman" : "correlation-pearson"],
  },

  "linear-regression": {
    // A Multiple Variables table has no X column: both variables are asked.
    questions: (a, table, type) => [
      type === "multiple" && choice("x", "Which variable is X?", names(dataNames(table))),
      type === "multiple"
        ? choice("y", "Which variable is Y?", names(dataNames(table).filter((n) => n !== a.x)))
        : ysQuestion(table, "Which Y data sets should be regressed on X? Each is regressed on its own."),
      choice("origin", "Force the line through the origin (0,0)?", [
        ["no", "No — fit both slope and Y-intercept (recommended)"],
        ["yes", "Yes — assume Y = 0 when X = 0"],
      ]),
      // Plan 26: weighting (1/SD² needs the replicate columns this runner
      // never sees, so it is not offered here). Only an XY table's regression
      // on X is weighted — a Multiple Variables table regresses two named
      // columns, and asks no weighting question.
      ...(type === "xy"
        ? [
            choice("weights", "Weight the points?", [
              ["none", "No weighting (recommended unless scatter grows with Y)"],
              ["1/y", "Weight by 1/Y"],
              ["1/y2", "Weight by 1/Y²"],
              ["1/x", "Weight by 1/X"],
              ["1/x2", "Weight by 1/X²"],
            ]),
          ]
        : []),
    ],
    finish: (a) => ({
      type: "linear-regression",
      params: {
        ...(a.x === undefined ? { ...fittedYs(a) } : { x: a.x as string, y: a.y as string }),
        forceOrigin: a.origin === "yes",
        ...(a.weights !== undefined && a.weights !== "none"
          ? { weights: a.weights as LinearRegressionParams["weights"] }
          : {}),
      },
    }),
    checklist: () => CHECKLISTS["linear-regression"],
  },

  "deming-regression": {
    questions: (_, table) => [
      choice("y", "Which Y data set should be compared with X?", names(yNames(table))),
      {
        id: "lambda",
        ask: "What is the error variance ratio (λ = error in Y ÷ error in X)? 1 = both methods have equal error. Use the ratio of the squared standard deviations if you know them.",
        kind: "number",
        label: "Error variance ratio (λ = error in Y ÷ error in X).",
        initial: 1,
        validate: (v) => (v > 0 ? undefined : "The error variance ratio must be greater than 0."),
      },
    ],
    finish: (a) => ({ type: "deming-regression", params: { y: a.y as string, lambda: a.lambda as number } }),
  },

  "simple-logistic-regression": {
    questions: (_, table) => [
      yNames(table).length > 1 && choice("y", "Which Y data set holds the outcome, 1 or 0?", names(yNames(table))),
    ],
    finish: (a) => ({ type: "simple-logistic-regression", params: a.y === undefined ? {} : { y: a.y as string } }),
  },

  "area-under-curve": {
    questions: () => [
      {
        id: "baseline",
        ask: "From which baseline should each data set's area be measured? Area below it counts as negative.",
        kind: "number",
        label: "Baseline Y =",
        initial: 0,
      },
    ],
    finish: (a) => ({ type: "area-under-curve", params: { baseline: a.baseline as number } }),
  },

  // Remove baseline (v2): subtract a baseline from a curve — Prism's Analyze >
  // Remove Baseline. The X column (XY tables) is carried into the result
  // rows; on a Column table every chosen column is its own data set.
  "remove-baseline": {
    questions: (a, table, tableType) => {
      const targets = tableType === "xy" ? yNames(table) : dataNames(table);
      if (!targets.length) return [];
      const mode = (a.mode as string | undefined) ?? "remove-baseline";
      const modeQuestion = choice("mode", "What should this analysis do?", [
        ["remove-baseline", "Remove a baseline — subtract a baseline from each value"],
        ["column-math", "Combine two columns — add, subtract, multiply or divide two data sets row by row"],
      ]);
      // Column math (seq 206, Prism's "Remove baseline and column math"):
      // two columns combined row by row, instead of a baseline removed.
      if (mode === "column-math") {
        return [
          modeQuestion,
          choice("columnMathA", "Which is the first column?", names(targets)),
          choice("columnMathB", "Which is the second column?", names(targets)),
          choice("columnMathOperation", "How should the two columns be combined?", [
            ["subtract", "Subtract — first minus second"],
            ["divide", "Divide — first divided by second"],
            ["multiply", "Multiply — first times second"],
            ["add", "Add — first plus second"],
          ]),
        ];
      }
      const method = a.baselineMethod as string | undefined;
      return [
        modeQuestion,
        {
          id: "ys",
          ask: "Which data sets should have the baseline removed?",
          kind: "names",
          options: targets,
          min: 1,
        },
        choice("baselineMethod", "What should be subtracted from each value?", [
          ["first-value", "First value — each data set's first value"],
          ["mean-first-n", "Mean of the first N values"],
          ["mean-of-controls", "Mean of control column(s)"],
          ["constant", "A constant value"],
        ]),
        method === "mean-first-n" && {
          id: "firstN",
          ask: "How many first values should be averaged for the baseline?",
          kind: "number",
          label: "Number of first values (N)",
          initial: 3,
          min: 1,
          validate: (v) =>
            Number.isInteger(v) && v >= 1 ? undefined : "Enter a whole number of 1 or more.",
        },
        method === "mean-of-controls" && {
          id: "controls",
          ask: "Which column(s) are the controls? Their values are averaged for the baseline.",
          kind: "names",
          options: dataNames(table),
          min: 1,
        },
        method === "constant" && {
          id: "constant",
          ask: "What constant value should be subtracted from each value? (Or {{Constant name}} to hook it to an info sheet.)",
          kind: "text",
          label: "Constant baseline value",
          initial: "0",
          parse: (text: string) => parseHookableRequiredNumber(text, "constant baseline value"),
        },
      ];
    },
    finish: (a, table, tableType) => {
      if (a.mode === "column-math") {
        return {
          type: "remove-baseline",
          params: {
            columnMathOperation: a.columnMathOperation as RemoveBaselineParams["columnMathOperation"],
            columnMathA: a.columnMathA as string,
            columnMathB: a.columnMathB as string,
            ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
          },
        };
      }
      return {
        type: "remove-baseline",
        params: {
          ys: a.ys as string[],
          ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
          baselineMethod: a.baselineMethod as RemoveBaselineParams["baselineMethod"],
          ...(a.baselineMethod === "mean-first-n" ? { firstN: a.firstN as number } : {}),
          ...(a.baselineMethod === "mean-of-controls" ? { controls: a.controls as string[] } : {}),
          ...(a.baselineMethod === "constant" ? constantParam(a.constant) : {}),
        },
      };
    },
  },

  "prune-rows": {
    questions: (a, table, tableType) => {
      const targets = tableType === "xy" ? yNames(table) : dataNames(table);
      if (!targets.length) return [];
      const condition = a.condition as string | undefined;
      return [
        {
          id: "ys",
          ask: "Which data sets should rows be pruned from?",
          kind: "names",
          options: targets,
          min: 1,
        },
        choice("condition", "Which rows should be dropped?", [
          ["empty", "Empty rows — the row holds no value in any chosen data set"],
          ["below", "Rows below a threshold — every value in the row is below it"],
          ["above", "Rows above a threshold — every value in the row is above it"],
          ["outside", "Rows outside a range — every value in the row is outside it"],
        ]),
        (condition === "below" || condition === "above") && {
          id: "threshold",
          ask:
            condition === "below"
              ? "Drop rows whose every value is below what threshold?"
              : "Drop rows whose every value is above what threshold?",
          kind: "number",
          label: "Threshold value",
          initial: 0,
        },
        condition === "outside" && {
          id: "low",
          ask: "What is the low end of the range? Rows whose every value is below it (or above the high end) are dropped.",
          kind: "number",
          label: "Low end of the range",
          initial: 0,
        },
        condition === "outside" && {
          id: "high",
          ask: "What is the high end of the range? Rows whose every value is above it (or below the low end) are dropped.",
          kind: "number",
          label: "High end of the range",
          initial: 100,
        },
      ];
    },
    finish: (a, table, tableType) => ({
      type: "prune-rows",
      params: {
        ys: a.ys as string[],
        ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
        condition: a.condition as PruneRowsParams["condition"],
        ...(a.condition === "below" || a.condition === "above" ? { threshold: a.threshold as number } : {}),
        ...(a.condition === "outside" ? { low: a.low as number, high: a.high as number } : {}),
      },
    }),
  },

  "fraction-of-total": {
    questions: (_, table, tableType) => {
      const targets = tableType === "xy" ? yNames(table) : dataNames(table);
      if (!targets.length) return [];
      return [
        {
          id: "ys",
          ask: "Which data sets should be expressed as a fraction of their total?",
          kind: "names",
          options: targets,
          min: 1,
        },
        choice("totalBy", "Divide each value by…", [
          ["column", "Its column total — each value as a share of its data set"],
          ["row", "Its row total — each value as a share of its row"],
          ["grand", "The grand total — each value as a share of all the chosen values"],
        ]),
        choice("format", "Show the result as…", [
          ["fraction", "Fractions (0 to 1)"],
          ["percent", "Percentages (0 to 100)"],
        ]),
      ];
    },
    finish: (a, table, tableType) => ({
      type: "fraction-of-total",
      params: {
        ys: a.ys as string[],
        ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
        totalBy: a.totalBy as FractionOfTotalParams["totalBy"],
        format: a.format as FractionOfTotalParams["format"],
      },
    }),
  },

  "row-means-totals": {
    questions: (_, table, tableType) => {
      // XY: the Y data sets; Grouped: the groups (each spanning its
      // replicate columns), so a row is summarised across every replicate.
      const targets =
        tableType === "xy"
          ? yNames(table)
          : tableType === "grouped"
            ? table.sets.filter((s) => s.columns.some((c) => c.values.length > 0)).map((s) => s.name)
            : dataNames(table);
      if (!targets.length) return [];
      return [
        {
          id: "ys",
          ask: "Which data sets should each row be summarised across?",
          kind: "names",
          options: targets,
          min: 1,
        },
        choice("rowScope", "Should each row be summarised across all the data sets together, or separately within each one?", [
          ["pooled", "Across all data sets together — one summary per row"],
          ["per-column", "Within each data set separately — one summary per row per data set"],
        ]),
      ];
    },
    finish: (a, table, tableType) => ({
      type: "row-means-totals",
      params: {
        ys: a.ys as string[],
        ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
        rowScope: (a.rowScope as RowMeansTotalsParams["rowScope"]) ?? "pooled",
      } satisfies RowMeansTotalsParams,
    }),
  },

  // "Plot a function" (Prism's Generate Curve): no data is analysed — the
  // curves come from an equation + parameters. The equation is asked first
  // (the X range and the per-curve questions follow it), then the range, the
  // line segments, the extra series, and how many curves the family holds;
  // each curve then gets a name and one question per parameter. The
  // homologous model also needs its [L] constant, as the fitter does.
  "plot-function": {
    questions: (a) => {
      const model = a.equation as PlotFunctionModel | undefined;
      const count = (a.curves as number | undefined) ?? 1;
      const [defMin, defMax] = plotFunctionXRange(model ?? "line");
      const paramNames = model ? plotFunctionParams(model) : [];
      return [
        choice(
          "equation",
          "Which equation should the curve come from?",
          PLOT_FUNCTION_MODELS.map((m): [string, string] => [m, PLOT_FUNCTION_LABEL[m]]),
        ),
        {
          id: "xMin",
          ask: "Where should the X axis start?",
          kind: "number",
          label: "Starting X",
          initial: defMin,
        },
        {
          id: "xMax",
          ask: "Where should the X axis end?",
          kind: "number",
          label: "Ending X",
          initial: defMax,
        },
        {
          id: "segments",
          ask: "How many line segments should draw each curve? (Prism's default is 150 — more segments draw a smoother curve.)",
          kind: "number",
          label: "Line segments",
          initial: PLOT_FUNCTION_SEGMENTS.default,
          min: PLOT_FUNCTION_SEGMENTS.min,
          max: PLOT_FUNCTION_SEGMENTS.max,
        },
        choice("extra", "Plot anything alongside the function?", [
          ["none", "No — the function only"],
          ["first-derivative", "Its first derivative"],
          ["second-derivative", "Its second derivative"],
          ["integral", "Its integral"],
        ]),
        {
          id: "curves",
          ask: "How many curves should this family hold? (Each gets its own parameter values.)",
          kind: "number",
          label: "Curves",
          initial: 1,
          min: 1,
          max: PLOT_FUNCTION_MAX_CURVES,
        },
        model === "homologous-competition-logx" && {
          id: "ligandConcentration",
          ask: "Radioligand concentration [L], in the same units as X.",
          kind: "text",
          label: "Radioligand concentration [L] =",
          initial: "",
          placeholder: "e.g. 1",
          parse: (text: string) => parseRequiredPositive(text, "radioligand concentration [L]"),
        },
        ...(model
          ? Array.from({ length: count }, (_, i) => i).flatMap((i): Question[] => [
              {
                id: `curve${i + 1}_label`,
                ask: `What should curve ${i + 1} be called? (Leave blank for “Curve ${i + 1}”.)`,
                kind: "text",
                label: `Curve ${i + 1} name`,
                initial: "",
                parse: () => ({}),
              },
              ...paramNames.map(
                (name): Question => ({
                  id: `curve${i + 1}_${name}`,
                  ask: `Curve ${i + 1}: what is ${name}?`,
                  kind: "number",
                  label: name,
                  initial: PLOT_FUNCTION_DEFAULTS[model][name] ?? 0,
                }),
              ),
            ])
          : []),
      ];
    },
    finish: (a) => {
      const model = a.equation as PlotFunctionModel;
      const count = (a.curves as number | undefined) ?? 1;
      const paramNames = plotFunctionParams(model);
      const ligand = parseRequiredPositive(String(a.ligandConcentration ?? ""), "radioligand concentration [L]");
      return {
        type: "plot-function",
        params: {
          equation: model,
          xMin: a.xMin as number,
          xMax: a.xMax as number,
          segments: a.segments as number,
          curves: Array.from({ length: count }, (_, i) => ({
            label: String(a[`curve${i + 1}_label`] ?? "").trim() || `Curve ${i + 1}`,
            params: Object.fromEntries(paramNames.map((name) => [name, a[`curve${i + 1}_${name}`] as number])),
          })),
          extra: (a.extra as PlotFunctionExtra | "none" | undefined) ?? "none",
          ...(model === "homologous-competition-logx" && ligand.value !== undefined
            ? { ligandConcentration: ligand.value }
            : {}),
        } satisfies PlotFunctionParams,
      };
    },
  },

  "normalize": {
    questions: (a, table, tableType) => {
      const targets = tableType === "xy" ? yNames(table) : dataNames(table);
      if (!targets.length) return [];
      const method = a.normalizeMethod as string | undefined;
      return [
        {
          id: "ys",
          ask: "Which data sets should be normalized?",
          kind: "names",
          options: targets,
          min: 1,
        },
        choice("normalizeMethod", "How should each value be rescaled?", [
          ["percent-of-largest", "Percent of the largest value in each data set (100% = largest)"],
          ["percent-of-smallest", "Percent of the smallest value in each data set (100% = smallest)"],
          ["percent-of-first", "Percent of the first value in each data set (100% = first)"],
          ["percent-of-mean-controls", "Percent of the mean of control column(s) (100% = control mean)"],
          ["percent-of-constant", "Percent of a constant value you enter (100% = constant)"],
          ["zero-to-hundred", "0–100% — define 0% and 100% separately"],
        ]),
        method !== undefined &&
          method !== "zero-to-hundred" &&
          choice("scale", "Express the results as a percent or a fraction?", [
            ["percent", "Percent — multiply by 100"],
            ["fraction", "Fraction — 1 = 100%"],
          ]),
        method === "percent-of-mean-controls" && {
          id: "controls",
          ask: "Which column(s) are the controls? Their values are averaged for the 100% reference.",
          kind: "names",
          options: dataNames(table),
          min: 1,
        },
        method === "percent-of-constant" && {
          id: "constant",
          ask: "What value is 100%? (Or {{Constant name}} to hook it to an info sheet.)",
          kind: "text",
          label: "100% reference value",
          initial: "100",
          parse: (text: string) => parseHookableRequiredNumber(text, "100% reference value"),
        },
        method === "zero-to-hundred" &&
          choice("zeroDef", "What is 0%?", [
            ["smallest", "Smallest value in each data set"],
            ["first", "Value in the first row of each data set"],
            ["constant", "A value you enter"],
          ]),
        method === "zero-to-hundred" &&
          a.zeroDef === "constant" && {
            id: "zeroConstant",
            ask: "What value is 0%? (Or {{Constant name}} to hook it to an info sheet.)",
            kind: "text",
            label: "0% value",
            initial: "0",
            parse: (text: string) => parseHookableRequiredNumber(text, "0% value"),
          },
        method === "zero-to-hundred" &&
          choice("hundredDef", "What is 100%?", [
            ["largest", "Largest value in each data set"],
            ["last", "Value in the last row of each data set"],
            ["constant", "A value you enter"],
            ["sum", "Sum of all values in the column"],
          ]),
        method === "zero-to-hundred" &&
          a.hundredDef === "constant" && {
            id: "hundredConstant",
            ask: "What value is 100%? (Or {{Constant name}} to hook it to an info sheet.)",
            kind: "text",
            label: "100% value",
            initial: "100",
            parse: (text: string) => parseHookableRequiredNumber(text, "100% value"),
          },
      ];
    },
    finish: (a, table, tableType) => ({
      type: "normalize",
      params: {
        ys: a.ys as string[],
        ...(tableType === "xy" ? { x: table.columns[0]?.name } : {}),
        normalizeMethod: a.normalizeMethod as NormalizeParams["normalizeMethod"],
        ...((a.normalizeMethod as string) !== "zero-to-hundred" ? { asPercent: a.scale !== "fraction" } : {}),
        ...(a.normalizeMethod === "percent-of-mean-controls" ? { controls: a.controls as string[] } : {}),
        ...(a.normalizeMethod === "percent-of-constant" ? constantParam(a.constant) : {}),
        ...(a.normalizeMethod === "zero-to-hundred"
          ? {
              zeroDef: a.zeroDef as NormalizeParams["zeroDef"],
              hundredDef: a.hundredDef as NormalizeParams["hundredDef"],
              ...(a.zeroDef === "constant" ? zeroConstantParam(a.zeroConstant) : {}),
              ...(a.hundredDef === "constant" ? hundredConstantParam(a.hundredConstant) : {}),
            }
          : {}),
      },
    }),
  },

  "nonlinear-regression": {
    questions: (a, table, type) => {
      const isMV = type === "multiple";
      const dose = a.kind !== "other";
      const models = (dose ? DOSE_MODELS : NONLINEAR_MODELS.filter((m) => !isDoseModel(m))).map(
        (m): [string, string] => [m, MODEL_LABEL[m]],
      );
      // One data set fitted can be compared with another's curve; several are each fitted.
      // A Multiple Variables table names its X and Y variables instead, so there are no
      // other Y data sets to compare with or fit globally — `others` stays empty and those
      // questions hide, as they do on an XY table with one Y.
      const ys = isMV
        ? ((a.y as string | undefined) === undefined ? [] : [a.y as string])
        : ((a.ys as string[] | undefined) ?? yNames(table).slice(0, 1));
      const others = isMV ? [] : ys.length === 1 ? yNames(table).filter((n) => n !== ys[0]) : [];
      const modelName = String(a.model ?? "");
      const midpoint = modelName.startsWith("inhibitor")
        ? "IC50"
        : modelName.startsWith("two-site")
          ? "IC50 (high affinity)"
          : modelName === "homologous-competition-logx"
            ? "Kd"
            : "EC50";
      // Plan 26: the weighting options (1/SD² only when the table has
      // replicates to take an SD over), the model comparison, the global
      // fit, and the parameter constraints. A Multiple Variables fit has no
      // replicates, so 1/SD² is not offered there.
      const weightOptions: [string, string][] = [
        ["none", "No weighting (recommended unless scatter grows with Y)"],
        ["1/y", "Weight by 1/Y"],
        ["1/y2", "Weight by 1/Y²"],
        ["1/x", "Weight by 1/X"],
        ["1/x2", "Weight by 1/X²"],
        ...(!isMV && yNames(table).length > 1 ? [["1/sd2", "Weight by 1/SD² (needs replicates)"] as [string, string]] : []),
      ];
      const terms = a.model
        ? a.model === "user-defined"
          ? (() => {
              const parsed = parseUserEquation(String(a.customEquation ?? ""));
              return "error" in parsed ? [] : parsed.params;
            })()
          : modelSpec(a.model as NonlinearModel).terms
        : [];
      return [
        ...(isMV
          ? [
              choice("x", "Which variable is X?", names(dataNames(table))),
              choice("y", "Which variable is Y?", names(dataNames(table).filter((n) => n !== a.x))),
            ]
          : [ysQuestion(table, "Which Y data sets should be fitted? Each is fitted on its own.")]),
        choice("kind", "Which kind of curve?", [
          ["dose", "Dose-response (sigmoidal)"],
          ["other", "Another curve (line, polynomial, exponential, Michaelis-Menten…)"],
        ]),
        choice("model", "Which curve should be fitted to X and Y?", models),
        // v2 item 23: a user-defined equation — the equation first, then one starting
        // value per parameter it names. The comparison and global-fit questions below
        // are hidden for it (the runner cannot build those from an equation yet).
        a.model === "user-defined" && {
          id: "customEquation",
          ask: "Type your equation, with X as the independent variable and named parameters — for example “Y = A*exp(-k*X) + C”. Functions: exp, log (natural), log10, log2, sqrt, abs, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, expm1, log1p; pi is the constant.",
          kind: "text",
          label: "Equation =",
          initial: "",
          placeholder: "Y = A*exp(-k*X) + C",
          parse: (text: string) => {
            const parsed = parseUserEquation(text);
            return "error" in parsed ? parsed : {};
          },
        },
        a.model === "user-defined" &&
          a.customEquation !== undefined && {
            id: "customParameters",
            ask: "Starting value for each parameter, as “name=value” separated by commas — the fit searches from these, so values read off the data work best.",
            kind: "text",
            label: "Starting values =",
            initial: "",
            placeholder: "A=8, k=0.3, C=1",
            parse: (text: string) => {
              const parsed = parseUserEquation(String(a.customEquation ?? ""));
              if ("error" in parsed) return { error: parsed.error };
              return parseCustomParameters(text, parsed.params);
            },
          },
        choice("weights", "Weight the points?", weightOptions),
        // Seq 166 (Prism 11 Range tab): "Don't fit points when X is less
        // than / greater than …" — points outside the range are ignored
        // entirely. Either bound alone is enough; both blank fits all.
        choice("fitRange", "Only fit points within an X range?", [
          ["no", "No — fit every point"],
          ["yes", "Yes — ignore points outside an X range"],
        ]),
        a.fitRange === "yes" && {
          id: "fitXMin",
          ask: "Don't fit points when X is less than… (leave blank for no lower limit)",
          kind: "text",
          label: "Don't fit points when X <",
          initial: "",
          placeholder: "e.g. 0",
          parse: (text: string) => parseOptionalNumber(text, "lower X limit"),
        },
        a.fitRange === "yes" && {
          id: "fitXMax",
          ask: "Don't fit points when X is greater than… (leave blank for no upper limit)",
          kind: "text",
          label: "Don't fit points when X >",
          initial: "",
          placeholder: "e.g. 10",
          parse: (text: string) => parseOptionalNumber(text, "upper X limit"),
        },
        dose &&
          others.length > 0 &&
          choice("compareWith", "Compare this curve with another data set's?", [
            ["none", "No"],
            ...others.map((n): [string, string] => [n, `Yes, with “${n}”`]),
          ]),
        dose &&
          a.compareWith !== undefined &&
          a.compareWith !== "none" &&
          choice("compare", "What should be compared?", [
            ["ec50", `Is the ${midpoint} different between the two data sets?`],
            ["all", "Does one curve fit both data sets?"],
          ]),
        dose &&
          (ys.length > 1 || others.length === 0 || a.compareWith === "none") &&
          choice("ecx", `Also report the dose giving a chosen % of the response (${midpoint} is 50%)?`, [
            ["none", "No — the midpoint is enough"],
            ["ec10", "EC10 (10% of the response)"],
            ["ec20", "EC20 (20%)"],
            ["ec80", "EC80 (80%)"],
            ["ec90", "EC90 (90%)"],
          ]),
        // Outliers are looked for in a curve fitted on its own, not in two compared.
        (!dose || ys.length > 1 || others.length === 0 || a.compareWith === "none") &&
          choice("rout", "Identify outliers, points too far from the curve, and leave them out of the fit?", [
            ["no", "No — fit every point"],
            ["yes", "Yes — ROUT method (Q = 1%)"],
          ]),
        a.model !== "user-defined" &&
          choice("compareModel", "Also fit another model to the same data and compare (F test + AICc)?", [
            ["none", "No comparison — fit this model only"],
            ...models
              .filter(([m]) => m !== a.model && m !== "user-defined")
              .map(([m, label]): [string, string] => [m, `Also fit ${label}`]),
          ]),
        others.length > 0 &&
          a.model !== "user-defined" &&
          choice("global", "Fit additional Y data sets together with shared parameters (a global fit)?", [
            ["no", "No — fit this data set alone"],
            ["yes", "Yes — fit them together"],
          ]),
        a.global === "yes" &&
          others.length > 0 && {
            id: "globalY",
            ask: "Which additional Y data sets should be fitted together?",
            kind: "names",
            options: others,
            min: 1,
          },
        a.global === "yes" &&
          ((a.globalY as string[] | undefined)?.length ?? 0) > 0 &&
          choice("shared", "Which parameters should be shared across the data sets?", [
            ["default", `The usual ones — the curve's midpoint and Hill slope (recommended)`],
            ["all", "Every parameter (one curve for all data sets)"],
            ["custom", "Choose…"],
          ]),
        a.global === "yes" &&
          a.shared === "custom" && {
            id: "sharedParams",
            ask: "Which parameters should be shared across the data sets?",
            kind: "names",
            options: terms,
            min: 1,
          },
        choice("constrain", "Fix or bound any parameters? (Advanced — leave the fit free unless you have a reason.)", [
          ["no", "No — fit every parameter freely"],
          ["yes", "Yes — fix parameters to constants or bound them"],
        ]),
        ...(a.constrain === "yes"
          ? terms.flatMap((term): Question[] => [
              {
                id: `fix_${term}`,
                ask: `Fix ${termLabel(term)} to a constant? Leave blank to fit it. (A fixed parameter is held at the value you enter, not fitted — or enter {{Constant name}} to hook it to an info sheet.)`,
                kind: "text",
                label: `Fix ${termLabel(term)} =`,
                initial: "",
                parse: (text: string) => parseHookableNumber(text, termLabel(term)),
              },
              {
                id: `bound_${term}`,
                ask: `Bound ${termLabel(term)}? Leave blank for unbounded, or enter “lower, upper”. (A bounded parameter is fitted within the bounds — either side can be a {{Constant name}} from an info sheet.)`,
                kind: "text",
                label: `${termLabel(term)} bounds [lower, upper] =`,
                initial: "",
                parse: (text: string) => parseHookableBounds(text, termLabel(term)),
              },
            ])
          : []),
        // Binding competition (plan 28): Fit Ki on the one-site (inhibitor
        // 3PL) and two-site competition fits — Ki = IC50 / (1 + [L]/Kd).
        dose &&
          (modelName === "inhibitor-3pl-logx" || modelName.startsWith("two-site-competition")) &&
          choice("fitKi", "Also report Ki (Cheng–Prusoff)?", [
            ["no", "Report IC50 only"],
            ["yes", "Also report Ki (Cheng–Prusoff)"],
          ]),
        // Fit Ki — or the homologous model, whose equation needs [L] — both
        // values required, in the same units as X; the wizard must not
        // proceed without them (the runner re-checks, so a bad value passed
        // straight to runAnalysis still fails clearly).
        dose &&
          (a.fitKi === "yes" || modelName === "homologous-competition-logx") &&
          {
            id: "ligandConcentration",
            ask: "Radioligand concentration [L], in the same units as X. (Or {{Constant name}} to hook it to an info sheet.)",
            kind: "text",
            label: "Radioligand concentration [L] =",
            initial: "",
            placeholder: "e.g. 1",
            parse: (text: string) => parseHookableRequiredPositive(text, "radioligand concentration [L]"),
          },
        dose &&
          a.fitKi === "yes" &&
          {
            id: "ligandKd",
            ask: "Radioligand Kd, in the same units as [L] — Ki = IC50 / (1 + [L]/Kd). (Or {{Constant name}} to hook it to an info sheet.)",
            kind: "text",
            label: "Radioligand Kd =",
            initial: "",
            placeholder: "e.g. 0.5",
            parse: (text: string) => parseHookableRequiredPositive(text, "radioligand Kd"),
          },
      ];
    },
    finish: (a) => {
      const compare =
        a.kind !== "other" && a.compareWith !== undefined && a.compareWith !== "none" && fittedYs(a).ys === undefined
          ? { compareWith: a.compareWith as string, compare: a.compare as NonlinearRegressionParams["compare"] }
          : {};
      const weights =
        a.weights !== undefined && a.weights !== "none"
          ? { weights: a.weights as NonlinearRegressionParams["weights"] }
          : {};
      // Seq 166 (Prism Range tab): the X-range bounds, when the wizard
      // asked for them — blank is no bound on that side, and both blank
      // fits every point (the runner refuses an inverted range plainly).
      const range =
        a.fitRange === "yes"
          ? (() => {
              const lo = parseOptionalNumber(String(a.fitXMin ?? ""), "lower X limit");
              const hi = parseOptionalNumber(String(a.fitXMax ?? ""), "upper X limit");
              return {
                ...(lo.value !== undefined ? { fitXMin: lo.value } : {}),
                ...(hi.value !== undefined ? { fitXMax: hi.value } : {}),
              };
            })()
          : {};
      const compareModel =
        a.compareModel !== undefined && a.compareModel !== "none"
          ? { compareModel: a.compareModel as NonlinearModel }
          : {};
      const globalY = a.global === "yes" ? ((a.globalY as string[] | undefined) ?? []) : [];
      const global = globalY.length ? { globalY } : {};
      // v2 item 23: a user equation's terms are its parameters, not a curated model's.
      const terms =
        a.model === "user-defined"
          ? (() => {
              const parsed = parseUserEquation(String(a.customEquation ?? ""));
              return "error" in parsed ? [] : parsed.params;
            })()
          : modelSpec(a.model as NonlinearModel).terms;
      // The equation and its starting values (the wizard's parse gates already checked
      // both; an invalid value here is omitted and the runner refuses it plainly).
      const custom =
        a.model === "user-defined"
          ? (() => {
              const parsed = parseUserEquation(String(a.customEquation ?? ""));
              if ("error" in parsed) return {};
              const initials = parseCustomParameters(String(a.customParameters ?? ""), parsed.params);
              if (initials.error) return {};
              return { customEquation: String(a.customEquation), customParameters: initials.values };
            })()
          : {};
      const sharedParams =
        globalY.length && a.shared === "all"
          ? { sharedParams: terms }
          : globalY.length && a.shared === "custom"
            ? { sharedParams: (a.sharedParams as string[] | undefined) ?? [] }
            : {};
      // Fixed/bounded parameters from the advanced section (blank = fit it /
      // unbounded). A hook — `{{Constant name}}` — goes in the `*Constants`
      // field instead, and resolves live at run time; a bound with a hook on
      // either side goes there whole (its numeric side rides along as text).
      // A parameter fixed AND bounded is refused by the runner — the wizard
      // has no cross-question validation to refuse it here.
      const fixed: Record<string, number> = {};
      const fixedConstants: Record<string, string> = {};
      const bounds: Record<string, [number, number]> = {};
      const boundsConstants: Record<string, [string, string]> = {};
      for (const term of terms) {
        const fixText = String(a[`fix_${term}`] ?? "").trim();
        const fixHook = constantRefName(fixText);
        if (fixHook) fixedConstants[term] = fixHook;
        else {
          const f = parseOptionalNumber(fixText, termLabel(term));
          if (f.value !== undefined) fixed[term] = f.value;
        }
        const boundText = String(a[`bound_${term}`] ?? "").trim();
        if (boundText !== "") {
          const parts = boundText.split(",").map((p) => p.trim());
          if (parts.length === 2) {
            const numeric = parts.map((p) => (constantRefName(p) ? undefined : Number(p)));
            if (
              numeric[0] !== undefined &&
              numeric[1] !== undefined &&
              Number.isFinite(numeric[0]) &&
              Number.isFinite(numeric[1])
            )
              bounds[term] = [numeric[0], numeric[1]];
            else boundsConstants[term] = [constantRefName(parts[0]) ?? parts[0], constantRefName(parts[1]) ?? parts[1]];
          }
        }
      }
      const ligandText = String(a.ligandConcentration ?? "").trim();
      const ligandHook = constantRefName(ligandText);
      const ligand = ligandHook
        ? { value: undefined }
        : parseRequiredPositive(ligandText, "radioligand concentration [L]");
      const kdText = String(a.ligandKd ?? "").trim();
      const kdHook = constantRefName(kdText);
      const kd = kdHook ? { value: undefined } : parseRequiredPositive(kdText, "radioligand Kd");
      const wantsKi = a.fitKi === "yes";
      const isHomologous = a.model === "homologous-competition-logx";
      return {
        type: "nonlinear-regression",
        params: {
          ...fittedYs(a),
          ...(a.x !== undefined ? { x: a.x as string } : {}),
          model: a.model as NonlinearModel,
          ...custom,
          ...compare,
          ...(a.rout === "yes" && !compare.compareWith ? { rout: true } : {}),
          ...(a.kind !== "other" &&
          a.ecx !== undefined &&
          a.ecx !== "none" &&
          !compare.compareWith
            ? { ecx: { ec10: 10, ec20: 20, ec80: 80, ec90: 90 }[a.ecx as string] as number }
            : {}),
          ...weights,
          ...range,
          ...compareModel,
          ...global,
          ...sharedParams,
          ...(Object.keys(fixed).length ? { fixed } : {}),
          ...(Object.keys(fixedConstants).length ? { fixedConstants } : {}),
          ...(Object.keys(bounds).length ? { bounds } : {}),
          ...(Object.keys(boundsConstants).length ? { boundsConstants } : {}),
          ...(wantsKi ? { fitKi: true } : {}),
          ...((wantsKi || isHomologous) && ligandHook
            ? { ligandConcentrationConstant: ligandHook }
            : (wantsKi || isHomologous) && ligand.value !== undefined
              ? { ligandConcentration: ligand.value }
              : {}),
          ...(wantsKi && kdHook
            ? { ligandKdConstant: kdHook }
            : wantsKi && kd.value !== undefined
              ? { ligandKd: kd.value }
              : {}),
        },
      };
    },
    checklist: () => CHECKLISTS["nonlinear-regression"],
  },

  // A nonlinear regression whose unknowns (a Y, no X) are read off the curve; the 3PLs,
  // whose slope is fixed, aren't standard curves. Curves of X as entered first (an ELISA's
  // concentrations), those of log X after.
  interpolate: {
    questions: (_, table) => [
      choice("y", "Which Y data set should be fitted?", names(yNames(table))),
      // Prism's "Standard curves to interpolate": the ones that fit reliably in WebR.
      // (PATCH's list from Plan 08, plus the 5PLs from HEAD's dynamic filter —
      // HEAD's filter excludes the kinetic models, so one-phase-decay and
      // exponential-growth come from PATCH's list.)
      choice("model", "Which standard curve should be fitted to X and Y?", [
        ["sigmoidal-4pl-logx", "Sigmoidal, 4PL, X is log(concentration)"],
        ["sigmoidal-4pl-x", "Sigmoidal, 4PL, X is concentration"],
        ["asymmetric-5pl-logx", "Asymmetric sigmoidal, 5PL, X is log(concentration)"],
        ["asymmetric-5pl-x", "Asymmetric sigmoidal, 5PL, X is concentration"],
        ["line", "Line"],
        ["semilog-line", "Semilog line"],
        ["hyperbola", "Hyperbola (X is concentration)"],
        ["quadratic", "Second order polynomial (quadratic)"],
        ["cubic", "Third order polynomial (cubic)"],
        // Prism's "Exponential" family (plan 08, 1/2: decay first).
        ["one-phase-decay", "One-phase decay"],
        ["two-phase-decay", "Two-phase decay"],
        ["plateau-decay", "Plateau followed by one-phase decay"],
        // Prism's "Exponential" family (plan 08, 2/2: association + growth).
        ["one-phase-association", "One-phase association"],
        ["exponential-growth", "Exponential growth"],
        // Prism's "Enzyme kinetics" family (plan 09).
        ["michaelis-menten", "Michaelis-Menten"],
        ["allosteric-sigmoidal", "Allosteric sigmoidal"],
        ["substrate-inhibition", "Substrate inhibition"],
        // Prism's "Other classic curves" family (v2).
        ["gaussian", "Gaussian"],
        ["boltzmann-sigmoid", "Boltzmann sigmoid"],
        ["lorentzian", "Lorentzian"],
        ["sine-wave", "Sine wave"],
        // 1.8 classic-curves completion (B6 §Standard #10): the Pade
        // approximant is Prism's tenth standard curve to interpolate.
        ["pade-11", "Pade (1,1) approximant"],
      ]),
    ],
    finish: (a) => ({
      type: "nonlinear-regression",
      params: { y: a.y as string, model: a.model as NonlinearRegressionParams["model"], interpolate: true },
    }),
  },

  "binding-saturation": {
    questions: (a, table) => {
      const ys = yNames(table);
      // The two-series models fit a second Y series jointly (M18): with one
      // Y there is no nonspecific-binding series to choose, so they are not offered.
      const models: [string, string][] = [
        ["one-site-total", "One site — Total binding"],
        ["two-site-specific", "Two sites — Specific binding"],
      ];
      if (ys.length >= 2)
        models.push(
          ["one-site-total-and-ns", "One site — Total and nonspecific"],
          ["two-site-total-and-ns", "Two sites — Total and nonspecific"],
        );
      return [
        choice("y", "Which Y data set is the total binding?", names(ys)),
        choice("model", "Which saturation model should be fitted?", models),
        // Two-series models fit a second Y series jointly, with NS and
        // Background shared — the first option after the total series is the
        // second Y column, so it defaults to the second Y data set.
        (a.model === "one-site-total-and-ns" || a.model === "two-site-total-and-ns") &&
          choice(
            "y2",
            "Which Y data set is the nonspecific binding?",
            names(ys.filter((n) => n !== a.y)),
            false,
            "This table has only one Y data set, so there is no nonspecific-binding series to choose. Go back and choose a one-site model, or add another Y column.",
          ),
      ];
    },
    finish: (a) => ({
      type: "binding-saturation",
      params: {
        y: a.y as string,
        model: a.model as BindingSaturationParams["model"],
        ...(a.y2 ? { y2: a.y2 as string } : {}),
      },
    }),
  },

  "binding-kinetics": {
    questions: (a, table) => [
      choice("y", "Which Y data set should be fitted?", names(yNames(table))),
      choice("model", "Which kinetics model should be fitted?", [
        ["association-one-phase", "Association — One phase"],
        ["dissociation-one-phase", "Dissociation — One phase"],
        ["association-two-phase", "Association — Two phases"],
        ["dissociation-two-phase", "Dissociation — Two phases"],
        ["association-then-dissociation", "Association then dissociation"],
      ]),
      // Derived kon / kinetic Kd need the radioligand concentration and a
      // Koff from a dissociation experiment — both optional, blank = not reported.
      a.model === "association-one-phase" && {
        id: "ligandConcentration",
        ask: "Radioligand concentration (for kon — same units as in the experiment; leave blank if unknown).",
        kind: "text",
        label: "Radioligand concentration (for kon)",
        initial: "",
        placeholder: "Blank = unknown",
        parse: (text) => parseOptionalPositive(text, "radioligand concentration"),
      },
      a.model === "association-one-phase" && {
        id: "koff",
        ask: "Koff from a dissociation experiment, in the same time units as X (leave blank if unknown). Needed with the radioligand concentration to derive kon and the kinetic Kd.",
        kind: "text",
        label: "Koff from a dissociation experiment",
        initial: "",
        placeholder: "Blank = unknown",
        parse: (text) => parseOptionalPositive(text, "Koff"),
      },
      // Association-then-dissociation's constrained constants: no defaults,
      // the wizard must not proceed without them.
      a.model === "association-then-dissociation" && {
        id: "hotNM",
        ask: "Radioligand concentration in nM during association (HotNM).",
        kind: "text",
        label: "HotNM (nM)",
        initial: "",
        placeholder: "e.g. 1",
        parse: (text) => parseRequiredPositive(text, "HotNM"),
      },
      a.model === "association-then-dissociation" && {
        id: "time0",
        ask: "Time at which dissociation starts (Time0), in the same time units as X.",
        kind: "text",
        label: "Time0",
        initial: "",
        placeholder: "e.g. 10",
        parse: (text) => parseRequiredPositive(text, "Time0"),
      },
    ],
    finish: (a) => {
      const ligand = parseOptionalPositive(String(a.ligandConcentration ?? ""), "radioligand concentration");
      const koff = parseOptionalPositive(String(a.koff ?? ""), "Koff");
      const hotNM = parseRequiredPositive(String(a.hotNM ?? ""), "HotNM");
      const time0 = parseRequiredPositive(String(a.time0 ?? ""), "Time0");
      return {
        type: "binding-kinetics",
        params: {
          y: a.y as string,
          model: a.model as BindingKineticsParams["model"],
          ...(ligand.value !== undefined ? { ligandConcentration: ligand.value } : {}),
          ...(koff.value !== undefined ? { koff: koff.value } : {}),
          ...(hotNM.value !== undefined ? { hotNM: hotNM.value } : {}),
          ...(time0.value !== undefined ? { time0: time0.value } : {}),
        },
      };
    },
  },

  // Enzyme kinetics — Inhibition (plan 17): the model picker defaults to
  // the Mixed model — it nests the others and its Alpha diagnoses the
  // mechanism — so it is listed first (a choice question defaults to its
  // first option). Y is a multi-select (default: all series); each included
  // series then gets its own inhibitor-concentration field, pre-filled from
  // the number in the column title and required when the title has none.
  // Per-series number fields are a new wizard pattern — one "text" question
  // per series, keyed `I:<series>` — noted here for reuse by later plans
  // (plan 18's global fits will want the same shape).
  "enzyme-inhibition": {
    questions: (a, table) => [
      // A global fit needs at least two Y series (the runner errors with
      // one), so with a single Y data set only Morrison — a single-curve
      // fit — is offered, and the question says why: otherwise the Y
      // question's min: 2 can never be met and Next stays disabled with
      // no message.
      choice(
        "model",
        yNames(table).length >= 2
          ? "Which inhibition model should be fitted?"
          : "Which inhibition model should be fitted? Global models need at least two Y data sets — with one Y data set, only Morrison Ki (tight binding) can be fitted.",
        [
          ...(yNames(table).length >= 2
            ? ([
                ["mixed", "Mixed model"],
                ["competitive", "Competitive"],
                ["noncompetitive", "Noncompetitive"],
                ["uncompetitive", "Uncompetitive"],
              ] as [string, string][])
            : []),
          ["morrison", "Morrison Ki (tight binding)"],
        ],
      ),
      {
        id: "y",
        ask:
          a.model === "morrison"
            ? "Which Y data sets should be fitted? Each is one inhibitor concentration."
            : "Which Y data sets should be fitted? Each is one inhibitor concentration — at least two for a global fit.",
        kind: "names",
        options: yNames(table),
        min: a.model === "morrison" ? 1 : 2,
      },
      // Global models only: one inhibitor-concentration field per included
      // series, pre-filled from the column title ("10 nM" → 10, "I=5" → 5);
      // a blank field blocks Next — the fit needs [I] for every series.
      ...(a.model !== "morrison"
        ? (Array.isArray(a.y) ? (a.y as string[]) : []).map((name) => ({
            id: `I:${name}`,
            ask: `Inhibitor concentration for “${name}” (same units for every series; Ki is reported in these units).`,
            kind: "text" as const,
            label: `[I] for “${name}”`,
            initial: parseInhibitorConcentration(name)?.toString() ?? "",
            placeholder: "e.g. 5",
            parse: (text: string) => parseRequiredNonNegative(text, "inhibitor concentration"),
          }))
        : []),
      // Morrison only: Et is required; [S] + Km are an optional pair (both
      // or neither) that converts Kiapp to Ki.
      a.model === "morrison" && {
        id: "enzymeConcentration",
        ask: "Total enzyme concentration (Et), in the same units as [I].",
        kind: "text",
        label: "Total enzyme concentration (Et)",
        initial: "",
        placeholder: "e.g. 5",
        parse: (text: string) => parseRequiredPositive(text, "total enzyme concentration"),
      },
      a.model === "morrison" && {
        id: "substrateConcentration",
        ask: "Substrate concentration used ([S]) — with Km, converts Kiapp to Ki; leave blank to report Kiapp only.",
        kind: "text",
        label: "Substrate concentration [S]",
        initial: "",
        placeholder: "Blank = Kiapp only",
        parse: (text: string) => parseOptionalPositive(text, "substrate concentration"),
      },
      a.model === "morrison" && {
        id: "kmForMorrison",
        ask: "Michaelis constant (Km) — with [S], converts Kiapp to Ki; leave blank to report Kiapp only.",
        kind: "text",
        label: "Michaelis constant (Km)",
        initial: "",
        placeholder: "Blank = Kiapp only",
        parse: (text: string) => parseOptionalPositive(text, "Michaelis constant"),
      },
    ],
    finish: (a, table) => {
      const model = (a.model as EnzymeInhibitionParams["model"] | undefined) ?? "mixed";
      const y = (Array.isArray(a.y) ? (a.y as string[]) : undefined) ?? yNames(table);
      const params: EnzymeInhibitionParams = { model, y };
      if (model !== "morrison") {
        const inhibitorConcentrations: Record<string, number> = {};
        for (const name of y) {
          const parsed = parseRequiredNonNegative(String(a[`I:${name}`] ?? ""), "inhibitor concentration");
          if (parsed.value !== undefined) inhibitorConcentrations[name] = parsed.value;
        }
        params.inhibitorConcentrations = inhibitorConcentrations;
      } else {
        const et = parseRequiredPositive(String(a.enzymeConcentration ?? ""), "total enzyme concentration");
        const s = parseOptionalPositive(String(a.substrateConcentration ?? ""), "substrate concentration");
        const km = parseOptionalPositive(String(a.kmForMorrison ?? ""), "Michaelis constant");
        if (et.value !== undefined) params.enzymeConcentration = et.value;
        if (s.value !== undefined) params.substrateConcentration = s.value;
        if (km.value !== undefined) params.kmForMorrison = km.value;
      }
      return { type: "enzyme-inhibition", params };
    },
  },

  // Dose-response — Special (plan 18): the model picker defaults to the
  // SchildSlope = 1 variant (Prism's guide presents it first), so it is
  // listed first (a choice question defaults to its first option). Y is a
  // multi-select (default: all series, in table order); the next question
  // names the assumed first series — the control (no antagonist) for
  // Schild/EC50 shift, the full agonist for the operational model — and
  // the user picks it explicitly, so a wrong first series is fixed by
  // picking another one instead of re-ticking. Each included series
  // except the control then gets its own antagonist-concentration field
  // (the plan-17 per-series-number pattern), pre-filled from the column
  // title and required when the title has none; B's units are one choice
  // for all series (pA2 is the negative log of B in these units). Schild
  // only: a HillSlope = 1.0 constraint choice, default free.
  "dose-response-special": {
    questions: (a, table) => {
      const model = (a.model as DoseResponseSpecialParams["model"] | undefined) ?? "schild-slope-1";
      const ys = (Array.isArray(a.ys) ? (a.ys as string[]) : undefined) ?? yNames(table);
      const first = (a.first as string | undefined) ?? ys[0];
      const isSchild = model === "schild" || model === "schild-slope-1";
      const needsB = isSchild || model === "ec50-shift";
      // One Y (or none) can never satisfy the two-series minimum, so the
      // step used to strand the wizard on a permanently disabled Next with
      // no message (R2-B4): relax the minimum to 1 and name the shortfall
      // in the question itself. The wizard then reaches Run and the runner
      // reports it too ("add at least a control and one shifted curve").
      const yCount = yNames(table).length;
      const shortfall =
        yCount === 0
          ? "This table has no Y data sets — this fit needs a control and at least one shifted curve. Add Y columns to the table first."
          : yCount === 1
            ? model === "operational-partial"
              ? "Only one Y data set exists — this fit needs a full agonist and at least one partial agonist. Add another Y column to the table, then run it again."
              : "Only one Y data set exists — this fit needs a control and at least one shifted curve. Add another Y column to the table, then run it again."
            : null;
      return [
        choice("model", "Which dose-response — Special model should be fitted?", [
          ["schild-slope-1", "Gaddum/Schild EC50 shift (SchildSlope = 1)"],
          ["schild", "Gaddum/Schild EC50 shift (SchildSlope free)"],
          ["ec50-shift", "EC50 shift"],
          ["operational-partial", "Operational model — Partial agonist"],
        ]),
        {
          id: "ys",
          ask:
            shortfall ??
            (model === "operational-partial"
              ? "Which Y data sets should be fitted? The first is the full agonist; the rest are partial agonists."
              : "Which Y data sets should be fitted? Each is one antagonist concentration; the first is the control (no antagonist)."),
          kind: "names",
          options: yNames(table),
          min: yCount < 2 ? 1 : 2,
        },
        // The assumed first series, named — proceeding picks it (or
        // another series) explicitly, so the fit never silently takes
        // the wrong series as the control / full agonist.
        choice(
          "first",
          model === "operational-partial"
            ? "The first series is the full agonist. Which series is it?"
            : "The first series is the control (no antagonist). Which series is it?",
          names(ys),
        ),
        // Schild / EC50 shift only: the units first (F9 — the B values are
        // meaningless until the units are known; pA2 is the negative log of
        // B in these units), then one B field per included series except
        // the control, pre-filled from the column title ("10 nM" → 10);
        // a blank field blocks Next.
        ...(needsB
          ? [
              choice(
                "bUnits",
                "Which units is B entered in? pA2 is the negative log of B in these units — a nanomolar antagonist has pA2 ≈ 8–9 in M, ≈ −1 in nM.",
                [
                  ["M", "M (molar)"],
                  ["nM", "nM (nanomolar)"],
                  ["µM", "µM (micromolar)"],
                ],
              ),
            ]
          : []),
        ...(needsB
          ? ys
              .filter((name) => name !== first)
              .map((name) => ({
                id: `B:${name}`,
                ask: `Antagonist concentration B for “${name}” in ${(a.bUnits as string | undefined) ?? "M"} (pA2 is reported in these units).`,
                kind: "text" as const,
                label: `B for “${name}”`,
                initial: parseInhibitorConcentration(name)?.toString() ?? "",
                placeholder: "e.g. 1e-8",
                parse: (text: string) => parseRequiredNonNegative(text, "antagonist concentration"),
              }))
          : []),
        isSchild &&
          choice(
            "fixHillSlope",
            "Constrain HillSlope to 1.0? Prism's guide suggests considering it — the fit is unconstrained by default.",
            [
              ["no", "No — fit HillSlope freely"],
              ["yes", "Yes — constrain HillSlope to 1.0"],
            ],
          ),
      ];
    },
    finish: (a, table) => {
      const model = (a.model as DoseResponseSpecialParams["model"] | undefined) ?? "schild-slope-1";
      const picked = (Array.isArray(a.ys) ? (a.ys as string[]) : undefined) ?? yNames(table);
      const first = (a.first as string | undefined) ?? picked[0];
      const ys = [first, ...picked.filter((n) => n !== first)];
      const params: DoseResponseSpecialParams = { model, ys };
      if (model === "schild" || model === "schild-slope-1" || model === "ec50-shift") {
        const antagonistConcentrations: Record<string, number> = { [first]: 0 };
        for (const name of ys.slice(1)) {
          const parsed = parseRequiredNonNegative(String(a[`B:${name}`] ?? ""), "antagonist concentration");
          if (parsed.value !== undefined) antagonistConcentrations[name] = parsed.value;
        }
        params.antagonistConcentrations = antagonistConcentrations;
        params.bUnits = (a.bUnits as string | undefined) ?? "M";
      }
      if (model === "schild" || model === "schild-slope-1") params.fixHillSlope = a.fixHillSlope === "yes";
      return { type: "dose-response-special", params };
    },
  },

  "spline-lowess": {
    questions: (a, table) => [
      choice("method", "Which smoother should be fitted?", [
        ["lowess", "Lowess (locally weighted smoothing)"],
        ["spline", "Spline (smoothing spline)"],
      ]),
      choice("y", "Which Y data set should be smoothed?", names(yNames(table))),
      a.method === "lowess" && {
        id: "f",
        ask: "Larger = smoother. 2/3 is the usual default; try 0.3–0.5 for wiggly data you want to follow closely.",
        kind: "number",
        label: "Span (fraction of points in each local fit)",
        initial: 2 / 3,
        step: 0.05,
        validate: (v) => (v > 0 && v <= 1 ? undefined : "The span must be between 0 and 1."),
      },
      a.method === "spline" && {
        id: "spar",
        ask: "Larger = smoother. Leave blank to let the fit choose; if the curve follows every point, set spar to 0.5–1.0.",
        kind: "text",
        label: "Smoothing parameter (spar). Blank = choose automatically.",
        initial: "",
        placeholder: "Blank = automatic (GCV)",
        parse: (text) => parseSpar(text),
      },
    ],
    finish: (a) => {
      const method = (a.method as SplineLowessParams["method"] | undefined) ?? "lowess";
      const spar = parseSpar(String(a.spar ?? ""));
      return {
        type: "spline-lowess",
        params: {
          y: a.y as string,
          method,
          ...(method === "lowess"
            ? { f: (a.f as number | undefined) ?? 2 / 3 }
            : { spar: spar.error ? NaN : spar.value }),
        },
      };
    },
  },

  // Smooth, differentiate or integrate a curve (v2): Savitzky–Golay
  // smoothing, a first or second numerical derivative, or a cumulative
  // integral — each producing a NEW curve table per Y data set (Prism's
  // Analyse → Smooth, Differentiate or Integrate a Curve). The derivative
  // or integral runs first, then the smoothing, as Prism does.
  "smooth-differentiate-integrate": {
    questions: (a, table) => {
      const operation = a.operation as string | undefined;
      const needsSmooth = operation === "smooth" || a.smoothResults === "yes";
      return [
        {
          id: "ys",
          ask: "Which data sets should be smoothed, differentiated or integrated?",
          kind: "names",
          options: yNames(table),
          min: 1,
        },
        choice("operation", "What should be done with each data set?", [
          ["smooth", "Smooth the curve (Savitzky–Golay)"],
          ["first-derivative", "First derivative — the slope at each point"],
          ["second-derivative", "Second derivative — the rate of change of the slope"],
          ["integral", "Cumulative integral — the area under the curve so far"],
        ]),
        (operation === "first-derivative" || operation === "second-derivative" || operation === "integral") &&
          choice("smoothResults", "Smooth the result afterwards (Savitzky–Golay)?", [
            ["yes", "Yes — smooth the derived curve"],
            ["no", "No — keep the derived curve as calculated"],
          ]),
        needsSmooth &&
          choice("window", "How many neighbouring points should each smoothed value use?", [
            ["5", "5 neighbours"],
            ["9", "9 neighbours"],
            ["13", "13 neighbours"],
          ]),
        needsSmooth &&
          choice("order", "What order should the smoothing polynomial be?", [
            ["2", "Quadratic (order 2)"],
            ["3", "Cubic (order 3)"],
          ]),
        operation === "integral" && {
          id: "baseline",
          ask: "From which baseline should the area be measured? Area below it counts as negative.",
          kind: "number",
          label: "Baseline Y =",
          initial: 0,
        },
        operation === "integral" && {
          id: "startValue",
          ask: "What should the integral's first value be? Usually 0.",
          kind: "number",
          label: "Starting value =",
          initial: 0,
        },
      ];
    },
    finish: (a, table) => ({
      type: "smooth-differentiate-integrate",
      params: {
        ys: a.ys as string[],
        x: table.columns[0]?.name,
        operation:
          (a.operation as SmoothDifferentiateIntegrateParams["operation"] | undefined) ?? "smooth",
        window: Number(a.window ?? 9),
        order: Number(a.order ?? 3),
        smoothResults: a.smoothResults === "yes",
        ...(a.operation === "integral"
          ? {
              baseline: (a.baseline as number | undefined) ?? 0,
              startValue: (a.startValue as number | undefined) ?? 0,
            }
          : {}),
      },
    }),
  },

  "two-way-anova": {
    // One value per cell: only the ordinary ANOVA, without comparisons (see two-way-anova.ts).
    questions: (a, table) => [
      ...someSets(table, 2),
      replicated(table) &&
        choice("design", "Which two-way ANOVA? Each compares the groups, the rows and their interaction.", [
          ["ordinary", "Ordinary two-way ANOVA (parametric)"],
          ["repeated-measures", "Repeated-measures (matched by row, parametric)"],
          ["nonparametric", "Scheirer-Ray-Hare test (non-parametric)"],
        ]),
      replicated(table) &&
        a.design === "repeated-measures" &&
        choice("sphericity", "Assume sphericity (equal variability of the differences between rows)?", [
          ["no", "No — Geisser-Greenhouse correction (recommended)"],
          ["yes", "Yes — no correction"],
        ]),
      replicated(table) &&
        a.design !== "nonparametric" &&
        choice("posthoc", "Run multiple comparisons? Only meaningful if the ANOVA is significant.", [
          ["none", "No — just the ANOVA table"],
          ["tukey", "Yes — Tukey's"],
          ...(a.design === "repeated-measures"
            ? []
            : ([["dunnett", "Yes, each against a control — Dunnett's test"]] as [string, string][])),
          ["bonferroni", "Yes — Bonferroni"],
          ["sidak", "Yes — Šídák"],
          ["holm-sidak", "Yes — Holm–Šídák"],
          ["lsd", "Yes — Fisher's LSD (uncorrected)"],
          ...(a.design === "repeated-measures"
            ? []
            : ([["games-howell", "Yes — Games-Howell test (without assuming equal SDs)"]] as [string, string][])),
          ["fdr", "Yes — False discovery rate (Benjamini-Hochberg)"],
        ]),
      replicated(table) &&
        a.design !== "nonparametric" &&
        a.posthoc !== undefined &&
        a.posthoc !== "none" &&
        choice("posthocTarget", "Compare which?", [
          ["groups", "Groups within each row"],
          ["rows", "Rows within each group"],
          // Cell and marginal-mean comparisons need the ordinary design's
          // pooled residual — a repeated-measures comparison has no single
          // error term for them (see two-way-anova.ts).
          ...(a.design === "repeated-measures"
            ? []
            : ([
                ["cells", "Every cell mean against every other"],
                ["group-means", "Group means, averaged over rows"],
                ["row-means", "Row means, averaged over groups"],
              ] as [string, string][])),
        ]),
      a.posthoc === "dunnett" &&
        (a.posthocTarget === "rows" || a.posthocTarget === "row-means"
          ? choice("control", "Which row is the control?", names(dataRows(table)))
          : a.posthocTarget === "cells"
            ? choice(
                "control",
                "Which cell is the control?",
                names(cellNames(table, chosenSets(a) ?? setNames(table))),
              )
            : choice("control", "Which group is the control?", names(chosenSets(a) ?? setNames(table)))),
      ...fdrQuestions(a),
    ],
    finish: (a) => ({
      type: "two-way-anova",
      params: withSets(a, {
        design: (a.design ?? "ordinary") as TwoWayAnovaParams["design"],
        posthoc: (a.posthoc as TwoWayAnovaParams["posthoc"] | undefined) ?? "none",
        posthocTarget: (a.posthocTarget as TwoWayAnovaParams["posthocTarget"] | undefined) ?? "groups",
        ...(a.design === "repeated-measures" ? { sphericity: a.sphericity === "yes" } : {}),
        ...(a.posthoc === "dunnett" ? { control: a.control as string } : {}),
        ...fdrParams(a),
      }),
    }),
    // The checklist follows the design: ordinary, repeated-measures, or rank-based.
    checklist: (a) =>
      CHECKLISTS[
        a.design === "repeated-measures"
          ? "two-way-anova-rm"
          : a.design === "nonparametric"
            ? "two-way-anova-srh"
            : "two-way-anova"
      ],
  },

  "three-way-anova": {
    questions: (a, table, _type, rowGroups) => {
      const controlOptions = a.posthoc === "dunnett" ? threeWayControlOptions(a, table, rowGroups) : undefined;
      const termIsInteraction = ((a.posthocTerm as string | undefined) ?? "").includes(":");
      return [
        ...someSets(table, 2),
        choice("posthoc", "Run multiple comparisons? Only meaningful if the ANOVA is significant.", [
          ["none", "No — just the ANOVA table"],
          ["tukey", "Yes — Tukey's"],
          ["bonferroni", "Yes — Bonferroni-corrected"],
          ["sidak", "Yes — Šídák-corrected"],
          ["holm-sidak", "Yes — Holm–Šídák"],
          ["lsd", "Yes — Fisher's LSD (uncorrected)"],
          ["dunnett", "Yes, each against a control — Dunnett's test"],
          ["games-howell", "Yes — Games-Howell test (without assuming equal SDs)"],
          ["fdr", "Yes — False discovery rate (Benjamini-Hochberg)"],
        ]),
        a.posthoc !== "none" &&
          choice(
            "posthocTerm",
            "Which term should the comparisons follow up? The wizard cannot know yet which terms will be significant — pick the one you most want to follow up.",
            [
              ["A", "Factor A (column groups)"],
              ["B", "Factor B (rows)"],
              ["C", "Factor C (row groups)"],
              ["A:B", "Interaction A:B"],
              ["A:C", "Interaction A:C"],
              ["B:C", "Interaction B:C"],
              ["A:B:C", "Interaction A:B:C"],
            ],
          ),
        a.posthoc !== "none" &&
          termIsInteraction &&
          choice("posthocScope", "Compare the whole term, or its simple effects?", [
            ["term", "The whole term — every level combination against every other"],
            ["simple", "Simple effects — the first factor's levels within each level of the last factor"],
          ]),
        a.posthoc === "dunnett" &&
          controlOptions !== undefined &&
          choice(
            "control",
            a.posthocScope === "simple" && termIsInteraction
              ? "Which level is the control (compared within each level of the last factor)?"
              : termIsInteraction
                ? "Which cell is the control?"
                : "Which level is the control?",
            names(controlOptions),
          ),
        ...fdrQuestions(a),
      ];
    },
    finish: (a) => ({
      type: "three-way-anova",
      params: withSets(a, {
        posthoc: (a.posthoc as ThreeWayAnovaParams["posthoc"] | undefined) ?? "none",
        ...(a.posthoc !== undefined && a.posthoc !== "none"
          ? {
              posthocTerm: (a.posthocTerm as ThreeWayAnovaParams["posthocTerm"] | undefined) ?? "A",
              ...(a.posthocScope !== undefined
                ? { posthocScope: a.posthocScope as ThreeWayAnovaParams["posthocScope"] }
                : {}),
              ...(a.posthoc === "dunnett" && a.control !== undefined ? { control: a.control as string } : {}),
              ...fdrParams(a),
            }
          : {}),
      }),
    }),
    checklist: () => CHECKLISTS["three-way-anova"],
  },

  "nested-t-test": {
    // Which two groups to compare: asked only when the table has more than
    // two data sets (seq 246) — on a two-group table it runs at once.
    questions: (a, table) => [...twoSets(a, table)],
    finish: (a) => ({ type: "nested-t-test", params: withSets(a) }),
  },

  "nested-anova": {
    questions: (_, table) => [
      ...someSets(table, 3),
      choice("posthoc", "Compare each pair of groups?", [
        ["none", "No — only the overall ANOVA"],
        ["tukey", "Yes — Tukey's multiple comparisons test"],
        ["bonferroni", "Yes — Bonferroni-corrected comparisons"],
      ]),
    ],
    finish: (a) => ({
      type: "nested-anova",
      params: withSets(a, {
        posthoc: (a.posthoc as NestedAnovaParams["posthoc"] | undefined) ?? "none",
      }),
    }),
  },

  "multiple-t-tests": {
    questions: (a, table) => [
      ...twoSets(a, table),
      choice("paired", PAIRED, [
        ["unpaired", "Unpaired (independent groups)"],
        ["paired", "Paired (matched samples)"],
      ]),
      choice("gaussian", "Assume the data are sampled from a Gaussian (normal) distribution?", [
        ["yes", "Yes — t test at each row (parametric)"],
        [
          "no",
          `No — ${a.paired === "paired" ? "Wilcoxon signed-rank" : "Mann-Whitney"} test at each row (non-parametric)`,
        ],
      ]),
      a.gaussian === "yes" &&
        choice("pooled", "Assume every row has the same amount of scatter (SD)?", [
          ["no", "No — fit each row's SD independently (recommended)"],
          ["yes", "Yes — pool one shared SD across all rows"],
        ]),
      choice("correction", "Correct for running many comparisons at once?", [
        ["holm-sidak", "Holm–Šídák (recommended)"],
        ["holm", "Holm (step-down Bonferroni)"],
        ["sidak", "Šídák–Bonferroni (single-step Šídák)"],
        ["bonferroni", "Bonferroni–Dunn"],
        ["fdr", "False discovery rate — Benjamini-Hochberg (BH)"],
        ["fdr-bky", "False discovery rate — Benjamini-Krieger-Yekutieli two-stage (BKY)"],
        ["fdr-by", "False discovery rate — Benjamini-Yekutieli (BY)"],
        ["none", "None — treat each row independently"],
      ]),
      // The FDR methods need a Q: the desired false discovery rate. Only
      // asked for those methods (the family-wise ones flag at P < 0.05).
      (a.correction === "fdr" || a.correction === "fdr-bky" || a.correction === "fdr-by") && {
        id: "q",
        ask: "What false discovery rate do you want? A row counts as a discovery when its FDR-adjusted P value is below Q: a smaller Q flags fewer rows.",
        kind: "number",
        label: "Q (%) =",
        initial: 5,
        ...ROUT_Q,
        // min/max alone are only HTML attributes — the wizard's Next gate
        // reads `validate`, so without this an out-of-range Q sailed through.
        validate: routQError,
        step: 0.5,
      },
    ],
    finish: (a) => ({
      type: "multiple-t-tests",
      params: withSets(a, {
        paired: a.paired === "paired",
        gaussian: a.gaussian === "yes",
        pooledSd: a.gaussian === "yes" && a.pooled === "yes",
        correction: (a.correction as MultipleTTestsParams["correction"] | undefined) ?? "holm-sidak",
        // FDR params carry a q and the others don't, so each method's cached
        // results keep their existing keys (as outliers does for q/alpha).
        ...(a.correction === "fdr" || a.correction === "fdr-bky" || a.correction === "fdr-by"
          ? { q: (a.q as number | undefined) ?? 5 }
          : {}),
      }),
    }),
    // The per-row test's assumptions are the two-group ones (the multiple-comparison
    // correction is already a wizard question, not a checklist item).
    // Unanswered, the first options (unpaired, Gaussian) give the unpaired t test.
    checklist: (a) => {
      const [paired, gaussian] = [a.paired === "paired", a.gaussian !== "no"];
      return CHECKLISTS[
        gaussian ? (paired ? "paired-t" : "two-sample-t") : paired ? "wilcoxon-paired" : "mann-whitney"
      ];
    },
  },

  "correlation-matrix": {
    questions: (_, table) => [
      ...someSets(table, 2),
      choice("method", "Which correlation coefficient should be computed for every pair of variables?", [
        ["pearson", "Pearson (parametric)"],
        ["spearman", "Spearman (non-parametric)"],
      ]),
    ],
    finish: (a) => ({
      type: "correlation-matrix",
      params: withSets(a, { method: a.method as CorrelationParams["method"] }),
    }),
    checklist: (a) => CHECKLISTS[a.method === "spearman" ? "correlation-spearman" : "correlation-pearson"],
  },

  "multiple-regression": {
    questions: (a, table) => [
      choice("dependent", "Which variable is the dependent one (Y)?", names(dataNames(table))),
      {
        id: "predictors",
        ask: "Which variables are the predictors?",
        kind: "names",
        options: dataNames(table).filter((n) => n !== a.dependent),
      },
    ],
    finish: (a) => ({
      type: "multiple-regression",
      params: { dependent: a.dependent as string, predictors: a.predictors as string[] },
    }),
  },

  "multifactor-anova": {
    questions: (a, table) => {
      const response = a.response as string | undefined;
      const byName = new Map(table.columns.map((c) => [c.name, c]));
      const all = table.columns.map((c) => c.name);
      // Only columns with ≥ 2 levels can be a factor (a numeric-coded factor
      // counts — its codes are its levels). When none qualifies, offer every
      // column but the response and let the runner say so.
      const factorable = all.filter((n) => n !== response && levelsOf(byName.get(n)!).length >= 2);
      const factorOptions = factorable.length > 0 ? factorable : all.filter((n) => n !== response);
      const terms = multifactorTerms((a.factors as string[] | undefined) ?? []);
      return [
        choice("response", "Which variable is the response (the outcome you measured)?", names(dataNames(table))),
        {
          id: "factors",
          ask: `Which variables are the factors? Each must have at least two levels (at most ${MULTIFACTOR_MAX_FACTORS}).`,
          kind: "names",
          options: factorOptions,
          min: 1,
        },
        choice("posthoc", "Run multiple comparisons? Only meaningful if the ANOVA is significant.", [
          ["none", "No — just the ANOVA table"],
          ["tukey", "Yes — Tukey's"],
          ["bonferroni", "Yes — Bonferroni-corrected"],
        ]),
        a.posthoc !== "none" &&
          terms.length > 0 &&
          choice(
            "posthocTerm",
            "Which term should the comparisons follow up? The wizard cannot know yet which terms will be significant — pick the one you most want to follow up.",
            terms.map((t): [string, string] => [t, t.includes(":") ? `Interaction ${t}` : t]),
          ),
      ];
    },
    finish: (a) => ({
      type: "multifactor-anova",
      params: {
        response: a.response as string,
        factors: a.factors as string[],
        posthoc: (a.posthoc as MultifactorAnovaParams["posthoc"] | undefined) ?? "none",
        ...(a.posthoc !== undefined && a.posthoc !== "none"
          ? { posthocTerm: (a.posthocTerm as string | undefined) ?? (a.factors as string[])[0] }
          : {}),
      },
    }),
    checklist: () => CHECKLISTS["multifactor-anova"],
  },

  "extract-rearrange": {
    questions: (a, table) => {
      const target = a.target as string | undefined;
      const all = table.columns.map((c) => c.name);
      const numeric = dataNames(table);
      /** An optional pick: "None" first, so the wizard defaults to leaving it out. */
      const optional = (id: string, ask: string, options: string[], noneLabel: string): Question =>
        choice(id, ask, [["none", noneLabel], ...options.map((n): [string, string] => [n, n])]);
      const notPicked = (...ids: string[]) => all.filter((n) => !ids.some((id) => a[id] === n));
      return [
        choice("target", "What kind of table should the extracted data become?", [
          ["xy", "XY — X values against Y values, one data set per group"],
          ["column", "Column — one column per group"],
          ["grouped", "Grouped — rows and columns from two factors"],
          ["contingency", "Contingency — counts of one variable against another"],
        ]),
        choice("prefixNames", "Include variable names as prefixes for the new titles?", [
          ["no", "No — titles are the levels alone (“F”, “Low”)"],
          ["yes", "Yes — titles name their variable (“Sex = F”, “Dose = Low”)"],
        ]),
        choice("completeRows", "Only include complete rows?", [
          ["yes", "Yes — condense to the distinct values (XY and Column tables)"],
          ["no", "No — keep one row per source row, in source order"],
        ]),
        target === "xy" && choice("x", "Which variable is X?", names(numeric)),
        (target === "xy" || target === "column" || target === "grouped") &&
          choice(
            "response",
            "Which variable is the response?",
            names(numeric.filter((n) => n !== a.x)),
          ),
        (target === "xy" || target === "column") &&
          optional(
            "grouping",
            "Which variable groups the data into data sets (XY) or columns (Column)?",
            notPicked("x", "response"),
            target === "xy" ? "None — one data set" : "None — one column",
          ),
        (target === "xy" || target === "column" || target === "grouped") &&
          optional(
            "subject",
            "Which variable identifies the subject? Its levels become the replicate sub-columns (XY, Grouped) or the rows (Column).",
            notPicked("x", "response", "grouping"),
            "None",
          ),
        (target === "xy" || target === "column") &&
          optional(
            "rowTitles",
            "Which variable holds the new table's row titles?",
            notPicked("x", "response", "grouping", "subject"),
            "None — blank row titles",
          ),
        target === "grouped" &&
          choice("rowFactor", "Which variable is the row factor?", names(all.filter((n) => n !== a.response))),
        target === "grouped" &&
          choice(
            "columnFactor",
            "Which variable is the column factor?",
            names(all.filter((n) => n !== a.response && n !== a.rowFactor)),
          ),
        target === "contingency" &&
          choice("rowVariable", "Which variable's levels become the rows?", names(all)),
        target === "contingency" &&
          choice(
            "outcome",
            "Which variable's levels become the columns?",
            names(all.filter((n) => n !== a.rowVariable)),
          ),
        target === "contingency" &&
          optional(
            "count",
            "Which variable holds each row's count?",
            numeric.filter((n) => n !== a.rowVariable && n !== a.outcome),
            "None — every row counts as 1",
          ),
      ];
    },
    finish: (a) => {
      const target = a.target as ExtractRearrangeParams["target"];
      /** An optional answer: blank, or "None", counts as not picked. */
      const opt = (id: string): string | undefined => {
        const v = a[id] as string | undefined;
        return v === undefined || v === "" || v === "none" ? undefined : v;
      };
      const grouping = opt("grouping");
      const subject = opt("subject");
      const rowTitles = opt("rowTitles");
      const count = opt("count");
      const prefixNames = a.prefixNames === "yes";
      const completeRows = a.completeRows !== "no";
      switch (target) {
        case "xy":
          return {
            type: "extract-rearrange",
            params: {
              target,
              x: a.x as string,
              response: a.response as string,
              ...(grouping ? { grouping } : {}),
              ...(subject ? { subject } : {}),
              ...(rowTitles ? { rowTitles } : {}),
              prefixNames,
              completeRows,
            },
          };
        case "column":
          return {
            type: "extract-rearrange",
            params: {
              target,
              response: a.response as string,
              ...(grouping ? { grouping } : {}),
              ...(subject ? { subject } : {}),
              ...(rowTitles ? { rowTitles } : {}),
              prefixNames,
              completeRows,
            },
          };
        case "grouped":
          return {
            type: "extract-rearrange",
            params: {
              target,
              response: a.response as string,
              rowFactor: a.rowFactor as string,
              columnFactor: a.columnFactor as string,
              ...(subject ? { subject } : {}),
              prefixNames,
              completeRows,
            },
          };
        case "contingency":
          return {
            type: "extract-rearrange",
            params: {
              target,
              rowVariable: a.rowVariable as string,
              outcome: a.outcome as string,
              ...(count ? { count } : {}),
              prefixNames,
              completeRows,
            },
          };
      }
    },
  },

  survival: {
    questions: (a, table, type) => {
      const isMV = type === "multiple";
      // A Multiple Variables table assigns its variables: the time variable, the event-code
      // variable and the grouping variable. The trend test and the correction only apply
      // with more than two groups — the grouping variable's levels, once it is chosen.
      const groups = isMV
        ? levelsOfName(table, a.groupBy as string | undefined).length
        : splitXY(table.columns).ys.length;
      return [
        ...(isMV
          ? [
              choice("time", "Which variable holds the survival (follow-up) times?", names(dataNames(table))),
              choice(
                "status",
                "Which variable holds the event codes? 1 = event occurred, 0 = censored.",
                names(binaryNames(table, a.time as string | undefined)),
              ),
              choice(
                "groupBy",
                "Which variable defines the groups to compare?",
                names(
                  groupingNames(table, [a.time as string | undefined, a.status as string | undefined]),
                ),
                false,
                "No variable has two or more levels yet — add a grouping variable (for example “Control” and “Treated”).",
              ),
            ]
          : []),
        choice("curveTest", "Which test should compare the survival curves?", [
          ["logrank", "Log-rank (Mantel-Cox) test (recommended)"],
          ...(groups > 2
            ? [["trend", "Log-rank test for trend — the groups are in a meaningful order"] as [string, string]]
            : []),
          ["gehan", "Gehan-Breslow-Wilcoxon test — more weight on early events"],
        ]),
        groups > 2 &&
          choice("correction", "Correct the comparisons of each pair of groups for multiple testing?", [
            ["holm", "Holm correction (recommended)"],
            ["fdr", "False discovery rate (Benjamini-Hochberg)"],
            ["none", "None — treat each pair independently"],
          ]),
      ];
    },
    finish: (a) => ({
      type: "survival",
      params: {
        curveTest: a.curveTest as SurvivalParams["curveTest"],
        correction: (a.correction ?? "holm") as SurvivalParams["correction"],
        ...(a.time !== undefined ? { time: a.time as string } : {}),
        ...(a.status !== undefined ? { status: a.status as string } : {}),
        ...(a.groupBy !== undefined ? { groupBy: a.groupBy as string } : {}),
      },
    }),
    checklist: () => CHECKLISTS["survival"],
  },

  cox: {
    questions: (_, table) => [
      choice(
        "reference",
        "Which group's hazard should the others be compared to?",
        names(splitXY(table.columns).ys.map((s) => s.name)),
      ),
    ],
    finish: (a) => ({ type: "cox", params: { reference: a.reference as CoxParams["reference"] } }),
  },
  "multiple-logistic-regression": {
    questions: (a, table) => {
      // Only 0/1 columns can be the outcome — offer those, so a non-binary
      // dependent is rejected at selection time. When no column is binary,
      // offer every data column and let the runner say so.
      const binary = table.numeric
        .filter((c) => c.values.length > 0 && c.values.every((v) => v === 0 || v === 1))
        .map((c) => c.name);
      const dependents = binary.length > 0 ? binary : dataNames(table);
      return [
        choice("dependent", "Choose the dependent variable (Y).", names(dependents)),
        {
          id: "predictors",
          ask: "Choose which variables to include as predictors.",
          kind: "names",
          options: dataNames(table).filter((n) => n !== a.dependent),
        },
      ];
    },
    finish: (a) => ({
      type: "multiple-logistic-regression",
      params: { dependent: a.dependent as string, predictors: a.predictors as string[] },
    }),
  },

  "poisson-regression": {
    questions: (a, table) => [
      choice("dependent", "Choose the dependent variable (Y) — the counts.", names(dataNames(table))),
      {
        id: "predictors",
        ask: "Choose which variables to include as predictors.",
        kind: "names",
        options: dataNames(table).filter((n) => n !== a.dependent),
      },
      choice(
        "quasi",
        "Adjust for overdispersion (quasi-Poisson)? Run standard Poisson first; if the result warns about overdispersion, re-run with this on.",
        [
          ["no", "No — standard Poisson (recommended unless the dispersion warning appears)"],
          ["yes", "Yes — scale standard errors for overdispersion"],
        ],
      ),
    ],
    finish: (a) => ({
      type: "poisson-regression",
      params: {
        dependent: a.dependent as string,
        predictors: a.predictors as string[],
        quasi: a.quasi === "yes",
      },
    }),
  },

  "principal-component-analysis": {
    questions: () => [
      choice("scale", "Standardise variables before PCA?", [
        [
          "correlation",
          "Use the correlation matrix — standardise each variable (recommended when variables are on different scales)",
        ],
        ["covariance", "Use the covariance matrix — keep original units"],
      ]),
      {
        id: "components",
        ask: "Components to report (0 = all).",
        kind: "number",
        label: "Components to report (0 = all)",
        initial: 0,
        min: 0,
        validate: (v) =>
          Number.isInteger(v) && v >= 0 ? undefined : "Enter a whole number of components (0 = all).",
      },
    ],
    finish: (a) => ({
      type: "principal-component-analysis",
      params: {
        scale: (a.scale as PrincipalComponentAnalysisParams["scale"] | undefined) ?? "correlation",
        components: a.components as number,
      },
    }),
  },

  "k-means": {
    questions: () => [
      {
        id: "clusters",
        ask: "Number of clusters (k).",
        kind: "number",
        label: "Number of clusters (k)",
        initial: 2,
        min: 2,
        validate: (v) =>
          Number.isInteger(v) && v >= 2 ? undefined : "Enter a whole number of clusters (at least 2).",
      },
      choice("standardise", "Standardise variables first? — z-score each variable (recommended when variables are on different scales)", [
        ["yes", "Yes — standardise each variable (recommended when variables are on different scales)"],
        ["no", "No — cluster on the original units"],
      ]),
    ],
    finish: (a) => ({
      type: "k-means",
      params: {
        clusters: a.clusters as number,
        standardise: (a.standardise as string | undefined) !== "no",
      },
    }),
  },

  "hierarchical-clustering": {
    questions: () => [
      {
        id: "clusters",
        ask: "Number of clusters (k) — the tree is cut into this many clusters.",
        kind: "number",
        label: "Number of clusters (k)",
        initial: 2,
        min: 2,
        validate: (v) =>
          Number.isInteger(v) && v >= 2 ? undefined : "Enter a whole number of clusters (at least 2).",
      },
      choice("linkage", "Linkage — how clusters merge as the tree grows", [
        ["complete", "Complete — farthest pair (compact clusters; the default)"],
        ["average", "Average — mean pair distance"],
        ["single", "Single — nearest pair (can chain)"],
        ["ward.D2", "Ward's — smallest increase in within-cluster variance (Euclidean distances only)"],
      ]),
      choice("distance", "Distance — how rows are measured apart", [
        ["euclidean", "Euclidean — straight-line distance"],
        ["manhattan", "Manhattan — city-block distance"],
      ]),
      choice("standardise", "Standardise variables first? — z-score each variable (recommended when variables are on different scales)", [
        ["yes", "Yes — standardise each variable (recommended when variables are on different scales)"],
        ["no", "No — cluster on the original units"],
      ]),
    ],
    finish: (a) => ({
      type: "hierarchical-clustering",
      params: {
        clusters: a.clusters as number,
        linkage: (a.linkage as HclustParams["linkage"] | undefined) ?? "complete",
        distance: (a.distance as HclustParams["distance"] | undefined) ?? "euclidean",
        standardise: (a.standardise as string | undefined) !== "no",
      },
    }),
  },

  "cox-proportional-hazards": {
    questions: (a, table) => {
      const all = dataNames(table);
      const time = (a.time as string | undefined) ?? all[0];
      const status = (a.status as string | undefined) ?? all.filter((n) => n !== time)[0];
      const remaining = all.filter((n) => n !== time && n !== status);
      // Only binary (exactly two distinct values) covariates can stratify
      // the survival curves — among the covariates chosen so far.
      const chosenCovariates = (a.covariates as string[] | undefined) ?? remaining;
      const binary = chosenCovariates.filter((n) => {
        const col = table.numeric.find((c) => c.name === n);
        return col !== undefined && new Set(col.values).size === 2;
      });
      return [
        choice("time", "Which column holds the survival (follow-up) times?", names(all)),
        choice(
          "status",
          "Which column holds the event codes? 1 = event occurred, 0 = censored.",
          names(all.filter((n) => n !== time)),
        ),
        {
          id: "covariates",
          ask: "Choose which variables to include as covariates.",
          kind: "names",
          options: remaining,
        },
        choice(
          "stratifyBy",
          "Stratify the survival curves by which covariate? Only 0/1 (binary) covariates are offered.",
          [...binary.map((n): [string, string] => [n, n]), ["none", "None — one curve for all subjects"]],
        ),
        choice("ties", "How should tied event times be handled?", [
          ["efron", "Efron (recommended)"],
          ["breslow", "Breslow"],
        ]),
      ];
    },
    finish: (a) => {
      // Re-validate stratifyBy against the final covariates (F12): the
      // stored answer can go stale when the user goes back and changes the
      // covariates, and the runner ignores it while the graph stratifies by
      // whatever column it names — so a stratifier that is no longer a
      // covariate is dropped instead of reaching the params.
      const covariates = (a.covariates as string[] | undefined) ?? [];
      const stratifyBy = (a.stratifyBy as string | undefined) ?? "none";
      return {
        type: "cox-proportional-hazards",
        params: {
          time: a.time as string,
          status: a.status as string,
          covariates: a.covariates as string[],
          ties: (a.ties as CoxPHParams["ties"] | undefined) ?? "efron",
          ...(stratifyBy !== "none" && covariates.includes(stratifyBy)
            ? { stratifyBy }
            : {}),
        },
      };
    },
    checklist: () => CHECKLISTS["cox-ph"],
  },

  "chi-square": {
    questions: (_, table) => {
      // The trend test only has a direction on a 2×k / k×2 table (k ≥ 3):
      // a 2×2 has no trend and a 3×3 has no single trend direction.
      const cols = dataGroups(table.columns).length;
      const rows = pairedGroups(table.columns)[0]?.values.length ?? 0;
      const qualifies = (cols === 2 && rows >= 3) || (rows === 2 && cols >= 3);
      const [shapeCols, shapeRows] = contingencyShape(table);
      return [
        // On a 2×2, which test: Fisher's, Yates' or the plain chi-square.
        // (On larger tables the chi-square is the test; the trend question
        // below adds the trend test for Titer's ordered tables.)
        shapeCols === 2 &&
          shapeRows === 2 &&
          choice("test", "Which test should be run on this 2×2 table?", [
            ["fisher", "Fisher's exact test — small expected counts (recommended)"],
            ["yates", "Chi-square test with Yates' continuity correction"],
            ["chi-square", "Chi-square test, uncorrected"],
          ]),
        qualifies &&
          choice("trendOrdered", "Are the rows (or columns) in a natural order (age, dose, time) and equally spaced?", [
            ["no", "No — do not run the test for trend"],
            ["yes", "Yes — ordered and equally spaced, run the test for trend"],
          ]),
      ];
    },
    finish: (a) => ({
      type: "chi-square",
      params: {
        ...(a.test !== undefined ? { test: a.test as ChiSquareParams["test"] } : {}),
        trendOrdered: a.trendOrdered === "yes",
      },
    }),
  },

  "chi-square-gof": {
    questions: (a, table) => {
      const mode = a.expectedMode as string | undefined;
      return [
        oneSet(table),
        // "Equal" comes first: the wizard pre-selects the first option, so
        // the equal-proportions run is the default, as in Prism. The options
        // come from GOF_EXPECTED_MODES, so the wizard can never offer a mode
        // the runner refuses.
        choice(
          "expectedMode",
          "What distribution should the observed counts be compared with?",
          GOF_EXPECTED_MODES.map(
            (m): [string, string] => [
              m,
              {
                equal: "Equal proportions — every category expected equally often",
                counts: "Expected counts — enter one per category",
                percent: "Expected percentages — enter one per category (they must add up to 100)",
              }[m],
            ],
          ),
        ),
        (mode === "counts" || mode === "percent") && {
          id: "expectedValues",
          ask:
            mode === "counts"
              ? "Enter the expected counts, one per category in row order, separated by commas."
              : "Enter the expected percentages, one per category in row order, separated by commas (they must add up to 100).",
          kind: "text",
          label: mode === "counts" ? "Expected counts" : "Expected percentages",
          initial: "",
          placeholder: "25, 25, 25, 25",
          parse: (text: string) => parseExpectedValues(text),
        },
      ];
    },
    finish: (a) => ({
      type: "chi-square-gof",
      params: withOneSet(a, {
        expectedMode: (a.expectedMode as ChiSquareGofParams["expectedMode"] | undefined) ?? "equal",
        ...(a.expectedMode === "counts" || a.expectedMode === "percent"
          ? { expectedValues: parseExpectedValues((a.expectedValues as string | undefined) ?? "").values }
          : {}),
      }),
    }),
  },

  "binomial-test": {
    questions: (_, table) => [
      oneSet(table),
      {
        id: "expectedProportion",
        ask: "What proportion do you expect in the first category (the first row)?",
        kind: "number",
        label: "Expected proportion (0–1)",
        initial: 0.5,
        min: 0,
        max: 1,
        validate: (v) =>
          v >= 0 && v <= 1 ? undefined : "Enter a proportion between 0 and 1.",
      },
    ],
    finish: (a) => ({
      type: "binomial-test",
      params: withOneSet(a, { expectedProportion: a.expectedProportion as number }),
    }),
  },

  mcnemar: {
    questions: () => [
      // A single-option choice: the dialog's own Cancel is the
      // "use Chi-square instead" path — the framework has no per-question
      // cancel, and a checkbox kind that must be ticked does not exist
      // either. Prism does not offer this test at all; the statement says
      // so in the result's notes as well.
      choice(
        "paired",
        "These counts are paired outcomes (same subjects measured twice, or matched pairs) — b and c are the pairs that changed. Do NOT use this for two independent groups (use Chi-square instead).",
        [["yes", "Yes — paired data"]],
      ),
      choice("continuityCorrection", "Apply the continuity correction?", [
        ["yes", "Yes (recommended, R default)"],
        ["no", "No"],
      ]),
    ],
    finish: (a) => ({
      type: "mcnemar",
      params: { continuityCorrection: a.continuityCorrection !== "no" },
    }),
  },
};
