// "Transform data" (Prism's Transform: Analyse → Transform) — apply one
// function to every value of the chosen columns and report the transformed
// values as a results sheet. The source table is never changed: Prism
// creates a new results table, and so does this runner — the transformed
// values live in the result's `transformed` tables only.
//
// Functions are Prism's documented standard set (Prism 8 User Guide,
// "Transform data"): log10, ln, log2, sqrt, reciprocal (1/Y), exp, square —
// plus Prism's arithmetic transforms (seq 205): Y+K, Y−K, Y×K, Y/K, K−Y, K/Y,
// which apply a constant K to every value — plus the rest of Prism's
// documented set (seq 341): logit, probit, rank, zscore, trig, ABS,
// Y+Random, rounding, Y^K, 10^Y, 2^Y, −log10, the X/Y cross-column functions,
// X transforms + interchange, per-data-set K, error-bar handling on
// mean±SD/SEM tables, and user-defined transforms through the calcvars
// evaluator — plus Lineweaver-Burk (seq 384), the double-reciprocal re-plot:
// Y through `lineweaver-burk`, X through the existing `xFn` path with
// `reciprocal` — plus log-log (seq 385): the Y side is log10, and the X side
// goes through the existing xFn path with log10 (the wizard pairs them by
// default; an MCP caller passes xFunction: "log10") — plus Hanes-Woolf
// (seq 381): Y becomes X/Y, X unchanged — plus the Hill plot (seq 383).
// plus Eadie-Hofstee (seq 380), as an X transform (X becomes Y/X, Y
// unchanged) — plus Scatchard (seq 386): X becomes Y, Y becomes Y/X. Pure
// TypeScript, no R for the values themselves; the transformed
// groups' descriptives come from `describe` (R), like every other analysis.
// The one exception is the to-CI error mode, whose t critical values come
// from the pure-TS `tCrit95` (src/lib/student-t.ts).
//
// A value the function is undefined for — log of ≤ 0, square root of a
// negative, reciprocal of 0, an exp/square that overflows — is left blank
// (null) in the results and counted in `excluded`, never NaN or Infinity:
// Prism likewise returns blank for invalid inputs. The notes name the
// reason per column, so a blank is never silent.
//
// Layout note (vs Prism): Prism staggers multiple data sets into one row
// block per set; this runner keeps the existing per-column `transformed`
// shape (one entry per column, Y entries first, then the X entry), so the
// results view needs no new rendering.
import type { AnalysisOutcome, Column, GroupDescriptives, TransformDataParams, TransformErrorMode, TransformFunction } from "../types";
import {
  TRANSFORM_ARITHMETIC_FUNCTIONS,
  TRANSFORM_COLUMN_FUNCTIONS,
  TRANSFORM_CROSS_FUNCTIONS,
  TRANSFORM_FUNCTIONS,
  TRANSFORM_K_FUNCTIONS,
} from "../types";
import { dataGroups, describe, missingColumn } from "./base";
import { tCrit95 } from "../../lib/student-t";
import { dependenciesOf, evaluateFormula, parseFormula, type EvalContext, type Expr } from "../../lib/calcvars";

/** Whether a function is one of the arithmetic ones (needs a constant K). */
export const isArithmeticTransform = (fn: TransformFunction): boolean =>
  (TRANSFORM_ARITHMETIC_FUNCTIONS as readonly string[]).includes(fn);

/** Whether a function needs a constant K (seq 205 arithmetic + seq 341). */
export const isKTransform = (fn: TransformFunction): boolean =>
  (TRANSFORM_K_FUNCTIONS as readonly string[]).includes(fn);

/** Whether a function reads the paired X value (seq 341 cross-column). */
export const isCrossTransform = (fn: TransformFunction): boolean =>
  (TRANSFORM_CROSS_FUNCTIONS as readonly string[]).includes(fn);

/** Whether a function reads the whole column (rank, zscore). */
export const isColumnTransform = (fn: TransformFunction): boolean =>
  (TRANSFORM_COLUMN_FUNCTIONS as readonly string[]).includes(fn);

/** How each function is written in the results (and in the wizard's labels). */
export const TRANSFORM_LABEL: Record<TransformFunction, string> = {
  log10: "log10(Y)",
  ln: "ln(Y)",
  log2: "log2(Y)",
  sqrt: "sqrt(Y)",
  reciprocal: "1/Y",
  "lineweaver-burk": "Lineweaver-Burk",
  exp: "exp(Y)",
  square: "Y²",
  "y-plus-k": "Y+K",
  "y-minus-k": "Y−K",
  "y-times-k": "Y×K",
  "y-divided-by-k": "Y/K",
  "k-minus-y": "K−Y",
  "k-divided-by-y": "K/Y",
  logit: "logit(Y)",
  probit: "probit(Y)",
  rank: "rank(Y)",
  zscore: "zscore(Y)",
  sin: "sin(Y)",
  cos: "cos(Y)",
  tan: "tan(Y)",
  arcsin: "arcsin(Y)",
  abs: "|Y|",
  "y-plus-random": "Y+Random",
  "round-k": "round(Y, K)",
  "y-power-k": "Y^K",
  "ten-power-y": "10^Y",
  "two-power-y": "2^Y",
  "neg-log10": "−log10(Y)",
  "log-log": "log-log",
  "x-divided-by-y": "X/Y",
  "y-divided-by-x": "Y/X",
  "y-minus-x": "Y−X",
  "y-plus-x": "Y+X",
  "y-times-x": "Y×X",
  "x-minus-y": "X−Y",
  "eadie-hofstee": "Y/X",
  "hanes-woolf": "Hanes-Woolf",
  scatchard: "Scatchard",
  "user-defined": "user-defined",
  "hill-plot": "Hill plot",
};

/** Why a value of this function is left blank, for the notes. */
const EXCLUDED_REASON: Record<TransformFunction, string> = {
  log10: "log10 is undefined for values ≤ 0",
  ln: "ln is undefined for values ≤ 0",
  log2: "log2 is undefined for values ≤ 0",
  sqrt: "the square root is undefined for negative values",
  reciprocal: "the reciprocal is undefined for 0",
  "lineweaver-burk": "the reciprocal is undefined for 0",
  exp: "exp overflowed (the result is too large)",
  square: "squaring overflowed (the result is too large)",
  "y-plus-k": "adding overflowed (the result is too large)",
  "y-minus-k": "subtracting overflowed (the result is too large)",
  "y-times-k": "multiplying overflowed (the result is too large)",
  "y-divided-by-k": "dividing overflowed (the result is too large)",
  "k-minus-y": "subtracting overflowed (the result is too large)",
  "k-divided-by-y": "K/Y is undefined for values of 0",
  logit: "logit is undefined for values outside (0, 1)",
  probit: "probit is undefined for values outside (0, 1)",
  rank: "rank needs at least one value",
  zscore: "the z-score is undefined when the column has fewer than 2 values or no spread",
  sin: "the result overflowed (too large)",
  cos: "the result overflowed (too large)",
  tan: "the result overflowed (too large)",
  arcsin: "arcsin is undefined for values outside [−1, 1]",
  abs: "the result overflowed (too large)",
  "y-plus-random": "the result overflowed (too large)",
  "round-k": "rounding overflowed (the result is too large)",
  "y-power-k": "the power is undefined for this value (a negative base to a non-integer power, or 0 to a negative power)",
  "ten-power-y": "10^Y overflowed (the result is too large)",
  "two-power-y": "2^Y overflowed (the result is too large)",
  "neg-log10": "−log10 is undefined for values ≤ 0",
  "log-log": "log10 is undefined for values ≤ 0",
  "x-divided-by-y": "X/Y is undefined when Y is 0 or the paired value is missing",
  "y-divided-by-x": "Y/X is undefined when X is 0 or the paired value is missing",
  "y-minus-x": "the paired X value is missing",
  "y-plus-x": "the paired X value is missing",
  "y-times-x": "the paired X value is missing",
  "x-minus-y": "the paired X value is missing",
  "eadie-hofstee": "Y/X is undefined when X is 0 or the paired value is missing",
  "hanes-woolf": "X/Y is undefined when Y is 0 or the paired value is missing",
  scatchard: "the paired value is missing, or X is 0",
  "user-defined": "the formula left it blank (dividing by zero, or a value outside a function's domain)",
  "hill-plot": "the Hill plot is undefined for Y ≤ 0 or Y ≥ Ymax",
};

/** Φ⁻¹(p) — Peter Acklam's rational approximation (relative error < 1.2e-9),
 *  the probit behind Prism's probit(Y) = Φ⁻¹(Y) + 5. */
const inverseNormalCdf = (p: number): number => {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};

/** The fixed seed for Y+Random (seq 341): the same run twice gives the same
 *  values, so a transform is reproducible — the notes say so. */
export const TRANSFORM_RANDOM_SEED = 341;

/** A deterministic standard-normal generator: mulberry32 uniforms through
 *  Box-Muller, one draw per call (the spare second draw is cached, so the
 *  sequence is the same however the draws are consumed). */
export function seededGaussian(seed: number): () => number {
  let s = seed | 0;
  let spare: number | null = null;
  const uniform = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    if (spare != null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = 0;
    while (u1 === 0) u1 = uniform(); // log(0) is undefined; a 0 draw is re-drawn
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** Average ranks (smallest = 1, ties share the mean rank), blanks stay blank. */
export function rankValues(byRow: (number | null)[]): (number | null)[] {
  const indexed = byRow.map((v, i) => ({ v, i })).filter((e): e is { v: number; i: number } => e.v != null);
  const sorted = [...indexed].sort((a, b) => a.v - b.v);
  const out: (number | null)[] = byRow.map(() => null);
  let j = 0;
  while (j < sorted.length) {
    let k = j;
    while (k + 1 < sorted.length && sorted[k + 1].v === sorted[j].v) k++;
    const avg = (j + 1 + (k + 1)) / 2; // 1-based ranks j+1..k+1
    for (let m = j; m <= k; m++) out[sorted[m].i] = avg;
    j = k + 1;
  }
  return out;
}

/** (v − mean) / sample SD over the column's non-null values; null when the
 *  SD is 0 or the column holds fewer than 2 values. */
export function zscoreValues(byRow: (number | null)[]): (number | null)[] {
  const vals = byRow.filter((v): v is number => v != null);
  if (vals.length < 2) return byRow.map(() => null);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length - 1));
  if (!(sd > 0)) return byRow.map(() => null);
  return byRow.map((v) => (v == null ? null : (v - mean) / sd));
}

/** One value transformed, or null when the function is undefined for it
 *  (or the input is not finite). Null is a blank in the results, never NaN.
 *  `constant` is the K of the K-needing functions — required for those.
 *  `ymax` is the Ymax of the Hill plot — required for it. `other` is the
 *  paired value from the other column (cross-column functions); `role` says
 *  whether `value` is the Y or the X of the pair — the cross-column formulas
 *  are always in absolute (Y, X) terms. `random` is the run's standard-normal
 *  draw (Y+Random); without one there is nothing to add. Rank, zscore and
 *  user-defined are column/formula functions, not single-value ones — they
 *  blank here (the runner handles them at the column level). */
export function transformValue(
  fn: TransformFunction,
  value: number,
  constant?: number,
  other?: number | null,
  role: "y" | "x" = "y",
  random?: () => number,
  ymax?: number,
): number | null {
  if (!Number.isFinite(value)) return null;
  // A K-needing function without its constant has nothing to apply — blank,
  // never NaN. The runner refuses such a run outright; this is the backstop.
  if (isKTransform(fn) && !Number.isFinite(constant)) return null;
  // The Hill plot without its Ymax has nothing to divide by — blank, never
  // NaN. The runner refuses such a run outright; this is the backstop.
  if (fn === "hill-plot" && (!Number.isFinite(ymax) || ymax! <= 0)) return null;
  // A cross-column function without its paired value has nothing to pair.
  if (isCrossTransform(fn)) {
    const y = role === "y" ? value : other;
    const x = role === "y" ? other : value;
    if (x == null || y == null) return null;
  }
  // The paired value, in absolute (Y, X) terms.
  const y = role === "y" ? value : other;
  const x = role === "y" ? other : value;
  let out: number;
  switch (fn) {
    case "log10":
    case "log-log":
      if (value <= 0) return null;
      out = Math.log10(value);
      break;
    case "ln":
      if (value <= 0) return null;
      out = Math.log(value);
      break;
    case "log2":
      if (value <= 0) return null;
      out = Math.log2(value);
      break;
    case "sqrt":
      if (value < 0) return null;
      out = Math.sqrt(value);
      break;
    case "reciprocal":
      if (value === 0) return null;
      out = 1 / value;
      break;
    case "lineweaver-burk":
      // The double-reciprocal re-plot's Y side: 1/Y, exactly the reciprocal
      // under its own name (the X side comes through the `xFn` path with
      // `reciprocal` — see the scope, seq 384).
      if (value === 0) return null;
      out = 1 / value;
      break;
    case "exp":
      out = Math.exp(value);
      break;
    case "square":
      out = value * value;
      break;
    case "y-plus-k":
      out = value + constant!;
      break;
    case "y-minus-k":
      out = value - constant!;
      break;
    case "y-times-k":
      out = value * constant!;
      break;
    case "y-divided-by-k":
      out = value / constant!;
      break;
    case "k-minus-y":
      out = constant! - value;
      break;
    case "k-divided-by-y":
      if (value === 0) return null;
      out = constant! / value;
      break;
    case "logit":
      if (value <= 0 || value >= 1) return null;
      out = Math.log(value / (1 - value));
      break;
    case "probit":
      if (value <= 0 || value >= 1) return null;
      out = inverseNormalCdf(value) + 5;
      break;
    case "sin":
      out = Math.sin(value);
      break;
    case "cos":
      out = Math.cos(value);
      break;
    case "tan":
      out = Math.tan(value);
      break;
    case "arcsin":
      if (value < -1 || value > 1) return null;
      out = Math.asin(value);
      break;
    case "abs":
      out = Math.abs(value);
      break;
    case "y-plus-random":
      if (!random || constant! <= 0) return null;
      out = value + random() * constant!;
      break;
    case "round-k":
      if (!Number.isInteger(constant) || constant! < 0 || constant! > 15) return null;
      {
        const factor = 10 ** constant!;
        out = Math.round(value * factor) / factor;
      }
      break;
    case "y-power-k":
      if (value === 0 && constant! < 0) return null;
      if (value < 0 && !Number.isInteger(constant)) return null;
      out = value ** constant!;
      break;
    case "ten-power-y":
      out = 10 ** value;
      break;
    case "two-power-y":
      out = 2 ** value;
      break;
    case "neg-log10":
      if (value <= 0) return null;
      out = -Math.log10(value);
      break;
    case "x-divided-by-y":
      if (y === 0) return null;
      out = x! / y!;
      break;
    case "y-divided-by-x":
      if (x === 0) return null;
      out = y! / x!;
      break;
    case "eadie-hofstee":
      // The same Y/X formula, as the X transform: X becomes Y/X (the
      // Eadie-Hofstee re-plot), Y passing through unchanged at the runner.
      if (x === 0) return null;
      out = y! / x!;
      break;
    case "y-minus-x":
      out = y! - x!;
      break;
    case "y-plus-x":
      out = y! + x!;
      break;
    case "y-times-x":
      out = y! * x!;
      break;
    case "x-minus-y":
      out = x! - y!;
      break;
    case "hanes-woolf":
      // Hanes-Woolf (seq 381): X/Y, for enzyme kinetics — X unchanged (the
      // X column is the pairing source, not a Y column, so it never takes
      // this function); Y = 0 blanks, like every other division.
      if (y === 0) return null;
      out = x! / y!;
      break;
    case "hill-plot":
      // log10(Y/(Ymax−Y)): undefined for Y ≤ 0 (the ratio is not positive)
      // and for Y ≥ Ymax (the denominator is not positive).
      if (value <= 0 || value >= ymax!) return null;
      out = Math.log10(value / (ymax! - value));
    break;
    case "scatchard":
      // The Scatchard re-plot (seq 386): the Y value becomes Y/X
      // (bound/free) and the X value becomes the paired Y (bound). An X
      // of 0 leaves the Y blank; a missing paired value blanks either way
      // (the cross-column guard above).
      if (role === "y") {
        if (x === 0) return null;
        out = y! / x!;
      } else {
        out = y!;
      }
      break;
    case "rank":
    case "zscore":
    case "user-defined":
      return null;
  }
  return Number.isFinite(out) ? out : null;
}

// ── User-defined transforms (seq 341) ────────────────────────────────────

/** One parsed formula line: an optional designator and its expression. */
interface FormulaLine {
  designator?: { name: string; except: boolean };
  ast: Expr;
}

/** Parse a user-defined transform's formula text into lines (separated by
 *  `;` or newlines), each optionally starting with a designator `<Name>`
 *  (only that data set) or `<~Name>` (all data sets except it), then an
 *  expression with an optional `Y =` prefix. Unknown variables — anything
 *  but Y, X, PI, E and the table's column/set names — are a clean error
 *  naming the variable. Exported: the wizard's formula question validates
 *  with the same function the runner runs, so the GUI and MCP paths refuse
 *  the same formulas. */
export const parseUserFormula = (
  text: string,
  columns: Column[],
): { lines: FormulaLine[] } | { error: string } => {
  const knownNames = new Set<string>(["Y", "X", "PI", "E"]);
  for (const c of columns) {
    knownNames.add(c.name);
    if (c.set !== undefined) knownNames.add(c.set);
  }
  const rawLines = text
    .split(/[\n;]/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (rawLines.length === 0)
    return { error: "“user-defined” needs a formula — write one and try again." };
  const lines: FormulaLine[] = [];
  for (const raw of rawLines) {
    let rest = raw;
    let designator: FormulaLine["designator"];
    const dm = rest.match(/^<(~?)([^<>]+)>\s*/);
    if (dm) {
      designator = { name: dm[2].trim(), except: dm[1] === "~" };
      rest = rest.slice(dm[0].length);
    }
    rest = rest.replace(/^Y\s*=\s*/, "");
    const parsed = parseFormula(rest);
    if ("error" in parsed) return { error: parsed.error };
    const unknown = dependenciesOf(parsed.ast).find((d) => !knownNames.has(d));
    if (unknown)
      return { error: `The formula uses “${unknown}”, which is not a column or data set in this table.` };
    lines.push({ designator, ast: parsed.ast });
  }
  return { lines };
};

/** The first formula line applying to this column (designators match the
 *  column's data-set key), or null when no line applies — the column then
 *  passes through unchanged. */
const lineForColumn = (lines: FormulaLine[], column: Column): Expr | null => {
  const key = column.set ?? column.name;
  for (const line of lines) {
    if (!line.designator) return line.ast;
    const applies = line.designator.except ? line.designator.name !== key : line.designator.name === key;
    if (applies) return line.ast;
  }
  return null;
};

// ── Error bars on summary tables (seq 341) ───────────────────────────────

type SummaryError =
  | { kind: "sd" | "sem" | "cv"; column: Column }
  | { kind: "plus-minus"; plus?: Column; minus?: Column }
  | { kind: "upper-lower"; upper?: Column; lower?: Column };

/** A grouped table's summary group: its Mean column, its error columns and
 *  its N column, read from the sub-column names ("A:Mean", "A:SD", "A:N"). */
interface SummaryGroup {
  key: string;
  mean: Column;
  error: SummaryError;
  n?: Column;
}

/** The error columns of a summary group, in table order. */
const errorColumnsOf = (error: SummaryError): Column[] => {
  switch (error.kind) {
    case "sd":
    case "sem":
    case "cv":
      return [error.column];
    case "plus-minus":
      return [error.plus, error.minus].filter((c): c is Column => c !== undefined);
    case "upper-lower":
      return [error.upper, error.lower].filter((c): c is Column => c !== undefined);
  }
};

/** Detect the summary groups among the columns: a Mean sub-column with at
 *  least one error sub-column under the same group key. A plain column, or
 *  a Mean with no error column, is not a group. */
const detectSummaryGroups = (cols: Column[]): SummaryGroup[] => {
  const byKey = new Map<string, Map<string, Column>>();
  for (const c of cols) {
    const sep = c.name.indexOf(":");
    if (sep <= 0) continue;
    const key = c.name.slice(0, sep);
    const sub = c.name.slice(sep + 1);
    if (!byKey.has(key)) byKey.set(key, new Map());
    byKey.get(key)!.set(sub, c);
  }
  const groups: SummaryGroup[] = [];
  for (const [key, subs] of byKey) {
    const mean = subs.get("Mean");
    if (!mean) continue;
    let error: SummaryError | undefined;
    if (subs.has("SD")) error = { kind: "sd", column: subs.get("SD")! };
    else if (subs.has("SEM")) error = { kind: "sem", column: subs.get("SEM")! };
    else if (subs.has("CV")) error = { kind: "cv", column: subs.get("CV")! };
    else if (subs.has("+error") || subs.has("−error") || subs.has("-error"))
      error = { kind: "plus-minus", plus: subs.get("+error"), minus: subs.get("−error") ?? subs.get("-error") };
    else if (subs.has("Upper limit") || subs.has("Lower limit"))
      error = { kind: "upper-lower", upper: subs.get("Upper limit"), lower: subs.get("Lower limit") };
    if (!error) continue;
    groups.push({ key, mean, error, n: subs.get("N") });
  }
  return groups;
};

/** The 95% normal critical value, for an SEM with no N to take a t from. */
const Z_95 = 1.959963984540054; // Φ⁻¹(0.975)

/** One row's 95% CI bounds for a summary group, from its mean, error and N
 *  (nulls when the interval cannot be computed — a missing error value, an
 *  N under 2, or no N at all for an SD/CV error). `usedZ` reports whether
 *  the z fallback was taken, so the notes can say so. */
const ciBounds = (
  group: SummaryGroup,
  row: number,
  mean: number | null,
): { lower: number | null; upper: number | null; usedZ: boolean } => {
  const none = { lower: null, upper: null, usedZ: false };
  if (mean == null) return none;
  const nRaw = group.n?.byRow[row] ?? null;
  const n = nRaw != null && Number.isInteger(nRaw) && nRaw >= 2 ? nRaw : null;
  const err = group.error;
  switch (err.kind) {
    case "sd": {
      if (n == null) return none;
      const sd = err.column.byRow[row];
      if (sd == null) return none;
      const half = tCrit95(n - 1) * (sd / Math.sqrt(n));
      return { lower: mean - half, upper: mean + half, usedZ: false };
    }
    case "sem": {
      const sem = err.column.byRow[row];
      if (sem == null) return none;
      if (n != null) {
        const half = tCrit95(n - 1) * sem;
        return { lower: mean - half, upper: mean + half, usedZ: false };
      }
      if (group.n == null) {
        // No N column at all: no t to use — the 95% normal value stands in.
        const half = Z_95 * sem;
        return { lower: mean - half, upper: mean + half, usedZ: true };
      }
      return none; // This row's N is missing or under 2.
    }
    case "cv": {
      if (n == null) return none;
      const cv = err.column.byRow[row];
      if (cv == null) return none;
      const sd = (cv * mean) / 100;
      const half = tCrit95(n - 1) * (sd / Math.sqrt(n));
      return { lower: mean - half, upper: mean + half, usedZ: false };
    }
    case "plus-minus": {
      const plus = err.plus?.byRow[row] ?? null;
      const minus = err.minus?.byRow[row] ?? null;
      if (plus == null || minus == null) return none;
      return { lower: mean - minus, upper: mean + plus, usedZ: false };
    }
    case "upper-lower": {
      const upper = err.upper?.byRow[row] ?? null;
      const lower = err.lower?.byRow[row] ?? null;
      if (upper == null || lower == null) return none;
      return { lower, upper, usedZ: false };
    }
  }
};

// ── The runner ──────────────────────────────────────────────────────────

/** How one column's values are transformed. */
interface ValueTransform {
  /** Transform one row's value (null in → null out). */
  one: (value: number, row: number, paired: number | null) => number | null;
  /** Transform a whole column at once (rank/zscore); undefined for the rest. */
  whole?: (byRow: (number | null)[]) => (number | null)[];
}

interface BuiltEntry {
  entry: { column: string; label: string; original: (number | null)[]; values: (number | null)[]; excluded: number };
  /** "data" feeds the descriptives and the stats; "ci" feeds the stats
   *  only; "passthrough" feeds neither (an unchanged error/N column). */
  kind: "data" | "ci" | "passthrough";
  /** Why this entry's values are blank, for the notes. */
  reason: string;
}

export async function runTransformData(
  columns: Column[],
  params: TransformDataParams | undefined,
): Promise<AnalysisOutcome> {
  const fn: TransformFunction = params?.function ?? "log10";
  if (!(TRANSFORM_FUNCTIONS as readonly string[]).includes(fn))
    return { error: `Unknown transform function: “${fn}”.` };
  const label = TRANSFORM_LABEL[fn];
  // Eadie-Hofstee (seq 380) is an X transform, not a Y one: the run rewrites
  // X to Y/X and leaves Y untouched, so the X-function slot below does the
  // rewriting (paired with the first Y column). An explicit X function or an
  // interchange alongside it would fight that rewriting — refused clean.
  const rawXFn = params?.xFunction;
  if (rawXFn !== undefined && !(TRANSFORM_FUNCTIONS as readonly string[]).includes(rawXFn))
    return { error: `Unknown transform function for X: “${rawXFn}”.` };
  if (rawXFn === "user-defined")
    return { error: "A user-defined transform applies to the Y values — choose a built-in function for the X values." };
  // Hill plot (seq 383): X becomes log10(X) unless the data were entered
  // as log(concentration) — the X transform rides the existing xFunction
  // machinery, so the notes and the X entry read exactly as if the caller
  // had asked for log10 on X. An explicit xFunction wins over the derived
  // one. The X column is NOT required for a Hill plot: without one, only
  // the Y values transform (needsX below still uses the caller's xFunction).
  const xFn = fn === "eadie-hofstee" ? "eadie-hofstee" : rawXFn;
  if (fn === "scatchard" && xFn !== undefined)
    return { error: "“Scatchard” already rewrites the X values (X becomes Y) — leave the X function unset." };
  const hillXFn: TransformFunction | undefined =
    fn === "hill-plot" && xFn === undefined && params?.xIsLog !== true ? "log10" : undefined;
  // Scatchard's X rewrite rides the X-transform path: the X entry is built
  // with the same function (role "x" returns the paired Y).
  const effXFn = fn === "scatchard" ? "scatchard" : (xFn ?? hillXFn);
  const errorMode: TransformErrorMode = params?.errorMode ?? "mean-only";
  if (!["mean-only", "erase", "to-ci"].includes(errorMode))
    return { error: `Unknown error handling: “${errorMode}”.` };
  const interchange = params?.interchange === true;
  if (fn === "eadie-hofstee" && rawXFn !== undefined)
    return { error: "Eadie-Hofstee already transforms the X values — choose no X function." };
  if (fn === "eadie-hofstee" && interchange)
    return { error: "Eadie-Hofstee already transforms the X values — interchange X and Y first, then run it." };

  // The user-defined formula is parsed up front, so a bad formula (or a
  // variable no column answers to) is a clean error before anything runs —
  // and whether it uses X decides whether the X column is needed.
  let formulaLines: FormulaLine[] | undefined;
  let formulaUsesX = false;
  if (fn === "user-defined") {
    if (params?.formula == null || params.formula.trim() === "")
      return { error: "“user-defined” needs a formula — write one and try again." };
    const parsed = parseUserFormula(params.formula, columns);
    if ("error" in parsed) return { error: parsed.error };
    formulaLines = parsed.lines;
    formulaUsesX = parsed.lines.some((l) => dependenciesOf(l.ast).includes("X"));
  }

  // The X column: named in `x`, resolved among the scoped columns. It is
  // never a Y column itself (normalize's precedent) — it pairs with the Y
  // values, or is transformed by `xFunction`. It is only REQUIRED when
  // something reads it: a cross-column function, an X function, an
  // interchange, or a formula that uses X.
  const needsX = isCrossTransform(fn) || xFn !== undefined || interchange || formulaUsesX;
  let xCol: Column | undefined;
  if (needsX) {
    if (!params?.x) {
      if (isCrossTransform(fn)) return { error: `“${label}” needs the X column — name it in \`x\` and try again.` };
      if (interchange) return { error: "Interchange needs the X column — name it in `x` and try again." };
      if (xFn !== undefined) return { error: "Transforming the X values needs the X column — name it in `x` and try again." };
      return { error: "The formula uses X, but no X column was given — name it in `x` and try again." };
    }
    xCol = columns.find((c) => c.name === params.x);
    if (!xCol) return { error: missingColumn(params.x) };
  } else if (params?.x) {
    xCol = columns.find((c) => c.name === params.x);
  }

  // The Y columns: every numeric column but X. Interchange swaps the roles
  // first — the Y function then applies to the values that were in X, the
  // X function to the values that were in Y (Prism: transforms apply AFTER
  // the interchange).
  const yCols = dataGroups(columns.filter((c) => c !== xCol));
  const yTargets = interchange ? (xCol?.values.length ? [xCol] : []) : yCols;
  const xTargets = interchange ? yCols : xFn !== undefined && xCol?.values.length ? [xCol] : [];
  if (yTargets.length === 0 && xTargets.length === 0) {
    return { error: "This needs at least 1 column containing numeric data." };
  }

  // Summary groups (mean±SD/SEM tables) and the error mode govern the Mean
  // and error columns; interchange and error handling cannot be combined —
  // the swap would leave the error structure without a home.
  const summaryGroups = detectSummaryGroups(columns).filter((g) => g.mean.values.length > 0);
  if (interchange && summaryGroups.length > 0)
    return { error: "Interchange and error-bar handling cannot be combined — interchange X and Y first, then transform the means." };
  if (errorMode === "to-ci" && isColumnTransform(fn))
    return { error: `“${label}” cannot convert error bars to confidence intervals — choose “mean-only” or “erase” for the error bars.` };
  const groupByMean = new Map(summaryGroups.map((g) => [g.mean.name, g]));
  const summaryColumns = new Set(summaryGroups.flatMap((g) => [g.mean.name, ...errorColumnsOf(g.error).map((c) => c.name), ...(g.n ? [g.n.name] : [])]));

  // The constant K, per column: a per-data-set entry wins, then the single
  // constant. The key is the column's data-set key (its group, or its own
  // name for a column table).
  const resolveK = (column: Column): number | undefined => {
    const bySet = params?.constants?.[column.set ?? column.name];
    if (Number.isFinite(bySet)) return bySet;
    const byName = params?.constants?.[column.name];
    if (Number.isFinite(byName)) return byName;
    const single = params?.constant;
    return Number.isFinite(single) ? single : undefined;
  };
  const kError = (f: TransformFunction, k: number | undefined, column: Column): string | undefined => {
    const l = TRANSFORM_LABEL[f];
    const key = column.set ?? column.name;
    if (k === undefined) {
      if (params?.constant == null && params?.constants == null)
        return `“${l}” needs a constant K — enter one and try again.`;
      return `“${l}” needs a constant K for data set “${key}” — enter one and try again.`;
    }
    if (f === "y-divided-by-k" && k === 0)
      return "“Y/K” needs a constant K other than 0 — dividing by 0 is undefined.";
    if (f === "y-plus-random" && k <= 0) return "“Y+Random” needs a constant K greater than 0 — K is the noise SD.";
    if (f === "round-k" && (!Number.isInteger(k) || k < 0 || k > 15))
      return "“round(Y, K)” needs K to be a whole number from 0 to 15.";
    return undefined;
  };
  // Validate K for every column the run will transform, before transforming.
  if (isKTransform(fn)) {
    for (const col of yTargets) {
      const err = kError(fn, resolveK(col), col);
      if (err) return { error: err };
    }
  }
  if (xFn !== undefined && isKTransform(xFn) && xCol) {
    const err = kError(xFn, resolveK(xCol), xCol);
    if (err) return { error: err };
  }
  // Hill plot (seq 383): Ymax is required, like K for the K-needing
  // functions — and it must be positive, or every Y would be blank.
  if (fn === "hill-plot") {
    const ymax = params?.ymax;
    if (!Number.isFinite(ymax)) return { error: "“Hill plot” needs a Ymax — enter one and try again." };
    if (ymax! <= 0) return { error: "“Hill plot” needs a Ymax greater than 0." };
  }

  // One seeded generator per run (Y+Random): the same run twice draws the
  // same noise, in entry order.
  const rng = fn === "y-plus-random" || xFn === "y-plus-random" ? seededGaussian(TRANSFORM_RANDOM_SEED) : undefined;

  // The row context a user-defined formula reads: Y is the value being
  // transformed, X the paired X value, a column/set name the row's value in
  // that column/set (the current column's value for its own set).
  const rowCtx = (column: Column, row: number, yValue: number | null): EvalContext => {
    // One row lookup shared by `value` (this row) and `valueAt` (any row):
    // Y is the value being transformed, X the paired X value, a column/set
    // name the row's value in that column/set.
    const valueAt = (name: string, r: number): number | null => {
      if (name === "Y") return r === row ? yValue : (column.byRow[r] ?? null);
      if (name === "X") return xCol?.byRow[r] ?? null;
      const col = columns.find((c) => c.name === name);
      if (col) return col.byRow[r] ?? null;
      if (column.set === name) return r === row ? yValue : (column.byRow[r] ?? null);
      const setCol = columns.find((c) => c.set === name);
      return setCol?.byRow[r] ?? null;
    };
    return {
      value: (name) => valueAt(name, row),
      values: (name) => {
        if (name === "Y") return column.values;
        if (name === "X") return xCol?.values ?? [];
        const col = columns.find((c) => c.name === name);
        if (col) return col.values;
        return columns.filter((c) => c.set === name).flatMap((c) => c.values);
      },
      // Seq 377: the raw cell text COUNTA reads (values() is numeric-only).
      // A set name has no single cell — its numbers still count through
      // valueAt; its text has no reading here.
      rawTextAt: (name, r) => {
        if (name === "Y") return column.cells[r] ?? null;
        if (name === "X") return xCol?.cells[r] ?? null;
        const col = columns.find((c) => c.name === name);
        return col?.cells[r] ?? null;
      },
      // Seq 372 extended EvalContext with the row index, the row count and
      // an any-row read (window functions read them); a user-defined
      // transform formula is evaluated one row at a time, so they are this
      // row, the table's row count, and the same lookup above.
      valueAt,
      rowCount: column.byRow.length,
      row,
    };
  };

  /** How one column's values are transformed by the run's Y function. */
  const yTransform = (column: Column): ValueTransform | null => {
    if (fn === "eadie-hofstee") return null; // Y passes through unchanged.
    if (fn === "user-defined") {
      const ast = lineForColumn(formulaLines!, column);
      if (ast == null) return null; // No line applies: pass through unchanged.
      return { one: (value, row) => evaluateFormula(ast, rowCtx(column, row, value)) };
    }
    if (isColumnTransform(fn)) {
      return { one: () => null, whole: fn === "rank" ? rankValues : zscoreValues };
    }
    const k = isKTransform(fn) ? resolveK(column) : undefined;
    return { one: (value, _row, paired) => transformValue(fn, value, k, paired, "y", rng, params?.ymax) };
  };
  /** How one column's values are transformed by the X function. */
  const xTransform = (column: Column): ValueTransform => {
    if (isColumnTransform(effXFn!)) {
      return { one: () => null, whole: effXFn === "rank" ? rankValues : zscoreValues };
    }
    const k = isKTransform(effXFn!) ? resolveK(column) : undefined;
    return { one: (value, _row, paired) => transformValue(effXFn!, value, k, paired, "x", rng, params?.ymax) };
  };

  /** One results entry from a column and its transform (null: pass through). */
  const buildEntry = (
    column: Column,
    label: string,
    vt: ValueTransform | null,
    kind: BuiltEntry["kind"],
    reason: string,
    paired?: Column,
    originalOverride?: (number | null)[],
  ): BuiltEntry => {
    const original = originalOverride ?? column.byRow;
    const values =
      vt === null
        ? [...original]
        : vt.whole !== undefined
          ? vt.whole(original)
          : original.map((v, r) => (v == null ? null : vt.one(v, r, paired?.byRow[r] ?? null)));
    const excluded = original.filter((v, r) => v != null && values[r] == null).length;
    return { entry: { column: column.name, label, original, values, excluded }, kind, reason };
  };

  // The K each transformed column actually used, for the notes.
  const kUsed = new Map<string, number>();
  const noteK = (column: Column, f: TransformFunction): void => {
    if (!isKTransform(f)) return;
    const k = resolveK(column);
    if (k !== undefined) kUsed.set(column.set ?? column.name, k);
  };

  const entries: BuiltEntry[] = [];
  let usedZ = false;
  const noNBlank: string[] = [];
  for (const group of summaryGroups) {
    if ((group.error.kind === "sd" || group.error.kind === "cv") && group.n == null) noNBlank.push(group.key);
  }

  if (!interchange && summaryGroups.length > 0) {
    // Error-mode path: walk the columns in table order; each summary group
    // contributes its Mean entry (transformed), its error columns per the
    // mode, and its N column (a count, not an error bar — kept in every
    // mode). Plain columns transform as usual; the X column is the pairing
    // column, not Y data (it takes the X function, if one was asked for).
    for (const column of columns) {
      if (column === xCol) continue;
      if (!yCols.includes(column)) continue;
      const group = groupByMean.get(column.name);
      if (group) {
        const vt = yTransform(column);
        entries.push(
          buildEntry(column, vt === null ? "unchanged" : label, vt, vt === null ? "passthrough" : "data", EXCLUDED_REASON[fn]),
        );
        noteK(column, fn);
        if (errorMode === "to-ci") {
          // Each row's CI first, then transformed at both ends — so the
          // transformed interval is asymmetric.
          const lowers: (number | null)[] = [];
          const uppers: (number | null)[] = [];
          for (let r = 0; r < column.byRow.length; r++) {
            const b = ciBounds(group, r, column.byRow[r]);
            if (b.usedZ) usedZ = true;
            lowers.push(b.lower);
            uppers.push(b.upper);
          }
          const lowerCol: Column = { ...column, name: `${group.key}:Lower 95% CI` };
          const upperCol: Column = { ...column, name: `${group.key}:Upper 95% CI` };
          entries.push(buildEntry(lowerCol, label, vt, "ci", EXCLUDED_REASON[fn], xCol, lowers));
          entries.push(buildEntry(upperCol, label, vt, "ci", EXCLUDED_REASON[fn], xCol, uppers));
          if (group.n && group.n.values.length > 0)
            entries.push(buildEntry(group.n, "unchanged", null, "passthrough", ""));
        } else if (errorMode === "mean-only") {
          for (const ec of errorColumnsOf(group.error))
            if (ec.values.length > 0) entries.push(buildEntry(ec, "unchanged", null, "passthrough", ""));
          if (group.n && group.n.values.length > 0)
            entries.push(buildEntry(group.n, "unchanged", null, "passthrough", ""));
        } else {
          // erase: the error columns go away; N stays.
          if (group.n && group.n.values.length > 0)
            entries.push(buildEntry(group.n, "unchanged", null, "passthrough", ""));
        }
        continue;
      }
      if (summaryColumns.has(column.name)) continue; // An error/N column, handled with its group.
      const vtPlain = yTransform(column);
      entries.push(
        buildEntry(column, vtPlain === null ? "unchanged" : label, vtPlain, vtPlain === null ? "passthrough" : "data", EXCLUDED_REASON[fn], xCol),
      );
      noteK(column, fn);
    }
    if (effXFn !== undefined && xCol && xCol.values.length > 0) {
      entries.push(buildEntry(xCol, TRANSFORM_LABEL[effXFn], xTransform(xCol), "data", EXCLUDED_REASON[effXFn], yCols[0]));
      noteK(xCol, effXFn);
    } else if (fn === "hill-plot" && params?.xIsLog === true && xCol && xCol.values.length > 0) {
      // Entered as log(concentration): X passes through unchanged, so the
      // results still carry the X column to plot against.
      entries.push(buildEntry(xCol, "unchanged", null, "passthrough", ""));
    }
  } else if (interchange) {
    // Interchange: the old X column takes the Y function (paired with the
    // first old-Y column); each old-Y column takes the X function (paired
    // with the old X), or passes through unchanged without one.
    const firstY = yCols[0];
    if (xCol && xCol.values.length > 0) {
      const vtX = yTransform(xCol);
      entries.push(
        buildEntry(xCol, vtX === null ? "unchanged" : label, vtX, vtX === null ? "passthrough" : "data", EXCLUDED_REASON[fn], firstY),
      );
      noteK(xCol, fn);
    }
    for (const column of yCols) {
      if (effXFn === undefined) {
        entries.push(buildEntry(column, "unchanged", null, "passthrough", ""));
      } else {
        entries.push(buildEntry(column, TRANSFORM_LABEL[effXFn], xTransform(column), "data", EXCLUDED_REASON[effXFn], xCol));
        noteK(column, effXFn);
      }
    }
  } else {
    // Plain path: each Y column with the Y function, then one X entry (the
    // X function pairs against the first Y column when it needs a pair).
    for (const column of yCols) {
      const vt = yTransform(column);
      entries.push(
        buildEntry(column, vt === null ? "unchanged" : label, vt, vt === null ? "passthrough" : "data", EXCLUDED_REASON[fn], xCol),
      );
      noteK(column, fn);
    }
    if (effXFn !== undefined && xCol && xCol.values.length > 0) {
      entries.push(buildEntry(xCol, TRANSFORM_LABEL[effXFn], xTransform(xCol), "data", EXCLUDED_REASON[effXFn], yCols[0]));
      noteK(xCol, effXFn);
    } else if (fn === "hill-plot" && params?.xIsLog === true && xCol && xCol.values.length > 0) {
      // Entered as log(concentration): X passes through unchanged, so the
      // results still carry the X column to plot against.
      entries.push(buildEntry(xCol, "unchanged", null, "passthrough", ""));
    }
  }

  const transformed = entries.map((e) => e.entry);
  // Descriptives over the data entries only: a column with nothing
  // transformable has no group (R's mean of an empty vector is NaN, not a
  // number to show), and the notes say so instead.
  const withValues = entries
    .filter((e) => e.kind === "data")
    .map((e) => ({ name: `${e.entry.label}(${e.entry.column})`, values: e.entry.values.filter((v): v is number => v != null) }))
    .filter((g) => g.values.length > 0);
  const descriptives: GroupDescriptives[] = withValues.length ? (await describe(withValues)).groups : [];

  const stats = entries.flatMap((e) => {
    if (e.kind === "passthrough") return [];
    const rows = [{ label: `${e.entry.label}(${e.entry.column}) — N`, value: e.entry.values.filter((v) => v != null).length }];
    if (e.entry.excluded > 0)
      rows.push({ label: `${e.entry.label}(${e.entry.column}) — excluded`, value: e.entry.excluded });
    return rows;
  });

  // The K note: one K for every column reads as a single constant; a
  // per-data-set K lists each set's.
  let kNote = "";
  if (kUsed.size > 0) {
    if (params?.constants == null) {
      kNote = `Applied with the constant K = ${[...kUsed.values()][0]}.`;
    } else {
      kNote = `Applied with ${[...kUsed.entries()].map(([s, k]) => `K = ${k} for data set “${s}”`).join(", ")}.`;
    }
  }
  const errorModeNote =
    summaryGroups.length > 0
      ? errorMode === "mean-only"
        ? "Error bars were left unchanged (mean only)."
        : errorMode === "erase"
          ? "Error bars were erased."
          : "Error bars were converted to 95% confidence intervals before transforming, so the transformed intervals are asymmetric."
      : "";
  const notes = [
    "The source table is unchanged — these are the transformed values as a results sheet.",
    kNote,
    effXFn !== undefined ? `X values transformed with ${TRANSFORM_LABEL[effXFn]}.` : "",
    fn === "hill-plot" && params?.xIsLog === true && xCol
      ? "X values were entered as log(concentration), so they were left unchanged."
      : "",
    fn === "scatchard"
      ? "Scatchard: X becomes Y (bound) and Y becomes Y/X (bound/free) — a display-only re-plot, not a first step in analyzing the data."
      : "",
    interchange
      ? "X and Y interchanged before transforming: the Y function applies to the values that were in X, and the X function to the values that were in Y."
      : "",
    effXFn !== undefined && isCrossTransform(effXFn) && yCols[0]
      ? `The X function pairs each X value with the first Y column (“${yCols[0].name}”).`
      : "",
    fn === "eadie-hofstee"
      ? "Eadie-Hofstee: X becomes Y/X and Y is unchanged — a display-only re-plot, not a first step in analysis (fit the original data)."
      : "",
    fn === "y-plus-random" ? "Y+Random adds Gaussian noise (mean 0, SD = K) from a fixed seed, so repeating the run gives the same values." : "",
    fn === "user-defined" ? `Applied the user-defined transform: ${params!.formula!.trim()}.` : "",
    errorModeNote,
    usedZ ? "One or more groups have no N column, so their 95% CIs used z = 1.96 (the 95% normal value) instead of t." : "",
    noNBlank.length > 0 && errorMode === "to-ci"
      ? `${noNBlank.map((k) => `“${k}”`).join(", ")} ${noNBlank.length === 1 ? "has" : "have"} no N column, so ${noNBlank.length === 1 ? "its" : "their"} 95% CIs are blank.`
      : "",
    params?.errorMode !== undefined && summaryGroups.length === 0
      ? "No error bars in this table, so the error handling changes nothing."
      : "",
    ...entries.map((e) => {
      if (e.kind === "passthrough" || e.entry.excluded === 0) return "";
      if (e.entry.values.every((v) => v == null))
        return `“${e.entry.column}”: no value could be transformed (${e.reason}), so the column is blank.`;
      return `“${e.entry.column}”: ${e.entry.excluded} value${e.entry.excluded === 1 ? "" : "s"} left blank (${e.reason}).`;
    }),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    testType: "transform-data",
    subtitle: `Transform data — ${label}`,
    stats,
    groups: descriptives,
    notes,
    transformed,
  };
}
