# Titer (Helix) Bug Report — Round 2 (Recheck 4 at `c54f5954`)

Review of `smitpatel316/Helix` (Titer) originally at `HEAD` `d44c1da` (67 findings), rechecked at `b8a2528` (`#68`–`#81`), at `8c877d8` (`#82`–`#97`), at `d4b45130` (`#98`–`#111`), and at `HEAD` `c54f5954` across the 90 commits in `fbc68961..c54f5954` (+4 findings `#112`–`#115`).

## Recheck Status at `c54f5954`

- **Round 1 (`85f6c91`, 28 issues)**: **28 of 28** fixed.
- **Round 2 (`d44c1da`, #1–#67)**: **42 Fixed** (`#2`, `#3`, `#5`, `#8`, `#12`, `#13`, `#14`, `#15`, `#16`, `#18`, `#21`, `#22`, `#26`, `#27`, `#30`, `#31`, `#32`, `#34`, `#35`, `#36`, `#38`, `#39`, `#40`, `#41`, `#42`, `#43`, `#44`, `#48`, `#49`, `#51`, `#53`, `#54`, `#55`, `#56`, `#58`, `#59`, `#61`, `#62`, `#64`, `#65`, `#66`, `#67` — +14 newly fixed at `c54f5954`), **24 Partially Fixed** (`#1`, `#6`, `#7`, `#9`, `#10`, `#11`, `#17`, `#19`, `#20`, `#23`, `#24`, `#25`, `#28`, `#29`, `#33`, `#37`, `#45`, `#46`, `#47`, `#50`, `#52`, `#57`, `#60`, `#63`), **1 Open** (`#4`).
- **Recheck 1 (`b8a2528`, #68–#81)**: **11 Fixed**, **3 Partially Fixed** (`#72`, `#73`, `#80`), **0 Open**.
- **Recheck 2 (`8c877d8`, #82–#97)**: **12 Fixed**, **4 Partially Fixed** (`#82`, `#89`, `#90`, `#95`), **0 Open**.
- **Recheck 3 (`d4b45130`, #98–#111)**: **5 Fixed** (`#102`, `#104`, `#106`, `#109`, `#111`), **8 Partially Fixed** (`#98`, `#99`, `#101`, `#103`, `#105`, `#107`, `#108`, `#110`), **1 Open** (`#100` — merged in `1f5af2e9`, reverted in `34f50c12`).
- **New in `fbc68961..c54f5954` (#112–#115)**: **4 New** (**2 High**, **2 Medium**).
- **Active Total**: **45 Active** (**27 High**, **16 Medium**, **2 Low**; **70 Fixed** out of 115 total).
  - *Note*: Several Partial entries below carry high-priority regressions introduced in the 2.0.4 batch (`#45` macOS OAuth `O_NONBLOCK`, `#98` Linux `xdg-open --`, `#47` `abandon_window` closing already-open windows, `#33` `convertTableToNested` wiping `cachedResult`, `#107` `noncentralTChiSquareLimit` 0.17 CDF error, `#103` `fitLinear` all-`NaN` on identical X, `#25` ragged grouped excluded-cell cursor drift, and `#11` release CSP / same-`pluginId` remount).

---

## Summary of Findings

| # | Severity | Status | Area | Issue Title |
| :- | :--- | :--- | :--- | :--- |
| 1 | **High** | Partial | Native IPC / Security | Unrestricted AppleScript execution (RCE), arbitrary file deletion, and ungated file moves in new shell IPC commands |
| 2 | **High** | Fixed | Cloud / Security | Arbitrary file read via unvalidated `provider` path traversal in `cloud_read_cache` |
| 3 | **High** | Fixed | Cloud / Security | OAuth browser URL allowlist bypass in `open_browser_url` / `open_url` via userinfo (`@`) |
| 4 | **High** | Open | Plugins / Security | Plugin permission UI spoofing in `permissionChoices`: non-canonical permission order swaps checkbox labels and grants the wrong capability |
| 5 | **High** | Fixed | Plugins / Security | Plugin capability revocation bypass: disabling/uninstalling a plugin never tears down its Isolation session, letting re-enable retain revoked permissions |
| 6 | **High** | Partial | Plugins / Security | Plugin static-gate bypasses (`__TAURI_INTERNALS__` regex typo, `Function()`, R backtick/dynamic dispatch) and `.GlobalEnv` escape in shared WebR |
| 7 | **High** | Partial | Plugins / Security | Path traversal in `manifest.entry` / zip-slip entries in `loadPluginFromZip`, plus unverified manifest ID/version on marketplace install & update |
| 8 | **High** | Fixed | Server / Security | Feedback server global rate limit can be exhausted by a single per-IP blocked attacker, plus unbounded rate-limiter maps and dedupe TOCTOU race |
| 9 | **High** | Partial | Cloud Sync | Cloud conflict "Overwrite" always fails (`expectedVersion ?? handle.version`), while offline-opened remote files silently overwrite remote edits |
| 10 | **High** | Partial | Cloud Auth | Concurrent Box token refresh deletes fresh single-use tokens and signs user out; deleted tokens leave permanent zombie accounts |
| 11 | **High** | Partial | Plugins / Isolation | `PluginIsolationWebview` is non-functional in both dev (`<StrictMode>` teardown) and release builds (Tauri CSP blocks `srcDoc` inline `<script>`s) |
| 12 | **High** | Fixed | Marketplace / Plugins | Enabled marketplace plugins are never re-registered into the live plugin registry on app restart |
| 13 | **High** | Fixed | UI / Scripts | `ScriptDialog` crashes React on opening File ▸ Run Script… (conditional `useState` after early `return null`) |
| 14 | **High** | Fixed | UI / Wizard | `AnalysisWizard` crashes with uncaught `TypeError` on Change Parameters… (`⌘T`) whenever a wizard has 0 questions for the current table |
| 15 | **High** | Fixed | UI / Analyses | `AnalysisView` Cancel button and elapsed-time/queue display are unreachable dead code while an analysis is running |
| 16 | **High** | Fixed | UI / Import | `ImportDialog` overwrites the parent table when "Create a new table" is shown selected (`insertionPoint === null`), drops all edits on `Enter` (stale closure), and strips the whole file as Info/Notes on `fromRow` |
| 17 | **High** | Partial | Graphs / Store | Freezing a graph does not freeze it — `mergedGraphData` always reads live `parent.data` and overrides `frozenData` |
| 18 | **High** | Fixed | Store / Duplicate | `duplicateFamily` fails to remap analysis links in cloned graphs, binding duplicated graphs to the original table's analyses |
| 19 | **High** | Partial | Store / Document | `use-document.ts` reads stale `latest.current` immediately after `dispatch`, dropping `runOnClose` script changes on close and skipping crash-recovery backup refresh in `revertToSaved` |
| 20 | **High** | Partial | Project File | Save/load round-trip regressions in `project-file.ts`: frozen graphs/figures always reopen `updated: true`, blank/image figure panels trigger false "missing graph" warnings, and `rootOrder`/`orphanedDataSet` mismatches |
| 21 | **High** | Fixed | Calculated Variables | `calcvars.ts`: `NOT` binds tighter than comparisons/arithmetic (inverting `WHERE NOT …` and `IF(NOT …)`), and `renameVariableInFormula` writes unbracketed names (breaking formulas or silently substituting `Math.E`/`Math.PI`) and corrupts scientific notation |
| 22 | **High** | Fixed | Calculated Variables | `calcvars.ts`: stale `rawTextAt` for chained calculated variables (`COUNTA`, `OVER`), silent wrong/blank results for expression aggregates (`MIN(A+B)`, `MEAN(A+B)`), and `RANK` returning `0.5` on excluded rows |
| 23 | **High** | Partial | Tabular Import | `.xlsx` import misclassifies custom number formats containing `[Red]`, currency codes, or unit suffixes (`"nM"`, `"mg/mL"`) as dates — silently corrupting numeric data into 1900-era date strings |
| 24 | **High** | Partial | Tabular Import | `.xlsx` / CSV importer corrupts rows on self-closing `<row .../>` and `<t/>` tags, crashes on malformed attributes/entities, and overflows the call stack before `MAX_IMPORT_ROWS` truncation |
| 25 | **High** | Partial | Prism `.prism` Import | `.prism` import drops `summaryFormat` on grouped summary tables (treating Mean/SD/N as raw replicates) and fails to sanitize `:` or pad ragged subcolumns |
| 26 | **High** | Fixed | Prism `.prism`/`.pzfx` Export | Native Titer XY replicate (`A:Y1`, `A:Y2`) and XY summary (`A:Mean`, `A:SD`, `A:N`) tables lose their grouping, `summaryFormat`, and nonlinear-regression dataset links in both `.prism` and `.pzfx` exports |
| 27 | **High** | Fixed | Vector Export (EPS) | EPS vector export produces invalid/corrupted PostScript (`nocurrentpoint` crash on text + leaked `clip` path) |
| 28 | **High** | Partial | Vector Export (PDF) | PDF vector export corrupts all non-ASCII text (`−`, `R²`, `±`, `µM`, `°C`, `×`) by writing UTF-16BE bytes into single-byte Type1 `Tj` streams |
| 29 | **High** | Partial | Vector Export (PDF/EPS) | Vector PDF/EPS export silently ignores Plotly CSS `px` units (`font-size`, `stroke-width`, `stroke-dasharray`), erases parent `<g>` opacity, and `grayscaleFigure` rewrites series labels matching CSS color names |
| 30 | **High** | Fixed | Vector Export (Figures) | Multi-panel Figure vector PDF and EPS exports are shrunk to 75% (`0.75×`) of configured physical dimensions |
| 31 | **High** | Fixed | Graphs (Grouped) | `grouped-bars-scatter` ("Bars with individual points") plots numeric scatter X coordinates on a categorical X axis and duplicates points/legend entries |
| 32 | **High** | Fixed | Graphs (Summary) | Summary tables draw no SEM error bars on `"mean-sem"` tables and drop asymmetric lower error bars (`errorMinus`) on XY summary graphs |
| 33 | **High** | Partial | MCP Server | `titer_read_results` returns stale cached results after table mutations and returns `not_computed` for frozen/orphaned/cloned analyses with saved `cachedResult` |
| 34 | **High** | Fixed | MCP / Param Validation | `validateAnalysisParams` omits 11 per-analysis enum narrowings from `analysis-params-schema.json`, allowing cross-family params that silently run the wrong statistical test or crash R |
| 35 | **High** | Fixed | XY Graphs / Overlays | `addFittedCurve` draws all-`NaN` curves (no line rendered) for every multi-Y (`params.ys`) and curve-comparison (`params.compareWith`) nonlinear regression |
| 36 | **High** | Fixed | XY Stats (Nonlinear) | Raw-X sigmoidal models (`sigmoidal-4pl-x`, `absolute-ic50-x`, `asymmetric-5pl-x`, `agonist-4pl-normalized-x`) force `Y = Bottom` (or `0`) at `X = 0` in R even when `HillSlope < 0`, corrupting falling-curve fits and disagreeing with TS `evaluate()` |
| 37 | **High** | Partial | XY Stats (Nonlinear) | `applyFitOptions` (`transformNlsCall`) silently strips built-in `lower=`/`upper=` bounds on 17+ models whenever weights, fixed params, bounds, or robust/Poisson IRLS are used — and crashes on `logistic-growth` / `gompertz-growth` |
| 38 | **High** | Fixed | XY Stats (Nonlinear) | Weighted, robust, and Poisson fits on log-Y models (`semilog-y-log`, `log-log-line`, `exponential-growth-log`) compute `R²` by dividing `log(Y)`-scale SS by raw `Y`-scale SST, and Poisson IRLS uses `1/log(Y)` weights |
| 39 | **High** | Fixed | XY Stats (Nonlinear) | `ecAnything` crashes R (`subscript out of bounds`) when `params.ecx` is requested on competition models, and `runGlobalNonlinear` mislabels shared `IC50`/`IC50Hi`/`LogKd` midpoints as `"EC50"` |
| 40 | **High** | Fixed | XY Stats (User-Defined) | `user-defined.ts` accepts R reserved keywords (`NA`, `Inf`, `NULL`, `TRUE`, `for`, `in`, …) causing R syntax errors, and naming a parameter `HillSlope` causes the fitted curve overlay to render nothing (all `NaN`) |
| 41 | **High** | Fixed | Multiple Stats | Multiple Linear Regression (`multiple-regression.ts`) miscomputes VIFs, crashes with R syntax error when only categorical predictors are present, and passes raw unaligned columns to `describe()` |
| 42 | **High** | Fixed | Grouped Stats | Three-way ANOVA Games–Howell post-hoc crashes R (`object 'Infinity' not found`) when compared cells have zero variance (identical replicates) |
| 43 | **High** | Fixed | Sample Size & Power | Sample Size & Power `solveEffect` fails for all valid effects in the upper doubling band (e.g. Pearson `r ∈ (0.8, 1)`, one-proportion `h ∈ (1.6, π]`, t/ANOVA/χ² `∈ (6.4, 10]`), and `power <= alpha` returns bogus `effect ≈ 0` |
| 44 | **Medium** | Fixed | Tauri Capabilities | Missing `core:window:allow-hide` and `core:window:allow-set-focus` capabilities silently break BUG-12 close-quiesce mitigation and non-macOS Window menu switcher |
| 45 | **Medium** | Partial | Cloud Auth (Box) | Box OAuth loopback flow has bind-after-open race, aborts on single non-callback socket, blocks Tokio worker, and leaks thread/port on timeout |
| 46 | **Medium** | Partial | Auto-Updater | Auto-updater `download_update` and `apply_update` block the macOS main thread and accept arbitrary HTTPS URLs / unverified bundles |
| 47 | **Medium** | Partial | MCP Server | Failed `titer_open_project`, `titer_import_prism`, `titer_create_project`, and `titer_cloud_download` leak a blank window and hijack `last_published` |
| 48 | **Medium** | Fixed | Export / Paths | Export tools fail with `"Titer can't access <path>"` whenever the output filename contains a dot (e.g. `Fig 1.2`) or on Windows paths with a dot in a parent directory |
| 49 | **Medium** | Fixed | MCP Schema | `analysis-params-schema.json` omits `"none"` from `posthoc` enum for `nested-anova`/`multifactor-anova`, marks defaulted params required for `two-way-anova`/`rm-anova`, and duplicates `"xy"` in `nonlinear-regression.offered_on` |
| 50 | **Medium** | Partial | Graphs / Figures Export | `titer_export_all_graphs` and Figure exports omit `deps.run` / `rootOrder`; `buildGraphFigure` diverges from `GraphView` (drops `sourceTableIds`, `frozenData`, `sigAnalysisIds`, number/date formatting) |
| 51 | **Medium** | Fixed | XY Graphs / Overlays | Replicate XY tables break `deming-overlay.ts` & `binding-curve.ts` overlays; `addLogisticCurve` queries three nonexistent stat labels (always displaying `—`) |
| 52 | **Medium** | Partial | Store / Transforms | Renaming a column/group blanks dependent `% of control` transformed tables, edits overwrite frozen transformed tables, and `followTable` misses newly added column-name fields |
| 53 | **Medium** | Fixed | Tables / CalcVars | `permuteColumns`, `dropColumns`, and `removeCalculatedVariable` corrupt or leak `cellBackgrounds`, `linkedPaste`, `calculated`, `decimals`, `variableTypes`, `labelVariable`, and `levelOrder` |
| 54 | **Medium** | Fixed | Data Grid / Clipboard | Copying cells in Titer and pasting via Paste Special (default options) inserts a spurious column-header row |
| 55 | **Medium** | Fixed | Prism `.pzfx` Import | `.pzfx` XML parser scrambles mixed-content `<Title>`/`<d>` tags (`H<Sub>2</Sub>O` → `"HO2"`), drops `<Font>`-wrapped `<Info>` text, double-decodes CDATA, and matches closing-tag prefixes |
| 56 | **Medium** | Fixed | Prism Import | Scientific-notation comma-decimal numbers (e.g. `"4,096e+007"`, `"1,5e-3"`) are not normalized in `.pzfx` or `.prism` import and are silently dropped as non-numeric text |
| 57 | **Medium** | Partial | Prism Scripts | `prism-script.ts`: `DuplicateDataTable Clear` leaks phantom exclusions, `Import` at `row = 0` drops first CSV row, Survival tables mis-index Y columns by 1, `ExportTable All` without `SetPath` targets `/`, and script table mutations leave calculated variables & transformed tables stale |
| 58 | **Medium** | Fixed | Prism Graph Regen | `applyRegenDecisions` mutates the project before validating later decisions (creating duplicate graphs on retry), and `mapSidecarGraph` ignores summary formats on grouped `.prism` tables |
| 59 | **Medium** | Fixed | Multi-Table Graphs | `mergeGraphTables` skips the `summaryFormat` mismatch check for XY tables and silently drops extra Nested tables whose name contains `:` |
| 60 | **Medium** | Partial | Prism `.prism` Import | `.prism` import destroys line breaks in Info Sheet `notes` via `plainTitle()` and lacks bounds/type guards on malformed `document.json` / `content.json` and large row/column spreads |
| 61 | **Medium** | Fixed | Stats Report | `report/conclusion.ts`, `report/checks.ts`, and `report/analyzed.ts` produce inverted/misleading conclusions and assumption checks (FDR `multiple-t-tests` always concludes "no difference", `compareModel` prints `"Y" and "undefined"`, `chi-square` trend uses omnibus Pearson P, `checks.ts` ignores weights & replicates, `analyzed.ts` ignores `chi-square` `sets` and misreports MV `linear-regression` X) |
| 62 | **Medium** | Fixed | XY Stats (Nonlinear) | `AICc` in `enzyme-inhibition.ts` (and `nonlinear-regression.ts`) omits the residual-variance parameter (`+ 1`) from `k`; `interpolationCode` silently drops 95% CIs on tight positive-X ranges; multi-Y centered polynomials share only the first set's `centeredX` |
| 63 | **Medium** | Partial | Sample Size & Power | `noncentralTCdf` underflows to `0` at `|δ| ≥ 38.57`, causing t-test power to jump discontinuously to `100%` and `solveN` to underestimate `n` at small `df` / strict `α` |
| 64 | **Medium** | Fixed | Plugins / Marketplace | Plugin wizard `kind: "text"` questions reject all non-numeric text, and `MarketplaceDialog` pre-checks `"network"` (and all permissions) by default |
| 65 | **Low** | Fixed | UI / Menus | UI/menu minor defects: duplicate Grubbs' `"Outliers by column"` table, duplicate `Edit ▸ Fill Down` menu item (first lacks `!activeTableFrozen`), `CmdOrCtrl+Alt+I` shortcut collision (`New Info Sheet…` vs `Inspector`), and stale `Change Parameters…` enabled state |
| 66 | **Low** | Fixed | WebR / Survival | WebR / survival edge cases: `ensurePackages` doubles caller `timeoutMs` on claim timeout; `survival-analysis.ts` computes 2-group HR on `k ≥ 3` and returns `—` without explanation on disjoint risk sets |
| 67 | **Low** | Fixed | Nested Tables (R1 #28) | [Carryover from Round 1 #28] Pasting wide data into a Nested table silently drops overflow columns without showing the `"Some Values Weren't Pasted"` notice (`columnsBeyond` omits `isNested(data)`) |
| 68 | **High** | Fixed | Native Clipboard | `copy_pdf_to_clipboard` puts two separate `NSPasteboardItem`s on the macOS clipboard instead of one multi-flavour item |
| 69 | **High** | Fixed | UI / What's New | `WhatsNewDialog` auto-closes itself 2 seconds after opening via Help ▸ What's New |
| 70 | **High** | Fixed | Error Reporting | Independent error-report sharing (`CrashReportDialog` / `try_send_error_entry`) never sends when feedback sharing is off |
| 71 | **High** | Fixed | UI / Startup Guide | `StartupGuideDialog`'s `mailto:smit@muse.ai` support link is silently blocked by Tauri's `.on_navigation` policy |
| 72 | **High** | Partial | Error Reporting | Startup flush race and permanent unsent-duplicate loop in `CrashReportDialog` / `main.tsx` / `mcp_flush_error_log` |
| 73 | **Medium** | Partial | Figures / Freeze | Freezing or re-freezing a graph overrides the snapshot of a previously frozen Figure |
| 74 | **Medium** | Fixed | UI / Analyses | macOS native `NSProgressIndicator` spinner overlaps the `Running…` text and `Cancel` button in `AnalysisView` |
| 75 | **Medium** | Fixed | Native Clipboard | `copy_pdf_to_clipboard` JXA `if (!pdfData)` / `if (!pngData)` checks are dead code, wiping the user's clipboard on read failure |
| 76 | **Medium** | Fixed | Feedback / Privacy | `SendFeedbackDialog` and `AiConnectionsDialog` drop server/network errors and falsely claim "Sharing is off"; `mcp_send_feedback` sends `project_file` + `recent_activity` |
| 77 | **Medium** | Fixed | UI / Modals | `StartupGuideDialog`'s global `window` keydown handler hijacks `Enter` and `Escape` from top-layer `<dialog>` modals (including `SendFeedbackDialog`) |
| 78 | **Medium** | Fixed | Native Menu | Windowless Help menu exposes Help ▸ Send Feedback and Help ▸ What's New as enabled dead no-ops |
| 79 | **Medium** | Fixed | UI / Startup Guide | `StartupGuideDialog` auto-show omits `!openedFile.current` and pops over opened `.pzt` templates, Sample Project, and slow/failed file launches |
| 80 | **Medium** | Partial | Math / Distributions | `noncentralTCdf` (`logWeights` path) silently returns `1.0` when `rxb` underflows at large `df` and still cliffs to `0` past `|δ| > 447` |
| 81 | **Low** | Fixed | Native IPC | `send_to_keynote_blocking` / `applescript_number` lacks `.is_finite()` / upper-bound checks and can emit invalid AppleScript `inf` or `0` |
| 82 | **High** | Partial | Graphs / Labels | `formatFigureLabels` HTML-escapes `<br>` and `<b>` across graph overlays, tooltips, and survival tables |
| 83 | **High** | Fixed | Graphs / Security | `formatLabelForPlotly` double-escapes `&`, `<`, `>`, `\^`, `\_` in `buildGraphFigure` and allows HTML-escaping bypass (XSS) via `<sup>`/`<sub>` |
| 84 | **High** | Fixed | Vector Export (PDF/EPS) | `vector-export.ts` `textRuns` splits single-line Plotly `<sup>`/`<sub>` `<text>` into separate lines, breaking `middle`/`end` alignment |
| 85 | **High** | Fixed | XY Stats (Nonlinear) | `ecAnything` for `homologous-competition-logx` uses inverted `(100 - f) / f`, computing `IC(100-F)` labeled as `IC{F}` |
| 86 | **High** | Fixed | XY Stats (Nonlinear) | Sign-aware `X = 0` guard `ifelse(HillSlope<0, Top, Bottom)` truncates unshared `Top[g]`/`Bottom[g]` to length 1 in global fits |
| 87 | **High** | Fixed | Server / Reliability | `feedback-server` `DedupeSet` has permanent `in_flight` leak on client disconnect, two-mutex TOCTOU race, and `Notify` lost wakeup |
| 88 | **High** | Fixed | MCP Bridge | `mcp-bridge` `seq 540` session recovery fails on port-change restart, fails on rotated-token restart, and permanently wedges on transient failure |
| 89 | **High** | Partial | WebR / Concurrency | `webr.ts` P-12 claim-stamp matching uses a 5-second fuzzy window and never clears `claimStamps` on install/reset/release |
| 90 | **High** | Partial | WebR / Concurrency | `webr.ts` `ensurePackages` resolves as success while packages are still `"loading"` when an evicted joined batch settles after a retry started |
| 91 | **Medium** | Fixed | Graphs / Labels | `formatFigureLabels` rewrites `layout.annotations[i].name`, breaking point-label drag repositioning and leaking phantom keys into `graphOptions.points` |
| 92 | **Medium** | Fixed | Graphs (Grouped) | `buildGroupedBars` breaks `groupLayout: "superimposed"` when `showPoints: true`, misaligning bars with significance overlays |
| 93 | **Medium** | Fixed | MCP Server | `TiterMcpServer::get_info()` never advertises `capabilities.tools.listChanged: true` and `mcp_set_enabled(false)` never clears `inner.peers` |
| 94 | **Medium** | Fixed | MCP Server | `reapply_antigravity_entry_if_connected` silently overwrites custom/remote `"titer"` entries in `~/.gemini/config/mcp_config.json` on every launch |
| 95 | **Medium** | Partial | Tabular Import | `parseXlsx` skips self-closing `<si/>` (and `<si ...>` with attributes) in `sharedStrings.xml`, shifting all subsequent cell strings off by 1, and concatenates `<rPh>` phonetic runs |
| 96 | **Medium** | Fixed | WebR / Concurrency | `webr.ts` `resolveInEngine` fires an unconditional `releaseClaimCode(pending)` on claim timeout (`codes === null`), risking wiping another window's live claim |
| 97 | **Low** | Fixed | Graphs / Tables Labels | `labelRuns` splits Unicode minus (`10^−6` → `10<sup>−</sup>6`) and collapses consecutive `_` runs (`ctrl_1_a` → `ctrl<sub>1a</sub>`) |
| 98 | **High** | Partial | Native IPC / Security | `open_file` IPC permits arbitrary executable launch (no extension allowlist), Windows `cmd /C start` shell injection, and macOS `open` flag injection |
| 99 | **High** | Partial | Data Grid / Tables | `pasteNames` (upstream 1.1.1) corrupts Nested tables (`isNested` omitted), drops column metadata/calculated formulas, and cross-renames lead/group collisions |
| 100 | **High** | Open | Graphs / Format Panel | Upstream 1.1.1 `axisKind` is not wired into `FormatPanel`: `rowsAt: "values"` and `histogram`/`qq-plot` lose X controls, `grouped-stacked`/`residuals` offer dead Log controls, `grouped-hbars` mislabels value axis as `"Y"`, and `scree-plot`/`dendrogram` misdeclare `XY_AXES` |
| 101 | **High** | Partial | Graphs (Horizontal Bars) | Point labels on Horizontal Bars (`grouped-hbars`) with Log scale transform `y` instead of `x`, placing labels at `10^v` off-canvas and `NaN` on row 0 |
| 102 | **High** | Fixed | Column Stats (ANOVA) | `2db68ed1` ANOVA 13-digit centering missed `TukeyHSD` (making Tukey P values contradict centered Tukey CIs), plus Welch, Brown-Forsythe, linear trend, and post-hoc diffs |
| 103 | **Medium** | Partial | XY Stats (Linear) | `2db68ed1` linear-regression centering missed `compare-slopes.ts`, `report/checks.ts`, and `regression-overlay.ts` (crashes or inflates graph CI bands on 13-digit data) |
| 104 | **Medium** | Fixed | Graphs (Grouped) | `valueXAxis` drops `options.gridX`, silently disabling X gridlines on Connected Lines with `rowsAt: "values"` |
| 105 | **Medium** | Partial | UI / What's New | `isNewer` and `seenVersion` invert semver pre-release ordering (`2.0.2-rc.1 > 2.0.2`) and reject pre-release / uppercase-`V` seen strings |
| 106 | **Medium** | Fixed | Native Clipboard | `clipboard_text` (macOS) passes unchecked nullable `UTF8String` pointer to `CStr::from_ptr` in `unsafe` |
| 107 | **Medium** | Partial | Math / Distributions | `noncentralTCdf` overflows `tt * tt` for `|t| ≥ 1.34e154` (returning `normalCdf(-delta)` instead of `1`/`0`) and `noncentralTTwinSeriesModeCentered` breaks at `|δ| ≥ 1e6` / large `df + δ` |
| 108 | **Low** | Partial | UI / What's New | `WhatsNewDialog` `close()` unconditionally overwrites `titer.whats-new-seen` with the running version, regressing the seen marker after a downgrade |
| 109 | **Low** | Fixed | UI / Import | `openSourceFile` discards the specific Rust error string returned by `open_file` (`err instanceof Error` is `false` for Tauri string rejections) |
| 110 | **Low** | Partial | Graphs / Ticks | `fitLabels` produces `dtick: NaN` on coincident adjacent ticks (`at[1] === at[0]`), and `graph-view.tsx` checks `!current` after `Plotly.relayout` instead of immediately after `Plotly.react` |
| 111 | **Low** | Fixed | XY Graphs / Overlays | `fitted-curve.ts` `x === 0` guard misses 4 other R-guarded raw-X ratio models (`agonist-3pl-x`, `agonist-3pl-normalized-x`, `biphasic-x`, `bell-shaped-x`) and `asymmetric-5pl-x` underflow at tiny `HillSlope` |
| 112 | **High** | New | Grouped Stats (2-Way ANOVA) | Two-way ANOVA `runPosthoc` still computes uncentered `mean(a) - mean(b)` at `1e13` scale (4.76% error on all ordinary and RM sphericity-assumed post-hocs) |
| 113 | **High** | New | Grouped Stats (3-Way ANOVA) | Three-way ANOVA `runPosthoc` computes uncentered `diff` and single-pass TS Games–Howell `variance()` at `1e13` scale (4.76% diff / 6.0% variance error) |
| 114 | **Medium** | New | Nested Stats | Nested ANOVA post-hoc `diff` still subtracts raw uncentered `described[i].mean - described[j].mean` instead of `describe()`'s centered `diff(i, j)` |
| 115 | **Medium** | New | XY Stats (Deming) | Deming regression TS `olsFit` (for `notes()`) and `demingProblem` still use single-pass uncentered sums (disagreeing with R OLS rows at `1e13` and letting constant `[0.1, 0.1, 0.1]` flow to all-`NaN` R output) |

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

### Issue 2 [FIXED]: Arbitrary file read via unvalidated `provider` path traversal in `cloud_read_cache`
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`src-tauri/src/cloud.rs:549-556` allowlists `PROVIDER_BOX` / `PROVIDER_MOCK`)
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

### Issue 3 [FIXED]: OAuth browser URL allowlist bypass in `open_browser_url` / `open_url` via userinfo (`@`)
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`src-tauri/src/cloud.rs:370-384` fails closed when authority contains `@`)
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

### Issue 5 [FIXED]: Plugin capability revocation bypass: disabling/uninstalling a plugin never tears down its Isolation session, letting re-enable retain revoked permissions
- **Severity**: High
- **Status**: Fixed at `8c877d8` (`src/plugins/loader.ts:292-321`, `src/plugins/isolation.ts:201-209, 306-326`, and `src/marketplace/store.ts:260-266, 344-356` tear down active sessions, clear live grants, and validate live grants in `launchPluginWebview` / `interceptPluginCall`)
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

### Issue 8 [FIXED]: Feedback server global rate limit can be exhausted by a single per-IP blocked attacker, plus unbounded rate-limiter maps and dedupe TOCTOU race
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`feedback-server/src/lib.rs:350-478, 775-840` unifies `DedupeSet` under a single `Mutex<DedupeState>` with RAII `InFlightGuard` and pre-registered `OwnedNotified`, closing the remaining dedupe gap alongside `#87`)
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

### Issue 12 [FIXED]: Enabled marketplace plugins are never re-registered into the live plugin registry on app restart
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/main.tsx:54-71` awaits `getMarketplaceStore()` before mount; `src/marketplace/store.ts:99-111` rechecks `"incompatible"` records on upgrade; `src/marketplace/wiring.ts:22-35` drops rejected `storePromise` on error)
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

### Issue 13 [FIXED]: `ScriptDialog` crashes React on opening **File ▸ Run Script…** (conditional `useState` after early `return null`)
- **Severity**: High
- **Status**: Fixed at `b8a2528` (conditional hooks moved into `SavedScriptsPanel` in `src/components/script-dialog-saved.tsx:16-31` / `src/components/script-dialog.tsx:54-62, 157-163`)
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

### Issue 14 [FIXED]: `AnalysisWizard` crashes with uncaught `TypeError` on **Change Parameters… (`⌘T`)** whenever a wizard has 0 questions for the current table
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`canEditAnalysisParams` + `wizardAsksNothing` in `src/views/analyses/wizards.ts:632-655, 706-752` and `!q` guards in `src/views/analyses/analysis-wizard.tsx:228-327`)
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

### Issue 15 [FIXED]: `AnalysisView` **Cancel** button and elapsed-time/queue display are unreachable dead code while an analysis is running
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`src/views/analyses/analysis-view.tsx:34-66, 225-227` renders elapsed time, queue position, and **Cancel** inside `<Running />`; see new macOS native spinner overlap regression in Issue #74)
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

### Issue 16 [FIXED]: `ImportDialog` overwrites the parent table when "Create a new table" is shown selected (`insertionPoint === null`), drops all edits on `Enter` (stale closure), and strips the whole file as Info/Notes on `fromRow`
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/views/tables/import-dialog.tsx:197-204, 253-254, 277-296, 850, 888` handles `insertionPoint === null`, keeps latest `confirm`/`onCancel` via refs, and initializes `fromRow` end-row state)
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

### Issue 18 [FIXED]: `duplicateFamily` fails to remap analysis links in cloned graphs, binding duplicated graphs to the original table's analyses
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/store/use-project-store.tsx:646-675` builds a two-pass `idMap` and remaps all 11 `GRAPH_ANALYSIS_ID_KEYS` plus `sigAnalysisIds`)
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

### Issue 21 [FIXED]: `calcvars.ts`: `NOT` binds tighter than comparisons/arithmetic (inverting `WHERE NOT …` and `IF(NOT …)`), and `renameVariableInFormula` writes unbracketed names and corrupts scientific notation
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`not()` precedence added in `src/lib/calcvars.ts:251-264, 301-304`; `renameVariableInFormula` at `src/lib/calcvars.ts:1253-1301` skips numeric literals and brackets non-identifier/reserved names)
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

### Issue 22 [FIXED]: `calcvars.ts`: stale `rawTextAt` for chained calculated variables (`COUNTA`, `OVER`), silent wrong/blank results for expression aggregates (`MIN(A+B)`, `MEAN(A+B)`), and `RANK` returning `0.5` on excluded rows
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/lib/calcvars.ts` reads computed text in `rawTextAt`, rejects non-`var` expression aggregates, and returns `null` from `RANK` on `WHERE`-excluded rows; minor edge case: a `ROWS` frame excluding `CURRENT ROW` with tying values at `src/lib/calcvars.ts:756` can still match `equal >= 1`)
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

### Issue 26 [FIXED]: Native Titer XY replicate (`A:Y1`, `A:Y2`) and XY summary (`A:Mean`, `A:SD`, `A:N`) tables lose their grouping, `summaryFormat`, and nonlinear-regression dataset links in both `.prism` and `.pzfx` exports
- **Severity**: High
- **Status**: Fixed at `c54f5954` (re-applied in `4860fc4d` with positional dataset lettering fix in `a4d1425d` across `src/lib/prism-write.ts` and `src/lib/pzfx-write.ts`)
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

### Issue 27 [FIXED]: EPS vector export produces invalid/corrupted PostScript (`nocurrentpoint` crash on text + leaked `clip` path)
- **Severity**: High
- **Status**: Fixed at `8c877d8` (`src/lib/vector-export.ts:1646-1664, 1709`; minor EPSF-3.0 note: `%%BoundingBox` on line 1737 still emits fractional floats rather than integer bounds)
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

### Issue 30 [FIXED]: Multi-panel Figure vector PDF and EPS exports are shrunk to 75% (`0.75×`) of configured physical dimensions
- **Severity**: High
- **Status**: Fixed at `8c877d8` (`src/lib/figure.ts:670` emits `pt` units in `composeFigureSvg`; `src/lib/vector-export.ts:1540-1563` handles unit conversion in `svgSize`/`rootViewBoxMatrix`)
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

### Issue 31 [FIXED]: `grouped-bars-scatter` ("Bars with individual points") plots numeric scatter X coordinates on a categorical X axis and duplicates points/legend entries
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`buildGroupedBarsScatter` at `src/views/graphs/grouped-common.ts:229-237` delegates directly to `buildGroupedBars` with `showPoints: true` on the numeric bar axis, alongside `#92`)
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

### Issue 32 [FIXED]: Summary tables draw no SEM error bars on `"mean-sem"` tables and drop asymmetric lower error bars (`errorMinus`) on XY summary graphs
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/views/graphs/plot-helpers.ts` computes `asSem` without `asSd` on `"mean-sem"`, uses `Math.abs(m)` for CV, and preserves `errorMinus` in `xyDrawn`)
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

### Issue 34 [FIXED]: `validateAnalysisParams` omits 11 per-analysis enum narrowings from `analysis-params-schema.json`, allowing cross-family params that silently run the wrong statistical test or crash R
- **Severity**: High
- **Status**: Fixed at `d4b45130` (100% key parity between `ENUM_OVERRIDES` in `scripts/generate-analysis-params-schema.py:102-151` and `PARAM_CHOICES` in `src/lib/project-file.ts:986-1050`; runtime enum guards added in `src/stats/simulation/monte-carlo.ts:203-206` and `src/stats/column/mixed-model.ts:94-109`)
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

### Issue 35 [FIXED]: `addFittedCurve` draws all-`NaN` curves (no line rendered) for every multi-Y (`params.ys`) and curve-comparison (`params.compareWith`) nonlinear regression
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`coefficientsForSet` in `src/stats/xy/nonlinear-regression.ts` handles both `${setName} — ` prefixes and ` (${setName})` suffixes)
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

### Issue 36 [FIXED]: Raw-X sigmoidal models (`sigmoidal-4pl-x`, `absolute-ic50-x`, `asymmetric-5pl-x`, `agonist-4pl-normalized-x`) force `Y = Bottom` (or `0`) at `X = 0` in R even when `HillSlope < 0`, corrupting falling-curve fits and disagreeing with TS `evaluate()`
- **Severity**: High
- **Status**: Fixed at `d4b45130` (length-safe R guards `Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)` in `src/stats/xy/nonlinear-fit.ts:425, 891, 1390`, and explicit `x === 0` `EC50 <= 0` guards for all 4 raw-X sigmoidal models in `src/views/graphs/fitted-curve.ts:58-64`; minor adjacent gap on other raw-X ratio models tracked in `#111`)
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

### Issue 38 [FIXED]: Weighted, robust, and Poisson fits on log-Y models (`semilog-y-log`, `log-log-line`, `exponential-growth-log`) compute `R²` by dividing `log(Y)`-scale SS by raw `Y`-scale SST, and Poisson IRLS uses `1/log(Y)` weights
- **Severity**: High
- **Status**: Fixed at `8c877d8` (`src/stats/xy/nonlinear-fit.ts:2780-2786, 3036-3037, 3073-3076, 3108-3113` and `src/stats/xy/nonlinear-regression.ts:1453, 2262-2266`)
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

### Issue 39 [FIXED]: `ecAnything` crashes R (`subscript out of bounds`) when `params.ecx` is requested on competition models, and `runGlobalNonlinear` mislabels shared `IC50`/`IC50Hi`/`LogKd` midpoints as `"EC50"`
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:283` fixes `homologous-competition-logx` `ecAnything` to `log10(f/(100-f))` alongside `#85`)
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

### Issue 40 [FIXED]: `user-defined.ts` accepts R reserved keywords (`NA`, `Inf`, `NULL`, `TRUE`, `for`, `in`, …) causing R syntax errors, and naming a parameter `HillSlope` causes the fitted curve overlay to render nothing (all `NaN`)
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/stats/xy/user-defined.ts` rejects R `?Reserved` identifiers; `src/stats/xy/nonlinear-regression.ts` `labelFor` preserves raw parameter names for `user-defined`)
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

### Issue 41 [FIXED]: Multiple Linear Regression (`multiple-regression.ts`) miscomputes VIFs, crashes with R syntax error when only categorical predictors are present, and passes raw unaligned columns to `describe()`
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/stats/multiple/multiple-regression.ts` computes `vifAssigns`/`vif` over `design` and calls `describe(alignedGroups(...))`)
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

### Issue 42 [FIXED]: Three-way ANOVA Games–Howell post-hoc crashes R (`object 'Infinity' not found`) when compared cells have zero variance (identical replicates)
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`src/stats/grouped/three-way-anova.ts:137` now checks `identical(vi) || identical(vj)`)
- **Files**:
  - `src/stats/grouped/three-way-anova.ts:137-154, 196-225`
- **Explanation**:
  In `src/stats/grouped/three-way-anova.ts:137`, the Games–Howell branch checks `if (vi.length < 2 || vj.length < 2)` without checking `identical(vi) || identical(vj)` (unlike `two-way-anova.ts:290`). When two compared cells each have identical replicates (e.g. `[10, 10]` and `[12, 12]`), `va === 0 && vb === 0`, `t` is `Infinity` (or `NaN`), and `df` is `NaN`. Line 201 interpolates JS `"Infinity"` directly into R (`ptk(Infinity*sqrt(2), ...)`), crashing R with `object 'Infinity' not found`.
- **Minimal Reproduction**:
  Run `three-way-anova` with `posthoc: "games-howell", posthocTerm: "A:B:C"` on a Grouped table with row groups where two cells have `[10, 10]` and `[12, 12]`.
- **Suggested Fix**:
  Check `if (vi.length < 2 || vj.length < 2 || identical(vi) || identical(vj))` at `src/stats/grouped/three-way-anova.ts:137`.

---

### Issue 43 [FIXED]: Sample Size & Power `solveEffect` fails for all valid effects in the upper doubling band (e.g. Pearson `r ∈ (0.8, 1)`, one-proportion `h ∈ (1.6, π]`, t/ANOVA/χ² `∈ (6.4, 10]`), and `power <= alpha` returns bogus `effect ≈ 0`
- **Severity**: High
- **Status**: Fixed at `b8a2528` (`src/stats/sample-size-power.ts:258-265, 436-453` rejects `power <= alpha` and clamps `hi = cap`)
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

### Issue 44 [FIXED]: Missing `core:window:allow-hide` and `core:window:allow-set-focus` capabilities silently break BUG-12 close-quiesce mitigation and non-macOS Window menu switcher
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src-tauri/capabilities/default.json:11-12` grants `core:window:allow-hide` and `core:window:allow-set-focus`)
- **Files**:
  - `src-tauri/capabilities/default.json:5-12`
  - `src/native.ts:615-620, 1090-1096`
- **Explanation**:
  In Tauri 2, `core:default` omits `core:window:allow-hide` and `core:window:allow-set-focus`. Consequently, `win().hide()` inside `quiesceBeforeClose()` (`src/native.ts:616-620`) silently rejects with a Tauri ACL error (leaving closing windows visible white for 250 ms with their macOS display link still attached), and clicking a background window in the Linux/Windows **Window** menu (`w?.setFocus()` at `src/native.ts:1095`) silently fails to focus it.
- **Suggested Fix**:
  Add `"core:window:allow-hide"` and `"core:window:allow-set-focus"` to `"permissions"` in `src-tauri/capabilities/default.json`.

---

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

### Issue 48 [FIXED]: Export tools fail with `"Titer can't access <path>"` whenever the output filename contains a dot (e.g. `Fig 1.2`) or on Windows paths with a dot in a parent directory
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:10181-10197` and `src/native.ts:129-151` split on `/` and `\` and check recognized export extensions)
- **Files**:
  - `src-tauri/src/mcp.rs:9340` (`ensure_export_extension`)
  - `src/native.ts:131-135` (`ensureSaveExtension`)
  - `src-tauri/src/main.rs:600-645` (`check_extension` in `write_file`)
- **Explanation**:
  Both `ensure_export_extension` and `ensureSaveExtension` check whether the basename contains *any* dot rather than ending in the target extension, and split only on `'/'`. Paths without an extension such as `"/tmp/Fig 1.2"` or Windows paths like `C:\Users\alice.smith\Desktop\plot` do not receive `.png`/`.pdf`, causing `write_file`'s `check_extension` to reject them with `"Titer can't access <path>"`.
- **Suggested Fix**:
  Split on both `'/'` and `'\\'` (or `std::path::Path`) and append `.{ext}` unless the filename already ends with a recognized extension for that format.

---

### Issue 49 [FIXED]: `analysis-params-schema.json` omits `"none"` from `posthoc` enum for `nested-anova`/`multifactor-anova`, marks defaulted params required for `two-way-anova`/`rm-anova`, and duplicates `"xy"` in `nonlinear-regression.offered_on`
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`two-way-anova.design` now has `default: "ordinary", required: false` in `scripts/generate-analysis-params-schema.py:495` and `src-tauri/src/analysis-params-schema.json:3412-3413`)
- **Files**:
  - `scripts/generate-analysis-params-schema.py:124-125, 494-505`
  - `src-tauri/src/analysis-params-schema.json:1385-1390, 1524-1529, 1563-1567, 2663-2674, 3260-3296`
- **Explanation**:
  `ENUM_OVERRIDES` omits `"none"` for `nested-anova` and `multifactor-anova` `posthoc` (emitting `"enum": ["tukey", "bonferroni"]` alongside `"default": "none"`); `rm-anova.params.posthoc` and `two-way-anova.params.{design,posthoc,posthocTarget}` are marked `"required": true` with no `"default"` despite having runtime defaults; and `nonlinear-regression.offered_on` contains duplicate `"xy"` (`["multiple", "xy", "xy"]`) due to expanding `"interpolate"`.
- **Suggested Fix**:
  Add `"none"` to both `ENUM_OVERRIDES` `posthoc` lists, populate `DEFAULTS` for `rm-anova` and `two-way-anova`, and deduplicate `OFFERED[concrete]`.

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

### Issue 51 [FIXED]: Replicate XY tables break `deming-overlay.ts` & `binding-curve.ts` overlays; `addLogisticCurve` queries three nonexistent stat labels (always displaying `—`)
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src/views/graphs/deming-overlay.ts` and `src/views/graphs/binding-curve.ts` pool replicate datasets via `splitXY`; `src/views/graphs/fitted-curve.ts` `addLogisticCurve` matches `logistic-regression.ts` stat labels)
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

### Issue 53 [FIXED]: `permuteColumns`, `dropColumns`, and `removeCalculatedVariable` corrupt or leak `cellBackgrounds`, `linkedPaste`, `calculated`, `decimals`, `variableTypes`, `labelVariable`, and `levelOrder`
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src/views/tables/table-data.ts:418-475` and `src/lib/calcvars.ts:1219-1249` remap `cellBackgrounds`/`linkedPaste`, prune column metadata, and keep the last data column)
- **Files**:
  - `src/views/tables/table-data.ts:417-464` (`permuteColumns`, `dropColumns`)
  - `src/lib/calcvars.ts:1188-1201` (`removeCalculatedVariable`)
- **Explanation**:
  `permuteColumns` omits remapping `cellBackgrounds` (stranding cell colors on wrong columns). `dropColumns` omits remapping `cellBackgrounds` and pruning `decimals`, `variableTypes`, `labelVariable`, and `levelOrder`. `removeCalculatedVariable` leaves `calculated: []` instead of `undefined` when empty (triggering `updated: true` on reload), fails to shift/drop `linkedPaste`, fails to prune MV column metadata, and does not guard against deleting the last data column.
- **Suggested Fix**:
  Remap `cellBackgrounds` in `permuteColumns` and `dropColumns`, prune column metadata in `dropColumns` and `removeCalculatedVariable`, set `calculated: undefined` when empty, and update `linkedPaste` via `linkedPasteAfterDelete` in `removeCalculatedVariable`.

---

### Issue 54 [FIXED]: Copying cells in Titer and pasting via Paste Special (default options) inserts a spurious column-header row
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/views/tables/table-data.ts:1421-1438` `safeCodePoint` guards `<= 0x10ffff` and UTF-16 surrogates `0xd800..0xdfff`)
- **Files**:
  - `src/views/tables/grid.tsx:506-515, 769-781`
  - `src/views/tables/table-data.ts:1271-1292, 1384-1413`
- **Explanation**:
  `onCopy` writes raw cells to `text/plain` and an HTML `<table>` with a prepended `<thead><tr><th>…</th></tr></thead>` column-header row to `text/html` (`toHTMLTable`). Under default options, Paste Special prefers `text/html` via `parseClipboardHTML`, which parses every `<tr>` (`<th>` and `<td>`) and inserts the column headers as row 0 of the pasted data. (Also `decodeHtmlEntities` lacks a `<= 0x10ffff` guard on `String.fromCodePoint`.)
- **Suggested Fix**:
  Skip `<thead>` (or Titer's marked header row) inside `parseClipboardHTML`, and guard `String.fromCodePoint` in `decodeHtmlEntities`.

---

### Issue 55 [FIXED]: `.pzfx` XML parser scrambles mixed-content `<Title>`/`<d>` tags (`H<Sub>2</Sub>O` → `"HO2"`), drops `<Font>`-wrapped `<Info>` text, double-decodes CDATA, and matches closing-tag prefixes
- **Severity**: Medium
- **Status**: Fixed at `b8a2528` (`src/lib/pzfx.ts:93, 107, 174-239, 264-267, 759-775`)
- **Files**:
  - `src/lib/pzfx.ts:82-99, 167-189, 206-210, 719-729`
- **Explanation**:
  `XmlNode` merges all direct text segments separately from `children`, so `rawChildText` puts all top-level text before inline tags (`<Title>H<Sub>2</Sub>O</Title>` → `"HO2"`). `<Info>` parsing reads `?.text` directly instead of `rawChildText` (dropping `<Font>`-wrapped titles/notes/constants). CDATA sections are entity-decoded on close, closing-tag matching lacks a `>`/whitespace check (`</dExtra>` closes `<d>`), and `decodeEntities` lacks a `<= 0x10ffff` check.
- **Suggested Fix**:
  Preserve ordered text/element child parts in `XmlNode`, decode entities only on non-CDATA text, use `rawChildText` for `<Info>`, and validate closing tags and code points.

---

### Issue 56 [FIXED]: Scientific-notation comma-decimal numbers (e.g. `"4,096e+007"`, `"1,5e-3"`) are not normalized in `.pzfx` or `.prism` import and are silently dropped as non-numeric text
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (leading `+` accepted in `src/views/tables/table-data.ts:1293`, `src/lib/pzfx.ts:320,323,326,368`, `src/lib/prism.ts:653,655,796`, and `src/lib/import-choices.ts:212,215`; `src/lib/prism.ts:653,796` `thousandsMode` accepts scientific exponents)
- **Files**:
  - `src/lib/pzfx.ts:285, 329-334`
  - `src/lib/prism.ts:648-654`
  - `src/lib/numeric.ts:10-18`
- **Explanation**:
  `COMMA_DECIMAL_EVIDENCE` detects comma-decimal scientific notation (`"4,096e+007"`), yet `normalizeNumber` in both `pzfx.ts:332` and `prism.ts:651, 653` only matches `/^-?\d+,\d+$/` (no exponent group). Values like `"4,096e+007"` keep their comma and are dropped as non-numeric `null` by `parseCell`.
- **Suggested Fix**:
  Support the optional exponent `([eE][+-]?\d+)?` (and optional leading `+`) in `normalizeNumber` in both `pzfx.ts` and `prism.ts`.

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

### Issue 58 [FIXED]: `applyRegenDecisions` mutates the project before validating later decisions (creating duplicate graphs on retry), and `mapSidecarGraph` ignores summary formats on grouped `.prism` tables
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src/lib/prism-graph-regen.ts` validates all decisions in a first pass and calls `errorFor(resolved)` in `case "grouped"`)
- **Files**:
  - `src/lib/prism-graph-regen.ts:206-212, 365, 596-597, 625-700`
- **Explanation**:
  `applyRegenDecisions` executes `deps.createGraph(...)` and `deps.renameNode(...)` inside the same loop that validates later decisions, so an invalid decision at index 1 throws after mutating the project for index 0 (and retries create duplicates). Also `mapSidecarGraph`'s `case "grouped"` bypasses `errorFor(resolved)` and always defaults to `"sem"`, ignoring `y_sd_n`, `y_cv_n`, `y_single`, and `y_plus_minus`.
- **Suggested Fix**:
  Validate all decisions in a first pass before executing any mutations, and call `errorFor(resolved)` for `case "grouped"` in `mapSidecarGraph`.

---

### Issue 59 [FIXED]: `mergeGraphTables` skips the `summaryFormat` mismatch check for XY tables and silently drops extra Nested tables whose name contains `:`
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src/lib/multi-table.ts` checks `summaryFormatOf` for XY tables; `src/lib/dataset.ts` parses trailing two `:` segments in `nestedGroupsOf`)
- **Files**:
  - `src/lib/multi-table.ts:168-194, 218-234, 357-370`
  - `src/lib/dataset.ts:230-244`
- **Explanation**:
  `mergeGraphTables` only compares `summaryFormatOf` inside `if (!hasXColumn(primary.tableType))`, allowing mixed `mean-sd-n` and `replicates` XY tables to merge and plot subcolumns with the wrong semantics. For Nested tables, `paddedColumn` prefixes `${tableName} — ${col.name}`; if an extra table's name contains `:`, `split(":")` yields 4 parts and `nestedGroupsOf` (`dataset.ts:233-234`) silently drops the entire extra table.
- **Suggested Fix**:
  Check `summaryFormatOf` for `xy` tables too, and sanitize `:` in `tableName` inside `paddedColumn` (or parse from the trailing two `:` segments in `nestedGroupsOf`).

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

### Issue 61 [FIXED]: `report/conclusion.ts`, `report/checks.ts`, and `report/analyzed.ts` produce inverted/misleading conclusions and assumption checks
- **Severity**: Medium
- **Status**: Fixed at `8c877d8` (`src/stats/report/conclusion.ts:194, 234-235, 289-306, 374-380, 516-521`, `src/stats/report/checks.ts:213-229, 242-247`, `src/stats/report/analyzed.ts:36-45, 168-180`)
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

### Issue 62 [FIXED]: `AICc` in `enzyme-inhibition.ts` (and `nonlinear-regression.ts`) omits the residual-variance parameter (`+ 1`) from `k`; `interpolationCode` drops 95% CIs on tight positive-X ranges; multi-Y centered polynomials share only the first set's `centeredX`
- **Severity**: Medium
- **Status**: Fixed at `8c877d8` (`src/stats/xy/enzyme-inhibition.ts:149`, `src/stats/xy/nonlinear-regression.ts:1329, 1453, 2929-2932, 3032-3034, 3161`, `src/views/graphs/fitted-curve.ts:346-350, 435, 479, 497`)
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

### Issue 63 [PARTIALLY FIXED]: `noncentralTCdf` underflows to `0` at `|δ| ≥ 38.57`, causing t-test power to jump discontinuously to `100%` and `solveN` to underestimate `n` at small `df` / strict `α`
- **Severity**: Medium
- **Status**: Partially Fixed at `d4b45130` (`src/stats/distributions.ts:335-345` fixes `mu > 700` via mode-centered twin series)
- **Remaining at `d4b45130`**: `mu <= 700` (`|δ| <= 37.42`) still hits `rxb = Math.pow(1 - x, b)` underflow at large `df` (`src/stats/distributions.ts:355`, e.g. `noncentralTCdf(39, 1e5, 37.4) -> 1.0` vs true `0.9445`); see also `#80` and new Issue `#107`.
- **Files**:
  - `src/stats/distributions.ts:306-361`
  - `src/stats/sample-size-power.ts:291-306`
- **Explanation**:
  In `noncentralTCdf` (`src/stats/distributions.ts:330`), `0.5 * Math.exp(-0.5 * lambda)` underflows to `0` when `|delta| >= 38.57`, causing `tPower` to jump discontinuously to `1.0` whenever `tc > delta` (e.g. `df = 1, alpha = 0.01`, where `tc = 63.66`) and causing `solveN` to stop prematurely at `minN = 2`.
- **Suggested Fix**:
  Evaluate Poisson weights in log-space centered at the mode `floor(lambda / 2)` (matching `poissonMixtureWeights` in `distributions.ts:367-389`).

---

### Issue 64 [FIXED]: Plugin wizard `kind: "text"` questions reject all non-numeric text, and `MarketplaceDialog` pre-checks `"network"` (and all permissions) by default
- **Severity**: Medium
- **Status**: Fixed at `8c877d8` (`src/plugins/analysis-spec.ts:441-456`, `src/components/marketplace-dialog.tsx:75-87`)
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

### Issue 65 [FIXED]: UI/menu minor defects (duplicate Grubbs' table, duplicate `Fill Down`, shortcut collision, stale `Change Parameters…`)
- **Severity**: Low
- **Status**: Fixed at `c54f5954` (`src/views/analyses/analysis-results-view.tsx:748-768` and `src/app-menu.ts:503, 761, 804, 898-900` fix all 4 UI/menu items)
- **Files**:
  - `src/views/analyses/analysis-results-view.tsx:748-786`
  - `src/app-menu.ts:471, 497, 753, 796, 871-904`
- **Explanation**:
  1. `analysis-results-view.tsx:748-786` renders the `"Outliers by column"` Grubbs' `<Table>` block twice identically.
  2. `app-menu.ts` lists `Edit ▸ Fill Down` twice (line 471 lacks `!activeTableFrozen`), binds `CmdOrCtrl+Alt+I` to both `New Info Sheet…` (line 753) and `Show/Hide Inspector` (line 796), and omits `activeNodeId`/`activeNode?.analysisType` from `useAppMenu`'s dependency array so **Change Parameters…** enabled state goes stale.
- **Suggested Fix**:
  Remove the duplicate Grubbs' block and duplicate `Fill Down` entry, give `New Info Sheet…` a distinct accelerator, and include `isEditableAnalysis(activeNode)` in `useAppMenu`'s dependencies.

---

### Issue 66 [FIXED]: WebR / survival edge cases (`ensurePackages` doubled timeout on claim timeout; `survival-analysis.ts` 2-group HR on `k ≥ 3` and silent `—` on disjoint risk sets)
- **Severity**: Low
- **Status**: Fixed at `8c877d8` (`src/stats/webr.ts:1040-1042, 1092-1111`, `src/stats/survival/survival-analysis.ts:78-86, 105-110, 153-156`; new WebR P-12 concurrency issues tracked in `#89`, `#90`, `#96`)
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

### Issue 67 [FIXED]: [Carryover from Round 1 #28] Pasting wide data into a Nested table silently drops overflow columns without showing the `"Some Values Weren't Pasted"` notice
- **Severity**: Low
- **Status**: Fixed at `b8a2528` (`src/views/tables/table-data.ts:162-165` now checks `isGrouped(data) || isNested(data)`)
- **Files**:
  - `src/views/tables/table-data.ts:161-164` (`columnsBeyond`)
  - `src/views/tables/table-data.ts:123` (`writeBlock`)
- **Explanation**:
  `writeBlock` refuses to auto-append columns when `isGrouped(data) || isNested(data)`, but `columnsBeyond` (`src/views/tables/table-data.ts:163`) still checks only `isGrouped(data)` and returns `0` for Nested tables, silently discarding overflow pasted columns without triggering the warning dialog.
- **Suggested Fix**:
  Update `columnsBeyond` to check `(isGrouped(data) || isNested(data))` and update the warning text to mention Nested tables.

---

## New Issues Found in Recheck at `b8a2528` (#68–#81)

### Issue 68 [FIXED]: `copy_pdf_to_clipboard` puts TWO separate `NSPasteboardItem`s on the macOS clipboard instead of one multi-flavour item
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src-tauri/src/main.rs:1081-1094` writes a single multi-flavour `NSPasteboardItem` carrying `com.adobe.pdf`, `public.pdf`, and `public.png`)
- **Files**:
  - `src-tauri/src/main.rs:1039-1044` (`copy_pdf_to_clipboard_blocking`)
- **Explanation**:
  In AppKit (`NSPasteboard`), each `NSPasteboardItem` in `pb.writeObjects([...])` represents a distinct copied object, whereas alternative representations of one object (PDF primary + PNG fallback) must be attached to the **same** `NSPasteboardItem`. Lines 1039–1044 create `pdfItem` (`com.adobe.pdf`, `public.pdf`) and a separate `pngItem` (`public.png`) and call `pb.writeObjects($([pdfItem, pngItem]))`. Live verification against AppKit shows `pb.pasteboardItems.count === 2` and `pb.readObjectsForClasses([NSImage])` returns 2 images — so multi-item apps (Keynote, Pages, Notes, Mail, TextEdit, Word) paste **two copies** of the graph (one PDF + one PNG), while single-item readers inspecting `pasteboardItems[0]` find no `public.png` fallback.
- **Minimal Reproduction**:
  Copy any graph/figure on macOS via the Copy button (`copy_pdf_to_clipboard`) and paste into Notes, Pages, or Keynote: two images are pasted side by side.
- **Suggested Fix**:
  Attach all three UTIs (`com.adobe.pdf`, `public.pdf`, and `public.png`) to a single `NSPasteboardItem` and pass `$([item])` to `pb.writeObjects(...)`.

---

### Issue 69 [FIXED]: `WhatsNewDialog` auto-closes itself 2 seconds after opening via **Help ▸ What's New**
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/components/whats-new-dialog.tsx:34, 38-41, 57-63` tracks `autoOpened` so manual Help ▸ What's New skips the 2s auto-close timer)
- **Files**:
  - `src/components/whats-new-dialog.tsx:16-35`
  - `src/lib/whats-new.ts:51-53, 68-74`
- **Explanation**:
  `WhatsNewDialog` shares a single `open` boolean between first-launch auto-show (lines 21–25) and manual on-demand opening via **Help ▸ What's New** (`line 18`: `onWhatsNewRequest(() => setOpen(true))`). While `open` is `true`, lines 29–35 run a 2-second `setInterval` intended to close auto-opened dialogs in other windows whenever `shouldShowWhatsNew(readWhatsNewSeen())` becomes `false`. Once the user has dismissed the initial auto-shown dialog (`markWhatsNewSeen()` writes `localStorage["titer.whats-new-seen"]`), `shouldShowWhatsNew(...)` is always `false`, so every subsequent manual **Help ▸ What's New** open closes itself after 2 seconds.
- **Minimal Reproduction**:
  1. Launch Titer and click **OK** on the auto-shown **What's New** dialog.
  2. Click **Help ▸ What's New** and wait 2 seconds: the dialog disappears automatically.
- **Suggested Fix**:
  Track whether the current open session was auto-shown (`autoShown`), and only run the 2-second re-check interval while `open && autoShown`.

---

### Issue 70 [FIXED]: Independent error-report sharing (`CrashReportDialog` / `try_send_error_entry`) never sends when feedback sharing is off
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:1647-1669` gates `try_send_error_entry` solely on `error_log_sharing_enabled` and posts directly; `src/components/ai-connections-dialog.tsx:174-195, 571-578` adds "Send unsent reports")
- **Files**:
  - `src-tauri/src/mcp.rs:1558-1574, 2510-2525` (`try_send_error_entry`, `feedback_share_result`)
  - `src/components/crash-report-dialog.tsx:79-93, 150-155`
  - `src/components/ai-connections-dialog.tsx:191-194, 511-540`
  - `src/components/feedback-consent-dialog.tsx:21-24, 65-69, 85-87`
- **Explanation**:
  Error-report sharing (`error-log-consent.json`) is advertised as independent from AI feedback sharing (`feedback-consent.json`). However, `try_send_error_entry` (`src-tauri/src/mcp.rs:1558-1574`) checks `error_log_sharing_enabled(dir)` and then delegates to `feedback_share_result(...)`, which immediately aborts unless `feedback_sharing_enabled(dir)` is also `true`. When feedback sharing is off, clicking **Send reports** → **Turn on sharing & send** in `CrashReportDialog` returns `{ flushed: N, sent: 0, sharing: "enabled" }` without making any HTTP request and tells the user they can send them from **Settings → AI Connections**, which has no flush button.
- **Minimal Reproduction**:
  Leave feedback sharing off, have an unsent entry in `<app_data>/mcp/error-log.jsonl`, launch Titer, and click **Send reports** → **Turn on sharing & send** in `CrashReportDialog`: `mcp_flush_error_log` returns `sent: 0` with no HTTP POST attempted.
- **Suggested Fix**:
  In `try_send_error_entry` (`src-tauri/src/mcp.rs:1572`), call `post_feedback_entry(&feedback_server_url(), &error_entry).await.is_ok()` directly instead of `feedback_share_result`, and add a "Send unsent reports" control in `AiConnectionsDialog` (or update the fallback copy in `crash-report-dialog.tsx:153`).

---

### Issue 71 [FIXED]: `StartupGuideDialog`'s `mailto:smit@muse.ai` support link is silently blocked by Tauri's `.on_navigation` policy
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/components/startup-guide-dialog.tsx:108-129` routes native `mailto:` clicks through `openSupportEmail()`; minor keyboard note: `startup-guide-dialog.tsx:54, 67` still checks only `HTMLButtonElement`/`"button"`, skipping the focused `<a>` on `Enter`/`Tab`)
- **Files**:
  - `src/components/startup-guide-dialog.tsx:99-105`
  - `src/lib/startup-guide.ts:63-67`
  - `src-tauri/src/main.rs:145-148, 1665-1674`
- **Explanation**:
  On Step 6 ("Where to get help"), `StartupGuideDialog` renders `<a className="underline" href="mailto:smit@muse.ai">`. Every project window created in `src-tauri/src/main.rs:145-147` installs `.on_navigation(|url| url.scheme() == "tauri" || (cfg!(debug_assertions) && url.host_str() == Some("localhost")))`, so clicking `mailto:smit@muse.ai` is silently rejected in both debug and release builds instead of invoking the mail client (unlike **Help ▸ Contact Support**, which calls `openSupportEmail()`).
- **Minimal Reproduction**:
  Open **Help ▸ Startup Guide…**, advance to Step 6, and click `smit@muse.ai`: nothing happens.
- **Suggested Fix**:
  Intercept `mailto:` clicks when `isNative` (`e.preventDefault(); void openSupportEmail();`) or render a button backed by `openSupportEmail()` from `src/native.ts`.

---

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

### Issue 74 [FIXED]: macOS native `NSProgressIndicator` spinner overlaps the `Running…` text and `Cancel` button in `AnalysisView`
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/views/analyses/analysis-view.tsx:45-70` anchors `ref` on a dedicated `h-9 w-9` spacer above text and Cancel)
- **Files**:
  - `src/views/analyses/analysis-view.tsx:34-66` (`Running`)
  - `src-tauri/src/main.rs:1597-1629` (`set_spinner`)
- **Explanation**:
  `Running()` renders `<p>Running… …</p>` and `<Button>Cancel</Button>` inside `<div ref={ref} className="flex h-full flex-col items-center justify-center gap-3">` (~60 px tall). `setSpinner([left + width / 2, top + height / 2])` places macOS's 32×32 pt native `NSProgressIndicator` subview at the exact center of `ref` on top of the WKWebView, directly overlapping the `Running…` text and the top of the `Cancel` button.
- **Minimal Reproduction**:
  On macOS native, run an analysis taking >500 ms (e.g., `mixed-effects` or `monte-carlo`): at 500 ms the native spinning wheel renders over the centered text and `Cancel` button.
- **Suggested Fix**:
  Place a dedicated empty `<div ref={ref} className="h-9 w-9" aria-hidden="true" />` above the `<p>` and `<Button>Cancel</Button>` when `isNative` so `setSpinner` centers cleanly above them.

---

### Issue 75 [FIXED]: `copy_pdf_to_clipboard` JXA `if (!pdfData)` / `if (!pngData)` checks are dead code, wiping the user's clipboard on read failure
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src-tauri/src/main.rs:1084-1088` checks `pdfData.isNil()` / `pngData.isNil()` before `pb.clearContents`)
- **Files**:
  - `src-tauri/src/main.rs:1033-1038` (`copy_pdf_to_clipboard_blocking`)
- **Explanation**:
  In JXA (`osascript -l JavaScript`), an Objective-C `nil` return from `$.NSData.dataWithContentsOfFile(...)` is wrapped as a truthy function proxy (`!missing === false`, `missing.isNil() === true`). Consequently, `if (!pdfData)` and `if (!pngData)` never trigger on read failure; execution continues through `pb.clearContents;` — erasing the user's clipboard — before throwing inside `setDataForType`.
- **Minimal Reproduction**:
  Invoke `copy_pdf_to_clipboard_blocking` with a nonexistent/unreadable path while text or an image is on the clipboard: the clipboard is cleared before the script errors.
- **Suggested Fix**:
  Replace `if (!pdfData)` / `if (!pngData)` with `if (pdfData.isNil())` / `if (pngData.isNil())`.

---

### Issue 76 [FIXED]: `SendFeedbackDialog` and `AiConnectionsDialog` drop server/network errors and falsely claim "Sharing is off", and `mcp_send_feedback` sends `project_file` + `recent_activity` despite promising "Only the text below is ever shared"
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:1841-1853` `new_ui_feedback_entry` omits `project_file`/`recent_activity`; `src/components/send-feedback-dialog.tsx:72, 101-108` and `src/components/ai-connections-dialog.tsx:160-167` surface `out.error` vs `sharing === "disabled"` accurately)
- **Files**:
  - `src-tauri/src/mcp.rs:1738-1756, 1766-1780, 2510-2540`
  - `src/components/send-feedback-dialog.tsx:62-98`
  - `src/components/ai-connections-dialog.tsx:156-164, 493-508`
- **Explanation**:
  1. When feedback sharing is ON and `post_feedback_entry` fails (offline, timeout, HTTP 429/5xx), `feedback_share_result` returns `{ sent: false, sharing: "enabled", error: "..." }` with no `note` field. Both `SendFeedbackDialog` (lines 63–64, 93–97) and `AiConnectionsDialog` (line 160) ignore `out.error` and `out.sharing` and display `"Sharing is off, so nothing left the machine..."` / `"Sharing is off, so the report stays on this Mac."` (and `AiConnectionsDialog` line 506–507 claims `"Send to the Titer team"` works when sharing is off even though `mcp_send_saved_feedback` refuses when sharing is off).
  2. `SendFeedbackDialog` (line 79) promises `"Only the text below is ever shared — no project data, no file contents, no personal information."`, yet `mcp_send_feedback` (`src-tauri/src/mcp.rs:1742-1745`) attaches `context["project_file"]` (open `.hlx` filename) and `context["recent_activity"]` (MCP tool names + timestamps).
- **Minimal Reproduction**:
  Enable Feedback sharing, disconnect from the network, and submit via **Help ▸ Send Feedback** (or click **Send to the Titer team** in **Settings → AI Connections**): both claim sharing is off instead of showing the delivery error.
- **Suggested Fix**:
  Inspect `out.sharing` and `out.error` in both dialogs so network/server errors display `out.error`; either omit `project_file`/`recent_activity` from UI-submitted feedback or disclose them accurately in `SendFeedbackDialog`.

---

### Issue 77 [FIXED]: `StartupGuideDialog`'s global `window` keydown handler hijacks `Enter` and `Escape` from top-layer `<dialog>` modals (including `SendFeedbackDialog`)
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/components/startup-guide-dialog.tsx:50-53` ignores events when `dialog[open]`, input/textarea, or outside `panelRef.current`)
- **Files**:
  - `src/components/startup-guide-dialog.tsx:42-72, 106-110`
  - `src/components/send-feedback-dialog.tsx:30-32, 117-124`
  - `src/components/app-shell.tsx:414-426`
- **Explanation**:
  When `StartupGuideDialog` is open, its global `window` `keydown` listener (`src/components/startup-guide-dialog.tsx:42-72`) intercepts `Escape` unconditionally and `Enter` whenever `!(e.target instanceof HTMLButtonElement)` — without checking if a top-layer `<dialog>` is open or if `e.target` is inside `panelRef.current`. Opening `SendFeedbackDialog` from Step 6's `SendFeedbackButton` and pressing `Enter` inside the Details `<textarea>` calls `e.preventDefault()` (swallowing the newline) and closes `StartupGuideDialog` underneath; pressing `Escape` on overlapping first-launch modals (`WhatsNewDialog` / `FeedbackConsentDialog`) dismisses and marks the unseen guide seen.
- **Minimal Reproduction**:
  Open **Help ▸ Startup Guide…**, advance to Step 6, click **Send Feedback**, focus Details, type text, and press **Enter**: no newline is inserted and the guide behind closes.
- **Suggested Fix**:
  Ignore events in `StartupGuideDialog`'s `onKeyDown` whenever `document.querySelector("dialog[open]")` exists or when `e.target` is an `HTMLInputElement`/`HTMLTextAreaElement`/outside `panelRef.current`; defer auto-showing the guide while top-layer onboarding dialogs are open.

---

### Issue 78 [FIXED]: Windowless Help menu exposes **Help ▸ Send Feedback** and **Help ▸ What's New** as enabled dead no-ops
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/menus.ts:125, 172, 177` and `src/engine.ts:41` pass `hasProjectWindow = false` to disable Send Feedback and What's New when windowless)
- **Files**:
  - `src/menus.ts:119, 166, 171`
  - `src/engine.ts:28-40`
  - `src/lib/feedback-ui.ts:23-25, 36-38`
  - `engine.html:1-10`
- **Explanation**:
  When all project windows are closed on macOS, the hidden `engine` webview installs `setMenuBar(...)` (`src/engine.ts:39`). Unlike **Startup Guide…** (passed via `extraHelpItems` so the windowless menu omits it), **Send Feedback** (`src/menus.ts:166`) and **What's New** (`src/menus.ts:171`) are unconditionally enabled in `setMenuBar`. Clicking either with no project window open dispatches a DOM `CustomEvent` on the hidden `engine` window, which has no React tree or listeners, so nothing happens.
- **Minimal Reproduction**:
  Close all project windows on macOS (`⌘W`) and click **Help ▸ Send Feedback** or **Help ▸ What's New**: both are enabled and do nothing.
- **Suggested Fix**:
  Move **Send Feedback** and **What's New** into `extraHelpItems` (or disable them when no project window is open), or have the windowless menu open a project window first and trigger the dialog via Tauri event.

---

### Issue 79 [FIXED]: `StartupGuideDialog` auto-show omits `!openedFile.current` and pops over opened `.pzt` templates, Sample Project, and slow/failed file launches
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/store/use-document.ts:2743-2767` checks `!openedFile.current` and defers while `dialog[open]` is present)
- **Files**:
  - `src/store/use-document.ts:1710-1763, 2714-2726`
- **Explanation**:
  Unlike `WelcomeDialog` (which checks `!openedFile.current` at `src/store/use-document.ts:2696`), `StartupGuideDialog`'s auto-show (`use-document.ts:2721`) checks only `firstWindow && shouldShowGuide(readGuideSeen()) && !s.filePath && !s.isDirty`. Launching Titer by opening a `.pzt` template or Sample Project (`untitled: true` leaves `filePath === null`), or opening a file that takes >900 ms or fails to open, causes `StartupGuideDialog` to pop up over the opened file/error state.
- **Minimal Reproduction**:
  Clear `localStorage["titer.startup-guide-seen"]` (with Welcome already dismissed/disabled) and launch Titer by double-clicking a `.pzt` template file: 900 ms later, `StartupGuideDialog` opens over the template.
- **Suggested Fix**:
  Add `!openedFile.current` to the guard at `src/store/use-document.ts:2721`.

---

### Issue 80 [PARTIALLY FIXED]: `noncentralTCdf` (`logWeights` path) silently returns `1.0` when `rxb` underflows at large `df` and still cliffs to `0` past `|δ| > 447`
- **Severity**: Medium
- **Status**: Partially Fixed at `d4b45130` (`noncentralTTwinSeriesModeCentered` at `src/stats/distributions.ts:335-345` fixes `mu > 700` at moderate `df` and `|δ| <= 1e5`)
- **Remaining at `d4b45130`**: `mu <= 700` (`|δ| <= 37.42`) still hits `rxb = Math.pow(1 - x, b)` underflow at large `df` (`src/stats/distributions.ts:355`, e.g. `noncentralTCdf(39, 1e5, 37.4) -> 1.0` vs true `0.9445`); extreme `|t| >= 1.34e154` and `|δ| >= 1e6` / large `df + δ` tracked as new Issue `#107`.
- **Files**:
  - `src/stats/distributions.ts:316-389` (`noncentralTCdf`)
- **Explanation**:
  In `noncentralTCdf`'s new `logWeights` branch (`mu > 700`), line 357 computes `rxb = Math.pow(1 - x, b)`. Whenever `(df / 2) * ln(1 + t^2 / df) > 745` (e.g., `|t| >= 50` at `df >= 1500`), `rxb` underflows to `0.0`, zeroing `godd`/`geven` and freezing `xodd = xeven = 1` so the `logP + logQ` sum silently returns **`1.0`** regardless of the true CDF. In addition, starting from `en = 1` with cap `100000` (line 366) instead of centering at the Poisson mode `floor(mu)` causes `noncentralTCdf` to cliff to `0.0` whenever `mu > 100000` (`|δ| > 447.21`).
- **Minimal Reproduction**:
  - `noncentralTCdf(50, 2000, 50)` returns `1.0` (true `≈ 0.500`); `noncentralTCdf(50, 2000, 100)` returns `1.0` (true `≈ 0.0`).
  - `noncentralTCdf(500, 1, 500)` returns `0.0` (true `≈ 0.500`).
- **Suggested Fix**:
  Center the Poisson-mixture sum around the mode `floor(mu)` and compute `godd`/`geven` (or `regularizedIncompleteBeta`) in log-space without underflowing `rxb`.

---

### Issue 81 [FIXED]: `send_to_keynote_blocking` / `applescript_number` lacks `.is_finite()` / upper-bound checks and can emit invalid AppleScript `inf` or `0`
- **Severity**: Low
- **Status**: Fixed at `d4b45130` (`src-tauri/src/main.rs:563-592, 892` adds `check_keynote_image_size` finite `1.0..=1e5` check and clamps `applescript_number`)
- **Files**:
  - `src-tauri/src/main.rs:557-564, 856-859`
- **Explanation**:
  `send_to_keynote_blocking` validates only `!(width_pt > 0.0 && height_pt > 0.0)`. Finite values `>= 1.8e306` overflow `(value * 100.0).round()` in `applescript_number` to `f64::INFINITY` and emit invalid AppleScript `set imgW to inf`, while tiny positive values `< 0.005` round to `0` (`set imgW to 0`).
- **Minimal Reproduction**:
  Invoke `send_to_keynote` with `widthPt: 1e307, heightPt: 100` (or `widthPt: 0.001, heightPt: 100`).
- **Suggested Fix**:
  Require `width_pt.is_finite() && height_pt.is_finite()` within reasonable point bounds (e.g., `1.0..=1e5`) in `send_to_keynote_blocking`.


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

### Issue 83 [FIXED]: `formatLabelForPlotly` double-escapes `&`, `<`, `>`, `\^`, `\_` in `buildGraphFigure` and allows HTML-escaping bypass (XSS) via `<sup>`/`<sub>`
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`isAlreadyFormatted` at `src/lib/label-format.ts:124-152` validates allowlisted tags and entities, closing both double-escaping and the XSS bypass)
- **Files**:
  - `src/lib/label-format.ts:104-126` (`formatLabelForPlotly`)
  - `src/views/graphs/graph-figure.ts:281, 507, 798` (`buildBaseFigure`, `buildGraphFigure`)
- **Explanation**:
  1. **Double-escaping in `buildGraphFigure`**: `buildBaseFigure` calls `formatFigureLabels` (`src/views/graphs/graph-figure.ts:281`), and `buildGraphFigure` calls `formatFigureLabels` a second time (`line 798`) on the already-formatted figure (and trace names at `line 507`). Any `&`, `<`, `>`, escaped caret `\^`, or escaped underscore `\_` becomes double-escaped: `"A & B"` → `"A &amp;amp; B"` and `"WT\\_1"` → `"WT&amp;#95;1"`.
  2. **HTML-escaping bypass (XSS)**: `formatLabelForPlotly` (`src/lib/label-format.ts:107`) returns early with `if (label.includes("<sup>") || label.includes("<sub>")) return label;` before performing any HTML escaping. A crafted label such as `<a href="javascript:alert(1)">x</a><sup>1</sup>` or `<img src=x onerror=...><sub>1</sub>` bypasses all HTML sanitization.
- **Minimal Reproduction**:
  Export or render a figure via `buildGraphFigure` with a series/title named `"A & B"` or `"WT\\_1"` → `"A &amp;amp; B"` / `"WT&amp;#95;1"`. Pass `"<a href='javascript:alert(1)'>x</a><sup>1</sup>"` → returned verbatim without escaping.
- **Suggested Fix**:
  Make `formatLabelForPlotly` idempotent (or call `formatFigureLabels` only once at the final stage), and escape all untrusted HTML before emitting `<sup>`/`<sub>` tags (never short-circuiting escaping when `<sup>`/`<sub>` appears in input).

---

### Issue 84 [FIXED]: `vector-export.ts` `textRuns` splits single-line Plotly `<sup>`/`<sub>` `<text>` into separate lines, breaking `middle`/`end` alignment in PDF/EPS
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`startsNewLine` at `src/lib/vector-export.ts:902-907, 923-932` keeps inline `<sup>`/`<sub>` `<tspan>`s on one logical line)
- **Files**:
  - `src/lib/vector-export.ts:849-908, 1149-1178` (`textRuns`, line positioning in vector backends)
- **Explanation**:
  When Plotly renders `<sup>` or `<sub>` inside an SVG `<text>` element, it emits inline `<tspan>` child nodes that do not carry new `x` or `y` attributes. In `textRuns` (`src/lib/vector-export.ts:849-908`), direct `<tspan>` children without `x`/`y` still increment the `line` counter with `anchored = false`, splitting a single inline line (e.g. centered graph titles, X-axis tick labels, or right-aligned log Y-axis ticks like `10^7`) into separate lines that are individually aligned rather than measured as one combined line width.
- **Minimal Reproduction**:
  Export a graph with a log10 Y axis (`10^−3`..`10^7`) or centered title containing `R^2` / `H_2O` to vector **PDF** or **EPS**: superscripts/subscripts separate from their base text with alignment gaps.
- **Suggested Fix**:
  Keep inline `<tspan>` runs without `x`/`y` attributes (and without explicit line-break `dy`) on the same logical line in `textRuns`, summing total line advance for `text-anchor="middle"` and `"end"`.

---

### Issue 85 [FIXED]: `ecAnything` for `homologous-competition-logx` uses inverted `(100 - f) / f`, computing `IC(100-F)` labeled as `IC{F}`
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:283` now uses `log10(f/(100-f))` and `tests/checks.ts` pins the corrected expectation)
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:279-290` (`ecAnything`)
  - `tests/checks.ts:13201-13217` (pins the inverted expectation)
- **Explanation**:
  For homologous competition, at inhibitory fraction $F \in (0, 100)$, the remaining fraction of specific binding is $(100 - F)/100$, so $[I] = (K_d + [L]) \cdot F / (100 - F)$. Instead, `ecAnything` (`src/stats/xy/nonlinear-fit.ts:282`) computes `(10^logKd + L) * ((100 - f) / f)`, which evaluates $\text{IC}_{100-F}$ and labels it `IC{F}`. For $L = 1, K_d = 1$, requesting `IC80` returns `0.5` ($\text{IC}_{20}$) instead of `8` (a $16\times$ error; $81\times$ at `IC90`). `tests/checks.ts:13201-13217` currently asserts the inverted value.
- **Minimal Reproduction**:
  Fit `homologous-competition-logx` with `ligandConcentration: 1` (true $K_d = 1$) and request `ecx: 80`: `IC80` reports `0.5` instead of `8`.
- **Suggested Fix**:
  Change `((100 - f) / f)` to `(f / (100 - f))` in `src/stats/xy/nonlinear-fit.ts:282` and update the corresponding assertion in `tests/checks.ts:13201-13217`.

---

### Issue 86 [FIXED]: Sign-aware `X = 0` guard `ifelse(HillSlope<0, Top, Bottom)` truncates unshared `Top[g]`/`Bottom[g]` to length 1 in global fits
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:425, 1390` uses length-preserving arithmetic `Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)`)
- **Files**:
  - `src/stats/xy/nonlinear-fit.ts:419, 1384`
  - `src/stats/xy/nonlinear-regression.ts:1630-1635, 1783-1791`
- **Explanation**:
  In R, `ifelse(test, yes, no)` returns a vector with the length of `test`. When `HillSlope` is shared or fixed (a length-1 scalar) and `Top` / `Bottom` are unshared vectors (`Top[g]`, `Bottom[g]`) in a global fit (`runGlobalNonlinear`), `ifelse(x==0, ifelse(HillSlope<0, Top, Bottom), ...)` evaluates `ifelse(HillSlope<0, ...)` to length 1 (`Series 1`'s plateau) and recycles it across every group `g` at `X = 0`, corrupting `X = 0` predictions for Series 2..k.
- **Minimal Reproduction**:
  Run a global fit on `sigmoidal-4pl-x` (or `asymmetric-5pl-x` / `absolute-ic50-x`) with two datasets having `X = 0` and different `Top`/`Bottom` spans while sharing or fixing `HillSlope`: Series 2's `X = 0` fitted value uses Series 1's `Top`/`Bottom`.
- **Suggested Fix**:
  Replace `ifelse(HillSlope<0, Top, Bottom)` with `(Bottom + (Top - Bottom) * ifelse(HillSlope<0, 1, 0))` (or coerce condition length to `length(x)`).

---

### Issue 87 [FIXED]: `feedback-server` `DedupeSet` has permanent `in_flight` leak on client disconnect, two-mutex TOCTOU race, and `Notify` lost wakeup
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`feedback-server/src/lib.rs:350-478, 775-840` unifies `Mutex<DedupeState>`, adds RAII `InFlightGuard` with `Arc::ptr_eq`, and pre-registers `Pin<Box<OwnedNotified>>` before unlock)
- **Files**:
  - `feedback-server/src/lib.rs:336-397, 677-741` (`DedupeSet`, `submit_feedback`)
- **Explanation**:
  `DedupeSet` (`feedback-server/src/lib.rs:336-397`) has three concurrency defects:
  1. **Permanent `in_flight` leak on disconnect**: Claiming an in-flight `feedback_id` relies on explicit cleanup after `await` rather than an RAII `Drop` guard. If the HTTP client disconnects while `create_plane_issue` is pending and hyper cancels the handler future, the `feedback_id` remains stuck in `in_flight` permanently, stalling every subsequent retry for 35 s.
  2. **Two-mutex TOCTOU race**: `seen` and `in_flight` are guarded by separate mutexes; releasing `seen` before acquiring/inserting `in_flight` leaves a window where two concurrent requests with the same `feedback_id` both pass and create duplicate Plane issues.
  3. **`Notify::notify_waiters()` lost wakeup**: `notify_waiters()` only wakes tasks already registered in `.notified().await`. A second task transitioning from checking `in_flight` to calling `notified().await` can miss the notification and hang for the full 35 s wait timeout.
- **Minimal Reproduction**:
  Abort an in-flight `POST /api/v1/feedback` connection mid-request (client disconnect): all subsequent requests with that `feedback_id` stall for 35 s forever. Or send two simultaneous requests with the same `feedback_id` across the mutex gap.
- **Suggested Fix**:
  Unify `seen` and `in_flight` under a single `Mutex`, register `notified()` futures (pinned) *before* releasing the lock, and attach an RAII `Drop` guard that releases the `in_flight` slot (and notifies waiters) if the leader future is dropped/cancelled.

---

### Issue 88 [FIXED]: `mcp-bridge` `seq 540` session recovery fails on port-change restart, fails on rotated-token restart, and permanently wedges on transient failure
- **Severity**: High
- **Status**: Fixed at `d4b45130` (`src-tauri/mcp-bridge/src/main.rs:397-547` reloads discovery on `e.is_connect()`, handles `401` + `404` recovery in either order, and preserves `session_id` until `initialize` + `notifications/initialized` succeed)
- **Files**:
  - `src-tauri/mcp-bridge/src/main.rs:395-427, 442-483` (`forward_rpc`, `recover_session`)
- **Explanation**:
  1. **Port-change restart fails**: When Titer restarts and binds a new ephemeral MCP port, the existing socket refuses connections (`e.is_connect()`), and `forward_rpc` returns an error immediately without reloading `discovery.json` to discover the new port.
  2. **Rotated-token restart fails**: On HTTP `401`, the bridge reloads the bearer token and retries using the stale `session_id` — getting a raw HTTP `404` without triggering `recover_session`.
  3. **Permanent wedge on transient failure**: `recover_session` clears `*session_id = None` *before* attempting `initialize`. If `initialize` fails once transiently (e.g. during startup), subsequent requests see `session_id.is_none()` and stop triggering session recovery, wedging the bridge permanently.
- **Minimal Reproduction**:
  Restart Titer while an MCP client session is connected to `mcp-bridge` (changing port or rotating token): bridge calls fail with connection/404 errors instead of re-initializing against the new `discovery.json` server.
- **Suggested Fix**:
  Reload `discovery.json` on `e.is_connect()` and recover the session; treat `401` + rotated token retry `404` as recoverable; and keep `*session_id` intact (or fall back to re-initialize whenever `session_id` is absent) until `initialize` succeeds.

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

### Issue 91 [FIXED]: `formatFigureLabels` rewrites `layout.annotations[i].name`, breaking point-label drag repositioning and leaking phantom keys into `graphOptions.points`
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`formatValue` at `src/lib/label-format.ts:224-248` leaves `annotation.name` untouched)
- **Files**:
  - `src/lib/label-format.ts:157-171` (`formatFigureLabels`)
  - `src/views/graphs/plot-helpers.ts:457-466`
  - `src/views/graphs/graph-view.tsx:382-388, 699-700, 874`
- **Explanation**:
  `formatFigureLabels` transforms `layout.annotations[i].name` alongside display text. However, `graph-view.tsx` and `plot-helpers.ts` use `annotation.name` as the stable internal identifier key into `graphOptions.points` when persisting dragged point-label offsets. Modifying `annotation.name` when a point label contains `^`/`_`/HTML characters breaks lookups for saved positions and writes phantom keys into `graphOptions.points`.
- **Minimal Reproduction**:
  Label a scatter point `CO_2` or `A & B`, enable point labels, and drag the label to reposition it: the offset is stored under a formatted/escaped key and fails to round-trip to the point.
- **Suggested Fix**:
  Do not rewrite `annotation.name` in `formatFigureLabels`; only format `annotation.text`.

---

### Issue 92 [FIXED]: `buildGroupedBars` breaks `groupLayout: "superimposed"` when `showPoints: true`, misaligning bars with significance overlays
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/views/graphs/grouped-common.ts:82-109, 144, 160-194` keeps `superimposed` bars row-centered via `superimposedPositions` with `showPoints: true`)
- **Files**:
  - `src/views/graphs/grouped-common.ts:61-75, 164-177` (`buildGroupedBars`)
  - `src/views/graphs/significance-overlay.ts:491-492`
- **Explanation**:
  When `showPoints: true`, `buildGroupedBars` switches bars from centered categorical slots to interleaved numeric bar positions `r ± center(g)` even when `options.groupLayout === "superimposed"`. This splits superimposed bars into narrow side-by-side bars and desynchronizes bar X centers from `significance-overlay.ts:491-492`.
- **Minimal Reproduction**:
  Create a Grouped graph with `groupLayout: "superimposed"`, enable **Show individual points**, and attach significance brackets: bars split apart instead of superimposing and brackets misalign.
- **Suggested Fix**:
  Preserve row-centered X coordinates (`r`) for `groupLayout === "superimposed"` even when `showPoints: true`.

---

### Issue 93 [FIXED]: `TiterMcpServer::get_info()` never advertises `capabilities.tools.listChanged: true` and `mcp_set_enabled(false)` never clears `inner.peers`
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`TiterMcpServer::get_info()` at `src-tauri/src/mcp.rs:10215-10221` calls `.enable_tool_list_changed()`; `McpState::disable_server()` at `:456-461, 1109` clears `inner.peers`)
- **Files**:
  - `src-tauri/src/mcp.rs:1098-1102, 10090-10092`
- **Explanation**:
  1. `TiterMcpServer::get_info()` (`src-tauri/src/mcp.rs:1098-1102`) returns server capabilities without calling `.enable_tool_list_changed()`, so compliant MCP clients ignore `tools/list_changed` notifications.
  2. `mcp_set_enabled(false)` (`line 10090`) leaves disconnected/disabled peer handles in `inner.peers` instead of clearing them.
- **Suggested Fix**:
  Call `.enable_tool_list_changed()` inside `ServerCapabilities::builder().enable_tools()` in `TiterMcpServer::get_info()`, and clear `inner.peers` in `mcp_set_enabled(false)`.

---

### Issue 94 [FIXED]: `reapply_antigravity_entry_if_connected` silently overwrites custom/remote `"titer"` entries in `~/.gemini/config/mcp_config.json` on every launch
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`antigravity_entry_needs_reapply` at `src-tauri/src/mcp.rs:2628-2692` checks `existing["command"] == bridge` before overwriting; minor note: `state.ensure_dir(app)` at `:2679` still runs before that check when a remote/custom `"titer"` entry exists)
- **Files**:
  - `src-tauri/src/mcp.rs:1897-1901, 2541-2580` (`reapply_antigravity_entry_if_connected`)
- **Explanation**:
  On every launch, `reapply_antigravity_entry_if_connected` overwrites any `"titer"` entry in `~/.gemini/config/mcp_config.json` unconditionally — clobbering user-customized or remote `"titer"` configurations even when auto-connect is disabled/opted out — and calls `create_dir_all` for `<app_data>/mcp/` before checking whether `mcp_config.json` even exists.
- **Suggested Fix**:
  Check `mcp_config.json` existence and whether the existing `"titer"` entry is a Titer-managed local bridge entry (and not opted out) before creating directories or modifying `~/.gemini/config/mcp_config.json`.

---

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

### Issue 96 [FIXED]: `webr.ts` `resolveInEngine` fires an unconditional `releaseClaimCode(pending)` on claim timeout (`codes === null`), risking wiping another window's live claim
- **Severity**: Medium
- **Status**: Fixed at `d4b45130` (`src/stats/webr.ts:875-891, 969` uses conditional token release on timeout)
- **Files**:
  - `src/stats/webr.ts:828-841, 918-926` (`resolveInEngine`)
- **Explanation**:
  When `resolveInEngine` times out obtaining claim codes (`codes === null`), it falls back to running an unconditional `releaseClaimCode(pending)` cleanup that deletes the shared claim variable without verifying ownership — risking wiping another window's live package-install claim in progress.
- **Suggested Fix**:
  Pass the window's own unique claim token/stamp into the conditional release helper even on timeout (never issuing an unconditional claim deletion).

---

## Low-Severity Issues (Recheck 2)

### Issue 97 [FIXED]: `labelRuns` splits Unicode minus (`10^−6` → `10<sup>−</sup>6`) and collapses consecutive `_` runs (`ctrl_1_a` → `ctrl<sub>1a</sub>`)
- **Severity**: Low
- **Status**: Fixed at `d4b45130` (`src/lib/label-format.ts:49, 85` supports Unicode minus `U+2212` and only coalesces `"normal"` runs)
- **Files**:
  - `src/lib/label-format.ts:43, 77-90` (`labelRuns`)
  - `src/views/tables/grid.tsx:996, 999, 1154, 1180`
- **Explanation**:
  `labelRuns` only recognizes ASCII `-` (U+002D) as part of signed exponents, so Unicode minus `−` (U+2212) terminates the superscript run after `−` (`"10^−6"` → `10<sup>−</sup>6`). It also collapses chained `_` tokens when unbraced (`"ctrl_1_a"` → `ctrl<sub>1a</sub>`), affecting both graph labels and `grid.tsx` headers.
- **Suggested Fix**:
  Include Unicode minus `\u2212` alongside ASCII `-` in exponent sign matching, and avoid merging separated `_` tokens into a single subscript run.

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

### Issue 100: Upstream 1.1.1 `axisKind` is not wired into `FormatPanel`: `rowsAt: "values"` and `histogram`/`qq-plot` lose X controls, `grouped-stacked`/`residuals` offer dead Log controls, `grouped-hbars` mislabels value axis as `"Y"`, and `scree-plot`/`dendrogram` misdeclare `XY_AXES`
- **Severity**: High
- **Status**: Open (from Recheck 3 at `d4b45130`; merged in `1f5af2e9`, reverted in `34f50c12`)
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

### Issue 102 [FIXED]: `2db68ed1` ANOVA 13-digit centering missed `TukeyHSD` (making Tukey P values contradict centered Tukey CIs), plus Welch, Brown-Forsythe, linear trend, and post-hoc diffs
- **Severity**: High
- **Status**: Fixed at `c54f5954` (`src/stats/column/anova.ts` and `src/stats/column/base.ts` center `TukeyHSD`, Welch, Brown-Forsythe, linear trend, lognormal `exp(m+mean(v))`, and `describe` diffs)
- **Files**:
  - `src/stats/column/anova.ts:69-77, 218, 226, 230, 246-248`
  - `src/stats/column/base.ts:208` (`tukeyPosthocStatements`)
- **Explanation**:
  1. `anova.ts:218` centers `aov(I(v-mean(v))~gr)` for the ANOVA table and uses that centered `mse` for Tukey 95% CIs (`lines 70, 76-77`), **but** line `72` calls `tukeyPosthocStatements(k)` with the uncentered default `aov(v~gr)`. On 13-digit datasets (e.g. NIST `SmLs09`), uncentered `aov(v~gr)` inflates MSE ~3×, causing Tukey **P values** and Tukey **95% CIs** in the same table to disagree directly.
  2. `m <- sapply(G, mean)` (`line 218`) rounds group means at $10^{13}$, corrupting differences (`m[i] - m[j]`) in Brown-Forsythe (`line 226`), Welch `oneway.test(v~gr)` (`line 230`), linear trend (`line 246`), and post-hoc `diff(i, j)` (`line 69`).
- **Minimal Reproduction**:
  Run One-way ANOVA with Tukey post-hoc on NIST `SmLs09` (or `anovaBig` from `tests/testdata/precision-1e13.json`): adjusted P values come from the corrupted uncentered fit while 95% CIs come from the centered fit.
- **Suggested Fix**:
  Center `mv <- mean(v); v0 <- v - mv; G0 <- lapply(G, function(x) x - mv); mc <- sapply(G0, mean)` in `anova.ts:218`, pass `"aov(v0~gr)"` to `tukeyPosthocStatements`, run `oneway.test(v0~gr, var.equal=FALSE)`, and use `mc` for Brown-Forsythe, linear trend, and post-hoc diffs (retaining `m` only for lognormal `exp(m)`).

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

### Issue 104 [FIXED]: `valueXAxis` drops `options.gridX`, silently disabling X gridlines on Connected Lines with `rowsAt: "values"`
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src/views/graphs/plot-helpers.ts` `valueXAxis` now forwards `options.gridX` to `axisChrome` and `xAxisRange`)
- **Files**:
  - `src/views/graphs/plot-helpers.ts:883-888, 1679-1680` (`valueXAxis`, `groupedScatterLayout`)
- **Explanation**:
  `valueXAxis` (`plot-helpers.ts:883-888`) invokes `axisChrome(options)` and `xAxisRange(options)` without passing `options.gridX`, unlike `xyLayout` (`lines 1300-1301`). Connected Lines graphs using `rowsAt: "values"` therefore ignore **X gridlines: Major / Major + minor**.
- **Suggested Fix**:
  Forward `options.gridX` to `axisChrome(options, options.gridX)` and `xAxisRange(options, undefined, options.gridX)` inside `valueXAxis`.

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

### Issue 106 [FIXED]: `clipboard_text` (macOS) passes unchecked nullable `UTF8String` pointer to `CStr::from_ptr` in `unsafe`
- **Severity**: Medium
- **Status**: Fixed at `c54f5954` (`src-tauri/src/main.rs:1679-1684` `utf8_ptr_to_string` guards `ptr.is_null()` before `CStr::from_ptr`)
- **Files**:
  - `src-tauri/src/main.rs:1645-1654` (`clipboard_text`)
- **Explanation**:
  Inside `clipboard_text`, `let utf8: *const std::ffi::c_char = objc2::msg_send![text.as_ref()?, UTF8String];` is passed directly to `std::ffi::CStr::from_ptr(utf8)` with no `utf8.is_null()` check. If `-[NSString UTF8String]` returns `NULL` (e.g. unpaired UTF-16 surrogates on the pasteboard), dereferencing `NULL` in `CStr::from_ptr` causes immediate UB / crash.
- **Suggested Fix**:
  Add `if utf8.is_null() { return None; }` before `CStr::from_ptr(utf8)`.

---

### Issue 107 [PARTIALLY FIXED]: `noncentralTCdf` overflows `tt * tt` for `|t| ≥ 1.34e154` (returning `normalCdf(-delta)` instead of `1`/`0`) and `noncentralTTwinSeriesModeCentered` breaks at `|δ| ≥ 1e6` / large `df + δ`
- **Severity**: Medium
- **Status**: Partially Fixed at `c54f5954` (`src/stats/distributions.ts` fixes `tt * tt` overflow and `Gamma(a, Inf)` via `noncentralTChiSquareLimit`)
- **Remaining at `c54f5954`**: **High regression**: `noncentralTChiSquareLimit` (`src/stats/distributions.ts:368-370, 421-453`) drops `Z ~ N(0, 1)`, which is only valid for `df ≪ δ²`. For large `df` (including the entire `mu >= 7e5 && df >= 1.4e6` trigger and `|δ| > 1414` with large `df`), it produces up to `0.17` CDF error and an `0.081` boundary cliff at `|δ| = 1414 → 1415` (e.g. `noncentralTCdf(1416, 1e7, 1415)` → `0.9992` vs exact `0.8298`; `noncentralTCdf(1201, 1e8, 1200)` → `1.0` vs exact `0.8405`). Also see `#63`/`#80` for the remaining `mu <= 700` `rxb` underflow.
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

### Issue 109 [FIXED]: `openSourceFile` discards the specific Rust error string returned by `open_file`
- **Severity**: Low
- **Status**: Fixed at `c54f5954` (`invokeErrorMessage` in `src/lib/invoke-error.ts:5-6` preserves plain Tauri string rejections in `src/views/tables/import-dialog.tsx:263-271`)
- **Files**:
  - `src/views/tables/import-dialog.tsx:236-247` (`openSourceFile`)
- **Explanation**:
  Tauri 2 `invoke("open_file", ...)` rejects with a plain string, so `err instanceof Error ? err.message : "The file couldn't be opened."` discards `check_openable_file`'s specific missing-file message and always displays the generic fallback.
- **Suggested Fix**:
  Also extract non-empty string errors (`typeof err === "string" && err ? err : ...`).

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

### Issue 111 [FIXED]: `fitted-curve.ts` `x === 0` guard misses 4 other R-guarded raw-X ratio models and `asymmetric-5pl-x` underflow at tiny `HillSlope`
- **Severity**: Low
- **Status**: Fixed at `c54f5954` (`src/views/graphs/fitted-curve.ts` adds unconditional `x === 0` limits for all 8 raw-X ratio models matching R `nonlinear-fit.ts`)
- **Files**:
  - `src/views/graphs/fitted-curve.ts:58-64, 82, 96, 121-145, 188`
- **Explanation**:
  R's `nonlinear-fit.ts` guards `x == 0` unconditionally for `agonist-3pl-x`, `agonist-3pl-normalized-x`, `biphasic-x`, and `bell-shaped-x`, whereas TS `fitted-curve.ts` only guards the 4 sigmoidal models when `c("EC50") <= 0` (`EC50 === 0` at `x === 0` still yields `0/0 = NaN` in the other 4 models, and `asymmetric-5pl-x` with `EC50 > 0` and tiny positive `HillSlope` can underflow `(2^(1/S)-1)^(1/HillSlope)` to `0` → `NaN` at `x === 0`).
- **Suggested Fix**:
  Handle `x === 0` explicitly in `fitted-curve.ts` for all 8 raw-X ratio models matching R's exact limits.


---

## New Issues Found in Recheck 4 at `c54f5954` (#112–#115)

### Issue 112: Two-way ANOVA `runPosthoc` still computes uncentered `mean(a) - mean(b)` at `1e13` scale
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/stats/grouped/two-way-anova.ts:301-302, 323-325` (`runPosthoc`)
  - `src/stats/grouped/two-way-anova.ts:612` (RM sphericity-assumed post-hoc path)
- **Explanation**:
  Commit `989f7c0b` centered `v <- v - mean(v)` in the main ordinary and repeated-measures ANOVA R calls (lines 526, 781), **but** `runPosthoc` still passes raw uncentered cell vectors `c.a` and `c.b` into R and computes `d <- mean(a) - mean(b)` (`lines 302, 323`). At `1e13` scale (ULP $\approx 0.00195$), subtracting uncentered cell means loses 12+ digits across **every** ordinary two-way post-hoc (Tukey, Bonferroni, Šídák, Holm–Šídák, LSD, Dunnett, Games–Howell, FDR) and RM sphericity-assumed post-hoc.
- **Minimal Reproduction**:
  Run Two-way ANOVA (ordinary or RM sphericity-assumed) with Tukey/Šídák/Bonferroni post-hoc on Cell A `= [1e13 + 0.01, 1e13 + 0.02, 1e13 + 0.03]` and Cell B `= [1e13 + 0.05, 1e13 + 0.06, 1e13 + 0.07]`: raw `mean(a) - mean(b)` yields `-0.0390625` instead of `-0.041015625` (`4.76%` error in `diff` and `t`, amplifying to larger P-value errors).
- **Suggested Fix**:
  Shift each compared pair by a common origin before subtracting means in `runPosthoc` (`m0 <- a[1]; d <- mean(a - m0) - mean(b - m0)`).

---

### Issue 113: Three-way ANOVA `runPosthoc` computes uncentered `diff` and single-pass TS Games–Howell `variance()` at `1e13` scale
- **Severity**: High
- **Status**: New
- **Files**:
  - `src/stats/grouped/three-way-anova.ts:135, 142-145, 259-262` (`runPosthoc`, `variance`)
- **Explanation**:
  Commit `989f7c0b` centered `v <- v - mean(v)` in the main `aov`/`drop1` call (line 330), **but** `runPosthoc` still computes both `const diff = mean(vi) - mean(vj)` (`line 135`) and Games–Howell's `variance(vi)` (`lines 142-143, 259-262`) in TypeScript on raw uncentered cell values. At `1e13` scale, `diff` loses precision for every post-hoc test, and single-pass `variance()` picks up $n \delta^2 / (n - 1)$ from `mean(values)`'s ULP error, corrupting Games–Howell `se`, Welch `df`, `t`, `p`, and CIs.
- **Minimal Reproduction**:
  Run Three-way ANOVA Games–Howell post-hoc on `vi = [1e13 + 0.01, 1e13 + 0.02, 1e13 + 0.03]`, `vj = [1e13 + 0.05, 1e13 + 0.06, 1e13 + 0.07]`: `diff` is `-0.0390625` (`4.76%` error) and `variance(vi)` is `1.0109e-4` instead of `9.5367e-5` (`6.00%` error).
- **Suggested Fix**:
  Shift by a common point for `diff` (`m0 = vi[0]`, `mean(vi - m0) - mean(vj - m0)`) and double-center `values` inside `variance()`.

---

### Issue 114: Nested ANOVA post-hoc `diff` still subtracts raw uncentered `described[i].mean - described[j].mean`
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/stats/nested/nested-anova.ts:85-94`
  - `src/stats/column/base.ts:78-79` (`describe()` centered `diff(i, j)`)
- **Explanation**:
  Commit `d6453524` centered `aov`, `TukeyHSD`, and `pairwise.t.test` in `nested-anova.ts` so the F statistic and post-hoc P values are accurate at `1e13` scale. However, line `85` calls `describe(asGroups)` without `pairs` and line `91` computes `diff: described[i].mean - described[j].mean` on raw uncentered group means, ignoring the centered `diff(i, j)` helper added to `describe()` in `src/stats/column/base.ts:78-79`.
- **Minimal Reproduction**:
  Run Nested ANOVA with Tukey or Bonferroni post-hoc on 13-digit data (`nestedBig`): `comparisons[k].diff` carries the ~0.002 ULP cancellation error while `p` is centered.
- **Suggested Fix**:
  Pass `pairIndices(groups.length)` into `describe(asGroups, pairs)` and set `diff: diff(i, j)` in `comparisons`.

---

### Issue 115: Deming regression TS `olsFit` (for `notes()`) and `demingProblem` still use single-pass uncentered sums
- **Severity**: Medium
- **Status**: New
- **Files**:
  - `src/stats/xy/deming-regression.ts:56-63, 70-78, 136, 140` (`demingProblem`, `olsFit`, `notes`)
- **Explanation**:
  Commit `67a1cbb3` double-centered Deming + jackknife and OLS in R (`rCode`, lines 102–110), **but** left two TypeScript helpers single-pass uncentered:
  1. `olsFit` (`lines 70-78`) formats the OLS comparison equation in `notes()` (`line 140`), causing the note equation to visibly disagree with the R-computed `OLS slope` / `OLS Y-intercept` rows on the same results sheet at `1e13` scale.
  2. `demingProblem` (`lines 56-63`) checks `sxx === 0` / `syy === 0` / `sxy === 0` using raw uncentered `mean(xs)`/`mean(ys)`, allowing constant data like `[0.1, 0.1, 0.1]` to pass (`sxx = 5.78e-34 !== 0`) and fail in double-centered R (`NaN`).
- **Minimal Reproduction**:
  1. Fit Deming regression on `x = [1e13+0.1..1e13+0.6]`, `y = [1e13+5.12..1e13+5.61]`: R `olsIntercept` is `1.1068e11` while `olsFit` in `notes()` shows `1.1083e11`.
  2. Fit `xs = [0.1, 0.1, 0.1]`, `ys = [0.1, 0.1, 0.1]`: `demingProblem` returns `undefined` instead of rejecting constant data.
- **Suggested Fix**:
  Double-center against `xs[0]`/`ys[0]` in both `demingProblem` and `olsFit` (or format `notes()` OLS text from R's `olsSlope`/`olsIntercept`).
