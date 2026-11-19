# e2e/compare.py — the L8 normalized screenshot comparator (repo script).
#
# Implements the comparison rule from ~/workspace/.helix-owed-items/l8-compare.md §5
# (the L8 --compare lane, Nov 17 2026). Strict byte-equality is NOT the rule:
# it fails by construction across Mac/Linux (Plotly random per-render uid in
# SVG ids, Core Text vs FreeType rasterization, different PNG encoders), so
# file bytes are NEVER compared here.
#
# PNG rule (L8 §5 rule 1):
#   - same dimensions and DPI;
#   - >= 95% of pixels exactly identical;
#   - 100% of differing pixels within 1 px of a content pixel in either image;
#   - 0 isolated differing pixels;
#   - mean abs RGB diff <= 8/255.
# SVG rule (L8 §5 rule 2):
#   - after replacing Plotly random ids (defs-/topdefs-/clip-/legend-/trace-
#     hex ids) with a fixed token: identical element counts by tag, identical
#     text nodes, every numeric attribute within +/-15 px on the 640x460 canvas.
#
# Definitions (pinned here, because the L8 note states the rule in prose):
#   - A "content" pixel is one that is non-white in EITHER image (any channel
#     < 255 in at least one of the two). A differing pixel is within 1 px of
#     content if any of its 8 NEIGHBOURS (not itself) is content. The
#     self-exclusion matters: a differing pixel is trivially non-white in at
#     least one image itself, so counting itself would make the check vacuous.
#     As defined, the check is the antialiasing reading: a differing pixel
#     must sit next to ink — a stray differing pixel in empty white space
#     fails. Verified against the real L8 pair: 0 far (L8: 100% within 1 px).
#   - An "isolated" differing pixel is one with no other differing pixel in
#     its 8-neighbourhood: a lone 1 px speck, not part of any edge.
#   - "White" for the ink/content masks is any channel < 255 (L8 §2: non-white
#     px = any channel < 255). Geometry helpers use a stricter ink threshold
#     (any channel < 250) so faint antialiasing halos do not count as marks.
#
# Also in this module: the pixel-geometry helpers the screenshot cases use
# (bar-band counting, ink coverage, bracket/line detection). Geometry is
# asserted from export pixels, not just whole-image similarity — a clipped
# graph can still be 95% similar to its reference if the clipped part is
# small, so the cases assert the geometry directly.
#
# Stdlib only (zlib, struct, re, xml.etree, json, argparse) — same constraint
# as e2e/mcp/suite.py, so CI needs no extra install.
#
# Usage:
#   python3 e2e/compare.py <a> <b> [--json]   # PNG or SVG by extension
#   python3 e2e/compare.py --self-test         # (see e2e/compare_selftest.py)
# Exit 0 = PASS under the L8 rule, 1 = FAIL, 2 = error (unreadable input).
import argparse
import json
import math
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib

# --- L8 thresholds (l8-compare.md §5) --------------------------------------
PNG_MIN_IDENTICAL = 0.95        # >= 95% pixels exactly identical
PNG_MAX_MEAN_ABS_RGB = 8.0      # mean abs RGB diff <= 8/255
PNG_MAX_NEAR_CONTENT = 1        # differing px within 1 px of shared content
SVG_MAX_NUMERIC_DELTA = 15.0    # +/-15 px on the 640x460 canvas
INK_THRESHOLD = 250             # geometry: a channel below this is ink
WHITE_THRESHOLD = 255           # L8 content: any channel < 255 is non-white

ID_PATTERNS = [
    (re.compile(r"defs-[0-9a-f]{6}"), "defs-ID"),
    (re.compile(r"topdefs-[0-9a-f]{6}"), "topdefs-ID"),
    (re.compile(r"clip[0-9a-f]{6}[a-z]*"), "clipID"),
    (re.compile(r"legend[0-9a-f]{6}"), "legendID"),
    (re.compile(r"trace[0-9a-f]{6}"), "traceID"),
]
NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?")


class CompareError(RuntimeError):
    pass


# --- PNG decode (stdlib; 8-bit + 16-bit, colour types 0/2/3/4/6) -----------
def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path):
    """Return dict(width, height, dpi, rgba) with rgba a flat bytearray of
    RGBA bytes, row-major. Raises CompareError on unreadable input."""
    try:
        with open(path, "rb") as f:
            data = f.read()
    except OSError as e:
        raise CompareError(f"cannot read {path}: {e}")
    if len(data) < 8 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise CompareError(f"{path}: not a PNG file")
    pos, ihdr, plte, trns, idat, phys = 8, None, None, None, b"", None
    while pos + 8 <= len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        ctype = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + length]
        if len(chunk) != length:
            raise CompareError(f"{path}: truncated {ctype.decode('latin1')} chunk")
        if ctype == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", chunk)
        elif ctype == b"PLTE":
            plte = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat += chunk
        elif ctype == b"pHYs":
            phys = struct.unpack(">IIB", chunk)
        elif ctype == b"IEND":
            break
        pos += 12 + length
    if ihdr is None:
        raise CompareError(f"{path}: no IHDR chunk")
    width, height, bit_depth, color_type, comp, filt, interlace = ihdr
    if comp != 0 or filt != 0 or interlace != 0:
        raise CompareError(
            f"{path}: unsupported PNG (compression {comp}, filter {filt}, interlace {interlace})")
    if color_type not in (0, 2, 3, 4, 6):
        raise CompareError(f"{path}: unsupported colour type {color_type}")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    if bit_depth not in (1, 2, 4, 8, 16):
        raise CompareError(f"{path}: unsupported bit depth {bit_depth}")
    if color_type == 3 and bit_depth == 16:
        raise CompareError(f"{path}: palette with 16-bit depth")
    try:
        raw = zlib.decompress(idat)
    except zlib.error as e:
        raise CompareError(f"{path}: IDAT zlib error: {e}")
    # Samples per row, in bytes, before filtering.
    if bit_depth == 16:
        row_bytes = width * channels * 2
    elif bit_depth == 8:
        row_bytes = width * channels
    else:  # sub-byte: palette or grayscale, packed
        row_bytes = (width * bit_depth + 7) // 8
    bpp = max(1, (row_bytes + width - 1) // width)  # filter bytes-per-pixel
    if bit_depth >= 8:
        bpp = channels * (bit_depth // 8)
    stride = row_bytes + 1
    if len(raw) < stride * height:
        raise CompareError(f"{path}: IDAT too short ({len(raw)} < {stride * height})")
    # Unfilter, row by row, into a flat RGBA bytearray.
    out = bytearray(width * height * 4)
    prev = bytearray(row_bytes)
    for y in range(height):
        row = bytearray(raw[y * stride + 1:(y + 1) * stride])
        ftype = raw[y * stride]
        if ftype == 0:
            pass
        elif ftype == 1:
            for i in range(bpp, row_bytes):
                row[i] = (row[i] + row[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(row_bytes):
                row[i] = (row[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(row_bytes):
                a = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(row_bytes):
                a = row[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + _paeth(a, b, c)) & 0xFF
        else:
            raise CompareError(f"{path}: unknown filter type {ftype} on row {y}")
        prev = row
        base = y * width * 4
        if bit_depth == 16:
            for x in range(width):
                o = x * channels * 2
                vals = [row[o + 2 * c] for c in range(channels)]  # high byte
                _to_rgba(out, base + x * 4, color_type, vals, plte, trns)
        elif bit_depth == 8:
            for x in range(width):
                o = x * channels
                _to_rgba(out, base + x * 4, color_type, list(row[o:o + channels]), plte, trns)
        else:
            for x in range(width):
                bitpos = x * bit_depth
                byte = row[bitpos >> 3]
                shift = 8 - bit_depth - (bitpos & 7)
                v = (byte >> shift) & ((1 << bit_depth) - 1)
                if color_type == 3:
                    _to_rgba(out, base + x * 4, color_type, [v], plte, trns)
                else:  # grayscale: scale to 0..255
                    g = v * 255 // ((1 << bit_depth) - 1)
                    _to_rgba(out, base + x * 4, color_type, [g], plte, trns)
    dpi = None
    if phys is not None:
        ppm_x, ppm_y, unit = phys
        if unit == 1 and ppm_x and ppm_y:
            dpi = (ppm_x * 0.0254, ppm_y * 0.0254)
    return {"width": width, "height": height, "dpi": dpi, "rgba": out}


def _to_rgba(out, off, color_type, vals, plte, trns):
    if color_type == 6:
        out[off:off + 4] = bytes(vals)
    elif color_type == 2:
        out[off:off + 3] = bytes(vals)
        out[off + 3] = 255
    elif color_type == 4:
        g, a = vals
        out[off:off + 4] = bytes((g, g, g, a))
    elif color_type == 0:
        g = vals[0]
        out[off:off + 4] = bytes((g, g, g, 255))
    elif color_type == 3:
        idx = vals[0] * 3
        if plte is None or idx + 2 >= len(plte):
            raise CompareError("palette index out of range")
        out[off:off + 3] = plte[idx:idx + 3]
        out[off + 3] = trns[vals[0]] if trns and vals[0] < len(trns) else 255


def write_png_rgba(path, width, height, rgba):
    """Minimal PNG writer (8-bit RGBA, no filtering) for self-test fixtures."""
    def chunk(ctype, payload):
        c = struct.pack(">I", len(payload)) + ctype + payload
        return c + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(rgba[y * width * 4:(y + 1) * width * 4])
                   for y in range(height))
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))


# --- PNG comparison: L8 §5 rule 1 ------------------------------------------
def compare_png(a_path, b_path):
    """Compare two PNGs under the L8 rule. Returns (verdict, report dict).
    verdict is True (PASS) iff every clause holds. report carries the
    observed numbers so a failure says which clause failed, by how much."""
    a = read_png(a_path)
    b = read_png(b_path)
    report = {
        "a": os.path.basename(a_path), "b": os.path.basename(b_path),
        "a_dims": [a["width"], a["height"]], "b_dims": [b["width"], b["height"]],
        "a_dpi": a["dpi"], "b_dpi": b["dpi"],
    }
    failures = []
    if (a["width"], a["height"]) != (b["width"], b["height"]):
        failures.append(
            f"dimensions differ: {a['width']}x{a['height']} vs {b['width']}x{b['height']}")
        report["identical_frac"] = 0.0
        return False, report
    if a["dpi"] is not None and b["dpi"] is not None:
        if abs(a["dpi"][0] - b["dpi"][0]) > 1.0 or abs(a["dpi"][1] - b["dpi"][1]) > 1.0:
            failures.append(f"DPI differs: {a['dpi']} vs {b['dpi']}")
    w, h = a["width"], a["height"]
    n = w * h
    pa, pb = a["rgba"], b["rgba"]
    n_diff = 0
    abs_sum = 0  # sum of per-pixel max-channel? No — sum of abs diffs, RGB only
    diff = bytearray(n)  # 1 where any RGB channel differs
    content = bytearray(n)  # 1 where non-white in EITHER image (union ink)
    for i in range(n):
        o = i * 4
        da = (abs(pa[o] - pb[o]) + abs(pa[o + 1] - pb[o + 1])
              + abs(pa[o + 2] - pb[o + 2]))
        abs_sum += da
        if pa[o] != pb[o] or pa[o + 1] != pb[o + 1] or pa[o + 2] != pb[o + 2]:
            diff[i] = 1
            n_diff += 1
        if (pa[o] < WHITE_THRESHOLD or pa[o + 1] < WHITE_THRESHOLD
                or pa[o + 2] < WHITE_THRESHOLD
                or pb[o] < WHITE_THRESHOLD or pb[o + 1] < WHITE_THRESHOLD
                or pb[o + 2] < WHITE_THRESHOLD):
            content[i] = 1
    identical_frac = 1.0 - n_diff / n
    mean_abs_rgb = abs_sum / (3.0 * n)
    report.update({
        "identical_frac": round(identical_frac, 6),
        "identical_pct": round(100.0 * identical_frac, 3),
        "differing_px": n_diff,
        "mean_abs_rgb": round(mean_abs_rgb, 3),
    })
    if identical_frac < PNG_MIN_IDENTICAL:
        failures.append(
            f"identical {100.0 * identical_frac:.3f}% < {100.0 * PNG_MIN_IDENTICAL:.0f}%")
    if mean_abs_rgb > PNG_MAX_MEAN_ABS_RGB:
        failures.append(f"mean abs RGB diff {mean_abs_rgb:.3f} > {PNG_MAX_MEAN_ABS_RGB}/255")
    if n_diff:
        # For each differing px: is any of its 8 NEIGHBOURS (self excluded)
        # a content pixel in either image, and does it have a differing
        # 8-neighbour (non-isolated)? The neighbour loops run only over
        # differing pixels (120k on the L8 pair, not all 2.87M).
        far = 0
        isolated = 0
        diff_idx = [i for i in range(n) if diff[i]]
        for i in diff_idx:
            y, x = divmod(i, w)
            near_content = False
            near_diff = False
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    xx = x + dx
                    if xx < 0 or xx >= w:
                        continue
                    j = yy * w + xx
                    if content[j]:
                        near_content = True
                    if diff[j]:
                        near_diff = True
            if not near_content:
                far += 1
            if not near_diff:
                isolated += 1
        report["differing_far_from_content"] = far
        report["isolated_differing_px"] = isolated
        if far:
            failures.append(f"{far} differing px > 1 px from shared content")
        if isolated:
            failures.append(f"{isolated} isolated differing px")
    else:
        report["differing_far_from_content"] = 0
        report["isolated_differing_px"] = 0
    report["failures"] = failures
    return (not failures), report


# --- SVG comparison: L8 §5 rule 2 ------------------------------------------
def normalize_svg_ids(text):
    """Replace Plotly's per-render random ids with a fixed token."""
    for pat, tok in ID_PATTERNS:
        text = pat.sub(tok, text)
    return text


def _local(tag):
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def compare_svg(a_path, b_path):
    """Compare two SVGs under the L8 rule. Returns (verdict, report dict)."""
    try:
        with open(a_path, encoding="utf-8", errors="replace") as f:
            ta = f.read()
        with open(b_path, encoding="utf-8", errors="replace") as f:
            tb = f.read()
    except OSError as e:
        raise CompareError(str(e))
    na, nb = normalize_svg_ids(ta), normalize_svg_ids(tb)
    report = {"a": os.path.basename(a_path), "b": os.path.basename(b_path)}
    failures = []
    try:
        ra, rb = ET.fromstring(na), ET.fromstring(nb)
    except ET.ParseError as e:
        raise CompareError(f"SVG parse error: {e}")

    def walk(root):
        counts, texts, nums = {}, [], []
        for el in root.iter():
            tag = _local(el.tag)
            counts[tag] = counts.get(tag, 0) + 1
            if el.text and el.text.strip():
                texts.append(el.text.strip())
            for v in el.attrib.values():
                nums.extend(float(m) for m in NUMBER_RE.findall(v))
            if el.tail and el.tail.strip():
                texts.append(el.tail.strip())
        return counts, texts, nums

    ca, ta_texts, na_nums = walk(ra)
    cb, tb_texts, nb_nums = walk(rb)
    report["element_counts_a"] = ca
    report["element_counts_b"] = cb
    if ca != cb:
        only = {k: (ca.get(k, 0), cb.get(k, 0)) for k in set(ca) | set(cb)
                if ca.get(k, 0) != cb.get(k, 0)}
        failures.append(f"element counts differ by tag: {only}")
    if ta_texts != tb_texts:
        diffs = [(i, x, y) for i, (x, y) in enumerate(zip(ta_texts, tb_texts)) if x != y]
        failures.append(
            f"text nodes differ ({len(ta_texts)} vs {len(tb_texts)} nodes"
            + (f"; first diffs: {diffs[:3]}" if diffs else "; length differs")
            + ")")
    report["text_nodes"] = len(ta_texts)
    if len(na_nums) != len(nb_nums):
        failures.append(
            f"numeric attribute count differs: {len(na_nums)} vs {len(nb_nums)}")
        report["max_numeric_delta"] = None
    else:
        deltas = [abs(x - y) for x, y in zip(na_nums, nb_nums)]
        max_delta = max(deltas) if deltas else 0.0
        report["numeric_values"] = len(na_nums)
        report["max_numeric_delta"] = round(max_delta, 3)
        if max_delta > SVG_MAX_NUMERIC_DELTA:
            worst = sorted(
                ((d, x, y) for d, x, y in zip(deltas, na_nums, nb_nums)),
                reverse=True)[:3]
            failures.append(
                f"max numeric delta {max_delta:.3f} px > {SVG_MAX_NUMERIC_DELTA} px "
                f"(worst: {worst})")
    report["failures"] = failures
    return (not failures), report


# --- Pixel geometry (for the screenshot cases) ------------------------------
def ink_mask(png, threshold=INK_THRESHOLD):
    """bytearray, 1 where any RGB channel is below threshold (a drawn mark)."""
    rgba = png["rgba"]
    n = png["width"] * png["height"]
    mask = bytearray(n)
    for i in range(n):
        o = i * 4
        if rgba[o] < threshold or rgba[o + 1] < threshold or rgba[o + 2] < threshold:
            mask[i] = 1
    return mask


def ink_fraction(png, rect=None, threshold=INK_THRESHOLD):
    """Fraction of pixels in rect (x0, y0, x1, y1, exclusive) that are ink."""
    w, h = png["width"], png["height"]
    x0, y0, x1, y1 = rect or (0, 0, w, h)
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    mask = ink_mask(png, threshold)
    total = max(1, (x1 - x0) * (y1 - y0))
    ink = sum(mask[y * w + x] for y in range(y0, y1) for x in range(x0, x1))
    return ink / total


def ink_bbox(png, threshold=INK_THRESHOLD):
    """Bounding box (x0, y0, x1, y1, exclusive) of all ink, or None if blank."""
    w, h = png["width"], png["height"]
    mask = ink_mask(png, threshold)
    xs = [x for y in range(h) for x in range(w) if mask[y * w + x]]
    if not xs:
        return None
    ys = [y for y in range(h) for x in range(w) if mask[y * w + x]]
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1)


def column_bands(png, rect=None, min_gap=3, threshold=INK_THRESHOLD):
    """Contiguous x-runs that contain ink, as [(x0, x1)] — the vertical marks
    (bars, points, whiskers) in a column-family graph. Runs separated by a
    gap of < min_gap ink-free columns are merged."""
    w, h = png["width"], png["height"]
    x0, y0, x1, y1 = rect or (0, 0, w, h)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        return []
    mask = ink_mask(png, threshold)
    col_has = [any(mask[y * w + x] for y in range(y0, y1)) for x in range(x0, x1)]
    bands, start = [], None
    gap = 0
    for i, has in enumerate(col_has):
        if has:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                bands.append((x0 + start, x0 + i - gap + 1))
                start, gap = None, 0
    if start is not None:
        bands.append((x0 + start, x0 + len(col_has) - gap))
    return bands


def columns_with_ink_frac(png, rect=None, threshold=INK_THRESHOLD):
    """Fraction of columns in rect containing any ink. A fitted curve spans
    nearly every column (>0.9); discrete points leave most columns empty."""
    w, h = png["width"], png["height"]
    x0, y0, x1, y1 = rect or (0, 0, w, h)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    mask = ink_mask(png, threshold)
    n = max(1, x1 - x0)
    hit = sum(1 for x in range(x0, x1)
              if any(mask[y * w + x] for y in range(y0, y1)))
    return hit / n


def longest_horizontal_run(png, rect=None, threshold=INK_THRESHOLD):
    """Longest run of consecutive ink pixels in a single row, as
    (length, y, x0, x1). A significance bracket is a long horizontal run
    sitting above the bars; a bar top is one too, so callers check the y."""
    w, h = png["width"], png["height"]
    x0, y0, x1, y1 = rect or (0, 0, w, h)
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(w, x1), min(h, y1)
    mask = ink_mask(png, threshold)
    best = (0, -1, -1, -1)
    for y in range(y0, y1):
        run, start = 0, x0
        for x in range(x0, x1 + 1):
            if x < x1 and mask[y * w + x]:
                if run == 0:
                    start = x
                run += 1
            else:
                if run > best[0]:
                    best = (run, y, start, x)
                run = 0
    return best


def svg_canvas_size(svg_path):
    """(width, height) of an SVG's canvas from its root attributes, or None."""
    try:
        with open(svg_path, encoding="utf-8", errors="replace") as f:
            text = normalize_svg_ids(f.read())
        root = ET.fromstring(text)
    except (OSError, ET.ParseError):
        return None
    try:
        return (float(root.get("width", 0)), float(root.get("height", 0)))
    except (TypeError, ValueError):
        return None


def plot_area_from_svg(svg_path):
    """Best-effort plot area (x0, y0, x1, y1) in SVG pixels from the
    axes clipPath rect, else the first clipPath rect, else the whole
    canvas. Returns None if unreadable.

    NOTE (live-run fix): Plotly exports carry several clipPaths — the
    FIRST is the whole-figure clip (xyplot, rect = full canvas), which
    made every geometry assertion see the y-axis labels/title as extra
    ink bands. The axes box is the clipPath with class "axesclip"
    (id ...xy), strictly inside the canvas — that is the plot area.
    """
    try:
        with open(svg_path, encoding="utf-8", errors="replace") as f:
            text = normalize_svg_ids(f.read())
        root = ET.fromstring(text)
    except (OSError, ET.ParseError):
        return None
    first_rect = None
    axes_rects = []
    for el in root.iter():
        if _local(el.tag) == "clipPath":
            for r in el.iter():
                if _local(r.tag) == "rect":
                    try:
                        rect = (float(r.get("x", 0)), float(r.get("y", 0)),
                                float(r.get("x", 0)) + float(r.get("width", 0)),
                                float(r.get("y", 0)) + float(r.get("height", 0)))
                    except (TypeError, ValueError):
                        return None
                    if first_rect is None:
                        first_rect = rect
                    # The axes clip is the plot area; the whole-figure
                    # clip (class "plotclip") is not. Plotly exports
                    # THREE axesclip rects (x, y, xy) — the xy one is
                    # the intersection, i.e. the smallest area.
                    if "axesclip" in (el.get("class") or ""):
                        axes_rects.append(rect)
    if axes_rects:
        return min(axes_rects,
                   key=lambda r: (r[2] - r[0]) * (r[3] - r[1]))
    return first_rect


def svg_texts(svg_path):
    """All text-node strings in an SVG (id-normalized)."""
    with open(svg_path, encoding="utf-8", errors="replace") as f:
        text = normalize_svg_ids(f.read())
    root = ET.fromstring(text)
    out = []
    for el in root.iter():
        if el.text and el.text.strip():
            out.append(el.text.strip())
        if el.tail and el.tail.strip():
            out.append(el.tail.strip())
    return out


# --- CLI --------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(
        description="L8 normalized screenshot comparator (PNG/SVG; bytes never compared)")
    ap.add_argument("a", help="first file (PNG or SVG)")
    ap.add_argument("b", help="second file (PNG or SVG)")
    ap.add_argument("--json", action="store_true", help="print the report as JSON")
    args = ap.parse_args(argv)
    ext = os.path.splitext(args.a)[1].lower()
    try:
        if ext == ".png":
            verdict, report = compare_png(args.a, args.b)
        elif ext == ".svg":
            verdict, report = compare_svg(args.a, args.b)
        else:
            print(f"unsupported extension {ext!r} (want .png or .svg)", file=sys.stderr)
            return 2
    except CompareError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps({"pass": verdict, **report}, indent=2, default=str))
    else:
        print(("PASS" if verdict else "FAIL") + f": {args.a} vs {args.b}")
        for k, v in report.items():
            if k != "failures":
                print(f"  {k}: {v}")
        for f in report.get("failures", []):
            print(f"  FAIL: {f}")
    return 0 if verdict else 1


if __name__ == "__main__":
    sys.exit(main())
