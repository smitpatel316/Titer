import math
import numpy as np
from scipy.special import betainc, gammaincc

cases = [
    (1.5e5, 1.5e5), (2e5, 2e5), (3e5, 3e5), (4e5, 4e5), (5e5, 5e5),
    (2e5, 1e7), (1e7, 2e5), (1e6, 2e5), (2e5, 1e6),
]
for (a, b) in cases:
    x = a / (a + b)
    print(f"beta a={a:g} b={b:g} I={float(betainc(a, b, x)):.12g}", flush=True)

# Ground truth for df=1e8 small-delta series values (Gauss-Hermite).
xx, w = np.polynomial.hermite.hermgauss(120)
def ground_truth(t, nu, delta):
    tot = 0.0
    for xi, wi in zip(xx, w):
        z = math.sqrt(2) * xi
        s = z + delta
        g = 1.0 if s <= 0 else float(gammaincc(nu / 2, nu * s * s / (2 * t * t)))
        tot += wi * g
    return tot / math.sqrt(math.pi)

for (t, nu, d) in [(50, 1e8, 50), (500, 1e8, 500), (1000, 1e8, 1000)]:
    print(f"gt {t:g} {nu:g} {d:g} {ground_truth(t, nu, d):.12g}", flush=True)
print("DONEB2", flush=True)
