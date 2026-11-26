//! In-app auto-update: download + verify + apply + relaunch (v2, item 77).
//!
//! The check itself lives in the frontend (`src/updates.ts`, `src/lib/channel.ts`);
//! this module owns what a web page cannot do: fetch the asset, check it,
//! swap the app bundle in, and relaunch. No new crates, so `Cargo.lock` is
//! untouched: downloads go through `curl`, hashes through the system's
//! `shasum`/`sha256sum`, unzipping through `ditto` (macOS).
//!
//! The apply path is macOS-only: the release artifact is a ditto zip of
//! `Titer.app` (`Titer-<version>.zip`, published next to the DMG), and the
//! bundle swap is a rename the running app cannot do to itself. Linux has
//! no shipped artifact yet, so its updater stops at the manual download.
//!
//! The 1.0.4 guard (UPDATE-LOOP-105.md): the staged bundle's own version
//! stamp must say the version the manifest promised, or nothing is swapped.
//! A payload whose stamp still says the old version would make the updater
//! re-offer the same update forever — so a mismatch refuses the swap before
//! anything is moved, and the second launch after a good swap is quiet.
//!
//! Trust model (Round 2 Issue 46): the artifact is resolved strictly
//! inside Rust from `CHANNEL_MANIFEST_URL` — `download_update` takes no
//! URL, hash, or size from the page, and `apply_update` re-hashes the
//! staged zip against the manifest before anything is swapped. The page
//! can never point the updater at an arbitrary host or a hash of its own
//! choosing. Both commands are `async` via `spawn_blocking`, so curl's
//! `--max-time 900` and the `ditto` extraction never park macOS's main
//! thread. No codesign check: releases are unsigned (no Apple Developer
//! Program — DMGs stay unsigned), so `codesign --verify` would reject
//! every legitimate update; the manifest hash is the verification that
//! applies here.

use std::path::PathBuf;
use std::path::Path;
use std::process::Command;

/// Runs a command, returning its stdout on success, or the command's
/// stderr on failure.
fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("couldn't run {cmd}: {e}"))?;
    if !output.status.success() {
        return Err(format!("{cmd} failed: {}", String::from_utf8_lossy(&output.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// A fresh temp dir per purpose. The version is sanitised: it comes from
/// the channel manifest, and a `..` in it must never escape the temp dir.
fn staging_dir(purpose: &str) -> PathBuf {
    let safe: String = purpose
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect();
    std::env::temp_dir().join(format!("titer-update-{safe}"))
}

/// A path, quoted for a double-quoted shell string. macOS only: the
/// Linux `apply_update` is a stub, so nothing there quotes a path.
#[cfg(target_os = "macos")]
fn sh_quote(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let mut out = String::with_capacity(raw.len() + 2);
    out.push('"');
    for c in raw.chars() {
        if matches!(c, '\\' | '"' | '$' | '`') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

/// The update channel's manifest: the one URL the shell fetches for the
/// page. Fixed, not a free choice: the shell must never become a fetch
/// proxy for arbitrary hosts (localhost services included) — the page can
/// only ever ask for this address, and anything else is refused before
/// curl runs.
const CHANNEL_MANIFEST_URL: &str = "https://titer.smitpatel.net/channel/version.json";

/// Fetches the channel manifest through the shell's curl, not the
/// webview's fetch: the webview enforces CORS, and the channel host sends
/// no Access-Control-Allow-Origin, so the in-page fetch failed fast while
/// curl answered 200 — the P0 that sent every Check for Updates to GitHub
/// (Nov 19 2026). Same approach as `download_update`: curl -fsSL with a
/// timeout, so a hung network fails instead of hanging. Returns the body
/// text; the page parses it as JSON. Async, like `read_text` (seq 248):
/// a sync command runs on macOS's main thread, and a hung fetch would
/// park it — the curl runs on a blocking-pool thread instead.
#[tauri::command]
pub async fn fetch_channel_manifest(url: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || fetch_channel_manifest_sync(url))
        .await
        .map_err(|e| e.to_string())?
}

/// The fetch itself, sync so the tests can drive it without a runtime.
fn fetch_channel_manifest_sync(url: String) -> Result<String, String> {
    if url != CHANNEL_MANIFEST_URL {
        return Err("the channel manifest lives at titer.smitpatel.net".to_string());
    }
    run("curl", &["-fsSL", "--max-time", "10", url.as_str()])
}

/// The channel host: the only host the updater ever fetches from. The
/// manifest lives here (CHANNEL_MANIFEST_URL) and the manifest's
/// `update.url` points at this host's /downloads/ path. Nothing else is
/// fetchable — the page can never point the updater at another host, a
/// local file, or plain http.
const CHANNEL_HOST: &str = "titer.smitpatel.net";

/// True only for an https URL whose authority is exactly the channel
/// host — no port, no userinfo, no lookalike suffix (`titer.smitpatel.net.evil.com`
/// has a different authority; `titer.smitpatel.net@evil.com` does too).
fn is_channel_host_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split('/').next().unwrap_or("");
    authority == CHANNEL_HOST
}

/// True only for a 64-digit hex string: the shape a sha256 must have
/// before it is trusted as the manifest's hash for an asset.
fn is_sha256_hex(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The channel manifest's installable asset, as the shell understands
/// it. Parsed with serde_json (already a direct dependency) — no new
/// crates.
#[derive(serde::Deserialize)]
struct ChannelUpdateAsset {
    url: String,
    sha256: String,
    size: u64,
}

#[derive(serde::Deserialize)]
struct ChannelManifestDoc {
    version: String,
    update: Option<ChannelUpdateAsset>,
}

/// The manifest's promised version + installable asset, validated: the
/// asset must be present, its URL must be the channel host over https,
/// its sha256 must be 64 hex digits, and its size must be positive.
/// Pure, so the tests can drive it without network.
fn parse_channel_manifest(text: &str) -> Result<(String, String, String, u64), String> {
    let doc: ChannelManifestDoc =
        serde_json::from_str(text).map_err(|e| format!("channel manifest isn't JSON: {e}"))?;
    let asset = doc.update.ok_or("channel manifest names no installable update")?;
    if !is_channel_host_url(&asset.url) {
        return Err("channel manifest points the updater off the channel host".to_string());
    }
    if !is_sha256_hex(&asset.sha256) {
        return Err("channel manifest's update sha256 is malformed".to_string());
    }
    if asset.size == 0 {
        return Err("channel manifest's update size is zero".to_string());
    }
    Ok((doc.version, asset.url, asset.sha256, asset.size))
}

/// Fetches the channel manifest and returns its promised version +
/// installable asset. The download/apply commands resolve the artifact
/// through this — never through caller-supplied values — so a compromised
/// or malicious webview cannot point the updater at an arbitrary host or
/// a hash of its own choosing.
fn channel_update_asset() -> Result<(String, String, String, u64), String> {
    let text = fetch_channel_manifest_sync(CHANNEL_MANIFEST_URL.to_string())?;
    parse_channel_manifest(&text)
}

/// The sha256 of a file, via the system tool (macOS `shasum`, Linux
/// `sha256sum`) — the same tooling the download check already used, now
/// shared with apply so the staged zip is re-verified against the
/// manifest before anything is swapped.
fn sha256_file(path: &str) -> Result<String, String> {
    let sum = if cfg!(target_os = "macos") {
        run("shasum", &["-a", "256", path])?
    } else {
        run("sha256sum", &[path])?
    };
    Ok(sum.split_whitespace().next().unwrap_or("").to_string())
}

/// True when `candidate` (which must exist) sits inside `dir`: both
/// sides are canonicalised first, so `..` and symlinked temp dirs
/// cannot smuggle a path outside. Used to prove an apply request names
/// the file `download_update` itself wrote, not an arbitrary zip the
/// caller planted.
fn path_is_within(dir: &Path, candidate: &Path) -> bool {
    match (dir.canonicalize(), candidate.canonicalize()) {
        (Ok(dir), Ok(cand)) => cand.starts_with(dir),
        _ => false,
    }
}

/// Downloads the update asset to a temp file, checks its size and sha256
/// against the channel manifest, and returns the temp path. The artifact
/// is resolved strictly inside Rust from CHANNEL_MANIFEST_URL: the
/// command takes no URL, hash, or size, so no caller can point it at an
/// arbitrary host or a hash of its own choosing. Redirects are restricted
/// to https (`--proto-redir =https`), so a manifest URL can never
/// downgrade the fetch to plain http mid-flight.
#[tauri::command]
pub async fn download_update() -> Result<String, String> {
    tokio::task::spawn_blocking(download_update_sync)
        .await
        .map_err(|e| e.to_string())?
}

/// The download itself, sync so it can run on a blocking-pool thread:
/// a sync command runs on macOS's main thread, and curl's `--max-time
/// 900` would park the UI for up to 15 minutes.
fn download_update_sync() -> Result<String, String> {
    let (_version, url, sha256, size) = channel_update_asset()?;
    let dir = staging_dir("download");
    std::fs::create_dir_all(&dir).map_err(|e| format!("couldn't make {dir:?}: {e}"))?;
    let file = dir.join("Titer-update.zip");
    let _ = std::fs::remove_file(&file);
    let file_str = file.to_str().ok_or("temp path isn't UTF-8")?;
    run(
        "curl",
        &[
            "-fsSL",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--max-time",
            "900",
            "-o",
            file_str,
            url.as_str(),
        ],
    )?;
    let actual = std::fs::metadata(&file)
        .map_err(|e| format!("download vanished: {e}"))?
        .len();
    if actual != size {
        return Err(format!("download is {actual} bytes, the manifest says {size}"));
    }
    let actual_sha = sha256_file(file_str)?;
    if !actual_sha.eq_ignore_ascii_case(&sha256) {
        return Err("download's sha256 doesn't match the manifest".to_string());
    }
    Ok(file.to_string_lossy().into_owned())
}

/// The running app's bundle: the executable is `<bundle>/Contents/MacOS/titer`.
#[cfg(target_os = "macos")]
fn current_bundle() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("couldn't find this app: {e}"))?;
    let bundle = exe
        .parent() // MacOS
        .and_then(|p| p.parent()) // Contents
        .and_then(|p| p.parent()) // Titer.app
        .ok_or("this app isn't in a bundle")?
        .to_path_buf();
    if !bundle.join("Contents").join("Info.plist").is_file() {
        return Err("this app isn't in a bundle".to_string());
    }
    Ok(bundle)
}

/// Verifies the downloaded asset against the channel manifest and
/// stages the bundle swap. Returns once the swap is staged; the caller
/// then quits through the normal flow, and a helper swaps the bundle
/// once this process has exited and opens the new app.
///
/// The verification binds the zip to the channel three ways: the path
/// must be the file `download_update` itself wrote (inside its staging
/// dir, under the name it uses — no caller-planted zip), the manifest's
/// promised version must be the version the caller asked to install, and
/// the file's sha256 must equal the manifest's hash for that version. A
/// zip that is merely stamped with the right version — the old hole —
/// fails the hash check unless it also matches the manifest, which
/// requires controlling the channel host. No codesign check: releases
/// are unsigned (no Apple Developer Program — DMGs stay unsigned), so
/// `codesign --verify` would reject every legitimate update; the
/// manifest hash is the verification that applies here.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn apply_update(path: String, version: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || apply_update_sync(path, version))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
fn apply_update_sync(path: String, version: String) -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;

    let asset = Path::new(&path);
    if !asset.is_file() {
        return Err("downloaded update is missing".to_string());
    }
    // The file must be the one download_update wrote: inside its staging
    // dir, under the name it uses. Anything else is refused before the
    // manifest is even fetched.
    let download_dir = staging_dir("download");
    if asset.file_name().map(|n| n != "Titer-update.zip").unwrap_or(true)
        || !path_is_within(&download_dir, asset)
    {
        return Err("update asset isn't the file download_update wrote".to_string());
    }
    // The channel's word on this version: the manifest must promise this
    // version, and the file must hash to the manifest's sha256.
    let (manifest_version, _url, sha256, _size) = channel_update_asset()?;
    if manifest_version != version {
        return Err(format!("channel manifest promises {manifest_version}, not {version}"));
    }
    let asset_str = asset.to_str().ok_or("asset path isn't UTF-8")?;
    let actual_sha = sha256_file(asset_str)?;
    if !actual_sha.eq_ignore_ascii_case(&sha256) {
        return Err("update asset's sha256 doesn't match the channel manifest".to_string());
    }
    let bundle = current_bundle()?;
    let parent = bundle.parent().ok_or("Titer isn't in a folder")?.to_path_buf();
    // The swap needs to write beside the running bundle: prove it now, so
    // a read-only /Applications fails here, before anything is staged.
    let probe = parent.join(".titer-update-write-test");
    std::fs::write(&probe, b"").map_err(|e| format!("can't write beside Titer ({parent:?}): {e}"))?;
    let _ = std::fs::remove_file(&probe);

    let stage = staging_dir(&version);
    let _ = std::fs::remove_dir_all(&stage);
    std::fs::create_dir_all(&stage).map_err(|e| format!("couldn't make {stage:?}: {e}"))?;
    let stage_str = stage.to_str().ok_or("stage path isn't UTF-8")?;
    run("ditto", &["-x", "-k", asset_str, stage_str])?;
    let new_bundle = stage.join("Titer.app");
    if !new_bundle.is_dir() {
        return Err("update asset holds no Titer.app".to_string());
    }
    // The 1.0.4 guard: the staged bundle's own stamp must say the version
    // the manifest promised, or nothing is swapped.
    let plist = new_bundle.join("Contents").join("Info.plist");
    let plist_str = plist.to_str().ok_or("plist path isn't UTF-8")?;
    let stamp = run("/usr/libexec/PlistBuddy", &["-c", "Print :CFBundleShortVersionString", plist_str])?;
    if stamp.trim() != version {
        return Err(format!("update is stamped {}, not {version}", stamp.trim()));
    }
    // The swap runs in a helper after this process exits: a running app
    // cannot move its own bundle. The helper waits for our PID (60 s, so
    // a quit the user cancelled just abandons the swap), moves the old
    // bundle aside, moves the new one in, and opens it.
    let helper = stage.join("swap.sh");
    let script = format!(
        "#!/bin/sh\n\
         # Titer update helper: swap the bundle once the old app has exited.\n\
         n=0\n\
         while kill -0 {pid} 2>/dev/null && [ \"$n\" -lt 60 ]; do sleep 1; n=$((n + 1)); done\n\
         if kill -0 {pid} 2>/dev/null; then rm -rf {stage}; exit 0; fi\n\
         OLD={bundle}\n\
         BACKUP=\"$OLD.titer-update-backup\"\n\
         rm -rf \"$BACKUP\"\n\
         mv \"$OLD\" \"$BACKUP\" || exit 1\n\
         if ! mv {new_bundle} \"$OLD\"; then mv \"$BACKUP\" \"$OLD\"; exit 1; fi\n\
         rm -rf \"$BACKUP\"\n\
         open \"$OLD\"\n\
         rm -rf {stage}\n",
        pid = std::process::id(),
        stage = sh_quote(&stage),
        bundle = sh_quote(&bundle),
        new_bundle = sh_quote(&new_bundle),
    );
    std::fs::write(&helper, script).map_err(|e| format!("couldn't write the update helper: {e}"))?;
    std::fs::set_permissions(&helper, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("couldn't make the update helper executable: {e}"))?;
    Command::new("/bin/sh")
        .arg(&helper)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't start the update helper: {e}"))?;
    Ok("restarting".to_string())
}

/// Linux has no shipped artifact yet, so there is nothing to swap in: the
/// frontend offers the manual download instead of calling this. Async
/// like the macOS command, so the frontend's invoke shape is identical
/// on every platform.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn apply_update(_path: String, _version: String) -> Result<String, String> {
    Err("in-place updates are macOS-only; download the release instead".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // The allowlist is the whole point of taking a URL at all: the shell
    // must never fetch an arbitrary host for the page. No network is
    // touched here — a refused URL fails before curl runs.
    #[test]
    fn fetch_channel_manifest_refuses_any_other_url() {
        for url in [
            "http://127.0.0.1:9/version.json",
            "https://raw.githubusercontent.com/smitpatel316/Titer/main/package.json",
            "http://titer.smitpatel.net/channel/version.json",
        ] {
            let err = fetch_channel_manifest_sync(url.to_string()).unwrap_err();
            assert!(err.contains("titer.smitpatel.net"), "{url}: {err}");
        }
    }

    // Round 2 Issue 46: the updater resolves the artifact strictly from
    // the channel manifest, so the asset URL must be the channel host
    // over https — lookalikes, userinfo, subdomains, and ports are all
    // a different authority and must be refused.
    #[test]
    fn is_channel_host_url_allows_only_the_channel_host() {
        assert!(is_channel_host_url(
            "https://titer.smitpatel.net/downloads/Titer-2.0.0.zip"
        ));
        assert!(is_channel_host_url("https://titer.smitpatel.net/channel/version.json"));
        for url in [
            "http://titer.smitpatel.net/downloads/Titer-2.0.0.zip",
            "https://titer.smitpatel.net.evil.com/downloads/x.zip",
            "https://evil.com/downloads/x.zip",
            "https://titer.smitpatel.net@evil.com/downloads/x.zip",
            "https://sub.titer.smitpatel.net/downloads/x.zip",
            "https://titer.smitpatel.net:8443/downloads/x.zip",
            "file:///tmp/Titer-update.zip",
        ] {
            assert!(!is_channel_host_url(url), "{url}");
        }
    }

    // The live manifest shape (2.0.0, channel build 25) parses to the
    // exact asset the release published. No network is touched.
    #[test]
    fn parse_channel_manifest_accepts_the_live_shape() {
        let text = r#"{"version":"2.0.0","build":25,"update":{"url":"https://titer.smitpatel.net/downloads/Titer-2.0.0.zip","sha256":"b04cbff806def5a34b2304ff2a5b6c5a76228366f7582be9959721d0e3af7875","size":137190059}}"#;
        let (version, url, sha, size) = parse_channel_manifest(text).unwrap();
        assert_eq!(version, "2.0.0");
        assert_eq!(url, "https://titer.smitpatel.net/downloads/Titer-2.0.0.zip");
        assert_eq!(
            sha,
            "b04cbff806def5a34b2304ff2a5b6c5a76228366f7582be9959721d0e3af7875"
        );
        assert_eq!(size, 137190059);
    }

    // A manifest that names no asset, points off the channel host, or
    // carries a malformed hash/size must fail before curl ever runs.
    #[test]
    fn parse_channel_manifest_rejects_off_channel_or_malformed_assets() {
        let base = |update: &str| format!(r#"{{"version":"2.0.0","update":{update}}}"#);
        assert!(parse_channel_manifest(r#"{"version":"2.0.0"}"#).is_err());
        for url in [
            "https://evil.com/downloads/x.zip",
            "http://titer.smitpatel.net/downloads/x.zip",
            "https://titer.smitpatel.net@evil.com/x.zip",
        ] {
            let text = base(&format!(
                r#"{{"url":"{url}","sha256":"{}","size":1}}"#,
                "a".repeat(64)
            ));
            assert!(parse_channel_manifest(&text).is_err(), "{url}");
        }
        let text = base(&format!(
            r#"{{"url":"https://titer.smitpatel.net/downloads/x.zip","sha256":"{}","size":1}}"#,
            "z".repeat(64)
        ));
        assert!(parse_channel_manifest(&text).is_err());
        let text = base(
            r#"{"url":"https://titer.smitpatel.net/downloads/x.zip","sha256":"aabb","size":1}"#,
        );
        assert!(parse_channel_manifest(&text).is_err());
        let text = base(&format!(
            r#"{{"url":"https://titer.smitpatel.net/downloads/x.zip","sha256":"{}","size":0}}"#,
            "a".repeat(64)
        ));
        assert!(parse_channel_manifest(&text).is_err());
        assert!(parse_channel_manifest("not json").is_err());
    }

    // The apply-path confinement: only a file inside the download
    // staging dir counts — a sibling, a `..` escape, or a missing file
    // does not. No network is touched.
    #[test]
    fn path_is_within_confines_to_the_dir() {
        let root = std::env::temp_dir().join(format!("titer-updater-test-{}", std::process::id()));
        let inside_dir = root.join("download");
        let outside_dir = root.join("other");
        std::fs::create_dir_all(&inside_dir).unwrap();
        std::fs::create_dir_all(&outside_dir).unwrap();
        let inside = inside_dir.join("Titer-update.zip");
        let outside = outside_dir.join("Titer-update.zip");
        let escape = inside_dir.join("..").join("other").join("Titer-update.zip");
        std::fs::write(&inside, b"x").unwrap();
        std::fs::write(&outside, b"x").unwrap();
        assert!(path_is_within(&inside_dir, &inside));
        assert!(!path_is_within(&inside_dir, &outside));
        assert!(!path_is_within(&inside_dir, &escape));
        assert!(!path_is_within(&inside_dir, &inside_dir.join("missing.zip")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
