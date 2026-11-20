# Gen 9 resume (2026-11-20 ~02:06 PT; respawned after kill ~02:05 PT)
# Kills so far ~00:54, ~01:03, ~01:11, ~01:17, ~01:23, ~01:30, ~01:36,
# ~01:47, ~01:53, ~02:05 PT (~6-12 min apart). Gen 8 lived ~11 min.
# GEN 9 ALIVE 02:06 PT. /tmp/prism-probe SURVIVED (demo/, template-demo.bin
# 80,237 B + template-demo.dec 660,889 B, zval-*.bin). Worktree CLEAN.
# GEN 9 DONE ~02:30 PT. FINAL VERDICT: NO-GO (blob alone) — see
# notes/05-gen9-final-report.md. New in gen 9: header framing pinned
# (300/826/1169 constant, X field 2/10/266 unresolved); ZERO inputDataSet
# UUID hits in 4 encodings x 17 graphs (source linkage is sheet.json-only);
# layouts same grammar/gap; .pzfx Template = plain zlib (78 5e, byte-identical
# .dec) embedding the same PCFFGRA4 graph blobs verbatim + clear-text
# analysis labels. Carve-out: auto graphs reconstructible from JSON sidecar
# (sheet.json inputDataSets + dataset "format") + blob title — PARTIAL GO
# for auto graphs via sidecar, NO-GO from the blob as briefed.
# Plan (from gen 8 open list, priority order):
# 1. Cross-KIND structural diff: XY vs column vs grouped vs survival
#    data.bin — record counts, Legend- blocks, 'HxW@' patterns, kind code?
# 2. Alignment-aware diff Y SD vs Y SEN (title +1 byte shifts all after 193).
# 3. .pzfx Template blob: strings/structure of template-demo.dec (660,889 B).
# 4. Layouts: layouts/<id>/data.bin — same magic/grammar?
# 5. GO/NO-GO verdict. Gen 8 leaning: NO-GO for "type from blob alone"
#    (error stat is dataset-side), BUT sheet.json+datasets+blob title DOES
#    yield type+source+axes for auto graphs — verdict call on what counts
#    as GO still owed. Cross-kind structure test may flip to partial GO.
