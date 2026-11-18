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
  // W6 (BUG-10): excluded cells survive a .prism round-trip, written in
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
    "W6 writer emits Prism EXCLUDED cellAttributes",
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
    "W6 .prism round-trip preserves exclusions",
    JSON.stringify(backExcluded("Data 1")) === JSON.stringify(["1,2", "1,3", "1,4"]) &&
      JSON.stringify(backExcluded("Col")) === JSON.stringify(["1,1"]),
    `Data 1 ${JSON.stringify(backExcluded("Data 1"))}; Col ${JSON.stringify(backExcluded("Col"))}`,
  );
  // W7: a project with no exclusions writes no cellAttributes anywhere —
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
  check("W7 no exclusions, no cellAttributes", cellAttrs === 0, `${cellAttrs} file(s) mention cellAttributes`);
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
