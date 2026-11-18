#!/usr/bin/env python3
"""Website deploy verification (T-91).

Asserts the live site at https://titer.smitpatel.net/ is the deployed
site, and that it never links a dead file:
  - GET / == 200
  - served page is byte-identical to the deployed site source AFTER
    stripping Cloudflare's two edge injections (the hidden cdn-cgi
    anchor right after <body>, and the __CF$cv$params challenge script
    right before </body>). Byte-exact verify cannot pass for HTML on
    this zone without the strip — the strip is the assertion.
  - 'shortly' is absent (no "coming shortly" placeholder text)
  - every download card on the page: its link HEADs 200, its
    Content-Length == the GitHub API asset size, and the SHA-256 it
    displays == the sha256 of the re-downloaded asset (shared cache)
  - the current release's DMG sha is present; the PREVIOUS release's
    DMG sha is absent (a stale page keeps the old hash next to the new
    links)

The site source of truth is the deployed export
(~/workspace/your_files/titer-homepage/titer-homepage.html); if it is
not present the byte-identity leg SKIPs with a note instead of failing.

Usage:
  python3 check_website.py [--version 1.6.1] [--prev-version 1.6.0]
      [--site-source PATH] [--cache-dir DIR]
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (Checker, SITE_URL, download, gh_api, http_get,  # noqa: E402
                    http_head, latest_release_tag, release_by_tag,
                    sha256_file)

DEFAULT_SITE_SOURCE = os.path.expanduser(
    "~/workspace/your_files/titer-homepage/titer-homepage.html")

# Cloudflare's two edge injections on this zone (verified 2026-11-18:
# anchor 304 B + script 1114 B; stripped page == deployed source byte-exact).
CF_ANCHOR = re.compile(
    rb'<a href="https://titer\.smitpatel\.net/cdn-cgi/content\?id=[^"]*"[^>]*></a>')
CF_SCRIPT = re.compile(
    rb'<script>\(function\(\)\{function c\(\)\{var b=a\.contentDocument.*?</script>',
    re.S)
CARD = re.compile(rb'<article class="dl-card".*?</article>', re.S)
SHA_RE = re.compile(rb"[0-9a-f]{64}")
HREF_RE = re.compile(
    rb'href="(https://github\.com/smitpatel316/Titer/releases/download/[^"]+)"')
FILENAME_RE = re.compile(rb'<p class="dl-file">([^<]+)</p>')


def strip_cloudflare(page):
    stripped, n1 = CF_ANCHOR.subn(b"", page)
    stripped, n2 = CF_SCRIPT.subn(b"", stripped)
    return stripped, n1, n2


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--version",
                    help="current release version (default: latest live release)")
    ap.add_argument("--prev-version",
                    help="previous release version (default: previous live release)")
    ap.add_argument("--site-source", default=DEFAULT_SITE_SOURCE)
    ap.add_argument("--cache-dir", default=None)
    args = ap.parse_args()

    cache = args.cache_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "out", "release")
    os.makedirs(cache, exist_ok=True)

    c = Checker("Website deploy verification (T-91) titer.smitpatel.net")
    try:
        status, page = http_get(SITE_URL)
    except Exception as e:  # noqa: BLE001
        c.check("site GET 200", False, str(e))
        return c.finish()
    c.check("site GET 200", status == 200, f"HTTP {status}, {len(page)} bytes")

    stripped, n_anchor, n_script = strip_cloudflare(page)
    c.check("exactly one cdn-cgi anchor injection stripped", n_anchor == 1,
            f"stripped {n_anchor}")
    c.check("exactly one __CF$cv$params script injection stripped",
            n_script == 1, f"stripped {n_script}")
    if os.path.isfile(args.site_source):
        with open(args.site_source, "rb") as f:
            source = f.read()
        c.check("served page byte-identical to site source after strip",
                stripped == source,
                f"stripped {len(stripped)} B vs source {len(source)} B")
    else:
        c.skip("served page byte-identical to site source after strip",
               f"site source not present: {args.site_source}")

    text = stripped.decode("utf-8", "replace")
    c.check("'shortly' absent from page", "shortly" not in text.lower(),
            "'shortly' appears — placeholder text leaked into the deploy")

    # --- download cards: link resolves, size matches, displayed sha matches ---
    cards = CARD.findall(page)
    c.check("download cards present on page", len(cards) >= 1,
            f"{len(cards)} cards")
    for card in cards:
        fname_m = FILENAME_RE.search(card)
        href_m = HREF_RE.search(card)
        sha_m = SHA_RE.search(card)
        fname = fname_m.group(1).decode() if fname_m else "?"
        if not href_m:
            c.check(f"card {fname} has a download link", False, "no href")
            continue
        url = href_m.group(1).decode()
        try:
            status, headers = http_head(url)
        except Exception as e:  # noqa: BLE001
            c.check(f"card {fname} link HEAD 200", False, str(e))
            continue
        c.check(f"card {fname} link HEAD 200", status == 200,
                f"{url} -> {status}")
        # GitHub API size for this asset (never trust the page's own numbers).
        try:
            tag = url.split("/download/")[1].split("/")[0]
            rel = release_by_tag(tag)
            api_size = next(a["size"] for a in rel["assets"]
                            if a["browser_download_url"] == url)
        except Exception as e:  # noqa: BLE001
            c.check(f"card {fname} asset size known via API", False, str(e))
            continue
        clen = headers.get("Content-Length")
        if clen is not None:
            c.check(f"card {fname} Content-Length == API size",
                    int(clen) == api_size, f"{clen} vs {api_size}")
        if sha_m:
            dest = os.path.join(cache, fname)
            try:
                download(url, dest, expect_size=api_size)
                actual = sha256_file(dest)
                shown = sha_m.group(0).decode()
                c.check(f"card {fname} displayed sha == re-downloaded sha",
                        actual.lower() == shown.lower(),
                        f"{actual} vs {shown}")
            except Exception as e:  # noqa: BLE001
                c.check(f"card {fname} re-download for sha", False, str(e))
        else:
            c.check(f"card {fname} displays a SHA-256", False, "no 64-hex sha")

    # --- current sha present / previous sha absent ---
    version = args.version
    if version is None:
        try:
            version = latest_release_tag().lstrip("vV")
        except Exception as e:  # noqa: BLE001
            c.check("current version resolvable", False, str(e))
            return c.finish()
    # The current release's DMG sha must be ON the page: without this,
    # a stale page showing only old cards would pass every per-card
    # check (each old card is internally consistent).
    try:
        rel = release_by_tag(f"v{version}")
        dmg = next(a for a in rel["assets"]
                   if a["name"].endswith("-aarch64.dmg"))
        dest = os.path.join(cache, dmg["name"])
        download(dmg["browser_download_url"], dest, expect_size=dmg["size"])
        cur_sha = sha256_file(dest)
        c.check(f"current DMG sha (v{version}) present on page",
                cur_sha.encode() in stripped,
                f"{cur_sha} must appear")
    except StopIteration:
        c.skip(f"current DMG sha (v{version}) present on page",
               "current release has no aarch64 DMG")
    except Exception as e:  # noqa: BLE001
        c.check(f"current DMG sha (v{version}) present on page",
                False, str(e))
    prev = args.prev_version
    if prev is None:
        try:
            rels = gh_api("releases?per_page=10")
            tags = [r["tag_name"].lstrip("vV") for r in rels
                    if not r.get("draft") and not r.get("prerelease")]
            # The release immediately BEFORE the checked version (not
            # merely "latest != version" — after a new release ships, the
            # newest tag is newer than the checked one, not previous).
            prev = tags[tags.index(version) + 1] if version in tags else None
        except Exception as e:  # noqa: BLE001
            print(f"INFO: could not resolve previous release ({e})")
            prev = None
    if prev:
        try:
            rel = release_by_tag(f"v{prev}")
            dmg = next(a for a in rel["assets"]
                       if a["name"].endswith("-aarch64.dmg"))
            dest = os.path.join(cache, dmg["name"])
            download(dmg["browser_download_url"], dest,
                     expect_size=dmg["size"])
            prev_sha = sha256_file(dest)
            c.check(f"previous DMG sha (v{prev}) absent from page",
                    prev_sha.encode() not in stripped,
                    f"{prev_sha} must not appear")
        except StopIteration:
            c.skip(f"previous DMG sha (v{prev}) absent from page",
                   "previous release has no aarch64 DMG")
        except Exception as e:  # noqa: BLE001
            c.check(f"previous DMG sha (v{prev}) absent from page",
                    False, str(e))
    return c.finish()


if __name__ == "__main__":
    sys.exit(main())
