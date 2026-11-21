// The "Regenerate graphs" preview (Plane seq 291, 1.8.1 fast follow-up).
//
// After a Prism import, the user reviews every proposed graph before
// anything is built: one row per graph in file order, each with Confirm /
// Adjust / Skip. Adjust can change the type, error bars, name and linked
// analysis — never the source table, the data, or the axis limits (those
// stay Prism's defaults; the Format panel tweaks them afterwards).
// Cancel creates nothing. "Confirm selected" creates only the confirmed
// rows; the post-run report lists created / skipped-by-user /
// not-reconstructible.
//
// The plans come from the import-time registry (`getRegenPlans`) — the
// same plans `titer_list_regenerable_graphs` returns — snapshotted when
// the dialog opens. Creation goes through `applyRegenDecisions`, the
// same path the MCP tool uses.
import * as React from "react";
import { Button, Field, Input, Select, Segmented } from "../ui/controls";
import { Dialog } from "../ui/dialog";
import { useProjectStore } from "../store/use-project-store";
import { GRAPH_OPTIONS_BY_TABLE, GRAPHS } from "../views/graphs";
import { titleCase } from "../lib/format";
import {
  applyRegenDecisions,
  getRegenPlans,
  type GraphPlan,
  type RegenDecision,
  type RegenError,
  type RegenReport,
} from "../lib/prism-graph-regen";
import type { GraphType } from "../store/types";

/** The heuristic rule, in words (design §4). */
const HEURISTIC_RULE_LABELS: Record<string, string> = {
  H1: "survival table → survival graph",
  H2: "grouped table → grouped bars",
  H3: "XY table with numeric X → XY scatter",
  H4: "column replicates → mean and error",
  H5: "column summary → mean and error",
  H6: "contingency table → grouped bars",
};

/** Graph types that draw error bars — the Adjust editor offers the error
 *  choice only for these; any other type builds with no error bars. */
const ERROR_BAR_TYPES: readonly GraphType[] = [
  "mean-error",
  "xy-scatter",
  "grouped-bars",
  "grouped-scatter",
  "grouped-box",
  "grouped-lines",
  "logistic-curve",
];

const ERROR_LABELS: Record<RegenError, string> = {
  none: "No error bars",
  sd: "SD",
  sem: "SEM",
  ci: "95% CI",
};

const ERROR_OPTIONS = (Object.keys(ERROR_LABELS) as RegenError[]).map((value) => ({
  value,
  label: ERROR_LABELS[value],
}));

const graphLabel = (type: GraphType) => titleCase(GRAPHS[type].label);

/** One row's decisions, as the preview holds them. */
interface RowEdit {
  decision: "confirm" | "skip";
  adjusting: boolean;
  graphType: GraphType;
  error: RegenError;
  name: string;
  /** null = no linked analysis. */
  linkedAnalysisId: string | null;
}

export function RegenerateGraphsDialog({
  open,
  onCancel,
  onDone,
}: {
  open: boolean;
  /** Cancel: close, create nothing, keep the offer. */
  onCancel: () => void;
  /** Done (after a run): close — the offer is consumed. */
  onDone: () => void;
}) {
  const { nodes, createGraph, renameNode, get } = useProjectStore();
  const [plans, setPlans] = React.useState<GraphPlan[]>([]);
  const [rows, setRows] = React.useState<RowEdit[]>([]);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<RegenReport | null>(null);

  // Snapshot the import-time plans when the dialog opens; the rows are
  // edited locally until Confirm. A row whose source table is already
  // gone (deleted since the import) can't be built, so it starts skipped.
  React.useEffect(() => {
    if (!open) return;
    const current = getRegenPlans() ?? [];
    setPlans(current);
    setRows(
      current.map((p) => ({
        decision:
          p.reconstructible && p.sourceTableId !== null && nodes[p.sourceTableId] !== undefined
            ? "confirm"
            : "skip",
        adjusting: false,
        graphType: p.graphType ?? "mean-error",
        error: p.error ?? "none",
        name: p.prismTitle,
        linkedAnalysisId: p.linkedAnalysisId ?? null,
      })),
    );
    setApplyError(null);
    setReport(null);
    // The snapshot reads the store once, at open — the rows are local after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tableLive = (plan: GraphPlan) =>
    plan.sourceTableId !== null && nodes[plan.sourceTableId] !== undefined;
  const confirmCount = rows.filter(
    (r, i) => r.decision === "confirm" && plans[i]?.reconstructible && tableLive(plans[i]),
  ).length;

  const confirmSelected = () => {
    setApplyError(null);
    const decisions: RegenDecision[] = plans.map((plan, i) => {
      const row = rows[i];
      if (!plan.reconstructible || row.decision === "skip") return { proposalId: plan.proposalId, action: "skip" };
      return {
        proposalId: plan.proposalId,
        action: "confirm",
        overrides: {
          graphType: row.graphType,
          error: ERROR_BAR_TYPES.includes(row.graphType) ? row.error : "none",
          name: row.name,
          linkedAnalysisId: row.linkedAnalysisId,
        },
      };
    });
    try {
      const result = applyRegenDecisions(plans, decisions, { getState: get, createGraph, renameNode });
      setReport(result);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "The graphs couldn't be built.");
    }
  };

  const updateRow = (index: number, patch: Partial<RowEdit>) =>
    setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  // The post-run report replaces the preview (same dialog): created /
  // skipped-by-user / not reconstructible, then Done consumes the offer.
  if (report) {
    return (
      <Dialog
        open={open}
        onClose={onDone}
        dismissLabel="Done"
        title="Graphs regenerated"
        description="The graphs below were built from the imported tables. Axis ranges are Titer's defaults — adjust them in the Format panel."
      >
        {report.created.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-regular">
              Created ({report.created.length}):
            </p>
            {report.created.map((c) => (
              <p key={c.graphId} className="text-regular">
                • “{c.name}” — {graphLabel(c.graphType)}
              </p>
            ))}
          </div>
        )}
        {report.skipped.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-regular">Skipped by you ({report.skipped.length}):</p>
            {report.skipped.map((s) => (
              <p key={s.proposalId} className="text-regular text-secondary">
                • “{s.prismTitle}”
              </p>
            ))}
          </div>
        )}
        {report.notReconstructible.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-regular">Not reconstructible ({report.notReconstructible.length}):</p>
            {report.notReconstructible.map((s) => (
              <p key={s.proposalId} className="text-regular text-secondary">
                • “{s.prismTitle}” — {s.reason}
              </p>
            ))}
          </div>
        )}
        {report.warnings.length > 0 && (
          <div className="flex flex-col gap-1">
            {report.warnings.map((w, i) => (
              <p key={i} className="text-regular text-secondary">
                • {w}
              </p>
            ))}
          </div>
        )}
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Regenerate graphs"
      description="Review each graph before it's built. Confirm builds it, Adjust changes its type, error bars, name or linked analysis, Skip leaves it out. Nothing is created until you confirm below."
      footer={
        <Button variant="accent" disabled={confirmCount === 0} onClick={confirmSelected}>
          Confirm selected ({confirmCount})
        </Button>
      }
    >
      {plans.length === 0 && (
        <p className="text-regular text-secondary">
          There are no import-time graph plans for this project — import a .prism or .pzfx file first.
        </p>
      )}
      <div className="flex max-h-[50vh] flex-col gap-2 overflow-auto">
        {plans.map((plan, i) => {
          const row = rows[i];
          if (!row) return null;
          const table = plan.sourceTableId ? nodes[plan.sourceTableId] : undefined;
          const tableGone = plan.reconstructible && !table;
          const tableType = table?.tableType ?? "column";
          const typeOptions = GRAPH_OPTIONS_BY_TABLE[tableType];
          // The table's imported nonlinear fits — the only analyses a
          // regenerated XY graph can link (regAnalysisId).
          const linkedOptions =
            plan.sourceTableId === null
              ? []
              : Object.values(nodes)
                  .filter(
                    (n) =>
                      n?.type === "analysis" &&
                      n.parentId === plan.sourceTableId &&
                      n.analysisType === "nonlinear-regression",
                  )
                  .map((n) => ({ value: n!.id, label: n!.name }));
          const linkedName = plan.linkedAnalysisId
            ? (nodes[plan.linkedAnalysisId]?.name ?? "Linked analysis")
            : null;
          return (
            <div key={plan.proposalId} className="flex flex-col gap-1 rounded-md border border-separator p-3">
              <p className="text-regular">
                <strong>“{plan.prismTitle}”</strong>
              </p>
              <p className="text-small text-secondary">
                {plan.origin === "sidecar" ? "From Prism file" : "Guessed from the table — Prism's graph type is not in this file"}
                {plan.origin === "heuristic" && plan.heuristicRule
                  ? ` (rule ${plan.heuristicRule}: ${HEURISTIC_RULE_LABELS[plan.heuristicRule]})`
                  : ""}
              </p>
              <p className="text-regular text-secondary">
                {plan.sourceTableName ? `From table “${plan.sourceTableName}”` : "No source table"}
                {plan.reconstructible
                  ? ` — ${graphLabel(row.graphType)}, ${ERROR_LABELS[ERROR_BAR_TYPES.includes(row.graphType) ? row.error : "none"]}`
                  : ""}
                {linkedName ? `, linked to “${linkedName}”` : ""}
              </p>
              {plan.derivedError && <p className="text-small text-secondary">• {plan.derivedError}</p>}
              {plan.limitNote && <p className="text-small text-secondary">• {plan.limitNote}</p>}
              {!plan.reconstructible && (
                <p className="text-regular text-secondary">Can&apos;t be rebuilt — {plan.reason}</p>
              )}
              {tableGone && (
                <p className="text-regular text-secondary">
                  Can&apos;t be built — the source table was deleted since the import.
                </p>
              )}
              {plan.reconstructible && !tableGone && (
                <div className="flex items-center gap-2">
                  <Segmented
                    value={row.decision}
                    onChange={(decision) => updateRow(i, { decision })}
                    options={[
                      { value: "confirm", label: "Confirm" },
                      { value: "skip", label: "Skip" },
                    ]}
                  />
                  <Button onClick={() => updateRow(i, { adjusting: !row.adjusting })}>
                    {row.adjusting ? "Done adjusting" : "Adjust…"}
                  </Button>
                </div>
              )}
              {row.adjusting && plan.reconstructible && !tableGone && (
                <div className="flex flex-col gap-2 border-t border-separator pt-2">
                  <Field label="Graph type">
                    <Select<GraphType>
                      value={row.graphType}
                      onChange={(graphType) => updateRow(i, { graphType })}
                      options={typeOptions.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </Field>
                  {ERROR_BAR_TYPES.includes(row.graphType) ? (
                    <Field label="Error bars">
                      <Select<RegenError>
                        value={row.error}
                        onChange={(error) => updateRow(i, { error })}
                        options={ERROR_OPTIONS}
                      />
                    </Field>
                  ) : (
                    <p className="text-small text-secondary">This graph type doesn&apos;t draw error bars.</p>
                  )}
                  <Field label="Name">
                    <Input value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
                  </Field>
                  {(row.graphType === "xy-scatter" || row.graphType === "logistic-curve") && (
                    <Field label="Linked analysis">
                      <Select<string>
                        value={row.linkedAnalysisId ?? ""}
                        onChange={(value) => updateRow(i, { linkedAnalysisId: value === "" ? null : value })}
                        options={[
                          { value: "", label: "None" },
                          ...linkedOptions,
                        ]}
                      />
                    </Field>
                  )}
                  {(row.graphType === "xy-scatter" || row.graphType === "logistic-curve") &&
                    linkedOptions.length === 0 && (
                      <p className="text-small text-secondary">
                        No nonlinear fit was imported with this table, so there is nothing to link.
                      </p>
                    )}
                  <p className="text-small text-secondary">
                    Adjust can&apos;t change the source table, the data, or the axis limits — those stay as imported,
                    and the Format panel tweaks the axes afterwards.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {applyError && <p className="text-regular text-red-600">{applyError}</p>}
    </Dialog>
  );
}
