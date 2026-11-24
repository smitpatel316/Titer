// 2-D binning / KDE smoothing / downsampling for the flow viewer — pure
// functions over Float32Arrays, no store access. Full-data computation
// underneath; only the *plotted* points are ever capped (see
// FLOW_SCATTER_CAP).

/** The most dots any flow plot draws — the same cap as the SVG scatter
 *  (XY_SCATTER_MAX_POINTS, src/views/graphs/xy-scatter.ts). At 100k events
 *  a plot never draws points 1:1: the density grid carries the full data
 *  and the scatter overlay is capped/downsampled. */
export const FLOW_SCATTER_CAP = 5000;

/** Finite min/max of a column; [0, 0] when it holds no finite value. */
export function finiteRange(values: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < values.length; r++) {
    const v = values[r];
    if (Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min === Infinity ? [0, 0] : [min, max];
}

/** Linear bin edges over [lo, hi] (a zero-width range widens by ±0.5 so a
 *  constant column still bins). */
export function linearEdges(lo: number, hi: number, bins: number): number[] {
  const [a, b] = hi > lo ? [lo, hi] : [lo - 0.5, hi + 0.5];
  const edges: number[] = [];
  for (let i = 0; i <= bins; i++) edges.push(a + ((b - a) * i) / bins);
  return edges;
}

export function binCenters(edges: number[]): number[] {
  const centers: number[] = [];
  for (let i = 0; i + 1 < edges.length; i++) centers.push((edges[i] + edges[i + 1]) / 2);
  return centers;
}

const binIndex = (v: number, lo: number, width: number, bins: number): number => {
  const i = Math.floor((v - lo) / width);
  return i < 0 ? 0 : i >= bins ? bins - 1 : i;
};

export interface Bin2DResult {
  /** counts[yBin][xBin] — rows are Y bins, so a Plotly heatmap/contour's
   *  z reads straight off. */
  counts: number[][];
  xEdges: number[];
  yEdges: number[];
  /** Events binned (== x.length when every pair is finite). */
  total: number;
  /** Pairs skipped for a non-finite coordinate. */
  skipped: number;
}

/** Bin (x, y) event pairs onto a binsX × binsY grid. Ranges default to the
 *  data's finite min/max. Every finite pair lands in exactly one bin. */
export function bin2D(
  x: Float32Array,
  y: Float32Array,
  binsX: number,
  binsY: number,
  xRange?: [number, number],
  yRange?: [number, number],
): Bin2DResult {
  const n = Math.min(x.length, y.length);
  const [xLo, xHi] = xRange ?? finiteRange(x);
  const [yLo, yHi] = yRange ?? finiteRange(y);
  const xEdges = linearEdges(xLo, xHi, binsX);
  const yEdges = linearEdges(yLo, yHi, binsY);
  const xWidth = (xEdges[binsX] - xEdges[0]) / binsX;
  const yWidth = (yEdges[binsY] - yEdges[0]) / binsY;
  const counts: number[][] = Array.from({ length: binsY }, () => new Array<number>(binsX).fill(0));
  let total = 0;
  let skipped = 0;
  for (let r = 0; r < n; r++) {
    const xv = x[r];
    const yv = y[r];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      skipped++;
      continue;
    }
    counts[binIndex(yv, yEdges[0], yWidth, binsY)][binIndex(xv, xEdges[0], xWidth, binsX)]++;
    total++;
  }
  return { counts, xEdges, yEdges, total, skipped };
}

/** Separable Gaussian blur of a count grid (the KDE: binning + smoothing).
 *  Each output cell is a weighted mean renormalised over the weights that
 *  actually landed inside the grid, so edges don't dim and the total mass
 *  is preserved up to edge effects. */
export function smoothGrid(counts: number[][], sigma: number): number[][] {
  const rows = counts.length;
  const cols = counts[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return [];
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernel: number[] = [];
  for (let d = -radius; d <= radius; d++) kernel.push(Math.exp((-d * d) / (2 * sigma * sigma)));
  const blur1D = (line: number[]): number[] =>
    line.map((_, i) => {
      let sum = 0;
      let weight = 0;
      for (let d = -radius; d <= radius; d++) {
        const j = i + d;
        if (j < 0 || j >= line.length) continue;
        const w = kernel[d + radius];
        sum += w * line[j];
        weight += w;
      }
      return weight > 0 ? sum / weight : 0;
    });
  const across = counts.map(blur1D);
  const out: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    const column = blur1D(across.map((row) => row[c]));
    for (let r = 0; r < rows; r++) out[r][c] = column[r];
  }
  return out;
}

/** Per-event density in [0, 1]: the smoothed grid, bilinearly interpolated
 *  at each event's bin position and normalised by the grid's peak. A
 *  non-finite coordinate scores 0. */
export function pointDensities(
  x: Float32Array,
  y: Float32Array,
  smoothed: number[][],
  xEdges: number[],
  yEdges: number[],
): Float32Array {
  const out = new Float32Array(Math.min(x.length, y.length));
  const rows = smoothed.length;
  const cols = smoothed[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return out;
  let peak = 0;
  for (const row of smoothed) for (const v of row) if (v > peak) peak = v;
  if (peak <= 0) return out;
  const xLo = xEdges[0];
  const xWidth = (xEdges[xEdges.length - 1] - xLo) / cols;
  const yLo = yEdges[0];
  const yWidth = (yEdges[yEdges.length - 1] - yLo) / rows;
  const at = (fx: number, fy: number): number => {
    const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)));
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const ty = Math.max(0, Math.min(1, fy - y0));
    const top = smoothed[y0][x0] * (1 - tx) + smoothed[y0][x1] * tx;
    const bottom = smoothed[y1][x0] * (1 - tx) + smoothed[y1][x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
  for (let r = 0; r < out.length; r++) {
    const xv = x[r];
    const yv = y[r];
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) {
      out[r] = 0;
      continue;
    }
    out[r] = at((xv - xLo) / xWidth - 0.5, (yv - yLo) / yWidth - 0.5) / peak;
  }
  return out;
}

/** Deterministic downsample: the first `cap` stride positions over n
 *  events (evenly spread, so ordered populations stay proportional). A
 *  sample at or under the cap is returned whole, never padded. `_seed` is
 *  reserved for a future random mode; stride sampling is seed-independent. */
export function downsampleIndices(n: number, cap: number, _seed = 0): Uint32Array {
  if (n <= cap) return Uint32Array.from({ length: n }, (_, i) => i);
  const step = n / cap;
  return Uint32Array.from({ length: cap }, (_, i) => Math.floor(i * step));
}

export interface Histogram1DResult {
  edges: number[];
  counts: number[];
  total: number;
}

/** 1-D histogram over finite values; ranges default to the data's min/max. */
export function histogram1D(values: Float32Array, binCount: number, range?: [number, number]): Histogram1DResult {
  const [lo, hi] = range ?? finiteRange(values);
  const edges = linearEdges(lo, hi, binCount);
  const width = (edges[binCount] - edges[0]) / binCount;
  const counts = new Array<number>(binCount).fill(0);
  let total = 0;
  for (let r = 0; r < values.length; r++) {
    const v = values[r];
    if (!Number.isFinite(v)) continue;
    counts[binIndex(v, edges[0], width, binCount)]++;
    total++;
  }
  return { edges, counts, total };
}
