// Shared logic for column-based tests. Each test is a `ColumnTestSpec` that
// only declares how many groups it needs, the R it runs, and how to label the
// resulting numbers. Every number an analysis shows comes from R, its groups'
// descriptives too (`describe`): the same for every test.

import { maxOf } from "../../lib/summary";
import { pairKey } from "../../lib/columns";
import type { TAILS, AnalysisType, AnalysisOutcome, Column, ComparisonRow, DifferenceResult, EffectSizeRow, GroupDescriptives, NormalityRow, StatRow } from "../types";
import { evalNamedVector } from "../webr";

/** A group as a test sees it: a name and its numbers. */
export interface Group {
  name: string;
  values: number[];
}

/** The columns holding at least one number, each an independent group. */
export function dataGroups(columns: Column[]): Column[] {
  return columns.filter((c) => c.values.length > 0);
}

/** How many rows a matched test (on `columns`) leaves out: those holding some of its
 *  values, not one in every column. Empty rows don't count. */
export function incompleteRows(columns: Column[]): number {
  const used = new Set(dataGroups(columns).flatMap((c) => c.rows)).size;
  return used - (pairedGroups(columns)[0]?.values.length ?? 0);
}

/** What a matched test says of its rows: complete ones only, and how many it left out. */
export function matchedRowsNote(columns: Column[]): string {
  const left = incompleteRows(columns);
  const leftOut = left ? ` ${left} row${left === 1 ? "" : "s"} left out for missing data.` : "";
  return `Uses complete rows only (every subject measured in every group).${leftOut}`;
}

/** Row-aligned groups for matched tests: only the rows where every column holding
 *  data has a number, so the i-th values of all groups come from the same row.
 *  Columns without any number are left out first, so an unused column can't empty
 *  every row. */
export function pairedGroups(columns: Column[]): Group[] {
  const withData = dataGroups(columns);
  const rows = withData[0]?.rows.filter((r) => withData.every((c) => c.byRow[r] != null)) ?? [];
  return withData.map((c) => ({ name: c.name, values: rows.map((r) => c.byRow[r]!) }));
}

/** R: each group's (`G`, a list) n, mean, SD and SEM (n − 1; none under 2 values) and
 *  median, named `n_i`, `m_i`, `s_i`, `e_i`, `md_i`. An empty group arrives as
 *  `c()`, i.e. NULL — and `median(NULL)` is NULL (length 0), so without the
 *  `is.null` coercion `setNames` got 5 names for a 4-vector and the whole
 *  call threw a raw R error instead of returning nulls (v1.5.0 m18). */
export const R_DESCRIBE =
  "unlist(lapply(seq_along(G),function(i){x<-G[[i]];if(is.null(x))x<-numeric(0);n<-length(x);s<-if(n>1)sd(x) else NA;" +
  'setNames(c(n,mean(x),s,s/sqrt(n),median(x)),paste0(c("n_","m_","s_","e_","md_"),i-1))}))';

// NaN is not null: R's mean of an empty group is NaN, and `?? null` would
// let it through as a value.
const num = (x: number | null | undefined): number | null => (x == null || Number.isNaN(x) ? null : x);

/** Each group's descriptives, computed by R, and the difference of means of each of
 *  `pairs` (`diff(i, j)`). An empty group comes back as nulls (n = 0), never
 *  NaN: R's `mean(numeric(0))` is NaN, and `?? null` does not catch NaN, so
 *  the mapping coerces it here (v1.5.0 m18). */
export async function describe(
  groups: Group[],
  pairs: [number, number][] = [],
): Promise<{ groups: GroupDescriptives[]; diff: (i: number, j: number) => number | null }> {
  const v = await evalNamedVector(
    `G<-list(${groups.map((g) => rVec(g.values)).join(",")});` +
      // An empty group is NULL in R and mean(NULL) warns; coerce once here
      // so both R_DESCRIBE and the difference below see numeric(0).
      `G<-lapply(G,function(x)if(is.null(x))numeric(0) else x);` +
      `c(${R_DESCRIBE}${pairs.map(([i, j]) => `,d_${i}_${j}=mean(G[[${i + 1}]])-mean(G[[${j + 1}]])`).join("")})`,
  );
  return { groups: describedBy(v, groups), diff: (i, j) => num(v[`d_${i}_${j}`]) };
}

/** Each group's descriptives as `R_DESCRIBE` names them in `v`. */
export const describedBy = (v: Record<string, number | null>, groups: { name: string }[]): GroupDescriptives[] =>
  groups.map((g, i) => ({
    name: g.name,
    mean: num(v[`m_${i}`]),
    sd: num(v[`s_${i}`]),
    sem: num(v[`e_${i}`]),
    median: num(v[`md_${i}`]),
    n: v[`n_${i}`] ?? 0,
  }));

/** Render an R numeric vector literal from values. No row-count cap or
 *  chunking (CC-m10, measured 2026-11-16): serializing is linear and cheap
 *  on the JS side — 100k rows ≈ 35 ms / 1.8 MB per column, 1M rows ≈ 760 ms
 *  / 18 MB — and the R-side parse dominates the round-trip (100k rows
 *  ≈ 2.8 s, 250k ≈ 4.2 s end to end), still far under the 5-minute eval
 *  watchdog at realistic table sizes, so none was added. Re-measure
 *  (tests/checks.ts, "serializing a column as an R literal stays linear
 *  and small") before adding one. */
export const rVec = (values: number[]) => `c(${values.join(",")})`;

/** Escape a string for safe embedding in an R double-quoted literal, so a group
 *  or column name containing `"` or `\` can't break (or inject into) the R code. */
export const rStr = (s: string) =>
  `"${s
    .replace(/\0/g, "") // R's strings can't hold a NUL
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')}"`;

/** Declare each group as an R variable `g0`, `g1`, … for use in a test's rCode. */
export const declareGroups = (groups: Group[]) => groups.map((g, i) => `g${i}<-${rVec(g.values)}`).join(";");

/** The error for a column a wizard chose that the table no longer has (deleted, or
 *  renamed outside Titer): never fall back on another column. */
export const missingColumn = (name: string) =>
  `The column “${name}” is no longer in the table. Create this analysis again to choose another.`;

/** A P-value stat row (rendered with significance colour + stars). */
export const pRow = (label: string, value: number | null): StatRow => ({ label, value, p: true });

/** R only understands `TRUE`/`FALSE` (uppercase) — JS's `${bool}` interpolates
 *  lowercase "true"/"false", which R reads as undefined variable names. */
export const rBool = (b: boolean) => (b ? "TRUE" : "FALSE");

/** R's t.test/wilcox.test `alternative=` uses "two.sided" (dot); our params use kebab-case. */
export const rAlt = (tails: (typeof TAILS)[number]) => (tails === "two-sided" ? "two.sided" : tails);

/** Declares g0,g1,…, stacks them into `v`, and factors them into `gr` with
 *  generic "G1","G2",… labels — the shared setup every ≥3-group test (and its
 *  optional post-hoc comparisons) builds on. Generic labels sidestep quoting
 *  issues from real column names containing spaces/punctuation. */
export function groupsSetup(groups: Group[]): string {
  const k = groups.length;
  const lengths = groups.map((g) => g.values.length).join(",");
  return (
    `${declareGroups(groups)};v<-c(${groups.map((_, i) => `g${i}`).join(",")});` +
    `gr<-factor(rep(1:${k},c(${lengths})),levels=1:${k},labels=paste0("G",1:${k}))`
  );
}

/** Every (i, j) pair with i < j for k groups, 0-indexed — the fixed iteration
 *  order shared by R-side pairwise statements and JS-side comparison rows. */
export function pairIndices(k: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  }
  return pairs;
}

/** R: `ptk(q, k, df)`, the studentized range's upper tail. R's `ptukey` needs 2 df or more;
 *  below (Games-Howell on duplicates, a paired comparison of 2 subjects), its exact integral
 *  over the SD's distribution, checked against Tukey's tables at 1 df and the t at k = 2. */
export const R_PTUKEY =
  "ptk<-function(q,k,df)if(is.na(q)||is.na(df))NA else if(df>=2)ptukey(q,k,df,lower.tail=FALSE) else " +
  "integrate(function(s)ptukey(q*s,k,Inf,lower.tail=FALSE)*2*df*s*dchisq(df*s^2,df),0,Inf,rel.tol=1e-10)$value";

/** R: P values corrected for the `m` pairs of a family (`adj`, from each pair's raw P), and a
 *  pair's corrected P from its |t| (`pa`), by `how`: Bonferroni, Šidák, Holm-Šidák (step-down:
 *  the smallest P against m pairs, the next against m − 1…, never below an earlier one),
 *  the False Discovery Rate (Benjamini-Hochberg step-up: the i-th smallest P against m/i
 *  pairs, never below a larger one), or Fisher's LSD (none). Holm-Šidák's step-down and
 *  the FDR's step-up give no CI (`pa` NA): no single critical value covers the family.
 *  `adj` counts only the non-NA pairs in `m` — as R's `p.adjust` does — and leaves NA
 *  pairs NA (seq 311: a NaN pair used to inflate m for its siblings, and one NA in the
 *  FDR branch poisoned the whole family through `cummin`). `pa` takes `m` from its
 *  caller, which must pass the non-NA count (e.g. `sum(!is.na(ps))`), not the family's
 *  length, or the CIs come out too wide by the same miscount. */
export const R_ADJUST = `adj<-function(p,how){idx<-which(!is.na(p));q<-p[idx];m<-length(q);if(how=="fisher")return(p);if(how=="bonferroni"){r<-p;r[idx]<-pmin(1,m*q);return(r)}
if(how=="sidak"){r<-p;r[idx]<-1-(1-q)^m;return(r)};o<-order(q);if(how=="fdr"){a<-rev(cummin(rev(m/seq_len(m)*q[o])));r<-p;r[idx[o]]<-pmin(1,a);return(r)}
a<-cummax(1-(1-q[o])^(m-seq_len(m)+1));r<-p;r[idx[o]]<-pmin(1,a);r}
pa<-function(t,df,how,m){p<-2*pt(-abs(t),df);switch(how,fisher=p,bonferroni=pmin(1,m*p),sidak=1-(1-p)^m,NA)}`;

/** The pairs a test compares: every pair, or those `compared` names (`pairKey`, either way
 *  round), in the order of every pair. */
export function comparedPairs(groups: { name: string }[], compared: string[] | undefined): [number, number][] {
  const all = pairIndices(groups.length);
  if (!compared?.length) return all;
  const chosen = new Set(compared);
  return all.filter(
    ([i, j]) =>
      chosen.has(pairKey(groups[i].name, groups[j].name)) || chosen.has(pairKey(groups[j].name, groups[i].name)),
  );
}

/** R: `crit(f)`, the statistic at which a comparison's adjusted P (`f`, falling as the
 *  statistic grows) is 0.05: its multiplicity-adjusted 95% CI is its difference ± that many
 *  standard errors, so the CI leaves out 0 exactly when P < 0.05. */
export const R_CRIT =
  'crit<-function(f,from=c(0.01,50))tryCatch(uniroot(function(x)f(x)-0.05,from,extendInt="downX",tol=1e-10)$root,error=function(e)NA)';

/** R: a comparison's 95% CI as `lo_<key>` and `hi_<key>`: `diff` ± `crit(function(x) f)`
 *  standard errors (`se`). */
export const ciOf = (key: string, diff: string, se: string, f: string) => ciAt(key, diff, se, `crit(function(x)${f})`);

/** R: the same CI from a critical value `h` found once for a whole family (one Dunnett's or
 *  Tukey's: the same distribution for every comparison, its search done once). */
export const ciAt = (key: string, diff: string, se: string, h: string) =>
  `setNames({d<-${diff};h<-(${h})*(${se});c(d-h,d+h)},c("lo_${key}","hi_${key}"))`;

/** R's `c()` only names an element from an explicit `name = value` tag — a bare
 *  variable reference like `c(p_0_1)` comes back unnamed, so `evalNamedVector`
 *  can't recover it under that key. Post-hoc helpers below return `assign`,
 *  the same keys rewritten as `p_0_1=p_0_1, …`, for embedding in the final `c(...)`. */
const asNamedArgs = (keys: string[]) => keys.map((k) => `${k}=${k}`).join(",");

/** R statements pulling one adjusted P value per group pair out of a
 *  `TukeyHSD(...)$<term>` comparison matrix (rows named "Gj-Gi", j > i),
 *  keyed by explicit `p_i_j` names so extraction never depends on row order. */
export function tukeyPosthocStatements(
  k: number,
  aovExpr = "aov(v~gr)",
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => `${keys[idx]}<-tk[match("G${j + 1}-G${i + 1}",rn),4]`);
  return {
    setup: `tk<-TukeyHSD(${aovExpr})$gr;rn<-rownames(tk);${assigns.join(";")}`,
    keys,
    assign: asNamedArgs(keys),
  };
}

/** Same shape for any `pairwise.*.test(...)$p.value`-style lower-triangular
 *  matrix indexed by group label (pairwise.t.test, pairwise.wilcox.test, …). */
export function pairwisePosthocStatements(
  k: number,
  matrixExpr: string,
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => `${keys[idx]}<-pm["G${j + 1}","G${i + 1}"]`);
  return { setup: `pm<-${matrixExpr};${assigns.join(";")}`, keys, assign: asNamedArgs(keys) };
}

/** Dunn's test: pairwise z-tests between each group's mean rank, corrected
 *  across all `k*(k-1)/2` comparisons — the standard rank-based post-hoc for both
 *  Kruskal-Wallis (global ranks across all groups) and Friedman (within-block ranks).
 *  `rbarSetup` must assign a `Rbar` vector named "G1".."Gk" (each group's mean rank);
 *  `seExpr(i, j)` is the R expression for that pair's standard error. `adjustment`
 *  picks the correction: "bonferroni" multiplies the raw P by m in R (as before);
 *  "sidak" / "holm-sidak" leave the raw P values for the TypeScript adjustment
 *  (`adjustPValues`, via the spec's `adjustComparisons`) — the step-down
 *  Holm–Šídák needs the whole family sorted, which R can't see one pair at a time. */
export function dunnPosthocStatements(
  k: number,
  rbarSetup: string,
  seExpr: (i: number, j: number) => string,
  adjustment: "bonferroni" | "sidak" | "holm-sidak" = "bonferroni",
): { setup: string; keys: string[]; assign: string } {
  const pairs = pairIndices(k);
  const m = pairs.length;
  const keys = pairs.map(([i, j]) => `p_${i}_${j}`);
  const assigns = pairs.map(([i, j], idx) => {
    const z = `((Rbar[["G${i + 1}"]]-Rbar[["G${j + 1}"]])/(${seExpr(i, j)}))`;
    const raw = `2*(1-pnorm(abs(${z})))`;
    return adjustment === "bonferroni"
      ? `${keys[idx]}<-pmin(1,${raw}*${m})`
      : `${keys[idx]}<-${raw}`;
  });
  return { setup: `${rbarSetup};${assigns.join(";")}`, keys, assign: asNamedArgs(keys) };
}

/** The P-value adjustments a post-hoc can apply to a family's raw P values, in
 *  TypeScript (plan 25): Šídák's single-step `1 − (1 − p)^m`, and Holm–Šídák's
 *  step-down — for the i-th smallest P (i = 1…m), the max over j ≤ i of
 *  `1 − (1 − p_(j))^(m−j+1)`, capped at 1. `m` is the family size (the
 *  count of non-null P values — R's `p.adjust` drops NAs, so a null P is
 *  not a comparison); null P values pass through unadjusted. With m = 1
 *  both are the identity. Pure arithmetic — no R, no package. */
export type PAdjustment = "sidak" | "holm-sidak";

export function adjustPValues(ps: (number | null)[], method: PAdjustment): (number | null)[] {
  // m is the count of non-null P values (R's p.adjust drops NAs).
  const m = ps.filter((p) => p != null).length;
  if (method === "sidak") {
    return ps.map((p) => (p == null ? null : Math.min(1, 1 - (1 - p) ** m)));
  }
  // Holm–Šídák: sort the non-null values, adjust step-down, then unsort.
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const out: (number | null)[] = ps.map(() => null);
  let runningMax = 0;
  sorted.forEach(([p, i], rank) => {
    runningMax = Math.max(runningMax, Math.min(1, 1 - (1 - p!) ** (m - rank)));
    out[i] = runningMax;
  });
  return ps.map((p, i) => (p == null ? null : out[i]));
}

/** Adjust a comparisons table's P values in place-order (same rows back, new P
 *  values) — the spec hook's one-liner for a whole-family adjustment. */
export function adjustComparisonRows(rows: ComparisonRow[], method: PAdjustment): ComparisonRow[] {
  const adjusted = adjustPValues(
    rows.map((r) => r.p),
    method,
  );
  return rows.map((r, i) => ({ ...r, p: adjusted[i] }));
}

/** The FDR-approach methods Prism offers after an ANOVA: Benjamini-Hochberg
 *  (BH), the two-stage Benjamini-Krieger-Yekutieli (BKY), Benjamini-Yekutieli (BY). */
export type FdrMethod = "bh" | "bky" | "by";

/** The FDR-adjusted P values (q-values) of a family's raw P values, in
 *  TypeScript (the FDR approach's whole-family step-up needs the family sorted,
 *  which R can't see one pair at a time — same reason Šídák / Holm–Šídák live
 *  here). BH: for the i-th smallest P (i = 1…m), the min over k ≥ i of
 *  `m·p_(k)/k`, capped at 1. BY: the same, times the m-th harmonic number
 *  (valid under any dependence). BKY (two-stage): a first BH pass at level
 *  Q/(1+Q) estimates how many of the m nulls are true (m₀ = m − rejections);
 *  the BH formula then runs with m₀ in place of m — fewer true nulls, more
 *  power than BH at the same Q. `qPercent` is the FDR threshold Q in percent
 *  (BKY's first stage is the only part that needs it); null P values pass
 *  through unadjusted, and `m` is the count of non-null P values (R's
 *  `p.adjust` drops NAs, so a null P is not a comparison). Pure arithmetic —
 *  no R, no package. Cross-checked against R's p.adjust ("BH", "BY") in
 *  tests/checks.ts. */
export function adjustFdrPValues(
  ps: (number | null)[],
  method: FdrMethod,
  qPercent = 5,
): (number | null)[] {
  // m is the count of non-null P values (R's p.adjust drops NAs).
  const m = ps.filter((p) => p != null).length;
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const out: (number | null)[] = ps.map(() => null);
  if (sorted.length === 0) return out;
  // BY's dependence penalty: the m-th harmonic number.
  const harmonic = method === "by" ? Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0) : 1;
  // BKY stage 1: BH at Q/(1+Q) — how many of the m nulls look false.
  let m0 = m;
  if (method === "bky") {
    const q1 = qPercent / 100 / (1 + qPercent / 100);
    let rejections = 0;
    sorted.forEach(([p], rank) => {
      if (p! <= ((rank + 1) / m) * q1) rejections = rank + 1;
    });
    // All rejected in stage 1: at most one null can still be true.
    m0 = Math.max(m - rejections, 1);
  }
  // Step-up: the adjusted value of the i-th smallest P is the smallest of
  // `factor·m₀·p_(k)/k` over k ≥ i (scanning from the largest down, keeping the
  // running minimum), capped at 1 — so the adjusted values never decrease as
  // the raw P values grow.
  let runningMin = Infinity;
  for (let rank = sorted.length - 1; rank >= 0; rank--) {
    const [p, i] = sorted[rank];
    runningMin = Math.min(runningMin, Math.min(1, (harmonic * m0 * p!) / (rank + 1)));
    out[i] = runningMin;
  }
  return ps.map((p, i) => (p == null ? null : out[i]));
}

/** Adjust a comparisons table's P values by the FDR approach (same rows back,
 *  new P values) — the FDR counterpart of `adjustComparisonRows`. */
export function adjustFdrComparisonRows(
  rows: ComparisonRow[],
  method: FdrMethod,
  qPercent = 5,
): ComparisonRow[] {
  const adjusted = adjustFdrPValues(
    rows.map((r) => r.p),
    method,
    qPercent,
  );
  return rows.map((r, i) => ({ ...r, p: adjusted[i] }));
}

/** The comparisons table: each pair's names, its difference of means and its P value,
 *  and its 95% CI (`lo_i_j`/`hi_i_j`) when the test computed one. */
function buildComparisons(
  groups: Group[],
  pairs: [number, number][],
  diff: (i: number, j: number) => number | null,
  v: Record<string, number | null>,
): ComparisonRow[] {
  return pairs.map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: diff(i, j),
    p: v[`p_${i}_${j}`] ?? null,
    ...(`lo_${i}_${j}` in v ? { low: v[`lo_${i}_${j}`], high: v[`hi_${i}_${j}`] ?? null } : {}),
  }));
}

/** The post-hoc comparisons a test can follow with, as their table is headed. */
const POSTHOC_LABELS: Record<string, string> = {
  tukey: "Tukey's multiple comparisons test",
  bonferroni: "Bonferroni-corrected multiple comparisons",
  sidak: "Šídák-corrected multiple comparisons",
  "holm-sidak": "Holm–Šídák multiple comparisons test",
  fdr: "False Discovery Rate (Benjamini-Hochberg) multiple comparisons",
  lsd: "Fisher's LSD test (uncorrected)",
  fisher: "Fisher's LSD test, uncorrected",
  dunn: "Dunn's multiple comparisons test (Bonferroni-corrected)",
  "dunn-sidak": "Dunn's multiple comparisons test (Šídák-corrected)",
  "dunn-holm-sidak": "Dunn's multiple comparisons test (Holm–Šídák-corrected)",
  "games-howell": "Games-Howell multiple comparisons test",
  t3: "Dunnett's T3 multiple comparisons test",
};

/** The heading of the post-hoc a test's params ask for; none for "none". */
export const posthocOf = (params: { posthoc?: string; control?: string } | undefined) =>
  params?.posthoc === "dunnett"
    ? `Dunnett's multiple comparisons test (vs. ${params.control})`
    : params?.posthoc && Object.hasOwn(POSTHOC_LABELS, params.posthoc)
      ? POSTHOC_LABELS[params.posthoc]
      : undefined;

export interface ColumnTestSpec<P = unknown> {
  testType: AnalysisType;
  /** Minimum number of data columns the test requires. */
  minGroups: number;
  /** Cap on columns used (e.g. 2 for two-sample tests); omit to use all data columns. */
  maxGroups?: number;
  /** The values each group needs (1 by default); `matched`: these params pair the groups
   *  by row, so it is complete rows they need. */
  minValues?: number;
  matched?: (params: P | undefined) => boolean;
  /** An error to show instead of running (e.g. a chosen column is gone). */
  check?: (columns: Column[], params: P | undefined) => string | undefined;
  /** What the groups it runs on lack for this test, said before R runs (values all
   *  identical…), once each holds the values it needs. */
  checkGroups?: (groups: Group[], params: P | undefined) => string | undefined;
  /** How to turn raw columns into groups; defaults to `dataGroups` (independent
   *  per-column filtering). Override for e.g. paired tests that need row alignment. */
  parseGroups?: (columns: Column[], params: P | undefined) => Group[];
  /** R that ends in a `c(name=value, …)` named vector, given the parsed groups (g0, g1, … available). */
  rCode: (groups: Group[], params: P | undefined) => string;
  /** Map the marshalled R values (+ descriptives) into display rows. */
  rows: (v: Record<string, number | null>, groups: GroupDescriptives[], params: P | undefined) => StatRow[];
  /** The difference with its 95% CI the test estimates, for an estimation
   *  plot (see DifferenceResult in ../types): undefined when the test
   *  reports no such difference (a non-parametric test, or a one-tailed
   *  one whose CI is one-sided). */
  difference?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => DifferenceResult | undefined;
  /** The per-data-set normality table (`AnalysisOutcome.normality`), from the
   *  same R values — the wizard's "Not sure — check for normality first"
   *  reads it, and the results view renders it. Without it the wizard
   *  reports the test couldn't run on any data. */
  normality?: (v: Record<string, number | null>, groups: GroupDescriptives[], params: P | undefined) => NormalityRow[];
  /** The ANOVA effect-size table (`AnalysisOutcome.effectSizes`), from the
   *  same R values — one row per effect (seq 161). */
  effectSizes?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => EffectSizeRow[] | undefined;
  /** The post-hoc comparisons that ran, as their table's heading ("Tukey's multiple
   *  comparisons test"); none, no table. Its R gives each pair's P value as `p_i_j`. */
  posthoc?: (params: P | undefined) => string | undefined;
  /** Adjust the comparisons' P values after R returns them (Šídák / Holm–Šídák:
   *  the raw P values cross the boundary, the adjustment runs here in TS). The
   *  rows arrive in the spec's pair order — one family, in pair order. */
  adjustComparisons?: (rows: ComparisonRow[], params: P | undefined) => ComparisonRow[];
  /** The pairs it compares, group1 first (every pair by default: `pairIndices`). */
  pairs?: (groups: Group[], params: P | undefined) => [number, number][];
  /** Its comparisons are ratios of geometric means, R's `r_i_j` (a lognormal test). */
  ratios?: (params: P | undefined) => boolean;
  /** Static notes, or resolved from params (e.g. which t-test variant ran) — also given
   *  the parsed groups and raw columns, for notes that depend on data shape (e.g. how
   *  many rows were dropped for missing data). */
  notes: string | ((params: P | undefined, groups: Group[], columns: Column[]) => string);
  /** Extra notes from the R values (e.g. a caveat only the computed values
   *  can state); appended to `notes` when it returns a non-empty string. */
  valueNotes?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => string | undefined;
  /** Resolved test name shown under the result heading, e.g. "Welch's t test". */
  subtitle?: (params: P | undefined) => string;
  /** Optional human-readable fitted-model equation (regressions), from the R values. */
  equation?: (
    v: Record<string, number | null>,
    groups: GroupDescriptives[],
    params: P | undefined,
  ) => string | undefined;
}

/** Run a column test: parse → validate → evaluate R → assemble the unified result. */
export async function runColumnTest<P>(
  columns: Column[],
  spec: ColumnTestSpec<P>,
  params?: P,
): Promise<AnalysisOutcome> {
  const problem = spec.check?.(columns, params);
  if (problem) return { error: problem };
  const available = (spec.parseGroups ?? dataGroups)(columns, params);
  if (available.length < spec.minGroups) {
    return {
      error: `This test needs at least ${spec.minGroups} column${spec.minGroups > 1 ? "s" : ""} containing numeric data.`,
    };
  }
  // Only the columns the test actually consumes are run and described.
  const groups = spec.maxGroups ? available.slice(0, spec.maxGroups) : available;
  const need = spec.minValues ?? 1;
  const few = groups.find((g) => g.values.length < need);
  if (few) {
    const n = few.values.length;
    return {
      error: spec.matched?.(params)
        ? `This test needs at least ${need} rows holding a value in every group; the table has ${n}.`
        : `“${few.name}” holds ${n} value${n === 1 ? "" : "s"}; this test needs at least ${need} in each group.`,
    };
  }
  const lack = spec.checkGroups?.(groups, params);
  if (lack) return { error: lack };
  const v = await evalNamedVector(spec.rCode(groups, params));
  // A post-hoc that ran gives every pair's P value as `p_i_j` (`pairIndices`).
  const posthoc = spec.posthoc?.(params);
  const pairs = posthoc ? (spec.pairs?.(groups, params) ?? pairIndices(groups.length)) : [];
  const { groups: described, diff } = await describe(groups, pairs);
  const raw = posthoc
    ? buildComparisons(groups, pairs, spec.ratios?.(params) ? (i, j) => v[`r_${i}_${j}`] ?? null : diff, v)
    : undefined;
  const comparisons = raw ? (spec.adjustComparisons?.(raw, params) ?? raw) : undefined;
  const baseNotes = typeof spec.notes === "function" ? spec.notes(params, groups, columns) : spec.notes;
  const extraNotes = spec.valueNotes?.(v, described, params);
  return {
    testType: spec.testType,
    subtitle: spec.subtitle?.(params),
    equation: spec.equation?.(v, described, params),
    stats: spec.rows(v, described, params),
    difference: spec.difference?.(v, described, params),
    effectSizes: spec.effectSizes?.(v, described, params),
    normality: spec.normality?.(v, described, params),
    groups: described,
    notes: extraNotes ? `${baseNotes} ${extraNotes}` : baseNotes,
    comparisons,
    comparisonsLabel: posthoc,
    ...(posthoc && spec.ratios?.(params) ? { comparisonsEffect: "Ratio of geometric means" } : {}),
  };
}

/** A 95% CI as shown: a one-tailed test's is open on one side (R gives ±Inf, which crosses
 *  into JS as null): ∞ there. `zero`: the CI of a ratio, whose lower end is then 0. */
export function ciRows(tails: string, lo: number | null, hi: number | null, prefix = "", zero = false): StatRow[] {
  return [
    { label: `${prefix}95% CI lower`, value: tails === "less" ? (zero ? 0 : -Infinity) : lo },
    { label: `${prefix}95% CI upper`, value: tails === "greater" ? Infinity : hi },
  ];
}

/** Whether the values are all the same: no scatter to test. */
export const identical = (values: number[]) => values.every((v) => v === values[0]);

/** Two results equal as typed: a computer's subtractions err by a few 1e-16 of the values'
 *  scale; 1e-13 of it is far above that, and below the 13th significant digit, beyond any
 *  measurement's. */
const TYPED = 1e-13;
const scaleOf = (values: number[]) => maxOf(values.map(Math.abs));

/** Whether the paired differences `a − b` are all the same (as typed)… */
export function sameDifferences(a: number[], b: number[]): boolean {
  const tolerance = TYPED * scaleOf([...a, ...b]);
  return a.every((x, i) => Math.abs(x - b[i] - (a[0] - b[0])) <= tolerance);
}

/** …and all 0: every pair holds the same value twice. */
export const noDifference = (a: number[], b: number[]) =>
  sameDifferences(a, b) && Math.abs(a[0] - b[0]) <= TYPED * scaleOf([...a, ...b]);

/** Whether matched groups (a subject per row) leave no residual scatter: each value is its
 *  subject's level plus its group's, exactly (as typed). */
export function matchedFit(groups: Group[]): boolean {
  const k = groups.length;
  const n = groups[0].values.length;
  const all = groups.flatMap((g) => g.values);
  const tolerance = TYPED * scaleOf(all);
  const grand = all.reduce((a, v) => a + v, 0) / all.length;
  const col = groups.map((g) => g.values.reduce((a, v) => a + v, 0) / n);
  const row = groups[0].values.map((_, r) => groups.reduce((a, g) => a + g.values[r], 0) / k);
  return groups.every((g, j) => g.values.every((v, r) => Math.abs(v - row[r] - col[j] + grand) <= tolerance));
}

/** The error for groups whose values are all the same, or none. */
export function noScatter(groups: Group[], test: string): string | undefined {
  if (identical(groups.flatMap((g) => g.values)))
    return `All the values are identical: the ${test} has nothing to compare.`;
}

/** One ANOVA effect-size row from its sums of squares (seq 161): eta squared
 *  = SS_effect / SS_total, partial eta squared = SS_effect / (SS_effect +
 *  SS_error), Cohen's f = √(partial / (1 − partial)) (Prism's ANOVA guide).
 *  `lo` / `hi` are the partial eta squared's 95% CI, computed in R
 *  (`etaCI`); pass nulls where a measure doesn't apply. Nulls where the
 *  sums of squares are missing or the design leaves no error term. */
export function effectSizeRow(
  effect: string,
  ssEffect: number | null | undefined,
  ssError: number | null | undefined,
  ssTotal: number | null | undefined,
  lo: number | null | undefined,
  hi: number | null | undefined,
): EffectSizeRow {
  const finite = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
  const eta2 = finite(ssEffect) && finite(ssTotal) && ssTotal > 0 ? ssEffect / ssTotal : null;
  const partial =
    finite(ssEffect) && finite(ssError) && ssEffect + ssError > 0 ? ssEffect / (ssEffect + ssError) : null;
  return {
    effect,
    eta2,
    partialEta2: partial,
    cohensF: partial == null || partial >= 1 ? null : Math.sqrt(partial / (1 - partial)),
    partialEta2Lo: finite(lo) ? lo : null,
    partialEta2Hi: finite(hi) ? hi : null,
  };
}

/** R: Hedges' correction of a Cohen's d with `df` degrees of freedom, exact (none under 2 df). */
export const R_HEDGES = "J<-function(df)if(df<2)NA else exp(lgamma(df/2)-lgamma((df-1)/2))/sqrt(df/2)";

/** R: 95% CIs for effect sizes by noncentrality inversion (the pivot method
 *  of Smithson 2003 / Steiger 2004, as used by R's `effectsize` package).
 *  `tci(t, df)`: the noncentrality parameter's two-sided 95% CI for a t
 *  statistic — the ncp whose CDF at the observed t is 0.975 / 0.025 (pt
 *  falls as ncp rises). `tci1(t, df, side)`: the one-sided 95% bound for a
 *  one-tailed test ("greater" → lower bound only, "less" → upper only).
 *  `fci(F, d1, d2)`: the same for an F statistic (ncp ≥ 0: a bound is 0
 *  when even ncp 0 leaves the CDF on the wrong side of its target).
 *  `xci(x, df)`: the same for a chi-square statistic.
 *  `etaCI(F, d1, d2, N)`: partial eta squared's 95% CI from an F statistic,
 *  λ/(λ + N) with N the total observations — verified against
 *  effectsize::F_to_eta2(15, df = 1, df_error = 60): 90% CI [0.067, 0.336]
 *  vs the package's published [0.07, 0.34]. NA on failure, never an error. */
export const R_EFFECT_CI = `
tci<-function(t,df){if(!is.finite(t))return(c(NA,NA));c(tryCatch(uniroot(function(n)pt(t,df,n)-0.975,c(-200,200),tol=1e-8)$root,error=function(e)NA),tryCatch(uniroot(function(n)pt(t,df,n)-0.025,c(-200,200),tol=1e-8)$root,error=function(e)NA))}
tci1<-function(t,df,side){if(!is.finite(t))return(c(NA,NA));if(side=="greater")c(tryCatch(uniroot(function(n)pt(t,df,n)-0.95,c(-200,200),tol=1e-8)$root,error=function(e)NA),NA)else c(NA,tryCatch(uniroot(function(n)pt(t,df,n)-0.05,c(-200,200),tol=1e-8)$root,error=function(e)NA))}
fci<-function(F,d1,d2){if(!is.finite(F))return(c(NA,NA));g<-function(n,p)pf(F,d1,d2,n)-p;hi<-if(g(0,0.025)<0)0 else{b<-10;while(g(b,0.025)>0)b<-b*2;tryCatch(uniroot(function(n)g(n,0.025),c(0,b),tol=1e-8)$root,error=function(e)NA)};lo<-if(g(0,0.975)<0)0 else{b<-10;while(g(b,0.975)>0)b<-b*2;tryCatch(uniroot(function(n)g(n,0.975),c(0,b),tol=1e-8)$root,error=function(e)NA)};c(lo,hi)}
xci<-function(x,df){if(!is.finite(x))return(c(NA,NA));g<-function(n,p)pchisq(x,df,n)-p;hi<-if(g(0,0.025)<0)0 else{b<-10;while(g(b,0.025)>0)b<-b*2;tryCatch(uniroot(function(n)g(n,0.025),c(0,b),tol=1e-8)$root,error=function(e)NA)};lo<-if(g(0,0.975)<0)0 else{b<-10;while(g(b,0.975)>0)b<-b*2;tryCatch(uniroot(function(n)g(n,0.975),c(0,b),tol=1e-8)$root,error=function(e)NA)};c(lo,hi)}
etaCI<-function(F,d1,d2,N){e<-fci(F,d1,d2);e/(e+N)}`;

/** R: `rci(ct, n)`, r's 95% CI: Pearson's from cor.test (Fisher's z),
 *  Spearman's on Fisher's z with Fieller, Hartley and Pearson's variance,
 *  1.06 / (n − 3) (1957); none under 4 pairs, nor for a perfect r (±1),
 *  where Fisher's z is infinite. */
export const R_RCI =
  "rci<-function(ct,n){r<-unname(ct$estimate);if(abs(r)>=1)return(c(NA,NA));if(!is.null(ct$conf.int))return(as.vector(ct$conf.int));if(n<4)return(c(NA,NA));tanh(atanh(r)+c(-1,1)*qnorm(0.975)*sqrt(1.06/(n-3)))}";
