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

/// One loaded sample: its columns, in `param_names` order.
#[derive(Debug)]
struct LoadedSample {
    info: FlowSampleInfo,
    param_names: Vec<String>,
    columns: Vec<Vec<f32>>,
    last_used: Instant,
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
            LoadedSample { info: info.clone(), param_names, columns, last_used: Instant::now() },
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

    fn touch(&self, sample_id: &str) {
        if let Ok(mut inner) = self.samples.lock() {
            if let Some(sample) = inner.samples.get_mut(sample_id) {
                sample.last_used = Instant::now();
            }
        }
    }
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
        sample.columns[index].clone()
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
/// null when the sample isn't loaded.
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
                .zip(sample.columns.iter())
                .map(|(name, column)| param_stats(name, column))
                .collect(),
        }
    };
    state.touch(&sample_id);
    Ok(Some(stats))
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
}
