// FlowJo track, seq 443 (F1c): the FCS import surface (TS side).
//
// The Rust reader (`src-tauri/src/flow.rs`, `flow_import_fcs` command)
// parses an FCS file into the event store; this module is the TS half:
// the summary shape the command returns, the invoke client, and the
// builder that turns a summary into the sample node the project holds
// (`FlowSampleRef`, `src/flow/sample.ts`). Event data never crosses here
// — only the summary (counts, parameter names, spillover matrix).
//
// Opt-in, off by default: `importFcs` itself does not check the toggle
// (the MCP dispatch branch does, and there is no menu/UI entry yet);
// the function is only reachable through the flow-gated paths.

import type { FlowSampleInfo } from "./store";
import type { FlowSampleRef } from "./sample";

/** One parameter, as the import summary reports it. */
export interface FcsImportParameter {
  name: string;
  bits: number;
  range: number;
  stain?: string;
}

/** One dataset in the file's `$NEXTDATA` chain. */
export interface FcsImportDataset {
  index: number;
  parameters: number;
  events: number;
}

/** The spillover matrix the file carries — reported, never applied. */
export interface FcsImportSpillover {
  fluorochromes: string[];
  rows: number;
  cols: number;
  matrix: number[][];
}

/** What the Rust `flow_import_fcs` command returns (camelCase wire
 *  format — see the `rename_all = "camelCase"` on the Rust structs). */
export interface FcsImportSummary {
  sampleId: string;
  name: string;
  sourcePath: string;
  version: string;
  eventCount: number;
  parameters: FcsImportParameter[];
  datasets: FcsImportDataset[];
  spillover?: FcsImportSpillover | null;
  instrument?: string | null;
  normalisations: string[];
  warnings: string[];
  store: FlowSampleInfo;
}

/** Import one FCS file into the Rust event store, via the Tauri command.
 *  `sampleId` / `name` override the derived defaults. The `@tauri-apps/api`
 *  import is dynamic so this module also loads in node (tests) and in
 *  plain web dev, where the command does not exist. */
export async function importFcs(
  path: string,
  sampleId?: string,
  name?: string,
): Promise<FcsImportSummary> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<FcsImportSummary>("flow_import_fcs", {
    path,
    sample_id: sampleId ?? null,
    name: name ?? null,
  });
}

/** The project-side reference for an imported sample: the sample node
 *  the import creates, pointing at the FCS file (the events live in the
 *  store, never in the `.hlx` JSON). The node id and the sample id are
 *  the same by convention (seq 441). */
export function buildFlowSampleRef(summary: FcsImportSummary): FlowSampleRef {
  const ref: FlowSampleRef = {
    sampleId: summary.sampleId,
    sourcePath: summary.sourcePath,
    sourceKind: "fcs",
    name: summary.name,
    eventCount: summary.eventCount,
    parameters: summary.parameters.map((p) => ({
      name: p.name,
      ...(p.stain ? { stain: p.stain } : {}),
      ...(p.range > 0 ? { range: p.range } : {}),
      ...(p.bits > 0 ? { bits: p.bits } : {}),
    })),
    ...(summary.instrument ? { instrument: summary.instrument } : {}),
    ...(summary.spillover
      ? {
          compensation: {
            fluorochromes: summary.spillover.fluorochromes,
            spillover: summary.spillover.matrix,
            source: "file" as const,
            applied: false,
          },
        }
      : {}),
  };
  return ref;
}
