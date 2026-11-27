// Linear-regression overlay for the XY scatter graph: a fit line + 95%
// confidence or prediction band, computed directly from the same x/y pairs the scatter plots —
// no WebR round-trip needed. The closed form here always matches the sibling
// "Linear regression" analysis's R-computed fit — unweighted OLS, or weighted
// least squares when the linked analysis carries a weighting scheme
// (checked by `npm test`).
import type { GraphOptions } from "../../store/types";
import type { LinearRegressionParams, NonlinearWeightScheme } from "../../stats/types";
import { splitXY, xyPoints, type Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num, pText } from "../../lib/format";
import { tCrit95, tTwoSidedP } from "../../lib/student-t";
import { withOpacity } from "../../lib/palettes";
import { addNote, curveXs, type Paint } from "./plot-helpers";

export interface LinearFit {
  slope: number;
  intercept: number; // 0 when forced through the origin
  forceOrigin: boolean;
  n: number;
  dof: number;
  r: number; // Pearson's
  r2: number;
  p: number;
  xbar: number; // weighted mean of x (plain mean when unweighted)
  sxx: number; // Σw(x-x̄)² (or Σwx² when forced through the origin)
  s: number; // residual standard error
  wSum: number; // Σw (n when unweighted)
  weighted: boolean; // a weighting scheme applied (no Pearson r is reported for a weighted fit)
}

/** The weight for one point under a weighting scheme, or null when the scheme
 *  cannot apply to this point — the same positivity guards as the analysis's
 *  `check` in stats/xy/linear-regression.ts ("1/sd2" is not a linear-regression
 *  scheme at all). A null anywhere makes the whole fit null: no overlay
 *  rather than a wrong one. */
function weightAt(scheme: Exclude<NonlinearWeightScheme, "1/sd2">, xi: number, yi: number): number | null {
  switch (scheme) {
    case "none":
      return 1;
    case "1/y":
      return yi > 0 ? 1 / yi : null;
    case "1/y2":
      return yi !== 0 ? 1 / (yi * yi) : null;
    case "1/x":
      return xi > 0 ? 1 / xi : null;
    case "1/x2":
      return xi !== 0 ? 1 / (xi * xi) : null;
    default:
      return null;
  }
}

/** Why a linear fit cannot be drawn, or null when it can — the same three
 *  guards as fitLinear (fewer than 3 points, a weighting scheme that cannot
 *  apply to every point, a degenerate all-identical X), as a reason the
 *  graph can show instead of silently drawing nothing (G-F8). fitLinear
 *  answers with this first, so the two can never disagree about whether a
 *  fit exists. */
export function linearFitProblem(
  x: number[],
  y: number[],
  forceOrigin: boolean,
  weights: Exclude<NonlinearWeightScheme, "1/sd2"> = "none",
): string | null {
  if (x.length < 3) return "it needs at least 3 points";
  const w: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const wi = weightAt(weights, x[i], y[i]);
    if (wi == null) return "the weighting scheme cannot apply to every point";
    w.push(wi);
  }
  const wSum = w.reduce((s, wi) => s + wi, 0);
  const xbar = w.reduce((s, wi, i) => s + wi * x[i], 0) / wSum;
  const sxx = forceOrigin
    ? w.reduce((s, wi, i) => s + wi * x[i] * x[i], 0)
    : w.reduce((s, wi, i) => s + wi * (x[i] - xbar) ** 2, 0);
  if (sxx === 0) return "all X values are the same";
  return null;
}

/** (Weighted) least-squares fit of y on x (optionally forced through the
 *  origin), plus the slope's P value. Returns null with fewer than 3 points,
 *  a degenerate (all-identical) X, or weights that cannot apply to the data —
 *  too little residual freedom, or no valid weighting, for a meaningful band.
 *  With weights "none" this is plain OLS; otherwise it is the WLS fit R's
 *  `lm(y ~ x, weights = w)` computes: weighted means, Σw(x−x̄)², and a
 *  weighted R² (summary(lm)$r.squared is the weighted one).
 *
 *  Centered twice (Nov 2026, same pattern as the R-side fix in
 *  stats/xy/linear-regression.ts): the differences are taken against the
 *  FIRST point, then centered on their weighted mean. At ~1e13 scale the
 *  weighted mean x̄ itself carries ~0.002 of rounding (1 ulp of 1e13), and
 *  (x − x̄)² picks that up squared — the 1/y-weighted slope read 1.5e-6
 *  off, and the uncentered residuals y − (b + slope·x) lost ssRes to
 *  rounding (1.0% off unweighted, s 0.5%, P 4.1%). Differences against a
 *  nearby point subtract exactly, so the centered differences are accurate
 *  to ~1e-16 and slope, ssRes, s, R² and P match the mpmath exact values
 *  to ~1e-15. Through the origin the fit is scaled by max(|x|,|y|)
 *  instead (centering would change the model); its ssRes keeps the
 *  inherent ~1% floor — the slope's own double rounding moves every
 *  residual by slope-error × x — so s is pinned within 5% and P within
 *  25%, the same bound as the R origin fit. */
export function fitLinear(
  x: number[],
  y: number[],
  forceOrigin: boolean,
  weights: Exclude<NonlinearWeightScheme, "1/sd2"> = "none",
): LinearFit | null {
  if (linearFitProblem(x, y, forceOrigin, weights)) return null;
  const n = x.length;
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    w.push(weightAt(weights, x[i], y[i])!);
  }
  const wSum = w.reduce((s, wi) => s + wi, 0);
  // Differences against the first point (exact for nearby doubles), then
  // centered on their weighted mean — see the doc comment above.
  const dx = x.map((xi) => xi - x[0]);
  const dy = y.map((yi) => yi - y[0]);
  const mx = w.reduce((s, wi, i) => s + wi * dx[i], 0) / wSum;
  const my = w.reduce((s, wi, i) => s + wi * dy[i], 0) / wSum;
  const cx = dx.map((dxi) => dxi - mx);
  const cy = dy.map((dyi) => dyi - my);
  const xbar = x[0] + mx;
  const ybar = y[0] + my;
  const dof = n - (forceOrigin ? 1 : 2);
  if (forceOrigin) {
    // Scaled fit (centering would change the model): uniform scaling leaves
    // the slope, its SE, R² and P exactly unchanged, and the scaled
    // residuals are computed at O(1).
    const sc =
      [...x, ...y].reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
    const xs = x.map((xi) => xi / sc);
    const ys = y.map((yi) => yi / sc);
    const sxx = w.reduce((s, wi, i) => s + wi * x[i] * x[i], 0);
    const sxxScaled = w.reduce((s, wi, i) => s + wi * xs[i] * xs[i], 0);
    const slope = w.reduce((s, wi, i) => s + wi * xs[i] * ys[i], 0) / sxxScaled;
    const ssRes = sc * sc * w.reduce((s, wi, i) => s + wi * (ys[i] - slope * xs[i]) ** 2, 0);
    const ssTot = w.reduce((s, wi, i) => s + wi * y[i] * y[i], 0);
    const s = Math.sqrt(ssRes / dof);
    const t = slope / (s / Math.sqrt(sxx));
    const dot = (a: number[], b: number[]) => a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const r = dot(cx, cy) / Math.sqrt(dot(cx, cx) * dot(cy, cy));
    return { slope, intercept: 0, forceOrigin, n, dof, r, r2: 1 - ssRes / ssTot, p: tTwoSidedP(t, dof), xbar, sxx, s, wSum, weighted: weights !== "none" };
  }
  const sxx = w.reduce((s, wi, i) => s + wi * cx[i] * cx[i], 0);
  const slope = w.reduce((s, wi, i) => s + wi * cx[i] * cy[i], 0) / sxx;
  const intercept = ybar - slope * xbar;
  const ssRes = w.reduce((s, wi, i) => s + wi * (cy[i] - slope * cx[i]) ** 2, 0);
  const ssTot = w.reduce((s, wi, i) => s + wi * cy[i] * cy[i], 0);
  const s = Math.sqrt(ssRes / dof);
  const t = slope / (s / Math.sqrt(sxx));
  const dot = (a: number[], b: number[]) => a.reduce((sum, ai, i) => sum + ai * b[i], 0);
  const r = dot(cx, cy) / Math.sqrt(dot(cx, cx) * dot(cy, cy));
  return { slope, intercept, forceOrigin, n, dof, r, r2: 1 - ssRes / ssTot, p: tTwoSidedP(t, dof), xbar, sxx, s, wSum, weighted: weights !== "none" };
}

/** The line at `x0` and its 95% band: of the line itself (`confidence`, R's
 *  `predict(interval="confidence")`), or of a new point (`prediction`, its own scatter added:
 *  `interval="prediction"`). Titer's `1/wSum` in place of upstream's `1/n` keeps the
 *  weighted fit's band exact; the prediction term stays +1 (upstream's, unweighted). */
export function bandAt(fit: LinearFit, x0: number, band: GraphOptions["regBand"]): [number, number, number] {
  const yHat = fit.intercept + fit.slope * x0;
  const line = fit.forceOrigin ? x0 ** 2 / fit.sxx : 1 / fit.wSum + (x0 - fit.xbar) ** 2 / fit.sxx;
  const half = tCrit95(fit.dof) * fit.s * Math.sqrt(line + (band === "prediction" ? 1 : 0));
  return [yHat, yHat - half, yHat + half];
}

/** Points across the data's X range (see `curveXs`) with the fit line and its 95% band at
 *  each — ready to hand to Plotly as line/fill traces. */
function regressionCurve(
  fit: LinearFit,
  xs: number[],
  scale: GraphOptions["xScale"],
  band: GraphOptions["regBand"],
): { x: number[]; yFit: number[]; yLo: number[]; yHi: number[] } {
  const x = curveXs(xs, scale, 60);
  const at = x.map((x0) => bandAt(fit, x0, band));
  return { x, yFit: at.map((a) => a[0]), yLo: at.map((a) => a[1]), yHi: at.map((a) => a[2]) };
}

/** "Y = 2.927*X − 0.3322<br>r = 0.9346, R² = 0.8734, P = 0.0021" (no r through the origin, and
 *  none for a weighted fit — R's lm reports no Pearson r for one, and the unweighted r
 *  would describe the wrong fit) annotation text — Plotly-ready
 *  (line break as `<br>`), formatted the same way as the Analysis panel's equation.
 *  Always uses literal "Y"/"X" rather than the actual column names, for simplicity. */
function regressionLabel(fit: LinearFit): string {
  const term = `${num(fit.slope)}*X`;
  const eq = fit.forceOrigin
    ? `Y = ${term}`
    : `Y = ${term} ${fit.intercept < 0 ? "−" : "+"} ${num(Math.abs(fit.intercept))}`;
  return `${eq}<br>${fit.forceOrigin || fit.weighted ? "" : `r = ${num(fit.r)}, `}R² = ${num(fit.r2)}, ${pText(fit.p)}`;
}

/** Draws a linear-regression analysis's fit on an XY scatter (`columns` = X, then
 *  the Y series): each data set's line, 95% CI band and equation as chosen, under the
 *  points (several equations one per line, after each one's name). A regression of two
 *  named variables is drawn only on the scatter of those two. */
export function addRegression(
  fig: GraphFigure,
  columns: Column[],
  options: GraphOptions,
  params: LinearRegressionParams | undefined,
  paint: Paint,
) {
  const { x, ys } = splitXY(columns);
  if (!x || (params?.x !== undefined && params.x !== x.name)) return;
  const names = params?.ys ?? [params?.y ?? (params?.x === undefined ? ys[0]?.name : undefined)];
  const many = names.length > 1;
  const traces: unknown[] = [];
  const notes: string[] = [];
  // A fit the toggles asked for but that cannot be drawn is named on the
  // figure instead of silently drawing nothing (G-F8). Only when a toggle
  // is on: with all three off, nobody asked to see a fit.
  const failed: string[] = [];
  const wantsFit = options.regShowLine || options.regShowBand || options.regShowEquation;
  for (const name of names) {
    const y = ys.find((s) => s.name === name);
    if (!y) continue;
    const pairs = xyPoints(x, y);
    const fit = fitLinear(pairs.x, pairs.y, params?.forceOrigin ?? false, params?.weights ?? "none");
    if (!fit) {
      if (wantsFit) {
        const reason = linearFitProblem(pairs.x, pairs.y, params?.forceOrigin ?? false, params?.weights ?? "none");
        if (reason) failed.push(`Linear fit for “${y.name}” not drawn: ${reason}.`);
      }
      continue;
    }
    const color = paint.color(y.name, ys.indexOf(y));
    const curve = regressionCurve(fit, pairs.x, options.xScale, options.regBand);
    const line = (yv: number[], style: object) => ({
      type: "scatter",
      mode: "lines",
      x: curve.x,
      y: yv,
      line: style,
      hoverinfo: "skip",
      showlegend: false,
    });
    if (options.regShowBand) {
      traces.push(line(curve.yLo, { width: 0 }), {
        ...line(curve.yHi, { width: 0 }),
        fill: "tonexty",
        fillcolor: withOpacity(color, 0.5), // a band: always see-through
      });
    }
    if (options.regShowLine) traces.push(line(curve.yFit, { color, width: 1.5, dash: "dash" }));
    const label = regressionLabel(fit);
    notes.push(many ? `${y.name}: ${label.replace("<br>", ", ")}` : label);
  }
  fig.data = [...traces, ...fig.data];
  if (options.regShowEquation && notes.length) addNote(fig, notes.join("<br>"), options);
  if (failed.length) addNote(fig, failed.join("<br>"), options);
}
