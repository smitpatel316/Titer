# Plotly-determinism pin cases (lane e2e-conv/plotly, Plane seq 189).
#
# Wiring (coordinator — do NOT edit e2e/mcp/suite.py from this lane):
#   1. Copy the two methods below into the Suite class in suite.py
#      (they use only self.mcp / self.out_dir / self.pid_surv /
#      self.import_file, exactly like the existing cases).
#   2. Add to Suite.run(), after the survival import (c_import_pzfx_survival):
#        self.case("plotly_svg_ids_deterministic", self.c_plotly_svg_ids_deterministic)
#        self.case("plotly_figure_svg_deterministic", self.c_plotly_figure_svg_deterministic)
#   3. Optionally extend NEEDED_TOOLS with "titer_build_graph",
#      "titer_export_graph", "titer_create_figure", "titer_export_figure".
#
# What they pin (L8 §4 cause 1, fixed by normalizePlotlySvg in
# src/views/graphs/plotly.ts, applied in the exporter only):
# Plotly draws a fresh per-render uid from Math.random(), so the same
# graph exported twice used to differ in SVG ids (defs-/topdefs-/clip-/
# legend-/trace-), and Plotly's toSVG also flips the root tag's attribute
# order (style="" vs viewBox="") run to run. After the fix the same
# graph exported twice on one machine is byte-identical in SVG, with
# the fixed ids defs-000000 / trace000000 / … (a figure's panels get
# per-panel scopes p0/p1/… so composed panels never share an id).
#
# Pre-fix FAIL shape (proven by e2e/plotly-determinism/harness.html on
# unmodified code, same export path via renderGraphImage):
#   export 1: defs-2ea9b1, trace7ac32c, tracea69f96
#   export 2: defs-811f9c, traceb01989, traced82c08
#   ids_equal False, bytes_equal False (ids only — the SVGs agreed
#   after id-normalization except the root-tag attribute order).
# Post-fix PASS (same harness, fixed code): ids_equal True,
# bytes_equal True over 4 exports; figure exports byte-identical with
# scopes p0/p1 and zero duplicate ids.
#
# Scope: SAME-MACHINE repeat determinism only. Cross-platform
# byte-equality is NOT asserted (font rasterization still differs,
# L8 cause 2) — screenshot tests keep the L8 similarity threshold.
# The comparator is untouched by this lane.
import os
import re

# The five Plotly random-id families (L8 §3 — the complete inventory,
# verified against the real L8 SVGs: every uid occurrence is one of
# these).
_PLOTLY_ID_RES = {
    "defs": re.compile(r"defs-[0-9a-f]{6}"),
    "topdefs": re.compile(r"topdefs-[0-9a-f]{6}"),
    "clip": re.compile(r"clip[0-9a-f]{6}[a-z]*"),
    "legend": re.compile(r"legend[0-9a-f]{6}"),
    "trace": re.compile(r"trace[0-9a-f]{6}"),
}

# The fixed ids the exporter normalizes to (normalizePlotlySvg default).
_FIXED_IDS = {
    "defs": {"defs-000000"},
    "topdefs": {"topdefs-000000"},
    "clip": {"clip000000x", "clip000000xy", "clip000000xyplot", "clip000000y"},
    "legend": {"legend000000"},
    "trace": {"trace000000"},
}


def _extract_ids(svg):
    return {k: sorted(set(rx.findall(svg))) for k, rx in _PLOTLY_ID_RES.items()}


def _survival_table_id(suite):
    """The 'Three groups' survival table — imports the fixture if the
    survival case hasn't run yet (the coordinator wires this after it,
    so this is a fallback, not the normal path)."""
    pid = getattr(suite, "pid_surv", None)
    if not pid:
        pid, _ = suite.import_file(os.path.join(suite.repo, "tests/testdata/survival.pzfx"))
        suite.pid_surv = pid
    tables = suite.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
    for t in tables:
        if t.get("name") == "Three groups":
            return pid, t["id"]
    raise AssertionError("survival table 'Three groups' not found")


def c_plotly_svg_ids_deterministic(self):
    """Same survival graph exported twice as SVG: ids identical AND
    bytes identical, and the ids are the fixed normalized ones."""
    pid, tid = _survival_table_id(self)
    built = self.mcp.tool("titer_build_graph", {
        "project_id": pid, "table_id": tid, "graph_type": "survival"})
    gid = built.get("graph_id")
    assert gid, f"build_graph returned no graph_id: {built}"
    svgs = []
    for n in (1, 2):
        out = os.path.join(self.out_dir, f"plotly-pin-{n}.svg")
        self.mcp.tool("titer_export_graph", {
            "project_id": pid, "graph_id": gid, "format": "svg", "path": out})
        assert os.path.isfile(out) and os.path.getsize(out) > 0, f"export {n} wrote no SVG"
        with open(out, encoding="utf-8") as f:
            svgs.append(f.read())
    ids1, ids2 = _extract_ids(svgs[0]), _extract_ids(svgs[1])
    assert ids1 == ids2, f"SVG ids differ between exports:\n  1: {ids1}\n  2: {ids2}"
    # NOTE (live-run fix): _extract_ids returns sorted LISTS per family
    # while _FIXED_IDS holds SETS — a list never equals a set, so the
    # comparison below always failed even when the ids were exactly the
    # fixed ones. Compare as sets (this also unblocks the byte-equality
    # assertion that follows).
    assert {k: set(v) for k, v in ids1.items()} == _FIXED_IDS, \
        f"ids are equal but not the fixed normalized ones: {ids1}"
    assert svgs[0] == svgs[1], (
        f"SVG bytes differ after id fix ({len(svgs[0])} vs {len(svgs[1])} B) — "
        f"ids match, so this is the root-tag attribute-order flip or a new "
        f"nondeterminism, not the uid")
    return (f"survival graph exported twice: {len(svgs[0])} B each, "
            f"byte-identical, ids fixed ({sorted(ids1['trace'])} …)")


def c_plotly_figure_svg_deterministic(self):
    """Two-panel figure exported twice as SVG: bytes identical, panels
    keep distinct id scopes, no duplicate id= in the composed file."""
    pid, tid = _survival_table_id(self)
    gids = []
    for _ in range(2):
        built = self.mcp.tool("titer_build_graph", {
            "project_id": pid, "table_id": tid, "graph_type": "survival"})
        assert built.get("graph_id"), f"build_graph returned no graph_id: {built}"
        gids.append(built["graph_id"])
    fig = self.mcp.tool("titer_create_figure", {
        "project_id": pid, "graph_ids": gids})
    fid = fig.get("figure_id")
    assert fid, f"create_figure returned no figure_id: {fig}"
    svgs = []
    for n in (1, 2):
        out = os.path.join(self.out_dir, f"plotly-figure-pin-{n}.svg")
        self.mcp.tool("titer_export_figure", {
            "project_id": pid, "figure_id": fid, "format": "svg", "path": out})
        assert os.path.isfile(out) and os.path.getsize(out) > 0, f"figure export {n} wrote no SVG"
        with open(out, encoding="utf-8") as f:
            svgs.append(f.read())
    assert svgs[0] == svgs[1], (
        f"figure SVG bytes differ between exports "
        f"({len(svgs[0])} vs {len(svgs[1])} B)")
    assert "clipp0" in svgs[0] and "clipp1" in svgs[0], (
        "figure panels did not keep distinct id scopes (clipp0/clipp1)")
    ids = re.findall(r'id="([^"]+)"', svgs[0])
    dups = sorted({v for v in ids if ids.count(v) > 1})
    assert not dups, f"duplicate ids in composed figure SVG: {dups}"
    return (f"2-panel figure exported twice: {len(svgs[0])} B each, "
            f"byte-identical, scopes p0/p1, no duplicate ids")
