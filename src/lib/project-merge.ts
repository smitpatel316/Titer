// File ▸ Merge (seq 180): append another project's sheets to this one.
// Prism 10 User Guide, "Merging and splitting projects": File ▸ Merge
// appends all sheets from another project file to the current one, and
// "Prism places an asterisk (*) in front of the name of each merged sheet."
// Pure: no React, no native calls, so checks.ts pins it without a window.
// The store's `mergeProject` action applies the result as one undo step.

import { MAX_INFO_SHEETS } from "./info-sheets";
import { GRAPH_ANALYSIS_ID_KEYS } from "./template";
import type { GraphOptions, NodeType, ProjectNode } from "../store/types";

/** The project content a merge works on: the store's Content, without the
 *  undo history. Both the current project and the incoming file are read
 *  as this shape. */
export interface MergeInput {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
}

/** What the merge did, for the notice (and the MCP tool's output). */
export interface MergeReport {
  sourceName: string;
  /** Merged sheets' new names, in file order, by kind. */
  tables: string[];
  analyses: string[];
  graphs: string[];
  figures: string[];
  infoSheets: string[];
  /** A sheet whose `* ` name was itself taken, and the numbered name it
   *  took instead. The asterisk prefix alone is not a rename — every
   *  merged sheet gets it, by Prism's rule. */
  renamed: { from: string; to: string }[];
  /** Sheets left out, and why. */
  skipped: { name: string; reason: string }[];
  /** Links dropped because what they pointed at isn't in the incoming
   *  file (a graph's analysis link, a figure panel, an info sheet's table,
   *  a computed table's source) — named, never silently swallowed. */
  dropped: string[];
}

export type MergeResult = MergeInput & { report: MergeReport };

/** A fresh id, unlike any id the current project or the incoming file
 *  already uses. The `merge` marker says where the sheet came from when
 *  an id shows up in a log. */
const genMergeId = (type: NodeType, taken: Set<string>): string => {
  let id = "";
  do {
    id = `${type}_merge_${Math.random().toString(36).slice(2, 10)}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
};

/** The merged sheet's name: Prism's asterisk in front, then a number when
 *  even that name is taken (`* Doses 2`, `* Doses 3`, … — the store's
 *  `uniqueName` convention). `taken` holds every name in use so far. */
const mergeName = (base: string, taken: Set<string>): { name: string; renamed: boolean } => {
  const starred = `* ${base}`;
  if (!taken.has(starred)) {
    taken.add(starred);
    return { name: starred, renamed: false };
  }
  let name = starred;
  for (let i = 2; taken.has(name); i++) name = `${starred} ${i}`;
  taken.add(name);
  return { name, renamed: true };
};

/** `options` with its analysis links remapped through `idMap` (old id →
 *  new id); a link whose analysis isn't in the incoming file is dropped
 *  and named with the id it pointed at, so the report can say so. The
 *  input is never mutated. (Unlike `remapGraphOptions`, which only names
 *  the dropped key — the merge report names the missing analysis too.) */
const remapGraphOptionsForMerge = (
  options: GraphOptions | undefined,
  idMap: Record<string, string>,
): { options: GraphOptions | undefined; dropped: string[] } => {
  if (!options) return { options, dropped: [] };
  const next = { ...options };
  const dropped: string[] = [];
  for (const key of GRAPH_ANALYSIS_ID_KEYS) {
    const id = (next as unknown as Record<string, unknown>)[key];
    if (typeof id !== "string") continue;
    if (idMap[id]) (next as unknown as Record<string, unknown>)[key] = idMap[id];
    else {
      delete (next as unknown as Record<string, unknown>)[key];
      dropped.push(id);
    }
  }
  return { options: next, dropped };
};

/**
 * Append `incoming`'s sheets to `current`'s, Prism's way: every incoming
 * sheet keeps its links (re-parented to the merged copies), takes a fresh
 * id, and is renamed with an asterisk in front. The current project is
 * untouched — its names, ids and active sheet stay exactly as they were.
 * The merged root order keeps the file invariant (tables, then info
 * sheets, then figures, then orphaned analyses — see
 * `parseProjectFile`): current tables + incoming tables, current infos +
 * incoming infos, current figures + incoming figures, orphans last.
 * Neither input is mutated.
 */
export function mergeProjects(current: MergeInput, incoming: MergeInput, sourceName: string): MergeResult {
  const nodes: Record<string, ProjectNode> = { ...current.nodes };
  const childOrder: Record<string, string[]> = {};
  for (const [pid, ids] of Object.entries(current.childOrder)) childOrder[pid] = [...ids];

  const report: MergeReport = {
    sourceName,
    tables: [],
    analyses: [],
    graphs: [],
    figures: [],
    infoSheets: [],
    renamed: [],
    skipped: [],
    dropped: [],
  };
  const byKind = (type: NodeType): string[] =>
    type === "table"
      ? report.tables
      : type === "analysis"
        ? report.analyses
        : type === "graph"
          ? report.graphs
          : type === "figure"
            ? report.figures
            : report.infoSheets;

  // Pass 1 — ids and names for every incoming sheet, before any link is
  // remapped (a graph's link may point at an analysis processed later).
  // Root sheets in the file's order, each table's children right after
  // it, so two sheets sharing a name resolve in file order.
  const takenIds = new Set<string>([...Object.keys(current.nodes), ...Object.keys(incoming.nodes)]);
  const takenNames = new Set<string>(Object.values(current.nodes).map((n) => n.name));
  const idMap: Record<string, string> = {};
  const newNames: Record<string, string> = {};
  const infoCap = Object.values(current.nodes).filter((n) => n.type === "info").length;
  let infosMerged = 0;
  const skippedIds = new Set<string>();
  const visitOrder: ProjectNode[] = [];
  for (const id of incoming.rootOrder) {
    const node = incoming.nodes[id];
    if (!node || node.parentId !== null) continue;
    visitOrder.push(node);
    if (node.type === "table") {
      for (const childId of incoming.childOrder[id] ?? []) {
        const child = incoming.nodes[childId];
        if (child && child.parentId === id) visitOrder.push(child);
      }
    }
  }
  for (const node of visitOrder) {
    if (node.type === "info" && infoCap + infosMerged >= MAX_INFO_SHEETS) {
      skippedIds.add(node.id);
      report.skipped.push({
        name: node.name,
        reason: `the project already holds the maximum of ${MAX_INFO_SHEETS} info sheets`,
      });
      continue;
    }
    idMap[node.id] = genMergeId(node.type, takenIds);
    const { name, renamed } = mergeName(node.name, takenNames);
    newNames[node.id] = name;
    if (renamed) report.renamed.push({ from: node.name, to: name });
    if (node.type === "info") infosMerged++;
  }

  // Pass 2 — copy each sheet with its links remapped to the fresh ids.
  // A child whose table isn't in the file (or was skipped) is left out and
  // named; a well-formed file never has one — `parseProjectFile` prunes
  // them on read — but a merge never silently swallows a sheet.
  const mergedTables: string[] = [];
  const mergedInfos: string[] = [];
  const mergedFigures: string[] = [];
  const mergedOrphans: string[] = [];
  for (const node of visitOrder) {
    if (skippedIds.has(node.id)) continue;
    if (node.type !== "table" && node.type !== "info" && node.type !== "figure" && node.parentId === null && !node.orphaned) {
      // A root analysis that isn't orphaned has no table to belong to.
      skippedIds.add(node.id);
      report.skipped.push({ name: node.name, reason: "its table isn't in the file" });
      continue;
    }
    if ((node.type === "analysis" || node.type === "graph") && node.parentId !== null && !idMap[node.parentId]) {
      skippedIds.add(node.id);
      report.skipped.push({ name: node.name, reason: "its table isn't in the file" });
      continue;
    }
    const copy: ProjectNode = JSON.parse(JSON.stringify(node)) as ProjectNode;
    copy.id = idMap[node.id];
    copy.name = newNames[node.id];
    copy.parentId = node.parentId === null ? null : (idMap[node.parentId] ?? null);
    if (node.transform) {
      if (idMap[node.transform.from]) copy.transform = { ...node.transform, from: idMap[node.transform.from] };
      else {
        delete copy.transform;
        report.dropped.push(
          `“${copy.name}” — dropped its link to its source table (it isn't in the file), so its values stay as they are.`,
        );
      }
    }
    if (node.info?.linkedTableId) {
      if (idMap[node.info.linkedTableId]) copy.info = { ...node.info, linkedTableId: idMap[node.info.linkedTableId] };
      else {
        copy.info = { ...node.info, linkedTableId: null };
        report.dropped.push(
          `“${copy.name}” — dropped its link to its table (it isn't in the file), so it is project info now.`,
        );
      }
    }
    if (node.graphOptions) {
      const { options, dropped } = remapGraphOptionsForMerge(node.graphOptions, idMap);
      copy.graphOptions = options;
      for (const missing of dropped) {
        report.dropped.push(
          `“${copy.name}” — dropped its link to analysis “${missing}” (it isn't in the file).`,
        );
      }
    }
    if (node.panels) {
      const panels = node.panels.flatMap((panel) => {
        if (idMap[panel.graphId]) return [{ ...panel, graphId: idMap[panel.graphId] }];
        report.dropped.push(
          `“${copy.name}” — dropped the panel for graph “${panel.graphName ?? panel.graphId}” (it isn't in the file).`,
        );
        return [];
      });
      copy.panels = panels;
    }
    nodes[copy.id] = copy;
    byKind(copy.type).push(copy.name);
    if (copy.type === "table") {
      mergedTables.push(copy.id);
      childOrder[copy.id] = (incoming.childOrder[node.id] ?? [])
        .filter((childId) => idMap[childId] && !skippedIds.has(childId))
        .map((childId) => idMap[childId]);
    } else if (copy.type === "info") mergedInfos.push(copy.id);
    else if (copy.type === "figure") mergedFigures.push(copy.id);
    else if (copy.type === "analysis" && copy.parentId === null) mergedOrphans.push(copy.id);
  }

  const rootOf = (type: "table" | "info" | "figure" | "analysis") =>
    current.rootOrder.filter((id) => current.nodes[id]?.type === type);
  // Root analyses are the orphaned ones (a live analysis belongs to a table).
  const rootOrder = [
    ...rootOf("table"),
    ...mergedTables,
    ...rootOf("info"),
    ...mergedInfos,
    ...rootOf("figure"),
    ...mergedFigures,
    ...rootOf("analysis"),
    ...mergedOrphans,
  ];
  return { nodes, rootOrder, childOrder, activeNodeId: current.activeNodeId, report };
}

/** The report the merge notice shows (same shape as the Prism-import
 *  report): what merged, then what was renamed to avoid a duplicate name,
 *  skipped, or dropped — and why. */
export function formatMergeReport(report: MergeReport): string {
  const total =
    report.tables.length + report.analyses.length + report.graphs.length + report.figures.length + report.infoSheets.length;
  const lines = [
    `Merged ${total} sheet${total === 1 ? "" : "s"} from “${report.sourceName}”:`,
    ...report.tables.map((n) => `• ${n}`),
    ...report.analyses.map((n) => `• ${n}`),
    ...report.graphs.map((n) => `• ${n}`),
    ...report.figures.map((n) => `• ${n}`),
    ...report.infoSheets.map((n) => `• ${n}`),
  ];
  if (report.renamed.length) {
    lines.push("", "Renamed to avoid a duplicate name:", ...report.renamed.map((r) => `• “${r.from}” → “${r.to}”`));
  }
  if (report.skipped.length) {
    lines.push("", "Skipped:", ...report.skipped.map((s) => `• ${s.name} — ${s.reason}`));
  }
  if (report.dropped.length) {
    lines.push("", "Dropped links:", ...report.dropped.map((d) => `• ${d}`));
  }
  return lines.join("\n");
}
