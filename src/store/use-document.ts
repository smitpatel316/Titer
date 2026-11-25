import * as React from "react";
import { useProjectStore, type ProjectNode } from "./use-project-store";
import { parseProjectText, serializeProjectFile, PROJECT_FILE_EXTENSION } from "../lib/project-file";
import { extractFamily } from "../lib/family";
import {
  extractMethod,
  formatMethodReport,
  isMethodPath,
  isTemplatePath,
  METHOD_FILE_EXTENSION,
  methodForTable,
  remapGraphOptions,
  TEMPLATE_FILE_EXTENSION,
  type TemplateInfo,
  type TemplateKind,
} from "../lib/template";
import { WELCOME_KEY, planTemplateApply, shouldShowWelcome, templateById } from "../lib/templates";
import { markGuideSeen, readGuideSeen, shouldShowGuide } from "../lib/startup-guide";
import { parsePzfx, type PzfxImport } from "../lib/pzfx";
import { parsePzf } from "../lib/pzf";
import { writePzfx } from "../lib/pzfx-write";
import { formatMergeReport, mergeProjects } from "../lib/project-merge";
import { convertPrism, formatReport, loadPrismZip } from "../lib/prism";
import {
  clearRegenPlans,
  getRegenPlans,
  planGraphRegeneration,
  planPzfxGraphs,
  regenPlanCounts,
  setRegenPlans,
  type GraphPlan,
} from "../lib/prism-graph-regen";
import { isDataFilePath, parseXlsx, rowsToTable } from "../lib/tabular-import";
import {
  computeImport,
  dataColumnLetter,
  resolveImportTableName,
  type ImportChoices,
  type ImportOffer,
} from "../lib/import-choices";
import { applyLinkedBlock, linkedPasteKindOf, type LinkedPaste } from "../lib/linked-paste";
import { columnsBeyond, writeBlock } from "../views/tables/table-data";
import { newConstantId } from "../lib/info-sheets";
import { formatWriteReport, writePrism, type PrismWriteReport } from "../lib/prism-write";
import { loadPrismSaveChoice, nextSaveAction, savePrismSaveChoice } from "../lib/prism-nudge";
import { AUTOSAVE_DEBOUNCE_MS, isAutosaveEnabled } from "../lib/autosave";
import {
  backupDisplayName,
  backupIdentity,
  backupIntervalMinutes,
  backupIsNewerThanSource,
  isBackupEnabled,
  isBackupOnSheetSwitch,
  untitledBackupId,
} from "../lib/backup";
import type { SavePromptChoice } from "../components/save-prompt-dialog";
import * as native from "../native";
import { loadRecents, MAX_RECENTS, saveRecents, recentKey, type RecentEntry } from "./recents";
import { consumeMcpCloseAllowance } from "./mcp-document";
import { importWarnings } from "./mcp-document";
import { publishMcpSnapshotNow } from "./mcp-publish";
import { runProjectScriptText } from "../lib/script-effects";
import type { ScriptDoc } from "../lib/prism-script";
import type { ProjectScript } from "./types";
import { openProjectsOrSay, sayGone } from "../menus";
import { fileName, fileTitle, moveTargetPath, parentDir, renameTargetPath, sameFilePath } from "../lib/paths";
import { refreshLinkedFromFile } from "../views/tables/linked-data";
import {
  diskChangedExternally,
  isReloadableProjectPath,
  REVERT_CONFIRM_DETAIL,
  REVERT_CONFIRM_TITLE,
  revertExternalChangeDetail,
  revertExternalChangeTitle,
} from "../lib/revert";
import {
  base64ToBytes,
  bytesToBase64,
  cloudErrorMessage,
  copyName,
  handleLabel,
  isConflictError,
  isNotAuthenticatedError,
  isOfflineError,
  readCachedFile,
  remoteHandle as makeRemoteHandle,
  writeFile as writeCloudFile,
  type FileHandle,
  type RemoteDownload,
} from "../lib/cloud";

const UNTITLED = "Untitled";

const isProjectFile = (path: string) => path.toLowerCase().endsWith(`.${PROJECT_FILE_EXTENSION}`);
const isPrismFile = (path: string) => {
  const lower = path.toLowerCase();
  return lower.endsWith(".prism") || lower.endsWith(".pzfx") || lower.endsWith(".pzf");
};

/**
 * The window's project, from opening to saving: what the shell gives it to open (a
 * file, the sample, a project still open when Titer last quit), files dropped on it,
 * Save / Save As, Open Recent, the title and unsaved-changes dot of the window, and the
 * Save / Don't Save / Cancel prompt when it closes. Each project has its own window:
 * the shell decides where a project opens (native.openProjects).
 */
export function useDocument() {
  const store = useProjectStore();
  const latest = React.useRef(store);
  React.useEffect(() => {
    latest.current = store;
  });
  const [recents, setRecents] = React.useState(loadRecents);
  // The "Project Updated" notice, shown in-app rather than as a native dialog:
  // the native one's window lingered on macOS after dismissal, blocking clicks
  // and quitting (Quirk 2). Set when a load brings a file up to date.
  const [projectUpdated, setProjectUpdated] = React.useState(false);
  const dismissProjectUpdated = () => setProjectUpdated(false);
  // The template instructions notice (plan 38): a `.pzt` that carries
  // instructions (or a description with no instructions) shows them in-app
  // when it opens — Prism's popup on open. In-app, not native.alert: the
  // native dialog's window lingered on macOS after dismissal (Quirk 2).
  const [templateNotice, setTemplateNotice] = React.useState<TemplateInfo | null>(null);
  const dismissTemplateNotice = () => setTemplateNotice(null);
  // The Welcome dialog (seq 167): whether this window opened a file — a
  // file window never auto-shows it — and whether it is showing. Decided
  // once, shortly after mount (see the effect by the other mount effects).
  const openedFile = React.useRef(false);
  const [welcomeOpen, setWelcomeOpen] = React.useState(false);
  const welcomeDecided = React.useRef(false);
  const openWelcome = () => setWelcomeOpen(true);
  const closeWelcome = () => setWelcomeOpen(false);
  // The startup guide (seq 454): whether the tour is showing. Closing is
  // always "seen" — finished, skipped or dismissed all mark the record,
  // so the tour never reappears. Opening closes the Welcome dialog first:
  // the guide is a plain overlay (seq 397), and a top-layer <dialog> open
  // over it would hide it.
  const [guideOpen, setGuideOpen] = React.useState(false);
  const guideDecided = React.useRef(false);
  const openGuide = () => {
    setWelcomeOpen(false);
    setGuideOpen(true);
  };
  const closeGuide = () => {
    markGuideSeen();
    setGuideOpen(false);
  };
  // The "Prism File Imported" notice, shown in-app rather than as a native
  // dialog: the native alert's OK button could not dismiss it on macOS
  // (v1.6.0 Mac proof) — it is the second native sheet on the window in
  // immediate succession (the askToSave sheet just dismissed), and rfd's
  // sheet path leaves the alert window with a button that ends nothing
  // (Quirk 2's family). The report lines, null when no notice is up.
  const [prismImported, setPrismImported] = React.useState<string[] | null>(null);
  const dismissPrismImported = () => setPrismImported(null);
  // The "Saved as Prism" notice, shown in-app rather than as a native dialog:
  // same Quirk-2 family as `prismImported` above — the native alert's OK
  // button could not dismiss it on macOS. The .prism write report (tables /
  // analyses written, analyses dropped, the graphs warning) used to be
  // computed and then thrown away — the drop was silent (Mansi P0 #3). The
  // report lines, null when no notice is up. Only a manual save shows it:
  // autosave and the quit-save pass `silent`, so a background save never
  // pops a dialog.
  const [prismSavedReport, setPrismSavedReport] = React.useState<string[] | null>(null);
  const dismissPrismSavedReport = () => setPrismSavedReport(null);
  // The "Data File Imported" notice, in-app rather than as a native dialog:
  // same Quirk-2 family as `prismImported` above — the native alert's OK
  // button could not dismiss it on macOS. Shown only when the import has
  // something to say (assumptions it made, rows padded, sheets skipped);
  // a clean import just opens the table. The report lines, null when no
  // notice is up.
  const [dataImported, setDataImported] = React.useState<string[] | null>(null);
  const dismissDataImported = () => setDataImported(null);
  // The file offered to the Import and Paste Special Choices dialog (seq
  // 429): parsed, but placed nowhere yet. The dialog (grid, or the shell
  // when no table is active) edits the choices; confirmImport applies
  // them. Null when no import is in flight.
  const [pendingImport, setPendingImport] = React.useState<ImportOffer | null>(null);
  const cancelImport = () => setPendingImport(null);
  // The "Linked Data" notice, in-app rather than as a native dialog (Quirk 2,
  // as above): the linked sources a project open couldn't refresh, each named
  // with its table. Shown only when a refresh fails; a clean refresh is silent.
  const [linkedNotice, setLinkedNotice] = React.useState<string[] | null>(null);
  const dismissLinkedNotice = () => setLinkedNotice(null);
  // The "Project Merged" notice, in-app for the same Quirk-2 reason: what
  // File ▸ Merge brought in, and what was renamed, skipped or dropped —
  // the same report the MCP tool returns. The report lines, null when no
  // notice is up.
  const [projectMerged, setProjectMerged] = React.useState<string[] | null>(null);
  const dismissProjectMerged = () => setProjectMerged(null);
  // The import-time graph-regen offer (seq 291): the plans, for the
  // "Regenerate graphs…" button on the report dialog. The registry
  // (`setRegenPlans`) is the authority the preview dialog and the MCP
  // tools read; this state is only the button's visibility mirror — the
  // dialog opens only when the registry still holds plans.
  const [regenPlans, setRegenPlansState] = React.useState<GraphPlan[] | null>(null);
  const [regenDialogOpen, setRegenDialogOpen] = React.useState(false);
  const openRegenDialog = () => {
    if ((getRegenPlans() ?? []).length > 0) setRegenDialogOpen(true);
  };
  /** Cancel: close the preview, keep the offer (the user can reopen it). */
  const dismissRegenDialog = () => setRegenDialogOpen(false);
  /** Done: the run consumed the offer — clear the mirror and the registry. */
  const consumeRegenPlans = () => {
    setRegenDialogOpen(false);
    setRegenPlansState(null);
    clearRegenPlans();
  };
  /** Record fresh import-time plans (both the mirror and the registry). */
  const recordRegenPlans = (plans: GraphPlan[]) => {
    if (plans.length === 0) {
      setRegenPlansState(null);
      return;
    }
    setRegenPlansState(plans);
    setRegenPlans(null, plans);
  };
  // The window's title while the project isn't saved anywhere.
  const [untitled, setUntitled] = React.useState(UNTITLED);
  // Other windows change the list too: this one reads it again when it comes to the front.
  React.useEffect(
    () =>
      native.onFocusChange((focused) => {
        if (!focused) return;
        const stored = loadRecents();
        setRecents((list) =>
          stored.map(recentKey).join("\n") === list.map(recentKey).join("\n") ? list : stored,
        );
      }),
    [],
  );
  const addRecent = (entry: RecentEntry) =>
    setRecents((list) => [entry, ...list.filter((e) => recentKey(e) !== recentKey(entry))].slice(0, MAX_RECENTS));
  const clearRecents = () => setRecents([]);
  const forgetRecent = (entry: RecentEntry) =>
    setRecents((list) => list.filter((e) => recentKey(e) !== recentKey(entry)));

  React.useEffect(() => saveRecents(recents), [recents]);

  // ── Remote files (cloud storage, v2 item 75) ───────────────────────────
  // The open file's remote handle, if it lives in the cloud rather than on
  // disk. `filePath` in the store stays null for remote files (the shell's
  // session restore only knows local paths), and the title comes from the
  // remote display path instead. A ref mirrors the state for the save/close
  // callbacks, which run long after the render that set it.
  type RemoteHandle = Extract<FileHandle, { kind: "remote" }>;
  const [remote, setRemoteState] = React.useState<RemoteHandle | null>(null);
  const remoteRef = React.useRef<RemoteHandle | null>(null);
  const setRemote = (handle: RemoteHandle | null) => {
    remoteRef.current = handle;
    setRemoteState(handle);
  };
  // A save that hit a conflict: the dialog's three choices resolve it. The
  // bytes are the save attempt's, and the remote version is the one the
  // provider reported — both shown in the dialog.
  const [conflict, setConflict] = React.useState<{
    handle: RemoteHandle;
    bytes: Uint8Array;
    revision: number;
    remoteVersion: string;
    remoteModifiedAt: string | null;
    remoteSha1: string | null;
  } | null>(null);
  // Offline: the document stays editable from its cache copy. "open" means
  // the file was opened from the cache while offline; "save" means a save
  // failed for lack of network. Either way the document is never discarded.
  const [offlineNotice, setOfflineNotice] = React.useState<{ mode: "open" | "save" } | null>(null);

  const { filePath, isDirty, revision } = store;
  const title = filePath ? fileTitle(filePath) : remote ? fileTitle(remote.path) : untitled;
  const blank = !filePath && !remote && !isDirty && untitled === UNTITLED;
  // Told again when an opening fails, so the shell doesn't keep the file it expected here.
  const report = () => native.setDocument(title, remote ? null : filePath, isDirty, blank);
  React.useEffect(() => report(), [title, filePath, remote, isDirty, blank]);

  // ── Open-format nudge (f) ─────────────────────────────────────────────
  // The rule lives in docs/open-format-nudge.md: prompt once per project
  // when a Prism-origin project is saved; respect "don't ask again" (app
  // settings, never the file); Prism save always one click away.
  // `prismOrigin` is set by either Prism import and cleared when a `.hlx`
  // file is opened; `prompted` is per project, per window.
  const prismOrigin = React.useRef(false);
  const prompted = React.useRef(false);
  const pendingPrompt = React.useRef<((choice: SavePromptChoice, remember: boolean) => void) | null>(null);
  // Revert to Saved (seq 306): the file's text as this window last read or
  // wrote it. Comparing it with the text on disk now is what tells a file
  // another program rewrote since open from the last saved version — the
  // plain confirm would misdescribe that one. Null when the baseline can't
  // be compared (a `.prism` / `.pzfx` save, a remote file): the check then
  // never claims a change. Set by `load` and by the `.hlx` save below, and
  // by `revertToSaved` itself after a revert lands.
  const lastSavedTextRef = React.useRef<string | null>(null);

  /** The save prompt's answer: remember it if asked, close the dialog, and
   *  let the save waiting on it continue. */
  const resolveSavePrompt = (choice: SavePromptChoice, remember: boolean) => {
    if (remember && choice !== "cancel") savePrismSaveChoice(choice);
    const resolve = pendingPrompt.current;
    pendingPrompt.current = null;
    store.closeSelector();
    resolve?.(choice, remember);
  };

  /** Ask the save prompt and wait for its answer. */
  const askSaveFormat = () =>
    new Promise<{ choice: SavePromptChoice; remember: boolean }>((resolve) => {
      pendingPrompt.current = (choice, remember) => resolve({ choice, remember });
      store.openSelector({ kind: "save-prompt" });
    });

  /** Save the current project as a Prism `.prism` file (the prompt's Prism
   *  option, or the remembered choice). Returns false when the user cancels
   *  the path picker — the save is abandoned, not silently saved as `.hlx`. */
  const saveAsPrism = async (): Promise<boolean> => {
    const s = latest.current.get();
    const revision = s.revision;
    const version = native.isNative ? await native.appVersion().catch(() => "2.0.0") : "2.0.0";
    let bytes: Uint8Array;
    let report: PrismWriteReport;
    try {
      ({ bytes, report } = await writePrism(
        { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
        version,
      ));
    } catch (err) {
      await native.alert(
        "Couldn't Save as Prism",
        err instanceof Error ? err.message : "This project couldn't be written as .prism.",
        "error",
      );
      return false;
    }
    const target = await native.pickSavePath("Save as Prism", `${title}.prism`, "GraphPad Prism File", "prism");
    if (!target) return false;
    try {
      await native.writeFile(target, bytes);
      latest.current.markProjectSaved(target, revision);
      // The project now lives on local disk, even if it came from the cloud.
      setRemote(null);
      addRecent({ kind: "local", path: target });
      // A `.prism` save has no comparable baseline: the file holds Prism
      // bytes, not the `.hlx` text — and Revert is disabled for it anyway.
      lastSavedTextRef.current = null;
      // The write report, shown — never silently dropped (Mansi P0 #3).
      setPrismSavedReport(prismSaveReportLines(report, fileName(target)));
      return true;
    } catch (err) {
      const name = fileName(target);
      await native.alert(
        "Couldn't Save Project",
        `“${name}” couldn't be saved there (${err}). Try Save As… another folder.`,
        "error",
      );
      return false;
    }
  };

  /** Save the current project as a Prism `.pzfx` file (the prompt's .pzfx
   *  option, or the remembered choice). Mirrors saveAsPrism: same
   *  error-alert + path-picker + mark-saved flow, but through writePzfx —
   *  tables (and info sheets) only, never analyses or graphs. Returns false
   *  when the user cancels the path picker — the save is abandoned, not
   *  silently saved as `.hlx`. */
  const saveAsPzfx = async (): Promise<boolean> => {
    const s = latest.current.get();
    const revision = s.revision;
    const version = native.isNative ? await native.appVersion().catch(() => "2.0.0") : "2.0.0";
    let bytes: Uint8Array;
    try {
      bytes = (
        await writePzfx(
          { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
          version,
        )
      ).bytes;
    } catch (err) {
      await native.alert(
        "Couldn't Save as .pzfx",
        err instanceof Error ? err.message : "This project couldn't be written as .pzfx.",
        "error",
      );
      return false;
    }
    const target = await native.pickSavePath("Save as .pzfx", `${title}.pzfx`, "GraphPad Prism File", "pzfx");
    if (!target) return false;
    try {
      await native.writeFile(target, bytes);
      latest.current.markProjectSaved(target, revision);
      // The project now lives on local disk, even if it came from the cloud.
      setRemote(null);
      addRecent({ kind: "local", path: target });
      // A `.pzfx` save has no comparable baseline, like `.prism` above.
      lastSavedTextRef.current = null;
      return true;
    } catch (err) {
      const name = fileName(target);
      await native.alert(
        "Couldn't Save Project",
        `“${name}” couldn't be saved there (${err}). Try Save As… another folder.`,
        "error",
      );
      return false;
    }
  };

  // ── Remote save / open / conflict / offline (cloud storage) ────────────

  /** Saves the current project back to its remote file, conditional on the
   *  version seen at open/last-save. A `.prism` remote saves as Prism
   *  bytes, a `.pzfx` remote as `.pzfx` bytes, a `.hlx` remote as project
   *  JSON — the same rule as local files.
   *  A conflict opens the three-choice dialog instead of overwriting; an
   *  offline save shows the offline notice instead of losing the document. */
  const saveRemote = async (handle: RemoteHandle, silent = false): Promise<boolean> => {
    const s = latest.current.get();
    const revision = s.revision;
    const version = native.isNative ? await native.appVersion().catch(() => "1.0.7") : "1.0.7";
    let bytes: Uint8Array;
    let prismReport: PrismWriteReport | null = null;
    try {
      if (handle.path.toLowerCase().endsWith(".prism")) {
        const written = await writePrism(
          { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
          version,
        );
        bytes = written.bytes;
        prismReport = written.report;
      } else if (handle.path.toLowerCase().endsWith(".pzfx")) {
        bytes = (
          await writePzfx(
            { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
            version,
          )
        ).bytes;
      } else {
        bytes = new TextEncoder().encode(serializeProjectFile(s));
      }
    } catch (err) {
      await native.alert(
        "Couldn't Save Project",
        err instanceof Error ? err.message : "This project couldn't be written.",
        "error",
      );
      return false;
    }
    try {
      const saved = await writeCloudFile(handle, bytes);
      setRemote({
        ...handle,
        version: saved?.version ?? handle.version,
        sha1: saved?.sha1 ?? handle.sha1,
        modifiedAt: saved?.modifiedAt ?? handle.modifiedAt,
      });
      latest.current.markProjectSaved(null, revision);
      addRecent({
        kind: "remote",
        provider: handle.provider,
        accountId: handle.accountId,
        fileId: handle.fileId,
        path: handle.path,
      });
      setOfflineNotice(null);
      // A remote .prism save shows the write report too — same as a local
      // one — unless this was a background (auto/quit) save.
      if (!silent && prismReport) setPrismSavedReport(prismSaveReportLines(prismReport, fileName(handle.path)));
      return true;
    } catch (err) {
      if (isConflictError(err)) {
        setConflict({
          handle,
          bytes,
          revision,
          remoteVersion: err.remote_version,
          remoteModifiedAt: err.remote_modified_at ?? null,
          remoteSha1: err.remote_sha1 ?? null,
        });
        latest.current.openSelector({ kind: "conflict" });
        return false;
      }
      if (isOfflineError(err)) {
        setOfflineNotice({ mode: "save" });
        return false;
      }
      if (isNotAuthenticatedError(err)) {
        await native.alert(
          "Signed Out of Box",
          "The Box sign-in expired or was revoked. Reconnect in Settings → Connected Storage, then save again. Your edits are still here.",
          "error",
        );
        return false;
      }
      await native.alert(
        "Couldn't Save Project",
        `“${handleLabel(handle)}” couldn't be saved to ${handle.provider === "box" ? "Box" : handle.provider} (${cloudErrorMessage(err)}). Your edits are still here.`,
        "error",
      );
      return false;
    }
  };

  /** Opens a remote `.hlx` / `.prism` / `.pzfx` file in this window. Downloads it
   *  (and writes the cache copy); offline, opens the cache copy instead and
   *  says so. A `.prism` file imports as a project that saves back as
   *  `.prism` — the open keeps its remote handle, unlike a local import,
   *  which starts untitled. Same for a `.pzfx` file. */
  const loadRemote = async (handle: RemoteHandle): Promise<void> => {
    // A file is coming into this window — the Welcome dialog never auto-shows here.
    openedFile.current = true;
    const recent: RecentEntry = {
      kind: "remote",
      provider: handle.provider,
      accountId: handle.accountId,
      fileId: handle.fileId,
      path: handle.path,
    };
    const openOfflineCopy = async (): Promise<boolean> => {
      // Offline: the cache copy, if there is one, is what editing uses.
      let cached: Uint8Array;
      try {
        cached = await readCachedFile(handle);
      } catch {
        await native.alert(
          "Couldn't Open Project",
          `“${handleLabel(handle)}” can't be opened while offline — no copy of it is saved on this computer yet.`,
          "error",
        );
        return false;
      }
      if (handle.path.toLowerCase().endsWith(".prism")) {
        if (!(await importPrismBytes(cached, fileTitle(handle.path)))) return false;
      } else if (handle.path.toLowerCase().endsWith(".pzfx")) {
        if (!(await importPrismText(new TextDecoder().decode(cached), fileTitle(handle.path)))) return false;
      } else {
        const ok = await applyProjectText(new TextDecoder().decode(cached), { filePath: null, untitled: false, displayName: handle.path }, () => {});
        if (!ok) return false;
      }
      prismOrigin.current = false;
      setRemote(handle);
      setUntitled(fileTitle(handle.path));
      addRecent(recent);
      setOfflineNotice({ mode: "open" });
      return true;
    };
    let downloaded: RemoteDownload;
    try {
      downloaded = await native.cloudDownload(handle.provider, handle.accountId, handle.fileId);
    } catch (err) {
      report();
      if (isOfflineError(err)) {
        await openOfflineCopy();
        return;
      }
      if (isNotAuthenticatedError(err)) {
        await native.alert(
          "Signed Out of Box",
          "The Box sign-in expired or was revoked. Reconnect in Settings → Connected Storage to open this file.",
          "error",
        );
        return;
      }
      // Gone since it was opened last: it leaves Open Recent too.
      setRecents((list) => list.filter((e) => recentKey(e) !== recentKey(recent)));
      return sayGone(handle.path);
    }
    const next: RemoteHandle = makeRemoteHandle(
      handle.provider,
      handle.accountId,
      handle.fileId,
      handle.path,
      downloaded.version ?? null,
      downloaded.sha1 ?? null,
      downloaded.modifiedAt ?? null,
    );
    if (handle.path.toLowerCase().endsWith(".prism")) {
      if (!(await importPrismBytes(base64ToBytes(downloaded.base64), fileTitle(handle.path)))) return;
      // The project came from a `.prism` file: it saves back as `.prism`,
      // like a local file after Save as Prism — no format nudge.
      prismOrigin.current = false;
      setRemote(next);
      setUntitled(fileTitle(handle.path));
      addRecent(recent);
      return;
    }
    if (handle.path.toLowerCase().endsWith(".pzfx")) {
      if (!(await importPrismText(new TextDecoder().decode(base64ToBytes(downloaded.base64)), fileTitle(handle.path))))
        return;
      // The project came from a `.pzfx` file: it saves back as `.pzfx`,
      // like a local file after Save as .pzfx — no format nudge.
      prismOrigin.current = false;
      setRemote(next);
      setUntitled(fileTitle(handle.path));
      addRecent(recent);
      return;
    }
    await applyProjectText(
      new TextDecoder().decode(base64ToBytes(downloaded.base64)),
      { filePath: null, untitled: false, displayName: handle.path },
      () => {
        setRemote(next);
        setUntitled(fileTitle(handle.path));
        addRecent(recent);
        // A remote file has no local disk text to compare (seq 306): the
        // revert baseline is cleared, so the check never claims a change.
        lastSavedTextRef.current = null;
      },
    );
  };

  /** The conflict dialog's answer. "copy" saves a new remote file next to
   *  the original; "reload" discards local edits and takes the remote
   *  version; "overwrite" saves anyway — explicit, and never taken by
   *  autosave (there is no autosave path that calls this). */
  const resolveConflict = async (choice: "copy" | "reload" | "overwrite" | "cancel"): Promise<void> => {
    const pending = conflict;
    setConflict(null);
    latest.current.closeSelector();
    if (!pending || choice === "cancel") return;
    if (choice === "reload") {
      await loadRemote(pending.handle);
      return;
    }
    if (choice === "copy") {
      // The new file goes next to the original: the parent folder comes
      // from fresh metadata (the handle doesn't carry it).
      let parentId = "0";
      try {
        const meta = await native.cloudMetadata(pending.handle.provider, pending.handle.accountId, pending.handle.fileId);
        parentId = meta.parentId ?? "0";
      } catch {
        // Unknown parent: the provider root is the fallback, and the name
        // says it's a copy, so nothing is silently overwritten.
      }
      const name = copyName(fileName(pending.handle.path));
      try {
        const entry = await native.cloudUploadNew(
          pending.handle.provider,
          pending.handle.accountId,
          parentId,
          name,
          bytesToBase64(pending.bytes),
        );
        const next: RemoteHandle = makeRemoteHandle(
          pending.handle.provider,
          pending.handle.accountId,
          entry.id,
          entry.path,
          entry.version ?? null,
          entry.sha1 ?? null,
          entry.modifiedAt ?? null,
        );
        setRemote(next);
        latest.current.markProjectSaved(null, pending.revision);
        addRecent({
          kind: "remote",
          provider: next.provider,
          accountId: next.accountId,
          fileId: next.fileId,
          path: next.path,
        });
      } catch (err) {
        await native.alert(
          "Couldn't Save a Copy",
          `“${name}” couldn't be saved to ${pending.handle.provider === "box" ? "Box" : pending.handle.provider} (${cloudErrorMessage(err)}). Your edits are still here.`,
          "error",
        );
      }
      return;
    }
    try {
      const saved = await writeCloudFile(pending.handle, pending.bytes, null);
      setRemote({
        ...pending.handle,
        version: saved?.version ?? pending.handle.version,
        sha1: saved?.sha1 ?? pending.handle.sha1,
        modifiedAt: saved?.modifiedAt ?? pending.handle.modifiedAt,
      });
      latest.current.markProjectSaved(null, pending.revision);
    } catch (err) {
      await native.alert(
        "Couldn't Save Project",
        `“${handleLabel(pending.handle)}” still couldn't be saved (${cloudErrorMessage(err)}). Your edits are still here.`,
        "error",
      );
    }
  };

  /** The offline notice's answer. "retry" saves again from the current
   *  project (fresh bytes, not the failed attempt's); "local-copy" saves
   *  to disk instead; "dismiss" keeps editing — the document is never
   *  discarded because the network is gone. */
  const resolveOfflineNotice = async (action: "retry" | "local-copy" | "dismiss"): Promise<void> => {
    const notice = offlineNotice;
    setOfflineNotice(null);
    if (!notice) return;
    if (action === "dismiss") return;
    if (action === "retry") {
      if (notice.mode === "save") await save();
      return;
    }
    // Save a local copy: the project then lives on local disk.
    await save(true);
  };

  /** File ▸ Open from Cloud…: the remote picker (in-app folder browsing —
   *  the native OS dialog can't browse cloud locations). */
  const openRemotePicker = () => latest.current.openSelector({ kind: "remote-picker" });

  /** Opens a remote file picked in the picker. */
  const openRemoteHandle = (handle: RemoteHandle) => {
    latest.current.closeSelector();
    void loadRemote(handle);
  };

  /** Opens an Open Recent entry. Remote entries load from the cloud;
   *  local ones go through the shell as today. */
  const openRemoteEntry = (entry: RecentEntry) => {
    if (entry.kind === "local") {
      openProjectsOrSay([entry.path], (gone) => forgetRecent({ kind: "local", path: gone }));
      return;
    }
    void loadRemote(makeRemoteHandle(entry.provider, entry.accountId, entry.fileId, entry.path, null));
  };

  /** `silent` is for background saves (autosave, quit-save): they write the
   *  file but never pop the .prism write-report dialog — a dialog every
   *  10 s, or one that blocks quitting, would be worse than the silence it
   *  replaced. A manual save always shows the report. */
  const save = async (saveAs = false, options?: { silent?: boolean }): Promise<boolean> => {
    // A remote file saves back to the cloud — unless Save As, which saves a
    // local copy instead (the project then lives on local disk).
    if (remoteRef.current && !saveAs) {
      const ok = await saveRemote(remoteRef.current, options?.silent);
      // Prism: the backup is rewritten on every save, so it is never older
      // than the project file.
      if (ok) void writeBackupSnapshot();
      return ok;
    }
    const { filePath } = latest.current;
    // A project already saved as `.prism` saves back as `.prism` — never
    // write `.hlx` JSON into a `.prism` file.
    if (!saveAs && filePath?.toLowerCase().endsWith(".prism")) {
      const s = latest.current.get();
      const revision = s.revision;
      const version = native.isNative ? await native.appVersion().catch(() => "2.0.0") : "2.0.0";
      try {
        const { bytes, report } = await writePrism(
          { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
          version,
        );
        await native.writeFile(filePath, bytes);
        latest.current.markProjectSaved(filePath, revision);
        // Prism: the backup is rewritten on every save.
        void writeBackupSnapshot();
        // No comparable baseline: the file holds Prism bytes now (seq 306).
        lastSavedTextRef.current = null;
        // The write report, shown — never silently dropped (Mansi P0 #3).
        if (!options?.silent) setPrismSavedReport(prismSaveReportLines(report, fileName(filePath)));
        return true;
      } catch (err) {
        await native.alert(
          "Couldn't Save Project",
          err instanceof Error ? err.message : "This project couldn't be written as .prism.",
          "error",
        );
        return false;
      }
    }
    // A project already saved as `.pzfx` saves back as `.pzfx` — never
    // write `.hlx` JSON into a `.pzfx` file. Same branch as `.prism` above.
    if (!saveAs && filePath?.toLowerCase().endsWith(".pzfx")) {
      const s = latest.current.get();
      const revision = s.revision;
      const version = native.isNative ? await native.appVersion().catch(() => "2.0.0") : "2.0.0";
      try {
        const { bytes } = await writePzfx(
          { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
          version,
        );
        await native.writeFile(filePath, bytes);
        latest.current.markProjectSaved(filePath, revision);
        // Prism: the backup is rewritten on every save.
        void writeBackupSnapshot();
        // No comparable baseline: the file holds .pzfx bytes now (seq 306).
        lastSavedTextRef.current = null;
        return true;
      } catch (err) {
        await native.alert(
          "Couldn't Save Project",
          err instanceof Error ? err.message : "This project couldn't be written as .pzfx.",
          "error",
        );
        return false;
      }
    }
    // Nudge (f.1/f.4): a Prism-origin project prompts once; a remembered
    // choice applies silently. Marked prompted before awaiting, so a
    // re-entrant save can't double-prompt.
    if (prismOrigin.current && !prompted.current) {
      const action = nextSaveAction({
        prismOrigin: prismOrigin.current,
        prompted: prompted.current,
        remembered: loadPrismSaveChoice(),
      });
      if (action === "save-prism") {
        prompted.current = true;
        return saveAsPrism();
      }
      if (action === "save-pzfx") {
        prompted.current = true;
        return saveAsPzfx();
      }
      if (action === "prompt") {
        prompted.current = true;
        const { choice } = await askSaveFormat();
        if (choice === "prism") return saveAsPrism();
        if (choice === "pzfx") return saveAsPzfx();
        // "hlx" or Cancel: fall through to the normal `.hlx` save below.
      }
    }
    const target =
      (!saveAs && filePath) ||
      (await native.pickSavePath(
        "Save Project",
        filePath ?? `${untitled}.${PROJECT_FILE_EXTENSION}`,
        "Titer Project",
        PROJECT_FILE_EXTENSION,
      ));
    if (!target) return false;
    // Read the project only now, after the dialog: edits made while it was open
    // must end up in the file. The revision lets markProjectSaved keep the dirty
    // flag if something changes during the write itself.
    const s = latest.current.get();
    const revision = s.revision;
    // The exact text written: the revert baseline (seq 306) — the file on
    // disk holds this text until something else rewrites it.
    const text = serializeProjectFile(s);
    try {
      await native.writeFile(target, text);
      latest.current.markProjectSaved(target, revision);
      lastSavedTextRef.current = text;
      // A remote file saved to a local path now lives on local disk.
      setRemote(null);
      addRecent({ kind: "local", path: target });
      // Prism: the backup is rewritten on every save. The target is passed
      // explicitly: a Save As just moved the project, and the ref still
      // holds the old path until the next render.
      void writeBackupSnapshot({
        identity: backupIdentity({ filePath: target }),
        displayName: backupDisplayName({ filePath: target }),
        sourcePath: target,
      });
      return true;
    } catch (err) {
      const name = fileName(target);
      await native.alert(
        "Couldn't Save Project",
        `“${name}” couldn't be saved there (${err}). Try Save As… another folder.`,
        "error",
      );
      return false;
    }
  };

  // ── Save a Copy / Save Family As (seq 233/234) ───────────────────────
  // Both write a `.hlx` file and leave this window exactly as it was: the
  // current file path, the dirty flag and the revision are untouched, so
  // the next Save still goes to the file this project came from. A copy is
  // the whole project; a family is one table's family (see lib/family.ts).
  // Neither prompts for a format (a `.prism`-origin project copies as
  // `.hlx`, like Save As would after the prompt) and neither clears the
  // Prism-origin nudge — the next real Save still asks, as before.
  const saveCopy = async (): Promise<boolean> => {
    const target = await native.pickSavePath(
      "Save a Copy",
      filePath ? `${fileTitle(filePath)} copy.${PROJECT_FILE_EXTENSION}` : `${untitled} copy.${PROJECT_FILE_EXTENSION}`,
      "Titer Project",
      PROJECT_FILE_EXTENSION,
    );
    if (!target) return false;
    const s = latest.current.get();
    try {
      await native.writeFile(target, serializeProjectFile(s));
      addRecent({ kind: "local", path: target });
      return true;
    } catch (err) {
      await native.alert(
        "Couldn't Save a Copy",
        `“${fileName(target)}” couldn't be saved there (${err}). Try another folder.`,
        "error",
      );
      return false;
    }
  };

  const saveFamilyAs = async (): Promise<boolean> => {
    const s = latest.current.get();
    // The active table: the active node itself, or its parent (as the
    // store's `activeTableId` derives it — the state holds only the node).
    const activeNode = s.activeNodeId ? s.nodes[s.activeNodeId] : undefined;
    const tableId = activeNode ? (activeNode.type === "table" ? activeNode.id : activeNode.parentId) : null;
    const family = tableId ? extractFamily(s, tableId) : null;
    if (!family) return false;
    const table = s.nodes[tableId!];
    const target = await native.pickSavePath(
      "Save Family As",
      `${(table?.name ?? "Family").replaceAll("/", "-")}.${PROJECT_FILE_EXTENSION}`,
      "Titer Project",
      PROJECT_FILE_EXTENSION,
    );
    if (!target) return false;
    try {
      await native.writeFile(target, serializeProjectFile(family));
      addRecent({ kind: "local", path: target });
      return true;
    } catch (err) {
      await native.alert(
        "Couldn't Save Family",
        `“${fileName(target)}” couldn't be saved there (${err}). Try another folder.`,
        "error",
      );
      return false;
    }
  };

  // ── Rename / Move To (seq 297) ───────────────────────────────────────
  // The file moves on disk; the open project follows it: new path, new
  // title, new recent entry — content, dirty flag and revision untouched
  // (the store's `relocate`). A collision is an error dialog and nothing
  // moves; a rename to the same name, or a move into the same folder, is a
  // no-op. Untitled projects never reach here — the menu disables both
  // commands without a saved path — but the guard stands anyway.
  /** Moves the file on disk and points the open project at its new path:
   *  title, recents and backup follow. A failed move alerts and changes
   *  nothing. */
  const relocateProjectFile = async (
    target: string,
    currentPath: string,
    alertTitle: string,
  ): Promise<boolean> => {
    try {
      await native.moveFile(currentPath, target);
    } catch (err) {
      await native.alert(alertTitle, err instanceof Error ? err.message : String(err), "error");
      return false;
    }
    latest.current.relocateProject(target);
    forgetRecent({ kind: "local", path: currentPath });
    addRecent({ kind: "local", path: target });
    // The backup follows the file: the old snapshot is deleted, so crash
    // recovery never offers a project at a path that no longer exists, and
    // a fresh one lands under the new identity (same shape as after Save As).
    void deleteBackupFor(backupIdentity({ filePath: currentPath }));
    void writeBackupSnapshot({
      identity: backupIdentity({ filePath: target }),
      displayName: backupDisplayName({ filePath: target }),
      sourcePath: target,
    });
    return true;
  };

  /** File ▸ Rename…: the dialog hands back the new name; the file is
   *  renamed in place and the project follows it. False when nothing
   *  moved (invalid name, same name, collision, or no saved file). */
  const renameProject = async (newName: string): Promise<boolean> => {
    const { filePath } = latest.current;
    if (!filePath || !native.isNative) return false;
    const target = renameTargetPath(filePath, newName);
    if (!target.ok) {
      await native.alert("Couldn't Rename Project", target.error, "error");
      return false;
    }
    if (sameFilePath(target.path, filePath)) return true;
    return relocateProjectFile(target.path, filePath, "Couldn't Rename Project");
  };

  /** File ▸ Move To…: a folder picker, then the file moves there under its
   *  current name and the project follows it. */
  const moveProject = async (): Promise<boolean> => {
    const { filePath } = latest.current;
    if (!filePath || !native.isNative) return false;
    const folder = await native.pickFolder("Move Project To", parentDir(filePath));
    if (!folder) return false;
    const target = moveTargetPath(filePath, folder);
    if (!target.ok) {
      await native.alert("Couldn't Move Project", target.error, "error");
      return false;
    }
    if (sameFilePath(target.path, filePath)) return true;
    return relocateProjectFile(target.path, filePath, "Couldn't Move Project");
  };

  // ── Autosave (Plane seq 281) ───────────────────────────────────────────
  // Debounced save, 10 s after the last edit; save on sheet switch; save on
  // quit (see confirmDiscardWithAutosave below). All three go through the
  // existing save() above — no saveAs, no dialogs of their own — and only
  // when the project already has a target (a local path or a remote
  // handle). Untitled work is never autosaved (crash recovery for it is
  // Plane seq 226, separate). A failed save is never retried in a loop:
  // save() already alerted, and the timer only re-arms on the next edit. A
  // remote conflict pending skips the cycle entirely — autosave never
  // overwrites over a conflict and never calls resolveConflict's
  // "overwrite".
  const autosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveInFlight = React.useRef(false);
  const autosaveRearmPending = React.useRef(false);
  // save() and conflict are re-created every render; the timer and the
  // close handler reach the current ones through these refs (same pattern
  // as `latest` and `handlers`).
  const saveRef = React.useRef(save);
  const conflictRef = React.useRef(conflict);
  React.useEffect(() => {
    saveRef.current = save;
    conflictRef.current = conflict;
  });

  const clearAutosaveTimer = () => {
    if (autosaveTimer.current !== null) {
      clearTimeout(autosaveTimer.current);
      autosaveTimer.current = null;
    }
  };
  const armAutosaveTimer = () => {
    clearAutosaveTimer();
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      void attemptAutosave();
    }, AUTOSAVE_DEBOUNCE_MS);
  };
  // The window unmounts with the timer cleared, never firing into a dead
  // window.
  React.useEffect(() => clearAutosaveTimer, []);

  /** True when save() would open the format prompt for a Prism-origin
   *  project with no remembered choice — autosave must never prompt, so
   *  that cycle is skipped and the manual Save asks instead. */
  const autosaveWouldPrompt = () =>
    nextSaveAction({
      prismOrigin: prismOrigin.current,
      prompted: prompted.current,
      remembered: loadPrismSaveChoice(),
    }) === "prompt";

  /** One autosave attempt through the existing save(). Returns whether the
   *  save succeeded. While a save is already in flight (manual or auto),
   *  no second one starts; the attempt is deferred once, and re-armed
   *  after the flight ends only if that save succeeded and the project is
   *  still dirty — a failed save waits for the next edit. */
  const attemptAutosave = async (): Promise<boolean> => {
    if (!isAutosaveEnabled()) return false;
    if (autosaveInFlight.current) {
      autosaveRearmPending.current = true;
      return false;
    }
    const s = latest.current;
    if (!s.isDirty) return false;
    if (!s.filePath && !remoteRef.current) return false;
    if (conflictRef.current) return false;
    if (autosaveWouldPrompt()) return false;
    autosaveInFlight.current = true;
    let ok = false;
    try {
      // Silent: a background save never pops the .prism write-report dialog.
      ok = await saveRef.current(false, { silent: true });
    } finally {
      autosaveInFlight.current = false;
      if (autosaveRearmPending.current) {
        autosaveRearmPending.current = false;
        if (ok && latest.current.isDirty) armAutosaveTimer();
      }
    }
    return ok;
  };

  // Debounce: every edit restarts the 10 s timer (revision bumps on every
  // mutating action); a clean project, a disabled toggle, an untitled
  // project, or a pending conflict clears it instead. A failed save leaves
  // the project dirty but does not re-arm here — the next edit does.
  React.useEffect(() => {
    if (!isDirty) {
      clearAutosaveTimer();
      return;
    }
    if (!isAutosaveEnabled()) return;
    if (!filePath && !remote) return;
    if (conflict) return;
    armAutosaveTimer();
    return clearAutosaveTimer;
  }, [isDirty, revision, filePath, remote, conflict]);

  // Save on sheet switch: the switch already happened in the store (a pure
  // activeNodeId change — no isDirty, no revision bump), so the save below
  // writes the project with the new sheet active, and a failed save can
  // never block or undo the switch. The pending debounce timer is cleared
  // first, so a failed switch-save doesn't retry until the next edit.
  const prevActiveNodeId = React.useRef<string | null>(null);
  const activeNodeSeen = React.useRef(false);
  React.useEffect(() => {
    const id = store.activeNodeId;
    if (!activeNodeSeen.current) {
      activeNodeSeen.current = true;
      prevActiveNodeId.current = id;
      return;
    }
    if (id === prevActiveNodeId.current) return;
    prevActiveNodeId.current = id;
    clearAutosaveTimer();
    void attemptAutosave();
    // Backup on sheet switch too (Prism's second trigger) — defined just
    // below; the effect runs after render, so the closure is live by then.
    if (isBackupOnSheetSwitch()) void attemptBackup();
  }, [store.activeNodeId]);

  // ── Automatic backup (Plane seq 226) ───────────────────────────────────
  // Prism's automatic backup, not 1.7.3's autosave: a SEPARATE `.hlx`
  // snapshot in Titer's data folder, so a crash leaves something to come
  // back to — including untitled work, which autosave never touches. Written
  // on a timer (default every 10 minutes, while the project is dirty) and
  // on sheet switch, and rewritten on every save so a backup is never older
  // than the project file; deleted when the project is saved and closed
  // normally. The next launch offers to restore a backup that is newer than
  // the saved file. A backup never interrupts work: a failure is swallowed
  // silently (no prompt, no alert), and the next cycle tries again.
  //
  // The timer is NOT a debounce: it fires every interval while the project
  // stays dirty, even while the user keeps editing — edits must not keep
  // postponing the backup. So the effect below arms once, when the project
  // turns dirty, and the fire handler re-arms itself while still dirty.
  const backupTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const backupInFlight = React.useRef(false);
  const backupFlight = React.useRef<Promise<boolean> | null>(null);
  const lastBackupRevision = React.useRef(-1);
  const backupClosing = React.useRef(false);
  const backupArmed = React.useRef(false);
  // What this window's backup belongs to, refreshed after every render so
  // the timer and the close handler — which run long after the render that
  // set them — always read the current project, not a stale closure.
  const backupTargetRef = React.useRef<{ identity: string; displayName: string; sourcePath: string | null }>({
    identity: "",
    displayName: "",
    sourcePath: null,
  });
  const currentBackupTarget = (): { identity: string; displayName: string; sourcePath: string | null } => {
    if (filePath) {
      return { identity: backupIdentity({ filePath }), displayName: backupDisplayName({ filePath }), sourcePath: filePath };
    }
    if (remote) {
      return { identity: backupIdentity({ remote }), displayName: backupDisplayName({ remote }), sourcePath: null };
    }
    const id = untitledBackupId(native.windowLabel() ?? "web");
    return {
      identity: backupIdentity({ untitledId: id }),
      displayName: backupDisplayName({ untitledId: id, untitledName: untitled }),
      sourcePath: null,
    };
  };
  const backupTarget = React.useMemo(currentBackupTarget, [filePath, remote, untitled]);
  const backupId = backupTarget.identity;
  React.useEffect(() => {
    backupTargetRef.current = backupTarget;
  });
  const clearBackupTimer = () => {
    if (backupTimer.current !== null) {
      clearTimeout(backupTimer.current);
      backupTimer.current = null;
    }
    backupArmed.current = false;
  };
  const armBackupTimer = () => {
    clearBackupTimer();
    backupArmed.current = true;
    backupTimer.current = setTimeout(() => {
      backupTimer.current = null;
      void attemptBackup().then(() => {
        // Re-arm while still dirty: the timer is the only writer while the
        // user keeps editing without switching sheets. A clean project, a
        // disabled toggle, or a closing window stops the cycle; the next
        // edit re-arms it through the effect below.
        if (latest.current.isDirty && isBackupEnabled() && !backupClosing.current) armBackupTimer();
        else backupArmed.current = false;
      });
    }, backupIntervalMinutes() * 60_000);
  };
  // The window unmounts with the timer cleared, never firing into a dead
  // window.
  React.useEffect(() => clearBackupTimer, []);

  /** One backup snapshot of the current project, unconditionally: the
   *  callers decide when. Serializes exactly what a save would write (the
   *  `.hlx` bytes), so the backup loads back through the normal reader.
   *  `target` overrides the window's current backup target — a save that
   *  just moved the project (Save As) passes its new path, since the ref
   *  still holds the old one until the next render. Returns whether the
   *  snapshot landed, and records the revision it holds, so the timer
   *  knows the project is covered until the next edit. */
  const writeBackupSnapshot = async (
    target: { identity: string; displayName: string; sourcePath: string | null } = backupTargetRef.current,
  ): Promise<boolean> => {
    if (!native.isNative) return false;
    if (!target.identity) return false;
    const s = latest.current.get();
    const revision = s.revision;
    try {
      const base64 = bytesToBase64(new TextEncoder().encode(serializeProjectFile(s)));
      await native.backupWrite(target.identity, target.displayName, target.sourcePath, base64);
      lastBackupRevision.current = revision;
      return true;
    } catch {
      return false;
    }
  };

  /** One backup attempt: only when backup is on, the project is dirty, and
   *  no snapshot has covered this revision yet. While a snapshot is already
   *  in flight, no second one starts — the timer's re-arm retries on the
   *  next cycle. A remote conflict pending skips the cycle entirely, like
   *  autosave: a backup must never race a conflict resolution. */
  const attemptBackup = async (): Promise<boolean> => {
    if (!native.isNative) return false;
    if (!isBackupEnabled()) return false;
    if (backupClosing.current) return false;
    if (backupInFlight.current) return false;
    const s = latest.current;
    if (!s.isDirty) return false;
    if (s.revision === lastBackupRevision.current) return false;
    if (conflictRef.current) return false;
    backupInFlight.current = true;
    const flight = (async () => {
      try {
        return await writeBackupSnapshot();
      } finally {
        backupInFlight.current = false;
      }
    })();
    backupFlight.current = flight;
    return flight;
  };

  // Arm once when the project turns dirty; a clean project, a disabled
  // toggle, or a pending conflict clears the timer instead. (The toggle and
  // the interval are read when arming — a change in Settings takes effect
  // on the next edit, not mid-cycle.)
  React.useEffect(() => {
    if (!isDirty) {
      clearBackupTimer();
      return;
    }
    if (!native.isNative) return;
    if (!isBackupEnabled()) return;
    if (conflict) return;
    if (backupArmed.current) return;
    armBackupTimer();
  }, [isDirty, filePath, remote, conflict]);

  /** Deletes the backup for `identity` (Prism: deleted when the original is
   *  saved and closed). A snapshot in flight owns the file: it lands first,
   *  or the delete would race it and leave a stale backup behind. Missing
   *  is fine — a project that never backed up deletes nothing — and a
   *  failure never blocks the caller: the 4-day prune cleans it up. */
  const deleteBackupFor = async (identity: string): Promise<void> => {
    if (!native.isNative) return;
    try {
      await backupFlight.current?.catch(() => undefined);
      const entry = await native.backupStatus(identity);
      if (entry) await native.backupDelete(entry.key);
    } catch {
      // Ignore: see above.
    }
  };

  /** Deletes this window's backup. */
  const deleteCurrentBackup = async (): Promise<void> =>
    deleteBackupFor(backupTargetRef.current.identity);

  // ── Crash recovery ─────────────────────────────────────────────────────
  // After a crash the backup remains, and the next launch offers to restore
  // it — but only once this window knows what project it holds. A window
  // that is still waiting for its opening (a session restore lands a moment
  // after mount) must not offer a stale untitled backup for a file that is
  // about to load over it, so the check waits for the opening to settle:
  // `applyProjectText` sets it once the project is in the store, and a
  // window with no opening (a blank window) settles after a grace second.
  // One check per project identity.
  const [openingSettled, setOpeningSettled] = React.useState(false);
  React.useEffect(() => {
    const timer = setTimeout(() => setOpeningSettled(true), 1000);
    return () => clearTimeout(timer);
  }, []);
  const [backupRecovery, setBackupRecovery] = React.useState<{
    identity: string;
    entry: native.BackupEntry;
  } | null>(null);
  const recoveryChecked = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!native.isNative) return;
    if (!openingSettled) return;
    if (recoveryChecked.current.has(backupId)) return;
    recoveryChecked.current.add(backupId);
    void (async () => {
      let entry: native.BackupEntry | null = null;
      try {
        entry = await native.backupStatus(backupId);
      } catch {
        return;
      }
      if (!entry) return;
      // The project may have moved on while the check ran: only offer for
      // the identity this window still holds.
      if (backupTargetRef.current.identity !== backupId) return;
      if (!backupIsNewerThanSource(entry.saved_at_ms, entry.source_mtime_ms)) {
        // Stale: the saved file is newer than the backup — drop it
        // silently. Restoring it would regress the file.
        try {
          await native.backupDelete(entry.key);
        } catch {
          // Ignore: the 4-day prune cleans it up.
        }
        return;
      }
      // The offer is a plain overlay (seq 397), not a top-layer <dialog> —
      // a Welcome dialog open over it would hide it, so the offer closes
      // Welcome first. A file window never auto-shows Welcome, but the
      // 500 ms auto-show can race a slow CLI/MCP opening and leave it open.
      setWelcomeOpen(false);
      setBackupRecovery({ identity: backupId, entry });
    })();
  }, [backupId, openingSettled]);

  /** The recovery dialog's answer. Restore loads the backup's bytes as
   *  this window's project — pointed at its file (or untitled), edited, so
   *  saving writes it back — then deletes the backup: it is the live
   *  project now, and the next cycle backs it up again. Discard deletes
   *  the backup and keeps the current file. Keep dismisses the offer and
   *  leaves the backup on disk (offered again on the next launch, or
   *  pruned after 4 days). Restoring over unsaved work asks first, like
   *  any other discard. */
  const resolveBackupRecovery = async (choice: "restore" | "discard" | "keep"): Promise<void> => {
    const found = backupRecovery;
    if (!found) return;
    if (choice === "restore" && !(await confirmDiscard())) return;
    setBackupRecovery(null);
    if (choice !== "restore") {
      if (choice === "discard") {
        try {
          await native.backupDelete(found.entry.key);
        } catch {
          // Ignore: the 4-day prune cleans it up.
        }
      }
      return;
    }
    // The user may have saved while deciding (the discard prompt's Save
    // option): re-check that the backup is still newer than the file, or
    // restoring would regress it. A backup that stopped being newer is
    // dropped — the file now holds the state.
    let fresh: native.BackupEntry | null = null;
    try {
      fresh = await native.backupStatus(found.identity);
    } catch {
      // Ignore: a backup that can't be re-checked is restored as offered.
    }
    if (fresh && !backupIsNewerThanSource(fresh.saved_at_ms, fresh.source_mtime_ms)) {
      try {
        await native.backupDelete(fresh.key);
      } catch {
        // Ignore: the 4-day prune cleans it up.
      }
      return;
    }
    let text: string;
    try {
      text = new TextDecoder().decode(base64ToBytes(await native.backupRead(found.entry.key)));
    } catch {
      // Unreadable: the backup is useless — drop it rather than offering
      // a broken file on every launch.
      try {
        await native.backupDelete(found.entry.key);
      } catch {
        // Ignore: the 4-day prune cleans it up.
      }
      return;
    }
    const restored = await applyProjectText(
      text,
      {
        filePath: found.entry.source_path,
        untitled: !found.entry.source_path,
        displayName: found.entry.display_name,
        forceEdited: true,
      },
      () => {
        if (found.entry.source_path) addRecent({ kind: "local", path: found.entry.source_path });
      },
    );
    if (restored) {
      try {
        await native.backupDelete(found.entry.key);
      } catch {
        // Ignore: the 4-day prune cleans it up.
      }
    } else {
      // The bytes don't parse as a project: the backup is corrupt — drop
      // it rather than offering it again on the next launch.
      try {
        await native.backupDelete(found.entry.key);
      } catch {
        // Ignore: the 4-day prune cleans it up.
      }
    }
  };

  /** File ▸ Save As Template / Example / Method (plan 38): writes the current
   *  project JSON + a `template` envelope block to a `.pzt`/`.pzm` path from
   *  the native save panel (a download in the web build). The current project
   *  keeps its own path and dirty state — saving a template never moves the
   *  project, exactly as Prism's Save Special doesn't. */
  const saveTemplate = async (kind: TemplateKind, info: TemplateInfo): Promise<void> => {
    const s = latest.current.get();
    const ext = kind === "method" ? METHOD_FILE_EXTENSION : TEMPLATE_FILE_EXTENSION;
    const label = kind === "method" ? "Method" : kind === "example" ? "Example" : "Template";
    const text = serializeProjectFile({ ...s, template: info });
    if (native.isNative) {
      const target = await native.pickSavePath(
        `Save As ${label}`,
        `${title}.${ext}`,
        `Titer ${label}`,
        ext,
      );
      if (!target) return;
      try {
        await native.writeFile(target, text);
      } catch (err) {
        await native.alert(
          "Couldn't Save Template",
          `“${fileName(target)}” couldn't be saved there (${err}). Try another folder.`,
          "error",
        );
      }
      return;
    }
    // Web build (no native shell): download a `.pzt`/`.pzm` file.
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };


  /** True when it's fine to discard the project (saved, or the user said so).
   *  One prompt per window: a second close request while one is already
   *  asking (⌘Q twice, ⌘W during a quit) awaits the same answer instead of
   *  opening a second native dialog on a window that already has one
   *  (bugfix/quit-save-dialog). */
  const confirmDiscardInFlight = React.useRef<Promise<boolean> | null>(null);
  const confirmDiscard = async (): Promise<boolean> => {
    // An MCP close already settled the save question (v1.6.0 L2): the next
    // close request goes through without asking. One-shot, and it expires
    // on its own — see `mcp-document.ts`.
    if (consumeMcpCloseAllowance()) return true;
    if (confirmDiscardInFlight.current) return confirmDiscardInFlight.current;
    const asked = (async () => {
      if (!latest.current.isDirty) return true;
      const answer = await native.askToSave();
      return answer === "save" ? save() : answer === "discard";
    })();
    confirmDiscardInFlight.current = asked;
    try {
      return await asked;
    } finally {
      confirmDiscardInFlight.current = null;
    }
  };

  // Quit-save settle (Plane seq 281): the transpose race. An analysis whose
  // results are still computing when the quit-save snapshots the project
  // lands through `cacheAnalysisResult`, which bumps `revision` and sets
  // `isDirty` (use-project-store.tsx) — and `cachedResult` is file content,
  // so the file the quit-save just wrote is genuinely stale and the
  // discard prompt fires, even though the user only just watched the app
  // save. Waiting alone cannot fix that: nothing clears `isDirty` except
  // `markProjectSaved`, so a result that landed after the snapshot leaves
  // the project dirty after any wait. The settle below therefore ends in
  // one follow-up save, not just a re-check: settle, save once more if
  // still dirty, then let the prompt decide. One extra save, never a loop.
  const QUIT_SAVE_SETTLE_MS = 2000;
  const QUIT_SAVE_QUIET_MS = 250;
  const QUIT_SAVE_POLL_MS = 50;
  const quitSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  /** Wait until the store has gone quiet — no `revision` change for
   *  `QUIT_SAVE_QUIET_MS` — or the bound runs out. Revision bumps on
   *  every mutating action, including a landing analysis result, so a
   *  quiet revision means nothing landed recently; chained recomputes
   *  keep resetting the quiet clock until the bound caps the wait. */
  const waitForQuitSettle = async (): Promise<void> => {
    const startedAt = Date.now();
    let lastRevision = latest.current.revision;
    let lastChangeAt = startedAt;
    while (Date.now() - startedAt < QUIT_SAVE_SETTLE_MS) {
      await quitSleep(QUIT_SAVE_POLL_MS);
      if (latest.current.revision !== lastRevision) {
        lastRevision = latest.current.revision;
        lastChangeAt = Date.now();
      } else if (Date.now() - lastChangeAt >= QUIT_SAVE_QUIET_MS) {
        return;
      }
    }
  };

  /** Run the project's saved scripts for a hook (seq 228): on open, after
   *  the project loads; on close, before the save question. Each script runs
   *  through the same engine + effects as the dialog's Run, in the order the
   *  scripts are saved; a run that stops on an error changes nothing for
   *  that script (its log is reported) and the later scripts still run.
   *  Returns false when any script stopped, so the caller can say so — for
   *  a close, the window stays open. */
  const runSavedScripts = async (
    scripts: ProjectScript[] | undefined,
    hook: "runOnOpen" | "runOnClose",
    doc: ScriptDoc,
  ): Promise<boolean> => {
    const due = (scripts ?? []).filter((s) => s[hook]);
    if (!due.length) return true;
    let current = doc;
    let ok = true;
    for (const entry of due) {
      const result = await runProjectScriptText(current, entry.text, () => void saveRef.current());
      if (result.stopped) {
        ok = false;
        await native.alert(
          `Script “${entry.name}” Stopped`,
          [`The ${hook === "runOnOpen" ? "run-on-open" : "run-on-close"} script stopped before it finished:`, ...result.log].join("\n"),
          "error",
        );
        continue;
      }
      if (JSON.stringify(result.doc) !== JSON.stringify(current)) latest.current.applyScript(result.doc);
      current = result.doc;
    }
    return ok;
  };

  /** Close with autosave: one save attempt first (only when the toggle is
   *  on, the project is dirty, and it has a target), then the existing
   *  discard prompt — which only appears if the project is still dirty
   *  afterwards, so a successful autosave closes silently. After a
   *  successful quit-save the store is given a bounded moment to settle
   *  (an analysis result landing just after the snapshot re-dirties the
   *  project); if it did, one more save writes it, and only if the
   *  project is STILL dirty after that does the prompt decide. A failing
   *  save skips the settle and the second attempt — it already alerted,
   *  and the prompt decides, exactly as before. Two close requests at
   *  once share the one attempt, like confirmDiscard itself. */
  const quitSaveInFlight = React.useRef<Promise<boolean> | null>(null);
  const confirmDiscardWithAutosave = async (): Promise<boolean> => {
    if (quitSaveInFlight.current) return quitSaveInFlight.current;
    const asked = (async () => {
      // Seq 228: the run-on-close scripts run first, so their changes are
      // in the project the quit-save then writes. A script that stops
      // calls the close off — the window stays open, with the log shown.
      const state = latest.current.get();
      const closed = await runSavedScripts(state.scripts, "runOnClose", {
        nodes: state.nodes,
        rootOrder: state.rootOrder,
        childOrder: state.childOrder,
        activeNodeId: state.activeNodeId,
        projectName: state.projectName,
      });
      if (!closed) return false;
      const quitSaveAllowed = () =>
        isAutosaveEnabled() &&
        latest.current.isDirty &&
        (latest.current.filePath || remoteRef.current) &&
        !conflictRef.current &&
        !autosaveWouldPrompt();
      if (quitSaveAllowed()) {
        // Silent, like autosave: the quit-save writes the file, and the
        // report dialog must not hold the window open.
        const saved = await saveRef.current(false, { silent: true });
        if (saved) {
          await waitForQuitSettle();
          if (quitSaveAllowed()) {
            await saveRef.current(false, { silent: true });
          }
        }
      }
      const allowed = await confirmDiscard();
      if (allowed) {
        // A clean close: Prism deletes the backup when the original is
        // saved and closed. Stop the timer first, so no snapshot can land
        // after the delete.
        backupClosing.current = true;
        clearBackupTimer();
        await deleteCurrentBackup();
      }
      return allowed;
    })();
    quitSaveInFlight.current = asked;
    try {
      return await asked;
    } finally {
      quitSaveInFlight.current = null;
    }
  };

  /** Parses `.hlx` text and loads it as the window's project. `filePath` is
   *  the local path (null for remote/untitled); `afterLoad` runs once the
   *  project is in the store (recents, the remote handle). Returns false
   *  when the text isn't a readable project. Shared by local `load` and
   *  remote `loadRemote`, so both report the same issues the same way. */
  const applyProjectText = async (
    text: string,
    target: { filePath: string | null; untitled: boolean; displayName: string; forceEdited?: boolean },
    afterLoad: () => void,
  ): Promise<boolean> => {
    try {
      // A fresh attempt clears the last opening's outcome first, so a
      // window that failed once doesn't report the stale failure for the
      // next file (and the MCP server never sees it for a file that loads).
      latest.current.setOpenError(null);
      // Read from the text, not `JSON.parse` + `parseProjectFile`: a duplicated
      // node id is last-wins in `JSON.parse`, so the text-level read (FF-F19)
      // is what keeps the later copy instead of dropping it silently.
      const parsed = parseProjectText(text);
      if ("error" in parsed) {
        // The MCP server reads this from the snapshot: the same message the
        // GUI shows, so `titer_open_project` errors instead of reporting
        // the blank project this window falls back to as a success.
        latest.current.setOpenError(parsed.error);
        // Publish at once, before the alert: the debounced publisher does
        // not fire for this change alone (it fires on the next content
        // change), so without this the server would wait out its 15 s and
        // report a timeout instead of the failure. The override carries
        // the failure even though the store hasn't re-rendered yet.
        await publishMcpSnapshotNow({ ...latest.current.get(), openError: parsed.error });
        report();
        await native.alert("Couldn't Open Project", parsed.error, "error");
        return false;
      }
      // A file changed as it was read (repaired, or from an older Titer) opens edited: saving
      // it keeps the project as it is now. The sample stays untitled, never to be saved.
      // `forceEdited` is the backup restore: the restored content differs
      // from the saved file by construction, so it opens edited even though
      // the text itself parses cleanly.
      const edited = (parsed.updated && !target.untitled) || target.forceEdited === true;
      prismOrigin.current = false;
      prompted.current = false;
      latest.current.loadProject({ ...parsed.project, filePath: target.filePath, edited });
      // The window knows its project now: the recovery check may run for
      // it. Set here, not in `load` — the check must wait until the file
      // is actually in the store, or it would offer a stale untitled
      // backup for a file that is about to load over it.
      setOpeningSettled(true);
      if (target.untitled) setUntitled(fileTitle(target.displayName));
      afterLoad();
      // Seq 228: the run-on-open scripts run once the project is in the
      // store — built from the parsed file, not the store's ref, which the
      // load dispatch hasn't re-rendered yet. A script that stops reports
      // its log; the project still opens.
      await runSavedScripts(parsed.project.scripts, "runOnOpen", {
        nodes: parsed.project.nodes,
        rootOrder: parsed.project.rootOrder,
        childOrder: parsed.project.childOrder,
        activeNodeId: parsed.project.activeNodeId,
        projectName: parsed.project.projectName,
      });
      // Linked paste (seq 168): a local project's auto-updating links
      // re-read their sources now that the project is in the store — a
      // source that can't be read is named in the Linked Data notice.
      if (target.filePath) {
        const linkedLines = await checkLinkedData(parsed.project.nodes);
        if (linkedLines.length) setLinkedNotice(linkedLines);
      }
      // A template that carries instructions (or a description) says so on
      // open (plan 38); any other file clears a stale notice.
      const info = parsed.project.template;
      setTemplateNotice(info && (info.instructions || info.description) ? info : null);
      // The project is loaded; still tell the user what in it couldn't be read as is.
      const { issues } = parsed;
      const save = edited ? "Save the project to keep it as it is now." : "";
      if (issues.length > 0) {
        const shown = issues.slice(0, 12).map((i) => `• ${i.message}`);
        if (issues.length > 12) shown.push(`…and ${issues.length - 12} more.`);
        if (save) shown.push("", save);
        await native.alert(`Opened with ${issues.length} Issue${issues.length === 1 ? "" : "s"}`, shown.join("\n"));
      } else if (edited) {
        // In-app, not native.alert: the native dialog's window lingered on macOS
        // after dismissal, blocking clicks and quitting (Quirk 2).
        setProjectUpdated(true);
      }
      return true;
    } catch {
      // A truncated file dies in `JSON.parse` before `parseProjectText`
      // can report it — the same failure, the same snapshot signal.
      latest.current.setOpenError("This file is damaged or isn't a valid Titer project.");
      // Publish at once, before the alert (see the error path above):
      // without this the server times out instead of seeing the failure.
      await publishMcpSnapshotNow({
        ...latest.current.get(),
        openError: "This file is damaged or isn't a valid Titer project.",
      });
      report();
      await native.alert("Couldn't Open Project", "This file is damaged or isn't a valid Titer project.", "error");
      return false;
    }
  };

  /** Opens a project file in this window; `untitled`, as a new document named after it. */
  const load = async (path: string, untitled: boolean) => {
    // A file is coming into this window — the Welcome dialog never auto-shows here.
    openedFile.current = true;
    let text: string;
    try {
      text = await native.readText(path);
    } catch (err) {
      report();
      // Only a file that is really gone leaves Open Recent (FF-F11): a file
      // that exists but can't be read — wrong encoding, no permission — stays,
      // and says what happened instead of "couldn't be found".
      if (isGoneReadError(err)) {
        latest.current.setOpenError(`“${fileName(path)}” couldn't be found. It may have been moved or deleted.`);
        // Publish the failure at once, before the alert (see applyProjectText).
        await publishMcpSnapshotNow({
          ...latest.current.get(),
          openError: `“${fileName(path)}” couldn't be found. It may have been moved or deleted.`,
        });
        setRecents((list) => list.filter((e) => !(e.kind === "local" && e.path === path)));
        return sayGone(path);
      }
      // A Prism file opened straight from the Finder (FF-F15): Titer can't
      // open it as a project — point at the import / converter instead.
      if (isPrismFile(path)) {
        latest.current.setOpenError(prismFileOpenMessage(fileName(path)));
        await publishMcpSnapshotNow({ ...latest.current.get(), openError: prismFileOpenMessage(fileName(path)) });
        return native.alert("Couldn't Open Project", prismFileOpenMessage(fileName(path)), "error");
      }
      latest.current.setOpenError(
        `“${fileName(path)}” couldn't be read. It may be damaged, or in an encoding Titer can't read.`,
      );
      await publishMcpSnapshotNow({
        ...latest.current.get(),
        openError: `“${fileName(path)}” couldn't be read. It may be damaged, or in an encoding Titer can't read.`,
      });
      return native.alert(
        "Couldn't Open Project",
        `“${fileName(path)}” couldn't be read. It may be damaged, or in an encoding Titer can't read. It stays in Open Recent.`,
        "error",
      );
    }
    // The baseline for Revert's external-change check (seq 306): the text
    // on disk as this window read it. Untitled (the sample) has no file to
    // compare against. Set even when the parse below fails — the file on
    // disk is still this text, and a failed open leaves the project as is.
    if (!untitled) lastSavedTextRef.current = text;
    setRemote(null);
    await applyProjectText(
      text,
      { filePath: untitled ? null : path, untitled, displayName: path },
      () => {
        if (!untitled) addRecent({ kind: "local", path });
      },
    );
  };

  /** File ▸ Revert to Saved (seq 306, Prism menus B11): discard the unsaved
   *  changes and take the last saved version. The confirm comes first —
   *  Cancel keeps the edits. The reload itself is the existing reload path
   *  (`load` / `loadRemote`), so a file that vanished or can't be read is
   *  reported exactly as an open would be, and the edits stay put. A file
   *  another program rewrote since this window opened or saved it gets the
   *  conflict wording instead of the plain confirm: the version on disk is
   *  no longer the last saved version, and the dialog must not claim it is.
   *  A revert that lands rewrites the backup snapshot, like a save does —
   *  otherwise the snapshot of the discarded edits would be offered back
   *  on the next launch. A pending remote conflict blocks the command: the
   *  conflict dialog owns those edits until it is resolved. The file path
   *  never moves. Disabled (by the menu) when clean, untitled, or saved as
   *  `.prism` / `.pzfx` — the guards here are belt and braces. */
  const revertToSaved = async (): Promise<void> => {
    const s = latest.current;
    const path = s.filePath;
    const handle = remoteRef.current;
    if (!s.isDirty) return;
    if (!path && !handle) return;
    if (path && !isReloadableProjectPath(path)) return;
    if (conflictRef.current) return;
    // Read the disk text first, for the external-change check. A read that
    // fails is not reported here — `load` below reports it, as an open
    // would, and the revert simply doesn't happen.
    let diskText: string | null = null;
    if (path) {
      try {
        diskText = await native.readText(path);
      } catch {
        diskText = null;
      }
    }
    const name = path ? fileName(path) : handle ? fileName(handle.path) : untitled;
    const externallyChanged = path !== null && diskChangedExternally(diskText, lastSavedTextRef.current);
    const confirmed = externallyChanged
      ? await native.confirmRevert(revertExternalChangeTitle(name), revertExternalChangeDetail(name))
      : await native.confirmRevert(REVERT_CONFIRM_TITLE, REVERT_CONFIRM_DETAIL);
    if (!confirmed) return;
    if (path) await load(path, false);
    else if (handle) await loadRemote(handle);
    // A failed open leaves the store untouched (still dirty, same path):
    // only a revert that actually landed refreshes the baseline and the
    // backup, so a stale snapshot of the discarded edits is never offered
    // back. A snapshot still in flight owns the file first, like the close
    // path's delete does.
    const after = latest.current;
    if (!after.isDirty && after.filePath === path) {
      if (diskText !== null) lastSavedTextRef.current = diskText;
      try {
        await backupFlight.current?.catch(() => undefined);
      } catch {
        // Ignore: the backup is best-effort, never a revert failure.
      }
      void writeBackupSnapshot();
    }
  };

  /** Loads an already-parsed Prism import (`.pzfx` or `.pzf` — same report
   *  shape) as a new untitled project, and shows the transfer report in-app.
   *  Returns true when the project loaded, so a local import knows to drop
   *  the remote handle. */
  const loadImportedProject = async (imported: PzfxImport, name: string): Promise<boolean> => {
    if (imported.tables.length === 0) {
      report();
      await native.alert(
        "Couldn't Import File",
        imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.",
        "error",
      );
      return false;
    }
    if (!(await confirmDiscard())) return false;
    prismOrigin.current = true;
    prompted.current = false;
    latest.current.loadProject({ ...imported.project, filePath: null, edited: true });
    setUntitled(name);
    // The .pzfx heuristic plans (one per imported table, rules H1–H6) —
    // recorded before the report, so the dialog's button can see them.
    const plans = planPzfxGraphs(imported);
    imported.graphPlans = plans;
    recordRegenPlans(plans);
    const lines = [
      `Imported ${imported.tables.length} table${imported.tables.length === 1 ? "" : "s"} from “${name}”:`,
      ...imported.tables.map((t) => `• ${t}`),
      ...(imported.infoSheets.length
        ? [
            `Imported ${imported.infoSheets.length} info sheet${imported.infoSheets.length === 1 ? "" : "s"}:`,
            ...imported.infoSheets.map((t) => `• ${t}`),
          ]
        : []),
    ];
    if (imported.issues.length > 0) {
      lines.push("", "Notes:", ...imported.issues.slice(0, 12).map((i) => `• ${i.message}`));
      if (imported.issues.length > 12) lines.push(`…and ${imported.issues.length - 12} more.`);
    }
    if (plans.some((p) => p.reconstructible)) {
      lines.push(
        "",
        "Graphs weren't in this file — “Regenerate graphs…” can rebuild one per imported table (guessed from the table — Prism's graph type isn't in the file).",
      );
    }
    // In-app, not native.alert: the native alert's OK button could not dismiss
    // it on macOS (v1.6.0 Mac proof) — see the `prismImported` state above.
    setPrismImported([...lines, "", "Save the project to keep it as a Titer project."]);
    return true;
  };

  /** Imports a Prism `.pzfx` file as a new untitled project (File ▸ Import Prism File…,
   *  or a dropped file). Analyses and graphs aren't in the file — only its data tables —
   *  so the imported project opens edited: saving keeps it as a Titer project. */
  const importPrismText = async (text: string, name: string): Promise<boolean> =>
    loadImportedProject(parsePzfx(text), name);

  /** Imports a Prism `.pzf` file (the legacy binary format Prism 4/5 wrote)
   *  as a new untitled project — same report shape as `.pzfx`. Tables import
   *  as Column (the format records no table type); analyses, graphs and
   *  layouts don't come across, and the report says so. */
  const importPzfBytes = async (data: Uint8Array, name: string): Promise<boolean> =>
    loadImportedProject(parsePzf(data), name);

  const importPrismFile = async (path: string) => {
    if (path.toLowerCase().endsWith(".prism")) {
      let bytes: Uint8Array;
      try {
        bytes = await native.readPrismBytes(path);
      } catch {
        report();
        return native.alert("Couldn't Import File", `“${fileName(path)}” couldn't be read.`, "error");
      }
      // A local import starts an untitled local project: the remote handle
      // goes, even if the window held a remote file.
      if (await importPrismBytes(bytes, fileTitle(path))) setRemote(null);
      return;
    }
    if (path.toLowerCase().endsWith(".pzf")) {
      let bytes: Uint8Array;
      try {
        bytes = await native.readPrismBytes(path);
      } catch {
        report();
        return native.alert("Couldn't Import File", `“${fileName(path)}” couldn't be read.`, "error");
      }
      if (await importPzfBytes(bytes, fileTitle(path))) setRemote(null);
      return;
    }
    let text: string;
    try {
      text = await native.readPrismText(path);
    } catch {
      report();
      return native.alert("Couldn't Import File", `“${fileName(path)}” couldn't be read.`, "error");
    }
    if (await importPrismText(text, fileTitle(path))) setRemote(null);
  };

  /** Imports a Prism `.prism` file (Prism 10's ZIP format) as a new untitled
   *  project. Tables and the analyses Titer offers come across; graphs and
   *  layouts don't — Prism stores them in a binary format it doesn't
   *  document — and fitted results aren't carried: Titer recomputes every
   *  analysis from the table when the file opens. The transfer report says
   *  exactly what came across and what didn't, in plain language. Returns
   *  true when the project loaded (false when the user cancelled or the
   *  file couldn't convert), so a remote open knows whether to keep its
   *  handle. */
  const importPrismBytes = async (data: Uint8Array, name: string): Promise<boolean> => {
    let converted;
    try {
      // One unzip for the import and the regen planning: the planner
      // shares this JSZip instance (never unzips twice).
      const zip = await loadPrismZip(data, name);
      converted = await convertPrism(data, name, zip);
      converted.graphPlans = await planGraphRegeneration(zip, converted);
    } catch (err) {
      report();
      await native.alert(
        "Couldn't Import File",
        err instanceof Error ? err.message : "This file couldn't be imported.",
        "error",
      );
      return false;
    }
    if (!(await confirmDiscard())) return false;
    prismOrigin.current = true;
    prompted.current = false;
    latest.current.loadProject({ ...converted.project, filePath: null, edited: true });
    setUntitled(name);
    // The sidecar plans — recorded before the report, so the dialog's
    // button can see them and `formatReport` can point at them.
    const plans = converted.graphPlans ?? [];
    recordRegenPlans(plans);
    converted.report.regenerableGraphs = regenPlanCounts(plans).regenerable;
    // In-app, not native.alert: the native alert's OK button could not dismiss
    // it on macOS (v1.6.0 Mac proof) — see the `prismImported` state above.
    setPrismImported([
      ...formatReport(converted.report).split("\n"),
      "",
      "Save the project to keep it as a Titer project.",
    ]);
    return true;
  };

  /** File ▸ Import Prism File…: pick a Prism file (`.pzfx`, `.prism` or `.pzf`) and import it. In the web build
   *  (no native shell) the pick is a file input instead. */
  const importPrism = async () => {
    if (native.isNative) {
      // Listen first, then open the panel: the shell emits
      // "prism-file-picked" (path, or null on Cancel) when the user picks.
      // The old sync invoke blocked the main thread and deadlocked the
      // picker (Nov 9, macOS + Linux).
      const off = await native.onPrismFilePicked((path) => {
        off();
        if (path) void importPrismFile(path);
      });
      await native.choosePrismFile();
      return;
    }
    const picked = await new Promise<{ name: string; data: ArrayBuffer | string } | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pzfx,.prism,.pzf";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result as ArrayBuffer | string });
        reader.onerror = () => resolve(null);
        // A `.prism` file is a ZIP and a `.pzf` file is binary: read bytes, not text.
        if (file.name.toLowerCase().endsWith(".prism") || file.name.toLowerCase().endsWith(".pzf")) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
      };
      input.click();
    });
    if (!picked) return;
    if (typeof picked.data !== "string") {
      const bytes = new Uint8Array(picked.data);
      if (picked.name.toLowerCase().endsWith(".pzf")) {
        if (await importPzfBytes(bytes, picked.name.replace(/\.pzf$/i, ""))) setRemote(null);
      } else if (await importPrismBytes(bytes, picked.name.replace(/\.prism$/i, ""))) setRemote(null);
    } else {
      if (await importPrismText(picked.data, "Prism import")) setRemote(null);
    }
  };

  /** Appends `incoming`'s sheets to this project (File ▸ Merge, seq 180):
   *  `mergeProjects` builds the merged content — every incoming sheet
   *  renamed with Prism's asterisk, links remapped — and the store's
   *  `mergeProject` applies it as one undo step. The current project's
   *  sheets, names and active sheet are untouched. `warnings` (a Prism
   *  conversion's issues, a `.hlx` read's repairs) ride along in the
   *  notice, after the merge report. */
  const mergeProjectContent = (
    incoming: {
      nodes: Record<string, ProjectNode>;
      rootOrder: string[];
      childOrder: Record<string, string[]>;
      activeNodeId: string | null;
    },
    sourceName: string,
    warnings: string[] = [],
  ): void => {
    // A converted Prism file can come back with no sheets at all (the .hlx
    // and .pzfx readers refuse empties themselves, in `mergeProjectFile`):
    // nothing to merge is an alert, not a "Merged 0 sheets" notice.
    if (Object.keys(incoming.nodes).length === 0) {
      report();
      void native.alert("Nothing to Merge", `“${sourceName}” has no sheets to merge.`, "error");
      return;
    }
    const s = latest.current.get();
    const merged = mergeProjects(
      { nodes: s.nodes, rootOrder: s.rootOrder, childOrder: s.childOrder, activeNodeId: s.activeNodeId },
      incoming,
      sourceName,
    );
    latest.current.mergeProject({
      nodes: merged.nodes,
      rootOrder: merged.rootOrder,
      childOrder: merged.childOrder,
      activeNodeId: merged.activeNodeId,
    });
    const lines = formatMergeReport(merged.report).split("\n");
    if (warnings.length > 0) {
      lines.push("", "Notes:", ...warnings.slice(0, 12).map((w) => `• ${w}`));
      if (warnings.length > 12) lines.push(`…and ${warnings.length - 12} more.`);
    }
    // In-app, not native.alert: the native alert's OK button could not
    // dismiss it on macOS (v1.6.0 Mac proof) — see `prismImported` above.
    setProjectMerged(lines);
  };

  /** Merges the project file at `path` into this one. A `.hlx` / `.pzt`
   *  file merges as a project; a `.prism` / `.pzfx` file is converted
   *  first, then merged — the same converters File ▸ Import Prism File
   *  uses. A file that can't be read or parsed says why, and nothing
   *  merges. */
  const mergeProjectFile = async (path: string): Promise<void> => {
    // Prism's rule: the file to merge "must not be open" — merging this
    // window's own file would duplicate every sheet under an asterisk.
    const open = latest.current.get().filePath;
    if (open && sameFilePath(open, path)) {
      report();
      return native.alert(
        "Already Open",
        `“${fileName(path)}” is already open in this window — merge a file that isn't open.`,
        "error",
      );
    }
    const name = fileTitle(path);
    if (path.toLowerCase().endsWith(".prism")) {
      let bytes: Uint8Array;
      try {
        bytes = await native.readPrismBytes(path);
      } catch {
        report();
        return native.alert("Couldn't Merge File", `“${fileName(path)}” couldn't be read.`, "error");
      }
      let converted;
      try {
        converted = await convertPrism(bytes, name);
      } catch (err) {
        report();
        return native.alert(
          "Couldn't Merge File",
          err instanceof Error ? err.message : "This file couldn't be imported.",
          "error",
        );
      }
      return mergeProjectContent(converted.project, name, importWarnings(converted.report));
    }
    if (path.toLowerCase().endsWith(".pzfx")) {
      let text: string;
      try {
        text = await native.readPrismText(path);
      } catch {
        report();
        return native.alert("Couldn't Merge File", `“${fileName(path)}” couldn't be read.`, "error");
      }
      const imported = parsePzfx(text);
      if (imported.tables.length === 0) {
        report();
        return native.alert(
          "Couldn't Merge File",
          imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.",
          "error",
        );
      }
      return mergeProjectContent(imported.project, name, imported.issues.map((i) => i.message));
    }
    let text: string;
    try {
      text = await native.readText(path);
    } catch (err) {
      report();
      if (isGoneReadError(err)) return sayGone(path);
      return native.alert(
        "Couldn't Merge File",
        `“${fileName(path)}” couldn't be read. It may be damaged, or in an encoding Titer can't read.`,
        "error",
      );
    }
    let parsed;
    try {
      parsed = parseProjectText(text);
    } catch {
      report();
      return native.alert("Couldn't Merge File", "This file is damaged or isn't a valid Titer project.", "error");
    }
    if ("error" in parsed) {
      report();
      return native.alert("Couldn't Merge File", parsed.error, "error");
    }
    return mergeProjectContent(parsed.project, name, parsed.issues.map((i) => i.message));
  };

  /** File ▸ Merge…: pick a project file (`.hlx`, `.pzt`, `.prism` or
   *  `.pzfx`) and merge it into this project. In the web build (no native
   *  shell) the pick is a file input instead. */
  const mergeProject = async (): Promise<void> => {
    if (native.isNative) {
      // Listen first, then open the panel: the shell emits
      // "merge-file-picked" (path, or null on Cancel) when the user picks.
      // The old sync invoke blocked the main thread and deadlocked the
      // picker (Nov 9, macOS + Linux).
      const off = await native.onMergeFilePicked((path) => {
        off();
        if (path) void mergeProjectFile(path);
      });
      await native.chooseMergeFile();
      return;
    }
    const picked = await new Promise<{ name: string; data: ArrayBuffer | string } | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".hlx,.pzt,.prism,.pzfx";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result as ArrayBuffer | string });
        reader.onerror = () => resolve(null);
        if (file.name.toLowerCase().endsWith(".prism")) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
      };
      input.click();
    });
    if (!picked) return;
    const name = picked.name.replace(/\.(hlx|pzt|prism|pzfx)$/i, "");
    if (typeof picked.data !== "string") {
      let converted;
      try {
        converted = await convertPrism(new Uint8Array(picked.data), name);
      } catch (err) {
        return native.alert(
          "Couldn't Merge File",
          err instanceof Error ? err.message : "This file couldn't be imported.",
          "error",
        );
      }
      return mergeProjectContent(converted.project, name, importWarnings(converted.report));
    }
    if (picked.name.toLowerCase().endsWith(".pzfx")) {
      const imported = parsePzfx(picked.data);
      if (imported.tables.length === 0) {
        return native.alert(
          "Couldn't Merge File",
          imported.issues.map((i) => i.message).join("\n") || "No tables in this file could be imported.",
          "error",
        );
      }
      return mergeProjectContent(imported.project, name, imported.issues.map((i) => i.message));
    }
    let parsed;
    try {
      parsed = parseProjectText(picked.data);
    } catch {
      return native.alert("Couldn't Merge File", "This file is damaged or isn't a valid Titer project.", "error");
    }
    if ("error" in parsed) return native.alert("Couldn't Merge File", parsed.error, "error");
    return mergeProjectContent(parsed.project, name, parsed.issues.map((i) => i.message));
  };

  /** The dialog's Import button (seq 429): runs the confirmed choices over
   *  the offered file and places the result. Into the active table, the
   *  values land raw at the insertion point, as Prism does — no header
   *  interpretation, and the table is renamed when the Placement tab asked
   *  for it (the walk2 import renamed its table "import-test"). As a new
   *  table, the header reading applies and the table takes the chosen
   *  name. A link stores the source on the table either way, so Update
   *  Linked Data can refresh it. Info constants and notes go to a new
   *  info sheet linked to the table. A choices combination that leaves
   *  nothing to import says so and leaves the dialog open, so the user
   *  can loosen the filter instead of starting over. */
  const confirmImport = async (
    choices: ImportChoices,
    insertion: { r: number; c: number } | null,
  ): Promise<void> => {
    const offer = pendingImport;
    if (!offer) return;
    let computed;
    try {
      computed = computeImport(offer, choices);
    } catch (err) {
      report();
      await native.alert(
        "Couldn't Import File",
        err instanceof Error ? err.message : "This file couldn't be imported.",
        "error",
      );
      return;
    }
    const p = choices.placement;
    const tableName = resolveImportTableName(choices, offer.name, computed.rows);
    const lines: string[] = [];
    let tableId: string | null = null;
    const activeId = latest.current.activeTableId;
    const active = activeId ? latest.current.nodes[activeId] : undefined;
    const activeTable =
      activeId && active?.type === "table" && active.data && active.tableType
        ? { id: activeId, data: active.data, type: active.tableType, name: active.name }
        : undefined;

    if (p.target === "insert" && activeTable && insertion) {
      const block = computed.rows.map((row) => row.map((c) => (c === "" ? null : c)));
      const dropped = columnsBeyond(activeTable.data, insertion.c, block);
      let next = activeTable.data;
      if (choices.source.link) {
        const link: LinkedPaste = {
          sourcePath: offer.path ?? offer.name,
          sourceName: fileName(offer.name),
          kind: linkedPasteKindOf(offer.name),
          row: insertion.r,
          col: insertion.c,
          rows: block.length,
          cols: Math.max(0, ...block.map((r) => r.length)),
          autoUpdate: choices.source.autoUpdate,
        };
        next = applyLinkedBlock(next, link, block, activeTable.type).data;
      } else {
        next = writeBlock(next, insertion.r, insertion.c, block, activeTable.type);
      }
      latest.current.updateTable(activeTable.id, next, "Import");
      tableId = activeTable.id;
      if (tableName !== "") latest.current.renameNode(activeTable.id, tableName);
      lines.push(
        `Added ${computed.rows.length} row${computed.rows.length === 1 ? "" : "s"} from “${offer.name}” to “${tableName === "" ? activeTable.name : tableName}” at row ${insertion.r + 1}, column ${insertion.c <= 0 ? "A" : dataColumnLetter(insertion.c - 1)}.`,
      );
      if (dropped > 0)
        lines.push(
          `${dropped} column${dropped === 1 ? "" : "s"} didn't fit in the table. Add groups or sub-columns in the Groups panel, then import again.`,
        );
    } else {
      // A new table: the header reading applies (or the Placement tab's
      // override), and it takes the chosen name — the file name when
      // renaming is off, as an import always did.
      const header =
        p.columnTitles === "firstRow" ? true : p.columnTitles === "none" ? false : undefined;
      const table = rowsToTable(computed.rows, offer.name, header);
      const name = tableName === "" ? fileTitle(offer.name) : tableName;
      let data = table.data;
      if (choices.source.link) {
        data = {
          ...data,
          linkedPaste: {
            sourcePath: offer.path ?? offer.name,
            sourceName: fileName(offer.name),
            kind: linkedPasteKindOf(offer.name),
            row: 0,
            col: 1,
            rows: data.rows.length,
            cols: data.columns.length - 1,
            autoUpdate: choices.source.autoUpdate,
          },
        };
      }
      tableId = latest.current.createTableWithData(table.tableType, data, name);
      lines.push(
        `Imported ${computed.rows.length} row${computed.rows.length === 1 ? "" : "s"} × ${table.data.columns.length - 1} column${table.data.columns.length - 1 === 1 ? "" : "s"} from “${offer.name}” as a new table “${name}”.`,
      );
      if (offer.otherSheets.length > 0)
        lines.push(
          `Sheet “${offer.sheetName ?? "Sheet1"}” was imported; ${offer.otherSheets.length} other sheet${offer.otherSheets.length === 1 ? "" : "s"} (${offer.otherSheets.map((s) => `“${s}”`).join(", ")}) ${offer.otherSheets.length === 1 ? "was" : "were"} not imported — one file makes one table.`,
        );
    }
    if (offer.parseNotes) lines.push(...offer.parseNotes.map((n) => `• ${n}`));
    if (computed.infoConstants.length > 0 || computed.notesText !== "") {
      if (tableId) {
        const infoId = latest.current.createInfoSheet(tableId);
        latest.current.updateInfoSheet(infoId, {
          constants: computed.infoConstants.map((c) => ({ id: newConstantId(), name: c.name, value: c.value })),
          notes: computed.notesText,
          linkedTableId: tableId,
        });
        lines.push(
          `Imported ${computed.infoConstants.length} info constant${computed.infoConstants.length === 1 ? "" : "s"} and notes into a new info sheet.`,
        );
      }
    }
    lines.push(...computed.notes.map((n) => `• ${n}`));
    setPendingImport(null);
    if (lines.length > 1 || computed.notes.length > 0) setDataImported(lines);
  };

  /** Linked paste (Prism 11, seq 168): after a project loads, every table
   *  whose link says to update itself re-reads its source file — the values
   *  land as one undo step per table ("Update Linked Data"), and a source
   *  that can't be read is named, not failed over. A link that updates by
   *  hand is listed instead, so the user knows it is there to refresh.
   *  Only for a project opened from a local file, on desktop: the web
   *  build has no disk paths to re-read, and a remote project's paths name
   *  another machine's files. Returns the notice lines, if any. */
  const checkLinkedData = async (nodes: Record<string, ProjectNode>): Promise<string[]> => {
    if (!native.isNative) return [];
    const lines: string[] = [];
    for (const node of Object.values(nodes)) {
      if (node.type !== "table" || !node.data?.linkedPaste) continue;
      const link = node.data.linkedPaste;
      if (!link.autoUpdate) {
        lines.push(`• “${link.sourceName}” (${node.name}) updates by hand — use Edit ▸ Update Linked Data to refresh it.`);
        continue;
      }
      try {
        const res = await refreshLinkedFromFile(node.data, node.tableType ?? "column");
        if (res.changed) latest.current.updateTable(node.id, res.data, "Update Linked Data");
      } catch (err) {
        lines.push(
          `• “${link.sourceName}” (${node.name}) couldn't be updated — ${err instanceof Error ? err.message : "the file couldn't be read."}`,
        );
      }
    }
    return lines;
  };

  /** Imports a data file's contents (text for CSV/TXT, bytes for XLSX) —
   *  as an offer to the Import dialog, not straight into a table. The
   *  dialog previews the file as read, and confirmImport places it. A
   *  file that can't be parsed says why, in plain language. `path` is the
   *  file as the OS names it (desktop picks and drops); null on the web
   *  build, where there is no path to link back to. */
  const importDataContent = async (
    name: string,
    content: string | Uint8Array,
    path: string | null = null,
  ): Promise<void> => {
    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (ext === "xlsx") {
      if (typeof content === "string") {
        report();
        await native.alert("Couldn't Import File", `“${name}” couldn't be read as an .xlsx file.`, "error");
        return;
      }
      let parsed;
      try {
        parsed = await parseXlsx(content);
      } catch (err) {
        report();
        await native.alert(
          "Couldn't Import File",
          err instanceof Error ? err.message : "This file couldn't be imported.",
          "error",
        );
        return;
      }
      setPendingImport({
        name,
        path,
        text: null,
        xlsxRows: parsed.sheet.rows,
        sheetName: parsed.sheet.name,
        otherSheets: parsed.otherSheets,
        parseNotes: parsed.notes,
      });
      return;
    }
    if (typeof content !== "string") {
      report();
      await native.alert("Couldn't Import File", `“${name}” couldn't be read as a text file.`, "error");
      return;
    }
    setPendingImport({ name, path, text: content, xlsxRows: null, sheetName: null, otherSheets: [] });
  };

  /** Imports a data file at `path` (a dropped file, or the picker). */
  const importDataFile = async (path: string) => {
    if (path.toLowerCase().endsWith(".xlsx")) {
      let bytes: Uint8Array;
      try {
        bytes = await native.readDataBytes(path);
      } catch {
        report();
        return native.alert("Couldn't Import File", `“${fileName(path)}” couldn't be read.`, "error");
      }
      return importDataContent(path, bytes, path);
    }
    let text: string;
    try {
      text = await native.readDataText(path);
    } catch {
      report();
      return native.alert("Couldn't Import File", `“${fileName(path)}” couldn't be read.`, "error");
    }
    return importDataContent(path, text, path);
  };

  /** File ▸ Import Data File…: pick a data file (`.csv`, `.tsv`, `.txt`,
   *  `.dat`, `.prn` or `.xlsx`) and import it as a table. In the web build (no native
   *  shell) the pick is a file input instead. */
  const importData = async () => {
    if (native.isNative) {
      // Listen first, then open the panel: the shell emits
      // "data-file-picked" (path, or null on Cancel) when the user picks.
      const off = await native.onDataFilePicked((path) => {
        off();
        if (path) void importDataFile(path);
      });
      await native.chooseDataFile();
      return;
    }
    const picked = await new Promise<{ name: string; data: ArrayBuffer | string } | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".csv,.tsv,.txt,.dat,.prn,.xlsx";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result as ArrayBuffer | string });
        reader.onerror = () => resolve(null);
        // An `.xlsx` file is a ZIP: read bytes, not text.
        if (file.name.toLowerCase().endsWith(".xlsx")) reader.readAsArrayBuffer(file);
        else reader.readAsText(file);
      };
      input.click();
    });
    if (!picked) return;
    if (typeof picked.data !== "string") await importDataContent(picked.name, new Uint8Array(picked.data));
    else await importDataContent(picked.name, picked.data);
  };

  /** Applies a method file's text to the active table (plan 38): clones its
   *  first table's analyses + graphs — only what that table offers — then
   *  reports what was applied and what was skipped. A graph keeps its link
   *  to a cloned analysis (remapped to the new id); a link to an analysis
   *  that wasn't cloned is dropped and named, and the graph is still applied. */
  const applyMethodText = async (text: string, name: string): Promise<void> => {
    const tableId = latest.current.activeTableId;
    const table = tableId ? latest.current.nodes[tableId] : undefined;
    if (!tableId || !table || table.type !== "table") {
      await native.alert(
        "Apply Method",
        "Open a data table first, then apply a method to it.",
        "error",
      );
      return;
    }
    if (!table.tableType) {
      await native.alert(
        "Couldn't Apply Method",
        "The active table has no type, so nothing can be applied to it.",
        "error",
      );
      return;
    }
    let parsed;
    try {
      parsed = parseProjectText(text);
    } catch {
      await native.alert("Couldn't Apply Method", `“${name}” couldn't be read as a method file.`, "error");
      return;
    }
    if ("error" in parsed) {
      await native.alert("Couldn't Apply Method", parsed.error, "error");
      return;
    }
    const method = extractMethod(parsed.project);
    if (!method || (method.analyses.length === 0 && method.graphs.length === 0)) {
      await native.alert(
        "Couldn't Apply Method",
        `“${name}” has no analyses or graphs to apply.`,
        "error",
      );
      return;
    }
    const kept = methodForTable(method, table.tableType, table.data);
    if (kept.analyses.length === 0 && kept.graphs.length === 0) {
      await native.alert(
        "Nothing to Apply",
        formatMethodReport({
          methodName: name,
          tableName: table.name,
          appliedAnalyses: [],
          appliedGraphs: [],
          skipped: kept.skipped,
        }),
        "info",
      );
      return;
    }
    // Analyses first (their new ids), then graphs with links remapped.
    const idMap: Record<string, string> = {};
    const appliedAnalyses: { name: string }[] = [];
    for (const a of kept.analyses) {
      idMap[a.id] = latest.current.createAnalysis(tableId, a.analysisType, a.analysisParams);
      appliedAnalyses.push({ name: a.name });
    }
    const appliedGraphs: { name: string }[] = [];
    const droppedLinks: string[] = [];
    for (const g of kept.graphs) {
      const { options, dropped } = remapGraphOptions(g.graphOptions, idMap);
      latest.current.createGraph(tableId, g.graphType, options);
      appliedGraphs.push({ name: g.name });
      for (const key of dropped) droppedLinks.push(`• ${g.name} — dropped its link to an analysis that wasn't applied (${key}).`);
    }
    let report = formatMethodReport({
      methodName: name,
      tableName: table.name,
      appliedAnalyses,
      appliedGraphs,
      skipped: kept.skipped,
    });
    if (droppedLinks.length) report += `\n\nDropped links:\n${droppedLinks.join("\n")}`;
    await native.alert("Method Applied", report, "info");
  };

  /** Applies a `.pzm` file at `path` to the active table (a dropped method file). */
  const applyMethodFile = async (path: string): Promise<void> => {
    let text: string;
    try {
      text = await native.readText(path);
    } catch {
      return native.alert("Couldn't Apply Method", `“${fileName(path)}” couldn't be read.`, "error");
    }
    await applyMethodText(text, fileTitle(path));
  };

  /** Analysis ▸ Apply Method… (plan 38): pick a `.pzm` file (native open
   *  panel, non-blocking event pattern like `choosePrismFile` — a blocking
   *  picker deadlocked the app Nov 9) and apply it to the active table. In
   *  the web build (no native shell) the pick is a file input instead. */
  const applyMethod = async (): Promise<void> => {
    if (native.isNative) {
      // Listen first, then open the panel: the shell emits
      // "method-file-picked" (path, or null on Cancel) when the user picks.
      const off = await native.onMethodFilePicked((path) => {
        off();
        if (path) void applyMethodFile(path);
      });
      await native.chooseMethodFile();
      return;
    }
    const picked = await new Promise<{ name: string; data: string } | null>((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".pzm";
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: reader.result as string });
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      };
      input.click();
    });
    if (!picked) return;
    await applyMethodText(picked.data, picked.name.replace(/\.pzm$/i, ""));
  };

  /** Start from a built-in template (Welcome dialog / File ▸ Welcome…): the
   *  plan replaces the fresh window's untouched table and adds one anywhere
   *  else, then opens the template's graphs under the new table. An unknown
   *  id says so instead of opening a blank table. */
  const applyTemplate = (templateId: string) => {
    const template = templateById(templateId);
    if (!template) {
      void native.alert("Couldn't Open Template", `There's no built-in template “${templateId}”.`, "error");
      return;
    }
    const s = latest.current.get();
    const plan = planTemplateApply(template, {
      nodes: s.nodes,
      rootOrder: s.rootOrder,
      childOrder: s.childOrder,
    });
    if (plan.replaceTableId) latest.current.removeNode(plan.replaceTableId);
    const tableId = latest.current.createTableWithData(plan.table.tableType, plan.table.data, plan.table.name);
    for (const g of plan.graphs) latest.current.createGraph(tableId, g.graphType, g.options);
  };

  const openPaths = (paths: string[]) => {
    // A `.pzt` opens as a project (the shell forgets its name — see
    // `opening_for` in main.rs); a `.pzm` applies to the active table.
    const projects = paths.filter((p) => isProjectFile(p) || isTemplatePath(p));
    const methods = paths.filter(isMethodPath);
    const prism = paths.filter(isPrismFile);
    const data = paths.filter(isDataFilePath);
    if (paths.length > projects.length + methods.length + prism.length + data.length) {
      void native.alert(
        "Can't Open File",
        "Titer can only open .hlx project files and .pzt templates, apply .pzm method files, and import .pzfx / .prism / .pzf Prism files and .csv / .tsv / .txt / .dat / .prn / .xlsx data files. To convert a Prism file without opening it, use File ▸ Convert….",
      );
    }
    if (projects.length) openProjectsOrSay(projects);
    // One method file at a time: it applies to the active table, never
    // silently swallowing the rest.
    if (methods.length) {
      void applyMethodFile(methods[0]);
      if (methods.length > 1) {
        const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
        void native.alert(
          "Applied One Method File",
          `Applied ${base(methods[0])}; ${methods.slice(1).map(base).join(", ")} ${methods.length === 2 ? "was" : "were"} not applied — drop one file at a time, or use Analysis ▸ Apply Method….`,
        );
      }
    }
    // One Prism file at a time: each imports as its own untitled project.
    // (FF-F15) If several were dropped, import the first and name the rest —
    // never silently swallow files.
    if (prism.length) {
      void importPrismFile(prism[0]);
      if (prism.length > 1) {
        const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
        void native.alert("Imported One Prism File", prismDropSkippedMessage(base(prism[0]), prism.slice(1).map(base)));
      }
    }
    // One data file at a time: it imports as a new table (or into the
    // active one, when its shape matches — the picker asks). If several
    // were dropped, import the first and name the rest, like Prism above.
    if (data.length) {
      void importDataFile(data[0]);
      if (data.length > 1) {
        const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
        void native.alert(
          "Imported One Data File",
          `Imported ${base(data[0])}; ${data.slice(1).map(base).join(", ")} ${data.length === 2 ? "was" : "were"} not imported — drop one file at a time, or use File ▸ Import Data File….`,
        );
      }
    }
  };

  // Subscribed once; the handlers reach the current versions through this ref.
  const handlers = React.useRef({ confirmDiscard, confirmDiscardWithAutosave, load, openPaths });
  React.useEffect(() => {
    handlers.current = { confirmDiscard, confirmDiscardWithAutosave, load, openPaths };
  });
  React.useEffect(() => native.onCloseRequested(() => handlers.current.confirmDiscardWithAutosave()), []);
  React.useEffect(() => native.onDrop((paths) => handlers.current.openPaths(paths)), []);
  React.useEffect(() => native.onOpening(({ path, untitled }) => void handlers.current.load(path, untitled)), []);

  // ── Welcome dialog auto-show (seq 167) ─────────────────────────────────
  // Decided once, shortly after mount: only the first project window (a
  // Cmd+N / MCP window must not pop it over work), only while the project
  // is still blank, and only while the setting says to show it. The delay
  // gives the shell's opening a chance to arrive — take_opening resolves
  // within milliseconds of mount, and load() marks openedFile synchronously
  // on entry, so a file window never sees the dialog.
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (welcomeDecided.current) return;
      welcomeDecided.current = true;
      const firstWindow = !native.isNative || native.windowLabel() === "project-1";
      let stored: unknown = null;
      try {
        stored = typeof localStorage === "undefined" ? null : localStorage.getItem(WELCOME_KEY);
      } catch {
        stored = null;
      }
      const s = latest.current.get();
      if (
        firstWindow &&
        shouldShowWelcome(stored, openedFile.current) &&
        !s.filePath &&
        !s.isDirty
      ) {
        setWelcomeOpen(true);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  // ── Startup guide auto-show (seq 454) ─────────────────────────────────
  // Decided once, like Welcome: only the first project window, only while
  // the project is still blank, and only while the seen record says unseen.
  // It waits behind the Welcome dialog — the guide is a plain overlay (seq
  // 397), and a top-layer <dialog> open over it would hide it — so the
  // effect re-runs when Welcome closes: a 900 ms timer (past Welcome's own
  // 500 ms decision) opens the tour when Welcome never shows, and the same
  // decision runs again once Welcome closes. A file window never sees it:
  // openedFile is marked synchronously when a file comes in, and a .pzt
  // template, Sample Project, or slow/failed launch leaves filePath null
  // and isDirty false, so those alone can't tell — the guard needs
  // !openedFile.current. While a top-layer <dialog> (What's New, feedback
  // consent) is open the decision waits and retries instead of popping
  // over it.
  React.useEffect(() => {
    if (guideDecided.current || welcomeOpen) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const decide = () => {
      if (cancelled || guideDecided.current) return;
      // A top-layer <dialog> owns the first-run moment while open — wait
      // for it to close before deciding, so the guide never pops over it.
      if (typeof document !== "undefined" && document.querySelector("dialog[open]")) {
        timer = setTimeout(decide, 900);
        return;
      }
      guideDecided.current = true;
      const firstWindow = !native.isNative || native.windowLabel() === "project-1";
      const s = latest.current.get();
      if (firstWindow && shouldShowGuide(readGuideSeen()) && !openedFile.current && !s.filePath && !s.isDirty) {
        setGuideOpen(true);
      }
    };
    timer = setTimeout(decide, 900);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [welcomeOpen]);

  return {
    save,
    saveCopy,
    saveFamilyAs,
    renameProject,
    moveProject,
    saveTemplate,
    revertToSaved,
    applyMethod,
    applyTemplate,
    welcomeOpen,
    openWelcome,
    closeWelcome,
    guideOpen,
    openGuide,
    closeGuide,
    title,
    filePath,
    recents,
    forgetRecent,
    clearRecents,
    importPrism,
    importData,
    mergeProject,
    projectMerged,
    dismissProjectMerged,
    projectUpdated,
    dismissProjectUpdated,
    templateNotice,
    dismissTemplateNotice,
    prismImported,
    dismissPrismImported,
    prismSavedReport,
    dismissPrismSavedReport,
    dataImported,
    dismissDataImported,
    pendingImport,
    confirmImport,
    cancelImport,
    linkedNotice,
    dismissLinkedNotice,
    regenPlans,
    regenDialogOpen,
    openRegenDialog,
    dismissRegenDialog,
    consumeRegenPlans,
    resolveSavePrompt,
    remote,
    openRemotePicker,
    openRemoteHandle,
    openRemoteEntry,
    conflict,
    resolveConflict,
    offlineNotice,
    resolveOfflineNotice,
    backupRecovery,
    resolveBackupRecovery,
  };
}

/** (Mansi P0 #3) The .prism write report as notice lines: the verbatim
 *  report from `formatWriteReport` — tables / analyses written, analyses
 *  dropped with their reasons, the graphs warning — plus the file it was
 *  saved as. The report content itself is untouched; only the surfacing is
 *  new. Pure, so checks.ts pins the exact wording. */
export function prismSaveReportLines(report: PrismWriteReport, savedName: string): string[] {
  return [...formatWriteReport(report).split("\n"), "", `Saved as “${savedName}”.`];
}

/** (FF-F15) Message for a multi-file Prism drop: the first file imports,
 *  the rest are named, never silently swallowed. Pure, so checks.ts pins
 *  the exact wording. */
export function prismDropSkippedMessage(firstName: string, skippedNames: string[]): string {
  const skipped = skippedNames.join(", ");
  return `Imported ${firstName}; ${skipped} ${skippedNames.length === 1 ? "was" : "were"} not imported — drop one file at a time, or use File ▸ Convert….`;
}

/** (FF-F11) Whether a `read_text` failure means the file is gone: the shell
 *  prefixes a missing file with "not found:" — any other read failure (a
 *  file that exists but isn't UTF-8, a refusal, no permission) is unreadable,
 *  not gone, and stays in Open Recent. Tauri rejects the invoke with the
 *  plain string, so both a string and an Error are accepted. Pure, so
 *  checks.ts pins it. */
export function isGoneReadError(err: unknown): boolean {
  const message = typeof err === "string" ? err : err instanceof Error ? err.message : "";
  return message.startsWith("not found:");
}

/** (FF-F15) What a Prism file opened directly — double-clicked in the Finder,
 *  dropped on the Dock icon — is told: Titer can't open it as a project, and
 *  where to take it instead (Import Prism File, or File ▸ Convert…). Pure,
 *  so checks.ts pins the exact wording. */
export function prismFileOpenMessage(name: string): string {
  return `Titer can't open “${name}” directly — it's a Prism file, not a Titer project. Use File ▸ Import Prism File… to open it, or File ▸ Convert… to convert it to a Titer project.`;
}

export type DocumentActions = ReturnType<typeof useDocument>;

/** Deletes a table (its analyses stay as orphaned results, its graphs go), an
 *  analysis or a graph once the user confirms (Edit ▸ Undo brings it back).
 *  `detail` overrides the confirm's second line — a table with analyses says
 *  its analyses will be kept, not deleted. */
export async function removeWithConfirm(
  node: Pick<ProjectNode, "id" | "name" | "type">,
  remove: (id: string) => void,
  detail?: string,
) {
  const fallback =
    node.type === "table" ? "Its analyses and graphs will be deleted too. You can undo this." : "You can undo this.";
  if (await native.confirmDelete(`Delete “${node.name}”?`, detail ?? fallback)) remove(node.id);
}
