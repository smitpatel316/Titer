// Chi-square goodness of fit: one observed distribution (a single column of
// counts, one category per row) against a theoretical distribution — equal
// for every category, or entered as expected counts or percentages (Prism's
// Parts-of-whole "Compare observed distribution with expected"). The
// statistic is Σ(O − E)²/E on k − 1 degrees of freedom, from R's
// chisq.test; the per-category table (observed, expected, contribution) is
// computed here from the same proportions, so it always adds up to the
// statistic R reports. One WebR round-trip.
import type {
  AnalysisOutcome,
  ChiSquareGofParams,
  Column,
  GoodnessOfFitCategoryRow,
  StatRow,
} from "../types";
import { readObservedCounts } from "./common";
import { evalNamedVector } from "../webr";
import { num } from "../../lib/format";

export async function runChiSquareGof(
  columns: Column[],
  params?: ChiSquareGofParams,
  titles: (string | null)[] = [],
): Promise<AnalysisOutcome> {
  const read = readObservedCounts(columns, titles);
  if ("error" in read) return read;
  const { column, categories, observed } = read;
  const k = observed.length;
  if (k < 2)
    return {
      error: `The chi-square goodness-of-fit test needs at least 2 categories (rows with a count) in “${column}”; it holds ${k}.`,
    };
  const nonInteger = observed.find((v) => !Number.isInteger(v));
  if (nonInteger !== undefined)
    return { error: `Counts must be whole numbers; “${column}” holds ${nonInteger}.` };
  if (observed.some((v) => v < 0)) return { error: "Counts can't be negative." };
  const total = observed.reduce((a, v) => a + v, 0);
  if (total === 0) return { error: `“${column}” is empty (all counts are zero).` };

  const mode = params?.expectedMode ?? "equal";
  const given = params?.expectedValues;
  let proportions: number[];
  let expectedNote: string;
  if (mode === "equal") {
    proportions = observed.map(() => 1 / k);
    expectedNote = `equal for every category (${num(total / k)} expected in each)`;
  } else {
    if (!given || !given.length)
      return {
        error:
          `Enter the expected values, one per category (${k} in “${column}”), as ` +
          `${mode === "counts" ? "counts" : "percentages"} — or choose equal proportions for every category.`,
      };
    if (given.length !== k)
      return {
        error:
          `The expected values don't match the categories: ${given.length} given for ${k} categories ` +
          `in “${column}”. Enter one per category, in row order.`,
      };
    if (given.some((v) => !Number.isFinite(v)))
      return { error: "The expected values must all be numbers." };
    if (given.some((v) => v <= 0))
      return {
        error:
          `Every expected value must be above 0 — a category the theory says never occurs can't be ` +
          `tested this way. Drop that row, or give it a positive expectation.`,
      };
    const sum = given.reduce((a, v) => a + v, 0);
    if (mode === "counts") {
      // Prism requires the expected counts to total the observed total.
      if (Math.abs(sum - total) > 1e-9 * Math.max(1, total))
        return {
          error:
            `The expected counts add up to ${num(sum)}, but the observed counts add up to ${num(total)} — ` +
            `they must be the same. (Percentages, which must add up to 100, are the other way to enter them.)`,
        };
      proportions = given.map((v) => v / total);
      expectedNote = "as entered (expected counts)";
    } else {
      // Percentages: Prism requires 100. A hair under or over (33.33 × 3)
      // is a typing artefact, so within 0.01 the proportions are taken from
      // the entered values as given, renormalised to sum to 1.
      if (Math.abs(sum - 100) > 0.01)
        return {
          error: `The expected percentages add up to ${num(sum)}% — they must add up to 100%.`,
        };
      proportions = given.map((v) => v / sum);
      expectedNote = "as entered (expected percentages)";
    }
  }

  const rCode =
    `x<-c(${observed.join(",")});ct<-suppressWarnings(chisq.test(x,p=c(${proportions.join(",")})));` +
    `c(chisq=as.numeric(ct$statistic),df=as.numeric(ct$parameter),p=ct$p.value)`;
  const v = await evalNamedVector(rCode);

  const expected = proportions.map((p) => total * p);
  const gofCategories: GoodnessOfFitCategoryRow[] = categories.map((category, i) => ({
    category,
    observed: observed[i],
    expected: expected[i],
    contribution: (observed[i] - expected[i]) ** 2 / expected[i],
  }));
  const lowExpected = expected.filter((e) => e < 5).length;
  const stats: StatRow[] = [
    { label: "Chi-square", value: v.chisq ?? null },
    { label: "df", value: v.df ?? null },
    { label: "P value", value: v.p ?? null, p: true },
  ];
  const notes =
    `Chi-square goodness-of-fit test: the observed counts in “${column}” (${k} categories, N = ${num(total)}) ` +
    `against the expected distribution, ${expectedNote}. The null hypothesis is that the observed counts were ` +
    `sampled from a population with the expected frequencies; a small P value is evidence they were not. ` +
    (lowExpected > 0
      ? `Warning: ${lowExpected} of ${k} ${lowExpected === 1 ? "category expects" : "categories expect"} fewer than 5, ` +
        `so the chi-square approximation may be unreliable — consider combining categories.`
      : `Every category expects 5 or more, so the chi-square approximation is sound.`) +
    (k === 2
      ? ` With only two categories, the binomial test is the exact test for this comparison — the chi-square here is only an approximation.`
      : "");

  return {
    testType: "chi-square-gof",
    subtitle: "Chi-square goodness of fit",
    stats,
    groups: [],
    gofCategories,
    notes,
  };
}
