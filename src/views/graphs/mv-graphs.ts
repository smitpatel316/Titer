// The Multiple Variables graph kinds Prism 11.1 added (seq 209): Prism-named
// variants of shapes Titer already draws for other tables. Each reuses an
// existing builder — the shapes are the same, only the table they are offered
// from and the defaults differ (Prism's MV bar chart shows the mean with SD
// error bars; the strip plots show the individual values). The before-after
// bar-and-strip variant has its own builder in before-after.ts (bars +
// paired-subject lines); the rest are thin wrappers so the picker shows
// Prism's names.
import type { GraphModule } from ".";
import { individual } from "./individual";
import { beforeAfter, mvBeforeAfterBarStrip } from "./before-after";
import { boxViolin } from "./box-violin";
import { meanError } from "./mean-error";

/** Strip plot: a column scatter of one variable — each variable a column of
 *  its subjects' values, with a center line. */
export const mvStripPlot: GraphModule = {
  ...individual,
  label: "Strip plot",
};

/** Summary symbol plot: the mean (or median) with error bars, drawn as a
 *  symbol — the point form of Mean-or-median-and-error. */
export const mvSummarySymbol: GraphModule = {
  ...meanError,
  label: "Summary symbol plot",
  defaults: { ...meanError.defaults, shape: "point", center: "mean", error: "sd" },
};

/** Bar and strip plot: bars at each variable's center with the individual
 *  values plotted over them — Individual values with its bars on. */
export const mvBarStrip: GraphModule = {
  ...individual,
  label: "Bar and strip plot",
  defaults: { ...individual.defaults, bars: true, center: "mean", error: "sd" },
};

/** Before-after bar and strip plot: paired bars + strip (see before-after.ts). */
export const mvBeforeAfterBarStripPlot: GraphModule = mvBeforeAfterBarStrip;

/** Before-after strip plot: one line per subject through its paired values. */
export const mvBeforeAfterStrip: GraphModule = {
  ...beforeAfter,
  label: "Before-after strip plot",
};

/** Box and whisker chart: a box per variable. */
export const mvBoxWhisker: GraphModule = {
  ...boxViolin,
  label: "Box and whisker chart",
  defaults: { ...boxViolin.defaults, kind: "box" },
};

/** Violin plot: a violin per variable. */
export const mvViolin: GraphModule = {
  ...boxViolin,
  label: "Violin plot",
  defaults: { ...boxViolin.defaults, kind: "violin" },
};

/** Bar chart: the mean with SD error bars, drawn as bars — the bar form of
 *  Mean-or-median-and-error (Prism's MV dialog defaults: Summary metric Mean,
 *  Error bar type Mean with SD). */
export const mvBarChart: GraphModule = {
  ...meanError,
  label: "Bar chart",
  defaults: { ...meanError.defaults, shape: "bar", center: "mean", error: "sd" },
};
