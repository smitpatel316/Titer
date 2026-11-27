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

# --- Two-way ANOVA big: 3 groups x 4 rows x 3 reps, values ~1e13 ---
# group offsets (i-1)*0.9, row offsets (j-1.5)*0.6, interaction
# (i-1)*(j-1.5)*0.15, within SD 0.35. Balanced, so Type III = Type I.
twoway = []  # twoway[g][r][rep]
for i in range(3):
    grp = []
    for j in range(4):
        grp.append([BASE + (i - 1) * 0.9 + (j - 1.5) * 0.6 + (i - 1) * (j - 1.5) * 0.15
                    + g(0, 0.35) for _ in range(3)])
    twoway.append(grp)

# --- Three-way ANOVA big: 2 groups x 2 rows/band x 2 bands x 3 reps ---
# A (i-0.5)*1.8, B (j-0.5)*1.2, C (k-0.5)*1.0, two-way terms 0.4/0.3/0.5,
# three-way 0.2, within SD 0.3. Balanced, so Type III = Type I.
threeway = []  # threeway[a][b][c][rep]
for i in range(2):
    aa = []
    for j in range(2):
        bb = []
        for k in range(2):
            bb.append([BASE + (i - 0.5) * 1.8 + (j - 0.5) * 1.2 + (k - 0.5) * 1.0
                       + (i - 0.5) * (j - 0.5) * 0.4 + (i - 0.5) * (k - 0.5) * 0.3
                       + (j - 0.5) * (k - 0.5) * 0.5 + (i - 0.5) * (j - 0.5) * (k - 0.5) * 0.2
                       + g(0, 0.3) for _ in range(3)])
        aa.append(bb)
    threeway.append(aa)


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


def f_p(F, df1, df2):
    z = mp.mpf(df2) / (df2 + df1 * F)
    return mp.betainc(mp.mpf(df2) / 2, mp.mpf(df1) / 2, 0, z, regularized=True)


def twoway_exact(tw):
    # tw[g][r][rep]; balanced 3x4x3, so the runner's Type III SS equal these
    # cell-means (Type I) values.
    G, R, n = 3, 4, 3
    cells = [[mpf_list(tw[g][r]) for r in range(R)] for g in range(G)]
    flat = [x for g in range(G) for r in range(R) for x in cells[g][r]]
    N = len(flat)
    gm = sum(flat) / N
    cm = [[sum(cells[g][r]) / n for r in range(R)] for g in range(G)]
    mA = [sum(cm[g]) / R for g in range(G)]
    mB = [sum(cm[g][r] for g in range(G)) / G for r in range(R)]
    ssA = R * n * sum((m - gm) ** 2 for m in mA)
    ssB = G * n * sum((m - gm) ** 2 for m in mB)
    ssAB = n * sum((cm[g][r] - mA[g] - mB[r] + gm) ** 2 for g in range(G) for r in range(R))
    ssE = sum((x - cm[g][r]) ** 2 for g in range(G) for r in range(R) for x in cells[g][r])
    dfA, dfB, dfAB, dfE = G - 1, R - 1, (G - 1) * (R - 1), N - G * R
    msE = ssE / dfE
    FA, FB, FAB = (ssA / dfA) / msE, (ssB / dfB) / msE, (ssAB / dfAB) / msE
    return {
        "FA": float(FA), "pA": float(f_p(FA, dfA, dfE)),
        "FB": float(FB), "pB": float(f_p(FB, dfB, dfE)),
        "FAB": float(FAB), "pAB": float(f_p(FAB, dfAB, dfE)),
        "ssA": float(ssA), "ssB": float(ssB), "ssAB": float(ssAB), "ssE": float(ssE),
        "dfE": dfE,
    }


def twoway_rm_exact(tw):
    # Split-plot exact values, same definitions as the runner's sp(): Y rows
    # are subjects, group-major (flattenRepeated order), columns are rows.
    G, R, n = 3, 4, 3
    Y = [[mp.mpf(tw[g][r][rep]) for r in range(R)] for g in range(G) for rep in range(n)]
    N = len(Y)
    s = [sum(row) / R for row in Y]
    m = sum(sum(row) for row in Y) / (N * R)
    mg = [sum(s[g * n:(g + 1) * n]) / n for g in range(G)]
    mr = [sum(Y[i][r] for i in range(N)) / N for r in range(R)]
    mgr = [[sum(Y[g * n + rep][r] for rep in range(n)) / n for r in range(R)] for g in range(G)]
    ssG = R * sum(n * (mg[g] - m) ** 2 for g in range(G))
    ssE1 = R * sum((s[i] - mg[i // n]) ** 2 for i in range(N))
    ssR = N * sum((mr[r] - m) ** 2 for r in range(R))
    ssI = sum(n * (mgr[g][r] - mg[g] - mr[r] + m) ** 2 for g in range(G) for r in range(R))
    ssE2 = sum((Y[i][r] - s[i] - mgr[i // n][r] + mg[i // n]) ** 2
               for i in range(N) for r in range(R))
    dfG, dfE1 = G - 1, N - G
    dfR, dfI, dfE2 = R - 1, (G - 1) * (R - 1), (N - G) * (R - 1)
    FG = (ssG / dfG) / (ssE1 / dfE1)
    FR = (ssR / dfR) / (ssE2 / dfE2)
    FI = (ssI / dfI) / (ssE2 / dfE2)
    return {
        "FG": float(FG), "pG": float(f_p(FG, dfG, dfE1)),
        "FR": float(FR), "pR": float(f_p(FR, dfR, dfE2)),
        "FI": float(FI), "pI": float(f_p(FI, dfI, dfE2)),
        "ssG": float(ssG), "ssE1": float(ssE1), "ssR": float(ssR),
        "ssI": float(ssI), "ssE2": float(ssE2),
    }


def threeway_exact(tw3):
    # tw3[a][b][c][rep]; balanced 2x2x2x3, so Type III = Type I cell-means values.
    A, B, C, n = 2, 2, 2, 3
    cells = [[[[mp.mpf(tw3[a][b][c][rep]) for rep in range(n)]
               for c in range(C)] for b in range(B)] for a in range(A)]
    flat = [x for a in range(A) for b in range(B) for c in range(C) for x in cells[a][b][c]]
    N = len(flat)
    gm = sum(flat) / N
    cm = [[[sum(cells[a][b][c]) / n for c in range(C)] for b in range(B)] for a in range(A)]
    mA = [sum(cm[a][b][c] for b in range(B) for c in range(C)) / (B * C) for a in range(A)]
    mB = [sum(cm[a][b][c] for a in range(A) for c in range(C)) / (A * C) for b in range(B)]
    mC = [sum(cm[a][b][c] for a in range(A) for b in range(B)) / (A * B) for c in range(C)]
    mAB = [[sum(cm[a][b][c] for c in range(C)) / C for b in range(B)] for a in range(A)]
    mAC = [[sum(cm[a][b][c] for b in range(B)) / B for c in range(C)] for a in range(A)]
    mBC = [[sum(cm[a][b][c] for a in range(A)) / A for c in range(C)] for b in range(B)]
    ssA = B * C * n * sum((m - gm) ** 2 for m in mA)
    ssB = A * C * n * sum((m - gm) ** 2 for m in mB)
    ssC = A * B * n * sum((m - gm) ** 2 for m in mC)
    ssAB = C * n * sum((mAB[a][b] - mA[a] - mB[b] + gm) ** 2 for a in range(A) for b in range(B))
    ssAC = B * n * sum((mAC[a][c] - mA[a] - mC[c] + gm) ** 2 for a in range(A) for c in range(C))
    ssBC = A * n * sum((mBC[b][c] - mB[b] - mC[c] + gm) ** 2 for b in range(B) for c in range(C))
    ssABC = n * sum((cm[a][b][c] - mAB[a][b] - mAC[a][c] - mBC[b][c]
                     + mA[a] + mB[b] + mC[c] - gm) ** 2
                    for a in range(A) for b in range(B) for c in range(C))
    ssE = sum((x - cm[a][b][c]) ** 2 for a in range(A) for b in range(B)
              for c in range(C) for x in cells[a][b][c])
    dfE = N - A * B * C
    msE = ssE / dfE
    out = {"ssE": float(ssE), "dfE": dfE}
    for k, ss in [("A", ssA), ("B", ssB), ("C", ssC), ("AB", ssAB),
                  ("AC", ssAC), ("BC", ssBC), ("ABC", ssABC)]:
        F = (ss / 1) / msE
        out[f"F{k}"] = float(F)
        out[f"p{k}"] = float(f_p(F, 1, dfE))
        out[f"ss{k}"] = float(ss)
    return out


expected = {
    "anovaBig": anova_exact(anova_big),
    "anovaSmall": anova_exact(anova_small),
    "linreg": linreg_exact(xs, ys),
    "linregWeighted1y": linreg_exact(xs, ys, weights=[1 / y for y in ys]),
    "linregOrigin": None,  # origin fit: slope-only; computed in the probe via R
    "multireg": multireg_exact(x1, x2, ym),
    "twoWayBig": twoway_exact(twoway),
    "twoWayBigRM": twoway_rm_exact(twoway),
    "threeWayBig": threeway_exact(threeway),
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
    # Grouped tables: columns are "Group:rep", rows are row positions.
    # twoWayBig: 3 groups x 4 rows x 3 reps (36 values).
    "twoWayBig": {"columns": ["Title"] + [f"{g}:Y{r}" for g in "ABC" for r in (1, 2, 3)],
                  "rows": [[f"Day {j + 1}"] +
                           [repr(twoway[i][j][rep]) for i in range(3) for rep in range(3)]
                           for j in range(4)]},
    # threeWayBig: 2 groups x 2 rows/band x 2 bands x 3 reps (24 values);
    # rows 1-2 are band WT, rows 3-4 band KO.
    "threeWayBig": {"columns": ["Title"] + [f"{g}:Y{r}" for g in "AB" for r in (1, 2, 3)],
                    "rows": [[f"Day {j % 2 + 1}"] +
                             [repr(threeway[i][j % 2][j // 2][rep])
                              for i in range(2) for rep in range(3)]
                             for j in range(4)],
                    "rowGroups": [{"name": "WT", "count": 2}, {"name": "KO", "count": 2}]},
}

(WT / "tests" / "testdata").mkdir(parents=True, exist_ok=True)
(WT / "tests" / "testdata" / "precision-1e13.json").write_text(json.dumps(tables, indent=1))
(WT / "probe").mkdir(parents=True, exist_ok=True)
(WT / "probe" / "expected-precision.json").write_text(json.dumps(expected, indent=1))
print(json.dumps(expected, indent=1))
