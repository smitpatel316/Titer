// The results of an analysis, laid out like a short report (no title: the toolbar names
// it): the data analyzed, what it means in plain words (with a Significant / Not
// significant pill when it has one P value), its checks, its key statistics, then one
// compact table per part of the result, the descriptive statistics, and the
// notes. Numbers keep same-width digits so columns line up; everything is selectable.
import type * as React from "react";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react";
import type { AnalysisResult, Analyzed, Check, GroupDescriptives, StatRow } from "../../stats/types";
import type { TableData, TableType } from "../../store/types";
import { Button, cn } from "../../ui/controls";
import { isSignificant, num, pStars, pValue } from "../../lib/format";

/** A P value with its stars, green when significant. */
function P({ p }: { p: number | null | undefined }) {
  if (p == null || Number.isNaN(p)) return <>—</>;
  return (
    <span className={isSignificant(p) ? "text-support-green" : "text-secondary"}>
      {pValue(p)} {pStars(p)}
    </span>
  );
}

/** Whether a normality test's P is consistent with the distribution: here a small P is a No. */
const verdict = (p: number | null) => (p == null ? "—" : p > 0.05 ? "Yes" : <span className="text-secondary">No</span>);

type Column = { label: string; numeric?: boolean };

/** One part of the result: a titled table, as wide as its content. The first
 *  column names the rows; numeric columns align right. */
function Table({ title, columns, rows }: { title?: string; columns: Column[]; rows: React.ReactNode[][] }) {
  const hasHeader = columns.some((c) => c.label);
  return (
    <section className="flex flex-col gap-2">
      {title && <h3 className="text-strong">{title}</h3>}
      <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-separator">
        <table className="border-collapse">
          {hasHeader && (
            <thead>
              <tr className="border-b border-separator">
                {columns.map((c, i) => (
                  <th
                    key={i}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap text-small-strong text-secondary",
                      c.numeric ? "text-right" : "text-left",
                    )}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="even:bg-control">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-3 py-1.5 whitespace-nowrap",
                      columns[j]?.numeric ? "text-right" : "text-left",
                      j === 0 && hasHeader && "pr-6",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The data the analysis ran on: its data sets, each a tag with its count, how they're
 *  compared, and the table's others it left out. */
function AnalyzedView({ analyzed: { sets, how, detail, left } }: { analyzed: Analyzed }) {
  const tag = (s: Analyzed["sets"][number]) => (
    <span key={s.name} className="rounded-md bg-control px-2 py-0.5 whitespace-nowrap">
      <span className="text-strong">{s.name}</span>
      {s.n != null && <span className="text-secondary"> n = {s.n}</span>}
    </span>
  );
  const between = how === "vs" ? "vs." : how === "paired" ? "→" : null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-strong">Data analyzed</h3>
      <div className="flex flex-wrap items-center gap-2">
        {how === "control" && sets.length > 1 ? (
          <>
            {tag(sets[0])}
            <span className="text-secondary">vs. each of</span>
            {sets.slice(1).map(tag)}
          </>
        ) : (
          sets.map((s, i) => [
            i > 0 && between && (
              <span key={`${s.name}-to`} className="text-secondary">
                {between}
              </span>
            ),
            tag(s),
          ])
        )}
        {detail && <span className="text-secondary">{detail}</span>}
      </div>
      {left.length > 0 && <p className="text-small text-secondary">Not included: {left.join(", ")}</p>}
    </section>
  );
}

/** The test's conditions, checked by R: a green tick when one holds, an orange warning when
 *  it may not. */
function Checks({ checks }: { checks: Check[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-strong">Checks</h3>
      <ul className="flex max-w-prose flex-col gap-1.5">
        {checks.map((c, i) => (
          <li key={i} className="flex gap-2">
            {c.ok ? (
              <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-support-green" />
            ) : (
              <WarningIcon className="mt-0.5 size-4 shrink-0 text-support-orange" />
            )}
            <span>{c.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The test's own P value, shown as Significant or not by the heading: its only one, or
 *  the one named "P value…" beside a side check (a t test's F test); none when it has
 *  several (one per group or factor). */
export function headline(stats: StatRow[]): number | null {
  const pRows = stats.filter((s) => s.p);
  const main = pRows.length === 1 ? pRows : pRows.filter((s) => s.label.startsWith("P value"));
  return main.length === 1 ? main[0].value : null;
}

/** The rows of the Descriptive statistics analysis, in order. */
// prettier-ignore
const DESCRIPTIVE_ROWS: [string, (g: GroupDescriptives) => React.ReactNode][] = [
  ["N", (g) => g.n],
  ["Sum", (g) => num(g.sum)],
  ["Mean", (g) => num(g.mean)],
  ["SD", (g) => num(g.sd)],
  ["SEM", (g) => num(g.sem)],
  ["95% CI of mean", (g) => (g.ciLow == null && g.ciHigh == null ? "—" : `${num(g.ciLow)} to ${num(g.ciHigh)}`)],
  ["Coefficient of variation", (g) => (g.cv == null ? "—" : `${num(g.cv)}%`)],
  ["Geometric mean", (g) => num(g.geoMean)],
  ["Skewness", (g) => num(g.skewness)],
  ["Kurtosis", (g) => num(g.kurtosis)],
  ["Minimum", (g) => num(g.min)],
  ["25th percentile", (g) => num(g.q1)],
  ["Median", (g) => num(g.median)],
  ["75th percentile", (g) => num(g.q3)],
  ["Maximum", (g) => num(g.max)],
  ["Range", (g) => num(g.range)],
];

/** `onCreateTable` (the analysis view wires it to the store) adds the
 *  extracted table to the project — without it (tests, static renders) the
 *  table is shown but the button is absent. */
export function AnalysisResultsView({
  result,
  onCreateTable,
}: {
  result: AnalysisResult;
  onCreateTable?: (tableType: TableType, table: TableData) => void;
}) {
  const headlineP = headline(result.stats);
  // Comparisons of means give their 95% CI (adjusted as their P is); ranks don't.
  // Correlations give theirs once the correlation engine emits them.
  const withCi = result.comparisons?.some((c) => c.low !== undefined) ?? false;
  // Multiple-t-tests flags each row significant or not (corrected P against
  // its threshold); other comparisons leave it unset, so the column only
  // appears when a row carries a flag.
  const withSignificant = result.comparisons?.some((c) => c.significant !== undefined) ?? false;
  // Multiple-t-tests carries each row's t and df (the rank tests have
  // neither) and its uncorrected P beside the corrected one — when a
  // correction was applied the table shows both P values, as Prism does.
  const withT = result.comparisons?.some((c) => c.t !== undefined) ?? false;
  const withDf = result.comparisons?.some((c) => c.df !== undefined) ?? false;
  const withAdjustedP =
    result.comparisons?.some((c) => c.rawP !== undefined && c.rawP !== c.p) ?? false;
  const withCorrCi = result.correlations?.some((c) => c.low !== undefined) ?? false;
  const showP = headlineP != null && !Number.isNaN(headlineP);
  const groups = result.groups;
  // The 95% CI and Min/Max/Range only come from the Descriptive statistics analysis.
  const showCi = groups.some((g) => g.ciLow != null || g.ciHigh != null);
  // The coefficient 95% CIs come from the nonlinear-fit runner — other
  // runners leave them undefined, so the "95% CI" column only fills then.
  // A Cox regression (plan 10) also carries a hazard ratio per coefficient —
  // its CI above is on the hazard-ratio scale.
  const showHr = (result.coefficients ?? []).some((c) => c.hazardRatio != null);
  const showRange = groups.some((g) => g.min != null || g.max != null || g.range != null);
  const matrix = result.matrix;

  return (
    <div className="flex max-w-4xl flex-col gap-7 px-8 py-6 text-regular text-primary tabular-nums select-text">
      {result.analyzed && <AnalyzedView analyzed={result.analyzed} />}

      {(result.summary || showP) && (
        <section className="flex flex-col gap-2">
          {/* The toolbar names the analysis: no title here, only whether its own P value is
              significant, beside what it means. */}
          <h3 className="flex items-center gap-2.5 text-strong">
            In plain words
            {showP && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-small-strong",
                  isSignificant(headlineP) ? "bg-support-green/15 text-support-green" : "bg-control text-secondary",
                )}
              >
                {isSignificant(headlineP) ? `Significant ${pStars(headlineP)}` : "Not significant"}
              </span>
            )}
          </h3>
          {result.summary && <p className="max-w-prose">{result.summary}</p>}
        </section>
      )}

      {result.checks && <Checks checks={result.checks} />}

      {result.normality && (
        <Table
          columns={[
            { label: "" },
            { label: "W", numeric: true },
            { label: "P value", numeric: true },
            { label: "Normal?" },
            { label: "W (log)", numeric: true },
            { label: "P value (log)", numeric: true },
            { label: "Lognormal?" },
          ]}
          rows={result.normality.map((r) => [
            r.group,
            num(r.w),
            r.p == null ? "—" : pValue(r.p),
            verdict(r.p),
            num(r.logW),
            r.logP == null ? "—" : pValue(r.logP),
            verdict(r.logP),
          ])}
        />
      )}

      {result.fit && (
        <Table
          title="Best-fit values"
          columns={[{ label: "" }, ...result.fit.sets.map((s) => ({ label: s, numeric: true }))]}
          rows={result.fit.rows.map((row) => [
            <span className="text-secondary">{row.label}</span>,
            ...(row.ranges?.map(([low, high]) => (low == null && high == null ? "—" : `${num(low)} to ${num(high)}`)) ??
              row.values!.map((v) => (row.p ? <P p={v} /> : num(v)))),
          ])}
        />
      )}

      {result.curveOutliers && result.curveOutliers.length > 0 && (
        <Table
          title="Outliers (left out of the fit)"
          columns={[
            { label: "" },
            ...(result.fit && result.fit.sets.length > 1 ? [{ label: "Data set" }] : []),
            { label: "X", numeric: true },
            { label: "Y", numeric: true },
          ]}
          rows={result.curveOutliers.map((o) => [
            o.label,
            ...(result.fit && result.fit.sets.length > 1 ? [o.set] : []),
            num(o.x),
            num(o.y),
          ])}
        />
      )}

      {result.interpolated && result.interpolated.length > 0 && (
        <Table
          title="Interpolated values"
          columns={[
            { label: "" },
            { label: "Y", numeric: true },
            { label: "X", numeric: true },
            ...(result.interpolated[0].concentration !== undefined
              ? [{ label: "Concentration (10^X)", numeric: true }]
              : []),
            ...(result.interpolated.some((u) => u.low != null || u.high != null)
              ? [{ label: "95% CI of X", numeric: true }]
              : []),
            { label: "" },
          ]}
          rows={result.interpolated.map((u) => [
            u.label,
            num(u.y),
            num(u.x),
            ...(u.concentration !== undefined ? [num(u.concentration)] : []),
            ...(result.interpolated!.some((w) => w.low != null || w.high != null)
              ? [u.low == null && u.high == null ? "—" : `${num(u.low)} to ${num(u.high)}`]
              : []),
            <span className="text-secondary">{u.extrapolated ? "extrapolated" : ""}</span>,
          ])}
        />
      )}

      {result.transformed &&
        result.transformed.map((t) => (
          <Table
            key={t.column}
            title={
              result.transformed!.length > 1
                ? `Transformed values — ${t.column}`
                : `Transformed values — ${t.label}(${t.column})`
            }
            columns={[
              { label: "Row" },
              { label: t.column, numeric: true },
              { label: `${t.label}(${t.column})`, numeric: true },
            ]}
            rows={t.original.flatMap((original, i) =>
              original == null
                ? []
                : [
                    [
                      String(i + 1),
                      num(original),
                      t.values[i] == null ? <span className="text-secondary">—</span> : num(t.values[i]),
                    ],
                  ],
            )}
          />
        ))}

      {/* The equation is its own wrapping block, not a row of the stats table:
          a long equation (the Operational model's is 183 chars) in a
          whitespace-nowrap table stretches the table past the window and
          pushes the right-aligned stats values off-screen (F-01). */}
      {result.equation && (
        <p className="break-words">
          <span className="text-secondary">Equation: </span>
          {result.equation}
        </p>
      )}

      {result.stats.length > 0 && (
        <Table
          columns={[{ label: "" }, { label: "", numeric: true }]}
          rows={result.stats.map((s) => [
            <span className="text-secondary">{s.label}</span>,
            s.p ? <P p={s.value} /> : num(s.value),
          ])}
        />
      )}

      {result.transposed && (
        <Table
          title="Transposed table"
          columns={result.transposed.columns.map((label, i) => ({ label, numeric: i > 0 }))}
          rows={result.transposed.rows.map((row) =>
            row.map((cell, j) =>
              j === 0 ? (
                cell
              ) : cell == null ? (
                <span className="text-secondary">—</span>
              ) : typeof cell === "number" ? (
                num(cell)
              ) : (
                cell
              ),
            ),
          )}
        />
      )}

      {result.extracted && (
        <>
          <Table
            title="Extracted table"
            columns={result.extracted.table.columns.map((label, i) => ({ label, numeric: i > 0 }))}
            rows={result.extracted.table.rows.map((row) =>
              row.map((cell, j) =>
                j === 0 ? (
                  (cell ?? "")
                ) : cell == null ? (
                  <span className="text-secondary">—</span>
                ) : (
                  cell
                ),
              ),
            )}
          />
          {onCreateTable && (
            <div>
              <Button
                variant="accent"
                onClick={() => onCreateTable(result.extracted!.tableType, result.extracted!.table)}
              >
                Create table
              </Button>
            </div>
          )}
        </>
      )}

      {result.comparisons && result.comparisons.length > 0 && (
        <Table
          title={result.comparisonsLabel ?? "Multiple comparisons"}
          columns={[
            { label: "Comparison" },
            { label: result.comparisonsEffect ?? "Difference", numeric: true },
            ...(withCi ? [{ label: "95% CI", numeric: true }] : []),
            ...(withT ? [{ label: "t", numeric: true }] : []),
            ...(withDf ? [{ label: "df", numeric: true }] : []),
            { label: "P value", numeric: true },
            ...(withAdjustedP ? [{ label: "Adjusted P value", numeric: true }] : []),
            ...(withSignificant ? [{ label: "Significant?" }] : []),
          ]}
          rows={result.comparisons.map((c) => [
            c.group2 ? `${c.group1} vs. ${c.group2}` : c.group1,
            num(c.diff),
            ...(withCi ? [c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`] : []),
            ...(withT ? [num(c.t)] : []),
            ...(withDf ? [num(c.df)] : []),
            // The raw P, plain (no stars — a raw P below 0.05 is not
            // significant once corrected); the adjusted P carries the
            // significance styling. Without a correction the two are the
            // same value, so only one P column shows.
            withAdjustedP ? pValue(c.rawP) : <P p={c.p} />,
            ...(withAdjustedP ? [<P p={c.p} />] : []),
            ...(withSignificant ? [c.significant === undefined ? "—" : c.significant ? "Yes" : "No"] : []),
          ])}
        />
      )}

      {matrix && (
        <>
          <Table
            title={matrix.label ?? "Correlation matrix"}
            columns={[{ label: "" }, ...matrix.variables.map((v) => ({ label: v, numeric: true }))]}
            rows={matrix.variables.map((name, i) => [
              name,
              ...matrix.variables.map((_, j) =>
                i === j ? (
                  <span className="text-secondary">1</span>
                ) : (
                  <span className={cn(isSignificant(matrix.p[i]?.[j]) && "text-support-green")}>
                    {num(matrix.r[i]?.[j])}
                  </span>
                ),
              ),
            ])}
          />
          <p className="-mt-5 text-small text-secondary">Green: a significant correlation (P &lt; 0.05).</p>
          <Table
            title="P values"
            columns={[{ label: "" }, ...matrix.variables.map((v) => ({ label: v, numeric: true }))]}
            rows={matrix.variables.map((name, i) => [
              name,
              ...matrix.variables.map((_, j) =>
                i === j ? <span className="text-secondary">—</span> : <P p={matrix.p[i]?.[j]} />,
              ),
            ])}
          />
        </>
      )}

      {result.correlations && result.correlations.length > 0 && (
        <Table
          title="Correlations (X vs. each Y)"
          columns={[
            { label: "" },
            { label: "r", numeric: true },
            ...(withCorrCi ? [{ label: "95% CI", numeric: true }] : []),
            { label: "P value", numeric: true },
          ]}
          rows={result.correlations.map((c) => [
            c.variable,
            num(c.r),
            ...(withCorrCi
              ? [c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`]
              : []),
            <P p={c.p} />,
          ])}
        />
      )}

      {result.areas && result.areas.length > 0 && (
        <Table
          title="Area under the curve"
          columns={[{ label: "" }, { label: "Area", numeric: true }, { label: "N", numeric: true }]}
          rows={result.areas.map((a) => [a.variable, num(a.area), a.n])}
        />
      )}

      {result.convertedColumns &&
        result.convertedColumns.map((c) => (
          <Table
            key={c.column}
            title={`Converted concentrations — ${c.column} (${c.fromUnit} → ${c.toUnit})`}
            columns={[
              { label: "Row", numeric: true },
              { label: `Original (${c.fromUnit})`, numeric: true },
              { label: `Converted (${c.toUnit})`, numeric: true },
            ]}
            rows={c.values.map((v) => [v.row, num(v.original), num(v.converted)])}
          />
        ))}

      {result.prunedRows && (
        <>
          {[
            { title: "Kept rows", rows: result.prunedRows.kept },
            ...(result.prunedRows.pruned.length > 0
              ? [{ title: "Pruned rows", rows: result.prunedRows.pruned }]
              : []),
          ].map(({ title, rows }) => {
            const hasX = rows.some((r) => r.x !== undefined);
            return (
              <Table
                key={title}
                title={title}
                columns={[
                  { label: "Row" },
                  ...(hasX ? [{ label: "X", numeric: true }] : []),
                  ...result.prunedRows!.columns.map((c) => ({ label: c, numeric: true })),
                ]}
                rows={rows.map((r) => [
                  r.row,
                  ...(hasX ? [num(r.x)] : []),
                  ...r.values.map((v) => num(v)),
                ])}
              />
            );
          })}
        </>
      )}

      {result.gofCategories && result.gofCategories.length > 0 && (
        <Table
          title="Observed vs. expected counts"
          columns={[
            { label: "Category" },
            { label: "Observed", numeric: true },
            { label: "Expected", numeric: true },
            { label: "(O − E)² / E", numeric: true },
          ]}
          rows={result.gofCategories.map((r) => [
            r.category,
            num(r.observed),
            num(r.expected),
            num(r.contribution),
          ])}
        />
      )}

      {result.fractionsOfTotal?.map((col) => {
        const hasX = col.rows.some((r) => r.x !== undefined);
        const hasCI = col.rows.some((r) => r.ciLow != null && r.ciHigh != null);
        return (
          <Table
            key={col.column}
            title={`Fraction of total — ${col.column}`}
            columns={[
              { label: "Row" },
              ...(hasX ? [{ label: "X", numeric: true }] : []),
              { label: "Original", numeric: true },
              { label: "Total", numeric: true },
              { label: col.format === "percent" ? "Percent of total" : "Fraction of total", numeric: true },
              ...(hasCI ? [{ label: "95% CI of proportion", numeric: true }] : []),
            ]}
            rows={col.rows.map((r) => [
              r.row,
              ...(hasX ? [num(r.x)] : []),
              num(r.original),
              num(r.total),
              num(r.value),
              ...(hasCI ? [r.ciLow == null || r.ciHigh == null ? "—" : `${num(r.ciLow)} to ${num(r.ciHigh)}`] : []),
            ])}
          />
        );
      })}

      {result.rowMeans && result.rowMeans.length > 0 && (
        <Table
          title="Row means and totals"
          columns={[
            { label: "Row" },
            ...(result.rowMeans.some((r) => r.x !== undefined) ? [{ label: "X", numeric: true }] : []),
            ...(result.rowMeans.some((r) => r.column !== undefined) ? [{ label: "Data set" }] : []),
            { label: "N", numeric: true },
            { label: "Total", numeric: true },
            { label: "Mean", numeric: true },
            { label: "SD", numeric: true },
            { label: "SEM", numeric: true },
            { label: "95% CI of mean", numeric: true },
            { label: "%CV", numeric: true },
            { label: "Median", numeric: true },
            { label: "25th percentile", numeric: true },
            { label: "75th percentile", numeric: true },
            { label: "Minimum", numeric: true },
            { label: "Maximum", numeric: true },
            { label: "10th percentile", numeric: true },
            { label: "90th percentile", numeric: true },
            { label: "Geometric mean", numeric: true },
            { label: "Geometric SD", numeric: true },
            { label: "95% CI of geometric mean", numeric: true },
          ]}
          rows={result.rowMeans.map((r) => [
            r.row,
            ...(result.rowMeans!.some((w) => w.x !== undefined) ? [num(r.x)] : []),
            ...(result.rowMeans!.some((w) => w.column !== undefined) ? [r.column ?? "—"] : []),
            r.n,
            num(r.total),
            num(r.mean),
            num(r.sd),
            num(r.sem),
            r.ciLow == null && r.ciHigh == null ? "—" : `${num(r.ciLow)} to ${num(r.ciHigh)}`,
            r.cv == null ? "—" : `${num(r.cv)}%`,
            num(r.median),
            num(r.q1),
            num(r.q3),
            num(r.min),
            num(r.max),
            num(r.p10),
            num(r.p90),
            num(r.geoMean),
            num(r.geoSd),
            r.geoCiLow == null && r.geoCiHigh == null ? "—" : `${num(r.geoCiLow)} to ${num(r.geoCiHigh)}`,
          ])}
        />
      )}

      {result.outlierGroups?.[0]?.grubbs && (
        <Table
          title="Outliers by column"
          columns={[
            { label: "" },
            { label: "Points", numeric: true },
            { label: "Farthest value", numeric: true },
            { label: "G", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.outlierGroups.map((g) => [
            g.group,
            g.points,
            num(g.grubbs?.extreme),
            num(g.grubbs?.g),
            <P p={g.grubbs?.p} />,
          ])}
        />
      )}

      {result.outlierGroups?.[0]?.grubbs && (
        <Table
          title="Outliers by column"
          columns={[
            { label: "" },
            { label: "Points", numeric: true },
            { label: "Farthest value", numeric: true },
            { label: "G", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.outlierGroups.map((g) => [
            g.group,
            g.points,
            num(g.grubbs?.extreme),
            num(g.grubbs?.g),
            <P p={g.grubbs?.p} />,
          ])}
        />
      )}

      {result.outlierGroups && result.outlierGroups.length > 0 && !result.outlierGroups[0].grubbs && (
        <Table
          title="Outliers by column"
          columns={[
            { label: "" },
            { label: "Points", numeric: true },
            { label: "Outliers", numeric: true },
            { label: "%", numeric: true },
            {
              label: result.outlierGroups.some((g) => g.mean != null) ? "Mean (outliers removed)" : "Robust mean",
              numeric: true,
            },
          ]}
          rows={result.outlierGroups.map((g) => [
            g.group,
            g.points,
            g.outliers,
            num(g.percent),
            num(g.mean ?? g.robustMean),
          ])}
        />
      )}

      {result.pValueRows && result.pValueRows.length > 0 && (
        <Table
          title="Stack of P values"
          columns={[
            { label: "" },
            { label: "Rank", numeric: true },
            { label: "P value", numeric: true },
            { label: result.pValueAdjustedLabel ?? "Adjusted P value", numeric: true },
            { label: result.pValueFlagLabel ?? "Significant" },
          ]}
          rows={result.pValueRows.map((r) => [
            r.label,
            r.rank,
            <P p={r.p} />,
            r.adjusted == null ? "—" : <P p={r.adjusted} />,
            r.flagged ? "Yes" : "—",
          ])}
        />
      )}

      {result.survivalGroups && result.survivalGroups.length > 0 && (
        <Table
          title="Survival by group"
          columns={[
            { label: "" },
            { label: "Subjects", numeric: true },
            { label: "Events", numeric: true },
            { label: "Median survival", numeric: true },
            { label: "95% CI of median", numeric: true },
          ]}
          rows={result.survivalGroups.map((g) => [
            g.group,
            g.subjects,
            g.events,
            g.median == null ? "Undefined" : num(g.median),
            `${g.low == null ? "—" : num(g.low)} to ${g.high == null ? "—" : num(g.high)}`,
          ])}
        />
      )}

      {result.hazardRatios && result.hazardRatios.length > 0 && (
        <Table
          title="Hazard ratios"
          columns={[
            { label: "" },
            { label: "Hazard ratio", numeric: true },
            { label: "95% CI", numeric: true },
            { label: "P value", numeric: true },
          ]}
          rows={result.hazardRatios.map((h) => [
            h.comparison,
            num(h.ratio),
            `${num(h.low)} to ${num(h.high)}`,
            <P p={h.p} />,
          ])}
        />
      )}

      {result.coefficients && result.coefficients.length > 0 && (
        <Table
          title="Coefficients"
          columns={[
            { label: "" },
            { label: "Estimate", numeric: true },
            { label: "Std. error", numeric: true },
            { label: result.statisticLabel ?? "t", numeric: true },
            { label: "P value", numeric: true },
            { label: "95% CI", numeric: true },
            ...(showHr ? [{ label: "Hazard ratio", numeric: true }] : []),
          ]}
          rows={result.coefficients.map((c) => [
            // Prism's wording for the Hill slope (4PL and allosteric) — kept
            // for stored results predating the dedup rename.
            c.term === "HillSlope" ? "Hill slope" : c.term,
            num(c.estimate),
            num(c.stdError),
            num(c.t),
            <P p={c.p} />,
            c.low == null && c.high == null ? "—" : `${num(c.low)} to ${num(c.high)}`,
            ...(showHr ? [num(c.hazardRatio)] : []),
          ])}
        />
      )}

      {result.varianceComponents && result.varianceComponents.length > 0 && (
        <Table
          title="Variance components"
          columns={[
            { label: "Group" },
            { label: "Component" },
            { label: "Variance", numeric: true },
            { label: "SD", numeric: true },
          ]}
          rows={result.varianceComponents.map((v) => [v.group, v.component, num(v.variance), num(v.sd)])}
        />
      )}

      {result.pcaVariance && result.pcaVariance.length > 0 && (
        <Table
          title="Variance explained"
          columns={[
            { label: "Component" },
            { label: "SD", numeric: true },
            { label: "Eigenvalue", numeric: true },
            { label: "Proportion of variance", numeric: true },
            { label: "Cumulative proportion", numeric: true },
          ]}
          rows={result.pcaVariance.map((v) => [
            v.component,
            num(v.sd),
            num(v.eigenvalue),
            num(v.proportion),
            num(v.cumulative),
          ])}
        />
      )}

      {result.pcaLoadings && result.pcaLoadings.length > 0 && (
        <Table
          title="Loadings"
          columns={[
            { label: "Variable" },
            ...(result.pcaVariance ?? []).map((v) => ({ label: v.component, numeric: true })),
          ]}
          rows={result.pcaLoadings.map((row) => [row.variable, ...row.loadings.map((l) => num(l))])}
        />
      )}

      {result.pcaScores && result.pcaScores.length > 0 && (
        <Table
          title="Scores"
          columns={[
            { label: "Row" },
            ...(result.pcaVariance ?? []).map((v) => ({ label: v.component, numeric: true })),
          ]}
          rows={result.pcaScores.map((row) => [row.row, ...row.scores.map((s) => num(s))])}
        />
      )}

      {result.kmeansClusters && result.kmeansClusters.length > 0 && (
        <Table
          title="Clusters"
          columns={[
            { label: "Cluster" },
            ...groups.map((g) => ({ label: g.name, numeric: true })),
            { label: "n", numeric: true },
            { label: "Within-cluster SS", numeric: true },
          ]}
          rows={result.kmeansClusters.map((row) => [
            row.cluster,
            ...row.centre.map((c) => num(c)),
            row.n,
            num(row.withinSs),
          ])}
        />
      )}

      {result.kmeansAssignments && result.kmeansAssignments.length > 0 && (
        <Table
          title="Cluster assignments"
          columns={[{ label: "Row" }, { label: "Cluster", numeric: true }]}
          rows={result.kmeansAssignments.map((row) => [row.row, row.cluster])}
        />
      )}

      {result.hclustClusters && result.hclustClusters.length > 0 && (
        <Table
          title="Clusters"
          columns={[
            { label: "Cluster" },
            ...groups.map((g) => ({ label: g.name, numeric: true })),
            { label: "n", numeric: true },
            { label: "Within-cluster SS", numeric: true },
          ]}
          rows={result.hclustClusters.map((row) => [
            row.cluster,
            ...row.centroid.map((c) => num(c)),
            row.n,
            num(row.withinSs),
          ])}
        />
      )}

      {result.hclustAssignments && result.hclustAssignments.length > 0 && (
        <Table
          title="Cluster assignments"
          columns={[{ label: "Row" }, { label: "Cluster", numeric: true }]}
          rows={result.hclustAssignments.map((row) => [row.row, row.cluster])}
        />
      )}

      {result.choosingK && result.choosingK.length > 0 && (
        <Table
          title="Choosing k"
          columns={[
            { label: "k", numeric: true },
            { label: "Within-cluster SS", numeric: true },
            { label: "Average silhouette width", numeric: true },
            { label: "Gap statistic", numeric: true },
            { label: "Gap SE", numeric: true },
          ]}
          rows={result.choosingK.map((row) => [
            row.k,
            num(row.withinSs),
            num(row.avgSilhouette),
            num(row.gap),
            num(row.gapSe),
          ])}
        />
      )}

      {result.fitted && result.fitted.length > 0 && (
        <Table
          title="Fitted values and residuals"
          columns={[
            { label: "X", numeric: true },
            { label: "Observed Y", numeric: true },
            { label: "Fitted Y", numeric: true },
            { label: "Residual", numeric: true },
          ]}
          rows={result.fitted.map((p) => [
            num(p.x),
            num(p.observed),
            num(p.y),
            p.observed == null ? "—" : num(p.observed - p.y),
          ])}
        />
      )}

      {result.derivedCurves?.map((c) => (
        <Table
          key={`${c.label} — ${c.dataset}`}
          title={`${c.label} — ${c.dataset}`}
          columns={[
            { label: "X", numeric: true },
            { label: c.label, numeric: true },
          ]}
          rows={c.x.map((x, i) => [num(x), num(c.y[i])])}
        />
      ))}

      {result.parameterValues && result.parameterValues.length > 0 && (
        <Table
          title="Parameter values"
          columns={[
            { label: "Curve" },
            ...result.parameterValues[0].values.map((v) => ({ label: v.name, numeric: true })),
          ]}
          rows={result.parameterValues.map((c) => [c.label, ...c.values.map((v) => num(v.value))])}
        />
      )}

      {result.generatedCurves && result.generatedCurves.curves.length > 0 && (
        <Table
          title="Generated curves"
          columns={[
            { label: "X", numeric: true },
            ...result.generatedCurves.curves.flatMap((c) => [
              { label: c.label, numeric: true },
              ...(c.extra ? [{ label: c.extra.label, numeric: true }] : []),
            ]),
          ]}
          rows={result.generatedCurves.x.map((x, i) => [
            num(x),
            ...result.generatedCurves!.curves.flatMap((c) => [
              c.y[i] == null ? <span className="text-secondary">—</span> : num(c.y[i]),
              ...(c.extra ? [c.extra.y[i] == null ? <span className="text-secondary">—</span> : num(c.extra.y[i])] : []),
            ]),
          ])}
        />
      )}

      {result.baselineRemoved?.map((col) => {
        const hasX = col.rows.some((r) => r.x !== undefined);
        return (
          <Table
            key={col.column}
            title={`Baseline removed — ${col.column}`}
            columns={[
              { label: "Row" },
              ...(hasX ? [{ label: "X", numeric: true }] : []),
              { label: "Original", numeric: true },
              { label: "Baseline", numeric: true },
              { label: "Baseline removed", numeric: true },
            ]}
            rows={col.rows.map((r) => [
              r.row,
              ...(hasX ? [num(r.x)] : []),
              num(r.original),
              num(r.baseline),
              num(r.subtracted),
            ])}
          />
        );
      })}

      {result.columnMath &&
        (() => {
          const math = result.columnMath!;
          const symbol = { subtract: "−", divide: "/", multiply: "×", add: "+" }[math.operation];
          const label = `${math.a} ${symbol} ${math.b}`;
          const hasX = math.rows.some((r) => r.x !== undefined);
          return (
            <Table
              title={`Column math — ${label}`}
              columns={[
                { label: "Row" },
                ...(hasX ? [{ label: "X", numeric: true }] : []),
                { label: math.a, numeric: true },
                { label: math.b, numeric: true },
                { label, numeric: true },
              ]}
              rows={math.rows.map((r) => [
                r.row,
                ...(hasX ? [num(r.x)] : []),
                num(r.a),
                num(r.b),
                num(r.result),
              ])}
            />
          );
        })()}

      {result.frequencyBins &&
        result.frequencyBins.map((f) => (
          <Table
            key={f.column}
            title={result.frequencyBins!.length > 1 ? `Frequency distribution — ${f.column}` : "Frequency distribution"}
            columns={[
              { label: "Bin" },
              { label: "Count", numeric: true },
              { label: "Relative frequency", numeric: true },
              { label: "Cumulative count", numeric: true },
              { label: "Cumulative frequency", numeric: true },
            ]}
            rows={f.bins.map((b) => [
              b.bin,
              b.count,
              num(b.relativeFrequency),
              b.cumulativeCount,
              num(b.cumulativeFrequency),
            ])}
          />
        ))}

      {result.normalized?.map((col) => {
        const hasX = col.rows.some((r) => r.x !== undefined);
        const zeroToHundred = col.hundred !== undefined;
        return (
          <Table
            key={col.column}
            title={`Normalized — ${col.column}`}
            columns={[
              { label: "Row" },
              ...(hasX ? [{ label: "X", numeric: true }] : []),
              { label: "Original", numeric: true },
              ...(zeroToHundred
                ? [
                    { label: "0% reference", numeric: true },
                    { label: "100% reference", numeric: true },
                  ]
                : [{ label: "100% reference", numeric: true }]),
              { label: col.asPercent ? "Normalized (%)" : "Normalized (fraction)", numeric: true },
            ]}
            rows={col.rows.map((r) => [
              r.row,
              ...(hasX ? [num(r.x)] : []),
              num(r.original),
              ...(zeroToHundred ? [num(col.reference), num(col.hundred)] : [num(col.reference)]),
              num(r.normalized),
            ])}
          />
        );
      })}

      {result.rocCurve && result.rocCurve.length > 0 && (
        <Table
          title="Sensitivity and specificity at each threshold"
          columns={[
            { label: "Threshold", numeric: true },
            { label: "Sensitivity", numeric: true },
            { label: "Specificity", numeric: true },
            { label: "Youden's J", numeric: true },
          ]}
          rows={result.rocCurve.map((p) => [
            num(p.threshold),
            num(p.sensitivity),
            num(p.specificity),
            num(p.sensitivity + p.specificity - 1),
          ])}
        />
      )}

      {groups.length > 0 &&
        (result.testType === "descriptive-statistics" ? (
          // The full summary: one column per data set, one row per statistic.
          <Table
            title="Descriptive statistics"
            columns={[{ label: "" }, ...groups.map((g) => ({ label: g.name, numeric: true }))]}
            rows={DESCRIPTIVE_ROWS.map(([label, of]) => [label, ...groups.map(of)])}
          />
        ) : (
          <Table
            title="Descriptive statistics"
            columns={[
              { label: "" },
              { label: "Mean", numeric: true },
              { label: "SD", numeric: true },
              { label: "SEM", numeric: true },
              ...(showCi ? [{ label: "95% CI of mean", numeric: true }] : []),
              { label: "Median", numeric: true },
              ...(showRange
                ? [
                    { label: "Min", numeric: true },
                    { label: "Max", numeric: true },
                    { label: "Range", numeric: true },
                  ]
                : []),
              { label: "N", numeric: true },
            ]}
            rows={groups.map((g) => [
              g.name,
              num(g.mean),
              num(g.sd),
              num(g.sem),
              ...(showCi ? [g.ciLow == null && g.ciHigh == null ? "—" : `${num(g.ciLow)} to ${num(g.ciHigh)}`] : []),
              num(g.median),
              ...(showRange ? [num(g.min), num(g.max), num(g.range)] : []),
              g.n,
            ])}
          />
        ))}

      {result.notes && <p className="max-w-prose text-small text-secondary">{result.notes}</p>}
    </div>
  );
}
