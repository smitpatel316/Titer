// Discriminating test: does the root-<svg> attribute-order flip come
// from Plotly.toImage alone, or from the react -> toImage sequence in
// renderGraphImage? Exports the same figure 4x via toImage only.
import { buildPanelFigure } from "/src/views/figures/panel-figure.ts";
import { loadPlotly } from "/src/views/graphs/plotly.ts";
import { withoutSelection } from "/src/views/graphs/selection.ts";
import { vectorTraces } from "/src/views/graphs/plot-helpers.ts";
import type { ProjectNode } from "/src/store/types.ts";

const table: ProjectNode = {
  id: "t1",
  type: "table",
  name: "Data 1",
  parentId: null,
  tableType: "xy",
  data: {
    columns: ["Title", "X", "Y1", "Y2"],
    rows: [
      ["1", "0", "1.0", "2.0"],
      ["2", "1", "1.5", "2.5"],
      ["3", "2", "2.2", "3.1"],
      ["4", "3", "3.0", "4.0"],
      ["5", "4", "4.1", "5.2"],
      ["6", "5", "5.0", "6.1"],
    ],
  },
};

const graph: ProjectNode = {
  id: "g1",
  type: "graph",
  name: "Graph 1",
  parentId: "t1",
  graphType: "xy-scatter",
};

const nodes: Record<string, ProjectNode> = { t1: table, g1: graph };

function normalizeIds(svg: string): string {
  return svg
    .replace(/defs-[0-9a-f]{6}/g, "defs-000000")
    .replace(/topdefs-[0-9a-f]{6}/g, "topdefs-000000")
    .replace(/clip[0-9a-f]{6}/g, "clip000000")
    .replace(/legend[0-9a-f]{6}/g, "legend000000")
    .replace(/trace[0-9a-f]{6}/g, "trace000000");
}

async function main() {
  const out = document.getElementById("result")!;
  try {
    const fig = buildPanelFigure(graph, nodes)!;
    const Plotly = await loadPlotly();
    const svgs: string[] = [];
    for (let k = 0; k < 4; k++) {
      const figure = { data: vectorTraces(withoutSelection(fig.data as never[])), layout: fig.layout };
      const url = await Plotly.toImage(figure as never, { format: "svg", width: 640, height: 460, scale: 1 });
      svgs.push(await (await fetch(url)).text());
    }
    const normed = svgs.map(normalizeIds);
    const report = {
      all_four_bytes_equal_after_id_normalize: normed.every((s) => s === normed[0]),
      root_tags: svgs.map((s) => s.slice(0, s.indexOf(">") + 1)),
    };
    out.textContent = JSON.stringify(report, null, 2);
    document.title = "PIN-DONE";
  } catch (err) {
    out.textContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2);
    document.title = "PIN-ERROR";
  }
}

void main();
