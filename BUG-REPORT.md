# Titer (Helix) Bug Report — Round 2 (Recheck 5 at `ad3fe0d0`)

Review of `smitpatel316/Helix` (Titer) originally at `HEAD` `d44c1da` (67 findings), rechecked at `b8a2528` (`#68`–`#81`), at `8c877d8` (`#82`–`#97`), at `d4b45130` (`#98`–`#111`), at `c54f5954` (`#112`–`#115`), and at `HEAD` `ad3fe0d0` (`v2.0.6`) across the 65 commits in `2aab5466..ad3fe0d0` (+30 findings `#116`–`#145`).

## Recheck Status at `ad3fe0d0`

This file now lists **active items only**. On Nov 27, 2026 the **76 entries marked Fixed** at Recheck 5 were removed from both the summary table and the detail sections; the full removal audit (entry number, title, and fix evidence for each) is in `BUG-REPORT-cleanup-2026-11-27.md` (committed alongside this file; canonical copy at `~/workspace/.helix-bugsweep/bugreport/BUG-REPORT-cleanup-2026-11-27.md`). Nothing marked Partial, Open, or New was touched.

- **Round 1 (`85f6c91`, 28 issues)**: **28 of 28** fixed — no active items, none listed here.
- **Round 2 (`d44c1da`, #1–#67)**: **23 Partially Fixed** (`#1`, `#6`, `#7`, `#9`, `#10`, `#11`, `#17`, `#19`, `#20`, `#23`, `#24`, `#25`, `#28`, `#29`, `#33`, `#37`, `#45`, `#46`, `#47`, `#50`, `#52`, `#57`, `#60`), **1 Open** (`#4`).
- **Recheck 1 (`b8a2528`, #68–#81)**: **2 Partially Fixed** (`#72`, `#73`), **0 Open**.
- **Recheck 2 (`8c877d8`, #82–#97)**: **4 Partially Fixed** (`#82`, `#89`, `#90`, `#95`), **0 Open**.
- **Recheck 3 (`d4b45130`, #98–#111)**: **9 Partially Fixed** (`#98`, `#99`, `#100`, `#101`, `#103`, `#105`, `#107`, `#108`, `#110`), **0 Open** (`#100` moved Open → Partial at `ad3fe0d0`; `#111` residual NaN-safe guard cleaned up in `b4f6bc07`).
- **Recheck 4 (`c54f5954`, #112–#115)**: **0 active** — all 4 fixed and removed Nov 27, 2026 (note `#112`'s fix `f511dd4e` introduced cross-scale Games–Howell regression `#120`, which remains listed below as active).
- **New in `2aab5466..ad3fe0d0` (#116–#145)**: **30 New** (**15 High**, **14 Medium**, **1 Low**).
- **Active Total**: **69 Active** (**40 High**, **26 Medium**, **3 Low**).
  - *Note*: Several Partial and New entries below carry high-priority regressions or broken runtime integration paths (`#45` macOS OAuth `O_NONBLOCK`, `#98` Linux `xdg-open --`, `#47` `abandon_window` closing already-open windows, `#33` `convertTableToNested` wiping `cachedResult`, `#107` `noncentralTChiSquareLimit` 0.17 CDF error, `#103` `fitLinear` all-`NaN` on identical X, `#25` ragged grouped excluded-cell cursor drift, `#11` release CSP / same-`pluginId` remount, `#116` Flow Tauri `camelCase` IPC mismatch, `#117` `applyTransform` ignoring compensation, `#120` two-way Games–Howell cross-scale regression, and `#121` Linux updater downloading macOS zip).

---

## Summary of Findings

| # | Severity | Status | Area | Issue Title |
| :- | :--- | :--- | :--- | :--- |
| 1 | **High** | Partial | Native IPC / Security | Unrestricted AppleScript execution (RCE), arbitrary file deletion, and ungated file moves in new shell IPC commands |
| 4 | **High** | Open | Plugins / Security | Plugin permission UI spoofing in `permissionChoices`: non-canonical permission order swaps checkbox labels and grants the wrong capability |
| 6 | **High** | Partial | Plugins / Security | Plugin static-gate bypasses (`__TAURI_INTERNALS__` regex typo, `Function()`, R backtick/dynamic dispatch) and `.GlobalEnv` escape in shared WebR |
| 7 | **High** | Partial | Plugins / Security | Path traversal in `manifest.entry` / zip-slip entries in `loadPluginFromZip`, plus unverified manifest ID/version on marketplace install & update |
| 9 | **High** | Partial | Cloud Sync | Cloud conflict "Overwrite" always fails (`expectedVersion ?? handle.version`), while offline-opened remote files silently overwrite remote edits |
| 10 | **High** | Partial | Cloud Auth | Concurrent Box token refresh deletes fresh single-use tokens and signs user out; deleted tokens leave permanent zombie accounts |
| 11 | **High** | Partial | Plugins / Isolation | `PluginIsolationWebview` is non-functional in both dev (`<StrictMode>` teardown) and release builds (Tauri CSP blocks `srcDoc` inline `<script>`s) |
| 17 | **High** | Partial | Graphs / Store | Freezing a graph does not freeze it — `mergedGraphData` always reads live `parent.data` and overrides `frozenData` |
| 19 | **High** | Partial | Store / Document | `use-document.ts` reads stale `latest.current` immediately after `dispatch`, dropping `runOnClose` script changes on close and skipping crash-recovery backup refresh in `revertToSaved` |
| 20 | **High** | Partial | Project File | Save/load round-trip regressions in `project-file.ts`: frozen graphs/figures always reopen `updated: true`, blank/image figure panels trigger false "missing graph" warnings, and `rootOrder`/`orphanedDataSet` mismatches |
| 23 | **High** | Partial | Tabular Import | `.xlsx` import misclassifies custom number formats containing `[Red]`, currency codes, or unit suffixes (`"nM"`, `"mg/mL"`) as dates — silently corrupting numeric data into 1900-era date strings |
| 24 | **High** | Partial | Tabular Import | `.xlsx` / CSV importer corrupts rows on self-closing `<row .../>` and `<t/>` tags, crashes on malformed attributes/entities, and overflows the call stack before `MAX_IMPORT_ROWS` truncation |
| 25 | **High** | Partial | Prism `.prism` Import | `.prism` import drops `summaryFormat` on grouped summary tables (treating Mean/SD/N as raw replicates) and fails to sanitize `:` or pad ragged subcolumns |
| 28 | **High** | Partial | Vector Export (PDF) | PDF vector export corrupts all non-ASCII text (`−`, `R²`, `±`, `µM`, `°C`, `×`) by writing UTF-16BE bytes into single-byte Type1 `Tj` streams |
| 29 | **High** | Partial | Vector Export (PDF/EPS) | Vector PDF/EPS export silently ignores Plotly CSS `px` units (`font-size`, `stroke-width`, `stroke-dasharray`), erases parent `<g>` opacity, and `grayscaleFigure` rewrites series labels matching CSS color names |
| 33 | **High** | Partial | MCP Server | `titer_read_results` returns stale cached results after table mutations and returns `not_computed` for frozen/orphaned/cloned analyses with saved `cachedResult` |
| 37 | **High** | Partial | XY Stats (Nonlinear) | `applyFitOptions` (`transformNlsCall`) silently strips built-in `lower=`/`upper=` bounds on 17+ models whenever weights, fixed params, bounds, or robust/Poisson IRLS are used — and crashes on `logistic-growth` / `gompertz-growth` |
| 45 | **Medium** | Partial | Cloud Auth (Box) | Box OAuth loopback flow has bind-after-open race, aborts on single non-callback socket, blocks Tokio worker, and leaks thread/port on timeout |
| 46 | **Medium** | Partial | Auto-Updater | Auto-updater `download_update` and `apply_update` block the macOS main thread and accept arbitrary HTTPS URLs / unverified bundles |
| 47 | **Medium** | Partial | MCP Server | Failed `titer_open_project`, `titer_import_prism`, `titer_create_project`, and `titer_cloud_download` leak a blank window and hijack `last_published` |
| 50 | **Medium** | Partial | Graphs / Figures Export | `titer_export_all_graphs` and Figure exports omit `deps.run` / `rootOrder`; `buildGraphFigure` diverges from `GraphView` (drops `sourceTableIds`, `frozenData`, `sigAnalysisIds`, number/date formatting) |
| 52 | **Medium** | Partial | Store / Transforms | Renaming a column/group blanks dependent `% of control` transformed tables, edits overwrite frozen transformed tables, and `followTable` misses newly added column-name fields |
| 57 | **Medium** | Partial | Prism Scripts | `prism-script.ts`: `DuplicateDataTable Clear` leaks phantom exclusions, `Import` at `row = 0` drops first CSV row, Survival tables mis-index Y columns by 1, `ExportTable All` without `SetPath` targets `/`, and script table mutations leave calculated variables & transformed tables stale |
| 60 | **Medium** | Partial | Prism `.prism` Import | `.prism` import destroys line breaks in Info Sheet `notes` via `plainTitle()` and lacks bounds/type guards on malformed `document.json` / `content.json` and large row/column spreads |
| 72 | **High** | Partial | Error Reporting | Startup flush race and permanent unsent-duplicate loop in `CrashReportDialog` / `main.tsx` / `mcp_flush_error_log` |
| 73 | **Medium** | Partial | Figures / Freeze | Freezing or re-freezing a graph overrides the snapshot of a previously frozen Figure |
| 82 | **High** | Partial | Graphs / Labels | `formatFigureLabels` HTML-escapes `<br>` and `<b>` across graph overlays, tooltips, and survival tables |
| 89 | **High** | Partial | WebR / Concurrency | `webr.ts` P-12 claim-stamp matching uses a 5-second fuzzy window and never clears `claimStamps` on install/reset/release |
| 90 | **High** | Partial | WebR / Concurrency | `webr.ts` `ensurePackages` resolves as success while packages are still `"loading"` when an evicted joined batch settles after a retry started |
| 95 | **Medium** | Partial | Tabular Import | `parseXlsx` skips self-closing `<si/>` (and `<si ...>` with attributes) in `sharedStrings.xml`, shifting all subsequent cell strings off by 1, and concatenates `<rPh>` phonetic runs |
| 98 | **High** | Partial | Native IPC / Security | `open_file` IPC permits arbitrary executable launch (no extension allowlist), Windows `cmd /C start` shell injection, and macOS `open` flag injection |
| 99 | **High** | Partial | Data Grid / Tables | `pasteNames` (upstream 1.1.1) corrupts Nested tables (`isNested` omitted), drops column metadata/calculated formulas, and cross-renames lead/group collisions |
| 100 | **High** | Partial | Graphs / Format Panel | Upstream 1.1.1 `axisKind` is not wired into `FormatPanel`: `rowsAt: "values"` and `histogram`/`qq-plot` lose X controls, `grouped-stacked`/`residuals` offer dead Log controls, `grouped-hbars` mislabels value axis as `"Y"`, and `scree-plot`/`dendrogram` misdeclare `XY_AXES` |
| 101 | **High** | Partial | Graphs (Horizontal Bars) | Point labels on Horizontal Bars (`grouped-hbars`) with Log scale transform `y` instead of `x`, placing labels at `10^v` off-canvas and `NaN` on row 0 |
| 103 | **Medium** | Partial | XY Stats (Linear) | `2db68ed1` linear-regression centering missed `compare-slopes.ts`, `report/checks.ts`, and `regression-overlay.ts` (crashes or inflates graph CI bands on 13-digit data) |
| 105 | **Medium** | Partial | UI / What's New | `isNewer` and `seenVersion` invert semver pre-release ordering (`2.0.2-rc.1 > 2.0.2`) and reject pre-release / uppercase-`V` seen strings |
| 107 | **Medium** | Partial | Math / Distributions | `noncentralTCdf` overflows `tt * tt` for `|t| ≥ 1.34e154` (returning `normalCdf(-delta)` instead of `1`/`0`) and `noncentralTTwinSeriesModeCentered` breaks at `|δ| ≥ 1e6` / large `df + δ` |
| 108 | **Low** | Partial | UI / What's New | `WhatsNewDialog` `close()` unconditionally overwrites `titer.whats-new-seen` with the running version, regressing the seen marker after a downgrade |
| 110 | **Low** | Partial | Graphs / Ticks | `fitLabels` produces `dtick: NaN` on coincident adjacent ticks (`at[1] === at[0]`), and `graph-view.tsx` checks `!current` after `Plotly.relayout` instead of immediately after `Plotly.react` |
| 116 | **High** | New | Flow / Native IPC | Tauri 2 `camelCase` vs `snake_case` IPC argument mismatch breaks every Flow Tauri command at runtime (and drops `sample_id` in `flow_import_fcs`) |
| 117 | **High** | New | Flow / Store | `applyTransform` (Rust + TS) mutates raw `sample.columns` instead of compensated columns, silently ignoring transforms after compensation and corrupting raw data |
| 118 | **High** | New | Flow / MCP | Split-brain `isFlowEnabled`/`setFlowEnabled` (`feature-flag.ts` vs `store.ts`) keeps all 4 MCP flow executors locked off when enabled via `src/flow/index.ts` or `localStorage` |
| 119 | **High** | New | Flow / Store | `setFlowSampleTransform` omitted from `UNDOABLE`/`MUTATING` in `use-project-store.tsx` — stalls `titer_transform_flow_parameter` for 3 seconds and breaks Undo / dirty tracking |
| 120 | **High** | New | Grouped Stats (2-Way ANOVA) | Two-way ANOVA Games–Howell regression (`f511dd4e`): shifting cell `b` by `a[1]` before `var(b)` destroys `var(b)` across differing cell scales |
| 121 | **High** | New | Auto-Updater | Linux `installUpdate` downloads the ~137 MB macOS `.app.zip`, promises restart-to-install, and crashes into macOS-only `apply_update` (and `!asset && forced` fails to quit) |
| 122 | **High** | New | Flow / Rust DoS | Unbounded `1..=$PAR` loop in `flow.rs::check_datatype` enables permanent main-thread CPU DoS from a ~90-byte FCS file |
| 123 | **High** | New | Flow / Rust FCS | Unchecked slice bounds and arithmetic overflow panics in `flow.rs` staging (`rebuild_dataset`, `shift_other_offsets`, `shifted`) crash the backend on malformed FCS files |
| 124 | **High** | New | Flow / Rust FCS | Case-sensitive and untrimmed FCS keyword matching in `flow.rs` bypasses offset/datatype safety guards and corrupts staged files |
| 125 | **High** | New | Flow / Rust Security | Synchronous file I/O on the macOS main thread (TCC deadlock) + missing `.tfcs` extension/URL/size guards & raw-byte leak in `flow_import_fcs` / `flow_load_sample_file` / `titer_import_fcs` |
| 126 | **High** | New | Flow / Compensation | `parseSpilloverCsv` strips leading `\t` via `.trim()`, breaking every FlowJo TSV matrix, and `Number("")` silently accepts blank cells as `0` |
| 127 | **High** | New | Flow / Transforms | Flow transform math defects (Rust + TS): `solveMonotonic` maps `NaN` → `-2` and `±Infinity` → `0` (unguarded in `viewer.ts`), `arcsinh` allows `A = -M` division by zero, and `log` is non-monotonic below `T·base^{-M}` |
| 128 | **High** | New | Vector Export (PDF/EPS) | PDF and EPS vector exports silently render Arial, Helvetica, and default sans-serif text in `Times-Roman` because `"sans-serif".includes("serif")` is `true` |
| 129 | **High** | New | Data Grid / Clipboard | `Preferences ▸ Data Entry ▸ Clipboard` title options corrupt in-app `⌘C`→`⌘V` / Paste Transposed / Paste Special and disagree on decimal formatting between `toTSV` and `toHTMLTable` |
| 130 | **High** | New | Preferences / Figures | `Preferences ▸ Appearance ▸ Measurement units` (`cm`) creates an impossible-to-satisfy unit mismatch in `FigureView` size validation |
| 131 | **Medium** | New | Graphs / Flow Plots | `flow-density-plot` and `flow-contour-plot` hide all Y-axis controls in `FormatPanel` despite declaring `axes: XY_AXES` |
| 132 | **Medium** | New | Graphs / Axes | `scree-plot`, `silhouette-plot`, and `forest-plot` `axes()` / `logScaleOffered()` contradict their builders on log scales |
| 133 | **Medium** | New | Auto-Updater | Updater lacks concurrency guard (racing on `Titer-update.zip`) and silently reports offline cached manifests as `"up to date"` |
| 134 | **Medium** | New | Flow / Rust FCS | Staging an FCS file with exclusive `text_end == data_start` deletes byte 0 of DATA and misaligns all events |
| 135 | **Medium** | New | Flow / Rust Store | `FlowStore::apply_compensation` bypasses LRU budget eviction (~2× memory), `invert_matrix` can return `NaN`/`Inf` on overflow, and `parse_sidecar` uses unchecked multiplication |
| 136 | **Medium** | New | Flow / Density | `smoothGrid` returns all-`NaN` grids when `sigma <= 0` or `gridDim < Math.ceil(3 * sigma)` |
| 137 | **Medium** | New | Flow / Stats | `computePopulationStats` reports wrong `% Parent`/`% Grandparent`/`% Total` (`100%` or `>100%`) when top-level populations (`parentId: null`) carry predicates |
| 138 | **Medium** | New | Project File / Flow | `readOptions` in `project-file.ts` overwrites `GRAPH_LIMITS` clamping for `flowBins` and `flowDownsampleCap` |
| 139 | **Medium** | New | Store / Flow | `use-project-store.tsx` `case "create"` crashes on regex metacharacters in flow sample/table names (`nextName`), overwrites nodes & duplicates `rootOrder` on colliding `sampleId`, and drifts `rootOrder` vs `parseProjectFile` |
| 140 | **Medium** | New | Preferences / UI | New Preferences (`P-value format`, `Default font`, `Exports folder`) are unwired or non-reactive across primary consumers |
| 141 | **Medium** | New | Preferences / Print | `Preferences ▸ Print ▸ Scale (%)` clamps every keystroke to `[50, 200]`, making it impossible to type multi-digit percentages (`80`, `120`, `150`) |
| 142 | **Medium** | New | Preferences / Store | `Create an Info sheet with each new data table` (`L13`) is skipped by `createTable`, while `createTableWithGraph` bypasses `MAX_INFO_SHEETS`, duplicates `"Info Sheet"` names, reverses `rootOrder`, and ignores `Autocomplete titles` |
| 143 | **Medium** | New | Preferences / Print CSS | Unescaped newlines in `PrintSettings.headerText` break or inject rules into `@media print` CSS in `printPageCss` |
| 144 | **Medium** | New | Preferences / Privacy | `Extended log file` (`L16`) sends `navigator.userAgent` and `location.href` to the remote feedback server despite promising local-log-only detail |
| 145 | **Low** | New | Prism Scripts / Flow | `prism-script.ts` `runScript` stamps `ctx.current` as `{ kind: "table" }` pointing to a non-table `rootOrder[0]` (e.g. a Flow `sample`) |

---

## High-Severity Issues

### Issue 1 [PARTIALLY FIXED]: Unrestricted AppleScript execution (RCE), arbitrary file deletion, and ungated file moves in new shell IPC commands
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (`canonicalize_in_temp_dir` at `src-tauri/src/main.rs:613` now re-checks `check_extension(canonical, allowed)`)
- **Remaining at `d4b45130`**: `canonicalize_in_temp_dir` (`src-tauri/src/main.rs:604-615`) still confines `canonical` only to shared `std::env::temp_dir()` and follows symlinks instead of rejecting them, letting webview IPC read and delete arbitrary other-app `.png`/`.pdf` files (or symlink targets) in `$TMPDIR`.
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

### Issue 6 [PARTIALLY FIXED]: Plugin static-gate bypasses (`__TAURI_INTERNALS__` regex typo, `Function()`, R backtick/dynamic dispatch) and `.GlobalEnv` escape in shared WebR
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (JS `__TAURI_INTERNALS__` & `Function()`, R backtick call heads, and `})` block breakout are now gated)
- **Remaining at `8c877d8`**: (1) `pluginEvalExpression` (`src/stats/webr.ts:387-409, 472-483`) still creates `new.env(parent = globalenv())`, so `assign(..., pos = 1L)` / `pos.to.env(1)` / `<<-` / `globalenv()` / `unlockBinding` still poison `.GlobalEnv`; (2) all 13 R equivalents (`getFromNamespace`, `evalq`, `eval.parent`, `readRDS`, `readBin`, `writeBin`, `loadNamespace`, `requireNamespace`, `webr::install`, `.Internal`, `.Primitive`, `.Fortran`, `.External2`) are still absent from `src/plugins/gates.ts:85-236`; (3) string-quoted call heads (`"eval"(...)`) and unquoted `match.fun(eval)` still bypass `src/plugins/gates.ts:196, 252`.
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

### Issue 7 [PARTIALLY FIXED]: Path traversal in `manifest.entry` / zip-slip entries in `loadPluginFromZip`, plus unverified manifest ID/version on marketplace install & update
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (path traversal and manifest ID/version checks added in `src/plugins/manifest.ts:162-178`, `src/plugins/loader.ts:151-180`, and `src/marketplace/store.ts:199-225`)
- **Remaining at `8c877d8`**: `loadPluginFromZip` (`src/plugins/loader.ts:184-199`) still decompresses each entry via `await entry.async("string")` (with no `try/catch`) *before* checking `MAX_PLUGIN_ZIP_ENTRY_BYTES`, leaving it vulnerable to zip-bomb OOM.
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

### Issue 9 [PARTIALLY FIXED]: Cloud conflict "Overwrite" always fails (`expectedVersion ?? handle.version`), while offline-opened remote files silently overwrite remote edits
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (core Overwrite `force=true`, cache `.meta.json` sidecar, unknown-version conflict, and MCP `force=false` fixed)
- **Remaining at `c54f5954`**: `openOfflineCopy` (`src/store/use-document.ts:552-557`) falls back to `cachedVersion ?? handle.version` when loading a legacy cache with no `.meta.json` sidecar — when triggered via `RemotePickerDialog` (`src/components/remote-picker.tsx:100-112`, which populates `handle.version` from the online folder listing before disconnect), saving after reconnect stamps the remote's latest version onto older cached bytes and silently overwrites newer remote edits.
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

### Issue 10 [PARTIALLY FIXED]: Concurrent Box token refresh deletes fresh single-use tokens and signs user out; deleted tokens leave permanent zombie accounts
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (per-account cached `BoxClient`, `tokio::sync::Mutex` refresh serialization lock, and safe `cloud_disconnect` registry cleanup fixed in `src-tauri/src/cloud_box.rs` and `src-tauri/src/main.rs`)
- **Remaining at `c54f5954`**: Concurrent `401` retries in `BoxClient::send_authed` (`src-tauri/src/cloud_box.rs:742-759`) unconditionally zero `tokens.expires_at_unix = 0` without checking whether `self.tokens` still holds the failing `token` (clobbering a freshly refreshed token's expiry); in `BoxClient::revoke` (`src-tauri/src/cloud_box.rs:1003, 1025`), early `?` on `load_byo_credentials` can skip `delete_tokens`.
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

### Issue 11 [PARTIALLY FIXED]: `PluginIsolationWebview` is non-functional in both dev (`<StrictMode>` teardown) and release builds (Tauri CSP blocks `srcDoc` inline `<script>`s)
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (StrictMode mount/cleanup teardown fixed in `src/plugins/isolation-view.tsx:129-135` and `srcDoc` replaced by `public/plugin-isolation.html` + `public/plugin-isolation.js`)
- **Remaining at `c54f5954`**: (1) In release builds, `<iframe sandbox="allow-scripts" src="/plugin-isolation.html">` (`src/plugins/isolation-view.tsx:144-145`) runs with an opaque `null` origin (no `allow-same-origin`), so Tauri's `script-src 'self'` CSP (`src-tauri/tauri.conf.json:39`) still refuses to load `./plugin-isolation.js` (`public/plugin-isolation.html:22`); (2) `key={session.pluginId}` (`isolation-view.tsx:135, 142`) never remounts the iframe or executes new `session.source` when `session` is replaced for the same `pluginId` (`public/plugin-isolation.js:40-41` ignores re-init).
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

### Issue 17 [PARTIALLY FIXED]: Freezing a graph does not freeze it — `mergedGraphData` always reads live `parent.data` and overrides `frozenData`
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (`setGraphFrozen` snapshots extra `sourceTableIds` into `frozenDataByTable` at `src/store/use-project-store.tsx:757-763`, `mergedGraphData` reads `graph.frozenDataByTable` at `src/lib/multi-table.ts:106`, and `GraphView` uses `overlayAnalysisData` at `src/views/graphs/graph-view.tsx:452`)
- **Remaining at `c54f5954`**: `buildGraphFigure` (`src/views/graphs/graph-figure.ts:511-516`) still bypasses `overlayAnalysisData` for frozen significance analyses (running them against live `nodes[a.parentId]?.data` — shared with `#50`), and `frozenDataByTable` is never pruned when an extra source table is removed (shared with `#20`).
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

### Issue 19 [PARTIALLY FIXED]: `use-document.ts` reads stale `latest.current` immediately after `dispatch`, dropping `runOnClose` script changes on close and skipping crash-recovery backup refresh in `revertToSaved`
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (`waitForScriptCommit` and `revertToSaved` backup refresh fixed in `src/store/use-document.ts`)
- **Remaining at `c54f5954`**: Regression in `quitSaveAllowed` (`src/store/use-document.ts:1649-1670`) keeps `run.changed` OR'd (`:1656`) on the post-settle re-check (`:1666`), unconditionally triggering a redundant second disk write / Box upload on close after any `runOnClose` script edit.
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

### Issue 20 [PARTIALLY FIXED]: Save/load round-trip regressions in `project-file.ts`: frozen graphs/figures always reopen `updated: true`, blank/image figure panels trigger false "missing graph" warnings, and `rootOrder`/`orphanedDataSet` mismatches
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (frozen graph/figure `updated: true`, all 22 `DATA_KEYS` in `readFrozenData`, blank/image figure panel false warning, and `repointAnalysis` `orphanedDataSet` cleanup fixed in `src/lib/project-file.ts:187-194, 1817-1851, 2625-2627` and `src/store/use-project-store.tsx:582`)
- **Remaining at `c54f5954`**: (1) `rootOrder` insertion (`src/store/use-project-store.tsx:390-412, 734-740`) ignores orphaned analyses, appending newly created tables/infos/figures after orphans and reopening `updated: true`; (2) `frozenDataByTable` is never pruned when an extra source table is deleted or removed via `setGraphSources` (`use-project-store.tsx:501-510, 1160-1174`, `project-file.ts:2687-2700`).
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

### Issue 23 [PARTIALLY FIXED]: `.xlsx` import misclassifies custom number formats containing `[Red]`, currency codes, or unit suffixes (`"nM"`, `"mg/mL"`) as dates — silently corrupting numeric data into 1900-era date strings
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (`isDateFormatCode` at `src/lib/tabular-import.ts:195-205` now strips `[Red]` and `"..."` literals)
- **Remaining at `8c877d8`**: `parseXlsx` (`src/lib/tabular-import.ts:304`) never calls `decodeEntities(code)`, so real Excel XML `formatCode="0.0 &quot;nM&quot;"` still strips nothing and corrupts numeric columns to 1900 dates; `excelSerialToIso` (`211-218`) still lacks a non-finite `Date` guard; and `[hh]`/`[mm]`/`[ss]` elapsed-time tokens are stripped (`202-203`).
- **Files**:
  - `src/lib/tabular-import.ts:178, 267-288, 326-333`
- **Explanation**:
  `isDateFormatCode` (`src/lib/tabular-import.ts:178`) tests custom Excel `formatCode` strings with `/y{1,4}|m{1,2}|d{1,2}|h{1,2}|s{1,2}/i.test(code)` without stripping bracketed color/condition/locale tokens (`[Red]`, `[Yellow]`, `[$USD]`, `[$CHF]`), quoted literal text (`"nM"`, `"mg/mL"`, `"cells"`), or backslash-escaped characters (`\m`). Standard Excel custom numeric formats like `#,##0.00;[Red](#,##0.00)`, `0.00;[Red]-0.00`, or `0.0 "nM"` match `d` (in `[Red]`) or `m`/`s`/`y`/`h`, get added to `dateStyles` (line 283), and pass every number in that column through `excelSerialToIso(serial)` — silently converting numeric data into 1900-era ISO date strings (or `"NaN-NaN-NaN NaN:NaN"` for large values).
- **Minimal Reproduction**:
  Import any `.xlsx` file with a numeric column formatted as `0.00;[Red]-0.00` or `0.0 "nM"` containing `[12.5, 100, -3.4]`: they import as `["1900-01-11 12:00", "1900-04-09", "1899-12-26 14:24"]`.
- **Suggested Fix**:
  Decode XML entities in `formatCode` first, strip quoted strings (`"[^"]*"`), bracket tokens (`\[[^\]]*\]` except elapsed-time `[h]`/`[m]`/`[s]`), and escaped chars (`\\.`), and only treat the code as a date format if date/time tokens remain (also guarding `excelSerialToIso` against non-finite `Date` results).

---

### Issue 24 [PARTIALLY FIXED]: `.xlsx` / CSV importer corrupts rows on self-closing `<row .../>` and `<t/>` tags, crashes on malformed attributes/entities, and overflows the call stack before `MAX_IMPORT_ROWS` truncation
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (self-closing `<row/>` and `<t/>`, `Math.max` stack overflow, `decodeEntities` range checks, and `attrOf` boundaries fixed in `src/lib/tabular-import.ts`)
- **Remaining at `8c877d8`**: Malformed `rowRef` values (`"0"`, `"abc"`) still throw `TypeError` (`src/lib/tabular-import.ts:329-341`), and huge row/col refs allocate unbounded arrays before `MAX_IMPORT_ROWS` / `MAX_IMPORT_COLUMNS` truncation.
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

### Issue 25 [PARTIALLY FIXED]: `.prism` import drops `summaryFormat` on grouped summary tables (treating Mean/SD/N as raw replicates) and fails to sanitize `:` or pad ragged subcolumns
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (re-applied grouped summary format, `:` sanitization, and ragged padding in `4860fc4d` at `src/lib/prism.ts:1163-1215`)
- **Remaining at `c54f5954`**: (1) **Regression**: Ragged grouped `.prism` import advances `colCursor += entry.count` instead of `replicates` (`src/lib/prism.ts:1337-1342`), shifting every subsequent group's `EXCLUDED` cells onto wrong columns (and `replicates` ignores `entry.count > replicatesCount`); (2) **Regression**: `groupFormat` (`src/lib/prism.ts:1171-1178`) checks `setFormat` before `table.dataFormat`, reversing BUG-9 precedence and misreading grouped `y_cv_n` tables whose datasets say `y_sd_n` as Mean/SD/N.
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

### Issue 28 [PARTIALLY FIXED]: PDF vector export corrupts all non-ASCII text (`−`, `R²`, `±`, `µM`, `°C`, `×`) by writing UTF-16BE bytes into single-byte Type1 `Tj` streams
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (PDF `/WinAnsiEncoding` + `/Symbol` Greek routing fixed in `src/lib/vector-export.ts:1297-1418, 1490-1588`)
- **Remaining at `8c877d8`**: EPS `psEscape` (`src/lib/vector-export.ts:1615-1617, 1696-1714`) still emits WinAnsi bytes into un-reencoded Adobe `StandardEncoding` fonts (corrupting `R²`, `±`, `°`, `µ`, `×`, `–`, `—`) and never splits Greek to `/Symbol` (throwing `VectorExportError` with no fallback).
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

### Issue 29 [PARTIALLY FIXED]: Vector PDF/EPS export silently ignores Plotly CSS `px` units (`font-size`, `stroke-width`, `stroke-dasharray`), erases parent `<g>` opacity, and `grayscaleFigure` rewrites series labels matching CSS color names
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (`stroke-width`, `stroke-dasharray`, opacity multiplication, and `grayscaleFigure` key scoping fixed in `src/lib/vector-export.ts`)
- **Remaining at `8c877d8`**: Regression from `aaaebf4`: `fontSizeOf` (`src/lib/vector-export.ts:380-393`) and `svgLength` (`840`) only strip `px`, breaking `pt`/`in`/`cm`/`mm`/`pc` font sizes.
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

### Issue 33 [PARTIALLY FIXED]: `titer_read_results` returns stale cached results after table mutations and returns `not_computed` for frozen/orphaned/cloned analyses with saved `cachedResult`
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (`read_results` falls back to `node.cachedResult`, `removeDataSet` preserves orphaned `cachedResult`, and `updateTable` / MCP mutations invalidate non-frozen child results)
- **Remaining at `c54f5954`**: (1) **High regression**: `convertTableToNested` (`src/store/use-project-store.tsx:1079-1120`) calls `updateTable` without snapshotting/restoring `cachedResult` (unlike `removeDataSet` in `34c71e84`), permanently wiping saved results of every column analysis it orphans; (2) Metadata-only table edits (`set-x-format`, `set-variable-type`, `set-level-order` at `use-project-store.tsx:966-980`) and `titer_run_script` (`src/lib/prism-script.ts:448-463`) never clear `cachedResult`, so `titer_read_results` still returns stale pre-edit numbers; (3) UI table edits after an analysis error leave stale `{ error }` in `McpInner.results` (`src-tauri/src/mcp.rs:2906-2912`).
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

### Issue 37 [PARTIALLY FIXED]: `applyFitOptions` (`transformNlsCall`) silently strips built-in `lower=`/`upper=` bounds on 17+ models whenever weights, fixed params, bounds, or robust/Poisson IRLS are used — and crashes on `logistic-growth` / `gompertz-growth`
- **Severity**: High
- **Status**: Partially Fixed at `8c877d8` (`transformNlsCall` preserves built-in bounds and handles `start=local({...})`)
- **Remaining at `8c877d8`**: `runGlobalNonlinear` (`src/stats/xy/nonlinear-regression.ts:1809`) still omits built-in bounds, `warmStartFit` (`src/stats/xy/nonlinear-fit.ts:2993`) still fails to parse `local(`, and `nlsDerivTol` (`src/stats/xy/nonlinear-fit.ts:445-446`) leaves fixed params in `deriv()`'s theta list.
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

## Medium-Severity Issues

### Issue 45 [PARTIALLY FIXED]: Box OAuth loopback flow has bind-after-open race, aborts on single non-callback socket, blocks Tokio worker, and leaks thread/port on timeout
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (bind-before-open, multi-accept loop, `spawn_blocking`, and stop-flag thread join fixed in `src-tauri/src/cloud.rs` and `src-tauri/src/cloud_box.rs`)
- **Remaining at `c54f5954`**: **High macOS regression**: `wait_for_code` (`src-tauri/src/cloud.rs:549`) calls `listener.set_nonblocking(true)` and `handle_loopback_connection` (`:461-472`) never calls `stream.set_nonblocking(false)`. On macOS/BSD, `accept()` inherits `O_NONBLOCK`, so `read_line` hits `WouldBlock` whenever callback bytes aren't already buffered and silently drops the OAuth callback connection until the 5-minute timeout.
- **Files**:
  - `src-tauri/src/cloud.rs:446-526` (`wait_for_code`, `ephemeral_loopback_port`)
  - `src-tauri/src/cloud_box.rs:471-483` (`connect_box`)
- **Explanation**:
  `connect_box` binds `127.0.0.1:0` to pick a port, drops the listener, opens the browser, and re-binds later inside `wait_for_code` (racing cached-consent redirects and other processes). `wait_for_code` calls `listener.accept()` only once (so any `/favicon.ico` or speculative preconnect aborts sign-in), blocks the Tokio worker in `rx.recv_timeout(300s)`, and leaks the blocked OS thread and TCP port until exit on timeout.
- **Suggested Fix**:
  Bind `tokio::net::TcpListener::bind(("127.0.0.1", 0)).await` before `open_browser_url`, wrap async `accept()` in `tokio::time::timeout`, and loop past non-`/callback` or empty connections.

---

### Issue 46 [PARTIALLY FIXED]: Auto-updater `download_update` and `apply_update` block the macOS main thread and accept arbitrary HTTPS URLs / unverified bundles
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (all updater commands run via `spawn_blocking`, `download_update` pins `CHANNEL_MANIFEST_URL` + SHA-256 + path confinement in `src-tauri/src/updater.rs`)
- **Remaining at `c54f5954`**: `fetch_channel_manifest_sync` (`src-tauri/src/updater.rs:100-105`) omits `--proto =https --proto-redir =https`; releases remain unsigned (no `codesign` or Ed25519 signature check); Linux uses a predictable `/tmp` staging dir.
- **Files**:
  - `src-tauri/src/updater.rs:100-127, 150-219`
  - `src-tauri/src/main.rs:1885-1887`
- **Explanation**:
  `download_update` (`curl --max-time 900`) and `apply_update` (`ditto` extraction) are synchronous `#[tauri::command]` functions running on macOS's main thread, freezing the UI during updates. In addition, `download_update(url, sha256, size)` accepts any `https://` URL with caller-supplied hash/size (and `curl` without `--proto-redir =https`), and `apply_update(path, version)` swaps any caller-supplied zip path over `Titer.app` without verifying against `CHANNEL_MANIFEST_URL` or `codesign`.
- **Suggested Fix**:
  Make `download_update` and `apply_update` `async` via `tokio::task::spawn_blocking`, resolve/verify the artifact strictly inside Rust from `CHANNEL_MANIFEST_URL`, restrict redirects to HTTPS, and verify bundle signatures.

---

### Issue 47 [PARTIALLY FIXED]: Failed `titer_open_project`, `titer_import_prism`, `titer_create_project`, and `titer_cloud_download` leak a blank window and hijack `last_published`
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`abandon_window` and `prev_last_published` cover new blank windows in `src-tauri/src/mcp.rs`)
- **Remaining at `c54f5954`**: (1) **High regression**: `titer_open_project` and `titer_cloud_download` (`src-tauri/src/mcp.rs:6709-6740, 9105-9130`) call `abandon_window` even when `open_bounded` returned an **already-open** window label — if that window carries a stale `openError`, `abandon_window` force-closes the user's active project window with `save: "discard"` (`src-tauri/src/main.rs:179-189`); (2) an unclosed window (e.g. blocked by `native.alert`) can re-publish and re-hijack `last_published` (`mcp.rs:3239-3250`).
- **Files**:
  - `src-tauri/src/mcp.rs:2343, 5632, 5697` (`import_prism_in_new_window`, `create_project`, `open_project`)
  - `src-tauri/src/mcp.rs:1725-1736`
- **Explanation**:
  When `titer_import_prism`, `titer_cloud_download`, `titer_create_project` (invalid template), or `titer_open_project` (unreadable/corrupt `.hlx`) spawns a new blank window (`create_blank_window_bounded`), that window publishes its blank snapshot (setting `McpState.last_published = Some(new_window_id)`). If the subsequent load/import/template step fails, the error is returned while the blank window stays open and hijacks `last_published` for all subsequent project-defaulted MCP calls.
- **Suggested Fix**:
  Close/destroy the newly created window and call `state.clear_window(&project_id)` (restoring prior `last_published`) whenever the load/import/template step fails.

---

### Issue 50 [PARTIALLY FIXED]: `titer_export_all_graphs` and Figure exports omit `deps.run` / `rootOrder`; `buildGraphFigure` diverges from `GraphView` (drops `sourceTableIds`, `frozenData`, `sigAnalysisIds`, number/date formatting)
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`deps.run`/`rootOrder` forwarded through `mcp-export.ts` and `figure-export.ts`; `buildGraphFigure` now uses `mergedGraphData`, `sigAnalysisIds`, `applyNumberFormats`, and `applyDateAxis`)
- **Remaining at `c54f5954`**: `buildGraphFigure` (`src/views/graphs/graph-figure.ts:511-516`) still bypasses `overlayAnalysisData` for frozen significance analyses, and `figure-export.ts` (`src/views/figures/figure-export.ts:157-322`) never calls `frozenFigureNodes` so frozen Figures still export live/re-frozen data (shared with `#17` & `#73`).
- **Files**:
  - `src/store/mcp-export.ts:421, 518, 651`
  - `src/views/figures/figure-export.ts:56-65`
  - `src/views/graphs/graph-figure.ts:195, 265-273, 370, 532-548`
- **Explanation**:
  `defaultExportAllRender` (`mcp-export.ts:651`) calls `renderGraphImage` without `deps.run`, and `renderFigureSvg`/`renderFigureRaster` (`figure-export.ts`) never pass `deps.run` or `state.rootOrder` into `buildGraphFigure`. Furthermore, `buildGraphFigure` (`graph-figure.ts`) reads `parent.data` directly instead of `mergedGraphData`, ignores `graph.frozenData`, ignores `options.sigAnalysisIds`, and omits `applyNumberFormats` and `applyDateAxis` — causing figure previews/exports and batch/script exports to drop secondary tables, date axes, and multi-analysis significance stars.
- **Suggested Fix**:
  Forward `deps.run` and `rootOrder` through `defaultExportAllRender` and `figure-export.ts`, and align `buildGraphFigure` with `GraphView` (`mergedGraphData`, `frozenData`, `sigAnalysisIdsOf`, `applyNumberFormats`, `applyDateAxis`).

---

### Issue 52 [PARTIALLY FIXED]: Renaming a column/group blanks dependent `% of control` transformed tables, edits overwrite frozen transformed tables, and `followTable` misses newly added column-name fields
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`% of control` rename, frozen transform skip, and top-level `PARAM_NAMES`/`OPTION_NAMES` updated in `src/store/use-project-store.tsx` and `src/store/references.ts`)
- **Remaining at `c54f5954`**: `followTable` (`src/store/references.ts:82-100`) still misses `TransformDataParams.constants` and nested `SelectTransformParams` fields (`transforms[].variable`, `rowFilter.variable`, `columnFilter.variable`, `columnFilter.otherVariable`); `use-project-store.tsx:984` skips remapping `t.transform.control` while a transformed table is frozen (`if (t.frozen) continue;`).
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

### Issue 57 [PARTIALLY FIXED]: `prism-script.ts`: `DuplicateDataTable Clear` leaks phantom exclusions, `Import` at `row = 0` drops first CSV row, Survival tables mis-index Y columns by 1, `ExportTable All` without `SetPath` targets `/`, and script table mutations leave calculated variables & transformed tables stale
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`DuplicateDataTable Clear`, Survival Y indexing, `ExportTable All` bare filename, and `followChildren` calcvar/transform refresh fixed in `src/lib/prism-script.ts`)
- **Remaining at `c54f5954`**: `Import` with `row = 0` (`src/lib/prism-script.ts:915-927`) throws `TypeError` on empty CSV (`block[0]` undefined); `followChildren` (`src/lib/prism-script.ts:448-463`) overwrites frozen transform tables (`!t.frozen` missing) and leaves stale `cachedResult` on non-frozen child analyses.
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

### Issue 60 [PARTIALLY FIXED]: `.prism` import destroys line breaks in Info Sheet `notes` via `plainTitle()` and lacks bounds/type guards on malformed `document.json` / `content.json` and large row/column spreads
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (re-applied in `4860fc4d`: Info Sheet `notes` newlines and malformed JSON / `numberOfRows` guards fixed in `src/lib/prism.ts`)
- **Remaining at `c54f5954`**: `writePrism` (`src/lib/prism-write.ts:738-739`) still spreads per-row `occupied` Set into `Math.min(...occupied)` / `Math.max(...occupied)`, causing a call-stack overflow above ~125k occupied rows.
- **Files**:
  - `src/lib/prism.ts:556-579, 744-749, 812, 832-843, 1083, 1271`
  - `src/lib/prism-write.ts:657-658, 1091`
  - `src/lib/pzfx-write.ts:518`
- **Explanation**:
  `prism.ts:1271` passes `sheet.notesText` through `plainTitle()` → `cleanText()`, collapsing all newlines into single spaces and destroying multi-line info notes on import and round-trip. Unchecked `content.numberOfRows` (`1e9` / `Infinity` / `< 0`) and `null` `document.json` / non-array fields throw uncaught `TypeError`s or hang, and `Math.min(...occupied)`/`Math.max(...arr)` spreads in `prism-write.ts:657-658`, `prism.ts:1083`, and `pzfx-write.ts:518` can overflow the call stack above ~120k entries.
- **Suggested Fix**:
  Preserve `\n` when unwrapping `sheet.notesText`, validate `document.json`/`content.json` shapes and `numberOfRows` bounds, and replace row/column-scaled `Math.min`/`Math.max` spreads with loops.

---

## New Issues Found in Recheck at `b8a2528` (#68–#81)

### Issue 72 [PARTIALLY FIXED]: Startup flush race and permanent unsent-duplicate loop in `CrashReportDialog` / `main.tsx` / `mcp_flush_error_log`
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (startup flush await in `src/lib/error-log.ts:116-128`, `src/main.tsx:42`, `src/components/crash-report-dialog.tsx:54` and flush-vs-flush `ERROR_LOG_FLUSH_LOCK` in `src-tauri/src/mcp.rs:1718, 1729` fixed)
- **Remaining at `d4b45130`**: (1) `mcp_log_error` (`src-tauri/src/mcp.rs:1700-1704`) still saves live `ErrorSendOutcome::Duplicate` entries as `sent = false`; (2) lost-update race between `flush_error_log_entries` (`1728-1769`) and `mcp_log_error`/`record_rust_panic` (`1704, 1812`) wipes errors appended during an in-flight flush.
- **Files**:
  - `src/main.tsx:37-42, 50-57`
  - `src/components/crash-report-dialog.tsx:38-60, 62-77, 150-155`
  - `src-tauri/src/mcp.rs:1558-1574, 1619-1641`
- **Explanation**:
  1. `src/main.tsx:39` fires `void mcpFlushErrorLog()` without awaiting it and mounts `<AppShell />` immediately. `CrashReportDialog` mounts milliseconds later and reads `mcpErrorLog()` while HTTP POSTs are still in flight and entries still have `sent: false`, popping up spuriously, racing concurrent flushes on `error-log.jsonl`, and falsely showing `"The reports couldn't be sent..."` if the startup flush finishes first (`sent: 0`).
  2. In `mcp_flush_error_log` (`src-tauri/src/mcp.rs:1628-1638`), entries skipped by `sent_this_flush` or the 1-hour dedup window in `try_send_error_entry` never get marked `sent = true`, leaving duplicate entries as `sent: false` forever and re-triggering `CrashReportDialog` on every subsequent launch with `sent: 0`.
- **Minimal Reproduction**:
  With error-report sharing enabled and 1 unsent entry in `error-log.jsonl`, launch Titer during a normal 100–500 ms network request: `CrashReportDialog` pops up before the startup flush finishes, and clicking **Send reports** after 1 second reports `"The reports couldn't be sent..."`. Or log two identical errors while offline, then flush: the second remains `sent: false` permanently.
- **Suggested Fix**:
  Await the shared startup `mcpFlushErrorLog()` promise inside `CrashReportDialog` before reading `mcpErrorLog()`, serialize `mcp_flush_error_log` in Rust with an async mutex, and mark deduplicated entries as handled (`sent = true` or a `deduplicated` state).

---

### Issue 73 [PARTIALLY FIXED]: Freezing or re-freezing a graph overrides the snapshot of a previously frozen Figure
- **Severity**: Medium
- **Status**: Partially Fixed at `d4b45130` (`frozenFigureNodes` at `src/views/figures/panel-figure.ts:29-42` and `FigureView` at `src/views/figures/figure-view.tsx:211-214, 888-889` prevent on-screen re-frozen graph override)
- **Remaining at `d4b45130`**: (1) Freezing a Figure containing an already-frozen graph snapshots live `parent.data` (`src/store/use-project-store.tsx:766-771`), immediately overwriting the frozen graph panel on screen; (2) Figure export/copy (`src/views/figures/figure-view.tsx:396, 406, 717` and `src/views/figures/figure-export.ts:142-305`) never calls `frozenFigureNodes(figure, nodes)` and exports live/re-frozen data; (3) multi-table graphs inside frozen Figures do not snapshot `sourceTableIds` and retain live `frozenDataByTable`.
- **Files**:
  - `src/lib/multi-table.ts:87`
  - `src/views/graphs/graph-figure.ts:193, 361`
  - `src/views/figures/panel-figure.ts:37-42`
  - `src/views/figures/figure-view.tsx:208-217, 890-895`
- **Explanation**:
  `FigureView` (`src/views/figures/figure-view.tsx:208-217`) hands frozen Figure snapshots to `<PanelPlot>` by overriding `next[parent.id] = { ...parent, data }` in `figureNodes` while still passing the live `graph` node. Because `mergedGraphData` (`src/lib/multi-table.ts:87`) and `figureInputs`/`buildGraphFigure` (`src/views/graphs/graph-figure.ts:193, 361`) now prefer `graph.frozen && graph.frozenData` over `parent.data`, freezing a graph after editing its table (or unfreezing and re-freezing it) silently overrides the snapshot displayed in any already-frozen Figure containing that graph.
- **Minimal Reproduction**:
  Create Table 1 (`v1`), Graph 1, and Figure 1 containing Graph 1; freeze Figure 1; edit Table 1 to `v2`; freeze Graph 1; switch back to frozen Figure 1 → panel displays `v2` instead of `v1`.
- **Suggested Fix**:
  In `FigureView` (`src/views/figures/figure-view.tsx:208-217, 891`), also override the graph entry in `figureNodes` with `{ ...graph, frozen: true, frozenData: data }` and pass `figureNodes[panel.graphId]` to `<PanelPlot>`.

---

## New Issues Found in Recheck 2 at `8c877d8` (#82–#97)

### Issue 82 [PARTIALLY FIXED]: `formatFigureLabels` HTML-escapes `<br>` and `<b>` across graph overlays, tooltips, and survival tables
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (`SAFE_TAG` in `src/lib/label-format.ts:158` preserves `<br>`, `<b>`, `<i>`)
- **Remaining at `d4b45130`**: Regression in `isAlreadyFormatted` (`src/lib/label-format.ts:124-152`) returns `true` on any `<br>`/`<b>`/`<i>`-bearing raw label without checking for unformatted `^`, `_`, or `>`, silently disabling super/subscript formatting in tooltips and multi-line notes (e.g. `"H_2O<br>CO_2"` stays raw).
- **Files**:
  - `src/lib/label-format.ts:104-126, 157-191` (`formatLabelForPlotly`, `formatFigureLabels`)
  - `src/views/graphs/graph-figure.ts:281, 798`
  - `src/views/graphs/graph-view.tsx:874`
  - `src/views/figures/panel-figure.ts:56`
  - `src/views/graphs/survival.ts:162`
- **Explanation**:
  `formatLabelForPlotly` (`src/lib/label-format.ts:104-126`) HTML-escapes `<` and `>` unconditionally unless `<sup>` or `<sub>` is already present in the string, and `formatFigureLabels` applies it broadly across `layout.annotations`, trace `text`, trace `hovertext`, and `trace.name`. As a result, intentional HTML formatting breaks across multiple graph surfaces:
  - Curve-fit and equation notes using `<br>` render literal `&lt;br&gt;`.
  - Volcano and bubble hover tooltips using `<br>` display literal `&lt;br&gt;` instead of line breaks.
  - Survival number-at-risk table headers (`"<b>Number at risk</b>"` in `src/views/graphs/survival.ts:162`) render literal `&lt;b&gt;Number at risk&lt;/b&gt;`.
- **Minimal Reproduction**:
  Open a survival graph with a Number-at-risk table, a volcano/bubble plot tooltip, or a regression graph note containing `<br>`: literal `&lt;b&gt;` / `&lt;br&gt;` tags appear on screen.
- **Suggested Fix**:
  Only run `formatLabelForPlotly` on user-authored labels (titles, axis titles, legend names, category tick labels) rather than internal HTML-formatted annotations/tooltips, or preserve safe formatting tags (`<br>`, `<b>`, `<i>`) before escaping.

---

### Issue 89 [PARTIALLY FIXED]: `webr.ts` P-12 claim-stamp matching uses a 5-second fuzzy window and never clears `claimStamps` on install/reset/release
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (exact rotated `claimTokens` replace the 5-second fuzzy timestamp match)
- **Remaining at `d4b45130`**: `ensurePackages` (`src/stats/webr.ts:1192-1203`) unconditionally deletes `claimTokens.delete(n)` after a 2 s `await` (wiping both P-12 timeout reclaim tokens and a racing retry's fresh token `T2`), and `installBatch` (`line 1331`) prematurely deletes `claimTokens` before `ensurePackages` reads it.
- **Files**:
  - `src/stats/webr.ts:209-229, 796, 847, 905-938, 1080-1139, 1219`
- **Explanation**:
  `webr.ts` checks claim ownership using `Math.abs(held - stamp) < 5` (a 5-second fuzzy tolerance window) and never clears stale entries from `claimStamps` after package install completes, engine reset, or release. Two racing windows starting within 5 seconds of each other can pass the stamp match and steal/release each other's live install claim, and a late conditional release on a timed-out call can match within 5 seconds and drop the active retry's live claim.
- **Minimal Reproduction**:
  Launch two Titer windows initializing WebR packages within 5 seconds of each other (or trigger a timeout retry within 5 s of the prior claim stamp): conditional claim release steals/drops the live claim.
- **Suggested Fix**:
  Replace the fuzzy `< 5` timestamp tolerance with an exact unique claim token/nonce (or PID + monotonic counter) and clear `claimStamps` unconditionally on install completion, failure, release, and engine reset.

---

### Issue 90 [PARTIALLY FIXED]: `webr.ts` `ensurePackages` resolves as success while packages are still `"loading"` when an evicted joined batch settles after a retry started
- **Severity**: High
- **Status**: Partially Fixed at `d4b45130` (`ensurePackages` at `src/stats/webr.ts:1181` now waits for `"ready"`)
- **Remaining at `d4b45130`**: If `resetR()` clears `states` back to `"idle"` after a batch completes and before an awaiting caller resumes, the `while` loop (`src/stats/webr.ts:1181-1230`) has no `"idle"` branch and spins in a 100 ms poll loop until the 360 s deadline.
- **Files**:
  - `src/stats/webr.ts:1100-1148, 1216-1239` (`ensurePackages`)
- **Explanation**:
  In `ensurePackages`, line 1126 checks only `if (status === "failed")` after awaiting a joined in-flight batch rather than requiring `status === "ready"`. When an earlier batch times out and is evicted while a retry immediately flips the package state back to `"loading"`, an overlapping caller that joined the evicted batch observes the evicted promise settle while status is `"loading"` (not `"failed"`) and resolves `ensurePackages()` early, causing downstream `library(...)` calls to fail.
- **Minimal Reproduction**:
  Trigger an `ensurePackages` timeout under contention while a second caller joins the batch and a third triggers a retry: the joined caller resolves before the retry finishes loading packages, and `library(...)` throws `there is no package called ...`.
- **Suggested Fix**:
  Loop/wait until every requested package reaches `status === "ready"` (or throws if the overall deadline expires / all retries fail) rather than assuming `!failed` means ready.

---

## Medium-Severity Issues (Recheck 2)

### Issue 95 [PARTIALLY FIXED]: `parseXlsx` skips self-closing `<si/>` (and `<si ...>` with attributes) in `sharedStrings.xml`, shifting all subsequent cell strings off by 1, and concatenates `<rPh>` phonetic runs
- **Severity**: Medium
- **Status**: Partially Fixed at `d4b45130` (bare `<si/>`, attributed `<si ...>...</si>`, and `<rPh>` stripping added at `src/lib/tabular-import.ts:293-298`)
- **Remaining at `d4b45130`**: Line `293` uses greedy `[^>]*` (`/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g`), so `<si />` or `<si foo="1"/>` consumes `/` and swallows the next `<si>...</si>`, shifting all subsequent string indices off by 1; `<rPh>` stripping is also omitted for `inlineStr` cells at line `354`.
- **Files**:
  - `src/lib/tabular-import.ts:288-294` (`parseXlsx` sharedStrings parser)
- **Explanation**:
  `parseXlsx` parses `sharedStrings.xml` with `/<si>([\s\S]*?)<\/si>/g`, which misses `<si/>` (empty shared string entry) and `<si ...>` with attributes, and strips tags globally across each `<si>` body without excluding `<rPh>...</rPh>` phonetic guide runs:
  1. Every `<si/>` or `<si ...>` skipped decrements the array index of all subsequent `<si>` entries, shifting every following cell's `t="s"` string lookup off by 1+.
  2. `<rPh>` ruby/furigana phonetic annotations are concatenated onto the visible cell string.
- **Minimal Reproduction**:
  Import an `.xlsx` file whose `xl/sharedStrings.xml` contains `<si/>` at index 2 (e.g. an empty string cell shared in Excel) or `<rPh>` phonetic runs: all later text cells show the wrong string from the next row/column.
- **Suggested Fix**:
  Match `/<si(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/si>)/g` (pushing `""` for self-closing `<si/>`) and strip `<rPh\b[\s\S]*?<\/rPh>` before extracting `<t>` text inside each `<si>`.

---

## New Issues Found in Recheck 3 at `d4b45130` (#98–#111)

### Issue 98 [PARTIALLY FIXED]: `open_file` IPC permits arbitrary executable launch (no extension allowlist), Windows `cmd /C start` shell injection, and macOS `open` flag injection
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (extension allowlist on raw + canonical path, Windows `explorer` launcher replacing `cmd.exe`, and `reap_detached` added in `src-tauri/src/main.rs:1800-1840`)
- **Remaining at `c54f5954`**: **High Linux regression**: `open_file` on Linux (`src-tauri/src/main.rs:2015`) passes `xdg-open -- <path>`, which fails 100% of the time (`xdg-open: unexpected option '--'`, silently swallowed by `reap_detached`); `check_openable_file` (`src-tauri/src/main.rs:1809`) also discards `canonical` and launches raw `&path`.
- **Files**:
  - `src-tauri/src/main.rs:1752-1775, 1939-1948` (`check_openable_file`, `open_file`)
  - `src/native.ts:781` (`openSourceFile`)
- **Explanation**:
  Unlike all other file IPC commands in `main.rs` (`read_data_text`, `read_data_bytes`, `write_file`, `move_file`, `canonicalize_in_temp_dir`), `open_file` validates only `Path::new(path).is_file()` (`check_openable_file`, lines 1752–1760) with no extension allowlist and no canonical symlink-target check:
  1. **Arbitrary executable launch**: A compromised webview can pass `.command`, `.scpt`, `.terminal`, `.pkg`, `.dmg`, `.exe`, `.bat`, or `.desktop` paths to `open_file`, executing them with the OS launcher.
  2. **Windows `cmd /C start` shell injection (`main.rs:1944`)**: `Command::new("cmd").args(["/C", "start", "", &path])` passes `path` through `cmd.exe`, which evaluates metacharacters (`&`, `|`, `^`, `%VAR%`) even in separate argv elements — so an existing file named `data&calc.csv` executes `calc`.
  3. **macOS `open` / Linux `xdg-open` flag injection**: Missing `"--"` before `&path` lets a relative path beginning with `-` be interpreted as a launcher flag (and `.spawn()` drops the child handle without reaping).
- **Minimal Reproduction**:
  Invoke `open_file` from the webview with `path: "/tmp/test.command"` on macOS (or `"C:\\temp\\a&calc.csv"` on Windows).
- **Suggested Fix**:
  Canonicalize `path` and enforce `check_extension` on both the given path and canonical target against data extensions (`&["csv", "tsv", "txt", "dat", "prn", "xlsx"]`); use `--` on macOS/Linux (or `NSWorkspace::openURL`) and avoid `cmd /C start` on Windows (use `ShellExecuteW` / `tauri-plugin-opener`).

---

### Issue 99 [PARTIALLY FIXED]: `pasteNames` (upstream 1.1.1) corrupts Nested tables (`isNested` omitted), drops column metadata/calculated formulas, and cross-renames lead/group collisions
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (Nested `isGrouped || isNested` handling, column metadata remapping, `renameCalculatedReferences`, and separate `leadRenamed`/`groupRenamed` maps for `data.columns` fixed in `src/views/tables/table-data.ts`)
- **Remaining at `c54f5954`**: `pasteNames` (`src/views/tables/table-data.ts:538-544`) still merges `leadRenamed` and `groupRenamed` into one flat `renamed` map for `TableMove` / `followTable`, causing XY tables with matching lead `"X"` and group `"X"` to cross-rename or drop `"X"`.
- **Files**:
  - `src/views/tables/table-data.ts:498-546` (`pasteNames`)
  - `src/views/tables/grid-menu.ts:95, 208-215` (exposes `"Paste Group Names"` on Nested tables)
  - `src/lib/dataset.ts:86-90` (`isGrouped` vs `isNested`)
- **Explanation**:
  1. **Corrupts Nested tables**: `grid-menu.ts:95, 209` exposes `"Paste Group Names"` whenever `isGrouped(data) || isNested(data)`, yet `pasteNames` (`table-data.ts:507`) checks only `const grouped = isGrouped(data);` (which returns `false` for Nested tables). On Nested tables (`"Title", "A:S1:Y1", "A:S1:Y2", ...`), `pasteNames` overwrites subcolumns directly with bare strings (`"WT"`, `"KO"`) and destroys the `Group:Subgroup:Replicate` structure.
  2. **Drops column metadata and breaks calculated formulas**: Unlike `renameColumn` and `renameGroup`, `pasteNames` (`533-542`) only remaps `widths` and leaves `decimals`, `variableTypes`, `labelVariable`, `levelOrder`, and `calculated` (`v.name` and formulas via `renameCalculatedReferences`) pointing at stale column names.
  3. **Lead vs group namespace collision**: Line `517` allows a lead column and a group to share a name (`"X"` and `"X:Y1"`), but line `523` merges both into one `renamed` map applied to both lead and group columns at line `528`.
- **Minimal Reproduction**:
  Create a Nested table, copy `"WT\tKO"`, right-click `"A:S1:Y1"`, and select **Paste Group Names** → column headers become `["Title", "WT", "KO", "B:S1:Y1", ...]`. Or paste a new name onto column `A` referenced by a calculated column `C = A + B`.
- **Suggested Fix**:
  Use `const grouped = isGrouped(data) || isNested(data);`, keep separate `leadRenamed` and `groupRenamed` maps, and remap `decimals`, `variableTypes`, `labelVariable`, `levelOrder`, and `calculated` references.

---

### Issue 100 [PARTIALLY FIXED]: Upstream 1.1.1 `axisKind` is not wired into `FormatPanel`: `rowsAt: "values"` and `histogram`/`qq-plot` lose X controls, `grouped-stacked`/`residuals` offer dead Log controls, `grouped-hbars` mislabels value axis as `"Y"`, and `scree-plot`/`dendrogram` misdeclare `XY_AXES`
- **Severity**: High
- **Status**: Partially Fixed at `ad3fe0d0` (`70898a47`/`60195352`/`b6d32854` wired `axisKind` into `FormatPanel` for `grouped-lines`, `histogram`/`qq-plot`/numeric `multiple`, and `scree-plot`/`dendrogram` X axes)
- **Remaining at `ad3fe0d0`**: (1) `grouped-hbars` still hardcodes `axis="Y"` on Scale/Range/NumberFormat (`src/views/graphs/format-panel.tsx:463, 471, 485`); (2) Y `<AxisRange>` `log` prop still checks `family !== "volcano"` instead of `yKind === "scale"` (`format-panel.tsx:475`); (3) `refLineParts` still reads raw `options.yScale` instead of effective scale (`src/views/graphs/plot-helpers.ts:1206, 1228`).
- **Files**:
  - `src/views/graphs/format-panel.tsx:453-522`
  - `src/views/graphs/grouped-lines.ts:8-10`
  - `src/views/graphs/grouped-stacked.ts:8-12`
  - `src/views/graphs/residuals.ts:39, 48, 74-76`
  - `src/views/graphs/histogram.ts:64-67`, `src/views/graphs/monte-carlo-histogram.ts:27-30`, `src/views/graphs/qq-plot.ts:60-61`
  - `src/views/graphs/scree-plot.ts:26-31, 85`, `src/views/graphs/dendrogram.ts:75-86, 124`
  - `src/views/graphs/plot-helpers.ts:441-460` (`axesRangeInputs`, `logScaleOffered`)
- **Explanation**:
  Commits `6592ac77` and `67187d2f` added `axes()`/`axisKind()` per graph module, but `FormatPanel` (`format-panel.tsx:453-522`) still gates axis controls on legacy `family === "xy"`, `family === "histogram"` (which no module sets), `logScaleOffered`, and `axesRangeInputs`:
  1. Switching `grouped-lines` to `rowsAt: "values"` ("X axis: Numbers") never reveals `<Scale axis="X">`, `<AxisRange axis="X">`, or `<NumberFormat axis="X">`.
  2. `grouped-stacked` and `residuals` (`qq` mode) force linear axes while `FormatPanel` still shows Log10/Log2 selectors (and `refLineParts` still reads `options.yScale`).
  3. `histogram`, `monte-carlo-histogram`, `qq-plot`, and numeric `multiple` plots (`pca-biplot`, `kmeans-scatter`, `observed-fitted`) lose X Scale / Range / NumberFormat controls.
  4. `grouped-hbars` hardcodes `axis="Y"` on its horizontal value-axis controls (`454-480`).
  5. `scree-plot` (`85`) and `dendrogram` (`124`) declare `axes: XY_AXES` (`x: "scale"`) despite categorical/leaf X axes.
- **Minimal Reproduction**:
  On a Grouped table with numeric row titles, open a **Connected lines** graph and toggle **X axis: Numbers**: no X Scale or Min/Max/Step inputs appear. Open **Stacked bars** → Log10 Y scale is selectable and does nothing.
- **Suggested Fix**:
  Drive `FormatPanel` axis controls from `axisKind(graphType, options, key, props.atValues)`, change `scree-plot`/`dendrogram` `axes` to `{ x: "labels", y: "scale" }`, and pass effective scale to `refLineParts`.

---

### Issue 101 [PARTIALLY FIXED]: Point labels on Horizontal Bars (`grouped-hbars`) with Log scale transform `y` instead of `x`, placing labels at `10^v` off-canvas and `NaN` on row 0
- **Severity**: High
- **Status**: Partially Fixed at `c54f5954` (`src/views/graphs/graph-view.tsx:870` fixes on-screen rendering via `labelOnAxes` at `src/views/graphs/plot-helpers.ts:1103-1112`)
- **Remaining at `c54f5954`**: `buildGraphFigure` (`src/views/graphs/graph-figure.ts:852-858`) inlines its own transform and still applies `options.xScale` to horizontal category `label.y` (producing `-Infinity`/`NaN` on row 0 if `xScale === "log"`) instead of calling `labelOnAxes`.
- **Files**:
  - `src/views/graphs/graph-view.tsx:275-279, 870-875`
  - `src/views/graphs/graph-figure.ts:787-791`
  - `src/views/graphs/index.ts:148-152` (`axisKind`)
  - `src/views/graphs/grouped-common.ts:187-188`
- **Explanation**:
  For `grouped-hbars` (`horizontal: true`), `axisKind` maps option key `"y"` (the value axis) to `"scale"` (`scaled.y === true`) and `"x"` to `"labels"` (`scaled.x === false`), whereas Plotly draws horizontal bar values on `xaxis` and categories on `yaxis`. `graph-view.tsx:873-874` applies `scaled.x`/`scaled.y` directly to `label.x`/`label.y`, leaving `label.x = value` untransformed ($10^{\text{value}}$ off-screen on a log axis) and passing row index `label.y = 0` through `onAxis(0, "log10")` → `NaN` (dropping row 0's labels). `graph-figure.ts:789-790` has the same swapped-axis bug.
- **Minimal Reproduction**:
  Create a Grouped table (`[10, 100]`), plot **Horizontal bars**, enable **Show individual points**, set scale to **Log10**, and turn on a point label: row 0 vanishes and labels jump off-canvas.
- **Suggested Fix**:
  Map `scaled` onto physical Plotly coordinates: when `horizontal`, transform `label.x` using `scaled.y ? options.yScale : "linear"` and keep `label.y` `"linear"`.

---

## Medium-Severity Issues (Recheck 3)

### Issue 103 [PARTIALLY FIXED]: `2db68ed1` linear-regression centering missed `compare-slopes.ts`, `report/checks.ts`, and `regression-overlay.ts`
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`src/stats/xy/compare-slopes.ts`, `src/stats/report/checks.ts`, and `fitLinear` in `src/views/graphs/regression-overlay.ts` now center before fitting)
- **Remaining at `c54f5954`**: (1) **High regression**: `linearFitProblem` (`src/views/graphs/regression-overlay.ts:74-78`) was left uncentered while `fitLinear` (`:119-156`) double-centers, so identical X like `[0.1, 0.1, 0.1]` passes `linearFitProblem` (`sxx = 5.78e-34`) and divides by zero in `fitLinear` (`sxx = 0`), returning all-`NaN` `LinearFit`; (2) `bandAt` (`regression-overlay.ts:163-168`) still evaluates uncentered `fit.intercept + fit.slope * x0`, causing cancellation jitter on lines and CI bands at `1e13` X.
- **Files**:
  - `src/stats/xy/compare-slopes.ts:64, 73-75`
  - `src/stats/report/checks.ts:225-226`
  - `src/views/graphs/regression-overlay.ts:111, 130`
- **Explanation**:
  1. `compare-slopes.ts` (`compareSlopes: true` in `linear-regression`) still fits uncentered `lm(y0 ~ x0)`, `lm(y ~ g*x)`, and `lm(y ~ g+x)`, aliasing/crashing on 13-digit data like `xyBig`.
  2. `report/checks.ts:225-226` runs Shapiro-Wilk normality checks on `resid(lm(y ~ x))` uncentered, testing aliased garbage residuals when X sits at $10^{13}$.
  3. `regression-overlay.ts:111, 130` computes `ssRes` from uncentered `y[i] - (intercept + slope * x[i])` (off by $+19.6\%$ at $X \approx 10^{13}$), inflating graph CI bands and making graph annotations disagree with the Analysis sheet.
- **Suggested Fix**:
  Center `x`/`y` before `lm()` in `compare-slopes.ts` and `report/checks.ts`, and compute `ssRes` and `yHat` centered around `(xbar, ybar)` in `regression-overlay.ts`.

---

### Issue 105 [PARTIALLY FIXED]: `isNewer` and `seenVersion` invert semver pre-release ordering (`2.0.2-rc.1 > 2.0.2`) and reject pre-release / uppercase-`V` seen strings
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (core semver pre-release ordering implemented in `src/lib/version.ts` and pre-release / `v?` support added to `src/lib/whats-new.ts`)
- **Remaining at `c54f5954`**: `isNewer` (`src/lib/version.ts:38-41`) classifies numeric pre-release identifiers via `Number.isInteger(Number(xi))` instead of `/^\d+$/` (misclassifying alphanumeric `"1e2"`, `"0x10"`, `"-1"` as numeric), and `seenVersion` (`src/lib/whats-new.ts:96`) rejects SemVer `+build` metadata.
- **Files**:
  - `src/lib/version.ts:4-15` (`isNewer`)
  - `src/lib/whats-new.ts:90-94, 102-106` (`seenVersion`)
- **Explanation**:
  `isNewer` splits version strings on `"."` and converts segments via `parseInt(n, 10) || 0`, so `"2.0.2-rc.1"` becomes `[2, 0, 2, 1] > [2, 0, 2]`, reporting `"2.0.2-rc.1"` as newer than `"2.0.2"`. Additionally, `seenVersion` (`whats-new.ts:93`) validates `/^v?\d+(\.\d+)*$/`, rejecting pre-releases (`"2.0.2-rc.1"` → `null`) and uppercase `"V2.0.1"`.
- **Suggested Fix**:
  Parse core numeric tuple and optional `-prerelease` separately (where no pre-release ranks newer than same core + pre-release) and accept optional pre-release/case-insensitive `v?` in `seenVersion`.

---

### Issue 107 [PARTIALLY FIXED]: `noncentralTCdf` overflows `tt * tt` for `|t| ≥ 1.34e154` (returning `normalCdf(-delta)` instead of `1`/`0`) and `noncentralTTwinSeriesModeCentered` breaks at `|δ| ≥ 1e6` / large `df + δ`
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`src/stats/distributions.ts` fixes `tt * tt` overflow and `Gamma(a, Inf)` via `noncentralTChiSquareLimit`)
- **Remaining at `ad3fe0d0`**: **High regression still open**: `578c480d` closed only the `mu <= 700` limb (`#63`/`#80`) and did **not** touch `noncentralTChiSquareLimit` (`src/stats/distributions.ts:368-370, 452-469`), which still drops `Z ~ N(0, 1)` (only valid for `df ≪ δ²`). For large `df` (including the entire `mu >= 7e5 && df >= 1.4e6` trigger and `|δ| > 1414` with large `df`), it produces up to `0.169` CDF error and `0.081`–`0.160` boundary cliffs (e.g. `noncentralTCdf(1416, 1e7, 1415)` → `0.9992` vs exact `0.8298`; `noncentralTCdf(1201, 1e8, 1200)` → `1.0` vs exact `0.8405`).
- **Files**:
  - `src/stats/distributions.ts:135, 331-332, 413-439` (`noncentralTCdf`, `noncentralTTwinSeriesModeCentered`)
- **Explanation**:
  1. Line `331` computes `x = (tt * tt) / (tt * tt + df)`. For `|t| >= 1.34e154`, `tt * tt` overflows to `Infinity`, yielding `x = NaN`, skipping the twin series, and silently returning `normalCdf(-del)` (e.g. `2.87e-7` or `0` instead of `1.0`).
  2. At `|δ| >= 1e6` (`m >= 5e11`), `m * logMu - lgamma(m + 1)` suffers massive floating-point cancellation and `MAX_STEPS = 5_000_000` truncates the mode peak mid-sum (`noncentralTCdf(1e7, 100, 1e7)` → `0.2276` instead of `0.4812`). At large `df + δ` (`df = 1e8, δ = 1e5`), `incompleteBetaCf`'s `MAXIT = 200` fails to converge (`0` instead of `0.500`).
- **Minimal Reproduction**:
  `noncentralTCdf(1e155, 10, 5)` returns `2.8665e-7` (true `1.0`); `noncentralTCdf(-1e6, 100, 1e6)` returns `3.659e-5` (true `0`); `noncentralTCdf(1e5, 1e8, 1e5)` returns `0` (true `0.500`).
- **Suggested Fix**:
  Compute `x = 1 / (1 + (df / tt) / tt)` to avoid squaring overflow, and route extreme `|δ|` / `df` regimes to a Stirling/normal asymptotic approximation.

---

## Low-Severity Issues (Recheck 3)

### Issue 108 [PARTIALLY FIXED]: `WhatsNewDialog` `close()` unconditionally overwrites `titer.whats-new-seen` with the running version, regressing the seen marker after a downgrade
- **Severity**: Low
- **Status**: Partially Fixed at `c54f5954` (`markWhatsNewSeen` in `src/lib/whats-new.ts` no longer overwrites a newer `titer.whats-new-seen` on close)
- **Remaining at `c54f5954`**: `shouldShowWhatsNew` (`src/lib/whats-new.ts:82-84`) still checks raw `storedValue !== whatsNewVersion()` instead of `seen === null || isNewer(whatsNewVersion(), seen)`, returning `true` on downgrades and breaking the 2-second multi-window poll (`src/components/whats-new-dialog.tsx:60`).
- **Files**:
  - `src/components/whats-new-dialog.tsx:65-68`
- **Explanation**:
  Dismissing a manual **Help ▸ What's New** dialog calls `markWhatsNewSeen()` unconditionally, overwriting `titer.whats-new-seen` downward (e.g. `"2.1.0"` → `"2.0.1"`) and causing `"2.1.0"`'s What's New dialog to re-auto-open later.
- **Suggested Fix**:
  Only update `titer.whats-new-seen` when no valid version is stored or `isNewer(whatsNewVersion(), storedSeen)`.

---

### Issue 110 [PARTIALLY FIXED]: `fitLabels` produces `dtick: NaN` on coincident adjacent ticks (`at[1] === at[0]`), and `graph-view.tsx` checks `!current` after `Plotly.relayout` instead of immediately after `Plotly.react`
- **Severity**: Low
- **Status**: Partially Fixed at `c54f5954` (`fitLabels` adds the `step <= 0` guard in `src/views/graphs/plot-helpers.ts`)
- **Remaining at `c54f5954`**: Regression in `src/views/graphs/graph-view.tsx:890-904`: the `if (!current) return;` guard was moved *before* `await Plotly.relayout(...)` (`line 893`) without keeping the guard *after* `await Plotly.relayout(...)` (`line 896`), reopening the stale-async race after relayout.
- **Files**:
  - `src/views/graphs/plot-helpers.ts:873-875` (`fitLabels`)
  - `src/views/graphs/graph-view.tsx:899-903`
- **Explanation**:
  1. `fitLabels` computes `step = at[1] - at[0]` and `step * Math.pow(10, Math.ceil(Math.log10(gap / step)))`; if `at[1] === at[0]`, `step === 0` produces `dtick: NaN`.
  2. `graph-view.tsx:899-903` runs `fitLabels` and `await Plotly.relayout(el, thinned)` before checking `if (!current) return;`, letting an older superseded render overwrite a newer render's ticks.
- **Suggested Fix**:
  Guard `if (!(step > 0) || !Number.isFinite(gap)) continue;` in `fitLabels`, and check `if (!current) return;` immediately after `await Plotly.react(...)`.

---

## New Issues Found in Recheck 5 at `ad3fe0d0` (#116–#145)

### Issue 116: Tauri 2 `camelCase` vs `snake_case` IPC argument mismatch breaks every Flow Tauri command at runtime (and drops `sample_id` in `flow_import_fcs`)
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:981-989` (`flow_import_fcs`)
  - `src-tauri/src/flow_store.rs:560-733` (`flow_load_sample`, `flow_load_sample_file`, `flow_get_column`, `flow_unload_sample`, `flow_sample_stats`, `flow_apply_compensation`, `flow_get_compensation`, `flow_clear_compensation`)
  - `src-tauri/src/flow_transform.rs:332-352` (`flow_apply_transform`)
  - `src/flow/store.ts:498-558` (`TauriFlowStore`), `src/flow/fcs.ts:67-71` (`importFcs`), `src/flow/transforms.ts:376-381` (`applyFlowTransform`)
- **Explanation**:
  Every new Flow `#[tauri::command]` omits `rename_all = "snake_case"`, so Tauri 2 expects **camelCase** JS invoke keys (`sampleId`, `paramNames`, `sourcePath`) matching existing commands in `src/native.ts:475,510-516` (`analysisId`, `jobId`). However, every TypeScript Flow client passes **snake_case** keys (`sample_id`, `param_names`, `source_path`). Calling `flow_load_sample`, `flow_get_column`, `flow_unload_sample`, `flow_sample_stats`, `flow_apply_compensation`, `flow_get_compensation`, `flow_clear_compensation`, or `flow_apply_transform` in the live desktop app fails immediately with `invalid args 'sampleId' for command ...: missing required key sampleId`. In `flow_import_fcs`, `sample_id` is `Option<String>`, so `{ sample_id }` is silently ignored (`sampleId` deserializes as `None`) and custom `sample_id` overrides are dropped. Tests missed this because Rust unit tests call internal methods directly and TS tests run against `InMemoryFlowStore`.
- **Minimal Reproduction**:
  In the desktop Tauri app, invoke `titer_import_fcs` with `sample_id: "s1"` (silently receives a filename-derived ID instead), or invoke `titer_apply_flow_compensation`, `titer_transform_flow_parameter`, or `titer_flow_population_stats` → fails at the Tauri IPC layer with `missing required key sampleId`.
- **Suggested Fix**:
  Pass `camelCase` keys (`sampleId`, `paramNames`, `sourcePath`) in `src/flow/store.ts:498-558`, `src/flow/fcs.ts:67-71`, and `src/flow/transforms.ts:376-381` (or annotate the Rust commands with `#[tauri::command(rename_all = "snake_case")]`).

---

### Issue 117: `applyTransform` (Rust + TS) mutates raw `sample.columns` instead of compensated columns, silently ignoring transforms after compensation and corrupting raw data
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow_store.rs:164-171, 290-315, 330-366` (`readable_column`, `FlowStore::apply_transform`, `FlowStore::apply_compensation`)
  - `src/flow/store.ts:313-320, 454-465` (`readableColumn`, `InMemoryFlowStore.applyTransformSync`)
- **Explanation**:
  `applyCompensation` preserves raw intensities in `sample.columns` and materializes compensated fluorochrome columns in `sample.compensated`. Every read path (`getColumn`, `sampleStats`, `titer_flow_population_stats`) calls `readableColumn`, which returns `sample.compensated.columns` when compensation is active. However, `applyTransform` (in both Rust and TS) unconditionally reads and mutates raw `sample.columns[index]` in place without checking or updating `sample.compensated`. In the standard workflow (`import_fcs` → `apply_compensation` → `apply_transform` → read/stats), `applyTransform` transforms the hidden raw column and returns uncompensated before/after stats, while plots, gates, and population stats keep reading the untransformed compensated column — and raw data is permanently overwritten (breaking subsequent `apply_compensation` and `clear_compensation`).
- **Minimal Reproduction**:
  Import a 2-fluorochrome sample (`FL1-A`, `FL2-A`), call `applyCompensation` with a non-identity matrix, then call `applyTransform(id, "FL1-A", logicle)`: `getColumn(id, "FL1-A")` still returns raw-scale compensated fluorescence instead of logicle display values.
- **Suggested Fix**:
  Keep raw columns strictly immutable (like compensation does) and store transformed columns in a post-compensation display layer (`raw → compensate → transform`), recomputing cleanly whenever compensation changes.

---

### Issue 118: Split-brain `isFlowEnabled` / `setFlowEnabled` (`feature-flag.ts` vs `store.ts`) keeps all 4 MCP flow executors locked off when enabled via `src/flow/index.ts` or `localStorage`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/flow/feature-flag.ts:7-15` (unpersisted module-local `let flowEnabled = false`)
  - `src/flow/store.ts:578-604` (`localStorage["titer.flow.enabled"]` + `flowEnabledOverride`)
  - `src/flow/index.ts:24-26` (re-exports `isFlowEnabled`, `setFlowEnabled` from `./store`)
  - `src/store/mcp-flow.ts:16, 118, 187, 322, 411` (imports `isFlowEnabled` from `../flow/feature-flag`)
- **Explanation**:
  Two independent implementations of `isFlowEnabled` / `setFlowEnabled` exist: `src/flow/index.ts` exports the `localStorage`-persisted implementation from `src/flow/store.ts`, whereas `src/store/mcp-flow.ts` imports a separate unpersisted boolean from `src/flow/feature-flag.ts`. Enabling the Flow module through `src/flow/index.ts` (or `localStorage.setItem("titer.flow.enabled", "1")`) leaves `feature-flag.ts`'s `flowEnabled` at `false`, so all four MCP flow executors (`executeImportFcs`, `executeApplyFlowCompensation`, `executeTransformFlowParameter`, `executePopulationStats`) still reject with `"The FlowJo module is off"`.
- **Minimal Reproduction**:
  Call `setFlowEnabled(true)` imported from `src/flow/index.ts` (so `isFlowEnabled()` returns `true`), then run `executeImportFcs(...)`: throws `"The FlowJo module is off — turn it on in Settings..."`.
- **Suggested Fix**:
  Consolidate onto a single persisted source of truth and have `src/flow/feature-flag.ts`, `src/flow/store.ts`, `src/flow/index.ts`, and `src/store/mcp-flow.ts` share it.

---

### Issue 119: `setFlowSampleTransform` omitted from `UNDOABLE` / `MUTATING` in `use-project-store.tsx` — stalls `titer_transform_flow_parameter` for 3 seconds and breaks Undo / dirty tracking
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/store/use-project-store.tsx:165-166, 483-497, 1449-1488, 1491-1587, 1971-1975`
  - `src/store/mcp-flow.ts:470-473`
  - `src/store/mcp-dispatch.ts:3002-3005, 3044, 3074`
- **Explanation**:
  Although comments at `use-project-store.tsx:165` and `1971-1972` describe `setFlowSampleTransform` as an undo step, `"setFlowSampleTransform"` was omitted from `UNDOABLE` (`1449-1487`), which excludes it from `MUTATING` (`1488`) and `changeName` (`1491-1580`). Consequently, `reducer()` (`1583-1587`) never increments `state.revision` and never pushes an undo snapshot: (1) every `titer_transform_flow_parameter` call stalls until `flushUntilRevision` times out in `mcp-flow.ts:472` (2000 ms) and again in `mcp-dispatch.ts:3074` (1000 ms) — 3 seconds per call; (2) Edit ▸ Undo cannot revert the transform; and (3) `markSaved` can clear `isDirty` despite unsaved transform changes.
- **Minimal Reproduction**:
  Dispatch `{ type: "setFlowSampleTransform", id: sampleId, transform }` through `reducer(state, action)` → `next.revision === state.revision` and `next.past.length === state.past.length`.
- **Suggested Fix**:
  Add `"setFlowSampleTransform"` to `UNDOABLE` in `src/store/use-project-store.tsx:1477` and add `case "setFlowSampleTransform": return "Transform Flow Parameter";` to `changeName`.

---

### Issue 120: Two-way ANOVA Games–Howell regression (`f511dd4e`): shifting cell `b` by `a[1]` before `var(b)` destroys `var(b)` across differing cell scales
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/stats/grouped/two-way-anova.ts:330-332` (`runPosthoc` Games–Howell branch)
- **Explanation**:
  Commit `f511dd4e` (`#112`) changed Games–Howell in `runPosthoc` to shift both `a` and `b` by `m0 <- a[1]` before calling `var(a)` and `var(b)`: `m0<-a[1]; a<-a-m0; b<-b-m0; ... va<-var(a)/length(a); vb<-var(b)/length(b)`. Shifting `b` by `a[1]` preserves `var(b)` only when `a` and `b` share the same magnitude. When cell `a` is near `1e13` (ULP ≈ `0.00195`) and cell `b` is near `0` (e.g. control `[0, 1e-4, 2e-4]`), `b - a[1]` rounds all elements of `b` to `-1e13`, collapsing `var(b)` to **`0`** and corrupting `vb`, `s`, Welch `df` (`w`), `t`, `p`, and CIs. Even for `b = [0, 0.01, 0.02]`, `var(b - 1e13)` drops by `4.6%`.
- **Minimal Reproduction**:
  Run ordinary Two-way ANOVA with `posthoc: "games-howell"` on cell A `= [1e13, 1e13 + 1]` and cell B `= [0, 1e-4, 2e-4]`: `b - a[1]` collapses `vb` to `0` and Welch `df` to `1`.
- **Suggested Fix**:
  Center each cell by its own origin for `var()`, and combine origins in `d`: `a0<-a-a[1]; b0<-b-b[1]; d<-(a[1]-b[1])+(mean(a0)-mean(b0)); va<-var(a0)/length(a); vb<-var(b0)/length(b);`.

---

### Issue 121: Linux `installUpdate` downloads the ~137 MB macOS `.app.zip`, promises restart-to-install, and crashes into macOS-only `apply_update` (and `!asset && forced` fails to quit)
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/updates.ts:129, 137-166` (`checkAgainstManifest`, `installUpdate`)
  - `src-tauri/src/updater.rs:219-252, 390-392` (`download_update`, `apply_update`)
- **Explanation**:
  `checkAgainstManifest` (`src/updates.ts:129`) passes `installable = deps.isMacOs() && manifest.update !== undefined` (`false` on Linux), promising the Linux user it will open GitHub for manual download. However, `installUpdate` (`lines 138-157`) checks `if (!asset)` first instead of `if (!deps.isMacOs())`. Because `version.json` publishes `manifest.update` for macOS releases, `asset` is truthy on Linux: `installUpdate` runs `deps.downloadUpdate()` (downloading the ~137 MB macOS bundle), announces `"Titer will restart to install it."`, and invokes `apply_update`, which immediately fails (`"in-place updates are macOS-only"`), spawning follow-up warning/download dialogs (or a Retry/Quit loop if forced). Additionally, if `!asset && forced`, `installUpdate` (`lines 148-156`) returns without calling `deps.quitApp()`.
- **Minimal Reproduction**:
  Run `checkForUpdates(false, deps)` with `isMacOs: () => false`, an outdated `appVersion`, and a manifest carrying `update`: accepting the manual-download prompt triggers `downloadUpdate()` and `applyUpdate()` instead of `openLink("releases")`.
- **Suggested Fix**:
  Move the `if (!deps.isMacOs())` redirect before `if (!asset)` (and call `if (forced) await deps.quitApp()` in both `!deps.isMacOs()` and `!asset` forced return paths).

---

### Issue 122: Unbounded `1..=$PAR` loop in `flow.rs::check_datatype` enables permanent main-thread CPU DoS from a ~90-byte FCS file
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:409-415, 981-989` (`check_datatype`, `flow_import_fcs`)
- **Explanation**:
  `check_datatype` parses `$PAR` directly as `usize` with no upper bound and iterates `for n in 1..=par { let Some(bits) = lookup_usize(pairs, &format!("$P{n}B"))? ... }`, allocating a `String` and linearly scanning `pairs` on every iteration. Because `flow_import_fcs` runs synchronously before `flow-fcs` is invoked, a ~90-byte valid-header `.fcs` file declaring `/$DATATYPE/I/$PAR/18446744073709551615/` permanently freezes the Tauri app at 100% CPU.
- **Minimal Reproduction**:
  Import a crafted ~90-byte FCS 3.0 file whose TEXT segment contains `/$DATATYPE/I/$PAR/18446744073709551615/` via `flow_import_fcs`.
- **Suggested Fix**:
  Iterate directly over `pairs` to inspect every `$P<n>B` key present (and/or bound `$PAR` to a sane maximum) instead of looping `1..=par`.

---

### Issue 123: Unchecked slice bounds and arithmetic overflow panics in `flow.rs` staging (`rebuild_dataset`, `shift_other_offsets`, `shifted`) crash the backend on malformed FCS files
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:453-477, 524-532, 567-615, 671-675` (`inspect_chain`, `shifted`, `rebuild_dataset`, `shift_other_offsets`)
- **Explanation**:
  When staging runs (non-`.fcs` extension, blank HEADER offset, short `$BYTEORD`, or bare `SPILL`), `rebuild_dataset` and helpers panic on crafted offsets that `inspect_chain` and `parse_text` allow:
  1. `span.splice(text_at..text_to, ...)` (`line 572`) panics out of bounds if `$NEXTDATA` points before `text_end` (`next_base <= base + header.text_end`).
  2. `span[..58].copy_from_slice(&header_bytes)` (`line 604`) panics (or overwrites TEXT) when `header.text_start < 58`.
  3. `shift_other_offsets` (`lines 673-674`) panics in `region[i..i + 8].copy_from_slice(...)` whenever an OTHER offset `>= 100_000_000` (e.g. `99_999_999 + delta` formats to 9+ bytes).
  4. `shifted` (`line 528`) does unchecked `value + delta as usize`, panicking in debug or wrapping in release when `$BEGINDATA` sits near `usize::MAX`.
- **Minimal Reproduction**:
  Stage a malformed `.lmd` or short-`$BYTEORD` FCS file with `header.text_start = 10` or `$NEXTDATA = 100 < text_end` (or OTHER offset `99999999` with `$BYTEORD/1,2/`): triggers an immediate Rust slice/arithmetic panic.
- **Suggested Fix**:
  Reject `header.text_start < 58` and `base + header.text_end >= span_end` in `inspect_chain`; use `checked_add` in `shifted`; and check `new_value < 100_000_000` in `shift_other_offsets` before `copy_from_slice`.

---

### Issue 124: Case-sensitive and untrimmed FCS keyword matching in `flow.rs` bypasses offset/datatype safety guards and corrupts staged files
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:333-346, 353-385, 390-433, 463, 495-518, 621-649` (`lookup`, `check_offsets`, `check_datatype`, `normalise_pairs`, `shift_pairs`)
- **Explanation**:
  Per the FCS 2.0–3.2 specification, keyword names are case-insensitive and vendor files often pad keyword values with spaces. However, `lookup` (`k == key`), `check_datatype` (`datatype == "A"`, `Some("C")`, `I|F|D`), `normalise_pairs` (`k == "$BYTEORD"`, `k == "SPILL"`), and `shift_pairs` (`"$BEGINDATA"`, `"$ENDDATA"`, `"$NEXTDATA"`, etc.) all use exact case-sensitive, untrimmed comparisons. Lowercase `$begindata`/`$enddata` bypasses `check_offsets` completely; lowercase `$datatype`/`$mode`/`$p1b` or whitespace-padded values bypass `check_datatype`; and any staged file with lowercase offset keywords has its HEADER offsets shifted while `shift_pairs` leaves TEXT offsets unshifted, corrupting the staged file.
- **Minimal Reproduction**:
  Import an `.lmd` FCS file containing lowercase `$begindata`/`$enddata`/`$nextdata` (or `$DATATYPE/ A/`): `check_datatype` / `check_offsets` / `shift_pairs` miss the keywords and either bypass validation or misalign offsets during staging.
- **Suggested Fix**:
  Compare keyword names with `.eq_ignore_ascii_case(...)` in `lookup`, `normalise_pairs`, and `shift_pairs`, and `.trim()` + case-fold `$MODE`, `$DATATYPE`, and `$BYTEORD` values.

---

### Issue 125: Synchronous file I/O on the macOS main thread (TCC deadlock) + missing `.tfcs` extension/URL/size guards & raw-byte leak in `flow_import_fcs` / `flow_load_sample_file` / `titer_import_fcs`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:207-212, 735-743, 801-808, 981-989` (`parse_header`, `stage_fcs_bytes`, `read_fcs_sample`, `flow_import_fcs`)
  - `src-tauri/src/flow_store.rs:576-589` (`flow_load_sample_file`)
  - `src-tauri/src/mcp.rs:7033-7071` (`titer_import_fcs`)
- **Explanation**:
  1. **macOS main-thread TCC deadlock & UI freeze:** Both `flow_import_fcs` and `flow_load_sample_file` are synchronous `#[tauri::command]` handlers executing `fs::read` (and staging `fs::write` + Polars parsing) on the main thread — unlike `read_text`/`read_prism_bytes`/`read_data_bytes`, which use `async` + `spawn_blocking` specifically to avoid macOS TCC main-thread deadlocks on protected folders (`main.rs:648-654`).
  2. **Missing extension/URL/size guards & raw-byte leak:** `flow_load_sample_file` (`flow_store.rs:585`) lacks any extension allowlist (reading arbitrary non-`.tfcs` files from disk into RAM), `titer_import_fcs` (`mcp.rs:7043-7071`) omits URL rejection, `read_fcs_sample` reads unbounded file sizes (`fs::read`) while `stage_fcs_bytes` needlessly clones the full file buffer even when `staged == false`, and `parse_header` (`flow.rs:210-212`) leaks the first 6 bytes (`found {version_raw:?}`) of non-FCS files in IPC/MCP error messages.
- **Minimal Reproduction**:
  Invoke `flow_load_sample_file` from the webview with an arbitrary non-`.tfcs` path (e.g. a protected or binary file in `~/Documents`): executes `fs::read` synchronously on the main thread without an extension check.
- **Suggested Fix**:
  Make `flow_import_fcs` and `flow_load_sample_file` `async` with `tokio::task::spawn_blocking`, enforce `.tfcs` extension gating on `flow_load_sample_file`, reject URLs in `titer_import_fcs`, cap FCS/sidecar file reads, avoid cloning `original` when `staged == false`, and redact raw file bytes from `parse_header` errors.

---

### Issue 126: `parseSpilloverCsv` strips leading `\t` via `.trim()`, breaking every FlowJo TSV matrix, and `Number("")` silently accepts blank cells as `0`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/flow/compensation.ts:196, 209-248` (`parseSpilloverKeyword`, `parseSpilloverCsv`)
- **Explanation**:
  FlowJo TSV compensation matrices open the header row with a blank top-left corner cell (`"\tFITC\tPE\nFITC\t1\t0.1\nPE\t0.05\t1"`). `parseSpilloverCsv` (`line 212`) calls `.map((line) => line.trim())` **before** splitting on `\t`, deleting the leading tab (`"FITC\tPE"`) so `rows[0].slice(1)` drops `"FITC"` and every valid FlowJo TSV matrix fails with `"needs 1 data rows: got 2"` (or `"needs fluorochrome names"` on 1×1). Additionally, both `parseSpilloverCsv` (`line 238`) and `parseSpilloverKeyword` (`line 196`) evaluate `Number(cell)`, where `Number("") === 0` silently converts missing/blank entries (e.g. `"FITC,1,\nPE,0,1"` or `"2,FITC,PE,1,,0,1"`) into valid `0` coefficients instead of rejecting them.
- **Minimal Reproduction**:
  Call `parseSpilloverCsv("\tFITC\tPE\nFITC\t1\t0.1\nPE\t0.05\t1")` → throws `Error`; call `parseSpilloverCsv(",FITC,PE\nFITC,1,\nPE,0,1")` → silently returns `[[1, 0], [0, 1]]`.
- **Suggested Fix**:
  Only strip `\r` / skip blank lines (`line.trim().length > 0`) before splitting on `\t` or `,`, trim cells individually afterward, and reject empty cell strings (`cell === ""`), empty fluorochrome names, and non-integer `n` strings before `Number(...)`.

---

### Issue 127: Flow transform math defects (Rust + TS): `solveMonotonic` maps `NaN` → `-2` and `±Infinity` → `0` (unguarded in `viewer.ts`), `arcsinh` allows `A = -M` division by zero, and `log` is non-monotonic below `T·base^{-M}`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/flow/transforms.ts:117-136, 228-248, 257-260, 283-286`
  - `src-tauri/src/flow_transform.rs:104-127, 226-253, 261-269, 292-300`
  - `src/flow/viewer.ts:87-93` (`transformedCopy`)
- **Explanation**:
  Three numerical defects appear identically in TS and Rust:
  1. In `solveMonotonic` (`transforms.ts:228-248`, `flow_transform.rs:226-253`), `x = NaN` fails both `abs(f) <= tol` and `f < 0`, collapsing `hi` down to **`-2`** instead of returning `NaN`; `x = ±Infinity` yields `tol = Infinity`, returning **`0`** on iteration 0. Unlike `applyTransformToColumn`, `transformedCopy` (`viewer.ts:91`) passes raw events straight into `applyTransformValue`, turning `NaN`/`±Infinity` events into bogus finite plot coordinates at `-2`/`0`.
  2. `resolveTransform` never validates `A` for `"arcsinh"`: `A = -M` divides by `(M + A) * LN10 === 0` (`NaN`/`±Infinity` for all events), and `A < -M` flips the axis backward.
  3. `"log"` returns `floor` (`0`) for `x <= 0` without clamping positive values below `T·base^{M·(floor-1)}` (`~8.29` on defaults), so `f(0) = 0 > f(1) = -0.204` — making zero/negative events plot above positive events and contradicting `invertTransformValue` (which maps all `y <= floor` to `0`).
- **Minimal Reproduction**:
  With default logicle: `applyTransformValue(logicle, NaN) === -2` and `applyTransformValue(logicle, Infinity) === 0`; `resolveTransform("arcsinh", { M: 4.5, A: -4.5 })` yields `NaN` for positive inputs; default `log` gives `f(0) = 0 > f(1) = -0.20412`.
- **Suggested Fix**:
  Return `NaN` on non-finite inputs in `solveMonotonic` and guard non-finite inputs in `viewer.ts:91`; require `M + A > 0` for `arcsinh` (and bound `M + A` against `sinh`/`exp` overflow); and clamp `log` positive outputs with `.max(floor)` in Rust and TS.

---

### Issue 128: PDF and EPS vector exports silently render Arial, Helvetica, and default sans-serif text in `Times-Roman` because `"sans-serif".includes("serif")` is `true`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/lib/vector-export.ts:358, 1289-1294, 1744-1749` (`pdfFontKey`, `psFontName`)
  - `src/lib/preferences.ts:73-85` (`defaultFontFamily`)
  - `src/lib/figure.ts:623-628` (`composeFigureSvg`)
  - `src/views/graphs/plot-helpers.ts:314, 754, 1225` (`FONT`)
- **Explanation**:
  `defaultFontFamily("arial")` returns `"Arial, Helvetica, sans-serif"`, `defaultFontFamily("helvetica")` returns `"Helvetica, Arial, sans-serif"`, and graph SVGs use `FONT = "system-ui, -apple-system, sans-serif"`. Both `pdfFontKey` (`vector-export.ts:1292`) and `psFontName` (`1747`) execute `if (f.includes("times") || f.includes("serif")) return bold ? "F4" : "F3";` (`Times-Bold`/`Times-Roman`). Because `"sans-serif".includes("serif")` is `true`, **every** Arial, Helvetica, and default sans-serif text element in PDF and EPS exports silently embeds in Times-Roman while `measureTextWidth` (`line 953`) measures widths using the real CSS sans-serif font, misaligning centered and right-anchored labels.
- **Minimal Reproduction**:
  With Preferences → Default font set to Arial (or Helvetica), export any Figure or Graph to PDF or EPS: PDF/EPS streams emit `/F3`/`/F4` (`/Times-Roman`/`/Times-Bold`) instead of Helvetica.
- **Suggested Fix**:
  Check sans-serif families explicitly (or test `/(?:^|[\s,'"])serif\b/.test(f)`) before matching serif/Times.

---

### Issue 129: `Preferences ▸ Data Entry ▸ Clipboard` title options corrupt in-app `⌘C`→`⌘V` / Paste Transposed / Paste Special and disagree on decimal formatting between `toTSV` and `toHTMLTable`
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/views/tables/table-data.ts:1345-1373, 1390-1422, 1527-1551` (`toTSV`, `toHTMLTable`, `parseClipboardHTML`)
  - `src/views/tables/grid.tsx:508-517, 573-600, 746-771` (`onCopy`, `onPaste`, `pasteBlock`, `pasteTransposed`)
- **Explanation**:
  1. When **"Include column titles when copying"** is enabled, `toTSV` prepends a header line to `text/plain`. In-app `onPaste` (`grid.tsx:576`) and `pasteTransposed` (`grid.tsx:770`) parse `text/plain` verbatim as cell data — breaking single-cell range fill and pasting the column title string into the first target numeric cell while shifting data rows down by 1. Meanwhile `toHTMLTable` (`table-data.ts:1406-1413`) always emits `<thead>` even when `includeColumnTitles` is `false`.
  2. When **"Include row titles when copying"** is enabled and `range.c0 > 0`, both `toTSV` (`line 1364`) and `toHTMLTable` (`line 1417`) prepend column 0 into the data rows. Both `⌘V` and `Paste Special` (which only strips `<thead>`) write the row-title column into the destination data column and shift every pasted column right by 1. Additionally, `toTSV` writes raw `data.rows[r]?.[0]` without applying the decimal separator while `toHTMLTable` applies `shown(...)`.
- **Minimal Reproduction**:
  Enable Preferences → Data Entry → Clipboard → "Include column titles when copying" (or row titles), copy numeric cells `A1:A3` (`10, 20, 30`), and paste into `B1`: `B1` receives column title `"A"` (or row title `R1`) and shifts all data values.
- **Suggested Fix**:
  Carry an internal clipboard payload (e.g., custom MIME type `application/x-titer-cells`) for loss-free in-app `⌘V` / `Paste Transposed` / `Paste Special` while keeping `text/plain`/`text/html` formatted per Preferences for external apps; apply `shown(...)` consistently to column 0 in `toTSV`, and gate `<thead>` in `toHTMLTable` consistently with options.

---

### Issue 130: `Preferences ▸ Appearance ▸ Measurement units` (`cm`) creates an impossible-to-satisfy unit mismatch in `FigureView` size validation
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/lib/preferences.ts:111-143` (`MEASUREMENT_UNIT_CHANGED_EVENT`, `formatLength`)
  - `src/lib/figure.ts:441-455` (`validateFigureSize`)
  - `src/views/figures/figure-view.tsx:343-352, 570-584` (`changeSize`)
- **Explanation**:
  `FigureView` (`figure-view.tsx:570-584`) hardcodes `"Width (in)"` / `"Height (in)"` inputs and passes raw input values directly to `validateFigureSize`, which compares against `1..20` **inches** (`line 443`). However, `validateFigureSize` (`lines 450-452`) formats its rejection message in centimeters (`"Figure size must be between 2.5 and 50.8 cm in each dimension."`) whenever `loadMeasurementUnit() === "cm"`, while `formatLength` and `MEASUREMENT_UNIT_CHANGED_EVENT` have zero listeners/callers. Entering any valid cm value from the error message (such as `25` or `30`) is immediately rejected against `20` inches.
- **Minimal Reproduction**:
  Set Preferences → Appearance → Measurement units to **Centimeters**, open a Figure sheet, and enter `25` in Width: rejected with `"Figure size must be between 2.5 and 50.8 cm in each dimension."`.
- **Suggested Fix**:
  Subscribe `FigureView` to `loadMeasurementUnit()` / `MEASUREMENT_UNIT_CHANGED_EVENT`, display `widthIn * 2.54` / `heightIn * 2.54` when `cm`, label inputs `Width (cm)`/`Height (cm)`, and convert back via `/ 2.54` before calling `validateFigureSize`.

---

## Medium-Severity Issues (Recheck 5)

### Issue 131: `flow-density-plot` and `flow-contour-plot` hide all Y-axis controls in `FormatPanel` despite declaring `axes: XY_AXES`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/views/graphs/flow-plots.ts:33-46, 83-123`
  - `src/views/graphs/format-panel.tsx:461, 469, 483, 607`
  - `src/views/graphs/index.ts:87` (`hasValueAxis`)
- **Explanation**:
  `flowDensityPlot` (`flow-plots.ts:85-86`) and `flowContourPlot` (`106-107`) set `family: "heatmap"` and `axes: XY_AXES`, and `withAxes()` applies both `xAxisRange` and `yAxisRange`. However, `FormatPanel` still gates all Y-axis controls on legacy `family !== "heatmap"` (`lines 461, 469, 483`) and `hasValueAxis("heatmap") === false` (`line 607`), hiding Y Scale, Y Range, Y NumberFormat, and Y Reference Lines while showing X controls.
- **Suggested Fix**:
  Drive Y-axis controls and RefLines strictly from `yKind === "scale"` / `yKind === "range"` rather than `family !== "heatmap"` / `hasValueAxis`.

---

### Issue 132: `scree-plot`, `silhouette-plot`, and `forest-plot` `axes()` / `logScaleOffered()` contradict their builders on log scales
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/views/graphs/scree-plot.ts:37-49, 97`
  - `src/views/graphs/choosing-k.ts:108-111, 169`
  - `src/views/graphs/forest-plot.ts:48, 114-119, 150`
  - `src/views/graphs/plot-helpers.ts:462` (`logScaleOffered`)
- **Explanation**:
  1. `scree-plot` and `silhouette-plot` declare `y: "scale"` (offering Log10/Log2 Y), yet when `yScale !== "linear"` and `yMin`/`yMax` are blank, `addScreePlot` overwrites `layout.yaxis.range = [0, 100]` and `addSilhouettePlot` overwrites `layout.yaxis.range = [-1, 1]`. Because Plotly treats `range` on `type: "log"` as log10 exponents, bars/silhouettes collapse into `[1, 1e100]` or `[0.1, 10]`.
  2. `forest-plot` declares `x: "scale"` and `logScaleOffered("forest-plot")` offers `{ x: true, y: false }`, yet `build()` (`forest-plot.ts:48`) and `addForestPlot()` (`116`) hardcode `xaxis.type = "log"`, ignoring Linear/Log2 selection.
- **Suggested Fix**:
  Declare `y: "range"` with linear clamping on `scree-plot`/`silhouette-plot` (or avoid linear-unit `range` under `type: "log"`), and make `forest-plot` either declare `x: "range"` (non-togglable log axis) or honor `options.xScale`.

---

### Issue 133: Updater lacks concurrency guard (racing on `Titer-update.zip`) and silently reports offline cached manifests as `"up to date"`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/updates.ts:79-92, 120, 199-218`
  - `src/lib/channel.ts:71, 85-117, 128`
  - `src-tauri/src/updater.rs:223-224`
- **Explanation**:
  `fetchChannelManifest()` (`channel.ts:111-116`) returns stale `localStorage["titer.updateManifest"]` on network failure without indicating cache origin, causing manual `checkForUpdates(false)` while offline to display `"Titer is up to date"` and `checkForUpdatesDaily` to record a successful check timestamp. Additionally, `checkForUpdates` has no in-flight guard (so overlapping daily + manual checks race on `lastFetchError` and `Titer-update.zip`), and `decideUpdate` (`updates.ts:120`) reads module `isMacOs()` instead of `deps.isMacOs()`.
- **Suggested Fix**:
  Serialize `checkForUpdates` with an in-flight guard, distinguish live vs cached manifests so offline manual checks surface the fetch error, and pass `deps.isMacOs()` into `decideUpdate`.

---

### Issue 134: Staging an FCS file with exclusive `text_end == data_start` deletes byte 0 of DATA and misaligns all events
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src-tauri/src/flow.rs:258-264, 524-532, 543-572` (`parse_text`, `shifted`, `rebuild_dataset`)
- **Explanation**:
  `parse_text` (`flow.rs:260-261`) accepts an exclusive `header.text_end` pointing 1 byte past the closing delimiter (`seg.len() - 1`), yet `rebuild_dataset` (`lines 543, 571-572`) computes `old_text_len = text_end - text_start + 1` and executes `span.splice(text_at..text_end + 1, ...)`, deleting byte `text_end` — which is byte 0 of DATA when `text_end == data_start` — while `shifted()` keeps `data_start <= text_end` unshifted, corrupting every decoded event.
- **Suggested Fix**:
  Return the inclusive `text_end` from `parse_text` (decremented by 1 when the trailing byte was stripped) and use it consistently in `rebuild_dataset` and `shifted`.

---

### Issue 135: `FlowStore::apply_compensation` bypasses LRU budget eviction (~2× memory), `invert_matrix` can return `NaN`/`Inf` on overflow, and `parse_sidecar` uses unchecked multiplication
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src-tauri/src/flow_store.rs:330-366, 399-453, 601` (`apply_compensation`, `invert_matrix`, `parse_sidecar`)
  - `src/flow/store.ts:340-352`, `src/flow/compensation.ts:59-99`
- **Explanation**:
  1. `apply_compensation` adds `new_bytes` (up to another 100% of sample memory) to `bytes` without running the LRU eviction loop used in `insert()`, allowing store usage to reach ~2× `budget_bytes`.
  2. `invert_matrix` checks `abs() < 1e-12` (false for `NaN`) and never checks output entries for finiteness; ill-scaled finite matrices (e.g. `[[1e-11, 1e300], [0, 1e-11]]`) overflow to `Inf`/`NaN` and poison all compensated events.
  3. `parse_sidecar` (`flow_store.rs:601`) computes `SIDECAR_HEADER_LEN + file_params * event_count * 4` without `checked_mul`/`checked_add`, risking arithmetic wrap/OOM on 32-bit targets.
- **Suggested Fix**:
  Invoke the LRU eviction helper after `apply_compensation`, validate every entry of `invert_matrix`'s inverse with `.is_finite()`, and use checked arithmetic in `parse_sidecar`.

---

### Issue 136: `smoothGrid` returns all-`NaN` grids when `sigma <= 0` or `gridDim < Math.ceil(3 * sigma)`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/flow/density.ts:100-117` (`smoothGrid`)
  - `src/flow/viewer.ts:156-161`
- **Explanation**:
  When `sigma === 0`, `(-d * d) / (2 * sigma * sigma)` evaluates `0 / 0 = NaN`, poisoning the entire kernel and output grid. In addition, the single-bounce mirror `sym(k)` (`line 111`) reads out of bounds (`undefined`) whenever `2 <= line.length < Math.ceil(3 * sigma)` (e.g. `bins = 4` with default `sigma = 1.5`, `radius = 5`), propagating `NaN` across every cell of the grid.
- **Suggested Fix**:
  Return a copy of `counts` when `!(sigma > 0) || !Number.isFinite(sigma)` and replace single-bounce `sym(k)` with modular periodic reflection `(2 * len)` into `[0, len - 1]`.

---

### Issue 137: `computePopulationStats` reports wrong `% Parent` / `% Grandparent` / `% Total` (`100%` or `>100%`) when top-level populations (`parentId: null`) carry predicates
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/flow/stats.ts:167, 199-224` (`resolvePopulationIndices`, `computePopulationStats`)
  - `src/store/mcp-flow.ts:286-309, 336-351` (`parsePopulations`)
- **Explanation**:
  `computePopulationStats` (`lines 199-205`) assumes the first `parentId === null` population is an unpredicated root holding 100% of events and sets `parentCount = indices.length` when `parent` is undefined. When `titer_flow_population_stats` receives ad-hoc gated top-level populations (each `parent_id: null` with a filter predicate, no `"All events"` root), `total` equals the first gate's count rather than `columns[0].length`, reporting `pctParent = 100%`, `pctTotal = 100%` for the first gate and `>100%` for larger sibling gates.
- **Suggested Fix**:
  Compute `const total = columns[0]?.length ?? 0;` and `const parentCount = parent ? (indicesById.get(parent.id)?.length ?? 0) : total;`.

---

### Issue 138: `readOptions` in `project-file.ts` overwrites `GRAPH_LIMITS` clamping for `flowBins` and `flowDownsampleCap`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/lib/project-file.ts:288, 951-964` (`OPTIONAL_OPTIONS`, `readOptions`)
  - `src/store/types.ts:198-200, 318-319` (`GRAPH_LIMITS`)
  - `src/flow/density.ts:75, 176-179, 192`
- **Explanation**:
  In `readOptions` (`project-file.ts:951-964`), the `GRAPH_LIMITS` clamping loop runs **before** the `OPTIONAL_OPTIONS` loop. Because `flowBins` (`8..256`) and `flowDownsampleCap` (`100..5000`) appear in both maps, `OPTIONAL_OPTIONS` immediately overwrites the clamped values with raw unclamped numbers from `.hlx` JSON (`flowBins: -5` triggers `RangeError`, `4` produces all-`NaN` KDE grids, and `100000` allocates a `10^10`-cell matrix).
- **Suggested Fix**:
  Clamp `GRAPH_LIMITS` after `OPTIONAL_OPTIONS` is read (and validate/integer-clamp `bins` and `downsampleCap` inside `density.ts`/`viewer.ts`).

---

### Issue 139: `use-project-store.tsx` `case "create"` crashes on regex metacharacters in flow sample/table names (`nextName`), overwrites nodes & duplicates `rootOrder` on colliding `sampleId`, and drifts `rootOrder` vs `parseProjectFile`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/store/use-project-store.tsx:314-324, 374-436, 1958-1986` (`nextName`, `case "create"`, `createFlowSample`, `createFlowStatsTable`)
  - `src/store/mcp-flow.ts:136, 149-150, 360, 375`
  - `src/lib/project-file.ts:2604-2617`
- **Explanation**:
  1. `case "create"` passes root node names through `nextName`, which builds `new RegExp(\`^${prefix} (\\d+)$\`)` without escaping metacharacters — crashing `titer_import_fcs` / `titer_flow_population_stats` with `SyntaxError` on names like `"CD4++ (unstim"` and appending `" 1"` (`"PBMC 1"`) even when `"PBMC"` is unused.
  2. `createFlowSample` reuses `ref.sampleId` as `node.id` without collision checks: importing two stems with the same basename (`/a/tube.fcs`, `/b/tube.fcs` → both `"fcs-tube"`) or passing an existing node ID overwrites `state.nodes[id]` and pushes a duplicate ID into `rootOrder`.
  3. `case "create"` skips `"sample"` when choosing `insertAt`, placing tables created after a sample past the sample in `rootOrder`, whereas `parseProjectFile` orders `tables → infos → figures → samples`.
- **Suggested Fix**:
  Escape regex metacharacters in `nextName`, use `uniqueName` for flow sample/table names, reject/deduplicate colliding `sampleId`s before mutating `nodes`/`rootOrder`, and align `case "create"` `insertAt` ordering with `parseProjectFile`.

---

### Issue 140: New Preferences (`P-value format`, `Default font`, `Exports folder`) are unwired or non-reactive across primary consumers
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/lib/preferences.ts:70, 254, 325`
  - `src/views/analyses/analysis-results-view.tsx:23, 315-318, 527`
  - `src/views/graphs/graph-view.tsx:940-954`, `src/views/graphs/plot-helpers.ts:314, 754`
  - `src/views/figures/figure-export.ts:31, 194, 229, 251`
  - `src/views/graphs/graph-export.ts:194, 307, 327`, `src/views/tables/table-data-export.ts:86`, `src/components/converter-dialog.tsx:189`
- **Explanation**:
  1. `P_VALUE_FORMAT_CHANGED_EVENT` and `DEFAULT_FONT_CHANGED_EVENT` have **zero listeners** anywhere in `src/`, so changing P-value format or Default font never updates open analyses, graphs, or figures dynamically.
  2. `loadDefaultFont()` is read only in `composeFigureSvg`; `renderFigureRaster` (PNG/JPEG/TIFF/BMP/Office/Keynote exports) still hardcodes Arial and graphs still hardcode `FONT = "system-ui, -apple-system, sans-serif"`.
  3. `graph-export.ts`, `table-data-export.ts`, and `converter-dialog.tsx` never pass `defaultSaveFolder("exports", "")`, and `figure-export.ts`'s module-level `lastFolder` overrides any Exports folder change once a first export runs.
- **Suggested Fix**:
  Subscribe `AnalysisResultsView`, `GraphView`, `FigureView`, `renderFigureRaster`, and `plot-helpers.ts` to the change events; pass `defaultSaveFolder("exports", "")` in all export pickers and reset `lastFolder` on `DEFAULT_LOCATIONS_CHANGED_EVENT`.

---

### Issue 141: `Preferences ▸ Print ▸ Scale (%)` clamps every keystroke to `[50, 200]`, making it impossible to type multi-digit percentages (`80`, `120`, `150`)
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/components/preferences-dialog.tsx:506-517`
  - `src/ui/controls.tsx:64-81` (`NumberInput`)
- **Explanation**:
  `Scale (%)` binds a controlled `NumberInput` whose `onChange` discards `null` and immediately clamps every keystroke to `[0.5, 2]` (`[50, 200]`%). Deleting `"100"` is ignored, and typing `"8"` (for `"80"`) or `"1"` (for `"150"`) snaps immediately to `"50"`, turning the second digit into `"500"` / `"505"` → immediately clamped to `"200"`. (Likewise `"Margins (mm)"` cannot be cleared past its last digit.)
- **Suggested Fix**:
  Buffer uncommitted text state while editing or clamp only on `onBlur` / `Enter`.

---

### Issue 142: `Create an Info sheet with each new data table` (`L13`) is skipped by `createTable`, while `createTableWithGraph` bypasses `MAX_INFO_SHEETS`, duplicates `"Info Sheet"` names, reverses `rootOrder`, and ignores `Autocomplete titles`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/store/use-project-store.tsx:378-392, 731-784, 1890-1919, 2004-2030`
  - `src/components/app-shell.tsx:185-188`
  - `src/app-menu.ts:543-549`
- **Explanation**:
  `loadAutoCreateInfo()` is checked only in `case "createTableWithGraph"` (`line 762`), so `⌘N`, Sidebar `+ Table`, `Insert ▸ New Data Table…`, and `createTableWithData` never auto-create an Info sheet. Meanwhile `case "createTableWithGraph"` bypasses `MAX_INFO_SHEETS` (`500`), hardcodes duplicate `"Info Sheet"` names instead of `nextName("Info Sheet", taken)`, prepends new Info sheets before older ones in `rootOrder`, and ignores `loadAutocompleteTitles()`.
- **Suggested Fix**:
  Apply `loadAutoCreateInfo()` in `createTable` consistently, enforce `MAX_INFO_SHEETS`, assign unique names via `nextName`, insert after existing Info sheets, and apply `loadAutocompleteTitles()` in `createTableWithGraph`.

---

### Issue 143: Unescaped newlines in `PrintSettings.headerText` break or inject rules into `@media print` CSS in `printPageCss`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/lib/print-settings.ts:74-88` (`printPageCss`)
  - `src/components/app-shell.tsx:88-101`
- **Explanation**:
  `printPageCss` escapes only `\\` and `"` inside `body::before { content: "${text}"; ... }`. An unescaped newline (`\n`, `\r`, `\f`) in `headerText` terminates the CSS string per CSS Syntax Level 3, silently dropping the header or breaking out of `body::before` to inject arbitrary `@media print` CSS rules.
- **Suggested Fix**:
  Escape newlines/form-feeds (`\r\n`/`\r`/`\n` → `\A `, `\f` → `\C `) or strip control characters before interpolating into CSS, and validate finite `marginMm`/`scale`.

---

### Issue 144: `Extended log file` (`L16`) sends `navigator.userAgent` and `location.href` to the remote feedback server despite promising local-log-only detail
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/components/preferences-dialog.tsx:230-243`
  - `src/lib/preferences.ts:406-410`
  - `src/lib/error-log.ts:150-165` (`reportError`)
  - `src-tauri/src/mcp.rs:1657-1683, 1709-1773` (`error_feedback_entry`, `try_send_error_entry`, `mcp_log_error`)
- **Explanation**:
  Both `preferences-dialog.tsx:241` and `preferences.ts:408-409` tell users **Extended log file** only enriches the local log file, yet `error-log.ts:156-160` appends `[extended] ${navigator.userAgent} | ${location.href}` straight onto `entry.message`, which `mcp_log_error` forwards verbatim inside `error_feedback_entry` to the remote feedback server whenever error-report sharing is enabled (and varying URLs defeat dedup / truncation at 4000 chars can cut `[extended]`).
- **Suggested Fix**:
  Store extended context in a separate local-only field in `error-log.jsonl` excluded from `error_feedback_entry` and dedup keys (or explicitly disclose remote sharing in Preferences).

---

## Low-Severity Issues (Recheck 5)

### Issue 145: `prism-script.ts` `runScript` stamps `ctx.current` as `{ kind: "table" }` pointing to a non-table `rootOrder[0]` (e.g. a Flow `sample`)
- **Severity**: Low
- **Status**: New
- **Files**:
  - `src/lib/prism-script.ts:369-377, 1303-1314` (`currentNode`, `currentTable`, `runScript`)
- **Explanation**:
  When `active.type === "sample"` (or `activeNodeId` is null), `runScript` (`lines 1309-1311`) falls back to `{ kind: "table", id: doc.rootOrder[0] ?? null }` without checking whether `doc.rootOrder[0]` is actually a `"table"`. When an Info sheet, Figure, or Flow `sample` sits at index 0, `ctx.current` tags a non-table node ID as `"table"`, causing `currentTable()` to fail even if data tables exist later in `doc.rootOrder` and causing `%S` to expand a non-table node's name.
- **Suggested Fix**:
  Resolve `doc.rootOrder.find((id) => doc.nodes[id]?.type === "table") ?? null` as the fallback table ID.
