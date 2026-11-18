// Contingency-table analysis: Pearson's chi-square test, with Fisher's exact test
// used automatically for 2×2 tables (more accurate for small samples — Prism's
// default there), and the chi-square test for trend (Cochran–Armitage) on a
// qualifying 2×k / k×2 table when the user confirms the categories are ordered
// and equally spaced. Each data column holding counts is a group; each row is a
// category. The count matrix is built from complete rows (every group column
// filled) and the whole test is one WebR round-trip returning a flat named vector.
import type { AnalysisOutcome, ChiSquareParams, Column, StatRow } from "../types";
import { buildContingencyMatrix } from "./common";
import { pairedGroups } from "../column/base";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

type Test = NonNullable<ChiSquareParams["test"]>;

const SUBTITLES: Record<Test, string> = {
  fisher: "Fisher's exact test",
  yates: "Chi-square test with Yates' correction",
  "chi-square": "Pearson's chi-square test",
  trend: "Chi-square test for trend",
};

/** R: `wil(x, n)`, the Wilson score 95% CI of the proportion x / n. */
const R_WILSON =
  "wil<-function(x,n){z<-qnorm(0.975);p<-x/n;c0<-(p+z^2/(2*n))/(1+z^2/n);h<-z*sqrt(p*(1-p)/n+z^2/(4*n^2))/(1+z^2/n);c(c0-h,c0+h)}";

export async function runChiSquare(columns: Column[], params?: ChiSquareParams): Promise<AnalysisOutcome> {
  const built = buildContingencyMatrix(columns);
  if ("error" in built) return built;
  const { matrix, rows, cols } = built;
  const groups = pairedGroups(columns);
  const flat = matrix.flat();
  const is2x2 = rows === 2 && cols === 2;
  const test: Test = params?.test ?? (is2x2 ? "fisher" : "chi-square");
  if ((test === "fisher" || test === "yates") && !is2x2)
    return { error: `${SUBTITLES[test]} is for a 2 × 2 table; this one is ${rows} × ${cols}.` };
  // Fisher's exact test sums the probability of every table with these margins: beyond
  // ten million subjects, more than R can hold. (fisher.test runs for the odds ratio
  // even when the chi-square is the chosen P source, so the cap applies either way.)
  const total = flat.reduce((a, v) => a + v, 0);
  if (is2x2 && total > 1e7)
    return { error: `Fisher's exact test takes up to 10,000,000 subjects in all; this table holds ${num(total)}.` };

  // The trend test has one direction: 2 columns × ≥3 rows trends across rows
  // on the first column's proportion; ≥3 columns × 2 rows trends across
  // columns on the first row's proportion. A 2×2 has no trend (1 df trend =
  // the association itself) and a 3×3 has no single trend direction.
  const trendAcrossRows = !is2x2 && cols === 2 && rows >= 3;
  const trendAcrossCols = !is2x2 && rows === 2 && cols >= 3;
  const trendShape = trendAcrossRows || trendAcrossCols;
  // `test: "trend"` asks for the trend test: it needs a qualifying shape; the
  // ordering confirmation (`trendOrdered`) still gates it, per Titer's rule
  // that a meaningless trend is never silently reported.
  if (test === "trend" && !trendShape)
    return {
      error: `The chi-square test for trend needs 2 columns and 3 rows or more, or 2 rows and 3 columns or more; this table is ${rows} × ${cols}.`,
    };
  // Prism always computes the trend on a qualifying table; Titer only does
  // when the user confirms the ordering, so a meaningless trend is never
  // silently reported.
  const trend = trendShape && params?.trendOrdered === true;
  const trendX = trendAcrossRows ? matrix.map((r) => r[0]) : matrix[0];
  const trendN = trendAcrossRows
    ? matrix.map((r) => r.reduce((s, v) => s + v, 0))
    : matrix[0].map((_, c) => matrix.reduce((s, r) => s + r[c], 0));

  // The trend test is undefined when the first row/column holds 0% or 100%
  // of the counts: prop.trend.test then crashes R's lm.wfit with
  // "NA/NaN/Inf in 'x'". A wholly empty row/column also makes the chi-square
  // statistic itself undefined (expected counts of 0 give 0/0), so there is
  // no meaningful result to return — name the cause instead of calling
  // prop.trend.test.
  const trendFirst = trendX.reduce((s, v) => s + v, 0);
  const trendTotal = trendN.reduce((s, v) => s + v, 0);
  const trendUndefined = trend && (trendFirst === 0 || trendFirst === trendTotal);
  if (trendUndefined) {
    return {
      error:
        `The chi-square test for trend is undefined here: the first ${trendAcrossRows ? "column" : "row"} holds ` +
        `${trendFirst === 0 ? "0%" : "100%"} of the counts, so there is no variation in the proportion to trend across. ` +
        `With an empty ${trendAcrossRows ? "column" : "row"}, the chi-square statistic is undefined too — ` +
        `add counts to the empty ${trendAcrossRows ? "column" : "row"}, or drop it, and try again.`,
    };
  }

  // A row or column holding no counts at all makes the test itself
  // undefined: its expected counts are all 0, so (O − E)² / E is 0/0 and
  // R's chisq.test returns NaN for the statistic and P (no error) — the
  // result would render as unexplained nulls. Name the empty row/column
  // instead of calling R. (Checked after the trend guard above, so a
  // constant first row/column keeps that test's more specific message.)
  const rowSums = matrix.map((r) => r.reduce((s, v) => s + v, 0));
  const colSums = matrix[0].map((_, c) => matrix.reduce((s, r) => s + r[c], 0));
  const emptyRow = rowSums.findIndex((s) => s === 0);
  const emptyCol = colSums.findIndex((s) => s === 0);
  if (emptyRow !== -1 || emptyCol !== -1) {
    const empty = emptyRow !== -1 ? `row ${emptyRow + 1}` : `column “${groups[emptyCol].name}”`;
    const kind = emptyRow !== -1 ? "row" : "column";
    return {
      error:
        `The chi-square test can't run on this table: ${empty} holds no counts, so its expected counts are all 0 ` +
        `and the statistic would be 0/0. Add counts to the empty ${kind}, or drop it, and try again.`,
    };
  }

  // as.numeric() drops R's own names ("X-squared", "df"…): the keys are only ours.
  const rCode = is2x2
    ? `${R_WILSON};m<-matrix(c(${flat.join(",")}),nrow=2,byrow=TRUE);ft<-fisher.test(m);ct<-suppressWarnings(chisq.test(m,correct=${test !== "chi-square" ? "TRUE" : "FALSE"}));` +
      // The first column's risk in row 1 over row 2, its CI on the log (Katz); Phi, signed;
      // the two risks' difference, its CI Newcombe's (Wilson's of each risk combined).
      `n1<-sum(m[1,]);n2<-sum(m[2,]);p1<-m[1,1]/n1;p2<-m[2,1]/n2;rr<-p1/p2;` +
      `z<-qnorm(0.975)*sqrt(1/m[1,1]-1/n1+1/m[2,1]-1/n2);w1<-wil(m[1,1],n1);w2<-wil(m[2,1],n2);d<-p1-p2;` +
      `dlo<-d-sqrt((p1-w1[1])^2+(w2[2]-p2)^2);dhi<-d+sqrt((w1[2]-p1)^2+(p2-w2[1])^2);` +
      `se<-wil(m[1,1],sum(m[,1]));sp<-wil(m[2,2],sum(m[,2]));pp<-wil(m[1,1],n1);np<-wil(m[2,2],n2);` +
      `c(p=${test === "fisher" ? "ft$p.value" : "ct$p.value"},odds=as.numeric(ft$estimate),oddsLo=ft$conf.int[1],oddsHi=ft$conf.int[2],` +
      `chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),minexp=min(ct$expected),n=sum(m),` +
      `rr=rr,rrLo=rr*exp(-z),rrHi=rr*exp(z),phi=(m[1,1]*m[2,2]-m[1,2]*m[2,1])/sqrt(prod(rowSums(m),colSums(m))),` +
      `d=d,dLo=dlo,dHi=dhi,nnt=1/abs(d),nntLo=if(dlo>0||dhi<0)1/max(abs(c(dlo,dhi))) else NA,nntHi=if(dlo>0||dhi<0)1/min(abs(c(dlo,dhi))) else NA,` +
      `sens=m[1,1]/sum(m[,1]),sensLo=se[1],sensHi=se[2],spec=m[2,2]/sum(m[,2]),specLo=sp[1],specHi=sp[2],` +
      `ppv=p1,ppvLo=pp[1],ppvHi=pp[2],npv=m[2,2]/n2,npvLo=np[1],npvHi=np[2])`
    : `m<-matrix(c(${flat.join(",")}),nrow=${rows},byrow=TRUE);ct<-suppressWarnings(chisq.test(m));` +
      (trend ? `tt<-prop.trend.test(c(${trendX.join(",")}),c(${trendN.join(",")}));` : "") +
      `c(chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),p=ct$p.value,minexp=min(ct$expected),n=sum(m)` +
      (trend ? `,trend=as.numeric(tt$statistic),trendP=tt$p.value` : "") +
      `,cramer=sqrt(as.numeric(ct$statistic)/(sum(m)*(min(dim(m))-1))))`;

  const v = await evalNamedVector(rCode);
  const row = (label: string, key: string, p = false): StatRow => ({
    label,
    value: v[key] ?? null,
    ...(p ? { p } : {}),
  });
  /** A measure and its 95% CI's bounds, each a row. */
  const withCi = (label: string, key: string, ci = "95% CI") => [
    row(label, key),
    row(`${label.replace(/ \(.*\)$/, "")} ${ci} lower`, `${key}Lo`),
    row(`${label.replace(/ \(.*\)$/, "")} ${ci} upper`, `${key}Hi`),
  ];
  const stats: StatRow[] = [];
  if (is2x2) {
    stats.push(
      test === "fisher" ? row("P value (Fisher's exact test)", "p", true) : row("P value", "p", true),
      ...(test === "fisher"
        ? []
        : [row(`Chi-square${test === "yates" ? " (Yates' correction)" : ""}`, "chisq"), row("df", "df")]),
      ...withCi("Odds ratio (conditional estimate)", "odds"),
      ...withCi(`Relative risk (${groups[0].name})`, "rr"),
      ...withCi(`Difference of risks (${groups[0].name})`, "d"),
      ...withCi("Number needed to treat", "nnt"),
      row("Phi", "phi"),
      ...withCi("Sensitivity", "sens"),
      ...withCi("Specificity", "spec"),
      ...withCi("Positive predictive value", "ppv"),
      ...withCi("Negative predictive value", "npv"),
      ...(test === "fisher" ? [row("Chi-square (Yates' correction, for reference)", "chisq"), row("df", "df")] : []),
    );
  } else {
    stats.push({ label: "Chi-square", value: v.chisq ?? null });
    stats.push({ label: "df", value: v.df ?? null });
    stats.push({ label: "P value", value: v.p ?? null, p: true });
    if (trend) {
      stats.push({ label: "Chi-square for trend", value: v.trend ?? null });
      stats.push({ label: "P value (test for trend)", value: v.trendP ?? null, p: true });
    }
    stats.push({ label: "Cramér's V", value: v.cramer ?? null });
  }

  const first = groups[0].name;
  const lowExpected = test !== "fisher" && v.minexp != null && v.minexp < 5;
  const notes =
    `Contingency table ${rows}×${cols}, N = ${num(v.n ?? null)}. ${is2x2 ? SUBTITLES[test] : "Pearson's chi-square test"}. ` +
    (is2x2
      ? `The odds ratio is for the table as entered (rows × columns): Fisher's conditional estimate, close to ` +
        `but not a·d / b·c. The relative risk and the difference of risks compare the first row's share of ` +
        `“${first}” with the second row's; the number needed to treat is one over that difference` +
        (v.nntLo == null ? ", its CI running through infinity as the difference's runs through 0" : "") +
        `. Sensitivity, specificity and predictive values read the rows as a test's results (positive first) ` +
        `and the columns as the condition (present first).`
      : "") +
    (trend
      ? ` Chi-square test for trend (Cochran–Armitage, 1 df): tests for a linear trend in the proportion in the first ` +
        `${trendAcrossRows ? "column across ordered, equally spaced rows." : "row across ordered, equally spaced columns."}`
      : trendShape
        ? ` The table has ordered-looking dimensions (${rows} × ${cols}); the chi-square test for trend was not run — ` +
          `confirm the categories are in a natural order and equally spaced to include it.`
        : "") +
    (lowExpected
      ? " Warning: some expected counts are below 5, so the chi-square approximation may be unreliable — consider combining categories."
      : "");

  return {
    testType: "chi-square",
    subtitle: is2x2 ? SUBTITLES[test] : "Pearson's chi-square test",
    stats,
    groups: [],
    notes,
  };
}
