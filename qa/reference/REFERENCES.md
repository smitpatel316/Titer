# Screenshot-test references

Reference images for the screenshot-similarity cases (`e2e/mcp/cases_screenshot.py`,
inventory §4). A case compares the live export against the reference for its
platform under the L8 normalized rule (`e2e/compare.py` — similarity, never
byte-equality). The `.gitignore` allowlist admits ONLY `*.png` / `*.svg`
directly under a `reference/` dir; everything else non-md under `qa/` stays
ignored, so a reference lands only when a lane deliberately puts it there.

Layout: `qa/reference/<case>/{linux,mac}.{png,svg}` — PNG is the 300 DPI
export (2000×1437 for the survival graph), SVG is the 640×460 export.

## Committed

| Case | Files | Platform | Provenance |
|---|---|---|---|
| `l8-survival` | `mac.png`, `mac.svg`, `linux.png`, `linux.svg` | Mac + Linux | Real exports from the L8 --compare lane (Nov 17, 2026): Mac = v1.6.0 GUI export of `survival.pzfx` → Survival Curve (defaults); Linux = headless MCP export of the same file via `titer_build_graph(survival)` + `titer_export_graph`. Hashes verified against `l8-compare.md` §1: PNG Mac `67b6c6c3…`, Linux `7b5cdd25…`; SVG Mac `38728dff…`, Linux `ebcf9488…`. L8 numbers reproduced by `e2e/compare.py`: PNG 95.804% identical, mean abs RGB 5.998, 0 far, 0 isolated; SVG max numeric delta 13 px, 46/46 texts identical. |

## Owed (no reference committed yet — the case SKIPs its similarity half)

Linux capture is blocked in this lane: no E2E debug binary exists anywhere
(no binary in the reference worktree, the sibling conversion worktrees, or
the main checkout — the main checkout's debug binary predates `check/e2e-ci`
and has no MCP auto-enable), and this lane may not build one. Capture with
`bash e2e/mcp/run-screenshot.sh --capture` once the CI/E2E build exists, or
on the Mac slot for the Mac half.

| Case | Linux reference | Mac reference |
|---|---|---|
| `q20` (mean-error, 4 bars) | owed — `--capture` | owed — Mac slot |
| `q23` (mean-error + t-test bracket) | owed — `--capture` | owed — Mac slot |
| `q31` (xy-scatter, 4 dose points, no curve) | owed — `--capture` | owed — Mac slot |
| `q38-box`, `q38-violin`, `q38-individual`, `q38-pie`, `q38-donut` | owed — `--capture` | owed — Mac slot |
| `q39-scatter`, `q39-bar`, `q39-area` | owed — `--capture` | owed — Mac slot |
| `q61` (individual values) | owed — `--capture` | owed — Mac slot |

The geometry half of every case above runs with NO reference (bar bands,
bracket runs, curve-vs-points coverage are asserted from the live export's
own pixels), so an owed reference costs only the similarity half, never the
whole case.
- q39-scatter: Linux-captured 2026-11-18 (PNG sha e3a6c824ab832391…; xy-scatter on q39 fixture); Mac reference owed.
- q20: Linux-captured 2026-11-19 (PNG sha d539de6dd37bc4b0…; mean-error on ABCD fixture, 300 DPI PNG + SVG); Mac reference owed.
- q38-box: Linux-captured 2026-11-19 (PNG sha d3eba5c1f6e68833…; box-violin on q38 fixture); Mac reference owed.
