#!/usr/bin/env python3
"""Update-check behaviour (T-93).

Two modes:

  --mode static  (runnable anywhere, no build, no display)
    The CC-m8 invariants, read off the checked-out source:
    - the update check has a 10 s timeout (UPDATE_CHECK_TIMEOUT_MS) —
      a hung check settles instead of hanging forever
    - CHECKED_KEY is written ONLY after the check reaches a decision:
      the setItem sits behind `if (!completed) return;` in
      checkForUpdatesDaily, so a check that never answers leaves the
      key alone and the next launch tries again
    - the update dialog title is `Titer ${version} is available`
    - the daily check runs at startup (main.tsx)
    - decideUpdate's cases are covered by tests/checks.ts

  --mode gui  (needs a built binary or AppImage + DISPLAY under Xvfb)
    Launches the app with a scratch profile and watches its windows:
    - --expect dialog: a NEW window titled "Titer <ver> is available"
      appears within the timeout (proves the offer fires when a newer
      version exists) AND the main window appears (the check did not
      hang the launch — the CC-m8 hang class)
    - --expect quiet: the main window appears and NO update dialog
      appears within the timeout (proves no false offer when current)
    The dialog title is matched, not just any new window, so a stray
    window from another lane on a shared display cannot fake a pass.
    Windows present BEFORE launch are excluded, so shared displays are safe.

Usage:
  python3 check_update.py --mode static [--repo DIR]
  python3 check_update.py --mode gui --binary PATH --expect dialog|quiet
      [--timeout 60] [--cache-dir DIR]
  (an AppImage path works as --binary; it is run with
   --appimage-extract-and-run)
"""
import argparse
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Checker  # noqa: E402


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def static_checks(c, repo):
    src = os.path.join(repo, "src")
    version_ts = read(os.path.join(src, "lib", "version.ts"))
    m = re.search(r"UPDATE_CHECK_TIMEOUT_MS\s*=\s*([\d_]+)", version_ts)
    c.check("update check has a 10 s timeout",
            m is not None and int(m.group(1).replace("_", "")) == 10_000,
            f"UPDATE_CHECK_TIMEOUT_MS = {m.group(1) if m else 'not found'}")
    c.check("channel manifest fetch uses the timeout",
            "await fetchWithTimeout(CHANNEL_MANIFEST_URL" in
            read(os.path.join(src, "lib", "channel.ts")),
            "fetchChannelManifest must not use a bare fetch")
    c.check("no bare fetch left in channel.ts",
            not re.search(r"await fetch\(", read(os.path.join(src, "lib", "channel.ts"))),
            "")
    updates_ts = read(os.path.join(src, "updates.ts"))
    guard = updates_ts.find("if (!completed) return;")
    setitem = updates_ts.find("localStorage.setItem(CHECKED_KEY")
    c.check("CHECKED_KEY written only after the check reaches a decision",
            guard != -1 and setitem != -1 and guard < setitem,
            "setItem must sit behind `if (!completed) return;` (CC-m8)")
    c.check("CHECKED_KEY is the once-a-day key",
            'CHECKED_KEY = "titer.updatesCheckedAt"' in updates_ts, "")
    native_ts = read(os.path.join(src, "native.ts"))
    c.check("update dialog title is 'Titer <version> is available'",
            "title: `Titer ${version} is available`" in native_ts, "")
    c.check("daily update check runs at startup",
            "checkForUpdatesDaily()" in read(os.path.join(src, "main.tsx")), "")
    checks_ts = read(os.path.join(repo, "tests", "checks.ts"))
    for case in ("a newer channel manifest offers the update",
                 "an equal or older channel manifest stays quiet",
                 "a channel manifest floor below this version forces the update",
                 "a paused channel manifest disables updates"):
        c.check(f"decideUpdate covered by unit test: {case}",
                case in checks_ts, "")
    return c.finish()


def windows():
    """(id, title) pairs for all top-level windows on this display."""
    out = subprocess.run(["xwininfo", "-root", "-tree"],
                         capture_output=True, text=True, timeout=30)
    found = []
    for line in out.stdout.splitlines():
        m = re.search(r"(0x[0-9a-f]+)\s+\"([^\"]*)\"", line)
        if m and m.group(2):
            found.append((m.group(1), m.group(2)))
    return found


def window_titles():
    return [t for _, t in windows()]


def newest_available():
    """The newest version the app can learn about: max of the channel
    manifest and the main-branch package.json fallback (src/lib/version.ts:
    the manifest is the authority when it answers; otherwise the fallback
    decides). Returns a version string like '1.6.2'."""
    import json

    from common import fetch_manifest, http_get, parse_version
    newest = "0.0.0"
    try:
        m = fetch_manifest()
        newest = m.get("version", newest)
    except Exception as e:  # noqa: BLE001
        print(f"INFO: manifest unreadable ({e}); fallback only")
    try:
        _, body = http_get(
            "https://raw.githubusercontent.com/smitpatel316/Titer/main/package.json")
        main_ver = json.loads(body).get("version", "0.0.0")
        if parse_version(main_ver) > parse_version(newest):
            newest = main_ver
    except Exception as e:  # noqa: BLE001
        print(f"INFO: main package.json unreadable ({e})")
    return newest


def gui_checks(c, binary, expect, timeout, cache):
    if not os.environ.get("DISPLAY"):
        c.check("DISPLAY is set (Xvfb running)", False,
                "start Xvfb first — the GUI leg needs a display")
        return c.finish()
    if not os.path.isfile(binary):
        c.check("binary exists", False, binary)
        return c.finish()
    if expect == "auto":
        m = re.search(r"Titer-(\d+\.\d+\.\d+)", os.path.basename(binary))
        if not m:
            c.check("--expect auto needs a versioned binary filename", False,
                    f"cannot parse a version from {os.path.basename(binary)}; "
                    "pass --expect dialog|quiet explicitly")
            return c.finish()
        from common import parse_version
        binary_ver = m.group(1)
        newest = newest_available()
        expect = ("dialog" if parse_version(binary_ver) < parse_version(newest)
                  else "quiet")
        print(f"INFO: binary {binary_ver} vs newest available {newest} "
              f"-> expect {expect}")
    if not os.access(binary, os.X_OK):
        os.chmod(binary, 0o755)
    home = os.path.join(cache, ".e2e-home-update")
    env = dict(os.environ)
    env["XDG_DATA_HOME"] = os.path.join(home, "data")
    env["XDG_CONFIG_HOME"] = os.path.join(home, "config")
    env["XDG_CACHE_HOME"] = os.path.join(home, "cache")
    # AppImage extraction goes to TMPDIR; /tmp is a 512M tmpfs shared
    # with other lanes, so extract under the cache instead.
    env["TMPDIR"] = os.path.join(cache, ".tmp")
    os.makedirs(env["TMPDIR"], exist_ok=True)
    for d in (env["XDG_DATA_HOME"], env["XDG_CONFIG_HOME"],
              env["XDG_CACHE_HOME"]):
        os.makedirs(d, exist_ok=True)
    before = {wid for wid, _ in windows()}
    cmd = [binary]
    if binary.endswith(".AppImage"):
        cmd.append("--appimage-extract-and-run")
    log_path = os.path.join(cache, "update-gui.log")
    proc = None
    try:
        with open(log_path, "wb") as log:
            proc = subprocess.Popen(cmd, stdout=log,
                                    stderr=subprocess.STDOUT, env=env)
        deadline = time.time() + timeout
        dialog_seen = None
        main_seen = False
        seen_titles = []
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            try:
                new = [(wid, t) for wid, t in windows() if wid not in before]
            except Exception:  # noqa: BLE001 - xwininfo hiccup: retry
                new = []
            for _, t in new:
                if t not in seen_titles:
                    seen_titles.append(t)
                if re.match(r"Titer \S+ is available$", t):
                    dialog_seen = t
                if t in ("Untitled", "Titer"):
                    main_seen = True
            if main_seen and (dialog_seen or expect == "quiet"):
                break
            time.sleep(2)
        c.check("app process stays alive through launch",
                proc.poll() is None,
                f"exit code {proc.poll()}" if proc.poll() is not None else "running")
        c.check("main window appears (launch did not hang on the check)",
                main_seen, f"new windows seen: {seen_titles}")
        if expect == "dialog":
            c.check("update dialog appears when a newer version exists",
                    dialog_seen is not None,
                    dialog_seen or "no 'Titer <ver> is available' window appeared")
        else:
            c.check("no update dialog when current",
                    dialog_seen is None,
                    dialog_seen or "no dialog window appeared")
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    return c.finish()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", required=True, choices=["static", "gui"])
    ap.add_argument("--repo", default=None,
                    help="repo root for --mode static (default: this repo)")
    ap.add_argument("--binary", help="app binary or AppImage for --mode gui")
    ap.add_argument("--expect", choices=["dialog", "quiet", "auto"],
                    default="auto",
                    help="--mode gui: which outcome to assert (default: auto — "
                    "derive from the binary version vs the newest available)")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--cache-dir", default=None)
    args = ap.parse_args()

    repo = args.repo or os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    cache = args.cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "out", "release")
    os.makedirs(cache, exist_ok=True)

    c = Checker(f"Update-check behaviour (T-93) mode={args.mode}")
    if args.mode == "static":
        return static_checks(c, repo)
    if not args.binary or not args.expect:
        c.check("--mode gui needs --binary and --expect", False, "")
        return c.finish()
    return gui_checks(c, args.binary, args.expect, args.timeout, cache)


if __name__ == "__main__":
    sys.exit(main())
