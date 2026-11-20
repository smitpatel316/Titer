// Remove baseline (v2): subtract a baseline — a column's first value, the
// mean of its first N values, the mean of control column(s), or a constant —
// from every value in the chosen columns (Prism's Analyze > Remove Baseline).
// Pure arithmetic, no R: the only R call is `describe`, for the descriptives
// of the subtracted values (as every other analysis reports them). The source
// data is never touched — the subtracted values live in the result only, with
// the baseline used recorded per column so the operation is auditable.
import type {
  AnalysisOutcome,
  BaselineRemovedColumn,
  ColumnMathOperation,
  ColumnMathRow,
  RemoveBaselineMethod,
  RemoveBaselineParams,
} from "../types";
import { COLUMN_MATH_OPERATIONS } from "../types";
import { describe, missingColumn } from "../column/base";
import { datasetColumns, type Column as DatasetColumn } from "../../lib/dataset";

/** The row title, or the row number when the table has none (as K-means/PCA name rows). */
const rowName = (titles: (string | null)[], r: number) => titles[r]?.trim() || `Row ${r + 1}`;

const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;

/** The shared baseline for the "mean-of-controls" and "constant" methods,
 *  resolved once: both are one value for every column, unlike first-value /
 *  mean-of-first-N, which are per column. */
function sharedBaseline(
  method: RemoveBaselineMethod,
  params: RemoveBaselineParams | undefined,
  columns: DatasetColumn[],
): { baseline: number; description: string } | { error: string } {
  if (method === "constant") {
    const constant = params?.constant;
    if (constant == null || !Number.isFinite(constant))
      return { error: "Enter a constant baseline value to subtract." };
    return { baseline: constant, description: `Constant ${constant}` };
  }
  // mean-of-controls.
  const names = params?.controls ?? [];
  if (!names.length) return { error: "Choose at least one control column to average for the baseline." };
  const controlColumns = names.flatMap((n) => datasetColumns(columns, n));
  const empty = names.find((n) => datasetColumns(columns, n).every((c) => c.values.length === 0));
  if (empty) return { error: `“${empty}” holds no numbers yet.` };
  return {
    baseline: mean(controlColumns.flatMap((c) => c.values)),
    description: `Mean of ${names.map((n) => `“${n}”`).join(", ")}`,
  };
}

/** The symbol each column-math operation prints with (A − B, A / B, …). */
const COLUMN_MATH_SYMBOL: Record<ColumnMathOperation, string> = {
  subtract: "−",
  divide: "/",
  multiply: "×",
  add: "+",
};

/** The operation as a label ("A − B") and as a past-tense verb for the notes. */
const columnMathLabel = (operation: ColumnMathOperation, a: string, b: string) =>
  `${a} ${COLUMN_MATH_SYMBOL[operation]} ${b}`;
const COLUMN_MATH_VERB: Record<ColumnMathOperation, string> = {
  subtract: "Subtracted",
  divide: "Divided",
  multiply: "Multiplied",
  add: "Added",
};

/** Column math (seq 206): combine two columns row by row. Only rows
 *  holding a value in both columns are listed; dividing by zero leaves
 *  that row blank rather than inventing a value. */
async function runColumnMath(
  columns: DatasetColumn[],
  params: RemoveBaselineParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  const operation = params.columnMathOperation!;
  if (!COLUMN_MATH_OPERATIONS.includes(operation))
    return { error: `Unknown column math operation: “${operation}”.` };
  const aName = params.columnMathA;
  const bName = params.columnMathB;
  if (!aName || !bName) return { error: "Choose two columns to combine." };
  const xCol = params.x ? columns.find((c) => c.name === params.x) : undefined;
  const [aCol] = datasetColumns(columns, aName);
  const [bCol] = datasetColumns(columns, bName);
  if (!aCol) return { error: missingColumn(aName) };
  if (!bCol) return { error: missingColumn(bName) };
  if (!aCol.values.length) return { error: `“${aName}” holds no numbers yet.` };
  if (!bCol.values.length) return { error: `“${bName}” holds no numbers yet.` };

  const rows: ColumnMathRow[] = [];
  let skipped = 0;
  const rowCount = Math.max(aCol.byRow.length, bCol.byRow.length);
  for (let r = 0; r < rowCount; r++) {
    const av = aCol.byRow[r];
    const bv = bCol.byRow[r];
    if (av == null && bv == null) continue;
    if (av == null || bv == null) {
      skipped++;
      continue;
    }
    const result =
      operation === "subtract"
        ? av - bv
        : operation === "add"
          ? av + bv
          : operation === "multiply"
            ? av * bv
            : bv === 0
              ? null
              : av / bv;
    rows.push({
      row: rowName(titles, r),
      ...(xCol ? { x: xCol.byRow[r] ?? null } : {}),
      a: av,
      b: bv,
      result,
    });
  }
  if (!rows.length)
    return { error: `“${aName}” and “${bName}” share no row holding a value in both.` };

  const label = columnMathLabel(operation, aName, bName);
  const results = rows.map((r) => r.result).filter((v): v is number => v != null);
  const { groups } = results.length ? await describe([{ name: label, values: results }]) : { groups: [] };
  const blank = rows.length - results.length;
  const stats = [{ label: `${label} — N`, value: results.length }];
  if (blank > 0) stats.push({ label: `${label} — blank (divide by zero)`, value: blank });
  const verb = COLUMN_MATH_VERB[operation];
  const what =
    operation === "subtract"
      ? `${verb} “${bName}” from “${aName}”`
      : operation === "add"
        ? `${verb} “${aName}” and “${bName}”`
        : operation === "multiply"
          ? `${verb} “${aName}” by “${bName}”`
          : `${verb} “${aName}” by “${bName}”`;
  const notes = [
    `${what} row by row — ${rows.length} row${rows.length === 1 ? "" : "s"} combined.`,
    skipped > 0
      ? `${skipped} row${skipped === 1 ? " was" : "s were"} skipped: they hold a value in only one of the two columns.`
      : "",
    blank > 0
      ? `${blank} row${blank === 1 ? " is" : "s are"} blank: its “${bName}” value is 0, and dividing by zero has no value.`
      : "",
    "The original values are unchanged; the table below is the result. Only rows holding a value in both columns are listed.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    testType: "remove-baseline",
    subtitle: `Column math (${label})`,
    stats,
    groups,
    notes,
    columnMath: { a: aName, b: bName, operation, rows },
  };
}

export async function runRemoveBaseline(
  columns: DatasetColumn[],
  params: RemoveBaselineParams | undefined,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  // Column math (seq 206, Prism's "Remove baseline and column math"):
  // combine two columns row by row instead of removing a baseline.
  if (params?.columnMathOperation) return runColumnMath(columns, params, titles);
  const method = params?.baselineMethod ?? "first-value";
  if (!["first-value", "mean-first-n", "mean-of-controls", "constant"].includes(method))
    return { error: `Unknown baseline method: “${method}”.` };
  const xCol = params?.x ? columns.find((c) => c.name === params.x) : undefined;

  // The columns to subtract from: the wizard's choice, or every numeric
  // column except X. A named column holding no numbers is named, not
  // silently skipped (a deleted one is caught earlier, by runAnalysis).
  let targets: DatasetColumn[];
  if (params?.ys?.length) {
    targets = params.ys.flatMap((n) => datasetColumns(columns, n));
    const empty = params.ys.find((n) => datasetColumns(columns, n).every((c) => c.values.length === 0));
    if (empty) return { error: `“${empty}” holds no numbers yet.` };
  } else {
    targets = columns.filter((c) => c !== xCol && c.values.length > 0);
  }
  if (!targets.length)
    return { error: xCol ? "No Y column holds numbers yet." : "No column holds numbers yet." };

  // The shared baseline, when the method has one; the per-column methods
  // resolve inside the loop below.
  let shared: { baseline: number; description: string } | undefined;
  if (method === "mean-of-controls" || method === "constant") {
    const resolved = sharedBaseline(method, params, columns);
    if ("error" in resolved) return resolved;
    shared = resolved;
  }
  if (method === "mean-first-n") {
    const n = params?.firstN;
    if (n == null || !Number.isInteger(n) || n < 1)
      return { error: "The number of first values to average must be a whole number of 1 or more." };
  }

  const removed: BaselineRemovedColumn[] = [];
  for (const col of targets) {
    let baseline: number;
    let description: string;
    if (shared) {
      ({ baseline, description } = shared);
    } else if (method === "first-value") {
      baseline = col.values[0];
      description = "First value";
    } else {
      // mean-first-n.
      const n = params!.firstN!;
      if (n > col.values.length)
        return {
          error: `“${col.name}” holds only ${col.values.length} value${col.values.length === 1 ? "" : "s"}, but the baseline is the mean of the first ${n}.`,
        };
      baseline = mean(col.values.slice(0, n));
      description = `Mean of first ${n} values`;
    }
    removed.push({
      column: col.name,
      baseline,
      method: description,
      rows: col.rows.map((r) => ({
        row: rowName(titles, r),
        ...(xCol ? { x: xCol.byRow[r] ?? null } : {}),
        original: col.byRow[r]!,
        baseline,
        subtracted: col.byRow[r]! - baseline,
      })),
    });
  }

  const subtracted = removed.map((c) => ({ name: c.column, values: c.rows.map((r) => r.subtracted) }));
  const { groups } = await describe(subtracted);
  const baselines = removed.map((c) => `${c.column}: ${c.baseline} (${c.method.toLowerCase()})`).join("; ");
  const methodNote =
    method === "mean-of-controls"
      ? `the mean of the control values (${shared!.description.replace(/^Mean of /, "")})`
      : method === "constant"
        ? `the constant ${shared!.baseline}`
        : method === "mean-first-n"
          ? `the mean of the first ${params!.firstN} values of each data set`
          : "each data set's first value";
  return {
    testType: "remove-baseline",
    subtitle: `Remove baseline (${removed[0].method})`,
    stats: removed.map((c) => ({ label: `Baseline for “${c.column}”`, value: c.baseline })),
    groups,
    notes:
      `Subtracted ${methodNote} from every value in ${removed.map((c) => `“${c.column}”`).join(", ")}. ` +
      `Baselines used — ${baselines}. ` +
      "The original values are unchanged; the tables below are the baseline-subtracted values. " +
      "Only rows holding a value are listed.",
    baselineRemoved: removed,
  };
}
