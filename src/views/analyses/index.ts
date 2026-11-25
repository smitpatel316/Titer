// What the New Analysis picker and the Analysis menu offer for each table type.
// The tests themselves (name, needs, computation) are in stats/index.ts.

import { ANALYSES } from "../../stats";
import type { AnalysisPickerValue, AnalysisResult, AnalysisType } from "../../stats/types";
import type { TableData, TableType } from "../../store/types";
import type { SelectorOption } from "../../components/universal-modal";
import { groupsOf, readTable } from "../../lib/dataset";
import { titleCase } from "../../lib/format";
import {
  isPluginAnalysisId,
  parsePluginAnalysisId,
  pluginAnalysesForTable,
  resolveAnalysis,
  type PluginAnalysisResult,
} from "../../plugins";

/** A test as the picker, the Analysis menu and its wizard name it. */
export const analysisLabel = (value: AnalysisPickerValue) => {
  if (isPluginAnalysisId(value)) {
    // A plugin analysis names its label; an unregistered one (its plugin
    // disabled since the name was recorded) falls back to its analysis id.
    return resolveAnalysis(value)?.label ?? titleCase(parsePluginAnalysisId(value)!.analysisId.replace(/-/g, " "));
  }
  return titleCase(
    value === "compare-many-groups"
      ? "Compare more than two groups"
      : value === "interpolate"
        ? "Interpolate a standard curve"
        : value === "transform"
          ? "Transform or normalize"
          : ANALYSES[value].label,
  );
};

/** Any analysis result the results view renders: a first-party result, or
 *  a plugin one (its `testType` is the namespaced id string, not an
 *  `AnalysisType`). The view renders both the same way — the statistics,
 *  groups and notes — and only the first-party branches (its per-test
 *  tables) are keyed on the test type. */
export type AnyAnalysisResult = AnalysisResult | PluginAnalysisResult;

/** Whether a result came from a plugin analysis. */
export const isPluginAnalysisResult = (
  result: AnyAnalysisResult,
): result is PluginAnalysisResult => parsePluginAnalysisId(result.testType) !== null;

/** The result's display name: the first-party test's label, or the plugin
 *  analysis's label (its namespaced id when the plugin is gone). */
export function analysisResultLabel(result: AnyAnalysisResult): string {
  if (isPluginAnalysisResult(result)) {
    return resolveAnalysis(result.testType)?.label ?? result.testType;
  }
  return ANALYSES[result.testType].label;
}

const optionsFor = (order: AnalysisPickerValue[]): SelectorOption<AnalysisPickerValue>[] =>
  order.map((value) => ({ value, label: analysisLabel(value) }));

/** Test options for the selector + menu, scoped per table type (each table's columns mean
 *  something different — a Column table's columns are independent groups, an XY table's are
 *  X + Y data series — so the tests that make statistical sense differ too) and given in a fixed
 *  logical order rather than sorted by label. ANOVA/Kruskal-Wallis and Repeated-measures
 *  ANOVA/Friedman aren't listed individually — Prism-style, one meta entry cascades to whichever
 *  the wizard's Paired?/Gaussian? answers resolve to. Shapiro-Wilk is its own entry, and is
 *  offered as "Not sure?" on every Gaussian? question too (see `normality-check.ts`). Transform
 *  or Normalize makes a table computed from this one (lib/transform.ts), not an analysis. */
export const ANALYSIS_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<AnalysisPickerValue>[]> = {
  column: optionsFor([
    "descriptive-statistics",
    "frequency-distribution",
    "fraction-of-total",
    "transform-data",
    "transform-concentrations",
    "remove-baseline",
    "normalize",
    "transpose",
    "prune-rows",
    "compare-two-groups",
    "compare-many-groups",
    "mixed-effects",
    "one-sample-t",
    "shapiro-wilk",
    "kolmogorov-smirnov",
    "one-sample-ks",
    "chi-square-gof",
    "binomial-test",
    "outliers",
    "p-value-stack",
    "transform",
    "monte-carlo",
    "bland-altman",
    "roc-curve",
    "plot-function",
  ]),
  xy: optionsFor([
    "correlation",
    "linear-regression",
    "compare-slopes",
    "deming-regression",
    "simple-logistic-regression",
    "area-under-curve",
    "fraction-of-total",
    "row-means-totals",
    "transform-data",
    "transform-concentrations",
    "remove-baseline",
    "normalize",
    "transpose",
    "prune-rows",
    "nonlinear-regression",
    "dose-response-special",
    "binding-saturation",
    "binding-kinetics",
    "enzyme-inhibition",
    "spline-lowess",
    "smooth-differentiate-integrate",
    "monte-carlo",
    "bland-altman",
    "interpolate",
    "roc-curve",
    "transform",
    "plot-function",
  ]),
  grouped: optionsFor(["two-way-anova", "mixed-effects", "three-way-anova", "multiple-t-tests", "row-means-totals", "transform", "plot-function"]),
  nested: optionsFor(["nested-t-test", "nested-anova", "plot-function"]),
  multiple: optionsFor(["descriptive-statistics", "shapiro-wilk", "correlation-matrix", "linear-regression", "compare-two-groups", "multiple-regression", "multifactor-anova", "nonlinear-regression", "principal-component-analysis", "k-means", "hierarchical-clustering", "outliers", "multiple-logistic-regression", "poisson-regression", "cox-proportional-hazards", "survival", "extract-rearrange", "select-transform", "transform", "plot-function"]),
  survival: optionsFor(["survival", "cox", "plot-function"]),
  contingency: [...optionsFor(["chi-square", "fraction-of-total", "plot-function"]), { value: "mcnemar", label: "McNemar's test (paired proportions)" }],
  // Each row is a mutually exclusive category, each column a data set: the
  // analyses are the ones Prism offers on a Parts of Whole table. Fraction
  // of Total is its home analysis (each value as a share of its column, row
  // or grand total); Transform or Normalize is Prism's "Transform,
  // Normalize..." group, Fraction of Total included. "Compare observed
  // distribution with expected" — the chi-square goodness-of-fit test, or
  // the binomial test for two categories — is Prism's "Parts of whole
  // analyses" entry (seq 195): the runners already read one data set of
  // observed counts with the row titles as the categories, so they run
  // unchanged on this table type — the wizard asks which set holds the
  // observed counts when there is more than one.
  "parts-of-whole": optionsFor(["fraction-of-total", "chi-square-gof", "binomial-test", "transform", "plot-function"]),
};

/** Whether the table has the ≥ 2 row bands a three-way ANOVA needs. */
export function hasRowGroups(data: TableData | undefined): boolean {
  return (data?.rowGroups?.length ?? 0) >= 2;
}

/** The picker/menu options for a table: the three-way ANOVA is offered only
 *  when the table has ≥ 2 row bands — without them it would be a dead test.
 *  Likewise the nested tests are offered only for their group count (t test
 *  for 2+ groups with data — the wizard asks which two when there are more,
 *  seq 246 — ANOVA for 3+) — the runners validate either way, so a stale
 *  entry point still gets a clear error. Plugin analyses join the same
 *  list, after the first-party entries: the ones whose table types include
 *  this table's, under their namespaced ids (never shadowing a first-party
 *  test). A disabled plugin's analyses are unregistered, so they vanish
 *  from the picker the moment the plugin is disabled. */
export function analysisOptionsForTable(tableType: TableType, data?: TableData): SelectorOption<AnalysisPickerValue>[] {
  const firstParty = ANALYSIS_OPTIONS_BY_TABLE[tableType].filter((o) => {
    if (o.value === "three-way-anova") return hasRowGroups(data);
    if (o.value === "nested-t-test") return data === undefined || countDataGroups(data) >= 2;
    if (o.value === "nested-anova") return data === undefined || countDataGroups(data) >= 3;
    return true;
  });
  return [...firstParty, ...pluginAnalysisOptionsForTable(tableType)];
}

/** The plugin analyses offered for a table type, as picker options — the
 *  plugin source of the listing above, kept separate so callers that only
 *  want the plugin side (the MCP list tool) do not re-derive it. */
export function pluginAnalysisOptionsForTable(tableType: TableType): SelectorOption<AnalysisPickerValue>[] {
  return pluginAnalysesForTable(tableType).map((e) => ({
    value: e.id as AnalysisPickerValue,
    label: `${e.spec.label} (plugin: ${e.pluginId})`,
  }));
}

/** Whether a picker value is offered for this table — the Recently used
 *  section lists runs from every table type, so a tap on one that doesn't
 *  fit this table gets the not-applicable note instead of its wizard (seq 298). */
export function isAnalysisOffered(value: AnalysisPickerValue, tableType: TableType, data?: TableData): boolean {
  const plugin = parsePluginAnalysisId(value);
  if (plugin) {
    // A plugin analysis is offered when it is registered and its table
    // types include this table's — the same table-type gate as above.
    return pluginAnalysesForTable(tableType).some((e) => e.id === value);
  }
  return analysisOptionsForTable(tableType, data).some((o) => o.value === value);
}

/** The picker offers two meta entries, not tests: "compare-many-groups"
 *  resolves (in the wizard) to one-way ANOVA, Kruskal-Wallis,
 *  repeated-measures ANOVA or Friedman, and "interpolate" to nonlinear
 *  regression — the same mapping `template.ts` and `wand.ts` already carry
 *  for their own offered-checks. */
export const META_ANALYSES: Record<string, AnalysisType[]> = {
  "compare-many-groups": ["anova", "kruskal-wallis", "rm-anova", "friedman"],
  interpolate: ["nonlinear-regression"],
};

/** The concrete analysis types the picker offers for a table: its options
 *  with the meta entries expanded to the tests they resolve to. Callers
 *  that must name a concrete test — the MCP gate in store/mcp-dispatch.ts —
 *  check against this, because the Rust side rejects the meta entries and
 *  the picker never lists the concrete types: without the expansion the
 *  four compare-many-groups tests were offered on NO table type and could
 *  never run via MCP (BUG-14). The picker/menu themselves keep offering
 *  the meta entries — only this expansion changes. */
export function analysisTypesOfferedForTable(tableType: TableType, data?: TableData): AnalysisType[] {
  return analysisOptionsForTable(tableType, data).flatMap((o) =>
    // "transform" makes a computed table, not an analysis: it never reaches the MCP gate.
    // A plugin id is not an AnalysisType either: the plugin tools gate on
    // the plugin registry, not this list.
    o.value === "transform" || parsePluginAnalysisId(o.value) ? [] : (META_ANALYSES[o.value] ?? [o.value as AnalysisType]),
  );
}

/** The key the native Analysis menu depends on for its data-dependent items:
 *  the offered tests, joined. It changes exactly when the offered set changes
 *  (a row band added/removed, a nested group gaining/losing data) and stays
 *  put on edits that don't change the set, so the menu effect re-runs only
 *  when the menu itself would change — without it the menu goes stale once
 *  `isDirty` is true and consecutive edits share an `undoName` (BUG-REPORT #16). */
export function analysisOptionsKey(tableType: TableType | undefined, data?: TableData): string {
  if (!tableType) return "";
  return analysisOptionsForTable(tableType, data)
    .map((o) => o.value)
    .join(",");
}

/** Count data columns (excluding the leading Title column) that hold ≥1 numeric value. */
export function countDataColumns(data: TableData | undefined): number {
  if (!data) return 0;
  return readTable(data).numeric.length;
}

/** Count Grouped-table column-groups (by "A:Y1"-style name prefix) that hold ≥1 numeric
 *  value. A table's `groups` field is structural (how many are provisioned), not how many
 *  actually have data entered — tests needing an exact data-group count must check this. */
export function countDataGroups(data: TableData | undefined): number {
  if (!data) return 0;
  return groupsOf(readTable(data).numeric).length;
}
