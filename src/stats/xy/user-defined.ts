// User-defined equations for nonlinear regression (v2 item 23): the user types their own
// equation with named parameters and starting values — e.g. `Y = A*exp(-k*X) + C` — and
// the curve fitter fits it like a built-in model. Prism's "User-defined equations" are
// the same idea (an equation in X with named parameters and initial values); this is a
// clean-room implementation of that behaviour, not a port of Prism's code.
//
// The equation is parsed once, here, into an AST. The AST is then rendered three ways:
// as the R expression nls() fits (`x` is the data's X, parameters are bare R variables),
// as the R curve function `g(xv, p)` the confidence band and interpolation invert, and
// as a TypeScript evaluator the graph overlay draws from. One parser, so the three can
// never disagree about what the equation means.
//
// Allowed: numbers (including scientific notation), `X`, named parameters, `+ - * / ^`,
// parentheses, unary minus, and the functions below (`log` is the natural log, as in R;
// `ln` is an alias for it). `pi` is the constant. Everything else is rejected —
// assignments, semicolons, `$`, quotes, `::`, unknown identifiers — so a user equation
// can never smuggle arbitrary R into the fit.
import type { ModelSpec } from "./nonlinear-fit";

/** The functions a user equation may call. `ln` renders as R's `log`. */
const FUNCTIONS: Record<
  string,
  | "log"
  | "log10"
  | "log2"
  | "exp"
  | "sqrt"
  | "abs"
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "sinh"
  | "cosh"
  | "tanh"
  | "expm1"
  | "log1p"
> = {
  exp: "exp",
  log: "log",
  ln: "log",
  log10: "log10",
  log2: "log2",
  sqrt: "sqrt",
  abs: "abs",
  sin: "sin",
  cos: "cos",
  tan: "tan",
  asin: "asin",
  acos: "acos",
  atan: "atan",
  sinh: "sinh",
  cosh: "cosh",
  tanh: "tanh",
  expm1: "expm1",
  log1p: "log1p",
};

/** Names a parameter may not take. Only three things are real collisions: `x`/`y` are
 *  the data variables (a parameter of that name would make the formula's X/Y refer to
 *  the parameter, not the data), and `pi` is the constant (a parameter of that name is
 *  indistinguishable from it). Everything else the fit binds (`m`, `w`, `s`, `cf`, …)
 *  lives at R's top level, while the parameters live inside nls()'s own environment —
 *  the formula resolves a name to the parameter first, so a parameter named `C` or `k`
 *  is safe. (Capital `S` is also out: `fitEntries` gives the term "S" a log-scale CI,
 *  the 5PL asymmetry's treatment, which is wrong for a general parameter.) Compared
 *  case-insensitively, except `S`, which is exact. */
const RESERVED = new Set(["x", "y", "pi"]);

/** R's reserved words and special constants (?Reserved): a parameter of
 *  one of these names emits invalid R — `start=list(Inf=100, Kd=5)` fails
 *  to parse with `unexpected '='`, and a formula naming `TRUE` or `NA`
 *  reads the constant, not the parameter. Compared exactly as written:
 *  R's keywords are case-sensitive, so `true` or `for2` are fine names. */
const R_RESERVED = new Set([
  "if",
  "else",
  "repeat",
  "while",
  "function",
  "for",
  "in",
  "next",
  "break",
  "TRUE",
  "FALSE",
  "NULL",
  "Inf",
  "NaN",
  "NA",
  "NA_integer_",
  "NA_real_",
  "NA_complex_",
  "NA_character_",
]);

export type ExprNode =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string }
  | { kind: "const"; name: "pi" }
  | { kind: "neg"; arg: ExprNode }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: ExprNode; right: ExprNode }
  | { kind: "call"; fn: string; arg: ExprNode };

type Token =
  { kind: "num"; value: number; text: string } | { kind: "ident"; name: string } | { kind: "op"; op: string };

function tokenize(input: string): Token[] | { error: string } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const m = input.slice(i).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (!m) return { error: `“${ch}” is not a number — enter a number like 1.5 or 2e-3.` };
      const value = Number(m[0]);
      if (!Number.isFinite(value)) return { error: `“${m[0]}” is not a finite number.` };
      tokens.push({ kind: "num", value, text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = input.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      tokens.push({ kind: "ident", name: m[0] });
      i += m[0].length;
      continue;
    }
    if ("+-*/^(),".includes(ch)) {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    return {
      error: `“${ch}” is not allowed in an equation — use numbers, X, parameter names, + - * / ^, parentheses, and functions like exp() or log().`,
    };
  }
  return tokens;
}

/** Recursive-descent parser: `+ -` < `* /` < unary minus < `^` (right-associative) < primary. */
function parseTokens(tokens: Token[]): ExprNode | { error: string } {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (t: Token | undefined, op: string): t is Extract<Token, { kind: "op" }> =>
    t?.kind === "op" && t.op === op;
  const parseExpr = (): ExprNode | { error: string } => {
    let left = parseTerm();
    if ("error" in left) return left;
    while (isOp(peek(), "+") || isOp(peek(), "-")) {
      const op = (next() as Extract<Token, { kind: "op" }>).op as "+" | "-";
      const right = parseTerm();
      if ("error" in right) return right;
      left = { kind: "bin", op, left, right };
    }
    return left;
  };
  const parseTerm = (): ExprNode | { error: string } => {
    let left = parseUnary();
    if ("error" in left) return left;
    while (isOp(peek(), "*") || isOp(peek(), "/")) {
      const op = (next() as Extract<Token, { kind: "op" }>).op as "*" | "/";
      const right = parseUnary();
      if ("error" in right) return right;
      left = { kind: "bin", op, left, right };
    }
    return left;
  };
  const parseUnary = (): ExprNode | { error: string } => {
    if (isOp(peek(), "-")) {
      next();
      const arg = parseUnary();
      if ("error" in arg) return arg;
      return { kind: "neg", arg };
    }
    if (isOp(peek(), "+")) {
      next();
      return parseUnary();
    }
    return parsePower();
  };
  const parsePower = (): ExprNode | { error: string } => {
    const base = parsePrimary();
    if ("error" in base) return base;
    if (isOp(peek(), "^")) {
      next();
      const exp = parseUnary();
      if ("error" in exp) return exp;
      return { kind: "bin", op: "^", left: base, right: exp };
    }
    return base;
  };
  const parsePrimary = (): ExprNode | { error: string } => {
    const t = next();
    if (!t) return { error: "The equation ends unexpectedly — check for a missing value or closing parenthesis." };
    if (t.kind === "num") return { kind: "num", value: t.value };
    if (t.kind === "op" && t.op === "(") {
      const inner = parseExpr();
      if ("error" in inner) return inner;
      const close = next();
      if (!close || close.kind !== "op" || close.op !== ")")
        return { error: "A parenthesis is not closed — add a “)” to match the “(”." };
      return inner;
    }
    if (t.kind === "ident") {
      const lower = t.name.toLowerCase();
      if (isOp(peek(), "(")) {
        if (!Object.hasOwn(FUNCTIONS, lower))
          return {
            error: `“${t.name}” is not a function this equation can call — use exp, log, log10, log2, sqrt, abs, sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, expm1 or log1p.`,
          };
        next();
        const arg = parseExpr();
        if ("error" in arg) return arg;
        const close = next();
        if (!close || close.kind !== "op" || close.op !== ")")
          return { error: `“${t.name}(” is not closed — add a “)” after its argument.` };
        return { kind: "call", fn: lower, arg };
      }
      if (lower === "pi") return { kind: "const", name: "pi" };
      return { kind: "var", name: t.name };
    }
    return { error: `“${t.kind === "op" ? t.op : "?"}” does not belong here — check the equation around it.` };
  };
  const ast = parseExpr();
  if ("error" in ast) return ast;
  if (pos < tokens.length) {
    const extra = tokens[pos];
    return {
      error:
        extra.kind === "op" && extra.op === ","
          ? "Commas do not belong in an equation — every function here takes one argument."
          : `“${extra.kind === "num" ? extra.text : extra.kind === "ident" ? extra.name : (extra as Extract<Token, { kind: "op" }>).op}” does not belong here — check the equation around it.`,
    };
  }
  return ast;
}

/** The parameter names an AST uses, in first-appearance order (`X` and `pi` excluded). */
function astParams(node: ExprNode, out: string[] = []): string[] {
  switch (node.kind) {
    case "var":
      if (node.name.toLowerCase() !== "x" && !out.includes(node.name)) out.push(node.name);
      break;
    case "neg":
      astParams(node.arg, out);
      break;
    case "bin":
      astParams(node.left, out);
      astParams(node.right, out);
      break;
    case "call":
      astParams(node.arg, out);
      break;
    default:
      break;
  }
  return out;
}

const rNum = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`Not a finite number: ${v}`);
  return String(v);
};

/** Render an AST as R. `xVar` is the R name for X (`x` in the fit, `xv` in the curve
 *  function); `param` renders a parameter (bare name in the fit, `p[["Name"]]` in the
 *  curve function). Parentheses everywhere: the user's precedence is the AST's, and
 *  R must not re-decide it. */
function renderR(node: ExprNode, xVar: string, param: (name: string) => string): string {
  switch (node.kind) {
    case "num":
      return rNum(node.value);
    case "var":
      return node.name.toLowerCase() === "x" ? xVar : param(node.name);
    case "const":
      return "pi";
    case "neg":
      return `(-${renderR(node.arg, xVar, param)})`;
    case "bin":
      return `(${renderR(node.left, xVar, param)}${node.op}${renderR(node.right, xVar, param)})`;
    case "call":
      return `${FUNCTIONS[node.fn]}(${renderR(node.arg, xVar, param)})`;
  }
}

/** Evaluate an AST in TypeScript (the graph overlay), from the fitted coefficients. */
export function evaluateAst(node: ExprNode, x: number, values: Record<string, number>): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var":
      return node.name.toLowerCase() === "x" ? x : (values[node.name] ?? NaN);
    case "const":
      return Math.PI;
    case "neg":
      return -evaluateAst(node.arg, x, values);
    case "bin": {
      const l = evaluateAst(node.left, x, values);
      const r = evaluateAst(node.right, x, values);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return l / r;
        case "^":
          return l ** r;
      }
      break;
    }
    case "call": {
      const a = evaluateAst(node.arg, x, values);
      switch (FUNCTIONS[node.fn]) {
        case "exp":
          return Math.exp(a);
        case "log":
          return Math.log(a);
        case "log10":
          return Math.log10(a);
        case "log2":
          return Math.log2(a);
        case "sqrt":
          return Math.sqrt(a);
        case "abs":
          return Math.abs(a);
        case "sin":
          return Math.sin(a);
        case "cos":
          return Math.cos(a);
        case "tan":
          return Math.tan(a);
        case "asin":
          return Math.asin(a);
        case "acos":
          return Math.acos(a);
        case "atan":
          return Math.atan(a);
        case "sinh":
          return Math.sinh(a);
        case "cosh":
          return Math.cosh(a);
        case "tanh":
          return Math.tanh(a);
        case "expm1":
          return Math.expm1(a);
        case "log1p":
          return Math.log1p(a);
      }
      break;
    }
  }
}

export interface ParsedUserEquation {
  /** The parameters, in first-appearance order. */
  params: string[];
  /** The R right-hand side nls() fits (`x` is the data's X). */
  rExpr: string;
  /** The R curve function, `g<-function(xv,p) ...`. */
  curveFn: string;
  ast: ExprNode;
}

/** Parse a user equation (`Y = A*exp(-k*X) + C`, or just the right-hand side). An
 *  `error` is a plain user-facing message; a success names the parameters. */
export function parseUserEquation(equation: string): ParsedUserEquation | { error: string } {
  const raw = equation.trim();
  if (!raw) return { error: "Enter an equation, for example “Y = A*exp(-k*X) + C”." };
  // An optional `Y =` left-hand side (only Y — the equation is always Y as a function of X).
  let rhs = raw;
  const eqAt = raw.indexOf("=");
  if (eqAt >= 0) {
    const lhs = raw.slice(0, eqAt).trim();
    if (!/^y$/i.test(lhs))
      return {
        error: `“${lhs}” cannot be on the left of the equation — write it as “Y = …” with Y on the left, or enter just the right-hand side.`,
      };
    rhs = raw.slice(eqAt + 1).trim();
    if (rhs.includes("=")) return { error: "The equation has more than one “=” — write it as “Y = …” once." };
  }
  if (!rhs) return { error: "Enter the right-hand side of the equation, after “Y =”." };
  const tokens = tokenize(rhs);
  if ("error" in tokens) return tokens;
  if (!tokens.length) return { error: "Enter the right-hand side of the equation, after “Y =”." };
  const ast = parseTokens(tokens);
  if ("error" in ast) return ast;
  const params = astParams(ast);
  if (!params.length)
    return {
      error: "The equation has no parameters to fit — it must name at least one parameter, for example A in “Y = A*X”.",
    };
  if (params.length > 12)
    return { error: `The equation has ${params.length} parameters — at most 12 can be fitted at once.` };
  const seen = new Set<string>();
  for (const p of params) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(p))
      return {
        error: `“${p}” is not a valid parameter name — start with a letter, then letters, digits or underscores.`,
      };
    if (RESERVED.has(p.toLowerCase()))
      return {
        error: `“${p}” cannot be a parameter name — it is already used by the fit itself. Rename it (for example, “${p}1”).`,
      };
    if (R_RESERVED.has(p))
      return {
        error: `“${p}” cannot be a parameter name — it is a reserved word in R. Rename it (for example, “${p}1”).`,
      };
    if (p === "S")
      return {
        error: `“S” cannot be a parameter name — it is the 5PL asymmetry's name, whose confidence interval is computed on its log. Rename it (for example, “S1”).`,
      };
    if (Object.hasOwn(FUNCTIONS, p.toLowerCase()))
      return { error: `“${p}” cannot be a parameter name — it is a function name. Rename it.` };
    if (seen.has(p.toLowerCase()))
      return {
        error: `“${p}” appears twice with different capitalisation — parameter names must differ by more than capitalisation.`,
      };
    seen.add(p.toLowerCase());
  }
  return {
    params,
    rExpr: renderR(ast, "x", (name) => name),
    curveFn: `g<-function(xv,p) ${renderR(ast, "xv", (name) => `p[["${name}"]]`)}`,
    ast,
  };
}

/** The `ModelSpec` for a user equation: nls() with the port optimizer (robust on the
 *  near-noiseless fits the exponential/enzyme models need it for), a Gauss–Newton
 *  retry, and the user's starting values. Throws a plain error when the equation or
 *  the starting values are wrong — the runner turns it into an outcome error. */
export function userDefinedSpec(equation: string, initials: Record<string, number>): ModelSpec {
  const parsed = parseUserEquation(equation);
  if ("error" in parsed) throw new Error(parsed.error);
  const missing = parsed.params.filter((p) => !Object.hasOwn(initials, p));
  if (missing.length)
    throw new Error(
      `Enter a starting value for every parameter — missing: ${missing.map((p) => `“${p}”`).join(", ")}.`,
    );
  const extra = Object.keys(initials).filter((p) => !parsed.params.includes(p));
  if (extra.length)
    throw new Error(
      `Starting value${extra.length === 1 ? "" : "s"} for ${extra.map((p) => `“${p}”`).join(", ")} — but the equation does not use ${extra.length === 1 ? "it" : "them"}. Remove ${extra.length === 1 ? "it" : "them"}, or add ${extra.length === 1 ? "it" : "them"} to the equation.`,
    );
  for (const p of parsed.params)
    if (!Number.isFinite(initials[p])) throw new Error(`The starting value for “${p}” must be a finite number.`);
  const start = parsed.params.map((p) => `${p}=${rNum(initials[p]!)}`).join(",");
  return {
    kind: "nls",
    fit: `m<-nls(y~${parsed.rExpr},start=list(${start}),algorithm="port",control=nls.control(maxiter=200))`,
    retryFits: [
      {
        fit: `m<-nls(y~${parsed.rExpr},start=list(${start}),control=nls.control(maxiter=200))`,
        method: "Gauss-Newton",
      },
    ],
    terms: parsed.params,
    curveFn: parsed.curveFn,
  };
}

/** Parse the wizard's starting-values text (`A=1, k=0.5, C=10`) against the equation's
 *  parameters: every parameter needs a value, and no value may name a parameter the
 *  equation does not use. */
export function parseCustomParameters(
  text: string,
  params: string[],
): { values: Record<string, number>; error?: string } {
  const entries = text
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (!entries.length)
    return {
      values: {},
      error: `Enter a starting value for every parameter — ${params.map((p) => `${p}=…`).join(", ")}.`,
    };
  const values: Record<string, number> = {};
  for (const e of entries) {
    const m = e.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!m)
      return {
        values: {},
        error: `“${e}” is not a starting value — write each one as “name=value”, for example “A=1”.`,
      };
    const [, name, raw] = m;
    if (!params.includes(name))
      return {
        values: {},
        error: `“${name}” is not a parameter of this equation — the parameters are ${params.join(", ")}.`,
      };
    if (Object.hasOwn(values, name))
      return { values: {}, error: `“${name}” has two starting values — enter one per parameter.` };
    const v = Number(raw);
    if (!Number.isFinite(v))
      return { values: {}, error: `The starting value for “${name}” (“${raw}”) is not a number.` };
    values[name] = v;
  }
  const missing = params.filter((p) => !Object.hasOwn(values, p));
  if (missing.length)
    return {
      values: {},
      error: `Enter a starting value for every parameter — missing: ${missing.map((p) => `“${p}”`).join(", ")}.`,
    };
  return { values };
}

/** Evaluate a user equation in TypeScript (the graph overlay), from the fitted
 *  coefficients keyed by parameter name. `NaN` when a parameter is missing. */
export function evaluateUserEquation(equation: string, values: Record<string, number>, x: number): number {
  const parsed = parseUserEquation(equation);
  if ("error" in parsed) return NaN;
  return evaluateAst(parsed.ast, x, values);
}
