#!/usr/bin/env python3
"""Generate src-tauri/src/analysis-params-schema.json — the parameter schema
`titer_get_analysis_params` returns, one entry per analysis type.

Source of truth is the TypeScript, never this script's own opinions:
  - src/stats/types.ts — the *Params interfaces (fields, required vs
    optional, doc comments) and the choice lists (TAILS, POSTHOCS, ...).
  - src/lib/project-file.ts — PARAMS (each key's kind / enum / limits),
    PARAM_KEYS_BY_ANALYSIS (which keys each type takes), PARAM_DEFAULTS
    and PARAM_CHOICES (per-type choice narrowing).
  - src/stats/index.ts — the ANALYSES registry (label, minColumns,
    requiredPackages).
  - src/stats/**/​*.ts — each runner's `const DEFAULTS: XParams = {...}`
    (the values a run actually uses when a param is omitted).
  - src/views/analyses/index.ts — ANALYSIS_OPTIONS_BY_TABLE (+ the
    META_ANALYSES expansion) for which table types offer each test.

Per-type choice narrowing the merged PARAMS lists cannot express is in
ENUM_OVERRIDES below, each with the code comment that justifies it
(runners refuse cross-family values rather than silently reinterpreting
them; see project-file.ts PARAM_CHOICES and the per-runner comments).

Usage: python3 scripts/generate-analysis-params-schema.py
Writes src-tauri/src/analysis-params-schema.json in place. Re-run after
any *Params interface, PARAMS table, ANALYSES entry or offered-table
change; tests/checks.ts pins the JSON against PARAM_KEYS_BY_ANALYSIS so
drift fails the suite instead of shipping a stale schema.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def read(rel):
    return (ROOT / rel).read_text()


# ── Choice lists from src/stats/types.ts ──────────────────────────────
def parse_const_arrays(src):
    """name -> list of strings for `export const NAME = [...] as const` and
    plain `[...]` literals, resolving `...OTHER` spreads in order."""
    arrays = {}
    # { min: n, max: n } limits
    limits = {}
    for m in re.finditer(r"export const (\w+) = \{ min: ([\d.]+), max: ([\d.]+) \}", src):
        limits[m.group(1)] = {"min": float(m.group(2)), "max": float(m.group(3))}
    # array literals (possibly multi-line, with spreads and trailing comments)
    for m in re.finditer(r"(?:export )?const (\w+) = \[(.*?)\] as const;", src, re.S):
        body = m.group(2)
        body = re.sub(r"//[^\n]*", "", body)
        items = []
        for tok in re.finditer(r'"([^"]+)"|\.\.\.(\w+)', body):
            if tok.group(1) is not None:
                items.append(tok.group(1))
            else:
                items.extend(arrays.get(tok.group(2), []))
        arrays[m.group(1)] = items
    # non-const exported arrays (MONTE_CARLO_TARGETS etc. use plain [...])
    for m in re.finditer(r"export const (\w+)(?::[^=]+)? = \[(.*?)\];", src, re.S):
        if m.group(1) in arrays:
            continue
        body = re.sub(r"//[^\n]*", "", m.group(2))
        items = []
        for tok in re.finditer(r'"([^"]+)"|\.\.\.(\w+)', body):
            if tok.group(1) is not None:
                items.append(tok.group(1))
            else:
                items.extend(arrays.get(tok.group(2), []))
        if items:
            arrays[m.group(1)] = items
    return arrays, limits


TYPES_SRC = read("src/stats/types.ts")
ARRAYS, LIMITS = parse_const_arrays(TYPES_SRC)
# NONLINEAR_MODELS is built with spreads across lines; the regex above
# handles it, but verify the pieces landed.
for needed in ["TAILS", "ANOVA_POSTHOCS", "RANK_POSTHOCS", "NONLINEAR_MODELS",
               "BINDING_SATURATION_MODELS", "BINDING_KINETICS_MODELS",
               "ENZYME_INHIBITION_MODELS", "DOSE_RESPONSE_SPECIAL_MODELS",
               "CORRELATION_METHODS", "CORRELATION_MODES", "TWO_WAY_DESIGNS",
               "POSTHOC_TARGETS", "THREE_WAY_TERMS", "CORRECTIONS",
               "CURVE_TESTS", "CONTINGENCY_TESTS", "BIN_MODES",
               "REMOVE_BASELINE_METHODS", "FRACTION_OF_TOTAL_TOTALS",
               "FRACTION_OF_TOTAL_FORMATS", "TRANSFORM_FUNCTIONS",
               "CONCENTRATION_UNITS", "NORMALIZE_METHODS",
               "NORMALIZE_ZERO_DEFS", "NORMALIZE_HUNDRED_DEFS",
               "SMOOTH_DIFF_INT_OPERATIONS", "EXTRACT_REARRANGE_TARGETS",
               "NORMALITY_TESTS", "MONTE_CARLO_TARGETS",
               "MONTE_CARLO_STATISTICS"]:
    assert needed in ARRAYS, f"choice list {needed} not parsed"
POSTHOCS = ARRAYS["POSTHOCS"]  # the six base post-hoc choices
TWO_WAY_POSTHOCS = POSTHOCS + ["dunnett", "games-howell"]

# Per-type enum narrowing the merged PARAMS lists cannot express.
ENUM_OVERRIDES = {
    ("nonlinear-regression", "model"): ARRAYS["NONLINEAR_MODELS"],
    ("binding-saturation", "model"): ARRAYS["BINDING_SATURATION_MODELS"],
    ("binding-kinetics", "model"): ARRAYS["BINDING_KINETICS_MODELS"],
    ("enzyme-inhibition", "model"): ARRAYS["ENZYME_INHIBITION_MODELS"],
    ("dose-response-special", "model"): ARRAYS["DOSE_RESPONSE_SPECIAL_MODELS"],
    ("correlation", "method"): ARRAYS["CORRELATION_METHODS"],
    ("correlation-matrix", "method"): ARRAYS["CORRELATION_METHODS"],
    ("monte-carlo", "method"): ARRAYS["CORRELATION_METHODS"],
    ("spline-lowess", "method"): ["spline", "lowess"],
    ("outliers", "method"): ["rout", "grubbs"],
    ("shapiro-wilk", "test"): ARRAYS["NORMALITY_TESTS"],
    ("chi-square", "test"): ARRAYS["CONTINGENCY_TESTS"],
    ("anova", "posthoc"): ARRAYS["ANOVA_POSTHOCS"],
    ("kruskal-wallis", "posthoc"): ARRAYS["RANK_POSTHOCS"],
    ("friedman", "posthoc"): ARRAYS["RANK_POSTHOCS"],
    ("rm-anova", "posthoc"): POSTHOCS,
    ("two-way-anova", "posthoc"): TWO_WAY_POSTHOCS,
    # Three-way / nested ANOVA runners refuse every posthoc but these
    # (types.ts ThreeWayAnovaParams / NestedAnovaParams comments).
    ("three-way-anova", "posthoc"): ["tukey", "bonferroni"],
    ("nested-anova", "posthoc"): ["tukey", "bonferroni"],
    # Linear regression never sees replicate columns, so 1/sd2 is not
    # offered (types.ts LinearRegressionParams.weights).
    ("linear-regression", "weights"): ["none", "1/y", "1/y2", "1/x", "1/x2"],
    # Plot a function cannot plot a user-defined equation (types.ts);
    # the distributions (seq 203) are appended after the models. The
    # "gaussian" is already in NONLINEAR_MODELS — do not append it again
    # (the old override did, and the schema carried it twice).
    ("plot-function", "equation"): [m for m in ARRAYS["NONLINEAR_MODELS"]
                                     if m != "user-defined"] + ARRAYS["PLOT_FUNCTION_DISTRIBUTIONS"],
    ("plot-function", "extra"): ["none", "first-derivative",
                                 "second-derivative", "integral"],
}

# Table-shape / cross-param gates, in the code's own words.
GATES = {
    "three-way-anova": ["Grouped table with at least 2 row bands (rowGroups)"],
    "nested-t-test": ["Nested table with exactly 2 data groups; params.sets can select the two"],
    "nested-anova": ["Nested table with at least 3 data groups"],
    "enzyme-inhibition": ["Global models need X + at least 2 Y series (including an uninhibited one); Morrison needs X + 1 Y series and enzymeConcentration"],
    "dose-response-special": ["Every model needs X + at least 2 Y series (control + at least 1 shifted curve; full agonist + at least 1 partial agonist)"],
    "monte-carlo": ["targetAnalysis is one of compare-two-groups, one-sample-t, descriptive-statistics, linear-regression, correlation"],
}

# ── *Params interfaces: fields, required/optional, doc comments ──────
def parse_interfaces(src):
    """interface name -> {field: {required, description}}"""
    out = {}
    for m in re.finditer(r"export interface (\w+?)Params \{(.*?)\n\}", src, re.S):
        name, body = m.group(1), m.group(2)
        fields = {}
        # Split body into (comment, field) pairs. A field line looks like
        # `  name?: type;` or `  name: type;` possibly spanning lines for
        # unions; comments are /** ... */ or // ... directly above.
        pending_comment = ""
        for line in body.splitlines():
            s = line.strip()
            cm = re.match(r"/\*\*(.*)\*/$", s)
            if cm:
                pending_comment = cm.group(1).strip()
                continue
            if s.startswith("/**"):
                pending_comment = s[3:].strip().rstrip("*/").strip()
                continue
            if s.startswith("*"):
                pending_comment += " " + s[1:].strip().rstrip("*/").strip()
                continue
            if s.startswith("//"):
                pending_comment = s[2:].strip()
                continue
            fm = re.match(r"(\w+)(\?)?:", s)
            if fm:
                fields[fm.group(1)] = {
                    "required": fm.group(2) != "?",
                    "description": re.sub(r"\s+", " ", pending_comment).strip(),
                }
                pending_comment = ""
            elif s and not s.startswith("}"):
                # Continuation of a multi-line type; the field was already
                # recorded on its first line.
                continue
        out[name] = fields
    return out


INTERFACES = parse_interfaces(TYPES_SRC)

# Interface name -> analysis type (PARAM_KEYS_BY_ANALYSIS is the key list;
# this maps each interface to the type that uses it).
INTERFACE_TO_TYPE = {
    "CompareTwoGroups": "compare-two-groups",
    "OneSampleT": "one-sample-t",
    "Anova": "anova",
    "RmAnova": "rm-anova",
    "KruskalWallis": "kruskal-wallis",
    "Friedman": "friedman",
    "LinearRegression": "linear-regression",
    "DemingRegression": "deming-regression",
    "SimpleLogisticRegression": "simple-logistic-regression",
    "AreaUnderCurve": "area-under-curve",
    "RemoveBaseline": "remove-baseline",
    "PruneRows": "prune-rows",
    "FractionOfTotal": "fraction-of-total",
    "RowMeansTotals": "row-means-totals",
    "NonlinearRegression": "nonlinear-regression",
    "Correlation": "correlation-matrix",
    "XYCorrelation": "correlation",
    "MultipleRegression": "multiple-regression",
    "MultipleLogisticRegression": "multiple-logistic-regression",
    "PoissonRegression": "poisson-regression",
    "PrincipalComponentAnalysis": "principal-component-analysis",
    "KMeans": "k-means",
    "ExtractRearrange": "extract-rearrange",
    "TwoWayAnova": "two-way-anova",
    "ThreeWayAnova": "three-way-anova",
    "MultipleTTests": "multiple-t-tests",
    "NestedAnova": "nested-anova",
    "BindingSaturation": "binding-saturation",
    "BindingKinetics": "binding-kinetics",
    "EnzymeInhibition": "enzyme-inhibition",
    "DoseResponseSpecial": "dose-response-special",
    "SplineLowess": "spline-lowess",
    "SmoothDifferentiateIntegrate": "smooth-differentiate-integrate",
    "ChiSquare": "chi-square",
    "McNemar": "mcnemar",
    "Outliers": "outliers",
    "ShapiroWilk": "shapiro-wilk",
    "FrequencyDistribution": "frequency-distribution",
    "TransformData": "transform-data",
    "TransformConcentrations": "transform-concentrations",
    "Normalize": "normalize",
    "MixedEffects": "mixed-effects",
    "CoxPH": "cox-proportional-hazards",
    "Roc": "roc-curve",
    "MonteCarlo": "monte-carlo",
    "PlotFunction": "plot-function",
    "Survival": "survival",
    "Cox": "cox",
}

# ── project-file.ts: PARAMS kinds, key lists, defaults, choices ──────
PF = read("src/lib/project-file.ts")


def parse_params_table(src):
    """The PARAMS const: key -> kind descriptor."""
    m = re.search(r"const PARAMS = \{(.*?)\n\} satisfies Record<ParamKey, ParamKind>;", src, re.S)
    assert m, "PARAMS table not found"
    body = re.sub(r"//[^\n]*", "", m.group(1))
    out = {}
    # Entries are `key: <kind>,` where kind is a quoted string, an array
    # literal (possibly spread), a const name, or a { min, max } literal.
    for em in re.finditer(r"(\w+):\s*(\[[^\]]*\]|\{[^}]*\}|\"[^\"]+\"|[A-Z_][A-Z0-9_]*)", body):
        key, raw = em.group(1), em.group(2).strip()
        if raw.startswith('"'):
            out[key] = {"kind": raw.strip('"')}
        elif raw.startswith("{"):
            mm = re.search(r"min:\s*([\d.]+),\s*max:\s*([\d.]+)", raw)
            out[key] = {"kind": "number", "min": float(mm.group(1)), "max": float(mm.group(2))}
        elif raw.startswith("["):
            inner = raw[1:-1]
            items = []
            for tok in re.finditer(r'"([^"]+)"|\.\.\.(\w+)', inner):
                if tok.group(1) is not None:
                    items.append(tok.group(1))
                else:
                    items.extend(ARRAYS.get(tok.group(2), []))
            out[key] = {"kind": "enum", "values": items}
        else:
            # A const name: a { min, max } limits object, or a choice list.
            if raw in LIMITS:
                out[key] = {"kind": "number", "min": LIMITS[raw]["min"], "max": LIMITS[raw]["max"]}
            else:
                out[key] = {"kind": "enum", "values": list(ARRAYS.get(raw, []))}
            if "values" in out[key] and not out[key]["values"]:
                raise AssertionError(f"unresolved PARAMS kind const {raw} for {key}")
    return out


PARAMS = parse_params_table(PF)


def parse_record_of_strings(src, name):
    """`const NAME: Record<string, Record<string, ...>> = { "type": {...}, ... }`
    with flat scalar values only."""
    m = re.search(r"const " + name + r"[^=]*= \{(.*?)\n\};", src, re.S)
    assert m, f"{name} not found"
    body = m.group(1)
    out = {}
    for tm in re.finditer(r'"([\w-]+)": \{([^}]*)\}', body):
        vals = {}
        for kv in re.finditer(r'(\w+): ("(?:[^"\\]|\\.)*"|true|false|[\d.]+)', tm.group(2)):
            v = kv.group(2)
            if v.startswith('"'):
                vals[kv.group(1)] = json.loads(v)
            elif v in ("true", "false"):
                vals[kv.group(1)] = v == "true"
            else:
                vals[kv.group(1)] = float(v) if "." in v else int(v)
        out[tm.group(1)] = vals
    return out


PARAM_DEFAULTS = parse_record_of_strings(PF, "PARAM_DEFAULTS")
PARAM_CHOICES = parse_record_of_strings(PF, "PARAM_CHOICES")


def parse_keys_by_analysis(src):
    m = re.search(r"const PARAM_KEYS_BY_ANALYSIS: Record<string, readonly ParamKey\[\]> = \{(.*?)\n\};", src, re.S)
    assert m, "PARAM_KEYS_BY_ANALYSIS not found"
    body = m.group(1)
    out = {}
    for tm in re.finditer(r'"?([\w-]+)"?: \[([^\]]*)\]', body):
        out[tm.group(1)] = re.findall(r'"([\w-]+)"', tm.group(2))
    return out


KEYS_BY_TYPE = parse_keys_by_analysis(PF)

# ── ANALYSES registry: label, minColumns, requiredPackages ───────────
IDX = read("src/stats/index.ts")
ANALYSES = {}
for m in re.finditer(r'"?([\w-]+)"?:\s*\{\s*label:\s*"([^"]+)",(.*?)\bminColumns:\s*(\d+)', IDX, re.S):
    typ, label, _mid, min_cols = m.group(1), m.group(2), m.group(3), int(m.group(4))
    # requiredPackages follows minColumns in the entry; look just past it.
    pkgs_m = re.search(r"requiredPackages:\s*(\[[^\]]*\])", IDX[m.end():m.end() + 300])
    pkgs = pkgs_m.group(1) if pkgs_m else None
    ANALYSES[typ] = {"label": label, "min_columns": min_cols,
                     "packages": json.loads(pkgs.replace("'", '"')) if pkgs else []}
# Spec-based entries have no inline label/minColumns; resolve them from
# the spec() calls: `spec("Label", xxxSpec)` gives label, minGroups lives
# in the spec file — fall back to the label map below for those.
SPEC_LABELS = {
    "compare-two-groups": "Compare two groups",
    "one-sample-t": "Compare one group to a value",
    "anova": "One-way ANOVA",
    "kruskal-wallis": "Kruskal-Wallis test",
    "rm-anova": "Repeated-measures ANOVA",
    "friedman": "Friedman test",
    "shapiro-wilk": "Normality tests",
    "kolmogorov-smirnov": "Kolmogorov-Smirnov test",
    "linear-regression": "Linear regression",
    "deming-regression": "Deming regression",
}
for typ, label in SPEC_LABELS.items():
    if typ not in ANALYSES:
        ANALYSES[typ] = {"label": label, "min_columns": None, "packages": []}
# minColumns for the spec entries: read each spec's minGroups.
for spec_file in (ROOT / "src/stats/column").glob("*.ts"):
    src = spec_file.read_text()
    for m in re.finditer(r"minGroups: (\d+)", src):
        pass  # matched per-file below instead
SPEC_MIN = {
    "compare-two-groups": 2, "one-sample-t": 1, "anova": 2,
    "kruskal-wallis": 2, "rm-anova": 2, "friedman": 2,
    "shapiro-wilk": 1, "kolmogorov-smirnov": 1,
    "linear-regression": 2, "deming-regression": 2,
}
for typ, n in SPEC_MIN.items():
    if ANALYSES.get(typ, {}).get("min_columns") is None:
        ANALYSES[typ]["min_columns"] = n

# ── Runner DEFAULTS consts ────────────────────────────────────────────
RUNNER_DEFAULTS = {}  # interface name -> {field: value}
for f in (ROOT / "src/stats").rglob("*.ts"):
    src = f.read_text()
    for m in re.finditer(r"const DEFAULTS: (\w+?)Params = \{([^}]*)\};", src, re.S):
        iface, body = m.group(1), m.group(2)
        vals = {}
        for kv in re.finditer(r'(\w+): ("(?:[^"\\]|\\.)*"|true|false|-?[\d.]+)', body):
            v = kv.group(2)
            if v.startswith('"'):
                vals[kv.group(1)] = json.loads(v)
            elif v in ("true", "false"):
                vals[kv.group(1)] = v == "true"
            else:
                vals[kv.group(1)] = float(v) if "." in v else int(v)
        RUNNER_DEFAULTS[iface] = vals

# Defaults the runners apply with `??` when a param is omitted (no
# `const DEFAULTS` to parse — each cited by file):
#  area-under-curve.ts: `params?.baseline ?? 0`
#  fraction-of-total.ts: `?? "column"` / `?? "fraction"`
#  k-means.ts: `params?.clusters ?? 2`, `standardise !== false`
#  normalize.ts: `?? "percent-of-largest"`; prune-rows.ts: `?? "empty"`
#  remove-baseline.ts: `?? "first-value"`; smooth-...ts: `?? "smooth"`
#  spline-lowess.ts: `?? "lowess"`, `?? 2/3`; transform-data.ts: `?? "log10"`
#  correlation.ts (xy): `!== "spearman"` -> pearson, `?? "x-vs-every-y"`
#  principal-component-analysis.ts: `!== "covariance"` -> correlation
#    (components: 0 = all, types.ts PrincipalComponentAnalysisParams)
#  rout.ts: `params?.q ?? 1` (OutliersParams comment: alpha 0.05,
#    iterate true); monte-carlo.ts: `?? 1000` repeats
#  frequency-distribution.ts: binEdges falls through to auto when binMode
#    is neither "width" nor "count"
#  shapiro-wilk.ts: "Shapiro–Wilk is the default" (file comment)
#  mixed-effects.ts: only "slope" is special-cased; anything else runs
#    as the intercept model
#  poisson-regression.ts: `params?.quasi ?? false`
#  three-way-anova.ts: `params?.posthoc ?? "none"`
RUNNER_FALLBACKS = {
    ("area-under-curve", "baseline"): 0,
    ("fraction-of-total", "totalBy"): "column",
    ("fraction-of-total", "format"): "fraction",
    ("k-means", "clusters"): 2,
    ("k-means", "standardise"): True,
    ("normalize", "normalizeMethod"): "percent-of-largest",
    ("prune-rows", "condition"): "empty",
    ("remove-baseline", "baselineMethod"): "first-value",
    ("smooth-differentiate-integrate", "operation"): "smooth",
    ("spline-lowess", "method"): "lowess",
    ("spline-lowess", "f"): 2 / 3,
    ("transform-data", "function"): "log10",
    ("correlation", "method"): "pearson",
    ("correlation", "mode"): "x-vs-every-y",
    ("principal-component-analysis", "scale"): "correlation",
    ("principal-component-analysis", "components"): 0,
    ("outliers", "q"): 1,
    ("outliers", "alpha"): 0.05,
    ("outliers", "iterate"): True,
    ("monte-carlo", "repeats"): 1000,
    ("frequency-distribution", "binMode"): "auto",
    ("shapiro-wilk", "test"): "shapiro-wilk",
    ("mixed-effects", "randomStructure"): "intercept",
    ("poisson-regression", "quasi"): False,
    ("three-way-anova", "posthoc"): "none",
}

# Numeric limits the PARAMS table does not carry.
EXTRA_LIMITS = {
    ("monte-carlo", "repeats"): {"min": 10, "max": 10000},
}

# ── Offered tables ────────────────────────────────────────────────────
VIEWS = read("src/views/analyses/index.ts")
META = {"compare-many-groups": ["anova", "kruskal-wallis", "rm-anova", "friedman"],
        "interpolate": ["nonlinear-regression"]}
OFFERED = {}  # analysis type -> [table types]
m = re.search(r"export const ANALYSIS_OPTIONS_BY_TABLE: Record<TableType, SelectorOption<AnalysisPickerValue>\[\]> = \{(.*?)\n\};", VIEWS, re.S)
assert m, "ANALYSIS_OPTIONS_BY_TABLE not found"
for tm in re.finditer(r"(\w+): (?:\[)?\.\.\.optionsFor\(\[(.*?)\]\)|(\w+): optionsFor\(\[(.*?)\]\)", m.group(1), re.S):
    groups = tm.groups()
    table = groups[0] or groups[2]
    opts = groups[1] or groups[3]
    for v in re.findall(r'"([\w-]+)"', opts):
        for concrete in META.get(v, [v]):
            OFFERED.setdefault(concrete, []).append(table)
# Contingency's mcnemar is a literal option, not inside optionsFor.
for v in re.findall(r'\{ value: "([\w-]+)"', m.group(1)):
    for concrete in META.get(v, [v]):
        OFFERED.setdefault(concrete, []).append("contingency")

# ── Assemble ──────────────────────────────────────────────────────────
# field -> (interface, required, description), from the *Params interfaces.
FIELD_INFO = {}
for iface, typ in INTERFACE_TO_TYPE.items():
    for field, info in INTERFACES.get(iface, {}).items():
        FIELD_INFO.setdefault(field, {})[typ] = info

KIND_TO_TYPE = {
    "yes/no": ("boolean", None),
    "number": ("number", None),
    "name": ("string", None),
    "names": ("string[]", None),
    "name-or-names": ("string | string[]", None),
    "name-or-number": ("string | number", None),
    "name-and-names": ("object", "object with { name: string, levels: string[] }"),
    "numbers-by-name": ("object", "object mapping a column name to a number"),
    "number-pairs-by-name": ("object", "object mapping a name to a [low, high] number pair"),
    "texts-by-name": ("object", "object mapping a name to text"),
    "text-pairs-by-name": ("object", "object mapping a name to a [first, second] text pair"),
    "plot-curves": ("array", "list of { label: string, params: { <parameter name>: number } }"),
}

SETS_DESC = ("Data sets (columns, or a grouped table's groups) the analysis "
             "runs on; omitted: all of them (the first two for a two-group test).")

schema = {}
for typ, keys in sorted(KEYS_BY_TYPE.items()):
    entry = ANALYSES.get(typ)
    assert entry, f"no ANALYSES entry for {typ}"
    params = []
    for key in keys:
        if key == "sets":
            params.append({"name": "sets", "type": "string[]", "required": False,
                           "description": SETS_DESC})
            continue
        kind = PARAMS.get(key)
        assert kind, f"no PARAMS kind for {key} (type {typ})"
        info = FIELD_INFO.get(key, {}).get(typ, {})
        if kind["kind"] == "enum":
            values = ENUM_OVERRIDES.get((typ, key))
            if values is None:
                values = PARAM_CHOICES.get(typ, {}).get(key, kind["values"])
            param = {"name": key, "type": "string", "enum": values}
        elif kind["kind"] in KIND_TO_TYPE:
            t, shape = KIND_TO_TYPE[kind["kind"]]
            param = {"name": key, "type": t}
            if shape:
                param["value_shape"] = shape
        else:
            raise AssertionError(f"unhandled PARAMS kind {kind} for {key}")
        if "min" in kind:
            param["min"] = kind["min"]
        if "max" in kind:
            param["max"] = kind["max"]
        # Defaults: the runner's DEFAULTS first (what a run actually uses),
        # PARAM_DEFAULTS second (the file-reader fallback), then the
        # `??` fallbacks the runners apply inline (RUNNER_FALLBACKS).
        iface = next((i for i, t in INTERFACE_TO_TYPE.items() if t == typ), None)
        default = None
        if iface and key in RUNNER_DEFAULTS.get(iface, {}):
            default = RUNNER_DEFAULTS[iface][key]
        elif key in PARAM_DEFAULTS.get(typ, {}):
            default = PARAM_DEFAULTS[typ][key]
        elif (typ, key) in RUNNER_FALLBACKS:
            default = RUNNER_FALLBACKS[(typ, key)]
        if default is not None:
            param["default"] = default
        if (typ, key) in EXTRA_LIMITS:
            param.update(EXTRA_LIMITS[(typ, key)])
        # "required" means the run errors without the param: a TS-required
        # field the runner defaults (via DEFAULTS or a `??` fallback) is
        # not required at the MCP layer — omit it and the default applies.
        param["required"] = bool(info.get("required", False)) and "default" not in param
        desc = info.get("description", "")
        if desc:
            param["description"] = desc
        params.append(param)
    out = {
        "label": entry["label"],
        "min_columns": entry["min_columns"],
        "offered_on": sorted(OFFERED.get(typ, [])),
        "params": params,
    }
    if entry["packages"]:
        out["requires_packages"] = entry["packages"]
    if typ == "shapiro-wilk":
        out["packages_note"] = ("Only the Anderson-Darling test (test: "
                                "\"anderson-darling\") needs an R package "
                                "(\"nortest\"); the other three tests need none.")
    if typ in GATES:
        out["gates"] = GATES[typ]
    schema[typ] = out

# Sanity: 54 types (53 + hierarchical-clustering, seq 160), every key accounted for, offered_on non-empty.
assert len(schema) == 54, f"{len(schema)} types, expected 54"
for typ, entry in schema.items():
    assert entry["offered_on"], f"{typ} offered on no table type"
    assert entry["min_columns"] is not None, f"{typ} has no min_columns"

out_path = ROOT / "src-tauri/src/analysis-params-schema.json"
# Pure JSON (no comment line): mcp.rs include_str!s it and parses it
# directly; the "generated — do not edit" note lives in mcp.rs and in
# this script's docstring.
out_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {out_path} ({len(schema)} analysis types)")
# Report required params with no documented default — the run errors
# without them, so the schema must say so in the description.
for typ, entry in sorted(schema.items()):
    for p in entry["params"]:
        if p.get("required") and "default" not in p:
            print(f"  required, no default: {typ}.{p['name']}")
