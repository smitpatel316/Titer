# Plotly-determinism pin harness (lane e2e-conv/plotly, Plane seq 189)

Drives the REAL export code — `renderGraphImage` (the function behind
`titer_export_graph`) and `renderFigureSvg` — in a plain browser page
served by vite, with no app build and no MCP server. The E2E suite case
(`../mcp/cases_plotly_determinism.py`, wired in by the coordinator)
exercises the same code end-to-end via MCP in CI; this harness is the
lane's local FAIL/PASS vehicle.

## Run

```sh
# from the repo root; vite serves on :1420
npx vite --port 1420 --strictPort
# in another shell — the Hatch-patched /opt/meta-chromium/chrome refuses
# to start from exec (WebGL domain policy); the Playwright headless
# shell works:
~/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell \
  --no-sandbox --disable-gpu --dump-dom --virtual-time-budget=120000 \
  "http://localhost:1420/e2e/plotly-determinism/harness.html"
# read the JSON in <pre id="result">
```

`harness2.html` is a discriminating test only (does the root-tag
attribute-order flip come from `Plotly.toImage` alone? yes — it does);
it is not part of the pin.

## Evidence (same XY scatter graph, 4 exports each run)

BEFORE the fix (unmodified `check/e2e-conversion` @ 7774dd6):

- export 1 ids: `defs-2ea9b1`, `trace7ac32c`, `tracea69f96`
- export 2 ids: `defs-811f9c`, `traceb01989`, `traced82c08`
- `ids_equal: false`, `bytes_equal: false`; after id-normalization the
  SVGs still differed in exactly one place — the root tag's attribute
  order (`style="" viewBox="…"` vs `viewBox="…" style=""`), which flips
  run to run inside Plotly's `toSVG`.

AFTER the fix (`normalizePlotlySvg` in `src/views/graphs/plotly.ts`,
applied in the four SVG export sites):

- `ids_equal: true`, `bytes_equal: true`, all 4 exports byte-identical
  (12,939 B each); ids are `defs-000000`, `trace000000`, …; root tags
  identical (canonical alphabetical attribute order).
- Figure path: 2-panel figure exports byte-identical, scopes `p0`/`p1`
  present, zero duplicate `id="…"` values in the composed SVG.
