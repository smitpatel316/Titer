// Compare the slopes and intercepts of several fitted lines (#46): Prism's
// "Test whether the slopes and intercepts are significantly different"
// (linear regression, "Are lines different?"). Two extra sum-of-squares F
// tests, equivalent to an ANCOVA (Zar, Biostatistical Analysis, ch. 18):
//   1. slopes — separate slopes + intercepts (full model) against one shared
//      slope with separate intercepts; H0: the slopes are all identical
//      (the lines are parallel).
//   2. lines identical — the shared-slope model against one line for all
//      data sets; H0: the lines are identical. Prism only interprets this
//      one when the slopes do not differ significantly: differing slopes
//      make the intercepts incomparable, so the conclusion says so.
// The comparison pools one residual variance across the data sets (it is
// OLS, unweighted — no weighting is offered), and it is not available
// forced through the origin (Prism disables the option then).
import type { AnalysisOutcome, Column, CompareSlopesParams, FitRow, StatRow } from "../types";
import { describe, pRow, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { num } from "../../lib/format";
import { lineProblem } from "./linear-regression";

const DEFAULTS: CompareSlopesParams = {};

/** The Y data sets to compare: the named ones, or every Y data set. */
function setsOf(columns: Column[], params: CompareSlopesParams | undefined): { sets: string[]; error?: string } {
  const { x, ys } = splitXY(columns);
  if (!x) return { sets: [], error: xyProblem(columns) };
  const names = params?.ys ?? ys.map((s) => s.name);
  const missing = names.find((n) => !ys.some((s) => s.name === n));
  if (missing !== undefined) return { sets: [], error: `“${missing}” is not one of this table's Y data sets.` };
  return { sets: names };
}

/** Compare the lines of `params.ys` (or every Y data set) on shared X. */
export async function runCompareSlopes(
  columns: Column[],
  params: CompareSlopesParams | undefined,
): Promise<AnalysisOutcome> {
  const { sets, error } = setsOf(columns, params ?? DEFAULTS);
  if (error) return { error };
  if (sets.length < 2)
    return {
      error:
        "Comparing slopes and intercepts needs at least two Y data sets on one XY table — this table has " +
        (sets.length === 0 ? "none to compare." : `only “${sets[0]}”.`),
    };
  const { x, ys } = splitXY(columns);
  const groups = sets.map((name) => ys.find((s) => s.name === name)!);
  const points = groups.map((g) => xyPoints(x!, g));
  for (const [i, p] of points.entries()) {
    const problem = lineProblem({ name: x!.name, values: p.x }, { name: sets[i], values: p.y }, false);
    if (problem) return { error: problem };
  }
  const k = sets.length;
  const n = points.map((p) => p.x.length);
  // One R call: each set's own line (slope, intercept, CIs, R², slope P),
  // then the three stacked fits — separate lines, shared slope, one line —
  // and the two F tests between them. F is clamped at 0: two RSS values
  // that agree to float precision can differ by a hair either way, and a
  // negative F has no P value (pf of it is not a probability).
  const perSet = points
    .map(
      (p, i) =>
        `x${i}<-${rVec(p.x)};y${i}<-${rVec(p.y)};m<-lm(y${i}~x${i});s<-summary(m);ci<-confint(m);` +
        `v${i}<-c(slope=unname(coef(m)[2]),slo=ci[2,1],shi=ci[2,2],` +
        `b=unname(coef(m)[1]),blo=ci[1,1],bhi=ci[1,2],` +
        `r=cor(x${i},y${i}),r2=s$r.squared,p=s$coefficients[2,4],n=length(y${i}))`,
    )
    .join(";");
  const stacked =
    `x<-c(${points.map((_, i) => `x${i}`).join(",")});y<-c(${points.map((_, i) => `y${i}`).join(",")});` +
    `g<-factor(c(${n.map((ni, i) => `rep(${i + 1},${ni})`).join(",")}));` +
    `mf<-lm(y~g*x);ssF<-sum(residuals(mf)^2);dfF<-df.residual(mf);` +
    `ms<-lm(y~g+x);ssS<-sum(residuals(ms)^2);dfS<-df.residual(ms);` +
    `mi<-lm(y~x);ssI<-sum(residuals(mi)^2);` +
    `cs<-confint(ms);bP<-unname(coef(ms)[["x"]]);bPlo<-unname(cs["x",1]);bPhi<-unname(cs["x",2]);` +
    `Fs<-max(0,((ssS-ssF)/${k - 1})/(ssF/dfF));ps<-pf(Fs,${k - 1},dfF,lower.tail=FALSE);` +
    `Fi<-max(0,((ssI-ssS)/${k - 1})/(ssS/dfS));pi<-pf(Fi,${k - 1},dfS,lower.tail=FALSE);`;
  const v = await evalNamedVector(
    `${perSet};${stacked}c(${points.map((_, i) => `setNames(v${i},paste0(names(v${i}),"_${i}"))`).join(",")},` +
      `Fs=Fs,ps=ps,Fi=Fi,pi=pi,bP=bP,bPlo=bPlo,bPhi=bPhi,dfF=dfF,dfS=dfS)`,
  );
  const of = (key: string) => sets.map((_, i) => v[`${key}_${i}`] ?? null);
  const range = (lo: string, hi: string) =>
    sets.map((_, i): [number | null, number | null] => [v[`${lo}_${i}`] ?? null, v[`${hi}_${i}`] ?? null]);
  const slopes = of("slope");
  const intercepts = of("b");
  const pSlopes = v.ps ?? null;
  const pIdentical = v.pi ?? null;
  const slopesDiffer = pSlopes != null && pSlopes < 0.05;
  // Two lines cross where they are equal; Prism reports the crossing only
  // when the slopes differ (with equal slopes there is no crossing, or no
  // meaningful one — parallel lines never meet).
  const intersection =
    k === 2 && slopesDiffer && slopes[0] != null && slopes[1] != null && slopes[0] !== slopes[1]
      ? (intercepts[1]! - intercepts[0]!) / (slopes[0]! - slopes[1]!)
      : null;
  const stats: StatRow[] = [
    { label: "F (slopes differ)", value: v.Fs ?? null },
    { label: "DFn (slopes)", value: k - 1 },
    { label: "DFd (slopes)", value: v.dfF ?? null },
    pRow("P value (slopes differ)", pSlopes),
    { label: "F (lines identical)", value: v.Fi ?? null },
    { label: "DFn (lines identical)", value: k - 1 },
    { label: "DFd (lines identical)", value: v.dfS ?? null },
    pRow("P value (lines identical)", pIdentical),
    { label: "Common slope", value: v.bP ?? null },
    { label: "Common slope 95% CI lower", value: v.bPlo ?? null },
    { label: "Common slope 95% CI upper", value: v.bPhi ?? null },
    ...(intersection != null ? [{ label: "Intersection point (X)", value: intersection }] : []),
  ];
  const rows: FitRow[] = [
    { label: "Slope", values: slopes },
    { label: "95% CI", ranges: range("slo", "shi") },
    { label: "Y-intercept", values: intercepts },
    { label: "95% CI", ranges: range("blo", "bhi") },
    { label: "Pearson r", values: of("r") },
    { label: "R squared", values: of("r2") },
    { label: "P value (slope ≠ 0)", values: of("p"), p: true },
    { label: "N", values: of("n") },
  ];
  const names = sets.map((s) => `“${s}”`).join(", ");
  return {
    testType: "compare-slopes",
    subtitle: "Compare slopes and intercepts",
    stats,
    fit: { sets, rows },
    groups: (await describe([x!, ...groups.map((s) => ({ name: s.name, values: s.columns.flatMap((c) => c.values) }))]))
      .groups,
    notes:
      `Extra sum-of-squares F tests comparing the lines of ${names} on “${x!.name}” ` +
      `(equivalent to an ANCOVA): first whether the slopes differ, then — with one slope shared — whether the lines are identical. ` +
      (slopesDiffer
        ? `The slopes differ significantly (P = ${num(pSlopes)}), so the lines are not parallel and their intercepts are not compared.`
        : `The slopes do not differ significantly (P = ${num(pSlopes)}), so one slope fits all the lines (the common slope above).`) +
      ` Assumes a straight-line relationship in every data set and the same residual scatter in all of them (one residual variance is pooled).`,
  };
}
