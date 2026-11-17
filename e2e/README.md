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

## The wdio launch smoke — `specs/launch.e2e.js` (the smoke)

Proves the built app launches and its main window appears (project window
found, app shell mounted via the `window.__titerE2E` hook, non-empty
document title). That is all it proves — it is NOT the regression suite.

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
DISPLAY=127.0.0.1:99 npm run e2e   # wdio launch smoke
bash e2e/mcp/run.sh                # MCP regression suite
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
- `specs/launch.e2e.js` — the launch smoke (the only wdio spec).
- `mcp/client.py` — stdlib MCP client (initialize, tools/list, tools/call).
- `mcp/suite.py` — the regression cases + runner + report.
- `mcp/run.sh` — launch the debug binary with a scratch data dir, wait for discovery, run the suite.
- `out/` — temp outputs + suite report (gitignored).
- `.e2e-home/` / `.e2e-home-mcp/` — scratch app-data dirs (gitignored).
- `logs/` — wdio backend/frontend logs (gitignored).
