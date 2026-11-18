#!/usr/bin/env python3
"""T-137, Titer half — open a Prism-native project in Titer, modify one cell,
save as Prism format (.prism AND .pzfx), record before/after for the Prism
reopen half.

Runs on the Mac against the SHIPPED Titer (MCP enabled via the Settings >
AI Connections toggle; discovery.json under ~/Library/Application Support/
net.smitpatel.helix/mcp/discovery.json). Also runs on Hatch against the
Linux AppImage / debug build — same MCP protocol, just a different
--discovery path. Stdlib only; reuses e2e/mcp/client.py.

Flow:
  1. titer_import_prism on the Prism-native file (built in Prism from
     t137-random-data.csv + one analysis — see README.md §T-137).
  2. Pick the first column table; snapshot it (include_values).
  3. GUARD: refuse if the table has excluded cells (the summary shows
     excluded cells as null, so writing the summary back would erase their
     stored values) or if rows are capped (rows_total != rows_returned).
  4. Change ONE cell — first data row, first data column — to the sentinel
     987654.321 (from make-random-csv.py; cannot occur in the fixture).
     Everything else is written back byte-for-byte from the snapshot.
  5. titer_save_project format=prism and format=pzfx into --out-dir.
  6. Reopen each saved file in Titer and verify the sentinel is there and
     all other cells are unchanged (guards against a silent-drop save).
  7. Write t137-titer-report.json: table, cell coords, old/new value,
     output paths, reopen verification.

The Prism half (t137-prism-verify.sh) then reopens the two saved files in
real Prism 11 and checks the sentinel shows there — which is the actual
round-trip proof. The .prism variant doubles as the BUG-20 fix verification
from the other direction (Titer-written .prism crashed Prism 12/12 on Nov 17).

Usage (on the Mac):
  python3 e2e/prism/t137/t137-titer.py <prism-native-file.prism> \
      --discovery "~/Library/Application Support/net.smitpatel.helix/mcp/discovery.json" \
      --out-dir ~/prism-gap/t137
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "mcp"))
from client import Mcp  # noqa: E402

SENTINEL = 987654.321


def wait_tables_stable(mcp, pid, timeout_s=60):
    prev = None
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        tabs = mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
        names = sorted((t.get("name"), t.get("table_type")) for t in tabs)
        # The blank-project signature ([Table 1]) means the open hasn't
        # landed yet — keep polling, don't accept it as stable (BUG-2).
        if names == [("Table 1", "column")]:
            time.sleep(2)
            continue
        if names == prev:
            return tabs
        prev = names
        time.sleep(2)
    raise RuntimeError(f"tables never stabilized for {pid}: last={prev}")


def wait_idle(mcp, pid, timeout_s=120):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        jobs = mcp.tool("titer_list_jobs", {"project_id": pid}).get("jobs", [])
        if not any(j.get("status") == "Running" for j in jobs):
            return
        time.sleep(2)
    raise RuntimeError(f"jobs still running for {pid} after {timeout_s}s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("prism_file")
    ap.add_argument("--discovery", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--sentinel", type=float, default=SENTINEL)
    args = ap.parse_args()

    src = Path(args.prism_file)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mcp = Mcp(args.discovery)
    mcp.initialize()
    report = {"source": str(src), "sentinel": args.sentinel}

    imp = mcp.tool("titer_import_prism", {"path": str(src)})
    pid = imp["project_id"]
    report["project_id"] = pid
    tabs = wait_tables_stable(mcp, pid)
    wait_idle(mcp, pid)
    # First column table (the fixture's data table).
    target = next((t for t in tabs if (t.get("table_type") or "").lower() == "column"), None)
    if target is None:
        raise RuntimeError(f"no column table in {src}: {[t.get('name') for t in tabs]}")
    tid = target["id"]
    report["table"] = {"id": tid, "name": target.get("name")}
    summ = mcp.tool("titer_read_table_summary", {
        "project_id": pid, "table_id": tid, "include_values": True, "max_rows": 1000})
    if summ.get("excluded_cells"):
        raise RuntimeError("table has excluded cells — refusing (summary nulls "
                           "would erase their stored values on write-back)")
    vals = summ.get("values", {})
    if vals.get("rows_total") != vals.get("rows_returned"):
        raise RuntimeError(f"rows capped: {vals.get('rows_returned')}/{vals.get('rows_total')}")
    columns = ["Title"] + [c["name"] for c in summ["columns"]]
    rows = [list(r["cells"]) for r in vals["rows"]]
    # First data row, first data column (col 1; col 0 is the row-title column).
    old_value = rows[0][1]
    rows[0][1] = args.sentinel
    report["modified_cell"] = {"row": 0, "column": 1, "column_name": columns[1],
                               "old_value": old_value, "new_value": args.sentinel}
    mcp.tool("titer_write_table", {
        "project_id": pid, "table_id": tid, "columns": columns, "rows": rows,
        "label": "T-137 round-trip modify"})
    wait_idle(mcp, pid)

    outputs = {}
    for fmt in ("prism", "pzfx"):
        out = out_dir / f"t137-modified.{fmt}"
        mcp.tool("titer_save_project", {"project_id": pid, "path": str(out), "format": fmt})
        size = out.stat().st_size if out.is_file() else -1
        assert size > 0, f".{fmt} save failed ({size} B)"
        outputs[fmt] = {"path": str(out), "bytes": size}
        # Reopen in Titer: sentinel present, all other cells unchanged.
        mcp.tool("titer_close_project", {"project_id": pid, "save": "discard"})
        re = mcp.tool("titer_open_project", {"path": str(out)}) if fmt == "prism" \
            else mcp.tool("titer_import_prism", {"path": str(out)})
        pid2 = re["project_id"]
        wait_tables_stable(mcp, pid2)
        wait_idle(mcp, pid2)
        tabs2 = mcp.tool("titer_list_tables", {"project_id": pid2})["tables"]
        t2 = next(t for t in tabs2 if t.get("name") == target.get("name"))
        s2 = mcp.tool("titer_read_table_summary", {
            "project_id": pid2, "table_id": t2["id"], "include_values": True, "max_rows": 1000})
        cells2 = [list(r["cells"]) for r in s2["values"]["rows"]]
        got = cells2[0][1]
        assert float(got) == args.sentinel, \
            f".{fmt} reopen: sentinel missing at [0][1] (got {got!r})"
        diffs = [(r, c) for r in range(len(rows)) for c in range(len(columns))
                 if (r, c) != (0, 1) and str(cells2[r][c]) != str(rows[r][c])]
        assert not diffs, f".{fmt} reopen: {len(diffs)} other cells changed: {diffs[:5]}"
        outputs[fmt]["reopen_verified"] = True
        mcp.tool("titer_close_project", {"project_id": pid2, "save": "discard"})
        # Re-import the source for the next format (the first close discarded).
        if fmt == "prism":
            imp = mcp.tool("titer_import_prism", {"path": str(src)})
            pid = imp["project_id"]
            tabs = wait_tables_stable(mcp, pid)
            wait_idle(mcp, pid)
            target = next(t for t in tabs if t.get("name") == report["table"]["name"])
            tid = target["id"]
            summ = mcp.tool("titer_read_table_summary", {
                "project_id": pid, "table_id": tid, "include_values": True, "max_rows": 1000})
            columns = ["Title"] + [c["name"] for c in summ["columns"]]
            rows = [list(r["cells"]) for r in summ["values"]["rows"]]
            rows[0][1] = args.sentinel
            mcp.tool("titer_write_table", {
                "project_id": pid, "table_id": tid, "columns": columns, "rows": rows,
                "label": "T-137 round-trip modify"})
            wait_idle(mcp, pid)
    report["outputs"] = outputs
    report["status"] = "TITER-HALF-PASS"
    (out_dir / "t137-titer-report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
