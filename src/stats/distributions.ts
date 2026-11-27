// Statistical distributions for "plot-function" (seq 203) and "sample size
// & power" (seq 207): Prism's Plot a function plots the normal (z),
// Student's t, F and chi-square densities and the binomial + Poisson mass
// functions (GraphPad FAQ 1578), and the power tool needs the CDFs and
// quantiles of the central distributions plus the noncentral t, F and
// chi-square CDFs. Pure TypeScript, no R: the densities need only the
// log-gamma function (Lanczos), the CDFs add the regularized incomplete
// beta (Numerical Recipes' continued fraction) and incomplete gamma
// (series + continued fraction), and the noncentral CDFs are the standard
// published algorithms — the noncentral t is Algorithm AS 243 (Lenth,
// Applied Statistics 38(1), 1989, as in R's pnt.c: a twin series over the
// incomplete beta), the noncentral F and chi-square are Poisson-mixture
// series over the central F / chi-square CDFs (Johnson, Kotz &
// Balakrishnan). The pin tests (tests/sample-size-power.ts) check them
// against SciPy and the published R pwr values.
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

// ── CDFs and quantiles (seq 207) ──────────────────────────────────────────

/** The regularized incomplete beta I_x(a, b), by Numerical Recipes'
 *  continued fraction (`betacf`): ~1e-14 accurate. NaN outside its domain. */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * incompleteBetaCf(x, a, b)) / a;
  return 1 - (bt * incompleteBetaCf(1 - x, b, a)) / b;
}

function incompleteBetaCf(x: number, a: number, b: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** The regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a), by
 *  Numerical Recipes' series (x < a+1) and continued fraction (x ≥ a+1).
 *  NaN outside its domain; P(a, 0) = 0. */
export function regularizedIncompleteGammaP(a: number, x: number): number {
  if (!Number.isFinite(a) || a <= 0) return NaN;
  if (Number.isNaN(x)) return NaN;
  // Bug 107 sibling: P(a, ∞) = 1 — the old guard returned NaN, and the
  // continued fraction below turns 0·∞ into NaN, so normalCdf (via
  // z²) and the noncentral t tail both came back NaN past |x| ≈ 1e154.
  if (x === Infinity) return 1;
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - regularizedIncompleteGammaQ(a, x);
}

/** The regularized upper incomplete gamma Q(a, x) = 1 − P(a, x), by
 *  Numerical Recipes' continued fraction. NaN outside its domain;
 *  Q(a, 0) = 1. */
export function regularizedIncompleteGammaQ(a: number, x: number): number {
  if (!Number.isFinite(a) || a <= 0) return NaN;
  if (Number.isNaN(x)) return NaN;
  // Bug 107 sibling: Q(a, ∞) = 0 (same NaN-through-the-fraction as P).
  if (x === Infinity) return 0;
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - regularizedIncompleteGammaP(a, x);
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** The standard normal CDF Φ(x), via erf(x/√2) = ±P(1/2, x²/2). */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const z = x / Math.SQRT2;
  const erf = z >= 0 ? regularizedIncompleteGammaP(0.5, z * z) : -regularizedIncompleteGammaP(0.5, z * z);
  return 0.5 * (1 + erf);
}

/** The standard normal quantile, by bisection on Φ: monotone, so the
 *  bracket doubles until it holds p, then 200 halvings pin it to ~1e-12.
 *  NaN for p outside (0, 1). */
export function normalQuantile(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return NaN;
  return bisectQuantile(normalCdf, p, -1, 1);
}

/** Student's t CDF at t, with df degrees of freedom, via the incomplete
 *  beta: F(t) = 1 − ½·I_{df/(df+t²)}(df/2, ½) for t > 0 (and symmetrically
 *  below 0). NaN for df ≤ 0. */
export function centralTCdf(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  if (t === 0) return 0.5;
  const x = df / (df + t * t);
  const ib = regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

/** The F CDF at x, with df1 numerator and df2 denominator degrees of
 *  freedom, via the incomplete beta. NaN outside its domain; 0 for x ≤ 0. */
export function centralFCdf(x: number, df1: number, df2: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df1) || !Number.isFinite(df2) || df1 <= 0 || df2 <= 0) return NaN;
  if (x <= 0) return 0;
  return regularizedIncompleteBeta((df1 * x) / (df2 + df1 * x), df1 / 2, df2 / 2);
}

/** The chi-square CDF at x, with df degrees of freedom: P(df/2, x/2).
 *  NaN outside its domain; 0 for x ≤ 0. */
export function centralChiSquareCdf(x: number, df: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df) || df <= 0) return NaN;
  if (x <= 0) return 0;
  return regularizedIncompleteGammaP(df / 2, x / 2);
}

/** Bisection on a monotone CDF: the bracket doubles until it holds p,
 *  then 200 halvings. Shared by the quantiles below. */
function bisectQuantile(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  let lower = lo;
  let upper = hi;
  while (cdf(upper) < p) {
    lower = upper;
    upper = upper < 0 ? upper * 2 : upper * 2 + 1;
    if (upper > 1e12) return upper;
  }
  while (cdf(lower) > p) {
    upper = lower;
    lower = lower > 0 ? lower / 2 : lower * 2 - 1;
    if (lower < -1e12) return lower;
  }
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lower + upper);
    if (cdf(mid) < p) lower = mid;
    else upper = mid;
  }
  return 0.5 * (lower + upper);
}

/** Student's t quantile, by bisection on the CDF. NaN for p outside (0, 1)
 *  or df ≤ 0. */
export function centralTQuantile(p: number, df: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(df) || df <= 0) return NaN;
  return bisectQuantile((t) => centralTCdf(t, df), p, -1, 1);
}

/** The F quantile, by bisection on the CDF (x ≥ 0, so the low bracket is
 *  0). NaN for p outside (0, 1) or non-positive degrees of freedom. */
export function centralFQuantile(p: number, df1: number, df2: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(df1) || !Number.isFinite(df2) || df1 <= 0 || df2 <= 0)
    return NaN;
  return bisectQuantile((x) => centralFCdf(x, df1, df2), p, 0, 1);
}

/** The chi-square quantile, by bisection on the CDF. NaN for p outside
 *  (0, 1) or df ≤ 0. */
export function centralChiSquareQuantile(p: number, df: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1 || !Number.isFinite(df) || df <= 0) return NaN;
  return bisectQuantile((x) => centralChiSquareCdf(x, df), p, 0, Math.max(1, df));
}

/** The noncentral t CDF at t, with df degrees of freedom and
 *  noncentrality delta — Algorithm AS 243 (Lenth 1989; R's pnt.c): a twin
 *  series over the incomplete beta, plus Φ(−δ). The twin series needs
 *  ~δ²/2 terms, so the iteration cap is 100,000 rather than R's 100: power
 *  analysis routinely carries δ past 10. The first Poisson weight
 *  ½·exp(−δ²/2) underflows to 0 past |δ| ≈ 38, so there (μ = δ²/2 > 700)
 *  the series is summed outward from the Poisson mode floor(μ) instead
 *  of upward from j = 0 — the anchored weights are O(1/√μ), the beta
 *  factors come from direct `regularizedIncompleteBeta` calls and the
 *  increments from their log forms, so neither the weights nor the
 *  (1−x)^(df/2) factor can underflow (bugs 63 + 80: the old log-space
 *  path still returned a bogus 1.0 at large df and cliffed to 0 past
 *  |δ| > 447). Past |δ| ≈ 1414 (μ > 1e6), or min(μ, df/2) ≥ 7e5, the
 *  series itself loses accuracy (bug 107) and the chi-square limit in
 *  `noncentralTChiSquareLimit` takes over instead. NaN outside its
 *  domain; δ = 0 is the central t. */
export function noncentralTCdf(t: number, df: number, delta: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || !Number.isFinite(delta) || df <= 0) return NaN;
  if (delta === 0) return centralTCdf(t, df);
  let tt = t;
  let del = delta;
  let negdel = false;
  if (t < 0) {
    negdel = true;
    tt = -tt;
    del = -del;
  }
  let tnc = 0;
  // Bug 107: x = t²/(t²+df) must not square t first — tt*tt overflows to
  // Infinity for |t| ≥ 1.34e154, giving x = NaN and silently skipping the
  // series (the CDF then came back as Φ(−δ) alone: 2.87e-7 for a true
  // 1.0). 1/(1+df/t²) is the same ratio, computed from df/tt², which
  // underflows gracefully to 0 (x = 1) instead of overflowing; tt = 0
  // still gives x = 0 (df/0 = ∞).
  const x = 1 / (1 + (df / tt) / tt);
  if (x > 0) {
    const absDel = Math.abs(del);
    // Bug 107, extreme regime: the twin series cannot be trusted here.
    // Three separate failures meet in this corner: (a) the mode-centred
    // weights lose ~1e-16·m·ln m in the m·log μ − lgamma(m+1)
    // cancellation (m = μ ≈ δ²/2) and the 5,000,000-step cap truncates
    // the mode peak mid-sum past |δ| ≳ 8e5 — nct(1e7; 100, 1e7) came
    // back 0.2276 for 0.4812; (b) incompleteBetaCf's MAXIT = 200 stops
    // converging once both a ≈ μ and b = df/2 pass ~7e5 (it returned
    // −0.018 for a beta factor at df = 1e8, δ = 1e5, so nct(1e5; 1e8,
    // 1e5) came back 0 for 0.500). The thresholds sit far inside the
    // safe region — the series is still accurate to ~1e-9 at |δ| = 500
    // and ~1e-10 at |δ| = 1414 (df ≤ 1e5), and the limit is accurate to
    // ~4e-5 at the boundary and ~3e-7 by |δ| = 1e5 — so the handoff has
    // no cliff. The |δ| check comes first so δ² is only formed when
    // |δ| ≤ 1414 (δ² ≤ 2e6 there; δ*δ itself overflows past
    // |δ| ≈ 1.34e154). The limit returns the full CDF; subtract Φ(−δ)
    // here because the shared tail below adds it back — in this regime
    // Φ(−δ) is exactly 0 (δ > 0) or exactly 1 (δ < 0), so this is exact.
    const mu = absDel > 1414.2135623730951 ? Infinity : 0.5 * del * del;
    if (mu === Infinity || (mu >= 7e5 && df >= 1.4e6)) {
      tnc = noncentralTChiSquareLimit(tt, df, del) - normalCdf(-del);
    } else if (mu > 700) {
      // Bugs 63 (remainder) + 80: past μ ≈ 710 the twin series must be
      // summed outward from the Poisson mode — see
      // `noncentralTTwinSeriesModeCentered` below. Summing upward from
      // j = 0 underflows twice (the first weight at |δ| ≳ 38, the beta
      // increment godd₀ = 2·(1−x)^(df/2)·… at large df, freezing I_x at 1
      // and returning a bogus 1.0) and the en ≤ 100000 cap cliffs to 0
      // past |δ| > 447. Past μ ~ 1e300 lgamma overflows, but there the
      // CDF is 0 or 1 to within 1e-300 and the Φ(−δ) term below already
      // gives exactly that.
      tnc = mu > 1e300 ? 0 : noncentralTTwinSeriesModeCentered(x, df, del, mu);
    } else {
      const lambda = 2 * mu;
      // The original linear recurrence, unchanged: below the threshold
      // nothing underflows, so results stay bit-identical to the region
      // that already worked.
      let p = 0.5 * Math.exp(-mu);
      let q = (Math.SQRT2 / Math.sqrt(Math.PI)) * p * del;
      let s = 0.5 - p;
      let a = 0.5;
      const b = 0.5 * df;
      const rxb = Math.pow(1 - x, b);
      const albeta = 0.5 * Math.log(Math.PI) + lgamma(b) - lgamma(a + b);
      let xodd = regularizedIncompleteBeta(x, a, b);
      let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
      let xeven = 1 - rxb;
      let geven = b * x * rxb;
      tnc = p * xodd + q * xeven;
      let en = 1;
      let errbd = Infinity;
      while (errbd > 1e-12 && en <= 100000) {
        a += 1;
        xodd -= godd;
        xeven -= geven;
        godd = (godd * x * (a + b - 1)) / a;
        geven = (geven * x * (a + b - 0.5)) / (a + 0.5);
        p = (p * lambda) / (2 * en);
        q = (q * lambda) / (2 * en + 1);
        s -= p;
        en += 1;
        tnc += p * xodd + q * xeven;
        errbd = 2 * s * (xodd - godd);
      }
    }
  }
  tnc += normalCdf(-del);
  if (negdel) tnc = 1 - tnc;
  return Math.min(1, Math.max(0, tnc));
}

/** The noncentral t CDF in the extreme regime (bug 107: |δ| > 1414, or
 *  min(μ, df/2) ≥ 7e5), where the AS 243 twin series loses accuracy.
 *  As |δ| → ∞ at fixed t/δ, T = (Z+δ)/S → δ/S, so for δ > 0
 *  F(t; ν, δ) → P(S ≥ δ/t) = P(χ²_ν ≥ ν(δ/t)²) = Q(ν/2, νδ²/2t²),
 *  and for δ < 0, F(t; ν, δ) = 1 − F(−t; ν, |δ|) with
 *  F(−t; ν, |δ|) = E[Φ(−tS − |δ|)] ≤ Φ(−|δ|) = 0 in double precision,
 *  so F = 1 exactly. The smoothing from Z is O(1/δ²): the limit is
 *  already within ~4e-5 of the true CDF at |δ| = 1414 and ~3e-7 by
 *  |δ| = 1e5 (Gauss–Hermite ground truth). The χ² tail itself is the
 *  exact regularized incomplete gamma while ν ≤ 20000 (the TS series
 *  is accurate to ~1e-12 there) and the Wilson–Hilferty normal
 *  approximation above it (accurate to ~1e-8 at ν = 1e4 and improving
 *  as 1/ν; the gamma series itself stops converging past a ≈ 1e5, so
 *  it cannot carry the large-ν tail). tt > 0 here (the caller only
 *  routes when x > 0). */
function noncentralTChiSquareLimit(tt: number, df: number, del: number): number {
  if (del < 0) return 1;
  const r = del / tt;
  if (df <= 20000) {
    const xArg = (df / 2) * r * r;
    if (!Number.isFinite(xArg)) return 0;
    return regularizedIncompleteGammaQ(df / 2, xArg);
  }
  // Wilson–Hilferty: (χ²_ν/ν)^(1/3) ≈ N(1 − 2/9ν, 2/9ν), so
  // P(χ²_ν > νr²) = 1 − Φ(((r²)^(1/3) − (1 − 2/9ν))/√(2/9ν)).
  const mu = 1 - 2 / (9 * df);
  const sd = Math.sqrt(2 / (9 * df));
  const z = (Math.cbrt(r * r) - mu) / sd;
  // df ≳ 1e307 underflows sd to 0 and z to NaN (r = 1, μ = 1); S → 1
  // almost surely there, so the CDF is the 0/1 step at r = 1.
  if (Number.isNaN(z)) return 0.5;
  return normalCdf(-z);
}

/** The AS 243 twin series for the noncentral t CDF in the large-μ regime
 *  (μ = δ²/2 > 700), summed outward from the Poisson mode m = floor(μ)
 *  instead of upward from j = 0. The twin series is
 *  Σ_j p_j·I_x(j+½, b) + Σ_j q_j·I_x(j+1, b), with p_j the halved Poisson
 *  weights ½·e^(−μ)·μ^j/j! and q_j = q_0·λ^j/(3·5·…·(2j+1)), λ = 2μ.
 *  Anchoring at the mode keeps every quantity representable: p_m and q_m
 *  are O(1/√μ) (computed from their log forms), the beta factors
 *  I_x(m+½, b) and I_x(m+1, b) come from direct
 *  `regularizedIncompleteBeta` calls — no (1−x)^(df/2) factor anywhere,
 *  so the large-df underflow that froze I_x at 1 and returned a bogus
 *  1.0 cannot happen — and the increments godd_m, geven_m come from
 *  their log forms (godd_j = x^(j+½)(1−x)^b/((j+½)·B(j+½, b)) and
 *  geven_j = x^(j+1)(1−x)^b/((j+1)·B(j+1, b))), exponentiated only when
 *  above the underflow floor. From the mode the recurrences run both
 *  ways with the same per-step factors as the j = 0 loop in
 *  `noncentralTCdf` (upward: godd × x(a+b)/(a+1), geven ×
 *  x(a+b+½)/(a+3/2), p × μ/j, q × 2μ/(2j+1); downward: the inverses).
 *  Both weights fall monotonically away from the mode on each side, so
 *  the sum stops once both are 1e-16 of their mode values — the omitted
 *  Poisson tail is then < ~1e-17, since every beta factor is in [0, 1] —
 *  with a 5,000,000-step safety cap per direction (reached only for
 *  |δ| ≳ 8·10⁵, far past any power-analysis input). */
function noncentralTTwinSeriesModeCentered(x: number, df: number, del: number, mu: number): number {
  const b = 0.5 * df;
  const m = Math.floor(mu);
  const logMu = Math.log(mu);
  const logX = Math.log(x);
  const log1mx = Math.log(1 - x);
  // log p_j = log(½) − μ + j·log μ − log j!.
  const logP = (j: number) => Math.log(0.5) - mu + j * logMu - lgamma(j + 1);
  // log |q_j| = log(√2/√π) + log|δ| + log p_j + 2j·ln 2 + 2·log j! − log(2j+1)!.
  const logQ = (j: number) =>
    Math.log(Math.SQRT2 / Math.sqrt(Math.PI)) +
    Math.log(Math.abs(del)) +
    logP(j) +
    2 * j * Math.LN2 +
    2 * lgamma(j + 1) -
    lgamma(2 * j + 2);
  // log godd_j / log geven_j, from the increment forms above.
  const logGodd = (j: number) =>
    (j + 0.5) * logX + b * log1mx - Math.log(j + 0.5) - lgamma(j + 0.5) - lgamma(b) + lgamma(j + 0.5 + b);
  const logGeven = (j: number) =>
    (j + 1) * logX + b * log1mx - Math.log(j + 1) - lgamma(j + 1) - lgamma(b) + lgamma(j + 1 + b);
  const pMode = Math.exp(logP(m));
  const qMode = Math.sign(del) * Math.exp(logQ(m));
  const xoddMode = regularizedIncompleteBeta(x, m + 0.5, b);
  const xevenMode = regularizedIncompleteBeta(x, m + 1, b);
  const logGoddMode = logGodd(m);
  const logGevenMode = logGeven(m);
  const goddMode = logGoddMode > -745 ? Math.exp(logGoddMode) : 0;
  const gevenMode = logGevenMode > -745 ? Math.exp(logGevenMode) : 0;

  let tnc = pMode * xoddMode + qMode * xevenMode;
  const pStop = 1e-16 * pMode;
  const qStop = 1e-16 * Math.max(Math.abs(qMode), pMode);
  const MAX_STEPS = 5000000;

  // Upward from the mode: a = j + ½ rises, xodd/xeven fall by godd/geven.
  let p = pMode;
  let q = qMode;
  let xodd = xoddMode;
  let xeven = xevenMode;
  let godd = goddMode;
  let geven = gevenMode;
  let a = m + 0.5;
  let steps = 0;
  while ((p > pStop || Math.abs(q) > qStop) && steps < MAX_STEPS) {
    xodd -= godd;
    xeven -= geven;
    godd = (godd * x * (a + b)) / (a + 1);
    geven = (geven * x * (a + b + 0.5)) / (a + 1.5);
    a += 1;
    const j = a - 0.5;
    p = (p * mu) / j;
    q = (q * 2 * mu) / (2 * j + 1);
    tnc += p * xodd + q * xeven;
    steps += 1;
  }

  // Downward from the mode: a falls, xodd/xeven rise by godd/geven.
  p = pMode;
  q = qMode;
  xodd = xoddMode;
  xeven = xevenMode;
  godd = goddMode;
  geven = gevenMode;
  a = m + 0.5;
  let j = m;
  steps = 0;
  while ((p > pStop || Math.abs(q) > qStop) && steps < MAX_STEPS && j > 0) {
    const multGodd = a / (x * (a + b - 1));
    const multGeven = (j + 1) / (x * (j + b));
    // A non-finite multiplier means x·(…) underflowed, which only
    // happens where the true increment is already 0 in double precision.
    godd = Number.isFinite(multGodd) ? godd * multGodd : 0;
    geven = Number.isFinite(multGeven) ? geven * multGeven : 0;
    xodd += godd;
    xeven += geven;
    p = (p * j) / mu;
    q = (q * (2 * j + 1)) / (2 * mu);
    j -= 1;
    a -= 1;
    tnc += p * xodd + q * xeven;
    steps += 1;
  }
  return tnc;
}

/** Poisson weights for a Poisson-mixture series, in log space around the
 *  mode: the window covers the mass to < 1e-15, and the weights are
 *  returned normalised (they sum to 1 over the window). Shared by the
 *  noncentral F and chi-square CDFs below. */
function poissonMixtureWeights(lambda: number): { j: number; w: number }[] {
  const mu = lambda / 2;
  const mode = Math.floor(mu);
  const spread = 15 * Math.sqrt(mu + 1) + 10;
  const lo = Math.max(0, Math.floor(mode - spread));
  const hi = Math.ceil(mode + spread);
  const logs: number[] = [];
  let maxLog = -Infinity;
  for (let j = lo; j <= hi; j++) {
    const lj = j * Math.log(mu) - mu - lgamma(j + 1);
    logs.push(lj);
    if (lj > maxLog) maxLog = lj;
  }
  const out: { j: number; w: number }[] = [];
  let wsum = 0;
  for (let j = lo; j <= hi; j++) {
    const w = Math.exp(logs[j - lo]! - maxLog);
    wsum += w;
    out.push({ j, w });
  }
  for (const entry of out) entry.w /= wsum;
  return out;
}

/** The noncentral F CDF at x, with df1 numerator and df2 denominator
 *  degrees of freedom and noncentrality lambda — the Poisson-mixture
 *  series over the central F CDFs (Johnson, Kotz & Balakrishnan): Σ_j
 *  e^(−λ/2)(λ/2)^j/j! · F_{F_{df1+2j, df2}}(x). λ = 0 is the central F.
 *  NaN outside its domain; 0 for x ≤ 0. */
export function noncentralFCdf(x: number, df1: number, df2: number, lambda: number): number {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(df1) ||
    !Number.isFinite(df2) ||
    !Number.isFinite(lambda) ||
    df1 <= 0 ||
    df2 <= 0 ||
    lambda < 0
  )
    return NaN;
  if (x <= 0) return 0;
  if (lambda === 0) return centralFCdf(x, df1, df2);
  const y = (df1 * x) / (df2 + df1 * x);
  let sum = 0;
  for (const { j, w } of poissonMixtureWeights(lambda)) {
    sum += w * regularizedIncompleteBeta(y, df1 / 2 + j, df2 / 2);
  }
  return Math.min(1, Math.max(0, sum));
}

/** The noncentral chi-square CDF at x, with df degrees of freedom and
 *  noncentrality lambda — the Poisson-mixture series over the central
 *  chi-square CDFs: Σ_j e^(−λ/2)(λ/2)^j/j! · F_{χ²_{df+2j}}(x). λ = 0 is
 *  the central chi-square. NaN outside its domain; 0 for x ≤ 0. */
export function noncentralChiSquareCdf(x: number, df: number, lambda: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(df) || !Number.isFinite(lambda) || df <= 0 || lambda < 0) return NaN;
  if (x <= 0) return 0;
  if (lambda === 0) return centralChiSquareCdf(x, df);
  let sum = 0;
  for (const { j, w } of poissonMixtureWeights(lambda)) {
    sum += w * regularizedIncompleteGammaP(df / 2 + j, x / 2);
  }
  return Math.min(1, Math.max(0, sum));
}
