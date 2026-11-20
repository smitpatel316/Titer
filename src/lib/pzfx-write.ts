// `.hlx` → `.pzfx` writer (in-app).
//
// Builds a GraphPad Prism `.pzfx` file (XML) from a Titer project: data
// tables with their values, and info sheets. Analyses, graphs and layouts
// are NEVER written — a `.pzfx` file never contains analysis results (they
// live in the `<Template>` blob), and Prism recomputes them when it opens
// the file. Titer writes an EMPTY `<Template>` element (no blob): Prism
// 11.2.0 shows its XML-compliance dialog for any file whose
// CreatedByProgram isn't "GraphPad Prism" UNLESS a <Template> element is
// present (BUG-21, real-Prism ablation Nov 17, 2026 — 26 files: the dialog
// fires iff Program != GraphPad Prism AND no Template; a non-empty minimal
// blob is WORSE — an unnamed error dialog and no open at all). The empty
// element is XSD-valid, round-trips identically through Titer's own
// importer, and opens in real Prism 11.2.0 with no dialog, titled with
// the filename. A canned blob from another project is NOT used: the blob
// encodes that project's table titles and printer name.
//
// The spec is the vault note `Research/.pzfx write spec.md` — this file
// implements it. Anything the spec marks unknown is left out, never
// guessed. Clean-room: written from files Prism wrote, never from Prism's
// program. IDs are fresh sequential `Table0…`/`Info0…` per write;
// `CreatedByProgram` is honestly "Titer", never "GraphPad Prism".
//
// Table emission is the reverse of src/lib/pzfx.ts's import mapping:
//   column     → OneWay, one YColumn per dataset (replicates regrouped from
//                 `T_1…T_n` names; summary suffixes → summary YFormats)
//   grouped    → TwoWay, one YColumn per group (replicates; summaries keep
//                 their YFormat and read back as Column — warned, not hidden)
//   xy         → XY, X + Y datasets (X error as a second X subcolumn,
//                 date X via XAdvancedColumn)
//   survival   → Survival, X = time, one YColumn per group
//   contingency→ Contingency, one YColumn per column
//   nested / multiple → the write FAILS with a plain-language error naming
//                 the table: silently dropping a table would be data loss,
//                 and Prism has no counterpart for them.
//   A table past 52 subcolumns in a data set (or 104 data sets) writes as
//   <HugeTable>, as Prism writes it — the reader takes either tag.
// A table whose datasets mix formats (one replicates, one SDN) cannot be
// expressed in one table-level YFormat, so the whole write FAILS naming
// the table — never silently rewritten as something else.

import type { ProjectFilePayload } from "./project-file";
import type { PrismWriteReport } from "./prism-write";
import { groupRuns } from "./columns";
import { summaryFormatDef, type SummaryFormat } from "./summary-format";

export interface PzfxWriteResult {
  bytes: Uint8Array;
  report: PrismWriteReport;
}

/** One Titer data column's values, as text, per row. */
interface WriteColumn {
  name: string;
  values: (string | null)[];
}

/** A dataset to emit: its title, its columns' positions, and the YFormat
 *  the importer reads back from it (null = a single, no YFormat implied). */
interface WriteSet {
  title: string;
  /** Indices into the table's Y columns. */
  columns: number[];
  yFormat: string | null;
}

/** Summary subcolumn shapes, by the Titer column-name suffixes the importer
 *  produces for them (src/lib/pzfx.ts SUBCOLUMN_SUFFIXES). `.pzfx`
 *  distinguishes `low-high` from `upper-lower-limits`, where `.prism` does
 *  not — both shapes are here. */
const PZFX_SUMMARY_FORMATS: { suffixes: string[]; yFormat: string }[] = [
  { suffixes: ["_MEAN", "_SD", "_N"], yFormat: "SDN" },
  { suffixes: ["_MEAN", "_SEM", "_N"], yFormat: "SEN" },
  { suffixes: ["_MEAN", "_CV", "_N"], yFormat: "CVN" },
  { suffixes: ["_MEAN", "_SD"], yFormat: "SD" },
  { suffixes: ["_MEAN", "_SE"], yFormat: "SE" },
  { suffixes: ["_MEAN", "_CV"], yFormat: "CV" },
  { suffixes: ["_MEAN", "_PLUSERROR", "_MINUSERROR"], yFormat: "low-high" },
  { suffixes: ["_MEAN", "_UPPERLIMIT", "_LOWERLIMIT"], yFormat: "upper-lower-limits" },
];

/** A grouped table's summary format, by its subcolumn labels
 *  ("Mean"/"SD"/"N" after the "Group:" prefix) — the `.pzfx` YFormat it
 *  writes as. */
const GROUPED_SUMMARY_YFORMAT: Record<Exclude<SummaryFormat, "replicates">, string> = {
  "mean-sd-n": "SDN",
  "mean-sem-n": "SEN",
  "mean-cv-n": "CVN",
  "mean-sd": "SD",
  "mean-sem": "SE",
  "mean-plus-minus": "low-high",
  "mean-upper-lower": "upper-lower-limits",
};

const DATE_SHAPE = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$/;

/** Escape a value for XML text. Never throws: Prism sometimes writes a
 *  rich-text object `{ string, version, formatting }` where a string
 *  belongs (info notes, constant values — BUG-5), and a stray object or
 *  number must not take the whole export down. Rich text unwraps to its
 *  plain string; other primitives take their String() form; null,
 *  undefined and any other object become "". Never "[object Object]". */
const escapeXml = (s: unknown): string => {
  let text: string;
  if (typeof s === "string") text = s;
  else if (s === null || s === undefined) text = "";
  else if (typeof s === "object") {
    const rich = (s as { string?: unknown }).string;
    text = typeof rich === "string" ? rich : "";
  } else text = String(s);
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

/** Split Titer Y columns into `.pzfx` datasets. Mirrors
 *  `prism-write.ts` `groupDatasets` (summary groups, then replicate groups,
 *  then singles, in that order; datasets sorted by first column position). */
function groupYColumns(columns: WriteColumn[]): WriteSet[] {
  const sets: WriteSet[] = [];
  const used = new Set<number>();
  // 1. Summary groups: exact suffix sets, same base.
  for (let i = 0; i < columns.length; i++) {
    if (used.has(i)) continue;
    for (const { suffixes, yFormat } of PZFX_SUMMARY_FORMATS) {
      if (!columns[i].name.endsWith(suffixes[0])) continue;
      const base = columns[i].name.slice(0, -suffixes[0].length);
      const group = suffixes.map((s) => columns.findIndex((c, j) => !used.has(j) && c.name === base + s));
      if (group.every((g) => g >= 0)) {
        group.forEach((g) => used.add(g));
        sets.push({ title: base, columns: group, yFormat });
        break;
      }
    }
  }
  // 2. Replicate groups: `Base_1`…`Base_n`, consecutive from 1. A lone
  // `Base_1` with no `Base_2` stays a single (same rule as groupDatasets).
  for (let i = 0; i < columns.length; i++) {
    if (used.has(i)) continue;
    const m = /^(.*)_1$/.exec(columns[i].name);
    if (!m) continue;
    const base = m[1];
    const group = [i];
    for (let n = 2; ; n++) {
      const j = columns.findIndex((c, k) => !used.has(k) && c.name === `${base}_${n}`);
      if (j < 0) break;
      group.push(j);
    }
    if (group.length > 1) {
      group.forEach((g) => used.add(g));
      sets.push({ title: base, columns: group, yFormat: "replicates" });
    }
  }
  // 3. Singles, in column order.
  for (let i = 0; i < columns.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    sets.push({ title: columns[i].name, columns: [i], yFormat: null });
  }
  sets.sort((a, b) => Math.min(...a.columns) - Math.min(...b.columns));
  return sets;
}

/** The table's single YFormat, from its datasets' implied formats — or a
 *  refusal when they disagree (one table-level YFormat can't hold two). */
function tableYFormat(sets: WriteSet[], displayName: string): string | null {
  const implied = [...new Set(sets.map((s) => s.yFormat).filter((f): f is string => f !== null))];
  if (implied.length > 1) {
    throw new Error(
      `${displayName} mixes Y formats (${implied.join(" and ")}), and a .pzfx table holds only one Y format — split it into separate tables first, then save as .pzfx.`,
    );
  }
  return implied[0] ?? null;
}

/** The tag a table is written under: Prism writes `<HugeTable>` instead of
 *  `<Table>` once a table passes 52 subcolumns in a data set or 104 data
 *  sets (R pzfx 0.2.0 NEWS) — the XSD allows either tag in the table list,
 *  and the reader takes both, so a table Titer writes past that size reads
 *  back in Prism the way Prism's own huge tables do. */
const tableTag = (datasets: number, maxSubcolumns: number): "Table" | "HugeTable" =>
  datasets > 104 || maxSubcolumns > 52 ? "HugeTable" : "Table";

export function writePzfx(project: ProjectFilePayload, appVersion: string): PzfxWriteResult {
  const report: PrismWriteReport = { tables: [], analyses: [], analysesNotWritten: [], infoSheets: [], issues: [] };
  const issues = report.issues;

  const tables = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "table");
  if (tables.length === 0) {
    throw new Error("This project has no data tables to write — a .pzfx file with no tables isn't a Prism file.");
  }

  const tableXml: string[] = [];
  const tableIds: string[] = [];

  for (const table of tables) {
    const name = table.name;
    const displayName = `“${name}”`;
    const data = table.data;
    if (!data || data.columns.length < 2) {
      issues.push({ severity: "warning", message: `${displayName} holds no data columns; it was left out.` });
      continue;
    }
    const tableType = table.tableType ?? "column";
    if (tableType === "nested" || tableType === "multiple") {
      // Refuse the whole write: dropping a table silently would be data
      // loss, and Prism has no counterpart for these types. The user can
      // convert the table to Column first and try again.
      throw new Error(
        `${displayName} is a ${tableType === "nested" ? "Nested" : "Multiple variables"} table, and Prism has no matching table type — convert it to a Column table first, then save as .pzfx.`,
      );
    }
    const rowCount = data.rows.length;
    if (rowCount === 0) {
      // Re-import would drop it ("holds no data"), so don't write a table
      // that vanishes on the way back — say so instead.
      issues.push({ severity: "warning", message: `${displayName} holds no rows; it was left out.` });
      continue;
    }
    const rowTitles = data.rows.map((r) => (r ?? [])[0] ?? null);
    const hasRowTitles = rowTitles.some((v) => v !== null && v !== "");
    const cell = (r: number, ci: number): string | null => {
      const v = (data.rows[r] ?? [])[ci];
      return v == null ? null : typeof v === "string" ? v : String(v);
    };
    // Excluded cells, by data-column index (col 0 holds the row titles).
    const excludedByColumn = new Map<number, Set<number>>();
    for (const key of data.excluded ?? []) {
      const m = /^(\d+),(\d+)$/.exec(key);
      if (!m) continue;
      const rows = excludedByColumn.get(Number(m[2])) ?? new Set<number>();
      rows.add(Number(m[1]));
      excludedByColumn.set(Number(m[2]), rows);
    }
    const dElements = (ci: number): string =>
      Array.from({ length: rowCount }, (_, r) => {
        const value = cell(r, ci);
        const excluded = excludedByColumn.get(ci)?.has(r) ?? false;
        if (value === null) return excluded ? `<d Excluded="1"/>` : `<d/>`;
        return excluded ? `<d Excluded="1">${escapeXml(value)}</d>` : `<d>${escapeXml(value)}</d>`;
      }).join("");

    // Columns after Title: X first for xy/survival, then Y columns.
    const allColumns: WriteColumn[] = data.columns.slice(1).map((colName, i) => ({
      name: colName,
      values: data.rows.map((_, r) => cell(r, i + 1)),
    }));
    const isXY = tableType === "xy" || tableType === "survival";
    const xColumn = isXY ? allColumns[0] : null;
    // For XY tables the columns right after X may be the X error series
    // ("<X> error") and/or the date series ("<X> (date)") — the importer's
    // own names for them. They are not Y datasets.
    let yStart = isXY ? 1 : 0;
    let xError: WriteColumn | null = null;
    let dateColumn: WriteColumn | null = null;
    if (xColumn) {
      if (allColumns[yStart]?.name === `${xColumn.name} error`) {
        xError = allColumns[yStart];
        yStart++;
      }
      if (allColumns[yStart]?.name === `${xColumn.name} (date)`) {
        dateColumn = allColumns[yStart];
        yStart++;
      }
    }
    const yColumns = isXY ? allColumns.slice(yStart) : allColumns;
    if (yColumns.length === 0) {
      issues.push({ severity: "warning", message: `${displayName} holds no Y values; it was left out.` });
      continue;
    }

    let prismTableType: string;
    let xFormat: string;
    let yFormat: string | null = null;
    let replicates: number | undefined;
    let xAdvanced: string | null = null;
    let emitRowTitles = hasRowTitles;

    if (tableType === "grouped") {
      prismTableType = "TwoWay";
      xFormat = "none";
      // Regroup by the part before the first ":" (the importer's split);
      // the subcolumn label is the part after the last ":". Groups are RUNS
      // (src/lib/columns.ts `groupRuns`): two same-named groups
      // ("Group:Y1"… twice) are two groups, and merging them by name would
      // write one 20-replicate YColumn whose values shift columns on
      // read-back.
      const groups = groupRuns(yColumns.map((c) => c.name)).map((r) => ({ title: r.name, columns: r.columns }));
      const sublabel = (c: WriteColumn) =>
        c.name.includes(":") ? c.name.slice(c.name.lastIndexOf(":") + 1) : c.name;
      // The groups' format: the declared summaryFormat when its subcolumns
      // match every group, else the shape the subcolumn labels imply when
      // all groups share one, else replicates (the importer's rule — a
      // TwoWay summary table imports as Column, never Grouped). Groups that
      // disagree on shape are a mixed-format table: refuse, never silently
      // rewrite one group's summaries as replicates (or vice versa).
      const shapeOf = (labels: string[]): string | null => {
        for (const [value, yF] of Object.entries(GROUPED_SUMMARY_YFORMAT) as [SummaryFormat, string][]) {
          const def = summaryFormatDef(value);
          if (labels.length === def.subcolumns.length && labels.every((l, k) => l === def.subcolumns[k])) return yF;
        }
        return null;
      };
      const groupLabels = groups.map((g) => g.columns.map((ci) => sublabel(yColumns[ci])));
      const declared =
        data.summaryFormat && data.summaryFormat !== "replicates" ? summaryFormatDef(data.summaryFormat) : null;
      const matchesDeclared = (labels: string[]) =>
        declared !== null &&
        labels.length === declared.subcolumns.length &&
        labels.every((label, k) => label === declared.subcolumns[k]);
      let summaryYFormat: string | null = null;
      if (declared && groupLabels.every(matchesDeclared)) {
        summaryYFormat = GROUPED_SUMMARY_YFORMAT[data.summaryFormat as Exclude<SummaryFormat, "replicates">];
      } else if (declared && groupLabels.some(matchesDeclared)) {
        throw new Error(
          `${displayName} mixes Y formats (some groups are ${GROUPED_SUMMARY_YFORMAT[data.summaryFormat as Exclude<SummaryFormat, "replicates">]} summaries and some are not), and a .pzfx table holds only one Y format — split it into separate tables first, then save as .pzfx.`,
        );
      } else {
        const shapes = groupLabels.map(shapeOf);
        const distinct = [...new Set(shapes)];
        if (distinct.length > 1) {
          throw new Error(
            `${displayName} mixes Y formats (${distinct.map((s) => s ?? "replicates").join(" and ")}), and a .pzfx table holds only one Y format — split it into separate tables first, then save as .pzfx.`,
          );
        }
        if (distinct.length === 1 && distinct[0] !== null) summaryYFormat = distinct[0];
      }
      if (summaryYFormat) {
        yFormat = summaryYFormat;
        issues.push({
          severity: "warning",
          message: `${displayName} is a grouped summary table; .pzfx stores it as TwoWay with YFormat ${summaryYFormat}, which Titer reads back as a Column table — the values are identical, only the table type changes.`,
        });
      } else {
        yFormat = "replicates";
        const maxGroup = Math.max(...groups.map((g) => g.columns.length));
        replicates = Math.max(data.replicates ?? 0, maxGroup);
      }
      // One YColumn per group, in group order; replicate groups are padded
      // to `replicates` subcolumns with empty <d>s, as the importer pads
      // on read. A Y dataset at yColumns[j] sits at data-column index
      // yStart + j + 1 (data column 0 holds the row titles).
      const yXml = groups
        .map(({ title, columns: cols }) => {
          const subCols = [...cols];
          while (yFormat === "replicates" && subCols.length < (replicates ?? 0)) subCols.push(-1);
          const width = 89 * Math.max(1, subCols.length);
          const subs = subCols
            .map((ci) =>
              ci < 0
                ? `<Subcolumn>${Array.from({ length: rowCount }, () => `<d/>`).join("")}</Subcolumn>`
                : `<Subcolumn>${dElements(yStart + ci + 1)}</Subcolumn>`,
            )
            .join("");
          return `<YColumn Width="${width}" Decimals="0" Subcolumns="${subCols.length}"><Title>${escapeXml(title)}</Title>${subs}</YColumn>`;
        })
        .join("");
      const id = `Table${tableIds.length}`;
      tableIds.push(id);
      // A table past Prism's huge size writes as <HugeTable>, not <Table>.
      // (Merge fix: `groups` is an array of {title, columns} runs since
      // lane A — lane E's Map-era `.values()`/`.size` no longer typecheck.
      // Same shape as the sets call site below: count + max columns.)
      const maxSubcolumns =
        yFormat === "replicates"
          ? (replicates ?? 0)
          : Math.max(0, ...groups.map((g) => g.columns.length));
      const tag = tableTag(groups.length, maxSubcolumns);
      tableXml.push(
        `<${tag} ID="${id}" XFormat="${xFormat}"${yFormat ? ` YFormat="${yFormat}"` : ""}${replicates !== undefined && yFormat === "replicates" ? ` Replicates="${replicates}"` : ""} TableType="${prismTableType}" EVFormat="AsteriskAfterNumber"><Title>${escapeXml(name)}</Title>${emitRowTitles ? `<RowTitlesColumn Width="39"><Subcolumn>${Array.from({ length: rowCount }, (_, r) => { const v = rowTitles[r]; return v === null ? `<d/>` : `<d>${escapeXml(v)}</d>`; }).join("")}</Subcolumn></RowTitlesColumn>` : ""}${yXml}</${tag}>`,
      );
      report.tables.push(name);
      continue;
    }

    // Column / XY / Survival / Contingency.
    const sets = tableType === "contingency" || tableType === "survival"
      ? yColumns.map((c, i) => ({ title: c.name, columns: [i], yFormat: null }))
      : groupYColumns(yColumns);
    yFormat = tableYFormat(sets, displayName);
    if (tableType === "xy") {
      prismTableType = "XY";
      // Date X: a "<X> (date)" column wins; else row titles that all look
      // like Prism dates become the XAdvancedColumn (and stop being row
      // titles); else the X axis is numbers.
      if (dateColumn) {
        xFormat = "date";
        const dateCi = allColumns.indexOf(dateColumn) + 1;
        xAdvanced = `<XAdvancedColumn Version="1" Width="114" Decimals="0" Subcolumns="1"><Title>${escapeXml(xColumn!.name)}</Title><Subcolumn>${dElements(dateCi)}</Subcolumn></XAdvancedColumn>`;
      } else if (hasRowTitles && rowTitles.every((v) => v === null || v === "" || DATE_SHAPE.test(v))) {
        xFormat = "date";
        xAdvanced = `<XAdvancedColumn Version="1" Width="114" Decimals="0" Subcolumns="1"><Title>${escapeXml(xColumn!.name)}</Title><Subcolumn>${Array.from({ length: rowCount }, (_, r) => { const v = rowTitles[r]; return v === null ? `<d/>` : `<d>${escapeXml(v)}</d>`; }).join("")}</Subcolumn></XAdvancedColumn>`;
        emitRowTitles = false;
      } else {
        xFormat = xError ? "error" : "numbers";
        if (xError) {
          // Nothing to restore — the X error rides in the XColumn.
        } else if (rowTitles.some((v) => v !== null && v !== "" && DATE_SHAPE.test(v))) {
          issues.push({
            severity: "warning",
            message: `${displayName}: some row titles look like dates, but not all of them do, so the X axis was written as numbers and the dates stayed as row titles.`,
          });
        }
      }
      if (yFormat === "replicates") {
        replicates = Math.max(...sets.filter((s) => s.yFormat === "replicates").map((s) => s.columns.length));
      }
    } else if (tableType === "survival") {
      prismTableType = "Survival";
      // XAdvancedColumn is a duplicate of X in Prism's own files and the
      // reader uses XColumn only — omit it, never fabricate it.
      xFormat = "numbers";
    } else if (tableType === "contingency") {
      prismTableType = "Contingency";
      xFormat = "none";
    } else if (tableType === "parts-of-whole") {
      // Prism's PartsOfWhole: no X, one Y column per data set (seq 197).
      // The YFormat comes from the sets, as for Column — single columns
      // write no YFormat, and read back as Parts of Whole either way.
      prismTableType = "PartsOfWhole";
      xFormat = "none";
      if (yFormat === "replicates") {
        replicates = Math.max(...sets.filter((s) => s.yFormat === "replicates").map((s) => s.columns.length));
      }
    } else {
      prismTableType = "OneWay";
      xFormat = "none";
      if (yFormat === "replicates") {
        replicates = Math.max(...sets.filter((s) => s.yFormat === "replicates").map((s) => s.columns.length));
      }
    }

    // One YColumn per dataset, in dataset order. A Y dataset at
    // yColumns[j] sits at data-column index yStart + j + 1.
    const yXml = sets
      .map((set) => {
        const width = 89 * set.columns.length;
        const subs = set.columns
          .map((ci) => `<Subcolumn>${dElements(yStart + ci + 1)}</Subcolumn>`)
          .join("");
        return `<YColumn Width="${width}" Decimals="0" Subcolumns="${set.columns.length}"><Title>${escapeXml(set.title)}</Title>${subs}</YColumn>`;
      })
      .join("");
    const xXml =
      xColumn === null
        ? ""
        : `<XColumn Width="${xFormat === "date" ? 114 : 89}" Decimals="${xFormat === "date" ? 14 : 0}" Subcolumns="${xError ? 2 : 1}"><Title>${escapeXml(xColumn.name)}</Title><Subcolumn>${dElements(1)}</Subcolumn>${xError ? `<Subcolumn>${dElements(allColumns.indexOf(xError) + 1)}</Subcolumn>` : ""}</XColumn>`;
    const id = `Table${tableIds.length}`;
    tableIds.push(id);
    // A table past Prism's huge size writes as <HugeTable>, not <Table>.
    const tag = tableTag(sets.length, Math.max(0, ...sets.map((s) => s.columns.length)));
    tableXml.push(
      `<${tag} ID="${id}" XFormat="${xFormat}"${yFormat ? ` YFormat="${yFormat}"` : ""}${replicates !== undefined ? ` Replicates="${replicates}"` : ""} TableType="${prismTableType}" EVFormat="AsteriskAfterNumber"><Title>${escapeXml(name)}</Title>${emitRowTitles ? `<RowTitlesColumn Width="39"><Subcolumn>${Array.from({ length: rowCount }, (_, r) => { const v = rowTitles[r]; return v === null ? `<d/>` : `<d>${escapeXml(v)}</d>`; }).join("")}</Subcolumn></RowTitlesColumn>` : ""}${xXml}${xAdvanced ?? ""}${yXml}</${tag}>`,
    );
    report.tables.push(name);
  }

  if (report.tables.length === 0) {
    throw new Error("This project has no data tables Titer can write — nothing was written.");
  }

  // Analyses: a .pzfx file never contains them — Prism recomputes on open.
  // Name every analysis node present so none is silently dropped.
  for (const table of tables) {
    for (const childId of project.childOrder[table.id] ?? []) {
      const node = project.nodes[childId];
      if (node?.type === "analysis") {
        report.analysesNotWritten.push(`${node.name} (${node.analysisType} — .pzfx never contains analyses)`);
      }
    }
  }
  issues.push({
    severity: "warning",
    message:
      "Graphs and layouts are not written — the .pzfx <Template> is empty (Titer writes no analyses, graphs or layouts). Re-create them in Prism from the tables.",
  });

  // Info sheets: one <Info> per info node (title, notes, name/value
  // constants) + InfoSequence refs — the exact reverse of pzfx.ts:641–667.
  // A .pzfx file carries no table link for an info sheet, so a linked sheet
  // keeps its title, notes and constants but not the link.
  const infoNodes = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "info");
  const infoXml: string[] = [];
  const infoIds: string[] = [];
  let skippedBlankConstants = 0;
  for (const infoNode of infoNodes) {
    const id = `Info${infoIds.length}`;
    infoIds.push(id);
    const constants = (infoNode.info?.constants ?? []).filter((c) => {
      if (c.name.trim() === "") {
        skippedBlankConstants++;
        return false;
      }
      return true;
    });
    infoXml.push(
      `<Info ID="${id}"><Title>${escapeXml(infoNode.name)}</Title><Notes>${escapeXml(infoNode.info?.notes ?? "")}</Notes>${constants
        .map((c) => `<Constant><Name>${escapeXml(c.name)}</Name><Value>${escapeXml(c.value)}</Value></Constant>`)
        .join("")}</Info>`,
    );
    if (infoNode.info?.linkedTableId) {
      issues.push({
        severity: "warning",
        message: `“${infoNode.name}” is linked to a table, but .pzfx stores no table link for info sheets — the link was not written.`,
      });
    }
    report.infoSheets.push(infoNode.name);
  }
  if (skippedBlankConstants > 0) {
    issues.push({
      severity: "warning",
      message: `${skippedBlankConstants} info constant(s) with no name were left out — Titer can't import a nameless constant either.`,
    });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?><GraphPadPrismFile PrismXMLVersion="5.00">\n` +
    `<Created><OriginalVersion CreatedByProgram="Titer" CreatedByVersion="${escapeXml(appVersion)}" DateTime="${new Date().toISOString()}"/></Created>\n` +
    (infoIds.length
      ? `<InfoSequence>${infoIds.map((id, i) => `<Ref ID="${id}"${i === 0 ? ' Selected="1"' : ""}/>`).join("")}</InfoSequence>\n${infoXml.join("\n")}\n`
      : "") +
    `<TableSequence Selected="1">${tableIds.map((id, i) => `<Ref ID="${id}"${i === 0 ? ' Selected="1"' : ""}/>`).join("")}</TableSequence>\n` +
    `${tableXml.join("\n")}\n` +
    // BUG-21: an EMPTY <Template> element, last child of the root. Prism
    // 11.2.0 demands a <Template> element on any file not created by
    // GraphPad Prism, but never decodes an empty one — a canned or minimal
    // non-empty blob is worse (error dialog, no open) or leaks another
    // project's data. Exact bytes match the U1 ablation file.
    `<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>\n</GraphPadPrismFile>\n`;

  return { bytes: new TextEncoder().encode(xml), report };
}

/** The transfer report as plain text, for the save dialog and the log. */
export function formatPzfxWriteReport(report: PrismWriteReport): string {
  const lines: string[] = [
    `Tables written: ${report.tables.length}${report.tables.length ? " — " + report.tables.join(", ") : ""}`,
    `Analyses written: ${report.analyses.length}`,
    ...(report.infoSheets.length
      ? [`Info sheets written: ${report.infoSheets.length} — ${report.infoSheets.join(", ")}`]
      : []),
  ];
  if (report.analysesNotWritten.length) {
    lines.push(`Analyses not written (.pzfx never contains analyses): ${report.analysesNotWritten.join("; ")}`);
  }
  for (const issue of report.issues)
    lines.push(`${issue.severity === "error" ? "Error" : "Warning"}: ${issue.message}`);
  return lines.join("\n");
}
