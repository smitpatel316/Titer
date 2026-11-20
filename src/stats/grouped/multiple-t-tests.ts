// Multiple t tests (Prism-style): a t test (or Wilcoxon/Mann-Whitney) at every
// row position between a Grouped table's exactly-2 column-groups, corrected for
// multiplicity across rows. Reuses the comparisons table (group1 = row label,
// group2 left blank — the fixed group pair is stated once in comparisonsLabel).
// `paired` pairs replicate columns by position between the 2 groups (needs
// column-identity alignment, unlike the independent per-row filtering `groupRows`
// does for the unpaired case). `pooledSd` (parametric only) assumes one shared SD
// across every row (pooled residual variance, like a single-error-term ANOVA)
// instead of each row estimating its own. R computes each row's raw P value;
// the multiplicity correction across rows is TypeScript (`adjustMultipleTTestPValues`,
// pure — the step-down / two-stage methods need the whole family sorted, and
// R's `p.adjust` has no Holm–Šídák or BKY method).
import type { AnalysisOutcome, Column, ComparedCell, MultipleTTestsParams } from "../types";
import { MULTIPLE_T_TEST_CORRECTIONS } from "../types";
import { adjustPValues, describe, rBool, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { groupRows, pairedGroupRows, rowName } from "./base";

type MultipleTTestCorrection = (typeof MULTIPLE_T_TEST_CORRECTIONS)[number];

/** The FDR corrections — their significance threshold is Q, not 0.05. */
export const isFdrCorrection = (correction: MultipleTTestCorrection): boolean =>
  correction === "fdr" || correction === "fdr-bky" || correction === "fdr-by";

/** The desired false discovery rate (percent) actually used: FDR methods
 *  only; anything outside 0.01–50 (ROUT's Q range, shared by the wizard
 *  question) falls back to Prism's 5%. */
export const fdrQ = (q: number | undefined): number =>
  typeof q === "number" && q >= 0.01 && q <= 50 ? q : 5;

/** The P threshold a corrected value must clear to count as significant:
 *  Q for the FDR methods, 0.05 for the family-wise methods and none. */
export const significanceThreshold = (correction: MultipleTTestCorrection, q: number | undefined): number =>
  isFdrCorrection(correction) ? fdrQ(q) / 100 : 0.05;

const CORRECTION_LABEL: Record<MultipleTTestCorrection, string> = {
  "holm-sidak": "Holm–Šídák-corrected",
  holm: "Holm-corrected",
  sidak: "Šídák-corrected",
  bonferroni: "Bonferroni-corrected",
  fdr: "FDR-corrected (Benjamini-Hochberg)",
  "fdr-bky": "FDR-corrected (Benjamini-Krieger-Yekutieli two-stage)",
  "fdr-by": "FDR-corrected (Benjamini-Yekutieli)",
  none: "uncorrected",
};

/** Wizard defaults (first/recommended choices): unpaired, Gaussian, no
 *  pooled SD, Holm–Šídák correction (Prism's recommended method), Q = 5%. */
const DEFAULTS: MultipleTTestsParams = {
  paired: false,
  gaussian: true,
  pooledSd: false,
  correction: "holm-sidak",
  q: 5,
};

/** Adjust a family's raw P values for multiplicity. `m` is the family size
 *  — every tested row, null P values included (a constant row has no P but
 *  still counts as a comparison, as R's `p.adjust` counts it). Nulls pass
 *  through unadjusted; the non-null values are adjusted over the full m.
 *  Pure arithmetic — no R, so the checks pin it against `p.adjust` directly.
 *
 *  - holm-sidak / sidak: the shared step-down / single-step Šídák
 *    (`adjustPValues`); bonferroni: `min(1, m·p)`; holm: step-down
 *    `max over j ≤ i of (m−j+1)·p_(j)`; fdr (BH): `min over k ≥ i of
 *    p_(k)·m/k`; fdr-by: BH times the harmonic number H_m.
 *  - fdr-bky (Benjamini–Krieger–Yekutieli two-stage, at FDR level α = Q/100):
 *    stage 1 runs BH at α/(1+α) and counts its rejections r1; stage 2 runs
 *    BH at α·m/(m−r1). As adjusted P values: r1 = 0 rejects nothing, so the
 *    BH values are scaled up by (1+α) (nothing can clear α); 0 < r1 < m
 *    scales them by (m−r1)/m — flagging by adjusted P ≤ α is then exactly
 *    the stage-2 rejection; r1 = m rejects everything, so the BH values
 *    stand (all already clear α). */
export function adjustMultipleTTestPValues(
  ps: (number | null)[],
  correction: MultipleTTestCorrection,
  q?: number,
): (number | null)[] {
  const m = ps.length;
  if (correction === "none") return [...ps];
  if (correction === "holm-sidak" || correction === "sidak") {
    return adjustPValues(ps, correction);
  }
  if (correction === "bonferroni") {
    return ps.map((p) => (p == null ? null : Math.min(1, m * p)));
  }
  const indexed = ps.map((p, i) => [p, i] as const).filter(([p]) => p != null);
  const sorted = [...indexed].sort((a, b) => a[0]! - b[0]!);
  const adjusted = new Map<number, number>();
  if (correction === "holm") {
    // Step-down: the i-th smallest P (i = 1…m) takes the max over j ≤ i.
    let runningMax = 0;
    sorted.forEach(([p, i], rank) => {
      runningMax = Math.max(runningMax, Math.min(1, (m - rank) * p!));
      adjusted.set(i, runningMax);
    });
  } else {
    // BH first (fdr, fdr-bky, fdr-by all start here): the i-th smallest P
    // takes the min over k ≥ i of p_(k)·m/k — walk down from the largest.
    const bh = new Map<number, number>();
    let runningMin = 1;
    for (let rank = sorted.length - 1; rank >= 0; rank--) {
      const [p, i] = sorted[rank];
      runningMin = Math.min(runningMin, Math.min(1, (p! * m) / (rank + 1)));
      bh.set(i, runningMin);
    }
    if (correction === "fdr") {
      for (const [i, v] of bh) adjusted.set(i, v);
    } else if (correction === "fdr-by") {
      const harmonic = Array.from({ length: m }, (_, i) => 1 / (i + 1)).reduce((a, b) => a + b, 0);
      for (const [i, v] of bh) adjusted.set(i, Math.min(1, v * harmonic));
    } else {
      const alpha = fdrQ(q) / 100;
      const r1 = [...bh.values()].filter((v) => v <= alpha / (1 + alpha)).length;
      const factor = r1 === 0 ? 1 + alpha : r1 === m ? 1 : (m - r1) / m;
      for (const [i, v] of bh) adjusted.set(i, Math.min(1, v * factor));
    }
  }
  return ps.map((p, i) => (p == null ? null : adjusted.get(i) ?? null));
}

export async function runMultipleTTests(
  columns: Column[],
  params: MultipleTTestsParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  // A partial params object still runs with the missing fields defaulted
  // (BUG-REPORT #26): without this, `{}` sent `p.adjust(pr,"undefined")`
  // to R and the whole analysis failed.
  params = { ...DEFAULTS, ...params };
  if (!MULTIPLE_T_TEST_CORRECTIONS.includes(params.correction)) {
    return { error: `Unknown multiple-t-tests correction "${params.correction}".` };
  }
  let name1: string;
  let name2: string;
  let rowsA: number[][];
  let rowsB: number[][];
  if (params.paired) {
    const paired = pairedGroupRows(columns);
    if (!paired) return { error: "Multiple t tests need exactly 2 column groups." };
    ({ name1, name2, rowsA, rowsB } = paired);
  } else {
    const rows = groupRows(columns);
    if (rows.size !== 2) return { error: "Multiple t tests need exactly 2 column groups." };
    [[name1, rowsA], [name2, rowsB]] = [...rows];
  }
  const testable = Array.from({ length: Math.min(rowsA.length, rowsB.length) }, (_, r) => r).filter(
    (r) => rowsA[r].length > 1 && rowsB[r].length > 1,
  );
  // The rows the ≥2-replicates rule excluded, named in the notes — the
  // "Rows compared" count alone never said which rows never got a test.
  const droppedRows = Array.from({ length: Math.min(rowsA.length, rowsB.length) }, (_, r) => r).filter(
    (r) => !testable.includes(r),
  );
  if (testable.length === 0) {
    return { error: `Each row needs at least 2 ${params.paired ? "paired " : ""}replicate values in both groups.` };
  }

  // Each row's test and its difference of means in R; the raw P values come
  // back and the correction across rows is TypeScript (see above). Pooled:
  // one SD across every row (a single error term), each row's t on it.
  const a = (r: number) => rVec(rowsA[r]);
  const b = (r: number) => rVec(rowsB[r]);
  const test = (r: number) =>
    params.gaussian
      ? // A row constant in both groups (say [5,5,5] vs [5,5,5]) makes t.test
        // error "data are essentially constant" and abort the whole multi-row
        // analysis: that row's P is open instead, the other rows complete.
        `tryCatch(t.test(${a(r)},${b(r)},paired=${rBool(params.paired)})$p.value,error=function(e) NA_real_)`
      : // wilcox.test warns of ties: the warning is the call's, so it wraps the call.
        `suppressWarnings(wilcox.test(${a(r)},${b(r)},paired=${rBool(params.paired)}))$p.value`;
  const pooled = params.gaussian && params.pooledSd;
  const rowsR = `A<-list(${testable.map(a).join(",")});B<-list(${testable.map(b).join(",")})`;
  const raw = pooled
    ? `${rowsR};D<-if(${rBool(params.paired)})mapply(function(x,y)x-y,A,B,SIMPLIFY=FALSE) else NULL
ss<-if(is.null(D))sum(mapply(function(x,y)sum((x-mean(x))^2)+sum((y-mean(y))^2),A,B)) else sum(sapply(D,function(d)sum((d-mean(d))^2)))
dfp<-if(is.null(D))sum(lengths(A)+lengths(B)-2) else sum(lengths(D)-1)
se2<-if(is.null(D))1/lengths(A)+1/lengths(B) else 1/lengths(D)
pr<-2*pt(-abs(mapply(function(x,y)mean(x)-mean(y),A,B)/sqrt(ss/dfp*se2)),dfp)`
    : `pr<-c(${testable.map(test).join(",")})`;
  const v = await evalNamedVector(
    `${raw}\n` +
      `c(${testable.map((r, i) => `p_${i}=pr[${i + 1}],d_${i}=mean(${a(r)})-mean(${b(r)})`).join(",")})`,
  );
  if (pooled && v.p_0 == null && testable.length) {
    return { error: "Not enough replicate values to pool a shared SD across rows." };
  }

  const rawP = testable.map((_, i) => v[`p_${i}`] ?? null);
  const adjustedP = adjustMultipleTTestPValues(rawP, params.correction, params.q);
  const threshold = significanceThreshold(params.correction, params.q);
  const significant = adjustedP.map((p) => p != null && p < threshold);
  const comparisons = testable.map((r, i) => ({
    group1: rowName(titles, r),
    group2: "",
    cells: [
      { group: name1, row: r },
      { group: name2, row: r },
    ] as [ComparedCell, ComparedCell],
    diff: v[`d_${i}`] ?? null,
    p: adjustedP[i],
    significant: significant[i],
  }));
  const testLabel = params.gaussian
    ? params.paired
      ? `Paired t test${params.pooledSd ? " (pooled SD across rows)" : ""}`
      : params.pooledSd
        ? "Unpaired t test (pooled SD across rows)"
        : "Welch's t test (no equal-SD assumption)"
    : `${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} test`;
  const correctionLabel =
    CORRECTION_LABEL[params.correction] +
    (isFdrCorrection(params.correction) ? `, Q = ${fdrQ(params.q)}%` : "");
  // One unified untested note: rows left out for too few replicates, and rows
  // whose test returned no p-value (no variation to test — a t test needs it).
  const noPValueRows = params.gaussian && !pooled ? testable.filter((_, i) => comparisons[i].p == null) : [];
  const untestedRows = [...droppedRows, ...noPValueRows];
  return {
    testType: "multiple-t-tests",
    subtitle: params.gaussian
      ? "Multiple t tests"
      : `Multiple ${params.paired ? "Wilcoxon signed-rank" : "Mann-Whitney"} tests`,
    stats: [
      { label: "Rows compared", value: testable.length },
      {
        label: isFdrCorrection(params.correction)
          ? `Significant rows (adjusted P < ${fdrQ(params.q)}%)`
          : "Significant rows (P < 0.05)",
        value: significant.filter(Boolean).length,
      },
    ],
    groups: (
      await describe([
        { name: name1, values: rowsA.flat() },
        { name: name2, values: rowsB.flat() },
      ])
    ).groups,
    notes: `${testLabel} at each row, ${correctionLabel} across rows.` +
      (untestedRows.length
        ? ` Not tested: ${untestedRows.map((r) => `“${rowName(titles, r)}”`).join(", ")} (fewer than 2 values in a group, or values that don't vary).`
        : ""),
    comparisons,
    comparisonsLabel: `Per-row comparisons (${name1} vs. ${name2})`,
  };
}
