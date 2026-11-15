// Batch Magic (Prism's Magic over many graphs): the Match section's example and
// ticked properties, applied to a selection of graphs at once. A graph the
// properties would not change is grayed out — the same convention as Match's
// toggles — and starts unticked, so an Apply never dirties a graph it leaves
// alone. The current graph is listed first in its table's group: it is one
// of the graphs being made consistent, not apart from them.
import * as React from "react";
import { Dialog } from "../../ui/dialog";
import { Button } from "../../ui/controls";

export interface BatchMagicTarget {
  id: string;
  name: string;
  /** False when the ticked properties would not change it: grayed out. */
  wouldChange: boolean;
}

export interface BatchMagicGroup {
  table: string;
  graphs: BatchMagicTarget[];
}

export function BatchMagicDialog({
  exampleName,
  properties,
  groups,
  currentId,
  onClose,
  onApply,
}: {
  /** The graph the others take after. */
  exampleName: string;
  /** Labels of the ticked properties being applied. */
  properties: string[];
  groups: BatchMagicGroup[];
  /** The graph whose Match section opened this: marked "This graph". */
  currentId: string;
  onClose: () => void;
  onApply: (ids: string[]) => void;
}) {
  const changeable = groups.flatMap((g) => g.graphs).filter((g) => g.wouldChange);
  const [checked, setChecked] = React.useState<string[]>(changeable.map((g) => g.id));
  const tick = (id: string, on: boolean) => setChecked(on ? [...checked, id] : checked.filter((c) => c !== id));
  const apply = () => {
    if (!checked.length) return;
    onApply(checked);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      onReturn={apply}
      title="Apply to Multiple Graphs"
      description={`Make the graphs below match “${exampleName}” — ${properties.join(", ")}.`}
      footer={
        <Button variant="accent" disabled={!checked.length} onClick={apply}>
          {checked.length === 1 ? "Apply to 1 Graph" : `Apply to ${checked.length} Graphs`}
        </Button>
      }
    >
      <div className="flex gap-2">
        <Button variant="ghost" size="small" onClick={() => setChecked(changeable.map((g) => g.id))}>
          All
        </Button>
        <Button variant="ghost" size="small" onClick={() => setChecked([])}>
          None
        </Button>
      </div>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {groups.map(({ table, graphs }) => (
          <div key={table} className="flex flex-col gap-1">
            <p className="text-small text-secondary">{table}</p>
            {graphs.map((g) => (
              <label
                key={g.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-regular ${
                  g.wouldChange ? "cursor-pointer hover:bg-control" : "text-secondary"
                }`}
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-accent focus-visible:outline-none disabled:cursor-default"
                  checked={checked.includes(g.id)}
                  disabled={!g.wouldChange}
                  onChange={(e) => tick(g.id, e.target.checked)}
                />
                <span className="truncate">{g.name}</span>
                {g.id === currentId && <span className="text-small text-secondary">This graph</span>}
                {!g.wouldChange && <span className="text-small text-secondary">Already matches</span>}
              </label>
            ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
