// "Select and transform" (seq 177): build a new Multiple Variables table
// from a subset of one (Prism's Analyze > Select and transform). Pure
// TypeScript, no R: values are only selected or computed, never fitted.
// The source table is never touched: the new table's data rides in the
// result's `extracted` table, and the results view offers "Create table"
// to add it to the project as a real table.
//
// Prism's rules (Prism 10 User Guide, "Select and transform multiple
// variable tables"): three tabs — Transform columns (per-variable
// transforms into new columns, plus equations combining columns into new
// ones), Select rows (a row-number range; rows where a variable's value
// compares to a number; rows where one variable compares to another —
// every criterion given must hold), Select columns (which variables to
// include, in order). A transform's source need not itself be selected:
// only its new column lands in the output. A summary transform (min, max,
// mean, stdev, stderr) broadcasts its value — over the kept rows — to
// every kept row. Equations run in the Calculated Variables formula
// language, and may name a transformed column (a name with spaces or
// punctuation needs brackets, e.g. `[Weight x2]`). A value that has no
// transform (a log of 0, a division by zero) is blank, as a transform's is.
import type {
  AnalysisOutcome,
  SelectTransformKind,
  SelectTransformOperator,
  SelectTransformParams,
} from "../types";
import { SELECT_TRANSFORM_KINDS, SELECT_TRANSFORM_NEEDS_K, SELECT_TRANSFORM_OPERATORS } from "../types";
import type { Column } from "../../lib/dataset";
import type { TableData } from "../../store/types";
import { maxOf, mean, minOf, sd, sem } from "../../lib/summary";
import { recomputeCalculated, validateFormula } from "../../lib/calcvars";

/** A value as a cell holds it: 10 significant digits, readable and far finer than any test needs. */
const cell = (v: number | null) => (v == null || !Number.isFinite(v) ? null : String(Number(v.toPrecision(10))));

/** A column the wizard named is gone (renamed away after the wizard ran). */
const gone = (name: string) =>
  `“${name}” is no longer in the table — run the analysis again and pick the variables.`;

/** The cell's text, trimmed — undefined when blank (or excluded). */
const textOf = (cellValue: string | null | undefined): string | undefined => {
  const t = cellValue?.trim();
  return t ? t : undefined;
};

/** A value's text as the new table holds it (the raw text as typed). */
const valueText = (column: Column, r: number): string | null =>
  textOf(column.cells[r]) ?? (column.byRow[r] == null ? null : String(column.byRow[r]));

/** Whether `kind` is one of the offered transforms. */
const isKind = (kind: string): kind is SelectTransformKind =>
  (SELECT_TRANSFORM_KINDS as readonly string[]).includes(kind);

/** Whether `op` is one of the offered comparisons. */
const isOperator = (op: string): op is SelectTransformOperator =>
  (SELECT_TRANSFORM_OPERATORS as readonly string[]).includes(op);

export async function runSelectTransform(
  columns: Column[],
  params: SelectTransformParams | undefined,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  const p = params ?? {};
  const byName = new Map(columns.map((c) => [c.name, c]));
  const rowCount = titles.length;
  const allNames = columns.map((c) => c.name);
  /** The closing line every result carries: the source table is untouched. */
  const notes = (detail: string) =>
    `${detail} The source table is unchanged — use “Create table” below to add the new table to the project, then graph or analyse it.`;

  // ── Select columns ────────────────────────────────────────────────
  const keptNames = p.columns ?? allNames;
  if (keptNames.length === 0) return { error: "Pick at least one variable to include in the new table." };
  const seen = new Set<string>();
  for (const name of keptNames) {
    if (!byName.has(name)) return { error: gone(name) };
    if (seen.has(name)) return { error: `“${name}” is picked twice — each variable goes in the new table once.` };
    seen.add(name);
  }
  const kept = keptNames.map((name) => byName.get(name)!);

  // ── Row range ─────────────────────────────────────────────────────
  let first = 0;
  let last = rowCount - 1;
  if (p.rowRange !== undefined) {
    const { first: f, last: l } = p.rowRange;
    const outside = (n: number) => !Number.isInteger(n) || n < 1 || n > rowCount;
    if (outside(f)) return { error: `Row ${f} is not in the table — rows run from 1 to ${rowCount}.` };
    if (outside(l)) return { error: `Row ${l} is not in the table — rows run from 1 to ${rowCount}.` };
    if (f > l)
      return { error: `The first row (${f}) comes after the last row (${l}) — pick a range that starts first.` };
    first = f - 1;
    last = l - 1;
  }

  // ── Row filters ───────────────────────────────────────────────────
  const pick = (name: string): Column | string => byName.get(name) ?? gone(name);
  const isError = (value: Column | string): value is string => typeof value === "string";
  let rowFilter: Column | undefined;
  let rowFilterOp: SelectTransformOperator | undefined;
  let rowFilterValue: number | undefined;
  if (p.rowFilter !== undefined) {
    const f = p.rowFilter;
    const col = pick(f.variable, "row-filter variable");
    if (isError(col)) return { error: col };
    if (!isOperator(f.operator))
      return {
        error: `“${f.operator}” is not a comparison — pick one of: ${SELECT_TRANSFORM_OPERATORS.join(", ")}.`,
      };
    if (f.operator !== "is-not-missing" && (f.value === undefined || !Number.isFinite(f.value)))
      return {
        error: `The filter on “${f.variable}” needs a value to compare against — enter one, or pick “is-not-missing”.`,
      };
    rowFilter = col;
    rowFilterOp = f.operator;
    rowFilterValue = f.value;
  }
  let columnFilterA: Column | undefined;
  let columnFilterB: Column | undefined;
  let columnFilterOp: SelectTransformOperator | undefined;
  if (p.columnFilter !== undefined) {
    const f = p.columnFilter;
    const a = pick(f.variable, "column-filter variable");
    if (isError(a)) return { error: a };
    const b = pick(f.otherVariable, "column-filter variable");
    if (isError(b)) return { error: b };
    if (a.name === b.name)
      return { error: "The two variables must be different — pick two different variables." };
    if (f.operator === "is-not-missing" || !isOperator(f.operator))
      return {
        error: `“${f.operator}” is not a comparison between two variables — pick one of: >, <, =, >=, <=, !=.`,
      };
    columnFilterA = a;
    columnFilterB = b;
    columnFilterOp = f.operator;
  }

  /** Whether two numbers satisfy a comparison. */
  const compares = (a: number, op: SelectTransformOperator, b: number): boolean => {
    switch (op) {
      case ">":
        return a > b;
      case "<":
        return a < b;
      case "=":
        return a === b;
      case ">=":
        return a >= b;
      case "<=":
        return a <= b;
      case "!=":
        return a !== b;
      case "is-not-missing":
        return true;
    }
  };
  const keptRows: number[] = [];
  for (let r = first; r <= last; r++) {
    if (rowFilter !== undefined && rowFilterOp !== undefined) {
      if (rowFilterOp === "is-not-missing") {
        if (rowFilter.cells[r] == null) continue;
      } else {
        const v = rowFilter.byRow[r];
        if (v == null || !compares(v, rowFilterOp, rowFilterValue!)) continue;
      }
    }
    if (columnFilterA !== undefined && columnFilterB !== undefined && columnFilterOp !== undefined) {
      const a = columnFilterA.byRow[r];
      const b = columnFilterB.byRow[r];
      if (a == null || b == null || !compares(a, columnFilterOp, b)) continue;
    }
    keptRows.push(r);
  }
  if (keptRows.length === 0)
    return { error: "No rows are left after the selection — loosen the row filter or range." };

  // ── Transforms ────────────────────────────────────────────────────
  const outNames = [...keptNames];
  /** The new column's title, or the error to return for it. */
  const newTitle = (title: string | undefined, fallback: string): string | { error: string } => {
    const name = title === undefined || title.trim() === "" ? fallback : title.trim();
    if (name.includes(":")) return { error: `“${name}” cannot hold a “:” — a column name never does.` };
    if (outNames.includes(name))
      return { error: `“${name}” is already in the new table — a new variable needs a different name.` };
    return name;
  };
  const isTitleError = (value: string | { error: string }): value is { error: string } =>
    typeof value !== "string";
  interface NewColumn {
    title: string;
    values: (string | null)[];
  }
  const newColumns: NewColumn[] = [];
  for (const t of p.transforms ?? []) {
    const col = byName.get(t.variable);
    if (!col) return { error: gone(t.variable) };
    if (!isKind(t.kind))
      return {
        error: `“${t.kind}” is not a transform — pick one of: ${SELECT_TRANSFORM_KINDS.join(", ")}.`,
      };
    if (!col.values.length)
      return { error: `“${t.variable}” holds no numbers yet — pick a variable with numbers in it.` };
    const needsK = (SELECT_TRANSFORM_NEEDS_K as readonly string[]).includes(t.kind);
    if (needsK && (t.k === undefined || !Number.isFinite(t.k)))
      return { error: `The “${t.kind}” transform of “${t.variable}” needs a constant — enter a value for K.` };
    if (t.kind === "round" && (!Number.isInteger(t.k) || t.k! < 0 || t.k! > 10))
      return { error: `“round” needs a whole number of digits — got ${t.k}.` };
    const title = newTitle(t.title, `${t.kind}(${t.variable})`);
    if (isTitleError(title)) return title;
    // A summary transform reads the kept rows' values, broadcast to every kept row.
    const keptValues = keptRows.flatMap((r) => (col.byRow[r] == null ? [] : [col.byRow[r]!]));
    const summary: number | null =
      t.kind === "min"
        ? keptValues.length
          ? minOf(keptValues)
          : null
        : t.kind === "max"
          ? keptValues.length
            ? maxOf(keptValues)
            : null
          : t.kind === "mean"
            ? keptValues.length
              ? mean(keptValues)
              : null
            : t.kind === "stdev"
              ? keptValues.length > 1
                ? sd(keptValues)
                : null
              : t.kind === "stderr"
                ? keptValues.length > 1
                  ? sem(keptValues)
                  : null
                : null;
    const of = (v: number): number | null => {
      switch (t.kind) {
        case "log10":
          return v > 0 ? Math.log10(v) : null;
        case "ln":
          return v > 0 ? Math.log(v) : null;
        case "log2":
          return v > 0 ? Math.log2(v) : null;
        case "reciprocal":
          return v !== 0 ? 1 / v : null;
        case "sqrt":
          return v >= 0 ? Math.sqrt(v) : null;
        case "square":
          return v * v;
        case "exp": {
          const e = Math.exp(v);
          return Number.isFinite(e) ? e : null;
        }
        case "pow10": {
          const e = 10 ** v;
          return Number.isFinite(e) ? e : null;
        }
        case "negate":
          return -v;
        case "abs":
          return Math.abs(v);
        case "multiply":
          return v * t.k!;
        case "divide":
          return t.k !== 0 ? v / t.k! : null;
        case "add":
          return v + t.k!;
        case "subtract":
          return v - t.k!;
        case "power": {
          const e = v ** t.k!;
          return Number.isFinite(e) ? e : null;
        }
        case "round": {
          const factor = 10 ** t.k!;
          return Math.round(v * factor) / factor;
        }
        case "min":
        case "max":
        case "mean":
        case "stdev":
        case "stderr":
          return summary;
      }
    };
    newColumns.push({
      title,
      values: keptRows.map((r) => {
        const v = col.byRow[r];
        return v == null ? null : cell(of(v));
      }),
    });
    outNames.push(title);
  }

  // ── Equations ─────────────────────────────────────────────────────
  const equations = p.equations ?? [];
  for (const e of equations) {
    const name = e.name.trim();
    if (!name) return { error: "a new variable from an equation needs a name." };
    if (name.includes(":")) return { error: `“${name}” cannot hold a “:” — a column name never does.` };
    if (outNames.includes(name))
      return { error: `“${name}” is already in the new table — a new variable needs a different name.` };
    // Validated against the columns the new table holds so far, so a later
    // equation may use an earlier one, and a formula naming a gone variable
    // fails here with the formula's own message.
    const bad = validateFormula(
      { columns: ["Title", ...outNames], rows: [] },
      e.formula,
      name,
    );
    if (bad) return { error: bad };
    outNames.push(name);
  }

  // The new table: kept rows, kept variables as typed, transformed columns
  // as computed, equation columns filled in below by the formula engine.
  const baseColumns = ["Title", ...outNames];
  const baseRows = keptRows.map((r, i) => [
    titles[r] ?? "",
    ...kept.map((c) => valueText(c, r)),
    ...newColumns.map((c) => c.values[i]),
    ...equations.map(() => null as string | null),
  ]);
  let table: TableData = { columns: baseColumns, rows: baseRows };
  if (equations.length) {
    const computed = recomputeCalculated({
      ...table,
      calculated: equations.map((e) => ({ name: e.name.trim(), formula: e.formula.trim() })),
    });
    const failed = (computed.calculated ?? []).find((v) => v.error !== undefined);
    if (failed) return { error: failed.error! };
    table = computed;
  }

  const transformBits = (p.transforms ?? []).map(
    (t, i) => `transformed “${t.variable}” to “${newColumns[i].title}”`,
  );
  const equationBits = equations.map((e) => `added “${e.name.trim()}” from “${e.formula.trim()}”`);
  const clauses = [...transformBits, ...equationBits];
  return {
    testType: "select-transform",
    subtitle: "Select and transform",
    stats: [],
    groups: [],
    notes: notes(
      `Selected ${keptNames.length} of ${allNames.length} variable${allNames.length === 1 ? "" : "s"} and ${keptRows.length} of ${rowCount} row${rowCount === 1 ? "" : "s"}${clauses.length ? ` — ${clauses.join("; ")}` : ""}.`,
    ),
    extracted: { tableType: "multiple", table },
  };
}
