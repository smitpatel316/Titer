// Two-way ANOVA — compares a Grouped table's column-groups (A, B, C…) and row
// position, plus their interaction. `design` picks:
// - "ordinary": independent-samples two-way ANOVA.
// - "repeated-measures": matched by row — each replicate column is treated as
//   one subject, measured at every row within its group (a mixed/split-plot
//   design): the strata of `aov(v~g*r+Error(id/r))`, computed from the subjects' means
//   (`R_TWO_WAY`'s `sp`). Incomplete replicate columns (missing a row) are dropped. Sphericity not
//   assumed (`sphericity` false), the row and interaction effects, within subjects, take
//   the Geisser-Greenhouse epsilon of the rows' covariance pooled over the groups, and each
//   comparison its own error (`correctedPosthoc`).
// - "nonparametric": Scheirer-Ray-Hare — rank-transform the response, run the
//   same ANOVA on the ranks (Type III, so an unbalanced design doesn't depend on the
//   factors' order), then each effect's sum of squares over the ranks' total mean
//   square is a chi-square H statistic — fully computable in base R.
// `posthoc` (parametric designs only) pairwise-compares either groups within
// each row, or rows within each group ("row means"), using the design's own
// pooled residual variance — the same statistic R's own TukeyHSD computes
// internally (q = sqrt(2)*|t|, t from the pooled-MSE two-sample t stat), just
// derived directly instead of relying on TukeyHSD's interaction-term row naming.
// Each row (or each group) is a family of comparisons, corrected on its own. On the ordinary
// design, Dunnett compares each member of a family with its control (a group, or a row: the
// distribution of the largest t, `dun`, its critical value found once per family), and
// Games-Howell every pair on the two cells' own variances (Welch's t and df, against the
// studentized range). Every comparison carries its 95% CI and the two cells it compares.
// Tukey, Bonferroni, Šídák, Holm–Šídák and Fisher's LSD are offered (plan 25);
// the Šídák family adjusts in R per family, on raw P values (`R_ADJUST`).
import {
  FDR_METHODS,
  PAIR_CORRECTIONS,
  fdrQError,
  type AnalysisOutcome,
  type Column,
  type ComparedCell,
  type ComparisonRow,
  type TwoWayAnovaParams,
} from "../types";
import {
  adjustFdrPValues,
  describe,
  effectSizeRow,
  identical,
  pairIndices,
  pRow,
  R_ADJUST,
  R_CRIT,
  R_EFFECT_CI,
  R_PTUKEY,
  rStr,
  rVec,
  type FdrMethod,
} from "../column/base";
import { evalNamedVector } from "../webr";
import { R_MAXIMUM_T } from "../column/anova";
import { completeSubjects, flattenGrouped, flattenRepeated, groupRows, rowName } from "./base";

/** Short heading for a post-hoc method in a two-way comparisons label. */
const POSTHOC_LABEL_SHORT: Record<string, string> = {
  tukey: "Tukey's",
  bonferroni: "Bonferroni-corrected",
  sidak: "Šídák-corrected",
  "holm-sidak": "Holm–Šídák",
  lsd: "Fisher's LSD (uncorrected)",
  dunnett: "Dunnett's",
  "games-howell": "Games-Howell",
};

/** The FDR approach's heading: its method (Benjamini-Hochberg / two-stage
 *  Benjamini-Krieger-Yekutieli / Benjamini-Yekutieli) and its Q. */
const FDR_LABEL: Record<FdrMethod, string> = {
  bh: "Benjamini-Hochberg",
  bky: "Benjamini-Krieger-Yekutieli (two-stage)",
  by: "Benjamini-Yekutieli",
};
const fdrLabel = (method: FdrMethod, q: number) => `FDR approach (${FDR_LABEL[method]}, Q = ${q}%)`;
/** The comparisons label for a two-way post-hoc: the method's short heading,
 *  or the FDR approach's method + Q. */
const posthocLabel = (params: TwoWayAnovaParams) =>
  params.posthoc === "fdr"
    ? fdrLabel(params.fdrMethod ?? "bh", params.fdrQ ?? 5)
    : (POSTHOC_LABEL_SHORT[params.posthoc] ?? params.posthoc);

/** What the FDR approach reports in the notes: how many comparisons are
 *  discoveries at Q (adjusted P below Q). */
const fdrNote = (params: TwoWayAnovaParams, comparisons: ComparisonRow[] | undefined) => {
  if (params.posthoc !== "fdr" || !comparisons) return "";
  const q = (params.fdrQ ?? 5) / 100;
  const discoveries = comparisons.filter((c) => c.p != null && c.p < q).length;
  return (
    ` ${fdrLabel(params.fdrMethod ?? "bh", params.fdrQ ?? 5)}: ${discoveries} of ${comparisons.length} ` +
    `comparison${comparisons.length === 1 ? " is" : "s are"} discoveries (adjusted P < ${q}). ` +
    // No CI claim here: FDR comparisons carry no interval (runPosthoc and
    // the RM path both null low/high), same as the three-way note.
    "The P values are FDR-adjusted."
  );
};

/** The post-hoc methods a two-way ANOVA offers: Tukey, Bonferroni,
 *  Šídák, Holm–Šídák and Fisher's LSD, plus Dunnett and Games-Howell on the
 *  ordinary design, plus the FDR approach (raw P values, FDR-adjusted in
 *  TypeScript after R returns them). Anything else the params type allows is
 *  refused up front rather than silently run as Bonferroni. */
const TWO_WAY_POSTHOCS = [
  "none",
  "tukey",
  "bonferroni",
  "sidak",
  "holm-sidak",
  "lsd",
  "dunnett",
  "games-howell",
  "fdr",
] as const;
type Method = "tukey" | (typeof PAIR_CORRECTIONS)[number];
type OrdinaryMethod = Method | "dunnett" | "games-howell" | "fdr";
/** The method R's family machinery runs for an ordinary method: the FDR
 *  approach's raw P values are Fisher's LSD's (uncorrected, one family at a
 *  time), adjusted afterwards in TypeScript. */
const rMethodOf = (method: OrdinaryMethod): Method | "dunnett" | "games-howell" =>
  method === "fdr" ? "lsd" : method;
const corrects = (method: OrdinaryMethod) => (PAIR_CORRECTIONS as readonly string[]).includes(method);
/** R_ADJUST's `adj`/`pa` name the uncorrected method "fisher"; Titer calls it
 *  "lsd" — pass "fisher" to R, or `adj` falls through to its Holm–Šídák branch
 *  and an LSD comparison comes back Holm–Šídák-adjusted. */
const rMethod = (method: Method) => (method === "lsd" ? "fisher" : method);

/** R: a comparison's P from its t (`x`), `means` means in its family, at `df`: Tukey's, or the
 *  raw P that `byFamily` corrects with its family's; and (`ciP`) the corrected P its CI
 *  inverts, of the statistic `x` (none for Holm-Šídák: `pa` is NA). */
const pOf = (method: Method, x: string, means: number, df: string) =>
  method === "tukey" ? `ptk(abs(${x})*sqrt(2),${means},${df})` : `2*pt(-abs(${x}),${df})`;
const ciP = (method: Method, means: number, df: string) =>
  method === "tukey"
    ? pOf(method, "x", means, df)
    : `pa(x,${df},"${rMethod(method)}",${(means * (means - 1)) / 2})`;

/** R: each comparison's `c(d, P, lo, hi)` (`parts`), its P corrected with those of its family
 *  (`family`: a row, or a group) unless Tukey's, as one vector named d_k, p_k, lo_k, hi_k. */
const byFamily = (parts: string[], family: number[], method: OrdinaryMethod) =>
  `setNames({R<-rbind(${parts.join(",")});` +
  (!corrects(method) ? "" : `R[,2]<-ave(R[,2],c(${family.join(",")}),FUN=function(p)adj(p,"${rMethod(method as Method)}"));`) +
  `as.vector(t(R))},c(${parts.map((_, k) => `"d_${k}","p_${k}","lo_${k}","hi_${k}"`).join(",")}))`;

/** The pairs of a family's `count` members compared: each with the control (`control`, an
 *  index; Dunnett), else every pair. */
const familyPairs = (count: number, control?: number): [number, number][] =>
  control === undefined
    ? pairIndices(count)
    : Array.from({ length: count }, (_, i): [number, number] => [i, control]).filter(([i]) => i !== control);

// Group/row/subject labels derive from user column names, so they must be escaped
// before interpolation — only their distinctness matters to the model, not their text.
const rFactor = (labels: string[]) => `factor(c(${labels.map(rStr).join(",")}))`;

async function runPosthoc(
  columns: Column[],
  method: OrdinaryMethod,
  target: "groups" | "rows" | "cells" | "group-means" | "row-means",
  mse: number | null,
  dfResid: number | null,
  titles: (string | null)[],
  control?: string,
  fdr?: { method: FdrMethod; q: number },
): Promise<ComparisonRow[] | { error: string } | undefined> {
  if (mse == null || dfResid == null) return undefined;
  const rows = groupRows(columns);
  const names = [...rows.keys()];
  const rowCount = rows.get(names[0])?.length ?? 0;
  const rowLabels = Array.from({ length: rowCount }, (_, r) => rowName(titles, r));
  // The members a Dunnett control is picked from, by target: groups, rows, cells
  // ("Group (Row)"), marginal group means, or marginal row means.
  const cellList =
    target === "cells"
      ? names.flatMap((name) =>
          rowLabels.flatMap((label, r) =>
            rows.get(name)![r].length > 0 ? [{ group: name, row: r, label: `${name} (${label})` }] : [],
          ),
        )
      : [];
  const controlMembers =
    target === "groups" || target === "group-means"
      ? names
      : target === "rows" || target === "row-means"
        ? rowLabels
        : cellList.map((c) => c.label);
  // Dunnett's control: a group, a row, a cell, or a marginal mean, by its name.
  const controlAt =
    method !== "dunnett" ? undefined : control === undefined ? -1 : controlMembers.indexOf(control);
  if (controlAt === -1)
    return {
      error: `The control ${target === "groups" || target === "group-means" ? "group" : target === "rows" || target === "row-means" ? "row" : "cell"}${control ? ` “${control}”` : ""} holds no data. Create this analysis again to choose another.`,
    };
  // Each comparison's two cells (a group at a row) and how many means its family compares
  // (the groups holding data at its row, or the rows holding data in its group).
  const cells: {
    label1: string;
    label2: string;
    at?: [ComparedCell, ComparedCell];
    a: number[];
    b: number[];
    means: number;
    family: number;
  }[] = [];
  if (target === "groups") {
    for (let r = 0; r < rowCount; r++) {
      const means = names.filter((name) => rows.get(name)![r].length > 0).length;
      for (const [i, j] of familyPairs(names.length, controlAt)) {
        const [a, b] = [rows.get(names[i])![r], rows.get(names[j])![r]];
        if (a.length && b.length)
          cells.push({
            label1: `${names[i]} (${rowName(titles, r)})`,
            label2: `${names[j]} (${rowName(titles, r)})`,
            at: [
              { group: names[i], row: r },
              { group: names[j], row: r },
            ],
            a,
            b,
            means,
            family: r,
          });
      }
    }
  } else if (target === "rows") {
    for (const name of names) {
      const rowsForGroup = rows.get(name)!;
      const means = rowsForGroup.filter((v) => v.length > 0).length;
      for (const [i, j] of familyPairs(rowCount, controlAt)) {
        const [a, b] = [rowsForGroup[i], rowsForGroup[j]];
        if (a.length && b.length)
          cells.push({
            label1: `${rowName(titles, i)} (${name})`,
            label2: `${rowName(titles, j)} (${name})`,
            at: [
              { group: name, row: i },
              { group: name, row: j },
            ],
            a,
            b,
            means,
            family: names.indexOf(name),
          });
      }
    }
  } else if (target === "cells") {
    // Every cell mean against every other (one family), or each against the
    // control cell (Dunnett) — Prism's "compare cell means" scope.
    for (const [i, j] of familyPairs(cellList.length, controlAt)) {
      const [ci, cj] = [cellList[i], cellList[j]];
      const [a, b] = [rows.get(ci.group)![ci.row], rows.get(cj.group)![cj.row]];
      cells.push({
        label1: ci.label,
        label2: cj.label,
        at: [
          { group: ci.group, row: ci.row },
          { group: cj.group, row: cj.row },
        ],
        a,
        b,
        means: cellList.length,
        family: 0,
      });
    }
  } else if (target === "group-means") {
    // The marginal group means (main effect of the groups): each group's values
    // pooled over rows, one family. No single cell to draw a bracket on.
    const present = names.filter((name) => rows.get(name)!.some((v) => v.length > 0));
    const controlPresent = method === "dunnett" ? present.indexOf(control ?? "") : undefined;
    if (controlPresent === -1)
      return { error: `The control group “${control}” holds no data. Create this analysis again to choose another.` };
    for (const [i, j] of familyPairs(present.length, controlPresent)) {
      const [a, b] = [present[i], present[j]].map((name) => rows.get(name)!.flat());
      cells.push({ label1: present[i], label2: present[j], a, b, means: present.length, family: 0 });
    }
  } else {
    // The marginal row means (main effect of the rows): each row's values pooled
    // over groups, one family.
    const present = rowLabels.filter((_, r) => names.some((name) => rows.get(name)![r].length > 0));
    const presentRows = present.map((label) => rowLabels.indexOf(label));
    const controlPresent = method === "dunnett" ? present.indexOf(control ?? "") : undefined;
    if (controlPresent === -1)
      return { error: `The control row “${control}” holds no data. Create this analysis again to choose another.` };
    for (const [i, j] of familyPairs(present.length, controlPresent)) {
      const [ri, rj] = [presentRows[i], presentRows[j]];
      const atRow = (r: number) => names.flatMap((name) => rows.get(name)![r]);
      cells.push({ label1: present[i], label2: present[j], a: atRow(ri), b: atRow(rj), means: present.length, family: 0 });
    }
  }
  if (cells.length === 0) return undefined;
  if (method === "games-howell") {
    const flat = cells.flatMap((c) => [c.a, c.b]).find((v) => v.length < 2 || identical(v));
    if (flat)
      return {
        error:
          "Games-Howell compares each cell on its own scatter: every cell compared needs 2 values or more that vary.",
      };
  }
  // In R: each pair's difference of means, its t (on the ANOVA's mean square, or for
  // Games-Howell the two cells' own variances), its P corrected within its family, and its
  // 95% CI: the difference ± the t at which its corrected P is 0.05.
  const df = String(dfResid);
  const pooled = (c: (typeof cells)[number]) =>
    `{a<-${rVec(c.a)};b<-${rVec(c.b)};d<-mean(a)-mean(b);s<-sqrt(${mse}*(1/length(a)+1/length(b)));t<-d/s;`;
  // Dunnett: each family's weights (√(n / (n + n of its control))) and critical value, once.
  const families = [...new Set(cells.map((c) => c.family))];
  const dunnett =
    method === "dunnett"
      ? `${R_MAXIMUM_T}\n` +
        families
          .map((f) => {
            const own = cells.filter((c) => c.family === f);
            return (
              `l${f}<-sqrt(c(${own.map((c) => c.a.length).join(",")})/(c(${own.map((c) => c.a.length).join(",")})+${own[0].b.length}));` +
              `cv${f}<-crit(function(x)dun(x,l${f},${df}),qt(1-0.025/c(1,${own.length}),${df}))`
            );
          })
          .join(";") +
        ";"
      : "";
  const parts = cells.map((c) =>
    method === "dunnett"
      ? `${pooled(c)}h<-cv${c.family}*s;c(d,dun(t,l${c.family},${df}),d-h,d+h)}`
      : method === "games-howell"
        ? `{a<-${rVec(c.a)};b<-${rVec(c.b)};d<-mean(a)-mean(b);va<-var(a)/length(a);vb<-var(b)/length(b);s<-sqrt(va+vb);` +
          `w<-(va+vb)^2/(va^2/(length(a)-1)+vb^2/(length(b)-1));t<-d/s;h<-crit(function(x)ptk(x*sqrt(2),${c.means},w))*s;` +
          `c(d,ptk(abs(t)*sqrt(2),${c.means},w),d-h,d+h)}`
        : `${pooled(c)}h<-crit(function(x)${ciP(rMethodOf(method) as Method, c.means, df)})*s;c(d,${pOf(rMethodOf(method) as Method, "t", c.means, df)},d-h,d+h)}`,
  );
  const v = await evalNamedVector(
    `${R_PTUKEY};${R_CRIT};${R_ADJUST};${dunnett}c(${byFamily(
      parts,
      cells.map((c) => c.family),
      rMethodOf(method),
    )})`,
  );
  // No multiplicity-adjusted interval exists for the FDR approach (as for
  // Holm–Šídák, whose `pa` is NA) — the comparison carries no CI rather
  // than the unadjusted LSD interval its P values no longer match.
  const comparisons = cells.map((c, k) => ({
    group1: c.label1,
    group2: c.label2,
    ...(c.at ? { cells: c.at } : {}),
    diff: v[`d_${k}`] ?? null,
    low: method === "fdr" ? null : (v[`lo_${k}`] ?? null),
    high: method === "fdr" ? null : (v[`hi_${k}`] ?? null),
    p: v[`p_${k}`] ?? null,
  }));
  if (method !== "fdr" || !fdr) return comparisons;
  // The FDR approach: R returned Fisher's LSD's raw P values (one family at a
  // time); each family's are adjusted here, in TypeScript.
  for (const family of [...new Set(cells.map((c) => c.family))]) {
    const idx = cells.map((c, i) => (c.family === family ? i : -1)).filter((i) => i >= 0);
    const adjusted = adjustFdrPValues(
      idx.map((i) => comparisons[i].p),
      fdr.method,
      fdr.q,
    );
    idx.forEach((i, k) => {
      comparisons[i] = { ...comparisons[i], p: adjusted[k] };
    });
  }
  return comparisons;
}

/** R comparing the cells of a repeated-measures design without assuming sphericity (`Y`:
 *  a subject per row, a table row per column; `gs`: each subject's group), each comparison on
 *  its own error, never the whole experiment's: rows within a group, a paired t on that
 *  group's differences (n − 1 df); groups within a row, that row's pooled SD. */
function correctedPosthoc(
  method: Method | "fdr",
  target: "groups" | "rows",
  groupNames: string[],
  rowNames: string[],
  rowIndex: number[],
): {
  rCode: string;
  labels: [string, string][];
  cells: [ComparedCell, ComparedCell][];
  family: number[];
} {
  const labels: [string, string][] = [];
  const cells: [ComparedCell, ComparedCell][] = [];
  const parts: string[] = [];
  const family: number[] = [];
  // The FDR approach runs on Fisher's LSD's raw P values here, adjusted
  // afterwards in TypeScript (same as the ordinary design's runPosthoc).
  const rMethod: Method = method === "fdr" ? "lsd" : method;
  // With its t (`t`) and standard error (`s`): its difference, its P, and its 95% CI, the
  // difference ± the t at which its corrected P is 0.05.
  const ci = (diff: string, means: number, df: string) =>
    `{dd<-${diff};h<-crit(function(x)${ciP(rMethod, means, df)})*s;c(dd,${pOf(rMethod, "t", means, df)},dd-h,dd+h)}`;
  if (target === "rows") {
    for (const g of groupNames)
      for (const [i, j] of pairIndices(rowNames.length)) {
        labels.push([`${rowNames[i]} (${g})`, `${rowNames[j]} (${g})`]);
        cells.push([
          { group: g, row: rowIndex[i] },
          { group: g, row: rowIndex[j] },
        ]);
        parts.push(
          `{a<-Y[gs==${rStr(g)},${i + 1}];b<-Y[gs==${rStr(g)},${j + 1}];d<-a-b;n<-length(d);` +
            `s<-sd(d)/sqrt(n);t<-abs(mean(d))/s;${ci("mean(a)-mean(b)", rowNames.length, "n-1")}}`,
        );
        family.push(groupNames.indexOf(g));
      }
  } else {
    rowNames.forEach((row, r) => {
      for (const [i, j] of pairIndices(groupNames.length)) {
        const [a, b] = [groupNames[i], groupNames[j]];
        labels.push([`${a} (${row})`, `${b} (${row})`]);
        cells.push([
          { group: a, row: rowIndex[r] },
          { group: b, row: rowIndex[r] },
        ]);
        parts.push(
          `{e<-Y[,${r + 1}];m<-tapply(e,gs,mean);k<-tapply(e,gs,length);dfe<-length(e)-nlevels(gs);` +
            `mse<-sum((e-m[gs])^2)/dfe;s<-sqrt(mse*(1/k[[${rStr(a)}]]+1/k[[${rStr(b)}]]));` +
            `t<-abs(m[[${rStr(a)}]]-m[[${rStr(b)}]])/s;${ci(`m[[${rStr(a)}]]-m[[${rStr(b)}]]`, groupNames.length, "dfe")}}`,
        );
        family.push(r);
      }
    });
  }
  const rCode = byFamily(parts, family, rMethod);
  return { rCode, labels, cells, family };
}

/** The error when every value is the same, or when the model leaves no scatter to test
 *  the effects on (R's `flat`: a residual sum of squares of 0 next to the total's). */
const NOTHING_VARIES = "All the values are identical: there is no scatter to test the effects on.";
const NO_SCATTER =
  "The values follow their groups and rows exactly, with no scatter left around them: the effects can't be tested.";
const R_FLAT = (resid: string) => `${resid}<=1e-20*sum((v-mean(v))^2)`;

/** R: the sums of squares of a two-way design from its cells' counts and means, never a model
 *  matrix of one column per row (which made 500 rows take a minute); the same numbers as
 *  `aov` and `drop1` (tests/reference.ts checks them on unbalanced designs).
 *  `add2(n, mu)`: what the additive model leaves of the cell means, weighted by counts (NA
 *  when groups and rows don't overlap enough to tell their effects apart).
 *  `tw(v, g, r, inter)`: each effect's sum of squares, Type III (every cell filled: a main
 *  effect tests its unweighted means, the interaction what the additive model leaves),
 *  or, without the interaction, the additive model's (Type II = III); the residual's, its df.
 *  `sp(Y, gs)`: a split-plot (subjects in groups, each at every row) in the strata of
 *  `aov(v ~ g * r + Error(id / r))`: `e1` between subjects (groups, residual), `e2` within
 *  (rows, interaction, residual). */
export const R_TWO_WAY = `add2<-function(n,mu){G<-nrow(n);ng<-rowSums(n);nr<-colSums(n);mu[n==0]<-0;W<-n%*%diag(1/nr,length(nr))
S<-diag(ng,G)-W%*%t(n);b<-rowSums(n*mu)-W%*%colSums(n*mu);q<-qr(S[-1,-1,drop=FALSE])
if(q$rank<G-1)return(NA);a<-c(0,qr.coef(q,b[-1]));be<-colSums(n*(mu-a))/nr;sum(n*(mu-outer(a,be,"+"))^2)}
tw<-function(v,g,r,inter){n<-unclass(table(g,r));mu<-tapply(v,list(g,r),mean);G<-nrow(n);R<-ncol(n)
one<-function(m,w){W<-1/w;sum(W*(m-sum(W*m)/sum(W))^2)}
if(inter)return(c(g=one(rowMeans(mu),rowSums(1/n)/R^2),r=one(colMeans(mu),colSums(1/n)/G^2),i=add2(n,mu),
e=sum((v-mu[cbind(as.integer(g),as.integer(r))])^2),dfe=length(v)-G*R))
e<-add2(n,mu);c(g=sum((v-ave(v,r))^2)-e,r=sum((v-ave(v,g))^2)-e,e=e,dfe=length(v)-G-R+1)}
sp<-function(Y,gs){R<-ncol(Y);N<-nrow(Y);G<-nlevels(gs);k<-as.integer(gs);s<-rowMeans(Y);m<-mean(Y)
ng<-as.vector(table(gs));mg<-as.vector(tapply(s,gs,mean));mr<-colMeans(Y);mgr<-apply(Y,2,function(y)tapply(y,gs,mean))
st<-function(S,D){Q<-S/D;n<-length(S);f<-c(Q[-n]/Q[n],NA)
data.frame(Df=D,"Sum Sq"=S,"F value"=f,"Pr(>F)"=pf(f,D,D[n],lower.tail=FALSE),check.names=FALSE)}
list(e1=st(c(R*sum(ng*(mg-m)^2),R*sum((s-mg[k])^2)),c(G-1,N-G)),
e2=st(c(N*sum((mr-m)^2),sum(ng*(sweep(sweep(mgr,1,mg),2,mr)+m)^2),sum((Y-s-mgr[k,,drop=FALSE]+mg[k])^2)),
c(R-1,(G-1)*(R-1),(N-G)*(R-1))))}`;

async function runRepeatedMeasures(
  columns: Column[],
  params: TwoWayAnovaParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  // Cell and marginal-mean comparisons need the ordinary design's pooled
  // residual: a repeated-measures comparison has no single error term for
  // them (each of its comparisons carries its own).
  if (params.posthoc !== "none" && params.posthocTarget !== "groups" && params.posthocTarget !== "rows") {
    return {
      error:
        `“${params.posthocTarget}” comparisons follow the ordinary two-way ANOVA, not the repeated-measures one — ` +
        "choose groups within each row, or rows within each group.",
    };
  }
  const { values, group, row, subject, dropped } = flattenRepeated(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2 || values.length === 0) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs at least 2 column groups and 2 rows, each with at least one " +
        "replicate column that has a value in every row.",
    };
  }
  // The groups' effect is tested on the subjects' scatter within groups: one group at least
  // needs two subjects.
  if (identical(values)) return { error: NOTHING_VARIES };
  const subjectsOf = (g: string) => new Set(subject.filter((_, i) => group[i] === g)).size;
  const groupNames = [...new Set(group)];
  if (groupNames.every((g) => subjectsOf(g) < 2)) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs at least one group with 2 replicate columns holding a value in " +
        "every row: each group here has one.",
    };
  }
  const corrected = params.sphericity === false;
  // The kept rows, in order (each subject holds one value at each); their display names.
  const rowKeys = [...new Set(row)];
  const rowNames = rowKeys.map((key) => rowName(titles, Number(key.slice(1)) - 1));
  // One complete subject per group in every group leaves no residual degrees
  // of freedom (nrow(Y) == nlevels(gs)): the pooled covariance's denominator
  // is 0 and pf() gets a NULL df. Refuse up front instead of crashing in R.
  if (new Set(subject).size <= groupNames.length) {
    return {
      error:
        "Repeated-measures two-way ANOVA needs more complete subjects than column groups — " +
        "with only one complete subject in every group there is no residual variation to estimate " +
        "the Geisser-Greenhouse correction from.",
    };
  }
  const setup = `${R_EFFECT_CI};${R_PTUKEY};${R_CRIT};${R_ADJUST};v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)};id<-${rFactor(subject)}`;
  // Y: a subject per row (values come subject by subject, rows in order); gs its group.
  // Geisser-Greenhouse: epsilon of the rows' covariance pooled over the groups, double-centered.
  // A zero denominator means the differences have no variance at all (sphericity holds
  // exactly) — epsilon is 1, never 0/0. A group with a single complete subject
  // contributes a zero matrix, not (length(i)-1)*cov(...): cov() of one row is all
  // NA, and 0 * NA is NA in R, which would poison S, C and the epsilon test.
  const q = rowKeys.length;
  const gg =
    `Y<-matrix(v,ncol=${q},byrow=TRUE);gs<-factor(g[seq(1,length(v),by=${q})]);` +
    `S<-Reduce("+",lapply(split(seq_len(nrow(Y)),gs),function(i)if(length(i)>1)(length(i)-1)*cov(Y[i,,drop=FALSE])else matrix(0,${q},${q})))/(nrow(Y)-nlevels(gs));` +
    `H<-diag(${q})-1/${q};C<-H%*%S%*%H;ggd<-(${q - 1})*sum(C*C);e<-if(ggd>0)min(1,sum(diag(C))^2/ggd)else 1`;
  const within = (k: string, f: string, df: string, resid: string, p: string) =>
    corrected
      ? `${k}S=${f},${k}Df=e*${df},${k}DfResid=e*${resid},${k}P=pf(${f},e*${df},e*${resid},lower.tail=FALSE)`
      : `${k}S=${f},${k}Df=${df},${k}DfResid=${resid},${k}P=${p}`;
  // Partial eta squared (seq 161) per effect: each effect's SS over itself
  // plus its own error stratum's SS — Group on the between-subjects error
  // (e1's residual), Row and Interaction on the within-subjects error (e2's
  // residual) — with its 95% CI from the F statistic's noncentrality
  // (`etaCI`, N = total observations); the Geisser-Greenhouse correction,
  // when on, uses the corrected degrees of freedom for Row/Interaction.
  const ecG = `ecG<-etaCI(if(gf)NA else e1$"F value"[1],e1$Df[1],e1$Df[2],length(v))`;
  const ecR = `ecR<-etaCI(e2$"F value"[1],${corrected ? "e*e2$Df[1]" : "e2$Df[1]"},${corrected ? "e*e2$Df[3]" : "e2$Df[3]"},length(v))`;
  const ecI = `ecI<-etaCI(e2$"F value"[2],${corrected ? "e*e2$Df[2]" : "e2$Df[2]"},${corrected ? "e*e2$Df[3]" : "e2$Df[3]"},length(v))`;
  const posthoc =
    corrected && params.posthoc !== "none"
      ? correctedPosthoc(
          params.posthoc as Method | "fdr",
          params.posthocTarget as "groups" | "rows",
          // Rows within a group are compared on its subjects' differences: two at least.
          params.posthocTarget === "rows" ? groupNames.filter((g) => subjectsOf(g) > 1) : groupNames,
          rowNames,
          rowKeys.map((key) => Number(key.slice(1)) - 1),
        )
      : undefined;
  const rCode =
    `${setup};${R_TWO_WAY};Y<-matrix(v,ncol=${q},byrow=TRUE);gs<-factor(g[seq(1,length(v),by=${q})]);` +
    `a<-sp(Y,gs);e1<-a$e1;e2<-a$e2;` +
    // No scatter within subjects: nothing is testable. Between subjects only (each group's
    // subjects alike on average): the groups' effect alone isn't.
    `if(${R_FLAT('e2$"Sum Sq"[3]')})c(flat=1) else{gf<-${R_FLAT('e1$"Sum Sq"[2]')};` +
    `${gg};${ecG};${ecR};${ecI};c(gflat=gf,gS=if(gf)NA else e1$"F value"[1],gDf=e1$Df[1],gP=if(gf)NA else e1$"Pr(>F)"[1],gDfResid=e1$Df[2],gMse=if(gf)NA else e1$"Sum Sq"[2]/e1$Df[2],` +
    `${within("r", 'e2$"F value"[1]', "e2$Df[1]", "e2$Df[3]", 'e2$"Pr(>F)"[1]')},` +
    `${within("i", 'e2$"F value"[2]', "e2$Df[2]", "e2$Df[3]", 'e2$"Pr(>F)"[2]')},` +
    `gSS=e1$"Sum Sq"[1],e1SS=e1$"Sum Sq"[2],rSS=e2$"Sum Sq"[1],iSS=e2$"Sum Sq"[2],e2SS=e2$"Sum Sq"[3],` +
    `gLo=ecG[1],gHi=ecG[2],rLo=ecR[1],rHi=ecR[2],iLo=ecI[1],iHi=ecI[2],` +
    `rMse=e2$"Sum Sq"[3]/e2$Df[3],eps=e${posthoc ? "," + posthoc.rCode : ""})}`;

  const v = await evalNamedVector(rCode);
  if (v.flat != null) return { error: NO_SCATTER };
  const effect = (label: string, k: string) => [
    { label: `${label} F`, value: v[`${k}S`] ?? null },
    { label: `${label} DFn`, value: v[`${k}Df`] ?? null },
    ...(corrected && k !== "g" ? [{ label: `${label} DFd`, value: v[`${k}DfResid`] ?? null }] : []),
    pRow(`${label} P value`, v[`${k}P`] ?? null),
  ];
  const stats = [
    ...effect("Group", "g"),
    ...effect("Row", "r"),
    ...effect("Interaction", "i"),
    ...(corrected ? [{ label: "Geisser-Greenhouse epsilon", value: v.eps ?? null }] : []),
  ];
  const { groups } = await describe(
    [...new Set(group)].map((name) => ({ name, values: values.filter((_, i) => group[i] === name) })),
  );
  // Groups (between-subjects) comparisons use the "Error: id" stratum's residual;
  // rows (within-subject) comparisons use the "Error: id:r" stratum's — an
  // approximation of Prism's exact RM multiple-comparisons SE, using each effect's
  // own pooled error term.
  const mse = params.posthocTarget === "groups" ? v.gMse : v.rMse;
  const dfResid = params.posthocTarget === "groups" ? v.gDfResid : v.rDfResid;
  const comparisons = posthoc
    ? posthoc.labels.map(([group1, group2], k): ComparisonRow => ({
        group1,
        group2,
        cells: posthoc.cells[k],
        diff: v[`d_${k}`] ?? null,
        // No multiplicity-adjusted interval exists for the FDR approach —
        // the comparison carries no CI rather than the unadjusted LSD
        // interval its P values no longer match (same as runPosthoc).
        low: params.posthoc === "fdr" ? null : (v[`lo_${k}`] ?? null),
        high: params.posthoc === "fdr" ? null : (v[`hi_${k}`] ?? null),
        p: v[`p_${k}`] ?? null,
      }))
    : params.posthoc !== "none"
      ? ((await runPosthoc(
          // The subjects the ANOVA kept: comparisons are of the same means.
          // Dunnett / Games-Howell are refused for repeated measures before dispatch.
          completeSubjects(columns).subjects,
          params.posthoc as OrdinaryMethod,
          params.posthocTarget as "groups" | "rows",
          mse ?? null,
          dfResid ?? null,
          titles,
          params.control,
          params.posthoc === "fdr"
            ? { method: params.fdrMethod ?? "bh", q: params.fdrQ ?? 5 }
            : undefined,
        )) as ComparisonRow[] | undefined)
      : undefined;
  // The FDR approach on the Geisser-Greenhouse path: the corrected comparisons
  // came back with Fisher's LSD's raw P values — adjust each family here.
  if (posthoc && params.posthoc === "fdr" && comparisons) {
    for (const family of [...new Set(posthoc.family)]) {
      const idx = posthoc.family.map((f, i) => (f === family ? i : -1)).filter((i) => i >= 0);
      const adjusted = adjustFdrPValues(
        idx.map((i) => comparisons[i].p),
        params.fdrMethod ?? "bh",
        params.fdrQ ?? 5,
      );
      idx.forEach((i, k) => {
        comparisons[i] = { ...comparisons[i], p: adjusted[k] };
      });
    }
  }
  // Each effect against its own error stratum (see the `etaCI` note above).
  const ssTotal = (v.gSS ?? 0) + (v.e1SS ?? 0) + (v.rSS ?? 0) + (v.iSS ?? 0) + (v.e2SS ?? 0);
  const effectSizes =
    params.effectSizes === false
      ? undefined
      : [
          effectSizeRow("Group", v.gSS, v.e1SS, ssTotal, v.gLo, v.gHi),
          effectSizeRow("Row", v.rSS, v.e2SS, ssTotal, v.rLo, v.rHi),
          effectSizeRow("Interaction", v.iSS, v.e2SS, ssTotal, v.iLo, v.iHi),
        ];
  return {
    testType: "two-way-anova",
    subtitle: "Repeated-measures two-way ANOVA",
    stats,
    groups,
    effectSizes,
    notes:
      "Matched by row: each replicate column is treated as the same subject across every row within its group. " +
      (corrected
        ? "Sphericity not assumed: the Geisser-Greenhouse epsilon corrects the degrees of freedom of the row and " +
          "interaction effects" +
          (posthoc
            ? ", and each comparison has its own error (rows within a group: a paired t test; groups within a row: " +
              "that row's pooled SD)."
            : ".")
        : "Assumes sphericity (no Geisser-Greenhouse correction).") +
      (v.gflat === 1
        ? " Each group's subjects have the same mean over the rows: the groups' effect has no scatter to be tested on."
        : "") +
      (posthoc && params.posthocTarget === "rows"
        ? groupNames
            .filter((g) => subjectsOf(g) < 2)
            .map((g) => ` “${g}” has one subject: its rows can't be compared.`)
            .join("")
        : "") +
      (dropped > 0
        ? ` ${dropped} replicate column${dropped === 1 ? "" : "s"} excluded (missing a value in at least one row).`
        : "") + fdrNote(params, comparisons),
    comparisons,
    comparisonsLabel: comparisons?.length
      ? `${posthocLabel(params)} multiple comparisons ` +
        (params.posthocTarget === "groups"
          ? "(groups within each row, each row a family)"
          : "(rows within each group, each group a family)")
      : undefined,
  };
}

export async function runTwoWayAnova(
  columns: Column[],
  params: TwoWayAnovaParams,
  titles: (string | null)[],
): Promise<AnalysisOutcome> {
  // A partial params object still runs with the missing fields defaulted
  // (BUG-REPORT #26): without this, `{ design: "ordinary" }` was refused
  // with a "“undefined” multiple comparisons" error, and a wholly missing
  // params object threw. Defaults match the wizard's finish.
  params = {
    design: "ordinary",
    posthoc: "none",
    posthocTarget: "groups",
    ...(params as Partial<TwoWayAnovaParams>),
  };
  if (!(TWO_WAY_POSTHOCS as readonly string[]).includes(params.posthoc)) {
    return {
      error:
        `“${params.posthoc}” multiple comparisons are not available for two-way ANOVA — ` +
        `choose Tukey, Bonferroni, Šídák, Holm–Šídák, Fisher's LSD, Dunnett, Games-Howell or the FDR approach.`,
    };
  }
  if (params.posthoc === "fdr") {
    if (params.fdrMethod !== undefined && !(FDR_METHODS as readonly string[]).includes(params.fdrMethod)) {
      return {
        error: `“${params.fdrMethod}” is not an FDR method — choose Benjamini-Hochberg, Benjamini-Krieger-Yekutieli or Benjamini-Yekutieli.`,
      };
    }
    const qError = params.fdrQ === undefined ? undefined : fdrQError(params.fdrQ);
    if (qError) return { error: qError };
  }
  const TARGET_LABELS: Record<TwoWayAnovaParams["posthocTarget"], string> = {
    groups: "groups within each row, each row a family",
    rows: "rows within each group, each group a family",
    cells: "every cell mean against every other cell mean, one family",
    "group-means": "group means averaged over rows (main effect of the groups), one family",
    "row-means": "row means averaged over groups (main effect of the rows), one family",
  };
  const targetLabel = TARGET_LABELS[params.posthocTarget];
  if (targetLabel === undefined) {
    return {
      error:
        `“${params.posthocTarget}” is not a two-way comparison scope — choose groups within each row, rows within ` +
        "each group, every cell mean, group means or row means.",
    };
  }
  // One value per cell (a group at a row): the interaction can't be told from scatter, so
  // only the ordinary ANOVA runs, without it (as Prism does).
  const replicated = [...groupRows(columns).values()].some((rows) => rows.some((cell) => cell.length > 1));
  if (!replicated && params.design !== "ordinary") {
    return { error: "With one value per cell (no replicates), only the ordinary two-way ANOVA can run." };
  }
  if (params.design === "repeated-measures") {
    if (params.posthoc === "dunnett" || params.posthoc === "games-howell")
      return { error: `Dunnett's / Games-Howell follows the ordinary two-way ANOVA, not the repeated-measures one.` };
    return runRepeatedMeasures(columns, params, titles);
  }

  const { values, group, row } = flattenGrouped(columns);
  if (new Set(group).size < 2 || new Set(row).size < 2) {
    return { error: "Two-way ANOVA needs at least 2 column groups and 2 rows of numeric data." };
  }
  // With the interaction, each group's mean at each row is a parameter: a group without a
  // value at a row leaves the effects undefined (Type III).
  const groupNames = [...new Set(group)];
  const rowKeys = [...new Set(row)];
  if (replicated) {
    for (const g of groupNames)
      for (const r of rowKeys)
        if (!values.some((_, i) => group[i] === g && row[i] === r))
          return {
            error:
              `“${g}” has no value at row “${rowName(titles, Number(r.slice(1)) - 1)}”: two-way ANOVA needs ` +
              "each group to hold a value in each row.",
          };
  }
  const parameters = replicated ? groupNames.length * rowKeys.length : groupNames.length + rowKeys.length - 1;
  if (values.length <= parameters) {
    return {
      error: `Two-way ANOVA needs more values than its ${parameters} means and effects: the table holds ${values.length}.`,
    };
  }
  if (identical(values)) return { error: NOTHING_VARIES };
  const nonparametric = params.design === "nonparametric";
  const setup = `${R_EFFECT_CI};v<-${rVec(values)};g<-${rFactor(group)};r<-${rFactor(row)}`;
  const rCode = nonparametric
    ? // Each effect's Type III sum of squares on the ranks (as the ordinary ANOVA's, so an
      // unbalanced design gives the same H whatever the factors' order), over the ranks'
      // total mean square.
      `${setup};${R_TWO_WAY};k<-rank(v);s<-tw(k,g,r,TRUE);h<-s[1:3]/var(k);d<-c(nlevels(g)-1,nlevels(r)-1);d[3]<-d[1]*d[2];` +
      `c(gS=h[[1]],gDf=d[1],gP=pchisq(h[[1]],d[1],lower.tail=FALSE),` +
      `rS=h[[2]],rDf=d[2],rP=pchisq(h[[2]],d[2],lower.tail=FALSE),` +
      `iS=h[[3]],iDf=d[3],iP=pchisq(h[[3]],d[3],lower.tail=FALSE))`
    : // Type III sums of squares (Prism's on unbalanced designs; on balanced ones Type
      // I = II = III), each effect's F on the residual mean square. Partial eta
      // squared (seq 161) per effect — SS_effect / (SS_effect + SS_error) —
      // with its 95% CI from the F statistic's noncentrality (`etaCI`,
      // N = total observations); the sums of squares ride along for eta
      // squared (SS_effect / SS_total) and Cohen's f.
      `${setup};${R_TWO_WAY};s<-tw(v,g,r,${replicated ? "TRUE" : "FALSE"});` +
      `if(is.na(s[["e"]]))c(apart=1) else if(${R_FLAT('s[["e"]]')})c(flat=1) else{` +
      `dfr<-s[["dfe"]];mse<-s[["e"]]/dfr;d<-c(nlevels(g)-1,nlevels(r)-1);d[3]<-d[1]*d[2];` +
      `f<-s[c("g","r"${replicated ? ',"i"' : ""})]/d[1:${replicated ? 3 : 2}]/mse;p<-pf(f,d[seq_along(f)],dfr,lower.tail=FALSE);` +
      `ec<-t(sapply(seq_along(f),function(k)etaCI(f[k],d[k],dfr,length(v))));` +
      `c(gS=f[[1]],gDf=d[1],gP=p[[1]],rS=f[[2]],rDf=d[2],rP=p[[2]],` +
      (replicated ? `iS=f[[3]],iDf=d[3],iP=p[[3]],` : "") +
      `dfResid=dfr,mse=mse,gSS=s[["g"]],rSS=s[["r"]],eSS=s[["e"]],` +
      (replicated ? `iSS=s[["i"]],` : "") +
      `gLo=ec[1,1],gHi=ec[1,2],rLo=ec[2,1],rHi=ec[2,2]` +
      (replicated ? `,iLo=ec[3,1],iHi=ec[3,2]` : "") +
      `)}`;

  const v = await evalNamedVector(rCode);
  if (v.flat != null) return { error: NO_SCATTER };
  if (v.apart != null)
    return {
      error:
        "The groups and rows don't share enough cells to tell their effects apart: fill some cells where they meet.",
    };
  const stat = nonparametric ? "H" : "F";
  const effect = (label: string, s: string, df: string, p: string) => [
    { label: `${label} ${stat}`, value: v[s] ?? null },
    { label: `${label} DFn`, value: v[df] ?? null },
    pRow(`${label} P value`, v[p] ?? null),
  ];
  const stats = [
    ...effect("Group", "gS", "gDf", "gP"),
    ...effect("Row", "rS", "rDf", "rP"),
    ...(replicated ? effect("Interaction", "iS", "iDf", "iP") : []),
    ...(nonparametric ? [] : [{ label: "DFd (residual)", value: v.dfResid ?? null }]),
  ];
  // Scheirer-Ray-Hare's H statistics carry no sums of squares, so no
  // effect-size table; the parametric designs get one per effect.
  const ssTotal = (v.gSS ?? 0) + (v.rSS ?? 0) + (v.iSS ?? 0) + (v.eSS ?? 0);
  const effectSizes =
    nonparametric || params.effectSizes === false
      ? undefined
      : [
          effectSizeRow("Group", v.gSS, v.eSS, ssTotal, v.gLo, v.gHi),
          effectSizeRow("Row", v.rSS, v.eSS, ssTotal, v.rLo, v.rHi),
          ...(replicated ? [effectSizeRow("Interaction", v.iSS, v.eSS, ssTotal, v.iLo, v.iHi)] : []),
        ];
  const { groups } = await describe(
    [...new Set(group)].map((name) => ({ name, values: values.filter((_, i) => group[i] === name) })),
  );
  const posthoc =
    replicated && !nonparametric && params.posthoc !== "none"
      ? await runPosthoc(
          columns,
          params.posthoc as OrdinaryMethod,
          params.posthocTarget,
          v.mse,
          v.dfResid,
          titles,
          params.control,
          params.posthoc === "fdr"
            ? { method: params.fdrMethod ?? "bh", q: params.fdrQ ?? 5 }
            : undefined,
        )
      : undefined;
  if (posthoc && "error" in posthoc) return posthoc;
  const comparisons = posthoc;
  return {
    testType: "two-way-anova",
    subtitle: nonparametric ? "Scheirer-Ray-Hare test" : "Ordinary two-way ANOVA",
    stats,
    groups,
    effectSizes,
    notes:
      (nonparametric
        ? "Non-parametric two-way analysis (rank-based); no normality assumption."
        : replicated
          ? "Compares group and row-position effects, plus their interaction; assumes normal distributions with equal variances (Type III sums of squares)."
          : "One value per cell (no replicates): the interaction can't be told apart from random scatter, so the model " +
            "assumes there is none and tests the group and row effects only; if there is an interaction, their P values " +
            "mean little. Comparisons within rows or groups need replicates. Assumes normal distributions with equal variances.") +
      fdrNote(params, comparisons),
    comparisons,
    comparisonsLabel: comparisons?.length ? `${posthocLabel(params)} multiple comparisons (${targetLabel})` : undefined,
  };
}
