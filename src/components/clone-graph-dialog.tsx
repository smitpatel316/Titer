// "Clone Graph…" (a graph's sidebar menu): Prism's "Clone a graph" —
// duplicate the graph with its data table and the analyses shown on it, to
// start a new project from a formatted example. The dialog asks which data
// and titles to delete: by default the Y values go, and the X values and
// titles stay, so the clone is a formatted, empty frame waiting for new
// numbers. An XY or Survival table is the only kind with X values to keep.
import * as React from "react";
import { Button, Checkbox } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import type { CloneOptions } from "../lib/clone-graph";

export function CloneGraphDialog() {
  const { nodes, selector, closeSelector, cloneGraph } = useProjectStore();
  const [clearY, setClearY] = React.useState(true);
  const [clearX, setClearX] = React.useState(false);
  const [clearTitles, setClearTitles] = React.useState(false);

  if (selector?.kind !== "clone-graph") return null;
  const graph = nodes[selector.graphId];
  if (!graph || graph.type !== "graph") return null;
  const table = graph.parentId ? nodes[graph.parentId] : undefined;
  const hasX = table?.tableType === "xy" || table?.tableType === "survival";

  const options: CloneOptions = { clearY, clearX, clearTitles };
  const run = () => {
    cloneGraph(graph.id, options);
    closeSelector();
  };

  return (
    <Dialog
      open
      onClose={closeSelector}
      onReturn={run}
      title={`Clone “${graph.name}”`}
      description="Duplicates the graph with its data table and the analyses shown on the graph. Analyses on the table that aren't shown on the graph are not copied."
      footer={
        <Button variant="accent" onClick={run}>
          Clone Graph
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2">
          <Checkbox checked={clearY} onChange={setClearY} />
          Delete Y values
        </label>
        {hasX && (
          <label className="flex items-center gap-2">
            <Checkbox checked={clearX} onChange={setClearX} />
            Delete X values
          </label>
        )}
        <label className="flex items-center gap-2">
          <Checkbox checked={clearTitles} onChange={setClearTitles} />
          Delete row titles
        </label>
        <p className="text-small text-secondary">
          {clearY || clearX || clearTitles
            ? "Enter new data in the cloned table and it is graphed the same way."
            : "The cloned table keeps all its values — edit the copy to start the new project."}
        </p>
      </div>
    </Dialog>
  );
}
