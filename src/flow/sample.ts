// FlowJo track, seq 441 (F1a): the flow sample's reference model — what a
// sample is in the `.hlx` file. Event data NEVER lives here: the file holds
// the FCS file path/reference + parameter metadata + placeholders for the
// gating / compensation / transform fields later lanes fill in. The events
// themselves live in the columnar store (`src/flow/store.ts`, Rust side in
// `src-tauri/src/flow_store.rs`) and are loaded from the referenced file.
//
// Node-shape decision (scope doc §5 offered two): a sample is its own node
// kind, `"sample"` — not optional fields on a table node. A table node
// requires `data` (a string grid, which cannot hold events), so a sample
// cannot be a table; and a sample is a first-class project item (it owns the
// gating tree, the spillover matrix and the per-parameter transforms), not
// an annotation on something else. Summary tables and population-stats
// analyses derived from a sample are ordinary table/analysis nodes that name
// their samples in `flowSourceSampleIds` (see `src/flow/summary.ts`).
// Sample nodes live at the project root (`parentId: null`), like info
// sheets and figures.

import type { ProjectNode } from "../store/types";

/** One FCS parameter ($PnN), as the file spells it. */
export interface FlowParameterMeta {
  /** Parameter name, e.g. "FSC-A", "CD4" ($PnN). */
  name: string;
  /** Stain / fluorochrome for this parameter ($PnS), when the file names one. */
  stain?: string;
  /** Full-scale range in raw channel units ($PnR). */
  range?: number;
  /** Bits per value ($PnB). */
  bits?: number;
  /** Display scale the file prefers for this parameter ($PnD family). */
  displayScale?: "linear" | "log" | "logicle";
}

/** A spillover (compensation) matrix for one sample. F1a only carries it:
 *  inverting and applying it is the compensation lane's job (F2). */
export interface FlowCompensationRef {
  /** Fluorochromes, in the matrix's row/column order. */
  fluorochromes: string[];
  /** The spillover matrix, rows in `fluorochromes` order. */
  spillover: number[][];
  /** Where the matrix came from: the FCS file ($SPILLOVER / $SPILL), a CSV, or typed by hand. */
  source: "file" | "csv" | "manual";
  /** True once the matrix has been applied to the stored events. */
  applied: boolean;
}

/** One per-parameter display transform. F1a only carries it: the transform
 *  math (logicle/biexponential, arcsinh, Hyperlog) is a later lane's job. */
export interface FlowTransformRef {
  /** The parameter this transform applies to, by name. */
  parameter: string;
  kind: "log" | "logicle" | "arcsinh" | "hyperlog" | "linear";
  /** Kind-specific numbers (logicle W/T/M/A, arcsinh cofactor, …). */
  params: Record<string, number>;
}

/** A 1-D range gate on one parameter (seq 449, F2c): half-open [min, max)
 *  — the lower bound is inclusive, the upper exclusive — so a pair of
 *  gates at the same cut partitions the events with no overlap and no gap.
 *  Phase 3 adds gate geometry as new `kind`s; the forgiving reader drops
 *  an unknown kind, never trusts it. */
export interface FlowPopulationPredicate {
  kind: "range";
  param: string;
  min?: number;
  max?: number;
}

/** One gated population. F1a only carries the tree shape: gate geometry
 *  (rect / polygon / ellipse / quadrant) is the gating lane's job (F3).
 *  F2c adds the 1-D range predicate — enough to select a population for
 *  statistics before geometry exists. */
export interface FlowPopulationRef {
  id: string;
  name: string;
  /** The parent population's id, or null for the root (all events). */
  parentId: string | null;
  /** The gate selecting this population from its parent, when it has one.
   *  A population without a predicate is its parent's events. */
  predicate?: FlowPopulationPredicate;
}

/** The gating tree of one sample: populations in tree order. */
export interface FlowGatingRef {
  populations: FlowPopulationRef[];
}

/** A flow sample as the `.hlx` file holds it: a reference to the event
 *  data, never the data itself. `sampleId` is the id the event store knows
 *  the sample by — by convention the id of the sample node itself. */
export interface FlowSampleRef {
  /** The event-store sample id (== the sample node's id, by convention). */
  sampleId: string;
  /** The FCS file's path as saved. May be relative to the `.hlx` file. */
  sourcePath: string;
  /** What `sourcePath` points at: an FCS file, or a Titer sidecar binary
   *  (the `.tfcs` column-major f32 format `flow_store.rs` documents). */
  sourceKind: "fcs" | "sidecar";
  /** Display name — usually the FCS $FIL keyword or the file name. */
  name: string;
  /** Event count ($TOT), as the file reports it. */
  eventCount: number;
  /** The parameters, in file order ($P1N…$PnN). */
  parameters: FlowParameterMeta[];
  /** Instrument ($CYT), when the file names one. */
  instrument?: string;
  /** Acquisition time ($BTIM / $DATE), as ISO text when known. */
  acquiredAt?: string;
  /** The spillover matrix, when the file (or the user) supplies one. */
  compensation?: FlowCompensationRef;
  /** Per-parameter display transforms, when any are set. */
  transforms?: FlowTransformRef[];
  /** The gating tree, when any gates exist. */
  gating?: FlowGatingRef;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonEmptyString = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
/** `obj` without its empty (undefined) fields. */
const defined = <T extends object>(obj: T) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
const oneOf = <T extends readonly string[]>(values: T, v: unknown): T[number] | undefined =>
  typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T[number]) : undefined;

/** One parameter as a file holds it, forgivingly: a parameter without a
 *  name is not a parameter, and a wrong-typed field is dropped, not trusted. */
function readParameterMeta(raw: unknown): FlowParameterMeta | null {
  if (!isObj(raw)) return null;
  const name = nonEmptyString(raw.name);
  if (!name) return null;
  return defined({
    name,
    stain: nonEmptyString(raw.stain),
    range: isFiniteNumber(raw.range) && (raw.range as number) > 0 ? (raw.range as number) : undefined,
    bits: isFiniteNumber(raw.bits) && (raw.bits as number) > 0 ? Math.floor(raw.bits as number) : undefined,
    displayScale: oneOf(["linear", "log", "logicle"] as const, raw.displayScale) as
      FlowParameterMeta["displayScale"] | undefined,
  });
}

function readCompensation(raw: unknown): FlowCompensationRef | undefined {
  if (!isObj(raw)) return undefined;
  const fluorochromes = Array.isArray(raw.fluorochromes)
    ? raw.fluorochromes.filter((f): f is string => typeof f === "string" && f !== "")
    : [];
  if (!fluorochromes.length) return undefined;
  if (!Array.isArray(raw.spillover) || raw.spillover.length !== fluorochromes.length) return undefined;
  const spillover: number[][] = [];
  for (const row of raw.spillover as unknown[]) {
    if (!Array.isArray(row) || row.length !== fluorochromes.length) return undefined;
    if (!row.every(isFiniteNumber)) return undefined;
    spillover.push([...(row as number[])]);
  }
  return {
    fluorochromes,
    spillover,
    source: oneOf(["file", "csv", "manual"] as const, raw.source) ?? "file",
    applied: raw.applied === true,
  };
}

function readTransforms(raw: unknown): FlowTransformRef[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: FlowTransformRef[] = [];
  for (const t of raw as unknown[]) {
    if (!isObj(t)) continue;
    const parameter = nonEmptyString(t.parameter);
    const kind = oneOf(["log", "logicle", "arcsinh", "hyperlog", "linear"] as const, t.kind);
    if (!parameter || !kind) continue;
    const params: Record<string, number> = {};
    if (isObj(t.params)) {
      for (const [k, v] of Object.entries(t.params)) if (isFiniteNumber(v)) params[k] = v;
    }
    out.push({ parameter, kind, params });
  }
  return out.length ? out : undefined;
}

function readPredicate(raw: unknown): FlowPopulationPredicate | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.kind !== "range") return undefined;
  const param = nonEmptyString(raw.param);
  if (!param) return undefined;
  const min = isFiniteNumber(raw.min) ? (raw.min as number) : undefined;
  const max = isFiniteNumber(raw.max) ? (raw.max as number) : undefined;
  if (min !== undefined && max !== undefined && min > max) return undefined;
  return defined({ kind: "range" as const, param, min, max });
}

function readGating(raw: unknown): FlowGatingRef | undefined {
  if (!isObj(raw) || !Array.isArray(raw.populations)) return undefined;
  const populations: FlowPopulationRef[] = [];
  for (const p of raw.populations as unknown[]) {
    if (!isObj(p)) continue;
    const id = nonEmptyString(p.id);
    const name = nonEmptyString(p.name);
    if (!id || !name) continue;
    const population: FlowPopulationRef = {
      id,
      name,
      parentId: p.parentId === null || typeof p.parentId === "string" ? (p.parentId as string | null) : null,
    };
    const predicate = readPredicate(p.predicate);
    if (predicate) population.predicate = predicate;
    populations.push(population);
  }
  return populations.length ? { populations } : undefined;
}

/** A flow sample reference as a file holds it, forgivingly: names match
 *  whatever their case, a value of the wrong type falls back to its default,
 *  a parameter without a name is dropped, and a sample with no parameters
 *  at all is not a sample (null). Fields this version doesn't know are kept,
 *  so saving doesn't lose them. */
export function readFlowSample(raw: unknown): FlowSampleRef | null {
  if (!isObj(raw)) return null;
  const sampleId = nonEmptyString(raw.sampleId);
  const parameters = (Array.isArray(raw.parameters) ? raw.parameters : [])
    .map(readParameterMeta)
    .filter((p): p is FlowParameterMeta => p !== null);
  if (!sampleId || !parameters.length) return null;
  // Unknown keys are carried through, like any other node's: a newer Titer's
  // fields survive an older Titer's save.
  const known = new Set([
    "sampleId",
    "sourcePath",
    "sourceKind",
    "name",
    "eventCount",
    "parameters",
    "instrument",
    "acquiredAt",
    "compensation",
    "transforms",
    "gating",
  ]);
  const unknowns = Object.fromEntries(Object.entries(raw).filter(([k]) => !known.has(k)));
  return defined({
    ...unknowns,
    sampleId,
    sourcePath: typeof raw.sourcePath === "string" ? raw.sourcePath : "",
    sourceKind: oneOf(["fcs", "sidecar"] as const, raw.sourceKind) ?? "fcs",
    name: typeof raw.name === "string" && raw.name !== "" ? raw.name : sampleId,
    eventCount:
      isFiniteNumber(raw.eventCount) && (raw.eventCount as number) >= 0 ? Math.floor(raw.eventCount as number) : 0,
    parameters,
    instrument: nonEmptyString(raw.instrument),
    acquiredAt: nonEmptyString(raw.acquiredAt),
    compensation: readCompensation(raw.compensation),
    transforms: readTransforms(raw.transforms),
    gating: readGating(raw.gating),
  });
}

/** A sample node for a project: kind `"sample"`, at the project root, its
 *  `flowSample` the reference above. The node id and the sample id are the
 *  same by convention, so the store lookup needs no extra mapping. */
export function createSampleNode(id: string, name: string, ref: FlowSampleRef): ProjectNode {
  return { id, type: "sample", name, parentId: null, flowSample: { ...ref, sampleId: id } };
}

/** True when the node is a flow sample (kind `"sample"` with a readable
 *  `flowSample` reference). */
export function isSampleNode(node: ProjectNode): node is ProjectNode & { flowSample: FlowSampleRef } {
  return node.type === "sample" && isObj(node.flowSample) && readFlowSample(node.flowSample) !== null;
}
