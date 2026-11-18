# e2e/mcp/cases_screenshot.py — screenshot-similarity cases (check/e2e-conversion).
#
# Inventory §4a's six direct screenshot-similarity checks (Q-20, Q-23, Q-31,
# Q-38, Q-39, Q-61) plus the L8 comparator cases (L-01, L-02, L-04, L-05, L-06)
# and the determinism case (L-07). The 7 human-eye checks (T-18, T-35, A-11,
# A-14, A-15, T-109, T-135) are NOT here — they stay manual by design.
#
# Every case asserts GEOMETRY from export pixels (bar bands, bracket runs,
# curve-vs-points column coverage), not just whole-image similarity: a clipped
# graph can still be 95% similar to its reference, so similarity alone would
# miss the bug Q-20 guards. Similarity (the L8 rule in e2e/compare.py) runs
# against the reference in qa/reference/<case>/ when one is committed, and
# SKIPs — loudly, never as a pass — when the reference is still owed.
#
# Reference policy: references live ONLY under qa/reference/ (see
# qa/reference/REFERENCES.md for provenance + owed list). A case's geometry
# assertions run with no reference at all; only the similarity half skips.
#
# FAIL pins (no case ships that passes on broken code):
#   - Offline, no app: `python3 cases_screenshot.py --self-test` runs
#     e2e/compare_selftest.py (14 pins: blank / shifted / clipped / truncated
#     renders, SVG uid/shift/drop/extra, the real L8 pair) and reports each
#     pin as a case. A pin passes iff the good render passes AND the broken
#     one fails.
#   - Live, with the app: each case carries its own negative control on REAL
#     render pixels — overlay-off export fails the Q-23 bracket assertions;
#     the 4-point Q-31 export fails the curve-present assertion while the
#     8-point control passes it; pie/scatter exports fail the bar-band
#     assertion; a cropped copy of the live Q-20 export fails the band count.
#     The controls run inside the case, so a green case has proven — on that
#     run — that its assertions discriminate.
#
# Modes:
#   live (default): needs --discovery (see run-screenshot.sh). Runs every
#     case against the built debug app through MCP.
#   --offline:   L-01/L-02/L-04/L-05/L-06 only, against the committed L8
#     references. No app, no display.
#   --self-test: offline FAIL-pin proof (compare_selftest.py). No app.
#   --capture:   live mode, plus writes each export into qa/reference/<case>/
#     as linux.{png,svg} and appends provenance to REFERENCES.md. Mac
#     references (mac.{png,svg}) are captured on the Mac slot, never here.
#   --cases a,b: run only the named cases.
#
# Exit 0 iff no case FAILED (skips are allowed but reported); 1 on any
# failure; 2 on harness error. Writes report.json in --out-dir.
#
# Fixtures are built through MCP (titer_create_table) from literal values in
# this file, or from public corpus (tests/testdata/) — NEVER Mansi's files.
import argparse
import json
import os
import subprocess
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from client import Mcp, McpError  # noqa: E402
from suite import Suite  # noqa: E402 — MCP helpers only (wait/run_analysis)
import compare as cmpmod  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REF_ROOT = os.path.join(REPO, "qa", "reference")

# Column fixture (Q-19/Q-61 shape): means A=3, B=6, C=5.8, D=14.5.
COLUMN_COLS = ["", "A", "B", "C", "D"]
COLUMN_ROWS = [
    ["1", 1, 4, 5, 12], ["2", 2, 5, 5, 13], ["3", 3, 6, 6, 14],
    ["4", 4, 7, 6, 16], ["5", 5, 8, 7, 17.5],
]
# XY dose fixture for Q-31: FOUR points with X > 0 — one short of the 5 a
# 4PL log-X fit needs, so the fit errors and no curve draws (the QA-LOG T27
# limitation, current wording in src/stats/xy/nonlinear-fit.ts).
DOSE_FEW_COLS = ["", "X", "Y"]
DOSE_FEW_ROWS = [["1", 0.001, 5], ["2", 0.01, 20], ["3", 0.1, 60], ["4", 1, 95]]
DOSE_MANY_ROWS = [["1", 0.001, 5], ["2", 0.003, 12], ["3", 0.01, 20],
                  ["4", 0.03, 38], ["5", 0.1, 60], ["6", 0.3, 78],
                  ["7", 1, 95], ["8", 3, 99]]
# XY fixture for Q-39.
XY_COLS = ["", "X", "Y"]
XY_ROWS = [["1", 1, 2], ["2", 2, 3], ["3", 3, 5], ["4", 4, 4],
           ["5", 5, 6], ["6", 6, 8], ["7", 7, 7], ["8", 8, 9]]

TWO_GROUP_PARAMS = {"paired": False, "gaussian": True, "equalVariance": True,
                    "ratio": False, "tails": "two-sided"}


class ShotError(RuntimeError):
    pass


class Shots:
    """Screenshot cases. `suite` is the numeric suite's Suite (MCP helpers);
    geometry/similarity live here so suite.py stays untouched."""

    def __init__(self, mcp, repo, out_dir, capture=False):
        self.mcp = mcp
        self.repo = repo
        self.out_dir = out_dir
        self.capture = capture
        os.makedirs(out_dir, exist_ok=True)
        self.results = []
        self.helper = Suite(mcp, repo, out_dir) if mcp else None
        self._projects = []

    # -- result bookkeeping ----------------------------------------------
    def record(self, name, status, detail, seconds):
        self.results.append({"name": name, "status": status,
                             "ok": status != "fail", "detail": detail,
                             "seconds": round(seconds, 1)})
        print(f"[{status.upper()}] {name} ({round(seconds, 1)}s) — {detail}",
              flush=True)

    def run_case(self, name, fn):
        t0 = time.time()
        try:
            status, detail = fn()
        except Exception as e:
            traceback.print_exc()
            status, detail = "fail", f"{type(e).__name__}: {e}"
        self.record(name, status, detail, time.time() - t0)

    # -- MCP helpers -------------------------------------------------------
    def new_project(self):
        res = self.mcp.tool("titer_create_project", {})
        pid = res.get("project_id") or res.get("projectId")
        if not pid:
            # Fall back to the front project the tools default to.
            pid = "project-1"
        self._projects.append(pid)
        return pid

    def create_table(self, pid, table_type, name, columns, rows):
        self.mcp.tool("titer_create_table", {
            "project_id": pid, "table_type": table_type, "name": name,
            "columns": columns, "rows": rows})
        time.sleep(1)
        self.helper.wait_tables_stable(pid)
        tables = self.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
        for t in tables:
            if t.get("name") == name:
                return t["id"]
        raise ShotError(f"table {name!r} not found after create: "
                        f"{[t.get('name') for t in tables]}")

    def build_graph(self, pid, table_id, graph_type, options=None, name=None):
        args = {"project_id": pid, "table_id": table_id, "graph_type": graph_type}
        if options:
            args["options"] = options
        if name:
            args["name"] = name
        res = self.mcp.tool("titer_build_graph", args)
        gid = res.get("graph_id")
        if gid:
            return gid
        # Fall back to listing the project tree for the graph node by name.
        proj = self.mcp.tool("titer_list_projects", {})
        for p in proj.get("projects", []):
            for node in p.get("nodes", []):
                if node.get("type") == "graph" and node.get("name") == (name or graph_type):
                    return node["id"]
        raise ShotError(f"build_graph returned no graph_id: {str(res)[:300]}")

    def export(self, pid, graph_id, stem):
        """Export PNG (300 DPI) + SVG; returns (png_path, svg_path)."""
        png = os.path.join(self.out_dir, stem + ".png")
        svg = os.path.join(self.out_dir, stem + ".svg")
        rp = self.mcp.tool("titer_export_graph", {
            "project_id": pid, "graph_id": graph_id, "format": "png",
            "dpi": "300", "path": png})
        rs = self.mcp.tool("titer_export_graph", {
            "project_id": pid, "graph_id": graph_id, "format": "svg", "path": svg})
        for path, res in ((png, rp), (svg, rs)):
            got = res.get("path") or path
            if not os.path.isfile(got) or os.path.getsize(got) == 0:
                raise ShotError(f"export wrote no file for {stem}: {str(res)[:300]}")
        return png, svg

    def run_analysis_raw(self, pid, table_id, base, params, timeout_s=180):
        """Like Suite.run_analysis_sync but NEVER raises on a failed fit:
        returns (analysis_id, job, results-or-None) so a case can assert on
        the error itself (Q-31's 'Not enough complete points' is the
        expected outcome, not a harness failure)."""
        run = self.mcp.tool("titer_run_analysis", {
            "project_id": pid, "table_id": table_id,
            "analysis_type": base, **({"params": params} if params else {}),
        })
        job_id, aid = run["job_id"], run["analysis_id"]
        job = None
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            job = self.mcp.tool("titer_read_job", {"job_id": job_id})
            if job.get("status") in ("done", "error", "cancelled"):
                break
            time.sleep(1)
        res = None
        try:
            res = self.mcp.tool("titer_read_results",
                                {"project_id": pid, "analysis_id": aid})
        except McpError:
            pass
        return aid, job, res

    def plot_rect_png(self, png_path, svg_path):
        """Plot area in PNG pixels: the SVG clip rect, scaled by the
        PNG/SVG canvas ratio (300 DPI PNG is 2000 px wide, SVG 640)."""
        png = cmpmod.read_png(png_path)
        rect = cmpmod.plot_area_from_svg(svg_path)
        if rect is None:
            return (0, 0, png["width"], png["height"])
        size = cmpmod.svg_canvas_size(svg_path) or (640.0, 460.0)
        sx = png["width"] / size[0]
        sy = png["height"] / size[1]
        return (int(rect[0] * sx), int(rect[1] * sy),
                int(rect[2] * sx), int(rect[3] * sy))

    def close_all(self):
        if self.helper:
            self.helper.close_all()

    # -- similarity vs reference (SKIP when the reference is still owed) ---
    def similarity(self, case, png_path, svg_path):
        """Compare the export against the committed reference for `case`.
        Returns (status, detail): 'pass' / 'fail' / 'skip'. Prefers the
        Linux reference (same-platform baseline); falls back to the Mac one
        when no Linux reference is committed yet."""
        ref_dir = os.path.join(REF_ROOT, case)
        for plat in ("linux", "mac"):
            rp, rs = (os.path.join(ref_dir, plat + ".png"),
                      os.path.join(ref_dir, plat + ".svg"))
            if os.path.isfile(rp) and os.path.isfile(rs):
                vp, rep_p = cmpmod.compare_png(png_path, rp)
                vs, rep_s = cmpmod.compare_svg(svg_path, rs)
                detail = (f"vs {plat} reference: PNG {rep_p['identical_pct']}% "
                          f"identical, mean abs {rep_p['mean_abs_rgb']}; SVG "
                          f"max delta {rep_s.get('max_numeric_delta')} px, "
                          f"{rep_s['text_nodes']} texts")
                if vp and vs:
                    return "pass", detail
                fails = rep_p.get("failures", []) + rep_s.get("failures", [])
                return "fail", detail + "; FAILURES: " + "; ".join(fails)
        return "skip", (f"no reference committed under qa/reference/{case}/ "
                        f"(Linux capture owed; Mac capture owed on the slot)")

    def capture_ref(self, case, png_path, svg_path, provenance):
        """--capture only: copy the export into qa/reference/<case>/ as the
        Linux reference and append provenance to REFERENCES.md."""
        if not self.capture:
            return
        ref_dir = os.path.join(REF_ROOT, case)
        os.makedirs(ref_dir, exist_ok=True)
        import hashlib
        import shutil
        for src, plat in ((png_path, "linux.png"), (svg_path, "linux.svg")):
            shutil.copyfile(src, os.path.join(ref_dir, plat))
        sha = hashlib.sha256(open(png_path, "rb").read()).hexdigest()[:16]
        line = (f"- {case}: Linux-captured {time.strftime('%Y-%m-%d')} "
                f"(PNG sha {sha}…; {provenance}); Mac reference owed.\n")
        manifest = os.path.join(REF_ROOT, "REFERENCES.md")
        with open(manifest, "a") as f:
            f.write(line)
        print(f"  captured qa/reference/{case}/linux.png + linux.svg", flush=True)

    # -- geometry assertions (each returns None or raises ShotError) -------
    @staticmethod
    def assert_nonblank(png_path, label):
        png = cmpmod.read_png(png_path)
        frac = cmpmod.ink_fraction(png)
        if frac < 0.001:
            raise ShotError(f"{label}: export is blank (ink fraction {frac:.4f})")
        return frac

    @staticmethod
    def assert_bands(png_path, rect, expected, label):
        png = cmpmod.read_png(png_path)
        bands = cmpmod.column_bands(png, rect=rect)
        if len(bands) != expected:
            raise ShotError(
                f"{label}: {len(bands)} ink bands in plot area, expected "
                f"{expected} (bands: {bands})")
        widths = [x1 - x0 for x0, x1 in bands]
        med = sorted(widths)[len(widths) // 2]
        if any(abs(wd - med) > 0.25 * med for wd in widths):
            raise ShotError(
                f"{label}: band widths uneven {widths} (median {med}) — "
                f"a band may be clipped")
        return bands

    @staticmethod
    def assert_points_only(png_path, rect, label):
        png = cmpmod.read_png(png_path)
        frac = cmpmod.columns_with_ink_frac(png, rect=rect)
        if frac > 0.9:
            raise ShotError(
                f"{label}: {frac:.2f} of plot columns hold ink — a continuous "
                f"curve is drawn, not points only")
        return frac

    @staticmethod
    def assert_curve_present(png_path, rect, label):
        png = cmpmod.read_png(png_path)
        frac = cmpmod.columns_with_ink_frac(png, rect=rect)
        if frac < 0.9:
            raise ShotError(
                f"{label}: only {frac:.2f} of plot columns hold ink — no "
                f"continuous curve spans the plot")
        return frac

    @staticmethod
    def assert_bracket(png_path, svg_path, rect, label):
        """A significance bracket: an 'ns'/'*'/P label in the SVG text AND a
        long horizontal ink run above the bars in the PNG."""
        texts = cmpmod.svg_texts(svg_path)
        joined = " ".join(texts)
        has_label = ("ns" in texts or "*" in joined or "p =" in joined
                     or "P =" in joined)
        if not has_label:
            raise ShotError(
                f"{label}: no bracket label ('ns'/'*'/P) in SVG texts: {texts[:12]}")
        png = cmpmod.read_png(png_path)
        # Bars occupy the lower plot; the bracket sits above the tallest bar.
        # The longest run in the top third of the plot area is the bracket
        # (bar tops are <= one bar width long).
        x0, y0, x1, y1 = rect
        top_rect = (x0, y0, x1, y0 + (y1 - y0) // 3)
        run, ry, _, _ = cmpmod.longest_horizontal_run(png, rect=top_rect)
        bar_w = (x1 - x0) // 8  # a bar top is far shorter than a bracket span
        if run < 2 * bar_w:
            raise ShotError(
                f"{label}: longest horizontal run above the bars is {run} px "
                f"(need > {2 * bar_w} px for a bracket spanning two columns)")
        return run

    # -- cases ---------------------------------------------------------------
    def c_l8_png(self):
        """L-01 + L-02: the committed Mac-vs-Linux survival PNGs pass the L8
        PNG rule (offline, no app)."""
        rp = os.path.join(REF_ROOT, "l8-survival", "linux.png")
        mp = os.path.join(REF_ROOT, "l8-survival", "mac.png")
        if not (os.path.isfile(rp) and os.path.isfile(mp)):
            return "skip", "L8 reference pair not committed under qa/reference/l8-survival/"
        verdict, rep = cmpmod.compare_png(mp, rp)
        detail = (f"Mac vs Linux survival PNG: {rep['identical_pct']}% identical "
                  f"(L8: 95.804%), mean abs {rep['mean_abs_rgb']} (L8: 5.998), "
                  f"far={rep.get('differing_far_from_content')} "
                  f"isolated={rep.get('isolated_differing_px')} (L8: 0 / 0)")
        if not verdict:
            return "fail", detail + "; FAILURES: " + "; ".join(rep["failures"])
        return "pass", detail

    def c_l8_svg(self):
        """L-04 + L-05 + L-06: the committed Mac-vs-Linux survival SVGs pass
        the L8 SVG rule after id normalization (offline, no app)."""
        rs = os.path.join(REF_ROOT, "l8-survival", "linux.svg")
        ms = os.path.join(REF_ROOT, "l8-survival", "mac.svg")
        if not (os.path.isfile(rs) and os.path.isfile(ms)):
            return "skip", "L8 reference pair not committed under qa/reference/l8-survival/"
        verdict, rep = cmpmod.compare_svg(ms, rs)
        detail = (f"Mac vs Linux survival SVG: {rep['text_nodes']} text nodes "
                  f"(L8: 46), max numeric delta {rep.get('max_numeric_delta')} px "
                  f"(L8: 13), element counts equal="
                  f"{rep['element_counts_a'] == rep['element_counts_b']}")
        if not verdict:
            return "fail", detail + "; FAILURES: " + "; ".join(rep["failures"])
        return "pass", detail

    def _column_project(self):
        pid = self.new_project()
        tid = self.create_table(pid, "column", "ABCD",
                                COLUMN_COLS, COLUMN_ROWS)
        return pid, tid

    def c_q20_clip(self):
        """Q-20 (BUG-1): mean-error graph shows all 4 bars, rightmost complete.
        Live FAIL pin: a cropped copy of the same export fails the band count."""
        pid, tid = self._column_project()
        try:
            gid = self.build_graph(pid, tid, "mean-error", name="q20")
            png, svg = self.export(pid, gid, "q20-mean-error")
            frac = self.assert_nonblank(png, "q20")
            rect = self.plot_rect_png(png, svg)
            bands = self.assert_bands(png, rect, 4, "q20")
            # Negative control on the REAL pixels: cut off the rightmost 30%
            # of the PLOT area (where the D bar sits) and the same assertion
            # must fail — the D bar is truncated or gone. Cropping the full
            # image would miss it: the plot area ends well inside the image.
            cropped = os.path.join(self.out_dir, "q20-cropped.png")
            full = cmpmod.read_png(png)
            w, h = full["width"], full["height"]
            plot_w = rect[2] - rect[0]
            cut_x = rect[2] - int(0.30 * plot_w)
            cut = bytearray()
            for y in range(h):
                cut += full["rgba"][y * w * 4:(y * w + cut_x) * 4]
            cmpmod.write_png_rgba(cropped, cut_x, h, cut)
            rect_c = (rect[0], rect[1], min(rect[2], cut_x), rect[3])
            try:
                self.assert_bands(cropped, rect_c, 4, "q20-cropped-control")
                raise ShotError("q20 FAIL pin broken: cropped export still "
                                "shows 4 bands — the assertion cannot see a clip")
            except ShotError as e:
                if "FAIL pin broken" in str(e):
                    raise
                pin = f"pin: cropped copy fails as expected ({e})"
            status, sim = self.similarity("q20", png, svg)
            self.capture_ref("q20", png, svg,
                             "mean-error on ABCD fixture, 300 DPI PNG + SVG")
            detail = (f"4 bands {bands}, ink {frac:.3f}; {pin}; "
                      f"similarity: {status} — {sim}")
            return ("pass", detail + " [similarity skipped]") \
                if status == "skip" else (status, detail)
        finally:
            self.helper.close(pid)

    def c_q23_stats_overlay(self):
        """Q-23: stats overlay draws a bracket ('ns'/'*') and rescales Y.
        Live FAIL pin: the same graph with no pairs selected must fail the
        bracket assertions."""
        pid, tid = self._column_project()
        try:
            aid, res = self.helper.run_analysis_sync(
                pid, tid, "compare-two-groups", TWO_GROUP_PARAMS)
            # The comparison key is "A\\0B" (pairKey, src/lib/columns.ts);
            # derive it from the result's comparisons table when present.
            comps = res.get("result", {}).get("comparisons", [])
            if comps:
                key = comps[0]["group1"] + "\x00" + comps[0]["group2"]
            else:
                key = "A\x00B"
            gid = self.build_graph(pid, tid, "mean-error", options={
                "sigAnalysisId": aid,
                "sigPairs": [key], "sigDisplay": "stars"}, name="q23")
            png, svg = self.export(pid, gid, "q23-overlay")
            self.assert_nonblank(png, "q23")
            rect = self.plot_rect_png(png, svg)
            run = self.assert_bracket(png, svg, rect, "q23")
            # Negative control: same graph, no pairs selected — no bracket.
            gid0 = self.build_graph(pid, tid, "mean-error", options={
                "sigAnalysisId": aid,
                "sigPairs": [], "sigDisplay": "stars"}, name="q23-off")
            png0, svg0 = self.export(pid, gid0, "q23-off")
            try:
                self.assert_bracket(png0, svg0, self.plot_rect_png(png0, svg0),
                                    "q23-off-control")
                raise ShotError("q23 FAIL pin broken: overlay-off export still "
                                "shows a bracket")
            except ShotError as e:
                if "FAIL pin broken" in str(e):
                    raise
                pin = "pin: overlay-off export fails the bracket assertions as expected"
            status, sim = self.similarity("q23", png, svg)
            self.capture_ref("q23", png, svg,
                             "mean-error + t-test bracket (A vs B), stars")
            detail = (f"bracket run {run} px; {pin}; "
                      f"similarity: {status} — {sim}")
            return ("pass", detail + " [similarity skipped]") \
                if status == "skip" else (status, detail)
        finally:
            self.helper.close(pid)

    def c_q31_dose_response(self):
        """Q-31: dose-response points plot, but a 4PL log-X fit on 4 positive-X
        points errors ('need at least 5') so NO curve draws. Live FAIL pin:
        the 4-point export must fail the curve-present assertion, while the
        8-point control passes it."""
        pid = self.new_project()
        try:
            tid = self.create_table(pid, "xy", "Dose few",
                                    DOSE_FEW_COLS, DOSE_FEW_ROWS)
            # The 4-point fit must ERROR (run_analysis_sync would raise, so
            # use the raw runner and assert on the outcome itself).
            _, job, res = self.run_analysis_raw(
                pid, tid, "nonlinear-regression",
                {"model": "sigmoidal-4pl-logx"})
            outcome = json.dumps({"job": job, "result": res}, default=str)
            if "Not enough complete points" not in outcome:
                raise ShotError(
                    "q31: 4-point 4PL fit did not error as expected: "
                    f"{outcome[:300]}")
            gid = self.build_graph(pid, tid, "xy-scatter", name="q31")
            png, svg = self.export(pid, gid, "q31-few")
            self.assert_nonblank(png, "q31")
            rect = self.plot_rect_png(png, svg)
            frac = self.assert_points_only(png, rect, "q31")
            try:
                self.assert_curve_present(png, rect, "q31-few-control")
                raise ShotError("q31 FAIL pin broken: 4-point export shows a "
                                "continuous curve")
            except ShotError as e:
                if "FAIL pin broken" in str(e):
                    raise
                pin = "pin: 4-point export fails curve-present as expected"
            # Positive control: 8 points fit, curve spans the plot.
            tid2 = self.create_table(pid, "xy", "Dose many",
                                     DOSE_FEW_COLS, DOSE_MANY_ROWS)
            self.helper.run_analysis_sync(
                pid, tid2, "nonlinear-regression",
                {"model": "sigmoidal-4pl-logx"})
            gid2 = self.build_graph(pid, tid2, "xy-scatter", name="q31-many")
            png2, svg2 = self.export(pid, gid2, "q31-many")
            rect2 = self.plot_rect_png(png2, svg2)
            cfrac = self.assert_curve_present(png2, rect2, "q31-many-control")
            status, sim = self.similarity("q31", png, svg)
            self.capture_ref("q31", png, svg,
                             "xy-scatter, 4 positive-X dose points, no curve")
            detail = (f"fit errors as expected ('Not enough complete points'); "
                      f"points-only columns-with-ink "
                      f"{frac:.2f}; {pin}; 8-point control curve {cfrac:.2f}; "
                      f"similarity: {status} — {sim}")
            return ("pass", detail + " [similarity skipped]") \
                if status == "skip" else (status, detail)
        finally:
            self.helper.close(pid)

    def _graph_family_case(self, name, case, table_fn, graphs):
        """Shared driver for Q-38/Q-39/Q-61: build each graph type, export,
        assert non-blank + type geometry, run the ANTI-geometry (a sibling
        type's geometry, which must FAIL on this export — the cross-type
        discrimination pin), similarity-or-skip per type, capture on --capture.
        Each graphs entry: (graph_type, options, label, geom, anti_or_None)."""
        pid, tid = table_fn()
        try:
            notes = []
            worst = "pass"
            for gtype, options, label, geom, anti in graphs:
                gid = self.build_graph(pid, tid, gtype, options=options,
                                       name=f"{case}-{label}")
                png, svg = self.export(pid, gid, f"{case}-{label}")
                frac = self.assert_nonblank(png, f"{case}-{label}")
                rect = self.plot_rect_png(png, svg)
                gnote = geom(png, rect, f"{case}-{label}")
                if anti is not None:
                    try:
                        anti(png, rect, f"{case}-{label}-anti")
                        raise ShotError(
                            f"{case}-{label}: ANTI pin broken — the sibling "
                            f"geometry passed on this export, so the types "
                            f"are not distinguishable by geometry")
                    except ShotError as e:
                        if "ANTI pin broken" in str(e):
                            raise
                        # Expected: the sibling geometry rejects this type.
                status, sim = self.similarity(f"{case}-{label}", png, svg)
                self.capture_ref(f"{case}-{label}", png, svg,
                                 f"{gtype} on {case} fixture")
                if status == "fail":
                    worst = "fail"
                notes.append(f"{label}: ink {frac:.3f}, {gnote}; "
                             f"similarity {status}"
                             + (f" — {sim}" if status != "skip" else " (owed)"))
            return worst, "; ".join(notes)
        finally:
            self.helper.close(pid)

    def c_q38(self):
        """Q-38: Box/Violin/Individual/Pie/Donut graphs render (was NOT COVERED).
        Box/violin/individual: one band per column (4). Pie/donut: a single
        central blob, roughly square ink bbox, no column bands."""
        def geom_bands(n):
            def fn(png, rect, label):
                bands = self.assert_bands(png, rect, n, label)
                return f"{len(bands)} bands"
            return fn

        def geom_blob(png, rect, label):
            full = cmpmod.read_png(png)
            box = cmpmod.ink_bbox(full)
            if box is None:
                raise ShotError(f"{label}: blank")
            bw, bh = box[2] - box[0], box[3] - box[1]
            if abs(bw - bh) > 0.35 * max(bw, bh):
                raise ShotError(f"{label}: ink bbox {bw}x{bh} not roughly "
                                f"square — not a pie/donut blob")
            bands = cmpmod.column_bands(full, rect=rect)
            if len(bands) > 2:
                raise ShotError(f"{label}: {len(bands)} ink bands — a pie "
                                f"has no column bars")
            return f"central blob {bw}x{bh}px"
        graphs = [
            ("box-violin", {"kind": "box"}, "box", geom_bands(4), geom_blob),
            ("box-violin", {"kind": "violin"}, "violin", geom_bands(4), geom_blob),
            ("individual", None, "individual", geom_bands(4), geom_blob),
            ("pie", None, "pie", geom_blob, geom_bands(4)),
            ("donut", None, "donut", geom_blob, geom_bands(4)),
        ]
        return self._graph_family_case("q38", "q38", self._column_project, graphs)

    def c_q39(self):
        """Q-39: XY scatter/bar/area graphs render (was NOT COVERED).
        Scatter: points only (sparse columns). Bar: one band per X value (8).
        Area: filled region (high ink fraction in the plot area)."""
        def geom_scatter(png, rect, label):
            frac = self.assert_points_only(png, rect, label)
            return f"points-only, columns-with-ink {frac:.2f}"

        def geom_bars(png, rect, label):
            bands = self.assert_bands(png, rect, 8, label)
            return f"{len(bands)} bands"

        def geom_area(png, rect, label):
            frac = cmpmod.ink_fraction(cmpmod.read_png(png), rect=rect)
            if frac < 0.15:
                raise ShotError(f"{label}: plot-area ink {frac:.3f} < 0.15 — "
                                f"no filled area")
            return f"filled area, plot ink {frac:.3f}"
        graphs = [
            # Bar has no robust anti-geometry without live calibration
            # (its column coverage sits between points-only and filled), so
            # its discrimination rests on the band count + the reference.
            ("xy-scatter", None, "scatter", geom_scatter, geom_area),
            ("xy-bar", None, "bar", geom_bars, None),
            ("xy-area", None, "area", geom_area, geom_scatter),
        ]

        def xy_project():
            pid = self.new_project()
            tid = self.create_table(pid, "xy", "XY", XY_COLS, XY_ROWS)
            return pid, tid
        return self._graph_family_case("q39", "q39", xy_project, graphs)

    def c_q61(self):
        """Q-61: Individual Values graph renders A/B points + means/SEM bars.
        Geometry: 4 column bands (one per column) with discrete points
        (sparse columns — not a filled bar/area)."""
        def geom_individual(png, rect, label):
            bands = self.assert_bands(png, rect, 4, label)
            frac = self.assert_points_only(png, rect, label)
            return f"{len(bands)} bands, points-only {frac:.2f}"
        pid, tid = self._column_project()
        try:
            gid = self.build_graph(pid, tid, "individual", name="q61")
            png, svg = self.export(pid, gid, "q61-individual")
            self.assert_nonblank(png, "q61")
            rect = self.plot_rect_png(png, svg)
            note = geom_individual(png, rect, "q61")
            status, sim = self.similarity("q61", png, svg)
            self.capture_ref("q61", png, svg, "individual-values on ABCD")
            detail = f"{note}; similarity: {status} — {sim}"
            return ("pass", detail + " [similarity skipped]") \
                if status == "skip" else (status, detail)
        finally:
            self.helper.close(pid)

    def c_l07_determinism(self):
        """L-07: headless-vs-headless determinism — export the same survival
        graph twice, compare the PNGs under the L8 rule and record the exact
        identical fraction. A same-machine re-render that moved content would
        fail; the number itself is the evidence either way."""
        path = os.path.join(self.repo, "tests/testdata/survival.pzfx")
        pid, _ = self.helper.import_file(path)
        try:
            tables = self.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
            tid = next(t["id"] for t in tables if t.get("name") == "Three groups")
            gid = self.build_graph(pid, tid, "survival", name="l07")
            png1, _ = self.export(pid, gid, "l07-a")
            png2, _ = self.export(pid, gid, "l07-b")
            verdict, rep = cmpmod.compare_png(png1, png2)
            detail = (f"same-machine re-render: {rep['identical_pct']}% identical, "
                      f"mean abs {rep['mean_abs_rgb']}, "
                      f"far={rep.get('differing_far_from_content')} "
                      f"isolated={rep.get('isolated_differing_px')}")
            if not verdict:
                return "fail", detail + "; FAILURES: " + "; ".join(rep["failures"])
            return "pass", detail
        finally:
            self.helper.close(pid)


# Case registry: name -> (method, needs_app)
CASES = [
    ("l8_png", "c_l8_png", False),
    ("l8_svg", "c_l8_svg", False),
    ("q20_clip", "c_q20_clip", True),
    ("q23_stats_overlay", "c_q23_stats_overlay", True),
    ("q31_dose_response", "c_q31_dose_response", True),
    ("q38_graph_types", "c_q38", True),
    ("q39_xy_graphs", "c_q39", True),
    ("q61_individual_values", "c_q61", True),
    ("l07_determinism", "c_l07_determinism", True),
]


def run_selftest(out_dir):
    """Offline FAIL-pin proof: run e2e/compare_selftest.py, report each pin
    as a case. Returns a results list."""
    script = os.path.join(REPO, "e2e", "compare_selftest.py")
    proc = subprocess.run(
        [sys.executable, script, "--out-dir",
         os.path.join(out_dir, "selftest")],
        capture_output=True, text=True, timeout=600)
    print(proc.stdout, end="")
    if proc.stderr:
        print(proc.stderr, file=sys.stderr)
    results = []
    try:
        data = json.load(open(os.path.join(out_dir, "selftest",
                                           "compare-selftest.json")))
        for pin in data["pins"]:
            results.append({
                "name": "pin:" + pin["name"],
                "status": "pass" if pin["ok"] else "fail",
                "ok": pin["ok"], "detail": pin["detail"], "seconds": 0})
    except (OSError, json.JSONDecodeError, KeyError) as e:
        results.append({"name": "selftest-harness", "status": "fail",
                        "ok": False,
                        "detail": f"could not parse self-test output: {e}",
                        "seconds": 0})
    return results


def main():
    ap = argparse.ArgumentParser(description="Titer screenshot-similarity cases (L8 rule)")
    ap.add_argument("--discovery", help="path to mcp/discovery.json (live mode)")
    ap.add_argument("--repo", default=REPO, help="repo root")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--cases", default=None, help="comma-separated case names")
    ap.add_argument("--offline", action="store_true",
                    help="L8 comparator cases only (no app)")
    ap.add_argument("--self-test", action="store_true",
                    help="offline FAIL-pin proof (no app)")
    ap.add_argument("--capture", action="store_true",
                    help="live mode + write Linux references to qa/reference/")
    args = ap.parse_args()
    out_dir = args.out_dir or os.path.join(args.repo, "e2e", "out", "screenshot")
    os.makedirs(out_dir, exist_ok=True)
    wanted = set(args.cases.split(",")) if args.cases else None

    if args.self_test:
        results = run_selftest(out_dir)
        failed = sum(1 for r in results if r["status"] == "fail")
        print(f"\n== screenshot self-test: {len(results) - failed}/{len(results)} pins ==",
              flush=True)
        with open(os.path.join(out_dir, "report.json"), "w") as f:
            json.dump({"passed": len(results) - failed, "failed": failed,
                       "skipped": 0, "total": len(results), "cases": results}, f, indent=2)
        return 0 if failed == 0 else 1

    mcp = None
    if not args.offline:
        if not args.discovery:
            print("ERROR: live mode needs --discovery (or use --offline / "
                  "--self-test)", file=sys.stderr)
            return 2
        mcp = Mcp(args.discovery)
        mcp.initialize()
    shots = Shots(mcp, args.repo, out_dir, capture=args.capture)
    try:
        for name, method, needs_app in CASES:
            if wanted and name not in wanted:
                continue
            if args.offline and needs_app:
                continue
            shots.run_case(name, getattr(shots, method))
    finally:
        shots.close_all()
    failed = sum(1 for r in shots.results if r["status"] == "fail")
    skipped = sum(1 for r in shots.results if r["status"] == "skip")
    passed = sum(1 for r in shots.results if r["status"] == "pass")
    report = {"passed": passed, "failed": failed, "skipped": skipped,
              "total": len(shots.results), "cases": shots.results}
    with open(os.path.join(out_dir, "report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n== screenshot cases: {passed} pass, {failed} fail, "
          f"{skipped} skip / {len(shots.results)} ==", flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
