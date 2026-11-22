// Summary sub-columns (Prism's "enter mean, SD or SEM, N" format): a grouped
// table whose sub-columns hold values already computed elsewhere, instead of
// replicate measurements. The format is the sub-columns' *names* ("A:Mean",
// "A:SD", "A:N") — the grid already shows only the part after "A:" for grouped
// sub-columns, so entry is the plain grid with Mean/SD/N headers. `replicates`
// keeps meaning "sub-columns per group", so the grouped structure code
// (`isGrouped`, `leadOf`, `regroupTable`) works unchanged.
//
// Sources: Prism 10 User Guide, "Grouped tables"
// (graphpad.com/guides/prism/10/user-guide/two_grouping_variable_table.htm —
// "You can also choose to create subcolumns formatted for entry of error values
// computed elsewhere") and "Changing a data table format"
// (…/using_changing_a_data_table_format.htm).
import type { TableData } from "../store/types";

/** How a grouped table's sub-columns are formatted: raw replicates, or
 *  pre-calculated summaries. Stored on TableData only when not "replicates". */
export type SummaryFormat =
  | "replicates"
  | "mean-sd-n"
  | "mean-sem-n"
  | "mean-sd"
  | "mean-sem"
  | "mean-cv-n"
  | "mean-cv"
  | "mean-plus-minus"
  | "mean-upper-lower";

/** One format: its label for the Groups panel, its sub-column headers in
 *  order, and the `.prism` dataFormat the writer emits for it
 *  (see src/lib/prism-write.ts — `y_high_low` shares the importer's column
 *  names with `y_plus_minus`, so the writer emits `y_plus_minus` for both,
 *  as it already does for the `_MEAN/_PLUSERROR/_MINUSERROR` suffixes). */
export interface SummaryFormatDef {
  value: SummaryFormat;
  label: string;
  subcolumns: string[];
  /** The error the second sub-column holds, when it holds one. */
  errorKind: "sd" | "sem" | "cv" | "plus-minus" | "upper-lower" | null;
  dataFormat: string | null;
}

export const SUMMARY_FORMATS: SummaryFormatDef[] = [
  { value: "replicates", label: "Replicates", subcolumns: [], errorKind: null, dataFormat: "y_replicates" },
  { value: "mean-sd-n", label: "Mean, SD, N", subcolumns: ["Mean", "SD", "N"], errorKind: "sd", dataFormat: "y_sd_n" },
  { value: "mean-sem-n", label: "Mean, SEM, N", subcolumns: ["Mean", "SEM", "N"], errorKind: "sem", dataFormat: "y_se_n" },
  { value: "mean-sd", label: "Mean, SD", subcolumns: ["Mean", "SD"], errorKind: "sd", dataFormat: "y_sd" },
  { value: "mean-sem", label: "Mean, SEM", subcolumns: ["Mean", "SEM"], errorKind: "sem", dataFormat: "y_se" },
  { value: "mean-cv-n", label: "Mean, CV, N", subcolumns: ["Mean", "CV", "N"], errorKind: "cv", dataFormat: "y_cv_n" },
  { value: "mean-cv", label: "Mean, CV", subcolumns: ["Mean", "CV"], errorKind: "cv", dataFormat: "y_cv" },
  {
    value: "mean-plus-minus",
    label: "Mean, +error, −error",
    subcolumns: ["Mean", "+error", "−error"],
    errorKind: "plus-minus",
    dataFormat: "y_plus_minus",
  },
  {
    value: "mean-upper-lower",
    label: "Mean, upper limit, lower limit",
    subcolumns: ["Mean", "Upper limit", "Lower limit"],
    errorKind: "upper-lower",
    dataFormat: "y_plus_minus",
  },
];

const BY_VALUE = new Map(SUMMARY_FORMATS.map((f) => [f.value, f]));

/** Whether `value` names a summary format (a value read from a file, say). */
export const isSummaryFormatValue = (value: unknown): value is SummaryFormat =>
  typeof value === "string" && BY_VALUE.has(value as SummaryFormat) && value !== "replicates";

/** A format's definition (replicates included). */
export const summaryFormatDef = (format: SummaryFormat): SummaryFormatDef => BY_VALUE.get(format)!;

/** A grouped table's sub-column format ("replicates" when it holds raw values). */
export const summaryFormatOf = (data: TableData): SummaryFormat => data.summaryFormat ?? "replicates";

/** Whether the table holds pre-calculated summaries instead of replicates. */
export const isSummaryTable = (data: TableData): boolean => summaryFormatOf(data) !== "replicates";

/** A format's sub-column headers, in order (empty for replicates — those are Y1…). */
export const summarySubcolumns = (format: SummaryFormat): string[] => summaryFormatDef(format).subcolumns;

/** The grouped-table tests that need raw replicates, so they cannot run on a
 *  summary table. Descriptive statistics stays out: per-column descriptives of
 *  summary columns are meaningful (a column of means has a mean). */
export const REPLICATE_TESTS = [
  "two-way-anova",
  "three-way-anova",
  "multiple-t-tests",
  "mixed-effects",
  "row-means-totals",
] as const;

/** Why a replicate-needing test cannot run on this table, if it cannot: the
 *  format's name and the way back, so the message can tell the user what to do. */
export const summaryTableProblem = (data: TableData, label: string): string | undefined => {
  if (!isSummaryTable(data)) return undefined;
  const format = summaryFormatDef(summaryFormatOf(data));
  return (
    `${label} needs raw replicate values, but this table's sub-columns hold ` +
    `pre-calculated summaries (${format.label}). Change the sub-column format back to Replicates in the Groups panel (Show Inspector), then try again.`
  );
};
