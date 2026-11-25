// FlowJo track, seq 447 (F2a): spillover-matrix compensation.
//
// Compensation is the inverse of the spillover matrix, multiplied per
// event: compensated = S^-1 x observed (column vector). S rows are
// detectors, columns are fluorochromes: S[i][j] is the spill of
// fluorochrome j into detector i. The convention is verified numerically
// by the F0 harness (synth-spill.fcs: first compensated value 87.60202
// vs Python inv(spill) @ raw = 87.602) and pinned by `flow-f2a`.
//
// Channels outside the fluorochrome list pass through unchanged — the FCS
// 3.1 sparse-matrix guidance: for multi-measurement types (height vs
// area) the writer uses a sparse matrix with zeros between measurement
// types, and readers make no assumptions about measurement types. A
// sample's raw columns are never mutated: applying compensation
// materialises a new compensated copy, so re-applying with an edited
// matrix recomputes from RAW (never double compensation), and clearing
// swaps the readable columns back to raw.
//
// Matrix sources: the file's $SPILLOVER/$SPILL/$COMP keyword (parsed by
// `parseSpilloverKeyword`), a FlowJo-style CSV/TSV matrix text
// (`parseSpilloverCsv`), or an explicit nested array (MCP args).
// Per-sample matrix editing is re-applying with a new matrix.

/** Where a compensation matrix came from. */
export type CompensationSource = "file" | "csv" | "manual";

/** A spillover matrix: fluorochromes in row/column order + the matrix. */
export interface SpilloverMatrix {
  fluorochromes: string[];
  matrix: number[][];
}

/** Input to a store apply: the matrix + its provenance. */
export interface ApplyCompensationInput {
  fluorochromes: readonly string[];
  matrix: readonly (readonly number[])[];
  source: CompensationSource;
}

/** A sample's compensation state, as the store reports it. `spillover` is
 *  the matrix as applied (the editable source of truth); `inverse` is the
 *  matrix actually multiplied. After `clearCompensation` the last matrix
 *  is kept with `applied: false`. */
export interface FlowCompensationState {
  fluorochromes: string[];
  spillover: number[][];
  inverse: number[][];
  source: CompensationSource;
  applied: boolean;
}

/** The unapplied state for a sample that never had compensation. */
export function unappliedCompensationState(): FlowCompensationState {
  return { fluorochromes: [], spillover: [], inverse: [], source: "file", applied: false };
}

/** Invert a square matrix (f64 Gauss-Jordan with partial pivoting).
 *  Refuses non-square, non-finite and singular matrices. */
export function invertMatrix(matrix: readonly (readonly number[])[]): number[][] {
  const n = matrix.length;
  if (n === 0) throw new Error("A compensation matrix must not be empty.");
  for (const row of matrix) {
    if (row.length !== n) {
      throw new Error(`A compensation matrix must be square: got a ${n}x${row.length} matrix.`);
    }
    for (const v of row) {
      if (!Number.isFinite(v)) throw new Error("A compensation matrix must hold only finite numbers.");
    }
  }
  // Augment with the identity; row-reduce to the inverse.
  const aug: number[][] = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    // Partial pivot: the largest remaining entry in this column.
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < 1e-12) {
      throw new Error("A compensation matrix must not be singular: it has no inverse.");
    }
    if (pivot !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivot];
      aug[pivot] = tmp;
    }
    const divisor = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= divisor;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

/** Validate a spillover matrix against a sample's parameters: the
 *  fluorochrome list must be non-empty and duplicate-free, the matrix
 *  square over it, every fluorochrome a parameter of the sample, and
 *  every entry finite. Throws with a plain message on the first failure. */
export function validateSpillover(
  fluorochromes: readonly string[],
  matrix: readonly (readonly number[])[],
  paramNames: readonly string[],
): void {
  if (fluorochromes.length === 0) {
    throw new Error("A compensation matrix needs at least one fluorochrome.");
  }
  if (new Set(fluorochromes).size !== fluorochromes.length) {
    throw new Error("A compensation matrix must not repeat a fluorochrome.");
  }
  if (matrix.length !== fluorochromes.length) {
    throw new Error(
      `A compensation matrix must be square over its ${fluorochromes.length} fluorochromes: got ${matrix.length} rows.`,
    );
  }
  for (const fluor of fluorochromes) {
    if (!paramNames.includes(fluor)) {
      throw new Error(`Fluorochrome “${fluor}” is not a parameter of this sample.`);
    }
  }
  // invertMatrix refuses non-square rows, non-finite entries and
  // singular matrices — call it for validation even though the caller
  // inverts again; the matrix is at most 40x40, so the cost is nil.
  invertMatrix(matrix);
}

/** Compensate ONLY the fluorochrome columns: one Float32Array per
 *  fluorochrome, in `fluorochromes` order, computed from the RAW columns
 *  (f64 accumulation, stored f32). Non-fluorochrome parameters are not
 *  in the result — they pass through unchanged by the caller. */
export function compensateFluorochromeColumns(
  columns: readonly (Float32Array | readonly number[])[],
  paramNames: readonly string[],
  fluorochromes: readonly string[],
  matrix: readonly (readonly number[])[],
): Float32Array[] {
  validateSpillover(fluorochromes, matrix, paramNames);
  const inverse = invertMatrix(matrix);
  const eventCount = columns[0]?.length ?? 0;
  const rawIndex = fluorochromes.map((f) => paramNames.indexOf(f));
  const out = fluorochromes.map(() => new Float32Array(eventCount));
  for (let e = 0; e < eventCount; e++) {
    for (let i = 0; i < fluorochromes.length; i++) {
      let sum = 0;
      for (let j = 0; j < fluorochromes.length; j++) {
        sum += inverse[i][j] * columns[rawIndex[j]][e];
      }
      out[i][e] = sum;
    }
  }
  return out;
}

/** Compensate a whole sample: every parameter's column, in `paramNames`
 *  order — compensated fluorochromes + bit-identical passthrough copies
 *  for everything else. The input columns are never mutated. */
export function compensateColumns(
  columns: readonly (Float32Array | readonly number[])[],
  paramNames: readonly string[],
  fluorochromes: readonly string[],
  matrix: readonly (readonly number[])[],
): Float32Array[] {
  const compensated = compensateFluorochromeColumns(columns, paramNames, fluorochromes, matrix);
  const fluorSet = new Set(fluorochromes);
  return paramNames.map((name, i) => {
    if (!fluorSet.has(name)) {
      const raw = columns[i];
      return raw instanceof Float32Array ? Float32Array.from(raw) : Float32Array.from(raw);
    }
    return compensated[fluorochromes.indexOf(name)];
  });
}

/** Parse the $SPILLOVER flat form: `n,fluor1,…,fluorN,v11,v12,…,vNN`
 *  (row-major, n rows of n). The same shape $SPILL/$COMP carry. */
export function parseSpilloverKeyword(value: string): SpilloverMatrix {
  const parts = value.split(",").map((p) => p.trim());
  const n = parseInt(parts[0] ?? "", 10);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`A $SPILLOVER value must start with its size: got “${parts[0] ?? ""}”.`);
  }
  if (parts.length !== 1 + n + n * n) {
    throw new Error(
      `A $SPILLOVER value for ${n} fluorochromes must hold ${1 + n + n * n} comma-separated fields: got ${parts.length}.`,
    );
  }
  const fluorochromes = parts.slice(1, 1 + n);
  if (new Set(fluorochromes).size !== fluorochromes.length) {
    throw new Error("A $SPILLOVER value must not repeat a fluorochrome.");
  }
  const values = parts.slice(1 + n).map((p) => Number(p));
  if (values.some((v) => !Number.isFinite(v))) {
    throw new Error("A $SPILLOVER value must hold only finite numbers.");
  }
  const matrix: number[][] = [];
  for (let i = 0; i < n; i++) matrix.push(values.slice(i * n, (i + 1) * n));
  return { fluorochromes, matrix };
}

/** Parse a FlowJo-style matrix text: a header row (first cell blank,
 *  then the fluorochromes) plus one row per fluorochrome, each starting
 *  with its row label. Comma- or tab-separated; row labels must match
 *  the header, in order. */
export function parseSpilloverCsv(text: string): SpilloverMatrix {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(line.includes("\t") ? "\t" : ",").map((cell) => cell.trim()));
  if (rows.length < 2) {
    throw new Error("A compensation matrix text needs a header row and at least one data row.");
  }
  const fluorochromes = rows[0].slice(1);
  if (fluorochromes.length === 0 || fluorochromes.some((f) => !f)) {
    throw new Error("A compensation matrix text needs fluorochrome names in its header row.");
  }
  if (new Set(fluorochromes).size !== fluorochromes.length) {
    throw new Error("A compensation matrix text must not repeat a fluorochrome.");
  }
  if (rows.length - 1 !== fluorochromes.length) {
    throw new Error(
      `A compensation matrix text for ${fluorochromes.length} fluorochromes needs ${fluorochromes.length} data rows: got ${rows.length - 1}.`,
    );
  }
  const matrix: number[][] = [];
  for (let i = 0; i < fluorochromes.length; i++) {
    const row = rows[i + 1];
    if (row[0] !== fluorochromes[i]) {
      throw new Error(
        `A compensation matrix text's row labels must match the header: row ${i + 1} is “${row[0] ?? ""}”, expected “${fluorochromes[i]}”.`,
      );
    }
    const values = row.slice(1).map((cell) => Number(cell));
    if (values.length !== fluorochromes.length) {
      throw new Error(
        `A compensation matrix text's row “${fluorochromes[i]}” must hold ${fluorochromes.length} values: got ${values.length}.`,
      );
    }
    if (values.some((v) => !Number.isFinite(v))) {
      throw new Error(`A compensation matrix text's row “${fluorochromes[i]}” must hold only finite numbers.`);
    }
    matrix.push(values);
  }
  return { fluorochromes, matrix };
}
