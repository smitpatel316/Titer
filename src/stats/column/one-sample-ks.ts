// One-sample Kolmogorov–Smirnov test (seq 170) — compare each column
// against a theoretical distribution: base R ks.test(x, <cdf>, ...).
// Prism offers the one-sample KS only as its normality test (a Normal
// reference with the mean and SD estimated from the sample — Titer's
// "shapiro-wilk" analysis already has that as its "kolmogorov-smirnov"
// option); this is the standalone test, against a distribution the user
// chooses, with parameters either entered in advance (the classical test —
// the reference must be fully specified) or estimated from the sample
// (then the P value is approximate and anti-conservative, and the notes
// say so). D is the largest absolute difference between the sample's
// cumulative distribution and the reference's; R's P value is the
// asymptotic Kolmogorov distribution, as in the two-sample test.
import type { OneSampleKsDistribution, OneSampleKsParams } from "../types";
import { TAILS } from "../types";
import { declareGroups, identical, pRow, rAlt, type ColumnTestSpec, type Group } from "./base";

const DISTRIBUTIONS: OneSampleKsDistribution[] = ["normal", "lognormal", "exponential", "uniform"];
const CDF: Record<OneSampleKsDistribution, string> = {
  normal: "pnorm",
  lognormal: "plnorm",
  exponential: "pexp",
  uniform: "punif",
};
const DIST_LABEL: Record<OneSampleKsDistribution, string> = {
  normal: "Normal",
  lognormal: "Lognormal",
  exponential: "Exponential",
  uniform: "Uniform",
};

/** The params resolved: an unknown `distribution` falls back to Normal, an
 *  unknown `paramsFrom` to "estimated", unknown tails to two-sided, and each
 *  specified parameter to its standard value (Normal 0/1, Lognormal 0/1,
 *  Exponential rate 1, Uniform 0–1). */
export interface ResolvedOneSampleKsParams {
  distribution: OneSampleKsDistribution;
  paramsFrom: "specified" | "estimated";
  tails: (typeof TAILS)[number];
  mean: number;
  sd: number;
  meanlog: number;
  sdlog: number;
  rate: number;
  min: number;
  max: number;
}
const DEFAULTS: OneSampleKsParams = { distribution: "normal", paramsFrom: "estimated", tails: "two-sided" };
export const resolveOneSampleKsParams = (params: OneSampleKsParams | undefined): ResolvedOneSampleKsParams => {
  const p = { ...DEFAULTS, ...params };
  return {
    distribution: DISTRIBUTIONS.includes(p.distribution) ? p.distribution : "normal",
    paramsFrom: p.paramsFrom === "specified" ? "specified" : "estimated",
    tails: (TAILS as readonly string[]).includes(p.tails) ? p.tails : "two-sided",
    mean: p.mean ?? 0,
    sd: p.sd ?? 1,
    meanlog: p.meanlog ?? 0,
    sdlog: p.sdlog ?? 1,
    rate: p.rate ?? 1,
    min: p.min ?? 0,
    max: p.max ?? 1,
  };
};

/** The distribution's parameters as R expressions, per group: the entered
 *  values in specified mode, the sample's estimates in estimated mode
 *  (Normal: mean/SD; Lognormal: mean/SD of the logarithms; Exponential:
 *  1/mean; Uniform: the sample's min/max). */
const paramArgs = (p: ResolvedOneSampleKsParams, i: number): string => {
  if (p.paramsFrom === "specified") {
    switch (p.distribution) {
      case "normal":
        return `${p.mean},${p.sd}`;
      case "lognormal":
        return `${p.meanlog},${p.sdlog}`;
      case "exponential":
        return `${p.rate}`;
      case "uniform":
        return `${p.min},${p.max}`;
    }
  }
  switch (p.distribution) {
    case "normal":
      return `mean(g${i}),sd(g${i})`;
    case "lognormal":
      return `mean(log(g${i})),sd(log(g${i}))`;
    case "exponential":
      return `1/mean(g${i})`;
    case "uniform":
      return `min(g${i}),max(g${i})`;
  }
};

/** A value appearing more than once in a group: R then warns and falls back
 *  to the asymptotic P value. */
const hasTies = (g: Group) => new Set(g.values).size < g.values.length;

const meanOf = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length;
const sdOf = (values: number[]) => {
  const m = meanOf(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
};

/** The estimated parameters, as the notes state them — the same estimates R
 *  computes above, in TypeScript. */
const estimatedParams = (p: ResolvedOneSampleKsParams, g: Group): string => {
  switch (p.distribution) {
    case "normal":
      return `mean ${meanOf(g.values)} and SD ${sdOf(g.values)}`;
    case "lognormal": {
      const logs = g.values.map(Math.log);
      return `mean of the logarithms ${meanOf(logs)} and SD of the logarithms ${sdOf(logs)}`;
    }
    case "exponential":
      return `rate ${1 / meanOf(g.values)}`;
    case "uniform":
      return `from ${Math.min(...g.values)} to ${Math.max(...g.values)}`;
  }
};

/** The specified parameters, as the notes state them. */
const specifiedParams = (p: ResolvedOneSampleKsParams): string => {
  switch (p.distribution) {
    case "normal":
      return `mean ${p.mean} and SD ${p.sd}`;
    case "lognormal":
      return `mean of the logarithms ${p.meanlog} and SD of the logarithms ${p.sdlog}`;
    case "exponential":
      return `rate ${p.rate}`;
    case "uniform":
      return `from ${p.min} to ${p.max}`;
  }
};

export const oneSampleKsSpec: ColumnTestSpec<OneSampleKsParams> = {
  testType: "one-sample-ks",
  minGroups: 1,
  minValues: 2,
  check: (_, params) => {
    const p = resolveOneSampleKsParams(params);
    if (p.paramsFrom !== "specified") return undefined;
    const bad = (s: string) => `${s} — check the entered parameters.`;
    if (!Number.isFinite(p.mean) || !Number.isFinite(p.sd) || !Number.isFinite(p.meanlog) || !Number.isFinite(p.sdlog) ||
        !Number.isFinite(p.rate) || !Number.isFinite(p.min) || !Number.isFinite(p.max))
      return bad("A distribution parameter is not a finite number");
    switch (p.distribution) {
      case "normal":
        return p.sd > 0 ? undefined : bad("A Normal distribution needs an SD above 0, not " + p.sd);
      case "lognormal":
        return p.sdlog > 0 ? undefined : bad("A Lognormal distribution needs an SD of the logarithms above 0, not " + p.sdlog);
      case "exponential":
        return p.rate > 0 ? undefined : bad("An Exponential distribution needs a rate above 0, not " + p.rate);
      case "uniform":
        return p.max > p.min ? undefined : bad(`A Uniform distribution needs its maximum above its minimum, not ${p.min} to ${p.max}`);
    }
  },
  checkGroups: (groups, params) => {
    const p = resolveOneSampleKsParams(params);
    for (const g of groups) {
      if (p.distribution === "lognormal") {
        const bad = g.values.find((v) => v <= 0);
        if (bad !== undefined)
          return `A Lognormal distribution needs values above 0 (log is undefined at or below zero) — “${g.name}” holds ${bad}.`;
      }
      if (p.paramsFrom === "estimated" && identical(g.values))
        return `“${g.name}”'s values are all identical: the ${DIST_LABEL[p.distribution]} distribution's parameters can't be estimated from them. Enter the parameters instead.`;
    }
  },
  rCode: (groups, params) => {
    const p = resolveOneSampleKsParams(params);
    const alt = rAlt(p.tails);
    const stmts = groups.map(
      (_, i) =>
        `ks${i}<-suppressWarnings(ks.test(g${i},"${CDF[p.distribution]}",${paramArgs(p, i)},alternative="${alt}"))`,
    );
    const vals = groups.map((_, i) => `D${i}=unname(ks${i}$statistic),p${i}=ks${i}$p.value`);
    return `${declareGroups(groups)};${stmts.join(";")};c(${vals.join(",")})`;
  },
  rows: (v, groups) =>
    groups.flatMap((g, i) => [
      { label: `${g.name} — KS distance D`, value: v[`D${i}`] },
      pRow(`${g.name} — P value`, v[`p${i}`]),
      { label: `${g.name} — N`, value: g.n },
    ]),
  notes: (params, groups) => {
    const p = resolveOneSampleKsParams(params);
    const tail = p.tails === "two-sided" ? "Two-tailed P value." : "One-tailed P value.";
    const article = p.distribution === "exponential" ? "an" : "a";
    const parts = [
      `Compares each column's cumulative distribution with ${article} ${DIST_LABEL[p.distribution]} distribution ` +
        `(${p.paramsFrom === "estimated" ? "parameters estimated from the sample" : "parameters as entered"}). ` +
        `D is the largest absolute difference between the two cumulative distributions. ${tail}`,
    ];
    if (groups.length === 1) {
      const g = groups[0];
      parts.push(
        `The ${DIST_LABEL[p.distribution]} distribution used for “${g.name}”: ` +
          (p.paramsFrom === "estimated" ? estimatedParams(p, g) + " (estimated from the sample)." : specifiedParams(p) + " (as entered)."),
      );
    } else {
      parts.push(
        `Parameters ${p.paramsFrom === "estimated" ? "estimated from each sample" : "as entered"}: ` +
          (p.paramsFrom === "estimated"
            ? groups.map((g) => `“${g.name}”: ${estimatedParams(p, g)}`).join("; ") + "."
            : specifiedParams(p) + "."),
      );
    }
    if (p.paramsFrom === "estimated")
      parts.push(
        "The parameters were estimated from the same sample being tested, so the P value is approximate " +
          "(anti-conservative — the proper test with estimated parameters is Lilliefors); " +
          "for a fully specified reference distribution, enter the parameters instead.",
      );
    const tied = groups.filter(hasTies).map((g) => `“${g.name}”`);
    if (tied.length)
      parts.push(
        `Tied values present (${tied.join(", ")}) — the test loses power with many ties, and the P value is asymptotic, not exact.`,
      );
    parts.push(
      "KS is most sensitive near the centre of the distribution and weak in the tails — " +
        "a non-significant result on a small sample is weak evidence that the data follow the distribution.",
    );
    return parts.join(" ");
  },
  subtitle: (params) =>
    `One-sample Kolmogorov–Smirnov test (vs. ${DIST_LABEL[resolveOneSampleKsParams(params).distribution]} distribution)`,
};
