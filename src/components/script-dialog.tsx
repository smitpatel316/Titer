// File ▸ Run Script… — Prism scripts (v2 item 6): automation without
// programming, as GraphPad Prism 10 documents it. The script runs through
// the pure engine (lib/prism-script.ts); the dialog only executes its
// effects — file writes, graph renders, save, print — in order, against
// the run's project, and shows the log. One run is one undo step, and a
// run that hits an error changes nothing.
//
// Seq 228: a script can be saved in the project (with its run-on-open /
// run-on-close hooks), so it travels with the file and runs when the
// project opens or closes, as Prism's saved scripts do.
import * as React from "react";
import { Button, Checkbox, Input } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectActions, useProjectStore } from "../store/use-project-store";
import type { ProjectScript } from "../store/types";
import { readText } from "../native";
import { runScript, scriptImportFiles } from "../lib/prism-script";
import { executeEffect } from "../lib/script-effects";

const SAMPLE_SCRIPT = `// Prism script — reshape the first table and set an info constant.
// Rows: 0 is the title row, 1 the first data row. Columns: -1 the row
// titles, 0 the X column, 1 the first Y column. Resolutions: 100, 300,
// 600, 1200. See the command list below for the rest.
GoTo D, 1
SetYReplicates 3
SetInfo "Dose-response, run 1", 1
SetInfo "Assay", 1, 0
`;

const COMMANDS = `GoTo D|I|R|G|L [, n|name] — switch sheets (data, info, results, graph, layout); GoTo + is the next sheet
SetPath "folder" — where relative file names land
SetYReplicates # — replicates per Y data set (grouped, XY, nested)
ClearTable [row, col, subcol] — erase left-and-below the cell (no args: the whole table)
DeleteAllDataSets — erase every table and its analyses and graphs
SetInfo "value", row [, 0 name | 1 value | 2 notes] — info constants (notes append)
SetValueToInfo infoTable, infoRow, dataRow, dataCol [, subcol] — copy a cell into an info constant
InsertData row, col, subcol <Data> … </Data> — inline data, one CSV row per line
Import "file" [, row, col, subcol] — a CSV/text file into the current table
Copy / Paste — the current table's grid, through the script clipboard
DuplicateDataTable [CLEAR] — copy the current table (CLEAR: empty)
CreateLayout rows, cols [, orientation, startGraph, count] — a figure from the graphs
ExportTable ["file" | ALL] — the current table, or every table, as CSV
ExportPNG / ExportJPG / ExportSVG / ExportTIF / ExportBMP ["file"] [resolution] [mode] [CLEAR] — the current graph or layout (TIF modes: RGBhi, GRAY, MONO; CLEAR is transparent — graphs only, figures stay on white)
ExportPDF ["file"] [resolution] — the current graph or layout as a vector PDF (the resolution only matters if the graph falls back to a raster PDF)
ExportEPS ["file"] — the current graph or layout as vector PostScript
ExportAllPDF ["folder"] — every graph and layout in the project, one vector PDF each, named after the sheet (the folder defaults to SetPath; a sheet that fails warns and the batch continues)
SetGraphTitle "title" — SetXTitle / SetYTitle / SetAxisTitle X|Y, "title"
SetAxisLimits X|Y, min, max [, step] — ApplyColorScheme "name"
OpenOutput ["file"] — WTitle, WVersion, WText, WDate, WCell row, col, WRow row, WCol col, WSheet — CloseOutput
ForEach # | ForEach Sheet … Next — loops (%N the loop number, %S the sheet name)
SetProjectName "name" — SetSheetTitle "name" [K] — SetScriptDialogTitle "title"
Save — Print — Beep — RecalcAll — CloseScriptDialog`;

export function ScriptDialog({ onSave }: { onSave: () => void }) {
  const { selector, closeSelector, scripts } = useProjectStore();
  const { get, applyScript, setScripts } = useProjectActions();
  const [script, setScript] = React.useState(SAMPLE_SCRIPT);
  const [log, setLog] = React.useState<string[]>([]);
  const [running, setRunning] = React.useState(false);
  const [title, setTitle] = React.useState("Run Script");

  if (selector?.kind !== "script") return null;

  const run = async () => {
    if (running) return;
    setRunning(true);
    setLog([]);
    try {
      const state = get();
      const doc = {
        nodes: state.nodes,
        rootOrder: state.rootOrder,
        childOrder: state.childOrder,
        activeNodeId: state.activeNodeId,
        projectName: state.projectName,
      };
      // Pre-flight: read every file an Import names, so the engine stays pure.
      const files: Record<string, string> = {};
      for (const file of scriptImportFiles(script)) {
        try {
          files[file] = await readText(file);
        } catch {
          setLog([`Couldn't read "${file}".`]);
          return;
        }
      }
      const result = runScript(doc, script, files);
      const lines = [...result.log];
      if (result.dialogTitle !== undefined) setTitle(result.dialogTitle || "Run Script");
      if (result.stopped) {
        setLog(lines);
        return;
      }
      // One undo step per run — but only when the run changed something.
      if (JSON.stringify(result.doc) !== JSON.stringify(doc)) applyScript(result.doc);
      else lines.push("No changes.");
      for (const effect of result.effects) {
        try {
          const warning = await executeEffect(effect, result.doc.nodes, onSave, closeSelector);
          if (warning) lines.push(warning);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          if (effect.type === "export-graph" && effect.sheetName)
            lines.push(`Couldn't export “${effect.sheetName}”: ${reason} — the batch continues with the other sheets.`);
          else lines.push(`Couldn't run ${effect.type}: ${reason}`);
        }
      }
      setLog(lines);
    } finally {
      setRunning(false);
    }
  };

  // ── Saved in this project (seq 228) ────────────────────────────────
  const saved = scripts ?? [];
  const [saveName, setSaveName] = React.useState("");
  const [saveOnOpen, setSaveOnOpen] = React.useState(false);
  const [saveOnClose, setSaveOnClose] = React.useState(false);

  /** Save the editor's script under `saveName` (or update the script of
   *  that name), with its hooks. Saving is one undo step; the project must
   *  be saved to keep it in the file. */
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name || !script.trim()) return;
    const next: ProjectScript[] = [...saved];
    const at = next.findIndex((s) => s.name === name);
    const entry: ProjectScript = {
      id: at >= 0 ? next[at].id : crypto.randomUUID(),
      name,
      text: script,
      runOnOpen: saveOnOpen,
      runOnClose: saveOnClose,
    };
    if (at >= 0) next[at] = entry;
    else next.push(entry);
    setScripts(next);
    setLog([`Saved “${name}” in this project. Save the project to keep it.`]);
  };

  const loadSaved = (entry: ProjectScript) => {
    setScript(entry.text);
    setSaveName(entry.name);
    setSaveOnOpen(entry.runOnOpen);
    setSaveOnClose(entry.runOnClose);
    setLog([]);
  };

  const toggleHook = (entry: ProjectScript, hook: "runOnOpen" | "runOnClose") =>
    setScripts(saved.map((s) => (s.id === entry.id ? { ...s, [hook]: !s[hook] } : s)));

  return (
    <Dialog
      open
      onClose={running ? undefined : closeSelector}
      onReturn={!running ? () => void run() : undefined}
      title={title}
      description="A Prism script runs against this project. A run that hits an error changes nothing; a good run is one undo step."
      footer={
        <>
          <Button
            onClick={() => {
              setScript(SAMPLE_SCRIPT);
              setLog([]);
            }}
          >
            Load sample
          </Button>
          <Button variant="accent" disabled={running} onClick={() => void run()}>
            {running ? "Running…" : "Run Script"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          spellCheck={false}
          rows={12}
          className="w-full rounded border border-default bg-surface p-2 font-mono text-small"
          aria-label="Prism script"
        />
        <details>
          <summary className="cursor-pointer text-small text-secondary">Commands</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-small text-secondary">{COMMANDS}</pre>
        </details>
        <details open={saved.length > 0}>
          <summary className="cursor-pointer text-small text-secondary">
            Saved in this project{saved.length ? ` (${saved.length})` : ""}
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {saved.map((entry) => (
              <div key={entry.id} className="flex items-center gap-2 text-regular">
                <Button
                  size="small"
                  onClick={() => loadSaved(entry)}
                  title={`Load “${entry.name}” into the editor`}
                >
                  {entry.name}
                </Button>
                <label className="flex items-center gap-1 text-small text-secondary">
                  <Checkbox checked={entry.runOnOpen} onChange={() => toggleHook(entry, "runOnOpen")} />
                  Run on open
                </label>
                <label className="flex items-center gap-1 text-small text-secondary">
                  <Checkbox checked={entry.runOnClose} onChange={() => toggleHook(entry, "runOnClose")} />
                  Run on close
                </label>
                <Button size="small" variant="ghost" onClick={() => setScripts(saved.filter((s) => s.id !== entry.id))}>
                  Delete
                </Button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Script name"
                aria-label="Script name"
                className="w-40"
              />
              <label className="flex items-center gap-1 text-small text-secondary">
                <Checkbox checked={saveOnOpen} onChange={setSaveOnOpen} />
                Run on open
              </label>
              <label className="flex items-center gap-1 text-small text-secondary">
                <Checkbox checked={saveOnClose} onChange={setSaveOnClose} />
                Run on close
              </label>
              <Button size="small" disabled={!saveName.trim() || !script.trim()} onClick={saveCurrent}>
                Save script
              </Button>
            </div>
            <p className="text-small text-secondary">
              Saved scripts travel with the project file; a script with Run on open runs when the project opens, one
              with Run on close when it closes.
            </p>
          </div>
        </details>
        {log.length > 0 && (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-surface p-2 text-small">
            {log.join("\n")}
          </pre>
        )}
      </div>
    </Dialog>
  );
}
