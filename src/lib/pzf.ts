// Import GraphPad Prism `.pzf` files — the legacy binary format Prism 4/5
// wrote (magic `PCFFGRA4`), before `.pzfx` (Prism 6+) and `.prism` (Prism 10).
//
// Clean-room: there is no public spec and no open-source reader for `.pzf`
// (R's `pzfx`, `pypzfx` and `prismWriter` are all `.pzfx`-only), so the
// grammar here was reverse-engineered from two real public `.pzf` files
// Prism wrote (see the fixtures in tests/testdata/ and the provenance note
// in tests/checks.ts) — never from Prism's own code. GraphPad's own docs
// say only that `.pzf` is binary and "can be opened by Prism 4 or later,
// but not by other applications".
//
// What the grammar is (verified on both files, 37 columns, 325 cells):
//   * File starts with the 8-byte magic `PCFFGRA4`. A compact `.pzf` is a
//     ZIP archive (`PK`) instead — Titer doesn't read those yet (no compact
//     sample exists to verify against), so they are refused plainly.
//   * Strings are single-byte, NUL-terminated, length-prefixed:
//     `[u16 tag][u32 length incl. NUL][bytes][0x00]`. Titles use tag
//     `0x0009`; info constant names use `0x006e`, values `0x006f`.
//   * A titled block is a title string followed by tag `0x000a` and a u32
//     block length. Every titled block in the file is one of: a data table,
//     an info sheet, a results sheet, a graph, or a "list of constants"
//     link. They are told apart by CONTENT, not by title: a block is a
//     table when its span holds at least one data-column block, an info
//     sheet when it holds at least one constant pair, and anything else is
//     skipped (results/graphs/layouts — the known hard limit, reported once
//     as a warning, never faked). The same title appears twice in a file —
//     once as the table, once as a graph's reference to it — and only the
//     span with the columns is the table.
//   * A data column is a title string followed by tag `0x0010`, a u32
//     block length, `0x0000`, a u32 count, then `count` 12-byte records
//     `[u32 flag][u32 tag][f32 value, little-endian]`. The block length is
//     always `count * 12 + 6`; a block that fails that (or runs past the
//     end of its span) is not a column. The ANOVA results sheets reuse the
//     same container shape with different cell records (empty title, first
//     cell word 0x00800001) — those fail cell validation and are skipped,
//     never imported as columns, and a column-shaped match that fails any
//     check never fails the whole file: only a file that ends mid-column
//     is refused as damaged. Cell flags: bit 0 set = the cell
//     holds a value (bit 0 clear = empty, tag 0, value 0.0); bit 1 set =
//     the value is struck-through / excluded from analysis. The middle
//     `tag` u32 is uninterpreted — it correlates with value magnitude but
//     carries no value the reader needs, so it is ignored. Values are f32
//     and are written out as the shortest decimal that round-trips to the
//     same f32 bits, never the 17-digit f64 spelling.
//   * Info constants are sequential `[6e name][6f value]` pairs, with an
//     optional Mac-only `[6d 10][u32 length 4][u32 index]` trailer after
//     each value, terminated by an empty name. The "list of constants"
//     link object lists the same names in a different encoding (no 6e/6f
//     tags) — it is not an info sheet, and its `Constant` / `Value`
//     column-like blocks are not data columns, so both are skipped.
//
// What maps where:
//   * Every data table → a Column table. The legacy format records no
//     table type Titer can read (no XY/Grouped/Contingency/Survival marker
//     was found in either file — all four observed tables are multi-column
//     replicate tables), so the type is an honest warning on every table,
//     not a guess. Row titles were not observed in any table section, so
//     the Title column is empty; if a future file carries row titles they
//     will need the row-title block grammar (not yet seen).
//   * A struck-through value stays in the table as an excluded cell
//     (same encoding as `.pzfx`: `"row,col"` in `data.excluded`).
//   * An info sheet's constants come in as an info node after the tables,
//     the same as `.pzfx`.
//   * Analyses, results, graphs and layouts are NOT in the readable part
//     of the file and are never imported — they are rebuilt in Titer.
//
// Validation the parse rests on: the same measurements appear
// bit-identical in two tables each; the WT control normalises to 100 (the
// stored f32s land within 4e-6 of it); and the stored one-way ANOVA F
// (21.9297) matches the parsed data only when the struck-through value is
// excluded (including it gives 11.490, which matches nothing in the file).

import type { ProjectFilePayload } from "./project-file";
import type { ProjectNode, TableData } from "../store/types";
import { newConstantId, readInfoConstants } from "./info-sheets";
import { cleanTitle, type PzfxImport, type PzfxIssue } from "./pzfx";

/** A titled block (`0x000a`): a table, an info sheet, a results sheet, a graph… */
interface PzfBlock {
  title: string;
  /** Offset of the `0x0009` tag that starts the block's title. */
  start: number;
  /** Offset of the block's content (just past the `0x000a` tag + length). */
  contentStart: number;
}

/** One data column inside a table block. */
interface PzfColumn {
  title: string;
  values: (string | null)[];
  excluded: Set<number>;
}

const genId = (type: string) => `${type}_${Math.random().toString(36).slice(2, 10)}`;

const emptyProject = (): ProjectFilePayload => ({
  nodes: {},
  rootOrder: [],
  childOrder: {},
  activeNodeId: null,
});

const fail = (message: string): PzfxImport => ({
  project: emptyProject(),
  tables: [],
  infoSheets: [],
  issues: [{ severity: "error", message }],
});

// ── Binary helpers ───────────────────────────────────────────────────────

const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const latin1 = new TextDecoder("windows-1252");

/** A title as Prism wrote it: UTF-8 where it is UTF-8, Latin-1 otherwise
 *  (a Windows-saved file's non-ASCII titles are single-byte). */
function decodeText(raw: Uint8Array): string {
  try {
    return utf8Strict.decode(raw);
  } catch {
    return latin1.decode(raw);
  }
}

/** No control characters in a title except tab / CR / LF (Prism writes
 *  multi-line labels with a carriage return — cleanTitle collapses those). */
const TITLE_BAD = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

/**
 * A tagged string at `off`: `[u16 tag][u32 length incl. NUL][bytes][0x00]`.
 * Returns the decoded string and the offset just past it, or null when the
 * bytes at `off` are not a string with this tag.
 */
function readTaggedString(
  bytes: Uint8Array,
  view: DataView,
  off: number,
  tag: number,
  maxLen: number,
): { value: string; end: number } | null {
  if (off + 6 > bytes.length) return null;
  if (view.getUint16(off, true) !== tag) return null;
  const len = view.getUint32(off + 2, true);
  if (len < 1 || len > maxLen) return null;
  if (off + 6 + len > bytes.length) return null;
  const raw = bytes.subarray(off + 6, off + 6 + len - 1);
  if (bytes[off + 6 + len - 1] !== 0) return null;
  const value = decodeText(raw);
  if (TITLE_BAD.test(value)) return null;
  return { value, end: off + 6 + len };
}

// The f32 a value was stored as, as bits — for shortest-round-trip formatting.
const f32View = new DataView(new ArrayBuffer(4));
const f32Bits = (value: number): number => {
  f32View.setFloat32(0, value);
  return f32View.getUint32(0);
};

/**
 * The shortest decimal that parses back to the same f32 bits (at most 9
 * significant digits — a 32-bit float needs no more). `String(double)` on
 * the f64 conversion would give the 17-digit spelling (`5702.18798828125`
 * for the stored 5702.188), which is not what Prism shows.
 */
function formatF32(value: number): string {
  if (value === 0) return "0";
  const bits = f32Bits(value);
  for (let p = 1; p <= 9; p++) {
    const candidate = value.toPrecision(p);
    if (f32Bits(Number(candidate)) === bits) return String(Number(candidate));
  }
  return String(value);
}

// ── Scanning ─────────────────────────────────────────────────────────────

/**
 * Every titled block (`0x000a`) in the file, in file order. A block's span
 * runs to the next block's start (the last block runs to EOF).
 */
function scanBlocks(bytes: Uint8Array, view: DataView): PzfBlock[] {
  const blocks: PzfBlock[] = [];
  let i = 0;
  while (i + 8 <= bytes.length) {
    const title = readTaggedString(bytes, view, i, 0x0009, 4096);
    if (!title) {
      i++;
      continue;
    }
    // Just past the title: tag `0x000a` and the block length.
    if (title.end + 6 > bytes.length) break;
    if (view.getUint16(title.end, true) !== 0x000a) {
      i = title.end;
      continue;
    }
    const blockLen = view.getUint32(title.end + 2, true);
    if (blockLen < 1 || blockLen > 1_000_000) {
      i = title.end;
      continue;
    }
    blocks.push({ title: title.value, start: i, contentStart: title.end + 6 });
    i = title.end + 6;
  }
  return blocks;
}

/**
 * The data columns in `bytes[start..end)`, in file order. A column is a
 * title string followed by tag `0x0010`, a block length that is exactly
 * `count * 12 + 6`, `0x0000`, a count, and that many 12-byte records.
 * A column-shaped match that fails any of that is not a column — the file
 * holds binary regions (the ANOVA results sheets reuse the same container
 * shape with different cell records) that only look like columns — so it
 * is skipped and scanning continues past the title. Returns null only when
 * the file itself ends mid-column, which means the file is cut off.
 */
function scanColumns(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): PzfColumn[] | null {
  const columns: PzfColumn[] = [];
  let i = start;
  while (i + 8 <= end) {
    const title = readTaggedString(bytes, view, i, 0x0009, 4096);
    if (!title) {
      i++;
      continue;
    }
    if (title.end + 12 > end || view.getUint16(title.end, true) !== 0x0010) {
      i = title.end;
      continue;
    }
    const blockLen = view.getUint32(title.end + 2, true);
    const zero = view.getUint16(title.end + 6, true);
    const count = view.getUint32(title.end + 8, true);
    const recordsStart = title.end + 12;
    if (zero !== 0 || count > 100_000 || blockLen !== count * 12 + 6) {
      i = title.end;
      continue;
    }
    if (recordsStart + count * 12 > bytes.length) return null;
    if (recordsStart + count * 12 > end) {
      i = title.end;
      continue;
    }
    const values: (string | null)[] = [];
    const excluded = new Set<number>();
    let valid = true;
    for (let k = 0; k < count; k++) {
      const at = recordsStart + k * 12;
      const flag = view.getUint32(at, true);
      const value = view.getFloat32(at + 8, true);
      if (flag > 3 || !Number.isFinite(value)) {
        valid = false;
        break;
      }
      if ((flag & 1) === 0) {
        values.push(null);
      } else {
        values.push(formatF32(value));
        if ((flag & 2) !== 0) excluded.add(k);
      }
    }
    if (!valid) {
      i = title.end;
      continue;
    }
    // The "list of constants" link object's `Constant` / `Value` blocks
    // are column-shaped but hold no data values — they are not columns.
    if (title.value !== "Constant" && title.value !== "Value") {
      columns.push({ title: title.value, values, excluded });
    }
    i = recordsStart + count * 12;
  }
  return columns;
}

/**
 * The info constants in `bytes[start..end)`: sequential `[6e name][6f value]`
 * pairs, each value optionally followed by a Mac-only `[6d 10][u32 4][u32 index]`
 * trailer, terminated by an empty name. Stops at the first pair that does
 * not parse — a span without pairs simply has no constants.
 */
function scanConstants(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  end: number,
): { id: string; name: string; value: string }[] {
  const constants: { id: string; name: string; value: string }[] = [];
  let i = start;
  for (;;) {
    // The pairs do not start at the top of the span — a fixed header and
    // padding sit between the block title and the first pair — so search
    // forward for the next name tag instead of requiring it at `i`.
    let name: { value: string; end: number } | null = null;
    while (i + 6 <= end) {
      name = readTaggedString(bytes, view, i, 0x006e, 4096);
      if (name) break;
      i++;
    }
    if (!name || name.value === "") break;
    const value = readTaggedString(bytes, view, name.end, 0x006f, 100_000);
    if (!value) break;
    constants.push({ id: newConstantId(), name: name.value, value: value.value });
    i = value.end;
    // Mac-only trailer: `[6d 10][u32 length 4][u32 index]`.
    if (i + 10 <= end && view.getUint16(i, true) === 0x006d && view.getUint16(i + 2, true) === 0x0010) {
      i += 10;
    }
  }
  return constants;
}

// ── One table ────────────────────────────────────────────────────────────

function importTable(block: PzfBlock, columns: PzfColumn[], issues: PzfxIssue[]): ProjectNode | null {
  const name = cleanTitle(block.title) === "" ? "Imported table" : cleanTitle(block.title);
  const rowCount = Math.max(0, ...columns.map((c) => c.values.length));
  if (rowCount === 0 || columns.length === 0) {
    issues.push({ severity: "warning", message: `${name} holds no data. It was left out.` });
    return null;
  }
  const data: TableData = {
    columns: ["Title", ...columns.map((c) => (cleanTitle(c.title) === "" ? "Y" : cleanTitle(c.title)))],
    rows: Array.from({ length: rowCount }, (_, r) => [null, ...columns.map((c) => c.values[r] ?? null)]),
    excluded: Array.from(
      new Set(columns.flatMap((c, ci) => [...c.excluded].map((r) => `${r},${ci + 1}`))),
    ),
  };
  if (data.excluded!.length === 0) delete data.excluded;
  // The legacy format records no table type Titer can read — every table
  // imports as Column, and the report says so on each one.
  issues.push({
    severity: "warning",
    message: `“${name}”: .pzf doesn't record the table type, so it was imported as a Column table.`,
  });
  return {
    id: genId("table"),
    type: "table",
    name,
    parentId: null,
    tableType: "column",
    data,
  };
}

// ── The file ─────────────────────────────────────────────────────────────

export function parsePzf(bytes: Uint8Array): PzfxImport {
  if (bytes.length < 8) {
    return fail("This file isn't a GraphPad Prism .pzf file.");
  }
  // A compact .pzf is a ZIP archive, not the binary format — refused
  // plainly, never parsed as binary (no compact sample exists to verify
  // a ZIP-unwrapping reader against).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return fail(
      "This is a compact .pzf file (a ZIP archive). Titer can't read compact .pzf files yet — in Prism, save it again without the Compact option, or as .pzfx, and import that.",
    );
  }
  const magic = String.fromCharCode(...bytes.subarray(0, 8));
  if (magic !== "PCFFGRA4") {
    if (magic.startsWith("PCFFGRA")) {
      return fail(`This .pzf file is a version Titer doesn't read yet (magic “${magic}”).`);
    }
    return fail("This file isn't a GraphPad Prism .pzf file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks = scanBlocks(bytes, view);
  const issues: PzfxIssue[] = [];
  const tables: string[] = [];
  const infoSheets: string[] = [];
  const nodes: Record<string, ProjectNode> = {};
  const rootOrder: string[] = [];
  const childOrder: Record<string, string[]> = {};
  let skipped = 0;
  for (let b = 0; b < blocks.length; b++) {
    const block = blocks[b];
    const spanEnd = b + 1 < blocks.length ? blocks[b + 1].start : bytes.length;
    const columns = scanColumns(bytes, view, block.contentStart, spanEnd);
    if (columns === null) {
      return fail("This .pzf file looks damaged (a data column ends mid-way) — it couldn't be imported.");
    }
    if (columns.length > 0) {
      const node = importTable(block, columns, issues);
      if (!node) continue;
      nodes[node.id] = node;
      rootOrder.push(node.id);
      childOrder[node.id] = [];
      tables.push(node.name);
      continue;
    }
    const constants = scanConstants(bytes, view, block.contentStart, spanEnd);
    if (constants.length > 0) {
      const title = cleanTitle(block.title);
      const node: ProjectNode = {
        id: genId("info"),
        type: "info",
        name: title === "" ? "Project info" : title,
        parentId: null,
        info: { constants: readInfoConstants(constants), notes: "", linkedTableId: null },
      };
      nodes[node.id] = node;
      rootOrder.push(node.id);
      infoSheets.push(node.name);
      continue;
    }
    // A results sheet, a graph, a layout, or the "list of constants" link
    // — no data columns and no constants, so there is nothing to import.
    // Counted once for the summary warning below, never faked as a table.
    skipped++;
  }
  if (skipped > 0) {
    issues.push({
      severity: "warning",
      message:
        "Analyses, graphs and layouts in this file weren't imported — only data tables and info sheets come across; rebuild analyses and graphs in Titer.",
    });
  }
  if (tables.length === 0 && issues.every((i) => i.severity === "warning")) {
    issues.unshift({ severity: "error", message: "No tables in this file could be imported." });
  }
  return {
    project: { nodes, rootOrder, childOrder, activeNodeId: rootOrder[0] ?? null },
    tables,
    infoSheets,
    issues,
  };
}
