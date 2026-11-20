import * as React from "react";
import { ProjectSidebar, SidebarToggle } from "./project-sidebar";
import { Workspace } from "./workspace";
import { useAppMenu } from "../app-menu";
import { useDocument } from "../store/use-document";
import { useProjectStore } from "../store/use-project-store";
import { useLayout } from "../store/use-layout";
import { onFullscreenChange } from "../native";
import { UniversalModal } from "./universal-modal";
import { Dialog } from "../ui/dialog";
import { ConverterDialog } from "./converter-dialog";
import { AiConnectionsDialog } from "./ai-connections-dialog";
import { FeedbackConsentDialog } from "./feedback-consent-dialog";
import { useMcpSnapshotPublisher } from "../store/mcp-publish";
import { useMcpJobDispatcher } from "../store/mcp-dispatch";
import { SavePromptDialog } from "./save-prompt-dialog";
import { TemplateDialog } from "./template-dialog";
import { ConflictDialog } from "./conflict-dialog";
import { RemotePickerDialog } from "./remote-picker";
import { CloudSettingsDialog } from "./cloud-settings";
import { Button } from "../ui/controls";
import { FloppyDiskIcon } from "@phosphor-icons/react";
import { TABLE_TYPE_OPTIONS } from "../views/tables";
import { TableDetail } from "../views/tables/table-detail";
import { analysisOptionsForTable } from "../views/analyses";
import { AnalysisWizard } from "../views/analyses/analysis-wizard";
import { WandDialog } from "./wand-dialog";
import { SimulateDataDialog } from "./simulate-data-dialog";
import { CloneGraphDialog } from "./clone-graph-dialog";
import { ScriptDialog } from "./script-dialog";
import { PreferencesDialog } from "./preferences-dialog";
import { PRINT_SETTINGS_CHANGED_EVENT, loadPrintSettings, printPageCss } from "../lib/print-settings";
import { useStartAnalysis } from "../views/analyses/use-analysis-launcher";
import { GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";

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
  // v3 Phase 1: this window's project goes to the MCP server on every edit.
  useMcpSnapshotPublisher();
  // v1.6.0 L0: this window runs the MCP jobs Rust queues for it.
  useMcpJobDispatcher();
  const { projectUpdated, dismissProjectUpdated } = documentActions;
  const { prismImported, dismissPrismImported, dataImported, dismissDataImported } = documentActions;
  const { templateNotice, dismissTemplateNotice } = documentActions;
  const { sidebar } = useLayout();
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
  const { nodes, selector, closeSelector, createTable, createGraph, isDirty } = useProjectStore();
  const startAnalysis = useStartAnalysis();
  // The New Analysis / New Graph pickers list what fits the target table's type.
  const tableType = selector && "tableId" in selector ? (nodes[selector.tableId]?.tableType ?? "column") : "column";
  const tableData = selector && "tableId" in selector ? nodes[selector.tableId]?.data : undefined;

  return (
    <div className="flex h-full">
      {!sidebar && <SidebarToggle className={`fixed top-3 z-10 print:hidden ${hidden.button}`} />}
      <ProjectSidebar />
      <main
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
        <Workspace />
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
          family as "Project Updated" above. */}
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
      />

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

      <ConverterDialog />

      <AiConnectionsDialog />

      <PreferencesDialog />

      <FeedbackConsentDialog />

      <SavePromptDialog onChoose={(choice, remember) => documentActions.resolveSavePrompt(choice, remember)} />

      <TemplateDialog
        defaultName={documentActions.title}
        onSave={(kind, info) => void documentActions.saveTemplate(kind, info)}
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
    </div>
  );
}
