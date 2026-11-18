# MCP client for the Titer CI regression suite (check/e2e-ci).
#
# Stdlib-only (urllib) — no third-party deps to install in CI. Mirrors the
# battery driver's protocol handling (work/battery_driver.py): Streamable
# HTTP, discovery.json holds the endpoint + bearer token, protocol version
# 2025-11-25, `Accept: application/json, text/event-stream`, session id
# carried on later calls.
#
# The bearer token is memory-only: read from discovery.json, sent as a
# header, NEVER printed or logged.
import json
import urllib.error
import urllib.request

PROTOCOL_VERSION = "2025-11-25"


class McpError(RuntimeError):
    pass


class Mcp:
    def __init__(self, discovery_path):
        with open(discovery_path) as f:
            disc = json.load(f)
        self.endpoint = disc["endpoint"]
        self.token = disc["token"]  # memory only; never printed/logged
        self.sid = None
        self.counter = 1
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": PROTOCOL_VERSION,
            "Authorization": "Bearer " + self.token,
        }

    def rpc(self, method, params=None, notif=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notif:
            body["id"] = self.counter
            self.counter += 1
        headers = dict(self.headers)
        if self.sid:
            headers["Mcp-Session-Id"] = self.sid
        req = urllib.request.Request(
            self.endpoint, data=json.dumps(body).encode(), headers=headers, method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode()
                sid = resp.headers.get("mcp-session-id")
                ctype = resp.headers.get("content-type", "")
        except urllib.error.HTTPError as e:
            raise McpError(f"{method} HTTP {e.code}: {e.read().decode()[:300]}")
        if notif:
            return None
        if sid:
            self.sid = sid
        if "application/json" in ctype:
            return json.loads(raw)
        data = None
        for line in raw.splitlines():
            if line.startswith("data:"):
                payload = line[5:].strip()
                if payload:
                    data = json.loads(payload)
        if data is None:
            raise McpError(f"{method}: no data frame in SSE response: {raw[:200]}")
        return data

    def tool_raw(self, name, arguments=None):
        out = self.rpc("tools/call", {"name": name, "arguments": arguments or {}})
        if "error" in out:
            raise McpError(f"{name} RPC error: {out['error']}")
        return out["result"]

    def tool(self, name, arguments=None):
        """Call a tool, raising on isError; returns the parsed JSON result."""
        res = self.tool_raw(name, arguments)
        if res.get("isError"):
            text = "".join(c.get("text", "") for c in res.get("content", []))
            raise McpError(f"{name} tool error: {text[:500]}")
        text = "".join(c.get("text", "") for c in res.get("content", []))
        return json.loads(text)

    def tool_error(self, name, arguments=None):
        """Call a tool that MUST fail; returns the error text."""
        res = self.tool_raw(name, arguments)
        if not res.get("isError"):
            raise McpError(f"{name} unexpectedly succeeded")
        return "".join(c.get("text", "") for c in res.get("content", []))

    def initialize(self):
        init = self.rpc("initialize", {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "titer-e2e-ci", "version": "1"},
        })
        assert init["result"]["protocolVersion"] == PROTOCOL_VERSION, init
        self.rpc("notifications/initialized", notif=True)
        lst = self.rpc("tools/list")
        names = [t["name"] for t in lst["result"]["tools"]]
        return names
