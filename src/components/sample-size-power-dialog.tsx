// "Sample size & power…" (seq 207, 1.8.3): a guided calculator — pick a
// test, pick what to solve for, enter the other parameters — that needs no
// data table and no project, so the dialog opens from the Analysis menu
// with nothing open. The engine (src/stats/sample-size-power.ts) is pure
// TypeScript; the same engine backs the `titer_sample_size_power` MCP
// tool, so the dialog and the tool return identical numbers. The power
// curve is drawn with Plotly (the solved point marked), and the result
// carries the plain-language line ("n = 64 per group detects d = 0.5
// with 80% power at α = 0.05").
import * as React from "react";
import { Button, Field, NumberInput, Segmented, Select } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { loadPlotly } from "../views/graphs/plotly";
import {
  solveSampleSizePower,
  validateSampleSizeParams,
  type SampleSizeParams,
  type SampleSizeResult,
  type SampleSizeTest,
  type SolveFor,
} from "../stats/sample-size-power";

const TEST_OPTIONS: { value: SampleSizeTest; label: string }[] = [
  { value: "one-sample-t", label: "One-sample t test" },
  { value: "two-sample-t", label: "Two-sample t test (equal variance)" },
  { value: "welch-t", label: "Two-sample t test (Welch)" },
  { value: "paired-t", label: "Paired t test" },
  { value: "one-way-anova", label: "One-way ANOVA" },
  { value: "pearson-correlation", label: "Pearson correlation" },
  { value: "one-proportion", label: "One proportion" },
  { value: "chi-square", label: "Chi-square" },
];

/** The classic medium effect for each test, as the starting value. */
const DEFAULT_EFFECT: Record<SampleSizeTest, number> = {
  "one-sample-t": 0.5,
  "two-sample-t": 0.5,
  "welch-t": 0.5,
  "paired-t": 0.5,
  "one-way-anova": 0.25,
  "pearson-correlation": 0.3,
  "one-proportion": 0.5,
  "chi-square": 0.3,
};

const EFFECT_FIELD_LABEL: Record<SampleSizeTest, string> = {
  "one-sample-t": "Effect size d (Cohen's d)",
  "two-sample-t": "Effect size d (Cohen's d)",
  "welch-t": "Effect size d (Cohen's d)",
  "paired-t": "Effect size d (Cohen's d)",
  "one-way-anova": "Effect size f (Cohen's f)",
  "pearson-correlation": "Correlation r",
  "one-proportion": "Effect size h (Cohen's h)",
  "chi-square": "Effect size w (Cohen's w)",
};

const N_FIELD_LABEL: Record<SampleSizeTest, string> = {
  "one-sample-t": "n",
  "two-sample-t": "n per group",
  "welch-t": "n per group",
  "paired-t": "Number of pairs",
  "one-way-anova": "n per group",
  "pearson-correlation": "n",
  "one-proportion": "n",
  "chi-square": "Total N",
};

const CHI_VARIANT_OPTIONS = [
  { value: "2x2" as const, label: "2×2 table (df = 1)" },
  { value: "gof" as const, label: "Goodness-of-fit" },
];

/** The solved p1 for a one-proportion effect solve, given p0 and h:
 *  h = |2·asin√p1 − 2·asin√p0|, taking the branch above p0. */
const p1FromH = (p0: number, h: number): number => {
  const x = 2 * Math.asin(Math.sqrt(p0)) + h;
  return Math.sin(x / 2) ** 2;
};

export function SampleSizePowerDialog() {
  const { selector, closeSelector } = useProjectStore();
  const [test, setTest] = React.useState<SampleSizeTest>("two-sample-t");
  const [solveFor, setSolveFor] = React.useState<SolveFor>("n");
  const [effect, setEffect] = React.useState<number | null>(0.5);
  const [n, setN] = React.useState<number | null>(64);
  const [power, setPower] = React.useState<number | null>(0.8);
  const [alpha, setAlpha] = React.useState<number | null>(0.05);
  const [alternative, setAlternative] = React.useState<"two-sided" | "one-sided">("two-sided");
  const [groups, setGroups] = React.useState<number | null>(4);
  const [chiVariant, setChiVariant] = React.useState<"2x2" | "gof">("2x2");
  const [categories, setCategories] = React.useState<number | null>(4);
  const [sdRatio, setSdRatio] = React.useState<number | null>(1);
  const [p0, setP0] = React.useState<number | null>(0.5);
  const [p1, setP1] = React.useState<number | null>(0.7);
  const [result, setResult] = React.useState<SampleSizeResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const chartRef = React.useRef<HTMLDivElement>(null);
  const plottedRef = React.useRef<HTMLDivElement | null>(null);

  const sidednessOff = test === "one-way-anova" || test === "chi-square";
  const chiDf = chiVariant === "2x2" ? 1 : (categories ?? 4) - 1;
  // One proportion works in proportions: h is derived, and shown.
  const derivedH =
    test === "one-proportion" && p0 !== null && p1 !== null && p0 >= 0 && p0 <= 1 && p1 >= 0 && p1 <= 1
      ? Math.abs(2 * Math.asin(Math.sqrt(p1)) - 2 * Math.asin(Math.sqrt(p0)))
      : null;

  const buildParams = (): SampleSizeParams => {
    const params: SampleSizeParams = {
      test,
      solveFor,
      alpha: alpha ?? NaN,
      alternative: sidednessOff ? "two-sided" : alternative,
      power: power ?? NaN,
      n: n ?? NaN,
    };
    if (test === "one-proportion") {
      if (solveFor !== "effect") {
        // The validator derives h from p0/p1 (and names a bad proportion
        // precisely); solving for the effect leaves both out — the engine
        // solves h, and the dialog converts it back to p1 for display.
        params.p0 = p0 ?? NaN;
        params.p1 = p1 ?? NaN;
      }
    } else if (solveFor !== "effect") {
      params.effect = effect ?? NaN;
    }
    if (test === "one-way-anova") params.groups = groups ?? NaN;
    if (test === "chi-square") params.chiSquareDf = chiDf;
    if (test === "welch-t") params.sdRatio = sdRatio ?? NaN;
    return params;
  };

  let problem: string | null = null;
  try {
    validateSampleSizeParams(buildParams());
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }

  const calculate = () => {
    if (problem) return;
    setError(null);
    try {
      setResult(solveSampleSizePower(buildParams()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // The power curve: the solved point marked, a dashed line at the target
  // power when solving for n. `Plotly.react` updates in place; the chart
  // is purged only when the dialog unmounts.
  React.useEffect(() => {
    if (!result || !chartRef.current) return;
    const el = chartRef.current;
    let cancelled = false;
    void loadPlotly().then((Plotly) => {
      if (cancelled || !chartRef.current) return;
      const shapes: Record<string, unknown>[] = [];
      if (result.solveFor === "n") {
        shapes.push({
          type: "line",
          x0: result.curve.n[0],
          x1: result.curve.n[result.curve.n.length - 1],
          y0: result.solvedPower,
          y1: result.solvedPower,
          line: { dash: "dash", color: "#888888", width: 1 },
        });
      }
      void Plotly.react(
        el,
        [
          {
            x: result.curve.n,
            y: result.curve.power,
            type: "scatter",
            mode: "lines",
            name: "Power",
            line: { color: "#2563eb", width: 2 },
          },
          {
            x: [result.solvedN],
            y: [result.solvedPower],
            type: "scatter",
            mode: "markers",
            name: "Solved",
            marker: { color: "#dc2626", size: 9 },
          },
        ],
        {
          margin: { l: 44, r: 12, t: 12, b: 40 },
          xaxis: { title: { text: result.nLabel } },
          yaxis: { title: { text: "Power" }, range: [0, 1.02] },
          showlegend: false,
          shapes,
        },
        { displayModeBar: false, responsive: true },
      );
      plottedRef.current = el;
    });
    return () => {
      cancelled = true;
    };
  }, [result]);

  React.useEffect(
    () => () => {
      const el = plottedRef.current;
      plottedRef.current = null;
      if (el) void loadPlotly().then((Plotly) => Plotly.purge(el));
    },
    [],
  );

  const headline = result
    ? result.solveFor === "n"
      ? result.test === "chi-square"
        ? `N = ${result.nRounded} total`
        : result.test === "paired-t"
          ? `n = ${result.nRounded} pairs`
          : result.nLabel === "n per group"
            ? `n = ${result.nRounded} per group`
            : `n = ${result.nRounded}`
      : result.solveFor === "power"
        ? `Power = ${Math.round(result.power * 1000) / 10}%`
        : result.test === "one-proportion" && p0 !== null
          ? `p1 = ${Math.round(p1FromH(p0, result.effect) * 1000) / 1000} (h = ${Math.round(result.effect * 1000) / 1000})`
          : `${result.effectLabel} = ${Math.round(result.effect * 1000) / 1000}`
    : null;
  const details = result
    ? [
        result.solveFor === "n" ? `exact ${result.test === "chi-square" ? "N" : "n"} = ${Math.round(result.n * 100) / 100}` : null,
        `power at ${result.test === "chi-square" ? "N" : "n"} = ${result.nRounded} is ${Math.round(result.powerAtRoundedN * 1000) / 10}%`,
        result.df !== undefined ? `df = ${Math.round(result.df * 100) / 100}` : null,
        result.test === "one-way-anova" ? `${result.groups} groups` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  if (selector?.kind !== "sample-size-power") return null;

  return (
    <Dialog
      open
      onClose={closeSelector}
      onReturn={!problem ? calculate : undefined}
      title="Sample size & power"
      description={error ?? problem ?? "How many subjects do you need — or how much power do you have? No data table needed."}
      footer={
        <Button variant="accent" disabled={!!problem} onClick={calculate}>
          Calculate
        </Button>
      }
    >
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
        <Field label="Test">
          <Select
            value={test}
            onChange={(t) => {
              setTest(t);
              setEffect(DEFAULT_EFFECT[t]);
              setResult(null);
              setError(null);
            }}
            options={TEST_OPTIONS}
          />
        </Field>
        <Segmented
          value={solveFor}
          onChange={(s) => {
            setSolveFor(s);
            setResult(null);
            setError(null);
          }}
          options={[
            { value: "n" as const, label: "Sample size" },
            { value: "power" as const, label: "Power" },
            { value: "effect" as const, label: "Effect size" },
          ]}
        />
        <div className="grid grid-cols-2 gap-2">
          {test === "one-proportion" ? (
            <>
              <Field label="Null proportion p0">
                <NumberInput value={p0} onChange={setP0} />
              </Field>
              <Field label="Alternative proportion p1">
                <NumberInput value={solveFor === "effect" ? null : p1} onChange={setP1} disabled={solveFor === "effect"} />
              </Field>
            </>
          ) : (
            solveFor !== "effect" && (
              <Field label={EFFECT_FIELD_LABEL[test]}>
                <NumberInput value={effect} onChange={setEffect} />
              </Field>
            )
          )}
          {solveFor !== "n" && (
            <Field label={N_FIELD_LABEL[test]}>
              <NumberInput value={n} onChange={setN} />
            </Field>
          )}
          {solveFor !== "power" && (
            <Field label="Target power">
              <NumberInput value={power} onChange={setPower} />
            </Field>
          )}
          <Field label="Significance level α">
            <NumberInput value={alpha} onChange={setAlpha} />
          </Field>
          {test === "one-way-anova" && (
            <Field label="Groups">
              <NumberInput value={groups} onChange={setGroups} />
            </Field>
          )}
          {test === "welch-t" && (
            <Field label="SD ratio (group 1 / group 2)">
              <NumberInput value={sdRatio} onChange={setSdRatio} />
            </Field>
          )}
          {test === "chi-square" && (
            <>
              <Field label="Kind">
                <Select value={chiVariant} onChange={setChiVariant} options={CHI_VARIANT_OPTIONS} />
              </Field>
              {chiVariant === "gof" && (
                <Field label="Categories">
                  <NumberInput value={categories} onChange={setCategories} />
                </Field>
              )}
            </>
          )}
        </div>
        <Segmented
          value={sidednessOff ? "two-sided" : alternative}
          onChange={setAlternative}
          options={[
            { value: "two-sided" as const, label: "Two-sided" },
            { value: "one-sided" as const, label: "One-sided" },
          ]}
        />
        {sidednessOff && <p className="text-small text-secondary">One-way ANOVA and chi-square are upper-tail tests, so sidedness does not apply.</p>}
        {test === "one-proportion" && derivedH !== null && solveFor !== "effect" && (
          <p className="text-small text-secondary">Cohen's h = {Math.round(derivedH * 1000) / 1000}.</p>
        )}
        {test === "chi-square" && <p className="text-small text-secondary">Degrees of freedom: df = {chiDf}.</p>}
        {result && (
          <div className="flex flex-col gap-2 border-t border-separator pt-3">
            <p className="text-large-strong">{headline}</p>
            <p className="text-regular text-secondary">{result.plainLanguage}</p>
            {details && <p className="text-small text-secondary">{details}</p>}
            <div ref={chartRef} className="h-[260px] w-full" />
          </div>
        )}
      </div>
    </Dialog>
  );
}
