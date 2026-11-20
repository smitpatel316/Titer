// Multifactor ANOVA (N-way ANOVA) on a Multiple Variables table: one numeric
// response column against 1–5 categorical factor columns, fit on the complete
// rows. Prism 11's Multifactor ANOVA (Pro; licence-blocked, built from the
// docs): one unified analysis for one-way through N-way designs, testing the
// main effects and every two- and three-way interaction — never a four-way or
// higher one — ordinary (non-repeated measures) only. Type III sums of
// squares, like the two/three-way ANOVAs: sum-to-zero contrasts + drop1 over
// the full scope, with each term's F/Df/P/SS pulled out by matching drop1's row
// names (never by assumed row index). Post-hoc Tukey/Bonferroni on one chosen
// term reuses the pooled-MSE + ptukey technique from the three-way ANOVA's
// runPosthoc (q = sqrt(2)*|t|, t from the pooled-MSE two-sample statistic).
// No TukeyHSD call.
import type { AnalysisOutcome, ComparisonRow, MultifactorAnovaParams } from "../types";
import { MULTIFACTOR_MAX_FACTORS } from "../types";
import type { Column } from "../../lib/dataset";
import { dataGroups, describe, missingColumn, pairIndices, pRow, rStr, rVec } from "../column/base";
import { evalNamedVector } from "../webr";
import { mean, sd } from "../../lib/summary";

/** The cell's text, trimmed — undefined when blank (or excluded). */
const textOf = (cell: string | null | undefined): string | undefined => {
  const t = cell?.trim();
  return t ? t : undefined;
};

/** Distinct non-blank cell texts, in first-appearance order. */
function levelsOf(column: Column): string[] {
  const seen = new Set<string>();
  const levels: string[] = [];
  for (const cell of column.cells) {
    const t = textOf(cell);
    if (t !== undefined && !seen.has(t)) {
      seen.add(t);
      levels.push(t);
    }
  }
  return levels;
}

/** One tested term: its factors (by index into the factor list), its display
 *  label ("Treatment:Time") and its R term ("F1:F2"). */
interface Term {
  indices: number[];
  label: string;
  rTerm: string;
}

/** The terms Prism tests: every main effect and every two- and three-way
 *  interaction — never a four-way or higher one. In term order: mains in
 *  factor order, then two-way, then three-way (each lexicographic by factor). */
function termsOf(factors: string[]): Term[] {
  const out: Term[] = [];
  const maxOrder = Math.min(3, factors.length);
  for (let order = 1; order <= maxOrder; order++) {
    const pick = (start: number, chosen: number[]) => {
      if (chosen.length === order) {
        out.push({
          indices: [...chosen],
          label: chosen.map((i) => factors[i]).join(":"),
          rTerm: chosen.map((i) => `F${i + 1}`).join(":"),
        });
        return;
      }
      for (let i = start; i < factors.length; i++) {
        chosen.push(i);
        pick(i + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
  }
  return out;
}

/** The cell means of one term: one entry per level (or level combination),
 *  with the values behind it and its result-table label. */
interface TermCell {
  label: string;
  values: number[];
}

function termCells(term: Term, rows: { values: number[]; at: (string | undefined)[][] }): TermCell[] {
  const byKey = new Map<string, TermCell>();
  const keyAndLabel = (combo: string[]): [string, string] => {
    const key = combo.join("\n");
    const label =
      combo.length === 1
        ? combo[0]
        : combo.length === 2
          ? `${combo[0]} (${combo[1]})`
          : `${combo[0]} (${combo.slice(1).join(", ")})`;
    return [key, label];
  };
  rows.values.forEach((v, k) => {
    const combo = term.indices.map((i) => rows.at[k][i]!);
    const [key, label] = keyAndLabel(combo);
    const cell = byKey.get(key) ?? { label, values: [] };
    cell.values.push(v);
    byKey.set(key, cell);
  });
  // First-seen order: the factor levels in table order, nested factor by factor.
  return [...byKey.values()];
}

async function runPosthoc(
  cells: TermCell[],
  method: "tukey" | "bonferroni",
  mse: number,
  dfResid: number,
): Promise<ComparisonRow[] | undefined> {
  const pairs: { label1: string; label2: string; diff: number; t: number }[] = [];
  for (const [i, j] of pairIndices(cells.length)) {
    const vi = cells[i].values;
    const vj = cells[j].values;
    const diff = mean(vi) - mean(vj);
    const t = diff / Math.sqrt(mse * (1 / vi.length + 1 / vj.length));
    pairs.push({ label1: cells[i].label, label2: cells[j].label, diff, t });
  }
  if (pairs.length === 0) return undefined;
  const nmeans = cells.length;
  const m = pairs.length;
  const rCode =
    method === "tukey"
      ? `c(${pairs.map((c, k) => `p${k}=1-ptukey(${Math.abs(c.t) * Math.SQRT2},${nmeans},${dfResid})`).join(",")})`
      : `c(${pairs.map((c, k) => `p${k}=pmin(1,${m}*2*pt(${-Math.abs(c.t)},${dfResid}))`).join(",")})`;
  const v = await evalNamedVector(rCode);
  return pairs.map((c, k) => ({ group1: c.label1, group2: c.label2, diff: c.diff, p: v[`p${k}`] ?? null }));
}

/** The terms Prism tests for these factors, as labels ("Treatment",
 *  "Treatment:Time", "Treatment:Time:Genotype") — the wizard's post-hoc-term
 *  options, in the same order the runner tests them. */
export function multifactorTerms(factors: string[]): string[] {
  return termsOf(factors).map((t) => t.label);
}

export async function runMultifactorAnova(
  columns: Column[],
  params: MultifactorAnovaParams | undefined,
): Promise<AnalysisOutcome> {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const numeric = dataGroups(columns);
  const responseName = params?.response;
  const response = responseName === undefined ? numeric[0] : byName.get(responseName);
  if (responseName !== undefined && response === undefined) return { error: missingColumn(responseName) };
  if (!response) {
    return { error: "Multifactor ANOVA needs a numeric response column — this table has no column with numbers." };
  }
  if (response.values.length === 0) {
    return { error: `“${response.name}” holds no numbers — pick a response variable with values.` };
  }

  // The factors: named, or every other column with at least two levels.
  const named = params?.factors;
  let factorNames: string[];
  if (named !== undefined && named.length > 0) {
    const missing = named.find((n) => !byName.has(n));
    if (missing !== undefined) return { error: missingColumn(missing) };
    if (named.includes(response.name)) {
      return { error: `“${response.name}” is the response — it can't also be a factor.` };
    }
    factorNames = [...new Set(named)];
  } else {
    factorNames = columns.filter((c) => c !== response && levelsOf(c).length >= 2).map((c) => c.name);
  }
  if (factorNames.length === 0) {
    return {
      error:
        "Multifactor ANOVA needs at least one factor — a column with two or more levels. " +
        "Add a grouping column (text levels, or numeric codes) and try again.",
    };
  }
  if (factorNames.length > MULTIFACTOR_MAX_FACTORS) {
    return {
      error:
        `Multifactor ANOVA takes at most ${MULTIFACTOR_MAX_FACTORS} factors — ${factorNames.length} were chosen. ` +
        "Drop a factor and try again.",
    };
  }
  const factors = factorNames.map((n) => byName.get(n)!);
  const levels = factors.map((f) => levelsOf(f));
  const thin = factorNames.find((_, i) => levels[i].length < 2);
  if (thin !== undefined) {
    return { error: `“${thin}” has only one level — every factor needs at least two levels.` };
  }

  // Complete cases: the rows where the response has a value and every factor
  // has a level (Prism omits the other rows). `at[k][i]` is row k's level of
  // factor i.
  const rowCount = response.byRow.length;
  const values: number[] = [];
  const at: (string | undefined)[][] = [];
  let dropped = 0;
  for (let r = 0; r < rowCount; r++) {
    const v = response.byRow[r];
    const rowLevels = factors.map((f) => textOf(f.cells[r]));
    if (v == null || rowLevels.some((l) => l === undefined)) {
      dropped++;
      continue;
    }
    values.push(v);
    at.push(rowLevels as string[]);
  }
  if (values.length === 0) {
    return {
      error:
        "No row has both a response value and a level for every factor — enter values, or pick factors the rows have levels for.",
    };
  }
  if (sd(values) === 0) {
    return {
      error:
        `“${response.name}” is constant on the complete rows — Multifactor ANOVA cannot fit a model when the response ` +
        `variable has no variation. Enter values that vary and try again.`,
    };
  }

  const terms = termsOf(factorNames);
  // An empty combination of a tested term's levels makes that term
  // inestimable in R (NA rows) — refuse it up front, naming the first empty
  // combination.
  for (const term of terms) {
    const seen = new Set(at.map((row) => term.indices.map((i) => row[i]!).join("\n")));
    const missing = cartesian(term.indices.map((i) => levels[i])).find((combo) => !seen.has(combo.join("\n")));
    if (missing) {
      return {
        error:
          `Every combination of the factors in each tested term needs at least one value. ` +
          `${missing.map((l, k) => `${factorNames[term.indices[k]]} ${l}`).join(" × ")} has no values.`,
      };
    }
  }
  // The ^3 model's rank: 1 + the terms' degrees of freedom. (The empty-cell
  // check above keeps the design matrix at full rank, so this is exact.)
  const rank = 1 + terms.reduce((sum, t) => sum + t.indices.reduce((p, i) => p * (levels[i].length - 1), 1), 0);
  const dfResid = values.length - rank;
  if (dfResid < 1) {
    return {
      error:
        "Each combination needs replicates (or the design needs more rows) — there are no residual degrees of freedom.",
    };
  }

  const posthoc = params?.posthoc ?? "none";
  // POSTHOCS also carries the Šídák / Holm–Šídák / LSD options other ANOVAs
  // offer — this runner only does Tukey and Bonferroni, so refuse those here
  // rather than silently running Bonferroni under a Šídák label.
  if (posthoc !== "none" && posthoc !== "tukey" && posthoc !== "bonferroni") {
    return {
      error:
        `“${posthoc}” multiple comparisons are not available for multifactor ANOVA — ` + `choose Tukey or Bonferroni.`,
    };
  }
  const posthocTerm: Term | undefined =
    posthoc === "none"
      ? undefined
      : params?.posthocTerm === undefined
        ? terms[0]
        : terms.find((t) => t.label === params.posthocTerm);
  if (posthoc !== "none" && posthocTerm === undefined) {
    return {
      error:
        `“${params?.posthocTerm}” is not one of this analysis's terms — choose one of: ` +
        `${terms.map((t) => t.label).join(", ")}.`,
    };
  }

  const rFactor = (i: number) => `factor(c(${at.map((row) => rStr(row[i]!)).join(",")}))`;
  const setup = `v<-${rVec(values)};${factors.map((_, i) => `F${i + 1}<-${rFactor(i)}`).join(";")}`;
  const formula = factors.length === 1 ? "v~F1" : `v~(${factors.map((_, i) => `F${i + 1}`).join("+")})^3`;
  // Type III sums of squares (matches GraphPad Prism on unbalanced designs; on
  // balanced designs Type I = II = III, so nothing changes there). Base-R recipe:
  // sum-to-zero contrasts on the factors + drop1 over the full scope. Contrasts are
  // set on the factor objects (NOT global options()) so no other analysis is affected.
  // Each term is pulled out by matching drop1's row names — drop1 returns one row
  // per term in formula order ("<none>", then the terms). "Sum of Sq" is the
  // term's Type III sum of squares (the rise in RSS when it is dropped).
  const keyOf = (term: string) => term.replace(/:/g, "");
  const pick = (term: string, col: string) => `a$${col}[match("${term}",rn)]`;
  const rCode =
    `${setup};${factors.map((_, i) => `contrasts(F${i + 1})<-"contr.sum"`).join(";")};` +
    `f<-aov(${formula});a<-drop1(f,~.,test="F");dfr<-df.residual(f);mse<-deviance(f)/dfr;rn<-rownames(a);` +
    `sstot<-sum((v-mean(v))^2);` +
    `c(${terms
      .map(
        (t) =>
          `${keyOf(t.rTerm)}F=${pick(t.rTerm, '"F value"')},${keyOf(t.rTerm)}Df=${pick(t.rTerm, "Df")},` +
          `${keyOf(t.rTerm)}P=${pick(t.rTerm, '"Pr(>F)"')},${keyOf(t.rTerm)}SS=${pick(t.rTerm, '"Sum of Sq"')}`,
      )
      .join(",")},dfResid=dfr,mse=mse,sstot=sstot)`;

  const v = await evalNamedVector(rCode);
  const ssResid = v.mse != null && v.dfResid != null ? v.mse * v.dfResid : null;
  const effect = (term: Term) => {
    const ss = v[`${keyOf(term.rTerm)}SS`] ?? null;
    const partial = ss != null && ssResid != null ? ss / (ss + ssResid) : null;
    const eta = ss != null && v.sstot != null && v.sstot !== 0 ? ss / v.sstot : null;
    return [
      { label: `${term.label} F`, value: v[`${keyOf(term.rTerm)}F`] ?? null },
      { label: `${term.label} DFn`, value: v[`${keyOf(term.rTerm)}Df`] ?? null },
      pRow(`${term.label} P value`, v[`${keyOf(term.rTerm)}P`] ?? null),
      { label: `${term.label} partial eta squared`, value: partial },
      { label: `${term.label} eta squared`, value: eta },
    ];
  };
  const stats = [...terms.flatMap(effect), { label: "DFd (residual)", value: v.dfResid ?? null }];

  // Descriptives of every full cell (all factors), in first-seen order.
  const cellKey = (row: (string | undefined)[]) => row.map((l) => l!).join("\n");
  const cellOrder: string[] = [];
  const cellValues = new Map<string, number[]>();
  const cellLabel = new Map<string, string>();
  at.forEach((row, k) => {
    const key = cellKey(row);
    if (!cellValues.has(key)) {
      cellOrder.push(key);
      cellValues.set(key, []);
      cellLabel.set(key, factorNames.map((f, i) => `${f} = ${row[i]}`).join(", "));
    }
    cellValues.get(key)!.push(values[k]);
  });
  const { groups } = await describe(
    cellOrder.map((key) => ({ name: cellLabel.get(key)!, values: cellValues.get(key)! })),
  );

  const cells = posthocTerm ? termCells(posthocTerm, { values, at }) : [];
  const comparisons =
    posthoc === "none" || !posthocTerm ? undefined : await runPosthoc(cells, posthoc, v.mse ?? NaN, v.dfResid ?? NaN);
  const cellCount = cellOrder.length;
  const tested =
    factors.length === 1
      ? "Tests the main effect"
      : factors.length === 2
        ? "Tests the main effects and the two-way interaction"
        : factors.length === 3
          ? "Tests the main effects and every two- and three-way interaction"
          : "Tests the main effects and every two- and three-way interaction (no four-way or higher interaction is tested)";
  const notes =
    `Response “${response.name}” by ${factorNames.map((f, i) => `${f} (${levels[i].join(", ")})`).join("; ")}. ` +
    `${tested}; assumes normal distributions with equal variances (Type III sums of squares). ` +
    `${values.length} complete rows in ${cellCount} cells` +
    (dropped > 0 ? `; ${dropped} row${dropped === 1 ? "" : "s"} left out (missing response or factor)` : "") +
    "." +
    (posthoc === "none" || !posthocTerm ? "" : ` Multiple comparisons follow the ${posthocTerm.label} term.`);
  return {
    testType: "multifactor-anova",
    subtitle: "Multifactor ANOVA",
    stats,
    groups,
    notes,
    comparisons,
    comparisonsLabel: comparisons?.length
      ? `${posthoc === "tukey" ? "Tukey's" : "Bonferroni-corrected"} multiple comparisons test ` +
        `(${posthocTerm!.label} ${posthocTerm!.label.includes(":") ? "cell means" : "means"})`
      : undefined,
  };
}

/** The Cartesian product of the level lists, in order. */
function cartesian(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, list) => acc.flatMap((combo) => list.map((l) => [...combo, l])), [[]]);
}
