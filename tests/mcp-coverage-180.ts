/// <reference types="node" />
// MCP coverage gate for Titer 1.8.0 — seq 292 (MCP coverage audit).
//
// Per Smit's Nov 16 rule a feature without MCP support isn't done, so this
// check verifies MCP coverage per 1.8 in-scope item, not just the UI. It is
// data-driven: one row per audit item, each row naming the MCP surface that
// must exist (tool registered / param in the analysis-params schema /
// offering includes it / graph option / export format exposed). Lanes flip
// a row from `gap`/`in-flight` to `covered` when they land the surface;
// the check then guards it against regression.
//
// Row semantics:
// - `covered`: every check must find its surface present. A missing surface
//   is a REGRESSION and fails the gate.
// - `gap` / `in-flight`: every check must find its surface ABSENT (the gap
//   is still real). If a surface shows up, the row is flagged LANDED and
//   the gate fails until the row is flipped to `covered` — so a lane that
//   lands without updating this table cannot slip through silently.
// - `na` / `licence-wall`: no meaningful MCP operation (reason in the note);
//   no checks, never fails the gate.
// - The gate FAILS (exit 1) while any `gap` or `in-flight` row remains,
//   as well as on any regression or stale row. That is the point: 1.8.0
//   ships when this file is all `covered` (+ `na` / `licence-wall`).
//
// Source of the table: ~/workspace/.helix-v18/mcp-coverage-audit-1.8.0.md
// (tip check/v18 @ 584d7ff), RE-VERIFIED against check/v18 @ c3210bc
// (gate-fix lane, Nov 20). Between the two tips 17 rows flipped to
// `covered` as their lanes merged: 155 (import-data-file tool), 157,
// 166 (fitXMin/fitXMax + Inflection-point result row), 170 (new type
// one-sample-ks), 190 (p-value-stack), 191, 192, 193, 194, 195
// (binomial-test), 203 (distribution equations), 204 (tails + targets),
// 205 (arithmetic transforms), 206 (column math), 228 (scripts in
// project file + runOnOpen), 230 (paste-transposed edit op), Mansi-3
// (sigDisplay pvalue-eq). Counts moved with the tip: 73 tools (was 57
// per the old pin, which lagged the registry by two since seq 179
// export-all-graphs — the registry was 62, not 60, after seq 180
// merge-project; 70 since seq 232–239 menus batch B; 71 since seq 240–244
// menus batch C, which adds titer_repoint_analysis; 73 since seq 291
// graph regenerate, 1.8.2, which adds titer_list_regenerable_graphs +
// titer_regenerate_graphs),
// 61 AnalysisType variants / schema keys / runner keys (was 54; 60 since
// seq 177 select-transform; 61 since #46 compare-slopes).
// ONE correction vs the audit stands: row 178 said GAP, but Compact
// Letter Display IS implemented — `compactLetters` in
// src/views/graphs/significance-overlay.ts, `sigDisplay` "letters",
// reachable via build_graph/update_graph — so 178 is COVERED here.
// Two rows were `in-flight` (196, Mansi-4) — both merged now, rows flipped
// to covered. 29 rows are still genuine gaps (see GAP-CONFIRMED lines at run
// time); row 201 was the last landed-but-unflipped row — its checks named
// enum values '6th-order'/'centered' that the B1 lane implemented as
// 'sextic'/'centered-first..sixth'; the checks are corrected to the real enum
// values below (sextic, centered-first, centered-sixth) and the row flips to
// covered with the batch-analyses-a merge.
// the gate stays red for them by design — do NOT flip a row until its
// surface exists on the tip. Sections below are the audit-tip grouping;
// the per-row `status` is the current verdict and is authoritative.
// Mansi (5) "Antigravity drops" is not an audit item and is omitted.
// One product-code fix rides with this file: mcp.rs listed the three
// discovery tools in BOTH read_more and discovery (60 entries, 57
// unique), breaking the exactly-once rule the file's allowlist
// invariant mirrors (and the Rust test
// allowlist_groups_cover_all_tools_once). The trio was dropped from
// read_more, restoring the audited design (discovery only).
//
// The check reads source files as text and asserts on structure (tool
// registry, AnalysisType union, runner keys, schema params, offerings,
// GraphOptions, allowlist groups). It imports nothing from src/ — no R
// engine, no Tauri — so it runs in seconds under `node --import tsx`.
// Run: `node --import tsx tests/mcp-coverage-180.ts` (also in `npm test`).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string): string => readFileSync(join(REPO, rel), "utf8");
const readDirRecursive = (rel: string): string => {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== "node_modules") walk(full);
      } else if (/\.(ts|tsx|rs)$/.test(entry)) {
        out.push(readFileSync(full, "utf8"));
      }
    }
  };
  walk(join(REPO, rel));
  return out.join("\n");
};

// ── Sources (read once) ──────────────────────────────────────────────────
const mcpRs = read("src-tauri/src/mcp.rs");
const statsTypes = read("src/stats/types.ts");
const storeTypes = read("src/store/types.ts");
const analysesIndex = read("src/views/analyses/index.ts");
const graphsIndex = read("src/views/graphs/index.ts");
const schema = JSON.parse(read("src-tauri/src/analysis-params-schema.json")) as Record<
  string,
  { params?: { name: string; enum?: string[] }[] }
>;
const mcpDispatch = read("src/store/mcp-dispatch.ts");
const mcpDocument = read("src/store/mcp-document.ts");
const sigOverlay = read("src/views/graphs/significance-overlay.ts");
const selection = read("src/views/graphs/selection.ts");
const graphView = read("src/views/graphs/graph-view.tsx");
const figureTs = read("src/lib/figure.ts");
const officeExport = read("src/lib/office-export.ts");
const rasterExport = read("src/lib/raster-export.ts");
const coxPh = read("src/stats/survival/cox-ph.ts");
const projectFile = read("src/lib/project-file.ts");
const correlationXy = read("src/stats/xy/correlation.ts");
const statsText = readDirRecursive("src/stats");
const srcText = readDirRecursive("src");
const rustText = readDirRecursive("src-tauri/src");
const graphsText = readDirRecursive("src/views/graphs");
const spikeScope = graphsIndex + "\n" + storeTypes;

// ── Small parsers ────────────────────────────────────────────────────────
const quoted = (text: string): string[] =>
  [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

function unionMembers(source: string, typeName: string): string[] {
  const start = source.indexOf(`export type ${typeName} =`);
  if (start < 0) return [];
  const end = source.indexOf(";", start);
  return quoted(source.slice(start, end < 0 ? undefined : end));
}

/** Keys of a top-level `export const NAME ... = { ... };` record: only
 *  keys at exactly 2-space indent (nested keys sit deeper). */
function recordKeys(source: string, constName: string): string[] {
  const start = source.indexOf(`export const ${constName}`);
  if (start < 0) return [];
  const brace = source.indexOf("{", start);
  const end = source.indexOf("\n};", brace);
  const block = source.slice(brace, end < 0 ? undefined : end);
  const keys: string[] = [];
  for (const m of block.matchAll(/^ {2}(?:"([^"]+)"|([A-Za-z_$][\w$-]*))\s*:/gm)) {
    keys.push(m[1] ?? m[2]);
  }
  return keys;
}

/** Per-table offered values from a `..._OPTIONS_BY_TABLE` record: the
 *  quoted strings inside each table's optionsFor([...]) arrays, plus any
 *  extra `{ value: "..." }` entries (e.g. McNemar on contingency). */
function optionsByTable(source: string, constName: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const start = source.indexOf(`export const ${constName}`);
  if (start < 0) return out;
  const brace = source.indexOf("{", start);
  const end = source.indexOf("\n};", brace);
  const block = source.slice(brace, end < 0 ? undefined : end);
  const heads = [...block.matchAll(/^ {2}(\w+):/gm)];
  for (let i = 0; i < heads.length; i++) {
    const table = heads[i][1];
    const slice = block.slice(heads[i].index, i + 1 < heads.length ? heads[i + 1].index : undefined);
    const values: string[] = [];
    for (const arr of slice.matchAll(/optionsFor\(\[([\s\S]*?)\]\)/g)) {
      values.push(...quoted(arr[1]));
    }
    for (const v of slice.matchAll(/value:\s*"([^"]+)"/g)) values.push(v[1]);
    out.set(table, values);
  }
  return out;
}

/** Field names of `export interface NAME { ... }` (interface closes with
 *  `}` at column 0). */
function interfaceFields(source: string, name: string): Set<string> {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) return new Set();
  const end = source.indexOf("\n}\n", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  return new Set([...block.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]));
}

/** A Rust `pub struct NAME { ... }` block (struct closes with `}` at
 *  column 0). */
function rustStruct(source: string, name: string): string {
  const start = source.indexOf(`pub struct ${name} {`);
  if (start < 0) return "";
  const end = source.indexOf("\n}", start);
  return source.slice(start, end < 0 ? undefined : end);
}

/** Values of a `NAME: ["a", "b"]` choice array in store/types.ts. */
function choiceValues(choice: string): string[] {
  const m = storeTypes.match(new RegExp(`${choice}:\\s*\\[([^\\]]*)\\]`));
  return m ? quoted(m[1]) : [];
}

const toolNames = new Set(
  [...mcpRs.matchAll(/name\s*=\s*"(titer_[a-z0-9_]+)"/g)].map((m) => m[1]),
);
const toolNameMatches = [...mcpRs.matchAll(/name\s*=\s*"(titer_[a-z0-9_]+)"/g)].map(
  (m) => m[1],
);
const allowlist = new Map<string, string[]>();
for (const g of mcpRs.matchAll(/id:\s*"([a-z_]+)",[\s\S]*?tools:\s*&\[([\s\S]*?)\]/g)) {
  allowlist.set(g[1], quoted(g[2]));
}
const defaultGroups = quoted(
  (mcpRs.match(/const ALLOWLIST_DEFAULT_GROUPS: &\[&str\] = &\[([^\]]*)\]/) ?? ["", ""])[1],
);
const exportFormats = quoted(
  (mcpRs.match(/const EXPORT_FORMATS: &\[&str\] = &\[([^\]]*)\]/) ?? ["", ""])[1],
);
const exportDpis = quoted(
  (mcpRs.match(/const EXPORT_DPIS: &\[&str\] = &\[([^\]]*)\]/) ?? ["", ""])[1],
);
const analysisTypes = unionMembers(statsTypes, "AnalysisType");
const tableTypes = unionMembers(storeTypes, "TableType");
const graphTypes = unionMembers(storeTypes, "GraphType");
const runnerKeys = recordKeys(
  read("src/stats/index.ts"),
  "ANALYSES: Record<AnalysisType, Analysis>",
);
const analysisOfferings = optionsByTable(analysesIndex, "ANALYSIS_OPTIONS_BY_TABLE");
const graphOfferings = optionsByTable(graphsIndex, "GRAPH_OPTIONS_BY_TABLE");
const graphOptionFields = interfaceFields(storeTypes, "GraphOptions");
const editOps = (() => {
  const m = mcpDispatch.match(/the ops are ([^.]*)\./);
  return m ? m[1].split(", ") : [];
})();
const schemaKeys = Object.keys(schema);
const schemaParams = (type: string): string[] =>
  (schema[type]?.params ?? []).map((p) => p.name);
const schemaParamEnum = (type: string, param: string): string[] =>
  (schema[type]?.params ?? []).find((p) => p.name === param)?.enum ?? [];
const scopeText = (scope: string): string => {
  switch (scope) {
    case "stats":
      return statsText;
    case "src":
      return srcText;
    case "rust":
      return rustText;
    case "graphs":
      return graphsText;
    case "spike":
      return spikeScope;
    case "mcpDispatch":
      return mcpDispatch;
    case "mcpRs":
      return mcpRs;
    case "storeTypes":
      return storeTypes;
    case "officeExport":
      return officeExport;
    default:
      return read(scope);
  }
};

const EXPECTED_TOOL_COUNT = 73;
const EXPECTED_ANALYSIS_TYPES = 61;
const META_OFFERINGS = new Set(["compare-many-groups", "interpolate", "transform"]);

// ── Global invariants (run first; any failure is a regression) ──────────
function setDiff(a: string[], b: string[]): { onlyA: string[]; onlyB: string[] } {
  const sa = new Set(a);
  const sb = new Set(b);
  return {
    onlyA: a.filter((x) => !sb.has(x)),
    onlyB: b.filter((x) => !sa.has(x)),
  };
}

const invariants = new Map<string, { ok: boolean; detail: string }>();
{
  const dupes = toolNameMatches.length !== toolNames.size;
  invariants.set("registry", {
    ok: toolNames.size === EXPECTED_TOOL_COUNT && !dupes,
    detail: `${toolNames.size} titer_* tools registered (expected ${EXPECTED_TOOL_COUNT})${dupes ? "; DUPLICATE tool names" : ""}`,
  });
  const d1 = setDiff(schemaKeys, analysisTypes);
  const d2 = setDiff(analysisTypes, runnerKeys);
  invariants.set("schema-types-runner", {
    ok:
      analysisTypes.length === EXPECTED_ANALYSIS_TYPES &&
      d1.onlyA.length === 0 &&
      d1.onlyB.length === 0 &&
      d2.onlyA.length === 0 &&
      d2.onlyB.length === 0,
    detail:
      `schema ${schemaKeys.length} keys, AnalysisType ${analysisTypes.length} variants, ANALYSES runner ${runnerKeys.length} keys` +
      (d1.onlyA.length || d1.onlyB.length
        ? `; schema↔types diff: only-schema=[${d1.onlyA}] only-types=[${d1.onlyB}]`
        : "") +
      (d2.onlyA.length || d2.onlyB.length
        ? `; types↔runner diff: only-types=[${d2.onlyA}] only-runner=[${d2.onlyB}]`
        : ""),
  });
  const grouped = [...allowlist.values()].flat();
  const groupedSet = new Set(grouped);
  invariants.set("allowlist", {
    ok:
      allowlist.size === 10 &&
      grouped.length === toolNames.size &&
      groupedSet.size === grouped.length &&
      [...toolNames].every((t) => groupedSet.has(t)) &&
      defaultGroups.length === 1 &&
      defaultGroups[0] === "read",
    detail: `${allowlist.size} allowlist groups covering ${grouped.length} tools (${groupedSet.size} unique), default=[${defaultGroups}]`,
  });
  invariants.set("dispatch-gate", {
    ok:
      mcpDispatch.includes("analysisTypesOfferedForTable") &&
      mcpDispatch.includes("Object.hasOwn(ANALYSES, analysisType)"),
    detail: "create-analysis validates the type against ANALYSES and gates on analysisTypesOfferedForTable (same gate as the UI picker)",
  });
  const badOfferings: string[] = [];
  for (const [table, values] of analysisOfferings) {
    for (const v of values) {
      if (!META_OFFERINGS.has(v) && !analysisTypes.includes(v)) {
        badOfferings.push(`${table}:${v}`);
      }
    }
  }
  invariants.set("offerings-resolve", {
    ok: badOfferings.length === 0,
    detail: badOfferings.length ? `offered but not an AnalysisType: ${badOfferings.join(", ")}` : "every offered concrete analysis is an AnalysisType",
  });
  const badGraphs: string[] = [];
  for (const [table, values] of graphOfferings) {
    for (const v of values) {
      if (!graphTypes.includes(v)) badGraphs.push(`${table}:${v}`);
    }
  }
  invariants.set("graph-offerings-resolve", {
    ok: badGraphs.length === 0,
    detail: badGraphs.length ? `offered but not a GraphType: ${badGraphs.join(", ")}` : "every offered graph kind is a GraphType",
  });
}

// ── Per-item surface specs ───────────────────────────────────────────────
// Every spec answers one question: "does this MCP surface exist?" —
// `true` means present. The runner expects `true` for `covered` rows and
// `false` for `gap` / `in-flight` rows.
type Spec =
  | { kind: "tool"; tool: string }
  | { kind: "tools"; tools: string[] }
  | { kind: "toolGroup"; group: string; tool: string }
  | { kind: "toolNameMatches"; re: string }
  | { kind: "analysis"; type: string }
  | { kind: "analysisTypeMatches"; re: string }
  | { kind: "analysisParam"; type: string; param: string }
  | { kind: "analysisParamEnum"; type: string; param: string; value: string }
  | { kind: "analysisParamEnumExtra"; type: string; param: string; known: string[] }
  | { kind: "hasExtraParam"; type: string; known: string[] }
  | { kind: "analysisOffering"; table: string; type: string }
  | { kind: "graphKindOffering"; table: string; graphKind: string }
  | { kind: "graphOption"; field: string }
  | { kind: "graphChoice"; choice: string; value: string }
  | { kind: "graphChoiceExtra"; choice: string; known: string[] }
  | { kind: "tableType"; type: string }
  | { kind: "structContains"; struct: string; text: string }
  | { kind: "sourceContains"; file: string; text: string }
  | { kind: "sourceContainsRe"; scope: string; re: string }
  | { kind: "editOpsContains"; op: string }
  | { kind: "exportFormat"; format: string }
  | { kind: "exportDpi"; dpi: string }
  | { kind: "fileExists"; path: string }
  | { kind: "tripwire"; file: string; text: string }
  | { kind: "saveResultHasReport" }
  | { kind: "invariant"; name: string };

const fileText = (rel: string): string => {
  switch (rel) {
    case "mcp.rs":
      return mcpRs;
    case "statsTypes":
      return statsTypes;
    case "storeTypes":
      return storeTypes;
    case "mcpDispatch":
      return mcpDispatch;
    case "mcpDocument":
      return mcpDocument;
    case "sigOverlay":
      return sigOverlay;
    case "selection":
      return selection;
    case "graphView":
      return graphView;
    case "figure":
      return figureTs;
    case "officeExport":
      return officeExport;
    case "rasterExport":
      return rasterExport;
    case "coxPh":
      return coxPh;
    case "projectFile":
      return projectFile;
    case "correlationXy":
      return correlationXy;
    default:
      return read(rel);
  }
};

function surfacePresent(spec: Spec): boolean {
  switch (spec.kind) {
    case "tool":
      return toolNames.has(spec.tool);
    case "tools":
      return spec.tools.every((t) => toolNames.has(t));
    case "toolGroup":
      return (allowlist.get(spec.group) ?? []).includes(spec.tool);
    case "toolNameMatches":
      return toolNameMatches.some((t) => new RegExp(spec.re).test(t));
    case "analysis":
      return (
        analysisTypes.includes(spec.type) &&
        runnerKeys.includes(spec.type) &&
        schemaKeys.includes(spec.type)
      );
    case "analysisTypeMatches":
      return analysisTypes.some((t) => new RegExp(spec.re).test(t));
    case "analysisParam":
      return schemaParams(spec.type).includes(spec.param);
    case "analysisParamEnum":
      return schemaParamEnum(spec.type, spec.param).includes(spec.value);
    case "analysisParamEnumExtra": {
      const values = schemaParamEnum(spec.type, spec.param);
      return values.some((v) => !spec.known.includes(v));
    }
    case "hasExtraParam": {
      const params = schemaParams(spec.type);
      return params.some((p) => !spec.known.includes(p));
    }
    case "analysisOffering":
      return (analysisOfferings.get(spec.table) ?? []).includes(spec.type);
    case "graphKindOffering":
      return (graphOfferings.get(spec.table) ?? []).includes(spec.graphKind);
    case "graphOption":
      return graphOptionFields.has(spec.field);
    case "graphChoice":
      return choiceValues(spec.choice).includes(spec.value);
    case "graphChoiceExtra": {
      const values = choiceValues(spec.choice);
      return values.some((v) => !spec.known.includes(v));
    }
    case "tableType":
      return tableTypes.includes(spec.type);
    case "structContains":
      return rustStruct(mcpRs, spec.struct).includes(spec.text);
    case "sourceContains":
      return fileText(spec.file).includes(spec.text);
    case "sourceContainsRe":
      return new RegExp(spec.re, "i").test(scopeText(spec.scope));
    case "editOpsContains":
      return editOps.some((op) => op.includes(spec.op));
    case "exportFormat":
      return exportFormats.includes(spec.format);
    case "exportDpi":
      return exportDpis.includes(spec.dpi);
    case "fileExists":
      return existsSync(join(REPO, spec.path));
    case "tripwire":
      // The named text is a blocking error / stub whose REMOVAL means the
      // feature landed: present = the blocker is gone.
      return !fileText(spec.file).includes(spec.text);
    case "saveResultHasReport": {
      const start = mcpDocument.indexOf("export async function executeSaveProject");
      const end = mcpDocument.indexOf("\n}\n", start);
      const fn = mcpDocument.slice(start, end < 0 ? undefined : end);
      return /report/i.test(fn);
    }
    case "invariant":
      return invariants.get(spec.name)?.ok ?? false;
  }
}

const specLabel = (spec: Spec): string => {
  switch (spec.kind) {
    case "tool":
      return `tool ${spec.tool}`;
    case "tools":
      return `tools ${spec.tools.join(", ")}`;
    case "toolGroup":
      return `${spec.tool} in allowlist group ${spec.group}`;
    case "toolNameMatches":
      return `tool name matching /${spec.re}/`;
    case "analysis":
      return `analysis ${spec.type} (type + runner + schema)`;
    case "analysisTypeMatches":
      return `AnalysisType matching /${spec.re}/`;
    case "analysisParam":
      return `param ${spec.type}.${spec.param}`;
    case "analysisParamEnum":
      return `param ${spec.type}.${spec.param} enum has ${spec.value}`;
    case "analysisParamEnumExtra":
      return `param ${spec.type}.${spec.param} enum has a value outside [${spec.known.join(", ")}]`;
    case "hasExtraParam":
      return `${spec.type} has a param outside [${spec.known.join(", ")}]`;
    case "analysisOffering":
      return `${spec.type} offered on ${spec.table}`;
    case "graphKindOffering":
      return `graph ${spec.graphKind} offered on ${spec.table}`;
    case "graphOption":
      return `GraphOptions.${spec.field}`;
    case "graphChoice":
      return `${spec.choice} choice has ${spec.value}`;
    case "graphChoiceExtra":
      return `${spec.choice} choice has a value outside [${spec.known.join(", ")}]`;
    case "tableType":
      return `TableType ${spec.type}`;
    case "structContains":
      return `${spec.struct} contains ${JSON.stringify(spec.text)}`;
    case "sourceContains":
      return `${spec.file} contains ${JSON.stringify(spec.text)}`;
    case "sourceContainsRe":
      return `/${spec.re}/ in ${spec.scope}`;
    case "editOpsContains":
      return `edit-table op ${spec.op}`;
    case "exportFormat":
      return `export format ${spec.format}`;
    case "exportDpi":
      return `export dpi ${spec.dpi}`;
    case "fileExists":
      return `file ${spec.path} exists`;
    case "tripwire":
      return `blocker gone from ${spec.file}: ${JSON.stringify(spec.text)}`;
    case "saveResultHasReport":
      return `titer_save_project result carries a write report`;
    case "invariant":
      return `invariant ${spec.name}`;
  }
};

// ── The table ────────────────────────────────────────────────────────────
// Statuses verified against this tip (check/v18 @ c3210bc) by reading the
// cited code, not by trusting the audit prose. `branch` names an origin
// branch where the surface already exists (both remaining ones verified
// on origin: fix/18-196-fraction-total, fix/18-m5-multisig).
type Status = "covered" | "gap" | "in-flight" | "na" | "licence-wall";
interface Row {
  item: string;
  title: string;
  status: Status;
  branch?: string;
  note: string;
  checks: Spec[];
}

const ROWS: Row[] = [
  // ── Covered on tip ──
  {
    item: "156",
    title: "Calculated Variables",
    status: "covered",
    note: "titer_edit_table add/set/remove-calculated-variable ops (MV tables).",
    checks: [
      { kind: "tool", tool: "titer_edit_table" },
      { kind: "sourceContains", file: "mcpDispatch", text: "add-calculated-variable" },
      { kind: "sourceContains", file: "mcpDispatch", text: "set-calculated-variable" },
      { kind: "sourceContains", file: "mcpDispatch", text: "remove-calculated-variable" },
    ],
  },
  {
    item: "372",
    title: "Calculated variables: conditional aggregation (part A)",
    status: "covered",
    note:
      "The *IF family (MINIF/MAXIF/SUMIF/MEANIF/STDEVIF/STDERRIF/COUNTIF/COUNTAIF) + the WHERE-clause form, " +
      "through the existing titer_edit_table add/set-calculated-variable ops. Part B (window functions: OVER / " +
      "ORDER BY / ROWS) is NOT covered by this row — separate follow-up.",
    checks: [
      { kind: "tool", tool: "titer_edit_table" },
      { kind: "sourceContains", file: "src/lib/calcvars.ts", text: "CONDITIONAL_AGGREGATES" },
      { kind: "sourceContains", file: "src/lib/calcvars.ts", text: "kind: \"condagg\"" },
      { kind: "sourceContains", file: "src/lib/calcvars.ts", text: "conditionalAggregate" },
    ],
  },
  {
    item: "158",
    title: "Classic analyses from Multiple Variables tables",
    status: "covered",
    note: "MV offering includes compare-two-groups, nonlinear-regression, survival.",
    checks: [
      { kind: "analysisOffering", table: "multiple", type: "compare-two-groups" },
      { kind: "analysisOffering", table: "multiple", type: "nonlinear-regression" },
      { kind: "analysisOffering", table: "multiple", type: "survival" },
    ],
  },
  {
    item: "160",
    title: "Hierarchical clustering",
    status: "covered",
    note: "Type + runner + schema + offered on Multiple Variables.",
    checks: [
      { kind: "analysis", type: "hierarchical-clustering" },
      { kind: "analysisOffering", table: "multiple", type: "hierarchical-clustering" },
    ],
  },
  {
    item: "162",
    title: ".prism writer on nested/multiple",
    status: "covered",
    note: "titer_save_project format=prism. Writer fidelity is a separate lane (fix/18-162-prism-nested); the MCP path exists.",
    checks: [
      { kind: "tool", tool: "titer_save_project" },
      { kind: "sourceContains", file: "mcp.rs", text: '"hlx" | "prism" | "pzfx"' },
    ],
  },
  {
    item: "163",
    title: ".pzfx writer on nested/multiple",
    status: "covered",
    note: "Same tool, format=pzfx.",
    checks: [
      { kind: "tool", tool: "titer_save_project" },
      { kind: "sourceContains", file: "mcp.rs", text: '"hlx" | "prism" | "pzfx"' },
    ],
  },
  {
    item: "178",
    title: "Compact Letter Display",
    status: "covered",
    note:
      "CORRECTED vs the audit (which said GAP): compactLetters is implemented " +
      "(significance-overlay.ts), sigDisplay 'letters' is a valid choice, and " +
      "build_graph/update_graph take partial GraphOptions.",
    checks: [
      { kind: "sourceContains", file: "sigOverlay", text: "export function compactLetters" },
      { kind: "sourceContains", file: "sigOverlay", text: 'options.sigDisplay === "letters"' },
      { kind: "graphChoice", choice: "sigDisplay", value: "letters" },
      { kind: "tool", tool: "titer_build_graph" },
      { kind: "tool", tool: "titer_update_graph" },
    ],
  },
  {
    item: "179",
    title: "Export All Graphs/Layouts",
    status: "covered",
    note: "Merged on check/v18: titer_export_all_graphs batch tool (every graph + figure, one file each, per-item failure reporting) + File-menu Export All dialog on the same plan/render path.",
    checks: [
      {
        kind: "tools",
        tools: ["titer_list_projects", "titer_export_graph", "titer_export_figure", "titer_export_table_data", "titer_export_all_graphs"],
      },
    ],
  },
  {
    item: "199",
    title: "Correlation 95% CI",
    status: "covered",
    note: "rci computes the CI; result rows returned via run_analysis + read_results.",
    checks: [
      { kind: "sourceContains", file: "correlationXy", text: '"95% CI lower"' },
      { kind: "sourceContains", file: "correlationXy", text: '"95% CI upper"' },
    ],
  },
  {
    item: "215",
    title: "Survival censored ticks + CI bands",
    status: "covered",
    note: "GraphOptions carry the three survival display flags.",
    checks: [
      { kind: "graphOption", field: "survivalShowCensors" },
      { kind: "graphOption", field: "survivalShowBand" },
      { kind: "graphOption", field: "survivalShowAtRisk" },
    ],
  },
  {
    item: "221",
    title: "XY point labels from row titles",
    status: "covered",
    note: "pointLabels renders titles[row]; called from the graph view, so any graph built via MCP renders them.",
    checks: [
      { kind: "sourceContains", file: "selection", text: "export function pointLabels" },
      { kind: "sourceContains", file: "selection", text: "titles[row]" },
      { kind: "sourceContains", file: "graphView", text: "pointLabels(" },
    ],
  },
  {
    item: "229",
    title: "Gallery view",
    status: "covered",
    note: "titer_list_projects returns the project list the gallery shows.",
    checks: [{ kind: "tool", tool: "titer_list_projects" }],
  },
  {
    item: "232",
    title: "New Data Table and Graph",
    status: "covered",
    note: "titer_create_table + titer_build_graph.",
    checks: [{ kind: "tools", tools: ["titer_create_table", "titer_build_graph"] }],
  },
  {
    item: "233",
    title: "Save Family As",
    status: "covered",
    note: "titer_save_project with path (Save As).",
    checks: [
      { kind: "tool", tool: "titer_save_project" },
      { kind: "sourceContains", file: "mcp.rs", text: "Save As path" },
    ],
  },
  {
    item: "234",
    title: "Save a Copy",
    status: "covered",
    note: "titer_save_project with path (a copy = save-as to a new path).",
    checks: [
      { kind: "tool", tool: "titer_save_project" },
      { kind: "sourceContains", file: "mcp.rs", text: "Save As path" },
    ],
  },
  {
    item: "235",
    title: "Close All (Mac)",
    status: "covered",
    note: "No single close-all tool; list + close per project composes it.",
    checks: [{ kind: "tools", tools: ["titer_list_projects", "titer_close_project"] }],
  },
  {
    item: "243",
    title: "Re-run simulation from graph",
    status: "covered",
    note: "Monte Carlo is an analysis type (rerun_analysis); data simulation is simulate_data.",
    checks: [{ kind: "tools", tools: ["titer_rerun_analysis", "titer_simulate_data"] }],
  },
  {
    item: "#45",
    title: "QQ plot + residual plots",
    status: "covered",
    note: "qq-plot offered on Column + Multiple; residuals on XY.",
    checks: [
      { kind: "graphKindOffering", table: "column", graphKind: "qq-plot" },
      { kind: "graphKindOffering", table: "multiple", graphKind: "qq-plot" },
      { kind: "graphKindOffering", table: "xy", graphKind: "residuals" },
    ],
  },
  {
    item: "1.7.4 allowlist",
    title: "1.7.4 allowlist groups",
    status: "covered",
    note: "10 groups covering all 70 tools exactly once; default = read group only.",
    checks: [{ kind: "invariant", name: "allowlist" }],
  },
  {
    item: "1.7.4 P0 tools",
    title: "1.7.4 P0 tools (get_analysis_params, search, rerun_analysis, project_summary)",
    status: "covered",
    note: "All 4 registered; the 3 discovery tools sit in the discovery group (rerun_analysis lives in analyses); await_result on run/rerun_analysis.",
    checks: [
      {
        kind: "tools",
        tools: ["titer_get_analysis_params", "titer_search", "titer_rerun_analysis", "titer_project_summary"],
      },
      { kind: "toolGroup", group: "discovery", tool: "titer_get_analysis_params" },
      { kind: "toolGroup", group: "discovery", tool: "titer_search" },
      { kind: "toolGroup", group: "discovery", tool: "titer_project_summary" },
      { kind: "sourceContains", file: "mcp.rs", text: "await_result" },
      { kind: "sourceContains", file: "mcp.rs", text: "await_seconds" },
    ],
  },
  {
    item: "1.7.x Save + autosave",
    title: "1.7.x Save + autosave",
    status: "covered",
    note: "titer_save_project (format/path); autosave is automatic — no MCP op needed.",
    checks: [
      { kind: "tool", tool: "titer_save_project" },
      { kind: "fileExists", path: "src/lib/autosave.ts" },
    ],
  },
  {
    item: "1.7.x titer_send_feedback",
    title: "1.7.x titer_send_feedback",
    status: "covered",
    note: "Registered tool, read_more group; server half posts to the feedback endpoint.",
    checks: [
      { kind: "tool", tool: "titer_send_feedback" },
      { kind: "toolGroup", group: "read_more", tool: "titer_send_feedback" },
    ],
  },
  {
    item: "Mansi-1",
    title: "Match preview (m6)",
    status: "covered",
    note: "Match = copy formatting between graphs; read_graph + update_graph compose it. The live preview is visual UI.",
    checks: [{ kind: "tools", tools: ["titer_read_graph", "titer_update_graph"] }],
  },
  {
    item: "Mansi-2",
    title: "Grouped-bars points (m3)",
    status: "covered",
    note: "showPoints option exists in GraphOptions; the m3 lane fixes the drawing (renderer-side).",
    checks: [{ kind: "graphOption", field: "showPoints" }],
  },
  {
    item: "Mansi-7",
    title: ".prism writer crash (289)",
    status: "covered",
    note: "Covered via save_project (tip path); fix in flight on fix/18-289-prism-ranges.",
    checks: [{ kind: "tool", tool: "titer_save_project" }],
  },

  // ── Covered in flight (surface on the named branch, not on this tip) ──
  {
    item: "157",
    title: "Multifactor ANOVA",
    status: "covered",
    note: "Merged on check/v18. Type + runner + schema + MV offering; the runner also returns partial eta squared per term (guards seq 161's landed half).",
    checks: [
      { kind: "analysis", type: "multifactor-anova" },
      { kind: "analysisOffering", table: "multiple", type: "multifactor-anova" },
      { kind: "sourceContainsRe", scope: "stats", re: "partial eta squared" },
    ],
  },
  {
    item: "190",
    title: "Stack of P values",
    status: "covered",
    note: "Merged on check/v18 as analysis type p-value-stack, offered on Column.",
    checks: [
      { kind: "analysis", type: "p-value-stack" },
      { kind: "analysisOffering", table: "column", type: "p-value-stack" },
    ],
  },
  {
    item: "191",
    title: "One-way ANOVA completion",
    status: "covered",
    note: "Merged on check/v18: posthoc enum has fdr, plus trend and lognormal params.",
    checks: [
      { kind: "analysisParamEnum", type: "anova", param: "posthoc", value: "fdr" },
      { kind: "analysisParam", type: "anova", param: "trend" },
      { kind: "analysisParam", type: "anova", param: "lognormal" },
    ],
  },
  {
    item: "192",
    title: "Two/three-way post-hoc",
    status: "covered",
    note: "Merged on check/v18: fdrMethod/fdrQ (two-way) and posthocScope/fdrMethod/fdrQ (three-way).",
    checks: [
      { kind: "analysisParamEnum", type: "two-way-anova", param: "posthoc", value: "fdr" },
      { kind: "analysisParam", type: "two-way-anova", param: "fdrMethod" },
      { kind: "analysisParam", type: "two-way-anova", param: "fdrQ" },
      { kind: "analysisParam", type: "three-way-anova", param: "posthocScope" },
      { kind: "analysisParam", type: "three-way-anova", param: "fdrMethod" },
      { kind: "analysisParam", type: "three-way-anova", param: "fdrQ" },
    ],
  },
  {
    item: "193",
    title: "Multiple-t-tests corrections",
    status: "covered",
    note: "Merged on check/v18: correction enum has all 8 values.",
    checks: [
      { kind: "analysisParamEnum", type: "multiple-t-tests", param: "correction", value: "holm-sidak" },
      { kind: "analysisParamEnum", type: "multiple-t-tests", param: "correction", value: "sidak" },
      { kind: "analysisParamEnum", type: "multiple-t-tests", param: "correction", value: "bonferroni" },
      { kind: "analysisParamEnum", type: "multiple-t-tests", param: "correction", value: "fdr-bky" },
      { kind: "analysisParamEnum", type: "multiple-t-tests", param: "correction", value: "fdr-by" },
    ],
  },
  {
    item: "194",
    title: "Row statistics",
    status: "covered",
    note: "Merged on check/v18: rowScope param present.",
    checks: [{ kind: "analysisParam", type: "row-means-totals", param: "rowScope" }],
  },
  {
    item: "195",
    title: "Chi-square + binomial",
    status: "covered",
    note: "Merged on check/v18 as analysis type binomial-test (offered on Column); chi-square-gof was already on tip. ('binomial' elsewhere in types.ts is only a simulate-data distribution.)",
    checks: [
      { kind: "analysis", type: "binomial-test" },
      { kind: "analysis", type: "chi-square-gof" },
      { kind: "analysisOffering", table: "column", type: "binomial-test" },
    ],
  },
  {
    item: "196",
    title: "Fraction-of-total",
    status: "covered",
    note: "Merged on check/v18: 'ci' param on fraction-of-total + Contingency offering; Parts-of-Whole offering landed with 197 (native table type).",
    checks: [{ kind: "analysisParam", type: "fraction-of-total", param: "ci" }],
  },
  {
    item: "Mansi-3",
    title: "Sig brackets + 'p=' prefix (m4)",
    status: "covered",
    note: "Merged on check/v18: sigDisplay 'pvalue-eq' is a valid choice (brackets were covered on tip).",
    checks: [{ kind: "graphChoice", choice: "sigDisplay", value: "pvalue-eq" }],
  },
  {
    item: "Mansi-4",
    title: "Grouped-scatter multi-sigAnalysisId (m5)",
    status: "covered",
    note: "Merged on check/v18: sigAnalysisIds?: string[] on GraphOptions; multi-source brackets + letters from the first analysis.",
    checks: [{ kind: "sourceContains", file: "storeTypes", text: "sigAnalysisIds" }],
  },

  // ── Gaps (no lane, or lane not yet merged) ──
  {
    item: "155",
    title: "CSV/XLSX/TXT file import",
    status: "covered",
    note: "Merged on check/v18: titer_import_data_file (CSV/TSV/TXT/XLSX) in the project allowlist group.",
    checks: [
      { kind: "tool", tool: "titer_import_data_file" },
      { kind: "toolGroup", group: "project", tool: "titer_import_data_file" },
    ],
  },
  {
    item: "226",
    title: "Automatic backup",
    status: "covered",
    note: "Merged with the 226 lane: titer_list_backups (read-only list of automatic backups) in the read allowlist group.",
    checks: [
      { kind: "tool", tool: "titer_list_backups" },
      { kind: "toolGroup", group: "read", tool: "titer_list_backups" },
    ],
  },
  {
    item: "161",
    title: "Effect sizes",
    status: "covered",
    note: "Merged on check/v18: effectSizes param (default true) on the ANOVA/t-test/correlation families, EffectSizeRow (eta², partial eta² + 95% CI, Cohen's f), Glass's Δ + Cohen's d / Hedges' g with 95% CIs in the t-test results.",
    checks: [
      { kind: "sourceContainsRe", scope: "stats", re: "Glass" },
      { kind: "sourceContainsRe", scope: "stats", re: "Cohen's d and Hedges' g with their 95% CIs" },
    ],
  },
  {
    item: "164",
    title: "UI table-data export",
    status: "covered",
    note: "Merged on check/v18: File-menu table-data export (CSV/XLSX/TXT/Prism XML) through the same serializers as titer_export_table_data; the MCP struct carries the xml format.",
    checks: [{ kind: "structContains", struct: "ExportTableDataArgs", text: "xml" }],
  },
  {
    item: "165",
    title: "Freeze/Unfreeze tables",
    status: "covered",
    note: "Merged on check/v18: frozen flag on table/analysis nodes (persisted in the project file, dropped from non-table/non-analysis sheets), titer_freeze_table + titer_freeze_analysis tools, menu/grid edit gating. (Freeze-title ROW is different — exposed via titer_edit_table freeze-title op.)",
    checks: [{ kind: "tools", tools: ["titer_freeze_table"] }],
  },
  {
    item: "166",
    title: "Nonlinear-regression additions",
    status: "covered",
    note: "Merged on check/v18: fitXMin/fitXMax restrict the fit X-range, and logistic-growth runs report an 'Inflection point' result row (with 95% CI). The inflection point is a result, not a schema param — the old probe (param 'inflection') was the wrong shape.",
    checks: [
      { kind: "analysisParam", type: "nonlinear-regression", param: "fitXMin" },
      { kind: "analysisParam", type: "nonlinear-regression", param: "fitXMax" },
      { kind: "sourceContains", file: "src/stats/xy/nonlinear-fit.ts", text: "Inflection point" },
    ],
  },
  {
    item: "167",
    title: "Template gallery / Welcome dialog",
    status: "covered",
    note: "Merged on check/v18: built-in templates (blank + example projects) via the template? arg on titer_create_project and the Welcome dialog on first launch.",
    checks: [{ kind: "structContains", struct: "CreateProjectArgs", text: "template" }],
  },
  {
    item: "168",
    title: "Linked paste",
    status: "covered",
    note: "Merged on check/v18: paste-link / remove-link edit ops + titer_refresh_linked_data, linked bar + grid-menu + Edit-menu actions, .hlx round-trip with repair, auto-refresh on open.",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "linked-?paste" }],
  },
  {
    item: "169",
    title: "Generate X values as a series",
    status: "covered",
    note: "Merged on check/v18: Create Series dialog + grid-menu action + generate-series edit_table op (arithmetic/geometric, 10,000 cap) and Generate X Values as a Series on XY tables.",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "generateX|xAsSeries" }],
  },
  {
    item: "170",
    title: "One-sample KS test",
    status: "covered",
    note: "Merged on check/v18 as a new analysis type one-sample-ks (offered on Column) — not a param on kolmogorov-smirnov, which stays two-sample only; the old probe was the wrong shape.",
    checks: [
      { kind: "analysis", type: "one-sample-ks" },
      { kind: "analysisOffering", table: "column", type: "one-sample-ks" },
    ],
  },
  {
    item: "177",
    title: "MV Select and transform",
    status: "covered",
    note: "Merged on check/v18: select-transform analysis type (columns/transforms/equations/rowRange/rowFilter/columnFilter/sets) on Multiple Variables tables — type + runner + MCP schema (61 types), wizard, pinned in checks.ts. Check corrected: the implementation's type is select-transform, not select-and-transform, so the old regex (which required 'and') never matched.",
    checks: [
      { kind: "analysis", type: "select-transform" },
      { kind: "analysisOffering", table: "multiple", type: "select-transform" },
    ],
  },
  {
    item: "180",
    title: "File > Merge",
    status: "covered",
    note: "Merged on check/v18: File > Merge + titer_merge_project (.hlx/.pzt appends with Prism-style asterisk rename; .prism/.pzfx converted first; links remapped, missing-sheet links dropped and named; one undo step).",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "merge-?project" }],
  },
  {
    item: "181",
    title: "Mixed-effects DF choice",
    status: "covered",
    note: "Merged on check/v18: dfMethod param (legacy / satterthwaite / kenward-roger) on mixed-effects — runner, wizard (defaults kenward-roger, Prism's default) and schema. Check corrected: the implementation's param is dfMethod, not df.",
    checks: [
      { kind: "analysisParam", type: "mixed-effects", param: "dfMethod" },
    ],
  },
  {
    item: "197",
    title: "Parts-of-whole native table type",
    status: "covered",
    note: "Merged on check/v18: native Parts of Whole table type (8th TableType) — create/import (PoW maps to it, no longer to Column), pie/donut/pow-stacked graphs with row categories as series, fraction-of-total + transform + plot-function analyses, .prism/.pzfx round-trip with a public fixture.",
    checks: [{ kind: "tableType", type: "parts-of-whole" }],
  },
  {
    item: "198",
    title: "Multiple-regression diagnostics",
    status: "covered",
    note: "Merged on check/v18 (batch-analyses-a): the multiple-regression runner returns VIF per predictor, the ANOVA table, AIC/AICc and the coefficients' covariance matrix (pinned against R in checks.ts, seq 198 pin). Check corrected: diagnostics are outcome fields, not schema params — the params stay dependent/predictors/sets, so hasExtraParam could never see them.",
    checks: [
      { kind: "sourceContains", file: "src/stats/multiple/multiple-regression.ts", text: "vif" },
      { kind: "sourceContains", file: "src/stats/multiple/multiple-regression.ts", text: "anovaTable" },
      { kind: "sourceContains", file: "src/stats/multiple/multiple-regression.ts", text: "covariance" },
      { kind: "sourceContains", file: "src/stats/multiple/multiple-regression.ts", text: "AICc" },
    ],
  },
  {
    item: "200",
    title: "Nonlinear fitting methods",
    status: "covered",
    note: "Merged on check/v18: fitMethod param (least-squares/robust/poisson) on nonlinear-regression — schema, wizard, runner (robust IRLS warm-start refits, Poisson log-link; pinned in checks.ts). Check corrected: the implementation's param is fitMethod, not method.",
    checks: [
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "fitMethod", value: "least-squares" },
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "fitMethod", value: "robust" },
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "fitMethod", value: "poisson" },
    ],
  },
  {
    item: "201",
    title: "6th-order + centered polynomials",
    status: "covered",
    note: "Merged on check/v18: sextic + centered-first..sixth in the nonlinear-regression model enum (B6 + seq 201), plus the centered flag and fitMethod params.",
    checks: [
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "model", value: "sextic" },
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "model", value: "centered-first" },
      { kind: "analysisParamEnum", type: "nonlinear-regression", param: "model", value: "centered-sixth" },
    ],
  },
  {
    item: "202",
    title: "AUC peak options",
    status: "covered",
    note: "Merged on check/v18: area-under-curve carries peak-option params beyond baseline/sets (gate flagged LANDED on the tip).",
    checks: [{ kind: "hasExtraParam", type: "area-under-curve", known: ["baseline", "sets"] }],
  },
  {
    item: "203",
    title: "Plot-a-function distributions",
    status: "covered",
    note: "Merged on check/v18: plot-function equation enum has the six statistical distributions (named *-distribution, not bare names — the old probe was the wrong shape).",
    checks: [
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "normal-distribution" },
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "t-distribution" },
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "f-distribution" },
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "chi-square-distribution" },
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "binomial-distribution" },
      { kind: "analysisParamEnum", type: "plot-function", param: "equation", value: "poisson-distribution" },
    ],
  },
  {
    item: "204",
    title: "Monte Carlo coverage",
    status: "covered",
    note: "Merged on check/v18: targetAnalysis gained paired-t + one-way-anova (7 targets), tails param (two-sided/less/greater), simulationDistribution gaussian/t. Residual, still open per the types.ts comment: Poisson / binomial simulation.",
    checks: [
      { kind: "analysisParamEnum", type: "monte-carlo", param: "targetAnalysis", value: "one-way-anova" },
      { kind: "analysisParamEnum", type: "monte-carlo", param: "targetAnalysis", value: "paired-t" },
      { kind: "analysisParam", type: "monte-carlo", param: "tails" },
      { kind: "analysisParamEnum", type: "monte-carlo", param: "simulationDistribution", value: "t" },
    ],
  },
  {
    item: "205",
    title: "Transform arithmetic",
    status: "covered",
    note: "Merged on check/v18: transform-data function enum gained the six arithmetic transforms (Y±K, Y×K, Y/K, K−Y, K/Y) plus a constant param.",
    checks: [
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "y-plus-k" },
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "y-minus-k" },
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "y-times-k" },
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "y-divided-by-k" },
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "k-minus-y" },
      { kind: "analysisParamEnum", type: "transform-data", param: "function", value: "k-divided-by-y" },
    ],
  },
  {
    item: "206",
    title: "Remove-baseline column math",
    status: "covered",
    note: "Merged on check/v18: remove-baseline gained columnMathOperation (subtract/divide/multiply/add) + columnMathA/B params. The old probe (extra baselineMethod enum values) was the wrong shape — column math is separate params, not new baseline methods.",
    checks: [
      { kind: "analysisParam", type: "remove-baseline", param: "columnMathOperation" },
      { kind: "analysisParamEnum", type: "remove-baseline", param: "columnMathOperation", value: "subtract" },
      { kind: "analysisParamEnum", type: "remove-baseline", param: "columnMathOperation", value: "divide" },
      { kind: "analysisParamEnum", type: "remove-baseline", param: "columnMathOperation", value: "multiply" },
      { kind: "analysisParam", type: "remove-baseline", param: "columnMathA" },
      { kind: "analysisParam", type: "remove-baseline", param: "columnMathB" },
    ],
  },
  {
    item: "208",
    title: "XY+Nested summary subcolumns",
    status: "covered",
    note: "Merged on check/v18: set-summary-format edit_table op (grouped/xy/nested sub-column formats) + Groups/Replicates panel picker; values stay in their group's slot, narrowing drops only past-width slots.",
    checks: [{ kind: "editOpsContains", op: "summary-format" }],
  },
  {
    item: "210",
    title: "Contingency+Nested graph shapes",
    status: "covered",
    note: "Merged on check/v18: grouped graphs from XY, scatter/box from contingency, mean-error from nested; build-graph gate accepts the new offerings and refuses the unoffered ones.",
    checks: [
      { kind: "graphKindOffering", table: "contingency", graphKind: "grouped-scatter" },
      { kind: "graphKindOffering", table: "contingency", graphKind: "grouped-box" },
      { kind: "graphKindOffering", table: "nested", graphKind: "mean-error" },
      { kind: "graphKindOffering", table: "xy", graphKind: "grouped-bars" },
    ],
  },
  {
    item: "211",
    title: "XY Spikes + bar/scatter combo",
    status: "covered",
    note: "Merged on check/v18: xy-spikes (vertical stems + tip markers) and xy-bar-scatter combo kinds on XY tables; summary tables draw the stored Means.",
    checks: [{ kind: "sourceContainsRe", scope: "spike", re: "spike" }],
  },
  {
    item: "212",
    title: "Floating bars",
    status: "covered",
    note: "Merged on check/v18: floating-bars kind — min-to-max bars per cell on column/grouped/nested/contingency tables; summary tables draw Mean ± stored error.",
    checks: [{ kind: "sourceContainsRe", scope: "graphs", re: "floating bar" }],
  },
  {
    item: "213",
    title: "Whisker definitions + violin variants",
    status: "covered",
    note: "Merged on check/v18: whisker choice (min-max/Tukey/p10-90/p5-95/min-max-all) + violin variants (full/truncated/half) on box-violin and grouped-box, with Format-panel choices.",
    checks: [{ kind: "graphOption", field: "whisker" }],
  },
  {
    item: "214",
    title: "Scatter styles + aligned dot plot",
    status: "covered",
    note: "Merged on check/v18: scatterStyle option (standard/classic/expanded/aligned) on individual, grouped-scatter and grouped-box points, with Format-panel Scatter choice. Checks corrected: the implementation's surface is the scatterStyle field (aligned is a value), not unjittered/aligned fields.",
    checks: [
      { kind: "graphOption", field: "scatterStyle" },
      { kind: "graphChoice", choice: "scatterStyle", value: "aligned" },
    ],
  },
  {
    item: "216",
    title: "Publication export",
    status: "covered",
    note: "Merged on check/v18: EPS, BMP, 100 DPI now present (checked here). CMYK/grayscale/vector-PDF also built by the 216 lane but have no stable absence marker, so this row checks EPS/BMP/100-DPI only.",
    checks: [
      { kind: "exportFormat", format: "eps" },
      { kind: "exportFormat", format: "bmp" },
      { kind: "exportDpi", dpi: "100" },
    ],
  },
  {
    item: "217",
    title: "Send to Keynote + Office",
    status: "covered",
    note: "Merged on check/v18: Keynote via the Mac AppleScript handoff (titer_export_office, OfficeTarget keynote); Word + PowerPoint as before.",
    checks: [{ kind: "sourceContainsRe", scope: "officeExport", re: "keynote" }],
  },
  {
    item: "218",
    title: "Legacy .pzf import",
    status: "covered",
    note: "Merged on check/v18: legacy .pzf import (Prism 4/5 binary, src/lib/pzf.ts; public Zenodo fixtures pinned in checks.ts incl. the MCP import-prism pin) wired through titer_import_prism / titer_open_project / titer_cloud_download — .pzf is import-only, no save format. Check corrected: no tool is named *pzf*; the surface is titer_import_prism accepting .pzf.",
    checks: [
      { kind: "sourceContains", file: "mcp.rs", text: "Import a Prism file (.prism / .pzfx / .pzf)" },
      { kind: "sourceContains", file: "mcp.rs", text: '"pzf" => Ok("pzf")' },
    ],
  },
  {
    item: "219",
    title: "Blank layout/image panels + background",
    status: "covered",
    note: "Merged on check/v18: blank + image FigurePanel kinds (never missing, never break a shared legend) + figureBackground colour in the composed SVG, with .hlx round-trip and MCP update-figure support. Check corrected: the image-panel surface in figure.ts is validFigureImageData, not imagePanel.",
    checks: [
      { kind: "sourceContains", file: "figure", text: "background" },
      { kind: "sourceContains", file: "figure", text: "validFigureImageData" },
    ],
  },
  {
    item: "220",
    title: "Axis number format",
    status: "covered",
    note: "Merged on check/v18: x/y number formats (auto/decimal/scientific, 0–15 decimals) via numberTickformat + applyNumberFormats; log/category axes untouched; .hlx round-trip; MCP update-graph validates.",
    checks: [
      { kind: "sourceContainsRe", scope: "graphs", re: "tickformat" },
      { kind: "sourceContainsRe", scope: "graphs", re: "decimals" },
    ],
  },
  {
    item: "222",
    title: "X error bars",
    status: "covered",
    note: "Merged on check/v18: xError option — the '<X> error' column draws error_x on XY scatter/bar/area and is hidden as a series while on; MCP update-graph validates.",
    checks: [{ kind: "graphOption", field: "xError" }],
  },
  {
    item: "223",
    title: "Superimposed bars + scatter-on-bars",
    status: "covered",
    note: "Merged on check/v18: groupLayout superimposed (barmode overlay, no gap) + grouped-bars-scatter kind (bars + one points trace per group) on grouped/nested tables; summary tables draw bars only.",
    checks: [{ kind: "graphChoiceExtra", choice: "groupLayout", known: ["interleaved", "separated"] }],
  },
  {
    item: "224",
    title: "MV text grouping variables",
    status: "covered",
    note: "Merged on check/v18: text predictors/covariates are dummy-coded (first level the reference) in multiple, multiple-logistic, Poisson and Cox regression — coefficients pinned against R's lm()/glm()/coxph() with treatment contrasts, and the Cox multi-level blocker is gone (gate flagged LANDED on the tip).",
    checks: [
      {
        kind: "tripwire",
        file: "coxPh",
        text: "Multi-level categorical covariates are not yet supported",
      },
    ],
  },
  {
    item: "228",
    title: "Scripts saved in project + run on open/close",
    status: "covered",
    note: "Merged on check/v18: scripts live in the project file (scripts?: ProjectScript[], serialized + parsed back with warnings) and runOnOpen entries run on open. Run itself is titer_run_script; save_project persists the file, so the MCP path composes.",
    checks: [
      { kind: "sourceContains", file: "projectFile", text: "scripts" },
      { kind: "sourceContains", file: "projectFile", text: "runOnOpen" },
    ],
  },
  {
    item: "230",
    title: "Paste Special / Paste Transpose",
    status: "covered",
    note: "Merged on check/v18: titer_edit_table gained a paste-transposed op (pastes data transposed at a cell, growing the table as a GUI paste does). Transpose analysis type was already covered via run_analysis. Fuller Paste Special dialog options (values-only etc.) are UI-side, not an MCP op.",
    checks: [{ kind: "editOpsContains", op: "paste-transposed" }],
  },
  {
    item: "236",
    title: "Duplicate Current Sheet",
    status: "covered",
    note: "Merged on check/v18: Duplicate Current Sheet (duplicateNode — one sheet, nothing else, right after its source) + titer_clone_analysis / titer_clone_figure through the job queue; tables already had duplicate_table_family, graphs clone_graph.",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "clone_analysis|clone_figure" }],
  },
  {
    item: "237",
    title: "Freeze/Unfreeze graphs",
    status: "covered",
    note: "Merged on check/v18: setGraphFrozen — freezing a graph snapshots the table data it draws (editing the table leaves the snapshot alone); freezing a figure snapshots each panel's table; unfreezing clears it; survives save/load, and a frozen node with no snapshot is unfrozen on load. titer_freeze_graph / titer_freeze_figure through the job queue.",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "freeze-?graph" }],
  },
  {
    item: "238",
    title: "Text/drawing/picture objects + Arrange",
    status: "covered",
    note: "Merged on check/v18: drawing objects on graph/figure sheets (text, rect, line, arrow, ellipse, image) — add, move, edit, group/ungroup, bring-forward/send-backward, duplicate, delete; titer_add_drawing_object / titer_update_drawing_object / titer_delete_drawing_object / titer_arrange_drawing_objects through the job queue; persisted in the project file.",
    checks: [{ kind: "sourceContainsRe", scope: "src", re: "drawingObject|textObject|pictureObject" }],
  },
  {
    item: "242",
    title: "Re-point orphaned analysis",
    status: "covered",
    note: "Merged on check/v18: repoint-analysis dispatch case + titer_repoint_analysis tool + repointCandidates (seq 242).",
    checks: [{ kind: "sourceContainsRe", scope: "mcpDispatch", re: "re-?point|relink" }],
  },
  {
    item: "244",
    title: "Change graph type after creation",
    status: "covered",
    note: "Merged on check/v18: graph_type param on titer_update_graph + changeGraphType dispatch + Change Graph Type menu (seq 244). The check named 'kind'; the implementation calls the field graph_type (verified in UpdateGraphArgs), so the check is corrected to the real field name.",
    checks: [{ kind: "structContains", struct: "UpdateGraphArgs", text: "graph_type" }],
  },
  {
    item: "#46",
    title: "Compare slopes/intercepts",
    status: "covered",
    note: "Merged on check/v18: compareSlopes param on linear-regression + compare-slopes analysis type.",
    checks: [{ kind: "hasExtraParam", type: "linear-regression", known: ["x", "y", "ys", "forceOrigin", "weights", "sets"] }],
  },
  {
    item: "#48",
    title: "One graph from multiple tables",
    status: "covered",
    note: "Merged on check/v18: source_table_ids on build_graph/update_graph + merged dataset in the graph view, panel figure and export.",
    checks: [{ kind: "structContains", struct: "BuildGraphArgs", text: "table_ids" }],
  },
  {
    item: "Mansi-6",
    title: "Save-as-.prism report in titer_save_project result (m2)",
    status: "covered",
    note: "Merged on check/v18: executeSaveProject returns write_report (tables/analyses written vs dropped + summary) for .prism/.pzfx, null for .hlx (Mansi P0 #6, cherry-picked from fix/18-m2-mcp-result).",
    checks: [{ kind: "saveResultHasReport" }],
  },

  // ── No meaningful MCP operation ──
  { item: "225", title: "Unified Preferences dialog", status: "na", note: "App settings, not project operations; MCP has no settings surface (allowlist toggles are Tauri commands for the Settings UI, by design).", checks: [] },
  { item: "227", title: "Print + Page Setup", status: "na", note: "Local OS dialog; MCP equivalent is export to PDF via titer_export_graph/export_figure.", checks: [] },
  { item: "231", title: "Select Row/Column", status: "na", note: "Transient UI selection state; MCP addresses data by id, not cursor.", checks: [] },
  { item: "239", title: "Manual zoom", status: "na", note: "View state only; no project effect.", checks: [] },
  { item: "240", title: "Keyboard navigation", status: "na", note: "Input method; no MCP operation.", checks: [] },
  { item: "241", title: "Help → User Guide link", status: "na", note: "Documentation link; no MCP operation.", checks: [] },
  { item: "1.7.4 doc fixes", title: "1.7.4 doc fixes", status: "na", note: "Docs, not MCP surface.", checks: [] },
  { item: "1.7.4 consent wording", title: "1.7.4 consent wording", status: "na", note: "UI copy in the Connect dialog; the consent gate itself is server-side and implemented.", checks: [] },
  { item: "1.7.x sticky MCP toggle + Connect button", title: "1.7.x sticky MCP toggle + Connect button", status: "na", note: "Server enablement UI, not a feature needing MCP exposure.", checks: [] },

  // ── Licence wall ──
  { item: "209", title: "MV graph shapes", status: "licence-wall", note: "9 Pro-gated MV graph kinds (Prism 11.1 additions). The 11.0.0-scope MV kinds Titer has are exposed via titer_build_graph. Not counted as a gap.", checks: [] },
];

// ── Run ──────────────────────────────────────────────────────────────────
let failed = false;
for (const [name, inv] of invariants) {
  console.log(`${inv.ok ? "PASS" : "FAIL"} invariant ${name}: ${inv.detail}`);
  if (!inv.ok) failed = true;
}

let coveredOk = 0;
let coveredBad = 0;
let gapsConfirmed = 0;
let landedCount = 0;
let skippedCount = 0;
for (const row of ROWS) {
  if (row.status === "na" || row.status === "licence-wall") {
    skippedCount++;
    continue;
  }
  const present: string[] = [];
  const absent: string[] = [];
  for (const spec of row.checks) {
    (surfacePresent(spec) ? present : absent).push(specLabel(spec));
  }
  const tag = row.status === "covered" ? "COVERED" : row.status === "in-flight" ? "IN-FLIGHT" : "GAP";
  if (row.status === "covered") {
    if (absent.length === 0) {
      coveredOk++;
      console.log(`PASS ${tag} ${row.item} ${row.title}`);
    } else {
      coveredBad++;
      failed = true;
      console.log(`FAIL REGRESSION ${row.item} ${row.title}: MCP surface missing: ${absent.join("; ")}`);
    }
  } else if (present.length === 0) {
    gapsConfirmed++;
    console.log(
      `GAP-CONFIRMED ${tag} ${row.item} ${row.title}${row.branch ? ` (in flight: origin/${row.branch})` : ""}`,
    );
  } else {
    landedCount++;
    failed = true;
    console.log(
      `FAIL LANDED ${row.item} ${row.title}: MCP surface now present — flip this row to covered: ${present.join("; ")}`,
    );
  }
}

const openItems = gapsConfirmed + landedCount;
console.log(
  `---\nmcp-coverage-180: ${ROWS.length} rows: ${coveredOk} covered OK, ${coveredBad} covered REGRESSED, ` +
    `${gapsConfirmed} gaps confirmed, ${landedCount} landed-but-unflipped, ${skippedCount} N/A/licence-wall`,
);
if (openItems > 0) {
  console.log(
    `MCP coverage gate: FAIL — ${openItems} item(s) still lack their MCP path ` +
      `(see GAP-CONFIRMED lines above; flip rows to covered as lanes land).`,
  );
} else if (failed) {
  console.log("MCP coverage gate: FAIL — regressions above.");
} else {
  console.log("MCP coverage gate: PASS — every 1.8 in-scope item has its MCP path.");
}
process.exitCode = failed || openItems > 0 ? 1 : 0;
