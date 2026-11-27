// Calculated Variables (Prism 11 headline feature, seq 156): in-table
// formulas in Multiple Variables tables. Type `=` in an empty variable and
// the whole column becomes a live formula over the table's other variables —
// `=Dose * 2`, `=LOG10(Concentration)`, `=IF(Group = 1, A, B)` — recomputed
// whenever a source value changes, and usable in any MV analysis exactly
// like a typed variable, because the values are materialized into the
// table's rows (see `recomputeCalculated`).
//
// Conditional aggregation (seq 372, part A) IS built here: the *IF family
// (MINIF / MAXIF / SUMIF / MEANIF / STDEVIF / STDERRIF / COUNTIF /
// COUNTAIF) and the WHERE-clause form (`SUM(F) WHERE C <= 14`), verified
// against hand-computed values. Window functions (seq 372, part B) ARE
// built here too: OVER / WHERE / ORDER BY / ROWS on the windowable
// aggregates (MEAN, STDEV, STDERR, COUNT, COUNTA, single-variable
// MIN/MAX/SUM), the row-wise CENTER / STANDARDIZE / ZSCORE / RANK, and
// the conditional aggregates — verified against hand-computed values, since
// the window functions are Pro-gated and licence-blocked on this install
// and no real-Prism verification was possible.
// Descriptive aggregates over a whole variable (MEAN(A), SUM(A)…) ARE in:
// they are the 11.0 core's whole-variable arithmetic, broadcast as one
// value per row.
//
// Semantics, kept spreadsheet-plain: a missing source value makes that
// row's result blank (a value that has no formula result is blank, as a
// transform's is); division by zero and domain errors (SQRT of a negative,
// LOG of zero or less) blank that row, not the variable; a formula that
// cannot run at all (unknown variable, circular reference, syntax error)
// blanks the whole variable and records its `error`, shown in the table's
// Calculated Variables panel. Formulas are stored WITHOUT the leading `=`
// (`formula: "A + B"`); the grid and the panel display them with it.
import { readTable } from "./dataset";
import { qnorm } from "./normal";
import { parseCell } from "./numeric";
import { maxOf, mean, median, minOf, sd, sem } from "./summary";
import type { CalculatedVariable, TableData } from "../store/types";
import type { CellBackgroundColor } from "./cell-colors";

/** One calculated variable: its column's name and its formula (without `=`).
 *  `error` is recomputed, never trusted from a file: a formula that cannot
 *  run records why here, and its values stay blank. */
export type { CalculatedVariable } from "../store/types";

/** A value as a cell holds it: 10 significant digits, readable and far finer
 *  than any test needs (the transform's rule, lib/transform.ts). */
const cell = (v: number | null) => (v == null || !Number.isFinite(v) ? null : String(Number(v.toPrecision(10))));

// ── Tokenizer ──────────────────────────────────────────────────────────

type Token =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; name: string }
  | { kind: "bracket"; name: string }
  | { kind: "op"; op: string }
  | { kind: "lparen" }
  | { kind: "rparen" }
  | { kind: "comma" };

const OPERATORS = ["<>", "!=", "<=", ">=", "==", "+", "-", "*", "/", "%", "^", "=", "<", ">"];

/** Splits a formula into tokens, or names why it cannot be read. */
function tokenize(input: string): { tokens: Token[] } | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "[") {
      const close = input.indexOf("]", i + 1);
      if (close < 0) return { error: `“${input}” has a “[” with no closing “]”.` };
      const name = input.slice(i + 1, close);
      if (!name.trim()) return { error: `“${input}” has an empty “[ ]” variable name.` };
      tokens.push({ kind: "bracket", name });
      i = close + 1;
      continue;
    }
    // Text in double quotes — only CONCATENATE reads it (the numeric
    // engine cannot hold text, so a string anywhere else is a validation
    // error, not a silent blank). `""` inside is one `"`, the Excel rule.
    if (ch === '"') {
      let value = "";
      let j = i + 1;
      let closed = false;
      while (j < input.length) {
        if (input[j] === '"') {
          if (input[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += input[j];
        j++;
      }
      if (!closed) return { error: `“${input}” has text in quotes with no closing “"”.` };
      tokens.push({ kind: "str", value });
      i = j;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(input.slice(i));
      if (!m || m[0] === ".")
        return { error: `“${input}” has a number that cannot be read near “${input.slice(i, i + 8)}”.` };
      tokens.push({ kind: "num", value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ kind: "ident", name: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma" });
      i++;
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: "op", op });
      i += op.length;
      continue;
    }
    return { error: `“${input}” has a character that cannot be read: “${ch}”.` };
  }
  return { tokens };
}

// ── Parser (recursive descent) ─────────────────────────────────────────

export type Expr =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "-" | "NOT"; expr: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] }
  /** A conditional aggregate (seq 372, part A): `name` over the rows where
   *  `condition` holds, broadcast as one value per row. PERCENTILE carries
   *  its `k` here too (the WHERE form: `PERCENTILE(F, 90) WHERE C <= 14`). */
  | { kind: "condagg"; name: string; variable: string; condition: Expr; k?: Expr }
  /** A window function (seq 372, part B): `name` over a window of rows —
   *  the partition group, optionally filtered (WHERE / the *IF condition),
   *  ordered, and framed. `name` is the normalized aggregate (STDEV →
   *  SD, STDERR → SEM) or a row-wise function (CENTER / STANDARDIZE /
   *  ZSCORE / RANK); for a conditional aggregate it is the base aggregate
   *  (SUMIF → SUM) with `condition` set. With no clauses the window is
   *  the whole variable. */
  | {
      kind: "window";
      name: string;
      variable: string;
      condition?: Expr;
      partition?: Expr;
      orderBy?: { expr: Expr; desc: boolean }[];
      frame?: { start: FrameBound; end: FrameBound };
    };

/** One end of a ROWS frame, as the docs spell it. */
type FrameBound =
  | { kind: "unbounded-preceding" }
  | { kind: "n-preceding"; n: number }
  | { kind: "current" }
  | { kind: "n-following"; n: number }
  | { kind: "unbounded-following" };

/** The elementwise functions: name → argument counts it takes. The seq 156
 *  remainder adds the rest of Prism's library: LOGIT / PROBIT (the
 *  transform pair), ATAN2 (ARCTAN2 is its other spelling, normalized in the
 *  parser), the integer functions FACT / INT / MOD / TRUNC, POWER (`^` as
 *  a function), AND / OR as functions (three-valued, like the operators),
 *  IS_DEFINED (1 where a value exists, 0 where it is blank — text counts),
 *  and the random pair RAND / RANDBETWEEN (seeded per variable, so a
 *  column does not reshuffle on every recompute). CONCATENATE and
 *  PERCENTILE are not here: CONCATENATE returns text, so the numeric
 *  evaluator cannot hold it, and PERCENTILE takes a variable plus its k. */
const ELEMENTWISE: Record<string, number[]> = {
  ABS: [1],
  SQRT: [1],
  EXP: [1],
  LN: [1],
  LOG: [1],
  LOG10: [1],
  LOG2: [1],
  SIN: [1],
  COS: [1],
  TAN: [1],
  ASIN: [1],
  ACOS: [1],
  ATAN: [1],
  ATAN2: [2],
  FLOOR: [1],
  CEIL: [1],
  SIGN: [1],
  ROUND: [1, 2],
  IF: [3],
  MIN: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  MAX: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  LOGIT: [1],
  PROBIT: [1],
  FACT: [1],
  INT: [1],
  MOD: [2],
  TRUNC: [1, 2],
  POWER: [2],
  AND: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  OR: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  IS_DEFINED: [1],
  RAND: [0],
  RANDBETWEEN: [2],
};
/** The whole-variable aggregates: one variable argument, broadcast as one
 *  value per row. MIN and MAX are both: one argument aggregates, two or more
 *  compare row by row. COUNTA counts the non-blank values, text included —
 *  unlike COUNT, which counts numeric values only. */
const AGGREGATES = ["MEAN", "SUM", "COUNT", "MEDIAN", "SD", "SEM", "VAR", "MIN", "MAX", "COUNTA"];
/** The conditional aggregates (seq 372, part A): name → the aggregate they
 *  filter. Two arguments: the variable to aggregate, and the condition —
 *  the comparison/AND/OR/NOT language, evaluated row by row. */
const CONDITIONAL_AGGREGATES: Record<string, string> = {
  MINIF: "MIN",
  MAXIF: "MAX",
  SUMIF: "SUM",
  MEANIF: "MEAN",
  STDEVIF: "SD",
  STDERRIF: "SEM",
  COUNTIF: "COUNT",
  COUNTAIF: "COUNTA",
};
const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

/** Prism's spellings of the sample SD / SEM, as the windowable names, and
 *  AVERAGE as MEAN under its other name. */
const normalizeAggregate = (name: string): string =>
  name === "STDEV" ? "SD" : name === "STDERR" ? "SEM" : name === "AVERAGE" ? "MEAN" : name;
/** A function name the parser reads as another: ARCTAN2 is ATAN2, CEILING
 *  is CEIL. The typed spelling survives in error messages; the canonical
 *  name is what the evaluator sees. */
const normalizeFunction = (name: string): string =>
  name === "ARCTAN2" ? "ATAN2" : name === "CEILING" ? "CEIL" : name;
/** The aggregates that take window clauses (the docs' list — MEDIAN and
 *  VAR are whole-variable only, and take no OVER / ORDER BY / ROWS). */
const WINDOWABLE_AGGREGATES = ["MEAN", "SD", "SEM", "COUNT", "COUNTA", "MIN", "MAX", "SUM"];
/** The row-wise window functions: one value per row, relative to its
 *  window. They are window nodes with or without clauses — with no
 *  clauses the window is the whole variable. */
const ROW_WISE = ["CENTER", "STANDARDIZE", "ZSCORE", "RANK"];
/** A clause keyword, as the parser sees it after a call's closing paren. */
const WINDOW_KEYWORDS = ["OVER", "WHERE", "ORDER", "ROWS"];

/** One function in the formula language, as the Inspector's function
 *  browser shows it: the name to type, its syntax, one line saying what
 *  it does, and a runnable example (a variable name stands in for a
 *  column — `A`, `B`, `F`). The browser renders this list, so the panel
 *  can never drift from the engine: every function the engine runs is
 *  here, and every entry's example parses (the checks pin both). */
export type CalcFunctionGroup = "Math" | "Trigonometry" | "Statistics" | "Logic" | "Text" | "Random" | "Window";
export interface CalcFunctionDoc {
  name: string;
  syntax: string;
  description: string;
  group: CalcFunctionGroup;
  example: string;
}
export const CALC_FUNCTION_REFERENCE: CalcFunctionDoc[] = [
  { name: "ABS", syntax: "ABS(x)", description: "Absolute value of x.", group: "Math", example: "ABS(A - B)" },
  { name: "SQRT", syntax: "SQRT(x)", description: "Square root of x; blank for a negative x.", group: "Math", example: "SQRT(A)" },
  { name: "EXP", syntax: "EXP(x)", description: "e raised to x.", group: "Math", example: "EXP(A)" },
  { name: "LN", syntax: "LN(x)", description: "Natural logarithm of x; blank for x ≤ 0.", group: "Math", example: "LN(A)" },
  { name: "LOG", syntax: "LOG(x)", description: "Base-10 logarithm of x; blank for x ≤ 0.", group: "Math", example: "LOG(A)" },
  { name: "LOG10", syntax: "LOG10(x)", description: "Base-10 logarithm of x; blank for x ≤ 0.", group: "Math", example: "LOG10(A)" },
  { name: "LOG2", syntax: "LOG2(x)", description: "Base-2 logarithm of x; blank for x ≤ 0.", group: "Math", example: "LOG2(A)" },
  { name: "LOGIT", syntax: "LOGIT(p)", description: "Log odds, ln(p / (1 − p)); blank unless 0 < p < 1.", group: "Math", example: "LOGIT(A)" },
  { name: "PROBIT", syntax: "PROBIT(p)", description: "Standard-normal quantile (R's qnorm); blank unless 0 < p < 1.", group: "Math", example: "PROBIT(A)" },
  { name: "FACT", syntax: "FACT(n)", description: "Factorial of a whole number n (0–170); blank otherwise.", group: "Math", example: "FACT(A)" },
  { name: "INT", syntax: "INT(x)", description: "x truncated toward zero (INT(−2.7) is −2, not −3).", group: "Math", example: "INT(A)" },
  { name: "MOD", syntax: "MOD(a, b)", description: "Remainder of a / b, taking the divisor's sign (Excel's rule).", group: "Math", example: "MOD(A, B)" },
  { name: "TRUNC", syntax: "TRUNC(x [, digits])", description: "x with digits dropped, not rounded; digits may be negative.", group: "Math", example: "TRUNC(A, 1)" },
  { name: "POWER", syntax: "POWER(a, b)", description: "a raised to b — the `^` operator as a function.", group: "Math", example: "POWER(A, 2)" },
  { name: "ROUND", syntax: "ROUND(x [, digits])", description: "x rounded to digits decimal places (0 when omitted).", group: "Math", example: "ROUND(A, 1)" },
  { name: "FLOOR", syntax: "FLOOR(x)", description: "Largest whole number ≤ x.", group: "Math", example: "FLOOR(A)" },
  { name: "CEIL", syntax: "CEIL(x)", description: "Smallest whole number ≥ x.", group: "Math", example: "CEIL(A)" },
  { name: "CEILING", syntax: "CEILING(x)", description: "Smallest whole number ≥ x — CEIL under its other name.", group: "Math", example: "CEILING(A)" },
  { name: "SIGN", syntax: "SIGN(x)", description: "−1, 0, or 1, by x's sign.", group: "Math", example: "SIGN(A - B)" },
  { name: "SIN", syntax: "SIN(x)", description: "Sine of x (radians).", group: "Trigonometry", example: "SIN(A)" },
  { name: "COS", syntax: "COS(x)", description: "Cosine of x (radians).", group: "Trigonometry", example: "COS(A)" },
  { name: "TAN", syntax: "TAN(x)", description: "Tangent of x (radians).", group: "Trigonometry", example: "TAN(A)" },
  { name: "ASIN", syntax: "ASIN(x)", description: "Arcsine of x; blank outside [−1, 1].", group: "Trigonometry", example: "ASIN(A)" },
  { name: "ACOS", syntax: "ACOS(x)", description: "Arccosine of x; blank outside [−1, 1].", group: "Trigonometry", example: "ACOS(A)" },
  { name: "ATAN", syntax: "ATAN(x)", description: "Arctangent of x.", group: "Trigonometry", example: "ATAN(A)" },
  { name: "ATAN2", syntax: "ATAN2(x, y)", description: "Angle whose tangent is y / x (Excel order: x first, y second).", group: "Trigonometry", example: "ATAN2(A, B)" },
  { name: "ARCTAN2", syntax: "ARCTAN2(x, y)", description: "Angle whose tangent is y / x — ATAN2 under Prism's other spelling.", group: "Trigonometry", example: "ARCTAN2(A, B)" },
  { name: "MEAN", syntax: "MEAN(A)", description: "Mean of a whole variable, broadcast to every row.", group: "Statistics", example: "MEAN(A)" },
  { name: "AVERAGE", syntax: "AVERAGE(A)", description: "Mean of a whole variable — MEAN under its other name.", group: "Statistics", example: "AVERAGE(A)" },
  { name: "SUM", syntax: "SUM(A)", description: "Sum of a whole variable, broadcast to every row.", group: "Statistics", example: "SUM(A)" },
  { name: "COUNT", syntax: "COUNT(A)", description: "Count of numeric values in a variable; only on rows with a value.", group: "Statistics", example: "COUNT(A)" },
  { name: "COUNTA", syntax: "COUNTA(A)", description: "Count of non-blank values in a variable, text included.", group: "Statistics", example: "COUNTA(A)" },
  { name: "MEDIAN", syntax: "MEDIAN(A)", description: "Median of a whole variable, broadcast to every row.", group: "Statistics", example: "MEDIAN(A)" },
  { name: "SD", syntax: "SD(A)", description: "Sample standard deviation of a whole variable.", group: "Statistics", example: "SD(A)" },
  { name: "STDEV", syntax: "STDEV(A)", description: "Sample standard deviation — SD under Prism's spelling.", group: "Statistics", example: "STDEV(A)" },
  { name: "SEM", syntax: "SEM(A)", description: "Standard error of the mean of a whole variable.", group: "Statistics", example: "SEM(A)" },
  { name: "STDERR", syntax: "STDERR(A)", description: "Standard error of the mean — SEM under Prism's spelling.", group: "Statistics", example: "STDERR(A)" },
  { name: "VAR", syntax: "VAR(A)", description: "Sample variance of a whole variable.", group: "Statistics", example: "VAR(A)" },
  { name: "MIN", syntax: "MIN(A) / MIN(a, b, …)", description: "Smallest value: one variable aggregates, two or more compare row by row.", group: "Statistics", example: "MIN(A, B)" },
  { name: "MAX", syntax: "MAX(A) / MAX(a, b, …)", description: "Largest value: one variable aggregates, two or more compare row by row.", group: "Statistics", example: "MAX(A, B)" },
  { name: "PERCENTILE", syntax: "PERCENTILE(A, k)", description: "Type-7 percentile of a variable (R's default); k is 0–100.", group: "Statistics", example: "PERCENTILE(A, 90)" },
  { name: "PERC", syntax: "PERC(A, k)", description: "Type-7 percentile of a variable — PERCENTILE's short name.", group: "Statistics", example: "PERC(A, 50)" },
  { name: "SUMIF", syntax: "SUMIF(A, condition)", description: "Sum of A over the rows where the condition holds.", group: "Statistics", example: "SUMIF(A, B > 0)" },
  { name: "MEANIF", syntax: "MEANIF(A, condition)", description: "Mean of A over the rows where the condition holds.", group: "Statistics", example: "MEANIF(A, B > 0)" },
  { name: "COUNTIF", syntax: "COUNTIF(A, condition)", description: "Count of numeric values in A over the matching rows.", group: "Statistics", example: "COUNTIF(A, B > 0)" },
  { name: "COUNTAIF", syntax: "COUNTAIF(A, condition)", description: "Count of non-blank values in A over the matching rows.", group: "Statistics", example: "COUNTAIF(A, B > 0)" },
  { name: "MINIF", syntax: "MINIF(A, condition)", description: "Smallest value of A over the rows where the condition holds.", group: "Statistics", example: "MINIF(A, B > 0)" },
  { name: "MAXIF", syntax: "MAXIF(A, condition)", description: "Largest value of A over the rows where the condition holds.", group: "Statistics", example: "MAXIF(A, B > 0)" },
  { name: "STDEVIF", syntax: "STDEVIF(A, condition)", description: "Sample SD of A over the rows where the condition holds.", group: "Statistics", example: "STDEVIF(A, B > 0)" },
  { name: "STDERRIF", syntax: "STDERRIF(A, condition)", description: "SEM of A over the rows where the condition holds.", group: "Statistics", example: "STDERRIF(A, B > 0)" },
  { name: "IF", syntax: "IF(condition, then, else)", description: "then when the condition holds, else when it does not.", group: "Logic", example: "IF(A > 0, 1, 0)" },
  { name: "AND", syntax: "AND(a, b, …)", description: "1 when every value holds, 0 when any does not; blank only when nothing decides it.", group: "Logic", example: "AND(A > 0, B > 0)" },
  { name: "OR", syntax: "OR(a, b, …)", description: "1 when any value holds, 0 when none does; blank only when nothing decides it.", group: "Logic", example: "OR(A > 0, B > 0)" },
  { name: "IS_DEFINED", syntax: "IS_DEFINED(x)", description: "1 where x has a value, 0 where it is blank — a text cell counts.", group: "Logic", example: "IS_DEFINED(A)" },
  { name: "CONCATENATE", syntax: "CONCATENATE(a, b, …)", description: "Joins cell text into one value; only as the whole formula. Text in quotes goes here.", group: "Text", example: "CONCATENATE(A, \" \", B)" },
  { name: "RAND", syntax: "RAND()", description: "Uniform random number on [0, 1); stable per variable, so the column survives recompute.", group: "Random", example: "RAND()" },
  { name: "RANDBETWEEN", syntax: "RANDBETWEEN(low, high)", description: "Whole random number between low and high, inclusive; stable per variable.", group: "Random", example: "RANDBETWEEN(1, 6)" },
  { name: "CENTER", syntax: "CENTER(A)", description: "Each value minus its window's mean — a window function.", group: "Window", example: "CENTER(A) OVER B" },
  { name: "STANDARDIZE", syntax: "STANDARDIZE(A)", description: "Each value's z-score in its window — a window function.", group: "Window", example: "STANDARDIZE(A) OVER B" },
  { name: "ZSCORE", syntax: "ZSCORE(A)", description: "Each value's z-score — STANDARDIZE under its other name.", group: "Window", example: "ZSCORE(A) OVER B" },
  { name: "RANK", syntax: "RANK(A)", description: "Each value's rank in its window (ascending, ties averaged).", group: "Window", example: "RANK(A) OVER B" },
  { name: "OVER", syntax: "F(A) OVER group", description: "Window clause: split rows into groups by group before applying F.", group: "Window", example: "MEAN(A) OVER B" },
  { name: "WHERE", syntax: "F(A) WHERE condition", description: "Window clause: only the matching rows contribute to F.", group: "Window", example: "SUM(A) WHERE B > 0" },
  { name: "ORDER BY", syntax: "F(A) ORDER BY x", description: "Window clause: order each group by x before applying F.", group: "Window", example: "MEAN(A) ORDER BY B" },
  { name: "ROWS", syntax: "F(A) ROWS n PRECEDING", description: "Window clause: only the n rows before each row (and the row itself) contribute.", group: "Window", example: "MEAN(A) ROWS 2 PRECEDING" },
];

/** Every function name the engine runs, aliases included — the checks pin
 *  the browser's reference against this list, so a function added to the
 *  engine without a browser entry (or the reverse) fails loudly. */
export const CALC_FUNCTION_NAMES: string[] = [
  ...new Set([
    ...Object.keys(ELEMENTWISE),
    ...AGGREGATES,
    ...Object.keys(CONDITIONAL_AGGREGATES),
    ...ROW_WISE,
    "STDEV",
    "STDERR",
    "AVERAGE",
    "ARCTAN2",
    "CEILING",
    "PERCENTILE",
    "PERC",
    "CONCATENATE",
    "OVER",
    "WHERE",
    "ORDER BY",
    "ROWS",
  ]),
];

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.or();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos];
      throw new Error(`unexpected ${t.kind === "op" ? `“${t.op}”` : t.kind} after the formula ends.`);
    }
    return expr;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(op: string): boolean {
    const t = this.peek();
    if (t?.kind === "op" && t.op.toUpperCase() === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private eatIdent(name: string): boolean {
    const t = this.peek();
    if (t?.kind === "ident" && t.name.toUpperCase() === name) {
      this.pos++;
      return true;
    }
    return false;
  }

  private or(): Expr {
    let left = this.and();
    while (this.eatIdent("OR")) left = { kind: "binary", op: "OR", left, right: this.and() };
    return left;
  }

  private and(): Expr {
    let left = this.not();
    while (this.eatIdent("AND")) left = { kind: "binary", op: "AND", left, right: this.not() };
    return left;
  }

  /** NOT binds looser than a comparison but tighter than AND / OR: `NOT
   *  C <= 14` is `NOT (C <= 14)`, not `(NOT C) <= 14` — the latter is
   *  true for every non-zero C and silently includes rows a filter must
   *  exclude (bug-report issue 21). */
  private not(): Expr {
    if (this.eatIdent("NOT")) return { kind: "unary", op: "NOT", expr: this.not() };
    return this.cmp();
  }

  private cmp(): Expr {
    const left = this.add();
    const t = this.peek();
    if (t?.kind === "op" && ["=", "==", "<>", "!=", "<", "<=", ">", ">="].includes(t.op)) {
      this.pos++;
      return { kind: "binary", op: t.op, left, right: this.add() };
    }
    return left;
  }

  private add(): Expr {
    let left = this.mul();
    for (;;) {
      if (this.eatOp("+")) left = { kind: "binary", op: "+", left, right: this.mul() };
      else if (this.eatOp("-")) left = { kind: "binary", op: "-", left, right: this.mul() };
      else return left;
    }
  }

  private mul(): Expr {
    let left = this.pow();
    for (;;) {
      if (this.eatOp("*")) left = { kind: "binary", op: "*", left, right: this.pow() };
      else if (this.eatOp("/")) left = { kind: "binary", op: "/", left, right: this.pow() };
      else if (this.eatOp("%")) left = { kind: "binary", op: "%", left, right: this.pow() };
      else return left;
    }
  }

  private pow(): Expr {
    const base = this.unary();
    if (this.eatOp("^")) return { kind: "binary", op: "^", left: base, right: this.pow() };
    return base;
  }

  private unary(): Expr {
    if (this.eatOp("-")) return { kind: "unary", op: "-", expr: this.unary() };
    return this.primary();
  }

  private primary(): Expr {
    const t = this.peek();
    if (!t) throw new Error("the formula ends before a value.");
    if (t.kind === "num") {
      this.pos++;
      return { kind: "num", value: t.value };
    }
    if (t.kind === "str") {
      this.pos++;
      return { kind: "str", value: t.value };
    }
    if (t.kind === "bracket") {
      this.pos++;
      return { kind: "var", name: t.name };
    }
    if (t.kind === "lparen") {
      this.pos++;
      const expr = this.or();
      const close = this.peek();
      if (close?.kind !== "rparen") throw new Error("a “(” has no closing “)”.");
      this.pos++;
      return expr;
    }
    if (t.kind === "ident") {
      this.pos++;
      const upper = t.name.toUpperCase();
      if (CONSTANTS[upper] !== undefined && this.peek()?.kind !== "lparen") {
        return { kind: "num", value: CONSTANTS[upper] };
      }
      if (this.peek()?.kind === "lparen") {
        this.pos++;
        const args: Expr[] = [];
        if (this.peek()?.kind !== "rparen") {
          for (;;) {
            args.push(this.or());
            if (this.peek()?.kind === "comma") {
              this.pos++;
              continue;
            }
            break;
          }
        }
        const close = this.peek();
        if (close?.kind !== "rparen") throw new Error(`“${t.name}” has arguments with no closing “)”.`);
        this.pos++;
        // A window clause follows the call: OVER / WHERE / ORDER BY / ROWS
        // (seq 372, part B). The clause parser owns the WHERE-only form
        // too, so part A's `SUM(F) WHERE C <= 14` still lands as condagg.
        const next = this.peek();
        if (next?.kind === "ident" && WINDOW_KEYWORDS.includes(next.name.toUpperCase())) {
          return this.parseWindowedCall(upper, args, t.name);
        }
        // A row-wise window function with no clauses: the window is the
        // whole variable (`ZSCORE(E)` is the whole-column z-score).
        if (ROW_WISE.includes(upper)) {
          if (args.length !== 1 || args[0].kind !== "var")
            throw new Error(`“${t.name}” takes one variable, e.g. “${upper}(E)”.`);
          return { kind: "window", name: upper, variable: args[0].name };
        }
        const aggName = normalizeAggregate(upper);
        if (AGGREGATES.includes(aggName) && args.length === 1) {
          return { kind: "call", name: aggName, args };
        }
        // PERCENTILE takes a variable and its k (PERC is its short name).
        // It is an aggregate — whole-variable, broadcast — so it reads
        // through the call path with its k beside it, and the WHERE form
        // goes through the window-clause parser like any other aggregate.
        if (upper === "PERCENTILE" || upper === "PERC") {
          if (args.length !== 2)
            throw new Error(
              `“${t.name}” takes 2 arguments — a variable and a percentile, e.g. “${upper}(A, 90)”.`,
            );
          if (args[0].kind !== "var")
            throw new Error(`“${t.name}” takes a variable and a percentile — write “${upper}(A, 90)”.`);
          return { kind: "call", name: "PERCENTILE", args };
        }
        // CONCATENATE returns text, so it is a call node the numeric
        // evaluator cannot hold — the table integration evaluates it as
        // text, and validation keeps it out of arithmetic (see
        // `textMisuse`). One or more arguments; a blank one contributes
        // nothing.
        if (upper === "CONCATENATE") {
          if (args.length < 1)
            throw new Error(`“${t.name}” takes at least one value, e.g. “CONCATENATE(First, Last)”.`);
          return { kind: "call", name: "CONCATENATE", args };
        }
        const condBase = CONDITIONAL_AGGREGATES[upper];
        if (condBase) {
          if (args.length !== 2)
            throw new Error(
              `“${t.name}” takes 2 arguments — a variable and a condition, e.g. “${upper}(F, C <= 14)”.`,
            );
          if (args[0].kind !== "var")
            throw new Error(`“${t.name}” takes a variable and a condition — write “${upper}(F, C <= 14)”.`);
          return { kind: "condagg", name: condBase, variable: args[0].name, condition: args[1] };
        }
        const allowed = ELEMENTWISE[normalizeFunction(upper)];
        if (!allowed) {
          if (AGGREGATES.includes(aggName))
            throw new Error(
              `“${t.name}” takes one variable, not ${args.length} argument${args.length === 1 ? "" : "s"}.`,
            );
          throw new Error(`there is no function “${t.name}”.`);
        }
        if (!allowed.includes(args.length))
          throw new Error(
            `“${t.name}” takes ${allowed.join(" or ")} argument${allowed.length > 1 ? "s" : ""}, not ${args.length}.`,
          );
        return { kind: "call", name: normalizeFunction(upper), args };
      }
      if (["AND", "OR", "NOT"].includes(upper))
        throw new Error(`“${t.name}” needs values around it — write “A ${upper} B”, not “${t.name}” on its own.`);
      return { kind: "var", name: t.name };
    }
    throw new Error(`unexpected ${t.kind === "op" ? `“${t.op}”` : t.kind} where a value was expected.`);
  }

  /** Parses a window function's clauses after its call's closing paren.
   *  Clause order is OVER → WHERE → ORDER BY → ROWS; every clause is
   *  optional. A clause expression reads greedily — `MEAN(E) OVER B * 100`
   *  groups by `B * 100`, as the docs warn — so a window function inside
   *  a larger formula needs parentheses around it. */
  private parseWindowedCall(upper: string, args: Expr[], typedName: string): Expr {
    const aggName = normalizeAggregate(upper);
    const condBase = CONDITIONAL_AGGREGATES[upper];
    const rowWise = ROW_WISE.includes(upper);
    const isPlainAgg = AGGREGATES.includes(aggName);
    // PERCENTILE is an aggregate for the WHERE-only form (`PERCENTILE(F, 90)
    // WHERE C <= 14` is a conditional aggregate, like MEDIAN and VAR) but
    // takes no OVER / ORDER BY / ROWS — the final guard below says so.
    const isPercentile = upper === "PERCENTILE" || upper === "PERC";
    if (!condBase && !rowWise && !isPlainAgg && !isPercentile) {
      throw new Error(
        `“${typedName}” cannot take window clauses — window functions are MEAN, STDEV, STDERR, COUNT, ` +
          `COUNTA, MIN, MAX, SUM, CENTER, STANDARDIZE, ZSCORE, RANK, and the conditional aggregates.`,
      );
    }
    if (condBase) {
      if (args.length !== 2)
        throw new Error(
          `“${typedName}” takes 2 arguments — a variable and a condition, e.g. “${upper}(F, C <= 14)”.`,
        );
      if (args[0].kind !== "var")
        throw new Error(`“${typedName}” takes a variable and a condition — write “${upper}(F, C <= 14)”.`);
    } else if (isPercentile) {
      if (args.length !== 2)
        throw new Error(
          `“${typedName}” takes 2 arguments — a variable and a percentile, e.g. “${upper}(A, 90)”.`,
        );
      if (args[0].kind !== "var")
        throw new Error(`“${typedName}” takes a variable and a percentile — write “${upper}(A, 90)”.`);
    } else if (args.length !== 1) {
      throw new Error(
        `“${typedName}” takes one variable, not ${args.length} argument${args.length === 1 ? "" : "s"}.`,
      );
    } else if (args[0].kind !== "var") {
      throw new Error(`“${typedName}” takes a variable — write “${upper}(F)”, not “${upper}(…)”.`);
    }
    let partition: Expr | undefined;
    let condition: Expr | undefined = condBase ? args[1] : undefined;
    let orderBy: { expr: Expr; desc: boolean }[] | undefined;
    let frame: { start: FrameBound; end: FrameBound } | undefined;
    if (this.eatIdent("OVER")) partition = this.or();
    if (this.eatIdent("WHERE")) {
      if (condition !== undefined)
        throw new Error(
          `“${typedName}” already has a condition — write the filter once, either as “${upper}(F, C <= 14)” ` +
            `or as “${upper}(F) WHERE C <= 14”.`,
        );
      condition = this.or();
    }
    if (this.eatIdent("ORDER")) {
      if (!this.eatIdent("BY")) throw new Error(`“ORDER” needs “BY” — write “ORDER BY C”.`);
      orderBy = [];
      for (;;) {
        const expr = this.or();
        let desc = false;
        if (this.eatIdent("DESC")) desc = true;
        else this.eatIdent("ASC");
        orderBy.push({ expr, desc });
        if (this.peek()?.kind === "comma") {
          this.pos++;
          continue;
        }
        break;
      }
    }
    if (this.eatIdent("ROWS")) frame = this.parseFrame();
    const next = this.peek();
    if (next?.kind === "ident" && WINDOW_KEYWORDS.includes(next.name.toUpperCase())) {
      throw new Error("window clauses must appear in the order OVER, WHERE, ORDER BY, ROWS.");
    }
    const variable = (args[0] as { kind: "var"; name: string }).name;
    // A WHERE on its own, on a plain aggregate, keeps part A's condagg
    // shape — including MEDIAN and VAR, which take no window clauses, and
    // PERCENTILE, which carries its k beside the condition.
    if (!partition && !orderBy && !frame && condition !== undefined && !condBase && !rowWise) {
      return {
        kind: "condagg",
        name: isPercentile ? "PERCENTILE" : aggName,
        variable,
        condition,
        ...(isPercentile ? { k: args[1] } : {}),
      };
    }
    if (!condBase && !rowWise && !WINDOWABLE_AGGREGATES.includes(aggName)) {
      throw new Error(
        `“${typedName}” cannot take window clauses — use MEAN, STDEV, STDERR, COUNT, COUNTA, MIN, MAX, ` +
          `or SUM for windowed calculations.`,
      );
    }
    return {
      kind: "window",
      name: rowWise ? upper : (condBase ?? aggName),
      variable,
      ...(condition !== undefined ? { condition } : {}),
      ...(partition !== undefined ? { partition } : {}),
      ...(orderBy !== undefined ? { orderBy } : {}),
      ...(frame !== undefined ? { frame } : {}),
    };
  }

  /** Parses a ROWS frame: one or two boundaries. A single boundary
   *  defaults the other side to the current row. */
  private parseFrame(): { start: FrameBound; end: FrameBound } {
    const bound = (): FrameBound => {
      if (this.eatIdent("UNBOUNDED")) {
        if (this.eatIdent("PRECEDING")) return { kind: "unbounded-preceding" };
        if (this.eatIdent("FOLLOWING")) return { kind: "unbounded-following" };
        throw new Error(`“UNBOUNDED” needs “PRECEDING” or “FOLLOWING” — write “ROWS UNBOUNDED PRECEDING”.`);
      }
      if (this.eatIdent("CURRENT")) {
        if (!this.eatIdent("ROW")) throw new Error(`“CURRENT” needs “ROW” — write “ROWS CURRENT ROW”.`);
        return { kind: "current" };
      }
      const t = this.peek();
      if (t?.kind === "num") {
        this.pos++;
        if (!Number.isInteger(t.value) || t.value < 0)
          throw new Error(`a ROWS boundary takes a whole number of rows — write “ROWS 1 PRECEDING”.`);
        if (this.eatIdent("PRECEDING")) return { kind: "n-preceding", n: t.value };
        if (this.eatIdent("FOLLOWING")) return { kind: "n-following", n: t.value };
        throw new Error(`a ROWS boundary needs “PRECEDING” or “FOLLOWING” — write “ROWS 1 PRECEDING”.`);
      }
      throw new Error(
        `a ROWS boundary takes “UNBOUNDED PRECEDING”, “N PRECEDING”, “CURRENT ROW”, or a FOLLOWING form — ` +
          `write “ROWS UNBOUNDED PRECEDING”.`,
      );
    };
    const first = bound();
    const next = this.peek();
    const secondFollows =
      (next?.kind === "ident" && ["UNBOUNDED", "CURRENT"].includes(next.name.toUpperCase())) ||
      next?.kind === "num";
    if (!secondFollows) {
      if (first.kind === "unbounded-preceding" || first.kind === "n-preceding" || first.kind === "current")
        return { start: first, end: { kind: "current" } };
      return { start: { kind: "current" }, end: first };
    }
    return { start: first, end: bound() };
  }
}

/** Parses a formula (without its leading `=`) into an expression, or names
 *  why it cannot be read. */
export function parseFormula(formula: string): { ast: Expr } | { error: string } {
  const text = formula.trim();
  if (!text) return { error: "the formula is empty — write values and variable names after the “=”." };
  const tokenized = tokenize(text);
  if ("error" in tokenized) return { error: tokenized.error };
  try {
    return { ast: new Parser(tokenized.tokens).parse() };
  } catch (e) {
    return { error: `“${text}” could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** The variable names a parsed formula reads, in order, duplicates kept out. */
export function dependenciesOf(ast: Expr): string[] {
  const found: string[] = [];
  const walk = (e: Expr): void => {
    if (e.kind === "var") {
      if (!found.includes(e.name)) found.push(e.name);
    } else if (e.kind === "unary") walk(e.expr);
    else if (e.kind === "binary") {
      walk(e.left);
      walk(e.right);
    } else if (e.kind === "condagg") {
      if (!found.includes(e.variable)) found.push(e.variable);
      walk(e.condition);
      if (e.k) walk(e.k);
    } else if (e.kind === "window") {
      if (!found.includes(e.variable)) found.push(e.variable);
      if (e.condition) walk(e.condition);
      if (e.partition) walk(e.partition);
      e.orderBy?.forEach(({ expr }) => walk(expr));
    } else if (e.kind === "call") e.args.forEach(walk);
  };
  walk(ast);
  return found;
}

/** Whether a parsed formula holds any text in quotes. The numeric engine
 *  cannot hold text, so a user-defined transform (which reuses this
 *  evaluator) refuses it outright — text belongs in CONCATENATE, a
 *  calculated variable. */
export function formulaHasText(ast: Expr): boolean {
  let found = false;
  const walk = (e: Expr): void => {
    if (found) return;
    if (e.kind === "str") found = true;
    else if (e.kind === "unary") walk(e.expr);
    else if (e.kind === "binary") {
      walk(e.left);
      walk(e.right);
    } else if (e.kind === "condagg") {
      walk(e.condition);
      if (e.k) walk(e.k);
    } else if (e.kind === "window") {
      if (e.condition) walk(e.condition);
      if (e.partition) walk(e.partition);
      e.orderBy?.forEach(({ expr }) => walk(expr));
    } else if (e.kind === "call") e.args.forEach(walk);
  };
  walk(ast);
  return found;
}

/** Why text in a formula cannot run here, if it cannot: CONCATENATE
 *  returns text, so it can only be the whole formula (or nested inside
 *  another CONCATENATE), and text in quotes can only sit inside
 *  CONCATENATE's arguments. Anything else would push text through
 *  arithmetic, which only holds numbers. */
function textMisuse(ast: Expr): string | null {
  let problem: string | null = null;
  const walk = (e: Expr, inConcat: boolean, isTop: boolean): void => {
    if (problem) return;
    if (e.kind === "str") {
      if (!inConcat)
        problem =
          "text in quotes can only be used inside CONCATENATE — write CONCATENATE(First, \" \", Last), not text on its own.";
      return;
    }
    if (e.kind === "call" && e.name === "CONCATENATE") {
      if (!inConcat && !isTop)
        problem =
          "CONCATENATE returns text, so it can only be the whole formula — it cannot sit inside arithmetic or another function.";
      e.args.forEach((a) => walk(a, true, false));
      return;
    }
    if (e.kind === "unary") walk(e.expr, inConcat, false);
    else if (e.kind === "binary") {
      walk(e.left, inConcat, false);
      walk(e.right, inConcat, false);
    } else if (e.kind === "condagg") {
      walk(e.condition, inConcat, false);
      if (e.k) walk(e.k, inConcat, false);
    } else if (e.kind === "window") {
      if (e.condition) walk(e.condition, inConcat, false);
      if (e.partition) walk(e.partition, inConcat, false);
      e.orderBy?.forEach(({ expr }) => walk(expr, inConcat, false));
    } else if (e.kind === "call") e.args.forEach((a) => walk(a, inConcat, false));
  };
  walk(ast, false, true);
  return problem;
}

// ── Evaluation ─────────────────────────────────────────────────────────

/** What one row's evaluation reads: a variable's value in that row, and a
 *  variable's whole column (for aggregates). `valueAt` reads any row, so a
 *  conditional aggregate can run its condition row by row. `rawTextAt`
 *  reads a cell's raw text (null: blank or excluded) — the text COUNTA
 *  reads, since `values` is numeric-only. `row` is the row this context
 *  evaluates; `windowColumn` reads a window function's whole-column pass
 *  at that row (window functions are computed once per formula in
 *  `recomputeCalculated`, never per row). */
export interface EvalContext {
  value: (name: string) => number | null;
  values: (name: string) => number[];
  valueAt: (name: string, row: number) => number | null;
  rawTextAt: (name: string, row: number) => string | null;
  rowCount: number;
  row: number;
  /** RAND's seed: the variable's identity (its name + formula), so one
   *  variable's random column is stable across recomputes and differs
   *  from every other variable's. Absent outside calculated variables
   *  (the transform reuses this evaluator with seed 0 — still stable
   *  per row, just not per formula). */
  seed?: number;
  windowColumn?: (node: Expr) => (number | null)[] | undefined;
}

const truthy = (v: number | null): boolean | null => (v == null ? null : v !== 0);

/** A cell counts for COUNTA when it holds anything but blank: a number,
 *  or text — even text, per the docs. Cells with only spaces count as
 *  blank (the COUNTAIF entry says so). `value` is the cell's numeric
 *  reading, `text` its raw cell text. */
const cellIsNonBlank = (text: string | null, value: number | null): boolean =>
  value != null || (text != null && text.trim() !== "");

function aggregate(name: string, values: number[]): number | null {
  // COUNTA through here is numeric-only — the real COUNTA paths (the call
  // case, the condagg case, the window loop) count non-blank cells from
  // their raw text instead, so text is never missed. This arm stays as
  // the fallback for any caller that only has numbers.
  if (name === "COUNT" || name === "COUNTA") return values.length;
  if (values.length === 0) return null;
  switch (name) {
    case "MEAN":
      return mean(values);
    case "SUM":
      return values.reduce((a, b) => a + b, 0);
    case "MEDIAN":
      return median(values);
    case "SD":
      return values.length > 1 ? sd(values) : null;
    case "SEM":
      return values.length > 1 ? sem(values) : null;
    case "VAR":
      return values.length > 1 ? sd(values) ** 2 : null;
    case "MIN":
      return minOf(values);
    case "MAX":
      return maxOf(values);
    default:
      return null;
  }
}

/** A conditional aggregate over the rows that matched (seq 372, part A):
 *  SUM/COUNT/COUNTA return 0 when nothing matches; the rest blank. */
function conditionalAggregate(name: string, values: number[]): number | null {
  if (values.length === 0) return name === "SUM" || name === "COUNT" || name === "COUNTA" ? 0 : null;
  return aggregate(name, values);
}

/** The type-7 percentile — linear interpolation between the closest
 *  ranks, R's default (`quantile(x, probs, type = 7)`) and Excel's
 *  PERCENTILE.INC. `k` is 0–100; the caller blanks anything outside. */
function percentileOf(values: number[], k: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (k / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const frac = rank - lo;
  return sorted[lo] + frac * ((sorted[lo + 1] ?? sorted[lo]) - sorted[lo]);
}

/** One uniform draw on [0, 1), seeded by the context's seed (the
 *  variable's identity) and the row: the same variable in the same row
 *  always draws the same number, so a random column survives a recompute
 *  unchanged, while rows — and variables — still differ. Mulberry32. */
function seededRandom(ctx: EvalContext): number {
  let s = (((ctx.seed ?? 0) ^ Math.imul(ctx.row + 1, 0x9e3779b9)) >>> 0) + 0x6d2b79f5;
  s >>>= 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A formula's text, for CONCATENATE: a string literal is itself, a
 *  variable is the text typed in its cell (blank contributes nothing), a
 *  number is written the way a cell holds it, and anything else is its
 *  computed number written the same way (blank contributes nothing). A
 *  nested CONCATENATE joins its own arguments. */
function evalText(e: Expr, ctx: EvalContext): string {
  switch (e.kind) {
    case "str":
      return e.value;
    case "var": {
      const text = ctx.rawTextAt(e.name, ctx.row);
      return text != null && text.trim() !== "" ? text : "";
    }
    case "call":
      if (e.name === "CONCATENATE") return e.args.map((a) => evalText(a, ctx)).join("");
      return cell(evalExpr(e, ctx)) ?? "";
    default:
      return cell(evalExpr(e, ctx)) ?? "";
  }
}

/** What a window's whole-column pass reads: any row's value, a row's raw
 *  cell text (a text partition groups by its text), and any helper
 *  expression evaluated at any row. */
interface WindowHelpers {
  rowCount: number;
  valueAt: (name: string, row: number) => number | null;
  rawTextAt: (name: string, row: number) => string | null;
  evalAt: (expr: Expr, row: number) => number | null;
}

type WindowExpr = Extract<Expr, { kind: "window" }>;

/** A row's partition key: a bare variable groups by its value — a number
 *  when the cell holds one, its text when it holds text — and any other
 *  expression groups by its number. A blank key puts the row in no group,
 *  so its result stays blank. */
function partitionKeyOf(expr: Expr, row: number, h: WindowHelpers): string | number | null {
  if (expr.kind === "var") {
    const v = h.valueAt(expr.name, row);
    if (v != null) return v;
    const text = h.rawTextAt(expr.name, row);
    if (text != null && text !== "") return text;
    return null;
  }
  return h.evalAt(expr, row);
}

/** A frame boundary as a position in the group's order. */
function frameIndex(bound: FrameBound, pos: number, len: number): number {
  switch (bound.kind) {
    case "unbounded-preceding":
      return 0;
    case "n-preceding":
      return pos - bound.n;
    case "current":
      return pos;
    case "n-following":
      return pos + bound.n;
    case "unbounded-following":
      return len - 1;
  }
}

/** A window function's whole column, one value per row (seq 372, part B).
 *  Rows split into partition groups; each group orders by ORDER BY (table
 *  order without it, nulls last, ties keeping table order); a ROWS frame
 *  slices that order around each row. WHERE picks which rows contribute —
 *  without ROWS a row that does not match still gets its group's result,
 *  with ROWS it gets blank. Blanks never contribute a value. COUNT counts
 *  numeric values only and, as the docs say, reports only on rows whose
 *  own value is not blank; COUNTA also counts text values. */
function computeWindow(node: WindowExpr, h: WindowHelpers): (number | null)[] {
  const n = h.rowCount;
  const out: (number | null)[] = new Array(n).fill(null);
  const orderBy = node.orderBy ?? [];
  const keys: (string | number | null)[] = [];
  const matches: boolean[] = [];
  const orderKeys: (number | null)[][] = [];
  for (let r = 0; r < n; r++) {
    keys.push(node.partition ? partitionKeyOf(node.partition, r, h) : 0);
    matches.push(!node.condition || truthy(h.evalAt(node.condition, r)) === true);
    orderKeys.push(orderBy.map(({ expr }) => h.evalAt(expr, r)));
  }
  const groups = new Map<string | number, number[]>();
  for (let r = 0; r < n; r++) {
    const key = keys[r];
    if (key == null) continue;
    const rows = groups.get(key);
    if (rows) rows.push(r);
    else groups.set(key, [r]);
  }
  const compare = (a: number, b: number): number => {
    for (let k = 0; k < orderBy.length; k++) {
      const av = orderKeys[a][k];
      const bv = orderKeys[b][k];
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const d = av - bv;
      if (d !== 0) return orderBy[k].desc ? -d : d;
    }
    return 0;
  };
  for (const rows of groups.values()) {
    const ordered = [...rows].sort(compare);
    const len = ordered.length;
    for (let p = 0; p < len; p++) {
      const r = ordered[p];
      let lo = 0;
      let hi = len - 1;
      if (node.frame) {
        lo = Math.max(0, frameIndex(node.frame.start, p, len));
        hi = Math.min(len - 1, frameIndex(node.frame.end, p, len));
      }
      // With ROWS, a row that does not match the filter gets no result.
      if (node.frame && !matches[r]) {
        out[r] = null;
        continue;
      }
      const values: number[] =
        lo > hi
          ? []
          : ordered
              .slice(lo, hi + 1)
              .filter((j) => matches[j])
              .map((j) => h.valueAt(node.variable, j))
              .filter((v): v is number => v != null);
      const own = h.valueAt(node.variable, r);
      if (node.name === "CENTER") {
        out[r] = own == null || values.length === 0 ? null : own - mean(values);
      } else if (node.name === "STANDARDIZE" || node.name === "ZSCORE") {
        // The docs: blank with fewer than two values, or all identical.
        const s = values.length < 2 ? null : sd(values);
        out[r] = own == null || s == null || s === 0 ? null : (own - mean(values)) / s;
      } else if (node.name === "RANK") {
        if (own == null) {
          out[r] = null;
        } else {
          // Ascending, smallest is 1; ties share the average of the
          // positions they occupy; blanks are left out.
          const less = values.filter((v) => v < own).length;
          const equal = values.filter((v) => v === own).length;
          out[r] = 1 + less + (equal - 1) / 2;
        }
      } else if (node.name === "COUNT") {
        out[r] = own == null ? null : values.length;
      } else if (node.name === "COUNTA") {
        // The docs: COUNTA also counts text values — count the frame's
        // non-blank cells, not just its numbers.
        const frame = lo > hi ? [] : ordered.slice(lo, hi + 1).filter((j) => matches[j]);
        out[r] = frame.filter((j) => cellIsNonBlank(h.rawTextAt(node.variable, j), h.valueAt(node.variable, j))).length;
      } else {
        out[r] = node.condition ? conditionalAggregate(node.name, values) : aggregate(node.name, values);
      }
    }
  }
  return out;
}

function evalExpr(e: Expr, ctx: EvalContext): number | null {
  switch (e.kind) {
    case "num":
      return e.value;
    case "str":
      // Text has no number: a string literal only ever sits inside
      // CONCATENATE (validation says so), where evalText reads it.
      return null;
    case "var":
      return ctx.value(e.name);
    case "condagg": {
      // The condition runs row by row; the matching rows' values aggregate
      // into one broadcast value. A blank condition never matches, and a
      // blank value never counts — blanks are excluded from calculation.
      const matched: number[] = [];
      let matchedNonBlank = 0;
      for (let j = 0; j < ctx.rowCount; j++) {
        const rowCtx: EvalContext = {
          value: (name) => ctx.valueAt(name, j),
          values: ctx.values,
          valueAt: ctx.valueAt,
          rawTextAt: ctx.rawTextAt,
          rowCount: ctx.rowCount,
          row: j,
          seed: ctx.seed,
          windowColumn: ctx.windowColumn,
        };
        if (truthy(evalExpr(e.condition, rowCtx)) === true) {
          const v = ctx.valueAt(e.variable, j);
          if (v != null) matched.push(v);
          // COUNTA also counts text values (the docs), so a matching row
          // counts when its cell holds anything but blank.
          if (cellIsNonBlank(ctx.rawTextAt(e.variable, j), v)) matchedNonBlank++;
        }
      }
      if (e.name === "COUNTA") return matchedNonBlank;
      if (e.name === "PERCENTILE") {
        const k = e.k ? evalExpr(e.k, ctx) : null;
        if (k == null || k < 0 || k > 100) return null;
        return percentileOf(matched, k);
      }
      return conditionalAggregate(e.name, matched);
    }
    case "window": {
      // A window function reads its whole-column pass at this row — the
      // pass runs in recomputeCalculated, so this case never computes.
      const column = ctx.windowColumn?.(e);
      return column?.[ctx.row] ?? null;
    }
    case "unary": {
      const v = evalExpr(e.expr, ctx);
      if (v == null) return null;
      return e.op === "-" ? -v : v === 0 ? 1 : 0;
    }
    case "binary": {
      if (e.op === "AND" || e.op === "OR") {
        const l = truthy(evalExpr(e.left, ctx));
        const r = truthy(evalExpr(e.right, ctx));
        if (e.op === "AND") {
          if (l === false || r === false) return 0;
          if (l == null || r == null) return null;
          return 1;
        }
        if (l === true || r === true) return 1;
        if (l == null || r == null) return null;
        return 0;
      }
      const l = evalExpr(e.left, ctx);
      const r = evalExpr(e.right, ctx);
      if (l == null || r == null) return null;
      switch (e.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? null : l / r;
        case "%":
          return r === 0 ? null : l % r;
        case "^": {
          const v = l ** r;
          return Number.isFinite(v) ? v : null;
        }
        case "=":
        case "==":
          return l === r ? 1 : 0;
        case "<>":
        case "!=":
          return l !== r ? 1 : 0;
        case "<":
          return l < r ? 1 : 0;
        case "<=":
          return l <= r ? 1 : 0;
        case ">":
          return l > r ? 1 : 0;
        case ">=":
          return l >= r ? 1 : 0;
        default:
          return null;
      }
    }
    case "call": {
      // A one-variable aggregate reads the whole column, not one row.
      if (AGGREGATES.includes(e.name) && e.args.length === 1 && e.args[0].kind === "var") {
        // Prism: unlike the other summary functions, COUNT only reports
        // in rows that contain non-blank values (function reference,
        // COUNT(Variable)) — the windowed COUNT already blanks blank
        // rows the same way, so the plain form matches it here.
        if (e.name === "COUNT" && ctx.value(e.args[0].name) == null) return null;
        if (e.name === "COUNTA") {
          // COUNTA also counts text values (the docs) — values() is
          // numeric-only, so count the column's non-blank cells from
          // their raw text instead.
          let n = 0;
          for (let j = 0; j < ctx.rowCount; j++) {
            if (cellIsNonBlank(ctx.rawTextAt(e.args[0].name, j), ctx.valueAt(e.args[0].name, j))) n++;
          }
          return n;
        }
        return aggregate(e.name, ctx.values(e.args[0].name));
      }
      if (e.name === "IF") {
        const cond = truthy(evalExpr(e.args[0], ctx));
        return cond == null ? null : evalExpr(cond ? e.args[1] : e.args[2], ctx);
      }
      // CONCATENATE returns text: the numeric evaluator cannot hold it
      // (the table integration evaluates a CONCATENATE formula as text),
      // so here it blanks — validation keeps it out of arithmetic.
      if (e.name === "CONCATENATE") return null;
      // IS_DEFINED answers whether a value exists — a blank must not
      // blank it, so it reads before the arguments are evaluated. A text
      // cell counts as defined, so a bare variable reads its cell text.
      if (e.name === "IS_DEFINED") {
        const arg = e.args[0];
        if (arg.kind === "var")
          return cellIsNonBlank(ctx.rawTextAt(arg.name, ctx.row), ctx.value(arg.name)) ? 1 : 0;
        return evalExpr(arg, ctx) == null ? 0 : 1;
      }
      // PERCENTILE over the whole variable, with its k beside it.
      if (e.name === "PERCENTILE") {
        const vArg = e.args[0];
        const k = evalExpr(e.args[1], ctx);
        if (vArg.kind !== "var" || k == null || k < 0 || k > 100) return null;
        return percentileOf(ctx.values(vArg.name), k);
      }
      const args = e.args.map((a) => evalExpr(a, ctx));
      if (e.name === "MIN" || e.name === "MAX") {
        if (args.some((a) => a == null)) return null;
        return e.name === "MIN" ? Math.min(...(args as number[])) : Math.max(...(args as number[]));
      }
      if (e.name === "RAND") return seededRandom(ctx);
      if (e.name === "RANDBETWEEN") {
        const [lo, hi] = args as (number | null)[];
        if (lo == null || hi == null || !Number.isInteger(lo) || !Number.isInteger(hi) || lo > hi) return null;
        return Math.floor(seededRandom(ctx) * (hi - lo + 1)) + lo;
      }
      // AND / OR as functions: three-valued, like the operators — a
      // deciding side wins whatever the other side holds, and a blank
      // only blanks the result when nothing decides it.
      if (e.name === "AND") {
        if (args.some((a) => a === 0)) return 0;
        if (args.some((a) => a == null)) return null;
        return 1;
      }
      if (e.name === "OR") {
        if (args.some((a) => a != null && a !== 0)) return 1;
        if (args.some((a) => a == null)) return null;
        return 0;
      }
      const [a, b] = args as (number | null)[];
      if (a == null) return null;
      switch (e.name) {
        case "ABS":
          return Math.abs(a);
        case "SQRT":
          return a < 0 ? null : Math.sqrt(a);
        case "EXP": {
          const v = Math.exp(a);
          return Number.isFinite(v) ? v : null;
        }
        case "LN":
          return a <= 0 ? null : Math.log(a);
        case "LOG":
        case "LOG10":
          return a <= 0 ? null : Math.log10(a);
        case "LOG2":
          return a <= 0 ? null : Math.log2(a);
        case "SIN":
          return Math.sin(a);
        case "COS":
          return Math.cos(a);
        case "TAN":
          return Math.tan(a);
        case "ASIN":
          return a < -1 || a > 1 ? null : Math.asin(a);
        case "ACOS":
          return a < -1 || a > 1 ? null : Math.acos(a);
        case "ATAN":
          return Math.atan(a);
        case "FLOOR":
          return Math.floor(a);
        case "CEIL":
          return Math.ceil(a);
        case "SIGN":
          return Math.sign(a);
        case "LOGIT":
          return a <= 0 || a >= 1 ? null : Math.log(a / (1 - a));
        case "PROBIT":
          return a <= 0 || a >= 1 ? null : qnorm(a);
        case "ATAN2": {
          if (b == null) return null;
          // Excel / Prism order: ATAN2(x, y) is the angle whose tangent
          // is y / x, i.e. atan2(y, x).
          return Math.atan2(b, a);
        }
        case "FACT": {
          if (!Number.isInteger(a) || a < 0 || a > 170) return null;
          let f = 1;
          for (let i = 2; i <= a; i++) f *= i;
          return f;
        }
        case "INT":
          return Math.trunc(a);
        case "MOD": {
          if (b == null || b === 0) return null;
          // Excel's rule: the remainder takes the divisor's sign.
          return a - b * Math.floor(a / b);
        }
        case "TRUNC": {
          const digits = b == null ? 0 : Math.trunc(b);
          const factor = 10 ** digits;
          if (!Number.isFinite(factor)) return null;
          const v = Math.trunc(a * factor) / factor;
          return Number.isFinite(v) ? v : null;
        }
        case "POWER": {
          if (b == null) return null;
          const v = a ** b;
          return Number.isFinite(v) ? v : null;
        }
        case "ROUND": {
          if (b == null && e.args.length === 2) return null;
          const digits = b ?? 0;
          const factor = 10 ** digits;
          return Math.round(a * factor) / factor;
        }
        default:
          return null;
      }
    }
  }
}

/** Evaluate a parsed formula in one row's context — the entry point for
 *  callers outside calculated variables (the user-defined transform, seq
 *  341, reuses this evaluator rather than building a second expression
 *  language). */
export const evaluateFormula = (ast: Expr, ctx: EvalContext): number | null => evalExpr(ast, ctx);

// ── Table integration ──────────────────────────────────────────────────

/** Whether `name` is one of the table's calculated variables. */
export const isCalculatedColumn = (data: TableData, name: string): boolean =>
  (data.calculated ?? []).some((v) => v.name === name);

/** The calculated variable named `name`, if the table has one. */
export const calculatedVariable = (data: TableData, name: string): CalculatedVariable | undefined =>
  (data.calculated ?? []).find((v) => v.name === name);

/** Why a formula cannot be added or set here, if it cannot: a syntax error,
 *  a variable the table does not hold, or a reference to itself. `self` is
 *  the variable being edited (its own name is a circular reference). */
export function validateFormula(data: TableData, formula: string, self?: string): string | null {
  const parsed = parseFormula(formula);
  if ("error" in parsed) return parsed.error;
  const columns = new Set(data.columns.slice(1));
  for (const dep of dependenciesOf(parsed.ast)) {
    if (dep === self) return `“${self}” refers to itself — a calculated variable cannot use its own values.`;
    if (!columns.has(dep)) return `unknown variable “${dep}” — the table has no variable with that name.`;
  }
  return textMisuse(parsed.ast);
}

/**
 * Recomputes every calculated variable's values into the table's rows, in
 * dependency order (a formula may use another calculated variable). The
 * same TableData back when nothing changes, so an unrelated edit costs no
 * recompute downstream. A formula that cannot run blanks its column and
 * records its `error`; the other variables still compute.
 */
export function recomputeCalculated(data: TableData): TableData {
  const vars = data.calculated ?? [];
  if (vars.length === 0) return data;
  const columns = data.columns.slice(1);
  const present = new Set(columns);
  // A variable whose column is gone (deleted, or a hand-edited file) keeps
  // its definition but cannot run — it reads as an error, never a crash.
  const table = readTable(data);
  const byName = new Map(table.columns.map((c) => [c.name, c]));
  const computed = new Map<string, (number | null)[]>();
  /** A CONCATENATE variable's values, as text — the numeric map above
   *  cannot hold them. */
  const computedText = new Map<string, (string | null)[]>();
  /** RAND's seed: the variable's name + formula, hashed (FNV-1a), so one
   *  variable's random column is stable across recomputes and differs
   *  from every other variable's. */
  const seedOf = (name: string, formula: string): number => {
    let h = 0x811c9dc5;
    const s = `${name}\0${formula}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };
  const errors = new Map<string, string>();
  // Dependency order: a formula's calculated inputs first. A cycle leaves
  // its variables unordered — they are named in the error instead.
  const parsed = new Map<string, Expr>();
  for (const v of vars) {
    const p = parseFormula(v.formula);
    if ("error" in p) errors.set(v.name, p.error);
    else {
      // A file can hold text where it cannot run (validation only guards
      // the add / set paths) — it records the reason, like a parse error.
      const misuse = textMisuse(p.ast);
      if (misuse) errors.set(v.name, misuse);
      else parsed.set(v.name, p.ast);
    }
  }
  // Dependency order, worked out by repeated passes: a variable runs once
  // every calculated variable it names has run. Whatever is left after no
  // pass makes progress depends on itself, in a circle — directly, or
  // through a variable that does — and is named in the error instead.
  const pending = new Set([...parsed.keys()]);
  const order: string[] = [];
  for (;;) {
    let moved = false;
    for (const name of [...pending]) {
      const deps = dependenciesOf(parsed.get(name)!).filter((d) => vars.some((v) => v.name === d));
      if (deps.every((d) => order.includes(d))) {
        pending.delete(name);
        order.push(name);
        moved = true;
      }
    }
    if (!moved || pending.size === 0) break;
  }
  for (const name of pending)
    errors.set(
      name,
      `“${name}” is part of a circular reference — calculated variables cannot depend on each other in a circle.`,
    );
  // A variable whose dependency failed cannot run either.
  const failed = new Set([...errors.keys()]);
  for (const name of order) {
    if (failed.has(name)) continue;
    const ast = parsed.get(name)!;
    const deps = dependenciesOf(ast);
    const unknown = deps.find((d) => !present.has(d));
    if (unknown) {
      errors.set(name, `unknown variable “${unknown}” — the table has no variable with that name.`);
      failed.add(name);
      continue;
    }
    const badDep = deps.find((d) => failed.has(d));
    if (badDep) {
      errors.set(name, `depends on “${badDep}”, which could not be calculated.`);
      failed.add(name);
      continue;
    }
    // A calculated input reads its computed values; a plain one reads the
    // table (excluded cells read as blank — readTable already applies them).
    const readValueAt = (dep: string, j: number): number | null => {
      const done = computed.get(dep);
      if (done) return done[j] ?? null;
      return byName.get(dep)?.byRow[j] ?? null;
    };
    // A cell's raw text: a calculated input reads what its formula just
    // computed — its text, or its number written the way a cell holds it.
    // The table snapshot predates this recompute, so reading it would hand
    // back the pre-edit text (bug-report issue 22's stale rawTextAt); the
    // text path needs the fresh one, or a CONCATENATE chained on an edited
    // source would keep the old text.
    const readRawTextAt = (dep: string, j: number): string | null => {
      const text = computedText.get(dep);
      if (text) return text[j] ?? null;
      const done = computed.get(dep);
      if (done) return cell(done[j] ?? null);
      return byName.get(dep)?.cells[j] ?? null;
    };
    const makeRowCtx = (r: number): EvalContext => ({
      value: (dep) => readValueAt(dep, r),
      values: (dep) => {
        const done = computed.get(dep);
        if (done) return done.filter((v): v is number => v != null);
        return byName.get(dep)?.values ?? [];
      },
      valueAt: readValueAt,
      rawTextAt: readRawTextAt,
      rowCount: data.rows.length,
      row: r,
      seed: seedOf(name, vars.find((v) => v.name === name)?.formula ?? ""),
      windowColumn: (node) => ensureWindow(node),
    });
    // Window functions evaluate as a whole-column pass: each window node
    // in this formula gets its full column computed once (a window inside
    // another window's clause computes on demand, through the same map),
    // then every row reads its own entry from it.
    const windowColumns = new Map<Expr, (number | null)[]>();
    const ensureWindow = (node: Expr): (number | null)[] => {
      const done = windowColumns.get(node);
      if (done) return done;
      const values = computeWindow(node as WindowExpr, {
        rowCount: data.rows.length,
        valueAt: readValueAt,
        rawTextAt: readRawTextAt,
        evalAt: (expr, j) => evalExpr(expr, makeRowCtx(j)),
      });
      windowColumns.set(node, values);
      return values;
    };
    const windowNodes: Expr[] = [];
    const collectWindows = (e: Expr): void => {
      if (e.kind === "unary") collectWindows(e.expr);
      else if (e.kind === "binary") {
        collectWindows(e.left);
        collectWindows(e.right);
      } else if (e.kind === "condagg") {
        collectWindows(e.condition);
        if (e.k) collectWindows(e.k);
      } else if (e.kind === "call") e.args.forEach(collectWindows);
      else if (e.kind === "window") {
        windowNodes.push(e);
        if (e.condition) collectWindows(e.condition);
        if (e.partition) collectWindows(e.partition);
        e.orderBy?.forEach(({ expr }) => collectWindows(expr));
      }
    };
    collectWindows(ast);
    for (const w of windowNodes) ensureWindow(w);
    // A CONCATENATE formula evaluates as text, not numbers — its values
    // go in the text map, and a join that comes to nothing stays blank.
    if (ast.kind === "call" && ast.name === "CONCATENATE") {
      const texts: (string | null)[] = [];
      for (let r = 0; r < data.rows.length; r++) {
        const joined = evalText(ast, makeRowCtx(r));
        texts.push(joined === "" ? null : joined);
      }
      computedText.set(name, texts);
    } else {
      const values: (number | null)[] = [];
      for (let r = 0; r < data.rows.length; r++) {
        values.push(evalExpr(ast, makeRowCtx(r)));
      }
      computed.set(name, values);
    }
  }
  // Materialize: only the calculated columns change; every other cell —
  // including text in a source column — stays exactly as typed.
  const rows = data.rows.map((row, r) => {
    let next: (string | null)[] | null = null;
    for (const v of vars) {
      const c = columns.indexOf(v.name) + 1;
      if (c < 1) continue;
      const textVals = computedText.get(v.name);
      const value = textVals !== undefined ? textVals[r] : cell(computed.get(v.name)?.[r] ?? null);
      if ((row[c] ?? null) !== value) {
        next ??= [...row];
        // A hand-edited file can hold a row shorter than its columns: pad
        // with nulls rather than leaving `undefined` holes past its end.
        while (next.length <= c) next.push(null);
        next[c] = value;
      }
    }
    return next ?? row;
  });
  const calculated = vars.map((v) => {
    const error = errors.get(v.name);
    if ((v.error ?? undefined) === error) return v;
    return error === undefined ? { name: v.name, formula: v.formula } : { name: v.name, formula: v.formula, error };
  });
  const rowsChanged = rows.some((row, r) => row !== data.rows[r]);
  const errorsChanged = calculated.some((v, i) => v !== vars[i]);
  if (!rowsChanged && !errorsChanged) return data;
  return { ...data, rows, calculated };
}

/** Adds a calculated variable — a new column holding the formula's values.
 *  The name must be free, the formula must read, and every variable it
 *  names must already be a column of the table. */
export function addCalculatedVariable(
  data: TableData,
  name: string,
  formula: string,
): { data: TableData } | { error: string } {
  const clean = name.trim();
  if (!clean) return { error: "a calculated variable needs a name." };
  if (clean.includes(":")) return { error: `“${clean}” cannot hold a “:” — a column name never does.` };
  if (data.columns.includes(clean)) return { error: `the table already has a variable named “${clean}”.` };
  const bad = validateFormula(data, formula);
  if (bad) return { error: bad };
  const withColumn: TableData = {
    ...data,
    columns: [...data.columns, clean],
    // Rows are padded to the new width: a hand-edited file can hold a row
    // shorter than its columns, and appending one null would land the new
    // column's cell in the middle of such a row.
    rows: data.rows.map((row) => [
      ...row,
      ...Array<string | null>(Math.max(0, data.columns.length + 1 - row.length)).fill(null),
    ]),
    calculated: [...(data.calculated ?? []), { name: clean, formula: formula.trim() }],
  };
  return { data: recomputeCalculated(withColumn) };
}

/** Makes an existing, empty column a calculated variable — the grid's `=`
 *  gesture (type `=` in an empty variable). The column must hold no values:
 *  turning a column with values into a formula would throw its values away.
 *  The formula must read, and every variable it names must already be a
 *  column of the table. */
export function makeCalculatedVariable(
  data: TableData,
  name: string,
  formula: string,
): { data: TableData } | { error: string } {
  const c = data.columns.indexOf(name);
  if (c < 1) return { error: `the table has no variable named “${name}”.` };
  if (isCalculatedColumn(data, name))
    return { error: `“${name}” is already a calculated variable — edit its formula instead.` };
  if (data.rows.some((row) => row[c] != null))
    return { error: `“${name}” already holds values — a formula starts in an empty variable.` };
  const bad = validateFormula(data, formula, name);
  if (bad) return { error: bad };
  const next: TableData = {
    ...data,
    calculated: [...(data.calculated ?? []), { name, formula: formula.trim() }],
  };
  return { data: recomputeCalculated(next) };
}

/** Changes a calculated variable's formula (its values follow at once). */
export function setCalculatedFormula(
  data: TableData,
  name: string,
  formula: string,
): { data: TableData } | { error: string } {
  if (!isCalculatedColumn(data, name)) return { error: `the table has no calculated variable named “${name}”.` };
  const bad = validateFormula(data, formula, name);
  if (bad) return { error: bad };
  const next: TableData = {
    ...data,
    calculated: (data.calculated ?? []).map((v) => (v.name === name ? { name, formula: formula.trim() } : v)),
  };
  return { data: recomputeCalculated(next) };
}

/** Removes a calculated variable and its column (its values go with it).
 *  Formulas that used it keep their text — they read as an error until
 *  they are edited or removed. */
export function removeCalculatedVariable(data: TableData, name: string): TableData {
  const c = data.columns.indexOf(name);
  if (c < 1 || !isCalculatedColumn(data, name)) return data;
  return {
    ...data,
    columns: data.columns.filter((_, i) => i !== c),
    rows: data.rows.map((row) => row.filter((_, i) => i !== c)),
    calculated: (data.calculated ?? []).filter((v) => v.name !== name),
    excluded: remapExcludedAfterDelete(data, c),
    cellBackgrounds: remapCellBackgroundsAfterDelete(data, c),
    widths: widthsWithout(data.widths, name),
    decimals: decimalsWithout(data.decimals, name),
  };
}

function remapExcludedAfterDelete(data: TableData, c: number): string[] | undefined {
  const out: string[] = [];
  for (const key of data.excluded ?? []) {
    const [r, col] = key.split(",").map(Number);
    if (col === c) continue;
    out.push(`${r},${col > c ? col - 1 : col}`);
  }
  return out.length ? out : undefined;
}

/** The `cellBackgrounds` twin of `remapExcludedAfterDelete`: a deleted
 *  column takes its colors with it, and the columns after it shift left. */
function remapCellBackgroundsAfterDelete(data: TableData, c: number): Record<string, CellBackgroundColor> | undefined {
  const out: Record<string, CellBackgroundColor> = {};
  for (const [key, color] of Object.entries(data.cellBackgrounds ?? {})) {
    const [r, col] = key.split(",").map(Number);
    if (col === c) continue;
    out[`${r},${col > c ? col - 1 : col}`] = color;
  }
  return Object.keys(out).length ? out : undefined;
}

function widthsWithout(widths: TableData["widths"], name: string): TableData["widths"] {
  if (!widths || widths[name] === undefined) return widths;
  const { [name]: _, ...rest } = widths;
  return Object.keys(rest).length ? rest : undefined;
}

function decimalsWithout(decimals: TableData["decimals"], name: string): TableData["decimals"] {
  if (!decimals || decimals[name] === undefined) return decimals;
  const { [name]: _, ...rest } = decimals;
  return Object.keys(rest).length ? rest : undefined;
}

/** Whether a column name must be written bracketed in a formula: anything
 *  that is not a plain identifier (spaces, punctuation), and any plain
 *  identifier the parser would read as something else whatever follows
 *  it — a constant (`E`, `PI`) or a logical operator (`AND` / `OR` /
 *  `NOT`). Function and aggregate names (`SUM`, `MEAN`…) need no
 *  brackets: a bare reference is never followed by `(`, and without one
 *  the parser reads the word as a variable — `Sum * 2` stays `Sum * 2`,
 *  as the rename test pins. */
const RESERVED_FORMULA_WORDS = new Set([...Object.keys(CONSTANTS), "AND", "OR", "NOT"]);
const needsBrackets = (name: string): boolean =>
  !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || RESERVED_FORMULA_WORDS.has(name.toUpperCase());

/** Renames the variable in a formula: a bare `Old` becomes `New`, and a
 *  bracketed `[Old]` becomes `[New]`. A function call named `Old` is left
 *  alone (a column is never a function), and so is text inside brackets
 *  that is not the whole name. A numeric literal is copied whole — the
 *  `e` in `1e-5` is an exponent, not the column `e` — and a new name
 *  that needs brackets gets them, so renaming to `Dose (mg)` or `E`
 *  keeps the formula readable. */
export function renameVariableInFormula(formula: string, oldName: string, newName: string): string {
  if (oldName === newName) return formula;
  const replacement = needsBrackets(newName) ? `[${newName}]` : newName;
  let out = "";
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === '"') {
      // Text in quotes is literal — a rename never rewrites inside it
      // (`CONCATENATE(First, "First")` keeps its "First"). `""` is one
      // `"`, the tokenizer's rule; an unterminated quote copies the rest.
      let j = i + 1;
      while (j < formula.length) {
        if (formula[j] === '"') {
          if (formula[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out += formula.slice(i, j);
      i = j;
      continue;
    }
    if (ch === "[") {
      const close = formula.indexOf("]", i + 1);
      if (close < 0) return out + formula.slice(i);
      const name = formula.slice(i + 1, close);
      out += name === oldName ? `[${newName}]` : formula.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      // A number, exponent included: `1e-5` is one literal, and its `e`
      // is not a column reference. The tokenizer's number shape.
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(formula.slice(i));
      if (m && m[0] !== ".") {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i))!;
      const word = m[0];
      const after = formula[i + word.length];
      out += word === oldName && after !== "(" ? replacement : word;
      i += word.length;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Follows a column rename through the table's formulas: the renamed
 *  variable's own entry takes the new name, and every formula naming it —
 *  as a bare word or in brackets — is rewritten. The same TableData back
 *  when no formula names it. */
export function renameCalculatedReferences(data: TableData, oldName: string, newName: string): TableData {
  const vars = data.calculated ?? [];
  if (vars.length === 0 || oldName === newName) return data;
  const next = vars.map((v) => ({
    name: v.name === oldName ? newName : v.name,
    formula: renameVariableInFormula(v.formula, oldName, newName),
    ...(v.error !== undefined ? { error: v.error } : {}),
  }));
  if (next.every((v, i) => v.name === vars[i].name && v.formula === vars[i].formula)) return data;
  return { ...data, calculated: next };
}

/** A file's calculated variables, put straight: entries naming a column
 *  with a non-empty formula survive; anything else is dropped, never
 *  trusted. Stored errors are dropped too — the values are recomputed on
 *  load, and the error is re-derived then. */
export function readCalculated(raw: unknown, columns: string[]): CalculatedVariable[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: CalculatedVariable[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const { name, formula } = entry as Record<string, unknown>;
    if (typeof name !== "string" || typeof formula !== "string") continue;
    if (!name.trim() || !formula.trim() || !columns.includes(name) || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, formula: formula.trim() });
  }
  return out.length ? out : undefined;
}

/** Whether a typed cell starts a formula: `=` followed by anything. */
export const isFormulaText = (value: string): boolean => value.startsWith("=") && value.trim().length > 1;

/** A cell's text as a formula (without its leading `=`), for the grid's
 *  `=` gesture. */
export const formulaOfText = (value: string): string => value.slice(1).trim();

/** The number a cell holds, for the checks: `parseCell` is the table's own rule. */
export const cellNumber = (value: string | null): number | null => parseCell(value);
