// "Pie / donut": one slice per column, sized by the column's total (sum) or mean,
// each colored as a series. Donut is the same chart with a hole in the center.
// On a Parts-of-Whole table the slices are the rows of ONE data set — each
// row is a mutually exclusive category, and a pie shows one data set's
// fractions of its total (Prism: "only the values entered into column A
// will be automatically graphed"). The data set is the first one the graph
// shows (the Data sets picker chooses it); the rest are named on the figure.
import type { GraphOptions, TableType } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { PATTERN_LOOK, addNote, pieLayout, rowCountOf, rowLabels, type Paint } from "./plot-helpers";
import { num } from "../../lib/format";
import { mean } from "../../lib/summary";
import type { SummaryFormat } from "../../lib/summary-format";

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** A pie (or donut) of one Parts-of-Whole data set: its rows are the slices. */
function buildPowPie(
  columns: Column[],
  options: GraphOptions,
  paint: Paint,
  titles: (string | null)[] | undefined,
  hole: number,
): GraphFigure {
  const column = columns[0];
  const layout = pieLayout(options);
  const rows = column ? rowCountOf([column]) : 0;
  const labels = rowLabels(rows, titles);
  // Slices are the column's values by row (a blank is no slice); a negative
  // part is dropped and named, as on a column pie — Plotly would silently
  // recompute the rest over the remaining total.
  const slices = labels
    .map((label, r) => ({ label, r, value: column!.byRow[r] ?? null }))
    .filter((s) => s.value !== null);
  const kept = slices.filter((s) => s.value! >= 0);
  const dropped = slices.filter((s) => s.value! < 0);
  if (!kept.some((s) => s.value! > 0)) {
    const fig: GraphFigure = { data: [], layout };
    addNote(
      fig,
      dropped.length
        ? `${dropped.map((s) => `“${s.label}” (${num(s.value!)})`).join(", ")} omitted: a pie slice cannot be negative — and every other slice is zero or missing, so there is nothing to draw.`
        : "No positive slices to draw — every value is zero or missing.",
      options,
    );
    return fig;
  }
  // Slices take their category's fill, outline and pattern (none: "" draws nothing).
  const fills = kept.map((s) => paint.fill(s.label, s.r));
  const patterns = kept.map((s) => paint.pattern(s.label, s.r));
  const fig: GraphFigure = {
    data: [
      {
        type: "pie",
        hole,
        labels: kept.map((s) => s.label),
        values: kept.map((s) => s.value),
        marker: {
          colors: fills,
          line: { color: kept.map((s) => paint.edge(s.label, s.r).color), width: options.outline },
          ...(patterns.some(Boolean) && {
            pattern: {
              shape: patterns.map((p) => p?.shape ?? ""),
              fgcolor: patterns.map((p) => p?.fgcolor ?? ""),
              bgcolor: patterns.map((p, i) => p?.bgcolor ?? fills[i]),
              ...PATTERN_LOOK,
            },
          }),
        },
        textinfo: options.pieShowPercent ? "label+percent" : "label+value",
        textposition: "auto",
        automargin: true,
        sort: false,
        hoverinfo: "label+value+percent",
      },
    ],
    layout,
  };
  const notes: string[] = [];
  if (columns.length > 1)
    notes.push(
      `Only “${column!.name}” is shown — a pie chart shows one data set; make another pie graph for ${columns
        .slice(1)
        .map((c) => `“${c.name}”`)
        .join(", ")}.`,
    );
  if (dropped.length)
    notes.push(
      `${dropped.map((s) => `“${s.label}” (${num(s.value!)})`).join(", ")} omitted: a pie slice cannot be negative, so it is not drawn. Percentages are of the remaining slices.`,
    );
  if (notes.length) addNote(fig, notes.join(" "), options);
  return fig;
}

function makePie(hole: number, label: string): GraphModule {
  const build = (
    columns: Column[],
    options: GraphOptions,
    paint: Paint,
    titles?: (string | null)[],
    _summary?: SummaryFormat,
    tableType?: TableType,
  ): GraphFigure => {
    if (tableType === "parts-of-whole") return buildPowPie(columns, options, paint, titles, hole);
    const values = columns.map((c) => (options.pieValue === "mean" ? mean(c.values) : sum(c.values)));
    // Plotly silently drops a negative slice and recomputes the rest over
    // the remaining total — [30, -10, 20] renders as A 75% + C 50% = 125%
    // with no error (runtime check, Plotly 4.1.2, R2-G-F12). A pie slice
    // cannot be negative, so drop those columns and name them on the
    // figure; percentages are then of the remaining slices, and the note
    // says so. Zero slices are fine as-is (0%, and the rest still sum
    // to 100%), so only negatives are dropped.
    // Non-finite values (mean of an empty column is NaN) pass through to
    // Plotly as before — it drops them and the rest still sum to 100%;
    // only negatives corrupt the percentages, so only they are dropped.
    const kept = columns
      .map((column, index) => ({ column, index, value: values[index] }))
      .filter((s) => s.value >= 0 || Number.isNaN(s.value));
    const dropped = columns
      .map((column, index) => ({ column, value: values[index] }))
      .filter((s) => s.value < 0);
    const layout = pieLayout(options);
    if (!kept.some((s) => s.value > 0)) {
      // Nothing drawable: every value is zero or negative. An empty pie
      // with no explanation is the same silent failure, so say why.
      const fig: GraphFigure = { data: [], layout };
      addNote(
        fig,
        dropped.length
          ? `${dropped.map((s) => `“${s.column.name}” (${num(s.value)})`).join(", ")} omitted: a pie slice cannot be negative — and every other slice is zero or missing, so there is nothing to draw.`
          : "No positive slices to draw — every value is zero or missing.",
        options,
      );
      return fig;
    }
    // Slices take their series' fill, outline and pattern (none: "" draws nothing).
    // Paint by the column's original index, so dropping a slice in the
    // middle does not recolor the slices after it.
    const fills = kept.map((s) => paint.fill(s.column.name, s.index));
    const patterns = kept.map((s) => paint.pattern(s.column.name, s.index));
    const fig: GraphFigure = {
      data: [
        {
          type: "pie",
          hole,
          labels: kept.map((s) => s.column.name),
          values: kept.map((s) => s.value),
          // By default, solid slices that a thin white gap separates.
          marker: {
            colors: fills,
            line: { color: kept.map((s) => paint.edge(s.column.name, s.index).color), width: options.outline },
            ...(patterns.some(Boolean) && {
              pattern: {
                shape: patterns.map((p) => p?.shape ?? ""),
                fgcolor: patterns.map((p) => p?.fgcolor ?? ""),
                bgcolor: patterns.map((p, i) => p?.bgcolor ?? fills[i]),
                ...PATTERN_LOOK,
              },
            }),
          },
          textinfo: options.pieShowPercent ? "label+percent" : "label+value",
          textposition: "auto",
          automargin: true, // labels drawn outside a thin slice widen the margins
          // Keep the table's column order (Prism-style) rather than sorting by size.
          sort: false,
          hoverinfo: "label+value+percent",
        },
      ],
      layout,
    };
    if (dropped.length) {
      addNote(
        fig,
        `${dropped.map((s) => `“${s.column.name}” (${num(s.value)})`).join(", ")} omitted: a pie slice cannot be negative, so it is not drawn. Percentages are of the remaining slices.`,
        options,
      );
    }
    return fig;
  };
  // Solid slices (Titer 1.0's too) apart by a white outline.
  return {
    label,
    family: "pie",
    axes: () => ({}),
    defaults: { fill: 1, outlineColor: "#FFFFFF" },
    patterns: () => true,
    build,
  };
}

export const pie = makePie(0, "Pie");
export const donut = makePie(0.5, "Donut");
