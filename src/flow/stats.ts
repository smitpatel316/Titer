// FlowJo track, seq 449 (F2c): per-population statistics.
//
// Pure TypeScript, no webR — the stats are closed-form over the stored
// columns, so node tests get fast, deterministic numbers (the F1a store
// stats set the precedent). Quantiles use R type 6 (h = (n+1)p, linear
// interpolation), the method Titer's descriptive statistics use for
// quartiles, so the median here is the same median the stats runner
// reports for the same values.
//
// FlowJo computes its statistics on 4096-binned values, so exact unbinned
// statistics differ from FlowJo's in the last digits — the measured deltas
// are in docs/flow-population-stats.md. Nothing here bins.
//
// Frequencies: % parent is against the population's parent, % grandparent
// against the grandparent (the root for a direct child of the root), %
// total against all events. A population with an empty parent reads 0%,
// never NaN.

import type { TableData } from "../store/types";
import type { FlowPopulationRef } from "./sample";
import { formatFlowValue } from "./summary";

/** One parameter's statistics inside one population. Counts are the
 *  finite values in that parameter; every other field is null when there
 *  are none (an empty population), and `sd` / `cv` are null below n = 2 /
 *  at a zero mean. */
export interface PopulationParamStats {
  param: string;
  count: number;
  median: number | null;
  mean: number | null;
  geoMean: number | null;
  sd: number | null;
  cv: number | null;
  rSd: number | null;
  rCv: number | null;
  min: number | null;
  max: number | null;
  p10: number | null;
  p25: number | null;
  p75: number | null;
  p90: number | null;
}

/** One population's statistics: its size, its frequencies, and one
 *  `PopulationParamStats` per parameter, in the sample's parameter order. */
export interface PopulationStats {
  id: string;
  name: string;
  count: number;
  pctParent: number;
  pctGrandparent: number;
  pctTotal: number;
  params: PopulationParamStats[];
}

/** R type-6 quantile over an ascending array: h = (n+1)p, linear
 *  interpolation between the bracketing order statistics. */
function quantileType6(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  const h = (n + 1) * p;
  if (h <= 1) return sorted[0];
  if (h >= n) return sorted[n - 1];
  const lo = Math.floor(h);
  const frac = h - lo;
  return sorted[lo - 1] * (1 - frac) + sorted[lo] * frac;
}

function statsForParam(param: string, values: readonly number[]): PopulationParamStats {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  const none: PopulationParamStats = {
    param,
    count: 0,
    median: null,
    mean: null,
    geoMean: null,
    sd: null,
    cv: null,
    rSd: null,
    rCv: null,
    min: null,
    max: null,
    p10: null,
    p25: null,
    p75: null,
    p90: null,
  };
  if (n === 0) return none;
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  // Sample SD (n-1), null below n = 2.
  let sd: number | null = null;
  if (n > 1) {
    let sq = 0;
    for (const v of sorted) {
      const d = v - mean;
      sq += d * d;
    }
    sd = Math.sqrt(sq / (n - 1));
  }
  // Geometric mean over the positive values only — flow data routinely has
  // zero or negative compensated values, so the all-positive rule R's
  // descriptive stats use would null the field on most real samples.
  // Null when no value is positive.
  let geoMean: number | null = null;
  let logSum = 0;
  let positives = 0;
  for (const v of sorted) {
    if (v > 0) {
      logSum += Math.log(v);
      positives++;
    }
  }
  if (positives > 0) geoMean = Math.exp(logSum / positives);
  const median = quantileType6(sorted, 0.5);
  // Robust SD / CV, FlowJo's definitions: half the central 68.27%
  // (p84.13 − p15.87), and 100 × robust SD / median.
  const rSd = (quantileType6(sorted, 0.8413) - quantileType6(sorted, 0.1587)) / 2;
  return {
    param,
    count: n,
    median,
    mean,
    geoMean,
    sd,
    cv: sd !== null && mean !== 0 ? (100 * sd) / mean : null,
    rSd,
    rCv: median !== 0 ? (100 * rSd) / median : null,
    min: sorted[0],
    max: sorted[n - 1],
    p10: quantileType6(sorted, 0.1),
    p25: quantileType6(sorted, 0.25),
    p75: quantileType6(sorted, 0.75),
    p90: quantileType6(sorted, 0.9),
  };
}

/** Resolve every population to its event indices. Parents resolve before
 *  their children regardless of the tree's order; an unknown parent or a
 *  cycle is refused, never silently treated as a root. A predicate filters
 *  the parent's indices: half-open [min, max) — the lower bound inclusive,
 *  the upper exclusive — so a pair of gates at the same cut (CD4 ≥ 1000 /
 *  CD4 < 1000) partitions the events with no overlap and no gap.
 *  Non-finite values never pass a gate. */
export function resolvePopulationIndices(
  columns: readonly Float32Array[],
  paramNames: readonly string[],
  populations: readonly FlowPopulationRef[],
): Map<string, number[]> {
  const total = columns.length ? columns[0].length : 0;
  const byParam = new Map(paramNames.map((name, i) => [name, columns[i]]));
  const byId = new Map(populations.map((p) => [p.id, p]));
  for (const pop of populations) {
    if (pop.parentId !== null && !byId.has(pop.parentId)) {
      throw new Error(`Population "${pop.name}" has unknown parent "${pop.parentId}".`);
    }
  }
  const out = new Map<string, number[]>();
  const all = Array.from({ length: total }, (_, i) => i);
  const resolve = (id: string, seen: readonly string[]): number[] => {
    const cached = out.get(id);
    if (cached) return cached;
    const pop = byId.get(id)!;
    if (seen.includes(id)) throw new Error(`Gating cycle at population "${pop.name}".`);
    let indices = pop.parentId === null ? all : resolve(pop.parentId, [...seen, id]);
    if (pop.predicate) {
      const column = byParam.get(pop.predicate.param);
      if (!column) {
        throw new Error(`Population "${pop.name}" gates on unknown parameter "${pop.predicate.param}".`);
      }
      const { min, max } = pop.predicate;
      indices = indices.filter((i) => {
        const v = column[i];
        if (!Number.isFinite(v)) return false;
        if (min !== undefined && v < min) return false;
        if (max !== undefined && v >= max) return false;
        return true;
      });
    }
    out.set(id, indices);
    return indices;
  };
  for (const pop of populations) resolve(pop.id, []);
  return out;
}

/** Per-population statistics over the resolved indices. `indicesById` is
 *  `resolvePopulationIndices`'s result; populations keep their input
 *  order. Percentages are against the parent, the grandparent and the
 *  root (see the module header); a root population reads 100% everywhere. */
export function computePopulationStats(
  columns: readonly Float32Array[],
  paramNames: readonly string[],
  populations: readonly FlowPopulationRef[],
  indicesById: ReadonlyMap<string, readonly number[]>,
): PopulationStats[] {
  const root = populations.find((p) => p.parentId === null);
  const total = root ? (indicesById.get(root.id)?.length ?? 0) : (columns[0]?.length ?? 0);
  const byId = new Map(populations.map((p) => [p.id, p]));
  return populations.map((pop) => {
    const indices = indicesById.get(pop.id) ?? [];
    const parent = pop.parentId !== null ? byId.get(pop.parentId) : undefined;
    const parentCount = parent ? (indicesById.get(parent.id)?.length ?? 0) : indices.length;
    const grandparent =
      parent?.parentId !== null && parent?.parentId !== undefined ? byId.get(parent.parentId) : undefined;
    const grandparentCount = grandparent ? (indicesById.get(grandparent.id)?.length ?? 0) : total;
    const params = paramNames.map((name, pi) => {
      const column = columns[pi];
      const values: number[] = [];
      for (const i of indices) values.push(column[i]);
      return statsForParam(name, values);
    });
    return {
      id: pop.id,
      name: pop.name,
      count: indices.length,
      pctParent: parentCount === 0 ? 0 : (100 * indices.length) / parentCount,
      pctGrandparent: grandparentCount === 0 ? 0 : (100 * indices.length) / grandparentCount,
      pctTotal: total === 0 ? 0 : (100 * indices.length) / total,
      params,
    };
  });
}

const STAT_LABELS = [
  "median",
  "mean",
  "geo mean",
  "SD",
  "CV %",
  "robust SD",
  "robust CV %",
  "min",
  "max",
  "p10",
  "p25",
  "p75",
  "p90",
] as const;

type StatField = "median" | "mean" | "geoMean" | "sd" | "cv" | "rSd" | "rCv" | "min" | "max" | "p10" | "p25" | "p75" | "p90";
const STAT_FIELDS: StatField[] = [
  "median",
  "mean",
  "geoMean",
  "sd",
  "cv",
  "rSd",
  "rCv",
  "min",
  "max",
  "p10",
  "p25",
  "p75",
  "p90",
];

/** The stats as an ordinary table: one row per population, the population
 *  name, frequencies and event count first, then a thirteen-column block
 *  per parameter. Values read through `formatFlowValue` (six significant
 *  figures), the same bridge the summary table uses — a stats table is
 *  read by eye and by the stats runner, not bit-compared. */
export function buildPopulationStatsTable(
  stats: readonly PopulationStats[],
  paramNames: readonly string[],
): TableData {
  const columns = [
    "Population",
    "% Parent",
    "% Grandparent",
    "% Total",
    "Events",
    ...paramNames.flatMap((name) => STAT_LABELS.map((label) => `${name} ${label}`)),
  ];
  const rows = stats.map((pop) => {
    const byParam = new Map(pop.params.map((p) => [p.param, p]));
    return [
      pop.name,
      formatFlowValue(pop.pctParent),
      formatFlowValue(pop.pctGrandparent),
      formatFlowValue(pop.pctTotal),
      String(pop.count),
      ...paramNames.flatMap((name) => {
        const s = byParam.get(name);
        if (!s) return STAT_LABELS.map(() => null);
        return STAT_FIELDS.map((field) => formatFlowValue(s[field]));
      }),
    ] as (string | null)[];
  });
  return { columns, rows };
}
