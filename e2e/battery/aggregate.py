#!/usr/bin/env python3
"""Slice verdict aggregation + per-file table compilation (inventory Q-85).

Reads a battery run dir (per-file/*.jsonl + progress.json, the shape
``e2e/battery/runner.py`` writes — the same shape the original battery
driver used) and produces:

  - aggregate.json — verdict tally + one row per file (file, class,
    verdict, analyses ok/total, tables, bugs, exports/reimports ok)
  - aggregate.md  — the same table in Markdown, for the run report

Rules (same as the battery's running totals):
  - verdicts counted: PASS, PASS-REJECT, PARTIAL, FAIL, FAIL-IMPORT,
    FAIL-SNAPSHOT, FAIL-DRIVER.
  - a JSONL with NO verdict event is UNKNOWN — it is listed explicitly
    for manual triage (P-05 remainder: verdict-format reconciliation
    stays manual; the aggregator surfaces it, it does not guess).
  - a progress.json entry with no matching JSONL is also UNKNOWN.
  - the tally is computed from the JSONLs (source of truth); progress.json
    is cross-checked and any disagreement is reported, not silently fixed.

Usage:
  python3 e2e/battery/aggregate.py --run-dir <dir> [--out DIR]
  Exit 0 iff every file has a known verdict (UNKNOWNs make it exit 1 —
  they need the manual P-05 triage pass first).
"""
import argparse
import json
import os
import sys
from collections import Counter

VERDICTS = ("PASS", "PASS-REJECT", "PARTIAL", "FAIL", "FAIL-IMPORT",
            "FAIL-SNAPSHOT", "FAIL-DRIVER", "UNKNOWN")


def aggregate(run_dir):
    per_file = os.path.join(run_dir, "per-file")
    rows = []
    if os.path.isdir(per_file):
        for fn in sorted(os.listdir(per_file)):
            if not fn.endswith(".jsonl"):
                continue
            recs = [json.loads(l) for l in open(os.path.join(per_file, fn)) if l.strip()]
            verdicts = [r for r in recs if r.get("event") == "verdict"]
            analyses = [r for r in recs if r.get("event") == "analysis"]
            starts = [r for r in recs if r.get("event") == "start"]
            name = starts[0].get("file", fn[:-6]) if starts else fn[:-6]
            cls = starts[0].get("class", "?") if starts else "?"
            if verdicts:
                verdict = verdicts[-1].get("verdict", "UNKNOWN")
                n_bugs = verdicts[-1].get("bugs")
            else:
                verdict, n_bugs = "UNKNOWN", None
            n_ok = sum(1 for r in analyses if r.get("result", {}).get("ok"))
            rows.append({
                "file": name, "class": cls, "verdict": verdict,
                "analyses_ok": n_ok, "analyses_total": len(analyses),
                "bugs": n_bugs,
                "has_verdict_event": bool(verdicts),
            })
    prog_path = os.path.join(run_dir, "progress.json")
    prog = {"done": []}
    if os.path.isfile(prog_path):
        try:
            prog = json.load(open(prog_path))
        except Exception as e:
            prog = {"done": [], "error": str(e)}
    prog_files = {d.get("file"): d.get("verdict") for d in prog.get("done", [])}
    row_files = {r["file"] for r in rows}
    for f, v in prog_files.items():
        if f not in row_files:
            rows.append({"file": f, "class": "?", "verdict": "UNKNOWN",
                         "analyses_ok": 0, "analyses_total": 0, "bugs": None,
                         "has_verdict_event": False,
                         "note": "in progress.json, no per-file JSONL"})
    # Cross-check: progress.json verdict vs JSONL verdict.
    disagreements = []
    for r in rows:
        if r["file"] in prog_files and prog_files[r["file"]] != r["verdict"] \
                and r["verdict"] != "UNKNOWN":
            disagreements.append(
                f"{r['file']}: progress.json {prog_files[r['file']]} != JSONL {r['verdict']}")
    tally = Counter(r["verdict"] for r in rows)
    return {"tally": dict(tally), "rows": rows, "disagreements": disagreements,
            "progress_entries": len(prog_files)}


def write_outputs(run_dir, agg, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "aggregate.json"), "w") as f:
        json.dump(agg, f, indent=2)
    lines = ["# Battery slice aggregation", "",
             "## Tally",
             ""]
    for v in VERDICTS:
        if agg["tally"].get(v):
            lines.append(f"- {v}: {agg['tally'][v]}")
    lines += ["", "## Per-file table", "",
              "| file | class | verdict | analyses | bugs |",
              "|---|---|---|---|---|"]
    for r in sorted(agg["rows"], key=lambda r: r["file"]):
        bugs = "" if r["bugs"] is None else str(r["bugs"])
        lines.append(f"| {r['file']} | {r['class']} | {r['verdict']} | "
                     f"{r['analyses_ok']}/{r['analyses_total']} | {bugs} |")
    if agg["disagreements"]:
        lines += ["", "## progress.json disagreements (JSONL wins)", ""]
        lines += [f"- {d}" for d in agg["disagreements"]]
    unknowns = [r["file"] for r in agg["rows"] if r["verdict"] == "UNKNOWN"]
    if unknowns:
        lines += ["", "## UNKNOWN — needs manual triage (P-05 remainder)", ""]
        lines += [f"- {f}" for f in unknowns]
    with open(os.path.join(out_dir, "aggregate.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    return os.path.join(out_dir, "aggregate.json"), os.path.join(out_dir, "aggregate.md")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out_dir = args.out or args.run_dir
    agg = aggregate(args.run_dir)
    jpath, mpath = write_outputs(args.run_dir, agg, out_dir)
    total = sum(agg["tally"].values())
    print(f"== aggregate: {total} files: " +
          ", ".join(f"{v} {n}" for v, n in sorted(agg["tally"].items())))
    if agg["disagreements"]:
        print(f"   progress.json disagreements: {len(agg['disagreements'])}")
        for d in agg["disagreements"]:
            print(f"   - {d}")
    unknowns = [r["file"] for r in agg["rows"] if r["verdict"] == "UNKNOWN"]
    if unknowns:
        print(f"   UNKNOWN (manual triage, P-05): {', '.join(unknowns)}")
    print(f"   wrote {jpath} + {mpath}")
    return 0 if not unknowns else 1


if __name__ == "__main__":
    sys.exit(main())
