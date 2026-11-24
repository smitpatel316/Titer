import * as React from "react";
import { EmptyState } from "../ui/layout";
import { useProjectStore } from "../store/use-project-store";
import { useLayout } from "../store/use-layout";
import { GalleryView } from "../components/gallery-view";
import { TableView } from "../views/tables/table-view";
import { AnalysisView } from "../views/analyses/analysis-view";
import { GraphView } from "../views/graphs/graph-view";
import { FigureView } from "../views/figures/figure-view";
import { InfoSheetView } from "../views/info/info-sheet-view";
import { GRAPHS } from "../views/graphs";
import { ANALYSES } from "../stats";
import type { ImportChoices, ImportOffer } from "../lib/import-choices";

const NEWER = "It was made with a newer version of Titer.";

/** Shows the active node's view — or the Gallery (seq 229), every graph on one sheet. */
export function Workspace({
  importOffer,
  onConfirmImport,
  onCancelImport,
  onChooseImportFile,
}: {
  /** A file offered to the Import dialog (seq 429), passed to the table view. */
  importOffer?: ImportOffer | null;
  onConfirmImport?: (choices: ImportChoices, insertion: { r: number; c: number } | null) => void;
  onCancelImport?: () => void;
  onChooseImportFile?: () => void;
}) {
  const { activeNode: node } = useProjectStore();
  const { gallery } = useLayout();

  if (gallery)
    return (
      <Shown key="gallery">
        <GalleryView />
      </Shown>
    );
  if (node?.type === "table" && node.data)
    return (
      <Shown key={node.id}>
        <TableView
          node={node}
          importOffer={importOffer}
          onConfirmImport={onConfirmImport}
          onCancelImport={onCancelImport}
          onChooseImportFile={onChooseImportFile}
        />
      </Shown>
    );
  if (node?.type === "analysis" && node.analysisType) {
    if (!Object.hasOwn(ANALYSES, node.analysisType)) return <EmptyState title="Unknown Analysis" description={NEWER} />;
    return (
      <Shown key={node.id}>
        <AnalysisView node={node} />
      </Shown>
    );
  }
  if (node?.type === "graph" && node.graphType) {
    if (!Object.hasOwn(GRAPHS, node.graphType)) return <EmptyState title="Unknown Graph" description={NEWER} />;
    return (
      <Shown key={node.id}>
        <GraphView node={node} />
      </Shown>
    );
  }
  if (node?.type === "figure") {
    return (
      <Shown key={node.id}>
        <FigureView node={node} />
      </Shown>
    );
  }
  if (node?.type === "info") {
    return (
      <Shown key={node.id}>
        <InfoSheetView node={node} />
      </Shown>
    );
  }
  return <EmptyState title="No Selection" description="Create or select a table to begin." />;
}

/** A view that fails to draw says so in its place: the rest of the window (the
 *  sidebar, the menus, Save) keeps working, so nothing is lost. */
class Shown extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.error ? (
      <EmptyState title="This Item Couldn't Be Shown" description={this.state.error} />
    ) : (
      this.props.children
    );
  }
}
