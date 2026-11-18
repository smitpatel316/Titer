#!/usr/bin/env python3
"""Battery runner — the readiness battery driver adopted into the E2E suite.

A stdlib-only port of the battery lane's driver
(``~/workspace/.helix-owed-items/battery-full-loop/work/battery_driver.py``,
proven over the 233-file battery on shipped 1.6.0/1.6.1) onto the suite's
own MCP client (``e2e/mcp/client.py``). Same per-file loop, same verdict
taxonomy, same JSONL / progress.json shape — so a run here is directly
comparable with the battery's runs.

Per file: import -> run the analyses the data supports -> export .hlx,
.pzfx, .prism -> re-import each export -> verify cell-identical tables
(column names AND values) + reproduced analyses (same results as the
first run, by canonical result hash).

Adoption differences vs the original driver (each is a named fix for a
hole the battery found):
  - SSE decode: ``client.parse_sse_payload`` decodes ``r.content`` as
    UTF-8 and splits on ``'\\n'`` only (Q-94 pin — the original
    latin-1 + ``splitlines()`` chopped 0x85 bytes and FAIL-SNAPSHOT'd
    3 files). See ``e2e/battery/test_sse_decode.py``.
  - Table matching: snapshots are SORTED LISTS keyed by stable table id
    with occurrence-index pairing inside each (name, type) group — never
    a (name, type) dict, which collapses duplicate names (Q-100: the
    demo has two "Data 6" tables; the battery's dict dropped one).
  - Snapshot failure is a FAIL-SNAPSHOT verdict (Q-94 taxonomy), not a
    silent driver error; the exception is logged, not swallowed.
  - Variant triage is recorded per file (Q-99): every planned variant
    ends as ran / not-run with the app's own reason ("not offered for
    <type> tables" short-circuits the rest of that type; data-shape
    errors keep the app's message).
  - progress.json is de-duplicated by file on write (the original
    appended, so a re-run left duplicate entries — the battery had to
    dedupe its Mac progress.json by hand). Shape is unchanged:
    ``{"done": [{"file": ..., "verdict": ...}]}``.
  - wait_tables_stable raises on timeout instead of returning silently
    on a stale snapshot (the blank-project [Table 1] guard is kept:
    two agreeing reads of the blank project are NOT stability).

Usage:
  python3 e2e/battery/runner.py <discovery.json> --files <manifest.json>
      --out-dir <dir> [--start N] [--count M] [--plan coverage-final.json]
  Files manifest: {"files": [{"path": ..., "class": "real|reject|synthetic|testdata"}]}
  Writes per-file JSONL to out-dir/per-file/<slug>.jsonl and resume state
  to out-dir/progress.json. Exit 0 only if every attempted file passed
  (expected-reject files pass when the import rejects plainly).

Variant -> (base analysis type, params) mapping: the 56 method-variant
keys from the growth lane's coverage-final.json resolve onto the code's
53 base types (src-tauri/src/mcp.rs ANALYSIS_TYPES):
  compare-two-groups:* via {paired, gaussian, equalVariance, ratio}
  binding-saturation:* via {model}; dose-response-special:* via {model}
  anderson-darling / dagostino-pearson / normality-kolmogorov-smirnov via
  shapiro-wilk + {test: ...}
"""
import argparse
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mcp"))
from client import Mcp, McpError  # noqa: E402

VERDICTS = ("PASS", "FAIL", "PARTIAL", "FAIL-IMPORT", "FAIL-SNAPSHOT", "PASS-REJECT")


# ------------------------------------------------------- variant -> (base, params)
def variant_to_call(variant):
    if variant.startswith("compare-two-groups:"):
        m = variant.split(":", 1)[1]
        base = {"paired": False, "gaussian": True, "equalVariance": True,
                "ratio": False, "tails": "two-sided"}
        if m == "unpaired-t":
            pass
        elif m == "welch-t":
            base["equalVariance"] = False
        elif m == "mann-whitney":
            base["gaussian"] = False
        elif m == "wilcoxon":
            base["gaussian"] = False
            base["paired"] = True
        elif m == "paired-t":
            base["paired"] = True
        elif m == "ratio-paired-t":
            base["paired"] = True
            base["ratio"] = True
        else:
            raise ValueError(f"unknown compare-two-groups variant {variant}")
        return ("compare-two-groups", base)
    if variant.startswith("binding-saturation:"):
        return ("binding-saturation", {"model": variant.split(":", 1)[1]})
    if variant.startswith("dose-response-special:"):
        return ("dose-response-special", {"model": variant.split(":", 1)[1]})
    if variant == "anderson-darling":
        return ("shapiro-wilk", {"test": "anderson-darling"})
    if variant == "dagostino-pearson":
        return ("shapiro-wilk", {"test": "dagostino-pearson"})
    if variant == "normality-kolmogorov-smirnov":
        return ("shapiro-wilk", {"test": "kolmogorov-smirnov"})
    return (variant, {})


def dataset_names(summary):
    cols = summary.get("columns") or []
    return [c.get("name") for c in cols if c.get("name")]


def param_attempts(variant, base, summary):
    """Param dicts to try, in order. Most analyses run on defaults; a few
    need their target/columns named (else they fail with a data-shape error
    that is a driver gap, not an app bug)."""
    if variant == "monte-carlo":
        return [{"targetAnalysis": "descriptive-statistics",
                 "summaryStatistic": "Mean", "repeats": 100, "seed": 42},
                {"targetAnalysis": "linear-regression",
                 "summaryStatistic": "Slope", "repeats": 100, "seed": 42},
                {"targetAnalysis": "correlation",
                 "summaryStatistic": "r", "repeats": 100, "seed": 42}]
    if variant == "nonlinear-regression":
        # model is REQUIRED ("Choose a standard curve to fit") — try the
        # standard dose-response curve, then decay, then a line.
        return [{"model": "sigmoidal-4pl-logx"},
                {"model": "one-phase-decay"},
                {"model": "line"}]
    if variant == "roc-curve":
        names = dataset_names(summary)
        attempts = [{}]
        if len(names) >= 2:
            attempts.append({"truth": names[1], "score": names[0]})
            attempts.append({"truth": names[0], "score": names[1]})
        return attempts
    if variant == "one-sample-t":
        return [{"hypotheticalValue": 0, "tails": "two-sided", "gaussian": True}]
    return [{}]


# Table types each base analysis can plausibly run on (Prism semantics;
# the driver tries candidate tables in import order until one succeeds).
APPLICABLE = {
    "descriptive-statistics": ["column", "multiple"],
    "frequency-distribution": ["column", "grouped"],
    "compare-two-groups": ["column"],
    "one-sample-t": ["column"],
    "anova": ["column"],
    "kruskal-wallis": ["column"],
    "rm-anova": ["column", "grouped"],
    "friedman": ["column"],
    "mixed-effects": ["grouped", "column"],
    "shapiro-wilk": ["column", "grouped"],
    "kolmogorov-smirnov": ["column"],
    "outliers": ["column", "xy", "grouped"],
    "monte-carlo": ["column", "xy"],
    "bland-altman": ["column"],
    "roc-curve": ["column"],
    "correlation": ["xy", "multiple", "column"],
    "linear-regression": ["xy", "multiple"],
    "deming-regression": ["xy"],
    "simple-logistic-regression": ["xy"],
    "area-under-curve": ["xy"],
    "nonlinear-regression": ["xy"],
    "dose-response-special": ["xy"],
    "binding-saturation": ["xy"],
    "binding-kinetics": ["xy"],
    "enzyme-inhibition": ["xy"],
    "spline-lowess": ["xy"],
    "two-way-anova": ["grouped"],
    "three-way-anova": ["grouped"],
    "multiple-t-tests": ["column", "grouped"],
    "nested-t-test": ["nested"],
    "nested-anova": ["nested"],
    "correlation-matrix": ["multiple", "column", "xy"],
    "multiple-regression": ["multiple", "xy"],
    "multiple-logistic-regression": ["multiple", "xy"],
    "poisson-regression": ["multiple", "xy", "column"],
    "principal-component-analysis": ["multiple", "column"],
    "k-means": ["multiple", "column"],
    "cox-proportional-hazards": ["survival"],
    "cox": ["survival"],
    "survival": ["survival"],
    "chi-square": ["contingency"],
    "mcnemar": ["contingency"],
    "transform-data": ["column", "xy", "grouped"],
    "transform-concentrations": ["xy"],
    "remove-baseline": ["column", "xy", "grouped"],
    "normalize": ["column", "xy", "grouped"],
    "transpose": ["column", "xy", "grouped"],
    "prune-rows": ["column", "xy", "grouped"],
    "fraction-of-total": ["column", "grouped"],
    "row-means-totals": ["column", "grouped"],
    "smooth-differentiate-integrate": ["xy"],
    "plot-function": ["xy"],
    "extract-rearrange": ["column", "xy", "grouped"],
}

# .pzfx / .prism writers FAIL the whole write on nested/multiple tables.
WRITER_UNSUPPORTED = {"nested", "multiple"}


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def sha(obj):
    return hashlib.sha256(canon(obj).encode()).hexdigest()[:16]


VOLATILE_KEYS = {"id", "table_id", "project_id"}


def strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: strip_volatile(v) for k, v in obj.items() if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [strip_volatile(v) for v in obj]
    return obj


def match_snapshots(snap0, snap1):
    """Pair tables across two snapshots of (supposedly) the same project.

    Q-100 fix: matching is by stable table id WITHIN a snapshot plus
    occurrence-index pairing inside each (name, type) group — never a
    (name, type) dict, which collapses duplicate names (the demo has two
    tables named "Data 6"). Cross-project ids are not stable (a reimport
    mints new ids), so pairing is: group both snapshots by (name, type),
    sort each group by summary hash, pair by index. Returns
    (pairs, missing, extra) where pairs is a list of (entry0, entry1).
    """
    def groups(snap):
        g = {}
        for e in snap:
            g.setdefault((e["name"], e["type"]), []).append(e)
        for k in g:
            g[k].sort(key=lambda e: e["summary_sha"])
        return g

    g0, g1 = groups(snap0), groups(snap1)
    pairs, missing, extra = [], [], []
    for key, lst0 in g0.items():
        lst1 = g1.get(key, [])
        for i, e0 in enumerate(lst0):
            if i < len(lst1):
                pairs.append((e0, lst1[i]))
            else:
                missing.append(e0)
    for key, lst1 in g1.items():
        lst0 = g0.get(key, [])
        for e1 in lst1[len(lst0):]:
            extra.append(e1)
    return pairs, missing, extra


# ---------------------------------------------------------------- per-file loop
class Runner:
    def __init__(self, mcp, out_dir, rerun_cap=3, hlx_rerun_cap=6):
        self.mcp = mcp
        self.out_dir = out_dir
        self.rerun_cap = rerun_cap
        self.hlx_rerun_cap = hlx_rerun_cap
        os.makedirs(os.path.join(out_dir, "per-file"), exist_ok=True)

    def log(self, slug, rec):
        rec["ts"] = time.strftime("%H:%M:%S")
        with open(os.path.join(self.out_dir, "per-file", slug + ".jsonl"), "a") as f:
            f.write(json.dumps(rec) + "\n")

    def wait_tables_stable(self, pid, timeout_s=60):
        """Poll list_tables until two consecutive reads agree (the snapshot
        can lag an open/import: list_tables may return ids the read path
        doesn't know yet, or the fresh-project 'Table 1' before the real
        tables publish). Two agreeing reads of the STALE blank project
        ([Table 1]) are NOT stability — a 17.7 MB .hlx took ~14 s to
        publish its 18 tables. Raises on timeout (adoption change: the
        original driver returned silently on a stale snapshot)."""
        prev = None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            try:
                tabs = self.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
            except Exception:
                time.sleep(1)
                continue
            cur = tuple((t.get("id"), t.get("name")) for t in tabs)
            blank = len(cur) == 1 and cur[0][1] == "Table 1"
            if cur == prev and cur and not blank:
                return
            prev = cur
            time.sleep(2)
        raise McpError(f"tables never stabilised for {pid} (last: {prev})")

    def wait_idle(self, pid, timeout_s=120):
        """Wait until the project window has no Running job (Q-102: big
        imports keep finalizing after the import tool returns; starting
        an analysis earlier gets 'Still waiting ... project window may
        be busy'). Returns True if idle, False on timeout — the caller
        records the outcome; a timeout here is a probe result, not a
        verdict by itself."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            try:
                jobs = self.mcp.tool("titer_list_jobs", {"project_id": pid}).get("jobs", [])
            except Exception:
                return True
            if not any(j.get("status") == "Running" for j in jobs):
                return True
            time.sleep(2)
        return False

    def run_analysis_sync(self, pid, table_id, base, params, timeout_s=180):
        # Retry on "Still waiting" (Q-102): the window may still be busy
        # with a previous job (import finalizing on big files).
        last_err = None
        for _ in range(12):
            try:
                run = self.mcp.tool("titer_run_analysis", {
                    "project_id": pid, "table_id": table_id,
                    "analysis_type": base, **({"params": params} if params else {}),
                })
                break
            except Exception as e:
                last_err = e
                if "Still waiting" in str(e):
                    time.sleep(5)
                    continue
                raise
        else:
            raise RuntimeError(f"run_analysis stayed busy: {last_err}")
        job_id, aid = run["job_id"], run["analysis_id"]
        job = None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            job = self.mcp.tool("titer_read_job", {"job_id": job_id})
            if job.get("status") in ("done", "error", "cancelled"):
                break
            time.sleep(1)
        if not job or job.get("status") != "done":
            raise RuntimeError(f"job {job_id} ended {job.get('status') if job else 'unknown'}: {str(job)[:300]}")
        res = self.mcp.tool("titer_read_results", {"project_id": pid, "analysis_id": aid})
        if res.get("status") != "computed":
            raise RuntimeError(f"results status {res.get('status')}: {str(res)[:300]}")
        return aid, res

    def snapshot_tables(self, pid):
        """Cell snapshot as a SORTED LIST of table entries keyed by stable
        table id — a list, not a (name, type) dict, so duplicate names are
        counted (Q-100). Each entry carries its summary hash over column
        names AND values."""
        tables = self.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
        snap = []
        for t in tables:
            summ = self.mcp.tool("titer_read_table_summary", {
                "project_id": pid, "table_id": t["id"],
                "include_values": True, "max_rows": 1000})
            snap.append({
                "id": t["id"],
                "name": t.get("name"),
                "type": (t.get("table_type") or "").lower(),
                "rows": summ.get("rows"),
                "summary_sha": sha(strip_volatile(summ)),
                "summary": summ,
            })
        snap.sort(key=lambda s: (s["name"], s["type"], s["summary_sha"]))
        return snap

    def close(self, pid):
        try:
            r = self.mcp.tool("titer_close_project", {"project_id": pid, "save": "discard"})
            return bool(r.get("closed"))
        except Exception as e:
            return f"close failed: {e}"

    def run_file(self, path, cls, plan_variants):
        name = os.path.basename(path)
        slug = name.replace(".", "_")
        file_out = os.path.join(self.out_dir, "exports", slug)
        os.makedirs(file_out, exist_ok=True)
        verdict = {"file": name, "path": path, "class": cls, "plan": plan_variants,
                   "import": None, "analyses": {}, "triage": {}, "exports": {},
                   "reimports": {}, "verdict": None, "bugs": []}
        self.log(slug, {"event": "start", "file": name, "class": cls})
        # 1. import
        try:
            imp = self.mcp.tool("titer_import_prism", {"path": path})
            pid = imp["project_id"]
            verdict["import"] = {"ok": True, "project_id": pid,
                                 "tables": imp.get("imported_tables"),
                                 "warnings": imp.get("warnings")}
        except Exception as e:
            verdict["import"] = {"ok": False, "error": str(e)[:500]}
            if cls == "reject":
                verdict["verdict"] = "PASS-REJECT"
                self.log(slug, {"event": "verdict", "verdict": "PASS-REJECT",
                                "import_error": str(e)[:300]})
                return verdict
            verdict["verdict"] = "FAIL-IMPORT"
            verdict["bugs"].append({"stage": "import", "error": str(e)[:500]})
            self.log(slug, {"event": "verdict", "verdict": "FAIL-IMPORT", "error": str(e)[:300]})
            return verdict
        if cls == "reject":
            verdict["verdict"] = "FAIL-REJECT-NOT-REJECTED"
            verdict["bugs"].append({"stage": "import", "error": "expected-reject file imported without error"})
            self.close(pid)
            return verdict
        time.sleep(1)  # post-import settle (08fe68af visibility-lag race)
        try:
            self.wait_tables_stable(pid)
            idle = self.wait_idle(pid)
            verdict["import"]["idle_after_import"] = idle
            snap0 = self.snapshot_tables(pid)
        except Exception as e:
            # Snapshot failure is FAIL-SNAPSHOT (Q-94 taxonomy), and the
            # exception is LOGGED — the original driver swallowed it, which
            # is how the 3 FAIL-SNAPSHOT files reached aggregation with
            # only a `start` event and no verdict.
            verdict["verdict"] = "FAIL-SNAPSHOT"
            verdict["bugs"].append({"stage": "snapshot", "error": str(e)[:500]})
            self.log(slug, {"event": "verdict", "verdict": "FAIL-SNAPSHOT",
                            "error": str(e)[:300]})
            self.close(pid)
            return verdict
        verdict["tables"] = [{"id": s["id"], "name": s["name"], "type": s["type"],
                              "rows": s["rows"],
                              "truncated": (s["rows"] or 0) > 1000}
                             for s in snap0]
        self.log(slug, {"event": "imported", "tables": verdict["tables"]})
        # 2. analyses the data supports (+ Q-99 triage recording)
        snap0_by_id = {s["id"]: s for s in snap0}
        for variant in plan_variants:
            base, params = variant_to_call(variant)
            cands = [s for s in snap0 if s["type"] in APPLICABLE.get(base, [])]
            ran = None
            last_err = None
            skipped_types = set()
            offered_types = sorted({s["type"] for s in cands})
            for entry in cands:
                ttype = entry["type"]
                if ttype in skipped_types:
                    continue
                for attempt in param_attempts(variant, base, entry["summary"]):
                    merged = dict(params)
                    merged.update(attempt)
                    try:
                        aid, res = self.run_analysis_sync(pid, entry["id"], base, merged)
                        ran = {"table_id": entry["id"], "table": entry["name"],
                               "analysis_id": aid, "hash": sha(res.get("result", res)),
                               "base": base, "params": merged}
                        break
                    except Exception as e:
                        last_err = str(e)[:300]
                        # "not offered for <type> tables" is per table TYPE, not
                        # per table — no other table of that type will offer it.
                        if "is not offered for" in last_err:
                            skipped_types.add(ttype)
                            break
                if ran:
                    break
            if ran:
                verdict["analyses"][variant] = {"ok": True, **ran}
                verdict["triage"][variant] = {"outcome": "ran", "offered_types": offered_types}
            else:
                if not cands:
                    # No table of an applicable type at all — record the
                    # reason as the error, never None (Q-99 audit requires
                    # every not-run variant to carry the app's reason).
                    last_err = (f"no table of an applicable type for {base} "
                                f"(applicable: {APPLICABLE.get(base, [])})")
                verdict["analyses"][variant] = {"ok": False, "error": last_err,
                                                "candidates": len(cands)}
                reason = "not-offered" if skipped_types else (
                    "no-candidate-table" if not cands else "data-shape-error")
                verdict["triage"][variant] = {"outcome": "not-run", "reason": reason,
                                              "offered_types": offered_types,
                                              "skipped_types": sorted(skipped_types),
                                              "error": last_err}
            self.log(slug, {"event": "analysis", "variant": variant,
                            "result": verdict["analyses"][variant]})
        # 3. exports (hlx, pzfx, prism)
        has_unsupported = any(s["type"] in WRITER_UNSUPPORTED for s in snap0)
        for fmt in ("hlx", "pzfx", "prism"):
            out_path = os.path.join(file_out, name.rsplit(".", 1)[0] + "." + fmt)
            try:
                saved = self.mcp.tool("titer_save_project", {
                    "project_id": pid, "path": out_path, "format": fmt})
                size = os.path.getsize(out_path) if os.path.isfile(out_path) else -1
                verdict["exports"][fmt] = {"ok": size > 0, "path": out_path,
                                           "size": size, "reported": saved}
                if size <= 0:
                    verdict["bugs"].append({"stage": f"export-{fmt}",
                                            "error": f"empty/missing export file ({size} bytes)"})
            except Exception as e:
                expect_fail = fmt in ("pzfx", "prism") and has_unsupported
                verdict["exports"][fmt] = {"ok": False, "error": str(e)[:500],
                                           "expected_fail": expect_fail}
                if not expect_fail:
                    verdict["bugs"].append({"stage": f"export-{fmt}", "error": str(e)[:500]})
            self.log(slug, {"event": "export", "format": fmt,
                            "result": verdict["exports"][fmt]})
            time.sleep(1)
        # 4. re-import each export + verify cells + re-run analyses
        for fmt in ("hlx", "pzfx", "prism"):
            exp = verdict["exports"][fmt]
            if not exp.get("ok"):
                verdict["reimports"][fmt] = {"ok": False, "skipped": "export failed",
                                             "expected": exp.get("expected_fail", False)}
                continue
            try:
                if fmt == "hlx":
                    re = self.mcp.tool("titer_open_project", {"path": exp["path"]})
                else:
                    re = self.mcp.tool("titer_import_prism", {"path": exp["path"]})
                pid2 = re["project_id"]
            except Exception as e:
                verdict["reimports"][fmt] = {"ok": False, "error": str(e)[:500]}
                verdict["bugs"].append({"stage": f"reimport-{fmt}", "error": str(e)[:500]})
                continue
            time.sleep(1)
            try:
                self.wait_tables_stable(pid2)
                self.wait_idle(pid2)
                snap1 = self.snapshot_tables(pid2)
            except Exception as e:
                verdict["reimports"][fmt] = {"ok": False, "error": f"snapshot: {e}"[:500]}
                verdict["bugs"].append({"stage": f"reimport-{fmt}-snapshot", "error": str(e)[:500]})
                self.close(pid2)
                continue
            pairs, missing, extra = match_snapshots(snap0, snap1)
            cell_ok, cell_detail = True, {}
            for s0, s1 in pairs:
                # compare cell values AND column names canonically (a rename
                # like MitoFactory -> 'MitoFactory 2' must count as DIFFERS)
                v0 = {"columns": [c.get("name") for c in s0["summary"].get("columns", [])],
                      "values": s0["summary"].get("values")}
                v1 = {"columns": [c.get("name") for c in s1["summary"].get("columns", [])],
                      "values": s1["summary"].get("values")}
                same = canon(v0) == canon(v1)
                if not same:
                    cell_ok = False
                cell_detail[f"{s0['name']} ({s0['type']}) #{s0['id']}"] = \
                    "identical" if same else "DIFFERS"
            for s0 in missing:
                cell_ok = False
                cell_detail[f"{s0['name']} ({s0['type']}) #{s0['id']}"] = "missing after reimport"
            for s1 in extra:
                cell_detail[f"extra: {s1['name']} ({s1['type']}) #{s1['id']}"] = "extra after reimport"
            # re-run a sample of the analyses that ran the first time; compare hashes
            rerun = {}
            ok_first = [v for v, f in verdict["analyses"].items() if f.get("ok")]
            cap = self.hlx_rerun_cap if fmt == "hlx" else self.rerun_cap
            sample = ok_first[:cap]
            snap1_by_key = {}
            for s1 in snap1:
                snap1_by_key.setdefault((s1["name"], s1["type"]), []).append(s1)
            for variant in sample:
                base, _ = variant_to_call(variant)
                first = verdict["analyses"][variant]
                params = first.get("params", {})
                orig = snap0_by_id[first["table_id"]]
                cands1 = snap1_by_key.get((orig["name"], orig["type"]), [])
                tid1 = cands1[0]["id"] if cands1 else None
                if tid1 is None:
                    rerun[variant] = {"ok": False, "error": "table missing after reimport"}
                    continue
                try:
                    _, res = self.run_analysis_sync(pid2, tid1, base, params)
                    h = sha(res.get("result", res))
                    rerun[variant] = {"ok": h == first["hash"], "hash": h,
                                      "first_hash": first["hash"]}
                except Exception as e:
                    rerun[variant] = {"ok": False, "error": str(e)[:300]}
            verdict["reimports"][fmt] = {"ok": cell_ok and all(r.get("ok") for r in rerun.values()),
                                         "cells": cell_detail, "rerun": rerun}
            if not verdict["reimports"][fmt]["ok"]:
                verdict["bugs"].append({"stage": f"reimport-{fmt}",
                                        "cells": cell_detail,
                                        "rerun": {k: v for k, v in rerun.items() if not v.get("ok")}})
            self.log(slug, {"event": "reimport", "format": fmt,
                            "result": verdict["reimports"][fmt]})
            self.close(pid2)
        self.close(pid)
        n_an_ok = sum(1 for a in verdict["analyses"].values() if a.get("ok"))
        # PASS: no bugs AND every export/reimport verified AND >=1 analysis ran
        # (or the file legitimately supports none — empty/edge tables).
        # Variant failures alone are per-variant data, not a file failure;
        # PARTIAL = verified round-trip but zero analyses ran.
        re_ok = all(r.get("ok") or r.get("expected") for r in verdict["reimports"].values())
        ex_ok = all(e.get("ok") or e.get("expected_fail") for e in verdict["exports"].values())
        if verdict["bugs"] or not (re_ok and ex_ok):
            verdict["verdict"] = "FAIL"
        elif n_an_ok == 0 and plan_variants != ["descriptive-statistics"]:
            verdict["verdict"] = "PARTIAL"
        else:
            verdict["verdict"] = "PASS"
        self.log(slug, {"event": "verdict", "verdict": verdict["verdict"],
                        "analyses_ok": f"{n_an_ok}/{len(plan_variants)}",
                        "bugs": len(verdict["bugs"])})
        return verdict


def record_progress(out_dir, base, verdict_value):
    """Append-or-replace this file's entry in progress.json (same shape
    as the battery driver, de-duplicated: the original appended, so
    re-runs left duplicate entries)."""
    prog_path = os.path.join(out_dir, "progress.json")
    done = {"done": []}
    if os.path.isfile(prog_path):
        try:
            done = json.load(open(prog_path))
        except Exception:
            done = {"done": []}
    done["done"] = [d for d in done.get("done", []) if d.get("file") != base]
    done["done"].append({"file": base, "verdict": verdict_value})
    json.dump(done, open(prog_path, "w"), indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("discovery")
    ap.add_argument("--files", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--start", type=int, default=0)
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--plan", default=None)
    ap.add_argument("--rerun-cap", type=int, default=3)
    ap.add_argument("--hlx-rerun-cap", type=int, default=6)
    args = ap.parse_args()

    manifest = json.load(open(args.files))
    files = manifest["files"][args.start:args.start + args.count]
    # plan: file basename -> [variants]
    plan = {}
    if args.plan:
        cov = json.load(open(args.plan))
        for variant, info in cov.get("items", {}).items():
            for bucket in ("real", "synthetic"):
                for f in info.get(bucket, []):
                    plan.setdefault(f, []).append(variant)
    mcp = Mcp(args.discovery)
    names = mcp.initialize()
    assert len(names) == 51, f"expected 51 tools, got {len(names)}"
    runner = Runner(mcp, args.out_dir, rerun_cap=args.rerun_cap,
                    hlx_rerun_cap=args.hlx_rerun_cap)
    results = []
    for entry in files:
        path, cls = entry["path"], entry["class"]
        base = os.path.basename(path)
        variants = sorted(set(plan.get(base, [])))
        if not variants:
            variants = ["descriptive-statistics"]  # fallback probe
            probe_only = True
        else:
            probe_only = False
        print(f"== {base} [{cls}] plan={variants} probe_only={probe_only}", flush=True)
        try:
            v = runner.run_file(path, cls, variants)
        except Exception as e:
            v = {"file": base, "path": path, "class": cls, "verdict": "FAIL-DRIVER",
                 "bugs": [{"stage": "driver", "error": repr(e)[:500]}]}
            print(f"   DRIVER ERROR: {e}", flush=True)
        v["probe_only"] = probe_only
        results.append(v)
        print(f"   -> {v['verdict']} bugs={len(v.get('bugs', []))}", flush=True)
        record_progress(args.out_dir, base, v["verdict"])
    n_pass = sum(1 for r in results if r["verdict"] in ("PASS", "PASS-REJECT"))
    print(f"SLICE: {n_pass}/{len(results)} pass; "
          f"{sum(1 for r in results if r['verdict'] == 'PARTIAL')} partial; "
          f"{sum(1 for r in results if r['verdict'] not in ('PASS', 'PASS-REJECT', 'PARTIAL'))} fail")
    return 0 if n_pass == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
