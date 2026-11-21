// Headless project / document work for the MCP dispatcher (v1.6.0 L2,
// GAP-4): save, Prism import and close, as the L0 dispatch jobs
// `save-project`, `import-prism` and `close-project` execute them.
//
// These mirror the matching `useDocument` flows (`save`, `importPrismFile`,
// `confirmDiscard`) minus everything a human does: no format-nudge prompt
// (the format is explicit, or the file's own), no path picker (the path is
// an argument), no alerts. A writer's failure is thrown with the writer's
// own message — a project that cannot go to `.pzfx` is never silently
// saved as `.hlx` instead.
//
// The close bypass: the close job settles the save question itself, so the
// window's close-requested handler (`confirmDiscard`) must not ask again.
// `allowMcpCloseOnce` arms a one-shot, 30-second allowance the handler
// consumes — an allowance that outlives a failed close expires instead of
// letting a later hand-close skip its prompt.
import { convertPrism, type ConvertReport } from "../lib/prism";
import { parsePzfx } from "../lib/pzfx";
import { parsePzf } from "../lib/pzf";
import { writePrism } from "../lib/prism-write";
import { writePzfx } from "../lib/pzfx-write";
import { parseProjectText, serializeProjectFile } from "../lib/project-file";
import { formatMergeReport, mergeProjects } from "../lib/project-merge";
import { fileName, fileTitle, sameFilePath } from "../lib/paths";
import * as native from "../native";
import type { ProjectNode, ProjectScript } from "./types";

/** The project as a document job sees it: the store state, nothing more. */
export interface DocumentState {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
  projectName?: string;
  /** The project's saved Prism scripts (seq 228) — a save must carry them,
   *  or an MCP save would silently drop what the GUI saved. */
  scripts?: ProjectScript[];
  fileUnknowns?: Record<string, unknown>;
  projectUnknowns?: Record<string, unknown>;
  filePath: string | null;
  isDirty: boolean;
  revision: number;
  /** The last opening's failure, if this window's file failed to load — the
   *  same message the GUI shows. Null once a file loads. The test harness's
   *  hand-built states omit it, so it stays optional here. */
  openError?: string | null;
}

/** The native IO a document job needs, injectable so the node test harness
 *  can drive these jobs without a webview (defaults: the real calls). */
export interface DocumentIo {
  writeFile: (path: string, data: string | Uint8Array) => Promise<unknown>;
  appVersion: () => Promise<string>;
  readText: (path: string) => Promise<string>;
  readPrismText: (path: string) => Promise<string>;
  readPrismBytes: (path: string) => Promise<Uint8Array>;
  /** A data file's (`.csv`, `.tsv`, `.txt`) text, for import. */
  readDataText: (path: string) => Promise<string>;
  /** A data file's (`.xlsx`) bytes, for import — a ZIP, so text won't do. */
  readDataBytes: (path: string) => Promise<Uint8Array>;
}

export const defaultDocumentIo: DocumentIo = {
  writeFile: native.writeFile,
  appVersion: native.appVersion,
  readText: native.readText,
  readPrismText: native.readPrismText,
  readPrismBytes: native.readPrismBytes,
  readDataText: native.readDataText,
  readDataBytes: native.readDataBytes,
};

export interface DocumentDeps {
  getState: () => DocumentState;
  /** The store's `loadProject` (import replaces the project). */
  loadProject: (payload: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
    projectName?: string;
    scripts?: ProjectScript[];
    fileUnknowns?: Record<string, unknown>;
    projectUnknowns?: Record<string, unknown>;
    filePath: string | null;
    edited?: boolean;
  }) => void;
  /** The store's `markProjectSaved`. */
  markSaved: (filePath: string | null, revision: number) => void;
  io: DocumentIo;
}

export type SaveFormat = "hlx" | "prism" | "pzfx";

// ── Close bypass ─────────────────────────────────────────────────────────

const CLOSE_ALLOWANCE_MS = 30_000;
let mcpCloseAllowedUntil = 0;

/** Arm the one-shot close allowance (see the module docs). */
export function allowMcpCloseOnce() {
  mcpCloseAllowedUntil = Date.now() + CLOSE_ALLOWANCE_MS;
}

/** Consume the allowance, if one is live — the close-requested handler's check. */
export function consumeMcpCloseAllowance(): boolean {
  if (Date.now() > mcpCloseAllowedUntil) return false;
  mcpCloseAllowedUntil = 0;
  return true;
}

// ── Save ─────────────────────────────────────────────────────────────────

/** A save format the agent asked for, or a plain refusal naming the three. */
export function parseSaveFormat(format: string): SaveFormat {
  switch (format.toLowerCase()) {
    case "hlx":
      return "hlx";
    case "prism":
      return "prism";
    case "pzfx":
      return "pzfx";
    default:
      throw new Error(`Unknown save format “${format}” — use "hlx", "prism" or "pzfx".`);
  }
}

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Where a save goes, and in what format. Resolution order: an explicit
 *  `format`, then the Save As path's extension, then the current file's
 *  extension. A format and a path that disagree are refused — `.pzfx`
 *  bytes never land in a `.hlx` file (or the reverse). An untitled project
 *  has no file, so it needs a path (Save As, as the UI does on first Save). */
export function resolveSaveTarget(
  currentFile: string | null,
  pathArg: string | undefined,
  formatArg: SaveFormat | undefined,
): { target: string; format: SaveFormat } {
  const target = pathArg ?? currentFile;
  if (!target) {
    throw new Error(`This project has no file yet — pass "path" to save it (Save As).`);
  }
  const pathExt = extOf(target);
  const isSaveExt = (ext: string): ext is SaveFormat => ext === "hlx" || ext === "prism" || ext === "pzfx";
  const currentExt = currentFile ? extOf(currentFile) : "";
  const format =
    formatArg ?? (isSaveExt(pathExt) ? pathExt : undefined) ?? (isSaveExt(currentExt) ? currentExt : undefined);
  if (!format) {
    throw new Error(
      `“${fileName(target)}” has no save format — pass "format" ("hlx", "prism" or "pzfx") or a "path" ending in one of those.`,
    );
  }
  if (pathExt && pathExt !== format) {
    throw new Error(
      `“${fileName(target)}” ends in .${pathExt}, not .${format} — pass a "path" ending in .${format} to save as ${format}, or save with format "${pathExt}".`,
    );
  }
  return { target: pathExt ? target : `${target}.${format}`, format };
}

/** The project's bytes in `format`, built by the TS writers — the same
 *  writers the UI save uses. Throws the writer's own error (e.g. a project
 *  with no data tables cannot go to `.pzfx`); a table mixing Y formats
 *  splits into one table per format instead of refusing (seq 163). */
export async function buildSaveBytes(state: DocumentState, format: SaveFormat, version: string): Promise<Uint8Array> {
  const payload = {
    nodes: state.nodes,
    rootOrder: state.rootOrder,
    childOrder: state.childOrder,
    activeNodeId: state.activeNodeId,
    projectName: state.projectName,
    scripts: state.scripts,
    fileUnknowns: state.fileUnknowns,
    projectUnknowns: state.projectUnknowns,
  };
  switch (format) {
    case "hlx":
      return new TextEncoder().encode(serializeProjectFile(payload));
    case "prism":
      return (await writePrism(payload, version)).bytes;
    case "pzfx":
      return (await writePzfx(payload, version)).bytes;
  }
}

/** The `save-project` job: write the project and mark it saved. Returns
 *  the tool's output shape (`{ project_id, file_path, format, revision }`). */
export async function executeSaveProject(
  deps: DocumentDeps,
  args: { path?: string; format?: string },
  projectId: string,
): Promise<{ result: unknown }> {
  const formatArg = args.format === undefined ? undefined : parseSaveFormat(args.format);
  const state = deps.getState();
  const { target, format } = resolveSaveTarget(state.filePath, args.path, formatArg);
  const version = await deps.io.appVersion().catch(() => "1.5.0");
  const revision = state.revision;
  // Read the project only now, after the format is settled: bytes are
  // built from the state as it is at write time, as the UI save does.
  const bytes = await buildSaveBytes(deps.getState(), format, version);
  try {
    await deps.io.writeFile(target, bytes);
  } catch (err) {
    throw new Error(
      `“${fileName(target)}” couldn't be saved there (${err instanceof Error ? err.message : String(err)}). Try another folder.`,
    );
  }
  deps.markSaved(target, revision);
  return { result: { project_id: projectId, file_path: target, format, revision } };
}

// ── Prism import ─────────────────────────────────────────────────────────

/** The import report as the tool's `warnings`: the converter's issues,
 *  plus the things `formatReport` names that aren't issues (unsupported
 *  analyses, untransferred graphs/layouts, ignored sheets). */
export function importWarnings(report: ConvertReport): string[] {
  const warnings = report.issues.map((i) => i.message);
  if (report.analysesUnsupported.length) {
    warnings.push(`Analyses not transferred (not yet supported in Titer): ${report.analysesUnsupported.join("; ")}`);
  }
  if (report.graphsNotTransferred) {
    warnings.push(
      `Graphs not transferred: ${report.graphsNotTransferred} — re-create in Titer (graph data is stored in a binary format Prism does not document).`,
    );
  }
  if (report.layoutsNotTransferred) {
    warnings.push(`Layouts not transferred: ${report.layoutsNotTransferred} — re-create with the figure builder.`);
  }
  if (report.orphanSheetsIgnored || report.unreferencedTablesIgnored) {
    warnings.push(
      `Ignored: ${report.orphanSheetsIgnored} orphan sheet(s) and ${report.unreferencedTablesIgnored} unreferenced table(s) that document.json doesn't list.`,
    );
  }
  return warnings;
}

/** How long a file read may take before the import job fails instead of
 *  hanging (seq 248): a local read is well under this, even for a large
 *  file — a longer wait means the read is blocked, not slow. */
export const FILE_READ_TIMEOUT_MS = 60_000;

/** Reads a file, or fails after `FILE_READ_TIMEOUT_MS` with the likely
 *  cause (seq 248): on macOS the first read of a file in Documents,
 *  Desktop or Downloads pops a permission prompt ("Titer would like to
 *  access…") and the read waits until it is answered — so an unanswered
 *  prompt used to wedge the whole app. The shell read is async now, so
 *  the app stays responsive; this timeout ends the job in ERROR instead
 *  of leaving it wedged in the serial job drain. */
export async function readFileWithTimeout<T>(read: () => Promise<T>, path: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `“${fileName(path)}” couldn't be read in time — macOS may be waiting on a permission prompt for Documents, Desktop or Downloads. Answer the prompt (Allow), or move the file out of the protected folder and retry.`,
              ),
            ),
          FILE_READ_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A Prism file read, with the seq 248 timeout (see `readFileWithTimeout`). */
export const PRISM_READ_TIMEOUT_MS = FILE_READ_TIMEOUT_MS;

/** Reads a Prism file, or fails after `PRISM_READ_TIMEOUT_MS` with the
 *  likely cause (seq 248) — see `readFileWithTimeout`. */
export async function readPrismWithTimeout<T>(read: () => Promise<T>, path: string): Promise<T> {
  return readFileWithTimeout(read, path);
}

/** The `import-prism` job: read a Prism file and load it as this window's
 *  (untitled, edited) project — the same as File ▸ Import Prism File, minus
 *  the dialog. A dirty project refuses: an import replaces the project, and
 *  the agent must save or close it first. Returns the tool's output shape
 *  (`{ imported_tables, warnings }`). */
export async function executeImportPrism(
  deps: DocumentDeps,
  args: { path: string },
  _projectId: string,
): Promise<{ result: unknown }> {
  const ext = extOf(args.path);
  if (ext !== "prism" && ext !== "pzfx" && ext !== "pzf") {
    throw new Error(`“${fileName(args.path)}” is not a Prism file — import a .prism, .pzfx or .pzf file.`);
  }
  if (deps.getState().isDirty) {
    throw new Error(
      "This project has unsaved changes — save it with titer_save_project, or close it, then import.",
    );
  }
  if (ext === "prism") {
    const bytes = await readPrismWithTimeout(() => deps.io.readPrismBytes(args.path), args.path);
    let converted;
    try {
      converted = await convertPrism(bytes, fileTitle(args.path));
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "This file couldn't be imported.");
    }
    deps.loadProject({ ...converted.project, filePath: null, edited: true });
    return { result: { imported_tables: converted.report.tables, warnings: importWarnings(converted.report) } };
  }
  if (ext === "pzf") {
    const bytes = await readPrismWithTimeout(() => deps.io.readPrismBytes(args.path), args.path);
    const imported = parsePzf(bytes);
    if (imported.tables.length === 0) {
      throw new Error(imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.");
    }
    deps.loadProject({ ...imported.project, filePath: null, edited: true });
    return { result: { imported_tables: imported.tables, warnings: imported.issues.map((i) => i.message) } };
  }
  const text = await readPrismWithTimeout(() => deps.io.readPrismText(args.path), args.path);
  const imported = parsePzfx(text);
  if (imported.tables.length === 0) {
    throw new Error(imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.");
  }
  deps.loadProject({ ...imported.project, filePath: null, edited: true });
  return { result: { imported_tables: imported.tables, warnings: imported.issues.map((i) => i.message) } };
}

// ── Merge ────────────────────────────────────────────────────────────────

/** What the `merge-project` job needs: the project as it is now, the
 *  store's `mergeProject` action (one undo step), and the file reads. */
export interface MergeDeps {
  getState: () => DocumentState;
  /** The store's `mergeProject` (File ▸ Merge, seq 180). */
  mergeProject: (doc: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
  }) => void;
  io: DocumentIo;
}

/** The `merge-project` job: read another project file and append its
 *  sheets to this one — the same as File ▸ Merge, minus the dialog.
 *  A `.hlx` / `.pzt` file merges as a project; a `.prism` / `.pzfx` file
 *  is converted first, then merged (the import report's issues ride along
 *  in `warnings`). Unlike an import, this never discards the project, so
 *  a dirty project merges fine. Returns the merge report as the tool's
 *  output (`merged_*` counts, the merged names, and what was renamed,
 *  skipped or dropped — and why). */
export async function executeMergeProject(
  deps: MergeDeps,
  args: { path: string },
  projectId: string,
): Promise<{ result: unknown }> {
  const ext = extOf(args.path);
  if (ext !== "hlx" && ext !== "pzt" && ext !== "prism" && ext !== "pzfx") {
    throw new Error(
      `“${fileName(args.path)}” is not a project file — merge a .hlx or .pzt project, or a .prism or .pzfx Prism file.`,
    );
  }
  // Prism's rule: the file to merge "must not be open" — merging this
  // window's own file would duplicate every sheet under an asterisk.
  const openPath = deps.getState().filePath;
  if (openPath && sameFilePath(openPath, args.path)) {
    throw new Error(`“${fileName(args.path)}” is already open in this window — merge a file that isn't open.`);
  }
  const sourceName = fileTitle(args.path);
  let incoming: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
    activeNodeId: string | null;
  };
  const warnings: string[] = [];
  if (ext === "prism") {
    const bytes = await readPrismWithTimeout(() => deps.io.readPrismBytes(args.path), args.path);
    let converted;
    try {
      converted = await convertPrism(bytes, sourceName);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "This file couldn't be imported.");
    }
    incoming = converted.project;
    warnings.push(...importWarnings(converted.report));
  } else if (ext === "pzfx") {
    const text = await readPrismWithTimeout(() => deps.io.readPrismText(args.path), args.path);
    const imported = parsePzfx(text);
    if (imported.tables.length === 0) {
      throw new Error(imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.");
    }
    incoming = imported.project;
    warnings.push(...imported.issues.map((i) => i.message));
  } else {
    let text: string;
    try {
      text = await deps.io.readText(args.path);
    } catch {
      throw new Error(`“${fileName(args.path)}” couldn't be read. It may be damaged, or in an encoding Titer can't read.`);
    }
    let parsed;
    try {
      parsed = parseProjectText(text);
    } catch {
      throw new Error("This file is damaged or isn't a valid Titer project.");
    }
    if ("error" in parsed) throw new Error(parsed.error);
    incoming = parsed.project;
    warnings.push(...parsed.issues.map((i) => i.message));
  }
  const state = deps.getState();
  // A converted Prism file can come back with no sheets at all (the .hlx
  // and .pzfx readers refuse empties themselves, above): nothing to merge
  // is a refusal, not a "Merged 0 sheets" report.
  if (Object.keys(incoming.nodes).length === 0) {
    throw new Error(`“${fileName(args.path)}” has no sheets to merge.`);
  }
  const merged = mergeProjects(
    { nodes: state.nodes, rootOrder: state.rootOrder, childOrder: state.childOrder, activeNodeId: state.activeNodeId },
    incoming,
    sourceName,
  );
  deps.mergeProject({
    nodes: merged.nodes,
    rootOrder: merged.rootOrder,
    childOrder: merged.childOrder,
    activeNodeId: merged.activeNodeId,
  });
  const { report } = merged;
  return {
    result: {
      project_id: projectId,
      source: sourceName,
      merged_tables: report.tables.length,
      merged_analyses: report.analyses.length,
      merged_graphs: report.graphs.length,
      merged_figures: report.figures.length,
      merged_info_sheets: report.infoSheets.length,
      merged: [...report.tables, ...report.analyses, ...report.graphs, ...report.figures, ...report.infoSheets],
      renamed: report.renamed,
      skipped: report.skipped,
      dropped: report.dropped,
      warnings,
      report: formatMergeReport(report),
    },
  };
}

// ── Close ────────────────────────────────────────────────────────────────

/** The `close-project` job: settle the save question, then arm the close
 *  bypass — Rust closes the window once this job reports done. `save`
 *  omitted on a dirty project answers `{ needs_confirm: true }` instead of
 *  closing (the tool returns that as its output); `save: "save"` saves back
 *  in the current format first (an untitled project has no file, so the
 *  save throws plainly and the window stays open). */
export async function executeCloseProject(
  deps: DocumentDeps,
  args: { save?: string },
  projectId: string,
): Promise<{ result: unknown }> {
  const save = args.save;
  if (save !== undefined && save !== "save" && save !== "discard") {
    throw new Error(`Unknown save choice “${save}” — use "save" or "discard", or omit it to be asked.`);
  }
  const state = deps.getState();
  if (!save && state.isDirty) {
    return {
      result: { project_id: projectId, closed: false, needs_confirm: true, warning: "unsaved changes" },
    };
  }
  if (save === "save") {
    await executeSaveProject(deps, {}, projectId);
  }
  allowMcpCloseOnce();
  return { result: { project_id: projectId, closed: true } };
}
