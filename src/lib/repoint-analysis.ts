// Re-pointing an orphaned analysis (seq 242): an analysis whose source
// table was deleted can move to another table — but only one that offers
// its test, so the re-run it is waiting for can actually run there.
// Pure — unit-tested in tests/checks.ts.
import type { ProjectNode } from "../store/types";
import { analysisTypesOfferedForTable } from "../views/analyses";

/** The tables `analysis` may move to: every table offering its test, in
 *  project order. Anything else (a live analysis, a table, a test no
 *  table offers) has no candidates. */
export function repointCandidates(analysis: ProjectNode, nodes: Record<string, ProjectNode>): ProjectNode[] {
  if (analysis.type !== "analysis" || !analysis.analysisType) return [];
  return Object.values(nodes).filter(
    (n) =>
      n.type === "table" &&
      n.tableType !== undefined &&
      analysisTypesOfferedForTable(n.tableType, n.data).includes(analysis.analysisType!),
  );
}
