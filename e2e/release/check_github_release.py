#!/usr/bin/env python3
"""GitHub release verification (T-89).

Asserts a release is live on github.com/smitpatel316/Titer with the
expected asset set, and that every asset's size + sha256 verify by
RE-DOWNLOAD (not by trusting the API's numbers alone).

Expected asset set is derived from the channel manifest: the Linux
AppImage (+ its .sha256 sidecar) is expected only when the manifest's
linux.latestVersion == the release version (v1.6.1 is Mac-only; the
Linux entry still points at 1.6.0). Override with --expect.

Expected SHAs come from, in order:
  - the channel manifest (full.sha256 for the DMG, update.sha256 for the zip)
    when the manifest version == the release version
  - the release's own .sha256 sidecar asset (AppImage)
  - --expected-sha NAME=SHA overrides
An asset with NO expected-sha source FAILS (a green run must never be a
rubber stamp that skipped the hash).

Uses `gh api repos/smitpatel316/Titer/...` explicitly — bare `gh` may
resolve the repo as upstream mickaphd/Helix.

Usage:
  python3 check_github_release.py [--version 1.6.1] [--cache-dir DIR]
      [--expect auto|mac-only|mac-linux] [--expected-sha NAME=SHA ...]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Checker, download, fetch_manifest, gh_api,  # noqa: E402
                    latest_release_tag, release_by_tag, sha256_file)


def asset_names_for(version, expect, manifest):
    if expect == "mac-only":
        linux = False
    elif expect == "mac-linux":
        linux = True
    else:  # auto: Linux asset expected iff the manifest's linux entry is this version
        linux = (manifest.get("startup", {}).get("platforms", {})
                 .get("linux", {}).get("latestVersion") == version)
    names = [f"Titer-{version}-aarch64.dmg", f"Titer-{version}.zip"]
    if linux:
        names += [f"Titer-{version}-linux.AppImage",
                  f"Titer-{version}-linux.AppImage.sha256"]
    return names, linux


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version",
                    help="release version without 'v' (default: latest live release)")
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--expect", default="auto",
                    choices=["auto", "mac-only", "mac-linux"])
    ap.add_argument("--expected-sha", action="append", default=[],
                    help="NAME=SHA override, repeatable")
    ap.add_argument("--manifest-url", default=None)
    args = ap.parse_args()

    version = args.version
    try:
        if version is None:
            version = latest_release_tag().lstrip("vV")
            print(f"INFO: version defaulted to latest live release {version}")
    except Exception as e:  # noqa: BLE001
        c = Checker("GitHub release verification (T-89)")
        c.check("latest release resolvable", False, str(e))
        return c.finish()

    cache = args.cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "out", "release")
    os.makedirs(cache, exist_ok=True)

    c = Checker(f"GitHub release verification (T-89) v{version}")
    try:
        rel = release_by_tag(f"v{version}")
    except Exception as e:  # noqa: BLE001
        c.check("release v%s exists" % version, False, str(e))
        return c.finish()
    c.check("release is not a draft", not rel.get("draft", False), "")
    c.check("release is not a prerelease", not rel.get("prerelease", False), "")
    assets = {a["name"]: a for a in rel.get("assets", [])}

    try:
        manifest = fetch_manifest(args.manifest_url) if args.manifest_url \
            else fetch_manifest()
    except Exception as e:  # noqa: BLE001
        print(f"INFO: channel manifest unreadable ({e}); expected SHAs "
              "fall back to sidecars/overrides only")
        manifest = {}

    expected_names, _linux = asset_names_for(version, args.expect, manifest)
    for name in expected_names:
        c.check(f"asset present: {name}", name in assets,
                f"{len(assets)} assets on the release" if name not in assets else "")
    for name in sorted(assets):
        if name not in expected_names:
            print(f"INFO: unexpected extra asset on release: {name}")

    overrides = dict(kv.split("=", 1) for kv in args.expected_sha)
    for name in expected_names:
        if name not in assets:
            continue
        a = assets[name]
        dest = os.path.join(cache, name)
        try:
            _, size = download(a["browser_download_url"], dest,
                               expect_size=a["size"])
        except Exception as e:  # noqa: BLE001
            c.check(f"re-download {name}", False, str(e))
            continue
        c.check(f"re-downloaded size == API size: {name}",
                size == a["size"], f"{size} == {a['size']}")
        if name.endswith(".sha256"):
            # A .sha256 sidecar's own hash is published nowhere; its
            # CONTENT is the expected hash for its sibling asset. Assert
            # it parses and names the sibling — the sibling's sha check
            # (above, via the sidecar) is the real verification.
            with open(dest) as f:
                parts = f.read().split()
            ok = (len(parts) >= 2 and len(parts[0]) == 64
                  and all(ch in "0123456789abcdef" for ch in parts[0].lower())
                  and parts[1] == name[:-len(".sha256")])
            c.check(f"sidecar content parses: {name}", ok,
                    f"{parts[0][:16]}... names {parts[1] if len(parts) > 1 else '?'}")
            continue
        expected = overrides.get(name)
        if expected is None and manifest.get("version") == version:
            if name == f"Titer-{version}-aarch64.dmg":
                expected = manifest.get("full", {}).get("sha256")
            elif name == f"Titer-{version}.zip":
                expected = manifest.get("update", {}).get("sha256")
        if expected is None and name.endswith(".AppImage"):
            sidecar = assets.get(f"{name}.sha256")
            if sidecar:
                side_dest = os.path.join(cache, f"{name}.sha256")
                try:
                    download(sidecar["browser_download_url"], side_dest,
                             expect_size=sidecar["size"])
                    with open(side_dest) as f:
                        expected = f.read().split()[0]
                except Exception as e:  # noqa: BLE001
                    c.check(f"read sidecar sha for {name}", False, str(e))
        if expected is None:
            c.check(f"expected sha known for {name}", False,
                    "no manifest entry, sidecar, or --expected-sha")
            continue
        actual = sha256_file(dest)
        c.check(f"sha256 == expected: {name}",
                actual.lower() == expected.lower(),
                f"{actual} vs {expected}")
    return c.finish()


if __name__ == "__main__":
    sys.exit(main())
