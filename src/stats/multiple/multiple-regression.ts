// Multiple linear regression on a Multiple Variables table: one chosen dependent
// variable regressed on every other data-bearing variable, fit on complete cases.
// Bespoke runner (not ColumnTestSpec) — needs a chosen response + a coefficients table.
import type {
  AnalysisOutcome,
  AnovaRow,
  Column,
  CovarianceMatrix,
  MultipleRegressionParams,
  MultipleRegressionResidualRow,
  RegressionCoefficient,
  ResidualDiagnostics,
  VifRow,
} from "../types";
import { dagostinoPearson } from "../column/shapiro-wilk";
import { describe, pRow, rVec } from "../column/base";
import {
  categoricalPredictorsNote,
  droppedNoCompleteNote,
  droppedPredictorsNote,
  selectPredictors,
  aliasedPredictorsError,
} from "./predictors";
import { sd } from "../../lib/summary";
import { evalNamedVector } from "../webr";

export async function runMultipleRegression(
  columns: Column[],
  params: MultipleRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const sel = selectPredictors(columns, params);
  if (sel.error) return { error: sel.error };
  const { dep, predictors, design, dropped } = sel;
  if (!dep || design.length < 1) {
    return { error: "Multiple regression needs a dependent variable and at least one other variable with data." };
  }

  // Complete cases: the rows where every variable used has a value — a
  // text predictor's rows are its non-blank cells, so the design carries the
  // aligned values (selectPredictors) instead of pairedGroups, which drops
  // text columns outright.
  const aligned = [sel.depValues, ...design.map((d) => d.values)];
  const n = aligned[0].length;
  const p = design.length;
  if (n <= p + 1) {
    return { error: `Not enough complete rows (${n}) to fit ${p} predictor(s). Enter more data and try again.` };
  }

  // A constant dependent has no variation to explain: R fits it (intercept
  // only, slopes 0) but summary() returns NULL R² / adjusted R² / F / P, so
  // the fit presents as a row of nulls with no message (#150). Checked on
  // the complete-case values, like the R3-23 predictor check.
  if (sd(aligned[0]) === 0) {
    return {
      error:
        `“${dep.name}” is constant — Multiple linear regression cannot fit a model when the dependent ` +
        `variable has no variation. Enter values that vary and try again.`,
    };
  }

  // Each coefficient row t (0 = intercept) pulled from summary()'s coefficient
  // matrix by explicit index → keyed names, so extraction never depends on order.
  // A constant or collinear predictor is aliased: coef(m) holds NA for it and
  // summary()'s matrix DROPS its row, so co[t + 1, ] would read the wrong row
  // — or crash with "subscript out of bounds" past the last row. The
  // coefficient pulls are therefore guarded on nal (any NA in coef(m)), and
  // the aliased predictors are reported by index (al0…), so the runner can
  // name them instead of indexing the matrix. The F statistic is NULL when
  // every predictor is aliased (an intercept-only fit), so it is guarded too.
  const coefAssigns = Array.from(
    { length: p + 1 },
    (_, t) =>
      `b${t}=if(nal) NA else co[${t + 1},1],se${t}=if(nal) NA else co[${t + 1},2],` +
      `t${t}=if(nal) NA else co[${t + 1},3],pv${t}=if(nal) NA else co[${t + 1},4]`,
  );
  const aliasAssigns = Array.from({ length: p }, (_, i) => `al${i}=as.numeric(na[${i + 2}])`);
  // Diagnostics (seq 198): the ANOVA table's sums of squares, AIC/AICc
  // (k = coefficients + residual variance; AICc undefined when n − k − 1 ≤
  // 0), one VIF per predictor (1/(1 − R²ⱼ), predictor j regressed on the
  // others — R² is translation-invariant, so the auxiliary regression is
  // centered the same way as the main fit; uncentered it returns R² = 0 at
  // 1e13 scale and every VIF reads 1 — a single predictor has VIF 1 by
  // definition), and the coefficients' covariance matrix on the uncentered
  // scale (J·vcov(m)·J′, J the centering back-transform — the same transform
  // the intercept's SE above uses, extended to the whole matrix; verified
  // against the direct uncentered vcov in Python).
  const vifAssigns =
    p === 1
      ? "vf0=1"
      : predictors
          .map(
            (_, j) =>
              `vf${j}=1/(1-summary(lm(I(X[,${j + 1}]-mean(X[,${j + 1}]))~sweep(X[,-${j + 1},drop=FALSE],2,colMeans(X[,-${j + 1},drop=FALSE]))))$r.squared)`,
          )
          .join(",");
  const cvAssigns = Array.from({ length: p + 1 }, (_, i) =>
    Array.from({ length: p + 1 }, (_, j) => `cv${i}_${j}=V0[${i + 1},${j + 1}]`).join(","),
  ).join(",");
  const diagCode =
    // On the centered fit the fitted values already sit about 0 (their mean is
    // the centered Y's mean), so the regression sum of squares is the sum of
    // their squares — the old (fitted − mean(y))² reads 8e26 garbage here,
    // fitted ~0 against mean(y) ~1e13.
    `nn<-length(y);k<-length(coef(m))+1;ssr<-sum(fitted(m)^2);sse<-sum(residuals(m)^2);` +
    `aic<-AIC(m);aicc<-if(nn-k-1>0)aic+2*k*(k+1)/(nn-k-1) else NA;` +
    `Vcf<-vcov(m);J<-rbind(c(1,-mx),cbind(0,diag(${p})));V0<-J%*%Vcf%*%t(J);` +
    // Residual diagnostics (seq 198 remainder): the per-row fitted values
    // on the uncentered scale (fitted(m)+my — the centered fit's sit
    // about 0), the residuals (identical on either scale), standardized
    // residuals, leverage and Cook's distance (all invariant to
    // centering), plus the assumption tests on the residuals:
    // Durbin–Watson for autocorrelation in row order, Prism's four
    // normality tests — Shapiro–Wilk, D'Agostino–Pearson (its moments
    // only, the K2/P computed by the shared TS implementation; n ≥ 20
    // like the standalone normality analysis), Anderson–Darling via
    // nortest, Kolmogorov–Smirnov against a fitted normal — and
    // Spearman's rank correlation between |residual| and fitted for
    // heteroscedasticity (Prism's Residuals tab test). Each test guards
    // its own floor and returns NA rather than erroring on a constant or
    // tiny residual set (a perfect fit's 0/0 Durbin–Watson reads NA).
    `er<-residuals(m);fv<-fitted(m)+my;rs<-rstandard(m);hv<-hatvalues(m);cd<-cooks.distance(m);` +
    `dw<-if(nn>1)sum(diff(er)^2)/sum(er^2) else NA;` +
    `sw<-tryCatch({s<-shapiro.test(er);c(unname(s$statistic),s$p.value)},error=function(e)c(NA,NA));` +
    `dpm<-if(nn>=20){d<-er-mean(er);c(nn,mean(d^2),mean(d^3),mean(d^4))}else c(NA,NA,NA,NA);` +
    `ad<-tryCatch({a<-nortest::ad.test(er);c(unname(a$statistic),a$p.value)},error=function(e)c(NA,NA));` +
    `ks<-tryCatch({k<-suppressWarnings(ks.test(er,"pnorm",mean(er),sd(er)));c(unname(k$statistic),k$p.value)},error=function(e)c(NA,NA));` +
    `sp<-tryCatch({s<-suppressWarnings(cor.test(abs(er),fv,method="spearman"));c(unname(s$estimate),s$p.value)},error=function(e)c(NA,NA));`;
  // One named key per per-row value (the flat-map rule — no vectors cross
  // the WebR boundary, only a named vector does): observed, fitted,
  // residual, standardized residual, leverage, Cook's distance.
  const residAssigns = Array.from({ length: n }, (_, i) =>
    `ob${i}=y[${i + 1}],ft${i}=fv[${i + 1}],re${i}=er[${i + 1}],rs${i}=rs[${i + 1}],hv${i}=hv[${i + 1}],cd${i}=cd[${i + 1}]`,
  ).join(",");
  // The predictors and Y centered (upstream 1.1.1: the same fit, more precise in
  // lm's QR for values far from 0 for their spread); the intercept is taken back
  // to 0 with its exact SE (the centered intercept is uncorrelated with the
  // slopes). Centering via `sweep` keeps coef(m)'s NA positions, so Titer's
  // `nal`-based alias indexing below composes with it — the back-transformation
  // only runs when no coefficient is NA (when one is, the aliased-predictor
  // error fires first). Dummy columns centre like any other column (0/1 → mean
  // = level share).
  const code =
    `y<-${rVec(aligned[0])};X<-cbind(${design.map((_, i) => rVec(aligned[i + 1])).join(",")});` +
    `mx<-colMeans(X);my<-mean(y);m<-lm(I(y-my)~sweep(X,2,mx));s<-summary(m);co<-s$coefficients;na<-is.na(coef(m));nal<-any(na);f<-s$fstatistic;` +
    `if(!nal){V<-vcov(m)[-1,-1,drop=FALSE];b0<-co[1,1]+my-sum(co[-1,1]*mx);se0<-sqrt(co[1,2]^2+drop(mx%*%V%*%mx));` +
    `t0<-b0/se0;co[1,]<-c(b0,se0,t0,2*pt(-abs(t0),df.residual(m)))};` +
    diagCode +
    `c(r2=s$r.squared,adjr2=s$adj.r.squared,aic=aic,aicc=aicc,ssr=ssr,sse=sse,` +
    `${vifAssigns},${cvAssigns},` +
    `fstat=if(is.null(f)) NA else unname(f[1]),n=length(y),` +
    `fp=if(is.null(f)) NA else unname(pf(f[1],f[2],f[3],lower.tail=FALSE)),` +
    `dw=dw,sw0=sw[1],sw1=sw[2],dpn=dpm[1],dpm2=dpm[2],dpm3=dpm[3],dpm4=dpm[4],` +
    `ad0=ad[1],ad1=ad[2],ks0=ks[1],ks1=ks[2],sp0=sp[1],sp1=sp[2],${residAssigns},` +
    `aliased=as.numeric(nal),${aliasAssigns.join(",")},${coefAssigns.join(",")})`;

  const v = await evalNamedVector(code);
  if (v.aliased === 1) {
    return {
      error:
        aliasedPredictorsError(
          design,
          design.map((_, i) => v[`al${i}`]),
          "Multiple linear regression",
        ) ??
        "The fit could not estimate a separate coefficient for every predictor — two or more predictors carry the same information. Drop one of the collinear predictors and try again.",
    };
  }
  const terms = ["Intercept", ...design.map((d) => d.term)];
  const coefficients: RegressionCoefficient[] = terms.map((term, t) => ({
    term,
    estimate: v[`b${t}`] ?? null,
    stdError: v[`se${t}`] ?? null,
    t: v[`t${t}`] ?? null,
    p: v[`pv${t}`] ?? null,
  }));
  const vif: VifRow[] = predictors.map((c, j) => ({ term: c.name, vif: v[`vf${j}`] ?? null }));
  const anovaTable: AnovaRow[] = [
    { source: "Regression", df: p, ss: v.ssr ?? null, ms: v.ssr != null ? v.ssr / p : null, f: v.fstat ?? null, p: v.fp ?? null },
    {
      source: "Residual",
      df: n - p - 1,
      ss: v.sse ?? null,
      ms: v.sse != null ? v.sse / (n - p - 1) : null,
      f: null,
      p: null,
    },
  ];
  const covariance: CovarianceMatrix = {
    variables: terms,
    values: terms.map((_, i) => terms.map((_, j) => v[`cv${i}_${j}`] ?? null)),
  };
  // Per-row residuals, in complete-case order, keyed to their table rows
  // (sel.rows) so a flagged row can be found in the table.
  const residuals: MultipleRegressionResidualRow[] = sel.rows.map((tableRow, i) => ({
    row: tableRow + 1,
    observed: v[`ob${i}`] ?? null,
    fitted: v[`ft${i}`] ?? null,
    residual: v[`re${i}`] ?? null,
    standardized: v[`rs${i}`] ?? null,
    leverage: v[`hv${i}`] ?? null,
    cooks: v[`cd${i}`] ?? null,
  }));
  const dp =
    v.dpn != null && v.dpm2 != null && v.dpm3 != null && v.dpm4 != null
      ? dagostinoPearson(v.dpn, v.dpm2, v.dpm3, v.dpm4)
      : null;
  const residualDiagnostics: ResidualDiagnostics = {
    durbinWatson: v.dw ?? null,
    shapiroWilk: { statistic: v.sw0 ?? null, p: v.sw1 ?? null },
    dagostinoPearson: { statistic: dp?.k2 ?? null, p: dp?.p ?? null },
    andersonDarling: { statistic: v.ad0 ?? null, p: v.ad1 ?? null },
    kolmogorovSmirnov: { statistic: v.ks0 ?? null, p: v.ks1 ?? null },
    heteroscedasticity: { rho: v.sp0 ?? null, p: v.sp1 ?? null },
  };
  const highVif = vif.filter((row) => (row.vif ?? 0) > 10).map((row) => `“${row.term}”`);
  // What the diagnostics flag, in the notes: rows with a large
  // standardized residual (|r| > 3), high leverage (above 2p/n, p =
  // parameters including the intercept), or a Cook's distance above 1;
  // a Durbin–Watson far from 2 (autocorrelation in row order — only
  // meaningful when the row order is); a normality test that rejects;
  // a Spearman test that says the residuals' size varies with fitted.
  const levThreshold = (2 * (p + 1)) / n;
  const rowFlags = residuals.flatMap((r) => {
    const flags: string[] = [];
    if (r.standardized != null && Math.abs(r.standardized) > 3)
      flags.push(`a standardized residual of ${r.standardized.toPrecision(3)} (above 3 in magnitude)`);
    if (r.leverage != null && r.leverage > levThreshold)
      flags.push(`high leverage (${r.leverage.toPrecision(3)}, above 2p/n = ${levThreshold.toPrecision(3)})`);
    if (r.cooks != null && r.cooks > 1) flags.push(`a Cook's distance of ${r.cooks.toPrecision(3)} (above 1)`);
    return flags.length ? [`Row ${r.row} has ${flags.join(" and ")}.`] : [];
  });
  const dwNote =
    residualDiagnostics.durbinWatson == null
      ? ""
      : residualDiagnostics.durbinWatson < 1.5
        ? ` Durbin–Watson ${residualDiagnostics.durbinWatson.toPrecision(3)} — below 1.5, so the residuals may be positively autocorrelated in row order.`
        : residualDiagnostics.durbinWatson > 2.5
          ? ` Durbin–Watson ${residualDiagnostics.durbinWatson.toPrecision(3)} — above 2.5, so the residuals may be negatively autocorrelated in row order.`
          : "";
  const failedNormality = (
    [
      ["Shapiro–Wilk", residualDiagnostics.shapiroWilk.p],
      ["D'Agostino–Pearson", residualDiagnostics.dagostinoPearson.p],
      ["Anderson–Darling", residualDiagnostics.andersonDarling.p],
      ["Kolmogorov–Smirnov", residualDiagnostics.kolmogorovSmirnov.p],
    ] as const
  )
    .filter(([, testP]) => testP != null && testP < 0.05)
    .map(([name]) => name);
  const normalityNote = failedNormality.length
    ? ` The residuals depart from a normal distribution (${failedNormality.join(", ")} P < 0.05).`
    : "";
  const heteroNote =
    residualDiagnostics.heteroscedasticity.p != null && residualDiagnostics.heteroscedasticity.p < 0.05
      ? " The residuals' size varies with the fitted values (Spearman P < 0.05) — the scatter may not be constant."
      : "";
  const diagnosticsNote =
    (rowFlags.length ? ` ${rowFlags.join(" ")}` : "") + dwNote + normalityNote + heteroNote;
  const { groups: described } = await describe([dep, ...predictors]);
  return {
    testType: "multiple-regression",
    subtitle: "Multiple linear regression",
    stats: [
      { label: "R squared", value: v.r2 },
      { label: "Adjusted R squared", value: v.adjr2 },
      { label: "AIC", value: v.aic ?? null },
      { label: "AICc", value: v.aicc ?? null },
      { label: "F", value: v.fstat },
      pRow("P value (model)", v.fp ?? null),
      { label: "Complete rows (n)", value: v.n },
      { label: "Predictors", value: p },
    ],
    groups: described,
    notes:
      `Ordinary least-squares regression of “${dep.name}” on ${p} predictor(s), fit on ${n} complete rows. ` +
      "Each coefficient's P value tests whether that predictor's slope differs from zero, holding the others fixed." +
      categoricalPredictorsNote(sel.categorical, sel.singleLevel) +
      (highVif.length
        ? ` ${highVif.join(" and ")} ${highVif.length > 1 ? "are" : "is"} strongly collinear with the other predictor(s) (VIF above 10) — ${highVif.length > 1 ? "their" : "its"} coefficient is imprecise.`
        : "") +
      diagnosticsNote +
      droppedPredictorsNote(dropped) +
      droppedNoCompleteNote(sel.droppedNoComplete),
    coefficients,
    vif,
    anovaTable,
    covariance,
    residuals,
    residualDiagnostics,
  };
}
