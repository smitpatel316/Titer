// The mean, SD, SEM, median and quartiles of numbers, for what the graphs draw at once
// (error bars, centers, boxes); analyses take theirs from R.
//
// Empty-input contract (v1.5.0 m18): mean([]) and median([]) are NaN by
// definition (0/0), sem([]) likewise — these helpers never see an empty
// group from a current caller, and their return type stays `number` so the
// ~10 graph/stats call sites need no null-plumbing. The boundary that
// surfaces descriptives, `describe` in stats/column/base.ts, coerces NaN
// to null for an empty group instead.

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** The smallest and largest of numbers, any number of them (Math.min(...v) overflows the
 *  call stack past ~100,000 values); ±Infinity with none. */
export const minOf = (v: number[]) => v.reduce((a, b) => (b < a ? b : a), Infinity);
export const maxOf = (v: number[]) => v.reduce((a, b) => (b > a ? b : a), -Infinity);

/** The sample SD (n − 1); 0 with fewer than 2 values. */
export function sd(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

/** The standard error of the mean; 0 with fewer than 2 values. */
export const sem = (v: number[]) => sd(v) / Math.sqrt(v.length);

export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The geometric mean (exp of the mean of the logs), or null when any value
 *  is zero or negative — the log is undefined there, so Prism plots no
 *  geometric mean at all rather than a wrong value. Null, not NaN: the
 *  graph callers decide how an undefined center shows (see `centerOf`). */
export function geometricMean(v: number[]): number | null {
  if (v.length === 0 || v.some((x) => x <= 0)) return null;
  return Math.exp(mean(v.map((x) => Math.log(x))));
}

/** The geometric SD factor (exp of the SD of the logs), or null when any
 *  value is zero or negative — same undefinedness as the geometric mean. */
export function geometricSdFactor(v: number[]): number | null {
  if (v.length === 0 || v.some((x) => x <= 0)) return null;
  return Math.exp(sd(v.map((x) => Math.log(x))));
}

/** The geometric 95% CI (the log-scale mean ± t·SEM, back-transformed), or
 *  null when any value is zero or negative. Needs the t critical value, so
 *  it takes it as a parameter instead of importing the t distribution here. */
export function geometricCi(v: number[], tCrit: number): { low: number; high: number } | null {
  if (v.length < 2 || v.some((x) => x <= 0)) return null;
  const logs = v.map((x) => Math.log(x));
  const half = tCrit * sem(logs);
  const m = mean(logs);
  return { low: Math.exp(m - half), high: Math.exp(m + half) };
}

/** The `p` quantile as Descriptive statistics gives it (R's type 6, the (n + 1)p method):
 *  between the two values ranked around (n + 1)p, the smallest or largest beyond them. */
export function quantile(v: number[], p: number): number {
  const s = [...v].sort((a, b) => a - b);
  const h = Math.min(Math.max((s.length + 1) * p, 1), s.length) - 1;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}

/** A box as Titer draws it, handed to Plotly, which then computes none of its own: its
 *  quartiles (`quantile`) and whiskers to the minimum and maximum, or Tukey's: to the
 *  furthest values within 1.5 × IQR of the quartiles. */
export function boxOf(v: number[], whiskers: "minmax" | "tukey" = "minmax") {
  const [q1, q3] = [quantile(v, 0.25), quantile(v, 0.75)];
  const reach = whiskers === "tukey" ? 1.5 * (q3 - q1) : Infinity;
  const inside = v.filter((x) => x >= q1 - reach && x <= q3 + reach);
  return { q1, median: median(v), q3, lowerfence: minOf(inside), upperfence: maxOf(inside) };
}
