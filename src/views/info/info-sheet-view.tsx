// An info sheet: its structured constants (left) and its free notes (right),
// as in Prism. A constant's value flows live into anything that hooks it —
// `{{Constant name}}` in a graph title or axis title, an axis limit hooked
// in the Format panel, or a nonlinear-regression constraint, a ligand
// concentration or a transform constant in an analysis wizard. Every edit
// goes to the project store, which keeps the Undo history.
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import type { InfoConstant, InfoSheetData, ProjectNode } from "../../store/types";
import { useProjectActions, useProjectStore } from "../../store/use-project-store";
import { MAX_INFO_CONSTANTS, newConstantId, newInfoSheetData } from "../../lib/info-sheets";
import { Button, Input, Select } from "../../ui/controls";
import { Toolbar } from "../../ui/layout";
import { AddFloatingNoteButton, FloatingNotesLayer } from "../../components/floating-notes";

export function InfoSheetView({ node }: { node: ProjectNode }) {
  const info = node.info ?? newInfoSheetData();
  const { updateInfoSheet } = useProjectActions();
  const { nodes, rootOrder } = useProjectStore();
  const tables = rootOrder.map((id) => nodes[id]).filter((n) => n?.type === "table");

  const update = (next: InfoSheetData) => {
    if (next !== info) updateInfoSheet(node.id, next);
  };
  const setConstants = (constants: InfoConstant[]) => update({ ...info, constants });
  const setNotes = (notes: string) => update({ ...info, notes });
  const setLink = (linkedTableId: string | null) => update({ ...info, linkedTableId });

  const move = (index: number, by: -1 | 1) => {
    const next = [...info.constants];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setConstants(next);
  };

  const tag =
    info.linkedTableId && nodes[info.linkedTableId] ? `Linked to ${nodes[info.linkedTableId]!.name}` : "Project info";

  return (
    <>
      <Toolbar title={node.name} tag={tag} actions={<AddFloatingNoteButton node={node} />} />
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label className="text-small text-secondary" htmlFor="info-link">
            Linked to table
          </label>
          <div className="w-64">
            <Select
              value={info.linkedTableId ?? ""}
              onChange={(v) => setLink(v === "" ? null : v)}
              options={tables.map((t) => ({ value: t!.id, label: t!.name }))}
              placeholder="Project info (not linked to a table)"
            />
          </div>
          <p className="text-small text-secondary">
            Use {"{{Constant name}}"} in graph titles and axis titles, hook an axis limit to a constant in the Format
            panel, or enter it for a fit constraint or transform constant.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Constants">
            <h2 className="mb-2 text-base font-semibold">Constants</h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left text-small text-secondary">
                  <th className="pb-1 font-medium">Name</th>
                  <th className="pb-1 font-medium">Value</th>
                  <th className="w-24 pb-1" aria-label="Row actions" />
                </tr>
              </thead>
              <tbody>
                {info.constants.map((c, i) => (
                  <tr key={c.id}>
                    <td className="py-1 pr-2">
                      <Input
                        value={c.name}
                        aria-label={`Constant ${i + 1} name`}
                        onChange={(e) =>
                          setConstants(info.constants.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        value={c.value}
                        aria-label={`Constant ${i + 1} value`}
                        onChange={(e) =>
                          setConstants(info.constants.map((x) => (x.id === c.id ? { ...x, value: e.target.value } : x)))
                        }
                      />
                    </td>
                    <td className="py-1">
                      <span className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="small"
                          aria-label={`Move ${c.name || `constant ${i + 1}`} up`}
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowUpIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          aria-label={`Move ${c.name || `constant ${i + 1}`} down`}
                          disabled={i === info.constants.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowDownIcon className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          aria-label={`Delete ${c.name || `constant ${i + 1}`}`}
                          onClick={() => setConstants(info.constants.filter((x) => x.id !== c.id))}
                        >
                          <TrashIcon className="size-4" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2">
              <Button
                variant="ghost"
                disabled={info.constants.length >= MAX_INFO_CONSTANTS}
                onClick={() => setConstants([...info.constants, { id: newConstantId(), name: "", value: "" }])}
              >
                <PlusIcon className="size-4" /> Add constant
              </Button>
            </div>
          </section>
          <section aria-label="Notes">
            <h2 className="mb-2 text-base font-semibold">Notes</h2>
            <textarea
              className="min-h-64 w-full rounded-md border border-edge bg-surface p-2 text-base outline-none focus:border-accent"
              value={info.notes}
              aria-label="Info sheet notes"
              placeholder="Free notes about this experiment — dates, lot numbers, conditions…"
              onChange={(e) => setNotes(e.target.value)}
            />
          </section>
        </div>
        <FloatingNotesLayer node={node} />
      </div>
    </>
  );
}
