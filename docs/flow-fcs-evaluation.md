# flow-fcs 0.6.0 evaluation — FCS reader for Titer's FlowJo track (seq 440)

**Date:** 2026-11-24 · **Lane:** F0 (evaluation only, not a reader build) ·
**Worktree:** `flow/f0-eval-flow-fcs` · **Corpus:** `~/workspace/.helix-flowjo/corpus/`
(shared, not committed) + committed fixtures under `tests/testdata/fcs/`

## Verdict: ADOPT

Adopt `flow-fcs` 0.6.0 (MIT) as Titer's FCS reader, wired in as a Rust
dependency with the `compensation` feature, behind the FlowJo opt-in toggle
(off by default). The crate parses 22 of 30 staged corpus entries
correctly — including all big-endian files, the `$SPILLOVER` matrix, and
compensation verified numerically — and its gaps are bounded, documented
below, and workable around in Phase 1. One gap is severe enough to need a
Phase 1 guard (condition 6): the crate trusts non-zero HEADER DATA
offsets blindly and silently returns garbage values when they disagree
with TEXT. None of the gaps justifies a from-scratch reader.

**Conditions of the ADOPT (all recorded here so Phase 1 inherits them):**

1. **Logicle is NOT FlowJo-equivalent — do not use the crate's biexponential
   for display or gating.** Its `Biexponential` is closed-form arcsinh with
   the `width` parameter accepted and then ignored; it equals the Parks
   logicle with W=0 to machine precision and diverges from the true W=0.5
   logicle by up to 0.25 of the display scale near zero (see §9). Phase 2
   must implement the real Parks/Moore logicle (GatingML 2.0 definition)
   itself. The crate's arcsinh and compensation paths are unaffected.
2. **Work around the `.fcs` extension gate.** `Fcs::open` rejects files
   whose name does not end in `.fcs` — real files arrive as `.LMD`,
   `.B08`, extensionless, etc. Phase 1 must copy/symlink to a `.fcs` name
   (or use the crate's lower-level parse entry points) before opening.
3. **Expect rejects on 24-bit int, 8-bit int, 64-bit int, and ASCII data.**
   The byte-aligned decoder only supports I16/I32/F32/F64. These are rare
   in the wild (no such file in the 21-file corpus), but Phase 1 must
   surface a clear "unsupported $DATATYPE/$PnB" error, not a crash.
4. **Budget the dependency weight.** The crate pulls Polars 0.54.4 and
   ~194 crates Titer does not have today. That is the price of the
   adoption; it lands in the app binary and in every clean build.
   Do not enable `specta`/`typescript` until a lane actually needs them.
5. **Short `$BYTEORD` forms fail.** `$BYTEORD "1,2"` (16-bit form, as in
   the real `coulter.lmd`) does not parse as a byte order (see §3).
   Phase 1 should normalise `"1,2"` → little-endian / `"2,1"` →
   big-endian before opening, or upstream a fix.
6. **Pre-validate HEADER-vs-TEXT DATA offsets before opening — the
   crate silently misreads when they disagree.** `resolve_segment_offsets`
   falls back to TEXT `$BEGINDATA`/`$ENDDATA` only when the HEADER
   offsets are exactly 0; a non-zero wrong HEADER start is trusted
   blindly. Verified: `data_start_offset_discrepancy_example.fcs`
   (HEADER start 5555, inside TEXT; TEXT says 6081) opens "successfully"
   with every value wrong — first event reads 12332 (= ASCII `'0'`
   bytes from TEXT) instead of the true 49135. Phase 1 must compare
   HEADER DATA start/end against TEXT `$BEGINDATA`/`$ENDDATA` and
   refuse (clear error) any file where they disagree, rather than
   trusting the crate's silent result. The same guard also covers the
   end-offset case, where the crate currently fails closed
   (`data_stop_…`: "Data end offset 6944 is beyond mmap length 6263").

## What was evaluated

| Fact | Value |
|---|---|
| Crate | `flow-fcs` 0.6.0, published 2026-11-03 (crates.io) |
| Licence | MIT (Cargo.toml + docs.rs badge; no licence file field in the crates.io API record) |
| Source | `jrmoynihan/flow` monorepo, `fcs/` crate (docs.rs badge points at the old `jrmoynihan/flow-fcs` path, which 404s — the repo moved into the monorepo) |
| Maturity | 10 releases since 2026-01-07; 1,611 total downloads, 429 in the last 30 days (crates.io API, 2026-11-24). Young and lightly adopted — pin the exact version (`=0.6.0`) and re-evaluate on upgrade. |
| Engine | mmap + Polars 0.54.4 DataFrame, Rayon, faer via `flow-linalg`; `compensation`, `compress`, `blas`, `typescript` (ts-rs), `specta`, `parquet-sidecar` optional features |
| Tests in-crate | 20 (tests.rs) + 59 (keyword) + 14 (file.rs) unit tests; the real-file corpus (Gating-ML compliance files) lives in the monorepo `gates/` dir and is NOT shipped in the published crate — its tests build synthetic FCS bytes in-memory instead |
| Fetch check | `cargo fetch` of 0.6.0 + deps works through the Hatch egress proxy; `static.crates.io` download works (421,508 bytes). crates.io API needs a User-Agent (bare curl gets 403). |

## Corpus

Public files only. Downloaded 2026-11-24 from the GitHub repos named;
sizes verified against the GitHub API listing. Full manifest with URLs:
`~/workspace/.helix-flowjo/corpus/MANIFEST.json`.

| File | Ver | $PAR | $TOT | $BYTEORD | $DATATYPE | Notes |
|---|---|---|---|---|---|---|
| `fcs2_int16_13367ev_8par_GvHD.fcs` | 2.0 | 8 | 13,367 | 4,3,2,1 | I16 | Gating-ML compliance |
| `fcs2_int16_50000ev_8par_random.fcs` | 2.0 | 8 | 50,000 | 4,3,2,1 | I16 | Gating-ML compliance |
| `int-10000_events_random.fcs` | 3.0 | 6 | 10,000 | 4,3,2,1 | I32 | Gating-ML compliance |
| `int-10_events_6_parameters.fcs` | 3.0 | 6 | 10 | 4,3,2,1 | I16 | **Committed smoke fixture** |
| `int-10_events_8_parameters.fcs` | 3.0 | 8 | 10 | 4,3,2,1 | I16 | Gating-ML compliance |
| `int-15_scatter_events.fcs` | 2.0 | 2 | 15 | 4,3,2,1 | I16 | Gating-ML compliance |
| `int-gating_test_file.fcs` | 3.0 | 2 | 1 | 4,3,2,1 | I16 | Committed fixture |
| `int-gating_test_file_4D.fcs` | 3.0 | 4 | 1 | 4,3,2,1 | I16 | Gating-ML compliance |
| `int-homogenous_matrix.fcs` | 2.0 | 2 | 1,250 | 4,3,2,1 | I16 | Gating-ML compliance |
| `real-8-parameters.data.fcs` | 2.0 | 8 | 7,605 | 4,3,2,1 | I16 | Gating-ML compliance |
| `0877408774.B08` | 2.0 | 8 | 10,000 | 4,3,2,1 | I16 | flowCore extdata; **no `.fcs` extension** |
| `100715.fcs` | 2.0 | 16 | 65,016 | 4,3,2,1 | F32 | FlowKit; 4.2 MB, largest real file |
| `3FITC_4PE_004.fcs` | 2.0 | 4 | 94,569 | 1,2,3,4 | I16 | flowio |
| `G11.fcs` | 3.1 | 12 | 5,785 | 1,2,3,4 | F32 | flowio; **`$SPILLOVER` 5×5** |
| `data1.fcs` | 2.0 | 8 | 13,367 | 4,3,2,1 | I16 | flowio (same bytes as the GvHD file) |
| `variable_int_example.fcs` | 3.0 | 26 | 2 | 1,2,3,4 | I16 | flowio; tiny synthetic, $TOT 2 |
| `test_data_2d_01.fcs` | 3.1 | 2 | 10,000 | 1,2,3,4 | F32 | FlowKit |
| `test_comp_example.fcs` | 3.0 | 18 | 10,703 | 4,3,2,1 | F32 | FlowKit; legacy bare `SPILL` (no `$`) — **not recognised** (see §6); `APPLY COMPENSATION=TRUE` |
| `coulter.lmd` | 2.0 | 8 | 18,110 | **`1,2`** | I16 | FlowKit/flowio; **`.lmd`, `$NEXTDATA` 363602**, backslash delimiter; **fails to open — blank ANALYSIS offsets (§5) then `$BYTEORD "1,2"` (§3)** |
| `data_start_offset_discrepancy_example.fcs` | 3.0 | 26 | 2 | 1,2,3,4 | I16 | FlowKit noncompliant; HEADER vs TEXT DATA start disagree — **SILENTLY MISREADS (see condition 6)** |
| `data_stop_offset_discrepancy_example.fcs` | 3.0 | 26 | 2 | 1,2,3,4 | I16 | FlowKit noncompliant; HEADER vs TEXT DATA end disagree — fails closed ("Data end offset 6944 is beyond mmap length 6263") |

Synthetic files (hand-built per the FCS 3.x layout in
`~/workspace/.helix-flowjo/eval/make_synth.py`, for edges the public
corpus lacks):

| File | Purpose |
|---|---|
| `synth-f64.fcs` | $DATATYPE D (float64), 2 params, 5 events, LE |
| `synth-i24.fcs` | $PnB 24 integer, 2 params, 4 events — expect reject |
| `synth-ascii.fcs` | $DATATYPE A (ASCII) — expect reject (documented intentional) |
| `synth-spill.fcs` | $SPILLOVER 3×3, F32 LE, 3 params, 4 events — **committed fixture** |
| `synth-64bit-offset.fcs` | Real 10-event file with HEADER DATA offsets zeroed — TEXT `$BEGINDATA`/`$ENDDATA` must carry it |
| `synth-be-f32.fcs` | Big-endian float32, 2 params, 4 events |

**Coverage gaps in the corpus (no public file found):** no FCS 3.2 file
(3.2 is mostly keyword refinements; the crate claims 3.2 and its
conformance module keys rules per version); no file over 100 MB, so the
true >99,999,999-byte offset path is exercised only by the synthetic
zeroed-HEADER file; no $DATATYPE D file in the wild (synthetic covers
it); no histogram-mode ($MODE C) file; no 8/24/64-bit int file in the
wild (synthetic 24-bit covers the reject path).

## Harness results

Probe harness: a scratch crate depending on `flow-fcs =0.6.0` with the
`compensation` feature (`~/workspace/.helix-flowjo/eval/harness/`,
not committed). It calls `Fcs::open` / `Fcs::open_all` per file and
reports $PAR, $TOT, parameter names, decoded event count, first event
value, spillover matrix, and `apply_file_compensation`.

<!-- HARNESS-RESULTS: filled in after the probe run — 2026-11-24, lean profile build -->

**Result: 23 of 30 staged entries open; 7 fail with clear errors; 1 of the
23 "opens" is a silent misread — so 22 fully correct opens.** Staged
entries = 21 real + 6 synthetic files, plus `.fcs` copies of the two
non-`.fcs` names (`0877408774.B08`, `coulter.lmd`) and one hand-fixed
coulter variant (`coulter-fixed.fcs`, ANALYSIS offsets zeroed to isolate
the `$BYTEORD` question). Full raw output:
`~/workspace/.helix-flowjo/eval/probe-results.txt`.

| Outcome | Count | Files |
|---|---|---|
| Open, $PAR/$TOT/df_events agree, first value matches an independent Python decode of the file bytes | 22 | All 10 Gating-ML files, `100715.fcs`, `3FITC_4PE_004.fcs`, `G11.fcs`, `data1.fcs`, `variable_int_example.fcs`, `test_data_2d_01.fcs`, `test_comp_example.fcs`, `0877408774.fcs` (copy), `synth-f64.fcs`, `synth-be-f32.fcs`, `synth-spill.fcs`, `synth-64bit-offset.fcs` |
| Open, **values silently wrong** | 1 | `data_start_offset_discrepancy_example.fcs` — HEADER DATA start 5555 (inside TEXT) trusted over TEXT `$BEGINDATA` 6081; first event reads 12332 (ASCII `'0'` bytes) instead of the true 49135, which the agreeing `variable_int_example.fcs` file returns. $PAR/$TOT/event count all look fine — only a value-level cross-check catches it. See condition 6. |
| Fail, clear error | 7 | `0877408774.B08` + `coulter.lmd` — extension gate ("Invalid file extension: B08/lmd"); `coulter.fcs` — "cannot parse integer from empty string" (blank ANALYSIS offsets, §5); `coulter-fixed.fcs` — "missing 1 required keyword(s): $BYTEORD" (`"1,2"` unparseable, §3); `data_stop_offset_discrepancy_example.fcs` — "Data end offset 6944 is beyond mmap length 6263" (HEADER end trusted over TEXT, §5); `synth-ascii.fcs` — "missing 1 required keyword(s): $DATATYPE"; `synth-i24.fcs` — "Unsupported uniform data type: I with 3 bytes" |

**Independently verified values (Python decode of the raw bytes, same
files):** `fcs2_int16_50000ev_8par_random.fcs` FSC[0]=634 (BE I16) ✓;
`100715.fcs` FSC-A[0]=27700.75 (BE F32) ✓; `G11.fcs` Time[0]=14.0 ✓;
`variable_int_example.fcs` FSC LogH[0]=49135 ✓; `synth-spill.fcs`
compensation first value 87.60202 vs Python `inv(spill) @ raw` = 87.602
✓ (G11 compensated Time stays 14.0 — Time is not a spill channel ✓).
Every open file also returned `open_all` datasets=1 — no multi-dataset
file in the corpus opens, so the `$NEXTDATA` walk is **not** empirically
verified (see §4).

**Spillover:** `G11.fcs` `$SPILLOVER` 5×5 → comp-ok 5785×12;
`synth-spill.fcs` `$SPILLOVER` 3×3 → comp-ok 4×3.
`test_comp_example.fcs` (bare `SPILL`, no `$`) → **no-spill** — the
crate only looks up `$SPILLOVER`/`$SPILL`/`$COMP` (with `$`), so the
bare legacy spelling is missed (see §6). No `$COMP` file exists in the
corpus.

**Logicle (harness `logicle` mode, runtime — confirms §9):**
`Biexponential` values match the Python reference exactly (x=100 →
2.496957; x=262144 → 10.361633); width is provably ignored at runtime
(w=0.1/0.5/2.0 all → 2.496957 at x=100); forward/inverse round-trip is
exact (100 → 100.0, 262144 → 262144.0).

**Build cost (verdict-relevant):** the harness crate took **34 min 24 s**
at `CARGO_BUILD_JOBS=1` on this 1.5-CPU / ~6 GB box with a lean
`[profile.dev] opt-level = 0, debug = 0`. The default dev profile
(opt-level=1, debuginfo=2) OOM-killed `polars-core` codegen twice
(kernel SIGKILL) and two container replacements interrupted the build;
a 4 GB swapfile was not creatable (`swapon`: Operation not permitted).
Clean-build cost of this dependency is therefore ~35 min single-job on
this hardware — budget it in CI and in Phase 1 planning.

## Criterion findings

### 1. FCS 2.0–3.2 coverage — PASS (with a 3.2 caveat)
Versions 1.0–4.0 are accepted by the header parser (`src/header.rs`,
`check_fcs_version`). The corpus covers 2.0 (10 files), 3.0 (9), 3.1 (2);
22 of the 23 files that open decode correctly (see harness table — the
23rd is the silent-misread `data_start_…` file, and `coulter.lmd` fails
before version handling matters). No real 3.2 file was found in the public
sources tried; 3.2 support is code-claimed only. The write path's
conformance module (`src/conformance.rs`) is explicitly write-path-only —
the reader stays deliberately permissive about version violations, which
is the right call for vendor files.

### 2. 64-bit / large-file offsets — PASS (synthetic)
HEADER fields cap at 99,999,999; `resolve_segment_offsets`
(`src/file.rs:342`) falls back to TEXT `$BEGINDATA`/`$ENDDATA` **only
when the HEADER DATA offsets are exactly zero**, and
`find_begindata_offset` re-scans TEXT for chained datasets. Verified with
`synth-64bit-offset.fcs` (harness table). **But a non-zero wrong HEADER
offset is trusted blindly** — `data_start_…` proves it (see condition 6).
No >100 MB real file exists in the public corpus, so the true
large-file path is proven only by construction, not by a real file.

### 3. Endianness — PASS for the two standard forms, FAIL for short forms
`$BYTEORD "1,2,3,4"` / `"4,3,2,1"` are handled throughout, including the
column decoder (`src/decode.rs`: U16/U32/F32/F64 × LE/BE) and the
round-trip writer (0.6.0 fixed a bug where writing invented
little-endian when `$BYTEORD` was missing). 11 of 21 corpus files are
big-endian and all decoded. **Gap:** the short forms `"1,2"` / `"2,1"`
(legal for 16-bit data) are rejected by `ByteOrder::from_keyword_str`
and fall back to `StringKeyword::Other`, so `coulter.lmd` (real file,
`$BYTEORD "1,2"`) fails to open — proven by `coulter-fixed.fcs`
(ANALYSIS offsets zeroed, so the header parses, and the file then
fails on `$BYTEORD` alone: "missing 1 required keyword(s): $BYTEORD").
Note the un-fixed file fails even earlier, on its blank ANALYSIS
offsets (§5). Condition 5 of the verdict covers this.

### 4. $NEXTDATA — NOT VERIFIED empirically (code only)
`Fcs::open_all` (`src/file.rs:748`) walks the chain with loop detection
and per-dataset CRC scoping; `open` reads the first dataset only.
`coulter.lmd` is the only file in the corpus carrying `$NEXTDATA`
(363602, a second dataset at byte 363,602 of 944,166) — and it fails to
open before the walk (blank ANALYSIS offsets, then `$BYTEORD "1,2"`),
so no multi-dataset open was observed. Every file that did open
returned `open_all` datasets=1. The walk is source-plausible but
**unproven**; Phase 1 needs a real multi-dataset file on its shopping
list and must re-run the harness against it before relying on
`open_all`.

### 5. Non-conformant files — MIXED: tolerant where it warns, unsafe where it trusts
The reader is built for the 211,359-file reality: TEXT parsing has a
C1 fallback that re-parses with `Escaping::None` when an empty keyword
value welds two standard keywords together (CHANGELOG 0.6.0, and the
`find_begindata_offset` fallback for the same welding ahead of
`$BEGINDATA`); `$TOT` vs decoded-count mismatches only warn at debug
level (`src/file.rs:875`); CRC conflicts only warn under `open()`
(`open_verified()` refuses); unknown keywords land in
`StringKeyword::Other` instead of failing. But the two FlowKit
offset-discrepancy files expose the unsafe side:

- **DATA start disagreement → silent misread, not a failure.**
  `data_start_…` (HEADER start 5555 vs TEXT 6081) opens with every
  value wrong (see condition 6 / harness table). This is the one
  finding that changes Phase 1's shape: Titer must pre-validate
  HEADER-vs-TEXT offsets and refuse on disagreement.
- **DATA end disagreement → fails closed.** `data_stop_…` (HEADER end
  6944 vs TEXT 6188, file length 6263): "Data end offset 6944 is
  beyond mmap length 6263". Safe, but it means a file flowio reads
  fine (it trusts TEXT) is unreadable here.
- **Blank ANALYSIS offsets → hard fail.** `coulter.lmd` writes its
  unused ANALYSIS fields as spaces, which FCS §3.8 explicitly allows
  ("fills unused HEADER space with ASCII spaces"); `Header` parsing
  does `trim().parse::<usize>()` on the empty field and errors
  ("cannot parse integer from empty string"). A whole class of real
  FCS 2.0 files — no ANALYSIS segment, space-filled — is rejected
  before TEXT is ever read. (The `$BYTEORD "1,2"` failure in the same
  file is a second, independent failure — proven by `coulter-fixed.fcs`.)

### 6. $SPILL / $SPILLOVER parsing — PASS for `$`-prefixed keys, FAIL for bare `SPILL`
`get_spillover_matrix` (`src/file.rs:2553`) checks `$SPILLOVER` first,
then `$SPILL`, then `$COMP`, and also handles the matrix stored as an
untyped string. `G11.fcs` (`$SPILLOVER` 5×5) yielded a matrix and
`apply_file_compensation` (feature `compensation`) applied it
(5785×12, numerically verified — see harness table).
`synth-spill.fcs` pins the path in the committed fixtures. **But the
legacy bare `SPILL` (no `$`, as in `test_comp_example.fcs`, 14
channels) is NOT looked up** — only the three `$`-prefixed keys are —
so that file reports no-spill and `apply_file_compensation` has nothing
to apply, despite `APPLY COMPENSATION=TRUE` in its TEXT. Phase 1 must
normalise a bare `SPILL` keyword to `$SPILL` (or handle it in its own
compensation path) before opening. No `$COMP` file exists in the corpus,
so that spelling is code-only. Sparse height-vs-area matrices are not
specially handled — the crate applies whatever matrix the file carries,
which matches the FCS 3.1 guidance (readers must make no assumptions
about measurement types).

### 7. $PnB / $PnE / $DATATYPE handling — PASS with bounded rejects
- `$DATATYPE`: I/F/D supported; **A (ASCII) intentionally unsupported**
  (`src/datatype.rs` — "deliberate decision, not a gap", citing
  vendor disagreement; the writer-side reference is `flow-crates-ee0`).
- `$PnB`: byte-aligned decoder supports **I16, I32, F32, F64 only**
  (`src/decode.rs::Decoder::resolve`). **I8 (1 byte), I24 (3 bytes) and
  I64 (8 bytes) are rejected** ("Unsupported integer size"). Bit-packed
  widths (bits % 8 != 0) take a separate MSB-first path
  (`src/columns.rs::read_msb_bits`). `$PnR` range masks are applied
  (`apply_range_mask`). Verified with `synth-i24.fcs` (reject) and
  `synth-f64.fcs` (accept).
- `$PnE`: parsed per parameter; amplification type is metadata, not a
  decode input.
- `$MODE`: parsed but never validated — a histogram-mode (`C`) file
  would be decoded as list mode. No such file in the corpus; untested.
- Supplemental TEXT (`$BEGINSTEXT`/`$ENDSTEXT`): no read-path handling
  found — supplemental keywords are ignored on read. Rare; noted, not
  blocking.

### 8. Maturity and licence — ACCEPTABLE, pin the version
MIT, 10 releases in 10 months, latest 0.6.0 (2026-11-03), 1,611 total
downloads — a young, small-adoption crate, but actively developed
(0.6.0 is three weeks old) with a real monorepo, changelog discipline,
and an unusually careful codebase (doc comments cite spec sections,
e.g. §3.6 OTHER segments, §3.7 CRC, §3.3.31 `$NEXTDATA`). The
`docs.rs` repository badge still points at the dead
`github.com/jrmoynihan/flow-fcs` path; the live repo is
`github.com/jrmoynihan/flow` (monorepo, MIT, pushed 2026-11-12).
**Pin `=0.6.0`** in Cargo.toml; treat upgrades as a re-evaluation,
not a bump.

### 9. Logicle / biexponential vs FlowJo — KNOWN GAP (does not block ADOPT)
The crate ships `TransformType::Biexponential` ("matching FlowJo
defaults", T=262144, M=4.5, A=0, W=0.5) and
`apply_default_biexponential_transform`. **The `width` field is accepted
and then ignored** (`src/transform.rs`: `width: _` in both `transform`
and `inverse_transform`); the formula is closed-form
`asinh(x·sinh(M·ln10)/T) + A·ln10`. Verified two ways:

- **Against the reference Parks/Moore logicle** (GatingML 2.0
  definition: `logicle(x,T,W,M,A) = root(B(y) − x)` with
  `B(y) = a·e^{by} − c·e^{−dy} − f`; reference implemented in
  `~/workspace/.helix-flowjo/eval/logicle_ref.py`): flow-fcs ÷
  `(M+A)·ln10` equals the GatingML logicle with **W=0 to 5.6e-17**
  (machine precision) — i.e. it *is* arcsinh, and the Stanford
  transform reference confirms `Arcsinh(T,M,A) ≡ Logicle(T,0,M,A)`.
- **Against the true W=0.5 logicle** (the FlowJo/flowCore default),
  same T/M/A: the difference reaches **0.25 of the [0,1] display scale**
  near zero (x=−100: −0.248; x=0: −0.111; x=−1000: −0.112) and only
  drops below 0.001 for x ≥ 10,000. The near-zero region — negative
  populations, dim cells, the exact region logicle exists for — is
  where it is wrong.

So the crate's "biexponential" is usable as an arcsinh-like display
scale, but it is **not** FlowJo's biex and must never be presented as
bit-exact. Phase 2 needs its own Parks logicle (root-finding
implementation, per GatingML 2.0), differentially tested against
FlowKit/flowCore output — not against this crate. This gap does not
block ADOPT because transforms are separable from reading: the reader
(the thing being adopted) is sound; the transform is a later lane's
work either way, and adopting the crate does not lock Titer into its
biexponential.

What could NOT be checked without FlowJo itself: bit-exactness of any
implementation against FlowJo's own biex numbers, and FlowJo's
4096-binned statistics behaviour. Both need Mansi's files + FlowJo
output with her say-so (see the scope doc's questions for Mansi) and
are Phase 2/3 work, not this evaluation.

### 10. Dependency weight — COST, accepted
`flow-fcs` 0.6.0 with `compensation` resolves to 478 packages in a
scratch lockfile; **194 of them are new to Titer** (Titer's lockfile has
432 today) — essentially the whole Polars 0.54.4 tree (26 `polars-*`
crates + arrow/parquet/ipc/streaming), faer, `flow-linalg`, regex,
chrono. The event store wants f32 columns, and the crate's API is
Polars-centric (`EventDataFrame` is a Polars DataFrame), so Polars
cannot be trimmed away without forking the crate. The cost is build
time on clean builds and binary size; it does not change the runtime
shape (mmap + zero-copy slices fit the event-store plan). **Measured
build cost: 34 min 24 s at `CARGO_BUILD_JOBS=1` on this box with a
lean dev profile (opt-level=0, debug=0); the default dev profile
OOM-killed `polars-core` codegen twice.** Do not enable
`specta`/`typescript`/`parquet-sidecar`/`compress`/`blas` until a lane
needs them — each adds more tree.

### 11. API fit for Titer — GOOD
- `Fcs::open` / `open_all` / `open_verified`, `get_parameter_events_slice`
  (zero-copy `&[f32]` per channel — the shape the event store wants),
  `get_xy_pairs`, `read_selected_rows_into` + `FcsRowSource` /
  `FcsFloatRowSink` (bounded chunk reads without materialising a
  DataFrame — added in 0.6.0), `get_spillover_matrix`,
  `apply_file_compensation`, write paths with CRC policy.
- `specta` and `typescript` features exist for the Tauri/MCP surface
  (not enabled in this evaluation; Titer uses neither tauri-specta nor
  ts-rs today).
- The `.fcs` extension gate (condition 2) is the one API wart: there is
  no public `open` that takes bytes or an arbitrary path. Phase 1 works
  around it with a `.fcs` copy/symlink.
- The crate is edition 2024, Rust 1.99 here; it builds through the
  Hatch proxy (`cargo fetch` clean).

## Gaps Phase 1 must handle (checklist)

- [ ] `.fcs` extension gate: stage non-`.fcs` files under a `.fcs` name.
- [ ] `$BYTEORD "1,2"` / `"2,1"`: normalise to LE/BE before opening.
- [ ] **HEADER-vs-TEXT DATA offsets: pre-validate and refuse on
      disagreement — the crate silently misreads (condition 6).**
- [ ] **Blank ANALYSIS offsets (space-filled HEADER): fails header
      parse — normalise spaces to `0` before opening, or upstream a fix.**
- [ ] **Bare `SPILL` (no `$`): normalise to `$SPILL` before opening,
      or apply compensation in Titer's own path.**
- [ ] 24/8/64-bit int + ASCII data: clear user-facing "unsupported"
      error (do not crash, do not silently misread).
- [ ] No FCS 3.2 real file in corpus: keep a 3.2 fixture on the
      Phase 1 shopping list; re-run the harness when one is found.
- [ ] No multi-dataset (`$NEXTDATA`) file that opens: keep one on the
      shopping list; `open_all` is unproven until then.
- [ ] No >100 MB real file: same — the 64-bit path is proven only
      synthetically so far.
- [ ] Logicle: do not use the crate's biexponential; Phase 2 owns the
      real Parks logicle.
- [ ] Pin `=0.6.0`; re-evaluate on any upgrade.

## Smoke-parse expectations (pinned by `flow-f0` in tests/checks.ts)

int-10_events_6_parameters.fcs: FCS3.0, $PAR 6, $TOT 10, params AS/BS/CS/DS/ES/FS
int-gating_test_file.fcs: FCS3.0, $PAR 2, $TOT 1, params FS/SS
synth-spill.fcs: FCS3.1, $PAR 3, $TOT 4, params FL1-A/FL2-A/FL3-A, $SPILLOVER 3x3

The Rust smoke test (`src-tauri/src/flow.rs`, `#[cfg(test)]`) opens the
primary fixture through `flow-fcs` and asserts $PAR/$TOT/parameter
names; the TS pin re-derives the same numbers from the fixture bytes
and requires this doc to record them.

## What was NOT checked

- No FlowJo install, no Mansi files (never contacted; her files are not
  test material). Bit-exact logicle/stats parity vs FlowJo is therefore
  untested by design — see §9.
- No FCS 3.2, histogram-mode, or >100 MB real file (see coverage gaps).
- **No multi-dataset (`$NEXTDATA`) file that opens** — the only one
  (`coulter.lmd`) fails earlier; `open_all` is code-only (see §4).
- **No `$COMP` file** — that spillover spelling is code-only (see §6).
- `flow-gates` / `flow-plots` / `flow-tru-ols` evaluation — the
  gating, plotting, and spectral-unmixing siblings are separate lanes'
  decisions; this verdict covers the reader only.
- `specta`/`typescript` features were not compiled or exercised.
- The crate's own Gating-ML corpus tests were not run (the corpus is in
  the monorepo, not the published crate); the equivalent files were
  probed here directly from their public sources instead.

## Sources

- Crate source: `flow-fcs` 0.6.0 `.crate` from static.crates.io
  (421,508 bytes), unpacked under
  `~/workspace/.helix-flowjo/eval/flow-fcs-0.6.0/` (not committed).
- Docs: https://docs.rs/crate/flow-fcs/latest
- Repo: https://github.com/jrmoynihan/flow (monorepo; the old
  `jrmoynihan/flow-fcs` path 404s).
- Crates.io metadata: https://crates.io/api/v1/crates/flow-fcs
  (needs a User-Agent; bare curl gets 403).
- Corpus sources: Gating-ML compliance files via `jrmoynihan/flow`
  `gates/`; flowCore `inst/extdata` (`RGLab/flowCore`); FlowKit
  `data/` (`whitews/FlowKit`); flowio `data/fcs_files`
  (`whitews/flowio`). All public repos, all files public.
- Logicle reference: GatingML 2.0 definition via flowCore
  `logicletGml2` docs; Moore & Parks 2012; Stanford transform
  reference (Arcsinh ≡ Logicle with W=0).
- FCS spec: FCS 3.2, Spidlen et al., Cytometry A 2021 (PMC8241566);
  robustness study: Bras & van der Velden, Cytometry A 2020
  (211,359 files).
