// Deming (Model II) regression of a chosen Y data series on X, for an XY table.
// Unlike OLS, it allows measurement error in both X and Y: the user supplies the
// error-variance ratio λ = σ²ε/σ²δ — variance of the Y errors over variance of
// the X errors (1 = equal error in both). Closed form, base R only — no package
// (deming/MethComp are not in webR; see the plan-13 note in tests/reference.ts)
// — with leave-one-out jackknife 95% confidence intervals and the OLS fit
// alongside, so the attenuation OLS would give is visible.
//
// λ's direction, verified 2026-11-10 against both canonical packages on the
// reference data: deming::deming(y~x, xstd=1, ystd=0.5) and MethComp::Deming
// (sdr=0.5) both give slope 0.9813 — the closed form at λ = (ystd/xstd)² =
// 0.25. So λ is the Y-error variance over the X-error variance: λ → 0 is the
// Y-error-free (inverse-regression) limit, λ → ∞ is the X-error-free (OLS)
// limit, and the slope decreases monotonically in λ between them. (The plan's
// prose had this backwards — "λ = error in X ÷ error in Y", "λ → 0 approaches
// OLS", "slope(λ=0.25) between slope(λ=1) and OLS" — all three are inverted
// against the formula, its frozen values, and both packages; the formula and
// the words here follow the packages.)
import type { Column, DemingRegressionParams } from "../types";
import { rVec, type ColumnTestSpec, type Group } from "../column/base";
import { splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { num } from "../../lib/format";
import { mean } from "../../lib/summary";

const DEFAULTS: DemingRegressionParams = { lambda: 1 };

/** X and the chosen Y series (the first by default), on the rows where both have a value. */
function pickXY(columns: Column[], params: DemingRegressionParams | undefined): Group[] {
  const { x, ys } = splitXY(columns);
  const y = params?.y === undefined ? ys[0] : ys.find((c) => c.name === params.y);
  if (!x || !y) return [];
  const pairs = xyPoints(x, y);
  return [
    { name: x.name, values: pairs.x },
    { name: y.name, values: pairs.y },
  ];
}

/** Why Deming regression can't run on these columns, if it can't: λ must be
 *  positive, the pairs must exist and number at least 3 (the jackknife needs
 *  them), and X and Y must both vary and covary — otherwise the closed form
 *  has no defined slope. */
function demingProblem(columns: Column[], params: DemingRegressionParams | undefined): string | undefined {
  const lambda = (params ?? DEFAULTS).lambda;
  if (!Number.isFinite(lambda) || lambda <= 0)
    return "The error variance ratio must be a finite number greater than 0.";
  const base = xyProblem(columns, params?.y);
  if (base) return base;
  const groups = pickXY(columns, params);
  if (groups.length < 2) return undefined;
  const xs = groups[0].values;
  const ys = groups[1].values;
  const n = xs.length;
  if (n < 3)
    return `Deming regression needs at least 3 complete pairs for the jackknife confidence intervals; this table has ${n}.`;
  const xbar = mean(xs);
  const ybar = mean(ys);
  const sxx = xs.reduce((s, xi) => s + (xi - xbar) ** 2, 0);
  const syy = ys.reduce((s, yi) => s + (yi - ybar) ** 2, 0);
  const sxy = xs.reduce((s, xi, i) => s + (xi - xbar) * (ys[i] - ybar), 0);
  if (sxx === 0) return `“${groups[0].name}” is constant — Deming regression needs X values that vary.`;
  if (syy === 0) return `“${groups[1].name}” is constant — Deming regression needs Y values that vary.`;
  if (sxy === 0) return "X and Y do not covary — Deming regression has no defined slope here";
  return undefined;
}

/** The OLS slope/intercept of the paired values, for the notes' comparison —
 *  computed here in TS (the same arithmetic the R call runs) because `notes`
 *  doesn't receive the R values. */
function olsFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  if (xs.length < 2) return null;
  const xbar = mean(xs);
  const ybar = mean(ys);
  const sxx = xs.reduce((s, xi) => s + (xi - xbar) ** 2, 0);
  if (sxx === 0) return null;
  const slope = xs.reduce((s, xi, i) => s + (xi - xbar) * (ys[i] - ybar), 0) / sxx;
  return { slope, intercept: ybar - slope * xbar };
}

export const demingRegressionSpec: ColumnTestSpec<DemingRegressionParams> = {
  testType: "deming-regression",
  minGroups: 2,
  check: demingProblem,
  parseGroups: pickXY,
  // Centered twice (Nov 2026 precision lane): the closed form already runs
  // on centered sums, but a single mean subtraction leaves the mean's
  // rounding error δ (~5e-4 at 1e13) in every deviation, and
  // sxx = Σ(x − x̄)² picks up n·δ² — the slope comes out ~7e-8 off and the
  // intercept (ȳ − b·x̄) amplifies the slope error by x̄ ~ 1e13 to ~3e-5
  // relative. Re-centering the O(1) deviations kills δ to ~1e-16: the
  // second mean is computed at O(1) scale, where it is exact to ~1e-16,
  // and the intercept's remaining error is then x̄·δb ~ 0.02 absolute on
  // ~4e10. The jackknife refits center the same way per subset; the OLS
  // comparison is the centered lm of the linear-regression lane (its QR
  // re-centers internally, so one centering suffices there) with the
  // intercept taken back to X = 0 — the uncentered lm(y~x) returns an NA
  // slope at 1e13 and an intercept of just mean(y).
  rCode: (groups, params) => {
    const lambda = (params ?? DEFAULTS).lambda;
    return (
      `x<-${rVec(groups[0].values)};y<-${rVec(groups[1].values)};lam<-${lambda};n<-length(x);` +
      `xb<-mean(x);yb<-mean(y);xc<-x-xb;yc<-y-yb;xc<-xc-mean(xc);yc<-yc-mean(yc);sxx<-sum(xc^2);syy<-sum(yc^2);sxy<-sum(xc*yc);` +
      `d<-syy-lam*sxx;b<-(d+sqrt(d^2+4*lam*sxy^2))/(2*sxy);a<-yb-b*xb;` +
      // Leave-one-out jackknife: refit on each n−1 subset, SE = √((k−1)/k·Σ(θᵢ − θ̄)²)
      // (Efron's jackknife SE) over the k usable replicates. A subset whose X and Y do not covary
      // (sxy2 = 0) has no defined Deming slope, so it contributes no replicate
      // instead of a NaN one; looDropped counts the skipped subsets.
      `th<-sapply(1:n,function(i){xx<-x[-i];yy<-y[-i];xbm<-mean(xx);ybm<-mean(yy);xcc<-xx-xbm;ycc<-yy-ybm;xcc<-xcc-mean(xcc);ycc<-ycc-mean(ycc);sx<-sum(xcc^2);sy<-sum(ycc^2);sxy2<-sum(xcc*ycc);dd<-sy-lam*sx;bb<-if(is.na(sxy2)||sxy2==0)NA else (dd+sqrt(dd^2+4*lam*sxy2^2))/(2*sxy2);if(is.na(bb)||!is.finite(bb))bb<-NA;c(bb,ybm-bb*xbm)});` +
      `k<-sum(!is.na(th[1,]));seb<-if(k<2)NA else sqrt((k-1)/k*sum((th[1,]-mean(th[1,],na.rm=TRUE))^2,na.rm=TRUE));sea<-if(k<2)NA else sqrt((k-1)/k*sum((th[2,]-mean(th[2,],na.rm=TRUE))^2,na.rm=TRUE));` +
      `m<-lm(I(y-yb)~I(x-xb));co<-coef(m);olsB<-unname(co[2]);olsA<-unname(co[1]+yb-olsB*xb);` +
      `c(slope=b,intercept=a,slopeSe=seb,interceptSe=sea,` +
      `slopeCiLo=b-1.96*seb,slopeCiHi=b+1.96*seb,interceptCiLo=a-1.96*sea,interceptCiHi=a+1.96*sea,` +
      `lambda=lam,olsSlope=olsB,olsIntercept=olsA,n=n,looDropped=n-k)`
    );
  },
  rows: (v, _groups, _params) => [
    { label: "Slope", value: v.slope },
    { label: "Slope 95% CI lower", value: v.slopeCiLo },
    { label: "Slope 95% CI upper", value: v.slopeCiHi },
    { label: "Y-intercept", value: v.intercept },
    { label: "Intercept 95% CI lower", value: v.interceptCiLo },
    { label: "Intercept 95% CI upper", value: v.interceptCiHi },
    { label: "Lambda", value: v.lambda },
    { label: "OLS slope", value: v.olsSlope },
    { label: "OLS Y-intercept", value: v.olsIntercept },
    { label: "Complete pairs", value: v.n },
  ],
  notes: (params, groups) => {
    const lambda = (params ?? DEFAULTS).lambda;
    const xName = groups[0]?.name ?? "X";
    const yName = groups[1]?.name ?? "Y";
    const lambdaText =
      lambda === 1
        ? "λ = 1 (equal error in X and Y)"
        : `λ = ${num(lambda)} (the error variance in Y is ${num(lambda)}× that in X)`;
    const ols = olsFit(groups[0]?.values ?? [], groups[1]?.values ?? []);
    const olsText =
      ols == null
        ? ""
        : ` The ordinary least-squares fit is Y = ${num(ols.slope)}*X ${ols.intercept < 0 ? "−" : "+"} ${num(Math.abs(ols.intercept))}, for comparison — OLS assumes X is measured without error, so it attenuates the slope.`;
    return (
      `Deming regression of “${yName}” on “${xName}”, ${lambdaText}. ` +
      `95% confidence intervals are leave-one-out jackknife intervals.${olsText} ` +
      "If the slope CI excludes 1 there is proportional bias; if the intercept CI excludes 0 there is constant bias. " +
      "Assumes the errors in X and Y are independent and roughly homoscedastic."
    );
  },
  valueNotes: (v) => {
    const dropped = v.looDropped;
    if (dropped == null || dropped === 0) return undefined;
    const kept = (v.n ?? 0) - dropped;
    const plural = dropped === 1 ? "replicate" : "replicates";
    const skipped =
      `${dropped} of the ${v.n} leave-one-out jackknife ${plural} had no covariation ` +
      `(removing that point left X and Y uncorrelated) and ${dropped === 1 ? "was" : "were"} skipped; `;
    if (v.slopeSe == null)
      return (
        skipped +
        `with only ${kept} usable ${kept === 1 ? "replicate" : "replicates"} no jackknife confidence interval could be computed.`
      );
    return skipped + `the confidence intervals use the remaining ${kept} replicates.`;
  },
  subtitle: () => "Deming regression",
  equation: (v, _groups, _params) => {
    if (v.slope == null) return undefined;
    const term = `${num(v.slope)}*X`;
    const b = v.intercept;
    if (b == null || b === 0) return `Y = ${term}`;
    return `Y = ${term} ${b < 0 ? "−" : "+"} ${num(Math.abs(b))}`;
  },
};
