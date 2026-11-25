// Headless flow work for the MCP dispatcher (seq 443, F1c; seq 447, F2a):
// the `import-fcs` job and the `apply-flow-compensation` job — the same
// shape as `mcp-document.ts`'s import jobs, minus everything a human
// does: no path picker, no prompts, no dialog. The Rust reader
// (`flow_import_fcs`) parses the FCS file into the event store; the
// compensation job applies a spillover matrix in the store and records
// it on the sample node. Summaries only — event arrays never cross here,
// and the MCP snapshot publish never carries them either (the sample node
// holds a reference, not data).
//
// Opt-in, off by default: the jobs refuse while the flow toggle is off,
// even if the `flow` allowlist group is enabled — the toggle is the
// module's switch, the group is the AI's permission.

import { parseSpilloverCsv, type ApplyCompensationInput, type FlowCompensationState } from "../flow/compensation";
import { isFlowEnabled } from "../flow/feature-flag";
import { buildFlowSampleRef, importFcs, type FcsImportSummary } from "../flow/fcs";
import type { FlowCompensationRef, FlowSampleRef } from "../flow/sample";
import { createFlowStore } from "../flow/store";
import type { DocumentState } from "./mcp-document";

/** What the flow jobs need, injectable so a harness can drive them
 *  without a webview (defaults: the real store actions + Tauri commands). */
export interface FlowJobDeps {
  getState: () => DocumentState;
  /** The store's `createFlowSample` action (default: the real one). */
  createFlowSample?: (ref: FlowSampleRef) => string;
  /** The store's `updateFlowSampleCompensation` action (seq 447;
   *  default: the real one). */
  updateFlowSampleCompensation?: (sampleId: string, compensation: FlowCompensationRef) => void;
  /** The importer (default: the real `flow_import_fcs` Tauri command). */
  importFcs?: (path: string, sampleId?: string, name?: string) => Promise<FcsImportSummary>;
  /** Apply a spillover matrix in the event store (seq 447; default: the
   *  real store — the Rust store in the app, in-memory in a harness). */
  applyCompensation?: (sampleId: string, input: ApplyCompensationInput) => Promise<FlowCompensationState>;
  /** Wait for the store to settle after a dispatch (see mcp-dispatch.ts). */
  flushUntilRevision?: (before: number) => Promise<void>;
  flush?: () => Promise<void>;
}

/** The `import-fcs` job's args, as Rust sends them (snake_case, nulls for
 *  absent `Option`s). */
export interface ImportFcsJobArgs {
  path?: unknown;
  sample_id?: unknown;
  name?: unknown;
}

function optString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Job argument “${name}” must be a string.`);
  return value;
}

function reqString(value: unknown, name: string): string {
  const found = optString(value, name);
  if (found === undefined || found === "") throw new Error(`Job argument “${name}” is required.`);
  return found;
}

function reqStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string" || v === "")) {
    throw new Error(`Job argument “${name}” must be a non-empty array of names.`);
  }
  return value as string[];
}

function reqNumberMatrix(value: unknown, name: string): number[][] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Job argument “${name}” must be a non-empty array of rows.`);
  }
  return value.map((row, i) => {
    if (!Array.isArray(row) || row.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error(`Job argument “${name}” row ${i + 1} must hold only finite numbers.`);
    }
    return row as number[];
  });
}

/** Import one FCS file as a sample node in this project. Returns the
 *  import summary (counts, parameter names, spillover presence,
 *  normalisations, warnings) — never event arrays. */
export async function executeImportFcs(
  deps: FlowJobDeps,
  args: ImportFcsJobArgs,
  projectId: string,
): Promise<{ result: unknown; created?: Record<string, unknown> }> {
  if (!isFlowEnabled()) {
    throw new Error(
      "The FlowJo module is off — turn it on in Settings before importing an FCS file.",
    );
  }
  const path = reqString(args.path, "path");
  const sampleId = optString(args.sample_id, "sample_id");
  const name = optString(args.name, "name");
  if (name !== undefined && !name.trim()) throw new Error("The sample name must not be empty.");
  const create =
    deps.createFlowSample ??
    (() => {
      throw new Error("This window can't create a flow sample (no createFlowSample).");
    });
  const importer = deps.importFcs ?? importFcs;
  const summary = await importer(path, sampleId, name);
  const ref = buildFlowSampleRef(summary);
  const beforeRevision = deps.getState().revision;
  const sampleNodeId = create(ref);
  if (deps.flushUntilRevision) await deps.flushUntilRevision(beforeRevision);
  else await deps.flush?.();
  const after = deps.getState();
  const created = after.nodes[sampleNodeId];
  if (!created || created.type !== "sample") {
    throw new Error(
      "Imported the FCS file but its sample node could not be read back — ask titer_list_projects for the new sample.",
    );
  }
  return {
    result: {
      project_id: projectId,
      sample_id: summary.sampleId,
      name: summary.name,
      source_path: summary.sourcePath,
      version: summary.version,
      event_count: summary.eventCount,
      parameters: summary.parameters.map((p) => p.name),
      datasets: summary.datasets,
      has_spillover: summary.spillover !== null && summary.spillover !== undefined,
      normalisations: summary.normalisations,
      warnings: summary.warnings,
    },
    created: { sample_id: sampleNodeId },
  };
}

/** The `apply-flow-compensation` job's args, as Rust sends them
 *  (snake_case, nulls for absent `Option`s). */
export interface ApplyFlowCompensationJobArgs {
  sample_id?: unknown;
  source?: unknown;
  fluorochromes?: unknown;
  matrix?: unknown;
  matrix_csv?: unknown;
}

/** Apply a spillover matrix to one sample's stored events (seq 447).
 *  The matrix comes from the sample's own file record (`source:
 *  "file"`, the default), a FlowJo-style CSV/TSV matrix text (`source:
 *  "csv"`, `matrix_csv`), or an explicit fluorochrome list + matrix
 *  (`source: "manual"`). The store apply recomputes from RAW, so
 *  re-applying with an edited matrix never double-compensates; the
 *  sample node records the applied matrix + `applied: true`. Returns a
 *  summary only — never event arrays. */
export async function executeApplyFlowCompensation(
  deps: FlowJobDeps,
  args: ApplyFlowCompensationJobArgs,
  projectId: string,
): Promise<{ result: unknown; created?: Record<string, unknown> }> {
  if (!isFlowEnabled()) {
    throw new Error(
      "The FlowJo module is off — turn it on in Settings before applying compensation.",
    );
  }
  const sampleId = reqString(args.sample_id, "sample_id");
  const source = optString(args.source, "source") ?? "file";
  if (source !== "file" && source !== "csv" && source !== "manual") {
    throw new Error(`Job argument “source” must be "file", "csv" or "manual".`);
  }
  // Resolve the matrix, by source.
  let fluorochromes: string[];
  let matrix: number[][];
  if (source === "file") {
    const node = deps.getState().nodes[sampleId];
    const ref = node?.type === "sample" ? node.flowSample : undefined;
    const comp = ref?.compensation;
    if (!comp) {
      throw new Error(
        `Sample “${sampleId}” has no spillover matrix — import an FCS file that carries $SPILLOVER, or pass a matrix explicitly (source "csv" or "manual").`,
      );
    }
    fluorochromes = comp.fluorochromes;
    matrix = comp.spillover;
  } else if (source === "csv") {
    const parsed = parseSpilloverCsv(reqString(args.matrix_csv, "matrix_csv"));
    fluorochromes = parsed.fluorochromes;
    matrix = parsed.matrix;
  } else {
    fluorochromes = reqStringArray(args.fluorochromes, "fluorochromes");
    matrix = reqNumberMatrix(args.matrix, "matrix");
  }
  const apply =
    deps.applyCompensation ??
    ((id: string, input: ApplyCompensationInput) => createFlowStore().applyCompensation(id, input));
  const state = await apply(sampleId, { fluorochromes, matrix, source });
  // Record the applied matrix on the sample node — the project's record
  // of what the stored events now are.
  const update =
    deps.updateFlowSampleCompensation ??
    (() => {
      throw new Error("This window can't update a flow sample (no updateFlowSampleCompensation).");
    });
  const beforeRevision = deps.getState().revision;
  update(sampleId, {
    fluorochromes: [...state.fluorochromes],
    spillover: state.spillover,
    source,
    applied: true,
  });
  if (deps.flushUntilRevision) await deps.flushUntilRevision(beforeRevision);
  else await deps.flush?.();
  const after = deps.getState();
  const node = after.nodes[sampleId];
  if (!node || node.type !== "sample" || node.flowSample?.compensation?.applied !== true) {
    throw new Error(
      "Applied compensation but the sample node could not be read back — ask titer_list_projects for the sample.",
    );
  }
  return {
    result: {
      project_id: projectId,
      sample_id: sampleId,
      fluorochromes: state.fluorochromes,
      source,
      applied: true,
      event_count: node.flowSample.eventCount,
      parameters_compensated: state.fluorochromes.length,
    },
  };
}
