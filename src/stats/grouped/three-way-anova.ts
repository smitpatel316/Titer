// Three-way ANOVA — a Grouped table's column-groups (A), row position within
// each band (B) and row bands (C), plus every interaction. Type III sums of
// squares, like the two-way ANOVA: sum-to-zero contrasts + drop1 over the full
// scope, with each term's F/Df/P pulled out by matching drop1's row names
// (never by assumed row index). Post-hoc on one chosen term reuses the
// pooled-MSE + ptukey technique from the two-way ANOVA's runPosthoc
// (q = sqrt(2)*|t|, t from the pooled-MSE two-sample statistic): the full
// suite — Tukey, Bonferroni, Šídák, Holm–Šídák, Fisher's LSD, Dunnett,
// Games-Howell, the FDR approach — over the whole term or its simple effects.
// No TukeyHSD call.
import type { AnalysisOutcome, Column, ComparisonRow, ThreeWayAnovaParams } from "../types";
import { FDR_METHODS, THREE_WAY_POSTHOCS, THREE_WAY_POSTHOC_SCOPES, fdrQError } from "../types";
import type { RowGroup } from "../../store/types";
import { adjustFdrPValues, adjustPValues, describe, effectSizeRow, pairIndices, pRow, R_ADJUST, R_CRIT, R_EFFECT_CI, R_PTUKEY, rStr, rVec, type FdrMethod } from "../column/base";
import { evalNamedVector } from "../webr";
import { flattenThreeWay, rowGroupBands, rowName, threeWayTermCells, type ThreeWayTermCell } from "./base";
import { R_MAXIMUM_T } from "../column/anova";
import { mean } from "../../lib/summary";

const TERMS = ["A", "B", "C", "A:B", "A:C", "B:C", "A:B:C"] as const;
type ThreeWayTerm = (typeof TERMS)[number];
type ThreeWayMethod = (typeof THREE_WAY_POSTHOCS)[number];

/** The FDR approach's heading: its method and its Q (shared wording with the
 *  two-way ANOVA's — same approach, same words). */
const FDR_LABEL: Record<FdrMethod, string> = {
  bh: "Benjamini-Hochberg",
  bky: "Benjamini-Krieger-Yekutieli (two-stage)",
  by: "Benjamini-Yekutieli",
};
const fdrLabel = (method: FdrMethod, q: number) => `FDR approach (${FDR_LABEL[method]}, Q = ${q}%)`;

/** One pair the post-hoc compares: the two term cells, their difference and
 *  t (on the ANOVA's pooled MSE — or, for Games-Howell, the two cells' own
 *  variances and Welch df), the size of its family, and its family index. */
interface PosthocPair {
  label1: string;
  label2: string;
  diff: number;
  t: number;
  se: number;
  df: number;
  means: number;
  family: number;
}

/** The pairs of a family's `count` members compared: each with the control
 *  (`control`, an index; Dunnett), else every pair. */
const familyPairs = (count: number, control?: number): [number, number][] =>
  control === undefined
    ? pairIndices(count)
    : Array.from({ length: count }, (_, i): [number, number] => [i, control]).filter(([i]) => i !== control);

/** R: a pair's P from its t (`x`) at `df`, for the single-step methods — Tukey's
 *  against the studentized range, Dunnett's against the largest t (its weights
 *  `l`), Games-Howell's against the range at its Welch df, Bonferroni's and
 *  Šídák's from the raw P times the family's `m` pairs, the rest raw (the
 *  step-down and FDR adjustments run afterwards, in TypeScript). */
const pExpr = (method: ThreeWayMethod, t: string, means: number, df: string, m: number, l?: string) =>
  method === "tukey"
    ? `1-ptukey(${t}*sqrt(2),${means},${df})`
    : method === "dunnett"
      ? `dun(${t},${l},${df})`
      : method === "games-howell"
        ? `ptk(${t}*sqrt(2),${means},${df})`
        : method === "bonferroni"
          ? `pmin(1,${m}*2*pt(-${t},${df}))`
          : method === "sidak"
            ? `1-(1-2*pt(-${t},${df}))^${m}`
            : `2*pt(-${t},${df})`;

/** R: a pair's 95% CI half-width, as a multiple of its standard error: the
 *  statistic at which its method's P is 0.05 (Tukey / Dunnett / Games-Howell /
 *  Bonferroni / Šídák), the unadjusted t for Fisher's LSD, none for the
 *  step-down Holm–Šídák and the FDR approach — as in the two-way ANOVA, no
 *  multiplicity-adjusted interval exists for those two, so the comparison
 *  carries no CI rather than a wrong one. */
const ciHalf = (
  method: ThreeWayMethod,
  means: number,
  df: string,
  m: number,
  cvDunnett?: string,
): string | undefined => {
  switch (method) {
    case "tukey":
      return `crit(function(x)ptk(x*sqrt(2),${means},${df}))`;
    case "dunnett":
      return cvDunnett;
    case "games-howell":
      return `crit(function(x)ptk(x*sqrt(2),${means},${df}))`;
    case "bonferroni":
      return `crit(function(x)pa(x,${df},"bonferroni",${m}))`;
    case "sidak":
      return `crit(function(x)pa(x,${df},"sidak",${m}))`;
    case "lsd":
      return `qt(0.975,${df})`;
    default:
      return undefined;
  }
};

async function runPosthoc(
  cells: ThreeWayTermCell[],
  method: ThreeWayMethod,
  mse: number,
  dfResid: number,
  scope: "term" | "simple",
  control?: string,
  fdr?: { method: FdrMethod; q: number },
): Promise<ComparisonRow[] | { error: string } | undefined> {
  // The families: one for the whole term, or one per level of the term's last
  // factor (simple effects). On a main effect the split is the term itself,
  // so simple is the whole term.
  const families = scope === "simple" ? [...new Set(cells.map((c) => c.split))] : [""];
  const familyOf = (c: ThreeWayTermCell) => (scope === "simple" ? families.indexOf(c.split) : 0);
  // Dunnett's control is matched by the full cell label for a whole-term
  // family, by the first factor's label inside a simple-effect family.
  const matchLabel = (c: ThreeWayTermCell) => (scope === "simple" ? c.within : c.label);
  const pairs: PosthocPair[] = [];
  for (const family of families) {
    const members = cells.filter((c) => (scope === "simple" ? c.split === family : true));
    const controlAt =
      method === "dunnett" ? members.findIndex((c) => matchLabel(c) === control) : undefined;
    if (method === "dunnett" && controlAt === -1)
      return {
        error:
          `The control ${scope === "simple" ? "level" : "cell"}${control ? ` “${control}”` : ""} ` +
          `is not one of the ${scope === "simple" ? "levels compared" : "cells"} of this term. ` +
          "Create this analysis again to choose another.",
      };
    for (const [i, j] of familyPairs(members.length, controlAt)) {
      const vi = members[i].values;
      const vj = members[j].values;
      const diff = mean(vi) - mean(vj);
      if (method === "games-howell") {
        if (vi.length < 2 || vj.length < 2)
          return {
            error:
              "Games-Howell compares each cell on its own scatter: every cell compared needs 2 values or more that vary.",
          };
        const va = variance(vi) / vi.length;
        const vb = variance(vj) / vj.length;
        const se = Math.sqrt(va + vb);
        const df = (va + vb) ** 2 / (va ** 2 / (vi.length - 1) + vb ** 2 / (vj.length - 1));
        pairs.push({
          label1: members[i].label,
          label2: members[j].label,
          diff,
          t: Math.abs(diff) / se,
          se,
          df,
          means: members.length,
          family: familyOf(members[i]),
        });
      } else {
        const se = Math.sqrt(mse * (1 / vi.length + 1 / vj.length));
        pairs.push({
          label1: members[i].label,
          label2: members[j].label,
          diff,
          t: Math.abs(diff) / se,
          se,
          df: dfResid,
          means: members.length,
          family: familyOf(members[i]),
        });
      }
    }
  }
  if (pairs.length === 0) return undefined;
  const df = String(dfResid);
  // Dunnett: each family's weights (√(n / (n + n of its control))) and critical
  // value, once — the same construction as the two-way ANOVA's runPosthoc.
  const dunnettSetup =
    method === "dunnett"
      ? `${R_MAXIMUM_T}\n` +
        families
          .map((family, f) => {
            const members = cells.filter((c) => (scope === "simple" ? c.split === family : true));
            const controlAt = members.findIndex((c) => matchLabel(c) === control);
            const weights = members
              .filter((_, i) => i !== controlAt)
              .map((c) => c.values.length);
            const nc = members[controlAt].values.length;
            const nComp = members.length - 1;
            return (
              `l${f}<-sqrt(c(${weights.join(",")})/(c(${weights.join(",")})+${nc}));` +
              `cv${f}<-crit(function(x)dun(x,l${f},${df}),qt(1-0.025/c(1,${nComp}),${df}))`
            );
          })
          .join(";") +
        ";"
      : "";
  // The per-pair statements: each pair's difference, its P, and its CI when the
  // method admits one — assigned as d_k / p_k / lo_k / hi_k, then gathered.
  const assigns = pairs.map((p, k) => {
    const t = String(p.t);
    const m = (p.means * (p.means - 1)) / 2;
    const l = method === "dunnett" ? `l${p.family}` : undefined;
    const pDf = method === "games-howell" ? String(p.df) : df;
    const pValue = pExpr(method, t, p.means, pDf, m, l);
    const half = ciHalf(method, p.means, pDf, m, method === "dunnett" ? `cv${p.family}` : undefined);
    return (
      `d_${k}<-${p.diff};p_${k}<-${pValue};` +
      (half === undefined ? "" : `h_${k}<-${half}*${p.se};lo_${k}<-d_${k}-h_${k};hi_${k}<-d_${k}+h_${k};`)
    );
  });
  const v = await evalNamedVector(
    `${R_PTUKEY};${R_CRIT};${R_ADJUST};${dunnettSetup}${assigns.join("")}` +
      `c(${pairs.map((_, k) => `d_${k}=d_${k},p_${k}=p_${k}`).join(",")}` +
      `${pairs
        .map((p, k) =>
          ciHalf(
            method,
            p.means,
            method === "games-howell" ? String(p.df) : df,
            (p.means * (p.means - 1)) / 2,
            method === "dunnett" ? `cv${p.family}` : undefined,
          ) === undefined
            ? ""
            : `,lo_${k}=lo_${k},hi_${k}=hi_${k}`,
        )
        .join("")})`,
  );
  const rows = pairs.map((p, k) => ({
    group1: p.label1,
    group2: p.label2,
    diff: v[`d_${k}`] ?? null,
    low: v[`lo_${k}`] ?? null,
    high: v[`hi_${k}`] ?? null,
    p: v[`p_${k}`] ?? null,
  }));
  // Step-down and FDR adjustments need the whole family sorted — R returned the
  // raw P values, so they are adjusted here, in TypeScript, per family.
  if (method === "holm-sidak" || method === "fdr") {
    for (const family of [...new Set(pairs.map((p) => p.family))]) {
      const idx = pairs.map((p, i) => (p.family === family ? i : -1)).filter((i) => i >= 0);
      const adjusted =
        method === "holm-sidak"
          ? adjustPValues(
              idx.map((i) => rows[i].p),
              "holm-sidak",
            )
          : adjustFdrPValues(
              idx.map((i) => rows[i].p),
              fdr!.method,
              fdr!.q,
            );
      idx.forEach((i, k) => {
        rows[i] = { ...rows[i], p: adjusted[k] };
      });
    }
  }
  return rows;
}

/** A sample variance (n − 1), for Games-Howell's per-pair Welch statistics. */
const variance = (values: number[]) => {
  const m = mean(values);
  return values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
};

export async function runThreeWayAnova(
  columns: Column[],
  params: ThreeWayAnovaParams | undefined,
  titles: (string | null)[],
  rowGroups?: RowGroup[],
): Promise<AnalysisOutcome> {
  const rowCount = columns[0]?.byRow.length ?? 0;
  const bands = rowGroupBands(rowGroups);
  if (!bands || bands.length < 2) {
    return {
      error:
        "Three-way ANOVA needs at least 2 column groups, 2 rows per row group, and 2 row groups. " +
        "Add row groups in the table's Groups panel: split the rows into at least 2 named bands.",
    };
  }
  if (bands.some((b) => !b.name.trim()) || new Set(bands.map((b) => b.name)).size !== bands.length) {
    return { error: "Row group names must be non-empty and different from each other." };
  }
  if (bands.reduce((sum, b) => sum + b.count, 0) !== rowCount || bands.some((b) => b.count < 1)) {
    return { error: "Row groups must cover every row exactly once." };
  }
  const flat = flattenThreeWay(columns, bands);
  const aLevels = [...new Set(flat.a)];
  const bLevels = [...new Set(flat.b)];
  const cLevels = [...new Set(flat.c)];
  if (aLevels.length < 2 || bLevels.length < 2 || cLevels.length < 2 || flat.values.length === 0) {
    return {
      error: "Three-way ANOVA needs at least 2 column groups, 2 rows per row group, and 2 row groups.",
    };
  }
  // An empty A×B×C cell makes the 3-way term inestimable in R (NA rows) —
  // refuse it up front, naming the first empty cell.
  const counts = new Map<string, number>();
  flat.values.forEach((_, i) => {
    const key = `${flat.a[i]}\n${flat.b[i]}\n${flat.c[i]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  for (const a of aLevels) {
    for (const b of bLevels) {
      for (const c of cLevels) {
        if (!counts.has(`${a}\n${b}\n${c}`)) {
          return {
            error:
              `Every combination of the three factors needs at least one value. ` +
              `${a} × ${rowName(titles, Number(b.slice(1)) - 1)} × ${c} has no values.`,
          };
        }
      }
    }
  }
  const dfResid = flat.values.length - aLevels.length * bLevels.length * cLevels.length;
  if (dfResid < 1) {
    return {
      error:
        "Each combination needs replicates (or the design needs more rows) — there are no residual degrees of freedom.",
    };
  }

  const rFactor = (labels: string[]) => `factor(c(${labels.map(rStr).join(",")}))`;
  const setup = `${R_EFFECT_CI};v<-${rVec(flat.values)};A<-${rFactor(flat.a)};B<-${rFactor(flat.b)};C<-${rFactor(flat.c)}`;
  // Type III sums of squares (matches GraphPad Prism on unbalanced designs; on
  // balanced designs Type I = II = III, so nothing changes there). Base-R recipe:
  // sum-to-zero contrasts on the factors + drop1 over the full scope. Contrasts are
  // set on the factor objects (NOT global options()) so no other analysis is affected.
  // Each term is pulled out by matching drop1's row names — drop1 returns one row
  // per term in formula order ("<none>", "A", "B", "C", "A:B", "A:C", "B:C", "A:B:C").
  // Partial eta squared (seq 161) per term, with its 95% CI from the term's F
  // statistic's noncentrality (`etaCI`, N = total observations); each term's sum
  // of squares is F·Df·MSE, so eta squared follows in TypeScript.
  const keyOf = (term: string) => term.replace(/:/g, "");
  const pick = (term: string, col: string) => `a$${col}[match("${term}",rn)]`;
  const rCode =
    `${setup};contrasts(A)<-"contr.sum";contrasts(B)<-"contr.sum";contrasts(C)<-"contr.sum";` +
    `f<-aov(v~A*B*C);a<-drop1(f,~.,test="F");dfr<-df.residual(f);mse<-deviance(f)/dfr;rn<-rownames(a);` +
    `ec<-t(sapply(seq_along(c(${TERMS.map((t) => `"${t}"`).join(",")})),function(k)etaCI(a$"F value"[k+1],a$Df[k+1],dfr,length(v))));` +
    `c(${TERMS.map(
      (t) =>
        `${keyOf(t)}F=${pick(t, '"F value"')},${keyOf(t)}Df=${pick(t, "Df")},${keyOf(t)}P=${pick(t, '"Pr(>F)"')}`,
    ).join(",")},dfResid=dfr,mse=mse,` +
    `${TERMS.map((t, k) => `${keyOf(t)}Lo=ec[${k + 1},1],${keyOf(t)}Hi=ec[${k + 1},2]`).join(",")})`;

  const v = await evalNamedVector(rCode);
  const effect = (term: string) => [
    { label: `${term} F`, value: v[`${keyOf(term)}F`] ?? null },
    { label: `${term} DFn`, value: v[`${keyOf(term)}Df`] ?? null },
    pRow(`${term} P value`, v[`${keyOf(term)}P`] ?? null),
  ];
  const stats = [...TERMS.flatMap(effect), { label: "DFd (residual)", value: v.dfResid ?? null }];
  // Each term's sum of squares is F·Df·MSE; the error's is MSE·DFd.
  const ssError = (v.mse ?? NaN) * (v.dfResid ?? NaN);
  const ssTerms = TERMS.map((t) => (v[`${keyOf(t)}F`] ?? NaN) * (v[`${keyOf(t)}Df`] ?? NaN) * (v.mse ?? NaN));
  const ssTotal = ssTerms.reduce((s, x) => s + x, 0) + ssError;
  const TERM_LABELS: Record<ThreeWayTerm, string> = {
    A: "A — Group",
    B: "B — Row",
    C: "C — Row group",
    "A:B": "A:B",
    "A:C": "A:C",
    "B:C": "B:C",
    "A:B:C": "A:B:C",
  };
  const effectSizes =
    params?.effectSizes === false
      ? undefined
      : TERMS.map((t, k) =>
          effectSizeRow(TERM_LABELS[t], ssTerms[k], ssError, ssTotal, v[`${keyOf(t)}Lo`], v[`${keyOf(t)}Hi`]),
        );
  const groups = (
    await describe(aLevels.map((name) => ({ name, values: flat.values.filter((_, i) => flat.a[i] === name) })))
  ).groups;

  const posthoc = params?.posthoc ?? "none";
  // The runner only does the methods in THREE_WAY_POSTHOCS — refuse the rest
  // rather than silently running Bonferroni under another label.
  if (!(THREE_WAY_POSTHOCS as readonly string[]).includes(posthoc)) {
    return {
      error:
        `“${posthoc}” multiple comparisons are not available for three-way ANOVA — ` +
        `choose Tukey, Bonferroni, Šídák, Holm–Šídák, Fisher's LSD, Dunnett, Games-Howell or the FDR approach.`,
    };
  }
  const posthocTerm: ThreeWayTerm =
    params?.posthocTerm && (TERMS as readonly string[]).includes(params.posthocTerm) ? params.posthocTerm : "A";
  // Simple effects only split an interaction term; on a main effect the scope
  // is the whole term, whatever was asked.
  const posthocScope =
    params?.posthocScope === "simple" && posthocTerm.includes(":") ? "simple" : "term";
  if (params?.posthocScope !== undefined && !(THREE_WAY_POSTHOC_SCOPES as readonly string[]).includes(params.posthocScope)) {
    return {
      error: `“${params.posthocScope}” is not a three-way comparison scope — choose the whole term, or simple effects.`,
    };
  }
  if (posthoc === "fdr") {
    if (params?.fdrMethod !== undefined && !(FDR_METHODS as readonly string[]).includes(params.fdrMethod)) {
      return {
        error: `“${params.fdrMethod}” is not an FDR method — choose Benjamini-Hochberg, Benjamini-Krieger-Yekutieli or Benjamini-Yekutieli.`,
      };
    }
    const qError = params?.fdrQ === undefined ? undefined : fdrQError(params.fdrQ);
    if (qError) return { error: qError };
  }
  const cells = posthoc === "none" ? [] : threeWayTermCells(posthocTerm, flat, titles);
  const comparisons =
    posthoc === "none"
      ? undefined
      : await runPosthoc(
          cells,
          posthoc,
          v.mse ?? NaN,
          v.dfResid ?? NaN,
          posthocScope,
          params?.control,
          posthoc === "fdr" ? { method: params?.fdrMethod ?? "bh", q: params?.fdrQ ?? 5 } : undefined,
        );
  if (comparisons && "error" in comparisons) return comparisons;
  const bLabels = bLevels.map((b) => rowName(titles, Number(b.slice(1)) - 1));
  const methodLabel =
    posthoc === "tukey"
      ? "Tukey's"
      : posthoc === "bonferroni"
        ? "Bonferroni-corrected"
        : posthoc === "sidak"
          ? "Šídák-corrected"
          : posthoc === "holm-sidak"
            ? "Holm–Šídák"
            : posthoc === "lsd"
              ? "Fisher's LSD (uncorrected)"
              : posthoc === "dunnett"
                ? `Dunnett's (vs. ${params?.control})`
                : posthoc === "games-howell"
                  ? "Games-Howell"
                  : fdrLabel(params?.fdrMethod ?? "bh", params?.fdrQ ?? 5);
  const scopeLabel =
    posthocScope === "simple"
      ? `simple effects (the first factor's levels within each ${posthocTerm.split(":").at(-1)} level)`
      : `${posthocTerm} ${posthocTerm.includes(":") ? "cell means" : "means"}`;
  const fdrNote =
    posthoc === "fdr" && comparisons
      ? (() => {
          const q = (params?.fdrQ ?? 5) / 100;
          const discoveries = comparisons.filter((c) => c.p != null && c.p < q).length;
          return (
            ` ${fdrLabel(params?.fdrMethod ?? "bh", params?.fdrQ ?? 5)}: ${discoveries} of ${comparisons.length} ` +
            `comparison${comparisons.length === 1 ? " is" : "s are"} discoveries (adjusted P < ${q}). ` +
            "The P values are FDR-adjusted."
          );
        })()
      : "";
  const notes =
    `A = Group (${aLevels.join(", ")}); B = Row (${bLabels.join(", ")}); C = Row group (${cLevels.join(", ")}). ` +
    `Compares the three factors and all their interactions; assumes normal distributions with equal variances (Type III sums of squares). ` +
    `${flat.values.length} observations in ${aLevels.length * bLevels.length * cLevels.length} cells` +
    (flat.dropped > 0 ? `; ${flat.dropped} empty cell${flat.dropped === 1 ? "" : "s"} left out` : "") +
    "." +
    (posthoc === "none" ? "" : ` Multiple comparisons follow the ${posthocTerm} term (${scopeLabel}).`) +
    (posthoc === "holm-sidak" || posthoc === "fdr"
      ? " No multiplicity-adjusted confidence interval exists for this method, so the comparisons carry none."
      : "") +
    fdrNote;
  return {
    testType: "three-way-anova",
    subtitle: "Ordinary three-way ANOVA",
    stats,
    groups,
    effectSizes,
    notes,
    comparisons,
    comparisonsLabel: comparisons?.length
      ? `${methodLabel} multiple comparisons test (${scopeLabel})`
      : undefined,
  };
}
