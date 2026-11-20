// Starting an analysis: check the parent table has the data the test needs
// (otherwise a native warning, Prism-style), then open the test's wizard or run
// it. Shared by the New Analysis picker, the sidebar and the Analysis menu so
// every entry point behaves the same.
import { alert } from "../../native";
import { useProjectActions, type ForGraph } from "../../store/use-project-store";
import type { GraphOptions } from "../../store/types";
import { ANALYSES } from "../../stats";
import type { AnalysisParams, AnalysisPickerValue, AnalysisType } from "../../stats/types";
import { countDataColumns, countDataGroups, hasRowGroups } from ".";
import { WIZARDS } from "./wizards";
import { levelsOf, readTable } from "../../lib/dataset";
import { REPLICATE_TESTS, summaryTableProblem } from "../../lib/summary-format";

/** Checks the table has at least `need` data columns; warns (naming `label`) otherwise. */
function useColumnsPrecheck() {
  const { get } = useProjectActions();
  return (tableId: string, need: number, label: string) => {
    const table = get().nodes[tableId];
    if (!table || table.type !== "table") return false;
    const have = countDataColumns(table.data);
    if (have >= need) return true;
    alert(
      `${label} needs at least ${need} columns with data.`,
      `“${table.name}” currently has ${have}. Enter data into more columns and try again.`,
    );
    return false;
  };
}

function useAnalysisPrecheck() {
  const { get } = useProjectActions();
  const columnsPrecheck = useColumnsPrecheck();
  return (tableId: string, testType: AnalysisType) => {
    const { label, minColumns } = ANALYSES[testType];
    // A Multiple Variables t test assigns its variables: paired, two numeric variables
    // row by row; unpaired, one numeric response split by a grouping variable with two
    // levels. The grouping variable may hold text, so the numeric-column floor does
    // not apply — the wizard names what is missing.
    const tableType = get().nodes[tableId]?.tableType;
    if (testType === "compare-two-groups" && tableType === "multiple") {
      const data = get().nodes[tableId]?.data;
      const table = data && readTable(data);
      const ok =
        !!table &&
        (table.numeric.length >= 2 ||
          (table.numeric.length >= 1 && table.columns.some((c) => levelsOf(c).length === 2)));
      if (!ok) {
        alert(
          `${label} needs two numeric variables, or a response variable with data and a grouping variable with two levels.`,
          `Enter the variables to compare and try again.`,
        );
        return false;
      }
      return true;
    }
    // A Multiple Variables survival analysis assigns its variables: numeric time and
    // event-code variables, and a grouping variable with at least two levels — which
    // may hold text — so the three-numeric-column floor does not apply either.
    if (testType === "survival" && tableType === "multiple") {
      const data = get().nodes[tableId]?.data;
      const table = data && readTable(data);
      const ok = !!table && table.numeric.length >= 2 && table.columns.some((c) => levelsOf(c).length >= 2);
      if (!ok) {
        alert(
          `${label} needs time and event-code variables with data and a grouping variable with at least two levels.`,
          `Enter numeric time and event-code variables and a grouping variable and try again.`,
        );
        return false;
      }
      return true;
    }
    if (!columnsPrecheck(tableId, minColumns, label)) return false;
    // A test that needs raw replicates cannot run on a summary table (its
    // sub-columns hold pre-calculated means, not values to test) — say so
    // here, naming the way back, instead of running R on the summaries.
    if ((REPLICATE_TESTS as readonly string[]).includes(testType)) {
      const tableData = get().nodes[tableId]?.data;
      const problem = tableData && summaryTableProblem(tableData, label);
      if (problem) {
        alert(`${label} can't run on this table.`, problem);
        return false;
      }
    }
    // Multiple t tests compares 2 column groups per row. Count the groups that hold
    // data, not the table's structural group count.
    if (testType === "multiple-t-tests" && countDataGroups(get().nodes[tableId]?.data) < 2) {
      alert(`${label} needs at least 2 column groups with data.`, "Enter data into 2 groups and try again.");
      return false;
    }
    // Three-way ANOVA needs a third factor: ≥ 2 row bands. The picker and menu
    // hide it without them, but a stale entry point still lands here — explain
    // how to add bands instead of offering a test that cannot run.
    if (testType === "three-way-anova" && !hasRowGroups(get().nodes[tableId]?.data)) {
      alert(
        `${label} needs at least 2 row groups.`,
        "Split the table's rows into at least 2 named bands in the Groups panel (Show Inspector), then try again.",
      );
      return false;
    }
    return true;
  };
}

/** Creates the analysis node once its params are known (wizards call this). */
export function useAnalysisLauncher() {
  const { createAnalysis, get, updateGraph, setActiveNode } = useProjectActions();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, testType: AnalysisType, params?: AnalysisParams, forGraph?: ForGraph) => {
    if (!precheck(tableId, testType)) return;
    const id = createAnalysis(tableId, testType, params);
    // Made for a graph's stars: chosen for it, which stays in front (its pairs to tick).
    const graph = forGraph && get().nodes[forGraph.id];
    if (graph?.graphOptions) {
      // A graph already drawing from several analyses gains this one (its
      // pairs start unticked); a single-source graph switches to it, as before.
      const list = graph.graphOptions.sigAnalysisIds;
      const patch: Partial<GraphOptions> = { sigAnalysisId: id };
      if (list?.length) patch.sigAnalysisIds = [...new Set([...list, id])];
      else patch.sigPairs = [];
      updateGraph(graph.id, { ...graph.graphOptions, ...patch });
      setActiveNode(graph.id);
    }
  };
}

/** Starts a test picked from the picker or the Analysis menu: opens its wizard,
 *  or runs it directly when it has nothing to ask. Returns true if a wizard opened. */
export function useStartAnalysis() {
  const { get, openSelector } = useProjectActions();
  const launch = useAnalysisLauncher();
  const columnsPrecheck = useColumnsPrecheck();
  const precheck = useAnalysisPrecheck();
  return (tableId: string, picked: AnalysisPickerValue, forGraph?: ForGraph): boolean => {
    const ready =
      picked === "compare-many-groups"
        ? columnsPrecheck(tableId, ANALYSES.anova.minColumns, "Compare more than two groups")
        : picked === "transform"
          ? columnsPrecheck(tableId, 1, "Transform or Normalize")
          : precheck(tableId, picked === "interpolate" ? "nonlinear-regression" : picked);
    if (!ready) return false;
    // A transform always asks how.
    if (picked === "transform") {
      openSelector({ kind: "analysis-params", tableId, testType: picked });
      return true;
    }
    // A wizard with nothing to ask of this table (one data set, say) runs at once.
    const wizard = WIZARDS[picked];
    const { data, tableType } = get().nodes[tableId]!;
    const table = readTable(data!);
    if (!wizard?.questions({}, table, tableType).some(Boolean)) {
      const { type, params } = wizard?.finish({}, table, tableType) ?? { type: picked as AnalysisType };
      launch(tableId, type, params, forGraph);
      return false;
    }
    openSelector({ kind: "analysis-params", tableId, testType: picked, forGraph });
    return true;
  };
}
