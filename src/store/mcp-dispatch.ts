// The frontend half of the MCP dispatch channel (L0, GAP-1): what runs
// when Rust hands this window a job.
//
// A tool handler in Rust cannot run a store call or an analysis itself —
// the store, the runners and the writers live in this webview. So Rust
// enqueues a job (job id, target window, action, args) and wakes the
// window with an `mcp-run-job` event; this dispatcher claims the job once
// (`mcp_take_jobs` — the single claim path, CC-m6 once-only, same
// discipline as `r_ready`'s `sent` set), executes it, and reports
// completion via `mcp_complete_job` (sibling of `mcp_publish_result`).
// Jobs run one at a time per window, matching the webR serial queue —
// which is also what makes a cancel exact: only this job's R work is live,
// so a cancel maps to the `cancel_r` path (`cancelR()` below).
//
// `executeJob` is the extension point: future lanes add branches for
// their actions (store calls, save, graph builds, …) here. It takes its
// dependencies injected so the node test harness can drive it without a
// webview (see the L0 verification script in the lane dir).
import * as React from "react";
import { runAnalysis } from "../stats";
import type { AnalysisResult } from "../stats/types";
import { infoSheetsOf, resolveAnalysisParams } from "../lib/info-sheets";
import {
  defaultDocumentIo,
  executeCloseProject,
  executeImportPrism,
  executeSaveProject,
  type DocumentDeps,
  type DocumentIo,
  type DocumentState,
} from "./mcp-document";
import {
  cancelR,
  isNative,
  mcpCompleteJob,
  mcpTakeJobs,
  onMcpCancelJob,
  onMcpRunJob,
  type McpJob,
} from "../native";
import { publishAnalysisResult } from "./mcp-publish";
import { useProjectActions, useProjectStore } from "./use-project-store";

/** What one job's execution reports: the outcome, and what it created. */
export interface JobCompletion {
  result: unknown;
  created?: Record<string, unknown>;
}

/** What `executeJob` needs from the app, injected so tests can drive it
 *  without a webview. */
export interface JobDeps {
  /** The project as it is now, for the job to look at. */
  getState: () => DocumentState;
  /** Keep a successful live run on its analysis node, as the analysis view does. */
  cacheAnalysisResult: (id: string, result: AnalysisResult) => void;
  /** Publish an analysis outcome for `titer_read_results` (default: the real one). */
  publishResult?: (analysisId: string, outcome: unknown) => void;
  /** Run an analysis (default: the real `runAnalysis`). */
  run?: typeof runAnalysis;
  /** Load a project into the store (the import job replaces it). */
  loadProject?: DocumentDeps["loadProject"];
  /** Mark the project saved (the save job). */
  markSaved?: DocumentDeps["markSaved"];
  /** Headless document IO; defaults to the real native calls. */
  io?: DocumentIo;
}

/** The document jobs' deps, from the job deps. */
function toDocumentDeps(deps: JobDeps): DocumentDeps {
  return {
    getState: deps.getState,
    loadProject:
      deps.loadProject ??
      (() => {
        throw new Error("This window can't load a project (no loadProject).");
      }),
    markSaved:
      deps.markSaved ??
      (() => {
        throw new Error("This window can't mark a project saved (no markSaved).");
      }),
    io: deps.io ?? defaultDocumentIo,
  };
}

/** A job arg that must be a string when present (null reads as omitted —
 *  Rust sends `null` for an absent `Option`, and the dispatcher must not
 *  mistake that for a value). */
function optString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Job argument “${name}” must be a string.`);
  return value;
}

/** A job arg that must be a non-empty string. */
function reqString(value: unknown, name: string): string {
  const found = optString(value, name);
  if (found === undefined || found === "") throw new Error(`Job argument “${name}” is required.`);
  return found;
}

/** Execute one job. Throws with a plain-language message when the job
 *  cannot run — the dispatcher reports that as the job's error. */
export async function executeJob(job: McpJob, deps: JobDeps): Promise<JobCompletion> {
  switch (job.action) {
    case "noop":
      // The L0 stub: proves the Rust→frontend→Rust round-trip end to end.
      return { result: { ok: true } };
    case "run-analysis": {
      const analysisId = (job.args as { analysis_id?: unknown } | null | undefined)?.analysis_id;
      if (typeof analysisId !== "string" || !analysisId) {
        throw new Error(`Job ${job.job_id} (run-analysis) has no analysis_id.`);
      }
      const state = deps.getState();
      const node = state.nodes[analysisId];
      if (!node || node.type !== "analysis") {
        throw new Error(`No analysis with id “${analysisId}” in this project.`);
      }
      if (node.frozen) {
        throw new Error(`Analysis “${node.name}” is frozen — unfreeze it before running it again.`);
      }
      const type = node.analysisType;
      const parent = node.parentId ? state.nodes[node.parentId] : undefined;
      const data = parent?.type === "table" ? parent.data : undefined;
      if (!type || !data) {
        throw new Error(`Analysis “${node.name}” has no table to run on.`);
      }
      // Info-constant hooks resolve live, exactly as the analysis view
      // does — a hook that can't resolve is an error, never a guessed number.
      const sheets = infoSheetsOf(state.nodes, state.rootOrder);
      const resolved = resolveAnalysisParams(node.analysisParams, type, sheets);
      if ("error" in resolved) throw new Error(resolved.error);
      const outcome = await (deps.run ?? runAnalysis)(type, data, resolved.params);
      (deps.publishResult ?? publishAnalysisResult)(analysisId, outcome);
      if (!("error" in outcome)) deps.cacheAnalysisResult(analysisId, outcome);
      return { result: outcome, created: { analysis_id: analysisId } };
    }
    case "save-project": {
      // L2: write the project (GAP-4 — the TS writers build the bytes, Rust
      // only ever wrote them) and mark it saved. The job's result is the
      // tool's output.
      const args = (job.args ?? {}) as { path?: unknown; format?: unknown };
      return executeSaveProject(
        toDocumentDeps(deps),
        { path: optString(args.path, "path"), format: optString(args.format, "format") },
        job.project_id,
      );
    }
    case "import-prism": {
      // L2: read a Prism file and load it as this window's project — the
      // same as File ▸ Import Prism File, minus the dialog.
      const args = (job.args ?? {}) as { path?: unknown };
      return executeImportPrism(toDocumentDeps(deps), { path: reqString(args.path, "path") }, job.project_id);
    }
    case "close-project": {
      // L2: settle the save question, then arm the close bypass — Rust
      // closes the window once this job reports done. A dirty project with
      // no `save` answers `needs_confirm` instead of closing.
      const args = (job.args ?? {}) as { save?: unknown };
      return executeCloseProject(toDocumentDeps(deps), { save: optString(args.save, "save") }, job.project_id);
    }
    default:
      throw new Error(`Unknown job action “${job.action}”.`);
  }
}

/** The dispatcher: claims this window's jobs and runs them, one at a time.
 *  Mounted once, in AppShell, next to `useMcpSnapshotPublisher` (same
 *  pattern, same place). A no-op where there is no native shell (web
 *  preview, tests). */
export function useMcpJobDispatcher() {
  const store = useProjectStore();
  const actions = useProjectActions();
  // Captured once: both read the latest state through refs (`get` reads
  // `latest.current`; the actions are memoised once in the provider), so
  // the effect below mounts once and never goes stale.
  const getState = store.get;
  const cacheAnalysisResult = actions.cacheAnalysisResult;
  const loadProject = actions.loadProject;
  const markSaved = actions.markProjectSaved;
  // Jobs already handed to an execution: the frontend side of the
  // once-only discipline (Rust's `take_jobs` is the other half — a job
  // claimed there is never handed out again, and a job seen here is never
  // executed again).
  const seenRef = React.useRef(new Set<string>());
  // The job executing now, if any — the cancel event's target.
  const runningRef = React.useRef<{ jobId: string; action: string } | null>(null);

  React.useEffect(() => {
    if (!isNative) return;
    let stopped = false;
    let busy = false;
    let pending = false;

    /** Claim every queued job and run it, in order, one at a time. */
    const drain = async () => {
      if (busy) {
        pending = true;
        return;
      }
      busy = true;
      try {
        while (!stopped) {
          pending = false;
          let jobs: McpJob[];
          try {
            jobs = await mcpTakeJobs();
          } catch {
            return;
          }
          for (const job of jobs) {
            if (stopped) return;
            if (seenRef.current.has(job.job_id)) continue;
            seenRef.current.add(job.job_id);
            runningRef.current = { jobId: job.job_id, action: job.action };
            try {
              const { result, created } = await executeJob(job, {
                getState,
                cacheAnalysisResult,
                loadProject,
                markSaved,
              });
              // A completion report is always sent; Rust ignores it for a
              // job that is already terminal (a cancel that landed first).
              await mcpCompleteJob(job.job_id, "done", result, undefined, created).catch(() => {});
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              await mcpCompleteJob(job.job_id, "error", undefined, message, undefined).catch(() => {});
            } finally {
              if (runningRef.current?.jobId === job.job_id) runningRef.current = null;
            }
          }
          if (!pending) return;
        }
      } finally {
        busy = false;
      }
    };

    void drain(); // Jobs queued before this window mounted.
    let offRun: (() => void) | undefined;
    let offCancel: (() => void) | undefined;
    void onMcpRunJob(() => void drain()).then((off) => {
      offRun = off;
    });
    // A running job's cancel maps to the `cancel_r` path: only this job's
    // R work is live (serial dispatch), so dropping this window's waiting
    // requests drops that job's work and nothing else. The run's rejection
    // is reported as an error, which Rust discards — the job is already
    // `cancelled` there.
    void onMcpCancelJob((jobId) => {
      const running = runningRef.current;
      if (running?.jobId === jobId && running.action === "run-analysis") {
        void cancelR();
      }
    }).then((off) => {
      offCancel = off;
    });
    return () => {
      stopped = true;
      offRun?.();
      offCancel?.();
    };
    // `getState` / `cacheAnalysisResult` are captured above and read the
    // latest state through refs, so this effect mounts once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
