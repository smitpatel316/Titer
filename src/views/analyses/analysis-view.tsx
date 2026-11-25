// Host for an analysis node: runs the chosen test on the parent table and
// renders the result.
import * as React from "react";
import { SlidersHorizontalIcon, SnowflakeIcon } from "@phosphor-icons/react";
import type { ProjectNode } from "../../store/types";
import { useProjectActions, useProjectStore } from "../../store/use-project-store";
import { Button, IconButton } from "../../ui/controls";
import { WithInspector } from "../../components/inspector";
import { isNative, setSpinner } from "../../native";
import { ANALYSES } from "../../stats";
import { resolveAnalysis } from "../../plugins";
import { cancelActiveEvals } from "../../stats/webr";
import { titleCase } from "../../lib/format";
import { AnalysisResultsView } from "./analysis-results-view";
import { canEditAnalysisParams } from "./wizards";
import { AddFloatingNoteButton, FloatingNotesLayer } from "../../components/floating-notes";
import { useAnalysis, useEngineBootStatus, usePluginAnalysis, useRQueue } from "./use-analysis";
import { publishAnalysisResult } from "../../store/mcp-publish";
import { rQueueStatusText } from "../../stats/r-queue";
import { engineStatusText } from "../../stats/engine-status";
import { repointCandidates } from "../../lib/repoint-analysis";

/** "1:23" for the elapsed running time. */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** While the analysis runs: macOS's spinning wheel in the middle of the results, once it
 *  has taken half a second (R or a package loading): a quick one shows none. */
function Running() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!isNative) return;
    let shown = false;
    const timer = setTimeout(() => {
      const { left, top, width, height } = ref.current!.getBoundingClientRect();
      shown = true;
      setSpinner([left + width / 2, top + height / 2]);
    }, 500);
    return () => {
      clearTimeout(timer);
      if (shown) setSpinner(null);
    };
  }, []);
  return (
    <div ref={ref} className="flex h-full items-center justify-center text-regular text-secondary">
      {!isNative && "Running…"}
    </div>
  );
}

export function AnalysisView({ node }: { node: ProjectNode }) {
  const { nodes, createTableWithData } = useProjectStore();
  const { cacheAnalysisResult, openSelector, setAnalysisFrozen, repointAnalysis, setResultCellBackground } = useProjectActions();
  // Change Parameters (seq 373): re-opens this test's wizard pre-filled from
  // the stored params. Frozen, orphaned and unmapped tests stay disabled,
  // with the reason as the tooltip. A wizard that asks nothing on the parent
  // table (Issue 14) stays disabled too — the parent table is passed so the
  // gate can count its questions.
  const data = node.parentId ? nodes[node.parentId]?.data : undefined;
  const parentTableType = node.parentId ? nodes[node.parentId]?.tableType : undefined;
  const edit = canEditAnalysisParams(node, data, parentTableType);
  // The tables this orphaned analysis may move to (seq 242): only the
  // ones offering its test, so the re-run it is waiting for can run there.
  const candidates = node.orphaned ? repointCandidates(node, nodes) : [];
  // A frozen or orphaned sheet never re-runs: it shows its saved result, so
  // the live run gets no data to run on (a frozen sheet stops auto-updating
  // when the data change; an orphaned one has no source table left).
  const frozenOrOrphaned = Boolean(node.frozen || node.orphaned);
  const liveData = frozenOrOrphaned ? undefined : data;
  // Bumps to re-run the test after an error, a timeout or a cancel.
  const [retryNonce, setRetryNonce] = React.useState(0);
  // A plugin node runs its plugin analysis (cached per table version, as
  // the first-party run is); a first-party node runs its test. Exactly one
  // of the two hooks has something to run — the other returns null.
  const firstPartyOutcome = useAnalysis(
    node.pluginAnalysisId ? undefined : node.analysisType,
    liveData,
    node.analysisParams,
    { retryKey: retryNonce },
  );
  const pluginOutcome = usePluginAnalysis(node.pluginAnalysisId, liveData, node.pluginAnalysisParams, {
    retryKey: retryNonce,
  });
  const outcome = pluginOutcome ?? firstPartyOutcome;
  const queue = useRQueue();
  const bootStatus = useEngineBootStatus();
  const bootFailure = engineStatusText(bootStatus);
  // v3 Phase 1: the outcome, once computed, is what `titer_read_results`
  // serves. (An analysis never opened in this session has no result — the
  // tool says so instead of inventing one.)
  React.useEffect(() => {
    if (outcome) publishAnalysisResult(node.id, outcome);
  }, [outcome, node.id]);
  // A successful live run is kept on the node, so the sheet still has
  // something to show once frozen or orphaned (a failed run is not cached,
  // so it runs again for real).
  React.useEffect(() => {
    if (outcome && !("error" in outcome) && !frozenOrOrphaned) cacheAnalysisResult(node.id, outcome);
  }, [outcome, frozenOrOrphaned, node.id, cacheAnalysisResult]);
  const running = Boolean(liveData && !outcome);
  const errored = Boolean(liveData && outcome && "error" in outcome);
  // What the sheet shows: a frozen or orphaned sheet shows its saved result;
  // a live one shows the run that just finished.
  const shown = frozenOrOrphaned
    ? node.cachedResult
    : outcome && !("error" in outcome)
      ? outcome
      : undefined;
  // Freezing needs something to freeze: a finished run, or a result saved
  // from an earlier one. An orphaned sheet can't freeze (it already keeps
  // its last result, and its parameters can't change anyway).
  const canFreeze = Boolean(node.frozen || (outcome && !("error" in outcome)) || node.cachedResult);
  const [elapsedMs, setElapsedMs] = React.useState(0);
  React.useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <WithInspector
      title={node.name}
      tag={
        (node.pluginAnalysisId
          ? (resolveAnalysis(node.pluginAnalysisId)?.label ?? node.pluginAnalysisId)
          : titleCase(ANALYSES[node.analysisType!].kind?.(node.analysisParams) ?? ANALYSES[node.analysisType!].label)) +
        (node.frozen ? " · Frozen" : node.orphaned ? " · Orphaned" : "")
      }
      node={node}
      actions={
        <>
          <IconButton
            aria-label="Change parameters"
            title={edit.editable ? "Change parameters" : edit.reason}
            disabled={!edit.editable}
            onClick={() => openSelector({ kind: "edit-analysis-params", nodeId: node.id })}
          >
            <SlidersHorizontalIcon />
          </IconButton>
          {!node.orphaned && (
            <IconButton
              aria-label={node.frozen ? "Unfreeze results" : "Freeze results"}
              disabled={!canFreeze}
              onClick={() => setAnalysisFrozen(node.id, !node.frozen)}
            >
              <SnowflakeIcon weight={node.frozen ? "fill" : "regular"} />
            </IconButton>
          )}
          <AddFloatingNoteButton node={node} />
        </>
      }
    >
      <div className="relative flex-1 overflow-auto">
        {node.frozen && (
          <p className="border-b border-separator bg-control px-8 py-2 text-regular text-secondary">
            Frozen — these results will not update when the data change.
          </p>
        )}
        {node.orphaned && (
          <div className="border-b border-separator bg-control px-8 py-2 text-regular text-secondary">
            <p>
              {node.orphanedDataSet ? (
                <>
                  Orphaned — the data set “{node.orphanedDataSet}” was removed from table “
                  {node.sourceTableName ?? "Unknown"}”. These results are kept as they were; the analysis parameters
                  cannot be changed.
                </>
              ) : (
                <>
                  Orphaned — the source table “{node.sourceTableName ?? "Unknown"}” was deleted. These results are
                  kept as they were; the analysis parameters cannot be changed.
                </>
              )}
            </p>
            {candidates.length > 0 ? (
              <p className="mt-1">
                Re-point to:{" "}
                {candidates.map((t, i) => (
                  <React.Fragment key={t.id}>
                    {i > 0 ? " · " : ""}
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      onClick={() => repointAnalysis(node.id, t.id)}
                    >
                      {t.name}
                    </button>
                  </React.Fragment>
                ))}
              </p>
            ) : (
              <p className="mt-1">No table in this project offers this test, so it can’t be re-pointed.</p>
            )}
          </div>
        )}
        {bootFailure && (
          <p className="border-b border-separator bg-control px-8 py-2 text-regular text-secondary">{bootFailure}</p>
        )}
        {shown ? (
          <AnalysisResultsView
            result={shown}
            onCreateTable={(tableType, table) => createTableWithData(tableType, table, "Extracted data")}
            cellBackgrounds={node.resultCellBackgrounds}
            onSetCellBackground={(key, color) => setResultCellBackground(node.id, key, color)}
          />
        ) : liveData && !outcome ? (
          <Running />
        ) : (
          <div className="flex flex-col items-start gap-3 px-8 py-6">
            <p className="text-regular text-secondary">
              {node.orphaned
                ? "This analysis has no saved results — it never ran before its table was deleted."
                : node.frozen
                  ? "This analysis has no saved results yet — unfreeze it to run."
                  : !data
                    ? "This analysis has no source table."
                    : outcome && "error" in outcome
                      ? outcome.error
                      : `Running… ${formatElapsed(elapsedMs)}${rQueueStatusText(queue)}`}
            </p>
            {running && <Button onClick={() => cancelActiveEvals()}>Cancel</Button>}
            {errored && (
              <Button variant="accent" onClick={() => setRetryNonce((n) => n + 1)}>
                Retry
              </Button>
            )}
            {node.frozen && <Button onClick={() => setAnalysisFrozen(node.id, false)}>Unfreeze</Button>}
          </div>
        )}
        <FloatingNotesLayer node={node} />
      </div>
    </WithInspector>
  );
}
