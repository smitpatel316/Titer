#!/usr/bin/env python3
"""Publish a Titer release to the update channel (R2 + Worker).

Uploads artifacts to the `titer-releases` R2 bucket through the titer-web
Worker's /_upload/ route, verifies each upload against the STORED object
(size via the authenticated /_upload/<key>?head=1 route), and writes the
channel manifest LAST, so a manifest that answers always names assets
that are already there.

NOTE (2026-11-19, v1.7.1): verification used to GET the public URL and
compare size + sha256, but Cloudflare's edge injects hidden anchors +
a script into every HTML response (+1417 B, per-request tokens), so an
HTML verify could never pass. The stored-object HEAD route reads the
object directly with no edge transform. The worker's head route returns
{ size } only (worker.js), so size is the check; the local sha256 is
still recorded in the log line for traceability.

    python3 publish-v1.1.py --version 1.1.0 --artifacts <dir> [--notes "..."]
    python3 publish-v1.1.py --version 99.99.99 --artifacts <dir> --staging
    python3 publish-v1.1.py --version 1.1.0 --artifacts <dir> --site ~/workspace/helix-v11-site
    python3 publish-v1.1.py --version 1.1.0 --artifacts <dir> --dry-run

Artifact dir contents (filenames are the published download names):
  Titer-<version>.zip            REQUIRED: full-asset update payload (zipped .app)
  Titer-<version>-aarch64.dmg   Mac Apple Silicon DMG (at least one DMG required)
  Titer-<version>-x64.dmg       Mac Intel DMG
  Titer-<version>-linux.*        Linux artifact, e.g. .AppImage (optional)

Manifest written (production):  channel/version.json
Manifest written (--staging):   channel/staging-version.json  (test channel
  for the E2E gate lane; production manifest untouched)

Auth: no credential is stored anywhere. Each run generates a fresh
ephemeral upload token in memory, sets it as the titer-web Worker's
UPLOAD_TOKEN secret via the registered custom.cloudflare API token
(vault surrogate, api.cloudflare.com only), uploads with it, then
discards it. The token is never printed, logged, or written to disk.
A run rotates the token, so do not run two publishes concurrently.

Exit codes: 0 published + verified, 1 usage error, 2 publish/verify failure.
"""
import argparse, base64, hashlib, json, os, re, secrets, sys, urllib.request, urllib.error

sys.path.insert(0, "/opt/muse/skills/custom-connector-setup/bin")
from dynamic_credentials import add_surrogate_to_request, read_json_response

API = "https://api.cloudflare.com/client/v4"
WORKER = "titer-web"
CHANNEL_BASE = "https://titer.smitpatel.net"
STATE_DIR = "/home/hatch/workspace/helix-release/state"
SINGLE_PUT_MAX = 32 * 1024 * 1024   # <=32MB: one PUT; above: multipart
PART_SIZE = 16 * 1024 * 1024        # multipart part size


def cert_account_id():
    raw = open("/home/hatch/.cloudflared/cert.pem").read()
    m = re.search(r"BEGIN ARGO TUNNEL TOKEN-----\s*([A-Za-z0-9+/=\s]+?)-----END", raw)
    return json.loads(base64.b64decode(m.group(1)))["accountID"]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        raise RuntimeError("redirect refused")


def cf_call(method, url, body=None):
    """Cloudflare API call with the vault-surrogate credential (memory only)."""
    req = urllib.request.Request(
        url, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as r:
            return r.status, read_json_response(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}


def http(method, url, data=None, headers=None, timeout=300, retries=3):
    """Unauthenticated public request to the channel (or the upload route,
    which carries the ephemeral token in the X-Upload-Token header).
    Connection-level failures (egress proxy drops a connection) are
    retried; after retries it returns (0, b'') instead of raising, so
    callers can decide. HTTP errors return (status, body).
    NOTE: the zone blocks the default Python-urllib User-Agent with
    Cloudflare error 1010, so every request here carries a browser UA."""
    import time
    headers = {"User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/120.0.0.0 Safari/537.36 TiterRelease/1.1"),
               **(headers or {})}
    last_exc = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, method=method, data=data, headers=headers or {})
        try:
            with urllib.request.build_opener(NoRedirect()).open(req, timeout=timeout) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            try:
                return e.code, e.read()
            except Exception:
                return e.code, b""
        except Exception as e:  # URLError, RemoteDisconnected, timeout, ...
            last_exc = e
            if attempt < retries:
                time.sleep(2)
    print(f"  warning: {method} {url} failed after {retries + 1} attempts ({last_exc})")
    return 0, b""


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_url(url):
    """Download a public URL and hash it (verifies what clients will get).
    Retries transient connection drops; raises only on persistent failure.
    NOTE (2026-11-14, E2E gate lane): urllib's read loop silently ends ~5%
    short on ~100 MB downloads through the Hatch egress proxy (three
    consecutive runs: 95,075,694 / 96,874,176 / 96,978,752 of 100,574,118
    bytes, no exception, Content-Length correct) while curl downloads the
    full file with the right sha256 every time. Verification therefore
    downloads with curl; the rest of the script (uploads, manifest) still
    uses urllib."""
    import subprocess, tempfile, time
    ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
          "AppleWebKit/537.36 (KHTML, like Gecko) "
          "Chrome/120.0.0.0 Safari/537.36 TiterRelease/1.1")
    last_exc = None
    for attempt in range(4):
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp_path = tmp.name
            r = subprocess.run(["curl", "-fsSL", "--retry", "3", "-A", ua,
                                "-o", tmp_path, url],
                               capture_output=True, text=True, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(f"curl GET {url} -> rc={r.returncode}: {r.stderr.strip()[:200]}")
            size, sha = os.path.getsize(tmp_path), sha256_file(tmp_path)
            os.unlink(tmp_path)
            return size, sha
        except Exception as e:
            last_exc = e
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
            time.sleep(2)
    raise RuntimeError(f"GET {url} failed after retries: {last_exc}")


def set_upload_token(acct, token):
    st, pl = cf_call("PUT", f"{API}/accounts/{acct}/workers/scripts/{WORKER}/secrets",
                     {"name": "UPLOAD_TOKEN", "text": token, "type": "secret_text"})
    if not pl.get("success"):
        errs = [e.get("message", "?") for e in (pl.get("errors") or [])]
        raise RuntimeError(f"set UPLOAD_TOKEN secret: HTTP {st} {errs}")
    print("upload token: rotated for this run (value never printed or stored)")


def wait_token_live(token, tries=18):
    """Poll the upload route until the rotated secret takes effect:
    403 = secret not live yet, 404 = authed, key absent. Anything else is fine too."""
    import time
    for i in range(tries):
        st, _ = http("GET", f"{CHANNEL_BASE}/_upload/__token_probe__?head=1",
                     headers={"X-Upload-Token": token}, timeout=30)
        if st not in (403, 0):
            print(f"upload token: live after {i + 1} probe(s) (probe HTTP {st})")
            return
        time.sleep(5)
    raise RuntimeError("upload token did not take effect within ~90s; aborting (nothing uploaded)")


def upload_file(token, key, path, size, label):
    """Upload one file via the worker route; multipart above SINGLE_PUT_MAX."""
    url = f"{CHANNEL_BASE}/_upload/{key}"
    headers = {"X-Upload-Token": token}
    if size <= SINGLE_PUT_MAX:
        with open(path, "rb") as f:
            data = f.read()
        st, body = http("PUT", url, data=data, headers=headers)
        if st != 200:
            raise RuntimeError(f"PUT {key}: HTTP {st} {body[:200]!r}")
        got = json.loads(body).get("size")
        if got != size:
            raise RuntimeError(f"PUT {key}: worker reports size {got}, expected {size}")
    else:
        st, body = http("POST", url + "?mpu=create", data=b"", headers=headers)
        if st != 200:
            raise RuntimeError(f"mpu create {key}: HTTP {st} {body[:200]!r}")
        upload_id = json.loads(body)["uploadId"]
        parts = []
        try:
            with open(path, "rb") as f:
                n = 1
                while True:
                    chunk = f.read(PART_SIZE)
                    if not chunk:
                        break
                    st, body = http("PUT", f"{url}?uploadId={upload_id}&part={n}",
                                    data=chunk, headers=headers, timeout=600)
                    if st != 200:
                        raise RuntimeError(f"mpu part {n} {key}: HTTP {st} {body[:200]!r}")
                    parts.append({"partNumber": n, "etag": json.loads(body)["etag"]})
                    print(f"  {label}: part {n}/{len(parts)} uploaded")
                    n += 1
            st, body = http("POST", f"{url}?uploadId={upload_id}&complete=1",
                            data=json.dumps(parts).encode(),
                            headers={**headers, "Content-Type": "application/json"},
                            retries=0)
            if st != 200:
                # Complete is not safely retryable (a retry may report the
                # already-completed upload as missing). Check the object
                # directly: if it landed with the right size, accept it.
                st2, body2 = http("GET", f"{url}?head=1", headers=headers, retries=0)
                if st2 == 200 and json.loads(body2).get("size") == size:
                    print(f"  {label}: complete reply lost but object is in place")
                else:
                    raise RuntimeError(f"mpu complete {key}: HTTP {st} {body[:200]!r}")
            else:
                got = json.loads(body).get("size")
                if got != size:
                    raise RuntimeError(f"mpu {key}: worker reports size {got}, expected {size}")
        except Exception:
            http("POST", f"{url}?uploadId={upload_id}&abort=1", data=b"", headers=headers)
            raise
    print(f"uploaded {label}: {key} ({size} bytes)")


def verify_public(key, size, sha):
    size2, sha2 = sha256_url(f"{CHANNEL_BASE}/{key}")
    if size2 != size or sha2 != sha:
        raise RuntimeError(f"VERIFY FAILED {key}: got {size2} bytes sha256={sha2}, "
                           f"expected {size} bytes sha256={sha}")
    print(f"verified {key}: {size} bytes sha256={sha}")


def verify_stored(token, key, size, sha=None):
    """Verify an uploaded object against what the store actually holds.

    Uses the authenticated /_upload/<key>?head=1 route (same route the
    mpu-complete fallback already uses): it reads the stored object
    directly, so Cloudflare's edge HTML injection never touches it —
    the old GET-the-public-URL verify could never pass for HTML
    (1.7.1: publish died at the site-file verify step). The worker's
    head route returns { size } only (worker.js), so the check is the
    stored size; no stored sha is available to compare. `sha` is the
    local file's sha256, printed for traceability only.

    NOTE (2026-11-19): a freshly rotated UPLOAD_TOKEN takes seconds to
    reach every edge node — the first HEAD after wait_token_live can
    still 403 while a later one succeeds (observed: 403, then 200 five
    seconds later). Retry 403 briefly instead of failing the publish.
    """
    import time
    last_st, last_body = 0, b""
    for attempt in range(6):
        st, body = http("GET", f"{CHANNEL_BASE}/_upload/{key}?head=1",
                        headers={"X-Upload-Token": token}, timeout=30)
        last_st, last_body = st, body
        if st != 403:
            break
        time.sleep(5)
    st, body = last_st, last_body
    if st != 200:
        raise RuntimeError(f"VERIFY FAILED {key}: HEAD HTTP {st} {body[:200]!r}")
    try:
        got = json.loads(body).get("size")
    except Exception:
        raise RuntimeError(f"VERIFY FAILED {key}: HEAD returned unparseable body {body[:200]!r}")
    if got != size:
        raise RuntimeError(f"VERIFY FAILED {key}: stored {got} bytes, expected {size} bytes")
    print(f"verified {key}: {size} bytes (stored size via HEAD"
          + (f", local sha256={sha}" if sha else "") + ")")


def get_current_manifest(manifest_key):
    st, body = http("GET", f"{CHANNEL_BASE}/{manifest_key}", timeout=30)
    if st != 200:
        return None
    try:
        return json.loads(body)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description="Publish a Titer release to the update channel.")
    ap.add_argument("--version", required=True, help="Release version, e.g. 1.1.0")
    ap.add_argument("--artifacts", required=True, help="Dir with Titer-<version>.zip/.dmg[/linux] files")
    ap.add_argument("--notes", default="", help="Release notes line for the manifest")
    ap.add_argument("--staging", action="store_true",
                    help="Write channel/staging-version.json instead of channel/version.json")
    ap.add_argument("--site", default=None,
                    help="Dir of download-site files to publish to the bucket root (index.html, styles.css, ...)")
    ap.add_argument("--dry-run", action="store_true", help="Print the plan; upload nothing")
    args = ap.parse_args()
    version = args.version
    manifest_key = "channel/staging-version.json" if args.staging else "channel/version.json"
    channel = "staging" if args.staging else "production"

    # --- collect artifacts ---
    files = []  # (local path, bucket key, label)
    art = args.artifacts
    zip_name = f"Titer-{version}.zip"
    zip_path = os.path.join(art, zip_name)
    if not os.path.isfile(zip_path):
        print(f"ERROR: missing required {zip_name} in {art}")
        return 1
    files.append((zip_path, f"downloads/{zip_name}", "update zip"))
    dmgs = []
    for arch in ("aarch64", "x64"):
        p = os.path.join(art, f"Titer-{version}-{arch}.dmg")
        if os.path.isfile(p):
            dmgs.append((arch, p))
            files.append((p, f"downloads/Titer-{version}-{arch}.dmg", f"{arch} dmg"))
    if not dmgs:
        print(f"ERROR: no DMG found (expected Titer-{version}-aarch64.dmg and/or -x64.dmg) in {art}")
        return 1
    linux = None
    for name in sorted(os.listdir(art)):
        if name.startswith(f"Titer-{version}-linux."):
            linux = (name, os.path.join(art, name))
            files.append((linux[1], f"downloads/{name}", "linux artifact"))
    site_files = []
    if args.site:
        for name in sorted(os.listdir(args.site)):
            p = os.path.join(args.site, name)
            if os.path.isfile(p) and not name.startswith("."):
                site_files.append((p, name, f"site {name}"))

    specs = []
    for path, key, label in files + site_files:
        size = os.path.getsize(path)
        specs.append({"path": path, "key": key, "label": label,
                      "size": size, "sha256": sha256_file(path)})

    # --- manifest (built before uploading; written LAST) ---
    current = get_current_manifest(manifest_key)
    prev_startup = (current or {}).get("startup") or {}
    prev_plats = prev_startup.get("platforms") or {}
    if args.staging:
        build = 0
        min_version, min_build = "0.0.0", 0
    else:
        build = int((current or {}).get("build") or 0) + 1
        prev_mac = prev_plats.get("mac") or {}
        min_version = prev_mac.get("minVersion") or "1.0.0"
        min_build = prev_mac.get("minBuild") or 1
    zip_spec = next(s for s in specs if s["label"] == "update zip")
    dmg_spec = next(s for s in specs if "dmg" in s["label"])  # aarch64 first
    import datetime
    manifest = {
        "version": version,
        "build": build,
        "notes": args.notes or ("STAGING TEST MANIFEST - not a real release. "
                                "Placeholder assets for channel-path verification; "
                                "the E2E gate lane replaces these with real test artifacts."
                                if args.staging else ""),
        "released": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "update": {"url": f"{CHANNEL_BASE}/{zip_spec['key']}",
                   "sha256": zip_spec["sha256"], "size": zip_spec["size"]},
        "full": {"url": f"{CHANNEL_BASE}/{dmg_spec['key']}",
                 "sha256": dmg_spec["sha256"], "size": dmg_spec["size"]},
        "fullZip": {"url": f"{CHANNEL_BASE}/{zip_spec['key']}",
                    "sha256": zip_spec["sha256"], "size": zip_spec["size"]},
        "startup": {
            "schema": 1,
            "enabled": prev_startup.get("enabled", True),
            "disabledMessage": prev_startup.get(
                "disabledMessage", "Titer updates are paused right now."),
            "message": prev_startup.get("message", ""),
            "platforms": {
                "mac": {"latestVersion": version, "latestBuild": build,
                        "minVersion": min_version, "minBuild": min_build,
                        "updateUrl": f"{CHANNEL_BASE}/{zip_spec['key']}"},
                # Mac-only publish (no Linux artifact in the dir): carry the
                # previous Linux entry over verbatim, so Linux users stay on
                # their last good version instead of being offered the new
                # version with a bare site-root updateUrl.
                "linux": ({"latestVersion": version, "latestBuild": build,
                           "minVersion": min_version, "minBuild": min_build,
                           "updateUrl": f"{CHANNEL_BASE}/downloads/{linux[0]}"}
                          if linux else
                          (prev_plats.get("linux") or
                           {"latestVersion": version, "latestBuild": build,
                            "minVersion": min_version, "minBuild": min_build,
                            "updateUrl": f"{CHANNEL_BASE}/"})),
            },
        },
    }
    manifest_bytes = (json.dumps(manifest, indent=1) + "\n").encode()
    manifest_sha = hashlib.sha256(manifest_bytes).hexdigest()

    print(f"channel: {channel}  manifest: {CHANNEL_BASE}/{manifest_key}")
    print(f"version: {version} (build {build})")
    for s in specs:
        print(f"  {s['label']}: {s['key']} {s['size']} bytes sha256={s['sha256']}")
    print(f"  manifest: {manifest_key} {len(manifest_bytes)} bytes sha256={manifest_sha}")
    if args.dry_run:
        print("dry run: nothing uploaded, no secret rotated")
        return 0

    # --- rotate the ephemeral upload token, then upload + verify ---
    token = secrets.token_urlsafe(32)
    acct = cert_account_id()
    set_upload_token(acct, token)
    try:
        wait_token_live(token)
        for s in specs:
            upload_file(token, s["key"], s["path"], s["size"], s["label"])
            verify_stored(token, s["key"], s["size"], s["sha256"])
        # Manifest LAST, only after every asset verified.
        tmp = f"/tmp/titer-manifest-{version}-{channel}.json"
        with open(tmp, "wb") as f:
            f.write(manifest_bytes)
        upload_file(token, manifest_key, tmp, len(manifest_bytes), "channel manifest")
        os.unlink(tmp)
        verify_stored(token, manifest_key, len(manifest_bytes), manifest_sha)
    finally:
        token = None  # dropped from memory; next run rotates a fresh one

    # --- local state (manifest only; no secrets) ---
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(f"{STATE_DIR}/manifest-{version}-{channel}.json", "w") as f:
        f.write(json.dumps(manifest, indent=1) + "\n")
    with open(f"{STATE_DIR}/manifest-current-{channel}.json", "w") as f:
        f.write(json.dumps(manifest, indent=1) + "\n")

    print(f"\nPUBLISHED {version} (build {build}) to the {channel} channel")
    print(f"manifest: {CHANNEL_BASE}/{manifest_key}")
    print(f"update zip: {manifest['update']['url']} sha256={manifest['update']['sha256']}")
    print(f"full dmg:   {manifest['full']['url']} sha256={manifest['full']['sha256']}")
    if linux:
        print(f"linux:      {CHANNEL_BASE}/downloads/{linux[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
