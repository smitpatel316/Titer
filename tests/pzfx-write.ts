// `.pzfx` writer tests — item 104 Phase 1 (mirror of tests/prism-write.ts
// W1–W6, adapted to the .pzfx shape).
//
//   W1  round-trip .pzfx → .hlx → .pzfx → .hlx, cell-identical on all 10
//       fixtures (values, row titles, column names/order, excluded cells,
//       date X, X error series, summary subcolumn names) + synthetic
//       round-trips for the shapes no fixture covers (X error, grouped
//       replicates, XY summary, date X restored from row titles)
//   W2  info sheets identical on the 8 fixtures that carry <Info>
//   W3  the written file is honestly Titer's: CreatedByProgram Titer +
//       app version, fresh sequential Table0…/Info0… IDs, exactly one
//       EMPTY <Template> element (BUG-21: Prism 11.2.0 shows its
//       compliance dialog for non-Prism files without one), no
//       MostRecentVersion/Login, never YFormat=""
//   W4  a minimal one-table project writes exactly the required elements
//       (including the empty <Template>)
//   W5  refusals: Nested / Multiple / mixed-format tables and a project
//       with no tables refuse the whole write, naming the table
//   W6  every written file validates against the Prism 8 Mac XSD
//       (namespace-stripped copy — see below); the source
//       twoway_empty_yformat.pzfx must FAIL it (negative control)
//
// XSD validation (W6) runs through tests/validate-pzfx.py, which uses lxml
// when present and falls back to xmllint (the Mac has no lxml but ships
// /usr/bin/xmllint). The XSD is the namespace-stripped copy at
// tests/testdata/Prism8XMLSchema-stripped.xsd: the shipped XSD declares
// targetNamespace="http://graphpad.com/prism/Prism.htm", but Prism's own
// .pzfx files carry no namespace, so strict validation against the shipped
// XSD fails every file — including Prism's own. If neither validator
// exists on the machine, W6 falls back to a pure-TS structural check and
// prints a loud warning (the tests/packages.ts precedent: warn + skip,
// never silently pass) — the check then validates the content model
// (element order, enum membership, no YFormat="", ID/Ref consistency,
// Subcolumns counts) instead of the XSD itself.
//
// BUG-21 (Nov 17, 2026, real Prism 11.2.0 ablation, 26 files): Prism shows
// its XML-compliance dialog iff CreatedByProgram != "GraphPad Prism" AND
// the file carries no <Template>; an empty <Template> element opens with no
// dialog, titled with the filename, while any non-empty minimal blob fails
// to open at all. This leg proves round-trip through Titer's own importer
// + XSD validation; Prism acceptance of the empty Template is pinned by
// the W3 check below and was verified live against Prism 11.2.0.
//
// `npm test` runs this after tests/prism-write.ts.
/// <reference types="node" />
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, strictEqual, throws } from "node:assert/strict";
import { parsePzfx } from "../src/lib/pzfx";
import { writePzfx, formatPzfxWriteReport } from "../src/lib/pzfx-write";
import type { ProjectFilePayload } from "../src/lib/project-file";
import type { TableType } from "../src/store/types";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const APP_VERSION = "1.4.0";
const XSD = join(HERE, "testdata", "Prism8XMLSchema-stripped.xsd");
const VALIDATOR = join(HERE, "validate-pzfx.py");

const FIXTURES = [
  "column",
  "column_sdn",
  "column_thousands",
  "contingency",
  "survival",
  "twoway_empty_yformat",
  "x_date",
  "x_date_row_titles",
  "x_y_rep",
  "x_y_with_strike",
  "pypzfx-column_hugetable",
] as const;
const INFO_FIXTURES = [
  "column",
  "column_sdn",
  "column_thousands",
  "contingency",
  "survival",
  "x_date",
  "x_y_rep",
  "x_y_with_strike",
  "pypzfx-column_hugetable",
] as const;

let failures = 0;
let checks = 0;
function check(name: string, fn: () => void) {
  checks++;
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name} — ${err instanceof Error ? err.message : String(err)}`);
  }
}

const fixtureXml = (name: string) => readFileSync(join(HERE, "testdata", `${name}.pzfx`), "utf8");
const tablesOf = (project: ProjectFilePayload) =>
  project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "table");
const infosOf = (project: ProjectFilePayload) =>
  project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "info");
const infoPairs = (project: ProjectFilePayload) =>
  JSON.stringify(
    infosOf(project).map((n) => [n.name, n.info?.notes ?? "", (n.info?.constants ?? []).map((c) => [c.name, c.value])]),
  );
const xmlOf = (result: { bytes: Uint8Array }) => new TextDecoder().decode(result.bytes);

// ── XSD validation (W6) ────────────────────────────────────────────────

const mechanisms = new Set<string>();
let warnedNoValidator = false;

/** The content model, checked in TS when no XSD validator exists. */
function structuralCheck(xml: string): { ok: boolean; detail: string } {
  const fail = (why: string) => ({ ok: false, detail: why });
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) return fail("missing XML declaration");
  if (!xml.includes('<GraphPadPrismFile PrismXMLVersion="5.00">')) return fail("missing root / PrismXMLVersion");
  const order = ["<Created>", "<InfoSequence>", "<Info ", "<TableSequence>", "<Table ", "<Template"] as const;
  let last = -1;
  for (const tag of order) {
    // A <HugeTable> sits where a <Table> would: take the earlier of the two.
    const at =
      tag === "<Table "
        ? Math.min(
            ...["<Table ", "<HugeTable "].map((t) => {
              const i = xml.indexOf(t);
              return i < 0 ? Number.POSITIVE_INFINITY : i;
            }),
          )
        : xml.indexOf(tag);
    if (at === Number.POSITIVE_INFINITY) continue;
    if (at < last) return fail(`element order: ${tag} out of place`);
    last = at;
  }
  // BUG-21: exactly one <Template>, and it must be the EMPTY element —
  // a non-empty blob Titer cannot generate honestly, and Prism 11.2.0
  // refuses to open a file carrying a minimal/corrupt one.
  const templateEl = '<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>';
  if (!xml.includes(templateEl)) return fail("missing the empty <Template> element (BUG-21)");
  if ((xml.match(/<Template/g) ?? []).length !== 1) return fail("more than one <Template>");
  if (xml.includes('YFormat=""')) return fail('contains YFormat=""');
  if (xml.includes("MostRecentVersion") || xml.includes("Login=")) return fail("contains MostRecentVersion/Login");
  const xFormats = [...xml.matchAll(/ XFormat="([^"]*)"/g)].map((m) => m[1]);
  const yFormats = [...xml.matchAll(/ YFormat="([^"]*)"/g)].map((m) => m[1]);
  const tableTypes = [...xml.matchAll(/ TableType="([^"]*)"/g)].map((m) => m[1]);
  const xOk = ["none", "text", "numbers", "error", "series", "date", "startenddate", "time"];
  const yOk = ["replicates", "SD", "SE", "CV", "SDN", "SEN", "CVN", "low-high", "text", "upper-lower-limits"];
  const tOk = ["Result", "Legacy", "XY", "OneWay", "TwoWay", "Contingency", "Survival", "PartsOfWhole"];
  if (!xFormats.every((f) => xOk.includes(f))) return fail(`bad XFormat: ${xFormats.join(",")}`);
  if (!yFormats.every((f) => yOk.includes(f))) return fail(`bad YFormat: ${yFormats.join(",")}`);
  if (!tableTypes.every((f) => tOk.includes(f))) return fail(`bad TableType: ${tableTypes.join(",")}`);
  const tableIds = [...xml.matchAll(/<(?:Table|HugeTable) ID="(Table\d+)"/g)].map((m) => m[1]);
  const refs = [...xml.matchAll(/<Ref ID="(Table\d+|Info\d+)"( Selected="1")?\/>/g)];
  if (!tableIds.every((id, i) => id === `Table${i}`)) return fail(`Table IDs not sequential: ${tableIds.join(",")}`);
  const tableRefs = refs.filter((r) => r[1].startsWith("Table"));
  if (tableRefs.length !== tableIds.length) return fail("TableSequence refs don't match tables");
  if (tableRefs.length > 0 && tableRefs[0][2] !== ' Selected="1"') return fail("first Table ref not Selected");
  if (tableRefs.slice(1).some((r) => r[2])) return fail("non-first Table ref Selected");
  // Every column's Subcolumns attr equals its real <Subcolumn> count.
  for (const m of xml.matchAll(/<(XColumn|YColumn|RowTitlesColumn|XAdvancedColumn)[^>]*Subcolumns="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
    const subs = (m[3].match(/<Subcolumn>/g) ?? []).length;
    if (subs !== Number(m[2])) return fail(`${m[1]} Subcolumns=${m[2]} but ${subs} subcolumns`);
  }
  return { ok: true, detail: "structural content-model check" };
}

function validateXml(xml: string): { valid: boolean; mechanism: string; detail: string } {
  const res = spawnSync("python3", [VALIDATOR, XSD], { input: xml, encoding: "utf8" });
  if (res.error) {
    if (!warnedNoValidator) {
      warnedNoValidator = true;
      console.log("WARNING: no XSD validator available (python3 missing) — W6 falls back to the TS structural check");
    }
    const s = structuralCheck(xml);
    mechanisms.add("structural-fallback");
    return { valid: s.ok, mechanism: "structural-fallback", detail: s.detail };
  }
  const lines = (res.stdout ?? "").split("\n");
  const mechanism = (lines[0]?.replace("MECHANISM ", "") ?? "none").trim();
  const result = (lines[1]?.replace("RESULT ", "") ?? "").trim();
  mechanisms.add(mechanism);
  if (mechanism === "none") {
    if (!warnedNoValidator) {
      warnedNoValidator = true;
      console.log("WARNING: no XSD validator available (no lxml, no xmllint) — W6 falls back to the TS structural check");
    }
    const s = structuralCheck(xml);
    return { valid: s.ok, mechanism: "structural-fallback", detail: s.detail };
  }
  const detail = lines.slice(2).join("\n").trim().slice(0, 200);
  return { valid: result === "VALID", mechanism, detail: detail || result };
}

// ── W1 — round-trip tables, cell-identical ─────────────────────────────

for (const name of FIXTURES) {
  check(`W1 round-trip tables — ${name}`, () => {
    const source = parsePzfx(fixtureXml(name));
    strictEqual(source.issues.filter((i) => i.severity === "error").length, 0, "source parses clean");
    const written = writePzfx(source.project, APP_VERSION);
    const back = parsePzfx(xmlOf(written));
    strictEqual(back.issues.filter((i) => i.severity === "error").length, 0, "written file parses clean");
    const before = tablesOf(source.project);
    const after = tablesOf(back.project);
    strictEqual(after.length, before.length, `${after.length} tables back, expected ${before.length}`);
    after.forEach((t, i) => {
      strictEqual(t.name, before[i].name, `table ${i} name`);
      strictEqual(t.tableType, before[i].tableType, `table ${i} type`);
      strictEqual(JSON.stringify(t.data), JSON.stringify(before[i].data), `table ${i} data cell-identical`);
    });
    ok(!xmlOf(written).includes('YFormat=""'), "never re-emits YFormat=\"\"");
  });
}

// Synthetic shapes no fixture covers.
const syntheticProject = (
  nodes: Record<string, NonNullable<ProjectFilePayload["nodes"][string]>>,
  rootOrder: string[],
): ProjectFilePayload => ({
  nodes,
  rootOrder,
  childOrder: Object.fromEntries(rootOrder.map((id) => [id, []])),
  activeNodeId: rootOrder[0] ?? null,
});

check("W1 synthetic XY + X error round-trips", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "X error",
        parentId: null,
        tableType: "xy",
        data: {
          columns: ["Title", "X", "X error", "Y_1", "Y_2"],
          rows: [
            ["A", "1", "0.1", "100", "50"],
            ["B", "2", "0.2", "90", "60"],
          ],
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('XFormat="error"'), "XFormat=error");
  ok(xml.includes('Subcolumns="2"'), "XColumn has 2 subcolumns");
  const back = parsePzfx(xml);
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(project.nodes.table_1.data));
});

check("W1 synthetic grouped replicates round-trips", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Grouped",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "A:Y1", "A:Y2", "B:Y1", "B:Y2"],
          rows: [
            ["r1", "1", "2", "3", "4"],
            ["r2", "5", "6", "7", "8"],
          ],
          groups: 2,
          replicates: 2,
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('TableType="TwoWay"'), "TwoWay");
  ok(xml.includes('YFormat="replicates"'), "replicates");
  ok(xml.includes('Replicates="2"'), "Replicates=2");
  const back = parsePzfx(xml);
  strictEqual(tablesOf(back.project)[0].tableType, "grouped", "reads back grouped");
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(project.nodes.table_1.data));
});

check("W1 a >52-subcolumn table writes <HugeTable>, and reads back identical (BUG-8)", () => {
  // The imported pypzfx HugeTable fixture (53 replicates) must round-trip
  // as a HugeTable again: Prism writes the tag past 52 subcolumns, so
  // Titer's own write does the same — a plain <Table> with 53 subcolumns
  // is not how Prism writes such a table.
  const source = parsePzfx(fixtureXml("pypzfx-column_hugetable"));
  const written = writePzfx(source.project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('<HugeTable ID="Table0"'), "writes <HugeTable>");
  ok(!xml.includes('<Table ID="Table0"'), "no plain <Table> for this table");
  ok(xml.includes('Replicates="53"'), "Replicates=53");
  const back = parsePzfx(xml);
  strictEqual(tablesOf(back.project)[0].tableType, "grouped", "reads back grouped");
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(tablesOf(source.project)[0].data));
});

check("W1 duplicate group names round-trip, not merged (BUG-1/BUG-3)", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Dup groups",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "Group:Y1", "Group:Y2", "Group:Y1", "Group:Y2"],
          rows: [["1 ", "1", "2", "3", "4"]],
          groups: 2,
          replicates: 2,
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('TableType="TwoWay"'), "TwoWay");
  ok(xml.includes('Replicates="2"'), "Replicates=2, not merged to 4");
  strictEqual((xml.match(/<YColumn/g) ?? []).length, 2, "one YColumn per run");
  const back = parsePzfx(xml);
  strictEqual(tablesOf(back.project)[0].tableType, "grouped", "reads back grouped");
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(project.nodes.table_1.data));
});

check("W1 synthetic XY summary round-trips", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "XY summary",
        parentId: null,
        tableType: "xy",
        data: {
          columns: ["Title", "X", "T_MEAN", "T_SD"],
          rows: [
            [null, "1", "10", "2"],
            [null, "2", "20", "3"],
          ],
          errorFormat: "sd",
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  ok(xmlOf(written).includes('YFormat="SD"'), "YFormat=SD");
  ok(!xmlOf(written).includes("Replicates="), "no Replicates attr for a summary table");
  const back = parsePzfx(xmlOf(written));
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(project.nodes.table_1.data));
});

check("W1 synthetic date X restored from row titles", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Dates",
        parentId: null,
        tableType: "xy",
        data: {
          columns: ["Title", "X", "Y"],
          rows: [
            ["16-Jan-2004", "0", "120"],
            ["9-Apr-2009", "5.22929500342231", "64"],
          ],
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('XFormat="date"'), "XFormat=date");
  ok(xml.includes("<XAdvancedColumn"), "XAdvancedColumn restored");
  ok(!xml.includes("<RowTitlesColumn"), "row titles become the dates, not a RowTitlesColumn");
  const back = parsePzfx(xml);
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(project.nodes.table_1.data));
});

// ── W2 — info sheets identical ─────────────────────────────────────────

for (const name of INFO_FIXTURES) {
  check(`W2 round-trip info sheet — ${name}`, () => {
    const source = parsePzfx(fixtureXml(name));
    const written = writePzfx(source.project, APP_VERSION);
    const back = parsePzfx(xmlOf(written));
    strictEqual(infosOf(back.project).length, infosOf(source.project).length, "same info sheet count");
    strictEqual(infoPairs(back.project), infoPairs(source.project), "name + notes + constants identical");
    strictEqual(written.report.infoSheets.join(", "), source.infoSheets.join(", "), "report names the sheets");
  });
}

check("W2 fixtures without <Info> write no <Info>", () => {
  for (const name of ["twoway_empty_yformat", "x_date_row_titles"] as const) {
    const source = parsePzfx(fixtureXml(name));
    strictEqual(source.infoSheets.length, 0, `${name}: no info in source`);
    const written = writePzfx(source.project, APP_VERSION);
    ok(!xmlOf(written).includes("<Info"), `${name}: no <Info> written`);
    ok(!xmlOf(written).includes("<InfoSequence"), `${name}: no <InfoSequence> written`);
    strictEqual(written.report.infoSheets.length, 0, `${name}: report lists none`);
  }
});

// BUG-5: Prism writes info-sheet notes (and constant values) as rich-text
// objects `{ string, version, formatting }` in real files (capsanoicids,
// dilution-analysis, senolytics-25hc) — the converter unwraps them, but a
// non-string reaching the writer must never crash the whole export. The
// writer unwraps rich text to its plain string and never emits
// "[object Object]".
check("W2 rich-text object notes / constant values write as plain text", () => {
  const richNotes = { string: "Mean of non-inhibited values & controls", version: 1, formatting: [] };
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Data",
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
      info_1: {
        id: "info_1",
        type: "info",
        name: "Project info",
        parentId: null,
        info: {
          constants: [{ id: "c1", name: "Lot", value: { string: "L-42", version: 1 } as unknown as string }],
          // Deliberately a rich-text object, as the converter used to store
          // it verbatim — the writer must unwrap, not throw.
          notes: richNotes as unknown as string,
          linkedTableId: null,
        },
      },
    },
    ["table_1", "info_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes("<Notes>Mean of non-inhibited values &amp; controls</Notes>"), "notes unwrap to plain text, escaped");
  ok(xml.includes("<Value>L-42</Value>"), "rich-text constant value unwraps");
  ok(!xml.includes("[object Object]"), "no [object Object] anywhere");
  const back = parsePzfx(xml);
  strictEqual(infosOf(back.project)[0]?.info?.notes, "Mean of non-inhibited values & controls", "notes round-trip");
});

// ── W3 — the written file is honestly Titer's ──────────────────────────

check("W3 written file identity (all fixtures)", () => {
  for (const name of FIXTURES) {
    const source = parsePzfx(fixtureXml(name));
    const xml = xmlOf(writePzfx(source.project, APP_VERSION));
    ok(xml.includes('CreatedByProgram="Titer"'), `${name}: CreatedByProgram Titer`);
    ok(xml.includes(`CreatedByVersion="${APP_VERSION}"`), `${name}: CreatedByVersion ${APP_VERSION}`);
    ok(!xml.includes("GraphPad Prism"), `${name}: never claims GraphPad Prism`);
    // BUG-21: exactly one <Template>, and it is the EMPTY element.
    const templateEl = '<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>';
    ok(xml.includes(templateEl), `${name}: empty <Template> element present`);
    strictEqual((xml.match(/<Template/g) ?? []).length, 1, `${name}: exactly one <Template>`);
    ok(!xml.includes("MostRecentVersion"), `${name}: no MostRecentVersion`);
    ok(!xml.includes("Login="), `${name}: no Login`);
    const tableIds = [...xml.matchAll(/<(?:Table|HugeTable) ID="(Table\d+)"/g)].map((m) => m[1]);
    ok(tableIds.length > 0 && tableIds.every((id, i) => id === `Table${i}`), `${name}: fresh sequential ${tableIds.join(",")}`);
    const refs = [...xml.matchAll(/<Ref ID="Table\d+"( Selected="1")?\/>/g)];
    strictEqual(refs.length, tableIds.length, `${name}: one TableSequence ref per table`);
    ok(refs[0][1] === ' Selected="1"', `${name}: first ref Selected`);
    ok(refs.slice(1).every((r) => !r[1]), `${name}: later refs unselected`);
  }
});

check("W3 grouped summary writes TwoWay+SDN (reads back as Column)", () => {
  const project = syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name: "Grouped summary",
        parentId: null,
        tableType: "grouped",
        data: {
          columns: ["Title", "A:Mean", "A:SD", "A:N", "B:Mean", "B:SD", "B:N"],
          rows: [
            ["r1", "10", "2", "5", "20", "3", "5"],
            ["r2", "11", "2", "5", "21", "3", "5"],
          ],
          groups: 2,
          replicates: 3,
          summaryFormat: "mean-sd-n",
        },
      },
    },
    ["table_1"],
  );
  const written = writePzfx(project, APP_VERSION);
  const xml = xmlOf(written);
  ok(xml.includes('YFormat="SDN"'), "YFormat=SDN");
  ok(!xml.includes("Replicates="), "no Replicates attr for a summary table");
  ok(
    written.report.issues.some((i) => i.message.includes("Grouped summary") && i.message.includes("Column")),
    "report warns the table reads back as Column",
  );
});

// ── W4 — minimal file ──────────────────────────────────────────────────

const minimalProject = syntheticProject(
  {
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
  ["table_1"],
);

check("W4 minimal file writes exactly the required elements", () => {
  const written = writePzfx(minimalProject, APP_VERSION);
  const xml = xmlOf(written);
  for (const el of ['<?xml version="1.0" encoding="UTF-8"?>', "<Created>", "<TableSequence", '<Table ID="Table0"', '<Template dt:dt="bin.base64"']) {
    ok(xml.includes(el), `contains ${el}`);
  }
  for (const el of ["<InfoSequence", "<Info ", "<Script", "<RowTitlesColumn", "<XColumn", "<XAdvancedColumn"]) {
    ok(!xml.includes(el), `omits ${el}`);
  }
  strictEqual((xml.match(/<Table /g) ?? []).length, 1, "exactly one Table");
  strictEqual((xml.match(/<YColumn /g) ?? []).length, 1, "exactly one YColumn");
  const back = parsePzfx(xml);
  strictEqual(JSON.stringify(tablesOf(back.project)[0].data), JSON.stringify(minimalProject.nodes.table_1.data));
  ok(formatPzfxWriteReport(written.report).includes("Tables written: 1 — Minimal"), "report formats");
});

check("W4 BUG-21: empty <Template> is the last child, carrying no blob", () => {
  const xml = xmlOf(writePzfx(minimalProject, APP_VERSION));
  const templateEl = '<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>';
  const at = xml.indexOf(templateEl);
  ok(at > 0, "empty <Template> present");
  ok(xml.lastIndexOf("</Table>", at) > 0, "Template comes after the tables");
  strictEqual(xml.slice(at + templateEl.length).trim(), "</GraphPadPrismFile>", "Template is the last child before the close");
  ok(!/<Template[^>]*>[^<]+<\/Template>/.test(xml), "Template carries no blob content");
});

// ── W5 — refusals ──────────────────────────────────────────────────────

const refusalProject = (tableType: TableType, name: string, columns: string[], rows: (string | null)[][]) =>
  syntheticProject(
    {
      table_1: {
        id: "table_1",
        type: "table",
        name,
        parentId: null,
        tableType,
        data: { columns, rows },
      },
    },
    ["table_1"],
  );

check("W5 Nested table refuses the whole write, naming the table", () => {
  throws(
    () => writePzfx(refusalProject("nested", "Nested data", ["Title", "A"], [[null, "1"]]), APP_VERSION),
    (err: unknown) => err instanceof Error && err.message.includes("Nested data") && err.message.includes("Prism has no matching"),
  );
});

check("W5 Multiple variables table refuses the whole write, naming the table", () => {
  throws(
    () => writePzfx(refusalProject("multiple", "Multi var", ["Title", "A"], [[null, "1"]]), APP_VERSION),
    (err: unknown) =>
      err instanceof Error && err.message.includes("Multi var") && err.message.includes("Prism has no matching"),
  );
});

check("W5 project with no tables refuses", () => {
  throws(
    () => writePzfx(syntheticProject({}, []), APP_VERSION),
    (err: unknown) => err instanceof Error && err.message.includes("no data tables"),
  );
});

check("W5 mixed-format table refuses, naming the table", () => {
  throws(
    () =>
      writePzfx(
        refusalProject("column", "Mixed formats", ["Title", "A_MEAN", "A_SD", "A_N", "B_1", "B_2"], [[null, "1", "2", "3", "4", "5"]]),
        APP_VERSION,
      ),
    (err: unknown) => err instanceof Error && err.message.includes("Mixed formats") && err.message.includes("one Y format"),
  );
});

check("W5 grouped table mixing summary and replicate groups refuses", () => {
  throws(
    () =>
      writePzfx(
        syntheticProject(
          {
            table_1: {
              id: "table_1",
              type: "table",
              name: "Grouped mixed",
              parentId: null,
              tableType: "grouped",
              data: {
                columns: ["Title", "A:Mean", "A:SD", "A:N", "B:Y1", "B:Y2"],
                rows: [[null, "1", "2", "3", "4", "5"]],
                groups: 2,
                replicates: 3,
              },
            },
          },
          ["table_1"],
        ),
        APP_VERSION,
      ),
    (err: unknown) => err instanceof Error && err.message.includes("Grouped mixed") && err.message.includes("one Y format"),
  );
});

// ── W6 — schema validation ─────────────────────────────────────────────

for (const name of FIXTURES) {
  check(`W6 XSD validation — ${name}`, () => {
    const source = parsePzfx(fixtureXml(name));
    const xml = xmlOf(writePzfx(source.project, APP_VERSION));
    const res = validateXml(xml);
    ok(res.valid, `${name}: ${res.mechanism} says ${res.detail || "INVALID"}`);
  });
}

check("W6 XSD validation — minimal file", () => {
  const res = validateXml(xmlOf(writePzfx(minimalProject, APP_VERSION)));
  ok(res.valid, `minimal: ${res.mechanism} says ${res.detail || "INVALID"}`);
});

check("W6 negative control — Prism's own twoway_empty_yformat FAILS the XSD", () => {
  // The structural fallback catches this too (it flags YFormat=""), so the
  // control holds on every machine — it proves the check isn't vacuous.
  const res = validateXml(fixtureXml("twoway_empty_yformat"));
  ok(!res.valid, `source twoway_empty_yformat must fail (${res.mechanism}: ${res.detail || "VALID"})`);
});

console.log(`\nXSD validation ran via: ${[...mechanisms].join(", ") || "none"}`);
console.log(`\n${checks - failures}/${checks} checks passed.`);
process.exit(failures ? 1 : 0);
