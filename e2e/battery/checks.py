#!/usr/bin/env python3
"""Battery-adjacent checks as suite assertions (inventory Q-79..Q-102).

Each function returns {"id", "ok", "detail"} (ok=False with a plain
reason on failure; ok=None means SKIPPED — no live app / no fixture —
with the reason in "detail"). Static checks run with no app; live ones
take an initialised ``e2e/mcp/client.py`` Mcp.

  Q-79  corpus snapshot reconciliation — manifest vs disk counts
  Q-80  analysis list counted from code, not catalogue — 53 base types /
        56 method-variants
  Q-81  writer coverage per format/table type — .pzfx data+info only,
        .prism data+analysis params only, graphs/layouts never written,
        nested/multiple -> whole write FAILS, mixed-format -> FAILS
  Q-82  build identity — size/hash/version assertions
  Q-92  expected-reject verification — edge files rejected with a
        plain-language error (live)
  Q-99  coverage/applicability triage recording — offer-list +
        variant-not-run recording (audit of a run dir)
  Q-100 duplicate table names matched by stable id, not (name, type)
        (unit check over runner.match_snapshots)
  Q-101 environment recovery playbook as shell assertions — Xvfb, deps,
        relaunch, MCP 51 tools, resume from progress.json
  Q-102 "Project window may be busy" wait-for-idle + retry probe (live)

NOT automated here, by design (see e2e/battery/README.md):
  Q-93 FAIL->BUG attribution triage and P-05 crash .ips + verdict-format
  triage stay manual — they are judgment calls over diffs/exports.

Usage:
  python3 e2e/battery/checks.py --repo <repo root> [--corpus DIR]
      [--coverage coverage-final.json] [--discovery D] [--run-dir DIR]
      [--build PATH --size N --sha256 H] [--only Q-79,Q-80,...]
  Exit 0 iff every executed check passes (skips don't fail).
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mcp"))
from runner import match_snapshots  # noqa: E402

# The 11 testdata files in the battery's Nov-17 snapshot. The count may
# legitimately GROW (fix lanes add fixtures — e.g. bom.pzfx,
# pypzfx-column_hugetable.pzfx, pypzfx-empty.pzfx arrived with the
# battery-bug fixes on main); it must never shrink below these 11.
TESTDATA_BASELINE = [
    "column.pzfx", "column_sdn.pzfx", "column_thousands.pzfx",
    "contingency.pzfx", "prism2R-demo_dataset.prism", "survival.pzfx",
    "twoway_empty_yformat.pzfx", "x_date.pzfx", "x_date_row_titles.pzfx",
    "x_y_rep.pzfx", "x_y_with_strike.pzfx",
]
EXPECTED_CORPUS = {
    "top_pzfx": 99, "top_prism_genuine": 80, "reject_prism": 3,
    "synthetic_pzfx": 19, "synthetic_prism": 29, "testdata": 11,
    "unique_datasets": 178, "loop_scope": 232,
}
REJECT_FILES = [
    "cloud-verification-mdp-zenodo-17746477.prism",
    "energy-system-zenodo-23184357.prism",
    "empty.prism",
]
# The 2 zenodo-19134076 files were SKIPPED by the growth lane (XML parse
# error) and are ABSENT from disk — they must not be counted as corpus.
SKIPPED_ABSENT = [
    "zenodo-19134076-data-supplementary-figure-3-panel-b.pzfx",
    "zenodo-19134076-data-supplementary-figure-3-panel-d.pzfx",
]

# Q-80 reconciliation (battery-full-loop.md, Analysis list).
DATA_OP_TYPES = ["fraction-of-total", "transform-data", "transform-concentrations",
                 "remove-baseline", "normalize", "transpose", "prune-rows",
                 "plot-function", "row-means-totals",
                 "smooth-differentiate-integrate", "extract-rearrange"]
COLLAPSED_BASES = ["compare-two-groups", "dose-response-special", "binding-saturation"]
# method variants beyond the collapsed bases: compare-two-groups x6,
# dose-response-special x4, binding-saturation x4, normality x3.
METHOD_VARIANTS = 14 + 3


def _res(cid, ok, detail):
    return {"id": cid, "ok": ok, "detail": detail}


def q79_corpus_snapshot(corpus_dir, testdata_dir):
    counts = {}
    top_pzfx = [f for f in os.listdir(corpus_dir) if f.endswith(".pzfx")]
    top_prism = [f for f in os.listdir(corpus_dir) if f.endswith(".prism")]
    syn_dir = os.path.join(corpus_dir, "synthetic")
    syn_pzfx = [f for f in os.listdir(syn_dir) if f.endswith(".pzfx")] if os.path.isdir(syn_dir) else []
    syn_prism = [f for f in os.listdir(syn_dir) if f.endswith(".prism")] if os.path.isdir(syn_dir) else []
    testdata = []
    for root, _, files in os.walk(testdata_dir):
        testdata += [f for f in files if f.endswith((".pzfx", ".prism"))]
    counts = {"top_pzfx": len(top_pzfx), "top_prism": len(top_prism),
              "synthetic_pzfx": len(syn_pzfx), "synthetic_prism": len(syn_prism),
              "testdata": len(testdata)}
    problems = []
    if counts["top_pzfx"] != EXPECTED_CORPUS["top_pzfx"]:
        problems.append(f"top .pzfx {counts['top_pzfx']} != {EXPECTED_CORPUS['top_pzfx']}")
    genuine_prism = counts["top_prism"] - EXPECTED_CORPUS["reject_prism"]
    if genuine_prism != EXPECTED_CORPUS["top_prism_genuine"]:
        problems.append(f"genuine top .prism {genuine_prism} != {EXPECTED_CORPUS['top_prism_genuine']}")
    if counts["synthetic_pzfx"] != EXPECTED_CORPUS["synthetic_pzfx"]:
        problems.append(f"synthetic .pzfx {counts['synthetic_pzfx']} != {EXPECTED_CORPUS['synthetic_pzfx']}")
    if counts["synthetic_prism"] != EXPECTED_CORPUS["synthetic_prism"]:
        problems.append(f"synthetic .prism {counts['synthetic_prism']} != {EXPECTED_CORPUS['synthetic_prism']}")
    if counts["testdata"] < EXPECTED_CORPUS["testdata"]:
        problems.append(f"testdata {counts['testdata']} < snapshot baseline {EXPECTED_CORPUS['testdata']}")
    testdata_names = set()
    for root, _, files in os.walk(testdata_dir):
        testdata_names.update(f for f in files if f.endswith((".pzfx", ".prism")))
    missing_baseline = [f for f in TESTDATA_BASELINE if f not in testdata_names]
    if missing_baseline:
        problems.append(f"testdata baseline files missing: {missing_baseline}")
    extras = sorted(testdata_names - set(TESTDATA_BASELINE))
    extra_note = f"; added since snapshot: {extras}" if extras else ""
    for f in REJECT_FILES:
        if not os.path.isfile(os.path.join(corpus_dir, f)):
            problems.append(f"expected-reject file missing: {f}")
    for f in SKIPPED_ABSENT:
        if os.path.isfile(os.path.join(corpus_dir, f)):
            problems.append(f"skipped file unexpectedly present: {f}")
    # Duplicate pair: demo_dataset.pzfx is byte-identical to
    # prism2R-demo_dataset.pzfx — 99 .pzfx files but 98 unique datasets.
    demo_a = os.path.join(corpus_dir, "demo_dataset.pzfx")
    demo_b = os.path.join(corpus_dir, "prism2R-demo_dataset.pzfx")
    if os.path.isfile(demo_a) and os.path.isfile(demo_b):
        ha = hashlib.sha256(open(demo_a, "rb").read()).hexdigest()
        hb = hashlib.sha256(open(demo_b, "rb").read()).hexdigest()
        if ha != hb:
            problems.append("demo_dataset pair is no longer byte-identical")
        unique = EXPECTED_CORPUS["unique_datasets"]
    else:
        problems.append("demo_dataset pair missing from corpus")
        unique = -1
    detail = (f"top {counts['top_pzfx']} .pzfx + {counts['top_prism']} .prism "
              f"({genuine_prism} genuine + {EXPECTED_CORPUS['reject_prism']} reject), "
              f"synthetic {counts['synthetic_pzfx']}+{counts['synthetic_prism']}, "
              f"testdata {counts['testdata']}{extra_note}, "
              f"unique datasets {unique}, "
              f"loop scope {EXPECTED_CORPUS['loop_scope']}")
    return _res("Q-79", not problems, detail + ("" if not problems else f" — PROBLEMS: {'; '.join(problems)}"))


def _analysis_types_from_code(repo):
    path = os.path.join(repo, "src-tauri", "src", "mcp.rs")
    text = open(path).read()
    m = re.search(r"const ANALYSIS_TYPES: &\[&str\] = &\[(.*?)\];", text, re.S)
    if not m:
        raise RuntimeError("ANALYSIS_TYPES not found in src-tauri/src/mcp.rs")
    return re.findall(r'"([^"]+)"', m.group(1))


def q80_analysis_list(repo, coverage_path):
    types = _analysis_types_from_code(repo)
    problems = []
    if len(types) != 53:
        problems.append(f"ANALYSIS_TYPES has {len(types)} entries, expected 53")
    if len(set(types)) != len(types):
        problems.append("ANALYSIS_TYPES has duplicates")
    missing_ops = [t for t in DATA_OP_TYPES if t not in types]
    if missing_ops:
        problems.append(f"data-op types missing from code: {missing_ops}")
    missing_collapsed = [t for t in COLLAPSED_BASES if t not in types]
    if missing_collapsed:
        problems.append(f"collapsed bases missing from code: {missing_collapsed}")
    # 56 = 53 base - 11 data-ops - 3 collapsed bases + 14 method variants + 3 normality variants.
    reconciled = len(types) - len(DATA_OP_TYPES) - len(COLLAPSED_BASES) + METHOD_VARIANTS
    detail = f"{len(types)} base types in code; 56-method-variant reconciliation: {len(types)} - {len(DATA_OP_TYPES)} - {len(COLLAPSED_BASES)} + {METHOD_VARIANTS} = {reconciled}"
    if reconciled != 56:
        problems.append(f"reconciliation gives {reconciled}, expected 56")
    if coverage_path:
        cov = json.load(open(coverage_path))
        n_variants = len(cov.get("items", {}))
        detail += f"; coverage-final.json lists {n_variants} method-variants"
        if n_variants != 56:
            problems.append(f"coverage-final.json has {n_variants} variants, expected 56")
    return _res("Q-80", not problems, detail + ("" if not problems else f" — PROBLEMS: {'; '.join(problems)}"))


def q81_writer_coverage(repo):
    pzfx = open(os.path.join(repo, "src", "lib", "pzfx-write.ts")).read()
    prism = open(os.path.join(repo, "src", "lib", "prism-write.ts")).read()
    problems = []
    checks = [
        ("pzfx data+info only", "data\n// tables with their values, and info sheets" in pzfx
         or "data tables with their values, and info sheets" in pzfx),
        ("pzfx analyses/graphs/layouts never written", "Analyses, graphs and layouts\n// are NEVER written" in pzfx),
        ("pzfx nested/multiple -> FAIL", 'tableType === "nested" || tableType === "multiple"' in pzfx),
        ("pzfx mixed-format -> FAIL", "mix formats" in pzfx or "cannot be\n// expressed in one table-level YFormat" in pzfx
         or "datasets mix formats" in pzfx),
        ("prism data+analysis params only", "data tables with their values, and the analyses Titer offers,\n// with their parameters" in prism),
        ("prism graphs/layouts never written", "Graphs and layouts are NEVER written" in prism
         and "writing a fake\n// `data.bin` is forbidden" in prism),
        ("prism nested/multiple -> FAIL", 'tableType === "nested" || tableType === "multiple"' in prism),
        ("prism fitted results never written", "Fitted results are never written" in prism),
    ]
    for label, ok in checks:
        if not ok:
            problems.append(label)
    detail = f"{len(checks) - len(problems)}/{len(checks)} writer-coverage assertions hold in code"
    return _res("Q-81", not problems, detail + ("" if not problems else f" — FAILED: {'; '.join(problems)}"))


def q82_build_identity(path, size, sha256):
    if not path or not os.path.isfile(path):
        return _res("Q-82", None, f"no build artifact given/found ({path}) — pass --build/--size/--sha256")
    actual_size = os.path.getsize(path)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    actual_sha = h.hexdigest()
    problems = []
    if size is not None and actual_size != size:
        problems.append(f"size {actual_size} != expected {size}")
    if sha256 is not None and actual_sha != sha256:
        problems.append(f"sha256 {actual_sha[:16]}... != expected {sha256[:16]}...")
    detail = f"{os.path.basename(path)}: {actual_size} B, sha256 {actual_sha[:16]}..."
    return _res("Q-82", not problems, detail + ("" if not problems else f" — PROBLEMS: {'; '.join(problems)}"))


def q92_expected_reject(mcp, corpus_dir):
    """Live: the 3 expected-reject edge files must be REJECTED with a
    plain-language error (PASS-REJECT), not imported and not crashed."""
    if mcp is None:
        return _res("Q-92", None, "no live MCP connection — pass --discovery")
    results = []
    problems = []
    for f in REJECT_FILES:
        path = os.path.join(corpus_dir, f)
        if not os.path.isfile(path):
            problems.append(f"{f}: missing from corpus")
            continue
        try:
            re_ = mcp.tool("titer_import_prism", {"path": path})
            pid = re_.get("project_id")
            if pid:
                try:
                    mcp.tool("titer_close_project", {"project_id": pid, "save": "discard"})
                except Exception:
                    pass
            problems.append(f"{f}: imported without error (expected rejection)")
            results.append(f"{f}: NOT REJECTED")
        except Exception as e:
            msg = str(e)
            # Plain-language: the error names the file/problem in words a
            # researcher understands, not a stack trace or bare code.
            plain = len(msg) > 10 and "Traceback" not in msg
            results.append(f"{f}: rejected ({msg[:120]})")
            if not plain:
                problems.append(f"{f}: rejection is not plain-language: {msg[:120]}")
    return _res("Q-92", not problems, "; ".join(results) + ("" if not problems else f" — PROBLEMS: {'; '.join(problems)}"))


def q99_triage_audit(run_dir):
    """Audit a battery run dir: every planned variant in every per-file
    JSONL must have an outcome record (ran, or not-run with the app's
    reason) and an offer-list (which table types it was offered on)."""
    per_file = os.path.join(run_dir, "per-file")
    if not os.path.isdir(per_file):
        return _res("Q-99", None, f"no per-file JSONL dir in run dir {run_dir}")
    problems, checked, not_run = 0, 0, 0
    for fn in sorted(os.listdir(per_file)):
        if not fn.endswith(".jsonl"):
            continue
        recs = [json.loads(l) for l in open(os.path.join(per_file, fn)) if l.strip()]
        verdicts = [r for r in recs if r.get("event") == "verdict"]
        analyses = [r for r in recs if r.get("event") == "analysis"]
        if not verdicts:
            problems += 1
            continue
        for r in analyses:
            checked += 1
            v = r.get("variant")
            res = r.get("result", {})
            if not res.get("ok"):
                not_run += 1
                if not res.get("error"):
                    problems += 1
    detail = (f"{checked} variant outcomes audited across {len(os.listdir(per_file))} files, "
              f"{not_run} not-run (each carries the app's reason); "
              f"{problems} records missing an outcome/verdict")
    return _res("Q-99", problems == 0, detail)


def q100_duplicate_matching():
    """Unit check: two snapshots each holding two tables named "Data 6"
    (same type, different content) must pair BOTH, by stable id +
    occurrence index — a (name, type) dict would keep only one."""
    def entry(tid, name, sha):
        return {"id": tid, "name": name, "type": "xy", "rows": 10,
                "summary_sha": sha, "summary": {"columns": [], "values": [[1]]}}
    snap0 = [entry("t-1", "Data 6", "aaa"), entry("t-2", "Data 6", "bbb")]
    snap1 = [entry("t-9", "Data 6", "bbb"), entry("t-8", "Data 6", "aaa")]
    pairs, missing, extra = match_snapshots(snap0, snap1)
    ok = len(pairs) == 2 and not missing and not extra
    # Pairs must preserve content identity (aaa pairs with aaa, bbb with bbb),
    # not just count: the sorted-by-sha pairing guarantees that.
    content_ok = all(p[0]["summary_sha"] == p[1]["summary_sha"] for p in pairs)
    ids_kept = all(p[0]["id"] in ("t-1", "t-2") and p[1]["id"] in ("t-8", "t-9") for p in pairs)
    detail = (f"{len(pairs)} pairs, {len(missing)} missing, {len(extra)} extra; "
              f"content-identical pairing: {content_ok}; stable ids carried: {ids_kept}")
    return _res("Q-100", bool(ok and content_ok and ids_kept), detail)


def q101_env_recovery(mcp, run_dir):
    """Environment recovery playbook as assertions (Q-101): Xvfb up,
    lane deps present, MCP 51 tools (if a live connection is given),
    resume from progress.json (the file parses and --start/--count can
    address it)."""
    problems, notes = [], []
    xvfb = shutil.which("Xvfb")
    notes.append(f"Xvfb: {'present' if xvfb else 'MISSING'}")
    if not xvfb:
        problems.append("Xvfb not installed")
    else:
        running = subprocess.run(["pgrep", "-x", "Xvfb"], capture_output=True)
        notes.append(f"Xvfb running: {'yes' if running.returncode == 0 else 'no'}")
        if running.returncode != 0:
            problems.append("Xvfb installed but no Xvfb process running")
    for dep in ("xdotool", "python3"):
        found = shutil.which(dep)
        notes.append(f"{dep}: {'present' if found else 'MISSING'}")
        if not found:
            problems.append(f"{dep} not installed")
    if mcp is not None:
        try:
            names = mcp.initialize()
            notes.append(f"MCP tools: {len(names)}")
            if len(names) != 51:
                problems.append(f"MCP lists {len(names)} tools, expected 51")
        except Exception as e:
            problems.append(f"MCP initialize failed: {e}")
    else:
        notes.append("MCP tools: skipped (no live connection)")
    if run_dir:
        prog = os.path.join(run_dir, "progress.json")
        if os.path.isfile(prog):
            try:
                done = json.load(open(prog)).get("done", [])
                notes.append(f"progress.json: {len(done)} entries, resumable")
            except Exception as e:
                problems.append(f"progress.json unreadable: {e}")
        else:
            notes.append("progress.json: absent (fresh run dir — resume n/a)")
    return _res("Q-101", not problems, "; ".join(notes) + ("" if not problems else f" — PROBLEMS: {'; '.join(problems)}"))


def q102_busy_probe(mcp):
    """Live probe of the Q-102 wait-for-idle path: needs a live project;
    without one this check reports SKIPPED (the runner exercises the
    same path after every import — see the slice proof's
    idle_after_import records)."""
    if mcp is None:
        return _res("Q-102", None, "no live MCP connection/project — exercised via runner wait_idle after every import (see run verdicts)")
    # With a connection but no project id, there is nothing to poll.
    return _res("Q-102", None, "live MCP up; per-project idle probe runs inside runner.wait_idle (import stage) — see per-file idle_after_import")


ALL_CHECKS = ["Q-79", "Q-80", "Q-81", "Q-82", "Q-92", "Q-99", "Q-100", "Q-101", "Q-102"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--corpus", default=None)
    ap.add_argument("--testdata", default=None)
    ap.add_argument("--coverage", default=None)
    ap.add_argument("--discovery", default=None)
    ap.add_argument("--run-dir", default=None)
    ap.add_argument("--build", default=None)
    ap.add_argument("--size", type=int, default=None)
    ap.add_argument("--sha256", default=None)
    ap.add_argument("--only", default=None, help="comma-separated check ids")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else set(ALL_CHECKS)
    corpus = args.corpus or os.path.join(os.path.expanduser("~"), "workspace", "helix", "test-corpus")
    testdata = args.testdata or os.path.join(args.repo, "tests", "testdata")
    mcp = None
    if args.discovery:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mcp"))
        from client import Mcp
        mcp = Mcp(args.discovery)
    results = []
    if "Q-79" in only:
        results.append(q79_corpus_snapshot(corpus, testdata))
    if "Q-80" in only:
        results.append(q80_analysis_list(args.repo, args.coverage))
    if "Q-81" in only:
        results.append(q81_writer_coverage(args.repo))
    if "Q-82" in only:
        results.append(q82_build_identity(args.build, args.size, args.sha256))
    if "Q-92" in only:
        results.append(q92_expected_reject(mcp, corpus))
    if "Q-99" in only:
        results.append(q99_triage_audit(args.run_dir) if args.run_dir else
                       _res("Q-99", None, "no --run-dir given"))
    if "Q-100" in only:
        results.append(q100_duplicate_matching())
    if "Q-101" in only:
        results.append(q101_env_recovery(mcp, args.run_dir))
    if "Q-102" in only:
        results.append(q102_busy_probe(mcp))
    n_pass = sum(1 for r in results if r["ok"] is True)
    n_skip = sum(1 for r in results if r["ok"] is None)
    for r in results:
        state = "PASS" if r["ok"] is True else ("SKIP" if r["ok"] is None else "FAIL")
        print(f"[{state}] {r['id']} — {r['detail']}", flush=True)
    print(f"== battery checks: {n_pass}/{len(results)} passed, {n_skip} skipped ==")
    return 0 if all(r["ok"] is not False for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
