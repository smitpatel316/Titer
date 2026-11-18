#!/bin/bash
# Launch an EXISTING shipped build for a battery slice proof (Hatch-side).
#
# Runs the shipped 1.6.0 AppImage's extracted binary under its OWN Xvfb
# display (:97 — never the shared :98, and never the battery re-run's
# display) with scratch XDG dirs, then enables MCP via the Settings ->
# AI Connections GUI toggle and waits for the MCP discovery file.
#
# This is a PROOF harness for the adoption slice only — not a CI path
# (CI uses the E2E debug build, e2e/mcp/run.sh, where MCP auto-enables).
# It launches no build and touches no live battery re-run files.
#
# GUI lessons baked in (learned 2026-11-18 on this exact flow):
# - Run AppRun, NOT usr/bin/titer directly — the bare binary dies
#   spawning WebKitNetworkProcess (its helper path resolves through the
#   AppRun environment).
# - Dismiss the update dialog ("Later") FIRST: Ctrl+, never reaches the
#   app while the dialog has focus. Open Settings via the menu bar
#   (Settings -> AI Connections...), not Ctrl+,.
# - Synthetic clicks land LEFT of the requested x (QA L02 click-offset
#   quirk, ~1 column): the toggle is ~30 px wide, so click it at
#   x=330 (corrected) and retry at 300/360. Verify FUNCTIONALLY —
#   discovery.json appearing — never trust the click alone.
# - On discovery failure the app + Xvfb are LEFT RUNNING for a manual
#   toggle fix (killing them on timeout burned one proof attempt).
#   Ctrl-C here cleans up (trap).
#
# Usage: bash e2e/battery/launch-appimage.sh [--out-dir DIR] [--display :97]
#          [--probe-only]
#   --probe-only: only verify an already-running instance's discovery file.
# Prints the discovery path on success; the caller then runs run-slice.sh.
set -u
OUT_DIR="$HOME/workspace/.helix-e2e-conversion/battery-proof/app-160"
DISPLAY_NUM=":97"
PROBE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --display) DISPLAY_NUM="$2"; shift 2 ;;
    --toggle-x) shift 2 ;;  # accepted for compat; toggle xs are tried in order below
    --toggle-y) shift 2 ;;
    --probe-only) PROBE_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
BIN="$HOME/workspace/.helix-owed-items/battery-full-loop/work/appimage/squashfs-root/AppRun"
[ -x "$BIN" ] || BIN="$HOME/workspace/helix-release/v1.6-linux/squashfs-root/AppRun"
[ -x "$BIN" ] || { echo "FAIL: no runnable shipped 1.6.0 binary found" >&2; exit 1; }
SCRATCH="$OUT_DIR/.e2e-home-battery"
export XDG_DATA_HOME="$SCRATCH/data" XDG_CONFIG_HOME="$SCRATCH/config" XDG_CACHE_HOME="$SCRATCH/cache"
DISC="$SCRATCH/data/net.smitpatel.helix/mcp/discovery.json"
mkdir -p "$OUT_DIR" "$SCRATCH"
if [ "$PROBE_ONLY" = 1 ]; then
  [ -f "$DISC" ] || { echo "FAIL: no discovery at $DISC" >&2; exit 1; }
  echo "discovery: $DISC"
  python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('endpoint:', d.get('endpoint'))" "$DISC"
  exit 0
fi
rm -f "$DISC"
# Xvfb writes its pid lock to /tmp — a full /tmp (orphaned AppImage
# extractions fill the 512M tmpfs) makes Xvfb fail with "Could not write
# pid to lock file". Fail early with a clear message instead of a
# confusing Xvfb death.
TMP_AVAIL_KB="$(df -k /tmp 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$TMP_AVAIL_KB" ] && [ "$TMP_AVAIL_KB" -lt 51200 ]; then
  echo "FAIL: /tmp has only ${TMP_AVAIL_KB} KB free (<50 MB) — Xvfb cannot write its lock file." >&2
  echo "  Check for orphaned /tmp/appimage_extracted_* dirs (lsof +D <dir> must show no live user) and remove them." >&2
  exit 1
fi
echo "binary: $BIN"
echo "display: $DISPLAY_NUM  scratch: $SCRATCH"
Xvfb "$DISPLAY_NUM" -listen tcp -screen 0 1280x800x24 >>"$OUT_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
# Wait until the X server is actually ready (socket present) — launching
# the app after a fixed 2 s sleep raced Xvfb's xkbcomp init once and the
# app panicked with "Failed to initialize gtk backend".
DISP_NUM="${DISPLAY_NUM#:}"
READY=0
for _ in $(seq 1 30); do
  if [ -S "/tmp/.X11-unix/X$DISP_NUM" ] && kill -0 "$XVFB_PID" 2>/dev/null; then READY=1; break; fi
  sleep 1
done
[ "$READY" = 1 ] || { echo "FAIL: Xvfb $DISPLAY_NUM never became ready (see $OUT_DIR/xvfb.log)" >&2; kill "$XVFB_PID" 2>/dev/null; exit 1; }
export DISPLAY="127.0.0.1$DISPLAY_NUM"
# NOTE: container swaps wipe apt-installed -dev packages; if the app exits
# immediately with missing .so errors, re-run scripts/setup-linux.sh first.
setsid "$BIN" >>"$OUT_DIR/app.log" 2>&1 < /dev/null &
APP_PID=$!
echo "app pid: $APP_PID (log: $OUT_DIR/app.log)"
cleanup() {
  kill "$APP_PID" 2>/dev/null || true
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT
# Wait for the main window, then dismiss the update dialog (Later) if shown.
sleep 12
kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: app exited early (see $OUT_DIR/app.log)" >&2; tail -20 "$OUT_DIR/app.log" >&2; exit 1; }
WID="$(xdotool search --name "Titer" 2>/dev/null | head -1)"
echo "titer window: ${WID:-none found (continuing anyway)}"
xdotool mousemove 420 99 click 1 2>/dev/null || true   # "Later" on the update dialog
sleep 1
xdotool mousemove 400 300 click 1 2>/dev/null || true  # focus the main window
sleep 1
# Open Settings -> AI Connections... via the menu bar (Ctrl+, is unreliable here).
xdotool mousemove 462 13 click 1 2>/dev/null || true
sleep 1
xdotool mousemove 490 40 click 1 2>/dev/null || true
sleep 2
ffmpeg -y -f x11grab -i "127.0.0.1$DISPLAY_NUM" -frames:v 1 "$OUT_DIR/shot-settings.png" 2>/dev/null || true
echo "settings screenshot: $OUT_DIR/shot-settings.png"
# Toggle the MCP switch: try corrected x positions (synthetic clicks land
# left — L02). Verify functionally via discovery.json after each try.
FOUND=0
for TX in 330 300 360; do
  xdotool mousemove "$TX" 336 click 1 2>/dev/null || true
  for _ in $(seq 1 20); do
    [ -f "$DISC" ] && { FOUND=1; break; }
    sleep 1
  done
  [ "$FOUND" = 1 ] && { echo "toggle clicked at x=$TX — discovery appeared"; break; }
  echo "no discovery after toggle click at x=$TX; retrying"
  ffmpeg -y -f x11grab -i "127.0.0.1$DISPLAY_NUM" -frames:v 1 "$OUT_DIR/shot-settings-retry-$TX.png" 2>/dev/null || true
done
if [ "$FOUND" = 0 ]; then
  echo "FAIL: no discovery.json after toggle retries — app + Xvfb LEFT RUNNING for a manual fix."
  echo "  1. Screenshot the display: ffmpeg -y -f x11grab -i 127.0.0.1$DISPLAY_NUM -frames:v 1 $OUT_DIR/shot-manual.png"
  echo "  2. Open Settings -> AI Connections... and click the switch; verify with: ls $DISC"
  echo "  3. Then run: bash e2e/battery/run-slice.sh --discovery $DISC"
  echo "  4. Ctrl-C here when done (cleans up app + Xvfb)."
  wait "$APP_PID" 2>/dev/null || true
  exit 1
fi
echo "discovery: $DISC"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('endpoint:', d.get('endpoint'))" "$DISC"
echo "READY — run: bash e2e/battery/run-slice.sh --discovery $DISC"
echo "(this script keeps the app alive until it exits; run the slice from another shell, then Ctrl-C here)"
# Keep the app alive for the slice; wait indefinitely.
wait "$APP_PID" 2>/dev/null || true
