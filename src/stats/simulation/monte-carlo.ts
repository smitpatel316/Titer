// Monte Carlo (plan 22, sub-task b): repeat a chosen analysis `repeats`
// times on simulated data and summarise the chosen statistic — its mean, SD,
// 95% percentile interval, and (for a P value) the share of repeats with
// P < 0.05, i.e. the estimated power.
//
// How the repeats run — the plan's 10,000-repeat power case, done naively
// (one webR round-trip per repeat), takes ~5 minutes (measured Nov 10:
// ~29 ms per repeat). So the whole loop runs INSIDE R in one call:
// `replicate()` draws every repeat and computes its statistic, and the one
// `evalNumericVector` call returns the observed statistic (on the real data)
// followed by the `repeats` simulated ones. The simulated datasets are
// transient — they never become tables, and nothing here touches the
// `runAnalysis` cache. The binding constraint is time, not vector size:
// 10,000 two-sample t-tests take ~15–25 s in webR (measured Nov 11), so
// `repeats` caps at 10,000 and the repeats × values-per-repeat guard below
// is a sanity check, not the plan's literal 200,000 cap (that cap assumed
// one round-trip per repeat returning all simulated values; the in-R loop
// returns only repeats + 1 numbers).
import type {
  AnalysisOutcome,
  Column,
  MonteCarloParams,
  MonteCarloSimulationDistribution,
  MonteCarloStatistic,
  MonteCarloTarget,
  StatRow,
} from "../types";
import { CORRELATION_METHODS, MONTE_CARLO_REPEATS, MONTE_CARLO_TARGET_STATISTICS, TAILS } from "../types";
import { PARAM_CHOICES } from "../../lib/param-choices";
import { dataGroups, describe, rAlt } from "../column/base";
import { evalNumericVector } from "../webr";
import { computeFrequencyBins } from "../column/frequency-distribution";
import { splitXY, xyPoints } from "../../lib/dataset";

/** The paired differences of two columns (seq 204): one per row holding a
 *  value in both, in row order. A row missing either value holds no pair
 *  and is left out — a paired test runs on the pairs, never on mismatched
 *  rows. */
export function pairedDifferences(
  a: { byRow: (number | null)[] },
  b: { byRow: (number | null)[] },
): number[] {
  const out: number[] = [];
  for (let r = 0; r < Math.max(a.byRow.length, b.byRow.length); r++) {
    const x = a.byRow[r];
    const y = b.byRow[r];
    if (x != null && y != null) out.push(x - y);
  }
  return out;
}

/** Sanity guard on repeats × values drawn per repeat (see the header note):
 *  far above anything a 10,000-repeat run needs (10,000 × 200), far below
 *  anything that would strain R. */
export const MONTE_CARLO_MAX_SIMULATED = 2_000_000;

/** The R code a Monte Carlo run is: `set.seed()` once, then one
 *  `replicate()` that draws every repeat and its statistic, plus the same
 *  statistic on the observed data — returned as one vector, the observed
 *  value first. Pure — unit-tested without R. */
export interface MonteCarloCodeSpec {
  target: MonteCarloTarget;
  statistic: MonteCarloStatistic;
  repeats: number;
  seed: number;
  /** One entry per simulated group: how many values, and from which distribution. */
  groups: { n: number; mean: number; sd: number; observed: number[] }[];
  /** X values (XY targets): fixed across repeats. */
  x?: number[];
  equalVariance?: boolean;
  hypotheticalValue?: number;
  method?: "pearson" | "spearman";
  /** One- vs two-sided P value (t-test targets, seq 204): R's alternative. */
  alternative?: "two.sided" | "less" | "greater";
  /** What distribution the simulated values come from (seq 204). */
  simulationDistribution?: MonteCarloSimulationDistribution;
  /** Degrees of freedom for a t simulation (seq 204). */
  simulationDf?: number;
}

/** A number as R reads it, without floating-point tail noise: 12
 *  significant digits is exact for every value a wizard or a file can
 *  hold, and keeps the generated code readable. */
const fmt = (v: number): string => String(Number(v.toPrecision(12)));

export function monteCarloRCode(spec: MonteCarloCodeSpec): string {
  // A t draw is scaled so the simulated values have the SD asked for: a
  // t with df degrees of freedom has SD √(df/(df−2)), so the draw is
  // mean + sd/√(df/(df−2)) · rt(n, df). At df ≤ 2 the t has no finite SD
  // and the runner refuses the run before this is reached.
  const draw = (g: { n: number; mean: number; sd: number }) =>
    spec.simulationDistribution === "t"
      ? `${fmt(g.mean)}+${fmt(g.sd / Math.sqrt((spec.simulationDf ?? 5) / ((spec.simulationDf ?? 5) - 2)))}*rt(${g.n},${fmt(spec.simulationDf ?? 5)})`
      : `rnorm(${g.n},${g.mean},${g.sd})`;
  const obs = (i: number) => `c(${spec.groups[i].observed.join(",")})`;
  const alt =
    spec.alternative && spec.alternative !== "two.sided" ? `,alternative="${spec.alternative}"` : "";
  // The statistic as R computes it, from the drawn values (`g1`, `g2`…) or
  // the observed ones (`o1`, `o2`…) — one expression shape per target.
  // Paired-t repeats the t test on the simulated differences, so it shares
  // the one-sample-t form (its one group IS the differences). One-way
  // ANOVA stacks its groups into one vector + a factor and runs
  // oneway.test on it — the repeat and the observed both need the braced
  // block, whose last value is the statistic.
  const stat = (v: string[], isRepeat: boolean): string => {
    switch (spec.target) {
      case "compare-two-groups": {
        const eq = spec.equalVariance !== false ? "var.equal=TRUE" : "var.equal=FALSE";
        return spec.statistic === "Mean difference"
          ? `mean(${v[0]})-mean(${v[1]})`
          : `t.test(${v[0]},${v[1]},${eq}${alt})$p.value`;
      }
      case "one-sample-t":
      case "paired-t":
        return spec.statistic === "Mean difference" || spec.statistic === "Mean"
          ? `mean(${v[0]})`
          : `t.test(${v[0]},mu=${spec.hypotheticalValue ?? 0}${alt})$p.value`;
      case "descriptive-statistics":
        return `mean(${v[0]})`;
      case "linear-regression":
        return spec.statistic === "Y-intercept"
          ? `coef(lm(${v[0]}~x))[1]`
          : `coef(lm(${v[0]}~x))[2]`;
      case "correlation":
        return `cor(x,${v[0]},method=${JSON.stringify(spec.method ?? "pearson")})`;
      case "one-way-anova": {
        const ns = spec.groups.map((g) => g.n).join(",");
        // The repeat runs inside replicate's function, so its `v`/`grp`
        // are local to each repeat — but the observed block runs at the
        // top level, after the replicate, so it must use different names
        // (`ov`/`ogrp`) or it would overwrite the repeats in `v` before
        // `c(o,v)` reads them.
        const block = (vs: string[], vec: string, grp: string) =>
          `{${vec}<-c(${vs.join(",")});${grp}<-factor(rep(1:${vs.length},c(${ns})));oneway.test(${vec}~${grp},var.equal=TRUE)${spec.statistic === "F" ? "$statistic" : "$p.value"}}`;
        return isRepeat ? block(v, "v", "grp") : block(v, "ov", "ogrp");
      }
    }
  };
  const draws = spec.groups.map((g) => draw(g));
  const repeat = stat(draws, true);
  const observed = stat(
    spec.groups.map((_, i) => obs(i)),
    false,
  );
  const xDecl = spec.x !== undefined ? `x<-c(${spec.x.join(",")});` : "";
  return `set.seed(${spec.seed});${xDecl}v<-replicate(${spec.repeats},${repeat});o<-${observed};c(o,v)`;
}

/** A percentile by linear interpolation (R's default, type 7): `sorted` must
 *  already be ascending. */
export function percentile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

const meanOf = (values: number[]): number => values.reduce((s, v) => s + v, 0) / values.length;
const sdOf = (values: number[], mean: number): number | null =>
  values.length > 1
    ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1))
    : null;

/** The simulated mean/SD of one group: the wizard's override when given, else
 *  the group's observed mean/SD (a parametric bootstrap). */
function simulatedParams(
  values: number[],
  meanOverride: number | undefined,
  sdOverride: number | undefined,
): { mean: number; sd: number } | { error: string } {
  const mean = meanOverride ?? meanOf(values);
  const sd = sdOverride ?? sdOf(values, meanOf(values));
  if (!Number.isFinite(mean)) return { error: "A group's simulated mean is not a number." };
  if (sd == null || !Number.isFinite(sd) || sd <= 0)
    return { error: "A group's simulated SD must be greater than 0 — a group with no variation cannot be simulated." };
  return { mean, sd };
}

export async function runMonteCarlo(
  columns: Column[],
  params: MonteCarloParams | undefined,
): Promise<AnalysisOutcome> {
  const target = params?.targetAnalysis;
  if (!target || !(MONTE_CARLO_TARGET_STATISTICS as Record<string, readonly string[]>)[target]) {
    return { error: "Monte Carlo needs a target analysis to repeat — pick one and try again." };
  }
  const statistic: MonteCarloStatistic =
    (params?.summaryStatistic as MonteCarloStatistic | undefined) ?? MONTE_CARLO_TARGET_STATISTICS[target][0];
  if (!MONTE_CARLO_TARGET_STATISTICS[target].includes(statistic)) {
    return { error: `“${statistic}” is not a statistic “${target}” reports — pick one it does and try again.` };
  }
  // Tails (seq 204): the P-value tails for the t-test targets. Other
  // targets ignore it, as they ignore the other targets' options.
  const tails = params?.tails ?? "two-sided";
  if (!(TAILS as readonly string[]).includes(tails)) {
    return { error: `“${tails}” is not a tails choice — use “two-sided”, “less” or “greater”.` };
  }
  // The correlation method (BUG-REPORT #34): only the correlation target
  // reads it, and R's cor() knows just pearson/spearman — a cross-family
  // value (e.g. "bonferroni") used to reach R and fail opaquely there.
  // Validated against the shared PARAM_CHOICES table (rem34), the same
  // table validateAnalysisParams narrows against, so the runner and the
  // validator cannot drift apart.
  const method = params?.method;
  const monteCarloMethods = PARAM_CHOICES["monte-carlo"]?.method ?? CORRELATION_METHODS;
  if (method !== undefined && !monteCarloMethods.includes(method)) {
    return { error: `“${method}” is not a correlation method — use “pearson” or “spearman”.` };
  }
  // The simulation distribution (seq 204): Gaussian, or Student's t with
  // df degrees of freedom. At df ≤ 2 the t has no finite SD, so the SD
  // the wizard asks for would be meaningless — refuse, don't simulate.
  const simulationDistribution = params?.simulationDistribution ?? "gaussian";
  if (simulationDistribution !== "gaussian" && simulationDistribution !== "t") {
    return { error: `“${simulationDistribution}” is not a simulation distribution — use “gaussian” or “t”.` };
  }
  const simulationDf = params?.simulationDf ?? 5;
  if (simulationDistribution === "t" && (!Number.isFinite(simulationDf) || simulationDf <= 2)) {
    return {
      error:
        "The t simulation needs degrees of freedom greater than 2 — at df ≤ 2 the t distribution has no finite SD to simulate from.",
    };
  }
  const repeats = params?.repeats ?? 1000;
  if (!Number.isInteger(repeats) || repeats < MONTE_CARLO_REPEATS.min || repeats > MONTE_CARLO_REPEATS.max) {
    return {
      error: `Repeats must be a whole number from ${MONTE_CARLO_REPEATS.min} to ${MONTE_CARLO_REPEATS.max}.`,
    };
  }
  if (!Number.isInteger(params?.seed)) return { error: "The seed must be a whole number." };

  // The groups the repeats simulate: Column targets simulate each data
  // column (compare-two-groups uses the first two — the wizard's `sets`
  // already narrowed them); XY targets simulate the chosen Y series at the
  // source table's X values.
  const groups: { name: string; values: number[] }[] = [];
  let x: number[] | undefined;
  if (target === "linear-regression" || target === "correlation") {
    const { x: xCol, ys } = splitXY(columns);
    const y = params?.y !== undefined ? ys.find((c) => c.name === params.y) : ys[0];
    if (!xCol || !y) return { error: "Monte Carlo needs an X column and a Y data set with values." };
    const pairs = xyPoints(xCol, y);
    if (pairs.x.length < 3) {
      return { error: "Monte Carlo needs at least 3 complete X–Y pairs to repeat a regression or correlation." };
    }
    // A constant X has no slope or correlation to repeat: lm() / cor() on
    // it return NA, which the run below would only report as the generic
    // "did not return the expected values" error. Name the cause instead.
    if (new Set(pairs.x).size < 2) {
      return {
        error:
          "Monte Carlo needs at least 2 different X values to repeat a regression or correlation — all X values are the same, so the slope / correlation is undefined.",
      };
    }
    x = pairs.x;
    groups.push({ name: y.name, values: pairs.y });
  } else {
    const data = dataGroups(columns);
    // How many groups the target repeats: two for the two-group tests,
    // one for the single-group ones, every chosen group for one-way ANOVA.
    const wanted =
      target === "compare-two-groups" || target === "paired-t"
        ? 2
        : target === "one-way-anova"
          ? undefined
          : 1;
    // `sets` rides on AnalysisParams (the DataSetsParam half of the union),
    // not on MonteCarloParams itself.
    const sets = (params as MonteCarloParams & { sets?: string[] } | undefined)?.sets;
    const picked = (sets?.length
      ? sets
          .map((name) => data.find((c) => c.name === name))
          .filter((c): c is Column => c !== undefined)
      : data
    ).slice(0, wanted);
    const need = wanted ?? 2;
    if (picked.length < need) {
      return {
        error:
          target === "compare-two-groups"
            ? "Monte Carlo needs 2 data sets with values to repeat a two-group comparison."
            : target === "paired-t"
              ? "Monte Carlo needs 2 data sets with values to repeat a paired t test."
              : target === "one-way-anova"
                ? "Monte Carlo needs at least 2 data sets with values to repeat a one-way ANOVA."
                : "Monte Carlo needs a data set with values to repeat.",
      };
    }
    if (target === "paired-t") {
      // The repeats simulate the paired differences, not the two columns
      // separately — drawing the columns independently would destroy the
      // pairing and the simulated differences would carry the wrong SD.
      const diffs = pairedDifferences(picked[0], picked[1]);
      if (diffs.length < 2) {
        return {
          error:
            "Monte Carlo needs at least 2 paired rows — rows where both data sets hold a value — to repeat a paired t test.",
        };
      }
      groups.push({ name: `Difference (${picked[0].name} − ${picked[1].name})`, values: diffs });
    } else {
      for (const c of picked) groups.push({ name: c.name, values: c.values });
    }
  }
  for (const g of groups) {
    if (g.values.length < 2) {
      return { error: `“${g.name}” has fewer than 2 values — Monte Carlo needs at least 2 per data set.` };
    }
  }
  // One-way ANOVA on groups with no scatter within them has nothing to
  // compare against — name it, as the ANOVA itself does, instead of
  // letting R return a NaN the run below would only report generically.
  if (target === "one-way-anova" && groups.every((g) => g.values.every((v) => v === g.values[0]))) {
    return { error: "Each group's values are identical: there is no scatter within the groups to compare them on." };
  }
  const perRepeat = groups.reduce((s, g) => s + g.values.length, 0);
  if (repeats * perRepeat > MONTE_CARLO_MAX_SIMULATED) {
    return {
      error: `That is ${repeats} repeats × ${perRepeat} values per repeat — at most ${MONTE_CARLO_MAX_SIMULATED} simulated values. Use fewer repeats.`,
    };
  }
  const simulated: { n: number; mean: number; sd: number; observed: number[] }[] = [];
  for (const g of groups) {
    // Paired-t simulates the differences, so its overrides are the
    // difference mean/SD — not the per-column groupMeans/groupSds.
    const p =
      target === "paired-t"
        ? simulatedParams(g.values, params?.differenceMean, params?.differenceSd)
        : simulatedParams(g.values, params?.groupMeans?.[g.name], params?.groupSds?.[g.name]);
    if ("error" in p) return p;
    simulated.push({ n: g.values.length, mean: p.mean, sd: p.sd, observed: g.values });
  }

  const all = await evalNumericVector(
    monteCarloRCode({
      target,
      statistic,
      repeats,
      seed: params!.seed,
      groups: simulated,
      x,
      equalVariance: params?.equalVariance,
      hypotheticalValue: params?.hypotheticalValue,
      method,
      alternative: rAlt(tails),
      simulationDistribution,
      simulationDf,
    }),
  );
  if (all.length !== repeats + 1 || all.some((v) => !Number.isFinite(v))) {
    return { error: "The Monte Carlo run did not return the expected values — try again." };
  }
  const observed = all[0];
  const values = all.slice(1);
  const sorted = [...values].sort((a, b) => a - b);
  const mean = meanOf(values);
  const sd = sdOf(values, mean);
  const ciLow = percentile(sorted, 0.025);
  const ciHigh = percentile(sorted, 0.975);
  const proportionSignificant =
    statistic === "P value" ? values.filter((v) => v < 0.05).length / values.length : undefined;
  const { bins } = computeFrequencyBins(values, { binMode: "auto" });
  const { groups: described } = await describe(groups.map((g) => ({ name: g.name, values: g.values })));

  const targetLabel =
    target === "compare-two-groups"
      ? "Compare two groups"
      : target === "one-sample-t"
        ? "Compare one group to a value"
        : target === "descriptive-statistics"
          ? "Descriptive statistics"
          : target === "linear-regression"
            ? "Linear regression"
            : target === "paired-t"
              ? "Paired t test"
              : target === "one-way-anova"
                ? "One-way ANOVA"
                : "Correlation";
  const stats: StatRow[] = [
    { label: "Repeats completed", value: repeats },
    { label: `Mean of ${statistic}`, value: mean },
    { label: `SD of ${statistic}`, value: sd },
    { label: "2.5th percentile", value: ciLow },
    { label: "97.5th percentile", value: ciHigh },
    ...(proportionSignificant !== undefined
      ? [{ label: "Power (% P < 0.05)", value: proportionSignificant * 100 }]
      : []),
    { label: "Observed (real data)", value: observed },
    { label: "Seed", value: params!.seed },
  ];
  const simNote = simulated
    .map((s, i) => `“${groups[i].name}”: n = ${s.n}, simulated mean ${s.mean}, SD ${s.sd}`)
    .join("; ");
  const isTTarget = target === "compare-two-groups" || target === "one-sample-t" || target === "paired-t";
  const tailsNote =
    statistic === "P value" && isTTarget
      ? `Tails are ${tails === "two-sided" ? "two-sided" : `one-sided (${tails})`}. `
      : "";
  const simDistNote =
    simulationDistribution === "t"
      ? `Student's t with ${simulationDf} degrees of freedom`
      : "Gaussian";
  const notes =
    `Repeated “${targetLabel}” ${repeats} times on simulated data (seed ${params!.seed}), summarising the ${statistic}. ` +
    `Each repeat drew ${simNote}. ` +
    `The 95% interval is the 2.5th–97.5th percentiles of the ${repeats} simulated ${statistic}s. ` +
    (proportionSignificant !== undefined
      ? `Power is the share of repeats with P < 0.05 — the chance this design detects the simulated effect. `
      : "") +
    `The observed ${statistic} on the real data is ${observed}. ` +
    `${tailsNote}The simulation is ${simDistNote} (each group's mean/SD as simulated, or its observed mean/SD when not set).`;
  return {
    testType: "monte-carlo",
    subtitle: `Monte Carlo simulation — ${statistic}`,
    stats,
    groups: described,
    notes,
    monteCarlo: {
      repeats,
      statistic,
      mean,
      sd,
      ciLow,
      ciHigh,
      ...(proportionSignificant !== undefined ? { proportionSignificant } : {}),
      observed,
      bins: { edges: bins.map((b) => b.lower).concat(bins.at(-1)?.upper ?? []), counts: bins.map((b) => b.count) },
    },
  };
}
