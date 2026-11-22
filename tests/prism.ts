// `.prism` import tests — plan prism-format-work, regression tests C-01, C-02,
// C-08, C-10, C-11 (plus the post-rebase survival-type regression).
//
//   C-01  demo file: 14 tables, 2 analyses (4PL → 2 nodes, survival → 1 node),
//         report lists 17 graphs + 1 layout not transferred
//   C-02  cell-by-cell diff of every imported table vs its source `data.csv`
//         (expectations from tests/prism-layout-spec.ts — an independent
//         implementation of the vault spec, never the converter's own walk)
//   C-08  checksum: the source file is byte-identical before and after
//   C-10  transfer-report honesty: exact counts, "not transferred" for
//         graphs/layouts, no "100% compatible" claim anywhere
//   C-11  corrupt `.prism` (truncated zip; document.json deleted; non-ZIP):
//         plain-language error, no crash, no partial project
//
// Corpus: the demo file lives in tests/testdata/prism/ (a copy of the public
// prism2R demo; the original stays in ~/workspace/helix/test-corpus/ — Mansi's
// files are never test material). A wider sweep runs when
// PRISM_TEST_CORPUS_PRISM10 points at a directory of public `.prism` files
// (the 66-file corpus on branch feat/prism-converter-cli): every file must
// convert and round-trip through Helix's own parser with zero error issues,
// except the two known rejects (empty.prism, cloud-verification-mdp).
// `npm test` runs the demo checks; the sweep runs only when the dir exists.
//
// Ported from the standalone converter CLI's verify.ts (branch
// feat/prism-converter-cli), adapted to the app: the survival analysis node
// is `analysisType: "survival"` with `{ curveTest: "logrank", correction:
// "holm" }` (the Nov 10 rebase dropped the CLI's "survival-log-rank" key),
// and Prism survival tables import as Helix tableType `"survival"`.
/// <reference types="node" />
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { parseProjectFile, serializeProjectFile } from "../src/lib/project-file";
import { convertPrism, formatReport, type ConvertResult } from "../src/lib/prism";
import { parseCsv } from "../src/lib/prism-csv";
import { detectThousandsMode, expectedRows, resolveLayout, type SetJson } from "./prism-layout-spec";

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
const beforeHash = createHash("sha256").update(input).digest("hex");
const zip = await JSZip.loadAsync(input);
const text = async (p: string) => (await zip.file(p)?.async("string")) ?? null;
const json = async <T>(p: string): Promise<T> => JSON.parse((await text(p)) as string) as T;

const doc = await json<{
  sheets: { data: string[]; graphs: string[]; layouts: string[]; analyses: string[]; info: string[] };
  sheetAttributesMap: Record<string, { title?: string }>;
}>("document.json");

let result: ConvertResult;
try {
  result = await convertPrism(new Uint8Array(input), "prism2R-demo_dataset.prism");
  check(
    "P1 convert",
    true,
    `no error; ${result.report.tables.length} tables, ${result.report.analyses.length} analysis nodes`,
  );
} catch (err) {
  check("P1 convert", false, err instanceof Error ? err.message : String(err));
  process.exit(1);
}
const { project, report } = result;
const tables = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "table");
const tableByName = new Map<string, (typeof tables)[number][]>();
for (const t of tables) {
  const list = tableByName.get(t.name) ?? [];
  list.push(t);
  tableByName.set(t.name, list);
}

// P2 (C-01): 14 tables, document order, exact titles.
const expectedTitles = doc.sheets.data.map((uid) => doc.sheetAttributesMap[uid]?.title ?? "");
check(
  "P2 tables",
  tables.length === 14 && tables.map((t) => t.name).join("|") === expectedTitles.join("|"),
  `${tables.length} tables; order ${tables.map((t) => t.name).join(" / ")}`,
);

// P3 + P4 (C-02): dims + cell-by-cell vs source CSVs. Expectations come from
// tests/prism-layout-spec.ts (the independent builder), per sheet.
let v4cells = 0;
let v4bad: string[] = [];
let thousandsMode = false;
for (const path of Object.keys(zip.files)) {
  if (!/^data\/tables\/[^/]+\/data\.csv$/.test(path)) continue;
  const csvFile = zip.file(path);
  if (!csvFile) continue;
  if (detectThousandsMode(parseCsv(await csvFile.async("string")))) {
    thousandsMode = true;
    break;
  }
}
for (const sheetUid of doc.sheets.data) {
  const sheet = await json<{
    title?: string;
    table: {
      uid: string;
      format: string;
      dataFormat: string;
      replicatesCount?: number;
      dataSets: string[];
      xDataSet?: string;
      rowTitlesDataSet?: string;
    };
  }>(`data/sheets/${sheetUid}/sheet.json`);
  const csvText = (await text(`data/tables/${sheet.table.uid}/data.csv`)) as string;
  let csv = parseCsv(csvText);
  const contentRaw = await json<{ numberOfColumns?: number; numberOfRows?: number }>(
    `data/tables/${sheet.table.uid}/content.json`,
  ).catch(() => null);
  const content = {
    numberOfColumns: contentRaw?.numberOfColumns ?? csv[0]?.length ?? 0,
    numberOfRows: contentRaw?.numberOfRows ?? csv.length,
  };
  if (csv.length > content.numberOfRows) csv = csv.slice(0, content.numberOfRows);
  while (csv.length < content.numberOfRows) csv.push([]);
  const setJsons = await Promise.all(
    sheet.table.dataSets.map((u) => json<SetJson>(`data/sets/${u}.json`).catch(() => null)),
  );
  const xJson = sheet.table.xDataSet
    ? await json<SetJson>(`data/sets/${sheet.table.xDataSet}.json`).catch(() => null)
    : null;
  const layoutInput = {
    format: sheet.table.format,
    dataFormat: sheet.table.dataFormat,
    replicatesCount: sheet.table.replicatesCount,
    hasTitleCol: sheet.table.rowTitlesDataSet != null,
    declaredCols: content.numberOfColumns,
    declaredRows: content.numberOfRows,
    xPresent: sheet.table.xDataSet !== undefined,
    xJson,
    sets: setJsons,
    thousandsMode,
  };
  const layout = resolveLayout(layoutInput);
  const expCols = ["Title", ...layout.columns];
  const node = tables.find((t) => t.name === sheet.title && t.data!.columns.join("|") === expCols.join("|"));
  if (!node) {
    v4bad.push(`${sheet.title}: no table with expected columns [${expCols.join(", ")}]`);
    continue;
  }
  const data = node.data!;
  const expectedHlxCols = 1 + layout.columns.length;
  check(
    `P3 dims ${sheet.title}`,
    data.columns.length === expectedHlxCols && data.rows.length === content.numberOfRows,
    `${data.columns.length}x${data.rows.length} vs layout ${expectedHlxCols}x${content.numberOfRows}`,
  );
  const expRows = expectedRows(layoutInput, layout, csv);
  for (let r = 0; r < data.rows.length; r++) {
    const expected = expRows[r];
    for (let c = 0; c < expected.length; c++) {
      v4cells++;
      if (data.rows[r][c] !== expected[c]) {
        v4bad.push(
          `${sheet.title} r${r} c${c} (${data.columns[c]}): got ${JSON.stringify(data.rows[r][c])}, want ${JSON.stringify(expected[c])}`,
        );
      }
    }
  }
  if (sheet.table.format === "grouped") {
    const presentCounts = setJsons
      .map((s, i) => (s === null ? null : layout.counts[i]))
      .filter((c): c is number => c !== null);
    const expectedReplicates = sheet.table.replicatesCount ?? Math.max(...presentCounts);
    const ok = data.groups === layout.presentSets.length && data.replicates === expectedReplicates;
    check(`P3 grouped ${sheet.title}`, ok === true, `groups=${data.groups} replicates=${data.replicates}`);
  }
}
check(
  "P4 cells",
  v4bad.length === 0,
  `${v4cells} cells compared; ${v4bad.length} mismatches${v4bad.length ? ": " + v4bad.slice(0, 3).join(" | ") : ""}`,
);

// P5 (C-01): analysis nodes — 2 nonlinear-regression (4PL, one per dataset)
// + 1 survival. The survival node must carry the CURRENT registry key
// "survival" (not the pre-rebase "survival-log-rank", which parseProjectFile
// flags as an unknown test) with log-rank params, and its parent table must
// be a Helix "survival" table.
const analyses = Object.values(project.nodes).filter((n) => n.type === "analysis");
const nonlin = analyses.filter((a) => a.analysisType === "nonlinear-regression");
const survival = analyses.filter((a) => a.analysisType === "survival");
const staleSurvival = analyses.filter((a) => (a.analysisType as string) === "survival-log-rank");
const nonlinOk =
  nonlin.length === 2 &&
  nonlin.every((a) => (a.analysisParams as { model?: string })?.model === "sigmoidal-4pl-x") &&
  new Set(nonlin.map((a) => (a.analysisParams as { y?: string })?.y)).size === 2 &&
  nonlin.every((a) => project.nodes[a.parentId ?? ""]?.name === "XY: Entering replicate data");
const survParams = survival[0]?.analysisParams as { curveTest?: string; correction?: string } | undefined;
const survOk =
  survival.length === 1 &&
  staleSurvival.length === 0 &&
  project.nodes[survival[0].parentId ?? ""]?.name === "Survival: Two groups" &&
  project.nodes[survival[0].parentId ?? ""]?.tableType === "survival" &&
  survParams?.curveTest === "logrank" &&
  survParams?.correction === "holm";
check(
  "P5 analyses",
  analyses.length === 3 && nonlinOk && survOk,
  `${analyses.length} nodes: ${analyses.map((a) => `${a.name} (${a.analysisType})`).join("; ")}`,
);

// P6: round-trip through Helix's own parser — with ZERO error issues. This is
// the regression test that would have caught the stale "survival-log-rank"
// key: parseProjectFile flags an unknown analysis type as an error.
const dir = await mkdtemp(join(tmpdir(), "prism-import-"));
const outPath = join(dir, "demo.hlx");
await writeFile(outPath, serializeProjectFile(project));
const parsed = parseProjectFile(JSON.parse(await readFile(outPath, "utf8")));
if ("error" in parsed) {
  check("P6 round-trip", false, parsed.error);
} else {
  const n = Object.keys(parsed.project.nodes).length;
  const errors = parsed.issues.filter((i) => i.severity === "error");
  check(
    "P6 round-trip",
    n === Object.keys(project.nodes).length && errors.length === 0,
    `${n} nodes re-read; issues: ${parsed.issues.map((i) => i.message).join(" | ") || "none"}`,
  );
}

// P7 (C-08): source untouched.
const afterHash = createHash("sha256")
  .update(await readFile(DEMO))
  .digest("hex");
check("P7 source untouched", beforeHash === afterHash, `sha256 ${beforeHash.slice(0, 12)}… before and after`);

// P8 (C-01 + C-10): report counts and honest wording.
const reportText = formatReport(report);
check(
  "P8 report",
  report.tables.length === 14 &&
    report.graphsNotTransferred === 17 &&
    report.layoutsNotTransferred === 1 &&
    report.orphanSheetsIgnored === 7 &&
    report.unreferencedTablesIgnored === 8 &&
    report.analysesUnsupported.length === 0 &&
    report.infoSheets === 1 &&
    report.infoSheetNames.join(", ") === "Project info 1" &&
    reportText.includes("Info sheets transferred: 1 — Project info 1.") &&
    reportText.includes("not transferred") &&
    !reportText.includes("100% compatible"),
  `tables=${report.tables.length} graphs=${report.graphsNotTransferred} layouts=${report.layoutsNotTransferred} orphans=${report.orphanSheetsIgnored} unreferenced=${report.unreferencedTablesIgnored} unsupported=${report.analysesUnsupported.length} info=${report.infoSheets}`,
);

// P10: the demo file's info sheet transfers — name, constants (string
// values, as Prism stores them) and notes — as an info node at the project
// root, after the tables. The trailing empty-named constant Prism writes is
// the new-row placeholder, not a constant.
{
  const infos = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "info");
  const sheet = infos[0]?.info;
  const byName = new Map((sheet?.constants ?? []).map((c) => [c.name, c.value]));
  check(
    "P10 info sheet",
    infos.length === 1 &&
      infos[0].name === "Project info 1" &&
      project.rootOrder.indexOf(infos[0].id) === 14 &&
      byName.get("Experiment Date") === "Dec-01-2024" &&
      byName.size === 6 &&
      sheet?.notes === "" &&
      sheet?.linkedTableId === null,
    `${infos.length} info sheet(s); constants: ${(sheet?.constants ?? []).map((c) => `${c.name}=${JSON.stringify(c.value)}`).join(", ")}`,
  );
}

// P9 (C-11): corrupt files fail with a plain-language error, never a crash.
async function expectRefusal(name: string, bytes: Uint8Array, want: string) {
  try {
    await convertPrism(bytes, name);
    check(`P9 corrupt ${name}`, false, "converted without error");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(
      `P9 corrupt ${name}`,
      message.length > 0 && message.includes(want) && !message.includes("\n    at ") && !message.includes("node:"),
      message.slice(0, 120),
    );
  }
}
await expectRefusal(
  "truncated.prism",
  new Uint8Array(input.slice(0, Math.floor(input.length / 2))),
  "isn't a Prism 10",
);
await expectRefusal("not-a-prism.prism", new TextEncoder().encode("this is not a zip file at all"), "isn't a Prism 10");
{
  const empty = new JSZip();
  await expectRefusal(
    "no-document.prism",
    new Uint8Array(await empty.generateAsync({ type: "uint8array" })),
    "document.json is missing",
  );
}

// P14: corpus sweep (only when PRISM_TEST_CORPUS_PRISM10 is set and exists).
const corpusDir = process.env.PRISM_TEST_CORPUS_PRISM10;
if (corpusDir) {
  const files = (await readdir(corpusDir)).filter((f) => f.endsWith(".prism")).sort();
  // Files that must fail conversion (mirrors the converter CLI's
  // EXPECTED_REJECTS in verify-corpus.ts — same extension, not GraphPad at
  // all, or no data tables Helix can use).
  const knownRejects = new Set([
    "empty.prism",
    "synthetic-graphs-only.prism",
    "cloud-verification-mdp-zenodo-17746477.prism",
    "energy-system-zenodo-23184357.prism",
  ]);
  if (files.length === 0) {
    console.log("P14 corpus sweep — no .prism files found, skipped");
  } else {
    let swept = 0;
    let sweptBad: string[] = [];
    for (const file of files) {
      const bytes = await readFile(join(corpusDir, file));
      try {
        const converted = await convertPrism(new Uint8Array(bytes), file);
        const reparsed = parseProjectFile(JSON.parse(serializeProjectFile(converted.project)));
        if ("error" in reparsed) sweptBad.push(`${file}: re-parse error ${reparsed.error}`);
        else if (reparsed.issues.some((i) => i.severity === "error")) {
          sweptBad.push(
            `${file}: ${reparsed.issues
              .filter((i) => i.severity === "error")
              .map((i) => i.message)
              .join("; ")}`,
          );
        } else if (knownRejects.has(file)) sweptBad.push(`${file}: converted, expected refusal`);
        else swept++;
      } catch (err) {
        if (knownRejects.has(file)) swept++;
        else sweptBad.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    check(
      "P14 corpus sweep",
      sweptBad.length === 0,
      `${swept}/${files.length} files converted + re-parsed clean${sweptBad.length ? ": " + sweptBad.slice(0, 3).join(" | ") : ""}`,
    );
  }
} else {
  console.log("P14 corpus sweep — PRISM_TEST_CORPUS_PRISM10 not set, skipped");
}

// P15 (BUG-10): excluded (struck-through) cells in a real Prism file —
// `cellAttributes` entries with "EXCLUDED" in the dataset JSON — restore
// as Titer excluded cells. Synthetic fixture, built here: an xy table
// whose A dataset is y_replicates with two ranges (range "0" excludes
// row 1, range "1" does not), whose B dataset is y_single excluding rows
// 0 and 2~3 (plus one malformed entry, which warns and leaves the cell
// live), and whose X dataset excludes row 2.
{
  const z = new JSZip();
  const sheetUid = "11111111-1111-1111-1111-111111111111";
  const tableUid = "22222222-2222-2222-2222-222222222222";
  const xUid = "33333333-3333-3333-3333-333333333333";
  const aUid = "44444444-4444-4444-4444-444444444444";
  const bUid = "55555555-5555-5555-5555-555555555555";
  const rtUid = "66666666-6666-6666-6666-666666666666";
  z.file(
    "document.json",
    JSON.stringify({
      "@class": "Document",
      createdBy: { name: "Prism", version: "10.3.0" },
      formatVersion: "1-4-1",
      sheets: { graphs: [], layouts: [], analyses: [], info: [], data: [sheetUid] },
      sheetAttributesMap: { [sheetUid]: { title: "Data 1" } },
    }),
  );
  z.file(
    `data/sheets/${sheetUid}/sheet.json`,
    JSON.stringify({
      "@class": "DataSheet",
      title: "Data 1",
      table: {
        uid: tableUid,
        format: "xy",
        dataFormat: "y_replicates",
        dataSets: [aUid, bUid],
        xDataSet: xUid,
        rowTitlesDataSet: rtUid,
      },
    }),
  );
  z.file(`data/tables/${tableUid}/content.json`, JSON.stringify({ numberOfColumns: 5, numberOfRows: 4, version: 1 }));
  z.file(`data/tables/${tableUid}/data.csv`, "R1,1,10,20,100\nR2,2,11,21,101\nR3,3,12,22,102\nR4,4,13,23,103\n");
  const rep = (cellAttributes?: unknown[]) => ({
    "@class": "DriverReplicate",
    valueType: "real",
    commonAttributes: ["NUMERIC"],
    decimalsLength: 1,
    significantDigitsCount: 7,
    lastRow: 3,
    firstRow: 0,
    ...(cellAttributes ? { cellAttributes } : {}),
  });
  z.file(
    `data/sets/${xUid}.json`,
    JSON.stringify({
      "@class": "DataSet",
      uid: xUid,
      format: "y_single",
      title: "X",
      attributes: ["DS_ATTR_X"],
      replicates: [rep([{ rows: "2", attributes: ["EXCLUDED"] }])],
    }),
  );
  z.file(
    `data/sets/${aUid}.json`,
    JSON.stringify({
      "@class": "DataSet",
      uid: aUid,
      format: "y_replicates",
      title: "A",
      attributes: ["DS_ATTR_Y"],
      "replicate ranges": [
        { range: "0", replicate: rep([{ rows: "1", attributes: ["EXCLUDED"] }]) },
        { range: "1", replicate: rep() },
      ],
    }),
  );
  z.file(
    `data/sets/${bUid}.json`,
    JSON.stringify({
      "@class": "DataSet",
      uid: bUid,
      format: "y_single",
      title: "B",
      attributes: ["DS_ATTR_Y"],
      replicates: [
        rep([
          { rows: "0", attributes: ["EXCLUDED"] },
          { rows: "2~3", attributes: ["EXCLUDED"] },
          { rows: "bogus", attributes: ["EXCLUDED"] },
        ]),
      ],
    }),
  );
  z.file(
    `data/sets/${rtUid}.json`,
    JSON.stringify({
      "@class": "DataSet",
      uid: rtUid,
      format: "text",
      title: "Row titles",
      attributes: ["DS_ATTR_RT"],
      replicates: [],
    }),
  );
  const bytes = new Uint8Array(await z.generateAsync({ type: "uint8array" }));
  const { project, report } = await convertPrism(bytes, "excluded-synthetic.prism");
  const table = project.rootOrder
    .map((id) => project.nodes[id])
    .find((n) => n?.type === "table" && n.name === "Data 1");
  // Full-grid cols: Title 0, X 1, A_1 2, A_2 3, B 4.
  const want = ["0,4", "1,2", "2,1", "2,4", "3,4"];
  check(
    "P15 excluded cells restored",
    JSON.stringify(table?.data?.excluded ?? []) === JSON.stringify(want),
    `excluded ${JSON.stringify(table?.data?.excluded ?? [])} (want ${JSON.stringify(want)})`,
  );
  check(
    "P15 malformed exclusion warns, cell stays live",
    report.issues.some((i) => i.message.includes("bogus")) && (table?.data?.rows?.[0]?.[4] ?? null) === "100",
    report.issues.map((i) => i.message).join(" | ") || "no issues",
  );
}

// P16 (BUG-10): real corpus files with EXCLUDED markers restore them —
// counts from an independent Python scan of the dataset JSONs (rows ×
// subcolumns per replicate range). Only when the corpus dir is set.
if (corpusDir) {
  const files = (await readdir(corpusDir)).filter((f) => f.endsWith(".prism"));
  const pins: [string, string, number][] = [
    ["sirna-pai-1-manuscript-data-zenodo-21038547.prism", "Cytokine data endpoint", 1],
    ["capsanoicids-241121-pn-zenodo-14204350.prism", "extracts peak relative", 29],
  ];
  for (const [file, tableName, want] of pins) {
    if (!files.includes(file)) continue;
    const { project } = await convertPrism(new Uint8Array(await readFile(join(corpusDir, file))), file);
    const table = project.rootOrder
      .map((id) => project.nodes[id])
      .find((n) => n?.type === "table" && n.name === tableName);
    const got = table?.data?.excluded?.length ?? 0;
    check(`P16 excluded cells in ${file} / ${tableName}`, got === want, `${got} excluded (want ${want})`);
  }
}

// P17 (seq 305): a Prism nested table imports as Column with the values
// intact, and the import report tells the user exactly what to do —
// there is no convert-to-Nested in Titer yet, so make a new Nested table
// and copy the values across. Generated fixture (same shape as P15),
// never a real Prism file: format "nested", y_replicates, two datasets
// of three replicates each.
{
  const z = new JSZip();
  const sheetUid = "77777777-7777-7777-7777-777777777777";
  const tableUid = "88888888-8888-8888-8888-888888888888";
  const aUid = "99999999-9999-9999-9999-999999999999";
  const bUid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  z.file(
    "document.json",
    JSON.stringify({
      "@class": "Document",
      createdBy: { name: "Prism", version: "10.3.0" },
      formatVersion: "1-4-1",
      sheets: { graphs: [], layouts: [], analyses: [], info: [], data: [sheetUid] },
      sheetAttributesMap: { [sheetUid]: { title: "Nested data" } },
    }),
  );
  z.file(
    `data/sheets/${sheetUid}/sheet.json`,
    JSON.stringify({
      "@class": "DataSheet",
      title: "Nested data",
      table: {
        uid: tableUid,
        format: "nested",
        dataFormat: "y_replicates",
        replicatesCount: 3,
        dataSets: [aUid, bUid],
      },
    }),
  );
  z.file(`data/tables/${tableUid}/content.json`, JSON.stringify({ numberOfColumns: 6, numberOfRows: 3, version: 1 }));
  z.file(`data/tables/${tableUid}/data.csv`, "10,11,12,20,21,22\n30,31,32,40,41,42\n50,51,52,60,61,62\n");
  const rep = () => ({
    "@class": "DriverReplicate",
    valueType: "real",
    commonAttributes: ["NUMERIC"],
    decimalsLength: 1,
    significantDigitsCount: 7,
    lastRow: 2,
    firstRow: 0,
  });
  for (const [uid, title] of [
    [aUid, "Group A"],
    [bUid, "Group B"],
  ] as const) {
    z.file(
      `data/sets/${uid}.json`,
      JSON.stringify({
        "@class": "DataSet",
        uid,
        format: "y_replicates",
        title,
        attributes: ["DS_ATTR_Y"],
        replicates: [rep(), rep(), rep()],
      }),
    );
  }
  const bytes = new Uint8Array(await z.generateAsync({ type: "uint8array" }));
  const { project, report } = await convertPrism(bytes, "nested-synthetic.prism");
  const table = project.rootOrder
    .map((id) => project.nodes[id])
    .find((n) => n?.type === "table" && n.name === "Nested data");
  const wantMessage =
    "“Nested data”: Prism nested tables import as Column — there is no convert-to-Nested in Titer yet; make a new Nested table (Table ▸ New Table ▸ Nested) with the same groups, subgroups and replicates, then copy the values across.";
  check(
    "P17 nested imports as Column, values intact",
    table?.tableType === "column" &&
      JSON.stringify(table?.data?.columns ?? []) ===
        JSON.stringify(["Title", "Group A_1", "Group A_2", "Group A_3", "Group B_1", "Group B_2", "Group B_3"]) &&
      JSON.stringify(table?.data?.rows ?? []) ===
        JSON.stringify([
          [null, "10", "11", "12", "20", "21", "22"],
          [null, "30", "31", "32", "40", "41", "42"],
          [null, "50", "51", "52", "60", "61", "62"],
        ]),
    `type=${table?.tableType} cols=${(table?.data?.columns ?? []).join(",")}`,
  );
  check(
    "P17 nested message names the manual path",
    report.issues.some((i) => i.severity === "warning" && i.message === wantMessage) &&
      formatReport(report).includes(wantMessage),
    report.issues.map((i) => i.message).join(" | ") || "no issues",
  );
}

console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
