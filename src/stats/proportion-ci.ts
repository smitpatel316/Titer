// 95% confidence intervals of a proportion (Prism's "Confidence interval
// of a proportion", offered by Fraction of Total): Wilson/Brown — Prism's
// recommendation — or Clopper–Pearson, the exact interval. Pure TypeScript,
// no R round trip, so the values pin directly against SciPy in
// tests/checks.ts. A proportion is x successes in n trials: the
// fraction-of-total caller passes the original value as x and the total it
// divided by as n. A value that is not a proportion of its total (below 0,
// above the total, or a non-positive total) has no interval — null, never
// NaN. Both intervals are 95%; Prism offers no level choice.
import type { FractionOfTotalCI } from "./types";

/** The two-sided 95% z value, qnorm(0.975) — the same constant R's Wilson
 *  helper in chi-square.ts uses. */
const Z_95 = 1.959963984540054;

/** Whether x out of n is a proportion at all: a finite count of successes
 *  between 0 and a positive number of trials. Non-integer counts still
 *  qualify — the formulae are defined for real x and n. */
const isProportion = (x: number, n: number) =>
  Number.isFinite(x) && Number.isFinite(n) && n > 0 && x >= 0 && x <= n;

/** Wilson score interval (Wilson 1927; Brown, Cai & DasGupta's
 *  recommendation, which is why Prism lists it first). Closed form:
 *  centre (p + z²/2n) / (1 + z²/n), half-width
 *  z·√(p(1−p)/n + z²/4n²) / (1 + z²/n), clamped to [0, 1]. */
export function wilsonCI(x: number, n: number): [number, number] | null {
  if (!isProportion(x, n)) return null;
  const p = x / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z_95 * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

// ── Clopper–Pearson: the exact interval needs Beta quantiles ──────────
// Lanczos log-Gamma (g = 7, the Numerical Recipes coefficients), the
// continued-fraction incomplete Beta, and a bisection inverse — the same
// construction Numerical Recipes' `betai`/`betacf` use, with bisection
// instead of Newton so the inverse cannot diverge on a flat tail.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const zz = z - 1;
  let x = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i++) x += LANCZOS[i] / (zz + i);
  const t = zz + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaCf(a: number, b: number, x: number): number {
  const MAX_ITER = 200;
  const EPS = 3e-14;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** The regularized incomplete Beta I_x(a, b), for a, b > 0 and 0 ≤ x ≤ 1. */
export function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaCf(a, b, x)) / a;
  return 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

/** The Beta quantile: the q with I_q(a, b) = p. Bisection on [0, 1] — 80
 *  rounds shrink the bracket past double precision, and the inverse can
 *  never diverge the way a Newton step can on a flat Beta tail. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (incompleteBeta(a, b, mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Clopper–Pearson exact interval: [qbeta(α/2, x, n−x+1),
 *  qbeta(1−α/2, x+1, n−x)] at α = 0.05, with the edges pinned — 0
 *  successes has lower bound 0, n successes upper bound 1 (the Beta
 *  quantile is undefined at a = 0, so the edges are handled, not fudged). */
export function clopperPearsonCI(x: number, n: number): [number, number] | null {
  if (!isProportion(x, n)) return null;
  const low = x === 0 ? 0 : betaQuantile(0.025, x, n - x + 1);
  const high = x === n ? 1 : betaQuantile(0.975, x + 1, n - x);
  return [low, high];
}

/** The requested 95% CI of the proportion x / n, or null when x is not a
 *  proportion of n. "none" is not an interval — the caller never asks for
 *  one, but a stale saved param still gets null instead of a crash. */
export function proportionCI(
  method: FractionOfTotalCI,
  x: number,
  n: number,
): [number, number] | null {
  if (method === "wilson") return wilsonCI(x, n);
  if (method === "clopper-pearson") return clopperPearsonCI(x, n);
  return null;
}
