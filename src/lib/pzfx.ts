// Import GraphPad Prism `.pzfx` files (the XML format Prism 6 and later write).
//
// Clean-room: written from the file format as documented by the open-source
// `pzfx` (R, MIT) and `pypzfx` (Python, MIT) readers and their `.pzfx` test
// files — never from Prism's own code. Only the data tables are in the file's
// readable XML: analyses, graphs and layouts live in a compressed `<Template>`
// blob Titer doesn't read, so an import brings in the tables and the info
// sheets; analyses and graphs are rebuilt in Titer.
//
// What maps where (Prism `TableType` → Titer table):
//   OneWay      → Column    (each Y column is a group)
//   TwoWay      → Grouped   when the Y values are replicates (groups = Y columns,
//                 replicates = subcolumns); otherwise Column, with the summary
//                 subcolumns named (MEAN, SD, N…) and a warning — summary values
//                 are not raw replicates, so they must not be analysed as if they were.
//                 An empty or missing YFormat is never assumed to be replicates:
//                 it imports as Column with a warning (FF-F7 — a mean/SD/N table
//                 with no YFormat would otherwise be analysed as raw replicates,
//                 giving wrong F/p/N).
//   XY          → XY        (X, then one Y series per subcolumn)
//   Survival    → Survival  (X = time, Y = event codes 1/0 per group; the survival
//                 graph and the survival analysis apply to it)
//   Contingency → Contingency
//   PartsOfWhole→ Column    (one Y column, rows named by the row titles)
//   Nested      → NO verified marker (see below): a Prism nested table is
//                 one of Prism's eight formats (Prism 8+), with replicates
//                 stacked into subcolumns, but no public .pzfx file or reader
//                 shows a distinct TableType/YFormat value for it — checked
//                 2026-11-10: no nested file in test-corpus/ or tests/testdata/,
//                 and the open-source readers (R pzfx 0.3.1, pypzfx) know no
//                 "Nested" TableType. A OneWay/replicates table therefore
//                 imports as Column (today's behaviour, unchanged) and the
//                 user converts it to Nested by hand — do NOT auto-convert
//                 OneWay/replicates to nested on a heuristic, a plain
//                 replicates Column table is far more common than a nested one.
//                 If a distinct marker is ever verified, map it here directly.
//   HugeTable → the same as Table: Prism writes a table as `<HugeTable>`
//                 instead of `<Table>` once it passes 52 subcolumns in a
//                 data set or 104 data sets (R pzfx 0.2.0 NEWS; pypzfx
//                 reads both tags the same way), and the children are
//                 identical (Title, RowTitlesColumn, XColumn,
//                 XAdvancedColumn, YColumn…), so a HugeTable imports
//                 through the same path as a Table — no new table model.
//                 A grouped table that arrives this way can hold more
//                 than Titer's 20-replicate creation cap (GROUPED_LIMITS):
//                 that cap is enforced only when creating tables
//                 (extract-and-rearrange, SetYReplicates), never on
//                 imported data, so the replicates are kept as Prism
//                 wrote them. The import warns that the table was a
//                 HugeTable, with its subcolumn count, so the size is
//                 visible rather than silent.
// A struck-through value (`<d Excluded="1">`) becomes a Titer excluded cell.
// A `.prism` file (Prism 10's newer format) is not `.pzfx` and is not imported.

import type { ProjectFilePayload } from "./project-file";
import type { ProjectNode, TableData, TableErrorFormat, TableType } from "../store/types";
import { newConstantId, readInfoConstants } from "./info-sheets";

export interface PzfxIssue {
  severity: "error" | "warning";
  message: string;
}

export interface PzfxImport {
  project: ProjectFilePayload;
  /** Tables imported, in file order. */
  tables: string[];
  /** Info sheets imported, in file order. */
  infoSheets: string[];
  issues: PzfxIssue[];
  /** Graph-regen plans, when the caller computed them (see
   *  `planPzfxGraphs` in `src/lib/prism-graph-regen.ts`). */
  graphPlans?: import("./prism-graph-regen").GraphPlan[];
}

// ── A small XML reader ───────────────────────────────────────────────────
// Only what a `.pzfx` file needs: elements, attributes, text, comments, CDATA
// and entities. No dependency, so it runs in the app and in the tests alike.

interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text directly inside this element (formatting children aside). */
  text: string;
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

function parseXml(text: string): XmlNode {
  let i = 0;
  const n = text.length;
  const fail = (why: string): never => {
    throw new Error(`Not a valid .pzfx file (${why}).`);
  };
  const skipMisc = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith("<?", i)) {
        const end = text.indexOf("?>", i + 2);
        if (end < 0) fail("unclosed processing instruction");
        i = end + 2;
      } else if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) fail("unclosed comment");
        i = end + 3;
      } else if (text.startsWith("<!DOCTYPE", i)) {
        const end = text.indexOf(">", i);
        if (end < 0) fail("unclosed doctype");
        i = end + 1;
      } else break;
    }
  };
  const parseElement = (): XmlNode => {
    // At `<`.
    if (text[i] !== "<") fail("expected an element");
    i++;
    const tag = /^[A-Za-z_][\w:.-]*/.exec(text.slice(i))?.[0];
    if (tag === undefined) throw new Error("Not a valid .pzfx file (bad element name).");
    i += tag.length;
    const attrs: Record<string, string> = {};
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text.startsWith("/>", i)) {
        i += 2;
        return { tag, attrs, children: [], text: "" };
      }
      if (text[i] === ">") {
        i++;
        break;
      }
      if (i >= n) fail("unclosed tag");
      const name = /^[A-Za-z_][\w:.-]*/.exec(text.slice(i))?.[0];
      if (name === undefined) throw new Error("Not a valid .pzfx file (bad attribute name).");
      i += name.length;
      while (i < n && /\s/.test(text[i])) i++;
      let value = "";
      if (text[i] === "=") {
        i++;
        while (i < n && /\s/.test(text[i])) i++;
        const quote = text[i];
        if (quote !== '"' && quote !== "'") fail("bad attribute value");
        i++;
        const end = text.indexOf(quote, i);
        if (end < 0) fail("unclosed attribute value");
        value = decodeEntities(text.slice(i, end));
        i = end + 1;
      }
      attrs[name] = value;
    }
    const children: XmlNode[] = [];
    let textParts = "";
    for (;;) {
      if (i >= n) fail(`unclosed <${tag}>`);
      if (text.startsWith(`</${tag}`, i)) {
        const end = text.indexOf(">", i);
        if (end < 0) fail("unclosed closing tag");
        i = end + 1;
        return { tag, attrs, children, text: decodeEntities(textParts) };
      }
      if (text.startsWith("<!--", i)) {
        const end = text.indexOf("-->", i + 4);
        if (end < 0) fail("unclosed comment");
        i = end + 3;
      } else if (text.startsWith("<![CDATA[", i)) {
        const end = text.indexOf("]]>", i + 9);
        if (end < 0) fail("unclosed CDATA section");
        textParts += text.slice(i + 9, end);
        i = end + 3;
      } else if (text[i] === "<") {
        children.push(parseElement());
      } else {
        const next = text.indexOf("<", i);
        textParts += text.slice(i, next < 0 ? n : next);
        i = next < 0 ? n : next;
      }
    }
  };
  skipMisc();
  const root = parseElement();
  skipMisc();
  return root;
}

/** An element's text, including any formatting children it wraps (`<Title>` may
 *  hold a `<TextAlign>`). Titles keep their EXACT text — Prism titles can
 *  carry meaningful trailing spaces (`XY `, `0nM `) and duplicate names, and
 *  the reader must not trim or rename them (BUG-4/BUG-7): the .prism import
 *  preserves them, and the exported .pzfx file holds them verbatim, so a
 *  .pzfx round-trip that renames them changes analysis labels and hashes.
 *  Data `<d>` values keep the trimmed read below: the number normalizer's
 *  anchored regexes need clean values, and only the RowTitlesColumn's `<d>`
 *  values are titles. */
const rawChildText = (node: XmlNode): string => {
  let out = node.text;
  for (const child of node.children) out += rawChildText(child);
  return out;
};

/**
 * A title as Titer stores it — the same rule the `.prism` reader applies
 * (`cleanText` in src/lib/prism.ts), so the two importers agree and a
 * `.prism` export→reimport is identical. Prism writes multi-line labels
 * with a carriage return as the line break (real files: `"+Barb\r\n+Oxy"`,
 * `"Proton\r\nLeak"` — the old comment here claimed no `<Title>` holds a
 * newline, which the battery corpus disproves); Titer labels are
 * single-line, so the break becomes one space. A title that is only
 * whitespace becomes "" — the caller's fallback applies ("X", "Y",
 * "Group"). Trailing spaces are PRESERVED (BUG-4/BUG-7): only line breaks
 * collapse, nothing is trimmed.
 */
const cleanTitle = (value: string): string => {
  const collapsed = value.replace(/\s*(\r\n|\r|\n)\s*/g, " ");
  return collapsed.trim() === "" ? "" : collapsed;
};

const childText = (node: XmlNode): string => rawChildText(node).trim();

const childrenNamed = (node: XmlNode, tag: string) => node.children.filter((c) => c.tag === tag);
const firstChild = (node: XmlNode, tag: string) => childrenNamed(node, tag)[0];

// ── Subcolumns ───────────────────────────────────────────────────────────

/** One subcolumn's values, as typed, with the struck-through (excluded) rows. */
interface Subcolumn {
  values: (string | null)[];
  excluded: Set<number>;
}

function readSubcolumn(node: XmlNode, raw = false): Subcolumn {
  const values: (string | null)[] = [];
  const excluded = new Set<number>();
  for (const d of childrenNamed(node, "d")) {
    const value = raw ? rawChildText(d) : childText(d);
    values.push(value === "" ? null : value);
    if (d.attrs["Excluded"] === "1") excluded.add(values.length - 1);
  }
  return { values, excluded };
}

/** A column's title and subcolumns. */
interface PzfxColumn {
  title: string;
  subcolumns: Subcolumn[];
}

function readColumn(node: XmlNode, rawValues = false): PzfxColumn {
  const titleNode = firstChild(node, "Title");
  return {
    title: titleNode ? cleanTitle(rawChildText(titleNode)) : "",
    subcolumns: childrenNamed(node, "Subcolumn").map((s) => readSubcolumn(s, rawValues)),
  };
}

// How a column's subcolumns are named in the imported table, by its format.
const SUBCOLUMN_SUFFIXES: Record<string, string[]> = {
  replicates: [],
  SDN: ["_MEAN", "_SD", "_N"],
  SEN: ["_MEAN", "_SEM", "_N"],
  CVN: ["_MEAN", "_CV", "_N"],
  SD: ["_MEAN", "_SD"],
  SE: ["_MEAN", "_SE"],
  CV: ["_MEAN", "_CV"],
  "low-high": ["_MEAN", "_PLUSERROR", "_MINUSERROR"],
  "upper-lower-limits": ["_MEAN", "_UPPERLIMIT", "_LOWERLIMIT"],
};

/** A `<d>` value that proves the file's decimal separator is a comma: a comma
 *  decimal whose fraction is not exactly three digits (`0,5`, `3,75`,
 *  `0,9375`), or a comma decimal with an exponent (`4,096e+007`). A `N,NNN`
 *  value alone proves nothing — it is a decimal (`1,875` = 1.875 in the real
 *  SaturationBinding.pzfx) as readily as a thousands separator. */
const COMMA_DECIMAL_EVIDENCE = /^-?\d+,\d{1,2}$|^-?\d+,\d{4,}$|^-?\d+,\d+[eE][+-]?\d+$/;
/** A `<d>` value that proves the file's decimal separator is a dot: a dot
 *  decimal (`1.5`, `8887.`, `5.22929500342231`), exponent included. */
const DOT_DECIMAL_EVIDENCE = /^-?\d+\.\d*([eE][+-]?\d+)?$|^-?\.\d+([eE][+-]?\d+)?$/;
/** A thousands-grouped value: `1,000`, `1,000,000`, `1,000.5` — groups of
 *  exactly three digits after the first comma. */
const GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/;

/** Every `<d>` text in the parsed file (data values and row titles alike). */
function allDValues(node: XmlNode, out: string[] = []): string[] {
  if (node.tag === "d") out.push(childText(node));
  for (const child of node.children) allDValues(child, out);
  return out;
}

/**
 * Whether this file writes thousands separators (`1,000` = 1000). Decided
 * from the file, never from one string alone: dot-decimal evidence anywhere
 * in the file (`1.5`, `8887.`) with no comma-decimal evidence (`0,5`,
 * `4,096e+007`) means the file's decimals use dots, so a comma can only be
 * a grouping separator. With no evidence either way — or any comma-decimal
 * evidence at all — commas stay decimals: that is the only reading any real
 * .pzfx file has yet shown (Prism writes large values ungrouped in both
 * locales: `8887.`, `5120000`), and a `N,NNN` string in a real file is a
 * decimal (`1,875`, `4,096` in the binding corpora).
 */
function usesGroupingSeparators(root: XmlNode): boolean {
  let commaDecimal = false;
  let dotDecimal = false;
  for (const value of allDValues(root)) {
    if (COMMA_DECIMAL_EVIDENCE.test(value)) commaDecimal = true;
    else if (DOT_DECIMAL_EVIDENCE.test(value)) dotDecimal = true;
  }
  return dotDecimal && !commaDecimal;
}

/**
 * `1,5` (comma decimal) → `1.5`; anything else stays as typed — except in a
 * file whose own numbers prove dot decimals, where a grouped `1,000` is a
 * thousands separator, not a decimal comma, and the commas are stripped
 * (`1,000` → `1000`) instead of turning it into `1.000` (a 1000× error).
 * A bare `1,5` in such a file still becomes `1.5`: only the grouped shape
 * is reinterpreted, so nothing else changes.
 */
function normalizeNumber(value: string | null, groupingSeparators: boolean): string | null {
  if (value === null) return null;
  if (groupingSeparators && GROUPED_NUMBER.test(value)) return value.replace(/,/g, "");
  if (/^-?\d+,\d+$/.test(value)) return value.replace(",", ".");
  return value;
}

// Loop-based max over a width-scaled collection: Math.max(...arr) spreads
// the array onto the call stack and throws RangeError once it passes ~100k
// elements (BUG-11: a 288k-subcolumn .pzfx blew the stack in importTable).
// Never spread a width-scaled array into Math.max/Math.min.
function maxOf(values: Iterable<number>, floor = 0): number {
  let m = floor;
  for (const v of values) if (v > m) m = v;
  return m;
}

function subcolumnNames(title: string, format: string, count: number): string[] {
  const base = title === "" ? "Y" : title;
  if (count === 1) return [base];
  const suffixes = SUBCOLUMN_SUFFIXES[format];
  if (suffixes && suffixes.length === count) return suffixes.map((s) => `${base}${s}`);
  return Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
}

// ── One table ────────────────────────────────────────────────────────────

interface ImportedTable {
  node: ProjectNode;
  warnings: string[];
}

const genId = (type: string) => `${type}_${Math.random().toString(36).slice(2, 10)}`;

function importTable(table: XmlNode, issues: PzfxIssue[], groupingSeparators: boolean): ImportedTable | null {
  const warnings: string[] = [];
  const titleNode = firstChild(table, "Title");
  const name = titleNode ? cleanTitle(rawChildText(titleNode)) : "";
  const tableType = table.attrs["TableType"] ?? "";
  const xFormat = table.attrs["XFormat"] ?? "";
  const yFormat = table.attrs["YFormat"] ?? "";
  const displayName = name === "" ? "Untitled table" : `“${name}”`;

  const rowTitles = firstChild(table, "RowTitlesColumn");
  // Row titles go through the same single-line rule as the `.prism` reader
  // (cleanText on its rowTitles): a multi-line row title collapses, and a
  // whitespace-only one becomes null, so a `.prism` export→reimport reads
  // the same titles back. Numeric-looking titles (e.g. `0,0003663697194`)
  // are untouched — only line breaks collapse, no number normalization.
  const rowTitleValues = rowTitles
    ? (readColumn(rowTitles, true).subcolumns[0]?.values ?? []).map((v) => {
        if (v === null) return null;
        const cleaned = cleanTitle(v);
        return cleaned === "" ? null : cleaned;
      })
    : [];
  let hasRowTitles = rowTitleValues.some((v) => v !== null && v !== "");

  const xColumns = childrenNamed(table, "XColumn").map((c) => readColumn(c));
  const xAdvanced = firstChild(table, "XAdvancedColumn");
  const yColumns = childrenNamed(table, "YColumn").map((c) => readColumn(c));
  if (yColumns.length === 0) {
    issues.push({ severity: "warning", message: `${displayName} holds no data columns. It was left out.` });
    return null;
  }

  // The X series: its first subcolumn is X; a second (XFormat "error") is the X
  // error, kept as its own series so no data is silently dropped.
  let xValues: (string | null)[] = [];
  let xErrorValues: (string | null)[] | null = null;
  let xExcluded: Set<number> = new Set();
  let xErrorExcluded: Set<number> = new Set();
  let xName = "X";
  if (xColumns.length > 0) {
    const x = xColumns[0];
    xName = x.title === "" ? "X" : x.title;
    xValues = x.subcolumns[0]?.values ?? [];
    xExcluded = x.subcolumns[0]?.excluded ?? new Set();
    if (x.subcolumns.length > 1) {
      xErrorValues = x.subcolumns[1].values;
      xErrorExcluded = x.subcolumns[1].excluded ?? new Set();
      warnings.push(
        `${displayName}: the X error values were imported as a “${xName} error” series — Titer XY tables hold one X column.`,
      );
    }
  }
  // A date X whose dates survive import: as row titles when the table has
  // none of its own, else in a dedicated column next to X — never dropped.
  let dateColumn: { name: string; values: (string | null)[]; excluded: Set<number> } | null = null;
  if (xFormat === "date") {
    if (xAdvanced) {
      const dateSub = readColumn(xAdvanced).subcolumns[0];
      const dates = dateSub?.values ?? [];
      const dateExcluded = dateSub?.excluded ?? new Set<number>();
      const hasAnyDate = dates.some((v) => v !== null && v !== "");
      let datesKeptAsRowTitles = false;
      if (!hasRowTitles) {
        // The character dates name the rows, as Prism shows them.
        for (let r = 0; r < dates.length; r++) {
          if (dates[r] !== null) {
            rowTitleValues[r] = dates[r];
            datesKeptAsRowTitles = true;
          }
        }
      } else if (hasAnyDate) {
        // The row titles are the rows' names, so the dates get their own
        // column instead of being dropped: the numeric X stays the X axis
        // (years since the first date, as Prism stores it) and the dates
        // sit beside it as text, which analyses and graphs skip. A
        // struck-through date stays struck through: its Excluded marker
        // rides along, the same as the X / X error columns (#20).
        dateColumn = { name: `${xName} (date)`, values: dates, excluded: dateExcluded };
      }
      if (datesKeptAsRowTitles) {
        warnings.push(`${displayName}: the X values are dates; the dates were kept as row titles.`);
      } else if (dateColumn) {
        warnings.push(
          `${displayName}: the X values are dates; the existing row titles were kept and the dates were kept in a “${dateColumn.name}” column.`,
        );
      } else {
        warnings.push(`${displayName}: the X values are dates; they were imported as numbers.`);
      }
      // The dates above may have filled previously-empty row titles.
      hasRowTitles = rowTitleValues.some((v) => v !== null && v !== "");
    } else {
      warnings.push(`${displayName}: the X values are dates; they were imported as numbers.`);
    }
  }

  // Titer columns: [Title, ...data]. Each entry: its name, values per row, and
  // which rows are excluded in it.
  interface ImportColumn {
    name: string;
    values: (string | null)[];
    excluded: Set<number>;
  }
  const columns: ImportColumn[] = [];
  const pushColumn = (name: string, sub: Subcolumn) => {
    columns.push({ name, values: sub.values.map((v) => normalizeNumber(v, groupingSeparators)), excluded: sub.excluded });
  };

  let titerType: TableType;
  let groups: number | undefined;
  let replicates: number | undefined;
  /** The table's error format, from its YFormat: a summary table's error
   *  subcolumns are SD (SDN/SD) or SEM (SEN/SE); a replicates table carries
   *  no entered error values, so it records none (reads as SEM). */
  const errorFormat: TableErrorFormat | undefined =
    yFormat === "SDN" || yFormat === "SD" ? "sd" : yFormat === "SEN" || yFormat === "SE" ? "sem" : undefined;
  // Only an explicit "replicates" YFormat is replicates. An empty or missing
  // YFormat must not default to replicates: a summary table (mean/SD/N) whose
  // YFormat wasn't recorded would otherwise import as grouped replicates,
  // and a group comparison would treat the means as raw values (FF-F7).
  const isGroupedReplicates =
    tableType === "TwoWay" && yFormat === "replicates";
  if (tableType === "OneWay" || tableType === "PartsOfWhole" || tableType === "Contingency") {
    titerType = tableType === "Contingency" ? "contingency" : "column";
    for (const y of yColumns) {
      const names = subcolumnNames(y.title, yFormat, y.subcolumns.length);
      y.subcolumns.forEach((sub, i) => pushColumn(names[i], sub));
      if (y.subcolumns.length > 1 && yFormat === "replicates") {
        warnings.push(
          `${displayName}: “${y.title}” holds replicate subcolumns; each replicate was imported as its own column.`,
        );
      }
    }
  } else if (tableType === "TwoWay" && isGroupedReplicates) {
    titerType = "grouped";
    const counts = yColumns.map((y) => y.subcolumns.length);
    groups = yColumns.length;
    replicates = maxOf(counts);
    // A grouped table's columns are "Group:Y1"…, so a group name must be
    // colon-free — seriesKeyOf splits at the first ":" and a title like
    // "1:10" would become "1:10:Y1" (group "1", its data wiped on reload) —
    // and a ragged Y column leaves its group short of subcolumns. So:
    // sanitize ":", and pad every group to `replicates` subcolumns. A group
    // name may REPEAT, though: two Y columns titled "Group" are two groups,
    // and renaming the second would break the round-trip — the .prism import
    // keeps the duplicate, and the loader keeps it too (groups are runs,
    // not names).
    // Loop, not Math.max(...flatMap(...)): the spread blows the stack on
    // very wide files (BUG-11) and the flatMap builds a throwaway array.
    let rowLen = rowTitleValues.length;
    for (const y of yColumns) for (const s of y.subcolumns) if (s.values.length > rowLen) rowLen = s.values.length;
    const emptySubcolumn = (): Subcolumn => ({ values: Array<string | null>(rowLen).fill(null), excluded: new Set() });
    const reps = replicates;
    yColumns.forEach((y) => {
      const group = (y.title === "" ? "Group" : y.title).replace(/:/g, "-");
      const subs = [...y.subcolumns];
      while (subs.length < reps) subs.push(emptySubcolumn());
      subs.forEach((sub, i) => pushColumn(`${group}:Y${i + 1}`, sub));
    });
  } else if (tableType === "TwoWay") {
    // Summary values (mean, SD, N…) — not raw replicates. Keep them, named, and
    // say so: running a group comparison on them as if they were replicates
    // would be wrong.
    titerType = "column";
    for (const y of yColumns) {
      const names = subcolumnNames(y.title, yFormat, y.subcolumns.length);
      y.subcolumns.forEach((sub, i) => pushColumn(names[i], sub));
    }
    // An empty YFormat records no format at all, so the subcolumns can't be
    // named as summaries — say so plainly instead of guessing "mean and error".
    warnings.push(
      yFormat === ""
        ? `${displayName}: the Y format wasn't recorded (empty YFormat), so the subcolumns were imported as named columns, not replicates — don't run group comparisons on them as if they were.`
        : `${displayName}: the values are summaries (${yFormat}), not raw replicates — don't run group comparisons on them as if they were.`,
    );
  } else if (tableType === "XY" || tableType === "Survival") {
    titerType = tableType === "Survival" ? "survival" : "xy";
    if (xValues.length > 0 || xColumns.length > 0) {
      // A struck-through X value (`Excluded="1"`) stays excluded: readSubcolumn
      // already parsed it into the X subcolumn's excluded set, and dropping it
      // here would turn an excluded point into active data.
      columns.push({ name: xName, values: xValues.map((v) => normalizeNumber(v, groupingSeparators)), excluded: xExcluded });
      if (xErrorValues) {
        columns.push({ name: `${xName} error`, values: xErrorValues.map((v) => normalizeNumber(v, groupingSeparators)), excluded: xErrorExcluded });
      }
    }
    for (const y of yColumns) {
      const names = subcolumnNames(y.title, yFormat, y.subcolumns.length);
      y.subcolumns.forEach((sub, i) => pushColumn(names[i], sub));
    }
    if (tableType === "Survival") {
      warnings.push(
        `${displayName}: imported as a Survival table (time in X, event codes 1 = event, 0 = censored in each group) — the survival analysis and graph apply to it.`,
      );
    }
  } else {
    titerType = "column";
    for (const y of yColumns) {
      const names = subcolumnNames(y.title, yFormat, y.subcolumns.length);
      y.subcolumns.forEach((sub, i) => pushColumn(names[i], sub));
    }
    warnings.push(`${displayName}: table type “${tableType}” isn't one Titer knows; it was imported as a Column table.`);
  }

  if (table.tag === "HugeTable") {
    // Prism's tag for a table past 52 subcolumns per data set / 104 data
    // sets: the same shape as a Table, so it imported through the same
    // path — say so, with the table type it became, rather than silently
    // treating it as an ordinary table.
    const subcolumns = maxOf(yColumns.map((y) => y.subcolumns.length));
    const typeName =
      titerType === "grouped"
        ? "Grouped"
        : titerType === "xy"
          ? "XY"
          : titerType === "survival"
            ? "Survival"
            : titerType === "contingency"
              ? "Contingency"
              : "Column";
    warnings.push(
      `${displayName} was a HugeTable in Prism (${subcolumns} subcolumns per data set) — imported as a ${typeName} table with all values kept.`,
    );
  }

  if (dateColumn) {
    // Next to X for XY/Survival (after X and its error, if any); first among
    // the data columns otherwise, since those types drop X entirely.
    let at = 0;
    if (titerType === "xy" || titerType === "survival") {
      at = Math.min((xColumns.length > 0 ? 1 : 0) + (xErrorValues ? 1 : 0), columns.length);
    }
    let name = dateColumn.name;
    for (let n = 2; columns.some((c) => c.name === name); n++) name = `${dateColumn.name} ${n}`;
    columns.splice(at, 0, { ...dateColumn, name });
  }

  // No dedup here, deliberately: Prism lets two Y columns share a title
  // (and an X title can match a Y title), and the .prism import preserves
  // those duplicates — the table model holds them, analyses run on them,
  // and renaming them on read changes analysis labels and hashes
  // (BUG-4: `MitoFactory` → `MitoFactory 2`). The one place uniqueness
  // is structural is grouped GROUP names (deduped above, where the group
  // name is the column-name prefix); plain column duplicates stay exact.
  // (The old FF-F9 rename lived here; it was the bug.)

  const rowCount = maxOf(columns.map((c) => c.values.length), rowTitleValues.length);
  if (rowCount === 0 || columns.length === 0) {
    issues.push({ severity: "warning", message: `${displayName} holds no data. It was left out.` });
    return null;
  }
  const data: TableData = {
    columns: ["Title", ...columns.map((c) => c.name)],
    rows: Array.from({ length: rowCount }, (_, r) => [
      hasRowTitles ? (rowTitleValues[r] ?? null) : null,
      ...columns.map((c) => c.values[r] ?? null),
    ]),
    ...(groups !== undefined && replicates !== undefined ? { groups, replicates } : {}),
    // The table's error format, from its YFormat: a summary table's error
    // subcolumns are SD (SDN/SD) or SEM (SEN/SE); a replicates table carries
    // no entered error values, so it records none (reads as SEM).
    ...(errorFormat ? { errorFormat } : {}),
    excluded: Array.from(
      new Set(
        columns.flatMap((c, ci) => [...c.excluded].map((r) => `${r},${ci + 1}`)),
      ),
    ),
  };
  if (data.excluded!.length === 0) delete data.excluded;

  const node: ProjectNode = {
    id: genId("table"),
    type: "table",
    name: name === "" ? "Imported table" : name,
    parentId: null,
    tableType: titerType,
    data,
  };
  return { node, warnings };
}

// ── The file ─────────────────────────────────────────────────────────────

/** The XML namespace a real GraphPad Prism file declares. */
const PRISM_XML_NS = "http://graphpad.com/prism/Prism.htm";

export function parsePzfx(text: string): PzfxImport {
  let root: XmlNode;
  try {
    root = parseXml(text);
  } catch (err) {
    return {
      project: { nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: null },
      tables: [],
      infoSheets: [],
      issues: [{ severity: "error", message: err instanceof Error ? err.message : "Not a valid .pzfx file." }],
    };
  }
  // Prism 8 writes some .pzfx files wrapped in its own XSL stylesheet: the
  // root is <xsl:stylesheet> and the real file is the nested
  // <GraphPadPrismFile> child. Descend into that child (a direct child
  // only — the xsl:template elements hold rendering rules, never data).
  // A nested element in another namespace is not a Prism file.
  let wrapped = false;
  if (root.tag !== "GraphPadPrismFile") {
    const nested = root.children.find(
      (c) => c.tag === "GraphPadPrismFile" && (!c.attrs.xmlns || c.attrs.xmlns === PRISM_XML_NS),
    );
    if (!nested) {
      return {
        project: { nodes: {}, rootOrder: [], childOrder: {}, activeNodeId: null },
        tables: [],
        infoSheets: [],
        issues: [{ severity: "error", message: "This file isn't a GraphPad Prism .pzfx file." }],
      };
    }
    root = nested;
    wrapped = true;
  }
  const issues: PzfxIssue[] = [];
  if (wrapped) {
    issues.push({
      severity: "warning",
      message: "This file wraps its GraphPad Prism data in an XSL stylesheet; the nested Prism file was imported.",
    });
  }
  const tables: string[] = [];
  const nodes: Record<string, ProjectNode> = {};
  const rootOrder: string[] = [];
  const childOrder: Record<string, string[]> = {};
  // Tables live under the root (TableSequence only lists them) — a
  // HugeTable is the same shape as a Table, so importTable handles both.
  const groupingSeparators = usesGroupingSeparators(root);
  const tableNodes = root.children.filter((c) => c.tag === "Table" || c.tag === "HugeTable");
  for (const tableNode of tableNodes) {
    const imported = importTable(tableNode, issues, groupingSeparators);
    if (!imported) continue;
    nodes[imported.node.id] = imported.node;
    rootOrder.push(imported.node.id);
    childOrder[imported.node.id] = [];
    tables.push(imported.node.name);
    for (const warning of imported.warnings) issues.push({ severity: "warning", message: warning });
  }
  if (tables.length === 0 && issues.every((i) => i.severity === "warning")) {
    issues.unshift({ severity: "error", message: "No tables in this file could be imported." });
  }
  // Info sheets live beside the tables (`<Info>` under the root): their
  // constants and notes come in as info nodes at the project root, after the
  // tables — a `.pzfx` carries no table link for them, so they open as
  // project info.
  const infoSheets: string[] = [];
  for (const infoNode of root.children.filter((c) => c.tag === "Info")) {
    const childText = (tag: string) => infoNode.children.find((c) => c.tag === tag)?.text ?? "";
    const constants = readInfoConstants(
      infoNode.children
        .filter((c) => c.tag === "Constant")
        .map((c) => ({
          id: newConstantId(),
          name: c.children.find((x) => x.tag === "Name")?.text ?? "",
          value: c.children.find((x) => x.tag === "Value")?.text ?? "",
        })),
    );
    const title = childText("Title");
    const node: ProjectNode = {
      id: genId("info"),
      type: "info",
      name: title === "" ? "Project info" : title,
      parentId: null,
      info: { constants, notes: childText("Notes"), linkedTableId: null },
    };
    nodes[node.id] = node;
    rootOrder.push(node.id);
    infoSheets.push(node.name);
  }
  return {
    project: { nodes, rootOrder, childOrder, activeNodeId: rootOrder[0] ?? null },
    tables,
    infoSheets,
    issues,
  };
}
