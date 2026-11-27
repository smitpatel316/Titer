// `.prism` → `.hlx` converter core (in-app).
//
// Reads a Prism 10 `.prism` file (a ZIP of JSON + CSVs) and builds the Titer
// project it holds: data tables with their values, and the analyses Titer
// offers, with their parameters. Graphs and layouts are NOT transferred —
// Prism stores them in an undocumented binary blob — and neither are
// fitted results: Titer recomputes every analysis from the table when the
// file opens, so results always match the data.
//
// Ported from the standalone converter CLI (branch `feat/prism-converter-cli`,
// `converter/src/prism.ts` — 510/510 checks on the 66-file public corpus,
// 41/41 synthetic), with two post-rebase corrections the CLI predates:
//   1. The Nov 10 rebase adopted upstream survival and dropped the TS
//      log-rank: the registry key is now `"survival"`, not
//      `"survival-log-rank"` (which `parseProjectFile` now flags as an
//      unknown test). The importer emits `"survival"` with
//      `{ curveTest: "logrank", correction: "holm" }`.
//   2. Prism `survival` tables import as Titer tableType `"survival"` —
//      as `.pzfx` import does, and as the analysis picker expects — not
//      `"xy"` as the pre-rebase CLI wrote.
// D1 (single converter source of truth, decided 2026-11-12): THIS file is
// the canonical converter. The standalone CLI (`feat/prism-converter-cli`,
// `converter/src/prism.ts`) still carries its own copy with the two deltas
// above unapplied — it must be migrated to import this file (a Buffer IS a
// Uint8Array, so the CLI can pass one straight through) and then
// `converter/src/prism.ts` + `converter/src/csv.ts` deleted, with the
// CLI's corpus tests (510/510) + synthetic (41/41) + unit (326) re-run
// against this file. Until that migration lands, the two copies must not
// drift: the two deltas are pinned by tests/prism.ts (the post-rebase
// survival-type regression check), so a drift that touches them fails the
// suite. This file is never edited from the CLI lane, and the CLI copy is
// never edited from here.
//
// The field-by-field mapping lives in the vault:
//   ~/workspace/helix-vault/Research/Prism 10 to hlx mapping.md
// That doc is the spec; this file implements it. Anything the doc marks
// unknown is a warning here, never a guess.
//
// Clean-room: written from files Prism wrote, never from Prism's program.
// The source file is only ever read, never written.

import JSZip from "jszip";
import type { ProjectFilePayload } from "./project-file";
import type { ProjectNode, TableData, TableType } from "../store/types";
import type { NonlinearModel } from "../stats/types";
import { parseCsv } from "./prism-csv";
import { parseDateCell, parseElapsedCell, prismDateTimeConversion, type XColumnFormat, type XConversion } from "./date-time";
import { newConstantId, readInfoConstants } from "./info-sheets";
import { summarySubcolumns, type SummaryFormat } from "./summary-format";

export interface ConvertIssue {
  severity: "error" | "warning";
  message: string;
}

export interface ConvertReport {
  source: string;
  /** Prism version that wrote the file, from document.json. */
  prismVersion: string;
  formatVersion: string;
  /** Tables transferred, in file order. */
  tables: string[];
  /** Analysis nodes transferred, in file order. */
  analyses: string[];
  /** Analyses present in the file that Titer doesn't offer (named, not dropped). */
  analysesUnsupported: string[];
  graphsNotTransferred: number;
  layoutsNotTransferred: number;
  infoSheets: number;
  /** Info sheets transferred, in file order. */
  infoSheetNames: string[];
  orphanSheetsIgnored: number;
  unreferencedTablesIgnored: number;
  /** Graphs the regen planner could rebuild, when plans were computed for
   *  this report (see `formatReport`'s pointer). Unset when no planning ran. */
  regenerableGraphs?: number;
  issues: ConvertIssue[];
}

/** One imported table, as the graph-regen planner needs it: which Prism
 *  datasets feed it, and the formats the sidecar mapping reads. Built by
 *  `convertPrism` alongside the nodes (the tableUid→nodeId map the
 *  planner resolves a graph's `inputDataSets` through). */
export interface PrismTableIndexEntry {
  sheetUid: string;
  tableUid: string;
  nodeId: string;
  name: string;
  /** Prism `table.format` as written ("column" | "xy" | "grouped" | "survival" | "contingency" | "nested" | …). */
  format: string;
  /** Prism `table.dataFormat` as written ("y_sd_n", "y_replicates", …). */
  dataFormat: string;
  /** Dataset uids of the table, in file order. */
  datasetUids: string[];
  replicatesCount?: number;
}

/** What `convertPrism` exposes for the graph-regen planner
 *  (`src/lib/prism-graph-regen.ts`): the imported tables and the
 *  nonlinear-regression analysis each input dataset got, if any. */
export interface PrismIndex {
  tables: PrismTableIndexEntry[];
  /** Imported nonlinear-regression analysis node id, by input dataset uid. */
  analysisNodeByDatasetUid: Record<string, string>;
}

export interface ConvertResult {
  project: ProjectFilePayload;
  report: ConvertReport;
  /** The imported tables + analyses, for the graph-regen planner. */
  prismIndex?: PrismIndex;
  /** Graph-regen plans, when the caller computed them (see
   *  `planGraphRegeneration` in `src/lib/prism-graph-regen.ts`). */
  graphPlans?: import("./prism-graph-regen").GraphPlan[];
}

// ── Prism document shapes (only the fields the converter reads) ─────────

interface PrismDocument {
  createdBy?: { version?: string };
  formatVersion?: string;
  sheets?: {
    graphs?: string[];
    layouts?: string[];
    analyses?: string[];
    info?: string[];
    data?: string[];
  };
  sheetAttributesMap?: Record<string, { title?: string | { string?: string } }>;
}

interface PrismDataSheet {
  /** Sheet title — a plain string, or a rich-text object (see PrismDataSet). */
  title?: string | { string?: string };
  table?: {
    uid?: string;
    format?: string;
    dataFormat?: string;
    replicatesCount?: number;
    dataSets?: string[];
    xDataSet?: string;
    rowTitlesDataSet?: string;
  };
}

interface PrismDataSet {
  /**
   * The dataset's title. Usually a plain string — but Prism sometimes
   * writes a rich-text object `{ string, version, formatting }` (seen in
   * real files: dose-curve, dilution, ELISA). `plainTitle` unwraps it.
   */
  title?: string | { string?: string };
  format?: string;
  replicates?: { cellAttributes?: PrismCellAttributes[] }[];
  /** `y_replicates` datasets carry this instead of `replicates`: a list of
   *  ranges, each covering one or more replicate subcolumns ("0~1" = two,
   *  "2" = one). */
  "replicate ranges"?: { range?: string; replicate?: { cellAttributes?: PrismCellAttributes[] } }[];
  /** Survival X datasets carry this: how their dates become durations. */
  dateTimeConversion?: { units?: string; zeroDate?: string };
}

/** One `cellAttributes` entry on a Prism replicate: the rows it covers
 *  ("8", or an inclusive range "9~10") and the attributes those cells
 *  carry. An entry whose attributes include `"EXCLUDED"` is a
 *  struck-through cell (BUG-10) — real Prism stores exclusions here, in
 *  the dataset JSON; `data.csv` still holds the excluded values as plain
 *  numbers. Entries with empty attributes are formatting runs, not
 *  exclusions. */
interface PrismCellAttributes {
  rows?: string;
  attributes?: string[];
}

/**
 * The pure helpers below are exported for the unit tests
 * (tests/unit-helpers.ts) — the converter only uses them internally, and
 * nothing else should import them. They are the abstract layer: given a
 * known input shape, their output is pinned by tests so any file Prism
 * sends in behaves the same way.
 */
export function replicateCount(set: PrismDataSet, table: PrismDataSheet["table"]): number {
  if (Array.isArray(set.replicates)) return set.replicates.length;
  const ranges = set["replicate ranges"];
  if (Array.isArray(ranges)) {
    return ranges.reduce((n, r) => {
      const m = /^(\d+)(?:~(\d+))?$/.exec(r.range ?? "");
      if (!m) return n;
      return n + (m[2] === undefined ? 1 : Number(m[2]) - Number(m[1]) + 1);
    }, 0);
  }
  return table?.replicatesCount ?? 0;
}

/**
 * Problems with a dataset's "replicate ranges": strings that don't parse
 * as a range, and reversed ranges ("2~0"). A dataset with problems has an
 * UNKNOWN subcolumn count — the layout step infers it from the file's
 * dims or refuses the table; it must never silently count 0 and shift
 * the next dataset. `replicateCount` above still skips bad ranges when
 * called directly (its unit pin says so), but the converter never calls
 * it on a dataset with problems — it checks this first.
 */
export function replicateRangeProblems(set: PrismDataSet): string[] {
  const problems: string[] = [];
  const ranges = set["replicate ranges"];
  if (!Array.isArray(ranges)) return problems;
  for (const r of ranges) {
    const raw = r.range ?? "";
    const m = /^(\d+)(?:~(\d+))?$/.exec(raw);
    if (!m) {
      problems.push(`“${raw}” isn't a replicate range`);
      continue;
    }
    if (m[2] !== undefined && Number(m[2]) < Number(m[1])) {
      problems.push(`“${raw}” is reversed (start after end)`);
    }
  }
  return problems;
}

/**
 * Parse a Prism `cellAttributes` `rows` value: a single row ("8") or an
 * inclusive range ("9~10"). Null when it doesn't parse, is reversed, or
 * spans an absurd range (a corrupt entry must never allocate a huge array).
 */
export function parseExcludedRows(value: string): number[] | null {
  const m = /^(\d+)(?:~(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const a = Number(m[1]);
  if (m[2] === undefined) return [a];
  const b = Number(m[2]);
  if (b < a || b - a > 1_000_000) return null;
  const rows: number[] = [];
  for (let r = a; r <= b; r++) rows.push(r);
  return rows;
}

/**
 * A dataset's excluded (struck-through) rows, per subcolumn — real
 * Prism's representation (BUG-10): `cellAttributes` entries whose
 * attributes include `"EXCLUDED"`, inside `replicates[i]` (one replicate
 * per subcolumn) or `replicate ranges[i].replicate` (one replicate per
 * run of subcolumns). An entry applies to EVERY subcolumn its replicate
 * covers — there is no per-subcolumn index in the entry, and Prism
 * splits ranges where per-subcolumn exclusion patterns differ (seen in
 * capsanoicids S7: range 3 EXCLUDED rows 9~10, range 4~5 row 10 only).
 * `count` is the dataset's resolved subcolumn count; rows past
 * `rowCount` can't be cells. Problems are human-readable reasons an
 * entry couldn't be used — the caller warns about them and the cells
 * stay live, never silently dropped.
 */
export function excludedRowsBySubcolumn(
  set: PrismDataSet,
  count: number,
  rowCount: number,
): { excluded: Set<number>[]; problems: string[] } {
  const excluded = Array.from({ length: count }, () => new Set<number>());
  const problems: string[] = [];
  const apply = (subcolumns: number[], cellAttributes: PrismCellAttributes[] | undefined, where: string) => {
    for (const entry of cellAttributes ?? []) {
      if (!(entry.attributes ?? []).includes("EXCLUDED")) continue;
      const rows = typeof entry.rows === "string" ? parseExcludedRows(entry.rows) : null;
      if (rows === null) {
        problems.push(
          `excluded-cells entry “${entry.rows ?? ""}” (${where}) doesn't parse as a row or row range; those cells were left live`,
        );
        continue;
      }
      for (const r of rows) {
        if (r >= rowCount) {
          problems.push(
            `excluded-cells entry row ${r} (${where}) is past the table's ${rowCount} rows; it was left out`,
          );
          continue;
        }
        for (const s of subcolumns) excluded[s]?.add(r);
      }
    }
  };
  if (Array.isArray(set.replicates) && set.replicates.length > 0) {
    set.replicates.forEach((rep, i) => {
      if (i < count) apply([i], rep?.cellAttributes, `subcolumn ${i + 1}`);
    });
  } else if (Array.isArray(set["replicate ranges"])) {
    for (const entry of set["replicate ranges"]) {
      const m = /^(\d+)(?:~(\d+))?$/.exec(entry.range ?? "");
      if (!m) continue; // malformed ranges are already refused upstream
      const a = Number(m[1]);
      const b = m[2] === undefined ? a : Number(m[2]);
      const subs: number[] = [];
      for (let s = a; s <= b && s < count; s++) subs.push(s);
      apply(subs, entry.replicate?.cellAttributes, `replicate range “${entry.range ?? ""}”`);
    }
  }
  return { excluded, problems };
}

/** Subcolumns a Prism dataFormat spans when its shape is fixed — the
 *  count a MISSING dataset is skipped by (its JSON is gone, so no
 *  replicates/ranges can be read). `y_replicates` isn't here: its count
 *  varies, so it uses the table's replicatesCount instead; anything
 *  else is unknown and goes to the dims inference. */
const DATAFORMAT_SUBCOLUMNS: Record<string, number> = {
  y_single: 1,
  y_sd_n: 3,
  y_se_n: 3,
  y_cv_n: 3,
  y_sd: 2,
  y_se: 2,
  y_cv: 2,
  y_plus_minus: 3,
  y_high_low: 3,
};

/**
 * One entry of a Prism sheet's `inputDataSets`, in either encoding real
 * files use. Real Prism 11 writes GRAPH sheets' entries as BARE UID
 * STRINGS (seq 313 — verified on every real .prism graph sheet in the
 * public corpus) and ANALYSIS sheets' as {uid, title, idx} OBJECTS
 * (same corpus). Both are accepted everywhere an input is resolved, so
 * a bare string can never silently drop a dataset or a graph→analysis
 * link. Titer's own writer emits objects for analysis sheets, matching
 * real Prism; it writes no graph sheets (known ceiling, seq 289).
 */
export type PrismInputDataSet =
  | string
  | { uid?: string; title?: string | { string?: string }; idx?: string };

/** The dataset uid of an `inputDataSets` entry, in either encoding. */
export function inputDatasetUid(entry: PrismInputDataSet | undefined): string | undefined {
  if (typeof entry === "string") return entry;
  return entry?.uid;
}

interface PrismAnalysisSheet {
  /** Sheet title — a plain string, or a rich-text object (see PrismDataSet). */
  title?: string | { string?: string };
  analysisClass?: string;
  inputSheets?: { uid?: string; title?: string }[];
  inputDataSets?: PrismInputDataSet[];
}

interface PrismAnalysisParameters {
  analysisClass?: string;
  content?: {
    model?: { equation?: { name?: string } };
  };
}

// ── Column naming (same rules as the `.pzfx` importer, src/lib/pzfx.ts) ──

/** Summary subcolumns, by Prism dataFormat. `null` = raw replicates. */
const SUBCOLUMN_SUFFIXES: Record<string, string[] | null> = {
  y_replicates: null,
  y_single: [],
  y_sd_n: ["_MEAN", "_SD", "_N"],
  y_se_n: ["_MEAN", "_SEM", "_N"],
  y_cv_n: ["_MEAN", "_CV", "_N"],
  y_sd: ["_MEAN", "_SD"],
  y_se: ["_MEAN", "_SE"],
  y_cv: ["_MEAN", "_CV"],
  y_plus_minus: ["_MEAN", "_PLUSERROR", "_MINUSERROR"],
  y_high_low: ["_MEAN", "_PLUSERROR", "_MINUSERROR"],
};

/** Prism dataFormat → Titer summary format, for grouped import: the
 *  labels a summary table's subcolumns carry ("Mean"/"SD"/"N" …). Only
 *  summary formats are here — y_replicates / y_single have no summary
 *  format — and y_high_low is its own format (upper/lower limits), even
 *  though the writer emits y_plus_minus for both. */
const SUMMARY_FORMAT_BY_PRISM_DATAFORMAT: Record<string, SummaryFormat> = {
  y_sd_n: "mean-sd-n",
  y_se_n: "mean-sem-n",
  y_cv_n: "mean-cv-n",
  y_sd: "mean-sd",
  y_se: "mean-sem",
  y_cv: "mean-cv",
  y_plus_minus: "mean-plus-minus",
  y_high_low: "mean-upper-lower",
};

/** Prism nonlinear-regression equation name → Titer model. Only equations
 *  whose formula matches a Titer model exactly (checked against
 *  src/stats/xy/nonlinear-fit.ts modelSpec, not just the label):
 *  - "Sigmoidal, 4PL, X is concentration" is Titer sigmoidal-4pl-x.
 *  - "Sigmoidal, 4PL, X is log(concentration)" and the older
 *    "log(agonist)/log(inhibitor) vs. response -- Variable slope (four
 *    parameters)" are Titer sigmoidal-4pl-logx: Prism's
 *    Y=Bottom+(Top-Bottom)/(1+10^((LogEC50-X)*HillSlope)) is the same fit
 *    (LogIC50 vs LogEC50 is a name, not a different curve).
 *  - "One phase decay" is Titer one-phase-decay:
 *    Y=(Y0-Plateau)*exp(-K*X)+Plateau, terms Y0/Plateau/K.
 *  - "Line" is Titer line (lm y~x); "Second order polynomial (quadratic)"
 *    is Titer quadratic (lm y~x+I(x^2), terms B0/B1/B2).
 *  - The classic curves (v2, c0509ba) map by their Prism guide names, each
 *    checked against modelSpec's formula + terms, not just the label:
 *    "Gaussian" is Titer gaussian (Y=Amplitude*exp(-0.5*((X-Mean)/SD)^2),
 *    terms Amplitude/Mean/SD); "Boltzmann sigmoid" is Titer
 *    boltzmann-sigmoid (Y=Bottom+(Top-Bottom)/(1+exp((V50-X)/Slope)),
 *    terms Bottom/Top/V50/Slope); "Lorentzian" is Titer lorentzian
 *    (Y=Amplitude/(1+((X-Center)/Width)^2), terms Amplitude/Center/Width);
 *    "Sine wave" is Titer sine-wave (the nonzero-baseline form,
 *    Y=Amplitude*sin((2*pi*X/Wavelength)+PhaseShift)+Baseline, terms
 *    Amplitude/Wavelength/PhaseShift/Baseline); "Two phase decay" is Titer
 *    two-phase-decay (Y=Plateau+Span1*exp(-K1*X)+Span2*exp(-K2*X), terms
 *    Plateau/Span1/K1/Span2/K2 — Prism 8's classic "Two phase exponential
 *    decay"; Prism 10's built-in spells the spans SpanFast/SpanSlow, same
 *    curve family). Both spellings of the decay name map: the guide's page
 *    title is "Two phase decay" but a hyphenated "Two-phase decay" is also
 *    seen, and the importer keys on the name alone.
 *  Anything else is unsupported, never guessed. Equation names are trimmed
 *  before lookup — Prism writes at least one with a trailing space
 *  ("Second order polynomial (quadratic) "). */
const NONLINEAR_MODELS: Record<string, NonlinearModel> = {
  "Sigmoidal, 4PL, X is concentration": "sigmoidal-4pl-x",
  "Sigmoidal, 4PL, X is log(concentration)": "sigmoidal-4pl-logx",
  "log(agonist) vs. response -- Variable slope (four parameters)": "sigmoidal-4pl-logx",
  "log(inhibitor) vs. response -- Variable slope (four parameters)": "sigmoidal-4pl-logx",
  "One phase decay": "one-phase-decay",
  Line: "line",
  "Second order polynomial (quadratic)": "quadratic",
  Gaussian: "gaussian",
  "Boltzmann sigmoid": "boltzmann-sigmoid",
  Lorentzian: "lorentzian",
  "Sine wave": "sine-wave",
  "Two phase decay": "two-phase-decay",
  "Two-phase decay": "two-phase-decay",
  // 1.8 classic-curves completion (B6 names, verbatim from Prism 11.2.0's
  // Model tab): the rest of the Gaussian / Sine waves / Exponential
  // families. The cumulative Gaussian is listed under both Gaussian and
  // Lines in Prism's tree, with slightly different spellings ("Percents"
  // vs "Percentages", "Fraction" vs "Fractions") — all spellings map.
  "Sum of two Gaussians": "sum-of-two-gaussians",
  Lognormal: "lognormal",
  "Cumulative Gaussian -- Percents": "cumulative-gaussian-percent",
  "Cumulative Gaussian --  Percentages": "cumulative-gaussian-percent",
  "Cumulative Gaussian -- Fraction": "cumulative-gaussian-fraction",
  "Cumulative Gaussian -- Fractions": "cumulative-gaussian-fraction",
  "Cumulative Gaussian -- Counts": "cumulative-gaussian-counts",
  "Sum of two Lorentzians": "sum-of-two-lorentzians",
  "Lorentzian (Cauchy)": "lorentzian",
  "Standard sine wave": "standard-sine-wave",
  "Damped sine wave": "damped-sine-wave",
  "Sinc()": "sinc",
  "Sine wave with nonzero baseline": "sine-wave",
  "Three phase decay": "three-phase-decay",
  "Three-phase decay": "three-phase-decay",
  "Plateau followed by one phase association": "plateau-association",
  "Two phase association": "two-phase-association",
  "Two-phase association": "two-phase-association",
  "One phase association": "one-phase-association",
  "One-phase association": "one-phase-association",
  // 1.8 classic-curves completion (B6 §Lines, §Polynomial, §Growth):
  // verbatim Model-tab names. "Third order polynomial" carries a double
  // space in B6 (line 140) — both spellings map; the semilog log-Y line
  // likewise (B6 line 127, double space before "Y is log").
  "Straight line": "line",
  "Line through origin": "line-through-origin",
  "Horizontal line": "horizontal-line",
  "Semilog line -- X is log, Y is linear": "semilog-line",
  "Semilog line -- X is linear,  Y is log": "semilog-y-log",
  "Log-log line -- X and Y both log": "log-log-line",
  "Segmental linear regression": "segmental-linear",
  "Two intersecting lines. Fit the crossing point.": "segmental-linear",
  "First order polynomial (straight line)": "line",
  "Centered first order polynomial (straight line)": "centered-first",
  "Centered second order polynomial (quadratic)": "centered-second",
  "Third order polynomial  (cubic)": "cubic",
  "Third order polynomial (cubic)": "cubic",
  "Centered third order polynomial  (cubic)": "centered-third",
  "Centered third order polynomial (cubic)": "centered-third",
  "Fourth order polynomial": "quartic",
  "Centered fourth order polynomial": "centered-fourth",
  "Fifth order polynomial": "quintic",
  "Centered fifth order polynomial": "centered-fifth",
  "Sixth order polynomial": "sextic",
  "Centered sixth order polynomial": "centered-sixth",
  "Exponential growth with log(population)": "exponential-growth-log",
  // 1.8 classic-curves completion (B6 §Dose-response Stimulation/Inhibition):
  // verbatim Model-tab names. Stim #2/#6 and Inhib #2/#6 are the variable-
  // slope 4PLs, already mapped above as the sigmoidal-4pl forms.
  "[Agonist] vs. response (three parameters)": "agonist-3pl-x",
  "[Inhibitor] vs. response (three parameters)": "inhibitor-3pl-x",
  "log(agonist) vs. normalized response": "agonist-3pl-normalized-logx",
  "log(agonist) vs. normalized response -- Variable slope": "agonist-4pl-normalized-logx",
  "[Agonist] vs. normalized response": "agonist-3pl-normalized-x",
  "[Agonist] vs. normalized response -- Variable slope": "agonist-4pl-normalized-x",
  "log(inhibitor) vs. normalized response": "inhibitor-3pl-normalized-logx",
  "log(inhibitor) vs. normalized response -- Variable slope": "inhibitor-4pl-normalized-logx",
  "[Inhibitor] vs. normalized response": "inhibitor-3pl-normalized-x",
  "[Inhibitor] vs. normalized response -- Variable slope": "inhibitor-4pl-normalized-x",
  // 1.8 classic-curves completion (B6 §Dose-response Special, §Standard,
  // §Growth, §Linear quadratic, §Classic): verbatim Model-tab names.
  "Biphasic, X is concentration": "biphasic-x",
  "Biphasic, X is log(concentration)": "biphasic-logx",
  "Bell-shaped, X is concentration": "bell-shaped-x",
  "Bell-shaped, X is log(concentration)": "bell-shaped-logx",
  "Absolute IC50, X is concentration": "absolute-ic50-x",
  "Absolute IC50, X is log(concentration)": "absolute-ic50-logx",
  "Pade (1,1) approximant": "pade-11",
  "Power series: Y=A*X^B + C*X^D": "power-series",
  "Exponential plateau": "exponential-plateau",
  "Beta growth then decay": "beta-growth-decay",
  "Linear quadratic cell death (Y is fraction of cells surviving)": "lq-fraction-surviving",
  "Linear quadratic survival (Y is percentage)": "lq-percent-surviving",
  "Linear quadratic survival (Y is # alive cells)": "lq-count-alive",
  "Linear quadratic cell death (Y is fraction of dead cells)": "lq-fraction-dead",
  "Linear quadratic survival (Y is percentage cells dead)": "lq-percent-dead",
  "Linear quadratic survival (Y is # dead cells)": "lq-count-dead",
  // 1.8 classic-curves completion (B6 coverage sweep): verbatim Model-tab
  // names whose equation already ships as a single-curve model but had no
  // reader key — the pre-existing models were mapped only under the name
  // Prism writes in .prism files, which differs from the Model-tab name
  // (e.g. "Straight line" for "Line", "One phase decay" for "One phase
  // exponential decay"). Only names that are the same equation are added:
  // the separate-analysis models (binding saturation/kinetics, enzyme
  // inhibition, dose-response special) are NOT single-curve models and
  // stay out of this map. ("Line", "Gaussian" and "Lognormal" are already
  // keys above, unquoted — do not repeat them here.)
  "Semilog line": "semilog-line",
  "Hyperbola (X is concentration)": "hyperbola",
  "One site binding (hyperbola)": "hyperbola",
  "Asymmetric Sigmoidal, 5PL, X is log(concentration)": "asymmetric-5pl-logx",
  "Asymmetric Sigmoidal, 5PL, X is concentration": "asymmetric-5pl-x",
  "Asymmetric (five parameter), X is log(concentration)": "asymmetric-5pl-logx",
  "Asymmetric (five parameter), X is concentration": "asymmetric-5pl-x",
  "log(agonist) vs. response (three parameters)": "agonist-3pl-logx",
  "[Agonist] vs. response -- Variable slope (four parameters)": "sigmoidal-4pl-x",
  "log(inhibitor) vs. response (three parameters)": "inhibitor-3pl-logx",
  "[Inhibitor] vs. response -- Variable slope (four parameters)": "sigmoidal-4pl-x",
  "Gaussian distribution": "gaussian",
  "Boltzmann sigmoidal": "boltzmann-sigmoid",
  "Exponential growth equation": "exponential-growth",
  "Exponential (Malthusian) growth": "exponential-growth",
  "Exponential growth": "exponential-growth",
  "Gompertz growth": "gompertz-growth",
  "Logistic growth": "logistic-growth",
  "Plateau followed by one phase decay": "plateau-decay",
  "Michaelis-Menten": "michaelis-menten",
  "Allosteric sigmoidal": "allosteric-sigmoidal",
  "Substrate inhibition": "substrate-inhibition",
  "Sigmoidal dose-response": "agonist-3pl-logx",
  "Sigmoidal dose-response (variable slope)": "sigmoidal-4pl-logx",
  "One site competition": "inhibitor-3pl-logx",
  "Two site competition": "two-site-competition-logx",
  "One site - Fit logIC50": "inhibitor-3pl-logx",
  "Two sites - Fit logIC50": "two-site-competition-logx",
  "One site -- Homologous": "homologous-competition-logx",
  "One phase exponential decay": "one-phase-decay",
  "Two phase exponential decay": "two-phase-decay",
  "One phase exponential association": "one-phase-association",
  "Two phase exponential association": "two-phase-association",
  // B6 Classic #14: the first-order polynomial under its Classic-equations
  // name (the Second/Third/Fourth Order twins are keyed just below).
  "Polynomial: First Order (straight line)": "line",
  "Polynomial: Second Order (Y=A + B*X + C*X^2)": "quadratic",
  "Polynomial: Third Order (Y=A + B*X + C*X^2 + D*X^3)": "cubic",
  "Polynomial: Fourth Order (Y=A + B*X + C*X^2 + D*X^3 + E*X^4)": "quartic",
};

const genId = (type: string) => `${type}_${Math.random().toString(36).slice(2, 10)}`;

/**
 * A Prism title as plain text. Usually a string — but Prism sometimes
 * writes a rich-text object `{ string, version, formatting }` (seen on
 * dataset and X titles in real files). Anything else is "" and the
 * caller's fallback applies. Never returns "[object Object]".
 * A title can also carry Prism's multi-line break — a carriage return
 * inside the string ("BACE-I \r& DOX", "Nonlin fit of 15-HEPE-d5\r A").
 * Titer labels are single-line, so the break becomes one space (see
 * cleanText); the title is never left with a bare \r in it.
 */
export function plainTitle(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (value !== null && typeof value === "object") {
    const s = (value as { string?: unknown }).string;
    if (typeof s === "string") return cleanText(s);
  }
  return "";
}

/**
 * Prism writes multi-line labels with a carriage return as the line break
 * — inside a quoted CSV field ("BACE-I \r& DOX") or in a JSON title
 * string — and sometimes with a lone newline. Titer labels and cell
 * values are single-line: the break becomes one space, with surrounding
 * whitespace collapsed ("BACE-I & DOX", "WT (3 weeks)"). A value that is
 * only whitespace (a lone break, spaces) becomes "" — the caller turns
 * that into an empty cell, never a stray space. A bare \r anywhere else
 * would be a CSV line-ending leak, and the verifier's C8 check confirms
 * none survives.
 */
const cleanText = (value: string): string => {
  const collapsed = value.replace(/\s*(\r\n|\r|\n)\s*/g, " ");
  return collapsed.trim() === "" ? "" : collapsed;
};

/**
 * A Prism multi-line text value (Info Sheet notes) as plain text: unwrap a
 * rich-text `{ string }` like plainTitle, but KEEP the line breaks — notes
 * are multi-line prose, and cleanText would collapse every break into a
 * space and destroy them on import (R2-60). Carriage returns become
 * newlines; nothing else is folded.
 */
const plainMultiline = (value: unknown): string => {
  const s =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object"
        ? (value as { string?: unknown }).string
        : undefined;
  return typeof s === "string" ? s.replace(/\r\n?/g, "\n") : "";
};

/**
 * Parse a Prism date cell as UTC — one frame for every shape, so a
 * duration never depends on the machine's timezone. Prism writes naive
 * datetimes (no zone); reading them as UTC is the only reading that is
 * the same everywhere. The old code parsed ISO datetimes as local time
 * but date-only strings as UTC, so a 7-day span across a US DST change
 * came out 6.958 days under America/Los_Angeles.
 *
 * Shapes: ISO datetime ("2024-09-06 00:00:00", "2024-09-06T00:00:00",
 * optional seconds/fraction/trailing Z), date-only ("2024-09-06"), bare
 * year ("2024"), US "MM/DD/YYYY" ("12/17/2024"). A slash date whose
 * first component is over 12 can't be month-first, so it reads as
 * DD/MM ("13/02/2024" = 13 Feb); anything ambiguous stays month-first.
 * Anything else — including impossible dates like 2024-13-40 — is null.
 */
export function parsePrismDate(value: string | null): number | null {
  if (value === null || value === "") return null;
  const s = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:[Zz])?$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    const h = iso[4] === undefined ? 0 : Number(iso[4]);
    const mi = iso[5] === undefined ? 0 : Number(iso[5]);
    const sec = iso[6] === undefined ? 0 : Number(iso[6]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
    const ms = Date.UTC(y, mo - 1, d, h, mi, sec);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return ms;
  }
  const yearOnly = /^(\d{4})$/.exec(s);
  if (yearOnly) return Date.UTC(Number(yearOnly[1]), 0, 1);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = Number(slash[3]);
    const [mo, d] = a > 12 ? [b, a] : [a, b];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const ms = Date.UTC(y, mo - 1, d);
    const back = new Date(ms);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return ms;
  }
  return null;
}

/** Days between two Prism date cells, as Titer stores numbers (text). */
export function daysBetween(start: string | null, end: string | null): string | null {
  const a = parsePrismDate(start);
  const b = parsePrismDate(end);
  if (a === null || b === null) return null;
  const days = (b - a) / 86_400_000;
  return Number.isInteger(days) ? String(days) : String(Number(days.toFixed(6)));
}

/**
 * Number text → Titer text. Which rule applies is decided once per file
 * (see the thousands-mode pre-pass in convertPrism): decimal mode reads
 * a single comma as a decimal point (`1,5` → `1.5`, including scientific
 * notation: `4,096e+007` → `4.096e+007`); thousands mode
 * strips commas from grouped numbers (`1,234,567` → `1234567`) and
 * leaves anything else — including a lone comma decimal like `45,5` —
 * as typed text, because in a thousands-locale file that comma is not a
 * decimal point the file means.
 */
const normalizeNumber = (value: string | null, thousandsMode = false): string | null => {
  if (value === null) return null;
  if (thousandsMode) {
    return /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?([eE][+-]?\d+)?$/.test(value) ? value.replace(/,/g, "") : value;
  }
  return /^[+-]?\d+,\d+([eE][+-]?\d+)?$/.test(value) ? value.replace(",", ".") : value;
};

export function subcolumnNames(title: string, dataFormat: string, count: number): string[] {
  const base = title === "" ? "Y" : title;
  if (count === 1) return [base];
  const suffixes = SUBCOLUMN_SUFFIXES[dataFormat];
  if (suffixes && suffixes.length === count) return suffixes.map((s) => `${base}${s}`);
  if (suffixes === null) return Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
  return Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
}

/**
 * Whether a Prism dataFormat names summary subcolumns for a dataset this
 * wide — its suffix list exists and is exactly `count` long. `y_replicates`
 * (null) and `y_single` ([]) never fit a multi-column dataset; a summary
 * format fits only its own width.
 */
const summaryFits = (dataFormat: string, count: number): boolean => {
  const suffixes = SUBCOLUMN_SUFFIXES[dataFormat];
  return suffixes !== undefined && suffixes !== null && suffixes.length === count;
};

const isSummaryFormat = (dataFormat: string) => {
  const s = SUBCOLUMN_SUFFIXES[dataFormat];
  return s !== undefined && s !== null && s.length > 0;
};

/**
 * BUG-9 precedence, as a pure function for the graph-regen planner: the
 * table-level dataFormat wins when it describes this dataset (its suffix
 * list matches the subcolumn count) — real Prism files store the specific
 * statistic there: a y_cv_n table whose datasets say y_sd_n still means
 * MEAN/CV/N, not MEAN/SD/N. When the table format doesn't fit, the
 * dataset's own format carries the meaning. Anything else falls back to
 * the table's format. Mirrors the naming precedence in `convertPrism`.
 */
export function resolveDataFormat(tableDataFormat: string, datasetFormat: string, subcolumnCount: number): string {
  if (summaryFits(tableDataFormat, subcolumnCount)) return tableDataFormat;
  if (summaryFits(datasetFormat, subcolumnCount)) return datasetFormat;
  return tableDataFormat;
}

// ── The converter ────────────────────────────────────────────────────────

/** Ceiling for a .prism content.json declaration used to size the import:
 *  rows padded for a short CSV, columns inferred for an unknown dataset —
 *  the tabular importer's MAX_IMPORT_ROWS ceiling, applied here too. A 1e9
 *  declaration would otherwise pad a billion empty rows or infer a
 *  billion columns (R2-60). */
const MAX_PRISM_DECLARED = 50_000;

/** A content.json row/column declaration, validated: a finite number >= 0,
 *  capped at MAX_PRISM_DECLARED — anything else is undefined, and the
 *  caller warns and ignores the declaration (R2-60). */
const cappedDeclaredCount = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.floor(value), MAX_PRISM_DECLARED);
};

/** Load a `.prism` ZIP, or throw the plain-language refusal `convertPrism`
 *  throws. Exported so the graph-regen planner can share the one JSZip
 *  instance `convertPrism` already opened — the source is never unzipped
 *  twice. */
export async function loadPrismZip(data: Uint8Array, sourceName: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(data);
  } catch {
    throw new Error(
      `“${sourceName}” isn't a Prism 10 .prism file — it isn't a ZIP archive. ` +
        `A .prism file is a ZIP holding JSON and CSV files.`,
    );
  }
}

export async function convertPrism(
  data: Uint8Array,
  sourceName: string,
  preloadedZip?: JSZip,
): Promise<ConvertResult> {
  const issues: ConvertIssue[] = [];
  const zip = preloadedZip ?? (await loadPrismZip(data, sourceName));
  const readText = async (path: string): Promise<string | null> => {
    const file = zip.file(path);
    return file ? file.async("string") : null;
  };
  const readJson = async <T>(path: string): Promise<T | null> => {
    const text = await readText(path);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      issues.push({ severity: "warning", message: `“${path}” isn't valid JSON; it was left out.` });
      return null;
    }
  };

  const docText = await readText("document.json");
  if (docText === null) {
    throw new Error(
      `“${sourceName}” isn't a Prism 10 .prism file — document.json is missing. ` +
        `A .prism file is a ZIP with document.json at its top level.`,
    );
  }
  let doc: PrismDocument;
  try {
    doc = JSON.parse(docText) as PrismDocument;
  } catch {
    throw new Error(`“${sourceName}” has a document.json that isn't valid JSON — the file may be corrupt.`);
  }
  // document.json is file data: a null document, or a list where an object
  // belongs, must refuse cleanly — never throw an uncaught TypeError
  // mid-import (R2-60).
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(
      `“${sourceName}” has a document.json that isn't a Prism document — it holds ${Array.isArray(doc) ? "a list" : typeof doc}, not an object. The file may be corrupt.`,
    );
  }
  const sheets = doc.sheets ?? {};
  const titles = doc.sheetAttributesMap ?? {};
  // A sheet list that isn't a list is left out with a warning; non-string
  // entries are dropped (a sheet uid is a string). Every loop below reads
  // these lists, never the raw document, so a malformed document.json
  // can't throw mid-import (R2-60).
  const sheetUids = (value: unknown, key: string): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      issues.push({
        severity: "warning",
        message: `document.json lists “${key}” as a ${typeof value}, not a list of sheets; it was left out.`,
      });
      return [];
    }
    return value.filter((v): v is string => typeof v === "string");
  };
  const dataSheets = sheetUids(sheets.data, "data");
  const graphSheets = sheetUids(sheets.graphs, "graphs");
  const layoutSheets = sheetUids(sheets.layouts, "layouts");
  const analysisSheets = sheetUids(sheets.analyses, "analyses");
  const infoSheets = sheetUids(sheets.info, "info");
  const titleOf = (uid: string, fallback: string) => {
    const t = plainTitle(titles[uid]?.title);
    return t !== "" ? t : fallback;
  };

  const nodes: Record<string, ProjectNode> = {};
  const rootOrder: string[] = [];
  const childOrder: Record<string, string[]> = {};
  const tableNodeBySheet = new Map<string, string>();
  // The regen planner's index (see PrismIndex): filled alongside the nodes.
  const prismIndex: PrismIndex = { tables: [], analysisNodeByDatasetUid: {} };
  const report: ConvertReport = {
    source: sourceName,
    prismVersion: doc.createdBy?.version ?? "unknown",
    formatVersion: doc.formatVersion ?? "unknown",
    tables: [],
    analyses: [],
    analysesUnsupported: [],
    graphsNotTransferred: graphSheets.length,
    layoutsNotTransferred: layoutSheets.length,
    infoSheets: infoSheets.length,
    infoSheetNames: [],
    orphanSheetsIgnored: 0,
    unreferencedTablesIgnored: 0,
    issues,
  };

  // ── File-level comma rule (m6) ──
  // Prism records no locale, so the file's own values decide: if any
  // data.csv cell holds a number with two or more comma digit-groups
  // ("1,234,567"), commas are thousands separators file-wide and are
  // stripped; otherwise a single comma is a decimal separator ("45,5"
  // → "45.5"). The scan runs on PARSED cells — raw CSV text can't tell
  // a field separator from a thousands separator ("0,100,100" as text
  // is three cells, not one number).
  let thousandsMode = false;
  let thousandsExample = "";
  for (const path of Object.keys(zip.files)) {
    if (!/^data\/tables\/[^/]+\/data\.csv$/.test(path)) continue;
    const csvFile = zip.file(path);
    if (!csvFile) continue;
    const rows = parseCsv(await csvFile.async("string"));
    for (const row of rows) {
      for (const cell of row) {
        if (/^[+-]?\d{1,3}(,\d{3}){2,}(\.\d+)?([eE][+-]?\d+)?$/.test(cell)) {
          thousandsMode = true;
          thousandsExample = cell;
          break;
        }
      }
      if (thousandsMode) break;
    }
    if (thousandsMode) break;
  }
  if (thousandsMode) {
    issues.push({
      severity: "warning",
      message: `Commas look like thousands separators in this file (e.g. “${thousandsExample}”), so commas were stripped from numbers rather than read as decimal points.`,
    });
  }

  // ── Data tables ──
  for (const sheetUid of dataSheets) {
    const sheet = await readJson<PrismDataSheet>(`data/sheets/${sheetUid}/sheet.json`);
    if (!sheet || !sheet.table?.uid) {
      issues.push({ severity: "warning", message: `Data sheet “${sheetUid}” has no table; it was left out.` });
      continue;
    }
    const table = sheet.table;
    const name = plainTitle(sheet.title) || titleOf(sheetUid, "Imported table");
    const displayName = `“${name}”`;
    const tableUid = table.uid as string;

    const content = await readJson<{ numberOfColumns?: number; numberOfRows?: number }>(
      `data/tables/${tableUid}/content.json`,
    );
    // A declared row/column count is file data, never trusted blindly: a
    // non-finite or negative count is ignored, and an over-large one is
    // capped — a 1e9 declaration would otherwise pad a billion empty rows,
    // and Infinity would loop forever (R2-60).
    const numberOfRows = cappedDeclaredCount(content?.numberOfRows);
    if (numberOfRows === undefined && content?.numberOfRows !== undefined) {
      issues.push({
        severity: "warning",
        message: `${displayName}: content.json declares numberOfRows as ${String(content.numberOfRows)} — not a usable count, so the declaration was ignored.`,
      });
    } else if (typeof content?.numberOfRows === "number" && content.numberOfRows > MAX_PRISM_DECLARED) {
      issues.push({
        severity: "warning",
        message: `${displayName}: content.json declares numberOfRows as ${content.numberOfRows}, over the ${MAX_PRISM_DECLARED.toLocaleString()} import ceiling — it was clamped to ${MAX_PRISM_DECLARED.toLocaleString()}.`,
      });
    }
    const numberOfColumns = cappedDeclaredCount(content?.numberOfColumns);
    if (numberOfColumns === undefined && content?.numberOfColumns !== undefined) {
      issues.push({
        severity: "warning",
        message: `${displayName}: content.json declares numberOfColumns as ${String(content.numberOfColumns)} — not a usable count, so the declaration was ignored.`,
      });
    } else if (typeof content?.numberOfColumns === "number" && content.numberOfColumns > MAX_PRISM_DECLARED) {
      issues.push({
        severity: "warning",
        message: `${displayName}: content.json declares numberOfColumns as ${content.numberOfColumns}, over the ${MAX_PRISM_DECLARED.toLocaleString()} import ceiling — it was clamped to ${MAX_PRISM_DECLARED.toLocaleString()}.`,
      });
    }
    const csvText = await readText(`data/tables/${tableUid}/data.csv`);
    if (csvText === null) {
      issues.push({ severity: "warning", message: `${displayName} has no data.csv; it was left out.` });
      continue;
    }
    let csv = parseCsv(csvText);
    if (numberOfRows !== undefined) {
      if (csv.length > numberOfRows) csv = csv.slice(0, numberOfRows);
      // A CSV shorter than the declared rows is padded with empty rows
      // (kept behaviour) — but say so, instead of inventing rows silently.
      if (csv.length < numberOfRows) {
        issues.push({
          severity: "warning",
          message: `${displayName}: the file holds ${csv.length} rows but content.json declares ${numberOfRows}; the missing rows were left empty.`,
        });
      }
      while (csv.length < numberOfRows) csv.push([]);
    }

    const format = table.format ?? "";
    const dataFormat = table.dataFormat ?? "";
    const setUids = Array.isArray(table.dataSets)
      ? table.dataSets.filter((u): u is string => typeof u === "string")
      : [];
    // ── Layout: resolve every dataset's subcolumn count BEFORE reading
    // any values (B1/B2/B3). A count is known from the dataset JSON
    // (replicates / replicate ranges / table replicatesCount); a missing
    // dataset is skipped by the table's replicatesCount (y_replicates)
    // or its dataFormat's fixed shape; anything still unknown is
    // inferred from content.json's numberOfColumns when it is the ONLY
    // unknown. Two or more unknowns, or an inference that doesn't fit
    // the declared width, refuses the table — never silently shift.
    const declaredCols = numberOfColumns ?? (csv[0]?.length ?? 0);
    // The CSV's first column holds row titles only when the table has a
    // row-titles dataset. Never assume it from the format: column tables
    // usually have none, and XY tables sometimes have one (empty titles).
    const hasTitleCol = table.rowTitlesDataSet != null;
    const titleCols = hasTitleCol ? 1 : 0;

    const xSet = table.xDataSet ? await readJson<PrismDataSet>(`data/sets/${table.xDataSet}.json`) : null;
    const setJsons: (PrismDataSet | null)[] = [];
    for (const setUid of setUids) {
      setJsons.push(await readJson<PrismDataSet>(`data/sets/${setUid}.json`));
    }
    if (setJsons.every((s) => s === null)) {
      issues.push({ severity: "warning", message: `${displayName} holds no data columns. It was left out.` });
      continue;
    }
    // A present dataset's count is known unless its replicate ranges are
    // malformed — then it is unknown, never 0.
    const knownCount = (set: PrismDataSet): number | null =>
      replicateRangeProblems(set).length > 0 ? null : replicateCount(set, table);
    // A missing dataset's skip count, when the table itself determines it.
    const missingCount = (): number | null => {
      if (dataFormat === "y_replicates" && typeof table.replicatesCount === "number") {
        return table.replicatesCount;
      }
      return DATAFORMAT_SUBCOLUMNS[dataFormat] ?? null;
    };

    let xTitle: string | null = null;
    let xCount: number | null = 0;
    let xFormat = "";
    // An XY table's date/elapsed X format, when the file carries one (seq 332).
    let xDateFormat: XColumnFormat | undefined;
    let xDateConversion: XConversion | undefined;
    if (table.xDataSet) {
      if (xSet) {
        const t = plainTitle(xSet.title);
        xTitle = t !== "" ? t : "X";
        xCount = knownCount(xSet);
        xFormat = xSet.format ?? "";
      } else {
        // A missing X is always unknown: its count comes only from the
        // dims inference below, never from a 1-column guess.
        xTitle = "X";
        xCount = null;
      }
    }
    const counts: (number | null)[] = setJsons.map((s) => (s === null ? missingCount() : knownCount(s)));
    const knownSum = titleCols + (xCount ?? 0) + counts.reduce<number>((n, c) => n + (c ?? 0), 0);
    const unknownCount = (xCount === null ? 1 : 0) + counts.filter((c) => c === null).length;
    if (unknownCount >= 2) {
      issues.push({
        severity: "warning",
        message: `${displayName}: ${unknownCount} datasets have unknown column counts (missing JSON or malformed replicate ranges), so the table can't be laid out without guessing; it was left out.`,
      });
      continue;
    }
    if (unknownCount === 1) {
      const inferred = declaredCols - knownSum;
      if (inferred < 0) {
        issues.push({
          severity: "warning",
          message: `${displayName}: the known datasets already span ${knownSum} columns but the file declares only ${declaredCols}; the table was left out rather than guessing.`,
        });
        continue;
      }
      if (xCount === null) {
        xCount = inferred;
        issues.push({
          severity: "warning",
          message:
            inferred === 0
              ? `${displayName}: the X dataset “${table.xDataSet}” is missing; it spans no columns, so the table has no X column.`
              : `${displayName}: the X dataset “${table.xDataSet}” is missing; ${inferred} column(s) were read as X (inferred from the file's ${declaredCols} declared columns).`,
        });
      } else {
        const idx = counts.indexOf(null);
        counts[idx] = inferred;
        if (setJsons[idx] === null) {
          issues.push({
            severity: "warning",
            message:
              inferred === 0
                ? `${displayName}: dataset “${setUids[idx]}” is missing; it spans no columns, so nothing was skipped.`
                : `${displayName}: dataset “${setUids[idx]}” is missing; its ${inferred} column(s) were skipped (inferred from the file's ${declaredCols} declared columns).`,
          });
        } else {
          const problems = replicateRangeProblems(setJsons[idx] as PrismDataSet);
          issues.push({
            severity: "warning",
            message: `${displayName}: dataset “${setUids[idx]}” has malformed replicate ranges (${problems.join("; ")}); its column count was inferred from the file's ${declaredCols} declared columns (${inferred} column(s)).`,
          });
        }
      }
    } else {
      // No unknowns: warn about each missing dataset whose skip count
      // the table itself determined, so the skip is visible.
      setUids.forEach((uid, i) => {
        if (setJsons[i] !== null) return;
        const c = counts[i] as number;
        issues.push({
          severity: "warning",
          message: `${displayName}: dataset “${uid}” is missing; its ${c} column(s) were skipped (${dataFormat === "y_replicates" ? "the table's replicatesCount" : `the table's ${dataFormat} shape`}).`,
        });
      });
    }
    if (xCount === 0) xTitle = null;
    const hasXCol = xTitle !== null && (xCount as number) > 0;
    // Ordered layout entries (present or missing), each with its resolved
    // count — the emission loops walk this, advancing the CSV cursor by
    // every entry's count whether or not it becomes a Titer column.
    interface LayoutSet {
      set: PrismDataSet | null;
      count: number;
    }
    const layoutSets: LayoutSet[] = setUids.map((_, i) => ({ set: setJsons[i], count: counts[i] as number }));

    // Titer columns: [Title, ...data]. Each entry: name + values per row.
    interface ImportColumn {
      name: string;
      values: (string | null)[];
    }
    const columns: ImportColumn[] = [];
    // CSV column cursor: title col, then X subcolumns, then each dataset's
    // subcolumns. An empty CSV field is an empty cell (null in .hlx), not "".
    // A field that is only whitespace (or only a line break) is empty too.
    let cursor = 0;
    const csvCol = (i: number) =>
      csv.map((r) => {
        const v = r[i];
        if (v === "" || v === undefined) return null;
        const cleaned = cleanText(v);
        return cleaned === "" ? null : normalizeNumber(cleaned, thousandsMode);
      });
    if (hasTitleCol) cursor++; // row titles are read separately below
    if (hasXCol) {
      const xCols: (string | null)[][] = [];
      for (let i = 0; i < (xCount as number); i++) {
        xCols.push(csvCol(cursor));
        cursor++;
      }
      if ((xCount as number) === 1) {
        columns.push({ name: xTitle as string, values: xCols[0] });
      } else if (format === "survival" && xFormat.startsWith("date") && (xCount as number) >= 2) {
        // A survival table's X is time. With dates Prism stores start and
        // end dates; time is the gap between them, in days — exactly what
        // Prism's own survival analysis uses.
        const durations = xCols[0].map((start, r) => daysBetween(start, xCols[1][r] ?? null));
        const unparsed = xCols[0].filter(
          (v, r) => v !== null && v !== "" && durations[r] === null && xCols[1][r] !== null && xCols[1][r] !== "",
        ).length;
        columns.push({ name: xTitle as string, values: durations });
        issues.push({
          severity: "warning",
          message:
            `${displayName}: the X dates were converted to durations in days (end − start), which is what the survival analysis uses as time.` +
            (unparsed > 0 ? ` ${unparsed} row(s) had a date that couldn't be read, so their time is empty.` : ""),
        });
        // The durations are days only when the file says Days — anything
        // else (Hours, Weeks, …) is a different time scale, so say so.
        const xUnits = xSet?.dateTimeConversion?.units;
        if (xUnits !== undefined && xUnits !== "Days") {
          issues.push({
            severity: "warning",
            message: `${displayName}: the X dates use “${xUnits}” units, but the durations were converted to days; check the time scale before using them.`,
          });
        }
      } else {
        // Titer tables hold one X column: keep the first subcolumn (the
        // value; for an error-bar X the second is the error) and say so.
        columns.push({ name: xTitle as string, values: xCols[0] });
        issues.push({
          severity: "warning",
          message: `${displayName}: the X dataset has ${xCount} subcolumns; only the first was imported as X.`,
        });
      }
      // An XY table whose X dataset says date/elapsed (seq 332): keep the
      // format and its conversion, so a .prism round-trip preserves it. Only
      // when at least one X value actually reads as a date/elapsed time — a
      // numeric X with a date format stays numbers. Survival X is handled
      // above (durations in days), never as a date column.
      if (format === "xy" && xFormat.startsWith("date") && xCols[0]?.some((v) => parseDateCell(v) !== null)) {
        xDateFormat = "date";
        xDateConversion = prismDateTimeConversion(xSet?.dateTimeConversion);
        if (xSet?.dateTimeConversion?.units === "Months") {
          issues.push({
            severity: "warning",
            message: `${displayName}: the X dates use “Months” units, which Titer doesn't convert (a month isn't a fixed length) — days were used instead.`,
          });
        }
      } else if (format === "xy" && xFormat === "elapsed" && xCols[0]?.some((v) => parseElapsedCell(v) !== null)) {
        xDateFormat = "elapsed";
        xDateConversion = prismDateTimeConversion(xSet?.dateTimeConversion);
      }
    }
    let groups: number | undefined;
    let replicates: number | undefined;
    let summaryFormat: SummaryFormat | undefined;
    if (format === "grouped") {
      groups = layoutSets.filter((e) => e.set !== null).length;
      replicates = table.replicatesCount ?? Math.max(...layoutSets.filter((e) => e.set !== null).map((e) => e.count));
      // One group's summary format: the format whose subcolumn labels
      // span the group's full width — the dataset's own format first,
      // then the table's — unless the dataset explicitly says replicates
      // (y_replicates), which stays Y1…Yn. A format that doesn't span
      // the width never mislabels columns.
      const groupFormat = (setFormat: string): SummaryFormat | undefined => {
        if (setFormat === "y_replicates") return undefined;
        const own = SUMMARY_FORMAT_BY_PRISM_DATAFORMAT[setFormat];
        if (own !== undefined && summarySubcolumns(own).length === replicates) return own;
        const table = SUMMARY_FORMAT_BY_PRISM_DATAFORMAT[dataFormat];
        if (table !== undefined && summarySubcolumns(table).length === replicates) return table;
        return undefined;
      };
      const formatsUsed: (SummaryFormat | undefined)[] = [];
      for (const entry of layoutSets) {
        if (entry.set === null) {
          cursor += entry.count;
          continue;
        }
        // A group name must be colon-free — seriesKeyOf splits at the
        // first ":" (the .pzfx importer sanitizes the same way): a title
        // like "1:10" would become "1:10:Y1" and split into group "1".
        const group = (plainTitle(entry.set.title) || "Group").replace(/:/g, "-");
        const formatUsed = groupFormat(entry.set.format ?? "");
        formatsUsed.push(formatUsed);
        const labels = formatUsed !== undefined ? summarySubcolumns(formatUsed) : [];
        const names =
          labels.length > 0
            ? labels.map((s) => `${group}:${s}`)
            : Array.from({ length: replicates as number }, (_, i) => `${group}:Y${i + 1}`);
        // A ragged group is padded with empty subcolumns to `replicates`,
        // so the grid stays rectangular and leadOf sees a full group.
        for (let i = 0; i < (replicates as number); i++) {
          if (i < entry.count) {
            columns.push({ name: names[i], values: csvCol(cursor) });
            cursor++;
          } else {
            columns.push({ name: names[i], values: Array.from({ length: csv.length }, () => null) });
          }
        }
      }
      // The table's summaryFormat: set only when every present group was
      // named with the same summary format — a mixed table stays
      // replicates at the table level, so no group is misread as
      // summaries.
      summaryFormat =
        formatsUsed.length > 0 && formatsUsed.every((f) => f !== undefined && f === formatsUsed[0])
          ? formatsUsed[0]
          : undefined;
    } else {
      for (const entry of layoutSets) {
        if (entry.set === null) {
          cursor += entry.count;
          continue;
        }
        // Naming precedence (BUG-9): the table-level dataFormat wins when
        // it describes this dataset (its suffix list matches the
        // subcolumn count) — real Prism files store the specific
        // statistic there: a y_cv_n table whose datasets say y_sd_n
        // still means MEAN/CV/N, not MEAN/SD/N. When the table format
        // doesn't fit (a mixed table: an xy table's "XX error" dataset
        // is y_single beside y_sd_n Y datasets, so the table says
        // y_single), the dataset's own format carries the meaning —
        // Ya_MEAN/Ya_SD/Ya_N, not Ya_1/Ya_2/Ya_3. Anything else falls
        // back to _1/_2/_3 inside subcolumnNames.
        const setFormat = entry.set.format ?? "";
        const names = subcolumnNames(
          plainTitle(entry.set.title),
          summaryFits(dataFormat, entry.count)
            ? dataFormat
            : summaryFits(setFormat, entry.count)
              ? setFormat
              : dataFormat,
          entry.count,
        );
        for (let i = 0; i < entry.count; i++) {
          columns.push({ name: names[i], values: csvCol(cursor) });
          cursor++;
        }
      }
    }

    const rowTitles = hasTitleCol
      ? csv.map((r) => (r[0] === "" || r[0] === undefined ? null : cleanText(r[0]) || null))
      : [];
    const hasRowTitles = rowTitles.some((v) => v !== null && v !== "");
    const rowCount = Math.max(0, ...columns.map((c) => c.values.length), rowTitles.length);
    if (rowCount === 0 || columns.length === 0) {
      issues.push({ severity: "warning", message: `${displayName} holds no data. It was left out.` });
      continue;
    }
    // CSV columns the converter consumed: title + every X subcolumn + every
    // dataset subcolumn — from the layout, not from the Titer columns
    // (missing datasets consume CSV columns without becoming Titer ones,
    // and multi-subcolumn X collapses into one Titer column).
    const consumedCols = titleCols + (xCount as number) + layoutSets.reduce((n, e) => n + e.count, 0);
    if (numberOfColumns !== undefined && numberOfColumns > consumedCols) {
      issues.push({
        severity: "warning",
        message: `${displayName}: the file holds ${numberOfColumns} columns but only ${consumedCols} map to Titer columns; the extra columns were left out.`,
      });
    }

    let helixType: TableType;
    if (format === "xy") helixType = "xy";
    else if (format === "survival") helixType = "survival";
    else if (format === "grouped") helixType = "grouped";
    else if (format === "contingency") helixType = "contingency";
    else if (format === "column") helixType = "column";
    else if (format === "parts_of_whole") helixType = "parts-of-whole";
    else if (format === "nested") {
      // A Prism nested table is one of Prism's formats, but Titer's nested
      // table needs its own structure — import as Column, never silently.
      helixType = "column";
      issues.push({
        severity: "warning",
        message: `${displayName}: Prism nested tables import as Column — there is no convert-to-Nested in Titer yet; make a new Nested table (Table ▸ New Table ▸ Nested) with the same groups, subgroups and replicates, then copy the values across.`,
      });
    } else {
      helixType = "column";
      issues.push({
        severity: "warning",
        message: `${displayName}: table format “${format}” isn't one Titer knows; it was imported as a Column table.`,
      });
    }
    if (format === "survival") {
      issues.push({
        severity: "warning",
        message: `${displayName}: imported as a Survival table (time in X, event codes 1 = event, 0 = censored in each group) — the survival graph and log-rank analysis apply to it.`,
      });
    }
    if (isSummaryFormat(dataFormat)) {
      issues.push({
        severity: "warning",
        message: `${displayName}: the values are summaries (${dataFormat}), not raw replicates — don't run group comparisons on them as if they were.`,
      });
    }

    const data: TableData = {
      columns: ["Title", ...columns.map((c) => c.name)],
      rows: Array.from({ length: rowCount }, (_, r) => [
        hasRowTitles ? (rowTitles[r] ?? null) : null,
        ...columns.map((c) => c.values[r] ?? null),
      ]),
      ...(groups !== undefined && replicates !== undefined ? { groups, replicates } : {}),
      ...(summaryFormat !== undefined ? { summaryFormat } : {}),
      ...(xDateFormat === undefined
        ? {}
        : { xFormat: xDateFormat, ...(xDateConversion === undefined ? {} : { xConversion: xDateConversion }) }),
    };
    // Excluded cells (BUG-10): real Prism flags struck-through cells in
    // the dataset JSON (see excludedRowsBySubcolumn); the values stay in
    // data.csv, so the reader must restore the flag or the values come
    // back as live data. Keys are full-grid "row,col" (col 0 = row
    // titles, never excluded); the Titer columns are [X?] + each present
    // dataset's subcolumns, in order — a missing dataset consumes CSV
    // columns but becomes no Titer column, so the cursor below advances
    // only for present datasets.
    {
      const excludedKeys: string[] = [];
      const collect = (set: PrismDataSet | null, count: number, firstCol: number, label: string) => {
        if (!set) return;
        const { excluded, problems } = excludedRowsBySubcolumn(set, count, rowCount);
        for (const p of problems) {
          issues.push({ severity: "warning", message: `${displayName}: ${label} — ${p}.` });
        }
        excluded.forEach((rows, j) => {
          for (const r of rows) excludedKeys.push(`${r},${firstCol + j}`);
        });
      };
      if (hasXCol && xSet) collect(xSet, 1, 1, "the X dataset");
      let colCursor = 1 + (hasXCol ? 1 : 0);
      for (const entry of layoutSets) {
        if (entry.set === null) continue;
        collect(entry.set, entry.count, colCursor, `dataset “${plainTitle(entry.set.title) || "Y"}”`);
        colCursor += entry.count;
      }
      if (excludedKeys.length) {
        excludedKeys.sort((a, b) => {
          const [ar, ac] = a.split(",").map(Number);
          const [br, bc] = b.split(",").map(Number);
          return ar - br || ac - bc;
        });
        data.excluded = excludedKeys;
      }
    }
    const node: ProjectNode = {
      id: genId("table"),
      type: "table",
      name,
      parentId: null,
      tableType: helixType,
      data,
    };
    nodes[node.id] = node;
    rootOrder.push(node.id);
    childOrder[node.id] = [];
    tableNodeBySheet.set(sheetUid, node.id);
    prismIndex.tables.push({
      sheetUid,
      tableUid,
      nodeId: node.id,
      name,
      format,
      dataFormat,
      datasetUids: setUids,
      ...(typeof table.replicatesCount === "number" ? { replicatesCount: table.replicatesCount } : {}),
    });
    report.tables.push(name);
  }

  // ── Info sheets ──
  // `info/<uid>/sheet.json` holds the constants (name + string value) and
  // the notes; the sheet has no table link in the format Titer can trust
  // (no `table` reference on an InfoSheet), so it opens as project info.
  // The trailing empty-named constant Prism writes (name "" + value "") is
  // the new-row placeholder, not a constant — it is left out.
  interface PrismInfoSheet {
    // Prism sometimes writes the title / notes / constant values as a
    // rich-text object `{ string, version, formatting }` instead of a
    // plain string (real files: capsanoicids, dilution-analysis,
    // senolytics-25hc — BUG-5). `plainTitle` unwraps those; the types
    // say so here so the lie can't reach the writer again.
    title?: string | { string?: string };
    notesText?: string | { string?: string };
    constants?: { name?: string | { string?: string }; value?: string | number | { string?: string } }[];
  }
  for (const infoUid of infoSheets) {
    const sheet = await readJson<PrismInfoSheet>(`info/${infoUid}/sheet.json`);
    if (!sheet) {
      issues.push({ severity: "warning", message: `Info sheet “${infoUid}” has no sheet.json; it was left out.` });
      continue;
    }
    // Titles map first (as before); the sheet's own title is the fallback,
    // unwrapped — it can also be a rich-text object.
    const name = titleOf(infoUid, plainTitle(sheet.title) || "Project info");
    const constants = readInfoConstants(
      (Array.isArray(sheet.constants) ? sheet.constants : []).map((c) => ({
        id: newConstantId(),
        name: plainTitle(c.name),
        value:
          c.value === undefined
            ? ""
            : typeof c.value === "object" && c.value !== null
              ? plainTitle(c.value)
              : String(c.value),
      })),
    );
    const node: ProjectNode = {
      id: genId("info"),
      type: "info",
      name,
      parentId: null,
      info: { constants, notes: plainMultiline(sheet.notesText), linkedTableId: null },
    };
    nodes[node.id] = node;
    rootOrder.push(node.id);
    report.infoSheetNames.push(name);
  }

  // ── Analyses ──
  for (const analysisUid of analysisSheets) {
    const sheet = await readJson<PrismAnalysisSheet>(`analyses/${analysisUid}/sheet.json`);
    if (!sheet) {
      issues.push({ severity: "warning", message: `Analysis “${analysisUid}” has no sheet.json; it was left out.` });
      continue;
    }
    const name = plainTitle(sheet.title) || titleOf(analysisUid, "Imported analysis");
    const inputSheetUid = sheet.inputSheets?.[0]?.uid;
    const parentId = inputSheetUid ? tableNodeBySheet.get(inputSheetUid) : undefined;
    if (!parentId) {
      issues.push({
        severity: "warning",
        message: `Analysis “${name}” has no input table in this file; it was left out.`,
      });
      continue;
    }
    const params = await readJson<PrismAnalysisParameters>(`analyses/${analysisUid}/parameters.json`);
    const analysisClass = sheet.analysisClass ?? params?.analysisClass ?? "";

    if (analysisClass === "NONLINEAR_REGRESSION") {
      const equation = (params?.content?.model?.equation?.name ?? "").trim();
      const model = NONLINEAR_MODELS[equation];
      if (!model) {
        report.analysesUnsupported.push(`${name} (nonlinear model “${equation}” — not yet supported in Titer)`);
        continue;
      }
      const inputs = sheet.inputDataSets ?? [];
      if (inputs.length === 0) {
        issues.push({
          severity: "warning",
          message: `Analysis “${name}” (nonlinear model “${equation}”) has no input datasets; it was left out.`,
        });
        continue;
      }
      for (const ds of inputs) {
        const dsUid = inputDatasetUid(ds);
        // A bare-string entry carries no dataset title (real Prism writes
        // analysis inputs as objects — the string form is tolerated, not
        // expected); the node is still named, just without the (dataset).
        const y = typeof ds === "string" ? undefined : plainTitle(ds.title);
        const node: ProjectNode = {
          id: genId("analysis"),
          type: "analysis",
          name: y ? `${name} (${y})` : name,
          parentId,
          analysisType: "nonlinear-regression",
          analysisParams: { model, ...(y ? { y } : {}) },
        };
        nodes[node.id] = node;
        childOrder[parentId].push(node.id);
        report.analyses.push(node.name);
        // The regen planner links a graph to this analysis by its input
        // dataset's uid — the graph's `inputDataSets` entry.
        if (dsUid) prismIndex.analysisNodeByDatasetUid[dsUid] = node.id;
      }
    } else if (analysisClass === "SURVIVAL") {
      const node: ProjectNode = {
        id: genId("analysis"),
        type: "analysis",
        name,
        parentId,
        analysisType: "survival",
        // One curve test per node; log-rank is Prism's headline comparison
        // and Titer's default. Gehan–Breslow–Wilcoxon is a second run of
        // the same analysis (curveTest "gehan"), not a second node.
        analysisParams: { curveTest: "logrank", correction: "holm" },
      };
      nodes[node.id] = node;
      childOrder[parentId].push(node.id);
      report.analyses.push(name);
    } else {
      report.analysesUnsupported.push(`${name} (${analysisClass} — not yet supported in Titer)`);
    }
  }

  // ── Orphans: sheets and tables document.json doesn't list ──
  const listedSheets = new Set([
    ...dataSheets,
    ...graphSheets,
    ...layoutSheets,
    ...analysisSheets,
    ...infoSheets,
  ]);
  for (const path of Object.keys(zip.files)) {
    const m = /^data\/sheets\/([^/]+)\/sheet\.json$/i.exec(path);
    if (m && !listedSheets.has(m[1].toUpperCase()) && !listedSheets.has(m[1])) report.orphanSheetsIgnored++;
  }
  // Tables referenced by ANY sheet in the zip (listed or orphan) count as
  // referenced; only tables no sheet points at are unreferenced.
  const referencedTables = new Set<string>();
  for (const path of Object.keys(zip.files)) {
    const m = /^data\/sheets\/([^/]+)\/sheet\.json$/i.exec(path);
    if (!m) continue;
    const sheet = await readJson<PrismDataSheet>(path);
    const uid = (sheet?.table as { uid?: string } | undefined)?.uid;
    if (uid) referencedTables.add(uid.toUpperCase());
  }
  for (const path of Object.keys(zip.files)) {
    const m = /^data\/tables\/([^/]+)\/content\.json$/i.exec(path);
    if (m && !referencedTables.has(m[1].toUpperCase())) report.unreferencedTablesIgnored++;
  }

  // A project with no tables is not a project Titer can open — its own
  // parser rejects it ("no readable data tables"). Refuse cleanly instead
  // of writing a .hlx that Titer itself won't read.
  if (report.tables.length === 0) {
    const dataSheetCount = dataSheets.length;
    throw new Error(
      `“${sourceName}” has no data tables Titer can use — all ${dataSheetCount} data sheet(s) were left out, ` +
        `and graphs/layouts are not transferred. Nothing was written.`,
    );
  }

  return {
    project: { nodes, rootOrder, childOrder, activeNodeId: rootOrder[0] ?? null },
    report,
    prismIndex,
  };
}

/** The transfer report as plain text, for the terminal and the log. */
export function formatReport(report: ConvertReport): string {
  const lines: string[] = [
    `Converted “${report.source}” (Prism ${report.prismVersion}, format ${report.formatVersion}).`,
    `Tables transferred: ${report.tables.length}${report.tables.length ? " — " + report.tables.join(", ") : ""}`,
    `Analyses transferred: ${report.analyses.length}${report.analyses.length ? " — " + report.analyses.join(", ") : ""}`,
  ];
  if (report.analysesUnsupported.length) {
    lines.push(`Analyses not transferred (not yet supported in Titer): ${report.analysesUnsupported.join("; ")}`);
  }
  if (report.graphsNotTransferred) {
    lines.push(
      `Graphs not transferred: ${report.graphsNotTransferred} — re-create in Titer (graph data is stored in a binary format Prism does not document).` +
        (report.regenerableGraphs
          ? ` Regenerate graphs… can rebuild ${report.regenerableGraphs === 1 ? "the auto-created one" : `the ${report.regenerableGraphs} auto-created ones`}.`
          : ""),
    );
  }
  if (report.layoutsNotTransferred) {
    lines.push(`Layouts not transferred: ${report.layoutsNotTransferred} — re-create with the figure builder.`);
  }
  if (report.infoSheets)
    lines.push(
      `Info sheets transferred: ${report.infoSheets}${report.infoSheetNames.length ? " — " + report.infoSheetNames.join(", ") : ""}.`,
    );
  if (report.orphanSheetsIgnored || report.unreferencedTablesIgnored) {
    lines.push(
      `Ignored: ${report.orphanSheetsIgnored} orphan sheet(s) and ${report.unreferencedTablesIgnored} unreferenced table(s) that document.json doesn't list.`,
    );
  }
  for (const issue of report.issues)
    lines.push(`${issue.severity === "error" ? "Error" : "Warning"}: ${issue.message}`);
  return lines.join("\n");
}
