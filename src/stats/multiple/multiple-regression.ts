// Multiple linear regression on a Multiple Variables table: one chosen dependent
// variable regressed on every other data-bearing variable, fit on complete cases.
// Bespoke runner (not ColumnTestSpec) — needs a chosen response + a coefficients table.
import type { AnalysisOutcome, Column, MultipleRegressionParams, RegressionCoefficient } from "../types";
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
  // The predictors centered (upstream 1.1.0: the same fit, more precise for values
  // far from 0 for their spread); the intercept is taken back to 0 with its exact
  // SE (the centered intercept is uncorrelated with the slopes). Centering via
  // `sweep` keeps coef(m)'s NA positions, so Titer's `nal`-based alias indexing
  // below composes with it — the back-transformation only runs when no
  // coefficient is NA (when one is, the aliased-predictor error fires first).
  // Dummy columns centre like any other column (0/1 → mean = level share).
  const code =
    `y<-${rVec(aligned[0])};X<-cbind(${design.map((_, i) => rVec(aligned[i + 1])).join(",")});` +
    `mx<-colMeans(X);m<-lm(y~sweep(X,2,mx));s<-summary(m);co<-s$coefficients;na<-is.na(coef(m));nal<-any(na);f<-s$fstatistic;` +
    `if(!nal){V<-vcov(m)[-1,-1,drop=FALSE];b0<-co[1,1]-sum(co[-1,1]*mx);se0<-sqrt(co[1,2]^2+drop(mx%*%V%*%mx));` +
    `t0<-b0/se0;co[1,]<-c(b0,se0,t0,2*pt(-abs(t0),df.residual(m)))};` +
    `c(r2=s$r.squared,adjr2=s$adj.r.squared,fstat=if(is.null(f)) NA else unname(f[1]),n=length(y),` +
    `fp=if(is.null(f)) NA else unname(pf(f[1],f[2],f[3],lower.tail=FALSE)),` +
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
  const { groups: described } = await describe([dep, ...predictors]);
  return {
    testType: "multiple-regression",
    subtitle: "Multiple linear regression",
    stats: [
      { label: "R squared", value: v.r2 },
      { label: "Adjusted R squared", value: v.adjr2 },
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
      droppedPredictorsNote(dropped) +
      droppedNoCompleteNote(sel.droppedNoComplete),
    coefficients,
  };
}
