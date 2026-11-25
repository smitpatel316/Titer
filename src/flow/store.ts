// FlowJo track, seq 441 (F1a): the columnar event store.
//
// MERGE NOTE (check/flowjo, F1a + F1b): this file is F1a's store, kept
// whole — InMemoryFlowStore + TauriFlowStore behind the async
// FlowEventStore interface below. F1b (seq 442) wrote a synchronous
// contract of the same five operations in this same path, and its viewer
// (src/flow/viewer.ts) and fixture loader (src/flow/fixture.ts) call the
// SYNCHRONOUS module-level functions — a Promise cannot be unwrapped
// synchronously, so the viewer cannot call the async interface. The
// synchronous facade at the bottom of this file preserves F1b's API
// exactly (same names, same throw-on-unknown behaviour, same
// { id, eventCount, params: [{ name, min, max }] } stats shape), backed
// by a module-level default InMemoryFlowStore — the stub
// (src/flow/store-stub.ts) is deleted; InMemoryFlowStore IS the in-memory
// implementation now. `setFlowStoreBackend` swaps that default backend
// and therefore takes an InMemoryFlowStore: only a synchronous in-memory
// store can serve the viewer's synchronous API (the Tauri store is
// async-only and is reached via `createFlowStore()`). Making the viewer
// async is a later lane's job, not this merge's.
//
// ── Store API contract (F1b builds against this; the Rust commands in
//    `src-tauri/src/flow_store.rs` expose the same five operations) ────────
//    loadSample(sampleId, columns, paramNames, meta?)
//      Load one sample's events, columnar: one Float32Array per parameter.
//      Rejects when the column count disagrees with `paramNames`, when
//      columns differ in length, or when a parameter name repeats.
//      Returns the sample's info (id, name, event count, parameter count).
//    getColumn(sampleId, param)
//      One parameter's events as a Float32Array, or null when the sample or
//      the parameter is unknown. The returned array is the store's own:
//      treat it as read-only — later lanes mutate events through dedicated
//      store operations (compensation, transforms), never in place.
//    listSamples()
//      Every loaded sample's info, least-recently-used first.
//    unloadSample(sampleId)
//      Drop one sample; true when it was loaded, false when it wasn't.
//    sampleStats(sampleId)
//      { sampleId, eventCount, params: [{ name, count, min, max, mean }] } —
//      the event count plus each parameter's min/max (and mean) over its
//      finite values; null when the sample isn't loaded.
//    applyCompensation(sampleId, { fluorochromes, matrix, source })
//      (F2a, seq 447) Apply a spillover matrix: the compensated
//      fluorochrome columns are materialised from the RAW columns
//      (compensated = S^-1 x observed per event) and become the readable
//      columns; every other parameter passes through unchanged. Re-applying
//      recomputes from raw, never stacks. Returns the compensation state.
//      Throws when the sample is unknown or the matrix is refused.
//    getCompensation(sampleId)
//      The sample's compensation state, or null when it isn't loaded.
//      A never-compensated sample reports `applied: false`.
//    clearCompensation(sampleId)
//      Drop the compensated copy and read raw again; true when the sample
//      was loaded, false when it wasn't. The last matrix is kept in the
//      state with `applied: false`.
//    storeStatus() — extra, beyond the contract minimum: how many samples
//      are loaded and how many bytes they hold against the budget
//      (raw + compensated copies both count).
//    applyTransform(sampleId, param, transform) — seq 448 (F2b): rewrite
//      one parameter's column in place through the transform (the data
//      transform; the sample node records it in `flowSample.transforms`).
//      Throws on an unknown sample / parameter. The caller — the MCP
//      executor — refuses to transform an already-transformed parameter
//      (reload the sample to start from raw values): the store keeps no
//      raw copy, so a second application would compose silently.
//    Rust adds flow_load_sample_file(): the same load from a `.tfcs` sidecar
//    file (see the format note in `flow_store.rs`).
//
// ── Shape decisions ──────────────────────────────────────────────────────
// * Columnar Float32Array per parameter, per sample. f32, not f64: FCS data
//   is natively float32 (or narrower), so f32 halves the memory of JS
//   numbers and matches the file; 1M events × 40 params is 160 MB as f32.
//   Events live in Rust in the app; the TS side holds only references
//   (sample ids) + metadata, never event arrays.
// * In-memory columnar, file-backed load — NOT mmap (yet). The `.tfcs`
//   sidecar the Rust loader reads is column-major contiguous f32, so
//   swapping the read for a memmap2 mapping later is mechanical (one column
//   is one contiguous run); F1a takes no new crates.io dependency and no
//   alignment/ lifetime machinery for a gain that only matters past RAM.
// * Memory pressure is LRU eviction against a byte budget (default 512 MiB):
//   loading past the budget unloads the least-recently-used sample(s).
//   Unloading drops the columns; the sample's `.hlx` reference (file path +
//   metadata) is untouched, so the sample reloads from its file on demand.
// * Two implementations of one interface: `InMemoryFlowStore` (pure TS —
//   the reference implementation, used by the tests and as the fallback
//   outside the Tauri shell) and `TauriFlowStore` (thin invoke client over
//   the Rust store, used in the app). `createFlowStore()` picks by shell.
// * The flow module is opt-in, off by default: `isFlowEnabled()` is false
//   until the Settings toggle lands (a later lane wires it). The flag gates
//   surfaces, not the store — lanes and tests can load samples while the
//   module is off; no sidebar/menu/MCP surface exists in F1a either way.

import type { FlowParameterMeta, FlowTransformRef } from "./sample";
import {
  compensateFluorochromeColumns,
  invertMatrix,
  unappliedCompensationState,
  validateSpillover,
  type ApplyCompensationInput,
  type FlowCompensationState,
} from "./compensation";
import { applyTransformToColumn, transformFromRef, type FlowTransformResult } from "./transforms";

/** One parameter's stats: min/max/mean over its finite values. `count` is
 *  the finite count (events with a non-finite value in this parameter don't
 *  count); min/max/mean are null when the parameter has no finite value. */
export interface FlowParamStats {
  name: string;
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
}

/** A sample's stats: its event count plus one entry per parameter. */
export interface FlowSampleStats {
  sampleId: string;
  eventCount: number;
  params: FlowParamStats[];
}

/** A loaded sample, as the store reports it: identity + metadata only. */
export interface FlowSampleInfo {
  sampleId: string;
  name: string;
  eventCount: number;
  parameterCount: number;
  /** Bytes the sample's columns hold (eventCount × parameters × 4). */
  bytes: number;
  sourcePath?: string;
}

/** Store-wide memory state (extra, beyond the contract minimum). */
export interface FlowStoreStatus {
  samples: number;
  bytes: number;
  budgetBytes: number;
}

/** Metadata the store keeps per sample (no event data). */
export interface FlowLoadMeta {
  name?: string;
  sourcePath?: string;
}

/** Default memory budget: 512 MiB of event columns across all samples. */
export const FLOW_STORE_DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;

/** The store interface — the contract above, in code. Both implementations
 *  (in-memory and Tauri/Rust) satisfy it. */
export interface FlowEventStore {
  loadSample(
    sampleId: string,
    columns: readonly (Float32Array | readonly number[])[],
    paramNames: readonly string[],
    meta?: FlowLoadMeta,
  ): Promise<FlowSampleInfo>;
  getColumn(sampleId: string, param: string): Promise<Float32Array | null>;
  listSamples(): Promise<FlowSampleInfo[]>;
  unloadSample(sampleId: string): Promise<boolean>;
  sampleStats(sampleId: string): Promise<FlowSampleStats | null>;
  /** Apply a spillover matrix (F2a, seq 447) — see the contract above. */
  applyCompensation(sampleId: string, input: ApplyCompensationInput): Promise<FlowCompensationState>;
  getCompensation(sampleId: string): Promise<FlowCompensationState | null>;
  clearCompensation(sampleId: string): Promise<boolean>;
  storeStatus(): Promise<FlowStoreStatus>;
  /** Rewrite one parameter's column in place through the transform (seq
   *  448, F2b): the data transform. Throws on an unknown sample /
   *  parameter; the caller refuses a second application to the same
   *  parameter (the store keeps no raw copy). Returns the before/after
   *  stats of the parameter. */
  applyTransform(sampleId: string, param: string, transform: FlowTransformRef): Promise<FlowTransformResult>;
}

interface LoadedSample {
  info: FlowSampleInfo;
  columns: Float32Array[];
  paramNames: string[];
  /** The compensated fluorochrome columns, in `compensated.fluorochromes`
   *  order — materialised from the RAW columns on apply, dropped on
   *  clear. The raw `columns` above are never mutated, so re-applying
   *  with an edited matrix recomputes from raw. */
  compensated: { fluorochromes: string[]; columns: Float32Array[] } | null;
  compensation: FlowCompensationState;
}

const BYTES_PER_VALUE = 4;

function sampleBytes(eventCount: number, parameterCount: number): number {
  return eventCount * parameterCount * BYTES_PER_VALUE;
}

function statsFor(name: string, column: Float32Array): FlowParamStats {
  let count = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < column.length; i++) {
    const v = column[i];
    if (!Number.isFinite(v)) continue;
    count++;
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return {
    name,
    count,
    min: count ? min : null,
    max: count ? max : null,
    mean: count ? sum / count : null,
  };
}

/** The reference implementation: pure-TS columnar store, one Float32Array
 *  per parameter per sample, LRU eviction against a byte budget. Used by
 *  the tests and anywhere there is no Tauri shell (web dev). */
export class InMemoryFlowStore implements FlowEventStore {
  private readonly budgetBytes: number;
  /** Insertion order is recency order: a use deletes + re-inserts the key,
   *  so the first key is always the least-recently-used sample. */
  private readonly samples = new Map<string, LoadedSample>();
  private bytes = 0;

  constructor(options?: { budgetBytes?: number }) {
    this.budgetBytes =
      options?.budgetBytes !== undefined && options.budgetBytes > 0
        ? Math.floor(options.budgetBytes)
        : FLOW_STORE_DEFAULT_BUDGET_BYTES;
  }

  /** Synchronous load — the async method below delegates here, and the
   *  viewer-facing sync facade at the bottom of this file calls this
   *  directly. The body is the implementation; nothing about it changed. */
  loadSampleSync(
    sampleId: string,
    columns: readonly (Float32Array | readonly number[])[],
    paramNames: readonly string[],
    meta?: FlowLoadMeta,
  ): FlowSampleInfo {
    if (!sampleId) throw new Error("A flow sample needs an id.");
    if (!paramNames.length) throw new Error(`Sample “${sampleId}” has no parameters.`);
    if (columns.length !== paramNames.length) {
      throw new Error(`Sample “${sampleId}” has ${columns.length} columns for ${paramNames.length} parameters.`);
    }
    if (new Set(paramNames).size !== paramNames.length) {
      throw new Error(`Sample “${sampleId}” repeats a parameter name.`);
    }
    const arrays = columns.map((c) => (c instanceof Float32Array ? c : Float32Array.from(c)));
    const eventCount = arrays[0]?.length ?? 0;
    if (arrays.some((c) => c.length !== eventCount)) {
      throw new Error(`Sample “${sampleId}” has columns of different lengths.`);
    }
    // Replacing a loaded sample frees its bytes first; the replacement is
    // the most-recently-used by definition.
    const existing = this.samples.get(sampleId);
    if (existing) {
      this.bytes -= existing.info.bytes;
      this.samples.delete(sampleId);
    }
    const info: FlowSampleInfo = {
      sampleId,
      name: meta?.name ?? sampleId,
      eventCount,
      parameterCount: paramNames.length,
      bytes: sampleBytes(eventCount, paramNames.length),
      sourcePath: meta?.sourcePath,
    };
    this.samples.set(sampleId, {
      info,
      columns: arrays,
      paramNames: [...paramNames],
      compensated: null,
      compensation: unappliedCompensationState(),
    });
    this.bytes += info.bytes;
    // Evict least-recently-used samples until the store fits its budget —
    // never the sample just loaded.
    while (this.bytes > this.budgetBytes && this.samples.size > 1) {
      const lru = this.samples.keys().next().value as string;
      if (lru === sampleId) break;
      this.bytes -= this.samples.get(lru)!.info.bytes;
      this.samples.delete(lru);
    }
    return { ...info };
  }

  async loadSample(
    sampleId: string,
    columns: readonly (Float32Array | readonly number[])[],
    paramNames: readonly string[],
    meta?: FlowLoadMeta,
  ): Promise<FlowSampleInfo> {
    return this.loadSampleSync(sampleId, columns, paramNames, meta);
  }

  /** Synchronous column read — see loadSampleSync. Reads the COMPENSATED
   *  column for a compensated fluorochrome, the raw column otherwise. */
  getColumnSync(sampleId: string, param: string): Float32Array | null {
    const sample = this.samples.get(sampleId);
    if (!sample) return null;
    const index = sample.paramNames.indexOf(param);
    if (index < 0) return null;
    this.touch(sampleId);
    return this.readableColumn(sample, index);
  }

  async getColumn(sampleId: string, param: string): Promise<Float32Array | null> {
    return this.getColumnSync(sampleId, param);
  }

  /** The column a reader sees: the compensated copy for a compensated
   *  fluorochrome, the raw column for everything else. */
  private readableColumn(sample: LoadedSample, index: number): Float32Array {
    const compensated = sample.compensated;
    if (compensated) {
      const at = compensated.fluorochromes.indexOf(sample.paramNames[index]);
      if (at >= 0) return compensated.columns[at];
    }
    return sample.columns[index];
  }

  /** Synchronous compensation apply — see loadSampleSync. Materialises
   *  the compensated fluorochrome columns from the RAW columns (never
   *  from an already-compensated copy), swaps the readable columns to
   *  them, and records the state. `info.bytes` counts the compensated
   *  copy on top of the raw columns. */
  applyCompensationSync(sampleId: string, input: ApplyCompensationInput): FlowCompensationState {
    const sample = this.samples.get(sampleId);
    if (!sample) throw new Error(`flow store: sample "${sampleId}" is not loaded`);
    validateSpillover(input.fluorochromes, input.matrix, sample.paramNames);
    const inverse = invertMatrix(input.matrix);
    const compensated = compensateFluorochromeColumns(sample.columns, sample.paramNames, input.fluorochromes, input.matrix);
    // Free the previous compensated copy first; the new one is charged
    // below. The raw columns are untouched throughout.
    if (sample.compensated) {
      const oldBytes = sampleBytes(sample.info.eventCount, sample.compensated.fluorochromes.length);
      this.bytes -= oldBytes;
      sample.info.bytes -= oldBytes;
    }
    const newBytes = sampleBytes(sample.info.eventCount, input.fluorochromes.length);
    sample.compensated = { fluorochromes: [...input.fluorochromes], columns: compensated };
    sample.compensation = {
      fluorochromes: [...input.fluorochromes],
      spillover: input.matrix.map((row) => [...row]),
      inverse,
      source: input.source,
      applied: true,
    };
    sample.info.bytes += newBytes;
    this.bytes += newBytes;
    this.touch(sampleId);
    return this.copyCompensationState(sample.compensation);
  }

  async applyCompensation(sampleId: string, input: ApplyCompensationInput): Promise<FlowCompensationState> {
    return this.applyCompensationSync(sampleId, input);
  }

  /** Synchronous compensation state — see loadSampleSync. */
  getCompensationSync(sampleId: string): FlowCompensationState | null {
    const sample = this.samples.get(sampleId);
    if (!sample) return null;
    return this.copyCompensationState(sample.compensation);
  }

  async getCompensation(sampleId: string): Promise<FlowCompensationState | null> {
    return this.getCompensationSync(sampleId);
  }

  /** Synchronous compensation clear — see loadSampleSync. Drops the
   *  compensated copy (readable columns revert to raw) and keeps the
   *  last matrix in the state with `applied: false`. */
  clearCompensationSync(sampleId: string): boolean {
    const sample = this.samples.get(sampleId);
    if (!sample) return false;
    if (sample.compensated) {
      const oldBytes = sampleBytes(sample.info.eventCount, sample.compensated.fluorochromes.length);
      this.bytes -= oldBytes;
      sample.info.bytes -= oldBytes;
      sample.compensated = null;
    }
    sample.compensation = { ...this.copyCompensationState(sample.compensation), applied: false };
    this.touch(sampleId);
    return true;
  }

  async clearCompensation(sampleId: string): Promise<boolean> {
    return this.clearCompensationSync(sampleId);
  }

  /** A defensive copy of a compensation state: callers must not mutate
   *  the store's own record. */
  private copyCompensationState(state: FlowCompensationState): FlowCompensationState {
    return {
      fluorochromes: [...state.fluorochromes],
      spillover: state.spillover.map((row) => [...row]),
      inverse: state.inverse.map((row) => [...row]),
      source: state.source,
      applied: state.applied,
    };
  }

  /** Synchronous sample list — see loadSampleSync. */
  listSamplesSync(): FlowSampleInfo[] {
    return [...this.samples.values()].map((s) => ({ ...s.info }));
  }

  async listSamples(): Promise<FlowSampleInfo[]> {
    return this.listSamplesSync();
  }

  /** Synchronous unload — see loadSampleSync. */
  unloadSampleSync(sampleId: string): boolean {
    const sample = this.samples.get(sampleId);
    if (!sample) return false;
    this.bytes -= sample.info.bytes;
    this.samples.delete(sampleId);
    return true;
  }

  async unloadSample(sampleId: string): Promise<boolean> {
    return this.unloadSampleSync(sampleId);
  }

  /** Synchronous stats — see loadSampleSync. Stats run over the READABLE
   *  columns, so after compensation they describe the compensated data. */
  sampleStatsSync(sampleId: string): FlowSampleStats | null {
    const sample = this.samples.get(sampleId);
    if (!sample) return null;
    this.touch(sampleId);
    return {
      sampleId,
      eventCount: sample.info.eventCount,
      params: sample.paramNames.map((name, i) => statsFor(name, this.readableColumn(sample, i))),
    };
  }

  async sampleStats(sampleId: string): Promise<FlowSampleStats | null> {
    return this.sampleStatsSync(sampleId);
  }

  /** Synchronous status — see loadSampleSync. */
  storeStatusSync(): FlowStoreStatus {
    return { samples: this.samples.size, bytes: this.bytes, budgetBytes: this.budgetBytes };
  }

  async storeStatus(): Promise<FlowStoreStatus> {
    return this.storeStatusSync();
  }

  /** Synchronous transform — see loadSampleSync. Rewrites the column in
   *  place (f64 math, stored as f32); the resolved transform is
   *  canonical, so the caller's record of it matches what ran. */
  applyTransformSync(sampleId: string, param: string, transform: FlowTransformRef): FlowTransformResult {
    const resolved = transformFromRef(transform);
    const sample = this.samples.get(sampleId);
    if (!sample) throw new Error(`flow store: sample "${sampleId}" is not loaded`);
    const index = sample.paramNames.indexOf(param);
    if (index < 0) {
      throw new Error(`flow store: sample "${sampleId}" has no parameter "${param}" (unknown parameter)`);
    }
    const { before, after } = applyTransformToColumn(resolved, sample.columns[index], param);
    this.touch(sampleId);
    return { sampleId, parameter: param, kind: resolved.kind, eventCount: sample.info.eventCount, before, after };
  }

  async applyTransform(sampleId: string, param: string, transform: FlowTransformRef): Promise<FlowTransformResult> {
    return this.applyTransformSync(sampleId, param, transform);
  }

  private touch(sampleId: string): void {
    const sample = this.samples.get(sampleId);
    if (!sample) return;
    this.samples.delete(sampleId);
    this.samples.set(sampleId, sample);
  }
}

/** The Tauri client: the same contract, over the Rust store's commands
 *  (`flow_load_sample`, `flow_get_column`, `flow_list_samples`,
 *  `flow_unload_sample`, `flow_sample_stats`, `flow_store_status`). Columns
 *  cross the IPC boundary as plain number arrays — fine for F1a's scale;
 *  later lanes can add a chunked/binary transfer if it ever binds. The
 *  `@tauri-apps/api` import is dynamic so this module also loads in node
 *  (tests) and in plain web dev, where `createFlowStore()` never picks it. */
export class TauriFlowStore implements FlowEventStore {
  private async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
  }

  async loadSample(
    sampleId: string,
    columns: readonly (Float32Array | readonly number[])[],
    paramNames: readonly string[],
    meta?: FlowLoadMeta,
  ): Promise<FlowSampleInfo> {
    return this.invoke<FlowSampleInfo>("flow_load_sample", {
      sample_id: sampleId,
      columns: columns.map((c) => Array.from(c)),
      param_names: [...paramNames],
      name: meta?.name ?? null,
      source_path: meta?.sourcePath ?? null,
    });
  }

  async getColumn(sampleId: string, param: string): Promise<Float32Array | null> {
    const column = await this.invoke<number[] | null>("flow_get_column", {
      sample_id: sampleId,
      param,
    });
    return column === null ? null : Float32Array.from(column);
  }

  async listSamples(): Promise<FlowSampleInfo[]> {
    return this.invoke<FlowSampleInfo[]>("flow_list_samples");
  }

  async unloadSample(sampleId: string): Promise<boolean> {
    return this.invoke<boolean>("flow_unload_sample", { sample_id: sampleId });
  }

  async sampleStats(sampleId: string): Promise<FlowSampleStats | null> {
    return this.invoke<FlowSampleStats | null>("flow_sample_stats", { sample_id: sampleId });
  }

  async applyCompensation(sampleId: string, input: ApplyCompensationInput): Promise<FlowCompensationState> {
    return this.invoke<FlowCompensationState>("flow_apply_compensation", {
      sample_id: sampleId,
      fluorochromes: [...input.fluorochromes],
      matrix: input.matrix.map((row) => [...row]),
      source: input.source,
    });
  }

  async getCompensation(sampleId: string): Promise<FlowCompensationState | null> {
    return this.invoke<FlowCompensationState | null>("flow_get_compensation", { sample_id: sampleId });
  }

  async clearCompensation(sampleId: string): Promise<boolean> {
    return this.invoke<boolean>("flow_clear_compensation", { sample_id: sampleId });
  }

  async storeStatus(): Promise<FlowStoreStatus> {
    return this.invoke<FlowStoreStatus>("flow_store_status");
  }

  async applyTransform(sampleId: string, param: string, transform: FlowTransformRef): Promise<FlowTransformResult> {
    // The Rust side resolves the parameters again and validates, so the
    // raw record crosses here; `applyFlowTransform` (transforms.ts) is
    // the resolved-params entry point the MCP executor uses.
    return this.invoke<FlowTransformResult>("flow_apply_transform", {
      sample_id: sampleId,
      parameter: param,
      kind: transform.kind,
      params: transform.params ?? {},
    });
  }
}

/** True in the Tauri shell (`src/native.ts` uses the same test). */
const isNativeShell = (): boolean => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The store for this runtime: the Rust store in the app, the in-memory
 *  store in the tests and in web dev. */
export function createFlowStore(): FlowEventStore {
  return isNativeShell() ? new TauriFlowStore() : new InMemoryFlowStore();
}

// ── Opt-in flag ──────────────────────────────────────────────────────────
// The flow module is off by default (same pattern as the MCP server toggle):
// no sidebar entry, menu item or MCP surface exists while it is off — F1a
// adds no surface at all. A later lane wires this to the Settings toggle;
// until then the persisted key is the switch, and the module-level override
// is the tests' (and the lanes') handle on it. The flag gates surfaces,
// never the store itself.

const FLOW_ENABLED_KEY = "titer.flow.enabled";

let flowEnabledOverride: boolean | null = null;

/** True when the flow module is turned on. Default off. */
export function isFlowEnabled(): boolean {
  if (flowEnabledOverride !== null) return flowEnabledOverride;
  try {
    if (typeof localStorage !== "undefined") return localStorage.getItem(FLOW_ENABLED_KEY) === "1";
  } catch {
    // No storage (tests, SSR): off.
  }
  return false;
}

/** Turn the flow module on or off (tests; the Settings toggle later). */
export function setFlowEnabled(enabled: boolean): void {
  flowEnabledOverride = enabled;
  try {
    if (typeof localStorage !== "undefined") {
      if (enabled) localStorage.setItem(FLOW_ENABLED_KEY, "1");
      else localStorage.removeItem(FLOW_ENABLED_KEY);
    }
  } catch {
    // No storage: the override still holds for this runtime.
  }
}

/** Parameter metadata for a sample, from its store info — the bridge's
 *  input shape is the `.hlx` reference, not the store, so this is only the
 *  small helper that keeps the two in sync when a lane has just metadata. */
export function parameterNamesOf(parameters: readonly FlowParameterMeta[]): string[] {
  return parameters.map((p) => p.name);
}

// ── Synchronous viewer facade (F1b, seq 442) ────────────────────────────
// The density-plot viewer (src/flow/viewer.ts) and the fixture loader
// (src/flow/fixture.ts) are synchronous: they call ONLY these five
// functions for data, never raw arrays from elsewhere. The facade is a
// thin skin over a module-level default InMemoryFlowStore — the same
// implementation the async interface uses, not a second store — reached
// through its synchronous core (loadSampleSync et al. above). Semantics
// are F1b's, preserved exactly so the viewer, the fixture and the flow-f1b
// pin need no edits:
// * unknown sample / parameter THROWS ("... is not loaded" / "... has no
//   parameter ... (unknown parameter)"), where the async interface returns
//   null — the viewer relies on the throw (unload a sample and every
//   builder fails: there is no second copy of the data);
// * stats are { id, eventCount, params: [{ name, min, max }] } with plain
//   numbers (0 when a parameter has no finite value), where the async
//   interface returns { sampleId, ..., count, min | null, max | null, mean };
// * unload of an unknown id is a no-op; listSamples returns ids in load order.

/** Metadata the sync facade accepts per sample (F1b's shape). Only the
 *  file name carries into the store (as the sample's name); `description`
 *  is provenance for the caller and is not kept. */
export interface FlowSampleMeta {
  /** The FCS file this sample came from, when it has one. */
  fileName?: string;
  /** Free-form provenance (fixture name, import notes…). */
  description?: string;
}

/** One parameter's range over a sample's events, synchronous shape
 *  (finite values only; 0 when a parameter has no finite value). */
export interface FlowSyncParamStats {
  name: string;
  min: number;
  max: number;
}

/** A sample's stats, synchronous shape. */
export interface FlowSyncSampleStats {
  id: string;
  eventCount: number;
  params: FlowSyncParamStats[];
}

/** The default backend for the sync facade: F1a's InMemoryFlowStore.
 *  The stub (store-stub.ts) is deleted — this is the in-memory
 *  implementation now, with LRU eviction against the byte budget. */
let viewerBackend: InMemoryFlowStore = new InMemoryFlowStore();

/** Swap the store backend behind the sync facade (tests; startup wiring).
 *  Takes an InMemoryFlowStore because only a synchronous in-memory store
 *  can serve this synchronous API — the Tauri store is async-only and is
 *  reached via `createFlowStore()`, not here. */
export function setFlowStoreBackend(next: InMemoryFlowStore): void {
  viewerBackend = next;
}

export function loadSample(id: string, columns: Float32Array[], paramNames: string[], meta?: FlowSampleMeta): void {
  viewerBackend.loadSampleSync(id, columns, paramNames, { name: meta?.fileName });
}

export function getColumn(sampleId: string, param: string): Float32Array {
  const column = viewerBackend.getColumnSync(sampleId, param);
  if (column === null) {
    // Same wording the stub threw, so the viewer's /not loaded/ and the
    // pin's /unknown parameter/ assertions still match. Distinguish the
    // two cases the way the stub did.
    const loaded = viewerBackend.listSamplesSync().some((s) => s.sampleId === sampleId);
    if (!loaded) throw new Error(`flow store: sample "${sampleId}" is not loaded`);
    throw new Error(`flow store: sample "${sampleId}" has no parameter "${param}" (unknown parameter)`);
  }
  return column;
}

export function listSamples(): string[] {
  return viewerBackend.listSamplesSync().map((s) => s.sampleId);
}

export function unloadSample(id: string): void {
  viewerBackend.unloadSampleSync(id);
}

export function sampleStats(id: string): FlowSyncSampleStats {
  const stats = viewerBackend.sampleStatsSync(id);
  if (stats === null) throw new Error(`flow store: sample "${id}" is not loaded`);
  return {
    id,
    eventCount: stats.eventCount,
    params: stats.params.map((p) => ({ name: p.name, min: p.min ?? 0, max: p.max ?? 0 })),
  };
}

/** Apply a spillover matrix to a sample (F2a, seq 447) — the sync
 *  facade's skin over `InMemoryFlowStore.applyCompensationSync`. */
export function applyCompensation(sampleId: string, input: ApplyCompensationInput): FlowCompensationState {
  return viewerBackend.applyCompensationSync(sampleId, input);
}

export function getCompensation(sampleId: string): FlowCompensationState | null {
  return viewerBackend.getCompensationSync(sampleId);
}

export function clearCompensation(sampleId: string): boolean {
  return viewerBackend.clearCompensationSync(sampleId);
}

/** Rewrite one parameter's column in place through the transform (seq
 *  448, F2b) — the synchronous facade's sixth operation, same throw
 *  behaviour as the rest of the facade (unknown sample / parameter
 *  throws). Returns the before/after stats of the parameter. */
export function applyTransform(sampleId: string, param: string, transform: FlowTransformRef): FlowTransformResult {
  return viewerBackend.applyTransformSync(sampleId, param, transform);
}
