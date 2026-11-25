# Titer (Helix) Bug Report — Round 2

Review of `smitpatel316/Helix` (Titer) at `HEAD` `d44c1da` (v1.9.0+ / post-M5 Marketplace) with **67 verified findings** (**43 High**, **21 Medium**, **3 Low**).

## Round 1 Status (28 prior issues from `85f6c91`)

**27 of the 28** issues from the Round 1 report are completely **FIXED** at `d44c1da` (Issues #1–#27 fixed; Issue #28 parts 2–4 fixed). **1 item carries over** into this report as Issue #67 (`columnsBeyond` in `src/views/tables/table-data.ts:161-164` still omits `isNested(data)`).

---

## Summary of Findings

| # | Severity | Area | Issue Title |
| :- | :--- | :--- | :--- |
| 1 | **High** | Native IPC / Security | Unrestricted AppleScript execution (RCE), arbitrary file deletion, and ungated file moves in new shell IPC commands |
| 2 | **High** | Cloud / Security | Arbitrary file read via unvalidated `provider` path traversal in `cloud_read_cache` |
| 3 | **High** | Cloud / Security | OAuth browser URL allowlist bypass in `open_browser_url` / `open_url` via userinfo (`@`) |
| 4 | **High** | Plugins / Security | Plugin permission UI spoofing in `permissionChoices`: non-canonical permission order swaps checkbox labels and grants the wrong capability |
| 5 | **High** | Plugins / Security | Plugin capability revocation bypass: disabling/uninstalling a plugin never tears down its Isolation session, letting re-enable retain revoked permissions |
| 6 | **High** | Plugins / Security | Plugin static-gate bypasses (`__TAURI_INTERNALS__` regex typo, `Function()`, R backtick/dynamic dispatch) and `.GlobalEnv` escape in shared WebR |
| 7 | **High** | Plugins / Security | Path traversal in `manifest.entry` / zip-slip entries in `loadPluginFromZip`, plus unverified manifest ID/version on marketplace install & update |
| 8 | **High** | Server / Security | Feedback server global rate limit can be exhausted by a single per-IP blocked attacker, plus unbounded rate-limiter maps and dedupe TOCTOU race |
| 9 | **High** | Cloud Sync | Cloud conflict "Overwrite" always fails (`expectedVersion ?? handle.version`), while offline-opened remote files silently overwrite remote edits |
| 10 | **High** | Cloud Auth | Concurrent Box token refresh deletes fresh single-use tokens and signs user out; deleted tokens leave permanent zombie accounts |
| 11 | **High** | Plugins / Isolation | `PluginIsolationWebview` is non-functional in both dev (`<StrictMode>` teardown) and release builds (Tauri CSP blocks `srcDoc` inline `<script>`s) |
| 12 | **High** | Marketplace / Plugins | Enabled marketplace plugins are never re-registered into the live plugin registry on app restart |
| 13 | **High** | UI / Scripts | `ScriptDialog` crashes React on opening File ▸ Run Script… (conditional `useState` after early `return null`) |
| 14 | **High** | UI / Wizard | `AnalysisWizard` crashes with uncaught `TypeError` on Change Parameters… (`⌘T`) whenever a wizard has 0 questions for the current table |
| 15 | **High** | UI / Analyses | `AnalysisView` Cancel button and elapsed-time/queue display are unreachable dead code while an analysis is running |
| 16 | **High** | UI / Import | `ImportDialog` overwrites the parent table when "Create a new table" is shown selected (`insertionPoint === null`), drops all edits on `Enter` (stale closure), and strips the whole file as Info/Notes on `fromRow` |
| 17 | **High** | Graphs / Store | Freezing a graph does not freeze it — `mergedGraphData` always reads live `parent.data` and overrides `frozenData` |
| 18 | **High** | Store / Duplicate | `duplicateFamily` fails to remap analysis links in cloned graphs, binding duplicated graphs to the original table's analyses |
| 19 | **High** | Store / Document | `use-document.ts` reads stale `latest.current` immediately after `dispatch`, dropping `runOnClose` script changes on close and skipping crash-recovery backup refresh in `revertToSaved` |
| 20 | **High** | Project File | Save/load round-trip regressions in `project-file.ts`: frozen graphs/figures always reopen `updated: true`, blank/image figure panels trigger false "missing graph" warnings, and `rootOrder`/`orphanedDataSet` mismatches |
| 21 | **High** | Calculated Variables | `calcvars.ts`: `NOT` binds tighter than comparisons/arithmetic (inverting `WHERE NOT …` and `IF(NOT …)`), and `renameVariableInFormula` writes unbracketed names (breaking formulas or silently substituting `Math.E`/`Math.PI`) and corrupts scientific notation |
| 22 | **High** | Calculated Variables | `calcvars.ts`: stale `rawTextAt` for chained calculated variables (`COUNTA`, `OVER`), silent wrong/blank results for expression aggregates (`MIN(A+B)`, `MEAN(A+B)`), and `RANK` returning `0.5` on excluded rows |
| 23 | **High** | Tabular Import | `.xlsx` import misclassifies custom number formats containing `[Red]`, currency codes, or unit suffixes (`"nM"`, `"mg/mL"`) as dates — silently corrupting numeric data into 1900-era date strings |
| 24 | **High** | Tabular Import | `.xlsx` / CSV importer corrupts rows on self-closing `<row .../>` and `<t/>` tags, crashes on malformed attributes/entities, and overflows the call stack before `MAX_IMPORT_ROWS` truncation |
| 25 | **High** | Prism `.prism` Import | `.prism` import drops `summaryFormat` on grouped summary tables (treating Mean/SD/N as raw replicates) and fails to sanitize `:` or pad ragged subcolumns |
| 26 | **High** | Prism `.prism`/`.pzfx` Export | Native Titer XY replicate (`A:Y1`, `A:Y2`) and XY summary (`A:Mean`, `A:SD`, `A:N`) tables lose their grouping, `summaryFormat`, and nonlinear-regression dataset links in both `.prism` and `.pzfx` exports |
| 27 | **High** | Vector Export (EPS) | EPS vector export produces invalid/corrupted PostScript (`nocurrentpoint` crash on text + leaked `clip` path) |
| 28 | **High** | Vector Export (PDF) | PDF vector export corrupts all non-ASCII text (`−`, `R²`, `±`, `µM`, `°C`, `×`) by writing UTF-16BE bytes into single-byte Type1 `Tj` streams |
| 29 | **High** | Vector Export (PDF/EPS) | Vector PDF/EPS export silently ignores Plotly CSS `px` units (`font-size`, `stroke-width`, `stroke-dasharray`), erases parent `<g>` opacity, and `grayscaleFigure` rewrites series labels matching CSS color names |
| 30 | **High** | Vector Export (Figures) | Multi-panel Figure vector PDF and EPS exports are shrunk to 75% (`0.75×`) of configured physical dimensions |
| 31 | **High** | Graphs (Grouped) | `grouped-bars-scatter` ("Bars with individual points") plots numeric scatter X coordinates on a categorical X axis and duplicates points/legend entries |
| 32 | **High** | Graphs (Summary) | Summary tables draw no SEM error bars on `"mean-sem"` tables and drop asymmetric lower error bars (`errorMinus`) on XY summary graphs |
| 33 | **High** | MCP Server | `titer_read_results` returns stale cached results after table mutations and returns `not_computed` for frozen/orphaned/cloned analyses with saved `cachedResult` |
| 34 | **High** | MCP / Param Validation | `validateAnalysisParams` omits 11 per-analysis enum narrowings from `analysis-params-schema.json`, allowing cross-family params that silently run the wrong statistical test or crash R |
| 35 | **High** | XY Graphs / Overlays | `addFittedCurve` draws all-`NaN` curves (no line rendered) for every multi-Y (`params.ys`) and curve-comparison (`params.compareWith`) nonlinear regression |
| 36 | **High** | XY Stats (Nonlinear) | Raw-X sigmoidal models (`sigmoidal-4pl-x`, `absolute-ic50-x`, `asymmetric-5pl-x`, `agonist-4pl-normalized-x`) force `Y = Bottom` (or `0`) at `X = 0` in R even when `HillSlope < 0`, corrupting falling-curve fits and disagreeing with TS `evaluate()` |
| 37 | **High** | XY Stats (Nonlinear) | `applyFitOptions` (`transformNlsCall`) silently strips built-in `lower=`/`upper=` bounds on 17+ models whenever weights, fixed params, bounds, or robust/Poisson IRLS are used — and crashes on `logistic-growth` / `gompertz-growth` |
| 38 | **High** | XY Stats (Nonlinear) | Weighted, robust, and Poisson fits on log-Y models (`semilog-y-log`, `log-log-line`, `exponential-growth-log`) compute `R²` by dividing `log(Y)`-scale SS by raw `Y`-scale SST, and Poisson IRLS uses `1/log(Y)` weights |
| 39 | **High** | XY Stats (Nonlinear) | `ecAnything` crashes R (`subscript out of bounds`) when `params.ecx` is requested on competition models, and `runGlobalNonlinear` mislabels shared `IC50`/`IC50Hi`/`LogKd` midpoints as `"EC50"` |
| 40 | **High** | XY Stats (User-Defined) | `user-defined.ts` accepts R reserved keywords (`NA`, `Inf`, `NULL`, `TRUE`, `for`, `in`, …) causing R syntax errors, and naming a parameter `HillSlope` causes the fitted curve overlay to render nothing (all `NaN`) |
| 41 | **High** | Multiple Stats | Multiple Linear Regression (`multiple-regression.ts`) miscomputes VIFs, crashes with R syntax error when only categorical predictors are present, and passes raw unaligned columns to `describe()` |
| 42 | **High** | Grouped Stats | Three-way ANOVA Games–Howell post-hoc crashes R (`object 'Infinity' not found`) when compared cells have zero variance (identical replicates) |
| 43 | **High** | Sample Size & Power | Sample Size & Power `solveEffect` fails for all valid effects in the upper doubling band (e.g. Pearson `r ∈ (0.8, 1)`, one-proportion `h ∈ (1.6, π]`, t/ANOVA/χ² `∈ (6.4, 10]`), and `power <= alpha` returns bogus `effect ≈ 0` |
| 44 | **Medium** | Tauri Capabilities | Missing `core:window:allow-hide` and `core:window:allow-set-focus` capabilities silently break BUG-12 close-quiesce mitigation and non-macOS Window menu switcher |
| 45 | **Medium** | Cloud Auth (Box) | Box OAuth loopback flow has bind-after-open race, aborts on single non-callback socket, blocks Tokio worker, and leaks thread/port on timeout |
| 46 | **Medium** | Auto-Updater | Auto-updater `download_update` and `apply_update` block the macOS main thread and accept arbitrary HTTPS URLs / unverified bundles |
| 47 | **Medium** | MCP Server | Failed `titer_open_project`, `titer_import_prism`, `titer_create_project`, and `titer_cloud_download` leak a blank window and hijack `last_published` |
| 48 | **Medium** | Export / Paths | Export tools fail with `"Titer can't access <path>"` whenever the output filename contains a dot (e.g. `Fig 1.2`) or on Windows paths with a dot in a parent directory |
| 49 | **Medium** | MCP Schema | `analysis-params-schema.json` omits `"none"` from `posthoc` enum for `nested-anova`/`multifactor-anova`, marks defaulted params required for `two-way-anova`/`rm-anova`, and duplicates `"xy"` in `nonlinear-regression.offered_on` |
| 50 | **Medium** | Graphs / Figures Export | `titer_export_all_graphs` and Figure exports omit `deps.run` / `rootOrder`; `buildGraphFigure` diverges from `GraphView` (drops `sourceTableIds`, `frozenData`, `sigAnalysisIds`, number/date formatting) |
| 51 | **Medium** | XY Graphs / Overlays | Replicate XY tables break `deming-overlay.ts` & `binding-curve.ts` overlays; `addLogisticCurve` queries three nonexistent stat labels (always displaying `—`) |
| 52 | **Medium** | Store / Transforms | Renaming a column/group blanks dependent `% of control` transformed tables, edits overwrite frozen transformed tables, and `followTable` misses newly added column-name fields |
| 53 | **Medium** | Tables / CalcVars | `permuteColumns`, `dropColumns`, and `removeCalculatedVariable` corrupt or leak `cellBackgrounds`, `linkedPaste`, `calculated`, `decimals`, `variableTypes`, `labelVariable`, and `levelOrder` |
| 54 | **Medium** | Data Grid / Clipboard | Copying cells in Titer and pasting via Paste Special (default options) inserts a spurious column-header row |
| 55 | **Medium** | Prism `.pzfx` Import | `.pzfx` XML parser scrambles mixed-content `<Title>`/`<d>` tags (`H<Sub>2</Sub>O` → `"HO2"`), drops `<Font>`-wrapped `<Info>` text, double-decodes CDATA, and matches closing-tag prefixes |
| 56 | **Medium** | Prism Import | Scientific-notation comma-decimal numbers (e.g. `"4,096e+007"`, `"1,5e-3"`) are not normalized in `.pzfx` or `.prism` import and are silently dropped as non-numeric text |
| 57 | **Medium** | Prism Scripts | `prism-script.ts`: `DuplicateDataTable Clear` leaks phantom exclusions, `Import` at `row = 0` drops first CSV row, Survival tables mis-index Y columns by 1, `ExportTable All` without `SetPath` targets `/`, and script table mutations leave calculated variables & transformed tables stale |
| 58 | **Medium** | Prism Graph Regen | `applyRegenDecisions` mutates the project before validating later decisions (creating duplicate graphs on retry), and `mapSidecarGraph` ignores summary formats on grouped `.prism` tables |
| 59 | **Medium** | Multi-Table Graphs | `mergeGraphTables` skips the `summaryFormat` mismatch check for XY tables and silently drops extra Nested tables whose name contains `:` |
| 60 | **Medium** | Prism `.prism` Import | `.prism` import destroys line breaks in Info Sheet `notes` via `plainTitle()` and lacks bounds/type guards on malformed `document.json` / `content.json` and large row/column spreads |
| 61 | **Medium** | Stats Report | `report/conclusion.ts`, `report/checks.ts`, and `report/analyzed.ts` produce inverted/misleading conclusions and assumption checks (FDR `multiple-t-tests` always concludes "no difference", `compareModel` prints `"Y" and "undefined"`, `chi-square` trend uses omnibus Pearson P, `checks.ts` ignores weights & replicates, `analyzed.ts` ignores `chi-square` `sets` and misreports MV `linear-regression` X) |
| 62 | **Medium** | XY Stats (Nonlinear) | `AICc` in `enzyme-inhibition.ts` (and `nonlinear-regression.ts`) omits the residual-variance parameter (`+ 1`) from `k`; `interpolationCode` silently drops 95% CIs on tight positive-X ranges; multi-Y centered polynomials share only the first set's `centeredX` |
| 63 | **Medium** | Sample Size & Power | `noncentralTCdf` underflows to `0` at `|δ| ≥ 38.57`, causing t-test power to jump discontinuously to `100%` and `solveN` to underestimate `n` at small `df` / strict `α` |
| 64 | **Medium** | Plugins / Marketplace | Plugin wizard `kind: "text"` questions reject all non-numeric text, and `MarketplaceDialog` pre-checks `"network"` (and all permissions) by default |
| 65 | **Low** | UI / Menus | UI/menu minor defects: duplicate Grubbs' `"Outliers by column"` table, duplicate `Edit ▸ Fill Down` menu item (first lacks `!activeTableFrozen`), `CmdOrCtrl+Alt+I` shortcut collision (`New Info Sheet…` vs `Inspector`), and stale `Change Parameters…` enabled state |
| 66 | **Low** | WebR / Survival | WebR / survival edge cases: `ensurePackages` doubles caller `timeoutMs` on claim timeout; `survival-analysis.ts` computes 2-group HR on `k ≥ 3` and returns `—` without explanation on disjoint risk sets |
| 67 | **Low** | Nested Tables (R1 #28) | [Carryover from Round 1 #28] Pasting wide data into a Nested table silently drops overflow columns without showing the `"Some Values Weren't Pasted"` notice (`columnsBeyond` omits `isNested(data)`) |

---

## High-Severity Issues

### Issue 1: Unrestricted AppleScript execution (RCE), arbitrary file deletion, and ungated file moves in new shell IPC commands
- **Severity**: High
- **Files**:
  - `src-tauri/src/main.rs:671-700` (`move_file`, `move_file_blocking`)
  - `src-tauri/src/main.rs:714-759` (`send_to_keynote`, `send_to_keynote_blocking`)
  - `src-tauri/src/main.rs:775-823` (`copy_png_to_clipboard`, `copy_png_to_clipboard_blocking`)
  - `src-tauri/src/main.rs:841-892` (`copy_pdf_to_clipboard`, `copy_pdf_to_clipboard_blocking`)
- **Explanation**:
  `main.rs` treats the webview as a restricted trust boundary (extension-gating all `read_*`/`write_file` commands via `check_extension`, host-allowlisting `open_url`/`open_github_issue`, pinning `fetch_channel_manifest`, and setting a strict CSP). Four newly added IPC commands break that boundary:
  1. `send_to_keynote(script, png_path, path)` writes an arbitrary webview-supplied `script: String` to a temp file and executes `osascript` on it (allowing full shell command execution via AppleScript `do shell script`), and unconditionally calls `fs::remove_file(png_path)` on an unvalidated path.
  2. `copy_png_to_clipboard(png_path)` (line 801) and `copy_pdf_to_clipboard(pdf_path, png_path)` (line 868) interpolate raw IPC paths directly into AppleScript string literals (`"read POSIX file \"{png_path}\"..."`) with no escaping, no `temp_dir()` containment check, and no extension check — enabling AppleScript injection into `osascript` as well as arbitrary file deletion via `fs::remove_file` (lines 816, 884–885).
  3. `move_file(from, to)` checks only `from_path.extension() == to_path.extension()` and never calls `check_extension`, allowing any file on disk (including extensionless or sensitive config files) to be moved or renamed.
- **Minimal Reproduction**:
  - `invoke("send_to_keynote", { script: 'do shell script "id"', pngPath: "/path/to/any/file", path: "" })`
  - `invoke("copy_png_to_clipboard", { pngPath: '" & (do shell script "id") & "' })`
  - `invoke("move_file", { from: "/Users/me/.zshrc", to: "/Users/me/.zshrc_moved" })` (both have `extension() == None`).
- **Suggested Fix**:
  - Build the Keynote AppleScript strictly inside Rust from typed parameters (`png_path`, `out_path`, `title`, `width_pt`, `height_pt`) with proper AppleScript string escaping rather than accepting a raw `script` string from IPC.
  - For clipboard and Keynote temp-file commands, verify that `png_path`/`pdf_path` canonicalize inside `std::env::temp_dir()` with `.png`/`.pdf` extension (or pass raw bytes directly from the webview and let Rust manage temp files itself).
  - Gate `move_file_blocking` with `check_extension(from, &["hlx", "prism", "pzt", "pzm", "pzfx"])`.

---

### Issue 2: Arbitrary file read via unvalidated `provider` path traversal in `cloud_read_cache`
- **Severity**: High
- **Files**:
  - `src-tauri/src/main.rs:1254-1268` (`cloud_read_cache`)
  - `src-tauri/src/cloud.rs:534-538, 562-564` (`cache_path`, `read_cache`)
- **Explanation**:
  Unlike `cloud_download` and `cloud_upload` (which validate `provider` via `cloud_provider()`), `cloud_read_cache` passes the raw IPC `provider: String` directly to `cloud::read_cache` → `cloud::cache_path`:
  ```rust
  app.path().app_data_dir().ok().map(|dir| dir.join("cloud-cache").join(provider).join(format!("{safe_id}.{ext}")))
  ```
  In Rust, `PathBuf::join` replaces the entire base path if `provider` is absolute (e.g. `"/Users/victim/.ssh"`) and traverses upward if `provider` contains `..` (e.g. `"../mcp"`). Combined with caller-controlled `file_id` (alphanumeric/`-`/`_`, or `""` for dotfiles) and `name`'s extension, `cloud_read_cache` reads any file with an extension anywhere on the filesystem and returns its raw contents as base64 — bypassing `check_extension` and allowing exfiltration of sensitive local files (including Titer's own `<app_data>/mcp/` token/connection files).
- **Minimal Reproduction**:
  - `invoke("cloud_read_cache", { provider: "../mcp", fileId: "mcp-connection", name: "x.json" })` reads `<app_data>/mcp/mcp-connection.json`.
  - `invoke("cloud_read_cache", { provider: "/path/to/dir", fileId: "", name: "x.env" })` reads `/path/to/dir/.env`.
- **Suggested Fix**:
  Validate `provider` against an explicit allowlist (`PROVIDER_BOX | PROVIDER_MOCK`) inside `cache_path` (or reject anything not matching `[a-z0-9_-]+`), require `!safe_id.is_empty()`, and restrict `ext` to ASCII alphanumeric characters (e.g. `hlx`, `prism`, `pzfx`, `bin`).

---

### Issue 3: OAuth browser URL allowlist bypass in `open_browser_url` / `open_url` via userinfo (`@`)
- **Severity**: High
- **Files**:
  - `src-tauri/src/cloud.rs:362-383` (`BROWSER_ALLOWLIST`, `url_host`, `open_browser_url`)
  - `src-tauri/src/main.rs:1366-1369, 1911` (`open_url`)
- **Explanation**:
  `open_url` is an exposed Tauri command documented to restrict URLs strictly to OAuth provider hosts (`BROWSER_ALLOWLIST`). However, `url_host` parses the host manually without handling RFC 3986 `userinfo@host`:
  ```rust
  let rest = url.strip_prefix("https://")?;
  let host = rest.split(['/', '?', '#']).next()?;
  let host = host.split(':').next()?;
  ```
  For a URL with `user:pass@host`, `.split(':').next()` truncates at the colon inside the userinfo and treats the username as the hostname. Thus `https://account.box.com:x@attacker.example/` yields `host == "account.box.com"`, passes `BROWSER_ALLOWLIST`, and opens `https://attacker.example/` in the system browser.
- **Minimal Reproduction**:
  `invoke("open_url", { url: "https://account.box.com:x@example.org/phish" })` returns `Ok(())` and opens `example.org` in the default browser.
- **Suggested Fix**:
  Parse with the `url` crate (`Url::parse(url)`), require `parsed.scheme() == "https"`, `parsed.username().is_empty()`, `parsed.password().is_none()`, and check `parsed.host_str()` against `BROWSER_ALLOWLIST`.

---

### Issue 4: Plugin permission UI spoofing in `permissionChoices`: non-canonical permission order swaps checkbox labels and grants the wrong capability
- **Severity**: High
- **Files**:
  - `src/plugins/review.ts:30-40`
  - `src/plugins/manifest.ts:54-56, 176`
  - `src/plugins/review-view.tsx:53, 89-94`
- **Explanation**:
  `describePermissions(manifest.permissions)` (`src/plugins/manifest.ts:54-56`) filters `KNOWN_PERMISSIONS` in canonical allowlist order (`read-table`, `run-analysis`, `write-analysis`, `save-file`, `open-link`, `network`). However, `validatePluginManifest` (`src/plugins/manifest.ts:176`) preserves `manifest.permissions` in the manifest's original order, and `permissionChoices` (`src/plugins/review.ts:34-39`) zips `manifest.permissions` by array index `i` against `descriptions[i]`:
  ```ts
  const descriptions = describePermissions(manifest.permissions);
  return manifest.permissions.map((permission, i) => ({
    permission,
    description: descriptions[i] ?? permission,
    granted: granted.includes(permission),
  }));
  ```
  Whenever a plugin lists permissions in any order other than `KNOWN_PERMISSIONS` order (even alphabetical order), descriptions attach to the wrong permissions in `PluginEnableReview`.
- **Minimal Reproduction**:
  Pass a valid `plugin.json` with `"permissions": ["network", "read-table"]` to `permissionChoices` / `PluginEnableReview`. Checkbox 1 displays `"Read the open table (only the tables and columns you pass it)"` — ticking it grants `"network"`; Checkbox 2 displays `"Access the network (off unless you approve it)"` — leaving it unticked denies `"read-table"`.
- **Suggested Fix**:
  Iterate over `KNOWN_PERMISSIONS.filter((p) => manifest.permissions.includes(p))` and look up `PERMISSION_DESCRIPTIONS[permission]` directly by key instead of zipping two differently ordered arrays by index.

---

### Issue 5: Plugin capability revocation bypass: disabling/uninstalling a plugin never tears down its Isolation session, letting re-enable retain revoked permissions
- **Severity**: High
- **Files**:
  - `src/plugins/isolation.ts:151-169, 213-220, 250-277`
  - `src/plugins/loader.ts:223-226`
  - `src/marketplace/store.ts:214-219, 295-306`
- **Explanation**:
  1. `disablePlugin` (`src/plugins/loader.ts:223-226`) and `MarketplaceStore.disable` / `uninstall` (`src/marketplace/store.ts:214-219, 295-306`) never call `onPluginDisabled` or `onPluginUninstalled` (`src/plugins/isolation.ts:213-220`).
  2. When a plugin is disabled and re-enabled with a smaller permission set (e.g., revoking `"network"`), the old `PluginWebviewSession` remains in `activeWebviews` with `status: "running"` and the old `grantedPermissions`.
  3. Calling `launchPluginWebview(newRecord)` (`src/plugins/isolation.ts:151-152`) returns `existing` verbatim without checking whether `record.grantedPermissions` changed.
  4. On subsequent calls, `interceptPluginCall` (`src/plugins/isolation.ts:257`) only checks `session.checkEnabled()` (which passes because the plugin is enabled again) and enforces `dispatchPluginCommand` against the stale `session.grantedPermissions`, permitting the revoked commands.
- **Minimal Reproduction**:
  Enable plugin `P` with `["read-table", "network"]` → `launchPluginWebview(record)` → `disablePlugin(record)` → `requestEnable` + `confirmEnable(..., ["read-table"], ...)` → call `interceptPluginCall(session, "titer.fetch", {}, host)` or `launchPluginWebview(reEnabledRecord)`. Both allow `"titer.fetch"` despite `"network"` having been revoked.
- **Suggested Fix**:
  Call `onPluginDisabled(record.manifest.id)` inside `disablePlugin` (`src/plugins/loader.ts:224`) and `onPluginUninstalled(id)` inside `MarketplaceStore.uninstall` (`src/marketplace/store.ts:298`). In `launchPluginWebview`, verify that an existing session's `grantedPermissions` and `source` match `record`, tearing down and recreating the session if they differ.

---

### Issue 6: Plugin static-gate bypasses (`__TAURI_INTERNALS__` regex typo, `Function()`, R backtick/dynamic dispatch) and `.GlobalEnv` escape in shared WebR
- **Severity**: High
- **Files**:
  - `src/plugins/gates.ts:85-136, 175-226`
  - `src/plugins/registry.ts:356`
  - `src/stats/webr.ts:421`
  - `src/native.ts:31`
- **Explanation**:
  1. **Regex typo misses Tauri v2 global (`src/plugins/gates.ts:217`)**: `/__TAURI(_INTERNALS__)?__/` matches `__TAURI__` or `__TAURI_INTERNALS____` (four trailing underscores) — it never matches Tauri v2's actual global `__TAURI_INTERNALS__` (`src/native.ts:31`).
  2. **JS `Function()` without `new` (`src/plugins/gates.ts:178`)**: `/\bnew\s+Function\s*\(/` misses `Function("return ...")()`, which is equivalent to `new Function(...)`.
  3. **R denylist bypasses (`src/plugins/gates.ts:85-136`)**: Every pattern expects `<name>\s*\(`. Wrapping any denylisted function in R backticks (`` `eval`(parse(text="...")) ``, `` `readLines`(...) ``, `` `.Call`(...) ``) bypasses every regex in `R_DENYLIST`. Dynamic dispatch (`do.call("eval", ...)`, `get("system")(...)`, `match.fun(...)`, `getFromNamespace(...)`) and direct equivalents (`evalq()`, `eval.parent()`, `readRDS()`, `readBin()`, `writeBin()`, `loadNamespace()`, `requireNamespace()`, `webr::install()`, `.Internal()`, `.Primitive()`, `.Fortran()`, `.External2()`) are also unblocked.
  4. **Shared R `.GlobalEnv` poisoning (`src/plugins/registry.ts:356`, `src/stats/webr.ts:421`)**: Plugin R code is interpolated raw into `local({${code}})` in the shared `engine` webR instance. A plugin can use `<<-` / `assign("t.test", ..., envir = .GlobalEnv)` or close the block via `}); ...; local({` to overwrite base R statistical functions in `.GlobalEnv`, silently corrupting all subsequent first-party analyses.
- **Minimal Reproduction**:
  - `scanPluginJsCode('window.__TAURI_INTERNALS__.invoke("...")', 'index.js', [])` → `[]` (0 findings).
  - `scanPluginJsCode('Function("return 1")()', 'index.js', [])` → `[]` (0 findings).
  - `scanPluginRCode('`eval`(parse(text="1+1")); t.test <<- function(...) stop("pwned"); c(x=1)')` → `[]` (0 findings); running via `runPluginAnalysis` breaks every subsequent t-test in the app.
- **Suggested Fix**:
  Fix `src/plugins/gates.ts:217` to `/__TAURI(_INTERNALS)?__/`, match `Function\s*\(` with optional `new`, parse R AST via `parse(text=...)` and walk call heads rather than relying on regex alone, and evaluate plugin R code in a locked/isolated environment with brace-balanced AST checks before `local({...})`.

---

### Issue 7: Path traversal in `manifest.entry` / zip-slip entries in `loadPluginFromZip`, plus unverified manifest ID/version on marketplace install & update
- **Severity**: High
- **Files**:
  - `src/plugins/manifest.ts:160-163`
  - `src/plugins/loader.ts:103-112, 122-141`
  - `src/marketplace/store.ts:174-184, 252-274`
- **Explanation**:
  1. `validatePluginManifest` (`src/plugins/manifest.ts:162`) validates `manifest.entry` with `/^[A-Za-z0-9._/-]+$/`, which permits `..` traversal segments (`"../../evil.js"`) and leading `/` absolute paths (`"/tmp/evil.js"`).
  2. `loadPluginFromZip` (`src/plugins/loader.ts:133-139`) reads zip entry paths verbatim into the `files` map with no rejection of `..`, leading `/`, or `\` (and no uncompressed size limit), so `parsePluginPackage` accepts a zip containing `"../../evil.js"` referenced by `"entry": "../../evil.js"`.
  3. `MarketplaceStore.installListing` (`src/marketplace/store.ts:174-184`) never checks that `parsed.package.manifest.id === listing.id` or `parsed.package.manifest.version === targetVersion`. A zip whose `plugin.json` declares a different `id` installs under that spoofed id; during `updatePlugin(id)` (`store.ts:252-274`), `id` is deleted, the spoofed id is installed instead, and `updatePlugin` errors with `"record for '<id>' was lost"` while leaving the spoofed plugin installed.
- **Minimal Reproduction**:
  Create a zip containing `plugin.json` (`"entry": "../../escape.js"`, `"id": "other.plugin"`) and entry `"../../escape.js"`. `loadPluginFromZip` succeeds without error, and `installListing` installs it under `"other.plugin"` instead of `listing.id`.
- **Suggested Fix**:
  Reject `manifest.entry` and any zip entry path starting with `/` or `\`, containing `\` or `.`/`..` path segments, or exceeding an uncompressed size cap. In `installListing`, reject the package if `parsed.package.manifest.id !== listing.id` or `parsed.package.manifest.version !== targetVersion`.

---

### Issue 8: Feedback server global rate limit can be exhausted by a single per-IP blocked attacker, plus unbounded rate-limiter maps and dedupe TOCTOU race
- **Severity**: High
- **Files**:
  - `feedback-server/src/lib.rs:156-226` (`RateLimiter::check`)
  - `feedback-server/src/lib.rs:545-565` (`submit_feedback` dedupe check)
  - `broker/src/lib.rs:137-172` (`RateLimiter::check`)
- **Explanation**:
  1. **Global DoS from a single IP (`feedback-server/src/lib.rs:209-224`)**: `RateLimiter::check` consumes a token from `inner.global` (capacity 100, refill 100/hour) **before** checking `inner.per_ip` (capacity 10, refill 5/hour) and never refunds the global token when the per-IP bucket rejects the request. A single client IP sending 100 requests (90 of which are per-IP rejected) drains the entire global bucket and blocks all Titer users worldwide from filing feedback; sending 1 rejected request every 36 seconds keeps the global service permanently down.
  2. **Unbounded memory growth (`feedback-server/src/lib.rs:161`, `broker/src/lib.rs:138`)**: Both `RateLimiter` implementations insert a `Bucket` per unique `IpAddr` into a `HashMap` and never evict idle/full buckets or bound map size. Rotating IPs / IPv6 traffic grows memory without bound until OOM.
  3. **Dedupe TOCTOU race (`feedback-server/src/lib.rs:545-565`)**: `submit_feedback` checks `state.dedupe.get(&req.feedback_id)` before `await create_plane_issue(...)` (up to 30 s) and only inserts into `dedupe` afterward, so concurrent retries with the same `feedback_id` bypass deduplication and create duplicate Plane issues.
- **Minimal Reproduction**:
  Send 100 `POST /api/v1/feedback` requests from IP `1.2.3.4` (first 10 pass, next 90 return `429`), then send 1 request from an unrelated IP `5.6.7.8` → immediately rejected with `429 rate_limited`.
- **Suggested Fix**:
  In `feedback-server/src/lib.rs`, verify both `per_ip` and `global` have `>= 1.0` tokens (after refilling) before decrementing either bucket. Cap and prune full/stale entries in both `feedback-server` and `broker` `RateLimiter` maps. Track in-flight `feedback_id`s in `DedupeSet` to reject/coalesce concurrent identical submissions.

---

### Issue 9: Cloud conflict "Overwrite" always fails (`expectedVersion ?? handle.version`), while offline-opened remote files silently overwrite remote edits
- **Severity**: High
- **Files**:
  - `src/lib/cloud.ts:225-242` (`writeFile`)
  - `src/store/use-document.ts:431, 500-527, 653-661, 705` (`saveRemote`, `openOfflineCopy`, `resolveConflict`, `openRemoteEntry`)
  - `src-tauri/src/cloud_box.rs:825-830` (`BoxClient::upload_version`)
- **Explanation**:
  Two interacting defects in `expectedVersion` handling invert the cloud conflict-safety model:
  1. **Conflict "Overwrite" is permanently broken**: When the user chooses **Overwrite** in the conflict dialog, `resolveConflict` (`src/store/use-document.ts:654`) calls `writeCloudFile(pending.handle, pending.bytes, null)` where `null` means "overwrite anyway". Inside `src/lib/cloud.ts:240`:
     ```ts
     expectedVersion ?? handle.version
     ```
     Because `??` falls through on `null` as well as `undefined`, `null ?? handle.version` sends the stale `handle.version` instead of `null`. `BoxClient::upload_version` (and `MockProvider`) immediately rejects with `Conflict` again, so **Overwrite** can never succeed.
  2. **Silent overwrite / data loss after offline open**: Opening a remote file from Open Recent while offline (`openRemoteEntry`, `src/store/use-document.ts:705`) constructs a handle with `version: null`, and `openOfflineCopy` (`use-document.ts:522`) sets this handle as active with `handle.version === null` because `cloud_read_cache` does not store version metadata. When the user later reconnects and saves (or autosave triggers), `saveRemote` calls `writeCloudFile(handle, bytes)` → `undefined ?? null` → `expectedVersion: null` → Rust `expected_version: None`. `BoxClient::upload_version` (`cloud_box.rs:826-830`) skips the version check when `expected_version` is `None` and uploads with the freshly fetched remote `etag`, silently clobbering any remote edits made while offline.
- **Minimal Reproduction**:
  1. Open a remote file, edit it externally to bump its version, save in Titer (conflict dialog appears), click **Overwrite** → fails with `"still couldn't be saved (The file changed in Box since it was opened.)"`.
  2. Go offline, open a previously cached remote file from **Open Recent**, edit it, reconnect (while another user edited the remote file), and press **Save** → remote edits are silently overwritten with no conflict dialog.
- **Suggested Fix**:
  In `src/lib/cloud.ts:240`, distinguish explicit `null` from omitted `undefined`: `expectedVersion === undefined ? handle.version : expectedVersion` (or use an explicit `forceOverwrite` flag). Persist a metadata sidecar (`version`, `sha1`, `modified_at`) alongside the cloud cache file in `cloud::write_cache`/`read_cache`, and refuse non-force saves when `handle.version === null`.

---

### Issue 10: Concurrent Box token refresh deletes fresh single-use tokens and signs user out; deleted tokens leave permanent zombie accounts
- **Severity**: High
- **Files**:
  - `src-tauri/src/cloud_box.rs:543-601` (`BoxClient::from_account`, `BoxClient::access_token`)
  - `src-tauri/src/main.rs:1110-1128` (`cloud_provider`)
  - `src-tauri/src/main.rs:1207-1219` (`cloud_disconnect`)
- **Explanation**:
  1. **Single-use refresh-token race wipes out valid tokens**: `cloud_provider` (`src-tauri/src/main.rs:1124`) constructs a fresh `BoxClient` from the keychain on every `cloud_*` IPC call with no shared client or per-account async refresh lock; even within one `BoxClient`, `access_token()` (`src-tauri/src/cloud_box.rs:569-590`) drops `self.tokens.lock()` before `.await`ing `self.refresh_tokens(...)`. Because Box refresh tokens are single-use, any two overlapping cloud requests within 2 minutes of the 60-minute access-token expiry both send the same `refresh_token`. Request A succeeds and writes `(access_2, refresh_2)` to the keychain; Request B gets `400 invalid_grant` on the consumed `refresh_1` and executes `delete_tokens("box", &self.account.id)` (`cloud_box.rs:586-588`), deleting Request A's brand-new valid tokens from the keychain and signing the user out.
  2. **Zombie account cannot be disconnected**: Once the keychain entry is deleted, the account remains in `cloud-accounts.json`. Clicking **Disconnect** calls `cloud_disconnect` (`main.rs:1213`), which runs `cloud_provider(...)?` → `BoxClient::from_account` → `load_tokens` → `Err(CloudError::NotAuthenticated)` and returns early before removing the account from `cloud-accounts.json` (lines 1215–1217).
- **Minimal Reproduction**:
  1. With a connected Box account whose access token is within 120 s of expiry (or expired), invoke two concurrent cloud operations (e.g., `cloud_list` + `cloud_metadata` or two windows saving): one rotates the token, the other fails with `invalid_grant` and deletes the new token from the keychain.
  2. Open **Settings → Connected Storage** and click **Disconnect** → fails with `"No saved sign-in for this cloud account."` and the account remains listed forever.
- **Suggested Fix**:
  Maintain a per-account `tokio::sync::Mutex<()>` refresh guard in Tauri state so concurrent requests for the same account serialize refreshes and re-check the updated token before refreshing. In `cloud_disconnect`, still delete any leftover keychain entry and remove the account from `cloud-accounts.json` when `cloud_provider` fails with `NotAuthenticated` / `Keychain`.

---

### Issue 11: `PluginIsolationWebview` is non-functional in both dev (`<StrictMode>` teardown) and release builds (Tauri CSP blocks `srcDoc` inline `<script>`s)
- **Severity**: High
- **Files**:
  - `src/plugins/isolation-view.tsx:64-99`
  - `src/plugins/isolation.ts:193-199, 331-373`
  - `src/main.tsx:32`
  - `src-tauri/tauri.conf.json:39`
- **Explanation**:
  1. **Dev (`<StrictMode>`)**: `src/main.tsx:32` wraps the app in `<StrictMode>`. `PluginIsolationWebview`'s `useEffect(..., [])` cleanup (`src/plugins/isolation-view.tsx:84-87`) calls `teardownPluginWebview(sessionRef.current.pluginId)`, which sets `session.status = "torn-down"` and removes it from `activeWebviews`. Under StrictMode's mount → cleanup → remount cycle, the session is torn down before the iframe finishes loading, so every `titer.*` call immediately fails with `CapabilityDeniedError`. If the `session` prop changes without unmounting, the old session is never torn down and in-flight replies stamp the new `session.pluginId`.
  2. **Release (CSP)**: `src-tauri/tauri.conf.json:39` sets `"script-src": "'self' 'wasm-unsafe-eval' 'unsafe-eval'"` (no `'unsafe-inline'`, no `'blob:'`). An `<iframe srcDoc={buildPluginWebviewSrcDoc(...)}>` inherits the parent document's CSP, so WKWebView blocks both inline `<script>` blocks (the `window.titer` bridge and plugin entry source) in production builds.
- **Minimal Reproduction**:
  - Dev: Render `<PluginIsolationWebview session={session} host={host} />` inside `src/main.tsx`'s `<StrictMode>`; `session.status` immediately becomes `"torn-down"`.
  - Release: Load `PluginIsolationWebview` under the production CSP from `tauri.conf.json`; WebKit blocks both inline `<script>` tags in `srcDoc`.
- **Suggested Fix**:
  Move session lifecycle/teardown ownership out of the component's `useEffect` (or re-key on `session.pluginId` without mutating an externally owned session in StrictMode cleanup), and serve the isolation frame from a bundled static HTML/JS asset that loads/executes plugin code without inline `<script>` in `srcDoc`.

---

### Issue 12: Enabled marketplace plugins are never re-registered into the live plugin registry on app restart
- **Severity**: High
- **Files**:
  - `src/marketplace/store.ts:76-90`
  - `src/marketplace/wiring.ts:22-52`
  - `src/plugins/registry.ts:82, 130-146`
  - `src/components/marketplace-dialog.tsx:52-57`
- **Explanation**:
  `MarketplaceStore.confirmEnable` persists enabled `PluginRecord`s to `localStorage["titer.marketplace.installed.v1"]`. However:
  1. Nothing initializes `getMarketplaceStore()` at app startup (it is only called lazily when `MarketplaceDialog` opens).
  2. Even when `MarketplaceStore` is constructed, `loadInstalled()` (`src/marketplace/store.ts:76-90`) loads persisted `status: "enabled"` records into `this.installed` **without** re-registering their analyses via `registerPluginAnalysesFromManifest`, recording their versions via `setPluginVersion`, or running `recheckPluginCompatibility`.
  After restarting Titer, Marketplace shows the plugin as `installed … (enabled)`, while `src/plugins/registry.ts`'s `entries` map is empty: plugin analyses vanish from menus/pickers and existing plugin analysis nodes fail with `"Unknown plugin analysis: plugin:..."`.
- **Minimal Reproduction**:
  Install and enable `example.hello-analysis` in Marketplace → create a `Hello mean` analysis → reload/restart Titer. The analysis fails with `"Unknown plugin analysis: plugin:example.hello-analysis:hello-mean"`, and Marketplace shows the plugin as `(enabled)` with no analyses available until disabled and re-enabled.
- **Suggested Fix**:
  Hydrate installed plugins at app startup via `getMarketplaceStore()`, re-checking compatibility (`recheckPluginCompatibility`) and re-registering analyses + version (`registerPluginAnalysesFromManifest` + `setPluginVersion`) for every persisted record whose status is `"enabled"`.

---

### Issue 13: `ScriptDialog` crashes React on opening **File ▸ Run Script…** (conditional `useState` after early `return null`)
- **Severity**: High
- **Files**:
  - `src/components/script-dialog.tsx:54-62, 116-118`
  - `src/components/app-shell.tsx:246`
- **Explanation**:
  `AppShell` renders `<ScriptDialog />` unconditionally (`src/components/app-shell.tsx:246`). In `ScriptDialog`, lines 55–60 call `useProjectStore`, `useProjectActions`, and four `React.useState` hooks, then line 62 returns early (`if (selector?.kind !== "script") return null;`). Lines 116–118 declare three additional `React.useState` hooks (`saveName`, `saveOnOpen`, `saveOnClose`) *below* the early return. On initial mount `selector` is `null` (6 hooks run); as soon as the user opens **File ▸ Run Script…**, `selector.kind === "script"` and 9 hooks run, violating React's Rules of Hooks and throwing `Rendered more hooks than during the previous render`.
- **Minimal Reproduction**:
  Launch the app and click **File ▸ Run Script…**. React immediately throws a hook-count error and unmounts the app.
- **Suggested Fix**:
  Move `saveName`, `saveOnOpen`, and `saveOnClose` `React.useState` declarations above `if (selector?.kind !== "script") return null;`.

---

### Issue 14: `AnalysisWizard` crashes with uncaught `TypeError` on **Change Parameters… (`⌘T`)** whenever a wizard has 0 questions for the current table
- **Severity**: High
- **Files**:
  - `src/views/analyses/analysis-wizard.tsx:46-63, 226-235`
  - `src/views/analyses/wizards.ts:597-645` (`wizardForAnalysis`, `canEditAnalysisParams`)
  - `src/views/analyses/analysis-view.tsx:59, 133-140`
- **Explanation**:
  When starting a new analysis, `useStartAnalysis` checks `wizard?.questions(...).some(Boolean)` and skips `<Steps>` when there are no questions to ask. However, **Change Parameters…** (`canEditAnalysisParams`) only checks `wizardForAnalysis(node.analysisType, node.analysisParams) !== null` and never checks whether the wizard has any questions on the parent table (`descriptive-statistics` on a 1-column table, `bland-altman` on a 2-column table, `nested-t-test` on a 2-group Nested table, `simple-logistic-regression` on a 1-Y XY table). When the user presses `⌘T` or clicks **Change parameters**, `Steps` runs `const q = asked(answers)[step]` → `undefined`, and line 232 (`q.kind === "choice"`) throws `TypeError: Cannot read properties of undefined (reading 'kind')`, crashing the React tree.
- **Minimal Reproduction**:
  Create a Column table with 1 column of data, run **Descriptive statistics**, then press `⌘T` (or click **Change parameters** in the analysis toolbar).
- **Suggested Fix**:
  Pass the parent table into `canEditAnalysisParams` (checking `asked(initial).length > 0`) and guard `if (!q) return null;` in `Steps` so analyses with no editable questions for the current table disable **Change Parameters…**.

---

### Issue 15: `AnalysisView` **Cancel** button and elapsed-time/queue display are unreachable dead code while an analysis is running
- **Severity**: High
- **Files**:
  - `src/views/analyses/analysis-view.tsx:99, 207-229`
- **Explanation**:
  Line 99 defines `const running = Boolean(liveData && !outcome);`. In the render tree (lines 200–230):
  - If `shown` is truthy → renders `<AnalysisResultsView />`.
  - Else if `liveData && !outcome` (the exact condition `running === true`) → renders `<Running />` (which displays only a spinner or `"Running…"` text, with no Cancel button or timer).
  - Else → renders the fallback `<div>` containing `` `Running… ${formatElapsed(elapsedMs)}${rQueueStatusText(queue)}` `` and `{running && <Button onClick={() => cancelActiveEvals()}>Cancel</Button>}`.
  Because the `else` branch is only reachable when `liveData && !outcome` is `false`, `running` is always `false` there. Users have no Cancel button and never see elapsed time or R queue status during long analyses (while the 500ms `setInterval` at lines 113–119 still re-renders the component twice a second).
- **Minimal Reproduction**:
  Run any slow analysis (e.g., `mixed-effects` or `monte-carlo` with many iterations) and watch `AnalysisView`: no **Cancel** button or elapsed timer ever appears.
- **Suggested Fix**:
  Render the elapsed time, queue status, and **Cancel** button inside the `running` (`liveData && !outcome`) branch alongside `<Running />`.

---

### Issue 16: `ImportDialog` overwrites the parent table when "Create a new table" is shown selected (`insertionPoint === null`), drops all edits on `Enter` (stale closure), and strips the whole file as Info/Notes on `fromRow`
- **Severity**: High
- **Files**:
  - `src/views/tables/import-dialog.tsx:210-255, 582-600, 788-793, 826-831`
  - `src/components/app-shell.tsx:337-350`
  - `src/store/use-document.ts:2225-2251`
  - `src/store/use-project-store.tsx:1941`
  - `src/lib/import-choices.ts:171, 174, 258-265`
- **Explanation**:
  Three concrete bugs in `ImportDialog`:
  1. **Silent table overwrite when `insertionPoint === null`**: When a graph, analysis, or Gallery is active, `AppShell` (`src/components/app-shell.tsx:337-350`) mounts `<ImportDialog insertionPoint={null} />`. The Placement tab (`src/views/tables/import-dialog.tsx:582-599`) disables `"Insert into the active table"` and shows `"Create a new table"` checked, yet `choices.placement.target` stays at its default `"insert"`. `confirm()` (`import-dialog.tsx:213-215`) skips `if (p.target === "new")` and calls `onConfirm(choices, { r: 0, c: 1 })`. In `confirmImport` (`src/store/use-document.ts:2225-2251`), `latest.current.activeTableId` is still the graph/analysis's parent table (`src/store/use-project-store.tsx:1941`), silently overwriting and renaming the parent table instead of creating a new table.
  2. **Stale closure on `Enter` (`import-dialog.tsx:221-255`)**: The `keydown` `useEffect` has dependency array `[]`, permanently capturing the initial `confirm` closure with initial `choices` and `saveAsDefault = false`. Pressing `Enter` outside an `<input>`/`<button>`/`<select>` imports with initial defaults and discards all edits across all five tabs.
  3. **`Info & Notes` `fromRow` end-row mismatch (`import-dialog.tsx:788-793, 826-831`)**: `defaultImportChoices()` sets `infoEndRow: "last"` and `notesEndRow: "last"`. Selecting `"Import starting at row [1] and ending at row [1]"` without editing the second input displays `1` while state stays `"last"`, consuming all rows as Info/Notes and failing with `"has no rows left to import"`.
- **Minimal Reproduction**:
  1. Select a Graph (whose parent is Table 1) → File ▸ Import Data → Placement shows `"Create a new table"` checked → click **Import** → Table 1's data is overwritten and renamed.
  2. Open Import Dialog → change Filter `Start at Row` to `5` → click dialog background → press `Enter` → rows 1–4 are still imported.
  3. Open Import Dialog → Info & Notes tab → select `"Import starting at row [1] and ending at row [1]"` → click **Import** → fails with `"has no rows left to import"`.
- **Suggested Fix**:
  In `confirm()`, treat `insertionPoint === null` the same as `p.target === "new"` (`{ ...choices, placement: { ...p, target: "new" } }, null`). Store `confirm`/`onCancel` in refs so `onKeyDown` calls the latest closure. Initialize `infoEndRow` / `notesEndRow` when switching `infoMode` / `notesMode` to `"fromRow"`.

---

### Issue 17: Freezing a graph does not freeze it — `mergedGraphData` always reads live `parent.data` and overrides `frozenData`
- **Severity**: High
- **Files**:
  - `src/lib/multi-table.ts:76-101` (`mergedGraphData`)
  - `src/views/graphs/graph-view.tsx:89-90, 140, 160-166`
  - `src/views/figures/panel-figure.ts:38-40`
  - `src/views/graphs/graph-figure.ts:195-213`
- **Explanation**:
  In `GraphView`, line 90 selects `const data = node.frozen && node.frozenData ? node.frozenData : parent?.data;` and builds `dataset = readTable(data)`. However, lines 160–166 immediately call `merged = mergedGraphData(node, nodes)` and `const drawDataset = merged?.dataset ?? dataset;`. Because `mergedGraphData` (`src/lib/multi-table.ts:80-82`) unconditionally reads `parent.data` (ignoring `graph.frozen` / `graph.frozenData`) and returns a non-null `MergedGraphData` for **every** graph (including single-table graphs with no `sourceTableIds`), `drawDataset` and `drawColumns` always come from the **live** `parent.data`. Editing the parent table therefore updates every frozen graph on screen. The same omission occurs in `buildPanelFigure` (`src/views/figures/panel-figure.ts:38-40`) and `figureInputs` (`src/views/graphs/graph-figure.ts:195-213`).
- **Minimal Reproduction**:
  Create a table with data and a graph of it, click **Freeze Graph**, edit values in the parent table, and switch back to the graph: the frozen graph redraws with the edited live values instead of `frozenData`.
- **Suggested Fix**:
  In `mergedGraphData` (`src/lib/multi-table.ts:80-82`), use `const primaryData = graph.frozen && graph.frozenData ? graph.frozenData : parent?.data;` (and snapshot extra `sourceTableIds` tables on freeze), and apply the same check in `figureInputs` (`src/views/graphs/graph-figure.ts:195-213`).

---

### Issue 18: `duplicateFamily` fails to remap analysis links in cloned graphs, binding duplicated graphs to the original table's analyses
- **Severity**: High
- **Files**:
  - `src/store/use-project-store.tsx:608-664` (`duplicateFamily`)
  - `src/lib/project-file.ts:274-286` (`GRAPH_ANALYSIS_LINKS`)
- **Explanation**:
  `duplicateFamily` clones every child analysis and graph under the duplicated table with fresh IDs (`genId(child.type)`), but copies each graph's `graphOptions` verbatim (`JSON.parse(JSON.stringify(child.graphOptions))`, lines 642–644) without remapping any sibling analysis references (`regAnalysisId`, `sigAnalysisId`, `sigAnalysisIds`, `demingAnalysisId`, `coxAnalysisId`, `ttestAnalysisId`, `poissonAnalysisId`, `pcaAnalysisId`, `smoothAnalysisId`, `kmeansAnalysisId`, `hclustAnalysisId`, `monteCarloAnalysisId`). In the duplicated family, the cloned graph plots the new table's points while overlaying the **original** table's regression curve, significance stars, PCA biplot, K-means clusters, or Cox forest plot. Deleting the original table then leaves dangling analysis links on the cloned graph.
- **Minimal Reproduction**:
  Create an XY table with a **Linear regression** analysis and an XY scatter graph linked to it (`regAnalysisId`), run **Duplicate Family**, negate all Y values in the copied table, and open the copied graph: its points move to the new data while the regression line and equation still reflect the original table's analysis.
- **Suggested Fix**:
  Build an `oldId → newId` map for all cloned children first (e.g. via a two-pass loop or `remapGraphOptions` from `src/lib/template.ts`), then remap every `GRAPH_ANALYSIS_LINKS` field and `sigAnalysisIds` on cloned graphs before inserting them into `nodes`.

---

### Issue 19: `use-document.ts` reads stale `latest.current` immediately after `dispatch`, dropping `runOnClose` script changes on close and skipping crash-recovery backup refresh in `revertToSaved`
- **Severity**: High
- **Files**:
  - `src/store/use-document.ts:107-111, 1511-1525, 1546-1572, 1633-1676, 1789-1806`
  - `src/store/use-project-store.tsx:1703-1706` (`latest.current` updated only in `useLayoutEffect`)
- **Explanation**:
  In `useDocument`, `latest.current` is updated in `useEffect` (lines 109–111), and `latest.current.get()` reads `ProjectProvider`'s `latest` ref, which is updated in `useLayoutEffect` (`src/store/use-project-store.tsx:1704-1706`). Neither updates synchronously during `dispatch` — both remain stale until React commits a re-render.
  1. **`confirmDiscardWithAutosave` loses `runOnClose` script changes**: `runSavedScripts(..., "runOnClose", ...)` dispatches `latest.current.applyScript(result.doc)` (line 1522) and resolves on the microtask queue without yielding for a React commit. Lines 1561 and 1572 immediately read `latest.current.isDirty`: if clean before close, `isDirty` is still `false` and the window closes without saving or prompting; if dirty before close, `saveRef.current` reads `latest.current.get()` (line 816), writing the pre-script state.
  2. **`revertToSaved` skips updating the crash-recovery backup**: `await load(path, false)` calls `latest.current.loadProject(...)` (line 1633) and returns on microtasks before React commits. Line 1796 (`if (!after.isDirty && after.filePath === path)`) sees the stale pre-revert `isDirty === true`, skipping `writeBackupSnapshot()` and leaving discarded edits in the backup file on disk.
- **Minimal Reproduction**:
  1. Open a saved clean `.hlx` project containing a `runOnClose: true` script (`SetProjectName "Closed"`), then close the window (`⌘W`): it closes with no save and no prompt, and reopening shows the change was lost.
  2. Edit a saved `.hlx` file so a backup is written, then run **File ▸ Revert to Saved**: the backup snapshot still holds the discarded edits.
- **Suggested Fix**:
  Have `runSavedScripts` return `{ ok, changed, doc }` and pass `doc` directly into the save path (or yield for commit before `quitSaveAllowed()`/`confirmDiscard()`); have `load`/`loadRemote` return `Promise<boolean>` so `revertToSaved` updates the backup directly from `diskText`.

---

### Issue 20: Save/load round-trip regressions in `project-file.ts`: frozen graphs/figures always reopen `updated: true`, blank/image figure panels trigger false "missing graph" warnings, and `rootOrder`/`orphanedDataSet` mismatches
- **Severity**: High
- **Files**:
  - `src/lib/project-file.ts:168-177, 1677-1728, 1840-1855, 2067-2074, 2103-2110, 2486-2496, 2601-2611`
  - `src/store/use-project-store.tsx:389-401, 569-573, 691-695`
- **Explanation**:
  1. **Frozen graphs & figures always fail round-trip cleanliness**: `serializeProjectFile` (line 174: `else if (next.type !== "table") delete next.frozen;`) strips `frozen` from graphs and figures, while `readNode` (lines 2069, 2105) sets `node.frozen = true` whenever `frozenData`/`frozenDataByGraph` is present. `parseProjectFile` (line 2611) compares `contents(known)` (with `frozen: true`) to `contents(filed)` (without `frozen`), so every saved project with a frozen graph or figure opens with `updated: true` (dirty + "Project Updated" banner). Also `setGraphFrozen` snapshots raw `parent.data` verbatim while `readFrozenData` (lines 1677–1728) strips `variableTypes`, `labelVariable`, `levelOrder`, `cellBackgrounds`, `rowGroups`, `calculated`, `linkedPaste`, and `simulation`.
  2. **Blank and image figure panels always trigger a false "missing graph" alert**: `readFigure` allows `kind: "blank"` and `kind: "image"` panels with `graphId: ""` (lines 1844, 1850), but `parseProjectFile:2489` checks `(node.panels ?? []).filter((p) => !nodeOf(p.graphId) || nodeOf(p.graphId)?.type !== "graph")` without checking `p.kind`, producing a `"refers to a graph that no longer exist"` issue on every open.
  3. **Remaining `rootOrder` and `orphanedDataSet` round-trip mismatches**: `create` (`use-project-store.tsx:390`) and `createTableWithGraph` (line 691) only search for the first `"figure"` in `rootOrder`, ignoring `"info"` and orphaned `"analysis"` nodes (which `parseProjectFile` orders strictly as `[tables, infos, figures, orphans]`), and `repointAnalysis` (line 569) forgets to delete `orphanedDataSet`, triggering `updated: true` on reload.
- **Minimal Reproduction**:
  - Freeze any graph (`setGraphFrozen(g, "graph", true)`), serialize, and parse with `parseProjectFile` → `updated === true`.
  - Add a blank or image panel to a Figure, save, and reopen → warning `"Figure “Figure 1” refers to a graph that no longer exist."`.
  - Create an Info Sheet, then create Table 2, save, and reopen → `updated === true`.
- **Suggested Fix**:
  Keep `frozen: true` in `serializeProjectFile` for graphs/figures with `frozenData`/`frozenDataByGraph` (and preserve `variableTypes`/`labelVariable`/`levelOrder` in `readFrozenData`); exclude `p.kind === "blank" || p.kind === "image"` in `parseProjectFile:2489`; insert new root nodes in `create`/`createTableWithGraph` respecting `table < info < figure < orphaned analysis`; and delete `orphanedDataSet` in `repointAnalysis` and `serializeProjectFile` when `orphaned !== true`.

---

### Issue 21: `calcvars.ts`: `NOT` binds tighter than comparisons/arithmetic (inverting `WHERE NOT …` and `IF(NOT …)`), and `renameVariableInFormula` writes unbracketed names and corrupts scientific notation
- **Severity**: High
- **Files**:
  - `src/lib/calcvars.ts:245-296` (`Parser.or`, `and`, `cmp`, `add`, `mul`, `pow`, `unary`)
  - `src/lib/calcvars.ts:319-322` (`CONSTANTS` lookup)
  - `src/lib/calcvars.ts:1241-1267` (`renameVariableInFormula`)
  - `src/views/tables/table-data.ts:476-489` (`renameColumn`)
- **Explanation**:
  1. **`NOT` precedence bug (`calcvars.ts:294`)**: `NOT` sits inside `unary()` below `cmp()`, `add()`, `mul()`, and `pow()`. `=SUM(F) WHERE NOT C <= 14` parses as `(NOT C) <= 14` (`0 <= 14 === 1` for every non-zero `C`), including rows where `C <= 14` instead of excluding them; `=NOT A > 5` parses as `(NOT A) > 5`, which is always `0` (FALSE).
  2. **`renameVariableInFormula` unbracketed renames & scientific notation (`calcvars.ts:1241-1267`)**:
     - Line 1259 emits `newName` bare even if it contains spaces/punctuation (e.g. `"Dose (mg)"`, `"Var 1"`, `"X-Y"`) or matches a reserved constant (`"E"`, `"PI"` → `Math.E`, `Math.PI`), silently breaking or corrupting formulas.
     - Line 1255 does not skip numeric literals before matching `/[A-Za-z_]/`, so in `=1e-5 * [e]`, renaming `"e"` to `"conc"` rewrites the exponent into invalid `"1conc-5 * [conc]"`.
- **Minimal Reproduction**:
  - With `F = [10, 20, 30]` and `C = [5, 10, 20]`, `=SUM(F) WHERE NOT C <= 14` returns `60` instead of `30`.
  - With `B = =A * 2`, renaming column `A` to `"Dose (mg)"` breaks `B` (`=Dose (mg) * 2`), and renaming `A` to `"E"` silently computes `2 * Math.E`.
- **Suggested Fix**:
  Place `NOT` at its own precedence level between `and()` and `cmp()` (`and() → not() → cmp()`). In `renameVariableInFormula`, skip numeric literals before identifier scanning and wrap `newName` in `[...]` whenever it is not a simple unreserved bare identifier.

---

### Issue 22: `calcvars.ts`: stale `rawTextAt` for chained calculated variables (`COUNTA`, `OVER`), silent wrong/blank results for expression aggregates (`MIN(A+B)`, `MEAN(A+B)`), and `RANK` returning `0.5` on excluded rows
- **Severity**: High
- **Files**:
  - `src/lib/calcvars.ts:354-356, 733-742, 853-879, 922-923, 1028-1059`
- **Explanation**:
  1. **Stale `rawTextAt` on chained calculated variables (`calcvars.ts:1041, 1057`)**: `recomputeCalculated` snapshots `table = readTable(data)` before evaluating formulas, and `rawTextAt(dep, j)` never checks `computed.get(dep)`. If `B` is `=A * 2` and `C` is `=COUNTA(B)` (or `OVER B`), clearing `A[0]` sets `B[0] = null` while `rawTextAt("B", 0)` still returns `B`'s stale pre-edit text, causing `COUNTA(B)` to overcount.
  2. **Expression aggregates silently miscompute or blank (`calcvars.ts:354, 853-923`)**: `Parser.primary()` accepts 1-arg aggregates over expressions like `=MEAN(A + B)` or `=MIN(A + B)`. Because `evalExpr` only handles `e.args[0].kind === "var"`, `MEAN(A + B)` falls through to `return null` (blanking the column with no error) while `MIN(A + B)` / `MAX(A + B)` fall into elementwise `Math.min` / `Math.max` and return each row's own `A + B`.
  3. **`RANK` returns `0.5` on excluded rows (`calcvars.ts:733-742`)**: When `own != null` is absent from `values` (e.g. `=RANK(X) WHERE C > 0` on a row where `C <= 0`), `equal` is `0`, so `1 + less + (equal - 1) / 2` evaluates to `0.5` (or `less + 0.5`) instead of `null`.
- **Minimal Reproduction**:
  - `A = ["1", "2"]`, `B = =A * 2`, `C = =COUNTA(B)` → clear `A[0]` → `C` stays `["2", "2"]` instead of `["1", "1"]`.
  - `A = [1, 2, 3]`, `B = [10, 20, 30]` → `=MIN(A + B)` returns `[11, 22, 33]` and `=MEAN(A + B)` returns `[null, null, null]`.
  - `X = [10, 20, 30]`, `C = [0, 1, 1]` → `=RANK(X) WHERE C > 0` returns `[0.5, 1, 2]`.
- **Suggested Fix**:
  Make `rawTextAt(dep, j)` read `computed.get(dep)` when `dep` is computed; reject non-`var` single arguments to `AGGREGATES` in `Parser.primary()` (or evaluate the expression over all rows); and return `null` from `RANK` when `!matches[r]`, `values.length === 0`, or `equal === 0`.

---

### Issue 23: `.xlsx` import misclassifies custom number formats containing `[Red]`, currency codes, or unit suffixes (`"nM"`, `"mg/mL"`) as dates — silently corrupting numeric data into 1900-era date strings
- **Severity**: High
- **Files**:
  - `src/lib/tabular-import.ts:178, 267-288, 326-333`
- **Explanation**:
  `isDateFormatCode` (`src/lib/tabular-import.ts:178`) tests custom Excel `formatCode` strings with `/y{1,4}|m{1,2}|d{1,2}|h{1,2}|s{1,2}/i.test(code)` without stripping bracketed color/condition/locale tokens (`[Red]`, `[Yellow]`, `[$USD]`, `[$CHF]`), quoted literal text (`"nM"`, `"mg/mL"`, `"cells"`), or backslash-escaped characters (`\m`). Standard Excel custom numeric formats like `#,##0.00;[Red](#,##0.00)`, `0.00;[Red]-0.00`, or `0.0 "nM"` match `d` (in `[Red]`) or `m`/`s`/`y`/`h`, get added to `dateStyles` (line 283), and pass every number in that column through `excelSerialToIso(serial)` — silently converting numeric data into 1900-era ISO date strings (or `"NaN-NaN-NaN NaN:NaN"` for large values).
- **Minimal Reproduction**:
  Import any `.xlsx` file with a numeric column formatted as `0.00;[Red]-0.00` or `0.0 "nM"` containing `[12.5, 100, -3.4]`: they import as `["1900-01-11 12:00", "1900-04-09", "1899-12-26 14:24"]`.
- **Suggested Fix**:
  Decode XML entities in `formatCode` first, strip quoted strings (`"[^"]*"`), bracket tokens (`\[[^\]]*\]` except elapsed-time `[h]`/`[m]`/`[s]`), and escaped chars (`\\.`), and only treat the code as a date format if date/time tokens remain (also guarding `excelSerialToIso` against non-finite `Date` results).

---

### Issue 24: `.xlsx` / CSV importer corrupts rows on self-closing `<row .../>` and `<t/>` tags, crashes on malformed attributes/entities, and overflows the call stack before `MAX_IMPORT_ROWS` truncation
- **Severity**: High
- **Files**:
  - `src/lib/tabular-import.ts:148, 152-153, 262, 295-317, 373-380`
- **Explanation**:
  1. **Self-closing `<row .../>` shifts rows (`tabular-import.ts:295`)**: `/<row\b([^>]*?)>([\s\S]*?)<\/row>/g` misses self-closing `<row r="2" ht="15"/>` tags, matching through the next row's `</row>` and shifting row 3's cells into row 2.
  2. **Self-closing `<t/>` injects raw XML (`tabular-import.ts:262, 317`)**: `/<t\b[^>]*>([\s\S]*?)<\/t>/g` matches `<t/>` as an opening tag and swallows XML through the next `</t>`.
  3. **Stack overflow before `MAX_IMPORT_ROWS` (`tabular-import.ts:373`)**: `Math.max(...grid.map((r) => r.length))` spreads all rows onto the call stack before line 380 truncates `grid` to `MAX_IMPORT_ROWS` (`50_000`), crashing with `RangeError: Maximum call stack size exceeded` on ~130k+ row imports.
  4. **Malformed `.xlsx` crashes & attribute collision (`tabular-import.ts:148, 152-153, 298-309`)**: `rowRef = "0"` or `"abc"` makes `rows[rowIndex]` `undefined` → uncaught `TypeError`; huge cell refs cause OOM; `decodeEntities` throws `RangeError` for `code > 0x10ffff`; `attrOf(' spans="1:3"', "s")` matches `s="1:3"` inside `spans=` due to missing boundary anchor.
- **Minimal Reproduction**:
  - `.xlsx` worksheet containing `<row r="2" ht="15"/><row r="3"><c r="A3"><v>42</v></c></row>` places `42` in row 2 instead of row 3.
  - `rowsToTable(Array.from({ length: 200_000 }, () => ["1", "2"]), "big.csv")` throws `RangeError: Maximum call stack size exceeded`.
- **Suggested Fix**:
  Match self-closing `<row>` and `<t>` tags, anchor `attrOf` with `(?:^|\s)`, validate `rowIndex >= 0` and cap row/column expansion, bound `code <= 0x10ffff` in `decodeEntities`, and truncate `grid` before computing `width` via a loop.

---

### Issue 25: `.prism` import drops `summaryFormat` on grouped summary tables (treating Mean/SD/N as raw replicates) and fails to sanitize `:` or pad ragged subcolumns
- **Severity**: High
- **Files**:
  - `src/lib/prism.ts:1054-1067, 1103, 1128-1142, 1165-1169`
  - `src/lib/prism-write.ts:477-520`
  - `src/lib/project-file.ts:872-878`
  - `src/lib/dataset.ts:75-76, 90`
- **Explanation**:
  Three bugs in `convertPrism`'s `format === "grouped"` branch (`src/lib/prism.ts:1054-1067`):
  1. **Grouped summary round-trip corruption**: `writePrism` exports Titer grouped summary tables (`summaryFormat: "mean-sd-n"`, columns `A:Mean`, `A:SD`, `A:N`) as `format: "grouped", dataFormat: "y_sd_n"`. When `convertPrism` reads any `format === "grouped"` table, lines 1054–1067 ignore `dataFormat`, name every subcolumn `${group}:Y1`…`${group}:Yn`, and leave `data.summaryFormat` unset (`undefined` → `"replicates"`), letting replicate-only analyses (Two-Way ANOVA, Multiple t tests, Mixed-effects) run on Mean/SD/N as if they were raw replicates.
  2. **Unsanitized `:` in grouped dataset titles**: Line 1062 sets `group = plainTitle(entry.set.title) || "Group"` without replacing `:`. Titles `"1:10"` and `"1:100"` produce `"1:10:Y1"` and `"1:100:Y1"`, which `seriesKeyOf` splits at the first `:`, merging both into `"1"` and overwriting all values with `null` on `.hlx` save/reload (`regroupTable`).
  3. **Ragged grouped subcolumns not padded**: If one grouped dataset has fewer subcolumns than `replicates`, line 1063 pushes only `entry.count` columns, making `data.columns.length < 1 + groups * replicates` and breaking `leadOf(data)` (`src/lib/dataset.ts:76`).
- **Minimal Reproduction**:
  - Round-trip a Grouped `mean-sd-n` table via `writePrism` → `convertPrism`: it comes back as `summaryFormat: undefined` with columns `A:Y1`, `A:Y2`, `A:Y3`.
  - Import a `.prism` grouped table with dataset titles `"1:10"` and `"1:100"`, save as `.hlx`, and reopen: all values in both groups become `null`.
- **Suggested Fix**:
  In `src/lib/prism.ts:1054-1067`, map Prism summary `dataFormat`s (`y_sd_n` → `"mean-sd-n"`, etc.) to `data.summaryFormat` and `summarySubcolumns` labels, replace `:` with `-` in `group`, and pad ragged replicate groups to `replicates`.

---

### Issue 26: Native Titer XY replicate (`A:Y1`, `A:Y2`) and XY summary (`A:Mean`, `A:SD`, `A:N`) tables lose their grouping, `summaryFormat`, and nonlinear-regression dataset links in both `.prism` and `.pzfx` exports
- **Severity**: High
- **Files**:
  - `src/lib/prism-write.ts:289-331, 521-538, 785-794`
  - `src/lib/pzfx-write.ts:134-177, 428-431`
  - `src/views/tables/table-data.ts:735-793, 890-917`
- **Explanation**:
  Titer represents native XY replicate tables (`replicateXY`, columns `["Title", "X", "A:Y1", "A:Y2", "B:Y1", "B:Y2"]`) and XY summary tables (`applySummaryFormatXY`, `["Title", "X", "A:Mean", "A:SD", "A:N", ...]`) using `groups`/`replicates` and `summaryFormat`. Both `writePrism` and `writePzfx` only run `groupRuns` + `data.summaryFormat` grouping when `tableType === "grouped"`, so `tableType === "xy"` emits every colon-delimited subcolumn as an independent single-subcolumn dataset (`y_single` / `Subcolumns="1"`), losing replicate grouping and `summaryFormat`. In addition, `prism-write.ts:786-794` cannot find `params.y = "A"` in `datasetTitles` (`["A:Y1", "A:Y2", ...]`), attaching every column to the nonlinear regression, hardcodes `idx: "A"` when `yPos > 0`, and produces `[`, `\`, `]` via `String.fromCharCode(65 + i)` beyond 26 datasets.
- **Minimal Reproduction**:
  Create an XY table with Replicates = 2 (`X, A:Y1, A:Y2, B:Y1, B:Y2`) or `Mean, SD, N` (`X, A:Mean, A:SD, A:N`), attach a 4PL nonlinear regression on `y: "A"`, and export to `.prism` or `.pzfx`: separate 1-subcolumn datasets are emitted and the `.prism` analysis links all datasets.
- **Suggested Fix**:
  Handle `isGrouped(data)` (colon-delimited `groupRuns` + `data.summaryFormat`) for `tableType === "xy"` in both `prism-write.ts` and `pzfx-write.ts`, use `letterIdx(yPos)` at `prism-write.ts:789`, and use proper column lettering (`A..Z, AA..`) past 26 datasets.

---

### Issue 27: EPS vector export produces invalid/corrupted PostScript (`nocurrentpoint` crash on text + leaked `clip` path)
- **Severity**: High
- **Files**:
  - `src/lib/vector-export.ts:1203-1206` (`EpsBackend.clipPath`)
  - `src/lib/vector-export.ts:1230-1246` (`EpsBackend.drawPath`)
  - `src/lib/vector-export.ts:1254-1262` (`EpsBackend.drawText`)
- **Explanation**:
  1. **Unconditional `nocurrentpoint` error on text**: `EpsBackend.drawText` emits `gsave`, color, `setfont`, `x y translate 1 -1 scale`, and immediately calls `rmoveto show` or `show` without establishing a current point (`0 0 moveto`). PostScript aborts with `Error: /nocurrentpoint` whenever no current point exists.
  2. **Clip path leaks into every subsequent shape inside clipped `<g>`**: PostScript's `clip` does not clear the current path. `EpsBackend.clipPath` emits `this.emitPath(segs); this.ops.push("clip");` with no `newpath`, and `drawPath` never emits `newpath` before `emitPath(segs)`. Every shape inside Plotly's clipped `<g class="plot">` appends onto the clip rectangle, filling/stroking the entire plot box and shifting text inside the clipped group.
- **Minimal Reproduction**:
  Export any graph or figure as **EPS** and open/render it in Ghostscript, macOS Preview, or Adobe Illustrator.
- **Suggested Fix**:
  Emit `newpath` immediately after `clip` in `EpsBackend.clipPath`, emit `newpath` before `emitPath` in `EpsBackend.drawPath`, and emit `0 0 moveto` after `translate 1 -1 scale` in `EpsBackend.drawText` (rounding `%%BoundingBox` to integers per EPSF-3.0).

---

### Issue 28: PDF vector export corrupts all non-ASCII text (`−`, `R²`, `±`, `µM`, `°C`, `×`) by writing UTF-16BE bytes into single-byte Type1 `Tj` streams
- **Severity**: High
- **Files**:
  - `src/lib/vector-export.ts:996-1005` (`pdfEscape`)
  - `src/lib/vector-export.ts:1085, 1091-1092` (`PdfBackend.drawText`, `PdfBackend.resources`)
  - `src/lib/vector-export.ts:1172-1174` (`psEscape` — raw UTF-8 in PostScript Type1)
- **Explanation**:
  `PdfBackend.resources()` declares Base-14 Type1 fonts (`/Type /Font /Subtype /Type1 /BaseFont /Helvetica`) with default single-byte encoding, yet `pdfEscape` emits a UTF-16BE hex string with BOM (`<feff00...>`) whenever `text` contains any character outside `0x20–0x7e`. In PDF content streams, single-byte Type1 `Tj` operators interpret every byte (`0xfe`, `0xff`, `0x00`, `'R'`, `0x00`, `0xb2`) as separate 1-byte character codes, corrupting the entire string (even ASCII characters) whenever any label contains `−`, `R²`, `±`, `µM`, `°C`, `×`, or smart quotes.
- **Minimal Reproduction**:
  Export any graph whose title, axis title, regression equation (`R² = 0.98`, `Y = 2*X − 1`), or negative tick label contains a non-ASCII character to **PDF** and view in Preview / Chrome / PDF.js.
- **Suggested Fix**:
  Declare `/Encoding /WinAnsiEncoding` on the Type1 Base-14 fonts and encode `Tj` strings to single-byte WinAnsi bytes (mapping math/Greek symbols via `/Symbol` or an embedded/CID font), and similarly re-encode `psEscape` for `ISOLatin1Encoding` / `Symbol`.

---

### Issue 29: Vector PDF/EPS export silently ignores Plotly CSS `px` units (`font-size`, `stroke-width`, `stroke-dasharray`), erases parent `<g>` opacity, and `grayscaleFigure` rewrites series labels matching CSS color names
- **Severity**: High
- **Files**:
  - `src/lib/vector-export.ts:135-152` (`grayscaleFigure`)
  - `src/lib/vector-export.ts:333-367` (`presentationOf`)
- **Explanation**:
  1. `presentationOf` parses `font-size`, `stroke-width`, and `stroke-dasharray` via raw `Number(v)` without stripping CSS `px`/`pt` units (`font-size: 12px`, `stroke-width: 2px`, `stroke-dasharray: 9px, 3px` all parse as `NaN`), forcing all text to `16px`, all strokes (including `0px` hidden borders and `3px` axes) to `1px`, and all dashed/dotted lines to solid.
  2. Line 348 sets `opacity: num(merged.opacity, parent.opacity)`, replacing rather than multiplying `parent.opacity` (so child `opacity: 1` overwrites `<g style="opacity: 0.4">`, turning translucent bars/fills opaque).
  3. `grayscaleFigure` (lines 135–152) transforms every string matching a CSS color name in `figure.data` and `figure.layout`, turning series/category names like `"Red"`, `"Blue"`, or `"Green"` into hex strings like `"#4c4c4c"`.
- **Minimal Reproduction**:
  Export any Plotly graph with dashed lines, `axisWidth = 2`, custom font size, or semi-transparent bars to **PDF** or **EPS**, or export a graph with a group named `"Blue"` / `"Red"` in **Grayscale** mode.
- **Suggested Fix**:
  Strip `px`/`pt` units in `num()` and `strokeDasharray`, multiply `parent.opacity * num(merged.opacity, 1)`, and restrict `grayscaleFigure` to color-bearing keys (skipping `name`, `text`, `x`, `y`, `ticktext`, `customdata`).

---

### Issue 30: Multi-panel Figure vector PDF and EPS exports are shrunk to 75% (`0.75×`) of configured physical dimensions
- **Severity**: High
- **Files**:
  - `src/lib/figure.ts:605-606, 669-674` (`composeFigureSvg`)
  - `src/lib/vector-export.ts:1100-1108, 1131-1133, 1277-1279` (`svgSize`, `svgToPdf`, `svgToEps`)
  - `src/views/figures/figure-export.ts:329-349`
- **Explanation**:
  `composeFigureSvg` lays out figures in **points** (`PT_PER_INCH = 72`, so a `10 × 7.5 in` figure gets `width="720" height="540" viewBox="0 0 720 540"` with `12` pt panel labels). When `saveFigureImage` passes that SVG to `svgToPdf` or `svgToEps`, both functions unconditionally assume root `width`/`height` are 96-DPI CSS pixels and multiply by `72 / 96 = 0.75`, producing a `7.5 × 5.625 in` (`540 × 405 pt`) PDF/EPS with 9 pt labels while the raster PDF fallback exports at `10 × 7.5 in`.
- **Minimal Reproduction**:
  Create a `10 × 7.5 in` Figure with a graph panel and export as **PDF** or **EPS**: page dimensions are `7.5 × 5.625 in` instead of `10 × 7.5 in`.
- **Suggested Fix**:
  Emit `width="${widthPt}pt" height="${totalHeightPt}pt"` in `composeFigureSvg` and parse CSS length units (`pt` → scale `1`, `px`/unitless → `72/96`) in `svgSize` (or pass explicit `units`).

---

### Issue 31: `grouped-bars-scatter` ("Bars with individual points") plots numeric scatter X coordinates on a categorical X axis and duplicates points/legend entries
- **Severity**: High
- **Files**:
  - `src/views/graphs/grouped-common.ts:60-64, 171-213` (`buildGroupedBars`, `buildGroupedBarsScatter`)
  - `src/views/graphs/grouped-bars-scatter.ts:6-14`
  - `src/store/types.ts:506` (`DEFAULT_GRAPH_OPTIONS.showPoints: false`)
- **Explanation**:
  `buildGroupedBarsScatter` calls `buildGroupedBars(columns, options, "group", false, ...)`. With default `options.showPoints === false` and `groupLayout === "interleaved"`, `buildGroupedBars` uses string category X values (`["Row 1", "Row 2"]`) on `xaxis: { type: "category" }`. `buildGroupedBarsScatter` then appends scatter traces with numeric float X values (`r + groupOffset(gi, total) + jitter(...)`) and without `showlegend: false`, creating spurious numeric tick labels to the right of all bars and duplicating every group in the legend. If `options.showPoints` is `true`, both `buildGroupedBars` and `buildGroupedBarsScatter` draw the points twice.
- **Minimal Reproduction**:
  Create a Grouped table with replicates, add a **Bars with individual points** (`grouped-bars-scatter`) graph, and view it: individual points appear off to the right on float tick labels and each group appears twice in the legend.
- **Suggested Fix**:
  Pass `{ ...options, showPoints: true }` into `buildGroupedBars` from `buildGroupedBarsScatter` (handling `"superimposed"` directly in `buildGroupedBars`) and remove the duplicate scatter loop in `buildGroupedBarsScatter`.

---

### Issue 32: Summary tables draw no SEM error bars on `"mean-sem"` tables and drop asymmetric lower error bars (`errorMinus`) on XY summary graphs
- **Severity**: High
- **Files**:
  - `src/views/graphs/plot-helpers.ts:573-590` (`xyDrawn`)
  - `src/views/graphs/plot-helpers.ts:1353-1368` (`summaryErrorAt`)
  - `src/lib/summary-format.ts:48`
- **Explanation**:
  1. In `summaryErrorAt` (`src/views/graphs/plot-helpers.ts:1353-1366`), when `format === "mean-sem"` (`def.errorKind === "sem"`, no `N` column so `n === null`), `asSd` evaluates to `null`. Line 1363 computes `const asSem = asSd == null ? null : def.errorKind === "sem" ? stored : ...;`, so `asSem` is always `null` even though `stored` is already the SEM — rendering zero error bars on `Mean, SEM` tables. (Also for `cv`, `(stored / 100) * m` turns negative when `m < 0`.)
  2. In `xyDrawn` (`src/views/graphs/plot-helpers.ts:573-590`), the `summary !== "replicates"` branch discards `errorMinus`, plotting symmetric ±upper error bars on `"mean-plus-minus"` and `"mean-upper-lower"` XY tables.
- **Minimal Reproduction**:
  1. Create a Grouped or XY table with summary format **Mean, SEM**, plot with **Error bars: SEM** → no error bars appear.
  2. Create an XY **Mean, +error, −error** table with `+error = 10, −error = 2` → XY scatter plots ±10 symmetrically.
- **Suggested Fix**:
  Compute `asSem` without requiring `asSd` when `def.errorKind === "sem"` (and use `Math.abs(m)` for CV), and capture `errorMinus` in `xyDrawn`'s summary branch.

---

### Issue 33: `titer_read_results` returns stale cached results after table mutations and returns `not_computed` for frozen/orphaned/cloned analyses with saved `cachedResult`
- **Severity**: High
- **Files**:
  - `src-tauri/src/mcp.rs:1725-1764` (`mcp_publish_snapshot`, `mcp_publish_result`)
  - `src-tauri/src/mcp.rs:2023-2031` (`McpState.results`)
  - `src-tauri/src/mcp.rs:10132-10181` (`read_results`)
  - `src/store/use-project-store.tsx:657-671` (`duplicateNode` copies `cachedResult`)
  - `src/views/analyses/analysis-view.tsx:58-90`
- **Explanation**:
  1. **Stale results after table edits**: `McpState.results` is an append-only `HashMap<(String, String), serde_json::Value>` populated only by `mcp_publish_result`. When a table is edited via `titer_write_table`, `titer_edit_table`, `titer_refresh_linked_data`, `titer_add_calculated_variable`, `titer_run_script`, or `titer_undo`/`titer_redo` while the analysis sheet is not open, `McpState.results` is never invalidated for the table's child analyses, so `titer_read_results` returns `"status": "computed"` with stale pre-edit numbers.
  2. **`not_computed` on saved/frozen/orphaned/cloned results**: When a `.hlx` file opens with a frozen or orphaned analysis (`node.cachedResult`), or `titer_clone_analysis` (`duplicateNode`) copies `cachedResult` to a new analysis node, `read_results` checks only `McpState.results`, ignores `node.get("cachedResult")`, and falsely returns `"status": "not_computed"`.
- **Minimal Reproduction**:
  Run `titer_run_analysis` on `table_1`, overwrite `table_1` via `titer_write_table`, then call `titer_read_results` → returns old results; or call `titer_clone_analysis` and `titer_read_results` on the clone → returns `"status": "not_computed"`.
- **Suggested Fix**:
  Invalidate non-frozen child analysis entries in `McpState.results` (and clear `cachedResult` on non-frozen child nodes in `updateTable`) whenever parent table data changes, and fall back to `node.get("cachedResult")` in `read_results` when `results.get(...)` is `None`.

---

### Issue 34: `validateAnalysisParams` omits 11 per-analysis enum narrowings from `analysis-params-schema.json`, allowing cross-family params that silently run the wrong statistical test or crash R
- **Severity**: High
- **Files**:
  - `src/lib/project-file.ts:980-991, 1441-1451` (`PARAM_CHOICES`, `validateAnalysisParams`)
  - `scripts/generate-analysis-params-schema.py:102-144` (`ENUM_OVERRIDES`)
  - `src/stats/column/shapiro-wilk.ts:72-75`
  - `src/stats/contingency/chi-square.ts:34-120`
  - `src/stats/column/rm-anova.ts:28-31`
  - `src/stats/simulation/monte-carlo.ts:124-125, 334`
- **Explanation**:
  `PARAM_CHOICES` (`src/lib/project-file.ts:980-991`) narrows only 8 of the 19 `(analysisType, param)` enum overrides defined in `ENUM_OVERRIDES`, omitting `model` (`nonlinear-regression`, `binding-saturation`, `binding-kinetics`, `enzyme-inhibition`, `dose-response-special`), `test` (`shapiro-wilk`, `chi-square`), `method` (`monte-carlo`, `p-value-stack`), `weights` (`linear-regression`), `equation` (`plot-function`), and `posthoc` (`rm-anova`, `two-way-anova`, `three-way-anova`, `nested-anova`, `multifactor-anova`). As a result:
  - `shapiro-wilk` with `test: "fisher"` silently falls back to `"shapiro-wilk"`.
  - `chi-square` on a 2×2 table with `test: "shapiro-wilk"` silently runs Yates' chi-square with `subtitle: undefined`.
  - `rm-anova` with `posthoc: "dunnett"` silently coerces `posthoc` to `"none"`.
  - `monte-carlo` (`targetAnalysis: "correlation"`) with `method: "bonferroni"` passes `method="bonferroni"` to R `cor()` and fails opaquely.
  - Invalid cross-family `model`/`weights`/`equation` params pass `create-analysis` and leave broken analysis nodes in the project.
- **Minimal Reproduction**:
  Call `titer_run_analysis` on a 2×2 Contingency table with `analysis_type: "chi-square", params: { "test": "shapiro-wilk" }` (returns Yates chi-square with `subtitle: undefined`), or on a Column table with `analysis_type: "rm-anova", params: { "posthoc": "dunnett" }` (silently drops post-hoc comparisons).
- **Suggested Fix**:
  Sync `PARAM_CHOICES` in `src/lib/project-file.ts` with every entry in `ENUM_OVERRIDES`, and add explicit enum guards in `runChiSquare`, `runMonteCarlo`, `resolveNormalityParams`, and `rmAnovaSpec`.

---

### Issue 35: `addFittedCurve` draws all-`NaN` curves (no line rendered) for every multi-Y (`params.ys`) and curve-comparison (`params.compareWith`) nonlinear regression
- **Severity**: High
- **Files**:
  - `src/views/graphs/fitted-curve.ts:446-483` (`addFittedCurve`)
  - `src/stats/xy/nonlinear-regression.ts:602-618, 2390, 2661` (`coefficientsForSet`)
  - `src/views/graphs/graph-view.tsx:742-747`
  - `src/views/graphs/graph-figure.ts:549-562`
- **Explanation**:
  Both `graph-view.tsx:747` and `graph-figure.ts:559` call `addFittedCurve` (not `addFittedCurves`). When `fit.fit.sets.length > 1`, `addFittedCurve` passes `coefficientsForSet(coefficients, setName, sets)` to `fittedCurve`. However, global fits name per-series terms `"Top (Treated)"`, while multi-Y (`params.ys`, line 2390) and two-curve comparisons (`params.compareWith`, line 2661) name terms `"Control — Top"`, `"Treated — Top"`. Because `coefficientsForSet` (`src/stats/xy/nonlinear-regression.ts:602-618`) only strips ` (${setName})` suffixes and ignores `${setName} — ` prefixes, `evaluate()` receives no matching term names, returns `NaN` for all 101 points, and draws zero curves.
- **Minimal Reproduction**:
  On an XY table with two Y columns (`Control`, `Treated`), run `nonlinear-regression` with `{ model: "sigmoidal-4pl-logx", ys: ["Control", "Treated"] }` (or `{ model: "sigmoidal-4pl-logx", y: "Control", compareWith: "Treated" }`) and link it to an XY scatter graph: no fitted curves appear.
- **Suggested Fix**:
  Support both `${setName} — ` prefixes (filtering out other sets' `${other} — ` prefixes) and ` (${setName})` suffixes in `coefficientsForSet`, or route non-global multi-set fits to `addFittedCurves`.

---

### Issue 36: Raw-X sigmoidal models (`sigmoidal-4pl-x`, `absolute-ic50-x`, `asymmetric-5pl-x`, `agonist-4pl-normalized-x`) force `Y = Bottom` (or `0`) at `X = 0` in R even when `HillSlope < 0`, corrupting falling-curve fits and disagreeing with TS `evaluate()`
- **Severity**: High
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:379, 391, 658, 676, 853-875, 1143, 1158, 1342-1356`
  - `src/views/graphs/fitted-curve.ts:63-64, 85-86, 137-138, 174-175`
- **Explanation**:
  `FOUR_X` (`nonlinear-fit.ts:391`), `asymmetric-5pl-x` (`nonlinear-fit.ts:1346`), and `agonist-4pl-normalized-x` (`nonlinear-fit.ts:855`) guard `x == 0` with `ifelse(x==0, Bottom, ...)` (or `0` for normalized) while keeping `X = 0` vehicle points (`nonNegativeX: true`) and allowing `HillSlope < 0`. For any falling curve (`HillSlope < 0`), $\lim_{X \to 0^+} (\text{EC}_{50}/X)^{\text{HillSlope}} = 0$, so the true limit at $X = 0$ is `Top` (or `100`), not `Bottom` (or `0`). R injects a full-span residual jump at `X = 0` that biases or breaks `nls()`, and disagrees with TS `fitted-curve.ts`, which evaluates `(EC50 / 0) ** (-|H|) = 0` → `Top`.
- **Minimal Reproduction**:
  Fit `sigmoidal-4pl-x` (or `absolute-ic50-x` / `asymmetric-5pl-x`) to `X = [0, 0.1, 1, 10, 100, 1000]`, `Y = [100, 99, 91, 50, 9, 1]`. R forces `f(0) = Bottom ≈ 1` against observed `Y = 100`, while TS `evaluate(..., 0)` returns `Top`.
- **Suggested Fix**:
  Make the `x == 0` guard sign-aware in both R (`fit` and `curveFn`) and TS (`evaluate`): `ifelse(x==0, ifelse(HillSlope<0, Top, Bottom), ...)` (and `ifelse(HillSlope<0, 100, 0)` for `agonist-4pl-normalized-x`).

---

### Issue 37: `applyFitOptions` (`transformNlsCall`) silently strips built-in `lower=`/`upper=` bounds on 17+ models whenever weights, fixed params, bounds, or robust/Poisson IRLS are used — and crashes on `logistic-growth` / `gompertz-growth`
- **Severity**: High
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:1505-1525, 1980-2042, 2172-2278, 2868-2877, 2946-2951`
  - `src/stats/xy/nonlinear-regression.ts:1757-1774`
- **Explanation**:
  1. `transformNlsCall` (`src/stats/xy/nonlinear-fit.ts:2199-2219`) discards `lower=` and `upper=` from `spec.fit` and only emits bounds for user-supplied `params.bounds`. Because `applyFitOptions` runs whenever `weights`, `fixed`, `bounds`, or `fitMethod: "robust" | "poisson"` (`fitModelSpec:2951`) is active, all 17+ models with built-in constraints (`lognormal`, `two-site-competition-*`, `gaussian`, `lorentzian`, `cumulative-gaussian-*`, `sine-wave`, `sinc`, etc.) silently lose their bounds (allowing `GeoMean ≤ 0`, `FractionHi` outside `[0, 1]`, or negative widths). `runGlobalNonlinear` similarly omits built-in bounds.
  2. `logistic-growth` and `gompertz-growth` use `start=local({...})` (`nonlinear-fit.ts:1511, 1521`), which `startVariables` cannot parse, causing `applyFitOptions` (line 2243) to crash for **any** `weights`, `fixed`, `bounds`, or `robust`/`poisson` fit (and `warmStartFit` fails to warm-start them).
  3. `nlsDerivTol` retries (`nonlinear-fit.ts:417`) pass parameter names as strings to `deriv(...)`, which `substituteFormula` leaves unrewritten when parameters are fixed.
- **Minimal Reproduction**:
  - Run `nonlinear-regression` with `{ model: "logistic-growth", weights: "1/y2" }` or `{ model: "logistic-growth", fitMethod: "robust" }` → fails with `Cannot rewrite the "Y0, YM, K" fit for fixed/bounded parameters.`
  - Run `{ model: "two-site-competition-logx", weights: "1/y2" }` → R code omits `lower=`/`upper=`.
- **Suggested Fix**:
  Store intrinsic per-term bounds as structured metadata on `ModelSpec` (intersected with `params.bounds` and honored in `applyFitOptions` and `runGlobalNonlinear`), support `local({...})` in `formulaVariables`/`transformNlsCall`/`warmStartFit`, and filter `fixed` parameter names out of `deriv()` in `nlsDerivTol`.

---

### Issue 38: Weighted, robust, and Poisson fits on log-Y models (`semilog-y-log`, `log-log-line`, `exponential-growth-log`) compute `R²` by dividing `log(Y)`-scale SS by raw `Y`-scale SST, and Poisson IRLS uses `1/log(Y)` weights
- **Severity**: High
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:487-508, 2661-2667, 2908, 2968-2970`
  - `src/stats/xy/nonlinear-regression.ts:1435-1444, 1465-1475`
- **Explanation**:
  `semilog-y-log`, `log-log-line`, and `exponential-growth-log` fit `m <- lm(log(y) ~ ...)` (`residuals(m)` and `fitted(m)` are on the `log(y)` scale).
  1. `fitSummaryStatements` (`nonlinear-fit.ts:2664-2666`) and `fitModelSpec` (`nonlinear-fit.ts:2969`, for `robust`/`poisson`) divide `ss = sum(w * residuals(m)^2)` (`log(y)` scale) by `sst` computed on raw `y`, producing absurd negative or ~1.0 `R²` values.
  2. `irlsLoop` (`nonlinear-fit.ts:2908`) uses `mu <- fitted(m); wr <- 1 / mu`, weighting `log(y)` regression by `1/log(y_hat)` and clamping `log(y_hat) <= 1` to `1e6`.
  3. `compareModels` (`nonlinear-regression.ts:1441-1442`) compares `n * log(ss / n)` directly across `logY` vs raw-`Y` models without a Jacobian correction, biasing $\Delta\text{AICc}$ by $\approx 2\sum\ln y_i$.
- **Minimal Reproduction**:
  On `X = [1, 2, 3, 4]`, `Y = [0.001, 0.002, 0.0015, 0.003]`, run `nonlinear-regression` with `{ model: "semilog-y-log", weights: "1/x" }` (or `fitMethod: "robust"`): `R²` is reported around `-150,000`.
- **Suggested Fix**:
  Use `log(y)` in `sst` (or `s$r.squared` for `lm`) when `spec.logY` is true, refuse `fitMethod: "poisson"` on `spec.logY` models, and refuse `compareModel` when `Boolean(spec.logY) !== Boolean(specB.logY)`.

---

### Issue 39: `ecAnything` crashes R (`subscript out of bounds`) when `params.ecx` is requested on competition models, and `runGlobalNonlinear` mislabels shared `IC50`/`IC50Hi`/`LogKd` midpoints as `"EC50"`
- **Severity**: High
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:263-284, 1841, 1876, 1919`
  - `src/stats/xy/nonlinear-regression.ts:1940-1954, 2004-2011, 2203-2208`
- **Explanation**:
  1. `two-site-competition-logx`, `two-site-competition-x`, and `homologous-competition-logx` set `spec.dose`, so `nonlinear-regression.ts:2203` accepts `params.ecx` and appends `ecAnything(model, f)` to `spec.derived`. However, `ecAnything` (`nonlinear-fit.ts:270-272`) indexes `b[["LogEC50"]]`/`b[["EC50"]]` and `b[["HillSlope"]]`, none of which exist on competition models, crashing R with `subscript out of bounds`.
  2. In `runGlobalNonlinear` (`nonlinear-regression.ts:1945, 2007`), `const label = midpoint === "LogIC50" ? "IC50" : "EC50";` mislabels shared `"IC50"`, `"LogIC50Hi"`/`"IC50Hi"`, and `"LogKd"` (`10^LogKd` = $K_d$) all as `"EC50"`.
- **Minimal Reproduction**:
  Run `{ model: "homologous-competition-logx", ligandConcentration: 1, ecx: 80 }` → crashes with `subscript out of bounds`. Run a global fit on `inhibitor-3pl-x` or `homologous-competition-logx` sharing the midpoint → derived row is labeled `"EC50"`.
- **Suggested Fix**:
  Restrict `params.ecx` to single-site dose-response models, and map `midpoint` accurately in `runGlobalNonlinear` (`"LogIC50"`/`"IC50"` → `"IC50"`, `"LogIC50Hi"`/`"IC50Hi"` → `"IC50 (high affinity)"`, `"LogKd"` → `"Kd"`).

---

### Issue 40: `user-defined.ts` accepts R reserved keywords (`NA`, `Inf`, `NULL`, `TRUE`, `for`, `in`, …) causing R syntax errors, and naming a parameter `HillSlope` causes the fitted curve overlay to render nothing (all `NaN`)
- **Severity**: High
- **Files**:
  - `src/stats/xy/user-defined.ts:61-70, 378-398`
  - `src/stats/xy/nonlinear-regression.ts:97-98`
  - `src/views/graphs/fitted-curve.ts:55-60`
- **Explanation**:
  1. `TERM_LABEL` (`src/stats/xy/nonlinear-regression.ts:97`) renames `"HillSlope"` to `"Hill slope"`. When a user equation defines a parameter `HillSlope`, `parseFit` stores `{ term: "Hill slope" }` in `result.coefficients`, while `fitted-curve.ts:58` looks up `values["HillSlope"]` → `undefined` → `NaN`, drawing no curve.
  2. `RESERVED` (`src/stats/xy/user-defined.ts:70`) only blocks `x`, `y`, `pi`, letting all R keywords/constants (`if`, `else`, `repeat`, `while`, `function`, `for`, `in`, `next`, `break`, `TRUE`, `FALSE`, `NULL`, `Inf`, `NaN`, `NA`, `NA_*`) pass validation and emit invalid R like `start=list(Inf=100,Kd=5)` → R parse error.
- **Minimal Reproduction**:
  - Fit `user-defined` with `"Y = Top / (1 + (EC50/X)^HillSlope)"`: curve overlay is invisible (`NaN`).
  - Fit `user-defined` with `"Y = Inf * X / (Kd + X)"`: `parseUserEquation` succeeds, then R fails with `unexpected '='`.
- **Suggested Fix**:
  Reject R reserved keywords/constants in `user-defined.ts`, and skip `TERM_LABEL` renaming for `"user-defined"` parameters (or map through `termLabel` in `fitted-curve.ts`).

---

### Issue 41: Multiple Linear Regression (`multiple-regression.ts`) miscomputes VIFs, crashes with R syntax error when only categorical predictors are present, and passes raw unaligned columns to `describe()`
- **Severity**: High
- **Files**:
  - `src/stats/multiple/multiple-regression.ts:83-88, 135, 152`
  - `src/stats/multiple/predictors.ts:242-264`
- **Explanation**:
  `selectPredictors` (`src/stats/multiple/predictors.ts:243-248`) filters `predictors` to numeric columns only, while `design` (`length === p`) includes expanded dummy columns for categorical text predictors.
  1. `vifAssigns` (`multiple-regression.ts:83-88`) iterates over `predictors` instead of `design`: when a model has only categorical text predictors with `p >= 2` dummy columns, `predictors` is `[]` and `vifAssigns` is `""`, causing a syntax error in R (`c(..., , cv0_0=...)` → `argument 7 is empty`). When a text predictor precedes numeric predictors, `X[, j + 1]` indexes dummy columns and attaches wrong VIFs to numeric predictor names at line 135.
  2. Line 152 calls `describe([dep, ...predictors])` on raw unaligned columns instead of `describe(alignedGroups(dep, sel.depValues, design))`, computing descriptives on rows dropped from the regression.
- **Minimal Reproduction**:
  On a Multiple Variables table with numeric `Y` and 3-level text column `Group` (`"A"`, `"B"`, `"C"`), run **Multiple regression**: R fails with `Error: argument 7 is empty`.
- **Suggested Fix**:
  Compute `vifAssigns` and `vif` over `design`, and pass `alignedGroups(dep, sel.depValues, design)` to `describe()`.

---

### Issue 42: Three-way ANOVA Games–Howell post-hoc crashes R (`object 'Infinity' not found`) when compared cells have zero variance (identical replicates)
- **Severity**: High
- **Files**:
  - `src/stats/grouped/three-way-anova.ts:137-154, 196-225`
- **Explanation**:
  In `src/stats/grouped/three-way-anova.ts:137`, the Games–Howell branch checks `if (vi.length < 2 || vj.length < 2)` without checking `identical(vi) || identical(vj)` (unlike `two-way-anova.ts:290`). When two compared cells each have identical replicates (e.g. `[10, 10]` and `[12, 12]`), `va === 0 && vb === 0`, `t` is `Infinity` (or `NaN`), and `df` is `NaN`. Line 201 interpolates JS `"Infinity"` directly into R (`ptk(Infinity*sqrt(2), ...)`), crashing R with `object 'Infinity' not found`.
- **Minimal Reproduction**:
  Run `three-way-anova` with `posthoc: "games-howell", posthocTerm: "A:B:C"` on a Grouped table with row groups where two cells have `[10, 10]` and `[12, 12]`.
- **Suggested Fix**:
  Check `if (vi.length < 2 || vj.length < 2 || identical(vi) || identical(vj))` at `src/stats/grouped/three-way-anova.ts:137`.

---

### Issue 43: Sample Size & Power `solveEffect` fails for all valid effects in the upper doubling band (e.g. Pearson `r ∈ (0.8, 1)`, one-proportion `h ∈ (1.6, π]`, t/ANOVA/χ² `∈ (6.4, 10]`), and `power <= alpha` returns bogus `effect ≈ 0`
- **Severity**: High
- **Files**:
  - `src/stats/sample-size-power.ts:155-164, 255-258, 428-435`
- **Explanation**:
  1. `solveEffect` (`src/stats/sample-size-power.ts:428-435`) doubles `hi` (`0.1 → 0.2 → 0.4 → 0.8 → 1.6 → ...`) and throws immediately when `hi >= cap` without clamping `hi` to `cap` and checking `powerAtEffect(cap)`. For `pearson-correlation` (`cap = 0.999999`), `hi` jumps `0.8 → 1.6 >= cap`, failing for every true `r ∈ (0.8, 0.999999]` (e.g., `n = 4..10`); for `one-proportion` (`cap = π`), every `h ∈ (1.6, π]` fails; for t/ANOVA/χ² (`cap = 10`), every effect in `(6.4, 10]` fails.
  2. `validateSampleSizeParams` (`sample-size-power.ts:255-258`) only checks `0 < power < 1`, never `power > alpha`. When `power <= alpha`, `bisect` collapses to `effect ≈ 1e-13`.
- **Minimal Reproduction**:
  - `solveSampleSizePower({ test: "pearson-correlation", solveFor: "effect", n: 6, power: 0.8, alpha: 0.05 })` throws instead of returning `r ≈ 0.924`.
  - `solveSampleSizePower({ test: "two-sample-t", solveFor: "effect", n: 20, power: 0.02, alpha: 0.05 })` returns `effect ≈ 1e-13`.
- **Suggested Fix**:
  Clamp `hi = Math.min(hi * 2, cap)` in `solveEffect` and fail only when `hi === cap && powerAtEffect(cap) < target`; reject `power <= alpha` in `validateSampleSizeParams` when `solveFor !== "power"`.

---

## Medium-Severity Issues

### Issue 44: Missing `core:window:allow-hide` and `core:window:allow-set-focus` capabilities silently break BUG-12 close-quiesce mitigation and non-macOS Window menu switcher
- **Severity**: Medium
- **Files**:
  - `src-tauri/capabilities/default.json:5-12`
  - `src/native.ts:615-620, 1090-1096`
- **Explanation**:
  In Tauri 2, `core:default` omits `core:window:allow-hide` and `core:window:allow-set-focus`. Consequently, `win().hide()` inside `quiesceBeforeClose()` (`src/native.ts:616-620`) silently rejects with a Tauri ACL error (leaving closing windows visible white for 250 ms with their macOS display link still attached), and clicking a background window in the Linux/Windows **Window** menu (`w?.setFocus()` at `src/native.ts:1095`) silently fails to focus it.
- **Suggested Fix**:
  Add `"core:window:allow-hide"` and `"core:window:allow-set-focus"` to `"permissions"` in `src-tauri/capabilities/default.json`.

---

### Issue 45: Box OAuth loopback flow has bind-after-open race, aborts on single non-callback socket, blocks Tokio worker, and leaks thread/port on timeout
- **Severity**: Medium
- **Files**:
  - `src-tauri/src/cloud.rs:446-526` (`wait_for_code`, `ephemeral_loopback_port`)
  - `src-tauri/src/cloud_box.rs:471-483` (`connect_box`)
- **Explanation**:
  `connect_box` binds `127.0.0.1:0` to pick a port, drops the listener, opens the browser, and re-binds later inside `wait_for_code` (racing cached-consent redirects and other processes). `wait_for_code` calls `listener.accept()` only once (so any `/favicon.ico` or speculative preconnect aborts sign-in), blocks the Tokio worker in `rx.recv_timeout(300s)`, and leaks the blocked OS thread and TCP port until exit on timeout.
- **Suggested Fix**:
  Bind `tokio::net::TcpListener::bind(("127.0.0.1", 0)).await` before `open_browser_url`, wrap async `accept()` in `tokio::time::timeout`, and loop past non-`/callback` or empty connections.

---

### Issue 46: Auto-updater `download_update` and `apply_update` block the macOS main thread and accept arbitrary HTTPS URLs / unverified bundles
- **Severity**: Medium
- **Files**:
  - `src-tauri/src/updater.rs:100-127, 150-219`
  - `src-tauri/src/main.rs:1885-1887`
- **Explanation**:
  `download_update` (`curl --max-time 900`) and `apply_update` (`ditto` extraction) are synchronous `#[tauri::command]` functions running on macOS's main thread, freezing the UI during updates. In addition, `download_update(url, sha256, size)` accepts any `https://` URL with caller-supplied hash/size (and `curl` without `--proto-redir =https`), and `apply_update(path, version)` swaps any caller-supplied zip path over `Titer.app` without verifying against `CHANNEL_MANIFEST_URL` or `codesign`.
- **Suggested Fix**:
  Make `download_update` and `apply_update` `async` via `tokio::task::spawn_blocking`, resolve/verify the artifact strictly inside Rust from `CHANNEL_MANIFEST_URL`, restrict redirects to HTTPS, and verify bundle signatures.

---

### Issue 47: Failed `titer_open_project`, `titer_import_prism`, `titer_create_project`, and `titer_cloud_download` leak a blank window and hijack `last_published`
- **Severity**: Medium
- **Files**:
  - `src-tauri/src/mcp.rs:2343, 5632, 5697` (`import_prism_in_new_window`, `create_project`, `open_project`)
  - `src-tauri/src/mcp.rs:1725-1736`
- **Explanation**:
  When `titer_import_prism`, `titer_cloud_download`, `titer_create_project` (invalid template), or `titer_open_project` (unreadable/corrupt `.hlx`) spawns a new blank window (`create_blank_window_bounded`), that window publishes its blank snapshot (setting `McpState.last_published = Some(new_window_id)`). If the subsequent load/import/template step fails, the error is returned while the blank window stays open and hijacks `last_published` for all subsequent project-defaulted MCP calls.
- **Suggested Fix**:
  Close/destroy the newly created window and call `state.clear_window(&project_id)` (restoring prior `last_published`) whenever the load/import/template step fails.

---

### Issue 48: Export tools fail with `"Titer can't access <path>"` whenever the output filename contains a dot (e.g. `Fig 1.2`) or on Windows paths with a dot in a parent directory
- **Severity**: Medium
- **Files**:
  - `src-tauri/src/mcp.rs:9340` (`ensure_export_extension`)
  - `src/native.ts:131-135` (`ensureSaveExtension`)
  - `src-tauri/src/main.rs:600-645` (`check_extension` in `write_file`)
- **Explanation**:
  Both `ensure_export_extension` and `ensureSaveExtension` check whether the basename contains *any* dot rather than ending in the target extension, and split only on `'/'`. Paths without an extension such as `"/tmp/Fig 1.2"` or Windows paths like `C:\Users\alice.smith\Desktop\plot` do not receive `.png`/`.pdf`, causing `write_file`'s `check_extension` to reject them with `"Titer can't access <path>"`.
- **Suggested Fix**:
  Split on both `'/'` and `'\\'` (or `std::path::Path`) and append `.{ext}` unless the filename already ends with a recognized extension for that format.

---

### Issue 49: `analysis-params-schema.json` omits `"none"` from `posthoc` enum for `nested-anova`/`multifactor-anova`, marks defaulted params required for `two-way-anova`/`rm-anova`, and duplicates `"xy"` in `nonlinear-regression.offered_on`
- **Severity**: Medium
- **Files**:
  - `scripts/generate-analysis-params-schema.py:124-125, 494-505`
  - `src-tauri/src/analysis-params-schema.json:1385-1390, 1524-1529, 1563-1567, 2663-2674, 3260-3296`
- **Explanation**:
  `ENUM_OVERRIDES` omits `"none"` for `nested-anova` and `multifactor-anova` `posthoc` (emitting `"enum": ["tukey", "bonferroni"]` alongside `"default": "none"`); `rm-anova.params.posthoc` and `two-way-anova.params.{design,posthoc,posthocTarget}` are marked `"required": true` with no `"default"` despite having runtime defaults; and `nonlinear-regression.offered_on` contains duplicate `"xy"` (`["multiple", "xy", "xy"]`) due to expanding `"interpolate"`.
- **Suggested Fix**:
  Add `"none"` to both `ENUM_OVERRIDES` `posthoc` lists, populate `DEFAULTS` for `rm-anova` and `two-way-anova`, and deduplicate `OFFERED[concrete]`.

---

### Issue 50: `titer_export_all_graphs` and Figure exports omit `deps.run` / `rootOrder`; `buildGraphFigure` diverges from `GraphView` (drops `sourceTableIds`, `frozenData`, `sigAnalysisIds`, number/date formatting)
- **Severity**: Medium
- **Files**:
  - `src/store/mcp-export.ts:421, 518, 651`
  - `src/views/figures/figure-export.ts:56-65`
  - `src/views/graphs/graph-figure.ts:195, 265-273, 370, 532-548`
- **Explanation**:
  `defaultExportAllRender` (`mcp-export.ts:651`) calls `renderGraphImage` without `deps.run`, and `renderFigureSvg`/`renderFigureRaster` (`figure-export.ts`) never pass `deps.run` or `state.rootOrder` into `buildGraphFigure`. Furthermore, `buildGraphFigure` (`graph-figure.ts`) reads `parent.data` directly instead of `mergedGraphData`, ignores `graph.frozenData`, ignores `options.sigAnalysisIds`, and omits `applyNumberFormats` and `applyDateAxis` — causing figure previews/exports and batch/script exports to drop secondary tables, date axes, and multi-analysis significance stars.
- **Suggested Fix**:
  Forward `deps.run` and `rootOrder` through `defaultExportAllRender` and `figure-export.ts`, and align `buildGraphFigure` with `GraphView` (`mergedGraphData`, `frozenData`, `sigAnalysisIdsOf`, `applyNumberFormats`, `applyDateAxis`).

---

### Issue 51: Replicate XY tables break `deming-overlay.ts` & `binding-curve.ts` overlays; `addLogisticCurve` queries three nonexistent stat labels (always displaying `—`)
- **Severity**: Medium
- **Files**:
  - `src/views/graphs/deming-overlay.ts:68-71`
  - `src/views/graphs/binding-curve.ts:139-144, 169-171, 228-235, 314-323`
  - `src/views/graphs/fitted-curve.ts:511-545`
  - `src/stats/xy/logistic-regression.ts:93-106`
- **Explanation**:
  1. `addDeming`, `addBindingCurve`, `addEnzymeInhibitionCurve`, and `addDoseResponseSpecialCurve` match `params.y`/`y2`/`ys` against raw subcolumn names (`"A:Y1"`, `"A:Y2"`) instead of dataset names (`splitXY(columns)`), causing Deming to fall back to `A:Y1`, Binding to fall back to `Total:Y1`/`Total:Y2`, and Enzyme/Special overlays to draw nothing on XY replicate tables.
  2. `addLogisticCurve` (`fitted-curve.ts:537-544`) looks up `"Odds ratio (per unit of X)"`, `"X at 50% probability"`, and `"Tjur's R squared"`, none of which match `logistic-regression.ts` (`"Odds ratio (per 1 unit X)"`, `"McFadden pseudo-R²"`), always displaying `—` for all three values on the graph note.
- **Suggested Fix**:
  Use `splitXY(columns)` + `xyPoints(x, set)` in `deming-overlay.ts` and `binding-curve.ts`; update `addLogisticCurve` to read `"Odds ratio (per 1 unit X)"`, `"McFadden pseudo-R²"`, and compute `-b0 / b1` from `coefficients`.

---

### Issue 52: Renaming a column/group blanks dependent `% of control` transformed tables, edits overwrite frozen transformed tables, and `followTable` misses newly added column-name fields
- **Severity**: Medium
- **Files**:
  - `src/store/use-project-store.tsx:873-919` (`updateTable`)
  - `src/lib/transform.ts:36, 55-60`
  - `src/lib/project-file.ts:2413-2422`
  - `src/store/references.ts:20-43`
- **Explanation**:
  1. When a column/group referenced by a `% of control` transformed table (`t.transform.control`) is renamed, `updateTable` does not remap `t.transform.control`, so `transformTable` fails to find the control series (`mean([]) = NaN`) and blanks every cell in the transformed table to `null`.
  2. Neither `updateTable` (line 914) nor `parseProjectFile` (line 2419) skips frozen transformed tables (`t.frozen === true`), overwriting them when the source table changes.
  3. `references.ts` (`PARAM_NAMES`/`OPTION_NAMES`) omits newer column-name fields (`bubbleSizeVariable`, `bubbleColorVariable`, `controls`, `column`, `columnMathA`, `columnMathB`, `factors`, `fixedFactors`, `grouping`, `subject`, `rowTitles`, `rowFactor`, `columnFactor`, `rowVariable`, `outcome`, `count`, `columns`).
- **Suggested Fix**:
  Remap `t.transform.control` on rename and skip recomputing frozen transformed tables in `updateTable` and `parseProjectFile`; add the missing keys to `PARAM_NAMES`/`OPTION_NAMES`.

---

### Issue 53: `permuteColumns`, `dropColumns`, and `removeCalculatedVariable` corrupt or leak `cellBackgrounds`, `linkedPaste`, `calculated`, `decimals`, `variableTypes`, `labelVariable`, and `levelOrder`
- **Severity**: Medium
- **Files**:
  - `src/views/tables/table-data.ts:417-464` (`permuteColumns`, `dropColumns`)
  - `src/lib/calcvars.ts:1188-1201` (`removeCalculatedVariable`)
- **Explanation**:
  `permuteColumns` omits remapping `cellBackgrounds` (stranding cell colors on wrong columns). `dropColumns` omits remapping `cellBackgrounds` and pruning `decimals`, `variableTypes`, `labelVariable`, and `levelOrder`. `removeCalculatedVariable` leaves `calculated: []` instead of `undefined` when empty (triggering `updated: true` on reload), fails to shift/drop `linkedPaste`, fails to prune MV column metadata, and does not guard against deleting the last data column.
- **Suggested Fix**:
  Remap `cellBackgrounds` in `permuteColumns` and `dropColumns`, prune column metadata in `dropColumns` and `removeCalculatedVariable`, set `calculated: undefined` when empty, and update `linkedPaste` via `linkedPasteAfterDelete` in `removeCalculatedVariable`.

---

### Issue 54: Copying cells in Titer and pasting via Paste Special (default options) inserts a spurious column-header row
- **Severity**: Medium
- **Files**:
  - `src/views/tables/grid.tsx:506-515, 769-781`
  - `src/views/tables/table-data.ts:1271-1292, 1384-1413`
- **Explanation**:
  `onCopy` writes raw cells to `text/plain` and an HTML `<table>` with a prepended `<thead><tr><th>…</th></tr></thead>` column-header row to `text/html` (`toHTMLTable`). Under default options, Paste Special prefers `text/html` via `parseClipboardHTML`, which parses every `<tr>` (`<th>` and `<td>`) and inserts the column headers as row 0 of the pasted data. (Also `decodeHtmlEntities` lacks a `<= 0x10ffff` guard on `String.fromCodePoint`.)
- **Suggested Fix**:
  Skip `<thead>` (or Titer's marked header row) inside `parseClipboardHTML`, and guard `String.fromCodePoint` in `decodeHtmlEntities`.

---

### Issue 55: `.pzfx` XML parser scrambles mixed-content `<Title>`/`<d>` tags (`H<Sub>2</Sub>O` → `"HO2"`), drops `<Font>`-wrapped `<Info>` text, double-decodes CDATA, and matches closing-tag prefixes
- **Severity**: Medium
- **Files**:
  - `src/lib/pzfx.ts:82-99, 167-189, 206-210, 719-729`
- **Explanation**:
  `XmlNode` merges all direct text segments separately from `children`, so `rawChildText` puts all top-level text before inline tags (`<Title>H<Sub>2</Sub>O</Title>` → `"HO2"`). `<Info>` parsing reads `?.text` directly instead of `rawChildText` (dropping `<Font>`-wrapped titles/notes/constants). CDATA sections are entity-decoded on close, closing-tag matching lacks a `>`/whitespace check (`</dExtra>` closes `<d>`), and `decodeEntities` lacks a `<= 0x10ffff` check.
- **Suggested Fix**:
  Preserve ordered text/element child parts in `XmlNode`, decode entities only on non-CDATA text, use `rawChildText` for `<Info>`, and validate closing tags and code points.

---

### Issue 56: Scientific-notation comma-decimal numbers (e.g. `"4,096e+007"`, `"1,5e-3"`) are not normalized in `.pzfx` or `.prism` import and are silently dropped as non-numeric text
- **Severity**: Medium
- **Files**:
  - `src/lib/pzfx.ts:285, 329-334`
  - `src/lib/prism.ts:648-654`
  - `src/lib/numeric.ts:10-18`
- **Explanation**:
  `COMMA_DECIMAL_EVIDENCE` detects comma-decimal scientific notation (`"4,096e+007"`), yet `normalizeNumber` in both `pzfx.ts:332` and `prism.ts:651, 653` only matches `/^-?\d+,\d+$/` (no exponent group). Values like `"4,096e+007"` keep their comma and are dropped as non-numeric `null` by `parseCell`.
- **Suggested Fix**:
  Support the optional exponent `([eE][+-]?\d+)?` (and optional leading `+`) in `normalizeNumber` in both `pzfx.ts` and `prism.ts`.

---

### Issue 57: `prism-script.ts`: `DuplicateDataTable Clear` leaks phantom exclusions, `Import` at `row = 0` drops first CSV row, Survival tables mis-index Y columns by 1, `ExportTable All` without `SetPath` targets `/`, and script table mutations leave calculated variables & transformed tables stale
- **Severity**: Medium
- **Files**:
  - `src/lib/prism-script.ts:452-469, 713-776, 832-904`
  - `src/store/use-project-store.tsx:836-869, 971`
  - `src/store/mcp-document.ts:533`
- **Explanation**:
  1. `DuplicateDataTable Clear` clears `rows` without clearing `data.excluded`, leaving phantom `*` markers.
  2. `Import` passes `pos.r = -1` (row 0) directly to `writeBlock`, dropping row 0 of the CSV instead of updating column headers.
  3. `dataSets` skips column 1 (`X`) only for `"xy"`, omitting `"survival"` and shifting all Survival Y column indices by −1.
  4. `ExportTable All` without `SetPath` treats empty `ctx.path` as `dir = ""`, writing to `"/<table.name>.csv"`.
  5. `ClearTable`, `InsertData`, `Paste`, and `Import` (committed via `applyScript`) never call `recomputeCalculated` or update dependent transformed tables, leaving calculated columns and transformed tables stale.
- **Suggested Fix**:
  Clear `excluded` on `DuplicateDataTable Clear`, reuse `InsertData`'s `pos.r === -1` header handling in `Import`, include `"survival"` in `hasXColumn`, validate `ctx.path` in `ExportTable All`, and recompute calculated variables + dependent transformed tables inside `followChildren`.

---

### Issue 58: `applyRegenDecisions` mutates the project before validating later decisions (creating duplicate graphs on retry), and `mapSidecarGraph` ignores summary formats on grouped `.prism` tables
- **Severity**: Medium
- **Files**:
  - `src/lib/prism-graph-regen.ts:206-212, 365, 596-597, 625-700`
- **Explanation**:
  `applyRegenDecisions` executes `deps.createGraph(...)` and `deps.renameNode(...)` inside the same loop that validates later decisions, so an invalid decision at index 1 throws after mutating the project for index 0 (and retries create duplicates). Also `mapSidecarGraph`'s `case "grouped"` bypasses `errorFor(resolved)` and always defaults to `"sem"`, ignoring `y_sd_n`, `y_cv_n`, `y_single`, and `y_plus_minus`.
- **Suggested Fix**:
  Validate all decisions in a first pass before executing any mutations, and call `errorFor(resolved)` for `case "grouped"` in `mapSidecarGraph`.

---

### Issue 59: `mergeGraphTables` skips the `summaryFormat` mismatch check for XY tables and silently drops extra Nested tables whose name contains `:`
- **Severity**: Medium
- **Files**:
  - `src/lib/multi-table.ts:168-194, 218-234, 357-370`
  - `src/lib/dataset.ts:230-244`
- **Explanation**:
  `mergeGraphTables` only compares `summaryFormatOf` inside `if (!hasXColumn(primary.tableType))`, allowing mixed `mean-sd-n` and `replicates` XY tables to merge and plot subcolumns with the wrong semantics. For Nested tables, `paddedColumn` prefixes `${tableName} — ${col.name}`; if an extra table's name contains `:`, `split(":")` yields 4 parts and `nestedGroupsOf` (`dataset.ts:233-234`) silently drops the entire extra table.
- **Suggested Fix**:
  Check `summaryFormatOf` for `xy` tables too, and sanitize `:` in `tableName` inside `paddedColumn` (or parse from the trailing two `:` segments in `nestedGroupsOf`).

---

### Issue 60: `.prism` import destroys line breaks in Info Sheet `notes` via `plainTitle()` and lacks bounds/type guards on malformed `document.json` / `content.json` and large row/column spreads
- **Severity**: Medium
- **Files**:
  - `src/lib/prism.ts:556-579, 744-749, 812, 832-843, 1083, 1271`
  - `src/lib/prism-write.ts:657-658, 1091`
  - `src/lib/pzfx-write.ts:518`
- **Explanation**:
  `prism.ts:1271` passes `sheet.notesText` through `plainTitle()` → `cleanText()`, collapsing all newlines into single spaces and destroying multi-line info notes on import and round-trip. Unchecked `content.numberOfRows` (`1e9` / `Infinity` / `< 0`) and `null` `document.json` / non-array fields throw uncaught `TypeError`s or hang, and `Math.min(...occupied)`/`Math.max(...arr)` spreads in `prism-write.ts:657-658`, `prism.ts:1083`, and `pzfx-write.ts:518` can overflow the call stack above ~120k entries.
- **Suggested Fix**:
  Preserve `\n` when unwrapping `sheet.notesText`, validate `document.json`/`content.json` shapes and `numberOfRows` bounds, and replace row/column-scaled `Math.min`/`Math.max` spreads with loops.

---

### Issue 61: `report/conclusion.ts`, `report/checks.ts`, and `report/analyzed.ts` produce inverted/misleading conclusions and assumption checks
- **Severity**: Medium
- **Files**:
  - `src/stats/report/conclusion.ts:147-165, 187-193, 223-231, 276-290, 343-350, 484`
  - `src/stats/report/checks.ts:207-224`
  - `src/stats/report/analyzed.ts:31-36, 155-162`
- **Explanation**:
  - `conclusion.ts:189` looks up `"Significant rows (P < 0.05)"` for `multiple-t-tests`, missing `"Significant rows (adjusted P < Q%)"` on FDR runs and always concluding `"don't show a difference"`; line 281 misidentifies `nonlinear-regression` `compareModel` as a 2-dataset comparison (`“Y” and “undefined”`); line 346 uses overall Pearson `"P value"` instead of `"P value (test for trend)"` for Cochran–Armitage trend; line 484 prints `between two plateaus, — and —` on normalized curves; line 229 emits bare SCALE when all correlations are `null`.
  - `checks.ts:209` tests unweighted residuals even when `linear-regression` has `params.weights`, and line 220 checks only the first replicate subcolumn in XY `correlation`.
  - `analyzed.ts:155-162` ignores `params.sets` and counts incomplete rows for `chi-square`, and line 35 excludes `table.sets[0]` even on Multiple Variables `linear-regression`.
- **Suggested Fix**:
  Match `"Significant rows ("` prefix in `conclusion.ts`, distinguish `compareModel` from `compareWith`, read `"P value (test for trend)"` for trend tests, substitute `0`/`100` for normalized models, pass weights/replicates to `checks.ts`, and respect `params.sets`/`params.x` in `analyzed.ts`.

---

### Issue 62: `AICc` in `enzyme-inhibition.ts` (and `nonlinear-regression.ts`) omits the residual-variance parameter (`+ 1`) from `k`; `interpolationCode` drops 95% CIs on tight positive-X ranges; multi-Y centered polynomials share only the first set's `centeredX`
- **Severity**: Medium
- **Files**:
  - `src/stats/xy/enzyme-inhibition.ts:146`
  - `src/stats/xy/nonlinear-regression.ts:112-174, 535, 1319-1365, 1441-1442, 2869-2872`
  - `src/views/graphs/fitted-curve.ts:424, 468`
- **Explanation**:
  1. `enzyme-inhibition.ts:146` (and `nonlinear-regression.ts:535, 1441-1442`) uses `length(cf)` ($p$) instead of $K = p + 1$ in the AICc small-sample correction alongside `AIC(m)` (which includes $\sigma^2$, i.e. $K = p + 1$), miscomputing AICc by up to 16+ units at small $n$.
  2. `interpolationCode` (`nonlinear-regression.ts:1322-1350`) samples `[lo/10, hi*10]` with a single 200-point linear grid; when `(hi - lo) / hi < 0.05`, zero points fall inside `[slo, shi]` (`length(im) == 0`), returning `NA` for the 95% CIs even though `R_INTERP` finds `ix`.
  3. Multi-Y `centered: true` polynomials emit one scalar `centeredX` from `multiSets[0].xs` instead of per-set `XCenter` values, miscentering non-first sets with different missing rows.
- **Suggested Fix**:
  Use `k = p + 1` with `n - k - 1 > 0` guard for AICc, concatenate dedicated sub-grids on `[gLo, slo]`, `[slo, shi]`, and `[shi, gHi]` in `interpolationCode`, and emit per-set `XCenter` for multi-Y `centered: true` polynomials.

---

### Issue 63: `noncentralTCdf` underflows to `0` at `|δ| ≥ 38.57`, causing t-test power to jump discontinuously to `100%` and `solveN` to underestimate `n` at small `df` / strict `α`
- **Severity**: Medium
- **Files**:
  - `src/stats/distributions.ts:306-361`
  - `src/stats/sample-size-power.ts:291-306`
- **Explanation**:
  In `noncentralTCdf` (`src/stats/distributions.ts:330`), `0.5 * Math.exp(-0.5 * lambda)` underflows to `0` when `|delta| >= 38.57`, causing `tPower` to jump discontinuously to `1.0` whenever `tc > delta` (e.g. `df = 1, alpha = 0.01`, where `tc = 63.66`) and causing `solveN` to stop prematurely at `minN = 2`.
- **Suggested Fix**:
  Evaluate Poisson weights in log-space centered at the mode `floor(lambda / 2)` (matching `poissonMixtureWeights` in `distributions.ts:367-389`).

---

### Issue 64: Plugin wizard `kind: "text"` questions reject all non-numeric text, and `MarketplaceDialog` pre-checks `"network"` (and all permissions) by default
- **Severity**: Medium
- **Files**:
  - `src/plugins/analysis-spec.ts:441-449`
  - `src/views/analyses/analysis-wizard.tsx:309-319`
  - `src/views/analyses/wizards.ts:116-126`
  - `src/components/marketplace-dialog.tsx:75-84`
- **Explanation**:
  1. `toWizardQuestions` (`src/plugins/analysis-spec.ts:441-449`) omits `parse` on `kind: "text"` questions, so `Steps` (`analysis-wizard.tsx:309`) falls back to `parseUnknowns` and rejects all non-numeric text.
  2. `MarketplaceDialog.startReview` (`src/components/marketplace-dialog.tsx:81`) sets `initial[p] = record.grantedPermissions.includes(p) || record.grantedPermissions.length === 0`, pre-checking every permission including `"network"` on fresh install and when re-enabling a zero-permission plugin.
- **Suggested Fix**:
  Provide `parse: () => ({})` on plugin `kind: "text"` questions, and default all permissions (especially `"network"`) to unchecked on fresh install / zero-grant re-enable.

---

## Low-Severity Issues

### Issue 65: UI/menu minor defects (duplicate Grubbs' table, duplicate `Fill Down`, shortcut collision, stale `Change Parameters…`)
- **Severity**: Low
- **Files**:
  - `src/views/analyses/analysis-results-view.tsx:748-786`
  - `src/app-menu.ts:471, 497, 753, 796, 871-904`
- **Explanation**:
  1. `analysis-results-view.tsx:748-786` renders the `"Outliers by column"` Grubbs' `<Table>` block twice identically.
  2. `app-menu.ts` lists `Edit ▸ Fill Down` twice (line 471 lacks `!activeTableFrozen`), binds `CmdOrCtrl+Alt+I` to both `New Info Sheet…` (line 753) and `Show/Hide Inspector` (line 796), and omits `activeNodeId`/`activeNode?.analysisType` from `useAppMenu`'s dependency array so **Change Parameters…** enabled state goes stale.
- **Suggested Fix**:
  Remove the duplicate Grubbs' block and duplicate `Fill Down` entry, give `New Info Sheet…` a distinct accelerator, and include `isEditableAnalysis(activeNode)` in `useAppMenu`'s dependencies.

---

### Issue 66: WebR / survival edge cases (`ensurePackages` doubled timeout on claim timeout; `survival-analysis.ts` 2-group HR on `k ≥ 3` and silent `—` on disjoint risk sets)
- **Severity**: Low
- **Files**:
  - `src/stats/webr.ts:743-760, 885-888`
  - `src/stats/survival/survival-analysis.ts:75-81`
  - `src/stats/survival/base.ts:94`
- **Explanation**:
  1. When `claimEvalWithBudget` hits its `budgetMs` timer, `ensurePackages` (`src/stats/webr.ts:888`) proceeds to `installBatch` using the full `timeoutMs` again instead of remaining `deadline - Date.now()`, doubling the timeout budget.
  2. `runSurvival` (`src/stats/survival/survival-analysis.ts:75-81`) unconditionally computes 2-group `mh`/`lr` hazard ratios even when `k >= 3`, and when 2 groups have completely disjoint risk sets (`d$var[1,1] == 0`), reports `P value = —` without explaining why.
- **Suggested Fix**:
  Pass `Math.max(0, deadline - Date.now())` to `installBatch` / race in `ensurePackages`; skip `mh`/`lr` when `k > 2` and validate overlapping risk sets (or emit a clear error) in `survival-analysis.ts`.

---

### Issue 67: [Carryover from Round 1 #28] Pasting wide data into a Nested table silently drops overflow columns without showing the `"Some Values Weren't Pasted"` notice
- **Severity**: Low
- **Files**:
  - `src/views/tables/table-data.ts:161-164` (`columnsBeyond`)
  - `src/views/tables/table-data.ts:123` (`writeBlock`)
- **Explanation**:
  `writeBlock` refuses to auto-append columns when `isGrouped(data) || isNested(data)`, but `columnsBeyond` (`src/views/tables/table-data.ts:163`) still checks only `isGrouped(data)` and returns `0` for Nested tables, silently discarding overflow pasted columns without triggering the warning dialog.
- **Suggested Fix**:
  Update `columnsBeyond` to check `(isGrouped(data) || isNested(data))` and update the warning text to mention Nested tables.
