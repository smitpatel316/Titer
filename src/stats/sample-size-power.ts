// "Sample size & power" (seq 207, 1.8.3): Prism's sample-size/power tool
// as a LOCAL desktop tool, per Smit's Nov 22 decision (the computation is
// pure math with no server dependency, so Prism's Cloud delivery is Prism's
// choice, not a requirement — nothing here touches the network).
//
// A guided calculator, not a table analysis: pick a test, pick what to
// solve for (sample size / power / minimum detectable effect), enter the
// other parameters + alpha (default 0.05) + two-sided/one-sided. v1 tests
// are the Prism Cloud set's core: one-sample t, two-sample t (equal
// variance + Welch), paired t, one-way ANOVA, Pearson correlation, one
// proportion, chi-square (2×2 + goodness-of-fit). Two-way/three-way ANOVA
// power, survival power, non-inferiority/equivalence and simulations are
// out of scope (Monte Carlo is seq 204).
//
// Engine: power from the noncentral t / F / chi-square CDFs in
// ./distributions (AS 243 for the noncentral t, Poisson-mixture series
// for the noncentral F / chi-square), the normal CDF for the Fisher-z and
// arcsine transforms; n and the effect are solved by bisection on the
// monotone power function. No new dependency, no R. The pin tests
// (tests/sample-size-power.ts) check every test against the R pwr package
// reference values to 3 decimals, each solved once for n, once for power
// and once for the effect.
import {
  centralChiSquareQuantile,
  centralFQuantile,
  centralTQuantile,
  noncentralChiSquareCdf,
  noncentralFCdf,
  noncentralTCdf,
  normalCdf,
  normalQuantile,
} from "./distributions";

/** The v1 tests. */
export const SAMPLE_SIZE_TESTS = [
  "one-sample-t",
  "two-sample-t",
  "welch-t",
  "paired-t",
  "one-way-anova",
  "pearson-correlation",
  "one-proportion",
  "chi-square",
] as const;
export type SampleSizeTest = (typeof SAMPLE_SIZE_TESTS)[number];

/** What the tool solves for: the other two of (n, power, effect) are inputs. */
export type SolveFor = "n" | "power" | "effect";

/** Two-sided (default) or one-sided. Chi-square and one-way ANOVA are
 *  upper-tail tests by construction, so the alternative is accepted but
 *  does not change their power. */
export type SampleSizeAlternative = "two-sided" | "one-sided";

/** Parameters for one sample-size/power computation. `n` is per-group n
 *  for the t tests and one-way ANOVA, plain n for correlation and one
 *  proportion, and total N for chi-square. `effect` is d (t tests), f
 *  (ANOVA), r (correlation), h (one proportion) or w (chi-square); a
 *  one-proportion effect can also be given as the proportions p0/p1, from
 *  which h = 2·asin√p1 − 2·asin√p0 is derived. */
export interface SampleSizeParams {
  test: SampleSizeTest;
  solveFor: SolveFor;
  alpha?: number;
  alternative?: SampleSizeAlternative;
  effect?: number;
  n?: number;
  power?: number;
  groups?: number;
  chiSquareDf?: number;
  categories?: number;
  sdRatio?: number;
  p0?: number;
  p1?: number;
}

/** The solved answer: the exact n (fractional, as R pwr reports it) and
 *  its rounded-up whole number, the achieved power at each, the effect,
 *  the power curve (power vs n, including the exact solved n as a point),
 *  and the plain-language line. */
export interface SampleSizeResult {
  test: SampleSizeTest;
  solveFor: SolveFor;
  alpha: number;
  alternative: SampleSizeAlternative;
  effect: number;
  n: number;
  nRounded: number;
  power: number;
  powerAtRoundedN: number;
  nLabel: string;
  effectLabel: string;
  groups?: number;
  chiSquareDf?: number;
  sdRatio?: number;
  /** The test's degrees of freedom at the solved n: the t df, the ANOVA
   *  residual df, or the chi-square df. */
  df?: number;
  curve: { n: number[]; power: number[] };
  solvedN: number;
  solvedPower: number;
  plainLanguage: string;
}

const TEST_LABEL: Record<SampleSizeTest, string> = {
  "one-sample-t": "one-sample t test",
  "two-sample-t": "two-sample t test",
  "welch-t": "Welch two-sample t test",
  "paired-t": "paired t test",
  "one-way-anova": "one-way ANOVA",
  "pearson-correlation": "Pearson correlation",
  "one-proportion": "one-proportion test",
  "chi-square": "chi-square test",
};

const EFFECT_LABEL: Record<SampleSizeTest, string> = {
  "one-sample-t": "d",
  "two-sample-t": "d",
  "welch-t": "d",
  "paired-t": "d",
  "one-way-anova": "f",
  "pearson-correlation": "r",
  "one-proportion": "h",
  "chi-square": "w",
};

/** The x-axis label for the power curve (and the n phrase): per-group n
 *  for the t tests and ANOVA, pairs for the paired t, plain n for
 *  correlation / one proportion, total N for chi-square. */
const N_LABEL: Record<SampleSizeTest, string> = {
  "one-sample-t": "n",
  "two-sample-t": "n per group",
  "welch-t": "n per group",
  "paired-t": "n pairs",
  "one-way-anova": "n per group",
  "pearson-correlation": "n",
  "one-proportion": "n",
  "chi-square": "Total N",
};

/** Minimum n for each test (the smallest n the power function is defined
 *  at: df ≥ 1 for the t tests, n − 3 ≥ 1 for the Fisher z). */
const MIN_N: Record<SampleSizeTest, number> = {
  "one-sample-t": 2,
  "two-sample-t": 2,
  "welch-t": 2,
  "paired-t": 2,
  "one-way-anova": 2,
  "pearson-correlation": 4,
  "one-proportion": 2,
  "chi-square": 2,
};

/** An effect above this is never the answer (the solver stops here). */
const EFFECT_CAP: Record<SampleSizeTest, number> = {
  "one-sample-t": 10,
  "two-sample-t": 10,
  "welch-t": 10,
  "paired-t": 10,
  "one-way-anova": 10,
  "pearson-correlation": 0.999999,
  "one-proportion": Math.PI,
  "chi-square": 10,
};

// ── Validation (the frontend validator is the authority on ranges, as
//    with simulate-data — the MCP tool in Rust checks only the enums) ─────

function fail(message: string): never {
  throw new Error(message);
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} must be a number (got ${String(value)})`);
  return value;
}

/** The validated parameters, with defaults filled in. Throws with a
 *  plain message naming the bad field — never a made-up number. */
/** JSON has no `undefined`: a value that crossed the Rust→JS boundary
 *  arrives as `null` when the caller omitted it (the Rust dispatcher
 *  serializes omitted `Option`s as null). Treat both as absent — the
 *  validator is the authority on params, and every JSON caller speaks
 *  null. (Seq 207 Mac proof failure, Nov 23 2026: the MCP tool rejected
 *  its own documented minimal call with "alpha must be a number (got
 *  null)" because only `undefined` counted as absent.) */
const absent = (v: unknown): boolean => v === undefined || v === null;

export function validateSampleSizeParams(params: unknown): SampleSizeParams {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    fail("sample-size params must be an object");
  }
  const p = params as Record<string, unknown>;
  const test = p.test;
  if (typeof test !== "string" || !(SAMPLE_SIZE_TESTS as readonly string[]).includes(test)) {
    fail(`Unknown sample-size test "${String(test)}" — the tests are ${SAMPLE_SIZE_TESTS.join(", ")}.`);
  }
  const solveFor = p.solveFor;
  if (solveFor !== "n" && solveFor !== "power" && solveFor !== "effect") {
    fail(`Unknown solve_for "${String(solveFor)}" — solve for n, power or effect.`);
  }
  const alpha = absent(p.alpha) ? 0.05 : asNumber(p.alpha, "alpha");
  if (alpha <= 0 || alpha >= 1) fail(`alpha must be between 0 and 1 (got ${alpha})`);
  const alternative = absent(p.alternative) ? "two-sided" : p.alternative;
  if (alternative !== "two-sided" && alternative !== "one-sided") {
    fail(`Unknown alternative "${String(alternative)}" — two-sided or one-sided.`);
  }
  const out: SampleSizeParams = { test: test as SampleSizeTest, solveFor, alpha, alternative };
  // The effect: explicit, or derived from p0/p1 for one proportion — never both.
  const hasEffect = !absent(p.effect);
  const hasProportions = !absent(p.p0) || !absent(p.p1);
  if (test === "one-proportion" && hasProportions) {
    if (hasEffect) fail("one-proportion: pass effect (h) or p0/p1, not both");
    const p0 = asNumber(p.p0, "p0");
    const p1 = asNumber(p.p1, "p1");
    if (p0 < 0 || p0 > 1) fail(`p0 must be between 0 and 1 (got ${p0})`);
    if (p1 < 0 || p1 > 1) fail(`p1 must be between 0 and 1 (got ${p1})`);
    const h = Math.abs(2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p0)));
    if (h === 0) fail("one-proportion: p0 and p1 must differ (h = 0 has no power to solve for)");
    // Only the derived h carries forward: re-validating the output must
    // not see both an effect and the proportions it came from.
    out.effect = h;
  } else if (hasEffect) {
    out.effect = asNumber(p.effect, "effect");
  }
  if (!absent(p.n)) out.n = asNumber(p.n, "n");
  if (!absent(p.power)) out.power = asNumber(p.power, "power");
  if (!absent(p.groups)) out.groups = asNumber(p.groups, "groups");
  if (!absent(p.chiSquareDf)) out.chiSquareDf = asNumber(p.chiSquareDf, "chiSquareDf");
  if (!absent(p.categories)) out.categories = asNumber(p.categories, "categories");
  if (!absent(p.sdRatio)) out.sdRatio = asNumber(p.sdRatio, "sdRatio");

  // What each solve-for needs, and the ranges of what it got.
  if (solveFor !== "effect") {
    if (out.effect === undefined) {
      fail(
        test === "one-proportion"
          ? "one-proportion needs an effect (h), or both p0 and p1 — p1 is missing"
          : "effect is required (pass the effect size to solve from)",
      );
    }
    if (out.effect <= 0) fail(`effect (${EFFECT_LABEL[out.test]}) must be greater than 0 (got ${out.effect})`);
    if (out.test === "pearson-correlation" && out.effect >= 1) {
      fail(`effect (r) must be between 0 and 1 (got ${out.effect})`);
    }
    if (out.test === "one-proportion" && out.effect > Math.PI) {
      fail(`effect (h) must be at most π (got ${out.effect})`);
    }
  } else if (out.effect !== undefined && out.effect <= 0) {
    fail(`effect (${EFFECT_LABEL[out.test]}) must be greater than 0 (got ${out.effect})`);
  }
  if (solveFor !== "n") {
    if (out.n === undefined) fail("n is required (pass the sample size to solve from)");
  }
  if (solveFor !== "power") {
    if (out.power === undefined) fail("power is required (pass the target power to solve from)");
    if (out.power <= 0 || out.power >= 1) fail(`power must be between 0 and 1 (got ${out.power})`);
  }
  if (out.n !== undefined && out.n < MIN_N[out.test]) {
    fail(`n must be at least ${MIN_N[out.test]} for ${TEST_LABEL[out.test]} (got ${out.n})`);
  }
  if (out.test === "one-way-anova") {
    if (out.groups === undefined) fail("one-way ANOVA needs groups (the number of groups, at least 2)");
    if (!Number.isInteger(out.groups) || out.groups < 2) {
      fail(`groups must be a whole number of at least 2 (got ${out.groups})`);
    }
  }
  if (out.test === "chi-square") {
    if (out.chiSquareDf === undefined && out.categories === undefined) {
      fail("chi-square needs degrees of freedom: pass chiSquareDf (1 for a 2×2 table) or categories (2 or more)");
    }
    if (out.chiSquareDf !== undefined && (!Number.isInteger(out.chiSquareDf) || out.chiSquareDf < 1)) {
      fail(`chiSquareDf must be a whole number of at least 1 (got ${out.chiSquareDf})`);
    }
    if (out.categories !== undefined && (!Number.isInteger(out.categories) || out.categories < 2)) {
      fail(`categories must be a whole number of at least 2 (got ${out.categories})`);
    }
  }
  if (out.test === "welch-t") {
    const ratio = out.sdRatio ?? 1;
    if (ratio <= 0) fail(`SD ratio must be greater than 0 (got ${ratio})`);
    out.sdRatio = ratio;
  }
  return out;
}

// ── Power functions ───────────────────────────────────────────────────────

/** A t-test power function: the critical value from the central t, the
 *  power from the noncentral t at the test's df and noncentrality. */
function tPower(
  alpha: number,
  alternative: SampleSizeAlternative,
  dfAt: (n: number) => number,
  ncpAt: (n: number, effect: number) => number,
): (n: number, effect: number) => number {
  return (n, effect) => {
    const df = dfAt(n);
    const ncp = ncpAt(n, effect);
    if (alternative === "one-sided") {
      return 1 - noncentralTCdf(centralTQuantile(1 - alpha, df), df, ncp);
    }
    const tc = centralTQuantile(1 - alpha / 2, df);
    return 1 - noncentralTCdf(tc, df, ncp) + noncentralTCdf(-tc, df, ncp);
  };
}

/** A normal-approximation power function (Fisher z for correlation,
 *  arcsine for one proportion): z is the transformed effect times the
 *  sample-size factor. */
function normalPower(
  alpha: number,
  alternative: SampleSizeAlternative,
  zAt: (n: number, effect: number) => number,
): (n: number, effect: number) => number {
  return (n, effect) => {
    const z = zAt(n, effect);
    if (alternative === "one-sided") {
      return 1 - normalCdf(normalQuantile(1 - alpha) - z);
    }
    const zc = normalQuantile(1 - alpha / 2);
    return 1 - normalCdf(zc - z) + normalCdf(-zc - z);
  };
}

function powerFunction(p: SampleSizeParams): (n: number, effect: number) => number {
  const alpha = p.alpha ?? 0.05;
  const alternative = p.alternative ?? "two-sided";
  switch (p.test) {
    case "one-sample-t":
    case "paired-t":
      return tPower(
        alpha,
        alternative,
        (n) => n - 1,
        (n, d) => d * Math.sqrt(n),
      );
    case "two-sample-t":
      return tPower(
        alpha,
        alternative,
        (n) => 2 * n - 2,
        (n, d) => d * Math.sqrt(n / 2),
      );
    case "welch-t": {
      // Welch–Satterthwaite df for equal n per group and SD ratio r:
      // df = (r²+1)²/(r⁴+1) · (n−1); r = 1 is the equal-variance test.
      // The noncentrality is d·√(n/2) for any r, with d taken against the
      // pooled SD √((σ1²+σ2²)/2).
      const r = p.sdRatio ?? 1;
      return tPower(
        alpha,
        alternative,
        (n) => ((r * r + 1) * (r * r + 1)) / (r * r * r * r + 1) * (n - 1),
        (n, d) => d * Math.sqrt(n / 2),
      );
    }
    case "one-way-anova": {
      const k = p.groups ?? 2;
      return (n, f) => {
        const df1 = k - 1;
        const df2 = k * (n - 1);
        const lambda = n * k * f * f;
        return 1 - noncentralFCdf(centralFQuantile(1 - alpha, df1, df2), df1, df2, lambda);
      };
    }
    case "pearson-correlation":
      return normalPower(alpha, alternative, (n, r) => Math.atanh(r) * Math.sqrt(n - 3));
    case "one-proportion":
      return normalPower(alpha, alternative, (n, h) => h * Math.sqrt(n));
    case "chi-square": {
      const df = p.chiSquareDf ?? (p.categories ?? 2) - 1;
      return (n, w) => {
        const xc = centralChiSquareQuantile(1 - alpha, df);
        return 1 - noncentralChiSquareCdf(xc, df, n * w * w);
      };
    }
  }
}

/** The test's degrees of freedom at n (for the result's detail line). */
function dfAt(p: SampleSizeParams, n: number): number {
  switch (p.test) {
    case "one-sample-t":
    case "paired-t":
      return n - 1;
    case "two-sample-t":
      return 2 * n - 2;
    case "welch-t": {
      const r = p.sdRatio ?? 1;
      return ((r * r + 1) * (r * r + 1)) / (r * r * r * r + 1) * (n - 1);
    }
    case "one-way-anova":
      return (p.groups ?? 2) * (n - 1);
    case "chi-square":
      return p.chiSquareDf ?? (p.categories ?? 2) - 1;
    default:
      return NaN;
  }
}

// ── Solvers (bisection on the monotone power function) ───────────────────

/** Bisection on f (increasing, f(lo) < 0 < f(hi)): ~200 halvings, or until
 *  the bracket is 1e-12 wide. */
function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (a + b);
    if (f(mid) < 0) a = mid;
    else b = mid;
    if (b - a < 1e-12 * Math.max(1, Math.abs(mid))) break;
  }
  return 0.5 * (a + b);
}

function solveN(powerAtN: (n: number) => number, target: number, minN: number): number {
  if (powerAtN(minN) >= target) return minN;
  let hi = Math.max(minN * 2, 10);
  while (powerAtN(hi) < target) {
    hi *= 2;
    if (hi > 1e7) fail(`target power ${target} is not reachable with n up to 10,000,000`);
  }
  return bisect((n) => powerAtN(n) - target, minN, hi);
}

function solveEffect(powerAtEffect: (e: number) => number, target: number, cap: number): number {
  let hi = 0.1;
  while (powerAtEffect(hi) < target) {
    hi *= 2;
    if (hi >= cap) fail(`target power ${target} is not reachable with an effect up to ${cap}`);
  }
  return bisect((e) => powerAtEffect(e) - target, 0, hi);
}

// ── Power curve + plain language ──────────────────────────────────────────

/** Power vs n around the solved n: whole-number n from half the solved n
 *  to twice it (at most ~100 points, stepping when the range is wide),
 *  plus the exact solved n as its own point — so the curve passes through
 *  the solved value at the solved n. */
function powerCurve(
  powerAtN: (n: number) => number,
  solvedN: number,
  minN: number,
): { n: number[]; power: number[] } {
  let lo = Math.max(minN, Math.floor(solvedN / 2));
  let hi = Math.ceil(solvedN * 2);
  if (hi - lo < 20) hi = lo + 20;
  const step = hi - lo <= 120 ? 1 : Math.ceil((hi - lo) / 100);
  const ns: number[] = [];
  for (let n = lo; n <= hi; n += step) ns.push(n);
  if (!ns.includes(solvedN)) {
    ns.push(solvedN);
    ns.sort((a, b) => a - b);
  }
  return { n: ns, power: ns.map(powerAtN) };
}

function fmtNum(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

function fmtPct(p: number): string {
  const v = Math.round(p * 1000) / 10;
  return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}%`;
}

/** The n phrase for the plain-language line: "n = 64 per group",
 *  "n = 34 pairs", "n = 45 per group (4 groups)", "N = 88 total". */
function nPhrase(p: SampleSizeParams, nRounded: number): string {
  switch (p.test) {
    case "paired-t":
      return `n = ${nRounded} pairs`;
    case "one-way-anova":
      return `n = ${nRounded} per group (${p.groups} groups)`;
    case "chi-square":
      return `N = ${nRounded} total`;
    default:
      return N_LABEL[p.test] === "n per group" ? `n = ${nRounded} per group` : `n = ${nRounded}`;
  }
}

/** The parenthetical for the plain-language line: the sidedness (t tests,
 *  correlation, one proportion only — ANOVA and chi-square are upper-tail
 *  by construction), the test, and the chi-square df / Welch SD ratio. */
function testPhrase(p: SampleSizeParams): string {
  const sided =
    p.test === "one-way-anova" || p.test === "chi-square" ? "" : `${p.alternative ?? "two-sided"} `;
  const extra =
    p.test === "chi-square"
      ? `, df = ${p.chiSquareDf ?? (p.categories ?? 2) - 1}`
      : p.test === "welch-t" && (p.sdRatio ?? 1) !== 1
        ? `, SD ratio ${fmtNum(p.sdRatio ?? 1)}`
        : "";
  return `(${sided}${TEST_LABEL[p.test]}${extra})`;
}

function plainLanguage(r: SampleSizeResult, p: SampleSizeParams): string {
  const n = nPhrase(p, r.nRounded);
  const effect = `${EFFECT_LABEL[p.test]} = ${fmtNum(r.effect)}`;
  const alpha = `α = ${fmtNum(p.alpha ?? 0.05)}`;
  const phrase = testPhrase(p);
  if (p.solveFor === "n") {
    return `${n} detects ${effect} with ${fmtPct(r.power)} power at ${alpha} ${phrase}.`;
  }
  if (p.solveFor === "power") {
    return `With ${n.toLowerCase()}, ${effect} gives ${fmtPct(r.power)} power at ${alpha} ${phrase}.`;
  }
  return `With ${n.toLowerCase()}, the smallest detectable effect is ${effect} at ${fmtPct(r.power)} power, ${alpha} ${phrase}.`;
}

// ── Entry point ───────────────────────────────────────────────────────────

/** Solve one sample-size/power computation: validate, solve for n / power
 *  / effect, build the power curve and the plain-language line. */
export function solveSampleSizePower(params: SampleSizeParams): SampleSizeResult {
  const p = validateSampleSizeParams(params);
  const powerAt = powerFunction(p);
  const minN = MIN_N[p.test];
  let n: number;
  let effect: number;
  let power: number;
  if (p.solveFor === "n") {
    effect = p.effect!;
    n = solveN((nn) => powerAt(nn, effect), p.power!, minN);
    power = powerAt(n, effect);
  } else if (p.solveFor === "power") {
    n = p.n!;
    effect = p.effect!;
    power = powerAt(n, effect);
  } else {
    n = p.n!;
    effect = solveEffect((e) => powerAt(n, e), p.power!, EFFECT_CAP[p.test]);
    power = powerAt(n, effect);
  }
  const nRounded = Math.ceil(n - 1e-12);
  const curve = powerCurve((nn) => powerAt(nn, effect), n, minN);
  const result: SampleSizeResult = {
    test: p.test,
    solveFor: p.solveFor,
    alpha: p.alpha ?? 0.05,
    alternative: p.alternative ?? "two-sided",
    effect,
    n,
    nRounded,
    power,
    powerAtRoundedN: powerAt(nRounded, effect),
    nLabel: N_LABEL[p.test],
    effectLabel: EFFECT_LABEL[p.test],
    curve,
    solvedN: n,
    solvedPower: power,
    plainLanguage: "",
  };
  if (p.test === "one-way-anova") result.groups = p.groups;
  if (p.test === "chi-square") result.chiSquareDf = p.chiSquareDf ?? (p.categories ?? 2) - 1;
  if (p.test === "welch-t") result.sdRatio = p.sdRatio ?? 1;
  const df = dfAt(p, n);
  if (Number.isFinite(df)) result.df = df;
  result.plainLanguage = plainLanguage(result, p);
  return result;
}
