// Prism scripts (v2 item 6): automation without programming, as GraphPad
// Prism 10 documents it (the User Guide's "Script details" pages). A script
// is plain text: one command per line, `//` and `/* */` comments, `ForEach`
// loops with `%N` / `%S` substitution.
//
// The engine is pure: it takes the project, works on a deep-cloned draft,
// and returns `{ doc, log, effects }`. Effects are data — the dialog executes
// them (file writes, graph renders, save, print) — so the checks assert them
// without a DOM. A run that hits an error stops and changes nothing: the
// draft is discarded and the input doc comes back, so one bad line never
// leaves half a script applied (Prism stops on error too).
//
// Coordinates follow the guide ("Including data and info constants in the
// script file"): row 0 is the title row, row 1 the first data row; column
// -1 is the row titles, column 0 the X column, column 1 the first Y column;
// subcol picks the replicate within a Y data set (1-based).
//
// Deferred commands (a documented command Titer can't do yet) are errors
// that name the reason — never silently dropped. See investigations.md for
// the full deferred list.

import { DEFAULT_FIGURE_DPI, DEFAULT_FIGURE_SIZE, DEFAULT_LABEL_STYLE, figureLabel } from "./figure";
import { largestAt } from "./image-dpi";
import { PALETTES, savedPalette } from "./palettes";
import { parseCsv } from "./prism-csv";
import { recomputeCalculated } from "./calcvars";
import { transformTable } from "./transform";
import { isGrouped } from "./dataset";
import { seriesKeyOf } from "./columns";
import { regroupTable, renestTable, replicateXY, writeBlock } from "../views/tables/table-data";
import { followTable } from "../store/references";
import {
  DEFAULT_GRAPH_OPTIONS,
  type FigurePanel,
  type InfoConstant,
  type ProjectNode,
  type TableData,
} from "../store/types";
import { infoSheetsOf, newConstantId } from "./info-sheets";
import { version } from "../../package.json";

/** The project as a script sees it: the file's content, plus the project
 *  name scripts can set. Info constants live in the project's info sheets
 *  (the full store, backlog item 7) — a script reads and writes the first
 *  sheet's constants, creating the sheet when a write needs one; there is
 *  no second, project-level copy of them. */
export interface ScriptDoc {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
  projectName?: string;
}

export type ExportFormat = "png" | "jpeg" | "svg" | "tif" | "bmp" | "pdf" | "eps";

/** What the dialog does after a run, in order: rendering a graph or figure
 *  and writing it, writing a text file, saving the project, printing, or
 *  closing the dialog. */
export type ScriptEffect =
  | {
      type: "export-graph";
      graphId: string;
      format: ExportFormat;
      dpi: number;
      clear: boolean;
      mode?: "rgbhi" | "gray" | "mono";
      path: string;
      /** ExportAllPDF only: the sheet's name, so a failed batch item is
       *  named in the log while the batch continues with the rest. */
      sheetName?: string;
    }
  | { type: "write-text-file"; path: string; text: string }
  | { type: "save-project" }
  | { type: "print" }
  | { type: "close-dialog" };

export interface ScriptResult {
  doc: ScriptDoc;
  log: string[];
  effects: ScriptEffect[];
  dialogTitle?: string;
  /** True when an error stopped the run (the doc is then the input, unchanged). */
  stopped: boolean;
}

/** An error at `line`, reported as `Line N: …` — the run stops there. */
class ScriptError extends Error {
  line: number;
  constructor(line: number, message: string) {
    super(`Line ${line}: ${message}`);
    this.line = line;
  }
}

// ── Parsing ──────────────────────────────────────────────────────────────

type Statement =
  | { kind: "command"; line: number; name: string; args: string[]; data?: string[][] }
  | { kind: "loop"; line: number; mode: "count" | "sheet"; count: number; body: Statement[] };

/** The script with line and block comments removed —
 *  never inside a double-quoted string. */
function stripComments(text: string): string {
  let out = "";
  let i = 0;
  let quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      out += c;
      if (c === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') quoted = false;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return out; // an unclosed comment swallows the rest
      out += text.slice(i, end).replace(/[^\n]/g, " "); // keep the line count
      i = end + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** The arguments after a command name: split on commas and whitespace
 *  outside double quotes; a quoted argument keeps its commas and spaces.
 *  A trailing `;` ends the line (the step-by-step examples write one). */
function splitArgs(rest: string): string[] {
  const args: string[] = [];
  let cur = "";
  let quoted = false;
  let has = false;
  const push = () => {
    if (has || quoted) args.push(cur);
    cur = "";
    has = false;
    quoted = false;
  };
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quoted) {
      if (c === '"') quoted = false;
      else cur += c;
      continue;
    }
    if (c === '"') {
      quoted = true;
      has = true;
      continue;
    }
    if (c === "," || c === ";" || /\s/.test(c)) {
      push();
      continue;
    }
    cur += c;
    has = true;
  }
  push();
  return args;
}

function parseBlock(lines: string[], start: number, inLoop: number | null): { statements: Statement[]; next: number } {
  const statements: Statement[] = [];
  let i = start;
  while (i < lines.length) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();
    i++;
    if (!trimmed) continue;
    const nameEnd = trimmed.search(/[\s,;]/);
    const name = nameEnd === -1 ? trimmed : trimmed.slice(0, nameEnd);
    const rest = nameEnd === -1 ? "" : trimmed.slice(nameEnd);
    const lower = name.toLowerCase();
    if (lower === "next") {
      if (inLoop === null) throw new ScriptError(lineNo, "Next without a ForEach");
      return { statements, next: i };
    }
    if (lower === "foreach") {
      const args = splitArgs(rest);
      const first = (args[0] ?? "").toLowerCase();
      if (first === "sheet") {
        const inner = parseBlock(lines, i, lineNo);
        statements.push({ kind: "loop", line: lineNo, mode: "sheet", count: 0, body: inner.statements });
        i = inner.next;
        continue;
      }
      const count = Number(args[0]);
      if (args.length === 0 || !Number.isInteger(count) || count < 0)
        throw new ScriptError(
          lineNo,
          `ForEach needs a number of loops or Sheet — "${args[0] ?? ""}" is neither (file loops aren't available: Titer has no directory listing to enumerate files with)`,
        );
      const inner = parseBlock(lines, i, lineNo);
      statements.push({ kind: "loop", line: lineNo, mode: "count", count, body: inner.statements });
      i = inner.next;
      continue;
    }
    const args = splitArgs(rest);
    const statement: Statement = { kind: "command", line: lineNo, name, args };
    if (lower === "insertdata") {
      // The data lives between <Data> and </Data> tags, on this line or the
      // next one; the rest of the script continues after </Data>.
      const tag = /<data>/i;
      let head = raw;
      let dataText = "";
      let found = false;
      // The tag is on the command's own line or the next one — no further,
      // or a later command would be swallowed as data.
      for (let k = 0; k < 2 && i - 1 + k < lines.length && !found; k++) {
        const j = i - 1 + k;
        const m = tag.exec(lines[j]);
        if (!m) continue;
        // The command's args are the command line (or its part before the
        // tag, when the tag shares the line).
        head = k === 0 ? lines[j].slice(0, m.index) : raw;
        const after = lines[j].slice(m.index + m[0].length);
        const close = /<\/data>/i.exec(after);
        if (close) {
          dataText = after.slice(0, close.index);
          found = true;
          i = j + 1;
        } else {
          dataText = `${after}\n`;
          let l = j + 1;
          while (l < lines.length) {
            const c = /<\/data>/i.exec(lines[l]);
            if (c) {
              dataText += lines[l].slice(0, c.index);
              found = true;
              i = l + 1;
              break;
            }
            dataText += `${lines[l]}\n`;
            l++;
          }
        }
      }
      if (!found)
        throw new ScriptError(
          lineNo,
          "InsertData needs its data between <Data> and </Data> tags, e.g. InsertData 1, 0, 1 <Data> 1, 2 </Data>",
        );
      // The command's own args are the part before the tag.
      const headNameEnd = head.trim().search(/[\s,;]/);
      statement.args = splitArgs(headNameEnd === -1 ? "" : head.trim().slice(headNameEnd));
      // A comma right after <Data> (or before </Data> on one line) is the
      // command's separator, not an empty first/last value — the guide's
      // own example writes `InsertData, <Data>, 1, 2, …`.
      dataText = dataText.replace(/^\s*,/, "");
      if (!dataText.includes("\n")) dataText = dataText.replace(/,\s*$/, "");
      statement.data = dataText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l !== "")
        .map((l) => (parseCsv(l)[0] ?? []).map((c) => c.trim()));
    }
    statements.push(statement);
  }
  if (inLoop !== null) throw new ScriptError(inLoop, "ForEach without a Next");
  return { statements, next: i };
}

/** The statements of a script (throws `ScriptError` on bad syntax). */
export function parseScript(text: string): Statement[] {
  return parseBlock(stripComments(text).split("\n"), 0, null).statements;
}

/** The files an `Import` in the script names (for the dialog's pre-flight
 *  read). A script that doesn't parse names none — the run reports the error. */
export function scriptImportFiles(text: string): string[] {
  let statements: Statement[];
  try {
    statements = parseScript(text);
  } catch {
    return [];
  }
  const files: string[] = [];
  const walk = (list: Statement[]) => {
    for (const st of list) {
      if (st.kind === "loop") walk(st.body);
      else if (st.name.toLowerCase() === "import" && st.args[0]) files.push(st.args[0]);
    }
  };
  walk(statements);
  return [...new Set(files)];
}

// ── Execution ────────────────────────────────────────────────────────────

type Current = { kind: "table" | "graph" | "figure" | "analysis" | "info"; id: string | null };

interface Ctx {
  doc: ScriptDoc;
  log: string[];
  effects: ScriptEffect[];
  /** SetPath: where relative file names land ("" = unset). */
  path: string;
  current: Current;
  output: string[] | null;
  outputPath: string | null;
  outputDelimiter: string;
  clipboard: string[][] | null;
  dialogTitle?: string;
  /** %N, innermost last. */
  loopStack: number[];
  /** %S: the sheet a ForEach Sheet is on. */
  sheetName: string | null;
  warnedFileVars: boolean;
  files: Record<string, string>;
}

/** Throws a script error — a `function` declaration, not a `const` arrow,
 *  so TypeScript narrows after it (a never-returning arrow doesn't narrow). */
function err(line: number, message: string): never {
  throw new ScriptError(line, message);
}

const log = (ctx: Ctx, message: string) => ctx.log.push(message);

const isInt = (v: string | undefined): v is string => v !== undefined && /^-?\d+$/.test(v);
const reqInt = (line: number, v: string | undefined, what: string): number => {
  if (!isInt(v)) err(line, `${what} needs a whole number, not "${v ?? ""}"`);
  return parseInt(v, 10);
};
const optInt = (line: number, v: string | undefined, what: string, fallback: number): number =>
  v === undefined ? fallback : reqInt(line, v, what);
const reqNum = (line: number, v: string | undefined, what: string): number => {
  if (v === undefined || !Number.isFinite(Number(v))) err(line, `${what} needs a number, not "${v ?? ""}"`);
  return Number(v);
};

/** An argument as the log shows it: quoted when it holds a space or comma. */
const quoteArg = (arg: string) => (/[\s,;]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg);

/** `%N` (loop number), `%S` (current sheet name), `%F` / `%X` (file loop —
 *  none here, so empty, warned about once). */
function substitute(arg: string, ctx: Ctx): string {
  return arg.replace(/%[NFSX]/g, (m) => {
    if (m === "%N") return ctx.loopStack.length ? String(ctx.loopStack.at(-1)) : "";
    if (m === "%S") return ctx.sheetName ?? currentName(ctx);
    if (!ctx.warnedFileVars) {
      ctx.warnedFileVars = true;
      log(ctx, "%F and %X come from a file loop, which Titer doesn't offer — they expand to nothing.");
    }
    return "";
  });
}

const currentNode = (ctx: Ctx): ProjectNode | null => (ctx.current.id ? (ctx.doc.nodes[ctx.current.id] ?? null) : null);

const currentName = (ctx: Ctx): string => currentNode(ctx)?.name ?? "";

function currentTable(ctx: Ctx, line: number): ProjectNode {
  const node = currentNode(ctx);
  if (!node || node.type !== "table" || !node.data) err(line, "no data table is current — GoTo a data table first");
  return node;
}

/** The info constants a script reads and writes: the first info sheet's
 *  constants (Prism has one info table; Titer's first sheet wins, the same
 *  rule the hooks' lookup uses). A write with no sheet creates one — a bare
 *  sheet, no default constants, so row N is the Nth constant the script
 *  wrote — placed before the first figure, where info sheets live. */
function infoSheetConstants(ctx: Ctx): InfoConstant[] {
  const sheet = infoSheetsOf(ctx.doc.nodes, ctx.doc.rootOrder)[0];
  if (sheet?.info) return sheet.info.constants;
  const constants: InfoConstant[] = [];
  const node: ProjectNode = {
    id: newId("info"),
    type: "info",
    name: "Info Sheet",
    parentId: null,
    info: { constants, notes: "", linkedTableId: null },
  };
  ctx.doc.nodes[node.id] = node;
  const firstFigure = ctx.doc.rootOrder.findIndex((id) => ctx.doc.nodes[id]?.type === "figure");
  if (firstFigure === -1) ctx.doc.rootOrder.push(node.id);
  else ctx.doc.rootOrder.splice(firstFigure, 0, node.id);
  return constants;
}

function currentGraphOrFigure(ctx: Ctx, line: number): ProjectNode {
  const node = currentNode(ctx);
  if (!node || (node.type !== "graph" && node.type !== "figure")) err(line, "no graph is current — GoTo a graph first");
  return node;
}

function currentGraph(ctx: Ctx, line: number): ProjectNode {
  const node = currentNode(ctx);
  if (!node || node.type !== "graph") err(line, "no graph is current — GoTo a graph first");
  return node;
}

/** The sheets in sidebar order: each table with its analyses and graphs, then the figures. */
function sheetList(doc: ScriptDoc): { kind: Current["kind"]; id: string; name: string }[] {
  const sheets: { kind: Current["kind"]; id: string; name: string }[] = [];
  for (const id of doc.rootOrder) {
    const node = doc.nodes[id];
    if (!node) continue;
    if (node.type === "table") {
      sheets.push({ kind: "table", id, name: node.name });
      for (const childId of doc.childOrder[id] ?? []) {
        const child = doc.nodes[childId];
        if (child && (child.type === "analysis" || child.type === "graph"))
          sheets.push({ kind: child.type, id: childId, name: child.name });
      }
    } else if (node.type === "figure") sheets.push({ kind: "figure", id, name: node.name });
  }
  return sheets;
}

const newId = (type: string) => `${type}_${Math.random().toString(36).slice(2, 10)}`;

/** `base`, or `base 2`, `base 3`… when a root item already has it. */
function uniqueRootName(doc: ScriptDoc, base: string): string {
  const taken = new Set(doc.rootOrder.map((id) => doc.nodes[id]?.name ?? ""));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`;
    if (!taken.has(name)) return name;
  }
}

/** A table's analyses and graphs follow its columns after a scripted change
 *  (the store does the same for a hand edit). Calculated variables follow
 *  every edit too, and tables computed from this one take their new values
 *  through transformTable — otherwise a scripted edit leaves them stale. */
function followChildren(doc: ScriptDoc, tableId: string) {
  const table = doc.nodes[tableId];
  if (!table?.data) return;
  // A Transform's values come from its source table, not from formulas.
  if (!table.transform) table.data = recomputeCalculated(table.data);
  for (const child of Object.values(doc.nodes)) {
    if (child.parentId === tableId) doc.nodes[child.id] = followTable(child, {}, table.data.columns);
  }
  // The tables computed from this one follow its new values, recursively.
  for (const t of Object.values(doc.nodes)) {
    if (t.transform?.from === tableId && t.data) {
      t.data = transformTable(table.data, t.tableType!, t.transform, t.data);
      followChildren(doc, t.id);
    }
  }
}

// ── Prism coordinates ────────────────────────────────────────────────────

/** A Y data set of a table: its grid columns (one per replicate). */
function dataSets(data: TableData, tableType: string | undefined): { name: string; cols: number[] }[] {
  if (tableType === "xy" && isGrouped(data)) {
    const keys = [...new Set(data.columns.slice(2).map(seriesKeyOf))];
    return keys.map((key) => ({
      name: key,
      cols: data.columns.map((_, i) => i).filter((i) => i >= 2 && seriesKeyOf(data.columns[i]) === key),
    }));
  }
  if (tableType === "grouped" || tableType === "nested") {
    const keys = [...new Set(data.columns.slice(1).map(seriesKeyOf))];
    return keys.map((key) => ({
      name: key,
      cols: data.columns.map((_, i) => i).filter((i) => i >= 1 && seriesKeyOf(data.columns[i]) === key),
    }));
  }
  if (tableType === "xy" || tableType === "survival") return data.columns.slice(2).map((name, i) => ({ name, cols: [i + 2] }));
  return data.columns.slice(1).map((name, i) => ({ name, cols: [i + 1] }));
}

/** Prism (row, col, subcol) → grid (r, c). Row 0 is the title row (r = -1);
 *  col -1 is the row titles (c = 0), col 0 the X / first data column
 *  (c = 1), col ≥ 1 the Nth Y data set, subcol (1-based) its replicate. */
function cellPos(
  data: TableData,
  tableType: string | undefined,
  row: number,
  col: number,
  subcol: number,
  line: number,
): { r: number; c: number } {
  if (row < 0) err(line, `row ${row} doesn't exist — row 0 is the title row, row 1 the first data row`);
  if ((col === -1 || col === 0) && subcol !== 1) err(line, "a subcolumn only applies to a Y column");
  let c: number;
  if (col === -1) c = 0;
  else if (col === 0) c = 1;
  else {
    const sets = dataSets(data, tableType);
    const set = sets[col - 1];
    if (!set)
      err(line, `column ${col} doesn't exist — this table has ${sets.length} Y column${sets.length === 1 ? "" : "s"}`);
    if (subcol < 1 || subcol > set.cols.length)
      err(line, `subcolumn ${subcol} doesn't exist in column ${col} — it has ${set.cols.length}`);
    c = set.cols[subcol - 1];
  }
  return { r: row - 1, c };
}

/** The text of a grid cell: the column's name on the title row, "" past the data. */
function cellTextAt(data: TableData, r: number, c: number): string {
  if (r === -1) return data.columns[c] ?? "";
  return data.rows[r]?.[c] ?? "";
}

// ── Files ────────────────────────────────────────────────────────────────

/** A file name as a path: absolute as given, relative under SetPath, with
 *  the extension added when the name has none. No name and no SetPath is an
 *  error (a script can't ask where to write). */
function resolveFilePath(
  ctx: Ctx,
  filename: string | undefined,
  ext: string,
  fallbackName: string,
  line: number,
): string {
  let name = filename ?? `${fallbackName}.${ext}`;
  const base = name.split("/").pop() ?? "";
  if (filename !== undefined && !/\.[^/.]+$/.test(base)) name += `.${ext}`;
  if (name.startsWith("/")) return name;
  if (!ctx.path)
    err(line, `no file name was given and no SetPath is set — give one, e.g. SetPath "/Users/you/Desktop"`);
  return `${ctx.path.replace(/\/$/, "")}/${name}`;
}

const csvField = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/** A sheet name as a file stem: path separators, Windows-illegal and
 *  control characters become `-`, leading/trailing dots and spaces go,
 *  over-long stems are cut. Mirrors `sanitizeExportAllStem` in
 *  lib/export-all.ts — the engine stays pure (no DOM, no Tauri), so it
 *  carries its own copy; keep the two in step. */
function sanitizeSheetStem(name: string, fallback: string): string {
  const stem = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, "");
  return stem ? stem.slice(0, 200) : fallback;
}

/** A table as CSV text: its column names, then its rows. */
function tableToCsv(data: TableData): string {
  const lines = [data.columns.map(csvField).join(",")];
  for (const row of data.rows) lines.push(row.map((c) => csvField(c ?? "")).join(","));
  return `${lines.join("\n")}\n`;
}

function requireOutput(ctx: Ctx, line: number): string[] {
  if (!ctx.output) err(line, "OpenOutput first — text output needs an open output file");
  return ctx.output;
}

// ── Deferred commands ────────────────────────────────────────────────────

/** A documented command Titer can't do yet: an error naming the reason,
 *  never a silent skip. */
const DEFERRED: Record<string, string> = {
  duplicatefamily:
    "DuplicateFamily duplicates a table with its analyses and graphs — that is the duplicate-a-family feature, a separate lane, not this one",
  importlink: "ImportLink links a file into the table — Titer imports are copies, there is nothing to link to",
  insertdatalink:
    "InsertDataLink links inline data into the table — Titer imports are copies, there is nothing to link to",
  exportemf: "ExportEMF is Windows-only in Prism",
  exportwmf: "ExportWMF is Windows-only in Prism",
  exportpcx: "ExportPCX is an obsolete format Prism itself lists for legacy files only",
  exportpict: "ExportPICT is an obsolete format Prism itself lists for legacy files only",
  sendtoword: "SendToWord needs Office automation, which the app doesn't have",
  sendtopp: "SendToPP needs Office automation, which the app doesn't have",
  table:
    "Table / WTable / EndTable / NextRow write the current results sheet, and Titer computes results at view time rather than storing them as a table",
  wtable:
    "Table / WTable / EndTable / NextRow write the current results sheet, and Titer computes results at view time rather than storing them as a table",
  endtable:
    "Table / WTable / EndTable / NextRow write the current results sheet, and Titer computes results at view time rather than storing them as a table",
  nextrow:
    "Table / WTable / EndTable / NextRow write the current results sheet, and Titer computes results at view time rather than storing them as a table",
  regenerate:
    "Regenerate re-runs Monte Carlo simulations, which need R and the stored simulation parameters — out of this lane's scope",
  exit: "Exit is Windows-only in Prism; closing the app from a script isn't offered on macOS",
  close:
    "Close closes the project window — window management from a script is out of scope (the dialog's Close button covers it)",
  open: "Open would replace the project under a running script — open the project first, then run the script",
  saveas:
    "SaveAs can't honor a file name through the document's save dialog — use Save, or Save As… from the File menu",
};

// ── Commands ─────────────────────────────────────────────────────────────

function execCommand(st: Extract<Statement, { kind: "command" }>, ctx: Ctx) {
  const line = st.line;
  const name = st.name;
  const lower = name.toLowerCase();
  const args = st.args.map((a) => substitute(a, ctx));
  log(ctx, `Line ${line}: ${[name, ...args.map(quoteArg)].join(" ")}`);
  const deferred = DEFERRED[lower];
  if (deferred) err(line, deferred);

  switch (lower) {
    case "goto": {
      if (args[0] === "+") {
        const sheets = sheetList(ctx.doc);
        if (!sheets.length) err(line, "this project has no sheets");
        const at = sheets.findIndex((s) => s.id === ctx.current.id);
        const next = sheets[(at + 1) % sheets.length];
        ctx.current = { kind: next.kind, id: next.id };
        ctx.doc.activeNodeId = next.id;
        return;
      }
      const section = (args[0] ?? "").toUpperCase();
      if (section === "I") {
        if (args[1] !== undefined && args[1] !== "1") err(line, "Titer has one info table — GoTo I takes no number");
        ctx.current = { kind: "info", id: null };
        return;
      }
      const poolKind =
        section === "D"
          ? "table"
          : section === "R"
            ? "analysis"
            : section === "G"
              ? "graph"
              : section === "L"
                ? "figure"
                : null;
      if (!poolKind)
        err(
          line,
          `GoTo needs a section — D (data), I (info), R (results), G (graph) or L (layout) — not "${args[0] ?? ""}"`,
        );
      const kindName =
        section === "D" ? "data table" : section === "R" ? "results sheet" : section === "G" ? "graph" : "layout";
      const pool = sheetList(ctx.doc).filter((s) => s.kind === poolKind);
      let target: (typeof pool)[number] | undefined;
      if (args[1] === undefined) target = pool[0];
      else if (/^\d+$/.test(args[1])) target = pool[parseInt(args[1], 10) - 1];
      else target = pool.find((s) => s.name.toLowerCase() === args[1].toLowerCase());
      if (!target)
        err(
          line,
          args[1] !== undefined && !/^\d+$/.test(args[1])
            ? `no ${kindName} named "${args[1]}"`
            : `no ${kindName} ${args[1] ?? 1} — this project has ${pool.length}`,
        );
      ctx.current = { kind: target.kind as Current["kind"], id: target.id };
      ctx.doc.activeNodeId = target.id;
      return;
    }
    case "setpath": {
      if (!args[0]) err(line, "SetPath needs a folder");
      ctx.path = args[0];
      return;
    }
    case "setprojectname": {
      ctx.doc.projectName = args[0] ? args[0] : undefined;
      return;
    }
    case "setsheettitle": {
      const node = currentNode(ctx);
      if (!node) err(line, "no sheet is current");
      if (!args[0]) err(line, "SetSheetTitle needs a name");
      const keep = args[1] === undefined ? 0 : reqInt(line, args[1], "SetSheetTitle's K");
      node.name = keep > 0 ? node.name.slice(0, keep) + args[0] : args[0];
      return;
    }
    case "setscriptdialogtitle": {
      ctx.dialogTitle = args[0] ?? "";
      return;
    }
    case "recalcall": {
      log(ctx, "RecalcAll: results in Titer are always current, so there is nothing to recalculate.");
      return;
    }
    case "beep": {
      log(ctx, "Beep.");
      return;
    }
    case "createlog": {
      log(ctx, "CreateLog: the script log is always kept, so this does nothing.");
      return;
    }
    case "closescriptdialog": {
      ctx.effects.push({ type: "close-dialog" });
      return;
    }
    case "print": {
      ctx.effects.push({ type: "print" });
      return;
    }
    case "save": {
      ctx.effects.push({ type: "save-project" });
      return;
    }
    case "setyreplicates": {
      const n = reqInt(line, args[0], "SetYReplicates needs the number of replicates");
      if (n < 1) err(line, "SetYReplicates needs at least 1 replicate");
      if (n > 20) err(line, "SetYReplicates allows at most 20 replicates");
      const table = currentTable(ctx, line);
      const data = table.data!;
      const type = table.tableType;
      if (type === "grouped") {
        if (!data.groups) err(line, "this grouped table has no groups to keep");
        table.data = regroupTable(data, data.groups, n);
      } else if (type === "xy") {
        const { data: next, renamed } = replicateXY(data, n);
        table.data = next;
        if (Object.keys(renamed).length)
          log(
            ctx,
            `SetYReplicates renamed columns: ${Object.entries(renamed)
              .map(([from, to]) => `“${from}” → “${to}”`)
              .join(", ")}.`,
          );
      } else if (type === "nested") {
        if (!data.groups || !data.subgroups) err(line, "this nested table has no groups to keep");
        table.data = renestTable(data, data.groups, data.subgroups, n);
      } else {
        log(ctx, `SetYReplicates: a ${type ?? "column"} table has no replicates to set — skipped.`);
        return;
      }
      followChildren(ctx.doc, table.id);
      return;
    }
    case "cleartable": {
      const table = currentTable(ctx, line);
      const data = table.data!;
      if (args.length === 0) {
        let cleared = 0;
        table.data = {
          ...data,
          rows: data.rows.map((row) => row.map((c) => (c !== null ? (cleared++, null) : null))),
          excluded: undefined,
        };
        log(ctx, `ClearTable: erased ${cleared} value${cleared === 1 ? "" : "s"}; the table's links stay.`);
        followChildren(ctx.doc, table.id);
        return;
      }
      const row = reqInt(line, args[0], "ClearTable's row");
      const col = optInt(line, args[1], "ClearTable's column", 1);
      const subcol = optInt(line, args[2], "ClearTable's subcolumn", 1);
      const pos = cellPos(data, table.tableType, row, col, subcol, line);
      const firstRow = Math.max(pos.r, 0);
      let cleared = 0;
      const rows = data.rows.map((r, ri) => {
        if (ri < firstRow) return r;
        return r.map((c, ci) => {
          const inRegion = pos.c === 0 ? ci === 0 : ci >= 1 && ci <= pos.c;
          if (inRegion && c !== null) {
            cleared++;
            return null;
          }
          return c;
        });
      });
      const excluded = (data.excluded ?? []).filter((key) => {
        const [r, c] = key.split(",").map(Number);
        const inRegion = r >= firstRow && (pos.c === 0 ? c === 0 : c >= 1 && c <= pos.c);
        return !inRegion;
      });
      table.data = { ...data, rows, excluded: excluded.length ? excluded : undefined };
      log(ctx, `ClearTable: erased ${cleared} value${cleared === 1 ? "" : "s"} left-and-below the cell.`);
      followChildren(ctx.doc, table.id);
      return;
    }
    case "deletealldatasets": {
      for (const node of Object.values(ctx.doc.nodes)) {
        if (node.type === "table" && node.data) {
          node.data = { ...node.data, rows: node.data.rows.map((row) => row.map(() => null)), excluded: undefined };
        }
      }
      const removed = Object.values(ctx.doc.nodes).filter((n) => n.type === "analysis" || n.type === "graph");
      for (const node of removed) delete ctx.doc.nodes[node.id];
      ctx.doc.childOrder = Object.fromEntries(ctx.doc.rootOrder.map((id) => [id, [] as string[]]));
      const first = ctx.doc.rootOrder[0] ?? null;
      ctx.doc.activeNodeId = first;
      ctx.current = first ? { kind: "table", id: first } : { kind: "info", id: null };
      log(
        ctx,
        `DeleteAllDataSets: erased every table and removed ${removed.length} linked ${removed.length === 1 ? "sheet" : "sheets"}; figures stay, their panels now point at graphs that are gone.`,
      );
      return;
    }
    case "duplicatedatatable": {
      const table = currentTable(ctx, line);
      const clear = (args[0] ?? "").toLowerCase() === "clear";
      const id = newId("table");
      const data = structuredClone(table.data!);
      if (clear) {
        // Clearing the copy clears its exclusions too — otherwise the
        // cleared cells keep phantom `*` markers (Round 2 Issue 57).
        data.rows = data.rows.map((row) => row.map(() => null));
        data.excluded = undefined;
      }
      const node: ProjectNode = {
        ...structuredClone(table),
        id,
        name: uniqueRootName(ctx.doc, `Copy of ${table.name}`),
        data,
      };
      delete node.floatingNotes;
      ctx.doc.nodes[id] = node;
      const at = ctx.doc.rootOrder.indexOf(table.id);
      ctx.doc.rootOrder.splice(at === -1 ? ctx.doc.rootOrder.length : at + 1, 0, id);
      ctx.doc.childOrder[id] = [];
      ctx.current = { kind: "table", id };
      ctx.doc.activeNodeId = id;
      return;
    }
    case "createlayout": {
      const rows = reqInt(line, args[0], "CreateLayout's row count");
      const cols = reqInt(line, args[1], "CreateLayout's column count");
      if (rows < 1 || rows > 6 || cols < 1 || cols > 6) err(line, "CreateLayout lays out 1–6 rows by 1–6 columns");
      const start = optInt(line, args[3], "CreateLayout's starting graph", 1);
      const count = args[4] === undefined ? undefined : reqInt(line, args[4], "CreateLayout's graph count");
      const graphs = sheetList(ctx.doc).filter((s) => s.kind === "graph");
      const picked = graphs.slice(
        Math.max(0, start - 1),
        count === undefined ? undefined : Math.max(0, start - 1) + count,
      );
      const panels: FigurePanel[] = picked.slice(0, rows * cols).map((g, i) => ({
        graphId: g.id,
        graphName: g.name,
        label: figureLabel(i),
        title: "",
        row: Math.floor(i / cols),
        col: i % cols,
        rowSpan: 1,
        colSpan: 1,
      }));
      if (!panels.length) err(line, "CreateLayout found no graphs to lay out");
      const id = newId("figure");
      ctx.doc.nodes[id] = {
        id,
        type: "figure",
        name: uniqueRootName(ctx.doc, "Figure"),
        parentId: null,
        panels,
        grid: { rows, cols },
        figureSize: { ...DEFAULT_FIGURE_SIZE },
        labelStyle: { ...DEFAULT_LABEL_STYLE },
        figureTitle: "",
        sharedLegend: "none",
        dpi: DEFAULT_FIGURE_DPI,
      };
      ctx.doc.rootOrder.push(id);
      ctx.current = { kind: "figure", id };
      ctx.doc.activeNodeId = id;
      return;
    }
    case "insertdata": {
      const table = currentTable(ctx, line);
      const data = table.data!;
      const row = optInt(line, args[0], "InsertData's row", 1);
      const col = optInt(line, args[1], "InsertData's column", 0);
      const subcol = optInt(line, args[2], "InsertData's subcolumn", 1);
      const block = (st.data ?? []).map((r) => r.map((c) => substitute(c, ctx)));
      if (!block.length) err(line, "InsertData's <Data> block is empty");
      const pos = cellPos(data, table.tableType, row, col, subcol, line);
      if (pos.r === -1) {
        // Row 0 is the title row: the first line renames columns, the rest go to the data rows.
        const columns = [...data.columns];
        block[0].forEach((value, j) => {
          if (value !== "" && pos.c + j < columns.length) columns[pos.c + j] = value;
        });
        const rest = block.slice(1);
        table.data = rest.length
          ? writeBlock({ ...data, columns }, 0, pos.c, rest, table.tableType ?? "column")
          : { ...data, columns };
      } else {
        table.data = writeBlock(data, pos.r, pos.c, block, table.tableType ?? "column");
      }
      followChildren(ctx.doc, table.id);
      return;
    }
    case "copy": {
      const table = currentTable(ctx, line);
      ctx.clipboard = table.data!.rows.map((row) => row.map((c) => c ?? ""));
      log(ctx, `Copy: ${ctx.clipboard.length} row${ctx.clipboard.length === 1 ? "" : "s"} copied.`);
      return;
    }
    case "paste": {
      const clipboard = ctx.clipboard;
      if (!clipboard) err(line, "nothing copied yet — Copy first");
      const table = currentTable(ctx, line);
      table.data = writeBlock(table.data!, 0, 0, clipboard, table.tableType ?? "column");
      followChildren(ctx.doc, table.id);
      return;
    }
    case "import": {
      const filename = args[0];
      if (!filename) err(line, "Import needs a file name — Titer has no file loop to take one from");
      const text = ctx.files[filename];
      if (text === undefined) err(line, `couldn't read "${filename}"`);
      const table = currentTable(ctx, line);
      const row = optInt(line, args[1], "Import's row", 1);
      const col = optInt(line, args[2], "Import's column", 0);
      const subcol = optInt(line, args[3], "Import's subcolumn", 1);
      const pos = cellPos(table.data!, table.tableType, row, col, subcol, line);
      const block = parseCsv(text).map((r) => r.map((c) => (c === "" ? null : c)));
      if (pos.r === -1) {
        // Row 0 is the title row, as in InsertData: the first line renames
        // columns, the rest go to the data rows — passing -1 to writeBlock
        // would drop the first CSV row (Round 2 Issue 57).
        const columns = [...table.data!.columns];
        block[0].forEach((value, j) => {
          if (value != null && value !== "" && pos.c + j < columns.length) columns[pos.c + j] = value;
        });
        const rest = block.slice(1);
        table.data = rest.length
          ? writeBlock({ ...table.data!, columns }, 0, pos.c, rest, table.tableType ?? "column")
          : { ...table.data!, columns };
      } else {
        table.data = writeBlock(table.data!, pos.r, pos.c, block, table.tableType ?? "column");
      }
      followChildren(ctx.doc, table.id);
      return;
    }
    case "exporttable": {
      const all = (args[0] ?? "").toLowerCase() === "all";
      const filename = all ? args[1] : args[0];
      if (all) {
        const tables = ctx.doc.rootOrder
          .map((id) => ctx.doc.nodes[id])
          .filter((n): n is ProjectNode => !!n && n.type === "table" && !!n.data);
        for (const table of tables) {
          // A bare file name writes under SetPath — but an empty SetPath is
          // no path at all: leaving dir as "" would write "/<table>.csv"
          // (Round 2 Issue 57), so it falls through to resolveFilePath,
          // which errors and names SetPath instead.
          const dir =
            filename?.includes("/") ? filename.slice(0, filename.lastIndexOf("/"))
            : filename !== undefined
              ? ctx.path === ""
                ? undefined
                : ctx.path
              : undefined;
          const path =
            dir !== undefined
              ? `${dir.replace(/\/$/, "")}/${table.name}.csv`
              : resolveFilePath(ctx, undefined, "csv", table.name, line);
          ctx.effects.push({ type: "write-text-file", path, text: tableToCsv(table.data!) });
        }
        return;
      }
      const table = currentTable(ctx, line);
      const path = resolveFilePath(ctx, filename, "csv", table.name, line);
      ctx.effects.push({ type: "write-text-file", path, text: tableToCsv(table.data!) });
      return;
    }
    case "setinfo": {
      const value = args[0];
      if (value === undefined) err(line, "SetInfo needs a value");
      const row = optInt(line, args[1], "SetInfo's row number", 1);
      const position = optInt(line, args[2], "SetInfo's position", 1);
      if (row < 1) err(line, "SetInfo's row number starts at 1");
      if (![0, 1, 2].includes(position)) err(line, "SetInfo's position is 0 (name), 1 (value) or 2 (notes)");
      const constants = infoSheetConstants(ctx);
      while (constants.length < row) constants.push({ id: newConstantId(), name: "", value: "" });
      const constant = constants[row - 1];
      if (position === 0) constant.name = value;
      else if (position === 1) constant.value = value;
      else constant.notes = `${constant.notes ?? ""}${value}`;
      return;
    }
    case "setvaluetoinfo": {
      const infoTable = reqInt(line, args[0], "SetValueToInfo's info table number");
      if (infoTable !== 1) err(line, `Titer has one info table — the info table number must be 1, not ${infoTable}`);
      const infoRow = reqInt(line, args[1], "SetValueToInfo's info row");
      const dataRow = reqInt(line, args[2], "SetValueToInfo's data row");
      const dataCol = reqInt(line, args[3], "SetValueToInfo's data column");
      const dataSubcol = optInt(line, args[4], "SetValueToInfo's data subcolumn", 1);
      if (infoRow < 1) err(line, "SetValueToInfo's info row starts at 1");
      const table = currentTable(ctx, line);
      const pos = cellPos(table.data!, table.tableType, dataRow, dataCol, dataSubcol, line);
      const value = cellTextAt(table.data!, pos.r, pos.c);
      const constants = infoSheetConstants(ctx);
      while (constants.length < infoRow) constants.push({ id: newConstantId(), name: "", value: "" });
      constants[infoRow - 1].value = value;
      return;
    }
    case "setgraphtitle": {
      const node = currentGraph(ctx, line);
      if (!args[0]) err(line, "SetGraphTitle needs a title");
      node.graphOptions = { ...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions, title: args[0] };
      return;
    }
    case "setxtitle":
    case "setytitle": {
      const node = currentGraph(ctx, line);
      if (!args[0]) err(line, `${name} needs a title`);
      node.graphOptions = {
        ...DEFAULT_GRAPH_OPTIONS,
        ...node.graphOptions,
        [lower === "setxtitle" ? "xLabel" : "yLabel"]: args[0],
      };
      return;
    }
    case "setaxistitle": {
      const node = currentGraph(ctx, line);
      const axis = (args[0] ?? "").toUpperCase();
      if (axis !== "X" && axis !== "Y") err(line, `SetAxisTitle needs X or Y, not "${args[0] ?? ""}"`);
      if (args[1] === undefined) err(line, "SetAxisTitle needs a title");
      node.graphOptions = {
        ...DEFAULT_GRAPH_OPTIONS,
        ...node.graphOptions,
        [axis === "X" ? "xLabel" : "yLabel"]: args[1],
      };
      return;
    }
    case "setaxislimits": {
      const node = currentGraph(ctx, line);
      const axis = (args[0] ?? "").toUpperCase();
      if (axis !== "X" && axis !== "Y") err(line, `SetAxisLimits needs X or Y, not "${args[0] ?? ""}"`);
      const min = reqNum(line, args[1], "SetAxisLimits' minimum");
      const max = reqNum(line, args[2], "SetAxisLimits' maximum");
      const step = args[3] === undefined ? undefined : reqNum(line, args[3], "SetAxisLimits' step");
      if (min >= max) err(line, `SetAxisLimits' minimum (${min}) isn't below its maximum (${max})`);
      if (args[4] !== undefined)
        log(ctx, "SetAxisLimits: axis segments aren't a Titer concept — the limits apply to the whole axis.");
      const key = axis === "X" ? "x" : "y";
      node.graphOptions = {
        ...DEFAULT_GRAPH_OPTIONS,
        ...node.graphOptions,
        [`${key}Min`]: min,
        [`${key}Max`]: max,
        ...(step === undefined ? {} : { [`${key}Step`]: step }),
      };
      return;
    }
    case "applycolorscheme": {
      const node = currentGraph(ctx, line);
      const wanted = args[0] ?? "";
      const palette =
        PALETTES.find((p) => p.name.toLowerCase() === wanted.toLowerCase()) ??
        PALETTES.find((p) => p.label.toLowerCase() === wanted.toLowerCase());
      if (!palette) err(line, `no color scheme "${wanted}" — available: ${PALETTES.map((p) => p.label).join(", ")}`);
      node.graphOptions = { ...DEFAULT_GRAPH_OPTIONS, ...node.graphOptions, palette: savedPalette(palette) };
      return;
    }
    case "exportpng":
    case "exportjpg":
    case "exportsvg":
    case "exporttif":
    case "exportbmp":
    case "exportpdf":
    case "exporteps": {
      const node = currentGraphOrFigure(ctx, line);
      const format: ExportFormat =
        lower === "exportpng"
          ? "png"
          : lower === "exportjpg"
            ? "jpeg"
            : lower === "exportsvg"
              ? "svg"
              : lower === "exporttif"
                ? "tif"
                : lower === "exportbmp"
                  ? "bmp"
                  : lower === "exportpdf"
                    ? "pdf"
                    : "eps";
      const ext = format === "jpeg" ? "jpg" : format;
      const dpi = optInt(line, args[1], "the resolution", 300);
      if (![100, 300, 600, 1200].includes(dpi))
        err(line, `resolution ${dpi} isn't one Prism offers — 100, 300, 600 or 1200`);
      let clear = false;
      let mode: "rgbhi" | "gray" | "mono" | undefined;
      for (const extra of args.slice(2)) {
        const flag = extra.toLowerCase();
        if (flag === "clear") clear = true;
        else if (flag === "compress" || flag === "lzw")
          log(ctx, `${extra}: compression isn't written — the file is uncompressed.`);
        else if (format === "tif" && ["rgblow", "rgbhi", "gray", "mono"].includes(flag)) {
          if (flag === "rgblow") {
            mode = "rgbhi";
            log(ctx, "RGBlow (256 colors) exports as RGBhi.");
          } else mode = flag as "rgbhi" | "gray" | "mono";
        } else if (format === "tif" && flag === "cmyk")
          err(line, "CMYK TIFFs need a color conversion Titer doesn't have — use RGBhi, GRAY or MONO");
        else err(line, `unexpected argument "${extra}" for ${name}`);
      }
      if (format === "svg" && args[1] !== undefined) log(ctx, "a resolution doesn't apply to SVG — ignored.");
      if (format === "eps" && args[1] !== undefined) log(ctx, "a resolution doesn't apply to EPS — ignored.");
      if (format === "jpeg" && clear) {
        clear = false;
        log(ctx, "CLEAR: JPEG has no transparency — exported on white.");
      }
      // PDF and EPS are drawn on white too (no transparency in either).
      if ((format === "pdf" || format === "eps") && clear) {
        clear = false;
        log(ctx, `CLEAR: ${format === "pdf" ? "PDF" : "EPS"} has no transparency — exported on white.`);
      }
      if (format === "tif" && mode === undefined) {
        mode = "rgbhi";
        log(ctx, "ExportTIF defaults to RGBhi (Prism's CMYK default needs a color conversion Titer doesn't have).");
      }
      const path = resolveFilePath(ctx, args[0], ext, node.name, line);
      // Titer's own export cap applies at render time and surfaces as a
      // script error, never a silent shrink.
      const size96 =
        node.type === "figure"
          ? {
              width: (node.figureSize?.widthIn ?? DEFAULT_FIGURE_SIZE.widthIn) * 96,
              height: (node.figureSize?.heightIn ?? DEFAULT_FIGURE_SIZE.heightIn) * 96,
            }
          : {
              width: node.graphOptions?.width ?? DEFAULT_GRAPH_OPTIONS.width,
              height: node.graphOptions?.height ?? DEFAULT_GRAPH_OPTIONS.height,
            };
      // Vector formats are DPI-less (drawn at 96 DPI): no size cap. A
      // PDF's resolution only matters if the graph falls back to raster.
      if (format !== "svg" && format !== "pdf" && format !== "eps") {
        const largest = largestAt(size96, dpi);
        if (largest.width < size96.width)
          err(
            line,
            `at ${dpi} DPI, the largest graph Titer exports is ${largest.width} × ${largest.height} px — choose a lower resolution, or make the graph smaller`,
          );
      }
      ctx.effects.push({
        type: "export-graph",
        graphId: node.id,
        format,
        dpi,
        clear,
        ...(mode === undefined ? {} : { mode }),
        path,
      });
      return;
    }
    case "exportallpdf": {
      // Every graph and layout in the project, one vector PDF each, named
      // after the sheet — a folder argument, or SetPath, is where they
      // land. Each sheet is its own effect, so a sheet that fails to
      // render warns in the log and the batch continues with the rest.
      const folderArg = args[0];
      if (args.length > 1) err(line, `unexpected argument "${args[1]}" for ${name}`);
      let folder = folderArg ?? ctx.path;
      if (folderArg !== undefined && !folder.startsWith("/")) {
        if (!ctx.path)
          err(
            line,
            `ExportAllPDF's folder "${folder}" is relative and no SetPath is set — give an absolute folder, or set one with SetPath`,
          );
        folder = `${ctx.path.replace(/\/$/, "")}/${folder}`;
      }
      if (!folder)
        err(line, `ExportAllPDF needs a folder, or a SetPath — e.g. ExportAllPDF "/Users/you/Desktop"`);
      const sheets = sheetList(ctx.doc).filter((s) => s.kind === "graph" || s.kind === "figure");
      if (!sheets.length) err(line, "ExportAllPDF found no graphs or layouts to export");
      const used = new Set<string>();
      for (const sheet of sheets) {
        const sheetNode = ctx.doc.nodes[sheet.id]!;
        const stem = sanitizeSheetStem(sheetNode.name, sheet.kind === "graph" ? "graph" : "figure");
        let fileName = `${stem}.pdf`;
        let n = 2;
        while (used.has(fileName)) {
          fileName = `${stem} (${n}).pdf`;
          n++;
        }
        used.add(fileName);
        ctx.effects.push({
          type: "export-graph",
          graphId: sheet.id,
          format: "pdf",
          dpi: 300,
          clear: false,
          path: `${folder.replace(/\/$/, "")}/${fileName}`,
          sheetName: sheetNode.name,
        });
      }
      return;
    }
    case "openoutput": {
      if (ctx.output) {
        ctx.effects.push({ type: "write-text-file", path: ctx.outputPath!, text: `${ctx.output.join("\n")}\n` });
        log(ctx, "OpenOutput: the previous output file was closed first.");
      }
      const path = resolveFilePath(ctx, args[0], "txt", "Script output", line);
      ctx.output = [];
      ctx.outputPath = path;
      const delimiter = args[1];
      if (delimiter !== undefined) ctx.outputDelimiter = delimiter.replaceAll("\\t", "\t").replaceAll("\\n", "\n");
      return;
    }
    case "closeoutput": {
      if (!ctx.output) {
        log(ctx, "CloseOutput: no output file is open.");
        return;
      }
      if (ctx.output.length)
        ctx.effects.push({ type: "write-text-file", path: ctx.outputPath!, text: `${ctx.output.join("\n")}\n` });
      ctx.output = null;
      ctx.outputPath = null;
      return;
    }
    case "wtitle": {
      requireOutput(ctx, line).push(ctx.doc.projectName ?? "Untitled");
      return;
    }
    case "wversion": {
      requireOutput(ctx, line).push(`Titer ${version}`);
      return;
    }
    case "wtext": {
      if (!args[0]) err(line, "WText needs text to write");
      requireOutput(ctx, line).push(args.join(" "));
      return;
    }
    case "wdate": {
      requireOutput(ctx, line).push(new Date().toISOString().slice(0, 10));
      return;
    }
    case "wcell": {
      const table = currentTable(ctx, line);
      const row = reqInt(line, args[0], "WCell's row");
      const col = reqInt(line, args[1], "WCell's column");
      const pos = cellPos(table.data!, table.tableType, row, col, 1, line);
      requireOutput(ctx, line).push(cellTextAt(table.data!, pos.r, pos.c));
      return;
    }
    case "wcol": {
      const table = currentTable(ctx, line);
      const col = reqInt(line, args[0], "WCol's column");
      const pos = cellPos(table.data!, table.tableType, 1, col, 1, line);
      const out = requireOutput(ctx, line);
      for (const r of table.data!.rows) out.push(r[pos.c] ?? "");
      return;
    }
    case "wrow": {
      const table = currentTable(ctx, line);
      const row = reqInt(line, args[0], "WRow's row");
      if (row < 1 || row > table.data!.rows.length) err(line, `row ${row} doesn't exist`);
      requireOutput(ctx, line).push(table.data!.rows[row - 1].map((c) => c ?? "").join(ctx.outputDelimiter));
      return;
    }
    case "wsheet": {
      const table = currentTable(ctx, line);
      const out = requireOutput(ctx, line);
      const delimiter = ctx.outputDelimiter;
      out.push(table.data!.columns.join(delimiter));
      for (const r of table.data!.rows) out.push(r.map((c) => c ?? "").join(delimiter));
      return;
    }
    default:
      err(line, `unknown command "${name}"`);
  }
}

function execBlock(statements: Statement[], ctx: Ctx) {
  for (const st of statements) {
    if (st.kind === "loop") {
      if (st.mode === "count") {
        for (let i = 1; i <= st.count; i++) {
          ctx.loopStack.push(i);
          execBlock(st.body, ctx);
          ctx.loopStack.pop();
        }
      } else {
        const sheets = sheetList(ctx.doc);
        sheets.forEach((sheet, i) => {
          ctx.loopStack.push(i + 1);
          ctx.sheetName = sheet.name;
          ctx.current = { kind: sheet.kind, id: sheet.id };
          execBlock(st.body, ctx);
          ctx.loopStack.pop();
        });
        ctx.sheetName = null;
      }
    } else {
      execCommand(st, ctx);
    }
  }
}

/** Runs a script against a project. `files` holds the text of every file an
 *  `Import` names (the dialog reads them before running, so this stays pure).
 *  On error the run stops and the returned doc is the input, unchanged. */
export function runScript(input: ScriptDoc, text: string, files: Record<string, string> = {}): ScriptResult {
  let statements: Statement[];
  try {
    statements = parseScript(text);
  } catch (err) {
    return { doc: input, log: [err instanceof Error ? err.message : String(err)], effects: [], stopped: true };
  }
  const doc = structuredClone(input);
  const active = input.activeNodeId ? input.nodes[input.activeNodeId] : undefined;
  const ctx: Ctx = {
    doc,
    log: [],
    effects: [],
    path: "",
    // Scripts address sheets, and a flow sample is not a script-addressable
    // sheet (seq 441): an active sample falls back to the first root item.
    current:
      active && active.type !== "sample"
        ? { kind: active.type, id: active.id }
        : { kind: "table", id: doc.rootOrder[0] ?? null },
    output: null,
    outputPath: null,
    outputDelimiter: "\t",
    clipboard: null,
    loopStack: [],
    sheetName: null,
    warnedFileVars: false,
    files,
  };
  try {
    execBlock(statements, ctx);
  } catch (err) {
    if (err instanceof ScriptError) return { doc: input, log: [...ctx.log, err.message], effects: [], stopped: true };
    throw err;
  }
  if (ctx.output) {
    if (ctx.output.length)
      ctx.effects.push({ type: "write-text-file", path: ctx.outputPath!, text: `${ctx.output.join("\n")}\n` });
    log(ctx, "OpenOutput: the output file was closed at the end of the run.");
  }
  return { doc, log: ctx.log, effects: ctx.effects, dialogTitle: ctx.dialogTitle, stopped: false };
}
