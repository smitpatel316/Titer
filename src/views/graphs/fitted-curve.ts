// A fitted curve drawn over an XY graph's points: the "Nonlinear regression" analysis's
// coefficients (computed by R's nls() or lm()) put in the model's equation at evenly spaced X,
// no re-fitting here: an XY scatter draws the curve of a nonlinear regression of its table.
import type { GraphOptions } from "../../store/types";
import type { AnalysisResult, NonlinearModel, RegressionCoefficient } from "../../stats/types";
import { nonNegativeXOnly, positiveXOnly, coefficientsForSet, termLabel } from "../../stats/xy/nonlinear-regression";
import { evaluateUserEquation } from "../../stats/xy/user-defined";
import { xyPoints, type Column, type DataSet } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { num } from "../../lib/format";
import { addNote, curveXs, extent, type Paint } from "./plot-helpers";

function coef(coefficients: RegressionCoefficient[], term: string): number {
  return coefficients.find((c) => c.term === term)?.estimate ?? NaN;
}

/** The standard normal CDF Φ(z), by Simpson integration of the density
 *  from −10 (Φ(−10) ≈ 8e-24) — accurate to ~1e-10, where the
 *  Abramowitz–Stegun erf (|ε| < 1.5e-7) left the cumulative-Gaussian
 *  overlay ~6e-6 off R's exact pnorm on the percent scale, over the
 *  overlay's 1e-6 tolerance. Drawing-only, like the erf was. */
const pnorm = (z: number): number => {
  if (z <= -10) return 0;
  if (z >= 10) return 1;
  const a = -10;
  const n = 2000;
  const h = (z - a) / n;
  const pdf = (t: number) => Math.exp(-(t * t) / 2);
  let s = pdf(a) + pdf(z);
  for (let i = 1; i < n; i++) s += (i % 2 === 0 ? 2 : 4) * pdf(a + i * h);
  return (s * h) / 3 / Math.sqrt(2 * Math.PI);
};

/** The fitted curve at `x`: the model's equation (nonlinear-regression.ts) with its coefficients.
 *  The homologous model also needs the radioligand concentration [L] (its
 *  fit carries it — see AnalysisResult.ligandConcentration); without it the
 *  curve is undefined (NaN). A user-defined fit carries its equation instead
 *  (AnalysisResult.customEquation, v2 item 23) — without it, no curve.
 *  A centered polynomial fit (seq 201) carries its center instead
 *  (AnalysisResult.centeredX): its terms are powers of (X − centeredX). */
export function evaluate(
  model: NonlinearModel,
  coefficients: RegressionCoefficient[],
  x: number,
  ligandConcentration?: number,
  customEquation?: string,
  centeredX?: number,
): number {
  const c = (term: string) => coef(coefficients, termLabel(term));
  const [bottom, top, hill, s] = [c("Bottom"), c("Top"), c("HillSlope"), c("S")];
  const rise = top - bottom;
  // Raw-X ratio models divide by X: at X = 0 the ratio is +Inf while
  // EC50 > 0 (the formula then tends to the right plateau), but 0/0 = NaN
  // once a trial step takes EC50 to 0 — and a negative EC50 over 0 is a
  // wrong-signed Inf under a fractional Hill slope in R. Return the limit
  // explicitly, exactly the R x == 0 guard (Round 2 Issue 36): Top on a
  // falling curve, Bottom on a rising one (100/0 for the normalized model).
  // The guard is unconditional for all 8 raw-X ratio models, matching R
  // (Round 2 Issue 111): the other 4 models (agonist-3pl-x,
  // agonist-3pl-normalized-x, biphasic-x, bell-shaped-x) had no guard at
  // all, and asymmetric-5pl-x underflows (2^(1/S)-1)^(1/HillSlope) to 0 at
  // tiny positive HillSlope, so even EC50 > 0 is 0/0 = NaN at x == 0.
  if (x === 0) {
    if (model === "sigmoidal-4pl-x" || model === "absolute-ic50-x" || model === "asymmetric-5pl-x") {
      return hill < 0 ? top : bottom;
    }
    if (model === "agonist-4pl-normalized-x") return hill < 0 ? 100 : 0;
    if (model === "agonist-3pl-x") return bottom;
    if (model === "agonist-3pl-normalized-x") return 0;
    if (model === "biphasic-x") {
      // A missing (NaN) Frac/nH contributes nothing: the bounded fit keeps
      // nH1/nH2 positive and Frac in [0, 1], so with both phases rising the
      // limit is Bottom; a phase only contributes when its nH is finitely
      // negative AND Frac is known. (Without this, a coefficient set
      // lacking Frac/nH1/nH2 made the guard itself return NaN.)
      const frac = c("Frac");
      const w1 = c("nH1") < 0 && Number.isFinite(frac) ? frac : 0;
      const w2 = c("nH2") < 0 && Number.isFinite(frac) ? 1 - frac : 0;
      return bottom + rise * (w1 + w2);
    }
    if (model === "bell-shaped-x") {
      // Likewise NaN-safe: a missing Dip is 0 and a missing plateau spans
      // 0 from Dip, so a coefficient set lacking Dip/Plateau1/Plateau2
      // returns the finite base level instead of NaN.
      const dip = c("Dip");
      const d = Number.isFinite(dip) ? dip : 0;
      const s1 = Number.isFinite(c("Plateau1")) && Number.isFinite(dip) ? c("Plateau1") - dip : 0;
      const s2 = Number.isFinite(c("Plateau2")) && Number.isFinite(dip) ? c("Plateau2") - dip : 0;
      return d + s1 * (c("nH1") < 0 ? 1 : 0) + s2 * (c("nH2") > 0 ? 1 : 0);
    }
  }
  // A centered polynomial's terms are powers of (X − centeredX), not of X.
  const xc = x - (centeredX ?? 0);
  switch (model) {
    case "user-defined": {
      if (!customEquation) return NaN;
      const values: Record<string, number> = {};
      for (const coefRow of coefficients) values[coefRow.term] = coefRow.estimate ?? NaN;
      return evaluateUserEquation(customEquation, values, x);
    }
    case "sigmoidal-4pl-logx":
      return bottom + rise / (1 + 10 ** ((c("LogEC50") - x) * hill));
    case "sigmoidal-4pl-x":
      return bottom + rise / (1 + (c("EC50") / x) ** hill);
    case "agonist-3pl-logx":
      return bottom + rise / (1 + 10 ** (c("LogEC50") - x));
    case "agonist-3pl-x":
      // B6 Stim #5: Y = Bottom+(Top-Bottom)/(1+EC50/X).
      return bottom + rise / (1 + c("EC50") / x);
    case "inhibitor-3pl-logx":
      return bottom + rise / (1 + 10 ** (x - c("LogIC50")));
    case "inhibitor-3pl-x":
      // B6 Inhib #5: Y = Bottom+(Top-Bottom)/(1+X/IC50).
      return bottom + rise / (1 + x / c("IC50"));
    case "agonist-3pl-normalized-logx":
      // B6 Stim #3: Bottom=0, Top=100.
      return 100 / (1 + 10 ** (c("LogEC50") - x));
    case "agonist-4pl-normalized-logx":
      // B6 Stim #4.
      return 100 / (1 + 10 ** ((c("LogEC50") - x) * hill));
    case "agonist-3pl-normalized-x":
      // B6 Stim #7.
      return 100 / (1 + c("EC50") / x);
    case "agonist-4pl-normalized-x":
      // B6 Stim #8.
      return 100 / (1 + (c("EC50") / x) ** hill);
    case "inhibitor-3pl-normalized-logx":
      // B6 Inhib #3.
      return 100 / (1 + 10 ** (x - c("LogIC50")));
    case "inhibitor-4pl-normalized-logx":
      // B6 Inhib #4: the (x-LogIC50) form falls with HillSlope > 0.
      return 100 / (1 + 10 ** ((x - c("LogIC50")) * hill));
    case "inhibitor-3pl-normalized-x":
      // B6 Inhib #7.
      return 100 / (1 + x / c("IC50"));
    case "inhibitor-4pl-normalized-x":
      // B6 Inhib #8: the (x/IC50) form falls with HillSlope > 0.
      return 100 / (1 + (x / c("IC50")) ** hill);
    case "biphasic-logx": {
      // B6 Special logx #2.
      const span = c("Top") - c("Bottom");
      return (
        c("Bottom") +
        (span * c("Frac")) / (1 + 10 ** ((c("LogEC50_1") - x) * c("nH1"))) +
        (span * (1 - c("Frac"))) / (1 + 10 ** ((c("LogEC50_2") - x) * c("nH2")))
      );
    }
    case "biphasic-x": {
      // B6 Special X #2.
      const span = c("Top") - c("Bottom");
      return (
        c("Bottom") +
        (span * c("Frac")) / (1 + (c("EC50_1") / x) ** c("nH1")) +
        (span * (1 - c("Frac"))) / (1 + (c("EC50_2") / x) ** c("nH2"))
      );
    }
    case "bell-shaped-logx": {
      // B6 Special logx #3.
      return (
        c("Dip") +
        (c("Plateau1") - c("Dip")) / (1 + 10 ** ((c("LogEC50_1") - x) * c("nH1"))) +
        (c("Plateau2") - c("Dip")) / (1 + 10 ** ((x - c("LogEC50_2")) * c("nH2")))
      );
    }
    case "bell-shaped-x": {
      // B6 Special X #3.
      return (
        c("Dip") +
        (c("Plateau1") - c("Dip")) / (1 + (c("EC50_1") / x) ** c("nH1")) +
        (c("Plateau2") - c("Dip")) / (1 + (x / c("EC50_2")) ** c("nH2"))
      );
    }
    case "absolute-ic50-logx":
      // B6 Special logx #11: the 4PL fit.
      return bottom + rise / (1 + 10 ** ((c("LogEC50") - x) * hill));
    case "absolute-ic50-x":
      // B6 Special X #11: the 4PL fit.
      return bottom + rise / (1 + (c("EC50") / x) ** hill);
    case "pade-11":
      // B6 Standard #10: Y=(A0+A1·X)/(1+B1·X).
      return (c("A0") + c("A1") * x) / (1 + c("B1") * x);
    case "power-series":
      // B6 Classic #13: Y=A·X^B + C·X^D.
      return c("A") * x ** c("B") + c("C") * x ** c("D");
    case "exponential-plateau":
      // B6 Growth #3: Y=YM−(YM−Y0)·exp(−K·X).
      return c("YM") - (c("YM") - c("Y0")) * Math.exp(-c("K") * x);
    case "beta-growth-decay": {
      // B6 Growth #6: Yin et al. 2003.
      const te = c("Te");
      const tm = c("Tm");
      return c("Wmax") * (1 + (te - x) / (te - tm)) * (x / te) ** (te / (te - tm));
    }
    case "lq-fraction-surviving":
      // B6 §Linear quadratic #1.
      return Math.exp(-(c("A") * x + c("B") * x ** 2));
    case "lq-percent-surviving":
      // B6 §Linear quadratic #2.
      return 100 * Math.exp(-(c("A") * x + c("B") * x ** 2));
    case "lq-fraction-dead":
      // B6 §Linear quadratic #4.
      return 1 - Math.exp(-(c("A") * x + c("B") * x ** 2));
    case "lq-percent-dead":
      // B6 §Linear quadratic #5.
      return 100 * (1 - Math.exp(-(c("A") * x + c("B") * x ** 2)));
    case "lq-count-alive":
      // B6 §Linear quadratic #3.
      return c("Total") * Math.exp(-(c("A") * x + c("B") * x ** 2));
    case "lq-count-dead":
      // B6 §Linear quadratic #6.
      return c("Total") * (1 - Math.exp(-(c("A") * x + c("B") * x ** 2)));
    case "asymmetric-5pl-logx":
      return bottom + rise / (1 + 10 ** ((c("LogEC50") + Math.log10(2 ** (1 / s) - 1) / hill - x) * hill)) ** s;
    case "asymmetric-5pl-x":
      return bottom + rise / (1 + ((c("EC50") * (2 ** (1 / s) - 1) ** (1 / hill)) / x) ** hill) ** s;
    case "line":
      return c("Intercept") + c("Slope") * x;
    case "line-through-origin":
      // B6 §Lines #3: Y = Slope·X, no intercept.
      return c("Slope") * x;
    case "horizontal-line":
      // B6 §Lines #4: Y = Mean.
      return c("Mean");
    case "semilog-line":
      return c("Intercept") + c("Slope") * Math.log(x);
    case "semilog-y-log":
    case "exponential-growth-log":
      // B6 §Lines #6 / §Growth #2: log(Y) = Intercept + Slope·X, so
      // Y = exp(Intercept + Slope·X) on the raw scale.
      return Math.exp(c("Intercept") + c("Slope") * x);
    case "log-log-line":
      // B6 §Lines #7: log(Y) = Intercept + Slope·log(X), a power law.
      return Math.exp(c("Intercept")) * x ** c("Slope");
    case "hyperbola":
      return (c("Bmax") * x) / (c("Kd") + x);
    case "quadratic":
      return c("B0") + c("B1") * xc + c("B2") * xc ** 2;
    case "cubic":
      return c("B0") + c("B1") * xc + c("B2") * xc ** 2 + c("B3") * xc ** 3;
    case "quartic":
      // Plan 29: the polynomial evaluator generalises by degree.
      return c("B0") + c("B1") * xc + c("B2") * xc ** 2 + c("B3") * xc ** 3 + c("B4") * xc ** 4;
    case "quintic":
      return (
        c("B0") + c("B1") * xc + c("B2") * xc ** 2 + c("B3") * xc ** 3 + c("B4") * xc ** 4 + c("B5") * xc ** 5
      );
    case "sextic":
      // Seq 201: 6th order polynomial — same pattern, one degree higher.
      return (
        c("B0") + c("B1") * xc + c("B2") * xc ** 2 + c("B3") * xc ** 3 + c("B4") * xc ** 4 + c("B5") * xc ** 5 +
        c("B6") * xc ** 6
      );
    case "sextic":
      // B6 §Polynomial #11: one degree higher again.
      return (
        c("B0") + c("B1") * x + c("B2") * x ** 2 + c("B3") * x ** 3 + c("B4") * x ** 4 + c("B5") * x ** 5 + c("B6") * x ** 6
      );
    case "centered-first":
    case "centered-second":
    case "centered-third":
    case "centered-fourth":
    case "centered-fifth":
    case "centered-sixth": {
      // B6 §Polynomial #2,4,6,8,10,12: fitted on X − XCenter (the
      // coefficient row the runner appends for the derived X center).
      const xc = c("XCenter");
      const d = x - xc;
      let y = c("B0") + c("B1") * d;
      if (model !== "centered-first") y += c("B2") * d ** 2;
      if (model === "centered-third" || model === "centered-fourth" || model === "centered-fifth" || model === "centered-sixth")
        y += c("B3") * d ** 3;
      if (model === "centered-fourth" || model === "centered-fifth" || model === "centered-sixth")
        y += c("B4") * d ** 4;
      if (model === "centered-fifth" || model === "centered-sixth") y += c("B5") * d ** 5;
      if (model === "centered-sixth") y += c("B6") * d ** 6;
      return y;
    }
    case "segmental-linear":
      // Plan 29: the continuous hinge (X0 is the coefficient row the
      // runner appends for the profiled breakpoint) — one unbroken line,
      // never two disjoint segments.
      return c("B0") + c("B1") * x + c("B2") * Math.max(x - c("X0"), 0);
    case "exponential-growth":
      return c("Y0") * Math.exp(c("K") * x);
    case "logistic-growth":
      return (c("YM") * c("Y0")) / ((c("YM") - c("Y0")) * Math.exp(-c("K") * x) + c("Y0"));
    case "gompertz-growth":
      return c("YM") * (c("Y0") / c("YM")) ** Math.exp(-c("K") * x);
    case "one-phase-decay":
      return (c("Y0") - c("Plateau")) * Math.exp(-c("K") * x) + c("Plateau");
    case "two-phase-decay":
      return c("Plateau") + c("Span1") * Math.exp(-c("K1") * x) + c("Span2") * Math.exp(-c("K2") * x);
    case "three-phase-decay":
      return (
        c("Plateau") +
        c("Span1") * Math.exp(-c("K1") * x) +
        c("Span2") * Math.exp(-c("K2") * x) +
        c("Span3") * Math.exp(-c("K3") * x)
      );
    case "plateau-decay":
      return x < c("X0")
        ? c("Y0")
        : c("Plateau") + (c("Y0") - c("Plateau")) * Math.exp(-c("K") * (x - c("X0")));
    case "one-phase-association":
      return c("Y0") + (c("Plateau") - c("Y0")) * (1 - Math.exp(-c("K") * x));
    case "two-phase-association":
      return (
        c("Y0") +
        c("Span1") * (1 - Math.exp(-c("K1") * x)) +
        c("Span2") * (1 - Math.exp(-c("K2") * x))
      );
    case "plateau-association":
      return x < c("X0")
        ? c("Y0")
        : c("Y0") + (c("Plateau") - c("Y0")) * (1 - Math.exp(-c("K") * (x - c("X0"))));
    case "gaussian":
      return c("Amplitude") * Math.exp(-0.5 * ((x - c("Mean")) / c("SD")) ** 2);
    case "sum-of-two-gaussians":
      return (
        c("Amplitude1") * Math.exp(-0.5 * ((x - c("Mean1")) / c("SD1")) ** 2) +
        c("Amplitude2") * Math.exp(-0.5 * ((x - c("Mean2")) / c("SD2")) ** 2)
      );
    case "lognormal":
      return (c("A") / x) * Math.exp(-0.5 * (Math.log(x / c("GeoMean")) / Math.log(c("GeoSD"))) ** 2);
    case "cumulative-gaussian-percent":
      return 100 * pnorm((x - c("Mean")) / c("SD"));
    case "cumulative-gaussian-fraction":
      return pnorm((x - c("Mean")) / c("SD"));
    case "cumulative-gaussian-counts":
      return c("Total") * pnorm((x - c("Mean")) / c("SD"));
    case "sum-of-two-lorentzians":
      return (
        c("Amplitude1") / (1 + ((x - c("Center1")) / c("Width1")) ** 2) +
        c("Amplitude2") / (1 + ((x - c("Center2")) / c("Width2")) ** 2)
      );
    case "standard-sine-wave":
      return c("Amplitude") * Math.sin((2 * Math.PI * x) / c("Wavelength") + c("PhaseShift"));
    case "damped-sine-wave":
      return (
        c("Amplitude") *
        Math.exp(-c("K") * x) *
        Math.sin((2 * Math.PI * x) / c("Wavelength") + c("PhaseShift"))
      );
    case "sinc":
      return x === 0
        ? c("Amplitude")
        : (c("Amplitude") * Math.sin((2 * Math.PI * x) / c("Wavelength"))) /
            ((2 * Math.PI * x) / c("Wavelength"));
    case "boltzmann-sigmoid":
      return c("Bottom") + (c("Top") - c("Bottom")) / (1 + Math.exp((c("V50") - x) / c("Slope")));
    case "lorentzian":
      return c("Amplitude") / (1 + ((x - c("Center")) / c("Width")) ** 2);
    case "sine-wave":
      return c("Amplitude") * Math.sin((2 * Math.PI * x) / c("Wavelength") + c("PhaseShift")) + c("Baseline");
    case "michaelis-menten":
      return (c("Vmax") * x) / (c("Km") + x);
    case "allosteric-sigmoidal":
      return (c("Vmax") * x ** c("HillSlope")) / (c("Khalf") ** c("HillSlope") + x ** c("HillSlope"));
    case "substrate-inhibition":
      return (c("Vmax") * x) / (c("Km") + x + x ** 2 / c("Ki"));
    // Binding competition (plan 28): both Hill slopes fixed at −1 (Prism's
    // built-in two-site model — see modelSpec in stats/xy/nonlinear-fit.ts).
    case "two-site-competition-logx": {
      const frac = c("FractionHi");
      return (
        bottom +
        rise * (frac / (1 + 10 ** (x - c("LogIC50Hi"))) + (1 - frac) / (1 + 10 ** (x - c("LogIC50Lo"))))
      );
    }
    case "two-site-competition-x": {
      const frac = c("FractionHi");
      return bottom + rise * (frac / (1 + x / c("IC50Hi")) + (1 - frac) / (1 + x / c("IC50Lo")));
    }
    case "homologous-competition-logx": {
      const l = ligandConcentration ?? NaN;
      return (c("Bmax") * l) / (l + 10 ** x + 10 ** c("LogKd")) + c("Bottom");
    }
  }
}

/** A data set's center for a centered polynomial: its own mean X
 *  (fit.centeredXs, parallel to fit.fit.sets), falling back to the
 *  single scalar fit.centeredX for single-set fits and older files
 *  (Round 2 Issue 62 — the old code passed fit.centeredX, the first
 *  set's center, for every set). */
function centerForSet(fit: AnalysisResult, setName: string): number | undefined {
  const idx = (fit.fit?.sets ?? []).indexOf(setName);
  if (idx >= 0 && fit.centeredXs?.[idx] != null) return fit.centeredXs[idx];
  return fit.centeredX;
}

/** Evenly-spaced points across [xMin, xMax] tracing the fitted curve. */
function fittedCurve(
  model: NonlinearModel,
  coefficients: RegressionCoefficient[],
  xMin: number,
  xMax: number,
  steps = 100,
  ligandConcentration?: number,
  customEquation?: string,
  centeredX?: number,
): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const x0 = xMin + ((xMax - xMin) * i) / steps;
    x.push(x0);
    y.push(evaluate(model, coefficients, x0, ligandConcentration, customEquation, centeredX));
  }
  return { x, y };
}

/** The X values a fitted curve draws over: log-X curves need X > 0, raw
 *  ratio curves need X ≥ 0 (X = 0 is their Bottom), everything else any X. */
const keepCurveX = (model: NonlinearModel, v: number) =>
  positiveXOnly(model) ? v > 0 : nonNegativeXOnly(model) ? v >= 0 : true;

/** A data set's lines of a fit's note, as the analysis reports them: its derived values (an
 *  EC50, a half-life…, not a Span), then the coefficients they don't already say (a
 *  dose-response's Bottom, Top and log midpoint), then R². `set`: its column in the fit,
 *  `coefficients` its own. (Upstream 1.0.9.) */
function curveLines(fit: AnalysisResult, set: number, coefficients: RegressionCoefficient[]): string[] {
  const rows = fit.fit?.rows ?? [];
  const derived = rows.filter(
    (r) => r.values && r.label !== "Span" && rows.indexOf(r) < rows.findIndex((x) => x.label === "R squared"),
  );
  const said = new Set(["Bottom", "Top", "LogEC50", "LogIC50"]);
  const lines = [
    ...derived.map((r) => `${r.label} = ${num(r.values![set])}`),
    ...coefficients.filter((c) => !said.has(c.term)).map((c) => `${c.term} = ${num(c.estimate)}`),
  ];
  const r2 = rows.find((r) => r.label === "R squared")?.values?.[set];
  if (r2 != null) lines.push(`R² = ${num(r2)}`);
  return lines;
}

/** "EC50 = 12.3<br>Hill slope = 1.05<br>R² = 0.9821" annotation text (Plotly-ready), as the
 *  analysis reports them: one data set's lines, from curveLines. */
function curveLabel(fit: AnalysisResult): string {
  return curveLines(fit, 0, fit.coefficients ?? []).join("<br>");
}

/** Draws `model`'s fitted curve of each data set fitted (`fitted`, by name) against `x`
 *  under the points, in its color (`ys`, the graph's Y series, places it in the palette),
 *  and their note when `note`: one data set's values one per line, several's one line
 *  each, after its name. (Upstream 1.0.9, with our fittedCurve's grid; the ROUT
 *  hollow-out is still skipped — the fits now carry curveOutliers, but hollowing
 *  out the excluded points on the scatter is GUI work for the v2 combined
 *  verification. The multi-Y reference check drives this; the app's scatter uses
 *  addFittedCurve for the same curves.) */
export function addFittedCurves(
  fig: GraphFigure,
  x: Column,
  fitted: string[],
  ys: DataSet[],
  model: NonlinearModel,
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const all = fit.coefficients ?? [];
  const many = fitted.length > 1;
  const notes: string[] = [];
  const curves = fitted.flatMap((name, i) => {
    const y = ys.find((s) => s.name === name);
    // Several data sets' coefficients are named after each ("A — Top").
    const coefficients = many
      ? all.filter((c) => c.term.startsWith(`${name} — `)).map((c) => ({ ...c, term: c.term.slice(name.length + 3) }))
      : all;
    const xs = y ? xyPoints(x, y).x.filter((v) => keepCurveX(model, v)) : [];
    if (!y || !xs.length || !coefficients.some((c) => c.estimate != null)) return [];
    const lines = curveLines(fit, i, coefficients);
    notes.push(many ? `${name}: ${lines.join(", ")}` : lines.join("<br>"));
    const curve = fittedCurve(model, coefficients, ...extent(xs), 100, fit.ligandConcentration, fit.customEquation, centerForSet(fit, name));
    return [
      {
        type: "scatter",
        mode: "lines",
        x: curve.x,
        y: curve.y,
        line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
        hoverinfo: "skip",
        showlegend: false,
      },
    ];
  });
  if (!curves.length) return;
  fig.data = [...curves, ...fig.data];
  if (note) addNote(fig, notes.join("<br>"), options);
}

/** Draws `model`'s fitted curve of `y` against `x` under the points, in `y`'s color (`ys`,
 *  the graph's Y series, places it in the palette), and its note when `note`. A global
 *  fit (`fit.fit.sets` with > 1 series) draws one curve per series, each in its
 *  series' color, from that series' coefficients, and no single-curve note. */
export function addFittedCurve(
  fig: GraphFigure,
  x: Column,
  y: DataSet,
  ys: DataSet[],
  model: NonlinearModel,
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const coefficients = fit.coefficients ?? [];
  if (!coefficients.length) return;
  // The homologous curve needs [L], which the fit carries — without it,
  // there is no curve to draw.
  if (model === "homologous-competition-logx" && fit.ligandConcentration == null) return;
  const sets = fit.fit?.sets ?? [];
  if (sets.length > 1) {
    for (const setName of sets) {
      const yCol = ys.find((c) => c.name === setName) ?? y;
      const xs = xyPoints(x, yCol).x.filter((v) => keepCurveX(model, v));
      if (!xs.length) continue;
      const curve = fittedCurve(model, coefficientsForSet(coefficients, setName, sets), ...extent(xs), 100, fit.ligandConcentration, fit.customEquation, centerForSet(fit, setName));
      fig.data = [
        {
          type: "scatter",
          mode: "lines",
          x: curve.x,
          y: curve.y,
          line: { color: paint.color(yCol.name, ys.indexOf(yCol)), width: 1.5 },
          hoverinfo: "skip",
          showlegend: false,
        },
        ...fig.data,
      ];
    }
    return;
  }
  const xs = xyPoints(x, y).x.filter((v) => keepCurveX(model, v));
  if (!xs.length) return;
  const curve = fittedCurve(model, coefficients, ...extent(xs), 100, fit.ligandConcentration, fit.customEquation, centerForSet(fit, y.name));
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      x: curve.x,
      y: curve.y,
      line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    },
    ...fig.data,
  ];
  if (note) addNote(fig, curveLabel(fit), options);
}

/** The probability a logistic regression gives Y = 1 at `x`, from R's coefficients (B0, B1).
 *  (Upstream 1.0.9; the S-curve overlay for its logistic-regression analysis.) */
export function logisticAt(coefficients: RegressionCoefficient[], x: number): number {
  const [b0, b1] = coefficients.map((c) => c.estimate ?? NaN);
  return 1 / (1 + Math.exp(-(b0 + b1 * x)));
}

/** Draws a logistic regression's S curve of `y` (0s and 1s) against `x` under the points, in
 *  `y`'s color, and its note when `note`: the odds ratio, the X at 50% and McFadden
 *  pseudo-R². The note reads the stat labels the logistic-regression analysis
 *  actually emits ("Odds ratio (per 1 unit X)", "McFadden pseudo-R²"); the X at
 *  50% is no emitted stat, so it is computed from the coefficients (−b0/b1) —
 *  the old labels matched nothing the analysis emits, so the note always read —. */
export function addLogisticCurve(
  fig: GraphFigure,
  x: Column,
  y: DataSet,
  ys: DataSet[],
  fit: AnalysisResult,
  note: boolean,
  options: GraphOptions,
  paint: Paint,
) {
  const coefficients = fit.coefficients ?? [];
  const xs = xyPoints(x, y).x;
  if (coefficients.length !== 2 || !xs.length) return;
  const curve = curveXs(xs, options.xScale, 100);
  fig.data = [
    {
      type: "scatter",
      mode: "lines",
      x: curve,
      y: curve.map((x0) => logisticAt(coefficients, x0)),
      line: { color: paint.color(y.name, ys.indexOf(y)), width: 1.5 },
      hoverinfo: "skip",
      showlegend: false,
    },
    ...fig.data,
  ];
  const stat = (label: string) => num(fit.stats.find((s) => s.label === label)?.value);
  // X at 50% probability is where b0 + b1·x = 0: −b0/b1, from the fitted
  // coefficients (Intercept, then the X slope) — no stat row carries it.
  const b0 = coefficients[0]?.estimate ?? null;
  const b1 = coefficients[1]?.estimate ?? null;
  const x50 = b0 == null || b1 == null || b1 === 0 ? null : -b0 / b1;
  if (note)
    addNote(
      fig,
      `Odds ratio = ${stat("Odds ratio (per 1 unit X)")}<br>X at 50% = ${num(x50)}<br>` +
        `McFadden pseudo-R² = ${stat("McFadden pseudo-R²")}`,
      options,
    );
}
