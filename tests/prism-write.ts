// `.prism` writer tests — plan prism-format-work, regression test C-06
// (round-trip .prism → .hlx → .prism) plus the writer's identity rules.
//
//   C-06  tables cell-identical, analyses present with identical parameters
//   W3    the written file is honestly Titer's: fresh UUIDs, createdBy Titer,
//         no graphs/layouts, no results.json
//   W4    a minimal one-table project writes exactly the required entries
//   W5    (superseded by W15, seq 162): a Nested table used to refuse the
//         whole write; it now writes as a Column table (see W15).
//
// `npm test` runs this after tests/prism.ts. The demo file lives in
// tests/testdata/prism/ (a copy of the public prism2R demo — Mansi's files
// are never test material).
/// <reference types="node" />
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { convertPrism } from "../src/lib/prism";
import { writePrism } from "../src/lib/prism-write";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const DEMO = join(HERE, "testdata", "prism", "prism2R-demo_dataset.prism");

let failures = 0;
let checks = 0;
function check(name: string, ok: boolean, detail: string) {
  checks++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
  if (!ok) failures++;
}

const input = await readFile(DEMO);
const zip = await JSZip.loadAsync(input);
const { project } = await convertPrism(new Uint8Array(input), "prism2R-demo_dataset.prism");
const tables = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "table");
const analyses = Object.values(project.nodes).filter((n) => n.type === "analysis");

// W1+W2 (C-06): round-trip .prism → .hlx → .prism on the demo file — tables
// cell-identical, analyses present with identical parameters.
{
  const written = await writePrism(project, "1.0.7");
  const back = await convertPrism(written.bytes, "round-trip.prism");
  const backTables = back.project.rootOrder.map((id) => back.project.nodes[id]).filter((n) => n?.type === "table");
  const tablesIdentical =
    backTables.length === tables.length &&
    backTables.every((t, i) => JSON.stringify(t.data) === JSON.stringify(tables[i].data));
  check("W1 round-trip tables", tablesIdentical, `${backTables.length} tables, cell-identical in order`);
  const backAnalyses = Object.values(back.project.nodes).filter((n) => n.type === "analysis");
  const paramsMatch = (a: (typeof analyses)[number]) => {
    const b = backAnalyses.find((x) => x.name === a.name);
    if (!b || b.analysisType !== a.analysisType) return false;
    return JSON.stringify(b.analysisParams ?? null) === JSON.stringify(a.analysisParams ?? null);
  };
  check(
    "W2 round-trip analyses",
    backAnalyses.length === analyses.length && analyses.every(paramsMatch),
    `${backAnalyses.length} nodes: ${backAnalyses.map((a) => `${a.name} (${a.analysisType})`).join("; ")}`,
  );
  // W3: the written file is honestly Titer's — fresh UUIDs, createdBy Titer,
  // no graphs/layouts, no results.json (Titer stores params, never results).
  const writtenZip = await JSZip.loadAsync(written.bytes);
  const writtenDoc = JSON.parse((await writtenZip.file("document.json")!.async("string")) as string) as {
    createdBy?: { name?: string; version?: string };
    formatVersion?: string;
  };
  const writtenPaths = Object.keys(writtenZip.files);
  const sourceUuids = new Set(
    Object.keys(zip.files)
      .map((p) => /^data\/sheets\/([^/]+)\//.exec(p)?.[1] ?? /^analyses\/([^/]+)\//.exec(p)?.[1])
      .filter((u): u is string => !!u),
  );
  const writtenUuids = new Set(
    writtenPaths
      .map((p) => /^data\/sheets\/([^/]+)\//.exec(p)?.[1] ?? /^analyses\/([^/]+)\//.exec(p)?.[1])
      .filter((u): u is string => !!u),
  );
  const uuidsFresh = [...writtenUuids].every((u) => !sourceUuids.has(u));
  check(
    "W3 written file identity",
    writtenDoc.createdBy?.name === "Titer" &&
      writtenDoc.createdBy?.version === "1.0.7" &&
      writtenDoc.formatVersion === "1-4-1" &&
      uuidsFresh &&
      !writtenPaths.some((p) => p.startsWith("graphs/") || p.startsWith("layouts/")) &&
      !writtenPaths.some((p) => p.endsWith("results.json")),
    `createdBy ${writtenDoc.createdBy?.name} ${writtenDoc.createdBy?.version}, format ${writtenDoc.formatVersion}, ${writtenUuids.size} fresh UUIDs, ${writtenPaths.length} entries`,
  );
  // W6: the demo's info sheet round-trips — written as `info/<uid>/sheet.json`
  // and listed in document.json's sheets.info, and read back as the same
  // info node with the same constants.
  const writtenInfoPaths = writtenPaths.filter((p) => p.startsWith("info/") && p.endsWith("sheet.json"));
  const writtenInfoDoc =
    writtenInfoPaths.length === 1
      ? (JSON.parse((await writtenZip.file(writtenInfoPaths[0])!.async("string")) as string) as {
          "@class"?: string;
          title?: string;
          notesText?: string;
          constants?: { name?: string; value?: string }[];
        })
      : null;
  const backInfos = Object.values(back.project.nodes).filter((n) => n.type === "info");
  const sourceInfo = Object.values(project.nodes).find((n) => n.type === "info");
  // Constant ids are fresh per import, so the round-trip compares name/value pairs only.
  const pairs = (n: (typeof backInfos)[number] | undefined) =>
    JSON.stringify((n?.info?.constants ?? []).map((c) => [c.name, c.value]));
  check(
    "W6 round-trip info sheet",
    written.report.infoSheets.join(", ") === "Project info 1" &&
      writtenInfoPaths.length === 1 &&
      writtenInfoDoc?.["@class"] === "InfoSheet" &&
      writtenInfoDoc?.title === "Project info 1" &&
      (writtenDoc as { sheets?: { info?: string[] } }).sheets?.info?.length === 1 &&
      backInfos.length === 1 &&
      backInfos[0].name === "Project info 1" &&
      pairs(backInfos[0]) === pairs(sourceInfo),
    `written ${writtenInfoPaths.length} info sheet.json; back: ${backInfos.map((i) => i.name).join(", ")}`,
  );
  // W4: a minimal one-table project writes exactly the required entries.
  const minimal = await writePrism(
    {
      nodes: {
        table_1: {
          id: "table_1",
          type: "table",
          name: "Minimal",
          parentId: null,
          tableType: "column",
          data: {
            columns: ["Title", "A"],
            rows: [
              [null, "1"],
              [null, "2"],
            ],
          },
        },
      },
      rootOrder: ["table_1"],
      childOrder: { table_1: [] },
      activeNodeId: "table_1",
    },
    "1.0.7",
  );
  const minimalPaths = Object.values((await JSZip.loadAsync(minimal.bytes)).files)
    .filter((f) => !f.dir)
    .map((f) => f.name)
    .sort();
  const minimalOk =
    minimalPaths.filter((p) => p === "document.json").length === 1 &&
    minimalPaths.filter((p) => p.startsWith("data/sheets/")).length === 1 &&
    minimalPaths.filter((p) => p.startsWith("data/tables/")).length === 2 &&
    minimalPaths.filter((p) => p.startsWith("data/sets/")).length === 1 &&
    minimalPaths.length === 5;
  check("W4 minimal file", minimalOk, minimalPaths.join(", "));
  // W15 (seq 162): nested/multiple tables write as Column tables — the
  // whole write no longer fails when a project holds one, values and column
  // names survive verbatim, and the report discloses the type change. The
  // fixtures are generated, never Mansi's files. The nested table uses the
  // valid "Group:Subgroup:R1" shape (2 groups x 2 subgroups x 2 reps) with
  // row titles and one excluded cell; the multiple table holds plain
  // variable columns. Round-trip contract: columns + rows + excluded cells
  // identical; the table comes back as Column (its groups/replicates/
  // subgroups metadata has nowhere to live in a Column table), and the
  // nested t test attached to it is registered as not written.
  const nestedData = {
    columns: ["Title", "A:S1:R1", "A:S1:R2", "A:S2:R1", "A:S2:R2", "B:S1:R1", "B:S1:R2", "B:S2:R1", "B:S2:R2"],
    rows: [
      ["Day 1", "10", "11", "12", "13", "20", "21", "22", "23"],
      ["Day 2", "14", "15", "16", "17", "24", "25", "26", "27"],
    ],
    groups: 2,
    subgroups: 2,
    replicates: 2,
    excluded: ["0,1"],
  };
  const multiData = {
    columns: ["Title", "Age", "Weight", "Score"],
    rows: [
      [null, "34", "72.5", "88"],
      [null, "29", "68.0", "91"],
    ],
  };
  const seq162Project = {
    nodes: {
      t_nested: {
        id: "t_nested",
        type: "table",
        name: "Nested data",
        parentId: null,
        tableType: "nested",
        data: nestedData,
      },
      t_multi: {
        id: "t_multi",
        type: "table",
        name: "Multi var",
        parentId: null,
        tableType: "multiple",
        data: multiData,
      },
      t_col: {
        id: "t_col",
        type: "table",
        name: "Plain",
        parentId: null,
        tableType: "column",
        data: { columns: ["Title", "C"], rows: [[null, "5"]] },
      },
      a_nested_t: {
        id: "a_nested_t",
        type: "analysis",
        name: "Nested t test",
        parentId: "t_nested",
        analysisType: "nested-t-test",
        analysisParams: {},
      },
    },
    rootOrder: ["t_nested", "t_multi", "t_col"],
    childOrder: { t_nested: ["a_nested_t"], t_multi: [], t_col: [], a_nested_t: [] },
    activeNodeId: "t_nested",
  };
  const seq162Written = await writePrism(seq162Project as never, "1.0.7");
  const seq162Zip = await JSZip.loadAsync(seq162Written.bytes);
  const seq162Sheets = new Map<string, { format?: string; "@class"?: string }>();
  for (const p of Object.keys(seq162Zip.files)) {
    if (!p.startsWith("data/sheets/") || !p.endsWith("sheet.json") || seq162Zip.files[p].dir) continue;
    const d = JSON.parse(await seq162Zip.file(p)!.async("string")) as {
      title?: string;
      table?: { format?: string; "@class"?: string };
    };
    if (d.title) seq162Sheets.set(d.title, d.table ?? {});
  }
  const seq162Back = await convertPrism(seq162Written.bytes, "seq162-round-trip.prism");
  const seq162BackTables = seq162Back.project.rootOrder
    .map((id) => seq162Back.project.nodes[id])
    .filter((n) => n?.type === "table");
  const backByName = (name: string) => seq162BackTables.find((t) => t.name === name);
  const nestedBack = backByName("Nested data");
  const multiBack = backByName("Multi var");
  const seq162Warnings = seq162Written.report.issues.filter((i) => i.severity === "warning").map((i) => i.message);
  check(
    "W15a nested table writes as Column, values verbatim (seq 162)",
    seq162Sheets.get("Nested data")?.format === "column" &&
      seq162Sheets.get("Nested data")?.["@class"] === "DataTable" &&
      nestedBack?.tableType === "column" &&
      JSON.stringify(nestedBack?.data?.columns) === JSON.stringify(nestedData.columns) &&
      JSON.stringify(nestedBack?.data?.rows) === JSON.stringify(nestedData.rows) &&
      JSON.stringify(nestedBack?.data?.excluded ?? []) === JSON.stringify(nestedData.excluded),
    `back type ${nestedBack?.tableType}, columns ${JSON.stringify(nestedBack?.data?.columns)}, excluded ${JSON.stringify(nestedBack?.data?.excluded)}`,
  );
  check(
    "W15b multiple table writes as Column, values verbatim (seq 162)",
    seq162Sheets.get("Multi var")?.format === "column" &&
      multiBack?.tableType === "column" &&
      JSON.stringify(multiBack?.data?.columns) === JSON.stringify(multiData.columns) &&
      JSON.stringify(multiBack?.data?.rows) === JSON.stringify(multiData.rows),
    `back type ${multiBack?.tableType}, columns ${JSON.stringify(multiBack?.data?.columns)}`,
  );
  check(
    "W15c mixed project writes all three tables (seq 162)",
    JSON.stringify(seq162Written.report.tables) === JSON.stringify(["Nested data", "Multi var", "Plain"]) &&
      seq162BackTables.length === 3,
    `written: ${seq162Written.report.tables.join(", ")}; back: ${seq162BackTables.map((t) => t.name).join(", ")}`,
  );
  check(
    "W15d flattening is disclosed in the report, naming each table (seq 162)",
    seq162Warnings.some(
      (m) => m.includes("“Nested data”") && m.includes("Nested table") && m.includes("Column table"),
    ) &&
      seq162Warnings.some(
        (m) => m.includes("“Multi var”") && m.includes("Multiple variables table") && m.includes("Column table"),
      ) &&
      !seq162Warnings.some((m) => m.includes("“Plain”")),
    seq162Warnings.join(" | "),
  );
  check(
    "W15e nested t test is registered, not written (seq 162)",
    seq162Written.report.analysesNotWritten.some(
      (s) => s.startsWith("Nested t test") && s.includes("nested-t-test"),
    ),
    seq162Written.report.analysesNotWritten.join(" | "),
  );
  // W7 (BUG-9): a mixed-format xy table round-trips with its MEAN/SD/N
  // names intact. The writer groups Ya/Yb into y_sd_n datasets but the
  // "XX error" column is y_single, so the table-level dataFormat is
  // y_single — the reader must name subcolumns from each dataset's own
  // format, or Ya_MEAN/Ya_SD/Ya_N come back as Ya_1/Ya_2/Ya_3.
  const sdnColumns = ["Title", "XX", "XX error", "Ya_MEAN", "Ya_SD", "Ya_N", "Yb_MEAN", "Yb_SD", "Yb_N"];
  const sdnWritten = await writePrism(
    {
      nodes: {
        table_1: {
          id: "table_1",
          type: "table",
          name: "Data 1",
          parentId: null,
          tableType: "xy",
          data: {
            columns: sdnColumns,
            rows: [
              ["A", "1", "2", "100", "50", "5", "1", "10", "4"],
              ["B", "2", "3", "90", "60", "6", "2", "9", "3"],
              ["C", "3", "4", "80", "70", "7", "3", "8", "2"],
            ],
          },
        },
      },
      rootOrder: ["table_1"],
      childOrder: { table_1: [] },
      activeNodeId: "table_1",
    },
    "1.0.7",
  );
  const sdnBack = await convertPrism(sdnWritten.bytes, "sdn-round-trip.prism");
  const sdnTable = Object.values(sdnBack.project.nodes).find((n) => n?.type === "table" && n.name === "Data 1");
  check(
    "W7 mixed-format MEAN/SD/N round-trip",
    JSON.stringify(sdnTable?.data?.columns) === JSON.stringify(sdnColumns),
    `back: ${JSON.stringify(sdnTable?.data?.columns)}`,
  );
  // W8 (BUG-10): excluded cells survive a .prism round-trip, written in
  // real Prism's own representation — `cellAttributes` EXCLUDED entries
  // on the replicate — with `y_replicates` ranges split where
  // per-subcolumn exclusion patterns differ (Ya_1+Ya_2 excluded at row
  // 1, Yb_1 excluded but Yb_2 live: Yb must become ranges "0" and "1",
  // not one "0~1" range with EXCLUDED row 1). The column table covers
  // the non-replicates (`replicates` array) branch.
  const bug10Project = {
    nodes: {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Data 1",
        parentId: null,
        tableType: "xy",
        data: {
          columns: ["Title", "XX", "Ya_1", "Ya_2", "Yb_1", "Yb_2"],
          rows: [
            ["A", "1.", "80.", "50.", "1.", "8."],
            ["B", "2.", "90.", "60.", "2.", "9."],
            ["C", "3.", "70.", "40.", "3.", "7."],
          ],
          excluded: ["1,2", "1,3", "1,4"],
        },
      },
      table_2: {
        id: "table_2",
        type: "table",
        name: "Col",
        parentId: null,
        tableType: "column",
        data: {
          columns: ["Title", "C"],
          rows: [
            [null, "5"],
            [null, "6"],
          ],
          excluded: ["1,1"],
        },
      },
    },
    rootOrder: ["table_1", "table_2"],
    childOrder: { table_1: [], table_2: [] },
    activeNodeId: "table_1",
  };
  const bug10Written = await writePrism(bug10Project as never, "1.0.7");
  const bug10Zip = await JSZip.loadAsync(bug10Written.bytes);
  const setsByTitle = new Map<string, Record<string, unknown>>();
  for (const p of Object.keys(bug10Zip.files)) {
    if (!p.startsWith("data/sets/") || bug10Zip.files[p].dir) continue;
    const d = JSON.parse(await bug10Zip.file(p)!.async("string")) as Record<string, unknown>;
    setsByTitle.set(String(d.title), d);
  }
  const ya = setsByTitle.get("Ya") as {
    "replicate ranges"?: { range?: string; replicate?: { cellAttributes?: unknown[] } }[];
  };
  const yb = setsByTitle.get("Yb") as {
    "replicate ranges"?: { range?: string; replicate?: { cellAttributes?: unknown[] } }[];
  };
  const cset = setsByTitle.get("C") as { replicates?: { cellAttributes?: unknown[] }[] };
  check(
    "W8 writer emits Prism EXCLUDED cellAttributes",
    JSON.stringify(ya?.["replicate ranges"]) ===
      JSON.stringify([
        {
          range: "0~1",
          replicate: {
            "@class": "DriverReplicate",
            valueType: "real",
            commonAttributes: ["NUMERIC"],
            decimalsLength: 1,
            significantDigitsCount: 7,
            lastRow: 2,
            firstRow: 0,
            cellAttributes: [{ rows: "1", attributes: ["EXCLUDED"] }],
          },
        },
      ]) &&
      (yb?.["replicate ranges"]?.length ?? 0) === 2 &&
      yb?.["replicate ranges"]?.[0]?.range === "0" &&
      (yb?.["replicate ranges"]?.[0]?.replicate?.cellAttributes?.length ?? 0) === 1 &&
      yb?.["replicate ranges"]?.[1]?.range === "1" &&
      (yb?.["replicate ranges"]?.[1]?.replicate?.cellAttributes?.length ?? 0) === 0 &&
      JSON.stringify(cset?.replicates?.[0]?.cellAttributes) ===
        JSON.stringify([{ rows: "1", attributes: ["EXCLUDED"] }]),
    `Ya ${JSON.stringify(ya?.["replicate ranges"])}; Yb ${JSON.stringify(yb?.["replicate ranges"])}; C ${JSON.stringify(cset?.replicates)}`,
  );
  const bug10Back = await convertPrism(bug10Written.bytes, "bug10-round-trip.prism");
  const bug10BackTables = bug10Back.project.rootOrder
    .map((id) => bug10Back.project.nodes[id])
    .filter((n) => n?.type === "table");
  const backExcluded = (name: string) => bug10BackTables.find((t) => t.name === name)?.data?.excluded ?? [];
  check(
    "W8 .prism round-trip preserves exclusions",
    JSON.stringify(backExcluded("Data 1")) === JSON.stringify(["1,2", "1,3", "1,4"]) &&
      JSON.stringify(backExcluded("Col")) === JSON.stringify(["1,1"]),
    `Data 1 ${JSON.stringify(backExcluded("Data 1"))}; Col ${JSON.stringify(backExcluded("Col"))}`,
  );
  // W9: a project with no exclusions writes no cellAttributes anywhere —
  // the common case keeps its exact previous output shape.
  const cleanWritten = await writePrism(
    {
      nodes: {
        table_1: {
          id: "table_1",
          type: "table",
          name: "Clean",
          parentId: null,
          tableType: "column",
          data: { columns: ["Title", "A", "B_1", "B_2"], rows: [[null, "1", "2", "3"]] },
        },
      },
      rootOrder: ["table_1"],
      childOrder: { table_1: [] },
      activeNodeId: "table_1",
    },
    "1.0.7",
  );
  const cleanZip = await JSZip.loadAsync(cleanWritten.bytes);
  let cellAttrs = 0;
  for (const p of Object.keys(cleanZip.files)) {
    if (!p.endsWith(".json") || cleanZip.files[p].dir) continue;
    if ((await cleanZip.file(p)!.async("string")).includes("cellAttributes")) cellAttrs++;
  }
  check("W9 no exclusions, no cellAttributes", cellAttrs === 0, `${cellAttrs} file(s) mention cellAttributes`);
  // W10: duplicate group names stay two datasets (BUG-1/BUG-3) — the writer
  // groups by runs, not by name, so the second "Group" set isn't merged
  // into the first with its values shifted.
  const dupData = {
    columns: ["Title", "Group:Y1", "Group:Y2", "Group:Y1", "Group:Y2"],
    rows: [["r1", "1", "2", "3", "4"]],
    groups: 2,
    replicates: 2,
  };
  const dupWritten = await writePrism(
    {
      nodes: {
        table_1: {
          id: "table_1",
          type: "table",
          name: "Dup groups",
          parentId: null,
          tableType: "grouped",
          data: dupData,
        },
      },
      rootOrder: ["table_1"],
      childOrder: { table_1: [] },
      activeNodeId: "table_1",
    },
    "1.0.7",
  );
  const dupBack = await convertPrism(dupWritten.bytes, "dup-groups.prism");
  const dupTable = Object.values(dupBack.project.nodes).find((n) => n?.type === "table");
  check(
    "W10 duplicate groups round-trip",
    JSON.stringify(dupTable?.data) === JSON.stringify(dupData),
    `back columns: ${JSON.stringify(dupTable?.data?.columns)}`,
  );
  // W11 (BUG-20): every written data sheet's table carries "@class" —
  // real Prism 11.2.0 dispatches on it and dereferences it unconditionally,
  // so omitting it crashes Prism on open (SIGSEGV in NSDocument init).
  // Real Prism files write "XYDataTable" for xy/survival tables and
  // "DataTable" for column/grouped/contingency.
  const classProject = {
    nodes: {
      t_col: {
        id: "t_col",
        type: "table",
        name: "Col",
        parentId: null,
        tableType: "column",
        data: { columns: ["Title", "A", "B"], rows: [[null, "1", "2"]] },
      },
      t_xy: {
        id: "t_xy",
        type: "table",
        name: "XY",
        parentId: null,
        tableType: "xy",
        data: { columns: ["Title", "X", "Y_1", "Y_2"], rows: [[null, "0.1", "10", "11"]] },
      },
      t_surv: {
        id: "t_surv",
        type: "table",
        name: "Surv",
        parentId: null,
        tableType: "survival",
        data: { columns: ["Title", "Time", "GrpA", "GrpB"], rows: [[null, "0", "100", "90"]] },
      },
      t_grouped: {
        id: "t_grouped",
        type: "table",
        name: "Grouped",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "G1:Y1", "G1:Y2", "G2:Y1", "G2:Y2"],
          rows: [[null, "1", "2", "3", "4"]],
        },
      },
      t_cont: {
        id: "t_cont",
        type: "table",
        name: "Cont",
        parentId: null,
        tableType: "contingency",
        data: { columns: ["Title", "A", "B"], rows: [[null, "5", "6"]] },
      },
    },
    rootOrder: ["t_col", "t_xy", "t_surv", "t_grouped", "t_cont"],
    childOrder: { t_col: [], t_xy: [], t_surv: [], t_grouped: [], t_cont: [] },
    activeNodeId: "t_col",
  };
  const classWritten = await writePrism(classProject as never, "1.0.7");
  const classZip = await JSZip.loadAsync(classWritten.bytes);
  const classByTitle = new Map<string, unknown>();
  for (const p of Object.keys(classZip.files)) {
    if (!p.startsWith("data/sheets/") || !p.endsWith("sheet.json") || classZip.files[p].dir) continue;
    const d = JSON.parse(await classZip.file(p)!.async("string")) as {
      title?: string;
      table?: { "@class"?: string };
    };
    if (d.title) classByTitle.set(d.title, d.table?.["@class"]);
  }
  const expectedClasses: [string, string][] = [
    ["Col", "DataTable"],
    ["XY", "XYDataTable"],
    ["Surv", "XYDataTable"],
    ["Grouped", "DataTable"],
    ["Cont", "DataTable"],
  ];
  check(
    "W11 tables carry @class (BUG-20)",
    expectedClasses.every(([title, cls]) => classByTitle.get(title) === cls),
    [...classByTitle.entries()].map(([t, c]) => `${t}=${String(c)}`).join(", "),
  );
  // W12 (seq 175, regression on 1.6.2): every written info sheet carries
  // selectedCellsRange — real Prism 11.2.0 dereferences it unconditionally
  // on open, so omitting it crashes Prism (EXC_BAD_ACCESS / SIGSEGV,
  // KERN_INVALID_ADDRESS at 0x0, thread 0 in NSDocument
  // initWithContentsOfURL). Bisection (Nov 18, 24 files in real Prism):
  // selectedCellsRange-only variant opens clean; uiState-only still
  // crashes; experimentDate / trailing empty constant / notesText all
  // exonerated. Value is the real-Prism default: cells (0,0)–(0,0).
  const infoProject = {
    nodes: {
      t_info: {
        id: "t_info",
        type: "table",
        name: "T",
        parentId: null,
        tableType: "column",
        data: { columns: ["Title", "A"], rows: [[null, "1"]] },
      },
      i_full: {
        id: "i_full",
        type: "info",
        name: "Project info 1",
        parentId: null,
        info: { notes: "notes\r\n", constants: [{ name: "Experiment ID", value: "E1" }] },
      },
      i_bare: { id: "i_bare", type: "info", name: "Project info 2", parentId: null },
    },
    rootOrder: ["t_info", "i_full", "i_bare"],
    childOrder: { t_info: [], i_full: [], i_bare: [] },
    activeNodeId: "t_info",
  };
  const infoWritten = await writePrism(infoProject as never, "1.0.7");
  const infoZip = await JSZip.loadAsync(infoWritten.bytes);
  const infoRanges: string[] = [];
  for (const p of Object.keys(infoZip.files)) {
    if (!p.startsWith("info/") || !p.endsWith("sheet.json") || infoZip.files[p].dir) continue;
    const d = JSON.parse(await infoZip.file(p)!.async("string")) as {
      title?: string;
      selectedCellsRange?: unknown;
    };
    infoRanges.push(`${d.title ?? "?"}:${JSON.stringify(d.selectedCellsRange)}`);
  }
  const expectedRange = JSON.stringify({
    endCell: { row: 0, column: 0 },
    startCell: { row: 0, column: 0 },
  });
  check(
    "W12 info sheets carry selectedCellsRange (seq 175)",
    infoRanges.length === 2 && infoRanges.every((r) => r.endsWith(expectedRange)),
    infoRanges.join("; ") || "no info sheets written",
  );
  // W13 (seq 247): every written analysis sheet loads in real Prism 11.2.0.
  // Proven by bisection in real Prism (Nov 18): numeric input idx →
  // "damaged or truncated" (J6); missing sheet identity → SIGSEGV on load
  // (L1/L2); constants version 1 (number) → "damaged or truncated" (L3);
  // missing initialValueRules → "Cannot open file… structure has been
  // corrupted" (M1/P2). Pre-fix FAIL: the old writer emitted numeric idx,
  // title-keyed (colliding) uids, no sheet identity, version 1, and rules
  // only for 4PL-x.
  const w13Written = await writePrism(project, "1.0.7");
  const w13Zip = await JSZip.loadAsync(w13Written.bytes);
  const dataSetUids = new Set<string>();
  for (const p of Object.keys(w13Zip.files)) {
    if (!p.startsWith("data/sets/") || !p.endsWith(".json") || w13Zip.files[p].dir) continue;
    const d = JSON.parse(await w13Zip.file(p)!.async("string")) as { uid?: string };
    if (d.uid) dataSetUids.add(d.uid);
  }
  const w13Problems: string[] = [];
  let w13Nlreg = 0;
  let w13Survival = 0;
  let w13Mtt = 0;
  for (const p of Object.keys(w13Zip.files)) {
    if (!p.startsWith("analyses/") || !p.endsWith("/sheet.json") || w13Zip.files[p].dir) continue;
    const dirUid = p.split("/")[1];
    const sheet = JSON.parse(await w13Zip.file(p)!.async("string")) as {
      uid?: string;
      fenID?: number;
      $id?: string;
      minRequiredVersion?: { major?: number; minor?: number; subminor?: number; build?: number };
      analysisClass?: string;
      inputDataSets?: { uid?: string; idx?: unknown }[];
    };
    const params = JSON.parse(
      await w13Zip.file(`analyses/${dirUid}/parameters.json`)!.async("string"),
    ) as {
      $id?: string;
      version?: unknown;
      content?: { model?: { equation?: { parameters?: string[]; initialValueRules?: Record<string, { value: number; rule: string }> } } };
    };
    const constants = JSON.parse(
      await w13Zip.file(`analyses/${dirUid}/constants.json`)!.async("string"),
    ) as { version?: unknown };
    const isNlreg = sheet.analysisClass === "NONLINEAR_REGRESSION";
    const isMtt = sheet.analysisClass === "MULTIPLE_TWO_SAMPLE_TESTS";
    if (isNlreg) w13Nlreg++;
    else if (sheet.analysisClass === "SURVIVAL") w13Survival++;
    else if (isMtt) w13Mtt++;
    if (sheet.uid !== dirUid) w13Problems.push(`${dirUid}: sheet uid ${sheet.uid ?? "?"} != dir`);
    if (sheet.fenID !== (isNlreg || isMtt ? 0 : 2)) w13Problems.push(`${dirUid}: fenID ${sheet.fenID ?? "?"}`);
    if (sheet.$id !== "analyses/sheet.schema.json") w13Problems.push(`${dirUid}: sheet $id ${sheet.$id ?? "?"}`);
    const mrv = sheet.minRequiredVersion;
    const wantMrv = isNlreg ? "8.2.0.0" : isMtt ? "10.0.0.0" : "0.0.0.0";
    if (`${mrv?.major}.${mrv?.minor}.${mrv?.subminor}.${mrv?.build}` !== wantMrv)
      w13Problems.push(`${dirUid}: MRV ${JSON.stringify(mrv)}`);
    const expectedParamsId = isNlreg
      ? "analyses/nonlinear_regression/parameters.schema.json"
      : isMtt
        ? "analyses/multiple_two_sample_tests/parameters.schema.json"
        : "analyses/survival/parameters.schema.json";
    if (params.$id !== expectedParamsId) w13Problems.push(`${dirUid}: params $id ${params.$id ?? "?"}`);
    if (params.version !== "0.0.0") w13Problems.push(`${dirUid}: params version ${JSON.stringify(params.version)}`);
    if (constants.version !== "0.0.0") w13Problems.push(`${dirUid}: constants version ${JSON.stringify(constants.version)}`);
    const inputs = sheet.inputDataSets ?? [];
    const seenUids = new Set<string>();
    inputs.forEach((inp, i) => {
      if (typeof inp.idx !== "string" || inp.idx !== String.fromCharCode(65 + i))
        w13Problems.push(`${dirUid}: input ${i} idx ${JSON.stringify(inp.idx)}`);
      if (!inp.uid || !dataSetUids.has(inp.uid)) w13Problems.push(`${dirUid}: input ${i} uid not a dataset`);
      if (inp.uid && seenUids.has(inp.uid)) w13Problems.push(`${dirUid}: duplicate input uid ${inp.uid}`);
      if (inp.uid) seenUids.add(inp.uid);
    });
    if (isNlreg) {
      const eq = params.content?.model?.equation;
      const rules = eq?.initialValueRules ?? {};
      const ruleKeys = Object.keys(rules).sort();
      const paramKeys = [...(eq?.parameters ?? [])].sort();
      if (JSON.stringify(ruleKeys) !== JSON.stringify(paramKeys))
        w13Problems.push(`${dirUid}: rules ${ruleKeys.join(",")} != params ${paramKeys.join(",")}`);
      if (dirUid && eq?.parameters?.includes("IC50")) {
        // 4PL-x rules are verbatim from the real demo file.
        if (rules.Bottom?.rule !== "*YMIN" || rules.Top?.rule !== "*YMAX" || rules.IC50?.rule !== "X_AT_YMID")
          w13Problems.push(`${dirUid}: 4PL-x rules not the real values`);
      }
    }
  }
  check(
    "W13a analysis sheets carry Prism identity (seq 247)",
    w13Problems.length === 0 && w13Nlreg >= 1 && w13Survival >= 1,
    `${w13Nlreg} NLREG + ${w13Survival} survival + ${w13Mtt} MTT; ${w13Problems.join("; ") || "all identity fields exact"}`,
  );
  // W13b: duplicate titles stay distinct inputs — an xy table with two "Y"
  // columns (the seq 247 F0 case: three "Y" datasets collapsed to one uid
  // by the title-keyed map) writes two inputs with distinct positional
  // uids and letter idx A/B, and the one-phase-decay equation carries
  // initialValueRules (P2-proven: Y0 *YMAX, Plateau *YMIN, K *YMAX).
  const dupXYWritten = await writePrism(
    {
      nodes: {
        t_xy: {
          id: "t_xy",
          type: "table",
          name: "XY dup",
          parentId: null,
          tableType: "xy",
          data: { columns: ["Title", "X", "Y", "Y"], rows: [["r1", "0", "1", "2"], ["r2", "1", "3", "4"]] },
        },
        a_opd: {
          id: "a_opd",
          type: "analysis",
          name: "One phase decay",
          parentId: "t_xy",
          analysisType: "nonlinear-regression",
          analysisParams: { model: "one-phase-decay" },
        },
      },
      rootOrder: ["t_xy"],
      childOrder: { t_xy: ["a_opd"], a_opd: [] },
      activeNodeId: "t_xy",
    },
    "1.0.7",
  );
  const dupXYZip = await JSZip.loadAsync(dupXYWritten.bytes);
  const dupXYProblems: string[] = [];
  const dupXYSetUids = new Set<string>();
  for (const p of Object.keys(dupXYZip.files)) {
    if (!p.startsWith("data/sets/") || !p.endsWith(".json") || dupXYZip.files[p].dir) continue;
    const d = JSON.parse(await dupXYZip.file(p)!.async("string")) as { uid?: string };
    if (d.uid) dupXYSetUids.add(d.uid);
  }
  let dupXYInputs: { uid?: string; title?: string; idx?: unknown }[] = [];
  let dupXYRules: Record<string, { value: number; rule: string }> = {};
  for (const p of Object.keys(dupXYZip.files)) {
    if (!p.startsWith("analyses/") || !p.endsWith("/sheet.json") || dupXYZip.files[p].dir) continue;
    const dirUid = p.split("/")[1];
    const sheet = JSON.parse(await dupXYZip.file(p)!.async("string")) as {
      inputDataSets?: { uid?: string; title?: string; idx?: unknown }[];
    };
    dupXYInputs = sheet.inputDataSets ?? [];
    const params = JSON.parse(
      await dupXYZip.file(`analyses/${dirUid}/parameters.json`)!.async("string"),
    ) as { content?: { model?: { equation?: { initialValueRules?: Record<string, { value: number; rule: string }> } } } };
    dupXYRules = params.content?.model?.equation?.initialValueRules ?? {};
  }
  if (dupXYInputs.length !== 2) dupXYProblems.push(`${dupXYInputs.length} inputs, want 2`);
  if (dupXYInputs[0]?.idx !== "A" || dupXYInputs[1]?.idx !== "B")
    dupXYProblems.push(`idx ${JSON.stringify(dupXYInputs.map((i) => i.idx))}`);
  if (dupXYInputs[0]?.uid === dupXYInputs[1]?.uid) dupXYProblems.push("inputs share one uid");
  if (!dupXYInputs.every((i) => i.uid && dupXYSetUids.has(i.uid))) dupXYProblems.push("input uid not a dataset");
  if (Object.keys(dupXYRules).sort().join(",") !== "K,Plateau,Y0")
    dupXYProblems.push(`rules ${Object.keys(dupXYRules).join(",")}`);
  if (dupXYRules.Y0?.rule !== "*YMAX" || dupXYRules.Plateau?.rule !== "*YMIN" || dupXYRules.K?.rule !== "*YMAX")
    dupXYProblems.push("one-phase-decay rules not the P2-proven values");
  // W14 (seq 289): grouped tables with unequal replicates per row write
  // replicate ranges by row occupancy, not one range spanning all rows.
  // "Paired" mirrors copy_2's paired tables (WT 3 replicates, SKG 7,
  // plus a wholly-blank row): subcols 0–2 are occupied in rows 0–1, so
  // range "0~2" gets firstRow 0, lastRow 1; subcols 3–6 only in row 1,
  // so "3~6" gets firstRow 1, lastRow 1 — the blank row must NOT extend
  // the span. "WT-only" mirrors the WT-only copies (SKG row entirely
  // blank): "0~2" gets [0, 0] and the wholly-blank "3~6" gets the
  // sentinel firstRow -1, lastRow -1. The old writer emitted one "0~6"
  // [0, lastRow] range for both — 32 of 58 grouped ranges in copy_2
  // violated Prism's invariant and Prism 11 refuses the file. Also pins
  // the row-titles replicate (one string DriverReplicate, firstRow 0,
  // lastRow <last>) and distinct info fenIDs (0, 2 — the original's
  // pattern), both fixed in the same pass. Generated fixtures only —
  // Mansi's files are repro-only, never test material.
  const seq289Project = {
    nodes: {
      t_paired: {
        id: "t_paired",
        type: "table",
        name: "Paired",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "Cond:Y1", "Cond:Y2", "Cond:Y3", "Cond:Y4", "Cond:Y5", "Cond:Y6", "Cond:Y7"],
          rows: [
            ["WT", "1.23", "0.8", "0.57", null, null, null, null],
            ["SKG", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6", "2.7"],
            [null, null, null, null, null, null, null, null],
          ],
        },
      },
      t_wtonly: {
        id: "t_wtonly",
        type: "table",
        name: "WT-only",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "Cond:Y1", "Cond:Y2", "Cond:Y3", "Cond:Y4", "Cond:Y5", "Cond:Y6", "Cond:Y7"],
          rows: [
            ["WT", "1.23", "0.8", "0.57", null, null, null, null],
            ["SKG", null, null, null, null, null, null, null],
          ],
        },
      },
      i_1: { id: "i_1", type: "info", name: "Project info 1", parentId: null },
      i_2: { id: "i_2", type: "info", name: "*Project info 1", parentId: null },
    },
    rootOrder: ["t_paired", "t_wtonly", "i_1", "i_2"],
    childOrder: { t_paired: [], t_wtonly: [], i_1: [], i_2: [] },
    activeNodeId: "t_paired",
  };
  const seq289Written = await writePrism(seq289Project as never, "1.0.7");
  const seq289Zip = await JSZip.loadAsync(seq289Written.bytes);
  const seq289Problems: string[] = [];
  const seq289Sets = new Map<string, Record<string, unknown>>();
  for (const p of Object.keys(seq289Zip.files)) {
    if (!p.startsWith("data/sets/") || !p.endsWith(".json") || seq289Zip.files[p].dir) continue;
    const d = JSON.parse(await seq289Zip.file(p)!.async("string")) as Record<string, unknown>;
    seq289Sets.set(String(d.uid), d);
  }
  const seq289Ranges = async (title: string) => {
    for (const p of Object.keys(seq289Zip.files)) {
      if (!p.startsWith("data/sheets/") || !p.endsWith("sheet.json") || seq289Zip.files[p].dir) continue;
      const sheet = JSON.parse(await seq289Zip.file(p)!.async("string")) as {
        title?: string;
        table?: { dataSets?: string[]; rowTitlesDataSet?: string };
      };
      if (sheet.title !== title) continue;
      const dsUid = sheet.table?.dataSets?.[0];
      const rtUid = sheet.table?.rowTitlesDataSet;
      return {
        ranges: (seq289Sets.get(dsUid ?? "") as { "replicate ranges"?: unknown } | undefined)?.[
          "replicate ranges"
        ],
        rowTitles: seq289Sets.get(rtUid ?? "") as { replicates?: unknown[] } | undefined,
      };
    }
    return { ranges: undefined, rowTitles: undefined };
  };
  const paired = await seq289Ranges("Paired");
  const wtOnly = await seq289Ranges("WT-only");
  const rangeShape = (ranges: unknown) =>
    JSON.stringify(
      (ranges as { range?: string; replicate?: { firstRow?: number; lastRow?: number } }[] | undefined)?.map(
        (r) => `${r.range ?? "?"}:[${r.replicate?.firstRow ?? "?"}..${r.replicate?.lastRow ?? "?"}]`,
      ),
    );
  if (rangeShape(paired.ranges) !== JSON.stringify(["0~2:[0..1]", "3~6:[1..1]"]))
    seq289Problems.push(`Paired ranges ${rangeShape(paired.ranges)}, want ["0~2:[0..1]","3~6:[1..1]"]`);
  if (rangeShape(wtOnly.ranges) !== JSON.stringify(["0~2:[0..0]", "3~6:[-1..-1]"]))
    seq289Problems.push(`WT-only ranges ${rangeShape(wtOnly.ranges)}, want ["0~2:[0..0]","3~6:[-1..-1]"]`);
  const rtShape = (rt: { replicates?: unknown[] } | undefined) => {
    const reps = (rt?.replicates ?? []) as { valueType?: string; firstRow?: number; lastRow?: number }[];
    return reps.length === 1
      ? `${reps[0].valueType ?? "?"}:[${reps[0].firstRow ?? "?"}..${reps[0].lastRow ?? "?"}]`
      : `${reps.length} replicates`;
  };
  if (rtShape(paired.rowTitles) !== "string:[0..2]")
    seq289Problems.push(`Paired row titles ${rtShape(paired.rowTitles)}, want string:[0..2]`);
  if (rtShape(wtOnly.rowTitles) !== "string:[0..1]")
    seq289Problems.push(`WT-only row titles ${rtShape(wtOnly.rowTitles)}, want string:[0..1]`);
  const seq289FenIDs: string[] = [];
  for (const p of Object.keys(seq289Zip.files)) {
    if (!p.startsWith("info/") || !p.endsWith("sheet.json") || seq289Zip.files[p].dir) continue;
    const d = JSON.parse(await seq289Zip.file(p)!.async("string")) as { title?: string; fenID?: number };
    seq289FenIDs.push(`${d.title ?? "?"}:${d.fenID ?? "?"}`);
  }
  if (JSON.stringify(seq289FenIDs.sort()) !== JSON.stringify(["*Project info 1:2", "Project info 1:0"]))
    seq289Problems.push(`info fenIDs ${seq289FenIDs.join(", ")}, want Project info 1:0, *Project info 1:2`);
  check(
    "W14 grouped ranges split by row occupancy (seq 289)",
    seq289Problems.length === 0,
    seq289Problems.join("; ") ||
      `Paired ${rangeShape(paired.ranges)}, WT-only ${rangeShape(wtOnly.ranges)}, row titles ${rtShape(paired.rowTitles)} / ${rtShape(wtOnly.rowTitles)}, info ${seq289FenIDs.sort().join(", ")}`,
  );
  const seq289Back = await convertPrism(seq289Written.bytes, "seq289-round-trip.prism");
  const seq289BackTables = seq289Back.project.rootOrder
    .map((id) => seq289Back.project.nodes[id])
    .filter((n) => n?.type === "table");
  const seq289Source = [seq289Project.nodes.t_paired, seq289Project.nodes.t_wtonly];
  // Compare columns + rows only: the importer derives groups/replicates
  // on grouped tables, so the re-imported data object carries fields the
  // fixture doesn't — the cell-identity question is columns and rows.
  const seq289RoundTrip =
    seq289BackTables.length === 2 &&
    seq289BackTables.every(
      (t, i) =>
        JSON.stringify(t.data?.columns) === JSON.stringify(seq289Source[i].data.columns) &&
        JSON.stringify(t.data?.rows) === JSON.stringify(seq289Source[i].data.rows),
    );
  check(
    "W14 .prism round-trip stays cell-identical (seq 289)",
    seq289RoundTrip,
    seq289BackTables.map((t) => `${t.name}: ${JSON.stringify(t.data?.rows)}`).join("; "),
  );
  check(
    "W13b duplicate-title inputs stay distinct with letter idx (seq 247)",
    dupXYProblems.length === 0,
    dupXYProblems.join("; ") || "2 inputs A/B, distinct dataset uids, Y0/Plateau/K rules exact",
  );
}

// W14 (seq 289, 1.8 M1): multiple-t-tests analyses write as
// MULTIPLE_TWO_SAMPLE_TESTS, params-only like NLREG/survival — the test
// enum + correction Prism recomputes per row (t, df, p) on open. Fixtures
// are generated, never Mansi's files. The grouped table mirrors her shape
// (two groups, unequal replicates per row are a data-table matter, not an
// analysis one). Expected: Welch + Holm (defaults) → EQUAL_SD + STATISTICAL/
// HOLM_SIDAK; paired + FDR → PAIRED + FDR/BKY; non-parametric → WILCOXON /
// MANN_WHITNEY; pooled SD and no-correction are registered, not written;
// a 3-group table with sets [G1, G3] writes inputs A and C (positional
// letters, skipping B — the real-file pattern).
{
  const mttProject = {
    nodes: {
      t_panel: {
        id: "t_panel",
        type: "table",
        name: "Panel",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "WT:Y1", "WT:Y2", "WT:Y3", "SKG:Y1", "SKG:Y2", "SKG:Y3"],
          rows: [
            ["Row1", "1.2", "1.1", "1.3", "2.1", "2.0", "2.2"],
            ["Row2", "0.8", "0.9", "0.7", "1.5", "1.6", "1.4"],
            ["Row3", "3.0", "3.1", "2.9", "3.2", "3.3", "3.1"],
          ],
          groups: 2,
          replicates: 3,
        },
      },
      t_three: {
        id: "t_three",
        type: "table",
        name: "Three groups",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "G1:Y1", "G1:Y2", "G2:Y1", "G2:Y2", "G3:Y1", "G3:Y2"],
          rows: [["r1", "1", "2", "3", "4", "5", "6"]],
          groups: 3,
          replicates: 2,
        },
      },
      a_welch: {
        id: "a_welch",
        type: "analysis",
        name: "WT unpaired t-test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: {},
      },
      a_paired_fdr: {
        id: "a_paired_fdr",
        type: "analysis",
        name: "WT paired t-test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: { paired: true, correction: "fdr" },
      },
      a_mw: {
        id: "a_mw",
        type: "analysis",
        name: "MW test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: { gaussian: false },
      },
      a_wilcox: {
        id: "a_wilcox",
        type: "analysis",
        name: "Wilcoxon test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: { gaussian: false, paired: true },
      },
      a_pooled: {
        id: "a_pooled",
        type: "analysis",
        name: "Pooled test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: { pooledSd: true },
      },
      a_none: {
        id: "a_none",
        type: "analysis",
        name: "No correction test",
        parentId: "t_panel",
        analysisType: "multiple-t-tests",
        analysisParams: { correction: "none" },
      },
      a_sets: {
        id: "a_sets",
        type: "analysis",
        name: "G1 vs G3 test",
        parentId: "t_three",
        analysisType: "multiple-t-tests",
        analysisParams: { sets: ["G1", "G3"] },
      },
    },
    rootOrder: ["t_panel", "t_three"],
    childOrder: {
      t_panel: ["a_welch", "a_paired_fdr", "a_mw", "a_wilcox", "a_pooled", "a_none"],
      t_three: ["a_sets"],
    },
    activeNodeId: "t_panel",
  };
  const mttWritten = await writePrism(mttProject as never, "1.0.7");
  const mttZip = await JSZip.loadAsync(mttWritten.bytes);
  const mttPaths = Object.keys(mttZip.files);
  const setUidByTitle = new Map<string, string>();
  for (const p of mttPaths) {
    if (!p.startsWith("data/sets/") || !p.endsWith(".json") || mttZip.files[p].dir) continue;
    const d = JSON.parse(await mttZip.file(p)!.async("string")) as { uid?: string; title?: string };
    if (d.uid && d.title) setUidByTitle.set(`${d.title}`, d.uid);
  }
  type MttSheet = {
    uid?: string;
    fenID?: number;
    $id?: string;
    minRequiredVersion?: { major?: number; minor?: number; subminor?: number; build?: number };
    analysisClass?: string;
    title?: string;
    inputDataSets?: { uid?: string; title?: string; idx?: string }[];
    resultSheets?: unknown[];
    isCalculated?: boolean;
  };
  type MttParams = {
    $id?: string;
    version?: unknown;
    content?: {
      test?: string;
      multipleComparisons?: {
        type?: string;
        statistical?: { test?: string; options?: { significanceLevel?: number } };
        fdr?: { test?: string; options?: { discoveryLevel?: number } };
        noCorrection?: { options?: { significanceLevel?: number } };
      };
    };
  };
  const mttByTitle = new Map<
    string,
    { dirUid: string; sheet: MttSheet; params: MttParams; constants: { version?: unknown } }
  >();
  for (const p of mttPaths) {
    if (!p.startsWith("analyses/") || !p.endsWith("/sheet.json") || mttZip.files[p].dir) continue;
    const dirUid = p.split("/")[1];
    const sheet = JSON.parse(await mttZip.file(p)!.async("string")) as MttSheet;
    const params = JSON.parse(await mttZip.file(`analyses/${dirUid}/parameters.json`)!.async("string")) as MttParams;
    const constants = JSON.parse(await mttZip.file(`analyses/${dirUid}/constants.json`)!.async("string")) as {
      version?: unknown;
    };
    if (sheet.title) mttByTitle.set(sheet.title, { dirUid, sheet, params, constants });
  }
  const mttProblems: string[] = [];
  const expectMtt = (
    name: string,
    test: string,
    mcType: string,
    mcTest: string,
    inputs: [string, string][],
  ) => {
    const got = mttByTitle.get(name);
    if (!got) {
      mttProblems.push(`${name}: not written`);
      return;
    }
    const { dirUid, sheet, params, constants } = got;
    if (sheet.uid !== dirUid) mttProblems.push(`${name}: sheet uid ${sheet.uid ?? "?"} != dir ${dirUid}`);
    if (sheet.analysisClass !== "MULTIPLE_TWO_SAMPLE_TESTS")
      mttProblems.push(`${name}: class ${sheet.analysisClass ?? "?"}`);
    if (sheet.fenID !== 0) mttProblems.push(`${name}: fenID ${sheet.fenID ?? "?"}`);
    if (sheet.$id !== "analyses/sheet.schema.json") mttProblems.push(`${name}: sheet $id ${sheet.$id ?? "?"}`);
    const mrv = sheet.minRequiredVersion;
    if (`${mrv?.major}.${mrv?.minor}.${mrv?.subminor}.${mrv?.build}` !== "10.0.0.0")
      mttProblems.push(`${name}: MRV ${JSON.stringify(mrv)}`);
    if (sheet.isCalculated !== false) mttProblems.push(`${name}: isCalculated ${String(sheet.isCalculated)}`);
    if ((sheet.resultSheets ?? []).length !== 0) mttProblems.push(`${name}: resultSheets not empty`);
    if (params.$id !== "analyses/multiple_two_sample_tests/parameters.schema.json")
      mttProblems.push(`${name}: params $id ${params.$id ?? "?"}`);
    if (params.version !== "0.0.0") mttProblems.push(`${name}: params version ${JSON.stringify(params.version)}`);
    if (constants.version !== "0.0.0")
      mttProblems.push(`${name}: constants version ${JSON.stringify(constants.version)}`);
    if (params.content?.test !== test) mttProblems.push(`${name}: test ${params.content?.test ?? "?"}`);
    const mc = params.content?.multipleComparisons;
    if (mc?.type !== mcType) mttProblems.push(`${name}: mc type ${mc?.type ?? "?"}`);
    const mcTestGot = mcType === "STATISTICAL" ? mc?.statistical?.test : mc?.fdr?.test;
    if (mcTestGot !== mcTest) mttProblems.push(`${name}: mc test ${mcTestGot ?? "?"}`);
    const gotInputs = (sheet.inputDataSets ?? []).map((i) => [i.title ?? "?", i.idx ?? "?"]);
    if (JSON.stringify(gotInputs) !== JSON.stringify(inputs))
      mttProblems.push(`${name}: inputs ${JSON.stringify(gotInputs)}`);
    for (const inp of sheet.inputDataSets ?? []) {
      if (!inp.uid || setUidByTitle.get(inp.title ?? "") !== inp.uid)
        mttProblems.push(`${name}: input ${inp.title ?? "?"} uid not a dataset`);
    }
  };
  expectMtt("WT unpaired t-test", "MULTIPLE_UNPAIRED_TWO_SAMPLE_EQUAL_SD_TESTS", "STATISTICAL", "HOLM_SIDAK", [
    ["WT", "A"],
    ["SKG", "B"],
  ]);
  expectMtt("WT paired t-test", "MULTIPLE_PAIRED_TWO_SAMPLE_TESTS", "FDR", "BENJAMINI_KRIEGER_YEKUTIELI", [
    ["WT", "A"],
    ["SKG", "B"],
  ]);
  expectMtt("MW test", "MULTIPLE_MANN_WHITNEY_TESTS", "STATISTICAL", "HOLM_SIDAK", [
    ["WT", "A"],
    ["SKG", "B"],
  ]);
  expectMtt("Wilcoxon test", "MULTIPLE_WILCOXON_TESTS", "STATISTICAL", "HOLM_SIDAK", [
    ["WT", "A"],
    ["SKG", "B"],
  ]);
  expectMtt("G1 vs G3 test", "MULTIPLE_UNPAIRED_TWO_SAMPLE_EQUAL_SD_TESTS", "STATISTICAL", "HOLM_SIDAK", [
    ["G1", "A"],
    ["G3", "C"],
  ]);
  check(
    "W14a multiple-t-tests write MULTIPLE_TWO_SAMPLE_TESTS (seq 289)",
    mttProblems.length === 0 && mttByTitle.size === 5,
    mttProblems.join("; ") || "5 written: Welch/paired/MW/Wilcoxon + G1-vs-G3 (A/C)",
  );
  const notWritten = mttWritten.report.analysesNotWritten;
  check(
    "W14b pooled SD + no correction are registered, not written (seq 289)",
    notWritten.length === 2 &&
      notWritten.some((s) => s.startsWith("Pooled test") && s.includes("pooled SD across rows")) &&
      notWritten.some((s) => s.startsWith("No correction test") && s.includes("no correction")) &&
      !mttByTitle.has("Pooled test") &&
      !mttByTitle.has("No correction test"),
    notWritten.join(" | "),
  );
  const mttReportText = [
    ...mttWritten.report.analyses,
    ...mttWritten.report.issues.map((i) => i.message),
  ].join("\n");
  check(
    "W14c correction substitutions are disclosed in the report (seq 289)",
    mttWritten.report.analyses.length === 5 &&
      mttReportText.includes("Holm-Šídák") &&
      mttReportText.includes("Benjamini-Krieger-Yekutieli"),
    `written: ${mttWritten.report.analyses.join(", ")}`,
  );
  check(
    "W14d multiple-t-tests write no results.json (params only, W3)",
    !mttPaths.some((p) => p.endsWith("results.json")),
    `${mttPaths.filter((p) => p.startsWith("analyses/")).length} analysis entries, none results.json`,
  );
}

// W15 (seq 197): a Parts-of-Whole table writes as format parts_of_whole and
// reads back as the native type, cell-identical — not as Column.
{
  const powProject = {
    nodes: {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Mendel peas",
        parentId: null,
        tableType: "parts-of-whole",
        data: {
          columns: ["Title", "# of seeds", "Expected"],
          rows: [
            ["Round and yellow", "315", "312.75"],
            ["Round and green", "108", "104.25"],
            ["Angular and yellow", "101", "104.25"],
            ["Angular and green", "32", "34.75"],
          ],
        },
      },
    },
    rootOrder: ["table_1"],
    childOrder: { table_1: [] },
    activeNodeId: "table_1",
  };
  const powWritten = await writePrism(powProject as never, "1.0.7");
  const powZip = await JSZip.loadAsync(powWritten.bytes);
  const powSheet = JSON.parse(
    (await powZip
      .file(Object.keys(powZip.files).find((p) => p.startsWith("data/sheets/") && p.endsWith("sheet.json"))!)!
      .async("string")) as string,
  ) as { table?: { format?: string } };
  const powBack = await convertPrism(powWritten.bytes, "pow-round-trip.prism");
  const powTable = Object.values(powBack.project.nodes).find((n) => n?.type === "table");
  check(
    "W15 Parts-of-Whole .prism round-trip keeps the native type",
    powSheet.table?.format === "parts_of_whole" &&
      powTable?.tableType === "parts-of-whole" &&
      JSON.stringify(powTable?.data) === JSON.stringify(powProject.nodes.table_1.data),
    `format ${powSheet.table?.format}, back as ${powTable?.tableType}`,
  );
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
