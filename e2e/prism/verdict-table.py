#!/usr/bin/env python3
"""Verdict-table writer for T-132 (and T-137's Prism reopens).

Reads the per-file <basename>.json records written by run-prism-roundtrip.sh
in a results dir and emits:
  - verdicts.md : a Markdown table in the part3-verdicts.md shape
    (File | Verdict | Open dialog / notes | Data check), plus totals.
  - verdicts.json : machine-readable summary (counts by verdict + format).

Verdicts: CLEAN (loads, no dialog) / WARN (loads after a dialog) /
FAIL (does not open) / CRASH (Prism process dies opening it).

Usage:
  verdict-table.py <results-dir> [--out-dir DIR] [--title TITLE]

Baseline to beat (Nov 17, part3-verdicts.md, 1.6.0-era exports):
  .prism 12/12 CRASH, .pzfx 12/12 WARN. The 1.6.2 re-run must show the
  crash gone (CLEAN) and the warning gone (CLEAN) for the fix to be proven.
"""

import json
import sys
from collections import Counter
from pathlib import Path


def load_records(results_dir: Path):
    records = []
    for rec in sorted(results_dir.glob("*.json")):
        if rec.name in ("verdicts.json",):
            continue
        try:
            records.append(json.loads(rec.read_text()))
        except (ValueError, OSError):
            print(f"WARN: unreadable record {rec}", file=sys.stderr)
    return records


def fmt_of(filename: str) -> str:
    return Path(filename).suffix.lower().lstrip(".")


def main(argv):
    if len(argv) < 2:
        print("usage: verdict-table.py <results-dir> [--out-dir DIR] [--title T]",
              file=sys.stderr)
        return 2
    results_dir = Path(argv[1])
    out_dir = results_dir
    title = "T-132 — Titer-written files opened in real Prism 11"
    i = 2
    while i < len(argv):
        if argv[i] == "--out-dir" and i + 1 < len(argv):
            out_dir = Path(argv[i + 1])
            i += 2
        elif argv[i] == "--title" and i + 1 < len(argv):
            title = argv[i + 1]
            i += 2
        else:
            i += 1
    records = load_records(results_dir)
    if not records:
        print(f"no per-file records in {results_dir}", file=sys.stderr)
        return 2

    counts = Counter((r.get("verdict", "FAIL"), fmt_of(r.get("file", "")))
                     for r in records)
    total = len(records)
    by_verdict = Counter(r.get("verdict", "FAIL") for r in records)

    lines = [f"# {title}", ""]
    lines.append("| File | Verdict | Open dialog / notes | Data check |")
    lines.append("|---|---|---|---|")
    for r in records:
        f = r.get("file", "?")
        v = r.get("verdict", "FAIL")
        dialog = r.get("dialog") or "—"
        notes = []
        if r.get("doc_title"):
            notes.append(f"doc: {r['doc_title']}")
        if r.get("crash_report"):
            notes.append(f"crash report: {r['crash_report']}")
        lines.append(f"| {f} | {v} | {dialog} | {'; '.join(notes) if notes else '—'} |")
    lines.append("")
    lines.append("## Totals")
    lines.append("")
    for fmt in ("prism", "pzfx"):
        n = sum(1 for r in records if fmt_of(r.get("file", "")) == fmt)
        if not n:
            continue
        parts = ", ".join(
            f"{sum(1 for r in records if r.get('verdict') == v and fmt_of(r.get('file', '')) == fmt)}/{n} {v}"
            for v in ("CLEAN", "WARN", "FAIL", "CRASH"))
        lines.append(f"- **.{fmt}: {parts}**")
    lines.append(f"- **All files: {total} total — " +
                 ", ".join(f"{by_verdict.get(v, 0)} {v}"
                           for v in ("CLEAN", "WARN", "FAIL", "CRASH")) + "**")
    lines.append("")
    lines.append("Baseline to beat (Nov 17, 1.6.0-era exports): .prism 12/12 CRASH, "
                 ".pzfx 12/12 WARN. The fix is proven only when the same corpus "
                 "re-exported from 1.6.2 opens CLEAN.")
    md = "\n".join(lines) + "\n"
    (out_dir / "verdicts.md").write_text(md)
    summary = {
        "total": total,
        "by_verdict": dict(by_verdict),
        "by_verdict_and_format": {
            f"{v}/{fmt}": counts[(v, fmt)]
            for (v, fmt) in sorted(counts)},
        "records": records,
    }
    (out_dir / "verdicts.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
