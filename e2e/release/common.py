#!/usr/bin/env python3
"""Shared helpers for the e2e/release checks (T-88..T-93).

Stdlib-only. Every check prints one line per assertion:
  PASS: <name> -- <detail>
  FAIL: <name> -- <detail>
  SKIP: <name> -- <reason>            (e.g. MAC-OWED: needs macOS)
Exit code is non-zero iff any assertion FAILED. SKIP never fails.
"""
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

REPO = "smitpatel316/Titer"
SITE_URL = "https://titer.smitpatel.net/"
MANIFEST_URL = "https://titer.smitpatel.net/channel/version.json"
UA = {"User-Agent": "titer-e2e-release-check/1.0"}


class Checker:
    def __init__(self, title):
        self.title = title
        self.failures = 0
        self.passes = 0
        self.skips = 0
        print(f"== {title} ==")

    def check(self, name, ok, detail=""):
        if ok:
            self.passes += 1
            print(f"PASS: {name} -- {detail}")
        else:
            self.failures += 1
            print(f"FAIL: {name} -- {detail}")
        return ok

    def skip(self, name, reason):
        self.skips += 1
        print(f"SKIP: {name} -- {reason}")

    def finish(self):
        print(f"== {self.title}: {self.passes} passed, {self.failures} failed, "
              f"{self.skips} skipped ==")
        return 1 if self.failures else 0


def is_mac():
    return sys.platform == "darwin"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def http_head(url, timeout=30):
    req = urllib.request.Request(url, headers=UA, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, dict(r.headers)


def gh_api(path):
    """`gh api` against the Titer repo explicitly (bare `gh` may resolve
    the repo as upstream mickaphd/Helix). Returns parsed JSON."""
    out = subprocess.run(
        ["gh", "api", f"repos/{REPO}/{path}",
         "--header", "Accept: application/vnd.github+json"],
        capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"gh api {path} failed: {out.stderr.strip()}")
    return json.loads(out.stdout)


def latest_release_tag():
    rel = gh_api("releases/latest")
    return rel["tag_name"]


def release_by_tag(tag):
    return gh_api(f"releases/tags/{tag}")


def fetch_manifest(url=MANIFEST_URL):
    status, body = http_get(url)
    if status != 200:
        raise RuntimeError(f"manifest GET {url} -> HTTP {status}")
    return json.loads(body)


def download(url, dest, expect_size=None):
    """Download url to dest (skip if dest already exists at expect_size).
    Returns (path, size)."""
    if expect_size is not None and os.path.exists(dest) \
            and os.path.getsize(dest) == expect_size:
        return dest, expect_size
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        size = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            size += len(chunk)
    if expect_size is not None and size != expect_size:
        raise RuntimeError(
            f"downloaded {url}: {size} bytes, expected {expect_size}")
    return dest, size


def parse_version(v):
    return tuple(int(x) for x in v.lstrip("vV").split("."))
