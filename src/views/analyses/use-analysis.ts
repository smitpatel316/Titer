// The outcome of a test on a table, for a view: runs it (runAnalysis shares one
// result per table version, so the analysis view and a graph's overlays reuse the
// same run) and re-runs it when the table or the params change.
import * as React from "react";
import { runAnalysis } from "../../stats";
import { runPluginAnalysisOnTable } from "../../plugins";
import type { PluginAnalysisOutcome, PluginParamValues } from "../../plugins";
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

/** The plugin side of `useAnalysis`: runs a plugin analysis on a table
 *  through the cached plugin runner (`runPluginAnalysisOnTable` shares one
 *  result per table version, exactly as `runAnalysis` does) and re-runs it
 *  when the table or the params change. Plugin params carry no info-sheet
 *  hooks, so there is nothing to resolve before the run. null while
 *  running, or when there is nothing to run. */
export function usePluginAnalysis(
  id: string | undefined,
  data: TableData | undefined,
  params?: PluginParamValues,
  opts?: { retryKey?: unknown },
): PluginAnalysisOutcome | null {
  const key = `${id} ${JSON.stringify(params ?? null)}`;
  const retryKey = opts?.retryKey;
  const [done, setDone] = React.useState<{ key: string; data: TableData; outcome: PluginAnalysisOutcome } | null>(null);

  React.useEffect(() => {
    if (!id || !data) return;
    let current = true;
    setDone(null);
    void runPluginAnalysisOnTable(id, data, params).then((outcome) => current && setDone({ key, data, outcome }));
    return () => {
      current = false;
    };
  }, [id, data, key, retryKey]);

  return done && done.key === key && done.data === data ? done.outcome : null;
}

// A TableData's stable number, so a list of runs serializes to one key: the
// runs are keyed by the data object's identity (runAnalysis's own cache),
// and the requests are rebuilt every render, so their identity can't drive
// the effect below.
const dataIds = new WeakMap<TableData, number>();
let nextDataId = 1;
const dataId = (data: TableData): number => {
  const found = dataIds.get(data);
  if (found !== undefined) return found;
  const id = nextDataId++;
  dataIds.set(data, id);
  return id;
};

/** One analysis a graph draws from: its node id, its type and params, and
 *  the data it ran on — its own parent table's, so a copy table's test reads
 *  the copy's numbers, not the graph's table's. */
export interface AnalysisRequest {
  id: string;
  type: AnalysisType | undefined;
  data: TableData | undefined;
  params?: AnalysisParams;
}

/** Several analyses at once (a graph's significance sources): one hook call
 *  for a list of any length, so the count may change without breaking the
 *  hooks order. null until every one has landed (or has nothing to run);
 *  each outcome sits at its request's place. Shares runAnalysis's cache with
 *  the analysis views, so a run already open there costs nothing here. */
export function useAnalyses(requests: AnalysisRequest[]): (AnalysisOutcome | null)[] | null {
  const { nodes, rootOrder } = useProjectStore();
  const sheets = React.useMemo(() => infoSheetsOf(nodes, rootOrder), [nodes, rootOrder]);
  const key = requests
    .map((r) => {
      const resolved = resolveAnalysisParams(r.params, r.type, sheets);
      const runParams = "params" in resolved ? resolved.params : undefined;
      const resolveError = "error" in resolved ? resolved.error : undefined;
      return JSON.stringify([
        r.id,
        r.type,
        r.data ? dataId(r.data) : null,
        runParams ?? null,
        resolveError ?? null,
      ]);
    })
    .join("\n");
  const [done, setDone] = React.useState<{ key: string; outcomes: (AnalysisOutcome | null)[] } | null>(null);

  React.useEffect(() => {
    if (!requests.length) {
      setDone({ key, outcomes: [] });
      return;
    }
    let current = true;
    setDone(null);
    const runs = requests.map((r) => {
      const resolved = resolveAnalysisParams(r.params, r.type, sheets);
      if ("error" in resolved) return Promise.resolve({ error: resolved.error } as AnalysisOutcome);
      if (!r.type || !r.data) return Promise.resolve(null);
      return runAnalysis(r.type, r.data, "params" in resolved ? resolved.params : undefined);
    });
    void Promise.all(runs).then((outcomes) => current && setDone({ key, outcomes }));
    return () => {
      current = false;
    };
  }, [key]);

  return done && done.key === key ? done.outcomes : null;
}
