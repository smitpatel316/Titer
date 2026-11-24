// The event-store API contract (seq 441/442) — the ONE module flow code
// reads event data through.
//
// F1a (seq 441) is building the real event store in parallel; this file is
// the contract it implements, not the store itself. The viewer
// (src/flow/viewer.ts) and the fixture loader (src/flow/fixture.ts) call
// ONLY these functions for data — never raw arrays from elsewhere — so the
// swap below is a one-line change with no viewer edits.
//
// STUB: the default backend is the in-memory stub (src/flow/store-stub.ts),
// clearly marked there. It holds whole Float32Array columns in RAM and is
// NOT the production store (no mmap, no lifecycle, no memory pressure).
//
// INTEGRATION POINT (check/flowjo merge): F1a's real store replaces the
// default backend — call `setFlowStoreBackend(realStore)` once at startup
// (or change the `backend` initialiser below to F1a's factory) and every
// viewer call below reads the real store with no other change.

import { createStubFlowStore } from "./store-stub";

export interface FlowSampleMeta {
  /** The FCS file this sample came from, when it has one. */
  fileName?: string;
  /** Free-form provenance (fixture name, import notes…). */
  description?: string;
}

/** One parameter's range over a sample's events (finite values only). */
export interface FlowParamStats {
  name: string;
  min: number;
  max: number;
}

export interface FlowSampleStats {
  id: string;
  eventCount: number;
  params: FlowParamStats[];
}

/** The event-store contract: columnar typed-array storage, one
 *  Float32Array per parameter, keyed by sample id. */
export interface FlowStore {
  /** Load (or replace) a sample's columns. All columns must hold the same
   *  number of events; parameter names must be unique. */
  loadSample(id: string, columns: Float32Array[], paramNames: string[], meta?: FlowSampleMeta): void;
  /** One parameter's events, in acquisition order. Throws when the sample
   *  is not loaded or the parameter is unknown. */
  getColumn(sampleId: string, param: string): Float32Array;
  /** The ids of the loaded samples, in load order. */
  listSamples(): string[];
  /** Drop a sample (frees its columns). Unknown ids are a no-op. */
  unloadSample(id: string): void;
  /** Event count + per-parameter min/max for a loaded sample. */
  sampleStats(id: string): FlowSampleStats;
}

// STUB backend — see the header. F1a's real store swaps in here.
let backend: FlowStore = createStubFlowStore();

/** Swap the store backend (F1a's real event store; tests). */
export function setFlowStoreBackend(next: FlowStore): void {
  backend = next;
}

export function loadSample(id: string, columns: Float32Array[], paramNames: string[], meta?: FlowSampleMeta): void {
  backend.loadSample(id, columns, paramNames, meta);
}

export function getColumn(sampleId: string, param: string): Float32Array {
  return backend.getColumn(sampleId, param);
}

export function listSamples(): string[] {
  return backend.listSamples();
}

export function unloadSample(id: string): void {
  backend.unloadSample(id);
}

export function sampleStats(id: string): FlowSampleStats {
  return backend.sampleStats(id);
}
