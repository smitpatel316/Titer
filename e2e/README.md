# e2e — Titer end-to-end tests in CI (check/e2e-ci)

Two layers, deliberately split. The regression suite is driven by MCP, not
by GUI clicks; WebdriverIO is a thin launch smoke only.

## The MCP regression suite — `mcp/` (the suite)

`suite.py` drives the built debug app through its in-process MCP server
(51 tools, Streamable HTTP) — the same driver pattern the readiness
battery uses: import → run analysis → export → reopen → verify. Identical
on Linux and Mac, no display-automation fragility. Stdlib-only Python
(`client.py` uses urllib; no third-party deps).

Cases and their pins (each guards a real bug class — exact values,
round-trip identity, or a negative control; no case ships that passes on
broken code):

| Case | Pin |
| --- | --- |
| `tools_list` | initialize + exactly 51 tools, all tools the suite needs present |
| `import_prism_demo` | exact 14-table name/type/rows multiset for `tests/testdata/prism/prism2R-demo_dataset.prism` |
| `roundtrip_hlx_demo` | save demo as `.hlx`, close, reopen — tables cell-identical |
| `import_pzfx_survival` | `tests/testdata/survival.pzfx` → 1 table, `Three groups`, survival |
| `logrank_pin` | log-rank on the survival table: χ² 4.844, df 2, p 0.08876 (the app's own wizard values for this file). Survival needs EXPLICIT params `{curveTest: logrank, correction: holm}` — the battery passed `{}` and got `undefined is not an object (evaluating 't.curveTest')` on every survival run |
| `roundtrip_prism_survival` / `roundtrip_pzfx_survival` | save as `.prism` / `.pzfx`, close, reopen — cell-identical |
| `negative_control_truncated` | a truncated `.hlx` export must fail to open |
| `negative_control_mutated_pzfx` | a one-cell mutation of the exported `.pzfx` must be visible on reimport AND flagged by the comparator — so a green round-trip cannot be a rubber stamp |
| `invalid_file_rejects` | a text file and a truncated `.prism` must reject plainly |

Round-trip comparison is a SORTED LIST of (name, type, rows, summary-hash),
not a (name, type) dict — the demo has two tables named `Data 6`, and a
dict would silently drop one (the battery's comparison has that hole; this
is the duplicate-name-merge bug class, BUG-1).

### Conversion case modules — wired into `suite.py` (check/e2e-conversion)

The E2E-conversion program (Nov 18, 2026; inventory
`~/workspace/.helix-e2e-conversion/inventory.md`, 308 checks) added three
modules, registered from `Suite.run()` after the ten cases above — the
suite is now 102 cases:

| Module | Cases | What it pins |
| --- | --- | --- |
| `cases_numeric.py` (seq 182) | 68 | QA-dataset numerics vs scipy + the T-15–T-51 numeric pins (logistic, interpolate, three-way, Bland-Altman, ROC, KS, enzyme MM, Cox PH, multilogit, Poisson, Deming, nested, spline/Lowess, binding, dose-special, mixed-effects, PCA, Monte Carlo, Grubbs, 4PL/3PL/5PL + EC50 compares, Welch ANOVA, GG correction, …). FAIL-pin proof: 0/68 pass with `NUMERIC_PIN_CHECK=1` (every expectation shifted +10%). 448 pins cross-checked against `tests/reference.json`. One pin has no reference backing: `t50` (two-way-anova noReplicates, posthoc `none`). Known MCP gap pinned, not waived: nested-t-test `sets` is unreachable (dispatch gate needs a 2-group table; Plane seq 246). |
| `cases_state.py` (seq 183) | 22 | State/dialog pins: Shapiro wizard, cancel-job, table types, clean quit, fresh-reads, open dedupe, closed-window jobs, import notice, HLX schema, first launch, launch isolation, CLI-arg (Q-77 — BLOCKED, no MCP surface for launch argv; the harness check is in the case detail), no-spurious-updated, batch magic, duplicate family, clone graph, summary subcolumns, error format, frozen orphaned, search/highlight. Mock-harness proof: 22/22 on the correct server, all 9 broken variants discriminate. Cases that hit a missing MCP surface record `BLOCKED: …` as a pass-with-detail in `report.json`, never a silent skip. |
| `cases_plotly_determinism.py` (seq 189) | 2 | Same-machine SVG repeat determinism: survival graph exported twice is byte-identical with the fixed ids (`defs-000000`, `trace000000`, …); two-panel figure exported twice is byte-identical with per-panel scopes (`clipp0`/`clipp1`, zero duplicate ids). Pins the `normalizePlotlySvg` fix in `src/views/graphs/plotly.ts` (exporter only; on-screen untouched). Pre-fix FAIL proven on the harness (`e2e/plotly-determinism/`): random ids + root-tag attribute-order flips. Cross-platform byte-equality is NOT asserted — screenshot tests keep the L8 similarity threshold. |

Fixtures are public corpus only (`tests/testdata/`) — NEVER Mansi's files.

Run it (needs the debug binary built first):

```sh
bash e2e/mcp/run.sh [--out-dir DIR]
```

`run.sh` launches the binary with a scratch app-data dir, waits for the
MCP discovery file (`<app-data>/mcp/discovery.json` — the app enables MCP
itself in the E2E build; see below), runs `suite.py`, kills the app, and
exits with the suite's code. Exports + `report.json` land in `e2e/out/mcp/`.
Linux needs a display (Xvfb); macOS needs none.

## Screenshot-similarity cases — `mcp/cases_screenshot.py` + `compare.py` (seq 184)

Visual checks MCP numbers can't cover, as similarity-threshold tests —
never byte-equality (L8 proved it doesn't hold: 95.804% PNG identity,
diffs from font rasterization + Plotly random ids; the accepted bar is
"data matches + images look similar"). Every case asserts GEOMETRY from
export pixels (bar bands, bracket runs, curve-vs-points column coverage),
not just whole-image similarity — a clipped graph can still be 95%
similar to its reference. Each case carries its own negative control on
real render pixels, so a green case has proven on that run that its
assertions discriminate.

- Comparator `e2e/compare.py` (stdlib-only; the L8 §5 rule): PNG % identical,
  mean abs diff, far/isolated pixel counts; SVG counts/texts + max numeric
  delta (±15 px bound). Self-test `e2e/compare_selftest.py`: 14/14 pins.
- References live ONLY under `qa/reference/` (see `qa/reference/REFERENCES.md`
  for provenance + the owed list). A case's geometry assertions run with no
  reference at all; only the similarity half SKIPs — loudly, never as a pass —
  while a reference is owed.
- 9 cases: the six direct screenshot checks (Q-20, Q-23, Q-31, Q-38, Q-39,
  Q-61) + L8 comparator cases (L-01, L-02, L-04, L-05, L-06) + determinism
  (L-07). The 7 human-eye checks (T-18, T-35, A-11, A-14, A-15, T-109, T-135)
  stay manual by design — see the inventory.

```sh
bash e2e/mcp/run-screenshot.sh            # live (needs the debug binary + display)
bash e2e/mcp/run-screenshot.sh --capture  # live + write Linux references into qa/reference/
bash e2e/mcp/run-screenshot.sh --offline  # L-01/L-02/L-04/L-05/L-06 only, no app
python3 e2e/mcp/cases_screenshot.py --self-test   # offline FAIL-pin proof, no app
```

Gridlines screenshots (G-01–G-14) run on the DEVICE, not over SSH — see
`e2e/mac/gridlines-g01-g12.md` (WKWebView AX collapses over SSH; 12 takes).

## The readiness battery, as a suite — `battery/` (seq 188)

The 233-file readiness battery's driver ported onto `e2e/mcp/client.py`
(checks Q-79–Q-82, Q-92, Q-99–Q-102; `aggregate.py` surfaces UNKNOWNs with
exit 1). See `e2e/battery/README.md`. Slice proof on shipped 1.6.0: 3 PASS,
1 PASS-REJECT, 1 FAIL (a genuine 1.6.0 bug — `.prism` reimport resurrects
excluded cells, BUG-10 class; re-test on 1.6.2 in the full run).

## Release / website / updater checks — `release/` (seq 187)

Static + live checks for T-88–T-93 (DMG/AppImage artifacts, channel
manifest, GitHub release, update feed, website). `bash e2e/release/run.sh`
→ PASS on v1.6.2; self-test 12/12 negative-control pins. Mac-owed legs
SKIP on Linux. See `e2e/release/README.md`.

## Prism round-trip — `prism/` (seq 186, urgent, deadline Dec 2)

Real-Prism round-trip drivers + the Mac runbook (`e2e/prism/RUNBOOK-MAC.md`,
~60–90 min when the Mac slot frees; the MCP toggle needs a click).
Prism 11 licence expires Dec 3, 2026 — everything needing real Prism is
done by Dec 2. Includes the T-137 Prism-native round-trip sanity check and
the B-07 histogram-bin finding (Prism excludes values below the first bin;
Titer does the opposite — genuine parity gap, recorded in
`e2e/prism/b07-histogram-bins.md`). See `e2e/prism/README.md`.

## Mac-owed runbooks — `mac/`

Checks that provably need the device (real-mouse quit CQ-05, MCP toggle
M-01, gridlines G-01–G-14, paste Q-03, real-focus Q-17/Q-24/Q-58/Q-68/Q-74,
updater gate T-87, About/Coffee S-01/S-02). One runbook each; claim the
Mac slot first (`~/workspace/.helix-mac-slot/claim.json`), release when done.

## The wdio specs — `specs/` (the GUI layer, seq 185)

Thirteen specs: the launch smoke (`launch.e2e.js` — app launches, main
window appears, `window.__titerE2E` hook, non-empty title) plus GUI-only
coverage MCP cannot reach (quit dialogs CQ-01–CQ-04, import picker/notice,
save chooser/extensions, update dialog, About/Coffee, AI Connections).
Each spec states why it is wdio, not MCP, in its header. Mac-owed legs
(real-mouse quit, real focus, updater gate) live as runbooks in `e2e/mac/`,
not as specs that would flake in CI.

Proves the built app launches and its main window appears (project window
found, app shell mounted via the `window.__titerE2E` hook, non-empty
document title). That is all the launch smoke proves — it is NOT the
regression suite; the regression suite is the MCP suite above.

The Convert spec that used to live here (`convert.e2e.js`) is RETIRED: it
passed 2/2 on the pre-fix build too, so it discriminated nothing. The
unit-test pin stays the regression test for the Convert-stall bug class.
Do not re-add a GUI spec that passes on broken code; new functional
coverage goes in `mcp/` with a pre-fix FAIL / post-fix PASS pin.

```sh
npm run e2e   # wdio run e2e/wdio.conf.js
```

Linux needs Xvfb (`Xvfb :99 -screen 0 1280x800x24 &`, `DISPLAY=127.0.0.1:99`).
macOS runs from a logged-in GUI session; the wdio config uses a scratch
app-data dir so the app's `~/Library/Application Support` never touches
real app data (the XDG vars in `wdio.conf.js` are ignored on macOS).

## CI — `.github/workflows/e2e.yml`

On push + pull_request. `fast-checks` (tsc + unit suite) runs as a
separate parallel job, OUT of the E2E job's critical path. `e2e-linux`
(ubuntu-latest) and `e2e-mac` (macos-latest) each: system deps, npm ci,
cargo + webr-repo caches, `build-stdio-bridge.sh` (the build fails
without the staged sidecar), `CARGO_BUILD_JOBS=1 npm run e2e:build`,
then the wdio smoke and the MCP suite. Warm-run target ~10 min cached;
the build dominates (cold 20–40 min, warm ~8 min). If a run lands far
above 10 min, the measured step times in the log are the evidence.

## Run locally

```sh
bash scripts/setup-linux.sh        # Linux deps (needs root; re-run after a container replacement)
bash scripts/build-webr-repo.sh    # bundled R packages (cached; downloads on miss)
bash scripts/build-stdio-bridge.sh # REQUIRED — build fails without the staged sidecar
CARGO_BUILD_JOBS=1 npm run e2e:build   # VITE_E2E=1 + tauri build --debug --no-bundle (needs >3 GB free, rustc ≤2)
Xvfb :99 -listen tcp -screen 0 1280x800x24 &   # Linux only
DISPLAY=127.0.0.1:99 npm run e2e   # wdio specs
bash e2e/mcp/run.sh                # MCP regression suite (102 cases)
bash e2e/mcp/run-screenshot.sh     # screenshot-similarity cases (live)
bash e2e/release/run.sh            # release / website / updater checks
```

## What the E2E build changes in the app (all debug/e2e-only)

- `src-tauri/Cargo.toml` + `src/main.rs`: `tauri-plugin-wdio` and
  `tauri-plugin-wdio-webdriver` as debug-only deps, registered under
  `#[cfg(debug_assertions)]`; the `wdio:default` capability is added at
  runtime in `setup()` so release builds never see the permission.
- `src-tauri/tauri.conf.json`: `withGlobalTauri: true` (required by the plugin).
- `src/main.tsx`: `import "@wdio/tauri-plugin"`, gated on `VITE_E2E=1` at
  build time (dead-code-eliminated otherwise).
- `src/components/app-shell.tsx`: `window.__titerE2E.openConverter()` hook
  (gated on `VITE_E2E=1`; native menus are not WebDriver-drivable, the menu
  chrome stays a manual Mac-proof item) AND the MCP auto-enable: in the E2E
  build only, AppShell calls `mcpSetEnabled(true)` on mount, so CI needs no
  GUI click to reach the MCP server. MCP stays OFF by default in the real
  build — never ship it on.
- `src/lib/tauri-core-e2e-shim.ts` + the `vite.config.ts` alias (both
  `VITE_E2E=1` only): routes `@tauri-apps/api/core` through a mock-consulting
  `invoke`, so `browser.tauri.mock()` intercepts the app's own invokes
  (a Vite-bundled frontend calls `__TAURI_INTERNALS__.invoke` directly,
  which the plugin cannot patch).

## Layout

- `wdio.conf.js` — wdio service config (embedded provider, scratch app-data dir).
- `specs/` — 13 wdio specs (launch smoke + quit/import/save/update/about/ai-connections).
- `mcp/client.py` — stdlib MCP client (initialize, tools/list, tools/call).
- `mcp/suite.py` — the regression cases + runner + report (102 cases: 10 original + 68 numeric + 22 state + 2 Plotly determinism).
- `mcp/cases_numeric.py`, `mcp/cases_state.py`, `mcp/cases_plotly_determinism.py` — conversion case modules (see above).
- `mcp/cases_screenshot.py` + `compare.py` + `compare_selftest.py` — screenshot-similarity cases + comparator + self-test.
- `mcp/run.sh` — launch the debug binary with a scratch data dir, wait for discovery, run the suite.
- `mcp/run-screenshot.sh` — same, for the screenshot cases (`--capture` / `--offline` / `--self-test`).
- `battery/` — readiness-battery driver on the shared MCP client + aggregator.
- `release/` — release/website/updater checks (T-88–T-93).
- `prism/` — real-Prism round-trip drivers + Mac runbook.
- `mac/` — Mac-owed runbooks (device-only checks).
- `plotly-determinism/` — Plotly nondeterminism harness (pre/post-fix proof).
- `out/` — temp outputs + suite report (gitignored).
- `.e2e-home/` / `.e2e-home-mcp/` — scratch app-data dirs (gitignored).
- `logs/` — wdio backend/frontend logs (gitignored).
