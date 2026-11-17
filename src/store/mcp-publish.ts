// Publishes this window's project to the Rust MCP server, so its read-only
// tools serve what is open — the same data the UI shows (see
// src-tauri/src/mcp.rs). The Rust side cannot read the TS store directly,
// so the frontend pushes a snapshot on every content change (debounced:
// typing a cell fires many revisions) and drops it when the window closes.
// A no-op where there is no native shell (web preview, tests).
import * as React from "react";
import { isNative, mcpPublishResult, mcpPublishSnapshot } from "../native";
import type { DocumentState } from "./mcp-document";
import { useProjectStore } from "./use-project-store";

/** The snapshot payload for one publish: the fields Rust serves. Shared by
 *  the debounced publisher below and the immediate post-job publish
 *  (`publishMcpSnapshotNow`). */
function snapshotPayload(
  s: Pick<DocumentState, "filePath" | "revision" | "isDirty" | "nodes" | "rootOrder" | "childOrder" | "activeNodeId">,
) {
  return {
    filePath: s.filePath,
    revision: s.revision,
    // The cloud upload tools refuse a dirty project (L9): the snapshot
    // carries the flag so Rust can see it.
    isDirty: s.isDirty,
    nodes: s.nodes,
    rootOrder: s.rootOrder,
    childOrder: s.childOrder,
    activeNodeId: s.activeNodeId,
  };
}

/** Publish this window's project to the Rust MCP server right now, without
 *  waiting out the 500 ms debounce — called after each completed MCP job
 *  (see store/mcp-dispatch.ts), so the next tool call sees post-job state
 *  instead of the pre-edit snapshot (v1.6 race fix). Never throws; a
 *  no-op where there is no native shell (web preview, tests). */
export function publishMcpSnapshotNow(
  s: Pick<DocumentState, "filePath" | "revision" | "isDirty" | "nodes" | "rootOrder" | "childOrder" | "activeNodeId">,
) {
  return mcpPublishSnapshot(snapshotPayload(s)).catch(() => {});
}

export function useMcpSnapshotPublisher() {
  const store = useProjectStore();
  // The store value is memoised on the state, so it changes identity on
  // every content change (edits, reorders, loads) and on nothing else that
  // matters — the snapshot is read fresh through get() at publish time.
  React.useEffect(() => {
    if (!isNative) return;
    const timer = setTimeout(() => {
      const s = store.get();
      void mcpPublishSnapshot(snapshotPayload(s)).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [store]);
  // A closed window's project leaves the server's list (its results go too).
  React.useEffect(
    () => () => {
      if (!isNative) return;
      void mcpPublishSnapshot({ closed: true }).catch(() => {});
    },
    [],
  );
}

/** An analysis outcome, for `titer_read_results` — called by the analysis
 *  view when its run lands (success or error), and by the run-analysis job.
 *  Only results computed in this session are ever served; nothing is
 *  invented for an unrun analysis. Returns the publish promise so a job can
 *  await it: the result must be in the server's map before the job reports
 *  done (v1.6 F7). Never rejects. */
export function publishAnalysisResult(analysisId: string, outcome: unknown) {
  if (!isNative) return Promise.resolve();
  return mcpPublishResult(analysisId, outcome).catch(() => {});
}
