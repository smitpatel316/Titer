// Running a Prism script's effects (seq 228): the dialog and the open/close
// auto-run share this — the pure engine (lib/prism-script.ts) returns effects
// as data, and this executes them in order against the live project: rendering
// a graph or figure and writing it, writing a text file, saving the project,
// printing, or closing the dialog. A run that hits an error stops and changes
// nothing: the caller applies the doc only after the engine succeeds, so one
// bad line never leaves half a script applied.
import { readText, writeFile } from "../native";
import { runScript, scriptImportFiles, type ScriptDoc, type ScriptEffect } from "./prism-script";
import { renderScriptGraph } from "../views/graphs/script-graph-export";
import type { ProjectNode } from "../store/types";

/** One effect, against the run's project. */
export async function executeEffect(
  effect: ScriptEffect,
  nodes: Record<string, ProjectNode>,
  onSave: () => void,
  closeSelector: () => void,
) {
  switch (effect.type) {
    case "export-graph": {
      const node = nodes[effect.graphId];
      if (!node) throw new Error("the graph is gone");
      const bytes = await renderScriptGraph(node, nodes, effect.format, effect.dpi, effect.clear, effect.mode);
      await writeFile(effect.path, bytes);
      return;
    }
    case "write-text-file":
      await writeFile(effect.path, effect.text);
      return;
    case "save-project":
      onSave();
      return;
    case "print":
      window.print();
      return;
    case "close-dialog":
      closeSelector();
      return;
  }
}

/** Run one script's text against a project doc — the dialog's run, without
 *  the dialog: pre-flights the files an Import names, runs the pure engine,
 *  and executes the effects in order. Returns the resulting doc (the input,
 *  unchanged, when the run stopped on an error) and the log lines. A stopped
 *  run's effects never execute. */
export async function runProjectScriptText(
  doc: ScriptDoc,
  text: string,
  onSave: () => void,
): Promise<{ doc: ScriptDoc; log: string[]; stopped: boolean }> {
  const files: Record<string, string> = {};
  for (const file of scriptImportFiles(text)) {
    try {
      files[file] = await readText(file);
    } catch {
      return { doc, log: [`Couldn't read "${file}".`], stopped: true };
    }
  }
  const result = runScript(doc, text, files);
  const log = [...result.log];
  if (result.stopped) return { doc, log, stopped: true };
  for (const effect of result.effects) {
    try {
      await executeEffect(effect, result.doc.nodes, onSave, () => {});
    } catch (err) {
      log.push(`Couldn't run ${effect.type}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { doc: result.doc, log, stopped: false };
}
