#!/bin/bash
# Sweep baseline as a battery-suite leg (inventory B-01).
#
# Runs the sweep-16 baseline: tsc clean + 8 legs (checks, cloud, prism,
# prism-write, pzfx-write, reference, parity, packages) — the script the
# sweep lane already runs (run-baseline16.sh), wrapped so the battery
# suite can invoke it as one leg with captured logs.
#
# Usage: bash e2e/battery/run-baseline.sh [--sweep-dir DIR] [--out-dir DIR]
#   SWEEP16_DIR env overrides the default sweep dir.
# Exit code is the baseline's (0 = tsc + all 8 legs green).
set -u
SWEEP_DIR="${SWEEP16_DIR:-$HOME/workspace/.helix-bugsweep-sweep16}"
OUT_DIR="${OUT_DIR:-$HOME/workspace/.helix-e2e-conversion/battery-proof/baseline}"
while [ $# -gt 0 ]; do
  case "$1" in
    --sweep-dir) SWEEP_DIR="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -x "$SWEEP_DIR/run-baseline16.sh" ] || { echo "FAIL: no run-baseline16.sh in $SWEEP_DIR" >&2; exit 1; }
mkdir -p "$OUT_DIR"
LOG="$OUT_DIR/baseline.log"
echo "sweep dir: $SWEEP_DIR"
echo "log: $LOG"
bash "$SWEEP_DIR/run-baseline16.sh" >"$LOG" 2>&1
RC=$?
cat "$LOG"
echo "BASELINE: exit $RC (log: $LOG)"
exit "$RC"
