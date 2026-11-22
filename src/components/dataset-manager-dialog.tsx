// "Data sets…" (seq 309): a table's data sets — its columns, or a grouped
// table's groups, an XY table's Y data sets, a nested table's groups —
// listed with reorder (up/down), add (a new empty set) and remove (with
// confirm). Removing a set an analysis depends on warns first; on confirm
// the analysis becomes orphaned per the existing orphan handling (frozen
// results, re-point via seq 242). The last set can't go. Reordering moves
// the set's columns, so the table and every graph built from it follow.
import * as React from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "@phosphor-icons/react";
import { Button } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import type { ProjectNode } from "../store/types";
import { useProjectActions, useProjectStore } from "../store/use-project-store";
import { confirmDelete } from "../native";
import { addDataSet, dataSetsOf, dependentAnalyses, removeDataSet, reorderDataSet, setValueCount } from "../lib/dataset-manager";

export function DataSetsDialog({ open, node, onClose }: { open: boolean; node: ProjectNode; onClose: () => void }) {
  const data = node.data!;
  const type = node.tableType ?? "column";
  const { nodes } = useProjectStore();
  const { updateTable, removeDataSet: removeDataSetAction } = useProjectActions();
  const sets = dataSetsOf(data, type);
  const [selected, setSelected] = React.useState(0);
  // A fresh open starts on the first set; a set removed from under the
  // dialog (by another path) clamps the selection to what is left.
  React.useEffect(() => {
    if (open) setSelected(0);
  }, [open]);
  const at = Math.min(selected, sets.length - 1);
  const frozen = node.frozen;
  const move = (from: number, to: number) => {
    if (frozen) return;
    const next = reorderDataSet(data, type, from, to);
    if (next === data) return;
    updateTable(node.id, next, "Reorder Data Sets");
    setSelected(to);
  };
  const add = () => {
    if (frozen) return;
    const next = addDataSet(data, type);
    updateTable(node.id, next, "Add Data Set");
    setSelected(sets.length);
  };
  const remove = async () => {
    if (frozen) return;
    const set = sets[at];
    if (!set) return;
    if (sets.length <= 1) return; // the button is disabled; the lib refuses too
    const dependents = dependentAnalyses(nodes, node.id, set.name);
    if (dependents.length > 0) {
      const names = dependents.map((n) => `“${n.name}”`).join(", ");
      if (
        !(await confirmDelete(
          `Remove data set “${set.name}”?`,
          `${names} ${dependents.length > 1 ? "run" : "runs"} on this data set. The orphaned ${dependents.length > 1 ? "results are" : "result is"} kept as ${dependents.length > 1 ? "they are" : "it is"}, frozen, and can be re-pointed to another table. You can undo this.`,
        ))
      )
        return;
    } else {
      const values = setValueCount(data, set);
      if (
        values > 0 &&
        !(await confirmDelete(
          `Remove data set “${set.name}”?`,
          `Its ${values} value${values > 1 ? "s" : ""} will be deleted too. You can undo this.`,
        ))
      )
        return;
    }
    const removed = removeDataSet(data, type, at);
    if ("error" in removed) return; // the last set: refused, with its reason
    removeDataSetAction(node.id, removed.data, set.name, "Remove Data Set");
    setSelected(Math.max(0, at - 1));
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Data Sets — ${node.name}`}
      description="Reorder the table's data sets, add a new empty one, or remove one. Graphs built from this table follow the order."
    >
      <div className="flex flex-col gap-1">
        {sets.map((set, i) => {
          const values = setValueCount(data, set);
          const dependents = dependentAnalyses(nodes, node.id, set.name);
          return (
            <button
              key={`${set.name}:${set.columns[0]}`}
              type="button"
              onClick={() => setSelected(i)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-regular ${
                i === at ? "bg-control font-medium" : "hover:bg-control"
              }`}
            >
              <span className="flex-1 truncate">{set.name}</span>
              <span className="text-small text-secondary">
                {set.columns.length > 1 ? `${set.columns.length} columns` : "1 column"}
                {values > 0 ? ` · ${values} value${values > 1 ? "s" : ""}` : " · empty"}
                {dependents.length > 0
                  ? ` · used by ${dependents.map((n) => `“${n.name}”`).join(", ")}`
                  : ""}
              </span>
              <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                <Button
                  size="icon"
                  aria-label={`Move ${set.name} up`}
                  disabled={frozen || i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUpIcon className="size-3.5" />
                </Button>
                <Button
                  size="icon"
                  aria-label={`Move ${set.name} down`}
                  disabled={frozen || i === sets.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDownIcon className="size-3.5" />
                </Button>
              </span>
            </button>
          );
        })}
      </div>
      {sets.length <= 1 && (
        <p className="text-small text-secondary">
          “{sets[0]?.name}” is the table's last data set — a table keeps at least one, so it can't be removed. Add
          another data set first, or delete the table itself.
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={add} disabled={frozen}>
          <PlusIcon className="size-3.5" /> Add Data Set
        </Button>
        <Button onClick={() => void remove()} disabled={frozen || sets.length <= 1 || !sets[at]}>
          Remove
        </Button>
      </div>
    </Dialog>
  );
}
