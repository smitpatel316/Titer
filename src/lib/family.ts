// Save Family As (seq 233): the part of a project one data table owns —
// the table, its child analyses and graphs, and the info sheets linked
// to it — as a project of its own, so it opens standalone in Titer.
// Pure, so checks.ts pins it. Figures are never part of a family (they
// may span tables) and stay behind, as do the other tables.
import type { ProjectFilePayload } from "./project-file";
import type { ProjectNode } from "../store/types";

export interface FamilySource {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
}

/** The family of `tableId` as a standalone project payload: the table
 *  first in root order, its children in sidebar order, the linked info
 *  sheets after them, the table active. Returns null when the id is not
 *  a table — the menu only offers it on one, but the saver checks too. */
export function extractFamily(
  { nodes, rootOrder, childOrder, activeNodeId }: FamilySource,
  tableId: string,
): ProjectFilePayload | null {
  const table = nodes[tableId];
  if (!table || table.type !== "table") return null;
  const familyNodes: Record<string, ProjectNode> = { [tableId]: table };
  const familyRoot = [tableId];
  const familyChildren: Record<string, string[]> = { [tableId]: [] };
  for (const childId of childOrder[tableId] ?? []) {
    const child = nodes[childId];
    if (!child) continue;
    familyNodes[childId] = child;
    familyChildren[tableId].push(childId);
  }
  // Info sheets linked to this table come along (their link still names
  // this table, which the family keeps); global info sheets stay behind.
  // No childOrder entry for them — they have no children, and the loader
  // drops empty child lists, so emitting one would mark the family
  // "updated" on open.
  for (const rootId of rootOrder) {
    const node = nodes[rootId];
    if (node?.type === "info" && node.info?.linkedTableId === tableId) {
      familyNodes[rootId] = node;
      familyRoot.push(rootId);
    }
  }
  return {
    nodes: familyNodes,
    rootOrder: familyRoot,
    childOrder: familyChildren,
    activeNodeId: activeNodeId === tableId || (activeNodeId && familyNodes[activeNodeId]) ? activeNodeId : tableId,
  };
}
