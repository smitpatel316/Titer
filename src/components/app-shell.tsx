import * as React from "react";
import { ProjectSidebar, SidebarToggle } from "./project-sidebar";
import { Workspace } from "./workspace";
import { useAppMenu } from "../app-menu";
import { useDocument } from "../store/use-document";
import { useProjectStore } from "../store/use-project-store";
import { useLayout } from "../store/use-layout";
import { alert, onFullscreenChange } from "../native";
import { UniversalModal } from "./universal-modal";
import { Dialog } from "../ui/dialog";
import { ConverterDialog } from "./converter-dialog";
import { ExportAllDialog } from "./export-all-dialog";
import { AiConnectionsDialog } from "./ai-connections-dialog";
import { MarketplaceDialog } from "./marketplace-dialog";
import { FeedbackConsentDialog } from "./feedback-consent-dialog";
import { SendFeedbackDialog } from "./send-feedback-dialog";
import { CrashReportDialog } from "./crash-report-dialog";
import { WhatsNewDialog } from "./whats-new-dialog";
import { StartupGuideDialog } from "./startup-guide-dialog";
import { useMcpSnapshotPublisher } from "../store/mcp-publish";
import { useMcpJobDispatcher } from "../store/mcp-dispatch";
import { SavePromptDialog } from "./save-prompt-dialog";
import { TemplateDialog } from "./template-dialog";
import { RenameDialog } from "./rename-dialog";
import { fileName } from "../lib/paths";
import { WelcomeDialog } from "./welcome-dialog";
import { openProjectsOrSay } from "../menus";
import { ConflictDialog } from "./conflict-dialog";
import { BackupRecoveryDialog } from "./backup-recovery-dialog";
import { ImportDialog } from "../views/tables/import-dialog";
import type { ImportChoices } from "../lib/import-choices";
import { RemotePickerDialog } from "./remote-picker";
import { CloudSettingsDialog } from "./cloud-settings";
import { Button } from "../ui/controls";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { TABLE_TYPE_OPTIONS } from "../views/tables";
import { TableDetail } from "../views/tables/table-detail";
import { analysisOptionsForTable, isAnalysisOffered } from "../views/analyses";
import { clearRecentAnalyses, loadRecentAnalyses, type RecentAnalysisEntry } from "../store/recent-analyses";
import { AnalysisWizard } from "../views/analyses/analysis-wizard";
import { WandDialog } from "./wand-dialog";
import { SimulateDataDialog } from "./simulate-data-dialog";
import { ConvertToNestedDialog } from "./convert-to-nested-dialog";
import { SampleSizePowerDialog } from "./sample-size-power-dialog";
import { CloneGraphDialog } from "./clone-graph-dialog";
import { clonableGraphs } from "../lib/clone-graph";
import { RegenerateGraphsDialog } from "./regenerate-graphs-dialog";
import { ScriptDialog } from "./script-dialog";
import { PreferencesDialog } from "./preferences-dialog";
import { PRINT_SETTINGS_CHANGED_EVENT, loadPrintSettings, printPageCss } from "../lib/print-settings";
import { useStartAnalysis } from "../views/analyses/use-analysis-launcher";
import { GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";
import { goToSheetEntries } from "../lib/sheet-navigation";
import { installPaneFocusCycling } from "../lib/pane-focus";

// The traffic lights sit at x 20–80, centered in the 52 px toolbars (`trafficLightPosition`
// in tauri.conf.json). With the sidebar hidden, its button follows them (or starts the
// toolbar in full screen, where they're gone), and toolbars start after it.
const HIDDEN_SIDEBAR = {
  window: { button: "left-[92px]", inset: "132px" },
  fullscreen: { button: "left-3", inset: "52px" },
};

export function AppShell() {
  const documentActions = useDocument();
  useAppMenu(documentActions);
  // Seq 300: F6 / Shift+F6 cycles keyboard focus between the panes
  // (Navigator → sheet → floating notes → Inspector), with a visible ring
  // on the pane holding focus. Installed once, for the window's life.
  React.useEffect(() => installPaneFocusCycling(), []);
  // v3 Phase 1: this window's project goes to the MCP server on every edit.
  useMcpSnapshotPublisher();
  // v1.6.0 L0: this window runs the MCP jobs Rust queues for it.
  useMcpJobDispatcher();
  const { projectUpdated, dismissProjectUpdated } = documentActions;
  const { prismImported, dismissPrismImported, dataImported, dismissDataImported } = documentActions;
  const { pendingImport, confirmImport, cancelImport } = documentActions;
  const { activeNode } = useProjectStore();
  const { prismSavedReport, dismissPrismSavedReport } = documentActions;
  const { projectMerged, dismissProjectMerged } = documentActions;
  const { templateNotice, dismissTemplateNotice } = documentActions;
  const { linkedNotice, dismissLinkedNotice } = documentActions;
  const { sidebar, gallery } = useLayout();
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => onFullscreenChange(setFullscreen), []);
  // Seq 227: the `@page` rule for the print settings (paper, orientation,
  // margins, scale), injected once and re-injected whenever Preferences
  // changes them — File ▸ Print and a script's Print both print on it.
  React.useEffect(() => {
    const apply = () => {
      let style = document.getElementById("titer-print-page");
      if (!style) {
        style = document.createElement("style");
        style.id = "titer-print-page";
        document.head.appendChild(style);
      }
      style.textContent = printPageCss(loadPrintSettings());
    };
    apply();
    window.addEventListener(PRINT_SETTINGS_CHANGED_EVENT, apply);
    return () => window.removeEventListener(PRINT_SETTINGS_CHANGED_EVENT, apply);
  }, []);
  const hidden = HIDDEN_SIDEBAR[fullscreen ? "fullscreen" : "window"];
  const { nodes, rootOrder, childOrder, selector, openSelector, closeSelector, createTable, createGraph, setActiveNode, isDirty } =
    useProjectStore();
  const startAnalysis = useStartAnalysis();
  // The New Analysis / New Graph pickers list what fits the target table's type.
  const tableType = selector && "tableId" in selector ? (nodes[selector.tableId]?.tableType ?? "column") : "column";
  const tableData = selector && "tableId" in selector ? nodes[selector.tableId]?.data : undefined;
  // Recently-used analyses (seq 298): read fresh whenever the New Analysis
  // picker opens; the Clear link bumps the version to re-read after emptying.
  const [recentsVersion, setRecentsVersion] = React.useState(0);
  const recentAnalyses = React.useMemo(
    () => (selector?.kind === "new-analysis" ? loadRecentAnalyses() : []),
    [selector?.kind, recentsVersion],
  );
  // A tap on a recent entry opens its wizard — or the not-applicable note
  // when this table's type doesn't offer it.
  const onRecentAnalysis = (entry: RecentAnalysisEntry) => {
    if (selector?.kind !== "new-analysis") return;
    if (!isAnalysisOffered(entry.type, tableType, tableData)) {
      const tableTypeLabel = TABLE_TYPE_OPTIONS.find((o) => o.value === tableType)?.label ?? tableType;
      alert(
        `“${entry.label}” isn't available for this table.`,
        `This analysis isn't offered for a ${tableTypeLabel} table. Run it from a table that supports it.`,
      );
      return;
    }
    if (startAnalysis(selector.tableId, entry.type, selector.forGraph)) return;
    closeSelector();
  };
  // Go to Sheet (seq 240): every sheet in outline order, grouped by section.
  const goToEntries = selector?.kind === "go-to-sheet" ? goToSheetEntries(nodes, rootOrder, childOrder) : [];

  return (
    <div className="flex h-full">
      {!sidebar && <SidebarToggle className={`fixed top-3 z-10 print:hidden ${hidden.button}`} />}
      <ProjectSidebar />
      <main
        data-pane="sheet"
        className="flex min-w-0 flex-1 flex-col"
        style={{ "--toolbar-inset": sidebar ? "16px" : hidden.inset } as React.CSSProperties}
      >
        {/* Save button (1.7.3): AppShell owns no toolbar of its own — every view
            renders its own Toolbar — so the button lives in a slim strip above
            the workspace, at the same left inset as the toolbars (room for the
            traffic lights when the sidebar is hidden). A fixed overlay would
            sit on top of the views' own toolbar buttons. Same action and
            enablement as File ▸ Save: disabled while the project is clean,
            and it never opens a dialog of its own — an untitled project falls
            through to save()'s own save panel. */}
        <div
          data-tauri-drag-region
          className="flex h-10 shrink-0 items-center gap-2 border-b border-separator pr-3 pl-[var(--toolbar-inset,16px)] print:hidden"
        >
          <Button
            disabled={!isDirty}
            onClick={() => void documentActions.save()}
            title="Save (CmdOrCtrl+S)"
            aria-label="Save"
            className="[&_svg]:size-4"
          >
            <FloppyDiskIcon />
            Save
          </Button>
        </div>
        <Workspace
          importOffer={pendingImport}
          onConfirmImport={(choices: ImportChoices, insertion: { r: number; c: number } | null) =>
            void confirmImport(choices, insertion)
          }
          onCancelImport={cancelImport}
          onChooseImportFile={() => {
            cancelImport();
            void documentActions.importData();
          }}
        />
      </main>

      <UniversalModal
        open={selector?.kind === "new-table"}
        title="New Table"
        description="Choose a data table type."
        options={TABLE_TYPE_OPTIONS}
        detail={(type) => <TableDetail type={type} />}
        onSelect={(type) => {
          createTable(type);
          closeSelector();
        }}
        onClose={closeSelector}
      />

      <UniversalModal
        open={selector?.kind === "new-analysis"}
        title="New Analysis"
        description="Choose a statistical test."
        header={
          recentAnalyses.length > 0 ? (
            <section aria-label="Recently used">
              <p className="text-strong">Recently used</p>
              <ul className="-mx-2 mt-1 flex flex-col gap-0.5">
                {recentAnalyses.map((entry) => (
                  <li key={entry.type}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left text-regular outline-none focus:bg-accent focus:text-white"
                      onClick={() => onRecentAnalysis(entry)}
                    >
                      {entry.label}
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  className="text-small text-secondary underline outline-none hover:text-primary focus:text-primary"
                  onClick={() => {
                    clearRecentAnalyses();
                    setRecentsVersion((v) => v + 1);
                  }}
                >
                  Clear
                </button>
              </div>
              <div className="mt-3 border-t border-separator" />
            </section>
          ) : undefined
        }
        options={analysisOptionsForTable(tableType, tableData)}
        onSelect={(type) => {
          // A test with options moves on to its wizard; otherwise the picker is done.
          if (selector?.kind === "new-analysis" && startAnalysis(selector.tableId, type, selector.forGraph)) return;
          closeSelector();
        }}
        onClose={closeSelector}
      />

      <AnalysisWizard />

      <WandDialog />

      <SimulateDataDialog />

      <ConvertToNestedDialog />

      <SampleSizePowerDialog />

      <CloneGraphDialog />

      <ScriptDialog onSave={() => void documentActions.save()} />

      {/* The "Project Updated" notice, in-app: the native dialog's window lingered
          on macOS after dismissal, blocking clicks and quitting (Quirk 2). */}
      <Dialog
        open={projectUpdated}
        onClose={dismissProjectUpdated}
        onReturn={dismissProjectUpdated}
        dismissLabel="OK"
        title="Project Updated"
        description="This project was made with an older Titer, or part of it couldn't be read as it was. Titer brought it up to date; save it to keep the update."
      />

      {/* The "Prism File Imported" notice, in-app: the native alert's OK button
          could not dismiss it on macOS (v1.6.0 Mac proof — second native sheet
          on the window right after the askToSave sheet; rfd's sheet path left
          the alert window with a button that ends nothing). Same Quirk-2
          family as "Project Updated" above. When the import carried graphs
          Prism didn't transfer, "Regenerate graphs…" opens the preview that
          rebuilds the auto-created ones (seq 291). */}
      <Dialog
        open={prismImported !== null}
        onClose={dismissPrismImported}
        onReturn={dismissPrismImported}
        dismissLabel="OK"
        title="Prism File Imported"
        description={
          <>
            {prismImported?.map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </>
        }
        footer={
          documentActions.regenPlans?.some((p) => p.reconstructible) ? (
            <Button variant="accent" onClick={() => documentActions.openRegenDialog()}>
              Regenerate graphs…
            </Button>
          ) : undefined
        }
      />

      {/* The "Saved as Prism" notice (Mansi P0 #3), in-app for the same
          Quirk-2 reason as "Prism File Imported" above: the write report
          used to be computed and thrown away, so dropped analyses and the
          graphs warning were silent. A manual .prism save shows it; a
          background save (autosave, quit-save) never does. Long reports
          scroll, like the converter's. */}
      <Dialog
        open={prismSavedReport !== null}
        onClose={dismissPrismSavedReport}
        onReturn={dismissPrismSavedReport}
        dismissLabel="OK"
        title="Saved as Prism"
        description="What made it into the .prism file — and what didn't. Anything listed as not written needs re-creating in Prism from the tables."
      >
        <pre className="max-h-64 overflow-auto rounded-md bg-control p-3 text-small whitespace-pre-wrap">
          {prismSavedReport?.join("\n")}
        </pre>
      </Dialog>

      {/* The "Data File Imported" notice, in-app for the same Quirk-2
          reason as "Prism File Imported" above. Shown only when the import
          has something to say (assumptions it made, rows padded, sheets
          skipped); a clean import just opens the table. */}
      <Dialog
        open={dataImported !== null}
        onClose={dismissDataImported}
        onReturn={dismissDataImported}
        dismissLabel="OK"
        title="Data File Imported"
        description={
          <>
            {dataImported?.map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </>
        }
      />

      {/* The Import dialog when no table is showing it (seq 429): the grid
          shows it over the live insertion point while a table is active,
          but an empty project, a graph, or the Gallery has no grid — the
          shell shows it instead, with no insertion point, so the import
          creates a new table. */}
      {pendingImport !== null && (activeNode?.type !== "table" || gallery) && (
        <ImportDialog
          offer={pendingImport}
          insertionPoint={null}
          onConfirm={(choices: ImportChoices, insertion: { r: number; c: number } | null) =>
            void confirmImport(choices, insertion)
          }
          onCancel={cancelImport}
          onChooseFile={() => {
            cancelImport();
            void documentActions.importData();
          }}
        />
      )}

      {/* The "Linked Data" notice, in-app for the same Quirk-2 reason as
          "Data File Imported" above: the linked sources a project open
          couldn't refresh (moved, deleted, unreadable), and the links that
          update by hand. The values stay as they were saved; use Edit ▸
          Update Linked Data to try again once the file is back. */}
      <Dialog
        open={linkedNotice !== null}
        onClose={dismissLinkedNotice}
        onReturn={dismissLinkedNotice}
        dismissLabel="OK"
        title="Linked Data"
        description={
          <>
            {linkedNotice?.map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </>
        }
      />
      {/* The "Project Merged" notice (File ▸ Merge, seq 180), in-app for
          the same Quirk-2 reason as "Prism File Imported" above. */}
      <Dialog
        open={projectMerged !== null}
        onClose={dismissProjectMerged}
        onReturn={dismissProjectMerged}
        dismissLabel="OK"
        title="Project Merged"
        description={
          <>
            {projectMerged?.map((line, i) => (
              <React.Fragment key={i}>
                {line}
                <br />
              </React.Fragment>
            ))}
          </>
        }
      />

      <RegenerateGraphsDialog
        open={documentActions.regenDialogOpen}
        onCancel={documentActions.dismissRegenDialog}
        onDone={documentActions.consumeRegenPlans}
      />

      <ConverterDialog onOpenRegenerate={() => documentActions.openRegenDialog()} />

      <ExportAllDialog />

      <AiConnectionsDialog />

      <MarketplaceDialog />

      <PreferencesDialog />

      <FeedbackConsentDialog />

      <SendFeedbackDialog />

      <CrashReportDialog />

      <WhatsNewDialog />

      {/* The startup guide (seq 454): the first-run tour, auto-shown once
          per user on a fresh first window (use-document decides when) and
          re-opened from Help ▸ Startup Guide…. Closing always marks it
          seen, so it never reappears. */}
      <StartupGuideDialog open={documentActions.guideOpen} onClose={documentActions.closeGuide} />

      <SavePromptDialog onChoose={(choice, remember) => documentActions.resolveSavePrompt(choice, remember)} />

      <TemplateDialog
        defaultName={documentActions.title}
        onSave={(kind, info) => void documentActions.saveTemplate(kind, info)}
      />

      <RenameDialog
        defaultName={
          documentActions.filePath ? fileName(documentActions.filePath) : documentActions.title
        }
        onRename={(name) => void documentActions.renameProject(name)}
      />

      {/* The Welcome dialog (seq 167): the gallery + Graph Portfolio + recents
          on a fresh window (use-document decides when it auto-shows); File ▸
          Welcome… opens it on demand. Clone a Graph (seq 167 remainder, M4)
          opens the Clone dialog for the picked graph; a shared template (M6)
          opens as a new untitled project, like any .pzt. */}
      <WelcomeDialog
        open={documentActions.welcomeOpen}
        onClose={documentActions.closeWelcome}
        onApplyTemplate={(templateId) => documentActions.applyTemplate(templateId)}
        recents={documentActions.recents}
        onOpenRecent={(entry) =>
          entry.kind === "local"
            ? openProjectsOrSay([entry.path], (gone) =>
                documentActions.forgetRecent({ kind: "local", path: gone }),
              )
            : documentActions.openRemoteEntry(entry)
        }
        clonableGraphs={clonableGraphs({ nodes, rootOrder, childOrder })}
        onCloneGraph={(graphId) => openSelector({ kind: "clone-graph", graphId })}
        onOpenSharedTemplate={(path) => openProjectsOrSay([path])}
      />

      {/* A template's instructions on open (plan 38): Prism's popup, in-app
          — the native dialog's window lingered on macOS after dismissal
          (Quirk 2). The template opens untitled, so saving it asks for a name
          and the template file itself is never overwritten. */}
      <Dialog
        open={templateNotice !== null}
        onClose={dismissTemplateNotice}
        onReturn={dismissTemplateNotice}
        dismissLabel="OK"
        title={templateNotice?.name ?? "Template"}
        description={
          <>
            {templateNotice?.instructions ?? templateNotice?.description}
            <br />
            <br />
            This template opens as a new, unsaved project — saving it asks where to put it, and the template file itself is never changed.
          </>
        }
      />

      <ConflictDialog
        conflict={documentActions.conflict}
        onChoose={(choice) => void documentActions.resolveConflict(choice)}
      />

      {/* Crash recovery (seq 226): a backup newer than the saved file is
          offered once, right after the project is established. */}
      <BackupRecoveryDialog
        recovery={documentActions.backupRecovery}
        onChoose={(choice) => void documentActions.resolveBackupRecovery(choice)}
      />

      <RemotePickerDialog onPick={(handle) => documentActions.openRemoteHandle(handle)} onClose={closeSelector} />

      <CloudSettingsDialog onClose={closeSelector} />

      {/* Offline: the open document stays editable from its cache copy — a
          failed save never discards it. "Try Again" re-saves from the
          current project; "Save a Local Copy" saves to disk instead. */}
      <Dialog
        open={documentActions.offlineNotice !== null}
        onClose={() => void documentActions.resolveOfflineNotice("dismiss")}
        title={documentActions.offlineNotice?.mode === "open" ? "You're offline" : "Couldn't save — you're offline"}
        description={
          documentActions.offlineNotice?.mode === "open"
            ? "You're editing the copy saved on this computer. Your changes will upload when you reconnect."
            : "The save didn't reach the cloud — you're offline. Your edits are still here."
        }
        footer={
          <>
            {documentActions.offlineNotice?.mode === "save" && (
              <Button variant="accent" onClick={() => void documentActions.resolveOfflineNotice("retry")}>
                Try Again
              </Button>
            )}
            <Button onClick={() => void documentActions.resolveOfflineNotice("local-copy")}>Save a Local Copy</Button>
          </>
        }
      />

      <UniversalModal
        open={selector?.kind === "new-graph"}
        title="New Graph"
        description="Choose a graph type."
        options={GRAPH_OPTIONS_BY_TABLE[tableType]}
        onSelect={(type) => {
          if (selector?.kind === "new-graph") createGraph(selector.tableId, type);
          closeSelector();
        }}
        onClose={closeSelector}
      />

      {/* Go to Sheet (seq 240, View ▸ Go to Sheet…): every sheet in
          outline order, grouped by section. */}
      <UniversalModal
        open={selector?.kind === "go-to-sheet"}
        title="Go to Sheet"
        description="Jump to a sheet in this project."
        options={goToEntries.map((e) => ({ value: e.id, label: `${e.section} — ${e.label}` }))}
        onSelect={(id) => {
          setActiveNode(id);
          closeSelector();
        }}
        onClose={closeSelector}
      />
    </div>
  );
}
