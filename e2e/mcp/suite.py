# Titer CI regression suite (check/e2e-ci) — driven by MCP, not GUI clicks.
#
# Every case runs against the built debug app through its in-process MCP
# server (73 tools), the same driver pattern the readiness battery uses
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
#   - negative_control_*: a truncated export must fail to open — and if it
#     opens anyway, the control snapshots what it opened and says which it
#     is (identical = truncation damaged nothing, control too gentle;
#     different = corrupt input silently accepted as a partial project, a
#     real product finding, NOT a control flaw). A one-cell mutation of an
#     export must (a) be visible on reimport and (b) be flagged by the
#     comparator — so a green round-trip cannot be a rubber stamp. The
#     mutation matches numbers by VALUE (the .pzfx writer formats numbers
#     its own way: 378.0 -> "378", long floats rounded), never by string.
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
import re
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from client import Mcp, McpError  # noqa: E402
from cases_numeric import register_numeric_cases  # noqa: E402
from cases_state import register_state_cases  # noqa: E402
from cases_plotly_determinism import (  # noqa: E402
    c_plotly_svg_ids_deterministic, c_plotly_figure_svg_deterministic)

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
    # Plotly-determinism pins (cases_plotly_determinism.py, seq 189).
    "titer_build_graph", "titer_export_graph",
    "titer_create_figure", "titer_export_figure",
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
        assert len(names) == 73, f"expected 73 tools, got {len(names)}: {names}"
        assert not missing, f"missing tools: {missing}"
        return f"73 tools, all {len(NEEDED_TOOLS)} needed tools present"

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

    def check_export_markers(self, path, fmt):
        """File-level pin for the BUG-20/21 writer fixes (T-132, seq 175/176).

        Asserts the exported file carries the structural marker real Prism
        11.2.0 requires — the same check pin-writer-fix.py runs standalone
        (see e2e/prism/pin-writer-fix.py for the pre-fix FAIL demonstration
        on the Nov 13 qa roundtrip files). A build that regresses the
        writer fails HERE, before the reopen leg can rubber-stamp it.
        """
        if fmt == "prism":
            import zipfile
            with zipfile.ZipFile(path) as zf:
                sheets = [n for n in zf.namelist()
                          if n.startswith("data/sheets/") and n.endswith("/sheet.json")]
                assert sheets, f".prism export has no data sheets: {path}"
                for name in sheets:
                    doc = json.loads(zf.read(name))
                    cls = (doc.get("table") or {}).get("@class")
                    assert cls in ("DataTable", "XYDataTable"), (
                        f".prism export {os.path.basename(path)}: sheet "
                        f"{doc.get('title', name)!r} lacks table[\"@class\"] "
                        f"(got {cls!r}) — BUG-20: real Prism crashes on open")
        elif fmt == "pzfx":
            text = open(path, encoding="utf-8").read()
            el = '<Template dt:dt="bin.base64" xmlns:dt="urn:schemas-microsoft-com:datatypes"></Template>'
            assert el in text, (
                f".pzfx export {os.path.basename(path)} lacks the empty "
                f"<Template> element — BUG-21: real Prism shows its "
                f"XML-compliance warning on open")
            assert len(re.findall(r"<Template[\s>]", text)) == 1, (
                f".pzfx export {os.path.basename(path)}: expected exactly "
                f"one <Template> element")

    def _roundtrip_format(self, pid, snap, fmt, importer):
        out = os.path.join(self.out_dir, f"survival.{fmt}")
        saved = self.mcp.tool("titer_save_project", {
            "project_id": pid, "path": out, "format": fmt})
        size = os.path.getsize(out) if os.path.isfile(out) else -1
        assert size > 0, f"empty/missing .{fmt} export ({size} B): {saved}"
        self.check_export_markers(out, fmt)
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

    def snapshot_best_effort(self, pid, timeout_s=15):
        """Snapshot whatever tables have published (no hard fail if the
        project is the blank one — wait_tables_stable would time out on
        [Table 1] by design). Used by the negative controls, where the
        opened project may be blank or partial."""
        try:
            self.wait_tables_stable(pid, timeout_s=timeout_s)
        except McpError:
            pass
        return self.snapshot_tables(pid)

    def c_negative_truncated(self):
        src = os.path.join(self.out_dir, "demo.hlx")
        bad = os.path.join(self.out_dir, "demo-truncated.hlx")
        data = open(src, "rb").read()
        cut = max(1, len(data) // 2)
        with open(bad, "wb") as f:
            f.write(data[:cut])
        try:
            re_ = self.mcp.tool("titer_open_project", {"path": bad})
        except McpError as e:
            return f"truncated .hlx ({cut} of {len(data)} B) rejected: {str(e)[:200]}"
        # It opened without error — what did it open? Snapshot and compare:
        # identical means the truncation damaged nothing (control too
        # gentle); different means corrupt input was silently accepted as
        # a partial/blank project (a real product finding, not a control
        # flaw). Either way the case fails, but the detail says which.
        pid = re_.get("project_id")
        if not pid:
            raise AssertionError(f"open returned no error and no project_id: {str(re_)[:300]}")
        self.open_projects.append(pid)
        try:
            time.sleep(2)
            snap2 = self.snapshot_best_effort(pid)
            ok, detail = self.compare_snapshots(self.snap_demo, snap2)
            if ok:
                raise AssertionError(
                    f"truncated .hlx ({cut} of {len(data)} B) opened and is "
                    f"cell-identical to the original — the truncation damaged "
                    f"nothing; control too gentle")
            raise AssertionError(
                f"truncated .hlx ({cut} of {len(data)} B) opened WITHOUT error "
                f"as a DIFFERENT project ({detail}) — corrupt input silently accepted")
        finally:
            self.close(pid)

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
        # Match numbers by VALUE, not by string: the .pzfx writer formats
        # numbers its own way (378.0 -> "378", long floats rounded), so a
        # summary float's repr never appears literally in the XML. Find every
        # number token with its span, then pick a summary float whose value
        # occurs EXACTLY ONCE (a distinctive cell value, not a count or a
        # repeated metadata value).
        num_re = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")
        matches = list(num_re.finditer(xml))
        xml_numbers = [float(m.group(0)) for m in matches]

        def close(a, b):
            return abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))

        cands = []
        for v in self._numbers_in(self.snap_surv[0]["summary"]):
            if isinstance(v, float) and v not in cands:
                cands.append(v)
        chosen = None
        for v in cands:
            hits = [i for i, fv in enumerate(xml_numbers) if close(fv, v)]
            if len(hits) == 1:
                chosen = (v, hits[0])
                break
        if chosen is None:
            for v in cands:
                hits = [i for i, fv in enumerate(xml_numbers) if close(fv, v)]
                if hits:
                    chosen = (v, hits[0])
                    break
        assert chosen is not None, (
            f"no summary float found (by value) in the exported .pzfx XML — "
            f"control cannot mutate (candidates: {cands[:8]}, "
            f"xml number tokens: {len(xml_numbers)})")
        old_val, idx = chosen
        new_val = old_val + 1.0
        m = matches[idx]
        xml2 = xml[:m.start()] + repr(new_val) + xml[m.end():]
        bad = os.path.join(self.out_dir, "survival-mutated.pzfx")
        with open(bad, "w", encoding="utf-8") as f:
            f.write(xml2)
        pid, _ = self.import_file(bad)
        try:
            snap2 = self.snapshot_tables(pid)
            ok, detail = self.compare_snapshots(self.snap_surv, snap2)
            assert not ok, "comparator says mutated project is IDENTICAL to the original — rubber stamp"
            nums2 = self._numbers_in(snap2[0]["summary"])
            assert any(close(n, new_val) for n in nums2 if isinstance(n, float)), (
                f"mutated value {new_val} (from {old_val}) not visible in the "
                f"reimported table — reader ignored the file")
            return (f"cell {old_val} -> {new_val} in the XML is visible on reimport, and the "
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
        # Conversion lanes (check/e2e-conversion): numeric pins (seq 182),
        # state/dialog pins (seq 183), Plotly determinism pins (seq 189).
        # The plotly cases run after the survival import above (they reuse
        # self.pid_surv via _survival_table_id's fallback if needed).
        register_numeric_cases(self)
        register_state_cases(self)
        self.case("plotly_svg_ids_deterministic",
                  lambda: c_plotly_svg_ids_deterministic(self))
        self.case("plotly_figure_svg_deterministic",
                  lambda: c_plotly_figure_svg_deterministic(self))
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
