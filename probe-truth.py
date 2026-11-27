"""Ground truth for noncentral t CDF via Gauss-Hermite quadrature:
F(t) = E_Z[ g(Z) ], g(z) = 1 if z <= -delta else Q(nu/2, nu*(z+delta)^2/(2 t^2)).
Also prints the chi-square-limit asymptotic Q(nu/2, nu*delta^2/(2 t^2)) and
scipy's nct.cdf where it converges (warnings flagged)."""
import math
import warnings
import numpy as np
from scipy.special import gammaincc
from scipy.stats import nct

x, w = np.polynomial.hermite.hermgauss(200)

def ground_truth(t, nu, delta):
    # E_Z[g(Z)] with Z ~ N(0,1); hermgauss is for exp(-x^2): E[g(Z)] = sum w_i g(sqrt2 x_i)/sqrt(pi)
    tot = 0.0
    for xi, wi in zip(x, w):
        z = math.sqrt(2) * xi
        s = z + delta
        g = 1.0 if s <= 0 else float(gammaincc(nu / 2, nu * s * s / (2 * t * t)))
        tot += wi * g
    return tot / math.sqrt(math.pi)

def chisq_limit(t, nu, delta):
    if delta < 0:
        return 1.0
    return float(gammaincc(nu / 2, nu * delta * delta / (2 * t * t)))

grid = []
for nu in [1, 100]:
    for d in [500, 1414, 1e4, 1e5, 1e6]:
        grid.append((d, nu, d))
for nu in [1e5, 1e8]:
    for d in [1414, 1e5]:
        grid.append((d, nu, d))
grid.append((1e155, 10, 5))
grid.append((5e4, 100, 1e5))   # r = 2
grid.append((2e5, 100, 1e5))   # r = 0.5

print("t, nu, delta, ground_truth, chisq_limit, scipy_nct")
for (t, nu, d) in grid:
    gt = ground_truth(t, nu, d)
    lim = chisq_limit(t, nu, d)
    with warnings.catch_warnings(record=True) as ws:
        warnings.simplefilter("always")
        try:
            sp = float(nct.cdf(t, nu, d))
            flag = "WARN" if ws else ""
        except Exception as e:
            sp, flag = float("nan"), f"ERR {e}"
    print(f"{t:g} {nu:g} {d:g} {gt:.12g} {lim:.12g} {sp:.12g} {flag}")
