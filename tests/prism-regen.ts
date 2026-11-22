// Graph-regen tests (Plane seq 291, 1.8.1 fast follow-up).
//
//   R1  sidecar mapping table (§3): every dataset-format row, BUG-9
//       precedence (table y_cv_n beats dataset y_sd_n), xy + linked
//       nonlinear fit, grouped / survival / contingency / nested,
//       unknown format, isAutoCreated=false, missing inputDataSets,
//       unresolvable source, missing graph sheet
//   R2  heuristic rules H1–H6 (§4) on .pzfx-shaped tables
//   R3  `applyRegenDecisions`: one decision per proposal, unknown /
//       duplicate / missing decisions refused, unreconstructible never
//       confirmed, overrides validated, creation via createGraph +
//       renameNode with the plan's name
//   R4  the MCP pair: list returns the same plans the dialog shows,
//       regenerate refuses missing/unknown decisions, a completed run
//       consumes the plans
//   R5  the import-time plan registry (set / get / project-id guard / clear)
//   R6  the REAL Prism encoding (seq 313): graph inputDataSets as BARE
//       STRINGS — the planner must resolve them end to end, and the
//       "Source table not imported" reason stays only for genuinely
//       missing tables; the converter tolerates a bare-string analysis
//       input too (defensive — real analysis sheets use objects).
//
// Fixtures are synthetic `.prism` ZIPs built here (following tests/prism.ts
// P15) — never Mansi's files, never a real Prism install. The Y CV row
// (R1) pins the design's derived-SD mapping; whether Prism's Y CV auto
// graph actually draws SD bars is still UNVERIFIED against real Prism 11
// (design §3 open point) — the derivation is disclosed on the row, and if
// Prism draws something else this row changes, it doesn't ship as fact.
/// <reference types="node" />
import JSZip from "jszip";
import { convertPrism, formatReport } from "../src/lib/prism";
import {
  applyRegenDecisions,
  clearRegenPlans,
  getRegenPlans,
  mapSidecarGraph,
  planGraphRegeneration,
  planPzfxGraphs,
  regenPlanCounts,
  setRegenPlans,
  type GraphPlan,
  type RegenDecision,
} from "../src/lib/prism-graph-regen";
import type { PzfxImport } from "../src/lib/pzfx";
import type { GraphType, ProjectNode } from "../src/store/types";
import type { McpJob } from "../src/native";
import { executeListRegenerableGraphs, executeRegenerateGraphs } from "../src/store/mcp-graphs";

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail: string) {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures++;
}

const uid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ── Synthetic .prism builder ─────────────────────────────────────────────

interface FxDataset {
  uid: string;
  format: string;
  title: string;
  subs: number;
}
interface FxTable {
  sheet: string;
  table: string;
  name: string;
  format: string;
  dataFormat: string;
  datasets: FxDataset[];
  x?: { uid: string; title: string };
  replicatesCount?: number;
  rows: string[][];
}
interface FxGraph {
  uid: string;
  title: string;
  auto?: boolean;
  inputs?: string[];
  writeSheet?: boolean;
  /** Real Prism 11 writes graph inputDataSets as BARE STRINGS (seq 313);
   *  the synthetic default is {uid} objects. "strings" pins the real encoding. */
  inputEncoding?: "objects" | "strings";
}
interface FxAnalysis {
  uid: string;
  title: string;
  sheetUid: string;
  datasets: { uid: string; title: string }[];
  equation: string;
  /** Defensive tolerance only: real Prism writes analysis inputDataSets as
   *  {uid, title, idx} objects (verified across the public corpus) — a
   *  bare-string entry must still import, never silently drop the link. */
  inputsBare?: boolean;
}

const rep = () => ({
  "@class": "DriverReplicate",
  valueType: "real",
  commonAttributes: ["NUMERIC"],
  decimalsLength: 1,
  significantDigitsCount: 7,
  lastRow: 1,
  firstRow: 0,
});

async function buildFxZip(tables: FxTable[], graphs: FxGraph[], analyses: FxAnalysis[] = []): Promise<Uint8Array> {
  const z = new JSZip();
  const titles: Record<string, { title: string }> = {};
  for (const t of tables) titles[t.sheet] = { title: t.name };
  z.file(
    "document.json",
    JSON.stringify({
      "@class": "Document",
      createdBy: { name: "Prism", version: "10.3.0" },
      formatVersion: "1-4-1",
      sheets: {
        data: tables.map((t) => t.sheet),
        graphs: graphs.map((g) => g.uid),
        layouts: [],
        analyses: analyses.map((a) => a.uid),
        info: [],
      },
      sheetAttributesMap: titles,
    }),
  );
  for (const t of tables) {
    const totalCols = (t.x ? 1 : 0) + t.datasets.reduce((n, d) => n + d.subs, 0);
    z.file(
      `data/sheets/${t.sheet}/sheet.json`,
      JSON.stringify({
        "@class": "DataSheet",
        title: t.name,
        table: {
          uid: t.table,
          format: t.format,
          dataFormat: t.dataFormat,
          dataSets: t.datasets.map((d) => d.uid),
          ...(t.x ? { xDataSet: t.x.uid } : {}),
          ...(t.replicatesCount !== undefined ? { replicatesCount: t.replicatesCount } : {}),
        },
      }),
    );
    z.file(
      `data/tables/${t.table}/content.json`,
      JSON.stringify({ numberOfColumns: totalCols, numberOfRows: t.rows.length, version: 1 }),
    );
    z.file(`data/tables/${t.table}/data.csv`, t.rows.map((r) => r.join(",")).join("\n") + "\n");
    for (const d of t.datasets) {
      z.file(
        `data/sets/${d.uid}.json`,
        JSON.stringify({
          "@class": "DataSet",
          uid: d.uid,
          format: d.format,
          title: d.title,
          attributes: ["DS_ATTR_Y"],
          replicates: Array.from({ length: d.subs }, rep),
        }),
      );
    }
    if (t.x) {
      z.file(
        `data/sets/${t.x.uid}.json`,
        JSON.stringify({
          "@class": "DataSet",
          uid: t.x.uid,
          format: "y_single",
          title: t.x.title,
          attributes: ["DS_ATTR_X"],
          replicates: [rep()],
        }),
      );
    }
  }
  for (const g of graphs) {
    if (g.writeSheet === false) continue;
    z.file(
      `graphs/${g.uid}/sheet.json`,
      JSON.stringify({
        "@class": "GraphSheet",
        title: g.title,
        isAutoCreated: g.auto !== false,
        inputDataSets: (g.inputs ?? []).map((u) => (g.inputEncoding === "strings" ? u : { uid: u })),
      }),
    );
  }
  for (const a of analyses) {
    z.file(
      `analyses/${a.uid}/sheet.json`,
      JSON.stringify({
        "@class": "AnalysisSheet",
        title: a.title,
        analysisClass: "NONLINEAR_REGRESSION",
        inputSheets: [{ uid: a.sheetUid }],
        inputDataSets: a.inputsBare
          ? a.datasets.map((d) => d.uid)
          : a.datasets.map((d) => ({ uid: d.uid, title: d.title })),
      }),
    );
    z.file(
      `analyses/${a.uid}/parameters.json`,
      JSON.stringify({
        analysisClass: "NONLINEAR_REGRESSION",
        content: { model: { equation: { name: a.equation } } },
      }),
    );
  }
  return new Uint8Array(await z.generateAsync({ type: "uint8array" }));
}

const col = (sheetN: number, tableN: number, name: string, dataFormat: string, dsFormat: string, subs: number): FxTable => ({
  sheet: uid(sheetN),
  table: uid(tableN),
  name,
  format: "column",
  dataFormat,
  datasets: [{ uid: uid(tableN + 1), format: dsFormat, title: "A", subs }],
  rows: [
    ["1", "2", "3"].slice(0, subs),
    ["4", "5", "6"].slice(0, subs),
  ],
});

// ── R1: the sidecar mapping table ────────────────────────────────────────

const tables: FxTable[] = [
  col(11, 21, "Col replicates", "y_replicates", "y_replicates", 3),
  col(12, 22, "Col SD", "y_sd", "y_sd", 2),
  col(13, 23, "Col SD N", "y_sd_n", "y_sd_n", 3),
  col(14, 24, "Col SE", "y_se", "y_se", 2),
  col(15, 25, "Col SE N", "y_se_n", "y_se_n", 3),
  col(16, 26, "Col CV N", "y_cv_n", "y_cv_n", 3),
  // BUG-9: the table says y_cv_n, the dataset says y_sd_n — the table wins.
  col(17, 27, "Col CV table SD dataset", "y_cv_n", "y_sd_n", 3),
  col(18, 28, "Col single", "y_single", "y_single", 1),
  col(19, 29, "Col plus minus", "y_plus_minus", "y_plus_minus", 3),
  col(20, 30, "Col high low", "y_high_low", "y_high_low", 3),
  {
    sheet: uid(31), table: uid(41), name: "XY single", format: "xy", dataFormat: "y_single",
    datasets: [{ uid: uid(42), format: "y_single", title: "A", subs: 1 }],
    x: { uid: uid(43), title: "Dose" },
    rows: [["0", "1"], ["1", "2"]],
  },
  {
    sheet: uid(32), table: uid(44), name: "XY SD N", format: "xy", dataFormat: "y_sd_n",
    datasets: [{ uid: uid(45), format: "y_sd_n", title: "A", subs: 3 }],
    x: { uid: uid(46), title: "Dose" },
    rows: [["0", "1", "0.1", "5"], ["1", "2", "0.2", "5"]],
  },
  {
    sheet: uid(33), table: uid(47), name: "XY SE N", format: "xy", dataFormat: "y_se_n",
    datasets: [{ uid: uid(48), format: "y_se_n", title: "A", subs: 3 }],
    x: { uid: uid(49), title: "Dose" },
    rows: [["0", "1", "0.1", "5"], ["1", "2", "0.2", "5"]],
  },
  {
    sheet: uid(34), table: uid(50), name: "XY dose-response", format: "xy", dataFormat: "y_replicates",
    datasets: [{ uid: uid(51), format: "y_replicates", title: "Response", subs: 3 }],
    x: { uid: uid(52), title: "Dose" },
    rows: [["0", "1", "2", "3"], ["1", "4", "5", "6"]],
  },
  {
    sheet: uid(35), table: uid(53), name: "Grouped data", format: "grouped", dataFormat: "y_replicates",
    datasets: [
      { uid: uid(54), format: "y_replicates", title: "Control", subs: 2 },
      { uid: uid(55), format: "y_replicates", title: "Treated", subs: 2 },
    ],
    replicatesCount: 2,
    rows: [["1", "2", "3", "4"], ["5", "6", "7", "8"]],
  },
  {
    sheet: uid(36), table: uid(56), name: "Survival data", format: "survival", dataFormat: "y_single",
    datasets: [
      { uid: uid(57), format: "y_single", title: "A", subs: 1 },
      { uid: uid(58), format: "y_single", title: "B", subs: 1 },
    ],
    x: { uid: uid(59), title: "Days" },
    rows: [["1", "1", "0"], ["2", "1", "1"]],
  },
  {
    sheet: uid(37), table: uid(60), name: "Contingency data", format: "contingency", dataFormat: "y_single",
    datasets: [
      { uid: uid(61), format: "y_single", title: "Yes", subs: 1 },
      { uid: uid(62), format: "y_single", title: "No", subs: 1 },
    ],
    rows: [["10", "5"], ["8", "7"]],
  },
  {
    sheet: uid(38), table: uid(63), name: "Nested data", format: "nested", dataFormat: "y_sd_n",
    datasets: [{ uid: uid(64), format: "y_sd_n", title: "A", subs: 3 }],
    rows: [["1", "0.1", "5"], ["2", "0.2", "5"]],
  },
  col(39, 65, "Col unknown format", "y_weird", "y_weird", 2),
];

const graphFor = (n: number, table: FxTable, title: string, extra: Partial<FxGraph> = {}): FxGraph => ({
  uid: uid(100 + n),
  title,
  inputs: table.datasets.map((d) => d.uid),
  ...extra,
});

const graphs: FxGraph[] = [
  graphFor(1, tables[0], "Col replicates graph"),
  graphFor(2, tables[1], "Col SD graph"),
  graphFor(3, tables[2], "Col SD N graph"),
  graphFor(4, tables[3], "Col SE graph"),
  graphFor(5, tables[4], "Col SE N graph"),
  graphFor(6, tables[5], "Col CV N graph"),
  graphFor(7, tables[6], "Col CV table SD dataset graph"),
  graphFor(8, tables[7], "Col single graph"),
  graphFor(9, tables[8], "Col plus minus graph"),
  graphFor(10, tables[9], "Col high low graph"),
  graphFor(11, tables[10], "XY single graph"),
  graphFor(12, tables[11], "XY SD N graph"),
  graphFor(13, tables[12], "XY SE N graph"),
  graphFor(14, tables[13], "XY dose-response graph"),
  graphFor(15, tables[14], "Grouped graph"),
  graphFor(16, tables[15], "Survival graph"),
  graphFor(17, tables[16], "Contingency graph"),
  graphFor(18, tables[17], "Nested graph"),
  graphFor(19, tables[18], "Unknown format graph"),
  // Edge cases: hand-made, no inputs, unresolvable source, missing sheet.
  graphFor(20, tables[1], "Hand-made graph", { auto: false }),
  { uid: uid(121), title: "No inputs graph", inputs: [] },
  { uid: uid(122), title: "Missing source graph", inputs: ["deadbeef-dead-beef-dead-beefdeadbeef"] },
  { uid: uid(123), title: "Missing sheet graph", writeSheet: false },
];

const analyses: FxAnalysis[] = [
  {
    uid: uid(200),
    title: "Nonlin fit of XY dose-response",
    sheetUid: tables[13].sheet,
    datasets: [{ uid: uid(51), title: "Response" }],
    equation: "Sigmoidal, 4PL, X is log(concentration)",
  },
];

const bytes = await buildFxZip(tables, graphs, analyses);
const converted = await convertPrism(bytes, "regen-fixture.prism");
check("R1 fixture converts", converted.report.tables.length === 19, `${converted.report.tables.length} tables`);
check(
  "R1 nonlinear fit imported",
  converted.report.analyses.length === 1 && converted.report.analyses[0].includes("Nonlin fit"),
  converted.report.analyses.join("; "),
);
const plans = await planGraphRegeneration(await (async () => {
  const { default: JSZip } = await import("jszip");
  return JSZip.loadAsync(bytes);
})(), converted);
check("R1 one plan per graph", plans.length === 23, `${plans.length} plans`);

const byTitle = (title: string) => plans.find((p) => p.prismTitle === title)!;
const expectPlan = (
  title: string,
  graphType: string,
  error: string,
  extra: string,
) => {
  const p = byTitle(title);
  check(
    `R1 ${title}`,
    p.reconstructible && p.graphType === graphType && p.error === error,
    `${p.graphType}/${p.error} (want ${graphType}/${error}) ${extra}`,
  );
};
expectPlan("Col replicates graph", "mean-error", "sem", "replicates default SEM");
check(
  "R1 replicates offers individual/box-violin",
  JSON.stringify(byTitle("Col replicates graph").adjustAlternatives ?? []) === JSON.stringify(["individual", "box-violin"]),
  JSON.stringify(byTitle("Col replicates graph").adjustAlternatives),
);
expectPlan("Col SD graph", "mean-error", "sd", "");
expectPlan("Col SD N graph", "mean-error", "sd", "");
expectPlan("Col SE graph", "mean-error", "sem", "");
expectPlan("Col SE N graph", "mean-error", "sem", "");
expectPlan("Col CV N graph", "mean-error", "sd", "derived SD");
check(
  "R1 y_cv_n discloses the derivation (UNVERIFIED vs real Prism 11)",
  (byTitle("Col CV N graph").derivedError ?? "").includes("mean × CV% / 100"),
  byTitle("Col CV N graph").derivedError ?? "no disclosure",
);
expectPlan("Col CV table SD dataset graph", "mean-error", "sd", "BUG-9: table y_cv_n wins over dataset y_sd_n");
check(
  "R1 BUG-9 row discloses the derivation",
  (byTitle("Col CV table SD dataset graph").derivedError ?? "").includes("mean × CV% / 100"),
  byTitle("Col CV table SD dataset graph").derivedError ?? "no disclosure",
);
expectPlan("Col single graph", "mean-error", "none", "single value per group");
expectPlan("Col plus minus graph", "mean-error", "none", "asymmetric");
check(
  "R1 plus-minus discloses the asymmetric limit",
  (byTitle("Col plus minus graph").limitNote ?? "").includes("asymmetric"),
  byTitle("Col plus minus graph").limitNote ?? "no note",
);
expectPlan("Col high low graph", "mean-error", "none", "asymmetric");
expectPlan("XY single graph", "xy-scatter", "none", "");
expectPlan("XY SD N graph", "xy-scatter", "sd", "");
expectPlan("XY SE N graph", "xy-scatter", "sem", "");
const xyFit = byTitle("XY dose-response graph");
check(
  "R1 xy + nonlinear fit links the imported analysis",
  xyFit.reconstructible && xyFit.graphType === "xy-scatter" && xyFit.error === "sem" && !!xyFit.linkedAnalysisId,
  `${xyFit.graphType}/${xyFit.error} link=${xyFit.linkedAnalysisId ?? "none"}`,
);
check(
  "R1 sigmoidal fit offers logistic-curve as an Adjust alternative",
  JSON.stringify(xyFit.adjustAlternatives ?? []) === JSON.stringify(["logistic-curve"]),
  JSON.stringify(xyFit.adjustAlternatives),
);
check(
  "R1 linked analysis is the imported nonlinear node",
  converted.project.nodes[xyFit.linkedAnalysisId ?? ""]?.analysisType === "nonlinear-regression",
  converted.project.nodes[xyFit.linkedAnalysisId ?? ""]?.name ?? "no node",
);
expectPlan("Grouped graph", "grouped-bars", "sem", "");
check(
  "R1 grouped offers scatter/box/lines",
  JSON.stringify(byTitle("Grouped graph").adjustAlternatives ?? []) ===
    JSON.stringify(["grouped-scatter", "grouped-box", "grouped-lines"]),
  JSON.stringify(byTitle("Grouped graph").adjustAlternatives),
);
expectPlan("Survival graph", "survival", "none", "");
expectPlan("Contingency graph", "grouped-bars", "none", "");
expectPlan("Nested graph", "mean-error", "sd", "nested imports as column");

const expectUnreconstructible = (title: string, wantReason: string, plan?: GraphPlan) => {
  const p = plan ?? byTitle(title);
  check(
    `R1 ${title} — no proposal`,
    !p.reconstructible && p.graphType === null && (p.reason ?? "").includes(wantReason),
    p.reason ?? "reconstructible",
  );
};
expectUnreconstructible("Unknown format graph", "No confident mapping");
expectUnreconstructible("Hand-made graph", "Custom graph");
expectUnreconstructible("No inputs graph", "No source table recorded");
expectUnreconstructible("Missing source graph", "Source table not imported");
expectUnreconstructible("Missing sheet graph", "missing or unreadable", plans.find((p) => p.proposalId === `prism:${uid(123)}`));

const counts = regenPlanCounts(plans);
check("R1 counts", counts.regenerable === 18 && counts.notRegenerable === 5, `${counts.regenerable}/${counts.notRegenerable}`);
converted.report.regenerableGraphs = counts.regenerable;
check(
  "R1 report points at Regenerate",
  formatReport(converted.report).includes("Regenerate graphs… can rebuild the 18 auto-created ones"),
  "pointer missing",
);

// Direct mapping checks the fixture can't reach: an unknown table format,
// and a null subcolumn count (malformed ranges) falling back to the table.
check(
  "R1 mapSidecarGraph unknown table format",
  mapSidecarGraph({
    tableFormat: "multiple", tableDataFormat: "y_single", datasetFormat: "y_single",
    subcolumnCount: 1, isAutoCreated: true, hasInputDatasets: true, sourceResolvable: true,
  }).reconstructible === false,
  "multiple should not map",
);
const nullCount = mapSidecarGraph({
  tableFormat: "column", tableDataFormat: "y_sd_n", datasetFormat: "y_se_n",
  subcolumnCount: null, isAutoCreated: true, hasInputDatasets: true, sourceResolvable: true,
});
check(
  "R1 null subcolumn count falls back to the table format",
  nullCount.reconstructible && nullCount.graphType === "mean-error" && nullCount.error === "sd",
  JSON.stringify(nullCount),
);

// ── R2: the .pzfx heuristics H1–H6 ───────────────────────────────────────

const pzfxNode = (
  id: string,
  name: string,
  tableType: ProjectNode["tableType"],
  columns: string[],
  rows: (string | null)[][],
  extra: Partial<ProjectNode["data"]> = {},
): ProjectNode => ({
  id,
  type: "table",
  name,
  parentId: null,
  tableType,
  data: { columns, rows, ...extra },
});

const pzfxTables: ProjectNode[] = [
  pzfxNode("t-surv", "Survival", "survival", ["Title", "Days", "A", "B"], [["r1", "1", "1", "0"], ["r2", "2", "1", "1"]]),
  pzfxNode("t-grp", "Grouped", "grouped", ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"], [["r1", "1", "2", "3", "4"]], { groups: 2, replicates: 2 }),
  pzfxNode("t-xy", "XY", "xy", ["Title", "X", "A", "B"], [["r1", "0", "1", "2"], ["r2", "1", "3", "4"]]),
  pzfxNode("t-xy-sd", "XY SD", "xy", ["Title", "X", "A_MEAN", "A_SD", "A_N"], [["r1", "0", "1", "0.1", "5"]]),
  pzfxNode("t-xy-rep", "XY rep", "xy", ["Title", "X", "A_1", "A_2"], [["r1", "0", "1", "2"]]),
  pzfxNode("t-xy-text", "XY text X", "xy", ["Title", "X", "A"], [["r1", "low", "1"], ["r2", "high", "2"]]),
  pzfxNode("t-col-rep", "Column rep", "column", ["Title", "A_1", "A_2", "B_1", "B_2"], [["r1", "1", "2", "3", "4"]]),
  pzfxNode("t-col-sd", "Column SD", "column", ["Title", "A_MEAN", "A_SD", "A_N"], [["r1", "1", "0.1", "5"]]),
  pzfxNode("t-col-sem", "Column SEM", "column", ["Title", "A_MEAN", "A_SEM", "A_N"], [["r1", "1", "0.1", "5"]]),
  pzfxNode("t-col-cv", "Column CV", "column", ["Title", "A_MEAN", "A_CV", "A_N"], [["r1", "1", "10", "5"]]),
  pzfxNode("t-col-pm", "Column PM", "column", ["Title", "A_MEAN", "A_PLUSERROR", "A_MINUSERROR"], [["r1", "1", "0.2", "0.1"]]),
  pzfxNode("t-col-1", "Column single", "column", ["Title", "A", "B"], [["r1", "1", "2"]]),
  pzfxNode("t-col-sd-fmt", "Column rep SD table", "column", ["Title", "A_1", "A_2"], [["r1", "1", "2"]], { errorFormat: "sd" }),
  pzfxNode("t-cont", "Contingency", "contingency", ["Title", "Yes", "No"], [["r1", "10", "5"]]),
];
const pzfxImport: PzfxImport = {
  project: {
    nodes: Object.fromEntries(pzfxTables.map((n) => [n.id, n])),
    rootOrder: pzfxTables.map((n) => n.id),
    childOrder: Object.fromEntries(pzfxTables.map((n) => [n.id, []])),
    activeNodeId: pzfxTables[0].id,
  },
  tables: pzfxTables.map((n) => n.name),
  infoSheets: [],
  issues: [],
};
const hPlans = planPzfxGraphs(pzfxImport);
check("R2 one heuristic plan per table", hPlans.length === 14, `${hPlans.length} plans`);
const hById = (id: string) => hPlans.find((p) => p.proposalId === `pzfx:${id}`)!;
const expectHeuristic = (id: string, rule: string, graphType: string | null, error: string | null) => {
  const p = hById(id);
  check(
    `R2 ${rule} ${id}`,
    p.origin === "heuristic" &&
      p.heuristicRule === rule &&
      p.graphType === graphType &&
      p.error === error &&
      (graphType === null ? !p.reconstructible : p.reconstructible),
    `${p.heuristicRule} ${p.graphType}/${p.error} reconstructible=${p.reconstructible}`,
  );
};
expectHeuristic("t-surv", "H1", "survival", "none");
expectHeuristic("t-grp", "H2", "grouped-bars", "sem");
expectHeuristic("t-xy", "H3", "xy-scatter", "none");
expectHeuristic("t-xy-sd", "H3", "xy-scatter", "sd");
expectHeuristic("t-xy-rep", "H3", "xy-scatter", "sem");
expectHeuristic("t-col-rep", "H4", "mean-error", "sem");
expectHeuristic("t-col-sd", "H5", "mean-error", "sd");
expectHeuristic("t-col-sem", "H5", "mean-error", "sem");
expectHeuristic("t-col-cv", "H5", "mean-error", "sd");
check(
  "R2 H5 CV discloses the derivation",
  (hById("t-col-cv").derivedError ?? "").includes("mean × CV% / 100"),
  hById("t-col-cv").derivedError ?? "no disclosure",
);
expectHeuristic("t-col-pm", "H5", "mean-error", "none");
check(
  "R2 H5 plus-minus discloses the asymmetric limit",
  (hById("t-col-pm").limitNote ?? "").includes("asymmetric"),
  hById("t-col-pm").limitNote ?? "no note",
);
expectHeuristic("t-col-1", "H4", "mean-error", "sem");
expectHeuristic("t-col-sd-fmt", "H4", "mean-error", "sd");
expectHeuristic("t-cont", "H6", "grouped-bars", "none");
{
  const p = hById("t-xy-text");
  check(
    "R2 H3 non-numeric X — no proposal",
    !p.reconstructible && p.graphType === null && (p.reason ?? "").includes("isn't numeric"),
    p.reason ?? "reconstructible",
  );
}
check(
  "R2 every heuristic row is badged by rule",
  hPlans.filter((p) => p.reconstructible).every((p) => p.origin === "heuristic" && !!p.heuristicRule),
  "a row lacks its rule badge",
);

// ── R3: applying decisions ───────────────────────────────────────────────

const applyNodes: Record<string, ProjectNode> = {
  tbl1: {
    id: "tbl1", type: "table", name: "Data 1", parentId: null, tableType: "column",
    data: { columns: ["Title", "A_1", "A_2"], rows: [["r1", "1", "2"], ["r2", "3", "4"]] },
  },
  tbl2: {
    id: "tbl2", type: "table", name: "Dose", parentId: null, tableType: "xy",
    data: { columns: ["Title", "X", "Y"], rows: [["r1", "0", "1"], ["r2", "1", "2"]] },
  },
  ana1: {
    id: "ana1", type: "analysis", name: "Nonlin fit (Y)", parentId: "tbl2",
    analysisType: "nonlinear-regression", analysisParams: { model: "sigmoidal-4pl-logx" },
  },
  ana2: {
    id: "ana2", type: "analysis", name: "Other fit", parentId: "tbl1",
    analysisType: "nonlinear-regression", analysisParams: { model: "sigmoidal-4pl-logx" },
  },
};
const applyPlans: GraphPlan[] = [
  {
    proposalId: "p1", prismTitle: "Graph One", sourceTableId: "tbl1", sourceTableName: "Data 1",
    graphType: "mean-error", error: "sem", origin: "sidecar", reconstructible: true,
  },
  {
    proposalId: "p2", prismTitle: "Dose graph", sourceTableId: "tbl2", sourceTableName: "Dose",
    graphType: "xy-scatter", error: "none", linkedAnalysisId: "ana1", origin: "sidecar", reconstructible: true,
  },
  {
    proposalId: "p3", prismTitle: "Custom graph", sourceTableId: null, sourceTableName: null,
    graphType: null, error: null, origin: "sidecar", reconstructible: false, reason: "Custom graph — it was made by hand.",
  },
];
const stubDeps = () => {
  const created: { id: string; parentId: string; graphType: string; options: unknown }[] = [];
  const renamed: [string, string][] = [];
  return {
    created,
    renamed,
    deps: {
      getState: () => ({ nodes: applyNodes }),
      createGraph: (parentId: string, graphType: GraphType, options?: unknown) => {
        const id = `graph_${created.length + 1}`;
        created.push({ id, parentId, graphType, options });
        applyNodes[id] = { id, type: "graph", name: "Mean and Error", parentId, graphType, graphOptions: options as never };
        return id;
      },
      renameNode: (id: string, name: string) => {
        renamed.push([id, name]);
        if (applyNodes[id]) applyNodes[id].name = name;
      },
    },
  };
};
const allDecisions = (overrides: Record<string, RegenDecision["overrides"]> = {}): RegenDecision[] =>
  applyPlans.map((p) => ({
    proposalId: p.proposalId,
    action: p.reconstructible ? "confirm" : "skip",
    ...(overrides[p.proposalId] ? { overrides: overrides[p.proposalId] } : {}),
  }));
const expectThrow = (name: string, fn: () => unknown, want: string) => {
  try {
    fn();
    check(name, false, "did not throw");
  } catch (err) {
    check(name, (err instanceof Error ? err.message : String(err)).includes(want), err instanceof Error ? err.message : String(err));
  }
};
{
  const s = stubDeps();
  const report = applyRegenDecisions(applyPlans, allDecisions(), s.deps);
  check("R3 confirm builds the graph with the plan's name", report.created.length === 2, `${report.created.length} created`);
  check("R3 graph name is the Prism title", s.renamed[0]?.[1] === "Graph One", JSON.stringify(s.renamed[0]));
  check(
    "R3 options carry the plan's error + title",
    (s.created[0].options as { error?: string; title?: string }).error === "sem" &&
      (s.created[0].options as { error?: string; title?: string }).title === "Graph One",
    JSON.stringify(s.created[0].options),
  );
  check(
    "R3 linked analysis rides regAnalysisId",
    (s.created[1].options as { regAnalysisId?: string }).regAnalysisId === "ana1",
    JSON.stringify(s.created[1].options),
  );
  check("R3 unreconstructible listed, not built", report.notReconstructible.length === 1, `${report.notReconstructible.length}`);
}
{
  const s = stubDeps();
  const decisions = allDecisions();
  decisions[0].action = "skip";
  const report = applyRegenDecisions(applyPlans, decisions, s.deps);
  check("R3 skip builds nothing for that row", report.created.length === 1 && report.skipped.length === 1, `${report.created.length}/${report.skipped.length}`);
}
expectThrow("R3 missing decision refused", () => applyRegenDecisions(applyPlans, allDecisions().slice(0, 2), stubDeps().deps), "no decision for");
expectThrow(
  "R3 unknown proposal refused",
  () => applyRegenDecisions(applyPlans, [...allDecisions(), { proposalId: "nope", action: "skip" }], stubDeps().deps),
  "Unknown proposal",
);
expectThrow(
  "R3 duplicate decision refused",
  () => applyRegenDecisions(applyPlans, [...allDecisions(), allDecisions()[0]], stubDeps().deps),
  "Two decisions",
);
expectThrow(
  "R3 confirm on unreconstructible refused",
  () => applyRegenDecisions(applyPlans, allDecisions().map((d) => (d.proposalId === "p3" ? { ...d, action: "confirm" as const } : d)), stubDeps().deps),
  "can't be rebuilt",
);
expectThrow(
  "R3 override to an unoffered type refused",
  () => applyRegenDecisions(applyPlans, allDecisions({ p1: { graphType: "survival" } }), stubDeps().deps),
  "not offered for a column table",
);
expectThrow(
  "R3 override to a bad error refused",
  () => applyRegenDecisions(applyPlans, allDecisions({ p1: { error: "bogus" } }), stubDeps().deps),
  "must be one of",
);
expectThrow(
  "R3 override to an empty name refused",
  () => applyRegenDecisions(applyPlans, allDecisions({ p1: { name: "  " } }), stubDeps().deps),
  "must not be empty",
);
expectThrow(
  "R3 link to another table's analysis refused",
  () => applyRegenDecisions(applyPlans, allDecisions({ p2: { linkedAnalysisId: "ana2" } }), stubDeps().deps),
  "belongs to another table",
);
{
  const s = stubDeps();
  const report = applyRegenDecisions(applyPlans, allDecisions({ p2: { linkedAnalysisId: null } }), s.deps);
  check(
    "R3 clearing the link builds without it",
    report.created.length === 2 && (s.created[1].options as { regAnalysisId?: string }).regAnalysisId === undefined,
    JSON.stringify(s.created[1].options),
  );
}
expectThrow("R3 empty plans refused", () => applyRegenDecisions([], [], stubDeps().deps), "no import-time graph plans");

// ── R4: the MCP pair ─────────────────────────────────────────────────────

const mcpNodes: Record<string, ProjectNode> = {
  tbl1: {
    id: "tbl1", type: "table", name: "Data 1", parentId: null, tableType: "column",
    data: { columns: ["Title", "A_1", "A_2"], rows: [["r1", "1", "2"]] },
  },
};
const mcpPlans: GraphPlan[] = [
  {
    proposalId: "m1", prismTitle: "Graph One", sourceTableId: "tbl1", sourceTableName: "Data 1",
    graphType: "mean-error", error: "sem", origin: "sidecar", reconstructible: true,
  },
  {
    proposalId: "m2", prismTitle: "Custom", sourceTableId: null, sourceTableName: null,
    graphType: null, error: null, origin: "sidecar", reconstructible: false, reason: "Custom graph — it was made by hand.",
  },
];
const mcpJob = (action: string, args: unknown): McpJob => ({
  job_id: `job-${action}`,
  project_id: "project-1",
  action,
  args,
  status: "queued",
});
const mcpDeps = () => {
  const created: string[] = [];
  return {
    created,
    deps: {
      getState: () => ({ nodes: mcpNodes, rootOrder: ["tbl1"], childOrder: { tbl1: [] }, activeNodeId: "tbl1" }),
      createGraph: (parentId: string, graphType: GraphType) => {
        const id = `graph_${created.length + 1}`;
        created.push(id);
        mcpNodes[id] = { id, type: "graph", name: "Mean and Error", parentId, graphType };
        return id;
      },
      renameNode: (id: string, name: string) => {
        if (mcpNodes[id]) mcpNodes[id].name = name;
      },
    },
  };
};
clearRegenPlans();
expectThrow(
  "R4 list with no plans errors",
  () => executeListRegenerableGraphs(mcpJob("list-regenerable-graphs", {}), mcpDeps().deps),
  "no import-time graph plans",
);
setRegenPlans("project-1", mcpPlans);
{
  const out = executeListRegenerableGraphs(mcpJob("list-regenerable-graphs", {}), mcpDeps().deps);
  const proposals = (out.result as { proposals: { proposal_id: string }[] }).proposals;
  check("R4 list returns the same plans the dialog shows", proposals.length === 2 && proposals[0].proposal_id === "m1", `${proposals.length} proposals`);
}
expectThrow(
  "R4 regenerate with a missing decision refused",
  () =>
    executeRegenerateGraphs(
      mcpJob("regenerate-graphs", { decisions: [{ proposal_id: "m1", action: "confirm" }] }),
      mcpDeps().deps,
    ),
  "no decision for",
);
expectThrow(
  "R4 regenerate with an unknown decision refused",
  () =>
    executeRegenerateGraphs(
      mcpJob("regenerate-graphs", {
        decisions: [
          { proposal_id: "m1", action: "confirm" },
          { proposal_id: "m2", action: "skip" },
          { proposal_id: "nope", action: "skip" },
        ],
      }),
      mcpDeps().deps,
    ),
  "Unknown proposal",
);
check(
  "R4 refused runs don't consume the plans",
  (getRegenPlans("project-1") ?? []).length === 2,
  "plans were consumed by a refused run",
);
{
  const d = mcpDeps();
  const out = executeRegenerateGraphs(
    mcpJob("regenerate-graphs", {
      decisions: [
        { proposal_id: "m1", action: "confirm" },
        { proposal_id: "m2", action: "skip" },
      ],
    }),
    d.deps,
  );
  const result = out.result as { created: { graph_id: string }[]; skipped: unknown[] };
  check("R4 regenerate creates the confirmed graph", result.created.length === 1 && d.created.length === 1, `${result.created.length} created`);
  // m2 is unreconstructible: skipping it is not a user skip — it lands in
  // the "not reconstructible" bucket, so `skipped` stays empty.
  check("R4 an unreconstructible row is neither created nor user-skipped", result.skipped.length === 0, `${result.skipped.length} skipped`);
}
expectThrow(
  "R4 a completed run consumes the plans",
  () => executeListRegenerableGraphs(mcpJob("list-regenerable-graphs", {}), mcpDeps().deps),
  "no import-time graph plans",
);

// ── R5: the registry ─────────────────────────────────────────────────────

setRegenPlans("project-9", mcpPlans);
check("R5 get by project id", getRegenPlans("project-9")?.length === 2, "wrong plans");
check("R5 a stale project id sees nothing", getRegenPlans("project-1") === null, "leaked across projects");
check("R5 an unkeyed read sees the current plans", getRegenPlans()?.length === 2, "unkeyed read missed");
clearRegenPlans();
check("R5 clear empties the registry", getRegenPlans() === null, "plans survived clear");

// ── R6: the real Prism encoding (seq 313) ───────────────────────────────
//
// Real Prism 11 writes a graph sheet's inputDataSets as BARE STRINGS
// (verified on the public corpus: every real .prism graph sheet —
// 1f-zenodo-16883557, 20240619-collection, 3e/4b-f, angley-summary,
// b-domain-paper, zenodo-23478977 — lists plain UID strings, never
// {uid} objects). The R1 fixture writes objects, so it never exercised
// the real encoding — the planner read input.uid (undefined for a
// string) and reported every real graph "Source table not imported".
// This fixture is shaped like the real files: bare-string graph inputs
// (one per dataset, three UIDs on the grouped graph's row in the
// 1.8.2 Mac proof's RT-162-A file), analysis sheets still objects.
const realTables: FxTable[] = [
  col(71, 81, "Real column", "y_sd_n", "y_sd_n", 3),
  {
    sheet: uid(72), table: uid(83), name: "Real grouped", format: "grouped", dataFormat: "y_replicates",
    datasets: [
      { uid: uid(84), format: "y_replicates", title: "Control", subs: 2 },
      { uid: uid(85), format: "y_replicates", title: "Treated", subs: 2 },
    ],
    replicatesCount: 2,
    rows: [["1", "2", "3", "4"], ["5", "6", "7", "8"]],
  },
  {
    sheet: uid(73), table: uid(86), name: "Real XY dose-response", format: "xy", dataFormat: "y_replicates",
    datasets: [{ uid: uid(87), format: "y_replicates", title: "Response", subs: 3 }],
    x: { uid: uid(88), title: "Dose" },
    rows: [["0", "1", "2", "3"], ["1", "4", "5", "6"]],
  },
];
const realGraphs: FxGraph[] = [
  { uid: uid(171), title: "Real column graph", inputs: [uid(82)], inputEncoding: "strings" },
  { uid: uid(172), title: "Real grouped graph", inputs: [uid(84), uid(85)], inputEncoding: "strings" },
  { uid: uid(173), title: "Real XY graph", inputs: [uid(87)], inputEncoding: "strings" },
  { uid: uid(174), title: "Real missing graph", inputs: ["deadbeef-dead-beef-dead-beefdeadbeef"], inputEncoding: "strings" },
];
const realAnalyses: FxAnalysis[] = [
  {
    uid: uid(270),
    title: "Nonlin fit of Real XY dose-response",
    sheetUid: realTables[2].sheet,
    datasets: [{ uid: uid(87), title: "Response" }],
    equation: "Sigmoidal, 4PL, X is log(concentration)",
    // Converter tolerance pin: a bare-string analysis input must still
    // import and register the graph→analysis link.
    inputsBare: true,
  },
];
const realBytes = await buildFxZip(realTables, realGraphs, realAnalyses);
const realConverted = await convertPrism(realBytes, "regen-real-encoding.prism");
check("R6 real-encoding fixture converts", realConverted.report.tables.length === 3, `${realConverted.report.tables.length} tables`);
check(
  "R6 nonlinear fit imports from a bare-string analysis input",
  realConverted.report.analyses.length === 1 && realConverted.report.analyses[0].includes("Nonlin fit"),
  realConverted.report.analyses.join("; "),
);
check(
  "R6 bare-string analysis input still registers the graph→analysis link",
  realConverted.prismIndex?.analysisNodeByDatasetUid[uid(87)] !== undefined,
  JSON.stringify(realConverted.prismIndex?.analysisNodeByDatasetUid ?? {}),
);
const realPlans = await planGraphRegeneration(await JSZip.loadAsync(realBytes), realConverted);
check("R6 one plan per graph", realPlans.length === 4, `${realPlans.length} plans`);
const realByTitle = (title: string) => realPlans.find((p) => p.prismTitle === title)!;
{
  const p = realByTitle("Real column graph");
  check("R6 bare-string input resolves (column)", p.reconstructible && p.graphType === "mean-error" && p.error === "sd", `${p.graphType}/${p.error} ${p.reason ?? ""}`);
}
{
  const p = realByTitle("Real grouped graph");
  check("R6 bare-string inputs resolve (grouped, 2 datasets)", p.reconstructible && p.graphType === "grouped-bars" && p.error === "sem", `${p.graphType}/${p.error} ${p.reason ?? ""}`);
}
{
  const p = realByTitle("Real XY graph");
  check(
    "R6 bare-string input resolves + links the imported analysis (xy)",
    p.reconstructible && p.graphType === "xy-scatter" && p.error === "sem" && !!p.linkedAnalysisId,
    `${p.graphType}/${p.error} link=${p.linkedAnalysisId ?? "none"}`,
  );
  check(
    "R6 linked analysis is the imported nonlinear node",
    realConverted.project.nodes[p.linkedAnalysisId ?? ""]?.analysisType === "nonlinear-regression",
    realConverted.project.nodes[p.linkedAnalysisId ?? ""]?.name ?? "no node",
  );
}
{
  const p = realByTitle("Real missing graph");
  check(
    "R6 a genuinely missing table keeps the reason (bare-string dead UID)",
    !p.reconstructible && p.graphType === null && (p.reason ?? "").includes("Source table not imported"),
    p.reason ?? "reconstructible",
  );
}
{
  const c = regenPlanCounts(realPlans);
  check("R6 counts", c.regenerable === 3 && c.notRegenerable === 1, `${c.regenerable}/${c.notRegenerable}`);
}
// End to end over the MCP pair: list shows the same plans, regenerate
// creates the three graphs, and the run consumes the plans.
{
  const nodes = realConverted.project.nodes;
  const created: string[] = [];
  const deps = {
    getState: () => ({
      nodes,
      rootOrder: realConverted.project.rootOrder,
      childOrder: realConverted.project.childOrder,
      activeNodeId: realConverted.project.activeNodeId,
    }),
    createGraph: (parentId: string, graphType: GraphType) => {
      const id = `graph_${created.length + 1}`;
      created.push(id);
      nodes[id] = { id, type: "graph", name: "Mean and Error", parentId, graphType };
      return id;
    },
    renameNode: (id: string, name: string) => {
      if (nodes[id]) nodes[id].name = name;
    },
  };
  clearRegenPlans();
  setRegenPlans("project-1", realPlans); // mcpJob() keys jobs to project-1
  const listed = executeListRegenerableGraphs(mcpJob("list-regenerable-graphs", {}), deps);
  check(
    "R6 list-regen shows the real-encoding plans",
    ((listed.result as { proposals: unknown[] }).proposals.length === 4),
    `${(listed.result as { proposals: unknown[] }).proposals.length} proposals`,
  );
  const out = executeRegenerateGraphs(
    mcpJob("regenerate-graphs", {
      decisions: realPlans.map((p) => ({ proposal_id: p.proposalId, action: p.reconstructible ? "confirm" : "skip" })),
    }),
    deps,
  );
  const result = out.result as { created: { graph_id: string; name: string }[] };
  check("R6 regenerate creates the three graphs", result.created.length === 3 && created.length === 3, `${result.created.length} created`);
  check(
    "R6 created graphs carry the Prism titles",
    JSON.stringify(result.created.map((g) => g.name).sort()) ===
      JSON.stringify(["Real XY graph", "Real column graph", "Real grouped graph"]),
    JSON.stringify(result.created.map((g) => g.name)),
  );
}
expectThrow(
  "R6 a completed run consumes the plans",
  () => executeListRegenerableGraphs(mcpJob("list-regenerable-graphs", {}), {
    getState: () => ({ nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: "" }),
    createGraph: () => "x",
    renameNode: () => {},
  }),
  "no import-time graph plans",
);

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
