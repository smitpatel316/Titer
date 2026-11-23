// Significance annotations for Column-family graphs. A graph can read a sibling
// analysis's pairwise comparisons and draw Prism-style brackets (a horizontal
// line with two down-ticks + a centered "*"/"ns"/P-value label) between the two
// compared columns. Positions use the category X axis (column index) for X and
// DATA coordinates for Y, placing each bracket above the tallest drawn column
// (bars/points/error bars), and extends the Y auto-range to fit.
import type { AnalysisOutcome, ComparedCell } from "../../stats/types";
import type { GraphOptions, GraphType, ProjectNode, SeriesStyle } from "../../store/types";
import type { Column } from "../../lib/dataset";
import type { GraphFigure } from ".";
import { isSignificant, pEquals, pStars, pText } from "../../lib/format";
import {
  centers,
  errors,
  FONT,
  groupOffset,
  INK,
  perRowStats,
  rowCountOf,
  rowLabels,
  separatedPositions,
  seriesCenter,
  seriesError,
} from "./plot-helpers";
import { groupsOf } from "../../lib/dataset";
import { pairKey } from "../../lib/columns";
import { headline } from "../analyses/analysis-results-view";

/** The data sets an analysis ran on: those it chose, else every one of the table's
 *  (`all`, those holding data), a two-group test's first two. */
export function ranOn(analysis: ProjectNode, all: string[]): string[] {
  const sets = (analysis.analysisParams as { sets?: string[] } | undefined)?.sets;
  return sets ?? (analysis.analysisType === "compare-two-groups" ? all.slice(0, 2) : all);
}

/** Whether an analysis's stars may go on a graph showing `shown`: it ran on those data
 *  sets exactly, so its P values (corrected for its own comparisons) are those of the
 *  groups drawn, never of more. */
export const starsFit = (analysis: ProjectNode, all: string[], shown: string[]) => {
  const ran = ranOn(analysis, all);
  return ran.length === shown.length && ran.every((n) => shown.includes(n));
};

/** One pairwise comparison offered to the graph, keyed stably for persistence.
 *  `analysisId` is the source analysis node, so the same pair from two
 *  analyses (two copy tables' multiple t tests on the same rows) stays
 *  distinct; absent, the legacy single source, whose bare `key` selects it. */
export interface SigComparison {
  key: string;
  group1: string;
  group2: string;
  p: number | null;
  /** A grouped table's two cells (`ComparisonRow.cells`). */
  cells?: [ComparedCell, ComparedCell];
  analysisId?: string;
}

/** The source analyses a graph draws significance from: `sigAnalysisIds`
 *  when non-empty, else the legacy single `sigAnalysisId`. Deduped, in
 *  order — the first is the primary (the letters display's source). */
export function sigAnalysisIdsOf(options: GraphOptions): string[] {
  const list = (options.sigAnalysisIds ?? []).filter((id) => typeof id === "string" && id);
  if (list.length) return [...new Set(list)];
  return options.sigAnalysisId ? [options.sigAnalysisId] : [];
}

/** A comparison's selection key: scoped to its source analysis, so two
 *  analyses' same pair are ticked apart. */
export const sigPairKey = (c: SigComparison) => (c.analysisId ? `${c.analysisId}\u0001${c.key}` : c.key);

/** Whether `sigPairs` selects a comparison: by its scoped key, by its own
 *  key, by the pairKey of the two groups it compares, or by both group
 *  names named bare. The Format panel stores per-comparison keys, but a
 *  pair can also arrive spelled as the pair itself — a hand-set or MCP-set
 *  list like ["WT", "SKG"] for a multiple-t-tests pair, whose comparisons
 *  are per-row (their keys name the row, not the pair) and would otherwise
 *  match nothing and draw no brackets. A cell comparison's groups are its
 *  cells' groups; a column comparison's are group1/group2. One name alone
 *  names no pair. Both call orders are accepted — the m4 pins call
 *  (comparison, pairs), the m5 pins call (pairs, comparison) — so the
 *  overloads keep both working. */
export function sigPairSelected(c: SigComparison, sigPairs: string[]): boolean;
export function sigPairSelected(sigPairs: string[] | undefined, c: SigComparison): boolean;
export function sigPairSelected(
  a: SigComparison | string[] | undefined,
  b: SigComparison | string[] | undefined,
): boolean {
  const [c, pairs] = Array.isArray(a)
    ? [b as SigComparison, (a ?? []) as string[]]
    : [a as SigComparison, ((b ?? []) as string[])];
  const list = pairs ?? [];
  if (list.includes(sigPairKey(c)) || list.includes(c.key)) return true;
  const [x, y] = c.cells ? [c.cells[0].group, c.cells[1].group] : [c.group1, c.group2];
  return list.includes(pairKey(x, y)) || (list.includes(x) && list.includes(y));
}

/** The per-comparison keys of the comparisons `sigPairs` selects, so a toggle
 *  in the Format panel can edit the selection explicitly — a group-pair spelling
 *  can't lose one row. */
export function expandSigPairs(comparisons: SigComparison[], sigPairs: string[]): string[] {
  return comparisons.filter((c) => sigPairSelected(c, sigPairs)).map((c) => c.key);
}

/** Pull the drawable pairwise comparisons out of an analysis outcome. Post-hoc
 *  tests (ANOVA/Kruskal-Wallis) expose a `comparisons` table directly; a plain
 *  two-group test has its own P value (`headline`, beside its F test), the one
 *  comparison between the two groups it compared. Everything else (descriptives,
 *  one-sample, an ANOVA with no post-hoc) yields nothing to annotate. */
export function deriveComparisons(outcome: AnalysisOutcome | null, analysisId?: string): SigComparison[] {
  if (!outcome || "error" in outcome) return [];
  if (outcome.comparisons?.length) {
    // A pair of columns, or of a grouped table's cells (a per-row test's group2 is blank:
    // its cells say which two it compared).
    return outcome.comparisons
      .filter((c) => c.group2 || c.cells)
      .map((c) => ({
        key: pairKey(c.group1, c.group2),
        group1: c.group1,
        group2: c.group2,
        p: c.p,
        ...(c.cells ? { cells: c.cells } : {}),
        ...(analysisId ? { analysisId } : {}),
      }));
  }
  if (outcome.testType === "compare-two-groups" && outcome.groups.length === 2) {
    const [group1, group2] = outcome.groups.map((g) => g.name);
    return [
      {
        key: pairKey(group1, group2),
        group1,
        group2,
        p: headline(outcome.stats),
        ...(analysisId ? { analysisId } : {}),
      },
    ];
  }
  return [];
}

/** The highest drawn Y for each column, so a bracket can clear the actual marks —
 *  bars/points/whiskers AND the error-bar cap. `mean-error` draws only the center
 *  ± error, so its top is center+error; the point/box families also draw every raw
 *  value, so their top includes the data max. Aligned to `columns` order. */
function columnTops(
  columns: Column[],
  graphType: GraphType,
  center: GraphOptions["center"],
  error: GraphOptions["error"],
  styles?: Record<string, SeriesStyle>,
): number[] {
  const middle = centers(columns, center, styles);
  const err = errors(columns, error, middle, styles);
  return columns.map((c, i) => {
    if (c.values.length === 0 || Number.isNaN(middle[i])) return 0;
    const errTop = middle[i] + (err?.error[i] ?? 0);
    return graphType === "mean-error" ? errTop : c.values.reduce((a, b) => Math.max(a, b), errTop);
  });
}

/** Where a bracket can start or end: a column, or a group at a row (`spotKey`); its X on
 *  the axis, and the top of what is drawn there. */
interface Spot {
  key: string;
  x: number;
  top: number;
  /** Its center as drawn (mean or median): letters start from the highest. */
  mid: number;
}

/** A grouped table's cell, as a spot's key. */
const spotKey = (group: string, row: number) => `${group}\u0000${row}`;

/** Build Plotly `shapes` + `annotations` (data coordinates) for the selected comparisons,
 *  each between its two spots (`ends`), plus the highest Y used so the caller can extend the
 *  axis to fit. A bracket clears what is drawn under it: every column's top (`local` false,
 *  a column graph) or the tops between its ends (a grouped graph, whose rows differ);
 *  brackets overlapping in X stack on levels, the narrowest lowest. Comparisons whose ends
 *  aren't both drawn, or with no P value, are skipped. On a log Y axis the spacing is
 *  reckoned in log10, so it looks the same at any height: shapes take values, texts the
 *  log10 of them (`onAxis`). */
function significanceOverlay(
  spots: Spot[],
  comparisons: (SigComparison & { ends: [string, string] })[],
  display: GraphOptions["sigDisplay"],
  scale: GraphOptions["yScale"],
  local: boolean,
): { shapes: unknown[]; annotations: unknown[]; top: number; topMargin?: number } {
  const log = scale !== "linear";
  const lift = (t: number) => (log ? (t > 0 ? Math.log10(t) : -Infinity) : t);
  const tops = spots.map((s) => lift(s.top)).filter(Number.isFinite);
  const value = (y: number) => (log ? 10 ** y : y);
  const maxTop = log ? Math.max(...tops) : Math.max(0, ...tops);
  const at = new Map(spots.map((s) => [s.key, s]));
  const resolved = comparisons
    .map((c) => ({ ...c, a: at.get(c.ends[0]), b: at.get(c.ends[1]) }))
    .filter((c) => c.a && c.b && c.p != null && !Number.isNaN(c.p))
    .map((c) => ({ ...c, lo: Math.min(c.a!.x, c.b!.x), hi: Math.max(c.a!.x, c.b!.x) }))
    // Narrowest span first, so short brackets sit low and wide ones rise above them.
    .sort((a, b) => a.hi - a.lo - (b.hi - b.lo));

  if (resolved.length === 0 || !tops.length) return { shapes: [], annotations: [], top: value(maxTop) };

  // Stack unit scaled to the data extent (so spacing looks right at any scale).
  const floor = log ? Math.min(...tops) : Math.min(0, ...tops);
  const unit = log
    ? Math.max((maxTop - floor) * 0.08, 0.1)
    : Math.max((maxTop - floor) * 0.08, Math.abs(maxTop) * 0.05, 0.5);
  // What a bracket clears: everything, or what is drawn between its ends.
  const baseOf = (lo: number, hi: number) =>
    local
      ? Math.max(
          ...spots
            .filter((s) => s.x >= lo - 1e-9 && s.x <= hi + 1e-9)
            .map((s) => lift(s.top))
            .filter(Number.isFinite),
        )
      : maxTop;

  // Interval-graph packing: each bracket takes the lowest free level (no X overlap).
  const levels: [number, number][][] = [];
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  let top = maxTop;

  const stars = display === "stars";
  for (const c of resolved) {
    let level = levels.findIndex((band) => band.every(([lo, hi]) => c.hi < lo || c.lo > hi));
    if (level === -1) {
      level = levels.length;
      levels.push([]);
    }
    levels[level].push([c.lo, c.hi]);

    // Base gap above what it clears, then extra room per stacked level so brackets never
    // crowd each other (a bigger star label needs the headroom).
    const yL = baseOf(c.lo, c.hi) + unit * (1 + level * 1.7);
    const line = { color: INK, width: 1.2 };
    shapes.push(
      { type: "line", xref: "x", yref: "y", x0: c.lo, x1: c.hi, y0: value(yL), y1: value(yL), line, layer: "above" },
      {
        type: "line",
        xref: "x",
        yref: "y",
        x0: c.lo,
        x1: c.lo,
        y0: value(yL),
        y1: value(yL - unit * 0.35),
        line,
        layer: "above",
      },
      {
        type: "line",
        xref: "x",
        yref: "y",
        x0: c.hi,
        x1: c.hi,
        y0: value(yL),
        y1: value(yL - unit * 0.35),
        line,
        layer: "above",
      },
    );
    annotations.push({
      xref: "x",
      yref: "y",
      x: (c.lo + c.hi) / 2,
      // Stars are drawn larger to match the P-value text and sit snug on the
      // bracket; the P-value label keeps a hair of breathing room.
      y: yL + unit * (stars ? 0.02 : 0.08),
      text: stars ? pStars(c.p) : display === "pvalue-eq" ? pEquals(c.p) : pText(c.p),
      showarrow: false,
      yanchor: "bottom",
      font: { color: INK, size: stars ? 19 : 14 },
    });
    top = Math.max(top, yL + unit * 1.6); // headroom for the bracket + its label
  }

  return { shapes, annotations, top: value(top) };
}

/** Where a comparison's two ends are drawn: its two columns, or its two cells. */
const endsOf = (c: SigComparison): [string, string] =>
  c.cells
    ? [spotKey(c.cells[0].group, c.cells[0].row), spotKey(c.cells[1].group, c.cells[1].row)]
    : [c.group1, c.group2];

/** The families a set of comparisons makes, each compared among itself: every group of a
 *  column graph; a grouped table's groups within a row, or rows within a group. */
function familiesOf(comparisons: SigComparison[]): Map<string, SigComparison[]> {
  const families = new Map<string, SigComparison[]>();
  for (const c of comparisons) {
    const [a, b] = c.cells ?? [];
    const family = !a || !b ? "" : a.row === b.row ? `row ${a.row}` : `group ${a.group}`;
    families.set(family, [...(families.get(family) ?? []), c]);
  }
  return families;
}

/** The comparisons letters are drawn from: every pair of ONE analysis — with
 *  several sources, only the first one's (a second analysis's pairs are a
 *  different family, and mixing them would letter the wrong groups). */
export function lettersComparisons(all: SigComparison[]): SigComparison[] {
  const primary = all.find((c) => c.analysisId)?.analysisId;
  return primary ? all.filter((c) => !c.analysisId || c.analysisId === primary) : all;
}
export function lettersFit(comparisons: SigComparison[]): boolean {
  if (!comparisons.length) return false;
  return [...familiesOf(comparisons).values()].every((family) => {
    const members = new Set(family.flatMap(endsOf));
    const pairs = new Set(family.map((c) => endsOf(c).sort().join("\u0001")));
    return pairs.size === (members.size * (members.size - 1)) / 2;
  });
}

/** The compact letter display of one family (Piepho's insert-absorb, 2004): two members
 *  sharing a letter don't differ significantly (P ≥ 0.05). `order`: the members from the
 *  highest center down, so "a" goes to the highest. */
export function compactLetters(order: string[], differ: [string, string][]): Map<string, string> {
  let sets: Set<string>[] = [new Set(order)];
  for (const [i, j] of differ) {
    // Split every set holding both, then drop the sets another one holds.
    sets = sets.flatMap((s) =>
      s.has(i) && s.has(j) ? [new Set([...s].filter((m) => m !== i)), new Set([...s].filter((m) => m !== j))] : [s],
    );
    sets = sets.filter(
      (s, k) => !sets.some((t, l) => l !== k && [...s].every((m) => t.has(m)) && (t.size > s.size || l < k)),
    );
  }
  const rank = (s: Set<string>) => Math.min(...[...s].map((m) => order.indexOf(m)));
  sets.sort((a, b) => rank(a) - rank(b));
  const letter = (k: number) =>
    k < 26 ? String.fromCharCode(97 + k) : `${String.fromCharCode(97 + (k % 26))}${Math.floor(k / 26)}`;
  return new Map(order.map((m) => [m, sets.flatMap((s, k) => (s.has(m) ? [letter(k)] : [])).join("")]));
}

/** The font family a `lettersFont` choice draws with ("default" is the app's
 *  font, as everywhere else in the graph). */
export const LETTERS_FONT_FAMILIES: Record<GraphOptions["lettersFont"], string> = {
  default: FONT,
  arial: "Arial, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  times: "'Times New Roman', Times, serif",
  georgia: "Georgia, serif",
  courier: "'Courier New', Courier, monospace",
  verdana: "Verdana, sans-serif",
};

/** A Compact Letter Display string ("ab", "a1") as identifiers: upper or
 *  lower case, or numbers — each letter's 1-based index, comma-separated
 *  ("1, 2"). The inverse of the letter scheme in `compactLetters`: a lone
 *  letter is its place in the alphabet, a letter with digits adds 26 per
 *  overflow step ("a1" is the 27th letter). */
export function formatLetters(text: string, identifier: GraphOptions["lettersIdentifier"]): string {
  if (identifier === "upper") return text.toUpperCase();
  if (identifier === "lower") return text;
  return [...text.matchAll(/[a-z]\d*/g)]
    .map((m) => {
      const token = m[0];
      const extra = token.length > 1 ? Number.parseInt(token.slice(1), 10) : 0;
      return String(token.charCodeAt(0) - 97 + 26 * extra + 1);
    })
    .join(", ");
}

/** The automatic letters size (Prism's "Automatically determine the font"):
 *  smaller with more groups, so a crowded graph's letters still fit. */
export function lettersAutoSize(nGroups: number): number {
  return nGroups <= 4 ? 14 : nGroups <= 8 ? 12 : nGroups <= 12 ? 10 : 8;
}

/** The direction the letters actually draw in: outside the graphing area
 *  only allows stacked (Prism's rule), and "auto" is horizontal above the
 *  data, stacked outside. */
export function resolveLettersDirection(
  location: GraphOptions["lettersLocation"],
  direction: GraphOptions["lettersDirection"],
): "horizontal" | "vertical-up" | "vertical-down" | "stacked" {
  if (location === "outside") return "stacked";
  return direction === "auto" ? "horizontal" : direction;
}

/** Letters over every member of each family, a little above what is drawn
 *  there — or outside the graphing area, in one row per letter (Prism's
 *  "Outside the graph" location, which only allows stacked letters arranged
 *  so each letter is at the same height across groups). `topMargin` is the
 *  top margin the figure needs for the outside rows, if any. */
function lettersOverlay(
  spots: Spot[],
  comparisons: SigComparison[],
  options: GraphOptions,
): { shapes: unknown[]; annotations: unknown[]; top: number; topMargin?: number } {
  const scale = options.yScale;
  const log = scale !== "linear";
  const lift = (t: number) => (log ? (t > 0 ? Math.log10(t) : -Infinity) : t);
  const tops = spots.map((s) => lift(s.top)).filter(Number.isFinite);
  const maxTop = log ? Math.max(...tops) : Math.max(0, ...tops);
  const floor = log ? Math.min(...tops) : Math.min(0, ...tops);
  const unit = log ? Math.max((maxTop - floor) * 0.08, 0.1) : Math.max((maxTop - floor) * 0.08, 0.5);
  const at = new Map(spots.map((s) => [s.key, s]));
  const annotations: unknown[] = [];
  let top = maxTop;
  let topMargin: number | undefined;
  if (lettersFit(comparisons)) {
    const location = options.lettersLocation ?? "above";
    const direction = resolveLettersDirection(location, options.lettersDirection ?? "auto");
    const identifier = options.lettersIdentifier ?? "lower";
    const families = [...familiesOf(comparisons).values()];
    const memberCount = new Set(families.flatMap((f) => [...new Set(f.flatMap(endsOf))])).size;
    const size = options.lettersFontAuto ? lettersAutoSize(memberCount) : (options.lettersSize ?? 14);
    const font = { family: LETTERS_FONT_FAMILIES[options.lettersFont ?? "default"], color: options.lettersColor ?? INK, size };
    const outside = location === "outside";
    // Outside, the rows stack in paper coordinates above the plot (the
    // first row closest to it); the row gap is one letter height plus
    // padding, in paper units of the plot's height.
    const plotHeight = Math.max(1, (options.height ?? 460) - 48);
    const rowGap = (size + 6) / plotHeight;
    const tokens = (text: string) => [...text.matchAll(/[a-z]\d*/g)].map((m) => m[0]);
    let rows = 0;
    for (const family of families) {
      const members = [...new Set(family.flatMap(endsOf))].filter((m) => at.has(m));
      const order = members.sort((a, b) => at.get(b)!.mid - at.get(a)!.mid);
      const differ = family.filter((c) => isSignificant(c.p)).map(endsOf);
      for (const [key, text] of compactLetters(order, differ)) {
        const spot = at.get(key)!;
        const pieces = direction === "stacked" ? tokens(text) : [text];
        rows = Math.max(rows, pieces.length);
        for (let i = 0; i < pieces.length; i++) {
          const piece = formatLetters(pieces[i]!, identifier);
          if (outside) {
            annotations.push({
              xref: "x",
              yref: "paper",
              x: spot.x,
              y: 1.03 + i * rowGap,
              text: piece,
              showarrow: false,
              xanchor: "center",
              yanchor: "bottom",
              font,
            });
            continue;
          }
          const y = lift(spot.top) + unit * (0.3 + 0.45 * i);
          if (!Number.isFinite(y)) continue;
          annotations.push({
            xref: "x",
            yref: "y",
            x: spot.x,
            y,
            text: piece,
            showarrow: false,
            xanchor: "center",
            yanchor: "bottom",
            ...(direction === "vertical-up" ? { textangle: 90 } : direction === "vertical-down" ? { textangle: -90 } : {}),
            font,
          });
          top = Math.max(top, y + unit);
        }
      }
    }
    if (outside) topMargin = (options.title ? 44 : 16) + rows * (size + 6) + 8;
  }
  return { shapes: [], annotations, top: log ? 10 ** top : top, ...(topMargin !== undefined ? { topMargin } : {}) };
}

/** The grouped graphs that draw stars: each group's values at a row stand side by side. */
export const GROUPED_STARS = new Set<GraphType>(["grouped-bars", "grouped-bars-scatter", "grouped-scatter", "grouped-box"]);

/** A grouped graph's spots: each group at each row, at its place on the axis (bars side by
 *  side in a row's slot, Plotly's 0.2 gap between rows; points and boxes at their offsets;
 *  "Separated", each group's own block), topped by its highest value or error bar. */
function groupedSpots(
  columns: Column[],
  graphType: GraphType,
  options: GraphOptions,
  titles?: (string | null)[],
): Spot[] {
  const groups = groupsOf(columns);
  const rows = rowCountOf(columns);
  const n = groups.length;
  const separated = options.groupLayout === "separated" ? separatedPositions(n, rowLabels(rows, titles)) : undefined;
  // Superimposed bars all stand at the row's center, so their brackets do too.
  const superimposed = options.groupLayout === "superimposed";
  const xOf = (g: number, r: number) =>
    separated
      ? separated.posOf(g, r)
      : superimposed
        ? r
        : graphType === "grouped-bars" || graphType === "grouped-bars-scatter"
          ? r - 0.4 + (0.8 * (g + 0.5)) / n
          : r + groupOffset(g, n);
  return groups.flatMap((group, g) => {
    // One group, one series: its center/error override governs every row, so a
    // bracket clears the marks as actually drawn.
    const { center, error } = perRowStats(
      group.columns,
      rows,
      seriesCenter(options.series, group.name, options.center),
      seriesError(options.series, group.name, options.error),
    );
    return Array.from({ length: rows }, (_, r) => {
      const values = group.columns.flatMap((c) => (c.byRow[r] == null ? [] : [c.byRow[r]!]));
      const bar = center[r] == null ? -Infinity : center[r]! + (error?.[r] ?? 0);
      const top = graphType === "grouped-bars" ? bar : Math.max(bar, ...values);
      return { key: spotKey(group.name, r), x: xOf(g, r), top, mid: center[r] ?? 0 };
    }).filter((s) => Number.isFinite(s.top));
  });
}

/** Draws the chosen comparisons as brackets above the columns (or a grouped graph's cells),
 *  growing the Y range to fit them — only while the Y max is on Auto: a manual max wins,
 *  and may clip. */
export function addSignificance(
  fig: GraphFigure,
  columns: Column[],
  graphType: GraphType,
  options: GraphOptions,
  comparisons: SigComparison[],
  titles?: (string | null)[],
) {
  const letters = options.sigDisplay === "letters";
  // Letters need every pair of ONE analysis (see lettersFit): with several
  // sources, only the first one's comparisons letter the graph — the rest
  // still draw their brackets, below.
  const selected = letters ? lettersComparisons(comparisons) : comparisons.filter((c) => sigPairSelected(c, options.sigPairs ?? []));
  if (!selected.length) return;
  const grouped = GROUPED_STARS.has(graphType);
  const middle = centers(columns, options.center, options.series);
  const spots = grouped
    ? groupedSpots(columns, graphType, options, titles)
    : columnTops(columns, graphType, options.center, options.error, options.series).map((top, i) => ({
        key: columns[i].name,
        x: i,
        top,
        mid: middle[i] ?? 0,
      }));
  const overlay = letters
    ? lettersOverlay(spots, selected, options)
    : significanceOverlay(
        spots,
        selected.map((c) => ({ ...c, ends: endsOf(c) })),
        options.sigDisplay,
        options.yScale,
        grouped,
      );
  fig.layout.shapes = [...((fig.layout.shapes as unknown[]) ?? []), ...overlay.shapes];
  fig.layout.annotations = [...((fig.layout.annotations as unknown[]) ?? []), ...overlay.annotations];
  // Outside letters live above the plot in paper coordinates, so the figure
  // needs a taller top margin to fit them (the layout's margin is already
  // applied by the time overlays run — see graph-figure.ts).
  if (overlay.topMargin !== undefined) {
    const margin = (fig.layout.margin ??= {}) as Record<string, unknown>;
    const t = typeof margin.t === "number" ? margin.t : 16;
    margin.t = Math.max(t, overlay.topMargin);
  }
  const yaxis = (fig.layout.yaxis ??= {}) as Record<string, unknown>;
  const range = (yaxis.autorangeoptions ??= {}) as Record<string, unknown>;
  range.include = overlay.top;
}
