# Spike report — graph import from real Prism files (gen 9, final)
# Date: 2026-11-20 ~02:06–02:30 PT. 9th generation; predecessors killed by
# daemon restarts ~00:54–02:05 PT. Worktree spike/18-graph-import CLEAN.
# Method: file-only clean-room (files Prism wrote; public corpus + demo
# extract in /tmp/prism-probe/demo). Mansi's files NEVER used.

## VERDICT: NO-GO (for "parse ONE real graph end-to-end from the blob")
## The ceiling stands: neither the .prism data.bin (PCFFGRA4) nor the .pzfx
## <Template> blob yields type + source table + axes for a real graph.
## Carve-out (important, see §5): auto-created graphs ARE reconstructible
## from the JSON sidecar (sheet.json inputDataSets + dataset "format") +
## blob title — but that is re-deriving the graph from data Titer already
## imports, not parsing it from the blob. Hand-made/custom graphs remain
## unimportable, and the corpus contains ZERO non-auto graphs to test with.

## 1. What gen 9 established (new)
### 1a. Header framing (all 17 demo graphs, verified byte-exact)
- 0: magic `PCFFGRA4`
- 8..~140: fixed header; u32s @8 identical across ALL 17 graphs
  (819201, 26214400, 16908688, 6554000, 10551896, 104, 600|700, 0,0,0,
  1000, 4). The 600 vs 700 field (@32) is the ONLY header difference
  (Grouped only) — likely a width/count, not a kind code.
- 142: fenID u16 (= sheet.json fenID). 146: u32 37 = UUID string len
  incl NUL. 150–185: per-graph binary object UID (ASCII + NUL @186;
  matches NEITHER sheet.json uid NOR inputDataSets).
- 187: tag u16 `09 00`; 189: u32 title len incl NUL; 193: title ASCII+NUL.
- After title: tag `0a 00`, then THREE FIXED u32s 300 / 826 / 1169 —
  IDENTICAL for Y SD, Data 7, XY Correlation, Survival, Grouped, Data 6
  (gen 8's "TOC?" guess: not offsets into this file — 300/826/1169 are
  constant across kinds/sizes; likely fixed section sizes or version
  constants, NOT a kind code). Then `00 00 00 00 ff ff ff ff`, then a
  varying u32 X, then `ff ff ff ff`, then `2c 01 00 00` (=300 again),
  `00 00 00 00`, X again, then ~250 B of zeros, then dense binary.
### 1b. The varying u32 X (new field; meaning UNRESOLVED)
- X = 2 for Y SD/SE/CV/SEN, Y high low, Y error, XY Correlation,
  XY-replicate (inputs 0), Data 7. X = 10 for XY mean-with-error,
  Grouped, Y CVN, Data 6, Data-missing, XY-replicate (inputs 4).
  X = 266 for Survival only.
- X does NOT track inputDataSet count, dataset row counts (checked:
  Y SD ctrl = 2 replicates x 6 rows; Survival Control = 1 x 12 rows),
  or dataset format alone (y_single -> 10 for Data-missing, 266 for
  Survival). Hypotheses left open: count of plot/curve objects in the
  following section, or a flags bitmask (2=0b10, 10=0b1010, 266=0b100001010;
  note 266 = 0x100|0x0A). NOT a graph-kind code: XY scatter and column
  bar both read 2.
### 1c. NO source linkage in the blob (decisive negative)
- Searched all 17 pre-Zval blobs for every inputDataSet UUID in FOUR
  encodings (ASCII, 16-byte GUID, UTF-16LE, byte-reversed GUID): ZERO
  hits in all 17. The blob contains no reference to its source table(s)
  in any discoverable form. Source linkage exists ONLY in sheet.json.
### 1d. Layouts: same grammar, same gap
- layouts/<id>/data.bin: same PCFFGRA4 magic, Zval tail, title string
  ("Layout 1"); linked graph UIDs (sheet.json linkedGraphSheets) are
  NOT present in the blob (ASCII or UTF-16). Same conclusion as graphs.
### 1e. .pzfx Template blob: decompression method CONFIRMED + contents mapped
- template-demo.bin (80,237 B) -> template-demo.dec (660,889 B) is plain
  zlib (RFC 1950, header 78 5e): `zlib.decompress` at offset 0,
  output BYTE-IDENTICAL to the saved .dec. (Gen 8 had not recorded this.)
- .dec layout: PCFFGRA4 header; Apple print-ticket plist XML @10489–
  17549 (irrelevant); binary regions; Zval @314996; then MORE embedded
  PCFFGRA4 graph blobs. The Template blob is a CONCATENATION/ARCHIVE:
  it embeds the same graph data.bins VERBATIM (e.g. @576157: Y SD blob
  header — same binary UID 402E2B0D…, same title, same 300/826/1169
  triple; @334000: XY mean-with-error blob; @467634: Survival blob).
  It also carries ANALYSIS RESULTS AS CLEAR TEXT ("Nonlin fit of XY…",
  "Sigmoidal, 4PL…", "Comparison of Survival Curves",
  "Log-rank (Mantel-Cox) test", "Chi square", "P value", "# at risk",
  "Survival proportions"). So .pzfx gives NOTHING new for graphs — same
  opaque blobs — but analyses ARE partially readable as text there.
  No "Graph"/"Axis"/"inputDataSet"/"DataSet" keys anywhere in .dec
  (0 hits); "Title" 54x, "Y SD" 2x, "Survival" 18x (titles + analysis
  labels only).

## 2. Format map (consolidated, .prism graphs/<id>/data.bin)
- 0–7 magic PCFFGRA4; 8–~140 fixed header (see §1a); 142 fenID u16;
  146 u32 UUID-len (37); 150–186 binary object UID ASCII+NUL;
  187 tag 09 00; 189 u32 title-len; 193 title ASCII+NUL; then tag
  0a 00 + u32s 300/826/1169 + 00 00 00 00 + ff ff ff ff + u32 X +
  ff ff ff ff + u32 300 + u32 0 + u32 X + ~250 B zeros + dense binary
  (unparsed: includes 283 B records with f64s, e.g. 0.0833=1/12, and
  tagged string fields `2c 00 <len u32> <name>` for Title-/XTitle-/
  YTitle-/Y1Title-/Legend- text objects, each ~600 B of font/size/
  color data but EMPTY title text for auto graphs).
- Tail: `Zval u32 clen u32 dlen <zlib> Zend`; decompressed Mval tree
  (kind 5 map / 6 array / 1 raw) is STYLE ONLY (axis colors, gridlines,
  background) — no type/source/axes (gen 6; re-confirmed SD/SE/CV/SEN
  Zvals byte-identical).
- Same-file byte-diff (gen 8): SD vs SE vs CV differ in ONLY 73 bytes
  (UUID, title, sequential counters) — NO semantic byte distinguishes
  them. Error-bar stat lives in data/sets/<uid>.json "format"
  (y_sd / y_se / y_sd_n / y_plus_minus …), NOT in the blob.

## 3. Why each GO criterion fails (from the blob alone)
- TYPE: no kind code found (header identical; 300/826/1169 constant;
  X is 2 for both XY scatter and column bar). SD/SE/CV byte-identical.
- SOURCE TABLE: zero UUID hits in 4 encodings x 17 graphs.
- AXES: axis-title text objects exist but are empty for auto graphs
  (titles rendered from data at runtime); no min/max/tick values
  located; doubles in the 283 B records unmapped (could be geometry,
  not axes).

## 4. Minimal parser sketch (what IS parseable today)
- `parse_prism_graph(data.bin)`: verify magic; fenID @142 u16;
  binary UID @150 (len u32 @146); title via tag 09 00 / len @189;
  X via title-end + 2 + 12 + 8; Zval tail -> zlib -> Mval style tree
  (scripts/mval_parse.py, dump_full.py). That yields: title, fenID,
  style, X (uninterpreted). It does NOT yield type, source, or axes.
- `.pzfx Template`: `zlib.decompress(blob)` -> scan for embedded
  PCFFGRA4 blobs (same parser per blob) + clear-text analysis labels.
- No further parser work is justified without a new lever (see §6).

## 5. The carve-out: auto-graph reconstruction WITHOUT the blob
- For auto-created graphs, type+source+axes are fully determined by
  (a) graphs/<id>/sheet.json: title, isAutoCreated, inputDataSets;
  (b) data/sets/<uid>.json: "format" (y_sd/y_se/y_replicates/
  y_single/y_plus_minus/y_sd_n/y_se_n…) + titles (ctrl/treat…);
  (c) blob title (== sheet.json title, redundant).
  A follow-up lane COULD implement auto-graph import on this basis
  (e.g. Y SD = column graph, error=SD, datasets ctrl+treat) without
  cracking data.bin at all. Limits: hand-made graphs (custom type,
  custom axes, manual datasets) cannot be reconstructed this way; the
  80-file corpus has 0 non-auto graphs, so no test material exists
  for them; axis min/max/ticks would still be defaults, not Prism's.
  Whether this counts as GO is a coordinator call — gen 9's read:
  it is a PARTIAL GO for auto graphs via the JSON sidecar, NO-GO for
  graph import from the blob as briefed.

## 6. What a follow-up would need (if the ceiling is ever revisited)
- Generated files with HAND-MADE graphs (non-auto, custom types/axes):
  the demo/corpus auto graphs are fixed templates; only a hand-made
  graph can show where type/axes live. Needs the Mac slot + Prism.
- Differential on the 283 B record region and the X field across
  hand-made graphs (does X move with curve count? do records map to
  curves?).
- Axis min/max: hunt f64s matching known axis limits in a generated
  file with distinctive limits (e.g. X 0–1000, Y -7.5–42.5).
- .pzfx analyses text is a separate, already-open door (readable
  labels/results) — not graphs, but possibly worth a lane of its own.
- Do NOT re-try: Zval/Mval (style only), ASCII/GUID/UTF-16 UUID hunts
  (done, 0 hits), flat tag/len stream from offset 8 (field_parse.py
  fails @1478), SD/SE/CV diffs (counters only).

## 7. Files (all outside the repo)
- notes/00-resume-state.md (gen 8 state), 01-demo-graph-tree.txt,
  02-demo-graphs-strings.txt, 03-gen8-diff-findings.md,
  04-gen9-resume.md, 05-gen9-final-report.md (this file).
- scripts/cross_kind.py (gen 9; header/X/marker table across 17),
  plus gen 1–8 scripts (corpus_scan, mval_parse, dump_full, …).
- /tmp/prism-probe/demo/ (demo .prism extract), template-demo.bin/.dec.
