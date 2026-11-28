# BUG-REPORT.md cleanup — 76 fixed entries removed (Nov 27, 2026)

Source: `BUG-REPORT.md` at origin/main `1c28ce5c` (Recheck 5 at `ad3fe0d0`; 2544 lines, 145 entries: 76 Fixed, 69 Active).
Branch: `docs/bug-report-remove-fixed` (this cleanup; NOT merged — Atlas merges after verifying the diff).

## What was done

- All **76 entries marked Fixed** were removed from BUG-REPORT.md — both their summary-table rows and their detail sections. No Partial, Open, or New entry was altered or dropped (verified by diffing entry numbers before/after: the 69 remaining entries are byte-identical to the original).
- The header "Recheck Status" section was rewritten to active-only counts: **69 Active (40 High, 26 Medium, 3 Low)** — the same counts Recheck 5 recorded, no counting discrepancy found.
- Three section headings became empty and were removed with their sections: `## Low-Severity Issues` (#65–#67, all fixed), `## Low-Severity Issues (Recheck 2)` (#97, fixed), `## New Issues Found in Recheck 4 at \`c54f5954\` (#112–#115)` (all fixed).
- **No entry was left in place as ambiguous**: every Fixed entry had its own self-contained detail section (heading + Status line + body), so none shared a section with an active item.

## Evidence note

Each entry below quotes its own `- **Status**: Fixed at ...` line from the removed detail section — that is the recorded fix evidence (fix commit + files). Branch / Plane-seq annotations are added only where the wave records carry them (`bugreport/STATUS.md`, `STATUS-98-111.md`, `STATUS-112-115.md`, sweep cycles 52–53 in `investigations.md`); nothing was invented. No entry needed the fallback "fixed per Recheck 5, evidence not re-traced" — all 76 carry a Status line.

## Removed entries

### #2 [High] — Arbitrary file read via unvalidated `provider` path traversal in `cloud_read_cache`
- Fix evidence: Fixed at `b8a2528` (`src-tauri/src/cloud.rs:549-556` allowlists `PROVIDER_BOX` / `PROVIDER_MOCK`)

### #3 [High] — OAuth browser URL allowlist bypass in `open_browser_url` / `open_url` via userinfo (`@`)
- Fix evidence: Fixed at `b8a2528` (`src-tauri/src/cloud.rs:370-384` fails closed when authority contains `@`)

### #5 [High] — Plugin capability revocation bypass: disabling/uninstalling a plugin never tears down its Isolation session, letting re-enable retain revoked permissions
- Fix evidence: Fixed at `8c877d8` (`src/plugins/loader.ts:292-321`, `src/plugins/isolation.ts:201-209, 306-326`, and `src/marketplace/store.ts:260-266, 344-356` tear down active sessions, clear live grants, and validate live grants in `launchPluginWebview` / `interceptPluginCall`)

### #8 [High] — Feedback server global rate limit can be exhausted by a single per-IP blocked attacker, plus unbounded rate-limiter maps and dedupe TOCTOU race
- Fix evidence: Fixed at `d4b45130` (`feedback-server/src/lib.rs:350-478, 775-840` unifies `DedupeSet` under a single `Mutex<DedupeState>` with RAII `InFlightGuard` and pre-registered `OwnedNotified`, closing the remaining dedupe gap alongside `#87`)

### #12 [High] — Enabled marketplace plugins are never re-registered into the live plugin registry on app restart
- Fix evidence: Fixed at `d4b45130` (`src/main.tsx:54-71` awaits `getMarketplaceStore()` before mount; `src/marketplace/store.ts:99-111` rechecks `"incompatible"` records on upgrade; `src/marketplace/wiring.ts:22-35` drops rejected `storePromise` on error)

### #13 [High] — `ScriptDialog` crashes React on opening **File ▸ Run Script…** (conditional `useState` after early `return null`)
- Fix evidence: Fixed at `b8a2528` (conditional hooks moved into `SavedScriptsPanel` in `src/components/script-dialog-saved.tsx:16-31` / `src/components/script-dialog.tsx:54-62, 157-163`)

### #14 [High] — `AnalysisWizard` crashes with uncaught `TypeError` on **Change Parameters… (`⌘T`)** whenever a wizard has 0 questions for the current table
- Fix evidence: Fixed at `b8a2528` (`canEditAnalysisParams` + `wizardAsksNothing` in `src/views/analyses/wizards.ts:632-655, 706-752` and `!q` guards in `src/views/analyses/analysis-wizard.tsx:228-327`)

### #15 [High] — `AnalysisView` **Cancel** button and elapsed-time/queue display are unreachable dead code while an analysis is running
- Fix evidence: Fixed at `b8a2528` (`src/views/analyses/analysis-view.tsx:34-66, 225-227` renders elapsed time, queue position, and **Cancel** inside `<Running />`; see new macOS native spinner overlap regression in Issue #74)

### #16 [High] — `ImportDialog` overwrites the parent table when "Create a new table" is shown selected (`insertionPoint === null`), drops all edits on `Enter` (stale closure), and strips the whole file as Info/Notes on `fromRow`
- Fix evidence: Fixed at `c54f5954` (`src/views/tables/import-dialog.tsx:197-204, 253-254, 277-296, 850, 888` handles `insertionPoint === null`, keeps latest `confirm`/`onCancel` via refs, and initializes `fromRow` end-row state)

### #18 [High] — `duplicateFamily` fails to remap analysis links in cloned graphs, binding duplicated graphs to the original table's analyses
- Fix evidence: Fixed at `c54f5954` (`src/store/use-project-store.tsx:646-675` builds a two-pass `idMap` and remaps all 11 `GRAPH_ANALYSIS_ID_KEYS` plus `sigAnalysisIds`)

### #21 [High] — `calcvars.ts`: `NOT` binds tighter than comparisons/arithmetic (inverting `WHERE NOT …` and `IF(NOT …)`), and `renameVariableInFormula` writes unbracketed names and corrupts scientific notation
- Fix evidence: Fixed at `b8a2528` (`not()` precedence added in `src/lib/calcvars.ts:251-264, 301-304`; `renameVariableInFormula` at `src/lib/calcvars.ts:1253-1301` skips numeric literals and brackets non-identifier/reserved names)

### #22 [High] — `calcvars.ts`: stale `rawTextAt` for chained calculated variables (`COUNTA`, `OVER`), silent wrong/blank results for expression aggregates (`MIN(A+B)`, `MEAN(A+B)`), and `RANK` returning `0.5` on excluded rows
- Fix evidence: Fixed at `c54f5954` (`src/lib/calcvars.ts` reads computed text in `rawTextAt`, rejects non-`var` expression aggregates, and returns `null` from `RANK` on `WHERE`-excluded rows; minor edge case: a `ROWS` frame excluding `CURRENT ROW` with tying values at `src/lib/calcvars.ts:756` can still match `equal >= 1`)

### #26 [High] — Native Titer XY replicate (`A:Y1`, `A:Y2`) and XY summary (`A:Mean`, `A:SD`, `A:N`) tables lose their grouping, `summaryFormat`, and nonlinear-regression dataset links in both `.prism` and `.pzfx` exports
- Fix evidence: Fixed at `c54f5954` (re-applied in `4860fc4d` with positional dataset lettering fix in `a4d1425d` across `src/lib/prism-write.ts` and `src/lib/pzfx-write.ts`)

### #27 [High] — EPS vector export produces invalid/corrupted PostScript (`nocurrentpoint` crash on text + leaked `clip` path)
- Fix evidence: Fixed at `8c877d8` (`src/lib/vector-export.ts:1646-1664, 1709`; minor EPSF-3.0 note: `%%BoundingBox` on line 1737 still emits fractional floats rather than integer bounds)

### #30 [High] — Multi-panel Figure vector PDF and EPS exports are shrunk to 75% (`0.75×`) of configured physical dimensions
- Fix evidence: Fixed at `8c877d8` (`src/lib/figure.ts:670` emits `pt` units in `composeFigureSvg`; `src/lib/vector-export.ts:1540-1563` handles unit conversion in `svgSize`/`rootViewBoxMatrix`)

### #31 [High] — `grouped-bars-scatter` ("Bars with individual points") plots numeric scatter X coordinates on a categorical X axis and duplicates points/legend entries
- Fix evidence: Fixed at `d4b45130` (`buildGroupedBarsScatter` at `src/views/graphs/grouped-common.ts:229-237` delegates directly to `buildGroupedBars` with `showPoints: true` on the numeric bar axis, alongside `#92`)

### #32 [High] — Summary tables draw no SEM error bars on `"mean-sem"` tables and drop asymmetric lower error bars (`errorMinus`) on XY summary graphs
- Fix evidence: Fixed at `c54f5954` (`src/views/graphs/plot-helpers.ts` computes `asSem` without `asSd` on `"mean-sem"`, uses `Math.abs(m)` for CV, and preserves `errorMinus` in `xyDrawn`)

### #34 [High] — `validateAnalysisParams` omits 11 per-analysis enum narrowings from `analysis-params-schema.json`, allowing cross-family params that silently run the wrong statistical test or crash R
- Fix evidence: Fixed at `d4b45130` (100% key parity between `ENUM_OVERRIDES` in `scripts/generate-analysis-params-schema.py:102-151` and `PARAM_CHOICES` in `src/lib/project-file.ts:986-1050`; runtime enum guards added in `src/stats/simulation/monte-carlo.ts:203-206` and `src/stats/column/mixed-model.ts:94-109`)

### #35 [High] — `addFittedCurve` draws all-`NaN` curves (no line rendered) for every multi-Y (`params.ys`) and curve-comparison (`params.compareWith`) nonlinear regression
- Fix evidence: Fixed at `c54f5954` (`coefficientsForSet` in `src/stats/xy/nonlinear-regression.ts` handles both `${setName} — ` prefixes and ` (${setName})` suffixes)

### #36 [High] — Raw-X sigmoidal models (`sigmoidal-4pl-x`, `absolute-ic50-x`, `asymmetric-5pl-x`, `agonist-4pl-normalized-x`) force `Y = Bottom` (or `0`) at `X = 0` in R even when `HillSlope < 0`, corrupting falling-curve fits and disagreeing with TS `evaluate()`
- Fix evidence: Fixed at `d4b45130` (length-safe R guards `Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)` in `src/stats/xy/nonlinear-fit.ts:425, 891, 1390`, and explicit `x === 0` `EC50 <= 0` guards for all 4 raw-X sigmoidal models in `src/views/graphs/fitted-curve.ts:58-64`; minor adjacent gap on other raw-X ratio models tracked in `#111`)

### #38 [High] — Weighted, robust, and Poisson fits on log-Y models (`semilog-y-log`, `log-log-line`, `exponential-growth-log`) compute `R²` by dividing `log(Y)`-scale SS by raw `Y`-scale SST, and Poisson IRLS uses `1/log(Y)` weights
- Fix evidence: Fixed at `8c877d8` (`src/stats/xy/nonlinear-fit.ts:2780-2786, 3036-3037, 3073-3076, 3108-3113` and `src/stats/xy/nonlinear-regression.ts:1453, 2262-2266`)

### #39 [High] — `ecAnything` crashes R (`subscript out of bounds`) when `params.ecx` is requested on competition models, and `runGlobalNonlinear` mislabels shared `IC50`/`IC50Hi`/`LogKd` midpoints as `"EC50"`
- Fix evidence: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:283` fixes `homologous-competition-logx` `ecAnything` to `log10(f/(100-f))` alongside `#85`)

### #40 [High] — `user-defined.ts` accepts R reserved keywords (`NA`, `Inf`, `NULL`, `TRUE`, `for`, `in`, …) causing R syntax errors, and naming a parameter `HillSlope` causes the fitted curve overlay to render nothing (all `NaN`)
- Fix evidence: Fixed at `c54f5954` (`src/stats/xy/user-defined.ts` rejects R `?Reserved` identifiers; `src/stats/xy/nonlinear-regression.ts` `labelFor` preserves raw parameter names for `user-defined`)

### #41 [High] — Multiple Linear Regression (`multiple-regression.ts`) miscomputes VIFs, crashes with R syntax error when only categorical predictors are present, and passes raw unaligned columns to `describe()`
- Fix evidence: Fixed at `c54f5954` (`src/stats/multiple/multiple-regression.ts` computes `vifAssigns`/`vif` over `design` and calls `describe(alignedGroups(...))`)

### #42 [High] — Three-way ANOVA Games–Howell post-hoc crashes R (`object 'Infinity' not found`) when compared cells have zero variance (identical replicates)
- Fix evidence: Fixed at `b8a2528` (`src/stats/grouped/three-way-anova.ts:137` now checks `identical(vi) || identical(vj)`)

### #43 [High] — Sample Size & Power `solveEffect` fails for all valid effects in the upper doubling band (e.g. Pearson `r ∈ (0.8, 1)`, one-proportion `h ∈ (1.6, π]`, t/ANOVA/χ² `∈ (6.4, 10]`), and `power <= alpha` returns bogus `effect ≈ 0`
- Fix evidence: Fixed at `b8a2528` (`src/stats/sample-size-power.ts:258-265, 436-453` rejects `power <= alpha` and clamps `hi = cap`)

### #44 [Medium] — Missing `core:window:allow-hide` and `core:window:allow-set-focus` capabilities silently break BUG-12 close-quiesce mitigation and non-macOS Window menu switcher
- Fix evidence: Fixed at `c54f5954` (`src-tauri/capabilities/default.json:11-12` grants `core:window:allow-hide` and `core:window:allow-set-focus`)

### #48 [Medium] — Export tools fail with `"Titer can't access <path>"` whenever the output filename contains a dot (e.g. `Fig 1.2`) or on Windows paths with a dot in a parent directory
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:10181-10197` and `src/native.ts:129-151` split on `/` and `\` and check recognized export extensions)

### #49 [Medium] — `analysis-params-schema.json` omits `"none"` from `posthoc` enum for `nested-anova`/`multifactor-anova`, marks defaulted params required for `two-way-anova`/`rm-anova`, and duplicates `"xy"` in `nonlinear-regression.offered_on`
- Fix evidence: Fixed at `d4b45130` (`two-way-anova.design` now has `default: "ordinary", required: false` in `scripts/generate-analysis-params-schema.py:495` and `src-tauri/src/analysis-params-schema.json:3412-3413`)

### #51 [Medium] — Replicate XY tables break `deming-overlay.ts` & `binding-curve.ts` overlays; `addLogisticCurve` queries three nonexistent stat labels (always displaying `—`)
- Fix evidence: Fixed at `c54f5954` (`src/views/graphs/deming-overlay.ts` and `src/views/graphs/binding-curve.ts` pool replicate datasets via `splitXY`; `src/views/graphs/fitted-curve.ts` `addLogisticCurve` matches `logistic-regression.ts` stat labels)

### #53 [Medium] — `permuteColumns`, `dropColumns`, and `removeCalculatedVariable` corrupt or leak `cellBackgrounds`, `linkedPaste`, `calculated`, `decimals`, `variableTypes`, `labelVariable`, and `levelOrder`
- Fix evidence: Fixed at `c54f5954` (`src/views/tables/table-data.ts:418-475` and `src/lib/calcvars.ts:1219-1249` remap `cellBackgrounds`/`linkedPaste`, prune column metadata, and keep the last data column)

### #54 [Medium] — Copying cells in Titer and pasting via Paste Special (default options) inserts a spurious column-header row
- Fix evidence: Fixed at `d4b45130` (`src/views/tables/table-data.ts:1421-1438` `safeCodePoint` guards `<= 0x10ffff` and UTF-16 surrogates `0xd800..0xdfff`)

### #55 [Medium] — `.pzfx` XML parser scrambles mixed-content `<Title>`/`<d>` tags (`H<Sub>2</Sub>O` → `"HO2"`), drops `<Font>`-wrapped `<Info>` text, double-decodes CDATA, and matches closing-tag prefixes
- Fix evidence: Fixed at `b8a2528` (`src/lib/pzfx.ts:93, 107, 174-239, 264-267, 759-775`)

### #56 [Medium] — Scientific-notation comma-decimal numbers (e.g. `"4,096e+007"`, `"1,5e-3"`) are not normalized in `.pzfx` or `.prism` import and are silently dropped as non-numeric text
- Fix evidence: Fixed at `d4b45130` (leading `+` accepted in `src/views/tables/table-data.ts:1293`, `src/lib/pzfx.ts:320,323,326,368`, `src/lib/prism.ts:653,655,796`, and `src/lib/import-choices.ts:212,215`; `src/lib/prism.ts:653,796` `thousandsMode` accepts scientific exponents)

### #58 [Medium] — `applyRegenDecisions` mutates the project before validating later decisions (creating duplicate graphs on retry), and `mapSidecarGraph` ignores summary formats on grouped `.prism` tables
- Fix evidence: Fixed at `c54f5954` (`src/lib/prism-graph-regen.ts` validates all decisions in a first pass and calls `errorFor(resolved)` in `case "grouped"`)

### #59 [Medium] — `mergeGraphTables` skips the `summaryFormat` mismatch check for XY tables and silently drops extra Nested tables whose name contains `:`
- Fix evidence: Fixed at `c54f5954` (`src/lib/multi-table.ts` checks `summaryFormatOf` for XY tables; `src/lib/dataset.ts` parses trailing two `:` segments in `nestedGroupsOf`)

### #61 [Medium] — `report/conclusion.ts`, `report/checks.ts`, and `report/analyzed.ts` produce inverted/misleading conclusions and assumption checks
- Fix evidence: Fixed at `8c877d8` (`src/stats/report/conclusion.ts:194, 234-235, 289-306, 374-380, 516-521`, `src/stats/report/checks.ts:213-229, 242-247`, `src/stats/report/analyzed.ts:36-45, 168-180`)

### #62 [Medium] — `AICc` in `enzyme-inhibition.ts` (and `nonlinear-regression.ts`) omits the residual-variance parameter (`+ 1`) from `k`; `interpolationCode` drops 95% CIs on tight positive-X ranges; multi-Y centered polynomials share only the first set's `centeredX`
- Fix evidence: Fixed at `8c877d8` (`src/stats/xy/enzyme-inhibition.ts:149`, `src/stats/xy/nonlinear-regression.ts:1329, 1453, 2929-2932, 3032-3034, 3161`, `src/views/graphs/fitted-curve.ts:346-350, 435, 479, 497`)

### #63 [Medium] — `noncentralTCdf` underflows to `0` at `|δ| ≥ 38.57`, causing t-test power to jump discontinuously to `100%` and `solveN` to underestimate `n` at small `df` / strict `α`
- Fix evidence: Fixed at `ad3fe0d0` (`578c480d` tracks `logGodd`/`logGeven` in log space in `src/stats/distributions.ts:408-429`, closing the remaining `mu <= 700` `rxb` underflow)

### #64 [Medium] — Plugin wizard `kind: "text"` questions reject all non-numeric text, and `MarketplaceDialog` pre-checks `"network"` (and all permissions) by default
- Fix evidence: Fixed at `8c877d8` (`src/plugins/analysis-spec.ts:441-456`, `src/components/marketplace-dialog.tsx:75-87`)

### #65 [Low] — UI/menu minor defects (duplicate Grubbs' table, duplicate `Fill Down`, shortcut collision, stale `Change Parameters…`)
- Fix evidence: Fixed at `c54f5954` (`src/views/analyses/analysis-results-view.tsx:748-768` and `src/app-menu.ts:503, 761, 804, 898-900` fix all 4 UI/menu items)

### #66 [Low] — WebR / survival edge cases (`ensurePackages` doubled timeout on claim timeout; `survival-analysis.ts` 2-group HR on `k ≥ 3` and silent `—` on disjoint risk sets)
- Fix evidence: Fixed at `8c877d8` (`src/stats/webr.ts:1040-1042, 1092-1111`, `src/stats/survival/survival-analysis.ts:78-86, 105-110, 153-156`; new WebR P-12 concurrency issues tracked in `#89`, `#90`, `#96`)

### #67 [Low] — [Carryover from Round 1 #28] Pasting wide data into a Nested table silently drops overflow columns without showing the `"Some Values Weren't Pasted"` notice
- Fix evidence: Fixed at `b8a2528` (`src/views/tables/table-data.ts:162-165` now checks `isGrouped(data) || isNested(data)`)

### #68 [High] — `copy_pdf_to_clipboard` puts TWO separate `NSPasteboardItem`s on the macOS clipboard instead of one multi-flavour item
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/main.rs:1081-1094` writes a single multi-flavour `NSPasteboardItem` carrying `com.adobe.pdf`, `public.pdf`, and `public.png`)
- Plane seq 522; fix branch `bugfix/br-68-75-clipboard` @ `04530d2` (fix + pin pushed; Mac live proof owed per STATUS.md).

### #69 [High] — `WhatsNewDialog` auto-closes itself 2 seconds after opening via **Help ▸ What's New**
- Fix evidence: Fixed at `d4b45130` (`src/components/whats-new-dialog.tsx:34, 38-41, 57-63` tracks `autoOpened` so manual Help ▸ What's New skips the 2s auto-close timer)
- Plane seq 523; fix branch `bugfix/br-69-whatsnew` @ `c1646ee` (fix + pin pushed).

### #70 [High] — Independent error-report sharing (`CrashReportDialog` / `try_send_error_entry`) never sends when feedback sharing is off
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:1647-1669` gates `try_send_error_entry` solely on `error_log_sharing_enabled` and posts directly; `src/components/ai-connections-dialog.tsx:174-195, 571-578` adds "Send unsent reports")

### #71 [High] — `StartupGuideDialog`'s `mailto:smit@muse.ai` support link is silently blocked by Tauri's `.on_navigation` policy
- Fix evidence: Fixed at `d4b45130` (`src/components/startup-guide-dialog.tsx:108-129` routes native `mailto:` clicks through `openSupportEmail()`; minor keyboard note: `startup-guide-dialog.tsx:54, 67` still checks only `HTMLButtonElement`/`"button"`, skipping the focused `<a>` on `Enter`/`Tab`)

### #74 [Medium] — macOS native `NSProgressIndicator` spinner overlaps the `Running…` text and `Cancel` button in `AnalysisView`
- Fix evidence: Fixed at `d4b45130` (`src/views/analyses/analysis-view.tsx:45-70` anchors `ref` on a dedicated `h-9 w-9` spacer above text and Cancel)
- Plane seq 533; fix branch `bugfix/br-74-spinner` @ `7a3d1c3` (fix + pin pushed; Mac live proof owed per STATUS.md).

### #75 [Medium] — `copy_pdf_to_clipboard` JXA `if (!pdfData)` / `if (!pngData)` checks are dead code, wiping the user's clipboard on read failure
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/main.rs:1084-1088` checks `pdfData.isNil()` / `pngData.isNil()` before `pb.clearContents`)
- Plane seq 534; fix branch `bugfix/br-68-75-clipboard` @ `04530d2` (fix + pin pushed; Mac live proof owed per STATUS.md).

### #76 [Medium] — `SendFeedbackDialog` and `AiConnectionsDialog` drop server/network errors and falsely claim "Sharing is off", and `mcp_send_feedback` sends `project_file` + `recent_activity` despite promising "Only the text below is ever shared"
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/mcp.rs:1841-1853` `new_ui_feedback_entry` omits `project_file`/`recent_activity`; `src/components/send-feedback-dialog.tsx:72, 101-108` and `src/components/ai-connections-dialog.tsx:160-167` surface `out.error` vs `sharing === "disabled"` accurately)

### #77 [Medium] — `StartupGuideDialog`'s global `window` keydown handler hijacks `Enter` and `Escape` from top-layer `<dialog>` modals (including `SendFeedbackDialog`)
- Fix evidence: Fixed at `d4b45130` (`src/components/startup-guide-dialog.tsx:50-53` ignores events when `dialog[open]`, input/textarea, or outside `panelRef.current`)

### #78 [Medium] — Windowless Help menu exposes **Help ▸ Send Feedback** and **Help ▸ What's New** as enabled dead no-ops
- Fix evidence: Fixed at `d4b45130` (`src/menus.ts:125, 172, 177` and `src/engine.ts:41` pass `hasProjectWindow = false` to disable Send Feedback and What's New when windowless)

### #79 [Medium] — `StartupGuideDialog` auto-show omits `!openedFile.current` and pops over opened `.pzt` templates, Sample Project, and slow/failed file launches
- Fix evidence: Fixed at `d4b45130` (`src/store/use-document.ts:2743-2767` checks `!openedFile.current` and defers while `dialog[open]` is present)

### #80 [Medium] — `noncentralTCdf` (`logWeights` path) silently returns `1.0` when `rxb` underflows at large `df` and still cliffs to `0` past `|δ| > 447`
- Fix evidence: Fixed at `ad3fe0d0` (same `578c480d` log-space increment fix closes the `mu <= 700` limb; extreme `noncentralTChiSquareLimit` regression remains tracked in `#107`)

### #81 [Low] — `send_to_keynote_blocking` / `applescript_number` lacks `.is_finite()` / upper-bound checks and can emit invalid AppleScript `inf` or `0`
- Fix evidence: Fixed at `d4b45130` (`src-tauri/src/main.rs:563-592, 892` adds `check_keynote_image_size` finite `1.0..=1e5` check and clamps `applescript_number`)

### #83 [High] — `formatLabelForPlotly` double-escapes `&`, `<`, `>`, `\^`, `\_` in `buildGraphFigure` and allows HTML-escaping bypass (XSS) via `<sup>`/`<sub>`
- Fix evidence: Fixed at `d4b45130` (`isAlreadyFormatted` at `src/lib/label-format.ts:124-152` validates allowlisted tags and entities, closing both double-escaping and the XSS bypass)

### #84 [High] — `vector-export.ts` `textRuns` splits single-line Plotly `<sup>`/`<sub>` `<text>` into separate lines, breaking `middle`/`end` alignment in PDF/EPS
- Fix evidence: Fixed at `d4b45130` (`startsNewLine` at `src/lib/vector-export.ts:902-907, 923-932` keeps inline `<sup>`/`<sub>` `<tspan>`s on one logical line)

### #85 [High] — `ecAnything` for `homologous-competition-logx` uses inverted `(100 - f) / f`, computing `IC(100-F)` labeled as `IC{F}`
- Fix evidence: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:283` now uses `log10(f/(100-f))` and `tests/checks.ts` pins the corrected expectation)

### #86 [High] — Sign-aware `X = 0` guard `ifelse(HillSlope<0, Top, Bottom)` truncates unshared `Top[g]`/`Bottom[g]` to length 1 in global fits
- Fix evidence: Fixed at `d4b45130` (`src/stats/xy/nonlinear-fit.ts:425, 1390` uses length-preserving arithmetic `Bottom+(Top-Bottom)*ifelse(HillSlope<0,1,0)`)

### #87 [High] — `feedback-server` `DedupeSet` has permanent `in_flight` leak on client disconnect, two-mutex TOCTOU race, and `Notify` lost wakeup
- Fix evidence: Fixed at `d4b45130` (`feedback-server/src/lib.rs:350-478, 775-840` unifies `Mutex<DedupeState>`, adds RAII `InFlightGuard` with `Arc::ptr_eq`, and pre-registers `Pin<Box<OwnedNotified>>` before unlock)

### #88 [High] — `mcp-bridge` `seq 540` session recovery fails on port-change restart, fails on rotated-token restart, and permanently wedges on transient failure
- Fix evidence: Fixed at `d4b45130` (`src-tauri/mcp-bridge/src/main.rs:397-547` reloads discovery on `e.is_connect()`, handles `401` + `404` recovery in either order, and preserves `session_id` until `initialize` + `notifications/initialized` succeed)

### #91 [Medium] — `formatFigureLabels` rewrites `layout.annotations[i].name`, breaking point-label drag repositioning and leaking phantom keys into `graphOptions.points`
- Fix evidence: Fixed at `d4b45130` (`formatValue` at `src/lib/label-format.ts:224-248` leaves `annotation.name` untouched)

### #92 [Medium] — `buildGroupedBars` breaks `groupLayout: "superimposed"` when `showPoints: true`, misaligning bars with significance overlays
- Fix evidence: Fixed at `d4b45130` (`src/views/graphs/grouped-common.ts:82-109, 144, 160-194` keeps `superimposed` bars row-centered via `superimposedPositions` with `showPoints: true`)

### #93 [Medium] — `TiterMcpServer::get_info()` never advertises `capabilities.tools.listChanged: true` and `mcp_set_enabled(false)` never clears `inner.peers`
- Fix evidence: Fixed at `d4b45130` (`TiterMcpServer::get_info()` at `src-tauri/src/mcp.rs:10215-10221` calls `.enable_tool_list_changed()`; `McpState::disable_server()` at `:456-461, 1109` clears `inner.peers`)

### #94 [Medium] — `reapply_antigravity_entry_if_connected` silently overwrites custom/remote `"titer"` entries in `~/.gemini/config/mcp_config.json` on every launch
- Fix evidence: Fixed at `d4b45130` (`antigravity_entry_needs_reapply` at `src-tauri/src/mcp.rs:2628-2692` checks `existing["command"] == bridge` before overwriting; minor note: `state.ensure_dir(app)` at `:2679` still runs before that check when a remote/custom `"titer"` entry exists)

### #96 [Medium] — `webr.ts` `resolveInEngine` fires an unconditional `releaseClaimCode(pending)` on claim timeout (`codes === null`), risking wiping another window's live claim
- Fix evidence: Fixed at `d4b45130` (`src/stats/webr.ts:875-891, 969` uses conditional token release on timeout)

### #97 [Low] — `labelRuns` splits Unicode minus (`10^−6` → `10<sup>−</sup>6`) and collapses consecutive `_` runs (`ctrl_1_a` → `ctrl<sub>1a</sub>`)
- Fix evidence: Fixed at `d4b45130` (`src/lib/label-format.ts:49, 85` supports Unicode minus `U+2212` and only coalesces `"normal"` runs)

### #102 [High] — `2db68ed1` ANOVA 13-digit centering missed `TukeyHSD` (making Tukey P values contradict centered Tukey CIs), plus Welch, Brown-Forsythe, linear trend, and post-hoc diffs
- Fix evidence: Fixed at `c54f5954` (`src/stats/column/anova.ts` and `src/stats/column/base.ts` center `TukeyHSD`, Welch, Brown-Forsythe, linear trend, lognormal `exp(m+mean(v))`, and `describe` diffs)
- Plane seq 574; folded into the 2.0.4 batch coordinator's Welch/Brown-Forsythe lanes (scope expansion, no separate branch) per STATUS-98-111.md.

### #104 [Medium] — `valueXAxis` drops `options.gridX`, silently disabling X gridlines on Connected Lines with `rowsAt: "values"`
- Fix evidence: Fixed at `c54f5954` (`src/views/graphs/plot-helpers.ts` `valueXAxis` now forwards `options.gridX` to `axisChrome` and `xAxisRange`)
- Plane seq 576; fix branch `bugfix/br-104-110-graph-helpers` @ `f853d1e4` (fix + pins pushed).

### #106 [Medium] — `clipboard_text` (macOS) passes unchecked nullable `UTF8String` pointer to `CStr::from_ptr` in `unsafe`
- Fix evidence: Fixed at `c54f5954` (`src-tauri/src/main.rs:1679-1684` `utf8_ptr_to_string` guards `ptr.is_null()` before `CStr::from_ptr`)
- Plane seq 578; fix branch `bugfix/br-98-106-109-open-file-safety` @ `c4d9f219` (gate GREEN incl. Mac cargo verdict 149/0/1).

### #109 [Low] — `openSourceFile` discards the specific Rust error string returned by `open_file`
- Fix evidence: Fixed at `c54f5954` (`invokeErrorMessage` in `src/lib/invoke-error.ts:5-6` preserves plain Tauri string rejections in `src/views/tables/import-dialog.tsx:263-271`)
- Plane seq 581; fix branch `bugfix/br-98-106-109-open-file-safety` @ `c4d9f219` (pin + gate GREEN).

### #111 [Low] — `fitted-curve.ts` `x === 0` guard misses 4 other R-guarded raw-X ratio models and `asymmetric-5pl-x` underflow at tiny `HillSlope`
- Fix evidence: Fixed at `c54f5954` (`src/views/graphs/fitted-curve.ts` adds unconditional `x === 0` limits for all 8 raw-X ratio models matching R `nonlinear-fit.ts`; `b4f6bc07` at `ad3fe0d0` also adds NaN-safe `x === 0` guards for `biphasic-x` and `bell-shaped-x`)
- Plane seq 583; fix branch `bugfix/br-111-fitted-curve-x0` @ `69efe270` (scoped gate GREEN); residual NaN-safe guard cleaned up in `b4f6bc07` (`bugfix/br-111-biphasic-bell-x0`, merged in 2.0.6 per sweep cycle 53).

### #112 [High] — Two-way ANOVA `runPosthoc` still computes uncentered `mean(a) - mean(b)` at `1e13` scale
- Fix evidence: Fixed at `ad3fe0d0` (`f511dd4e` shifts each post-hoc pair by `m0 <- a[1]` in `src/stats/grouped/two-way-anova.ts:309, 330`; note the Games–Howell cross-scale variance regression introduced by `f511dd4e` is tracked as new Issue `#120`)
- Plane seq 584 (UUID 869313bc-94da-44f8-9170-8e4b8836c640); fix branch `bugfix/br-112-two-way-posthoc-center` @ `73527ccc` (scoped gate GREEN, 1256/1256).

### #113 [High] — Three-way ANOVA `runPosthoc` computes uncentered `diff` and single-pass TS Games–Howell `variance()` at `1e13` scale
- Fix evidence: Fixed at `ad3fe0d0` (`2aecd342` centers `diff` on `vi[0]` and independently double-centers each cell inside `variance()` in `src/stats/grouped/three-way-anova.ts:143-144, 273-277`)
- Plane seq 585 (UUID 8e32df4f-ea43-47c3-a9e5-f235d8c2b862); fix branch `bugfix/br-113-three-way-posthoc-center` @ `2aecd342` (scoped gate GREEN, 1256/1256).

### #114 [Medium] — Nested ANOVA post-hoc `diff` still subtracts raw uncentered `described[i].mean - described[j].mean`
- Fix evidence: Fixed at `ad3fe0d0` (`28097a4c` passes `pairIndices(groups.length)` to `describe()` and uses centered `diff(i, j)` in `src/stats/nested/nested-anova.ts:90-97`)
- Plane seq 586 (UUID 61315698-8ab8-4c2c-bc8e-322963cd14b5); fix branch `bugfix/br-114-nested-posthoc-diff` @ `28097a4c` (scoped gate GREEN, 1256/1256).

### #115 [Medium] — Deming regression TS `olsFit` (for `notes()`) and `demingProblem` still use single-pass uncentered sums
- Fix evidence: Fixed at `ad3fe0d0` (`9e3ee30d` double-centers TS `olsFit` and `demingProblem` against `xs[0]`/`ys[0]` in `src/stats/xy/deming-regression.ts:44-95`)
- Plane seq 587 (UUID 8f7ab6cf-b9d5-44bf-b328-937e193efb9c); fix branch `bugfix/br-115-deming-ts-center` @ `9e3ee30` (scoped gate GREEN, 1256/1256).

## Verification (run before commit)

- Zero `[FIXED]` headings, zero `| Fixed |` summary rows, zero `**Status**: Fixed` lines remain in the file.
- Summary table and detail sections agree: 69 rows / 69 headings, same numbers, statuses Partial 38 / New 30 / Open 1, severities High 40 / Medium 26 / Low 3.
- Active entries before vs after: identical 69-entry set, severities and statuses unchanged; removed set equals exactly the original 76-entry Fixed set.
- No consecutive `---` separators; no empty `##` section headings remain; file ends cleanly after Issue #145.
