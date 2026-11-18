#!/bin/bash
# T-137, Prism half — reopen the Titer-saved files in real Prism 11, Save As
# from Prism, then offline-diff Prism's resave against Titer's save.
#
# Runs ON THE MAC, under the Mac slot (see ../RUNBOOK-MAC.md), AFTER
# t137-titer.py has produced t137-modified.prism + t137-modified.pzfx.
#
# Works on COPIES of the Titer-saved files (Prism autosaves in place — the
# Nov 18 incident overwrote a control file in ~25 min; the pristine
# Titer-saved files must survive for the diff). The Prism resaves land in
# the same dir; t137-diff.py compares them.
#
# Usage (on the Mac):
#   bash e2e/prism/t137/t137-prism-verify.sh <t137-dir>
#     t137-dir holds t137-modified.prism, t137-modified.pzfx and
#     t137-titer-report.json (from t137-titer.py).
# Exit 0 = both formats: sentinel present in Prism's resave + value
# multisets agree with Titer's save. Writes t137-prism-report.json.
set -u
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRIPTS="$REPO/e2e/prism/applescript"
DIR="${1:-}"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "FAIL: t137 dir missing: $DIR" >&2; exit 2; }
COPYDIR="$DIR/prism-copies"
mkdir -p "$COPYDIR"
LOG="$DIR/t137-prism.log"
: > "$LOG"
echo "T-137 Prism half started $(date)" | tee -a "$LOG"

overall=0
for fmt in prism pzfx; do
  src="$DIR/t137-modified.$fmt"
  [ -f "$src" ] || { echo "FAIL: missing $src" | tee -a "$LOG"; overall=1; continue; }
  cp "$src" "$COPYDIR/t137-modified.$fmt"
  target="$COPYDIR/t137-modified.$fmt"
  resaved="$COPYDIR/t137-prism-resaved.$fmt"
  rm -f "$resaved"
  echo "== $fmt: open $target in Prism" | tee -a "$LOG"
  open -a "Prism 11" "$target"
  sleep 10
  if ! pgrep -x Prism >/dev/null 2>&1; then
    echo "  CRASH: Prism died opening Titer-saved .$fmt" | tee -a "$LOG"
    echo "{\"format\": \"$fmt\", \"verdict\": \"CRASH\"}" > "$DIR/t137-prism-$fmt.json"
    overall=1
    sleep 2
    continue
  fi
  osascript "$SCRIPTS/probe-windows.applescript" > "$DIR/t137-$fmt.probe.txt" 2>&1
  if grep -q "subrole=\[AXDialog\]" "$DIR/t137-$fmt.probe.txt"; then
    if grep -q "BTN: Open" "$DIR/t137-$fmt.probe.txt"; then
      echo "  dialog: compliance -> click Open" | tee -a "$LOG"
      osascript "$SCRIPTS/click-button.applescript" "Open" >> "$DIR/t137-$fmt.probe.txt" 2>&1
      sleep 5
    elif grep -q "BTN: OK" "$DIR/t137-$fmt.probe.txt"; then
      echo "  dialog: info -> click OK" | tee -a "$LOG"
      osascript "$SCRIPTS/click-button.applescript" "OK" >> "$DIR/t137-$fmt.probe.txt" 2>&1
      sleep 5
    fi
  fi
  # Save As from Prism (same folder as the open copy).
  out=$(osascript "$SCRIPTS/save-as.applescript" "t137-prism-resaved.$fmt" 2>&1)
  echo "  save-as: $out" | tee -a "$LOG"
  if ! echo "$out" | grep -q "SAVE-AS-OK"; then
    echo "  FAIL: Save As did not complete" | tee -a "$LOG"
    echo "{\"format\": \"$fmt\", \"verdict\": \"FAIL\", \"reason\": \"save-as failed: $out\"}" > "$DIR/t137-prism-$fmt.json"
    overall=1
  else
    sleep 2
    if [ -f "$resaved" ]; then
      echo "  resaved: $resaved ($(stat -f%z "$resaved" 2>/dev/null || stat -c%s "$resaved") B)" | tee -a "$LOG"
    else
      echo "  FAIL: resaved file not found at $resaved" | tee -a "$LOG"
      echo "{\"format\": \"$fmt\", \"verdict\": \"FAIL\", \"reason\": \"resaved file missing\"}" > "$DIR/t137-prism-$fmt.json"
      overall=1
    fi
  fi
  osascript "$SCRIPTS/close-doc-ax.applescript" > "$DIR/t137-$fmt.close.txt" 2>&1
  sleep 2
  if [ -f "$resaved" ]; then
    if python3 "$REPO/e2e/prism/t137/t137-diff.py" "$src" "$resaved" | tee -a "$LOG"; then
      echo "{\"format\": \"$fmt\", \"verdict\": \"PASS\", \"resaved\": \"$resaved\"}" > "$DIR/t137-prism-$fmt.json"
    else
      echo "{\"format\": \"$fmt\", \"verdict\": \"FAIL\", \"reason\": \"diff failed\"}" > "$DIR/t137-prism-$fmt.json"
      overall=1
    fi
  fi
done
python3 - "$DIR" "$overall" <<'EOF' | tee -a "$LOG"
import json, sys
from pathlib import Path
d, overall = Path(sys.argv[1]), int(sys.argv[2])
rep = {"formats": {}}
for fmt in ("prism", "pzfx"):
    p = d / f"t137-prism-{fmt}.json"
    rep["formats"][fmt] = json.loads(p.read_text()) if p.is_file() else {"verdict": "FAIL", "reason": "no record"}
rep["status"] = "T137-PRISM-HALF-PASS" if overall == 0 else "T137-PRISM-HALF-FAIL"
(d / "t137-prism-report.json").write_text(json.dumps(rep, indent=2) + "\n")
print(json.dumps(rep, indent=2))
EOF
echo "T-137 Prism half done $(date) — overall=$overall" | tee -a "$LOG"
exit "$overall"
