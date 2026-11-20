// Linked paste (Prism 11, seq 168): a block of a table's cells pasted from
// a data file (CSV / TXT / XLSX) that stays linked to it, so the table
// updates when the file changes. Prism's side of it is the "Insert and
// maintain link" choice (with "Automatically update Prism when the data
// file is changed") in its Import and Paste Special dialog.
//
// A paste is raw cells — the file's rows as they are, like a plain paste —
// not seq 155's import mapping (no header detection, no new table): the
// block lands at an anchor cell of the table it was pasted into, and a
// refresh re-pastes the file into the same region. The parsers are seq
// 155's (`parseDelimited` / `parseXlsx`), so a linked source reads exactly
// as an imported one does.
import { detectDelimiter, parseDelimited, parseXlsx } from "./tabular-import";
import { columnsBeyond, writeBlock } from "../views/tables/table-data";
import type { LinkedPaste, TableData, TableType } from "../store/types";

type Cell = string | null;

/** The source-file kinds a link can name: delimited text, or an .xlsx workbook. */
export const LINKED_PASTE_KINDS = ["csv", "xlsx"] as const;
export type LinkedPasteKind = (typeof LINKED_PASTE_KINDS)[number];

/** A link as a hand-edited `.hlx` file holds it — or undefined, when it
 *  isn't one (a missing field, a path that isn't a string, a bad kind, a
 *  shape that can't hold a block). Only the known fields come back, so a
 *  file can't smuggle anything else in under the link's name. */
export function readLinkedPaste(raw: unknown): LinkedPaste | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const { sourcePath, sourceName, kind, row, col, rows, cols, autoUpdate } = o;
  if (typeof sourcePath !== "string" || !sourcePath) return undefined;
  if (typeof sourceName !== "string" || !sourceName) return undefined;
  if (kind !== "csv" && kind !== "xlsx") return undefined;
  const whole = (v: unknown, min: number): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= min;
  if (!whole(row, 0) || !whole(col, 0) || !whole(rows, 1) || !whole(cols, 1)) return undefined;
  if (typeof autoUpdate !== "boolean") return undefined;
  return { sourcePath, sourceName, kind, row, col, rows, cols, autoUpdate };
}

/** A source file's rows as a paste block ("" = empty, like a pasted blank).
 *  Throws a user-facing message when the file holds no data or isn't a
 *  workbook it can read — the same wording the importer uses. */
export async function parseLinkedSource(name: string, content: string | Uint8Array): Promise<Cell[][]> {
  let rows: string[][];
  if (name.toLowerCase().endsWith(".xlsx")) {
    if (typeof content === "string") throw new Error(`“${name}” couldn't be read as an .xlsx file.`);
    rows = (await parseXlsx(content)).sheet.rows;
  } else {
    if (typeof content !== "string") throw new Error(`“${name}” couldn't be read as a text file.`);
    rows = parseDelimited(content, detectDelimiter(content, name.toLowerCase().endsWith(".tsv") ? "\t" : ","));
  }
  // Trailing empty rows are the file's padding, not data (parseDelimited
  // already drops the final newline's); a file of nothing but padding has
  // no block to paste.
  while (rows.length && rows[rows.length - 1].every((c) => c === "")) rows.pop();
  if (rows.length === 0) throw new Error(`“${name}” has no data to import.`);
  return rows.map((r) => r.map((c) => (c === "" ? null : c)));
}

/** The cells the link covers now, as a `rows` × `cols` block (null past the
 *  table's stored rows — a block the user cleared reads back blank). */
export function linkedBlockOf(data: TableData, link: LinkedPaste): Cell[][] {
  return Array.from({ length: link.rows }, (_, i) =>
    Array.from({ length: link.cols }, (_, j) => data.rows[link.row + i]?.[link.col + j] ?? null),
  );
}

/** Two blocks are the same shape with the same cells. */
export function blocksEqual(a: Cell[][], b: Cell[][]): boolean {
  return (
    a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((c, j) => c === b[i][j]))
  );
}

/** Re-pastes `block` into the link's region and returns the table with the
 *  link's shape updated to the block's. A smaller block blanks the cells
 *  the source no longer covers (a row title the source never owned stays);
 *  a larger block grows the table, as a paste does. A grouped table takes
 *  only the columns it has — `droppedColumns` counts the rest, like the
 *  grid's own "Some Values Weren't Pasted" alert. An unchanged source
 *  returns the table itself (`changed: false`), so a refresh that finds
 *  nothing new leaves no undo step and no dirty flag. */
export function applyLinkedBlock(
  data: TableData,
  link: LinkedPaste,
  block: Cell[][],
  type: TableType,
): { data: TableData; changed: boolean; droppedColumns: number } {
  if (block.length === 0) return { data, changed: false, droppedColumns: 0 };
  const droppedColumns = columnsBeyond(data, link.col, block);
  const blockWidth = block.reduce((w, row) => Math.max(w, row.length), 0);
  // A grouped table's written width is what it has room for, not the block's.
  const writtenCols = droppedColumns > 0 ? Math.max(0, data.columns.length - link.col) : blockWidth;
  let next = writeBlock(data, link.row, link.col, block, type);
  // Blank what the source no longer covers: rows past the new block, and
  // columns past its width, inside the old region only.
  const blank = (r0: number, r1: number, c0: number, c1: number) => {
    for (let r = r0; r <= r1; r++) {
      const row = next.rows[r];
      if (!row) continue;
      const line = [...row];
      for (let c = c0; c <= Math.min(c1, line.length - 1); c++) line[c] = null;
      next = { ...next, rows: next.rows.map((old, i) => (i === r ? line : old)) };
    }
  };
  if (block.length < link.rows) blank(link.row + block.length, link.row + link.rows - 1, link.col, link.col + link.cols - 1);
  if (writtenCols < link.cols) {
    blank(link.row, link.row + Math.min(block.length, link.rows) - 1, link.col + writtenCols, link.col + link.cols - 1);
  }
  // Clearing a cell drops its exclusion (writeBlock does that for the
  // cells it wrote; the blanked leftovers need the same, or an empty cell
  // keeps a phantom `*` — see table-data.ts #21).
  const excluded = new Set(next.excluded);
  let droppedExclusion = false;
  for (let r = link.row; r < link.row + link.rows; r++) {
    for (let c = link.col; c < link.col + link.cols; c++) {
      if (next.rows[r]?.[c] == null && excluded.delete(`${r},${c}`)) droppedExclusion = true;
    }
  }
  if (droppedExclusion) next = { ...next, excluded: excluded.size ? [...excluded] : undefined };
  const nextLink: LinkedPaste = { ...link, rows: block.length, cols: writtenCols };
  next = { ...next, linkedPaste: nextLink };
  const changed =
    JSON.stringify(next.rows) !== JSON.stringify(data.rows) ||
    JSON.stringify(next.columns) !== JSON.stringify(data.columns) ||
    nextLink.rows !== link.rows ||
    nextLink.cols !== link.cols;
  return { data: changed ? next : data, changed, droppedColumns };
}

/** Re-reads a source file's contents into the link's region: the parse +
 *  apply every refresh path shares (grid, project open, MCP). Throws the
 *  parse's user-facing message when the file can't be read as data. */
export async function refreshLinked(
  data: TableData,
  link: LinkedPaste,
  content: string | Uint8Array,
  type: TableType,
): Promise<{ data: TableData; changed: boolean; droppedColumns: number }> {
  return applyLinkedBlock(data, link, await parseLinkedSource(link.sourceName, content), type);
}

/** The link after `count` rows/columns are inserted at `at` on `axis`: the
 *  anchor moves down/right with its values when the insert lands at or
 *  above/before it, and stays when the insert is past it. */
export function linkedPasteAfterInsert(
  link: LinkedPaste,
  axis: "row" | "col",
  at: number,
  count: number,
): LinkedPaste {
  if (axis === "row") return link.row >= at ? { ...link, row: link.row + count } : link;
  return link.col >= at ? { ...link, col: link.col + count } : link;
}

/** The link after `count` rows/columns are deleted from `at` on `axis` —
 *  or undefined, when the deletion takes the anchor itself: the region no
 *  longer lines up with the source, so the link goes rather than refresh
 *  into the wrong cells. A deletion past the anchor pulls it up/left. */
export function linkedPasteAfterDelete(
  link: LinkedPaste,
  axis: "row" | "col",
  at: number,
  count: number,
): LinkedPaste | undefined {
  if (axis === "row") {
    if (link.row >= at && link.row < at + count) return undefined;
    return link.row >= at + count ? { ...link, row: link.row - count } : link;
  }
  if (link.col >= at && link.col < at + count) return undefined;
  return link.col >= at + count ? { ...link, col: link.col - count } : link;
}
