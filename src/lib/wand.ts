// Wand — Wizard to ANalyze Data (plan 37): apply an existing table's analyses
// + graphs to a new table, batch over several tables at once (Prism 10 User
// Guide, "Use Wand to analyze and graph just like another table"). Pure, so
// tests/checks.ts drives it directly; the store's `applyWand` action swaps
// the returned content in as one undo step.
import { ANALYSES } from "../stats";
import type { AnalysisType } from "../stats/types";
import { readTable } from "./dataset";
import type { GraphOptions, ProjectNode, TableType } from "../store/types";
import { ANALYSIS_OPTIONS_BY_TABLE } from "../views/analyses";
import { GRAPH_OPTIONS_BY_TABLE } from "../views/graphs";

/** The GraphOptions fields holding a sibling analysis's node id: a copied
 *  graph's links are remapped to the new analysis copies for its target, and
 *  a link whose analysis wasn't copied is dropped, never left dangling. */
export const WAND_LINK_FIELDS = [
  "sigAnalysisId",
  "regAnalysisId",
  "demingAnalysisId",
  "coxAnalysisId",
  "poissonAnalysisId",
  "pcaAnalysisId",
  "kmeansAnalysisId",
  "smoothAnalysisId",
  "monteCarloAnalysisId",
] as const;

/** What a Wand run did, per table — the dialog's alert is built from this. */
export interface WandReport {
  exampleName: string;
  created: {
    tableId: string;
    tableName: string;
    analyses: number;
    graphs: number;
    /** Per-child skips on a table that still received copies (e.g. one test's minColumns). */
    notes: string[];
  }[];
  skipped: { tableId: string; tableName: string; reason: string }[];
}

export interface WandResult {
  nodes: Record<string, ProjectNode>;
  childOrder: Record<string, string[]>;
  /** The first created node, to become the active node (null when nothing was created). */
  firstCreatedId: string | null;
  report: WandReport;
}

interface WandContent {
  nodes: Record<string, ProjectNode>;
  childOrder: Record<string, string[]>;
}

/** The tables that can be a Wand example: data tables with ≥ 1 analysis or
 *  graph child, in sidebar order. `excludeId` (the target the menu was opened
 *  from) is never its own example. */
export function wandExamples(
  nodes: Record<string, ProjectNode>,
  childOrder: Record<string, string[]>,
  rootOrder: string[],
  excludeId?: string,
): ProjectNode[] {
  return rootOrder.flatMap((id) => {
    const table = nodes[id];
    if (!table || table.type !== "table" || table.id === excludeId) return [];
    const hasChildren = (childOrder[table.id] ?? []).some((childId) => {
      const child = nodes[childId];
      return child?.type === "analysis" || child?.type === "graph";
    });
    return hasChildren ? [table] : [];
  });
}

const deepCopy = <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

/** `base`, or `base 2`, `base 3`… when a sibling already has it — the same
 *  rule as the reducer's `create` (see use-project-store.tsx). */
function uniqueName(base: string, taken: string[]): string {
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  return name;
}

/** Whether an analysis of `type` is offered for `tableType`. The picker lists
 *  two meta entries that resolve to real tests: "compare-many-groups" (ANOVA /
 *  Kruskal-Wallis / repeated-measures ANOVA / Friedman) and "interpolate"
 *  (nonlinear regression) — both resolve in use-analysis-launcher.ts. */
function analysisOffered(type: AnalysisType, tableType: TableType): boolean {
  const offered = ANALYSIS_OPTIONS_BY_TABLE[tableType].map((o) => o.value);
  if ((offered as string[]).includes(type)) return true;
  if (offered.includes("compare-many-groups"))
    return type === "anova" || type === "kruskal-wallis" || type === "rm-anova" || type === "friedman";
  if (offered.includes("interpolate")) return type === "nonlinear-regression";
  return false;
}

/** The number of data columns holding numbers — a target with none has no data to analyze. */
function numericColumns(node: ProjectNode): number {
  return node.data ? readTable(node.data).numeric.length : 0;
}

/**
 * Copies the example table's analyses (sidebar order) then graphs (sidebar
 * order) onto each target table. A child is copied only when its test/graph is
 * offered for the target's table type and, for analyses, the target meets its
 * `minColumns` precheck; anything else is skipped with a reason in the report
 * — a target that receives nothing is reported, never silently ignored.
 * Throws a user-facing error when the example table doesn't exist or has no
 * analyses or graphs to copy.
 */
export function applyWand(
  content: WandContent,
  exampleId: string,
  targetIds: string[],
  prefix = "",
  idGen: (type: "analysis" | "graph") => string = (type) =>
    `${type}_${Math.random().toString(36).slice(2, 10)}`,
): WandResult {
  const { nodes, childOrder } = content;
  const example = nodes[exampleId];
  if (!example || example.type !== "table")
    throw new Error("Choose a data table with analyses or graphs to copy from.");
  const exampleChildren = (childOrder[exampleId] ?? []).flatMap((id) => (nodes[id] ? [nodes[id]] : []));
  const analyses = exampleChildren.filter((n) => n.type === "analysis");
  const graphs = exampleChildren.filter((n) => n.type === "graph");
  if (analyses.length + graphs.length === 0)
    throw new Error(`“${example.name}” has no analyses or graphs to copy.`);

  const nextNodes: Record<string, ProjectNode> = { ...nodes };
  const nextChildOrder: Record<string, string[]> = Object.fromEntries(
    Object.entries(childOrder).map(([pid, ids]) => [pid, [...ids]]),
  );
  const report: WandReport = { exampleName: example.name, created: [], skipped: [] };
  let firstCreatedId: string | null = null;

  for (const targetId of [...new Set(targetIds)]) {
    const target = nextNodes[targetId];
    if (!target || target.type !== "table") {
      report.skipped.push({ tableId: targetId, tableName: target?.name ?? targetId, reason: "isn't a data table" });
      continue;
    }
    if (target.id === exampleId) {
      report.skipped.push({ tableId: targetId, tableName: target.name, reason: "is the example table" });
      continue;
    }
    if (numericColumns(target) === 0) {
      report.skipped.push({ tableId: targetId, tableName: target.name, reason: "has no numeric data" });
      continue;
    }
    const targetType = target.tableType ?? "column";
    const taken = (nextChildOrder[targetId] ?? []).map((id) => nextNodes[id]?.name ?? "");
    const createdIds: string[] = [];
    // The example's analysis ids → this target's new copies, for the graphs' links.
    const remap = new Map<string, string>();
    let madeAnalyses = 0;
    let madeGraphs = 0;
    const notes: string[] = [];
    for (const child of analyses) {
      const type = child.analysisType!;
      if (!analysisOffered(type, targetType)) continue;
      const { label, minColumns } = ANALYSES[type];
      if (numericColumns(target) < minColumns) {
        notes.push(`“${label}” needs at least ${minColumns} column${minColumns === 1 ? "" : "s"} with data`);
        continue;
      }
      const id = idGen("analysis");
      const name = uniqueName(`${prefix}${child.name}`, taken);
      taken.push(name);
      nextNodes[id] = {
        id,
        type: "analysis",
        name,
        parentId: targetId,
        analysisType: type,
        ...(child.analysisParams !== undefined ? { analysisParams: deepCopy(child.analysisParams) } : {}),
      };
      createdIds.push(id);
      remap.set(child.id, id);
      madeAnalyses++;
      firstCreatedId ??= id;
    }
    for (const child of graphs) {
      const type = child.graphType!;
      if (!GRAPH_OPTIONS_BY_TABLE[targetType].some((o) => o.value === type)) continue;
      const id = idGen("graph");
      const name = uniqueName(`${prefix}${child.name}`, taken);
      taken.push(name);
      const options: GraphOptions = deepCopy(child.graphOptions ?? ({} as GraphOptions));
      for (const field of WAND_LINK_FIELDS) {
        const linked = options[field];
        if (linked === undefined) continue;
        const copy = remap.get(linked);
        if (copy) options[field] = copy;
        else delete options[field];
      }
      nextNodes[id] = { id, type: "graph", name, parentId: targetId, graphType: type, graphOptions: options };
      createdIds.push(id);
      madeGraphs++;
      firstCreatedId ??= id;
    }
    if (createdIds.length === 0) {
      report.skipped.push({
        tableId: targetId,
        tableName: target.name,
        reason: "none of its analyses or graphs apply to this table type",
      });
      continue;
    }
    nextChildOrder[targetId] = [...(nextChildOrder[targetId] ?? []), ...createdIds];
    report.created.push({
      tableId: targetId,
      tableName: target.name,
      analyses: madeAnalyses,
      graphs: madeGraphs,
      notes,
    });
  }

  return { nodes: nextNodes, childOrder: nextChildOrder, firstCreatedId, report };
}

/** The dialog's post-apply summary: what landed where, and every skip with its reason. */
export function wandReportMessage(report: WandReport): string {
  const lines: string[] = [];
  for (const c of report.created) {
    const parts = [
      c.analyses ? `${c.analyses} ${c.analyses === 1 ? "analysis" : "analyses"}` : "",
      c.graphs ? `${c.graphs} ${c.graphs === 1 ? "graph" : "graphs"}` : "",
    ].filter(Boolean);
    lines.push(`• “${c.tableName}”: ${parts.join(", ")} copied from “${report.exampleName}”.`);
    for (const note of c.notes) lines.push(`  (Not copied: ${note}.)`);
  }
  for (const s of report.skipped) lines.push(`• Skipped “${s.tableName}”: ${s.reason}.`);
  return lines.join("\n") || "Nothing was copied.";
}
