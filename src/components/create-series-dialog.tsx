// "Create Series…" (Prism: Insert → Create Series…; seq 169): fill a column
// with an arithmetic series (add a constant step) or a geometric one
// (multiply by a constant factor), from a first value, for a chosen number
// of values. The count defaults to the selected rows, as in Prism; a
// series that would replace values says so before it runs.
import * as React from "react";
import { Button, NumberInput, RadioList } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import {
  MAX_SERIES_VALUES,
  formatSeriesValue,
  generateSeries,
  validateSeriesSpec,
  type SeriesMode,
  type SeriesSpec,
} from "../lib/series";

export interface CreateSeriesTarget {
  /** The column's name, as the dialog names it. */
  columnName: string;
  /** 0-based row the series starts at. */
  startRow: number;
  /** Rows the user had selected — the count's default, as in Prism. */
  selectedRows: number;
  /** How many cells a series of `count` values would overwrite. */
  overwritesFor: (count: number) => number;
}

export function CreateSeriesDialog({
  open,
  target,
  onClose,
  onGenerate,
}: {
  open: boolean;
  target: CreateSeriesTarget | null;
  onClose: () => void;
  onGenerate: (spec: SeriesSpec, startRow: number) => void;
}) {
  const [count, setCount] = React.useState<number | null>(null);
  const [first, setFirst] = React.useState<number | null>(0);
  const [mode, setMode] = React.useState<SeriesMode>("arithmetic");
  const [step, setStep] = React.useState<number | null>(1);
  // A fresh target resets the form: the count defaults to the selection,
  // as in Prism — never to a stale count from another column.
  const targetKey = target ? `${target.columnName}:${target.startRow}:${target.selectedRows}` : "";
  React.useEffect(() => {
    if (!target) return;
    setCount(target.selectedRows);
    setFirst(0);
    setMode("arithmetic");
    setStep(1);
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;
  const spec: SeriesSpec = {
    count: count ?? 0,
    first: first ?? Number.NaN,
    mode,
    step: step ?? Number.NaN,
  };
  const problem = count === null || first === null || step === null ? "Fill in every field." : validateSeriesSpec(spec);
  const preview =
    problem || count === null
      ? []
      : generateSeries(spec)
          .slice(0, 5)
          .map(formatSeriesValue);
  const generate = () => {
    if (problem) return;
    onGenerate(spec, target.startRow);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      onReturn={generate}
      title="Create Series"
      description={`Fill “${target.columnName}” from row ${target.startRow + 1} with a series of values.`}
      footer={
        <Button variant="accent" disabled={problem !== null} onClick={generate}>
          Generate
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-small text-secondary">Number of values</span>
          <NumberInput
            value={count}
            aria-label="Number of values"
            min={1}
            max={MAX_SERIES_VALUES}
            onChange={setCount}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-small text-secondary">First value</span>
          <NumberInput value={first} aria-label="First value" onChange={setFirst} />
        </label>
        <RadioList
          value={mode}
          onChange={setMode}
          options={[
            { value: "arithmetic", label: "Arithmetic — add a constant step" },
            { value: "geometric", label: "Geometric — multiply by a constant factor" },
          ]}
        />
        <label className="flex flex-col gap-1">
          <span className="text-small text-secondary">{mode === "arithmetic" ? "Step (added each time)" : "Factor (multiplied each time)"}</span>
          <NumberInput
            value={step}
            aria-label={mode === "arithmetic" ? "Step" : "Factor"}
            onChange={setStep}
          />
        </label>
        {preview.length > 0 && (
          <p className="text-small text-secondary">
            Preview: {preview.join(", ")}
            {spec.count > preview.length ? ", …" : ""}
          </p>
        )}
        {target.overwritesFor(spec.count) > 0 && (
          <p className="text-small text-red-600">
            This replaces{" "}
            {target.overwritesFor(spec.count) === 1
              ? "1 existing value"
              : `${target.overwritesFor(spec.count)} existing values`}{" "}
            in “{target.columnName}”. You can undo this.
          </p>
        )}
        <p className="text-small text-secondary">At most {MAX_SERIES_VALUES.toLocaleString()} values at a time.</p>
        {problem && <p className="text-small text-red-600">{problem}</p>}
      </div>
    </Dialog>
  );
}
