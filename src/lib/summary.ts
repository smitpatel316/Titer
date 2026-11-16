// The mean, SD, SEM and median of numbers, for what the graphs draw at once (error bars,
// centers); analyses take theirs from R.
//
// Empty-input contract (v1.5.0 m18): mean([]) and median([]) are NaN by
// definition (0/0), sem([]) likewise — these helpers never see an empty
// group from a current caller, and their return type stays `number` so the
// ~10 graph/stats call sites need no null-plumbing. The boundary that
// surfaces descriptives, `describe` in stats/column/base.ts, coerces NaN
// to null for an empty group instead.

export const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

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
