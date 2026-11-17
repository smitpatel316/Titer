#!/bin/bash
# Run the MCP regression suite against the built debug app (check/e2e-ci).
#
# Launches the debug binary with a SCRATCH app-data dir (so CI never touches
# real app data), waits for the MCP discovery file (the app enables MCP
# itself in the E2E build — see the VITE_E2E hook in src/components/app-shell.tsx),
# then runs e2e/mcp/suite.py. Kills the app on exit.
#
# Linux needs a display (Xvfb): start it first, e.g. `Xvfb :99 -screen 0 1280x800x24 &`
# and export DISPLAY=:99. macOS needs none.
#
# Usage: bash e2e/mcp/run.sh [--out-dir DIR]
# Exit code is the suite's (0 = all cases pass).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$REPO/e2e/out/mcp"
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Resolve the debug binary: plain binary on Linux; on macOS Tauri also
# produces a .app bundle — fall back to the executable inside it.
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
python3 --version >/dev/null 2>&1 || { echo "FAIL: python3 not found" >&2; exit 1; }

if [ "$(uname)" = "Darwin" ]; then
  SCRATCH="$REPO/e2e/.e2e-home-mcp"
  export HOME="$SCRATCH/home"
  DISC="$SCRATCH/home/Library/Application Support/net.smitpatel.helix/mcp/discovery.json"
  APP_ENV="HOME=$SCRATCH/home"
else
  [ -n "${DISPLAY:-}" ] || { echo "FAIL: DISPLAY is unset — start Xvfb first (Linux needs a display)" >&2; exit 1; }
  SCRATCH="$REPO/e2e/.e2e-home-mcp"
  export XDG_DATA_HOME="$SCRATCH/data"
  export XDG_CONFIG_HOME="$SCRATCH/config"
  export XDG_CACHE_HOME="$SCRATCH/cache"
  DISC="$SCRATCH/data/net.smitpatel.helix/mcp/discovery.json"
  APP_ENV="XDG_DATA_HOME=$SCRATCH/data XDG_CONFIG_HOME=$SCRATCH/config XDG_CACHE_HOME=$SCRATCH/cache"
fi
mkdir -p "$OUT_DIR"
rm -f "$DISC"  # never read a stale discovery file (wrong token/endpoint)
echo "scratch app-data: $SCRATCH"
echo "discovery: $DISC"

T0=$(date +%s)
"$BIN" >>"$OUT_DIR/app.log" 2>&1 &
APP_PID=$!
echo "app pid: $APP_PID (log: $OUT_DIR/app.log)"

# Wait for discovery (MCP enabled on mount in the E2E build; webR boots first).
DISC_FOUND=0
for _ in $(seq 1 180); do
  [ -f "$DISC" ] && { DISC_FOUND=1; break; }
  kill -0 "$APP_PID" 2>/dev/null || { echo "FAIL: app exited before discovery appeared (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; exit 1; }
  sleep 1
done
[ "$DISC_FOUND" = 1 ] || { echo "FAIL: no discovery.json after 180 s (see $OUT_DIR/app.log)" >&2; tail -30 "$OUT_DIR/app.log" >&2; kill "$APP_PID" 2>/dev/null; exit 1; }
echo "discovery appeared after $(( $(date +%s) - T0 )) s"

set +e
python3 "$REPO/e2e/mcp/suite.py" --discovery "$DISC" --repo "$REPO" --out-dir "$OUT_DIR"
RC=$?
set -e
kill "$APP_PID" 2>/dev/null || true
wait "$APP_PID" 2>/dev/null || true
echo "MCP suite exit: $RC (total $(( $(date +%s) - T0 )) s)"
exit "$RC"
