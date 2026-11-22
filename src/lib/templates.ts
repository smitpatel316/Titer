// The template gallery + Welcome dialog (seq 167) — the built-in
// new-project templates. Prism's Welcome dialog lists templates and its
// Graph Portfolio; Titer had the files (.pzt, plan 38) but no in-app
// gallery, so a new project always started as one blank Column table.
//
// A built-in template is a table type plus, for the examples, sample data
// and the graphs it opens with. Pure: no React, no native calls, so
// checks.ts pins it without a window — and the MCP `titer_create_project`
// `template` param rides the same list, not a second one.

import { TABLES } from "../views/tables";
import type {
  GraphOptions,
  GraphType,
  ProjectNode,
  TableData,
  TableType,
} from "../store/types";

/** One gallery entry: a blank table of a type, or a worked example. */
export interface BuiltInTemplate {
  /** Stable id — the MCP `template` param and the gallery both use it. */
  id: string;
  name: string;
  description: string;
  tableType: TableType;
  kind: "blank" | "example";
  /** Example templates only: the sample data the table opens with. A blank
   *  template uses its table type's defaults instead. */
  data?: TableData;
  /** Example templates only: the graphs the template opens with, in order. */
  graphs?: { graphType: GraphType; options?: GraphOptions }[];
}

/** The blank template for a table type: one empty table, nothing else. */
const blank = (tableType: TableType, description: string): BuiltInTemplate => ({
  id: `blank-${tableType}`,
  name: `Blank ${TABLES[tableType].label} table`,
  description,
  tableType,
  kind: "blank",
});

/** The gallery: seven blanks (one per table type) + four worked examples. */
export const TEMPLATES: BuiltInTemplate[] = [
  blank("column", "An empty Column table — one group per column, one row per replicate."),
  blank("xy", "An empty XY table — X values in the first column, Y series after it."),
  blank("grouped", "An empty Grouped table — groups of replicate sub-columns."),
  blank("nested", "An empty Nested table — groups of subgroups of replicates."),
  blank("multiple", "An empty Multiple Variables table — one variable per column, one subject per row."),
  blank("contingency", "An empty Contingency table — row categories by outcome counts."),
  blank("survival", "An empty Survival table — one subject per row: its time, then 1 (event) or 0 (censored)."),
  {
    id: "example-dose-response",
    name: "Dose–response",
    description: "An XY table with a dose–response curve — log dose against response — and its scatter graph.",
    tableType: "xy",
    kind: "example",
    data: {
      columns: ["Title", "X", "Response"],
      rows: [
        [null, "-9", "4"],
        [null, "-8", "9"],
        [null, "-7", "20"],
        [null, "-6", "42"],
        [null, "-5", "68"],
        [null, "-4", "86"],
        [null, "-3", "95"],
        [null, "-2", "98"],
      ],
    },
    graphs: [{ graphType: "xy-scatter" }],
  },
  {
    id: "example-two-group",
    name: "Two-group comparison",
    description: "A Column table with Control and Treated measurements, and a mean-with-error-bars graph.",
    tableType: "column",
    kind: "example",
    data: {
      columns: ["Title", "Control", "Treated"],
      rows: [
        [null, "12", "18"],
        [null, "14", "21"],
        [null, "13", "19"],
        [null, "15", "22"],
        [null, "11", "20"],
        [null, "13", "19"],
      ],
    },
    graphs: [{ graphType: "mean-error" }],
  },
  {
    id: "example-survival",
    name: "Survival (two groups)",
    description: "A Survival table with two groups' times and event codes, and its Kaplan–Meier curve.",
    tableType: "survival",
    kind: "example",
    data: {
      columns: ["Title", "Time", "Group A", "Group B"],
      rows: [
        [null, "4", "1", null],
        [null, "7", "1", null],
        [null, "9", "0", null],
        [null, "12", "1", null],
        [null, "15", "1", null],
        [null, "18", "0", null],
        [null, "6", null, "1"],
        [null, "10", null, "1"],
        [null, "14", null, "1"],
        [null, "19", null, "0"],
        [null, "22", null, "1"],
        [null, "26", null, "0"],
      ],
    },
    graphs: [{ graphType: "survival" }],
  },
  {
    id: "example-contingency",
    name: "Treatment outcome (2×2)",
    description: "A Contingency table of responders by treatment arm, and its grouped-bars graph.",
    tableType: "contingency",
    kind: "example",
    data: {
      columns: ["Title", "Improved", "Not improved"],
      rows: [
        ["Drug", "42", "18"],
        ["Placebo", "25", "35"],
      ],
    },
    graphs: [{ graphType: "grouped-bars" }],
  },
];

/** A template by id, or undefined when no built-in template has it. */
export const templateById = (id: string): BuiltInTemplate | undefined =>
  TEMPLATES.find((t) => t.id === id);

/** The blank template for a table type — always one (the gallery holds all
 *  seven); the fallback builds one rather than returning undefined. */
export function blankTemplateFor(tableType: TableType): BuiltInTemplate {
  return (
    TEMPLATES.find((t) => t.kind === "blank" && t.tableType === tableType) ?? blank(tableType, "")
  );
}

// ── Graph Portfolio ──────────────────────────────────────────────────────
// Prism's Graph Portfolio is its set of example graphs; here each entry is
// the graph type and the example template that showcases it.

/** One portfolio entry: the graph type, and the template that shows it. */
export interface GraphPortfolioEntry {
  graphType: GraphType;
  templateId: string;
  label: string;
}

export const graphPortfolio: GraphPortfolioEntry[] = [
  { graphType: "xy-scatter", templateId: "example-dose-response", label: "Scatter — dose–response" },
  { graphType: "mean-error", templateId: "example-two-group", label: "Mean with error bars — two groups" },
  { graphType: "survival", templateId: "example-survival", label: "Survival curve — two groups" },
  { graphType: "grouped-bars", templateId: "example-contingency", label: "Grouped bars — treatment outcome" },
];

/** The example template that showcases a graph type, or undefined when the
 *  portfolio has no entry for it (only the showcased graphs are listed). */
export function templateForGraph(graphType: GraphType): BuiltInTemplate | undefined {
  const entry = graphPortfolio.find((e) => e.graphType === graphType);
  return entry ? templateById(entry.templateId) : undefined;
}

// ── Welcome dialog setting ───────────────────────────────────────────────

/** The localStorage key for "show the Welcome dialog on startup". Stored
 *  as "true" / "false"; absent reads as show (a new user sees it). */
export const WELCOME_KEY = "titer.show-welcome";

/** The stored setting, forgivingly: only an explicit "false" (or false)
 *  hides the dialog — anything absent, garbled or otherwise reads as show,
 *  so a bad value never silently takes the Welcome dialog away. */
export function parseWelcomeSetting(value: unknown): boolean {
  return value !== "false" && value !== false;
}

/** Whether the Welcome dialog shows: only on a fresh window (never when a
 *  file was opened into it), and only while the setting says to show it. */
export function shouldShowWelcome(storedValue: unknown, openedWithFile: boolean): boolean {
  return !openedWithFile && parseWelcomeSetting(storedValue);
}

// ── Applying a template ─────────────────────────────────────────────────

/** The project shape a template apply reads: its nodes and their order. */
export interface TemplateProject {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
}

/** The id of the fresh window's untouched table — the single Column table
 *  named "Table 1" with its default data and no children — or null when
 *  the project has been touched at all. Applying a template to a pristine
 *  project replaces that table (a new project holds one table, not two);
 *  anywhere else the template adds a table and nothing is lost. */
export function pristineBlankTableId(project: TemplateProject): string | null {
  if (project.rootOrder.length !== 1) return null;
  const id = project.rootOrder[0];
  const node = project.nodes[id];
  if (!node || node.type !== "table" || node.tableType !== "column" || node.name !== "Table 1") return null;
  if ((project.childOrder[id] ?? []).length !== 0) return null;
  const pristine = JSON.stringify(TABLES.column.defaultData());
  return JSON.stringify(node.data ?? null) === pristine ? id : null;
}

/** What applying a template does: the table to create (type, data, name)
 *  and the graphs to open under it — plus the pristine table it replaces,
 *  if any. The caller creates the nodes (store / MCP dispatch), so the plan
 *  stays pure and both paths apply a template the same way. */
export interface TemplateApplyPlan {
  replaceTableId: string | null;
  table: { tableType: TableType; data: TableData; name: string };
  graphs: { graphType: GraphType; options?: GraphOptions }[];
}

export function planTemplateApply(template: BuiltInTemplate, project: TemplateProject): TemplateApplyPlan {
  return {
    replaceTableId: pristineBlankTableId(project),
    table: {
      tableType: template.tableType,
      data: template.data ?? TABLES[template.tableType].defaultData(),
      // An example keeps its name in the sidebar; a blank takes the
      // store's own "Table" (numbered among the tables, as New Table does).
      name: template.kind === "example" ? template.name : "Table",
    },
    graphs: template.graphs ?? [],
  };
}
