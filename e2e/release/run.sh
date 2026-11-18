#!/bin/bash
# Release verification runner (T-88..T-93) — the Linux-runnable legs.
#
# Runs, in order: GitHub release (T-89), channel manifest (T-90),
# website (T-91), Linux AppImage (T-92), update-check static leg (T-93),
# DMG portable legs (T-88: size/sha against the manifest), and the
# update-dialog GUI leg (T-93: the cached AppImage is older than the
# live manifest, so the dialog must appear).
#
# Mac-only legs (hdiutil/codesign/mounted-binary/About version) SKIP with
# a MAC-OWED note on Hatch; run this same runner on the Mac (or CI
# e2e-mac) for the full gate. The update-quiet GUI leg also needs a
# binary NEWER than the live manifest — no such binary exists on Hatch
# (v1.6.2 is staged, not built here), so it is owed, not skipped silently:
# see the MAC-OWED / OWED notes at the end of every run.
#
# Usage: bash e2e/release/run.sh [--version 1.6.1] [--skip-gui]
#        [--cache-dir DIR] [--out-dir DIR]
# Exit code is non-zero iff any leg fails. Downloads land in the cache
# dir (default e2e/out/release, gitignored) and are reused across legs.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
CACHE="$REPO/e2e/out/release"
OUT="$REPO/e2e/out/release"
VERSION=""
SKIP_GUI=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --skip-gui) SKIP_GUI=1; shift ;;
    --cache-dir) CACHE="$2"; shift 2 ;;
    --out-dir) OUT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
mkdir -p "$CACHE" "$OUT"
PY="python3 $REPO/e2e/release"
FAIL=0
run_leg() {
  local name="$1"; shift
  echo
  echo "######## $name ########"
  # shellcheck disable=SC2086
  $PY/"$@" --cache-dir "$CACHE" >>"$OUT/run.log" 2>&1
  local rc=$?
  tail -n +1 "$OUT/run.log" | tail -n 60
  : >"$OUT/run.log"
  [ "$rc" != 0 ] && FAIL=1
  echo "---- $name exit: $rc ----"
  return "$rc"
}

if [ -z "$VERSION" ]; then
  VERSION="$(gh api repos/smitpatel316/Titer/releases/latest --jq .tag_name | sed 's/^v//')"
  echo "version defaulted to latest live release: $VERSION"
fi
APPIMAGE_VERSION="$(gh api 'repos/smitpatel316/Titer/releases?per_page=20' --jq '[.[] | select(.assets[]?.name | test("\\.AppImage$"))][0].tag_name' | sed 's/^v//')"
echo "latest AppImage release: $APPIMAGE_VERSION"

# Xvfb for the GUI legs (own display, -listen tcp; killed at the end).
# This Xvfb does not serve high display numbers (:197 never listens),
# so pick the first free display in 90..97.
XVFB_PID=""
if [ "$SKIP_GUI" = 0 ] && [ -z "${DISPLAY:-}" ]; then
  DISP=""
  for d in 90 91 92 93 94 95 96 97; do
    if [ ! -e "/tmp/.X11-unix/X$d" ]; then DISP="$d"; break; fi
  done
  [ -n "$DISP" ] || { echo "FAIL: no free X display in 90..97" >&2; exit 1; }
  Xvfb ":$DISP" -listen tcp -screen 0 1280x800x24 >>"$OUT/xvfb.log" 2>&1 &
  XVFB_PID=$!
  export DISPLAY="127.0.0.1:$DISP"
  for _ in $(seq 1 10); do
    xwininfo -root -tree >/dev/null 2>&1 && break
    sleep 1
  done
  xwininfo -root -tree >/dev/null 2>&1 || { echo "FAIL: Xvfb on $DISPLAY never answered" >&2; exit 1; }
  echo "started Xvfb on $DISPLAY (pid $XVFB_PID)"
fi

run_leg "T-89 GitHub release" check_github_release.py --version "$VERSION"
run_leg "T-90 channel manifest" check_channel_manifest.py --version "$VERSION" --verify-asset-sha
run_leg "T-91 website" check_website.py --version "$VERSION"
run_leg "T-92 Linux AppImage" check_appimage.py --version "$APPIMAGE_VERSION"
run_leg "T-93 update-check (static)" check_update.py --mode static --repo "$REPO"

# T-88 portable legs: the release DMG is already in the cache (T-89
# downloaded it); verify size + sha against the channel manifest.
DMG="$CACHE/Titer-$VERSION-aarch64.dmg"
if [ -f "$DMG" ]; then
  MANIFEST_SHA="$(curl -s https://titer.smitpatel.net/channel/version.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["full"]["sha256"])')"
  MANIFEST_SIZE="$(curl -s https://titer.smitpatel.net/channel/version.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["full"]["size"])')"
  run_leg "T-88 Mac DMG (portable legs)" check_dmg.py --dmg "$DMG" --version "$VERSION" --expected-sha "$MANIFEST_SHA" --expected-size "$MANIFEST_SIZE"
else
  echo "---- T-88 Mac DMG: SKIP (no DMG in cache; T-89 did not download one) ----"
fi

if [ "$SKIP_GUI" = 0 ]; then
  APPIMAGE="$CACHE/Titer-$APPIMAGE_VERSION-linux.AppImage"
  if [ -f "$APPIMAGE" ]; then
    run_leg "T-93 update dialog (GUI, AppImage older than manifest)" check_update.py --mode gui --binary "$APPIMAGE" --expect dialog
  else
    echo "---- T-93 update dialog: SKIP (no AppImage in cache) ----"
  fi
else
  echo "---- GUI legs skipped (--skip-gui) ----"
fi

[ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null

echo
echo "================ SUMMARY ================"
echo "version: $VERSION (AppImage: $APPIMAGE_VERSION)"
echo "cache: $CACHE"
echo "MAC-OWED (run on the Mac / CI e2e-mac for the full gate):"
echo "  - T-88: hdiutil verify, mounted binary size/md5, codesign (mounted +"
echo "    installed), installed binary md5 == DMG binary md5, About version"
echo "    (Info.plist read)"
echo "OWED (needs a binary newer than the live manifest; none on Hatch):"
echo "  - T-93 GUI quiet leg: launch a current binary, assert NO update dialog"
echo "    (run check_update.py --mode gui --binary <current> --expect quiet)"
if [ "$FAIL" != 0 ]; then echo "RESULT: FAIL"; else echo "RESULT: PASS"; fi
exit "$FAIL"
