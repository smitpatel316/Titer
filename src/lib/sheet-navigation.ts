// Keyboard navigation (seq 240): the sheet history behind Previous Sheet,
// the linked sheets behind Go to Linked Sheet, and the grouped list
// behind Go to Sheet. Seq 240 remainder adds Next Sheet's forward step,
// Go to Section's first sheet, and the Family panel's rows. Pure —
// unit-tested in tests/checks.ts.
import type { ProjectNode } from "../store/types";

/** How many sheets the history remembers: enough to walk back through a
 *  session's work, bounded so a long session doesn't grow it forever. */
export const SHEET_HISTORY_MAX = 50;

/** `id` visited: appended, unless it is already the last one — repeats
 *  don't stack — and the oldest entries drop past the cap. */
export function pushHistory(history: string[], id: string): string[] {
  if (history.at(-1) === id) return history;
  return [...history, id].slice(-SHEET_HISTORY_MAX);
}

/** The sheet Previous Sheet goes to: the one before the current sheet's
 *  latest visit — the ping-pong partner — or null when there is none
 *  (never visited, or only ever this sheet). */
export function pingPongTarget(history: string[], currentId: string | null): string | null {
  if (currentId === null) return null;
  const at = history.lastIndexOf(currentId);
  if (at <= 0) return null;
  return history[at - 1];
}

/** The sheets linked to `node`, in the order Go to Linked Sheet walks
 *  them: a graph or analysis starts at its table, then its siblings; a
 *  table lists its children, then the info sheets tied to it; an info
 *  sheet its linked table; a figure has no links. */
export function linkedSheetIds(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  childOrder: Record<string, string[]>,
): string[] {
  if (node.type === "table") {
    const children = (childOrder[node.id] ?? []).filter((id) => nodes[id]);
    const infos = Object.values(nodes).filter(
      (n) => n.type === "info" && n.info?.linkedTableId === node.id,
    );
    return [...children, ...infos.map((n) => n.id)];
  }
  if (node.type === "info") {
    const linked = node.info?.linkedTableId;
    return linked && nodes[linked] ? [linked] : [];
  }
  if (node.type === "analysis" || node.type === "graph") {
    const parent = node.parentId;
    if (!parent || !nodes[parent]) return [];
    const siblings = (childOrder[parent] ?? []).filter((id) => id !== node.id && nodes[id]);
    return [parent, ...siblings];
  }
  return [];
}

/** One row of Go to Sheet: the sheet's id, its section, and its name. */
export interface GoToSheetEntry {
  id: string;
  section: "Data" | "Results" | "Graphs" | "Layouts" | "Info";
  label: string;
}

const SECTION_OF: Record<ProjectNode["type"], GoToSheetEntry["section"]> = {
  table: "Data",
  analysis: "Results",
  graph: "Graphs",
  figure: "Layouts",
  info: "Info",
};

/** Every sheet in outline order — tables with their children, then the
 *  info sheets and figures at the root — grouped by section. */
export function goToSheetEntries(
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
): GoToSheetEntry[] {
  const entries: GoToSheetEntry[] = [];
  const push = (node: ProjectNode | undefined) => {
    if (!node) return;
    entries.push({ id: node.id, section: SECTION_OF[node.type], label: node.name });
  };
  for (const id of rootOrder) {
    const node = nodes[id];
    push(node);
    if (node?.type === "table") for (const childId of childOrder[id] ?? []) push(nodes[childId]);
  }
  return entries;
}

/** The sheet Next Sheet goes to: the sheet after the current one in the
 *  outline order Go to Sheet lists, wrapping from the last sheet back to
 *  the first — the forward counterpart of Previous Sheet's ping-pong. A
 *  lone sheet has nowhere to go, so it stays. */
export function nextSheetId(
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
  currentId: string | null,
): string | null {
  if (currentId === null) return null;
  const entries = goToSheetEntries(nodes, rootOrder, childOrder);
  if (entries.length === 0) return null;
  const at = entries.findIndex((e) => e.id === currentId);
  if (at === -1) return null;
  return entries[(at + 1) % entries.length].id;
}

/** The first sheet of a section — Data, Results, Graphs, Layouts or Info —
 *  in outline order, or null when the project has no sheet in it. */
export function sectionFirstSheetId(
  section: GoToSheetEntry["section"],
  nodes: Record<string, ProjectNode>,
  rootOrder: string[],
  childOrder: Record<string, string[]>,
): string | null {
  return goToSheetEntries(nodes, rootOrder, childOrder).find((e) => e.section === section)?.id ?? null;
}

/** The sheets in `node`'s family, in Navigator order: the table that owns
 *  it with everything under it, plus the info sheets tied to that table.
 *  A graph or analysis belongs to its table's family; an info sheet to its
 *  linked table's; a figure's family is itself plus the graphs it shows. */
export function familySheetIds(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  childOrder: Record<string, string[]>,
): string[] {
  if (node.type === "table") {
    const children = (childOrder[node.id] ?? []).filter((id) => nodes[id]);
    const infos = Object.values(nodes).filter(
      (n) => n.type === "info" && n.info?.linkedTableId === node.id,
    );
    return [node.id, ...children, ...infos.map((n) => n.id)];
  }
  if (node.type === "analysis" || node.type === "graph") {
    const parent = node.parentId && node.parentId !== node.id ? nodes[node.parentId] : undefined;
    return parent ? familySheetIds(parent, nodes, childOrder) : [node.id];
  }
  if (node.type === "info") {
    const linkedId = node.info?.linkedTableId;
    const linked = linkedId && linkedId !== node.id ? nodes[linkedId] : undefined;
    return linked ? familySheetIds(linked, nodes, childOrder) : [node.id];
  }
  if (node.type === "figure") {
    const seen = new Set<string>();
    const graphs = (node.panels ?? [])
      .map((p) => p.graphId)
      .filter((id) => id !== "" && nodes[id]?.type === "graph" && !seen.has(id) && (seen.add(id), true));
    return [node.id, ...graphs];
  }
  return [node.id];
}

/** One row of the Family panel: the sheet's id, its depth under the
 *  family table, its section, and its name. */
export interface FamilyPanelEntry {
  id: string;
  depth: number;
  section: GoToSheetEntry["section"];
  label: string;
}

/** The active sheet's family as panel rows: the table at the top, its
 *  children and info sheets indented under it. */
export function familyPanelEntries(
  node: ProjectNode,
  nodes: Record<string, ProjectNode>,
  childOrder: Record<string, string[]>,
): FamilyPanelEntry[] {
  return familySheetIds(node, nodes, childOrder)
    .map((id, i) => {
      const n = nodes[id];
      if (!n) return null;
      return { id, depth: i === 0 ? 0 : 1, section: SECTION_OF[n.type], label: n.name };
    })
    .filter((e): e is FamilyPanelEntry => e !== null);
}
