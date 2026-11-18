#!/usr/bin/env python3
"""Channel manifest verification (T-90).

Fetches https://titer.smitpatel.net/channel/version.json and asserts:
  - version == the expected release version, build == expected build
    (when --build is given)
  - mac.latestVersion == version, mac.latestBuild == build
  - linux.latestVersion == the latest release that actually ships an
    AppImage (the Linux entry is carried over verbatim from the previous
    Mac-only release — it must NOT jump ahead to a version with no
    AppImage)
  - update/full asset URLs answer HEAD 200 with Content-Length == the
    manifest's recorded size
  - with --verify-asset-sha, the update/full assets re-download (shared
    cache with check_github_release.py) and their sha256 == the manifest

Usage:
  python3 check_channel_manifest.py [--version 1.6.1] [--build 10]
      [--cache-dir DIR] [--verify-asset-sha] [--allow-disabled]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Checker, download, fetch_manifest, gh_api,  # noqa: E402
                    http_head, latest_release_tag, sha256_file)


def latest_appimage_version():
    """Latest non-draft release that ships a *.AppImage asset."""
    rels = gh_api("releases?per_page=20")
    for rel in rels:
        if rel.get("draft") or rel.get("prerelease"):
            continue
        if any(a["name"].endswith(".AppImage") for a in rel.get("assets", [])):
            return rel["tag_name"].lstrip("vV")
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version",
                    help="expected manifest version (default: latest live release)")
    ap.add_argument("--build", type=int,
                    help="expected build number (default: not asserted)")
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--verify-asset-sha", action="store_true")
    ap.add_argument("--allow-disabled", action="store_true",
                    help="do not fail when startup.enabled is false")
    args = ap.parse_args()

    version = args.version
    if version is None:
        try:
            version = latest_release_tag().lstrip("vV")
            print(f"INFO: version defaulted to latest live release {version}")
        except Exception as e:  # noqa: BLE001
            c = Checker("Channel manifest verification (T-90)")
            c.check("latest release resolvable", False, str(e))
            return c.finish()

    cache = args.cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "out", "release")
    os.makedirs(cache, exist_ok=True)

    c = Checker(f"Channel manifest verification (T-90) v{version}")
    try:
        m = fetch_manifest()
    except Exception as e:  # noqa: BLE001
        c.check("manifest fetches (200 + JSON)", False, str(e))
        return c.finish()
    c.check("manifest fetches (200 + JSON)", True, "version.json parses")
    c.check("manifest version == expected release",
            m.get("version") == version, f"{m.get('version')} vs {version}")
    if args.build is not None:
        c.check("manifest build == expected",
                m.get("build") == args.build,
                f"{m.get('build')} vs {args.build}")
    startup = m.get("startup", {})
    if startup.get("enabled") is False and not args.allow_disabled:
        c.check("channel updates enabled", False,
                startup.get("disabledMessage", "updates paused"))
    else:
        c.check("channel updates enabled", True,
                "enabled" if startup.get("enabled") is not False else "disabled (allowed)")
    platforms = startup.get("platforms", {})
    mac = platforms.get("mac", {})
    c.check("mac.latestVersion == version",
            mac.get("latestVersion") == version,
            f"{mac.get('latestVersion')} vs {version}")
    if args.build is not None:
        c.check("mac.latestBuild == build",
                mac.get("latestBuild") == args.build,
                f"{mac.get('latestBuild')} vs {args.build}")
    try:
        linux_ver = latest_appimage_version()
    except Exception as e:  # noqa: BLE001
        linux_ver = None
        print(f"INFO: could not resolve latest AppImage release ({e})")
    if linux_ver is not None:
        c.check("linux.latestVersion == latest AppImage release",
                platforms.get("linux", {}).get("latestVersion") == linux_ver,
                f"{platforms.get('linux', {}).get('latestVersion')} vs {linux_ver}")

    for key in ("update", "full"):
        asset = m.get(key)
        if not asset:
            c.skip(f"manifest {key} asset present", f"no {key} entry in manifest")
            continue
        url, size, sha = asset.get("url"), asset.get("size"), asset.get("sha256")
        try:
            status, headers = http_head(url)
            clen = headers.get("Content-Length")
            c.check(f"manifest {key} URL HEAD 200", status == 200,
                    f"{url} -> {status}")
            if clen is not None:
                c.check(f"manifest {key} size == Content-Length",
                        int(clen) == size, f"{clen} vs {size}")
        except Exception as e:  # noqa: BLE001
            c.check(f"manifest {key} URL reachable", False, str(e))
            continue
        if args.verify_asset_sha:
            dest = os.path.join(cache, os.path.basename(url))
            try:
                download(url, dest, expect_size=size)
                actual = sha256_file(dest)
                c.check(f"manifest {key} sha256 == re-downloaded",
                        actual.lower() == (sha or "").lower(),
                        f"{actual} vs {sha}")
            except Exception as e:  # noqa: BLE001
                c.check(f"manifest {key} re-download", False, str(e))
    return c.finish()


if __name__ == "__main__":
    sys.exit(main())
