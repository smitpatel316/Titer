// Prism's Import and Paste Special Choices dialog (seq 429, walk2/07–11 —
// all five tabs dumped verbatim from real Prism 11.2.0). Titer had no
// import dialog at all: a file went straight to a new table (or, when its
// shape matched, an append prompt). This module is the dialog's pure
// engine — the choices, their Prism defaults, and what each choice does to
// the parsed rows. The dialog (src/views/tables/import-dialog.tsx) edits
// the choices and previews them; the store (use-document.ts) runs
// computeImport and places the result.
//
// The choices, tab by tab (Prism's wording, from the captures):
//   Source — link vs embed ("Insert data only." / "Insert and maintain
//     link." + "Automatically update Prism when the data file is changed."),
//     commas ("To separate adjacent columns" / "To delineate thousands" /
//     "As decimal place"), spaces ("Only separate words within column
//     heading and X labels." / "Separate adjacent columns."). The two
//     clipboard checkboxes on this tab ("Paste as many digits as possible",
//     "Paste older text-based clipboard format") are clipboard options —
//     they live in Paste Special (seq 428), not in a file import.
//   View — a preview grid of the file as the Source tab reads it.
//   Filter — missing-value marker, asterisk exclusion, row/column ranges,
//     skip-until/after/where, decimate, unstack, skip columns.
//   Placement — rename (file name / text in a row), insertion point
//     (the live one, or a row + column), arrangement (maintain /
//     transpose / by rows / by columns), blank-row handling, column titles.
//   Info & Notes — <Info> / <Notes> sections, or rows by number, into
//     the sheet the "Import into:" popup names (a new info sheet, or an
//     existing one — seq 451).
//
// Two judgement calls, documented where they bite:
//   * Commas-as-thousands/decimal only rewrites a comma inside a field of
//     a file whose delimiter is NOT a comma. A comma-delimited file's
//     commas are separators by definition — there is no way to tell a
//     thousands comma from a separator in one, and rewriting would merge
//     two values into one ("1,000,2,000" → "10002000").
//   * Row/column numbers in the Filter tab count the file's data rows as
//     the preview shows them (after <Info>/<Notes> sections are taken
//     out), 1-based, as Prism numbers them.
import { detectDelimiter, parseDelimited } from "./tabular-import";
import { fileTitle } from "./paths";

/** The five tabs, in Prism's order. */
export const IMPORT_CHOICE_TABS = ["Source", "View", "Filter", "Placement", "Info & Notes"] as const;
export type ImportChoiceTab = (typeof IMPORT_CHOICE_TABS)[number];

/** One comparison for the Filter tab's skip rows: `col` is a 1-based file
 *  column, `value` the number or text to compare against. */
export interface ImportSkipCondition {
  col: number;
  op: ">" | "<" | "=" | ">=" | "<=";
  value: string;
}

/** Prism's Import and Paste Special Choices, all five tabs. */
export interface ImportChoices {
  source: {
    /** "Insert and maintain link." (vs "Insert data only."). */
    link: boolean;
    /** "Automatically update Prism when the data file is changed." */
    autoUpdate: boolean;
    /** What a comma means: a separator, a thousands mark, a decimal mark. */
    comma: "separate" | "thousands" | "decimal";
    /** What a space means: only inside headings/X labels, or a separator. */
    spaces: "headings" | "separate";
  };
  filter: {
    /** Cells equal to this become blank; "" = the option is off. */
    missingMarker: string;
    /** Exclude values preceded or followed by asterisks ("45.6*", "*45.6"). */
    excludeAsterisks: boolean;
    /** First data row to take, 1-based. */
    startRow: number;
    /** Last data row to take, 1-based, or "last" for the final row. */
    endRow: "last" | number;
    /** Skip leading rows until this holds (null = off). */
    skipUntil: ImportSkipCondition | null;
    /** Skip the rows after the first row where this holds (null = off). */
    skipAfter: ImportSkipCondition | null;
    /** Skip every row where this holds (null = off). */
    skipWhere: ImportSkipCondition | null;
    /** Import a row, skip this many, repeat; 0 = off. */
    decimate: number;
    /** First file column to take, 1-based. */
    startCol: number;
    /** Last file column to take, 1-based, or "last". */
    endCol: "last" | number;
    /** Long-to-wide: this column holds the values, this one the groups. */
    unstack: { dataCol: number; groupCol: number } | null;
    /** Import a column, skip this many, repeat; 0 = off. */
    skipColumns: number;
  };
  placement: {
    /** Rename the table on import (vs keeping its own name). */
    rename: boolean;
    /** The new name comes from the file name, or the text of a row. */
    renameFrom: "file" | "row";
    /** Which row's text names the table, 1-based (renameFrom "row"). */
    renameRow: number;
    /** Into the active table at the insertion point, or a new table. */
    target: "insert" | "new";
    /** Use the grid's live insertion point (vs the row/column below). */
    useLiveInsertionPoint: boolean;
    /** Insertion row, 1-based (when not using the live point). */
    insertRow: number;
    /** Insertion data column, 1-based (A = 1; when not using the live point). */
    insertCol: number;
    /** Maintain / transpose / by rows / by columns. */
    arrangement: "maintain" | "transpose" | "byRows" | "byColumns";
    /** By rows: this many values fill a column before a new one starts. */
    byRowsRows: number;
    /** By columns: this many values stack in a column. */
    byColumnsValues: number;
    /** An all-blank row is left in place, or skipped over. */
    blankRows: "leave" | "skip";
    /** How the new table gets its column titles: Prism's choice, the
     *  first row, or none (the first row is data). */
    columnTitles: "auto" | "firstRow" | "none";
  };
  info: {
    /** Info constants: don't import, the <Info> section, or rows by number. */
    infoMode: "none" | "section" | "fromRow";
    /** First row of the info range, 1-based (fromRow). */
    infoFromRow: number;
    /** Last row of the info range, 1-based, or "last" (fromRow). */
    infoEndRow: "last" | number;
    /** Notes: don't import, the <Notes> section, or rows by number. */
    notesMode: "none" | "section" | "fromRow";
    /** First row of the notes range, 1-based (fromRow). */
    notesFromRow: number;
    /** Last row of the notes range, 1-based, or "last" (fromRow). */
    notesEndRow: "last" | number;
    /** Where the imported info and notes go (the Info & Notes tab's
     *  "Import into:" popup, seq 451): "new" for a new info sheet
     *  linked to the table, or the id of an existing info sheet. */
    importInto: string;
  };
}

/** Prism's defaults, as captured (walk2/07–11): insert data only, commas
 *  separate columns, spaces only in headings/X labels, asterisk
 *  exclusion on, rows/columns 1..last, rename with the file name, the
 *  live insertion point, arrangement maintained, blank rows left, no
 *  info/notes import. */
export function defaultImportChoices(): ImportChoices {
  return {
    source: { link: false, autoUpdate: true, comma: "separate", spaces: "headings" },
    filter: {
      missingMarker: "",
      excludeAsterisks: true,
      startRow: 1,
      endRow: "last",
      skipUntil: null,
      skipAfter: null,
      skipWhere: null,
      decimate: 0,
      startCol: 1,
      endCol: "last",
      unstack: null,
      skipColumns: 0,
    },
    placement: {
      rename: true,
      renameFrom: "file",
      renameRow: 1,
      target: "insert",
      useLiveInsertionPoint: true,
      insertRow: 1,
      insertCol: 1,
      arrangement: "maintain",
      byRowsRows: 1,
      byColumnsValues: 1,
      blankRows: "leave",
      columnTitles: "auto",
    },
    info: {
      infoMode: "none",
      infoFromRow: 1,
      infoEndRow: "last",
      notesMode: "none",
      notesFromRow: 1,
      notesEndRow: "last",
      importInto: "new",
    },
  };
}

// ── Column letters ───────────────────────────────────────────────────────

/** A 0-based data column as a spreadsheet letter: 0 → A, 25 → Z, 26 → AA. */
export function dataColumnLetter(index: number): string {
  let s = "";
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/** A spreadsheet letter as a 0-based data-column index, or -1 when it
 *  isn't one ("1", "", "A1"). */
export function dataColumnIndex(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) return -1;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// ── Parsing under the Source tab ─────────────────────────────────────────

/** A field that is one thousands-grouped number: 1–3 digits, then groups
 *  of exactly three ("100,000", "1,234,567"). "1,000,2,000" is two such
 *  numbers in one field, so it does NOT match — rewriting it would merge
 *  two values into one. */
const THOUSANDS_NUMBER = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/;
/** A field that is one decimal-comma number ("100,000" = 100.000), including
 *  scientific notation ("1,5e-3" = 0.0015). */
const DECIMAL_COMMA_NUMBER = /^[+-]?\d+,\d+([eE][+-]?\d+)?$/;

/** The file's text as rows, read the way the Source tab says: commas as
 *  separators / thousands / decimal, spaces as headings-only / separators.
 *  A .xlsx file never reaches here — its cells are already split, so the
 *  Source tab's delimiter options don't apply to it. */
export function parseImportText(text: string, ext: string, choices: ImportChoices): string[][] {
  if (choices.source.spaces === "separate") {
    // Spaces separate columns: runs of spaces are one separator, and a
    // quoted field keeps its spaces (parseDelimited honours quotes; the
    // empty fields consecutive spaces leave are spacing, not data).
    return parseDelimited(text, " ").map((row) => row.filter((c) => c !== ""));
  }
  const preferred = ext === "tsv" || ext === "txt" || ext === "dat" || ext === "prn" ? "\t" : ",";
  const delimiter = detectDelimiter(text, preferred);
  let rows = parseDelimited(text, delimiter);
  // Thousands/decimal commas only rewrite a comma inside a field of a file
  // whose delimiter isn't a comma (see the module note): a tab-delimited
  // "100,000" becomes "100000" / "100.000", so it still reads as a number.
  if (delimiter !== "," && choices.source.comma !== "separate") {
    const rewrite = (c: string): string => {
      if (choices.source.comma === "thousands" && THOUSANDS_NUMBER.test(c)) return c.replace(/,/g, "");
      if (choices.source.comma === "decimal" && DECIMAL_COMMA_NUMBER.test(c)) return c.replace(",", ".");
      return c;
    };
    rows = rows.map((row) => row.map(rewrite));
  }
  return rows;
}

// ── Info & Notes ─────────────────────────────────────────────────────────

/** The file's rows with the <Info> / <Notes> sections taken out: the
 *  section rows, and the data rows with nothing of them left. A section
 *  runs from its marker row ("<Info>") to its closing marker
 *  ("</Info>"); an unclosed section runs to the end of the file. The
 *  fromRow modes take rows by number instead. Both extractions count
 *  against the file's rows as parsed, so the two ranges never shift each
 *  other. Sections must come before any data (Prism's own note) — rows
 *  after the data are still honoured, but the note says so. */
export function extractInfoSections(
  rows: string[][],
  choices: ImportChoices,
): { dataRows: string[][]; infoRows: string[][]; notesRows: string[][] } {
  const take = (
    mode: "none" | "section" | "fromRow",
    open: string,
    close: string,
    fromRow: number,
    endRow: "last" | number,
  ): { taken: string[][]; removed: Set<number> } => {
    const removed = new Set<number>();
    if (mode === "none") return { taken: [], removed };
    if (mode === "fromRow") {
      const end = endRow === "last" ? rows.length : Math.min(endRow, rows.length);
      const taken: string[][] = [];
      for (let i = Math.max(fromRow, 1) - 1; i < end; i++) {
        taken.push(rows[i]);
        removed.add(i);
      }
      return { taken, removed };
    }
    const start = rows.findIndex((r) => (r[0] ?? "").trim() === open);
    if (start === -1) return { taken: [], removed };
    removed.add(start);
    const taken: string[][] = [];
    let end = rows.length;
    for (let i = start + 1; i < rows.length; i++) {
      if ((rows[i][0] ?? "").trim() === close) {
        end = i;
        removed.add(i);
        break;
      }
      taken.push(rows[i]);
      removed.add(i);
    }
    void end;
    return { taken, removed };
  };
  const info = take(choices.info.infoMode, "<Info>", "</Info>", choices.info.infoFromRow, choices.info.infoEndRow);
  const notes = take(choices.info.notesMode, "<Notes>", "</Notes>", choices.info.notesFromRow, choices.info.notesEndRow);
  const removed = new Set([...info.removed, ...notes.removed]);
  return {
    dataRows: rows.filter((_, i) => !removed.has(i)),
    infoRows: info.taken,
    notesRows: notes.taken,
  };
}

// ── Info & Notes destination ("Import into:", seq 451) ───────────────

/** An info sheet the "Import into:" popup can name: its id (the choice's
 *  value) and its sidebar name (the popup's label). */
export interface InfoImportSheet {
  id: string;
  name: string;
}

/** The sheet the imported info and notes go to: the named sheet when it
 *  still exists, a new info sheet otherwise. A saved default naming a
 *  sheet from another project — or one deleted since — falls back to new
 *  instead of importing nowhere. */
export function resolveInfoImportTarget(importInto: string, sheets: InfoImportSheet[]): "new" | string {
  if (importInto === "new") return "new";
  return sheets.some((s) => s.id === importInto) ? importInto : "new";
}

/** Imported constants + notes merged into an info sheet's data. A
 *  constant whose name the sheet already has (case-insensitive, like
 *  hook lookup) takes the imported value in place, keeping its id; a
 *  new name appends. Notes append after a blank line when both sides
 *  have text. A null sheet is a new one: the imported constants alone
 *  (as the import always did — the six defaults are not kept), with no
 *  table link yet; the caller links it. */
export function mergeImportedInfo(
  existing: InfoSheetData | null,
  imported: { name: string; value: string }[],
  notesText: string,
): InfoSheetData {
  if (!existing) {
    return {
      constants: imported.map((c) => ({ id: newConstantId(), name: c.name, value: c.value })),
      notes: notesText,
      linkedTableId: null,
    };
  }
  const constants = existing.constants.map((c) => ({ ...c }));
  for (const c of imported) {
    const at = constants.findIndex((e) => e.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (at === -1) constants.push({ id: newConstantId(), name: c.name, value: c.value });
    else constants[at] = { ...constants[at], value: c.value };
  }
  const notes =
    existing.notes !== "" && notesText !== ""
      ? `${existing.notes}\n\n${notesText}`
      : existing.notes || notesText;
  return { constants, notes, linkedTableId: existing.linkedTableId };
}

// ── Filter ───────────────────────────────────────────────────────────────

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const asNumber = (s: string): number | null => (NUMERIC.test(s.trim()) ? Number(s.trim()) : null);

/** Whether `cell` satisfies a skip condition: numbers compare as numbers,
 *  anything else as text ("=" is equality; ">" / "<" fall back to
 *  lexicographic order). */
function satisfies(cell: string, cond: ImportSkipCondition): boolean {
  const cellNum = asNumber(cell);
  const valueNum = asNumber(cond.value);
  if (cellNum !== null && valueNum !== null) {
    if (cond.op === ">") return cellNum > valueNum;
    if (cond.op === "<") return cellNum < valueNum;
    if (cond.op === "=") return cellNum === valueNum;
    if (cond.op === ">=") return cellNum >= valueNum;
    return cellNum <= valueNum;
  }
  if (cond.op === "=") return cell.trim() === cond.value.trim();
  if (cond.op === ">") return cell > cond.value;
  if (cond.op === "<") return cell < cond.value;
  if (cond.op === ">=") return cell >= cond.value;
  return cell <= cond.value;
}

/** The Filter tab, in Prism's order: row range, skip rows, missing-value
 *  and asterisk blanks, decimate, column range, unstack, skip columns.
 *  Returns the rows that survive, and a note for each choice that changed
 *  something (the import notice reports them). */
export function applyImportFilter(
  rows: string[][],
  choices: ImportChoices,
): { rows: string[][]; notes: string[] } {
  const f = choices.filter;
  const notes: string[] = [];
  let out = rows;

  // Row range, 1-based inclusive.
  if (f.startRow > 1 || f.endRow !== "last") {
    const end = f.endRow === "last" ? out.length : f.endRow;
    const before = out.length;
    out = out.slice(Math.max(f.startRow, 1) - 1, end);
    if (out.length < before) notes.push(`Only rows ${f.startRow}–${f.endRow === "last" ? "last" : f.endRow} were imported.`);
  }

  // Skip rows: until a condition holds (leading rows go), after the first
  // row where one holds (that row stays, the rest go), where one holds.
  const cellAt = (row: string[], cond: ImportSkipCondition): string => row[cond.col - 1] ?? "";
  if (f.skipUntil) {
    const first = out.findIndex((row) => satisfies(cellAt(row, f.skipUntil!), f.skipUntil!));
    if (first > 0) {
      notes.push(`${first} leading row${first === 1 ? "" : "s"} skipped until column ${f.skipUntil.col} met the condition.`);
      out = out.slice(first);
    } else if (first === -1) {
      notes.push(`No row met the skip-until condition, so nothing was imported.`);
      out = [];
    }
  }
  if (f.skipAfter) {
    const at = out.findIndex((row) => satisfies(cellAt(row, f.skipAfter!), f.skipAfter!));
    if (at !== -1 && at < out.length - 1) {
      notes.push(`${out.length - at - 1} row${out.length - at - 1 === 1 ? "" : "s"} skipped after the condition was met.`);
      out = out.slice(0, at + 1);
    }
  }
  if (f.skipWhere) {
    const before = out.length;
    out = out.filter((row) => !satisfies(cellAt(row, f.skipWhere!), f.skipWhere!));
    if (out.length < before)
      notes.push(`${before - out.length} row${before - out.length === 1 ? "" : "s"} skipped where column ${f.skipWhere.col} met the condition.`);
  }

  // Missing values and asterisked values become blank cells.
  if (f.missingMarker !== "" || f.excludeAsterisks) {
    let blanked = 0;
    out = out.map((row) =>
      row.map((c) => {
        if (f.missingMarker !== "" && c === f.missingMarker) {
          blanked++;
          return "";
        }
        if (f.excludeAsterisks && c !== "" && (c.startsWith("*") || c.endsWith("*"))) {
          blanked++;
          return "";
        }
        return c;
      }),
    );
    if (blanked > 0) notes.push(`${blanked} value${blanked === 1 ? "" : "s"} left blank (missing marker / asterisked).`);
  }

  // Decimate: import a row, skip N, import another, repeat.
  if (f.decimate > 0) {
    const kept = out.filter((_, i) => i % (f.decimate + 1) === 0);
    notes.push(`Decimated: kept ${kept.length} of ${out.length} rows (import one, skip ${f.decimate}).`);
    out = kept;
  }

  // Column range, 1-based inclusive.
  if (f.startCol > 1 || f.endCol !== "last") {
    const end = f.endCol === "last" ? undefined : f.endCol;
    out = out.map((row) => row.slice(Math.max(f.startCol, 1) - 1, end));
  }

  // Unstack: one output column per distinct group value, in first-seen
  // order, headed by the group value (so the new table names its columns
  // for the groups); a group's values stack in file order, short groups
  // padded blank. The other columns don't fit the unstacked shape and go.
  if (f.unstack) {
    const { dataCol, groupCol } = f.unstack;
    const groups: string[] = [];
    const values = new Map<string, string[]>();
    for (const row of out) {
      const g = row[groupCol - 1] ?? "";
      if (!values.has(g)) {
        groups.push(g);
        values.set(g, []);
      }
      values.get(g)!.push(row[dataCol - 1] ?? "");
    }
    const height = Math.max(0, ...groups.map((g) => values.get(g)!.length));
    const unstacked: string[][] = [groups];
    for (let i = 0; i < height; i++) unstacked.push(groups.map((g) => values.get(g)![i] ?? ""));
    notes.push(
      `Unstacked into ${groups.length} column${groups.length === 1 ? "" : "s"} by column ${groupCol} (groups ${groups.map((g) => `“${g}”`).join(", ")}).`,
    );
    out = unstacked;
  }

  // Skip columns: import a column, skip N, import another, repeat.
  if (f.skipColumns > 0) {
    out = out.map((row) => row.filter((_, i) => i % (f.skipColumns + 1) === 0));
    notes.push(`Skipped columns: kept every ${f.skipColumns + 1}${f.skipColumns + 1 === 2 ? "nd" : "th"} column.`);
  }

  return { rows: out, notes };
}

// ── Placement ────────────────────────────────────────────────────────────

/** The Placement tab's rearrangement: transpose, by-rows (read across
 *  rows, N values fill a column before a new one starts), by-columns
 *  (read down columns, N values stack in a column), then blank-row
 *  handling. A ragged input is padded blank first, so a transpose never
 *  loses a short row's tail. */
export function applyImportPlacement(
  rows: string[][],
  choices: ImportChoices,
): { rows: string[][]; notes: string[] } {
  const p = choices.placement;
  const notes: string[] = [];
  let out = rows;

  if (p.arrangement !== "maintain") {
    if (p.arrangement === "transpose") {
      const width = Math.max(0, ...out.map((r) => r.length));
      const padded = out.map((r) => [...r, ...Array<string>(Math.max(0, width - r.length)).fill("")]);
      out = Array.from({ length: width }, (_, c) => padded.map((r) => r[c]));
      notes.push("Transposed: each row became a column.");
    } else {
      // Flatten, then re-chunk into columns: row-major for by-rows,
      // column-major for by-columns.
      const flat: string[] =
        p.arrangement === "byRows" ? out.flat() : out[0]?.map((_, c) => out.map((r) => r[c] ?? "")).flat() ?? [];
      const perColumn = p.arrangement === "byRows" ? Math.max(1, p.byRowsRows) : Math.max(1, p.byColumnsValues);
      const chunks: string[][] = [];
      for (let i = 0; i < flat.length; i += perColumn) chunks.push(flat.slice(i, i + perColumn));
      out = Array.from({ length: perColumn }, (_, i) => chunks.map((chunk) => chunk[i] ?? ""));
      // A trailing chunk shorter than the rest leaves blank cells in the
      // last rows — the grid shows them as empty, not as shifted values.
      notes.push(
        p.arrangement === "byRows"
          ? `Placed by rows: ${perColumn} row${perColumn === 1 ? "" : "s"} per column.`
          : `Stacked by columns: ${perColumn} value${perColumn === 1 ? "" : "s"} per column.`,
      );
    }
  }

  if (p.blankRows === "skip") {
    const before = out.length;
    out = out.filter((row) => row.some((c) => c !== ""));
    if (out.length < before)
      notes.push(`${before - out.length} blank row${before - out.length === 1 ? "" : "s"} skipped.`);
  }

  return { rows: out, notes };
}

// ── The whole pipeline ───────────────────────────────────────────────────

/** A file offered to the Import dialog: its name, its path on disk when
 *  the desktop app picked it (null on the web build — there is no path to
 *  re-read), and its contents — text for a delimited file, parsed sheet
 *  rows for .xlsx. */
export interface ImportOffer {
  name: string;
  path: string | null;
  text: string | null;
  xlsxRows: string[][] | null;
  sheetName: string | null;
  otherSheets: string[];
  /** Notes from the read itself (formula errors, skipped sheets) — the
   *  import notice reports them. */
  parseNotes?: string[];
}

/** What the choices make of the offered file: the rows to place, the
 *  <Info> constants and <Notes> text (when the Info & Notes tab asked for
 *  them), and the notes the import reports. Throws a user-facing message
 *  when nothing is left to import. */
export interface ComputedImport {
  rows: string[][];
  infoConstants: { name: string; value: string }[];
  notesText: string;
  notes: string[];
}

export function computeImport(offer: ImportOffer, choices: ImportChoices): ComputedImport {
  const ext = offer.name.toLowerCase().split(".").pop() ?? "";
  const parsed = offer.xlsxRows ?? (offer.text === null ? [] : parseImportText(offer.text, ext, choices));
  const { dataRows, infoRows, notesRows } = extractInfoSections(parsed, choices);
  const filtered = applyImportFilter(dataRows, choices);
  const placed = applyImportPlacement(filtered.rows, choices);
  if (placed.rows.length === 0)
    throw new Error(`“${offer.name}” has no rows left to import with these choices — loosen the filter.`);
  const infoConstants = infoRows
    .map((r) => ({ name: (r[0] ?? "").trim(), value: r.slice(1).filter((c) => c !== "").join(" ") }))
    .filter((c) => c.name !== "");
  const notesText = notesRows
    .map((r) => r.filter((c) => c !== "").join(" "))
    .filter((s) => s !== "")
    .join("\n");
  const notes: string[] = [];
  if (infoConstants.length > 0)
    notes.push(`${infoConstants.length} info constant${infoConstants.length === 1 ? "" : "s"} taken from the <Info> section.`);
  if (notesText !== "") notes.push("Notes taken from the <Notes> section.");
  notes.push(...filtered.notes, ...placed.notes);
  return { rows: placed.rows, infoConstants, notesText, notes };
}

/** The table's new name under the Placement tab: the file name, the text
 *  of the chosen row (its non-empty cells, spaced), or "" when renaming is
 *  off — the caller keeps the table's own name then. */
export function resolveImportTableName(choices: ImportChoices, fileName: string, rows: string[][]): string {
  if (!choices.placement.rename) return "";
  if (choices.placement.renameFrom === "file") return fileTitle(fileName);
  const row = rows[Math.max(choices.placement.renameRow, 1) - 1] ?? [];
  const text = row.filter((c) => c !== "").join(" ").trim();
  return text === "" ? fileTitle(fileName) : text;
}

// ── Remembered defaults ─────────────────────────────────────────────────

const SAVED_IMPORT_CHOICES_KEY = "titer.importChoices.defaults";

/** The defaults the user saved with "Use these settings as the default",
 *  or null when none were saved (or they no longer parse). Plain node has
 *  no localStorage, so the suite never sees one. */
export function loadSavedImportChoices(): ImportChoices | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SAVED_IMPORT_CHOICES_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const c = parsed as Partial<ImportChoices>;
    if (typeof c.source !== "object" || typeof c.filter !== "object" || typeof c.placement !== "object" || typeof c.info !== "object")
      return null;
    return parsed as ImportChoices;
  } catch {
    return null;
  }
}

/** Remember these choices as the dialog's defaults. */
export function saveImportChoices(choices: ImportChoices): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SAVED_IMPORT_CHOICES_KEY, JSON.stringify(choices));
  } catch {
    // A full or unavailable store just means the defaults don't stick.
  }
}

/** Forget the saved defaults (the dialog's "Restore original defaults"). */
export function clearSavedImportChoices(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(SAVED_IMPORT_CHOICES_KEY);
  } catch {
    // Nothing to forget.
  }
}
