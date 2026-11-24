# Plugin API — groundwork (v3 Phase 4, roadmap §4b + §5)

Branch `v3/plugin-api`. Groundwork only — no marketplace.

## What exists

| Piece | File | What it does |
|---|---|---|
| Manifest | `manifest.ts` | Schema + validation: id, name, version, apiVersion (semver), author, license, permissions. Unknown permission names rejected at install time. `titer.` ids reserved for first-party. Plain-language permission lines for install/review. `apiVersion` major compatibility → "needs Titer 3.x" disable message. |
| Parameters | `parameters.ts` | Parameter kinds reusing the app's existing kinds: choice (same shape as TAILS / CORRELATION_METHODS option lists), number (range + default, ROUT_Q-style), boolean, text, names, column. Defaults, range/option re-checks (the runner re-checks, as first-party wizards do). |
| Capabilities | `capabilities.ts` | Closed `titer.*` command catalogue (8 commands), one permission per command, fail-closed check. Only permissions granted at the enable review step count — a declared permission grants nothing until granted. |
| Analysis spec | `analysis-spec.ts` | Table types, parameters, serialisable wizard questions (choice/number/names/text; `"columns"` options resolve at ask time) + adapter to the wizard's own `Question` type. R compute contract: groups as `g0`, `g1`, … ending in a `c(name=value, …)` named vector (the `ColumnTestSpec` contract); packages only via the vendored repo; load-time denylist scan as a tripwire. JSON specs are R-only; TypeScript compute registers in code. |
| Registry | `registry.ts` | Plugin analyses under namespaced ids (`plugin:<plugin-id>:<analysis-id>`) so they can never collide with or shadow first-party analyses. `resolveAnalysis` covers both sources in one call. `runPluginAnalysis` mirrors `runAnalysis`: params resolve + re-check, packages install first via `ensurePackages`, R via `evalNamedVector`, pure-TS via `lib/summary`, failures as error outcomes. `runPluginAnalysisOnTable` (M4) is the cached entry point: same-keyed as first-party `runAnalysis` — one `WeakMap<TableData, Map<string, Promise<…>>>` per table version, errors not cached. The registry also tracks each plugin's installed version (`setPluginVersion` / `getPluginVersion`, set by the loader on enable) for the workflow-dependency check. |
| Loader | `loader.ts` | Folder/zip loading (JSZip, text files only). Install DISABLED by default → `requestEnable` (pending-review) → `confirmEnable` (granted subset) → enabled; disable unregisters at once; app-update recheck disables incompatibles with the clear message and never auto-enables. |
| Workflow dependency | `workflow-dependency.ts` | M4: a step declares its plugin dependency (`{ pluginId, versionRange? }`); `checkPluginDependency` reports a missing/disabled plugin as a "needs plugin X — install it?" notice (and a version mismatch as an update notice) instead of failing. The workflow engine does not exist yet — this is the utility it will call. |
| Isolation webview | `isolation.ts` + `isolation-view.tsx` | M5: the first execution path for plugin JS — a sandboxed `<iframe sandbox="allow-scripts">` (no `allow-same-origin`) running the plugin's entry source plus a `titer.*` bridge that only `postMessage`s calls to the host. `interceptPluginCall` inspects every call before it reaches the host, routing it through `dispatchPluginCommand` (ipc-guard.ts) with the plugin's granted permissions, fail-closed. `launchPluginWebview` refuses a non-enabled plugin (via M4's `checkPluginDependency`, reused — no third copy); `onPluginDisabled` / `onPluginUninstalled` tear the frame down at once, and the interceptor re-checks liveness against the live registry on every call. `createPluginHostRouter` maps granted commands to the app's host seams (the dispatch seam for table/analysis work, the Tauri dialog commands for file dialogs); a granted command with no handler wired fails closed. The honest line is the single shared string `PLUGIN_SAFETY_NOTICE`: a capability boundary, not a sandbox. |
| Product wiring | — | M4: the picker offers plugin analyses for the table types they apply to (`src/views/analyses/index.ts`, `pluginAnalysisOptionsForTable`), the wizard asks their parameters through the same Steps dialog (`plugin-wizard.ts` → `toWizardQuestions` + `answersToParams`), plugin analyses get persistent nodes (`pluginAnalysisId` / `pluginAnalysisParams` on `ProjectNode`), the results view accepts `PluginAnalysisResult`, and the MCP tools `titer_list_plugin_analyses` + `titer_run_plugin_analysis` (contract `docs/mcp-server-contract.md`) expose them to agents the same way the UI runs them. |
| Fixture | `examples/hello-analysis/` | `plugin.json` + `index.ts`: `hello-mean` (R, through the install path) and `hello-scaled-mean` (pure-TS, choice + ranged-number params, in code). `verifyHelloPlugin()` runs both on synthetic columns and checks the numbers. |

## What is deliberately NOT here

- No marketplace UI/server, listing/review flow, delayed auto-updates,
  safety scorecards, publisher verification, paid-plugin handling.
- Graph significance overlays do not read plugin results yet (a plugin
  node's cached result is not a first-party outcome — see
  `src/views/graphs/graph-figure.ts`); Change Parameters is not offered
  for plugin nodes, and MCP param overrides on a plugin node are refused
  (run it again with `titer_run_plugin_analysis` for new params).

## Blocked — assumed nothing

- **Q7 (paid plugins under GPL-3.0 — needs Smit + a lawyer):** no license
  allowlist, no paid handling, no marketplace cut. The license string is
  recorded verbatim and never judged.
- **Q8 (who reviews / hosting model):** no review queue, no listing flow,
  no hosted-vs-GitHub-index decision. The groundwork works the same under
  any of the three review models.

## Trust model (roadmap §4b, honest line)

There is no true JS sandbox in a desktop webview. The model is a
capability boundary, not a sandbox: the `titer.*` allowlist (fail closed),
permissions shown in plain language at install/review, install-disabled-
by-default with a review step, and computation contained in webR (R cannot
touch the filesystem or network except through the host bridge). The R
denylist scan in `analysis-spec.ts` is a load-time tripwire, not a
security proof.

## Verification status

- `npm run check` (tsc) — the verification that runs in this lane.
- Runtime: `verifyHelloPlugin()` + the R path through `evalNamedVector`
  are pinned in `tests/checks.ts` ("plugin-sdk hello" and the loader
  lifecycle check), whose runner boots the webR engine — M1 salvage,
  Nov 24, 2026. The manifest, registry-namespacing and loader-lifecycle
  pins live in the same file ("plugin-sdk manifest/registry/loader").
  The M4 product + MCP wiring is pinned in the same file ("plugin-m4
  picker/wizard/results-view/cache/mcp/workflow"), Nov 24, 2026.
  The M5 Isolation webview is pinned in the same file ("plugin-m5
  guard/lifecycle/copy/frame/host-router/seam"), Nov 24, 2026: the guard
  allow/deny cases, disabled-plugin teardown, the honest-line copy, the
  sandboxed frame document, the fail-closed host router, and the
  no-direct-seam static check.
- Rust touched (M4): two MCP tools in `src-tauri/src/mcp.rs`
  (`titer_list_plugin_analyses`, `titer_run_plugin_analysis`; 76 → 78
  tools, read/analyses allowlist groups) — the first Rust in this
  plugin work; the count pins in `mcp.rs` + `tests/mcp-coverage-180.ts`
  cover them.
