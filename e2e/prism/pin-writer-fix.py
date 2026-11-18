#!/usr/bin/env python3
"""File-level pin for the BUG-20 / BUG-21 writer fixes (Plane seq 175 / 176).

Checks Titer-written export files for the two structural markers the fixes
added — the same markers real Prism 11.2.0 requires on open:

  .prism (BUG-20): every data sheet's table in data/sheets/*/sheet.json
    carries "@class" = "DataTable" (column/grouped/contingency) or
    "XYDataTable" (xy/survival). Pre-fix files omit it; Prism's reader
    dispatches on table["@class"] and dereferences it unconditionally, so
    opening a pre-fix .prism crashes Prism 11.2.0 (SIGSEGV, 12/12 on Nov 17).
  .pzfx (BUG-21): the file contains exactly one EMPTY <Template> element
    (last child of the root). Pre-fix files carry none; Prism shows its
    XML-compliance dialog ("does not fully comply with the Prism XML
    format") and opens as Compatibility Mode (12/12 on Nov 17).

This is the pre-fix FAIL / post-fix PASS pin for T-132 that runs WITHOUT
Prism — usable in CI on any machine. The Mac run (run-prism-roundtrip.sh)
is the live-Prism proof; this pin is the file-level gate that must pass
before the Mac run is even attempted.

Usage:
  pin-writer-fix.py <file-or-dir>... [--json out.json]

Exit 0 = every checked file carries its marker; exit 1 = at least one
file fails (per-file FAIL lines name the missing marker). Files that are
not .prism/.pzfx are skipped; a directory is scanned recursively.

Pre-fix FAIL demonstration (on Hatch, no Prism needed):
  python3 pin-writer-fix.py ~/workspace/helix/qa/roundtrip-2f8eca2.prism \
      ~/workspace/helix/qa/roundtrip-866ae90.prism
    -> FAIL: both lack table["@class"] (written by Titer 1.0.7, Nov 13)
  python3 pin-writer-fix.py <a 1.6.0-era .pzfx export>
    -> FAIL: no <Template> element

Post-fix PASS demonstration:
  python3 make-postfix-exports.ts --out-dir /tmp/prism-pin   # writer on this branch
  python3 pin-writer-fix.py /tmp/prism-pin
    -> PASS
"""

import json
import re
import sys
import zipfile
from pathlib import Path

PRISM_CLASSES = {"DataTable", "XYDataTable"}
# The exact empty Template element the writer emits (src/lib/pzfx-write.ts).
TEMPLATE_EL = '<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>'


def check_prism(path: Path):
    """Return (ok, detail)."""
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        return False, "not a zip"
    sheets = [n for n in zf.namelist()
              if n.startswith("data/sheets/") and n.endswith("/sheet.json")]
    if not sheets:
        return False, "no data/sheets/*/sheet.json entries"
    bad = []
    for name in sheets:
        try:
            doc = json.loads(zf.read(name))
        except (ValueError, KeyError):
            bad.append(f"{name}: unreadable sheet.json")
            continue
        table = doc.get("table") or {}
        cls = table.get("@class")
        if cls not in PRISM_CLASSES:
            bad.append(f"{doc.get('title', name)}: table[\"@class\"]={cls!r}")
    if bad:
        return False, "; ".join(bad)
    return True, f"{len(sheets)} data sheet(s), all carry @class"


def check_pzfx(path: Path):
    """Return (ok, detail)."""
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except (UnicodeDecodeError, OSError) as e:
        return False, f"unreadable: {e}"
    count = len(re.findall(r"<Template[\s>]", text))
    if count == 0:
        return False, "no <Template> element (BUG-21)"
    if count != 1:
        return False, f"{count} <Template> elements, expected exactly 1"
    if TEMPLATE_EL not in text:
        return False, "<Template> present but not the empty element the writer emits"
    return True, "exactly one empty <Template> element"


def collect(paths):
    files = []
    for p in paths:
        p = Path(p)
        if p.is_dir():
            files += sorted(f for f in p.rglob("*")
                            if f.is_file() and f.suffix.lower() in (".prism", ".pzfx"))
        elif p.is_file():
            files.append(p)
        else:
            print(f"SKIP: {p} does not exist", file=sys.stderr)
    return files


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    json_out = None
    for i, a in enumerate(argv):
        if a == "--json" and i + 1 < len(argv):
            json_out = argv[i + 1]
    files = collect(args)
    if not files:
        print("no .prism/.pzfx files found", file=sys.stderr)
        return 2
    results = []
    failures = 0
    for f in files:
        if f.suffix.lower() == ".prism":
            ok, detail = check_prism(f)
        else:
            ok, detail = check_pzfx(f)
        results.append({"file": str(f), "format": f.suffix.lower()[1:],
                        "pass": ok, "detail": detail})
        print(f"{'PASS' if ok else 'FAIL'}  {f}  — {detail}")
        failures += 0 if ok else 1
    if json_out:
        Path(json_out).write_text(json.dumps(
            {"total": len(results), "failures": failures, "results": results},
            indent=2) + "\n")
    print(f"{len(results) - failures}/{len(results)} files carry the BUG-20/21 markers"
          + (" — ALL PASS" if failures == 0 else f" — {failures} FAIL"))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
