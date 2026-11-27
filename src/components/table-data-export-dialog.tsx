// File ▸ Export Table Data… (seq 164 remainder, Prism parity): the
// table-data Export dialog — Prism's File > Export Data. The format
// first, then the three options Prism's dialog offers: how excluded
// values are written to the plain-text formats (blank, the value, or
// the value with an asterisk), which decimal separator the numbers
// take, and whether the column titles are written as a first row.
// Prism XML ignores the three (a machine format — it always keeps the
// excluded marker and the titles), so the dialog says so when XML is
// the format. Export opens the native save dialog; cancel there writes
// nothing. The serializers are shared with `titer_export_table_data`,
// so a file written from the menu is byte-identical to one written by
// the tool with the same options.
import * as React from "react";
import { Button, Checkbox, Field, Select } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { loadDecimalSeparator, type DecimalSeparator } from "../lib/decimal-format";
import {
  DECIMAL_SEPARATOR_OPTIONS,
  defaultTableDataExportIo,
  EXCLUDED_VALUES_EXPORT_OPTIONS,
  exportTableData,
  TABLE_DATA_EXPORT_FORMATS,
  type ExcludedValuesExport,
  type TableDataFormat,
} from "../views/tables/table-data-export";

export function TableDataExportDialog() {
  const { selector, closeSelector, get } = useProjectStore();
  const [format, setFormat] = React.useState<TableDataFormat>("csv");
  const [excludedValues, setExcludedValues] = React.useState<ExcludedValuesExport>("blank");
  const [decimalSeparator, setDecimalSeparator] = React.useState<DecimalSeparator>(".");
  const [includeColumnTitles, setIncludeColumnTitles] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const open = selector?.kind === "export-table-data";

  // A fresh dialog every time it opens: the menu's format, the stored
  // separator, and the defaults (blank excluded values, titles on).
  React.useEffect(() => {
    if (!open) return;
    setFormat(selector.format);
    setExcludedValues("blank");
    setDecimalSeparator(loadDecimalSeparator());
    setIncludeColumnTitles(true);
    setBusy(false);
  }, [open]);

  if (!open) return null;

  const table = get().nodes[selector.tableId];
  if (!table) return null;

  const exportNow = async () => {
    setBusy(true);
    try {
      await exportTableData(table, format, defaultTableDataExportIo, {
        excludedValues,
        decimalSeparator,
        includeColumnTitles,
      });
    } finally {
      setBusy(false);
    }
    closeSelector();
  };

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      onReturn={() => void exportNow()}
      title="Export Table Data"
      description={`Export “${table.name}” as a file — the same export as the titer_export_table_data tool, with the options Prism's Export dialog offers.`}
    >
      <div className="flex flex-col gap-3">
        <Field label="Format">
          <Select
            value={format}
            onChange={(v) => setFormat(v)}
            options={TABLE_DATA_EXPORT_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
          />
        </Field>
        <Field label="Excluded values">
          <Select
            value={excludedValues}
            onChange={(v) => setExcludedValues(v)}
            options={EXCLUDED_VALUES_EXPORT_OPTIONS}
          />
        </Field>
        <Field label="Decimal separator">
          <Select
            value={decimalSeparator}
            onChange={(v) => setDecimalSeparator(v)}
            options={DECIMAL_SEPARATOR_OPTIONS}
          />
        </Field>
        <label className="flex items-center gap-2 text-regular">
          <Checkbox checked={includeColumnTitles} onChange={(v) => setIncludeColumnTitles(v)} />
          Include column titles
        </label>
        {format === "xml" && (
          <p className="text-regular text-secondary">
            Prism XML always keeps excluded values marked and includes the column titles — these options apply to CSV,
            Excel and text.
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="accent" disabled={busy} onClick={() => void exportNow()}>
            Export
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
