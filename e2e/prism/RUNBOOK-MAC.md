# RUNBOOK — Mac execution for T-132 / T-137 / B-07 pin

**Status: READY-TO-RUN. The Mac slot is held by battery-rerun-162
(claimed 09:58 PT Nov 18) — do NOT start until the claim file is absent.
HARD DEADLINE: Prism 11 licence expires Dec 3, 2026 — everything here must
be DONE by Dec 2.**

Estimated wall time once the slot is yours: ~60–90 min total
(List A re-export ~10 min + List A Prism opens ~15 min + List B ~30 min
+ T-137 ~20 min + B-07 pin ~10 min). Run List A first (it is the fix
proof); List B and T-137 follow in the same session.

## 0. Preconditions (check from Hatch)

```sh
cat ~/workspace/.helix-mac-slot/claim.json   # must be ABSENT (no file)
ssh macbook 'ls /Applications/Prism\ 11.app' # Prism 11 present
ssh macbook 'pgrep -x Prism || echo prism-not-running'
```

- **Idle window (T-134):** drive the GUI only when Smit is idle. Run
  `bash ~/workspace/.helix-prism-gap/wait-mac-idle.sh` and wait for
  `IDLE-OK` (idle ≥ 900 s). SSH build/install work is fine anytime; the
  Prism opens and any Titer GUI toggle are idle-only.
- **MCP gate:** the shipped Titer 1.6.2 relaunches with MCP OFF (in-memory
  flag). `reexport-part3.py` and `t137-titer.py` need MCP ON — Smit's click
  on Settings → AI Connections, or the device route. The battery lane is
  blocked on the same toggle; if it is already on for the battery, reuse
  it — do NOT flip it off afterwards. The Prism opens (run-prism-roundtrip.sh)
  do NOT need MCP and can run even while MCP is off.

## 1. Claim the slot

```sh
cat > ~/workspace/.helix-mac-slot/claim.json <<'EOF'
{"lane": "e2e-conv-prism", "claimed_at_pt": "<YYYY-MM-DD HH:MM PT>",
 "purpose": "T-132 Prism round-trip (List A + List B), T-137, B-07 pin"}
EOF
```

## 2. Sync the scripts to the Mac (no repo disturbance)

```sh
cd ~/workspace/.helix-e2e-conversion/wt-prism
git fetch origin && git rev-parse origin/e2e-conv/prism   # confirm tip
scp -r e2e/prism macbook:~/prism-gap/e2e-prism
ssh macbook 'ls ~/prism-gap/e2e-prism/ && python3 --version'
```

## 3. T-132 List A — 1.6.2 re-exports of the part-3 corpus (needs MCP on)

```sh
ssh macbook 'python3 ~/prism-gap/e2e-prism/reexport-part3.py \
  --discovery ~/Library/Application\ Support/net.smitpatel.helix/mcp/discovery.json \
  --helix-dir ~/helix --out-dir ~/prism-gap/t132-list-a'
```

- Expect 26 files saved (13 stems × 2 formats). `syn-multiple-a` /
  `syn-nested-a` may come back REFUSED (the writer declines nested/multiple
  tables by design) — that is recorded in `reexport-report.json`, NOT a
  Prism verdict. If the count is lower, read the report before proceeding.
- Gate: `python3 e2e/prism/pin-writer-fix.py ~/prism-gap/t132-list-a`
  must print ALL PASS (the file-level BUG-20/21 pin). If it FAILs, STOP —
  the exports are pre-fix and the Prism run would re-prove the old bug.

## 4. T-132 List A — open in real Prism 11

```sh
ssh macbook 'bash ~/prism-gap/e2e-prism/run-prism-roundtrip.sh \
  ~/prism-gap/t132-list-a/part3-162-list.txt \
  --results-dir ~/prism-gap/t132-results-a'
```

- The runner opens COPIES (~/prism-gap/t132-copies/) — Prism autosaves in
  place; the 1.6.2 exports in t132-list-a are never opened directly.
- Watch the log: any CRASH records the .ips path. A STOP line (unexpected
  dialog / close failure) halts the loop — read the probe file, fix or
  record, resume by re-running with a trimmed list (delete done lines).
- Output: `~/prism-gap/t132-results-a/verdicts.md` + `verdicts.json`.
  **Pass bar:** every file CLEAN. Any WARN (compliance dialog still
  appearing) or CRASH is a fix failure — report it with the file + probe
  dump, do not wave it through.

## 5. T-132 List B — every battery Phase-1 export (if the battery has them)

```sh
# On the Mac, in the battery run dir (ask the battery lane for its path;
# Phase 1 exports live under ~/helix/.battery-mac/runs/.../exports/):
ssh macbook 'find <battery-run-dir> -name "*.prism" -o -name "*.pzfx" | sort > ~/prism-gap/t132-list-b.txt'
ssh macbook 'bash ~/prism-gap/e2e-prism/run-prism-roundtrip.sh \
  ~/prism-gap/t132-list-b.txt --results-dir ~/prism-gap/t132-results-b'
```

- If the battery lane has not produced exports yet, skip List B and note
  it — List A is the fix proof; List B is breadth.
- Same pass bar as List A.

## 6. T-137 — round-trip sanity (needs MCP on for the Titer half)

```sh
# 6a. Prism-native project: import the CSV into Prism, run one analysis.
ssh macbook 'cp ~/prism-gap/e2e-prism/t137/t137-random-data.csv ~/prism-gap/t137-random-data.csv'
```

Build the Prism-native project by hand in Prism (10 min, documented
route — the import dialog scope is in part3-verdicts.md §0):

1. Prism: File > New Project (Column table). File > Import Data…,
   type-ahead `t137-random-data.csv`, Import → the 5-tab "Import and
   Paste Special Choices" dialog; defaults are fine (Import button).
   The CSV lands as a Column table (Group/Value).
2. Analyze → Descriptive statistics (any one analysis — it only needs to
   EXIST so the project carries an analysis node). OK with defaults.
3. File > Save As… → `~/prism-gap/t137/t137-prism-native.prism`.
   **Work on this file from here on; keep a pristine copy:**
   `cp ~/prism-gap/t137/t137-prism-native.prism ~/prism-gap/t137/t137-prism-native.PRISTINE.prism`
   (Prism autosaves — never open the only copy).

```sh
# 6b. Titer half: open in Titer, change one cell to 987654.321, save both formats.
ssh macbook 'python3 ~/prism-gap/e2e-prism/t137/t137-titer.py \
  ~/prism-gap/t137/t137-prism-native.prism \
  --discovery ~/Library/Application\ Support/net.smitpatel.helix/mcp/discovery.json \
  --out-dir ~/prism-gap/t137'
# Expect: TITER-HALF-PASS, t137-titer-report.json, t137-modified.prism/.pzfx

# 6c. Prism half: reopen the Titer-saved files in Prism, Save As, diff.
ssh macbook 'bash ~/prism-gap/e2e-prism/t137/t137-prism-verify.sh ~/prism-gap/t137'
# Expect: T137-PRISM-HALF-PASS, t137-prism-report.json.
# The .prism variant is the BUG-20 fix verification from the other direction:
# if Prism crashes opening t137-modified.prism, the fix did NOT hold.
```

## 7. B-07 numeric pin (optional, ~10 min, same session)

Procedure in `e2e/prism/b07-histogram-bins.md` (§Prism 11 numeric pin):
Column table `1, 5, 15, 25`; frequency distribution, first bin center 10,
width 10, last center 20. Expect counts `1, 1` (1 and 25 excluded).
Save the results-sheet dump + screenshot under `~/prism-gap/b07/` and
record the verdict in the b07 file (copy it back with the rest).

## 8. Copy back to Hatch + close-out

```sh
scp -r macbook:~/prism-gap/t132-results-a macbook:~/prism-gap/t132-results-b \
  macbook:~/prism-gap/t137 ~/workspace/.helix-prism-gap/
scp -r macbook:~/prism-gap/b07 ~/workspace/.helix-prism-gap/ 2>/dev/null || true
# Then, on Hatch, commit verdicts.md + reports into branch e2e-conv/prism.
```

Close-out:

- Prism: leave running with 0 windows, or quit cleanly
  (`osascript -e 'tell application "Prism" to quit'`) — no doc windows
  left open either way. Never rapid-close windows via AX.
- Titer: do NOT touch the shipped install, do NOT flip MCP off (the
  battery lane may still need it), do NOT restore anything — nothing was
  installed or replaced by this lane.
- Delete the Mac scratch: `~/prism-gap/t132-copies/`, `~/prism-gap/t137/prism-copies/`
  (copies only — the results, reports and resaves stay). Keep
  `~/prism-gap/e2e-prism/` until the branch merges, then remove.
- Release the slot: `rm ~/workspace/.helix-mac-slot/claim.json`.
- Report: verdict counts per list (CLEAN/WARN/FAIL/CRASH), T-137 status,
  B-07 pin verdict, anything blocked.

## If the slot is still held when you arrive

Do NOT wait idle. The build work is done; the run is the only remaining
step. Report READY-TO-RUN with this runbook's step numbers and leave.
