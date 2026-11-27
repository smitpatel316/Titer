import { regularizedIncompleteBeta } from "./src/stats/distributions";

// Pin down the beta-CF failure boundary in min(a, b) at worst-case x = a/(a+b).
const cases: Array<[number, number]> = [
  [1.5e5, 1.5e5],
  [2e5, 2e5],
  [3e5, 3e5],
  [4e5, 4e5],
  [5e5, 5e5],
  [2e5, 1e7],
  [1e7, 2e5],
  [1e6, 2e5],
  [2e5, 1e6],
];
for (const [a, b] of cases) {
  const x = a / (a + b);
  console.log(`beta a=${a} b=${b} I=${regularizedIncompleteBeta(x, a, b)}`);
}
