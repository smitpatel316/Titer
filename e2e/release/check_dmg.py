#!/usr/bin/env python3
"""Mac DMG verification (T-88, S-04/S-05).

Verifies a release DMG the way the release process does:
  - size + sha256 (portable; runs anywhere)
  - the truncated-DMG trap (S-04): a 1.6 MB DMG with a 512-byte binary once
    passed `hdiutil VALID` — so the binary inside must be ~100 MB and the
    DMG ~99 MB, and the DMG mtime must be AFTER the build-start stamp
  - hdiutil verify + attach: binary size/md5 inside the image (macOS only)
  - codesign --verify on the mounted app (macOS only)
  - installed app: binary md5 == DMG binary md5, codesign OK, and the
    Info.plist version == the release version (macOS only; this is the
    automatable form of the About-dialog version check)

Mac-only legs print SKIP (MAC-OWED) off macOS and never fail the run there;
run them on the Mac (or in CI e2e-mac) for the full gate.

Usage:
  python3 check_dmg.py --dmg Titer-1.6.1-aarch64.dmg --version 1.6.1
      [--expected-sha <hex>] [--expected-size <bytes>]
      [--build-start <stamp-file>] [--binary-md5 <hex>]
      [--installed-app /Applications/Titer.app]

Expected sha/size normally come from the channel manifest (full.sha256 /
full.size) or the release staging dir; when omitted, the size floor
(>= 50 MB) is the only size assertion — the truncated-DMG trap floor.
"""
import argparse
import hashlib
import os
import plistlib
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import Checker, is_mac, sha256_file  # noqa: E402

# S-04: the truncated DMG that passed hdiutil VALID was 1.6 MB with a
# 512-byte binary. A real Titer DMG is ~99 MB with a ~100 MB binary.
# The floors below are far above the trap values and far below real ones.
DMG_SIZE_FLOOR = 50_000_000
BINARY_SIZE_FLOOR = 50_000_000


def run(cmd, timeout=120):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dmg", required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--expected-sha")
    ap.add_argument("--expected-size", type=int)
    ap.add_argument("--build-start",
                    help="stamp file touched at build start; DMG mtime must be after it")
    ap.add_argument("--binary-md5", help="md5 of the fresh-built binary")
    ap.add_argument("--installed-app", default="/Applications/Titer.app")
    args = ap.parse_args()

    c = Checker(f"DMG verification (T-88/S-04/S-05) {args.dmg}")
    dmg = args.dmg

    c.check("dmg exists", os.path.isfile(dmg), dmg)
    if not os.path.isfile(dmg):
        return c.finish()
    size = os.path.getsize(dmg)
    c.check("dmg size above truncated-DMG floor (50 MB)",
            size >= DMG_SIZE_FLOOR, f"{size} bytes")
    if args.expected_size is not None:
        c.check("dmg size == expected", size == args.expected_size,
                f"{size} == {args.expected_size}")
    sha = sha256_file(dmg)
    if args.expected_sha is not None:
        c.check("dmg sha256 == expected",
                sha.lower() == args.expected_sha.lower(),
                f"{sha} vs {args.expected_sha}")
    else:
        print(f"INFO: dmg sha256 {sha} (no --expected-sha given)")
    if args.build_start:
        if os.path.exists(args.build_start):
            stamp = os.path.getmtime(args.build_start)
            mtime = os.path.getmtime(dmg)
            c.check("dmg mtime after build-start stamp",
                    mtime > stamp,
                    f"dmg {time.ctime(mtime)} vs stamp {time.ctime(stamp)}")
        else:
            c.check("build-start stamp exists", False, args.build_start)

    if not is_mac():
        c.skip("hdiutil verify", "MAC-OWED: hdiutil is macOS-only")
        c.skip("mounted binary size/md5", "MAC-OWED: hdiutil attach is macOS-only")
        c.skip("codesign mounted app", "MAC-OWED: codesign is macOS-only")
        c.skip("installed binary md5 == dmg binary md5", "MAC-OWED: needs macOS")
        c.skip("installed app codesign OK", "MAC-OWED: needs macOS")
        c.skip("installed app version == release version",
               "MAC-OWED: needs macOS (Info.plist read)")
        return c.finish()

    # --- macOS-only legs ---
    r = run(["hdiutil", "verify", dmg])
    c.check("hdiutil verify", r.returncode == 0,
            (r.stdout + r.stderr).strip().splitlines()[-1]
            if (r.stdout + r.stderr).strip() else "ok")
    r = run(["hdiutil", "attach", "-readonly", "-nobrowse", "-plist", dmg])
    if r.returncode != 0:
        c.check("hdiutil attach", False, (r.stdout + r.stderr).strip()[-300:])
        return c.finish()
    mount = None
    try:
        import plistlib as _pl
        info = _pl.loads(r.stdout.encode())
        for ent in info.get("system-entities", []):
            if ent.get("mount-point"):
                mount = ent["mount-point"]
                break
    except Exception as e:  # noqa: BLE001 - attach output parse failure is a FAIL below
        print(f"INFO: could not parse attach plist: {e}")
    c.check("hdiutil attach mounted", mount is not None, mount or "")
    dmg_binary_md5 = None
    if mount:
        app = os.path.join(mount, "Titer.app")
        binary = os.path.join(app, "Contents", "MacOS", "Titer")
        c.check("Titer.app present in image", os.path.isdir(app), app)
        if os.path.isfile(binary):
            bsize = os.path.getsize(binary)
            c.check("mounted binary size above truncated floor (50 MB)",
                    bsize >= BINARY_SIZE_FLOOR, f"{bsize} bytes")
            h = hashlib.md5()
            with open(binary, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            dmg_binary_md5 = h.hexdigest()
            if args.binary_md5:
                c.check("mounted binary md5 == fresh-build md5",
                        dmg_binary_md5 == args.binary_md5.lower(),
                        f"{dmg_binary_md5} vs {args.binary_md5}")
            else:
                print(f"INFO: mounted binary md5 {dmg_binary_md5}")
        r = run(["codesign", "--verify", "--deep", "--strict", app])
        c.check("codesign mounted app",
                r.returncode == 0, (r.stdout + r.stderr).strip() or "ok")
    if mount:
        run(["hdiutil", "detach", mount])

    installed = args.installed_app
    ibin = os.path.join(installed, "Contents", "MacOS", "Titer")
    if not os.path.isfile(ibin):
        c.skip("installed binary md5 == dmg binary md5",
               f"not installed at {installed}")
        c.skip("installed app codesign OK", f"not installed at {installed}")
        c.skip("installed app version == release version",
               f"not installed at {installed}")
        return c.finish()
    h = hashlib.md5()
    with open(ibin, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    installed_md5 = h.hexdigest()
    if dmg_binary_md5:
        c.check("installed binary md5 == dmg binary md5",
                installed_md5 == dmg_binary_md5,
                f"{installed_md5} vs {dmg_binary_md5}")
    r = run(["codesign", "--verify", "--deep", "--strict", installed])
    c.check("installed app codesign OK",
            r.returncode == 0, (r.stdout + r.stderr).strip() or "ok")
    plist_path = os.path.join(installed, "Contents", "Info.plist")
    try:
        with open(plist_path, "rb") as f:
            plist = plistlib.load(f)
        ver = plist.get("CFBundleShortVersionString")
        c.check("installed app version == release version",
                ver == args.version, f"Info.plist {ver} vs {args.version}")
    except Exception as e:  # noqa: BLE001
        c.check("installed app version == release version", False, str(e))
    return c.finish()


if __name__ == "__main__":
    sys.exit(main())
