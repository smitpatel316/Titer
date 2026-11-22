#!/usr/bin/env python3
"""Phase 2 live MCP smoke: initialize -> tools/list -> tools/call across
all 73 tools against a running Titer MCP server.

Reads endpoint + token from <app_data>/mcp/discovery.json (argv[1]).
Speaks Streamable HTTP directly (no bridge, no Claude Desktop sign-in):
POST JSON-RPC, parse SSE `data:` lines. Exit 0 only if every check
passes; prints a PASS/FAIL line per check.

PREREQUISITE: in Titer, Settings → AI Connections, turn on every group
under "What your AI can do" first — by default the server advertises
only the 5 read tools (contract §12), and this smoke drives all 59.

The script drives one deterministic flow on a fresh project it creates
itself (no fixture ids — every id it needs comes from a tool's own
output), plus the public `tests/testdata/survival.pzfx` fixture for the
Prism-import step. It closes every window it opens. Nothing here is a
test round on the code: this is the single end-pass smoke the merge
coordinator runs on the finished check branch (Smit Nov 16 18:34 rule).

Usage:
    python3 scripts/smoke-test-mcp-phase2.py <app_data>/mcp/discovery.json \
        [--out-dir <dir>] [--fixture <path/to/survival.pzfx>]
    # default out dir: a fresh temp dir (exports + saves land there)
    # default fixture: tests/testdata/survival.pzfx (repo root = script's parent's parent)

Cloud: with no account connected the eight non-status cloud tools must
fail plainly with the "Connect Box" message; with an account connected,
list/metadata must succeed on it. Live Box upload/download is out of
the smoke — the mock provider covers the conflict path in the suite.
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import time

import requests

EXPECTED_TOOLS = [
    # L1 read-only (3) + 1.7.4 discovery (3)
    "titer_list_projects", "titer_list_tables", "titer_read_table_summary",
    "titer_read_results", "titer_read_graph",
    "titer_read_job", "titer_list_jobs", "titer_cancel_job",
    "titer_read_figure", "titer_read_info_sheet", "titer_read_activity",
    "titer_send_feedback",
    "titer_project_summary", "titer_search", "titer_get_analysis_params",
    # 1.8 backup list (1)
    "titer_list_backups",
    # L2 project (7)
    "titer_create_project", "titer_open_project", "titer_save_project",
    "titer_import_prism", "titer_import_data_file", "titer_merge_project", "titer_close_project",
    # L3 tables (10)
    "titer_create_table", "titer_write_table", "titer_edit_table",
    "titer_freeze_table",
    "titer_refresh_linked_data",
    "titer_duplicate_table_family", "titer_rename_node", "titer_delete_node",
    "titer_reorder_nodes", "titer_undo", "titer_redo",
    # L4 analyses (5)
    "titer_run_analysis", "titer_rerun_analysis", "titer_freeze_analysis",
    "titer_clone_analysis", "titer_repoint_analysis",
    # L6 graphs / figures / info sheets / drawing objects (16)

    "titer_build_graph", "titer_update_graph", "titer_clone_graph",
    "titer_clone_figure", "titer_freeze_graph", "titer_freeze_figure",
    "titer_add_drawing_object", "titer_update_drawing_object",
    "titer_delete_drawing_object", "titer_arrange_drawing_objects",
    "titer_create_figure", "titer_update_figure",
    "titer_create_info_sheet", "titer_update_info_sheet",
    "titer_list_regenerable_graphs", "titer_regenerate_graphs",
    # L5 composites (4)
    "titer_simulate_data", "titer_apply_method", "titer_apply_wand",
    "titer_run_script",
    # L9 cloud (9)
    "titer_cloud_status", "titer_cloud_list", "titer_cloud_download",
    "titer_cloud_upload", "titer_cloud_upload_new",
    "titer_cloud_create_folder", "titer_cloud_move",
    "titer_cloud_metadata", "titer_cloud_revisions",
    # L8 export (5)
    "titer_export_graph", "titer_export_figure", "titer_export_office",
    "titer_export_table_data", "titer_export_all_graphs",
]
assert len(EXPECTED_TOOLS) == 73, len(EXPECTED_TOOLS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("discovery")
    ap.add_argument("--out-dir", default=None)
    ap.add_argument("--fixture", default=None)
    args = ap.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    fixture = args.fixture or os.path.join(repo_root, "tests", "testdata", "survival.pzfx")
    out_dir = args.out_dir or tempfile.mkdtemp(prefix="titer-mcp-phase2-")
    os.makedirs(out_dir, exist_ok=True)

    disc = json.load(open(args.discovery))
    endpoint = disc["endpoint"]
    token = disc["token"]

    H = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
        "Authorization": f"Bearer {token}",
    }
    session = requests.Session()
    sid = None
    fails = []

    def check(name, cond, detail=""):
        print(("PASS " if cond else "FAIL ") + name + (f" — {detail}" if detail else ""))
        if not cond:
            fails.append(name)

    def rpc(method, params=None, notif=False):
        nonlocal sid
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notif:
            body["id"] = rpc.counter
            rpc.counter += 1
        h = dict(H)
        if sid:
            h["Mcp-Session-Id"] = sid
        r = session.post(endpoint, headers=h, json=body, timeout=60)
        if not notif:
            if "mcp-session-id" in r.headers:
                sid = r.headers["mcp-session-id"]
            return parse(r)

    rpc.counter = 1

    def parse(r):
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        ct = r.headers.get("content-type", "")
        if "application/json" in ct:
            return r.json()
        # SSE: last non-empty data: line is the response — the server first
        # sends an empty keepalive frame (`data: ` + `id: 0` + `retry: 3000`),
        # which is not JSON and must be skipped.
        data = None
        for line in r.text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    data = json.loads(payload)
        if data is None:
            raise RuntimeError(f"no data frame in SSE response: {r.text[:200]}")
        return data

    def tool_raw(name, arguments=None):
        out = rpc("tools/call", {"name": name, "arguments": arguments or {}})
        if "error" in out:
            raise RuntimeError(f"{name} RPC error: {out['error']}")
        return out["result"]

    def tool(name, arguments=None):
        res = tool_raw(name, arguments)
        if res.get("isError"):
            text = "".join(c.get("text", "") for c in res.get("content", []))
            raise RuntimeError(f"{name} tool error: {text[:300]}")
        text = "".join(c.get("text", "") for c in res.get("content", []))
        return json.loads(text)

    def tool_error_text(name, arguments=None):
        res = tool_raw(name, arguments)
        if not res.get("isError"):
            raise RuntimeError(f"{name} unexpectedly succeeded")
        return "".join(c.get("text", "") for c in res.get("content", []))

    def check_file(name, path, magic=None):
        ok = os.path.isfile(path)
        if ok and magic is not None:
            with open(path, "rb") as f:
                ok = f.read(len(magic)) == magic
        check(name, ok, path)
        return ok

    # 1. initialize
    init = rpc("initialize", {
        "protocolVersion": "2025-11-25",
        "capabilities": {},
        "clientInfo": {"name": "phase2-smoke", "version": "1"},
    })
    check("initialize negotiates 2025-11-25",
          init["result"]["protocolVersion"] == "2025-11-25",
          init["result"]["protocolVersion"])
    check("initialize instructions name 73 tools",
          "73 tools" in init["result"].get("instructions", ""),
          init["result"].get("instructions", "")[:80])
    rpc("notifications/initialized", notif=True)

    # 2. tools/list shows all 73 tools, one page
    lst = rpc("tools/list")
    names = [t["name"] for t in lst["result"]["tools"]]
    check("tools/list returns 73 tools", len(names) == 73, f"{len(names)}")
    check("tools/list has no nextCursor", "nextCursor" not in lst["result"])
    for want in EXPECTED_TOOLS:
        check(f"tools/list has {want}", want in names)
    print("tools:", ", ".join(names))

    # 3. project: create a fresh one
    proj = tool("titer_create_project")
    pid = proj["project_id"]
    check("create_project returns a project_id", bool(pid), pid)
    check("create_project blank, no file", proj.get("blank") is True and proj.get("file_path") is None)

    # 4. tables: XY with data, Column empty then written. Column 0 is ""
    # on purpose (v1.6 F2: the row-title column may be empty), and the
    # write omits `excluded` (v1.6 F5: omitted means preserve the marks).
    xy = tool("titer_create_table", {"project_id": pid, "table_type": "xy",
                                     "name": "Smoke XY",
                                     "columns": ["", "X", "Y1"],
                                     "rows": [["1", 1, 2], ["2", 2, 4], ["3", 3, 6],
                                              ["4", 4, 8], ["5", 5, 10]]})
    tid_xy = xy["table_id"]
    check("create_table xy returns id + 5 rows",
          bool(tid_xy) and xy.get("rows") == 5, json.dumps(xy)[:160])
    col = tool("titer_create_table", {"project_id": pid, "table_type": "column",
                                      "name": "Smoke Column"})
    tid_col = col["table_id"]
    check("create_table column (empty) returns id", bool(tid_col), tid_col)
    wrote = tool("titer_write_table", {"project_id": pid, "table_id": tid_col,
                                       "columns": ["", "A", "B"],
                                       "rows": [["r1", 1.0, 2.0], ["r2", 3.0, 4.0],
                                                ["r3", 5.0, 6.0], ["r4", 7.0, 8.0]]})
    check("write_table replaces whole data (4 rows)", wrote.get("rows") == 4, json.dumps(wrote)[:160])
    summ = tool("titer_read_table_summary", {"project_id": pid, "table_id": tid_xy,
                                             "include_values": True, "max_rows": 5})
    check("read_table_summary with values (5 rows)",
          len((summ.get("values") or {}).get("rows", [])) == 5 or summ.get("rows") == 5,
          json.dumps(summ)[:200])
    tables = tool("titer_list_tables", {"project_id": pid})
    check("list_tables shows both tables",
          {t["id"] for t in tables["tables"]} >= {tid_xy, tid_col},
          json.dumps(tables["tables"])[:200])

    # 5. edit / rename / reorder / undo / redo
    edited = tool("titer_edit_table", {"project_id": pid, "table_id": tid_xy,
                                       "op": "rename-column", "column": 1, "name": "Time"})
    check("edit_table rename-column", edited.get("table_id") == tid_xy)
    renamed = tool("titer_rename_node", {"project_id": pid, "node_id": tid_col, "name": "Smoke Col"})
    check("rename_node", renamed.get("name") == "Smoke Col")
    # A fresh project seeds a default empty "Table 1" (15 data columns,
    # 0 rows), so the reorder must list ALL root tables, not just the two
    # the script created — a 2-item order is correctly rejected by the app.
    tables_now = tool("titer_list_tables", {"project_id": pid})["tables"]
    others = [t["id"] for t in tables_now if t["id"] not in (tid_col, tid_xy)]
    want_order = [tid_col, tid_xy] + others
    reord = tool("titer_reorder_nodes", {"project_id": pid, "order": want_order})
    check("reorder_nodes root", reord.get("order") == want_order, json.dumps(reord)[:160])
    undone = tool("titer_undo", {"project_id": pid})
    check("undo returns a label + can_redo",
          undone.get("undone") is not None and undone.get("can_redo") is True,
          json.dumps(undone)[:160])
    redone = tool("titer_redo", {"project_id": pid})
    check("redo returns a label + can_undo",
          redone.get("redone") is not None and redone.get("can_undo") is True,
          json.dumps(redone)[:160])

    # 6. duplicate family + simulate data
    dup = tool("titer_duplicate_table_family", {"project_id": pid, "table_id": tid_xy})
    tid_dup = dup["table_id"]
    check("duplicate_table_family returns a new id", bool(tid_dup) and tid_dup != tid_xy, tid_dup)
    sim = tool("titer_simulate_data", {"project_id": pid, "table_type": "column",
                                       "distribution": "gaussian", "n": 10, "datasets": 2,
                                       "seed": 42, "mean": 0, "sd": 1})
    tid_sim = sim["table_id"]
    check("simulate_data gaussian returns a table (10 rows)",
          bool(tid_sim) and sim.get("rows") == 10, json.dumps(sim)[:160])

    # 7. run an analysis (async job) -> poll -> read result -> freeze
    run = tool("titer_run_analysis", {"project_id": pid, "table_id": tid_col,
                                      "analysis_type": "descriptive-statistics"})
    job_id = run["job_id"]
    check("run_analysis returns queued job + analysis id",
          run.get("status") == "queued" and bool(run.get("analysis_id")),
          json.dumps(run)[:200])
    aid = run["analysis_id"]
    job = None
    for _ in range(60):  # up to 300 s
        job = tool("titer_read_job", {"job_id": job_id})
        if job.get("status") in ("done", "error", "cancelled"):
            break
        time.sleep(5)
    check("read_job polls to done", job and job.get("status") == "done",
          json.dumps(job)[:300] if job else "no job")
    res = tool("titer_read_results", {"project_id": pid, "analysis_id": aid})
    check("read_results computed after agent run", res.get("status") == "computed",
          res.get("status", ""))
    frozen = tool("titer_freeze_analysis", {"project_id": pid, "analysis_id": aid, "frozen": True})
    check("freeze_analysis", frozen.get("frozen") is True)
    tool("titer_freeze_analysis", {"project_id": pid, "analysis_id": aid, "frozen": False})
    ftab = tool("titer_freeze_table", {"project_id": pid, "table_id": tid_col, "frozen": True})
    check("freeze_table", ftab.get("frozen") is True)
    tool("titer_freeze_table", {"project_id": pid, "table_id": tid_col, "frozen": False})
    jobs = tool("titer_list_jobs", {"project_id": pid})
    check("list_jobs includes the run job",
          any(j.get("job_id") == job_id for j in jobs.get("jobs", [])),
          f"{len(jobs.get('jobs', []))} jobs")
    cancelled = tool("titer_cancel_job", {"job_id": job_id})
    check("cancel_job on a done job reports done", cancelled.get("status") == "done",
          json.dumps(cancelled)[:160])

    # 7b. 1.7.4 P0 tools: params schema, search, rerun (awaited), summary
    schema = tool("titer_get_analysis_params", {"analysis_type": "anova"})
    posthoc = next((p for p in schema.get("params", []) if p["name"] == "posthoc"), None)
    check("get_analysis_params anova lists posthoc with tukey",
          posthoc is not None and "tukey" in (posthoc.get("enum") or []),
          json.dumps(posthoc)[:200] if posthoc else "no posthoc")
    gate = tool("titer_get_analysis_params", {"analysis_type": "three-way-anova"})
    check("get_analysis_params three-way-anova carries its table gate",
          bool(gate.get("gate")), gate.get("gate", "")[:120])
    hit = tool("titer_search", {"project_id": pid, "query": "descriptive"})
    check("search finds the run analysis by type",
          any(m.get("id") == aid for m in hit.get("matches", [])),
          json.dumps(hit.get("matches", []))[:200])
    miss = tool("titer_search", {"project_id": pid, "query": "zzz-no-such-node"})
    check("search miss returns no matches",
          miss.get("matches") == [] and miss.get("total") == 0,
          json.dumps(miss)[:160])
    # The awaited rerun finishes inline (descriptive stats are fast) and
    # reuses the same node — no duplicate analysis appears in the summary.
    rerun = tool("titer_rerun_analysis", {"project_id": pid, "analysis_id": aid,
                                          "await_result": True})
    check("rerun_analysis awaited returns done inline",
          rerun.get("status") == "done" and bool(rerun.get("result")),
          json.dumps(rerun)[:200])
    summary = tool("titer_project_summary", {"project_id": pid})
    proj = next((p for p in summary.get("projects", []) if p["project_id"] == pid), None)
    check("project_summary counts one analysis after the rerun",
          proj is not None and proj.get("counts", {}).get("analysis") == 1,
          json.dumps(proj)[:200] if proj else "no project")

    # 8. graphs / figures / info sheets
    graph = tool("titer_build_graph", {"project_id": pid, "table_id": tid_xy,
                                       "graph_type": "xy-scatter"})
    gid = graph["graph_id"]
    check("build_graph xy-scatter", bool(gid) and graph.get("graph_type") == "xy-scatter",
          json.dumps(graph)[:200])
    upd = tool("titer_update_graph", {"project_id": pid, "graph_id": gid,
                                      "options": {"title": "Smoke scatter"}})
    check("update_graph title", upd.get("graph_id") == gid)
    clone = tool("titer_clone_graph", {"project_id": pid, "graph_id": gid})
    gid2 = clone["graph_id"]
    check("clone_graph returns a new id", bool(gid2) and gid2 != gid, gid2)
    fig = tool("titer_create_figure", {"project_id": pid, "graph_ids": [gid, gid2]})
    fid = fig["figure_id"]
    check("create_figure over 2 graphs", bool(fid), json.dumps(fig)[:200])
    fig_upd = tool("titer_update_figure", {"project_id": pid, "figure_id": fid,
                                           "layout": {"grid": {"rows": 1, "cols": 2}}})
    check("update_figure grid 1x2", fig_upd.get("figure_id") == fid)
    fig_read = tool("titer_read_figure", {"project_id": pid, "figure_id": fid})
    check("read_figure has 2 panels", len(fig_read.get("panels", [])) == 2,
          json.dumps(fig_read)[:300])
    sheet = tool("titer_create_info_sheet", {"project_id": pid, "linked_table_id": tid_xy})
    iid = sheet["info_sheet_id"]
    check("create_info_sheet linked to table", bool(iid), json.dumps(sheet)[:160])
    tool("titer_update_info_sheet", {"project_id": pid, "info_sheet_id": iid,
                                     "info": {"constants": [{"name": "Dose", "value": "10 nM"}]}})
    info = tool("titer_read_info_sheet", {"project_id": pid, "info_sheet_id": iid})
    consts = (info.get("info") or {}).get("constants", [])
    check("read_info_sheet constants",
          len(consts) == 1 and consts[0].get("name") == "Dose" and consts[0].get("value") == "10 nM",
          json.dumps(consts)[:200])
    g_read = tool("titer_read_graph", {"project_id": pid, "graph_id": gid})
    check("read_graph (Phase 1 carry-over)", g_read.get("graph_type") == "xy-scatter",
          g_read.get("graph_type", ""))

    # 9. composites: wand copies, method missing-file errors, script confirms
    wand = tool("titer_apply_wand", {"project_id": pid, "table_id": tid_col,
                                     "example_table_id": tid_xy})
    check("apply_wand returns created + report",
          isinstance(wand.get("created"), dict) and "report" in wand, json.dumps(wand)[:300])
    err = tool_error_text("titer_apply_method", {"project_id": pid, "table_id": tid_col,
                                                 "path": os.path.join(out_dir, "no-such.pzm")})
    check("apply_method missing file errors plainly", "No file at" in err, err[:160])
    asked = tool("titer_run_script", {"project_id": pid, "script": "// smoke test — no-op\n"})
    check("run_script first call asks to confirm",
          asked.get("needs_confirm") is True, json.dumps(asked)[:200])
    ran = tool("titer_run_script", {"project_id": pid, "script": "// smoke test — no-op\n",
                                    "confirm": True})
    check("run_script confirmed: effects reported, not executed",
          ran.get("effects_executed") is False, json.dumps(ran)[:300])

    # 10. exports (explicit paths) — files exist with the right magic bytes
    gpng = os.path.join(out_dir, "smoke-graph.png")
    exp = tool("titer_export_graph", {"project_id": pid, "graph_id": gid,
                                      "format": "png", "dpi": "300", "path": gpng})
    check("export_graph returns the written path", exp.get("path") == gpng, json.dumps(exp)[:200])
    check_file("export_graph png magic", gpng, b"\x89PNG")
    fpng = os.path.join(out_dir, "smoke-figure.png")
    tool("titer_export_figure", {"project_id": pid, "figure_id": fid,
                                 "format": "png", "dpi": "300", "path": fpng})
    check_file("export_figure png magic", fpng, b"\x89PNG")
    # seq 179: the whole project at once — the graph + figure above, one
    # file each, into one folder (explicit folder, so nothing lands in
    # the project's own directory).
    all_dir = os.path.join(out_dir, "smoke-export-all")
    all_exp = tool("titer_export_all_graphs", {"project_id": pid, "format": "png",
                                               "dpi": "300", "folder": all_dir})
    check("export_all_graphs exports graph + figure", all_exp.get("exported_count") == 2,
          json.dumps(all_exp)[:300])
    for item in all_exp.get("exported", []):
        check_file(f"export_all {item['name']} png magic", item["path"], b"\x89PNG")
    docx = os.path.join(out_dir, "smoke-graph.docx")
    office = tool("titer_export_office", {"project_id": pid, "graph_id": gid,
                                          "target": "word", "path": docx})
    check("export_office returns .docx", office.get("extension") == "docx", json.dumps(office)[:160])
    check_file("export_office docx magic", docx, b"PK\x03\x04")
    csvp = os.path.join(out_dir, "smoke-table.csv")
    texp = tool("titer_export_table_data", {"project_id": pid, "table_id": tid_xy,
                                            "format": "csv", "path": csvp})
    check("export_table_data csv row count", texp.get("rows") == 5, json.dumps(texp)[:160])
    check_file("export_table_data csv exists", csvp)
    xlsx = os.path.join(out_dir, "smoke-table.xlsx")
    tool("titer_export_table_data", {"project_id": pid, "table_id": tid_xy,
                                     "format": "xlsx", "path": xlsx})
    check_file("export_table_data xlsx magic", xlsx, b"PK\x03\x04")
    txtp = os.path.join(out_dir, "smoke-table.txt")
    tool("titer_export_table_data", {"project_id": pid, "table_id": tid_xy,
                                     "format": "txt", "path": txtp})
    with open(txtp, "rb") as f:
        check("export_table_data txt is tab-separated", b"\t" in f.read(), txtp)

    # 10b. 1.8.0 data-file import: a generated CSV imports as a new table
    # in the same project (seq 155 MCP coverage).
    csvp = os.path.join(out_dir, "smoke-dose.csv")
    with open(csvp, "w") as f:
        f.write("Dose,Response\n0,1.1\n1,2.2\n")
    imported_csv = tool("titer_import_data_file", {"project_id": pid, "path": csvp})
    check("import_data_file csv makes a table",
          bool(imported_csv.get("table_id")) and imported_csv.get("rows") == 2,
          json.dumps(imported_csv)[:200])
    check("import_data_file csv names the table for the file",
          imported_csv.get("name", "").startswith("smoke-dose"), imported_csv.get("name", ""))
    err = tool_error_text("titer_import_data_file",
                          {"project_id": pid, "path": os.path.join(out_dir, "smoke.hlx")})
    check("import_data_file refuses a project file", "not a data file" in err, err[:200])

    # 11. save, default-path export, reopen, import, close
    hlx = os.path.join(out_dir, "smoke.hlx")
    saved = tool("titer_save_project", {"project_id": pid, "path": hlx, "format": "hlx"})
    check("save_project as .hlx", saved.get("file_path") == hlx and saved.get("format") == "hlx",
          json.dumps(saved)[:200])
    default_exp = tool("titer_export_graph", {"project_id": pid, "graph_id": gid,
                                              "format": "png", "dpi": "300"})
    check("export_graph default path lands beside the project file",
          os.path.dirname(default_exp.get("path", "")) == out_dir, default_exp.get("path", ""))
    check_file("default-path export exists", default_exp.get("path", ""))
    # open_project dedupes an already-open file (same as the GUI: a file
    # already open isn't opened twice), so reopen a COPY — opening the
    # same path again returns this project's own id, and the close test
    # below would then close the smoke project itself.
    hlx_copy = os.path.join(out_dir, "smoke-copy.hlx")
    shutil.copyfile(hlx, hlx_copy)
    reopened = tool("titer_open_project", {"path": hlx_copy})
    pid2 = reopened["project_id"]
    check("open_project reopens the saved file", bool(pid2) and pid2 != pid,
          json.dumps(reopened)[:200])
    if os.path.isfile(fixture):
        imported = tool("titer_import_prism", {"path": fixture})
        pid3 = imported["project_id"]
        check("import_prism survival.pzfx", bool(pid3) and pid3 not in (pid, pid2),
              json.dumps(imported)[:200])
    else:
        pid3 = None
        check("import_prism fixture exists", False, f"missing {fixture}")
    # dirty-refusal: rename a node in pid2, then close without save
    tool("titer_rename_node", {"project_id": pid2, "node_id": tid_xy, "name": "Renamed"})
    refused = tool("titer_close_project", {"project_id": pid2})
    check("close_project dirty without save asks to confirm",
          refused.get("needs_confirm") is True, json.dumps(refused)[:200])
    closed = tool("titer_close_project", {"project_id": pid2, "save": "discard"})
    check("close_project discard closes", closed.get("closed") is True)
    if pid3:
        closed3 = tool("titer_close_project", {"project_id": pid3, "save": "discard"})
        check("close_project import window", closed3.get("closed") is True)

    # 12. cloud: status must succeed; the rest depend on an account
    status = tool("titer_cloud_status")
    check("cloud_status returns accounts list", isinstance(status.get("accounts"), list),
          json.dumps(status)[:200])
    accounts = status.get("accounts", [])
    if not accounts:
        for name in ["titer_cloud_list", "titer_cloud_metadata", "titer_cloud_revisions",
                     "titer_cloud_download", "titer_cloud_upload", "titer_cloud_upload_new",
                     "titer_cloud_create_folder", "titer_cloud_move"]:
            a = {"provider": "box", "account_id": "smoke-no-account"}
            if name in ("titer_cloud_list", "titer_cloud_create_folder"):
                a["folder_id"] = "0"
            if name in ("titer_cloud_download", "titer_cloud_metadata", "titer_cloud_revisions",
                        "titer_cloud_move"):
                a["file_id"] = "smoke-no-file"
            if name == "titer_cloud_upload":
                a["file_id"] = "smoke-no-file"
                a["project_id"] = pid
            if name == "titer_cloud_upload_new":
                a["project_id"] = pid
            if name == "titer_cloud_create_folder":
                a["name"] = "Smoke folder"
            if name == "titer_cloud_move":
                a["folder_id"] = "0"
            err = tool_error_text(name, a)
            check(f"{name} with no account fails plainly (Connect Box)",
                  "Connect Box" in err, err[:160])
    else:
        acct = accounts[0]
        listing = tool("titer_cloud_list", {"provider": acct["provider"],
                                            "account_id": acct["account_id"]})
        check("cloud_list on the connected account",
              isinstance(listing.get("entries"), list), json.dumps(listing)[:200])
        if listing.get("entries"):
            first = listing["entries"][0]
            meta = tool("titer_cloud_metadata", {"provider": acct["provider"],
                                                 "account_id": acct["account_id"],
                                                 "file_id": first["id"]})
            check("cloud_metadata on a listed entry", meta.get("file_id") == first["id"],
                  json.dumps(meta)[:200])

    # 13. delete through the two-step confirm, then the audit trail
    ask_del = tool("titer_delete_node", {"project_id": pid, "node_id": tid_dup})
    check("delete_node first call asks to confirm",
          ask_del.get("needs_confirm") is True, json.dumps(ask_del)[:200])
    deleted = tool("titer_delete_node", {"project_id": pid, "node_id": tid_dup, "confirm": True})
    check("delete_node confirmed", deleted.get("deleted") is True, json.dumps(deleted)[:160])
    act = tool("titer_read_activity", {"limit": 500})
    lines = act.get("lines", [])
    check("read_activity returns lines", isinstance(lines, list) and len(lines) >= 20,
          f"{len(lines)} lines")
    if lines:
        try:
            tools_seen = {json.loads(l).get("tool") for l in lines}
            for want in ["titer_create_project", "titer_run_analysis", "titer_export_graph",
                         "titer_cloud_status", "titer_delete_node"]:
                check(f"read_activity includes {want}", want in tools_seen)
        except json.JSONDecodeError:
            check("read_activity lines parse as JSON", False, lines[-1][:160])

    # 13b. feedback: one report is saved locally, nothing is sent, the
    # project is untouched, and bad args fail plainly.
    mcp_dir = os.path.dirname(os.path.abspath(args.discovery))
    feedback_path = os.path.join(mcp_dir, "feedback.jsonl")
    def feedback_lines():
        if not os.path.isfile(feedback_path):
            return []
        with open(feedback_path) as f:
            return [l for l in f.read().splitlines() if l.strip()]
    before = tool("titer_list_projects")["projects"]
    rev_before = {p["project_id"]: p.get("revision") for p in before}
    n_before = len(feedback_lines())
    fb = tool("titer_send_feedback", {
        "kind": "missing-feature",
        "summary": "Smoke-test feedback report",
        "details": "Tried: calling titer_send_feedback from the Phase 2 smoke. Happened: the report was saved. Expected: one JSONL entry, nothing sent anywhere.",
        "failed_tool": "titer_send_feedback",
    })
    check("send_feedback returns received + id",
          fb.get("received") is True and bool(fb.get("feedback_id")),
          json.dumps(fb)[:160])
    after_lines = feedback_lines()
    check("send_feedback appends exactly one entry",
          len(after_lines) == n_before + 1, f"{len(after_lines)} vs {n_before}")
    if len(after_lines) == n_before + 1:
        entry = json.loads(after_lines[-1])
        check("feedback entry has the right shape",
              entry.get("feedback_id") == fb.get("feedback_id")
              and entry.get("kind") == "missing-feature"
              and entry.get("summary") == "Smoke-test feedback report"
              and isinstance(entry.get("context"), dict)
              and entry["context"].get("app_version")
              and entry["context"].get("os")
              and "recent_activity" in entry["context"],
              json.dumps(entry)[:300])
        pf = entry["context"].get("project_file")
        check("feedback entry has no file path beyond the file name",
              pf is None or ("/" not in pf and "\\" not in pf),
              json.dumps(entry["context"])[:200])
    rev_after = {p["project_id"]: p.get("revision")
                 for p in tool("titer_list_projects")["projects"]}
    check("send_feedback does not mutate the project", rev_after == rev_before,
          json.dumps(rev_after)[:160])
    err = tool_error_text("titer_send_feedback",
                          {"kind": "nope", "summary": "x", "details": "y"})
    check("send_feedback bad kind names the valid choices",
          "bug" in err and "missing-feature" in err and "other" in err, err[:160])
    err = tool_error_text("titer_send_feedback",
                          {"kind": "bug", "summary": "  ", "details": "y"})
    check("send_feedback empty summary errors", "summary" in err.lower(), err[:160])

    # 14. error paths stay plain-language tool errors (never protocol errors)
    err = tool_error_text("titer_read_table_summary",
                          {"project_id": pid, "table_id": "nope"})
    check("read_table_summary unknown table errors", "No node" in err or "No table" in err,
          err[:160])
    err = tool_error_text("titer_create_table", {"project_id": pid, "table_type": "nope"})
    check("create_table unknown type errors", "No table type" in err, err[:160])
    err = tool_error_text("titer_run_analysis", {"project_id": pid, "table_id": tid_col,
                                                 "analysis_type": "not-a-test"})
    check("run_analysis unknown type errors", "analysis" in err.lower(), err[:160])

    # 15. close the smoke project itself (scratch — discard)
    closed = tool("titer_close_project", {"project_id": pid, "save": "discard"})
    check("close_project smoke window", closed.get("closed") is True)

    print()
    print(f"out dir: {out_dir}")
    print("SMOKE " + ("PASS" if not fails else f"FAIL ({len(fails)} failed: {fails})"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
