// Calculated Variables (Prism 11 headline feature, seq 156): in-table
// formulas in Multiple Variables tables. Type `=` in an empty variable and
// the whole column becomes a live formula over the table's other variables —
// `=Dose * 2`, `=LOG10(Concentration)`, `=IF(Group = 1, A, B)` — recomputed
// whenever a source value changes, and usable in any MV analysis exactly
// like a typed variable, because the values are materialized into the
// table's rows (see `recomputeCalculated`).
//
// The formula core only: Prism 11.2's window functions (OVER / WHERE /
// ORDER BY / ROWS) and conditional aggregation (MEANIF / SUMIF / COUNTIF)
// are deliberately NOT built here — they are Pro-gated and licence-blocked
// on this install, so they were designed from the release notes, not
// verified in Prism. Descriptive aggregates over a whole variable
// (MEAN(A), SUM(A)…) ARE in: they are the 11.0 core's whole-variable
// arithmetic, broadcast as one value per row.
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

type Expr =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "unary"; op: "-" | "NOT"; expr: Expr }
  | { kind: "binary"; op: string; left: Expr; right: Expr }
  | { kind: "call"; name: string; args: Expr[] };

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
 *  compare row by row. */
const AGGREGATES = ["MEAN", "SUM", "COUNT", "MEDIAN", "SD", "SEM", "VAR", "MIN", "MAX"];
const CONSTANTS: Record<string, number> = { PI: Math.PI, E: Math.E };

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
    let left = this.cmp();
    while (this.eatIdent("AND")) left = { kind: "binary", op: "AND", left, right: this.cmp() };
    return left;
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
    if (this.eatIdent("NOT")) return { kind: "unary", op: "NOT", expr: this.unary() };
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
        if (AGGREGATES.includes(upper) && args.length === 1) return { kind: "call", name: upper, args };
        const allowed = ELEMENTWISE[upper];
        if (!allowed) {
          if (AGGREGATES.includes(upper))
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
    } else if (e.kind === "call") e.args.forEach(walk);
  };
  walk(ast);
  return found;
}

// ── Evaluation ─────────────────────────────────────────────────────────

/** What one row's evaluation reads: a variable's value in that row, and a
 *  variable's whole column (for aggregates). */
export interface EvalContext {
  value: (name: string) => number | null;
  values: (name: string) => number[];
}

const truthy = (v: number | null): boolean | null => (v == null ? null : v !== 0);

function aggregate(name: string, values: number[]): number | null {
  if (name === "COUNT") return values.length;
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

function evalExpr(e: Expr, ctx: EvalContext): number | null {
  switch (e.kind) {
    case "num":
      return e.value;
    case "var":
      return ctx.value(e.name);
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
    const values: (number | null)[] = [];
    for (let r = 0; r < data.rows.length; r++) {
      // A calculated input reads its computed values; a plain one reads the
      // table (excluded cells read as blank — readTable already applies them).
      const rowCtx: EvalContext = {
        value: (dep) => {
          const done = computed.get(dep);
          if (done) return done[r] ?? null;
          return byName.get(dep)?.byRow[r] ?? null;
        },
        values: (dep) => {
          const done = computed.get(dep);
          if (done) return done.filter((v): v is number => v != null);
          return byName.get(dep)?.values ?? [];
        },
      };
      values.push(evalExpr(ast, rowCtx));
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

/** Renames the variable in a formula: a bare `Old` becomes `New`, and a
 *  bracketed `[Old]` becomes `[New]`. A function call named `Old` is left
 *  alone (a column is never a function), and so is text inside brackets
 *  that is not the whole name. */
export function renameVariableInFormula(formula: string, oldName: string, newName: string): string {
  if (oldName === newName) return formula;
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
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i))!;
      const word = m[0];
      const after = formula[i + word.length];
      out += word === oldName && after !== "(" ? newName : word;
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
