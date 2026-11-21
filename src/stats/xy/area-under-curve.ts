// Area under the curve for an XY table: trapezoidal-rule AUC of each Y series against X,
// measured from a horizontal baseline (Prism's "Baseline Y =", default 0), computed by R.
// Peak options (Prism's AUC dialog): ignore peaks smaller than a % of the Y range, and
// count only peaks above the baseline (area below it ignored, not negative).
import type { AnalysisOutcome, AreaUnderCurveParams, AreaUnderCurveRow, Column } from "../types";
import { describe, rVec } from "../column/base";
import { splitXY, xyProblem, xyRows } from "../../lib/dataset";
import { evalNamedVector } from "../webr";

export async function runAreaUnderCurve(
  columns: Column[],
  params: AreaUnderCurveParams | undefined,
): Promise<AnalysisOutcome> {
  const baseline = params?.baseline ?? 0;
  if (!Number.isFinite(baseline)) return { error: "The baseline must be a finite number." };
  const ignorePeaksBelow = params?.ignorePeaksBelow ?? 0;
  if (!Number.isFinite(ignorePeaksBelow) || ignorePeaksBelow < 0 || ignorePeaksBelow > 100)
    return { error: "“Ignore peaks smaller than” must be between 0 and 100% of the Y range." };
  const aboveOnly = params?.peaksAboveBaselineOnly === true;
  const { x: xCol, ys: yCols } = splitXY(columns);
  if (!xCol || yCols.length < 1) return { error: xyProblem(columns)! };

  // Each series' points sorted by X, a row's replicates as their mean (by R); heights from
  // the baseline, so area below it is negative — unless peaks-above-baseline-only clips
  // heights at 0 first. A peak is a maximal run of points above the baseline; a run whose
  // highest point is under `ignorePeaksBelow`% of the series' Y range (max − min of the
  // per-X means) has its heights zeroed, so it contributes no area. The threshold is 0
  // when the option is off, and a run's height is always > 0, so nothing is ever ignored
  // then. The function returns c(area, ignored-peaks) per series.
  const rows = yCols.map((y) => xyRows(xCol, y));
  const means = (values: number[][]) => `sapply(list(${values.map(rVec).join(",")}),mean)`;
  const v = await evalNamedVector(
    `auc<-function(x,y){if(length(x)<2)return(c(NA,0));o<-order(x);x<-x[o];y<-y[o];h<-y-${baseline};` +
      `if(${aboveOnly ? "TRUE" : "FALSE"})h<-pmax(h,0);` +
      `ig<-0;if(${ignorePeaksBelow}>0){thr<-${ignorePeaksBelow}/100*(max(y)-min(y));r<-rle(h>0);` +
      `e<-cumsum(r$lengths);s<-e-r$lengths+1;` +
      `for(k in seq_along(r$values))if(r$values[k]){idx<-s[k]:e[k];if(max(h[idx])<thr){h[idx]<-0;ig<-ig+1}}};` +
      `c(sum(diff(x)*(head(h,-1)+tail(h,-1))/2),ig)};` +
      `c(${rows.map((p, i) => `a_${i}=auc(${rVec(p.x)},${means(p.values)})[1],ig_${i}=auc(${rVec(p.x)},${means(p.values)})[2],n_${i}=${p.x.length}`).join(",")})`,
  );
  const areas: AreaUnderCurveRow[] = yCols.map((y, i) => ({
    variable: y.name,
    area: v[`a_${i}`] ?? null,
    n: v[`n_${i}`] ?? 0,
  }));
  const ignored = yCols.map((_, i) => v[`ig_${i}`] ?? 0);

  const peakNotes =
    (aboveOnly ? " Only peaks above the baseline count — area below the baseline is ignored, not negative." : "") +
    (ignorePeaksBelow > 0
      ? ` Peaks lower than ${ignorePeaksBelow}% of the Y range are ignored` +
        ignored.map((n, i) => ` (${n} in “${yCols[i].name}”)`).join("") +
        "."
      : "");
  return {
    testType: "area-under-curve",
    subtitle: `Area under the curve (trapezoidal rule, baseline Y = ${baseline})`,
    stats: [],
    groups: (
      await describe([xCol, ...yCols.map((y) => ({ name: y.name, values: y.columns.flatMap((c) => c.values) }))])
    ).groups,
    notes:
      `Trapezoidal-rule area under the curve for each Y data set vs. X, measured from a baseline of Y = ${baseline}. ` +
      (aboveOnly
        ? "Area below the baseline counts as zero."
        : "Area below the baseline counts as negative.") +
      " Points are sorted by X first, replicates as their mean; a data set needs at least 2 points." +
      peakNotes,
    areas,
  };
}
