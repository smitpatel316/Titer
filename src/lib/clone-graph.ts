// Clone a graph — Prism's "Clone a graph" (GraphPad Prism 10 User Guide):
// duplicate a graph along with its data table and the results included on
// that graph, to start a new project from a formatted example. Enter new
// data, and it is graphed the same way.
//
// What comes along: the graph itself (every display option, its series and
// point styles), its data table, and the analyses embedded on the graph —
// the ones its options link to (a regression line, a significance bracket,
// a fitted curve…). An analysis linked to the table but not shown on the
// graph stays behind, exactly as in Prism. A link to an analysis under
// another table is not part of this family either: it keeps pointing at the
// original. A link whose analysis is gone is dropped, so the clone stands
// on its own.
//
// What the data looks like after: Prism asks which data and titles to
// delete. By default the Y values go, and the X values and titles stay —
// so the clone is a formatted, empty frame waiting for new numbers.

import { hasXColumn, type GraphOptions, type NodeType, type ProjectNode, type TableData, type TableType } from "../store/types";

/** Which data and titles the clone keeps: Prism's defaults delete the Y
 *  values and keep the X values and titles. */
export interface CloneOptions {
  clearY: boolean;
  clearX: boolean;
  clearTitles: boolean;
}

export const DEFAULT_CLONE_OPTIONS: CloneOptions = { clearY: true, clearX: false, clearTitles: false };

/** The graph options that hold an embedded analysis: the analyses a graph
 *  draws from. A clone copies the ones these name (when they belong to the
 *  graph's own table) and re-points the copy at them. */
export const GRAPH_ANALYSIS_LINKS = [
  "sigAnalysisId",
  "regAnalysisId",
  "demingAnalysisId",
  "coxAnalysisId",
  "poissonAnalysisId",
  "pcaAnalysisId",
  "kmeansAnalysisId",
  "hclustAnalysisId",
  "smoothAnalysisId",
  "monteCarloAnalysisId",
] as const satisfies readonly (keyof GraphOptions)[];

export interface ClonePlan {
  /** Only the new nodes: the table, the graph, and the embedded analyses. */
  nodes: Record<string, ProjectNode>;
  /** The whole root order, with the new table right after the original. */
  rootOrder: string[];
  /** The whole child order, with the new table's children in the original's order. */
  childOrder: Record<string, string[]>;
  /** The cloned graph: what the clone opens on. */
  activeNodeId: string;
}

export type ClonePlanResult = { plan: ClonePlan } | { error: string };

/** A plain JSON value, copied so the clone never shares a reference with
 *  the original (editing one must never move the other). */
function deepCopy<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/** `base`, or `base 2`, `base 3`… when a sibling already has it. */
function uniqueName(base: string, taken: string[]): string {
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  return name;
}

const defaultNextId = (type: NodeType | "note") => `${type}_${Math.random().toString(36).slice(2, 10)}`;

/** The cloned table's data, with the values the options say to delete
 *  emptied. Column 0 holds the row titles; on an XY or Survival table
 *  column 1 holds the X values and the rest are Y. A table with no X column
 *  has only Y values, so clearing Y empties every data cell. Exclusions
 *  point at cells that are gone, so they go with the values. */
function clearedData(data: TableData, tableType: TableType, options: CloneOptions): TableData {
  const copy = deepCopy(data);
  const xCol = hasXColumn(tableType) ? 1 : -1;
  copy.rows = copy.rows.map((row) =>
    row.map((cell, i) => {
      if (i === 0) return options.clearTitles ? null : cell;
      if (i === xCol) return options.clearX ? null : cell;
      return options.clearY ? null : cell;
    }),
  );
  if (options.clearY || options.clearX) delete copy.excluded;
  return copy;
}

/**
 * Plans cloning a graph: the new nodes, the orders with them in place, and
 * the node to show. Pure — the store dispatches the plan as one undoable
 * "Clone Graph" step, and the tests drive this directly. Returns an error
 * when the graph (or its table) isn't there to clone.
 */
export function cloneGraphPlan(
  content: {
    nodes: Record<string, ProjectNode>;
    rootOrder: string[];
    childOrder: Record<string, string[]>;
  },
  graphId: string,
  options: CloneOptions,
  nextId: (type: NodeType | "note") => string = defaultNextId,
): ClonePlanResult {
  const { nodes, rootOrder, childOrder } = content;
  const graph = nodes[graphId];
  if (!graph) return { error: `No graph “${graphId}” to clone.` };
  if (graph.type !== "graph") return { error: `“${graph.name}” is a ${graph.type}, not a graph.` };
  const table = graph.parentId ? nodes[graph.parentId] : undefined;
  if (!table || table.type !== "table") return { error: `The graph “${graph.name}” has no data table to clone.` };

  const newTableId = nextId("table");
  const newTable: ProjectNode = {
    ...deepCopy(table),
    id: newTableId,
    name: uniqueName(
      table.name,
      rootOrder.map((id) => nodes[id]?.name ?? ""),
    ),
    floatingNotes: table.floatingNotes?.map((note) => ({ ...note, id: nextId("note") })),
    data: table.data ? clearedData(table.data, table.tableType ?? "column", options) : undefined,
  };
  if (!newTable.floatingNotes?.length) delete newTable.floatingNotes;

  // The analyses embedded on the graph: linked from its options and
  // children of the same table, in the table's own order. The rest of the
  // table's analyses stay behind.
  const linked = new Set<string>();
  for (const field of GRAPH_ANALYSIS_LINKS) {
    const id = graph.graphOptions?.[field];
    if (typeof id === "string") linked.add(id);
  }
  const idMap = new Map<string, string>();
  const clonedNodes: Record<string, ProjectNode> = { [newTableId]: newTable };
  for (const childId of childOrder[table.id] ?? []) {
    const child = nodes[childId];
    if (!child || child.type !== "analysis" || !linked.has(childId)) continue;
    const newId = nextId("analysis");
    idMap.set(childId, newId);
    const cloned: ProjectNode = {
      ...deepCopy(child),
      id: newId,
      parentId: newTableId,
      floatingNotes: child.floatingNotes?.map((note) => ({ ...note, id: nextId("note") })),
    };
    if (!cloned.floatingNotes?.length) delete cloned.floatingNotes;
    clonedNodes[newId] = cloned;
  }

  const newGraphId = nextId("graph");
  idMap.set(graphId, newGraphId);
  const newOptions = graph.graphOptions ? deepCopy(graph.graphOptions) : undefined;
  if (newOptions) {
    for (const field of GRAPH_ANALYSIS_LINKS) {
      const id = newOptions[field];
      if (typeof id !== "string") continue;
      if (idMap.has(id)) newOptions[field] = idMap.get(id)!;
      // A link to an analysis under another table keeps pointing at the
      // original; a link whose analysis is gone is dropped.
      else if (!nodes[id]) delete newOptions[field];
    }
  }
  const newGraph: ProjectNode = {
    ...deepCopy(graph),
    id: newGraphId,
    parentId: newTableId,
    graphOptions: newOptions,
    floatingNotes: graph.floatingNotes?.map((note) => ({ ...note, id: nextId("note") })),
  };
  if (!newGraph.floatingNotes?.length) delete newGraph.floatingNotes;
  clonedNodes[newGraphId] = newGraph;

  const at = rootOrder.indexOf(table.id);
  const newRootOrder = [...rootOrder.slice(0, at + 1), newTableId, ...rootOrder.slice(at + 1)];
  const newChildOrder = {
    ...childOrder,
    [newTableId]: (childOrder[table.id] ?? []).flatMap((id) => (idMap.has(id) ? [idMap.get(id)!] : [])),
  };
  return { plan: { nodes: clonedNodes, rootOrder: newRootOrder, childOrder: newChildOrder, activeNodeId: newGraphId } };
}
