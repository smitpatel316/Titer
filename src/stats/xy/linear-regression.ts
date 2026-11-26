// Ordinary least-squares simple linear regression of a chosen Y data series on X: an XY
// table's X, or two variables of a Multiple Variables table (`x`, `y`). Optionally forces the line through the origin (intercept = 0);
// reports 95% confidence intervals for the slope and intercept alongside the fit.
import type { AnalysisOutcome, Column, FitRow, LinearRegressionParams, NonlinearWeightScheme, StatRow } from "../types";
import { describe, identical, pRow, rVec, type ColumnTestSpec, type Group } from "../column/base";
import { evalNamedVector } from "../webr";
import { pairUp, splitXY, xyPoints, xyProblem } from "../../lib/dataset";
import { num } from "../../lib/format";

const DEFAULTS: LinearRegressionParams = { forceOrigin: false };

/** What X and Y lack for a line, or nothing. Exported for "compare-slopes",
 *  whose every set must make a line before the lines can be compared. */
export function lineProblem(x: Group, y: Group, origin: boolean): string | undefined {
  const need = origin ? 2 : 3;
  if (y.values.length < need) return `“${y.name}” needs at least ${need} points to be regressed on X.`;
  // Through the origin, a line needs one X other than 0; else, two different Xs and a Y that changes.
  if (origin) {
    if (x.values.every((v) => v === 0)) return `“${x.name}” holds only 0s: a line through the origin needs another X.`;
    if (y.values.every((v) => v === 0)) return `“${y.name}” holds only 0s: there is nothing to regress on “${x.name}”.`;
    return undefined;
  }
  if (identical(x.values)) return `“${x.name}”'s values are all identical: a line needs X values that differ.`;
  if (identical(y.values))
    return `“${y.name}”'s values are all identical: there is no change in it to regress on “${x.name}”.`;
}

/** The R expression for a weighting scheme, over the `x`/`y` vectors. */
const WEIGHT_R: Record<Exclude<NonlinearWeightScheme, "none" | "1/sd2">, string> = {
  "1/y": "1/y",
  "1/y2": "1/y^2",
  "1/x": "1/x",
  "1/x2": "1/x^2",
};
const WEIGHT_LABEL: Record<Exclude<NonlinearWeightScheme, "none" | "1/sd2">, string> = {
  "1/y": "1/Y",
  "1/y2": "1/Y²",
  "1/x": "1/X",
  "1/x2": "1/X²",
};

/** X and the chosen Y series (the first by default), on the rows where both have a value. */

/** X and Y regressed, on the points they make: two variables named (on the rows where
 *  both have a value), else an XY table's X and the chosen Y data set (the first by
 *  default), each replicate a point. */
export function pickXY(columns: Column[], params: LinearRegressionParams | undefined): Group[] {
  const named = (name?: string) => columns.find((c) => c.name === name);
  let points: { x: number[]; y: number[] } | undefined;
  let names: [string, string] = ["", ""];
  if (params?.x !== undefined) {
    const [x, y] = [named(params.x), named(params.y)];
    if (x && y) [points, names] = [pairUp(x, y), [x.name, y.name]];
  } else {
    const { x, ys } = splitXY(columns);
    const y = params?.y === undefined ? ys[0] : ys.find((s) => s.name === params.y);
    if (x && y) [points, names] = [xyPoints(x, y), [x.name, y.name]];
  }
  return points
    ? [
        { name: names[0], values: points.x },
        { name: names[1], values: points.y },
      ]
    : [];
}

export const linearRegressionSpec: ColumnTestSpec<LinearRegressionParams> = {
  testType: "linear-regression",
  minGroups: 2,
  check: (columns, params) => {
    if (params?.x !== undefined) {
      const empty = [params.x, params.y].map((n) => columns.find((c) => c.name === n)).find((c) => c && !c.values.length);
      return empty && `“${empty.name}” holds no numbers yet.`;
    }
    const problem = xyProblem(columns, params?.y);
    if (problem) return problem;
    // Plan 26: weighting, the same schemes as nonlinear regression except
    // 1/SD², which needs the replicate columns this runner never sees.
    const weights = params?.weights ?? "none";
    // `1/sd2` is not in this runner's weights type — it can still arrive
    // from a saved file or a direct runAnalysis call, so check by string.
    if ((weights as string) === "1/sd2")
      return "Weighting by 1/SD² needs replicate SDs, which linear regression doesn't see — use nonlinear regression with the same weighting.";
    if (weights === "none") return undefined;
    const pairs = pickXY(columns, params);
    if (pairs.length < 2) return undefined;
    if (weights === "1/y" && pairs[1].values.some((v) => v <= 0))
      return "Weighting by 1/Y needs all Y > 0 — some fitted Y are ≤ 0.";
    if (weights === "1/y2" && pairs[1].values.some((v) => v === 0))
      return "Weighting by 1/Y² needs Y ≠ 0 — some fitted Y are 0.";
    if (weights === "1/x" && pairs[0].values.some((v) => v <= 0))
      return "Weighting by 1/X needs all X > 0 — some fitted X are ≤ 0.";
    if (weights === "1/x2" && pairs[0].values.some((v) => v === 0))
      return "Weighting by 1/X² needs X ≠ 0 — some fitted X are 0.";
    return undefined;
  },
  parseGroups: pickXY,
  // Centered first (upstream 1.1.1, ported weight-aware): X and Y are centered
  // on their WEIGHTED means, so values far from 0 for their spread (dates in
  // seconds, 1000000000000.4…) lose no precision in lm's QR — and the fit
  // stays weighted (Plan 26), which upstream's centered R_LINE drops. The
  // centered intercept and slope are uncorrelated (the weighted mean of the
  // centered X is 0), so the intercept comes back to X = 0 with its exact SE:
  // b = b0c + my − slope·mx, sb² = se(b0c)² + (mx·se(slope))². Through the
  // origin the line is instead fit on x and y scaled by their joint maximum:
  // uniform scaling leaves the slope, its SE, R² and P exactly unchanged,
  // and the scaled fit's residuals are computed at O(1), where the unscaled
  // fit's residuals (y − slope·x, both ~1e13) lose the P value to rounding.
  // Pearson's r is computed on the centered values too: cor(x,y) itself is
  // 3.7e-8 off at 1e13 (R and NumPy agree on the wrong value), while cor on
  // the centered values matches the exact r to all digits.
  checkGroups: ([x, y], params) => lineProblem(x, y, (params ?? DEFAULTS).forceOrigin),
  rCode: (groups, params) => {
    const origin = (params ?? DEFAULTS).forceOrigin;
    const weights = (params ?? DEFAULTS).weights ?? "none";
    const wAssign = weights === "none" ? "" : `w<-${WEIGHT_R[weights]};`;
    const wArg = weights === "none" ? "" : ",weights=w";
    const meanOf = (v: string) => (weights === "none" ? `mean(${v})` : `weighted.mean(${v},w)`);
    const head = `x<-${rVec(groups[0].values)};y<-${rVec(groups[1].values)};${wAssign}`;
    // summary(lm)'s R² is the weighted one when weights are given, so no
    // further adjustment is needed — centering and scaling leave it unchanged.
    if (origin) {
      return (
        `${head}sc<-max(abs(x),abs(y));if(sc==0)sc<-1;m<-lm(I(y/sc)~I(x/sc)+0${wArg});s<-summary(m);co<-s$coefficients;q<-qt(0.975,df.residual(m));` +
        `c(slope=unname(co[1,1]),intercept=0,r=cor(x-mean(x),y-mean(y)),r2=s$r.squared,p=unname(co[1,4]),` +
        `slopeCiLo=unname(co[1,1]-q*co[1,2]),slopeCiHi=unname(co[1,1]+q*co[1,2]))`
      );
    }
    return (
      `${head}mx<-${meanOf("x")};my<-${meanOf("y")};m<-lm(I(y-my)~I(x-mx)${wArg});s<-summary(m);co<-s$coefficients;q<-qt(0.975,df.residual(m));` +
      `b<-co[1,1]+my-co[2,1]*mx;sb<-sqrt(co[1,2]^2+(mx*co[2,2])^2);` +
      `c(slope=unname(co[2,1]),intercept=unname(b),r=cor(x-mean(x),y-mean(y)),r2=s$r.squared,p=unname(co[2,4]),` +
      `slopeCiLo=unname(co[2,1]-q*co[2,2]),slopeCiHi=unname(co[2,1]+q*co[2,2]),` +
      `interceptCiLo=unname(b-q*sb),interceptCiHi=unname(b+q*sb))`
    );
  },
  rows: (v, _groups, params) => {
    const origin = (params ?? DEFAULTS).forceOrigin;
    const rows: StatRow[] = [
      { label: "Slope", value: v.slope },
      { label: "Slope 95% CI lower", value: v.slopeCiLo },
      { label: "Slope 95% CI upper", value: v.slopeCiHi },
    ];
    if (origin) {
      rows.push({ label: "Y-intercept", value: 0 });
    } else {
      rows.push(
        { label: "Y-intercept", value: v.intercept },
        { label: "Intercept 95% CI lower", value: v.interceptCiLo },
        { label: "Intercept 95% CI upper", value: v.interceptCiHi },
      );
      // r is the unweighted cor(x,y): on a weighted fit r² ≠ the weighted R²,
      // so no r is shown (Prism shows none either) — same rule as the
      // multi-Y table below.
      if (((params ?? DEFAULTS).weights ?? "none") === "none") rows.push({ label: "Pearson r", value: v.r });
    }
    rows.push({ label: "R squared", value: v.r2 }, pRow("P value (slope ≠ 0)", v.p));
    return rows;
  },
  notes: (params, groups) => {
    const weights = (params ?? DEFAULTS).weights ?? "none";
    return (
      `Ordinary least-squares linear regression of “${groups[1]?.name ?? "Y"}” on “${groups[0]?.name ?? "X"}”` +
      `${(params ?? DEFAULTS).forceOrigin ? ", forced through the origin" : ""}. ` +
      (weights === "none"
        ? "Assumes a linear relationship and homoscedastic residuals."
        : `Weighted by ${WEIGHT_LABEL[weights]}; R² is weighted.`)
    );
  },
  subtitle: (params) =>
    (params ?? DEFAULTS).forceOrigin ? "Simple linear regression (through origin)" : "Simple linear regression",
  equation: (v, _groups, params) => {
    if (v.slope == null) return undefined;
    const term = `${num(v.slope)}*X`;
    const b = v.intercept;
    if ((params ?? DEFAULTS).forceOrigin || b == null || b === 0) return `Y = ${term}`;
    return `Y = ${term} ${b < 0 ? "−" : "+"} ${num(Math.abs(b))}`;
  },
};

/** Several Y data sets of an XY table, each regressed on X on its own (each replicate a
 *  point): their best-fit values side by side, every number R's. */
export async function runLinearRegressions(
  columns: Column[],
  params: LinearRegressionParams & { ys: string[] },
): Promise<AnalysisOutcome> {
  const { x, ys } = splitXY(columns);
  const sets = params.ys.map((name) => ys.find((s) => s.name === name));
  const lacking = params.ys.find((_, i) => !sets[i]);
  if (!x || lacking !== undefined) return { error: xyProblem(columns, lacking)! };
  const points = sets.map((s) => xyPoints(x, s!));
  const origin = params.forceOrigin;
  for (const [i, p] of points.entries()) {
    const problem = lineProblem({ name: x.name, values: p.x }, { name: sets[i]!.name, values: p.y }, origin);
    if (problem) return { error: problem };
  }
  // The multi-Y path never passes through the spec's check(), so weight
  // validity is checked here, per set on the paired points — the same
  // rules as the single-Y check, naming the set that fails them.
  const weights = params.weights ?? "none";
  if ((weights as string) === "1/sd2")
    return {
      error:
        "Weighting by 1/SD² needs replicate SDs, which linear regression doesn't see — use nonlinear regression with the same weighting.",
    };
  if (weights !== "none") {
    for (let i = 0; i < sets.length; i++) {
      const p = points[i];
      const bad =
        (weights === "1/y" && p.y.some((v) => v <= 0)) ||
        (weights === "1/y2" && p.y.some((v) => v === 0)) ||
        (weights === "1/x" && p.x.some((v) => v <= 0)) ||
        (weights === "1/x2" && p.x.some((v) => v === 0));
      if (!bad) continue;
      const need =
        weights === "1/y"
          ? "Weighting by 1/Y needs all Y > 0 — some fitted Y are ≤ 0."
          : weights === "1/y2"
            ? "Weighting by 1/Y² needs Y ≠ 0 — some fitted Y are 0."
            : weights === "1/x"
              ? "Weighting by 1/X needs all X > 0 — some fitted X are ≤ 0."
              : "Weighting by 1/X² needs X ≠ 0 — some fitted X are 0.";
      return { error: `“${sets[i]!.name}”: ${need}` };
    }
  }
  // Weights are per set: 1/Y and 1/Y² read that set's own Y (1/X and 1/X²
  // read the shared X), so the w vector is built inside each set's R code.
  // Each set's fit is centered (or scaled, through the origin) exactly as
  // the single-Y rCode above — same weighted means, same back-transform.
  const wAssign = weights === "none" ? "" : `w<-${WEIGHT_R[weights]};`;
  const wArg = weights === "none" ? "" : ",weights=w";
  const meanOf = (v: string) => (weights === "none" ? `mean(${v})` : `weighted.mean(${v},w)`);
  const fitCode = (p: { x: number[]; y: number[] }, i: number) => {
    const head = `x<-${rVec(p.x)};y<-${rVec(p.y)};${wAssign}`;
    if (origin) {
      return (
        `${head}sc<-max(abs(x),abs(y));if(sc==0)sc<-1;m<-lm(I(y/sc)~I(x/sc)+0${wArg});s<-summary(m);co<-s$coefficients;q<-qt(0.975,df.residual(m));` +
        `v${i}<-c(slope=unname(co[1,1]),slo=co[1,1]-q*co[1,2],shi=co[1,1]+q*co[1,2],` +
        `b=0,blo=NA,bhi=NA,r=NA,r2=s$r.squared,p=co[1,4],n=length(y))`
      );
    }
    return (
      `${head}mx<-${meanOf("x")};my<-${meanOf("y")};m<-lm(I(y-my)~I(x-mx)${wArg});s<-summary(m);co<-s$coefficients;q<-qt(0.975,df.residual(m));` +
      `b<-co[1,1]+my-co[2,1]*mx;sb<-sqrt(co[1,2]^2+(mx*co[2,2])^2);` +
      `v${i}<-c(slope=unname(co[2,1]),slo=co[2,1]-q*co[2,2],shi=co[2,1]+q*co[2,2],` +
      `b=unname(b),blo=b-q*sb,bhi=b+q*sb,r=cor(x-mean(x),y-mean(y)),r2=s$r.squared,p=co[2,4],n=length(y))`
    );
  };
  const v = await evalNamedVector(
    points.map(fitCode).join(";") + `;c(${points.map((_, i) => `setNames(v${i},paste0(names(v${i}),"_${i}"))`).join(",")})`,
  );
  const of = (key: string) => sets.map((_, i) => v[`${key}_${i}`] ?? null);
  const range = (lo: string, hi: string) =>
    sets.map((_, i): [number | null, number | null] => [v[`${lo}_${i}`] ?? null, v[`${hi}_${i}`] ?? null]);
  const rows: FitRow[] = [
    { label: "Slope", values: of("slope") },
    { label: "95% CI", ranges: range("slo", "shi") },
    { label: "Y-intercept", values: of("b") },
    ...(origin ? [] : [{ label: "95% CI", ranges: range("blo", "bhi") }]),
    // No Pearson r on a weighted fit (it is the unweighted cor(x,y), so
    // r² ≠ the weighted R²) — same rule as the single-Y table above.
    ...(origin || weights !== "none" ? [] : [{ label: "Pearson r", values: of("r") }]),
    { label: "R squared", values: of("r2") },
    { label: "P value (slope ≠ 0)", values: of("p"), p: true },
    { label: "N", values: of("n") },
  ];
  return {
    testType: "linear-regression",
    subtitle: origin ? "Simple linear regression (through origin)" : "Simple linear regression",
    stats: [],
    fit: { sets: sets.map((s) => s!.name), rows },
    groups: (await describe([x, ...sets.map((s) => ({ name: s!.name, values: s!.columns.flatMap((c) => c.values) }))]))
      .groups,
    notes:
      `Ordinary least-squares linear regression of each Y data set on “${x.name}”, each on its own` +
      `${origin ? ", forced through the origin" : ""}. ` +
      (weights === "none"
        ? "Assumes a linear relationship and homoscedastic residuals."
        : `Weighted by ${WEIGHT_LABEL[weights]}; R² is weighted.`),
  };
}
