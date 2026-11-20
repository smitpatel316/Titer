// A data table: the grid, and (grouped tables) the Groups panel. Every edit goes to
// the project store, which keeps the Undo history for the whole project.
import * as React from "react";
import {
  GROUPED_LIMITS,
  tableErrorFormat,
  type ProjectNode,
  type RowGroup,
  type TableData,
  type TableErrorFormat,
} from "../../store/types";
import type { TableMove } from "../../store/references";
import { useProjectActions } from "../../store/use-project-store";
import { Row, Section, Stepper, WithInspector } from "../../components/inspector";
import { Button, Input, RadioList, Select } from "../../ui/controls";
import { useLayout } from "../../store/use-layout";
import { ColumnsIcon, MinusIcon, PlusIcon } from "@phosphor-icons/react";
import { Grid } from "./grid";
import {
  addRowGroup,
  applySummaryFormat,
  applySummaryFormatLoses,
  changeErrorFormat,
  defaultRowGroups,
  regroupLoses,
  regroupTable,
  removeRowGroup,
  renestLoses,
  renestTable,
  replicateXY,
  rowGroupTotal,
  setRowGroupCount,
  setRowGroupName,
} from "./table-data";
import { isGrouped, isNested } from "../../lib/dataset";
import {
  addCalculatedVariable,
  removeCalculatedVariable,
  setCalculatedFormula,
} from "../../lib/calcvars";
import { SUMMARY_FORMATS, summaryFormatOf, summarySubcolumns, type SummaryFormat } from "../../lib/summary-format";
import { seriesKeyOf } from "../../lib/columns";
import { alert, confirmDelete } from "../../native";
import { refreshLinkedFromFile } from "./linked-data";
import { AddFloatingNoteButton, FloatingNotesLayer } from "../../components/floating-notes";
import { TABLES } from ".";

// ── View ───────────────────────────────────────────────────────────────

export function TableView({ node }: { node: ProjectNode }) {
  const data = node.data!;
  const { updateTable } = useProjectActions();
  const update = (next: TableData, label: string, move?: TableMove) => {
    if (next !== data) updateTable(node.id, next, label, move);
  };
  const { setLayout } = useLayout();
  const tag = TABLES[node.tableType ?? "column"].label;
  const link = data.linkedPaste;
  // Linked paste (Prism 11, seq 168): the table's link, as a slim bar over
  // the grid — what file it follows, whether it updates itself on open,
  // and Update / Break Link beside it (the same actions as Edit ▸ Update
  // Linked Data / Break Link and the grid menu's).
  const refreshLink = async () => {
    try {
      const res = await refreshLinkedFromFile(data, node.tableType ?? "column");
      if (res.changed) update(res.data, "Update Linked Data");
    } catch (err) {
      await alert(
        "Couldn't Update Linked Data",
        err instanceof Error ? err.message : "The linked file couldn't be read.",
        "error",
      );
    }
  };
  const linkedBar = link ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-separator bg-surface px-3 py-1 text-xs text-muted">
      <span>
        Linked to “{link.sourceName}”
        {link.autoUpdate ? " — updates automatically when the file changes" : " — updates by hand"}
      </span>
      <span className="flex-1" />
      <Button onClick={() => void refreshLink()}>Update Now</Button>
      <Button
        onClick={() => {
          if (data.linkedPaste) update({ ...data, linkedPaste: undefined }, "Break Link");
        }}
      >
        Break Link
      </Button>
    </div>
  ) : null;
  const grid = (
    <Grid
      data={data}
      type={node.tableType ?? "column"}
      update={update}
      showGroups={() => setLayout({ inspector: true })}
    />
  );
  // The sheet the notes pin to: the grid fills it, and the layer covers it.
  const sheet = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {linkedBar}
      {grid}
      <FloatingNotesLayer node={node} />
    </div>
  );

  // An XY table has settings of its own: its replicates. A grouped or nested
  // table has settings of its own: its groups. Every table that can carry
  // error values (column, XY, grouped, nested) has one more: its error format.
  if (node.tableType === "xy") {
    return (
      <WithInspector
        title={node.name}
        tag={tag}
        node={node}
        settings={
          <>
            <ReplicatesPanel data={data} update={update} />
            <FormatPanel data={data} update={update} />
          </>
        }
        actions={<AddFloatingNoteButton node={node} />}
      >
        {sheet}
      </WithInspector>
    );
  }
  if (node.tableType === "column") {
    return (
      <WithInspector
        title={node.name}
        tag={tag}
        node={node}
        settings={<FormatPanel data={data} update={update} />}
        actions={<AddFloatingNoteButton node={node} />}
      >
        {sheet}
      </WithInspector>
    );
  }
  if (node.tableType === "multiple") {
    return (
      <WithInspector
        title={node.name}
        tag={tag}
        node={node}
        settings={<CalculatedVariablesPanel data={data} update={update} />}
        actions={<AddFloatingNoteButton node={node} />}
      >
        {sheet}
      </WithInspector>
    );
  }
  if (!isGrouped(data) && !isNested(data)) {
    // No settings of its own: the right panel shows the table's note only.
    return (
      <WithInspector title={node.name} tag={tag} node={node} actions={<AddFloatingNoteButton node={node} />}>
        {sheet}
      </WithInspector>
    );
  }
  return (
    <WithInspector
      title={node.name}
      tag={tag}
      node={node}
      settings={
        <>
          <GroupsPanel data={data} update={update} />
          <FormatPanel data={data} update={update} />
        </>
      }
      actions={<AddFloatingNoteButton node={node} />}
    >
      {sheet}
    </WithInspector>
  );
}

/** A table's error format: what its entered error values are — SD or SEM
 *  (Prism's "Changing a data table format": a table formatted for SEM whose
 *  values are really SD can be switched). Switching relabels its summary
 *  error columns (`_SD` ↔ `_SEM`, values untouched) and sets the default
 *  error bars of graphs made from the table; graphs already made keep their own. */
function FormatPanel({ data, update }: { data: TableData; update: (next: TableData, label: string) => void }) {
  const format: TableErrorFormat = tableErrorFormat(data);
  return (
    <Section title="Format" icon={<ColumnsIcon />}>
      <Row label="Error format">
        <RadioList
          value={format}
          onChange={(next) => {
            if (next === format) return;
            update(changeErrorFormat(data, next), "Change Error Format");
          }}
          options={[
            { value: "sd", label: "SD (standard deviation)" },
            { value: "sem", label: "SEM (standard error of the mean)" },
          ]}
        />
      </Row>
      <p className="text-small text-secondary">
        The error values in this table are{" "}
        {format === "sd" ? "standard deviations" : "standard errors of the mean"}. Graphs made from this table
        use it for their error bars.
      </p>
    </Section>
  );
}

/** A Multiple Variables table's calculated variables (Prism 11, seq 156):
 *  whole-variable formulas that live in the table and update when a source
 *  value changes. Each one lists its formula (and its error, when it cannot
 *  run); the add form and the per-variable edit take a formula with or
 *  without its leading `=`. Removing one deletes its column and its values
 *  (Undo brings them back). */
function CalculatedVariablesPanel({
  data,
  update,
}: {
  data: TableData;
  update: (next: TableData, label: string) => void;
}) {
  const vars = data.calculated ?? [];
  const [name, setName] = React.useState("");
  const [formula, setFormula] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editFormula, setEditFormula] = React.useState("");
  const [editError, setEditError] = React.useState<string | null>(null);
  // A formula as typed, with or without its leading `=`.
  const bare = (text: string) => (text.startsWith("=") ? text.slice(1) : text);
  const add = () => {
    const res = addCalculatedVariable(data, name, bare(formula));
    if ("error" in res) {
      setAddError(res.error);
      return;
    }
    update(res.data, "Add Calculated Variable");
    setName("");
    setFormula("");
    setAddError(null);
  };
  const saveEdit = (variable: string) => {
    const res = setCalculatedFormula(data, variable, bare(editFormula));
    if ("error" in res) {
      setEditError(res.error);
      return;
    }
    update(res.data, "Edit Calculated Variable");
    setEditing(null);
    setEditError(null);
  };
  const remove = async (variable: string) => {
    if (
      !(await confirmDelete(
        `Delete calculated variable “${variable}”?`,
        "Its column and its values will be deleted too. You can undo this.",
      ))
    )
      return;
    update(removeCalculatedVariable(data, variable), "Remove Calculated Variable");
  };
  return (
    <Section title="Calculated Variables" icon={<ColumnsIcon />}>
      {vars.map((v) => (
        <div key={v.name} className="flex flex-col gap-1 border-b border-separator pb-2 last:border-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-regular font-medium">{v.name}</span>
            <span className="flex gap-1">
              <Button
                size="small"
                onClick={() => {
                  setEditing(v.name);
                  setEditFormula(`=${v.formula}`);
                  setEditError(null);
                }}
              >
                Edit
              </Button>
              <Button size="small" onClick={() => void remove(v.name)}>
                Remove
              </Button>
            </span>
          </div>
          {editing === v.name ? (
            <>
              <Input
                value={editFormula}
                aria-label={`Formula for ${v.name}`}
                onChange={(e) => setEditFormula(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit(v.name);
                  else if (e.key === "Escape") setEditing(null);
                }}
              />
              <div className="flex gap-1">
                <Button size="small" variant="accent" onClick={() => saveEdit(v.name)}>
                  Save
                </Button>
                <Button size="small" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
              {editError && <p className="text-small text-red-600">{editError}</p>}
            </>
          ) : (
            <span className="text-small text-secondary">={v.formula}</span>
          )}
          {v.error && <p className="text-small text-red-600">{v.error}</p>}
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <Input value={name} placeholder="New variable name" aria-label="New variable name" onChange={(e) => setName(e.target.value)} />
        <Input
          value={formula}
          placeholder="=A + B"
          aria-label="New variable formula"
          onChange={(e) => setFormula(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <div>
          <Button variant="accent" onClick={add} disabled={!name.trim() || !formula.trim()}>
            Add Calculated Variable
          </Button>
        </div>
        {addError && <p className="text-small text-red-600">{addError}</p>}
      </div>
      <p className="text-small text-secondary">
        Type `=` in an empty variable in the grid, or add one here. Values update live when a source changes, and a
        calculated variable can be used in any analysis like a typed variable.
      </p>
    </Section>
  );
}

/** A grouped table's structure: groups and sub-columns per group, each change at once.
 *  Taking away a group or sub-column that holds values asks first (Undo brings it back).
 *  A nested table's panel adds the subgroups level (add/remove subgroup within a
 *  group, add/remove group) and drops the row-groups editor — a nested table's
 *  rows carry no third factor. */
function GroupsPanel({ data, update }: { data: TableData; update: (next: TableData, label: string) => void }) {
  const groups = data.groups!;
  const replicates = data.replicates!;
  if (isNested(data)) {
    const subgroups = data.subgroups!;
    const renest = async (g: number, s: number, r: number) => {
      if (renestLoses(data, g, s, r)) {
        const [what, its] =
          g < groups
            ? [`group “${seriesKeyOf(data.columns.at(-1)!)}”`, "Its"]
            : s < subgroups
              ? [`subgroup ${subgroups} of each group`, "Their"]
              : [`replicate ${replicates} of each subgroup`, "Their"];
        if (!(await confirmDelete(`Delete ${what}?`, `${its} values will be deleted too. You can undo this.`))) return;
      }
      update(renestTable(data, g, s, r), "Change Groups");
    };
    return (
      <Section title="Groups" icon={<ColumnsIcon />}>
        <Stepper
          label="Groups"
          value={groups}
          {...GROUPED_LIMITS.nested.groups}
          step={1}
          onChange={(g) => void renest(g, subgroups, replicates)}
        />
        <Stepper
          label="Subgroups"
          value={subgroups}
          {...GROUPED_LIMITS.nested.subgroups}
          step={1}
          onChange={(s) => void renest(groups, s, replicates)}
        />
        <Stepper
          label="Replicates"
          value={replicates}
          {...GROUPED_LIMITS.nested.replicates}
          step={1}
          onChange={(r) => void renest(groups, subgroups, r)}
        />
      </Section>
    );
  }
  const regroup = async (g: number, r: number) => {
    if (regroupLoses(data, g, r)) {
      const [what, its] =
        g < groups
          ? [`group “${seriesKeyOf(data.columns.at(-1)!)}”`, "Its"]
          : [`sub-column ${replicates} of each group`, "Their"];
      if (!(await confirmDelete(`Delete ${what}?`, `${its} values will be deleted too. You can undo this.`))) return;
    }
    update(regroupTable(data, g, r), "Change Groups");
  };
  // The sub-columns' format: raw replicates, or pre-calculated summaries
  // (mean / SD or SEM / N…) entered instead of replicates. A summary format's
  // width is fixed — the Sub-columns stepper is pinned to it (min = max =
  // its width, so both buttons disable) — and narrowing to a shorter format
  // asks first when a sub-column past its width holds values.
  const format = summaryFormatOf(data);
  const formatWidth = format === "replicates" ? replicates : summarySubcolumns(format).length;
  const changeFormat = async (next: SummaryFormat) => {
    if (next === format) return;
    if (applySummaryFormatLoses(data, next)) {
      const newWidth = next === "replicates" ? replicates : summarySubcolumns(next).length;
      const dropped = data.columns
        .slice(1, 1 + replicates)
        .map((n) => n.slice(n.indexOf(":") + 1))
        .slice(newWidth);
      if (
        !(await confirmDelete(
          `Delete sub-column ${dropped.map((s) => `“${s}”`).join(", ")} of each group?`,
          DELETED,
        ))
      )
        return;
    }
    update(applySummaryFormat(data, next), "Change Sub-column Format");
  };
  return (
    <Section title="Groups" icon={<ColumnsIcon />}>
      <Stepper
        label="Groups"
        value={groups}
        {...GROUPED_LIMITS.groups}
        step={1}
        onChange={(g) => void regroup(g, replicates)}
      />
      <div className="flex items-center justify-between">
        <span className="text-small text-secondary">Sub-column format</span>
        <Select
          value={format}
          onChange={(f) => void changeFormat(f)}
          options={SUMMARY_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
        />
      </div>
      <Stepper
        label="Sub-columns"
        value={replicates}
        min={format === "replicates" ? GROUPED_LIMITS.replicates.min : formatWidth}
        max={format === "replicates" ? GROUPED_LIMITS.replicates.max : formatWidth}
        step={1}
        onChange={(r) => void regroup(groups, r)}
      />
      <RowGroupsEditor data={data} update={update} />
    </Section>
  );
}

/** A grouped table's third factor: consecutive bands of rows, one level each
 *  (e.g. WT rows, then KO rows) — what a three-way ANOVA reads as factor C.
 *  Before the user edits them there is one band covering every row, which
 *  disables the three-way option; splitting into ≥ 2 bands enables it. */
function RowGroupsEditor({ data, update }: { data: TableData; update: (next: TableData, label: string) => void }) {
  const rows = data.rows.length;
  const stored = data.rowGroups;
  const bands: RowGroup[] = stored ?? (rows > 0 ? defaultRowGroups(data) : []);
  const setBands = (next: RowGroup[], label: string) =>
    update({ ...data, rowGroups: next.length > 1 ? next : undefined }, label);
  if (rows === 0) {
    return <p className="text-small text-secondary">Add rows to split them into row groups (a third factor).</p>;
  }
  const canSplit = bands.some((b) => b.count > 1);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-small text-secondary">Row groups (third factor)</span>
      {bands.map((band, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input
            aria-label={`Row group ${i + 1} name`}
            value={band.name}
            onChange={(e) => setBands(setRowGroupName(bands, i, e.target.value), "Rename Row Group")}
          />
          <Stepper
            label={`Rows in ${band.name}`}
            value={band.count}
            min={1}
            max={Math.max(1, rowGroupTotal(bands) - (bands.length - 1))}
            step={1}
            onChange={(c) => setBands(setRowGroupCount(bands, i, c), "Change Row Groups")}
          />
          {bands.length > 1 && (
            <Button
              size="icon"
              aria-label={`Remove row group ${band.name}`}
              onClick={() => setBands(removeRowGroup(bands, i), "Remove Row Group")}
            >
              <MinusIcon className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      <Button size="small" disabled={!canSplit} onClick={() => setBands(addRowGroup(bands), "Add Row Group")}>
        <PlusIcon className="size-3.5" /> Add row group
      </Button>
      {bands.length < 2 && (
        <p className="text-small text-secondary">
          One band covers every row. Split it into 2 or more bands to run a three-way ANOVA.
        </p>
      )}
    </div>
  );
}

const DELETED = "The values will be deleted too. You can undo this.";

/** How many values a table holds. */
const valuesIn = (data: TableData) => data.rows.reduce((n, row) => n + row.slice(1).filter((c) => c).length, 0);

/** An XY table's replicates: how many each Y data set holds (1: one column each) and, with
 *  replicates, how many data sets. Taking away one that holds values asks first (Undo
 *  brings it back). */
function ReplicatesPanel({
  data,
  update,
}: {
  data: TableData;
  update: (next: TableData, label: string, move?: TableMove) => void;
}) {
  const replicates = data.replicates ?? 1;
  const change = async (next: TableData, label: string, what: string, renamed?: Record<string, string>) => {
    if (valuesIn(next) < valuesIn(data) && !(await confirmDelete(`Delete ${what}?`, DELETED))) return;
    update(next, label, renamed && Object.keys(renamed).length ? { renamed } : undefined);
  };
  const replicate = (r: number) => {
    const { data: next, renamed } = replicateXY(data, r);
    void change(
      next,
      "Change Replicates",
      r === 1 ? "every replicate but the first" : `replicate ${replicates} of each data set`,
      renamed,
    );
  };
  return (
    <Section title="Replicates" icon={<ColumnsIcon />}>
      <Stepper label="Replicates" value={replicates} {...GROUPED_LIMITS.replicates} step={1} onChange={replicate} />
      {isGrouped(data) && (
        <Stepper
          label="Data sets"
          value={data.groups!}
          {...GROUPED_LIMITS.groups}
          step={1}
          onChange={(g) =>
            void change(
              regroupTable(data, g, replicates, "xy"),
              "Change Data Sets",
              `data set “${seriesKeyOf(data.columns.at(-1)!)}”`,
            )
          }
        />
      )}
    </Section>
  );
}
