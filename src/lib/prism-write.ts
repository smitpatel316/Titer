// `.hlx` → `.prism` writer (in-app).
//
// Builds a Prism 10 `.prism` file (a ZIP of JSON + CSVs) from a Titer
// project: data tables with their values, and the analyses Titer offers,
// with their parameters. Graphs and layouts are NEVER written — Prism
// stores them in an undocumented binary blob, and writing a fake
// `data.bin` is forbidden. Fitted results are never written either:
// Titer stores params, never results, and whether Prism recomputes on
// open is unknown until a Prism/Viewer read-back (test C-07, still open).
//
// Multiple t tests (`MULTIPLE_TWO_SAMPLE_TESTS`, seq 289 / 1.8 M1) are
// written the same params-only way: the test + correction Prism recomputes
// per row (t, df, p) on open. The mapping is corpus-verified (11 real
// Prism 10 files, 12 analyses — test-corpus, never Mansi's files):
// paired → MULTIPLE_PAIRED_TWO_SAMPLE_TESTS; unpaired Welch (Titer's
// default) → MULTIPLE_UNPAIRED_TWO_SAMPLE_EQUAL_SD_TESTS, the only
// unpaired-parametric value ever observed, whose stored results in both
// files carrying it are Welch-computed (fractional Welch–Satterthwaite
// df, re-derived from the raw data); Wilcoxon → MULTIPLE_WILCOXON_TESTS;
// Mann-Whitney → MULTIPLE_MANN_WHITNEY_TESTS. The multipleComparisons
// block is verbatim from those files (all three sub-blocks present, only
// `type` varies). Two substitutions, disclosed in the save report:
// Prism offers no plain-Holm option, so Holm is written as Holm-Šídák
// (GraphPad's recommended closest); Titer's FDR is Benjamini-Hochberg,
// written as Prism's recommended two-stage Benjamini-Krieger-Yekutieli
// (the only fdr.test observed). Two gaps cannot be represented and are
// registered, not guessed: a pooled SD across all rows (no Prism test
// value observed for the single-pooled-variance choice — EQUAL_SD's
// stored results are per-row Welch, not pooled), and no correction (no
// multipleComparisons type value observed for "do not correct").
//
// The spec is the vault note `Research/.prism write spec (1C).md` — this
// file implements it. Anything the spec marks unknown is left out, never
// guessed. Clean-room: written from files Prism wrote, never from Prism's
// program. Every UUID is fresh per write; `createdBy.name` is honestly
// "Titer", never "Prism".
//
// Table emission is the reverse of src/lib/prism.ts's import mapping:
//   xy         → format "xy", X dataset + Y datasets (replicates regrouped
//                 from `T_1…T_n` names; summary suffixes → summary formats)
//   column     → format "column", one y_single dataset per column
//   grouped    → format "grouped", one y_replicates dataset per group
//   contingency→ format "contingency", one y_single dataset per column
//   parts-of-whole → format "parts_of_whole", one y_single dataset per column
//   survival   → format "survival", X = time, one dataset per group
//   nested / multiple → the write FAILS with a plain-language error naming
//                 the table: silently dropping a table would be data loss,
//                 and Prism has no counterpart for them.

import JSZip from "jszip";
import type { ProjectFilePayload } from "./project-file";
import type { NonlinearModel } from "../stats/types";
import { groupRuns } from "./columns";
import { summaryFormatDef } from "./summary-format";

export interface PrismWriteIssue {
  severity: "error" | "warning";
  message: string;
}

export interface PrismWriteReport {
  /** Tables written, in project order. */
  tables: string[];
  /** Analysis nodes written, in project order. */
  analyses: string[];
  /** Analyses present in the project that weren't written (named, not dropped). */
  analysesNotWritten: string[];
  /** Info sheets written, in project order. */
  infoSheets: string[];
  issues: PrismWriteIssue[];
}

export interface PrismWriteResult {
  bytes: Uint8Array;
  report: PrismWriteReport;
}

/** Prism nonlinear equation name → Titer model is in src/lib/prism.ts
 *  (NONLINEAR_MODELS); this is the reverse map, for writing. Only models
 *  whose Prism equation + definition + parameters were seen in a real file
 *  (demo or corpus) are here. The log-X definition is Prism's
 *  Y=Bottom+(Top-Bottom)/(1+10^((LogEC50-X)*HillSlope)) — the same fit the
 *  importer maps from log(agonist)/log(inhibitor) files. The classic-curve
 *  entries use the Curve Fitting Guide definitions, each the same formula
 *  the importer's comment checks against modelSpec: Gaussian
 *  Y=Amplitude*exp(-0.5*((X-Mean)/SD)^2); Boltzmann sigmoid
 *  Y=Bottom+(Top-Bottom)/(1+exp((V50-X)/Slope)); Lorentzian
 *  Y=Amplitude/(1+((X-Center)/Width)^2); sine wave (nonzero-baseline form)
 *  Y=Amplitude*sin((2*pi*X/Wavelength)+PhaseShift)+Baseline; two-phase
 *  decay Y=Plateau+Span1*exp(-K1*X)+Span2*exp(-K2*X) (Prism 8's classic
 *  "Two phase exponential decay"; Prism 10's built-in spells the spans
 *  SpanFast/SpanSlow, same curve family). The written name is the guide's
 *  — "Two phase decay", unhyphenated — and the importer accepts the
 *  hyphenated spelling too, so either round-trips. */
const PRISM_EQUATION: Partial<
  Record<
    NonlinearModel,
    {
      name: string;
      definition: string;
      parameters: string[];
      /** One initial-value rule per parameter — Prism REQUIRES these on
       *  every equation (seq 247, P2): an equation block without
       *  initialValueRules fails open with "Cannot open file… structure
       *  has been corrupted". The 4PL rules are verbatim from the real
       *  demo file; the others use the same *YMIN/*YMAX rule atoms,
       *  which P2 proved load clean for one-phase decay. */
      initialValueRules: Record<string, { value: number; rule: string }>;
    }
  >
> = {
  "sigmoidal-4pl-x": {
    name: "Sigmoidal, 4PL, X is concentration",
    definition: "Y=Bottom + (Top-Bottom)/(1+(IC50/X)^HillSlope)",
    parameters: ["Bottom", "Top", "IC50", "HillSlope"],
    initialValueRules: {
      Bottom: { value: 1.0, rule: "*YMIN" },
      HillSlope: { value: 1.0, rule: "SIGN(YatXMax - YatXMin)" },
      IC50: { value: 1.0, rule: "X_AT_YMID" },
      Top: { value: 1.0, rule: "*YMAX" },
    },
  },
  "sigmoidal-4pl-logx": {
    name: "Sigmoidal, 4PL, X is log(concentration)",
    definition: "Y=Bottom + (Top-Bottom)/(1+10^((LogEC50-X)*HillSlope))",
    parameters: ["Bottom", "Top", "LogEC50", "HillSlope"],
    initialValueRules: {
      Bottom: { value: 1.0, rule: "*YMIN" },
      HillSlope: { value: 1.0, rule: "SIGN(YatXMax - YatXMin)" },
      LogEC50: { value: 1.0, rule: "X_AT_YMID" },
      Top: { value: 1.0, rule: "*YMAX" },
    },
  },
  "one-phase-decay": {
    name: "One phase decay",
    definition: "Y=(Y0-Plateau)*exp(-K*X)+Plateau",
    parameters: ["Y0", "Plateau", "K"],
    initialValueRules: {
      Y0: { value: 1.0, rule: "*YMAX" },
      Plateau: { value: 1.0, rule: "*YMIN" },
      K: { value: 1.0, rule: "*YMAX" },
    },
  },
  line: {
    name: "Line",
    definition: "Y=YIntercept+X*Slope",
    parameters: ["YIntercept", "Slope"],
    initialValueRules: {
      YIntercept: { value: 1.0, rule: "*YMIN" },
      Slope: { value: 1.0, rule: "*YMAX" },
    },
  },
  quadratic: {
    name: "Second order polynomial (quadratic)",
    definition: "Y=B0+B1*X+B2*X^2",
    parameters: ["B0", "B1", "B2"],
    initialValueRules: {
      B0: { value: 1.0, rule: "*YMIN" },
      B1: { value: 1.0, rule: "*YMAX" },
      B2: { value: 1.0, rule: "*YMAX" },
    },
  },
  gaussian: {
    name: "Gaussian",
    definition: "Y=Amplitude*exp(-0.5*((X-Mean)/SD)^2)",
    parameters: ["Amplitude", "Mean", "SD"],
    initialValueRules: {
      Amplitude: { value: 1.0, rule: "*YMAX" },
      Mean: { value: 1.0, rule: "*YMAX" },
      SD: { value: 1.0, rule: "*YMAX" },
    },
  },
  "boltzmann-sigmoid": {
    name: "Boltzmann sigmoid",
    definition: "Y=Bottom+(Top-Bottom)/(1+exp((V50-X)/Slope))",
    parameters: ["Bottom", "Top", "V50", "Slope"],
    initialValueRules: {
      Bottom: { value: 1.0, rule: "*YMIN" },
      Top: { value: 1.0, rule: "*YMAX" },
      V50: { value: 1.0, rule: "X_AT_YMID" },
      Slope: { value: 1.0, rule: "*YMAX" },
    },
  },
  lorentzian: {
    name: "Lorentzian",
    definition: "Y=Amplitude/(1+((X-Center)/Width)^2)",
    parameters: ["Amplitude", "Center", "Width"],
    initialValueRules: {
      Amplitude: { value: 1.0, rule: "*YMAX" },
      Center: { value: 1.0, rule: "*YMAX" },
      Width: { value: 1.0, rule: "*YMAX" },
    },
  },
  "sine-wave": {
    name: "Sine wave",
    definition: "Y=Amplitude*sin((2*pi*X/Wavelength)+PhaseShift)+Baseline",
    parameters: ["Amplitude", "Wavelength", "PhaseShift", "Baseline"],
    initialValueRules: {
      Amplitude: { value: 1.0, rule: "*YMAX" },
      Wavelength: { value: 1.0, rule: "*YMAX" },
      PhaseShift: { value: 1.0, rule: "*YMAX" },
      Baseline: { value: 1.0, rule: "*YMIN" },
    },
  },
  "two-phase-decay": {
    name: "Two phase decay",
    definition: "Y=Plateau+Span1*exp(-K1*X)+Span2*exp(-K2*X)",
    parameters: ["Plateau", "Span1", "K1", "Span2", "K2"],
    initialValueRules: {
      Plateau: { value: 1.0, rule: "*YMIN" },
      Span1: { value: 1.0, rule: "*YMAX" },
      K1: { value: 1.0, rule: "*YMAX" },
      Span2: { value: 1.0, rule: "*YMAX" },
      K2: { value: 1.0, rule: "*YMAX" },
    },
  },
};

/** Summary subcolumn shapes, by the Titer column-name suffixes the importer
 *  produces for them (src/lib/prism.ts SUBCOLUMN_SUFFIXES). A group of
 *  columns sharing a base with exactly these suffixes becomes one dataset
 *  in that dataFormat; anything else is replicates or singles. */
const SUMMARY_FORMATS: { suffixes: string[]; dataFormat: string }[] = [
  { suffixes: ["_MEAN", "_SD", "_N"], dataFormat: "y_sd_n" },
  { suffixes: ["_MEAN", "_SEM", "_N"], dataFormat: "y_se_n" },
  { suffixes: ["_MEAN", "_CV", "_N"], dataFormat: "y_cv_n" },
  { suffixes: ["_MEAN", "_SD"], dataFormat: "y_sd" },
  { suffixes: ["_MEAN", "_SE"], dataFormat: "y_se" },
  { suffixes: ["_MEAN", "_CV"], dataFormat: "y_cv" },
  // y_plus_minus and y_high_low share the importer's column names; the
  // writer emits y_plus_minus (the importer reads both back the same way).
  { suffixes: ["_MEAN", "_PLUSERROR", "_MINUSERROR"], dataFormat: "y_plus_minus" },
];

/** One Titer data column's values, as text, per row. */
interface WriteColumn {
  name: string;
  values: (string | null)[];
}

/** A dataset to emit: its title, its columns' CSV positions, and the
 *  dataFormat the importer reads back from it. */
interface WriteSet {
  title: string;
  /** Indices into the table's CSV data columns (X excluded). */
  columns: number[];
  dataFormat: string;
  /** Replicate subcolumns (y_replicates only). */
  replicatesCount?: number;
}

const csvEncode = (rows: (string | null)[][]): string =>
  rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell ?? "";
          return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(","),
    )
    .join("\n") + (rows.length ? "\n" : "");

/** Split Titer Y columns into Prism datasets. `columns` are the data columns
 *  (Title and X already removed). Grouping rules, in order:
 *  1. summary suffix groups (`T_MEAN`/`T_SD`/`T_N` → one y_sd_n dataset);
 *  2. replicate groups (`T_1`…`T_n` → one y_replicates dataset);
 *  3. anything left is one y_single dataset per column. */
function groupDatasets(columns: WriteColumn[]): WriteSet[] {
  const sets: WriteSet[] = [];
  const used = new Set<number>();
  // 1. Summary groups: exact suffix sets, same base.
  for (let i = 0; i < columns.length; i++) {
    if (used.has(i)) continue;
    for (const { suffixes, dataFormat } of SUMMARY_FORMATS) {
      if (!columns[i].name.endsWith(suffixes[0])) continue;
      const base = columns[i].name.slice(0, -suffixes[0].length);
      const group = suffixes.map((s) => columns.findIndex((c, j) => !used.has(j) && c.name === base + s));
      if (group.every((g) => g >= 0)) {
        group.forEach((g) => used.add(g));
        sets.push({ title: base, columns: group, dataFormat });
        break;
      }
    }
  }
  // 2. Replicate groups: `Base_1`…`Base_n`, consecutive from 1.
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
      sets.push({ title: base, columns: group, dataFormat: "y_replicates", replicatesCount: group.length });
    }
  }
  // 3. Singles, in column order.
  for (let i = 0; i < columns.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    sets.push({ title: columns[i].name, columns: [i], dataFormat: "y_single" });
  }
  sets.sort((a, b) => Math.min(...a.columns) - Math.min(...b.columns));
  return sets;
}

/** Excluded rows as Prism `cellAttributes` entries: maximal runs of
 *  consecutive rows, "N" or "N~M", each flagged EXCLUDED — the
 *  representation real Prism writes (BUG-10). Empty when nothing is
 *  excluded, so the key is omitted entirely. */
const excludedCellAttributes = (rows: Set<number> | undefined): { rows: string; attributes: string[] }[] => {
  if (!rows || rows.size === 0) return [];
  const sorted = [...rows].sort((a, b) => a - b);
  const entries: { rows: string; attributes: string[] }[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  const flush = () =>
    entries.push({ rows: start === prev ? String(start) : `${start}~${prev}`, attributes: ["EXCLUDED"] });
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
      continue;
    }
    flush();
    start = prev = sorted[i];
  }
  flush();
  return entries;
};

const replicateEntry = (lastRow: number, cellAttributes?: { rows: string; attributes: string[] }[]) => ({
  "@class": "DriverReplicate",
  valueType: "real",
  commonAttributes: ["NUMERIC"],
  decimalsLength: 1,
  significantDigitsCount: 7,
  lastRow,
  firstRow: 0,
  ...(cellAttributes && cellAttributes.length ? { cellAttributes } : {}),
});

export async function writePrism(project: ProjectFilePayload, appVersion: string): Promise<PrismWriteResult> {
  const issues: PrismWriteIssue[] = [];
  const report: PrismWriteReport = { tables: [], analyses: [], analysesNotWritten: [], infoSheets: [], issues };
  const zip = new JSZip();
  const setJson = (path: string, value: unknown) => zip.file(path, JSON.stringify(value, null, 2));

  const dataSheetUids: string[] = [];
  const analysisUids: string[] = [];
  const titles: Record<string, { title: string }> = {};
  // Table node id → { sheetUid, tableUid, datasetUidByTitle, datasetTitles, datasetUids }.
  // datasetUids is parallel to datasetTitles (positional) — the title-keyed
  // map collapses duplicate titles to ONE uid, and Prism then sees
  // repeated input uids (seq 247: F0's three "Y" datasets share uid
  // 02BD7CFB). Inputs are matched to datasets by position, never by title.
  const tableInfo = new Map<
    string,
    {
      sheetUid: string;
      tableUid: string;
      datasetUidByTitle: Map<string, string>;
      datasetTitles: string[];
      datasetUids: string[];
    }
  >();

  const tables = project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "table");
  if (tables.length === 0) {
    throw new Error("This project has no data tables to write — a .prism file with no tables isn't a Prism file.");
  }

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
        `${displayName} is a ${tableType === "nested" ? "Nested" : "Multiple variables"} table, and Prism has no matching table type — convert it to a Column table first, then save as .prism.`,
      );
    }
    const rowCount = data.rows.length;
    const rowTitles = data.rows.map((r) => r[0]);
    const hasRowTitles = rowTitles.some((v) => v !== null && v !== "");
    const sheetUid = crypto.randomUUID().toUpperCase();
    const tableUid = crypto.randomUUID().toUpperCase();
    dataSheetUids.push(sheetUid);
    titles[sheetUid] = { title: name };

    // Columns after Title: X first for xy/survival, then Y columns.
    const allColumns: WriteColumn[] = data.columns.slice(1).map((colName, i) => ({
      name: colName,
      values: data.rows.map((r) => r[i + 1] ?? null),
    }));
    const isXY = tableType === "xy" || tableType === "survival";
    const xColumn = isXY ? allColumns[0] : null;
    const yColumns = isXY ? allColumns.slice(1) : allColumns;
    // A yColumn's index in allColumns (the X column sits first for xy /
    // survival) — used to look up that column's excluded rows below.
    const yColToAll = (i: number) => (isXY ? i + 1 : i);
    // Excluded cells (BUG-10): data.excluded keys are "row,col" full-grid
    // coords (col 0 = row titles, never excluded); allColumns[i] is full
    // col i+1. Rows past the table are dropped — they can't be cells.
    const excludedByColumn = new Map<number, Set<number>>();
    for (const key of data.excluded ?? []) {
      const m = /^(\d+),(\d+)$/.exec(key);
      if (!m) continue;
      const col = Number(m[2]) - 1;
      const row = Number(m[1]);
      if (col < 0 || col >= allColumns.length || row >= rowCount) continue;
      const rows = excludedByColumn.get(col) ?? new Set<number>();
      rows.add(row);
      excludedByColumn.set(col, rows);
    }

    // CSV column order: [row titles?] + [X subcolumns] + [dataset subcolumns…].
    // The writer emits one subcolumn per dataset, except y_replicates
    // (n subcolumns) — so the CSV order follows the dataset order below.
    let format: string;
    let dataFormat: string;
    let replicatesCount: number | undefined;
    let sets: WriteSet[];
    if (tableType === "grouped") {
      format = "grouped";
      // Columns are "Group:Mean"… or "Group:Y1"… — regroup by the part before
      // the last ":". Groups are RUNS (src/lib/columns.ts `groupRuns`, split
      // at the last ":"): two same-named groups ("Group:Y1"… twice) are two
      // datasets, and merging them by name would write one 20-replicate
      // dataset whose values shift columns on read-back. A summary table
      // emits one dataset per group in its matching dataFormat (y_sd_n,
      // y_se_n, …); a replicates table one y_replicates dataset per group,
      // as before.
      const splitLast = (name: string): [string, string] => {
        const sep = name.lastIndexOf(":");
        return sep >= 0 ? [name.slice(0, sep), name.slice(sep + 1)] : [name, name];
      };
      const groups = groupRuns(
        yColumns.map((c) => c.name),
        splitLast,
      ).map((r) => ({ title: r.name, columns: r.columns }));
      const def =
        data.summaryFormat && data.summaryFormat !== "replicates" ? summaryFormatDef(data.summaryFormat) : null;
      // A summary dataFormat only when the columns actually hold it (the
      // first group's suffixes, in order) — a mismatched table writes as
      // replicates instead of claiming a format its columns don't hold.
      const firstGroup = groups[0]?.columns ?? [];
      const suffixesMatch =
        def !== null &&
        firstGroup.length === def.subcolumns.length &&
        firstGroup.every(
          (ci, k) => yColumns[ci].name.slice(yColumns[ci].name.lastIndexOf(":") + 1) === def.subcolumns[k],
        );
      const summaryDataFormat = suffixesMatch ? (def!.dataFormat ?? "y_replicates") : "y_replicates";
      sets = groups.map(({ title, columns: cols }) => ({
        title,
        columns: cols,
        dataFormat: summaryDataFormat,
        ...(summaryDataFormat === "y_replicates" ? { replicatesCount: cols.length } : {}),
      }));
      dataFormat = summaryDataFormat;
      replicatesCount =
        summaryDataFormat === "y_replicates"
          ? data.groups !== undefined && data.replicates !== undefined
            ? data.replicates
            : Math.max(...sets.map((s) => s.columns.length))
          : undefined;
    } else {
      sets = groupDatasets(yColumns);
      // The table's dataFormat is its datasets' format when they agree
      // (the usual case — e.g. a y_sd_n table); otherwise y_replicates
      // when any dataset replicates, else y_single.
      const uniform = sets.length > 0 && sets.every((s) => s.dataFormat === sets[0].dataFormat);
      if (tableType === "xy") {
        format = "xy";
        dataFormat = uniform
          ? sets[0].dataFormat
          : sets.some((s) => s.dataFormat === "y_replicates")
            ? "y_replicates"
            : "y_single";
        if (dataFormat === "y_replicates") {
          replicatesCount = Math.max(
            ...sets.filter((s) => s.dataFormat === "y_replicates").map((s) => s.columns.length),
          );
        }
      } else if (tableType === "survival") {
        format = "survival";
        dataFormat = "y_single";
      } else if (tableType === "contingency") {
        format = "contingency";
        dataFormat = "y_single";
      } else if (tableType === "parts-of-whole") {
        format = "parts_of_whole";
        dataFormat = "y_single";
      } else {
        format = "column";
        dataFormat = uniform ? sets[0].dataFormat : "y_single";
      }
    }

    // Dataset JSONs + CSV column layout, in dataset order.
    const csvCols: (string | null)[][] = [];
    const datasetUidByTitle = new Map<string, string>();
    const datasetTitles: string[] = [];
    const setUids: string[] = [];
    let xUid: string | undefined;
    if (xColumn) {
      xUid = crypto.randomUUID().toUpperCase();
      setJson(`data/sets/${xUid}.json`, {
        "@class": "DataSet",
        uid: xUid,
        format: "y_single",
        title: xColumn.name,
        attributes: ["DS_ATTR_X"],
        replicates: [
          {
            ...replicateEntry(rowCount - 1, excludedCellAttributes(excludedByColumn.get(0))),
            commonAttributes: ["NUMERIC", "NOTCONV"],
          },
        ],
      });
      csvCols.push(xColumn.values);
    }
    for (const set of sets) {
      const setUid = crypto.randomUUID().toUpperCase();
      setUids.push(setUid);
      datasetTitles.push(set.title);
      datasetUidByTitle.set(set.title, setUid);
      const lastRow = rowCount - 1;
      if (set.dataFormat === "y_replicates") {
        // One replicate range per maximal run of consecutive subcolumns
        // sharing the same excluded-row set — Prism stores one replicate
        // (with its cellAttributes) per run, and a run's EXCLUDED rows
        // apply to every subcolumn it covers, so subcolumns with
        // different exclusions must not share a run (BUG-10: Ya_1+Ya_2
        // excluded at row 1, Yb_1 excluded but Yb_2 live, must not become
        // one "0~1" range with EXCLUDED row 1).
        const keyOf = (rows: Set<number>) => [...rows].sort((a, b) => a - b).join(",");
        const runs: { start: number; end: number; key: string; rows: Set<number> }[] = [];
        for (let k = 0; k < set.columns.length; k++) {
          const rows = excludedByColumn.get(yColToAll(set.columns[k])) ?? new Set<number>();
          const key = keyOf(rows);
          const last = runs[runs.length - 1];
          if (last && last.key === key) last.end = k;
          else runs.push({ start: k, end: k, key, rows });
        }
        setJson(`data/sets/${setUid}.json`, {
          "@class": "DataSet",
          uid: setUid,
          format: "y_replicates",
          title: set.title,
          attributes: ["DS_ATTR_Y"],
          "replicate ranges": runs.map(({ start, end, rows }) => ({
            range: start === end ? String(start) : `${start}~${end}`,
            replicate: replicateEntry(lastRow, excludedCellAttributes(rows)),
          })),
        });
      } else {
        setJson(`data/sets/${setUid}.json`, {
          "@class": "DataSet",
          uid: setUid,
          format: set.dataFormat,
          title: set.title,
          attributes: ["DS_ATTR_Y"],
          replicates: set.columns.map((colIdx) =>
            replicateEntry(lastRow, excludedCellAttributes(excludedByColumn.get(yColToAll(colIdx)))),
          ),
        });
      }
      for (const colIdx of set.columns) csvCols.push(yColumns[colIdx].values);
    }
    let rowTitlesUid: string | undefined;
    if (hasRowTitles) {
      rowTitlesUid = crypto.randomUUID().toUpperCase();
      setJson(`data/sets/${rowTitlesUid}.json`, {
        "@class": "DataSet",
        uid: rowTitlesUid,
        format: "text",
        title: "Row titles",
        attributes: ["DS_ATTR_RT"],
        replicates: [],
      });
    }

    // CSV: [row titles?] + [X] + [datasets in order].
    const csvRows: (string | null)[][] = Array.from({ length: rowCount }, (_, r) => [
      ...(hasRowTitles ? [rowTitles[r]] : []),
      ...csvCols.map((col) => col[r] ?? null),
    ]);
    const csvWidth = (hasRowTitles ? 1 : 0) + csvCols.length;
    zip.file(`data/tables/${tableUid}/data.csv`, csvEncode(csvRows));
    setJson(`data/tables/${tableUid}/content.json`, {
      numberOfColumns: csvWidth,
      numberOfRows: rowCount,
      version: 1,
    });
    setJson(`data/sheets/${sheetUid}/sheet.json`, {
      "@class": "DataSheet",
      title: name,
      table: {
        // BUG-20: real Prism's reader dispatches on table["@class"] and
        // dereferences it unconditionally — omitting it crashes Prism
        // 11.2.0 on open (SIGSEGV in NSDocument init). Real files write
        // "XYDataTable" for xy/survival tables, "DataTable" otherwise.
        "@class": isXY ? "XYDataTable" : "DataTable",
        uid: tableUid,
        format,
        dataFormat,
        ...(replicatesCount !== undefined ? { replicatesCount } : {}),
        dataSets: setUids,
        ...(xUid ? { xDataSetFormat: "y_single", xDataSet: xUid } : {}),
        ...(rowTitlesUid ? { rowTitlesDataSet: rowTitlesUid } : {}),
      },
    });
    tableInfo.set(table.id, { sheetUid, tableUid, datasetUidByTitle, datasetTitles, datasetUids: setUids });
    report.tables.push(name);
  }

  if (report.tables.length === 0) {
    throw new Error("This project has no data tables Titer can write — nothing was written.");
  }

  // Analyses: one Prism analysis per Titer node (the importer splits one
  // Prism 4PL analysis over two datasets into two Titer nodes; the writer
  // reverses per node — the report says the written file has one analysis
  // per node, not per source analysis).
  // Multiple-t-tests correction substitutions (seq 289): Prism has no
  // plain-Holm and no observed Benjamini-Hochberg fdr.test, so Holm is
  // written as Holm-Šídák and FDR as Benjamini-Krieger-Yekutieli — the
  // names are collected here and disclosed as one warning each below.
  const holmSidakWritten: string[] = [];
  const bkyWritten: string[] = [];
  for (const table of tables) {
    const info = tableInfo.get(table.id);
    if (!info) continue;
    const children = (project.childOrder[table.id] ?? [])
      .map((id) => project.nodes[id])
      .filter((n) => n?.type === "analysis");
    for (const node of children) {
      const params = (node.analysisParams ?? {}) as Record<string, unknown>;
      if (node.analysisType === "nonlinear-regression" && typeof params.model === "string") {
        const model = params.model as NonlinearModel;
        const equation = PRISM_EQUATION[model];
        if (!equation) {
          report.analysesNotWritten.push(
            `${node.name} (nonlinear model “${params.model}” — not yet supported in Prism)`,
          );
          continue;
        }
        const analysisUid = crypto.randomUUID().toUpperCase();
        analysisUids.push(analysisUid);
        const yTitle = typeof params.y === "string" ? params.y : undefined;
        // The importer names per-dataset nodes "<title> (<dataset>)" — the
        // Prism analysis title is the base name, so strip that suffix back
        // off on write, or the name doubles on every round trip.
        const baseName =
          yTitle && node.name.endsWith(` (${yTitle})`) ? node.name.slice(0, -(yTitle.length + 3)) : node.name;
        titles[analysisUid] = { title: baseName };
        // Input `idx` is a LETTER (A, B, C… by position), never a number:
        // real Prism 11.2.0 rejects a numeric idx with "damaged or
        // truncated" (seq 247, J6). Input uids are positional too — the
        // title-keyed map collapses duplicate titles to one uid.
        const letterIdx = (i: number) => String.fromCharCode(65 + i);
        const yPos = yTitle ? info.datasetTitles.indexOf(yTitle) : -1;
        const inputDataSets =
          yTitle && yPos >= 0
            ? [{ uid: info.datasetUids[yPos] ?? "", title: yTitle, idx: "A" }]
            : info.datasetTitles.map((title, i) => ({
                uid: info.datasetUids[i] ?? "",
                title,
                idx: letterIdx(i),
              }));
        const is4PLx = model === "sigmoidal-4pl-x";
        setJson(`analyses/${analysisUid}/sheet.json`, {
          "@class": "AnalysisSheet",
          analysisClass: "NONLINEAR_REGRESSION",
          // Identity fields Prism requires on an analysis sheet (seq 247,
          // L1/L2): without uid/fenID/$id/minRequiredVersion the file
          // SIGSEGVs on load. Values are verbatim from a real NLREG sheet
          // (fenID 0, MRV 8.2.0.0).
          uid: analysisUid,
          fenID: 0,
          $id: "analyses/sheet.schema.json",
          minRequiredVersion: { major: 8, minor: 2, subminor: 0, build: 0 },
          title: baseName,
          inputSheets: [{ uid: info.sheetUid, title: table.name }],
          inputDataSets,
          resultSheets: [],
          isCalculated: false,
        });
        setJson(`analyses/${analysisUid}/parameters.json`, {
          "@class": "AnalysisParameters",
          analysisClass: "NONLINEAR_REGRESSION",
          $id: "analyses/nonlinear_regression/parameters.schema.json",
          version: "0.0.0",
          content: {
            data: {
              handleReplicatesAs: "INDIVIDUAL",
              range: {
                minX: { enabled: false, value: "undefined" },
                maxX: { enabled: false, value: "undefined" },
              },
            },
            model: {
              equation: {
                name: equation.name,
                definition: equation.definition,
                parameters: equation.parameters,
                intermediateVariables: [],
                // Initial-value rules are REQUIRED on every equation
                // (seq 247, P2) — omitting them fails open with
                // "Cannot open file… structure has been corrupted".
                // Transforms are 4PL-x only (real file); other equations
                // never had them and O1 proved they load without.
                initialValueRules: equation.initialValueRules,
                ...(is4PLx
                  ? {
                      transforms: [
                        { name: "logIC50", definition: "log(IC50)", ciMethod: "ASYMMETRICAL" },
                        { name: "Span", definition: "Top-Bottom", ciMethod: "SYMMETRICAL" },
                      ],
                    }
                  : {}),
              },
              constraints: {},
              initialValues: {},
            },
          },
        });
        setJson(`analyses/${analysisUid}/constants.json`, { "@class": "AnalysisConstants", version: "0.0.0" });
        report.analyses.push(node.name);
      } else if (node.analysisType === "survival") {
        const analysisUid = crypto.randomUUID().toUpperCase();
        analysisUids.push(analysisUid);
        titles[analysisUid] = { title: node.name };
        setJson(`analyses/${analysisUid}/sheet.json`, {
          "@class": "AnalysisSheet",
          analysisClass: "SURVIVAL",
          // Identity fields, verbatim from a real survival sheet
          // (fenID 2, MRV 0.0.0.0) — see the NLREG note above (seq 247).
          uid: analysisUid,
          fenID: 2,
          $id: "analyses/sheet.schema.json",
          minRequiredVersion: { major: 0, minor: 0, subminor: 0, build: 0 },
          title: node.name,
          inputSheets: [{ uid: info.sheetUid, title: table.name }],
          inputDataSets: info.datasetTitles.map((title, i) => ({
            uid: info.datasetUids[i] ?? "",
            title,
            idx: String.fromCharCode(65 + i),
          })),
          resultSheets: [],
          isCalculated: false,
        });
        setJson(`analyses/${analysisUid}/parameters.json`, {
          "@class": "AnalysisParameters",
          analysisClass: "SURVIVAL",
          $id: "analyses/survival/parameters.schema.json",
          version: "0.0.0",
          content: {
            data: { eventCode: 1, censorCode: 0 },
            calc: {
              twoGroupsLogrankTest: true,
              twoGroupsGehanBreslowWilcoxonTest: true,
              logrankTest: true,
              logrankTestForTrend: true,
              gehanBreslowWilcoxonTest: true,
              logrankTestMethod: "RECOMMENDED",
              logrankTestForTrendMethod: "RECOMMENDED",
              tabulate: "EVENT",
              probabilityAs: "PERCENTAGE",
              ciMethod: "ASYMMETRICAL",
            },
            graph: { showCensoredSubjects: true, errorBars: "NONE" },
            output: {
              significantDigitCount: 4,
              pValueStyle: { type: "P_VALUE_STYLE_GP", decimalDigitCount: 6 },
            },
          },
        });
        setJson(`analyses/${analysisUid}/constants.json`, { "@class": "AnalysisConstants", version: "0.0.0" });
        report.analyses.push(node.name);
      } else if (node.analysisType === "multiple-t-tests") {
        // Multiple t tests → MULTIPLE_TWO_SAMPLE_TESTS, params-only like
        // NLREG/survival: isCalculated false, resultSheets [], no
        // results.json — Prism recomputes t, df and p per row on open.
        // Params default as the runner does (multiple-t-tests.ts
        // DEFAULTS): unpaired, Gaussian, no pooled SD, Holm.
        const paired = params.paired === true;
        const gaussian = params.gaussian !== false;
        const pooledSd = params.pooledSd === true;
        const correction = typeof params.correction === "string" ? params.correction : "holm";
        const reasons: string[] = [];
        let test: string | undefined;
        if (gaussian && paired) test = "MULTIPLE_PAIRED_TWO_SAMPLE_TESTS";
        else if (gaussian && !paired && !pooledSd) test = "MULTIPLE_UNPAIRED_TWO_SAMPLE_EQUAL_SD_TESTS";
        else if (gaussian && !paired && pooledSd)
          reasons.push(
            "pooled SD across rows (one shared SD for every row) — no Prism test value was observed for the single-pooled-variance choice, and MULTIPLE_UNPAIRED_TWO_SAMPLE_EQUAL_SD_TESTS stores per-row Welch results, not pooled ones",
          );
        else if (!gaussian && paired) test = "MULTIPLE_WILCOXON_TESTS";
        else if (!gaussian && !paired) test = "MULTIPLE_MANN_WHITNEY_TESTS";
        // Prism's correction options (GraphPad Statistics Guide, "Options
        // for multiple t tests"): statistical — Holm-Šídák (recommended),
        // Šídák-Bonferroni, Bonferroni-Dunn, or none; FDR — BKY
        // (recommended), Benjamini-Hochberg, or Benjamini-Yekutieli. The
        // corpus shows only HOLM_SIDAK and BENJAMINI_KRIEGER_YEKUTIELI,
        // so Titer's Holm and Benjamini-Hochberg are written as those
        // nearest Prism methods and disclosed in the report below — never
        // silently, and never as a guessed enum. "none" has no observed
        // multipleComparisons type value (FDR and STATISTICAL only), and
        // omitting the block would let Prism apply its own default
        // correction, so it is registered, not written.
        let mcType: "STATISTICAL" | "FDR" | undefined;
        if (correction === "holm") mcType = "STATISTICAL";
        else if (correction === "fdr") mcType = "FDR";
        else if (correction === "none")
          reasons.push(
            "no correction — no multipleComparisons type value was observed for “do not correct” (FDR and STATISTICAL only)",
          );
        else reasons.push(`correction “${correction}” — unknown correction`);
        // The two compared datasets: the wizard's `sets` ([set1, set2])
        // when the table has more than two groups, else every dataset
        // (the usual two-group table). Idx is a LETTER by position among
        // ALL datasets (seq 247, J6) — real files skip letters for
        // datasets outside the analysis (Low A, High C), so the position
        // is looked up in the full list, never among the inputs.
        const setsParam =
          Array.isArray(params.sets) && params.sets.every((s) => typeof s === "string")
            ? (params.sets as string[])
            : undefined;
        const inputTitles = setsParam ?? info.datasetTitles;
        if (inputTitles.length !== 2) reasons.push(`needs exactly 2 input datasets, found ${inputTitles.length}`);
        const inputs: { uid: string; title: string; idx: string }[] = [];
        for (const title of inputTitles) {
          const pos = info.datasetTitles.indexOf(title);
          if (pos < 0) {
            reasons.push(`dataset “${title}” is not in table “${table.name}”`);
            continue;
          }
          inputs.push({ uid: info.datasetUids[pos] ?? "", title, idx: String.fromCharCode(65 + pos) });
        }
        if (inputs.length === 2 && inputs[0].uid === inputs[1].uid)
          reasons.push(`datasets “${inputTitles[0]}” and “${inputTitles[1]}” resolve to the same dataset`);
        if (reasons.length > 0) {
          report.analysesNotWritten.push(`${node.name} (multiple-t-tests — ${reasons.join("; ")})`);
          continue;
        }
        const analysisUid = crypto.randomUUID().toUpperCase();
        analysisUids.push(analysisUid);
        titles[analysisUid] = { title: node.name };
        setJson(`analyses/${analysisUid}/sheet.json`, {
          "@class": "AnalysisSheet",
          analysisClass: "MULTIPLE_TWO_SAMPLE_TESTS",
          // Identity fields, as NLREG (seq 247): fenID has no per-class
          // constant in real MTT files (18, 17, 24, 25, 19, 53, 54, 39,
          // 38, 1, 9 — sheet position, not class), so 0 like NLREG;
          // minRequiredVersion 10.0.0.0 is the majority observed value
          // (8 of 11 real files; the rest 9.0.0.0).
          uid: analysisUid,
          fenID: 0,
          $id: "analyses/sheet.schema.json",
          minRequiredVersion: { major: 10, minor: 0, subminor: 0, build: 0 },
          title: node.name,
          inputSheets: [{ uid: info.sheetUid, title: table.name }],
          inputDataSets: inputs,
          resultSheets: [],
          isCalculated: false,
        });
        setJson(`analyses/${analysisUid}/parameters.json`, {
          "@class": "AnalysisParameters",
          $id: "analyses/multiple_two_sample_tests/parameters.schema.json",
          version: "0.0.0",
          content: {
            test,
            // The multipleComparisons block is verbatim from real files:
            // all three sub-blocks are always present and only `type`
            // selects one. discoveryLevel 1.0 and significanceLevel 0.05
            // are the uniform observed values; pValueStyle
            // FULL_SINGLE_ASTERISK is the majority (8 of 11).
            multipleComparisons: {
              type: mcType,
              statistical: {
                test: "HOLM_SIDAK",
                report: { adjustedPValues: true },
                options: { significanceLevel: 0.05 },
              },
              fdr: {
                test: "BENJAMINI_KRIEGER_YEKUTIELI",
                options: { discoveryLevel: 1.0 },
              },
              noCorrection: { options: { significanceLevel: 0.05 } },
            },
            report: { negLog10: false, negLog2: false },
            graph: { volcanoPlot: true },
            options: { swapDirection: false },
            output: {
              significantDigitCount: 4,
              pValueStyle: { type: "P_VALUE_STYLE_FULL_SINGLE_ASTERISK", decimalDigitCount: 6 },
            },
          },
        });
        setJson(`analyses/${analysisUid}/constants.json`, { "@class": "AnalysisConstants", version: "0.0.0" });
        if (mcType === "STATISTICAL") holmSidakWritten.push(node.name);
        else bkyWritten.push(node.name);
        report.analyses.push(node.name);
      } else {
        report.analysesNotWritten.push(`${node.name} (${node.analysisType} — not yet supported in Prism)`);
      }
    }
  }

  // One Prism analysis per Titer node, not per source analysis (the importer
  // splits one Prism 4PL over two datasets into two nodes) — say so plainly.
  const analysisNodes = report.analyses.length;
  if (analysisNodes > 0) {
    issues.push({
      severity: "warning",
      message: `Analyses are written one per Titer node (${analysisNodes} written) — a Prism analysis over two datasets becomes two Titer nodes on import, and each writes back as its own analysis.`,
    });
  }
  // Multiple-t-tests correction substitutions (seq 289): Prism has no
  // plain-Holm option and no observed Benjamini-Hochberg fdr.test, so the
  // written file uses Prism's nearest methods and Prism recomputes the
  // adjusted p-values on open — they will differ slightly from Titer's.
  if (holmSidakWritten.length) {
    issues.push({
      severity: "warning",
      message: `Multiple t tests with Holm correction (${holmSidakWritten.length} written) use Prism's Holm-Šídák method instead — Prism offers no plain-Holm option, so the adjusted p-values Prism computes on open will differ slightly from Titer's Holm values.`,
    });
  }
  if (bkyWritten.length) {
    issues.push({
      severity: "warning",
      message: `Multiple t tests with FDR correction (${bkyWritten.length} written) use Prism's two-stage Benjamini-Krieger-Yekutieli method instead of Titer's Benjamini-Hochberg — the q-values Prism computes on open will differ from Titer's.`,
    });
  }
  issues.push({
    severity: "warning",
    message:
      "Graphs and layouts are not written — Prism stores them in a binary format it does not document. Re-create them in Prism from the tables.",
  });

  // Info sheets: one `info/<uid>/sheet.json` each, listed in document.json's
  // sheets.info — the shape the importer reads (an InfoSheet with title,
  // notesText and name/value constants). The trailing empty constant Prism
  // writes is a new-row placeholder Titer doesn't emit. `selectedCellsRange`
  // is REQUIRED, not cosmetic: real Prism 11.2.0 dereferences it
  // unconditionally on open, so omitting it crashes Prism (EXC_BAD_ACCESS /
  // SIGSEGV, KERN_INVALID_ADDRESS at 0x0 — seq 175, regression on 1.6.2).
  // Bisection (Nov 18, 24 files in real Prism 11.2.0) proved the field
  // alone is sufficient: a selectedCellsRange-only variant opens clean,
  // while uiState-only still crashes. Value is the real-Prism default.
  const infoUids: string[] = [];
  for (const infoNode of project.rootOrder.map((id) => project.nodes[id]).filter((n) => n?.type === "info")) {
    const infoUid = crypto.randomUUID().toUpperCase();
    infoUids.push(infoUid);
    titles[infoUid] = { title: infoNode.name };
    setJson(`info/${infoUid}/sheet.json`, {
      "@class": "InfoSheet",
      $id: "sheets/info_sheet/info_sheet.schema.json",
      uid: infoUid,
      fenID: 0,
      title: infoNode.name,
      notesText: infoNode.info?.notes ?? "",
      selectedCellsRange: {
        endCell: { row: 0, column: 0 },
        startCell: { row: 0, column: 0 },
      },
      constants: (infoNode.info?.constants ?? []).map((c) => ({ name: c.name, value: c.value })),
    });
    report.infoSheets.push(infoNode.name);
  }

  setJson("document.json", {
    "@class": "Document",
    creationDate: new Date().toISOString(),
    createdBy: { name: "Titer", version: appVersion },
    formatVersion: "1-4-1",
    minFormatVersion: "1-4-0",
    minPrismVersion: "10.3.0",
    sheets: {
      graphs: [],
      layouts: [],
      analyses: analysisUids,
      info: infoUids,
      data: dataSheetUids,
    },
    sheetAttributesMap: titles,
  });

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, report };
}

/** The transfer report as plain text, for the save dialog and the log. */
export function formatWriteReport(report: PrismWriteReport): string {
  const lines: string[] = [
    `Tables written: ${report.tables.length}${report.tables.length ? " — " + report.tables.join(", ") : ""}`,
    `Analyses written: ${report.analyses.length}${report.analyses.length ? " — " + report.analyses.join(", ") : ""}`,
    ...(report.infoSheets.length
      ? [`Info sheets written: ${report.infoSheets.length} — ${report.infoSheets.join(", ")}`]
      : []),
  ];
  if (report.analysesNotWritten.length) {
    lines.push(`Analyses not written (not yet supported in Prism): ${report.analysesNotWritten.join("; ")}`);
  }
  for (const issue of report.issues)
    lines.push(`${issue.severity === "error" ? "Error" : "Warning"}: ${issue.message}`);
  return lines.join("\n");
}
