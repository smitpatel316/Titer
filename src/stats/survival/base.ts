// What both survival analyses read of a Survival table: each group holding subjects, with
// their times and codes, checked (1 = event, 0 = censored; times must be positive).
import type { Column } from "../types";
import { levelsOf, pairUp, splitXY, xyProblem } from "../../lib/dataset";
import { missingColumn } from "../column/base";
import { num } from "../../lib/format";

interface SurvivalGroup {
  name: string;
  /** Each subject's time… */
  x: number[];
  /** …and code: 1, an event; 0, censored. */
  y: number[];
}

/** The groups holding subjects, at least 2, or what is wrong with the table. A Multiple
 *  Variables table assigns its variables instead (`time`, `status`, `groupBy`): the time
 *  and event-code columns, split by the grouping variable's levels. */
export function survivalGroups(
  columns: Column[],
  assignment?: { time?: string; status?: string; groupBy?: string },
): SurvivalGroup[] | { error: string } {
  if (assignment?.time !== undefined || assignment?.status !== undefined || assignment?.groupBy !== undefined)
    return survivalGroupsByAssignment(columns, assignment);
  const { x, ys } = splitXY(columns);
  if (!x) return { error: xyProblem(columns)! };
  if (ys.some((y) => y.columns.length > 1))
    return { error: "Each group needs one column of event codes, not replicates." };
  const groups = ys.map((y) => ({ name: y.name, ...pairUp(x, y.columns[0]) })).filter((g) => g.y.length > 0);
  return checkedSurvivalGroups(groups);
}

/** A Multiple Variables table's groups: each grouping level's subjects, with their times
 *  and codes — only the rows holding all three (a row with a blank level, or a non-numeric
 *  time or code, is left out, as pairUp leaves such rows out of a Survival table). */
function survivalGroupsByAssignment(
  columns: Column[],
  assignment: { time?: string; status?: string; groupBy?: string },
): SurvivalGroup[] | { error: string } {
  const { time, status, groupBy } = assignment;
  if (time === undefined)
    return { error: "Pick a time variable — run the analysis again and choose the variables." };
  if (status === undefined)
    return { error: "Pick an event-code variable — run the analysis again and choose the variables." };
  if (groupBy === undefined)
    return { error: "Pick a grouping variable — run the analysis again and choose the variables." };
  const timeCol = columns.find((c) => c.name === time);
  if (!timeCol) return { error: missingColumn(time) };
  if (!timeCol.values.length) return { error: `“${time}” holds no numbers yet.` };
  const statusCol = columns.find((c) => c.name === status);
  if (!statusCol) return { error: missingColumn(status) };
  if (!statusCol.values.length) return { error: `“${status}” holds no numbers yet.` };
  if (timeCol === statusCol) return { error: "The time and event-code variables must be different variables." };
  const groupCol = columns.find((c) => c.name === groupBy);
  if (!groupCol) return { error: missingColumn(groupBy) };
  const levels = levelsOf(groupCol);
  if (levels.length < 2)
    return {
      error:
        levels.length === 0
          ? `“${groupBy}” holds no values — a grouping variable needs at least two levels to compare.`
          : `“${groupBy}” holds only “${levels[0]}” — a grouping variable needs at least two levels to compare.`,
    };
  const at = (r: number) => groupCol.cells[r]?.trim();
  const groups = levels
    .map((level) => {
      const rows = timeCol.rows.filter((r) => statusCol.byRow[r] != null && at(r) === level);
      return { name: level, x: rows.map((r) => timeCol.byRow[r]!), y: rows.map((r) => statusCol.byRow[r]!) };
    })
    .filter((g) => g.y.length > 0);
  return checkedSurvivalGroups(groups);
}

/** The checks every set of survival groups passes: codes 1/0, positive times, at least
 *  2 groups holding subjects, at least one event anywhere. */
function checkedSurvivalGroups(groups: SurvivalGroup[]): SurvivalGroup[] | { error: string } {
  for (const g of groups) {
    const code = g.y.find((c) => c !== 0 && c !== 1);
    if (code !== undefined)
      return { error: `“${g.name}” holds ${code}: enter 1 for an event, 0 for a censored subject.` };
    // Cox regression rejects time ≤ 0, and plan 27 says it is an error — the
    // log-rank (and Cox on a Survival table, which shares this check) used to
    // accept a time of 0 and return a p-value for it. Reject it here, in
    // words, naming the group and the offending time.
    const badTime = g.x.find((t) => t <= 0);
    if (badTime !== undefined)
      return { error: `Survival times must be positive — “${g.name}” holds ${num(badTime)}.` };
  }
  if (groups.length < 2) return { error: "This analysis compares at least 2 groups holding subjects." };
  // With no event anywhere there is nothing to compare: survfit/survdiff
  // return a meaningless chi-square of 0 (P = 1), the Gehan test crashes in
  // solve() on a singular matrix, and coxph/cox.zph crash subscripting an
  // empty table. Say so up front, in words, instead of any of that.
  if (!groups.some((g) => g.y.some((c) => c === 1)))
    return { error: "No events were recorded — every subject is censored, so there is nothing to compare." };
  return groups;
}
