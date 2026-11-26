// Survival analysis of a Survival table (Prism's "Simple survival analysis"), with R's
// survival package: each group's subjects, events and median survival with its 95% interval
// (survfit, log-log); the curves compared by the log-rank (Mantel-Cox) test (survdiff), the
// log-rank test for trend (on survdiff's observed − expected events), or the Gehan-Breslow-
// Wilcoxon test (each event time weighted by the number at risk, as Prism; survdiff has no
// such weights); two groups' hazard ratios, Mantel-Haenszel and log-rank. With 3 groups or
// more, every pair is also compared, corrected for multiplicity.
import type { AnalysisOutcome, Column, ComparisonRow, StatRow, SurvivalGroupRow, SurvivalParams } from "../types";
import { evalNamedVector } from "../webr";
import { pairIndices, rVec } from "../column/base";
import { survivalGroups } from "./base";

const TEST_NAMES: Record<SurvivalParams["curveTest"], string> = {
  logrank: "Log-rank (Mantel-Cox) test",
  trend: "Log-rank test for trend",
  gehan: "Gehan-Breslow-Wilcoxon test",
};

/** R's `p.adjust` method for each correction. */
const CORRECTION_METHOD: Record<SurvivalParams["correction"], string> = { holm: "holm", fdr: "BH", none: "none" };

const CORRECTION_NAMES: Record<SurvivalParams["correction"], string> = {
  holm: "Holm-corrected",
  fdr: "FDR-corrected (Benjamini-Hochberg)",
  none: "uncorrected",
};

/** The wizard's defaults (log-rank, Holm). */
const DEFAULTS: SurvivalParams = { curveTest: "logrank", correction: "holm" };

/** R: `chi`, the chi-square comparing groups 1…k of subjects `t`, `s`, `g` by `test`
 *  (`gehan` sums each group's O − E and their covariance, every event time weighted by
 *  the number at risk); `hr`, the log-rank hazard ratio of the first group to the second. */
const R_TESTS = `
gehan<-function(t,s,g,k){u<-sort(unique(t[s==1]));Z<-numeric(k);V<-matrix(0,k,k)
for(x in u){n<-tabulate(g[t>=x],k);d<-tabulate(g[t==x&s==1],k);N<-sum(n);D<-sum(d)
Z<-Z+N*(d-n*D/N);if(N>1)V<-V+N^2*D*(N-D)/(N-1)*(diag(n/N,k)-outer(n/N,n/N))}
list(Z=Z,V=V)}
quad<-function(Z,V){m<-length(Z)-1;tryCatch(drop(Z[1:m]%*%solve(V[1:m,1:m,drop=FALSE],Z[1:m])),error=function(e) NA_real_)}
chi<-function(t,s,g,k,test){if(test=="gehan"){w<-gehan(t,s,g,k);return(quad(w$Z,w$V))}
d<-survival::survdiff(survival::Surv(t,s)~factor(g,levels=1:k))
if(test=="trend"){x<-1:k;return(sum(x*(d$obs-d$exp))^2/drop(x%*%d$var%*%x))}
d$chisq}
hr<-function(t,s,g){d<-survival::survdiff(survival::Surv(t,s)~factor(g,levels=1:2));d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2])}`;

export async function runSurvival(columns: Column[], params: SurvivalParams | undefined): Promise<AnalysisOutcome> {
  // The wizard's defaults (log-rank, Holm): a run with no params — MCP with
  // no `params`, or a file whose values were dropped on load — runs these
  // instead of crashing on `params.curveTest` (BUG-15).
  const p = { ...DEFAULTS, ...params };
  // The merged `correction` list in the file reader admits every family's
  // values (seq 193 widened it for multiple-t-tests); survival only offers
  // holm/fdr/none, so refuse the others instead of sending `p.adjust` a
  // method it does not know.
  if (!Object.hasOwn(CORRECTION_METHOD, p.correction)) {
    return { error: `Unknown survival correction "${p.correction}".` };
  }
  // A Multiple Variables table assigns its variables (`time`, `status`, `groupBy`); a
  // Survival table reads them positionally (X = time, one column per group of codes).
  const groups = survivalGroups(columns, p);
  if (!Array.isArray(groups)) return groups;

  const k = groups.length;
  const test = p.curveTest === "trend" && k < 3 ? "logrank" : p.curveTest;
  const pairs = k > 2 ? pairIndices(k) : [];
  // Each pair is compared by the same test, the trend's by the log-rank test.
  const pairTest = test === "gehan" ? "gehan" : "logrank";
  const pair = (i: number, j: number) => `{w<-g==${i + 1}|g==${j + 1};pg<-ifelse(g[w]==${i + 1},1,2)`;
  const r = await evalNamedVector(
    `${R_TESTS}
t<-${rVec(groups.flatMap((g) => g.x))};s<-${rVec(groups.flatMap((g) => g.y))}
g<-${rVec(groups.flatMap((g, i) => g.x.map(() => i + 1)))};k<-${k}
x<-tryCatch(chi(t,s,g,k,"${test}"),error=function(e) NA_real_);df<-${test === "trend" ? 1 : k - 1}
q<-quantile(survival::survfit(survival::Surv(t,s)~factor(g,levels=1:k),conf.type="log-log"),0.5)
d<-survival::survdiff(survival::Surv(t,s)~factor(g,levels=1:k));v<-d$var[1,1]
# BUG-REPORT Round 2 #66: mh/lr are 2-group ratios only (k==2), and
# undefined when the risk sets never overlap (v==0) — NA, never Inf/NaN.
hrOk<-k==2&&is.finite(v)&&v>0;L<-if(hrOk)(d$obs[1]-d$exp[1])/v else NA_real_
lr0<-d$obs[1]/d$exp[1]/(d$obs[2]/d$exp[2]);lr0<-if(k==2&&is.finite(lr0))lr0 else NA_real_
c(chi=x,df=df,p=pchisq(x,df,lower.tail=FALSE),
${groups.map((_, i) => `m_${i}=unname(q$quantile[${i + 1}]),lo_${i}=unname(q$lower[${i + 1}]),hi_${i}=unname(q$upper[${i + 1}])`).join(",")},
v=v,
mh=if(hrOk)exp(L) else NA_real_,mhlo=if(hrOk)exp(L-qnorm(0.975)/sqrt(v)) else NA_real_,mhhi=if(hrOk)exp(L+qnorm(0.975)/sqrt(v)) else NA_real_,
lr=lr0,
lrlo=if(k==2&&is.finite(lr0))lr0*exp(-qnorm(0.975)*sqrt(1/d$exp[1]+1/d$exp[2])) else NA_real_,
lrhi=if(k==2&&is.finite(lr0))lr0*exp(qnorm(0.975)*sqrt(1/d$exp[1]+1/d$exp[2])) else NA_real_,
${groups.map((_, i) => `sub_${i}=sum(g==${i + 1}),ev_${i}=sum(s[g==${i + 1}])`).join(",")}${
      pairs.length
        ? `,setNames(p.adjust(c(${pairs
            .map(([i, j]) => `${pair(i, j)};pchisq(tryCatch(chi(t[w],s[w],pg,2,"${pairTest}"),error=function(e) NA_real_),1,lower.tail=FALSE)}`)
            .join(
              ",",
            )}),"${CORRECTION_METHOD[p.correction]}"),c(${pairs.map(([i, j]) => `"p_${i}_${j}"`).join(",")}))` +
          pairs.map(([i, j]) => `,hr_${i}_${j}=${pair(i, j)};tryCatch(hr(t[w],s[w],pg),error=function(e) NA_real_)}`).join("")
        : ""
    })`,
  );

  // BUG-REPORT Round 2 #66: with disjoint risk sets — no event time has
  // both groups at risk — survdiff's variance is 0, so the comparison is
  // undefined: its chi-square 0 (P = 1) is an artefact of the generalized
  // inverse, and the hazard ratios are undefined. Show the comparison as
  // missing and say why, instead of a vacuous P = 1 with blank ratios.
  // (The per-group medians are still meaningful.)
  const disjoint = k === 2 && r.v === 0;
  const stats: StatRow[] = [
    { label: "Chi-square", value: disjoint ? null : (r.chi ?? null) },
    { label: "df", value: r.df ?? null },
    { label: "P value", value: disjoint ? null : (r.p ?? null), p: true },
  ];
  // Two groups: the hazard ratio of the first to the second, by Mantel-Haenszel and by log-rank.
  if (k === 2) {
    const ratio = `${groups[0].name} / ${groups[1].name}`;
    stats.push(
      { label: `Hazard ratio (Mantel-Haenszel), ${ratio}`, value: r.mh ?? null },
      { label: "95% CI lower", value: r.mhlo ?? null },
      { label: "95% CI upper", value: r.mhhi ?? null },
      { label: `Hazard ratio (log-rank), ${ratio}`, value: r.lr ?? null },
      { label: "95% CI lower", value: r.lrlo ?? null },
      { label: "95% CI upper", value: r.lrhi ?? null },
    );
  }

  const comparisons: ComparisonRow[] = pairs.map(([i, j]) => ({
    group1: groups[i].name,
    group2: groups[j].name,
    diff: r[`hr_${i}_${j}`] ?? null,
    p: r[`p_${i}_${j}`] ?? null,
  }));

  const summaries: SurvivalGroupRow[] = groups.map((g, i) => ({
    group: g.name,
    subjects: r[`sub_${i}`] ?? 0,
    events: r[`ev_${i}`] ?? 0,
    median: r[`m_${i}`] ?? null,
    low: r[`lo_${i}`] ?? null,
    high: r[`hi_${i}`] ?? null,
  }));

  return {
    testType: "survival",
    subtitle: TEST_NAMES[test],
    stats,
    groups: [],
    survivalGroups: summaries,
    comparisons,
    comparisonsLabel: `Pairwise comparisons (${TEST_NAMES[pairTest]}, ${CORRECTION_NAMES[p.correction]})`,
    comparisonsEffect: "Hazard ratio",
    notes:
      "Kaplan-Meier curves (R's survival package). A median survival is the time the curve falls to 50%; " +
      "its 95% interval (log-log) is open (—) where the band never reaches 50%. " +
      (test === "trend" ? "The test for trend takes the groups in their table order as equally spaced. " : "") +
      (disjoint
        ? "The two groups' risk sets do not overlap — no subject from one group was at risk when the other group's events occurred — so the comparison and the hazard ratios cannot be computed; only the per-group medians above are meaningful. "
        : "") +
      (k === 2 && !disjoint ? "A hazard ratio above 1: the first group's events come sooner. " : "") +
      (k > 2 ? "A pairwise hazard ratio is the first group's to the second's (log-rank method)." : ""),
  };
}
