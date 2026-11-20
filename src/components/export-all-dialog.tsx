// File ▸ Export All Graphs… (seq 179, Prism parity): every graph and
// figure (Titer's name for a Prism layout) in the project, one file each,
// in one folder, at one format and DPI — Prism's File > Export All Graphs.
//
// The batch itself is `runExportAllBatch` in `src/store/mcp-export.ts`,
// shared with the `titer_export_all_graphs` MCP tool, so a batch file
// matches its one-at-a-time file. A figure with no panels is skipped and
// listed, not failed; a failed render is listed per item and never stops
// the batch. The folder defaults to a `<project-stem> Exports` folder
// beside the project file (`defaultExportAllFolder`); with no saved file
// yet the user types a folder, or saves first.
import * as React from "react";
import { Button, Checkbox, Field, Input, Select } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { runExportAllBatch, type ExportAllBatchOutcome } from "../store/mcp-export";
import { defaultExportAllFolder, planExportAll } from "../lib/export-all";
import { EXPORT_FORMATS, RESOLUTIONS, type ExportFormat, type Resolution } from "../views/graphs/graph-export";
import { yieldToPaint } from "../lib/yield-to-paint";

/** Let the progress line paint before the batch starts. */
const paint = yieldToPaint;

export function ExportAllDialog() {
  const { selector, closeSelector, get } = useProjectStore();
  const [format, setFormat] = React.useState<ExportFormat>("png");
  const [dpi, setDpi] = React.useState<Resolution>("300");
  const [folder, setFolder] = React.useState("");
  const [includeGraphs, setIncludeGraphs] = React.useState(true);
  const [includeFigures, setIncludeFigures] = React.useState(true);
  const [progress, setProgress] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<ExportAllBatchOutcome | null>(null);
  const open = selector?.kind === "export-all-graphs";

  // A fresh dialog every time it opens: the folder starts at the default.
  React.useEffect(() => {
    if (!open) return;
    setFormat("png");
    setDpi("300");
    setFolder(defaultExportAllFolder(get().filePath) ?? "");
    setIncludeGraphs(true);
    setIncludeFigures(true);
    setProgress(null);
    setError(null);
    setDone(null);
  }, [open]);

  if (!open) return null;

  const project = get();
  // The plan is the preview: which files the batch will write, and which
  // empty figures it will skip. It throws when there is nothing to export.
  let plan: ReturnType<typeof planExportAll> | null = null;
  let planError: string | null = null;
  try {
    plan = planExportAll(project, { format, dpi, includeGraphs, includeFigures });
  } catch (err) {
    planError = err instanceof Error ? err.message : String(err);
  }

  const exportAll = async () => {
    if (!plan) return;
    const target = folder.trim() || defaultExportAllFolder(project.filePath) || "";
    if (!target) {
      setError("Choose a folder first — or save the project, so Titer can offer one beside it.");
      return;
    }
    setError(null);
    setDone(null);
    setProgress(`Exporting ${plan.items.length} ${plan.items.length === 1 ? "file" : "files"}…`);
    await paint();
    try {
      const outcome = await runExportAllBatch(
        project,
        { folder: target, format, dpi, includeGraphs, includeFigures },
        {},
      );
      setDone(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The export couldn't be written.");
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={closeSelector}
      title="Export All Graphs"
      description="Export every graph and figure in this project, one file each, into one folder — at one format and resolution."
    >
      <div className="flex flex-col gap-3">
        <Field label="Format">
          <Select
            value={format}
            onChange={(v) => {
              setFormat(v);
              setDone(null);
            }}
            options={EXPORT_FORMATS}
          />
        </Field>
        <Field label="Resolution">
          <Select
            value={dpi}
            onChange={(v) => {
              setDpi(v);
              setDone(null);
            }}
            options={RESOLUTIONS.map((r) => ({ value: r, label: `${r} DPI` }))}
          />
        </Field>
        <Field label="Folder">
          <Input
            value={folder}
            placeholder={defaultExportAllFolder(project.filePath) ?? "Documents/Titer Exports"}
            onChange={(e) => {
              setFolder(e.target.value);
              setDone(null);
            }}
          />
        </Field>
        <p className="text-small text-secondary">
          Leave the folder blank for the default: “
          {defaultExportAllFolder(project.filePath) ?? "Documents/Titer Exports"}”.
        </p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-regular">
            <Checkbox
              checked={includeGraphs}
              onChange={(v) => {
                setIncludeGraphs(v);
                setDone(null);
              }}
            />
            Graphs
          </label>
          <label className="flex items-center gap-2 text-regular">
            <Checkbox
              checked={includeFigures}
              onChange={(v) => {
                setIncludeFigures(v);
                setDone(null);
              }}
            />
            Figures (layouts)
          </label>
        </div>
        {plan && (
          <p className="text-regular text-secondary">
            {plan.items.length} {plan.items.length === 1 ? "file" : "files"}: {plan.items.map((i) => i.fileName).join(", ")}
            {plan.skipped.length > 0 &&
              ` — ${plan.skipped.length} skipped: ${plan.skipped.map((s) => s.name).join(", ")} (no panels yet).`}
          </p>
        )}
        {planError && <p className="text-regular text-red-600">{planError}</p>}
        {progress && <p className="text-regular">{progress}</p>}
        {error && <p className="text-regular text-red-600">{error}</p>}
        {done && (
          <div className="flex flex-col gap-2">
            <p className="text-regular">
              Exported {done.exported_count} {done.exported_count === 1 ? "file" : "files"} to “{done.folder}”
              {done.skipped_count > 0 && `, skipped ${done.skipped_count}`}
              {done.failed_count > 0 && `, ${done.failed_count} failed`}.
            </p>
            {done.skipped.length > 0 && (
              <p className="text-regular text-secondary">
                Skipped: {done.skipped.map((s) => `${s.name} — ${s.reason}`).join("; ")}
              </p>
            )}
            {done.failed.length > 0 && (
              <p className="text-regular text-red-600">
                Failed: {done.failed.map((f) => `${f.name} — ${f.error}`).join("; ")}
              </p>
            )}
          </div>
        )}
        {!done && (
          <div className="flex gap-2">
            <Button variant="accent" disabled={progress !== null || !plan} onClick={() => void exportAll()}>
              Export
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
