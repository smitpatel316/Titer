// "Smooth, differentiate or integrate a curve" (Prism's Analyse → Smooth,
// Differentiate or Integrate a Curve) — Savitzky–Golay smoothing, a first
// or second numerical derivative, or a cumulative integral, each producing a
// NEW curve table (X + result Y) per Y data set. The source table is never
// changed: Prism creates a new results table, and so does this runner — the
// derived curves live in the result's `derivedCurves` only.
//
// The maths follows Prism 10's Statistics Guide ("Smoothing, differentiating
// and integrating curves"), verified Nov 14, 2026:
//  - First derivative (forward difference): x'[i] = (x[i+1] + x[i]) / 2,
//    y'[i] = (y[i+1] - y[i]) / (x[i+1] - x[i]). The second derivative runs
//    that algorithm twice — the derivative of the derivative.
//  - Integral (trapezoid rule): result X = data X; first result Y = the
//    starting value you specify (usually 0); each later Y = previous +
//    (x[i] - x[i-1]) * avg(y[i-1] - baseline, y[i] - baseline) — the
//    cumulative area measured from the baseline Y (0 by default).
//  - Smoothing (Savitzky–Golay, Savitzky & Golay 1964): each point is
//    replaced by the least-squares polynomial fit over its window of 5, 9 or
//    13 neighbours, of order 2 or 3. The window cannot centre on the edge
//    rows, so the results table has fewer rows than the data (Prism says so
//    too) — the dropped rows are counted per set, never silently lost.
//  - Order of steps: derivative/integral first, then smooth — so asking to
//    smooth a derivative/integral smooths the derived curve, not the data.
//  - Smoothing needs equally spaced X (Savitzky–Golay's window assumes a
//    uniform grid); a set whose X is not equally spaced is rejected with a
//    named error instead of smoothing over the wrong grid.
//
// Pure TypeScript, no R for the values themselves; the result values'
// descriptives come from `describe` (R), like every other analysis. A Y
// data set's replicates are averaged per X row first (as area-under-curve
// does), so one X holds one Y going into the maths.
import type {
  AnalysisOutcome,
  Column,
  DerivedCurve,
  GroupDescriptives,
  SmoothDifferentiateIntegrateOperation,
  SmoothDifferentiateIntegrateParams,
} from "../types";
import { describe } from "../column/base";
import { datasetColumns, splitXY, xyProblem, xyRows } from "../../lib/dataset";

/** How each operation is written in the results (and in the wizard's labels). */
export const SMOOTH_DIFF_INT_LABEL: Record<SmoothDifferentiateIntegrateOperation, string> = {
  smooth: "Smoothed",
  "first-derivative": "First derivative",
  "second-derivative": "Second derivative",
  integral: "Cumulative integral",
};

const OPERATIONS: SmoothDifferentiateIntegrateOperation[] = [
  "smooth",
  "first-derivative",
  "second-derivative",
  "integral",
];
const WINDOWS = [5, 9, 13];
const ORDERS = [2, 3];

/** Solve a small dense linear system by Gaussian elimination with partial
 *  pivoting. The normal equations here are at most 4×4 (order ≤ 3). */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = col + 1; r < n; r++) {
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  const out = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k++) s -= m[r][k] * out[k];
    out[r] = s / m[r][r];
  }
  return out;
}

/** Savitzky–Golay smoothing coefficients for a window of `window` points
 *  (odd, ≥ 3) and polynomial `order` (< window): the least-squares fit of a
 *  degree-`order` polynomial over offsets −m…m, evaluated at the centre
 *  (offset 0). Coefficients sum to 1, so a constant survives untouched, and
 *  a polynomial of degree ≤ `order` is reproduced exactly at interior
 *  points. For a symmetric window the smoothing coefficients coincide for
 *  orders 2 and 3 (the odd terms vanish) — a standard property, not a bug:
 *  window 5 gives [−3, 12, 17, 12, −3]/35 either way, window 9 gives
 *  [−21, 14, 39, 54, 59, 54, 39, 14, −21]/231. */
export function savitzkyGolayCoefficients(window: number, order: number): number[] {
  const half = (window - 1) / 2;
  const n = order + 1;
  // Normal equations: A[i][j] = Σ k^(i+j) over k = −half…half; the fit is
  // evaluated at 0, so b is 1 at i = 0 and 0 elsewhere.
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      let s = 0;
      for (let k = -half; k <= half; k++) s += k ** (i + j);
      return s;
    }),
  );
  const b = Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0));
  const c = solveLinear(a, b);
  const weights: number[] = [];
  for (let j = -half; j <= half; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += c[i] * j ** i;
    weights.push(s);
  }
  return weights;
}

/** Whether the X values are equally spaced (what Savitzky–Golay assumes):
 *  every successive gap within 1e-9 (relative) of the median gap. */
export function equallySpaced(xs: number[]): boolean {
  if (xs.length < 2) return true;
  const gaps = xs.slice(1).map((x, i) => x - xs[i]);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return gaps.every((g) => g === 0);
  const tol = 1e-9 * Math.max(1, Math.abs(median));
  return gaps.every((g) => Math.abs(g - median) <= tol);
}

/** Savitzky–Golay smoothing of `ys` at `xs`: one result row per window
 *  centre (the edge rows the window cannot centre on are dropped, counted
 *  in `dropped`). The caller checks equal spacing first. */
export function smoothValues(
  xs: number[],
  ys: number[],
  window: number,
  order: number,
): { x: number[]; y: number[]; dropped: number } {
  const weights = savitzkyGolayCoefficients(window, order);
  const half = (window - 1) / 2;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = half; i + half < ys.length; i++) {
    let s = 0;
    for (let j = -half; j <= half; j++) s += weights[j + half] * ys[i + j];
    x.push(xs[i]);
    y.push(s);
  }
  return { x, y, dropped: ys.length - x.length };
}

/** Prism's first derivative (forward difference): result X are the
 *  midpoints of consecutive X's, result Y the secant slopes. */
export function firstDerivative(xs: number[], ys: number[]): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    x.push((xs[i + 1] + xs[i]) / 2);
    y.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  return { x, y };
}

/** Prism's second derivative: the first-derivative algorithm run twice. */
export function secondDerivative(xs: number[], ys: number[]): { x: number[]; y: number[] } {
  const once = firstDerivative(xs, ys);
  return firstDerivative(once.x, once.y);
}

/** Prism's cumulative integral (trapezoid rule): result X = data X; the
 *  first result Y is `startValue`; each later Y adds the trapezoid between
 *  this point and the last, measured from `baseline`. */
export function cumulativeIntegral(
  xs: number[],
  ys: number[],
  baseline: number,
  startValue: number,
): { x: number[]; y: number[] } {
  const y: number[] = [startValue];
  for (let i = 1; i < xs.length; i++) {
    y.push(y[i - 1] + (xs[i] - xs[i - 1]) * ((ys[i - 1] - baseline + (ys[i] - baseline)) / 2));
  }
  return { x: [...xs], y };
}

export async function runSmoothDifferentiateIntegrate(
  columns: Column[],
  params: SmoothDifferentiateIntegrateParams | undefined,
): Promise<AnalysisOutcome> {
  const operation: SmoothDifferentiateIntegrateOperation = params?.operation ?? "smooth";
  if (!OPERATIONS.includes(operation)) return { error: `Unknown operation: “${operation}”.` };
  const window = params?.window ?? 9;
  if (!WINDOWS.includes(window)) return { error: `Unknown smoothing window: “${window}” — choose 5, 9 or 13 neighbours.` };
  const order = params?.order ?? 3;
  if (!ORDERS.includes(order)) return { error: `Unknown smoothing polynomial order: “${order}” — choose 2 or 3.` };
  const smoothResults = params?.smoothResults ?? false;
  const baseline = params?.baseline ?? 0;
  const startValue = params?.startValue ?? 0;
  const needsSmooth = operation === "smooth" || smoothResults;

  const { x: xCol, ys: yCols } = splitXY(columns);
  if (!xCol || yCols.length < 1) return { error: xyProblem(columns)! };

  // The data sets to derive: the wizard's choice, or every Y data set. A
  // named set holding no numbers is named, not silently skipped (a deleted
  // one is caught earlier, by runAnalysis).
  let targets: { name: string }[];
  if (params?.ys?.length) {
    targets = params.ys.map((n) => ({ name: n }));
    const empty = params.ys.find((n) => datasetColumns(columns, n).every((c) => c.values.length === 0));
    if (empty) return { error: `“${empty}” holds no numbers yet.` };
  } else {
    targets = yCols.map((y) => ({ name: y.name }));
  }
  if (!targets.length) return { error: "No Y column holds numbers yet." };

  const label = SMOOTH_DIFF_INT_LABEL[operation];
  const smoothNote =
    needsSmooth && operation === "smooth"
      ? `Savitzky–Golay smoothing (${window} neighbours, order ${order}).`
      : needsSmooth
        ? `Smoothed after ${label.toLowerCase()} (Savitzky–Golay, ${window} neighbours, order ${order}).`
        : "";
  const methodNote =
    operation === "smooth"
      ? smoothNote
      : operation === "first-derivative"
        ? `First derivative by forward differences (result X are the midpoints of consecutive X values).${smoothResults ? ` ${smoothNote}` : ""}`
        : operation === "second-derivative"
          ? `Second derivative — the first-derivative calculation run twice.${smoothResults ? ` ${smoothNote}` : ""}`
          : `Cumulative integral by the trapezoid rule, measured from a baseline of Y = ${baseline}, starting at ${startValue}.${smoothResults ? ` ${smoothNote}` : ""}`;

  const curves: DerivedCurve[] = [];
  for (const target of targets) {
    const set = yCols.find((y) => y.name === target.name);
    if (!set) continue;
    // Complete pairs, replicates averaged per X row, sorted by X.
    const rows = xyRows(xCol, set);
    const sortedIdx = rows.x.map((_, i) => i).sort((a, b) => rows.x[a] - rows.x[b]);
    const xs = sortedIdx.map((i) => rows.x[i]);
    const ys = sortedIdx.map((i) => rows.values[i].reduce((s, v) => s + v, 0) / rows.values[i].length);
    const n = xs.length;
    const min = operation === "second-derivative" ? 3 : 2;
    if (n < min)
      return {
        error: `“${target.name}” has only ${n} point${n === 1 ? "" : "s"} — ${label.toLowerCase()} needs at least ${min}.`,
      };
    // A repeated X breaks the derivative (ΔX = 0) and the smoothing grid;
    // the integral tolerates it (a zero-width trapezoid adds nothing).
    if (operation !== "integral" && xs.some((x, i) => i > 0 && x === xs[i - 1]))
      return { error: `“${target.name}” has repeated X values — ${label.toLowerCase()} needs distinct X values.` };
    if (needsSmooth && !equallySpaced(xs))
      return {
        error: `“${target.name}” does not have equally spaced X values — Savitzky–Golay smoothing needs a uniform X grid.`,
      };
    if (operation === "smooth" && n < window)
      return {
        error: `“${target.name}” has only ${n} points — smoothing with a window of ${window} neighbours needs at least ${window}.`,
      };

    let out: { x: number[]; y: number[] };
    if (operation === "smooth") out = smoothValues(xs, ys, window, order);
    else if (operation === "first-derivative") out = firstDerivative(xs, ys);
    else if (operation === "second-derivative") out = secondDerivative(xs, ys);
    else out = cumulativeIntegral(xs, ys, baseline, startValue);
    if (smoothResults && operation !== "smooth") {
      // Prism's order: derivative/integral first, then smooth. The
      // intermediate X is equally spaced whenever the input was (derivative
      // midpoints of a uniform grid stay uniform; the integral keeps X), so
      // the spacing check above already covers this step. But the
      // intermediate curve is shorter — a derivative consumes rows — so it
      // may be too short for the window, and smoothing it would silently
      // return an empty curve; name it instead.
      if (out.x.length < window)
        return {
          error: `“${target.name}” — after ${label.toLowerCase()} there are only ${out.x.length} point${out.x.length === 1 ? "" : "s"}, fewer than the ${window} neighbours smoothing needs.`,
        };
      out = smoothValues(out.x, out.y, window, order);
    }
    curves.push({ dataset: target.name, label, x: out.x, y: out.y, dropped: n - out.x.length });
  }
  if (!curves.length) return { error: "No Y column holds numbers yet." };

  // Descriptives over the derived values, per set — as every other analysis
  // reports them. A set's values are never empty here (n ≥ 2, and smoothing
  // keeps at least one row once n ≥ window), so every set gets a group.
  const descriptives: GroupDescriptives[] = (
    await describe(curves.map((c) => ({ name: `${c.label}(${c.dataset})`, values: c.y })))
  ).groups;

  const stats = curves.flatMap((c) => {
    const rows = [{ label: `${c.label}(${c.dataset}) — N`, value: c.x.length }];
    if (c.dropped > 0)
      rows.push({ label: `${c.label}(${c.dataset}) — rows dropped`, value: c.dropped });
    return rows;
  });

  const droppedNote = curves
    .filter((c) => c.dropped > 0)
    .map(
      (c) =>
        `“${c.dataset}”: ${c.dropped} row${c.dropped === 1 ? "" : "s"} fewer than the data${operation === "smooth" || smoothResults ? " (the smoothing window cannot centre on the edge rows)" : " (a derivative consumes one row per pass)"}.`,
    )
    .join(" ");
  const notes = [
    "The source table is unchanged — these are the derived curves as a results sheet.",
    methodNote,
    droppedNote,
    needsSmooth
      ? "Do not analyse smoothed data: smoothing mutes point-to-point scatter and can create trends that are not in the data, so a smoothed curve should not go into a regression or other analysis."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    testType: "smooth-differentiate-integrate",
    subtitle: `Smooth, differentiate or integrate a curve — ${label}`,
    stats,
    groups: descriptives,
    notes,
    derivedCurves: curves,
  };
}
