#!/usr/bin/env python3
"""mpmath (50-digit) exact ssRes/s/R^2/P for fitLinear at 1e13 scale.

Reads the doubles in <worktree>/tests/testdata/precision-1e13.json (the same
doubles the TS side sees) and appends a "fitLinear" entry to
<worktree>/probe/expected-precision.json:
- unweighted: xyBig, intercept fit (n=10, dof=8)
- weighted1y: xyBig with 1/y weights (the doubles 1/y, as fitLinear computes them)
- origin: xyBigOrigin, through the origin (n=10, dof=9)

Exact formulas mirror fitLinear's definitions (src/views/graphs/regression-overlay.ts):
slope/intercept from the weighted centered sums, ssRes = sum(w*(y-yhat)^2),
s = sqrt(ssRes/dof), r2 = 1 - ssRes/ssTot (ssTot uncentered for the origin fit),
t = slope/(s/sqrt(sxx)), two-sided p from the t distribution.
"""
import json
import sys
from pathlib import Path

import mpmath as mp
from scipy import stats

mp.mp.dps = 50
WT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")


def mpf_list(vs):
    return [mp.mpf(v) for v in vs]


def fitlinear_exact(x, y, weights=None, origin=False):
    X, Y = mpf_list(x), mpf_list(y)
    n = len(X)
    w = [mp.mpf(1)] * n if weights is None else [mp.mpf(wi) for wi in weights]
    sw = sum(w)
    if origin:
        sxx = sum(wi * xi * xi for wi, xi in zip(w, X))
        slope = sum(wi * xi * yi for wi, xi, yi in zip(w, X, Y)) / sxx
        b0 = mp.mpf(0)
        resid = [yi - slope * xi for xi, yi in zip(X, Y)]
        sst = sum(wi * yi * yi for wi, yi in zip(w, Y))
        dof = n - 1
    else:
        mx = sum(wi * xi for wi, xi in zip(w, X)) / sw
        my = sum(wi * yi for wi, yi in zip(w, Y)) / sw
        sxx = sum(wi * (xi - mx) ** 2 for wi, xi in zip(w, X))
        sxy = sum(wi * (xi - mx) * (yi - my) for wi, xi, yi in zip(w, X, Y))
        slope = sxy / sxx
        b0 = my - slope * mx
        resid = [(yi - my) - slope * (xi - mx) for xi, yi in zip(X, Y)]
        sst = sum(wi * (yi - my) ** 2 for wi, yi in zip(w, Y))
        dof = n - 2
    ssres = sum(wi * e * e for wi, e in zip(w, resid))
    s = mp.sqrt(ssres / dof)
    r2 = 1 - ssres / sst
    t = slope / (s / mp.sqrt(sxx))
    z = mp.mpf(dof) / (dof + t ** 2)
    p = mp.betainc(mp.mpf(dof) / 2, mp.mpf(1) / 2, 0, z, regularized=True)
    return {
        "slope": float(slope), "intercept": float(b0),
        "ssRes": float(ssres), "s": float(s),
        "r2": float(r2), "p": float(p),
        "tcrit": float(stats.t.ppf(0.975, dof)),
    }


tables = json.loads((WT / "tests" / "testdata" / "precision-1e13.json").read_text())
xs = [float(r[1]) for r in tables["xyBig"]["rows"]]
ys = [float(r[2]) for r in tables["xyBig"]["rows"]]
xo = [float(r[1]) for r in tables["xyBigOrigin"]["rows"]]
yo = [float(r[2]) for r in tables["xyBigOrigin"]["rows"]]

expected = json.loads((WT / "probe" / "expected-precision.json").read_text())
expected["fitLinear"] = {
    "unweighted": fitlinear_exact(xs, ys),
    "weighted1y": fitlinear_exact(xs, ys, weights=[1 / y for y in ys]),
    "origin": fitlinear_exact(xo, yo, origin=True),
}
(WT / "probe" / "expected-precision.json").write_text(json.dumps(expected, indent=1))
print(json.dumps(expected["fitLinear"], indent=1))
