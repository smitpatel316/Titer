import math
import numpy as np
from scipy.special import betainc

# scipy reference for the beta probe grid (x = a/(a+b) worst case)
cases = []
for b in [1e4, 1e5, 1e6, 1e7, 5e7]:
    cases.append((1e6, b))
for b in [5e4, 5e5, 5e6, 5e7]:
    cases.append((5e9, b))
cases.append((1.25e5, 5e7))
cases.append((1.25e5, 5e4))
for (a, b) in cases:
    x = a / (a + b)
    print(f"beta a={a:g} b={b:g} I={float(betainc(a, b, x)):.12g}", flush=True)
print("DONEB", flush=True)
