//! FlowJo track — FCS 2.0–3.2 reader (seq 443, F1c).
//!
//! Wires the ADOPTED `flow-fcs` 0.6.0 crate (see `docs/flow-fcs-evaluation.md`)
//! into F1a's event store (`flow_store.rs`). One public entry point:
//! `flow_import_fcs` (Tauri command) / `import_fcs_file` (plain function) —
//! a real FCS file goes in, its events land in the store, and only a
//! summary comes back (never event arrays).
//!
//! The crate is a *reader only* here. In particular:
//! - NEVER the crate's logicle/biexponential for display or gating — its
//!   `Biexponential` is arcsinh with the width ignored (evaluation §9).
//!   Transforms are a later lane's job; this lane applies none.
//! - NEVER the crate's compensation either: `$SPILLOVER`/`$SPILL`/`$COMP`
//!   is *reported* in the import summary (so the sample node can carry it)
//!   but not applied to the stored events.
//!
//! The six ADOPT conditions (evaluation doc) are implemented here:
//! 1. No logicle/biexponential use (see above).
//! 2. The `.fcs` extension gate: files with any other (or no) extension
//!    are staged under a `.fcs` name in a temp dir before opening.
//! 3. 24/8/64-bit int + ASCII data: refused up front with a clear
//!    "unsupported $DATATYPE/$PnB" error, never a crash or silent misread.
//! 4. No `specta`/`typescript` features (Cargo.toml declares only
//!    `compensation`).
//! 5. Short `$BYTEORD` forms (`"1,2"` / `"2,1"`) are normalised to the
//!    full forms before opening.
//! 6. HEADER-vs-TEXT DATA offsets are pre-validated and the file is
//!    REFUSED on disagreement — the crate trusts a non-zero wrong HEADER
//!    offset blindly and silently returns garbage values.
//!
//! Two more normalisations the evaluation's gap list requires:
//! - Blank (space-filled) HEADER ANALYSIS offsets are treated as 0
//!   (FCS §3.8 explicitly allows spaces for unused offsets); the crate's
//!   header parser fails on them.
//! - A bare legacy `SPILL` keyword (no `$`) is renamed to `$SPILL`
//!   (dropped when `$SPILL`/`$SPILLOVER` is already present).
//!
//! How staging works: the file is parsed (HEADER + TEXT per dataset in
//! the `$NEXTDATA` chain), the guard + datatype checks run on the parsed
//! values, and only when a normalisation (or the extension gate) requires
//! it is a staged copy written — TEXT rebuilt with the normalised
//! keywords, every offset that points past TEXT shifted by the TEXT
//! length delta (to a fixpoint, since digit counts can change), and all
//! other bytes (gaps, DATA, ANALYSIS, later datasets, trailing CRC)
//! copied verbatim. A clean `.fcs` file is opened in place, never copied.

use flow_fcs::Fcs;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::flow_store::{FlowSampleInfo, FlowStore};

/// Maximum datasets walked in a `$NEXTDATA` chain (loop guard).
const MAX_DATASETS: usize = 16;

/// One parameter's metadata, as the file spells it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FcsParameterMeta {
    /// Parameter name ($PnN).
    pub name: String,
    /// Bits per value ($PnB).
    pub bits: usize,
    /// Full-scale range in raw channel units ($PnR).
    pub range: usize,
    /// Stain / fluorochrome ($PnS), when the file names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stain: Option<String>,
}

/// The spillover matrix a file carries ($SPILLOVER / $SPILL / $COMP),
/// reported — never applied — so the sample node can carry it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FcsSpilloverSummary {
    /// Fluorochromes, in the matrix's row/column order.
    pub fluorochromes: Vec<String>,
    pub rows: usize,
    pub cols: usize,
    /// The matrix itself, rows in `fluorochromes` order.
    pub matrix: Vec<Vec<f32>>,
}

/// One dataset in the file, as opened.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FcsDatasetSummary {
    pub index: usize,
    pub parameters: usize,
    pub events: usize,
}

/// What `flow_import_fcs` returns: a summary only, never event arrays.
/// The store holds the events; the project holds a sample node built
/// from this (see `src/flow/fcs.ts`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FcsImportSummary {
    /// The event-store sample id (== the sample node's id, by convention).
    pub sample_id: String,
    pub name: String,
    pub source_path: String,
    /// FCS version string, e.g. "FCS3.0".
    pub version: String,
    /// Events loaded into the store (first dataset only).
    pub event_count: usize,
    pub parameters: Vec<FcsParameterMeta>,
    /// Every dataset in the `$NEXTDATA` chain (the import loads the first).
    pub datasets: Vec<FcsDatasetSummary>,
    /// The file's spillover matrix, when it carries one (not applied).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spillover: Option<FcsSpilloverSummary>,
    /// Instrument ($CYT), when the file names one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument: Option<String>,
    /// What staging changed about the file before opening (empty when the
    /// file opened in place).
    pub normalisations: Vec<String>,
    /// Non-fatal notes (e.g. `$TOT` vs decoded-count mismatch, a
    /// `$NEXTDATA` chain that could not be fully read).
    pub warnings: Vec<String>,
    /// What the store holds now for this sample.
    pub store: FlowSampleInfo,
}

/// A parsed FCS file, columns extracted and ready to load into the store.
#[derive(Debug)]
struct ReadFcsSample {
    version: String,
    name: String,
    instrument: Option<String>,
    parameters: Vec<FcsParameterMeta>,
    columns: Vec<Vec<f32>>,
    event_count: usize,
    datasets: Vec<FcsDatasetSummary>,
    spillover: Option<FcsSpilloverSummary>,
    normalisations: Vec<String>,
    warnings: Vec<String>,
}

/// One dataset's HEADER, as parsed (offsets are dataset-relative).
#[derive(Debug, Clone)]
struct HeaderView {
    version: String,
    text_start: usize,
    text_end: usize,
    data_start: usize,
    data_end: usize,
    analysis_start: usize,
    analysis_end: usize,
    /// Which of the six offset fields were blank (space-filled) — they
    /// read as 0 and must be rewritten as `0` when staging, or the
    /// crate's header parser fails on them.
    blank_fields: Vec<&'static str>,
}

/// One dataset, parsed but not yet opened: its HEADER + TEXT keywords.
struct DatasetInfo {
    /// Absolute file offset of this dataset's HEADER.
    base: usize,
    header: HeaderView,
    delimiter: u8,
    /// Ordered TEXT keyword pairs (key, value).
    pairs: Vec<(String, String)>,
    /// The `$NEXTDATA` value: byte offset from this dataset's start to
    /// the next dataset's HEADER (0 = last dataset).
    nextdata: usize,
    /// Absolute file offset where this dataset's span ends (the next
    /// dataset's base, or the file length).
    span_end: usize,
}

fn header_field(
    bytes: &[u8],
    base: usize,
    lo: usize,
    hi: usize,
    name: &'static str,
    blank_fields: &mut Vec<&'static str>,
) -> Result<usize, String> {
    let raw = bytes
        .get(base + lo..base + hi)
        .ok_or_else(|| format!("Truncated FCS HEADER: missing the {name} offset field"))?;
    let text = std::str::from_utf8(raw)
        .map_err(|_| format!("FCS HEADER {name} offset is not ASCII"))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        // FCS §3.8: unused HEADER space is filled with ASCII spaces.
        blank_fields.push(name);
        return Ok(0);
    }
    trimmed.parse::<usize>().map_err(|_| {
        format!("FCS HEADER {name} offset {trimmed:?} is not a number")
    })
}

/// Parse one dataset's 58-byte HEADER at `base` (dataset-relative offsets).
fn parse_header(bytes: &[u8], base: usize) -> Result<HeaderView, String> {
    if bytes.len() < base + 58 {
        return Err(format!(
            "Truncated FCS HEADER: file is {} bytes, a dataset HEADER needs 58",
            bytes.len()
        ));
    }
    let version_raw = std::str::from_utf8(&bytes[base..base + 6])
        .map_err(|_| "FCS HEADER version is not ASCII".to_string())?;
    if !version_raw.starts_with("FCS") {
        return Err(format!(
            "Not an FCS file: expected a version like \"FCS3.0\" at byte {base}, found {version_raw:?}"
        ));
    }
    let mut blank_fields = Vec::new();
    let text_start = header_field(bytes, base, 10, 18, "TEXT begin", &mut blank_fields)?;
    let text_end = header_field(bytes, base, 18, 26, "TEXT end", &mut blank_fields)?;
    let data_start = header_field(bytes, base, 26, 34, "DATA begin", &mut blank_fields)?;
    let data_end = header_field(bytes, base, 34, 42, "DATA end", &mut blank_fields)?;
    let analysis_start =
        header_field(bytes, base, 42, 50, "ANALYSIS begin", &mut blank_fields)?;
    let analysis_end = header_field(bytes, base, 50, 58, "ANALYSIS end", &mut blank_fields)?;
    Ok(HeaderView {
        version: version_raw.trim().to_string(),
        text_start,
        text_end,
        data_start,
        data_end,
        analysis_start,
        analysis_end,
        blank_fields,
    })
}

/// Parse a TEXT segment: the delimiter is its first byte; a doubled
/// delimiter inside a value is a literal delimiter, not a separator.
fn parse_text(
    bytes: &[u8],
    base: usize,
    text_start: usize,
    text_end: usize,
) -> Result<(u8, Vec<(String, String)>), String> {
    let start = base.checked_add(text_start).ok_or("TEXT offset overflow")?;
    let end = base.checked_add(text_end).ok_or("TEXT offset overflow")?;
    if start >= bytes.len() || end >= bytes.len() || start > end {
        return Err(format!(
            "TEXT segment {text_start}..{text_end} is outside the {} byte file",
            bytes.len()
        ));
    }
    let seg = &bytes[start..=end];
    let delim = seg[0];
    // TEXT end offsets are inclusive per spec, but some writers emit
    // exclusive ends (coulter.lmd's TEXT end points one byte past its
    // closing delimiter, at a space; its DATA end is off by one the same
    // way). Tolerate exactly one trailing byte when the segment does not
    // end with its delimiter — never more, so DATA bytes are never
    // swallowed into TEXT.
    let seg = if seg[seg.len() - 1] == delim {
        seg
    } else if seg.len() >= 2 && seg[seg.len() - 2] == delim {
        &seg[..seg.len() - 1]
    } else {
        return Err("Malformed TEXT segment: it must start and end with its delimiter".to_string());
    };
    let mut tokens: Vec<Vec<u8>> = Vec::new();
    let mut cur: Vec<u8> = Vec::new();
    let mut i = 1;
    while i < seg.len() {
        if seg[i] == delim {
            if i + 1 < seg.len() && seg[i + 1] == delim {
                cur.push(delim);
                i += 2;
            } else {
                tokens.push(std::mem::take(&mut cur));
                i += 1;
            }
        } else {
            cur.push(seg[i]);
            i += 1;
        }
    }
    tokens.push(cur);
    // The tokenizer starts after the opening delimiter, so the tokens
    // are [key, value, key, value, …, ""] — the trailing empty token is
    // the text after the closing delimiter. A well-formed segment has at
    // least one pair and ends with its delimiter (trailing token empty).
    if tokens.len() < 3 || tokens.last().map(|t| !t.is_empty()).unwrap_or(true) {
        return Err("Malformed TEXT segment: it must start and end with its delimiter".to_string());
    }
    let body = &tokens[..tokens.len() - 1];
    if body.len() % 2 != 0 {
        return Err(format!(
            "Malformed TEXT segment: {} keyword/value tokens is odd — a keyword has no value",
            body.len()
        ));
    }
    let mut pairs = Vec::with_capacity(body.len() / 2);
    for chunk in body.chunks_exact(2) {
        pairs.push((
            String::from_utf8_lossy(&chunk[0]).into_owned(),
            String::from_utf8_lossy(&chunk[1]).into_owned(),
        ));
    }
    Ok((delim, pairs))
}

/// Serialise TEXT pairs with the delimiter, doubling the delimiter inside
/// keys and values (the inverse of `parse_text`).
fn serialise_text(delim: u8, pairs: &[(String, String)]) -> Vec<u8> {
    let escape = |s: &str| -> Vec<u8> {
        let mut out = Vec::with_capacity(s.len());
        for &b in s.as_bytes() {
            out.push(b);
            if b == delim {
                out.push(b);
            }
        }
        out
    };
    let mut out = vec![delim];
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(delim);
        }
        out.extend_from_slice(&escape(k));
        out.push(delim);
        out.extend_from_slice(&escape(v));
    }
    out.push(delim);
    out
}

fn lookup<'a>(pairs: &'a [(String, String)], key: &str) -> Option<&'a str> {
    pairs.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
}

fn lookup_usize(pairs: &[(String, String)], key: &str) -> Result<Option<usize>, String> {
    match lookup(pairs, key) {
        None => Ok(None),
        Some(v) => v
            .trim()
            .parse::<usize>()
            .map(Some)
            .map_err(|_| format!("TEXT keyword {key} has a non-numeric value {v:?}")),
    }
}

/// Condition 6 — the silent-misread guard. Refuse when a non-zero HEADER
/// DATA offset disagrees with the TEXT `$BEGINDATA`/`$ENDDATA` for the
/// same dataset. Missing TEXT offsets mean "trust the HEADER" (coulter
/// ds1 carries none); zero HEADER offsets mean "trust the TEXT" (the
/// 64-bit-offset case).
fn check_offsets(header: &HeaderView, pairs: &[(String, String)], index: usize) -> Result<(), String> {
    let begin = lookup_usize(pairs, "$BEGINDATA")?;
    let end = lookup_usize(pairs, "$ENDDATA")?;
    if header.data_start != 0 {
        if let Some(t) = begin {
            if t != header.data_start {
                return Err(format!(
                    "Refusing dataset {index}: HEADER DATA start {h} disagrees with TEXT $BEGINDATA {t} — \
                     the file's offsets are inconsistent, so its events cannot be trusted",
                    h = header.data_start
                ));
            }
        }
    }
    if header.data_end != 0 {
        if let Some(t) = end {
            if t != header.data_end {
                return Err(format!(
                    "Refusing dataset {index}: HEADER DATA end {h} disagrees with TEXT $ENDDATA {t} — \
                     the file's offsets are inconsistent, so its events cannot be trusted",
                    h = header.data_end
                ));
            }
        }
    }
    if header.data_start != 0 && header.data_end != 0 && header.data_end < header.data_start {
        return Err(format!(
            "Refusing dataset {index}: HEADER DATA end {} is before DATA start {}",
            header.data_end, header.data_start
        ));
    }
    Ok(())
}

/// Condition 3 (+ histogram mode): refuse data the crate cannot decode,
/// with a clear error naming the keyword — never a crash, never a
/// silent misread.
fn check_datatype(pairs: &[(String, String)], index: usize) -> Result<(), String> {
    if lookup(pairs, "$MODE") == Some("C") {
        return Err(format!(
            "Dataset {index} is histogram-mode ($MODE C), which is unsupported — list-mode ($MODE L) only"
        ));
    }
    let Some(datatype) = lookup(pairs, "$DATATYPE") else {
        return Ok(()); // The crate reports a missing $DATATYPE itself.
    };
    if datatype == "A" {
        return Err(format!(
            "Dataset {index} uses ASCII data ($DATATYPE A), which is unsupported — integer, float and double data only"
        ));
    }
    if !matches!(datatype, "I" | "F" | "D") {
        return Err(format!(
            "Dataset {index} has unsupported $DATATYPE {datatype:?} — expected I, F or D"
        ));
    }
    let Some(par) = lookup_usize(pairs, "$PAR")? else {
        return Ok(());
    };
    for n in 1..=par {
        let Some(bits) = lookup_usize(pairs, &format!("$P{n}B"))? else {
            continue;
        };
        if bits % 8 != 0 {
            continue; // Bit-packed widths take the crate's MSB-first path.
        }
        let ok = match datatype {
            "I" => matches!(bits, 16 | 32),
            "F" => matches!(bits, 32 | 64),
            "D" => bits == 64,
            _ => false,
        };
        if !ok {
            return Err(format!(
                "Dataset {index} has unsupported data: $DATATYPE {datatype} with $P{n}B {bits} — \
                 Titer reads 16/32-bit integers, 32/64-bit floats and 64-bit doubles only"
            ));
        }
    }
    Ok(())
}

/// Parse every dataset in the `$NEXTDATA` chain (headers + TEXT only):
/// the guard and the datatype check run on each one, before anything is
/// opened. Returns the datasets in chain order.
fn inspect_chain(bytes: &[u8]) -> Result<Vec<DatasetInfo>, String> {
    let mut datasets = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();
    let mut base = 0usize;
    loop {
        if datasets.len() >= MAX_DATASETS {
            return Err(format!(
                "$NEXTDATA chain runs past {MAX_DATASETS} datasets — refusing a suspicious file"
            ));
        }
        if !seen.insert(base) {
            return Err(format!(
                "$NEXTDATA chain loops back to byte {base} — refusing a suspicious file"
            ));
        }
        let header = parse_header(bytes, base)?;
        if header.text_start == 0 || header.text_end == 0 {
            return Err(format!(
                "Dataset {} has no TEXT segment (HEADER TEXT offsets are 0)",
                datasets.len()
            ));
        }
        let (delimiter, pairs) = parse_text(bytes, base, header.text_start, header.text_end)?;
        check_offsets(&header, &pairs, datasets.len())?;
        check_datatype(&pairs, datasets.len())?;
        let nextdata = lookup_usize(&pairs, "$NEXTDATA")?.unwrap_or(0);
        let span_end = if nextdata == 0 {
            bytes.len()
        } else {
            let next_base = base.checked_add(nextdata).ok_or("$NEXTDATA offset overflow")?;
            if next_base <= base || next_base >= bytes.len() {
                return Err(format!(
                    "$NEXTDATA {nextdata} from the dataset at byte {base} points to byte {next_base}, \
                     outside the {} byte file",
                    bytes.len()
                ));
            }
            next_base
        };
        datasets.push(DatasetInfo { base, header, delimiter, pairs, nextdata, span_end });
        if nextdata == 0 {
            break;
        }
        base = span_end;
        // A chained dataset without its own HEADER falls back to bare
        // TEXT in the crate; staging cannot rewrite what it cannot parse,
        // so the chain walk stops here and the crate's fallback handles it.
        if !bytes[base..].starts_with(b"FCS") {
            break;
        }
    }
    Ok(datasets)
}

/// The normalisations one dataset's TEXT needs (conditions 5 + bare
/// `SPILL`), applied to a copy of its pairs. Returns the new pairs plus
/// a note per change.
fn normalise_pairs(pairs: &[(String, String)]) -> (Vec<(String, String)>, Vec<String>) {
    let mut out: Vec<(String, String)> = pairs.to_vec();
    let mut notes = Vec::new();
    for (k, v) in out.iter_mut() {
        if k == "$BYTEORD" && v == "1,2" {
            *v = "1,2,3,4".to_string();
            notes.push("Normalised short $BYTEORD \"1,2\" to \"1,2,3,4\" (little-endian)".to_string());
        } else if k == "$BYTEORD" && v == "2,1" {
            *v = "4,3,2,1".to_string();
            notes.push("Normalised short $BYTEORD \"2,1\" to \"4,3,2,1\" (big-endian)".to_string());
        }
    }
    let has_spill = out.iter().any(|(k, _)| k == "$SPILL" || k == "$SPILLOVER");
    if let Some(pos) = out.iter().position(|(k, _)| k == "SPILL") {
        if has_spill {
            out.remove(pos);
            notes.push("Dropped bare SPILL keyword (a $SPILL/$SPILLOVER is already present)".to_string());
        } else {
            out[pos].0 = "$SPILL".to_string();
            notes.push("Normalised bare SPILL keyword to $SPILL".to_string());
        }
    }
    (out, notes)
}

/// Offsets that point past TEXT move with it when TEXT is rebuilt; an
/// offset at or before TEXT's end, or 0, does not move. (`$NEXTDATA` is
/// relative to the dataset start and its target is always past TEXT, so
/// it always moves when non-zero.)
fn shifted(value: usize, text_end: usize, delta: isize) -> usize {
    if value == 0 || value <= text_end {
        value
    } else if delta >= 0 {
        value + delta as usize
    } else {
        value.saturating_sub((-delta) as usize)
    }
}

/// Rebuild one dataset's span with normalised TEXT: TEXT re-serialised
/// (to a fixpoint, since offset digit counts can change the length),
/// HEADER fields + offset keywords shifted by the TEXT length delta, and
/// every other byte in the span kept in place (only shifted, never
/// reordered — a dataset's DATA may precede its TEXT, as coulter's
/// second dataset does).
fn rebuild_dataset(bytes: &[u8], info: &DatasetInfo) -> Result<(Vec<u8>, Vec<String>), String> {
    let header = &info.header;
    let (pairs, mut notes) = normalise_pairs(&info.pairs);
    let old_text_len = header.text_end - header.text_start + 1;
    // Fixpoint: offset values depend on the TEXT length delta, which
    // depends on the offset values' digit counts.
    let mut text = {
        let shifted_pairs = shift_pairs(&pairs, header.text_end, 0, info.nextdata);
        serialise_text(info.delimiter, &shifted_pairs)
    };
    for _ in 0..10 {
        let delta = text.len() as isize - old_text_len as isize;
        let shifted_pairs = shift_pairs(&pairs, header.text_end, delta, info.nextdata);
        let next = serialise_text(info.delimiter, &shifted_pairs);
        if next == text {
            break;
        }
        text = next;
    }
    let delta = text.len() as isize - old_text_len as isize;
    if delta != 0 && info.nextdata != 0 {
        notes.push(format!(
            "Shifted $NEXTDATA by {delta} bytes (TEXT length changed while staging)"
        ));
    }
    // Splice the new TEXT into a copy of the span; everything before TEXT
    // stays, everything after TEXT shifts by the delta.
    let span_start = info.base;
    let span_end = info.span_end;
    let mut span = bytes[span_start..span_end].to_vec();
    let text_at = header.text_start;
    let text_to = header.text_end + 1;
    span.splice(text_at..text_to, text.iter().copied());
    // HEADER: version + 4 spaces + six 8-wide offset fields. Offsets
    // past 99,999,999 cannot be written in 8 characters — the spec's
    // answer is 0, with TEXT carrying the real value.
    let field = |value: usize| -> Result<String, String> {
        if value == 0 || value >= 100_000_000 {
            Ok("       0".to_string())
        } else {
            Ok(format!("{value:8}"))
        }
    };
    let text_end = (header.text_end as isize + delta) as usize;
    if text_end >= 100_000_000 {
        return Err("TEXT segment end does not fit the 8-character HEADER field".to_string());
    }
    let mut header_bytes = Vec::with_capacity(58);
    header_bytes.extend_from_slice(header.version.as_bytes());
    while header_bytes.len() < 6 {
        header_bytes.push(b' ');
    }
    header_bytes.extend_from_slice(b"    ");
    for value in [
        header.text_start,
        text_end,
        shifted(header.data_start, header.text_end, delta),
        shifted(header.data_end, header.text_end, delta),
        shifted(header.analysis_start, header.text_end, delta),
        shifted(header.analysis_end, header.text_end, delta),
    ] {
        header_bytes.extend_from_slice(field(value)?.as_bytes());
    }
    debug_assert_eq!(header_bytes.len(), 58);
    span[..58].copy_from_slice(&header_bytes);
    // The OTHER region runs from byte 58 to whichever segment starts
    // first (TEXT, DATA or ANALYSIS — DATA may precede TEXT): shift the
    // 8-byte numeric fields in it that point past TEXT, leave padding.
    let first_segment = [header.text_start, header.data_start, header.analysis_start]
        .into_iter()
        .filter(|&v| v != 0)
        .min()
        .unwrap_or(header.text_start);
    if first_segment > 58 {
        shift_other_offsets(&mut span[58..first_segment], header.text_end, delta)?;
    }
    Ok((span, notes))
}

/// Apply the TEXT length delta to the offset keywords of a dataset's
/// TEXT (and to its `$NEXTDATA`, which is dataset-relative).
fn shift_pairs(
    pairs: &[(String, String)],
    text_end: usize,
    delta: isize,
    nextdata: usize,
) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(k, v)| {
            let new_v = match k.as_str() {
                "$BEGINDATA" | "$ENDDATA" | "$BEGINANALYSIS" | "$ENDANALYSIS" | "$BEGINSTEXT"
                | "$ENDSTEXT" => v
                    .trim()
                    .parse::<usize>()
                    .map(|n| shifted(n, text_end, delta).to_string())
                    .unwrap_or_else(|_| v.clone()),
                "$NEXTDATA" => {
                    if nextdata == 0 {
                        v.clone()
                    } else {
                        (nextdata as isize + delta).max(0).to_string()
                    }
                }
                _ => v.clone(),
            };
            (k.clone(), new_v)
        })
        .collect()
}

/// Shift the 8-byte numeric fields in a header's OTHER region that point
/// past TEXT; blank fields stay blank, unparseable fields refuse staging
/// rather than guess.
fn shift_other_offsets(region: &mut [u8], text_end: usize, delta: isize) -> Result<(), String> {
    if delta == 0 {
        return Ok(());
    }
    if region.iter().all(|&b| b == b' ') {
        return Ok(()); // Padding, not OTHER pairs.
    }
    let mut i = 0;
    while i + 8 <= region.len() {
        let raw = &region[i..i + 8];
        let text = std::str::from_utf8(raw)
            .map_err(|_| "HEADER OTHER offsets are not ASCII — refusing to stage".to_string())?;
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let value: usize = trimmed
                .parse()
                .map_err(|_| "HEADER OTHER offset is not a number — refusing to stage".to_string())?;
            let new_value = shifted(value, text_end, delta);
            if new_value != value {
                let formatted = format!("{new_value:8}");
                region[i..i + 8].copy_from_slice(formatted.as_bytes());
            }
        }
        i += 8;
    }
    if i < region.len() && region[i..].iter().any(|&b| b != b' ') {
        return Err("HEADER OTHER region is not a whole number of 8-byte fields — refusing to stage".to_string());
    }
    Ok(())
}

/// The staged file: what to open, and what changed to get there.
struct StagedFcs {
    bytes: Vec<u8>,
    /// True when `bytes` differ from the original file.
    staged: bool,
    normalisations: Vec<String>,
    version: String,
    has_nextdata: bool,
}

/// Parse + guard + (when needed) stage a file's bytes. A clean `.fcs`
/// file comes back untouched (`staged: false`); anything needing a
/// normalisation — or a non-`.fcs` name — comes back as rebuilt bytes.
fn stage_fcs_bytes(original: &[u8], original_path: &Path) -> Result<StagedFcs, String> {
    if original.len() < 58 {
        return Err(format!(
            "Not an FCS file: only {} bytes, an FCS HEADER alone is 58",
            original.len()
        ));
    }
    let datasets = inspect_chain(original)?;
    let version = datasets[0].header.version.clone();
    let has_nextdata = datasets.iter().any(|d| d.nextdata != 0);
    let extension_is_fcs = original_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("fcs"))
        .unwrap_or(false);
    let mut normalisations: Vec<String> = Vec::new();
    let mut needs_rebuild = !extension_is_fcs;
    if !extension_is_fcs {
        normalisations.push(format!(
            "Staged under a .fcs name (the file's own extension is not .fcs, which the reader requires)"
        ));
    }
    for info in &datasets {
        if !info.header.blank_fields.is_empty() {
            needs_rebuild = true;
            for field in &info.header.blank_fields {
                normalisations.push(format!(
                    "Blank HEADER {field} offset treated as 0 (FCS §3.8 allows space-filled unused offsets)"
                ));
            }
        }
        // The rebuild records the TEXT normalisations itself; here only
        // detect whether any exist.
        if !normalise_pairs(&info.pairs).1.is_empty() {
            needs_rebuild = true;
        }
    }
    if !needs_rebuild {
        return Ok(StagedFcs {
            bytes: original.to_vec(),
            staged: false,
            normalisations,
            version,
            has_nextdata,
        });
    }
    let mut staged: Vec<u8> = Vec::with_capacity(original.len() + 64);
    for info in &datasets {
        let (span, notes) = rebuild_dataset(original, info)?;
        normalisations.extend(notes);
        staged.extend_from_slice(&span);
    }
    // Bytes past the last inspected dataset (a headerless chained
    // dataset the walk stopped at) are copied verbatim.
    let covered = datasets.last().map(|d| d.span_end).unwrap_or(0);
    if covered < original.len() {
        staged.extend_from_slice(&original[covered..]);
    }
    Ok(StagedFcs { bytes: staged, staged: true, normalisations, version, has_nextdata })
}

static STAGE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write staged bytes to a uniquely-named `.fcs` file in the temp dir.
/// The caller deletes it once the crate has finished with it.
fn write_staged_file(bytes: &[u8], stem: &str) -> Result<PathBuf, String> {
    let n = STAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join("titer-fcs-stage");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Cannot create the FCS staging dir {}: {e}", dir.display()))?;
    let path = dir.join(format!("{stem}-{pid}-{n}.fcs", pid = std::process::id()));
    std::fs::write(&path, bytes)
        .map_err(|e| format!("Cannot write the staged FCS file {}: {e}", path.display()))?;
    Ok(path)
}

/// Sanitize a file stem into a sample id: `fcs-<stem>`, non-identifier
/// characters folded to `-`.
fn default_sample_id(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sample");
    let mut id = String::from("fcs-");
    for ch in stem.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            id.push(ch);
        } else if !id.ends_with('-') {
            id.push('-');
        }
    }
    if id == "fcs-" {
        id.push_str("sample");
    }
    id
}

fn keyword<'a>(fcs: &'a Fcs, key: &str) -> Option<String> {
    fcs.get_keyword_string_value(key).ok().map(|v| v.into_owned())
}

/// Open a (possibly staged) FCS file and extract its first dataset's
/// columns plus the metadata the import summary carries.
fn read_fcs_sample(path: &str) -> Result<ReadFcsSample, String> {
    let original_path = Path::new(path);
    if !original_path.is_file() {
        return Err(format!("No file at “{path}” — check the path and ask again."));
    }
    let original = std::fs::read(original_path)
        .map_err(|e| format!("Cannot read FCS file “{path}”: {e}"))?;
    let staged = stage_fcs_bytes(&original, original_path)?;
    let open_path: PathBuf;
    let mut staged_file: Option<PathBuf> = None;
    if staged.staged {
        open_path = write_staged_file(
            &staged.bytes,
            original_path.file_stem().and_then(|s| s.to_str()).unwrap_or("sample"),
        )?;
        staged_file = Some(open_path.clone());
    } else {
        open_path = original_path.to_path_buf();
    }
    let open_str = open_path.to_str().ok_or_else(|| {
        format!("FCS file path “{}” is not valid UTF-8", open_path.display())
    })?;
    // Values the open needs from the staging, cloned out: the crate holds
    // the file mapped while the closure below runs.
    let staged_version = staged.version.clone();
    let staged_normalisations = staged.normalisations.clone();
    let staged_has_nextdata = staged.has_nextdata;
    // The crate mmaps the file; drop it before removing a staged copy.
    let read = (|| -> Result<ReadFcsSample, String> {
        let fcs = Fcs::open(open_str)
            .map_err(|e| format!("Cannot open FCS file “{path}”: {e:#}"))?;
        let par = *fcs
            .get_number_of_parameters()
            .map_err(|e| format!("Cannot read $PAR from “{path}”: {e:#}"))?;
        let tot = *fcs
            .get_number_of_events()
            .map_err(|e| format!("Cannot read $TOT from “{path}”: {e:#}"))?;
        let names = fcs.get_parameter_names_from_dataframe();
        if names.len() != par {
            return Err(format!(
                "FCS file “{path}” reports $PAR {par} but decodes {} parameter columns",
                names.len()
            ));
        }
        let mut parameters = Vec::with_capacity(par);
        let mut columns: Vec<Vec<f32>> = Vec::with_capacity(par);
        let mut warnings: Vec<String> = Vec::new();
        for (i, name) in names.iter().enumerate() {
            let n = i + 1;
            let bits = keyword(&fcs, &format!("$P{n}B"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let range = keyword(&fcs, &format!("$P{n}R"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            let stain = keyword(&fcs, &format!("$P{n}S")).filter(|s| !s.is_empty());
            parameters.push(FcsParameterMeta { name: name.clone(), bits, range, stain });
            let slice = fcs
                .get_parameter_events_slice(name)
                .map_err(|e| format!("Cannot decode parameter {name} from “{path}”: {e:#}"))?;
            if slice.len() != tot {
                warnings.push(format!(
                    "Parameter {name} decoded {} events but $TOT says {tot}",
                    slice.len()
                ));
            }
            columns.push(slice.to_vec());
        }
        let event_count = columns.first().map(|c| c.len()).unwrap_or(0);
        if event_count != tot {
            warnings.push(format!(
                "Decoded {event_count} events but $TOT says {tot} — the file's event count disagrees with its data"
            ));
        }
        let mut datasets = vec![FcsDatasetSummary { index: 0, parameters: par, events: event_count }];
        if staged_has_nextdata {
            match Fcs::open_all(open_str) {
                Ok(all) => {
                    for (i, ds) in all.iter().enumerate().skip(1) {
                        let p = ds.get_number_of_parameters().map(|v| *v).unwrap_or(0);
                        let e = ds.get_number_of_events().map(|v| *v).unwrap_or(0);
                        datasets.push(FcsDatasetSummary { index: i, parameters: p, events: e });
                    }
                }
                Err(e) => {
                    warnings.push(format!(
                        "The file chains further datasets via $NEXTDATA, but they could not be read: {e:#} — only the first dataset was imported"
                    ));
                }
            }
        }
        // Spillover is REPORTED, never applied (condition 1: no transforms,
        // and compensation is a later lane's job).
        let spillover = match fcs.get_spillover_matrix() {
            Ok(Some((matrix, channels))) => {
                let (rows, cols) = (matrix.nrows(), matrix.ncols());
                let mut values = Vec::with_capacity(rows);
                for r in 0..rows {
                    let mut row = Vec::with_capacity(cols);
                    for c in 0..cols {
                        row.push(matrix[(r, c)]);
                    }
                    values.push(row);
                }
                Some(FcsSpilloverSummary { fluorochromes: channels, rows, cols, matrix: values })
            }
            Ok(None) => None,
            Err(e) => {
                warnings.push(format!("The file's spillover matrix could not be read: {e:#}"));
                None
            }
        };
        let name = keyword(&fcs, "$FIL")
            .filter(|s| !s.is_empty())
            .or_else(|| {
                original_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "FCS sample".to_string());
        Ok(ReadFcsSample {
            version: staged_version,
            name,
            instrument: keyword(&fcs, "$CYT").filter(|s| !s.is_empty()),
            parameters,
            columns,
            event_count,
            datasets,
            spillover,
            normalisations: staged_normalisations,
            warnings,
        })
    })();
    if let Some(staged_path) = staged_file {
        let _ = std::fs::remove_file(&staged_path);
    }
    read
}

/// Import one FCS file into the event store: parse it (staging +
/// guarding as above), load its first dataset's columns, and return the
/// summary. `sample_id` / `name` override the derived defaults.
pub fn import_fcs_file(
    path: &str,
    sample_id: Option<String>,
    name: Option<String>,
    store: &FlowStore,
) -> Result<FcsImportSummary, String> {
    let sample = read_fcs_sample(path)?;
    let sample_id = sample_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_sample_id(Path::new(path)));
    let display_name = name.filter(|s| !s.trim().is_empty()).unwrap_or(sample.name.clone());
    let info = store.insert(
        &sample_id,
        Some(display_name.clone()),
        Some(path.to_string()),
        sample.parameters.iter().map(|p| p.name.clone()).collect(),
        sample.columns,
    )?;
    Ok(FcsImportSummary {
        sample_id,
        name: display_name,
        source_path: path.to_string(),
        version: sample.version,
        event_count: sample.event_count,
        parameters: sample.parameters,
        datasets: sample.datasets,
        spillover: sample.spillover,
        instrument: sample.instrument,
        normalisations: sample.normalisations,
        warnings: sample.warnings,
        store: info,
    })
}

/// Tauri command: import an FCS file into the flow event store. The
/// reader is opt-in (the flow toggle gates the MCP tool and any UI entry);
/// the command itself only runs when something calls it.
#[tauri::command]
pub fn flow_import_fcs(
    state: tauri::State<'_, FlowStore>,
    path: String,
    sample_id: Option<String>,
    name: Option<String>,
) -> Result<FcsImportSummary, String> {
    import_fcs_file(&path, sample_id, name, &state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use flow_fcs::Fcs;

    fn fixture(name: &str) -> String {
        format!(
            "{}/../tests/testdata/fcs/{}",
            env!("CARGO_MANIFEST_DIR"),
            name
        )
    }

    fn corpus(name: &str) -> Option<String> {
        // The shared public corpus lives outside the repo; try the usual
        // homes (this container's exec shells run as root, whose $HOME is
        // not the workspace owner's).
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(PathBuf::from(home));
        }
        candidates.push(PathBuf::from("/home/hatch"));
        for home in candidates {
            let path = home.join("workspace").join(".helix-flowjo").join("corpus").join(name);
            if path.is_file() {
                return Some(path.to_string_lossy().into_owned());
            }
        }
        None
    }

    #[test]
    fn flow_fcs_smoke_opens_real_fcs_file() {
        // Gating-ML compliance fixture: FCS 3.0, big-endian int16,
        // 6 params, 10 events. Expected values re-derived in Python
        // from the fixture bytes (docs/flow-fcs-evaluation.md).
        let fcs = Fcs::open(&fixture("int-10_events_6_parameters.fcs"))
            .expect("flow-fcs must open the smoke fixture");
        assert_eq!(*fcs.get_number_of_parameters().expect("$PAR"), 6);
        assert_eq!(*fcs.get_number_of_events().expect("$TOT"), 10);
        assert_eq!(
            fcs.get_parameter_names_from_dataframe(),
            vec!["AS", "BS", "CS", "DS", "ES", "FS"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        // First event, decoded big-endian int16: 10, 20, 30, 40, 50, 60.
        let first = fcs
            .get_parameter_events_slice("AS")
            .expect("AS column must decode");
        assert_eq!(first.len(), 10);
        assert_eq!(first[0], 10.0);
        let last = fcs
            .get_parameter_events_slice("FS")
            .expect("FS column must decode");
        assert_eq!(last[0], 60.0);
    }

    #[test]
    fn flow_fcs_smoke_minimal_file_and_spillover_fixture() {
        let tiny = Fcs::open(&fixture("int-gating_test_file.fcs"))
            .expect("flow-fcs must open the 1-event fixture");
        assert_eq!(*tiny.get_number_of_parameters().expect("$PAR"), 2);
        assert_eq!(*tiny.get_number_of_events().expect("$TOT"), 1);
        assert_eq!(
            tiny.get_parameter_names_from_dataframe(),
            vec!["FS", "SS"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        let fs = tiny
            .get_parameter_events_slice("FS")
            .expect("FS column must decode");
        assert_eq!(fs, &[100.0]);

        // Hand-built FCS 3.1 fixture: float32 LE, 3 params, 4 events,
        // $SPILLOVER 3x3. Pins the compensation entry point too.
        let spill = Fcs::open(&fixture("synth-spill.fcs"))
            .expect("flow-fcs must open the spillover fixture");
        assert_eq!(*spill.get_number_of_parameters().expect("$PAR"), 3);
        assert_eq!(*spill.get_number_of_events().expect("$TOT"), 4);
        let (matrix, channels) = spill
            .get_spillover_matrix()
            .expect("spillover must parse")
            .expect("spillover must be present");
        assert_eq!((matrix.nrows(), matrix.ncols()), (3, 3));
        assert_eq!(
            channels,
            vec!["FL1-A", "FL2-A", "FL3-A"]
                .into_iter()
                .map(str::to_string)
                .collect::<Vec<_>>()
        );
        let compensated = spill
            .apply_file_compensation()
            .expect("file compensation must apply");
        assert_eq!((compensated.height(), compensated.width()), (4, 3));
    }

    // ── F1c (seq 443): the reader, end to end ───────────────────────────

    #[test]
    fn f1c_real_file_loads_into_the_store() {
        let store = FlowStore::with_budget(1024 * 1024);
        let summary = import_fcs_file(&fixture("int-10_events_6_parameters.fcs"), None, None, &store)
            .expect("the smoke fixture must import");
        assert_eq!(summary.event_count, 10);
        assert_eq!(summary.version, "FCS3.0");
        assert_eq!(
            summary.parameters.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(),
            vec!["AS", "BS", "CS", "DS", "ES", "FS"]
        );
        assert_eq!(summary.parameters[0].bits, 16);
        assert_eq!(summary.datasets.len(), 1);
        assert!(summary.spillover.is_none(), "no spillover in this fixture");
        assert_eq!(summary.store.event_count, 10);
        assert_eq!(summary.store.parameter_count, 6);
        assert_eq!(summary.store.bytes, 10 * 6 * 4);
        assert_eq!(summary.sample_id, "fcs-int-10_events_6_parameters");
        // The decoded columns match the independent Python decode of the
        // same fixture bytes (first event 10, 20, 30, 40, 50, 60; DATA is
        // interleaved per event, so the AS column strides by 6).
        let sample = read_fcs_sample(&fixture("int-10_events_6_parameters.fcs"))
            .expect("the smoke fixture must read");
        assert_eq!(
            sample.columns[0],
            vec![10.0, 70.0, 130.0, 190.0, 250.0, 310.0, 370.0, 430.0, 490.0, 550.0]
        );
        assert_eq!(sample.columns[5][0], 60.0);
    }

    #[test]
    fn f1c_offset_discrepancy_is_refused_not_misread() {
        // Condition 6: HEADER DATA start 5555 vs TEXT $BEGINDATA 6081.
        // The crate alone opens this file and returns garbage (first event
        // 12332 instead of 49135); the reader must refuse it outright.
        let err = read_fcs_sample(&fixture("f1c-offset-discrepancy.fcs"))
            .expect_err("the offset-discrepancy fixture must be refused");
        assert!(err.contains("disagrees"), "refusal must name the disagreement: {err}");
        assert!(err.contains("5555") && err.contains("6081"), "refusal must name both offsets: {err}");
    }

    #[test]
    fn f1c_short_byteord_is_normalised() {
        // Condition 5: $BYTEORD "2,1" (short big-endian form) opens and
        // decodes exactly like the full "4,3,2,1" original.
        let sample = read_fcs_sample(&fixture("f1c-short-byteord.fcs"))
            .expect("short $BYTEORD must be normalised, not rejected");
        assert_eq!(sample.event_count, 10);
        assert_eq!(sample.columns[0][0], 10.0);
        assert_eq!(sample.columns[5][0], 60.0);
        assert!(
            sample.normalisations.iter().any(|n| n.contains("$BYTEORD")),
            "the normalisation must be recorded: {:?}",
            sample.normalisations
        );
    }

    #[test]
    fn f1c_blank_analysis_offsets_are_normalised() {
        // Blank (space-filled) HEADER ANALYSIS offsets: FCS §3.8 allows
        // them; the crate's header parser fails on them.
        let sample = read_fcs_sample(&fixture("f1c-blank-analysis.fcs"))
            .expect("blank ANALYSIS offsets must be treated as 0");
        assert_eq!(sample.event_count, 10);
        assert_eq!(sample.columns[0][0], 10.0);
        assert!(
            sample.normalisations.iter().any(|n| n.contains("ANALYSIS")),
            "the normalisation must be recorded: {:?}",
            sample.normalisations
        );
    }

    #[test]
    fn f1c_bare_spill_is_normalised_to_spill() {
        // A bare legacy SPILL keyword (no `$`) must be found as spillover.
        let sample = read_fcs_sample(&fixture("f1c-bare-spill.fcs"))
            .expect("bare SPILL must be normalised to $SPILL");
        let spill = sample.spillover.expect("spillover must be reported");
        assert_eq!((spill.rows, spill.cols), (3, 3));
        assert_eq!(spill.fluorochromes, vec!["FL1-A", "FL2-A", "FL3-A"]);
        assert_eq!(spill.matrix[0][0], 1.0);
        assert_eq!(spill.matrix[0][1], 0.05);
        assert!(
            sample.normalisations.iter().any(|n| n.contains("SPILL")),
            "the normalisation must be recorded: {:?}",
            sample.normalisations
        );
    }

    #[test]
    fn f1c_comp_spelling_is_found() {
        // The $COMP spelling (no public file found; synthetic fixture).
        let sample = read_fcs_sample(&fixture("f1c-comp.fcs")).expect("$COMP file must open");
        let spill = sample.spillover.expect("$COMP spillover must be reported");
        assert_eq!((spill.rows, spill.cols), (3, 3));
        assert_eq!(spill.matrix[0][1], 0.05);
    }

    #[test]
    fn f1c_fcs32_version_opens() {
        // No real public FCS 3.2 file was found; this synthetic file pins
        // the 3.2 version string + decode path.
        let sample =
            read_fcs_sample(&fixture("f1c-f32-3.2.fcs")).expect("FCS 3.2 file must open");
        assert_eq!(sample.version, "FCS3.2");
        assert_eq!(sample.event_count, 4);
        assert_eq!(sample.columns[0], vec![10.0, 20.0, 30.0, 40.0]);
        assert_eq!(sample.columns[1], vec![20.0, 40.0, 60.0, 80.0]);
    }

    #[test]
    fn f1c_multi_dataset_reports_two_datasets() {
        // $NEXTDATA chain: ds1 (3 params, 4 events) + ds2 (2 params, 3
        // events). The import loads the first dataset; both are reported.
        let sample = read_fcs_sample(&fixture("f1c-multi-dataset.fcs"))
            .expect("multi-dataset file must open");
        assert_eq!(sample.event_count, 4);
        assert_eq!(sample.columns[0], vec![100.0, 200.0, 300.0, 400.0]);
        assert_eq!(sample.datasets.len(), 2);
        assert_eq!(sample.datasets[0], FcsDatasetSummary { index: 0, parameters: 3, events: 4 });
        assert_eq!(sample.datasets[1], FcsDatasetSummary { index: 1, parameters: 2, events: 3 });
    }

    #[test]
    fn f1c_unsupported_types_are_refused_clearly() {
        // Condition 3: 24-bit int and ASCII data get a clear "unsupported"
        // error naming the keyword — never a crash, never a misread.
        let err24 = read_fcs_sample(&fixture("f1c-i24.fcs"))
            .expect_err("24-bit int data must be refused");
        assert!(err24.contains("unsupported"), "24-bit refusal must say unsupported: {err24}");
        assert!(err24.contains("$P1B") || err24.contains("$PnB"), "24-bit refusal must name $PnB: {err24}");
        let err_ascii = read_fcs_sample(&fixture("f1c-ascii.fcs"))
            .expect_err("ASCII data must be refused");
        assert!(err_ascii.contains("unsupported"), "ASCII refusal must say unsupported: {err_ascii}");
        assert!(err_ascii.contains("$DATATYPE"), "ASCII refusal must name $DATATYPE: {err_ascii}");
    }

    #[test]
    fn f1c_non_fcs_extension_is_staged() {
        // Condition 2: the crate's `.fcs` extension gate — a real FCS
        // file under a `.LMD` name must still open, via staging.
        let dir = std::env::temp_dir().join(format!(
            "titer-f1c-ext-{}-{}",
            std::process::id(),
            STAGE_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("stage dir");
        let staged = dir.join("sample.LMD");
        std::fs::copy(fixture("int-10_events_6_parameters.fcs"), &staged).expect("copy fixture");
        let sample = read_fcs_sample(staged.to_str().unwrap()).expect(".LMD file must open via staging");
        assert_eq!(sample.event_count, 10);
        assert_eq!(sample.columns[0][0], 10.0);
        assert!(
            sample.normalisations.iter().any(|n| n.contains(".fcs")),
            "the staging must be recorded: {:?}",
            sample.normalisations
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn f1c_missing_file_is_a_clear_error() {
        let err = read_fcs_sample("/tmp/titer-f1c-no-such-file.fcs")
            .expect_err("a missing file must fail");
        assert!(err.contains("No file at"), "missing file must say so: {err}");
    }

    /// Spot-check against the shared public corpus (not committed): runs
    /// only when the corpus is present, so CI stays green without it.
    /// Values below are independent Python/flowio decodes of the same
    /// files — not copies of the crate's output.
    #[test]
    fn f1c_corpus_spot_check() {
        let Some(coulter) = corpus("coulter.lmd") else {
            return;
        };
        // Multi-dataset + short $BYTEORD + blank ANALYSIS offsets, all in
        // one real file: ds1 (FCS 2.0, 8 params, 18110 events) + ds2
        // (FCS 3.0, 8 params, 18110 events).
        let sample = read_fcs_sample(&coulter).expect("coulter.lmd must open after staging");
        assert_eq!(sample.event_count, 18110);
        assert_eq!(sample.datasets.len(), 2, "open_all must find both datasets");
        assert_eq!(sample.columns[0][0], 59.0, "ds1 FS Lin[0] (flowio: 59)");
        assert_eq!(sample.columns[1][0], 128.0);
        assert_eq!(sample.columns[7][0], 510.0);
        assert!(
            sample.normalisations.iter().any(|n| n.contains("$BYTEORD")),
            "coulter needs the $BYTEORD normalisation: {:?}",
            sample.normalisations
        );
        // The second dataset's first event, independently decoded by
        // flowio (with the $PnR range mask applied): the raw I32 values
        // are garbage without it.
        let all_path = {
            let staged = stage_fcs_bytes(&std::fs::read(&coulter).unwrap(), Path::new(&coulter))
                .expect("coulter stages");
            write_staged_file(&staged.bytes, "coulter").expect("write staged coulter")
        };
        let all = Fcs::open_all(all_path.to_str().unwrap()).expect("coulter open_all");
        assert_eq!(all.len(), 2);
        let ds2_fs = all[1]
            .get_parameter_events_slice("FS")
            .expect("ds2 FS column must decode");
        assert_eq!(ds2_fs[0], 61056.0, "ds2 FS[0] (flowio: 61056)");
        assert_eq!(ds2_fs[1], 257280.0, "ds2 FS[1] (flowio: 257280)");
        let _ = std::fs::remove_file(&all_path);

        // The other new corpus file: BD Accuri, FCS 3.1, BE I32, $SPILLOVER 8x8.
        let b01 = corpus("B01 KC-A-W---91-US.fcs").expect("B01 in corpus");
        let b01_sample = read_fcs_sample(&b01).expect("B01 must open");
        assert_eq!(b01_sample.event_count, 1589);
        assert_eq!(b01_sample.parameters.len(), 14);
        assert_eq!(b01_sample.columns[0][0], 7955.0, "B01 FSC-A[0] (flowio: 7955)");
        assert_eq!(b01_sample.columns[1][0], 27513.0, "B01 SSC-A[0] (flowio: 27513)");
        let b01_spill = b01_sample.spillover.expect("B01 carries $SPILLOVER");
        assert_eq!((b01_spill.rows, b01_spill.cols), (8, 8));

        // The stop-offset discrepancy file is refused like the start one.
        let stop = corpus("data_stop_offset_discrepancy_example.fcs").expect("stop file in corpus");
        let err = read_fcs_sample(&stop).expect_err("stop-offset discrepancy must be refused");
        assert!(err.contains("disagrees"), "stop refusal must name the disagreement: {err}");
    }
}
