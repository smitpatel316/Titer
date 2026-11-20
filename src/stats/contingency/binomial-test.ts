// The binomial test: two categories only, the exact test for an observed
// proportion against a theoretical one (Prism's Parts-of-whole "Compare
// observed distribution with expected", which Prism recommends over the
// chi-square whenever there are two rows). R's binom.test, whose two-sided P
// sums the probabilities of every outcome no more likely than the one
// observed — the same definition Prism uses — and whose 95% CI is the exact
// Clopper–Pearson interval. Prism reports both one- and two-tail P values;
// both one-tail P values are reported here, labelled by direction. One WebR
// round-trip returning a flat named vector.
import type { AnalysisOutcome, BinomialTestParams, Column, StatRow } from "../types";
import { readObservedCounts } from "./common";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

export async function runBinomialTest(
  columns: Column[],
  params?: BinomialTestParams,
  titles: (string | null)[] = [],
): Promise<AnalysisOutcome> {
  const read = readObservedCounts(columns, titles);
  if ("error" in read) return read;
  const { column, categories, observed } = read;
  if (observed.length !== 2)
    return {
      error:
        `The binomial test needs exactly 2 categories (rows with a count) in “${column}”; ` +
        `it holds ${observed.length}. With more than two, use the chi-square goodness-of-fit test.`,
    };
  const [k, other] = observed;
  const nonInteger = observed.find((v) => !Number.isInteger(v));
  if (nonInteger !== undefined)
    return { error: `Counts must be whole numbers; “${column}” holds ${nonInteger}.` };
  if (observed.some((v) => v < 0)) return { error: "Counts can't be negative." };
  const n = k + other;
  if (n === 0) return { error: `“${column}” is empty (all counts are zero).` };

  const p0 = params?.expectedProportion ?? 0.5;
  if (!Number.isFinite(p0) || p0 < 0 || p0 > 1)
    return { error: `The expected proportion must be between 0 and 1; it is ${p0}.` };

  const rCode =
    `bt<-binom.test(${k},${n},p=${p0});bl<-binom.test(${k},${n},p=${p0},alternative="less");` +
    `bg<-binom.test(${k},${n},p=${p0},alternative="greater");` +
    `c(two=bt$p.value,less=bl$p.value,greater=bg$p.value,lo=bt$conf.int[1],hi=bt$conf.int[2])`;
  const v = await evalNamedVector(rCode);

  const [first, second] = categories;
  const observedProportion = k / n;
  const stats: StatRow[] = [
    { label: "Number of trials (n)", value: n },
    { label: `Observed in “${first}”`, value: k },
    { label: `Expected in “${first}”`, value: n * p0 },
    { label: `Observed proportion (“${first}”)`, value: observedProportion },
    { label: "P value (two-tailed)", value: v.two ?? null, p: true },
    { label: "P value (one-tailed, fewer)", value: v.less ?? null, p: true },
    { label: "P value (one-tailed, more)", value: v.greater ?? null, p: true },
    { label: "Observed proportion 95% CI lower", value: v.lo ?? null },
    { label: "Observed proportion 95% CI upper", value: v.hi ?? null },
  ];
  const notes =
    `Binomial test (exact): ${num(k)} of ${num(n)} in “${first}” vs. ${num(other)} in “${second}”, ` +
    `against an expected proportion of ${num(p0)} for “${first}” (${num(n * p0)} expected). ` +
    `The two-tailed P value sums the probabilities of every outcome no more likely than the one observed. ` +
    `The 95% CI of the observed proportion is the exact (Clopper–Pearson) interval. ` +
    `A small P value is evidence the true proportion is not ${num(p0)}.`;

  return {
    testType: "binomial-test",
    subtitle: "Binomial test",
    stats,
    groups: [],
    notes,
  };
}
