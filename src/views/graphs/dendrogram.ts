// "Dendrogram" of a Hierarchical clustering: the merge tree as R's
// plot.hclust draws it — leaves left-to-right in the tree's order, each
// merge a vertical rise from its children to its height joined by a
// horizontal bar, with a dashed line at the height the tree is cut into the
// chosen k clusters. Family `multiple`: the tree comes from a sibling
// hierarchical-clustering analysis's cached runAnalysis result (see
// graph-view.tsx) — the graph draws only its axes until one is chosen,
// exactly like the forest plot (see forest-plot.ts).
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, HclustDendrogram } from "../../stats/types";
import type { Column } from "../../lib/dataset";
import { GUIDE, type Paint, XY_AXES, xyLayout } from "./plot-helpers";
import type { GraphFigure, GraphModule } from ".";

/** The one series this graph draws, as the Series section names it. */
export const DENDROGRAM_SERIES = "Dendrogram";

/** The tree's segments, as one Plotly line trace's points with nulls
 *  between segments — pure geometry from the merge matrix, heights and leaf
 *  order, so it is unit-testable without a figure. R's merge convention:
 *  a negative entry −i is leaf i (1-based), a positive entry j is merge
 *  step j (1-based); a step's children are always leaves or earlier steps,
 *  so one pass in step order places every node. A leaf sits at its position
 *  in the leaf order (1-based); a merge sits at its children's midpoint. */
export function dendrogramSegments(tree: HclustDendrogram): {
  xs: (number | null)[];
  ys: (number | null)[];
} {
  const n = tree.order.length;
  const position = new Array<number>(n).fill(0);
  tree.order.forEach((leaf, i) => {
    position[leaf] = i + 1;
  });
  // centre[s] is merge step s's x (1-based steps, so index 0 stays unused).
  const centre = new Array<number>(n).fill(0);
  const heightOf = (entry: number): number => (entry < 0 ? 0 : (tree.heights[entry - 1] ?? 0));
  const centreOf = (entry: number): number => (entry < 0 ? position[-entry - 1] : centre[entry]);
  const xs: (number | null)[] = [];
  const ys: (number | null)[] = [];
  const seg = (x1: number, y1: number, x2: number, y2: number): void => {
    xs.push(x1, x2, null);
    ys.push(y1, y2, null);
  };
  for (let s = 1; s <= n - 1; s++) {
    const [a, b] = tree.merge[s - 1] ?? [0, 0];
    const h = tree.heights[s - 1] ?? 0;
    const ca = centreOf(a);
    const cb = centreOf(b);
    centre[s] = (ca + cb) / 2;
    seg(ca, heightOf(a), ca, h);
    seg(cb, heightOf(b), cb, h);
    seg(ca, h, cb, h);
  }
  return { xs, ys };
}

/** Draw the dendrogram of a hierarchical-clustering result onto a
 *  dendrogram figure (its build's axes). No-op when the result has no tree
 *  (not a hierarchical-clustering result, or the fit failed). */
export function addDendrogram(
  fig: GraphFigure,
  outcome: AnalysisResult,
  paint: Paint,
  _options: GraphOptions,
): void {
  const tree = outcome.hclustDendrogram;
  if (!tree || !tree.order.length) return;
  const n = tree.order.length;
  const { xs, ys } = dendrogramSegments(tree);
  const layout = fig.layout as Record<string, unknown>;
  layout.showlegend = true;
  // The leaves are positions 1..n; their titles label the ticks while
  // they fit (40 or fewer — past that the titles collide and the numbers
  // stand on their own).
  layout.xaxis = {
    ...(layout.xaxis as Record<string, unknown>),
    range: [0.5, n + 0.5],
    autorange: false,
    tickvals: Array.from({ length: n }, (_, i) => i + 1),
    ...(n <= 40
      ? {
          ticktext: tree.order.map((leaf) => tree.labels[leaf] ?? `Row ${leaf + 1}`),
          tickangle: -45,
        }
      : {}),
  };
  if (tree.cutHeight != null) {
    layout.shapes = [
      ...((layout.shapes as unknown[] | undefined) ?? []),
      {
        type: "line",
        x0: 0.5,
        x1: n + 0.5,
        y0: tree.cutHeight,
        y1: tree.cutHeight,
        line: { color: GUIDE, width: 1, dash: "dash" },
      },
    ];
  }
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      name: DENDROGRAM_SERIES,
      x: xs,
      y: ys,
      line: paint.line(DENDROGRAM_SERIES, 0),
      hoverinfo: "x+y",
      showlegend: true,
    },
  ];
}

function build(_columns: Column[], options: GraphOptions, _paint: Paint): GraphFigure {
  return {
    data: [],
    layout: xyLayout(options, "Row", 1, { yName: "Distance", zeroBase: true }),
  };
}

export const dendrogram: GraphModule = {
  label: "Dendrogram",
  family: "multiple",
  axes: XY_AXES,
  points: () => false,
  build,
};
