# B-07 — Prism histogram-bin boundary rule: SETTLED (docs)

**Question:** does Prism exclude values below the first bin?

**Answer: YES.** Prism omits from the frequency-distribution analysis every
value too small to fit in the first bin. Two independent GraphPad sources
agree verbatim, and a third pins the edge convention.

## Evidence (public docs — no Prism run needed)

1. **Prism 4.0 Step-by-Step Examples, "Histograms and Frequency
   Distributions"** (GraphPad, 2003):
   > "Under Exclude values, note that Prism excludes from the analysis all
   > values below those fitting the first bin. You can additionally choose
   > to exclude all values larger than a value that you designate."
   — https://cdn.graphpad.com/faq/1757/file/P4-Histograms.pdf

2. **Analyzing Data with GraphPad Prism (v3 companion, Motulsky 1999)**:
   > "All values too small to fit in the first bin are omitted from the
   > analysis. Enter an upper limit to omit larger values from the analysis."
   — https://cdn.graphpad.com/faq/2/file/Prism_v3_Analyzing_Data.pdf

3. **GraphPad FAQ 1822 ("Bug: Extra row in Frequency Distribution
   results", Prism 6.00–6.0b)** pins the edge convention. First bin center
   5, last bin center 15, width 10:
   > "The first bin includes values from 0 to just a tiny bit below 10.
   > The second bin includes values from 10 to just a tiny bit below 20.
   > If there is a value of exactly 20, Prism will place it into a third
   > bin, that is not labeled. … We'll fix the next release of Prism so 20
   > would simply not fit either bin in the example above, so the results
   > would stop with two labeled rows."
   — https://www.graphpad.com/support/faq/bug-extra-row-in-frequency-distribution-results/

## The exact rule

- Bins are defined by **center + width**. Bin *i* covers
  **[center − width/2, center + width/2)** — lower-inclusive,
  upper-exclusive. A value exactly on a shared edge belongs to the bin
  ABOVE it.
- **Below the first bin:** values < (first center − width/2) are
  **excluded/omitted from the analysis** (not counted in any bin, not in
  the total N of the frequency table).
- **Above the last bin:** an optional upper limit omits larger values. A
  value exactly at the top edge (center + width/2 of the last bin) did NOT
  fit either bin after the FAQ-1822 fix — i.e. in modern Prism it is
  excluded too. (The fix dates to the Prism 6.0x era, so Prism 11 behaves
  this way; the numeric pin below confirms it on 11.2.0 if Mac time allows.)
- **Scope note:** the exclusion bites when bins are defined MANUALLY (the
  user sets the first-bin center). With automatic binning, Prism's auto
  width derives from the data range (FAQ 1660: `DataSetBinWidth =
  (DataSetMaxValue − DataSetMinValue) / DataSetBinCount`, Sturges-based),
  so the range is covered — same as Titer's auto mode.
  — https://www.graphpad.com/support/faq/prisms-algorithm-for-determining-the-automatic-bin-width-when-creating-a-frequency-distribution/

## What this means for Titer (parity gap)

Titer's frequency distribution (`src/stats/column/frequency-distribution.ts`)
uses R's `hist()` convention, which is the OPPOSITE at both ends:

- Bins are **(lower, upper]** — right-closed; the first bin is closed on
  both sides so the minimum is always counted. A value exactly on an edge
  goes into the bin BELOW it. The runner's own note: *"Bins are (lower,
  upper]; the first bin includes the minimum, so no value is dropped."*
- Edges always cover the full data range in all three modes (auto /
  width / count: `start = min(startAt ?? min, min)`), so **no value is
  ever below the first bin in Titer**.

So Titer and Prism disagree twice on the same analysis:

| | Prism | Titer |
|---|---|---|
| Value below first bin's low edge | **excluded** from the analysis | impossible — edges cover the range |
| Value exactly on a shared edge | goes to the bin **above** it (`[low, high)`) | goes to the bin **below** it (`(low, high]`) |

Whether Titer should match Prism here (manual-bin mode at least) is a
coordinator / Plane decision — this lane records the rule and the gap, it
does not file the item. Note the existing T-20 check (Plan 06 frequency
distribution, histogram 4 bars [3,3,2,2]) pins Titer's current behaviour;
any change to match Prism must re-pin T-20.

## Prism 11 numeric pin (optional, Mac session, before Dec 2)

If Mac time allows, confirm the rule numerically on Prism 11.2.0 (it
confirms the FAQ-1822 fix survived into 11.x):

1. New Column table, one column, values `1, 5, 15, 25` (4 values).
2. Analyze → Frequency distribution. Manual bins: first bin center `10`,
   bin width `10`, last bin center `20` → bins `[5,15)`, `[15,25)`.
3. Expected per the rule: value `1` excluded (below first bin); `5` in
   bin 1; `15` in bin 2 (on the shared edge → bin above); `25` excluded
   (exactly at the top edge → fits neither bin after the FAQ-1822 fix).
   Results sheet should show bin counts `1, 1` over 2 counted values.
4. Capture the results-sheet dump + a screenshot under
   `~/workspace/.helix-prism-gap/b07/` and record the verdict here.
5. If `25` lands in an extra unlabeled bin instead, the FAQ-1822 fix did
   NOT survive — record that verbatim; it changes the "above the last
   bin" row above.

Status of the pin: **NOT YET RUN** (needs the Mac slot + Prism; the docs
answer above stands on its own).
