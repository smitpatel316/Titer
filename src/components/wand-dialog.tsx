// Use Wand (plan 37): analyze (and graph) tables just like another table —
// pick the example table, an optional prefix for the new sheet names, and the
// target tables (the one the menu was opened from is pre-checked). Apply copies
// the example's analyses + graphs onto every target as one undo step.
import * as React from "react";
import { Button, Checkbox, Field, Input, Select } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { alert } from "../native";
import { useOutline, useProjectStore } from "../store/use-project-store";
import { wandReportMessage } from "../lib/wand";

export function WandDialog() {
  const { selector, closeSelector, applyWand } = useProjectStore();
  const { tables } = useOutline();
  const [exampleId, setExampleId] = React.useState("");
  const [prefix, setPrefix] = React.useState("");
  const [targets, setTargets] = React.useState<ReadonlySet<string>>(new Set());

  const open = selector?.kind === "wand";
  const targetTableId = open ? selector.tableId : "";
  // A fresh dialog each time it opens: the menu's table is the (only) target,
  // the first table with children is the example.
  React.useEffect(() => {
    if (!open) return;
    setPrefix("");
    setTargets(new Set([targetTableId]));
    setExampleId((current) => {
      const examples = tables.filter(
        (t) =>
          t.id !== targetTableId &&
          t.children.some((c) => c.type === "analysis" || c.type === "graph"),
      );
      return examples.some((t) => t.id === current) ? current : (examples[0]?.id ?? "");
    });
  }, [open, targetTableId, tables]);

  if (!open) return null;

  const examples = tables.filter(
    (t) => t.id !== targetTableId && t.children.some((c) => c.type === "analysis" || c.type === "graph"),
  );
  const example = examples.find((t) => t.id === exampleId);
  const exampleChildren = example ? example.children : [];
  const exampleAnalyses = exampleChildren.filter((c) => c.type === "analysis").length;
  const exampleGraphs = exampleChildren.filter((c) => c.type === "graph").length;
  const targetTables = tables.filter((t) => t.id !== exampleId);
  const canApply = exampleId !== "" && targets.size > 0;

  const apply = () => {
    if (!canApply) return;
    try {
      const report = applyWand(exampleId, [...targets], prefix);
      closeSelector();
      void alert("Wand applied", wandReportMessage(report), "info");
    } catch (err) {
      void alert("Couldn't Use Wand", err instanceof Error ? err.message : "The Wand couldn't be applied.", "error");
    }
  };

  return (
    <Dialog
      open
      onClose={closeSelector}
      onReturn={apply}
      title="Use Wand"
      description="Analyze and graph tables just like another table."
      footer={
        <Button variant="accent" disabled={!canApply} onClick={apply}>
          Apply Wand
        </Button>
      }
    >
      <Field label="Analyze like">
        <Select
          value={exampleId}
          onChange={(value) => {
            setExampleId(value);
            setTargets((prev) => {
              const next = new Set(prev);
              next.delete(value);
              return next;
            });
          }}
          options={examples.map((t) => ({ value: t.id, label: t.name }))}
          placeholder="Choose a table…"
        />
      </Field>
      {example && (
        <p className="text-regular text-secondary">
          {exampleAnalyses} {exampleAnalyses === 1 ? "analysis" : "analyses"}
          {exampleGraphs > 0
            ? `, ${exampleGraphs} ${exampleGraphs === 1 ? "graph" : "graphs"}`
            : ", no graphs"}{" "}
          will be copied.
        </p>
      )}
      <Field label="Prefix for new sheets">
        <Input
          value={prefix}
          placeholder="Optional"
          onChange={(e) => setPrefix(e.target.value)}
          aria-label="Prefix for new sheets"
        />
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-regular">Apply to:</span>
        {targetTables.map((t) => (
          <label key={t.id} className="flex items-center gap-2 text-regular">
            <Checkbox
              checked={targets.has(t.id)}
              onChange={(checked) =>
                setTargets((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(t.id);
                  else next.delete(t.id);
                  return next;
                })
              }
            />
            {t.name}
          </label>
        ))}
      </div>
    </Dialog>
  );
}
