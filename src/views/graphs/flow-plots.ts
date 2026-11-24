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

const axesOnly = (xName: string, yName: string): GraphFigure => ({
  data: [],
  layout: { xaxis: { title: xName || "X" }, yaxis: { title: yName || "Y" } },
});

const asFigure = (fig: FlowFigure): GraphFigure => ({ data: fig.data, layout: fig.layout });

const dotPlot: GraphModule = {
  label: "Flow dot plot",
  family: "xy",
  defaults: { pointSize: 4 },
  points: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "");
    }
    return asFigure(
      buildFlowDotPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
        downsampleCap: options.flowDownsampleCap,
      }),
    );
  },
};

const densityPlot: GraphModule = {
  label: "Flow density plot",
  family: "heatmap",
  palette: "viridis",
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "");
    }
    return asFigure(
      buildFlowDensityPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
      }),
    );
  },
};

const contourPlot: GraphModule = {
  label: "Flow contour plot",
  family: "heatmap",
  palette: "viridis",
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "");
    }
    return asFigure(
      buildFlowContourPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
      }),
    );
  },
};

const pseudocolorPlot: GraphModule = {
  label: "Flow pseudocolor plot",
  family: "xy",
  defaults: { pointSize: 4 },
  points: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam || !options.flowYParam) {
      return axesOnly(options.flowXParam ?? "", options.flowYParam ?? "");
    }
    return asFigure(
      buildFlowPseudocolorPlot({
        sampleId: options.flowSampleId,
        xParam: options.flowXParam,
        yParam: options.flowYParam,
        bins: options.flowBins,
        downsampleCap: options.flowDownsampleCap,
      }),
    );
  },
};

const flowHistogram: GraphModule = {
  label: "Flow histogram",
  family: "histogram",
  defaults: { fill: 0.7 },
  patterns: () => true,
  build: (_columns: Column[], options: GraphOptions) => {
    if (!options.flowSampleId || !options.flowXParam) {
      return axesOnly(options.flowXParam ?? "", "Count");
    }
    return asFigure(
      buildFlowHistogram({
        sampleId: options.flowSampleId,
        param: options.flowXParam,
        bins: options.flowBins,
      }),
    );
  },
};

export const flowDotPlot = dotPlot;
export const flowDensityPlot = densityPlot;
export const flowContourPlot = contourPlot;
export const flowPseudocolorPlot = pseudocolorPlot;
export const flowHistogramPlot = flowHistogram;
