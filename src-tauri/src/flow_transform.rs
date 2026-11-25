// FlowJo track, seq 448 (F2b): the real display transforms (Rust side).
//
// The same math as `src/flow/transforms.ts` — the two implementations are
// differential-tested against the same golden fixture
// (`tests/testdata/flow/transform-goldens.json`, generated from the
// published definitions by `~/workspace/.helix-flowjo/eval/make_transform_goldens.py`),
// so a drift in either shows up in the flow-f2b pin. Sources, and the
// FlowJo-biex note, live in the TS header; the short version: GatingML
// 2.0 logicle + Hyperlog (Parks et al. 2006), the Stanford arcsinh
// identity, the normalized GatingML log form, linear — never decompiled
// FlowJo code, and never the flow-fcs crate's biexponential (F0 proved
// it is arcsinh with the width ignored).
//
// The `flow_apply_transform` command rewrites one parameter's column in
// the Rust event store in place (the data transform; f64 math, stored
// as f32). The sample node records the transform (the MCP executor),
// and the viewer plots transformed copies with axis ticks (display) —
// neither rewrites the store.

use crate::flow_store::{FlowParamStats, FlowStore};
use serde::Serialize;

/// The transform kinds, as the wire spells them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransformKind {
    Log,
    Logicle,
    Arcsinh,
    Hyperlog,
    Linear,
}

impl TransformKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "log" => Some(Self::Log),
            "logicle" => Some(Self::Logicle),
            "arcsinh" => Some(Self::Arcsinh),
            "hyperlog" => Some(Self::Hyperlog),
            "linear" => Some(Self::Linear),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Log => "log",
            Self::Logicle => "logicle",
            Self::Arcsinh => "arcsinh",
            Self::Hyperlog => "hyperlog",
            Self::Linear => "linear",
        }
    }
}

/// A transform with every number filled in and validated.
#[derive(Debug, Clone, Copy)]
pub struct ResolvedTransform {
    pub kind: TransformKind,
    pub t: f64,
    pub w: f64,
    pub m: f64,
    pub a: f64,
    pub base: f64,
    pub floor: f64,
}

const LN10: f64 = std::f64::consts::LN_10;

/// The FlowJo/flowCore default display: T=262144, M=4.5, W=0.5, A=0.
const DEFAULT_T: f64 = 262144.0;
const DEFAULT_W: f64 = 0.5;
const DEFAULT_M: f64 = 4.5;
const DEFAULT_A: f64 = 0.0;
const DEFAULT_BASE: f64 = 10.0;
const DEFAULT_FLOOR: f64 = 0.0;

fn param_number(params: &serde_json::Value, name: &str) -> Result<Option<f64>, String> {
    match params.get(name) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => v.as_f64().map(Some).ok_or_else(|| {
            format!("Transform parameter “{name}” must be a finite number.")
        }),
    }
}

/// Fill a kind's defaults and validate the GatingML ranges. Mirrors the
/// TS `resolveTransform` exactly (same defaults, same messages).
pub fn resolve_transform(kind: &str, params: &serde_json::Value) -> Result<ResolvedTransform, String> {
    let kind = TransformKind::from_str(kind)
        .ok_or_else(|| format!("Unknown transform kind “{kind}” — log, logicle, arcsinh, hyperlog or linear."))?;
    let t = param_number(params, "T")?.unwrap_or(DEFAULT_T);
    let m = param_number(params, "M")?.unwrap_or(DEFAULT_M);
    let a = param_number(params, "A")?.unwrap_or(DEFAULT_A);
    let w = param_number(params, "W")?.unwrap_or(DEFAULT_W);
    let base = param_number(params, "base")?.unwrap_or(DEFAULT_BASE);
    let floor = param_number(params, "floor")?.unwrap_or(DEFAULT_FLOOR);
    if t <= 0.0 {
        return Err(format!("Transform parameter “T” must be positive (got {t})."));
    }
    if m <= 0.0 {
        return Err(format!("Transform parameter “M” must be positive (got {m})."));
    }
    if kind == TransformKind::Logicle || kind == TransformKind::Hyperlog {
        // GatingML 2.0: W ≤ M/2 and A ∈ [−W, M−2W]; Hyperlog additionally
        // needs W > 0 (its ca divides by w = W/(M+A)).
        if kind == TransformKind::Hyperlog && w <= 0.0 {
            return Err(format!("Hyperlog needs W > 0 (got {w}) — ca divides by W/(M+A)."));
        }
        if !(0.0..=m / 2.0).contains(&w) {
            return Err(format!(
                "Transform parameter “W” must lie in [0, M/2] = [0, {}] (got {w}).",
                m / 2.0
            ));
        }
        if a < -w || a > m - 2.0 * w {
            return Err(format!(
                "Transform parameter “A” must lie in [−W, M−2W] = [{}, {}] (got {a}).",
                -w,
                m - 2.0 * w
            ));
        }
    }
    if kind == TransformKind::Log && base <= 1.0 {
        return Err(format!("Transform parameter “base” must be above 1 (got {base})."));
    }
    Ok(ResolvedTransform { kind, t, w, m, a, base, floor })
}

// ── Logicle (GatingML 2.0) ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct LogicleCoeffs {
    a: f64,
    b: f64,
    c: f64,
    d: f64,
    f: f64,
}

/// d solves 2·(ln d − ln b) + w·(d+b) = 0; d ∈ (0, b] for w > 0, d = b
/// at w = 0. Bisection, mirroring the Python reference exactly.
fn solve_logicle_d(b: f64, w: f64) -> f64 {
    if w <= 0.0 {
        return b;
    }
    let f = |d: f64| 2.0 * (d.ln() - b.ln()) + w * (d + b);
    let mut lo = 1e-12f64;
    let mut hi = b;
    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        if (f(lo) < 0.0) == (f(mid) < 0.0) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

fn logicle_coeffs(t: f64, w_in: f64, m: f64, a_in: f64) -> LogicleCoeffs {
    let w = w_in / (m + a_in);
    let x2 = a_in / (m + a_in);
    let x1 = x2 + w;
    let x0 = x2 + 2.0 * w;
    let b = (m + a_in) * LN10;
    let d = solve_logicle_d(b, w);
    let ca = (x0 * (b + d)).exp();
    let fa = (b * x1).exp() - ca / (d * x1).exp();
    let a = t / ((b).exp() - fa - ca / (d).exp());
    let c = ca * a;
    let f = fa * a;
    LogicleCoeffs { a, b, c, d, f }
}

fn logicle_b(y: f64, p: &LogicleCoeffs) -> f64 {
    p.a * (p.b * y).exp() - p.c * (-p.d * y).exp() - p.f
}

fn logicle_db(y: f64, p: &LogicleCoeffs) -> f64 {
    p.a * p.b * (p.b * y).exp() + p.c * p.d * (-p.d * y).exp()
}

// ── Hyperlog (GatingML 2.0, flowCore) ─────────────────────────────────────

#[derive(Debug, Clone, Copy)]
struct HyperlogCoeffs {
    a: f64,
    b: f64,
    c: f64,
    f: f64,
}

fn hyperlog_coeffs(t: f64, w_in: f64, m: f64, a_in: f64) -> HyperlogCoeffs {
    let w = w_in / (m + a_in);
    let x2 = a_in / (m + a_in);
    let x1 = x2 + w;
    let x0 = x2 + 2.0 * w;
    let b = (m + a_in) * LN10;
    let e0 = (b * x0).exp();
    let ca = e0 / w;
    let fa = (b * x1).exp() + ca * x1;
    let a = t / ((b).exp() + ca - fa);
    let c = ca * a;
    let f = fa * a;
    HyperlogCoeffs { a, b, c, f }
}

fn hyperlog_eh(y: f64, p: &HyperlogCoeffs) -> f64 {
    p.a * (p.b * y).exp() + p.c * y - p.f
}

fn hyperlog_deh(y: f64, p: &HyperlogCoeffs) -> f64 {
    p.a * p.b * (p.b * y).exp() + p.c
}

// ── Root finding (logicle + Hyperlog share it) ────────────────────────────

/// Bracketed Newton on a strictly increasing F with F' > 0: Newton while
/// it stays inside the bracket, bisection otherwise. The bracket is the
/// display range [−2, 2], exactly as the Python reference holds it — an
/// x outside F([−2, 2]) is off the bottom/top of the display and clamps
/// to the edge (FlowJo piles such events at the axis, it does not extend
/// it). No bracket expansion: expanding finds a "true" root the reference
/// (and the display) never shows. Mirrors the TS `solveMonotonic` exactly.
fn solve_monotonic(forward: &dyn Fn(f64) -> f64, derivative: &dyn Fn(f64) -> f64, x: f64) -> f64 {
    let mut lo = -2.0f64;
    let mut hi = 2.0f64;
    let tol = 1e-12 * x.abs().max(1.0);
    let mut y = 0.0f64;
    for _ in 0..100 {
        let f = forward(y) - x;
        if f.abs() <= tol {
            return y;
        }
        if f < 0.0 {
            lo = y;
        } else {
            hi = y;
        }
        let slope = derivative(y);
        let newton = if slope > 0.0 && slope.is_finite() { y - f / slope } else { f64::NAN };
        y = if newton.is_finite() && newton > lo && newton < hi {
            newton
        } else {
            (lo + hi) / 2.0
        };
        if hi - lo < 1e-15 {
            return (lo + hi) / 2.0;
        }
    }
    y
}

// ── Forward / inverse ─────────────────────────────────────────────────────

/// One data value → display units.
pub fn transform_value(t: &ResolvedTransform, x: f64) -> f64 {
    match t.kind {
        TransformKind::Linear => x / t.t,
        TransformKind::Log => {
            if x <= 0.0 {
                t.floor
            } else {
                1.0 + (x.ln() / t.base.ln() - t.t.ln() / t.base.ln()) / t.m
            }
        }
        TransformKind::Arcsinh => {
            ((x * (t.m * LN10).sinh()) / t.t).asinh() / ((t.m + t.a) * LN10) + t.a / (t.m + t.a)
        }
        TransformKind::Logicle => {
            let p = logicle_coeffs(t.t, t.w, t.m, t.a);
            solve_monotonic(&|y| logicle_b(y, &p), &|y| logicle_db(y, &p), x)
        }
        TransformKind::Hyperlog => {
            let p = hyperlog_coeffs(t.t, t.w, t.m, t.a);
            solve_monotonic(&|y| hyperlog_eh(y, &p), &|y| hyperlog_deh(y, &p), x)
        }
    }
}

/// One display value → data units (the exact inverse, except log at/below
/// the floor: every non-positive data value piles there, and so does every
/// positive value below the bottom decade (x ≤ T·base^{M·(floor−1)} —
/// 8.29 on the defaults) — the inverse of the floor is 0, and the log
/// transform is only invertible above the pile-up threshold. That is the
/// log scale's nature, not a bug: FlowJo piles the same events at the
/// axis bottom.
pub fn invert_value(t: &ResolvedTransform, y: f64) -> f64 {
    match t.kind {
        TransformKind::Linear => y * t.t,
        TransformKind::Log => {
            if y <= t.floor {
                0.0
            } else {
                t.t * t.base.powf(t.m * (y - 1.0))
            }
        }
        TransformKind::Arcsinh => {
            t.t * (((t.m + t.a) * LN10 * (y - t.a / (t.m + t.a))).sinh()) / (t.m * LN10).sinh()
        }
        TransformKind::Logicle => {
            let p = logicle_coeffs(t.t, t.w, t.m, t.a);
            logicle_b(y, &p)
        }
        TransformKind::Hyperlog => {
            let p = hyperlog_coeffs(t.t, t.w, t.m, t.a);
            hyperlog_eh(y, &p)
        }
    }
}

// ── Tauri command ─────────────────────────────────────────────────────────

/// What the `flow_apply_transform` command returns (camelCase wire
/// format — the TS `FlowTransformResult` mirrors this).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowTransformResult {
    pub sample_id: String,
    pub parameter: String,
    pub kind: String,
    pub event_count: usize,
    pub before: FlowParamStats,
    pub after: FlowParamStats,
}

/// Apply a transform to one parameter of a loaded sample, in the Rust
/// event store. Resolves + validates the parameters first (nothing is
/// applied when they are wrong); the store refuses an unknown sample /
/// parameter. The caller records the transform on the sample node.
#[tauri::command]
pub fn flow_apply_transform(
    state: tauri::State<'_, FlowStore>,
    sample_id: String,
    parameter: String,
    kind: String,
    params: serde_json::Value,
) -> Result<FlowTransformResult, String> {
    let resolved = resolve_transform(&kind, &params)?;
    let spec = resolved;
    let (event_count, before, after) =
        state.apply_transform(&sample_id, &parameter, &|x| transform_value(&spec, x))?;
    Ok(FlowTransformResult {
        sample_id,
        parameter,
        kind: spec.kind.as_str().to_string(),
        event_count,
        before,
        after,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn golden() -> serde_json::Value {
        let text = include_str!("../../tests/testdata/flow/transform-goldens.json");
        serde_json::from_str(text).expect("golden fixture parses")
    }

    fn resolve(kind: &str, set: &serde_json::Value) -> ResolvedTransform {
        let params = serde_json::json!({
            "T": set["T"], "W": set["W"], "M": set["M"], "A": set["A"],
        });
        resolve_transform(kind, &params).expect("golden params resolve")
    }

    #[test]
    fn differential_vs_golden_fixture() {
        // The Rust math against the same Python reference the TS side
        // pins: root-found kinds (logicle, Hyperlog) at 1e-9, closed
        // forms at 1e-12. A failure here is this implementation's, not
        // the reference's — the Python bisection is exact to ~1e-60.
        let g = golden();
        let sets = g["param_sets"].as_object().expect("param_sets");
        let mut xs: Vec<f64> = g["x_grid"].as_array().expect("x_grid").iter().map(|v| v.as_f64().unwrap()).collect();
        xs.extend(g["x_sweep"].as_array().expect("x_sweep").iter().map(|v| v.as_f64().unwrap()));
        for (kind, by_set) in g["values"].as_object().expect("values") {
            let tol = if kind == "logicle" || kind == "hyperlog" { 1e-9 } else { 1e-12 };
            for (set_name, want) in by_set.as_object().expect("by set") {
                let t = resolve(kind, &sets[set_name]);
                let want = want.as_array().expect("series");
                assert_eq!(want.len(), xs.len(), "{kind}/{set_name} series length");
                let mut worst = 0.0f64;
                for (i, x) in xs.iter().enumerate() {
                    let got = transform_value(&t, *x);
                    let d = (got - want[i].as_f64().unwrap()).abs();
                    worst = worst.max(d);
                    assert!(d <= tol, "{kind}/{set_name} at x={x}: got {got}, want {} (diff {d})", want[i]);
                }
                assert!(worst <= tol, "{kind}/{set_name} worst diff {worst}");
            }
        }
    }

    #[test]
    fn w0_identity_and_logicle_zero() {
        // logicle at W=0 IS arcsinh (F0: 5.6e-17), and logicle(0) is
        // exactly x1 = (A+W)/(M+A) (B(x1) = 0 by construction).
        let g = golden();
        let mut xs: Vec<f64> = g["x_grid"].as_array().expect("x_grid").iter().map(|v| v.as_f64().unwrap()).collect();
        xs.extend(g["x_sweep"].as_array().expect("x_sweep").iter().map(|v| v.as_f64().unwrap()));
        let arc = resolve_transform("arcsinh", &serde_json::json!({ "T": 262144, "M": 4.5, "A": 0 })).unwrap();
        let log0 = resolve_transform("logicle", &serde_json::json!({ "T": 262144, "W": 0, "M": 4.5, "A": 0 })).unwrap();
        let worst = xs
            .iter()
            .map(|x| (transform_value(&log0, *x) - transform_value(&arc, *x)).abs())
            .fold(0.0f64, f64::max);
        assert!(worst <= 1e-12, "logicle W=0 vs arcsinh worst diff {worst}");
        let log_default =
            resolve_transform("logicle", &serde_json::json!({ "T": 262144, "W": 0.5, "M": 4.5, "A": 0 })).unwrap();
        assert!((transform_value(&log_default, 0.0) - 0.5 / 4.5).abs() < 1e-9, "logicle(0) must be x1");
        // Every kind maps T -> 1.
        for kind in ["log", "logicle", "arcsinh", "hyperlog", "linear"] {
            let t = resolve_transform(kind, &serde_json::json!({ "T": 262144, "W": 0.5, "M": 4.5, "A": 0 })).unwrap();
            assert!((transform_value(&t, 262144.0) - 1.0).abs() < 1e-9, "{kind} must map T -> 1");
        }
    }

    #[test]
    fn inverse_round_trip() {
        let g = golden();
        let sets = g["param_sets"].as_object().expect("param_sets");
        let mut xs: Vec<f64> = g["x_grid"].as_array().expect("x_grid").iter().map(|v| v.as_f64().unwrap()).collect();
        xs.extend(g["x_sweep"].as_array().expect("x_sweep").iter().map(|v| v.as_f64().unwrap()));
        for (kind, by_set) in g["values"].as_object().expect("values") {
            for set_name in by_set.as_object().expect("by set").keys() {
                let t = resolve(kind, &sets[set_name]);
                for x in &xs {
                    let y = transform_value(&t, *x);
                    // Log is only invertible above the pile-up threshold
                    // (forward(x) <= floor piles at the floor).
                    if kind == "log" && y <= t.floor {
                        continue;
                    }
                    let back = invert_value(&t, y);
                    let d = (back - *x).abs();
                    if d <= 1e-9 * x.abs().max(1.0) {
                        continue;
                    }
                    // The only legitimate miss is the display clamp: y
                    // pinned at ±2 for an x outside the forward range
                    // (Hyperlog's linear negative tail).
                    assert!(
                        (y.abs() - 2.0).abs() < 1e-9,
                        "{kind}/{set_name} round-trip at x={x}: got {back} (diff {d}) — y={y} is not the ±2 display clamp"
                    );
                }
            }
        }
    }

    #[test]
    fn resolve_rejects_bad_parameters() {
        assert!(resolve_transform("nope", &serde_json::json!({})).is_err());
        assert!(resolve_transform("hyperlog", &serde_json::json!({ "W": 0 })).is_err());
        assert!(resolve_transform("logicle", &serde_json::json!({ "W": 3 })).is_err());
        assert!(resolve_transform("logicle", &serde_json::json!({ "W": 0.5, "A": 5 })).is_err());
        assert!(resolve_transform("logicle", &serde_json::json!({ "T": 0 })).is_err());
        assert!(resolve_transform("log", &serde_json::json!({ "base": 1 })).is_err());
        // Defaults fill in: an empty params object is the FlowJo default.
        let t = resolve_transform("logicle", &serde_json::json!({})).unwrap();
        assert_eq!((t.t, t.w, t.m, t.a), (262144.0, 0.5, 4.5, 0.0));
    }

    #[test]
    fn store_apply_end_to_end() {
        // Resolve → store rewrite → before/after stats, through the same
        // closure the command passes the store.
        let store = FlowStore::with_budget(1024 * 1024);
        store
            .insert(
                "s1",
                Some("Sample 1".to_string()),
                None,
                vec!["FL1-A".to_string()],
                vec![vec![0.0, 100.0, 262144.0]],
            )
            .expect("test sample loads");
        let spec = resolve_transform("logicle", &serde_json::json!({ "T": 262144, "W": 0.5, "M": 4.5, "A": 0 })).unwrap();
        let (events, before, after) = store
            .apply_transform("s1", "FL1-A", &|x| transform_value(&spec, x))
            .expect("transform applies");
        assert_eq!(events, 3);
        assert_eq!(before.max, Some(262144.0));
        assert!((after.max.unwrap() - 1.0).abs() < 1e-6, "T must map to display 1: {:?}", after.max);
        assert!((after.min.unwrap() - 0.5 / 4.5).abs() < 1e-6, "0 must map to x1: {:?}", after.min);
    }
}
