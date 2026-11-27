import math
from scipy.special import gammaincc
from scipy.stats import norm

def wh(nu, r):
    mu = 1 - 2/(9*nu)
    sd = math.sqrt(2/(9*nu))
    z = (abs(r)**(2/3) - mu)/sd
    return 1 - norm.cdf(z)

print("nu, r, exact Q, WH Q, err")
for nu in [1, 2, 10, 100, 1e3, 1e4, 1e5, 1e6]:
    for r in [0.5, 1.0, 2.0]:
        exact = gammaincc(nu/2, nu*r*r/2)
        w = wh(nu, r)
        print(f"{nu:g} {r} {exact:.12g} {w:.12g} {w-exact:+.3g}")
