// Graph / figure / info-sheet jobs for the MCP dispatcher (v1.6.0 L6,
// inventory §3.4): the seven tools `titer_build_graph`,
// `titer_update_graph`, `titer_clone_graph`, `titer_create_figure`,
// `titer_update_figure`, `titer_create_info_sheet` and
// `titer_update_info_sheet`.
//
// The dispatcher is the authority here, not Rust: it has the live store
// and `GRAPH_OPTIONS_BY_TABLE`, so it validates the graph type against
// the table's offers, the partial `GraphOptions` against the choice
// lists / limits, and the linked-analysis ids against the existing
// analyses. Rust only resolves the project and passes the raw JSON args
// through (same split as L2's `mcp-document.ts`).
//
// Multi-table graphs (#48) are NOT in scope (GAP-7): every tool here
// takes one table (build/clone) or the graphs it names (figures).
import { GRAPH_OPTIONS_BY_TABLE, newGraphOptions } from "../views/graphs";
import { PALETTES, paletteNamed, savedPalette } from "../lib/palettes";
import {
  DEFAULT_FIGURE_SIZE,
  DEFAULT_LABEL_STYLE,
  FIGURE_MAX_COLS,
  FIGURE_RESOLUTIONS,
  assignLabels,
  duplicateLabels,
  newFigurePanels,
  panelsOverlap,
  sharedLegendCheck,
  validateFigureSize,
} from "../lib/figure";
import { DEFAULT_CLONE_OPTIONS, type CloneOptions } from "../lib/clone-graph";
import { MAX_INFO_CONSTANTS, MAX_INFO_SHEETS, allConstantNames, newConstantId } from "../lib/info-sheets";
import type { McpJob } from "../native";
import {
  DEFAULT_GRAPH_OPTIONS,
  FILL_PATTERNS,
  GRAPH_CHOICES,
  GRAPH_LIMITS,
  PALETTE_KINDS,
  REF_LABEL_PLACES,
  type FigureGrid,
  type FigureLabelStyle,
  type FigurePanel,
  type FigureSize,
  type GraphOptions,
  type GraphPalette,
  type GraphType,
  type InfoSheetData,
  type LabelPosition,
  type ProjectNode,
  type RefLine,
  type Resolution,
  type SharedLegend,
  type TableType,
} from "./types";

/** The project as a graph job sees it (the dispatcher's `getState()`). */
export interface GraphJobState {
  nodes: Record<string, ProjectNode>;
  rootOrder: string[];
  childOrder: Record<string, string[]>;
  activeNodeId: string | null;
}

/** A figure's patch, as the store's `updateFigure` takes it. */
export type FigurePatch = Partial<{
  panels: FigurePanel[];
  grid: FigureGrid;
  figureSize: FigureSize;
  labelStyle: FigureLabelStyle;
  figureTitle: string;
  sharedLegend: SharedLegend;
  dpi: Resolution;
}>;

/** What a graph job needs from the app. The hook passes the real store
 *  actions; a harness driving only `noop` / `run-analysis` may omit
 *  them, and a graph job then errors plainly. */
export interface GraphJobDeps {
  getState: () => GraphJobState;
  createGraph?: (parentId: string, graphType: GraphType, graphOptions?: GraphOptions) => string;
  updateGraph?: (id: string, options: GraphOptions) => void;
  cloneGraph?: (graphId: string, options: CloneOptions) => string;
  createFigure?: (graphIds?: string[]) => string;
  updateFigure?: (id: string, patch: FigurePatch) => void;
  createInfoSheet?: (linkedTableId?: string | null) => string;
  updateInfoSheet?: (id: string, info: InfoSheetData) => void;
  renameNode?: (id: string, name: string) => void;
}

/** What one graph job reports: the tool's output, and what it created
 *  (for `titer_read_job`'s `created` field). */
export interface GraphJobOutcome {
  result: Record<string, unknown>;
  created?: Record<string, unknown>;
}

/** `Job <id> (<action>) …` — the plain-language error prefix, as the
 *  other dispatch branches use it. */
const jobErr = (job: McpJob, message: string) => new Error(`Job ${job.job_id} (${job.action}) ${message}`);

/** A table type's name, as the UI spells it. */
const TABLE_TYPE_LABELS: Record<TableType, string> = {
  column: "Column",
  xy: "XY",
  grouped: "Grouped",
  nested: "Nested",
  multiple: "Multiple variables",
  contingency: "Contingency",
  survival: "Survival",
};

// ── Job-arg readers ────────────────────────────────────────────────────

function argsOf(job: McpJob): Record<string, unknown> {
  const args = job.args as Record<string, unknown> | null | undefined;
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw jobErr(job, "has no arguments object.");
  return args;
}

function reqStr(job: McpJob, args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (value === undefined || value === null) throw jobErr(job, `needs “${name}”.`);
  if (typeof value !== "string" || value === "") throw jobErr(job, `“${name}” must be a non-empty string.`);
  return value;
}

function optStr(job: McpJob, args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw jobErr(job, `“${name}” must be a string.`);
  return value;
}

function reqObj(job: McpJob, args: Record<string, unknown>, name: string): Record<string, unknown> {
  const value = args[name];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw jobErr(job, `needs “${name}” as an object.`);
  return value as Record<string, unknown>;
}

/** The store action a job needs, or a plain error saying the window can't do it. */
function need<T>(job: McpJob, action: T | undefined, verb: string): T {
  if (!action) throw jobErr(job, `this window can't ${verb} (no store action wired for it).`);
  return action;
}

// ── GraphOptions validation ────────────────────────────────────────────

/** Choice fields: the option name, and which `GRAPH_CHOICES` list it draws from. */
const CHOICE_FIELDS: Record<string, keyof typeof GRAPH_CHOICES> = {
  center: "center",
  error: "error",
  shape: "shape",
  kind: "kind",
  xyStyle: "xyStyle",
  xyReplicates: "xyReplicates",
  pieValue: "pieValue",
  groupLayout: "groupLayout",
  stackAs: "stackAs",
  sigDisplay: "sigDisplay",
  regBand: "regBand",
  residualsAs: "residualsAs",
  survivalMode: "survivalMode",
  volcanoEffect: "volcanoEffect",
  volcanoSignificance: "volcanoSignificance",
  pointShape: "pointShape",
  lineDash: "lineDash",
  errorDirection: "errorDirection",
  background: "background",
  gridX: "gridX",
  gridY: "gridY",
  tickDirection: "tickDirection",
  xScale: "xScale",
  yScale: "yScale",
  y2Scale: "y2Scale",
};

/** Numerics with a `GRAPH_LIMITS` entry (the limit's key is the option's name). */
const LIMIT_FIELDS = Object.keys(GRAPH_LIMITS);

/** Numerics with no limit: any finite number. A step (tick interval) must
 *  be positive — a 0 or negative step draws no ticks. `binWidth` 0 and
 *  under reads as R's own bins, so it stays unconstrained. */
const PLAIN_NUMBER_FIELDS = ["yMin", "yMax", "xMin", "xMax", "y2Min", "y2Max", "binWidth"];
const POSITIVE_NUMBER_FIELDS = ["yStep", "xStep", "y2Step"];

/** Boolean fields. */
const BOOLEAN_FIELDS = [
  "bars",
  "showPoints",
  "estimationViolin",
  "pieShowPercent",
  "regShowLine",
  "regShowBand",
  "regShowEquation",
  "demingShowLine",
  "demingShowOls",
  "demingShowEquation",
  "smoothShowCurve",
  "heatmapShowValues",
  "heatmapShowScale",
  "beforeAfterArrows",
  "survivalShowCensors",
  "survivalShowBand",
  "survivalShowAtRisk",
  "volcanoYIsPValue",
  "volcanoShowThresholds",
];

/** Plain string fields. */
const STRING_FIELDS = [
  "title",
  "xLabel",
  "yLabel",
  "rightYDataset",
  "y2Label",
  "xVariable",
  "yVariable",
  "bubbleSizeVariable",
  "bubbleColorVariable",
  "volcanoX",
  "volcanoY",
  "volcanoLabel",
  "volcanoGroupA",
  "volcanoGroupB",
  "outlineColor",
  "pointOutlineColor",
  "errorColor",
];

/** The options that name a sibling analysis (see `GraphOptions`): the
 *  graph draws its brackets / lines / curves from that analysis's cached
 *  result. All eleven — `clone-graph`'s `GRAPH_ANALYSIS_LINKS` lists ten
 *  (it omits `ttestAnalysisId`; see the lane log), but validation here
 *  covers the field the graphs actually read. */
const LINK_FIELDS = [
  "sigAnalysisId",
  "regAnalysisId",
  "demingAnalysisId",
  "coxAnalysisId",
  "ttestAnalysisId",
  "poissonAnalysisId",
  "pcaAnalysisId",
  "kmeansAnalysisId",
  "hclustAnalysisId",
  "smoothAnalysisId",
  "monteCarloAnalysisId",
];

/** Axis limits hooked to an info constant (the constant's name, not its
 *  value): resolved live, so a hook naming a constant that doesn't exist
 *  yet is a warning, never an error. */
const CONSTANT_HOOK_FIELDS = ["yMinConstant", "yMaxConstant", "xMinConstant", "xMaxConstant"];

/** Every `GraphOptions` field, for the unknown-key error. */
const GRAPH_OPTION_KEYS = [
  ...Object.keys(CHOICE_FIELDS),
  ...LIMIT_FIELDS,
  ...PLAIN_NUMBER_FIELDS,
  ...POSITIVE_NUMBER_FIELDS,
  ...BOOLEAN_FIELDS,
  ...STRING_FIELDS,
  ...LINK_FIELDS,
  ...CONSTANT_HOOK_FIELDS,
  "sigAnalysisIds",
  "sigPairs",
  "sets",
  "refLines",
  "palette",
  "series",
  "points",
  "legend",
  "note",
].sort();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A palette as the tool spells it: a built-in palette's name (resolved
 *  against the catalog, case-insensitively by name or label), or a full
 *  `{ name, kind, colors, reversed? }` object. My-palettes (user-saved)
 *  are out of scope — no name lookup against them (see the lane log). */
function validatedPalette(job: McpJob, value: unknown): GraphPalette {
  if (typeof value === "string") {
    const found =
      paletteNamed(value) ??
      PALETTES.find((p) => p.name.toLowerCase() === value.toLowerCase() || p.label.toLowerCase() === value.toLowerCase());
    if (!found)
      throw jobErr(
        job,
        `unknown palette “${value}” — Titer's palettes are: ${PALETTES.map((p) => p.name).join(", ")}. ` +
          `Or pass a full palette object { name, kind, colors }.`,
      );
    return savedPalette(found);
  }
  if (!isPlainObject(value)) throw jobErr(job, `“palette” must be a palette name or an object { name, kind, colors }.`);
  const name = value.name;
  if (typeof name !== "string" || !name) throw jobErr(job, `“palette.name” must be a non-empty string.`);
  const kind = value.kind;
  if (typeof kind !== "string" || !(PALETTE_KINDS as readonly string[]).includes(kind))
    throw jobErr(job, `“palette.kind” must be one of: ${PALETTE_KINDS.join(", ")}.`);
  const colors = value.colors;
  if (!Array.isArray(colors) || colors.length === 0 || !colors.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c)))
    throw jobErr(job, `“palette.colors” must be a non-empty list of hex colors, e.g. ["#E69F00", "#56B4E9"].`);
  const palette: GraphPalette = { name, kind: kind as GraphPalette["kind"], colors: [...(colors as string[])] };
  if (value.reversed !== undefined) {
    if (typeof value.reversed !== "boolean") throw jobErr(job, `“palette.reversed” must be a boolean.`);
    palette.reversed = value.reversed;
  }
  return palette;
}

function validatedSeries(job: McpJob, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw jobErr(job, `“series” must be an object keyed by series name.`);
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(value)) {
    if (!isPlainObject(style)) throw jobErr(job, `“series.${name}” must be an object { color?, shape?, dash?, pattern? }.`);
    for (const key of Object.keys(style))
      if (!["color", "shape", "dash", "pattern"].includes(key))
        throw jobErr(job, `unknown series style “${key}” on “${name}” — use color, shape, dash or pattern.`);
    if (style.color !== undefined && typeof style.color !== "string")
      throw jobErr(job, `“series.${name}.color” must be a color string.`);
    if (style.shape !== undefined && !((GRAPH_CHOICES.pointShape as readonly string[]).includes(style.shape as string)))
      throw jobErr(job, `“series.${name}.shape” must be one of: ${GRAPH_CHOICES.pointShape.join(", ")}.`);
    if (style.dash !== undefined && !((GRAPH_CHOICES.lineDash as readonly string[]).includes(style.dash as string)))
      throw jobErr(job, `“series.${name}.dash” must be one of: ${GRAPH_CHOICES.lineDash.join(", ")}.`);
    if (style.pattern !== undefined && !((FILL_PATTERNS as readonly string[]).includes(style.pattern as string)))
      throw jobErr(job, `“series.${name}.pattern” must be one of: ${FILL_PATTERNS.join(", ")}.`);
    out[name] = style;
  }
  return out;
}

function validatedPoints(job: McpJob, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw jobErr(job, `“points” must be an object keyed by "<column>#<row>".`);
  const out: Record<string, unknown> = {};
  for (const [key, style] of Object.entries(value)) {
    if (!isPlainObject(style)) throw jobErr(job, `“points.${key}” must be an object.`);
    for (const field of Object.keys(style))
      if (!["color", "size", "shape", "fill", "outline", "outlineColor", "label", "labelOffset"].includes(field))
        throw jobErr(job, `unknown point style “${field}” on “${key}”.`);
    if (style.color !== undefined && typeof style.color !== "string")
      throw jobErr(job, `“points.${key}.color” must be a color string.`);
    if (style.size !== undefined && (!isFiniteNumber(style.size) || style.size <= 0))
      throw jobErr(job, `“points.${key}.size” must be a positive number.`);
    if (style.shape !== undefined && !((GRAPH_CHOICES.pointShape as readonly string[]).includes(style.shape as string)))
      throw jobErr(job, `“points.${key}.shape” must be one of: ${GRAPH_CHOICES.pointShape.join(", ")}.`);
    if (style.fill !== undefined && (!isFiniteNumber(style.fill) || style.fill < 0 || style.fill > 1))
      throw jobErr(job, `“points.${key}.fill” must be between 0 and 1.`);
    if (style.outline !== undefined && (!isFiniteNumber(style.outline) || style.outline < 0))
      throw jobErr(job, `“points.${key}.outline” must be 0 or more.`);
    if (style.outlineColor !== undefined && typeof style.outlineColor !== "string")
      throw jobErr(job, `“points.${key}.outlineColor” must be a color string.`);
    if (style.label !== undefined && typeof style.label !== "boolean")
      throw jobErr(job, `“points.${key}.label” must be a boolean.`);
    if (style.labelOffset !== undefined) {
      if (!isPlainObject(style.labelOffset) || !isFiniteNumber(style.labelOffset.x) || !isFiniteNumber(style.labelOffset.y))
        throw jobErr(job, `“points.${key}.labelOffset” must be { x, y } numbers.`);
    }
    out[key] = style;
  }
  return out;
}

function validatedPlace(job: McpJob, name: string, value: unknown): { x: number; y: number } {
  if (!isPlainObject(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y))
    throw jobErr(job, `“${name}” must be { x, y } numbers.`);
  return { x: value.x, y: value.y };
}

/** Reference lines as the tool spells them: `{ value }` each, with the
 *  panel's defaults (`dash`, width 1) where left out. */
function validatedRefLines(job: McpJob, value: unknown): RefLine[] {
  if (!Array.isArray(value)) throw jobErr(job, `“refLines” must be a list of { value, dash?, width?, color?, label?, labelPlace? }.`);
  return value.map((line, i) => {
    if (!isPlainObject(line) || !isFiniteNumber(line.value))
      throw jobErr(job, `“refLines[${i}].value” must be a number (the value on the value axis).`);
    if (line.dash !== undefined && !((GRAPH_CHOICES.lineDash as readonly string[]).includes(line.dash as string)))
      throw jobErr(job, `“refLines[${i}].dash” must be one of: ${GRAPH_CHOICES.lineDash.join(", ")}.`);
    if (
      line.width !== undefined &&
      (!isFiniteNumber(line.width) || line.width < GRAPH_LIMITS.lineWidth.min || line.width > GRAPH_LIMITS.lineWidth.max)
    )
      throw jobErr(
        job,
        `“refLines[${i}].width” must be between ${GRAPH_LIMITS.lineWidth.min} and ${GRAPH_LIMITS.lineWidth.max}.`,
      );
    if (line.color !== undefined && typeof line.color !== "string")
      throw jobErr(job, `“refLines[${i}].color” must be a color string.`);
    if (line.label !== undefined && typeof line.label !== "string")
      throw jobErr(job, `“refLines[${i}].label” must be a string.`);
    if (line.labelPlace !== undefined && !((REF_LABEL_PLACES as readonly string[]).includes(line.labelPlace as string)))
      throw jobErr(job, `“refLines[${i}].labelPlace” must be one of: ${REF_LABEL_PLACES.join(", ")}.`);
    const out: RefLine = { value: line.value, dash: (line.dash as RefLine["dash"]) ?? "dash", width: line.width ?? 1 };
    if (line.color !== undefined) out.color = line.color as string;
    if (line.label !== undefined) out.label = line.label as string;
    if (line.labelPlace !== undefined) out.labelPlace = line.labelPlace as RefLine["labelPlace"];
    return out;
  });
}

/** One linked analysis id, checked: a missing id, or one naming a non-analysis, is an
 *  error; one from another table, or not computed yet, is a warning (the graph still
 *  builds — it shows the link as missing until the analysis is run). */
function checkLink(
  job: McpJob,
  key: string,
  value: string,
  state: GraphJobState,
  tableId: string | undefined,
  warnings: string[],
): void {
  const linked = state.nodes[value];
  if (!linked) throw jobErr(job, `no analysis with id “${value}” for option “${key}” — run titer_list_projects to see the analyses.`);
  if (linked.type !== "analysis")
    throw jobErr(job, `“${value}” for option “${key}” is a ${linked.type}, not an analysis.`);
  // Not for `sigAnalysisIds`: a multi-source significance list names copy
  // tables by design, so another table is the normal case, not a warning.
  if (key !== "sigAnalysisIds" && tableId && linked.parentId !== tableId)
    warnings.push(
      `Linked analysis “${linked.name}” (${key}) belongs to another table — the graph reads its cached result as-is.`,
    );
  if (!linked.cachedResult)
    warnings.push(
      `Linked analysis “${linked.name}” (${key}) has not been computed yet — the graph will show it as missing until it is run (titer_run_analysis).`,
    );
}

/**
 * A partial `GraphOptions` as the tool spells it, validated field by
 * field. Unknown keys are rejected (the error names the valid fields);
 * a linked analysis that doesn't exist is an error; a linked analysis
 * that isn't a child of the source table, or isn't computed yet, is a
 * warning (the graph still builds — it shows the link as missing until
 * the analysis is run).
 */
function validateGraphOptions(
  job: McpJob,
  raw: unknown,
  state: GraphJobState,
  tableId: string | undefined,
): { options: Partial<GraphOptions>; warnings: string[] } {
  if (raw === undefined || raw === null) return { options: {}, warnings: [] };
  if (!isPlainObject(raw)) throw jobErr(job, `“options” must be an object of graph options.`);
  const options: Record<string, unknown> = {};
  const warnings: string[] = [];
  const knownConstants = new Set(allConstantNames(state.nodes, state.rootOrder));
  for (const [key, value] of Object.entries(raw)) {
    if (!GRAPH_OPTION_KEYS.includes(key))
      throw jobErr(
        job,
        `unknown graph option “${key}” — the graph options are: ${GRAPH_OPTION_KEYS.join(", ")}.`,
      );
    if (key in CHOICE_FIELDS) {
      const choices = GRAPH_CHOICES[CHOICE_FIELDS[key]] as readonly string[];
      if (typeof value !== "string" || !choices.includes(value))
        throw jobErr(job, `option “${key}” must be one of: ${choices.join(", ")} — got ${JSON.stringify(value)}.`);
      options[key] = value;
    } else if (LIMIT_FIELDS.includes(key)) {
      const { min, max } = GRAPH_LIMITS[key as keyof typeof GRAPH_LIMITS];
      if (!isFiniteNumber(value) || value < min || value > max)
        throw jobErr(
          job,
          Number.isFinite(max)
            ? `option “${key}” must be between ${min} and ${max} — got ${JSON.stringify(value)}.`
            : `option “${key}” must be ${min} or more — got ${JSON.stringify(value)}.`,
        );
      options[key] = value;
    } else if (PLAIN_NUMBER_FIELDS.includes(key)) {
      if (!isFiniteNumber(value)) throw jobErr(job, `option “${key}” must be a number — got ${JSON.stringify(value)}.`);
      options[key] = value;
    } else if (POSITIVE_NUMBER_FIELDS.includes(key)) {
      if (!isFiniteNumber(value) || value <= 0)
        throw jobErr(job, `option “${key}” must be a positive number — got ${JSON.stringify(value)}.`);
      options[key] = value;
    } else if (BOOLEAN_FIELDS.includes(key)) {
      if (typeof value !== "boolean") throw jobErr(job, `option “${key}” must be a boolean — got ${JSON.stringify(value)}.`);
      options[key] = value;
    } else if (STRING_FIELDS.includes(key)) {
      if (typeof value !== "string") throw jobErr(job, `option “${key}” must be a string — got ${JSON.stringify(value)}.`);
      options[key] = value;
    } else if (LINK_FIELDS.includes(key)) {
      if (typeof value !== "string" || !value) throw jobErr(job, `option “${key}” must be an analysis id.`);
      checkLink(job, key, value, state, tableId, warnings);
      options[key] = value;
    } else if (key === "sigAnalysisIds") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v))
        throw jobErr(job, `option “sigAnalysisIds” must be a list of analysis ids (strings).`);
      for (const id of value) checkLink(job, key, id, state, tableId, warnings);
      options[key] = [...new Set(value)];
    } else if (CONSTANT_HOOK_FIELDS.includes(key)) {
      if (typeof value !== "string" || !value) throw jobErr(job, `option “${key}” must be an info constant's name.`);
      if (!knownConstants.has(value))
        warnings.push(`Info constant “${value}” (${key}) does not exist yet — the hook resolves live once the constant is added.`);
      options[key] = value;
    } else if (key === "sigPairs") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
        throw jobErr(job, `option “sigPairs” must be a list of comparison keys (strings).`);
      options[key] = value;
    } else if (key === "sets") {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string" && v))
        throw jobErr(job, `option “sets” must be a list of data-set names (strings).`);
      options[key] = value;
    } else if (key === "refLines") {
      options[key] = validatedRefLines(job, value);
    } else if (key === "palette") {
      options[key] = validatedPalette(job, value);
    } else if (key === "series") {
      options[key] = validatedSeries(job, value);
    } else if (key === "points") {
      options[key] = validatedPoints(job, value);
    } else if (key === "legend" || key === "note") {
      options[key] = validatedPlace(job, key, value);
    }
  }
  return { options: options as Partial<GraphOptions>, warnings };
}

// ── Figure layout validation ─────────────────────────────────────────

/** A figure-layout patch as the tools spell it: the fields of the
 *  store's `updateFigure` patch, minus `panels` on create (a created
 *  figure's panels come from `graph_ids`; place them by hand with
 *  `titer_update_figure`). */
export interface ValidatedFigureLayout {
  patch: FigurePatch;
  /** The panels the figure ends up with (create: built from `graph_ids`;
   *  update: the patched panels, or the figure's current ones). */
  panels: FigurePanel[];
}

function reqInt(job: McpJob, name: string, value: unknown, min: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min)
    throw jobErr(job, `“${name}” must be a whole number, ${min} or more — got ${JSON.stringify(value)}.`);
  return value;
}

function validateFigureLayout(
  job: McpJob,
  raw: unknown,
  state: GraphJobState,
  panels: FigurePanel[],
  grid: FigureGrid,
  allowPanels: boolean,
  /** What a partial label style / figure size merges over: the editor's
   *  defaults on create, the figure's own on update — the patch replaces
   *  them wholesale, so a partial update must carry the untouched fields. */
  base: { labelStyle: FigureLabelStyle; figureSize: FigureSize },
): ValidatedFigureLayout {
  if (raw === undefined || raw === null) {
    // No layout: panels + grid as given, nothing else to change. A shared
    // legend the figure already has stays valid only if the panels still
    // agree — checked by the caller through `panels`/`grid` when it
    // matters (update-figure checks it; create-figure starts at "none").
    return { patch: {}, panels };
  }
  if (!isPlainObject(raw)) throw jobErr(job, `“layout” must be an object { grid?, figureSize?, labelStyle?, figureTitle?, sharedLegend?, dpi?, panels? }.`);
  const patch: FigurePatch = {};
  let nextPanels = panels;
  let nextGrid = grid;

  if (raw.grid !== undefined) {
    if (!isPlainObject(raw.grid)) throw jobErr(job, `“layout.grid” must be { rows, cols }.`);
    const rows = reqInt(job, "layout.grid.rows", raw.grid.rows, 1);
    const cols = reqInt(job, "layout.grid.cols", raw.grid.cols, 1);
    if (cols > FIGURE_MAX_COLS)
      throw jobErr(job, `a figure has at most ${FIGURE_MAX_COLS} columns — got ${cols}.`);
    nextGrid = { rows, cols };
    patch.grid = nextGrid;
  }

  if (raw.panels !== undefined) {
    if (!allowPanels)
      throw jobErr(
        job,
        `“layout.panels” is not taken on create — the panels come from “graph_ids”. Place panels by hand with titer_update_figure.`,
      );
    if (!Array.isArray(raw.panels)) throw jobErr(job, `“layout.panels” must be a list of panels.`);
    const parsed: FigurePanel[] = raw.panels.map((p, i) => {
      if (!isPlainObject(p)) throw jobErr(job, `panel ${i} must be an object { graphId, label?, title?, row, col, rowSpan?, colSpan? }.`);
      const graphId = p.graphId;
      if (typeof graphId !== "string" || !graphId) throw jobErr(job, `panel ${i} needs a “graphId”.`);
      const graph = state.nodes[graphId];
      if (!graph) throw jobErr(job, `panel ${i} names no graph with id “${graphId}” — run titer_list_projects to see the graphs.`);
      if (graph.type !== "graph") throw jobErr(job, `panel ${i} names “${graph.name}”, a ${graph.type}, not a graph.`);
      if (p.label !== undefined && typeof p.label !== "string") throw jobErr(job, `panel ${i} “label” must be a string.`);
      if (p.labelManual !== undefined && typeof p.labelManual !== "boolean")
        throw jobErr(job, `panel ${i} “labelManual” must be a boolean.`);
      if (p.title !== undefined && typeof p.title !== "string") throw jobErr(job, `panel ${i} “title” must be a string.`);
      return {
        graphId,
        graphName: graph.name,
        label: (p.label as string | undefined) ?? "",
        labelManual: p.labelManual as boolean | undefined,
        title: (p.title as string | undefined) ?? "",
        row: reqInt(job, `panel ${i} “row”`, p.row, 0),
        col: reqInt(job, `panel ${i} “col”`, p.col, 0),
        rowSpan: p.rowSpan === undefined ? 1 : reqInt(job, `panel ${i} “rowSpan”`, p.rowSpan, 1),
        colSpan: p.colSpan === undefined ? 1 : reqInt(job, `panel ${i} “colSpan”`, p.colSpan, 1),
      };
    });
    // Labels are (re)assigned in reading order, except ones typed by hand.
    nextPanels = assignLabels(parsed);
    const dupes = duplicateLabels(nextPanels);
    if (dupes.length) throw jobErr(job, `panels share a label: ${dupes.join(", ")} — give each panel its own label.`);
    for (let a = 0; a < nextPanels.length; a++)
      for (let b = a + 1; b < nextPanels.length; b++)
        if (panelsOverlap(nextPanels[a], nextPanels[b]))
          throw jobErr(
            job,
            `panels “${nextPanels[a].label}” and “${nextPanels[b].label}” overlap — move one to a free cell.`,
          );
    patch.panels = nextPanels;
  }

  // Panels must fit the grid — whether the grid is new or the figure's own.
  for (const p of nextPanels)
    if (p.row + p.rowSpan > nextGrid.rows || p.col + p.colSpan > nextGrid.cols)
      throw jobErr(
        job,
        `panel “${p.label}” (row ${p.row}, col ${p.col}, ${p.rowSpan}×${p.colSpan}) does not fit the ${nextGrid.rows}×${nextGrid.cols} grid — pass a grid that fits, or move the panel.`,
      );

  if (raw.figureSize !== undefined) {
    if (!isPlainObject(raw.figureSize)) throw jobErr(job, `“layout.figureSize” must be { widthIn, heightIn }.`);
    const widthIn = raw.figureSize.widthIn === undefined ? base.figureSize.widthIn : raw.figureSize.widthIn;
    const heightIn = raw.figureSize.heightIn === undefined ? base.figureSize.heightIn : raw.figureSize.heightIn;
    if (!isFiniteNumber(widthIn) || !isFiniteNumber(heightIn))
      throw jobErr(job, `“layout.figureSize” needs numbers for widthIn and heightIn (inches).`);
    const checked = validateFigureSize({ widthIn, heightIn });
    if (checked.reason || !checked.size) throw jobErr(job, checked.reason ?? "bad figure size.");
    patch.figureSize = checked.size;
  }

  if (raw.labelStyle !== undefined) {
    if (!isPlainObject(raw.labelStyle)) throw jobErr(job, `“layout.labelStyle” must be { position?, fontSizePt?, bold? }.`);
    const labelStyle: FigureLabelStyle = { ...base.labelStyle };
    if (raw.labelStyle.position !== undefined) {
      const positions = ["top-left", "top-right", "above-panel"] as const;
      if (typeof raw.labelStyle.position !== "string" || !(positions as readonly string[]).includes(raw.labelStyle.position))
        throw jobErr(job, `“layout.labelStyle.position” must be one of: top-left, top-right, above-panel.`);
      labelStyle.position = raw.labelStyle.position as LabelPosition;
    }
    if (raw.labelStyle.fontSizePt !== undefined) {
      if (!isFiniteNumber(raw.labelStyle.fontSizePt) || raw.labelStyle.fontSizePt <= 0)
        throw jobErr(job, `“layout.labelStyle.fontSizePt” must be a positive number.`);
      labelStyle.fontSizePt = raw.labelStyle.fontSizePt;
    }
    if (raw.labelStyle.bold !== undefined) {
      if (typeof raw.labelStyle.bold !== "boolean") throw jobErr(job, `“layout.labelStyle.bold” must be a boolean.`);
      labelStyle.bold = raw.labelStyle.bold;
    }
    patch.labelStyle = labelStyle;
  }

  if (raw.figureTitle !== undefined) {
    if (typeof raw.figureTitle !== "string") throw jobErr(job, `“layout.figureTitle” must be a string.`);
    patch.figureTitle = raw.figureTitle;
  }

  if (raw.sharedLegend !== undefined) {
    if (raw.sharedLegend !== "none" && raw.sharedLegend !== "shared")
      throw jobErr(job, `“layout.sharedLegend” must be "none" or "shared".`);
    patch.sharedLegend = raw.sharedLegend as SharedLegend;
  }

  if (raw.dpi !== undefined) {
    if (typeof raw.dpi !== "string" || !(FIGURE_RESOLUTIONS as readonly string[]).includes(raw.dpi))
      throw jobErr(job, `“layout.dpi” must be one of: ${FIGURE_RESOLUTIONS.join(", ")}.`);
    patch.dpi = raw.dpi as Resolution;
  }

  for (const key of Object.keys(raw))
    if (!["panels", "grid", "figureSize", "labelStyle", "figureTitle", "sharedLegend", "dpi"].includes(key))
      throw jobErr(job, `unknown layout field “${key}” — use grid, figureSize, labelStyle, figureTitle, sharedLegend, dpi (and panels on update).`);

  // A shared legend is only sound when every panel's graph draws the same
  // series in the same colours — the editor refuses it otherwise, and so
  // does this tool (sharedLegendCheck's reason is the error).
  const effectiveLegend = patch.sharedLegend;
  if (effectiveLegend === "shared") {
    const check = sharedLegendCheck(nextPanels, state.nodes);
    if (!check.ok) throw jobErr(job, check.reason ?? "these panels cannot share one legend.");
  }

  return { patch, panels: nextPanels };
}

/** A panel as the tool output spells it (snake_case, like the other tools). */
const publicPanel = (p: FigurePanel) => ({
  graph_id: p.graphId,
  label: p.label,
  title: p.title,
  row: p.row,
  col: p.col,
  row_span: p.rowSpan,
  col_span: p.colSpan,
});

// ── The seven jobs ────────────────────────────────────────────────────

/** `titer_build_graph`: a graph of `graph_type` on `table_id`, with a
 *  partial `GraphOptions` over the type's defaults (incl. its palette
 *  and the table's error format, exactly as the UI's create-graph path).
 *  Synchronous — the builders are pure TS over table data + cached
 *  results. */
export function executeBuildGraph(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const tableId = reqStr(job, args, "table_id");
  const graphType = reqStr(job, args, "graph_type");
  const name = optStr(job, args, "name");
  if (name !== undefined && name === "") throw jobErr(job, `“name” must not be empty.`);
  const state = deps.getState();
  const table = state.nodes[tableId];
  if (!table) throw jobErr(job, `no table with id “${tableId}” — run titer_list_tables to see the tables.`);
  if (table.type !== "table") throw jobErr(job, `“${table.name}” is a ${table.type}, not a table.`);
  const tableType = table.tableType;
  if (!tableType) throw jobErr(job, `table “${table.name}” has no table type recorded.`);
  const offered = GRAPH_OPTIONS_BY_TABLE[tableType].map((o) => o.value);
  if (!(offered as readonly string[]).includes(graphType))
    throw jobErr(
      job,
      `graph type “${graphType}” is not offered for a ${TABLE_TYPE_LABELS[tableType]} table — ` +
        `the types for this table are: ${offered.join(", ")}.`,
    );
  const { options, warnings } = validateGraphOptions(job, args.options, state, tableId);
  const merged: GraphOptions = {
    ...newGraphOptions(graphType as GraphType, table.data?.errorFormat),
    ...options,
  };
  const createGraph = need(job, deps.createGraph, "create a graph");
  const graphId = createGraph(tableId, graphType as GraphType, merged);
  if (name !== undefined) need(job, deps.renameNode, "rename a graph")(graphId, name);
  const result: Record<string, unknown> = { project_id: job.project_id, graph_id: graphId, graph_type: graphType };
  if (warnings.length) result.warnings = warnings;
  return { result, created: { graph_id: graphId } };
}

/** `titer_update_graph`: a partial `GraphOptions` merged over the
 *  graph's current options (the reducer replaces them wholesale, so the
 *  merge happens here). Same validation as build. */
export function executeUpdateGraph(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const graphId = reqStr(job, args, "graph_id");
  if (args.options === undefined) throw jobErr(job, `needs “options” — the graph options to change.`);
  const state = deps.getState();
  const node = state.nodes[graphId];
  if (!node) throw jobErr(job, `no graph with id “${graphId}” — run titer_list_projects to see the graphs.`);
  if (node.type !== "graph") throw jobErr(job, `“${node.name}” is a ${node.type}, not a graph.`);
  const tableId = node.parentId && state.nodes[node.parentId]?.type === "table" ? node.parentId : undefined;
  const { options, warnings } = validateGraphOptions(job, args.options, state, tableId);
  const merged: GraphOptions = { ...DEFAULT_GRAPH_OPTIONS, ...(node.graphOptions ?? {}), ...options };
  need(job, deps.updateGraph, "update a graph")(graphId, merged);
  const result: Record<string, unknown> = { project_id: job.project_id, graph_id: graphId };
  if (warnings.length) result.warnings = warnings;
  return { result };
}

/** `titer_clone_graph`: Prism's clone — the graph, its data table and
 *  the analyses shown on it, with the Y values cleared by default
 *  (`clearY`/`clearX`/`clearTitles`, as the clone dialog offers them). */
export function executeCloneGraph(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const graphId = reqStr(job, args, "graph_id");
  const state = deps.getState();
  const node = state.nodes[graphId];
  if (!node) throw jobErr(job, `no graph with id “${graphId}” — run titer_list_projects to see the graphs.`);
  if (node.type !== "graph") throw jobErr(job, `“${node.name}” is a ${node.type}, not a graph.`);
  const table = node.parentId ? state.nodes[node.parentId] : undefined;
  if (!table || table.type !== "table") throw jobErr(job, `the graph “${node.name}” has no data table to clone.`);
  const raw = args.options;
  const cloneOptions: CloneOptions = { ...DEFAULT_CLONE_OPTIONS };
  if (raw !== undefined && raw !== null) {
    if (!isPlainObject(raw)) throw jobErr(job, `“options” must be an object { clearY?, clearX?, clearTitles? }.`);
    for (const key of Object.keys(raw)) {
      if (!["clearY", "clearX", "clearTitles"].includes(key))
        throw jobErr(job, `unknown clone option “${key}” — use clearY, clearX or clearTitles.`);
      if (typeof raw[key] !== "boolean") throw jobErr(job, `clone option “${key}” must be a boolean.`);
      cloneOptions[key as keyof CloneOptions] = raw[key] as boolean;
    }
  }
  const newGraphId = need(job, deps.cloneGraph, "clone a graph")(graphId, cloneOptions);
  return {
    result: { project_id: job.project_id, graph_id: newGraphId },
    created: { graph_id: newGraphId },
  };
}

/** The project's graphs, in sidebar order (tables in root order, each
 *  table's children in child order) — the `graph_ids` default. */
function allGraphIds(state: GraphJobState): string[] {
  const ids: string[] = [];
  for (const rootId of state.rootOrder) {
    const root = state.nodes[rootId];
    if (!root || root.type !== "table") continue;
    for (const childId of state.childOrder[rootId] ?? [])
      if (state.nodes[childId]?.type === "graph") ids.push(childId);
  }
  return ids;
}

/** `titer_create_figure`: a multi-panel layout over the given graphs —
 *  all graphs when `graph_ids` is omitted. `layout` is the figure's
 *  grid/title shape (see `validateFigureLayout`). */
export function executeCreateFigure(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const state = deps.getState();
  let graphIds: string[];
  if (args.graph_ids === undefined || args.graph_ids === null) {
    graphIds = allGraphIds(state);
    if (!graphIds.length)
      throw jobErr(job, "this project has no graphs yet — build one with titer_build_graph first, or pass graph_ids.");
  } else {
    if (!Array.isArray(args.graph_ids) || !args.graph_ids.every((v) => typeof v === "string"))
      throw jobErr(job, `“graph_ids” must be a list of graph ids.`);
    graphIds = [...(args.graph_ids as string[])];
    const seen = new Set<string>();
    for (const id of graphIds) {
      if (seen.has(id)) throw jobErr(job, `graph “${id}” is listed twice — a figure shows each graph once.`);
      seen.add(id);
      const graph = state.nodes[id];
      if (!graph) throw jobErr(job, `no graph with id “${id}” — run titer_list_projects to see the graphs.`);
      if (graph.type !== "graph") throw jobErr(job, `“${graph.name}” is a ${graph.type}, not a graph.`);
    }
  }
  const names: Record<string, string> = {};
  for (const id of graphIds) names[id] = state.nodes[id]?.name ?? id;
  const { panels, grid } = newFigurePanels(graphIds, names);
  const { patch } = validateFigureLayout(job, args.layout, state, panels, grid, false, {
    labelStyle: DEFAULT_LABEL_STYLE,
    figureSize: DEFAULT_FIGURE_SIZE,
  });
  const figureId = need(job, deps.createFigure, "create a figure")(graphIds);
  if (Object.keys(patch).length) need(job, deps.updateFigure, "lay out a figure")(figureId, patch);
  return {
    result: { project_id: job.project_id, figure_id: figureId, panels: panels.map(publicPanel) },
    created: { figure_id: figureId },
  };
}

/** `titer_update_figure`: panels, grid, titles — the `layout` patch, as
 *  the store's `updateFigure` takes it. */
export function executeUpdateFigure(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const figureId = reqStr(job, args, "figure_id");
  if (args.layout === undefined) throw jobErr(job, `needs “layout” — the figure fields to change.`);
  const state = deps.getState();
  const node = state.nodes[figureId];
  if (!node) throw jobErr(job, `no figure with id “${figureId}” — run titer_list_projects to see the figures.`);
  if (node.type !== "figure") throw jobErr(job, `“${node.name}” is a ${node.type}, not a figure.`);
  const currentPanels = node.panels ?? [];
  const currentGrid = node.grid ?? { rows: 1, cols: 1 };
  const { patch, panels } = validateFigureLayout(job, args.layout, state, currentPanels, currentGrid, true, {
    labelStyle: node.labelStyle ?? DEFAULT_LABEL_STYLE,
    figureSize: node.figureSize ?? DEFAULT_FIGURE_SIZE,
  });
  // A shared legend the figure already has must still hold after a
  // panel/grid change.
  const effectiveLegend = patch.sharedLegend ?? node.sharedLegend ?? "none";
  if (effectiveLegend === "shared") {
    const check = sharedLegendCheck(panels, state.nodes);
    if (!check.ok) throw jobErr(job, check.reason ?? "these panels cannot share one legend.");
  }
  if (!Object.keys(patch).length) throw jobErr(job, `“layout” changes nothing — pass a field to change.`);
  need(job, deps.updateFigure, "update a figure")(figureId, patch);
  return { result: { project_id: job.project_id, figure_id: figureId, panels: panels.map(publicPanel) } };
}

/** `titer_create_info_sheet`: an info sheet at the project root,
 *  optionally linked to one table (as the UI allows). A new sheet starts
 *  with Prism's six default constants, empty. */
export function executeCreateInfoSheet(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const linkedTableId = optStr(job, args, "linked_table_id");
  const state = deps.getState();
  if (linkedTableId !== undefined) {
    const table = state.nodes[linkedTableId];
    if (!table) throw jobErr(job, `no table with id “${linkedTableId}” to link the info sheet to.`);
    if (table.type !== "table") throw jobErr(job, `“${table.name}” is a ${table.type}, not a table.`);
  }
  const sheetCount = state.rootOrder.filter((id) => state.nodes[id]?.type === "info").length;
  if (sheetCount >= MAX_INFO_SHEETS)
    throw jobErr(job, `this project already has ${MAX_INFO_SHEETS} info sheets, the most Prism allows.`);
  const infoSheetId = need(job, deps.createInfoSheet, "create an info sheet")(linkedTableId ?? null);
  return {
    result: { project_id: job.project_id, info_sheet_id: infoSheetId, name: "Info Sheet" },
    created: { info_sheet_id: infoSheetId },
  };
}

/** `titer_update_info_sheet`: the sheet's constants/fields — a partial
 *  `InfoSheetData`, merged over the current sheet (the reducer replaces
 *  `info` wholesale, so the merge happens here). Constants set here are
 *  what graphs hook axes to. */
export function executeUpdateInfoSheet(job: McpJob, deps: GraphJobDeps): GraphJobOutcome {
  const args = argsOf(job);
  const infoSheetId = reqStr(job, args, "info_sheet_id");
  const raw = reqObj(job, args, "info");
  const state = deps.getState();
  const node = state.nodes[infoSheetId];
  if (!node) throw jobErr(job, `no info sheet with id “${infoSheetId}” — run titer_list_projects to see the info sheets.`);
  if (node.type !== "info") throw jobErr(job, `“${node.name}” is a ${node.type}, not an info sheet.`);
  const current: InfoSheetData = node.info ?? { constants: [], notes: "", linkedTableId: null };

  for (const key of Object.keys(raw))
    if (!["constants", "notes", "linkedTableId"].includes(key))
      throw jobErr(job, `unknown info field “${key}” — use constants, notes or linkedTableId.`);

  let constants = current.constants;
  if (raw.constants !== undefined) {
    if (!Array.isArray(raw.constants)) throw jobErr(job, `“info.constants” must be a list of { name, value, notes?, id? }.`);
    if (raw.constants.length > MAX_INFO_CONSTANTS)
      throw jobErr(job, `a sheet holds at most ${MAX_INFO_CONSTANTS} constants — got ${raw.constants.length}.`);
    const seenNames = new Set<string>();
    const seenIds = new Set<string>();
    constants = raw.constants.map((c, i) => {
      if (!isPlainObject(c)) throw jobErr(job, `constant ${i} must be an object { name, value, notes?, id? }.`);
      if (typeof c.name !== "string" || !c.name.trim())
        throw jobErr(job, `constant ${i} needs a non-empty “name”.`);
      if (seenNames.has(c.name)) throw jobErr(job, `two constants are named “${c.name}” — constant names must be unique in a sheet.`);
      seenNames.add(c.name);
      // Values are strings as Prism stores them ("0.5", "2018-07-23");
      // a number or boolean is stored as its plain text.
      if (typeof c.value !== "string" && typeof c.value !== "number" && typeof c.value !== "boolean")
        throw jobErr(job, `constant “${c.name}” needs a string “value” (a number is stored as its text).`);
      if (c.notes !== undefined && typeof c.notes !== "string")
        throw jobErr(job, `constant “${c.name}” “notes” must be a string.`);
      const id = c.id === undefined ? newConstantId() : c.id;
      if (typeof id !== "string" || !id) throw jobErr(job, `constant “${c.name}” “id” must be a non-empty string.`);
      if (seenIds.has(id)) throw jobErr(job, `two constants share the id “${id}”.`);
      seenIds.add(id);
      return {
        id,
        name: c.name,
        value: typeof c.value === "string" ? c.value : String(c.value),
        ...(c.notes !== undefined ? { notes: c.notes as string } : {}),
      };
    });
  }

  let notes = current.notes;
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== "string") throw jobErr(job, `“info.notes” must be a string.`);
    notes = raw.notes;
  }

  let linkedTableId = current.linkedTableId ?? null;
  if (raw.linkedTableId !== undefined) {
    if (raw.linkedTableId !== null) {
      if (typeof raw.linkedTableId !== "string")
        throw jobErr(job, `“info.linkedTableId” must be a table id, or null to unlink the sheet.`);
      const table = state.nodes[raw.linkedTableId];
      if (!table) throw jobErr(job, `no table with id “${raw.linkedTableId}” to link the info sheet to.`);
      if (table.type !== "table") throw jobErr(job, `“${table.name}” is a ${table.type}, not a table.`);
      linkedTableId = raw.linkedTableId;
    } else {
      linkedTableId = null;
    }
  }

  need(job, deps.updateInfoSheet, "update an info sheet")(infoSheetId, { constants, notes, linkedTableId });
  return { result: { project_id: job.project_id, info_sheet_id: infoSheetId } };
}
