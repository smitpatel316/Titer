// Convert to Nested (Plane seq 450): a Column table becomes a Nested one —
// each Column dataset becomes a group, and its rows split into equal
// subgroups in order (row 1 of a dataset lands in the first subgroup's
// first replicate, and so on). A Column table carries no subgroup
// boundaries, so the factorization is the user's call: how many subgroups
// per group, and what each subgroup is called. The rows must tile into
// subgroups × replicates exactly — nothing is dropped or invented.
//
// Seq 397/429: a plain fixed overlay, NOT the shared Dialog component —
// the native dialog element takes no pointer events on Mac WebKit, so this
// sheet is normal DOM buttons, which take clicks everywhere else in the
// app. The overlay sits above the app's own layers (z-50; the app's
// highest is z-30) and the backdrop eats clicks behind it, so the page
// behind stays inert while the sheet stands.
import * as React from "react";
import { Button, Field, Input, NumberInput } from "../ui/controls";
import { useProjectStore } from "../store/use-project-store";

/** Default subgroup labels for a count: S1, S2… — as in `newNestedTable`. */
const defaultLabels = (subgroups: number) => Array.from({ length: subgroups }, (_, s) => `S${s + 1}`);

/** The largest subgroup count ≤ 4 that tiles the rows, else 1 subgroup. */
const defaultSubgroups = (rows: number) => [4, 3, 2].find((n) => rows % n === 0) ?? 1;

export function ConvertToNestedDialog() {
  const { selector, closeSelector, nodes, convertTableToNested } = useProjectStore();
  const tableId = selector?.kind === "convert-to-nested" ? selector.tableId : null;
  const table = tableId ? nodes[tableId] : undefined;
  const rows = table?.type === "table" ? (table.data?.rows.length ?? 0) : 0;
  const [subgroups, setSubgroups] = React.useState<number | null>(null);
  const [labels, setLabels] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Fresh defaults whenever the sheet opens on a (different) table.
  React.useEffect(() => {
    if (!tableId || rows === 0) return;
    const pick = defaultSubgroups(rows);
    setSubgroups(pick);
    setLabels(defaultLabels(pick));
    setError(null);
  }, [tableId]);

  // Focus the panel when the sheet opens, so Escape/Return work at once.
  React.useEffect(() => {
    if (tableId) panelRef.current?.focus();
  }, [tableId]);

  if (!tableId || !table || table.type !== "table" || table.tableType !== "column" || !table.data) return null;
  const datasets = table.data.columns.slice(1);
  const replicates = subgroups !== null && subgroups >= 1 ? rows / subgroups : NaN;
  const tiles = Number.isInteger(replicates) && replicates >= 1;
  const problem =
    table.frozen
      ? `Table “${table.name}” is frozen — unfreeze it before converting it.`
      : subgroups === null
        ? "Choose how many subgroups each group splits into."
        : subgroups < 1
          ? "Needs at least 1 subgroup per group."
          : !tiles
            ? `${rows} rows don't split into ${subgroups} equal subgroups — pick a subgroup count that divides ${rows}.`
            : labels.length !== subgroups
              ? `Needs ${subgroups} subgroup labels, one per subgroup.`
              : labels.some((l) => !l.trim())
                ? "A subgroup label must not be empty."
                : labels.some((l) => l.includes(":"))
                  ? "A subgroup label must not contain “:” — a nested column name uses “:” to separate group, subgroup and replicate."
                  : new Set(labels.map((l) => l.trim())).size !== labels.length
                    ? "The subgroups of a group need distinct labels."
                    : null;

  const changeSubgroups = (n: number | null) => {
    setSubgroups(n);
    setError(null);
    if (n !== null && n >= 1) {
      setLabels((prev) => Array.from({ length: n }, (_, s) => prev[s] ?? `S${s + 1}`));
    }
  };

  const convert = () => {
    if (problem || subgroups === null || !tiles) return;
    setError(null);
    try {
      convertTableToNested(tableId, {
        subgroups,
        replicates,
        subgroupLabels: labels.map((l) => l.trim()),
      });
      closeSelector();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeSelector}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-to-nested-title"
        className="w-[520px] rounded-xl bg-surface p-5 text-primary shadow-2xl ring-1 ring-separator outline-none"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            closeSelector();
          } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) {
            e.preventDefault();
            convert();
          }
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="convert-to-nested-title" className="text-large-strong">
              Convert to Nested
            </h2>
            <p className="text-regular text-secondary">
              {error ?? problem ?? (
                <>
                  Each dataset ({datasets.join(", ")}) becomes a group, and its {rows} rows split into {subgroups}{" "}
                  subgroups of {replicates} replicates each, in order. The converted table has {datasets.length} groups,{" "}
                  {subgroups} subgroups and {replicates} replicates.
                </>
              )}
            </p>
          </div>
          <Field label="Subgroups per group">
            <NumberInput value={subgroups} onChange={changeSubgroups} />
          </Field>
          {tiles && (
            <div className="grid grid-cols-2 gap-2">
              {labels.map((label, s) => (
                <Field key={s} label={`Subgroup ${s + 1} name`}>
                  <Input
                    value={label}
                    onChange={(e) =>
                      setLabels((prev) => prev.map((l, i) => (i === s ? e.target.value : l)))
                    }
                  />
                </Field>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={closeSelector}>Cancel</Button>
            <Button variant="accent" disabled={!!problem || subgroups === null} onClick={convert}>
              Convert
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
