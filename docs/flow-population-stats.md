# FlowJo per-population statistics (seq 449, F2c)

Per-population statistics for gated populations — counts, frequencies
(% parent / % grandparent / % total), median (MFI), mean, geometric mean,
SD, CV, robust SD, robust CV, min, max, p10/p25/p75/p90 — per parameter,
as an ordinary Column table node (`src/flow/stats.ts`,
`titer_flow_population_stats`). Pure TypeScript over the event store, no
webR. Populations are selected by 1-D range predicates on the gating tree
(`FlowPopulationRef.predicate`, half-open `[min, max)`); Phase 3 adds gate
geometry as new predicate kinds.

## Differential testing vs FlowJo

FlowJo computes its statistics on **4096-binned values**: each parameter's
range is split into 4096 equal-width bins and the statistics are computed
on bin centers weighted by bin counts. Titer computes exact unbinned
statistics over the stored f32 values. The two therefore differ in the
last digits — by design, not by error. Measured on the 20,000-event
fixture (seed 42; `tmp-f2c/ref-stats.py` is the independent Python
reference, `tests/checks.ts` `flow-f2c` pins the unbinned values):

| population × parameter | statistic | unbinned | 4096-binned | Δ | Δ % |
| --- | --- | --- | --- | --- | --- |
| root × CD4 | median | 126.6742 | 126.4808 | −0.1934 | −0.153% |
| root × CD4 | mean | 2603.9639 | 2603.9771 | +0.0132 | +0.0005% |
| root × CD4 | SD | 4151.9149 | 4151.9390 | +0.0241 | +0.0006% |
| root × FSC-A | median | 50176.7344 | 50176.3347 | −0.3996 | −0.0008% |
| root × FSC-A | mean | 51652.8451 | 51652.8973 | +0.0523 | +0.0001% |
| root × FSC-A | SD | 13087.6154 | 13087.5111 | −0.1043 | −0.0008% |
| CD4+ × CD4 | median | 7941.7468 | 7944.2910 | +2.5442 | +0.032% |
| CD4+ × CD4 | mean | 8422.0834 | 8422.0826 | −0.0008 | −0.00001% |
| CD4+ × CD4 | SD | 3016.3474 | 3016.3407 | −0.0067 | −0.0002% |
| CD4+ × FSC-A | median | 50218.3574 | 50222.6700 | +4.3125 | +0.0086% |
| CD4+ × FSC-A | mean | 51723.3642 | 51723.3152 | −0.0490 | −0.0001% |
| CD4+ × FSC-A | SD | 13024.8568 | 13024.9068 | +0.0500 | +0.0004% |

Largest observed median deviation is 0.16% (root CD4, where the
distribution is bimodal and the median sits on a steep edge); means and
SDs agree to ~0.001% or better. No real FlowJo-output fixtures exist for
this lane — FlowJo itself was not run — so the differential test is
Titer-unbinned vs the 4096-binned recomputation of the same values, which
is exactly the computation FlowJo documents. If a FlowJo export lands
later, the pin's expected values should be re-checked against it.

## Deliberate deviations from Titer's descriptive statistics

- **Geometric mean over positive values only.** R's descriptive stats
  require all values positive; flow data routinely has zero or negative
  compensated values, which would null the field on most real samples.
  The geo-mean here is exp(mean(log x)) over x > 0, null when no value
  is positive.
- **Quantiles are R type 6** (h = (n+1)p, linear interpolation) — the
  method Titer's descriptive statistics use for quartiles — so the median
  here is the same median the stats runner reports for the same values.
- **Robust SD / CV are FlowJo's definitions:** robust SD = (p84.13 −
  p15.87)/2, robust CV = 100 × robust SD / median.
- **SD is the sample SD (n−1)**, null below n = 2; CV is null at a zero
  mean. An empty population reads count 0 with every statistic null,
  never NaN.
- **Frequencies:** % parent against the population's parent,
  % grandparent against the grandparent (the root for a direct child of
  the root), % total against all events. A population with an empty
  parent reads 0%, never NaN.

## What the table holds

One row per population, in gating-tree order: population name,
% Parent, % Grandparent, % Total, Events, then a thirteen-column block
per parameter (median, mean, geo mean, SD, CV %, robust SD, robust CV %,
min, max, p10, p25, p75, p90) at six significant figures
(`formatFlowValue`). The node is an ordinary Column table at the project
root with `flowSourceSampleIds` naming its sample — the same bridge the
summary table uses.
