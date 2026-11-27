#!/usr/bin/env python3
"""Generate 1e13-scale precision fixtures + mpmath (50-digit) exact values.

Datasets (all values are Python floats == IEEE doubles; JSON round-trips them
exactly, so the TS side sees the identical doubles):
- anovaBig: 9 groups x 201, SmLs09 shape, values ~1e13, 13 constant leading digits
- anovaSmall: 3 groups x 5, same scale
- linreg: 10 pts, x ~ 1e13, y = 2*x + 1000 + noise
- linregOrigin: 10 pts, x ~ 1e13, y = 2*x + noise (through origin)
- multireg: 12 rows, x1/x2 ~ 1e13, y = 1000 + 2*x1c - 1.5*x2c + noise
- slopes: same X as linreg; A = linreg Y (slope 2, +1000), B = linregOrigin
  Y (slope 2, +0) — parallel, distinct intercepts; C = 3*x + 1000 + noise
  (slope 3) — slopes differ. The A-vs-B and A-vs-C pairs pin compare-slopes.

Writes:
- <worktree>/tests/testdata/precision-1e13.json  (tables for reference.ts)
- <worktree>/probe/expected-precision.json       (mpmath exact values)
"""
import json
import random
import sys
from pathlib import Path

import mpmath as mp

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

# --- Compare slopes: C = 3*x + 1000 + noise on the same X (slope 3).
# Drawn AFTER every earlier dataset, so the existing tables are unchanged.
ys_c = [3 * x + 1000 + g(0, 0.1) for x in xs]
# --- Nested ANOVA: 3 groups x 3 subgroups x 3 replicates, ~1e13 ---
# Group offsets 0 / 1.8 / 3.6, subgroup jitter N(0, 0.3), replicate noise
# N(0, 0.15). The subcolumn means (what R sees) spread ~0.3 within a group
# and ~1.8 between groups — the uncentered aov loses ~1% of F here.
nested_raw = []
for gi in range(3):
    off = gi * 1.8
    for si in range(3):
        jit = g(0, 0.3)
        nested_raw.append([BASE + off + jit + g(0, 0.15) for _ in range(3)])
# TS subgroup means: JS `mean` is a naive left-to-right double sum / n, and
# Python's float sum matches it op-for-op, so these are the exact doubles R
# receives (the pooled means, one per subgroup, in column order).
nested_means = [[sum(sub) / 3 for sub in nested_raw[gi * 3:(gi + 1) * 3]] for gi in range(3)]
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


def f_p(F, df1, df2):
    z = mp.mpf(df2) / (df2 + df1 * F)
    return mp.betainc(mp.mpf(df2) / 2, mp.mpf(df1) / 2, 0, z, regularized=True)


def t_p(t, df):
    z = mp.mpf(df) / (df + t ** 2)
    return mp.betainc(mp.mpf(df) / 2, mp.mpf(1) / 2, 0, z, regularized=True)


def welch_exact(groups):
    """Welch's ANOVA (oneway.test, var.equal=FALSE): F, dfn, dfd, p."""
    gs = [mpf_list(v) for v in groups]
    k = len(gs)
    n = [len(v) for v in gs]
    means = [sum(v) / len(v) for v in gs]
    s2 = [sum((x - m) ** 2 for x in v) / (len(v) - 1) for v, m in zip(gs, means)]
    w = [ni / si for ni, si in zip(n, s2)]
    W = sum(w)
    mstar = sum(wi * mi for wi, mi in zip(w, means)) / W
    num = sum(wi * (mi - mstar) ** 2 for wi, mi in zip(w, means)) / (k - 1)
    lam = sum((1 / (ni - 1)) * (1 - wi / W) ** 2 for ni, wi in zip(n, w))
    den = 1 + 2 * (k - 2) / (k * k - 1) * lam
    F = num / den
    df1 = k - 1
    df2 = (k * k - 1) / (3 * lam)
    return {"F": float(F), "dfn": df1, "dfd": float(df2), "p": float(f_p(F, df1, df2))}


def bf_exact(groups):
    """Brown-Forsythe's F* (Brown and Forsythe, 1974): F*, dfn, dfd, p."""
    gs = [mpf_list(v) for v in groups]
    k = len(gs)
    n = [len(v) for v in gs]
    N = sum(n)
    means = [sum(v) / len(v) for v in gs]
    s2 = [sum((x - m) ** 2 for x in v) / (len(v) - 1) for v, m in zip(gs, means)]
    gm = sum(sum(v) for v in gs) / N
    ssb = sum(ni * (m - gm) ** 2 for ni, m in zip(n, means))
    bfw = [(1 - ni / N) * si for ni, si in zip(n, s2)]
    F = ssb / sum(bfw)
    c = [b / sum(bfw) for b in bfw]
    df2 = 1 / sum(ci ** 2 / (ni - 1) for ci, ni in zip(c, n))
    return {"bfF": float(F), "bfDfn": k - 1, "bfDfd": float(df2),
            "bfP": float(f_p(F, k - 1, df2))}


def smm_p(t, mc, df):
    """Dunnett's T3 P: P(max of mc |t| > t), the studentized maximum modulus,
    1 - int (2*Phi(t*s)-1)^mc * ds(s,df) ds over the chi df's 1e-12 lims —
    the same truncation R's smm() uses, so values below ~2e-12 sit on that
    floor in both (the integral is ~1 there; R's integrate() carries ~0.5%
    noise on the floor, so anovaBig's T3 P values are not pinned tightly)."""
    r1 = mp.sqrt(mp.mpf(float(stats.chi2.ppf(1e-12, float(df)))) / df)
    r2 = mp.sqrt(mp.mpf(float(stats.chi2.ppf(1 - 1e-12, float(df)))) / df)
    ds = lambda s: (
        (df * s ** 2) ** (df / 2 - 1) * mp.e ** (-(df * s ** 2) / 2) * 2 * df * s
        / (2 ** (df / 2) * mp.gamma(df / 2))
    )
    f = lambda s: (2 * mp.ncdf(t * s) - 1) ** mc * ds(s)
    return 1 - mp.quad(f, [r1, r2])


def welch_pairs_exact(groups):
    """Per-pair Welch t/df/two-sided p, Games-Howell p + CI (scipy
    studentized_range), Dunnett's T3 p (smm above), and the BH-adjusted
    FDR p over the pair family — keys "i_j" in pair order."""
    gs = [mpf_list(v) for v in groups]
    k = len(gs)
    n = [len(v) for v in gs]
    means = [sum(v) / len(v) for v in gs]
    s2 = [sum((x - m) ** 2 for x in v) / (len(v) - 1) for v, m in zip(gs, means)]
    pairs = {}
    raw_p = []
    for i in range(k):
        for j in range(i + 1, k):
            e = s2[i] / n[i] + s2[j] / n[j]
            t = (means[i] - means[j]) / mp.sqrt(e)
            df = e ** 2 / ((s2[i] / n[i]) ** 2 / (n[i] - 1) + (s2[j] / n[j]) ** 2 / (n[j] - 1))
            p = t_p(t, df)
            q = abs(t) * mp.sqrt(2)
            gh_p = mp.mpf(float(stats.studentized_range.sf(float(q), k, float(df))))
            qcrit = mp.mpf(float(stats.studentized_range.ppf(0.95, k, float(df))))
            se = mp.sqrt(e)
            diff = means[i] - means[j]
            pairs[f"{i}_{j}"] = {
                "diff": float(diff), "t": float(t), "df": float(df), "p": float(p),
                "gh_p": float(gh_p),
                "gh_lo": float(diff - qcrit / mp.sqrt(2) * se),
                "gh_hi": float(diff + qcrit / mp.sqrt(2) * se),
                "t3_p": float(smm_p(abs(t), k * (k - 1) // 2, df)),
            }
            raw_p.append((f"{i}_{j}", p))
    order = sorted(raw_p, key=lambda kv: kv[1])
    m = len(order)
    least = mp.mpf(1)
    for idx in range(m - 1, -1, -1):
        least = min(least, m / (idx + 1) * order[idx][1])
        pairs[order[idx][0]]["fdr_p"] = float(least)
    return pairs


def tukey_exact(groups):
    """Per-pair Tukey HSD p + CI (scipy studentized_range) on the POOLED
    mse / residual df — the ordinary ANOVA's post-hoc, so unlike the
    Games-Howell pairs above every pair shares one mse and one df.
    q = |diff| / sqrt(mse*(1/ni+1/nj)/2); P = sf(q, k, dfw); the CI is
    diff +/- qcrit * sqrt(mse*(1/ni+1/nj)/2) with qcrit = ppf(0.95, k, dfw)
    — the same half-width Titer's centered Tukey CI builds (its cv is
    qcrit/sqrt(2) times sqrt(mse*(1/ni+1/nj))). Keys "i_j" in pair order."""
    gs = [mpf_list(v) for v in groups]
    k = len(gs)
    n = [len(v) for v in gs]
    means = [sum(v) / len(v) for v in gs]
    ssw = sum(sum((x - m) ** 2 for x in v) for v, m in zip(gs, means))
    dfw = sum(n) - k
    mse = ssw / dfw
    pairs = {}
    for i in range(k):
        for j in range(i + 1, k):
            diff = means[i] - means[j]
            se = mp.sqrt(mse * (mp.mpf(1) / n[i] + mp.mpf(1) / n[j]) / 2)
            q = abs(diff) / se
            p = mp.mpf(float(stats.studentized_range.sf(float(q), k, float(dfw))))
            qcrit = mp.mpf(float(stats.studentized_range.ppf(0.95, k, float(dfw))))
            pairs[f"{i}_{j}"] = {
                "diff": float(diff),
                "tukey_p": float(p),
                "tukey_lo": float(diff - qcrit * se),
                "tukey_hi": float(diff + qcrit * se),
            }
    return pairs
def tcrit_exact(df):
    """Two-sided 95% t critical value, mpmath-exact.

    scipy's t.ppf is only accurate to ~2e-10 here (df=8: 2.3060041350333704
    vs the true 2.3060041352041667 — R's qt agrees with mpmath to all
    digits), and that error is visible on intercept CIs, whose SEs are
    ~1e11 at 1e13 scale (1.7e-10 * 8e10 ≈ 14). Inverted from the
    regularized incomplete beta: P(|T| > t) = 0.05.
    """
    f = lambda t: mp.betainc(mp.mpf(df) / 2, mp.mpf(1) / 2, 0,
                             mp.mpf(df) / (df + t ** 2), regularized=True) - mp.mpf("0.05")
    return mp.findroot(f, (mp.mpf(2), mp.mpf(2.5)))


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
    tcrit = tcrit_exact(df)
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


def slopes_exact(x, ysets):
    """Extra-sum-of-squares ANCOVA for compare-slopes (Prism's two F tests).

    Per-set values come from linreg_exact; the stacked fits are computed
    from within-group sums (translation-invariant, so the centered R fits
    estimate the same quantities): full = separate lines, shared = one
    slope + separate intercepts, one = a single line for all sets.
    """
    k = len(ysets)
    n = len(x)
    N = n * k
    per = [linreg_exact(x, y) for y in ysets]
    X = mpf_list(x)
    mx = sum(X) / n
    sxx_g, sxy_g, sse_g = [], [], []
    for y in ysets:
        Y = mpf_list(y)
        my = sum(Y) / n
        sxx = sum((xi - mx) ** 2 for xi in X)
        sxy = sum((xi - mx) * (yi - my) for xi, yi in zip(X, Y))
        slope = sxy / sxx
        b0 = my - slope * mx
        sse = sum((yi - (b0 + slope * xi)) ** 2 for xi, yi in zip(X, Y))
        sxx_g.append(sxx)
        sxy_g.append(sxy)
        sse_g.append(sse)
    ssF = sum(sse_g)
    dfF = N - 2 * k
    # shared slope: pooled within-group slope; each group's intercept is its
    # own mean minus the shared slope times the shared X mean
    bP = sum(sxy_g) / sum(sxx_g)
    ssS = mp.mpf(0)
    for y in ysets:
        Y = mpf_list(y)
        my = sum(Y) / n
        b_g = my - bP * mx
        ssS += sum((yi - (b_g + bP * xi)) ** 2 for xi, yi in zip(X, Y))
    dfS = N - k - 1
    # one line: pooled regression on all N points
    Xall = mpf_list(x * k)
    Yall = mpf_list([yi for y in ysets for yi in y])
    mxa = sum(Xall) / N
    mya = sum(Yall) / N
    sxxa = sum((xi - mxa) ** 2 for xi in Xall)
    sxya = sum((xi - mxa) * (yi - mya) for xi, yi in zip(Xall, Yall))
    slope_a = sxya / sxxa
    b_a = mya - slope_a * mxa
    ssI = sum((yi - (b_a + slope_a * xi)) ** 2 for xi, yi in zip(Xall, Yall))
    Fs = ((ssS - ssF) / (k - 1)) / (ssF / dfF)
    z = mp.mpf(dfF) / (dfF + (k - 1) * Fs)
    ps = mp.betainc(mp.mpf(dfF) / 2, mp.mpf(k - 1) / 2, 0, z, regularized=True)
    Fi = ((ssI - ssS) / (k - 1)) / (ssS / dfS)
    z2 = mp.mpf(dfS) / (dfS + (k - 1) * Fi)
    pi = mp.betainc(mp.mpf(dfS) / 2, mp.mpf(k - 1) / 2, 0, z2, regularized=True)
    # common slope SE + CI (shared-slope model, sigma^2 = ssS/dfS)
    sig2_s = ssS / dfS
    se_bP = mp.sqrt(sig2_s / sum(sxx_g))
    tcrit_s = tcrit_exact(dfS)
    out = {
        "perSet": per,
        "Fs": float(Fs), "ps": float(ps), "dfF": dfF,
        "Fi": float(Fi), "pi": float(pi), "dfS": dfS,
        "ssF": float(ssF), "ssS": float(ssS), "ssI": float(ssI),
        "commonSlope": float(bP), "commonSlopeSe": float(se_bP),
        "commonSlopeCiLo": float(bP - tcrit_s * se_bP),
        "commonSlopeCiHi": float(bP + tcrit_s * se_bP),
    }
    if k == 2:
        out["intersection"] = float(
            (per[1]["intercept"] - per[0]["intercept"]) / (per[0]["slope"] - per[1]["slope"]))
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
    "welchBig": {**welch_exact(anova_big), **bf_exact(anova_big),
                 "pairs": welch_pairs_exact(anova_big)},
    "welchSmall": {**welch_exact(anova_small), **bf_exact(anova_small),
                   "pairs": welch_pairs_exact(anova_small)},
    "tukeyBig": tukey_exact(anova_big),
    "tukeySmall": tukey_exact(anova_small),
    "linreg": linreg_exact(xs, ys),
    "linregWeighted1y": linreg_exact(xs, ys, weights=[1 / y for y in ys]),
    "linregOrigin": None,  # origin fit: slope-only; computed in the probe via R
    "multireg": multireg_exact(x1, x2, ym),
    "slopesParallel": slopes_exact(xs, [ys, ys_o]),
    "slopesDiffer": slopes_exact(xs, [ys, ys_c]),
    "slopesThree": slopes_exact(xs, [ys, ys_o, ys_c]),
    "twoWayBig": twoway_exact(twoway),
    "twoWayBigRM": twoway_rm_exact(twoway),
    "threeWayBig": threeway_exact(threeway),
}

# nested ANOVA exact: main table from the TS subgroup means, plus the
# Tukey HSD and Bonferroni post-hoc p-values (equal n = 3, dfw = 6).
# NOTE on the Tukey values: they are the true exact values (scipy's
# studentized_range.sf agrees with independent quad integration of the
# studentized-range density to ~1e-11). R's own ptukey cannot reproduce the
# 0_2 pair: at q ≈ 16.6, df 6 it returns 5.7064e-05 against the exact
# 5.7128e-05 — a 1.1e-3 far-tail floor in R, not in the fit (the fit's diffs
# and MSE are exact to ~1e-15). tests/reference.ts therefore checks that
# pair at 2e-3, the other two at 1e-6.
from scipy.stats import studentized_range
from scipy.stats import t as tdist

_nested = anova_exact(nested_means)
_nm = [mpf_list(v) for v in nested_means]
_nmeans = [sum(v) / len(v) for v in _nm]
_ngm = sum(sum(v) for v in _nm) / 9
_msw = mp.mpf(_nested["ssE"]) / 6
_tukey = {}
_bonf = {}
for _i in range(3):
    for _j in range(_i + 1, 3):
        _d = abs(_nmeans[_i] - _nmeans[_j])
        _q = _d / mp.sqrt(_msw / 3)
        _tukey[f"{_i}_{_j}"] = float(studentized_range.sf(float(_q), 3, 6))
        _t = _d / mp.sqrt(_msw * (mp.mpf(1) / 3 + mp.mpf(1) / 3))
        _bonf[f"{_i}_{_j}"] = float(min(1, 3 * 2 * tdist.sf(float(_t), 6)))
expected["nestedBig"] = {
    **_nested, "grand": float(_ngm), "tukey": _tukey, "bonferroni": _bonf,
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
tcrit_o = tcrit_exact(df_o)
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
    "xyBigSlopes": {"columns": ["Title", "X", "A", "B", "C"],
                    "rows": [["", repr(x), repr(a), repr(b), repr(c)]
                             for x, a, b, c in zip(xs, ys, ys_o, ys_c)]},
    "nestedBig": {"columns": ["Title"] + [f"{g}:S{s}:R{r}"
                                           for g in ("Control", "Treated", "High")
                                           for s in (1, 2, 3) for r in (1, 2, 3)],
                  "rows": [[""] + [repr(v) for sub in nested_raw for v in sub]],
                  "groups": 3, "subgroups": 3, "replicates": 3},
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
