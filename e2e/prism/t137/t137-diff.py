#!/usr/bin/env python3
"""Offline differ for T-137: compare a Titer-saved file with the file Prism
saved after reopening it (Prism File > Save As).

Checks, per format:
  .prism: unzip both; collect every numeric value from data/tables/*/data.csv;
    the sentinel (987654.321) must be present in BOTH, and the two value
    multisets must agree (as floats, exact parse — Prism may reformat
    numbers textually, e.g. 10.5 vs 10.500, so compare numerically).
  .pzfx: parse the XML; collect every <d> numeric value; same two checks.

Also reports any value present in one file but not the other (beyond the
sentinel), so a Prism resave that drops or changes data fails loudly.

Usage:
  t137-diff.py <titer-saved> <prism-resaved> [--sentinel 987654.321]
Exit 0 = sentinel present in both + value multisets agree; 1 otherwise.
"""
import argparse
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


def prism_values(path: Path):
    zf = zipfile.ZipFile(path)
    vals = []
    for name in zf.namelist():
        if name.startswith("data/tables/") and name.endswith("/data.csv"):
            text = zf.read(name).decode("utf-8", errors="replace")
            for token in re.split(r"[,\n\r]+", text):
                token = token.strip().strip('"')
                if token:
                    try:
                        vals.append(float(token))
                    except ValueError:
                        pass
    return vals


def pzfx_values(path: Path):
    root = ET.parse(path).getroot()
    vals = []
    for el in root.iter():
        if el.tag == "d" and (el.text or "").strip():
            try:
                vals.append(float(el.text.strip()))
            except ValueError:
                pass
    return vals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("titer_saved")
    ap.add_argument("prism_resaved")
    ap.add_argument("--sentinel", type=float, default=987654.321)
    args = ap.parse_args()
    titer, prism = Path(args.titer_saved), Path(args.prism_resaved)
    for p in (titer, prism):
        if not p.is_file():
            print(f"FAIL: missing file {p}")
            return 2
    reader = prism_values if titer.suffix.lower() == ".prism" else pzfx_values
    tv, pv = reader(titer), reader(prism)
    ok = True
    for label, vals in (("titer-saved", tv), ("prism-resaved", pv)):
        present = any(v == args.sentinel for v in vals)
        print(f"{label}: {len(vals)} numeric values, sentinel "
              f"{args.sentinel} {'PRESENT' if present else 'MISSING'}")
        if not present:
            ok = False
    tc, pc = Counter(tv), Counter(pv)
    if tc != pc:
        only_titer = list((tc - pc).elements())
        only_prism = list((pc - tc).elements())
        print(f"FAIL: value multisets differ — only in titer-saved: {only_titer[:10]}"
              f"{'...' if len(only_titer) > 10 else ''}; "
              f"only in prism-resaved: {only_prism[:10]}"
              f"{'...' if len(only_prism) > 10 else ''}")
        ok = False
    else:
        print(f"value multisets agree ({len(tv)} values)")
    print("T137-DIFF-PASS" if ok else "T137-DIFF-FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
