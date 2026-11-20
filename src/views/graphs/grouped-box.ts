// Grouped "Box and violin": at each row, a box (whiskers per `options.whisker`) or
// violin per group drawn from its replicates, groups side by side as on
// Interleaved scatter (or in blocks, "Separated"). One shape trace per group, so
// each carries its series color; its points are a trace of their own at
// Interleaved scatter's places, so a point keeps its place and its own style
// from one graph to the other. Values past the whiskers are drawn as points of
// their own while the points are hidden ("min-max-all" always shows all points).
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import { groupsOf, type Column } from "../../lib/dataset";
import {
  boxTrace,
  groupOffset,
  groupedScatterLayout,
  jitter,
  rowCountOf,
  rowLabels,
  separatedPositions,
  seriesPoints,
  whiskerBounds,
  type Paint,
} from "./plot-helpers";
import { pointKeyOf } from "../../lib/columns";

function build(columns: Column[], options: GraphOptions, paint: Paint, titles?: (string | null)[]): GraphFigure {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const labels = rowLabels(rows, titles);
  const total = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(total, labels) : undefined;
  // A shape fills most of the room its group has in a row, never more than a column's.
  const width = separated || total < 2 ? 0.5 : Math.min(0.5, (0.56 / (total - 1)) * 0.8);
  const data: unknown[] = [];

  groups.forEach((g, gi) => {
    const basePos = (r: number) => (separated ? separated.posOf(gi, r) : r + groupOffset(gi, total));
    const x: number[] = [];
    const y: number[] = [];
    const px: number[] = [];
    const keys: string[] = [];
    for (let r = 0; r < rows; r++) {
      g.columns.forEach((c, ci) => {
        const v = c.byRow[r] ?? null;
        if (v == null) return;
        x.push(basePos(r));
        y.push(v);
        px.push(basePos(r) + jitter(gi, r * 10 + ci) * 0.4);
        keys.push(pointKeyOf(c.name, r));
      });
    }
    const shape = {
      name: g.name,
      x,
      y,
      width,
      fillcolor: paint.fill(g.name, gi),
      line: paint.edge(g.name, gi),
      hoverinfo: "y",
    };
    // A box per row: the group's values there, as Helix computes them (`boxTrace`).
    const at = [...new Set(x)];
    data.push(
      options.kind === "violin"
        ? {
            type: "violin",
            ...shape,
            points: false,
            meanline: { visible: true },
            spanmode: options.violinVariant === "full" ? "soft" : "hard",
            ...(options.violinVariant === "half" ? { side: "positive" } : {}),
          }
        : {
            type: "box",
            ...shape,
            ...boxTrace(
              at,
              at.map((p) => y.filter((_, k) => x[k] === p)),
              options.whisker,
            ),
            y: undefined,
            boxpoints: false,
            whiskerwidth: 0.5,
          },
    );
    const showPoints = options.showPoints || options.whisker === "min-max-all";
    if (showPoints) {
      data.push({
        type: "scatter",
        mode: "markers",
        x: px,
        y,
        ...seriesPoints(paint, g.name, gi, keys),
        hoverinfo: "y",
        showlegend: false,
      });
    }
    if (options.kind === "box" && !showPoints) {
      // Outliers past the whiskers, one per (row, replicate): at the box's
      // own place, so they sit on its center line.
      const ox: number[] = [];
      const oy: number[] = [];
      const okeys: string[] = [];
      for (let r = 0; r < rows; r++) {
        const rowVals = g.columns.flatMap((c) => (c.byRow[r] == null ? [] : [{ v: c.byRow[r]!, col: c.name }]));
        if (rowVals.length === 0) continue;
        const { outliers } = whiskerBounds(
          rowVals.map((p) => p.v),
          options.whisker,
        );
        for (const p of rowVals) {
          if (!outliers.includes(p.v)) continue;
          ox.push(basePos(r));
          oy.push(p.v);
          okeys.push(pointKeyOf(p.col, r));
        }
      }
      if (oy.length) {
        data.push({
          type: "scatter",
          mode: "markers",
          x: ox,
          y: oy,
          ...seriesPoints(paint, g.name, gi, okeys),
          hoverinfo: "y",
          showlegend: false,
        });
      }
    }
  });

  return { data, layout: groupedScatterLayout(options, labels, total, separated, groups.map((g) => g.name)) };
}

export const groupedBox: GraphModule = {
  label: "Box and violin",
  family: "grouped",
  defaults: { fill: 0.5, pointSize: 5, outline: 2 },
  points: (options) => options.showPoints || options.whisker === "min-max-all",
  build,
};
