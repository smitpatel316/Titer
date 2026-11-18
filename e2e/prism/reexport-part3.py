#!/usr/bin/env python3
"""T-132 List A generator — re-export the 12 part-3 corpus files from the
SHIPPED 1.6.2 build, so the Nov 17 baseline (12/12 .prism CRASH, 12/12 .pzfx
WARN on 1.6.0-era exports) can be re-run file-for-file on 1.6.2 exports.

Runs wherever Titer's MCP server is up (Mac shipped 1.6.2 via the Settings >
AI Connections toggle, or the Linux AppImage / debug build) — same protocol,
just a different --discovery path. Stdlib only; reuses e2e/mcp/client.py.

Per source stem: import the corpus file, save as .prism AND .pzfx into
--out-dir, record SAVED / REFUSED / ERROR per format. A REFUSED save is the
writer declining (nested/multiple tables refuse the whole write by design —
plain-language error, never a silent drop); it is recorded, NOT faked as a
Prism verdict, and the file is left out of the Prism list.

Writes:
  <out-dir>/part3-162-list.txt  — absolute paths of saved files, for
                                  run-prism-roundtrip.sh (List A)
  <out-dir>/reexport-report.json — per-source, per-format outcome

Sources (13 stems; 24 baseline files + 2 extra .pzfx for the qa roundtrips):
  synthetic/*.prism (8): syn-column-nonparam-a, syn-column-paired-a,
    syn-xy-binding-a, syn-grouped-threeway-a, syn-contingency-a,
    syn-multiple-a, syn-nested-a, syn-survival-cox-a
  tests/testdata/column_thousands.pzfx
  corpus: zenodo-11401472-figure_3cd.pzfx,
    zenodo-22863198-fig6b-f_seahorse_mitostresstest_tc28a2_wt_vs_cx43ko.pzfx
  qa/roundtrip-2f8eca2.prism, qa/roundtrip-866ae90.prism

Usage (on the Mac, from the synced repo dir):
  python3 e2e/prism/reexport-part3.py --discovery <discovery.json> \
      --helix-dir ~/helix --out-dir ~/prism-gap/t132-list-a
"""
import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from client import Mcp, McpError  # noqa: E402

SOURCES = [
    ("synthetic/syn-column-nonparam-a.prism",),
    ("synthetic/syn-column-paired-a.prism",),
    ("synthetic/syn-xy-binding-a.prism",),
    ("synthetic/syn-grouped-threeway-a.prism",),
    ("synthetic/syn-contingency-a.prism",),
    ("synthetic/syn-multiple-a.prism",),
    ("synthetic/syn-nested-a.prism",),
    ("synthetic/syn-survival-cox-a.prism",),
    ("testdata/column_thousands.pzfx",),
    ("corpus/zenodo-11401472-figure_3cd.pzfx",),
    ("corpus/zenodo-22863198-fig6b-f_seahorse_mitostresstest_tc28a2_wt_vs_cx43ko.pzfx",),
    ("qa/roundtrip-2f8eca2.prism",),
    ("qa/roundtrip-866ae90.prism",),
]


def find_source(helix_dir: Path, rel: str):
    """Resolve a source relative to the Helix checkout layout on the Mac
    (test-corpus/ for synthetic+corpus, tests/testdata/ for testdata,
    qa/ for the roundtrips). Falls back to a recursive search."""
    top, name = rel.split("/", 1)
    candidates = {
        "synthetic": helix_dir / "test-corpus" / "synthetic" / name,
        "corpus": helix_dir / "test-corpus" / name,
        "testdata": helix_dir / "tests" / "testdata" / name,
        "qa": helix_dir / "qa" / name,
    }
    p = candidates[top]
    if p.is_file():
        return p
    hits = [f for f in helix_dir.rglob(name) if f.is_file()]
    return hits[0] if hits else p


def wait_idle(mcp, pid, timeout_s=120):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        jobs = mcp.tool("titer_list_jobs", {"project_id": pid}).get("jobs", [])
        if not any(j.get("status") == "Running" for j in jobs):
            return
        time.sleep(2)
    raise RuntimeError(f"jobs still running for {pid}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--discovery", required=True)
    ap.add_argument("--helix-dir", required=True,
                    help="Helix checkout on this machine (has test-corpus/, tests/testdata/, qa/)")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()
    helix = Path(args.helix_dir)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    mcp = Mcp(args.discovery)
    mcp.initialize()

    report = {"sources": []}
    saved_paths = []
    for (rel,) in SOURCES:
        src = find_source(helix, rel)
        stem = src.stem
        entry = {"source": str(src), "stem": stem, "formats": {}}
        if not src.is_file():
            entry["error"] = "source file missing"
            report["sources"].append(entry)
            print(f"SKIP {stem}: source missing ({src})")
            continue
        try:
            imp = mcp.tool("titer_import_prism", {"path": str(src)})
        except McpError as e:
            entry["error"] = f"import failed: {e}"
            report["sources"].append(entry)
            print(f"FAIL-IMPORT {stem}: {e}")
            continue
        pid = imp["project_id"]
        try:
            wait_idle(mcp, pid)
        except RuntimeError as e:
            entry["error"] = str(e)
        for fmt in ("prism", "pzfx"):
            out = out_dir / f"{stem}.{fmt}"
            try:
                mcp.tool("titer_save_project",
                         {"project_id": pid, "path": str(out), "format": fmt})
                size = out.stat().st_size if out.is_file() else -1
                if size <= 0:
                    raise RuntimeError(f"save produced {size} B")
                entry["formats"][fmt] = {"outcome": "SAVED", "bytes": size}
                saved_paths.append(str(out))
                print(f"SAVED {stem}.{fmt} ({size} B)")
            except McpError as e:
                # The writer refuses some shapes (nested/multiple) with a
                # plain-language error — record it, don't fake a verdict.
                entry["formats"][fmt] = {"outcome": "REFUSED", "error": str(e)[:300]}
                print(f"REFUSED {stem}.{fmt}: {str(e)[:200]}")
        try:
            mcp.tool("titer_close_project", {"project_id": pid, "save": "discard"})
        except McpError:
            pass
        report["sources"].append(entry)

    (out_dir / "part3-162-list.txt").write_text("\n".join(saved_paths) + "\n")
    (out_dir / "reexport-report.json").write_text(json.dumps(report, indent=2) + "\n")
    n_saved = len(saved_paths)
    n_refused = sum(1 for s in report["sources"] for f in s["formats"].values()
                    if f.get("outcome") == "REFUSED")
    print(f"{n_saved} files saved ({n_refused} format-refusals) — list: {out_dir}/part3-162-list.txt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
