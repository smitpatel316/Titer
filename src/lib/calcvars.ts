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
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "-" | "NOT"; expr: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] }
  /** A conditional aggregate (seq 372, part A): `name` over the rows where
   *  `condition` holds, broadcast as one value per row. */
  | { kind: "condagg"; name: string; variable: string; condition: Expr }
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

/** The elementwise functions: name → argument counts it takes. */
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
  FLOOR: [1],
  CEIL: [1],
  SIGN: [1],
  ROUND: [1, 2],
  IF: [3],
  MIN: [2, 3, 4, 5, 6, 7, 8, 9, 10],
  MAX: [2, 3, 4, 5, 6, 7, 8, 9, 10],
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

/** Prism's spellings of the sample SD / SEM, as the windowable names. */
const normalizeAggregate = (name: string): string =>
  name === "STDEV" ? "SD" : name === "STDERR" ? "SEM" : name;
/** The aggregates that take window clauses (the docs' list — MEDIAN and
 *  VAR are whole-variable only, and take no OVER / ORDER BY / ROWS). */
const WINDOWABLE_AGGREGATES = ["MEAN", "SD", "SEM", "COUNT", "COUNTA", "MIN", "MAX", "SUM"];
/** The row-wise window functions: one value per row, relative to its
 *  window. They are window nodes with or without clauses — with no
 *  clauses the window is the whole variable. */
const ROW_WISE = ["CENTER", "STANDARDIZE", "ZSCORE", "RANK"];
/** A clause keyword, as the parser sees it after a call's closing paren. */
const WINDOW_KEYWORDS = ["OVER", "WHERE", "ORDER", "ROWS"];

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
        const allowed = ELEMENTWISE[upper];
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
        return { kind: "call", name: upper, args };
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
    if (!condBase && !rowWise && !isPlainAgg) {
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
    // shape — including MEDIAN and VAR, which take no window clauses.
    if (!partition && !orderBy && !frame && condition !== undefined && !condBase && !rowWise) {
      return { kind: "condagg", name: aggName, variable, condition };
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
      const args = e.args.map((a) => evalExpr(a, ctx));
      if (e.name === "MIN" || e.name === "MAX") {
        if (args.some((a) => a == null)) return null;
        return e.name === "MIN" ? Math.min(...(args as number[])) : Math.max(...(args as number[]));
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
  return null;
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
  const errors = new Map<string, string>();
  // Dependency order: a formula's calculated inputs first. A cycle leaves
  // its variables unordered — they are named in the error instead.
  const parsed = new Map<string, Expr>();
  for (const v of vars) {
    const p = parseFormula(v.formula);
    if ("error" in p) errors.set(v.name, p.error);
    else parsed.set(v.name, p.ast);
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
    const makeRowCtx = (r: number): EvalContext => ({
      value: (dep) => readValueAt(dep, r),
      values: (dep) => {
        const done = computed.get(dep);
        if (done) return done.filter((v): v is number => v != null);
        return byName.get(dep)?.values ?? [];
      },
      valueAt: readValueAt,
      rawTextAt: (dep, j) => byName.get(dep)?.cells[j] ?? null,
      rowCount: data.rows.length,
      row: r,
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
        rawTextAt: (dep, j) => byName.get(dep)?.cells[j] ?? null,
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
      } else if (e.kind === "condagg") collectWindows(e.condition);
      else if (e.kind === "call") e.args.forEach(collectWindows);
      else if (e.kind === "window") {
        windowNodes.push(e);
        if (e.condition) collectWindows(e.condition);
        if (e.partition) collectWindows(e.partition);
        e.orderBy?.forEach(({ expr }) => collectWindows(expr));
      }
    };
    collectWindows(ast);
    for (const w of windowNodes) ensureWindow(w);
    const values: (number | null)[] = [];
    for (let r = 0; r < data.rows.length; r++) {
      values.push(evalExpr(ast, makeRowCtx(r)));
    }
    computed.set(name, values);
  }
  // Materialize: only the calculated columns change; every other cell —
  // including text in a source column — stays exactly as typed.
  const rows = data.rows.map((row, r) => {
    let next: (string | null)[] | null = null;
    for (const v of vars) {
      const c = columns.indexOf(v.name) + 1;
      if (c < 1) continue;
      const value = cell(computed.get(v.name)?.[r] ?? null);
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
 *  they are edited or removed. The last data column stays: a table with
 *  only its title column is not a table. */
export function removeCalculatedVariable(data: TableData, name: string): TableData {
  const c = data.columns.indexOf(name);
  if (c < 1 || !isCalculatedColumn(data, name)) return data;
  if (data.columns.length <= 2) return data;
  const kept = (data.calculated ?? []).filter((v) => v.name !== name);
  return {
    ...data,
    columns: data.columns.filter((_, i) => i !== c),
    rows: data.rows.map((row) => row.filter((_, i) => i !== c)),
    calculated: kept.length ? kept : undefined,
    excluded: remapExcludedAfterDelete(data, c),
    cellBackgrounds: remapCellBackgroundsAfterDelete(data, c),
    widths: widthsWithout(data.widths, name),
    decimals: decimalsWithout(data.decimals, name),
    variableTypes: variableTypesWithout(data.variableTypes, name),
    // A deleted row-label source goes with its column.
    labelVariable: data.labelVariable === name ? undefined : data.labelVariable,
    levelOrder: levelOrderWithout(data.levelOrder, name),
    // The link follows the deletion, as linkedPasteAfterDelete would shift
    // it — inlined here, because table-data.ts already imports this module
    // and importing it back would be a cycle: a link anchored in the
    // deleted column goes, one past it shifts left by one.
    linkedPaste: data.linkedPaste
      ? data.linkedPaste.col === c
        ? undefined
        : data.linkedPaste.col > c
          ? { ...data.linkedPaste, col: data.linkedPaste.col - 1 }
          : data.linkedPaste
      : undefined,
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

function variableTypesWithout(
  types: TableData["variableTypes"],
  name: string,
): TableData["variableTypes"] {
  if (!types || types[name] === undefined) return types;
  const { [name]: _, ...rest } = types;
  return Object.keys(rest).length ? rest : undefined;
}

function levelOrderWithout(orders: TableData["levelOrder"], name: string): TableData["levelOrder"] {
  if (!orders || orders[name] === undefined) return orders;
  const { [name]: _, ...rest } = orders;
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
