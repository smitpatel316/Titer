// STUB — the in-memory implementation of the store contract
// (src/flow/store.ts), for the F1b density-plot viewer only.
//
// This is NOT the production event store: it holds whole Float32Array
// columns in RAM, with no mmap, no lifecycle and no memory pressure. F1a
// (seq 441) is building the real store in parallel; at the check/flowjo
// merge it replaces this backend via `setFlowStoreBackend` (see store.ts).
// Nothing outside src/flow imports this file.

import type { FlowSampleMeta, FlowSampleStats, FlowStore } from "./store";

export function createStubFlowStore(): FlowStore {
  const samples = new Map<string, { columns: Float32Array[]; paramNames: string[]; meta: FlowSampleMeta }>();
  return {
    loadSample(id, columns, paramNames, meta = {}) {
      if (!id) throw new Error("flow store: sample id is required");
      if (paramNames.length === 0) throw new Error("flow store: at least one parameter is required");
      if (columns.length !== paramNames.length) {
        throw new Error("flow store: columns and parameter names must match");
      }
      if (new Set(paramNames).size !== paramNames.length) {
        throw new Error("flow store: parameter names must be unique");
      }
      const n = columns[0].length;
      if (!columns.every((c) => c.length === n)) {
        throw new Error("flow store: all parameter columns must hold the same number of events");
      }
      samples.set(id, { columns, paramNames: [...paramNames], meta });
    },
    getColumn(sampleId, param) {
      const sample = samples.get(sampleId);
      if (!sample) throw new Error(`flow store: sample "${sampleId}" is not loaded`);
      const i = sample.paramNames.indexOf(param);
      if (i < 0) throw new Error(`flow store: sample "${sampleId}" has no parameter "${param}" (unknown parameter)`);
      return sample.columns[i];
    },
    listSamples() {
      return [...samples.keys()];
    },
    unloadSample(id) {
      samples.delete(id);
    },
    sampleStats(id): FlowSampleStats {
      const sample = samples.get(id);
      if (!sample) throw new Error(`flow store: sample "${id}" is not loaded`);
      return {
        id,
        eventCount: sample.columns[0]?.length ?? 0,
        params: sample.paramNames.map((name, i) => {
          let min = Infinity;
          let max = -Infinity;
          const col = sample.columns[i];
          for (let r = 0; r < col.length; r++) {
            const v = col[r];
            if (Number.isFinite(v)) {
              if (v < min) min = v;
              if (v > max) max = v;
            }
          }
          return { name, min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
        }),
      };
    },
  };
}
