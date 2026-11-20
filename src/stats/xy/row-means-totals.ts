// Row means / totals (v2): per-row totals, means, medians, geometric means
// with SD, SEM, %CV and the 95% CI of the mean, for XY and Grouped tables
// (Prism's Analyze > Row Means/Totals) — the step before almost every grouped
// figure, where each row is summarised across its data sets. Computed by R,
// following the per-column descriptives exactly (same SD/SEM/CI/CV/geometric-
// mean definitions, plus the row's total, min/max, quartiles and percentiles):
// a row holding one value has no SD, SEM, CI or %CV, and the geometric mean
// needs every value above 0. Two scopes (Prism's dialog offers both):
// "pooled" summarises each row across all the chosen data sets together —
// one summary per row — while "per-column" summarises each row within each
// chosen data set separately — one summary per row per data set. The source
// data is never touched — the summaries live in the result only.
//
// Prism's whole-row rule for multi-subcolumn data sets (first average each
// data set, then summarise the data-set means — its "mean of means") is NOT
// applied here: pooled mode pools the values, as this analysis always has,
// so a grouped row's N is its replicate count. Per-column mode is the way
// to see each data set's own summary instead.
import type { AnalysisOutcome, RowMeansRow, RowMeansTotalsParams } from "../types";
import { evalNamedVector } from "../webr";
import { datasetColumns, type Column as DatasetColumn } from "../../lib/dataset";

/** The row title, or the row number when the table has none (as K-means/PCA name rows). */
const rowName = (titles: (string | null)[], r: number) => titles[r]?.trim() || `Row ${r + 1}`;

/** One summary cell: the values to summarise, the row they belong to, and —
 *  in per-column mode — the data set they are within. */
interface Cell {
  row: number;
  column?: string;
  values: number[];
}

export async function runRowMeansTotals(
  columns: DatasetColumn[],
  params: RowMeansTotalsParams | undefined,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  const xCol = params?.x ? columns.find((c) => c.name === params.x) : undefined;
  const perColumn = params?.rowScope === "per-column";

  // The columns to summarise across each row: the wizard's choice, or every
  // numeric column except X. A named column holding no numbers is named, not
  // silently skipped (a deleted one is caught earlier, by runAnalysis).
  let targets: DatasetColumn[];
  let named: string[];
  if (params?.ys?.length) {
    named = params.ys;
    targets = params.ys.flatMap((n) => datasetColumns(columns, n));
    const empty = params.ys.find((n) => datasetColumns(columns, n).every((c) => c.values.length === 0));
    if (empty) return { error: `“${empty}” holds no numbers yet.` };
  } else {
    targets = columns.filter((c) => c !== xCol && c.values.length > 0);
    named = targets.map((c) => c.name);
  }
  if (!targets.length) return { error: xCol ? "No Y column holds numbers yet." : "No column holds numbers yet." };

  // The summary cells: pooled mode has one cell per row holding a value in
  // any chosen column; per-column mode has one cell per row per chosen data
  // set holding a value in that row. A row (or row-in-data-set) holding
  // nothing has no summary to report.
  const cells: Cell[] = [];
  if (perColumn) {
    for (const name of named) {
      const cols = datasetColumns(columns, name);
      const rows = [...new Set(cols.flatMap((c) => c.rows))].sort((a, b) => a - b);
      for (const r of rows) {
        const values = cols.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
        if (values.length) cells.push({ row: r, column: name, values });
      }
    }
    // Row-major order, so each row's data sets sit together under its title.
    cells.sort((a, b) => a.row - b.row || named.indexOf(a.column!) - named.indexOf(b.column!));
  } else {
    const rows = [...new Set(targets.flatMap((c) => c.rows))].sort((a, b) => a - b);
    for (const r of rows) {
      const values = targets.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
      if (values.length) cells.push({ row: r, values });
    }
  }
  if (!cells.length) return { error: xCol ? "No Y column holds numbers yet." : "No column holds numbers yet." };

  // Each cell's total, mean, SD, SEM, median, CI, %CV and geometric mean —
  // the per-column descriptives' definitions, transposed to rows — plus its
  // min, max, quartiles and 10th/90th percentiles (R's type 6, the
  // descriptives' method), and the geometric SD with the 95% CI of the
  // geometric mean (both from the logarithms, t-based like the mean's CI).
  const v = await evalNamedVector(
    `G<-list(${cells.map((cell) => `c(${cell.values.join(",")})`).join(",")});` +
      "unlist(lapply(seq_along(G),function(i){x<-G[[i]];n<-length(x);s<-if(n>1)sd(x) else NA;" +
      "h<-if(n>1)qt(0.975,n-1)*s/sqrt(n) else NA;q<-quantile(x,c(0.25,0.75,0.10,0.90),type=6,names=FALSE);" +
      "lg<-if(all(x>0))log(x) else NULL;ls<-if(!is.null(lg)&&n>1)sd(lg) else NA;" +
      "lh<-if(!is.null(lg)&&n>1)qt(0.975,n-1)*ls/sqrt(n) else NA;lm<-if(!is.null(lg))mean(lg) else NA;" +
      "setNames(c(n,sum(x),mean(x),s,s/sqrt(n),median(x),mean(x)-h,mean(x)+h," +
      "if(mean(x)!=0)100*s/mean(x) else NA,if(all(x>0))exp(mean(log(x))) else NA," +
      "min(x),max(x),q,if(!is.null(lg))exp(ls) else NA,exp(lm-lh),exp(lm+lh))," +
      'paste0(c("n_","tot_","m_","s_","e_","md_","lo_","hi_","cv_","gm_","min_","max_","q1_","q3_","p10_","p90_","gsd_","glo_","ghi_"),i-1))}))',
  );
  const rowMeans: RowMeansRow[] = cells.map((cell, i) => ({
    row: rowName(titles, cell.row),
    ...(xCol ? { x: xCol.byRow[cell.row] ?? null } : {}),
    ...(cell.column ? { column: cell.column } : {}),
    n: v[`n_${i}`] ?? 0,
    total: v[`tot_${i}`] ?? 0,
    mean: v[`m_${i}`] ?? null,
    sd: v[`s_${i}`] ?? null,
    sem: v[`e_${i}`] ?? null,
    median: v[`md_${i}`] ?? null,
    ciLow: v[`lo_${i}`] ?? null,
    ciHigh: v[`hi_${i}`] ?? null,
    cv: v[`cv_${i}`] ?? null,
    geoMean: v[`gm_${i}`] ?? null,
    min: v[`min_${i}`] ?? null,
    max: v[`max_${i}`] ?? null,
    q1: v[`q1_${i}`] ?? null,
    q3: v[`q3_${i}`] ?? null,
    p10: v[`p10_${i}`] ?? null,
    p90: v[`p90_${i}`] ?? null,
    geoSd: v[`gsd_${i}`] ?? null,
    geoCiLow: v[`glo_${i}`] ?? null,
    geoCiHigh: v[`ghi_${i}`] ?? null,
  }));
  const single = rowMeans.filter((r) => r.n < 2).length;
  // Name what the user chose, not the resolved columns: on a grouped table
  // the choice is the data set ("A", "B"), while the columns are its
  // subcolumns ("A:Y1", ...). With no explicit choice, name the columns.
  return {
    testType: "row-means-totals",
    subtitle: "Row means and totals",
    stats: [],
    groups: [],
    notes:
      (perColumn
        ? `Summarised each row separately within ${named.map((n) => `“${n}”`).join(", ")}: one summary per row per data set. `
        : `Summarised each row across ${named.map((n) => `“${n}”`).join(", ")}: one summary per row. `) +
      "Each summary is the row's total, mean, SD, SEM, median, 95% CI of the mean, %CV, geometric mean, " +
      "minimum, maximum, 25th and 75th percentiles, 10th and 90th percentiles, geometric SD and 95% CI of the geometric mean. " +
      "Only values present in the row count; rows holding no value are not listed. " +
      "95% CI is the t-based confidence interval of the mean. " +
      "The coefficient of variation is SD ÷ mean. " +
      "Quartiles and percentiles are R's type 6, the (n + 1)p method. " +
      (single > 0
        ? `${single} summar${single === 1 ? "y has" : "ies have"} a single value, so ${single === 1 ? "it has" : "they have"} no SD, SEM, CI, %CV, geometric SD or geometric CI. `
        : "") +
      "The geometric mean, geometric SD and geometric CI need every value in the row above 0.",
    rowMeans,
  };
}
