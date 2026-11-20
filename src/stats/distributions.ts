// Statistical distributions for "plot-function" (seq 203): Prism's Plot a
// function plots the normal (z), Student's t, F and chi-square densities
// and the binomial + Poisson mass functions (GraphPad FAQ 1578). Pure
// TypeScript, no R: the densities need only the log-gamma function
// (Lanczos), and the checks pin them against Python's math.lgamma-derived
// values, plus the normalisation sums (a wrong log-gamma breaks those).
//
// Out-of-domain inputs return NaN (the plotter turns a non-finite value
// into a blank, never a made-up number): a negative x for F / chi-square,
// a non-integer k for the discrete mass functions, a non-positive SD /
// degrees of freedom / lambda, or a binomial p outside (0, 1). At x = 0
// the F and chi-square densities are handled explicitly — the log form
// would read 0 · log(0) — so df = 2 gives the finite value, df < 2 gives
// Infinity (the density diverges there), and df > 2 gives 0.

/** log Γ(z) by the Lanczos approximation (g = 7, the Numerical Recipes
 *  coefficients): ~1e-15 accurate for z > 0; the reflection formula covers
 *  0 < z < 0.5. At a non-positive integer Γ has a pole — NaN, never thrown. */
export function lgamma(z: number): number {
  if (!Number.isFinite(z)) return NaN;
  if (z < 0.5) {
    if (Number.isInteger(z)) return NaN;
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  }
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const zz = z - 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (zz + i);
  const t = zz + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** The normal (Gaussian) density at x: φ(x) = exp(−z²/2) / (SD·√(2π)). */
export function normalPdf(x: number, mean: number, sd: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !Number.isFinite(sd) || sd <= 0) return NaN;
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Student's t density at x, with df degrees of freedom. */
export function tPdf(x: number, df: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) return NaN;
  return (
    Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2)) /
    (Math.sqrt(df * Math.PI) * Math.pow(1 + (x * x) / df, (df + 1) / 2))
  );
}

/** The F density at x, with df1 numerator and df2 denominator degrees of
 *  freedom. At x = 0 the density is finite only for df1 = 2 (a constant),
 *  diverges for df1 < 2, and is 0 for df1 > 2. */
export function fPdf(x: number, df1: number, df2: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df1) || !Number.isFinite(df2) || df1 <= 0 || df2 <= 0) return NaN;
  if (x < 0) return NaN;
  if (x === 0) {
    if (df1 < 2) return Infinity;
    if (df1 > 2) return 0;
    return Math.exp(
      lgamma((df1 + df2) / 2) - lgamma(df1 / 2) - lgamma(df2 / 2) + (df1 / 2) * Math.log(df1 / df2),
    );
  }
  return Math.exp(
    lgamma((df1 + df2) / 2) -
      lgamma(df1 / 2) -
      lgamma(df2 / 2) +
      (df1 / 2) * Math.log(df1 / df2) +
      (df1 / 2 - 1) * Math.log(x) -
      ((df1 + df2) / 2) * Math.log(1 + (df1 * x) / df2),
  );
}

/** The chi-square density at x, with df degrees of freedom (a Gamma(df/2,
 *  scale 2)). At x = 0: df = 2 gives 1/2, df < 2 diverges, df > 2 is 0. */
export function chiSquarePdf(x: number, df: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) return NaN;
  if (x < 0) return NaN;
  if (x === 0) {
    if (df < 2) return Infinity;
    if (df > 2) return 0;
    return 0.5;
  }
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - lgamma(df / 2));
}

/** The binomial mass at k successes in n trials with success probability p. */
export function binomialPmf(k: number, n: number, p: number): number {
  if (
    !Number.isInteger(k) ||
    !Number.isInteger(n) ||
    !Number.isFinite(p) ||
    n < 1 ||
    p <= 0 ||
    p >= 1 ||
    k < 0 ||
    k > n
  )
    return NaN;
  return Math.exp(
    lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log(1 - p),
  );
}

/** The Poisson mass at k events with mean lambda. */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || !Number.isFinite(lambda) || lambda <= 0 || k < 0) return NaN;
  return Math.exp(-lambda + k * Math.log(lambda) - lgamma(k + 1));
}
