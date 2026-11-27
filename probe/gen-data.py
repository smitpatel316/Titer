#!/usr/bin/env python3
"""Generate 1e13-scale precision fixtures + mpmath (50-digit) exact values.

Datasets (all values are Python floats == IEEE doubles; JSON round-trips them
exactly, so the TS side sees the identical doubles):
- anovaBig: 9 groups x 201, SmLs09 shape, values ~1e13, 13 constant leading digits
- anovaSmall: 3 groups x 5, same scale
- linreg: 10 pts, x ~ 1e13, y = 2*x + 1000 + noise
- linregOrigin: 10 pts, x ~ 1e13, y = 2*x + noise (through origin)
- multireg: 12 rows, x1/x2 ~ 1e13, y = 1000 + 2*x1c - 1.5*x2c + noise

Writes:
- <worktree>/tests/testdata/precision-1e13.json  (tables for reference.ts)
- <worktree>/probe/expected-precision.json       (mpmath exact values)
"""
import json
import random
import sys
from pathlib import Path

import mpmath as mp
from scipy import stats

mp.mp.dps = 50
WT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
rng = random.Random(20261126)


def g(mu=0.0, sd=1.0):
    return rng.gauss(mu, sd)


BASE = 1e13

# --- ANOVA big: 9 groups x 201, group means spread +-2.8, within SD 0.35 ---
anova_big = []
for i in range(9):
    off = (i - 4) * 0.7
    anova_big.append([BASE + off + g(0, 0.35) for _ in range(201)])
# --- ANOVA small: 3 groups x 5, means +0/+0.8/+1.6, within SD 0.3 ---
anova_small = []
for i in range(3):
    off = i * 0.8
    anova_small.append([BASE + off + g(0, 0.3) for _ in range(5)])

# --- Linear regression: x = 1e13 + 0..4.5 step 0.5, y = 2x + 1000 + N(0,0.1) ---
xs = [BASE + 0.5 * i for i in range(10)]
ys = [2 * x + 1000 + g(0, 0.1) for x in xs]
ys_o = [2 * x + g(0, 0.1) for x in xs]  # origin: no intercept

# --- Multiple regression: 12 rows, x1/x2 ~ 1e13, y = 1000 + 2*x1c - 1.5*x2c ---
x1 = [BASE + g(0, 1.5) for _ in range(12)]
x2 = [BASE + g(0, 1.2) for _ in range(12)]
ym = [1000 + 2 * (a - BASE) - 1.5 * (b - BASE) + g(0, 0.2) for a, b in zip(x1, x2)]


# --- exact helpers (mpmath, 50 digits; inputs are the exact doubles) ---
# NOTE: mpf(float) is the DOUBLE's exact binary value. mpf(repr(v)) parses the
# decimal string instead — at 1e13 the nearest double is up to ~0.001 off the
# decimal, which moves F at 1e-4. The TS side sees doubles (parseFloat of the
# repr strings), so the exact values must be computed from the doubles.
def mpf_list(vs):
    return [mp.mpf(v) for v in vs]


def anova_exact(groups):
    gs = [mpf_list(v) for v in groups]
    k = len(gs)
    n = [len(v) for v in gs]
    N = sum(n)
    means = [sum(v) / len(v) for v in gs]
    gm = sum(sum(v) for v in gs) / N
    ssb = sum(ni * (m - gm) ** 2 for ni, m in zip(n, means))
    ssw = sum(sum((x - m) ** 2 for x in v) for v, m in zip(gs, means))
    dfb, dfw = k - 1, N - k
    msb, msw = ssb / dfb, ssw / dfw
    F = msb / msw
    # P(F > Fobs) = I_{dfw/(dfw+dfb*F)}(dfw/2, dfb/2)
    z = mp.mpf(dfw) / (dfw + dfb * F)
    p = mp.betainc(mp.mpf(dfw) / 2, mp.mpf(dfb) / 2, 0, z, regularized=True)
    eta2 = ssb / (ssb + ssw)
    return {
        "F": float(F), "p": float(p), "dfn": dfb, "dfd": dfw,
        "ssB": float(ssb), "ssE": float(ssw), "eta2": float(eta2),
        "f": float(mp.sqrt(eta2 / (1 - eta2))),
    }


def linreg_exact(x, y, weights=None):
    X, Y = mpf_list(x), mpf_list(y)
    n = len(X)
    if weights is None:
        w = [mp.mpf(1)] * n
    else:
        w = [mp.mpf(wi) for wi in weights]
    sw = sum(w)
    mx = sum(wi * xi for wi, xi in zip(w, X)) / sw
    my = sum(wi * yi for wi, yi in zip(w, Y)) / sw
    sxx = sum(wi * (xi - mx) ** 2 for wi, xi in zip(w, X))
    sxy = sum(wi * (xi - mx) * (yi - my) for wi, xi, yi in zip(w, X, Y))
    slope = sxy / sxx
    b0 = my - slope * mx
    fitted = [b0 + slope * xi for xi in X]
    resid = [yi - fi for yi, fi in zip(Y, fitted)]
    sse = sum(wi * e * e for wi, e in zip(w, resid))
    sst = sum(wi * (yi - my) ** 2 for wi, yi in zip(w, Y))
    r2 = 1 - sse / sst
    df = n - 2
    sig2 = sse / df
    se_slope = mp.sqrt(sig2 / sxx)
    se_b0 = mp.sqrt(sig2 * (mp.mpf(1) / sw + mx ** 2 / sxx))
    t = slope / se_slope
    # two-sided p from t: P(|T|>|t|) = I_{df/(df+t^2)}(df/2, 1/2)
    z = mp.mpf(df) / (df + t ** 2)
    p = mp.betainc(mp.mpf(df) / 2, mp.mpf(1) / 2, 0, z, regularized=True)
    tcrit = stats.t.ppf(0.975, df)
    # Pearson r (unweighted, as the spec reports it): from the unweighted sums
    umx = sum(X) / n
    umy = sum(Y) / n
    uxx = sum((xi - umx) ** 2 for xi in X)
    uyy = sum((yi - umy) ** 2 for yi in Y)
    uxy = sum((xi - umx) * (yi - umy) for xi, yi in zip(X, Y))
    r = uxy / mp.sqrt(uxx * uyy)
    return {
        "slope": float(slope), "intercept": float(b0),
        "slopeSe": float(se_slope), "interceptSe": float(se_b0),
        "slopeCiLo": float(slope - tcrit * se_slope),
        "slopeCiHi": float(slope + tcrit * se_slope),
        "interceptCiLo": float(b0 - tcrit * se_b0),
        "interceptCiHi": float(b0 + tcrit * se_b0),
        "r2": float(r2), "p": float(p), "tcrit": float(tcrit),
        "r": float(r),
    }


def multireg_exact(x1v, x2v, yv):
    X1, X2, Y = mpf_list(x1v), mpf_list(x2v), mpf_list(yv)
    n = len(Y)
    mx1 = sum(X1) / n
    mx2 = sum(X2) / n
    my = sum(Y) / n
    # centered design: slopes from (Xc'Xc)^-1 Xc'yc
    Xc = [[xi - mx1, xj - mx2] for xi, xj in zip(X1, X2)]
    yc = [yi - my for yi in Y]
    A = mp.matrix(2, 2)
    b = mp.matrix(2, 1)
    for a in range(2):
        for c in range(2):
            A[a, c] = sum(row[a] * row[c] for row in Xc)
        b[a] = sum(row[a] * yci for row, yci in zip(Xc, yc))
    beta = mp.lu_solve(A, b)
    b1, b2 = beta[0], beta[1]
    b0 = my - b1 * mx1 - b2 * mx2
    fitted_c = [b1 * row[0] + b2 * row[1] for row in Xc]
    ssr = sum(f * f for f in fitted_c)
    resid = [yci - fi for yci, fi in zip(yc, fitted_c)]
    sse = sum(e * e for e in resid)
    sst = sum(yci * yci for yci in yc)
    r2 = 1 - sse / sst
    p = 2
    F = (ssr / p) / (sse / (n - p - 1))
    df1, df2 = p, n - p - 1
    z = mp.mpf(df2) / (df2 + df1 * F)
    fp = mp.betainc(mp.mpf(df2) / 2, mp.mpf(df1) / 2, 0, z, regularized=True)
    # SEs: sigma^2 * (X'X)^-1 on the centered design, intercept SE via back-transform
    sig2 = sse / (n - p - 1)
    Ainv = mp.inverse(A)
    se1 = mp.sqrt(sig2 * Ainv[0, 0])
    se2 = mp.sqrt(sig2 * Ainv[1, 1])
    # Var(b0) = sig2*(1/n + mx' Ainv mx)
    mxv = mp.matrix([mx1, mx2])
    var0 = sig2 * (mp.mpf(1) / n + (mxv.T * Ainv * mxv)[0])
    se0 = mp.sqrt(var0)
    # VIF for the two predictors: 1/(1-r12^2)
    r12 = (sum((a - mx1) * (b - mx2) for a, b in zip(X1, X2)) /
           mp.sqrt(sum((a - mx1) ** 2 for a in X1) * sum((b - mx2) ** 2 for b in X2)))
    vif = 1 / (1 - r12 ** 2)
    return {
        "b0": float(b0), "b1": float(b1), "b2": float(b2),
        "se0": float(se0), "se1": float(se1), "se2": float(se2),
        "r2": float(r2), "ssr": float(ssr), "sse": float(sse),
        "F": float(F), "fp": float(fp), "vif": float(vif),
    }


expected = {
    "anovaBig": anova_exact(anova_big),
    "anovaSmall": anova_exact(anova_small),
    "linreg": linreg_exact(xs, ys),
    "linregWeighted1y": linreg_exact(xs, ys, weights=[1 / y for y in ys]),
    "linregOrigin": None,  # origin fit: slope-only; computed in the probe via R
    "multireg": multireg_exact(x1, x2, ym),
}

# origin exact (slope-only): slope = sum(x*y)/sum(x^2), se from sigma^2/sum(x^2)
Xo, Yo = mpf_list(xs), mpf_list(ys_o)
sxy = sum(a * b for a, b in zip(Xo, Yo))
sxx = sum(a * a for a in Xo)
slope_o = sxy / sxx
res_o = [yi - slope_o * xi for xi, yi in zip(Xo, Yo)]
sse_o = sum(e * e for e in res_o)
sig2_o = sse_o / (len(Xo) - 1)
se_o = mp.sqrt(sig2_o / sxx)
t_o = slope_o / se_o
df_o = len(Xo) - 1
z_o = mp.mpf(df_o) / (df_o + t_o ** 2)
p_o = mp.betainc(mp.mpf(df_o) / 2, mp.mpf(1) / 2, 0, z_o, regularized=True)
r2_o = 1 - sse_o / sum(yi * yi for yi in Yo)  # R^2 for through-origin uses uncentered SST
tcrit_o = stats.t.ppf(0.975, df_o)
expected["linregOrigin"] = {
    "slope": float(slope_o), "slopeSe": float(se_o),
    "slopeCiLo": float(slope_o - tcrit_o * se_o),
    "slopeCiHi": float(slope_o + tcrit_o * se_o),
    "r2": float(r2_o), "p": float(p_o),
}

# intercept fit on the origin data (for the multi-Y pin's Y2 column)
expected["linregOriginAsIntercept"] = linreg_exact(xs, ys_o)


def deming_exact(x, y, lam):
    """Deming slope/intercept + leave-one-out jackknife SEs/CIs (mpmath).

    Mirrors the R code exactly: b = (d + sqrt(d^2 + 4*lam*sxy^2)) / (2*sxy)
    with d = syy - lam*sxx on the centered sums, a = ybar - b*xbar, and the
    jackknife SE sqrt((k-1)/k * sum((th_i - mean(th))^2)) over the k usable
    replicates, CIs b +/- 1.96*SE. The OLS slope/intercept for the same data
    are the linreg_exact values above.
    """
    X, Y = mpf_list(x), mpf_list(y)
    n = len(X)
    lam = mp.mpf(lam)

    def fit(xx, yy):
        nn = len(xx)
        mxx = sum(xx) / nn
        myy = sum(yy) / nn
        sxx2 = sum((xi - mxx) ** 2 for xi in xx)
        syy2 = sum((yi - myy) ** 2 for yi in yy)
        sxy2 = sum((xi - mxx) * (yi - myy) for xi, yi in zip(xx, yy))
        d = syy2 - lam * sxx2
        b = (d + mp.sqrt(d**2 + 4 * lam * sxy2**2)) / (2 * sxy2)
        return b, myy - b * mxx

    b, a = fit(X, Y)
    bs, aas = [], []
    for i in range(n):
        bi, ai = fit([v for j, v in enumerate(X) if j != i],
                     [v for j, v in enumerate(Y) if j != i])
        bs.append(bi)
        aas.append(ai)
    k = n
    bbar = sum(bs) / k
    abar = sum(aas) / k
    seb = mp.sqrt(mp.mpf(k - 1) / k * sum((v - bbar) ** 2 for v in bs))
    sea = mp.sqrt(mp.mpf(k - 1) / k * sum((v - abar) ** 2 for v in aas))
    z = mp.mpf("1.96")
    return {
        "slope": float(b), "intercept": float(a),
        "slopeSe": float(seb), "interceptSe": float(sea),
        "slopeCiLo": float(b - z * seb), "slopeCiHi": float(b + z * seb),
        "interceptCiLo": float(a - z * sea),
        "interceptCiHi": float(a + z * sea),
        "n": n, "looDropped": 0,
    }


# Deming at 1e13 on the same xyBig doubles (Nov 2026 Deming precision lane)
expected["deming"] = deming_exact(xs, ys, 1)
expected["deming025"] = deming_exact(xs, ys, mp.mpf("0.25"))

# --- tables for reference.ts (string cells, "" = blank) ---
def col_table(names, groups):
    cols = ["Title"] + names
    rows = []
    for r in range(len(groups[0])):
        rows.append([""] + [repr(g[r]) for g in groups])
    return {"columns": cols, "rows": rows}


tables = {
    "anovaBig": col_table([f"G{i}" for i in range(9)], anova_big),
    "anovaSmall": col_table(["A", "B", "C"], anova_small),
    "xyBig": {"columns": ["Title", "X", "Y"],
              "rows": [["", repr(x), repr(y)] for x, y in zip(xs, ys)]},
    "xyBigOrigin": {"columns": ["Title", "X", "Y"],
                    "rows": [["", repr(x), repr(y)] for x, y in zip(xs, ys_o)]},
    "multiBig": {"columns": ["Title", "Y", "X1", "X2"],
                 "rows": [["", repr(y), repr(a), repr(b)]
                          for y, a, b in zip(ym, x1, x2)]},
}

(WT / "tests" / "testdata").mkdir(parents=True, exist_ok=True)
(WT / "tests" / "testdata" / "precision-1e13.json").write_text(json.dumps(tables, indent=1))
(WT / "probe").mkdir(parents=True, exist_ok=True)
(WT / "probe" / "expected-precision.json").write_text(json.dumps(expected, indent=1))
print(json.dumps(expected, indent=1))
