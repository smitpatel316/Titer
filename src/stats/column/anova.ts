// One-way ANOVA — compares the means of three or more groups: the ordinary ANOVA (equal SDs:
// F, and R² as eta squared) or Welch's (unequal SDs: `oneway.test`). Optionally followed by
// comparisons of every pair (Tukey, Bonferroni; with unequal SDs Games-Howell or Dunnett's T3)
// or of each group with a control (Dunnett). Dunnett's and T3's P values are exact: the
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
  if (isIn(PAIR_CORRECTIONS, p.posthoc)) {
    // The pairs compared (all, or those chosen), each t on the pooled SD, its P corrected
    // for them alone (`adj`), its CI from the same correction (`pa`).
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
          ...(how === "holm-sidak" ? [] : [ciAt(`${i}_${j}`, diff(i, j), pooled(i, j), "cv")]),
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
    const g = groups.map((_, i) => `g${i}`);
    const logs = lognormal(p) ? `;${g.map((x) => `${x}<-log(${x})`).join(";")};v<-log(v)` : "";
    const setup =
      `${R_EFFECT_CI};${groupsSetup(groups)}${logs};G<-list(${g.join(",")});` +
      `n<-lengths(G);m<-sapply(G,mean);s2<-sapply(G,var);a<-summary(aov(v~gr))[[1]]`;
    const main = welch(p)
      ? `w<-oneway.test(v~gr,var.equal=FALSE);r<-c(F=unname(w$statistic),dfn=unname(w$parameter[1]),dfd=unname(w$parameter[2]),p=w$p.value)`
      : // Partial eta squared (seq 161) equals eta squared here — one factor, so
        // R² = η² = partial η² (Prism's ANOVA guide) — with its 95% CI from
        // the F statistic's noncentrality (`etaCI`, N = total observations).
        // Welch's has no sums-of-squares decomposition, so it reports none.
        `ec<-etaCI(a$"F value"[1],a$Df[1],a$Df[2],sum(n));r<-c(F=a$"F value"[1],dfn=a$Df[1],dfd=a$Df[2],p=a$"Pr(>F)"[1],eta2=a$"Sum Sq"[1]/sum(a$"Sum Sq"),pLo=ec[1],pHi=ec[2],ssB=a$"Sum Sq"[1],ssE=a$"Sum Sq"[2]);r["f"]<-sqrt(r["eta2"]/(1-r["eta2"]))`;
    const geometric = lognormal(p) ? `;r<-c(r,setNames(exp(m),paste0("gm",0:${groups.length - 1})))` : "";
    if (p.posthoc === "none") return `${setup};${main}${geometric};r`;
    const ph = comparisons(groups, p);
    if (!lognormal(p)) return `${setup};${main}\n${ph.setup}\nc(r,${ph.values})`;
    const ratios = anovaSpec.pairs!(groups, p).map(([i, j]) => `r_${i}_${j}=exp(m[${i + 1}]-m[${j + 1}])`);
    return (
      `${setup};${main}${geometric}\n${ph.setup}\nout<-c(r,${ph.values},${ratios.join(",")});` +
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
    lognormal(params)
      ? `Compares the groups' geometric means: the ANOVA${welch(params) ? " (Welch's, without assuming equal SDs)" : ""} runs on the logarithms, which it assumes normal${welch(params) ? "" : " with equal variances"}; its comparisons are ratios of geometric means.`
      : (welch(params)
          ? "Compares means across groups without assuming equal SDs (Welch's ANOVA); assumes normal distributions."
          : "Compares means across groups; assumes normal distributions with equal variances. Partial eta squared equals eta squared here (one factor).") +
        (params?.posthoc === "lsd"
          ? " Fisher's LSD is uncorrected — only interpretable when the overall ANOVA was significant."
          : ""),
  subtitle: (params) =>
    `${lognormal(params) ? "Lognormal " : ""}${welch(params) ? "Welch's ANOVA" : `${lognormal(params) ? "o" : "O"}ne-way ANOVA`}`,
};
