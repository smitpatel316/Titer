// `.prism` writer tests — plan prism-format-work, regression test C-06
// (round-trip .prism → .hlx → .prism) plus the writer's identity rules.
//
//   C-06  tables cell-identical, analyses present with identical parameters
//   W3    the written file is honestly Titer's: fresh UUIDs, createdBy Titer,
//         no graphs/layouts, no results.json
//   W4    a minimal one-table project writes exactly the required entries
//   W5    a Nested table refuses the whole write, naming the table
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
  // W5: a Nested table refuses the whole write, naming the table.
  try {
    await writePrism(
      {
        nodes: {
          table_1: {
            id: "table_1",
            type: "table",
            name: "Nested data",
            parentId: null,
            tableType: "nested",
            data: { columns: ["Title", "A"], rows: [[null, "1"]] },
          },
        },
        rootOrder: ["table_1"],
        childOrder: { table_1: [] },
        activeNodeId: "table_1",
      },
      "1.0.7",
    );
    check("W5 nested refusal", false, "wrote without error");
  } catch (err) {
    check(
      "W5 nested refusal",
      err instanceof Error && err.message.includes("Nested data") && err.message.includes("Prism has no matching"),
      err instanceof Error ? err.message.slice(0, 120) : String(err),
    );
  }
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
    if (isNlreg) w13Nlreg++;
    else if (sheet.analysisClass === "SURVIVAL") w13Survival++;
    if (sheet.uid !== dirUid) w13Problems.push(`${dirUid}: sheet uid ${sheet.uid ?? "?"} != dir`);
    if (sheet.fenID !== (isNlreg ? 0 : 2)) w13Problems.push(`${dirUid}: fenID ${sheet.fenID ?? "?"}`);
    if (sheet.$id !== "analyses/sheet.schema.json") w13Problems.push(`${dirUid}: sheet $id ${sheet.$id ?? "?"}`);
    const mrv = sheet.minRequiredVersion;
    const wantMrv = isNlreg ? "8.2.0.0" : "0.0.0.0";
    if (`${mrv?.major}.${mrv?.minor}.${mrv?.subminor}.${mrv?.build}` !== wantMrv)
      w13Problems.push(`${dirUid}: MRV ${JSON.stringify(mrv)}`);
    const expectedParamsId = isNlreg
      ? "analyses/nonlinear_regression/parameters.schema.json"
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
    `${w13Nlreg} NLREG + ${w13Survival} survival; ${w13Problems.join("; ") || "all identity fields exact"}`,
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
  check(
    "W13b duplicate-title inputs stay distinct with letter idx (seq 247)",
    dupXYProblems.length === 0,
    dupXYProblems.join("; ") || "2 inputs A/B, distinct dataset uids, Y0/Plateau/K rules exact",
  );
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
