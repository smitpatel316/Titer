// "Extract and rearrange" (v2, item 10): build a new XY / Column / Grouped /
// Contingency table from a subset of a Multiple Variables table (Prism's
// Analyze > Extract and rearrange). Pure TypeScript, no R: the values are only
// moved, never computed. The source table is never touched: the new table's
// data rides in the result's `extracted` table, and the results view offers
// "Create table" to add it to the project as a real table.
//
// Prism's rules (Prism 10 User Guide, "Extract and rearrange from multiple
// variable tables"): pick the target table type, then which variables fill
// it — a response, a grouping variable (XY/Column), a subject variable
// (replicate sub-columns, or the rows of a Column table), row titles, and
// for Grouped a row and a column factor, for Contingency a row and a column
// variable with an optional count. Levels are the raw cell text (trimmed),
// in first-appearance order — a grouping variable may hold integer codes or
// text levels ("Female"/"Male"). "Include variable names as prefixes" makes
// level-derived titles read "Variable = Level"; "Only include complete
// rows" condenses XY/Column to the distinct values (off: one output row per
// source row). A Contingency cell counts its source rows (+count each), and
// a negative or non-integer count is not used.
import type { AnalysisOutcome, ExtractRearrangeParams } from "../types";
import { orderLevels, type Column } from "../../lib/dataset";
import type { TableData } from "../../store/types";
import { GROUPED_LIMITS } from "../../store/types";

/** A table holds at most 20 sub-columns per data set (Helix's replicate cap). */
const MAX_SUBCOLUMNS = GROUPED_LIMITS.replicates.max;

/** A column the wizard named is gone (renamed away after the wizard ran). */
const gone = (name: string) =>
  `“${name}” is no longer in the table — run the analysis again and pick the variables.`;

/** The cell's text, trimmed — undefined when blank (or excluded). */
const textOf = (cell: string | null | undefined): string | undefined => {
  const t = cell?.trim();
  return t ? t : undefined;
};

/** Distinct non-blank cell texts, in first-appearance order — or in the
 *  column's stored level order (seq 340) when it has one. */
function levelsOf(column: Column): string[] {
  const seen = new Set<string>();
  const levels: string[] = [];
  for (const cell of column.cells) {
    const t = textOf(cell);
    if (t !== undefined && !seen.has(t)) {
      seen.add(t);
      levels.push(t);
    }
  }
  return orderLevels(levels, column.levelOrder);
}

/** A level inside a column name: ":" would read as a sub-column separator
 *  ("A:Y1"), so it is sanitised to "-". Row titles keep the raw level. */
const safeLevel = (level: string) => level.replace(/:/g, "-");

/** A level-derived column name, with its variable name in front when asked. */
const columnTitle = (variable: string, level: string, prefix: boolean) =>
  prefix ? `${variable} = ${safeLevel(level)}` : safeLevel(level);

/** A level-derived row title, with its variable name in front when asked. */
const rowTitle = (variable: string, level: string, prefix: boolean) =>
  prefix ? `${variable} = ${level}` : level;

/** Too many subjects to become sub-columns (XY/Grouped) or rows (Column). */
const subjectCapError = (subject: Column, levels: string[]): string | undefined =>
  levels.length > MAX_SUBCOLUMNS
    ? `“${subject.name}” has ${levels.length} subjects — a table holds at most 20 subcolumns per data set.`
    : undefined;

export async function runExtractRearrange(
  columns: Column[],
  params: ExtractRearrangeParams | undefined,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  if (!params)
    return {
      error: "Pick what kind of table the extracted data should become — XY, Column, Grouped or Contingency.",
    };
  const target = params.target;
  if (target !== "xy" && target !== "column" && target !== "grouped" && target !== "contingency") {
    return {
      error: "Pick what kind of table the extracted data should become — XY, Column, Grouped or Contingency.",
    };
  }
  const byName = new Map(columns.map((c) => [c.name, c]));
  const rowCount = titles.length;
  const prefix = params.prefixNames === true;
  const complete = params.completeRows !== false;

  /** The named column, or the error to return for it. */
  const pick = (name: string | undefined, role: string): Column | string => {
    if (name === undefined) return `Pick a ${role} — run the analysis again and choose the variables.`;
    return byName.get(name) ?? gone(name);
  };
  const isError = (value: Column | string | undefined): value is string => typeof value === "string";
  /** The named column when given, or the error to return for it. */
  const pickOptional = (name: string | undefined, role: string): Column | string | undefined => {
    if (name === undefined) return undefined;
    return pick(name, role);
  };
  /** This row's level in a column (undefined: no column, or a blank cell). */
  const at = (r: number, column: Column | undefined): string | undefined =>
    column === undefined ? undefined : textOf(column.cells[r]);
  /** A value's text as the new table holds it (the raw text as typed). */
  const valueText = (column: Column, r: number): string => textOf(column.cells[r]) ?? String(column.byRow[r]);
  /** The closing line every result carries: the source table is untouched. */
  const notes = (detail: string) =>
    `${detail} The source table is unchanged — use “Create table” below to add the new table to the project, then graph or analyse it.`;

  if (target === "xy") {
    const x = pick(params.x, "X variable");
    if (isError(x)) return { error: x };
    const response = pick(params.response, "response variable");
    if (isError(response)) return { error: response };
    const grouping = pickOptional(params.grouping, "grouping variable");
    if (isError(grouping)) return { error: grouping };
    const subject = pickOptional(params.subject, "subject variable");
    if (isError(subject)) return { error: subject };
    const rowTitles = pickOptional(params.rowTitles, "row-titles variable");
    if (isError(rowTitles)) return { error: rowTitles };
    if (!x.values.length)
      return {
        error: `“${x.name}”, the X variable, holds no numbers yet — pick an X variable with numbers in it.`,
      };
    if (!response.values.length)
      return {
        error: `“${response.name}” holds no numbers yet — pick a response variable with numbers in it.`,
      };
    const groupLevels = grouping ? levelsOf(grouping) : [];
    if (grouping && !groupLevels.length)
      return {
        error: `“${grouping.name}” has no levels yet — pick a grouping variable with values in it.`,
      };
    const subjectLevels = subject ? levelsOf(subject) : [];
    const cap = subject ? subjectCapError(subject, subjectLevels) : undefined;
    if (cap) return { error: cap };

    // One data set per grouping level (or one, named for the response), one
    // sub-column per subject (global first-appearance order).
    const datasets = groupLevels.length
      ? groupLevels.map((level) => ({ level, name: columnTitle(grouping!.name, level, prefix) }))
      : [{ level: undefined as string | undefined, name: response.name }];
    const subjects = subjectLevels.length ? subjectLevels : [undefined as string | undefined];
    const table: TableData = {
      columns: [
        "Title",
        "X",
        ...datasets.flatMap((d) =>
          subjectLevels.length ? subjectLevels.map((_, k) => `${d.name}:Y${k + 1}`) : [d.name],
        ),
      ],
      rows: [],
      ...(subjectLevels.length ? { groups: datasets.length, replicates: subjectLevels.length } : {}),
    };
    // The first matching response, keyed by X value + data set + subject.
    const valueAt = new Map<string, string>();
    for (let r = 0; r < rowCount; r++) {
      const v = x.byRow[r];
      const y = response.byRow[r];
      if (v == null || y == null) continue;
      const di = groupLevels.length ? groupLevels.indexOf(at(r, grouping) ?? "") : 0;
      const si = subjectLevels.length ? subjectLevels.indexOf(at(r, subject) ?? "") : 0;
      if (di === -1 || si === -1) continue;
      const key = `${v}|${di}|${si}`;
      if (!valueAt.has(key)) valueAt.set(key, valueText(response, r));
    }
    if (complete) {
      // Distinct X values, first-appearance order, labelled as first typed.
      const xSeen = new Map<number, string>();
      for (let r = 0; r < rowCount; r++) {
        const v = x.byRow[r];
        if (v != null && !xSeen.has(v)) xSeen.set(v, textOf(x.cells[r]) ?? String(v));
      }
      table.rows = [...xSeen].map(([v, label]) => [
        "",
        label,
        ...datasets.flatMap((_, di) => subjects.map((_, si) => valueAt.get(`${v}|${di}|${si}`) ?? null)),
      ]);
    } else {
      // One output row per source row, each value in its own data set / sub-column.
      table.rows = Array.from({ length: rowCount }, (_, r) => {
        const di = groupLevels.length ? groupLevels.indexOf(at(r, grouping) ?? "") : 0;
        const si = subjectLevels.length ? subjectLevels.indexOf(at(r, subject) ?? "") : 0;
        const y = response.byRow[r];
        return [
          rowTitles ? (textOf(rowTitles.cells[r]) ?? "") : "",
          x.byRow[r] == null ? null : (textOf(x.cells[r]) ?? String(x.byRow[r])),
          ...datasets.flatMap((_, d) =>
            subjects.map((_, s) =>
              d === di && s === si && y != null ? valueText(response, r) : null,
            ),
          ),
        ];
      });
    }
    return {
      testType: "extract-rearrange",
      subtitle: "Extract and rearrange",
      stats: [],
      groups: [],
      notes: notes(
        `Extracted an XY table: “${response.name}” against “${x.name}” — ${datasets.length} data set${datasets.length === 1 ? "" : "s"}, ${subjects.length} subcolumn${subjects.length === 1 ? "" : "s"} each, ${table.rows.length} row${table.rows.length === 1 ? "" : "s"}.`,
      ),
      extracted: { tableType: "xy", table },
    };
  }

  if (target === "column") {
    const response = pick(params.response, "response variable");
    if (isError(response)) return { error: response };
    const grouping = pickOptional(params.grouping, "grouping variable");
    if (isError(grouping)) return { error: grouping };
    const subject = pickOptional(params.subject, "subject variable");
    if (isError(subject)) return { error: subject };
    const rowTitles = pickOptional(params.rowTitles, "row-titles variable");
    if (isError(rowTitles)) return { error: rowTitles };
    if (!response.values.length)
      return {
        error: `“${response.name}” holds no numbers yet — pick a response variable with numbers in it.`,
      };
    const groupLevels = grouping ? levelsOf(grouping) : [];
    if (grouping && !groupLevels.length)
      return {
        error: `“${grouping.name}” has no levels yet — pick a grouping variable with values in it.`,
      };
    const subjectLevels = subject ? levelsOf(subject) : [];
    const cap = subject ? subjectCapError(subject, subjectLevels) : undefined;
    if (cap) return { error: cap };

    // One column per grouping level (or one, named for the response).
    const datasets = groupLevels.length
      ? groupLevels.map((level) => ({ level, name: columnTitle(grouping!.name, level, prefix) }))
      : [{ level: undefined as string | undefined, name: response.name }];
    const table: TableData = { columns: ["Title", ...datasets.map((d) => d.name)], rows: [] };
    // The first matching response, keyed by subject + column.
    const valueAt = new Map<string, string>();
    for (let r = 0; r < rowCount; r++) {
      const y = response.byRow[r];
      if (y == null) continue;
      const si = subjectLevels.length ? subjectLevels.indexOf(at(r, subject) ?? "") : 0;
      const di = groupLevels.length ? groupLevels.indexOf(at(r, grouping) ?? "") : 0;
      if (si === -1 || di === -1) continue;
      const key = `${si}|${di}`;
      if (!valueAt.has(key)) valueAt.set(key, valueText(response, r));
    }
    if (subject && complete) {
      // The same subject lands on the same row across the group columns.
      table.rows = subjectLevels.map((s, si) => {
        let title = s;
        if (rowTitles) {
          for (let r = 0; r < rowCount; r++) {
            if (at(r, subject) === s) {
              title = textOf(rowTitles.cells[r]) ?? s;
              break;
            }
          }
        }
        return [title, ...datasets.map((_, di) => valueAt.get(`${si}|${di}`) ?? null)];
      });
    } else if (!subject && complete) {
      // Values stack in first-appearance order, one column per group.
      const stacks = datasets.map(() => [] as string[]);
      for (let r = 0; r < rowCount; r++) {
        const y = response.byRow[r];
        if (y == null) continue;
        const di = groupLevels.length ? groupLevels.indexOf(at(r, grouping) ?? "") : 0;
        if (di === -1) continue;
        stacks[di].push(valueText(response, r));
      }
      const n = Math.max(0, ...stacks.map((s) => s.length));
      table.rows = Array.from({ length: n }, (_, i) => ["", ...stacks.map((s) => s[i] ?? null)]);
    } else {
      // One output row per source row, each value in its own group column.
      table.rows = Array.from({ length: rowCount }, (_, r) => {
        const di = groupLevels.length ? groupLevels.indexOf(at(r, grouping) ?? "") : 0;
        const y = response.byRow[r];
        return [
          rowTitles ? (textOf(rowTitles.cells[r]) ?? "") : (at(r, subject) ?? ""),
          ...datasets.map((_, d) => (d === di && y != null ? valueText(response, r) : null)),
        ];
      });
    }
    return {
      testType: "extract-rearrange",
      subtitle: "Extract and rearrange",
      stats: [],
      groups: [],
      notes: notes(
        `Extracted a Column table from “${response.name}” — ${datasets.length} column${datasets.length === 1 ? "" : "s"}, ${table.rows.length} row${table.rows.length === 1 ? "" : "s"}.`,
      ),
      extracted: { tableType: "column", table },
    };
  }

  if (target === "grouped") {
    const response = pick(params.response, "response variable");
    if (isError(response)) return { error: response };
    const rowFactor = pick(params.rowFactor, "row factor");
    if (isError(rowFactor)) return { error: rowFactor };
    const columnFactor = pick(params.columnFactor, "column factor");
    if (isError(columnFactor)) return { error: columnFactor };
    const subject = pickOptional(params.subject, "subject variable");
    if (isError(subject)) return { error: subject };
    if (!response.values.length)
      return {
        error: `“${response.name}” holds no numbers yet — pick a response variable with numbers in it.`,
      };
    const rowLevels = levelsOf(rowFactor);
    if (!rowLevels.length)
      return { error: `“${rowFactor.name}” has no levels yet — pick a row factor with values in it.` };
    const colLevels = levelsOf(columnFactor);
    if (!colLevels.length)
      return { error: `“${columnFactor.name}” has no levels yet — pick a column factor with values in it.` };
    const subjectLevels = subject ? levelsOf(subject) : [];
    const cap = subject ? subjectCapError(subject, subjectLevels) : undefined;
    if (cap) return { error: cap };

    // Rows are the row-factor levels, columns the column-factor levels ×
    // replicates (one sub-column per subject; one when there is no subject).
    const replicates = Math.max(subjectLevels.length, 1);
    const table: TableData = {
      columns: [
        "Title",
        ...colLevels.flatMap((level) =>
          Array.from({ length: replicates }, (_, k) => `${columnTitle(columnFactor.name, level, prefix)}:Y${k + 1}`),
        ),
      ],
      rows: [],
      groups: colLevels.length,
      replicates,
    };
    // The first matching response, keyed by row + column + subject.
    const valueAt = new Map<string, string>();
    for (let r = 0; r < rowCount; r++) {
      const y = response.byRow[r];
      if (y == null) continue;
      const ri = rowLevels.indexOf(at(r, rowFactor) ?? "");
      const ci = colLevels.indexOf(at(r, columnFactor) ?? "");
      const si = subjectLevels.length ? subjectLevels.indexOf(at(r, subject) ?? "") : 0;
      if (ri === -1 || ci === -1 || si === -1) continue;
      const key = `${ri}|${ci}|${si}`;
      if (!valueAt.has(key)) valueAt.set(key, valueText(response, r));
    }
    table.rows = rowLevels.map((level, ri) => [
      rowTitle(rowFactor.name, level, prefix),
      ...colLevels.flatMap((_, ci) =>
        Array.from({ length: replicates }, (_, si) => valueAt.get(`${ri}|${ci}|${si}`) ?? null),
      ),
    ]);
    return {
      testType: "extract-rearrange",
      subtitle: "Extract and rearrange",
      stats: [],
      groups: [],
      notes: notes(
        `Extracted a Grouped table from “${response.name}” — ${rowLevels.length} row${rowLevels.length === 1 ? "" : "s"} × ${colLevels.length} column group${colLevels.length === 1 ? "" : "s"}.`,
      ),
      extracted: { tableType: "grouped", table },
    };
  }

  // Contingency.
  const rowVariable = pick(params.rowVariable, "row variable");
  if (isError(rowVariable)) return { error: rowVariable };
  const outcome = pick(params.outcome, "column variable");
  if (isError(outcome)) return { error: outcome };
  const count = pickOptional(params.count, "count variable");
  if (isError(count)) return { error: count };
  if (rowVariable.name === outcome.name)
    return { error: "The row and column variables must be different — pick two different variables." };
  const rowLevels = levelsOf(rowVariable);
  if (!rowLevels.length)
    return { error: `“${rowVariable.name}” has no levels yet — pick a row variable with values in it.` };
  const colLevels = levelsOf(outcome);
  if (!colLevels.length)
    return { error: `“${outcome.name}” has no levels yet — pick a column variable with values in it.` };

  // Cross-tabulation: each source row adds 1 (or its count) to its cell;
  // a blank count counts as 1, a negative or non-integer count is not used.
  const counts = new Map<string, number>();
  for (let r = 0; r < rowCount; r++) {
    const rl = at(r, rowVariable);
    const ol = at(r, outcome);
    if (rl === undefined || ol === undefined) continue;
    let increment = 1;
    if (count) {
      const raw = textOf(count.cells[r]);
      if (raw !== undefined) {
        const v = Number(raw);
        if (!Number.isInteger(v) || v < 0) continue;
        increment = v;
      }
    }
    const key = `${rowLevels.indexOf(rl)}|${colLevels.indexOf(ol)}`;
    counts.set(key, (counts.get(key) ?? 0) + increment);
  }
  const table: TableData = {
    columns: ["Title", ...colLevels],
    rows: rowLevels.map((level, ri) => [level, ...colLevels.map((_, ci) => String(counts.get(`${ri}|${ci}`) ?? 0))]),
  };
  return {
    testType: "extract-rearrange",
    subtitle: "Extract and rearrange",
    stats: [],
    groups: [],
    notes: notes(
      `Extracted a Contingency table counting “${outcome.name}” against “${rowVariable.name}” — ${rowLevels.length} row${rowLevels.length === 1 ? "" : "s"} × ${colLevels.length} column${colLevels.length === 1 ? "" : "s"}.`,
    ),
    extracted: { tableType: "contingency", table },
  };
}
