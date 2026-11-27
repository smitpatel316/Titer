// FlowJo track, seq 441 (F1a): the columnar event store (Rust side).
//
// Events live here, in Rust — never in the TS heap, never in the `.hlx`
// JSON, never in an MCP snapshot. One sample is one set of columns: a
// `Vec<f32>` per parameter, columnar, so a later lane can hand one parameter
// to a gate, a transform or a stats pass without touching the others. f32,
// not f64: FCS data is natively float32 (or narrower), so f32 halves the
// memory of JS numbers and matches the file — 1M events × 40 parameters is
// 160 MB as f32. The TS side (`src/flow/store.ts`) holds only references
// (sample ids) + metadata, and mirrors this interface; `TauriFlowStore`
// there is the thin invoke client over the commands below.
//
// ── Storage decision: in-memory columnar, file-backed load ──────────────
// This is NOT mmap (yet). The `.tfcs` sidecar the file loader reads is
// column-major contiguous f32 (see `SIDECAR_*` below), so swapping the
// `fs::read` for a memmap2 mapping later is mechanical — one column is one
// contiguous run — but F1a takes no new crates.io dependency and no
// alignment/lifetime machinery for a gain that only matters past RAM.
// What the file load buys today: a saved project reloads its samples from
// the sidecar without re-parsing the FCS file (the FCS reader lane owns
// parsing and calls `flow_load_sample` with parsed columns).
//
// ── Lifecycle / memory pressure ──────────────────────────────────────────
// One global `FlowStore` (Tauri managed state), one byte budget (default
// 512 MiB, `TITER_FLOW_STORE_BUDGET_MB` overrides). Loading past the budget
// unloads the least-recently-used sample(s); unloading drops the columns
// only — the sample's `.hlx` reference (file path + metadata) is untouched,
// so the sample reloads from its file on demand. Every read refreshes the
// sample's recency, so a sample in active use is never the eviction victim.
//
// ── Commands (the store API contract; `src/flow/store.ts` documents it) ──
//   flow_load_sample(sample_id, param_names, columns, name?, source_path?)
//   flow_load_sample_file(sample_id, path, param_names, name?, source_path?)
//   flow_get_column(sample_id, param) -> Vec<f32> | null
//   flow_list_samples() -> Vec<FlowSampleInfo>
//   flow_unload_sample(sample_id) -> bool
//   flow_sample_stats(sample_id) -> FlowSampleStats | null
//   flow_store_status() -> FlowStoreStatus
//   flow_apply_compensation(sample_id, fluorochromes, matrix, source)
//     -> FlowCompensationState  (F2a, seq 447)
//   flow_get_compensation(sample_id) -> FlowCompensationState | null
//   flow_clear_compensation(sample_id) -> bool
//
// ── Compensation (F2a, seq 447) ──────────────────────────────────────────
// Compensation is the inverse of the spillover matrix, multiplied per
// event: compensated = S^-1 x observed (column vector). The raw columns
// are never mutated: applying materialises a compensated copy of the
// fluorochrome columns only, so re-applying with an edited matrix
// recomputes from raw (never double compensation) and clearing drops the
// copy. Channels outside the fluorochrome list pass through unchanged
// (FCS 3.1 sparse-matrix guidance: height vs area). The inverse is f64
// Gauss-Jordan with partial pivoting — the same algorithm as
// `src/flow/compensation.ts`, so the two sides agree to f32 rounding.
// `FlowSampleInfo.bytes` counts the compensated copy on top of the raw.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use std::time::Instant;

/// Default memory budget: 512 MiB of event columns across all samples.
pub const FLOW_STORE_DEFAULT_BUDGET_BYTES: u64 = 512 * 1024 * 1024;

/// Bytes per event value: f32.
const BYTES_PER_VALUE: u64 = 4;

/// The Titer sidecar format (`.tfcs`): a little-endian column-major dump of
/// one sample's columns, so a saved project reloads without re-parsing FCS.
///   bytes 0..4    magic "TFCS"
///   bytes 4..8    u32 LE parameter count
///   bytes 8..12   u32 LE event count
///   bytes 12..    param_count × event_count f32 LE, column-major
///                   (all of parameter 0, then all of parameter 1, …)
/// The layout is deliberately mmap-shaped: each column is one contiguous
/// run, so a future memmap2 load maps the file and slices per column.
const SIDECAR_MAGIC: &[u8; 4] = b"TFCS";
const SIDECAR_HEADER_LEN: usize = 12;

/// One parameter's stats: min/max/mean over its finite values. `count` is
/// the finite count; min/max/mean are null when the parameter has no finite
/// value.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowParamStats {
    pub name: String,
    pub count: usize,
    pub min: Option<f32>,
    pub max: Option<f32>,
    pub mean: Option<f32>,
}

/// A sample's stats: its event count plus one entry per parameter.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowSampleStats {
    pub sample_id: String,
    pub event_count: usize,
    pub params: Vec<FlowParamStats>,
}

/// A loaded sample, as the store reports it: identity + metadata only.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowSampleInfo {
    pub sample_id: String,
    pub name: String,
    pub event_count: usize,
    pub parameter_count: usize,
    pub bytes: u64,
    pub source_path: Option<String>,
}

/// Store-wide memory state.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowStoreStatus {
    pub samples: usize,
    pub bytes: u64,
    pub budget_bytes: u64,
}

/// A sample's compensation state, as the store reports it (F2a, seq 447).
/// `spillover` is the matrix as applied (the editable source of truth);
/// `inverse` is the matrix actually multiplied. After clearing, the last
/// matrix is kept with `applied: false`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FlowCompensationState {
    pub fluorochromes: Vec<String>,
    pub spillover: Vec<Vec<f64>>,
    pub inverse: Vec<Vec<f64>>,
    pub source: String,
    pub applied: bool,
}

/// The unapplied state for a sample that never had compensation.
fn unapplied_compensation_state() -> FlowCompensationState {
    FlowCompensationState { fluorochromes: vec![], spillover: vec![], inverse: vec![], source: "file".to_string(), applied: false }
}

/// The compensated fluorochrome columns: one `Vec<f32>` per fluorochrome,
/// in `fluorochromes` order, materialised from the raw columns on apply.
#[derive(Debug)]
struct Compensated {
    fluorochromes: Vec<String>,
    columns: Vec<Vec<f32>>,
}

/// One loaded sample: its columns, in `param_names` order.
#[derive(Debug)]
struct LoadedSample {
    info: FlowSampleInfo,
    param_names: Vec<String>,
    columns: Vec<Vec<f32>>,
    compensated: Option<Compensated>,
    compensation: FlowCompensationState,
    last_used: Instant,
}

impl LoadedSample {
    /// The column a reader sees: the compensated copy for a compensated
    /// fluorochrome, the raw column for everything else.
    fn readable_column(&self, index: usize) -> &[f32] {
        if let Some(compensated) = &self.compensated {
            if let Some(at) = compensated.fluorochromes.iter().position(|f| f == &self.param_names[index]) {
                return &compensated.columns[at];
            }
        }
        &self.columns[index]
    }
}

/// The event store: all loaded samples + their byte budget. Held in Tauri
/// managed state (`main.rs`); every command locks it briefly — columns are
/// cloned out on read, so no lock is held across IPC.
#[derive(Debug)]
pub struct FlowStore {
    samples: Mutex<FlowStoreInner>,
}

#[derive(Debug)]
struct FlowStoreInner {
    samples: HashMap<String, LoadedSample>,
    bytes: u64,
    budget_bytes: u64,
}

impl Default for FlowStore {
    fn default() -> Self {
        Self::with_budget(read_budget_bytes())
    }
}

impl FlowStore {
    pub fn with_budget(budget_bytes: u64) -> Self {
        Self {
            samples: Mutex::new(FlowStoreInner {
                samples: HashMap::new(),
                bytes: 0,
                budget_bytes: if budget_bytes > 0 { budget_bytes } else { FLOW_STORE_DEFAULT_BUDGET_BYTES },
            }),
        }
    }

    /// Insert (or replace) a sample's columns, evicting least-recently-used
    /// samples until the store fits its budget — never the sample just loaded.
    /// `pub(crate)`: the FCS reader lane (`flow.rs`) loads parsed columns
    /// through this, the same call the `flow_load_sample` command makes.
    pub(crate) fn insert(
        &self,
        sample_id: &str,
        name: Option<String>,
        source_path: Option<String>,
        param_names: Vec<String>,
        columns: Vec<Vec<f32>>,
    ) -> Result<FlowSampleInfo, String> {
        if sample_id.is_empty() {
            return Err("A flow sample needs an id.".to_string());
        }
        if param_names.is_empty() {
            return Err(format!("Sample “{sample_id}” has no parameters."));
        }
        if columns.len() != param_names.len() {
            return Err(format!(
                "Sample “{sample_id}” has {} columns for {} parameters.",
                columns.len(),
                param_names.len()
            ));
        }
        if param_names.iter().collect::<std::collections::HashSet<_>>().len() != param_names.len() {
            return Err(format!("Sample “{sample_id}” repeats a parameter name."));
        }
        let event_count = columns.first().map(|c| c.len()).unwrap_or(0);
        if columns.iter().any(|c| c.len() != event_count) {
            return Err(format!("Sample “{sample_id}” has columns of different lengths."));
        }
        let bytes = event_count as u64 * param_names.len() as u64 * BYTES_PER_VALUE;
        let mut inner = self.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        if let Some(old) = inner.samples.remove(sample_id) {
            inner.bytes -= old.info.bytes;
        }
        let info = FlowSampleInfo {
            sample_id: sample_id.to_string(),
            name: name.unwrap_or_else(|| sample_id.to_string()),
            event_count,
            parameter_count: param_names.len(),
            bytes,
            source_path,
        };
        inner.samples.insert(
            sample_id.to_string(),
            LoadedSample {
                info: info.clone(),
                param_names,
                columns,
                compensated: None,
                compensation: unapplied_compensation_state(),
                last_used: Instant::now(),
            },
        );
        inner.bytes += bytes;
        // Evict least-recently-used samples until the store fits its budget.
        // The loop always leaves at least the sample just loaded behind.
        while inner.bytes > inner.budget_bytes && inner.samples.len() > 1 {
            let lru = inner
                .samples
                .iter()
                .filter(|(id, _)| id.as_str() != sample_id)
                .min_by_key(|(_, s)| s.last_used)
                .map(|(id, _)| id.clone());
            match lru {
                Some(id) => {
                    if let Some(evicted) = inner.samples.remove(&id) {
                        inner.bytes -= evicted.info.bytes;
                    }
                }
                None => break,
            }
        }
        Ok(info)
    }

    /// Rewrite one parameter's column in place through `f` (seq 448,
    /// F2b): the data transform. `pub(crate)`: the transform lane
    /// (`flow_transform.rs`) resolves the transform into `f` and calls
    /// this. Non-finite values are left alone (the transform is undefined
    /// there, and a NaN must not become a display value). Returns the
    /// event count plus the before/after stats of the parameter.
    pub(crate) fn apply_transform(
        &self,
        sample_id: &str,
        param: &str,
        f: &dyn Fn(f64) -> f64,
    ) -> Result<(usize, FlowParamStats, FlowParamStats), String> {
        let mut inner = self.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        let Some(sample) = inner.samples.get_mut(sample_id) else {
            return Err(format!("flow store: sample “{sample_id}” is not loaded"));
        };
        let Some(index) = sample.param_names.iter().position(|n| n == param) else {
            return Err(format!(
                "flow store: sample “{sample_id}” has no parameter “{param}” (unknown parameter)"
            ));
        };
        let before = param_stats(param, &sample.columns[index]);
        for v in sample.columns[index].iter_mut() {
            if v.is_finite() {
                *v = f(*v as f64) as f32;
            }
        }
        let after = param_stats(param, &sample.columns[index]);
        let event_count = sample.info.event_count;
        sample.last_used = Instant::now();
        Ok((event_count, before, after))
    }

    fn touch(&self, sample_id: &str) {
        if let Ok(mut inner) = self.samples.lock() {
            if let Some(sample) = inner.samples.get_mut(sample_id) {
                sample.last_used = Instant::now();
            }
        }
    }

    /// Apply a spillover matrix to a loaded sample (F2a, seq 447):
    /// materialise the compensated fluorochrome columns from the RAW
    /// columns (never from an already-compensated copy), charge their
    /// bytes, and record the state. Re-applying with an edited matrix
    /// recomputes from raw. `source` is "file" | "csv" | "manual".
    pub(crate) fn apply_compensation(
        &self,
        sample_id: &str,
        fluorochromes: Vec<String>,
        matrix: Vec<Vec<f64>>,
        source: String,
    ) -> Result<FlowCompensationState, String> {
        let mut inner = self.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        // Split borrows: `sample` borrows `samples` while `bytes` is a
        // separate borrow, so charging bytes alongside the sample edit
        // is not a double mutable borrow of `inner` (E0499).
        let FlowStoreInner { samples, bytes, .. } = &mut *inner;
        let Some(sample) = samples.get_mut(sample_id) else {
            return Err(format!("flow store: sample “{sample_id}” is not loaded"));
        };
        validate_spillover(&fluorochromes, &matrix, &sample.param_names)?;
        let inverse = invert_matrix(&matrix)?;
        let compensated_columns = compensate_fluorochrome_columns(&sample.columns, &sample.param_names, &fluorochromes, &inverse)?;
        if let Some(old) = &sample.compensated {
            let old_bytes = sample.info.event_count as u64 * old.fluorochromes.len() as u64 * BYTES_PER_VALUE;
            *bytes -= old_bytes;
            sample.info.bytes -= old_bytes;
        }
        let new_bytes = sample.info.event_count as u64 * fluorochromes.len() as u64 * BYTES_PER_VALUE;
        sample.compensated = Some(Compensated { fluorochromes: fluorochromes.clone(), columns: compensated_columns });
        sample.compensation = FlowCompensationState {
            fluorochromes,
            spillover: matrix,
            inverse,
            source,
            applied: true,
        };
        sample.info.bytes += new_bytes;
        *bytes += new_bytes;
        sample.last_used = Instant::now();
        Ok(sample.compensation.clone())
    }

    /// A sample's compensation state, or None when it isn't loaded.
    pub(crate) fn get_compensation(&self, sample_id: &str) -> Result<Option<FlowCompensationState>, String> {
        let inner = self.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        Ok(inner.samples.get(sample_id).map(|s| s.compensation.clone()))
    }

    /// Drop a sample's compensated copy (readable columns revert to raw)
    /// and keep the last matrix in the state with `applied: false`.
    /// False when the sample isn't loaded.
    pub(crate) fn clear_compensation(&self, sample_id: &str) -> Result<bool, String> {
        let mut inner = self.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        // Split borrows (see apply_compensation): `sample` borrows
        // `samples` while `bytes` is a separate borrow (E0499).
        let FlowStoreInner { samples, bytes, .. } = &mut *inner;
        let Some(sample) = samples.get_mut(sample_id) else {
            return Ok(false);
        };
        if let Some(old) = sample.compensated.take() {
            let old_bytes = sample.info.event_count as u64 * old.fluorochromes.len() as u64 * BYTES_PER_VALUE;
            *bytes -= old_bytes;
            sample.info.bytes -= old_bytes;
        }
        sample.compensation.applied = false;
        sample.last_used = Instant::now();
        Ok(true)
    }
}

/// Invert a square matrix (f64 Gauss-Jordan with partial pivoting — the
/// same algorithm as `src/flow/compensation.ts`). Refuses non-square,
/// non-finite and singular matrices.
fn invert_matrix(matrix: &[Vec<f64>]) -> Result<Vec<Vec<f64>>, String> {
    let n = matrix.len();
    if n == 0 {
        return Err("A compensation matrix must not be empty.".to_string());
    }
    for row in matrix {
        if row.len() != n {
            return Err(format!("A compensation matrix must be square: got a {n}x{} matrix.", row.len()));
        }
        if row.iter().any(|v| !v.is_finite()) {
            return Err("A compensation matrix must hold only finite numbers.".to_string());
        }
    }
    // Augment with the identity; row-reduce to the inverse.
    let mut aug: Vec<Vec<f64>> = matrix
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut r = row.clone();
            r.extend((0..n).map(|j| if i == j { 1.0 } else { 0.0 }));
            r
        })
        .collect();
    for col in 0..n {
        let mut pivot = col;
        for r in col + 1..n {
            if aug[r][col].abs() > aug[pivot][col].abs() {
                pivot = r;
            }
        }
        if aug[pivot][col].abs() < 1e-12 {
            return Err("A compensation matrix must not be singular: it has no inverse.".to_string());
        }
        if pivot != col {
            aug.swap(col, pivot);
        }
        let divisor = aug[col][col];
        for j in 0..2 * n {
            aug[col][j] /= divisor;
        }
        for r in 0..n {
            if r == col {
                continue;
            }
            let factor = aug[r][col];
            if factor == 0.0 {
                continue;
            }
            for j in 0..2 * n {
                aug[r][j] -= factor * aug[col][j];
            }
        }
    }
    Ok(aug.iter().map(|row| row[n..].to_vec()).collect())
}

/// Validate a spillover matrix against a sample's parameters: the
/// fluorochrome list must be non-empty and duplicate-free, the matrix
/// square over it, every fluorochrome a parameter of the sample, and
/// every entry finite.
fn validate_spillover(
    fluorochromes: &[String],
    matrix: &[Vec<f64>],
    param_names: &[String],
) -> Result<(), String> {
    if fluorochromes.is_empty() {
        return Err("A compensation matrix needs at least one fluorochrome.".to_string());
    }
    if fluorochromes.iter().collect::<std::collections::HashSet<_>>().len() != fluorochromes.len() {
        return Err("A compensation matrix must not repeat a fluorochrome.".to_string());
    }
    if matrix.len() != fluorochromes.len() {
        return Err(format!(
            "A compensation matrix must be square over its {} fluorochromes: got {} rows.",
            fluorochromes.len(),
            matrix.len()
        ));
    }
    for fluor in fluorochromes {
        if !param_names.iter().any(|p| p == fluor) {
            return Err(format!("Fluorochrome “{fluor}” is not a parameter of this sample."));
        }
    }
    // invert_matrix refuses non-square rows, non-finite entries and
    // singular matrices.
    invert_matrix(matrix)?;
    Ok(())
}

/// Compensate ONLY the fluorochrome columns: one `Vec<f32>` per
/// fluorochrome, in `fluorochromes` order, from the RAW columns (f64
/// accumulation, stored f32). `inverse` is the precomputed inverse of
/// the spillover matrix.
fn compensate_fluorochrome_columns(
    columns: &[Vec<f32>],
    param_names: &[String],
    fluorochromes: &[String],
    inverse: &[Vec<f64>],
) -> Result<Vec<Vec<f32>>, String> {
    let event_count = columns.first().map(|c| c.len()).unwrap_or(0);
    let raw_index: Vec<usize> = fluorochromes
        .iter()
        .map(|f| {
            param_names
                .iter()
                .position(|p| p == f)
                .ok_or_else(|| format!("Fluorochrome “{f}” is not a parameter of this sample."))
        })
        .collect::<Result<_, _>>()?;
    let mut out: Vec<Vec<f32>> = fluorochromes.iter().map(|_| vec![0.0; event_count]).collect();
    for e in 0..event_count {
        for (i, _) in fluorochromes.iter().enumerate() {
            let mut sum = 0.0f64;
            for (j, _) in fluorochromes.iter().enumerate() {
                sum += inverse[i][j] * columns[raw_index[j]][e] as f64;
            }
            out[i][e] = sum as f32;
        }
    }
    Ok(out)
}

/// The budget override: `TITER_FLOW_STORE_BUDGET_MB`, in MiB. Unset or
/// unparsable reads as the default.
fn read_budget_bytes() -> u64 {
    std::env::var("TITER_FLOW_STORE_BUDGET_MB")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(|mb| mb * 1024 * 1024)
        .unwrap_or(FLOW_STORE_DEFAULT_BUDGET_BYTES)
}

fn param_stats(name: &str, column: &[f32]) -> FlowParamStats {
    let mut count = 0usize;
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut sum = 0f64;
    for &v in column {
        if !v.is_finite() {
            continue;
        }
        count += 1;
        if v < min {
            min = v;
        }
        if v > max {
            max = v;
        }
        sum += v as f64;
    }
    FlowParamStats {
        name: name.to_string(),
        count,
        min: if count > 0 { Some(min) } else { None },
        max: if count > 0 { Some(max) } else { None },
        mean: if count > 0 { Some((sum / count as f64) as f32) } else { None },
    }
}

/// Load one sample's events, columnar: one `Vec<f32>` per parameter, in
/// `param_names` order. Replacing a loaded sample frees its bytes first.
#[tauri::command]
pub fn flow_load_sample(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
    param_names: Vec<String>,
    columns: Vec<Vec<f32>>,
    name: Option<String>,
    source_path: Option<String>,
) -> Result<FlowSampleInfo, String> {
    state.insert(&sample_id, name, source_path, param_names, columns)
}

/// Load one sample from a `.tfcs` sidecar file (see `SIDECAR_*` above):
/// the file's parameter count must match `param_names`, and its length must
/// be exactly the header + the columns — a truncated or padded file is
/// refused, not read halfway.
#[tauri::command]
pub fn flow_load_sample_file(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
    path: String,
    param_names: Vec<String>,
    name: Option<String>,
    source_path: Option<String>,
) -> Result<FlowSampleInfo, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Cannot read sidecar file “{path}”: {e}"))?;
    let columns = parse_sidecar(&bytes, param_names.len())
        .map_err(|e| format!("Sidecar file “{path}” is not a valid .tfcs file: {e}"))?;
    state.insert(&sample_id, name, source_path.or(Some(path)), param_names, columns)
}

/// Parse `.tfcs` bytes into column-major `Vec<f32>` columns.
fn parse_sidecar(bytes: &[u8], param_count: usize) -> Result<Vec<Vec<f32>>, String> {
    if bytes.len() < SIDECAR_HEADER_LEN || &bytes[0..4] != SIDECAR_MAGIC {
        return Err("bad magic — expected \"TFCS\"".to_string());
    }
    let file_params = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let event_count = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    if file_params != param_count {
        return Err(format!("file holds {file_params} parameters, expected {param_count}"));
    }
    let expected = SIDECAR_HEADER_LEN + file_params * event_count * 4;
    if bytes.len() != expected {
        return Err(format!(
            "file is {} bytes, expected {expected} for {file_params} parameters × {event_count} events",
            bytes.len()
        ));
    }
    let mut columns = Vec::with_capacity(file_params);
    for p in 0..file_params {
        let start = SIDECAR_HEADER_LEN + p * event_count * 4;
        let mut column = Vec::with_capacity(event_count);
        for i in 0..event_count {
            let at = start + i * 4;
            column.push(f32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()));
        }
        columns.push(column);
    }
    Ok(columns)
}

/// One parameter's events, or null when the sample or the parameter is
/// unknown. The returned column is a copy — the store keeps its own.
/// After compensation the COMPENSATED column is returned for a
/// compensated fluorochrome, the raw column otherwise.
#[tauri::command]
pub fn flow_get_column(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
    param: String,
) -> Result<Option<Vec<f32>>, String> {
    let column = {
        let inner = state.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        let Some(sample) = inner.samples.get(&sample_id) else {
            return Ok(None);
        };
        let Some(index) = sample.param_names.iter().position(|n| n == &param) else {
            return Ok(None);
        };
        sample.readable_column(index).to_vec()
    };
    state.touch(&sample_id);
    Ok(Some(column))
}

/// Every loaded sample's info, least-recently-used first.
#[tauri::command]
pub fn flow_list_samples(state: tauri::State<'_, FlowStore>) -> Result<Vec<FlowSampleInfo>, String> {
    let inner = state.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
    let mut samples: Vec<&LoadedSample> = inner.samples.values().collect();
    samples.sort_by_key(|s| s.last_used);
    Ok(samples.iter().map(|s| s.info.clone()).collect())
}

/// Drop one sample; true when it was loaded, false when it wasn't.
#[tauri::command]
pub fn flow_unload_sample(state: tauri::State<'_, FlowStore>, sample_id: String) -> Result<bool, String> {
    let mut inner = state.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
    match inner.samples.remove(&sample_id) {
        Some(removed) => {
            inner.bytes -= removed.info.bytes;
            Ok(true)
        }
        None => Ok(false),
    }
}

/// A sample's stats: its event count plus each parameter's min/max/mean;
/// null when the sample isn't loaded. Stats run over the READABLE
/// columns, so after compensation they describe the compensated data.
#[tauri::command]
pub fn flow_sample_stats(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
) -> Result<Option<FlowSampleStats>, String> {
    let stats = {
        let inner = state.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
        let Some(sample) = inner.samples.get(&sample_id) else {
            return Ok(None);
        };
        FlowSampleStats {
            sample_id: sample.info.sample_id.clone(),
            event_count: sample.info.event_count,
            params: sample
                .param_names
                .iter()
                .enumerate()
                .map(|(i, name)| param_stats(name, sample.readable_column(i)))
                .collect(),
        }
    };
    state.touch(&sample_id);
    Ok(Some(stats))
}

/// Apply a spillover matrix to a loaded sample (F2a, seq 447): the
/// compensated fluorochrome columns are materialised from the RAW columns
/// and become the readable columns. `source` is "file" | "csv" | "manual".
#[tauri::command]
pub fn flow_apply_compensation(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
    fluorochromes: Vec<String>,
    matrix: Vec<Vec<f64>>,
    source: String,
) -> Result<FlowCompensationState, String> {
    state.apply_compensation(&sample_id, fluorochromes, matrix, source)
}

/// A sample's compensation state, or null when it isn't loaded.
#[tauri::command]
pub fn flow_get_compensation(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
) -> Result<Option<FlowCompensationState>, String> {
    state.get_compensation(&sample_id)
}

/// Drop a sample's compensated copy (readable columns revert to raw);
/// true when the sample was loaded, false when it wasn't.
#[tauri::command]
pub fn flow_clear_compensation(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
) -> Result<bool, String> {
    state.clear_compensation(&sample_id)
}

/// Store-wide memory state.
#[tauri::command]
pub fn flow_store_status(state: tauri::State<'_, FlowStore>) -> Result<FlowStoreStatus, String> {
    let inner = state.samples.lock().map_err(|_| "Flow store lock is poisoned.".to_string())?;
    Ok(FlowStoreStatus { samples: inner.samples.len(), bytes: inner.bytes, budget_bytes: inner.budget_bytes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn load_test_sample(store: &FlowStore) -> FlowSampleInfo {
        store
            .insert(
                "s1",
                Some("Sample 1".to_string()),
                Some("sample1.fcs".to_string()),
                vec!["FSC-A".to_string(), "SSC-A".to_string(), "CD4".to_string()],
                vec![
                    vec![100.0, 200.0, 300.0, 400.0, 500.0],
                    vec![10.0, 20.0, 30.0, 40.0, 50.0],
                    vec![0.5, 1.5, 2.5, 3.5, 4.5],
                ],
            )
            .expect("test sample loads")
    }

    #[test]
    fn load_and_stats_round_trip() {
        let store = FlowStore::with_budget(1024 * 1024);
        let info = load_test_sample(&store);
        assert_eq!(info.event_count, 5);
        assert_eq!(info.parameter_count, 3);
        assert_eq!(info.bytes, 5 * 3 * 4);
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("s1").unwrap();
        assert_eq!(sample.columns[2], vec![0.5, 1.5, 2.5, 3.5, 4.5]);
        assert_eq!(param_stats("CD4", &sample.columns[2]).mean, Some(2.5));
        assert_eq!(param_stats("FSC-A", &sample.columns[0]).min, Some(100.0));
        assert_eq!(param_stats("FSC-A", &sample.columns[0]).max, Some(500.0));
    }

    #[test]
    fn apply_transform_rewrites_one_column_in_place() {
        // Seq 448 (F2b): the store-level transform — only the named
        // column changes, non-finite values are left alone, and the
        // before/after stats describe the rewrite.
        let store = FlowStore::with_budget(1024 * 1024);
        load_test_sample(&store);
        let (events, before, after) = store
            .apply_transform("s1", "CD4", &|x| x * 2.0)
            .expect("transform applies");
        assert_eq!(events, 5);
        assert_eq!(before.mean, Some(2.5));
        assert_eq!(after.mean, Some(5.0));
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("s1").unwrap();
        assert_eq!(sample.columns[2], vec![1.0, 3.0, 5.0, 7.0, 9.0]);
        assert_eq!(sample.columns[0], vec![100.0, 200.0, 300.0, 400.0, 500.0]);
        // The guard stays alive past the last `sample` use (no early drop),
        // and apply_transform re-locks this same non-reentrant Mutex — drop
        // it explicitly first, or the error-path calls deadlock (gate hang).
        drop(inner);
        assert!(store.apply_transform("no-such", "CD4", &|x| x).is_err());
        assert!(store.apply_transform("s1", "no-such", &|x| x).is_err());
    }

    #[test]
    fn mismatched_columns_are_refused() {
        let store = FlowStore::with_budget(1024 * 1024);
        assert!(store
            .insert("bad", None, None, vec!["A".to_string(), "B".to_string()], vec![vec![1.0, 2.0], vec![1.0]])
            .is_err());
        assert!(store
            .insert("bad", None, None, vec!["A".to_string(), "A".to_string()], vec![vec![1.0], vec![1.0]])
            .is_err());
    }

    #[test]
    fn lru_eviction_keeps_the_just_loaded_sample() {
        // Budget fits 4 samples of 20 B; the 5th load evicts the oldest.
        let store = FlowStore::with_budget(80);
        for id in ["a", "b", "c", "d", "e"] {
            store.insert(id, None, None, vec!["FSC-A".to_string()], vec![vec![1.0, 2.0, 3.0, 4.0, 5.0]]).unwrap();
        }
        let inner = store.samples.lock().unwrap();
        assert!(!inner.samples.contains_key("a"));
        assert_eq!(inner.samples.len(), 4);
        assert_eq!(inner.bytes, 80);
    }

    #[test]
    fn sidecar_fixture_parses() {
        let bytes = include_bytes!("../../tests/testdata/flow-sample-1.tfcs");
        let columns = parse_sidecar(bytes, 3).expect("fixture parses");
        assert_eq!(columns.len(), 3);
        assert_eq!(columns[0].len(), 8);
        assert_eq!(columns[0][0], 100.0);
        assert_eq!(columns[2][7], 7.5);
    }

    #[test]
    fn sidecar_rejects_bad_magic_and_truncation() {
        assert!(parse_sidecar(b"XXXX\x03\x00\x00\x00\x08\x00\x00\x00", 3).is_err());
        let mut truncated = include_bytes!("../../tests/testdata/flow-sample-1.tfcs").to_vec();
        truncated.truncate(truncated.len() - 4);
        assert!(parse_sidecar(&truncated, 3).is_err());
        assert!(parse_sidecar(include_bytes!("../../tests/testdata/flow-sample-1.tfcs"), 2).is_err());
    }

    #[test]
    fn store_info_serialises_camel_case_for_the_ts_contract() {
        // Seq 443 (F1c): the TS store interface reads `sampleId` /
        // `eventCount` / `parameterCount` / `sourcePath` — the wire
        // format must be camelCase, not serde's snake_case default.
        let store = FlowStore::with_budget(1024 * 1024);
        let info = load_test_sample(&store);
        let value = serde_json::to_value(&info).expect("info serialises");
        assert_eq!(value["sampleId"], "s1");
        assert_eq!(value["eventCount"], 5);
        assert_eq!(value["parameterCount"], 3);
        assert_eq!(value["sourcePath"], "sample1.fcs");
        assert!(value.get("sample_id").is_none(), "no snake_case keys leak: {value}");
        let status = FlowStoreStatus { samples: 1, bytes: 60, budget_bytes: 1024 * 1024 };
        assert_eq!(serde_json::to_value(&status).unwrap()["budgetBytes"], 1024 * 1024);
    }

    // ── F2a (seq 447): compensation ─────────────────────────────────────

    /// The synth-spill 3x3 and its columns, as the F0 harness verified.
    fn spill_matrix() -> Vec<Vec<f64>> {
        vec![
            vec![1.0, 0.05, 0.01],
            vec![0.02, 1.0, 0.03],
            vec![0.0, 0.04, 1.0],
        ]
    }

    fn spill_fluorochromes() -> Vec<String> {
        vec!["FL1-A".to_string(), "FL2-A".to_string(), "FL3-A".to_string()]
    }

    fn load_spill_sample(store: &FlowStore) {
        store
            .insert(
                "spill",
                Some("synth-spill".to_string()),
                Some("synth-spill.fcs".to_string()),
                spill_fluorochromes(),
                vec![
                    vec![100.0, 200.0, 300.0, 400.0],
                    vec![200.0, 400.0, 600.0, 800.0],
                    vec![300.0, 600.0, 900.0, 1200.0],
                ],
            )
            .expect("spill sample loads");
    }

    fn close(actual: f32, expected: f64, what: &str) {
        assert!((actual as f64 - expected).abs() < 1e-3, "{what} must be ~{expected} (got {actual})");
    }

    #[test]
    fn invert_matrix_matches_numpy_reference() {
        // numpy inv(S): the F0 oracle's independent reference.
        let inv = invert_matrix(&spill_matrix()).expect("spill matrix inverts");
        assert!((inv[0][0] - 1.00099418).abs() < 1e-7);
        assert!((inv[0][1] - -0.04970896).abs() < 1e-7);
        assert!((inv[1][2] - -0.02986547).abs() < 1e-7);
        assert!((inv[2][0] - 0.00080176).abs() < 1e-7);
        // Refusals: singular, non-square, non-finite.
        assert!(invert_matrix(&[vec![1.0, 1.0], vec![1.0, 1.0]]).is_err(), "singular must be refused");
        assert!(invert_matrix(&[vec![1.0, 0.0], vec![0.0, 1.0, 0.0]]).is_err(), "non-square must be refused");
        assert!(invert_matrix(&[vec![1.0, f64::NAN], vec![0.0, 1.0]]).is_err(), "non-finite must be refused");
    }

    #[test]
    fn compensation_applies_the_file_matrix() {
        let store = FlowStore::with_budget(1024 * 1024);
        load_spill_sample(&store);
        let state = store
            .apply_compensation("spill", spill_fluorochromes(), spill_matrix(), "file".to_string())
            .expect("apply succeeds");
        assert!(state.applied);
        assert_eq!(state.source, "file");
        assert_eq!(state.fluorochromes, spill_fluorochromes());
        // The F0 oracle: first compensated value 87.60202.
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("spill").unwrap();
        close(sample.readable_column(0)[0], 87.60202, "compensated FL1-A event 0");
        close(sample.readable_column(1)[0], 189.47533, "compensated FL2-A event 0");
        close(sample.readable_column(2)[0], 292.42099, "compensated FL3-A event 0");
        close(sample.readable_column(0)[3], 350.40809, "compensated FL1-A event 3");
        // The raw columns are untouched.
        assert_eq!(sample.columns[0], vec![100.0, 200.0, 300.0, 400.0]);
        // The compensated copy is charged on top of the raw columns.
        assert_eq!(sample.info.bytes, 4 * 3 * 4 + 4 * 3 * 4);
        // The state serialises camelCase for the TS contract.
        let value = serde_json::to_value(&state).expect("state serialises");
        assert_eq!(value["applied"], true);
        assert_eq!(value["source"], "file");
        assert!(value.get("spillover").is_some() && value.get("inverse").is_some());
        drop(inner);
        // Re-applying with an edited matrix (identity) recomputes from
        // RAW — it does not stack on the compensated values.
        store
            .apply_compensation(
                "spill",
                spill_fluorochromes(),
                vec![vec![1.0, 0.0, 0.0], vec![0.0, 1.0, 0.0], vec![0.0, 0.0, 1.0]],
                "manual".to_string(),
            )
            .expect("re-apply succeeds");
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("spill").unwrap();
        assert_eq!(sample.readable_column(0), &[100.0, 200.0, 300.0, 400.0]);
        assert_eq!(sample.compensation.source, "manual");
        drop(inner);
        // Clear reverts to raw and reports unapplied, keeping the matrix.
        assert!(store.clear_compensation("spill").expect("clear succeeds"));
        let state = store.get_compensation("spill").expect("get succeeds").expect("sample loaded");
        assert!(!state.applied);
        assert_eq!(state.source, "manual");
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("spill").unwrap();
        assert_eq!(sample.readable_column(1), &[200.0, 400.0, 600.0, 800.0]);
        assert_eq!(sample.info.bytes, 4 * 3 * 4, "clear frees the compensated bytes");
        // Drop the guard before the re-locking call below (same shape as F2b).
        drop(inner);
        assert!(!store.clear_compensation("missing").expect("clear of unknown is false"));
    }

    #[test]
    fn compensation_is_sparse_across_measurement_types() {
        // The real multi-type fixture, loaded through the FCS reader: its
        // 3x3 $SPILLOVER covers the -A fluorochromes only, so the -H
        // params and FSC-A/FSC-H must pass through bit-identical.
        let store = FlowStore::with_budget(1024 * 1024);
        let path = format!("{}/../tests/testdata/fcs/f2a-multi-type.fcs", env!("CARGO_MANIFEST_DIR"));
        let summary = crate::flow::import_fcs_file(&path, Some("multi".to_string()), None, &store)
            .expect("multi-type fixture imports");
        assert_eq!(summary.event_count, 4);
        let spill = summary.spillover.expect("fixture carries $SPILLOVER");
        assert_eq!(spill.fluorochromes, spill_fluorochromes());
        let matrix: Vec<Vec<f64>> = spill.matrix.iter().map(|row| row.iter().map(|v| *v as f64).collect()).collect();
        store
            .apply_compensation("multi", spill.fluorochromes, matrix, "file".to_string())
            .expect("apply succeeds");
        let inner = store.samples.lock().unwrap();
        let sample = inner.samples.get("multi").unwrap();
        // Param order: FSC-A, FSC-H, FL1-A, FL1-H, FL2-A, FL2-H, FL3-A, FL3-H.
        assert_eq!(sample.readable_column(1), &[100.0, 200.0, 300.0, 400.0], "FSC-H passes through");
        assert_eq!(sample.readable_column(3), &[10.0, 20.0, 30.0, 40.0], "FL1-H passes through");
        assert_eq!(sample.readable_column(0), &[1000.0, 2000.0, 3000.0, 4000.0], "FSC-A passes through");
        close(sample.readable_column(2)[0], 87.60202, "multi-type FL1-A event 0");
        close(sample.readable_column(6)[3], 1169.68395, "multi-type FL3-A event 3");
    }

    #[test]
    fn compensation_refusals() {
        let store = FlowStore::with_budget(1024 * 1024);
        load_spill_sample(&store);
        // Unknown sample.
        assert!(store.apply_compensation("missing", spill_fluorochromes(), spill_matrix(), "file".to_string()).is_err());
        // Unknown fluorochrome.
        assert!(store
            .apply_compensation(
                "spill",
                vec!["FL1-A".to_string(), "NOPE".to_string()],
                vec![vec![1.0, 0.0], vec![0.0, 1.0]],
                "manual".to_string()
            )
            .is_err());
        // Singular matrix.
        assert!(store
            .apply_compensation(
                "spill",
                vec!["FL1-A".to_string(), "FL2-A".to_string()],
                vec![vec![1.0, 1.0], vec![1.0, 1.0]],
                "manual".to_string()
            )
            .is_err());
        // A never-compensated sample reports applied: false.
        let state = store.get_compensation("spill").expect("get succeeds").expect("sample loaded");
        assert!(!state.applied);
        assert!(store.get_compensation("missing").expect("get succeeds").is_none());
    }
}
