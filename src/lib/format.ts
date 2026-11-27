// How numbers and P values are written everywhere (results, graph notes, brackets), and
// names in menus and pickers.
import { loadPValueFormat, pValueThreshold } from "./preferences";

/** A number as Titer shows it: 4 significant figures, "—" when missing. */
export function num(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  // A one-sided 95% CI is open on one side.
  if (!Number.isFinite(value)) return value > 0 ? "∞" : "−∞";
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(4)).toString();
}

/** A P value: like `num`, but "<0.0001" below the preferred threshold
 *  (seq 225 remainder L12) — "<0.001", or the exact value when the format
 *  is exact. The default threshold is 0.0001, as before. */
export const pValue = (p: number | null | undefined) => {
  const threshold = pValueThreshold(loadPValueFormat());
  return p != null && threshold > 0 && p < threshold ? `<${threshold}` : num(p);
};

/** "P = 0.0123", or "P < 0.0001", for notes on a graph. */
export const pText = (p: number | null | undefined) => {
  const threshold = pValueThreshold(loadPValueFormat());
  return p != null && threshold > 0 && p < threshold ? `P < ${threshold}` : `P = ${num(p)}`;
};

/** "p=0.0123", or "p<0.0001": the bracket label that names the P value plainly. */
export const pEquals = (p: number | null | undefined) => {
  const threshold = pValueThreshold(loadPValueFormat());
  return p != null && threshold > 0 && p < threshold ? `p<${threshold}` : `p=${num(p)}`;
};

export const isSignificant = (p: number | null | undefined): p is number => p != null && !Number.isNaN(p) && p < 0.05;

/** Prism's summary of a P value: "****" (below 0.0001) to "*" (below 0.05), else
 *  "ns"; "—" when there is none. */
export function pStars(p: number | null | undefined): string {
  if (p == null || Number.isNaN(p)) return "—";
  return p < 0.0001 ? "****" : p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "ns";
}

// Small words stay lowercase inside a title, as in macOS menus.
const MINOR = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs"]);

/** A name as menus, pickers and labels show it ("Compare One Group to a Value"): each
 *  word capitalized, hyphenated parts too, except small words inside and one-letter
 *  symbols ("t"). Capitals already there ("ANOVA") stay. */
export function titleCase(text: string): string {
  return text.replace(/[A-Za-z][\w']*/g, (word, at: number) =>
    at > 0 && (MINOR.has(word) || word.length === 1) ? word : word[0].toUpperCase() + word.slice(1),
  );
}
