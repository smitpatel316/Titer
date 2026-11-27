import { noncentralTCdf, regularizedIncompleteGammaQ, normalCdf } from "./src/stats/distributions";

// Prototype of the planned asymptotic (chi-square limit), for validation
// against the Gauss-Hermite ground truth before it moves into distributions.ts.
function asymp(tt: number, df: number, del: number): number {
  if (del < 0) return 1;
  const r = del / tt;
  if (df <= 20000) {
    const xArg = (df / 2) * r * r;
    if (!Number.isFinite(xArg)) return 0;
    return regularizedIncompleteGammaQ(df / 2, xArg);
  }
  const mu = 1 - 2 / (9 * df);
  const sd = Math.sqrt(2 / (9 * df));
  const z = (Math.cbrt(r * r) - mu) / sd;
  return normalCdf(-z);
}

const grid: Array<[number, number, number]> = [];
for (const nu of [1, 100]) for (const d of [500, 1414, 1e4, 1e5, 1e6]) grid.push([d, nu, d]);
for (const nu of [1e5, 1e8]) for (const d of [1414, 1e5]) grid.push([d, nu, d]);
grid.push([1e155, 10, 5]);
grid.push([5e4, 100, 1e5]);
grid.push([2e5, 100, 1e5]);

for (const [t, nu, d] of grid) {
  const s = noncentralTCdf(t, nu, d);
  const a = asymp(Math.abs(t), nu, t < 0 ? -d : d);
  console.log(`nct(${t}; ${nu}, ${d}) series=${s} asymp=${a}`);
}
