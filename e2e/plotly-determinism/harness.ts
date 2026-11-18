// Plotly-determinism pin harness (lane: e2e-conv/plotly, Plane seq 189).
//
// Drives the REAL export code — `renderGraphImage` from
// src/store/mcp-export.ts, the function behind `titer_export_graph` —
// in a plain browser page served by vite (`npm run web`), with no app
// build and no MCP server. Exports the same XY scatter graph twice as
// SVG and reports whether the Plotly ids agree.
//
// Run: vite on :1420, then headless Chromium --dump-dom with a virtual
// time budget; read the JSON in <pre id="result">.
//
// Before the fix the two exports differ in ids only (Plotly draws a
// fresh per-render uid from Math.random()); after the fix the exported
// SVGs are byte-identical.
import { renderGraphImage } from "/src/store/mcp-export.ts";
import { renderFigureSvg } from "/src/views/figures/figure-export.ts";
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

const graph2: ProjectNode = {
  id: "g2",
  type: "graph",
  name: "Graph 2",
  parentId: "t1",
  graphType: "xy-scatter",
};

const figure: ProjectNode = {
  id: "f1",
  type: "figure",
  name: "Figure 1",
  parentId: null,
  panels: [
    { graphId: "g1", label: "A", title: "", row: 0, col: 0, rowSpan: 1, colSpan: 1 },
    { graphId: "g2", label: "B", title: "", row: 0, col: 1, rowSpan: 1, colSpan: 1 },
  ],
  grid: { rows: 1, cols: 2 },
  figureSize: { widthIn: 10, heightIn: 7.5 },
};

const nodes: Record<string, ProjectNode> = { t1: table, g1: graph, g2: graph2, f1: figure };

/** Every Plotly random id in an exported SVG, by family (L8 §3: exactly
 *  these five patterns — defs/topdefs/clip/legend/trace — carry the
 *  per-render uid). */
function extractIds(svg: string): Record<string, string[]> {
  const pick = (re: RegExp) => [...new Set([...svg.matchAll(re)].map((m) => m[0]))].sort();
  return {
    defs: pick(/defs-[0-9a-f]{6}/g),
    topdefs: pick(/topdefs-[0-9a-f]{6}/g),
    clip: pick(/clip[0-9a-f]{6}[a-z]*/g),
    legend: pick(/legend[0-9a-f]{6}/g),
    trace: pick(/trace[0-9a-f]{6}/g),
  };
}

/** The L8 normalizer, used here only as a diagnostic: if the two SVGs
 *  agree after id-normalization, ids were the ONLY difference. */
function normalizeIds(svg: string): string {
  return canonicalizeRootTag(
    svg
      .replace(/defs-[0-9a-f]{6}/g, "defs-000000")
      .replace(/topdefs-[0-9a-f]{6}/g, "topdefs-000000")
      .replace(/clip[0-9a-f]{6}/g, "clip000000")
      .replace(/legend[0-9a-f]{6}/g, "legend000000")
      .replace(/trace[0-9a-f]{6}/g, "trace000000"),
  );
}

/** Canonicalize the root <svg> tag's attribute order (alphabetical by
 *  name): Plotly's toImage flips `style=""` vs `viewBox="..."` between
 *  renders, which is the only non-id difference left. Attribute order
 *  has no XML semantics. Fail-open: returns the input unchanged when
 *  the root tag doesn't parse. */
function canonicalizeRootTag(svg: string): string {
  const open = svg.indexOf("<svg");
  if (open < 0) return svg;
  let i = open + 4;
  let inQuote: string | null = null;
  while (i < svg.length) {
    const ch = svg[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") inQuote = ch;
    else if (ch === ">") break;
    i++;
  }
  if (i >= svg.length) return svg;
  const inner = svg.slice(open + 4, i);
  const attrs = [...inner.matchAll(/([^\s=/>]+)="([^"]*)"/g)];
  if (!attrs.length) return svg;
  attrs.sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return svg.slice(0, open) + "<svg " + attrs.map((a) => `${a[1]}="${a[2]}"`).join(" ") + ">" + svg.slice(i + 1);
}

async function main() {
  const out = document.getElementById("result")!;
  try {
    const size = { width: 640, height: 460 };
    const svgs: string[] = [];
    for (let k = 0; k < 4; k++) {
      const r = await renderGraphImage(graph, nodes, "svg", "300", size);
      svgs.push(new TextDecoder().decode(r.bytes));
    }
    const svgA = svgs[0];
    const svgB = svgs[1];
    const idsA = extractIds(svgA);
    const idsB = extractIds(svgB);
    const idsEqual = JSON.stringify(idsA) === JSON.stringify(idsB);
    // Character-level diff of the id-normalized SVGs: where do they still
    // differ, if anywhere? (First 5 runs, with 40 chars of context each.)
    const normA = normalizeIds(svgA);
    const normB = normalizeIds(svgB);
    const diffRuns: { at: number; a: string; b: string }[] = [];
    let i = 0;
    while (i < Math.min(normA.length, normB.length) && diffRuns.length < 5) {
      if (normA[i] !== normB[i]) {
        let j = i;
        while (j < Math.min(normA.length, normB.length) && normA[j] !== normB[j]) j++;
        diffRuns.push({
          at: i,
          a: normA.slice(Math.max(0, i - 40), Math.min(normA.length, j + 40)),
          b: normB.slice(Math.max(0, i - 40), Math.min(normB.length, j + 40)),
        });
        i = j;
      } else i++;
    }
    // Root <svg> tag of each export, to see the attribute-order flip.
    const rootTag = (s: string) => s.slice(0, s.indexOf(">") + 1);
    // Figure path: two panels composed into ONE svg — the panels must
    // keep distinct id scopes (no duplicate id="…" values) and two
    // figure exports must be byte-identical.
    const figA = await renderFigureSvg(figure, nodes, "300");
    const figB = await renderFigureSvg(figure, nodes, "300");
    const figIds = [...figA.svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const dupIds = figIds.filter((v, i) => figIds.indexOf(v) !== i);
    const report = {
      ids_equal: idsEqual,
      bytes_equal: svgA === svgB,
      bytes_equal_after_id_normalize: normA === normB,
      svg_bytes: [svgA.length, svgB.length],
      diff_runs_after_id_normalize: diffRuns,
      root_tags: svgs.map(rootTag),
      all_four_bytes_equal_after_id_normalize: svgs.map(normalizeIds).every((s) => s === normalizeIds(svgs[0])),
      figure_bytes_equal: figA.svg === figB.svg,
      figure_scopes_present: ["p0", "p1"].every((p) => figA.svg.includes(`clip${p}`)),
      figure_duplicate_ids: [...new Set(dupIds)],
      ids_export_1: idsA,
      ids_export_2: idsB,
    };
    out.textContent = JSON.stringify(report, null, 2);
    document.title = "PIN-DONE";
  } catch (err) {
    out.textContent = JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2);
    document.title = "PIN-ERROR";
  }
}

void main();
