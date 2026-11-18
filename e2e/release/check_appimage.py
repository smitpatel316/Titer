#!/usr/bin/env python3
"""Linux AppImage verification (T-92).

  - the release ships an AppImage + a .sha256 sidecar
  - re-downloaded size == GitHub API size
  - sha256sum -c semantics: the sidecar's hash matches the re-downloaded file
  - smoke PASS via --appimage-extract-and-run (FUSE is absent in the
    container, so plain execution is not an option): the app launches
    under Xvfb with a scratch profile, its main window appears, and the
    process stays alive until we kill it

The smoke leg needs DISPLAY (start Xvfb first, as e2e/mcp/run.sh does);
without one it SKIPs with a note instead of failing.

Usage:
  python3 check_appimage.py [--version 1.6.0 | --file PATH]
      [--cache-dir DIR] [--smoke-timeout 60]
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Checker, download, gh_api, release_by_tag,  # noqa: E402
                    sha256_file)


def latest_appimage_release():
    rels = gh_api("releases?per_page=20")
    for rel in rels:
        if rel.get("draft") or rel.get("prerelease"):
            continue
        if any(a["name"].endswith(".AppImage") for a in rel.get("assets", [])):
            return rel
    return None


def window_titles():
    if shutil.which("xwininfo") is None:
        raise RuntimeError(
            "xwininfo not found — install x11-utils first "
            "(container swaps wipe it: apt-get update && "
            "apt-get install -y x11-utils xdotool)")
    out = subprocess.run(["xwininfo", "-root", "-tree"],
                         capture_output=True, text=True, timeout=30)
    titles = []
    for line in out.stdout.splitlines():
        m = re.search(r'"([^"]*)"', line)
        if m and m.group(1):
            titles.append(m.group(1))
    return titles


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version",
                    help="release version (default: latest release with an AppImage)")
    ap.add_argument("--file", help="use a local AppImage instead of downloading")
    ap.add_argument("--cache-dir", default=None)
    ap.add_argument("--smoke-timeout", type=int, default=60)
    args = ap.parse_args()

    cache = args.cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "out", "release")
    os.makedirs(cache, exist_ok=True)

    c = Checker("Linux AppImage verification (T-92)")
    if args.file:
        appimage = args.file
        c.check("AppImage file exists", os.path.isfile(appimage), appimage)
        if not os.path.isfile(appimage):
            return c.finish()
        sidecar = appimage + ".sha256"
        expected = None
        if os.path.isfile(sidecar):
            with open(sidecar) as f:
                expected = f.read().split()[0]
    else:
        if args.version:
            rel = release_by_tag(f"v{args.version}")
        else:
            rel = latest_appimage_release()
            if rel is None:
                c.check("a release ships an AppImage", False, "none found")
                return c.finish()
            print(f"INFO: version defaulted to latest AppImage release "
                  f"{rel['tag_name']}")
        version = rel["tag_name"].lstrip("vV")
        app = next((a for a in rel["assets"]
                    if a["name"].endswith(".AppImage")), None)
        side = next((a for a in rel["assets"]
                     if a["name"].endswith(".AppImage.sha256")), None)
        c.check(f"release v{version} ships an AppImage", app is not None, "")
        c.check(f"release v{version} ships an AppImage.sha256 sidecar",
                side is not None, "")
        if app is None:
            return c.finish()
        appimage = os.path.join(cache, app["name"])
        try:
            _, size = download(app["browser_download_url"], appimage,
                               expect_size=app["size"])
        except Exception as e:  # noqa: BLE001
            c.check("re-download AppImage", False, str(e))
            return c.finish()
        c.check("re-downloaded size == API size", size == app["size"],
                f"{size} == {app['size']}")
        expected = None
        if side is not None:
            side_dest = os.path.join(cache, side["name"])
            try:
                download(side["browser_download_url"], side_dest,
                         expect_size=side["size"])
                with open(side_dest) as f:
                    expected = f.read().split()[0]
            except Exception as e:  # noqa: BLE001
                c.check("read sidecar sha", False, str(e))
    if expected is None:
        c.check("sidecar sha known", False, "no .sha256 sidecar available")
    else:
        actual = sha256_file(appimage)
        c.check("sha256sum -c: sidecar hash matches re-downloaded file",
                actual.lower() == expected.lower(),
                f"{actual} vs {expected}")

    # --- smoke: --appimage-extract-and-run under Xvfb ---
    if not os.environ.get("DISPLAY"):
        c.skip("smoke via --appimage-extract-and-run",
               "no DISPLAY — start Xvfb first (Linux needs a display)")
        return c.finish()
    if not os.access(appimage, os.X_OK):
        os.chmod(appimage, 0o755)
    home = os.path.join(cache, ".e2e-home-appimage")
    # Fresh profile EVERY run (see check_update.py: a reused profile's
    # once-a-day CHECKED_KEY suppresses the launch update check).
    import shutil
    shutil.rmtree(home, ignore_errors=True)
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = os.path.join(home, "data")
    env["XDG_CONFIG_HOME"] = os.path.join(home, "config")
    env["XDG_CACHE_HOME"] = os.path.join(home, "cache")
    # --appimage-extract-and-run extracts into TMPDIR; /tmp is a 512M
    # tmpfs that other lanes share, so extract under the cache instead.
    env["TMPDIR"] = os.path.join(cache, ".tmp")
    os.makedirs(env["TMPDIR"], exist_ok=True)
    for d in (env["XDG_DATA_HOME"], env["XDG_CONFIG_HOME"],
              env["XDG_CACHE_HOME"]):
        os.makedirs(d, exist_ok=True)
    log_path = os.path.join(cache, "appimage-smoke.log")
    proc = None
    try:
        with open(log_path, "wb") as log:
            proc = subprocess.Popen(
                [appimage, "--appimage-extract-and-run"],
                stdout=log, stderr=subprocess.STDOUT, env=env)
        deadline = time.time() + args.smoke_timeout
        main_window = False
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            try:
                if "Untitled" in window_titles() or "Titer" in window_titles():
                    main_window = True
                    break
            except Exception:  # noqa: BLE001 - xwininfo hiccup: retry
                pass
            time.sleep(2)
        c.check("app process stays alive through launch",
                proc.poll() is None,
                f"exit code {proc.poll()}" if proc.poll() is not None else "running")
        c.check("main window appears under Xvfb", main_window,
                f"window titles seen: {window_titles()[:6]}")
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    return c.finish()


if __name__ == "__main__":
    sys.exit(main())
