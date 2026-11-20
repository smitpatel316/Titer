// The Match section's live preview: the target graph drawn with the options the
// match would apply, so the user sees what their graph will look like before
// they commit — a miniature of the graph's own chart, rebuilt whenever the
// example or the ticked properties change.
import * as React from "react";
import { Row } from "../../components/inspector";
import { useProjectStore } from "../../store/use-project-store";
import type { GraphOptions, ProjectNode } from "../../store/types";
import { buildPanelFigure } from "../figures/panel-figure";
import { loadPlotly } from "./plotly";
import type { GraphFigure } from ".";

/** The figure the target graph would draw with `options` — the match preview's
 *  figure, built the way a figure panel builds its graph's (the same base chart,
 *  no live-analysis overlays). Null when the graph has nothing to draw. */
export function previewFigure(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  options: GraphOptions,
): GraphFigure | null {
  return buildPanelFigure({ ...node, graphOptions: options }, nodes);
}

// The miniature's height: the inspector is narrow (256 px by default), so a
// fixed short height keeps the preview readable without pushing the toggles
// far down the panel.
const PREVIEW_HEIGHT = 180;

/** A live miniature of `graphId` drawn with `options` — what Apply would make
 *  of the graph. Static (no hover, zoom or drag): it is a preview, not a view. */
export function MatchPreview({ graphId, options }: { graphId: string; options: GraphOptions }) {
  const { nodes } = useProjectStore();
  const node = nodes[graphId];
  // The figure is memoised on the options' serialisation, not their identity:
  // `matched()` builds a fresh object on every render of the section, and
  // re-plotting Plotly on every render would stutter the toggles. Two option
  // sets that serialise the same build the same figure anyway.
  const optionsKey = JSON.stringify(options);
  const fig = React.useMemo(
    () => (node ? previewFigure(node, nodes, options) : null),
    // The closure reads the current `options` whenever the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, nodes, optionsKey],
  );

  const boxRef = React.useRef<HTMLDivElement>(null);
  const plotRef = React.useRef<HTMLDivElement>(null);
  const plottedRef = React.useRef<HTMLDivElement | null>(null);
  // The inspector's width is the preview's: measure the box, so resizing the
  // inspector re-plots it at the new width.
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const update = () => setWidth((w) => (w === el.clientWidth ? w : el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  React.useEffect(() => {
    const el = plotRef.current;
    if (!el || !fig || !width) return;
    let current = true;
    void loadPlotly().then(async (Plotly) => {
      if (!current) return;
      await Plotly.react(
        el,
        fig.data,
        { ...fig.layout, width, height: PREVIEW_HEIGHT },
        { displayModeBar: false, scrollZoom: false, doubleClick: false, staticPlot: true },
      );
      if (!current) return;
      plottedRef.current = el;
    });
    return () => {
      current = false;
    };
  }, [fig, width]);

  // Frees Plotly's resources when the preview has nothing to draw, or leaves the view.
  React.useEffect(() => {
    if (fig) return;
    const el = plottedRef.current;
    plottedRef.current = null;
    if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
  }, [fig]);
  React.useEffect(
    () => () => {
      const el = plottedRef.current;
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    },
    [],
  );

  if (!node) return null;
  return (
    <Row label="Preview">
      <div ref={boxRef} className="overflow-hidden rounded-md border border-separator bg-white">
        {fig ? (
          <div ref={plotRef} style={{ width: "100%", height: PREVIEW_HEIGHT }} />
        ) : (
          <div
            className="flex items-center justify-center px-2 text-center text-small text-secondary"
            style={{ height: PREVIEW_HEIGHT }}
          >
            Graph “{node.name}” has nothing to draw yet.
          </div>
        )}
      </div>
    </Row>
  );
}
