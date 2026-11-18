# e2e/battery — readiness battery adopted into the E2E suite

Plane seq 188. Smit's goal: zero manual testing; the CI E2E suite is the
gate. This directory adopts the readiness battery driver
(`battery-full-loop`, 233 files on shipped 1.6.0/1.6.1) into the suite —
same loop, same verdicts, same JSONL/progress.json shape — plus the
battery-adjacent checks as suite assertions.

## Files

| File | What it is |
|---|---|
| `runner.py` | The battery driver, ported onto `e2e/mcp/client.py`. Per file: import → run the analyses the data supports → export .hlx/.pzfx/.prism → re-import each → cell-verify (column names AND values) + re-run analyses and compare result hashes. Verdicts: PASS / FAIL / PARTIAL / FAIL-IMPORT / FAIL-SNAPSHOT / PASS-REJECT. |
| `checks.py` | Battery-adjacent checks as assertions: Q-79 corpus snapshot, Q-80 analysis list from code, Q-81 writer coverage, Q-82 build identity, Q-92 expected-reject (live), Q-99 triage audit, Q-100 duplicate-name matching, Q-101 env-recovery playbook, Q-102 busy-window probe. |
| `aggregate.py` | Q-85: slice verdict aggregation + per-file table (`aggregate.json` + `aggregate.md`) from a run dir. |
| `test_sse_decode.py` | Q-94 pin, no app needed: the old latin-1 + `splitlines()` decode fails on the exact FAIL-SNAPSHOT payload; the fixed UTF-8 / split-on-`\n`-only decode parses it. |
| `run-slice.sh` | Run the runner over a manifest against a live MCP endpoint, then aggregate. |
| `run-baseline.sh` / `run-regression.sh` | B-01/B-02: sweep baseline + regression as suite legs (wrappers over the existing sweep-16 scripts). |
| `launch-appimage.sh` | Proof-only launcher: shipped 1.6.0 under its own Xvfb :97 + scratch XDG dirs, MCP via the GUI toggle. Not a CI path (CI uses the E2E debug build, where MCP auto-enables). |
| `slice-5.json` | Adoption proof slice (5 files). |

## Adoption differences vs the original driver

Each is a named fix for a hole the battery found:

- **SSE decode (Q-94):** `e2e/mcp/client.py::parse_sse_payload` decodes
  raw bytes as UTF-8 and splits on `'\n'` only. The original
  latin-1 + `splitlines()` chopped 0x85 bytes (U+2085 in "ΔOD₅₉₅ (µM)",
  Cyrillic U+0445) and FAIL-SNAPSHOT'd 3 files. Pinned by
  `test_sse_decode.py` (old algorithm fails, new one parses).
- **Table matching (Q-100):** snapshots are sorted lists keyed by stable
  table id with occurrence-index pairing inside each (name, type) group —
  never a (name, type) dict (the demo has two "Data 6" tables; the
  battery's dict dropped one).
- **FAIL-SNAPSHOT is a verdict, not a swallowed error (Q-94):** a
  snapshot-stage exception is logged and recorded; the original driver
  swallowed it, which is how the 3 FAIL-SNAPSHOT files reached
  aggregation with only a `start` event and no verdict.
- **Triage recording (Q-99):** every planned variant ends as ran /
  not-run with the app's own reason; "not offered for \<type\> tables"
  short-circuits the rest of that type.
- **progress.json de-duplicated by file** (the original appended, so
  re-runs left duplicate entries the battery had to dedupe by hand).
  Shape unchanged.
- **wait_tables_stable raises on timeout** instead of returning silently
  on a stale snapshot (blank-project `[Table 1]` guard kept).

## Pins (no check ships that passes on broken code)

- UTF-8 SSE: `test_sse_decode.py::test_old_decode_fails` (pre-fix FAIL)
  vs `test_new_decode_parses_failing_title` (post-fix PASS).
- Duplicate names: `checks.py::q100_duplicate_matching` — two "Data 6"
  tables must pair both, content-identically, by stable id.
- Round-trip identity: the runner's cell comparison includes column
  names (the MitoFactory → "MitoFactory 2" rename, battery BUG-4,
  slipped through the original values-only comparison).
- Expected-reject: `checks.py::q92_expected_reject` — the 3 edge files
  must reject with a plain-language error, not import.
- Slice proof: `slice-5.json` — the two syn-edge-cases files are the
  live FAIL-SNAPSHOT pin (they failed 3/3 under the old driver); they
  must complete under this runner.

## Run it

```sh
# Unit pin + static checks (no app):
python3 e2e/battery/test_sse_decode.py
python3 e2e/battery/checks.py --repo . --coverage \
  ~/workspace/.helix-owed-items/battery-corpus/coverage-final.json \
  --only Q-79,Q-80,Q-81,Q-100

# Live slice (needs a running app with MCP on — see below):
bash e2e/battery/run-slice.sh --discovery <path/to/discovery.json>

# Sweep legs:
bash e2e/battery/run-baseline.sh     # B-01: tsc + 8 legs
bash e2e/battery/run-regression.sh   # B-02: 55 cycle-1..15 repros/probes
```

Live app, Hatch-side proof only (do NOT use for the full 233 — the
battery-rerun lane owns the live re-run):

```sh
bash e2e/battery/launch-appimage.sh   # shipped 1.6.0, own Xvfb :97
# …verify the MCP switch in battery-proof/app-160/shot-settings.png…
bash e2e/battery/run-slice.sh --discovery \
  ~/workspace/.helix-e2e-conversion/battery-proof/app-160/.e2e-home-battery/data/net.smitpatel.helix/mcp/discovery.json
```

Mac runs of the adopted battery happen later (this lane must NOT take
the Mac slot — battery-rerun-162 holds it). On the Mac, export paths
must be ABSOLUTE (the Mac app's cwd is `/`, so a relative `--out-dir`
makes `titer_save_project` fail ENOENT on all three formats), and the
AI Connections toggle position varies per launch — verify the switch
state functionally (discovery.json + LISTEN 127.0.0.1:18741 + 51 tools),
never click blind.

## Manual remainder — NOT automated (by design)

- **Q-93** FAIL→BUG attribution triage: mapping a FAIL file's `bugs=1`
  to BUG-1..BUG-11 needs reading that file's diffs/exports — judgment,
  not a check.
- **P-05** crash .ips inspection + UNKNOWN verdict-format triage:
  reading a crash report and reconciling inconsistent verdict formats
  is triage. `aggregate.py` surfaces UNKNOWNs explicitly (exit 1)
  instead of guessing.

## Notes for the full-battery conversion

- Full 233-file runs use the same manifests the battery used
  (`battery-full-loop/work/files-manifest.json`, `--start/--count`
  slices, `--plan coverage-final.json`); resume from `progress.json`.
- The runner asserts exactly 51 MCP tools at initialize.
- Never run against the live battery re-run's app/discovery — it would
  inject foreign projects into its run. Use your own launch.
