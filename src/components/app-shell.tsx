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
import { useMcpSnapshotPublisher } from "../store/mcp-publish";
import { SavePromptDialog } from "./save-prompt-dialog";
import { TemplateDialog } from "./template-dialog";
import { ConflictDialog } from "./conflict-dialog";
import { RemotePickerDialog } from "./remote-picker";
import { CloudSettingsDialog } from "./cloud-settings";
import { Button } from "../ui/controls";
import { TABLE_TYPE_OPTIONS } from "../views/tables";
import { TableDetail } from "../views/tables/table-detail";
import { analysisOptionsForTable } from "../views/analyses";
import { AnalysisWizard } from "../views/analyses/analysis-wizard";
import { WandDialog } from "./wand-dialog";
import { SimulateDataDialog } from "./simulate-data-dialog";
import { CloneGraphDialog } from "./clone-graph-dialog";
import { ScriptDialog } from "./script-dialog";
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
  const { projectUpdated, dismissProjectUpdated } = documentActions;
  const { templateNotice, dismissTemplateNotice } = documentActions;
  const { sidebar } = useLayout();
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => onFullscreenChange(setFullscreen), []);
  const hidden = HIDDEN_SIDEBAR[fullscreen ? "fullscreen" : "window"];
  const { nodes, selector, closeSelector, createTable, createGraph } = useProjectStore();
  const startAnalysis = useStartAnalysis();
  // The New Analysis / New Graph pickers list what fits the target table's type.
  const tableType = selector && "tableId" in selector ? (nodes[selector.tableId]?.tableType ?? "column") : "column";
  const tableData = selector && "tableId" in selector ? nodes[selector.tableId]?.data : undefined;

  return (
    <div className="flex h-full">
      {!sidebar && <SidebarToggle className={`fixed top-3 z-10 ${hidden.button}`} />}
      <ProjectSidebar />
      <main
        className="flex min-w-0 flex-1 flex-col"
        style={{ "--toolbar-inset": sidebar ? "16px" : hidden.inset } as React.CSSProperties}
      >
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
          if (selector?.kind === "new-analysis" && startAnalysis(selector.tableId, type)) return;
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

      <ConverterDialog />

      <AiConnectionsDialog />

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
