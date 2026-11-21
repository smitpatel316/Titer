// "Transform data" (Prism's Transform: Analyse → Transform) — apply one
// function to every value of the chosen columns and report the transformed
// values as a results sheet. The source table is never changed: Prism
// creates a new results table, and so does this runner — the transformed
// values live in the result's `transformed` tables only.
//
// Functions are Prism's documented standard set (Prism 8 User Guide,
// "Transform data"): log10, ln, log2, sqrt, reciprocal (1/Y), exp, square —
// plus Prism's arithmetic transforms (seq 205): Y+K, Y−K, Y×K, Y/K, K−Y, K/Y,
// which apply a constant K to every value. Pure TypeScript, no R for the
// values themselves; the transformed groups' descriptives come from `describe`
// (R), like every other analysis.
//
// A value the function is undefined for — log of ≤ 0, square root of a
// negative, reciprocal of 0, an exp/square that overflows — is left blank
// (null) in the results and counted in `excluded`, never NaN or Infinity:
// Prism likewise returns blank for invalid inputs. The notes name the
// reason per column, so a blank is never silent.
import type { AnalysisOutcome, Column, GroupDescriptives, TransformFunction } from "../types";
import { dataGroups, describe } from "./base";
import { TRANSFORM_ARITHMETIC_FUNCTIONS } from "../types";

/** Whether a function is one of the arithmetic ones (needs a constant K). */
export const isArithmeticTransform = (fn: TransformFunction): boolean =>
  (TRANSFORM_ARITHMETIC_FUNCTIONS as readonly string[]).includes(fn);

/** How each function is written in the results (and in the wizard's labels). */
export const TRANSFORM_LABEL: Record<TransformFunction, string> = {
  log10: "log10(Y)",
  ln: "ln(Y)",
  log2: "log2(Y)",
  sqrt: "sqrt(Y)",
  reciprocal: "1/Y",
  exp: "exp(Y)",
  square: "Y²",
  "y-plus-k": "Y+K",
  "y-minus-k": "Y−K",
  "y-times-k": "Y×K",
  "y-divided-by-k": "Y/K",
  "k-minus-y": "K−Y",
  "k-divided-by-y": "K/Y",
};

/** Why a value of this function is left blank, for the notes. */
const EXCLUDED_REASON: Record<TransformFunction, string> = {
  log10: "log10 is undefined for values ≤ 0",
  ln: "ln is undefined for values ≤ 0",
  log2: "log2 is undefined for values ≤ 0",
  sqrt: "the square root is undefined for negative values",
  reciprocal: "the reciprocal is undefined for 0",
  exp: "exp overflowed (the result is too large)",
  square: "squaring overflowed (the result is too large)",
  "y-plus-k": "adding overflowed (the result is too large)",
  "y-minus-k": "subtracting overflowed (the result is too large)",
  "y-times-k": "multiplying overflowed (the result is too large)",
  "y-divided-by-k": "dividing overflowed (the result is too large)",
  "k-minus-y": "subtracting overflowed (the result is too large)",
  "k-divided-by-y": "K/Y is undefined for values of 0",
};

/** One value transformed, or null when the function is undefined for it
 *  (or the input is not finite). Null is a blank in the results, never NaN.
 *  `constant` is the K of the arithmetic functions — required for those. */
export function transformValue(fn: TransformFunction, value: number, constant?: number): number | null {
  if (!Number.isFinite(value)) return null;
  // An arithmetic function without its constant has nothing to apply — blank,
  // never NaN. The runner refuses such a run outright; this is the backstop.
  if (isArithmeticTransform(fn) && !Number.isFinite(constant)) return null;
  let out: number;
  switch (fn) {
    case "log10":
      if (value <= 0) return null;
      out = Math.log10(value);
      break;
    case "ln":
      if (value <= 0) return null;
      out = Math.log(value);
      break;
    case "log2":
      if (value <= 0) return null;
      out = Math.log2(value);
      break;
    case "sqrt":
      if (value < 0) return null;
      out = Math.sqrt(value);
      break;
    case "reciprocal":
      if (value === 0) return null;
      out = 1 / value;
      break;
    case "exp":
      out = Math.exp(value);
      break;
    case "square":
      out = value * value;
      break;
    case "y-plus-k":
      out = value + constant!;
      break;
    case "y-minus-k":
      out = value - constant!;
      break;
    case "y-times-k":
      out = value * constant!;
      break;
    case "y-divided-by-k":
      out = value / constant!;
      break;
    case "k-minus-y":
      out = constant! - value;
      break;
    case "k-divided-by-y":
      if (value === 0) return null;
      out = constant! / value;
      break;
  }
  return Number.isFinite(out) ? out : null;
}

export async function runTransformData(
  columns: Column[],
  params: { function?: TransformFunction; constant?: number } | undefined,
): Promise<AnalysisOutcome> {
  const fn: TransformFunction = params?.function ?? "log10";
  const label = TRANSFORM_LABEL[fn];
  if (isArithmeticTransform(fn)) {
    const constant = params?.constant;
    if (constant == null || !Number.isFinite(constant))
      return { error: `“${label}” needs a constant K — enter one and try again.` };
    if (fn === "y-divided-by-k" && constant === 0)
      return { error: "“Y/K” needs a constant K other than 0 — dividing by 0 is undefined." };
  }
  const groups = dataGroups(columns);
  if (groups.length < 1) {
    return { error: "This needs at least 1 column containing numeric data." };
  }

  const transformed = groups.map((column) => {
    const values = column.byRow.map((v) => (v == null ? null : transformValue(fn, v, params?.constant)));
    const excluded = column.byRow.filter((v, r) => v != null && values[r] == null).length;
    return { column: column.name, label, original: column.byRow, values, excluded };
  });
  // Descriptives over the values that transformed: a column with nothing
  // transformable has no group (R's mean of an empty vector is NaN, not a
  // number to show), and the notes say so instead.
  const withValues = transformed
    .map((t) => ({ name: `${label}(${t.column})`, values: t.values.filter((v): v is number => v != null) }))
    .filter((g) => g.values.length > 0);
  const descriptives: GroupDescriptives[] = withValues.length
    ? (await describe(withValues)).groups
    : [];

  const stats = transformed.flatMap((t) => {
    const rows = [{ label: `${label}(${t.column}) — N`, value: t.values.filter((v) => v != null).length }];
    if (t.excluded > 0) rows.push({ label: `${label}(${t.column}) — excluded`, value: t.excluded });
    return rows;
  });

  const notes = [
    "The source table is unchanged — these are the transformed values as a results sheet.",
    ...(isArithmeticTransform(fn) ? [`Applied with the constant K = ${params!.constant}.`] : []),
    ...transformed.map((t) => {
      if (t.excluded === 0) return "";
      if (t.values.every((v) => v == null))
        return `“${t.column}”: no value could be transformed (${EXCLUDED_REASON[fn]}), so the column is blank.`;
      return `“${t.column}”: ${t.excluded} value${t.excluded === 1 ? "" : "s"} left blank (${EXCLUDED_REASON[fn]}).`;
    }),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    testType: "transform-data",
    subtitle: `Transform data — ${label}`,
    stats,
    groups: descriptives,
    notes,
    transformed,
  };
}
