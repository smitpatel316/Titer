// FlowJo track, seq 441 (F1a): the derived summary-table bridge.
//
// The bridge from the event store into the machinery Titer already has:
// per-sample (or per-experiment) stats become an ordinary `TableData` —
// one row per sample, one min/max/mean column triple per parameter — which
// a later lane can hand to the descriptive-statistics runner, the graph
// builders and the export pipeline exactly like any other table. The bridge
// only ever carries aggregates: no event ever passes through it, and the
// summary node it builds names its samples in `flowSourceSampleIds` so the
// link back to the store stays explicit.

import type { ProjectNode, TableData } from "../store/types";
import type { FlowSampleRef } from "./sample";
import type { FlowSampleStats } from "./store";

/** A number as a table cell reads it: integers plain, other values to six
 *  significant figures (a summary table is read by eye and by the stats
 *  runner, not bit-compared). Null stays null. */
export function formatFlowValue(value: number | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

const STAT_KINDS = ["min", "max", "mean"] as const;

function statColumns(paramName: string): string[] {
  return STAT_KINDS.map((kind) => `${paramName} ${kind}`);
}

function statCells(
  paramName: string,
  byName: Map<string, { min: number | null; max: number | null; mean: number | null }>,
): (string | null)[] {
  const stat = byName.get(paramName);
  if (!stat) return [null, null, null];
  return [formatFlowValue(stat.min), formatFlowValue(stat.max), formatFlowValue(stat.mean)];
}

/** One sample's stats as an ordinary table: one row, the sample's name and
 *  event count first, then a min/max/mean triple per parameter. */
export function buildSampleSummaryTable(ref: FlowSampleRef, stats: FlowSampleStats): TableData {
  return buildExperimentSummaryTable([{ ref, stats }]);
}

/** Several samples' stats as one ordinary table: one row per sample, the
 *  parameter set the union across samples (first-seen order), a sample
 *  without a parameter reading null in that parameter's columns. */
export function buildExperimentSummaryTable(
  entries: readonly { ref: FlowSampleRef; stats: FlowSampleStats }[],
): TableData {
  const paramNames: string[] = [];
  for (const { stats } of entries) {
    for (const p of stats.params) if (!paramNames.includes(p.name)) paramNames.push(p.name);
  }
  const columns = ["Sample", "Events", ...paramNames.flatMap(statColumns)];
  const rows = entries.map(({ ref, stats }) => {
    const byName = new Map(stats.params.map((p) => [p.name, p]));
    return [ref.name, String(stats.eventCount), ...paramNames.flatMap((name) => statCells(name, byName))] as (
      string | null
    )[];
  });
  return { columns, rows };
}

/** The summary table as a project node: an ordinary Column table, at the
 *  project root, naming the samples it summarizes in
 *  `flowSourceSampleIds`. Later lanes repoint it at the store when a sample
 *  reloads; nothing here holds events. */
export function createSummaryTableNode(
  id: string,
  name: string,
  table: TableData,
  sampleIds: readonly string[],
): ProjectNode {
  return {
    id,
    type: "table",
    name,
    parentId: null,
    tableType: "column",
    data: table,
    flowSourceSampleIds: [...sampleIds],
  };
}
