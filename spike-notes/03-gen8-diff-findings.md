# Gen 8 progress (2026-11-20 ~02:00 PT, respawned ~01:54 after kills thru ~01:53)

## HEADLINE: SD vs SE vs CV data.bins are IDENTICAL except counters + UUID + title
- Byte-diff (scripts/diff_same_size.py) Y SD vs Y SE vs Y CV (all 18,636 B,
  zval@18190): only 73 bytes differ, in 49 runs. ALL are:
  - UUID string @150-185 (per-graph object UID, matches neither sheet.json
    uid nor inputDataSets; internal binary UID only)
  - title string @193-196 ("Y SD" vs "Y SE" vs "Y CV")
  - sequential counters: offset 142 = fenID (25/26/27, matches sheet.json);
    u16 object IDs 185..193 in SD -> +9 per graph (SE 194..202, CV 203..211);
    single bytes @518 (0x1a/1b/1c), @716, @5595 (+1 per graph);
    u16 values @542 ('e'/'i'/'m' = 101/105/109, +4), @728, @912, @978,
    @1044, @7303... (+4/+5 per graph — same counter family, different stride)
  - NO semantic byte distinguishes SD from SE from CV.
- Zvals (decompressed Mval, 3,346 B each) of SD/SE/CV/SEN are BYTE-IDENTICAL.
- sheet.json inputDataSets DIFFER per graph (each auto-graph gets its own
  pair of dataset UUIDs). The error-bar stat lives in the DATASET, not the
  graph blob: data/sets/<uid>.json has "format": "y_sd" (SD's ctrl/treat)
  vs "y_se" (SE's ctrl). Y CV's first dataset is "y_sd" + flags
  ["UPPER_LOWER_STYLE"]. Dataset titles are ctrl/treat (the two groups).
- CONCLUSION SO FAR: for auto-created column graphs, data.bin is a FIXED
  TEMPLATE + title + object IDs. Type-at-error-stat-level is NOT in the
  blob; it is (dataset format) + (sheet.json inputDataSets). The blob adds
  almost nothing semantic for auto graphs beyond the title.

## Header / framing decoded (Y SD data.bin, offsets)
- 0: magic `PCFFGRA4`
- 8..~140: header fields incl. u32 1000 @48, u32 4 @52, UTF-16LE locale
  strings "en" @~66 (`65 00 6e 00`) and "GB" @112 (`47 00 42 00`)
- 142: fenID as u16 (25 = sheet.json fenID; 26 SE, 27 CV, 23 SEN)
- 146: u32 37 = len of following UUID string incl. NUL; 150-185 UUID ASCII
  + NUL @186
- 187: tag u16 `09 00`, 189: u32 len 5 ("Y SD\0"), 193: title ASCII + NUL
- 198: `0a 00 2c 01 00 00 3a 03 00 00 91 04 00 00` — three u32s 300/826/1169
  (offsets? counts? TBD — increasing, possibly a TOC)
- Tagged-string pattern confirmed: `<tag u16> <len u32> <bytes>` — e.g.
  Title- objects: `2c 00 05 00 00 00 "Title-"` @~7551, then ~600 B of
  text-object data (font/size/color), NO actual title text (auto graphs
  have empty axis-title text objects; titles are rendered from data).
- "Y@UUUUUU" strings are NOT strings: bytes `59 40` + f64. E.g. @3916:
  `55 55 55 55 55 55 b5 3f` = f64 0.08333... (1/12); @3066:
  `1c c7 71 1c c7 71 ac 3f` = f64 ~0.056. These sit in repeated 283 B
  records (offsets 3048, 3331, 3614, 3897, 4180, 4463, 4746, 5029, 5312 —
  spacing exactly 283) starting with a u32 object ID. Records contain
  doubles + small u16s (e.g. `32 00`=50, `66 00`=102 — coords/sizes?).
  Likely per-dataset/per-curve plot records; NOT yet mapped.
- field_parse.py's tag/len-stream assumption (from offset 8) is wrong;
  the stream is NOT a flat tag/len sequence from the header.

## Still open (priority)
1. Cross-KIND structural diff: does data.bin distinguish XY vs column vs
   grouped vs survival (record counts, Legend- blocks, 'HxW@' patterns)?
   XY: Correlation (18541 B) vs Y SD (18636 B); Grouped (35167 B);
   Survival (21887 B); Data 6 (21840 B, has 'HxW@', 'Legend-'? no —
   Data - missing columns (28206 B) has Legend- x3). If a kind code
   exists, it is here.
2. Alignment-aware diff Y SD vs Y SEN (title +1 byte shifts everything
   after 193) to confirm SEN is also counters-only.
3. Axes: where (if anywhere) are axis min/max/tick values? Candidates:
   the doubles in the 283 B records. Axis TITLES for auto graphs appear
   to be empty in-blob (derived from data at render).
4. .pzfx Template blob: /tmp/prism-probe/template-demo.dec (660,889 B) —
   strings/structure check still owed (decompression method unrecorded).
5. Layouts: layouts/<id>/data.bin — same magic/grammar? (unchecked)
6. GO/NO-GO verdict: shaping up as NO-GO for "type from the blob alone"
   (error stat is dataset-side), BUT the combination sheet.json +
   datasets + blob title DOES yield type+source+axes for auto graphs —
   needs a verdict call on what counts as GO. The coarse graph KIND
   (XY vs column vs survival) from data.bin structure is still untested
   and could flip it to a partial GO.
