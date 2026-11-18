#!/bin/bash
# Run the adopted battery runner over a file list against a live MCP endpoint.
#
# Usage: bash e2e/battery/run-slice.sh --discovery <discovery.json>
#          [--files e2e/battery/slice-5.json] [--plan coverage-final.json]
#          [--out-dir DIR] [--start N] [--count M]
#
# The discovery file comes from a running app: either the E2E debug build
# (e2e/mcp/run.sh) or a shipped build launched under Xvfb with MCP toggled
# on (e2e/battery/launch-appimage.sh). This script never launches an app
# itself and never touches the live battery re-run's files or progress.
# Exit code is the runner's (0 = every attempted file passed).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DISC=""
FILES="$REPO/e2e/battery/slice-5.json"
PLAN="$HOME/workspace/.helix-owed-items/battery-corpus/coverage-final.json"
OUT_DIR="$HOME/workspace/.helix-e2e-conversion/battery-proof/slice-5"
START=0; COUNT=5
while [ $# -gt 0 ]; do
  case "$1" in
    --discovery) DISC="$2"; shift 2 ;;
    --files) FILES="$2"; shift 2 ;;
    --plan) PLAN="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --count) COUNT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$DISC" ] || { echo "FAIL: --discovery required (path to mcp/discovery.json)" >&2; exit 2; }
[ -f "$DISC" ] || { echo "FAIL: no discovery file at $DISC" >&2; exit 1; }
[ -f "$FILES" ] || { echo "FAIL: no manifest at $FILES" >&2; exit 1; }
[ -f "$PLAN" ] || { echo "WARN: no plan at $PLAN — runner falls back to descriptive-statistics probe" >&2; PLAN=""; }
mkdir -p "$OUT_DIR"
ARGS=(python3 "$REPO/e2e/battery/runner.py" "$DISC" --files "$FILES"
      --out-dir "$OUT_DIR" --start "$START" --count "$COUNT")
[ -n "$PLAN" ] && ARGS+=(--plan "$PLAN")
"${ARGS[@]}"
RC=$?
python3 "$REPO/e2e/battery/aggregate.py" --run-dir "$OUT_DIR" || true
exit "$RC"
