// "Bubble plot" (Prism 9, Multiple Variables tables): X and Y set each point's
// location; a third variable sets its symbol's size (area ∝ value, so the diameter
// grows with the square root) and a fourth, optionally, its color — a gradient for
// numbers, one palette color per distinct value for text (GraphPad FAQ 572).
// A row drops when its size is not a positive number, and the figure says how many.
import type { GraphOptions } from "../../store/types";
import type { GraphModule, GraphFigure } from ".";
import type { Column } from "../../lib/dataset";
import { pointKeyOf } from "../../lib/columns";
import { colorscaleOf, paletteColor, paletteOf, withOpacity } from "../../lib/palettes";
import { addNote, xyLayout, type Paint } from "./plot-helpers";
import { XY_SCATTER_MAX_POINTS } from "./xy-scatter";

/** The smallest bubble, in px of diameter, so a tiny value stays visible. */
const BUBBLE_MIN_SIZE = 3;

function build(columns: Column[], options: GraphOptions, paint: Paint, titles?: (string | null)[]): GraphFigure {
  const [xCol, yCol] = columns;
  const layout = xyLayout(options, xCol?.name ?? "X", 1, {
    yName: yCol?.name,
    seriesNames: yCol ? [yCol.name] : [],
  });
  if (!xCol || !yCol) return { data: [], layout };

  // The size and color columns, by name, else the ones plotColumns handed over
  // after X and Y (in that order): the third holding numbers sizes the bubbles
  // until one is chosen, and no color column colors them the series' color.
  const colorCol = columns.find((c) => c.name === options.bubbleColorVariable);
  const sizeCol =
    columns.find((c) => c.name === options.bubbleSizeVariable) ??
    columns.find((c) => c !== xCol && c !== yCol && c !== colorCol);
  const yName = yCol.name;
  const maxSize = options.bubbleMaxSize;

  // One point per row holding X and Y; a row whose size is not a positive number
  // drops (a size of 0 or a blank has no area to draw), and is counted, not silent.
  const points: {
    x: number;
    y: number;
    row: number;
    size: number;
    colorValue: number | null;
    colorText: string;
    hover: string;
  }[] = [];
  let dropped = 0;
  const n = Math.max(xCol.cells.length, yCol.cells.length);
  const keptSizes: number[] = [];
  for (let r = 0; r < n; r++) {
    const xv = xCol.byRow[r] ?? null;
    const yv = yCol.byRow[r] ?? null;
    if (xv == null || yv == null || !Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    const sv = sizeCol ? (sizeCol.byRow[r] ?? null) : null;
    if (sizeCol && (sv == null || !Number.isFinite(sv) || sv <= 0)) {
      dropped++;
      continue;
    }
    if (sv != null) keptSizes.push(sv);
    const title = titles?.[r]?.trim() ? titles[r]!.trim() : `Row ${r + 1}`;
    const hover = [
      title,
      `${xCol.name}: ${xv}`,
      `${yCol.name}: ${yv}`,
      ...(sizeCol ? [`${sizeCol.name}: ${sv}`] : []),
      ...(colorCol ? [`${colorCol.name}: ${String(colorCol.cells[r] ?? "").trim()}`] : []),
    ].join("<br>");
    points.push({
      x: xv,
      y: yv,
      row: r,
      size: sv ?? NaN, // scaled below, once the largest size is known
      colorValue: colorCol ? (colorCol.byRow[r] ?? null) : null,
      colorText: colorCol ? String(colorCol.cells[r] ?? "").trim() : "",
      hover,
    });
  }

  // Area ∝ value, so the diameter grows with its square root; the largest value
  // takes the max size, the smallest no less than 3 px. Without a size column
  // every bubble is the same, half the max — a scatter with uniform symbols.
  const vmax = keptSizes.length ? Math.max(...keptSizes) : 0;
  for (const p of points) {
    p.size = sizeCol && vmax > 0 ? Math.max(BUBBLE_MIN_SIZE, maxSize * Math.sqrt(p.size / vmax)) : maxSize / 2;
  }

  const fig: GraphFigure = { data: [], layout };
  if (dropped > 0) {
    addNote(
      fig,
      `${dropped} row${dropped === 1 ? "" : "s"} dropped: no positive ${sizeCol?.name ?? "size"} value.`,
      options,
    );
  }
  if (points.length === 0) return fig;

  // The cap is on the total plotted, as the scatter's: stride-thin, and say so.
  const stride = points.length > XY_SCATTER_MAX_POINTS ? Math.ceil(points.length / XY_SCATTER_MAX_POINTS) : 1;
  const drawn = stride === 1 ? points : points.filter((_, i) => i % stride === 0);

  // Color: a numeric color variable colors along the graph's palette gradient
  // (with its scale, titled by the variable), a text one one palette color per
  // distinct value; else the series' color. A point styled one by one wins over
  // its color, size, shape, fill and outline — except over a numeric gradient,
  // where a hand-picked color would break the scale.
  const palette = paletteOf(options);
  const numericColor = !!colorCol && drawn.every((p) => p.colorValue != null);
  const groups = numericColor ? [] : [...new Set(drawn.map((p) => p.colorText))];
  const baseColor = paint.dot(yName, 0);
  const baseShape = paint.shape(yName);
  const keys = drawn.map((p) => pointKeyOf(yName, p.row));
  const own = keys.map((k) => options.points?.[k]);
  const anyOwnColor = own.some((o) => o?.color !== undefined);
  const anyOwnShape = own.some((o) => o?.shape !== undefined);
  const anyOwnOutline = own.some((o) => o?.outline !== undefined || o?.outlineColor !== undefined);
  const colorOf = (p: (typeof drawn)[number], i: number): string => {
    const o = own[i];
    if (o?.color !== undefined && !numericColor) return o.color;
    if (numericColor) return baseColor; // unused: the values array colors it
    if (colorCol) return paletteColor(palette, groups.indexOf(p.colorText), groups.length);
    return baseColor;
  };
  const markerColor: unknown = numericColor
    ? drawn.map((p) => p.colorValue)
    : anyOwnColor || colorCol
      ? drawn.map((p, i) => withOpacity(colorOf(p, i), own[i]?.fill ?? options.pointFill))
      : baseColor;
  const marker = {
    color: markerColor,
    size: drawn.map((p, i) => own[i]?.size ?? p.size),
    sizemode: "diameter" as const,
    symbol: anyOwnShape ? drawn.map((_, i) => own[i]?.shape ?? baseShape) : baseShape,
    line: {
      color: anyOwnOutline
        ? drawn.map((p, i) => paint.outlineColor(colorOf(p, i), own[i]?.outlineColor))
        : paint.outlineColor(baseColor),
      width: anyOwnOutline ? drawn.map((_, i) => own[i]?.outline ?? paint.outline) : paint.outline,
    },
    ...(numericColor
      ? {
          colorscale: colorscaleOf(palette),
          showscale: true,
          colorbar: { title: { text: colorCol!.name } },
        }
      : {}),
  };

  fig.data = [
    {
      type: "scatter",
      mode: "markers",
      name: yName,
      x: drawn.map((p) => p.x),
      y: drawn.map((p) => p.y),
      customdata: keys,
      text: drawn.map((p) => p.hover),
      hoverinfo: "text",
      marker,
      showlegend: false,
    },
  ];
  if (stride > 1) {
    addNote(
      fig,
      `Large series thinned for speed: showing 1 in ${stride} points (${drawn.length} of ${points.length} plotted).`,
      options,
    );
  }
  return fig;
}

export const bubblePlot: GraphModule = {
  label: "Bubble plot",
  family: "xy",
  points: () => true,
  build,
};
