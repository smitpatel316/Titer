// Generated-curves overlay: draws a sibling "Plot a function" analysis's
// curves on an XY scatter — no re-evaluation here, the runner already put
// the X grid and each curve's Y (plus its extra series, when asked for) on
// the cached result. A null Y is a point the equation cannot give (a log at
// X ≤ 0, a pole): Plotly leaves a gap there, as the results view leaves the
// cell blank, instead of joining across it. The curves are appended after
// the table's own series, so they sit on top of the points.
import type { AnalysisResult } from "../../stats/types";
import type { GraphFigure } from ".";
import type { Paint } from "./plot-helpers";

/** The generated curves of `result` as line traces on `fig` — one per curve,
 *  its extra series dashed in the same colour beside it. `firstIndex` is
 *  where the generated curves start in the palette, past the table's own
 *  series, so their colours don't repeat the points'. */
export function addGeneratedCurves(
  fig: GraphFigure,
  result: AnalysisResult,
  paint: Paint,
  firstIndex = 0,
) {
  const generated = result.generatedCurves;
  if (!generated) return;
  const traces: unknown[] = [];
  generated.curves.forEach((curve, i) => {
    const color = paint.color(curve.label, firstIndex + i);
    traces.push({
      type: "scatter",
      mode: "lines",
      x: generated.x,
      y: curve.y,
      name: curve.label,
      line: { color, width: 1.5 },
      hoverinfo: "x+y",
      showlegend: true,
    });
    if (curve.extra) {
      traces.push({
        type: "scatter",
        mode: "lines",
        x: generated.x,
        y: curve.extra.y,
        name: curve.extra.label,
        line: { color, width: 1.5, dash: "dash" },
        hoverinfo: "x+y",
        showlegend: true,
      });
    }
  });
  fig.data = [...fig.data, ...traces];
}
