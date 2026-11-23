// Shared predictor selection for the multiple-* regression runners
// (multiple-regression, multiple-logistic-regression, poisson-regression)
// and the Cox PH covariates (src/stats/survival/cox-ph.ts).
//
// A predictor is numeric or categorical (seq 224): a column holding numbers
// enters as-is; a text column enters dummy-coded, one 0/1 column per level
// except the reference — Prism's dummy coding (GraphPad Prism 11 Curve
// Fitting Guide, "Parameter values from multiple regression"): k levels
// generate k − 1 dummies, the reference level gets no coefficient, and the
// default reference is the first level in the data table. Titer reads the
// levels on the complete rows (first-appearance order, like levelsOf), so a
// level that only occurs on rows the fit drops cannot silently re-anchor
// the reference; coefficients are named Variable[Level], Prism's form.
//
// A typed table (seq 331 half B) drives the split instead of the cells: a
// column whose variable type is Categorical dummy-codes even when its
// codes are numbers (1/2/3 are levels, not values), a Continuous column
// enters as-is, and a Label column never enters at all — neither by
// default nor when chosen by name. An untyped table reads exactly as
// before, from its cells.
//
// A chosen predictor whose column holds no numbers and no text levels is
// invisible to `dataGroups`, so filtering the chosen names against it drops
// the predictor without a word and the fit runs on the subset — R² /
// coefficients are then presented as the chosen model, with only the
// "Predictors: p" count hinting the subset is smaller. The runners name the
// dropped predictor(s) in the fit's notes instead (R2-m5, bug-fix queue item
// 39). A chosen name that is not a column at all never reaches here:
// runAnalysis errors on it first with missingColumn.
import { dataGroups, type Group } from "../column/base";
import { levelsOf, orderLevels } from "../../lib/dataset";
import { sd } from "../../lib/summary";
import type { Column } from "../types";

/** One column of the design matrix a fit runs on: a numeric predictor as-is,
// or one dummy of a text predictor. */
export interface DesignColumn {
  /** Coefficient term — the column name for a numeric predictor, or
   *  `Variable[Level]` (Prism's form) for a dummy. */
  term: string;
  /** The source column's name. */
  source: string;
  kind: "numeric" | "dummy";
  /** Values on the complete cases, in row order. */
  values: number[];
  /** A dummy's level; the reference level is `reference`. */
  level?: string;
  reference?: string;
}

/** A text predictor entered as dummy variables, with its reference level. */
export interface CategoricalPredictor {
  name: string;
  reference: string;
  levels: string[];
}

export interface PredictorSelection {
  dep: Column | undefined;
  /** The chosen numeric predictors, in order (the descriptives' columns). */
  predictors: Column[];
  /** Design columns on the complete cases, in predictor order (a text
   *  predictor's dummies follow their source column). */
  design: DesignColumn[];
  /** Chosen predictors left out because their column holds no numbers and
   *  no text levels. */
  dropped: string[];
  /** Chosen text predictors with levels, but none on the complete rows. */
  droppedNoComplete: string[];
  /** Text predictors entered as dummy variables, with their reference level. */
  categorical: CategoricalPredictor[];
  /** Text predictors with a single level on the complete rows, left out in
   *  the default (unchosen) case — explicitly choosing one is an error. */
  singleLevel: string[];
  /** Complete-case row indices, in row order. */
  rows: number[];
  /** The dependent's values on the complete cases, aligned with the design. */
  depValues: number[];
  /** A chosen text predictor has a single level on the complete rows — the
   *  run must refuse instead of fitting without it. */
  error?: string;
}

/** What a column is to a fit: its stored MV variable type when the table
 *  was typed (seq 331 half B), else what its cells say — a numeric column
 *  is numeric, a text column categorical, a column holding neither is
 *  empty. The type wins over the cells: a numeric-coded categorical
 *  (1/2/3) is a factor, not a number, and a label is never a predictor. */
export function columnKind(column: Column): "numeric" | "categorical" | "label" | "empty" {
  if (column.variableType === "label") return "label";
  if (column.variableType === "categorical") return "categorical";
  if (column.variableType === "continuous") return "numeric";
  if (column.values.length > 0) return "numeric";
  if (levelsOf(column).length > 0) return "categorical";
  return "empty";
}

/** The error when a label variable is chosen as a predictor or covariate:
 *  refused by name, never fitted without it. */
export function labelPredictorError(name: string, noun = "predictor"): string {
  return (
    `“${name}” is a label variable — label variables never enter analyses. ` +
    `Choose a categorical or continuous variable as the ${noun} instead.`
  );
}

/** The column's text on the row (trimmed), or undefined when blank — unlike
 *  `textCell`, a numeric cell still reads as its text, so a numeric-coded
 *  categorical's codes ("1", "2") are its levels. */
export function levelCell(column: Column, row: number): string | undefined {
  const t = column.cells[row]?.trim();
  return t ? t : undefined;
}

/** The column's text on the row (trimmed), or undefined when blank — a
 *  numeric cell is not text, even though its raw cell reads as a number. */
export function textCell(column: Column, row: number): string | undefined {
  if (column.byRow[row] != null) return undefined;
  const t = column.cells[row]?.trim();
  return t ? t : undefined;
}

/** Whether the column holds a value on the row: a number for a numeric
 *  column, non-blank text for a text column. */
export function hasCellValue(column: Column, row: number): boolean {
  return column.values.length > 0 ? column.byRow[row] != null : textCell(column, row) !== undefined;
}

/** Rows where every column in `used` has a value — the complete cases. */
export function completeRows(used: Column[]): number[] {
  const rowCount = Math.max(0, ...used.map((c) => c.cells.length));
  const rows: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    if (used.every((c) => hasCellValue(c, r))) rows.push(r);
  }
  return rows;
}

/** Rows holding a value in any of the columns — the subject rows a fit can
 *  see (a row with only a text value still counts). */
export function anyValueRows(used: Column[]): number[] {
  const rowCount = Math.max(0, ...used.map((c) => c.cells.length));
  const rows: number[] = [];
  for (let r = 0; r < rowCount; r++) {
    if (used.some((c) => hasCellValue(c, r))) rows.push(r);
  }
  return rows;
}

/** A text column's distinct levels on the given rows, first-appearance order.
 *  Levels read from the raw cell text, so a numeric-coded categorical's
 *  codes are its levels too. When the column carries a stored level order
 *  (seq 340), the levels come back in that order — so the dummy-coding
 *  reference (the first level) follows the table's order. */
export function levelsOnRows(column: Column, rows: readonly number[]): string[] {
  const seen = new Set<string>();
  const levels: string[] = [];
  for (const r of rows) {
    const t = levelCell(column, r);
    if (t && !seen.has(t)) {
      seen.add(t);
      levels.push(t);
    }
  }
  return orderLevels(levels, column.levelOrder);
}

/** Expand chosen columns into design columns on the given complete rows: a
 *  numeric column as-is, a text column as one dummy per non-reference level.
 *  `explicit` is whether the columns were chosen by name — an explicitly
 *  chosen single-level text column is an error, while in the default case it
 *  is skipped and named in `singleLevel`. `noun` is the word the error uses
 *  ("predictor" for the regressions, "covariate" for Cox). */
export function expandDesign(
  chosen: Column[],
  rows: readonly number[],
  explicit: boolean,
  noun = "predictor",
): {
  design: DesignColumn[];
  categorical: CategoricalPredictor[];
  singleLevel: string[];
  droppedNoComplete: string[];
  error?: string;
} {
  const design: DesignColumn[] = [];
  const categorical: CategoricalPredictor[] = [];
  const singleLevel: string[] = [];
  const droppedNoComplete: string[] = [];
  for (const c of chosen) {
    // The type decides, not the cells: a numeric-coded categorical
    // dummy-codes, a continuous column enters as-is, and a label is
    // refused outright (callers filter them first; this is the backstop).
    if (columnKind(c) === "label") {
      return {
        design,
        categorical,
        singleLevel,
        droppedNoComplete,
        error: labelPredictorError(c.name, noun),
      };
    }
    if (columnKind(c) === "numeric") {
      design.push({ term: c.name, source: c.name, kind: "numeric", values: rows.map((r) => c.byRow[r]!) });
      continue;
    }
    const levels = levelsOnRows(c, rows);
    if (levels.length === 0) {
      droppedNoComplete.push(c.name);
    } else if (levels.length === 1) {
      if (explicit) {
        return {
          design,
          categorical,
          singleLevel,
          droppedNoComplete,
          error:
            `“${c.name}” has only one level (“${levels[0]}”) on the complete rows — a categorical ` +
            `${noun} needs at least two levels.`,
        };
      }
      singleLevel.push(c.name);
    } else {
      const [reference, ...rest] = levels;
      categorical.push({ name: c.name, reference, levels });
      for (const level of rest) {
        design.push({
          term: `${c.name}[${level}]`,
          source: c.name,
          kind: "dummy",
          values: rows.map((r) => (levelCell(c, r) === level ? 1 : 0)),
          level,
          reference,
        });
      }
    }
  }
  return { design, categorical, singleLevel, droppedNoComplete };
}

/** The descriptives' groups for a fit: the dependent plus the numeric design
 *  columns, on the complete cases. */
export function alignedGroups(dep: Column, depValues: number[], design: DesignColumn[]): Group[] {
  return [
    { name: dep.name, values: depValues },
    ...design.filter((d) => d.kind === "numeric").map((d) => ({ name: d.source, values: d.values })),
  ];
}

/** Complete rows for a fit with text predictors, judged to a fixed point: a
 *  text column with no levels on the rows the numeric columns allow drops
 *  out (named in `droppedNoComplete`) and the rows are recomputed without
 *  it, so one empty text column cannot empty the whole fit. Levels are
 *  judged on the rows the numeric columns allow — never on rows the text
 *  columns themselves emptied, or one empty text column would take every
 *  other text column down with it. Numeric columns never drop (their
 *  missing rows stay missing, as before). */
export function completeRowsDroppingEmptyText(
  base: Column[],
  chosenCols: Column[],
): { rows: number[]; kept: Column[]; droppedNoComplete: string[] } {
  let kept = chosenCols.filter((c) => c.values.length > 0 || levelsOf(c).length > 0);
  const droppedNoComplete: string[] = [];
  // First pass: the rows the numeric columns allow, text presence ignored.
  let rows = completeRows([...base, ...kept.filter((c) => c.values.length > 0)]);
  for (;;) {
    const empty = kept.filter((c) => c.values.length === 0 && levelsOnRows(c, rows).length === 0);
    if (empty.length === 0) break;
    for (const c of empty) droppedNoComplete.push(c.name);
    kept = kept.filter((c) => !empty.includes(c));
    rows = completeRows([...base, ...kept]);
  }
  return { rows, kept, droppedNoComplete };
}

export function selectPredictors(
  columns: Column[],
  params: { dependent?: string; predictors?: string[] } | undefined,
): PredictorSelection {
  // Labels never enter a fit: not as the default dependent, not in the
  // default predictor set, and not when chosen by name — those are refused
  // with the label named (seq 331 half B).
  const vars = dataGroups(columns).filter((c) => c.variableType !== "label");
  const labelDep =
    params?.dependent !== undefined
      ? columns.find((c) => c.name === params.dependent && c.variableType === "label")
      : undefined;
  const labelPred = (params?.predictors ?? [])
    .map((name) => columns.find((c) => c.name === name))
    .find((c) => c?.variableType === "label");
  const labelError = labelDep
    ? `“${labelDep.name}” is a label variable — it cannot be the dependent variable. Choose a continuous variable instead.`
    : labelPred
      ? labelPredictorError(labelPred.name)
      : undefined;
  const dep = params?.dependent === undefined ? vars[0] : vars.find((c) => c.name === params.dependent);
  const chosen = params?.predictors;
  const explicit = chosen !== undefined && chosen.length > 0;
  // Numeric predictors as before; text columns are resolved too — a chosen
  // text predictor is expanded, not dropped (seq 224). A column holding
  // neither numbers nor text levels stays out of the complete rows (it would
  // empty them) and is reported in `dropped` instead.
  const resolved = dep
    ? explicit
      ? chosen
          .filter((name) => name !== dep.name)
          .map((name) => columns.find((c) => c.name === name))
          .filter((c): c is Column => c !== undefined)
      : columns.filter(
          (c) => c !== dep && c.variableType !== "label" && (c.values.length > 0 || levelsOf(c).length > 0),
        )
    : [];
  const chosenCols = resolved.filter(
    (c) => c.variableType !== "label" && (c.values.length > 0 || levelsOf(c).length > 0),
  );
  const predictors = chosenCols.filter((c) => columnKind(c) === "numeric");
  const { rows, kept, droppedNoComplete: droppedEmpty } = dep
    ? completeRowsDroppingEmptyText([dep], chosenCols)
    : { rows: [] as number[], kept: [] as Column[], droppedNoComplete: [] as string[] };
  const depValues = dep ? rows.map((r) => dep.byRow[r]!) : [];
  const expanded = expandDesign(kept, rows, explicit);
  const dropped =
    dep && explicit
      ? [...new Set(chosen.filter((name) => name !== dep.name && !chosenCols.some((c) => c.name === name)))]
      : [];
  return {
    dep,
    predictors,
    design: expanded.design,
    dropped,
    droppedNoComplete: [...droppedEmpty, ...expanded.droppedNoComplete],
    categorical: expanded.categorical,
    singleLevel: expanded.singleLevel,
    rows,
    depValues,
    ...(labelError ? { error: labelError } : expanded.error ? { error: expanded.error } : {}),
  };
}

/** The sentence the fit's notes carry for dropped predictors — "" when none
 *  were dropped, so callers append it unconditionally. */
export function droppedPredictorsNote(dropped: string[]): string {
  if (dropped.length === 0) return "";
  const plural = dropped.length > 1;
  const names = dropped.map((n) => `“${n}”`).join(", ");
  return (
    ` Note: ${names} ${plural ? "were" : "was"} chosen as predictor${plural ? "s" : ""} but hold${plural ? "" : "s"} no numbers, ` +
    `so ${plural ? "they were" : "it was"} left out of the fit — the statistics above describe the fitted predictors only.`
  );
}

/** The sentence for text predictors with levels but none on the complete
 *  rows — "" when none, so callers append it unconditionally. */
export function droppedNoCompleteNote(droppedNoComplete: string[]): string {
  if (droppedNoComplete.length === 0) return "";
  const plural = droppedNoComplete.length > 1;
  const names = droppedNoComplete.map((n) => `“${n}”`).join(", ");
  return (
    ` Note: ${names} ${plural ? "have" : "has"} no values on the complete rows, ` +
    `so ${plural ? "they were" : "it was"} left out of the fit — the statistics above describe the fitted predictors only.`
  );
}

/** The sentence naming the categorical predictors and their reference levels —
 *  "" when none, so callers append it unconditionally. A skipped single-level
 *  text predictor is named too, so the default case never drops one silently.
 *  `noun` is "predictor" for the regressions, "covariate" for Cox. */
export function categoricalPredictorsNote(
  categorical: CategoricalPredictor[],
  singleLevel: string[],
  noun = "predictor",
): string {
  const parts: string[] = [];
  for (const c of categorical) {
    parts.push(
      `“${c.name}” is a categorical ${noun}, dummy-coded with “${c.reference}” as the reference ` +
        `(levels: ${c.levels.map((l) => `“${l}”`).join(", ")}).`,
    );
  }
  if (singleLevel.length > 0) {
    const plural = singleLevel.length > 1;
    parts.push(
      `${singleLevel.map((n) => `“${n}”`).join(", ")} ${plural ? "have" : "has"} only one level on the complete ` +
        `rows, so ${plural ? "they were" : "it was"} left out of the fit.`,
    );
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** The user-facing error when R aliased one or more design columns — the
 *  fit's `summary(m)$coefficients` drops the aliased rows, so the runner
 *  must name them from `is.na(coef(m))` instead of indexing the matrix
 *  (bug-report item 23). `aliased` holds one flag per design column, in
 *  design order (1 = aliased, as R returns them); a constant design column
 *  ("no variation") is told apart from a collinear one. Returns null when
 *  no design column is flagged. */
export function aliasedPredictorsError(
  design: DesignColumn[],
  aliased: readonly (number | null | undefined)[],
  fitName: string,
): string | null {
  const idx = design.map((_, i) => i).filter((i) => aliased[i] === 1);
  if (idx.length === 0) return null;
  const names = (list: number[]) => list.map((i) => `“${design[i].term}”`).join(", ");
  const constant = idx.filter((i) => sd(design[i].values) === 0);
  const collinear = idx.filter((i) => sd(design[i].values) !== 0);
  const parts: string[] = [];
  if (constant.length > 0) {
    parts.push(
      `${names(constant)} ${constant.length > 1 ? "are" : "is"} constant — ${fitName} cannot estimate a slope for a predictor with no variation.`,
    );
  }
  if (collinear.length > 0) {
    parts.push(
      `${names(collinear)} ${collinear.length > 1 ? "are" : "is"} collinear with another predictor — ${fitName} cannot estimate a separate coefficient for ${collinear.length > 1 ? "them" : "it"}.`,
    );
  }
  return `${parts.join(" ")} Drop or recode the predictor${idx.length > 1 ? "s" : ""} and try again.`;
}
