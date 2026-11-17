# Titer CI regression suite (check/e2e-ci) — driven by MCP, not GUI clicks.
#
# Every case runs against the built debug app through its in-process MCP
# server (51 tools), the same driver pattern the readiness battery uses
# (work/battery_driver.py): import, run analysis, export, reopen, assert.
# Identical on Linux and Mac; no display-automation fragility.
#
# Pins (each case guards a real bug class with a pre-fix FAIL / post-fix
# PASS shape — exact values, round-trip identity, or a negative control):
#   - import_prism_demo: exact 14-table multiset for the public demo file.
#     Guards import regressions that drop/merge/rename tables.
#   - logrank_pin: exact log-rank values for survival.pzfx (chi-square
#     4.844, df 2, p 0.08876, measured by the app's own wizard on this file).
#     Guards analysis regressions that silently change results. The survival
#     call needs EXPLICIT params {curveTest: logrank, correction: holm} —
#     the battery passed {} and got "undefined is not an object
#     (evaluating 't.curveTest')" on every survival run.
#   - roundtrip_*: save as .hlx/.prism/.pzfx, close, reopen, and require the
#     tables cell-identical (names, types, column names AND values, compared
#     as a SORTED list so duplicate names — the demo has two "Data 6" tables
#     — are counted, not collapsed; the battery's (name, type) dict drops
#     one). Guards the duplicate-name-merge and column-shift round-trip
#     bugs (battery BUG-1 class).
#   - negative_control_*: a truncated export must fail to open, and a
#     one-cell mutation of an export must (a) be visible on reimport and
#     (b) be flagged by the comparator — so a green round-trip cannot be a
#     rubber stamp that ignores the file.
#   - invalid_file_rejects: a text file and a truncated .prism must reject
#     plainly, not open an empty project or crash.
#
# Fixtures are public corpus only (tests/testdata/) — NEVER Mansi's files.
#
# Usage: python3 suite.py --discovery <path/to/discovery.json>
#        --repo <repo root> [--out-dir <dir>] [--keep-open]
# Exit 0 iff every case passes. Writes report.json + a text summary.
import argparse
import hashlib
import json
import os
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from client import Mcp, McpError  # noqa: E402

# Exact (name, type, rows) multiset for tests/testdata/prism/prism2R-demo_dataset.prism,
# recorded by the readiness battery (slice 2, demo_dataset.pzfx — the byte-identical
# twin — and the Convert spec's "14 tables transferred" assertion).
DEMO_TABLES = sorted([
    ("Data - missing columns", "xy", 10),
    ("Data 6", "xy", 10),
    ("Data 6", "xy", 10),
    ("Grouped: Entering replicate data", "grouped", 5),
    ("Survival: Two groups", "survival", 17),
    ("XY: Entering mean with error values", "xy", 6),
    ("XY: Entering replicate data", "xy", 6),
    ("Y CV", "xy", 6),
    ("Y CVN", "xy", 6),
    ("Y SD", "xy", 6),
    ("Y SE", "xy", 6),
    ("Y SEN", "xy", 6),
    ("Y error", "xy", 6),
    ("Y high low", "xy", 6),
])

# Log-rank pin for tests/testdata/survival.pzfx ("Three groups", 3 groups):
# chi-square 4.844, df 2, p 0.08876 — measured by the app's own survival
# wizard on this file (plan 00 verification).
LOGRANK = {"chi": 4.844, "df": 2, "p": 0.08876}
LOGRANK_TOL = {"chi": 0.01, "p": 0.001}

NEEDED_TOOLS = [
    "titer_import_prism", "titer_open_project", "titer_close_project",
    "titer_list_tables", "titer_read_table_summary", "titer_list_jobs",
    "titer_run_analysis", "titer_read_job", "titer_read_results",
    "titer_save_project",
]

VOLATILE_KEYS = {"id", "table_id", "project_id"}


def canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def sha(obj):
    return hashlib.sha256(canon(obj).encode()).hexdigest()[:16]


def strip_volatile(obj):
    if isinstance(obj, dict):
        return {k: strip_volatile(v) for k, v in obj.items() if k not in VOLATILE_KEYS}
    if isinstance(obj, list):
        return [strip_volatile(v) for v in obj]
    return obj


class Suite:
    def __init__(self, mcp, repo, out_dir):
        self.mcp = mcp
        self.repo = repo
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.results = []
        self.open_projects = []

    # -- MCP helpers (battery pattern) -------------------------------------
    def wait_tables_stable(self, pid, timeout_s=60):
        """Poll list_tables until two consecutive reads agree — the snapshot
        can lag an open/import (the 08fe68af visibility-lag race). Two
        agreeing reads of the STALE blank project ([Table 1]) are NOT
        stability."""
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
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            try:
                jobs = self.mcp.tool("titer_list_jobs", {"project_id": pid}).get("jobs", [])
            except Exception:
                return
            if not any(j.get("status") == "Running" for j in jobs):
                return
            time.sleep(2)

    def run_analysis_sync(self, pid, table_id, base, params, timeout_s=180):
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
            raise McpError(f"run_analysis stayed busy: {last_err}")
        job_id, aid = run["job_id"], run["analysis_id"]
        job = None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            job = self.mcp.tool("titer_read_job", {"job_id": job_id})
            if job.get("status") in ("done", "error", "cancelled"):
                break
            time.sleep(1)
        if not job or job.get("status") != "done":
            raise McpError(
                f"job {job_id} ended {job.get('status') if job else 'unknown'}: {str(job)[:300]}")
        res = self.mcp.tool("titer_read_results", {"project_id": pid, "analysis_id": aid})
        if res.get("status") != "computed":
            raise McpError(f"results status {res.get('status')}: {str(res)[:300]}")
        return aid, res

    def snapshot_tables(self, pid):
        """Cell snapshot as a SORTED list of (name, type, summary-hash) —
        a list, not a (name, type) dict, so duplicate names are counted."""
        tables = self.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
        snap = []
        for t in tables:
            summ = self.mcp.tool("titer_read_table_summary", {
                "project_id": pid, "table_id": t["id"],
                "include_values": True, "max_rows": 1000})
            snap.append({
                "name": t.get("name"),
                "type": (t.get("table_type") or "").lower(),
                "rows": summ.get("rows"),
                "summary_sha": sha(strip_volatile(summ)),
                "summary": summ,
            })
        snap.sort(key=lambda s: (s["name"], s["type"], s["summary_sha"]))
        return snap

    @staticmethod
    def compare_snapshots(a, b):
        """True iff the two snapshots are cell-identical (names, types,
        rows, column names AND values). Returns (ok, detail)."""
        ka = [(s["name"], s["type"], s["rows"], s["summary_sha"]) for s in a]
        kb = [(s["name"], s["type"], s["rows"], s["summary_sha"]) for s in b]
        if ka == kb:
            return True, f"{len(a)} tables cell-identical"
        detail = []
        if len(ka) != len(kb):
            detail.append(f"table count {len(ka)} -> {len(kb)}")
        for x, y in zip(ka, kb):
            if x != y:
                detail.append(f"{x[0]!r} ({x[1]}): rows {x[2]}->{y[2]}, sha {x[3]}->{y[3]}")
        for x in ka[len(kb):]:
            detail.append(f"missing after reopen: {x[0]!r} ({x[1]})")
        for y in kb[len(ka):]:
            detail.append(f"extra after reopen: {y[0]!r} ({y[1]})")
        return False, "; ".join(detail)

    def close(self, pid):
        try:
            self.mcp.tool("titer_close_project", {"project_id": pid, "save": "discard"})
        except Exception:
            pass
        if pid in self.open_projects:
            self.open_projects.remove(pid)

    def close_all(self):
        for pid in list(self.open_projects):
            self.close(pid)

    def import_file(self, path):
        imp = self.mcp.tool("titer_import_prism", {"path": path})
        pid = imp["project_id"]
        self.open_projects.append(pid)
        time.sleep(1)
        self.wait_tables_stable(pid)
        self.wait_idle(pid)
        return pid, imp

    # -- case runner --------------------------------------------------------
    def case(self, name, fn):
        t0 = time.time()
        try:
            detail = fn()
            ok = True
        except Exception as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
            traceback.print_exc()
        dt = round(time.time() - t0, 1)
        self.results.append({"name": name, "ok": ok, "detail": detail, "seconds": dt})
        print(f"[{'PASS' if ok else 'FAIL'}] {name} ({dt}s) — {detail}", flush=True)
        return ok

    # -- cases --------------------------------------------------------------
    def c_tools_list(self):
        names = self.mcp.initialize()
        missing = [t for t in NEEDED_TOOLS if t not in names]
        assert len(names) == 51, f"expected 51 tools, got {len(names)}: {names}"
        assert not missing, f"missing tools: {missing}"
        return f"51 tools, all {len(NEEDED_TOOLS)} needed tools present"

    def c_import_prism_demo(self):
        path = os.path.join(self.repo, "tests/testdata/prism/prism2R-demo_dataset.prism")
        pid, _ = self.import_file(path)
        self.pid_demo = pid
        self.snap_demo = self.snapshot_tables(pid)
        got = sorted([(s["name"], s["type"], s["rows"]) for s in self.snap_demo])
        assert got == DEMO_TABLES, (
            f"table multiset mismatch:\n  expected: {DEMO_TABLES}\n  got:      {got}")
        return f"14 tables, exact name/type/rows multiset (incl. two 'Data 6')"

    def c_roundtrip_hlx_demo(self):
        out = os.path.join(self.out_dir, "demo.hlx")
        saved = self.mcp.tool("titer_save_project", {
            "project_id": self.pid_demo, "path": out, "format": "hlx"})
        size = os.path.getsize(out) if os.path.isfile(out) else -1
        assert size > 0, f"empty/missing .hlx export ({size} B): {saved}"
        self.close(self.pid_demo)
        re = self.mcp.tool("titer_open_project", {"path": out})
        pid2 = re["project_id"]
        self.open_projects.append(pid2)
        time.sleep(1)
        self.wait_tables_stable(pid2)
        self.wait_idle(pid2)
        snap2 = self.snapshot_tables(pid2)
        ok, detail = self.compare_snapshots(self.snap_demo, snap2)
        assert ok, f".hlx round-trip differs: {detail}"
        self.pid_demo = pid2
        self.snap_demo = snap2
        return f".hlx export {size} B, reopen: {detail}"

    def c_import_pzfx_survival(self):
        path = os.path.join(self.repo, "tests/testdata/survival.pzfx")
        pid, _ = self.import_file(path)
        self.pid_surv = pid
        self.snap_surv = self.snapshot_tables(pid)
        assert len(self.snap_surv) == 1, f"expected 1 table, got {len(self.snap_surv)}"
        t = self.snap_surv[0]
        assert t["name"] == "Three groups", f"expected 'Three groups', got {t['name']!r}"
        assert t["type"] == "survival", f"expected survival, got {t['type']!r}"
        return f"1 table 'Three groups' (survival, {t['rows']} rows)"

    def c_logrank_pin(self):
        tid = None
        tables = self.mcp.tool("titer_list_tables", {"project_id": self.pid_surv})["tables"]
        for t in tables:
            if t.get("name") == "Three groups":
                tid = t["id"]
        assert tid, "survival table 'Three groups' not found"
        _, res = self.run_analysis_sync(
            self.pid_surv, tid, "survival",
            {"curveTest": "logrank", "correction": "holm"})
        stats = {s["label"]: s["value"] for s in res["result"].get("stats", [])}
        chi, df, p = stats.get("Chi-square"), stats.get("df"), stats.get("P value")
        assert chi is not None and abs(chi - LOGRANK["chi"]) <= LOGRANK_TOL["chi"], \
            f"chi-square {chi} != {LOGRANK['chi']} ± {LOGRANK_TOL['chi']}"
        assert df == LOGRANK["df"], f"df {df} != {LOGRANK['df']}"
        assert p is not None and abs(p - LOGRANK["p"]) <= LOGRANK_TOL["p"], \
            f"p {p} != {LOGRANK['p']} ± {LOGRANK_TOL['p']}"
        return f"log-rank chi-square {chi} (exp {LOGRANK['chi']}), df {df}, p {p} (exp {LOGRANK['p']})"

    def _roundtrip_format(self, pid, snap, fmt, importer):
        out = os.path.join(self.out_dir, f"survival.{fmt}")
        saved = self.mcp.tool("titer_save_project", {
            "project_id": pid, "path": out, "format": fmt})
        size = os.path.getsize(out) if os.path.isfile(out) else -1
        assert size > 0, f"empty/missing .{fmt} export ({size} B): {saved}"
        self.close(pid)
        if importer == "open":
            re = self.mcp.tool("titer_open_project", {"path": out})
        else:
            re = self.mcp.tool("titer_import_prism", {"path": out})
        pid2 = re["project_id"]
        self.open_projects.append(pid2)
        time.sleep(1)
        self.wait_tables_stable(pid2)
        self.wait_idle(pid2)
        snap2 = self.snapshot_tables(pid2)
        ok, detail = self.compare_snapshots(snap, snap2)
        assert ok, f".{fmt} round-trip differs: {detail}"
        return pid2, snap2, f".{fmt} export {size} B, reopen: {detail}"

    def c_roundtrip_prism_survival(self):
        pid2, snap2, detail = self._roundtrip_format(
            self.pid_surv, self.snap_surv, "prism", "import")
        self.pid_surv, self.snap_surv = pid2, snap2
        return detail

    def c_roundtrip_pzfx_survival(self):
        pid2, snap2, detail = self._roundtrip_format(
            self.pid_surv, self.snap_surv, "pzfx", "import")
        self.pid_surv, self.snap_surv = pid2, snap2
        return detail

    def c_negative_truncated(self):
        src = os.path.join(self.out_dir, "demo.hlx")
        bad = os.path.join(self.out_dir, "demo-truncated.hlx")
        data = open(src, "rb").read()
        with open(bad, "wb") as f:
            f.write(data[: max(1, len(data) // 2)])
        try:
            re = self.mcp.tool("titer_open_project", {"path": bad})
        except McpError as e:
            return f"truncated .hlx ({len(data) // 2} of {len(data)} B) rejected: {str(e)[:200]}"
        pid = re.get("project_id")
        if pid:
            self.close(pid)
        raise AssertionError("truncated .hlx opened without error — corrupt input accepted")

    def _numbers_in(self, obj):
        out = []
        if isinstance(obj, dict):
            for v in obj.values():
                out += self._numbers_in(v)
        elif isinstance(obj, list):
            for v in obj:
                out += self._numbers_in(v)
        elif isinstance(obj, float):
            out.append(obj)
        return out

    def c_negative_mutated_pzfx(self):
        src = os.path.join(self.out_dir, "survival.pzfx")
        xml = open(src, encoding="utf-8", errors="replace").read()
        cands = []
        for v in self._numbers_in(self.snap_surv[0]["summary"]):
            s = repr(v)
            if "." in s and len(s) >= 4 and s not in cands:
                cands.append(s)
        mutated = None
        for s in cands[:8]:
            if xml.count(s) >= 1:
                new = repr(float(s) + 1.0)
                mutated = (s, new, xml.replace(s, new, 1))
                break
        assert mutated, (
            f"no summary float found in the exported .pzfx XML — control cannot "
            f"mutate (candidates: {cands[:8]})")
        old, new, xml2 = mutated
        bad = os.path.join(self.out_dir, "survival-mutated.pzfx")
        with open(bad, "w", encoding="utf-8") as f:
            f.write(xml2)
        pid, _ = self.import_file(bad)
        try:
            snap2 = self.snapshot_tables(pid)
            ok, detail = self.compare_snapshots(self.snap_surv, snap2)
            assert not ok, "comparator says mutated project is IDENTICAL to the original — rubber stamp"
            nums2 = self._numbers_in(snap2[0]["summary"])
            assert float(new) in nums2, (
                f"mutated value {new} not visible in the reimported table — reader ignored the file")
            return (f"cell {old} -> {new} in the XML is visible on reimport, and the "
                    f"comparator flags the difference ({detail})")
        finally:
            self.close(pid)

    def c_invalid_file_rejects(self):
        bad_text = os.path.join(self.out_dir, "not-a-prism.prism")
        with open(bad_text, "w") as f:
            f.write("this is not a Prism file\n")
        for path, label in [(bad_text, "text file as .prism")]:
            try:
                re = self.mcp.tool("titer_import_prism", {"path": path})
            except McpError as e:
                print(f"  {label}: rejected ({str(e)[:150]})", flush=True)
                continue
            pid = re.get("project_id")
            if pid:
                self.close(pid)
            raise AssertionError(f"{label} imported without error (project {pid})")
        demo = os.path.join(self.repo, "tests/testdata/prism/prism2R-demo_dataset.prism")
        bad_trunc = os.path.join(self.out_dir, "demo-truncated.prism")
        with open(bad_trunc, "wb") as f:
            f.write(open(demo, "rb").read()[:200])
        try:
            re = self.mcp.tool("titer_import_prism", {"path": bad_trunc})
        except McpError as e:
            return f"both invalid inputs rejected (text file; 200-byte truncated .prism: {str(e)[:150]})"
        pid = re.get("project_id")
        if pid:
            self.close(pid)
        raise AssertionError("200-byte truncated .prism imported without error")

    # -- main ---------------------------------------------------------------
    def run(self):
        self.case("tools_list", self.c_tools_list)
        self.case("import_prism_demo", self.c_import_prism_demo)
        self.case("roundtrip_hlx_demo", self.c_roundtrip_hlx_demo)
        self.case("import_pzfx_survival", self.c_import_pzfx_survival)
        self.case("logrank_pin", self.c_logrank_pin)
        self.case("roundtrip_prism_survival", self.c_roundtrip_prism_survival)
        self.case("roundtrip_pzfx_survival", self.c_roundtrip_pzfx_survival)
        self.case("negative_control_truncated", self.c_negative_truncated)
        self.case("negative_control_mutated_pzfx", self.c_negative_mutated_pzfx)
        self.case("invalid_file_rejects", self.c_invalid_file_rejects)
        self.close_all()
        passed = sum(1 for r in self.results if r["ok"])
        total = len(self.results)
        report = {"passed": passed, "total": total, "cases": self.results}
        with open(os.path.join(self.out_dir, "report.json"), "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n== MCP suite: {passed}/{total} passed ==", flush=True)
        return 0 if passed == total else 1


def main():
    ap = argparse.ArgumentParser(description="Titer MCP regression suite (CI)")
    ap.add_argument("--discovery", required=True, help="path to mcp/discovery.json")
    ap.add_argument("--repo", required=True, help="repo root (fixtures live in tests/testdata/)")
    ap.add_argument("--out-dir", default=None, help="exports + report dir (default e2e/out/mcp)")
    args = ap.parse_args()
    out_dir = args.out_dir or os.path.join(args.repo, "e2e", "out", "mcp")
    mcp = Mcp(args.discovery)
    suite = Suite(mcp, args.repo, out_dir)
    try:
        return suite.run()
    finally:
        suite.close_all()


if __name__ == "__main__":
    sys.exit(main())
