# e2e/prism — real-Prism round-trip checks (T-132, T-137, B-07)

Conversion lane for Plane item seq 186. Smit's goal: zero manual testing;
the CI E2E suite is the gate. These three checks are the ones that need
REAL Prism 11 on the Mac — everything else in this directory is built to
run without it, so the Mac session (when the slot frees) is a single
execute-and-record pass.

**HARD DEADLINE: Prism 11 licence expires Dec 3, 2026 — the Mac run must
be DONE by Dec 2.** Reference captures live under
`~/workspace/.helix-prism-gap/` so the learning survives the expiry.

## Status

| Check | Built | Mac run |
|---|---|---|
| T-132 Prism round-trip (every Titer export in real Prism) | ✅ ready | ⏳ slot held by battery-rerun-162 (claimed 09:58 PT Nov 18) |
| T-137 round-trip sanity (Prism-native → Titer → Prism) | ✅ ready | ⏳ same slot wait |
| B-07 histogram-bin boundary rule | ✅ **SETTLED by docs** (see below) | numeric pin optional, same session |

## Files

| File | What it is |
|---|---|
| `RUNBOOK-MAC.md` | Exact claim/run/restore steps for the Mac session. Start here. |
| `run-prism-roundtrip.sh` | T-132 Mac runner: opens each file in Prism 11, records CLEAN / WARN / FAIL / CRASH (crash-tolerant, works on copies). |
| `verdict-table.py` | Turns a results dir into `verdicts.md` + `verdicts.json` (part3-verdicts.md shape). Verified on Hatch with synthetic records. |
| `pin-writer-fix.py` | File-level pre-fix FAIL / post-fix PASS pin for BUG-20/21 — runs WITHOUT Prism. Verified: FAILs 0/3 on pre-fix files (two 1.0.7 `.prism` + one 1.6.0-era `.pzfx`); PASSes 2/2 on this branch's writer output (via `make-postfix-exports.ts`). |
| `make-postfix-exports.ts` | Generates post-fix `.prism` + `.pzfx` from the writers on this branch (no build, no Prism) for the pin's PASS leg. |
| `reexport-part3.py` | T-132 List A generator: re-exports the 13 part-3 source stems from shipped 1.6.2 via MCP (needs MCP on). |
| `applescript/` | Vendored Mac drivers (probe-windows, click-button, close-doc-ax, doc-dump, save-as). The first four are byte-identical to the Nov 17 part-3 originals in `~/workspace/.helix-prism-gap/`; save-as is new. |
| `t137/make-random-csv.py` | Deterministic random-data CSV (seed 137) for the Prism-native project. |
| `t137/t137-titer.py` | T-137 Titer half (MCP): open Prism-native file, change one cell to sentinel 987654.321, save `.prism` + `.pzfx`, reopen-verify in Titer. |
| `t137/t137-prism-verify.sh` | T-137 Prism half: reopen Titer-saved files in Prism, Save As, offline-diff. |
| `t137/t137-diff.py` | Offline differ (sentinel present in both + value multisets agree). Verified: PASS on identical files, FAIL on a one-value mutation. |
| `b07-histogram-bins.md` | B-07 settled answer + Titer comparison + optional Prism 11 numeric pin. |

## Pins (no check ships that passes on broken code)

- **T-132:** the pre-fix baseline is the Nov 17 record itself
  (`~/workspace/.helix-prism-gap/part3-verdicts.md`: 12/12 `.prism` CRASH,
  12/12 `.pzfx` WARN). The 1.6.2 re-run must show the same corpus CLEAN.
  The file-level gate is `pin-writer-fix.py` (verified FAIL on pre-fix
  files, PASS on this branch's writer output), wired into the CI suite as
  `Suite.check_export_markers` in `e2e/mcp/suite.py` (called on every
  `.prism`/`.pzfx` export the suite saves — a writer regression fails the
  suite before the reopen leg can rubber-stamp it). The unit suite already
  pins both fixes directly (prism-write.ts W11, pzfx-write.ts BUG-21 check).
- **T-137:** the sentinel (987654.321) cannot occur in the fixture; the
  Titer half refuses to run on tables with excluded cells or capped rows,
  and reopens each saved file in Titer to verify the sentinel + that no
  other cell changed before the Prism half runs. The Prism half diffs
  Prism's resave against Titer's save — a silent drop fails loudly.
- **B-07:** settled by two independent GraphPad sources (see the file);
  the optional Mac pin is a confirmation, not the evidence.

## Baselines and rules

- Baseline to beat (Nov 17, 1.6.0-era exports, Prism 11.2.0 build 337):
  `.prism` 12/12 CRASH (SIGSEGV, `NSDocument initWithContentsOfURL`),
  `.pzfx` 12/12 WARN (XML-compliance dialog → Compatibility Mode, data
  intact). Control (real Prism-written `.prism`) opens CLEAN.
- Work on COPIES — Prism autosaves in place (Nov 18: a control file was
  autosaved over in ~25 min). Never open the only copy of a fixture.
- Never Mansi's files — public corpus / synthetic fixtures only.
- Prism is Standard Subscription (Pro features licence-walled — record
  what's blocked, don't re-prove the wall).

## B-07 answer (one line)

**Yes — Prism excludes values below the first bin** (bins are
`[center − width/2, center + width/2)`, lower-inclusive; below-first-bin
values are omitted, and a value exactly at the top edge fits neither bin
after the FAQ-1822 fix). Titer does the opposite: its bins are
`(lower, upper]`, first bin closed, no value ever dropped — a genuine
parity gap, recorded in `b07-histogram-bins.md` for the coordinator to
triage (any fix must re-pin T-20).
