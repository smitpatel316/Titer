#!/usr/bin/env python3
"""Validate one .pzfx document (read from stdin) against the Prism 8 Mac XSD.

Usage:  python3 tests/validate-pzfx.py <stripped-xsd-path> < input.pzfx

Prints two lines on stdout:
  MECHANISM <lxml|xmllint|none>
  RESULT <VALID|INVALID>
followed by the validator's error text (if any).

Exit code: 0 = valid, 1 = invalid, 2 = no validator available.

Why two validators: this box has Python lxml; the Mac has no lxml but ships
/usr/bin/xmllint. The XSD must be the namespace-stripped copy
(tests/testdata/Prism8XMLSchema-stripped.xsd): the shipped XSD declares
targetNamespace="http://graphpad.com/prism/Prism.htm", but Prism's own
.pzfx files carry no namespace at all, so strict validation against the
shipped XSD fails every file — including Prism's own. The stripped copy
keeps the same content model with the namespace removed.
"""

import subprocess
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-pzfx.py <xsd-path>", file=sys.stderr)
        return 2
    xsd_path = sys.argv[1]
    xml_bytes = sys.stdin.buffer.read()

    # 1. lxml (this box).
    try:
        from lxml import etree

        schema = etree.XMLSchema(etree.parse(xsd_path))
        doc = etree.fromstring(xml_bytes)
        print("MECHANISM lxml")
        if schema.validate(doc):
            print("RESULT VALID")
            return 0
        print("RESULT INVALID")
        print(str(schema.error_log))
        return 1
    except ImportError:
        pass
    except Exception as exc:  # malformed XML, bad schema path, ...
        print("MECHANISM lxml")
        print("RESULT INVALID")
        print(f"{type(exc).__name__}: {exc}")
        return 1

    # 2. xmllint (the Mac).
    try:
        proc = subprocess.run(
            ["xmllint", "--noout", "--schema", xsd_path, "-"],
            input=xml_bytes,
            capture_output=True,
            timeout=60,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("MECHANISM none")
        print("RESULT INVALID")
        return 2
    print("MECHANISM xmllint")
    err = proc.stderr.decode("utf-8", "replace")
    if proc.returncode == 0:
        print("RESULT VALID")
        return 0
    print("RESULT INVALID")
    print(err)
    return 1


if __name__ == "__main__":
    sys.exit(main())
