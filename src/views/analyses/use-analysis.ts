// The outcome of a test on a table, for a view: runs it (runAnalysis shares one
// result per table version, so the analysis view and a graph's overlays reuse the
// same run) and re-runs it when the table or the params change.
import * as React from "react";
import { runAnalysis } from "../../stats";
import type { AnalysisOutcome, AnalysisParams, AnalysisType } from "../../stats/types";
import type { TableData } from "../../store/types";
import { useProjectStore } from "../../store/use-project-store";
import { infoSheetsOf, resolveAnalysisParams } from "../../lib/info-sheets";
import { getRQueueSnapshot, onRQueueSnapshot, type RQueueSnapshot } from "../../stats/r-queue";
import { getEngineStatus, onEngineStatus, setEngineStatus } from "../../stats/engine-status";
import type { EngineBootStatus } from "../../stats/webr";
import { onEngineBootStatus, onRQueue } from "../../native";

/** The R queue's latest state, for a view waiting on a calculation: null
 *  until the engine has published one (tests and `npm run web` never do,
 *  so the queue line stays hidden there). */
export function useRQueue(): RQueueSnapshot | null {
  const [snapshot, setSnapshot] = React.useState<RQueueSnapshot | null>(() => getRQueueSnapshot());
  React.useEffect(() => {
    let offTauri: (() => void) | undefined;
    void onRQueue().then((off) => {
      offTauri = off;
    });
    const offStore = onRQueueSnapshot(setSnapshot);
    return () => {
      offStore();
      offTauri?.();
    };
  }, []);
  return snapshot;
}

/** The R engine's boot status, for a view: null until the engine has
 *  published one (tests and `npm run web` never do, so the boot line stays
 *  hidden there). A failed boot shows in the analysis view instead of
 *  leaving the user to discover it on the first run (CC-m7). */
export function useEngineBootStatus(): EngineBootStatus | null {
  const [status, setStatus] = React.useState<EngineBootStatus | null>(() => getEngineStatus());
  React.useEffect(() => {
    let offTauri: (() => void) | undefined;
    void onEngineBootStatus((s) => setEngineStatus(s)).then((off) => {
      offTauri = off;
    });
    const offStore = onEngineStatus(setStatus);
    return () => {
      offStore();
      offTauri?.();
    };
  }, []);
  return status;
}

/** null while running, or when there is nothing to run. `retryKey` re-runs
 *  the test on demand (the Retry button after an error, a timeout or a
 *  cancel — a failed run is not cached, so it runs again for real). Info
 *  constants hooked into the params resolve live here, before the run — a
 *  hook that can't resolve is an error, never a guessed number — and the
 *  resolved params are the run's key, so editing a constant re-runs it. */
export function useAnalysis(
  type: AnalysisType | undefined,
  data: TableData | undefined,
  params?: AnalysisParams,
  opts?: { retryKey?: unknown },
): AnalysisOutcome | null {
  // The store's nodes, for the info sheets: the hook re-resolves (and the
  // run re-runs) whenever a constant changes.
  const { nodes, rootOrder } = useProjectStore();
  const sheets = React.useMemo(() => infoSheetsOf(nodes, rootOrder), [nodes, rootOrder]);
  const resolved = resolveAnalysisParams(params, type, sheets);
  const runParams = "params" in resolved ? resolved.params : undefined;
  const resolveError = "error" in resolved ? resolved.error : undefined;
  const key = `${type} ${JSON.stringify(runParams ?? null)}${resolveError ? ` !${resolveError}` : ""}`;
  const retryKey = opts?.retryKey;
  const [done, setDone] = React.useState<{ key: string; data: TableData; outcome: AnalysisOutcome } | null>(null);

  React.useEffect(() => {
    if (!type || !data) return;
    let current = true;
    // A new run starts: drop the previous outcome (an error, after Retry)
    // so the view shows "Running…" instead of the stale error meanwhile.
    setDone(null);
    if (resolveError) {
      setDone({ key, data, outcome: { error: resolveError } });
      return;
    }
    void runAnalysis(type, data, runParams).then((outcome) => current && setDone({ key, data, outcome }));
    return () => {
      current = false;
    };
  }, [type, data, key, retryKey]);

  return done && done.key === key && done.data === data ? done.outcome : null;
}
