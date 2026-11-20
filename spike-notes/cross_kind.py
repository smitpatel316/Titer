#!/usr/bin/env python3
"""Cross-KIND structural comparison of demo data.bin files (gen 9).
Compares header bytes, the 3 u32s @198, record structure, and string-block
layout across graph kinds: column (Y SD), XY (Correlation), XY rep,
Grouped, Survival, Data 6 (HxW@), Data-missing (Legend- x3).
"""
import json, struct, sys
from pathlib import Path

DEMO = Path("/tmp/prism-probe/demo/graphs")

def load(gid):
    d = (DEMO / gid / "data.bin").read_bytes()
    sj = json.loads((DEMO / gid / "sheet.json").read_text())
    return d, sj

def zval_off(d):
    return d.find(b"Zval")

def header_u32s(d, off, n=12):
    return struct.unpack_from(f"<{n}I", d, off)

# map gid -> title from sheet.json
for gid in sorted(p.name for p in DEMO.iterdir()):
    d, sj = load(gid)
    zo = zval_off(d)
    title = sj.get("title")
    print(f"{gid[:8]} len={len(d)} zval@{zo} title={title!r} "
          f"fenID={sj.get('fenID')} inputs={len(sj.get('inputDataSets', []))}")
    # header u32s at 8..56 and the 3 u32s at 198
    print(f"   hdr8 : {header_u32s(d, 8, 12)}")
    print(f"   u32@198: {header_u32s(d, 198, 3)}")
    # count occurrences of key markers in pre-zval region
    pre = d[:zo]
    for pat in (b"Title-", b"XTitle-", b"YTitle-", b"Y1Title-", b"Legend-",
                b"HxW@", b"Y@UUUUUU", b"r@UUUUUU"):
        print(f"   {pat!r}: {pre.count(pat)}", end="")
    print()
