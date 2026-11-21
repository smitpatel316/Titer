// Shared contingency-table builder: the count matrix every contingency test
// reads (each data column is a group, each row a category, built from
// complete rows), plus the validation all of them share.
import type { Column } from "../types";
import { dataGroups, pairedGroups } from "../column/base";

export interface ContingencyMatrix {
  matrix: number[][];
  rows: number;
  cols: number;
}

export function buildContingencyMatrix(columns: Column[]): ContingencyMatrix | { error: string } {
  const cols = dataGroups(columns).length;
  if (cols < 2) return { error: "A contingency table needs at least 2 group columns." };

  // Category rows = complete rows (a count in every group column).
  const groups = pairedGroups(columns);
  const matrix = (groups[0]?.values ?? []).map((_, r) => groups.map((g) => g.values[r]));
  if (matrix.flat().some((v) => v < 0)) return { error: "Counts can't be negative." };
  const part = matrix.flat().find((v) => !Number.isInteger(v));
  if (part !== undefined) return { error: `Counts must be whole numbers; the table holds ${part}.` };
  if (matrix.length < 2) {
    return { error: "A contingency table needs at least 2 rows with a count in every group column." };
  }

  const flat = matrix.flat();
  if (flat.every((v) => v === 0)) return { error: "The contingency table is empty (all counts are zero)." };
  return { matrix, rows: matrix.length, cols };
}

/** One observed distribution: a category per row holding a count, in row
 *  order. The observed-vs-expected tests (chi-square goodness of fit, the
 *  binomial test) read a single data column — a Parts-of-whole table's one
 *  column, which Prism imports as a Column table — so blank rows are simply
 *  not categories, and the row titles name them. */
export interface ObservedCounts {
  column: string;
  categories: string[];
  observed: number[];
}

export function readObservedCounts(
  columns: Column[],
  titles: (string | null)[],
): ObservedCounts | { error: string } {
  const cols = dataGroups(columns);
  if (cols.length > 1)
    return {
      error:
        `This test reads one data set of observed counts; ${cols.length} were chosen ` +
        `(${cols.map((c) => `“${c.name}”`).join(", ")}). Choose one, and run it again.`,
    };
  const col = cols[0];
  if (!col) return { error: "The table holds no counts — enter the observed counts in one data set." };
  const categories = col.rows.map((r) => titles[r] || `Row ${r + 1}`);
  return { column: col.name, categories, observed: col.values };
}
