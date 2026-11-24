// The density-plot viewer: dot / 2-D density / contour / pseudocolor
// plots plus per-population histograms, as Plotly figures.
//
// Reads data ONLY through src/flow/store.ts — this file imports nothing
// outside src/flow, never touches the table grid, and holds no second copy
// of any events. Unload a sample and every builder here throws: there is
// nothing else to fall back on.
//
// Scale rule (scope §4): never plot 100k points 1:1. The density grid is
// computed over the FULL data; only the scatter overlays (dot, pseudocolor)
// are capped/downsampled to FLOW_SCATTER_CAP.

import { getColumn, sampleStats } from "./store";
import {
  bin2D,
  binCenters,
  downsampleIndices,
  FLOW_SCATTER_CAP,
  histogram1D,
  pointDensities,
  smoothGrid,
} from "./density";

export interface FlowFigure {
  data: unknown[];
  layout: Record<string, unknown>;
}

export interface FlowPlotOptions {
  sampleId: string;
  xParam: string;
  yParam: string;
  /** Density-grid bins per axis (density/contour/pseudocolor). Default 64. */
  bins?: number;
  /** Most dots drawn (dot/pseudocolor). Default FLOW_SCATTER_CAP. */
  downsampleCap?: number;
}

/** A rectangular population gate on two parameters (the per-population
 *  histogram's populations; the gating engine proper is a later lane). */
export interface FlowGateRect {
  xParam: string;
  yParam: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface FlowHistogramOptions {
  sampleId: string;
  param: string;
  bins?: number;
  /** Populations to overlay, each a rect gate; omitted, the whole sample. */
  populations?: { name: string; gate: FlowGateRect }[];
}

const layoutFor = (
  title: string,
  xName: string,
  yName: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  title,
  xaxis: { title: xName },
  yaxis: { title: yName },
  ...extra,
});

function columnsFor(sampleId: string, xParam: string, yParam: string): [Float32Array, Float32Array] {
  return [getColumn(sampleId, xParam), getColumn(sampleId, yParam)];
}

/** The capped, evenly spread event indices a scatter overlay draws. */
function plottedIndices(sampleId: string, cap: number): Uint32Array {
  return downsampleIndices(sampleStats(sampleId).eventCount, cap, 7);
}

const pick = <T>(values: Float32Array, idx: Uint32Array): T[] => {
  const out: unknown[] = new Array(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = values[idx[i]];
  return out as T[];
};

/** Dot plot: WebGL scattergl, density-aware by construction — the capped
 *  overlay sits on the full-data computation underneath, never 1:1. */
export function buildFlowDotPlot(opts: FlowPlotOptions): FlowFigure {
  const [x, y] = columnsFor(opts.sampleId, opts.xParam, opts.yParam);
  const idx = plottedIndices(opts.sampleId, opts.downsampleCap ?? FLOW_SCATTER_CAP);
  return {
    data: [
      {
        type: "scattergl",
        mode: "markers",
        x: pick<number>(x, idx),
        y: pick<number>(y, idx),
        marker: { color: "#3b82f6", size: 4, opacity: 0.6 },
        showlegend: false,
      },
    ],
    layout: layoutFor(`Dot plot: ${opts.yParam} vs ${opts.xParam}`, opts.xParam, opts.yParam),
  };
}

/** The smoothed 2-D density grid the density/contour/pseudocolor plots
 *  share — binned + Gaussian-smoothed over the FULL sample. */
function densityGrid(opts: FlowPlotOptions) {
  const bins = opts.bins ?? 64;
  const [x, y] = columnsFor(opts.sampleId, opts.xParam, opts.yParam);
  const grid = bin2D(x, y, bins, bins);
  return { grid, smoothed: smoothGrid(grid.counts, 1.5), x, y };
}

/** 2-D density plot: a heatmap over the smoothed binned grid. */
export function buildFlowDensityPlot(opts: FlowPlotOptions): FlowFigure {
  const { grid, smoothed } = densityGrid(opts);
  return {
    data: [
      {
        type: "heatmap",
        x: binCenters(grid.xEdges),
        y: binCenters(grid.yEdges),
        z: smoothed,
        colorscale: "Viridis",
        showscale: true,
        hoverongaps: false,
      },
    ],
    layout: layoutFor(`Density: ${opts.yParam} vs ${opts.xParam}`, opts.xParam, opts.yParam),
  };
}

/** Contour plot: contour lines over the same smoothed grid. */
export function buildFlowContourPlot(opts: FlowPlotOptions): FlowFigure {
  const { grid, smoothed } = densityGrid(opts);
  return {
    data: [
      {
        type: "contour",
        x: binCenters(grid.xEdges),
        y: binCenters(grid.yEdges),
        z: smoothed,
        colorscale: "Viridis",
        showscale: true,
        contours: { coloring: "heatmap", showlines: true },
      },
    ],
    layout: layoutFor(`Contour: ${opts.yParam} vs ${opts.xParam}`, opts.xParam, opts.yParam),
  };
}

/** Pseudocolor plot: capped scattergl dots, each coloured by its local
 *  density (the FlowJo pseudocolor look) on the Viridis scale. */
export function buildFlowPseudocolorPlot(opts: FlowPlotOptions): FlowFigure {
  const { grid, smoothed, x, y } = densityGrid(opts);
  const densities = pointDensities(x, y, smoothed, grid.xEdges, grid.yEdges);
  const idx = plottedIndices(opts.sampleId, opts.downsampleCap ?? FLOW_SCATTER_CAP);
  return {
    data: [
      {
        type: "scattergl",
        mode: "markers",
        x: pick<number>(x, idx),
        y: pick<number>(y, idx),
        marker: {
          color: pick<number>(densities, idx),
          colorscale: "Viridis",
          cmin: 0,
          cmax: 1,
          showscale: true,
          size: 4,
        },
        showlegend: false,
      },
    ],
    layout: layoutFor(`Pseudocolor: ${opts.yParam} vs ${opts.xParam}`, opts.xParam, opts.yParam),
  };
}

/** The events inside a rect gate, as a filtered copy of one parameter. */
function gatedValues(sampleId: string, param: string, gate: FlowGateRect): Float32Array {
  const values = getColumn(sampleId, param);
  const [gx, gy] = columnsFor(sampleId, gate.xParam, gate.yParam);
  const kept: number[] = [];
  const n = Math.min(values.length, gx.length, gy.length);
  for (let r = 0; r < n; r++) {
    const xv = gx[r];
    const yv = gy[r];
    if (xv >= gate.xMin && xv <= gate.xMax && yv >= gate.yMin && yv <= gate.yMax) kept.push(values[r]);
  }
  return Float32Array.from(kept);
}

/** Per-population histogram: one overlaid bar trace per population, all
 *  binned on the whole sample's range so the overlays compare directly. */
export function buildFlowHistogram(opts: FlowHistogramOptions): FlowFigure {
  const values = getColumn(opts.sampleId, opts.param);
  const bins = opts.bins ?? 32;
  let lo = Infinity;
  let hi = -Infinity;
  for (let r = 0; r < values.length; r++) {
    const v = values[r];
    if (Number.isFinite(v)) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  const range: [number, number] = lo === Infinity ? [0, 0] : [lo, hi];
  const populations: { name: string; gate: FlowGateRect | null }[] = opts.populations ?? [
    { name: opts.param, gate: null },
  ];
  const data = populations.map(({ name, gate }) => {
    const subset = gate ? gatedValues(opts.sampleId, opts.param, gate) : values;
    const { edges, counts } = histogram1D(subset, bins, range);
    return {
      type: "bar",
      name,
      x: binCenters(edges),
      y: counts,
      width: edges.map((e, i) => (i + 1 < edges.length ? edges[i + 1] - e : 0)).slice(0, bins),
      opacity: 0.7,
    };
  });
  return {
    data,
    layout: layoutFor(`Histogram: ${opts.param}`, opts.param, "Count", { bargap: 0, barmode: "overlay" }),
  };
}
