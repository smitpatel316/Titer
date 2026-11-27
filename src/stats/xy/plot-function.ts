// "Plot a function" (Prism's Generate Curve → Plot a function, v2 item 14):
// curves from an equation + parameters, no data analysed. Pure TypeScript —
// no R: the nonlinear models evaluate through the same `evaluate()` the
// fitted-curve overlay uses, and the Gaussian (Prism's canonical example,
// which the fitter does not offer) evaluates here. Seq 203 adds Prism's
// statistical distributions (FAQ 1578): the normal (z), Student's t, F and
// chi-square densities and the binomial + Poisson mass functions, from
// `../distributions` (log-gamma only, no R).
import type {
  AnalysisOutcome,
  GeneratedCurve,
  NonlinearModel,
  PlotFunctionDistribution,
  PlotFunctionExtra,
  PlotFunctionModel,
  PlotFunctionParams,
} from "../types";
import { PLOT_FUNCTION_DISCRETE_DISTRIBUTIONS, PLOT_FUNCTION_DISTRIBUTIONS } from "../types";
import { binomialPmf, chiSquarePdf, fPdf, normalPdf, poissonPmf, tPdf } from "../distributions";
import { modelSpec } from "./nonlinear-fit";
import { MODEL_LABEL, nonNegativeXOnly, positiveXOnly, termLabel } from "./nonlinear-regression";
import { evaluateUserEquation, parseUserEquation } from "./user-defined";
import { evaluate } from "../../views/graphs/fitted-curve";
import { NONLINEAR_MODELS } from "../types";

/** Whether the model is one of Prism's statistical distributions (seq 203),
 *  rather than a curve equation. */
export const isDistributionModel = (model: PlotFunctionModel): model is PlotFunctionDistribution =>
  (PLOT_FUNCTION_DISTRIBUTIONS as readonly string[]).includes(model);

/** Whether the distribution is discrete (binomial, Poisson): its X grid is
 *  the whole numbers in the range, one point each. */
export const isDiscreteDistribution = (model: PlotFunctionModel): boolean =>
  (PLOT_FUNCTION_DISCRETE_DISTRIBUTIONS as readonly string[]).includes(model);

/** The equations the wizard offers, in Prism's spirit: the fitter's whole
 *  library (which now includes the Gaussian and the other classic curves),
 *  user-defined last among the curves — its parameters come from the
 *  equation the wizard asks for next — then the distributions. */
export const PLOT_FUNCTION_MODELS: PlotFunctionModel[] = [
  ...NONLINEAR_MODELS,
  ...PLOT_FUNCTION_DISTRIBUTIONS,
];

/** The equation's plain-language name, as the wizard, the results and the graph note show it. */
export const PLOT_FUNCTION_LABEL: Record<PlotFunctionModel, string> = {
  ...MODEL_LABEL,
  gaussian: "Gaussian",
  "normal-distribution": "Normal distribution",
  "t-distribution": "Student's t distribution",
  "f-distribution": "F distribution",
  "chi-square-distribution": "Chi-square distribution",
  "binomial-distribution": "Binomial distribution",
  "poisson-distribution": "Poisson distribution",
};

/** A Gaussian's parameters, in the order the wizard asks them. */
const GAUSSIAN_PARAMS = ["Amplitude", "Mean", "SD"] as const;

/** The distribution parameters, in the order the wizard asks them (seq 203):
 *  the normal's mean/SD (default 0/1: the standard normal, z), the t and
 *  chi-square degrees of freedom, the F numerator/denominator degrees of
 *  freedom, the binomial's trials n and success probability p, the Poisson's
 *  mean λ. */
const DISTRIBUTION_PARAMS: Record<PlotFunctionDistribution, readonly string[]> = {
  "normal-distribution": ["Mean", "SD"],
  "t-distribution": ["DF"],
  "f-distribution": ["DF1", "DF2"],
  "chi-square-distribution": ["DF"],
  "binomial-distribution": ["N", "P"],
  "poisson-distribution": ["Lambda"],
};

/** The parameter names the wizard asks for, in order: the model's terms —
 *  plus "X0" for the segmental-linear hinge, which the fitter derives from
 *  the data (a breakpoint) instead of fitting, so the plotter asks for it
 *  outright — and "XCenter" for the centered polynomials, derived the
 *  same way (the mean of X). A user-defined equation's parameters are the
 *  names its equation uses, in first-appearance order — none when the
 *  equation is missing or unparseable, so the wizard asks for nothing per
 *  curve rather than guessing names. */
export function plotFunctionParams(model: PlotFunctionModel, customEquation?: string): string[] {
  if (isDistributionModel(model)) return [...DISTRIBUTION_PARAMS[model]];
  if (model === "gaussian") return [...GAUSSIAN_PARAMS];
  if (model === "user-defined") {
    if (!customEquation?.trim()) return [];
    const parsed = parseUserEquation(customEquation);
    return "error" in parsed ? [] : [...parsed.params];
  }
  const terms = modelSpec(model).terms;
  if (model === "segmental-linear") return [...terms, "X0"];
  if (model.startsWith("centered-")) return [...terms, "XCenter"];
  return terms;
}

/** The wizard's starting parameter values, per model: Prism's usual
 *  dose-response shape (Bottom 0, Top 100, midpoint 0 or 1, slope 1) and a
 *  unit-scale curve elsewhere — the user edits them per curve. */
export const PLOT_FUNCTION_DEFAULTS: Record<PlotFunctionModel, Record<string, number>> = {
  line: { Intercept: 0, Slope: 1 },
  "semilog-line": { Intercept: 0, Slope: 1 },
  "line-through-origin": { Slope: 1 },
  "horizontal-line": { Mean: 0 },
  "semilog-y-log": { Intercept: 0, Slope: 1 },
  "log-log-line": { Intercept: 0, Slope: 1 },
  "exponential-growth-log": { Intercept: 0, Slope: 1 },
  hyperbola: { Bmax: 100, Kd: 10 },
  quadratic: { B0: 0, B1: 1, B2: 0 },
  cubic: { B0: 0, B1: 1, B2: 0, B3: 0 },
  quartic: { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0 },
  quintic: { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0, B5: 0 },
  sextic: { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0, B5: 0, B6: 0 },
  "centered-first": { B0: 0, B1: 1, XCenter: 0 },
  "centered-second": { B0: 0, B1: 1, B2: 0, XCenter: 0 },
  "centered-third": { B0: 0, B1: 1, B2: 0, B3: 0, XCenter: 0 },
  "centered-fourth": { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0, XCenter: 0 },
  "centered-fifth": { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0, B5: 0, XCenter: 0 },
  "centered-sixth": { B0: 0, B1: 1, B2: 0, B3: 0, B4: 0, B5: 0, B6: 0, XCenter: 0 },
  "segmental-linear": { B0: 0, B1: 1, B2: 0, X0: 0 },
  "sigmoidal-4pl-logx": { Bottom: 0, Top: 100, LogEC50: 0, HillSlope: 1 },
  "sigmoidal-4pl-x": { Bottom: 0, Top: 100, EC50: 1, HillSlope: 1 },
  "agonist-3pl-logx": { Bottom: 0, Top: 100, LogEC50: 0 },
  "inhibitor-3pl-logx": { Bottom: 0, Top: 100, LogIC50: 0 },
  "agonist-3pl-x": { Bottom: 0, Top: 100, EC50: 1 },
  "inhibitor-3pl-x": { Bottom: 0, Top: 100, IC50: 1 },
  "agonist-3pl-normalized-logx": { LogEC50: 0 },
  "agonist-4pl-normalized-logx": { LogEC50: 0, HillSlope: 1 },
  "agonist-3pl-normalized-x": { EC50: 1 },
  "agonist-4pl-normalized-x": { EC50: 1, HillSlope: 1 },
  "inhibitor-3pl-normalized-logx": { LogIC50: 0 },
  "inhibitor-4pl-normalized-logx": { LogIC50: 0, HillSlope: 1 },
  "inhibitor-3pl-normalized-x": { IC50: 1 },
  "inhibitor-4pl-normalized-x": { IC50: 1, HillSlope: 1 },
  "biphasic-logx": { Bottom: 0, Top: 100, LogEC50_1: -1, LogEC50_2: 1, nH1: 1, nH2: 1, Frac: 0.5 },
  "biphasic-x": { Bottom: 0, Top: 100, EC50_1: 0.1, EC50_2: 10, nH1: 1, nH2: 1, Frac: 0.5 },
  "bell-shaped-logx": { Plateau1: 100, Plateau2: 100, Dip: 0, LogEC50_1: -1, LogEC50_2: 1, nH1: 1, nH2: 1 },
  "bell-shaped-x": { Plateau1: 100, Plateau2: 100, Dip: 0, EC50_1: 0.1, EC50_2: 10, nH1: 1, nH2: 1 },
  "absolute-ic50-logx": { Bottom: 0, Top: 100, LogEC50: 0, HillSlope: 1 },
  "absolute-ic50-x": { Bottom: 0, Top: 100, EC50: 1, HillSlope: 1 },
  "pade-11": { A0: 1, A1: 1, B1: 1 },
  "power-series": { A: 1, B: 1, C: 1, D: 2 },
  "exponential-plateau": { Y0: 0, YM: 100, K: 0.1 },
  "beta-growth-decay": { Wmax: 100, Te: 1, Tm: 0.5 },
  "lq-fraction-surviving": { A: 0.1, B: 0.01 },
  "lq-percent-surviving": { A: 0.1, B: 0.01 },
  "lq-fraction-dead": { A: 0.1, B: 0.01 },
  "lq-percent-dead": { A: 0.1, B: 0.01 },
  "lq-count-alive": { A: 0.1, B: 0.01, Total: 100 },
  "lq-count-dead": { A: 0.1, B: 0.01, Total: 100 },
  "asymmetric-5pl-logx": { Bottom: 0, Top: 100, LogEC50: 0, HillSlope: 1, S: 1 },
  "asymmetric-5pl-x": { Bottom: 0, Top: 100, EC50: 1, HillSlope: 1, S: 1 },
  "exponential-growth": { Y0: 1, K: 0.1 },
  "logistic-growth": { Y0: 1, YM: 100, K: 0.1 },
  "gompertz-growth": { Y0: 1, YM: 100, K: 0.1 },
  "one-phase-decay": { Y0: 100, Plateau: 0, K: 0.1 },
  "two-phase-decay": { Plateau: 0, Span1: 50, K1: 1, Span2: 50, K2: 0.1 },
  "three-phase-decay": { Plateau: 0, Span1: 50, K1: 1, Span2: 30, K2: 0.1, Span3: 20, K3: 0.01 },
  "plateau-decay": { X0: 5, Y0: 100, Plateau: 0, K: 0.1 },
  "one-phase-association": { Y0: 0, Plateau: 100, K: 0.1 },
  "two-phase-association": { Y0: 0, Span1: 60, K1: 1, Span2: 40, K2: 0.1 },
  "plateau-association": { X0: 5, Y0: 0, Plateau: 100, K: 0.1 },
  "michaelis-menten": { Vmax: 100, Km: 10 },
  "allosteric-sigmoidal": { Vmax: 100, Khalf: 10, HillSlope: 1 },
  "substrate-inhibition": { Vmax: 100, Km: 10, Ki: 100 },
  "two-site-competition-logx": { Bottom: 0, Top: 100, LogIC50Hi: -9, LogIC50Lo: -6, FractionHi: 0.5 },
  "two-site-competition-x": { Bottom: 0, Top: 100, IC50Hi: 0.001, IC50Lo: 1, FractionHi: 0.5 },
  "homologous-competition-logx": { Bmax: 100, LogKd: -9, Bottom: 0 },
  gaussian: { Amplitude: 100, Mean: 0, SD: 1 },
  "boltzmann-sigmoid": { Bottom: 0, Top: 100, V50: 0, Slope: 1 },
  lorentzian: { Amplitude: 100, Center: 0, Width: 1 },
  "sine-wave": { Amplitude: 1, Wavelength: 10, PhaseShift: 0, Baseline: 0 },
  // 1.8 classic-curves completion (B6).
  "sum-of-two-gaussians": { Amplitude1: 100, Mean1: -1, SD1: 1, Amplitude2: 60, Mean2: 2, SD2: 1.5 },
  lognormal: { A: 100, GeoMean: 5, GeoSD: 2 },
  "cumulative-gaussian-percent": { Mean: 0, SD: 1 },
  "cumulative-gaussian-fraction": { Mean: 0, SD: 1 },
  "cumulative-gaussian-counts": { Mean: 0, SD: 1, Total: 100 },
  "sum-of-two-lorentzians": { Amplitude1: 100, Center1: -1, Width1: 1, Amplitude2: 60, Center2: 2, Width2: 1.5 },
  "standard-sine-wave": { Amplitude: 1, Wavelength: 10, PhaseShift: 0 },
  "damped-sine-wave": { Amplitude: 1, Wavelength: 10, PhaseShift: 0, K: 0.1 },
  sinc: { Amplitude: 1, Wavelength: 10 },
  // Distributions (seq 203): the standard normal, a t with 10 df, an
  // F(5, 10), a chi-square with 5 df, a binomial with 20 trials at p = 0.5,
  // a Poisson with mean 5.
  "normal-distribution": { Mean: 0, SD: 1 },
  "t-distribution": { DF: 10 },
  "f-distribution": { DF1: 5, DF2: 10 },
  "chi-square-distribution": { DF: 5 },
  "binomial-distribution": { N: 20, P: 0.5 },
  "poisson-distribution": { Lambda: 5 },
  // A user-defined equation's parameters are the names its equation uses —
  // no fixed set, so no fixed defaults: the wizard starts each at 1.
  "user-defined": {},
};

/** The wizard's starting X range, per model: log-X curves need X > 0, raw
 *  concentration curves X ≥ 0, everything else any X. Distributions (seq
 *  203): the normal and t over −4..4 (the standard normal's mass), the F
 *  over 0..5 and the chi-square over 0..20 (their right tails), the discrete
 *  ones over 0..20 (the binomial's 0..N at its default N, the Poisson's
 *  mass at its default λ). */
export function plotFunctionXRange(model: PlotFunctionModel): [number, number] {
  if (model === "gaussian") return [-3, 3];
  if (model === "normal-distribution" || model === "t-distribution") return [-4, 4];
  if (model === "f-distribution") return [0, 5];
  if (model === "chi-square-distribution") return [0, 20];
  if (model === "binomial-distribution" || model === "poisson-distribution") return [0, 20];
  if (positiveXOnly(model)) return [0.1, 10];
  if (nonNegativeXOnly(model)) return [0, 10];
  return [-10, 10];
}

/** The line segments Prism plots a curve with (its default): the wizard
 *  offers 10–1000. */
export const PLOT_FUNCTION_SEGMENTS = { default: 150, min: 10, max: 1000 };

/** The most curves in one family: the wizard asks one parameter question per
 *  curve, so more than 8 is a chore to step through. */
export const PLOT_FUNCTION_MAX_CURVES = 8;

/** The equation at `x`: the Gaussian here, the distributions (seq 203)
 *  through their density / mass functions, a user-defined equation
 *  through the fitter's own parser (`customEquation` — NaN when it is
 *  missing or unparseable, so the curve leaves a gap rather than throwing),
 *  the fitter's models through `evaluate()` (its coefficients take the
 *  display names — "Hill slope", not "HillSlope" — so the params are
 *  renamed on the way in). A value the equation cannot give (a log at
 *  X ≤ 0, a pole) is NaN, never thrown. */
export function evaluatePlotFunction(
  model: PlotFunctionModel,
  params: Record<string, number>,
  x: number,
  ligandConcentration?: number,
  customEquation?: string,
): number {
  if (model === "gaussian") {
    const sd = params.SD;
    if (sd === 0) return NaN;
    const z = (x - params.Mean) / sd;
    return params.Amplitude * Math.exp(-0.5 * z * z);
  }
  if (model === "user-defined") return evaluateUserEquation(customEquation ?? "", params, x);
  if (model === "normal-distribution") return normalPdf(x, params.Mean, params.SD);
  if (model === "t-distribution") return tPdf(x, params.DF);
  if (model === "f-distribution") return fPdf(x, params.DF1, params.DF2);
  if (model === "chi-square-distribution") return chiSquarePdf(x, params.DF);
  if (model === "binomial-distribution") return binomialPmf(x, params.N, params.P);
  if (model === "poisson-distribution") return poissonPmf(x, params.Lambda);
  return evaluate(
    model,
    Object.entries(params).map(([term, estimate]) => ({
      term: termLabel(term),
      estimate,
      stdError: null,
      t: null,
      p: null,
    })),
    x,
    ligandConcentration,
  );
}

/** A series' first derivative on its grid (central differences, one-sided at
 *  the ends): null where the value or a neighbour is undefined, so a gap in
 *  the curve is a gap in its derivative too. */
function derivative(xs: number[], ys: (number | null)[]): (number | null)[] {
  return ys.map((y, i) => {
    if (y == null) return null;
    if (i === 0) {
      const next = ys[1];
      return next == null ? null : (next - y) / (xs[1] - xs[0]);
    }
    if (i === ys.length - 1) {
      const prev = ys[i - 1];
      return prev == null ? null : (y - prev) / (xs[i] - xs[i - 1]);
    }
    const prev = ys[i - 1];
    const next = ys[i + 1];
    return prev == null || next == null ? null : (next - prev) / (xs[i + 1] - xs[i - 1]);
  });
}

/** A series' integral from the grid's start (cumulative trapezoid, 0 at the
 *  first X): each run of defined values integrates from 0 — across a gap
 *  (a pole, a log at X ≤ 0) the area is undefined, so the run after the gap
 *  restarts at 0 rather than carrying a made-up constant across it. */
function integral(xs: number[], ys: (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  let running = 0;
  let last: number | null = null;
  let lastX = xs[0];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (y == null || last == null) {
      // The first point of a run (or a gap): the integral restarts at 0.
      running = 0;
      out.push(y == null ? null : 0);
    } else {
      running += ((last + y) / 2) * (xs[i] - lastX);
      out.push(running);
    }
    if (y != null) {
      last = y;
      lastX = xs[i];
    } else {
      last = null;
    }
  }
  return out;
}

const EXTRA_LABEL: Record<PlotFunctionExtra, string> = {
  "first-derivative": "1st derivative",
  "second-derivative": "2nd derivative",
  integral: "Integral",
};

/** The extra series for one curve's Y, or undefined when none was asked for. */
function extraSeries(
  extra: PlotFunctionExtra | "none" | undefined,
  xs: number[],
  ys: (number | null)[],
  label: string,
): GeneratedCurve["extra"] {
  if (!extra || extra === "none") return undefined;
  const y =
    extra === "integral" ? integral(xs, ys) : extra === "first-derivative" ? derivative(xs, ys) : derivative(xs, derivative(xs, ys));
  return { kind: extra, label: `${label} (${EXTRA_LABEL[extra]})`, y };
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Generate the curves: validate the params (the wizard asks them, but a file
 *  can hold anything), evaluate each curve on the X grid, and carry the extra
 *  series when asked for. The parent table's columns are never read — this
 *  analysis needs no data. */
export async function runPlotFunction(
  params: PlotFunctionParams | undefined,
): Promise<AnalysisOutcome> {
  if (!params) return { error: "Choose an equation and its parameter values first." };
  const { equation: model, xMin, xMax } = params;
  if (!PLOT_FUNCTION_MODELS.includes(model))
    return { error: `“${String(model)}” is not an equation this analysis can plot.` };
  if (!finite(xMin) || !finite(xMax)) return { error: "Enter a starting and an ending X value." };
  if (xMin >= xMax) return { error: `The starting X (${xMin}) must be below the ending X (${xMax}).` };
  const segments = params.segments ?? PLOT_FUNCTION_SEGMENTS.default;
  if (!Number.isInteger(segments) || segments < PLOT_FUNCTION_SEGMENTS.min || segments > PLOT_FUNCTION_SEGMENTS.max)
    return {
      error: `The number of line segments must be a whole number from ${PLOT_FUNCTION_SEGMENTS.min} to ${PLOT_FUNCTION_SEGMENTS.max}.`,
    };
  const curves = params.curves ?? [];
  if (!curves.length) return { error: "Enter parameter values for at least one curve." };
  if (curves.length > PLOT_FUNCTION_MAX_CURVES)
    return { error: `Plot at most ${PLOT_FUNCTION_MAX_CURVES} curves in one family.` };
  if (model === "homologous-competition-logx" && !finite(params.ligandConcentration))
    return { error: "The homologous model needs the radioligand concentration [L] (greater than 0)." };
  if (model === "homologous-competition-logx" && params.ligandConcentration! <= 0)
    return { error: "The radioligand concentration [L] must be greater than 0." };
  // A user-defined equation plots through the fitter's own parser: without
  // an equation there is nothing to plot, and a bad one fails here with the
  // parser's message — the same message the fitter shows for it. Its
  // parameters are the names the equation uses, in first-appearance order.
  let names: string[];
  let userEquation: string | undefined;
  if (model === "user-defined") {
    userEquation = params.customEquation?.trim() ? params.customEquation.trim() : undefined;
    if (!userEquation)
      return { error: "Enter a user-defined equation first — for example “Y = A*exp(-k*X) + C”." };
    const parsed = parseUserEquation(userEquation);
    if ("error" in parsed) return { error: parsed.error };
    names = [...parsed.params];
  } else {
    names = plotFunctionParams(model);
  }
  for (const [i, curve] of curves.entries()) {
    const label = curve.label?.trim() ? curve.label.trim() : `Curve ${i + 1}`;
    for (const name of names) {
      const v = curve.params?.[name];
      if (!finite(v)) return { error: `“${label}” needs a number for ${name}.` };
    }
    if (model === "gaussian" && curve.params.SD <= 0)
      return { error: `“${label}”: the Gaussian's SD must be greater than 0.` };
    // Distributions (seq 203): the parameters a density / mass function
    // needs to exist — a non-positive SD or df, a non-whole N, a p outside
    // (0, 1), a non-positive λ.
    if (model === "normal-distribution" && curve.params.SD <= 0)
      return { error: `“${label}”: the normal distribution's SD must be greater than 0.` };
    if ((model === "t-distribution" || model === "chi-square-distribution") && curve.params.DF <= 0)
      return {
        error: `“${label}”: the ${model === "t-distribution" ? "t" : "chi-square"} distribution's degrees of freedom must be greater than 0.`,
      };
    if (model === "f-distribution" && (curve.params.DF1 <= 0 || curve.params.DF2 <= 0))
      return { error: `“${label}”: the F distribution's degrees of freedom must both be greater than 0.` };
    if (model === "binomial-distribution") {
      if (!Number.isInteger(curve.params.N) || curve.params.N < 1)
        return { error: `“${label}”: the binomial's number of trials N must be a whole number of 1 or more.` };
      if (curve.params.P <= 0 || curve.params.P >= 1)
        return { error: `“${label}”: the binomial's probability P must be between 0 and 1.` };
    }
    if (model === "poisson-distribution" && curve.params.Lambda <= 0)
      return { error: `“${label}”: the Poisson's mean λ must be greater than 0.` };
  }
  const extra = params.extra ?? "none";
  if (extra !== "none" && extra !== "first-derivative" && extra !== "second-derivative" && extra !== "integral")
    return { error: `“${String(extra)}” is not something this analysis can plot alongside the function.` };

  // The X grid: evenly spaced for a curve equation; the whole numbers in
  // the range for a discrete distribution (one point per whole number —
  // the line-segments setting does not apply to them, and a range holding
  // fewer than 2 whole numbers plots nothing).
  const discrete = isDiscreteDistribution(model);
  const x: number[] = [];
  if (discrete) {
    const lo = Math.max(0, Math.ceil(xMin));
    const hi = Math.floor(xMax);
    if (hi - lo + 1 < 2)
      return {
        error: `A discrete distribution needs an X range holding at least 2 whole numbers — ${xMin} to ${xMax} holds ${Math.max(0, hi - lo + 1)}.`,
      };
    for (let v = lo; v <= hi; v++) x.push(v);
  } else {
    for (let i = 0; i <= segments; i++) x.push(xMin + ((xMax - xMin) * i) / segments);
  }
  const generated: GeneratedCurve[] = curves.map((curve, i) => {
    const label = curve.label?.trim() ? curve.label.trim() : `Curve ${i + 1}`;
    const y = x.map((x0) => {
      const v = evaluatePlotFunction(model, curve.params, x0, params.ligandConcentration, userEquation);
      return Number.isFinite(v) ? v : null;
    });
    return { label, y, extra: extraSeries(extra, x, y, label) };
  });
  const curveWord = generated.length === 1 ? "curve" : "curves";
  const extraWord =
    extra === "none" ? "" : `, with its ${EXTRA_LABEL[extra].toLowerCase()} plotted alongside`;
  const gridWord = discrete
    ? `one point per whole number from ${x[0]} to ${x[x.length - 1]}`
    : `X from ${xMin} to ${xMax} in ${segments} line segments`;
  const equationPhrase =
    model === "user-defined"
      ? `the user-defined equation “${userEquation}”`
      : `the ${PLOT_FUNCTION_LABEL[model]}${isDistributionModel(model) ? "" : " equation"}`;
  return {
    testType: "plot-function",
    subtitle: PLOT_FUNCTION_LABEL[model],
    summary:
      `Generated ${generated.length} ${curveWord} from ${equationPhrase}, ` +
      `${gridWord}${extraWord}. ` +
      `No data was analysed — the curves come from the parameter values below.`,
    stats: [
      ...(discrete
        ? [{ label: "X values", value: x.length }]
        : [{ label: "Line segments", value: segments }]),
      { label: "Curves", value: generated.length },
    ],
    groups: [],
    notes:
      "The curve is a set of X and Y coordinates joined by line segments — zooming into part of it " +
      "can look coarse, so re-run with more line segments when plotting only part of the range. " +
      "A blank Y is a point the equation cannot give (a logarithm at X ≤ 0, a pole); " +
      "the graph leaves a gap there instead of joining across it." +
      (isDistributionModel(model)
        ? discrete
          ? " Y is the probability of exactly that many successes or events — the values sum to 1."
          : " Y is the probability density — the area under the curve is 1."
        : ""),
    generatedCurves: { x, curves: generated },
    parameterValues: curves.map((curve, i) => ({
      label: curve.label?.trim() ? curve.label.trim() : `Curve ${i + 1}`,
      values: names.map((name) => ({ name, value: curve.params[name] })),
    })),
  };
}
