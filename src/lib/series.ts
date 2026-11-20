// Generate X values as a series (Prism: Insert → Create Series…, and Format
// Data Table → generate X values; seq 169). Two Prism surfaces, one core:
//
// - Create Series fills any column of any table with an arithmetic series
//   (each value adds a constant step) or a geometric one (each value
//   multiplies by a constant factor), from a first value, for a chosen
//   number of values. A preselected range defaults the count to its rows.
// - Generate X values fills an XY table's X column with an arithmetic
//   series over its stored rows (Prism's version is "nearly infinite" and
//   deletes existing X values without asking; Titer fills the stored rows
//   and the UI asks first when X values would be replaced).
//
// The cap is deliberate: Prism defaults a whole-column selection to 500,000
// values, which can hang the app; 10,000 covers any real dilution series or
// time course and the dialog says so.
import type { TableData } from "../store/types";
import { writeBlock } from "../views/tables/table-data";

/** A series runs at most this many values — Prism's 500,000 default for a
 *  whole-column selection is a hang, not a feature. */
export const MAX_SERIES_VALUES = 10_000;

export type SeriesMode = "arithmetic" | "geometric";

/** First value, how it moves, and how many values: `step` is the amount
 *  added (arithmetic) or the factor multiplied by (geometric). */
export interface SeriesSpec {
  count: number;
  first: number;
  mode: SeriesMode;
  step: number;
}

/** Why `spec` cannot run, or null when it can. */
export function validateSeriesSpec(spec: SeriesSpec): string | null {
  if (!Number.isInteger(spec.count)) return "the number of values must be a whole number.";
  if (spec.count < 1) return "the number of values must be at least 1.";
  if (spec.count > MAX_SERIES_VALUES)
    return `the number of values must be at most ${MAX_SERIES_VALUES.toLocaleString()} — select fewer rows, or run it in parts.`;
  if (typeof spec.first !== "number" || !Number.isFinite(spec.first))
    return "the first value must be a number.";
  if (spec.mode !== "arithmetic" && spec.mode !== "geometric")
    return "the series must be arithmetic (add a step) or geometric (multiply by a factor).";
  if (typeof spec.step !== "number" || !Number.isFinite(spec.step))
    return "the step must be a number.";
  if (spec.mode === "geometric" && spec.step === 0)
    return "the geometric factor cannot be 0 — every value after the first would be 0.";
  try {
    uncheckedGenerate(spec);
  } catch (err) {
    return err instanceof Error ? err.message : "the series cannot be generated.";
  }
  return null;
}

/** The loop itself, after validation: throws on overflow. */
function uncheckedGenerate(spec: SeriesSpec): number[] {
  const values: number[] = [];
  let v = spec.first;
  for (let i = 0; i < spec.count; i++) {
    if (!Number.isFinite(v)) throw new Error("the series overflows — use a smaller first value, step, or count.");
    values.push(v);
    v = spec.mode === "arithmetic" ? v + spec.step : v * spec.step;
  }
  return values;
}

/** The series' values, in order. Throws the `validateSeriesSpec` message. */
export function generateSeries(spec: SeriesSpec): number[] {
  const problem = validateSeriesSpec(spec);
  if (problem) throw new Error(problem);
  return uncheckedGenerate(spec);
}

/** A series value as a cell: 10 significant figures, so 0.1 steps read
 *  "0.1", "0.2" — never 0.30000000000000004 (same rounding as calculated
 *  variables and transforms). */
export function formatSeriesValue(value: number): string {
  return String(Number(value.toPrecision(10)));
}

/** Whether any cell the series would write already holds a value — the
 *  caller asks before replacing them (Prism deletes without asking; Titer
 *  asks, once, in the dialog). */
export function seriesTargetHasValues(data: TableData, column: number, startRow: number, count: number): boolean {
  for (let r = startRow; r < startRow + count && r < data.rows.length; r++) {
    if (data.rows[r]?.[column] != null) return true;
  }
  return false;
}

/** Writes `values` into `column` starting at `startRow`, adding rows when
 *  the series runs past the stored ones. Other columns — and the row
 *  titles — are untouched. */
export function fillSeries(data: TableData, column: number, startRow: number, values: number[]): TableData {
  if (column < 1 || column >= data.columns.length)
    throw new Error(`there is no column ${column} to fill — the table has ${data.columns.length - 1} data columns.`);
  if (startRow < 0 || !Number.isInteger(startRow)) throw new Error("the start row must be a whole number from 0.");
  if (values.length === 0) return data;
  return writeBlock(
    data,
    startRow,
    column,
    values.map((v) => [formatSeriesValue(v)]),
    "column",
  );
}

/** An XY table's X column as an arithmetic series over its stored rows
 *  (Prism's Format Data Table → generate X values). Returns the table
 *  unchanged when it holds no rows, so no undo entry is left behind. */
export function generateXSeries(data: TableData, first: number, step: number): TableData {
  if (data.rows.length === 0) return data;
  return fillSeries(data, 1, 0, generateSeries({ count: data.rows.length, first, mode: "arithmetic", step }));
}
