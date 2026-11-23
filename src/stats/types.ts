// Analysis contract — the single source of truth for what a test receives
// (columns + params) and returns (a result or an error).

import type { TableData } from "../store/types";

export type AnalysisType =
  | "descriptive-statistics"
  | "compare-two-groups"
  | "one-sample-t"
  | "anova"
  | "kruskal-wallis"
  | "rm-anova"
  | "friedman"
  | "shapiro-wilk"
  | "kolmogorov-smirnov"
  | "one-sample-ks"
  | "correlation"
  | "linear-regression"
  | "compare-slopes"
  | "deming-regression"
  | "area-under-curve"
  | "remove-baseline"
  | "nonlinear-regression"
  | "simple-logistic-regression"
  | "two-way-anova"
  | "three-way-anova"
  | "multifactor-anova"
  | "multiple-t-tests"
  | "nested-t-test"
  | "nested-anova"
  | "correlation-matrix"
  | "multiple-regression"
  | "multiple-logistic-regression"
  | "poisson-regression"
  | "principal-component-analysis"
  | "k-means"
  | "hierarchical-clustering"
  | "spline-lowess"
  | "smooth-differentiate-integrate"
  | "binding-saturation"
  | "binding-kinetics"
  | "enzyme-inhibition"
  | "dose-response-special"
  | "outliers"
  | "p-value-stack"
  | "chi-square"
  | "chi-square-gof"
  | "binomial-test"
  | "survival"
  | "cox"
  | "mcnemar"
  | "cox-proportional-hazards"
  | "mixed-effects"
  | "bland-altman"
  | "roc-curve"
  | "frequency-distribution"
  | "monte-carlo"
  | "transform-data"
  | "transform-concentrations"
  | "normalize"
  | "transpose"
  | "extract-rearrange"
  | "select-transform"
  | "prune-rows"
  | "fraction-of-total"
  | "row-means-totals"
  | "plot-function";

/** What the New Analysis picker offers: a test, or "Compare more than two groups",
 *  which its wizard resolves to one-way ANOVA, Kruskal-Wallis, repeated-measures ANOVA
 *  or Friedman (as Prism does). */
export type AnalysisPickerValue = AnalysisType | "compare-many-groups" | "interpolate" | "transform";

// The choices of the params, one list each: wizards ask among them, the types come from
// them, and a file's value outside them is left out (the test takes its default).
export const TAILS = ["two-sided", "less", "greater"] as const;
const POSTHOCS = ["none", "tukey", "bonferroni", "sidak", "holm-sidak", "lsd"] as const;
/** The corrections that compare chosen pairs, each pair's own P adjusted for them alone.
 *  Upstream Helix calls the uncorrected one `fisher`; Titer's existing name is `lsd`.
 *  `fdr` is the False Discovery Rate (Benjamini-Hochberg): the P values are the
 *  uncorrected ones, adjusted step-up across the family (see R_ADJUST). */
export const PAIR_CORRECTIONS = ["bonferroni", "sidak", "holm-sidak", "lsd", "fdr"] as const;
/** A one-way ANOVA's comparisons: every pair (Tukey, Bonferroni, Šídák, Holm–Šídák,
 *  Fisher's LSD, False Discovery Rate; with unequal SDs Games-Howell, Dunnett's T3,
 *  False Discovery Rate on Welch t tests), or each group against
 *  a control (Dunnett). */
export const ANOVA_POSTHOCS = [...POSTHOCS, "dunnett", "games-howell", "t3", "fdr"] as const;
export const RANK_POSTHOCS = ["none", "dunn", "dunn-sidak", "dunn-holm-sidak"] as const;
/** The dose-response (sigmoidal) models: what an XY scatter's fitted curve draws, and what can
 *  compare two data sets' curves. */
export const DOSE_MODELS = [
  "sigmoidal-4pl-logx",
  "sigmoidal-4pl-x",
  "agonist-3pl-logx",
  "inhibitor-3pl-logx",
  "asymmetric-5pl-logx",
  "asymmetric-5pl-x",
  // 1.8 classic-curves completion (B6 §Dose-response Stimulation/Inhibition):
  // the X-concentration 3PLs and the normalized (Bottom=0, Top=100) 3PL/4PLs.
  "agonist-3pl-x",
  "inhibitor-3pl-x",
  "agonist-3pl-normalized-logx",
  "agonist-4pl-normalized-logx",
  "agonist-3pl-normalized-x",
  "agonist-4pl-normalized-x",
  "inhibitor-3pl-normalized-logx",
  "inhibitor-4pl-normalized-logx",
  "inhibitor-3pl-normalized-x",
  "inhibitor-4pl-normalized-x",
  // 1.8 classic-curves completion (B6 §Dose-response Special): the
  // absolute-IC50 models are 4PLs (one midpoint), so they are dose models.
  "absolute-ic50-logx",
  "absolute-ic50-x",
  // Binding — Competition (plan 28): the one-site Fit logIC50 is the
  // inhibitor 3PL above; the two-site and homologous competition curves
  // are dose-response curves too, so they live here (wizard dose list,
  // curve comparison).
  "two-site-competition-logx",
  "two-site-competition-x",
  "homologous-competition-logx",
] as const;
/** Curves of growth, decay and enzyme kinetics: not standard curves to interpolate. */
export const KINETIC_MODELS = [
  "exponential-growth",
  "logistic-growth",
  "gompertz-growth",
  "one-phase-decay",
  "michaelis-menten",
] as const;
/** The other effective concentrations a dose-response curve can report, in % (EC80…). */
export const EC_ANYTHING = { min: 1, max: 99 };
export const NONLINEAR_MODELS = [
  ...DOSE_MODELS,
  "line",
  "semilog-line",
  // 1.8 classic-curves completion (B6 §Lines): the remaining line forms —
  // through the origin, horizontal, and the two log-Y lines.
  "line-through-origin",
  "horizontal-line",
  "semilog-y-log",
  "log-log-line",
  "hyperbola",
  "quadratic",
  "cubic",
  // Plan 29: lines & polynomials completion — Prism's order after cubic:
  // the segmental (piecewise) line, then the 4th/5th order polynomials.
  "segmental-linear",
  "quartic",
  "quintic",
  // 1.8 classic-curves completion (B6 §Polynomial): the sixth order
  // polynomial and the centered polynomials (B0 is Y at the X mean, not
  // at X = 0 — same curve as the uncentered same degree).
  "sextic",
  "centered-first",
  "centered-second",
  "centered-third",
  "centered-fourth",
  "centered-fifth",
  "centered-sixth",
  // 1.8 classic-curves completion (B6 §Dose-response Special, §Standard,
  // §Growth, §Linear quadratic, §Classic): two midpoints, so NOT dose
  // models (curve comparison and ECanything need a single midpoint).
  "biphasic-logx",
  "biphasic-x",
  "bell-shaped-logx",
  "bell-shaped-x",
  "pade-11",
  "power-series",
  "exponential-plateau",
  "beta-growth-decay",
  "lq-fraction-surviving",
  "lq-percent-surviving",
  "lq-fraction-dead",
  "lq-percent-dead",
  "lq-count-alive",
  "lq-count-dead",
  ...KINETIC_MODELS,
  // 1.8 classic-curves completion (B6 §Growth #2): the log-population
  // growth curve — the log-Y twin of exponential-growth.
  "exponential-growth-log",
  // Exponential family (plan 08, 1/2: decay first; one-phase-decay is already in KINETIC_MODELS).
  "two-phase-decay",
  "three-phase-decay",
  "plateau-decay",
  // Plan 08, 2/2: association (growth is already in KINETIC_MODELS).
  "one-phase-association",
  "two-phase-association",
  "plateau-association",
  // Plan 09: enzyme kinetics (substrate–velocity; michaelis-menten is
  // already in KINETIC_MODELS).
  "allosteric-sigmoidal",
  "substrate-inhibition",
  // Other classic curves (v2): Prism's Gaussian, Boltzmann sigmoid,
  // Lorentzian and sine-wave models — nls() fits in nonlinear-fit.ts,
  // same shape as the plan 08 exponential family.
  "gaussian",
  "boltzmann-sigmoid",
  "lorentzian",
  "sine-wave",
  // 1.8 classic-curves completion (B6 diff vs Prism 11.2.0's 152-model list):
  // the rest of Prism's Gaussian family (sum of two Gaussians, Log Gaussian,
  // the three cumulative Gaussians, sum of two Lorentzians) and its Sine
  // waves family (standard sine, damped sine, sinc). Equations from Prism's
  // Curve Fitting Guide (see modelSpec); B6 line refs in the lane report.
  "sum-of-two-gaussians",
  "lognormal",
  "cumulative-gaussian-percent",
  "cumulative-gaussian-fraction",
  "cumulative-gaussian-counts",
  "sum-of-two-lorentzians",
  "standard-sine-wave",
  "damped-sine-wave",
  "sinc",
  // Plan 28: binding competition (two-site + homologous) — already in
  // DOSE_MODELS above, so they are covered by the spread; do NOT list them
  // again here (a duplicate entry double-runs every NONLINEAR_MODELS sweep
  // and doubles the model enum in project-file.ts).
  // v2 item 23: the user types their own equation (see user-defined.ts) —
  // not a dose model, so the wizard offers it under "Another curve".
  "user-defined",
] as const;
/** What comparing two curves asks: is the EC50 different, or does one curve fit both. */
export const CURVE_COMPARISONS = ["ec50", "all"] as const;
export const CORRELATION_METHODS = ["pearson", "spearman"] as const;
/** The Transform functions (Prism's documented standard set — Prism 8 User
 *  Guide, "Transform data"): log10, ln, log2, sqrt, reciprocal, exp, square —
 *  plus Prism's arithmetic transforms (seq 205), which apply a constant K to
 *  every value: Y+K, Y−K, Y×K, Y/K, K−Y, K/Y. The arithmetic functions read
 *  the constant from TransformDataParams.constant. */
export const TRANSFORM_FUNCTIONS = [
  "log10",
  "ln",
  "log2",
  "sqrt",
  "reciprocal",
  "exp",
  "square",
  "y-plus-k",
  "y-minus-k",
  "y-times-k",
  "y-divided-by-k",
  "k-minus-y",
  "k-divided-by-y",
] as const;
export type TransformFunction = (typeof TRANSFORM_FUNCTIONS)[number];
/** The arithmetic Transform functions — the ones that need a constant K
 *  (TransformDataParams.constant). */
export const TRANSFORM_ARITHMETIC_FUNCTIONS = [
  "y-plus-k",
  "y-minus-k",
  "y-times-k",
  "y-divided-by-k",
  "k-minus-y",
  "k-divided-by-y",
] as const;
export type TransformArithmeticFunction = (typeof TRANSFORM_ARITHMETIC_FUNCTIONS)[number];
/** Binding — Saturation models (plan 16): one-site total, two-site
 *  specific, and the two-series total+nonspecific fits (NS/Background shared). */
export const BINDING_SATURATION_MODELS = [
  "one-site-total",
  "two-site-specific",
  "one-site-total-and-ns",
  "two-site-total-and-ns",
] as const;
/** Binding — Kinetics models (plan 16): one/two-phase association and
 *  dissociation, plus association-then-dissociation (one experiment). */
export const BINDING_KINETICS_MODELS = [
  "association-one-phase",
  "dissociation-one-phase",
  "association-two-phase",
  "dissociation-two-phase",
  "association-then-dissociation",
] as const;
/** Enzyme kinetics — Inhibition models (plan 17): global fits over
 *  substrate–velocity curves at several inhibitor concentrations
 *  (competitive, noncompetitive, uncompetitive, mixed — Vmax, Km, Ki and
 *  Alpha shared across series), plus the single-curve tight-binding
 *  Morrison Ki fit. */
export const ENZYME_INHIBITION_MODELS = [
  "competitive",
  "noncompetitive",
  "uncompetitive",
  "mixed",
  "morrison",
] as const;
/** Dose-response — Special models (plan 18): global fits over several
 *  dose-response curves — EC50 shift (each curve its own LogEC50; Bottom,
 *  Top, HillSlope shared), Gaddum/Schild (all parameters shared; the
 *  SchildSlope = 1 variant reports pA2 = pKb), and the operational model
 *  for partial agonists (full agonist as a 4PL; partial agonists via
 *  Black & Leff, sharing Basal, Effectmax and n). */
export const DOSE_RESPONSE_SPECIAL_MODELS = ["ec50-shift", "schild", "schild-slope-1", "operational-partial"] as const;
export const CORRELATION_MODES = ["x-vs-every-y", "two-datasets", "matrix"] as const;
export const TWO_WAY_DESIGNS = ["ordinary", "repeated-measures", "nonparametric"] as const;
/** The FDR-approach methods Prism offers after an ANOVA: Benjamini-Hochberg,
 *  the two-stage Benjamini-Krieger-Yekutieli, and Benjamini-Yekutieli. */
export const FDR_METHODS = ["bh", "bky", "by"] as const;
/** The false-discovery rate Q (%), the FDR approach's threshold: a comparison
 *  is a discovery when its FDR-adjusted P falls below Q. Same range as ROUT's
 *  Q (0.01–50%): below it almost nothing is ever a discovery, above it nearly
 *  every comparison with P < 1 is. */
export const FDR_Q = { min: 0.01, max: 50 };
/** The FDR Q (%) must lie in 0.01–50 — shared by the wizard question and the
 *  runners so both reject the same values with the same message. */
export function fdrQError(q: number): string | undefined {
  return q >= 0.01 && q <= 50 ? undefined : "Q must be between 0.01 and 50.";
}
/** What a two-way ANOVA's comparisons compare (seq 192): groups within each
 *  row and rows within each group (the simple effects, as before), every cell
 *  mean against every other cell mean, or the marginal means — the group means
 *  averaged over rows (main effect of the groups) and the row means averaged
 *  over groups (main effect of the rows). */
export const POSTHOC_TARGETS = ["groups", "rows", "cells", "group-means", "row-means"] as const;
/** A two-way ANOVA's comparisons: those of a repeated-measures one, and on the ordinary one
 *  each against a control (Dunnett) or every pair without equal SDs (Games-Howell); or the
 *  FDR approach instead of a family-wise correction (raw P values, Benjamini-Hochberg /
 *  Benjamini-Krieger-Yekutieli / Benjamini-Yekutieli adjusted, discoveries at Q%). */
const TWO_WAY_POSTHOCS = [...POSTHOCS, "dunnett", "games-howell", "fdr"] as const;
/** The terms a three-way ANOVA's post-hoc can follow up (one term only). */
export const THREE_WAY_TERMS = ["A", "B", "C", "A:B", "A:C", "B:C", "A:B:C"] as const;
/** A three-way ANOVA's comparisons: the full FWER suite (Tukey, Bonferroni,
 *  Šídák, Holm–Šídák, Fisher's LSD), each against a control (Dunnett), every
 *  pair without equal SDs (Games-Howell), or the FDR approach. */
export const THREE_WAY_POSTHOCS = [...POSTHOCS, "dunnett", "games-howell", "fdr"] as const;
/** How a three-way ANOVA's post-hoc treats an interaction term: `term`
 *  compares all its level combinations as one family; `simple` compares the
 *  first factor's levels within each level of the term's last factor (simple
 *  effects — each level its own family). On a main effect the two are the same. */
export const THREE_WAY_POSTHOC_SCOPES = ["term", "simple"] as const;
/** The most factors a multifactor ANOVA takes (Prism allows any number; the
 *  cell count — and the term list — grows exponentially, so five is the
 *  practical cap: five 2-level factors already need 32 cells). */
export const MULTIFACTOR_MAX_FACTORS = 5;
export const CORRECTIONS = ["holm", "fdr", "none"] as const;
/** The multiplicity corrections Prism's multiple-t-tests analysis offers
 *  (Prism 11 Stats Guide, "Options for multiple t tests"). `holm` /
 *  `fdr` are Titer's legacy values — plain Holm and Benjamini-Hochberg —
 *  kept so saved files still load; the wizard offers the full Prism set
 *  with Holm–Šídák first (Prism's recommended method). FDR methods take
 *  the desired false discovery rate `q` (percent, default 5). */
export const MULTIPLE_T_TEST_CORRECTIONS = [
  "holm-sidak",
  "holm",
  "sidak",
  "bonferroni",
  "fdr",
  "fdr-bky",
  "fdr-by",
  "none",
] as const;
export const CURVE_TESTS = ["logrank", "trend", "gehan"] as const;
/** A contingency table's test: Fisher's exact test or the chi-square (Yates' or not) on a
 *  2 × 2, the chi-square or its test for trend (rows in order) on 2 columns. */
export const CONTINGENCY_TESTS = ["fisher", "yates", "chi-square", "trend"] as const;
export const BIN_MODES = ["auto", "width", "count"] as const;
/** ROUT's Q, in percent. */
export const ROUT_Q = { min: 0.01, max: 50 };

/** ROUT's Q (%) must lie in 0.01–50: at 0 (or below) no point's FDR-adjusted P
 *  can ever fall below Q, so nothing is ever flagged; above 50 nearly every
 *  point with P < 1 is flagged. Shared by the wizard question and the runner
 *  so both reject the same values with the same message. */
export function routQError(q: number): string | undefined {
  return q >= 0.01 && q <= 50 ? undefined : "Q must be between 0.01 and 50.";
}

/** The methods "Analyze a stack of P values" offers (Prism Statistics Guide,
 *  "How to: Analyzing a stack of P values"): the family-wise (statistical
 *  significance) methods — Bonferroni-Dunn, Bonferroni-Šídák, Holm,
 *  Holm–Šídák — and the false-discovery-rate methods — Benjamini–Hochberg,
 *  Benjamini, Krieger and Yekutieli (adaptive two-stage), Benjamini–
 *  Yekutieli. */
export const P_VALUE_STACK_FWER_METHODS = ["bonferroni", "sidak", "holm", "holm-sidak"] as const;
export const P_VALUE_STACK_FDR_METHODS = ["bh", "bky", "by"] as const;
export const P_VALUE_STACK_METHODS = [...P_VALUE_STACK_FWER_METHODS, ...P_VALUE_STACK_FDR_METHODS] as const;
export type PValueStackMethod = (typeof P_VALUE_STACK_METHODS)[number];
/** Whether the method controls the false discovery rate (else it controls
 *  the family-wise error rate). */
export const isFdrPValueMethod = (method: string): boolean =>
  (P_VALUE_STACK_FDR_METHODS as readonly string[]).includes(method);

/** The family-wise alpha of a stack of P values must lie in 0.001–0.5, the
 *  range the project file clamps it to: below that nothing is ever
 *  significant, above it the family-wise claim is meaningless. Shared by the
 *  wizard question and the runner so both reject the same values with the
 *  same message. */
export function pValueAlphaError(alpha: number): string | undefined {
  return alpha >= 0.001 && alpha <= 0.5 ? undefined : "Alpha must be between 0.001 and 0.5.";
}

/** Params for "p-value-stack": Prism's "Analyze a stack of P values" — P
 *  values computed elsewhere, entered in a column, adjusted for multiplicity.
 *  `method` picks the correction (default Holm–Šídák, Prism's recommendation);
 *  `q` is the FDR Q (%) for the FDR methods (default 5); `alpha` is the
 *  family-wise significance level for the FWER methods (default 0.05). */
export interface PValueStackParams {
  method?: PValueStackMethod;
  /** Desired false discovery rate, in percent (FDR methods only). */
  q?: number;
  /** Family-wise significance level (FWER methods only). */
  alpha?: number;
}

/** Params for "compare-two-groups": resolves to Student/Welch t-test, paired
 *  t-test, ratio or lognormal t-test, Mann-Whitney, or Wilcoxon signed-rank, Prism-wizard style. */
export interface CompareTwoGroupsParams {
  paired: boolean;
  gaussian: boolean;
  /** Only meaningful when gaussian && !paired (Student vs Welch). */
  equalVariance: boolean;
  /** Only meaningful when paired && gaussian: compare ratios (log-transformed)
   *  instead of differences — for data where proportional change is what matters. */
  ratio: boolean;
  /** Include the effect sizes — Cohen's d, Hedges' g and (unpaired) Glass's Δ — with
   *  their 95% CIs; false reports the test without them. */
  effectSizes?: boolean;
  /** Only meaningful when gaussian && !paired: compare the geometric means, a t test on the
   *  logarithms (lognormal t test, Student's or Welch's). Its own param, not `ratio`: a file
   *  of an older Helix may hold a `ratio` left from a paired answer. */
  lognormal?: boolean;
  /** "less"/"greater" follow R's t.test semantics: alternative on (col0 vs col1). */
  tails: (typeof TAILS)[number];
  /** Multiple Variables tables, unpaired: the response variable, split into its two groups
   *  by `groupBy`'s levels. A paired test on such a table names its two variables in `sets`
   *  instead (the existing paired machinery, row by row). */
  response?: string;
  /** Multiple Variables tables, unpaired: the grouping variable whose two levels are the groups. */
  groupBy?: string;
}

/** Params for "one-sample-t": tests each column against a hypothetical value —
 *  resolves to a one-sample t test (gaussian) or a Wilcoxon signed-rank test. */
export interface OneSampleTParams {
  hypotheticalValue: number;
  tails: (typeof TAILS)[number];
  gaussian: boolean;
  /** The geometric mean tested: a t test of the logarithms against the value's. */
  lognormal?: boolean;
  /** Include Cohen's d and Hedges' g with their 95% CIs; false reports the test without them. */
  effectSizes?: boolean;
}

/** The theoretical distributions a one-sample Kolmogorov–Smirnov test can
 *  compare a sample against (seq 170): base R's CDFs, no package needed. */
export const KS_DISTRIBUTIONS = ["normal", "lognormal", "exponential", "uniform"] as const;
export type OneSampleKsDistribution = (typeof KS_DISTRIBUTIONS)[number];

/** Params for "one-sample-ks": compare each column against a theoretical
 *  distribution. `paramsFrom` says where the distribution's parameters come
 *  from: "specified" uses the entered values (the classical test — the
 *  reference must be fully specified before seeing the data); "estimated"
 *  fits them to the sample (then the P value is approximate and
 *  anti-conservative, as with Prism's KS normality test). Only the chosen
 *  distribution's parameters are read: `mean`/`sd` (normal),
 *  `meanlog`/`sdlog` (lognormal), `rate` (exponential), `min`/`max`
 *  (uniform). */
export interface OneSampleKsParams {
  distribution: OneSampleKsDistribution;
  /** "specified": the entered parameters; "estimated": fitted to the sample. */
  paramsFrom: "specified" | "estimated";
  tails: (typeof TAILS)[number];
  /** Normal mean (specified mode; default 0). */
  mean?: number;
  /** Normal SD (specified mode; default 1). */
  sd?: number;
  /** Lognormal mean of the logarithms (specified mode; default 0). */
  meanlog?: number;
  /** Lognormal SD of the logarithms (specified mode; default 1). */
  sdlog?: number;
  /** Exponential rate, mean = 1/rate (specified mode; default 1). */
  rate?: number;
  /** Uniform lower limit (specified mode; default 0). */
  min?: number;
  /** Uniform upper limit (specified mode; default 1). */
  max?: number;
}

/** Params for "anova": optional post-hoc pairwise comparisons between groups. */
export interface AnovaParams {
  posthoc: (typeof ANOVA_POSTHOCS)[number];
  /** false: Welch's ANOVA (the groups' SDs differ); absent or true, the ordinary one. */
  equalSd?: boolean;
  /** Dunnett's control group, by name. */
  control?: string;
  /** The pairs compared (`pairKey`), when not every pair: Bonferroni, Šídák, Holm-Šídák, Fisher's, False Discovery Rate. */
  compared?: string[];
  /** The groups' geometric means compared: the ANOVA and its comparisons run on the logarithms. */
  lognormal?: boolean;
  /** Include the effect-size table — eta squared, partial eta squared, Cohen's f, with the
   *  partial eta squared's 95% CI; false omits it. */
  effectSizes?: boolean;
  /** Test for linear trend between the column means and their left-to-right order
   *  (columns in a natural order, equally spaced): the slope of the means against
   *  column number, and the P values for linear and (four or more groups) nonlinear trend. */
  trend?: boolean;
}

/** Params for "rm-anova": Tukey, Bonferroni, Šídák, Holm–Šídák or Fisher's LSD
 *  comparisons of every pair, or none. */
export interface RmAnovaParams {
  posthoc: (typeof POSTHOCS)[number];
  /** false: not assumed, the Geisser-Greenhouse correction applies; absent or true, assumed. */
  sphericity?: boolean;
  /** The pairs compared (`pairKey`), when not every pair. */
  compared?: string[];
  /** A mixed-effects model (REML, Kenward-Roger), every value kept: subjects may miss some. */
  mixed?: boolean;
  /** Include the effect-size table — eta squared, partial eta squared, Cohen's f, with the
   *  partial eta squared's 95% CI; false omits it. */
  effectSizes?: boolean;
}

/** Params for "kruskal-wallis": optional Dunn's post-hoc pairwise comparisons between groups
 *  (Bonferroni-, Šídák- or Holm–Šídák-corrected). */
export interface KruskalWallisParams {
  posthoc: (typeof RANK_POSTHOCS)[number];
}

/** Params for "friedman": optional Dunn's post-hoc pairwise comparisons between groups
 *  (block-rank flavor — same shape as Kruskal-Wallis, Bonferroni-, Šídák- or
 *  Holm–Šídák-corrected). */
export interface FriedmanParams {
  posthoc: (typeof RANK_POSTHOCS)[number];
}

/** Params for "linear-regression": which Y series to regress on X, and whether to
 *  force the line through the origin (intercept = 0). `compareSlopes` is Prism's
 *  "Test whether the slopes and intercepts are significantly different" checkbox
 *  (#46, MCP audit seq 292): with two or more Y data sets it runs the
 *  slope/intercept comparison ("compare-slopes") instead of fitting each line
 *  on its own. It needs an XY table (not Multiple Variables `x`/`y`), it is
 *  not available forced through the origin (Prism disables the option then),
 *  and the comparison is unweighted, so it refuses a weighting scheme. */
export interface LinearRegressionParams {
  /** The X variable of a Multiple Variables table; omitted, X is the first data column (XY). */
  x?: string;
  /** Omitted defaults to the first Y data column. */
  y?: string;
  /** An XY table's Y data sets, each regressed on its own (`y` then unused). */
  ys?: string[];
  forceOrigin: boolean;
  /** Compare the slopes and intercepts of the Y data sets' lines (≥ 2 sets)
   *  instead of fitting each on its own. */
  compareSlopes?: boolean;
  /** Weighting (plan 26, same schemes as nonlinear regression except 1/SD²,
   *  which needs the replicate columns this runner never sees). */
  weights?: Exclude<NonlinearWeightScheme, "1/sd2">;
}

/** Params for "compare-slopes" (XY table, #46): which Y data sets' lines to
 *  compare — Prism's "Test whether the slopes and intercepts are significantly
 *  different" (linear regression, ANCOVA-equivalent extra sum-of-squares F
 *  tests; Zar, Biostatistical Analysis, ch. 18). Omitted, every Y data set.
 *  Unweighted OLS only: Prism's comparison shares one residual variance, so
 *  no weighting is offered, and forcing through the origin is not offered
 *  either — Prism disables the option then (FAQ 677). */
export interface CompareSlopesParams {
  /** An XY table's Y data sets to compare; omitted, all of them. */
  ys?: string[];
}

/** Params for "deming-regression" (XY table): which Y series to compare with X,
 *  and the error-variance ratio λ = σ²ε/σ²δ (variance of the Y errors over
 *  variance of the X errors — the deming::deming / MethComp::Deming convention,
 *  λ = (ystd/xstd)²). λ = 1 assumes equal error in both; λ must be > 0. */
export interface DemingRegressionParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  lambda: number;
}

/** Params for "simple-logistic-regression": the Y data set (0s and 1s) regressed on X. */
export interface SimpleLogisticRegressionParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
}

/** Params for "area-under-curve": trapezoidal-rule AUC of every Y series against X,
 *  measured from a horizontal baseline (Prism's "Baseline Y =", default 0). */
export interface AreaUnderCurveParams {
  /** Baseline Y value the area is measured from (peaks are heights above it). */
  baseline: number;
  /** Ignore peaks whose height is less than this percent of the distance from
   *  the series' minimum to maximum Y (Prism's "Ignore peaks that are less
   *  than __% of the distance from minimum to maximum Y"). 0 (or omitted)
   *  keeps every peak. A "peak" is a maximal run of points above the
   *  baseline; a peak under the threshold contributes no area. */
  ignorePeaksBelow?: number;
  /** Only peaks above the baseline count: area below the baseline is
   *  ignored instead of counting as negative. Omitted/false keeps the usual
   *  rule (area below the baseline is negative). */
  peaksAboveBaselineOnly?: boolean;
}

/** The baseline definitions "remove-baseline" offers (Prism's Remove
 *  Baseline): the first value, the mean of the first N values, the mean of
 *  control column(s), or a constant. The baseline is subtracted from every
 *  value in the chosen columns, and the value used is recorded per column
 *  so the operation is auditable. */
export const REMOVE_BASELINE_METHODS = ["first-value", "mean-first-n", "mean-of-controls", "constant"] as const;
export type RemoveBaselineMethod = (typeof REMOVE_BASELINE_METHODS)[number];

/** The column-math operations "remove-baseline" offers (Prism's Remove
 *  baseline and column math): combine two columns row by row. Divide by
 *  zero leaves that row blank rather than inventing a value. */
export const COLUMN_MATH_OPERATIONS = ["subtract", "divide", "multiply", "add"] as const;
export type ColumnMathOperation = (typeof COLUMN_MATH_OPERATIONS)[number];

/** Params for "remove-baseline": which columns to subtract from (`ys`),
 *  how the baseline is defined, and — for XY tables — the X column whose
 *  values label the result rows. */
export interface RemoveBaselineParams {
  /** Omitted: every numeric column except `x` — the wizard always sets it. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  /** Omitted in column-math mode (the operation names the columns instead),
   *  and defaulted to "first-value" by the runner when missing. */
  baselineMethod?: RemoveBaselineMethod;
  /** Mean of the first N values (method "mean-first-n"). */
  firstN?: number;
  /** Control columns whose values are averaged (method "mean-of-controls"). */
  controls?: string[];
  /** The baseline value (method "constant"). */
  constant?: number;
  /** Info-constant hook for the baseline (the constant's name): resolved live
   *  in useAnalysis, so editing the constant re-runs the transform. */
  constantHook?: string;
  /** Column math (Prism's "Remove baseline and column math"): when set,
   *  the analysis combines two columns row by row instead of removing a
   *  baseline — `columnMathOperation` says how, `columnMathA`/`columnMathB`
   *  name the two columns. `baselineMethod` is ignored in this mode. */
  columnMathOperation?: ColumnMathOperation;
  columnMathA?: string;
  columnMathB?: string;
}

export const PRUNE_ROWS_CONDITIONS = ["empty", "below", "above", "outside"] as const;
export type PruneRowsCondition = (typeof PRUNE_ROWS_CONDITIONS)[number];

/** Params for "prune-rows": which columns to prune on (`ys`), the
 *  condition, and — for XY tables — the X column whose values label the
 *  result rows. */
export interface PruneRowsParams {
  /** Omitted: every numeric column except `x` — the wizard always sets it. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  condition: PruneRowsCondition;
  /** The threshold (conditions "below" / "above"). */
  threshold?: number;
  /** The range's ends (condition "outside"). */
  low?: number;
  high?: number;
}

/** The totals "fraction-of-total" divides by (Prism's Fraction of Total):
 *  each value's own column total, its row total (across the chosen data
 *  sets), or the grand total of all the chosen values. */
export const FRACTION_OF_TOTAL_TOTALS = ["column", "row", "grand"] as const;
export type FractionOfTotalTotal = (typeof FRACTION_OF_TOTAL_TOTALS)[number];

/** Whether "fraction-of-total" reports fractions (0 to 1) or percentages
 *  (0 to 100) — Prism's "Fractions"/"Percentages" choice. */
export const FRACTION_OF_TOTAL_FORMATS = ["fraction", "percent"] as const;
export type FractionOfTotalFormat = (typeof FRACTION_OF_TOTAL_FORMATS)[number];

/** The 95% confidence interval of each proportion "fraction-of-total" may
 *  carry (Prism's "Confidence interval of a proportion", via Fraction of
 *  Total): none, or Wilson/Brown — Prism's recommendation — or
 *  Clopper–Pearson, the exact interval. Always 95%; there is no level
 *  choice, matching Prism. */
export const FRACTION_OF_TOTAL_CIS = ["none", "wilson", "clopper-pearson"] as const;
export type FractionOfTotalCI = (typeof FRACTION_OF_TOTAL_CIS)[number];

/** Params for "fraction-of-total": which columns to divide (`ys`), how the
 *  total is defined, whether the result is a fraction or a percent, which
 *  95% CI of each proportion to carry (`ci`, omitted: none), and — for XY
 *  tables — the X column whose values label the result rows. */
export interface FractionOfTotalParams {
  /** Omitted: every numeric column except `x` — the wizard always sets it. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  totalBy: FractionOfTotalTotal;
  format: FractionOfTotalFormat;
  /** Omitted: no confidence interval. The CI treats the original value as
   *  successes out of the total as trials, so it is blank for a value that
   *  is not a proportion of its total (below 0, or above the total). */
  ci?: FractionOfTotalCI;
}

/** The curves a nonlinear regression fits. `-logx`/`-x` say whether X is log(concentration)
 *  or the concentration. Line, semilog and polynomials are linear in their parameters (lm);
 *  the others nonlinear (nls). */
export type NonlinearModel = (typeof NONLINEAR_MODELS)[number];

/** Params for "nonlinear-regression" (XY table): which Y data set to fit, and which curve. */
export type NonlinearWeightScheme = "none" | "1/y" | "1/y2" | "1/x" | "1/x2" | "1/sd2";
/** The fitting method a nonlinear regression uses (seq 200, Prism's Method
 *  tab): least squares (every point counts equally), robust (Tukey biweight
 *  — an outlier-resistant refit), or Poisson (counts — maximum Poisson
 *  likelihood, by iteratively reweighted least squares with weights 1/μ). */
export const NONLINEAR_FIT_METHODS = ["least-squares", "robust", "poisson"] as const;
export type NonlinearFitMethod = (typeof NONLINEAR_FIT_METHODS)[number];
/** How a difficult fit is handled (seq 323, Prism's Confidence tab):
 *  "unstable" (default since Prism 9.0) identifies parameters the data do
 *  not determine — the fit's Hessian condition number exceeds 10/√ε
 *  (about 6.7×10⁸) — and reports their best-fit value as "Unstable" with
 *  a "Very wide" CI; "none" reports best-fit values no matter what.
 *  Diagnostic only — it never alters fitted values. */
export const NONLINEAR_DIFFICULT_FIT_HANDLINGS = ["unstable", "none"] as const;
export type NonlinearDifficultFitHandling = (typeof NONLINEAR_DIFFICULT_FIT_HANDLINGS)[number];
export interface NonlinearRegressionParams {
  /** Multiple Variables tables: the X variable (the Y variable is `y`). */
  x?: string;
  /** Omitted defaults to the first Y data column. */
  y?: string;
  /** The Y data sets fitted, each on its own (`y` then unused; no comparison). */
  ys?: string[];
  model: NonlinearModel;
  /** A dose-response curve compared with this other Y data set's (an extra sum-of-squares F test). */
  compareWith?: string;
  compare?: (typeof CURVE_COMPARISONS)[number];
  /** Interpolate the unknowns: the rows holding a Y but no X get the X the curve gives them. */
  interpolate?: boolean;
  /** Weighting (plan 26): "none" (default) or a scheme — 1/Y, 1/Y², 1/X, 1/X²,
   *  or 1/SD² (replicate SDs across the table's Y columns, per row). */
  weights?: NonlinearWeightScheme;
  /** Fit only the points inside an X range (Prism 11 Range tab, "Don't fit
   *  points when X is less than / greater than …", seq 166): points with
   *  X < `fitXMin` or X > `fitXMax` are ignored entirely — not fitted, not
   *  counted, not ROUT-checked. Either bound alone is enough; both blank
   *  (or both absent) fits every point. In Titer X is always explicit
   *  values, so — unlike Prism before 6.04 — the restriction applies
   *  however the X column was entered. */
  fitXMin?: number;
  /** The range's upper end: points with X > `fitXMax` are not fitted. */
  fitXMax?: number;
  /** Parameter name -> fixed value (the parameter is held constant, not fitted). nls models only. */
  fixed?: Record<string, number>;
  /** Parameter name -> [lower, upper] bounds (nls models only, via algorithm="port").
   *  A parameter cannot be both fixed and bounded. */
  bounds?: Record<string, [number, number]>;
  /** Info-constant hooks for the above (the constant's name, not its value):
   *  `fixedConstants` resolves to `fixed`, `boundsConstants` — each side a
   *  plain number or a constant name — to `bounds`. Live: resolved in
   *  useAnalysis before the run, so editing the constant re-runs the fit. */
  fixedConstants?: Record<string, string>;
  boundsConstants?: Record<string, [string, string]>;
  /** A second MODEL fitted to the same data and compared (extra-sum-of-squares
   *  F test when the pair is nested, AICc always). NOTE: the plan's `compareWith`
   *  name is already taken (the other Y data set's column), so the model
   *  comparison uses this field instead. */
  compareModel?: NonlinearModel;
  /** Center the polynomial (seq 201): fit powers of (X − mean X) instead of
   *  powers of X. The fitted values and R² are unchanged — only the
   *  coefficients move (B0 becomes the fitted Y at the mean X, and the
   *  higher terms are far less collinear, so their standard errors shrink).
   *  Polynomials only; any other model refuses it. */
  centered?: boolean;
  /** How the curve is fitted (seq 200): least squares (default), robust
   *  (Tukey biweight), or Poisson (counts). */
  fitMethod?: NonlinearFitMethod;
  /** How a difficult fit is handled (seq 323): identify unstable
   *  parameters (default) or report best-fit values no matter what. */
  difficultFitHandling?: NonlinearDifficultFitHandling;
  /** Extra Y series for a shared-parameter (global) fit. nls models only. */
  globalY?: string[];
  /** Which parameters are shared across the global fit's series (omitted:
   *  the model default — the dose midpoint + HillSlope when the model has
   *  them, else none shared). An explicit [] shares nothing. */
  sharedParams?: string[];
  /** Radioligand concentration [L], in the same units as X's concentrations
   *  (plan 28 — reuses plan 16's `ligandConcentration` vocabulary). Required
   *  for the homologous competition model ([L] is a constant of its
   *  equation) and when `fitKi` is set; ignored otherwise. */
  ligandConcentration?: number;
  /** Radioligand dissociation constant Kd, in the same units as [L].
   *  Required when `fitKi` is set (Cheng–Prusoff divisor 1 + [L]/Kd);
   *  ignored otherwise. The homologous model fits Kd — it is not entered. */
  ligandKd?: number;
  /** Info-constant hooks for [L] and Kd (the constant's name): resolved live
   *  in useAnalysis, like `fixedConstants` above. */
  ligandConcentrationConstant?: string;
  ligandKdConstant?: string;
  /** When true on a one-site (inhibitor 3PL) or two-site competition fit,
   *  the result also reports Ki (Cheng–Prusoff: Ki = IC50 / (1 + [L]/Kd))
   *  alongside IC50. False/absent: today's behaviour (IC50 only). */
  fitKi?: boolean;
  /** Find each data set's outliers by ROUT (at `q`, in %) and leave them out of its fit. */
  rout?: boolean;
  q?: number;
  /** A dose-response curve also reports its ECF (`ecx` = F, in %: EC80…), with its CI. */
  ecx?: number;
  /** User-defined equation (v2 item 23, model "user-defined" only): the equation as the
   *  user typed it (`Y = A*exp(-k*X) + C`, or just the right-hand side), and each named
   *  parameter's starting value. The fitter fits the parameters from those starts. */
  customEquation?: string;
  customParameters?: Record<string, number>;
}

/** Params for "correlation-matrix": Pearson (parametric) vs. Spearman
 *  (rank-based, non-parametric). */
export interface CorrelationParams {
  method: (typeof CORRELATION_METHODS)[number];
  /** Include each r's 95% CI in the matrix; false reports r and P only. */
  effectSizes?: boolean;
}

/** Params for "correlation" on an XY table, Prism-style: Pearson vs. Spearman, and
 *  which of 3 modes to run — X against every Y series, two explicitly chosen data
 *  series, or a full correlation matrix among the Y series (X excluded). */
export interface XYCorrelationParams {
  method: (typeof CORRELATION_METHODS)[number];
  mode: (typeof CORRELATION_MODES)[number];
  /** Required for "two-datasets": the two column names to correlate. */
  datasets?: [string, string];
  /** Include each r's 95% CI; false reports r and P only. */
  effectSizes?: boolean;
}

/** Params for "multiple-regression": which variable is the dependent (Y), and which
 *  other data-bearing variables to include as predictors. `predictors` omitted (or
 *  empty) falls back to every other data-bearing variable. */
export interface MultipleRegressionParams {
  dependent: string;
  /** A text column is a categorical predictor, dummy-coded with its first level as the reference
   *  (coefficients named Variable[Level]); a text column with a single level is left out
   *  (explicitly choosing one errors). */
  predictors?: string[];
}

/** Params for "multiple-logistic-regression": which variable is the binary (0/1)
 *  outcome, and which other data-bearing variables to include as predictors.
 *  `predictors` omitted (or empty) falls back to every other data-bearing variable.
 *  Same shape as MultipleRegressionParams — a distinct interface so the wizard's
 *  params stay type-checked per analysis. */
export interface MultipleLogisticRegressionParams {
  dependent: string;
  /** A text column is a categorical predictor, dummy-coded with its first level as the reference
   *  (coefficients named Variable[Level]); a text column with a single level is left out
   *  (explicitly choosing one errors). */
  predictors?: string[];
}

/** Params for "poisson-regression": which variable is the count outcome, and
 *  which other data-bearing variables to include as predictors. `predictors`
 *  omitted (or empty) falls back to every other data-bearing variable.
 *  `quasi` refits with family quasipoisson — same coefficients, standard errors
 *  scaled by sqrt(Pearson dispersion) — for overdispersed counts. */
export interface PoissonRegressionParams {
  dependent: string;
  /** A text column is a categorical predictor, dummy-coded with its first level as the reference
   *  (coefficients named Variable[Level]); a text column with a single level is left out
   *  (explicitly choosing one errors). */
  predictors?: string[];
  quasi: boolean;
}

/** Params for "principal-component-analysis" (Multiple Variables table):
 *  `scale` picks the matrix PCA runs on — "correlation" standardises each
 *  variable first (recommended when variables are on different scales),
 *  "covariance" keeps the original units. `components` is how many
 *  components to report (0 or omitted = all). */
export interface PrincipalComponentAnalysisParams {
  scale: "correlation" | "covariance";
  components?: number;
}

/** Params for "k-means" (Multiple Variables table): `clusters` is k, the
 *  number of clusters (default 2); `standardise` z-scores each variable
 *  before clustering (default true — recommended when variables are on
 *  different scales, as Prism does by default). */
export interface KMeansParams {
  clusters: number;
  standardise?: boolean;
}

/** The linkage rules hierarchical clustering can merge clusters by (R
 *  `hclust` methods): "complete" joins by the farthest pair, "average" by
 *  the mean pair distance, "single" by the nearest pair, "ward.D2" by the
 *  smallest increase in within-cluster variance (Ward's method, squared
 *  Euclidean distances only). */
export const HCLUST_LINKAGES = ["complete", "average", "single", "ward.D2"] as const;
export type HclustLinkage = (typeof HCLUST_LINKAGES)[number];
/** The distances hierarchical clustering can measure between rows (R `dist`
 *  methods): straight-line ("euclidean") or city-block ("manhattan"). */
export const HCLUST_DISTANCES = ["euclidean", "manhattan"] as const;
export type HclustDistance = (typeof HCLUST_DISTANCES)[number];

/** Params for "hierarchical-clustering" (Multiple Variables table): `clusters`
 *  is k, the number of clusters to cut the tree into (default 2); `linkage`
 *  is how clusters merge (default "complete"); `distance` is how rows are
 *  measured apart (default "euclidean"); `standardise` z-scores each variable
 *  before clustering (default true — recommended when variables are on
 *  different scales, as Prism does by default). */
export interface HclustParams {
  clusters: number;
  linkage?: HclustLinkage;
  distance?: HclustDistance;
  standardise?: boolean;
}

/** The tables "extract-rearrange" can build from a Multiple Variables
 *  table (Prism's Analyze > Extract and rearrange): XY, Column, Grouped
 *  or Contingency. */
export const EXTRACT_REARRANGE_TARGETS = ["xy", "column", "grouped", "contingency"] as const;
export type ExtractRearrangeTarget = (typeof EXTRACT_REARRANGE_TARGETS)[number];

/** Params for "extract-rearrange": which kind of table to build (`target`),
 *  and the variables that fill it — only the ones `target` needs are read:
 *  XY takes `x` + `response`, with `grouping` (data sets) and `subject`
 *  (replicate sub-columns) optional; Column takes `response`, with
 *  `grouping` (columns) and `subject` (rows) optional; Grouped takes
 *  `response` + `rowFactor` + `columnFactor`, with `subject` (replicates)
 *  optional; Contingency takes `rowVariable` + `outcome` (its columns),
 *  with `count` (increments per source row) optional. `rowTitles` names the
 *  column the new table's row titles come from (XY/Column). `prefixNames`
 *  prefixes level-derived titles with their variable ("Sex = F");
 *  `completeRows` (default true) condenses XY/Column to the distinct
 *  values, false keeps one output row per source row. */
export interface ExtractRearrangeParams {
  target: ExtractRearrangeTarget;
  /** XY only: the X variable (numbers). */
  x?: string;
  /** XY / Column / Grouped: the response variable (numbers). */
  response?: string;
  /** XY / Column: the variable whose levels become the data sets / columns. */
  grouping?: string;
  /** XY / Column / Grouped: the variable whose levels become the replicate
   *  sub-columns (XY/Grouped) or the rows (Column). */
  subject?: string;
  /** XY / Column: the column the new table's row titles come from. */
  rowTitles?: string;
  /** Grouped only: the variable whose levels become the rows. */
  rowFactor?: string;
  /** Grouped only: the variable whose levels become the column groups. */
  columnFactor?: string;
  /** Contingency only: the variable whose levels become the rows. */
  rowVariable?: string;
  /** Contingency only: the variable whose levels become the columns. */
  outcome?: string;
  /** Contingency only: the variable holding each source row's increment. */
  count?: string;
  /** Prefix level-derived titles with their variable name. */
  prefixNames?: boolean;
  /** Condense to complete rows (XY/Column); false keeps source-row alignment. */
  completeRows?: boolean;
}

/** The per-variable transforms "select-transform" offers (Prism 10 User
 *  Guide, "Select and transform multiple variable tables", and Prism 8's
 *  "Transform data" standard functions): the seven Transform-data functions
 *  (`log10`, `ln`, `log2`, `sqrt`, `reciprocal`, `exp`, `square`), the
 *  unit-change arithmetic (`multiply`, `divide`, `add`, `subtract`, `power`,
 *  `round`, `pow10`, `negate`, `abs`) and Prism 10's whole-variable
 *  summaries (`min`, `max`, `mean`, `stdev`, `stderr` — one value per row).
 *  `multiply`, `divide`, `add`, `subtract`, `power` and `round` take the
 *  constant K (`round`: whole digits, 0–10). NOT offered: z-score, rank,
 *  logit/probit (Transform-data-only) and the text transforms
 *  (CONCATENATE, IF) — a text engine is a separate item. */
export const SELECT_TRANSFORM_KINDS = [
  "log10",
  "ln",
  "log2",
  "reciprocal",
  "sqrt",
  "square",
  "exp",
  "pow10",
  "negate",
  "abs",
  "multiply",
  "divide",
  "add",
  "subtract",
  "power",
  "round",
  "min",
  "max",
  "mean",
  "stdev",
  "stderr",
] as const;
export type SelectTransformKind = (typeof SELECT_TRANSFORM_KINDS)[number];

/** Whether a transform kind needs the constant K. */
export const SELECT_TRANSFORM_NEEDS_K: readonly SelectTransformKind[] = [
  "multiply",
  "divide",
  "add",
  "subtract",
  "power",
  "round",
];

/** The row comparisons "select-transform" offers (Prism's Select rows tab):
 *  greater / less / equal, with `>=`, `<=`, `!=` alongside, and
 *  `is-not-missing` (Prism 10: keep rows where the variable has a value). */
export const SELECT_TRANSFORM_OPERATORS = [">", "<", "=", ">=", "<=", "!=", "is-not-missing"] as const;
export type SelectTransformOperator = (typeof SELECT_TRANSFORM_OPERATORS)[number];

/** One per-variable transform: which variable, which transform, the
 *  constant K when the transform needs one, and the new column's title
 *  (omitted: the transform's own name, e.g. "log10(Score)" — as Prism
 *  names an untitled transform by its definition). */
export interface SelectTransformSpec {
  variable: string;
  kind: SelectTransformKind;
  k?: number;
  title?: string;
}

/** One equation: the new variable's name and its formula over the table's
 *  variables (the Calculated Variables formula language — `Weight /
 *  Height^2`, `LOG10(Concentration)`, `IF(Group = 1, A, B)` — which may
 *  also name a transformed column). */
export interface SelectTransformEquation {
  name: string;
  formula: string;
}

/** A row-number range, 1-based and inclusive on both ends. */
export interface SelectTransformRowRange {
  first: number;
  last: number;
}

/** Keep only rows where a variable's value compares to a number — or, for
 *  `is-not-missing`, where it has a value at all (`value` is not read). */
export interface SelectTransformRowFilter {
  variable: string;
  operator: SelectTransformOperator;
  value?: number;
}

/** Keep only rows where one variable compares to another. */
export interface SelectTransformColumnFilter {
  variable: string;
  operator: SelectTransformOperator;
  otherVariable: string;
}

/** Params for "select-transform": which variables to keep (`columns`, in
 *  order — omitted: all of them), the per-variable transforms and the
 *  equations (each a new column, appended in order after the kept ones),
 *  and the row selection (a range, a value comparison, a column comparison
 *  — every criterion given must hold). All three tabs are optional: with
 *  nothing given, the new table is the source table as it stands. A
 *  transform's source need not be among `columns` — only its new column
 *  lands in the output. */
export interface SelectTransformParams {
  columns?: string[];
  transforms?: SelectTransformSpec[];
  equations?: SelectTransformEquation[];
  rowRange?: SelectTransformRowRange;
  rowFilter?: SelectTransformRowFilter;
  columnFilter?: SelectTransformColumnFilter;
}

/** Params for "two-way-anova" on a Grouped table's column-groups × row position:
 *  "ordinary" (parametric, independent samples), "repeated-measures" (parametric,
 *  matched by row — each replicate column is the same subject across every row;
 *  incomplete replicate columns are dropped), or "nonparametric" (Scheirer-Ray-Hare).
 *  `posthoc` (parametric designs only) pairwise-compares either groups within each
 *  row or rows within each group ("row means"), Tukey-, Bonferroni-, Šídák- or
 *  Holm–Šídák-corrected, or uncorrected (Fisher's LSD); or every cell mean against
 *  every other (`cells`), or the marginal group / row means (`group-means` /
 *  `row-means`). `posthoc: "fdr"` runs the FDR approach instead of a family-wise
 *  correction (see `fdrMethod` / `fdrQ`); Dunnett and Games-Howell are ordinary-design
 *  only, and the cell / marginal-mean targets are ordinary-design only too. */
export interface TwoWayAnovaParams {
  design: (typeof TWO_WAY_DESIGNS)[number];
  posthoc: (typeof TWO_WAY_POSTHOCS)[number];
  /** Dunnett's control, by its name: a group (groups compared within each row),
   *  a row (rows within each group), a cell ("Group (Row)"), or a marginal group
   *  / row mean. */
  control?: string;
  posthocTarget: (typeof POSTHOC_TARGETS)[number];
  /** The FDR approach's method (`posthoc: "fdr"` only): Benjamini-Hochberg,
   *  Benjamini-Krieger-Yekutieli (two-stage) or Benjamini-Yekutieli; omitted,
   *  Benjamini-Hochberg. */
  fdrMethod?: (typeof FDR_METHODS)[number];
  /** The FDR approach's Q (%), the maximum false-discovery rate (`posthoc:
   *  "fdr"` only); omitted, 5. */
  fdrQ?: number;
  /** Repeated measures: false (new analyses) corrects the row and interaction effects by the
   *  Geisser-Greenhouse epsilon, and compares on each comparison's own error; absent (older
   *  files) or true, sphericity is assumed. */
  sphericity?: boolean;
  /** Include the effect-size table — eta squared, partial eta squared, Cohen's f, with the
   *  partial eta squared's 95% CI; false omits it. */
  effectSizes?: boolean;
}

/** Params for "three-way-anova" on a Grouped table's column-groups × row
 *  position × row bands: ordinary (parametric) only. `posthoc` pairwise-compares
 *  the means of one term (`posthocTerm`, required when posthoc !== "none"):
 *  Tukey, Bonferroni, Šídák, Holm–Šídák, Fisher's LSD, Dunnett (each against
 *  `control`), Games-Howell, or the FDR approach (`fdrMethod` / `fdrQ`).
 *  `posthocScope` splits an interaction term into simple effects (the first
 *  factor's levels within each level of the term's last factor); on a main
 *  effect it is the same as comparing the whole term. */
export interface ThreeWayAnovaParams {
  posthoc: (typeof THREE_WAY_POSTHOCS)[number];
  posthocTerm?: (typeof THREE_WAY_TERMS)[number];
  /** Include the effect-size table — eta squared, partial eta squared, Cohen's f, with the
   *  partial eta squared's 95% CI; false omits it. */
  effectSizes?: boolean;
  /** Interaction terms only: "term" (default) compares all the term's level
   *  combinations as one family; "simple" compares simple effects. */
  posthocScope?: (typeof THREE_WAY_POSTHOC_SCOPES)[number];
  /** Dunnett's control: a level (or level combination) of the followed-up term,
   *  by its result-table label — within each family when the scope is simple. */
  control?: string;
  /** The FDR approach's method (`posthoc: "fdr"` only): Benjamini-Hochberg,
   *  Benjamini-Krieger-Yekutieli (two-stage) or Benjamini-Yekutieli; omitted,
   *  Benjamini-Hochberg. */
  fdrMethod?: (typeof FDR_METHODS)[number];
  /** The FDR approach's Q (%), the maximum false-discovery rate (`posthoc:
   *  "fdr"` only); omitted, 5. */
  fdrQ?: number;
}

/** Params for "multifactor-anova" on a Multiple Variables table: one numeric
 *  response column and 1–5 categorical factor columns (text levels, or numeric
 *  codes read as categories), fit on the complete rows. Prism's multifactor
 *  ANOVA tests the main effects and every two- and three-way interaction —
 *  never a four-way or higher one — ordinary (non-repeated measures) only.
 *  `posthoc` pairwise-compares the means of one term (`posthocTerm`, e.g.
 *  "Treatment" or "Treatment:Time"), Tukey- or Bonferroni-corrected — the
 *  Šídák / Holm–Šídák / LSD options in POSTHOCS are not offered here, and the
 *  runner refuses them rather than silently running Bonferroni. */
export interface MultifactorAnovaParams {
  /** Omitted defaults to the first numeric column. */
  response?: string;
  /** Omitted defaults to every other column with at least two levels. */
  factors?: string[];
  posthoc: (typeof POSTHOCS)[number];
  posthocTerm?: string;
}

/** Params for "nested-anova" on a Nested table: optional post-hoc pairwise
 *  comparisons between groups, on the subcolumn means — Tukey or Bonferroni only;
 *  the Šídák / Holm–Šídák / LSD options in POSTHOCS are not offered here, and the
 *  runner refuses them rather than silently running Bonferroni. */
export interface NestedAnovaParams {
  posthoc: (typeof POSTHOCS)[number];
}

/** Params for "multiple-t-tests": a per-row t test (or Wilcoxon/Mann-Whitney)
 *  between a Grouped table's exactly-2 column-groups, with a multiplicity
 *  correction across rows. `paired` runs a paired test, matching replicate columns
 *  by position between the 2 groups. `pooledSd` (parametric only) assumes every row
 *  shares one SD (pooled across rows) instead of estimating each row's independently
 *  — more power when that assumption holds. `q` is the desired false discovery
 *  rate in percent (default 5, range 0.01–50 like ROUT's Q); it only applies
 *  to the FDR corrections (`fdr`, `fdr-bky`, `fdr-by`), where a row is
 *  significant when its adjusted P is below Q — the family-wise methods
 *  flag at adjusted P < 0.05 instead. */
export interface MultipleTTestsParams {
  paired: boolean;
  gaussian: boolean;
  pooledSd: boolean;
  correction: (typeof MULTIPLE_T_TEST_CORRECTIONS)[number];
  q?: number;
}

/** Params for "binding-saturation" (XY table): which Y series is the total
 *  binding, and which saturation model. The two-series models also take
 *  `y2`, the nonspecific-binding series, fitted jointly with NS and
 *  Background shared between the series. */
export type BindingSaturationModel = (typeof BINDING_SATURATION_MODELS)[number];
export interface BindingSaturationParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  model: BindingSaturationModel;
  /** The nonspecific series (two-series models only); omitted defaults to
   *  the second Y data column. */
  y2?: string;
}

/** Params for "binding-kinetics" (XY table, X = time): which Y series, and
 *  which kinetics model. `ligandConcentration` (association-one-phase only)
 *  is the radioligand concentration in the experiment; with a `koff` from a
 *  dissociation experiment it derives kon and the kinetic Kd. `hotNM` /
 *  `time0` are the constrained constants of association-then-dissociation
 *  (required for that model). */
export type BindingKineticsModel = (typeof BINDING_KINETICS_MODELS)[number];
export interface BindingKineticsParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  model: BindingKineticsModel;
  /** Radioligand concentration (association-one-phase only), same units as
   *  the experiment; omitted = kon / kinetic Kd not reported. */
  ligandConcentration?: number;
  /** Koff from a dissociation experiment (association-one-phase only), same
   *  time units as X; omitted = kon / kinetic Kd not reported. */
  koff?: number;
  /** Radioligand concentration in nM during association
   *  (association-then-dissociation only, required). */
  hotNM?: number;
  /** Time at which dissociation starts (association-then-dissociation only,
   *  required), same time units as X. */
  time0?: number;
}

/** Params for "enzyme-inhibition" (XY table): which Y series to include
 *  (default: all), which inhibition model, and the per-series inhibitor
 *  concentration [I] — from the column titles when numeric, else
 *  wizard-filled. Morrison is a single-curve fit (X = total inhibitor
 *  concentration at one fixed [S]): `enzymeConcentration` (Et) is required,
 *  and `substrateConcentration` + `kmForMorrison` (both or neither) convert
 *  the fitted Kiapp to Ki. */
export type EnzymeInhibitionModel = (typeof ENZYME_INHIBITION_MODELS)[number];
export interface EnzymeInhibitionParams {
  /** Omitted defaults to all Y data columns. */
  y?: string[];
  model: EnzymeInhibitionModel;
  /** Per-series [I], keyed by Y column name. */
  inhibitorConcentrations?: Record<string, number>;
  /** Total enzyme concentration Et (Morrison only, required). */
  enzymeConcentration?: number;
  /** Fixed substrate concentration [S] (Morrison only, with Km). */
  substrateConcentration?: number;
  /** Michaelis constant Km (Morrison only, with [S]) — converts Kiapp to Ki. */
  kmForMorrison?: number;
}

/** Params for "dose-response-special" (XY table, X = log agonist
 *  concentration): which Y series to include (default: all — order
 *  matters, the first is the control / full agonist), which special
 *  model, and the per-series antagonist concentration B for Schild /
 *  EC50 shift — from the column titles when numeric, else wizard-filled.
 *  `bUnits` is the units B was entered in (default "M"): pA2 is the
 *  negative log of B in these units, and Kb is reported in them.
 *  `fixHillSlope` (Schild only, default false) constrains HillSlope to
 *  1.0. The operational model takes no B: the first series is the full
 *  agonist, the rest partial agonists. */
export type DoseResponseSpecialModel = (typeof DOSE_RESPONSE_SPECIAL_MODELS)[number];
export interface DoseResponseSpecialParams {
  /** Omitted defaults to all Y data columns, in table order — the first
   *  is the control (no antagonist) for Schild / EC50 shift, the full
   *  agonist for the operational model. */
  ys?: string[];
  model: DoseResponseSpecialModel;
  /** Per-series B, keyed by Y column name (Schild / EC50 shift only). */
  antagonistConcentrations?: Record<string, number>;
  /** Units B was entered in — shown next to pA2; default "M". */
  bUnits?: string;
  /** Constrain HillSlope to 1.0 (Schild only, default false). */
  fixHillSlope?: boolean;
}

/** Params for "spline-lowess" (XY table): smooth a chosen Y series against X
 *  with no model assumed — Lowess (locally weighted smoothing, span `f`) or a
 *  smoothing spline (`spar`, or `df`, or neither for the GCV auto-choice).
 *  Only one of `spar`/`df` may be set. */
export interface SplineLowessParams {
  /** Omitted defaults to the first Y data column. */
  y?: string;
  method: "spline" | "lowess";
  /** Lowess span: the fraction of points in each local fit (default 2/3, range (0, 1]). */
  f: number;
  /** Spline smoothing parameter (null = choose automatically by GCV, the default). */
  spar?: number | null;
  /** Alternative spline control: the equivalent degrees of freedom. */
  df?: number | null;
}

/** The operations "smooth-differentiate-integrate" offers (Prism's one
 *  analysis: smooth a curve and/or convert it to its derivative or
 *  integral). */
export const SMOOTH_DIFF_INT_OPERATIONS = ["smooth", "first-derivative", "second-derivative", "integral"] as const;
export type SmoothDifferentiateIntegrateOperation = (typeof SMOOTH_DIFF_INT_OPERATIONS)[number];
/** Savitzky–Golay window sizes (Prism's classic neighbour counts) and
 *  polynomial orders. */
export const SMOOTH_WINDOWS = [5, 9, 13] as const;
export const SMOOTH_ORDERS = [2, 3] as const;

/** Params for "smooth-differentiate-integrate" (XY table): which operation
 *  to run on the chosen Y data sets, and the Savitzky–Golay settings
 *  (window = neighbours in the window, order = smoothing polynomial order)
 *  used when smoothing — either as the operation itself, or after a
 *  derivative/integral when `smoothResults` is set (Prism does the
 *  derivative/integral first, then smooths). `baseline`/`startValue` are
 *  integral-only: the Y the cumulative area is measured from, and the
 *  integral's first Y value (both usually 0). The wizard always sets
 *  `operation`; the runner defaults the rest. */
export interface SmoothDifferentiateIntegrateParams {
  /** Omitted: every Y data set. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  operation: SmoothDifferentiateIntegrateOperation;
  window?: number;
  order?: number;
  smoothResults?: boolean;
  baseline?: number;
  startValue?: number;
}

/** Params for "chi-square": whether the user confirmed the rows/columns are
 *  ordered and equally spaced, so the chi-square test for trend
 *  (Cochran–Armitage) runs on a qualifying 2×k / k×2 table. */
export interface ChiSquareParams {
  /** The test to run (absent: Fisher's on a 2 × 2, else the chi-square). */
  test?: (typeof CONTINGENCY_TESTS)[number];
  trendOrdered?: boolean;
  /** Include the effect-size CIs — Cramér's V and (2 × 2) Phi with their 95% CIs; false
   *  reports the values without them. */
  effectSizes?: boolean;
}

/** Params for "mcnemar": the continuity correction (R's mcnemar.test
 *  default, true). */
export interface McNemarParams {
  continuityCorrection?: boolean;
}

/** How "chi-square-gof" takes its expected values: "equal" (the same for
 *  every category), "counts" (the expected counts, which must add up to the
 *  observed total — fractional values are fine, as in Prism), or "percent"
 *  (percentages, which must add up to 100). */
export const GOF_EXPECTED_MODES = ["equal", "counts", "percent"] as const;
export type GofExpectedMode = (typeof GOF_EXPECTED_MODES)[number];

/** Params for "chi-square-gof" (Column table): the observed counts live in
 *  one data set (`sets`, the wizard's choice — omitted: the table's only
 *  data column), and the expected distribution is either equal for every
 *  category or given per category, in row order, as counts or percentages. */
export interface ChiSquareGofParams {
  expectedMode?: GofExpectedMode;
  /** One per category, in row order — expected counts (`counts`) or
   *  percentages (`percent`); ignored for "equal". */
  expectedValues?: number[];
}

/** Params for "binomial-test" (Column table): the observed counts live in
 *  one data set (`sets` — omitted: the table's only data column), two rows
 *  only, and the first row's expected proportion under the null. */
export interface BinomialTestParams {
  /** The first category's expected proportion (0–1); omitted: 0.5 (equal). */
  expectedProportion?: number;
}

/** Params for "outliers" (Column table): ROUT-style outlier detection — each
 *  column is fit independently to a robust mean, and residuals are flagged
 *  outliers when their FDR-adjusted P falls below Q (Prism's "Q%", the
 *  maximum desired false discovery rate — smaller Q is more conservative) —
 *  or Grubbs' test (the single most extreme value per column, tested against
 *  the t distribution at significance level `alpha`, optionally iterating
 *  after each removal). A missing `method` is ROUT, so old saved analyses
 *  (params `{q}` only, or none) keep running as ROUT. */
export interface OutliersParams {
  /** Q (%) for ROUT; omitted for Grubbs (the runner defaults it to 1). */
  q?: number;
  /** Which method identifies the outliers: "rout" (default) or "grubbs". */
  method?: "rout" | "grubbs";
  /** Grubbs' test significance level (default 0.05); ignored for ROUT. */
  alpha?: number;
  /** Grubbs' test: re-test after removing each outlier (default true);
   *  ignored for ROUT. */
  iterate?: boolean;
}

/** The normality tests the "shapiro-wilk" analysis offers (plan 23 — the
 *  type key stays "shapiro-wilk" for saved-project compatibility; the label
 *  is "Normality tests"). Shapiro–Wilk is the default. */
export const NORMALITY_TESTS = [
  "shapiro-wilk",
  "dagostino-pearson",
  "anderson-darling",
  "kolmogorov-smirnov",
] as const;
export type NormalityTest = (typeof NORMALITY_TESTS)[number];

/** Params for "shapiro-wilk" (Normality tests): which of the four tests to
 *  run, and whether to also run it on the log-transformed values (the
 *  lognormality check — needs every value > 0). */
export interface ShapiroWilkParams {
  test: NormalityTest;
  /** Also test log-transformed data; omitted defaults to false. */
  lognormal?: boolean;
}

/** Params for "frequency-distribution" (Column table): how each column's values
 *  are grouped into bins. `binWidth` is required for "width", `binCount` for
 *  "count"; `startAt` is the lower edge of the first bin (width/count modes),
 *  defaulting to the data minimum. */
export interface FrequencyDistributionParams {
  binMode: (typeof BIN_MODES)[number];
  binWidth?: number;
  binCount?: number;
  startAt?: number;
}

/** Params for "transform-data": which function to apply to the values. The
 *  wizard always sets it; the runner defaults to log10 when it is absent.
 *  `constant` is the K of the arithmetic functions (Y±K, Y×K, Y/K, K−Y, K/Y)
 *  — required for those, ignored by the rest. */
export interface TransformDataParams {
  function: TransformFunction;
  /** The constant K for the arithmetic functions (seq 205). */
  constant?: number;
}
/** Molar concentration units (Prism's set), in descending magnitude: each
 *  step is a factor of 1000. µ is U+00B5 MICRO SIGN, matching the bUnits in
 *  lib/project-file.ts. Mass units (mg/mL, …) are not here — they need a
 *  molecular weight, which this operation does not collect. */
export const CONCENTRATION_UNITS = ["M", "mM", "µM", "nM", "pM"] as const;
export type ConcentrationUnit = (typeof CONCENTRATION_UNITS)[number];
/** Each unit's power of 10 in moles per litre (M = 10^0, mM = 10^-3, …). */
export const CONCENTRATION_UNIT_EXPONENTS: Record<ConcentrationUnit, number> = {
  M: 0,
  mM: -3,
  "µM": -6,
  nM: -9,
  pM: -12,
};

/** Params for "transform-concentrations": the one column to convert, and the
 *  units it is in now vs. the units it should be converted to. */
export interface TransformConcentrationsParams {
  column: string;
  fromUnit: ConcentrationUnit;
  toUnit: ConcentrationUnit;
}
/** The scale definitions "normalize" offers (Prism's Normalize): each value
 *  as a percent/fraction of a reference — the largest value in each data
 *  set, the smallest value, the first value, the mean of control column(s),
 *  or a constant you enter — or on a 0–100% scale, with 0% and 100% defined
 *  separately. */
export const NORMALIZE_METHODS = [
  "percent-of-largest",
  "percent-of-smallest",
  "percent-of-first",
  "percent-of-mean-controls",
  "percent-of-constant",
  "zero-to-hundred",
] as const;
export type NormalizeMethod = (typeof NORMALIZE_METHODS)[number];
/** What 0% is, for "zero-to-hundred": the smallest value in each data set,
 *  the value in the first row of each data set, or a value you enter. */
export const NORMALIZE_ZERO_DEFS = ["smallest", "first", "constant"] as const;
export type NormalizeZeroDef = (typeof NORMALIZE_ZERO_DEFS)[number];
/** What 100% is, for "zero-to-hundred": the largest value in each data set,
 *  the value in the last row of each data set, a value you enter, or the sum
 *  of all values in the column. */
export const NORMALIZE_HUNDRED_DEFS = ["largest", "last", "constant", "sum"] as const;
export type NormalizeHundredDef = (typeof NORMALIZE_HUNDRED_DEFS)[number];

/** Params for "normalize": which columns to rescale (`ys`), how the scale
 *  is defined, and — for XY tables — the X column whose values label the
 *  result rows. `asPercent` is percent (×100) vs fraction (×1) for the
 *  percent-of-* methods (zero-to-hundred is always percent); the wizard
 *  always sets the method's own fields, the runner defaults the rest. */
export interface NormalizeParams {
  /** Omitted: every numeric column except `x` — the wizard always sets it. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  normalizeMethod: NormalizeMethod;
  asPercent?: boolean;
  /** Control columns whose values are averaged (method "percent-of-mean-controls"). */
  controls?: string[];
  /** The 100% reference value (method "percent-of-constant"). */
  constant?: number;
  /** Info-constant hook for the 100% value (the constant's name). */
  constantHook?: string;
  /** What 0% is (method "zero-to-hundred"). */
  zeroDef?: NormalizeZeroDef;
  /** The 0% value (zeroDef "constant"). */
  zeroConstant?: number;
  /** Info-constant hook for the 0% value (the constant's name). */
  zeroConstantHook?: string;
  /** What 100% is (method "zero-to-hundred"). */
  hundredDef?: NormalizeHundredDef;
  /** The 100% value (hundredDef "constant"). */
  hundredConstant?: number;
  /** Info-constant hook for the 100% value (the constant's name). */
  hundredConstantHook?: string;
}

/** How the denominator degrees of freedom are calculated for a
 *  mixed-effects fit (Prism 11, "Denominator degrees of freedom in the
 *  mixed model" — the fit itself never changes, only the reference
 *  distribution behind the P values):
 *  - "legacy": each test gets the DF of the matching repeated-measures
 *    ANOVA error term, worked out from the design — exact when the data
 *    are complete and balanced, not reliable otherwise (Prism warns when
 *    values are missing).
 *  - "satterthwaite": an effective DF per test from the uncertainty in
 *    the estimated variance components (lmerTest) — the large improvement
 *    over Legacy on incomplete or unbalanced data.
 *  - "kenward-roger": Satterthwaite plus a correction of the fixed-effect
 *    covariance matrix for the bias from estimating the variance
 *    components (pbkrtest) — the most accurate, and Prism's default. */
export type MixedEffectsDfMethod = "legacy" | "satterthwaite" | "kenward-roger";

/** Params for "mixed-effects" (Column or Grouped table): a repeated-measures
 *  model fit with lme4::lmer (plan 20). The denominator DF behind the
 *  P values follows `dfMethod` (seq 181) — Satterthwaite via lmerTest
 *  when omitted, Kenward-Roger via pbkrtest, or the Legacy design DF.
 *  `subjectId` says what a subject is — a table row (Column tables) or a
 *  replicate column within each group (Grouped tables) — and so selects the
 *  layout; the wizard always sets it, the runner auto-detects when it is absent.
 *  `fixedFactors` names the fixed factors in model order (the column/time
 *  factor's name is the columns' shared prefix, else "Condition"; the Grouped
 *  factors are "Group" and "Row" unless the wizard says otherwise).
 *  `subjectFactor` is a between-subject factor on Column tables (one level per
 *  table row, in row order — the reference test's Treatment arm); the v1
 *  wizard asks for it (optional "groups" question: factor name + one level
 *  per row) — without it the fit is the repeated-measure factor only.
 *  `randomStructure` is "intercept" in v1 — "slope" is the v2 follow-on
 *  (compare-slopes, #46), and the runner errors on it rather than fitting
 *  something else. `slopeVariable` was dropped in v1.5.0 (FF-F18): a dead
 *  param, accepted and stored but never read; old files keep the value
 *  verbatim as an unknown param. */
export interface MixedEffectsParams {
  fixedFactors?: string[];
  randomStructure: "intercept" | "slope";
  subjectId?: "row" | "replicate";
  /** Between-subject factor (Column tables): one level per subject row, in row order. */
  subjectFactor?: { name: string; levels: string[] };
  /** Include the subject-factor × column-factor interaction (default false;
   *  Grouped tables default it on — see the wizard). */
  interaction?: boolean;
  /** How the denominator degrees of freedom behind the P values are
   *  calculated (seq 181 — Prism offers all three; Titer previously
   *  offered none and always used Satterthwaite). Omitted keeps
   *  "satterthwaite", so saved analyses and the reference pins don't
   *  move; the wizard always sets it, defaulting to "kenward-roger"
   *  (Prism's default). */
  dfMethod?: MixedEffectsDfMethod;
}

/** Params for "cox-proportional-hazards" (Multiple Variables table): which
 *  column holds survival times, which holds the 1 = event / 0 = censored
 *  codes, and which columns are the covariates. `ties` is the coxph tie
 *  method (Efron default); `stratifyBy` names the binary covariate the
 *  survival-curves graph stratifies by (the first binary covariate, or
 *  "None" — omitted when there is none). */
export interface CoxPHParams {
  /** Omitted defaults to the first data column. */
  time?: string;
  /** Omitted defaults to the second data column. */
  status?: string;
  /** Omitted (or empty — see the runner) defaults to all remaining data columns.
   *  A text column is a categorical covariate, dummy-coded with its first level
   *  as the reference (coefficients named Variable[Level]); a text column with a
   *  single level is left out (explicitly choosing one errors). */
  covariates?: string[];
  ties?: "efron" | "breslow";
  stratifyBy?: string;
}

/** Params for "roc-curve": a binary truth column against a continuous score
 *  column, paired by row. */
export interface RocParams {
  /** Truth column; defaults to the first data column. */
  truth?: string;
  /** Score column; defaults to the second data column. */
  score?: string;
  /** Which truth value counts as "positive" (e.g. 1, or "Diseased").
      Defaults to the larger/maximum distinct truth value. */
  positive?: string | number;
}

/** The distributions "Simulate data" can draw from (plan 22, sub-task a):
 *  all base R `stats` — no package needed. */
export type SimulationDistribution =
  | "gaussian"
  | "lognormal"
  | "uniform"
  | "binomial"
  | "poisson"
  | "exponential";
export const SIMULATION_DISTRIBUTIONS: SimulationDistribution[] = [
  "gaussian",
  "lognormal",
  "uniform",
  "binomial",
  "poisson",
  "exponential",
];
/** A distribution's plain-language name, as the dialog and the created table show it. */
export const SIMULATION_DISTRIBUTION_LABELS: Record<SimulationDistribution, string> = {
  gaussian: "Gaussian (normal)",
  lognormal: "Lognormal",
  uniform: "Uniform",
  binomial: "Binomial",
  poisson: "Poisson",
  exponential: "Exponential",
};

/** What "Simulate data" draws (plan 22, sub-task a) — shared with the Monte
 *  Carlo runner (sub-task b), which simulates from the same distributions.
 *  Only the fields its distribution needs are read; the rest are ignored.
 *  `n` is values per dataset/column, `datasets` how many columns/groups to
 *  simulate, `seed` the R seed (same seed + same spec = the identical table).
 *  `tableType` is the new table's shape: Column (one column per dataset),
 *  Grouped (one group per dataset, one replicate each), or XY (X evenly
 *  spaced 1..n, Y simulated — model-based simulation around a fitted curve
 *  is a follow-on, see simulate.ts). */
export interface SimulationSpec {
  distribution: SimulationDistribution;
  /** Gaussian mean. */
  mean?: number;
  /** Gaussian SD. */
  sd?: number;
  /** Lognormal meanlog — the mean of the LOGGED values (not the arithmetic mean). */
  meanlog?: number;
  /** Lognormal sdlog — the SD of the LOGGED values. */
  sdlog?: number;
  /** Uniform minimum. */
  min?: number;
  /** Uniform maximum. */
  max?: number;
  /** Binomial number of trials. */
  size?: number;
  /** Binomial probability of success, 0–1. */
  prob?: number;
  /** Poisson mean (lambda). */
  lambda?: number;
  /** Exponential rate (mean = 1/rate). */
  rate?: number;
  n: number;
  datasets: number;
  seed: number;
  tableType: "column" | "grouped" | "xy";
}

/** Repeats: at least 10 (a distribution needs repeats to summarise), at most
 *  10,000 (the wizard's max; a 10,000-repeat t-test power run is ~15–25 s). */
export const MONTE_CARLO_REPEATS = { min: 10, max: 10_000 };

/** The analyses a Monte Carlo run can repeat (plan 22, sub-task b, extended
 *  seq 204): the ones whose per-repeat statistic has a one-call in-R
 *  `replicate()` form (see simulation/monte-carlo.ts). Paired-t repeats the
 *  t test on the paired differences; one-way ANOVA repeats the F test on
 *  the stacked groups. Grouped-table targets (two-way ANOVA…) are a
 *  follow-on — the wizard offers only these. Prism repeats any analysis;
 *  the rest of that gap (nonlinear regression, ANOVA on grouped tables…)
 *  stays open — each needs its own in-R repeat form. */
export const MONTE_CARLO_TARGETS = [
  "compare-two-groups",
  "one-sample-t",
  "descriptive-statistics",
  "linear-regression",
  "correlation",
  "paired-t",
  "one-way-anova",
] as const;
export type MonteCarloTarget = (typeof MONTE_CARLO_TARGETS)[number];

/** The statistics a Monte Carlo run can summarise, per target: "P value" and
 *  "Mean difference" (compare-two-groups, paired-t), "P value" and "Mean"
 *  (one-sample-t), "Mean" (descriptive-statistics), "Slope" and
 *  "Y-intercept" (linear-regression), "r" (correlation), "P value" and "F"
 *  (one-way-anova). */
export const MONTE_CARLO_STATISTICS = ["P value", "Mean difference", "Mean", "Slope", "Y-intercept", "r", "F"] as const;
export type MonteCarloStatistic = (typeof MONTE_CARLO_STATISTICS)[number];
/** Which statistic each target offers, in wizard order. */
export const MONTE_CARLO_TARGET_STATISTICS: Record<MonteCarloTarget, MonteCarloStatistic[]> = {
  "compare-two-groups": ["P value", "Mean difference"],
  "one-sample-t": ["P value", "Mean"],
  "descriptive-statistics": ["Mean"],
  "linear-regression": ["Slope", "Y-intercept"],
  correlation: ["r"],
  "paired-t": ["P value", "Mean difference"],
  "one-way-anova": ["P value", "F"],
};

/** What distribution the simulated values come from (seq 204): Gaussian
 *  (the usual bell curve) or Student's t (Prism's Simulate offers a t with
 *  any df — wider scatter, more outliers). A t draw is scaled so the
 *  simulated values have the SD the wizard asked for (df > 2, where the t
 *  has a finite SD); Poisson / binomial simulation stays open. */
export const MONTE_CARLO_SIMULATION_DISTRIBUTIONS = ["gaussian", "t"] as const;
export type MonteCarloSimulationDistribution = (typeof MONTE_CARLO_SIMULATION_DISTRIBUTIONS)[number];

/** Params for "monte-carlo" (plan 22, sub-task b): repeat `targetAnalysis`
 *  `repeats` times on simulated data and summarise `summaryStatistic`.
 *  The simulation is Gaussian per data column by default, or Student's t
 *  with `simulationDf` degrees of freedom (seq 204), with each column's
 *  mean/SD taken from `groupMeans`/`groupSds` when given, else from the
 *  column's observed mean/SD (a parametric bootstrap). The target's own
 *  options are flattened here (not nested as `targetParams`) so the .hlx
 *  reader already knows every key: `equalVariance` (compare-two-groups:
 *  Student vs Welch), `hypotheticalValue` (one-sample-t, and paired-t's
 *  mean difference — the wizard leaves it at 0), `y`
 *  (descriptive-statistics / linear-regression: which column), `method`
 *  (correlation: Pearson / Spearman). `tails` is the P-value tails for the
 *  t-test targets (compare-two-groups, one-sample-t, paired-t) — two-sided
 *  by default, "less"/"greater" one-sided, following R's t.test
 *  alternative on (first vs second) group; other targets ignore it. */
export interface MonteCarloParams {
  targetAnalysis: MonteCarloTarget;
  summaryStatistic?: MonteCarloStatistic;
  repeats: number;
  seed: number;
  /** Per-column simulated means, keyed by column name. */
  groupMeans?: Record<string, number>;
  /** Per-column simulated SDs, keyed by column name. */
  groupSds?: Record<string, number>;
  equalVariance?: boolean;
  hypotheticalValue?: number;
  /** Which column (descriptive-statistics / linear-regression). */
  y?: string;
  method?: (typeof CORRELATION_METHODS)[number];
  /** P-value tails for the t-test targets (seq 204); two-sided by default. */
  tails?: (typeof TAILS)[number];
  /** What distribution the simulated values come from (seq 204). */
  simulationDistribution?: MonteCarloSimulationDistribution;
  /** Degrees of freedom for a t simulation (seq 204); must exceed 2. */
  simulationDf?: number;
  /** Paired-t only (seq 204): the mean difference to simulate — the
   *  differences' observed mean when omitted. */
  differenceMean?: number;
  /** Paired-t only (seq 204): the SD of the differences to simulate — the
   *  differences' observed SD when omitted. */
  differenceSd?: number;
}

/** One ROC point: at this threshold (a score value), predict positive iff
 *  score ≥ threshold. The (0,0) and (1,1) endpoints have no score threshold —
 *  the graph adds them when it draws the curve. */
export interface RocPoint {
  /** The threshold this row is the (sensitivity, specificity) at; null for
   *  the (0,0)/(1,1) endpoints, which belong to no threshold (plan 05). */
  threshold: number | null;
  sensitivity: number;
  specificity: number;
}

/** The data sets an analysis runs on, in this order: columns, or a grouped table's groups.
 *  Absent (files before Titer 1.0.5): all of them, the first two for a two-group test. */
/** The equations "plot-function" can generate a curve from (Prism's "Plot a
 *  function"): every nonlinear-regression model — evaluated by the same
 *  `evaluate()` the fitted-curve overlay uses — plus a Gaussian, Prism's
 *  canonical example (mean 0, SD 1, amplitude 100 over X −3..3), which the
 *  fitter does not offer, so it lives here only. A user-defined equation is
 *  NOT plottable: the wizard has no equation input, and its spec can't be
 *  built without one (modelSpec throws), so it is excluded here.
 *  Seq 203: the statistical distributions Prism's Plot a function also
 *  plots (FAQ 1578) — the normal (z), Student's t, F and chi-square
 *  densities, and the binomial + Poisson mass functions. */
export type PlotFunctionModel = Exclude<NonlinearModel, "user-defined"> | PlotFunctionDistribution;

/** The statistical distributions "plot-function" can plot (Prism's Plot a
 *  function, FAQ 1578): the normal (z), Student's t, F and chi-square
 *  densities, and the binomial + Poisson mass functions. */
export const PLOT_FUNCTION_DISTRIBUTIONS = [
  "normal-distribution",
  "t-distribution",
  "f-distribution",
  "chi-square-distribution",
  "binomial-distribution",
  "poisson-distribution",
] as const;
export type PlotFunctionDistribution = (typeof PLOT_FUNCTION_DISTRIBUTIONS)[number];
/** The discrete distributions (binomial, Poisson): their X grid is the
 *  whole numbers in the range, one point each — the line-segments setting
 *  does not apply to them. */
export const PLOT_FUNCTION_DISCRETE_DISTRIBUTIONS = ["binomial-distribution", "poisson-distribution"] as const;

/** What "plot-function" plots alongside the function itself (Prism's Options
 *  tab): its first derivative, its second derivative, or its integral — one
 *  extra series per curve, never instead of the function. */
export type PlotFunctionExtra = "first-derivative" | "second-derivative" | "integral";

/** One curve of a "plot-function" family: its label (the results table's and
 *  the graph legend's column name) and its parameter values, keyed by the
 *  model's parameter names (`modelSpec`'s terms, plus "X0" for the
 *  segmental-linear hinge — a coefficient the fitter derives, so the
 *  plotter asks for it outright). */
export interface PlotFunctionCurve {
  label: string;
  params: Record<string, number>;
}

/** Params for "plot-function" (no data — the table it hangs off is only its
 *  home): which equation, the X range, how many line segments define each
 *  curve (Prism's default 150), the curves' labels + parameter values, and
 *  the extra series. `ligandConcentration` is the homologous model's [L]
 *  constant (reuses NonlinearRegressionParams' key); the other models
 *  ignore it. */
export interface PlotFunctionParams {
  equation: PlotFunctionModel;
  xMin: number;
  xMax: number;
  /** Line segments per curve (points = segments + 1); omitted = 150. */
  segments?: number;
  curves: PlotFunctionCurve[];
  /** Extra series per curve; omitted or "none" = the function only. */
  extra?: PlotFunctionExtra | "none";
  ligandConcentration?: number;
}

/** One generated curve of a "plot-function" result: the shared X grid is on
 *  the result, each curve carries its Y at those X (`null`: the equation is
 *  undefined there — a log model at X ≤ 0, a pole — shown blank, never NaN)
 *  and, when asked for, the extra series at the same X. */
export interface GeneratedCurve {
  label: string;
  y: (number | null)[];
  extra?: { kind: PlotFunctionExtra; label: string; y: (number | null)[] };
}

/** One generated curve's parameter values ("plot-function"): the curve's
 *  label and the values it was generated from, in the order the wizard
 *  asked them — tabled in the results view. */
export interface PlotFunctionParameterValues {
  label: string;
  values: { name: string; value: number }[];
}

/** The generated curves of a "plot-function" result: the X grid (segments +
 *  1 evenly spaced values from xMin to xMax) shared by every curve. */
export interface GeneratedCurves {
  x: number[];
  curves: GeneratedCurve[];
}

interface DataSetsParam {
  sets?: string[];
}

export type AnalysisParams = DataSetsParam &
  (
    | DataSetsParam
    | CompareTwoGroupsParams
    | OneSampleTParams
    | AnovaParams
    | RmAnovaParams
    | KruskalWallisParams
    | FriedmanParams
    | CorrelationParams
    | XYCorrelationParams
    | LinearRegressionParams
    | CompareSlopesParams
    | DemingRegressionParams
    | AreaUnderCurveParams
    | RemoveBaselineParams
    | PruneRowsParams
    | FractionOfTotalParams
    | RowMeansTotalsParams
    | NonlinearRegressionParams
    | BindingSaturationParams
    | BindingKineticsParams
    | EnzymeInhibitionParams
    | DoseResponseSpecialParams
    | SimpleLogisticRegressionParams
    | TwoWayAnovaParams
    | ThreeWayAnovaParams
    | MultifactorAnovaParams
    | MultipleTTestsParams
    | NestedAnovaParams
    | MultipleRegressionParams
    | MultipleLogisticRegressionParams
    | PoissonRegressionParams
    | PrincipalComponentAnalysisParams
    | KMeansParams
    | HclustParams
    | ExtractRearrangeParams
    | SelectTransformParams
    | SplineLowessParams
    | SmoothDifferentiateIntegrateParams
    | CoxPHParams
    | MixedEffectsParams
    | ChiSquareParams
    | ChiSquareGofParams
    | BinomialTestParams
    | McNemarParams
    | OutliersParams
    | PValueStackParams
    | ShapiroWilkParams
    | OneSampleKsParams
    | SurvivalParams
    | CoxParams
    | FrequencyDistributionParams
    | RocParams
    | MonteCarloParams
    | TransformDataParams
    | TransformConcentrationsParams
    | NormalizeParams
    | PlotFunctionParams
  );

/** Params for "survival" (Survival table): the test comparing the curves — log-rank,
 *  log-rank for trend (groups in a meaningful order, 3 or more), or Gehan-Breslow-Wilcoxon
 *  (more weight on early events) — and, with 3 groups or more, how the pairwise
 *  comparisons are corrected. */
export interface SurvivalParams {
  curveTest: (typeof CURVE_TESTS)[number];
  correction: (typeof CORRECTIONS)[number];
  /** Multiple Variables tables: the follow-up-time variable, the event-code variable
   *  (1 = event occurred, 0 = censored) and the grouping variable whose levels are the
   *  groups compared. */
  time?: string;
  status?: string;
  groupBy?: string;
}

/** Params for "cox" (Survival table): the group the others' hazards are compared to;
 *  omitted, the first holding subjects. */
export interface CoxParams {
  reference?: string;
}

/** What every test reads: the table's data columns, parsed once (see lib/dataset.ts). */
export type { Column } from "../lib/dataset";

/** Descriptive statistics for one group (computed by R). `ciLow`/`ciHigh` (95% confidence
 *  interval of the mean) and what follows are only populated by the standalone
 *  "descriptive-statistics" analysis — every other test leaves them undefined. */
export interface GroupDescriptives {
  name: string;
  mean: number | null;
  sd: number | null;
  sem: number | null;
  median: number | null;
  n: number;
  ciLow?: number | null;
  ciHigh?: number | null;
  min?: number | null;
  max?: number | null;
  range?: number | null;
  q1?: number | null;
  q3?: number | null;
  cv?: number | null;
  geoMean?: number | null;
  /** Sum of the column's values (always defined). */
  sum?: number | null;
  /** Moment skewness g1 = m3/m2^1.5 (none under 3 values or on a constant column). */
  skewness?: number | null;
  /** Excess kurtosis b2 − 3 = m4/m2^2 − 3, so a normal distribution is ~0
   *  (none under 3 values or on a constant column). */
  kurtosis?: number | null;
}

/** One displayed statistic. `p: true` marks a P value (rendered with significance colour + stars). */
export interface StatRow {
  label: string;
  value: number | null;
  p?: boolean;
}

/** One pairwise post-hoc comparison row (e.g. Tukey/Bonferroni/pairwise Wilcoxon). */
export interface ComparisonRow {
  group1: string;
  group2: string;
  /** A grouped table's comparison: the two cells it compares (a group at a table row),
   *  where a graph draws its bracket. */
  cells?: [ComparedCell, ComparedCell];
  /** Mean of group1 minus mean of group2. */
  diff: number | null;
  /** Its 95% CI, adjusted for the comparisons of its family as its P is (none for ranks). */
  low?: number | null;
  high?: number | null;
  p: number | null;
  /** The row's test statistic (a t test's t; the rank tests have none). */
  t?: number | null;
  /** Its degrees of freedom (a t test's df; the rank tests have none). */
  df?: number | null;
  /** The row's uncorrected P value — `p` is the multiplicity-corrected one
   *  (multiple-t-tests only; the results view shows both when they differ). */
  rawP?: number | null;
  /** Whether this row's (already multiplicity-corrected, where the analysis
   *  corrects) P value clears the analysis's significance threshold.
   *  Only set by analyses that flag rows — multiple-t-tests sets it on
   *  every row; the results view shows a Significant? column when any row
   *  carries it. */
  significant?: boolean;
}

/** A group at a row of a grouped table (`row`: its index in the table). */
export interface ComparedCell {
  group: string;
  row: number;
}

/** A square correlation matrix: `r[i][j]` is the coefficient between variable i
 *  and j (symmetric, diagonal = 1), `p[i][j]` the matching P value, `lo[i][j]` /
 *  `hi[i][j]` the coefficient's 95% CI (null where it is undefined: fewer than
 *  4 pairs, or a perfect r). */
interface CorrelationMatrix {
  variables: string[];
  r: (number | null)[][];
  p: (number | null)[][];
  lo?: (number | null)[][];
  hi?: (number | null)[][];
  label?: string;
}

/** One predictor's variance inflation factor (seq 198, multiple-regression
 *  diagnostics): VIF = 1 / (1 − R²ⱼ), where R²ⱼ is that predictor regressed
 *  on all the others. 1 = no collinearity; above 10 the predictor is
 *  strongly collinear with the others and its coefficient is imprecise. */
export interface VifRow {
  term: string;
  vif: number | null;
}

/** One row of a regression ANOVA table (seq 198): the variation the model
 *  explains (Regression) against what is left (Residual), with the F test
 *  of the whole model. */
export interface AnovaRow {
  source: string;
  df: number | null;
  ss: number | null;
  ms: number | null;
  f: number | null;
  p: number | null;
}

/** A covariance matrix of fitted coefficients (seq 198): `values[i][j]` is
 *  the covariance between the coefficients of `variables[i]` and
 *  `variables[j]` (symmetric; the diagonal is each coefficient's variance).
 *  Reported on the uncentered scale — the intercept's row is the intercept
 *  as fitted, not the centered fit's. */
export interface CovarianceMatrix {
  variables: string[];
  values: (number | null)[][];
}

/** One row of an ANOVA's effect-size table (seq 161): one effect's eta
 *  squared (SS_effect / SS_total), partial eta squared (SS_effect /
 *  (SS_effect + SS_error)), Cohen's f from the partial eta squared, and
 *  the partial eta squared's 95% CI (noncentral-F inversion). Nulls where
 *  the measure doesn't apply (e.g. the matching effect of a repeated-
 *  measures ANOVA has an eta squared but no partial eta squared). */
export interface EffectSizeRow {
  effect: string;
  eta2: number | null;
  partialEta2: number | null;
  cohensF: number | null;
  partialEta2Lo: number | null;
  partialEta2Hi: number | null;
}

/** One group of a survival analysis: its subjects, its events, and its median survival with
 *  the median's 95% interval (null where the curve, or the band's edge, never reaches 50%). */
export interface SurvivalGroupRow {
  group: string;
  subjects: number;
  events: number;
  median: number | null;
  low: number | null;
  high: number | null;
}

/** A Cox regression's hazard ratio of a group to the reference group ("A vs. B"), its 95%
 *  interval and P. */
export interface HazardRatioRow {
  comparison: string;
  ratio: number | null;
  low: number | null;
  high: number | null;
  p: number | null;
}

/** One row of a regression coefficients table (intercept or a predictor).
 *  `low`/`high` are the 95% CIs (asymptotic for a nonlinear fit, estimate ±
 *  t(0.975, df)·SE; a Cox regression (plan 10) carries them on the
 *  hazard-ratio scale instead — the results view adds a Hazard ratio column
 *  when a coefficient carries one). */
export interface RegressionCoefficient {
  term: string;
  estimate: number | null;
  stdError: number | null;
  t: number | null;
  p: number | null;
  /** Seq 323: true when the data do not determine this parameter (Prism's
   *  unstable-parameter check — the fit's Hessian condition number exceeds
   *  10/√ε). The numeric estimate is kept (the overlays draw the curve
   *  from it); the results view shows "Unstable" / "Very wide" instead. */
  unstable?: boolean;
  /** Denominator degrees of freedom behind `p` (mixed-effects only):
   *  Satterthwaite / Kenward-Roger are usually fractional, Legacy whole. */
  df?: number | null;
  /** Its 95% confidence interval (asymptotic for a nonlinear fit). */
  low?: number | null;
  high?: number | null;
  hazardRatio?: number | null;
}

/** One row of best-fit values: a value per data set, or an interval (`ranges`, low and high). */
export interface FitRow {
  label: string;
  values?: (number | null)[];
  /** The values are P values. */
  p?: boolean;
  ranges?: [number | null, number | null][];
}

/** An unknown read off a standard curve: its row, its Y, the X the curve gives it (null when
 *  the curve never reaches that Y), 10^X when X is a log, and whether X lies beyond the
 *  standards' X. `low`/`high` are the 95% CI of the interpolated X, from inverting the
 *  curve's 95% confidence band (null where the band never reaches the Y, and null where
 *  the inversion comes back inverted, low above high, on a non-monotonic curve). */
export interface InterpolatedRow {
  label: string;
  y: number | null;
  x: number | null;
  concentration?: number | null;
  extrapolated: boolean;
  low: number | null;
  high: number | null;
}

/** One row of a mixed-effects variance-components table: the random-effect
 *  variance and SD for one grouping (`group` "Subject" / "Residual",
 *  `component` e.g. "Intercept"). */
export interface VarianceComponent {
  group: string;
  component: string;
  variance: number | null;
  sd: number | null;
}

/** One row of "correlation" results in "x-vs-every-y" mode: X vs. one Y series. */
export interface CorrelationRow {
  variable: string;
  r: number | null;
  p: number | null;
  /** r's 95% CI. */
  low?: number | null;
  high?: number | null;
}

/** One baseline-subtracted value ("remove-baseline"): the original value,
 *  the baseline subtracted from it, and the result. `row` is the row title,
 *  or the row number when the table has none; `x` is the X value at that
 *  row (XY tables only). */
export interface BaselineRemovedRow {
  row: string;
  x?: number | null;
  original: number;
  baseline: number;
  subtracted: number;
}

/** One column's baseline-subtracted values ("remove-baseline"): the
 *  baseline used for the column (recorded so the operation is auditable)
 *  and how it was defined. */
export interface BaselineRemovedColumn {
  column: string;
  baseline: number;
  method: string;
  rows: BaselineRemovedRow[];
}

/** One row of a column-math result ("remove-baseline"): the row title (or
 *  row number), the X value at that row (XY tables only), the two values
 *  combined, and the result — `null` when the operation could not produce
 *  one (dividing by zero). Only rows holding a value in both columns are
 *  listed. */
export interface ColumnMathRow {
  row: string;
  x?: number | null;
  a: number;
  b: number;
  result: number | null;
}

/** A column-math result ("remove-baseline"): the two columns combined, the
 *  operation, and the row-matched rows. */
export interface ColumnMathResult {
  a: string;
  b: string;
  operation: ColumnMathOperation;
  rows: ColumnMathRow[];
}
/** One kept or pruned row ("prune-rows"): the row title (or row number),
 *  the X value at that row (XY tables only), and the value held in each
 *  chosen column (`null`: blank). */
export interface PrunedRowsRow {
  row: string;
  x?: number | null;
  values: (number | null)[];
}

/** The rows "prune-rows" kept and dropped: the chosen columns, then the
 *  kept rows and the pruned rows — the pruned ones listed so what was
 *  dropped stays visible, and recoverable from the untouched source. */
export interface PrunedRowsResult {
  columns: string[];
  kept: PrunedRowsRow[];
  pruned: PrunedRowsRow[];
}

/** One category of a "chi-square-gof" result: its observed count, the count
 *  the expected distribution predicts, and its share of the chi-square
 *  statistic, (O − E)² / E. `category` is the row title, or the row number
 *  when the table has none. */
export interface GoodnessOfFitCategoryRow {
  category: string;
  observed: number;
  expected: number;
  contribution: number;
}

/** One divided value ("fraction-of-total"): the original value, the total
 *  it was divided by, and the resulting fraction (or percent). `value` is
 *  null when the total is 0 — the cell is blank, never NaN or Infinity.
 *  `row` is the row title, or the row number when the table has none; `x`
 *  is the X value at that row (XY tables only). `ciLow`/`ciHigh` are the
 *  95% CI of the proportion, in the same units as `value`, when the analysis
 *  asked for one — null when the value is not a proportion of its total
 *  (below 0, or above the total), or when the value itself is blank. */
export interface FractionOfTotalRow {
  row: string;
  x?: number | null;
  original: number;
  total: number;
  value: number | null;
  ciLow?: number | null;
  ciHigh?: number | null;
}

/** One column's divided values ("fraction-of-total"): the total divided by
 *  — the column total, or the grand total — whether the values are
 *  fractions or percentages, and which 95% CI of each proportion they
 *  carry (`ci`, "none" when the analysis asked for none). In row-total
 *  mode each row has its own total, so `total` is null and every row
 *  carries its own. */
export interface FractionOfTotalColumn {
  column: string;
  total: number | null;
  format: FractionOfTotalFormat;
  ci: FractionOfTotalCI;
  rows: FractionOfTotalRow[];
}

/** How "row-means-totals" groups the values: `pooled` is one summary per row
 *  across all the chosen data sets; `per-column` is one summary per row
 *  within each chosen data set (Prism's "for each data set column"
 *  option). */
export const ROW_MEANS_SCOPES = ["pooled", "per-column"] as const;
export type RowMeansScope = (typeof ROW_MEANS_SCOPES)[number];

/** Params for "row-means-totals": which columns to summarise across each
 *  row (`ys`), and — for XY tables — the X column whose values label the
 *  result rows. `rowScope` is `pooled` unless the wizard chose
 *  `per-column`. */
export interface RowMeansTotalsParams {
  /** Omitted: every numeric column except `x` — the wizard always sets it. */
  ys?: string[];
  /** XY tables only: the X column, for the result rows' X values. */
  x?: string;
  /** Omitted: `pooled` — one summary per row across the chosen data sets. */
  rowScope?: RowMeansScope;
}

/** One row's summary ("row-means-totals"): the total, mean, SD, SEM, median,
 *  t-based 95% CI of the mean, %CV and geometric mean of the values that row
 *  holds across the chosen data sets — plus the minimum, maximum, 25th and
 *  75th percentiles, 10th and 90th percentiles, geometric SD and the t-based
 *  95% CI of the geometric mean. `row` is the row title, or the row
 *  number when the table has none; `x` is the X value at that row (XY tables
 *  only). `column` is the data set the summary is within, in per-column mode
 *  only. SD, SEM, CI and %CV are null on a one-value row; the geometric mean,
 *  geometric SD and geometric CI are null unless every value is above 0, and
 *  the geometric SD/CI also need at least 2 values. Quartiles and
 *  percentiles are R's type 6, the (n + 1)p method — the per-column
 *  descriptives' method. */
export interface RowMeansRow {
  row: string;
  x?: number | null;
  column?: string;
  n: number;
  total: number;
  mean: number | null;
  sd: number | null;
  sem: number | null;
  median: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  cv: number | null;
  geoMean: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  p10: number | null;
  p90: number | null;
  geoSd: number | null;
  geoCiLow: number | null;
  geoCiHigh: number | null;
}

/** One Y data set's derived curve ("smooth-differentiate-integrate"): the
 *  operation's label, the result X and Y values, and how many input rows
 *  the result lost (edge rows the smoothing window cannot centre on, or the
 *  rows a derivative consumes). */
export interface DerivedCurve {
  dataset: string;
  label: string;
  x: number[];
  y: number[];
  dropped: number;
}

/** One row of "area-under-curve" results: one Y series' trapezoidal AUC vs. X. */
export interface AreaUnderCurveRow {
  variable: string;
  area: number | null;
  n: number;
}

/** One row of "outliers" results: one column's outlier count, with ROUT's robust mean
 *  (ROUT), or the mean after removing flagged outliers (`mean`, Grubbs). */
interface OutlierGroupRow {
  group: string;
  points: number;
  outliers: number;
  percent: number;
  robustMean: number | null;
  /** Mean after removing flagged outliers ("grubbs" only). */
  mean?: number | null;
  /** Grubbs' statistic for the column's most extreme value ("grubbs" only). */
  grubbs?: { extreme: number | null; g: number | null; p: number | null };
}

/** One row of "shapiro-wilk" results: a data set's test of normality, and of lognormality
 *  (on its logarithms); none where it can't be tested. */
export interface NormalityRow {
  group: string;
  w: number | null;
  p: number | null;
  logW: number | null;
  logP: number | null;
}

/** One bin of a frequency distribution: right-closed `(lower, upper]`, except
 *  the first bin, which is closed on both sides so the minimum is always counted.
 *  The label matches the edge rule, e.g. "(2, 4]", first bin "[2, 4]". */
export interface FrequencyBinRow {
  bin: string;
  lower: number;
  upper: number;
  count: number;
  /** count / n, 0–1. */
  relativeFrequency: number;
  cumulativeCount: number;
  /** cumulativeCount / n, 0–1. */
  cumulativeFrequency: number;
}

/** One column's frequency-distribution bins. */
export interface FrequencyBins {
  column: string;
  bins: FrequencyBinRow[];
}

/** One column's transformed values ("transform-data"): `original` and
 *  `values` are row-aligned with the source column's rows — a value that
 *  could not be transformed (log of ≤ 0, square root of a negative, 1/0,
 *  an overflowing exp/square) is null in `values`, never NaN, and counted
 *  in `excluded`. Blank source rows are null in both arrays. */
export interface TransformedColumn {
  column: string;
  /** The function as written in the results, e.g. "log10(Y)". */
  label: string;
  original: (number | null)[];
  values: (number | null)[];
  excluded: number;
}
/** One converted value ("transform-concentrations"): the original value and
 *  its conversion, with the 1-based table row it came from. */
export interface ConvertedValueRow {
  row: number;
  original: number;
  converted: number;
}

/** One column's converted concentrations ("transform-concentrations"). */
export interface ConvertedColumn {
  column: string;
  fromUnit: ConcentrationUnit;
  toUnit: ConcentrationUnit;
  values: ConvertedValueRow[];
}
/** One normalized value ("normalize"): the original value and the rescaled
 *  one. `normalized` is null when the value could not be normalized (a zero
 *  100% reference, or a 0–100% scale with no range) — a blank, never NaN.
 *  `row` is the row title, or the row number when the table has none; `x`
 *  is the X value at that row (XY tables only). */
export interface NormalizedRow {
  row: string;
  x?: number | null;
  original: number;
  normalized: number | null;
}

/** One column's normalized values ("normalize"): the scale used for the
 *  column (recorded so the operation is auditable) — `reference` is the
 *  100% reference for the percent-of-* methods, or the 0% value for
 *  zero-to-hundred, whose 100% value is `hundred`; `asPercent` is percent
 *  (×100) vs fraction (×1), always percent for zero-to-hundred. */
export interface NormalizedColumn {
  column: string;
  method: string;
  reference: number;
  hundred?: number;
  asPercent: boolean;
  /** The scale as written in the notes, e.g. "Largest value: 16". */
  referenceDescription: string;
  rows: NormalizedRow[];
}
/** The extracted table ("extract-rearrange" / "select-transform"): the new
 *  table's type and its data — a real table the user can create (via
 *  "Create table" in the results view) and then graph or analyse. `table`
 *  carries `groups` / `replicates` where the target type needs them (XY
 *  with subjects, Grouped), so the created table reads back as that type.
 *  A select-transform builds a Multiple Variables table, so "multiple" is
 *  a table type here too. */
export interface ExtractedTable {
  tableType: ExtractRearrangeTarget | "multiple";
  table: TableData;
}

/** One cell of a transposed table ("transpose"): a number where the source
 *  cell held one, the raw text where it held text, null where it was blank
 *  (or excluded). */
export type TransposedCell = string | number | null;

/** The transposed table ("transpose"): the source table with rows and
 *  columns swapped. `columns` are the new column titles — "Title", then one
 *  per source row (its title, or "Row N" when it has none) — and `rows` are
 *  one per source data column, each starting with that column's name. */
export interface TransposedTable {
  columns: string[];
  rows: TransposedCell[][];
}

/** One row of a K-means clustering's clusters table ("k-means"): one
 *  cluster's centre (in the ORIGINAL units — back-transformed when the
 *  variables were standardised), its size, and its within-cluster sum of
 *  squares. Clusters are in canonical order: sorted by their first
 *  centre coordinate, ascending — R numbers clusters in the order its
 *  algorithm finds them, so without this the labels would be arbitrary. */
export interface KMeansClusterRow {
  cluster: string;
  centre: (number | null)[];
  n: number;
  withinSs: number | null;
}

/** One row of a K-means clustering's assignments table ("k-means"): which
 *  (canonical) cluster one complete row belongs to, in table order. `row`
 *  is the row title, or the row number when the table has none. */
export interface KMeansAssignmentRow {
  row: string;
  cluster: number;
}

/** One row of a hierarchical clustering's clusters table
 *  ("hierarchical-clustering"): one cluster's centroid (the mean of its
 *  members, in the ORIGINAL units — back-transformed when the variables were
 *  standardised), its size, and its within-cluster sum of squares. Clusters
 *  are in canonical order: sorted by their first centroid coordinate,
 *  ascending — R's cutree numbers clusters by leaf order, so without this
 *  the labels would depend on the tree's shape. */
export interface HclustClusterRow {
  cluster: string;
  centroid: (number | null)[];
  n: number;
  withinSs: number | null;
}

/** One row of a hierarchical clustering's assignments table
 *  ("hierarchical-clustering"): which (canonical) cluster one complete row
 *  belongs to, in table order. `row` is the row title, or the row number
 *  when the table has none. */
export interface HclustAssignmentRow {
  row: string;
  cluster: number;
}

/** A hierarchical clustering's dendrogram ("hierarchical-clustering"): R's
 *  `hclust` merge matrix, heights and leaf order, plus the row titles and
 *  the height the tree is cut at for the chosen k. `merge` is one row per
 *  merge step (n − 1 rows): R's own convention, kept as-is — a negative
 *  entry −i is leaf i (1-based, into the complete rows), a positive entry
 *  j is merge step j (1-based). The sign is what tells a leaf from a step,
 *  so entries are never re-based to 0.
 *  `order` is the leaves left-to-right as R plots them (0-based indices
 *  into the complete rows); `labels` are the complete rows' titles, in
 *  table order. `cutHeight` is the midpoint between the two merge heights
 *  the chosen k falls between, or null when k leaves a single cluster. */
export interface HclustDendrogram {
  merge: number[][];
  heights: number[];
  order: number[];
  labels: string[];
  cutHeight: number | null;
}

/** One row of a hierarchical clustering's choosing-k table
 *  ("hierarchical-clustering"): for one k, the within-cluster sum of
 *  squares (the Elbow plot), the average silhouette width (the Silhouette
 *  plot), and the Gap statistic with its standard error (the Gap plot) —
 *  the three guides for choosing k. `gap` / `gapSe` are null when the Gap
 *  statistic could not be computed for that k. */
export interface ChoosingKRow {
  k: number;
  withinSs: number | null;
  avgSilhouette: number | null;
  gap: number | null;
  gapSe: number | null;
}

/** One row of a PCA variance-explained table ("principal-component-analysis"):
 *  one component's standard deviation, eigenvalue (variance), and share of
 *  the total variance, with the running total. */
export interface PcaVarianceRow {
  component: string;
  eigenvalue: number | null;
  sd: number | null;
  proportion: number | null;
  cumulative: number | null;
}

/** One row of a PCA loadings table: one variable's loading on every reported
 *  component, in component order. */
export interface PcaLoadingRow {
  variable: string;
  loadings: (number | null)[];
}

/** One row of a PCA scores table: one subject's (complete row's) score on
 *  every reported component, in component order. `row` is the row title, or
 *  the row number when the table has none. */
export interface PcaScoreRow {
  row: string;
  scores: (number | null)[];
}

/** One row of a "p-value-stack" result: the P value as entered, its rank
 *  (1 = smallest; ties in entry order), its multiplicity-adjusted P value
 *  (or q value, for the FDR methods), and whether it is flagged significant
 *  (FWER methods) or a discovery (FDR methods). */
export interface PValueRow {
  label: string;
  rank: number;
  p: number | null;
  adjusted: number | null;
  flagged: boolean;
}

/** One fitted point of a smoother ("spline-lowess"): `y` is the fitted value
 *  at `x`; `observed` is the data's Y at that X, carried so the results view
 *  can show residuals without re-reading the table. */
export interface FittedPoint {
  x: number;
  y: number;
  observed?: number;
}

/** A Monte Carlo run's summary ("monte-carlo", plan 22): the empirical
 *  distribution of the chosen statistic across `repeats` simulated repeats.
 *  `proportionSignificant` is the share of repeats with P < 0.05 — the
 *  estimated power — and is only set when the statistic is a P value.
 *  `observed` is the same statistic on the real (source) data, for the
 *  histogram's reference line. `bins` is the distribution binned for the
 *  histogram graph (Sturges + R pretty() breaks, via computeFrequencyBins):
 *  the raw repeat values are NOT stored — they are reproducible from the
 *  seed + params, and 10,000 of them would bloat the result (and the
 *  reference file). */
export interface MonteCarloResult {
  repeats: number;
  statistic: string;
  mean: number | null;
  sd: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  proportionSignificant?: number | null;
  observed: number | null;
  bins: { edges: number[]; counts: number[] };
}
/** Unified result shape returned by every analysis module. */
/** The difference a t test estimates with its 95% CI, for an estimation plot
 *  (Prism's "Graph confidence interval of differences between means"): the
 *  third dataset the plot draws beside the raw groups. `difference` = the
 *  difference between means (unpaired t test) or the mean of the paired
 *  differences, in the data's units; `log-difference` = the difference of the
 *  log means (unpaired lognormal t test), on the natural-log scale (its
 *  exponential is the ratio of geometric means); `ratio` = the geometric
 *  mean ratio (paired ratio t test), plotted on a log axis against 1. Only a
 *  two-tailed parametric t test reports one: a non-parametric test computes
 *  no CI, and a one-tailed test's CI is one-sided (one bound infinite). */
export interface DifferenceResult {
  mode: "difference" | "log-difference" | "ratio";
  estimate: number;
  low: number;
  high: number;
  /** Label for the third dataset, e.g. "Difference between means". */
  label: string;
}

/** The data an analysis ran on, shown first (`report/analyzed.ts`). */
export interface Analyzed {
  /** The data sets, in order, each with its count when it has one (values, subjects…). */
  sets: { name: string; n?: number }[];
  /** How they are read: two compared ("A vs. B"), matched ("A → B"), each against the
   *  first (a control, a reference), or a list. */
  how: "vs" | "paired" | "control" | "list";
  /** What else it ran on: "8 pairs", "on “Dose”", "5 rows"… */
  detail?: string;
  /** The table's data sets it left out. */
  left: string[];
}

/** One condition of a test, checked by R: whether it holds, and what that means. */
export interface Check {
  ok: boolean;
  text: string;
}

export interface AnalysisResult {
  testType: AnalysisType;
  /** Resolved test name when params pick a specific variant, e.g. "Welch's t test". */
  subtitle?: string;
  /** The data it ran on (added to every result by `report`). */
  analyzed?: Analyzed;
  /** What the results mean, in plain words, under the heading. */
  summary?: string;
  /** Its conditions, checked by R (normality, equal SDs…). */
  checks?: Check[];
  /** Optional per-data-set normality table ("shapiro-wilk"). */
  normality?: NormalityRow[];
  /** Human-readable fitted-model equation, e.g. "Y = 2.927*X − 0.3322" (regressions). */
  equation?: string;
  stats: StatRow[];
  groups: GroupDescriptives[];
  notes: string;
  /** Optional pairwise post-hoc comparisons table. */
  comparisons?: ComparisonRow[];
  comparisonsLabel?: string;
  /** Optional correlation matrix (Multiple Variables correlation matrix). */
  matrix?: CorrelationMatrix;
  /** Optional ANOVA effect-size table (seq 161): one row per effect. */
  effectSizes?: EffectSizeRow[];
  /** Optional regression coefficients table (multiple regression). */
  coefficients?: RegressionCoefficient[];
  /** Optional multiple-regression diagnostics (seq 198): one VIF per
   *  predictor (multicollinearity), the regression ANOVA table, and the
   *  covariance matrix of the coefficients. */
  vif?: VifRow[];
  anovaTable?: AnovaRow[];
  covariance?: CovarianceMatrix;
  /** A curve fit's best-fit values, one column per data set (two when curves are compared). */
  fit?: { sets: string[]; rows: FitRow[] };
  /** A standard curve's unknowns, interpolated. */
  interpolated?: InterpolatedRow[];
  /** The radioligand concentration [L] a homologous-competition fit used
   *  (plan 28): the fitted-curve overlays need it to evaluate the curve
   *  (Y = Bmax·[L]/([L] + 10^X + Kd) + Bottom), and the result alone does
   *  not carry it. Set whenever the run supplied one. */
  ligandConcentration?: number;
  /** The user-defined equation a "user-defined" fit used (v2 item 23): the fitted-curve
   *  overlays need it to evaluate the curve, and the result alone does not carry it.
   *  Set whenever the run supplied one. */
  customEquation?: string;
  /** The X a centered polynomial fit was centered at (seq 201): the mean of
   *  the fitted X values. The fitted-curve overlays need it to evaluate the
   *  curve (powers of X − centeredX, not of X). Set whenever the run fitted
   *  a polynomial with `centered`. */
  centeredX?: number;
  /** Optional variance components ("mixed-effects"): one row per
   *  random-effects grouping (subject intercept + residual in v1). */
  varianceComponents?: VarianceComponent[];
  /** What the coefficients table's statistic column is ("t" by default): a
   *  logistic regression's is a z-statistic, so it says "z". */
  statisticLabel?: string;
  /** The points a curve's ROUT left out: data set, row, X, Y and key (`pointKeyOf`). */
  curveOutliers?: { set: string; label: string; x: number; y: number; key: string }[];
  /** Optional per-Y correlations table ("correlation", "x-vs-every-y" mode). */
  correlations?: CorrelationRow[];
  /** Optional per-Y area-under-curve table ("area-under-curve"). */
  areas?: AreaUnderCurveRow[];
  /** Optional per-column baseline-subtracted values ("remove-baseline"):
   *  one table per column, each with the baseline used recorded. */
  baselineRemoved?: BaselineRemovedColumn[];
  /** Optional column-math result ("remove-baseline", column-math mode):
   *  the two columns combined row by row, with the operation recorded. */
  columnMath?: ColumnMathResult;
  /** Optional kept and pruned rows ("prune-rows"): the kept rows, then
   *  the pruned rows listed so what was dropped stays visible. */
  prunedRows?: PrunedRowsResult;
  /** Optional per-category observed vs. expected counts ("chi-square-gof"):
   *  one row per category, with its share of the chi-square statistic. */
  gofCategories?: GoodnessOfFitCategoryRow[];
  /** Optional per-column divided values ("fraction-of-total"): one table
   *  per column, each with the total divided by recorded. */
  fractionsOfTotal?: FractionOfTotalColumn[];
  /** Optional per-row summaries ("row-means-totals"): one row per table
   *  row holding a value, with that row's total, mean, SD, SEM, 95% CI,
   *  %CV, median, quartiles, min/max, percentiles and geometric mean/SD/CI
   *  across the chosen data sets — or, in per-column mode, one row per
   *  table row per data set. */
  rowMeans?: RowMeansRow[];
  /** Optional per-column outlier summary ("outliers"). */
  outlierGroups?: OutlierGroupRow[];
  /** Optional per-group survival summary ("survival"). */
  survivalGroups?: SurvivalGroupRow[];
  /** What the comparisons table's second column holds, when not a difference of means. */
  comparisonsEffect?: string;
  /** Optional hazard ratios of a Cox regression, each group's to the reference's. */
  hazardRatios?: HazardRatioRow[];
  /** Optional per-column frequency-distribution bins ("frequency-distribution"). */
  frequencyBins?: FrequencyBins[];
  /** Optional per-column transformed values ("transform-data"), row-aligned
   *  with the source columns. */
  transformed?: TransformedColumn[];
  /** Optional converted concentrations ("transform-concentrations"): one
   *  entry per converted column, each value paired with its original. */
  convertedColumns?: ConvertedColumn[];
  /** Optional per-column normalized values ("normalize"): one table per
   *  column, each with the scale used recorded. */
  normalized?: NormalizedColumn[];
  /** Optional transposed table ("transpose"): the source table with rows
   *  and columns swapped — one column per source row, one row per source
   *  data column. */
  transposed?: TransposedTable;
  /** Optional extracted table ("extract-rearrange"): the new XY / Column /
   *  Grouped / Contingency table built from a subset of a Multiple
   *  Variables table — the results view renders it and offers "Create
   *  table" to add it to the project as a real table. */
  extracted?: ExtractedTable;
  /** Optional ROC points ("roc-curve"): one row per threshold (unique score
   *  values, descending); Youden's J is computed at render time. */
  rocCurve?: RocPoint[];
  /** Optional PCA tables ("principal-component-analysis"): the variance
   *  explained per component, the loadings (one row per variable) and the
   *  scores (one row per complete subject row). Loadings and scores are
   *  sign-canonicalised per component (see the runner), so a stored result
   *  is stable across runs. */
  pcaVariance?: PcaVarianceRow[];
  pcaLoadings?: PcaLoadingRow[];
  pcaScores?: PcaScoreRow[];
  /** Optional K-means tables ("k-means"): one row per cluster (its centre
   *  in original units, size and within-cluster sum of squares) and one
   *  row per complete observation (its cluster assignment). Cluster labels
   *  are canonicalised by the runner (sorted by first centre coordinate),
   *  so a stored result is stable across runs. */
  kmeansClusters?: KMeansClusterRow[];
  kmeansAssignments?: KMeansAssignmentRow[];
  /** Optional hierarchical-clustering tables ("hierarchical-clustering"):
   *  one row per cluster (its centroid in original units, size and
   *  within-cluster sum of squares), one row per complete observation (its
   *  cluster assignment), the dendrogram (merge matrix, heights, leaf order
   *  and cut height), and the choosing-k diagnostics (within SS, average
   *  silhouette width, Gap statistic ± SE per k). Cluster labels are
   *  canonicalised by the runner (sorted by first centroid coordinate),
   *  so a stored result is stable across runs. */
  hclustClusters?: HclustClusterRow[];
  hclustAssignments?: HclustAssignmentRow[];
  hclustDendrogram?: HclustDendrogram;
  choosingK?: ChoosingKRow[];
  /** Optional per-point smoother output ("spline-lowess"), the shared
   *  per-point-result mechanism for later plans: `fitted` = the fitted
   *  values at the data X's, in ascending X order; `curve` = the same
   *  smoother on a dense grid (100 points across the X range) for drawing. */
  fitted?: FittedPoint[];
  curve?: { x: number; y: number }[];
  /** Optional per-Y derived curves ("smooth-differentiate-integrate"): one
   *  new curve table per Y data set — the smoothed curve, the first or
   *  second derivative, or the cumulative integral. */
  derivedCurves?: DerivedCurve[];
  /** Optional generated curves ("plot-function"): the X grid shared by every
   *  curve, each curve's Y at those X, and its extra series when asked for —
   *  the results view tables them and an XY scatter draws them. */
  generatedCurves?: GeneratedCurves;
  /** Optional parameter values ("plot-function"): one entry per generated
   *  curve — the values it was generated from, tabled in the results view. */
  parameterValues?: PlotFunctionParameterValues[];
  /** Optional per-P-value rows ("p-value-stack"): one row per entered P
   *  value, in entry order; `pValueAdjustedLabel` names the adjusted column
   *  ("Adjusted P value" for the FWER methods, "q value" for the FDR ones)
   *  and `pValueFlagLabel` the flag column ("Significant" / "Discovery"). */
  pValueRows?: PValueRow[];
  pValueAdjustedLabel?: string;
  pValueFlagLabel?: string;
  /** Optional Monte Carlo summary ("monte-carlo"): the statistic's
   *  distribution across repeats, its 95% percentile interval, the
   *  estimated power (when the statistic is a P value), the observed
   *  value on the real data, and the bins the histogram graph draws. */
  monteCarlo?: MonteCarloResult;
  /** Optional difference with its 95% CI ("compare-two-groups"): what an
   *  estimation plot draws as its third dataset (see DifferenceResult). */
  difference?: DifferenceResult;
}

/** A test returns either a result or a user-facing error message. */
export type AnalysisOutcome = AnalysisResult | { error: string };
