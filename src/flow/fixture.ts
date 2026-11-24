// Deterministic synthetic event data for the flow viewer — NO real FCS
// files, no Mansi files, ever. Two lognormal populations (CD4+, CD8+) plus
// a double-negative cluster, on FSC-A / SSC-A / CD4 / CD8, generated from a
// seeded PRNG so the same seed regenerates the same events byte for byte.

import { loadSample } from "./store";

export const FLOW_FIXTURE_SAMPLE_ID = "flow-fixture-1";
export const FLOW_FIXTURE_PARAMS = ["FSC-A", "SSC-A", "CD4", "CD8"] as const;

/** mulberry32 — small, deterministic, seedable. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normals via Box-Muller (one spare cached). */
function makeNormal(rand: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    let u1 = 0;
    while (u1 === 0) u1 = rand();
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    spare = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

/** Lognormal with the given median and log-space sigma. */
const lognormal = (median: number, sigma: number, z: () => number) => median * Math.exp(sigma * z());

export interface FixtureSample {
  columns: Float32Array[];
  paramNames: string[];
}

/** The fixture's populations, in fill order: double-negative (40%), CD4+
 *  (30%), CD8+ (30%). A CD4 gate at 1000 cleanly separates the CD4+
 *  population (median 8000) from the rest (medians ~100–120). */
export function generateFixtureSample(eventCount = 20000, seed = 42): FixtureSample {
  const rand = mulberry32(seed);
  const z = makeNormal(rand);
  const nNeg = Math.round(eventCount * 0.4);
  const nCd4 = Math.round(eventCount * 0.3);
  const nCd8 = eventCount - nNeg - nCd4;
  const fsc = new Float32Array(eventCount);
  const ssc = new Float32Array(eventCount);
  const cd4 = new Float32Array(eventCount);
  const cd8 = new Float32Array(eventCount);
  let i = 0;
  const fill = (count: number, cd4Median: number, cd8Median: number) => {
    for (let k = 0; k < count; k++, i++) {
      fsc[i] = lognormal(50000, 0.25, z);
      ssc[i] = lognormal(20000, 0.3, z);
      cd4[i] = lognormal(cd4Median, 0.35, z);
      cd8[i] = lognormal(cd8Median, 0.35, z);
    }
  };
  fill(nNeg, 100, 110);
  fill(nCd4, 8000, 120);
  fill(nCd8, 110, 9000);
  return { columns: [fsc, ssc, cd4, cd8], paramNames: [...FLOW_FIXTURE_PARAMS] };
}

/** Load the fixture into the store (through the contract only). */
export function loadFixtureSample(eventCount = 20000, seed = 42): string {
  const { columns, paramNames } = generateFixtureSample(eventCount, seed);
  loadSample(FLOW_FIXTURE_SAMPLE_ID, columns, paramNames, {
    description: "Synthetic fixture: CD4+ / CD8+ lognormal populations + double-negative cluster",
  });
  return FLOW_FIXTURE_SAMPLE_ID;
}
