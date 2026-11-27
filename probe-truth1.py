import math
import numpy as np
from scipy.special import gammaincc

x, w = np.polynomial.hermite.hermgauss(120)

def ground_truth(t, nu, delta):
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

for (t, nu, d) in [(500,100,500),(1414,100,1414),(1e4,100,1e4),(1e5,100,1e5),(1e6,100,1e6),
                    (500,1,500),(1414,1,1414),(1e4,1,1e4)]:
    gt = ground_truth(t, nu, d)
    lim = chisq_limit(t, nu, d)
    print(f"{t:g} {nu:g} {d:g} gt={gt:.12g} lim={lim:.12g} diff={lim-gt:+.3g}", flush=True)
print("DONE1", flush=True)
