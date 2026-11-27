import { regularizedIncompleteBeta, noncentralTCdf } from "./src/stats/distributions";

// Probe the beta continued fraction at the worst-case x = a/(a+b) (t = delta),
// where the mode-centered twin series calls it with a = mu + 0.5, b = df/2.
const cases: Array<[number, number]> = [];
for (const b of [1e4, 1e5, 1e6, 1e7, 5e7]) cases.push([1e6, b]);
for (const b of [5e4, 5e5, 5e6, 5e7]) cases.push([5e9, b]);
cases.push([1.25e5, 5e7]);
cases.push([1.25e5, 5e4]);
for (const [a, b] of cases) {
  const x = a / (a + b);
  const v = regularizedIncompleteBeta(x, a, b);
  console.log(`beta x=${x} a=${a} b=${b} I=${v}`);
}
// Series at huge df, small/moderate delta (mu > 700 so mode-centered path).
for (const d of [50, 500, 1414]) {
  console.log(`series nct(${d}; 1e8, ${d}) = ${noncentralTCdf(d, 1e8, d)}`);
}
