// PARAM_CHOICES lives here, not in lib/project-file: this is a leaf module
// (its only import is ../stats/types), so the stats runners can read the
// table without importing lib/project-file — which imports ANALYSES from
// ../stats, a stats → project-file → stats cycle that crashed four gate legs
// with `ReferenceError: Cannot access 'ANALYSES' before initialization`.
import {
  ANOVA_POSTHOCS,
  BINDING_KINETICS_MODELS,
  BINDING_SATURATION_MODELS,
  CONTINGENCY_TESTS,
  CORRECTIONS,
  CORRELATION_METHODS,
  DOSE_RESPONSE_SPECIAL_MODELS,
  ENZYME_INHIBITION_MODELS,
  MULTIPLE_T_TEST_CORRECTIONS,
  NONLINEAR_MODELS,
  NORMALITY_TESTS,
  PLOT_FUNCTION_DISTRIBUTIONS,
  POSTHOCS,
  P_VALUE_STACK_METHODS,
  RANK_POSTHOCS,
  THREE_WAY_POSTHOCS,
  TRANSFORM_FUNCTIONS,
} from "../stats/types";

/** Choice values only one family of analyses may use (M7). The merged PARAMS
 *  lists admit them all, so each runner reinterprets the other family's
 *  values: `posthoc: "dunn"` on a one-way ANOVA runs Dunnett's T3 math under
 *  a Dunn's label, `"tukey"`/`"bonferroni"` on Kruskal-Wallis or Friedman
 *  runs Dunn regardless, `method: "spline"|"lowess"` on a correlation is
 *  silently treated as Pearson. Restricted here to the list its own analysis
 *  offers (the per-analysis enums in analysis-params-schema.json): the MCP
 *  validator rejects anything else, and the file reader leaves it out so the
 *  usual default applies, with a warning. EXCEPT the pairs in
 *  LOAD_KEPT_CHOICES, whose runner already refuses a cross-family value with
 *  a clean error: the reader keeps those, so the error still reaches the
 *  user instead of a silent fallback — only the validator rejects them.
 *  Keep this table in step with every entry in the generator's
 *  ENUM_OVERRIDES (scripts/generate-analysis-params-schema.py): the MCP
 *  validator, the file reader and the generated schema must enforce the
 *  same per-analysis enums (BUG-REPORT #34). Exported so the runners read
 *  the same table instead of keeping their own copies (rem34: Monte Carlo
 *  and the mixed-effects model validate their enums against it). */
export const PARAM_CHOICES: Record<string, Record<string, readonly string[]>> = {
  anova: { posthoc: ANOVA_POSTHOCS },
  "kruskal-wallis": { posthoc: RANK_POSTHOCS },
  friedman: { posthoc: RANK_POSTHOCS },
  correlation: { method: CORRELATION_METHODS },
  "correlation-matrix": { method: CORRELATION_METHODS },
  outliers: { method: ["rout", "grubbs"] },
  // The merged `correction` list admits every family's values: survival only
  // offers holm/fdr/none, multiple-t-tests the full Prism set (seq 193).
  survival: { correction: CORRECTIONS },
  "multiple-t-tests": { correction: MULTIPLE_T_TEST_CORRECTIONS },
  // The merged `model` list admits every family's models: each runner fits
  // only its own (binding/enzyme/dose-special refuse the rest cleanly; the
  // nonlinear fitter refuses anything outside its library the same way).
  "nonlinear-regression": { model: NONLINEAR_MODELS },
  "binding-saturation": { model: BINDING_SATURATION_MODELS },
  "binding-kinetics": { model: BINDING_KINETICS_MODELS },
  "enzyme-inhibition": { model: ENZYME_INHIBITION_MODELS },
  "dose-response-special": { model: DOSE_RESPONSE_SPECIAL_MODELS },
  // The merged `test` list admits both families: the normality tests and
  // the contingency tests. A cross-family test silently ran the wrong test
  // (shapiro-wilk fell back; chi-square forced Yates' correction).
  "shapiro-wilk": { test: NORMALITY_TESTS },
  "chi-square": { test: CONTINGENCY_TESTS },
  // The merged `method` list admits every family's methods: Monte Carlo
  // only correlates (pearson/spearman); the P-value stack only adjusts.
  "monte-carlo": { method: CORRELATION_METHODS },
  "p-value-stack": { method: P_VALUE_STACK_METHODS },
  // Spline/Lowess only smooths: the merged `method` list also admits the
  // correlation, outliers and P-value-stack methods, which its runner
  // refuses cleanly ("Choose a smoothing method: Lowess or Spline"), so
  // this pair is in LOAD_KEPT_CHOICES too (BUG-REPORT #34).
  "spline-lowess": { "method": ["spline", "lowess"] },
  // Linear regression weights without 1/SD², which needs the replicate SDs
  // this runner never sees (the runner refuses it cleanly; anything else
  // outside the five reaches R as an undefined weight).
  "linear-regression": { weights: ["none", "1/y", "1/y2", "1/x", "1/x2"] },
  // Plot a function plots the fitter's library minus the user-defined
  // equation (it has no equation to plot), plus the distributions.
  "plot-function": {
    equation: [
      ...NONLINEAR_MODELS.filter((m) => m !== "user-defined"),
      ...PLOT_FUNCTION_DISTRIBUTIONS,
    ],
    // The extra series the runner can plot alongside the function — the
    // same four PARAMS already lists; kept here so PARAM_CHOICES mirrors
    // every ENUM_OVERRIDES entry (BUG-REPORT #34). The runner refuses
    // anything else cleanly, so this pair is in LOAD_KEPT_CHOICES too.
    extra: ["none", "first-derivative", "second-derivative", "integral"],
  },
  // A user-defined transform applies to the Y values only (the runner
  // refuses it as an X function, seq 341) — the formula is the Y
  // transform, so the X function is a built-in one. Mirrors the
  // generator's ENUM_OVERRIDES entry (BUG-REPORT #34); the runner
  // refuses "user-defined" cleanly, so this pair is in LOAD_KEPT_CHOICES.
  "transform-data": { xFunction: TRANSFORM_FUNCTIONS.filter((f) => f !== "user-defined") },
  // The merged `posthoc` list admits every family's comparisons: each ANOVA
  // only offers its own. A cross-family posthoc silently ran as none on
  // rm-anova; the other ANOVAs refuse it cleanly (see LOAD_KEPT_CHOICES).
  "rm-anova": { posthoc: POSTHOCS },
  "two-way-anova": { posthoc: THREE_WAY_POSTHOCS }, // same nine as three-way (POSTHOCS + dunnett + games-howell + fdr)
  "three-way-anova": { posthoc: THREE_WAY_POSTHOCS },
  "nested-anova": { posthoc: ["none", "tukey", "bonferroni"] },
  "multifactor-anova": { posthoc: ["none", "tukey", "bonferroni"] },
};
