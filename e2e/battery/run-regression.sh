#!/bin/bash
# Sweep regression as a battery-suite leg (inventory B-02).
#
# Runs the sweep-16 regression: cycles 1..15 fix repros + fresh probes
# (55 scripts in cycle 16) — the script the sweep lane already runs
# (run-regression16.sh), wrapped so the battery suite can invoke it as
# one leg with captured logs.
#
# Usage: bash e2e/battery/run-regression.sh [--sweep-dir DIR] [--out-dir DIR]
#   SWEEP16_DIR env overrides the default sweep dir.
# Exit code is the regression's (0 = all 55 scripts pass).
set -u
SWEEP_DIR="${SWEEP16_DIR:-$HOME/workspace/.helix-bugsweep-sweep16}"
OUT_DIR="${OUT_DIR:-$HOME/workspace/.helix-e2e-conversion/battery-proof/regression}"
while [ $# -gt 0 ]; do
  case "$1" in
    --sweep-dir) SWEEP_DIR="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -x "$SWEEP_DIR/run-regression16.sh" ] || { echo "FAIL: no run-regression16.sh in $SWEEP_DIR" >&2; exit 1; }
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/regression.log"
echo "sweep dir: $SWEEP_DIR"
echo "log: $LOG"
bash "$SWEEP_DIR/run-regression16.sh" >"$LOG" 2>&1
RC=$?
cat "$LOG"
echo "REGRESSION: exit $RC (log: $LOG)"
exit "$RC"
