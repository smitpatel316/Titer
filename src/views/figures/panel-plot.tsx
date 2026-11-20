// One panel of the figure editor: the graph's chart drawn with Plotly at the
// panel's size (see panel-figure.ts for what it draws), or the placeholder
// when the graph is gone or has nothing to draw.
//
// The panel starts from the synchronous base figure (`buildPanelFigure`) so
// it paints at once, then upgrades to the full figure (`buildGraphFigure`,
// seq 173) when the graph's overlay analyses resolve — so the preview shows
// the same brackets and curves the export draws, instead of the bare base
// chart. A re-run that lands late (after the graph changed again) is
// dropped, and a failed overlay run leaves the base figure up.
import * as React from "react";
import type { ProjectNode } from "../../store/types";
import { loadPlotly } from "../graphs/plotly";
import { buildPanelFigure } from "./panel-figure";
import { buildGraphFigure } from "../graphs/graph-figure";
import type { GraphFigure } from "../graphs";

export function PanelPlot({
  graph,
  nodes,
  width,
  height,
  hideLegend,
  onPlot,
}: {
  graph: ProjectNode;
  nodes: Record<string, ProjectNode>;
  width: number;
  height: number;
  /** True while the figure shows one shared legend: the panel draws none. */
  hideLegend?: boolean;
  /** The drawn element (for per-panel export, which reuses `saveGraphImage`). */
  onPlot: (el: HTMLElement | null) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const plottedRef = React.useRef<HTMLDivElement | null>(null);
  const [fig, setFig] = React.useState<GraphFigure | null>(() =>
    buildPanelFigure(graph, nodes, { hideLegend }),
  );

  React.useEffect(() => {
    let current = true;
    // The base figure paints at once (below); the full figure replaces it
    // when the overlays resolve. A base figure that is already the full
    // figure (no overlays to resolve) stays as it is.
    setFig(buildPanelFigure(graph, nodes, { hideLegend }));
    void buildGraphFigure(graph, nodes, { hideLegend }).then(({ figure }) => {
      if (current && figure) setFig(figure);
    });
    return () => {
      current = false;
    };
  }, [graph, nodes, hideLegend]);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || !fig) return;
    let current = true;
    void loadPlotly().then(async (Plotly) => {
      if (!current) return;
      await Plotly.react(
        el,
        fig.data,
        { ...fig.layout, width, height },
        { displayModeBar: false, scrollZoom: false, doubleClick: false },
      );
      if (!current) return;
      plottedRef.current = el;
      onPlot(el);
    });
    return () => {
      current = false;
    };
  }, [fig, width, height]);

  React.useEffect(
    () => () => {
      const el = plottedRef.current;
      plottedRef.current = null;
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    },
    [],
  );

  if (!fig)
    return (
      <div className="flex h-full w-full items-center justify-center bg-white px-2 text-center text-small text-secondary">
        Graph “{graph.name}” has nothing to draw yet.
      </div>
    );
  return <div ref={ref} style={{ width, height }} />;
}
