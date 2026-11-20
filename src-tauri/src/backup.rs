// Automatic backup (Plane seq 226, 1.8.0): Prism's automatic backup, not
// 1.7.3's autosave. Autosave saves the project IN PLACE, only for projects
// that already have a file or cloud target, never for untitled work. Backup
// keeps a SEPARATE copy — one `.hlx` snapshot per project, in Titer's data
// folder — so a crash (or a power cut, or closing without saving) leaves
// something to come back to. Prism's rules, from GraphPad FAQ 1520 and the
// Prism 11 user guide ("Automatic back up of Prism files"):
//   - written on a timer and/or when the sheet changes, and whenever the
//     project is saved, so a backup is never older than the project file;
//   - deleted when the project is saved and closed normally;
//   - on a crash the backup remains, and the next launch offers to restore
//     it; backups are kept 4 days if the original was unsaved.
// The frontend owns the triggers (timer, sheet switch, save, close) and the
// settings; this module owns the store: keys, atomic writes, the metadata
// sidecar, pruning, and the read back. One backup per project — a newer
// snapshot overwrites the old one, like Prism's one `.PZB` per file. The
// snapshot is always `.hlx`, Titer's own format, even for a project opened
// from `.prism` / `.pzfx`: the backup is Titer-internal, like `.PZB` is
// Prism-internal, and it loads back through the normal project reader.
// A backup never interrupts work: every failure here is an `Err` the
// frontend swallows silently (no prompt, no alert).
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// The backups live in Titer's data folder, beside `open-projects` and the
/// cloud cache — never next to the project file, so a backup can never be
/// mistaken for the file itself.
pub const BACKUP_DIR_NAME: &str = "backups";

/// Prism 10+: a backup is kept 4 days if the original file was unsaved.
pub const BACKUP_RETENTION_DAYS: u64 = 4;
const BACKUP_RETENTION_MS: u64 = BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/// A backup key is 16 lowercase hex chars of the identity's FNV-1a hash —
/// short, filesystem-safe, and never derived from user text, so no project
/// name (or path traversal) can ever reach the disk.
const BACKUP_KEY_LEN: usize = 16;

/// One backup, as the frontend and the MCP `titer_list_backups` tool see it.
/// `saved_at_ms` is when the snapshot was written; `source_mtime_ms` is
/// when the project file itself was last written (null for untitled and
/// cloud projects, which have no file on this disk) — the restore offer
/// only fires when the backup is newer than the file.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct BackupEntry {
    pub key: String,
    pub display_name: String,
    pub source_path: Option<String>,
    pub saved_at_ms: u64,
    pub source_mtime_ms: Option<u64>,
    pub size_bytes: u64,
}

/// What the `<key>.json` sidecar holds: enough to list and offer the backup
/// without opening the snapshot. The snapshot's bytes are the project; this
/// is only the label for it.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct BackupMeta {
    display_name: String,
    source_path: Option<String>,
    saved_at_ms: u64,
}

/// FNV-1a, 64-bit: deterministic across runs (unlike `DefaultHasher`), so
/// the same project identity always maps to the same backup file.
pub fn backup_key(identity: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in identity.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

/// Only keys this module could have produced are ever read or deleted — a
/// key with a separator or `..` in it is refused, never joined to the dir.
pub fn is_valid_key(key: &str) -> bool {
    key.len() == BACKUP_KEY_LEN && key.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// True when a backup written at `saved_at_ms` is past Prism's 4-day keep.
/// A timestamp in the future (a clock that moved) is never stale.
pub fn is_stale(saved_at_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(saved_at_ms) > BACKUP_RETENTION_MS
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn backups_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(BACKUP_DIR_NAME)
}

fn snapshot_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.hlx"))
}

fn meta_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("{key}.json"))
}

/// The file's last-write time in milliseconds, or null when it isn't a
/// readable local file (a cloud path, or a file that moved since).
fn source_mtime_ms(source_path: Option<&str>) -> Option<u64> {
    let path = source_path?;
    let mtime = fs::metadata(path).ok()?.modified().ok()?;
    mtime.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

fn read_meta(dir: &Path, key: &str) -> Option<BackupMeta> {
    let text = fs::read_to_string(meta_path(dir, key)).ok()?;
    serde_json::from_str(&text).ok()
}

fn entry_from_meta(dir: &Path, key: &str, meta: &BackupMeta) -> BackupEntry {
    BackupEntry {
        key: key.to_string(),
        display_name: meta.display_name.clone(),
        source_path: meta.source_path.clone(),
        saved_at_ms: meta.saved_at_ms,
        source_mtime_ms: source_mtime_ms(meta.source_path.as_deref()),
        size_bytes: fs::metadata(snapshot_path(dir, key)).map(|m| m.len()).unwrap_or(0),
    }
}

/// Drops what can no longer be offered: snapshots older than 4 days (with
/// their sidecars), and snapshot files with no sidecar — a crash between
/// the snapshot write and the sidecar write leaves an incomplete pair, and
/// the next backup cycle rewrites it whole.
fn prune_backups(dir: &Path, now: u64) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(stem) = name.strip_suffix(".json") else {
            // A snapshot with no sidecar is an incomplete write: drop it.
            if name.ends_with(".hlx") {
                let _ = fs::remove_file(entry.path());
            }
            continue;
        };
        if !is_valid_key(stem) {
            continue;
        }
        let stale = read_meta(dir, stem).map(|m| is_stale(m.saved_at_ms, now)).unwrap_or(true);
        if stale {
            let _ = fs::remove_file(snapshot_path(dir, stem));
            let _ = fs::remove_file(meta_path(dir, stem));
        }
    }
}

/// Writes (or overwrites) the project's backup: the snapshot first, then
/// its sidecar, both atomic, so a crash mid-write leaves either the old
/// pair or the new pair, never half of one. Also prunes stale backups.
pub fn write_backup(
    data_dir: &Path,
    identity: &str,
    display_name: &str,
    source_path: Option<&str>,
    bytes: &[u8],
) -> Result<BackupEntry, String> {
    let _ = (data_dir, identity, display_name, source_path, bytes);
    Err("not implemented".to_string())
}

/// The backups on disk, newest first. Prunes stale and incomplete entries
/// first, so the list never offers a backup that is already gone.
pub fn list_backups(data_dir: &Path) -> Result<Vec<BackupEntry>, String> {
    let _ = data_dir;
    Err("not implemented".to_string())
}

/// The backup for one project identity, if it has one and it is still
/// within the 4-day keep. A stale backup is deleted and reports as none —
/// the frontend offers only what this returns.
pub fn backup_status(data_dir: &Path, identity: &str) -> Result<Option<BackupEntry>, String> {
    let _ = (data_dir, identity);
    Err("not implemented".to_string())
}

/// One backup's snapshot bytes, for restoring. Only keys this module could
/// have produced are accepted (see `is_valid_key`).
pub fn read_backup(data_dir: &Path, key: &str) -> Result<Vec<u8>, String> {
    let _ = (data_dir, key);
    Err("not implemented".to_string())
}

/// Deletes a project's backup (both files). Missing is fine — closing a
/// project that never backed up deletes nothing.
pub fn delete_backup(data_dir: &Path, key: &str) -> Result<(), String> {
    let _ = (data_dir, key);
    Err("not implemented".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A scratch data dir per test: the tests never touch the real one.
    fn scratch_dir() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("titer-backup-test-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn key_is_deterministic_distinct_and_filesystem_safe() {
        let a = backup_key("file:/Research/Dose Response.hlx");
        let b = backup_key("file:/Research/Dose Response.hlx");
        let c = backup_key("file:/Research/Other.hlx");
        assert_eq!(a, b, "the same identity must map to the same key");
        assert_ne!(a, c, "different identities must map to different keys");
        assert_eq!(a.len(), 16, "a key is 16 hex chars");
        assert!(a.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "a key is lowercase hex only");
        assert!(!a.contains('/') && !a.contains('\\') && !a.contains('.'), "a key holds no separator");
        assert!(is_valid_key(&a), "a produced key must validate");
    }

    #[test]
    fn key_validation_refuses_traversal_and_junk() {
        assert!(!is_valid_key(""), "an empty key is not valid");
        assert!(!is_valid_key("../etc/passwd"), "a traversal is not a key");
        assert!(!is_valid_key("a1b2c3d4e5f6g7h8"), "a non-hex char is not a key");
        assert!(!is_valid_key("A1B2C3D4E5F60718"), "uppercase hex is not a produced key");
        assert!(!is_valid_key("a1b2c3d4e5f6071"), "a short key is not valid");
        assert!(!is_valid_key("a1b2c3d4e5f6071899"), "a long key is not valid");
    }

    #[test]
    fn stale_means_older_than_four_days() {
        let now = 1_800_000_000_000u64;
        let four_days = 4 * 24 * 60 * 60 * 1000;
        assert!(!is_stale(now, now), "a backup written now is not stale");
        assert!(!is_stale(now - four_days, now), "a backup exactly 4 days old is not stale yet");
        assert!(is_stale(now - four_days - 1, now), "a backup a millisecond past 4 days is stale");
        assert!(!is_stale(now + 60_000, now), "a backup from the future is not stale");
    }

    #[test]
    fn write_list_read_delete_round_trips() {
        let data = scratch_dir();
        let dir = backups_dir(&data);
        let bytes = b"{\"project\": true}";
        let entry = write_backup(&data, "file:/Research/Dose.hlx", "Dose.hlx", Some("/Research/Dose.hlx"), bytes)
            .expect("write");
        assert_eq!(entry.display_name, "Dose.hlx");
        assert_eq!(entry.source_path.as_deref(), Some("/Research/Dose.hlx"));
        assert_eq!(entry.size_bytes, bytes.len() as u64);
        assert!(snapshot_path(&dir, &entry.key).exists(), "the snapshot should be on disk");
        assert!(meta_path(&dir, &entry.key).exists(), "the sidecar should be on disk");
        // A second write overwrites the same key: still one backup.
        let entry2 = write_backup(&data, "file:/Research/Dose.hlx", "Dose.hlx", Some("/Research/Dose.hlx"), b"v2")
            .expect("rewrite");
        assert_eq!(entry2.key, entry.key, "rewriting the same project keeps its key");
        let list = list_backups(&data).expect("list");
        assert_eq!(list.len(), 1, "one project should hold one backup");
        assert_eq!(list[0].key, entry.key, "the list should hold the written backup");
        assert_eq!(read_backup(&data, &entry.key).expect("read"), b"v2", "the read should return the newest snapshot");
        // Status finds it; delete removes it; status then reports none.
        assert!(backup_status(&data, "file:/Research/Dose.hlx").expect("status").is_some(), "status should find it");
        delete_backup(&data, &entry.key).expect("delete");
        assert!(!snapshot_path(&dir, &entry.key).exists(), "delete should remove the snapshot");
        assert!(!meta_path(&dir, &entry.key).exists(), "delete should remove the sidecar");
        assert!(backup_status(&data, "file:/Research/Dose.hlx").expect("status").is_none(), "status should report none after delete");
        assert!(list_backups(&data).expect("list").is_empty(), "the list should be empty after delete");
        // Deleting again is fine — closing a project that never backed up
        // deletes nothing.
        delete_backup(&data, &entry.key).expect("re-delete");
        cleanup(&data);
    }

    #[test]
    fn read_and_delete_refuse_bad_keys() {
        let data = scratch_dir();
        assert!(read_backup(&data, "../etc/passwd").is_err(), "a traversal read must fail");
        assert!(delete_backup(&data, "").is_err(), "an empty delete must fail");
        assert!(read_backup(&data, "a1b2c3d4e5f60718").is_err(), "a well-formed but missing key must fail to read");
        cleanup(&data);
    }

    #[test]
    fn stale_backups_and_orphans_are_pruned_on_list() {
        let data = scratch_dir();
        let dir = backups_dir(&data);
        fs::create_dir_all(&dir).expect("backups dir");
        // A stale backup: a sidecar whose saved time is 5 days back.
        let stale_key = backup_key("file:/Old.hlx");
        let stale_meta = BackupMeta {
            display_name: "Old.hlx".to_string(),
            source_path: Some("/Old.hlx".to_string()),
            saved_at_ms: now_ms().saturating_sub(5 * 24 * 60 * 60 * 1000),
        };
        fs::write(snapshot_path(&dir, &stale_key), b"old").expect("stale snapshot");
        fs::write(meta_path(&dir, &stale_key), serde_json::to_string(&stale_meta).expect("stale meta"))
            .expect("stale sidecar");
        // An orphan snapshot with no sidecar: a crash mid-write.
        let orphan_key = backup_key("file:/Orphan.hlx");
        fs::write(snapshot_path(&dir, &orphan_key), b"orphan").expect("orphan snapshot");
        // A fresh backup, written through the real path, survives.
        write_backup(&data, "file:/Fresh.hlx", "Fresh.hlx", None, b"fresh").expect("fresh write");
        let list = list_backups(&data).expect("list");
        assert_eq!(list.len(), 1, "only the fresh backup should survive the prune");
        assert_eq!(list[0].display_name, "Fresh.hlx");
        assert!(!snapshot_path(&dir, &stale_key).exists(), "the stale snapshot should be pruned");
        assert!(!meta_path(&dir, &stale_key).exists(), "the stale sidecar should be pruned");
        assert!(!snapshot_path(&dir, &orphan_key).exists(), "the orphan snapshot should be pruned");
        cleanup(&data);
    }

    #[test]
    fn status_reports_none_for_an_unknown_project() {
        let data = scratch_dir();
        assert!(backup_status(&data, "file:/Never.hlx").expect("status").is_none(), "an unknown project has no backup");
        assert!(list_backups(&data).expect("list").is_empty(), "an empty store lists nothing");
        cleanup(&data);
    }
}
