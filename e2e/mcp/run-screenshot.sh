#!/bin/bash
# Run the screenshot-similarity cases against the built debug app (check/e2e-conversion).
#
# Mirrors e2e/mcp/run.sh: launches the debug binary with a SCRATCH app-data
# dir, waits for the MCP discovery file, then runs e2e/mcp/cases_screenshot.py.
# Kills the app on exit.
#
#   bash e2e/mcp/run-screenshot.sh [--out-dir DIR] [--cases a,b] [--capture]
#   bash e2e/mcp/run-screenshot.sh --self-test   # offline FAIL-pin proof, no app
#   bash e2e/mcp/run-screenshot.sh --offline     # L8 comparator cases, no app
#
# Linux needs a display (Xvfb): start it first, e.g. `Xvfb :99 -screen 0 1280x800x24 &`
# and export DISPLAY=:99. macOS needs none.
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$REPO/e2e/out/screenshot"
# Python >= 3.12 required (f-string backslash in cases_numeric.py) — macOS
# system python3 is 3.9.6; prefer $MCP_PYTHON, else Homebrew python3.
PY="${MCP_PYTHON:-python3}"
if ! "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
  if [ -x /opt/homebrew/bin/python3 ]; then PY=/opt/homebrew/bin/python3; fi
fi
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null \
  || { echo "FAIL: python3 >= 3.12 required (have $("$PY" --version 2>&1))" >&2; exit 1; }
PREV=""
for arg in "$@"; do
  if [ "$PREV" = "--out-dir" ]; then OUT_DIR="$arg"; fi
  PREV="$arg"
done
# --self-test / --offline need no binary and no display.
for arg in "$@"; do
  case "$arg" in
    --self-test|--offline)
      exec "$PY" "$REPO/e2e/mcp/cases_screenshot.py" --repo "$REPO" --out-dir "$OUT_DIR" "$@" ;;
  esac
done

BIN="$REPO/src-tauri/target/debug/titer"
if [ ! -x "$BIN" ]; then
  for app in "$REPO"/src-tauri/target/debug/*.app; do
    [ -d "$app" ] || continue
    cand="$app/Contents/MacOS/$(basename "$app" .app)"
    [ -x "$cand" ] && BIN="$cand" && break
  done
fi
[ -x "$BIN" ] || { echo "FAIL: no debug binary at $REPO/src-tauri/target/debug/titer (run 'npm run e2e:build' first)" >&2; exit 1; }
echo "binary: $BIN ($(stat -c%s "$BIN" 2>/dev/null || stat -f%z "$BIN") B)"

if [ "$(uname)" = "Darwin" ]; then
  SCRATCH="$REPO/e2e/.e2e-home-mcp"
  export HOME="$SCRATCH/home"
  # The debug binary hangs silently (no output, no discovery.json) when
  # $HOME does not exist — pre-create it before launch.
  mkdir -p "$SCRATCH/home"
  DISC="$SCRATCH/home/Library/Application Support/net.smitpatel.helix/mcp/discovery.json"
else
  [ -n "${DISPLAY:-}" ] || { echo "FAIL: DISPLAY is unset — start Xvfb first (Linux needs a display)" >&2; exit 1; }
  SCRATCH="$REPO/e2e/.e2e-home-mcp"
  export XDG_DATA_HOME="$SCRATCH/data"
  export XDG_CONFIG_HOME="$SCRATCH/config"
  export XDG_CACHE_HOME="$SCRATCH/cache"
  mkdir -p "$SCRATCH/data" "$SCRATCH/config" "$SCRATCH/cache"
  DISC="$SCRATCH/data/net.smitpatel.helix/mcp/discovery.json"
fi
mkdir -p "$OUT_DIR"
rm -f "$DISC"  # never read a stale discovery file (wrong token/endpoint)
# The 1.8.2 server gates tools behind allowlist groups; a fresh install
# advertises only the 6 read-group tools, so every mutating case fails.
# Pre-seed mcp-allowlist.json with all 10 groups in the scratch app-data
# (the Settings-toggles equivalent); the server reads it per session.
MCP_DIR="$(dirname "$DISC")"
mkdir -p "$MCP_DIR"
printf '{"groups": ["read", "read_more", "discovery", "project", "tables", "analyses", "graphs", "export", "cloud", "destructive"], "ts": %s}' "$(date +%s)" > "$MCP_DIR/mcp-allowlist.json"
echo "scratch app-data: $SCRATCH"
echo "scratch app-data: $SCRATCH"
echo "discovery: $DISC"

T0=$(date +%s)
"$BIN" >>"$OUT_DIR/app.log" 2>&1 &
APP_PID=$!
echo "app pid: $APP_PID (log: $OUT_DIR/app.log)"

DISC_FOUND=0
for _ in $(seq 1 180); do
  [ -f "$DISC" ] && { DISC_FOUND=1; break; }
  kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: app exited before discovery appeared (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; exit 1; }
  sleep 1
done
[ "$DISC_FOUND" = 1 ] || { echo "FAIL: no discovery.json after 180 s (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; kill "$APP_PID" 2>/dev/null; exit 1; }
echo "discovery appeared after $(( $(date +%s) - T0 )) s"

# discovery.json appears ~1 s after launch but the MCP HTTP server takes
# ~2-3 min to accept connections (cold webR boot + MCP init) — poll the
# endpoint until it answers 401 (up, unauthenticated) before starting the
# cases, or the first case fails ConnectionRefused.
ENDPOINT="$("$PY" -c 'import json,sys; print(json.load(open(sys.argv[1]))["endpoint"])' "$DISC")"
POLL_OK=0
for _ in $(seq 1 180); do
  CODE="$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$ENDPOINT" 2>/dev/null || echo 000)"
  if [ "$CODE" = "401" ]; then POLL_OK=1; break; fi
  kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: app exited while waiting for the MCP endpoint (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; exit 1; }
  sleep 2
done
[ "$POLL_OK" = 1 ] || { echo "FAIL: MCP endpoint never answered 401 after 360 s (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; kill "$APP_PID" 2>/dev/null; exit 1; }
echo "MCP endpoint up (401) after $(( $(date +%s) - T0 )) s"

set +e
"$PY" "$REPO/e2e/mcp/cases_screenshot.py" --discovery "$DISC" --repo "$REPO" --out-dir "$OUT_DIR" "$@"
RC=$?
set -e
kill "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
echo "Screenshot cases exit: $RC (total $(( $(date +%s) - T0 )) s)"
exit "$RC"
