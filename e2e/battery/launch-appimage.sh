#!/bin/bash
# Launch an EXISTING shipped build for a battery slice proof (Hatch-side).
#
# Runs the shipped 1.6.0 AppImage's extracted binary under its OWN Xvfb
# display (:97 — never the shared :98, and never the battery re-run's
# display) with scratch XDG dirs, then enables MCP via the Settings ->
# AI Connections GUI toggle (the battery lane's xdotool pattern) and waits
# for the MCP discovery file. Kills the app on exit.
#
# This is a PROOF harness for the adoption slice only — not a CI path
# (CI uses the E2E debug build, e2e/mcp/run.sh, where MCP auto-enables).
# It launches no build and touches no live battery re-run files.
#
# Usage: bash e2e/battery/launch-appimage.sh [--out-dir DIR] [--display :97]
#          [--toggle-x N] [--toggle-y N] [--probe-only]
#   --probe-only: only verify an already-running instance's discovery file
#   (default toggle 300,336 — the switch moves per launch; verify in a
#   screenshot, don't click blind: ffmpeg -f x11grab -i 127.0.0.1:97).
# Prints the discovery path on success; the caller then runs run-slice.sh.
set -u
OUT_DIR="$HOME/workspace/.helix-e2e-conversion/battery-proof/app-160"
DISPLAY_NUM=":97"
TOGGLE_X=300; TOGGLE_Y=336
PROBE_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --display) DISPLAY_NUM="$2"; shift 2 ;;
    --toggle-x) TOGGLE_X="$2"; shift 2 ;;
    --toggle-y) TOGGLE_Y="$2"; shift 2 ;;
    --probe-only) PROBE_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
BIN="$HOME/workspace/.helix-owed-items/battery-full-loop/work/appimage/squashfs-root/AppRun"
[ -x "$BIN" ] || BIN="$HOME/workspace/helix-release/v1.6-linux/squashfs-root/AppRun"
# NOTE: run AppRun, NOT usr/bin/titer directly — the bare binary fails to
# spawn WebKitNetworkProcess (its helper path resolves through the AppRun
# environment). Verified 2026-11-18: direct usr/bin/titer dies with
# "Unable to spawn a new child process ... WebKitNetworkProcess".
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
echo "binary: $BIN"
echo "display: $DISPLAY_NUM  scratch: $SCRATCH"
Xvfb "$DISPLAY_NUM" -listen tcp -screen 0 1280x800x24 >>"$OUT_DIR/xvfb.log" 2>&1 &
XVFB_PID=$!
sleep 2
kill -0 "$XVFB_PID" 2>/dev/null || { echo "FAIL: Xvfb died (see $OUT_DIR/xvfb.log)" >&2; exit 1; }
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
# Best-effort update-dialog dismiss: Tab to Later + Return is unreliable;
# the battery lane clicked it. If discovery never appears, screenshot the
# display and click by hand (see README).
# Open Settings (Ctrl+,) and click the AI Connections MCP switch.
xdotool key ctrl+comma 2>/dev/null || true
sleep 3
ffmpeg -y -f x11grab -i "127.0.0.1$DISPLAY_NUM" -frames:v 1 "$OUT_DIR/shot-settings.png" 2>/dev/null || true
echo "settings screenshot: $OUT_DIR/shot-settings.png — verify the MCP switch position before relying on the click below"
xdotool mousemove "$TOGGLE_X" "$TOGGLE_Y" click 1 2>/dev/null || true
sleep 3
# Wait for discovery (up to 120 s).
FOUND=0
for _ in $(seq 1 120); do
  [ -f "$DISC" ] && { FOUND=1; break; }
  kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: app exited while waiting for discovery" >&2; tail -20 "$OUT_DIR/app.log" >&2; exit 1; }
  sleep 1
done
[ "$FOUND" = 1 ] || { echo "FAIL: no discovery.json after 120 s — inspect $OUT_DIR/shot-settings.png and $OUT_DIR/app.log; the toggle may be at a different position this launch" >&2; exit 1; }
echo "discovery: $DISC"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('endpoint:', d.get('endpoint'))" "$DISC"
echo "READY — run: bash e2e/battery/run-slice.sh --discovery $DISC"
echo "(this script keeps the app alive until it exits; run the slice from another shell, then Ctrl-C here)"
# Keep the app alive for the slice; wait indefinitely.
wait "$APP_PID" 2>/dev/null || true
