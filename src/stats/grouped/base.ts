// Shared reading for Grouped-table tests. A column "A:Y1" belongs to group "A"
// (see `groupsOf`); the row is the table's other, implicit factor. Unlike the
// Column-table tests (one column = one independent group), these need every
// observation tagged by BOTH its group and its row.
import type { Column } from "../types";
import type { RowGroup } from "../../store/types";
import { groupsOf } from "../../lib/dataset";
import { seriesKeyOf } from "../../lib/columns";

const rowCount = (columns: Column[]) => columns[0]?.byRow.length ?? 0;

/** A row's name in results: its title, as in Prism, or "Row n" when it has none. */
export const rowName = (titles: (string | null)[], r: number) => titles[r]?.trim() || `Row ${r + 1}`;

/** A group's numbers at one row (its replicate columns' values there). */
function rowValues(block: Column[], row: number): number[] {
  return block.flatMap((c) => (c.byRow[row] == null ? [] : [c.byRow[row]!]));
}

/** Every replicate observation, tagged by column-group and row position — the
 *  (Group × Row) shape a two-way ANOVA needs. */
export function flattenGrouped(columns: Column[]): { values: number[]; group: string[]; row: string[] } {
  const values: number[] = [];
  const group: string[] = [];
  const row: string[] = [];
  for (const g of groupsOf(columns)) {
    for (let r = 0; r < rowCount(columns); r++) {
      for (const v of rowValues(g.columns, r)) {
        values.push(v);
        group.push(g.name);
        row.push(`R${r + 1}`);
      }
    }
  }
  return { values, group, row };
}

/** A row band with its start row resolved: `rowGroups` counts, laid end to end. */
export interface RowGroupBand {
  name: string;
  start: number;
  count: number;
}

/** `rowGroups` as bands with start rows (undefined when the table has no third
 *  factor). Tiling against the row count is the runner's check, not this one's. */
export function rowGroupBands(rowGroups: RowGroup[] | undefined): RowGroupBand[] | undefined {
  if (!rowGroups?.length) return undefined;
  let start = 0;
  return rowGroups.map(({ name, count }) => {
    const band = { name, start, count };
    start += count;
    return band;
  });
}

/** Every replicate observation, tagged by column-group (A), row position within
 *  its band (B) and band (C) — the (A × B × C) shape a three-way ANOVA needs.
 *  Missing cells are dropped per-observation (same as `flattenGrouped`);
 *  `dropped` counts the empty cells left out. */
export function flattenThreeWay(
  columns: Column[],
  bands: RowGroupBand[],
): { values: number[]; a: string[]; b: string[]; c: string[]; dropped: number } {
  const values: number[] = [];
  const a: string[] = [];
  const b: string[] = [];
  const c: string[] = [];
  let dropped = 0;
  for (const g of groupsOf(columns)) {
    for (const band of bands) {
      for (let r = 0; r < band.count; r++) {
        const row = band.start + r;
        for (const col of g.columns) {
          const v = col.byRow[row];
          if (v == null) dropped++;
          else {
            values.push(v);
            a.push(g.name);
            b.push(`R${r + 1}`);
            c.push(band.name);
          }
        }
      }
    }
  }
  return { values, a, b, c, dropped };
}

/** One level (or level combination) of a three-way term: its result-table
 *  label, the label a Dunnett control is matched by inside a simple-effect
 *  family (`within` — the term without its last factor: an A level for A:B,
 *  an A:B cell for A:B:C; for a whole-term family the control is matched by
 *  the full `label` instead), the level of the term's last factor the
 *  simple-effect split puts it in (`split`), and the values behind it. */
export interface ThreeWayTermCell {
  label: string;
  within: string;
  split: string;
  values: number[];
}

/** The cell means of one three-way term, in first-seen order — the wizard's
 *  Dunnett-control options and the runner's post-hoc families read the same
 *  labels from here, so the two can never drift apart. */
export function threeWayTermCells(
  term: string,
  flat: { values: number[]; a: string[]; b: string[]; c: string[] },
  titles: (string | null)[],
): ThreeWayTermCell[] {
  const byKey = new Map<string, ThreeWayTermCell>();
  const bLabel = (b: string) => rowName(titles, Number(b.slice(1)) - 1);
  // Each component's key and label: [key, label, within-label]. The within
  // label drops the term's last factor — so a Dunnett control names the level
  // compared within each simple-effect family (an A level for A:B, an A:B cell
  // for A:B:C), and the whole cell for a whole-term family.
  const partsOf = (i: number): [string, string][] => {
    const a = flat.a[i];
    const b = flat.b[i];
    const c = flat.c[i];
    switch (term) {
      case "A":
        return [[a, a]];
      case "B":
        return [[b, bLabel(b)]];
      case "C":
        return [[c, c]];
      case "A:B":
        return [
          [a, a],
          [b, bLabel(b)],
        ];
      case "A:C":
        return [
          [a, a],
          [c, c],
        ];
      case "B:C":
        return [
          [b, bLabel(b)],
          [c, c],
        ];
      case "A:B:C":
        return [
          [a, a],
          [b, bLabel(b)],
          [c, c],
        ];
      default:
        return [[a, a]];
    }
  };
  const joinLabel = (parts: [string, string][], dropLast: boolean) => {
    const kept = dropLast ? parts.slice(0, -1) : parts;
    if (kept.length === 0) return parts[0][1];
    const [first, ...rest] = kept.map(([, label]) => label);
    return rest.length ? `${first} (${rest.join(", ")})` : first;
  };
  flat.values.forEach((v, i) => {
    const parts = partsOf(i);
    const key = parts.map(([k]) => k).join("\n");
    const cell = byKey.get(key) ?? {
      label: joinLabel(parts, false),
      within: joinLabel(parts, true),
      split: parts[parts.length - 1][0],
      values: [] as number[],
    };
    cell.values.push(v);
    byKey.set(key, cell);
  });
  // Keep the cells in first-seen order: A, B and C levels in table order, and
  // interactions in the same (A, then B, then C) nesting as the flattened data.
  return [...byKey.values()];
}

/** Each group's rows, each holding that row's own replicate values — what
 *  per-row comparisons (Multiple t tests) run against. */
export function groupRows(columns: Column[]): Map<string, number[][]> {
  return new Map(
    groupsOf(columns).map((g) => [
      g.name,
      Array.from({ length: rowCount(columns) }, (_, r) => rowValues(g.columns, r)),
    ]),
  );
}

/** Two groups' rows, paired by replicate column position (the i-th column of
 *  group A with the i-th column of group B) — what a paired per-row test needs,
 *  unlike `groupRows` (which filters each row's blanks independently per group,
 *  losing column identity). `undefined` unless the table has exactly 2 groups. */
export function pairedGroupRows(
  columns: Column[],
): { name1: string; name2: string; rowsA: number[][]; rowsB: number[][] } | undefined {
  const groups = groupsOf(columns);
  if (groups.length !== 2) return undefined;
  const [a, b] = groups;
  const n = Math.min(a.columns.length, b.columns.length);
  const rowsA: number[][] = [];
  const rowsB: number[][] = [];
  for (let r = 0; r < rowCount(columns); r++) {
    rowsA.push([]);
    rowsB.push([]);
    for (let k = 0; k < n; k++) {
      const va = a.columns[k].byRow[r];
      const vb = b.columns[k].byRow[r];
      if (va != null && vb != null) {
        rowsA[r].push(va);
        rowsB[r].push(vb);
      }
    }
  }
  return { name1: a.name, name2: b.name, rowsA, rowsB };
}

/** The subjects of a repeated-measures (row-matched) two-way ANOVA: each replicate
 *  column is one subject, measured at every row within its group. Those missing a row are
 *  left out whole (`dropped` counts them), as the Friedman test leaves out incomplete rows.
 *  Only the rows holding a value count: an empty row is no row of the design. */
export function completeSubjects(columns: Column[]): { subjects: Column[]; rows: number[]; dropped: number } {
  const rows = Array.from({ length: rowCount(columns) }, (_, r) => r).filter((r) =>
    columns.some((c) => c.byRow[r] != null),
  );
  const all = groupsOf(columns).flatMap((g) => g.columns);
  const subjects = all.filter((c) => rows.every((r) => c.byRow[r] != null));
  return { subjects, rows, dropped: all.length - subjects.length };
}

/** Flattened (Group × Row × Subject) observations of the complete subjects, subject by
 *  subject, rows in order. */
export function flattenRepeated(columns: Column[]): {
  values: number[];
  group: string[];
  row: string[];
  subject: string[];
  dropped: number;
} {
  const { subjects, rows, dropped } = completeSubjects(columns);
  const values: number[] = [];
  const group: string[] = [];
  const row: string[] = [];
  const subject: string[] = [];
  for (const col of subjects) {
    const g = seriesKeyOf(col.name);
    rows.forEach((r) => {
      values.push(col.byRow[r]!);
      group.push(g);
      row.push(`R${r + 1}`);
      subject.push(`${g}:${col.name}`);
    });
  }
  return { values, group, row, subject, dropped };
}
