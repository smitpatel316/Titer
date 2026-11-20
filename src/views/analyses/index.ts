// What the New Analysis picker and the Analysis menu offer for each table type.
// The tests themselves (name, needs, computation) are in stats/index.ts.

import { ANALYSES } from "../../stats";
import type { AnalysisPickerValue, AnalysisType } from "../../stats/types";
import type { TableData, TableType } from "../../store/types";
import type { SelectorOption } from "../../components/universal-modal";
import { groupsOf, readTable } from "../../lib/dataset";
import { titleCase } from "../../lib/format";

/** A test as the picker, the Analysis menu and its wizard name it. */
export const analysisLabel = (value: AnalysisPickerValue) =>
  titleCase(
    value === "compare-many-groups"
      ? "Compare more than two groups"
      : value === "interpolate"
        ? "Interpolate a standard curve"
        : value === "transform"
          ? "Transform or normalize"
          : ANALYSES[value].label,
  );

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
    "outliers",
    "transform",
    "monte-carlo",
    "bland-altman",
    "roc-curve",
    "plot-function",
  ]),
  xy: optionsFor([
    "correlation",
    "linear-regression",
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
  multiple: optionsFor(["descriptive-statistics", "shapiro-wilk", "correlation-matrix", "linear-regression", "compare-two-groups", "multiple-regression", "nonlinear-regression", "principal-component-analysis", "k-means", "hierarchical-clustering", "outliers", "multiple-logistic-regression", "poisson-regression", "cox-proportional-hazards", "survival", "extract-rearrange", "transform", "plot-function"]),
  survival: optionsFor(["survival", "cox", "plot-function"]),
  contingency: [...optionsFor(["chi-square", "fraction-of-total", "plot-function"]), { value: "mcnemar", label: "McNemar's test (paired proportions)" }],
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
 *  entry point still gets a clear error. */
export function analysisOptionsForTable(tableType: TableType, data?: TableData): SelectorOption<AnalysisPickerValue>[] {
  return ANALYSIS_OPTIONS_BY_TABLE[tableType].filter((o) => {
    if (o.value === "three-way-anova") return hasRowGroups(data);
    if (o.value === "nested-t-test") return data === undefined || countDataGroups(data) >= 2;
    if (o.value === "nested-anova") return data === undefined || countDataGroups(data) >= 3;
    return true;
  });
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
    o.value === "transform" ? [] : (META_ANALYSES[o.value] ?? [o.value as AnalysisType]),
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
