import { regularizedIncompleteGammaP, regularizedIncompleteGammaQ } from "./src/stats/distributions";

// Probe the TS gamma P/Q at large a (the chi-square-limit asymptotic needs
// Q(nu/2, nu*del^2/(2 t^2)) with a up to 5e7). Compare against scipy offline.
const cases: Array<[number, number]> = [];
for (const a of [50, 1e3, 1e4, 1e5, 1e6, 1e7, 5e7]) {
  for (const f of [0.5, 1.0, 2.0]) cases.push([a, a * f]);
}
for (const [a, x] of cases) {
  const p = regularizedIncompleteGammaP(a, x);
  const q = regularizedIncompleteGammaQ(a, x);
  console.log(`a=${a} x=${x} P=${p} Q=${q} P+Q=${p + q}`);
}
