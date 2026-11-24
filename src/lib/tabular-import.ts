// Import delimited text (CSV / TXT / DAT / PRN) and Excel (.xlsx) files into Titer tables
// (seq 155). Labs live in Excel/CSV; until now Titer could only take data by
// typing or pasting, which is an onboarding wall.
//
// What maps where:
//   CSV / TXT / DAT / PRN (delimited) → parsed with the same quoting rules Prism's
//     data.csv reader uses (quoted fields, embedded commas, CRLF/LF), with
//     the delimiter detected from the file (comma, tab, semicolon, pipe).
//     A .prn export from Prism is tab-delimited; a .dat file is a text
//     table the same shape. Neither carries a delimiter in its name, so
//     tab is preferred for both and detection still finds the rest.
//   XLSX → read with JSZip + a small targeted scan of the sheet XML (no
//     dependency, so it runs in the app and in the tests alike): the first
//     sheet only, shared strings, inline strings, booleans, numbers, and
//     date-formatted cells (Excel serials → ISO dates, via styles.xml).
//   Rows → a new table: the first row becomes column names when it reads
//     like a header (all text, with numbers below it); the first column
//     becomes row titles when it holds text; a first data column headed
//     "X" makes an XY table, anything else a Column table. An import whose
//     shape matches the active table can be appended to it instead
//     (mergeIntoTable) — never silently: the caller asks first.
//
// The mapping is deliberately conservative: a file that looks ambiguous
// imports as a plain Column table with its values intact, and every
// judgement call is reported in `notes`, so the user can see what the
// importer assumed instead of discovering it in an analysis.
import JSZip from "jszip";
import { parseCell } from "./numeric";
import type { TableData, TableType } from "../store/types";

/** The data-file extensions Titer imports (File ▸ Import Data File…, or a drop). */
export const DATA_FILE_EXTENSIONS = ["csv", "tsv", "txt", "dat", "prn", "xlsx"] as const;

/** Whether `path` names a data file Titer imports. */
export const isDataFilePath = (path: string): boolean => {
  const lower = path.toLowerCase();
  return DATA_FILE_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`));
};

// ── Delimited text ───────────────────────────────────────────────────────

/** Parse delimited text into rows of cell strings. Quoted fields may hold
 *  the delimiter, quotes (doubled) and line breaks; CRLF, LF and lone CR
 *  all end a row. A leading byte-order mark is file encoding, not data.
 *  A trailing empty line is dropped; an empty field is "" (the caller
 *  turns "" into null). */
export function parseDelimited(text: string, delimiter: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
    } else if (c === '"') {
      quoted = true;
      i++;
    } else if (c === delimiter) {
      endField();
      i++;
    } else if (c === "\r") {
      // CRLF or lone CR ends the row.
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
    } else if (c === "\n") {
      endRow();
      i++;
    } else {
      field += c;
      i++;
    }
  }
  // Last row without a trailing newline.
  if (field !== "" || row.length > 0) endRow();
  // A trailing all-empty row is only ever the file's final newline.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  return rows;
}

const DELIMITER_CANDIDATES = [",", "\t", ";", "|"] as const;

/** The delimiter a delimited file uses, read from its first lines: the one
 *  giving the most lines the same field count (≥ 2 fields). `preferred`
 *  breaks ties — tab for a .txt/.tsv file, comma for a .csv one. A file
 *  with no delimiter at all is a single column (comma, by convention). */
export function detectDelimiter(text: string, preferred: "," | "\t" = ","): string {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "")
    .slice(0, 10);
  if (lines.length === 0) return preferred;
  const ordered = [preferred, ...DELIMITER_CANDIDATES.filter((d) => d !== preferred)];
  let best: string = preferred;
  let bestScore = -1;
  for (const d of ordered) {
    const counts = lines.map((l) => parseDelimited(l, d)[0]?.length ?? 0);
    const modal = counts.reduce(
      (top, c) => (counts.filter((x) => x === c).length > counts.filter((x) => x === top).length ? c : top),
      counts[0],
    );
    const consistent = counts.filter((c) => c === modal).length;
    const score = modal >= 2 ? consistent * 10 + modal : 0;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

// ── .xlsx ────────────────────────────────────────────────────────────────
// A workbook is a ZIP of XML parts. Only the parts an import needs are read:
// xl/workbook.xml (sheet names, in order), xl/workbook.xml.rels (each
// sheet's part), xl/sharedStrings.xml, xl/styles.xml (date formats) and the
// first worksheet's sheetData. The XML here is regular — attributes, text,
// no nesting inside a row — so small targeted scans do, with no DOM.

const decodeEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, body: string) => {
    if (body === "amp") return "&";
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    const code = body.startsWith("#x") ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });

/** The value of attribute `name` in a tag's attribute text, if present. */
const attrOf = (attrs: string, name: string): string | undefined =>
  new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(attrs)?.[1];

/** A spreadsheet column letter ("A", "AA") as a 0-based index. */
const columnIndex = (letters: string): number => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** "B3" → { col: 1, row: 2 } (0-based). */
const cellRef = (ref: string): { col: number; row: number } | null => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: columnIndex(m[1]), row: parseInt(m[2], 10) - 1 } : null;
};

/** Excel's built-in date/time number-format ids (14–22, 27–36, 45–47). */
const DATE_BUILTIN_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47,
]);

/** Whether a custom format code is a date/time one: it carries date or time
 *  tokens (year, month, day, hour, minute, second). Number formats never do. */
const isDateFormatCode = (code: string): boolean => /y{1,4}|m{1,2}|d{1,2}|h{1,2}|s{1,2}/i.test(code);

/** An Excel date serial as an ISO date ("2026-01-09", or "2026-01-09 14:30"
 *  when it carries a time). Serial 1 is 1900-01-01 in Excel's (leap-bug)
 *  calendar, i.e. days since 1899-12-30 — the conversion every reader uses,
 *  so the value matches what Excel shows. */
export function excelSerialToIso(serial: number): string {
  const totalMinutes = Math.round(serial * 24 * 60);
  const d = new Date(Date.UTC(1899, 11, 30) + totalMinutes * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  if (totalMinutes % (24 * 60) === 0) return date;
  return `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export interface XlsxSheet {
  /** The sheet's name, as the workbook lists it. */
  name: string;
  /** Its rows of cell strings ("" = empty), in file order. */
  rows: string[][];
}

/** A .xlsx file's first sheet, with the names of any further sheets (which
 *  are not imported — one file, one table). Throws when the bytes aren't a
 *  workbook Titer can read. */
export async function parseXlsx(bytes: Uint8Array): Promise<{
  sheet: XlsxSheet;
  otherSheets: string[];
  /** Notes about the read itself (formula errors left blank). */
  notes: string[];
}> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error("This file isn't a valid .xlsx workbook.");
  }
  const readPart = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };
  const workbook = await readPart("xl/workbook.xml");
  if (workbook === null) throw new Error("This file isn't a valid .xlsx workbook — it has no workbook.");
  // Sheet names, in workbook order, with their relationship ids.
  const sheets: { name: string; rid: string | undefined }[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const name = attrOf(m[1], "name");
    if (name !== undefined) sheets.push({ name, rid: attrOf(m[1], "r:id") });
  }
  if (sheets.length === 0) throw new Error("This .xlsx file has no sheets to import.");
  // Relationship id → part, from xl/workbook.xml.rels.
  const rels = await readPart("xl/_rels/workbook.xml.rels");
  const targets = new Map<string, string>();
  if (rels !== null) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
      const id = attrOf(m[1], "Id");
      const target = attrOf(m[1], "Target");
      if (id !== undefined && target !== undefined) targets.set(id, target.replace(/^\//, ""));
    }
  }
  // The worksheet parts in the order the sheets list them (the rels map
  // first; a workbook without rels falls back to sheet1, sheet2…).
  const worksheetFiles = Object.keys(zip.files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10));
  const sheetPath = (index: number): string | null => {
    const rid = sheets[index].rid;
    if (rid !== undefined) {
      const target = targets.get(rid);
      if (target !== undefined) return target.startsWith("xl/") ? target : `xl/${target}`;
    }
    return worksheetFiles[index] ?? null;
  };
  const firstPath = sheetPath(0);
  if (firstPath === null) throw new Error("This .xlsx file's first sheet couldn't be found.");
  const sheetXml = await readPart(firstPath);
  if (sheetXml === null) throw new Error("This .xlsx file's first sheet couldn't be read.");

  // Shared strings: each <si>'s text is all its <t> runs joined.
  const sharedStrings: string[] = [];
  const shared = await readPart("xl/sharedStrings.xml");
  if (shared !== null) {
    for (const m of shared.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let text = "";
      for (const t of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeEntities(t[1]);
      sharedStrings.push(text);
    }
  }

  // Styles: each cellXfs <xf>'s numFmtId, and any custom numFmt's code —
  // together they say which style indexes are date formats.
  const dateStyles = new Set<number>();
  const styles = await readPart("xl/styles.xml");
  if (styles !== null) {
    const custom = new Map<number, string>();
    for (const m of styles.matchAll(/<numFmt\b([^>]*?)\/?>/g)) {
      const id = attrOf(m[1], "numFmtId");
      const code = attrOf(m[1], "formatCode");
      if (id !== undefined && code !== undefined) custom.set(parseInt(id, 10), code);
    }
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? "";
    let index = 0;
    for (const m of xfs.matchAll(/<xf\b([^>]*?)\/?>/g)) {
      const fmtId = parseInt(attrOf(m[1], "numFmtId") ?? "0", 10);
      const customCode = custom.get(fmtId);
      if (DATE_BUILTIN_FMT_IDS.has(fmtId) || (customCode !== undefined && isDateFormatCode(customCode))) {
        dateStyles.add(index);
      }
      index++;
    }
  }

  // The sheet's rows. A cell's position comes from its `r` reference
  // ("B3"); one without it follows the previous cell. A missing row or
  // cell is blank, so sparse sheets read with their gaps intact.
  const rows: string[][] = [];
  let errorCells = 0;
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)>([\s\S]*?)<\/row>/g)) {
    const rowAttrs = rowMatch[1];
    const rowRef = attrOf(rowAttrs, "r");
    const rowIndex = rowRef !== undefined ? parseInt(rowRef, 10) - 1 : rows.length;
    while (rows.length <= rowIndex) rows.push([]);
    const row = rows[rowIndex];
    let nextCol = 0;
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = cellMatch[1];
      const inner = cellMatch[2] ?? "";
      const ref = attrOf(cellAttrs, "r");
      const at = ref !== undefined ? cellRef(ref) : null;
      const col = at !== null ? at.col : nextCol;
      nextCol = col + 1;
      while (row.length <= col) row.push("");
      const type = attrOf(cellAttrs, "t");
      const value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? "";
      if (type === "s") {
        const idx = parseInt(value, 10);
        row[col] = Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
      } else if (type === "inlineStr" || type === "str") {
        let text = "";
        for (const t of inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) text += decodeEntities(t[1]);
        row[col] = text === "" ? decodeEntities(value) : text;
      } else if (type === "b") {
        row[col] = value === "1" || value.toLowerCase() === "true" ? "TRUE" : "FALSE";
      } else if (type === "e") {
        // A formula error (#DIV/0!…) has no value to import.
        row[col] = "";
        errorCells++;
      } else {
        // A number — or a date serial, when its style says so.
        const style = attrOf(cellAttrs, "s");
        const serial = Number(value);
        row[col] =
          style !== undefined && dateStyles.has(parseInt(style, 10)) && value !== "" && Number.isFinite(serial)
            ? excelSerialToIso(serial)
            : value;
      }
    }
  }
  const notes: string[] = [];
  if (errorCells > 0)
    notes.push(
      `${errorCells} cell${errorCells === 1 ? "" : "s"} held a formula error and ${errorCells === 1 ? "was" : "were"} left blank.`,
    );
  return { sheet: { name: sheets[0].name, rows }, otherSheets: sheets.slice(1).map((s) => s.name), notes };
}

// ── Rows → a table ───────────────────────────────────────────────────────

export interface TabularTable {
  tableType: TableType;
  data: TableData;
  /** What the importer assumed, in plain language — shown to the user. */
  notes: string[];
}

/** At most this many rows / columns come across; beyond it the file is
 *  truncated and the note says so, rather than the grid choking on a
 *  million-row export. */
export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_COLUMNS = 500;

/** A column name as the grid can hold it: trimmed, no ":" (which would
 *  split it into a group), no line breaks. */
const cleanColumnName = (name: string): string => name.trim().replace(/:/g, "-").replace(/\s+/g, " ").slice(0, 100);

/** Rows of cell strings as a Titer table. Throws when there is nothing to
 *  import. `source` names the file in the error and the notes. */
export function rowsToTable(rows: string[][], source: string): TabularTable {
  // Trailing empty rows and columns are the file's padding, not data.
  let grid = rows.filter((row) => row.some((c) => c !== ""));
  while (grid.length && grid[grid.length - 1].every((c) => c === "")) grid.pop();
  if (grid.length === 0) throw new Error(`“${source}” has no data to import.`);
  let width = Math.max(...grid.map((r) => r.length));
  let lastCol = width - 1;
  while (lastCol > 0 && grid.every((r) => (r[lastCol] ?? "") === "")) lastCol--;
  width = lastCol + 1;
  if (width === 0) throw new Error(`“${source}” has no data to import.`);
  grid = grid.map((r) => r.slice(0, width));
  const notes: string[] = [];
  if (grid.length > MAX_IMPORT_ROWS) {
    notes.push(
      `Only the first ${MAX_IMPORT_ROWS.toLocaleString()} rows were imported — the file has ${grid.length.toLocaleString()}.`,
    );
    grid = grid.slice(0, MAX_IMPORT_ROWS);
  }
  if (width > MAX_IMPORT_COLUMNS) {
    notes.push(`Only the first ${MAX_IMPORT_COLUMNS} columns were imported — the file has ${width}.`);
    grid = grid.map((r) => r.slice(0, MAX_IMPORT_COLUMNS));
    width = MAX_IMPORT_COLUMNS;
  }

  // A header row: every non-empty cell text (no numbers — a blank cell is
  // a trailing delimiter, not data) with at least one number below it. A
  // year ("2024") is a number, so a header of years is read as data
  // instead — the values stay intact, only the names differ.
  const firstRow = grid[0];
  const headerRow =
    firstRow.some((c) => c !== "") &&
    firstRow.every((c) => c === "" || parseCell(c) === null) &&
    grid.slice(1).some((r) => r.some((c) => parseCell(c) !== null));
  const body = headerRow ? grid.slice(1) : grid;
  if (body.length === 0) throw new Error(`“${source}” has column names but no data rows to import.`);
  if (headerRow) notes.push("The first row was read as column names.");

  // Ragged rows are padded with blanks (and named, so a short row is
  // visible rather than silently shifted).
  const ragged = body.filter((r) => r.length < width).length;
  if (ragged > 0)
    notes.push(
      `${ragged} row${ragged === 1 ? "" : "s"} had fewer cells than the header and ${ragged === 1 ? "was" : "were"} padded with blanks.`,
    );

  // The first column is row titles when it holds text: with a header row
  // it always is (the header's first cell names it); without one, when
  // another column holds numbers. A first column of numbers is data, not
  // titles — even headed "X", which is an XY table's X column, not titles.
  const firstColValues = body.map((r) => r[0] ?? "");
  const firstColText = firstColValues.every((c) => c === "" || parseCell(c) === null);
  const titlesColumn =
    width > 1 &&
    firstColText &&
    (headerRow || body.some((r) => r.slice(1).some((c) => parseCell(c) !== null)));
  const titleNames = titlesColumn ? firstColValues : body.map(() => "");
  const dataColumns = titlesColumn ? width - 1 : width;
  if (dataColumns < 1) throw new Error(`“${source}” has no data columns to import.`);
  if (titlesColumn) notes.push("The first column was read as row titles.");

  // Column names: the header's, or the table's own (A, B… / X, Y1…).
  // Duplicates and blanks take the next free name, so no column ever
  // loses its name to another.
  const headerNames = headerRow ? firstRow.slice(titlesColumn ? 1 : 0) : [];
  const xyFirst = headerRow && headerNames[0] !== undefined && headerNames[0].trim().toLowerCase() === "x";
  const fallbackName = (c: number): string => {
    if (xyFirst) return c === 0 ? "X" : `Y${c}`;
    let s = "";
    for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
    return s;
  };
  const taken = new Set<string>();
  const names: string[] = [];
  for (let c = 0; c < dataColumns; c++) {
    const base = cleanColumnName(headerNames[c] ?? "") || fallbackName(c);
    let candidate = base;
    let n = 2;
    while (taken.has(candidate)) candidate = `${base} ${n++}`;
    names.push(candidate);
    taken.add(candidate);
  }

  // An XY table: the first data column is headed "X" and holds numbers.
  const firstData = body.map((r) => r[titlesColumn ? 1 : 0] ?? "");
  const isXY =
    headerRow &&
    headerNames[0] !== undefined &&
    headerNames[0].trim().toLowerCase() === "x" &&
    firstData.some((c) => parseCell(c) !== null);
  const tableType: TableType = isXY ? "xy" : "column";
  if (isXY) notes.push("The “X” column was read as the X values, so this is an XY table.");

  const data: TableData = {
    columns: ["Title", ...names],
    rows: body.map((r, i) => {
      const row: (string | null)[] = [titleNames[i] === "" ? null : titleNames[i]];
      for (let c = 0; c < dataColumns; c++) {
        const value = r[(titlesColumn ? 1 : 0) + c] ?? "";
        row.push(value === "" ? null : value);
      }
      return row;
    }),
  };
  return { tableType, data, notes };
}

// ── Appending to an existing table ───────────────────────────────────────

/** The imported table appended to `existing`'s rows: only when the shapes
 *  match — same table type and the same number of data columns. Null
 *  otherwise, so the caller creates a new table instead of mangling one. */
export function mergeIntoTable(existing: TableData, existingType: TableType, imported: TabularTable): TableData | null {
  if (imported.tableType !== existingType) return null;
  if (imported.data.columns.length !== existing.columns.length) return null;
  return { ...existing, rows: [...existing.rows, ...imported.data.rows] };
}

// ── One entry point ──────────────────────────────────────────────────────

/** A file's contents as a table. `name` is the file's name (its extension
 *  picks the parser); `content` is its text (CSV/TXT/DAT/PRN) or bytes (.xlsx).
 *  Throws a user-facing message when the file can't be read or holds no data. */
export async function importTabularFile(name: string, content: string | Uint8Array): Promise<TabularTable> {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "xlsx") {
    if (typeof content === "string") throw new Error(`“${name}” couldn't be read as an .xlsx file.`);
    const parsed = await parseXlsx(content);
    const table = rowsToTable(parsed.sheet.rows, name);
    const notes = [
      ...(parsed.otherSheets.length
        ? [
            `Sheet “${parsed.sheet.name}” was imported; ${parsed.otherSheets.length} other sheet${parsed.otherSheets.length === 1 ? "" : "s"} (${parsed.otherSheets.map((s) => `“${s}”`).join(", ")}) ${parsed.otherSheets.length === 1 ? "was" : "were"} not imported — one file makes one table.`,
          ]
        : []),
      ...parsed.notes,
      ...table.notes,
    ];
    return { ...table, notes };
  }
  if (typeof content !== "string") throw new Error(`“${name}” couldn't be read as a text file.`);
  // The delimiter is detected even for .csv: a semicolon file (Excel in a
  // comma-decimal locale) still ends in .csv, and a comma file detects as
  // comma anyway. Tab is preferred for .txt/.tsv — and for .dat/.prn, which
  // are the same text-table shape (a Prism .prn export is tab-delimited).
  const delimiter = detectDelimiter(
    content,
    ext === "tsv" || ext === "txt" || ext === "dat" || ext === "prn" ? "\t" : ",",
  );
  return rowsToTable(parseDelimited(content, delimiter), name);
}
