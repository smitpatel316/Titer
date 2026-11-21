// Multiple logistic regression on a Multiple Variables table: a binary (0/1)
// outcome regressed on several predictors, fit on complete cases. Bespoke
// runner (not ColumnTestSpec) — needs a chosen outcome, a coefficients table
// whose statistic is a z, and per-predictor odds ratios as stats rows.
// Mirrors multiple-regression.ts, with glm(family = binomial) in place of lm
// and the separation guard from xy/logistic-regression.ts (plan 01).
import type {
  AnalysisOutcome,
  Column,
  MultipleLogisticRegressionParams,
  RegressionCoefficient,
  StatRow,
} from "../types";
import { describe, pRow, rVec } from "../column/base";
import {
  alignedGroups,
  categoricalPredictorsNote,
  droppedNoCompleteNote,
  droppedPredictorsNote,
  selectPredictors,
  aliasedPredictorsError,
} from "./predictors";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

/** Complete separation makes glm diverge (huge coefficients, no convergence):
 *  R still returns numbers, so the guard below refuses to present them. */
const SEPARATION_ERROR =
  "The outcome is (nearly) perfectly separated by the predictor(s) — the odds ratios are not estimable. " +
  "Try different predictors, or collect more data where the outcomes overlap.";

export async function runMultipleLogisticRegression(
  columns: Column[],
  params: MultipleLogisticRegressionParams | undefined,
): Promise<AnalysisOutcome> {
  const sel = selectPredictors(columns, params);
  if (sel.error) return { error: sel.error };
  const { dep, design, dropped } = sel;
  if (!dep || design.length < 1) {
    return {
      error: "Multiple logistic regression needs a dependent variable and at least one other variable with data.",
    };
  }

  // Complete cases: the rows where every variable used has a value — the
  // design carries the aligned values (see multiple-regression.ts).
  const aligned = [sel.depValues, ...design.map((d) => d.values)];
  const n = aligned[0].length;
  const p = design.length;

  // The outcome must hold only 0s and 1s (blanks are already dropped as incomplete
  // rows). Text codes ("yes"/"no") are not coerced in v1 — 0/1 only.
  const bad = aligned[0].find((v) => v !== 0 && v !== 1);
  if (bad !== undefined) {
    return {
      error: `“${dep.name}” holds ${bad}, but the outcome must hold only 0s and 1s (1 = event, 0 = no event).`,
    };
  }
  const ones = aligned[0].filter((v) => v === 1).length;
  if (ones === 0 || ones === n) {
    return {
      error: "The outcome has only one value (all 0s / all 1s). Logistic regression needs both outcomes.",
    };
  }
  if (n <= p + 1) {
    return { error: `Not enough complete rows (${n}) to fit ${p} predictor(s). Enter more data and try again.` };
  }
  // Plan-01 guardrails, mirrored for several predictors (m4, bug-fix queue
  // item 38): a handful of rows, or of the rarer outcome, cannot support a
  // multi-parameter fit — a 1-event fit is a nominal glm MLE, but its
  // coefficients are absurd (|b| in the teens) and the odds ratios are
  // meaningless. The minority rule generalizes per predictor: plan 01's
  // minority ≥ 2 with one predictor is 2 events per predictor, so with p
  // predictors the rarer outcome needs at least 2p observations.
  if (n < 5) {
    return {
      error: `Only ${n} complete row${n === 1 ? "" : "s"} — logistic regression needs at least 5 (a Titer guardrail, not Prism's).`,
    };
  }
  const minority = Math.min(ones, n - ones);
  if (minority < 2) {
    return {
      error: `Only ${minority} observation of the less common outcome — logistic regression needs at least 2 of each outcome (a Titer guardrail, not Prism's).`,
    };
  }
  if (minority < 2 * p) {
    return {
      error:
        `Only ${minority} observations of the less common outcome for ${p} predictors — ` +
        "logistic regression needs at least 2 events per predictor (a Titer guardrail, not Prism's).",
    };
  }

  const decls = [`y<-${rVec(aligned[0])}`, ...design.map((_, i) => `x${i}<-${rVec(aligned[i + 1])}`)];
  const formula = `y~${design.map((_, i) => `x${i}`).join("+")}`;
  // Each coefficient row t (0 = intercept) pulled from summary()'s coefficient
  // matrix by explicit index → keyed names, so extraction never depends on order.
  // Column 3 of a glm coefficient matrix is the z value, not a t value. Odds
  // ratios (per predictor only) are Wald: exp(estimate ± 1.96·SE).
  // A constant or collinear predictor is aliased: coef(m) holds NA for it and
  // summary()'s matrix DROPS its row, so co[t + 1, ] would read the wrong row
  // — or crash with "subscript out of bounds" past the last row. The
  // coefficient pulls are therefore guarded on nal (any NA in coef(m)), and
  // the aliased predictors are reported by index (al0…), so the runner can
  // name them instead of indexing the matrix.
  const coefAssigns = Array.from({ length: p + 1 }, (_, t) => {
    const base =
      `b${t}=if(nal) NA else co[${t + 1},1],se${t}=if(nal) NA else co[${t + 1},2],` +
      `z${t}=if(nal) NA else co[${t + 1},3],pv${t}=if(nal) NA else co[${t + 1},4]`;
    return t === 0
      ? base
      : `${base},or${t}=if(nal) NA else exp(co[${t + 1},1]),` +
          `orLo${t}=if(nal) NA else exp(co[${t + 1},1]-1.96*co[${t + 1},2]),` +
          `orHi${t}=if(nal) NA else exp(co[${t + 1},1]+1.96*co[${t + 1},2])`;
  });
  const aliasAssigns = Array.from({ length: p }, (_, i) => `al${i}=as.numeric(na[${i + 2}])`);
  const code =
    `${decls.join(";")};m<-glm(${formula},family=binomial);s<-summary(m);co<-s$coefficients;na<-is.na(coef(m));nal<-any(na);` +
    `c(dev=m$deviance,nulldev=m$null.deviance,residDf=m$df.residual,aic=m$aic,` +
    `modelP=pchisq(m$null.deviance-m$deviance,${p},lower.tail=FALSE),converged=as.numeric(m$converged),` +
    `aliased=as.numeric(nal),${aliasAssigns.join(",")},${coefAssigns.join(",")})`;

  const v = await evalNamedVector(code);
  if (v.aliased === 1) {
    return {
      error:
        aliasedPredictorsError(
          design,
          design.map((_, i) => v[`al${i}`]),
          "Multiple logistic regression",
        ) ??
        "The fit could not estimate a separate coefficient for every predictor — two or more predictors carry the same information. Drop one of the collinear predictors and try again.",
    };
  }
  const terms = ["Intercept", ...design.map((d) => d.term)];
  const coefficients: RegressionCoefficient[] = terms.map((term, t) => ({
    term,
    estimate: v[`b${t}`] ?? null,
    stdError: v[`se${t}`] ?? null,
    t: v[`z${t}`] ?? null,
    p: v[`pv${t}`] ?? null,
  }));
  // glm's warnings (non-convergence, fitted probabilities 0/1) are swallowed by
  // evalNamedVector, so separation is caught here from the fit itself: no
  // convergence, a huge |coefficient|, or a missing/non-finite standard error.
  const separated =
    v.converged !== 1 ||
    coefficients.some((c) => c.estimate == null || !Number.isFinite(c.estimate) || Math.abs(c.estimate) > 30) ||
    coefficients.some((c) => c.stdError == null || !Number.isFinite(c.stdError));
  if (separated) return { error: SEPARATION_ERROR };

  const pseudoR2 = v.nulldev != null && v.nulldev !== 0 && v.dev != null ? 1 - v.dev / v.nulldev : null;
  const stats: StatRow[] = [
    ...design.flatMap((d, i) => {
      const t = i + 1;
      return [
        { label: `Odds ratio (${d.term})`, value: v[`or${t}`] ?? null },
        { label: `Odds ratio 95% CI lower (${d.term})`, value: v[`orLo${t}`] ?? null },
        { label: `Odds ratio 95% CI upper (${d.term})`, value: v[`orHi${t}`] ?? null },
      ];
    }),
    { label: "Residual deviance", value: v.dev ?? null },
    { label: "Null deviance", value: v.nulldev ?? null },
    { label: "Residual df", value: v.residDf ?? null },
    { label: "AIC", value: v.aic ?? null },
    pRow("P value (model)", v.modelP ?? null),
    { label: "McFadden pseudo-R²", value: pseudoR2 },
    { label: "Complete rows (n)", value: n },
    { label: "Predictors", value: p },
  ];

  const described = (await describe(alignedGroups(dep, sel.depValues, design))).groups;
  // logit(p) = b0 + b1·X1 + b2·X2 + …
  const b0 = v.b0;
  const equation =
    b0 == null
      ? undefined
      : `logit(p) = ${num(b0)} ${design
          .map((d, i) => {
            const b = v[`b${i + 1}`];
            return b == null ? null : `${b < 0 ? "−" : "+"} ${num(Math.abs(b))}·${d.term}`;
          })
          .filter((s): s is string => s !== null)
          .join(" ")}`;

  return {
    testType: "multiple-logistic-regression",
    subtitle: "Multiple logistic regression",
    equation,
    stats,
    groups: described,
    notes:
      `Multiple logistic regression of “${dep.name}” on ${p} predictor(s), fit on ${n} complete rows. ` +
      "The odds ratios are per one-unit increase in each predictor, with Wald 95% confidence intervals (a normal approximation). " +
      "Each predictor's P value tests whether its coefficient differs from zero, holding the others fixed." +
      categoricalPredictorsNote(sel.categorical, sel.singleLevel) +
      droppedPredictorsNote(dropped) +
      droppedNoCompleteNote(sel.droppedNoComplete),
    coefficients,
    // The coefficients table's statistic is a z, not a t.
    statisticLabel: "z",
  };
}
