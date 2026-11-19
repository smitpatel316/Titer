#!/usr/bin/env python3
"""Feedback-tool functional check against a running Titer MCP server.

Reads endpoint + token from <app_data>/mcp/discovery.json (argv[1]).
Speaks Streamable HTTP directly: initialize -> tools/list (titer_send_feedback
present, read_only_hint true, 52 tools) -> valid call (entry appended to
feedback.jsonl with the right shape) -> malformed calls rejected ->
project unchanged (revision before/after) -> no network call from the
tool itself (it only appends a local file; verified by the entry's
context carrying no network fields and the call completing with no
project/window interaction).

Usage:
    python3 check-feedback-mcp.py <app_data>/mcp/discovery.json
Exit 0 only if every check passes.
"""
import json
import os
import sys

import requests

EXPECTED_SUMMARY = "Feedback lane check: missing sort control"


def main():
    discovery = sys.argv[1]
    mcp_dir = os.path.dirname(os.path.abspath(discovery))
    disc = json.load(open(discovery))
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

    def parse(r):
        if r.status_code != 200:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
        ct = r.headers.get("content-type", "")
        if "application/json" in ct:
            return r.json()
        data = None
        for line in r.text.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    data = json.loads(payload)
        if data is None:
            raise RuntimeError(f"no data frame in SSE response: {r.text[:200]}")
        return data

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

    def feedback_lines():
        path = os.path.join(mcp_dir, "feedback.jsonl")
        if not os.path.isfile(path):
            return []
        with open(path) as f:
            return [l for l in f.read().splitlines() if l.strip()]

    init = rpc("initialize", {
        "protocolVersion": "2025-11-25",
        "capabilities": {},
        "clientInfo": {"name": "feedback-check", "version": "1"},
    })
    check("initialize negotiates 2025-11-25",
          init["result"]["protocolVersion"] == "2025-11-25")
    check("initialize instructions name 52 tools",
          "52 tools" in init["result"].get("instructions", ""))
    rpc("notifications/initialized", notif=True)

    lst = rpc("tools/list")
    tools = lst["result"]["tools"]
    names = [t["name"] for t in tools]
    check("tools/list returns 52 tools", len(names) == 52, f"{len(names)}")
    fb = next((t for t in tools if t["name"] == "titer_send_feedback"), None)
    check("tools/list has titer_send_feedback", fb is not None)
    if fb is not None:
        check("titer_send_feedback is read_only_hint",
              fb.get("annotations", {}).get("readOnlyHint") is True
              or fb.get("annotations", {}).get("read_only_hint") is True,
              json.dumps(fb.get("annotations", {})))
        schema = fb.get("inputSchema", {})
        props = schema.get("properties", {})
        check("titer_send_feedback schema has kind/summary/details",
              {"kind", "summary", "details"} <= set(props),
              json.dumps(sorted(props)))

    projects = tool("titer_list_projects")["projects"]
    scratch_pid = None
    if not projects:
        # No project open: create a scratch one so the no-mutation check
        # below compares a real revision instead of two empty lists.
        scratch = tool("titer_create_project")
        scratch_pid = scratch["project_id"]
        projects = tool("titer_list_projects")["projects"]
    rev_before = {p["project_id"]: p.get("revision") for p in projects}
    n_before = len(feedback_lines())

    fb_res = tool("titer_send_feedback", {
        "kind": "missing-feature",
        "summary": EXPECTED_SUMMARY,
        "details": "Tried: looking for a sort control on the feedback list. Happened: no sort control exists. Expected: newest-first order (or a sort control).",
        "failed_tool": "titer_send_feedback",
    })
    check("send_feedback returns received + id",
          fb_res.get("received") is True and bool(fb_res.get("feedback_id")),
          json.dumps(fb_res)[:160])
    lines = feedback_lines()
    check("send_feedback appends exactly one entry",
          len(lines) == n_before + 1, f"{len(lines)} vs {n_before}")
    if len(lines) == n_before + 1:
        entry = json.loads(lines[-1])
        ctx = entry.get("context", {})
        check("feedback entry shape",
              entry.get("feedback_id") == fb_res.get("feedback_id")
              and entry.get("kind") == "missing-feature"
              and entry.get("summary") == EXPECTED_SUMMARY
              and isinstance(entry.get("details"), str) and len(entry["details"]) > 0
              and isinstance(ctx, dict)
              and ctx.get("app_version") and ctx.get("os")
              and isinstance(ctx.get("recent_activity"), list),
              json.dumps(entry)[:300])
        pf = ctx.get("project_file")
        check("feedback entry has no file path beyond the file name",
              pf is None or ("/" not in pf and "\\" not in pf),
              json.dumps(ctx)[:200])
        check("feedback context carries no network fields",
              not any(k in ctx for k in ("url", "endpoint", "host", "sent_to")),
              json.dumps(sorted(ctx)))

    rev_after = {p["project_id"]: p.get("revision")
                 for p in tool("titer_list_projects")["projects"]}
    check("send_feedback does not mutate any project", rev_after == rev_before,
          json.dumps(rev_after)[:160])

    err = tool_error_text("titer_send_feedback",
                          {"kind": "nope", "summary": "x", "details": "y"})
    check("bad kind rejected naming the valid choices",
          "bug" in err and "missing-feature" in err and "other" in err, err[:160])
    err = tool_error_text("titer_send_feedback",
                          {"kind": "bug", "summary": "x", "details": "   "})
    check("empty details rejected", "details" in err.lower(), err[:160])
    err = tool_error_text("titer_send_feedback",
                          {"kind": "other", "summary": "x" * 201, "details": "y"})
    check("over-long summary rejected", "summary" in err.lower(), err[:160])

    if scratch_pid:
        closed = tool("titer_close_project", {"project_id": scratch_pid, "save": "discard"})
        check("scratch project closed", closed.get("closed") is True)

    print()
    print("FEEDBACK-CHECK " + ("PASS" if not fails else f"FAIL ({len(fails)} failed: {fails})"))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
