// Cell background colors (seq 325): Prism's paint-bucket / Change > Cell
// Background Color — color-code a single cell or a range in data or results
// tables, to flag key, surprising, or suspect values.
//
// Prism's palette is 8 named colors (verified from the Prism 11 guide's
// paint-bucket menu image: Yellow, Red, Blue, Green, Purple, Orange, Tan,
// Gray, plus None to clear). Prism publishes the names, not the RGBs, so the
// hexes below are Titer's readable tints of those names — light washes the
// value stays legible on — not a claim about Prism's exact shades. The
// stored value is always the NAME, so the shades can be tightened later
// without touching any file.
export const CELL_BACKGROUND_COLORS = ["yellow", "red", "blue", "green", "purple", "orange", "tan", "gray"] as const;
export type CellBackgroundColor = (typeof CELL_BACKGROUND_COLORS)[number];

export const CELL_BACKGROUND_LABELS: Record<CellBackgroundColor, string> = {
  yellow: "Yellow",
  red: "Red",
  blue: "Blue",
  green: "Green",
  purple: "Purple",
  orange: "Orange",
  tan: "Tan",
  gray: "Gray",
};

/** The tint a named color paints, as `#rrggbb`. */
export const CELL_BACKGROUND_HEX: Record<CellBackgroundColor, string> = {
  yellow: "#fef9c3",
  red: "#fee2e2",
  blue: "#dbeafe",
  green: "#dcfce7",
  purple: "#f3e8ff",
  orange: "#ffedd5",
  tan: "#efe7d3",
  gray: "#e5e7eb",
};

export function isCellBackgroundColor(v: unknown): v is CellBackgroundColor {
  return typeof v === "string" && (CELL_BACKGROUND_COLORS as readonly string[]).includes(v);
}

/** A data-table cell's key: `"row,col"` in full-grid coords (col 0 holds
 *  the row titles) — the same scheme as `excludedKey`. */
export function cellBackgroundKey(row: number, col: number): string {
  return `${row},${col}`;
}

/** A results-table cell's key: `"section|row|col"` — the section is the
 *  results table's title (or an explicit key for untitled tables), row/col
 *  are 0-based within that table. Colors attach to the ADDRESS, not the
 *  value: a recompute that reshapes the table leaves each color at its
 *  address (it may then point at a different value), and a recompute that
 *  keeps the shape keeps every color on its cell. */
export function resultCellBackgroundKey(section: string, row: number, col: number): string {
  return `${section}|${row}|${col}`;
}

/** Splits a results-cell key back into its section, row and column. */
export function parseResultCellBackgroundKey(key: string): { section: string; row: number; col: number } | null {
  const m = /^(.*)\|(\d+)\|(\d+)$/.exec(key);
  if (!m) return null;
  return { section: m[1], row: Number(m[2]), col: Number(m[3]) };
}
