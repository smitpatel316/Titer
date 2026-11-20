// "Analyze a stack of P values" (Prism's Column analysis of the same name):
// P values computed elsewhere, entered in a column, adjusted for multiplicity
// — family-wise (Bonferroni-Dunn, Bonferroni-Šídák, Holm, Holm–Šídák) or
// false-discovery-rate (Benjamini–Hochberg, Benjamini–Krieger–Yekutieli,
// Benjamini–Yekutieli) — plus Fisher's and Stouffer's combined P values for
// the global null. Pure TypeScript: every adjustment is closed-form
// arithmetic (the Grubbs precedent in rout.ts), and the two combined P values
// need only the chi-square upper tail and the normal CDF/quantile (lib).
import type {
  AnalysisOutcome,
  Column,
  PValueRow,
  PValueStackMethod,
  PValueStackParams,
} from "../types";
import { isFdrPValueMethod, P_VALUE_STACK_METHODS, pValueAlphaError, routQError } from "../types";
import { adjustPValues } from "./base";
import { qnorm } from "../../lib/normal";
import { logGamma } from "../../lib/student-t";

/** The values a run actually uses when a param is omitted. */
const DEFAULTS: PValueStackParams = { method: "holm-sidak", q: 5, alpha: 0.05 };

/** The method's plain name, as the subtitle and notes show it. */
const METHOD_LABELS: Record<PValueStackMethod, string> = {
  bonferroni: "Bonferroni-Dunn",
  sidak: "Bonferroni-Šídák",
  holm: "Holm",
  "holm-sidak": "Holm–Šídák",
  bh: "Benjamini–Hochberg",
  bky: "Benjamini, Krieger and Yekutieli",
  by: "Benjamini–Yekutieli",
};

/** The regularized upper incomplete gamma Q(a, x) = Γ(a, x)/Γ(a) (Numerical
 *  Recipes `gammq`): the series below x = a + 1, the continued fraction
 *  above it — the fraction is the stable branch for the large X² a Fisher
 *  combination of tiny P values produces. */
function gammq(a: number, x: number): number {
  if (x <= 0) return 1;
  if (!Number.isFinite(x)) return 0;
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 500; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i++) {
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
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Upper tail of the chi-square distribution with `df` degrees of freedom. */
export function chiSquareSurvival(x: number, df: number): number {
  return gammq(df / 2, x / 2);
}

/** The standard normal CDF Φ(z) (Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7 —
 *  far inside a P value's displayed precision). */
export function normalCdf(z: number): number {
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - (Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? p : 1 - p;
}

/** Fisher's combined probability test: X² = −2Σ ln pᵢ on 2m df. A P value of
 *  exactly 0 makes X² infinite and the combined P 0. */
export function fisherCombinedP(ps: number[]): number {
  if (ps.some((p) => p === 0)) return 0;
  const x2 = -2 * ps.reduce((a, p) => a + Math.log(p), 0);
  return chiSquareSurvival(x2, 2 * ps.length);
}

/** Stouffer's method (unweighted): Z = Σ Φ⁻¹(1 − pᵢ) / √m, the combined P the
 *  upper normal tail at Z. A P value of exactly 0 is overwhelming evidence
 *  against the global null on its own, so it short-circuits to 0 (rather
 *  than the NaN a 0 next to a 1 would sum to). */
export function stoufferCombinedP(ps: number[]): number {
  if (ps.some((p) => p === 0)) return 0;
  const z = ps.reduce((a, p) => a + qnorm(1 - p), 0) / Math.sqrt(ps.length);
  return 1 - normalCdf(z);
}

/** Benjamini–Hochberg q values, in the order given (nulls pass through):
 *  for the i-th smallest P (i = 1…m), the min over j ≥ i of m·p_(j)/j,
 *  capped at 1 — the step-up running minimum from the largest P down. */
function bhAdjusted(ps: (number | null)[]): (number | null)[] {
  const m = ps.length;
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const out: (number | null)[] = ps.map(() => null);
  let runningMin = Infinity;
  for (let k = sorted.length - 1; k >= 0; k--) {
    const [p, i] = sorted[k];
    runningMin = Math.min(runningMin, (m / (k + 1)) * p!);
    out[i] = Math.min(1, runningMin);
  }
  return ps.map((p, i) => (p == null ? null : out[i]));
}

/** Holm's step-down Bonferroni adjustment, in the order given: for the i-th
 *  smallest P, the max over j ≤ i of (m−j+1)·p_(j), capped at 1. */
function holmAdjusted(ps: (number | null)[]): (number | null)[] {
  const m = ps.length;
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const out: (number | null)[] = ps.map(() => null);
  let runningMax = 0;
  sorted.forEach(([p, i], rank) => {
    runningMax = Math.max(runningMax, Math.min(1, (m - rank) * p!));
    out[i] = runningMax;
  });
  return ps.map((p, i) => (p == null ? null : out[i]));
}

/** The Benjamini–Krieger–Yekutieli estimate of the number of true null
 *  hypotheses: run BH at level q/(1+q), count its rejections r₁, and take
 *  m₀ = m − r₁ (Benjamini, Krieger & Yekutieli 2006). `q` is the FDR level
 *  as a fraction. */
export function bkyTrueNullEstimate(ps: (number | null)[], q: number): number {
  const qPrime = q / (1 + q);
  return ps.length - bhAdjusted(ps).filter((v) => v != null && v <= qPrime).length;
}

/** Benjamini–Krieger–Yekutieli q values, in the order given: the stage-2 BH
 *  q values with m replaced by the estimated m₀ and the level rescaled —
 *  min over j ≥ i of (1+q)·m₀·p_(j)/j, capped at 1 — so a q value ≤ q marks
 *  exactly the stage-2 BH rejections at level q′·m/m₀. When m₀ = 0 (the
 *  stage-1 run rejected everything) every q value is 0. */
function bkyAdjusted(ps: (number | null)[], q: number): (number | null)[] {
  const m0 = bkyTrueNullEstimate(ps, q);
  if (m0 === 0) return ps.map((p) => (p == null ? null : 0));
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const out: (number | null)[] = ps.map(() => null);
  let runningMin = Infinity;
  for (let k = sorted.length - 1; k >= 0; k--) {
    const [p, i] = sorted[k];
    runningMin = Math.min(runningMin, ((1 + q) * m0 * p!) / (k + 1));
    out[i] = Math.min(1, runningMin);
  }
  return ps.map((p, i) => (p == null ? null : out[i]));
}

/** Adjusted P values (FWER methods) or q values (FDR methods) for a stack of
 *  raw P values, in the order given. `q` is the FDR level as a fraction
 *  (BKY only — the other methods ignore it). Nulls pass through. */
export function adjustStackPValues(
  ps: (number | null)[],
  method: PValueStackMethod,
  q = 0.05,
): (number | null)[] {
  switch (method) {
    case "bonferroni":
      return ps.map((p) => (p == null ? null : Math.min(1, p * ps.length)));
    case "sidak":
      return adjustPValues(ps, "sidak");
    case "holm":
      return holmAdjusted(ps);
    case "holm-sidak":
      return adjustPValues(ps, "holm-sidak");
    case "bh":
      return bhAdjusted(ps);
    case "bky":
      return bkyAdjusted(ps, q);
    case "by": {
      const c = Array.from({ length: ps.length }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0);
      return bhAdjusted(ps).map((v) => (v == null ? null : Math.min(1, v * c)));
    }
  }
}

export async function runPValueStack(columns: Column[], params?: PValueStackParams): Promise<AnalysisOutcome> {
  const groups = columns.filter((c) => c.values.length > 0);
  if (groups.length < 1) return { error: "This needs at least 1 column containing numeric data." };
  const method = params?.method ?? DEFAULTS.method!;
  if (!(P_VALUE_STACK_METHODS as readonly string[]).includes(method)) {
    return { error: `Unknown P-value method: “${method}”.` };
  }
  const fdr = isFdrPValueMethod(method);
  const qPercent = params?.q ?? DEFAULTS.q!;
  const alpha = params?.alpha ?? DEFAULTS.alpha!;
  if (fdr) {
    const qError = routQError(qPercent);
    if (qError) return { error: qError };
  } else {
    const alphaError = pValueAlphaError(alpha);
    if (alphaError) return { error: alphaError };
  }

  // The chosen columns pool into one stack, in entry order (a column, then
  // its rows) — Prism's one column is the common case; several columns are
  // just a longer stack.
  const multi = groups.length > 1;
  const entries = groups.flatMap((g) =>
    g.values.map((value, k) => ({
      label: multi ? `${g.name}, row ${g.rows[k] + 1}` : `Row ${g.rows[k] + 1}`,
      value,
    })),
  );
  const bad = entries.find((e) => !(e.value >= 0 && e.value <= 1));
  if (bad) {
    return {
      error: `“${bad.label}” is ${bad.value}, not a P value — enter P values between 0 and 1.`,
    };
  }
  const ps = entries.map((e) => e.value);
  const m = ps.length;
  const level = fdr ? qPercent / 100 : alpha;
  const adjusted = adjustStackPValues(ps, method, level);
  const flagged = adjusted.map((a) => a != null && a <= level);

  // Ranks (1 = smallest; ties in entry order), for the rank column — and
  // the rank-vs-P graph Prism optionally draws from the same numbers.
  const order = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b] || a - b);
  const rank = new Array<number>(m);
  order.forEach((i, r) => {
    rank[i] = r + 1;
  });
  const pValueRows: PValueRow[] = entries.map((e, i) => ({
    label: e.label,
    rank: rank[i],
    p: e.value,
    adjusted: adjusted[i],
    flagged: flagged[i],
  }));

  const flaggedCount = flagged.filter(Boolean).length;
  const fisher = fisherCombinedP(ps);
  const stouffer = stoufferCombinedP(ps);
  // Single-step methods have one threshold P value (a raw P below it is
  // significant); step-down and FDR methods do not — the largest flagged
  // raw P is the honest equivalent.
  const threshold =
    method === "bonferroni" ? alpha / m : method === "sidak" ? 1 - (1 - alpha) ** (1 / m) : null;
  const largestFlagged =
    threshold == null
      ? ps.reduce<number | null>((acc, p, i) => (flagged[i] ? Math.max(acc ?? -Infinity, p) : acc), null)
      : null;
  const flagNoun = fdr ? "discoveries" : "significant";
  const flaggedList =
    flaggedCount > 0 && flaggedCount <= 10
      ? ` Flagged: ${entries.filter((_, i) => flagged[i]).map((e) => e.label).join(", ")}.`
      : "";
  const notes =
    (flaggedCount === 0
      ? `No P values ${fdr ? "are discoveries" : "are significant"} at ${fdr ? `Q = ${qPercent}%` : `α = ${alpha}`} — all ${m} adjusted P values are above the threshold.`
      : `${flaggedCount} of ${m} P values ${fdr ? "are discoveries" : "are significant"} at ${fdr ? `Q = ${qPercent}%` : `α = ${alpha}`}.${flaggedList}`) +
    ` Method: ${METHOD_LABELS[method]}${method === "bky" ? ` (estimated true null hypotheses: ${bkyTrueNullEstimate(ps, level)})` : ""};` +
    ` each row's adjusted P value (q value, for the FDR methods) is the value of ${fdr ? "Q" : "α"} at which that P value would sit exactly on the border.` +
    ` Fisher's and Stouffer's combined P values test the global null — that every P value is uniform — and assume the P values are independent; they combine the stack rather than adjusting it.` +
    ` This follows the published methods' logic, not GraphPad's certified implementation.`;

  return {
    testType: "p-value-stack",
    subtitle: `Stack of P values — ${METHOD_LABELS[method]} (${fdr ? `Q = ${qPercent}%` : `α = ${alpha}`})`,
    stats: [
      { label: "P values entered", value: m },
      {
        label: fdr ? `Discoveries (q ≤ ${qPercent}%)` : `Significant (adjusted P ≤ ${alpha})`,
        value: flaggedCount,
      },
      ...(threshold != null
        ? [{ label: "Threshold P value", value: threshold }]
        : [{ label: `Largest ${fdr ? "discovery" : "significant"} P value`, value: largestFlagged }]),
      { label: "Fisher's combined P value", value: fisher, p: true },
      { label: "Stouffer's combined P value", value: stouffer, p: true },
    ],
    groups: [],
    pValueRows,
    pValueAdjustedLabel: fdr ? "q value" : "Adjusted P value",
    pValueFlagLabel: fdr ? "Discovery" : "Significant",
    notes,
  };
}
