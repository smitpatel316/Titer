//! Build script for the Titer app crate.
//!
//! Before Tauri's own build step, stage the `titer-stdio-bridge` sidecar
//! binary into `src-tauri/binaries/` — the file `tauri.conf.json`
//! declares under `bundle.externalBin` (`binaries/titer-stdio-bridge`).
//!
//! Why this lives here (v1.6.0 P1): a pristine checkout has no
//! `src-tauri/binaries/` (gitignored, never committed), and Tauri's build
//! script FAILS any app-crate compile (`cargo check` / `cargo test` /
//! `tauri build`) when the staged binary is missing. Staging used to be a
//! manual step (`scripts/build-stdio-bridge.sh`) that only the release
//! scripts ran. The build script is the one hook every entry point goes
//! through, so staging here makes a bare `cargo check` work with no manual
//! step. See `docs/stdio-bridge.md` §5 note 7.
//!
//! Staleness / safety rules:
//! - The staged binary is rebuilt from current bridge source whenever any
//!   file under `mcp-bridge/` is newer than it, so a stale bridge can
//!   never silently ship (the Nov 14 stale bridge got HTTP 400 from the
//!   in-app MCP server: missing `MCP-Protocol-Version` / `Accept`
//!   headers). If the rebuild fails, this script panics and the app build
//!   fails hard — nothing ships.
//! - If the staged binary is already newer than every bridge source, the
//!   nested build is skipped entirely. The release scripts
//!   (`scripts/build-mac-dmg.sh`, `scripts/build-linux-appimage.sh`,
//!   `package.json` `build` / `build:linux`) stage the bridge first, so
//!   they hit this fast path — no double build, and their own fail-hard
//!   guards stay the authority for release builds.
//! - The bridge crate is deliberately NOT a workspace member and builds
//!   into its own target dir (`mcp-bridge/target/`), so the nested
//!   `cargo build` never contends with the parent build's lock.
//! - `TITER_SKIP_BRIDGE_STAGE=1` opts out (exotic flows that stage by
//!   hand). Nothing in the repo sets it.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

fn main() {
    stage_stdio_bridge();
    tauri_build::build();
}

/// Build the bridge crate (if stale) and stage it where Tauri expects it:
/// `src-tauri/binaries/titer-stdio-bridge-<target-triple>[.exe]`.
fn stage_stdio_bridge() {
    if env::var("TITER_SKIP_BRIDGE_STAGE").map(|v| v == "1").unwrap_or(false) {
        println!("cargo:warning=TITER_SKIP_BRIDGE_STAGE=1: skipping stdio-bridge staging");
        return;
    }

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target = env::var("TARGET").expect("TARGET");
    let exe_suffix = if target.contains("windows") { ".exe" } else { "" };
    let bridge_dir = manifest_dir.join("mcp-bridge");
    let staged = manifest_dir.join("binaries").join(format!("titer-stdio-bridge-{target}{exe_suffix}"));

    // Re-run this script when bridge sources change (so a bridge edit
    // re-stages on the next build) or when the staged binary itself is
    // created/deleted (so deleting it re-stages instead of failing later
    // in Tauri's build step with a stale fingerprint).
    println!("cargo:rerun-if-changed={}", bridge_dir.join("Cargo.toml").display());
    println!("cargo:rerun-if-changed={}", bridge_dir.join("Cargo.lock").display());
    println!("cargo:rerun-if-changed={}", bridge_dir.join("src").display());
    println!("cargo:rerun-if-changed={}", staged.display());

    if !bridge_dir.is_dir() {
        panic!(
            "titer-stdio-bridge source missing: {} not found (expected the standalone crate at src-tauri/mcp-bridge/)",
            bridge_dir.display()
        );
    }

    if staged_is_fresh(&bridge_dir, &staged) {
        return;
    }

    // Freshness is decided above; cargo's own fingerprinting makes this a
    // no-op rebuild when nothing changed, and a real rebuild otherwise.
    // CARGO_TARGET_DIR is stripped so the output lands in the bridge
    // crate's own target dir regardless of the caller's setting.
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let status = Command::new(&cargo)
        .arg("build")
        .arg("--release")
        .arg("--manifest-path")
        .arg(bridge_dir.join("Cargo.toml"))
        .arg("--target")
        .arg(&target)
        .env_remove("CARGO_TARGET_DIR")
        .status()
        .unwrap_or_else(|e| {
            panic!("failed to run `{cargo} build` for titer-stdio-bridge: {e}");
        });
    if !status.success() {
        panic!(
            "titer-stdio-bridge build failed ({status}) — refusing to compile the app with a missing/stale sidecar; see docs/stdio-bridge.md §5"
        );
    }

    let built = bridge_dir.join("target").join(&target).join("release").join(format!("titer-stdio-bridge{exe_suffix}"));
    if !built.is_file() {
        panic!("titer-stdio-bridge build reported success but {} is missing", built.display());
    }
    if let Some(parent) = staged.parent() {
        fs::create_dir_all(parent).unwrap_or_else(|e| {
            panic!("cannot create {}: {e}", parent.display());
        });
    }
    fs::copy(&built, &staged).unwrap_or_else(|e| {
        panic!("cannot stage {} -> {}: {e}", built.display(), staged.display());
    });
}

/// True when the staged binary exists and is at least as new as every
/// bridge source file (crate manifest, lockfile, and all of `src/`).
fn staged_is_fresh(bridge_dir: &Path, staged: &Path) -> bool {
    let staged_mtime = match fs::metadata(staged).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return false,
    };
    let newest_source = newest_mtime(&bridge_dir.join("Cargo.toml"))
        .max(newest_mtime(&bridge_dir.join("Cargo.lock")))
        .max(newest_mtime(&bridge_dir.join("src")));
    match newest_source {
        Some(t) => staged_mtime >= t,
        // No source files found (empty src/?) — treat as not fresh so the
        // build runs and fails loudly instead of shipping nothing.
        None => false,
    }
}

/// Newest modification time of a file, or of any file under a directory
/// (recursive). `None` when the path does not exist / is unreadable.
fn newest_mtime(path: &Path) -> Option<SystemTime> {
    let meta = fs::metadata(path).ok()?;
    if meta.is_file() {
        return meta.modified().ok();
    }
    if !meta.is_dir() {
        return None;
    }
    let mut newest = meta.modified().ok();
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let m = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if m.is_dir() {
                stack.push(p);
            } else if m.is_file() {
                if let Ok(t) = m.modified() {
                    newest = Some(match newest {
                        Some(n) => n.max(t),
                        None => t,
                    });
                }
            }
        }
    }
    newest
}
