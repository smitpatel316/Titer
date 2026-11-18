#!/usr/bin/env python3
"""UTF-8 SSE decode pin (battery Q-94 / T-131) — no app needed.

The original battery driver decoded SSE responses with
``requests``' ``r.text`` (ISO-8859-1 when no charset is declared) and
``splitlines()`` (which also splits on \\x85 / NEL). UTF-8 byte 0x85
— the trailing byte of U+2085 in the column title "ΔOD₅₉₅ (µM)" and
of U+0445 Cyrillic "х" — chopped the SSE ``data:`` line mid-JSON, so
``json.loads`` failed and three files ended the 233-file battery as
FAIL-SNAPSHOT (a driver bug, not an app bug):

  syn-edge-cases.prism, syn-edge-cases.pzfx,
  zenodo-18255034-regression-and-correlations.pzfx

``test_old_decode_fails`` reproduces the original failure on the exact
payload shape (pre-fix FAIL). ``test_new_decode_*`` prove the fixed
``parse_sse_payload`` in ``e2e/mcp/client.py`` parses it (post-fix
PASS). Run: ``python3 -m unittest discover -s e2e/battery -p 'test_*.py'``
(or ``python3 e2e/battery/test_sse_decode.py``).
"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "mcp"))
from client import parse_sse_payload  # noqa: E402


def failing_payload_bytes():
    """One SSE frame whose JSON carries the exact title that broke the
    driver: a column titled "ΔOD₅₉₅ (µM)" (U+2085 -> UTF-8 E2 82 85)
    plus a Cyrillic value "х" (U+0445 -> UTF-8 D1 85)."""
    body = {
        "jsonrpc": "2.0",
        "id": 13,
        "result": {
            "tables": [
                {"name": "ΔOD₅₉₅ (µM)", "type": "xy", "rows": 6},
                {"name": "х", "type": "column", "rows": 4},
            ]
        },
    }
    return ("data: " + json.dumps(body, ensure_ascii=False) + "\n\n").encode("utf-8")


def old_driver_decode(raw_bytes):
    """The original battery_driver.py rpc() decode, verbatim in effect:
    requests' .text is latin-1 with no charset, then splitlines()."""
    text = raw_bytes.decode("iso-8859-1")
    data = None
    for line in text.splitlines():
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload:
                data = json.loads(payload)
    if data is None:
        raise RuntimeError("no data frame in SSE response")
    return data


class TestSseDecodePin(unittest.TestCase):
    def test_old_decode_fails(self):
        """Pre-fix FAIL pin: the original algorithm cannot parse the
        payload — it raises JSONDecodeError (Unterminated string),
        exactly the FAIL-SNAPSHOT signature from the battery."""
        with self.assertRaises(json.JSONDecodeError):
            old_driver_decode(failing_payload_bytes())

    def test_new_decode_parses_failing_title(self):
        out = parse_sse_payload(failing_payload_bytes())
        tables = out["result"]["tables"]
        self.assertEqual(tables[0]["name"], "ΔOD₅₉₅ (µM)")
        self.assertEqual(tables[1]["name"], "х")

    def test_new_decode_crlf_framing(self):
        """A CRLF-framed SSE response (\\r\\n line ends) still parses —
        splitting on '\\n' only leaves a trailing '\\r' that .strip()
        removes from the payload."""
        raw = failing_payload_bytes().replace(b"\n", b"\r\n")
        out = parse_sse_payload(raw)
        self.assertEqual(out["result"]["tables"][0]["name"], "ΔOD₅₉₅ (µM)")

    def test_new_decode_rejects_empty(self):
        with self.assertRaises(Exception):
            parse_sse_payload(b": ping\n\n")


if __name__ == "__main__":
    unittest.main()
