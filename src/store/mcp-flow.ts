// Headless flow work for the MCP dispatcher (seq 443, F1c): the
// `import-fcs` job — the same shape as `mcp-document.ts`'s import jobs,
// minus everything a human does: no path picker, no prompts, no dialog.
// The Rust reader (`flow_import_fcs`) parses the FCS file into the event
// store; this module only adds the sample node to the project and returns
// the import summary. Summaries only — event arrays never cross here, and
// the MCP snapshot publish never carries them either (the sample node
// holds a reference, not data).
//
// Opt-in, off by default: the job refuses while the flow toggle is off,
// even if the `flow` allowlist group is enabled — the toggle is the
// module's switch, the group is the AI's permission.

import { buildFlowSampleRef, importFcs, type FcsImportSummary } from "../flow/fcs";
import { isFlowEnabled } from "../flow/feature-flag";
import type { FlowSampleRef } from "../flow/sample";
import type { DocumentState } from "./mcp-document";

/** What the `import-fcs` job needs, injectable so a harness can drive it
 *  without a webview (defaults: the real store action + Tauri command). */
export interface FlowJobDeps {
  getState: () => DocumentState;
  /** The store's `createFlowSample` action (default: the real one). */
  createFlowSample?: (ref: FlowSampleRef) => string;
  /** The importer (default: the real `flow_import_fcs` Tauri command). */
  importFcs?: (path: string, sampleId?: string, name?: string) => Promise<FcsImportSummary>;
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
