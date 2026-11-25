// Saved-scripts panel for the Run Script dialog (seq 228) — split out of
// script-dialog.tsx so its state lives in a component that only mounts
// while the dialog is open.
//
// Issue 13: the save-name / run-on-open / run-on-close `useState` calls
// used to sit in ScriptDialog AFTER its early
// `if (selector?.kind !== "script") return null;`, so the component ran 4
// hooks while closed and 7 while open and React threw "Rendered more hooks
// than during the previous render" on open/close. Keeping them here — in a
// child that mounts only when the dialog is open — means no hook ever
// follows a conditional return.
import * as React from "react";
import { Button, Checkbox, Input } from "../ui/controls";
import type { ProjectScript } from "../store/types";

export function SavedScriptsPanel({
  script,
  setScript,
  setLog,
  saved,
  setScripts,
}: {
  script: string;
  setScript: (text: string) => void;
  setLog: (lines: string[]) => void;
  saved: ProjectScript[];
  setScripts: (next: ProjectScript[]) => void;
}) {
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
          Saved scripts travel with the project file; a script with Run on open runs when the project opens, one with
          Run on close when it closes.
        </p>
      </div>
    </details>
  );
}
