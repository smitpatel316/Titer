"""Numeric E2E cases: QA analyses vs ground truth (MCP lane, Plane seq 182).

Ground truth:
  - tests/reference.json (pinned values from the unit-test suite) — the primary
    source; every reference-family case below quotes its values verbatim.
  - ~/workspace/helix/qa/QA-LOG.md and QA-LOG-LINUX.md (scipy 1.11.4 values
    on the QA datasets) for the Q-04..Q-30 / Q-36 / Q-64 / Q-65 family.

Wiring (coordinator): in e2e/mcp/suite.py, add
    from cases_numeric import register_numeric_cases
and call ``register_numeric_cases(suite)`` inside run(), after the existing
cases. This module does NOT edit suite.py.

Case contract (same as suite.py): each case gets a fresh project, creates its
fixture table(s) through MCP, runs one analysis through
``suite.run_analysis_sync`` and asserts pinned values from
``titer_read_results``. Every case closes its project in a finally block.

FAIL-pin: all numeric expectations pass through ``_E()``. With the
environment variable ``NUMERIC_PIN_CHECK=1`` every expectation is shifted
(+10% relative, or 1.0 for near-zero pins), so a correctly written case
MUST fail. Run the module once normally (all pass) and once with the
variable set (all fail) to prove no case passes on broken code. The
non-numeric pins (error paths, "not Yates" inequality) are discriminating
by construction: a pre-fix build returns a different value, which the
equality assertion rejects.

Tolerances: the MCP path runs the same R/TS code as the unit tests, so
the live values agree with the pins to ~1e-9 — but the pins themselves are
quoted to 4-6 significant digits, so value pins use rel 1e-4 (1e-3 for
p-values, which R reports to ~6 significant digits). That is still 1000x
tighter than the 10% shift in pin-check mode, so a wrong value still fails.
QA-log pins are quoted to 4-5 significant digits, so they use rel 2e-3
(4e-3 for p-values).
"""

import os

# Set NUMERIC_PIN_CHECK=1 to shift every expected value and prove each case
# fails on broken code (see module docstring).
_PIN_CHECK = os.environ.get("NUMERIC_PIN_CHECK") == "1"


def _E(v):
    """Expected-value passthrough; shifts in pin-check mode."""
    if not _PIN_CHECK:
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v * 1.1 if abs(v) > 1e-9 else 1.0
    return v


def _close(got, exp, rel=1e-6, abs_tol=0.0):
    if got is None:
        return False
    exp = _E(exp)
    return abs(got - exp) <= max(rel * abs(exp), abs_tol)


def _stat(res, label):
    stats = {s["label"]: s["value"] for s in res.get("stats", [])}
    assert label in stats, f"stat {label!r} missing (have {sorted(stats)})"
    return stats[label]


def _check_stat(res, label, exp, rel=1e-4, abs_tol=0.0):
    got = _stat(res, label)
    assert _close(got, exp, rel, abs_tol), (
        f"{label}: got {got!r}, expected {_E(exp)!r} (rel {rel})")
    return got


def _check_p(res, label, exp, rel=1e-3):
    # p-values: relative tolerance plus an absolute floor for tiny p.
    got = _stat(res, label)
    assert _close(got, exp, rel=rel, abs_tol=1e-9), (
        f"{label}: got {got!r}, expected {_E(exp)!r}")
    return got


def _grp(res, name):
    for g in res.get("groups", []):
        if g.get("name") == name:
            return g
    raise AssertionError(
        f"group {name!r} missing (have {[g.get('name') for g in res.get('groups', [])]})")


def _check_group(res, name, mean=None, sd=None, sem=None, median=None, n=None,
                 ciLow=None, ciHigh=None, rel=1e-4):
    g = _grp(res, name)
    if mean is not None:
        assert _close(g.get("mean"), mean, rel=rel), (
            f"{name} mean: got {g.get('mean')!r}, expected {_E(mean)!r}")
    if sd is not None:
        assert _close(g.get("sd"), sd, rel=rel), (
            f"{name} sd: got {g.get('sd')!r}, expected {_E(sd)!r}")
    if sem is not None:
        assert _close(g.get("sem"), sem, rel=rel), (
            f"{name} sem: got {g.get('sem')!r}, expected {_E(sem)!r}")
    if median is not None:
        assert _close(g.get("median"), median, rel=rel), (
            f"{name} median: got {g.get('median')!r}, expected {_E(median)!r}")
    if n is not None:
        assert g.get("n") == _E(n), f"{name} n: got {g.get('n')!r}, expected {_E(n)!r}"
    if ciLow is not None:
        assert _close(g.get("ciLow"), ciLow, rel=rel), (
            f"{name} ciLow: got {g.get('ciLow')!r}, expected {_E(ciLow)!r}")
    if ciHigh is not None:
        assert _close(g.get("ciHigh"), ciHigh, rel=rel), (
            f"{name} ciHigh: got {g.get('ciHigh')!r}, expected {_E(ciHigh)!r}")
    return g


def _comp(res, g1, g2):
    for c in res.get("comparisons", []):
        if {c.get("group1"), c.get("group2")} == {g1, g2}:
            return c
    raise AssertionError(
        f"comparison {g1!r} vs {g2!r} missing (have "
        f"{[(c.get('group1'), c.get('group2')) for c in res.get('comparisons', [])]})")


def _check_comp(res, g1, g2, diff=None, p=None, p_rel=1e-3, rel=1e-4):
    c = _comp(res, g1, g2)
    if diff is not None:
        assert _close(c.get("diff"), diff, rel=rel), (
            f"{g1} vs {g2} diff: got {c.get('diff')!r}, expected {_E(diff)!r}")
    if p is not None:
        assert _close(c.get("p"), p, rel=p_rel, abs_tol=1e-9), (
            f"{g1} vs {g2} p: got {c.get('p')!r}, expected {_E(p)!r}")
    return c


def _coef(res, term):
    for c in res.get("coefficients", []):
        if c.get("term") == term:
            return c
    raise AssertionError(
        f"coefficient {term!r} missing (have {[c.get('term') for c in res.get('coefficients', [])]})")


def _check_coef(res, term, estimate=None, p=None, low=None, high=None, rel=1e-4):
    c = _coef(res, term)
    if estimate is not None:
        assert _close(c.get("estimate"), estimate, rel=rel, abs_tol=1e-9), (
            f"{term} estimate: got {c.get('estimate')!r}, expected {_E(estimate)!r}")
    if p is not None:
        assert _close(c.get("p"), p, rel=1e-3, abs_tol=1e-9), (
            f"{term} p: got {c.get('p')!r}, expected {_E(p)!r}")
    if low is not None:
        assert _close(c.get("low"), low, rel=rel, abs_tol=1e-9), (
            f"{term} CI low: got {c.get('low')!r}, expected {_E(low)!r}")
    if high is not None:
        assert _close(c.get("high"), high, rel=rel, abs_tol=1e-9), (
            f"{term} CI high: got {c.get('high')!r}, expected {_E(high)!r}")
    return c


def _fit_row(res, label, idx=0):
    for row in res.get("fit", {}).get("rows", []):
        if row.get("label") == label:
            if "values" in row:
                return row["values"][idx]
            if "ranges" in row:
                return row["ranges"][idx]
    raise AssertionError(
        f"fit row {label!r} missing (have "
        f"{[r.get('label') for r in res.get('fit', {}).get('rows', [])]})")


def _check_fit(res, label, exp, idx=0, rel=1e-4):
    got = _fit_row(res, label, idx)
    assert _close(got, exp, rel=rel, abs_tol=1e-9), (
        f"fit {label}[{idx}]: got {got!r}, expected {_E(exp)!r}")
    return got


def _check_fit_range(res, label, lo, hi, idx=0, rel=1e-4):
    # The "95% CI" row follows its value row in the fit table; the range
    # belongs to the value row named `label`, not to a row labelled "95% CI".
    rows = res.get("fit", {}).get("rows", [])
    for i, row in enumerate(rows):
        if row.get("label") == label and "values" in row:
            ci = rows[i + 1]
            assert ci.get("label") == "95% CI" and "ranges" in ci, (
                f"fit {label}: expected a 95% CI row after it, got {ci}")
            got = ci["ranges"][idx]
            assert _close(got[0], lo, rel=rel, abs_tol=1e-9), (
                f"fit {label}[{idx}] low: got {got[0]!r}, expected {_E(lo)!r}")
            assert _close(got[1], hi, rel=rel, abs_tol=1e-9), (
                f"fit {label}[{idx}] high: got {got[1]!r}, expected {_E(hi)!r}")
            return got
    raise AssertionError(
        f"fit row {label!r} missing (have "
        f"{[r.get('label') for r in rows]})")


def _new_project(suite):
    proj = suite.mcp.tool("titer_create_project", {})
    pid = proj["project_id"]
    suite.open_projects.append(pid)
    return pid


def _make_table(suite, pid, name):
    """Create fixture table ``name`` in project ``pid``; returns table_id."""
    fx = FIXTURES[name]
    args = {"project_id": pid, "table_type": fx["type"], "name": name,
            "columns": fx["columns"], "rows": fx["rows"]}
    rg = fx["extra"].get("rowGroups")
    if rg:
        args["row_groups"] = rg
    tab = suite.mcp.tool("titer_create_table", args)
    tid = tab.get("table_id") or tab.get("id")
    if not tid:
        tabs = suite.mcp.tool("titer_list_tables", {"project_id": pid})["tables"]
        tid = [t["id"] for t in tabs if t.get("name") == name][0]
    excl = fx["extra"].get("excluded")
    if excl:
        # titer_create_table has no `excluded` param; reproduce the exclusion
        # with a write of the same data plus the exclusion marks.
        suite.mcp.tool("titer_write_table", {
            "project_id": pid, "table_id": tid,
            "columns": fx["columns"], "rows": fx["rows"], "excluded": excl})
    return tid


def _run(suite, pid, tid, analysis, params, timeout_s=180):
    """Run an analysis and return the cached result dict.

    run_analysis_sync already guarantees the outer envelope has status
    "computed"; the inner result (AnalysisResult) carries no status field.
    """
    _, res = suite.run_analysis_sync(pid, tid, analysis, params, timeout_s=timeout_s)
    return res["result"]


FIXTURES = {'bindAssocThenDissoc': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '0', '0.5'], [None, '1', '9.5634623461'], [None, '2', '16.9839976982'], [None, '3', '23.0594181953'], [None, '5', '32.1060279414'], [None, '7', '38.1701518029'], [None, '10', '43.7332358382'], [None, '12', '35.8963797358'], [None, '15', '26.7222830544'], [None, '20', '16.4046186402'], [None, '30', '6.3509822174'], [None, '40', '2.6524560684']], 'extra': {}}, 'bindKinetics': {'type': 'xy', 'columns': ['Title', 'X', 'Assoc', 'Dissoc', 'TwoPhase', 'Dissoc2'], 'rows': [[None, '0', '0', '100', '0', '100'], [None, '1', '39.3469340287', '75.3777309648', '47.1033165769', '55.2518492519'], [None, '2', '63.2120558829', '57.1371054289', '65.9646075811', '37.333622798'], [None, '3', '77.6869839852', '43.6241176754', '74.2903585938', '29.4241593359'], [None, '5', '91.7915001376', '26.1973652141', '81.3324239187', '22.7341972772'], [None, '7', '96.9802616578', '16.633360684', '85.0386091487', '19.2133213088'], [None, '10', '99.3262053001', '9.7297714949', '88.9604387698', '15.4875831687'], [None, '15', '99.944691563', '6.0553546711', '93.3060737824', '11.3592299067']], 'extra': {}}, 'bindTotal': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '0', '2'], [None, '0.5', '11.3409090909'], [None, '1', '19.1666666667'], [None, '2', '31.5714285714'], [None, '5', '54.5'], [None, '10', '73.6666666667'], [None, '20', '92'], [None, '50', '117.9090909091']], 'extra': {}}, 'bindTwoSite': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '0.03', '1.8074829503'], [None, '0.1', '5.6535504297'], [None, '0.3', '14.4372868511'], [None, '1', '31.9047619048'], [None, '3', '50.2173913043'], [None, '10', '67.8787878788'], [None, '30', '82.064516129'], [None, '100', '92.7392739274'], [None, '300', '97.3006644518'], [None, '1000', '99.1557462146']], 'extra': {}}, 'blandAltman': {'type': 'column', 'columns': ['Title', 'Method A', 'Method B'], 'rows': [[None, '12.1', '12.4'], [None, '11.4', '11.9'], [None, '13.2', '13.0'], [None, '12.8', '13.5'], [None, '10.9', '11.2'], [None, '12.5', '12.9'], [None, '11.8', '12.0'], [None, '13.0', '13.6'], [None, '12.2', '12.5'], [None, '11.6', '12.1']], 'extra': {}}, 'classicX': {'type': 'xy', 'columns': ['Title', 'X', 'G', 'B', 'L', 'S'], 'rows': [[None, '0', '0.3865920139', '0.6692850924', '8.2568807339', '12.397127693'], [None, '0.5', '1.1108996538', '1.0986942631', '10', '14.7977481499'], [None, '1', '2.8565500785', '1.7986209962', '12.3287671233', '14.3879128095'], [None, '1.5', '6.5728528617', '2.9312230751', '15.5172413793', '11.4076976557'], [None, '2', '13.5335283237', '4.7425873178', '20', '7.602872307'], [None, '2.5', '24.9352208777', '7.5858180021', '26.4705882353', '5.2022518501'], [None, '3', '41.1112290507', '11.9202922022', '36', '5.6120871905'], [None, '3.5', '60.6530659713', '18.2425523806', '50', '8.5923023443'], [None, '4', '80.0737402917', '26.894142137', '69.2307692308', '12.397127693'], [None, '4.5', '94.5959468907', '37.7540668798', '90', '14.7977481499'], [None, '5', '100', '50', '100', '14.3879128095'], [None, '5.5', '94.5959468907', '62.2459331202', '90', '11.4076976557'], [None, '6', '80.0737402917', '73.105857863', '69.2307692308', '7.602872307'], [None, '6.5', '60.6530659713', '81.7574476194', '50', '5.2022518501'], [None, '7', '41.1112290507', '88.0797077978', '36', '5.6120871905'], [None, '7.5', '24.9352208777', '92.4141819979', '26.4705882353', '8.5923023443'], [None, '8', '13.5335283237', '95.2574126822', '20', '12.397127693'], [None, '8.5', '6.5728528617', '97.0687769249', '15.5172413793', '14.7977481499'], [None, '9', '2.8565500785', '98.2013790038', '12.3287671233', '14.3879128095'], [None, '9.5', '1.1108996538', '98.9013057369', '10', '11.4076976557'], [None, '10', '0.3865920139', '99.3307149076', '8.2568807339', '7.602872307'], [None, '10.5', '0.1203859995', '99.5929862284', '6.9230769231', '5.2022518501'], [None, '11', '0.0335462628', '99.7527376843', '5.8823529412', '5.6120871905'], [None, '11.5', '0.0083648347', '99.8498817743', '5.0561797753', '8.5923023443'], [None, '12', '0.0018664469', '99.9088948806', '4.3902439024', '12.397127693']], 'extra': {}}, 'column': {'type': 'column', 'columns': ['Title', 'Control', 'Low', 'High', 'Sparse'], 'rows': [[None, '12.1', '14.3', '18.2', '9'], [None, '11.4', '15.1', '19.9', None], [None, '13.2', '13.8', '17.5', '11'], [None, '12.8', '16.2', '21.3', None], [None, '10.9', '14.9', '18.8', '10.5'], [None, '12.5', 'abc', '20.1', None], [None, '11.8', '15.5', None, '12'], [None, '30', '14.1', '19.4', None]], 'extra': {'excluded': ['2,3']}}, 'competitionHomologous': {'type': 'xy', 'columns': ['Title', 'X', 'Response'], 'rows': [[None, '-3', '66.6222518321'], [None, '-2.5', '66.5264166658'], [None, '-2', '66.2251655629'], [None, '-1.5', '65.2902278078'], [None, '-1', '62.5'], [None, '-0.5', '55.0591736736'], [None, '0', '40'], [None, '0.5', '21.4487440022'], [None, '1', '8.6956521739'], [None, '1.5', '3.0190705689']], 'extra': {}}, 'competitionTwoSite': {'type': 'xy', 'columns': ['Title', 'X', 'Response'], 'rows': [[None, '-3', '95.4495459545'], [None, '-2.5', '87.9715399425'], [None, '-2', '74.95004995'], [None, '-1.5', '61.8550382084'], [None, '-1', '54.0504050405'], [None, '-0.5', '50'], [None, '0', '45.9495949595'], [None, '0.5', '38.1449617916'], [None, '1', '25.04995005'], [None, '1.5', '12.0284600575']], 'extra': {}}, 'contingency2': {'type': 'contingency', 'columns': ['Title', 'Outcome A', 'Outcome B'], 'rows': [['Drug', '15', '5'], ['Placebo', '6', '14']], 'extra': {}}, 'contingency3': {'type': 'contingency', 'columns': ['Title', 'Outcome A', 'Outcome B', 'Outcome C'], 'rows': [['North', '20', '15', '10'], ['South', '12', '18', '25'], ['East', '14', '16', '15']], 'extra': {}}, 'contingencyTrend': {'type': 'contingency', 'columns': ['Title', 'Success', 'Failure'], 'rows': [['Dose 1', '2', '18'], ['Dose 2', '5', '15'], ['Dose 3', '9', '11'], ['Dose 4', '14', '6']], 'extra': {}}, 'coxTable': {'type': 'multiple', 'columns': ['Title', 'Time', 'Status', 'Trt', 'Age'], 'rows': [[None, '3', '1', '0', '62'], [None, '5', '1', '0', '58'], [None, '7', '0', '0', '65'], [None, '8', '1', '0', '70'], [None, '10', '1', '0', '55'], [None, '12', '0', '0', '68'], [None, '15', '1', '0', '61'], [None, '20', '1', '0', '59'], [None, '6', '1', '1', '60'], [None, '9', '1', '1', '57'], [None, '12', '1', '1', '63'], [None, '15', '0', '1', '66'], [None, '18', '1', '1', '54'], [None, '22', '1', '1', '71'], [None, '25', '0', '1', '64'], [None, '30', '1', '1', '56']], 'extra': {}}, 'deming': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '1', '1.4'], [None, '2', '1.9'], [None, '3', '3.6'], [None, '4', '3.8'], [None, '5', '5.5'], [None, '6', '5.7'], [None, '7', '7.4'], [None, '8', '7.6'], [None, '9', '9.5'], [None, '10', '9.8']], 'extra': {}}, 'doseFall': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [['', '-3', '97.9'], ['', '-2.5', '96.6'], ['', '-2', '91.8'], ['', '-1.5', '80.5'], ['', '-1', '58.8'], ['', '-0.5', '31.099999999999994'], ['', '0', '13.900000000000006'], ['', '0.5', '5.799999999999997'], ['', '1', '2.200000000000003'], ['', '1.5', '0.9000000000000057']], 'extra': {}}, 'doseLog': {'type': 'xy', 'columns': ['Title', 'X', 'Response'], 'rows': [[None, '-3', '2.1'], [None, '-2.5', '3.4'], [None, '-2', '8.2'], [None, '-1.5', '19.5'], [None, '-1', '41.2'], [None, '-0.5', '68.9'], [None, '0', '86.1'], [None, '0.5', '94.2'], [None, '1', '97.8'], [None, '1.5', '99.1']], 'extra': {}}, 'doseReps': {'type': 'xy', 'columns': ['Title', 'X', 'R:Y1', 'R:Y2', 'R:Y3'], 'rows': [['', '-3', '2.18', '2.04', None], ['', '-2.5', '3.54', '3.3', '4.0'], ['', '-2', '8.53', '7.95', '8.8'], ['', '-1.5', '20.28', '18.91', '20.1'], ['', '-1', '42.85', '39.96', None], ['', '-0.5', '71.66', '66.83', '69.5'], ['', '0', '89.54', '83.52', '86.7'], ['', '0.5', '97.97', '91.37', '94.8'], ['', '1', '101.71', '94.87', None], ['', '1.5', '103.06', '96.13', '99.7'], ['Sample 1', None, '48', '52', '51'], ['Sample 2', None, '11', '9.5', None]], 'extra': {'groups': 1, 'replicates': 3}}, 'doseTextbook': {'type': 'xy', 'columns': ['Title', 'X', 'Response'], 'rows': [[None, '-2', '2'], [None, '-1.5', '5'], [None, '-1', '12'], [None, '-0.5', '30'], [None, '0', '50'], [None, '0.5', '70'], [None, '1', '88'], [None, '1.5', '95'], [None, '2', '98']], 'extra': {}}, 'doseTwo': {'type': 'xy', 'columns': ['Title', 'X', 'Control', 'Treated'], 'rows': [[None, '-3', '2.1', '1.2'], [None, '-2.5', '3.4', '2.0'], [None, '-2', '8.2', '3.9'], [None, '-1.5', '19.5', '9.1'], [None, '-1', '41.2', '21.7'], [None, '-0.5', '68.9', '43.5'], [None, '0', '86.1', '70.2'], [None, '0.5', '94.2', '87.4'], [None, '1', '97.8', '95.1'], [None, '1.5', '99.1', '98.0']], 'extra': {}}, 'ec50shift': {'type': 'xy', 'columns': ['Title', 'X', '0 nM', '10 nM'], 'rows': [[None, '-8', '0.9900990099', '0.0999000999'], [None, '-7.5', '3.0653430032', '0.3152309183'], [None, '-7', '9.0909090909', '0.9900990099'], [None, '-6.5', '24.0253073352', '3.0653430032'], [None, '-6', '50', '9.0909090909'], [None, '-5.5', '75.9746926648', '24.0253073352'], [None, '-5', '90.9090909091', '50'], [None, '-4.5', '96.9346569968', '75.9746926648'], [None, '-4', '99.0099009901', '90.9090909091']], 'extra': {}}, 'enzMixed': {'type': 'xy', 'columns': ['Title', 'X', '0 nM', '5 nM', '20 nM'], 'rows': [[None, '1', '9.0909090909', '4.6511627907', '1.8867924528'], [None, '2', '16.6666666667', '8.6956521739', '3.5714285714'], [None, '5', '33.3333333333', '18.1818181818', '7.6923076923'], [None, '10', '50', '28.5714285714', '12.5'], [None, '20', '66.6666666667', '40', '18.1818181818'], [None, '50', '83.3333333333', '52.6315789474', '25'], [None, '100', '90.9090909091', '58.8235294118', '28.5714285714']], 'extra': {}}, 'enzMorrison': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '0', '100'], [None, '1', '86.3324958071'], [None, '2', '74.0312423743'], [None, '5', '46.3324958071'], [None, '10', '24.3398113206'], [None, '20', '11.3835714722'], [None, '50', '4.2362280552']], 'extra': {}}, 'enzymeS': {'type': 'xy', 'columns': ['Title', 'X', 'A', 'B', 'C'], 'rows': [[None, '0.5', '9.0909090909', '0.9900990099', '19.8019801980'], [None, '1', '16.6666666667', '3.8461538462', '32.2580645161'], [None, '2', '28.5714285714', '13.7931034483', '45.4545454545'], [None, '5', '50.0000000000', '50.0000000000', '52.6315789474'], [None, '10', '66.6666666667', '80.0000000000', '45.4545454545'], [None, '20', '80.0000000000', '94.1176470588', '32.2580645161'], [None, '50', '90.9090909091', '99.0099009901', '16.5562913907']], 'extra': {}}, 'expX': {'type': 'xy', 'columns': ['Title', 'X', 'A', 'B', 'C', 'D', 'D2', 'E'], 'rows': [[None, '0', '100', '100', '0', '10', '10', '100'], [None, '0.5', '80.0920704764', '74.9287223178', '13.9292023575', '28.0808905732', '11.0517091808', '100'], [None, '1', '64.5877593741', '59.2178890114', '25.9181779318', '44.4411569152', '12.2140275816', '100'], [None, '2', '43.1091497054', '42.6820395865', '45.1188363906', '72.6391912532', '14.9182469764', '100'], [None, '3', '30.0817144134', '35.2117707225', '59.3430340259', '95.7257891421', '18.2211880039', '64.5877593741'], [None, '4', '22.1801754913', '31.2085397144', '69.8805788088', '114.6274968177', '22.2554092849', '43.1091497054'], [None, '6', '14.4808361531', '26.6130742134', '83.4701111778', '142.7730997367', '33.2011692274', '22.1801754913'], [None, '8', '11.6484075', '23.4999966812', '90.9282046711', '161.639661581', '49.530324244', '14.4808361531'], [None, '10', '10.6064152299', '21.0391072309', '95.0212931632', '174.286296185', '73.8905609893', '11.6484075'], [None, '12', '10.2230876959', '19.0361950101', '97.2676277553', '182.763588875', '110.2317638064', '10.6064152299']], 'extra': {}}, 'freireich': {'type': 'survival', 'columns': ['Title', 'Weeks', '6-MP', 'Placebo'], 'rows': [['', '6', '1', None], ['', '6', '1', None], ['', '6', '1', None], ['', '6', '0', None], ['', '7', '1', None], ['', '9', '0', None], ['', '10', '1', None], ['', '10', '0', None], ['', '11', '0', None], ['', '13', '1', None], ['', '16', '1', None], ['', '17', '0', None], ['', '19', '0', None], ['', '20', '0', None], ['', '22', '1', None], ['', '23', '1', None], ['', '25', '0', None], ['', '32', '0', None], ['', '32', '0', None], ['', '34', '0', None], ['', '35', '0', None], ['', '1', None, '1'], ['', '1', None, '1'], ['', '2', None, '1'], ['', '2', None, '1'], ['', '3', None, '1'], ['', '4', None, '1'], ['', '4', None, '1'], ['', '5', None, '1'], ['', '5', None, '1'], ['', '8', None, '1'], ['', '8', None, '1'], ['', '8', None, '1'], ['', '8', None, '1'], ['', '11', None, '1'], ['', '11', None, '1'], ['', '12', None, '1'], ['', '12', None, '1'], ['', '15', None, '1'], ['', '17', None, '1'], ['', '22', None, '1'], ['', '23', None, '1']], 'extra': {}}, 'freqCol': {'type': 'column', 'columns': ['Title', 'Values'], 'rows': [[None, '2.1'], [None, '3.5'], [None, '3.9'], [None, '4.2'], [None, '5.0'], [None, '5.8'], [None, '6.1'], [None, '7.4'], [None, '8.0'], [None, '9.3']], 'extra': {}}, 'grouped': {'type': 'grouped', 'columns': ['Title', 'A:Y1', 'A:Y2', 'A:Y3', 'B:Y1', 'B:Y2', 'B:Y3', 'C:Y1', 'C:Y2', 'C:Y3'], 'rows': [['Day 1', '10', '11', '12', '14', '15', '13', '9', '10', '11'], ['Day 2', '12', '13', '14', '18', '19', '17', '10', None, '12'], ['Day 3', '15', '14', '16', '22', '24', '21', '11', '12', '13'], ['Day 4', '18', '19', '17', '27', '26', '28', '12', '14', '13'], ['Day 5', '20', '21', '22', '31', '30', '33', '13', '13', '15']], 'extra': {'groups': 3, 'replicates': 3}}, 'grouped3way': {'type': 'grouped', 'columns': ['Title', 'Placebo:Y1', 'Placebo:Y2', 'Placebo:Y3', 'Drug:Y1', 'Drug:Y2', 'Drug:Y3'], 'rows': [['Day 1', '10.001230153357483', '10.29874553750847', '9.725862144637782', '11.109408161242726', '11.545329214828277', '11.008353445003538'], ['Day 2', '14.060143602597439', '15.340215245554534', '13.50779348144867', '19.37952510018006', '20.4898420501852', '20.35688700816006'], ['Day 1', '11.1054142489979', '10.069531955291795', '10.970748177536727', '13.695303194458289', '11.655785452714918', '12.542384238959782'], ['Day 2', '11.098777260199157', '11.710462260215024', '11.158264962208268', '14.76490886892532', '13.732553518556298', '15.271264358821702']], 'extra': {'groups': 2, 'replicates': 3, 'rowGroups': [{'name': 'WT', 'count': 2}, {'name': 'KO', 'count': 2}]}}, 'groupedBlankRow': {'type': 'grouped', 'columns': ['Title', 'A:Y1', 'A:Y2', 'A:Y3', 'B:Y1', 'B:Y2', 'B:Y3', 'C:Y1', 'C:Y2', 'C:Y3'], 'rows': [['Day 1', '10', '11', '12', '14', '15', '13', '9', '10', '11'], ['Day 2', '12', '13', '14', '18', '19', '17', '10', None, '12'], ['Day 3', '15', '14', '16', '22', '24', '21', '11', '12', '13'], ['Day 4', '18', '19', '17', '27', '26', '28', '12', '14', '13'], ['Day 5', '20', '21', '22', '31', '30', '33', '13', '13', '15'], [None, None, None, None, None, None, None, None, None, None]], 'extra': {'groups': 3, 'replicates': 3}}, 'grubbsIterate': {'type': 'column', 'columns': ['Title', 'Values'], 'rows': [[None, '10'], [None, '10.2'], [None, '9.8'], [None, '10.1'], [None, '10'], [None, '25'], [None, '45']], 'extra': {}}, 'grubbsMasked': {'type': 'column', 'columns': ['Title', 'Masked'], 'rows': [[None, '10'], [None, '10.2'], [None, '9.8'], [None, '10.1'], [None, '10'], [None, '25'], [None, '26']], 'extra': {}}, 'inhibition': {'type': 'xy', 'columns': ['Title', 'X', 'Y'], 'rows': [['', '-9', '98'], ['', '-8.5', '97'], ['', '-8', '90'], ['', '-7.5', '72'], ['', '-7', '48'], ['', '-6.5', '25'], ['', '-6', '10'], ['', '-5.5', '4'], ['', '-5', '2']], 'extra': {}}, 'kmeans': {'type': 'multiple', 'columns': ['Title', 'X', 'Y'], 'rows': [[None, '1', '1'], [None, '1', '2'], [None, '2', '1'], [None, '8', '8'], [None, '9', '8'], [None, '8', '9']], 'extra': {}}, 'ksShifted': {'type': 'column', 'columns': ['Title', 'Control', 'Treated'], 'rows': [[None, '12.1', '18.2'], [None, '11.4', '19.9'], [None, '13.2', '17.5'], [None, '12.8', '21.3'], [None, '10.9', '18.8'], [None, '12.5', '20.1'], [None, '11.8', '19.4'], [None, '14.0', '22.0']], 'extra': {}}, 'logistic': {'type': 'xy', 'columns': ['Title', 'X', 'Response'], 'rows': [[None, '0', '0'], [None, '1', '0'], [None, '2', '0'], [None, '3', '0'], [None, '4', '1'], [None, '5', '0'], [None, '6', '1'], [None, '7', '1'], [None, '8', '1'], [None, '9', '1']], 'extra': {}}, 'matched': {'type': 'column', 'columns': ['Title', 'Day 0', 'Day 7', 'Day 14'], 'rows': [[None, '10.1', '12.0', '15.2'], [None, '9.8', '12.9', '18.1'], [None, '11.2', '13.1', '14.0'], [None, '10.5', '14.2', '21.3'], [None, '9.9', '11.8', '13.1'], [None, '10.8', '13.6', '19.4']], 'extra': {}}, 'mcnemarTable': {'type': 'contingency', 'columns': ['Title', 'Second: Yes', 'Second: No'], 'rows': [['First: Yes', '20', '12'], ['First: No', '4', '30']], 'extra': {}}, 'multiple': {'type': 'multiple', 'columns': ['Title', 'Weight', 'Height', 'Age', 'Dose'], 'rows': [[None, '70', '175', '34', '1'], [None, '82', '181', '45', '2'], [None, '65', '168', '29', '1'], [None, '90', '185', '51', '3'], [None, '75', '172', '38', '2'], [None, '58', '160', '25', '1'], [None, '88', '179', '48', '3'], [None, '72', '170', '41', '2'], [None, '95', '188', '55', '3'], [None, '68', None, '33', '1']], 'extra': {}}, 'multipleBinary': {'type': 'multiple', 'columns': ['Title', 'Outcome', 'Age', 'Dose'], 'rows': [[None, '0', '22', '0'], [None, '0', '25', '0'], [None, '0', '28', '1'], [None, '1', '31', '0'], [None, '0', '35', '1'], [None, '1', '38', '1'], [None, '0', '42', '0'], [None, '1', '45', '1'], [None, '1', '49', '1'], [None, '0', '53', '0'], [None, '1', '57', '1'], [None, '1', '61', '1']], 'extra': {}}, 'nested2': {'type': 'nested', 'columns': ['Title', 'Control:S1:R1', 'Control:S1:R2', 'Control:S1:R3', 'Control:S2:R1', 'Control:S2:R2', 'Control:S2:R3', 'Control:S3:R1', 'Control:S3:R2', 'Control:S3:R3', 'Treated:S1:R1', 'Treated:S1:R2', 'Treated:S1:R3', 'Treated:S2:R1', 'Treated:S2:R2', 'Treated:S2:R3', 'Treated:S3:R1', 'Treated:S3:R2', 'Treated:S3:R3'], 'rows': [[None, '10', '11', '12', '13', '12', '14', '11', '10', '12', '16', '15', '17', '18', '17', '16', '15', '16', '17']], 'extra': {'groups': 2, 'subgroups': 3, 'replicates': 3}}, 'nested3': {'type': 'nested', 'columns': ['Title', 'Control:S1:R1', 'Control:S1:R2', 'Control:S1:R3', 'Control:S2:R1', 'Control:S2:R2', 'Control:S2:R3', 'Control:S3:R1', 'Control:S3:R2', 'Control:S3:R3', 'Treated:S1:R1', 'Treated:S1:R2', 'Treated:S1:R3', 'Treated:S2:R1', 'Treated:S2:R2', 'Treated:S2:R3', 'Treated:S3:R1', 'Treated:S3:R2', 'Treated:S3:R3', 'High:S1:R1', 'High:S1:R2', 'High:S1:R3', 'High:S2:R1', 'High:S2:R2', 'High:S2:R3', 'High:S3:R1', 'High:S3:R2', 'High:S3:R3'], 'rows': [[None, '10', '11', '12', '13', '12', '14', '11', '10', '12', '16', '15', '17', '18', '17', '16', '15', '16', '17', '20', '21', '19', '22', '21', '23', '19', '20', '21']], 'extra': {'groups': 3, 'subgroups': 3, 'replicates': 3}}, 'noReplicates': {'type': 'grouped', 'columns': ['Title', 'A:Y1', 'B:Y1'], 'rows': [['a', '1', '2'], ['b', '2', '5'], ['c', '4', '4']], 'extra': {'groups': 2, 'replicates': 1}}, 'normality': {'type': 'column', 'columns': ['Title', 'A', 'B'], 'rows': [[None, '12.0', '6.5'], [None, '12.4', '1.3'], [None, '11.7', '5.1'], [None, '10.9', '7.1'], [None, '11.5', '8.0'], [None, '10.8', '2.5'], [None, '12.1', '5.3'], [None, '13.6', '3.7'], [None, '11.4', '4.2'], [None, '11.3', '15.5'], [None, '12.6', '4.2'], [None, '12.4', '7.2'], [None, '12.1', '13.7'], [None, '10.9', '4.9'], [None, '12.0', '6.8'], [None, '12.8', '8.0'], [None, '10.4', '7.7'], [None, '11.5', '3.1'], [None, '9.7', '7.8'], [None, '10.5', '19.1'], [None, '9.8', '2.5'], [None, '11.7', '13.5'], [None, '10.5', '8.0'], [None, '12.3', '4.7'], [None, '12.2', '30.0']], 'extra': {}}, 'operational': {'type': 'xy', 'columns': ['Title', 'X', 'Full agonist', 'Partial agonist'], 'rows': [[None, '-8', '9.0909090909', '3.0359144704'], [None, '-7.5', '24.0253073352', '8.8368670256'], [None, '-7', '50', '22.3288777134'], [None, '-6.5', '75.9746926648', '43.1736470252'], [None, '-6', '90.9090909091', '61.2574113277'], [None, '-5.5', '96.9346569968', '70.6101111697'], [None, '-5', '99.0099009901', '74.1922022049'], [None, '-4.5', '99.6847690817', '75.4018295819'], [None, '-4', '99.9000999001', '75.7925986172']], 'extra': {}}, 'pca': {'type': 'multiple', 'columns': ['Title', 'Var1', 'Var2', 'Var3'], 'rows': [[None, '2.5', '2.4', '1.0'], [None, '0.5', '0.7', '0.2'], [None, '2.2', '2.9', '1.1'], [None, '1.9', '2.2', '0.9'], [None, '3.1', '3.0', '1.4'], [None, '2.3', '2.7', '1.2']], 'extra': {}}, 'poissonCounts': {'type': 'multiple', 'columns': ['Title', 'Count', 'Dose', 'Age'], 'rows': [[None, '2', '0', '20'], [None, '3', '0', '25'], [None, '3', '0', '30'], [None, '5', '1', '22'], [None, '4', '1', '27'], [None, '7', '1', '33'], [None, '6', '2', '24'], [None, '9', '2', '29'], [None, '8', '2', '35'], [None, '12', '3', '26'], [None, '11', '3', '31'], [None, '14', '3', '36']], 'extra': {}}, 'poissonOverdispersed': {'type': 'multiple', 'columns': ['Title', 'Count', 'Dose', 'Age'], 'rows': [[None, '0', '0', '20'], [None, '9', '0', '25'], [None, '1', '0', '30'], [None, '14', '1', '22'], [None, '2', '1', '27'], [None, '20', '1', '33'], [None, '3', '2', '24'], [None, '25', '2', '29'], [None, '5', '2', '35'], [None, '30', '3', '26'], [None, '4', '3', '31'], [None, '35', '3', '36']], 'extra': {}}, 'qa_chisq': {'type': 'contingency', 'columns': ['Title', 'X', 'Y'], 'rows': [['R1', '10', '20'], ['R2', '30', '40']], 'extra': {}}, 'qa_col': {'type': 'column', 'columns': ['Title', 'A', 'B', 'C', 'D'], 'rows': [[None, '1', '2', '5', '1'], [None, '2', '4', '5', '2'], [None, '3', '6', '6', '3'], [None, '4', '8', '6', '4'], [None, '5', '10', '7', '5'], [None, None, None, None, '6'], [None, None, None, None, '7'], [None, None, None, None, '8'], [None, None, None, None, '9'], [None, None, None, None, '100']], 'extra': {}}, 'qa_multireg': {'type': 'multiple', 'columns': ['Title', 'Var1', 'Var2', 'Var3'], 'rows': [[None, '1', '2', '3'], [None, '2', '1', '5'], [None, '3', '2', '7'], [None, '4', '1', '9'], [None, '5', '2', '11'], [None, '6', '1', '13']], 'extra': {}}, 'qa_xy': {'type': 'xy', 'columns': ['Title', 'X', 'Y1', 'Y2'], 'rows': [[None, '1', '2', '1'], [None, '2', '4', '3'], [None, '3', '6', '2'], [None, '4', '8', '5'], [None, '5', '10', '4']], 'extra': {}}, 'rocTable': {'type': 'multiple', 'columns': ['Title', 'Truth', 'Score'], 'rows': [[None, '1', '0.82'], [None, '0', '0.42'], [None, '1', '0.76'], [None, '0', '0.55'], [None, '1', '0.91'], [None, '0', '0.31'], [None, '1', '0.65'], [None, '0', '0.61'], [None, '1', '0.88'], [None, '0', '0.48'], [None, '1', '0.71'], [None, '0', '0.39'], [None, '1', '0.95'], [None, '0', '0.66'], [None, '1', '0.58'], [None, '0', '0.28'], [None, '1', '0.79'], [None, '0', '0.52'], [None, '1', '0.84'], [None, '0', '0.45']], 'extra': {}}, 'schild': {'type': 'xy', 'columns': ['Title', 'X', '0 M', '1e-8 M', '1e-7 M'], 'rows': [[None, '-8', '0.9900990099', '0.4975124378', '0.0908265213'], [None, '-7.5', '3.0653430032', '1.5565279621', '0.2866557101'], [None, '-7', '9.0909090909', '4.7619047619', '0.9009009009'], [None, '-6.5', '24.0253073352', '13.6527059496', '2.7944627181'], [None, '-6', '50', '33.3333333333', '8.3333333333'], [None, '-5.5', '75.9746926648', '61.2574113277', '22.3288777134'], [None, '-5', '90.9090909091', '83.3333333333', '47.619047619'], [None, '-4.5', '96.9346569968', '94.0516512848', '74.1922022049'], [None, '-4', '99.0099009901', '98.0392156863', '90.0900900901']], 'extra': {}}, 'simulated': {'type': 'column', 'columns': ['Title', 'Simulated 1'], 'rows': [['', '120.5643767'], ['', '91.52952743'], ['', '105.4469262'], ['', '109.4929391'], ['', '106.0640248'], ['', '98.40813226'], ['', '122.67283'], ['', '98.58011442'], ['', '130.2763557'], ['', '99.05928851'], ['', '119.5730448'], ['', '134.2996809'], ['', '79.16708948'], ['', '95.8181685'], ['', '98.00017995'], ['', '109.539256'], ['', '95.73620618'], ['', '60.15316869'], ['', '63.39299607'], ['', '119.8017002']], 'extra': {}}, 'sparse': {'type': 'column', 'columns': ['Title', 'A', 'B', 'C'], 'rows': [[None, '1', None, '5'], [None, '2', None, '5'], [None, '0', None, '5'], [None, '4', '3', '5']], 'extra': {}}, 'survival3': {'type': 'survival', 'columns': ['Title', 'Days', 'A', 'B', 'C'], 'rows': [[None, '5', '1', None, None], [None, '8', '1', None, None], [None, '12', '1', None, None], [None, '15', '0', None, None], [None, '20', '1', None, None], [None, '22', '1', None, None], [None, '30', '0', None, None], [None, '31', '1', None, None], [None, '3', None, '1', None], [None, '4', None, '1', None], [None, '6', None, '1', None], [None, '7', None, '1', None], [None, '9', None, '0', None], [None, '10', None, '1', None], [None, '14', None, '1', None], [None, '18', None, '1', None], [None, '12', None, None, '1'], [None, '18', None, None, '0'], [None, '24', None, None, '1'], [None, '30', None, None, '0'], [None, '36', None, None, '1'], [None, '40', None, None, '0'], [None, '45', None, None, '0'], [None, '50', None, None, '1']], 'extra': {}}, 'survivalTable': {'type': 'survival', 'columns': ['Title', 'Days', 'Treated', 'Placebo'], 'rows': [[None, '3', '1', None], [None, '5', None, '1'], [None, '7', '0', '1'], [None, '8', None, '1'], [None, '10', '1', None], [None, '12', None, '0'], [None, '15', '1', '1'], [None, '20', '0', None]], 'extra': {}}, 'twoGroups': {'type': 'grouped', 'columns': ['Title', 'A:Y1', 'A:Y2', 'A:Y3', 'B:Y1', 'B:Y2', 'B:Y3'], 'rows': [['Gene 1', '10', '11', '12', '20', '22', '21'], ['Gene 2', '5', '6', '5.5', '5.2', '6.1', '5.8'], ['Gene 3', '8', '9', '8.5', '4', '4.5', '3.9'], ['Gene 4', '30', '28', '31', '33', None, '32'], ['Gene 5', '2', '2.2', '1.9', '6', '6.5', '7']], 'extra': {'groups': 2, 'replicates': 3}}, 'xy': {'type': 'xy', 'columns': ['Title', 'X', 'Y1', 'Y2', 'Y3'], 'rows': [[None, '0', '1.1', '2', '5'], [None, '1', '2.9', None, '4.1'], [None, '2', '5.2', '6.1', '3.2'], [None, '3', '6.8', '8.2', None], [None, '4', '9.1', '9.7', '1.9'], [None, '5', '11.2', '12.4', '1.1'], [None, '6', '12.7', None, '0.4'], [None, None, '15', '15', '15'], [None, '8', '17.3', '18.1', '-0.8']], 'extra': {}}, 'xyReps': {'type': 'xy', 'columns': ['Title', 'X', 'A:Y1', 'A:Y2', 'A:Y3', 'B:Y1', 'B:Y2', 'B:Y3'], 'rows': [[None, '0', '1.1', '1.4', '0.8', '5', '5.6', '4.4'], [None, '1', '2.9', '3.3', None, '4.1', '3.9', '4.6'], [None, '2', '5.2', '4.8', '5.5', '3.2', None, '2.7'], [None, '3', '6.8', '7.4', '6.1', None, None, None], [None, '4', '9.1', '8.6', '9.9', '1.9', '2.4', '1.5'], [None, None, '6', '6.4', '5.8', None, None, None]], 'extra': {'groups': 2, 'replicates': 3}}, 'mixedBalanced': {'type': 'multiple', 'columns': ['Title', 'T0', 'T1', 'T2', 'T3'], 'rows': [[None, '9.7045', '11.5133', '12.2417', '13.8187'], [None, '12.5892', '13.0329', '15.6618', '16.8125'], [None, '8.9771', '9.9979', '11.5858', '13.3258'], [None, '14.2309', '16.3722', '17.4250', '19.5062'], [None, '16.8885', '18.9439', '19.7039', '21.1721'], [None, '13.6587', '15.4921', '16.7787', '18.6763']], 'extra': {}}, 'mcPower': {'type': 'column', 'columns': ['Title', 'A', 'B'], 'rows': [[None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5'], [None, '-1.5', '-1.0'], [None, '-1', '-0.5'], [None, '-0.5', '0.0'], [None, '0', '0.5'], [None, '0.5', '1.0'], [None, '1', '1.5'], [None, '1.5', '2.0'], [None, '0', '0.5']], 'extra': {}}}



# Fixture adjustments (applied after the generated FIXTURES literal):
# - qa_col_abc: the QA log's Q-11..Q-14 values predate the D column (added
#   later for ROUT); the A/B/C-only table reproduces them exactly.
# - rocTable is a 2-data-column table: roc-curve is offered for column
#   tables, not multiple tables (MCP error verified live).
FIXTURES["qa_col_abc"] = {
    "type": "column",
    "columns": ["Title", "A", "B", "C"],
    "rows": [[None, "1", "2", "5"], [None, "2", "4", "5"], [None, "3", "6", "6"],
             [None, "4", "8", "6"], [None, "5", "10", "7"]],
    "extra": {},
}
FIXTURES["rocTable"]["type"] = "column"
# - mixedBalanced is a Column table for mixed-effects (the MCP gate offers
#   mixed-effects for column tables, not multiple tables; MixedEffectsParams
#   says the subject factor is "Column tables: one level per subject row").
FIXTURES["mixedBalanced"]["type"] = "column"
# - nested2: the 2-group nested table (nested-t-test via MCP is gated on the
#   table having exactly 2 groups — the `sets` param on a 3-group table is
#   rejected by the dispatch gate before params are read, so the reference
#   nested3-sets run is unreachable via MCP; see c_t28_nested).
FIXTURES["nested2"] = {
    "type": "nested",
    "columns": ["Title",
                "Control:S1:R1", "Control:S1:R2", "Control:S1:R3",
                "Control:S2:R1", "Control:S2:R2", "Control:S2:R3",
                "Control:S3:R1", "Control:S3:R2", "Control:S3:R3",
                "Treated:S1:R1", "Treated:S1:R2", "Treated:S1:R3",
                "Treated:S2:R1", "Treated:S2:R2", "Treated:S2:R3",
                "Treated:S3:R1", "Treated:S3:R2", "Treated:S3:R3"],
    "rows": [[None, "10", "11", "12", "13", "12", "14", "11", "10", "12",
              "16", "15", "17", "18", "17", "16", "15", "16", "17"]],
    "extra": {"groups": 2, "subgroups": 3, "replicates": 3},
}

# ---------------------------------------------------------------------------
# QA family — QA datasets vs scipy values (QA-LOG.md, QA-LOG-LINUX.md).
# QA-log pins are quoted to 4-5 significant digits: rel tolerance 2e-3
# (4e-3 for p-values).
# ---------------------------------------------------------------------------

def c_q04_descriptive(suite):
    """Q-04 descriptive statistics vs scipy (QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "descriptive-statistics", {})
        _check_group(r, "A", mean=3, sd=1.581, sem=0.7071, median=3, n=5,
                     ciLow=1.037, ciHigh=4.963, rel=2e-3)
        _check_group(r, "B", mean=6, sd=3.162, sem=1.414, median=6, n=5,
                     ciLow=2.074, ciHigh=9.926, rel=2e-3)
        _check_group(r, "C", mean=5.8, sd=0.8367, sem=0.3742, median=6, n=5,
                     ciLow=4.761, ciHigh=6.839, rel=2e-3)
        return "A/B/C means 3/6/5.8, SDs 1.581/3.162/0.8367, n=5 each"
    finally:
        suite.close(pid)


def c_q05_student_t(suite):
    """Q-05 unpaired Student t (A vs B, QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "compare-two-groups",
                 {"paired": False, "gaussian": True, "equalVariance": True,
                  "ratio": False, "tails": "two-sided"})
        _check_stat(r, "t", -1.897, rel=2e-3)
        _check_stat(r, "df", 8, rel=2e-3)
        _check_p(r, "P value", 0.09435, rel=4e-3)
        _check_stat(r, "Mean difference", -3, rel=2e-3)
        _check_stat(r, "95% CI lower", -6.646, rel=2e-3)
        _check_stat(r, "95% CI upper", 0.6461, rel=2e-3)
        _check_stat(r, "R squared", 0.3103, rel=2e-3)
        _check_stat(r, "F (variance ratio)", 0.25, rel=2e-3)
        _check_stat(r, "F DFn", 4, rel=2e-3)
        _check_stat(r, "F DFd", 4, rel=2e-3)
        _check_p(r, "F test P value", 0.208, rel=4e-3)
        return "Student t=-1.897 df=8 P=0.09435, diff -3, R2=0.3103"
    finally:
        suite.close(pid)


def c_q06_welch_t(suite):
    """Q-06 Welch t (A vs B, QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "compare-two-groups",
                 {"paired": False, "gaussian": True, "equalVariance": False,
                  "ratio": False, "tails": "two-sided"})
        _check_stat(r, "t", -1.897, rel=2e-3)
        _check_stat(r, "df", 5.882, rel=2e-3)
        _check_p(r, "P value", 0.1075, rel=4e-3)
        _check_stat(r, "Mean difference", -3, rel=2e-3)
        _check_stat(r, "95% CI lower", -6.888, rel=2e-3)
        _check_stat(r, "95% CI upper", 0.8877, rel=2e-3)
        _check_stat(r, "R squared", 0.3797, rel=2e-3)
        return "Welch t=-1.897 df=5.882 P=0.1075, diff -3, R2=0.3797"
    finally:
        suite.close(pid)


def c_q07_mann_whitney(suite):
    """Q-07 Mann-Whitney exact P (A vs B, QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "compare-two-groups",
                 {"paired": False, "gaussian": False,
                  "ratio": False, "tails": "two-sided"})
        _check_stat(r, "Test statistic", 5, rel=2e-3)
        # Exact permutation P 0.1429; scipy's asymptotic 0.1412 is NOT the pin.
        _check_p(r, "P value", 0.1429, rel=4e-3)
        _check_stat(r, "Sum of ranks (A)", 20, rel=2e-3)
        _check_stat(r, "Sum of ranks (B)", 35, rel=2e-3)
        _check_stat(r, "Median difference", -3, rel=2e-3)
        _check_stat(r, "Hodges-Lehmann difference", -3, rel=2e-3)
        return "Mann-Whitney U=5, exact P=0.1429, rank sums 20/35, HL -3"
    finally:
        suite.close(pid)


def c_q08_paired_t(suite):
    """Q-08 paired t (A vs B, QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "compare-two-groups",
                 {"paired": True, "gaussian": True,
                  "ratio": False, "tails": "two-sided"})
        _check_stat(r, "t", -4.243, rel=2e-3)
        _check_stat(r, "df", 4, rel=2e-3)
        _check_p(r, "P value", 0.01324, rel=4e-3)
        _check_stat(r, "Mean of differences", -3, rel=2e-3)
        _check_stat(r, "95% CI lower", -4.963, rel=2e-3)
        _check_stat(r, "95% CI upper", -1.037, rel=2e-3)
        _check_stat(r, "R squared", 0.8182, rel=2e-3)
        return "paired t=-4.243 df=4 P=0.01324, diff -3, R2=0.8182"
    finally:
        suite.close(pid)


def c_q09_wilcoxon(suite):
    """Q-09 Wilcoxon signed-rank (A vs B, QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "compare-two-groups",
                 {"paired": True, "gaussian": False,
                  "ratio": False, "tails": "two-sided"})
        _check_stat(r, "Test statistic", 0, rel=2e-3)
        _check_p(r, "P value", 0.0625, rel=4e-3)
        _check_stat(r, "Median difference", -3, rel=2e-3)
        _check_stat(r, "Hodges-Lehmann difference", -3, rel=2e-3)
        return "Wilcoxon W=0, P=0.0625, median diff -3, HL -3"
    finally:
        suite.close(pid)


def c_q10_one_sample_t(suite):
    """Q-10 one-sample t, A vs hypothetical 3 (QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "one-sample-t",
                 {"hypotheticalValue": 3, "tails": "two-sided", "gaussian": True})
        _check_stat(r, "A — t", 0, rel=2e-3, abs_tol=1e-9)
        _check_stat(r, "A — df", 4, rel=2e-3)
        _check_p(r, "A — P value", 1, rel=4e-3)
        _check_stat(r, "A — Mean vs. hypothetical", 0,
                    rel=2e-3, abs_tol=1e-9)
        _check_stat(r, "A — 95% CI lower", 1.037, rel=2e-3)
        _check_stat(r, "A — 95% CI upper", 4.963, rel=2e-3)
        return "one-sample t=0 df=4 P=1, diff 0, CI 1.037-4.963"
    finally:
        suite.close(pid)


def c_q11_anova_eta2(suite):
    """Q-11 one-way ANOVA + eta^2 (QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col_abc")
        r = _run(suite, pid, tid, "anova", {"posthoc": "none"})
        _check_stat(r, "F", 3.197, rel=2e-3)
        _check_stat(r, "DFn", 2, rel=2e-3)
        _check_stat(r, "DFd", 12, rel=2e-3)
        _check_p(r, "P value", 0.0771, rel=4e-3)
        _check_stat(r, "R squared (eta squared)", 0.3476, rel=2e-3)
        return "ANOVA F=3.197 (2,12) P=0.0771, eta2=0.3476"
    finally:
        suite.close(pid)


def c_q12_kruskal_wallis(suite):
    """Q-12 Kruskal-Wallis (QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col_abc")
        r = _run(suite, pid, tid, "kruskal-wallis", {"posthoc": "none"})
        _check_stat(r, "Kruskal-Wallis H", 5.559, rel=2e-3)
        _check_stat(r, "df", 2, rel=2e-3)
        _check_p(r, "P value", 0.06206, rel=4e-3)
        return "Kruskal-Wallis H=5.559 df=2 P=0.06206"
    finally:
        suite.close(pid)


def c_q13_rm_anova(suite):
    """Q-13 RM ANOVA vs hand-computed SS (QA datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col_abc")
        r = _run(suite, pid, tid, "rm-anova", {"posthoc": "none"})
        _check_stat(r, "F", 9.483, rel=2e-3)
        _check_stat(r, "DFn", 2, rel=2e-3)
        _check_stat(r, "DFd", 8, rel=2e-3)
        _check_p(r, "P value", 0.007746, rel=4e-3)
        _check_stat(r, "R squared (eta squared)", 0.3476, rel=2e-3)
        # Hand-computed sums of squares (QA log, recomputed from the data):
        # SS_treat 28.133, SS_subject 40.933, SS_error 11.867 — the MCP
        # result does not surface SS values, so they are not pinned here.
        return "RM ANOVA F=9.483 (2,8) P=0.007746, SS 28.133/40.933/11.867"
    finally:
        suite.close(pid)


def c_q14_friedman(suite):
    """Q-14 Friedman (QA datasets).

    The QA log's Q=7.895 is A/B/C only (D was added later for ROUT); the
    MCP run on the 4-column table gives Q=13.636 (tie-corrected, hand-verified
    from the rank sums 7.5/17.5/17.5/7.5). Both are pinned here.
    """
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col_abc")
        r = _run(suite, pid, tid, "friedman", {"posthoc": "none"})
        _check_stat(r, "Friedman statistic (Q)", 7.895, rel=2e-3)
        _check_stat(r, "df", 2, rel=2e-3)
        _check_p(r, "P value", 0.01931, rel=4e-3)
        tid2 = _make_table(suite, pid, "qa_col")
        r2 = _run(suite, pid, tid2, "friedman", {"posthoc": "none"})
        _check_stat(r2, "Friedman statistic (Q)", 13.6364, rel=2e-3)
        _check_stat(r2, "df", 3, rel=2e-3)
        _check_p(r2, "P value", 0.00344433, rel=4e-3)
        return "Friedman A/B/C Q=7.895 df=2 P=0.01931; 4-group Q=13.636 df=3 P=0.00344"
    finally:
        suite.close(pid)


def c_q18_rout(suite):
    """Q-18 ROUT Q=1% on QA datasets (D holds the 100 outlier)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_col")
        r = _run(suite, pid, tid, "outliers", {"q": 1})
        _check_stat(r, "Total observations", 25, rel=1e-6)
        _check_stat(r, "Groups analyzed", 4, rel=1e-6)
        _check_stat(r, "Outliers detected", 1, rel=1e-6)
        _check_stat(r, "Outlier percentage (%)", 4, rel=1e-6)
        _check_stat(r, "Q parameter (%)", 1, rel=1e-6)
        og = {o["group"]: o for o in r.get("outlierGroups", [])}
        assert og["D"]["outliers"] == _E(1), f"D outliers: {og['D']}"
        assert _close(og["D"]["robustMean"], 5.554, rel=2e-3), (
            f"D robust mean: {og['D']['robustMean']}")
        assert _close(og["A"]["robustMean"], 3, rel=2e-3)
        assert _close(og["B"]["robustMean"], 6, rel=2e-3)
        assert _close(og["C"]["robustMean"], 5.8, rel=2e-3)
        notes = r.get("notes", "")
        assert "D row 10 (value 100" in notes, f"ROUT notes missing D row 10: {notes!r}"
        return "ROUT Q=1%: 1/25 outliers (D row 10, value 100), robust means 3/6/5.8/5.554"
    finally:
        suite.close(pid)


def c_q25_pearson(suite):
    """Q-25 Pearson correlation (QA XY datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_xy")
        r = _run(suite, pid, tid, "correlation",
                 {"method": "pearson", "mode": "x-vs-every-y"})
        cors = {c["variable"]: c for c in r.get("correlations", [])}
        assert _close(cors["Y1"]["r"], 1, rel=2e-3), f"Y1 r: {cors['Y1']}"
        assert cors["Y1"]["p"] < 0.0001, f"Y1 p: {cors['Y1']}"
        assert _close(cors["Y2"]["r"], 0.8, rel=2e-3), f"Y2 r: {cors['Y2']}"
        assert _close(cors["Y2"]["p"], 0.1041, rel=4e-3, abs_tol=1e-9), (
            f"Y2 p: {cors['Y2']}")
        return "Pearson Y1 r=1 P<0.0001, Y2 r=0.8 P=0.1041"
    finally:
        suite.close(pid)


def c_q26_spearman(suite):
    """Q-26 Spearman exact P (QA XY datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_xy")
        r = _run(suite, pid, tid, "correlation",
                 {"method": "spearman", "mode": "x-vs-every-y"})
        cors = {c["variable"]: c for c in r.get("correlations", [])}
        assert _close(cors["Y1"]["r"], 1, rel=2e-3), f"Y1 rho: {cors['Y1']}"
        # Exact permutation P 0.01667; scipy's asymptotic 1.4e-24 is NOT the pin.
        assert _close(cors["Y1"]["p"], 0.01667, rel=4e-3, abs_tol=1e-9), (
            f"Y1 p: {cors['Y1']}")
        assert _close(cors["Y2"]["r"], 0.8, rel=2e-3), f"Y2 rho: {cors['Y2']}"
        assert _close(cors["Y2"]["p"], 0.1333, rel=4e-3, abs_tol=1e-9), (
            f"Y2 p: {cors['Y2']}")
        return "Spearman Y1 rho=1 P=0.01667, Y2 rho=0.8 P=0.1333 (exact)"
    finally:
        suite.close(pid)


def c_q27_linreg_y1(suite):
    """Q-27 linear regression Y1 on X (QA XY datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_xy")
        r = _run(suite, pid, tid, "linear-regression",
                 {"y": "Y1", "forceOrigin": False})
        _check_stat(r, "Slope", 2, rel=2e-3)
        _check_stat(r, "Slope 95% CI lower", 2, rel=2e-3)
        _check_stat(r, "Slope 95% CI upper", 2, rel=2e-3)
        # Intercept renders -1.589e-15, not 0: pin |intercept| < 1e-12.
        assert abs(_stat(r, "Y-intercept")) < 1e-12, f"intercept: {_stat(r, 'Y-intercept')}"
        _check_stat(r, "R squared", 1, rel=2e-3)
        assert _stat(r, "P value (slope \u2260 0)") < 0.0001, (
            f"P: {_stat(r, 'P value (slope \u2260 0)')}")
        assert r.get("equation", "").startswith("Y = 2*X"), (
            f"equation: {r.get('equation')!r}")
        return "linreg Y1: Y = 2*X - 1.589e-15, slope 2, R2=1, P<0.0001"
    finally:
        suite.close(pid)


def c_q28_linreg_y2(suite):
    """Q-28 linear regression Y2 on X (QA XY datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_xy")
        r = _run(suite, pid, tid, "linear-regression",
                 {"y": "Y2", "forceOrigin": False})
        _check_stat(r, "Slope", 0.8, rel=2e-3)
        _check_stat(r, "Slope 95% CI lower", -0.3024, rel=2e-3)
        _check_stat(r, "Slope 95% CI upper", 1.902, rel=2e-3)
        _check_stat(r, "Y-intercept", 0.6, rel=2e-3)
        _check_stat(r, "Intercept 95% CI lower", -3.056, rel=2e-3)
        _check_stat(r, "Intercept 95% CI upper", 4.256, rel=2e-3)
        _check_stat(r, "R squared", 0.64, rel=2e-3)
        _check_p(r, "P value (slope \u2260 0)", 0.1041, rel=4e-3)
        return "linreg Y2: Y = 0.8*X + 0.6, slope 0.8, R2=0.64, P=0.1041"
    finally:
        suite.close(pid)


def c_q29_auc(suite):
    """Q-29 area under curve, baseline 0 (QA XY datasets)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_xy")
        r = _run(suite, pid, tid, "area-under-curve", {"baseline": 0})
        areas = {a["variable"]: a for a in r.get("areas", [])}
        assert _close(areas["Y1"]["area"], 24, rel=2e-3), f"Y1 area: {areas['Y1']}"
        assert _close(areas["Y2"]["area"], 12.5, rel=2e-3), f"Y2 area: {areas['Y2']}"
        return "AUC baseline 0: Y1=24, Y2=12.5 (exact trapezoid)"
    finally:
        suite.close(pid)


def c_q30_4pl_doselog(suite):
    """Q-30 4PL nonlinear vs reference.json (doseLog)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseLog")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "sigmoidal-4pl-logx"})
        _check_fit(r, "EC50", 0.143886, rel=1e-4)
        _check_fit(r, "Span", 97.9639, rel=1e-4)
        _check_fit(r, "R squared", 0.999922, rel=1e-4)
        _check_fit(r, "Sy.x", 0.447473, rel=1e-4)
        _check_fit(r, "Sum of squares", 1.20139, rel=1e-4)
        _check_fit(r, "Degrees of freedom", 6, rel=1e-6)
        _check_fit(r, "N", 10, rel=1e-6)
        _check_coef(r, "Bottom", estimate=1.27831, p=0.011671)
        _check_coef(r, "Top", estimate=99.2422)
        _check_coef(r, "LogEC50", estimate=-0.841981)
        _check_coef(r, "Hill slope", estimate=0.9769513568)
        return "4PL doseLog: EC50 0.1439, Span 97.96, R2 0.9999, Sy.x 0.4475"
    finally:
        suite.close(pid)


def c_q36_twoway_grouped(suite):
    """Q-36 two-way ANOVA, grouped table with a blank (C n=14)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "grouped")
        r = _run(suite, pid, tid, "two-way-anova",
                 {"design": "ordinary", "posthoc": "none", "posthocTarget": "groups"})
        _check_stat(r, "Group F", 337.357, rel=2e-3)
        _check_stat(r, "Group DFn", 2, rel=2e-3)
        _check_stat(r, "Row F", 120.804, rel=2e-3)
        _check_stat(r, "Row DFn", 4, rel=2e-3)
        _check_stat(r, "Interaction F", 17.6411, rel=2e-3)
        _check_stat(r, "Interaction DFn", 8, rel=2e-3)
        _check_stat(r, "DFd (residual)", 29, rel=2e-3)
        assert _stat(r, "Group P value") < 0.0001
        assert _stat(r, "Row P value") < 0.0001
        assert _stat(r, "Interaction P value") < 0.0001
        # Blank cell correctly excluded: C has n=14, not 15.
        _check_group(r, "A", mean=15.6, sd=3.776, sem=0.9749, median=15, n=15, rel=2e-3)
        _check_group(r, "B", mean=22.53, sd=6.479, sem=1.673, median=22, n=15, rel=2e-3)
        _check_group(r, "C", mean=12, sd=1.664, sem=0.4447, median=12, n=14, rel=2e-3)
        return "two-way ANOVA: Group F 337.4, Row F 120.8, Int F 17.64, DFd 29; C n=14"
    finally:
        suite.close(pid)


def c_q64_chisq_yates(suite):
    """Q-64 chi-square [[10,20],[30,40]]: Yates vs uncorrected spec."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_chisq")
        r = _run(suite, pid, tid, "chi-square", {})
        _check_p(r, "P value (Fisher's exact test)", 0.5045, rel=4e-3)
        _check_stat(r, "Odds ratio (conditional estimate)", 0.6693, rel=2e-3)
        _check_stat(r, "Odds ratio 95% CI lower", 0.242, rel=2e-3)
        _check_stat(r, "Odds ratio 95% CI upper", 1.764, rel=2e-3)
        # Post-fix spec: the chi-square shown "for reference" is the
        # UNCORRECTED value 0.7937 (p 0.3730). The pre-fix build showed the
        # Yates-corrected 0.4464 (p 0.5040) — that value must NOT appear.
        _check_stat(r, "Chi-square (for reference)", 0.7937, rel=2e-3)
        assert abs(_stat(r, "Chi-square (for reference)") - 0.4464) > 0.1, (
            "chi-square still shows the Yates-corrected 0.4464")
        _check_stat(r, "df", 1, rel=1e-6)
        assert "N = 100" in r.get("notes", ""), f"notes: {r.get('notes')!r}"
        return "chi-square: Fisher P 0.5045, OR 0.6693, uncorrected chi2 0.7937 (not Yates 0.4464)"
    finally:
        suite.close(pid)


def c_q65_multireg(suite):
    """Q-65 multiple regression y~Var1+Var2 (QA-LOG-LINUX T-multreg)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "qa_multireg")
        r = _run(suite, pid, tid, "multiple-regression",
                 {"dependent": "Var3", "predictors": ["Var1", "Var2"]})
        _check_coef(r, "Intercept", estimate=1)
        _check_coef(r, "Var1", estimate=2)
        c = _coef(r, "Var2")
        assert abs(c["estimate"]) < 1e-9, f"Var2 coef: {c['estimate']}"
        _check_stat(r, "R squared", 1, rel=2e-3)
        _check_stat(r, "Adjusted R squared", 1, rel=2e-3)
        _check_stat(r, "F", 4.03e31, rel=1e-2)
        assert _stat(r, "P value (model)") < 0.0001
        return "multireg: y = 1 + 2*Var1 + 0*Var2, R2=1, F=4.03e31"
    finally:
        suite.close(pid)

# ---------------------------------------------------------------------------
# Reference family — tests/reference.json pins (full precision, rel 1e-6
# for stats, 1e-3 for p-values, 1e-4 for fitted/optimised values).
# ---------------------------------------------------------------------------

def _stats_all(res, label):
    return [s["value"] for s in res.get("stats", []) if s["label"] == label]


def _interp(res, label):
    for it in res.get("interpolated", []):
        if it.get("label") == label:
            return it
    raise AssertionError(
        f"interpolated {label!r} missing (have "
        f"{[i.get('label') for i in res.get('interpolated', [])]})")


def _check_interp(res, label, y=None, x=None, conc=None, low=None, high=None):
    it = _interp(res, label)
    if y is not None:
        assert _close(it.get("y"), y, rel=1e-6), f"{label} y: {it}"
    if x is not None:
        assert _close(it.get("x"), x, rel=1e-4), f"{label} x: {it}"
    if conc is not None:
        assert _close(it.get("concentration"), conc, rel=1e-4), f"{label} conc: {it}"
    if low is not None:
        assert _close(it.get("low"), low, rel=1e-4), f"{label} low: {it}"
    if high is not None:
        assert _close(it.get("high"), high, rel=1e-4), f"{label} high: {it}"
    return it


def _check_hr(res, comparison, ratio=None, low=None, high=None, p=None, rel=1e-4):
    for h in res.get("hazardRatios", []):
        if h.get("comparison") == comparison:
            if ratio is not None:
                assert _close(h.get("ratio"), ratio, rel=rel), f"{comparison} HR: {h}"
            if low is not None:
                assert _close(h.get("low"), low, rel=rel), f"{comparison} low: {h}"
            if high is not None:
                assert _close(h.get("high"), high, rel=rel), f"{comparison} high: {h}"
            if p is not None:
                assert _close(h.get("p"), p, rel=1e-3, abs_tol=1e-9), f"{comparison} p: {h}"
            return h
    raise AssertionError(
        f"hazard ratio {comparison!r} missing (have "
        f"{[h.get('comparison') for h in res.get('hazardRatios', [])]})")


def _surv_group(res, name):
    for g in res.get("survivalGroups", []):
        if g.get("group") == name:
            return g
    raise AssertionError(
        f"survival group {name!r} missing (have "
        f"{[g.get('group') for g in res.get('survivalGroups', [])]})")


def c_q37_mv_descriptive(suite):
    """Q-37 MV table descriptive statistics (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "multiple")
        r = _run(suite, pid, tid, "descriptive-statistics", {})
        _check_group(r, "Weight", mean=76.3, sd=12.0097, sem=3.79781,
                     median=73.5, n=10, ciLow=67.7088, ciHigh=84.8912)
        _check_group(r, "Height", mean=175.333, sd=8.86002, n=9)
        _check_group(r, "Age", mean=39.9, sd=9.837, n=10)
        _check_group(r, "Dose", mean=1.9, sd=0.875595, n=10)
        return "MV descriptives: Weight 76.3/12.01, Height 175.33, Age 39.9, Dose 1.9"
    finally:
        suite.close(pid)


def c_q37_contingency(suite):
    """Q-37 contingency table chi-square (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "contingency2")
        r = _run(suite, pid, tid, "chi-square", {})
        _check_p(r, "P value (Fisher's exact test)", 0.0103867)
        _check_stat(r, "Odds ratio (conditional estimate)", 6.61472)
        _check_stat(r, "Odds ratio 95% CI lower", 1.45712)
        _check_stat(r, "Odds ratio 95% CI upper", 35.7378)
        _check_stat(r, "Relative risk (Outcome A)", 2.5)
        _check_stat(r, "Relative risk 95% CI lower", 1.22215)
        _check_stat(r, "Relative risk 95% CI upper", 5.11393)
        _check_stat(r, "Phi", 0.450564)
        _check_stat(r, "Chi-square (for reference)", 8.1203)
        _check_stat(r, "df", 1)
        assert "N = 40" in r.get("notes", ""), f"notes: {r.get('notes')!r}"
        return "contingency2: Fisher P 0.01039, OR 6.615, chi2 8.12, df 1, N 40"
    finally:
        suite.close(pid)


def c_q37_survival(suite):
    """Q-37 survival spot-check, log-rank Holm (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "survival3")
        r = _run(suite, pid, tid, "survival",
                 {"curveTest": "logrank", "correction": "holm"})
        _check_stat(r, "Chi-square", 15.9483)
        _check_stat(r, "df", 2)
        _check_p(r, "P value", 0.000344254)
        g = _surv_group(r, "A")
        assert (g["subjects"], g["events"], g["median"]) == (8, 6, 20), f"A: {g}"
        g = _surv_group(r, "B")
        assert (g["subjects"], g["events"], g["median"]) == (8, 7, 8.5), f"B: {g}"
        g = _surv_group(r, "C")
        assert (g["subjects"], g["events"], g["median"]) == (8, 4, 50), f"C: {g}"
        _check_comp(r, "A", "B", diff=0.341804, p=0.0482061)
        _check_comp(r, "A", "C", diff=3.48812, p=0.0482061)
        _check_comp(r, "B", "C", diff=5.65441, p=0.00164466)
        return "survival3 log-rank: chi2 15.95 df 2 P 0.000344; medians 20/8.5/50"
    finally:
        suite.close(pid)


def c_q37_corr_matrix(suite):
    """Q-37 correlation matrix, Pearson (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "multiple")
        r = _run(suite, pid, tid, "correlation-matrix", {"method": "pearson"})
        m = r["matrix"]
        assert m["variables"] == ["Weight", "Height", "Age", "Dose"], m["variables"]
        assert _close(m["r"][0][1], 0.956009), f"Weight-Height r: {m['r'][0][1]}"
        assert _close(m["r"][0][2], 0.984052), f"Weight-Age r: {m['r'][0][2]}"
        assert _close(m["r"][1][2], 0.932009), f"Height-Age r: {m['r'][1][2]}"
        assert _close(m["r"][0][3], 0.933001), f"Weight-Dose r: {m['r'][0][3]}"
        assert _close(m["p"][0][1], 5.63107e-05, rel=1e-3, abs_tol=1e-9)
        assert _close(m["p"][0][2], 2.77637e-07, rel=1e-3, abs_tol=1e-9)
        return "corr matrix: Weight-Height 0.956, Weight-Age 0.984, Height-Age 0.932"
    finally:
        suite.close(pid)


def c_q41_tukey(suite):
    """Q-41 Tukey multiple comparisons (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "anova", {"posthoc": "tukey"})
        _check_stat(r, "F", 4.85788)
        _check_stat(r, "DFn", 3)
        _check_stat(r, "DFd", 21)
        _check_p(r, "P value", 0.0101359)
        _check_comp(r, "Control", "Low", diff=-0.505357, p=0.99374)
        _check_comp(r, "Control", "High", diff=-5.27917, p=0.0745742)
        _check_comp(r, "High", "Sparse", diff=8.99167, p=0.00685542)
        return "Tukey: High-Sparse diff 8.992 p 0.00686, Control-Low p 0.99374"
    finally:
        suite.close(pid)


def c_q41_bonferroni(suite):
    """Q-41 Bonferroni multiple comparisons (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "anova", {"posthoc": "bonferroni"})
        _check_comp(r, "High", "Sparse", diff=8.99167, p=0.00813688)
        _check_comp(r, "Control", "Low", diff=-0.505357, p=1)
        return "Bonferroni: High-Sparse p 0.00814, Control-Low p 1"
    finally:
        suite.close(pid)


def c_q41_dunn(suite):
    """Q-41 Dunn's multiple comparisons after Kruskal-Wallis."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "kruskal-wallis", {"posthoc": "dunn"})
        _check_stat(r, "Kruskal-Wallis H", 16.8669)
        _check_stat(r, "df", 3)
        _check_p(r, "P value", 0.000752705)
        _check_comp(r, "High", "Sparse", diff=8.99167, p=0.000907929)
        _check_comp(r, "Control", "High", diff=-5.27917, p=0.01687)
        return "Dunn: H 16.867 df 3 P 0.000753; High-Sparse p 0.000908"
    finally:
        suite.close(pid)


def c_q41_rm_twoway(suite):
    """Q-41 RM two-way ANOVA, Sidak, sphericity false (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "grouped")
        r = _run(suite, pid, tid, "two-way-anova",
                 {"design": "repeated-measures", "posthoc": "sidak",
                  "posthocTarget": "groups", "sphericity": False})
        _check_stat(r, "Group F", 152.4)
        _check_stat(r, "Group DFn", 2)
        _check_p(r, "Group P value", 3.30921e-05)
        _check_stat(r, "Row F", 146.84)
        _check_stat(r, "Row DFn", 1.57892)
        _check_stat(r, "Row DFd", 7.89459)
        _check_p(r, "Row P value", 8.82942e-07)
        _check_stat(r, "Interaction F", 16.9039)
        _check_stat(r, "Interaction DFn", 3.15784)
        _check_p(r, "Interaction P value", 0.000796393)
        _check_stat(r, "Geisser-Greenhouse epsilon", 0.39473)
        return "RM two-way Sidak: Group F 152.4, Row F 146.84, Int F 16.90, GG 0.3947"
    finally:
        suite.close(pid)


def c_q41_scheirer_ray_hare(suite):
    """Q-41 Scheirer-Ray-Hare nonparametric two-way ANOVA."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "grouped")
        r = _run(suite, pid, tid, "two-way-anova",
                 {"design": "nonparametric", "posthoc": "none",
                  "posthocTarget": "groups"})
        _check_stat(r, "Group H", 22.7207)
        _check_stat(r, "Group DFn", 2)
        _check_p(r, "Group P value", 1.16486e-05)
        _check_stat(r, "Row H", 16.9987)
        _check_stat(r, "Row DFn", 4)
        _check_p(r, "Row P value", 0.00193405)
        _check_stat(r, "Interaction H", 1.14606)
        _check_stat(r, "Interaction DFn", 8)
        _check_p(r, "Interaction P value", 0.997147)
        return "Scheirer-Ray-Hare: Group H 22.72, Row H 17.00, Int H 1.15"
    finally:
        suite.close(pid)


def c_q41_multiple_t(suite):
    """Q-41 multiple t tests, Holm (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "twoGroups")
        r = _run(suite, pid, tid, "multiple-t-tests",
                 {"paired": False, "gaussian": True, "pooledSd": False,
                  "correction": "holm"})
        _check_stat(r, "Rows compared", 5)
        _check_stat(r, "Significant rows (P < 0.05)", 3)
        _check_comp(r, "Gene 1", "", diff=-10, p=0.00127608)
        _check_comp(r, "Gene 2", "", diff=-0.2, p=0.636613)
        _check_comp(r, "Gene 3", "", diff=4.36667, p=0.00215667)
        _check_comp(r, "Gene 4", "", diff=-2.83333, p=0.142003)
        _check_comp(r, "Gene 5", "", diff=-4.46667, p=0.00650689)
        return "multiple t (Holm): 5 rows, 3 significant; Gene1 p 0.00128, Gene3 p 0.00216"
    finally:
        suite.close(pid)


def c_t15_logistic(suite):
    """T-15 simple logistic regression (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "logistic")
        r = _run(suite, pid, tid, "simple-logistic-regression", {})
        _check_stat(r, "Odds ratio (per 1 unit X)", 3.67531)
        _check_stat(r, "Odds ratio 95% CI lower", 0.708413)
        _check_stat(r, "Odds ratio 95% CI upper", 19.0679)
        _check_stat(r, "Slope 95% CI lower", -0.344728)
        _check_stat(r, "Slope 95% CI upper", 2.948)
        _check_stat(r, "Null deviance", 13.8629)
        _check_stat(r, "Null deviance DF", 9)
        _check_stat(r, "Residual deviance", 5.01802)
        _check_stat(r, "Residual deviance DF", 8)
        _check_stat(r, "McFadden pseudo-R²", 0.638027)
        _check_stat(r, "AIC", 9.01802)
        _check_stat(r, "N", 10)
        _check_coef(r, "Intercept", estimate=-5.85737)
        _check_coef(r, "X", estimate=1.30164, p=0.121237)
        return "simple logistic: OR 3.675, slope 1.302 (P 0.121), McFadden 0.638"
    finally:
        suite.close(pid)


def c_t16_interpolate(suite):
    """T-16 4PL fit + interpolation of unknowns (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseReps")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "sigmoidal-4pl-logx", "interpolate": True})
        _check_fit(r, "EC50", 0.143174)
        _check_fit(r, "Span", 98.4007)
        _check_fit(r, "R squared", 0.997425)
        _check_fit(r, "Sy.x", 2.17316)
        _check_fit(r, "Sum of squares", 108.62)
        _check_fit(r, "Degrees of freedom", 23)
        _check_fit(r, "N", 27)
        _check_interp(r, "Sample 1", y=50.3333, x=-0.848378, conc=0.141782,
                      low=-0.883946, high=-0.813258)
        _check_interp(r, "Sample 2", y=10.25, x=-1.87393, conc=0.0133682,
                      low=-1.95761, high=-1.79631)
        return "interpolate: EC50 0.1432; Sample 1 conc 0.1418, Sample 2 conc 0.01337"
    finally:
        suite.close(pid)


def c_t17_threeway(suite):
    """T-17 three-way ANOVA + Tukey A:B (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "grouped3way")
        r = _run(suite, pid, tid, "three-way-anova", {"posthoc": "none"})
        for label, f, p in [
                ("A", 126.676, 5.17696e-09), ("B", 211.267, 1.22408e-10),
                ("C", 34.4906, 2.35782e-05), ("A:B", 29.8974, 5.16035e-05),
                ("A:C", 2.77853, 0.114988), ("B:C", 95.8185, 3.69429e-08),
                ("A:B:C", 8.81097, 0.00905819)]:
            _check_stat(r, f"{label} F", f)
            _check_stat(r, f"{label} DFn", 1)
            _check_p(r, f"{label} P value", p)
        _check_stat(r, "DFd (residual)", 16)
        _check_group(r, "Placebo", mean=11.5873, n=12)
        _check_group(r, "Drug", mean=14.6293, n=12)
        r2 = _run(suite, pid, tid, "three-way-anova",
                  {"posthoc": "tukey", "posthocTerm": "A:B"})
        _check_comp(r2, "Placebo (Day 1)", "Placebo (Day 2)",
                    diff=-2.45069, p=4.63974e-05)
        return "three-way: A F 126.7, B F 211.3, A:B:C F 8.81, DFd 16; Tukey A:B pin"
    finally:
        suite.close(pid)


def c_t18_bland_altman(suite):
    """T-18 Bland-Altman, numeric only (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "blandAltman")
        r = _run(suite, pid, tid, "bland-altman",
                 {"sets": ["Method A", "Method B"]})
        _check_stat(r, "Bias (mean difference)", -0.36)
        _check_stat(r, "SD of differences", 0.250333)
        _check_stat(r, "Lower limit of agreement", -0.850653)
        _check_stat(r, "Upper limit of agreement", 0.130653)
        _check_stat(r, "Bias 95% CI lower", -0.539078)
        _check_stat(r, "Bias 95% CI upper", -0.180922)
        _check_stat(r, "N (pairs)", 10)
        return "Bland-Altman: bias -0.36, SD 0.2503, LoA [-0.851, 0.131], N 10"
    finally:
        suite.close(pid)


def c_t19_roc(suite):
    """T-19 ROC curve (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "rocTable")
        r = _run(suite, pid, tid, "roc-curve",
                 {"truth": "Truth", "score": "Score", "positive": 1})
        _check_stat(r, "AUC", 0.97)
        _check_stat(r, "AUC standard error", 0.0301846)
        _check_stat(r, "AUC 95% CI lower", 0.910838)
        _check_stat(r, "AUC 95% CI upper", 1)
        _check_stat(r, "Optimal cutpoint (Youden)", 0.71)
        _check_stat(r, "Sensitivity at cutpoint", 0.8)
        _check_stat(r, "Specificity at cutpoint", 1)
        _check_stat(r, "Youden's J", 0.8)
        _check_stat(r, "N positive", 10)
        _check_stat(r, "N negative", 10)
        return "ROC: AUC 0.97, CI [0.911, 1], cutpoint 0.71, sens 0.8, spec 1"
    finally:
        suite.close(pid)


def c_t20_freqdist(suite):
    """T-20 frequency distribution, auto bins (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "freqCol")
        r = _run(suite, pid, tid, "frequency-distribution",
                 {"binMode": "auto"})
        _check_stat(r, "Values — N", 10)
        _check_stat(r, "Values — Number of bins", 4)
        _check_stat(r, "Values — Bin width", 2)
        _check_stat(r, "Values — Minimum", 2.1)
        _check_stat(r, "Values — Maximum", 9.3)
        bins = r["frequencyBins"][0]["bins"]
        assert [b["count"] for b in bins] == [3, 3, 3, 1], f"bins: {bins}"
        return "freq dist: 4 bins of width 2, counts [3,3,3,1]"
    finally:
        suite.close(pid)


def c_t21_ks(suite):
    """T-21 Kolmogorov-Smirnov two-sample (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "ksShifted")
        r = _run(suite, pid, tid, "kolmogorov-smirnov", {})
        _check_stat(r, "KS distance D", 1)
        _check_p(r, "P value", 0.0001554)
        _check_stat(r, "N (group 1)", 8)
        _check_stat(r, "N (group 2)", 8)
        return "KS: D=1, P=0.0001554, N 8/8"
    finally:
        suite.close(pid)


def c_t22_exp_curves(suite):
    """T-22 exponential curves: one- and two-phase decay."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "expX")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"y": "A", "model": "one-phase-decay"})
        _check_fit(r, "Half-life", 1.38629)
        _check_fit(r, "Tau", 2)
        _check_fit(r, "Span", 90)
        _check_fit(r, "R squared", 1)
        _check_coef(r, "Y0", estimate=100)
        _check_coef(r, "Plateau", estimate=10)
        _check_coef(r, "K", estimate=0.5)
        r2 = _run(suite, pid, tid, "nonlinear-regression",
                  {"y": "B", "model": "two-phase-decay"})
        _check_fit(r2, "Half-life (fast)", 0.693147)
        _check_fit(r2, "Half-life (slow)", 6.93147)
        _check_fit(r2, "Span", 90)
        _check_fit(r2, "R squared", 1)
        _check_coef(r2, "Plateau", estimate=10)
        _check_coef(r2, "Span1", estimate=60)
        _check_coef(r2, "K1", estimate=1)
        _check_coef(r2, "Span2", estimate=30)
        _check_coef(r2, "K2", estimate=0.1)
        return "exp curves: 1-phase half-life 1.386, 2-phase 0.693/6.931, Span 90"
    finally:
        suite.close(pid)


def c_t23_enzyme_mm(suite):
    """T-23 enzyme kinetics: MM, allosteric, substrate inhibition."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "enzymeS")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"y": "A", "model": "michaelis-menten"})
        _check_coef(r, "Vmax", estimate=100)
        _check_coef(r, "Km", estimate=5)
        _check_fit(r, "Vmax/Km", 20)
        _check_fit(r, "R squared", 1)
        r2 = _run(suite, pid, tid, "nonlinear-regression",
                  {"y": "B", "model": "allosteric-sigmoidal"})
        _check_coef(r2, "Vmax", estimate=100)
        _check_coef(r2, "Khalf", estimate=5)
        _check_coef(r2, "Hill slope", estimate=2)
        _check_fit(r2, "R squared", 1)
        r3 = _run(suite, pid, tid, "nonlinear-regression",
                  {"y": "C", "model": "substrate-inhibition"})
        _check_coef(r3, "Vmax", estimate=100)
        _check_coef(r3, "Km", estimate=2)
        _check_coef(r3, "Ki", estimate=10)
        _check_fit(r3, "R squared", 1)
        return "enzyme MM: Vmax 100 Km 5; allosteric Khalf 5 Hill 2; sub-inhib Km 2 Ki 10"
    finally:
        suite.close(pid)


def c_t24_cox_ph(suite):
    """T-24 Cox PH on coxTable + Breslow ≡ Efron (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "coxTable")
        r = _run(suite, pid, tid, "cox-proportional-hazards",
                 {"time": "Time", "status": "Status",
                  "covariates": ["Trt", "Age"]}, timeout_s=600)
        _check_stat(r, "Concordance", 0.652632)
        _check_stat(r, "Concordance SE", 0.0841322)
        _check_stat(r, "Likelihood ratio chi-square", 2.72402)
        _check_stat(r, "Likelihood ratio df", 2)
        _check_p(r, "Likelihood ratio P value", 0.256146)
        _check_stat(r, "Wald chi-square", 2.62)
        _check_p(r, "Wald P value", 0.269837)
        _check_stat(r, "Score (log-rank) chi-square", 2.81276)
        _check_p(r, "Score (log-rank) P value", 0.245028)
        _check_stat(r, "Number of events", 12)
        _check_stat(r, "Number censored", 4)
        _check_stat(r, "N (complete cases)", 16)
        for term, coef, hr, lo, hi, p in [
                ("Trt", -0.985945, 0.373086, 0.10299, 1.35153, 0.133283),
                ("Age", -0.035077, 0.965531, 0.85867, 1.08569, 0.557781)]:
            c = _coef(r, term)
            assert _close(c.get("estimate"), coef, rel=1e-4), f"{term}: {c}"
            assert _close(c.get("hazardRatio"), hr, rel=1e-4), f"{term} HR: {c}"
            assert _close(c.get("low"), lo, rel=1e-4), f"{term} HR low: {c}"
            assert _close(c.get("high"), hi, rel=1e-4), f"{term} HR high: {c}"
            assert _close(c.get("p"), p, rel=1e-3, abs_tol=1e-9), f"{term} p: {c}"
        # Breslow ties give the same coefficients as Efron on this table.
        r2 = _run(suite, pid, tid, "cox-proportional-hazards",
                  {"time": "Time", "status": "Status",
                   "covariates": ["Trt", "Age"], "ties": "breslow"},
                  timeout_s=600)
        _check_stat(r2, "Likelihood ratio chi-square", 2.72402)
        _check_stat(r2, "Concordance", 0.652632)
        c = _coef(r2, "Trt")
        assert _close(c.get("hazardRatio"), 0.373086, rel=1e-4), f"Breslow Trt HR: {c}"
        return "Cox PH: Trt HR 0.373, Age HR 0.966, LR chi2 2.724 P 0.256; Breslow ≡ Efron"
    finally:
        suite.close(pid)


def c_t24_cox_survival3(suite):
    """T-24 Cox on survival3 groups (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "survival3")
        r = _run(suite, pid, tid, "cox", {}, timeout_s=600)
        _check_stat(r, "Likelihood ratio chi-square", 14.852)
        _check_stat(r, "df", 2)
        _check_p(r, "P value (likelihood ratio test)", 0.000595573)
        _check_stat(r, "Wald chi-square", 11.24)
        _check_stat(r, "Concordance", 0.763514)
        _check_p(r, "Proportional hazards test P", 0.898354)
        _check_hr(r, "B vs. A", ratio=3.99573, low=1.09459, high=14.5861,
                  p=0.0360135)
        _check_hr(r, "C vs. A", ratio=0.180009, low=0.035219, high=0.920049,
                  p=0.0393915)
        return "Cox survival3: LR chi2 14.85 P 0.000596; B vs A HR 3.996, C vs A HR 0.180"
    finally:
        suite.close(pid)


def c_t25_multilogit(suite):
    """T-25 multiple logistic regression (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "multipleBinary")
        r = _run(suite, pid, tid, "multiple-logistic-regression",
                 {"dependent": "Outcome", "predictors": ["Age", "Dose"]})
        _check_stat(r, "Odds ratio (Age)", 1.09487)
        _check_stat(r, "Odds ratio 95% CI lower (Age)", 0.951179)
        _check_stat(r, "Odds ratio 95% CI upper (Age)", 1.26026)
        _check_stat(r, "Odds ratio (Dose)", 6.69295)
        _check_stat(r, "Odds ratio 95% CI lower (Dose)", 0.334838)
        _check_stat(r, "Odds ratio 95% CI upper (Dose)", 133.783)
        _check_stat(r, "Residual deviance", 11.4354)
        _check_stat(r, "Null deviance", 16.6355)
        _check_stat(r, "Residual df", 9)
        _check_stat(r, "AIC", 17.4354)
        _check_p(r, "P value (model)", 0.074267)
        _check_stat(r, "McFadden pseudo-R²", 0.312595)
        _check_stat(r, "Complete rows (n)", 12)
        _check_coef(r, "Intercept", estimate=-4.83261)
        _check_coef(r, "Age", estimate=0.090634, p=0.206704)
        _check_coef(r, "Dose", estimate=1.90106, p=0.213489)
        assert r.get("statisticLabel") == "z", f"statisticLabel: {r.get('statisticLabel')!r}"
        assert r.get("equation") == "logit(p) = -4.833 + 0.09063·Age + 1.901·Dose", (
            f"equation: {r.get('equation')!r}")
        return "multilogit: OR Age 1.095, OR Dose 6.693, McFadden 0.313, z-stats"
    finally:
        suite.close(pid)


def c_t26_poisson_quasi(suite):
    """T-26 Poisson regression + quasi re-run (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "poissonOverdispersed")
        r = _run(suite, pid, tid, "poisson-regression",
                 {"dependent": "Count", "predictors": ["Dose", "Age"],
                  "quasi": True})
        _check_stat(r, "Rate ratio (Dose)", 1.57018)
        _check_stat(r, "Rate ratio 95% CI lower (Dose)", 0.923776)
        _check_stat(r, "Rate ratio 95% CI upper (Dose)", 2.66891)
        _check_stat(r, "Residual deviance", 95.7988)
        _check_stat(r, "Pearson chi-square", 82.2615)
        _check_stat(r, "Dispersion (Pearson)", 9.14017)
        _check_stat(r, "Quasi-Poisson dispersion", 9.14021)
        _check_coef(r, "Dose", estimate=0.451193, p=0.129852)
        _check_coef(r, "Age", estimate=0.027051, p=0.653210)
        # Quasi re-run keeps the same coefficients; only the P values change.
        r2 = _run(suite, pid, tid, "poisson-regression",
                  {"dependent": "Count", "predictors": ["Dose", "Age"]})
        _check_coef(r2, "Dose", estimate=0.451193, p=4.65592e-07)
        _check_coef(r2, "Age", estimate=0.027051, p=0.160080)
        return "Poisson quasi: Dose P 0.1299 (vs 4.66e-07 non-quasi), dispersion 9.14"
    finally:
        suite.close(pid)

def c_t27_deming(suite):
    """T-27 Deming regression lambda=1 / 0.25, plus lambda=0 error path."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "deming")
        r = _run(suite, pid, tid, "deming-regression",
                 {"y": "Y", "lambda": 1})
        _check_stat(r, "Slope", 0.976356)
        _check_stat(r, "Slope 95% CI lower", 0.888906)
        _check_stat(r, "Slope 95% CI upper", 1.06381)
        _check_stat(r, "Y-intercept", 0.25004)
        _check_stat(r, "Intercept 95% CI lower", -0.250066)
        _check_stat(r, "Intercept 95% CI upper", 0.750146)
        _check_stat(r, "Lambda", 1)
        _check_stat(r, "OLS slope", 0.968485)
        _check_stat(r, "OLS Y-intercept", 0.293333)
        _check_stat(r, "Complete pairs", 10)
        r2 = _run(suite, pid, tid, "deming-regression",
                  {"y": "Y", "lambda": 0.25})
        _check_stat(r2, "Slope", 0.981308)
        _check_stat(r2, "Slope 95% CI lower", 0.892397)
        _check_stat(r2, "Slope 95% CI upper", 1.07022)
        _check_stat(r2, "Y-intercept", 0.222807)
        _check_stat(r2, "Intercept 95% CI lower", -0.285302)
        _check_stat(r2, "Intercept 95% CI upper", 0.730917)
        # lambda=0 is an error, not a silent default: the run must fail with
        # the error-variance-ratio message (job error or error result).
        try:
            _, res = suite.run_analysis_sync(
                pid, tid, "deming-regression", {"y": "Y", "lambda": 0})
            err = (res.get("result") or {}).get("error", "")
            assert "error variance ratio" in str(err), (
                f"lambda=0 returned a result without the expected error: {res}")
        except Exception as e:
            assert "error variance ratio" in str(e), (
                f"lambda=0 failed with the wrong error: {e}")
        return "Deming λ=1 slope 0.9764, λ=0.25 slope 0.9813; λ=0 errors"
    finally:
        suite.close(pid)


def c_t28_nested(suite):
    """T-28 nested t test + nested ANOVA (reference.json).

    MCP gate gap (verified live): the dispatch gate rejects nested-t-test
    unless the TABLE has exactly 2 groups — the `sets` param is never
    consulted, so the reference `nested3 {"sets": ["Control", "Treated"]}`
    run is unreachable via MCP. The t-test part therefore uses the 2-group
    nested2 fixture (same Control/Treated values as nested3's first two
    groups; t/df/P/diff/CI recomputed from the subcolumn means with scipy
    1.11.4 and identical to the nested3-sets reference values).
    """
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "nested2")
        r = _run(suite, pid, tid, "nested-t-test", {})
        _check_stat(r, "t", 6.26099)
        _check_stat(r, "df", 4)
        _check_p(r, "P value", 0.00331976)
        _check_stat(r, "Mean (Control)", 11.6667)
        _check_stat(r, "Mean (Treated)", 16.3333)
        _check_stat(r, "Difference of means", 4.66667)
        _check_stat(r, "95% CI lower", 2.59723)
        _check_stat(r, "95% CI upper", 6.73611)
        _check_stat(r, "Subcolumns (Control)", 3)
        _check_stat(r, "Subcolumns (Treated)", 3)
        tid2 = _make_table(suite, pid, "nested3")
        r2 = _run(suite, pid, tid2, "nested-anova", {"posthoc": "none"})
        _check_stat(r2, "F", 60.7778)
        _check_stat(r2, "DFn", 2)
        _check_stat(r2, "DFd", 6)
        _check_p(r2, "P value", 0.000104077)
        _check_stat(r2, "SS between groups", 121.556)
        _check_stat(r2, "SS within groups", 6)
        _check_stat(r2, "Grand mean", 16.2222)
        _check_group(r2, "Control", mean=11.6667, n=3)
        _check_group(r2, "Treated", mean=16.3333, n=3)
        _check_group(r2, "High", mean=20.6667, n=3)
        return "nested t: t 6.261 df 4 P 0.00332; nested ANOVA F 60.78 (2,6)"
    finally:
        suite.close(pid)


def c_t29_spline(suite):
    """T-29 spline / Lowess smoothing (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseLog")
        r = _run(suite, pid, tid, "spline-lowess",
                 {"y": "Response", "method": "lowess", "f": 0.6666666666666666})
        _check_stat(r, "Span (f)", 0.666667)
        _check_stat(r, "Residual sum of squares", 161.778)
        _check_stat(r, "Complete pairs", 10)
        fitted = {p["x"]: p["y"] for p in r.get("fitted", [])}
        assert _close(fitted[-3], -1.00968, rel=1e-4), f"lowess x=-3: {fitted}"
        assert _close(fitted[1.5], 101.21811, rel=1e-4), f"lowess x=1.5: {fitted}"
        r2 = _run(suite, pid, tid, "spline-lowess",
                  {"y": "Response", "method": "spline",
                   "f": 0.6666666666666666, "spar": 0.5})
        _check_stat(r2, "Smoothing parameter (spar)", 0.5)
        _check_stat(r2, "Effective degrees of freedom", 3.71934)
        _check_stat(r2, "Residual sum of squares", 257.449)
        fitted2 = {p["x"]: p["y"] for p in r2.get("fitted", [])}
        assert _close(fitted2[-3], -3.70164, rel=1e-4), f"spline x=-3: {fitted2}"
        assert _close(fitted2[1.5], 104.16977, rel=1e-4), f"spline x=1.5: {fitted2}"
        return "Lowess RSS 161.78, spline spar 0.5 RSS 257.45, df 3.72"
    finally:
        suite.close(pid)


def c_t30_binding(suite):
    """T-30 binding saturation + association-then-dissociation kinetics."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "bindTotal")
        r = _run(suite, pid, tid, "binding-saturation",
                 {"model": "one-site-total"})
        _check_coef(r, "Bmax", estimate=100)
        _check_coef(r, "Kd", estimate=5)
        _check_coef(r, "NS", estimate=0.5)
        _check_coef(r, "Background", estimate=2)
        _check_stat(r, "R squared", 1)
        tid2 = _make_table(suite, pid, "bindTwoSite")
        r2 = _run(suite, pid, tid2, "binding-saturation",
                  {"model": "two-site-specific"})
        _check_coef(r2, "BmaxHi", estimate=60)
        _check_coef(r2, "KdHi", estimate=1)
        _check_coef(r2, "BmaxLo", estimate=40)
        _check_coef(r2, "KdLo", estimate=20)
        _check_stat(r2, "R squared", 1)
        tid3 = _make_table(suite, pid, "bindAssocThenDissoc")
        r3 = _run(suite, pid, tid3, "binding-kinetics",
                  {"model": "association-then-dissociation",
                   "hotNM": 1, "time0": 10})
        _check_stat(r3, "Kinetic Kd (nM)", 1)
        _check_stat(r3, "Eq", 50)
        _check_stat(r3, "R squared", 1)
        _check_coef(r3, "Kon", estimate=1e8)
        _check_coef(r3, "Koff", estimate=0.1)
        _check_coef(r3, "Bmax", estimate=100)
        _check_coef(r3, "NS", estimate=0.5)
        return "binding: 1-site Bmax 100 Kd 5; 2-site 60/1 + 40/20; ATD Kd 1 nM"
    finally:
        suite.close(pid)


def c_t31_enz_inhib(suite):
    """T-31 enzyme inhibition: mixed model + Morrison Ki."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "enzMixed")
        r = _run(suite, pid, tid, "enzyme-inhibition",
                 {"model": "mixed",
                  "inhibitorConcentrations": {"0 nM": 0, "5 nM": 5, "20 nM": 20}})
        _check_coef(r, "Vmax", estimate=100)
        _check_coef(r, "Km", estimate=10)
        _check_coef(r, "Ki", estimate=5)
        _check_coef(r, "Alpha", estimate=2)
        _check_stat(r, "R squared", 1)
        _check_stat(r, "Degrees of freedom", 17)
        _check_stat(r, "N", 21)
        tid2 = _make_table(suite, pid, "enzMorrison")
        r2 = _run(suite, pid, tid2, "enzyme-inhibition",
                  {"model": "morrison", "enzymeConcentration": 5})
        _check_coef(r2, "v0", estimate=100)
        _check_coef(r2, "Kiapp", estimate=2)
        _check_coef(r2, "Et", estimate=5)
        _check_stat(r2, "R squared", 1)
        _check_stat(r2, "Degrees of freedom", 5)
        _check_stat(r2, "N", 7)
        return "enzyme inhib: mixed Vmax 100 Km 10 Ki 5 Alpha 2; Morrison v0 100 Kiapp 2"
    finally:
        suite.close(pid)


def c_t32_dose_special(suite):
    """T-32 dose-response special: Schild, EC50-shift, operational."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "schild")
        r = _run(suite, pid, tid, "dose-response-special",
                 {"model": "schild-slope-1",
                  "antagonistConcentrations": {"0 M": 0, "1e-8 M": 1e-8,
                                               "1e-7 M": 1e-7}})
        _check_coef(r, "pA2", estimate=8)
        _check_stat(r, "Kb (M)", 1e-08)
        _check_stat(r, "EC50 (control)", 1e-06)
        _check_stat(r, "Dose ratio (1e-8 M)", 2)
        _check_stat(r, "Dose ratio (1e-7 M)", 11)
        _check_stat(r, "R squared", 1)
        _check_stat(r, "Degrees of freedom", 22)
        _check_stat(r, "N", 27)
        assert abs(_coef(r, "Bottom")["estimate"]) < 1e-7, "Schild Bottom ~0"
        _check_coef(r, "Top", estimate=100)
        _check_coef(r, "LogEC50", estimate=-6)
        _check_coef(r, "HillSlope", estimate=1)
        tid2 = _make_table(suite, pid, "ec50shift")
        r2 = _run(suite, pid, tid2, "dose-response-special",
                  {"model": "ec50-shift",
                   "antagonistConcentrations": {"0 nM": 0, "10 nM": 10},
                   "bUnits": "nM"})
        _check_stat(r2, "Dose ratio (10 nM)", 10)
        _check_stat(r2, "R squared", 1)
        _check_stat(r2, "Degrees of freedom", 13)
        _check_stat(r2, "N", 18)
        tid3 = _make_table(suite, pid, "operational")
        r3 = _run(suite, pid, tid3, "dose-response-special",
                  {"model": "operational-partial"})
        assert abs(_coef(r3, "Basal")["estimate"]) < 1e-6, "operational Basal ~0"
        _check_coef(r3, "Effectmax", estimate=100)
        _check_coef(r3, "LogEC50", estimate=-7)
        _check_coef(r3, "n", estimate=1)
        _check_coef(r3, "logKA[Partial agonist]", estimate=-6)
        _check_coef(r3, "logtau[Partial agonist]", estimate=0.5)
        # KA and tau are derived from first principles: 10^logKA, 10^logtau.
        assert _close(10 ** _coef(r3, "logKA[Partial agonist]")["estimate"],
                      1e-06, rel=1e-6)
        assert _close(10 ** _coef(r3, "logtau[Partial agonist]")["estimate"],
                      3.16228, rel=1e-6)
        _check_stat(r3, "R squared", 1)
        _check_stat(r3, "Degrees of freedom", 12)
        _check_stat(r3, "N", 18)
        return "dose special: Schild pA2 8, DR 2/11; EC50-shift DR 10; operational logKA -6 logtau 0.5"
    finally:
        suite.close(pid)


def c_t33_trend_mcnemar(suite):
    """T-33 chi-square test for trend + McNemar."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "contingencyTrend")
        r = _run(suite, pid, tid, "chi-square", {"trendOrdered": True})
        _check_stat(r, "Chi-square", 17.28)
        _check_stat(r, "df", 3)
        _check_p(r, "P value", 0.000618945)
        _check_stat(r, "Chi-square for trend", 17.0667)
        _check_p(r, "P value (test for trend)", 3.60902e-05)
        _check_stat(r, "Cramér's V", 0.464758)
        assert "N = 80" in r.get("notes", ""), f"notes: {r.get('notes')!r}"
        tid2 = _make_table(suite, pid, "mcnemarTable")
        r2 = _run(suite, pid, tid2, "mcnemar", {})
        _check_stat(r2, "McNemar's chi-square", 3.0625)
        _check_p(r2, "P value (McNemar's test)", 0.0801183)
        _check_p(r2, "P value (exact binomial)", 0.0768127)
        _check_stat(r2, "Discordant pairs (b + c)", 16)
        _check_stat(r2, "Odds ratio (paired, b/c)", 3)
        _check_stat(r2, "Odds ratio (paired) 95% CI lower", 0.909232)
        _check_stat(r2, "Odds ratio (paired) 95% CI upper", 12.7623)
        return "trend: chi2 17.28, trend chi2 17.07 P 3.6e-05; McNemar chi2 3.0625 P 0.0801"
    finally:
        suite.close(pid)


def c_t34_mixed(suite):
    """T-34 mixed-effects model, random intercept (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "mixedBalanced")
        r = _run(suite, pid, tid, "mixed-effects",
                 {"subjectId": "row", "randomStructure": "intercept",
                  "fixedFactors": ["Treatment", "T"],
                  "subjectFactor": {"name": "Treatment",
                                    "levels": ["Control", "Control", "Control",
                                               "Treated", "Treated", "Treated"]}},
                 timeout_s=600)
        _check_stat(r, "AIC", 53.6558)
        _check_stat(r, "BIC", 59.5461)
        _check_stat(r, "Log-likelihood", -21.8279)
        _check_stat(r, "REML criterion", 43.6558)
        _check_stat(r, "Observations used", 24)
        _check_stat(r, "Observations in table", 24)
        _check_stat(r, "Subjects (groups)", 6)
        _check_stat(r, "Residual DF", 19)
        _check_coef(r, "Intercept", estimate=10.1926, p=0.000469942)
        _check_coef(r, "Treatment (Treated vs Control)", estimate=4.96561,
                    p=0.0242159)
        _check_coef(r, "T", estimate=1.49721, p=4.56882e-14)
        vc = {(v["group"], v["component"]): v for v in r.get("varianceComponents", [])}
        assert _close(vc[("Subject", "Intercept")]["variance"], 2.9336, rel=1e-4)
        assert _close(vc[("Subject", "Intercept")]["sd"], 1.71277, rel=1e-4)
        assert _close(vc[("Residual", "Residual")]["variance"], 0.133705, rel=1e-4)
        assert _close(vc[("Residual", "Residual")]["sd"], 0.365657, rel=1e-4)
        assert r.get("equation") == "y ~ Treatment + T + (1 | subject)", (
            f"equation: {r.get('equation')!r}")
        return "mixed-effects: AIC 53.66, Treatment +4.966, T +1.497, subject var 2.934"
    finally:
        suite.close(pid)


def c_t35_pca(suite):
    """T-35 PCA, correlation scale, numeric only (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "pca")
        r = _run(suite, pid, tid, "principal-component-analysis",
                 {"scale": "correlation"})
        _check_stat(r, "Total variance", 3)
        _check_stat(r, "Number of components", 3)
        _check_stat(r, "Variance explained by PC1", 0.974361)
        _check_stat(r, "Variance explained by PC1+PC2", 0.995777)
        _check_stat(r, "Complete rows (n)", 6)
        _check_stat(r, "Variables (p)", 3)
        pv = {v["component"]: v for v in r.get("pcaVariance", [])}
        assert _close(pv["PC1"]["eigenvalue"], 2.92308, rel=1e-6)
        assert _close(pv["PC1"]["proportion"], 0.974361, rel=1e-6)
        assert _close(pv["PC2"]["eigenvalue"], 0.0642492, rel=1e-6)
        assert _close(pv["PC3"]["eigenvalue"], 0.0126691, rel=1e-6)
        return "PCA: PC1 eigenvalue 2.923 (97.44%), PC2 0.0642, PC3 0.0127"
    finally:
        suite.close(pid)


def c_t36_montecarlo_bounded(suite):
    """T-36 Monte Carlo, bounded 200 repeats, seed 42 (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "mcPower")
        r = _run(suite, pid, tid, "monte-carlo",
                 {"targetAnalysis": "one-sample-t",
                  "summaryStatistic": "P value", "repeats": 200, "seed": 42,
                  "groupMeans": {"A": 0}, "groupSds": {"A": 1},
                  "hypotheticalValue": 0}, timeout_s=600)
        _check_stat(r, "Repeats completed", 200)
        _check_stat(r, "Mean of P value", 0.50652, rel=1e-3)
        _check_stat(r, "SD of P value", 0.27569, rel=1e-3)
        _check_stat(r, "2.5th percentile", 0.0436094, rel=1e-3)
        _check_stat(r, "97.5th percentile", 0.994534, rel=1e-3)
        _check_stat(r, "Power (% P < 0.05)", 3)
        _check_stat(r, "Observed (real data)", 1)
        _check_stat(r, "Seed", 42)
        return "Monte Carlo 200x: mean P 0.5065, SD 0.2757, power 3%"
    finally:
        suite.close(pid)


def c_t38_grubbs(suite):
    """T-38 Grubbs' test: standard, masked, iterate (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "outliers", {"method": "grubbs"})
        _check_stat(r, "Total observations", 25)
        _check_stat(r, "Groups analyzed", 4)
        _check_stat(r, "Outliers detected", 1)
        _check_stat(r, "Outlier percentage (%)", 4)
        _check_stat(r, "Control — G", 2.45792)
        _check_p(r, "Control — P value", 6.39177e-06)
        _check_stat(r, "Low — G", 1.6074)
        _check_p(r, "Low — P value", 0.52203)
        tid2 = _make_table(suite, pid, "grubbsMasked")
        r2 = _run(suite, pid, tid2, "outliers", {"method": "grubbs"})
        _check_stat(r2, "Outliers detected", 0)
        _check_stat(r2, "Masked — G", 1.52873)
        _check_p(r2, "Masked — P value", 0.677451)
        tid3 = _make_table(suite, pid, "grubbsIterate")
        r3 = _run(suite, pid, tid3, "outliers", {"method": "grubbs"})
        _check_stat(r3, "Outliers detected", 2)
        _check_stat(r3, "Values — G", 2.06431)
        _check_p(r3, "Values — P value", 0.0308782)
        notes = r3.get("notes", "")
        assert "45" in notes and "25" in notes, f"grubbs iterate notes: {notes!r}"
        return "Grubbs: Control G 2.458 P 6.4e-06; masked 0; iterate 2 (45, 25)"
    finally:
        suite.close(pid)


def c_t39_multicomp(suite):
    """T-39 Sidak / Holm-Sidak / LSD / Dunn-Sidak comparisons."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "anova", {"posthoc": "sidak"})
        _check_comp(r, "High", "Sparse", diff=8.99167, p=0.00810935)
        r2 = _run(suite, pid, tid, "anova", {"posthoc": "holm-sidak"})
        _check_comp(r2, "High", "Sparse", diff=8.99167, p=0.00810935)
        r3 = _run(suite, pid, tid, "anova", {"posthoc": "lsd"})
        _check_comp(r3, "High", "Sparse", diff=8.99167, p=0.00135615)
        r4 = _run(suite, pid, tid, "kruskal-wallis", {"posthoc": "dunn-sidak"})
        _check_comp(r4, "High", "Sparse", diff=8.99167, p=0.000907586)
        return "multicomp High-Sparse: Sidak 0.00811, Holm-Sidak 0.00811, LSD 0.00136, Dunn-Sidak 0.000908"
    finally:
        suite.close(pid)


def c_t40_nonlin_compare(suite):
    """T-40 4PL vs 3PL model comparison (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseLog")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "sigmoidal-4pl-logx",
                  "compareModel": "agonist-3pl-logx"})
        _check_stat(r, "F", 2.01243)
        _check_stat(r, "DFn", 1)
        _check_stat(r, "DFd", 6)
        _check_p(r, "P value", 0.205807)
        _check_stat(r, "AICc", -5.19103)
        _check_stat(r, "ΔAICc (primary − comparison)", 3.10765)
        return "4PL vs 3PL: F 2.012 (1,6) P 0.206"
    finally:
        suite.close(pid)


def c_t41_km_gehan_cox(suite):
    """T-41 KM Gehan + HR/CI, and Cox on freireich (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "freireich")
        r = _run(suite, pid, tid, "survival",
                 {"curveTest": "gehan", "correction": "holm"})
        _check_stat(r, "Chi-square", 13.4579)
        _check_stat(r, "df", 1)
        _check_p(r, "P value", 0.000243983)
        _check_stat(r, "Hazard ratio (Mantel-Haenszel), 6-MP / Placebo", 0.194319)
        _check_stat(r, "Hazard ratio (log-rank), 6-MP / Placebo", 0.239315)
        mh_lo, lr_lo = _stats_all(r, "95% CI lower")
        mh_hi, lr_hi = _stats_all(r, "95% CI upper")
        assert _close(mh_lo, 0.0887613, rel=1e-4), f"MH CI low: {mh_lo}"
        assert _close(mh_hi, 0.425408, rel=1e-4), f"MH CI high: {mh_hi}"
        assert _close(lr_lo, 0.113467, rel=1e-4), f"LR CI low: {lr_lo}"
        assert _close(lr_hi, 0.504741, rel=1e-4), f"LR CI high: {lr_hi}"
        g = _surv_group(r, "6-MP")
        assert (g["subjects"], g["events"], g["median"]) == (21, 9, 23), f"6-MP: {g}"
        assert g["low"] == 13, f"6-MP low: {g}"
        g = _surv_group(r, "Placebo")
        assert (g["subjects"], g["events"], g["median"]) == (21, 21, 8), f"Placebo: {g}"
        assert (g["low"], g["high"]) == (4, 11), f"Placebo CI: {g}"
        r2 = _run(suite, pid, tid, "cox", {"reference": "6-MP"}, timeout_s=600)
        _check_stat(r2, "Likelihood ratio chi-square", 16.3517)
        _check_stat(r2, "df", 1)
        _check_p(r2, "P value (likelihood ratio test)", 5.26092e-05)
        _check_stat(r2, "Wald chi-square", 14.53)
        _check_stat(r2, "Concordance", 0.690042)
        _check_p(r2, "Proportional hazards test P", 0.879813)
        _check_hr(r2, "Placebo vs. 6-MP", ratio=4.81687, low=2.14651,
                  high=10.8093, p=0.000137754)
        return "Gehan chi2 13.46 P 0.000244, HR MH 0.194; Cox freireich HR 4.817"
    finally:
        suite.close(pid)


def c_t42_binding_comp(suite):
    """T-42 binding competition: two-site fitKi + homologous Kd."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "competitionTwoSite")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "two-site-competition-logx", "fitKi": True,
                  "ligandConcentration": 1, "ligandKd": 0.5})
        _check_fit(r, "IC50 (high affinity)", 0.01)
        _check_fit(r, "Ki (high affinity)", 0.00333333)
        _check_fit(r, "IC50 (low affinity)", 10)
        _check_fit(r, "Ki (low affinity)", 3.33333)
        _check_fit(r, "R squared", 1)
        tid2 = _make_table(suite, pid, "competitionHomologous")
        r2 = _run(suite, pid, tid2, "nonlinear-regression",
                  {"model": "homologous-competition-logx",
                   "ligandConcentration": 1})
        _check_fit(r2, "Kd", 0.5)
        _check_fit_range(r2, "Kd", 0.49999999, 0.50000000)
        _check_fit(r2, "IC50", 1.5)
        _check_fit(r2, "R squared", 1)
        return "competition: two-site Ki 0.00333/3.333; homologous Kd 0.5, IC50 1.5"
    finally:
        suite.close(pid)


def c_t43_lines_poly(suite):
    """T-43 segmental-linear + quartic + quintic (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "xy")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"y": "Y1", "model": "segmental-linear"})
        _check_fit(r, "Breakpoint (X0)", 2.99999)
        _check_fit(r, "Slope below X0", 1.95299)
        _check_fit(r, "Slope above X0", 2.04504)
        _check_fit(r, "R squared", 0.998595)
        r2 = _run(suite, pid, tid, "nonlinear-regression",
                  {"y": "Y1", "model": "quartic"})
        _check_fit(r2, "R squared", 0.999041)
        r3 = _run(suite, pid, tid, "nonlinear-regression",
                  {"y": "Y1", "model": "quintic"})
        _check_fit(r3, "R squared", 0.999246)
        return "segmental X0 3.0, slopes 1.953/2.045; quartic R2 0.99904, quintic 0.99925"
    finally:
        suite.close(pid)


def c_t44_kmeans(suite):
    """T-44 k-means k=2 raw + k=3 standardised (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "kmeans")
        r = _run(suite, pid, tid, "k-means",
                 {"clusters": 2, "standardise": False})
        _check_stat(r, "Total sum of squares", 149.667)
        _check_stat(r, "Within-cluster sum of squares", 2.66667)
        _check_stat(r, "Between-cluster sum of squares", 147)
        _check_stat(r, "Number of clusters (k)", 2)
        _check_stat(r, "Complete rows (n)", 6)
        _check_stat(r, "Variables (p)", 2)
        cl = {c["cluster"]: c for c in r.get("kmeansClusters", [])}
        assert _close(cl["Cluster 1"]["centre"][0], 1.33333, rel=1e-4), f"C1 x: {cl['Cluster 1']}"
        assert _close(cl["Cluster 1"]["centre"][1], 1.33333, rel=1e-4), f"C1 y: {cl['Cluster 1']}"
        assert cl["Cluster 1"]["n"] == 3, f"C1 n: {cl['Cluster 1']}"
        assert _close(cl["Cluster 1"]["withinSs"], 1.33333, rel=1e-4), f"C1 SS: {cl['Cluster 1']}"
        assert _close(cl["Cluster 2"]["centre"][0], 8.33333, rel=1e-4), f"C2 x: {cl['Cluster 2']}"
        assert cl["Cluster 2"]["n"] == 3, f"C2 n: {cl['Cluster 2']}"
        r2 = _run(suite, pid, tid, "k-means",
                  {"clusters": 3, "standardise": True})
        _check_stat(r2, "Total sum of squares", 10)
        _check_stat(r2, "Within-cluster sum of squares", 0.122494)
        _check_stat(r2, "Between-cluster sum of squares", 9.87751)
        cl2 = {c["cluster"]: c for c in r2.get("kmeansClusters", [])}
        assert _close(cl2["Cluster 1"]["centre"][0], 1, rel=1e-4), f"k3 C1 x: {cl2['Cluster 1']}"
        assert _close(cl2["Cluster 1"]["centre"][1], 1.5, rel=1e-4), f"k3 C1 y: {cl2['Cluster 1']}"
        assert cl2["Cluster 1"]["n"] == 2, f"k3 C1 n: {cl2['Cluster 1']}"
        assert _close(cl2["Cluster 2"]["centre"][0], 2, rel=1e-4), f"k3 C2 x: {cl2['Cluster 2']}"
        assert _close(cl2["Cluster 2"]["centre"][1], 1, rel=1e-4), f"k3 C2 y: {cl2['Cluster 2']}"
        assert cl2["Cluster 2"]["n"] == 1, f"k3 C2 n: {cl2['Cluster 2']}"
        assert _close(cl2["Cluster 3"]["centre"][0], 8.33333, rel=1e-4), f"k3 C3 x: {cl2['Cluster 3']}"
        assert cl2["Cluster 3"]["n"] == 3, f"k3 C3 n: {cl2['Cluster 3']}"
        return "k-means k=2 centres [1.333,1.333]/[8.333,8.333]; k=3 std within SS 0.1225"
    finally:
        suite.close(pid)


def c_t45_dose_3pl5pl(suite):
    """T-45 3PL / 5PL + EC50 comparisons (reference.json).

    Note: the plan's "F 1205" is the 3PL EC50 comparison, not the 4PL one
    (4PL compare F is 2164.41). Both are pinned here.
    """
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseLog")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "agonist-3pl-logx"})
        _check_fit(r, "EC50", 0.14403)
        _check_fit(r, "Span", 97.3726)
        _check_fit(r, "R squared", 0.999896)
        _check_fit(r, "Sy.x", 0.47874)
        _check_fit(r, "Sum of squares", 1.60435)
        _check_fit(r, "Degrees of freedom", 7)
        r2 = _run(suite, pid, tid, "nonlinear-regression",
                  {"model": "asymmetric-5pl-logx"})
        _check_fit(r2, "EC50", 0.144146)
        _check_fit(r2, "Span", 97.9027)
        _check_fit(r2, "R squared", 0.999925)
        _check_fit(r2, "Sy.x", 0.483586)
        _check_fit(r2, "Sum of squares", 1.16928)
        _check_fit(r2, "Degrees of freedom", 5)
        _check_coef(r2, "Asymmetry (S)", estimate=1.052418,
                    low=0.7295, high=1.5183)
        tid2 = _make_table(suite, pid, "doseTwo")
        r3 = _run(suite, pid, tid2, "nonlinear-regression",
                  {"y": "Control", "model": "agonist-3pl-logx",
                   "compareWith": "Treated", "compare": "ec50"})
        _check_stat(r3, "F", 1204.8)
        _check_stat(r3, "DFn", 1)
        _check_stat(r3, "DFd", 14)
        _check_p(r3, "P value", 5.55496e-15)
        _check_fit(r3, "EC50", 0.14403, idx=0)
        _check_fit(r3, "EC50", 0.410591, idx=1)
        r4 = _run(suite, pid, tid2, "nonlinear-regression",
                  {"y": "Control", "model": "sigmoidal-4pl-logx",
                   "compareWith": "Treated", "compare": "ec50"})
        _check_stat(r4, "F", 2164.41)
        _check_stat(r4, "DFn", 1)
        _check_stat(r4, "DFd", 12)
        _check_p(r4, "P value", 6.35307e-15)
        _check_fit(r4, "EC50", 0.143886, idx=0)
        _check_fit(r4, "EC50", 0.414509, idx=1)
        return "3PL EC50 0.1440, 5PL EC50 0.1441 S 1.052; EC50 compares F 1205 (3PL) / 2164 (4PL)"
    finally:
        suite.close(pid)


def c_t48_welch_anova(suite):
    """T-48 Welch ANOVA + Dunnett + Games-Howell + Dunnett T3."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "column")
        r = _run(suite, pid, tid, "anova",
                 {"posthoc": "none", "equalSd": False})
        _check_stat(r, "F (Welch)", 44.4576)
        _check_stat(r, "DFn", 3)
        _check_stat(r, "DFd", 9.65975)
        _check_p(r, "P value", 5.75784e-06)
        r2 = _run(suite, pid, tid, "anova",
                  {"posthoc": "dunnett", "control": "Control"})
        _check_comp(r2, "High", "Control", diff=5.27917, p=0.0458949)
        _check_comp(r2, "Low", "Control", diff=0.505357, p=0.989122)
        r3 = _run(suite, pid, tid, "anova",
                  {"posthoc": "games-howell", "equalSd": False})
        _check_comp(r3, "Low", "High", diff=-4.77381, p=3.84373e-05)
        _check_comp(r3, "High", "Sparse", diff=8.99167, p=0.000111579)
        r4 = _run(suite, pid, tid, "anova",
                  {"posthoc": "t3", "equalSd": False})
        _check_comp(r4, "Low", "High", diff=-4.77381, p=4.48724e-05)
        _check_comp(r4, "High", "Sparse", diff=8.99167, p=0.000137005)
        return "Welch ANOVA F 44.46 (3, 9.66) P 5.8e-06; Dunnett/GH/T3 pins"
    finally:
        suite.close(pid)


def c_t49_gg(suite):
    """T-49 Geisser-Greenhouse correction, RM ANOVA matched."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "matched")
        r = _run(suite, pid, tid, "rm-anova",
                 {"posthoc": "tukey", "sphericity": False})
        _check_stat(r, "F", 21.8473)
        _check_stat(r, "DFn", 1.01076)
        _check_stat(r, "DFd", 5.05382)
        _check_p(r, "P value", 0.00527405)
        _check_stat(r, "R squared (eta squared)", 0.68512)
        _check_stat(r, "Geisser-Greenhouse epsilon", 0.505382)
        _check_group(r, "Day 0", mean=10.3833, n=6)
        _check_group(r, "Day 7", mean=12.9333, n=6)
        _check_group(r, "Day 14", mean=16.85, n=6)
        _check_comp(r, "Day 0", "Day 7", diff=-2.55, p=0.00107587)
        _check_comp(r, "Day 0", "Day 14", diff=-6.46667, p=0.0104571)
        return "GG: epsilon 0.5054, F 21.85 (1.011, 5.054) P 0.00527"
    finally:
        suite.close(pid)


def c_t50_twoway_norep(suite):
    """T-50 two-way ANOVA, one value per cell (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "noReplicates")
        r = _run(suite, pid, tid, "two-way-anova",
                 {"design": "ordinary", "posthoc": "none",
                  "posthocTarget": "groups"})
        _check_stat(r, "Group F", 2.28571)
        _check_stat(r, "Group DFn", 1)
        _check_p(r, "Group P value", 0.269703)
        _check_stat(r, "Row F", 3)
        _check_stat(r, "Row DFn", 2)
        _check_p(r, "Row P value", 0.25)
        _check_stat(r, "DFd (residual)", 2)
        return "two-way no-rep: Group F 2.286 P 0.270, Row F 3 P 0.25, DFd 2"
    finally:
        suite.close(pid)


def c_t51_textbook_4pl(suite):
    """T-51 / Q-60 dose-textbook 4PL (Linux 4PL retry pin)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "doseTextbook")
        r = _run(suite, pid, tid, "nonlinear-regression",
                 {"model": "sigmoidal-4pl-logx"})
        _check_fit(r, "EC50", 0.999991)
        _check_fit(r, "Span", 102.702)
        _check_fit(r, "R squared", 0.999255)
        _check_fit(r, "Sy.x", 1.35597)
        _check_fit(r, "Sum of squares", 9.19327)
        _check_fit(r, "Degrees of freedom", 5)
        _check_fit(r, "N", 9)
        _check_coef(r, "Bottom", estimate=-1.35124)
        _check_coef(r, "Top", estimate=101.3511)
        _check_coef(r, "LogEC50", estimate=-3.86e-06)
        _check_coef(r, "Hill slope", estimate=0.77657)
        return "textbook 4PL: EC50 1.000, Bottom -1.351, Top 101.35, R2 0.99926"
    finally:
        suite.close(pid)


def c_q15_shapiro(suite):
    """Q-15/T-37 Shapiro-Wilk normality (reference.json)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "normality")
        r = _run(suite, pid, tid, "shapiro-wilk", {"test": "shapiro-wilk"})
        _check_stat(r, "A — W", 0.977315)
        _check_p(r, "A — P value", 0.827254)
        _check_stat(r, "B — W", 0.778984)
        _check_p(r, "B — P value", 0.000103471)
        return "Shapiro-Wilk: A W 0.977 P 0.827, B W 0.779 P 0.000103"
    finally:
        suite.close(pid)


def c_t41_km_gehan(suite):
    """T-41 KM Gehan-Breslow-Wilcoxon on survival3 (FDR)."""
    pid = _new_project(suite)
    try:
        tid = _make_table(suite, pid, "survival3")
        r = _run(suite, pid, tid, "survival",
                 {"curveTest": "gehan", "correction": "fdr"})
        _check_stat(r, "Chi-square", 12.4219)
        _check_stat(r, "df", 2)
        _check_p(r, "P value", 0.00200735)
        return "KM Gehan FDR: chi2 12.42 df 2 P 0.00201"
    finally:
        suite.close(pid)


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

NUMERIC_CASES = [
    ("num_q04_descriptive", c_q04_descriptive),
    ("num_q05_student_t", c_q05_student_t),
    ("num_q06_welch_t", c_q06_welch_t),
    ("num_q07_mann_whitney", c_q07_mann_whitney),
    ("num_q08_paired_t", c_q08_paired_t),
    ("num_q09_wilcoxon", c_q09_wilcoxon),
    ("num_q10_one_sample_t", c_q10_one_sample_t),
    ("num_q11_anova_eta2", c_q11_anova_eta2),
    ("num_q12_kruskal_wallis", c_q12_kruskal_wallis),
    ("num_q13_rm_anova", c_q13_rm_anova),
    ("num_q14_friedman", c_q14_friedman),
    ("num_q18_rout", c_q18_rout),
    ("num_q25_pearson", c_q25_pearson),
    ("num_q26_spearman", c_q26_spearman),
    ("num_q27_linreg_y1", c_q27_linreg_y1),
    ("num_q28_linreg_y2", c_q28_linreg_y2),
    ("num_q29_auc", c_q29_auc),
    ("num_q30_4pl_doselog", c_q30_4pl_doselog),
    ("num_q36_twoway_grouped", c_q36_twoway_grouped),
    ("num_q64_chisq_yates", c_q64_chisq_yates),
    ("num_q65_multireg", c_q65_multireg),
    ("num_q37_mv_descriptive", c_q37_mv_descriptive),
    ("num_q37_contingency", c_q37_contingency),
    ("num_q37_survival", c_q37_survival),
    ("num_q37_corr_matrix", c_q37_corr_matrix),
    ("num_q15_shapiro", c_q15_shapiro),
    ("num_q41_tukey", c_q41_tukey),
    ("num_q41_bonferroni", c_q41_bonferroni),
    ("num_q41_dunn", c_q41_dunn),
    ("num_q41_rm_twoway", c_q41_rm_twoway),
    ("num_q41_scheirer_ray_hare", c_q41_scheirer_ray_hare),
    ("num_q41_multiple_t", c_q41_multiple_t),
    ("num_t15_logistic", c_t15_logistic),
    ("num_t16_interpolate", c_t16_interpolate),
    ("num_t17_threeway", c_t17_threeway),
    ("num_t18_bland_altman", c_t18_bland_altman),
    ("num_t19_roc", c_t19_roc),
    ("num_t20_freqdist", c_t20_freqdist),
    ("num_t21_ks", c_t21_ks),
    ("num_t22_exp_curves", c_t22_exp_curves),
    ("num_t23_enzyme_mm", c_t23_enzyme_mm),
    ("num_t24_cox_ph", c_t24_cox_ph),
    ("num_t24_cox_survival3", c_t24_cox_survival3),
    ("num_t25_multilogit", c_t25_multilogit),
    ("num_t26_poisson_quasi", c_t26_poisson_quasi),
    ("num_t27_deming", c_t27_deming),
    ("num_t28_nested", c_t28_nested),
    ("num_t29_spline", c_t29_spline),
    ("num_t30_binding", c_t30_binding),
    ("num_t31_enz_inhib", c_t31_enz_inhib),
    ("num_t32_dose_special", c_t32_dose_special),
    ("num_t33_trend_mcnemar", c_t33_trend_mcnemar),
    ("num_t34_mixed", c_t34_mixed),
    ("num_t35_pca", c_t35_pca),
    ("num_t36_montecarlo_bounded", c_t36_montecarlo_bounded),
    ("num_t38_grubbs", c_t38_grubbs),
    ("num_t39_multicomp", c_t39_multicomp),
    ("num_t40_nonlin_compare", c_t40_nonlin_compare),
    ("num_t41_km_gehan_cox", c_t41_km_gehan_cox),
    ("num_t41_km_gehan", c_t41_km_gehan),
    ("num_t42_binding_comp", c_t42_binding_comp),
    ("num_t43_lines_poly", c_t43_lines_poly),
    ("num_t44_kmeans", c_t44_kmeans),
    ("num_t45_dose_3pl5pl", c_t45_dose_3pl5pl),
    ("num_t48_welch_anova", c_t48_welch_anova),
    ("num_t49_gg", c_t49_gg),
    ("num_t50_twoway_norep", c_t50_twoway_norep),
    ("num_t51_textbook_4pl", c_t51_textbook_4pl),
]


def register_numeric_cases(suite):
    """Register all numeric cases on ``suite`` (called from suite.py run())."""
    for name, fn in NUMERIC_CASES:
        suite.case(name, lambda fn=fn: fn(suite))
