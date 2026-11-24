// FlowJo track, seq 441 (F1a): the columnar event store.
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
//    storeStatus() — extra, beyond the contract minimum: how many samples
//      are loaded and how many bytes they hold against the budget.
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

import type { FlowParameterMeta } from "./sample";

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
  storeStatus(): Promise<FlowStoreStatus>;
}

interface LoadedSample {
  info: FlowSampleInfo;
  columns: Float32Array[];
  paramNames: string[];
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

  async loadSample(
    sampleId: string,
    columns: readonly (Float32Array | readonly number[])[],
    paramNames: readonly string[],
    meta?: FlowLoadMeta,
  ): Promise<FlowSampleInfo> {
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
    this.samples.set(sampleId, { info, columns: arrays, paramNames: [...paramNames] });
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

  async getColumn(sampleId: string, param: string): Promise<Float32Array | null> {
    const sample = this.samples.get(sampleId);
    if (!sample) return null;
    const index = sample.paramNames.indexOf(param);
    if (index < 0) return null;
    this.touch(sampleId);
    return sample.columns[index];
  }

  async listSamples(): Promise<FlowSampleInfo[]> {
    return [...this.samples.values()].map((s) => ({ ...s.info }));
  }

  async unloadSample(sampleId: string): Promise<boolean> {
    const sample = this.samples.get(sampleId);
    if (!sample) return false;
    this.bytes -= sample.info.bytes;
    this.samples.delete(sampleId);
    return true;
  }

  async sampleStats(sampleId: string): Promise<FlowSampleStats | null> {
    const sample = this.samples.get(sampleId);
    if (!sample) return null;
    this.touch(sampleId);
    return {
      sampleId,
      eventCount: sample.info.eventCount,
      params: sample.paramNames.map((name, i) => statsFor(name, sample.columns[i])),
    };
  }

  async storeStatus(): Promise<FlowStoreStatus> {
    return { samples: this.samples.size, bytes: this.bytes, budgetBytes: this.budgetBytes };
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

  async storeStatus(): Promise<FlowStoreStatus> {
    return this.invoke<FlowStoreStatus>("flow_store_status");
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
