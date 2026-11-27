// FlowJo graph modules (seq 442): the density-plot viewer's Plotly
// figures as GraphModules, so they ride the existing registry + export
// pipeline (PNG/TIFF/SVG; scattergl traces convert to plain scatter on
// export via `vectorTraces`, as the volcano does).
//
// A flow graph reads its events from the event store
// (src/flow/store.ts), not from a table — `build` ignores the table
// columns and plots the sample + parameters named by the graph options
// (`flowSampleId` / `flowXParam` / `flowYParam` / `flowBins` /
// `flowDownsampleCap`). With no sample named it draws its axes only, never
// crashes. These types are NOT in GRAPH_OPTIONS_BY_TABLE: no picker offers
// them while the flow toggle is off (opt-in, off by default).
import type { GraphOptions } from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure, GraphModule } from ".";
import {
  buildFlowContourPlot,
  buildFlowDensityPlot,
  buildFlowDotPlot,
  buildFlowHistogram,
  buildFlowPseudocolorPlot,
  type FlowFigure,
} from "../../flow/viewer";
import { XY_AXES, xAxisRange, yAxisRange } from "./plot-helpers";

/** A flow figure with the Format panel's axis scale/range/step applied to
 *  its layout: the flow builders draw values on both axes (XY_AXES), so a
 *  log scale or a typed bound must reach the layout — the viewer itself
 *  knows nothing of GraphOptions (it never imports outside src/flow).
 *  The axes-only figure gets it too, so the settings move the axes even
 *  before a sample is named. Titles are untouched: the range helpers
 *  return only type/ticks/range, never a title. */
const withAxes = (fig: GraphFigure, options: GraphOptions): GraphFigure => ({
  ...fig,
  layout: {
    ...fig.layout,
    xaxis: {
      ...((fig.layout.xaxis as Record<string, unknown> | undefined) ?? {}),
      ...xAxisRange(options, undefined, options.gridX),
    },
    yaxis: {
      ...((fig.layout.yaxis as Record<string, unknown> | undefined) ?? {}),
      ...yAxisRange(options, undefined, options.gridY),
    },
  },
});

const axesOnly = (xName: string, yName: string, options: GraphOptions): GraphFigure =>
  withAxes(
    {
      data: [],
      layout: { xaxis: { title: xName || "X" }, yaxis: { title: yName || "Y" } },
    },
    options,
  );

const asFigure = (fig: FlowFigure, options: GraphOptions): GraphFigure =>
  withAxes({ data: fig.data, layout: fig.layout }, options);

const dotPlot: GraphModule = {
  label: "Flow dot plot",
  family: "xy",
  axes: XY_AXES,
  defaults: { pointSize: 4 },
  points: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "", options);
    }
    return asFigure(
      buildFlowDotPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
        downsampleCap: options.flowDownsampleCap,
      }),
      options,
    );
  },
};

const densityPlot: GraphModule = {
  label: "Flow density plot",
  family: "heatmap",
  axes: XY_AXES,
  palette: "viridis",
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "", options);
    }
    return asFigure(
      buildFlowDensityPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
      }),
      options,
    );
  },
};

const contourPlot: GraphModule = {
  label: "Flow contour plot",
  family: "heatmap",
  axes: XY_AXES,
  palette: "viridis",
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "", options);
    }
    return asFigure(
      buildFlowContourPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
      }),
      options,
    );
  },
};

const pseudocolorPlot: GraphModule = {
  label: "Flow pseudocolor plot",
  family: "xy",
  axes: XY_AXES,
  defaults: { pointSize: 4 },
  points: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "", options);
    }
    return asFigure(
      buildFlowPseudocolorPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
        downsampleCap: options.flowDownsampleCap,
      }),
      options,
    );
  },
};

const flowHistogram: GraphModule = {
  label: "Flow histogram",
  family: "histogram",
  axes: XY_AXES,
  defaults: { fill: 0.7 },
  patterns: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam) {
      return axesOnly(options.flowXParam ?? "", "Count", options);
    }
    return asFigure(
      buildFlowHistogram({
        sampleId: options.flowSampleId,
        param: options.flowXParam,
        bins: options.flowBins,
      }),
      options,
    );
  },
};

export const flowDotPlot = dotPlot;
export const flowDensityPlot = densityPlot;
export const flowContourPlot = contourPlot;
export const flowPseudocolorPlot = pseudocolorPlot;
export const flowHistogramPlot = flowHistogram;
