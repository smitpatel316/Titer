# Marketplace fixtures (M2, seq 434)

The bundled sample index + the hello-analysis plugin as versioned zips, so
the marketplace flow works end to end without network.

- `hello-analysis/` — the plugin source: `plugin.json` (manifest + the
  `hello-mean` R analysis, from the v3/plugin-api groundwork) + `README.md`.
- `hello-analysis-1.0.0.zip`, `hello-analysis-1.1.0.zip` — the plugin as
  installable zips (`plugin.json` at the root, plus the README).
- `sample-index.json` — the bundled index listing hello-analysis at 1.1.0
  with version history for 1.1.0 + 1.0.0. Its `sha256` values are the real
  hashes of the zips; its `downloadUrl`s are the GitHub raw URL shape the
  real index will use, but the `bundledFile` entries make the store load
  these zips from disk instead of the network.

Regenerate (rewrites the zips AND the index together, so hashes never drift):

```
node scripts/build-marketplace-fixture.mjs
```

Zips are byte-deterministic (fixed file dates, STORE compression).
