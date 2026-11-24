// Prism's Import and Paste Special Choices dialog (seq 429): the 5-tab
// dialog from walk2/07–11, worded as Prism words it. A plain fixed
// overlay, not a native <dialog> — the native top layer takes keyboard
// but not pointer events on this Mac WebKit (seq 397), so its buttons
// would take no HID clicks live on the Mac. Focus trapping, Escape and
// Return follow the backup-recovery sheet's contract: Escape cancels,
// Return imports (unless the focus is on a button), Tab stays inside.
//
// The dialog edits the choices and previews them; it places nothing
// itself. Confirm hands the choices plus the resolved insertion point
// (TableData coords, Title column included) to the store, which runs
// computeImport and places the result. The two clipboard checkboxes on
// Prism's Source tab ("Paste as many digits as possible", "Paste older
// text-based clipboard format") are clipboard options — they live in
// Paste Special (seq 428), not in a file import, so they are not here.
// "Open File to Edit Data" and the View tab's "Open File" are also
// absent: Titer has no native file-opener command to wire them to.
import * as React from "react";
import { Button } from "../../ui/controls";
import {
  clearSavedImportChoices,
  dataColumnLetter,
  defaultImportChoices,
  extractInfoSections,
  loadSavedImportChoices,
  parseImportText,
  saveImportChoices,
  type ImportChoices,
  type ImportChoiceTab,
  type ImportOffer,
  type ImportSkipCondition,
} from "../../lib/import-choices";

const TABS: ImportChoiceTab[] = ["Source", "View", "Filter", "Placement", "Info & Notes"];

const OPERATORS = [">", "<", "=", ">=", "<="] as const;

/** A small number field: 1-based counts, clamped to ≥ 1; an empty or
 *  non-numeric edit keeps the last good value. */
function NumInput({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      type="number"
      min={1}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        if (Number.isFinite(n)) onChange(Math.max(1, n));
      }}
      className="h-6 w-16 rounded-md bg-control px-2 text-regular outline-none disabled:opacity-50"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-regular font-medium">{title}</h3>
      {children}
    </div>
  );
}

function Radio({
  name,
  checked,
  onChange,
  disabled,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1 text-regular">
      <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />
      {children}
    </label>
  );
}

function Check({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-1 text-regular">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {children}
    </label>
  );
}

/** One Filter-tab skip row: "Skip all rows until/after/where column #".
 *  Checking the box starts a "column 1 > 0" condition; unchecking clears it. */
function SkipRow({
  label,
  cond,
  onChange,
}: {
  label: string;
  cond: ImportSkipCondition | null;
  onChange: (cond: ImportSkipCondition | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 text-regular">
      <Check checked={cond !== null} onChange={(on) => onChange(on ? { col: 1, op: ">", value: "0" } : null)}>
        {label}
      </Check>
      <NumInput
        value={cond?.col ?? 1}
        label="Column number"
        disabled={cond === null}
        onChange={(col) => cond && onChange({ ...cond, col })}
      />
      <select
        aria-label="Comparison"
        value={cond?.op ?? ">"}
        disabled={cond === null}
        onChange={(e) => cond && onChange({ ...cond, op: e.target.value as ImportSkipCondition["op"] })}
        className="h-6 rounded-md bg-control px-1 text-regular outline-none disabled:opacity-50"
      >
        {OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      <input
        type="text"
        aria-label="Value to compare against"
        value={cond?.value ?? "0"}
        disabled={cond === null}
        onChange={(e) => cond && onChange({ ...cond, value: e.target.value })}
        className="h-6 w-20 rounded-md bg-control px-2 text-regular outline-none disabled:opacity-50"
      />
    </div>
  );
}

export function ImportDialog({
  offer,
  insertionPoint,
  onConfirm,
  onCancel,
  onChooseFile,
}: {
  offer: ImportOffer;
  /** The grid's live insertion point in TableData coords (column 0 is the
   *  Title column), or null when no table is active. */
  insertionPoint: { r: number; c: number } | null;
  /** The confirmed choices plus the resolved insertion point (TableData
   *  coords), or null for a new table. */
  onConfirm: (choices: ImportChoices, insertion: { r: number; c: number } | null) => void;
  onCancel: () => void;
  onChooseFile: () => void;
}) {
  const [tab, setTab] = React.useState<ImportChoiceTab>("Source");
  const [choices, setChoices] = React.useState<ImportChoices>(() => loadSavedImportChoices() ?? defaultImportChoices());
  const [saveAsDefault, setSaveAsDefault] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const ext = offer.name.toLowerCase().split(".").pop() ?? "";
  const isXlsx = ext === "xlsx";
  const fileLabel = offer.path ?? offer.name;

  // The preview: the file as the Source tab reads it, with the <Info> /
  // <Notes> sections taken out — the View tab shows what will be filtered
  // and placed, not the raw bytes.
  const preview = React.useMemo(() => {
    if (offer.xlsxRows) return offer.xlsxRows;
    if (offer.text === null) return [];
    const { dataRows } = extractInfoSections(parseImportText(offer.text, ext, choices), choices);
    return dataRows;
  }, [offer, ext, choices]);
  const previewRows = preview.slice(0, 10);
  const previewCols = Math.max(0, ...previewRows.map((r) => r.length));

  const setSource = (patch: Partial<ImportChoices["source"]>) =>
    setChoices((c) => ({ ...c, source: { ...c.source, ...patch } }));
  const setFilter = (patch: Partial<ImportChoices["filter"]>) =>
    setChoices((c) => ({ ...c, filter: { ...c.filter, ...patch } }));
  const setPlacement = (patch: Partial<ImportChoices["placement"]>) =>
    setChoices((c) => ({ ...c, placement: { ...c.placement, ...patch } }));
  const setInfo = (patch: Partial<ImportChoices["info"]>) =>
    setChoices((c) => ({ ...c, info: { ...c.info, ...patch } }));

  const confirm = () => {
    if (saveAsDefault) saveImportChoices(choices);
    const p = choices.placement;
    if (p.target === "new") return onConfirm(choices, null);
    if (p.useLiveInsertionPoint && insertionPoint) return onConfirm(choices, insertionPoint);
    return onConfirm(choices, { r: Math.max(1, p.insertRow) - 1, c: Math.max(1, p.insertCol) });
  };

  React.useEffect(() => {
    panelRef.current?.focus();
  }, []);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        confirm();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      ).filter(
        (el) => !(el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled,
      ) as HTMLElement[];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // confirm/onCancel are stable props from the store; the listener is
    // re-registered only when the dialog re-opens (it unmounts on close).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveLabel =
    insertionPoint === null
      ? "No table is active."
      : `Row ${insertionPoint.r + 1}, Column ${insertionPoint.c <= 0 ? "A" : dataColumnLetter(insertionPoint.c - 1)}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-choices-title"
        className="flex max-h-[85vh] w-[640px] flex-col rounded-xl bg-surface p-5 text-primary shadow-2xl ring-1 ring-separator outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <h2 id="import-choices-title" className="text-large-strong">
            Import and Paste Special Choices
          </h2>
          <p className="text-regular text-secondary">File: {fileLabel}</p>
        </div>

        <div className="mt-4 flex gap-1 border-b border-separator" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={
                tab === t
                  ? "border-b-2 border-accent px-3 py-1 text-regular font-medium"
                  : "px-3 py-1 text-regular text-secondary"
              }
            >
              {t}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {tab === "Source" && (
            <div className="flex flex-col gap-4">
              <Section title="Linking and embedding">
                <Radio name="import-link" checked={!choices.source.link} onChange={() => setSource({ link: false })}>
                  Insert data only.
                </Radio>
                <Radio name="import-link" checked={choices.source.link} onChange={() => setSource({ link: true })}>
                  Insert and maintain link.
                </Radio>
                <Check
                  checked={choices.source.autoUpdate}
                  disabled={!choices.source.link}
                  onChange={(autoUpdate) => setSource({ autoUpdate })}
                >
                  Automatically update Prism when the data file is changed.
                </Check>
              </Section>
              <Section title="Commas">
                <Radio
                  name="import-commas"
                  checked={choices.source.comma === "separate"}
                  disabled={isXlsx}
                  onChange={() => setSource({ comma: "separate" })}
                >
                  To separate adjacent columns ("100,000" mean one hundred in one column, zero in the next).
                </Radio>
                <Radio
                  name="import-commas"
                  checked={choices.source.comma === "thousands"}
                  disabled={isXlsx}
                  onChange={() => setSource({ comma: "thousands" })}
                >
                  To delineate thousands ("100,000" means one hundred thousand).
                </Radio>
                <Radio
                  name="import-commas"
                  checked={choices.source.comma === "decimal"}
                  disabled={isXlsx}
                  onChange={() => setSource({ comma: "decimal" })}
                >
                  As decimal place ("100,000" means one hundred point zero, zero, zero).
                </Radio>
                {isXlsx && <p className="text-small text-secondary">Excel cells are already separated — commas don't apply.</p>}
              </Section>
              <Section title="Spaces">
                <Radio
                  name="import-spaces"
                  checked={choices.source.spaces === "headings"}
                  disabled={isXlsx}
                  onChange={() => setSource({ spaces: "headings" })}
                >
                  Only separate words within column heading and X labels.
                </Radio>
                <Radio
                  name="import-spaces"
                  checked={choices.source.spaces === "separate"}
                  disabled={isXlsx}
                  onChange={() => setSource({ spaces: "separate" })}
                >
                  Separate adjacent columns.
                </Radio>
              </Section>
              <p className="text-regular text-secondary">
                Description: {isXlsx ? "Excel" : "Text"}
              </p>
              <p className="text-regular text-secondary">
                The other tabs in this dialog are optional. They let you filter and rearrange the data. To import the
                entire file, click Import button now.
              </p>
              <div>
                <Button onClick={onChooseFile}>Choose...</Button>
              </div>
            </div>
          )}

          {tab === "View" && (
            <div className="flex flex-col gap-3">
              {previewRows.length === 0 ? (
                <p className="text-regular text-secondary">Nothing to preview — the file has no data rows.</p>
              ) : (
                <div className="overflow-auto rounded-md ring-1 ring-separator">
                  <table className="border-collapse text-regular">
                    <thead>
                      <tr>
                        <th className="border-b border-separator bg-control px-2 py-1 text-left font-medium" />
                        {Array.from({ length: Math.min(previewCols, 8) }, (_, c) => (
                          <th key={c} className="border-b border-separator bg-control px-2 py-1 text-left font-medium">
                            Col. {c + 1}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, r) => (
                        <tr key={r}>
                          <td className="border-b border-separator bg-control px-2 py-1 font-medium">Row {r + 1}</td>
                          {Array.from({ length: Math.min(previewCols, 8) }, (_, c) => (
                            <td key={c} className="border-b border-separator px-2 py-1">
                              {row[c] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(preview.length > 10 || previewCols > 8) && (
                <p className="text-small text-secondary">
                  Showing the first {Math.min(preview.length, 10)} of {preview.length} rows
                  {previewCols > 8 ? ` and the first 8 of ${previewCols} columns` : ""}.
                </p>
              )}
              <p className="text-regular text-secondary">{fileLabel}</p>
            </div>
          )}

          {tab === "Filter" && (
            <div className="flex flex-col gap-4">
              <Section title="Unknown and excluded values">
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Check
                    checked={choices.filter.missingMarker !== ""}
                    onChange={(on) => setFilter({ missingMarker: on ? "99" : "" })}
                  >
                    Missing values are denoted by
                  </Check>
                  <input
                    type="text"
                    aria-label="Missing-value marker"
                    value={choices.filter.missingMarker}
                    disabled={choices.filter.missingMarker === ""}
                    onChange={(e) => setFilter({ missingMarker: e.target.value })}
                    className="h-6 w-20 rounded-md bg-control px-2 text-regular outline-none disabled:opacity-50"
                  />
                  <span className="text-secondary">(i.e. "99" or "na").</span>
                </div>
                <Check
                  checked={choices.filter.excludeAsterisks}
                  onChange={(excludeAsterisks) => setFilter({ excludeAsterisks })}
                >
                  Exclude values preceded or followed by asterisks (i.e. "45.6*" or "*45.6").
                </Check>
              </Section>
              <Section title="Rows">
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <span>Start at Row</span>
                  <NumInput
                    value={choices.filter.startRow}
                    label="First row to import"
                    onChange={(startRow) => setFilter({ startRow })}
                  />
                  <span>End at:</span>
                  <Radio
                    name="import-end-row"
                    checked={choices.filter.endRow === "last"}
                    onChange={() => setFilter({ endRow: "last" })}
                  >
                    Last Row
                  </Radio>
                  <Radio
                    name="import-end-row"
                    checked={choices.filter.endRow !== "last"}
                    onChange={() => setFilter({ endRow: choices.filter.startRow })}
                  >
                    Row #
                  </Radio>
                  <NumInput
                    value={choices.filter.endRow === "last" ? choices.filter.startRow : choices.filter.endRow}
                    label="Last row to import"
                    disabled={choices.filter.endRow === "last"}
                    onChange={(endRow) => setFilter({ endRow })}
                  />
                </div>
                <SkipRow
                  label="Skip all rows until column #"
                  cond={choices.filter.skipUntil}
                  onChange={(skipUntil) => setFilter({ skipUntil })}
                />
                <SkipRow
                  label="Skip all rows after column #"
                  cond={choices.filter.skipAfter}
                  onChange={(skipAfter) => setFilter({ skipAfter })}
                />
                <SkipRow
                  label="Skip all rows where column #"
                  cond={choices.filter.skipWhere}
                  onChange={(skipWhere) => setFilter({ skipWhere })}
                />
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Check
                    checked={choices.filter.decimate > 0}
                    onChange={(on) => setFilter({ decimate: on ? 1 : 0 })}
                  >
                    Decimate: Import a row, skip
                  </Check>
                  <NumInput
                    value={Math.max(1, choices.filter.decimate)}
                    label="Rows to skip between imported rows"
                    disabled={choices.filter.decimate === 0}
                    onChange={(decimate) => setFilter({ decimate })}
                  />
                  <span>rows, import another row and repeat.</span>
                </div>
              </Section>
              <Section title="Columns">
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <span>Start at Column</span>
                  <NumInput
                    value={choices.filter.startCol}
                    label="First column to import"
                    onChange={(startCol) => setFilter({ startCol })}
                  />
                  <span>End at:</span>
                  <Radio
                    name="import-end-col"
                    checked={choices.filter.endCol === "last"}
                    onChange={() => setFilter({ endCol: "last" })}
                  >
                    Last Column
                  </Radio>
                  <Radio
                    name="import-end-col"
                    checked={choices.filter.endCol !== "last"}
                    onChange={() => setFilter({ endCol: choices.filter.startCol })}
                  >
                    Column #
                  </Radio>
                  <NumInput
                    value={choices.filter.endCol === "last" ? choices.filter.startCol : choices.filter.endCol}
                    label="Last column to import"
                    disabled={choices.filter.endCol === "last"}
                    onChange={(endCol) => setFilter({ endCol })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Check
                    checked={choices.filter.unstack !== null}
                    onChange={(on) => setFilter({ unstack: on ? { dataCol: 2, groupCol: 1 } : null })}
                  >
                    Unstack. Column #
                  </Check>
                  <NumInput
                    value={choices.filter.unstack?.dataCol ?? 2}
                    label="Column holding the values"
                    disabled={choices.filter.unstack === null}
                    onChange={(dataCol) =>
                      choices.filter.unstack && setFilter({ unstack: { ...choices.filter.unstack, dataCol } })
                    }
                  />
                  <span>contains data. Column #</span>
                  <NumInput
                    value={choices.filter.unstack?.groupCol ?? 1}
                    label="Column holding the group number"
                    disabled={choices.filter.unstack === null}
                    onChange={(groupCol) =>
                      choices.filter.unstack && setFilter({ unstack: { ...choices.filter.unstack, groupCol } })
                    }
                  />
                  <span>contains group number.</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Check
                    checked={choices.filter.skipColumns > 0}
                    onChange={(on) => setFilter({ skipColumns: on ? 1 : 0 })}
                  >
                    Skip columns. Import a column, skip
                  </Check>
                  <NumInput
                    value={Math.max(1, choices.filter.skipColumns)}
                    label="Columns to skip between imported columns"
                    disabled={choices.filter.skipColumns === 0}
                    onChange={(skipColumns) => setFilter({ skipColumns })}
                  />
                  <span>column(s), import another column, and repeat.</span>
                </div>
              </Section>
            </div>
          )}

          {tab === "Placement" && (
            <div className="flex flex-col gap-4">
              <Section title="Where to put it">
                <Radio
                  name="import-target"
                  checked={choices.placement.target === "insert"}
                  disabled={insertionPoint === null}
                  onChange={() => setPlacement({ target: "insert" })}
                >
                  Insert into the active table
                </Radio>
                <Radio
                  name="import-target"
                  checked={choices.placement.target === "new" || insertionPoint === null}
                  onChange={() => setPlacement({ target: "new" })}
                >
                  Create a new table
                </Radio>
                {insertionPoint === null && (
                  <p className="text-small text-secondary">No table is active — the import creates a new table.</p>
                )}
              </Section>
              <Section title="Names">
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Check checked={choices.placement.rename} onChange={(rename) => setPlacement({ rename })}>
                    Rename data table, using
                  </Check>
                </div>
                <Radio
                  name="import-rename"
                  checked={choices.placement.renameFrom === "file"}
                  disabled={!choices.placement.rename}
                  onChange={() => setPlacement({ renameFrom: "file" })}
                >
                  Imported file name
                </Radio>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-rename"
                    checked={choices.placement.renameFrom === "row"}
                    disabled={!choices.placement.rename}
                    onChange={() => setPlacement({ renameFrom: "row" })}
                  >
                    Text in row
                  </Radio>
                  <NumInput
                    value={choices.placement.renameRow}
                    label="Row whose text names the table"
                    disabled={!choices.placement.rename || choices.placement.renameFrom !== "row"}
                    onChange={(renameRow) => setPlacement({ renameRow })}
                  />
                </div>
              </Section>
              <Section title="Top-left position of inserted data within Prism">
                <Radio
                  name="import-insert"
                  checked={choices.placement.useLiveInsertionPoint}
                  disabled={insertionPoint === null || choices.placement.target !== "insert"}
                  onChange={() => setPlacement({ useLiveInsertionPoint: true })}
                >
                  The current position of the insertion point ({liveLabel})
                </Radio>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-insert"
                    checked={!choices.placement.useLiveInsertionPoint}
                    disabled={insertionPoint === null || choices.placement.target !== "insert"}
                    onChange={() => setPlacement({ useLiveInsertionPoint: false })}
                  >
                    Row
                  </Radio>
                  <NumInput
                    value={choices.placement.insertRow}
                    label="Insertion row"
                    disabled={choices.placement.useLiveInsertionPoint || choices.placement.target !== "insert"}
                    onChange={(insertRow) => setPlacement({ insertRow })}
                  />
                  <span>Column</span>
                  <select
                    aria-label="Insertion column"
                    value={dataColumnLetter(Math.max(1, choices.placement.insertCol) - 1)}
                    disabled={choices.placement.useLiveInsertionPoint || choices.placement.target !== "insert"}
                    onChange={(e) =>
                      setPlacement({ insertCol: Math.max(1, "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(e.target.value) + 1) })
                    }
                    className="h-6 rounded-md bg-control px-1 text-regular outline-none disabled:opacity-50"
                  >
                    {Array.from({ length: 26 }, (_, i) => (
                      <option key={i} value={dataColumnLetter(i)}>
                        {dataColumnLetter(i)}
                      </option>
                    ))}
                  </select>
                </div>
              </Section>
              <Section title="Row and Column Arrangement">
                <Radio
                  name="import-arrangement"
                  checked={choices.placement.arrangement === "maintain"}
                  onChange={() => setPlacement({ arrangement: "maintain" })}
                >
                  Maintain row and column arrangement of the data source.
                </Radio>
                <Radio
                  name="import-arrangement"
                  checked={choices.placement.arrangement === "transpose"}
                  onChange={() => setPlacement({ arrangement: "transpose" })}
                >
                  Transpose. Each row becomes a column.
                </Radio>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-arrangement"
                    checked={choices.placement.arrangement === "byRows"}
                    onChange={() => setPlacement({ arrangement: "byRows" })}
                  >
                    By rows. Place
                  </Radio>
                  <NumInput
                    value={choices.placement.byRowsRows}
                    label="Rows per new column"
                    disabled={choices.placement.arrangement !== "byRows"}
                    onChange={(byRowsRows) => setPlacement({ byRowsRows })}
                  />
                  <span>rows, start a new column.</span>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-arrangement"
                    checked={choices.placement.arrangement === "byColumns"}
                    onChange={() => setPlacement({ arrangement: "byColumns" })}
                  >
                    By columns. Stack
                  </Radio>
                  <NumInput
                    value={choices.placement.byColumnsValues}
                    label="Values per column"
                    disabled={choices.placement.arrangement !== "byColumns"}
                    onChange={(byColumnsValues) => setPlacement({ byColumnsValues })}
                  />
                  <span>values in each column.</span>
                </div>
              </Section>
              <Section title="Empty rows">
                <p className="text-regular text-secondary">If all values in a row are blank:</p>
                <Radio
                  name="import-blank"
                  checked={choices.placement.blankRows === "leave"}
                  onChange={() => setPlacement({ blankRows: "leave" })}
                >
                  Leave a blank row in Prism
                </Radio>
                <Radio
                  name="import-blank"
                  checked={choices.placement.blankRows === "skip"}
                  onChange={() => setPlacement({ blankRows: "skip" })}
                >
                  Skip over that row
                </Radio>
              </Section>
              <Section title="Column titles:">
                <select
                  aria-label="Column titles"
                  value={choices.placement.columnTitles}
                  onChange={(e) =>
                    setPlacement({ columnTitles: e.target.value as ImportChoices["placement"]["columnTitles"] })
                  }
                  className="h-6 rounded-md bg-control px-1 text-regular outline-none"
                >
                  <option value="auto">Choose automatically</option>
                  <option value="firstRow">First row is column titles</option>
                  <option value="none">No column titles</option>
                </select>
              </Section>
            </div>
          )}

          {tab === "Info & Notes" && (
            <div className="flex flex-col gap-4">
              <Section title="Info Constants">
                <Radio
                  name="import-info"
                  checked={choices.info.infoMode === "none"}
                  onChange={() => setInfo({ infoMode: "none" })}
                >
                  Don't import info constants.
                </Radio>
                <Radio
                  name="import-info"
                  checked={choices.info.infoMode === "section"}
                  onChange={() => setInfo({ infoMode: "section" })}
                >
                  {"Import from portion of file between <Info> and </Info>."}
                </Radio>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-info"
                    checked={choices.info.infoMode === "fromRow"}
                    onChange={() => setInfo({ infoMode: "fromRow" })}
                  >
                    Import starting at row
                  </Radio>
                  <NumInput
                    value={choices.info.infoFromRow}
                    label="First info row"
                    disabled={choices.info.infoMode !== "fromRow"}
                    onChange={(infoFromRow) => setInfo({ infoFromRow })}
                  />
                  <span>and ending at row</span>
                  <NumInput
                    value={choices.info.infoEndRow === "last" ? choices.info.infoFromRow : choices.info.infoEndRow}
                    label="Last info row"
                    disabled={choices.info.infoMode !== "fromRow"}
                    onChange={(infoEndRow) => setInfo({ infoEndRow })}
                  />
                </div>
              </Section>
              <Section title="Notes">
                <Radio
                  name="import-notes"
                  checked={choices.info.notesMode === "none"}
                  onChange={() => setInfo({ notesMode: "none" })}
                >
                  Don't import notes.
                </Radio>
                <Radio
                  name="import-notes"
                  checked={choices.info.notesMode === "section"}
                  onChange={() => setInfo({ notesMode: "section" })}
                >
                  {"Import from portion of file between <Notes> and </Notes>."}
                </Radio>
                <div className="flex flex-wrap items-center gap-1 text-regular">
                  <Radio
                    name="import-notes"
                    checked={choices.info.notesMode === "fromRow"}
                    onChange={() => setInfo({ notesMode: "fromRow" })}
                  >
                    Import starting at row
                  </Radio>
                  <NumInput
                    value={choices.info.notesFromRow}
                    label="First notes row"
                    disabled={choices.info.notesMode !== "fromRow"}
                    onChange={(notesFromRow) => setInfo({ notesFromRow })}
                  />
                  <span>and ending at row</span>
                  <NumInput
                    value={choices.info.notesEndRow === "last" ? choices.info.notesFromRow : choices.info.notesEndRow}
                    label="Last notes row"
                    disabled={choices.info.notesMode !== "fromRow"}
                    onChange={(notesEndRow) => setInfo({ notesEndRow })}
                  />
                </div>
              </Section>
              <Section title="Info Sheet">
                <p className="text-regular text-secondary">
                  Imported info and notes go to a new info sheet linked to the table.
                </p>
              </Section>
              <p className="text-regular text-secondary">
                Note that {"<Info>"} and {"<Notes>"} section must come before any data.
              </p>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-separator pt-4">
          <div className="flex items-center gap-3">
            <Check checked={saveAsDefault} onChange={setSaveAsDefault}>
              Use these settings as the default for Import and Paste Special.
            </Check>
            <Button
              size="small"
              onClick={() => {
                setChoices(defaultImportChoices());
                clearSavedImportChoices();
                setSaveAsDefault(false);
              }}
            >
              Restore original defaults
            </Button>
          </div>
          <div className="flex gap-2">
            <Button onClick={onCancel}>Cancel</Button>
            <Button variant="accent" onClick={confirm}>
              Import
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
