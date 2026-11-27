import { noncentralTCdf } from "./src/stats/distributions";

const cases: Array<[number, number, number, number]> = [
  [1e155, 10, 5, 1.0],
  [-1e6, 100, 1e6, 0],
  [1e7, 100, 1e7, 0.4812],
  [1e5, 1e8, 1e5, 0.5],
  // ordinary-range regression references (SciPy values already pinned in the suite)
  [50, 2000, 50, 0.49779329789003834],
  [500, 1, 500, 0.31731147574388785],
  [200, 5000, 200, 0.4977401000091556],
  [448, 1, 448, 0.3173117134697949],
  [63.66, 1, 38.5, 0.5453778383],
  [63.66, 1, 100, 0.116263657],
];
for (const [t, df, del, want] of cases) {
  const got = noncentralTCdf(t, df, del);
  console.log(`nct(${t}; ${df}, ${del}) = ${got}  (want ${want})`);
}
