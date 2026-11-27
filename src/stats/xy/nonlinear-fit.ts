// The shared standard-curve fit: Prism's "Standard curves to interpolate"
// category, a curated set that fits reliably in WebR. Linear-in-parameters
// models (line, semilog, polynomials) fit with lm(); the sigmoidal and
// hyperbola forms fit with nls(). `runNonlinearRegression` builds on this —
// one fit, one set of numbers — as do the binding (plan 16), enzyme
// inhibition (plan 17) and global-fit runners, through `fitModelSpec`.
// Upstream 1.0.7's runner is merged in here (dedup, Nov 10): the 3PL/5PL
// models, the sign-aware 4PL HillSlope start, the dose-response `dose`
// shape for curve comparison, and derived quantities with their 95% CIs
// (upstream's `fit` block). The exponential (plan 08) and enzyme (plan 09)
// models keep their `algorithm="port"` fits and X = 0 retention — upstream's
// defaults fail or drop points there.
import type {
  AnalysisOutcome,
  Column,
  NonlinearDifficultFitHandling,
  NonlinearFitMethod,
  NonlinearModel,
  RegressionCoefficient,
  StatRow,
} from "../types";
import { rVec } from "../column/base";
import { datasetColumns, pairUp, splitXY, xyProblem } from "../../lib/dataset";
import { evalNamedVector, type RVector } from "../webr";
import { userDefinedSpec } from "./user-defined";

export const MODEL_LABEL: Record<NonlinearModel, string> = {
  line: "Line",
  "sigmoidal-4pl-logx": "Sigmoidal, 4PL, X is log(concentration)",
  "sigmoidal-4pl-x": "Sigmoidal, 4PL, X is concentration",
  "agonist-3pl-logx": "log(agonist) vs. response, standard slope (3PL)",
  "inhibitor-3pl-logx": "log(inhibitor) vs. response, standard slope (3PL)",
  // 1.8 classic-curves completion (B6 §Dose-response Stimulation/Inhibition).
  "agonist-3pl-x": "[Agonist] vs. response (three parameters)",
  "inhibitor-3pl-x": "[Inhibitor] vs. response (three parameters)",
  "agonist-3pl-normalized-logx": "log(agonist) vs. normalized response",
  "agonist-4pl-normalized-logx": "log(agonist) vs. normalized response -- Variable slope",
  "agonist-3pl-normalized-x": "[Agonist] vs. normalized response",
  "agonist-4pl-normalized-x": "[Agonist] vs. normalized response -- Variable slope",
  "inhibitor-3pl-normalized-logx": "log(inhibitor) vs. normalized response",
  "inhibitor-4pl-normalized-logx": "log(inhibitor) vs. normalized response -- Variable slope",
  "inhibitor-3pl-normalized-x": "[Inhibitor] vs. normalized response",
  "inhibitor-4pl-normalized-x": "[Inhibitor] vs. normalized response -- Variable slope",
  // 1.8 classic-curves completion (B6 §Dose-response Special, §Standard,
  // §Growth, §Linear quadratic, §Classic).
  "biphasic-logx": "Biphasic, X is log(concentration)",
  "biphasic-x": "Biphasic, X is concentration",
  "bell-shaped-logx": "Bell-shaped, X is log(concentration)",
  "bell-shaped-x": "Bell-shaped, X is concentration",
  "absolute-ic50-logx": "Absolute IC50, X is log(concentration)",
  "absolute-ic50-x": "Absolute IC50, X is concentration",
  "pade-11": "Pade (1,1) approximant",
  "power-series": "Power series",
  "exponential-plateau": "Exponential plateau",
  "beta-growth-decay": "Beta growth then decay",
  "lq-fraction-surviving": "Linear quadratic cell death (Y is fraction of cells surviving)",
  "lq-percent-surviving": "Linear quadratic survival (Y is percentage)",
  "lq-fraction-dead": "Linear quadratic cell death (Y is fraction of dead cells)",
  "lq-percent-dead": "Linear quadratic survival (Y is percentage cells dead)",
  "lq-count-alive": "Linear quadratic survival (Y is # alive cells)",
  "lq-count-dead": "Linear quadratic survival (Y is # dead cells)",
  "asymmetric-5pl-logx": "Asymmetric sigmoidal, 5PL, X is log(concentration)",
  "asymmetric-5pl-x": "Asymmetric sigmoidal, 5PL, X is concentration",
  "semilog-line": "Semilog line",
  hyperbola: "Hyperbola (X is concentration)",
  quadratic: "Second order polynomial (quadratic)",
  cubic: "Third order polynomial (cubic)",
  // Plan 29: lines & polynomials completion.
  "segmental-linear": "Segmental linear regression (two segments)",
  quartic: "Fourth order polynomial (quartic)",
  quintic: "Fifth order polynomial (quintic)",
  // 1.8 classic-curves completion (B6 §Lines, §Polynomial): the remaining
  // line forms and the sixth-order / centered polynomials.
  "line-through-origin": "Line through origin",
  "horizontal-line": "Horizontal line",
  "semilog-y-log": "Semilog line — X is linear, Y is log",
  "log-log-line": "Log-log line — X and Y both log",
  sextic: "Sixth order polynomial",
  "centered-first": "Centered first order polynomial (straight line)",
  "centered-second": "Centered second order polynomial (quadratic)",
  "centered-third": "Centered third order polynomial (cubic)",
  "centered-fourth": "Centered fourth order polynomial",
  "centered-fifth": "Centered fifth order polynomial",
  "centered-sixth": "Centered sixth order polynomial",
  "exponential-growth": "Exponential growth",
  "exponential-growth-log": "Exponential growth with log(population)",
  "logistic-growth": "Logistic growth",
  "gompertz-growth": "Gompertz growth",
  "one-phase-decay": "One-phase decay",
  "michaelis-menten": "Michaelis-Menten",
  // Prism's "Exponential" family (plan 08).
  "two-phase-decay": "Two-phase decay",
  "three-phase-decay": "Three-phase decay",
  "plateau-decay": "Plateau followed by one-phase decay",
  "one-phase-association": "One-phase association",
  "two-phase-association": "Two-phase association",
  "plateau-association": "Plateau followed by one-phase association",
  // Prism's "Enzyme kinetics — Substrate vs. velocity" (plan 09;
  // michaelis-menten's label already exists above).
  "allosteric-sigmoidal": "Allosteric sigmoidal",
  "substrate-inhibition": "Substrate inhibition",
  // Prism's "Other classic curves" (v2): Gaussian, Boltzmann sigmoid,
  // Lorentzian, sine wave — Prism's Curve Fitting Guide equations.
  gaussian: "Gaussian",
  "boltzmann-sigmoid": "Boltzmann sigmoid",
  lorentzian: "Lorentzian",
  "sine-wave": "Sine wave",
  // 1.8 classic-curves completion (B6): the rest of Prism's Gaussian
  // family (B6 §Gaussian) and Sine waves family (B6 §Sine waves).
  "sum-of-two-gaussians": "Sum of two Gaussians",
  lognormal: "Lognormal",
  "cumulative-gaussian-percent": "Cumulative Gaussian — Percents",
  "cumulative-gaussian-fraction": "Cumulative Gaussian — Fraction",
  "cumulative-gaussian-counts": "Cumulative Gaussian — Counts",
  "sum-of-two-lorentzians": "Sum of two Lorentzians",
  "standard-sine-wave": "Standard sine wave",
  "damped-sine-wave": "Damped sine wave",
  sinc: "Sinc()",
  // Prism's "Binding — Competition" (plan 28): two-site competition and
  // homologous competition. The one-site Fit logIC50 is the inhibitor 3PL
  // above; Fit Ki is a derived quantity on it (see modelSpec's opts).
  "two-site-competition-logx": "Two sites — Fit logIC50, X is log(concentration)",
  "two-site-competition-x": "Two sites — Fit logIC50, X is concentration",
  "homologous-competition-logx": "One site — Homologous, X is log(concentration)",
  // v2 item 23: the user types their own equation (user-defined.ts) — its spec is built
  // from the equation and starting values, not from a case below.
  "user-defined": "User-defined equation",
};

/** The exponential-curve models (plan 08): fitted with nls() algorithm
 *  "port" (see modelSpec) and carrying half-life / span derived rows. */
export const EXPONENTIAL_MODELS: NonlinearModel[] = [
  "one-phase-decay",
  "two-phase-decay",
  "three-phase-decay",
  "plateau-decay",
  "one-phase-association",
  "two-phase-association",
  "plateau-association",
  "exponential-growth",
];

/** The enzyme-kinetics models (plan 09): fitted with nls() algorithm
 *  "port" (see modelSpec). Unlike the log/ratio forms, their formulas are
 *  defined at X = 0, so the vehicle point stays in the fit — they set
 *  `nonNegativeX`, not `positiveX`; the positive-X values are used only for
 *  start values. `nonNegativeX` keeps the interpolation grid (and the
 *  point-estimate search) at X ≥ 0: below zero the allosteric form is NaN
 *  for a non-integer Hill slope and the Michaelis-Menten pole at −Km sits
 *  inside the grid (R3-10). */
export const ENZYME_MODELS: NonlinearModel[] = [
  "michaelis-menten",
  "allosteric-sigmoidal",
  "substrate-inhibition",
];

/** The other classic curves (v2): Prism's Gaussian, Boltzmann sigmoid,
 *  Lorentzian and sine-wave models. Fitted with nls() algorithm "port"
 *  like the plan 08/09 models: the default Gauss-Newton fails to converge
 *  on (near-)noiseless fits in WebR's R 4.6.0 even from exact starts,
 *  while "port" recovers the generating parameters. The width parameters
 *  (SD, Width, Wavelength) are bounded below at 0 — a negative width is
 *  meaningless (and for the Gaussian/Lorentzian the sign is unidentifiable,
 *  the formula depending on the square). */
export const CLASSIC_MODELS: NonlinearModel[] = [
  "gaussian",
  "boltzmann-sigmoid",
  "lorentzian",
  "sine-wave",
  // 1.8 classic-curves completion (B6): the rest of Prism's Gaussian and
  // Sine waves families — same "port" fits, same result shape.
  "sum-of-two-gaussians",
  "lognormal",
  "cumulative-gaussian-percent",
  "cumulative-gaussian-fraction",
  "cumulative-gaussian-counts",
  "sum-of-two-lorentzians",
  "standard-sine-wave",
  "damped-sine-wave",
  "sinc",
];

/** A derived quantity, as R expressions of the fit (`cf`, its coefficients;
 *  `pci(p)`, a coefficient's 95% CI; `V`, their covariance; `q`, the t
 *  critical value). `low`/`high` omitted: the quantity has no CI. */
export interface Derived {
  label: string;
  expr: string;
  low?: string;
  high?: string;
}

/** Seq 388: the fitted parameters a derived quantity's R expressions name
 *  (`cf[["LogEC50"]]`, `pci("K")`, `V["Top","Bottom"]`, `b[["K"]]` in a
 *  delta-method `dl(...)`) — in the spec's term order. Fixed parameters
 *  never appear: the effective spec substitutes them out of the
 *  expressions before the fit. */
export function derivedSources(d: Derived, terms: string[]): string[] {
  const names = new Set<string>();
  const hay = [d.expr, d.low ?? "", d.high ?? ""].join(" ");
  for (const m of hay.matchAll(/(?:cf|b)\[\["([^"]+)"\]\]|pci\("([^"]+)"\)|V\["([^"]+)"/g))
    names.add(m[1] ?? m[2] ?? m[3]!);
  for (const m of hay.matchAll(/V\["[^"]+","([^"]+)"\]/g)) names.add(m[1]!);
  return terms.filter((t) => names.has(t));
}

/** 10 to a log coefficient, its CI 10 to the coefficient's. */
const tenTo = (label: string, p: string): Derived => ({
  label,
  expr: `10^cf[["${p}"]]`,
  low: `10^pci("${p}")[1]`,
  high: `10^pci("${p}")[2]`,
});
/** `a` − `b`, its CI from both and their covariance. */
const difference = (a: string, b: string, label = "Span"): Derived => {
  const se = `sqrt(V["${a}","${a}"]+V["${b}","${b}"]-2*V["${a}","${b}"])`;
  const value = `cf[["${a}"]]-cf[["${b}"]]`;
  return { label, expr: value, low: `${value}-q*${se}`, high: `${value}+q*${se}` };
};
/** `a` + `b`, its CI from both and their covariance. */
const sumOf = (a: string, b: string, label = "Span"): Derived => {
  const se = `sqrt(V["${a}","${a}"]+V["${b}","${b}"]+2*V["${a}","${b}"])`;
  const value = `cf[["${a}"]]+cf[["${b}"]]`;
  return { label, expr: value, low: `${value}-q*${se}`, high: `${value}+q*${se}` };
};
const span = difference("Top", "Bottom");
/** Span for a normalized curve: Bottom=0, Top=100 by construction, so the
 *  span is the constant 100 (a derived row with no CI, like "X center"). */
const span100: Derived = { label: "Span", expr: "100" };
/** Absolute IC50: the X where the 4PL reads 50 in absolute units (not 50%
 *  of the span) — valid only when Top > 50 > Bottom, else NA. The logx
 *  form solves 10^((LogEC50−X)·H) = (Top−50)/(50−Bottom) and reports the
 *  concentration (10^X), like the EC50 derived; the x form solves
 *  (EC50/X)^H = (Top−50)/(50−Bottom). */
const absoluteIC50Logx: Derived = {
  label: "Absolute IC50",
  expr: `ifelse(cf[["Top"]]>50 & 50>cf[["Bottom"]],10^(cf[["LogEC50"]]-log10((cf[["Top"]]-50)/(50-cf[["Bottom"]]))/cf[["HillSlope"]]),NA_real_)`,
};
const absoluteIC50X: Derived = {
  label: "Absolute IC50",
  expr: `ifelse(cf[["Top"]]>50 & 50>cf[["Bottom"]],cf[["EC50"]]*((50-cf[["Bottom"]])/(cf[["Top"]]-50))^(1/cf[["HillSlope"]]),NA_real_)`,
};
/** Ki from a log midpoint: Ki = 10^LogIC50 / D, where D = 1 + [L]/Kd is a
 *  constant the wizard supplies — so log Ki's SE is logIC50's SE, and the
 *  Ki CI is 10^ the logIC50 CI, over D. (Cheng–Prusoff; plan 28.) */
const kiFromLog = (label: string, p: string, d: number): Derived => ({
  label,
  expr: `10^cf[["${p}"]]/${d}`,
  low: `10^pci("${p}")[1]/${d}`,
  high: `10^pci("${p}")[2]/${d}`,
});
/** Ki from a linear IC50: Ki = IC50 / D, its CI the IC50 CI over D. */
const kiFromLinear = (label: string, p: string, d: number): Derived => ({
  label,
  expr: `cf[["${p}"]]/${d}`,
  low: `pci("${p}")[1]/${d}`,
  high: `pci("${p}")[2]/${d}`,
});
/** A dose-response curve's ECF (F in %): where it has risen F % of the way from Bottom to
 *  Top (an inhibitor's ICF: F % inhibition), from its log midpoint, Hill slope and asymmetry
 *  (`dl`: its 95% CI by the delta method, the fit's covariance carried to it; at the fit,
 *  what refitting with log ECF as a parameter gives). On the log scale, then raised. */
export function ecAnything(model: NonlinearModel, f: number, ligandConcentration?: number): Derived {
  // A two-site competition curve has two midpoints, so ECx has no single
  // closed form — the old code indexed LogEC50/EC50 + HillSlope, none of
  // which a two-site fit has, and R died with "subscript out of bounds"
  // (Round 2 Issue 39). The runner refuses ecx on two-site models
  // before calling this; the throw is the backstop for direct callers.
  if (model === "two-site-competition-logx" || model === "two-site-competition-x")
    throw new Error(
      "ECx is not defined for a two-site competition curve — it has two midpoints (LogIC50Hi/LogIC50Lo, or IC50Hi/IC50Lo), so there is no single X at F% response.",
    );
  // A homologous competition curve is single-site in shape (fixed slope
  // −1 in log units): Y = Bmax·L/(L + 10^X + Kd) + Bottom, so the X at
  // F% displaced is log10(L + Kd) + log10(F/(100 − F)) — the cold
  // concentration displacing F% is (L + Kd)·F/(100 − F), not
  // (L + Kd)·(100 − F)/F, which is IC(100 − F) (Round 2 Issue 85). [L]
  // is the fit's ligand concentration (a literal when the runner passed
  // it, else the R variable L the homologous fit defines).
  if (model === "homologous-competition-logx") {
    const l =
      ligandConcentration != null && Number.isFinite(ligandConcentration) ? String(ligandConcentration) : "L";
    const at = `log10(${l}+10^b[["LogKd"]])+log10(${f}/(100-${f}))`;
    const d = `dl(function(b)${at})`;
    return {
      label: `IC${f}`,
      expr: `10^(${d}[1])`,
      low: `10^(${d}[2])`,
      high: `10^(${d}[3])`,
    };
  }
  const logX = model.endsWith("-logx");
  const [log, raise] = logX ? ["log10", (e: string) => `10^(${e})`] : ["log", (e: string) => `exp(${e})`];
  // 1.8: an inhibitor's midpoint is LogIC50 on log X but IC50 on raw X —
  // the old code read LogIC50/EC50 for every inhibitor-x model, which no
  // existing model hit (there was no inhibitor-x model); the normalized
  // and 3PL X models below do.
  const mid = model.startsWith("inhibitor") ? (logX ? "LogIC50" : "IC50") : logX ? "LogEC50" : "EC50";
  const at = logX ? `b[["${mid}"]]` : `log(b[["${mid}"]])`;
  const hill = model.includes("3pl") ? "1" : `b[["HillSlope"]]`;
  // Its shift from the midpoint: log(F / (100 − F)) / Hill slope; a 5PL's asymmetry moves it.
  const shift = model.startsWith("asymmetric")
    ? `(${log}(2^(1/b[["S"]])-1)-${log}(${f / 100}^(-1/b[["S"]])-1))/${hill}`
    : `${log}(${f}/${100 - f})/${hill}`;
  const d = `dl(function(b)${at}+${shift})`;
  return {
    label: `${model.startsWith("inhibitor") ? "IC" : "EC"}${f}`,
    expr: raise(`${d}[1]`),
    low: raise(`${d}[2]`),
    high: raise(`${d}[3]`),
  };
}

/** `c` / K (a half-life, a doubling time, tau), its CI `c` over K's: none when K's
 *  includes 0, the time then unbounded. The value is null when the fitted K ≤ 0. */
const overK = (label: string, c: string, k = "K"): Derived => {
  const ends = `sort(${c}/pci("${k}"))`;
  return {
    label,
    expr: `ifelse(cf[["${k}"]]>0,${c}/cf[["${k}"]],NA_real_)`,
    low: `if(prod(pci("${k}"))>0)${ends}[1] else NA`,
    high: `if(prod(pci("${k}"))>0)${ends}[2] else NA`,
  };
};
/** `f` × a coefficient (a FWHM from a width), its CI `f` × the
 *  coefficient's — the factor is positive, so the interval keeps its
 *  order. Null when the fitted coefficient ≤ 0. */
const scaled = (label: string, f: string, p: string): Derived => ({
  label,
  expr: `ifelse(cf[["${p}"]]>0,${f}*cf[["${p}"]],NA_real_)`,
  low: `ifelse(cf[["${p}"]]>0,${f}*pci("${p}")[1],NA_real_)`,
  high: `ifelse(cf[["${p}"]]>0,${f}*pci("${p}")[2],NA_real_)`,
});

/** Logistic growth's inflection point (Prism 11, seq 166): the X where the
 *  curve is steepest, Y = YM/2 — Prism's transform, Inflection Point =
 *  (1/K)·ln((YM−Y0)/Y0). Its 95% CI is the delta method (`dl`, like
 *  EC-anything): the value itself is the plain expression, the bounds the
 *  delta-method interval. Null when K ≤ 0, Y0 ≤ 0, or YM ≤ Y0 — the
 *  inflection is undefined there (and Prism's guide shorthand "1/K" is
 *  only the special case (YM−Y0)/Y0 = e). */
const inflectionPoint = (): Derived => {
  const f = (b: string) =>
    `ifelse(${b}[["K"]]>0 & ${b}[["YM"]]>${b}[["Y0"]] & ${b}[["Y0"]]>0,` +
    `log((${b}[["YM"]]-${b}[["Y0"]])/${b}[["Y0"]])/${b}[["K"]],NA_real_)`;
  const d = `dl(function(b)${f("b")})`;
  return { label: "Inflection point", expr: f("cf"), low: `${d}[2]`, high: `${d}[3]` };
};

/** R that assigns `m<-lm(...)` or `m<-nls(...,start=...)`; `x`/`y` are in scope. */
export interface ModelSpec {
  /** Which R fitter to use — lm() (linear in params) or nls() (nonlinear). */
  kind: "lm" | "nls";
  /** R that assigns `m<-lm(...)` or `m<-nls(...,start=...)`; `x`/`y` are in scope. */
  fit: string;
  /** Coefficient display names, in the order lm/nls reports them (positional extraction). */
  terms: string[];
  /** Derived quantities computed from the fit's named coefficients (`cf[["Name"]]`). */
  derived?: Derived[];
  /** Log-X curves fit the points with X > 0 only (log(0) is undefined). */
  positiveX?: boolean;
  /** Raw-concentration ratio curves (4PL/5PL X, hyperbola, two-site X, enzyme
   *  kinetics): defined at X = 0 — the vehicle point is the Bottom anchor, so
   *  it stays in the fit — but not at X < 0 (a fractional power of a negative
   *  is NaN in R). The enzyme models share the "defined at 0" half and set
   *  this flag (R3-10: without it the interpolation grid extended below zero,
   *  where allosteric-sigmoidal is NaN and Michaelis-Menten has its pole);
   *  their negative-X error still lives in prepareFit. */
  nonNegativeX?: boolean;
  /** Log-Y curves (1.8, B6 §Lines #6–7, §Growth #2): log(Y) is undefined
   *  at Y ≤ 0, so the fit drops those points (prepareFit, like the X
   *  flags) — and the fit is on the log scale, so interpolation is
   *  refused (the runner's lm predict() would return log-scale values). */
  positiveY?: boolean;
  /** True when the response is fitted on the log scale (log(Y) ~ …):
   *  the curve on the raw scale is exp() of the lm fit, so the lm
   *  predict() path (interpolation band inversion) must not run. */
  logY?: boolean;
  /** nls models only: R defining `g<-function(xv,p)` — the curve evaluated at
   *  X `xv` with parameter vector `p` (named, as `coef(m)` reports them).
   *  Used for the confidence band (delta method) and inverse prediction. */
  curveFn?: string;
  /** Coefficient names of the curve's lower/upper asymptotes (4PL only) —
   *  an unknown within the fit's residual scale of one is outside range. */
  asymptotes?: [string, string];
  /** nls models only: alternate `m<-nls(...)` assignments to retry, IN
   *  ORDER, when the primary fit fails. `fitModelSpec` tries each in turn
   *  and reports which one converged (`retryMethod`). The 4PLs chain the
   *  port optimizer first (prism-format parity: it fixes the Gauss-Newton
   *  stalls) and the relaxed tolerance second (Linux 4PL fix: the
   *  textbook dose data converges only that way — port fails it with
   *  "singular convergence (7)"). Order matters: the first success wins.
   *  Substrate inhibition retries once with its Ki start (plan 09). */
  retryFits?: { fit: string; method: string }[];
  /** A dose-response curve's formula (its right side) and midpoint, which
   *  comparing two curves shares (upstream 1.0.7). */
  dose?: { expr: string; midpoint: string };
  /** True when the model cannot be fitted without the radioligand
   *  concentration [L] (plan 28: homologous competition — [L] is a constant
   *  of its equation). The runner refuses before calling R when it is
   *  missing; other models take [L]/Kd only for the optional Fit-Ki
   *  derived rows (see modelSpec's opts). */
  needsRadioligand?: boolean;
}

// The 4PL's starting slope takes the curve's own sign, so a falling curve keeps Bottom under Top.
const SIGN = "if(isTRUE(cor(x,y)<0))-1 else 1";
const FOUR_LOG = "Bottom+(Top-Bottom)/(1+10^((LogEC50-x)*HillSlope))";
// Raw-concentration 4PL, guarded at X = 0 (prism-format-work (g)): the
// vehicle point stays in the fit, but (EC50/x) is Inf/NaN at x = 0
// whenever a trial step takes EC50 ≤ 0 with a fractional HillSlope — R's
// nls then dies with "Missing value or an infinity produced when
// evaluating the model" on datasets Prism fits (39 such failures in the
// corpus sweep). The guard is sign-aware: a rising curve (HillSlope > 0)
// tends to Bottom as X → 0+, a falling one (HillSlope < 0) to Top —
// forcing Bottom unconditionally injects a full-span residual jump at
// X = 0 on falling curves and biases the fit (Round 2 Issue 36). ifelse
// evaluates both branches, but a NaN in the unselected branch is
// discarded — the plateau-decay model already relies on this. The guard
// is arithmetic, not ifelse(HillSlope<0,Top,Bottom): ifelse returns the
// length of its test, so a shared/fixed (length-1) HillSlope truncates
// unshared Top[g]/Bottom[g] to length 1 in global fits and every group
// past the first takes Series 1's plateau at X = 0 (Round 2 Issue 86);
// Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0) keeps length(g).
const FOUR_X = "ifelse(x==0,(Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)),Bottom+(Top-Bottom)/(1+(EC50/x)^HillSlope))";
const nls200 = (expr: string, start: string) => `nls(y~${expr},start=${start},control=nls.control(maxiter=200))`;
/** The 4PL retry (Linux 4PL fix): the same nls call with a relaxed
 *  convergence tolerance. On near-perfect sigmoids the default tol=1e-5
 *  Gauss-Newton reaches the optimum, then stalls — the residual sum of
 *  squares is flat while the relative offset oscillates, step-halving
 *  bottoms out, and nls errors "step factor reduced below 'minFactor'".
 *  tol=1e-3 converges at the same optimum (verified in R and scipy). */
const nls200Tol = (expr: string, start: string) =>
  `nls(y~${expr},start=${start},control=nls.control(maxiter=200,tol=1e-3))`;
/** The 4PL gate fix (analytic-gradient retry): R's nls differentiates by
 *  forward differences (numericDeriv) with step delta = |theta| *
 *  sqrt(.Machine$double.eps). When a fitted parameter's value is within
 *  ~1e-8 of zero — LogEC50/LogIC50 = 0 exactly on the classic-curves 4PL
 *  fixtures (EC50/IC50 = 1) — delta collapses to ~1e-17, so
 *  f(theta+delta) == f(theta) in floating point and the gradient column
 *  comes out exactly zero: the first Gauss-Newton step lands on a singular
 *  gradient ("singular gradient"), and the port + relaxed-tolerance retries
 *  die the same way (they share the numeric gradient). deriv() supplies the
 *  exact analytic gradient instead, so the fit converges — but only with
 *  the relaxed tolerance: on noiseless data the relative-offset convergence
 *  test stalls at ~4e-05 (above tol = 1e-5), so this rung carries tol = 1e-3
 *  (verified in R: deriv + tol = 1e-3 converges to the generating values;
 *  deriv + default tol stalls at minFactor). Appended after the port/tol
 *  rungs, so it only runs when they all fail and never moves a passing fit.
 *  `theta` lists the start parameters, in start order, as R strings. */
const nlsDerivTol = (expr: string, start: string, theta: string) =>
  `m<-nls(y~eval(deriv(~${expr},${theta})),start=${start},control=nls.control(maxiter=200,tol=1e-3))`;

/** The polynomial models (seq 201): the only models `centered` applies to. */
export const POLYNOMIAL_MODELS = ["quadratic", "cubic", "quartic", "quintic", "sextic"] as const;
export const isPolynomialModel = (m: NonlinearModel): boolean =>
  (POLYNOMIAL_MODELS as readonly string[]).includes(m);

/** A polynomial fit of the given degree (Plan 29: base R lm, powers of X).
 *  Centered (seq 201) subtracts the mean of X first (`xm<-mean(x)`), so
 *  the terms are powers of (X − mean X): B0 is the fitted Y at the mean X
 *  and the higher terms are far less collinear. The fitted values and R²
 *  are unchanged — only the coefficients move. The uncentered strings are
 *  the historical ones, byte for byte. */
function polynomialSpec(degree: number, centered = false): ModelSpec {
  const terms = Array.from({ length: degree + 1 }, (_, i) => `B${i}`);
  const powers = Array.from({ length: degree - 1 }, (_, i) => i + 2);
  if (!centered)
    return { kind: "lm", fit: `m<-lm(y~x${powers.map((k) => `+I(x^${k})`).join("")})`, terms };
  // `xm` stays in scope for predict() on newdata — never I(x-mean(x))
  // inline, whose mean of a single new X is itself. The two statements
  // survive the retry ladder because retryChain braces each fit (a bare
  // `;` inside expression(...) is a parse error).
  return {
    kind: "lm",
    fit: `xm<-mean(x);m<-lm(y~I(x-xm)${powers.map((k) => `+I((x-xm)^${k})`).join("")})`,
    terms,
  };
}

export function modelSpec(
  model: NonlinearModel,
  opts?: {
    /** Cheng–Prusoff divisor D = 1 + [L]/Kd (plan 28): when supplied, the
     *  competition models gain Ki derived rows (Ki = IC50 / D). */
    kiDivisor?: number;
    /** Radioligand concentration [L] (plan 28, homologous only): embedded
     *  as an R literal in its fit / curve / derived expressions, so every
     *  path that uses the spec (single fit, comparison, interpolation)
     *  sees the same constant. Absent, the expressions use the R variable
     *  `L` instead — the runner must then define it (it always supplies
     *  opts, after validating [L] > 0). */
    ligandConcentration?: number;
    /** User-defined equation (v2 item 23, model "user-defined" only): the equation as
     *  the user typed it, and each named parameter's starting value. Both are
     *  required — without them the spec cannot be built. */
    customEquation?: string;
    customParameters?: Record<string, number>;
    /** Center the polynomial (seq 201): fit powers of (X − mean X) instead
     *  of powers of X. Polynomials only — the runner refuses it elsewhere. */
    centered?: boolean;
  },
): ModelSpec {
  // v2 item 23: the spec comes from the user's equation, not a curated case.
  if (model === "user-defined") {
    if (opts?.customEquation === undefined || opts?.customParameters === undefined)
      throw new Error(
        "A user-defined equation needs its equation and every parameter's starting value — enter both before fitting.",
      );
    return userDefinedSpec(opts.customEquation, opts.customParameters);
  }
  switch (model) {
    case "line":
      return { kind: "lm", fit: "m<-lm(y~x)", terms: ["Intercept", "Slope"] };
    case "line-through-origin":
      // B6 §Lines #3: Y = Slope·X, no intercept — lm without one.
      return { kind: "lm", fit: "m<-lm(y~x-1)", terms: ["Slope"] };
    case "horizontal-line":
      // B6 §Lines #4: Y = Mean — lm on the intercept alone.
      return { kind: "lm", fit: "m<-lm(y~1)", terms: ["Mean"] };
    case "semilog-y-log":
      // B6 §Lines #6: log(Y) = Intercept + Slope·X — the log-Y twin of
      // semilog-line (which logs X, not Y). Y ≤ 0 points are dropped.
      return { kind: "lm", fit: "m<-lm(log(y)~x)", terms: ["Intercept", "Slope"], positiveY: true, logY: true };
    case "log-log-line":
      // B6 §Lines #7: log(Y) = Intercept + Slope·log(X) — a power law
      // Y = exp(Intercept)·X^Slope on the raw scale.
      return {
        kind: "lm",
        fit: "m<-lm(log(y)~log(x))",
        terms: ["Intercept", "Slope"],
        positiveX: true,
        positiveY: true,
        logY: true,
      };
    case "exponential-growth-log":
      // B6 §Growth #2: "Exponential growth with log(population)" — the
      // same log(Y) ~ X fit as semilog-y-log, a separate entry because
      // Prism lists it under Growth curves, not Lines (the
      // Michaelis-Menten/hyperbola precedent: one equation, two names).
      return { kind: "lm", fit: "m<-lm(log(y)~x)", terms: ["Intercept", "Slope"], positiveY: true, logY: true };
    case "quadratic":
      return polynomialSpec(2, opts?.centered);
    case "cubic":
      return polynomialSpec(3, opts?.centered);
    case "quartic":
      // Plan 29: 4th order polynomial — base R lm, the exact pattern of
      // the quadratic/cubic entries.
      return polynomialSpec(4, opts?.centered);
    case "quintic":
      // Plan 29: 5th order polynomial — same pattern, one degree higher.
      // (Gate fix: this used to hardcode the uncentered fit and ignore
      // opts.centered, so a centered quintic reported the raw intercept
      // as B0 — route through polynomialSpec like quadratic..quartic.)
      return polynomialSpec(5, opts?.centered);
    case "sextic":
      // B6 §Polynomial #11: 6th order polynomial — one degree higher
      // again, same lm pattern (and the same centered routing as the
      // quintic — the hardcoded uncentered fit reported B0 = 2, the raw
      // intercept, for a centered sextic whose B0 is 39.73).
      return polynomialSpec(6, opts?.centered);
    case "centered-first":
    case "centered-second":
    case "centered-third":
    case "centered-fourth":
    case "centered-fifth":
    case "centered-sixth": {
      // B6 §Polynomial #2,4,6,8,10,12: the centered polynomials — same
      // curve as the uncentered same degree, but fitted on X − mean(X),
      // so B0 is Y at the X mean (not at X = 0) and the coefficients are
      // far less collinear. `xc` is assigned in the fit string, then the
      // lm formula reads it from the formula environment — never
      // `I(x-mean(x))` directly, which would break predict() on newdata
      // (the mean of a single new X is itself). The X center is a derived
      // value, reported as a coefficient row like the segmental X0.
      const degree =
        model === "centered-first"
          ? 1
          : model === "centered-second"
            ? 2
            : model === "centered-third"
              ? 3
              : model === "centered-fourth"
                ? 4
                : model === "centered-fifth"
                  ? 5
                  : 6;
      const powers = Array.from({ length: degree }, (_, i) =>
        i === 0 ? "I(x-xc)" : `I((x-xc)^${i + 1})`,
      ).join("+");
      return {
        kind: "lm",
        fit: `xc<-mean(x);m<-lm(y~${powers})`,
        terms: Array.from({ length: degree + 1 }, (_, i) => `B${i}`),
        derived: [{ label: "X center", expr: "xc" }],
      };
    }
    case "segmental-linear":
      // Plan 29: continuous two-segment line (hinge), Y = B0 + B1·X +
      // B2·max(X − X0, 0): slope B1 below the breakpoint X0, B1+B2 above.
      // DEVIATION from the plan: the plan fits this with nls() from
      // B2 = 0, X0 = median(X) starts — that does not converge. At B2 = 0
      // the X0 gradient is zero ("singular gradient matrix at initial
      // parameter estimates"), and from a slope-difference B2 start (or
      // algorithm="port", or "plinear") Gauss-Newton stalls on the flat
      // RSS surface ("step factor reduced below 'minFactor'" / "false
      // convergence") — verified in R on the reference data from every
      // start (x0 = 2, 3.5, 5, 6; B2 = 0, 0.09, ±0.5). The model is
      // linear given X0, so X0 is fitted by profiling instead: optimize()
      // (Brent, derivative-free) minimises the conditional-lm RSS over
      // [min X, max X], and the fit is the lm at that breakpoint. X0 is
      // therefore a derived value with no standard error (the runner
      // reports it as a coefficient row with no SE — the fixed-parameter
      // precedent), and a global fit is not supported for it
      // (formulaVariables is undefined for this multi-statement fit, so
      // runGlobalNonlinear refuses it cleanly). The slopes' CIs are
      // positional (cf[[2]], cf[[3]]) because lm() names the hinge term
      // "I(pmax(x - brk, 0))", not "b2". `brk` (not `x0`) names the
      // breakpoint variable, so it cannot collide with the curve-
      // comparison code's x0/y0/x1/y1 vectors.
      return {
        kind: "lm",
        fit: "brk<-optimize(function(v)sum(residuals(lm(y~x+I(pmax(x-v,0))))^2),c(min(x),max(x)))$minimum;m<-lm(y~x+I(pmax(x-brk,0)))",
        terms: ["B0", "B1", "B2"],
        derived: [
          { label: "Breakpoint (X0)", expr: "brk" },
          {
            label: "Slope below X0",
            expr: "cf[[2]]",
            low: "cf[[2]]-q*sqrt(V[2,2])",
            high: "cf[[2]]+q*sqrt(V[2,2])",
          },
          {
            label: "Slope above X0",
            expr: "cf[[2]]+cf[[3]]",
            low: "cf[[2]]+cf[[3]]-q*sqrt(V[2,2]+V[3,3]+2*V[2,3])",
            high: "cf[[2]]+cf[[3]]+q*sqrt(V[2,2]+V[3,3]+2*V[2,3])",
          },
        ],
      };
    case "semilog-line":
      // Y = intercept + slope * ln(X).
      return {
        kind: "lm",
        fit: "m<-lm(y~log(x))",
        terms: ["Intercept", "Slope"],
        positiveX: true,
      };
    case "sigmoidal-4pl-logx":
      // X is already log10(dose). EC50 = 10^LogEC50.
      // The retries are the port optimizer first, then a relaxed tolerance
      // (see retryFits): the primary stays Gauss-Newton, so every pinned
      // 4PL number is untouched — only a dataset the primary cannot
      // converge on takes a retry. Order matters: the first success wins.
      return {
        kind: "nls",
        fit: `m<-${nls200(FOUR_LOG, `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`)}`,
        // (g) parity + C4 chain: Gauss-Newton stalls ("singular gradient"
        // / "step factor reduced below 'minFactor'") on flat,
        // ill-determined curves Prism fits (41 such failures in the corpus
        // sweep, all log-X) — retry with the port optimizer first, same
        // starts, then with a relaxed tolerance (the Linux 4PL fix: the
        // textbook dose data converges only that way — port fails it with
        // "singular convergence (7)"). The retries only run when the
        // primary fit fails, so passing fits never touch them and their
        // pinned values do not move. Order matters: the first success wins.
        retryFits: [
          {
            fit: `m<-nls(y~${FOUR_LOG},start=list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(FOUR_LOG, `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "LogEC50", "HillSlope"],
        derived: [tenTo("EC50", "LogEC50"), span],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+10^((p[["LogEC50"]]-xv)*p[["HillSlope"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr: FOUR_LOG, midpoint: "LogEC50" },
      };
    case "sigmoidal-4pl-x":
      // X is the raw concentration; EC50 is fitted directly.
      // Same port-then-relaxed retries as the logx twin, for symmetry: the
      // raw-concentration parameterisation converges at the default
      // tolerance on the textbook data, but a flat-asymptote dataset can
      // stall it the same way.
      return {
        kind: "nls",
        fit: `m<-${nls200(FOUR_X, `list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
        // (g) parity + C4 chain: same port-then-relaxed retries as the
        // log-X form, for the Gauss-Newton failures that are not X = 0
        // artefacts.
        retryFits: [
          {
            fit: `m<-nls(y~${FOUR_X},start=list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(FOUR_X, `list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "EC50", "HillSlope"],
        derived: [span],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,ifelse(p[["HillSlope"]]<0,p[["Top"]],p[["Bottom"]]),p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+(p[["EC50"]]/xv)^p[["HillSlope"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr: FOUR_X, midpoint: "EC50" },
      };
    case "agonist-3pl-logx": {
      // The Hill slope is 1: a rising curve.
      const expr = "Bottom+(Top-Bottom)/(1+10^(LogEC50-x))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(Bottom=min(y),Top=max(y),LogEC50=median(x))")}`,
        terms: ["Bottom", "Top", "LogEC50"],
        derived: [tenTo("EC50", "LogEC50"), span],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+10^(p[["LogEC50"]]-xv))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "inhibitor-3pl-logx": {
      // The Hill slope is −1: a falling curve. Prism's "One site — Fit
      // logIC50"; with opts.kiDivisor it also reports Ki (Cheng–Prusoff).
      const expr = "Bottom+(Top-Bottom)/(1+10^(x-LogIC50))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(Bottom=min(y),Top=max(y),LogIC50=median(x))")}`,
        terms: ["Bottom", "Top", "LogIC50"],
        derived: [
          tenTo("IC50", "LogIC50"),
          ...(opts?.kiDivisor != null ? [kiFromLog("Ki", "LogIC50", opts.kiDivisor)] : []),
          span,
        ],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+10^(xv-p[["LogIC50"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "LogIC50" },
      };
    }
    case "agonist-3pl-x": {
      // B6 Stim #5: [Agonist] vs. response (three parameters) — the
      // raw-concentration twin of agonist-3pl-logx, Hill slope 1. Same
      // X = 0 guard as FOUR_X (the vehicle point is Bottom).
      const expr = "ifelse(x==0,Bottom,Bottom+(Top-Bottom)/(1+EC50/x))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]))")}`,
        // Same port-then-relaxed retries as the 4PLs: Gauss-Newton stalls
        // ("singular gradient" / "minFactor") on near-perfect 3PL fits.
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(Bottom=min(y),Top=max(y),EC50=median(x[x>0])),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "EC50"],
        derived: [span],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,p[["Bottom"]],p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+p[["EC50"]]/xv))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "EC50" },
      };
    }
    case "inhibitor-3pl-x": {
      // B6 Inhib #5: [Inhibitor] vs. response (three parameters) —
      // falling, Hill slope 1: Y=Bottom+(Top-Bottom)/(1+X/IC50). No X=0
      // guard, unlike the agonist forms: the unguarded value at X = 0 is
      // Top (no inhibitor, full response), which is correct, and (X/IC50)
      // divides by no zero there. (Batch 3 wrongly guarded it to Bottom —
      // the vehicle point then contradicted the curve, and the
      // normalized-4PL twin's fit came back with IC50 null.)
      const expr = "Bottom+(Top-Bottom)/(1+x/IC50)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(Bottom=min(y),Top=max(y),IC50=median(x[x>0]))")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(Bottom=min(y),Top=max(y),IC50=median(x[x>0])),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(Bottom=min(y),Top=max(y),IC50=median(x[x>0]))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "IC50"],
        derived: [span],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+xv/p[["IC50"]])',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "IC50" },
      };
    }
    case "agonist-3pl-normalized-logx": {
      // B6 Stim #3: log(agonist) vs. normalized response — Bottom=0,
      // Top=100 hard-coded, so only LogEC50 is fitted.
      const expr = "100/(1+10^(LogEC50-x))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(LogEC50=median(x))")}`,
        // Same port-then-relaxed retries as the 4PLs: the 1-parameter
        // normalized fits stall Gauss-Newton on noiseless data too.
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(LogEC50=median(x)),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(LogEC50=median(x))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["LogEC50"],
        derived: [tenTo("EC50", "LogEC50"), span100],
        curveFn: 'g<-function(xv,p) 100/(1+10^(p[["LogEC50"]]-xv))',
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "agonist-4pl-normalized-logx": {
      // B6 Stim #4: ... -- Variable slope. SIGN starts the slope on the
      // curve's own side, as for the 4PLs.
      const expr = "100/(1+10^((LogEC50-x)*HillSlope))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, `list(LogEC50=median(x),HillSlope=${SIGN})`)}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x),
        // plus the analytic-gradient retry (the gate fix: the numeric
        // gradient collapses when LogEC50 hits ~0, see nlsDerivTol).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(LogEC50=median(x),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, `list(LogEC50=median(x),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
          {
            fit: nlsDerivTol(expr, `list(LogEC50=median(x),HillSlope=${SIGN})`, 'c("LogEC50","HillSlope")'),
            method: "analytic gradient",
          },
        ],
        terms: ["LogEC50", "HillSlope"],
        derived: [tenTo("EC50", "LogEC50"), span100],
        curveFn: 'g<-function(xv,p) 100/(1+10^((p[["LogEC50"]]-xv)*p[["HillSlope"]]))',
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "agonist-3pl-normalized-x": {
      // B6 Stim #7: [Agonist] vs. normalized response.
      const expr = "ifelse(x==0,0,100/(1+EC50/x))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(EC50=median(x[x>0]))")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(EC50=median(x[x>0])),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(EC50=median(x[x>0]))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["EC50"],
        derived: [span100],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) ifelse(xv==0,0,100/(1+p[["EC50"]]/xv))',
        dose: { expr, midpoint: "EC50" },
      };
    }
    case "agonist-4pl-normalized-x": {
      // B6 Stim #8: ... -- Variable slope. The X = 0 guard is
      // sign-aware, like FOUR_X: a falling curve (HillSlope < 0) tends
      // to 100 as X → 0+, a rising one to 0 (Round 2 Issue 36).
      const expr = "ifelse(x==0,ifelse(HillSlope<0,100,0),100/(1+(EC50/x)^HillSlope))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, `list(EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(EC50=median(x[x>0]),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, `list(EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["EC50", "HillSlope"],
        derived: [span100],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,ifelse(p[["HillSlope"]]<0,100,0),100/(1+(p[["EC50"]]/xv)^p[["HillSlope"]]))',
        dose: { expr, midpoint: "EC50" },
      };
    }
    case "inhibitor-3pl-normalized-logx": {
      // B6 Inhib #3: log(inhibitor) vs. normalized response.
      const expr = "100/(1+10^(x-LogIC50))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(LogIC50=median(x))")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(LogIC50=median(x)),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(LogIC50=median(x))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["LogIC50"],
        derived: [tenTo("IC50", "LogIC50"), span100],
        curveFn: 'g<-function(xv,p) 100/(1+10^(xv-p[["LogIC50"]]))',
        dose: { expr, midpoint: "LogIC50" },
      };
    }
    case "inhibitor-4pl-normalized-logx": {
      // B6 Inhib #4: ... -- Variable slope. The (x-LogIC50) form falls
      // with HillSlope > 0 — SIGN would start it at −1 on falling data
      // and flip the curve, so the start is 1 outright.
      const expr = "100/(1+10^((x-LogIC50)*HillSlope))";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(LogIC50=median(x),HillSlope=1)")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x),
        // plus the analytic-gradient retry (the gate fix: the numeric
        // gradient collapses when LogIC50 hits ~0, see nlsDerivTol).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(LogIC50=median(x),HillSlope=1),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(LogIC50=median(x),HillSlope=1)")}`,
            method: "relaxed tolerance",
          },
          {
            fit: nlsDerivTol(expr, "list(LogIC50=median(x),HillSlope=1)", 'c("LogIC50","HillSlope")'),
            method: "analytic gradient",
          },
        ],
        terms: ["LogIC50", "HillSlope"],
        derived: [tenTo("IC50", "LogIC50"), span100],
        curveFn: 'g<-function(xv,p) 100/(1+10^((xv-p[["LogIC50"]])*p[["HillSlope"]]))',
        dose: { expr, midpoint: "LogIC50" },
      };
    }
    case "inhibitor-3pl-normalized-x": {
      // B6 Inhib #7: [Inhibitor] vs. normalized response. No X=0 guard:
      // the unguarded value at X = 0 is 100 (no inhibitor, full
      // response) — the Batch 3 guard to 0 contradicted the vehicle
      // point (see inhibitor-3pl-x).
      const expr = "100/(1+x/IC50)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(IC50=median(x[x>0]))")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(IC50=median(x[x>0])),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(IC50=median(x[x>0]))")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["IC50"],
        derived: [span100],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) 100/(1+xv/p[["IC50"]])',
        dose: { expr, midpoint: "IC50" },
      };
    }
    case "inhibitor-4pl-normalized-x": {
      // B6 Inhib #8: ... -- Variable slope. The (x/IC50) form falls with
      // HillSlope > 0, so the start is 1 outright (see the logx twin).
      // No X=0 guard, as for inhibitor-3pl-normalized-x.
      const expr = "100/(1+(x/IC50)^HillSlope)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(IC50=median(x[x>0]),HillSlope=1)")}`,
        // Same port-then-relaxed retries as the 4PLs (see agonist-3pl-x).
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(IC50=median(x[x>0]),HillSlope=1),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(IC50=median(x[x>0]),HillSlope=1)")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["IC50", "HillSlope"],
        derived: [span100],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) 100/(1+(xv/p[["IC50"]])^p[["HillSlope"]])',
        dose: { expr, midpoint: "IC50" },
      };
    }
    case "biphasic-logx": {
      // B6 Special logx #2: two agonist phases on log X — Y=Bottom +
      // Span·Frac/(1+10^((LogEC50_1−X)·nH1)) + Span·(1−Frac)/(1+10^((LogEC50_2−X)·nH2)).
      // Two midpoints, so no dose field (comparison/ECanything need one).
      const expr =
        "Bottom+(Top-Bottom)*Frac/(1+10^((LogEC50_1-x)*nH1))+(Top-Bottom)*(1-Frac)/(1+10^((LogEC50_2-x)*nH2))";
      const starts = "list(Bottom=min(y),Top=max(y),LogEC50_1=median(x)-1,LogEC50_2=median(x)+1,nH1=1,nH2=1,Frac=0.5)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            // Bounded port: an unbounded trial step can take EC50/nH
            // negative, and (EC50/X)^nH on a negative base is NaN.
            // nH > 0 keeps both phases rising; Frac stays in [0, 1].
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",lower=c(-Inf,-Inf,-Inf,-Inf,0,0,0),upper=c(Inf,Inf,Inf,Inf,Inf,Inf,1),control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "LogEC50_1", "LogEC50_2", "nH1", "nH2", "Frac"],
        derived: [tenTo("EC50_1", "LogEC50_1"), tenTo("EC50_2", "LogEC50_2"), span],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])*p[["Frac"]]/(1+10^((p[["LogEC50_1"]]-xv)*p[["nH1"]]))+(p[["Top"]]-p[["Bottom"]])*(1-p[["Frac"]])/(1+10^((p[["LogEC50_2"]]-xv)*p[["nH2"]]))',
      };
    }
    case "biphasic-x": {
      // B6 Special X #2: the raw-concentration twin — Y=Bottom +
      // Span·Frac/(1+(EC50_1/X)^nH1) + Span·(1−Frac)/(1+(EC50_2/X)^nH2).
      // At X = 0 each section is whole when its nH < 0 and vanishes
      // when its nH > 0, so the guard sums the negative-slope sections
      // (Round 2 Issue 36 — the unconditional Bottom assumed both
      // sections rising).
      const expr =
        "ifelse(x==0,Bottom+(Top-Bottom)*(Frac*ifelse(nH1<0,1,0)+(1-Frac)*ifelse(nH2<0,1,0)),Bottom+(Top-Bottom)*Frac/(1+(EC50_1/x)^nH1)+(Top-Bottom)*(1-Frac)/(1+(EC50_2/x)^nH2))";
      const starts = "list(Bottom=min(y),Top=max(y),EC50_1=median(x[x>0])/10,EC50_2=median(x[x>0])*10,nH1=1,nH2=1,Frac=0.5)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            // Bounded port: EC50_1/EC50_2 and nH stay positive, Frac in
            // [0, 1] — a negative EC50 makes (EC50/X)^nH NaN for
            // fractional nH (see biphasic-logx).
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",lower=c(-Inf,-Inf,0,0,0,0,0),upper=c(Inf,Inf,Inf,Inf,Inf,Inf,1),control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "EC50_1", "EC50_2", "nH1", "nH2", "Frac"],
        derived: [span],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])*(p[["Frac"]]*ifelse(p[["nH1"]]<0,1,0)+(1-p[["Frac"]])*ifelse(p[["nH2"]]<0,1,0)),p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])*p[["Frac"]]/(1+(p[["EC50_1"]]/xv)^p[["nH1"]])+(p[["Top"]]-p[["Bottom"]])*(1-p[["Frac"]])/(1+(p[["EC50_2"]]/xv)^p[["nH2"]]))',
      };
    }
    case "bell-shaped-logx": {
      // B6 Special logx #3: up then down — Y=Dip + Span1/(1+10^((LogEC50_1−X)·nH1))
      // + Span2/(1+10^((X−LogEC50_2)·nH2)), Span1=Plateau1−Dip, Span2=Plateau2−Dip.
      const expr =
        "Dip+(Plateau1-Dip)/(1+10^((LogEC50_1-x)*nH1))+(Plateau2-Dip)/(1+10^((x-LogEC50_2)*nH2))";
      const starts = "list(Plateau1=max(y),Plateau2=max(y),Dip=min(y),LogEC50_1=median(x)-1,LogEC50_2=median(x)+1,nH1=1,nH2=1)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            // Bounded port: nH1/nH2 stay positive (see biphasic-logx).
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",lower=c(-Inf,-Inf,-Inf,-Inf,-Inf,0,0),upper=c(Inf,Inf,Inf,Inf,Inf,Inf,Inf),control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Plateau1", "Plateau2", "Dip", "LogEC50_1", "LogEC50_2", "nH1", "nH2"],
        derived: [
          tenTo("EC50_1", "LogEC50_1"),
          tenTo("EC50_2", "LogEC50_2"),
          difference("Plateau1", "Dip", "Span1"),
          difference("Plateau2", "Dip", "Span2"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Dip"]]+(p[["Plateau1"]]-p[["Dip"]])/(1+10^((p[["LogEC50_1"]]-xv)*p[["nH1"]]))+(p[["Plateau2"]]-p[["Dip"]])/(1+10^((xv-p[["LogEC50_2"]])*p[["nH2"]]))',
      };
    }
    case "bell-shaped-x": {
      // B6 Special X #3: the raw-concentration twin — at X = 0 the first
      // section is whole when nH1 < 0 (vanishes when nH1 > 0) and the
      // second is whole when nH2 > 0 (vanishes when nH2 < 0), so the
      // guard sums the sections that are whole there (Round 2 Issue 36
      // — the unconditional Plateau2 assumed nH1 > 0 and nH2 > 0).
      const expr =
        "ifelse(x==0,Dip+(Plateau1-Dip)*ifelse(nH1<0,1,0)+(Plateau2-Dip)*ifelse(nH2>0,1,0),Dip+(Plateau1-Dip)/(1+(EC50_1/x)^nH1)+(Plateau2-Dip)/(1+(x/EC50_2)^nH2))";
      const starts = "list(Plateau1=max(y),Plateau2=max(y),Dip=min(y),EC50_1=median(x[x>0])/10,EC50_2=median(x[x>0])*10,nH1=1,nH2=1)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            // Bounded port: EC50_1/EC50_2 and nH stay positive (see
            // biphasic-x — a negative EC50 makes (EC50/X)^nH NaN).
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",lower=c(-Inf,-Inf,-Inf,0,0,0,0),upper=c(Inf,Inf,Inf,Inf,Inf,Inf,Inf),control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Plateau1", "Plateau2", "Dip", "EC50_1", "EC50_2", "nH1", "nH2"],
        derived: [difference("Plateau1", "Dip", "Span1"), difference("Plateau2", "Dip", "Span2")],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,p[["Dip"]]+(p[["Plateau1"]]-p[["Dip"]])*ifelse(p[["nH1"]]<0,1,0)+(p[["Plateau2"]]-p[["Dip"]])*ifelse(p[["nH2"]]>0,1,0),p[["Dip"]]+(p[["Plateau1"]]-p[["Dip"]])/(1+(p[["EC50_1"]]/xv)^p[["nH1"]])+(p[["Plateau2"]]-p[["Dip"]])/(1+(xv/p[["EC50_2"]])^p[["nH2"]]))',
      };
    }
    case "absolute-ic50-logx": {
      // B6 Special logx #11: the 4PL fit (same as sigmoidal-4pl-logx),
      // reporting the X where Y = 50 in absolute units as well.
      return {
        kind: "nls",
        fit: `m<-${nls200(FOUR_LOG, `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`)}`,
        retryFits: [
          {
            fit: `m<-nls(y~${FOUR_LOG},start=list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(FOUR_LOG, `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
          {
            // The gate fix: the numeric gradient collapses when LogEC50
            // hits ~0 (see nlsDerivTol) — same 4PL pathology as the
            // normalized logx twins.
            fit: nlsDerivTol(
              FOUR_LOG,
              `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`,
              'c("Bottom","Top","LogEC50","HillSlope")',
            ),
            method: "analytic gradient",
          },
        ],
        terms: ["Bottom", "Top", "LogEC50", "HillSlope"],
        derived: [tenTo("EC50", "LogEC50"), span, absoluteIC50Logx],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+10^((p[["LogEC50"]]-xv)*p[["HillSlope"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr: FOUR_LOG, midpoint: "LogEC50" },
      };
    }
    case "absolute-ic50-x": {
      // B6 Special X #11: the raw-concentration twin.
      return {
        kind: "nls",
        fit: `m<-${nls200(FOUR_X, `list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
        retryFits: [
          {
            fit: `m<-nls(y~${FOUR_X},start=list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN}),algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(FOUR_X, `list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN})`)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Bottom", "Top", "EC50", "HillSlope"],
        derived: [span, absoluteIC50X],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,ifelse(p[["HillSlope"]]<0,p[["Top"]],p[["Bottom"]]),p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+(p[["EC50"]]/xv)^p[["HillSlope"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr: FOUR_X, midpoint: "EC50" },
      };
    }
    case "pade-11": {
      // B6 Standard #10: Y=(A0+A1·X)/(1+B1·X) — Prism's standard curve
      // for interpolating when the curve plateaus at large concentrations.
      // The guide's starts are all 1.0, but (1,1,1) makes the curve
      // identically 1, so the Jacobian is singular there and nls dies
      // with "singular gradient matrix at initial parameter estimates"
      // on every dataset. Instead the starts linearize the equation:
      // Y·(1+B1·X)=A0+A1·X, so with A0 the left-edge Y, (Y−A0) regressed
      // on X and −X·Y (no intercept) gives (A1, B1) — exact on
      // noiseless data. A plain list(...) start, so the fit rewriters
      // still parse it.
      const expr = "(A0+A1*x)/(1+B1*x)";
      const lin = "lm(I(y-y[which.min(x)])~0+x+I(-x*y))";
      const starts = `list(A0=y[which.min(x)],A1=coef(${lin})[[1]],B1=coef(${lin})[[2]])`;
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["A0", "A1", "B1"],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) (p[["A0"]]+p[["A1"]]*xv)/(1+p[["B1"]]*xv)',
      };
    }
    case "power-series": {
      // B6 Classic #13: Y=A·X^B + C·X^D. The starts scale the two terms
      // to half the max Y at the max X, so neither starts orders of
      // magnitude off the data (max(y)/2 each would be, for B=1/D=2).
      const expr = "A*x^B+C*x^D";
      const starts = "list(A=max(y)/(2*max(x)),B=1,C=max(y)/(2*max(x)^2),D=2)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["A", "B", "C", "D"],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) p[["A"]]*xv^p[["B"]]+p[["C"]]*xv^p[["D"]]',
      };
    }
    case "exponential-plateau": {
      // B6 Growth #3: Y=YM−(YM−Y0)·exp(−K·X) — the same shape as
      // one-phase association, a separate entry by the codebase's
      // precedent (different Prism parameter names).
      const expr = "YM-(YM-Y0)*exp(-K*x)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, "list(Y0=y[which.min(x)],YM=max(y),K=0.5)")}`,
        // Same port-then-relaxed retries as the 4PLs: Gauss-Newton
        // stalls ("maxiter 200") on the noiseless plateau fit. The port
        // retry bounds K > 0 — a negative K makes exp(−K·X) blow up.
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=list(Y0=y[which.min(x)],YM=max(y),K=0.5),algorithm="port",lower=c(-Inf,-Inf,0),control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, "list(Y0=y[which.min(x)],YM=max(y),K=0.5)")}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Y0", "YM", "K"],
        derived: [overK("Half-life", "log(2)", "K"), difference("YM", "Y0")],
        curveFn: 'g<-function(xv,p) p[["YM"]]-(p[["YM"]]-p[["Y0"]])*exp(-p[["K"]]*xv)',
      };
    }
    case "beta-growth-decay": {
      // B6 Growth #6: Yin et al. 2003 — Y=Wmax·(1+(Te−X)/(Te−Tm))·(X/Te)^(Te/(Te−Tm)).
      // The weight decays and reaches zero again at 2·Te−Tm.
      const expr = "Wmax*(1+(Te-x)/(Te-Tm))*(x/Te)^(Te/(Te-Tm))";
      const starts = "list(Wmax=max(y),Te=x[which.max(y)],Tm=x[which.max(y)]/2)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, starts)}`,
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=${starts},algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(expr, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: ["Wmax", "Te", "Tm"],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) p[["Wmax"]]*(1+(p[["Te"]]-xv)/(p[["Te"]]-p[["Tm"]]))*(xv/p[["Te"]])^(p[["Te"]]/(p[["Te"]]-p[["Tm"]]))',
      };
    }
    case "lq-fraction-surviving":
    case "lq-percent-surviving":
    case "lq-fraction-dead":
    case "lq-percent-dead":
    case "lq-count-alive":
    case "lq-count-dead": {
      // B6 §Linear quadratic: Y = exp(−(A·X+B·X²)), scaled to percent or
      // counts, surviving or dead. "Total" (the count variants' N) is a
      // fitted parameter — the guide's form for "# alive/dead cells" was
      // not fetched, so the name is Titer's.
      const form =
        model === "lq-fraction-surviving"
          ? "exp(-(A*x+B*x^2))"
          : model === "lq-percent-surviving"
            ? "100*exp(-(A*x+B*x^2))"
            : model === "lq-fraction-dead"
              ? "1-exp(-(A*x+B*x^2))"
              : model === "lq-percent-dead"
                ? "100*(1-exp(-(A*x+B*x^2)))"
                : model === "lq-count-alive"
                  ? "Total*exp(-(A*x+B*x^2))"
                  : "Total*(1-exp(-(A*x+B*x^2)))";
      const isCount = model === "lq-count-alive" || model === "lq-count-dead";
      const starts = isCount ? "list(A=0.1,B=0.01,Total=max(y))" : "list(A=0.1,B=0.01)";
      const gForm =
        model === "lq-fraction-surviving"
          ? "exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2))"
          : model === "lq-percent-surviving"
            ? "100*exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2))"
            : model === "lq-fraction-dead"
              ? "1-exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2))"
              : model === "lq-percent-dead"
                ? "100*(1-exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2)))"
                : model === "lq-count-alive"
                  ? "p[[\"Total\"]]*exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2))"
                  : "p[[\"Total\"]]*(1-exp(-(p[[\"A\"]]*xv+p[[\"B\"]]*xv^2)))";
      return {
        kind: "nls",
        fit: `m<-${nls200(form, starts)}`,
        // Same port-then-relaxed retries as the 4PLs: Gauss-Newton stalls
        // ("maxiter 200") on the scaled percent/count variants, and an
        // unbounded trial step can take A/B negative, where exp(−(A·X +
        // B·X²)) blows up. A and B are killing rates, so both (and Total)
        // stay ≥ 0 in the port retry.
        retryFits: [
          {
            fit: `m<-nls(y~${form},start=${starts},algorithm="port",lower=${isCount ? "c(0,0,0)" : "c(0,0)"},control=nls.control(maxiter=200))`,
            method: "port",
          },
          {
            fit: `m<-${nls200Tol(form, starts)}`,
            method: "relaxed tolerance",
          },
        ],
        terms: isCount ? ["A", "B", "Total"] : ["A", "B"],
        nonNegativeX: true,
        curveFn: `g<-function(xv,p) ${gForm}`,
      };
    }
    case "asymmetric-5pl-logx": {
      // Prism's 5PL: the curve's asymmetry S (1 = the 4PL); it starts from the 4PL's fit.
      const expr = "Bottom+(Top-Bottom)/(1+10^((LogEC50+log10(2^(1/S)-1)/HillSlope-x)*HillSlope))^S";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, `c(as.list(coef(${nls200(FOUR_LOG, `list(Bottom=min(y),Top=max(y),LogEC50=median(x),HillSlope=${SIGN})`)})),S=1)`)}`,
        terms: ["Bottom", "Top", "LogEC50", "HillSlope", "S"],
        derived: [tenTo("EC50", "LogEC50"), span],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+10^((p[["LogEC50"]]+log10(2^(1/p[["S"]])-1)/p[["HillSlope"]]-xv)*p[["HillSlope"]]))^p[["S"]]',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "LogEC50" },
      };
    }
    case "asymmetric-5pl-x": {
      // Same X = 0 guard as FOUR_X (see above): at x = 0 the curve is
      // its Top when HillSlope < 0, its Bottom when HillSlope > 0; the
      // unguarded ratio is Inf/NaN there whenever a trial step takes
      // EC50 ≤ 0.
      const expr =
        "ifelse(x==0,(Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)),Bottom+(Top-Bottom)/(1+(EC50*(2^(1/S)-1)^(1/HillSlope)/x)^HillSlope)^S)";
      return {
        kind: "nls",
        fit: `m<-${nls200(expr, `c(as.list(coef(${nls200(FOUR_X, `list(Bottom=min(y),Top=max(y),EC50=median(x[x>0]),HillSlope=${SIGN})`)})),S=1)`)}`,
        terms: ["Bottom", "Top", "EC50", "HillSlope", "S"],
        derived: [span],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,ifelse(p[["HillSlope"]]<0,p[["Top"]],p[["Bottom"]]),p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+((p[["EC50"]]*(2^(1/p[["S"]])-1)^(1/p[["HillSlope"]]))/xv)^p[["HillSlope"]])^p[["S"]])',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "EC50" },
      };
    }
    case "hyperbola":
      // Y = Bmax * X / (Kd + X).
      return {
        kind: "nls",
        fit: `m<-${nls200("Bmax*x/(Kd+x)", "list(Bmax=max(y)*1.1,Kd=median(x[x>0]))")}`,
        terms: ["Bmax", "Kd"],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) p[["Bmax"]]*xv/(p[["Kd"]]+xv)',
      };
    // ── Exponential family (plan 08) ──────────────────────────────────
    // All five fit with nls() algorithm "port" (nl2sol), not the default
    // Gauss-Newton: in WebR's R 4.6.0 the default fails to converge on
    // (near-)noiseless exponential fits even from exact starts ("number of
    // iterations exceeded maximum of 50", or "step factor reduced below
    // 'minFactor'"), while "port" recovers the generating parameters to
    // ~1e-13. The older models keep the default, so their pinned numbers
    // do not move. Half-life is null (NA) when the fitted K ≤ 0 — a
    // negative half-life is meaningless — and the runner notes it.
    case "one-phase-decay":
      // Y = (Y0 − Plateau)·exp(−K·X) + Plateau.
      return {
        kind: "nls",
        fit: "m<-nls(y~(Y0-Plateau)*exp(-K*x)+Plateau,start=list(Y0=y[which.min(x)],Plateau=min(y),K=0.5),algorithm=\"port\")",
        terms: ["Y0", "Plateau", "K"],
        derived: [
          overK("Half-life", "log(2)"),
          overK("Tau", "1"),
          difference("Y0", "Plateau"),
        ],
        curveFn:
          'g<-function(xv,p) (p[["Y0"]]-p[["Plateau"]])*exp(-p[["K"]]*xv)+p[["Plateau"]]',
      };
    case "two-phase-decay":
      // Y = Plateau + Span1·exp(−K1·X) + Span2·exp(−K2·X).
      return {
        kind: "nls",
        fit: "m<-nls(y~Plateau+Span1*exp(-K1*x)+Span2*exp(-K2*x),start=list(Plateau=min(y),Span1=0.6*(max(y)-min(y)),K1=1,Span2=0.4*(max(y)-min(y)),K2=0.1),algorithm=\"port\")",
        terms: ["Plateau", "Span1", "K1", "Span2", "K2"],
        derived: [
          overK("Half-life (fast)", "log(2)", "K1"),
          overK("Half-life (slow)", "log(2)", "K2"),
          sumOf("Span1", "Span2"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Plateau"]]+p[["Span1"]]*exp(-p[["K1"]]*xv)+p[["Span2"]]*exp(-p[["K2"]]*xv)',
      };
    case "three-phase-decay":
      // Y = Plateau + Span1·exp(−K1·X) + Span2·exp(−K2·X) + Span3·exp(−K3·X).
      // Prism's "Exponential" family, third decay phase (B6 §Exponential #4).
      return {
        kind: "nls",
        fit: "m<-nls(y~Plateau+Span1*exp(-K1*x)+Span2*exp(-K2*x)+Span3*exp(-K3*x),start=list(Plateau=min(y),Span1=0.5*(max(y)-min(y)),K1=1,Span2=0.3*(max(y)-min(y)),K2=0.1,Span3=0.2*(max(y)-min(y)),K3=0.01),algorithm=\"port\")",
        terms: ["Plateau", "Span1", "K1", "Span2", "K2", "Span3", "K3"],
        derived: [
          overK("Half-life (fast)", "log(2)", "K1"),
          overK("Half-life (medium)", "log(2)", "K2"),
          overK("Half-life (slow)", "log(2)", "K3"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Plateau"]]+p[["Span1"]]*exp(-p[["K1"]]*xv)+p[["Span2"]]*exp(-p[["K2"]]*xv)+p[["Span3"]]*exp(-p[["K3"]]*xv)',
      };
    case "plateau-decay":
      // Y = Y0 for X < X0; Y = Plateau + (Y0 − Plateau)·exp(−K·(X − X0)) after.
      return {
        kind: "nls",
        fit: "m<-nls(y~ifelse(x<X0,Y0,Plateau+(Y0-Plateau)*exp(-K*(x-X0))),start=list(X0=median(x),Y0=mean(y[x<median(x)]),Plateau=min(y),K=0.5),algorithm=\"port\")",
        terms: ["X0", "Y0", "Plateau", "K"],
        derived: [overK("Half-life", "log(2)"), difference("Y0", "Plateau")],
        curveFn:
          'g<-function(xv,p) ifelse(xv<p[["X0"]],p[["Y0"]],p[["Plateau"]]+(p[["Y0"]]-p[["Plateau"]])*exp(-p[["K"]]*(xv-p[["X0"]])))',
      };
    case "one-phase-association":
      // Y = Y0 + (Plateau − Y0)·(1 − exp(−K·X)). Span is the rise
      // (Plateau − Y0), positive like the decay span — the plan's literal
      // "Y0 − Plateau" would report a negative span for a rising curve.
      return {
        kind: "nls",
        fit: "m<-nls(y~Y0+(Plateau-Y0)*(1-exp(-K*x)),start=list(Y0=y[which.min(x)],Plateau=max(y),K=0.5),algorithm=\"port\")",
        terms: ["Y0", "Plateau", "K"],
        derived: [overK("Half-life", "log(2)"), difference("Plateau", "Y0")],
        curveFn:
          'g<-function(xv,p) p[["Y0"]]+(p[["Plateau"]]-p[["Y0"]])*(1-exp(-p[["K"]]*xv))',
      };
    case "two-phase-association":
      // Y = Y0 + Span1·(1 − exp(−K1·X)) + Span2·(1 − exp(−K2·X)).
      // Prism's "Exponential" family (B6 §Exponential #7).
      return {
        kind: "nls",
        fit: "m<-nls(y~Y0+Span1*(1-exp(-K1*x))+Span2*(1-exp(-K2*x)),start=list(Y0=y[which.min(x)],Span1=0.6*(max(y)-min(y)),K1=1,Span2=0.4*(max(y)-min(y)),K2=0.1),algorithm=\"port\")",
        terms: ["Y0", "Span1", "K1", "Span2", "K2"],
        derived: [
          overK("Half-life (fast)", "log(2)", "K1"),
          overK("Half-life (slow)", "log(2)", "K2"),
          sumOf("Span1", "Span2"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Y0"]]+p[["Span1"]]*(1-exp(-p[["K1"]]*xv))+p[["Span2"]]*(1-exp(-p[["K2"]]*xv))',
      };
    case "plateau-association":
      // Y = Y0 for X < X0; Y = Y0 + (Plateau − Y0)·(1 − exp(−K·(X − X0)))
      // after — the association twin of plateau-decay (B6 §Exponential #6).
      return {
        kind: "nls",
        fit: "m<-nls(y~ifelse(x<X0,Y0,Y0+(Plateau-Y0)*(1-exp(-K*(x-X0)))),start=list(X0=median(x),Y0=mean(y[x<median(x)]),Plateau=max(y),K=0.5),algorithm=\"port\")",
        terms: ["X0", "Y0", "Plateau", "K"],
        derived: [overK("Half-life", "log(2)"), difference("Plateau", "Y0")],
        curveFn:
          'g<-function(xv,p) ifelse(xv<p[["X0"]],p[["Y0"]],p[["Y0"]]+(p[["Plateau"]]-p[["Y0"]])*(1-exp(-p[["K"]]*(xv-p[["X0"]])))',
      };
    case "exponential-growth":
      // Prism's "Exponential growth": Y = Y0·exp(K·X).
      // DEVIATION from the plan's Case D: the plan fits the growth model
      // with SSasymp (Asym/R0/lrc) on saturating data (Y → 200). That
      // parameterisation cannot be the growth model: SSasymp on pure
      // exponential data fails in WebR ("singular gradient"), and explicit
      // growth on the saturating fixture fits badly (R² = 0.798, verified
      // in WebR before implementing). The saturating fixture is the
      // association shape — Y0=10, Plateau=200, K=0.2 — and is covered as
      // an association case (D) instead; growth is the Prism-explicit form,
      // with the pure-growth fixture as Case D2.
      return {
        kind: "nls",
        fit: "m<-nls(y~Y0*exp(K*x),start=list(Y0=y[which.min(x)],K=0.1),algorithm=\"port\")",
        // Gate fix (seq 200): port stalls from the Y0 = y-at-min-X start
        // on steeply growing counts ("false convergence (8)") — the
        // seq-200 Poisson data fails the primary AND the least-squares
        // fit that way, so the Poisson IRLS never gets an initial fit.
        // The retry starts from the log-linear fit (lm(log(y)~x) on the
        // positive counts — the growth model's own linearisation), which
        // converges on that data to the scipy pins (verified in WebR).
        // It only runs when the primary fails, so passing fits never
        // touch it; with fewer than two positive counts it falls back
        // to the primary start. The start expressions are self-contained
        // (no pre-statement variables), so the global fit's data-driven
        // restart can evaluate them per series.
        retryFits: [
          {
            fit: "m<-nls(y~Y0*exp(K*x),start=list(Y0=if(sum(y>0)>=2)exp(coef(lm(log(y[y>0])~x[y>0]))[[1]]) else y[which.min(x)],K=if(sum(y>0)>=2)coef(lm(log(y[y>0])~x[y>0]))[[2]] else 0.1),algorithm=\"port\")",
            method: "log-linear start",
          },
        ],
        terms: ["Y0", "K"],
        derived: [overK("Doubling time", "log(2)"), overK("Tau", "1")],
        curveFn: 'g<-function(xv,p) p[["Y0"]]*exp(p[["K"]]*xv)',
      };
    case "logistic-growth":
      // Y = YM·Y0 / ((YM − Y0)·exp(−K·X) + Y0); it starts from the logit's line.
      // Upstream 1.1.0; Titer's exponential-family "port" fitter, like its siblings
      // (the default Gauss-Newton stalls on (near-)noiseless growth fits in WebR).
      return {
        kind: "nls",
        fit: `m<-nls(y~YM*Y0/((YM-Y0)*exp(-K*x)+Y0),start=local({M<-max(y)*1.05;k<-y>0&y<M;c0<-coef(lm(log(y[k]/(M-y[k]))~x[k]));list(Y0=M*plogis(c0[[1]]),YM=M,K=c0[[2]])}),algorithm="port",control=nls.control(maxiter=200))`,
        terms: ["Y0", "YM", "K"],
        derived: [overK("Doubling time", "log(2)"), inflectionPoint()],
        curveFn:
          'g<-function(xv,p) p[["YM"]]*p[["Y0"]]/((p[["YM"]]-p[["Y0"]])*exp(-p[["K"]]*xv)+p[["Y0"]])',
      };
    case "gompertz-growth":
      // Y = YM·(Y0/YM)^exp(−K·X); it starts from log(−log(Y / YM))'s line.
      return {
        kind: "nls",
        fit: `m<-nls(y~YM*(Y0/YM)^exp(-K*x),start=local({M<-max(y)*1.05;k<-y>0&y<M;c0<-coef(lm(log(-log(y[k]/M))~x[k]));list(Y0=M*exp(-exp(c0[[1]])),YM=M,K=-c0[[2]])}),algorithm="port",control=nls.control(maxiter=200))`,
        terms: ["Y0", "YM", "K"],
        curveFn: 'g<-function(xv,p) p[["YM"]]*(p[["Y0"]]/p[["YM"]])^exp(-p[["K"]]*xv)',
      };
    // ── Other classic curves (v2) ───────────────────────────────────────
    // Prism's Gaussian, Boltzmann sigmoid, Lorentzian and sine-wave
    // models (Curve Fitting Guide, "Other classic curves"). All four fit
    // with nls() algorithm "port" like the plan 08/09 models: the default
    // Gauss-Newton fails to converge on (near-)noiseless fits in WebR's
    // R 4.6.0 even from exact starts, while "port" recovers the generating
    // parameters (verified in WebR before implementing).
    case "gaussian":
      // Y = Amplitude·exp(−0.5·((X−Mean)/SD)²). Area under the curve =
      // Amplitude·SD·√(2π) (the guide's Amplitude·SD/0.3989);
      // FWHM = 2·√(2·ln 2)·SD ≈ 2.3548·SD.
      return {
        kind: "nls",
        fit: "m<-nls(y~Amplitude*exp(-0.5*((x-Mean)/SD)^2),start=list(Amplitude=max(y),Mean=x[which.max(y)],SD=(max(x)-min(x))/4),algorithm=\"port\",lower=c(-Inf,-Inf,0),control=nls.control(maxiter=200))",
        terms: ["Amplitude", "Mean", "SD"],
        derived: [
          {
            label: "Area",
            expr: 'ifelse(cf[["SD"]]>0,cf[["Amplitude"]]*cf[["SD"]]*sqrt(2*pi),NA_real_)',
          },
          scaled("FWHM", "2*sqrt(2*log(2))", "SD"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Amplitude"]]*exp(-0.5*((xv-p[["Mean"]])/p[["SD"]])^2)',
      };
    case "boltzmann-sigmoid":
      // Y = Bottom + (Top−Bottom)/(1+exp((V50−X)/Slope)). V50 is the X at
      // the curve's midpoint; Slope is positive for a rising curve.
      return {
        kind: "nls",
        fit: "m<-nls(y~Bottom+(Top-Bottom)/(1+exp((V50-x)/Slope)),start=list(Bottom=min(y),Top=max(y),V50=median(x),Slope=(max(x)-min(x))/4),algorithm=\"port\",control=nls.control(maxiter=200))",
        terms: ["Bottom", "Top", "V50", "Slope"],
        derived: [difference("Top", "Bottom")],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])/(1+exp((p[["V50"]]-xv)/p[["Slope"]]))',
        asymptotes: ["Bottom", "Top"],
      };
    case "lorentzian":
      // Y = Amplitude/(1+((X−Center)/Width)²). Width is the half-width at
      // half-maximum, so FWHM = 2·Width; area = π·Amplitude·Width.
      return {
        kind: "nls",
        fit: "m<-nls(y~Amplitude/(1+((x-Center)/Width)^2),start=list(Amplitude=max(y),Center=x[which.max(y)],Width=(max(x)-min(x))/4),algorithm=\"port\",lower=c(-Inf,-Inf,0),control=nls.control(maxiter=200))",
        terms: ["Amplitude", "Center", "Width"],
        derived: [
          {
            label: "Area",
            expr: 'ifelse(cf[["Width"]]>0,pi*cf[["Amplitude"]]*cf[["Width"]],NA_real_)',
          },
          scaled("FWHM", "2", "Width"),
        ],
        curveFn:
          'g<-function(xv,p) p[["Amplitude"]]/(1+((xv-p[["Center"]])/p[["Width"]])^2)',
      };
    case "sine-wave": {
      // Y = Amplitude·sin((2π·X/Wavelength)+PhaseShift)+Baseline — Prism's
      // sine wave with nonzero baseline; Baseline fixed at 0 is the
      // standard sine wave (plan 26). The Wavelength start counts the
      // mean-crossings of the demeaned data: each crossing is half a
      // cycle, so Wavelength ≈ 2·range/crossings. Prism's own guide warns
      // its built-in initial values "rarely work" for this model — the
      // crossing count is the data-driven equivalent (verified in WebR
      // before implementing).
      const start =
        "list(Amplitude=(max(y)-min(y))/2,Wavelength=2*(max(x)-min(x))/max(1,sum(diff(sign(y-mean(y)))!=0)),PhaseShift=0,Baseline=mean(y))";
      return {
        kind: "nls",
        fit: `m<-nls(y~Amplitude*sin((2*pi*x/Wavelength)+PhaseShift)+Baseline,start=${start},algorithm="port",lower=c(-Inf,0,-Inf,-Inf),control=nls.control(maxiter=200))`,
        terms: ["Amplitude", "Wavelength", "PhaseShift", "Baseline"],
        derived: [overK("Frequency", "1", "Wavelength")],
        curveFn:
          'g<-function(xv,p) p[["Amplitude"]]*sin((2*pi*xv/p[["Wavelength"]])+p[["PhaseShift"]])+p[["Baseline"]]',
      };
    }
    // ── Gaussian family completion (1.8, B6 §Gaussian) ───────────────────
    // Prism's remaining Gaussian models, Curve Fitting Guide equations
    // (reg_how_to_gaussian.htm, reg_how_to_lognormal.htm, FAQ 1212 for the
    // cumulative forms). Same "port" fitter as the v2 classics.
    case "sum-of-two-gaussians": {
      // Y = One + Two (B6: "Sum of two Gaussians: Y = One + Two").
      // The starts take the taller peak first (Mean1 at max Y); the second
      // peak starts at the median X with half the amplitude — Prism warns
      // its own initial values for this model are unreliable, and the fit
      // is start-sensitive on overlapping peaks.
      const expr =
        "Amplitude1*exp(-0.5*((x-Mean1)/SD1)^2)+Amplitude2*exp(-0.5*((x-Mean2)/SD2)^2)";
      return {
        kind: "nls",
        fit: `m<-nls(y~${expr},start=list(Amplitude1=max(y),Mean1=x[which.max(y)],SD1=(max(x)-min(x))/6,Amplitude2=max(y)/2,Mean2=median(x),SD2=(max(x)-min(x))/6),algorithm="port",lower=c(-Inf,-Inf,0,-Inf,-Inf,0),control=nls.control(maxiter=200))`,
        terms: ["Amplitude1", "Mean1", "SD1", "Amplitude2", "Mean2", "SD2"],
        derived: [
          {
            label: "Area",
            expr: 'ifelse(cf[["SD1"]]>0&cf[["SD2"]]>0,(cf[["Amplitude1"]]*cf[["SD1"]]+cf[["Amplitude2"]]*cf[["SD2"]])*sqrt(2*pi),NA_real_)',
          },
        ],
        curveFn:
          'g<-function(xv,p) p[["Amplitude1"]]*exp(-0.5*((xv-p[["Mean1"]])/p[["SD1"]])^2)+p[["Amplitude2"]]*exp(-0.5*((xv-p[["Mean2"]])/p[["SD2"]])^2)',
      };
    }
    case "lognormal":
      // Prism's "Log Gaussian": Y=(A/X)*exp(-0.5*(ln(X/GeoMean)/ln(GeoSD))^2).
      // A is related to amplitude and area (guide: Amplitude =
      // A/(GeoMean/exp(0.5*ln(GeoSD)^2)); Area = A*sqrt(2*pi)*ln(GeoSD)).
      // X must be > 0 (ln X).
      return {
        kind: "nls",
        fit: "m<-nls(y~(A/x)*exp(-0.5*(log(x/GeoMean)/log(GeoSD))^2),start=list(A=max(y)*x[which.max(y)],GeoMean=x[which.max(y)],GeoSD=2),algorithm=\"port\",lower=c(0,0,1),control=nls.control(maxiter=200))",
        terms: ["A", "GeoMean", "GeoSD"],
        derived: [
          {
            label: "Area",
            expr: 'ifelse(cf[["GeoSD"]]>1,cf[["A"]]*sqrt(2*pi)*log(cf[["GeoSD"]]),NA_real_)',
          },
          {
            label: "Amplitude",
            expr: 'ifelse(cf[["GeoMean"]]>0&cf[["GeoSD"]]>1,cf[["A"]]*exp(0.5*log(cf[["GeoSD"]])^2)/cf[["GeoMean"]],NA_real_)',
          },
        ],
        positiveX: true,
        curveFn:
          'g<-function(xv,p) (p[["A"]]/xv)*exp(-0.5*(log(xv/p[["GeoMean"]])/log(p[["GeoSD"]]))^2)',
      };
    case "cumulative-gaussian-percent":
      // Y = 100·Φ((X−Mean)/SD) — Prism's cumulative Gaussian for data
      // expressed as percents (FAQ 1212: Top constrained to 100).
      return {
        kind: "nls",
        fit: "m<-nls(y~100*pnorm((x-Mean)/SD),start=list(Mean=median(x),SD=(max(x)-min(x))/4),algorithm=\"port\",lower=c(-Inf,0),control=nls.control(maxiter=200))",
        terms: ["Mean", "SD"],
        curveFn: 'g<-function(xv,p) 100*pnorm((xv-p[["Mean"]])/p[["SD"]])',
      };
    case "cumulative-gaussian-fraction":
      // Y = Φ((X−Mean)/SD) — the fractions form (Top = 1).
      return {
        kind: "nls",
        fit: "m<-nls(y~pnorm((x-Mean)/SD),start=list(Mean=median(x),SD=(max(x)-min(x))/4),algorithm=\"port\",lower=c(-Inf,0),control=nls.control(maxiter=200))",
        terms: ["Mean", "SD"],
        curveFn: 'g<-function(xv,p) pnorm((xv-p[["Mean"]])/p[["SD"]])',
      };
    case "cumulative-gaussian-counts":
      // Y = Total·Φ((X−Mean)/SD) — the counts form (Top = N, fitted).
      return {
        kind: "nls",
        fit: "m<-nls(y~Total*pnorm((x-Mean)/SD),start=list(Mean=median(x),SD=(max(x)-min(x))/4,Total=max(y)),algorithm=\"port\",lower=c(-Inf,0,0),control=nls.control(maxiter=200))",
        terms: ["Mean", "SD", "Total"],
        curveFn:
          'g<-function(xv,p) p[["Total"]]*pnorm((xv-p[["Mean"]])/p[["SD"]])',
      };
    case "sum-of-two-lorentzians": {
      // Y = Amplitude1/(1+((X−Center1)/Width1)²) + Amplitude2/(1+((X−Center2)/Width2)²)
      // — the Lorentzian twin of the sum of two Gaussians (B6 §Gaussian #8).
      const expr =
        "Amplitude1/(1+((x-Center1)/Width1)^2)+Amplitude2/(1+((x-Center2)/Width2)^2)";
      return {
        kind: "nls",
        fit: `m<-nls(y~${expr},start=list(Amplitude1=max(y),Center1=x[which.max(y)],Width1=(max(x)-min(x))/6,Amplitude2=max(y)/2,Center2=median(x),Width2=(max(x)-min(x))/6),algorithm="port",lower=c(-Inf,-Inf,0,-Inf,-Inf,0),control=nls.control(maxiter=200))`,
        terms: ["Amplitude1", "Center1", "Width1", "Amplitude2", "Center2", "Width2"],
        derived: [
          {
            label: "Area",
            expr: 'ifelse(cf[["Width1"]]>0&cf[["Width2"]]>0,pi*(cf[["Amplitude1"]]*cf[["Width1"]]+cf[["Amplitude2"]]*cf[["Width2"]]),NA_real_)',
          },
        ],
        curveFn:
          'g<-function(xv,p) p[["Amplitude1"]]/(1+((xv-p[["Center1"]])/p[["Width1"]])^2)+p[["Amplitude2"]]/(1+((xv-p[["Center2"]])/p[["Width2"]])^2)',
      };
    }
    // ── Sine waves completion (1.8, B6 §Sine waves) ──────────────────────
    // Prism's remaining sine models, Curve Fitting Guide equations
    // (reg_damped_sine_wave.htm, reg_sinc_wave.htm, reg_classic_sine.htm).
    // The standard sine wave is the sine-wave equation with Baseline fixed
    // at 0 (the guide: "in most cases, you will want to fix BASELINE to a
    // constant value of zero") — its own entry, so the picker names it.
    case "standard-sine-wave": {
      // Y = Amplitude·sin((2π·X/Wavelength)+PhaseShift).
      const start =
        "list(Amplitude=(max(y)-min(y))/2,Wavelength=2*(max(x)-min(x))/max(1,sum(diff(sign(y-mean(y)))!=0)),PhaseShift=0)";
      return {
        kind: "nls",
        fit: `m<-nls(y~Amplitude*sin((2*pi*x/Wavelength)+PhaseShift),start=${start},algorithm="port",lower=c(-Inf,0,-Inf),control=nls.control(maxiter=200))`,
        terms: ["Amplitude", "Wavelength", "PhaseShift"],
        derived: [overK("Frequency", "1", "Wavelength")],
        curveFn:
          'g<-function(xv,p) p[["Amplitude"]]*sin((2*pi*xv/p[["Wavelength"]])+p[["PhaseShift"]])',
      };
    }
    case "damped-sine-wave": {
      // Y = Amplitude·exp(−K·X)·sin((2π·X/Wavelength)+PhaseShift).
      // Half-life = 0.693/K (guide). No Baseline in Prism's equation.
      const start =
        "list(Amplitude=(max(y)-min(y))/2,Wavelength=2*(max(x)-min(x))/max(1,sum(diff(sign(y-mean(y)))!=0)),PhaseShift=0,K=0.1)";
      return {
        kind: "nls",
        fit: `m<-nls(y~Amplitude*exp(-K*x)*sin((2*pi*x/Wavelength)+PhaseShift),start=${start},algorithm="port",lower=c(-Inf,0,-Inf,0),control=nls.control(maxiter=200))`,
        terms: ["Amplitude", "Wavelength", "PhaseShift", "K"],
        derived: [overK("Frequency", "1", "Wavelength"), overK("Half-life", "log(2)", "K")],
        curveFn:
          'g<-function(xv,p) p[["Amplitude"]]*exp(-p[["K"]]*xv)*sin((2*pi*xv/p[["Wavelength"]])+p[["PhaseShift"]])',
      };
    }
    case "sinc":
      // Y = Amplitude·sin(2π·X/Wavelength)/(2π·X/Wavelength), Y = Amplitude
      // at X = 0 (guide's IF(X=0,Amplitude,…)). ifelse evaluates both
      // branches, but the NaN in the unselected branch is discarded — the
      // FOUR_X pattern. The Wavelength start counts the sign changes of
      // the raw Y (each zero crossing is half a wavelength apart): the
      // demeaned count the sine models use collapses here, because a
      // sinc's mean sits above most of its lobes.
      return {
        kind: "nls",
        fit: "m<-nls(y~ifelse(x==0,Amplitude,Amplitude*sin(2*pi*x/Wavelength)/(2*pi*x/Wavelength)),start=list(Amplitude=max(y),Wavelength=2*(max(x)-min(x))/max(1,sum(diff(sign(y))!=0))),algorithm=\"port\",lower=c(-Inf,0),control=nls.control(maxiter=200))",
        terms: ["Amplitude", "Wavelength"],
        derived: [overK("Frequency", "1", "Wavelength")],
        curveFn:
          'g<-function(xv,p) ifelse(xv==0,p[["Amplitude"]],p[["Amplitude"]]*sin(2*pi*xv/p[["Wavelength"]])/(2*pi*xv/p[["Wavelength"]]))',
      };
    // ── Enzyme kinetics (plan 09) ───────────────────────────────────────
    // All three fit with nls() algorithm "port" (nl2sol), like plan 08's
    // exponentials: the default Gauss-Newton fails to converge on
    // (near-)noiseless fits in WebR's R 4.6.0 even from exact starts, while
    // "port" recovers the generating parameters. Michaelis-Menten is
    // algebraically the hyperbola (Bmax·X/(Kd + X)) with Prism's Vmax/Km
    // names — a separate model entry, same formula, no duplicated fitter.
    // None sets positiveX: the formulas are defined at X = 0, so the
    // vehicle point stays in the fit; median(x[x > 0]) is used only for
    // the Km/Khalf start values. All three set nonNegativeX (R3-10): the
    // interpolation grid and point-estimate search must stay at X ≥ 0 —
    // below zero allosteric-sigmoidal is NaN for a non-integer Hill slope
    // and Michaelis-Menten's pole at −Km captures the band inversion.
    case "michaelis-menten": {
      // Y = Vmax·X / (Km + X). Vmax/Km's CI is the delta method (upstream
      // reports no CI for it; Prism does).
      const ratio = 'cf[["Vmax"]]/cf[["Km"]]';
      const se =
        'sqrt(V["Vmax","Vmax"]/cf[["Km"]]^2+cf[["Vmax"]]^2*V["Km","Km"]/cf[["Km"]]^4-2*cf[["Vmax"]]*V["Vmax","Km"]/cf[["Km"]]^3)';
      return {
        kind: "nls",
        fit: "m<-nls(y~Vmax*x/(Km+x),start=list(Vmax=max(y)*1.1,Km=median(x[x>0])),algorithm=\"port\")",
        terms: ["Vmax", "Km"],
        nonNegativeX: true,
        derived: [
          {
            label: "Vmax/Km",
            expr: `ifelse(cf[["Km"]]>0,${ratio},NA_real_)`,
            low: `ifelse(cf[["Km"]]>0,${ratio}-q*${se},NA_real_)`,
            high: `ifelse(cf[["Km"]]>0,${ratio}+q*${se},NA_real_)`,
          },
        ],
        curveFn: 'g<-function(xv,p) p[["Vmax"]]*xv/(p[["Km"]]+xv)',
      };
    }
    case "allosteric-sigmoidal":
      // Y = Vmax·X^h / (Khalf^h + X^h).
      return {
        kind: "nls",
        fit: "m<-nls(y~Vmax*x^h/(Khalf^h+x^h),start=list(Vmax=max(y)*1.1,Khalf=median(x[x>0]),h=1),algorithm=\"port\")",
        terms: ["Vmax", "Khalf", "HillSlope"],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) p[["Vmax"]]*xv^p[["h"]]/(p[["Khalf"]]^p[["h"]]+xv^p[["h"]])',
      };
    case "substrate-inhibition":
      // Y = Vmax·X / (Km + X + X²/Ki). Ki's start is the least robust, so
      // the fit is retried once with Ki = 5 × median(S) if nls() fails.
      return {
        kind: "nls",
        fit: "m<-nls(y~Vmax*x/(Km+x+x^2/Ki),start=list(Vmax=max(y)*1.5,Km=median(x[x>0]),Ki=max(x)),algorithm=\"port\")",
        terms: ["Vmax", "Km", "Ki"],
        nonNegativeX: true,
        curveFn: 'g<-function(xv,p) p[["Vmax"]]*xv/(p[["Km"]]+xv+xv^2/p[["Ki"]])',
        retryFits: [
          {
            fit: "m<-nls(y~Vmax*x/(Km+x+x^2/Ki),start=list(Vmax=max(y)*1.5,Km=median(x[x>0]),Ki=median(x[x>0])*5),algorithm=\"port\")",
            method: "port",
          },
        ],
      };
    // ── Binding — Competition (plan 28) ─────────────────────────────────
    // Prism's built-in "Two sites — Fit logIC50" fixes BOTH Hill slopes at
    // −1 (standard slope):
    //   Y = Bottom + (Top−Bottom)·(Frac/(1+10^(X−LogIC50Hi)) + (1−Frac)/(1+10^(X−LogIC50Lo)))
    // Source: GraphPad Prism Curve Fitting Guide, "Equation: Two sites -
    // Fit logIC50" (graphpad.com/guides/prism/10/curve-fitting/reg_competition_two_sites_ic50.htm).
    // DEVIATION from the plan: the plan's equation carries a shared fitted
    // HillSlope — that is Prism's older "classic" variable-slope form, not
    // the built-in model, so this build has no HillSlope term.
    // Both two-site fits use nls() algorithm "port": the default
    // Gauss-Newton fails on (near-)noiseless two-site data in WebR's R
    // ("step factor reduced below 'minFactor'"), while "port" recovers the
    // generating parameters exactly (verified in R before implementing).
    // FractionHi is bounded to [0,1] — outside it, the "fraction" is meaningless.
    case "two-site-competition-logx": {
      const expr =
        "Bottom+(Top-Bottom)*(FractionHi/(1+10^(x-LogIC50Hi))+(1-FractionHi)/(1+10^(x-LogIC50Lo)))";
      // Starting values (the plan's strategy — a bad start is the #1 reason
      // two-site fits fail): the high-affinity LogIC50 from the
      // low-concentration half's median X, the low-affinity one from the
      // high half's, Frac = 0.5.
      const start =
        "list(Bottom=min(y),Top=max(y),LogIC50Hi=median(x[x<=median(x)]),LogIC50Lo=median(x[x>median(x)]),FractionHi=0.5)";
      return {
        kind: "nls",
        fit:
          `m<-nls(y~${expr},start=${start},algorithm="port",` +
          `lower=c(-Inf,-Inf,-Inf,-Inf,0),upper=c(Inf,Inf,Inf,Inf,1),control=nls.control(maxiter=200))`,
        terms: ["Bottom", "Top", "LogIC50Hi", "LogIC50Lo", "FractionHi"],
        derived: [
          tenTo("IC50 (high affinity)", "LogIC50Hi"),
          ...(opts?.kiDivisor != null ? [kiFromLog("Ki (high affinity)", "LogIC50Hi", opts.kiDivisor)] : []),
          tenTo("IC50 (low affinity)", "LogIC50Lo"),
          ...(opts?.kiDivisor != null ? [kiFromLog("Ki (low affinity)", "LogIC50Lo", opts.kiDivisor)] : []),
          span,
        ],
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])*(p[["FractionHi"]]/(1+10^(xv-p[["LogIC50Hi"]]))+(1-p[["FractionHi"]])/(1+10^(xv-p[["LogIC50Lo"]])))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "LogIC50Hi" },
      };
    }
    case "two-site-competition-x": {
      // Same model, X the raw concentration: 1/(1+X/IC50) is the fixed-slope
      // (−1) form in concentration units. X = 0 vehicle points are dropped
      // (positiveX), as for the other ratio forms. The raw-concentration
      // parameterisation is worse conditioned than the log form: in WebR's
      // R 4.6.0 the half-median starts that the log form uses fail here
      // ("singular convergence"), so this model starts from the geometric
      // mean of each half instead (concentrations are log-spaced in
      // practice) and retries once from the half-medians without bounds if
      // port still fails — both start strategies were verified in WebR on
      // the noiseless fixture before implementing (the retry is modelSpec's
      // retryFits, the substrate-inhibition pattern).
      const expr = "Bottom+(Top-Bottom)*(FractionHi/(1+x/IC50Hi)+(1-FractionHi)/(1+x/IC50Lo))";
      const geoStart =
        "list(Bottom=min(y),Top=max(y),IC50Hi=10^mean(log10(x[x<=median(x)])),IC50Lo=10^mean(log10(x[x>median(x)])),FractionHi=0.5)";
      const medianStart =
        "list(Bottom=min(y),Top=max(y),IC50Hi=median(x[x<=median(x)]),IC50Lo=median(x[x>median(x)]),FractionHi=0.5)";
      return {
        kind: "nls",
        fit:
          `m<-nls(y~${expr},start=${geoStart},algorithm="port",` +
          `lower=c(-Inf,-Inf,0,0,0),upper=c(Inf,Inf,Inf,Inf,1),control=nls.control(maxiter=200))`,
        terms: ["Bottom", "Top", "IC50Hi", "IC50Lo", "FractionHi"],
        derived: [
          ...(opts?.kiDivisor != null ? [kiFromLinear("Ki (high affinity)", "IC50Hi", opts.kiDivisor)] : []),
          ...(opts?.kiDivisor != null ? [kiFromLinear("Ki (low affinity)", "IC50Lo", opts.kiDivisor)] : []),
          span,
        ],
        nonNegativeX: true,
        curveFn:
          'g<-function(xv,p) p[["Bottom"]]+(p[["Top"]]-p[["Bottom"]])*(p[["FractionHi"]]/(1+xv/p[["IC50Hi"]])+(1-p[["FractionHi"]])/(1+xv/p[["IC50Lo"]]))',
        asymptotes: ["Bottom", "Top"],
        dose: { expr, midpoint: "IC50Hi" },
        retryFits: [
          {
            fit: `m<-nls(y~${expr},start=${medianStart},algorithm="port",control=nls.control(maxiter=200))`,
            method: "port",
          },
        ],
      };
    }
    case "homologous-competition-logx": {
      // Prism's "One site — Homologous": the labeled and unlabeled ligands
      // are the same compound, so Ki = Kd by definition. With [L] the
      // radioligand concentration (same units as 10^X) and Kd fitted:
      //   Cold = 10^X;  Y = Bmax·[L]/([L] + Cold + Kd) + Bottom
      // fitted as LogKd, so Kd = 10^LogKd > 0 by construction (the plan's
      // "negative Kd" case cannot occur). Source: GraphPad Prism Curve
      // Fitting Guide, "Equation: One site - Homologous"
      // (graphpad.com/guides/prism/7/curve-fitting/reg_homologous_one_site_two_conc.htm).
      // The default Gauss-Newton fails on (near-)noiseless homologous data
      // ("singular gradient"); algorithm "port" recovers the generating
      // parameters exactly (verified in R before implementing). The cold
      // concentration displacing half the hot binding is IC50 = [L] + Kd.
      const l =
        opts?.ligandConcentration != null && Number.isFinite(opts.ligandConcentration)
          ? String(opts.ligandConcentration)
          : "L";
      const expr = `Bmax*${l}/(${l}+10^x+10^LogKd)+Bottom`;
      return {
        kind: "nls",
        fit:
          `m<-nls(y~${expr},start=list(Bmax=(max(y)-min(y))*(${l}+10^median(x))/${l},` +
          `LogKd=median(x),Bottom=min(y)),algorithm="port",control=nls.control(maxiter=200))`,
        terms: ["Bmax", "LogKd", "Bottom"],
        derived: [
          tenTo("Kd", "LogKd"),
          {
            label: "IC50",
            expr: `${l}+10^cf[["LogKd"]]`,
            low: `${l}+10^pci("LogKd")[1]`,
            high: `${l}+10^pci("LogKd")[2]`,
          },
        ],
        curveFn: `g<-function(xv,p) p[["Bmax"]]*${l}/(${l}+10^xv+10^p[["LogKd"]])+p[["Bottom"]]`,
        dose: { expr, midpoint: "LogKd" },
        needsRadioligand: true,
      };
    }
    default:
      throw new Error(`Model "${model}" is not implemented in the shared fit yet.`);
  }
}

/** The formula's right-hand side: the `EXPR` of `m<-nls(y~EXPR,start=...)`
 *  (lm specs have no nls formula — `undefined`). Plan 26 needs it for the
 *  global fit's stacked formula; the first `,start=` after `y~` delimits it
 *  (no formula contains that sequence; the 5PL's inner nls comes later). */
export function formulaExpr(spec: ModelSpec): string | undefined {
  const fit = spec.fit;
  const yAt = fit.indexOf("y~");
  if (yAt < 0) return undefined;
  const startAt = fit.indexOf(",start=", yAt);
  if (startAt < 0) return undefined;
  return fit.slice(yAt + 2, startAt);
}

/** Index of the `)` matching the `(` at `open` (-1 when unbalanced). */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split a comma list at depth 0 (parentheses respected). */
function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}

/** The R variable name of each term, in terms order, read off the fit's
 *  start list (`list(Bottom=...,Top=...)` or the 5PL's
 *  `c(as.list(coef(<inner nls>)),S=1)` — the inner fit's start list, then
 *  the plain entries). Usually identical to the terms; the exception is the
 *  allosteric sigmoidal, whose Hill slope is the variable `h`. `undefined`
 *  when the start list cannot be parsed — the caller must refuse to rewrite
 *  the fit rather than guess. */
export function formulaVariables(spec: ModelSpec): string[] | undefined {
  const startAt = spec.fit.indexOf(",start=");
  if (startAt < 0) return undefined;
  return startVariables(spec.fit.slice(startAt + 7));
}

/** The model's data-driven start expressions (`Name=expr` over `x`/`y`,
 *  in start-list order) — what the single-curve fit starts from. Only a
 *  plain `list(...)` start qualifies: a 5PL's `c(as.list(coef(...)), S=1)`
 *  start needs its inner fit first, so it returns undefined. The global
 *  fit's restart ladder (F5-hom) evaluates these per series to rebuild
 *  stacked starts far from the singles' fitted values. */
export function startExpressions(spec: ModelSpec): { name: string; expr: string }[] | undefined {
  const startAt = spec.fit.indexOf(",start=list(");
  if (startAt < 0) return undefined;
  const s = spec.fit.slice(startAt + 7);
  const close = matchParen(s, 4);
  if (close < 0) return undefined;
  const out: { name: string; expr: string }[] = [];
  for (const e of splitTopLevel(s.slice(5, close))) {
    const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/s);
    if (!m) return undefined;
    out.push({ name: m[1], expr: m[2].trim() });
  }
  return out.length ? out : undefined;
}

/** Variable names of one start expression (`list(...)` / `c(...)`). */
function startVariables(expr: string): string[] | undefined {
  const s = expr.trim();
  if (s.startsWith("list(")) {
    const close = matchParen(s, 4);
    if (close < 0) return undefined;
    const names: string[] = [];
    for (const e of splitTopLevel(s.slice(5, close))) {
      const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
      if (!m) return undefined;
      names.push(m[1]);
    }
    return names;
  }
  if (s.startsWith("c(")) {
    const close = matchParen(s, 1);
    if (close < 0) return undefined;
    const out: string[] = [];
    for (const e of splitTopLevel(s.slice(2, close))) {
      const t = e.trim();
      if (t.startsWith("as.list(coef(")) {
        const innerStart = t.indexOf(",start=");
        if (innerStart < 0) return undefined;
        const inner = startVariables(t.slice(innerStart + 7));
        if (!inner) return undefined;
        out.push(...inner);
      } else {
        const m = t.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
        if (!m) return undefined;
        out.push(m[1]);
      }
    }
    return out;
  }
  if (s.startsWith("local(")) {
    // The growth models start from a local block whose last statement is
    // the start list (logistic-growth, gompertz-growth): the names are
    // that list's, in order (Round 2 Issue 37 — without this the rewrite
    // refuses the fit outright).
    const close = matchParen(s, 5);
    if (close < 0) return undefined;
    const inner = s.slice(7, close - 1);
    const listAt = inner.lastIndexOf("list(");
    if (listAt < 0) return undefined;
    const listClose = matchParen(inner, listAt + 4);
    if (listClose < 0) return undefined;
    const names: string[] = [];
    for (const e of splitTopLevel(inner.slice(listAt + 5, listClose))) {
      const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
      if (!m) return undefined;
      names.push(m[1]);
    }
    return names;
  }
  return undefined;
}

// ── Fit options (plan 26): weighting, fixed parameters, bounds ──────────
// A fixed parameter is substituted as a constant into the formula (and the
// derived expressions, the curve function and the dose expression) and
// dropped from the start list — nls() ERRORS on a start value for a
// parameter the formula no longer has ("singular gradient matrix at initial
// parameter estimates", verified in R), so the drop is not optional, and
// the 5PL's inner nls (which only supplies starts) is rewritten the same
// way. Bounds switch the fit to algorithm="port" with lower/upper vectors
// aligned with the remaining parameters' start order (±Inf where unbounded);
// a start outside its bounds makes nls fail with "initial par violates
// constraints", surfaced as the usual fit error. Weights add `weights=w`
// (the vector is assigned before the fit) and the summary quantities become
// the weighted ones — summary(lm)'s R² is the weighted one, so the weighted
// SS/SST definitions below match it (verified in R: 0.998473 either way).

/** Per-point weights (same order as xs/ys), parameters held constant, and
 *  parameter bounds — all optional; absent means the historical fit. */
export interface FitOptions {
  weights?: number[];
  fixed?: Record<string, number>;
  bounds?: Record<string, [number, number]>;
  /** The fitting method (seq 200): least squares (default), robust (Tukey
   *  biweight IRLS) or Poisson (weights 1/fitted IRLS). */
  fitMethod?: NonlinearFitMethod;
  /** How a difficult fit is handled (seq 323): identify unstable
   *  parameters (default) or report best-fit values no matter what. */
  difficultFitHandling?: NonlinearDifficultFitHandling;
}

export interface AppliedFitOptions {
  /** The spec to fit (terms/derived/curveFn/dose rewritten when parameters
   *  are fixed; fit rewritten for weights/bounds). */
  spec: ModelSpec;
  /** R run before the fit (the weights vector, when weighted). */
  extraAssignments: string;
}

const rNum = (v: number): string => {
  if (!Number.isFinite(v)) throw new Error(`Not a finite number: ${v}`);
  return String(v);
};

/** Substitute fixed parameters as constants in a formula (bare names).
 *  String literals are left alone: the analytic-gradient retry names its
 *  parameters as strings in deriv()'s theta list (c("LogEC50","HillSlope")),
 *  and substituting a fixed value there would corrupt the list. */
function substituteFormula(expr: string, fixedByVar: Record<string, number>): string {
  return expr
    .split(/("[^"]*")/g)
    .map((part, i) => (i % 2 === 0 ? substituteNames(part, fixedByVar) : part))
    .join("");
}

/** Substitute fixed parameters as constants in a bare-name expression. */
function substituteNames(expr: string, fixedByVar: Record<string, number>): string {
  let out = expr;
  for (const [name, value] of Object.entries(fixedByVar))
    out = out.replace(new RegExp(`\\b${name}\\b`, "g"), `(${rNum(value)})`);
  return out;
}

/** Substitute fixed parameters in a curve function (`p[["Name"]]`). */
function substituteCurveFn(fn: string, fixedByVar: Record<string, number>): string {
  let out = fn;
  for (const [name, value] of Object.entries(fixedByVar))
    out = out.replaceAll(`p[["${name}"]]`, `(${rNum(value)})`);
  return out;
}

/** Substitute fixed parameters in a derived expression: `cf[["P"]]` becomes
 *  the constant, `pci("P")` its degenerate CI, and any covariance with P
 *  becomes 0 (a fixed parameter has no variance). */
function substituteDerived(expr: string, fixedByVar: Record<string, number>): string {
  let out = expr;
  for (const [name, value] of Object.entries(fixedByVar)) {
    const v = rNum(value);
    out = out.replaceAll(`pci("${name}")`, `c(${v},${v})`);
    out = out.replaceAll(`cf[["${name}"]]`, `(${v})`);
    out = out.replace(new RegExp(`V\\["${name}","[^"]+"\\]`, "g"), "0");
    out = out.replace(new RegExp(`V\\["[^"]+","${name}"\\]`, "g"), "0");
  }
  return out;
}

/** Rewrite one nls call's start list, dropping the fixed variables and
 *  rewriting any inner nls the same way (the 5PL's start supplier). */
function transformStart(start: string, fixedByVar: Record<string, number>): string {
  const s = start.trim();
  if (s.startsWith("list(")) {
    const close = matchParen(s, 4);
    if (close < 0) throw new Error("Cannot parse the fit's start list.");
    const kept = splitTopLevel(s.slice(5, close)).filter((e) => {
      const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
      return !m || !Object.hasOwn(fixedByVar, m[1]);
    });
    return `list(${kept.join(",")})`;
  }
  if (s.startsWith("c(")) {
    const close = matchParen(s, 1);
    if (close < 0) throw new Error("Cannot parse the fit's start list.");
    const kept = splitTopLevel(s.slice(2, close))
      .map((e) => {
        const t = e.trim();
        if (!t.startsWith("as.list(coef(")) return t;
        // The inner nls supplies starts: rewrite it the same way, so a
        // fixed parameter leaves its coefficient list too. The inner call
        // is the `nls(...)` ending at its own matching paren (the trailing
        // `))` closes coef(/as.list(), not the call).
        const nlsAt = t.indexOf("nls(");
        const callClose = matchParen(t, nlsAt + 3);
        if (callClose < 0) throw new Error("Cannot parse the fit's start list.");
        const inner = transformNlsCall(t.slice(nlsAt, callClose + 1), fixedByVar, {});
        return t.slice(0, nlsAt) + inner + t.slice(callClose + 1);
      })
      .filter((e) => {
        const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
        return !m || !Object.hasOwn(fixedByVar, m[1]);
      });
    return `c(${kept.join(",")})`;
  }
  if (s.startsWith("local(")) {
    // The growth models' start block (logistic-growth, gompertz-growth):
    // rewrite its final list(...) the same way — drop the fixed entries
    // (substituting their values into the surviving expressions, which
    // name only the block's locals) and keep the setup statements verbatim.
    const close = matchParen(s, 5);
    if (close < 0) throw new Error("Cannot parse the fit's start list.");
    const inner = s.slice(7, close - 1);
    const listAt = inner.lastIndexOf("list(");
    if (listAt < 0) throw new Error("Cannot parse the fit's start list.");
    const listClose = matchParen(inner, listAt + 4);
    if (listClose < 0) throw new Error("Cannot parse the fit's start list.");
    const kept = splitTopLevel(inner.slice(listAt + 5, listClose))
      .filter((e) => {
        const m = e.trim().match(/^([A-Za-z][A-Za-z0-9_]*)\s*=/);
        return !m || !Object.hasOwn(fixedByVar, m[1]);
      })
      .map((e) => substituteNames(e, fixedByVar));
    return `local({${inner.slice(0, listAt)}list(${kept.join(",")})${inner.slice(listClose + 1)}})`;
  }
  throw new Error("Cannot parse the fit's start list.");
}

/** Rewrite one `nls(y~EXPR,start=START,...)` call (with or without an
 *  `m<-` assignment): fixed variables substituted into the formula and
 *  dropped from the start list, bounds (when given, aligned with
 *  `remainingVars`) switching the call to algorithm="port". `bounds` is
 *  keyed by variable name. A model's own built-in lower=/upper= bounds
 *  survive the rewrite — the caller's bounds override them per variable,
 *  the rest carry over (Round 2 Issue 37: the old code dropped the
 *  built-in bounds whenever weights, fixed parameters, bounds or IRLS
 *  rewrote the call, silently unbounding e.g. FractionHi). */
function transformNlsCall(
  call: string,
  fixedByVar: Record<string, number>,
  boundsByVar: Record<string, [number, number]>,
  remainingVars?: string[],
): string {
  const yAt = call.indexOf("y~");
  const startAt = call.indexOf(",start=", yAt);
  if (yAt < 0 || startAt < 0) throw new Error("Cannot parse the fit's formula.");
  const head = call.slice(0, yAt + 2);
  const expr = substituteFormula(call.slice(yAt + 2, startAt), fixedByVar);
  const rest = call.slice(startAt + 7);
  // The start expression (`list(...)` / `c(...)` / the growth models'
  // `local({...})`) ends at its matching paren; everything after it is
  // the call's trailing arguments plus the closing paren of nls(. They
  // are parsed, not matched against a fixed list: `,algorithm="port"`,
  // `,control=nls.control(maxiter=200)` (or with `,tol=1e-3` — the 4PL
  // retry), `,lower=...`, `,upper=...`. The control call is preserved
  // verbatim — its tolerance is the retry's point, and dropping it would
  // silently re-impose tol=1e-5 on a retried fit. lower/upper are merged
  // with the caller's bounds below; anything else unrecognised still
  // throws rather than guessing.
  if (!rest.startsWith("list(") && !rest.startsWith("c(") && !rest.startsWith("local("))
    throw new Error("Cannot parse the fit's start list.");
  const openAt = rest.indexOf("(");
  const startClose = matchParen(rest, openAt);
  if (startClose < 0) throw new Error("Cannot parse the fit's start list.");
  const trailing = rest.slice(startClose + 1);
  if (!trailing.endsWith(")")) throw new Error("Cannot parse the fit's trailing arguments.");
  const trailingArgs = splitTopLevel(trailing.slice(0, -1).replace(/^,/, ""));
  const hadPort = trailingArgs.some((a) => a.trim() === 'algorithm="port"');
  const control = trailingArgs.find((a) => a.trim().startsWith("control="));
  for (const a of trailingArgs) {
    const t = a.trim();
    if (t !== 'algorithm="port"' && !t.startsWith("control=") && !t.startsWith("lower=") && !t.startsWith("upper="))
      throw new Error("Cannot parse the fit's trailing arguments.");
  }
  // The call's own bounds, as written (`lower=c(-Inf,-Inf,0)`), aligned
  // with the start list's variables — the base the caller's bounds
  // override per variable. They are positional, so the start variables
  // (before fixed parameters are dropped) are the alignment.
  const boundVec = (name: "lower" | "upper"): string[] | undefined => {
    const arg = trailingArgs.find((a) => a.trim().startsWith(`${name}=c(`));
    if (!arg) return undefined;
    return splitTopLevel(arg.trim().slice(name.length + 3, -1)).map((e) => e.trim());
  };
  const builtinLower = boundVec("lower");
  const builtinUpper = boundVec("upper");
  const startVars = builtinLower || builtinUpper ? startVariables(rest.slice(0, startClose + 1)) : undefined;
  if (
    (builtinLower || builtinUpper) &&
    (!startVars ||
      (builtinLower && builtinLower.length !== startVars.length) ||
      (builtinUpper && builtinUpper.length !== startVars.length))
  )
    throw new Error("Cannot parse the fit's bounds.");
  const start = transformStart(rest.slice(0, startClose + 1), fixedByVar);
  const boundNames = Object.keys(boundsByVar);
  const hasBounds = boundNames.length > 0 || builtinLower !== undefined || builtinUpper !== undefined;
  let args = "";
  // The "port" algorithm must survive the rewrite (the exponential/enzyme
  // fits use it even unbounded); bounds switch a Gauss-Newton fit to it.
  if (hasBounds || hadPort) args += `,algorithm="port"`;
  if (hasBounds) {
    if (!remainingVars) throw new Error("Bounds need the parameter order.");
    const lower = remainingVars.map((v) => {
      if (boundsByVar[v]) return rNum(boundsByVar[v][0]);
      const i = startVars?.indexOf(v) ?? -1;
      return i >= 0 && builtinLower ? builtinLower[i]! : "-Inf";
    });
    const upper = remainingVars.map((v) => {
      if (boundsByVar[v]) return rNum(boundsByVar[v][1]);
      const i = startVars?.indexOf(v) ?? -1;
      return i >= 0 && builtinUpper ? builtinUpper[i]! : "Inf";
    });
    args += `,lower=c(${lower.join(",")}),upper=c(${upper.join(",")})`;
  }
  if (control) args += `,${control.trim()}`;
  return `${head}${expr},start=${start}${args})`;
}

/** Apply weighting / fixed parameters / bounds to a spec, returning the spec
 *  to fit and any R to run before it. Throws when the spec cannot be
 *  rewritten (lm models cannot fix or bound parameters — `lm()` has no such
 *  arguments). The default (no options) returns the spec untouched. */
export function applyFitOptions(spec: ModelSpec, opts: FitOptions): AppliedFitOptions {
  const fixed = opts.fixed ?? {};
  const bounds = opts.bounds ?? {};
  const fixedNames = Object.keys(fixed);
  const boundNames = Object.keys(bounds);
  const extraAssignments = opts.weights ? `w<-${rVec(opts.weights)};` : "";
  if (!fixedNames.length && !boundNames.length && !opts.weights) return { spec, extraAssignments: "" };
  if (spec.kind === "lm") {
    if (fixedNames.length || boundNames.length)
      throw new Error("Fixing or bounding parameters is only supported for nonlinear (nls) curves, not for line/polynomial fits.");
    // Weights only: `lm(y~x)` -> `lm(y~x,weights=w)`.
    if (!spec.fit.endsWith(")")) throw new Error("Cannot parse the fit's formula.");
    return { spec: { ...spec, fit: `${spec.fit.slice(0, -1)},weights=w)` }, extraAssignments };
  }
  const vars = formulaVariables(spec);
  if (!vars || vars.length !== spec.terms.length)
    throw new Error(`Cannot rewrite the "${spec.terms.join(", ")}" fit for fixed/bounded parameters.`);
  const fixedByVar: Record<string, number> = {};
  const boundsByVar: Record<string, [number, number]> = {};
  spec.terms.forEach((term, i) => {
    if (Object.hasOwn(fixed, term)) fixedByVar[vars[i]] = fixed[term]!;
    if (Object.hasOwn(bounds, term)) boundsByVar[vars[i]] = bounds[term]!;
  });
  const remainingTerms = spec.terms.filter((t) => !Object.hasOwn(fixed, t));
  const remainingVars = spec.terms.map((_, i) => vars[i]).filter((_, i) => !Object.hasOwn(fixed, spec.terms[i]));
  let fit = transformNlsCall(spec.fit, fixedByVar, boundsByVar, remainingVars);
  if (opts.weights) fit = `${fit.slice(0, -1)},weights=w)`;
  const out: ModelSpec = {
    ...spec,
    fit,
    terms: remainingTerms,
    derived: spec.derived?.map((d) => ({
      ...d,
      expr: substituteDerived(d.expr, fixedByVar),
      ...(d.low !== undefined ? { low: substituteDerived(d.low, fixedByVar) } : {}),
      ...(d.high !== undefined ? { high: substituteDerived(d.high, fixedByVar) } : {}),
    })),
    ...(spec.curveFn ? { curveFn: substituteCurveFn(spec.curveFn, fixedByVar) } : {}),
    ...(spec.dose ? { dose: { ...spec.dose, expr: substituteFormula(spec.dose.expr, fixedByVar) } } : {}),
    ...(spec.retryFits
      ? {
          retryFits: spec.retryFits.map((r) => ({
            fit: transformNlsCall(r.fit, fixedByVar, boundsByVar, remainingVars),
            method: r.method,
          })),
        }
      : {}),
  };
  if (opts.weights && out.retryFits)
    out.retryFits = out.retryFits.map((r) => ({ ...r, fit: `${r.fit.slice(0, -1)},weights=w)` }));
  return { spec: out, extraAssignments };
}

/** The X/Y columns and the points to fit: the `positiveX` X > 0 drop rule
 *  (log forms), the `nonNegativeX` X ≥ 0 drop rule (raw ratio forms), and
 *  the `nParams + 1` minimum-points rule, shared by both runners. */
export function prepareFit(
  columns: Column[],
  yName: string | undefined,
  model: NonlinearModel,
  /** Parameters held fixed (plan 26): they are not fitted, so they do not
   *  count toward the minimum-points rule. */
  fixedCount = 0,
  /** A spec built already (v2 item 23): the user-defined model's spec comes from its
   *  equation, and `modelSpec(model)` alone cannot build it — pass it here. */
  specOverride?: ModelSpec,
  /** Seq 166 (Prism Range tab): fit only the points with X inside
   *  [`min`, `max`] (either end open when absent). Points outside are
   *  ignored entirely — before the model-specific X filtering below and
   *  before the minimum-points rule — and counted in `rangeExcluded`. */
  range?: { min?: number; max?: number },
): {
  xCol: Column;
  yCol: Column;
  xs: number[];
  ys: number[];
  rows: number[];
  columns: string[];
  rangeExcluded: number;
} | { error: string } {
  const { x: xCol, ys: yCols } = splitXY(columns);
  // A Y data set's replicates pool into one fit (see datasetColumns): a name
  // that is no column but is a data set ("Control" → "Control_1..3") fits
  // every replicate point, as Prism does. A plain column name fits that
  // column alone. The pooled yCol keeps the first replicate's cells (so
  // interpolation still reads a Y per row) under the data set's name.
  const cols =
    yName === undefined
      ? (yCols[0] ? yCols[0].columns : [])
      : (yCols.find((s) => s.name === yName)?.columns ?? datasetColumns(yCols.flatMap((s) => s.columns), yName));
  // The pooled column keeps the data set's name (its first replicate's own
  // name would misname it — a set fitted with no `y` names its set, not a column).
  const yCol = cols.length === 1 ? cols[0] : cols.length > 1 ? { ...cols[0], name: yName ?? cols[0].set ?? cols[0].name } : undefined;
  if (!xCol || !yCol) return { error: xyProblem(columns, yName)! };

  const complete =
    cols.length <= 1
      ? (() => {
          const p = pairUp(xCol, yCol);
          return { ...p, columns: p.rows.map(() => yCol.name) };
        })()
      : cols.reduce(
          (acc, c) => {
            const p = pairUp(xCol, c);
            return {
              x: [...acc.x, ...p.x],
              y: [...acc.y, ...p.y],
              rows: [...acc.rows, ...p.rows],
              columns: [...acc.columns, ...p.rows.map(() => c.name)],
            };
          },
          { x: [] as number[], y: [] as number[], rows: [] as number[], columns: [] as string[] },
        );
  // Seq 166 (Prism Range tab): drop the out-of-range points first, so the
  // model-specific X filtering, the minimum-points rule and the
  // enzyme/plateau validations below all see only the fitted points.
  let rangeExcluded = 0;
  if (range !== undefined) {
    const { min, max } = range;
    if (min != null && !Number.isFinite(min)) return { error: "The X range's lower bound must be a finite number." };
    if (max != null && !Number.isFinite(max)) return { error: "The X range's upper bound must be a finite number." };
    if (min != null && max != null && min > max)
      return { error: `The X range's lower bound (${min}) is above its upper bound (${max}).` };
    const keep = complete.x.map((x) => (min == null || x >= min) && (max == null || x <= max));
    rangeExcluded = keep.filter((k) => !k).length;
    const kept = (arr: number[]) => arr.filter((_, i) => keep[i]);
    const keptStr = (arr: string[]) => arr.filter((_, i) => keep[i]);
    complete.x = kept(complete.x);
    complete.y = kept(complete.y);
    complete.rows = kept(complete.rows);
    complete.columns = keptStr(complete.columns);
  }
  const spec = specOverride ?? modelSpec(model);
  const nParams = spec.terms.length - fixedCount;

  // A log-X curve drops its X = 0 vehicle/control point (log(0) is
  // undefined); a raw-concentration ratio curve keeps it — at X = 0 the
  // curve is its Bottom, so the vehicle point anchors Bottom (Prism fits
  // it too) — and drops only X < 0, where a fractional power is NaN in R.
  // A log-Y curve drops its Y ≤ 0 points the same way (log(Y) is
  // undefined there).
  let xs = complete.x;
  let ys = complete.y;
  if (spec.positiveX || spec.nonNegativeX) {
    const keep = spec.positiveX ? (x: number) => x > 0 : (x: number) => x >= 0;
    xs = [];
    ys = [];
    complete.x.forEach((x, i) => {
      if (keep(x)) {
        xs.push(x);
        ys.push(complete.y[i]);
      }
    });
  }
  if (spec.positiveY) {
    const kept = ys.filter((y) => y > 0);
    const keptXs = xs.filter((_, i) => ys[i] > 0);
    xs = keptXs;
    ys = kept;
  }
  if (xs.length < nParams + 1) {
    const scope = spec.positiveX ? " with X > 0" : spec.nonNegativeX ? " with X ≥ 0" : "";
    const yScope = spec.positiveY ? " with Y > 0" : "";
    const rangeScope = range !== undefined ? " in the fitted X range" : "";
    return {
      error: `Not enough complete points${scope}${yScope}${rangeScope} (${xs.length}) to fit this curve; need at least ${nParams + 1}.`,
    };
  }
  if (ENZYME_MODELS.includes(model)) {
    // Substrate concentrations: negative X is a data error, and Km/Khalf
    // is unidentifiable with no positive X or with all X equal — validate
    // before calling R, not after it fails. The X = 0 vehicle point is
    // kept (the formulas are defined at X = 0); only the start values use
    // the positive X values. The negativity test reads the unfiltered
    // points: `nonNegativeX` drops X < 0 from `xs` above, so testing `xs`
    // would never fire (R3-10).
    if (complete.x.some((x) => x < 0)) return { error: "Substrate concentrations cannot be negative." };
    if (!xs.some((x) => x > 0))
      return { error: "No positive substrate concentration — Km cannot be estimated." };
    if (new Set(xs).size === 1)
      return { error: "All substrate concentrations are equal — Km cannot be estimated." };
  }
  if (model === "plateau-decay" || model === "plateau-association") {
    // X0 (the breakpoint) is unidentifiable without data on both sides of
    // it — validate before calling nls(), not after it fails. R's median of
    // an even count is the mean of the two middle values.
    const sorted = [...xs].sort((a, b) => a - b);
    const mid =
      sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    if (!xs.some((x) => x < mid) || !xs.some((x) => x > mid)) {
      return {
        error: `${MODEL_LABEL[model]} needs data on both sides of the breakpoint.`,
      };
    }
  }
  // The fitted points' rows, in fit order (plan 26: 1/SD² weights need the
  // row's replicate values, not just the fitted pair) — and, per point, the
  // Y column it came from (ROUT's outlier records name it exactly).
  // The row filter mirrors the drops above: X by the X flag, Y by positiveY.
  const rows = complete.rows.filter(
    (_, i) =>
      ((!spec.positiveX && !spec.nonNegativeX) || (spec.positiveX ? complete.x[i] > 0 : complete.x[i] >= 0)) &&
      (!spec.positiveY || complete.y[i] > 0),
  );
  const pointColumns = complete.columns.filter(
    (_, i) =>
      ((!spec.positiveX && !spec.nonNegativeX) || (spec.positiveX ? complete.x[i] > 0 : complete.x[i] >= 0)) &&
      (!spec.positiveY || complete.y[i] > 0),
  );
  return { xCol, yCol, xs, ys, rows, columns: pointColumns, rangeExcluded };
}

/** Seq 323 — Prism's unstable-parameter check (Prism 8/9 Curve Fitting
 *  Guide, "How Prism identifies unstable parameters"): after the fit,
 *  Prism prepares the Hessian matrix — one row/column per fitted parameter,
 *  the Gauss–Newton Hessian JᵀWJ of the (weighted) sum of squares — and
 *  calls a parameter unstable when the matrix's condition number (2-norm,
 *  λmax/λmin) exceeds 10/√ε, ε = 2.22e-16 ("about 670 million"; the 10 is
 *  not a typo). It then removes the parameter that most reduces the
 *  condition, marks it unstable, and repeats until the condition is low
 *  enough. The unstable parameter's best-fit value shows "Unstable" and its
 *  CI "Very wide". The docs are silent on ties, so this implementation
 *  breaks them toward the parameter loading most on the smallest
 *  eigenvector (the direction the data constrain least), then toward the
 *  first in order. Diagnostic only — it never alters fitted values. */
export const UNSTABLE_CONDITION_THRESHOLD = 10 / Math.sqrt(Number.EPSILON);

/** Eigenvalues + eigenvectors of a symmetric matrix, by cyclic Jacobi
 *  rotations (no dependency, and the matrices here are tiny — one row per
 *  fitted parameter). `vectors` holds the eigenvectors as columns, in the
 *  same order as `values`. */
function jacobiEigh(a: number[][]): { values: number[]; vectors: number[][] } {
  const n = a.length;
  const d = a.map((row) => [...row]);
  const v: number[][] = a.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
  const frob = Math.sqrt(d.flat().reduce((s, x) => s + x * x, 0));
  if (frob === 0) return { values: d.map(() => 0), vectors: v };
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += d[p][q] ** 2;
    if (Math.sqrt(off) < 1e-14 * frob) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = d[p][q];
        if (apq === 0) continue;
        const tau = (d[q][q] - d[p][p]) / (2 * apq);
        // Numerical Recipes' sign: +1 when tau >= 0 (Math.sign(0) is 0,
        // which would skip the rotation exactly when the diagonals are
        // equal — the 45° case — and leave the pair unannihilated).
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const dkp = d[k][p];
          const dkq = d[k][q];
          d[k][p] = c * dkp - s * dkq;
          d[k][q] = s * dkp + c * dkq;
        }
        for (let k = 0; k < n; k++) {
          const dpk = d[p][k];
          const dqk = d[q][k];
          d[p][k] = c * dpk - s * dqk;
          d[q][k] = s * dpk + c * dqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: d.map((row, i) => row[i]), vectors: v };
}

/** The 2-norm condition number λmax/λmin of a symmetric Hessian. A
 *  non-positive smallest eigenvalue means the matrix is numerically
 *  singular (a Gauss–Newton Hessian is positive semidefinite, so this is
 *  rounding, not a real negative curvature) — Infinity. A single parameter
 *  is never unstable: its 1×1 condition is 1 by definition. */
export function hessianConditionNumber(hessian: number[][]): number {
  const { values } = jacobiEigh(hessian);
  if (values.length <= 1) return 1;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (!(min > 0) || !Number.isFinite(max)) return Infinity;
  return max / min;
}

/** Prism's greedy elimination on a Hessian: the parameters the data do not
 *  determine, in the order they are removed, plus the full matrix's
 *  condition number. `hessian` must be finite and square, `names` its
 *  parameters in row/column order. */
export function identifyUnstableParameters(
  hessian: number[][],
  names: string[],
): { unstable: string[]; condition: number } {
  if (hessian.length !== names.length || hessian.some((row) => row.length !== names.length))
    throw new Error("identifyUnstableParameters needs a square Hessian matching its parameter names.");
  const sub = (idx: number[]): number[][] => idx.map((i) => idx.map((j) => hessian[i][j]));
  const condition = hessianConditionNumber(hessian);
  let remaining = names.map((_, i) => i);
  let current = condition;
  const unstable: string[] = [];
  while (current > UNSTABLE_CONDITION_THRESHOLD && remaining.length > 1) {
    const { values, vectors } = jacobiEigh(sub(remaining));
    const minAt = values.indexOf(Math.min(...values));
    const small = remaining.map((_, k) => vectors[k][minAt]);
    let best: { k: number; cond: number; loading: number } | null = null;
    for (let k = 0; k < remaining.length; k++) {
      const rest = remaining.filter((_, j) => j !== k);
      const c = hessianConditionNumber(sub(rest));
      const loading = Math.abs(small[k] ?? 0);
      if (best === null) {
        best = { k, cond: c, loading };
        continue;
      }
      const tol = 1e-9 * Math.max(1, best.cond);
      if (c < best.cond - tol) best = { k, cond: c, loading };
      else if (Math.abs(c - best.cond) <= tol && loading > best.loading + 1e-9) best = { k, cond: c, loading };
    }
    unstable.push(names[remaining[best!.k]]!);
    remaining = remaining.filter((_, j) => j !== best!.k);
    current = best!.cond;
  }
  return { unstable, condition };
}

/** Run the unstable-parameter check on a fit's coefficients: flags the
 *  unstable ones (`unstable: true`) and returns their raw parameter names
 *  plus the fit's Hessian condition number (null when the check is off or
 *  there is no Hessian to check). `terms` are the fitted parameters in
 *  Hessian order; `labelTerm` maps them to the coefficients' display
 *  terms. `derived` (seq 388): a derived quantity whose source parameter
 *  is unstable carries that source's display name (`unstableSources`) —
 *  the results note names it. Prism's docs define no rule for derived
 *  values of unstable parameters, so the value itself stays reported. */
export function applyUnstableFlags(
  coefficients: RegressionCoefficient[],
  hessian: number[][] | null,
  terms: string[],
  labelTerm: (term: string) => string,
  handling: NonlinearDifficultFitHandling = "unstable",
  derived?: DerivedRow[],
): { unstableParameters: string[]; condition: number | null } {
  // The three handlings are exclusive: only "unstable" runs this check
  // ("ambiguous" has its own below, "none" reports plain values).
  if (handling !== "unstable" || hessian === null) return { unstableParameters: [], condition: null };
  const { unstable, condition } = identifyUnstableParameters(hessian, terms);
  const flagged = new Set(unstable.map(labelTerm));
  for (const c of coefficients) if (flagged.has(c.term)) c.unstable = true;
  if (derived) {
    for (const row of derived) {
      const src = (row.sources ?? []).map(labelTerm).filter((s) => flagged.has(s));
      if (src.length) row.unstableSources = src;
      else delete row.unstableSources;
    }
  }
  return { unstableParameters: unstable, condition };
}

/** Prism's ambiguity threshold (FAQ 1462): a dependency above 0.9999
 *  labels the fit ambiguous. */
export const AMBIGUOUS_DEPENDENCY_THRESHOLD = 0.9999;

/** Dependency of each fitted parameter (Prism's dependency method, FAQ 931
 *  "How dependency is calculated"): dep_i = 1 − s²/(V_ii·HH_ii), where V
 *  is the fit's covariance matrix (V_ii = SE_i²), HH the Gauss–Newton
 *  Hessian JᵀWJ, and s² = Sy.x². The FAQ's refit definition — 1 − (SE
 *  with all other parameters fixed, corrected by √(df_fixed/df_full),
 *  over SE in the full fit)² — equals this closed form: the fixed SE is
 *  s/√HH_ii, and the correction converts it to the full fit's df scale
 *  (verified against the refit on the FAQ 931 example values, Nov 23,
 *  2026). `coefficients` and the Hessian rows are in the same
 *  (spec.terms) order. Null per parameter when dependency is undefined
 *  there: no Hessian (lm fits), no Sy.x, a zero standard error
 *  (noiseless data), or a non-positive Hessian diagonal. Values are
 *  clamped to [0, 1] — the formula is exact, so anything outside it is
 *  rounding. */
export function parameterDependencies(
  hessian: number[][] | null,
  coefficients: RegressionCoefficient[],
  syx: number | null,
): (number | null)[] {
  if (hessian === null || syx == null || !Number.isFinite(syx) || syx <= 0) return coefficients.map(() => null);
  return coefficients.map((c, i) => {
    const se = c.stdError;
    const hh = hessian[i]?.[i];
    if (se == null || !Number.isFinite(se) || se <= 0 || hh == null || !Number.isFinite(hh) || hh <= 0) return null;
    return Math.min(1, Math.max(0, 1 - (syx * syx) / (se * se * hh)));
  });
}

/** Run the ambiguous-fit check on a fit's coefficients (seq 387): attach
 *  each parameter's dependency (`dependency`, null when undefined) and,
 *  when `handling` is "ambiguous", flag the ones whose dependency exceeds
 *  0.9999 (`ambiguous: true`) and return their raw parameter names. The
 *  other handlings never flag: "unstable" has its own check, "none"
 *  reports plain values. `terms` are the fitted parameters in Hessian
 *  order. Pass `syx` null for a robust/Poisson refit — its IRLS weights
 *  break the V↔HH relation dependency needs (vcov uses the weighted
 *  deviance while Sy.x is recomputed on the raw residuals). */
export function applyAmbiguousFlags(
  coefficients: RegressionCoefficient[],
  hessian: number[][] | null,
  terms: string[],
  syx: number | null,
  handling: NonlinearDifficultFitHandling = "unstable",
): { ambiguousParameters: string[] } {
  const dependencies = parameterDependencies(hessian, coefficients, syx);
  coefficients.forEach((c, i) => {
    c.dependency = dependencies[i] ?? null;
  });
  if (handling !== "ambiguous") return { ambiguousParameters: [] };
  const ambiguousParameters: string[] = [];
  coefficients.forEach((c, i) => {
    const d = dependencies[i];
    if (d != null && d > AMBIGUOUS_DEPENDENCY_THRESHOLD) {
      c.ambiguous = true;
      ambiguousParameters.push(terms[i]!);
    }
  });
  return { ambiguousParameters };
}

/** R statements that, after `m` is fitted, compute the summary quantities
 *  (`s`, `co`, `cf`, `df`, `ss`, `sst`, `r2`, `syx`) plus the covariance
 *  (`V`), the t critical value (`q`) and a coefficient's 95% CI (`pci`) —
 *  everything the fit entries and the derived CIs need. Weighted fits use
 *  the weighted sums of squares (summary(lm)'s R² is the weighted one, so
 *  this matches it — verified in R). */
export function fitSummaryStatements(spec: ModelSpec, weighted = false): string {
  // R² for lm comes from summary(); for nls we compute it from residual/total SS.
  // (A weighted lm's R² is 1 − weighted SS / weighted SST, like an nls's.)
  // A log-Y model fits log(y), so its residuals are on the log scale — its
  // total SS must be too (Round 2 Issue 38): dividing log-scale SS by a
  // raw-Y SST gives an absurd negative R² on small-Y data.
  const r2 = spec.kind === "lm" && !weighted ? "s$r.squared" : "1-ss/sst";
  const ss = weighted ? "sum(w*residuals(m)^2)" : "sum(residuals(m)^2)";
  const sst = spec.logY
    ? weighted
      ? "sum(w*(log(y)-sum(w*log(y))/sum(w))^2)"
      : "sum((log(y)-mean(log(y)))^2)"
    : weighted
      ? "sum(w*(y-sum(w*y)/sum(w))^2)"
      : "sum((y-mean(y))^2)";
  // Seq 323 (nls only — lm objects have no $m$gradient): the Gauss–Newton
  // Hessian HGᵀHG for the unstable-parameter check. nls's gradient is
  // already √w-weighted (it is the gradient of the weighted residuals), so
  // the Hessian is the plain product — multiplying by w again would square
  // the weights (verified against an analytic Jacobian in R, Nov 22: a
  // 1/Y²-weighted 4PL's gradient rows are √w × the analytic Jacobian).
  const hessian =
    spec.kind === "nls" ? `HG<-m$m$gradient();HH<-t(HG)%*%HG;` : "";
  return (
    `s<-summary(m);co<-s$coefficients;cf<-coef(m);` +
    `df<-df.residual(m);ss<-${ss};sst<-${sst};r2<-${r2};syx<-sqrt(ss/df);` +
    `V<-vcov(m);q<-qt(0.975,df);pci<-function(p)cf[[p]]+c(-1,1)*q*sqrt(V[p,p]);` +
    hessian +
    // A function of the coefficients and its CI by the delta method (central differences).
    `dl<-function(f){e<-f(cf);g<-sapply(names(cf),function(p){h<-1e-6*max(1,abs(cf[[p]]));a<-cf;b<-cf;a[[p]]<-a[[p]]+h;b[[p]]<-b[[p]]-h;(f(a)-f(b))/(2*h)});` +
    `s<-sqrt(drop(t(g)%*%V[names(cf),names(cf)]%*%g));c(e,e-q*s,e+q*s)};`
  );
}

/** R statements that assign `x`/`y`, fit `m`, and compute the summary
 *  quantities — everything up to the final `c(...)`. The caller appends its
 *  own result vector, so one eval can cover the fit plus further computation
 *  on it (interpolation, comparison).
 *  `fitOverride` replaces the spec's fit assignment (the substrate-inhibition
 *  retry with its alternate Ki start). `extraAssignments` is R run after the
 *  `x`/`y` assignments and before the fit — a two-series binding fit's group
 *  indicator, or an association-then-dissociation fit's HotNM/Time0 constants. */
export function fitStatementsForSpec(
  xs: number[],
  ys: number[],
  spec: ModelSpec,
  fitOverride?: string,
  extraAssignments = "",
  weighted = false,
): string {
  return (
    `x<-${rVec(xs)};y<-${rVec(ys)};${extraAssignments}${fitOverride ?? spec.fit};` +
    fitSummaryStatements(spec, weighted)
  );
}

export function fitStatements(xs: number[], ys: number[], model: NonlinearModel, fitOverride?: string): string {
  return fitStatementsForSpec(xs, ys, modelSpec(model), fitOverride);
}

/** The named entries the fit contributes to the result vector, in order.
 *  `cl`/`ch` are the 95% CIs (estimate ± t(0.975, df)·SE — on noiseless data
 *  the SEs are 0, so the intervals collapse to the estimates; the reference
 *  tests assert that, plus genuinely nonzero widths on a noisy fixture).
 *  A 5PL's asymmetry S is above 0, so its CI is taken on its log and stays
 *  there (upstream 1.0.7). `prefix` names a second set's entries in a
 *  curve comparison (`a_`/`b_`). */
export function fitEntries(spec: ModelSpec, prefix = ""): string {
  // Positional coefficient extraction (co has one row per term, in fit order).
  const coefAssigns = spec.terms
    .map((term, i) => {
      const est = `co[${i + 1},1]`;
      const se = `co[${i + 1},2]`;
      const [lo, hi] =
        term === "S"
          ? [`${est}*exp(-qt(0.975,df)*${se}/${est})`, `${est}*exp(qt(0.975,df)*${se}/${est})`]
          : [`${est}-qt(0.975,df)*${se}`, `${est}+qt(0.975,df)*${se}`];
      return (
        `${prefix}b${i}=${est},${prefix}se${i}=${se},${prefix}t${i}=co[${i + 1},3],` +
        `${prefix}pv${i}=co[${i + 1},4],${prefix}cl${i}=${lo},${prefix}ch${i}=${hi}`
      );
    })
    .join(",");
  const derived = spec.derived ?? [];
  const derivedAssigns = derived
    .map((d, i) => {
      const parts = [`${prefix}d${i}=${d.expr}`];
      if (d.low !== undefined && d.high !== undefined) parts.push(`${prefix}dl${i}=${d.low}`, `${prefix}dh${i}=${d.high}`);
      return parts.join(",");
    })
    .join(",");
  // Seq 323 (nls only — the Hessian statements run only there): the full
  // Hessian, row-major, so the check can read it back without a second R
  // call. lm fits carry no `hh` entries and parseFit reads `hessian: null`.
  const hessianAssigns =
    spec.kind === "nls"
      ? spec.terms.flatMap((_, i) => spec.terms.map((_, j) => `${prefix}hh${i}_${j}=HH[${i + 1},${j + 1}]`)).join(",")
      : "";
  return `${prefix}r2=r2,${prefix}df=df,${prefix}ss=ss,${prefix}syx=syx,${coefAssigns}${derivedAssigns ? "," + derivedAssigns : ""}${hessianAssigns ? "," + hessianAssigns : ""}`;
}

/** A derived quantity's value, with its 95% CI when the spec defines one
 *  (binding/global-fit specs define none — their rows stay value-only).
 *  `sources` (seq 388) are the fitted parameters the quantity's R
 *  expressions name (raw term names); `unstableSources` are the ones the
 *  unstable-parameter check flagged, as the results show them — the
 *  results note names them, since Prism's docs define no rule for derived
 *  values of unstable parameters. */
export interface DerivedRow extends StatRow {
  low?: number | null;
  high?: number | null;
  sources?: string[];
  unstableSources?: string[];
}

/** The fit's coefficients, derived quantities and goodness-of-fit rows, read
 *  out of an `evalNamedVector` result that carries `fitEntries(spec)`.
 *  `labelTerm` names the coefficients as results show them (the nonlinear
 *  runner passes `termLabel`: "HillSlope" → "Hill slope", "S" →
 *  "Asymmetry (S)"); the shared-fit consumers keep the raw terms. */
export function parseFit(
  v: RVector,
  spec: ModelSpec,
  n: number,
  labelTerm: (term: string) => string = (t) => t,
  prefix = "",
): {
  coefficients: RegressionCoefficient[];
  derived: DerivedRow[];
  stats: StatRow[];
  /** The fit's Gauss–Newton Hessian (seq 323), when the R vector carries
   *  it (nls fits); null for lm fits or when any entry is missing or
   *  non-finite. */
  hessian: number[][] | null;
} {
  const coefficients: RegressionCoefficient[] = spec.terms.map((term, i) => ({
    term: labelTerm(term),
    estimate: v[`${prefix}b${i}`] ?? null,
    stdError: v[`${prefix}se${i}`] ?? null,
    t: v[`${prefix}t${i}`] ?? null,
    p: v[`${prefix}pv${i}`] ?? null,
    low: v[`${prefix}cl${i}`] ?? null,
    high: v[`${prefix}ch${i}`] ?? null,
  }));
  const derived: DerivedRow[] = (spec.derived ?? []).map((d, i) => {
    const sources = derivedSources(d, spec.terms);
    const row: DerivedRow = {
      label: d.label,
      value: v[`${prefix}d${i}`] ?? null,
      ...(sources.length ? { sources } : {}),
    };
    if (d.low !== undefined && d.high !== undefined) {
      row.low = v[`${prefix}dl${i}`] ?? null;
      row.high = v[`${prefix}dh${i}`] ?? null;
    }
    return row;
  });
  const stats: StatRow[] = [
    { label: "R squared", value: v[`${prefix}r2`] },
    { label: "Sy.x", value: v[`${prefix}syx`] },
    { label: "Sum of squares", value: v[`${prefix}ss`] },
    { label: "Degrees of freedom", value: v[`${prefix}df`] },
    { label: "N", value: n },
  ];
  const hessian: number[][] | null =
    spec.kind === "nls"
      ? (() => {
          const rows: number[][] = [];
          for (let i = 0; i < spec.terms.length; i++) {
            const row: number[] = [];
            for (let j = 0; j < spec.terms.length; j++) {
              const e = v[`${prefix}hh${i}_${j}`];
              if (e == null || !Number.isFinite(e)) return null;
              row.push(e);
            }
            rows.push(row);
          }
          return rows;
        })()
      : null;
  return { coefficients, derived, stats, hessian };
}

export interface NonlinearFit {
  coefficients: RegressionCoefficient[];
  derived: DerivedRow[];
  stats: StatRow[];
  /** The exact R code that was evaluated (for debugging). */
  rCode: string;
  /** True when the primary fit failed and the alternate-start retry
   *  (substrate inhibition's Ki) converged instead — the runner notes it. */
  retried?: boolean;
  /** Which retry converged, when `retried` is true — the `method` of the
   *  winning `retryFits` entry ("port", "relaxed tolerance", …). The
   *  runner names it in the result note. */
  retryMethod?: string;
  /** Seq 323: the fit's Hessian condition number (2-norm), when the fit
   *  is nonlinear and the check ran. */
  hessianCondition?: number;
  /** Seq 323: the parameters the data do not determine (raw term names),
   *  when the check ran and found any. */
  unstableParameters?: string[];
  /** Seq 387: the parameters whose dependency exceeds 0.9999 (raw term
   *  names), when the ambiguous-fit handling ran and found any. */
  ambiguousParameters?: string[];
}

/** Warm-start an nls fit string from the current fit (seq 200): replace
 *  the spec's `start=list(...)` with `start=as.list(coef(m))`, so an IRLS
 *  refit starts from the previous round's coefficients instead of the
 *  data-derived starts. lm strings have no start list and pass through
 *  unchanged. The start list after applyFitOptions holds exactly the free
 *  parameters, in formula order — which is exactly what coef(m) names, in
 *  the same order — so bounds (positional lower/upper vectors) stay
 *  aligned. Without this, the Poisson refit re-runs nls from its cold
 *  starts under the 1/fitted weights and stalls ("false convergence"). */
function warmStartFit(call: string): string {
  const yAt = call.indexOf("y~");
  const startAt = yAt < 0 ? -1 : call.indexOf(",start=", yAt);
  if (startAt < 0) return call;
  const rest = call.slice(startAt + 7);
  if (!rest.startsWith("list(") && !rest.startsWith("c(")) return call;
  const closeAt = matchParen(rest, rest.indexOf("("));
  if (closeAt < 0) return call;
  return `${call.slice(0, startAt + 7)}as.list(coef(m))${rest.slice(closeAt + 1)}`;
}

/** R that refits `m` by iteratively reweighted least squares (seq 200):
 *  robust (Tukey biweight) or Poisson (weights 1/fitted). `weightedFit`
 *  is the fit assignment that reads R variable `w` (the current weights);
 *  `initialFit` the fit as first run (base weights, if any). The base
 *  weights (`wb` — the user's weighting scheme when set, else 1) multiply
 *  the IRLS weights each round, so a weighted robust/Poisson fit composes
 *  with the weighting scheme. A refit that errors keeps the previous `m`
 *  (the assignment never completed); non-finite coefficients restore the
 *  initial fit. At most 25 rounds, stopping when the coefficients move
 *  less than 1e-6 relative. The two methods:
 *  - robust: residuals scaled by 1.4826·MAD, Tukey biweight c = 4.685
 *    (Prism's robust regression; 95% efficient at the Gaussian). Points
 *    further than c·scale get weight 0; a zero scale (an exact fit) keeps
 *    the least-squares fit.
 *  - Poisson: weights 1/fitted (fitted clamped at 1e-6, so a zero or
 *    negative fitted value cannot make an infinite weight). For a direct
 *    mean model the weighted-LS score with weights 1/μ is the Poisson
 *    score, so the fixed point is the Poisson MLE (verified against
 *    scipy's MLE in Python). Not for log-Y models: their fitted values
 *    are log-scale, so 1/fitted would weight by 1/log(y_hat) — refused
 *    before R runs (see fitModelSpec), with a stop() backstop here. */
function irlsLoop(
  weightedFit: string,
  initialFit: string,
  method: "robust" | "poisson",
  baseWeights: string,
  /** A log-Y model fits log(y): its fitted values are log-scale, so a
   *  Poisson 1/fitted weight would be 1/log(y_hat) — meaningless (and
   *  negative when y_hat < 1). fitModelSpec refuses Poisson on log-Y
   *  models before R runs; this stop is the backstop so the generated R
   *  can never silently emit those weights (Round 2 Issue 38). */
  logY = false,
): string {
  const update =
    method === "robust"
      ? `r<-residuals(m);s<-1.4826*median(abs(r-median(r)));if(!is.finite(s)||s==0)break;` +
        `u<-r/(4.685*s);wr<-(1-pmin(u^2,1))^2;`
      : logY
        ? `stop("Poisson fits are not supported for log-Y models")`
        : `mu<-fitted(m);mu[mu<1e-6]<-1e-6;wr<-1/mu;`;
  return (
    `${baseWeights};` +
    `for(it in 1:25){cf0<-coef(m);if(any(!is.finite(cf0)))break;${update}w<-wb*wr;` +
    `ok<-tryCatch({${weightedFit};TRUE},error=function(e)FALSE);if(!ok)break;` +
    // A refit that produced non-finite coefficients is discarded — but
    // the initial fit reads `w` when the user weighted, and `w` is now
    // the last IRLS weights, so restore the base weights first.
    `cf1<-coef(m);if(any(!is.finite(cf1))){w<-wb;${initialFit};break};` +
    `if(max(abs(cf1-cf0)/pmax(1,abs(cf0)))<1e-6)break};`
  );
}

/** Fit a model spec (not necessarily one of the curated nonlinear models)
 *  and return its coefficients, derived quantities and goodness-of-fit rows —
 *  one R call per attempt: the primary, then each `retryFits` entry in
 *  order until one converges. The binding runners (plan 16) fit their own
 *  specs through this, so there is exactly one nls call site in the repo.
 *  A robust/Poisson method (seq 200) refits by IRLS inside the same R call
 *  (see irlsLoop); R² and the sum of squares are then computed on the raw
 *  residuals, not the IRLS weights. */
export async function fitModelSpec(
  xs: number[],
  ys: number[],
  spec: ModelSpec,
  extraAssignments = "",
  labelTerm: (term: string) => string = (t) => t,
  options?: FitOptions,
): Promise<NonlinearFit> {
  const method = options?.fitMethod ?? "least-squares";
  // A Poisson fit weights by 1/fitted, but a log-Y model's fitted values
  // are log(y_hat) — 1/log(y_hat) is not a Poisson weight (and goes
  // negative when y_hat < 1). Refuse it plainly instead of fitting
  // nonsense (Round 2 Issue 38); robust IRLS on log-Y models is fine
  // (its weights come from the log-scale residuals).
  if (method === "poisson" && spec.logY)
    throw new Error(
      "Poisson fitting is not supported for log-Y models — the Poisson weights 1/fitted would be 1/log(Y), not 1/Y. Fit the model on the raw Y scale instead.",
    );
  const applied = applyFitOptions(spec, options ?? {});
  const eff = applied.spec;
  const extra = extraAssignments + applied.extraAssignments;
  const weighted = !!(options?.weights);
  // The weights-reading variant of the spec: when the user weighted, the
  // effective spec already reads `w`; otherwise it is the same spec with
  // weights appended (the dummy vector's assignment is discarded — the
  // loop assigns `w` itself).
  const appliedW =
    method === "least-squares"
      ? undefined
      : options?.weights
        ? applied
        : applyFitOptions(spec, { ...options, weights: [0] });
  const attempts: ({ fit?: string; method?: string } | undefined)[] = [undefined, ...(eff.retryFits ?? [])];
  let lastErr: unknown;
  for (let j = 0; j < attempts.length; j++) {
    const attempt = attempts[j];
    let rCode: string;
    if (method === "least-squares") {
      rCode = `${fitStatementsForSpec(xs, ys, eff, attempt?.fit, extra, weighted)}c(${fitEntries(eff)})`;
    } else {
      const wSpec = appliedW!.spec;
      // Warm-start each IRLS refit from the previous round's coefficients
      // (see warmStartFit) — cold starts stall under the IRLS weights.
      const weightedFit = warmStartFit(j === 0 ? wSpec.fit : wSpec.retryFits![j - 1].fit);
      const initialFit = attempt?.fit ?? eff.fit;
      // R² and the sum of squares are computed on the fitted scale: a
      // log-Y model's residuals are log-scale, so its SST is log-scale
      // too (Round 2 Issue 38 — the old code divided log-scale SS by a
      // raw-Y SST here).
      const sstR = eff.logY ? "sum((log(y)-mean(log(y)))^2)" : "sum((y-mean(y))^2)";
      rCode =
        `x<-${rVec(xs)};y<-${rVec(ys)};${extra}${initialFit};` +
        irlsLoop(weightedFit, initialFit, method, options?.weights ? "wb<-w" : "wb<-rep(1,length(x))", eff.logY) +
        fitSummaryStatements(eff, false) +
        `ss<-sum(residuals(m)^2);sst<-${sstR};r2<-1-ss/sst;syx<-sqrt(ss/df);` +
        `c(${fitEntries(eff)})`;
    }
    try {
      const v = await evalNamedVector(rCode);
      const { coefficients, derived, stats, hessian } = parseFit(v, eff, xs.length, labelTerm);
      // Seq 323: the unstable-parameter check, on by default — the
      // coefficients it flags carry `unstable: true` into the results.
      const { unstableParameters, condition } = applyUnstableFlags(
        coefficients,
        hessian,
        eff.terms,
        labelTerm,
        options?.difficultFitHandling ?? "unstable",
        derived,
      );
      // Dependency is computed on every least-squares fit (the Diagnostics
      // option only controls whether it is shown); a robust/Poisson refit
      // passes null, so its coefficients carry no dependency.
      const syx = stats.find((s) => s.label === "Sy.x")?.value ?? null;
      const { ambiguousParameters } = applyAmbiguousFlags(
        coefficients,
        hessian,
        eff.terms,
        method === "least-squares" ? syx : null,
        options?.difficultFitHandling ?? "unstable",
      );
      return {
        coefficients,
        derived,
        stats,
        rCode,
        ...(attempt ? { retried: true, retryMethod: attempt.method } : {}),
        ...(condition != null ? { hessianCondition: condition } : {}),
        ...(unstableParameters.length ? { unstableParameters } : {}),
        ...(ambiguousParameters.length ? { ambiguousParameters } : {}),
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Fit the curve and return its coefficients, derived quantities and
 *  goodness-of-fit rows — one R call per attempt (the primary, then each
 *  retry in order). */
export async function fitNonlinearModel(
  xs: number[],
  ys: number[],
  model: NonlinearModel,
  labelTerm: (term: string) => string = (t) => t,
): Promise<NonlinearFit> {
  return fitModelSpec(xs, ys, modelSpec(model), "", labelTerm);
}

/** The nls non-convergence message, shared by both runners — it names the
 *  model, so a failure on an exponential curve says which one. */
export function fitError(err: unknown, model?: NonlinearModel): AnalysisOutcome {
  const which = model ? ` ("${MODEL_LABEL[model]}")` : "";
  // Plan 29: a segmental fit fails only on degenerate X (the breakpoint
  // is profiled, not iterated) — say what it needs, and point curved
  // data at the polynomials.
  const hint =
    model === "segmental-linear"
      ? " It needs X values on both sides of a breakpoint; for smoothly curved data, try a polynomial instead."
      : "";
  return {
    error: `This curve${which} could not be fitted to these data (${err instanceof Error ? err.message : String(err)}).${hint} Try another model or Y data set.`,
  };
}
