// One-way ANOVA — compares the means of three or more groups: the ordinary ANOVA (equal SDs:
// F, and R² as eta squared), Welch's (unequal SDs: `oneway.test`) together with the
// Brown-Forsythe ANOVA (unequal SDs: F*, Brown and Forsythe 1974 — Prism reports both),
// or the lognormal ANOVA (on the logarithms). Optionally followed by comparisons of every
// pair (Tukey, Bonferroni; with unequal SDs Games-Howell or Dunnett's T3), of chosen pairs
// (Bonferroni, Šídák, Holm–Šídák, Fisher's LSD, or the False Discovery Rate), or of each
// group with a control (Dunnett) — or by the test for linear trend between the column
// means and their left-to-right order. Dunnett's and T3's P values are exact: the
// distribution of the largest of the t statistics compared, integrated in R.
import { PAIR_CORRECTIONS, type AnovaParams } from "../types";
import {
  ciAt,
  ciOf,
  comparedPairs,
  dataGroups,
  effectSizeRow,
  groupsSetup,
  identical,
  pairIndices,
  posthocOf,
  pRow,
  R_ADJUST,
  R_CRIT,
  R_EFFECT_CI,
  R_PTUKEY,
  tukeyPosthocStatements,
  type ColumnTestSpec,
  type Group,
} from "./base";

/** Whether `v` is one of `list`. */
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);

const DEFAULTS: AnovaParams = { posthoc: "none", effectSizes: true };

const welch = (p: AnovaParams | undefined) => p?.equalSd === false;
const lognormal = (p: AnovaParams | undefined) => p?.lognormal === true;
const trend = (p: AnovaParams | undefined) => p?.trend === true;

/** R: where √(χ²/df) has its mass (`lims`), and its density (`ds`); `smm`, the P of a t
 *  statistic at `df` as the largest of `mc` independent ones (the studentized maximum
 *  modulus: Dunnett's T3); `dun`, its P as the largest of the comparisons with a control,
 *  each group's weight `l` = √(n / (n + n of the control)) (Dunnett, 1955), integrated on
 *  fixed nodes (`GL`: Gauss-Legendre over the SD, `GH`: Gauss-Hermite over the normal, by
 *  Golub-Welsch), all at once: 1 ms where nested adaptive integrals took 150, the same P to
 *  1e-10, so a CI's search for its critical value costs nothing. */
export const R_MAXIMUM_T = `
lims<-function(df)sqrt(qchisq(c(1e-12,1-1e-12),df)/df)
ds<-function(s,df)dchisq(df*s^2,df)*2*df*s
smm<-function(t,mc,df){r<-lims(df);pmin(1,pmax(0,1-integrate(function(s)(2*pnorm(abs(t)*s)-1)^mc*ds(s,df),r[1],r[2],rel.tol=1e-10)$value))}
gw<-function(n,off){m<-matrix(0,n,n);m[cbind(1:(n-1),2:n)]<-off;m[cbind(2:n,1:(n-1))]<-off;e<-eigen(m,symmetric=TRUE);list(x=e$values,w=e$vectors[1,]^2)}
GL<-gw(96,(1:95)/sqrt(4*(1:95)^2-1));GH<-gw(64,sqrt(1:63))
dun<-function(t,l,df){r<-lims(df);s<-(r[2]-r[1])/2*GL$x+(r[1]+r[2])/2;ws<-(r[2]-r[1])*GL$w*ds(s,df);q<-sqrt(1-l^2)
w<-Reduce("*",lapply(seq_along(l),function(i)pnorm(outer(abs(t)*s,l[i]*GH$x,"-")/q[i])-pnorm(outer(-abs(t)*s,l[i]*GH$x,"-")/q[i])))
pmin(1,pmax(0,1-sum(ws*(w%*%GH$w))))}`;

/** The control group's index among `groups`, if the params name one there. */
const controlOf = (groups: Group[], p: AnovaParams | undefined) => groups.findIndex((g) => g.name === p?.control);

/** The comparisons the params ask: R statements (`setup`), then each pair's P value as
 *  `p_i_j` (`values`, for the result's `c(…)`). */
function comparisons(groups: Group[], p: AnovaParams): { setup: string; values: string } {
  const k = groups.length;
  const at = (i: number) => i + 1;
  // Each pair's 95% CI: its difference ± the statistic at which its method's P is 0.05
  // (`ciOf`), on the ANOVA's pooled SD or, after Welch's, the pair's own (Welch's t).
  const pairs = pairIndices(k);
  const pooled = (i: number, j: number) => `sqrt(mse*(1/n[${at(i)}]+1/n[${at(j)}]))`;
  const diff = (i: number, j: number) => `m[${at(i)}]-m[${at(j)}]`;
  const pooledSetup = `${R_CRIT};mse<-a$"Mean Sq"[2];dfe<-a$Df[2]`;
  if (p.posthoc === "tukey") {
    const ph = tukeyPosthocStatements(k);
    return {
      // `ptk` is defined here, not left to an earlier eval in the session:
      // upstream's branch reads it without defining it.
      setup: `${R_PTUKEY};${pooledSetup};${ph.setup};cv<-crit(function(x)ptk(x*sqrt(2),${k},dfe))`,
      values: [ph.assign, ...pairs.map(([i, j]) => ciAt(`${i}_${j}`, diff(i, j), pooled(i, j), "cv"))].join(","),
    };
  }
  if (isIn(PAIR_CORRECTIONS, p.posthoc) && !(welch(p) && p.posthoc === "fdr")) {
    // The pairs compared (all, or those chosen), each t on the pooled SD, its P corrected
    // for them alone (`adj`), its CI from the same correction (`pa`).
    // (The False Discovery Rate after Welch's ANOVA is the branch below, on
    // Welch t tests — it must not fall through to this pooled-SD one.)
    const chosen = comparedPairs(groups, p.compared);
    // R's correction calls the uncorrected one `fisher`; Titer's name is `lsd`.
    const how = p.posthoc === "lsd" ? "fisher" : p.posthoc;
    return {
      setup:
        `${pooledSetup};${R_ADJUST};` +
        `ps<-adj(c(${chosen.map(([i, j]) => `2*pt(-abs(${diff(i, j)})/${pooled(i, j)},dfe)`).join(",")}),"${how}");` +
        `cv<-crit(function(x)pa(x,dfe,"${how}",${chosen.length}))`,
      values: chosen
        .flatMap(([i, j], q) => [
          `p_${i}_${j}=ps[${q + 1}]`,
          // Holm–Šídák's step-down and the FDR's step-up give no single
          // critical value, so no multiplicity-adjusted CI (`pa` is NA).
          ...(how === "holm-sidak" || how === "fdr" ? [] : [ciAt(`${i}_${j}`, diff(i, j), pooled(i, j), "cv")]),
        ])
        .join(","),
    };
  }
  if (p.posthoc === "dunnett") {
    // Each group against the control, on the ANOVA's residual mean square.
    const c = controlOf(groups, p);
    const others = groups.map((_, i) => i).filter((i) => i !== c);
    const t = (i: number) => `(m[${at(i)}]-m[${at(c)}])/sqrt(mse*(1/n[${at(i)}]+1/n[${at(c)}]))`;
    return {
      setup:
        `${R_MAXIMUM_T}\n${pooledSetup};l<-sqrt(n[-${at(c)}]/(n[-${at(c)}]+n[${at(c)}]));` +
        // Between the uncorrected t's and Bonferroni's: a few integrals, not dozens.
        `cv<-crit(function(x)dun(x,l,dfe),qt(1-0.025/c(1,${others.length}),dfe))`,
      values: others
        .flatMap((i) => [`p_${i}_${c}=dun(${t(i)},l,dfe)`, ciAt(`${i}_${c}`, diff(i, c), pooled(i, c), "cv")])
        .join(","),
    };
  }
  // The False Discovery Rate after Welch's ANOVA (Prism: the raw P of each pair is the
  // Welch t test's, then Benjamini-Hochberg across the chosen family — no CI, as with
  // the ordinary ANOVA's FDR above).
  if (p.posthoc === "fdr") {
    const chosen = comparedPairs(groups, p.compared);
    const raw = ([i, j]: [number, number]) => `{w<-wt(${at(i)},${at(j)});2*pt(-abs(w[1]),w[2])}`;
    return {
      setup:
        `${R_ADJUST};` +
        `wt<-function(i,j){e<-s2[i]/n[i]+s2[j]/n[j];c((m[i]-m[j])/sqrt(e),e^2/((s2[i]/n[i])^2/(n[i]-1)+(s2[j]/n[j])^2/(n[j]-1)),sqrt(e))};` +
        `ps<-adj(c(${chosen.map(raw).join(",")}),"fdr")`,
      values: chosen.map(([i, j], q) => `p_${i}_${j}=ps[${q + 1}]`).join(","),
    };
  }
  // Games-Howell and Dunnett's T3: each pair's Welch t and df; the first against the
  // studentized range, the second against the largest of all the pairs' t, on the exact
  // fractional Welch df — Prism 6+ computes the P value on the fractional df (GraphPad
  // FAQ 1883: "Prism 6 can compute the P value using a df that is fractional"), as R
  // does; rounding to whole df is Prism 5-era only.
  const test = (t: string, df: string) =>
    p.posthoc === "games-howell" ? `ptk(abs(${t})*sqrt(2),${k},${df})` : `smm(${t},${pairs.length},${df})`;
  return {
    setup:
      `${p.posthoc === "t3" ? R_MAXIMUM_T : R_PTUKEY}\n${R_CRIT};` +
      `wt<-function(i,j){e<-s2[i]/n[i]+s2[j]/n[j];c((m[i]-m[j])/sqrt(e),e^2/((s2[i]/n[i])^2/(n[i]-1)+(s2[j]/n[j])^2/(n[j]-1)),sqrt(e))}`,
    values: pairs
      .flatMap(([i, j]) => [
        `p_${i}_${j}={w<-wt(${at(i)},${at(j)});${test("w[1]", "w[2]")}}`,
        `{w<-wt(${at(i)},${at(j)});${ciOf(`${i}_${j}`, diff(i, j), "w[3]", test("x", "w[2]"))}}`,
      ])
      .join(","),
  };
}

export const anovaSpec: ColumnTestSpec<AnovaParams> = {
  testType: "anova",
  minGroups: 3,
  // Welch's ANOVA, Games-Howell and T3 weigh each group by its own variance.
  check: (columns, params) => {
    const p = { ...DEFAULTS, ...params };
    const groups = dataGroups(columns);
    if (p.posthoc === "dunnett" && !groups.some((g) => g.name === p.control)) {
      return `The control group${p.control ? ` “${p.control}”` : ""} holds no data. Create this analysis again to choose another.`;
    }
    if (lognormal(p))
      for (const g of groups) {
        const v = g.values.find((v) => v <= 0);
        if (v !== undefined) return `The lognormal ANOVA needs values above 0; “${g.name}” holds ${v}.`;
      }
    // Games-Howell and Dunnett's T3 assume unequal SDs: a saved analysis
    // forcing them onto the ordinary ANOVA must error, not silently run.
    if (!welch(p) && (p.posthoc === "games-howell" || p.posthoc === "t3")) {
      return `${p.posthoc === "games-howell" ? "Games-Howell" : "Dunnett's T3"} assumes unequal SDs (Welch's ANOVA). Create this analysis again to choose another.`;
    }
    // The test for linear trend is Prism's alternative to multiple comparisons,
    // on the ordinary ANOVA alone: the wizard never offers it with Welch's or
    // with a post-hoc, but a saved analysis could still ask for the combination.
    if (trend(p) && welch(p)) {
      return "The test for linear trend runs on the ordinary ANOVA; with unequal SDs (Welch's ANOVA) it is not offered. Create this analysis again to choose another.";
    }
    if (trend(p) && p.posthoc !== "none") {
      return "The test for linear trend is an alternative to multiple comparisons, not an addition to them. Create this analysis again to choose one or the other.";
    }
    if (!welch(p)) {
      // With one value in every group there is no within-group variation:
      // residual df = N − k = 0, so R's F and P are NaN (nulls) while eta
      // squared misleadingly reads 1. Name it instead of silent nulls.
      // (Welch's ANOVA is checked below — it already needs ≥ 2 values in
      // each group, so this case can't reach it.)
      const total = groups.reduce((s, g) => s + g.values.length, 0);
      if (groups.length >= 3 && total === groups.length)
        return "Each group holds only one value, so there is no within-group variation to compare against — one-way ANOVA needs at least one group with two or more values.";
      return undefined;
    }
    for (const g of groups) {
      if (g.values.length < 2)
        return `“${g.name}” holds ${g.values.length} value; this test needs at least 2 in each group.`;
      if (g.values.every((v) => v === g.values[0]))
        return `“${g.name}”'s values are all identical: this test needs some scatter in each group.`;
    }
  },
  // The groups are compared on the scatter within them.
  checkGroups: (groups) => {
    const n = groups.reduce((a, g) => a + g.values.length, 0);
    if (n <= groups.length)
      return `One-way ANOVA needs more values than groups: the ${groups.length} groups hold ${n}.`;
    if (groups.every((g) => identical(g.values)))
      return "Each group's values are identical: there is no scatter within the groups to compare them on.";
  },
  // Lognormal: everything runs on the logarithms (taken in R); each group's geometric mean,
  // and each comparison's ratio of geometric means, its CI's bounds made ratios too.
  rCode: (groups, params) => {
    const p = { ...DEFAULTS, ...params };
    const k = groups.length;
    const g = groups.map((_, i) => `g${i}`);
    const logs = lognormal(p) ? `;${g.map((x) => `${x}<-log(${x})`).join(";")};v<-log(v)` : "";
    const setup =
      `${R_EFFECT_CI};${groupsSetup(groups)}${logs};G<-list(${g.join(",")});` +
      `n<-lengths(G);m<-sapply(G,mean);s2<-sapply(G,var);a<-summary(aov(v~gr))[[1]]`;
    // Brown-Forsythe's F* (Brown and Forsythe, 1974): the between-group sum of squares
    // over Σ(1 − n_i/N)·s_i², its denominator df from the weights c_i =
    // (1 − n_i/N)·s_i² / Σ(1 − n_j/N)·s_j² — the second unequal-variance ANOVA Prism
    // reports beside Welch's. (Not the Brown-Forsythe test of equal variances, which
    // is an ANOVA of absolute deviations from the median.) Computed before `main`,
    // which reads it.
    const bf = welch(p)
      ? `;bfw<-(1-n/sum(n))*s2;bfF<-sum(n*(m-sum(n*m)/sum(n))^2)/sum(bfw);` +
        `bfc<-bfw/sum(bfw);bfDf2<-1/sum(bfc^2/(n-1));bfP<-pf(bfF,${k - 1},bfDf2,lower.tail=FALSE)`
      : "";
    const main = welch(p)
      ? `w<-oneway.test(v~gr,var.equal=FALSE);r<-c(F=unname(w$statistic),dfn=unname(w$parameter[1]),dfd=unname(w$parameter[2]),p=w$p.value,bfF=bfF,bfDfn=${k - 1},bfDfd=bfDf2,bfP=bfP)`
      : // Partial eta squared (seq 161) equals eta squared here — one factor, so
        // R² = η² = partial η² (Prism's ANOVA guide) — with its 95% CI from
        // the F statistic's noncentrality (`etaCI`, N = total observations).
        // Welch's has no sums-of-squares decomposition, so it reports none.
        `ec<-etaCI(a$"F value"[1],a$Df[1],a$Df[2],sum(n));r<-c(F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[2],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq"),pLo=ec[1],pHi=ec[2],ssB=a$"Sum Sq"[1],ssE=a$"Sum Sq"[2]);r["f"]<-sqrt(r["eta2"]/(1-r["eta2"]))`;
    // The test for linear trend (Prism's post test for trend; Sheskin, Altman): the
    // columns are X = 1…k, equally spaced, and only the group means are fitted — a
    // column with more values gets no more weight. Its linear component is the
    // 1-df contrast SS_lin = (Σc_i·m_i)²/Σ(c_i²/n_i) on c_i = X_i − X̄, tested
    // against the ordinary ANOVA's residual mean square; the slope is the
    // unweighted least-squares slope of the means on X. The effect-size R² is
    // SS_lin over the total sum of squares, the alerting R² over the between-group
    // one; with four or more groups the rest of the between-group sum of squares
    // tests the nonlinear trend.
    const tr = trend(p)
      ? `;cc<-(1:${k})-mean(1:${k});ssl<-(sum(cc*m))^2/sum(cc^2/n);mse<-a$"Sum Sq"[2]/a$Df[2];` +
        `ssb<-a$"Sum Sq"[1];sst<-sum(a$"Sum Sq");` +
        `tr<-c(trSlope=sum(cc*(m-mean(m)))/sum(cc^2),trR2eff=ssl/sst,` +
        `trR2alert=if(ssb>0)ssl/ssb else NA,` +
        `trPlin=pf(ssl/mse,1,a$Df[2],lower.tail=FALSE),` +
        `trPnonlin=${k >= 4 ? `pf((max(0,ssb-ssl)/${k - 2})/mse,${k - 2},a$Df[2],lower.tail=FALSE)` : "NA"})`
      : "";
    const geometric = lognormal(p) ? `;r<-c(r,setNames(exp(m),paste0("gm",0:${groups.length - 1})))` : "";
    if (p.posthoc === "none") return `${setup}${bf};${main}${tr}${geometric};${trend(p) ? "c(r,tr)" : "r"}`;
    const ph = comparisons(groups, p);
    if (!lognormal(p)) return `${setup}${bf};${main}${tr}\n${ph.setup}\nc(r,${ph.values}${trend(p) ? ",tr" : ""})`;
    const ratios = anovaSpec.pairs!(groups, p).map(([i, j]) => `r_${i}_${j}=exp(m[${i + 1}]-m[${j + 1}])`);
    return (
      `${setup}${bf};${main}${tr}${geometric}\n${ph.setup}\nout<-c(r,${ph.values},${ratios.join(",")}${trend(p) ? ",tr" : ""});` +
      `ci<-grep("^(lo|hi)_",names(out));out[ci]<-exp(out[ci]);out`
    );
  },
  rows: (v, groups, params) => [
    ...(welch(params)
      ? [
          { label: "F (Welch)", value: v.F },
          { label: "DFn", value: v.dfn },
          { label: "DFd", value: v.dfd },
          pRow("P value", v.p),
          // The Brown-Forsythe ANOVA beside Welch's: same null, another F
          // and denominator df for unequal variances (Prism reports both).
          { label: "F (Brown-Forsythe)", value: v.bfF },
          { label: "DFn (Brown-Forsythe)", value: v.bfDfn },
          { label: "DFd (Brown-Forsythe)", value: v.bfDfd },
          pRow("P value (Brown-Forsythe)", v.bfP),
        ]
      : [
          { label: "F", value: v.F },
          { label: "DFn", value: v.dfn },
          { label: "DFd", value: v.dfd },
          pRow("P value", v.p),
          { label: "R squared (eta squared)", value: v.eta2 },
          { label: "Cohen's f", value: v.f },
        ]),
    ...(lognormal(params) ? groups.map((g, i) => ({ label: `Geometric mean (${g.name})`, value: v[`gm${i}`] })) : []),
    ...(trend(params)
      ? [
          { label: "Slope (test for linear trend)", value: v.trSlope },
          { label: "R squared (linear trend, effect size)", value: v.trR2eff },
          { label: "R squared (linear trend, alerting)", value: v.trR2alert },
          pRow("P value (linear trend)", v.trPlin),
          ...(groups.length >= 4 ? [pRow("P value (nonlinear trend)", v.trPnonlin)] : []),
        ]
      : []),
  ],
  // One factor, so the single effect's partial eta squared is its eta
  // squared (Prism: R² = η² = partial η² in one-way ANOVA). Welch's has no
  // sums of squares, so it reports no effect-size table.
  effectSizes: (v, _groups, params) =>
    params?.effectSizes === false || welch(params)
      ? undefined
      : [
          effectSizeRow(
            "Between groups",
            v.ssB,
            v.ssE,
            (v.ssB ?? 0) + (v.ssE ?? 0),
            v.pLo,
            v.pHi,
          ),
        ],
  ratios: lognormal,
  posthoc: posthocOf,
  pairs: (groups, params) => {
    if (isIn(PAIR_CORRECTIONS, params?.posthoc)) return comparedPairs(groups, params?.compared);
    if (params?.posthoc !== "dunnett") return pairIndices(groups.length);
    const c = controlOf(groups, params);
    return groups.flatMap((_, i): [number, number][] => (i === c ? [] : [[i, c]]));
  },
  notes: (params) =>
    (lognormal(params)
      ? `Compares the groups' geometric means: the ANOVA${welch(params) ? " (Welch's and Brown-Forsythe, without assuming equal SDs)" : ""} runs on the logarithms, which it assumes normal${welch(params) ? "" : " with equal variances"}; its comparisons are ratios of geometric means.`
      : welch(params)
        ? "Compares means across groups without assuming equal SDs: Welch's ANOVA and the Brown-Forsythe ANOVA are both reported; each assumes normal distributions."
        : "Compares means across groups; assumes normal distributions with equal variances. Partial eta squared equals eta squared here (one factor).") +
    (params?.posthoc === "lsd"
      ? " Fisher's LSD is uncorrected — only interpretable when the overall ANOVA was significant."
      : "") +
    (params?.posthoc === "fdr"
      ? " The False Discovery Rate (Benjamini-Hochberg) controls the expected share of false discoveries among the comparisons called significant, rather than the chance of any false positive; no confidence intervals are reported for it."
      : "") +
    (trend(params)
      ? " The test for linear trend fits the group means against column order (1, 2, 3, …) — the columns must be in a natural order and equally spaced — and tests the linear trend against the ordinary ANOVA's residual mean square; the nonlinear trend is the rest of the between-group variation."
      : ""),
  subtitle: (params) =>
    `${lognormal(params) ? "Lognormal " : ""}${welch(params) ? "Welch's and Brown-Forsythe ANOVAs" : `${lognormal(params) ? "o" : "O"}ne-way ANOVA`}`,
};
