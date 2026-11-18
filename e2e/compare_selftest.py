# e2e/compare_selftest.py — offline FAIL-pin proof for e2e/compare.py.
#
# Every assertion the screenshot cases rely on is proven here to (a) PASS on
# a good render and (b) FAIL on a deliberately broken one — the pre-fix FAIL /
# post-fix PASS pin, runnable with no app, no display, no network:
#
#   python3 e2e/compare_selftest.py [--l8-dir DIR]
#
# Broken variants used: blank export, right-edge clip (the Q-20 BUG-1 shape),
# 10 px layout shift, wrong dimensions, SVG with a 30 px-shifted label, SVG
# with a dropped text node, SVG with an extra element. Good variants: the
# identical file, and — when the L8 pair is present — the real Mac-vs-headless
# survival exports, which must PASS under the L8 rule with the numbers the L8
# lane measured (95.804% identical, mean abs RGB 5.998, 100% near content,
# 0 isolated; SVG max real numeric delta 13 px).
#
# The L8 pair lives in the repo at qa/reference/l8-survival/ (committed by
# this lane); --l8-dir overrides the location (default: that repo path, else
# the lane's original dirs outside the repo).
#
# Exit 0 iff every pin behaves as specified. Writes nothing outside --out-dir
# (default: a temp dir under /tmp — fixtures only, never the repo).
import argparse
import json
import math
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare  # noqa: E402
from compare import (  # noqa: E402
    compare_png, compare_svg, read_png, write_png_rgba, ink_bbox,
    column_bands, columns_with_ink_frac, longest_horizontal_run,
    ink_fraction, normalize_svg_ids,
)

W, H = 640, 460  # the SVG canvas size; PNG fixtures use the same grid


def _blank_rgba(w, h):
    return bytearray([255] * (w * h * 4))


def _bar_chart_rgba(w=W, h=H, n_bars=4, clip_right=False, shift_x=0,
                    truncate_right=False):
    """Four solid bars on white, like a mean-error graph export. clip_right
    drops the last bar (the BUG-1 shape); truncate_right draws it half-width
    (a clipped-at-the-edge bar); shift_x moves every bar right."""
    px = _blank_rgba(w, h)
    bar_w, gap, base_y, top = 60, 40, 400, 120
    for i in range(n_bars):
        if clip_right and i == n_bars - 1:
            continue
        width = bar_w // 2 if (truncate_right and i == n_bars - 1) else bar_w
        x0 = 80 + i * (bar_w + gap) + shift_x
        bh = top + i * 40  # bars of increasing height, tops 120..240
        for y in range(bh, base_y):
            for x in range(x0, x0 + width):
                if 0 <= x < w:
                    o = (y * w + x) * 4
                    px[o:o + 3] = bytes((31, 119, 180))
                    px[o + 3] = 255
    return px


def _points_only_rgba(w=W, h=H, n_points=12):
    """Discrete point blobs, no connecting curve (the Q-31 no-curve shape)."""
    px = _blank_rgba(w, h)
    for i in range(n_points):
        cx, cy = 60 + i * 45, 120 + (i * 37) % 220
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                if dx * dx + dy * dy <= 16:
                    o = ((cy + dy) * w + cx + dx) * 4
                    px[o:o + 3] = bytes((31, 119, 180))
                    px[o + 3] = 255
    return px


def _curve_rgba(w=W, h=H):
    """Points + a continuous curve spanning the plot width (Q-31 control)."""
    px = _points_only_rgba(w, h)
    for x in range(60, 600):
        y = int(300 - 120 * math.sin((x - 60) / 540.0 * math.pi))
        for dy in (-1, 0, 1):
            o = ((y + dy) * w + x) * 4
            px[o:o + 3] = bytes((214, 39, 40))
            px[o + 3] = 255
    return px


def _svg_text(path, shift_x=0, drop_text=False, extra_element=False):
    """A small Plotly-shaped SVG: clip rect, 2 trace paths, 3 text labels,
    one with a random-looking id (defs-/clip-/trace- hex ids, as Plotly emits)."""
    uid = "d852fb"
    texts = ["Control", "Treatment A", "42"]
    if drop_text:
        texts = texts[:2]
    extra = '<rect x="10" y="10" width="5" height="5"/>' if extra_element else ""
    body = f"""<svg xmlns="http://www.w3.org/2000/svg" width="640" height="460" viewBox="0 0 640 460">
<defs><clipPath id="clip{uid}xy"><rect x="80" y="20" width="480" height="380"/></clipPath></defs>
<g class="trace{uid}"><path d="M 100 300 L 200 200 L 300 250"/></g>
<g class="traceab12cd"><path d="M 100 350 L 200 300 L 300 320"/></g>
<text x="{100 + shift_x}" y="50">{texts[0]}</text>
<text x="200" y="50">{texts[1]}</text>
{"<text x=" + '"300" y="50">' + texts[2] + "</text>" if len(texts) > 2 else ""}
{extra}</svg>"""
    with open(path, "w") as f:
        f.write(body)


class Pins:
    def __init__(self):
        self.results = []

    def check(self, name, good_ok, bad_ok, detail):
        """A pin passes iff the good variant passes AND the broken one fails."""
        ok = good_ok and not bad_ok
        self.results.append({"name": name, "ok": ok, "detail": detail})
        print(f"[{'PASS' if ok else 'FAIL'}] {name} — {detail}", flush=True)
        return ok

    def summary(self):
        n = sum(1 for r in self.results if r["ok"])
        print(f"\n== compare self-test: {n}/{len(self.results)} pins ==", flush=True)
        return 0 if n == len(self.results) else 1


def run(l8_dir, out_dir):
    pins = Pins()
    good_png = os.path.join(out_dir, "good.png")
    write_png_rgba(good_png, W, H, _bar_chart_rgba())
    blank_png = os.path.join(out_dir, "blank.png")
    write_png_rgba(blank_png, W, H, _blank_rgba(W, H))
    clip_png = os.path.join(out_dir, "clipped.png")
    write_png_rgba(clip_png, W, H, _bar_chart_rgba(clip_right=True))
    shift_png = os.path.join(out_dir, "shifted.png")
    write_png_rgba(shift_png, W, H, _bar_chart_rgba(shift_x=10))

    # 1. Comparator: identical file passes.
    v, rep = compare_png(good_png, good_png)
    pins.check("png_identical_passes", v, False,
               f"identical file: {rep['identical_pct']}% identical (expect 100%)")

    # 2. Comparator: blank export fails the similarity rule.
    v_blank, rep_blank = compare_png(good_png, blank_png)
    pins.check("png_blank_fails", True, v_blank,
               f"blank vs good: {rep_blank['identical_pct']}% identical, "
               f"mean abs {rep_blank['mean_abs_rgb']} (expect FAIL)")

    # 3. Comparator: 10 px layout shift fails (differing px far from content).
    v_shift, rep_shift = compare_png(good_png, shift_png)
    pins.check("png_shifted_fails", True, v_shift,
               f"shifted 10 px: {rep_shift['identical_pct']}% identical, "
               f"{rep_shift.get('differing_far_from_content')} px far from content "
               f"(expect FAIL)")

    # 4. Geometry: 4 bar bands on the good render, 3 on the clipped one.
    good = read_png(good_png)
    clip = read_png(clip_png)
    bands_good = column_bands(good, rect=(60, 60, 620, 420))
    bands_clip = column_bands(clip, rect=(60, 60, 620, 420))
    pins.check("geometry_bar_bands", len(bands_good) == 4, len(bands_clip) == 4,
               f"bands good={len(bands_good)} clipped={len(bands_clip)} (expect 4 vs 3)")
    # Rightmost band complete: its width matches the median band width.
    # The bad variant is a half-truncated last bar (clipped at the edge).
    trunc_png = os.path.join(out_dir, "truncated.png")
    write_png_rgba(trunc_png, W, H, _bar_chart_rgba(truncate_right=True))
    bands_trunc = column_bands(read_png(trunc_png), rect=(60, 60, 620, 420))
    widths = [x1 - x0 for x0, x1 in bands_good]
    med = sorted(widths)[len(widths) // 2]
    trunc_last = bands_trunc[-1][1] - bands_trunc[-1][0] if bands_trunc else 0
    pins.check("geometry_rightmost_complete",
               all(abs(wd - med) <= 2 for wd in widths),
               abs(trunc_last - med) <= 2,
               f"good band widths={widths} median={med}; truncated last width="
               f"{trunc_last} (expect ~{med // 2})")

    # 5. Geometry: points-only vs curve — column ink coverage discriminates.
    pts_png = os.path.join(out_dir, "points.png")
    write_png_rgba(pts_png, W, H, _points_only_rgba())
    cur_png = os.path.join(out_dir, "curve.png")
    write_png_rgba(cur_png, W, H, _curve_rgba())
    pts, cur = read_png(pts_png), read_png(cur_png)
    f_pts = columns_with_ink_frac(pts, rect=(60, 60, 600, 420))
    f_cur = columns_with_ink_frac(cur, rect=(60, 60, 600, 420))
    pins.check("geometry_curve_vs_points", f_cur > 0.9, f_pts > 0.9,
               f"columns-with-ink: points-only={f_pts:.2f} curve={f_cur:.2f} "
               f"(expect <0.9 vs >0.9)")
    pins.check("geometry_blank_is_blank", ink_fraction(read_png(blank_png)) < 0.001,
               ink_fraction(good) < 0.001,
               f"ink fraction blank={ink_fraction(read_png(blank_png)):.4f} "
               f"good={ink_fraction(good):.3f}")

    # 6. Geometry: a bracket is a long horizontal run above the bars.
    br_png = os.path.join(out_dir, "bracket.png")
    px = _bar_chart_rgba()
    for x in range(80, 240):  # bracket over bars 0..1, above the tallest bar top
        for dy in (0, 1):
            o = ((100 + dy) * W + x) * 4
            px[o:o + 3] = bytes((0, 0, 0))
            px[o + 3] = 255
    write_png_rgba(br_png, W, H, px)
    run_len, run_y, _, _ = longest_horizontal_run(read_png(br_png), rect=(60, 60, 620, 420))
    run_len0, _, _, _ = longest_horizontal_run(good, rect=(60, 60, 620, 420))
    pins.check("geometry_bracket_run", run_len >= 150 and run_y < 120,
               run_len0 >= 150,
               f"bracket run={run_len} px at y={run_y}; no-bracket longest={run_len0} px "
               f"(bar tops are 60 px)")

    # 7. SVG: identical file passes; id-normalization absorbs a fresh uid.
    good_svg = os.path.join(out_dir, "good.svg")
    _svg_text(good_svg)
    v_svg, rep_svg = compare_svg(good_svg, good_svg)
    other_svg = os.path.join(out_dir, "other-uid.svg")
    _svg_text(other_svg)  # same content, ids differ only by the uid token set
    with open(other_svg) as f:
        txt = f.read().replace("d852fb", "da5072").replace("ab12cd", "c7e098")
    with open(other_svg, "w") as f:
        f.write(txt)
    v_uid, rep_uid = compare_svg(good_svg, other_svg)
    pins.check("svg_uid_normalization", v_svg and v_uid, False,
               f"same svg: {v_svg}; fresh Plotly uid: {v_uid} "
               f"(max numeric delta {rep_uid.get('max_numeric_delta')})")

    # 8. SVG: a 30 px label shift fails the +/-15 px rule.
    shifted_svg = os.path.join(out_dir, "shifted.svg")
    _svg_text(shifted_svg, shift_x=30)
    v_s, rep_s = compare_svg(good_svg, shifted_svg)
    pins.check("svg_shifted_label_fails", True, v_s,
               f"30 px shift: max delta {rep_s.get('max_numeric_delta')} px (expect FAIL)")

    # 9. SVG: a dropped text node / an extra element fails.
    drop_svg = os.path.join(out_dir, "dropped.svg")
    _svg_text(drop_svg, drop_text=True)
    v_d, rep_d = compare_svg(good_svg, drop_svg)
    extra_svg = os.path.join(out_dir, "extra.svg")
    _svg_text(extra_svg, extra_element=True)
    v_e, rep_e = compare_svg(good_svg, extra_svg)
    pins.check("svg_text_and_structure", True, v_d and v_e,
               f"dropped text: {v_d}; extra element: {v_e} (expect both FAIL)")

    # 10. L8 real pair (if present): Mac-vs-headless survival must PASS with
    # the L8 lane's numbers, and the byte hashes must still differ (the rule
    # is similarity, not bytes — a byte-identical pair would make this vacuous).
    if l8_dir and os.path.isdir(l8_dir):
        mac_png = os.path.join(l8_dir, "mac.png")
        lin_png = os.path.join(l8_dir, "linux.png")
        mac_svg = os.path.join(l8_dir, "mac.svg")
        lin_svg = os.path.join(l8_dir, "linux.svg")
        have = all(os.path.isfile(p) for p in (mac_png, lin_png, mac_svg, lin_svg))
        if have:
            v_l8, rep_l8 = compare_png(mac_png, lin_png)
            pins.check(
                "l8_real_png_passes", v_l8, False,
                f"Mac vs headless PNG: {rep_l8['identical_pct']}% identical "
                f"(L8: 95.804%), mean abs {rep_l8['mean_abs_rgb']} (L8: 5.998), "
                f"far={rep_l8.get('differing_far_from_content')} "
                f"isolated={rep_l8.get('isolated_differing_px')} "
                f"(L8: 0 / 0), dims {rep_l8['a_dims']} dpi {rep_l8['a_dpi']}")
            v_l8s, rep_l8s = compare_svg(mac_svg, lin_svg)
            pins.check(
                "l8_real_svg_passes", v_l8s, False,
                f"Mac vs headless SVG: texts={rep_l8s['text_nodes']}, "
                f"max numeric delta {rep_l8s.get('max_numeric_delta')} px (L8: 13), "
                f"counts equal={rep_l8s['element_counts_a'] == rep_l8s['element_counts_b']}")
            import hashlib
            same_bytes = (hashlib.sha256(open(mac_png, "rb").read()).hexdigest()
                          == hashlib.sha256(open(lin_png, "rb").read()).hexdigest())
            pins.check("l8_bytes_still_differ", not same_bytes, False,
                       "PNG bytes differ (byte-equality would FAIL — the rule "
                       "is similarity, not bytes)")
        else:
            print("SKIP l8_real_*: reference pair not found in " + l8_dir, flush=True)
    else:
        print("SKIP l8_real_*: no --l8-dir found", flush=True)

    with open(os.path.join(out_dir, "compare-selftest.json"), "w") as f:
        json.dump({"pins": pins.results}, f, indent=2)
    return pins.summary()


def main():
    ap = argparse.ArgumentParser(description="Offline FAIL-pin proof for e2e/compare.py")
    ap.add_argument("--l8-dir", default=None,
                    help="dir with mac.png/linux.png/mac.svg/linux.svg (default: repo qa/reference/l8-survival)")
    ap.add_argument("--out-dir", default=None, help="fixture dir (default: temp dir)")
    args = ap.parse_args()
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    l8_dir = args.l8_dir or os.path.join(repo, "qa", "reference", "l8-survival")
    if not os.path.isdir(l8_dir):
        l8_dir = None  # references not committed yet: L8 pins skip, loudly
    out_dir = args.out_dir or tempfile.mkdtemp(prefix="compare-selftest-")
    os.makedirs(out_dir, exist_ok=True)
    print(f"fixtures: {out_dir}", flush=True)
    if l8_dir:
        print(f"L8 pair: {l8_dir}", flush=True)
    return run(l8_dir, out_dir)


if __name__ == "__main__":
    sys.exit(main())
